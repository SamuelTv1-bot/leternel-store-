"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   PAYMENT WEBHOOK INTEGRATION TESTS
========================================================== */

const crypto = require("node:crypto");
const test = require("node:test");
const assert = require("node:assert/strict");

const paymentService = require(
    "../../src/payments/payment-service"
);

/* ==========================================================
   GENERIC HELPERS
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
        const path =
            collectionName +
            "/" +
            documentId;

        const reference = {
            id:
                documentId,

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
                        throw new Error(
                            "Document does not exist"
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
                                throw new Error(
                                    "Document does not exist"
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

        limit:
            function (value) {
                maximum =
                    Number(value);

                return query;
            },

        get:
            async function () {
                const prefix =
                    options.collectionName +
                    "/";

                let matching =
                    Array.from(
                        options.documents.entries()
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
                        .filter(
                            function (entry) {
                                return filters.every(
                                    function (filter) {
                                        const actual =
                                            resolveNestedField(
                                                entry[1],
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

                                        throw new Error(
                                            "Unsupported operator: " +
                                            filter.operator
                                        );
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

                const docs =
                    matching.map(
                        function (entry) {
                            const id =
                                entry[0].slice(
                                    prefix.length
                                );

                            const reference =
                                options
                                    .createDocumentReference(
                                        options.collectionName,
                                        id
                                    );

                            return createSnapshot(
                                reference,
                                entry[1]
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

    return query;
}

function mockFetch(responseFactory) {
    const originalFetch =
        global.fetch;

    const calls = [];

    global.fetch =
        async function (url, options) {
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

/* ==========================================================
   WEBHOOK REQUEST HELPERS
========================================================== */

function createRequest(options) {
    const settings =
        options || {};

    const headers =
        Object.keys(
            settings.headers || {}
        ).reduce(
            function (
                output,
                key
            ) {
                output[
                    key.toLowerCase()
                ] =
                    settings.headers[key];

                return output;
            },
            {}
        );

    return {
        method:
            "POST",

        headers:
            headers,

        body:
            settings.body,

        rawBody:
            settings.rawBody,

        get:
            function (name) {
                return headers[
                    String(name)
                        .toLowerCase()
                ];
            },

        header:
            function (name) {
                return headers[
                    String(name)
                        .toLowerCase()
                ];
            }
    };
}

function createPaystackRequest(
    payload,
    secret
) {
    const rawBody =
        Buffer.from(
            JSON.stringify(payload),
            "utf8"
        );

    const signature =
        crypto
            .createHmac(
                "sha512",
                secret
            )
            .update(rawBody)
            .digest("hex");

    return createRequest({
        body:
            payload,

        rawBody:
            rawBody,

        headers: {
            "x-paystack-signature":
                signature
        }
    });
}

function createFlutterwaveRequest(
    payload,
    secret
) {
    const rawBody =
        Buffer.from(
            JSON.stringify(payload),
            "utf8"
        );

    const signature =
        crypto
            .createHmac(
                "sha256",
                secret
            )
            .update(rawBody)
            .digest("base64");

    return createRequest({
        body:
            payload,

        rawBody:
            rawBody,

        headers: {
            "flutterwave-signature":
                signature
        }
    });
}

/* ==========================================================
   PROVIDER DETECTION
========================================================== */

test(
    "processWebhook detects and processes Paystack requests",
    async function () {
        const secret =
            "paystack-webhook-secret";

        const db =
            createDatabase();

        const payload = {
            event:
                "subscription.create",

            data: {
                id:
                    1001,

                reference:
                    "LET-PS-IGNORED"
            }
        };

        const result =
            await paymentService
                .processWebhook({
                    db:
                        db,

                    request:
                        createPaystackRequest(
                            payload,
                            secret
                        ),

                    configuration: {
                        paystackWebhookSecret:
                            secret
                    }
                });

        assert.equal(
            result.provider,
            "paystack"
        );

        assert.equal(
            result.ignored,
            true
        );
    }
);

test(
    "processWebhook detects and processes Flutterwave requests",
    async function () {
        const secret =
            "flutterwave-webhook-secret";

        const db =
            createDatabase();

        const payload = {
            event:
                "subscription.created",

            data: {
                id:
                    2001,

                tx_ref:
                    "LET-FW-IGNORED"
            }
        };

        const result =
            await paymentService
                .processWebhook({
                    db:
                        db,

                    request:
                        createFlutterwaveRequest(
                            payload,
                            secret
                        ),

                    configuration: {
                        flutterwaveWebhookSecret:
                            secret
                    }
                });

        assert.equal(
            result.provider,
            "flutterwave"
        );

        assert.equal(
            result.ignored,
            true
        );
    }
);

/* ==========================================================
   SIGNATURE VALIDATION
========================================================== */

test(
    "Paystack webhook rejects a modified request body",
    async function () {
        const secret =
            "paystack-webhook-secret";

        const signedPayload = {
            event:
                "charge.success",

            data: {
                reference:
                    "LET-PS-SIGNED"
            }
        };

        const request =
            createPaystackRequest(
                signedPayload,
                secret
            );

        request.body = {
            event:
                "charge.success",

            data: {
                reference:
                    "LET-PS-TAMPERED"
            }
        };

        request.rawBody =
            Buffer.from(
                JSON.stringify(
                    request.body
                ),
                "utf8"
            );

        await assert.rejects(
            paymentService
                .processWebhook({
                    db:
                        createDatabase(),

                    request:
                        request,

                    configuration: {
                        paystackWebhookSecret:
                            secret
                    }
                }),
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-signature"
                );

                return true;
            }
        );
    }
);

test(
    "Flutterwave webhook rejects an invalid signature",
    async function () {
        const request =
            createRequest({
                body: {
                    event:
                        "charge.completed",

                    data: {
                        tx_ref:
                            "LET-FW-INVALID"
                    }
                },

                rawBody:
                    Buffer.from(
                        JSON.stringify({
                            event:
                                "charge.completed",

                            data: {
                                tx_ref:
                                    "LET-FW-INVALID"
                            }
                        }),
                        "utf8"
                    ),

                headers: {
                    "flutterwave-signature":
                        "invalid-signature"
                }
            });

        await assert.rejects(
            paymentService
                .processWebhook({
                    db:
                        createDatabase(),

                    request:
                        request,

                    configuration: {
                        flutterwaveWebhookSecret:
                            "correct-secret"
                    }
                }),
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-signature"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   IGNORED EVENTS
========================================================== */

test(
    "unsupported Paystack event is recorded as processed and ignored",
    async function () {
        const secret =
            "paystack-webhook-secret";

        const db =
            createDatabase();

        const payload = {
            event:
                "subscription.create",

            data: {
                id:
                    3001,

                reference:
                    "LET-PS-SUBSCRIPTION"
            }
        };

        const result =
            await paymentService
                .processPaystackWebhook({
                    db:
                        db,

                    request:
                        createPaystackRequest(
                            payload,
                            secret
                        ),

                    configuration: {
                        paystackWebhookSecret:
                            secret
                    }
                });

        assert.equal(
            result.ignored,
            true
        );

        assert.equal(
            result.duplicate,
            false
        );

        const webhookDocuments =
            Array.from(
                db.documents.entries()
            ).filter(
                function (entry) {
                    return entry[0]
                        .startsWith(
                            "paymentWebhookEvents/"
                        );
                }
            );

        assert.equal(
            webhookDocuments.length,
            1
        );

        assert.equal(
            webhookDocuments[0][1]
                .processed,
            true
        );

        assert.equal(
            webhookDocuments[0][1]
                .ignored,
            true
        );

        assert.equal(
            webhookDocuments[0][1]
                .provider,
            "paystack"
        );
    }
);

/* ==========================================================
   DUPLICATE SUPPRESSION
========================================================== */

test(
    "repeated Paystack event is processed only once",
    async function () {
        const secret =
            "paystack-webhook-secret";

        const db =
            createDatabase();

        const payload = {
            event:
                "subscription.create",

            data: {
                id:
                    4001,

                reference:
                    "LET-PS-DUPLICATE"
            }
        };

        const first =
            await paymentService
                .processPaystackWebhook({
                    db:
                        db,

                    request:
                        createPaystackRequest(
                            payload,
                            secret
                        ),

                    configuration: {
                        paystackWebhookSecret:
                            secret
                    }
                });

        const second =
            await paymentService
                .processPaystackWebhook({
                    db:
                        db,

                    request:
                        createPaystackRequest(
                            payload,
                            secret
                        ),

                    configuration: {
                        paystackWebhookSecret:
                            secret
                    }
                });

        assert.equal(
            first.duplicate,
            false
        );

        assert.equal(
            second.duplicate,
            true
        );

        const webhookDocuments =
            Array.from(
                db.documents.keys()
            ).filter(
                function (path) {
                    return path.startsWith(
                        "paymentWebhookEvents/"
                    );
                }
            );

        assert.equal(
            webhookDocuments.length,
            1
        );
    }
);

test(
    "existing processed event returns its stored order identifier",
    async function () {
        const secret =
            "paystack-webhook-secret";

        const payload = {
            event:
                "charge.success",

            data: {
                id:
                    5001,

                reference:
                    "LET-PS-EXISTING"
            }
        };

        const eventId =
            paymentService
                ._internal
                .createWebhookEventId({
                    provider:
                        "paystack",

                    eventType:
                        "charge.success",

                    reference:
                        "LET-PS-EXISTING",

                    providerId:
                        "5001"
                });

        const db =
            createDatabase({
                [
                    "paymentWebhookEvents/" +
                    eventId
                ]: {
                    processed:
                        true,

                    provider:
                        "paystack",

                    eventType:
                        "charge.success",

                    orderId:
                        "order-existing"
                }
            });

        const result =
            await paymentService
                .processPaystackWebhook({
                    db:
                        db,

                    request:
                        createPaystackRequest(
                            payload,
                            secret
                        ),

                    configuration: {
                        paystackWebhookSecret:
                            secret
                    }
                });

        assert.equal(
            result.duplicate,
            true
        );

        assert.equal(
            result.orderId,
            "order-existing"
        );
    }
);

/* ==========================================================
   PAYSTACK SUCCESS
========================================================== */

test(
    "Paystack charge.success verifies and confirms the order",
    async function () {
        const webhookSecret =
            "paystack-webhook-secret";

        const providerSecret =
            "paystack-provider-secret";

        const reference =
            "LET-PS-SUCCESS";

        const db =
            createDatabase({
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
                        245000,

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
            });

        const fetchMock =
            mockFetch({
                body: {
                    status:
                        true,

                    data: {
                        id:
                            6001,

                        reference:
                            reference,

                        status:
                            "success",

                        amount:
                            24500000,

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

        try {
            const payload = {
                event:
                    "charge.success",

                data: {
                    id:
                        6001,

                    reference:
                        reference,

                    metadata: {
                        orderId:
                            "order-1"
                    }
                }
            };

            const result =
                await paymentService
                    .processPaystackWebhook({
                        db:
                            db,

                        request:
                            createPaystackRequest(
                                payload,
                                webhookSecret
                            ),

                        configuration: {
                            paystackWebhookSecret:
                                webhookSecret,

                            paystackSecretKey:
                                providerSecret
                        }
                    });

            assert.equal(
                result.duplicate,
                false
            );

            assert.equal(
                result.orderId,
                "order-1"
            );

            const order =
                db.documents.get(
                    "orders/order-1"
                );

            assert.equal(
                order.status,
                "confirmed"
            );

            assert.equal(
                order.paymentStatus,
                "paid"
            );

            assert.equal(
                order.payment
                    .providerTransactionId,
                "6001"
            );

            assert.equal(
                order.payment
                    .authorization.last4,
                "4081"
            );

            assert.equal(
                order.payment
                    .authorization
                    .authorizationCode,
                undefined
            );

            assert.equal(
                fetchMock.calls.length,
                1
            );

            assert.equal(
                fetchMock.calls[0].url,
                "https://api.paystack.co/transaction/verify/" +
                    reference
            );

            const webhookDocument =
                Array.from(
                    db.documents.entries()
                ).find(
                    function (entry) {
                        return entry[0]
                            .startsWith(
                                "paymentWebhookEvents/"
                            );
                    }
                );

            assert.equal(
                webhookDocument[1]
                    .processed,
                true
            );

            assert.equal(
                webhookDocument[1]
                    .orderId,
                "order-1"
            );
        } finally {
            fetchMock.restore();
        }
    }
);

/* ==========================================================
   PAYSTACK FAILURE
========================================================== */

test(
    "Paystack charge.failed marks an unpaid order as failed",
    async function () {
        const webhookSecret =
            "paystack-webhook-secret";

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
                        245000,

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

        const payload = {
            event:
                "charge.failed",

            data: {
                id:
                    7001,

                reference:
                    reference,

                status:
                    "failed",

                gateway_response:
                    "Declined",

                metadata: {
                    orderId:
                        "order-1"
                }
            }
        };

        const result =
            await paymentService
                .processPaystackWebhook({
                    db:
                        db,

                    request:
                        createPaystackRequest(
                            payload,
                            webhookSecret
                        ),

                    configuration: {
                        paystackWebhookSecret:
                            webhookSecret
                    }
                });

        assert.equal(
            result.orderId,
            "order-1"
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
            order.payment
                .gatewayResponse,
            "Declined"
        );
    }
);

test(
    "failed Paystack event cannot overwrite an already-paid order",
    async function () {
        const webhookSecret =
            "paystack-webhook-secret";

        const reference =
            "LET-PS-PAID";

        const db =
            createDatabase({
                "orders/order-1": {
                    userId:
                        "customer-1",

                    status:
                        "confirmed",

                    paymentStatus:
                        "paid",

                    total:
                        245000,

                    currency:
                        "NGN",

                    paymentReference:
                        reference
                }
            });

        const payload = {
            event:
                "charge.failed",

            data: {
                id:
                    7002,

                reference:
                    reference,

                status:
                    "failed",

                gateway_response:
                    "Late failure"
            }
        };

        const result =
            await paymentService
                .processPaystackWebhook({
                    db:
                        db,

                    request:
                        createPaystackRequest(
                            payload,
                            webhookSecret
                        ),

                    configuration: {
                        paystackWebhookSecret:
                            webhookSecret
                    }
                });

        assert.equal(
            result.ignored,
            true
        );

        const order =
            db.documents.get(
                "orders/order-1"
            );

        assert.equal(
            order.status,
            "confirmed"
        );

        assert.equal(
            order.paymentStatus,
            "paid"
        );
    }
);

/* ==========================================================
   FLUTTERWAVE SUCCESS
========================================================== */

test(
    "Flutterwave charge.completed verifies and confirms an order",
    async function () {
        const webhookSecret =
            "flutterwave-webhook-secret";

        const providerSecret =
            "flutterwave-provider-secret";

        const reference =
            "LET-FW-SUCCESS";

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
                        125000,

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
                            "flutterwave",

                        providerReference:
                            reference
                    }
                }
            });

        const fetchMock =
            mockFetch({
                body: {
                    status:
                        "success",

                    data: {
                        id:
                            8001,

                        tx_ref:
                            reference,

                        status:
                            "successful",

                        charged_amount:
                            125000,

                        amount:
                            125000,

                        currency:
                            "NGN",

                        created_at:
                            "2026-07-20T08:30:00.000Z",

                        processor_response:
                            "Approved",

                        payment_type:
                            "card",

                        customer: {
                            email:
                                "samuel@example.com"
                        },

                        card: {
                            first_6digits:
                                "539983",

                            last_4digits:
                                "8381",

                            issuer:
                                "MASTERCARD"
                        }
                    }
                }
            });

        try {
            const payload = {
                event:
                    "charge.completed",

                data: {
                    id:
                        8001,

                    tx_ref:
                        reference,

                    status:
                        "successful",

                    meta: {
                        orderId:
                            "order-1"
                    }
                }
            };

            const result =
                await paymentService
                    .processFlutterwaveWebhook({
                        db:
                            db,

                        request:
                            createFlutterwaveRequest(
                                payload,
                                webhookSecret
                            ),

                        configuration: {
                            flutterwaveWebhookSecret:
                                webhookSecret,

                            flutterwaveSecretKey:
                                providerSecret
                        }
                    });

            assert.equal(
                result.orderId,
                "order-1"
            );

            const order =
                db.documents.get(
                    "orders/order-1"
                );

            assert.equal(
                order.status,
                "confirmed"
            );

            assert.equal(
                order.paymentStatus,
                "paid"
            );

            assert.equal(
                order.payment
                    .provider,
                "flutterwave"
            );

            assert.equal(
                order.payment
                    .authorization.last4,
                "8381"
            );

            assert.equal(
                fetchMock.calls.length,
                1
            );

            assert.equal(
                fetchMock.calls[0].url,
                "https://api.flutterwave.com/v3/transactions/8001/verify"
            );
        } finally {
            fetchMock.restore();
        }
    }
);

/* ==========================================================
   FLUTTERWAVE LEGACY HASH
========================================================== */

test(
    "Flutterwave legacy verif-hash authenticates a webhook",
    async function () {
        const secret =
            "legacy-flutterwave-secret";

        const payload = {
            event:
                "subscription.created",

            data: {
                id:
                    9001,

                tx_ref:
                    "LET-FW-LEGACY"
            }
        };

        const rawBody =
            Buffer.from(
                JSON.stringify(payload),
                "utf8"
            );

        const request =
            createRequest({
                body:
                    payload,

                rawBody:
                    rawBody,

                headers: {
                    "verif-hash":
                        secret
                }
            });

        const result =
            await paymentService
                .processFlutterwaveWebhook({
                    db:
                        createDatabase(),

                    request:
                        request,

                    configuration: {
                        flutterwaveWebhookSecret:
                            secret
                    }
                });

        assert.equal(
            result.ignored,
            true
        );

        assert.equal(
            result.provider,
            "flutterwave"
        );
    }
);

/* ==========================================================
   REFUND EVENTS
========================================================== */

test(
    "Paystack refund event marks a paid order as refunded",
    async function () {
        const webhookSecret =
            "paystack-webhook-secret";

        const reference =
            "LET-PS-REFUND";

        const db =
            createDatabase({
                "orders/order-1": {
                    userId:
                        "customer-1",

                    status:
                        "confirmed",

                    paymentStatus:
                        "paid",

                    total:
                        245000,

                    currency:
                        "NGN",

                    paymentReference:
                        reference
                }
            });

        const payload = {
            event:
                "refund.processed",

            data: {
                id:
                    "refund-1001",

                transaction: {
                    reference:
                        reference
                },

                status:
                    "processed"
            }
        };

        const result =
            await paymentService
                .processPaystackWebhook({
                    db:
                        db,

                    request:
                        createPaystackRequest(
                            payload,
                            webhookSecret
                        ),

                    configuration: {
                        paystackWebhookSecret:
                            webhookSecret
                    }
                });

        assert.equal(
            result.orderId,
            "order-1"
        );

        const order =
            db.documents.get(
                "orders/order-1"
            );

        assert.equal(
            order.status,
            "refunded"
        );

        assert.equal(
            order.paymentStatus,
            "refunded"
        );

        assert.equal(
            order.payment
                .refund
                .providerRefundId,
            "refund-1001"
        );
    }
);

/* ==========================================================
   VERIFICATION FAILURES
========================================================== */

test(
    "successful webhook rejects a provider amount mismatch",
    async function () {
        const webhookSecret =
            "paystack-webhook-secret";

        const reference =
            "LET-PS-AMOUNT-MISMATCH";

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
                        245000,

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

        const fetchMock =
            mockFetch({
                body: {
                    status:
                        true,

                    data: {
                        id:
                            10001,

                        reference:
                            reference,

                        status:
                            "success",

                        amount:
                            100,

                        currency:
                            "NGN",

                        customer: {
                            email:
                                "samuel@example.com"
                        }
                    }
                }
            });

        try {
            const payload = {
                event:
                    "charge.success",

                data: {
                    id:
                        10001,

                    reference:
                        reference,

                    metadata: {
                        orderId:
                            "order-1"
                    }
                }
            };

            await assert.rejects(
                paymentService
                    .processPaystackWebhook({
                        db:
                            db,

                        request:
                            createPaystackRequest(
                                payload,
                                webhookSecret
                            ),

                        configuration: {
                            paystackWebhookSecret:
                                webhookSecret,

                            paystackSecretKey:
                                "provider-secret"
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
            fetchMock.restore();
        }
    }
);

test(
    "successful webhook rejects a customer email mismatch",
    async function () {
        const webhookSecret =
            "paystack-webhook-secret";

        const reference =
            "LET-PS-EMAIL-MISMATCH";

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
                        1000,

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

        const fetchMock =
            mockFetch({
                body: {
                    status:
                        true,

                    data: {
                        id:
                            10002,

                        reference:
                            reference,

                        status:
                            "success",

                        amount:
                            100000,

                        currency:
                            "NGN",

                        customer: {
                            email:
                                "attacker@example.com"
                        }
                    }
                }
            });

        try {
            const payload = {
                event:
                    "charge.success",

                data: {
                    id:
                        10002,

                    reference:
                        reference,

                    metadata: {
                        orderId:
                            "order-1"
                    }
                }
            };

            await assert.rejects(
                paymentService
                    .processPaystackWebhook({
                        db:
                            db,

                        request:
                            createPaystackRequest(
                                payload,
                                webhookSecret
                            ),

                        configuration: {
                            paystackWebhookSecret:
                                webhookSecret,

                            paystackSecretKey:
                                "provider-secret"
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
                order.paymentStatus,
                "pending"
            );
        } finally {
            fetchMock.restore();
        }
    }
);

/* ==========================================================
   UNKNOWN ORDER
========================================================== */

test(
    "payment event for an unknown order is rejected safely",
    async function () {
        const webhookSecret =
            "paystack-webhook-secret";

        const payload = {
            event:
                "charge.failed",

            data: {
                id:
                    11001,

                reference:
                    "LET-PS-UNKNOWN",

                status:
                    "failed"
            }
        };

        await assert.rejects(
            paymentService
                .processPaystackWebhook({
                    db:
                        createDatabase(),

                    request:
                        createPaystackRequest(
                            payload,
                            webhookSecret
                        ),

                    configuration: {
                        paystackWebhookSecret:
                            webhookSecret
                    }
                }),
            function (error) {
                assert.equal(
                    error.code,
                    "order-not-found"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   SANITIZED WEBHOOK STORAGE
========================================================== */

test(
    "stored webhook payload excludes card and authorization secrets",
    async function () {
        const webhookSecret =
            "paystack-webhook-secret";

        const db =
            createDatabase();

        const payload = {
            event:
                "subscription.create",

            data: {
                id:
                    12001,

                reference:
                    "LET-PS-SANITIZED",

                authorization_code:
                    "AUTH_SECRET",

                token:
                    "TOKEN_SECRET",

                card: {
                    number:
                        "4084084084084081",

                    cvv:
                        "123"
                },

                customer: {
                    email:
                        "samuel@example.com"
                }
            }
        };

        await paymentService
            .processPaystackWebhook({
                db:
                    db,

                request:
                    createPaystackRequest(
                        payload,
                        webhookSecret
                    ),

                configuration: {
                    paystackWebhookSecret:
                        webhookSecret
                }
            });

        const webhookDocument =
            Array.from(
                db.documents.entries()
            ).find(
                function (entry) {
                    return entry[0]
                        .startsWith(
                            "paymentWebhookEvents/"
                        );
                }
            )[1];

        const storedPayload =
            webhookDocument.payload;

        assert.equal(
            storedPayload.data
                .authorization_code,
            undefined
        );

        assert.equal(
            storedPayload.data.token,
            undefined
        );

        assert.equal(
            storedPayload.data.card,
            undefined
        );

        assert.equal(
            storedPayload.data
                .reference,
            "LET-PS-SANITIZED"
        );

        assert.equal(
            storedPayload.data
                .customer.email,
            "samuel@example.com"
        );
    }
);