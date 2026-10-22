"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ORDER CHECKOUT INTEGRATION TESTS
========================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");

const orderService = require(
    "../../src/orders/order-service"
);

const paymentService = require(
    "../../src/payments/payment-service"
);

/* ==========================================================
   TEST HELPERS
========================================================== */

function cloneValue(value) {
    if (Array.isArray(value)) {
        return value.map(cloneValue);
    }

    if (
        value &&
        typeof value === "object"
    ) {
        return Object.keys(value).reduce(
            function (output, key) {
                output[key] =
                    cloneValue(value[key]);

                return output;
            },
            {}
        );
    }

    return value;
}

function mergeValue(current, update) {
    const output =
        cloneValue(current || {});

    Object.keys(update || {}).forEach(
        function (key) {
            const nextValue =
                update[key];

            if (
                nextValue &&
                typeof nextValue === "object" &&
                !Array.isArray(nextValue) &&
                output[key] &&
                typeof output[key] === "object" &&
                !Array.isArray(output[key])
            ) {
                output[key] =
                    mergeValue(
                        output[key],
                        nextValue
                    );
            } else {
                output[key] =
                    cloneValue(nextValue);
            }
        }
    );

    return output;
}

function resolveNestedField(value, path) {
    return String(path)
        .split(".")
        .reduce(
            function (current, key) {
                if (
                    current === null ||
                    current === undefined
                ) {
                    return undefined;
                }

                return current[key];
            },
            value
        );
}

function createSnapshot(
    reference,
    data
) {
    return {
        id:
            reference.id,

        ref:
            reference,

        exists:
            data !== undefined,

        data:
            function () {
                return cloneValue(data);
            },

        get:
            function (field) {
                return resolveNestedField(
                    data,
                    field
                );
            }
    };
}

function createDatabase(initialDocuments) {
    const documents =
        new Map();

    const writes = [];

    let generatedId = 0;

    Object.keys(
        initialDocuments || {}
    ).forEach(function (path) {
        documents.set(
            path,
            cloneValue(
                initialDocuments[path]
            )
        );
    });

    function createDocumentReference(
        collectionName,
        documentId
    ) {
        const id =
            documentId ||
            "generated-" +
                String(++generatedId);

        const path =
            collectionName +
            "/" +
            id;

        const reference = {
            id:
                id,

            path:
                path,

            get:
                async function () {
                    return createSnapshot(
                        reference,
                        documents.get(path)
                    );
                },

            set:
                async function (
                    data,
                    options
                ) {
                    const existing =
                        documents.get(path);

                    const next =
                        options &&
                        options.merge
                            ? mergeValue(
                                  existing,
                                  data
                              )
                            : cloneValue(data);

                    documents.set(
                        path,
                        next
                    );

                    writes.push({
                        operation:
                            "set",

                        path:
                            path,

                        data:
                            cloneValue(data),

                        options:
                            options || null
                    });
                },

            create:
                async function (data) {
                    if (
                        documents.has(path)
                    ) {
                        const error =
                            new Error(
                                "Document already exists"
                            );

                        error.code =
                            "already-exists";

                        throw error;
                    }

                    documents.set(
                        path,
                        cloneValue(data)
                    );

                    writes.push({
                        operation:
                            "create",

                        path:
                            path,

                        data:
                            cloneValue(data)
                    });
                },

            update:
                async function (data) {
                    const existing =
                        documents.get(path);

                    if (!existing) {
                        throw new Error(
                            "Document not found"
                        );
                    }

                    documents.set(
                        path,
                        mergeValue(
                            existing,
                            data
                        )
                    );

                    writes.push({
                        operation:
                            "update",

                        path:
                            path,

                        data:
                            cloneValue(data)
                    });
                }
        };

        return reference;
    }

    function createCollection(
        collectionName
    ) {
        return {
            doc:
                function (documentId) {
                    return createDocumentReference(
                        collectionName,
                        documentId
                    );
                },

            where:
                function (
                    field,
                    operator,
                    value
                ) {
                    return createQuery({
                        collectionName:
                            collectionName,

                        documents:
                            documents,

                        filters: [
                            {
                                field:
                                    field,

                                operator:
                                    operator,

                                value:
                                    value
                            }
                        ],

                        createDocumentReference:
                            createDocumentReference
                    });
                },

            orderBy:
                function (
                    field,
                    direction
                ) {
                    return createQuery({
                        collectionName:
                            collectionName,

                        documents:
                            documents,

                        ordering: [
                            {
                                field:
                                    field,

                                direction:
                                    direction ||
                                    "asc"
                            }
                        ],

                        createDocumentReference:
                            createDocumentReference
                    });
                },

            get:
                async function () {
                    return createQuerySnapshot(
                        listCollectionDocuments(
                            collectionName,
                            documents,
                            createDocumentReference
                        )
                    );
                }
        };
    }

    return {
        documents:
            documents,

        writes:
            writes,

        collection:
            createCollection,

        runTransaction:
            async function (callback) {
                const transaction = {
                    get:
                        async function (
                            reference
                        ) {
                            return reference.get();
                        },

                    set:
                        function (
                            reference,
                            data,
                            options
                        ) {
                            const existing =
                                documents.get(
                                    reference.path
                                );

                            const next =
                                options &&
                                options.merge
                                    ? mergeValue(
                                          existing,
                                          data
                                      )
                                    : cloneValue(
                                          data
                                      );

                            documents.set(
                                reference.path,
                                next
                            );

                            writes.push({
                                operation:
                                    "transaction-set",

                                path:
                                    reference.path,

                                data:
                                    cloneValue(data),

                                options:
                                    options || null
                            });
                        },

                    create:
                        function (
                            reference,
                            data
                        ) {
                            if (
                                documents.has(
                                    reference.path
                                )
                            ) {
                                const error =
                                    new Error(
                                        "Document already exists"
                                    );

                                error.code =
                                    "already-exists";

                                throw error;
                            }

                            documents.set(
                                reference.path,
                                cloneValue(data)
                            );

                            writes.push({
                                operation:
                                    "transaction-create",

                                path:
                                    reference.path,

                                data:
                                    cloneValue(data)
                            });
                        },

                    update:
                        function (
                            reference,
                            data
                        ) {
                            const existing =
                                documents.get(
                                    reference.path
                                );

                            if (!existing) {
                                throw new Error(
                                    "Document not found"
                                );
                            }

                            documents.set(
                                reference.path,
                                mergeValue(
                                    existing,
                                    data
                                )
                            );

                            writes.push({
                                operation:
                                    "transaction-update",

                                path:
                                    reference.path,

                                data:
                                    cloneValue(data)
                            });
                        }
                };

                return callback(transaction);
            }
    };
}

function createQuery(options) {
    const filters =
        options.filters || [];

    const ordering =
        options.ordering || [];

    let maximum = null;

    const query = {
        where:
            function (
                field,
                operator,
                value
            ) {
                filters.push({
                    field:
                        field,

                    operator:
                        operator,

                    value:
                        value
                });

                return query;
            },

        orderBy:
            function (
                field,
                direction
            ) {
                ordering.push({
                    field:
                        field,

                    direction:
                        direction ||
                        "asc"
                });

                return query;
            },

        limit:
            function (value) {
                maximum =
                    Number(value);

                return query;
            },

        startAfter:
            function () {
                return query;
            },

        get:
            async function () {
                let matching =
                    listCollectionDocuments(
                        options.collectionName,
                        options.documents,
                        options.createDocumentReference
                    );

                matching =
                    matching.filter(
                        function (document) {
                            return filters.every(
                                function (filter) {
                                    const actual =
                                        resolveNestedField(
                                            document.data,
                                            filter.field
                                        );

                                    if (
                                        filter.operator ===
                                        "=="
                                    ) {
                                        return (
                                            actual ===
                                            filter.value
                                        );
                                    }

                                    if (
                                        filter.operator ===
                                        "in"
                                    ) {
                                        return (
                                            Array.isArray(
                                                filter.value
                                            ) &&
                                            filter.value
                                                .includes(
                                                    actual
                                                )
                                        );
                                    }

                                    throw new Error(
                                        "Unsupported query operator: " +
                                        filter.operator
                                    );
                                }
                            );
                        }
                    );

                ordering
                    .slice()
                    .reverse()
                    .forEach(
                        function (order) {
                            matching.sort(
                                function (
                                    first,
                                    second
                                ) {
                                    const left =
                                        resolveNestedField(
                                            first.data,
                                            order.field
                                        );

                                    const right =
                                        resolveNestedField(
                                            second.data,
                                            order.field
                                        );

                                    if (left === right) {
                                        return 0;
                                    }

                                    const comparison =
                                        left < right
                                            ? -1
                                            : 1;

                                    return order.direction ===
                                        "desc"
                                        ? -comparison
                                        : comparison;
                                }
                            );
                        }
                    );

                if (
                    maximum !== null
                ) {
                    matching =
                        matching.slice(
                            0,
                            maximum
                        );
                }

                return createQuerySnapshot(
                    matching
                );
            }
    };

    return query;
}

function listCollectionDocuments(
    collectionName,
    documents,
    createDocumentReference
) {
    const prefix =
        collectionName +
        "/";

    return Array.from(
        documents.entries()
    )
        .filter(
            function (entry) {
                if (
                    !entry[0].startsWith(
                        prefix
                    )
                ) {
                    return false;
                }

                return !entry[0]
                    .slice(prefix.length)
                    .includes("/");
            }
        )
        .map(
            function (entry) {
                const id =
                    entry[0].slice(
                        prefix.length
                    );

                return {
                    id:
                        id,

                    data:
                        cloneValue(
                            entry[1]
                        ),

                    ref:
                        createDocumentReference(
                            collectionName,
                            id
                        )
                };
            }
        );
}

function createQuerySnapshot(
    documents
) {
    const snapshots =
        documents.map(
            function (document) {
                return createSnapshot(
                    document.ref,
                    document.data
                );
            }
        );

    return {
        size:
            snapshots.length,

        empty:
            snapshots.length ===
            0,

        docs:
            snapshots
    };
}

function createCheckoutPayload(
    overrides
) {
    const payload = {
        customer: {
            firstName:
                "Samuel",

            lastName:
                "Udom",

            email:
                "samuel@example.com",

            phone:
                "+2348000000000"
        },

        shippingAddress: {
            firstName:
                "Samuel",

            lastName:
                "Udom",

            addressLine1:
                "10 Example Road",

            city:
                "Lagos",

            state:
                "Lagos",

            country:
                "Nigeria",

            phone:
                "+2348000000000"
        },

        billingSameAsShipping:
            true,

        deliveryMethod:
            "standard",

        paymentMethod:
            "paystack",

        couponCode:
            "",

        notes:
            "Leave with reception.",

        idempotencyKey:
            "checkout-session-001",

        items: [
            {
                productId:
                    "product-coat",

                variantId:
                    "black-medium",

                quantity:
                    2
            }
        ]
    };

    return mergeValue(
        payload,
        overrides || {}
    );
}

function createCatalogDocuments(
    overrides
) {
    return mergeValue(
        {
            "products/product-coat": {
                name:
                    "Signature Coat",

                slug:
                    "signature-coat",

                sku:
                    "COAT-001",

                active:
                    true,

                published:
                    true,

                price:
                    150000,

                inventory:
                    10,

                stock:
                    10,

                images: [
                    {
                        url:
                            "https://example.com/coat.jpg",

                        alt:
                            "Signature coat"
                    }
                ],

                variants: [
                    {
                        id:
                            "black-medium",

                        sku:
                            "COAT-BLK-M",

                        name:
                            "Black / Medium",

                        color:
                            "Black",

                        size:
                            "M",

                        price:
                            150000,

                        inventory:
                            5,

                        stock:
                            5,

                        active:
                            true,

                        available:
                            true
                    }
                ]
            }
        },
        overrides || {}
    );
}

function mockFetch(responseFactory) {
    const originalFetch =
        global.fetch;

    const calls = [];

    global.fetch =
        async function (
            url,
            options
        ) {
            calls.push({
                url:
                    url,

                options:
                    options
            });

            const response =
                typeof responseFactory ===
                    "function"
                    ? responseFactory(
                          url,
                          options
                      )
                    : responseFactory;

            return {
                ok:
                    response.ok !==
                    false,

                status:
                    response.status ||
                    200,

                headers: {
                    get:
                        function (name) {
                            const headers =
                                response.headers ||
                                {};

                            return (
                                headers[
                                    String(name)
                                        .toLowerCase()
                                ] ||
                                null
                            );
                        }
                },

                text:
                    async function () {
                        if (
                            response.body ===
                            undefined ||
                            response.body ===
                            null
                        ) {
                            return "";
                        }

                        return typeof response.body ===
                            "string"
                            ? response.body
                            : JSON.stringify(
                                  response.body
                              );
                    }
            };
        };

    return {
        calls:
            calls,

        restore:
            function () {
                global.fetch =
                    originalFetch;
            }
    };
}

function findDocumentPath(
    database,
    collectionName
) {
    const prefix =
        collectionName +
        "/";

    return Array.from(
        database.documents.keys()
    ).find(
        function (path) {
            return path.startsWith(
                prefix
            );
        }
    );
}

/* ==========================================================
   COMPLETE PAYSTACK CHECKOUT
========================================================== */

test(
    "checkout creates an order, reserves stock, and initializes Paystack",
    async function () {
        const db =
            createDatabase(
                createCatalogDocuments()
            );

        const fetchMock =
            mockFetch({
                body: {
                    status:
                        true,

                    message:
                        "Authorization URL created",

                    data: {
                        authorization_url:
                            "https://checkout.paystack.com/test",

                        access_code:
                            "access-code",

                        reference:
                            "LET-PS-CHECKOUT001"
                    }
                }
            });

        try {
            const result =
                await orderService
                    .createOrder({
                        db:
                            db,

                        userId:
                            "customer-1",

                        payload:
                            createCheckoutPayload(),

                        configuration: {
                            currency:
                                "NGN",

                            appOrigin:
                                "https://shop.example.com",

                            paystackSecretKey:
                                "paystack-secret",

                            paymentProvider:
                                "paystack"
                        }
                    });

            assert.equal(
                result.success,
                true
            );

            assert.equal(
                result.order.userId,
                "customer-1"
            );

            assert.equal(
                result.order.subtotal,
                300000
            );

            assert.equal(
                result.order.currency,
                "NGN"
            );

            assert.equal(
                result.order.paymentStatus,
                "pending"
            );

            assert.equal(
                result.payment.provider,
                "paystack"
            );

            assert.equal(
                result.payment.reference,
                "LET-PS-CHECKOUT001"
            );

            assert.equal(
                result.payment.authorizationUrl,
                "https://checkout.paystack.com/test"
            );

            const product =
                db.documents.get(
                    "products/product-coat"
                );

            assert.equal(
                product.inventory,
                8
            );

            assert.equal(
                product.stock,
                8
            );

            assert.equal(
                product.variants[0]
                    .inventory,
                3
            );

            assert.equal(
                product.variants[0]
                    .stock,
                3
            );

            const orderPath =
                findDocumentPath(
                    db,
                    "orders"
                );

            assert.ok(orderPath);

            const storedOrder =
                db.documents.get(
                    orderPath
                );

            assert.equal(
                storedOrder.items[0]
                    .quantity,
                2
            );

            assert.equal(
                storedOrder.items[0]
                    .unitPrice,
                150000
            );

            assert.equal(
                storedOrder.items[0]
                    .lineTotal,
                300000
            );

            assert.equal(
                storedOrder.paymentReference,
                "LET-PS-CHECKOUT001"
            );

            assert.equal(
                fetchMock.calls.length,
                1
            );

            const requestBody =
                JSON.parse(
                    fetchMock.calls[0]
                        .options.body
                );

            assert.equal(
                requestBody.amount,
                String(
                    Math.round(
                        result.order.total *
                        100
                    )
                )
            );

            assert.equal(
                requestBody.email,
                "samuel@example.com"
            );

            assert.equal(
                requestBody.metadata.orderId,
                result.order.id
            );
        } finally {
            fetchMock.restore();
        }
    }
);

/* ==========================================================
   IDEMPOTENCY
========================================================== */

test(
    "repeated checkout with the same idempotency key returns one order",
    async function () {
        const db =
            createDatabase(
                createCatalogDocuments()
            );

        let initializationCount =
            0;

        const fetchMock =
            mockFetch(
                function () {
                    initializationCount += 1;

                    return {
                        body: {
                            status:
                                true,

                            data: {
                                authorization_url:
                                    "https://checkout.paystack.com/test",

                                access_code:
                                    "access-code",

                                reference:
                                    "LET-PS-IDEMPOTENT"
                            }
                        }
                    };
                }
            );

        try {
            const first =
                await orderService
                    .createOrder({
                        db:
                            db,

                        userId:
                            "customer-1",

                        payload:
                            createCheckoutPayload(),

                        configuration: {
                            currency:
                                "NGN",

                            appOrigin:
                                "https://shop.example.com",

                            paystackSecretKey:
                                "secret",

                            paymentProvider:
                                "paystack"
                        }
                    });

            const second =
                await orderService
                    .createOrder({
                        db:
                            db,

                        userId:
                            "customer-1",

                        payload:
                            createCheckoutPayload(),

                        configuration: {
                            currency:
                                "NGN",

                            appOrigin:
                                "https://shop.example.com",

                            paystackSecretKey:
                                "secret",

                            paymentProvider:
                                "paystack"
                        }
                    });

            assert.equal(
                second.order.id,
                first.order.id
            );

            assert.equal(
                second.duplicate,
                true
            );

            assert.equal(
                initializationCount,
                1
            );

            const product =
                db.documents.get(
                    "products/product-coat"
                );

            assert.equal(
                product.inventory,
                8
            );

            assert.equal(
                product.variants[0]
                    .inventory,
                3
            );

            const orderPaths =
                Array.from(
                    db.documents.keys()
                ).filter(
                    function (path) {
                        return path.startsWith(
                            "orders/"
                        );
                    }
                );

            assert.equal(
                orderPaths.length,
                1
            );
        } finally {
            fetchMock.restore();
        }
    }
);

/* ==========================================================
   COUPONS & DELIVERY
========================================================== */

test(
    "checkout applies a valid percentage coupon",
    async function () {
        const db =
            createDatabase(
                createCatalogDocuments({
                    "coupons/SUMMER20": {
                        code:
                            "SUMMER20",

                        active:
                            true,

                        type:
                            "percentage",

                        value:
                            20,

                        minimumSubtotal:
                            100000,

                        maximumDiscount:
                            100000,

                        usageLimit:
                            100,

                        usageCount:
                            0
                    }
                })
            );

        const fetchMock =
            mockFetch({
                body: {
                    status:
                        true,

                    data: {
                        authorization_url:
                            "https://checkout.paystack.com/coupon",

                        reference:
                            "LET-PS-COUPON"
                    }
                }
            });

        try {
            const result =
                await orderService
                    .createOrder({
                        db:
                            db,

                        userId:
                            "customer-1",

                        payload:
                            createCheckoutPayload({
                                couponCode:
                                    "SUMMER20"
                            }),

                        configuration: {
                            currency:
                                "NGN",

                            appOrigin:
                                "https://shop.example.com",

                            paystackSecretKey:
                                "secret",

                            paymentProvider:
                                "paystack"
                        }
                    });

            assert.equal(
                result.order.subtotal,
                300000
            );

            assert.equal(
                result.order.discount,
                60000
            );

            assert.equal(
                result.order.coupon.code,
                "SUMMER20"
            );

            assert.equal(
                result.order.total,
                result.order.subtotal -
                    result.order.discount +
                    result.order.deliveryFee +
                    result.order.tax
            );
        } finally {
            fetchMock.restore();
        }
    }
);

test(
    "checkout applies free standard delivery above the threshold",
    async function () {
        const db =
            createDatabase(
                createCatalogDocuments()
            );

        const fetchMock =
            mockFetch({
                body: {
                    status:
                        true,

                    data: {
                        authorization_url:
                            "https://checkout.paystack.com/free-delivery",

                        reference:
                            "LET-PS-FREEDELIVERY"
                    }
                }
            });

        try {
            const result =
                await orderService
                    .createOrder({
                        db:
                            db,

                        userId:
                            "customer-1",

                        payload:
                            createCheckoutPayload(),

                        configuration: {
                            currency:
                                "NGN",

                            appOrigin:
                                "https://shop.example.com",

                            paystackSecretKey:
                                "secret",

                            paymentProvider:
                                "paystack"
                        }
                    });

            assert.equal(
                result.order.deliveryMethod,
                "standard"
            );

            assert.equal(
                result.order.deliveryFee,
                0
            );
        } finally {
            fetchMock.restore();
        }
    }
);

/* ==========================================================
   INVENTORY FAILURES
========================================================== */

test(
    "checkout rejects insufficient variant stock without creating an order",
    async function () {
        const db =
            createDatabase(
                createCatalogDocuments({
                    "products/product-coat": {
                        name:
                            "Signature Coat",

                        active:
                            true,

                        published:
                            true,

                        price:
                            150000,

                        inventory:
                            1,

                        stock:
                            1,

                        variants: [
                            {
                                id:
                                    "black-medium",

                                price:
                                    150000,

                                inventory:
                                    1,

                                stock:
                                    1,

                                active:
                                    true,

                                available:
                                    true
                            }
                        ]
                    }
                })
            );

        const fetchMock =
            mockFetch({
                body: {
                    status:
                        true,

                    data: {
                        authorization_url:
                            "https://checkout.paystack.com/unused",

                        reference:
                            "UNUSED"
                    }
                }
            });

        try {
            await assert.rejects(
                orderService
                    .createOrder({
                        db:
                            db,

                        userId:
                            "customer-1",

                        payload:
                            createCheckoutPayload({
                                items: [
                                    {
                                        productId:
                                            "product-coat",

                                        variantId:
                                            "black-medium",

                                        quantity:
                                            2
                                    }
                                ]
                            }),

                        configuration: {
                            currency:
                                "NGN",

                            appOrigin:
                                "https://shop.example.com",

                            paystackSecretKey:
                                "secret",

                            paymentProvider:
                                "paystack"
                        }
                    }),
                function (error) {
                    assert.equal(
                        error.code,
                        "out-of-stock"
                    );

                    return true;
                }
            );

            assert.equal(
                fetchMock.calls.length,
                0
            );

            const orderPath =
                findDocumentPath(
                    db,
                    "orders"
                );

            assert.equal(
                orderPath,
                undefined
            );

            const product =
                db.documents.get(
                    "products/product-coat"
                );

            assert.equal(
                product.inventory,
                1
            );

            assert.equal(
                product.variants[0]
                    .inventory,
                1
            );
        } finally {
            fetchMock.restore();
        }
    }
);

test(
    "checkout rejects inactive products",
    async function () {
        const db =
            createDatabase(
                createCatalogDocuments({
                    "products/product-coat": {
                        name:
                            "Signature Coat",

                        active:
                            false,

                        published:
                            true,

                        price:
                            150000,

                        inventory:
                            10,

                        variants: []
                    }
                })
            );

        await assert.rejects(
            orderService.createOrder({
                db:
                    db,

                userId:
                    "customer-1",

                payload:
                    createCheckoutPayload({
                        items: [
                            {
                                productId:
                                    "product-coat",

                                quantity:
                                    1
                            }
                        ]
                    }),

                configuration: {
                    currency:
                        "NGN",

                    paystackSecretKey:
                        "secret",

                    paymentProvider:
                        "paystack"
                }
            }),
            function (error) {
                assert.match(
                    error.code,
                    /not-found|failed-precondition/
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   PAYMENT INITIALIZATION FAILURE
========================================================== */

test(
    "provider failure does not mark the order as paid",
    async function () {
        const db =
            createDatabase(
                createCatalogDocuments()
            );

        const fetchMock =
            mockFetch({
                ok:
                    false,

                status:
                    502,

                body: {
                    message:
                        "Payment provider unavailable"
                }
            });

        try {
            await assert.rejects(
                orderService
                    .createOrder({
                        db:
                            db,

                        userId:
                            "customer-1",

                        payload:
                            createCheckoutPayload(),

                        configuration: {
                            currency:
                                "NGN",

                            appOrigin:
                                "https://shop.example.com",

                            paystackSecretKey:
                                "secret",

                            paymentProvider:
                                "paystack"
                        }
                    }),
                function (error) {
                    assert.match(
                        error.code,
                        /unavailable|payment-failed/
                    );

                    return true;
                }
            );

            const orderPath =
                findDocumentPath(
                    db,
                    "orders"
                );

            if (orderPath) {
                const storedOrder =
                    db.documents.get(
                        orderPath
                    );

                assert.notEqual(
                    storedOrder.paymentStatus,
                    "paid"
                );
            }
        } finally {
            fetchMock.restore();
        }
    }
);

/* ==========================================================
   PAYMENT SUCCESS WEBHOOK
========================================================== */

test(
    "successful Paystack verification confirms the checkout order",
    async function () {
        const reference =
            "LET-PS-WEBHOOKSUCCESS";

        const db =
            createDatabase(
                mergeValue(
                    createCatalogDocuments(),
                    {
                        "orders/order-1": {
                            userId:
                                "customer-1",

                            orderNumber:
                                "LET-ORDER-1",

                            status:
                                "pending",

                            paymentStatus:
                                "pending",

                            subtotal:
                                300000,

                            discount:
                                0,

                            deliveryFee:
                                0,

                            tax:
                                0,

                            total:
                                300000,

                            currency:
                                "NGN",

                            paymentReference:
                                reference,

                            customer: {
                                email:
                                    "samuel@example.com"
                            },

                            payment: {
                                provider:
                                    "paystack",

                                providerReference:
                                    reference
                            }
                        }
                    }
                )
            );

        const fetchMock =
            mockFetch({
                body: {
                    status:
                        true,

                    data: {
                        id:
                            9001,

                        reference:
                            reference,

                        status:
                            "success",

                        amount:
                            30000000,

                        currency:
                            "NGN",

                        paid_at:
                            "2026-07-20T08:00:00.000Z",

                        gateway_response:
                            "Successful",

                        customer: {
                            email:
                                "samuel@example.com"
                        },

                        authorization: {
                            authorization_code:
                                "AUTH_PRIVATE",

                            channel:
                                "card",

                            card_type:
                                "visa",

                            last4:
                                "4081",

                            reusable:
                                false
                        }
                    }
                }
            });

        try {
            const result =
                await paymentService
                    .handleSuccessfulPayment({
                        db:
                            db,

                        provider:
                            "paystack",

                        reference:
                            reference,

                        webhookData: {
                            reference:
                                reference,

                            metadata: {
                                orderId:
                                    "order-1"
                            }
                        },

                        configuration: {
                            paystackSecretKey:
                                "secret"
                        }
                    });

            assert.equal(
                result.orderId,
                "order-1"
            );

            assert.equal(
                result.duplicate,
                false
            );

            const order =
                db.documents.get(
                    "orders/order-1"
                );

            assert.equal(
                order.paymentStatus,
                "paid"
            );

            assert.equal(
                order.status,
                "confirmed"
            );

            assert.equal(
                order.payment.provider,
                "paystack"
            );

            assert.equal(
                order.payment.providerTransactionId,
                "9001"
            );

            assert.equal(
                order.payment.authorization.last4,
                "4081"
            );

            assert.equal(
                order.payment.authorization
                    .authorizationCode,
                undefined
            );
        } finally {
            fetchMock.restore();
        }
    }
);

/* ==========================================================
   PAYMENT FAILURE WEBHOOK
========================================================== */

test(
    "failed payment webhook marks a pending checkout as failed",
    async function () {
        const reference =
            "LET-PS-FAILED";

        const db =
            createDatabase({
                "orders/order-1": {
                    userId:
                        "customer-1",

                    status:
                        "pending",

                    paymentStatus:
                        "pending",

                    total:
                        300000,

                    currency:
                        "NGN",

                    paymentReference:
                        reference,

                    customer: {
                        email:
                            "samuel@example.com"
                    }
                }
            });

        const result =
            await paymentService
                .handleFailedPayment({
                    db:
                        db,

                    provider:
                        "paystack",

                    reference:
                        reference,

                    webhookData: {
                        reference:
                            reference,

                        status:
                            "failed",

                        gateway_response:
                            "Declined"
                    }
                });

        assert.equal(
            result.orderId,
            "order-1"
        );

        assert.equal(
            result.ignored,
            false
        );

        const order =
            db.documents.get(
                "orders/order-1"
            );

        assert.equal(
            order.paymentStatus,
            "failed"
        );

        assert.equal(
            order.payment.gatewayResponse,
            "Declined"
        );
    }
);

/* ==========================================================
   CUSTOMER CANCELLATION
========================================================== */

test(
    "customer cancellation restores reserved product inventory",
    async function () {
        const db =
            createDatabase({
                "products/product-coat": {
                    name:
                        "Signature Coat",

                    inventory:
                        8,

                    stock:
                        8,

                    variants: [
                        {
                            id:
                                "black-medium",

                            inventory:
                                3,

                            stock:
                                3,

                            active:
                                true,

                            available:
                                true
                        }
                    ]
                },

                "orders/order-1": {
                    userId:
                        "customer-1",

                    status:
                        "pending",

                    paymentStatus:
                        "pending",

                    inventoryRestored:
                        false,

                    items: [
                        {
                            productId:
                                "product-coat",

                            variantId:
                                "black-medium",

                            quantity:
                                2
                        }
                    ]
                }
            });

        const result =
            await orderService
                .cancelCustomerOrder({
                    db:
                        db,

                    userId:
                        "customer-1",

                    orderId:
                        "order-1",

                    reason:
                        "Changed my mind"
                });

        assert.equal(
            result.status,
            "cancelled"
        );

        const order =
            db.documents.get(
                "orders/order-1"
            );

        assert.equal(
            order.status,
            "cancelled"
        );

        assert.equal(
            order.inventoryRestored,
            true
        );

        const product =
            db.documents.get(
                "products/product-coat"
            );

        assert.equal(
            product.inventory,
            10
        );

        assert.equal(
            product.stock,
            10
        );

        assert.equal(
            product.variants[0]
                .inventory,
            5
        );

        assert.equal(
            product.variants[0]
                .stock,
            5
        );
    }
);

test(
    "customer cannot cancel another customer's order",
    async function () {
        const db =
            createDatabase({
                "orders/order-1": {
                    userId:
                        "customer-2",

                    status:
                        "pending",

                    paymentStatus:
                        "pending",

                    items: []
                }
            });

        await assert.rejects(
            orderService
                .cancelCustomerOrder({
                    db:
                        db,

                    userId:
                        "customer-1",

                    orderId:
                        "order-1",

                    reason:
                        "Unauthorized cancellation"
                }),
            function (error) {
                assert.match(
                    error.code,
                    /not-found|permission-denied/
                );

                return true;
            }
        );

        const order =
            db.documents.get(
                "orders/order-1"
            );

        assert.equal(
            order.status,
            "pending"
        );
    }
);