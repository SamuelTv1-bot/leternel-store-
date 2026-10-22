"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   PAYMENT SERVICE TESTS
========================================================== */

const crypto = require("crypto");
const test = require("node:test");

const assert = require(
    "node:assert/strict"
);

const {
    Timestamp
} = require(
    "firebase-admin/firestore"
);

const paymentService = require(
    "../src/payments/payment-service"
);

/* ==========================================================
   HELPERS
========================================================== */

function createRequest(options) {
    const settings =
        options || {};

    const body =
        settings.body || {};

    const rawBody =
        settings.rawBody ||
        Buffer.from(
            JSON.stringify(body),
            "utf8"
        );

    return {
        headers:
            normalizeHeaders(
                settings.headers || {}
            ),

        body:
            body,

        rawBody:
            rawBody,

        method:
            settings.method ||
            "POST"
    };
}

function normalizeHeaders(headers) {
    return Object.keys(headers).reduce(
        function (output, key) {
            output[
                key.toLowerCase()
            ] = headers[key];

            return output;
        },
        {}
    );
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

function createDocumentReference(
    path
) {
    const writes = [];

    return {
        path:
            path,

        writes:
            writes,

        set:
            async function (
                data,
                options
            ) {
                writes.push({
                    data:
                        data,
                    options:
                        options || null
                });
            }
    };
}

function createWebhookDatabase(
    options
) {
    const settings =
        options || {};

    const webhookDocuments =
        new Map();

    const orderReference =
        createDocumentReference(
            "orders/order-1"
        );

    const orderData =
        settings.order || {
            orderNumber:
                "LET-20260719-ORDER001",

            total:
                120000,

            currency:
                "NGN",

            customer: {
                email:
                    "customer@example.com"
            },

            status:
                "pending",

            paymentStatus:
                "pending",

            paymentReference:
                "LET-PS-REFERENCE",

            payment: {
                providerReference:
                    "LET-PS-REFERENCE"
            }
        };

    const orderSnapshot = {
        id:
            "order-1",

        exists:
            true,

        ref:
            orderReference,

        data:
            function () {
                return orderData;
            },

        get:
            function (field) {
                return orderData[field];
            }
    };

    const db = {
        collection:
            function (
                collectionName
            ) {
                if (
                    collectionName ===
                    "paymentWebhookEvents"
                ) {
                    return {
                        doc:
                            function (
                                documentId
                            ) {
                                if (
                                    !webhookDocuments.has(
                                        documentId
                                    )
                                ) {
                                    webhookDocuments.set(
                                        documentId,
                                        createWebhookDocument(
                                            documentId
                                        )
                                    );
                                }

                                return webhookDocuments.get(
                                    documentId
                                );
                            }
                    };
                }

                if (
                    collectionName ===
                    "orders"
                ) {
                    return {
                        doc:
                            function (
                                documentId
                            ) {
                                assert.equal(
                                    documentId,
                                    "order-1"
                                );

                                return {
                                    get:
                                        async function () {
                                            return orderSnapshot;
                                        }
                                };
                            },

                        where:
                            function (
                                field,
                                operator,
                                value
                            ) {
                                assert.equal(
                                    operator,
                                    "=="
                                );

                                return createOrderQuery({
                                    field:
                                        field,
                                    value:
                                        value,
                                    orderSnapshot:
                                        orderSnapshot
                                });
                            }
                    };
                }

                throw new Error(
                    "Unexpected collection: " +
                    collectionName
                );
            },

        runTransaction:
            async function (
                callback
            ) {
                const transactionWrites =
                    [];

                const transaction = {
                    get:
                        async function () {
                            return orderSnapshot;
                        },

                    set:
                        function (
                            reference,
                            data,
                            options
                        ) {
                            transactionWrites.push({
                                reference:
                                    reference,
                                data:
                                    data,
                                options:
                                    options
                            });

                            reference.writes.push({
                                data:
                                    data,
                                options:
                                    options
                            });
                        }
                };

                const result =
                    await callback(
                        transaction
                    );

                result.transactionWrites =
                    transactionWrites;

                return result;
            }
    };

    return {
        db:
            db,

        orderData:
            orderData,

        orderReference:
            orderReference,

        orderSnapshot:
            orderSnapshot,

        webhookDocuments:
            webhookDocuments
    };
}

function createWebhookDocument(
    documentId
) {
    const state = {};
    const writes = [];

    return {
        id:
            documentId,

        state:
            state,

        writes:
            writes,

        get:
            async function () {
                return {
                    exists:
                        Object.keys(
                            state
                        ).length > 0,

                    get:
                        function (
                            field
                        ) {
                            return state[
                                field
                            ];
                        },

                    data:
                        function () {
                            return Object.assign(
                                {},
                                state
                            );
                        }
                };
            },

        set:
            async function (
                data,
                options
            ) {
                writes.push({
                    data:
                        data,
                    options:
                        options || null
                });

                Object.assign(
                    state,
                    data
                );
            }
    };
}

function createOrderQuery(options) {
    return {
        limit:
            function () {
                return this;
            },

        get:
            async function () {
                const order =
                    options.orderSnapshot
                        .data();

                const matches =
                    resolveNestedField(
                        order,
                        options.field
                    ) === options.value;

                return {
                    empty:
                        !matches,

                    docs:
                        matches
                            ? [
                                  options
                                      .orderSnapshot
                              ]
                            : []
                };
            }
    };
}

function resolveNestedField(
    value,
    path
) {
    return String(path)
        .split(".")
        .reduce(
            function (
                current,
                key
            ) {
                return current &&
                    current[key] !==
                        undefined
                    ? current[key]
                    : undefined;
            },
            value
        );
}

function mockFetch(
    responseOptions
) {
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

            const settings =
                typeof responseOptions ===
                "function"
                    ? responseOptions(
                          url,
                          options
                      )
                    : responseOptions;

            return {
                ok:
                    settings.ok !==
                    false,

                status:
                    settings.status ||
                    200,

                headers: {
                    get:
                        function (
                            name
                        ) {
                            return settings
                                .headers &&
                                settings
                                    .headers[
                                    String(
                                        name
                                    ).toLowerCase()
                                ]
                                ? settings
                                      .headers[
                                      String(
                                          name
                                      ).toLowerCase()
                                  ]
                                : null;
                        }
                },

                text:
                    async function () {
                        if (
                            settings.body ===
                            undefined
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
   PROVIDER RESOLUTION
========================================================== */

test(
    "resolveWebhookProvider detects Paystack",
    function () {
        const request =
            createRequest({
                headers: {
                    "x-paystack-signature":
                        "signature"
                }
            });

        assert.equal(
            paymentService
                .resolveWebhookProvider(
                    request
                ),
            "paystack"
        );
    }
);

test(
    "resolveWebhookProvider detects Flutterwave",
    function () {
        const request =
            createRequest({
                headers: {
                    "flutterwave-signature":
                        "signature"
                }
            });

        assert.equal(
            paymentService
                .resolveWebhookProvider(
                    request
                ),
            "flutterwave"
        );
    }
);

test(
    "resolveWebhookProvider rejects an unknown webhook",
    function () {
        assert.throws(
            function () {
                paymentService
                    .resolveWebhookProvider(
                        createRequest()
                    );
            },
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
   PAYSTACK SIGNATURE
========================================================== */

test(
    "valid Paystack signature is accepted",
    function () {
        const secret =
            "paystack-test-secret";

        const request =
            createPaystackRequest(
                {
                    event:
                        "charge.success",

                    data: {
                        reference:
                            "LET-PS-REFERENCE"
                    }
                },
                secret
            );

        assert.equal(
            paymentService
                .verifyPaystackWebhookSignature({
                    request:
                        request,
                    secret:
                        secret
                }),
            true
        );
    }
);

test(
    "invalid Paystack signature is rejected",
    function () {
        const request =
            createRequest({
                body: {
                    event:
                        "charge.success"
                },

                headers: {
                    "x-paystack-signature":
                        "invalid"
                }
            });

        assert.throws(
            function () {
                paymentService
                    .verifyPaystackWebhookSignature({
                        request:
                            request,

                        secret:
                            "correct-secret"
                    });
            },
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
   FLUTTERWAVE SIGNATURE
========================================================== */

test(
    "valid Flutterwave HMAC signature is accepted",
    function () {
        const secret =
            "flutterwave-test-secret";

        const request =
            createFlutterwaveRequest(
                {
                    event:
                        "charge.completed",

                    data: {
                        tx_ref:
                            "LET-FW-REFERENCE"
                    }
                },
                secret
            );

        assert.equal(
            paymentService
                .verifyFlutterwaveWebhookSignature({
                    request:
                        request,

                    secret:
                        secret
                }),
            true
        );
    }
);

test(
    "legacy Flutterwave verification hash is accepted",
    function () {
        const secret =
            "legacy-webhook-secret";

        const request =
            createRequest({
                headers: {
                    "verif-hash":
                        secret
                }
            });

        assert.equal(
            paymentService
                .verifyFlutterwaveWebhookSignature({
                    request:
                        request,

                    secret:
                        secret
                }),
            true
        );
    }
);

test(
    "invalid Flutterwave signature is rejected",
    function () {
        const request =
            createRequest({
                headers: {
                    "flutterwave-signature":
                        "incorrect"
                }
            });

        assert.throws(
            function () {
                paymentService
                    .verifyFlutterwaveWebhookSignature({
                        request:
                            request,

                        secret:
                            "correct-secret"
                    });
            },
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
   PAYSTACK INITIALIZATION
========================================================== */

test(
    "Paystack initialization sends trusted order values",
    async function () {
        const fetchMock =
            mockFetch({
                body: {
                    status:
                        true,

                    message:
                        "Authorization URL created",

                    data: {
                        authorization_url:
                            "https://checkout.paystack.com/example",

                        access_code:
                            "access-code",

                        reference:
                            "LET-PS-REFERENCE"
                    }
                }
            });

        try {
            const result =
                await paymentService
                    .initializePaystackPayment({
                        order: {
                            id:
                                "order-1",

                            orderNumber:
                                "LET-ORDER-1",

                            userId:
                                "customer-1",

                            total:
                                1250.5,

                            currency:
                                "NGN"
                        },

                        customer: {
                            email:
                                "Customer@Example.com",

                            displayName:
                                "Customer Name"
                        },

                        configuration: {
                            paystackSecretKey:
                                "paystack-secret",

                            appOrigin:
                                "https://shop.example.com"
                        }
                    });

            assert.equal(
                result.provider,
                "paystack"
            );

            assert.equal(
                result.reference,
                "LET-PS-REFERENCE"
            );

            assert.equal(
                result.authorizationUrl,
                "https://checkout.paystack.com/example"
            );

            assert.equal(
                fetchMock.calls.length,
                1
            );

            const call =
                fetchMock.calls[0];

            assert.equal(
                call.url,
                "https://api.paystack.co/transaction/initialize"
            );

            const body =
                JSON.parse(
                    call.options.body
                );

            assert.equal(
                body.email,
                "customer@example.com"
            );

            assert.equal(
                body.amount,
                "125050"
            );

            assert.equal(
                body.currency,
                "NGN"
            );

            assert.equal(
                body.metadata.orderId,
                "order-1"
            );

            assert.equal(
                body.callback_url,
                "https://shop.example.com/checkout/payment-complete"
            );
        } finally {
            fetchMock.restore();
        }
    }
);

test(
    "Paystack initialization rejects missing credentials",
    async function () {
        await assert.rejects(
            paymentService
                .initializePaystackPayment({
                    order: {
                        id:
                            "order-1",

                        total:
                            1000,

                        currency:
                            "NGN"
                    },

                    customer: {
                        email:
                            "customer@example.com"
                    },

                    configuration: {}
                }),
            function (error) {
                assert.equal(
                    error.code,
                    "failed-precondition"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   FLUTTERWAVE INITIALIZATION
========================================================== */

test(
    "Flutterwave initialization creates a hosted checkout link",
    async function () {
        const fetchMock =
            mockFetch({
                body: {
                    status:
                        "success",

                    message:
                        "Hosted Link",

                    data: {
                        link:
                            "https://checkout.flutterwave.com/example"
                    }
                }
            });

        try {
            const result =
                await paymentService
                    .initializeFlutterwavePayment({
                        order: {
                            id:
                                "order-1",

                            orderNumber:
                                "LET-ORDER-1",

                            userId:
                                "customer-1",

                            total:
                                25000,

                            currency:
                                "NGN"
                        },

                        customer: {
                            email:
                                "customer@example.com",

                            firstName:
                                "Test",

                            lastName:
                                "Customer",

                            phone:
                                "+2348000000000"
                        },

                        configuration: {
                            flutterwaveSecretKey:
                                "flutterwave-secret",

                            appOrigin:
                                "https://shop.example.com",

                            storeName:
                                "L'ÉTERNEL"
                        }
                    });

            assert.equal(
                result.provider,
                "flutterwave"
            );

            assert.equal(
                result.authorizationUrl,
                "https://checkout.flutterwave.com/example"
            );

            assert.equal(
                fetchMock.calls.length,
                1
            );

            const body =
                JSON.parse(
                    fetchMock.calls[0]
                        .options.body
                );

            assert.equal(
                body.amount,
                25000
            );

            assert.equal(
                body.currency,
                "NGN"
            );

            assert.equal(
                body.customer.email,
                "customer@example.com"
            );

            assert.equal(
                body.meta.orderId,
                "order-1"
            );
        } finally {
            fetchMock.restore();
        }
    }
);

/* ==========================================================
   PAYSTACK VERIFICATION
========================================================== */

test(
    "Paystack verification normalizes successful transaction data",
    async function () {
        const fetchMock =
            mockFetch({
                body: {
                    status:
                        true,

                    data: {
                        id:
                            12345,

                        reference:
                            "LET-PS-REFERENCE",

                        status:
                            "success",

                        amount:
                            12000000,

                        currency:
                            "NGN",

                        paid_at:
                            "2026-07-19T12:00:00.000Z",

                        gateway_response:
                            "Successful",

                        customer: {
                            email:
                                "customer@example.com"
                        },

                        authorization: {
                            authorization_code:
                                "AUTH_test",

                            reusable:
                                true,

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
            const result =
                await paymentService
                    .verifyPaystackPayment({
                        reference:
                            "LET-PS-REFERENCE",

                        configuration: {
                            paystackSecretKey:
                                "secret"
                        }
                    });

            assert.equal(
                result.successful,
                true
            );

            assert.equal(
                result.amount,
                120000
            );

            assert.equal(
                result.currency,
                "NGN"
            );

            assert.equal(
                result.providerTransactionId,
                "12345"
            );

            assert.equal(
                result.authorization.last4,
                "4081"
            );
        } finally {
            fetchMock.restore();
        }
    }
);

/* ==========================================================
   FLUTTERWAVE VERIFICATION
========================================================== */

test(
    "Flutterwave verification normalizes successful transaction data",
    async function () {
        const fetchMock =
            mockFetch({
                body: {
                    status:
                        "success",

                    data: {
                        id:
                            98765,

                        tx_ref:
                            "LET-FW-REFERENCE",

                        status:
                            "successful",

                        charged_amount:
                            120000,

                        amount:
                            120000,

                        currency:
                            "NGN",

                        created_at:
                            "2026-07-19T12:00:00.000Z",

                        processor_response:
                            "Approved",

                        payment_type:
                            "card",

                        customer: {
                            email:
                                "customer@example.com"
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
            const result =
                await paymentService
                    .verifyFlutterwavePayment({
                        transactionId:
                            "98765",

                        reference:
                            "LET-FW-REFERENCE",

                        configuration: {
                            flutterwaveSecretKey:
                                "secret"
                        }
                    });

            assert.equal(
                result.successful,
                true
            );

            assert.equal(
                result.amount,
                120000
            );

            assert.equal(
                result.reference,
                "LET-FW-REFERENCE"
            );

            assert.equal(
                result.authorization.last4,
                "8381"
            );
        } finally {
            fetchMock.restore();
        }
    }
);

/* ==========================================================
   PAYMENT VALIDATION
========================================================== */

test(
    "payment validation accepts a matching verified payment",
    function () {
        assert.equal(
            paymentService
                .validateVerifiedPayment({
                    order: {
                        total:
                            120000,

                        currency:
                            "NGN",

                        paymentReference:
                            "LET-REFERENCE",

                        customer: {
                            email:
                                "customer@example.com"
                        }
                    },

                    verification: {
                        amount:
                            120000,

                        currency:
                            "NGN",

                        reference:
                            "LET-REFERENCE",

                        customerEmail:
                            "customer@example.com"
                    }
                }),
            true
        );
    }
);

test(
    "payment validation rejects amount tampering",
    function () {
        assert.throws(
            function () {
                paymentService
                    .validateVerifiedPayment({
                        order: {
                            total:
                                120000,

                            currency:
                                "NGN"
                        },

                        verification: {
                            amount:
                                100,

                            currency:
                                "NGN"
                        }
                    });
            },
            function (error) {
                assert.equal(
                    error.code,
                    "failed-precondition"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   PAYMENT REFERENCE GENERATION
========================================================== */

test(
    "payment references include provider prefix and order suffix",
    function () {
        const reference =
            paymentService
                ._internal
                .createPaymentReference(
                    "LET-PS",
                    "order-abc-123"
                );

        assert.match(
            reference,
            /^LET-PS-ORDERABC123-[A-Z0-9]+-[A-F0-9]{8}$/
        );
    }
);

test(
    "webhook event identifiers are deterministic",
    function () {
        const first =
            paymentService
                ._internal
                .createWebhookEventId({
                    provider:
                        "paystack",

                    eventType:
                        "charge.success",

                    reference:
                        "LET-REFERENCE",

                    providerId:
                        "123"
                });

        const second =
            paymentService
                ._internal
                .createWebhookEventId({
                    provider:
                        "paystack",

                    eventType:
                        "charge.success",

                    reference:
                        "LET-REFERENCE",

                    providerId:
                        "123"
                });

        assert.equal(
            first,
            second
        );

        assert.match(
            first,
            /^[a-f0-9]{64}$/
        );
    }
);

/* ==========================================================
   WEBHOOK PAYLOAD SANITIZATION
========================================================== */

test(
    "webhook payload sanitizer removes sensitive payment fields",
    function () {
        const sanitized =
            paymentService
                ._internal
                .sanitizeWebhookPayload({
                    event:
                        "charge.success",

                    data: {
                        reference:
                            "LET-REFERENCE",

                        authorization_code:
                            "AUTH_SECRET",

                        card: {
                            number:
                                "4084084084084081"
                        },

                        customer: {
                            email:
                                "customer@example.com"
                        }
                    }
                });

        assert.equal(
            sanitized.data
                .authorization_code,
            undefined
        );

        assert.equal(
            sanitized.data.card,
            undefined
        );

        assert.equal(
            sanitized.data.reference,
            "LET-REFERENCE"
        );
    }
);

/* ==========================================================
   SUCCESSFUL PAYMENT STATE
========================================================== */

test(
    "successful payment confirms a pending order",
    async function () {
        const fixture =
            createWebhookDatabase();

        const originalVerify =
            paymentService
                .verifyPayment;

        /*
         * handleSuccessfulPayment calls the local verifyPayment
         * function, so provider verification is mocked with fetch.
         */
        const fetchMock =
            mockFetch({
                body: {
                    status:
                        true,

                    data: {
                        id:
                            123,

                        reference:
                            "LET-PS-REFERENCE",

                        status:
                            "success",

                        amount:
                            12000000,

                        currency:
                            "NGN",

                        customer: {
                            email:
                                "customer@example.com"
                        },

                        authorization: {
                            reusable:
                                false,

                            channel:
                                "card",

                            last4:
                                "4081"
                        }
                    }
                }
            });

        try {
            const result =
                await paymentService
                    .handleSuccessfulPayment({
                        db:
                            fixture.db,

                        provider:
                            "paystack",

                        reference:
                            "LET-PS-REFERENCE",

                        webhookData: {
                            reference:
                                "LET-PS-REFERENCE",

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

            assert.equal(
                fixture
                    .orderReference
                    .writes.length,
                1
            );

            const update =
                fixture
                    .orderReference
                    .writes[0]
                    .data;

            assert.equal(
                update.paymentStatus,
                "paid"
            );

            assert.equal(
                update.status,
                "confirmed"
            );

            assert.ok(
                update.confirmedAt instanceof
                Timestamp
            );
        } finally {
            fetchMock.restore();

            assert.equal(
                paymentService
                    .verifyPayment,
                originalVerify
            );
        }
    }
);

test(
    "already-paid order treats successful payment as duplicate",
    async function () {
        const fixture =
            createWebhookDatabase({
                order: {
                    total:
                        120000,

                    currency:
                        "NGN",

                    customer: {
                        email:
                            "customer@example.com"
                    },

                    status:
                        "confirmed",

                    paymentStatus:
                        "paid",

                    paymentReference:
                        "LET-PS-REFERENCE"
                }
            });

        const fetchMock =
            mockFetch({
                body: {
                    status:
                        true,

                    data: {
                        id:
                            123,

                        reference:
                            "LET-PS-REFERENCE",

                        status:
                            "success",

                        amount:
                            12000000,

                        currency:
                            "NGN",

                        customer: {
                            email:
                                "customer@example.com"
                        }
                    }
                }
            });

        try {
            const result =
                await paymentService
                    .handleSuccessfulPayment({
                        db:
                            fixture.db,

                        provider:
                            "paystack",

                        reference:
                            "LET-PS-REFERENCE",

                        webhookData: {
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
                result.duplicate,
                true
            );

            assert.equal(
                fixture
                    .orderReference
                    .writes.length,
                0
            );
        } finally {
            fetchMock.restore();
        }
    }
);

/* ==========================================================
   FAILED PAYMENT STATE
========================================================== */

test(
    "failed payment marks an unpaid order as failed",
    async function () {
        const fixture =
            createWebhookDatabase();

        const result =
            await paymentService
                .handleFailedPayment({
                    db:
                        fixture.db,

                    provider:
                        "paystack",

                    reference:
                        "LET-PS-REFERENCE",

                    webhookData: {
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

        assert.equal(
            fixture
                .orderReference
                .writes.length,
            1
        );

        const update =
            fixture
                .orderReference
                .writes[0]
                .data;

        assert.equal(
            update.paymentStatus,
            "failed"
        );

        assert.equal(
            update.payment
                .gatewayResponse,
            "Declined"
        );
    }
);

test(
    "failed webhook cannot overwrite a paid order",
    async function () {
        const fixture =
            createWebhookDatabase({
                order: {
                    total:
                        120000,

                    currency:
                        "NGN",

                    status:
                        "confirmed",

                    paymentStatus:
                        "paid",

                    paymentReference:
                        "LET-PS-REFERENCE"
                }
            });

        const result =
            await paymentService
                .handleFailedPayment({
                    db:
                        fixture.db,

                    provider:
                        "paystack",

                    reference:
                        "LET-PS-REFERENCE",

                    webhookData: {
                        status:
                            "failed"
                    }
                });

        assert.equal(
            result.ignored,
            true
        );

        assert.equal(
            fixture
                .orderReference
                .writes.length,
            0
        );
    }
);

/* ==========================================================
   REFUND STATE
========================================================== */

test(
    "refund event marks an order and payment as refunded",
    async function () {
        const fixture =
            createWebhookDatabase({
                order: {
                    total:
                        120000,

                    currency:
                        "NGN",

                    status:
                        "confirmed",

                    paymentStatus:
                        "paid",

                    paymentReference:
                        "LET-PS-REFERENCE"
                }
            });

        const result =
            await paymentService
                .handleRefundEvent({
                    db:
                        fixture.db,

                    provider:
                        "paystack",

                    reference:
                        "LET-PS-REFERENCE",

                    webhookData: {
                        id:
                            "refund-1"
                    }
                });

        assert.equal(
            result.orderId,
            "order-1"
        );

        assert.equal(
            fixture
                .orderReference
                .writes.length,
            1
        );

        const update =
            fixture
                .orderReference
                .writes[0]
                .data;

        assert.equal(
            update.paymentStatus,
            "refunded"
        );

        assert.equal(
            update.status,
            "refunded"
        );

        assert.equal(
            update.payment
                .refund
                .providerRefundId,
            "refund-1"
        );
    }
);

/* ==========================================================
   WEBHOOK PROCESSING & IDEMPOTENCY
========================================================== */

test(
    "unsupported Paystack event is stored and safely ignored",
    async function () {
        const fixture =
            createWebhookDatabase();

        const secret =
            "paystack-secret";

        const request =
            createPaystackRequest(
                {
                    event:
                        "subscription.create",

                    data: {
                        id:
                            100,

                        reference:
                            "LET-PS-REFERENCE"
                    }
                },
                secret
            );

        const result =
            await paymentService
                .processPaystackWebhook({
                    db:
                        fixture.db,

                    request:
                        request,

                    configuration: {
                        paystackSecretKey:
                            secret
                    }
                });

        assert.equal(
            result.duplicate,
            false
        );

        assert.equal(
            result.ignored,
            true
        );

        assert.equal(
            fixture
                .webhookDocuments
                .size,
            1
        );

        const webhookDocument =
            Array.from(
                fixture
                    .webhookDocuments
                    .values()
            )[0];

        assert.equal(
            webhookDocument
                .state
                .processed,
            true
        );

        assert.equal(
            webhookDocument
                .state
                .ignored,
            true
        );
    }
);

test(
    "processed webhook event is idempotently ignored on retry",
    async function () {
        const fixture =
            createWebhookDatabase();

        const secret =
            "paystack-secret";

        const payload = {
            event:
                "subscription.create",

            data: {
                id:
                    100,

                reference:
                    "LET-PS-REFERENCE"
            }
        };

        const firstRequest =
            createPaystackRequest(
                payload,
                secret
            );

        const firstResult =
            await paymentService
                .processPaystackWebhook({
                    db:
                        fixture.db,

                    request:
                        firstRequest,

                    configuration: {
                        paystackSecretKey:
                            secret
                    }
                });

        assert.equal(
            firstResult.duplicate,
            false
        );

        const secondRequest =
            createPaystackRequest(
                payload,
                secret
            );

        const secondResult =
            await paymentService
                .processPaystackWebhook({
                    db:
                        fixture.db,

                    request:
                        secondRequest,

                    configuration: {
                        paystackSecretKey:
                            secret
                    }
                });

        assert.equal(
            secondResult.duplicate,
            true
        );

        assert.equal(
            fixture
                .webhookDocuments
                .size,
            1
        );
    }
);

/* ==========================================================
   PROVIDER HTTP FAILURES
========================================================== */

test(
    "provider request maps rate limits to resource exhaustion",
    async function () {
        const fetchMock =
            mockFetch({
                ok:
                    false,

                status:
                    429,

                body: {
                    message:
                        "Too many requests"
                }
            });

        try {
            await assert.rejects(
                paymentService
                    ._internal
                    .providerRequest({
                        url:
                            "https://example.com",

                        method:
                            "GET",

                        provider:
                            "Example"
                    }),
                function (error) {
                    assert.equal(
                        error.code,
                        "resource-exhausted"
                    );

                    assert.equal(
                        error.status,
                        429
                    );

                    return true;
                }
            );
        } finally {
            fetchMock.restore();
        }
    }
);

test(
    "provider request rejects malformed JSON responses",
    async function () {
        const fetchMock =
            mockFetch({
                body:
                    "not-json"
            });

        try {
            await assert.rejects(
                paymentService
                    ._internal
                    .providerRequest({
                        url:
                            "https://example.com",

                        method:
                            "GET",

                        provider:
                            "Example"
                    }),
                function (error) {
                    assert.equal(
                        error.code,
                        "payment-failed"
                    );

                    return true;
                }
            );
        } finally {
            fetchMock.restore();
        }
    }
);