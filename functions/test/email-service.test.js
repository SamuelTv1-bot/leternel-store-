"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   EMAIL SERVICE TESTS
========================================================== */

const test = require("node:test");

const assert = require(
    "node:assert/strict"
);

const emailService = require(
    "../src/email/email-service"
);

/* ==========================================================
   TEST HELPERS
========================================================== */

function createOrder(overrides) {
    return Object.assign(
        {
            id:
                "order-1",

            orderNumber:
                "LET-20260719-ORDER001",

            status:
                "confirmed",

            paymentStatus:
                "paid",

            paymentReference:
                "LET-PS-REFERENCE",

            currency:
                "NGN",

            subtotal:
                250000,

            discount:
                10000,

            deliveryFee:
                5000,

            tax:
                0,

            total:
                245000,

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
                        "product-1",

                    name:
                        "Signature Coat",

                    quantity:
                        1,

                    price:
                        150000,

                    lineTotal:
                        150000,

                    color:
                        "Black",

                    size:
                        "M",

                    image:
                        "https://example.com/coat.jpg"
                },
                {
                    productId:
                        "product-2",

                    name:
                        "Silk Dress",

                    quantity:
                        1,

                    price:
                        100000,

                    lineTotal:
                        100000,

                    color:
                        "Ivory",

                    size:
                        "S"
                }
            ]
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

/* ==========================================================
   FORMATTING
========================================================== */

test(
    "formatCurrency formats Nigerian naira",
    function () {
        const value =
            emailService
                ._internal
                .formatCurrency(
                    125000,
                    "NGN"
                );

        assert.match(
            value,
            /125,000/
        );

        assert.match(
            value,
            /₦|NGN/
        );
    }
);

test(
    "formatCurrency falls back for an invalid currency",
    function () {
        const value =
            emailService
                ._internal
                .formatCurrency(
                    1200,
                    "INVALID"
                );

        assert.equal(
            value,
            "INVALID 1200.00"
        );
    }
);

test(
    "formatStatus converts machine values to labels",
    function () {
        assert.equal(
            emailService
                ._internal
                .formatStatus(
                    "awaiting-payment"
                ),
            "Awaiting Payment"
        );

        assert.equal(
            emailService
                ._internal
                .formatStatus(
                    "payment_failed"
                ),
            "Payment Failed"
        );
    }
);

/* ==========================================================
   HTML ESCAPING
========================================================== */

test(
    "escapeHTML escapes unsafe characters",
    function () {
        assert.equal(
            emailService
                ._internal
                .escapeHTML(
                    '<script>"test" & value</script>'
                ),
            "&lt;script&gt;&quot;test&quot; &amp; value&lt;/script&gt;"
        );
    }
);

test(
    "email templates escape customer-controlled content",
    function () {
        const template =
            emailService
                .buildOrderConfirmationTemplate({
                    order:
                        createOrder({
                            customer: {
                                displayName:
                                    "<script>alert(1)</script>",

                                email:
                                    "customer@example.com"
                            },

                            items: [
                                {
                                    name:
                                        "<img src=x onerror=alert(1)>",

                                    quantity:
                                        1,

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

                    storeName:
                        "L'ÉTERNEL",

                    appOrigin:
                        "https://shop.example.com"
                });

        assert.doesNotMatch(
            template.html,
            /<script>alert\(1\)<\/script>/
        );

        assert.doesNotMatch(
            template.html,
            /<img src=x onerror=alert\(1\)>/
        );

        assert.match(
            template.html,
            /&lt;script&gt;/
        );
    }
);

/* ==========================================================
   SENDER NORMALIZATION
========================================================== */

test(
    "normalizeSender accepts a complete sender identity",
    function () {
        assert.equal(
            emailService
                ._internal
                .normalizeSender(
                    "L'ÉTERNEL <orders@example.com>",
                    "L'ÉTERNEL"
                ),
            "L'ÉTERNEL <orders@example.com>"
        );
    }
);

test(
    "normalizeSender adds store name to a plain address",
    function () {
        assert.equal(
            emailService
                ._internal
                .normalizeSender(
                    "orders@example.com",
                    "L'ÉTERNEL"
                ),
            "L'ÉTERNEL <orders@example.com>"
        );
    }
);

test(
    "normalizeSender rejects a missing sender",
    function () {
        assert.throws(
            function () {
                emailService
                    ._internal
                    .normalizeSender(
                        "",
                        "L'ÉTERNEL"
                    );
            },
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
    "parseSender separates sender name and address",
    function () {
        assert.deepEqual(
            emailService
                ._internal
                .parseSender(
                    "L'ÉTERNEL <orders@example.com>"
                ),
            {
                name:
                    "L'ÉTERNEL",

                email:
                    "orders@example.com"
            }
        );
    }
);

test(
    "parseSender supports a plain email address",
    function () {
        assert.deepEqual(
            emailService
                ._internal
                .parseSender(
                    "orders@example.com"
                ),
            {
                email:
                    "orders@example.com"
            }
        );
    }
);

/* ==========================================================
   ORDER CONFIRMATION TEMPLATE
========================================================== */

test(
    "order confirmation template includes order details",
    function () {
        const template =
            emailService
                .buildOrderConfirmationTemplate({
                    order:
                        createOrder(),

                    storeName:
                        "L'ÉTERNEL",

                    appOrigin:
                        "https://shop.example.com"
                });

        assert.match(
            template.html,
            /Thank you for your order/
        );

        assert.match(
            template.html,
            /LET-20260719-ORDER001/
        );

        assert.match(
            template.html,
            /Signature Coat/
        );

        assert.match(
            template.html,
            /Silk Dress/
        );

        assert.match(
            template.html,
            /10 Example Road/
        );

        assert.match(
            template.html,
            /https:\/\/shop\.example\.com\/account\/orders\/order-1/
        );

        assert.match(
            template.text,
            /Samuel Udom/
        );

        assert.match(
            template.text,
            /Total:/
        );
    }
);

test(
    "order confirmation template supports missing order URL",
    function () {
        const template =
            emailService
                .buildOrderConfirmationTemplate({
                    order:
                        createOrder(),

                    storeName:
                        "L'ÉTERNEL",

                    appOrigin:
                        ""
                });

        assert.doesNotMatch(
            template.html,
            /View your order/
        );

        assert.doesNotMatch(
            template.text,
            /View your order:/
        );
    }
);

test(
    "order confirmation template handles missing customer name",
    function () {
        const order =
            createOrder({
                customer: {
                    email:
                        "customer@example.com"
                }
            });

        const template =
            emailService
                .buildOrderConfirmationTemplate({
                    order:
                        order,

                    storeName:
                        "L'ÉTERNEL"
                });

        assert.match(
            template.html,
            /Dear Customer/
        );

        assert.match(
            template.text,
            /Dear Customer/
        );
    }
);

/* ==========================================================
   ORDER STATUS TEMPLATE
========================================================== */

test(
    "order status template includes current order state",
    function () {
        const template =
            emailService
                .buildOrderStatusTemplate({
                    order:
                        createOrder({
                            status:
                                "shipped",

                            paymentStatus:
                                "paid"
                        }),

                    storeName:
                        "L'ÉTERNEL",

                    appOrigin:
                        "https://shop.example.com"
                });

        assert.equal(
            template.subject,
            "LET-20260719-ORDER001 — Shipped"
        );

        assert.match(
            template.html,
            /now shipped/
        );

        assert.match(
            template.html,
            /Shipped/
        );

        assert.match(
            template.text,
            /Status: Shipped/
        );
    }
);

/* ==========================================================
   PAYMENT RECEIPT TEMPLATE
========================================================== */

test(
    "payment receipt includes total and payment reference",
    function () {
        const template =
            emailService
                .buildPaymentReceiptTemplate({
                    order:
                        createOrder(),

                    storeName:
                        "L'ÉTERNEL",

                    appOrigin:
                        "https://shop.example.com"
                });

        assert.equal(
            template.subject,
            "Payment received — LET-20260719-ORDER001"
        );

        assert.match(
            template.html,
            /Payment received/
        );

        assert.match(
            template.html,
            /LET-PS-REFERENCE/
        );

        assert.match(
            template.text,
            /Reference: LET-PS-REFERENCE/
        );
    }
);

test(
    "payment receipt supports nested payment reference",
    function () {
        const template =
            emailService
                .buildPaymentReceiptTemplate({
                    order:
                        createOrder({
                            paymentReference:
                                "",

                            payment: {
                                providerReference:
                                    "NESTED-REFERENCE"
                            }
                        }),

                    storeName:
                        "L'ÉTERNEL"
                });

        assert.match(
            template.html,
            /NESTED-REFERENCE/
        );
    }
);

/* ==========================================================
   RESEND PROVIDER
========================================================== */

test(
    "sendWithResend posts a normalized email payload",
    async function () {
        const fetchMock =
            mockFetch({
                status:
                    200,

                body: {
                    id:
                        "email-message-1"
                }
            });

        try {
            const result =
                await emailService
                    ._internal
                    .sendWithResend({
                        apiKey:
                            "resend-api-key",

                        from:
                            "L'ÉTERNEL <orders@example.com>",

                        to:
                            "customer@example.com",

                        subject:
                            "Order received",

                        html:
                            "<p>Order received</p>",

                        text:
                            "Order received",

                        metadata: {
                            type:
                                "order-confirmation",

                            orderId:
                                "order-1"
                        }
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
                "email-message-1"
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
                call.options.headers
                    .Authorization,
                "Bearer resend-api-key"
            );

            const body =
                JSON.parse(
                    call.options.body
                );

            assert.equal(
                body.from,
                "L'ÉTERNEL <orders@example.com>"
            );

            assert.deepEqual(
                body.to,
                [
                    "customer@example.com"
                ]
            );

            assert.equal(
                body.subject,
                "Order received"
            );

            assert.equal(
                body.tags[0].name,
                "type"
            );
        } finally {
            fetchMock.restore();
        }
    }
);

test(
    "sendWithResend requires a provider message identifier",
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
                    ._internal
                    .sendWithResend({
                        apiKey:
                            "resend-api-key",

                        from:
                            "orders@example.com",

                        to:
                            "customer@example.com",

                        subject:
                            "Test",

                        html:
                            "<p>Test</p>",

                        text:
                            "Test"
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
   SENDGRID PROVIDER
========================================================== */

test(
    "sendWithSendGrid creates personalizations and content",
    async function () {
        const fetchMock =
            mockFetch({
                status:
                    202,

                body:
                    "",

                headers: {
                    "x-message-id":
                        "sendgrid-message-1"
                }
            });

        try {
            const result =
                await emailService
                    ._internal
                    .sendWithSendGrid({
                        apiKey:
                            "sendgrid-api-key",

                        from:
                            "L'ÉTERNEL <orders@example.com>",

                        to:
                            "customer@example.com",

                        subject:
                            "Payment received",

                        html:
                            "<p>Payment received</p>",

                        text:
                            "Payment received",

                        metadata: {
                            type:
                                "payment-receipt",

                            orderId:
                                "order-1"
                        }
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
                "sendgrid-message-1"
            );

            const body =
                JSON.parse(
                    fetchMock.calls[0]
                        .options.body
                );

            assert.equal(
                body.personalizations[0]
                    .to[0].email,
                "customer@example.com"
            );

            assert.equal(
                body.personalizations[0]
                    .subject,
                "Payment received"
            );

            assert.deepEqual(
                body.from,
                {
                    name:
                        "L'ÉTERNEL",

                    email:
                        "orders@example.com"
                }
            );

            assert.equal(
                body.content[0].type,
                "text/plain"
            );

            assert.equal(
                body.content[1].type,
                "text/html"
            );
        } finally {
            fetchMock.restore();
        }
    }
);

/* ==========================================================
   GENERIC PROVIDER DISPATCH
========================================================== */

test(
    "sendEmail dispatches to Resend",
    async function () {
        const fetchMock =
            mockFetch({
                body: {
                    id:
                        "resend-message-1"
                }
            });

        try {
            const result =
                await emailService
                    .sendEmail({
                        provider:
                            "resend",

                        apiKey:
                            "api-key",

                        from:
                            "orders@example.com",

                        to:
                            "customer@example.com",

                        subject:
                            "Test",

                        html:
                            "<p>Test</p>",

                        text:
                            "Test"
                    });

            assert.equal(
                result.provider,
                "resend"
            );
        } finally {
            fetchMock.restore();
        }
    }
);

test(
    "sendEmail dispatches to SendGrid",
    async function () {
        const fetchMock =
            mockFetch({
                status:
                    202,

                body:
                    ""
            });

        try {
            const result =
                await emailService
                    .sendEmail({
                        provider:
                            "sendgrid",

                        apiKey:
                            "api-key",

                        from:
                            "orders@example.com",

                        to:
                            "customer@example.com",

                        subject:
                            "Test",

                        html:
                            "<p>Test</p>",

                        text:
                            "Test"
                    });

            assert.equal(
                result.provider,
                "sendgrid"
            );
        } finally {
            fetchMock.restore();
        }
    }
);

test(
    "sendEmail rejects an unsupported provider",
    async function () {
        await assert.rejects(
            emailService.sendEmail({
                provider:
                    "smtp",

                apiKey:
                    "api-key",

                from:
                    "orders@example.com",

                to:
                    "customer@example.com",

                subject:
                    "Test",

                html:
                    "<p>Test</p>",

                text:
                    "Test"
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

/* ==========================================================
   ORDER EMAIL FUNCTIONS
========================================================== */

test(
    "sendOrderConfirmation sends to the order customer",
    async function () {
        const fetchMock =
            mockFetch({
                body: {
                    id:
                        "confirmation-message-1"
                }
            });

        try {
            const result =
                await emailService
                    .sendOrderConfirmation({
                        order:
                            createOrder(),

                        configuration: {
                            provider:
                                "resend",

                            apiKey:
                                "resend-key",

                            from:
                                "orders@example.com",

                            storeName:
                                "L'ÉTERNEL",

                            appOrigin:
                                "https://shop.example.com"
                        }
                    });

            assert.equal(
                result.success,
                true
            );

            assert.equal(
                result.recipient,
                "samuel@example.com"
            );

            const payload =
                JSON.parse(
                    fetchMock.calls[0]
                        .options.body
                );

            assert.match(
                payload.subject,
                /Order received/
            );

            assert.match(
                payload.html,
                /Signature Coat/
            );
        } finally {
            fetchMock.restore();
        }
    }
);

test(
    "sendOrderStatusUpdate sends the current status",
    async function () {
        const fetchMock =
            mockFetch({
                body: {
                    id:
                        "status-message-1"
                }
            });

        try {
            const result =
                await emailService
                    .sendOrderStatusUpdate({
                        order:
                            createOrder({
                                status:
                                    "delivered"
                            }),

                        configuration: {
                            provider:
                                "resend",

                            apiKey:
                                "resend-key",

                            from:
                                "orders@example.com",

                            storeName:
                                "L'ÉTERNEL"
                        }
                    });

            assert.equal(
                result.success,
                true
            );

            const payload =
                JSON.parse(
                    fetchMock.calls[0]
                        .options.body
                );

            assert.match(
                payload.subject,
                /Delivered/
            );

            assert.match(
                payload.text,
                /Status: Delivered/
            );
        } finally {
            fetchMock.restore();
        }
    }
);

test(
    "sendPaymentReceipt sends a receipt message",
    async function () {
        const fetchMock =
            mockFetch({
                body: {
                    id:
                        "receipt-message-1"
                }
            });

        try {
            const result =
                await emailService
                    .sendPaymentReceipt({
                        order:
                            createOrder(),

                        configuration: {
                            provider:
                                "resend",

                            apiKey:
                                "resend-key",

                            from:
                                "orders@example.com",

                            storeName:
                                "L'ÉTERNEL"
                        }
                    });

            assert.equal(
                result.messageId,
                "receipt-message-1"
            );

            const payload =
                JSON.parse(
                    fetchMock.calls[0]
                        .options.body
                );

            assert.match(
                payload.subject,
                /Payment received/
            );

            assert.match(
                payload.html,
                /LET-PS-REFERENCE/
            );
        } finally {
            fetchMock.restore();
        }
    }
);

test(
    "order email functions reject invalid customer email",
    async function () {
        await assert.rejects(
            emailService
                .sendOrderConfirmation({
                    order:
                        createOrder({
                            customer: {
                                displayName:
                                    "Customer",

                                email:
                                    "invalid-email"
                            }
                        }),

                    configuration: {
                        provider:
                            "resend",

                        apiKey:
                            "resend-key",

                        from:
                            "orders@example.com",

                        storeName:
                            "L'ÉTERNEL"
                    }
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
    "order email functions require an API key",
    async function () {
        await assert.rejects(
            emailService
                .sendOrderConfirmation({
                    order:
                        createOrder(),

                    configuration: {
                        provider:
                            "resend",

                        from:
                            "orders@example.com",

                        storeName:
                            "L'ÉTERNEL"
                    }
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

/* ==========================================================
   PROVIDER REQUEST ERRORS
========================================================== */

test(
    "emailProviderRequest maps rate limiting",
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
                    ._internal
                    .emailProviderRequest({
                        url:
                            "https://example.com/email",

                        method:
                            "POST",

                        provider:
                            "Example",

                        body: {
                            test:
                                true
                        }
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
    "emailProviderRequest hides provider authentication failures",
    async function () {
        const fetchMock =
            mockFetch({
                ok:
                    false,

                status:
                    401,

                body: {
                    message:
                        "Invalid API key"
                }
            });

        try {
            await assert.rejects(
                emailService
                    ._internal
                    .emailProviderRequest({
                        url:
                            "https://example.com/email",

                        provider:
                            "Example",

                        body: {}
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

                    return true;
                }
            );
        } finally {
            fetchMock.restore();
        }
    }
);

test(
    "emailProviderRequest accepts non-JSON success responses",
    async function () {
        const fetchMock =
            mockFetch({
                status:
                    200,

                body:
                    "accepted"
            });

        try {
            const result =
                await emailService
                    ._internal
                    .emailProviderRequest({
                        url:
                            "https://example.com/email",

                        provider:
                            "Example",

                        body: {}
                    });

            assert.deepEqual(
                result,
                {
                    raw:
                        "accepted"
                }
            );
        } finally {
            fetchMock.restore();
        }
    }
);

test(
    "emailProviderRequest returns an empty provider result when allowed",
    async function () {
        const fetchMock =
            mockFetch({
                status:
                    202,

                body:
                    "",

                headers: {
                    "x-message-id":
                        "message-123"
                }
            });

        try {
            const result =
                await emailService
                    ._internal
                    .emailProviderRequest({
                        url:
                            "https://example.com/email",

                        provider:
                            "Example",

                        body: {},

                        allowEmptyResponse:
                            true
                    });

            assert.deepEqual(
                result,
                {
                    messageId:
                        "message-123"
                }
            );
        } finally {
            fetchMock.restore();
        }
    }
);