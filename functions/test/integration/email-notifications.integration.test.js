"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   EMAIL NOTIFICATIONS INTEGRATION TESTS
========================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");

const emailService = require(
    "../../src/email/email-service"
);

/* ==========================================================
   TEST FIXTURES
========================================================== */

function createOrder(overrides) {
    return mergeValue(
        {
            id:
                "order-1",

            orderNumber:
                "LET-20260720-ORDER001",

            userId:
                "customer-1",

            status:
                "confirmed",

            paymentStatus:
                "paid",

            paymentReference:
                "LET-PS-REFERENCE",

            currency:
                "NGN",

            subtotal:
                300000,

            discount:
                25000,

            deliveryFee:
                5000,

            tax:
                0,

            total:
                280000,

            customer: {
                firstName:
                    "Samuel",

                lastName:
                    "Udom",

                displayName:
                    "Samuel Udom",

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

                addressLine2:
                    "Apartment 4",

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

            items: [
                {
                    productId:
                        "product-coat",

                    variantId:
                        "black-medium",

                    sku:
                        "COAT-BLK-M",

                    name:
                        "Signature Coat",

                    quantity:
                        1,

                    unitPrice:
                        180000,

                    price:
                        180000,

                    lineTotal:
                        180000,

                    color:
                        "Black",

                    size:
                        "M",

                    image:
                        "https://example.com/coat.jpg"
                },

                {
                    productId:
                        "product-dress",

                    variantId:
                        "ivory-small",

                    sku:
                        "DRESS-IVR-S",

                    name:
                        "Silk Dress",

                    quantity:
                        1,

                    unitPrice:
                        120000,

                    price:
                        120000,

                    lineTotal:
                        120000,

                    color:
                        "Ivory",

                    size:
                        "S",

                    image:
                        "https://example.com/dress.jpg"
                }
            ],

            tracking: {
                carrier:
                    "DHL",

                trackingNumber:
                    "DHL-123456",

                trackingUrl:
                    "https://example.com/track/DHL-123456"
            }
        },
        overrides || {}
    );
}

function createConfiguration(overrides) {
    return Object.assign(
        {
            provider:
                "resend",

            apiKey:
                "test-email-api-key",

            from:
                "orders@example.com",

            replyTo:
                "support@example.com",

            storeName:
                "L'ÉTERNEL",

            appOrigin:
                "https://shop.example.com"
        },
        overrides || {}
    );
}

/* ==========================================================
   VALUE HELPERS
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

/* ==========================================================
   FETCH MOCK
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
            settings.status || 200,

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

function mockFetch(handler) {
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

            const response =
                typeof handler ===
                    "function"
                    ? await handler(
                          url,
                          options || {},
                          calls.length - 1
                      )
                    : handler;

            return createFetchResponse(
                response
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
   PAYLOAD HELPERS
========================================================== */

function parseRequestBody(call) {
    assert.ok(
        call.options.body,
        "Provider request should contain a body."
    );

    return JSON.parse(
        call.options.body
    );
}

function findResendTag(payload, name) {
    return (
        payload.tags || []
    ).find(
        function (tag) {
            return tag.name === name;
        }
    );
}

/* ==========================================================
   ORDER CONFIRMATION
========================================================== */

test(
    "order confirmation builds and sends a complete Resend message",
    async function () {
        const fetchMock =
            mockFetch({
                status:
                    200,

                body: {
                    id:
                        "email-confirmation-1"
                }
            });

        try {
            const result =
                await emailService
                    .sendOrderConfirmation({
                        order:
                            createOrder(),

                        configuration:
                            createConfiguration()
                    });

            assert.equal(
                result.success,
                true
            );

            assert.equal(
                result.provider,
                "resend"
            );

            assert.equal(
                result.messageId,
                "email-confirmation-1"
            );

            assert.equal(
                result.recipient,
                "samuel@example.com"
            );

            assert.equal(
                fetchMock.calls.length,
                1
            );

            const call =
                fetchMock.calls[0];

            assert.equal(
                call.url,
                "https://api.resend.com/emails"
            );

            assert.equal(
                call.options.method,
                "POST"
            );

            assert.equal(
                call.options.headers
                    .Authorization,
                "Bearer test-email-api-key"
            );

            const payload =
                parseRequestBody(call);

            assert.equal(
                payload.from,
                "L'ÉTERNEL <orders@example.com>"
            );

            assert.deepEqual(
                payload.to,
                [
                    "samuel@example.com"
                ]
            );

            assert.match(
                payload.subject,
                /Order received/i
            );

            assert.match(
                payload.subject,
                /LET-20260720-ORDER001/
            );

            assert.match(
                payload.html,
                /Signature Coat/
            );

            assert.match(
                payload.html,
                /Silk Dress/
            );

            assert.match(
                payload.html,
                /10 Example Road/
            );

            assert.match(
                payload.html,
                /https:\/\/shop\.example\.com\/account\/orders\/order-1/
            );

            assert.match(
                payload.text,
                /Samuel Udom/
            );

            assert.match(
                payload.text,
                /LET-20260720-ORDER001/
            );

            assert.equal(
                findResendTag(
                    payload,
                    "type"
                ).value,
                "order-confirmation"
            );

            assert.equal(
                findResendTag(
                    payload,
                    "orderId"
                ).value,
                "order-1"
            );
        } finally {
            fetchMock.restore();
        }
    }
);

test(
    "order confirmation calculates presentation values from trusted order totals",
    async function () {
        const fetchMock =
            mockFetch({
                body: {
                    id:
                        "email-confirmation-2"
                }
            });

        try {
            await emailService
                .sendOrderConfirmation({
                    order:
                        createOrder({
                            subtotal:
                                500000,

                            discount:
                                50000,

                            deliveryFee:
                                10000,

                            tax:
                                25000,

                            total:
                                485000
                        }),

                    configuration:
                        createConfiguration()
                });

            const payload =
                parseRequestBody(
                    fetchMock.calls[0]
                );

            assert.match(
                payload.text,
                /Subtotal:/
            );

            assert.match(
                payload.text,
                /Discount:/
            );

            assert.match(
                payload.text,
                /Delivery:/
            );

            assert.match(
                payload.text,
                /Tax:/
            );

            assert.match(
                payload.text,
                /Total:/
            );

            assert.match(
                payload.html,
                /485,000/
            );
        } finally {
            fetchMock.restore();
        }
    }
);

/* ==========================================================
   STATUS UPDATE
========================================================== */

test(
    "shipped order notification includes tracking information",
    async function () {
        const fetchMock =
            mockFetch({
                body: {
                    id:
                        "email-status-1"
                }
            });

        try {
            const result =
                await emailService
                    .sendOrderStatusUpdate({
                        order:
                            createOrder({
                                status:
                                    "shipped"
                            }),

                        configuration:
                            createConfiguration()
                    });

            assert.equal(
                result.success,
                true
            );

            const payload =
                parseRequestBody(
                    fetchMock.calls[0]
                );

            assert.match(
                payload.subject,
                /Shipped/
            );

            assert.match(
                payload.html,
                /DHL/
            );

            assert.match(
                payload.html,
                /DHL-123456/
            );

            assert.match(
                payload.html,
                /https:\/\/example\.com\/track\/DHL-123456/
            );

            assert.match(
                payload.text,
                /Status: Shipped/
            );
        } finally {
            fetchMock.restore();
        }
    }
);

test(
    "delivered order notification reflects final fulfillment state",
    async function () {
        const fetchMock =
            mockFetch({
                body: {
                    id:
                        "email-status-2"
                }
            });

        try {
            await emailService
                .sendOrderStatusUpdate({
                    order:
                        createOrder({
                            status:
                                "delivered",

                            tracking:
                                null
                        }),

                    configuration:
                        createConfiguration()
                });

            const payload =
                parseRequestBody(
                    fetchMock.calls[0]
                );

            assert.match(
                payload.subject,
                /Delivered/
            );

            assert.match(
                payload.text,
                /Status: Delivered/
            );

            assert.match(
                payload.html,
                /delivered/i
            );
        } finally {
            fetchMock.restore();
        }
    }
);

/* ==========================================================
   PAYMENT RECEIPT
========================================================== */

test(
    "payment receipt sends the verified payment reference and total",
    async function () {
        const fetchMock =
            mockFetch({
                body: {
                    id:
                        "email-receipt-1"
                }
            });

        try {
            const result =
                await emailService
                    .sendPaymentReceipt({
                        order:
                            createOrder(),

                        configuration:
                            createConfiguration()
                    });

            assert.equal(
                result.messageId,
                "email-receipt-1"
            );

            const payload =
                parseRequestBody(
                    fetchMock.calls[0]
                );

            assert.match(
                payload.subject,
                /Payment received/
            );

            assert.match(
                payload.subject,
                /LET-20260720-ORDER001/
            );

            assert.match(
                payload.html,
                /LET-PS-REFERENCE/
            );

            assert.match(
                payload.text,
                /Reference: LET-PS-REFERENCE/
            );

            assert.match(
                payload.html,
                /280,000/
            );

            assert.equal(
                findResendTag(
                    payload,
                    "type"
                ).value,
                "payment-receipt"
            );
        } finally {
            fetchMock.restore();
        }
    }
);

test(
    "payment receipt falls back to nested provider reference",
    async function () {
        const fetchMock =
            mockFetch({
                body: {
                    id:
                        "email-receipt-2"
                }
            });

        try {
            await emailService
                .sendPaymentReceipt({
                    order:
                        createOrder({
                            paymentReference:
                                "",

                            payment: {
                                providerReference:
                                    "NESTED-PAYMENT-REFERENCE"
                            }
                        }),

                    configuration:
                        createConfiguration()
                });

            const payload =
                parseRequestBody(
                    fetchMock.calls[0]
                );

            assert.match(
                payload.html,
                /NESTED-PAYMENT-REFERENCE/
            );

            assert.match(
                payload.text,
                /NESTED-PAYMENT-REFERENCE/
            );
        } finally {
            fetchMock.restore();
        }
    }
);

/* ==========================================================
   SENDGRID DISPATCH
========================================================== */

test(
    "order confirmation can be delivered through SendGrid",
    async function () {
        const fetchMock =
            mockFetch({
                status:
                    202,

                body:
                    "",

                headers: {
                    "x-message-id":
                        "sendgrid-confirmation-1"
                }
            });

        try {
            const result =
                await emailService
                    .sendOrderConfirmation({
                        order:
                            createOrder(),

                        configuration:
                            createConfiguration({
                                provider:
                                    "sendgrid",

                                apiKey:
                                    "sendgrid-test-key"
                            })
                    });

            assert.equal(
                result.success,
                true
            );

            assert.equal(
                result.provider,
                "sendgrid"
            );

            assert.equal(
                result.messageId,
                "sendgrid-confirmation-1"
            );

            assert.equal(
                fetchMock.calls.length,
                1
            );

            const call =
                fetchMock.calls[0];

            assert.equal(
                call.url,
                "https://api.sendgrid.com/v3/mail/send"
            );

            assert.equal(
                call.options.headers
                    .Authorization,
                "Bearer sendgrid-test-key"
            );

            const payload =
                parseRequestBody(call);

            assert.deepEqual(
                payload.from,
                {
                    name:
                        "L'ÉTERNEL",

                    email:
                        "orders@example.com"
                }
            );

            assert.equal(
                payload.personalizations[0]
                    .to[0].email,
                "samuel@example.com"
            );

            assert.match(
                payload.personalizations[0]
                    .subject,
                /Order received/
            );

            assert.equal(
                payload.content[0].type,
                "text/plain"
            );

            assert.equal(
                payload.content[1].type,
                "text/html"
            );
        } finally {
            fetchMock.restore();
        }
    }
);

/* ==========================================================
   ESCAPING & SANITIZATION
========================================================== */

test(
    "notification templates escape customer and product content",
    async function () {
        const fetchMock =
            mockFetch({
                body: {
                    id:
                        "email-escaped-1"
                }
            });

        try {
            await emailService
                .sendOrderConfirmation({
                    order:
                        createOrder({
                            customer: {
                                displayName:
                                    "<script>alert('customer')</script>",

                                email:
                                    "customer@example.com"
                            },

                            shippingAddress: {
                                addressLine1:
                                    "<img src=x onerror=alert(1)>",

                                city:
                                    "Lagos",

                                state:
                                    "Lagos",

                                country:
                                    "Nigeria"
                            },

                            items: [
                                {
                                    productId:
                                        "product-malicious",

                                    name:
                                        "<script>alert('product')</script>",

                                    quantity:
                                        1,

                                    unitPrice:
                                        1000,

                                    price:
                                        1000,

                                    lineTotal:
                                        1000
                                }
                            ],

                            subtotal:
                                1000,

                            discount:
                                0,

                            deliveryFee:
                                0,

                            tax:
                                0,

                            total:
                                1000
                        }),

                    configuration:
                        createConfiguration()
                });

            const payload =
                parseRequestBody(
                    fetchMock.calls[0]
                );

            assert.doesNotMatch(
                payload.html,
                /<script>alert\('customer'\)<\/script>/
            );

            assert.doesNotMatch(
                payload.html,
                /<script>alert\('product'\)<\/script>/
            );

            assert.doesNotMatch(
                payload.html,
                /<img src=x onerror=alert\(1\)>/
            );

            assert.match(
                payload.html,
                /&lt;script&gt;/
            );

            assert.match(
                payload.html,
                /&lt;img/
            );
        } finally {
            fetchMock.restore();
        }
    }
);

test(
    "provider metadata contains identifiers but no payment secrets",
    async function () {
        const fetchMock =
            mockFetch({
                body: {
                    id:
                        "email-metadata-1"
                }
            });

        try {
            await emailService
                .sendPaymentReceipt({
                    order:
                        createOrder({
                            payment: {
                                provider:
                                    "paystack",

                                providerReference:
                                    "LET-PS-REFERENCE",

                                authorization: {
                                    authorizationCode:
                                        "AUTH_PRIVATE",

                                    reusable:
                                        true,

                                    last4:
                                        "4081"
                                }
                            }
                        }),

                    configuration:
                        createConfiguration()
                });

            const payload =
                parseRequestBody(
                    fetchMock.calls[0]
                );

            const serialized =
                JSON.stringify(payload);

            assert.match(
                serialized,
                /order-1/
            );

            assert.doesNotMatch(
                serialized,
                /AUTH_PRIVATE/
            );
        } finally {
            fetchMock.restore();
        }
    }
);

/* ==========================================================
   VALIDATION FAILURES
========================================================== */

test(
    "notification rejects an order without a customer email",
    async function () {
        await assert.rejects(
            emailService
                .sendOrderConfirmation({
                    order:
                        createOrder({
                            customer: {
                                displayName:
                                    "Samuel Udom",

                                email:
                                    ""
                            }
                        }),

                    configuration:
                        createConfiguration()
                }),
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

test(
    "notification rejects malformed recipient email",
    async function () {
        await assert.rejects(
            emailService
                .sendPaymentReceipt({
                    order:
                        createOrder({
                            customer: {
                                displayName:
                                    "Samuel Udom",

                                email:
                                    "not-an-email"
                            }
                        }),

                    configuration:
                        createConfiguration()
                }),
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

test(
    "notification requires provider credentials",
    async function () {
        await assert.rejects(
            emailService
                .sendOrderStatusUpdate({
                    order:
                        createOrder({
                            status:
                                "shipped"
                        }),

                    configuration:
                        createConfiguration({
                            apiKey:
                                ""
                        })
                }),
            function (error) {
                assert.equal(
                    error.code,
                    "failed-precondition"
                );

                assert.equal(
                    error.status,
                    503
                );

                return true;
            }
        );
    }
);

test(
    "notification requires a valid sender",
    async function () {
        await assert.rejects(
            emailService
                .sendOrderConfirmation({
                    order:
                        createOrder(),

                    configuration:
                        createConfiguration({
                            from:
                                ""
                        })
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
   PROVIDER FAILURE HANDLING
========================================================== */

test(
    "provider authentication failure becomes a safe service error",
    async function () {
        const fetchMock =
            mockFetch({
                ok:
                    false,

                status:
                    401,

                body: {
                    message:
                        "Invalid API key: secret-value"
                }
            });

        try {
            await assert.rejects(
                emailService
                    .sendOrderConfirmation({
                        order:
                            createOrder(),

                        configuration:
                            createConfiguration()
                    }),
                function (error) {
                    assert.equal(
                        error.code,
                        "permission-denied"
                    );

                    assert.equal(
                        error.status,
                        502
                    );

                    assert.doesNotMatch(
                        error.publicMessage ||
                        error.message,
                        /secret-value/
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
    "provider rate limiting becomes resource exhaustion",
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
                emailService
                    .sendPaymentReceipt({
                        order:
                            createOrder(),

                        configuration:
                            createConfiguration()
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
    "provider server failure does not return a false success",
    async function () {
        const fetchMock =
            mockFetch({
                ok:
                    false,

                status:
                    503,

                body: {
                    message:
                        "Provider unavailable"
                }
            });

        try {
            await assert.rejects(
                emailService
                    .sendOrderStatusUpdate({
                        order:
                            createOrder({
                                status:
                                    "delivered"
                            }),

                        configuration:
                            createConfiguration()
                    }),
                function (error) {
                    assert.match(
                        error.code,
                        /unavailable|internal/
                    );

                    return true;
                }
            );

            assert.equal(
                fetchMock.calls.length,
                1
            );
        } finally {
            fetchMock.restore();
        }
    }
);

test(
    "Resend response without a message ID is rejected",
    async function () {
        const fetchMock =
            mockFetch({
                status:
                    200,

                body: {
                    success:
                        true
                }
            });

        try {
            await assert.rejects(
                emailService
                    .sendOrderConfirmation({
                        order:
                            createOrder(),

                        configuration:
                            createConfiguration()
                    }),
                function (error) {
                    assert.equal(
                        error.code,
                        "unavailable"
                    );

                    return true;
                }
            );
        } finally {
            fetchMock.restore();
        }
    }
);

/* ==========================================================
   MULTIPLE NOTIFICATIONS
========================================================== */

test(
    "order lifecycle sends confirmation, receipt, and status messages independently",
    async function () {
        const messageIds = [
            "confirmation-message",
            "receipt-message",
            "status-message"
        ];

        const fetchMock =
            mockFetch(
                function (
                    url,
                    options,
                    index
                ) {
                    return {
                        status:
                            200,

                        body: {
                            id:
                                messageIds[index]
                        }
                    };
                }
            );

        try {
            const order =
                createOrder();

            const confirmation =
                await emailService
                    .sendOrderConfirmation({
                        order:
                            order,

                        configuration:
                            createConfiguration()
                    });

            const receipt =
                await emailService
                    .sendPaymentReceipt({
                        order:
                            order,

                        configuration:
                            createConfiguration()
                    });

            const status =
                await emailService
                    .sendOrderStatusUpdate({
                        order:
                            createOrder({
                                status:
                                    "shipped"
                            }),

                        configuration:
                            createConfiguration()
                    });

            assert.equal(
                confirmation.messageId,
                "confirmation-message"
            );

            assert.equal(
                receipt.messageId,
                "receipt-message"
            );

            assert.equal(
                status.messageId,
                "status-message"
            );

            assert.equal(
                fetchMock.calls.length,
                3
            );

            const payloads =
                fetchMock.calls.map(
                    parseRequestBody
                );

            assert.match(
                payloads[0].subject,
                /Order received/
            );

            assert.match(
                payloads[1].subject,
                /Payment received/
            );

            assert.match(
                payloads[2].subject,
                /Shipped/
            );
        } finally {
            fetchMock.restore();
        }
    }
);

test(
    "failure of one lifecycle email does not mutate the order object",
    async function () {
        const order =
            createOrder();

        const originalOrder =
            cloneValue(order);

        const fetchMock =
            mockFetch({
                ok:
                    false,

                status:
                    500,

                body: {
                    message:
                        "Email provider failed"
                }
            });

        try {
            await assert.rejects(
                emailService
                    .sendOrderConfirmation({
                        order:
                            order,

                        configuration:
                            createConfiguration()
                    })
            );

            assert.deepEqual(
                order,
                originalOrder
            );
        } finally {
            fetchMock.restore();
        }
    }
);

/* ==========================================================
   DIRECT TEMPLATE INTEGRATION
========================================================== */

test(
    "all template builders return matching HTML and text content",
    function () {
        const order =
            createOrder({
                status:
                    "shipped"
            });

        const options = {
            order:
                order,

            storeName:
                "L'ÉTERNEL",

            appOrigin:
                "https://shop.example.com"
        };

        const confirmation =
            emailService
                .buildOrderConfirmationTemplate(
                    options
                );

        const status =
            emailService
                .buildOrderStatusTemplate(
                    options
                );

        const receipt =
            emailService
                .buildPaymentReceiptTemplate(
                    options
                );

        [
            confirmation,
            status,
            receipt
        ].forEach(
            function (template) {
                assert.ok(
                    template.subject
                );

                assert.ok(
                    template.html
                );

                assert.ok(
                    template.text
                );

                assert.match(
                    template.html,
                    /LET-20260720-ORDER001/
                );

                assert.match(
                    template.text,
                    /LET-20260720-ORDER001/
                );
            }
        );
    }
);