"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   COMPLETE PURCHASE FLOW INTEGRATION TESTS
========================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");

const orderService = require(
    "../../src/orders/order-service"
);

const paymentService = require(
    "../../src/payments/payment-service"
);

const emailService = require(
    "../../src/email/email-service"
);

/* ==========================================================
   VALUE HELPERS
========================================================== */

function cloneValue(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map(cloneValue);
    }

    if (
        value instanceof Date ||
        typeof value.toDate === "function"
    ) {
        return value;
    }

    if (
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
            const incoming =
                update[key];

            if (
                incoming &&
                typeof incoming === "object" &&
                !Array.isArray(incoming) &&
                !(incoming instanceof Date) &&
                typeof incoming.toDate !==
                    "function" &&
                output[key] &&
                typeof output[key] === "object" &&
                !Array.isArray(output[key])
            ) {
                output[key] =
                    mergeValue(
                        output[key],
                        incoming
                    );
            } else {
                output[key] =
                    cloneValue(incoming);
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

/* ==========================================================
   FIRESTORE TEST HARNESS
========================================================== */

function createSnapshot(reference, data) {
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

            set:
                async function (
                    data,
                    options
                ) {
                    const existing =
                        documents.get(path);

                    documents.set(
                        path,
                        options &&
                        options.merge
                            ? mergeValue(
                                  existing,
                                  data
                              )
                            : cloneValue(data)
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

            update:
                async function (data) {
                    const existing =
                        documents.get(path);

                    if (!existing) {
                        const error =
                            new Error(
                                "Document does not exist"
                            );

                        error.code =
                            "not-found";

                        throw error;
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

    function listCollectionDocuments(
        collectionName
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
                            options.collectionName
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

                                        const result =
                                            left < right
                                                ? -1
                                                : 1;

                                        return order.direction ===
                                            "desc"
                                            ? -result
                                            : result;
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

                    const snapshots =
                        matching.map(
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
        };

        return query;
    }

    return {
        documents:
            documents,

        writes:
            writes,

        collection:
            function (collectionName) {
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

                                filters: [
                                    {
                                        field:
                                            field,

                                        operator:
                                            operator,

                                        value:
                                            value
                                    }
                                ]
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

                                ordering: [
                                    {
                                        field:
                                            field,

                                        direction:
                                            direction ||
                                            "asc"
                                    }
                                ]
                            });
                        },

                    get:
                        async function () {
                            const entries =
                                listCollectionDocuments(
                                    collectionName
                                );

                            const docs =
                                entries.map(
                                    function (entry) {
                                        return createSnapshot(
                                            entry.ref,
                                            entry.data
                                        );
                                    }
                                );

                            return {
                                size:
                                    docs.length,

                                empty:
                                    docs.length ===
                                    0,

                                docs:
                                    docs
                            };
                        }
                };
            },

        runTransaction:
            async function (callback) {
                const transaction = {
                    get:
                        async function (
                            reference
                        ) {
                            return reference.get();
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

                            documents.set(
                                reference.path,
                                options &&
                                options.merge
                                    ? mergeValue(
                                          existing,
                                          data
                                      )
                                    : cloneValue(
                                          data
                                      )
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
                                const error =
                                    new Error(
                                        "Document does not exist"
                                    );

                                error.code =
                                    "not-found";

                                throw error;
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

/* ==========================================================
   PROVIDER MOCK
========================================================== */

function createFetchResponse(options) {
    const settings =
        options || {};

    const headers =
        Object.keys(
            settings.headers || {}
        ).reduce(
            function (output, key) {
                output[
                    key.toLowerCase()
                ] =
                    settings.headers[key];

                return output;
            },
            {}
        );

    return {
        ok:
            settings.ok !== false,

        status:
            settings.status ||
            200,

        headers: {
            get:
                function (name) {
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
                    settings.body ===
                    undefined ||
                    settings.body ===
                    null
                ) {
                    return "";
                }

                return typeof settings.body ===
                    "string"
                    ? settings.body
                    : JSON.stringify(
                          settings.body
                      );
            }
    };
}

function mockPurchaseProviders() {
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
                    options || {}
            });

            if (
                url ===
                "https://api.paystack.co/transaction/initialize"
            ) {
                const payload =
                    JSON.parse(
                        options.body
                    );

                return createFetchResponse({
                    body: {
                        status:
                            true,

                        message:
                            "Authorization URL created",

                        data: {
                            authorization_url:
                                "https://checkout.paystack.com/full-flow",

                            access_code:
                                "access-full-flow",

                            reference:
                                payload.reference ||
                                "LET-PS-FULLFLOW"
                        }
                    }
                });
            }

            if (
                url.startsWith(
                    "https://api.paystack.co/transaction/verify/"
                )
            ) {
                const reference =
                    decodeURIComponent(
                        url.split("/").pop()
                    );

                return createFetchResponse({
                    body: {
                        status:
                            true,

                        data: {
                            id:
                                555001,

                            reference:
                                reference,

                            status:
                                "success",

                            amount:
                                32500000,

                            currency:
                                "NGN",

                            paid_at:
                                "2026-07-20T09:00:00.000Z",

                            gateway_response:
                                "Successful",

                            customer: {
                                email:
                                    "samuel@example.com"
                            },

                            authorization: {
                                authorization_code:
                                    "AUTH_PRIVATE",

                                reusable:
                                    false,

                                channel:
                                    "card",

                                card_type:
                                    "visa",

                                last4:
                                    "4081"
                            }
                        }
                    }
                });
            }

            if (
                url ===
                "https://api.resend.com/emails"
            ) {
                const payload =
                    JSON.parse(
                        options.body
                    );

                const typeTag =
                    (
                        payload.tags || []
                    ).find(
                        function (tag) {
                            return tag.name ===
                                "type";
                        }
                    );

                return createFetchResponse({
                    body: {
                        id:
                            "email-" +
                            (
                                typeTag
                                    ? typeTag.value
                                    : "message"
                            )
                    }
                });
            }

            throw new Error(
                "Unexpected provider URL: " +
                url
            );
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

/* ==========================================================
   FIXTURES
========================================================== */

function createCheckoutPayload() {
    return {
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

            postalCode:
                "100001",

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
            "WELCOME10",

        notes:
            "Please call on arrival.",

        idempotencyKey:
            "full-purchase-flow-001",

        items: [
            {
                productId:
                    "product-coat",

                variantId:
                    "black-medium",

                quantity:
                    1
            },

            {
                productId:
                    "product-bag",

                quantity:
                    1
            }
        ]
    };
}

function createInitialDocuments() {
    return {
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
                250000,

            inventory:
                4,

            stock:
                4,

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
                        250000,

                    inventory:
                        2,

                    stock:
                        2,

                    active:
                        true,

                    available:
                        true
                }
            ]
        },

        "products/product-bag": {
            name:
                "Leather Bag",

            slug:
                "leather-bag",

            sku:
                "BAG-001",

            active:
                true,

            published:
                true,

            price:
                100000,

            inventory:
                6,

            stock:
                6,

            images: [
                {
                    url:
                        "https://example.com/bag.jpg",

                    alt:
                        "Leather bag"
                }
            ],

            variants: []
        },

        "coupons/WELCOME10": {
            code:
                "WELCOME10",

            active:
                true,

            type:
                "percentage",

            value:
                10,

            minimumSubtotal:
                100000,

            maximumDiscount:
                50000,

            usageLimit:
                1000,

            usageCount:
                0
        }
    };
}

function getOrderEntry(database) {
    const entry =
        Array.from(
            database.documents.entries()
        ).find(
            function (document) {
                return document[0]
                    .startsWith(
                        "orders/"
                    );
            }
        );

    assert.ok(
        entry,
        "An order should have been created."
    );

    return {
        path:
            entry[0],

        id:
            entry[0].slice(
                "orders/".length
            ),

        data:
            entry[1]
    };
}

function parseProviderBody(call) {
    return call.options.body
        ? JSON.parse(
              call.options.body
          )
        : null;
}

/* ==========================================================
   COMPLETE PURCHASE FLOW
========================================================== */

test(
    "customer completes checkout, payment, notifications, and delivery",
    async function () {
        const db =
            createDatabase(
                createInitialDocuments()
            );

        const providers =
            mockPurchaseProviders();

        try {
            /*
             * Step 1: Customer submits checkout.
             */
            const checkout =
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

                            paymentProvider:
                                "paystack",

                            paystackSecretKey:
                                "paystack-secret"
                        }
                    });

            assert.equal(
                checkout.success,
                true
            );

            assert.equal(
                checkout.order.userId,
                "customer-1"
            );

            assert.equal(
                checkout.order.subtotal,
                350000
            );

            assert.equal(
                checkout.order.discount,
                35000
            );

            assert.equal(
                checkout.order.deliveryFee,
                10000
            );

            assert.equal(
                checkout.order.tax,
                0
            );

            assert.equal(
                checkout.order.total,
                325000
            );

            assert.equal(
                checkout.order.status,
                "pending"
            );

            assert.equal(
                checkout.order.paymentStatus,
                "pending"
            );

            assert.equal(
                checkout.payment.provider,
                "paystack"
            );

            assert.equal(
                checkout.payment.authorizationUrl,
                "https://checkout.paystack.com/full-flow"
            );

            const createdOrder =
                getOrderEntry(db);

            assert.equal(
                createdOrder.id,
                checkout.order.id
            );

            /*
             * Step 2: Inventory is reserved.
             */
            const coat =
                db.documents.get(
                    "products/product-coat"
                );

            const bag =
                db.documents.get(
                    "products/product-bag"
                );

            assert.equal(
                coat.inventory,
                3
            );

            assert.equal(
                coat.variants[0]
                    .inventory,
                1
            );

            assert.equal(
                bag.inventory,
                5
            );

            /*
             * Step 3: Payment provider verifies payment.
             */
            const paymentResult =
                await paymentService
                    .handleSuccessfulPayment({
                        db:
                            db,

                        provider:
                            "paystack",

                        reference:
                            checkout.payment
                                .reference,

                        webhookData: {
                            reference:
                                checkout.payment
                                    .reference,

                            metadata: {
                                orderId:
                                    checkout.order.id
                            }
                        },

                        configuration: {
                            paystackSecretKey:
                                "paystack-secret"
                        }
                    });

            assert.equal(
                paymentResult.orderId,
                checkout.order.id
            );

            assert.equal(
                paymentResult.duplicate,
                false
            );

            let storedOrder =
                db.documents.get(
                    createdOrder.path
                );

            assert.equal(
                storedOrder.paymentStatus,
                "paid"
            );

            assert.equal(
                storedOrder.status,
                "confirmed"
            );

            assert.equal(
                storedOrder.payment
                    .provider,
                "paystack"
            );

            assert.equal(
                storedOrder.payment
                    .providerTransactionId,
                "555001"
            );

            assert.equal(
                storedOrder.payment
                    .authorization.last4,
                "4081"
            );

            assert.equal(
                storedOrder.payment
                    .authorization
                    .authorizationCode,
                undefined
            );

            /*
             * Step 4: Order confirmation is emailed.
             */
            const confirmation =
                await emailService
                    .sendOrderConfirmation({
                        order:
                            Object.assign(
                                {
                                    id:
                                        checkout.order.id
                                },
                                storedOrder
                            ),

                        configuration: {
                            provider:
                                "resend",

                            apiKey:
                                "email-api-key",

                            from:
                                "orders@example.com",

                            storeName:
                                "L'ÉTERNEL",

                            appOrigin:
                                "https://shop.example.com"
                        }
                    });

            assert.equal(
                confirmation.success,
                true
            );

            assert.equal(
                confirmation.messageId,
                "email-order-confirmation"
            );

            /*
             * Step 5: Payment receipt is emailed.
             */
            const receipt =
                await emailService
                    .sendPaymentReceipt({
                        order:
                            Object.assign(
                                {
                                    id:
                                        checkout.order.id
                                },
                                storedOrder
                            ),

                        configuration: {
                            provider:
                                "resend",

                            apiKey:
                                "email-api-key",

                            from:
                                "orders@example.com",

                            storeName:
                                "L'ÉTERNEL",

                            appOrigin:
                                "https://shop.example.com"
                        }
                    });

            assert.equal(
                receipt.success,
                true
            );

            assert.equal(
                receipt.messageId,
                "email-payment-receipt"
            );

            /*
             * Step 6: Administrator begins fulfillment.
             */
            const processing =
                await orderService
                    .updateOrderStatus({
                        db:
                            db,

                        orderId:
                            checkout.order.id,

                        status:
                            "processing",

                        administrator: {
                            uid:
                                "admin-1",

                            email:
                                "admin@example.com",

                            role:
                                "admin"
                        },

                        note:
                            "Order is being prepared."
                    });

            assert.equal(
                processing.status,
                "processing"
            );

            /*
             * Step 7: Order ships with tracking details.
             */
            const shipped =
                await orderService
                    .updateOrderStatus({
                        db:
                            db,

                        orderId:
                            checkout.order.id,

                        status:
                            "shipped",

                        administrator: {
                            uid:
                                "admin-1",

                            email:
                                "admin@example.com",

                            role:
                                "admin"
                        },

                        note:
                            "Dispatched to courier.",

                        tracking: {
                            carrier:
                                "DHL",

                            trackingNumber:
                                "DHL-LETERNEL-001",

                            trackingUrl:
                                "https://example.com/track/DHL-LETERNEL-001"
                        }
                    });

            assert.equal(
                shipped.status,
                "shipped"
            );

            storedOrder =
                db.documents.get(
                    createdOrder.path
                );

            const shippingEmail =
                await emailService
                    .sendOrderStatusUpdate({
                        order:
                            Object.assign(
                                {
                                    id:
                                        checkout.order.id
                                },
                                storedOrder
                            ),

                        configuration: {
                            provider:
                                "resend",

                            apiKey:
                                "email-api-key",

                            from:
                                "orders@example.com",

                            storeName:
                                "L'ÉTERNEL",

                            appOrigin:
                                "https://shop.example.com"
                        }
                    });

            assert.equal(
                shippingEmail.success,
                true
            );

            /*
             * Step 8: Order is delivered.
             */
            const delivered =
                await orderService
                    .updateOrderStatus({
                        db:
                            db,

                        orderId:
                            checkout.order.id,

                        status:
                            "delivered",

                        administrator: {
                            uid:
                                "admin-1",

                            email:
                                "admin@example.com",

                            role:
                                "admin"
                        },

                        note:
                            "Order delivered successfully."
                    });

            assert.equal(
                delivered.status,
                "delivered"
            );

            storedOrder =
                db.documents.get(
                    createdOrder.path
                );

            assert.equal(
                storedOrder.status,
                "delivered"
            );

            assert.equal(
                storedOrder.paymentStatus,
                "paid"
            );

            assert.equal(
                storedOrder.tracking
                    .carrier,
                "DHL"
            );

            assert.equal(
                storedOrder.tracking
                    .trackingNumber,
                "DHL-LETERNEL-001"
            );

            assert.deepEqual(
                storedOrder.statusHistory
                    .slice(-3)
                    .map(
                        function (entry) {
                            return entry.status;
                        }
                    ),
                [
                    "processing",
                    "shipped",
                    "delivered"
                ]
            );

            /*
             * Step 9: Customer order history returns the order.
             */
            const customerOrder =
                await orderService
                    .getCustomerOrder({
                        db:
                            db,

                        userId:
                            "customer-1",

                        orderId:
                            checkout.order.id
                    });

            assert.equal(
                customerOrder.id,
                checkout.order.id
            );

            assert.equal(
                customerOrder.status,
                "delivered"
            );

            assert.equal(
                customerOrder.paymentStatus,
                "paid"
            );

            /*
             * Step 10: Provider interactions are complete.
             */
            const paystackInitialization =
                providers.calls.find(
                    function (call) {
                        return call.url ===
                            "https://api.paystack.co/transaction/initialize";
                    }
                );

            assert.ok(
                paystackInitialization
            );

            const initializationPayload =
                parseProviderBody(
                    paystackInitialization
                );

            assert.equal(
                initializationPayload.amount,
                "32500000"
            );

            assert.equal(
                initializationPayload.currency,
                "NGN"
            );

            assert.equal(
                initializationPayload.email,
                "samuel@example.com"
            );

            const verificationCall =
                providers.calls.find(
                    function (call) {
                        return call.url
                            .startsWith(
                                "https://api.paystack.co/transaction/verify/"
                            );
                    }
                );

            assert.ok(
                verificationCall
            );

            const emailCalls =
                providers.calls.filter(
                    function (call) {
                        return call.url ===
                            "https://api.resend.com/emails";
                    }
                );

            assert.equal(
                emailCalls.length,
                3
            );

            const emailTypes =
                emailCalls.map(
                    function (call) {
                        const payload =
                            parseProviderBody(
                                call
                            );

                        const tag =
                            payload.tags.find(
                                function (item) {
                                    return item.name ===
                                        "type";
                                }
                            );

                        return tag.value;
                    }
                );

            assert.deepEqual(
                emailTypes,
                [
                    "order-confirmation",
                    "payment-receipt",
                    "order-status"
                ]
            );
        } finally {
            providers.restore();
        }
    }
);

/* ==========================================================
   IDEMPOTENT CHECKOUT
========================================================== */

test(
    "repeated checkout does not reserve inventory or charge twice",
    async function () {
        const db =
            createDatabase(
                createInitialDocuments()
            );

        const providers =
            mockPurchaseProviders();

        try {
            const options = {
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

                    paymentProvider:
                        "paystack",

                    paystackSecretKey:
                        "paystack-secret"
                }
            };

            const first =
                await orderService
                    .createOrder(options);

            const second =
                await orderService
                    .createOrder(options);

            assert.equal(
                second.duplicate,
                true
            );

            assert.equal(
                second.order.id,
                first.order.id
            );

            const coat =
                db.documents.get(
                    "products/product-coat"
                );

            const bag =
                db.documents.get(
                    "products/product-bag"
                );

            assert.equal(
                coat.inventory,
                3
            );

            assert.equal(
                coat.variants[0]
                    .inventory,
                1
            );

            assert.equal(
                bag.inventory,
                5
            );

            const initializationCalls =
                providers.calls.filter(
                    function (call) {
                        return call.url ===
                            "https://api.paystack.co/transaction/initialize";
                    }
                );

            assert.equal(
                initializationCalls.length,
                1
            );

            const orderDocuments =
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
                orderDocuments.length,
                1
            );
        } finally {
            providers.restore();
        }
    }
);

/* ==========================================================
   PAYMENT VERIFICATION SAFETY
========================================================== */

test(
    "payment amount mismatch leaves the order unpaid",
    async function () {
        const db =
            createDatabase(
                mergeValue(
                    createInitialDocuments(),
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

                            total:
                                400000,

                            currency:
                                "NGN",

                            paymentReference:
                                "LET-PS-FULLFLOW",

                            customer: {
                                email:
                                    "samuel@example.com"
                            }
                        }
                    }
                )
            );

        const providers =
            mockPurchaseProviders();

        try {
            await assert.rejects(
                paymentService
                    .handleSuccessfulPayment({
                        db:
                            db,

                        provider:
                            "paystack",

                        reference:
                            "LET-PS-FULLFLOW",

                        webhookData: {
                            reference:
                                "LET-PS-FULLFLOW",

                            metadata: {
                                orderId:
                                    "order-1"
                            }
                        },

                        configuration: {
                            paystackSecretKey:
                                "paystack-secret"
                        }
                    }),
                function (error) {
                    assert.equal(
                        error.code,
                        "failed-precondition"
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

            assert.equal(
                order.paymentStatus,
                "pending"
            );
        } finally {
            providers.restore();
        }
    }
);

/* ==========================================================
   CANCELLATION BEFORE PAYMENT
========================================================== */

test(
    "cancelled unpaid checkout restores every reserved item",
    async function () {
        const db =
            createDatabase({
                "products/product-coat": {
                    name:
                        "Signature Coat",

                    inventory:
                        3,

                    stock:
                        3,

                    variants: [
                        {
                            id:
                                "black-medium",

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
                },

                "products/product-bag": {
                    name:
                        "Leather Bag",

                    inventory:
                        5,

                    stock:
                        5,

                    variants: []
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
                                1
                        },

                        {
                            productId:
                                "product-bag",

                            variantId:
                                "",

                            quantity:
                                1
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
                        "Changed my mind."
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
            order.inventoryRestored,
            true
        );

        assert.equal(
            db.documents.get(
                "products/product-coat"
            ).inventory,
            4
        );

        assert.equal(
            db.documents.get(
                "products/product-coat"
            ).variants[0].inventory,
            2
        );

        assert.equal(
            db.documents.get(
                "products/product-bag"
            ).inventory,
            6
        );
    }
);