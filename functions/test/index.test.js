"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   CLOUD FUNCTIONS ENTRY-POINT TESTS
========================================================== */

const test = require("node:test");

const assert = require(
    "node:assert/strict"
);

const functionsTestFactory = require(
    "firebase-functions-test"
);

/* ==========================================================
   TEST ENVIRONMENT
========================================================== */

const functionsTest =
    functionsTestFactory(
        {
            projectId:
                "leternel-store-functions-test",

            storageBucket:
                "leternel-store-functions-test.appspot.com"
        }
    );

let functions;

/* ==========================================================
   LIFECYCLE
========================================================== */

test.before(
    function () {
        /*
         * Set non-secret parameters before loading index.js.
         * Secret values are intentionally fake test credentials.
         */
        process.env.APP_ORIGIN =
            "https://shop.example.com";

        process.env.STORE_NAME =
            "L'ÉTERNEL";

        process.env.STORE_CURRENCY =
            "NGN";

        process.env.PAYMENT_PROVIDER =
            "paystack";

        process.env.PAYSTACK_SECRET_KEY =
            "paystack-test-secret";

        process.env.PAYSTACK_WEBHOOK_SECRET =
            "paystack-webhook-test-secret";

        process.env.FLUTTERWAVE_SECRET_KEY =
            "flutterwave-test-secret";

        process.env.FLUTTERWAVE_WEBHOOK_SECRET =
            "flutterwave-webhook-test-secret";

        process.env.EMAIL_API_KEY =
            "email-test-key";

        process.env.ORDER_EMAIL_FROM =
            "orders@example.com";

        process.env.EMAIL_PROVIDER =
            "resend";

        functions = require(
            "../index"
        );
    }
);

test.after(
    function () {
        functionsTest.cleanup();
    }
);

/* ==========================================================
   EXPORTED FUNCTIONS
========================================================== */

test(
    "index exports all required Cloud Functions",
    function () {
        const expectedExports = [
            "createOrder",
            "paymentWebhook",
            "ordersApi",
            "adminApi",
            "getOrder",
            "cancelOrder",
            "setUserRole",
            "setUserStatus",
            "onUserProfileCreated",
            "onUserProfileUpdated",
            "onOrderCreated",
            "health"
        ];

        expectedExports.forEach(
            function (functionName) {
                assert.ok(
                    functions[
                        functionName
                    ],
                    functionName +
                        " should be exported"
                );

                assert.equal(
                    typeof functions[
                        functionName
                    ],
                    "function",
                    functionName +
                        " should be a function"
                );
            }
        );
    }
);

test(
    "index does not expose internal services",
    function () {
        assert.equal(
            functions.orderService,
            undefined
        );

        assert.equal(
            functions.paymentService,
            undefined
        );

        assert.equal(
            functions.adminService,
            undefined
        );

        assert.equal(
            functions.accountService,
            undefined
        );

        assert.equal(
            functions.emailService,
            undefined
        );
    }
);

/* ==========================================================
   FUNCTION METADATA
========================================================== */

test(
    "HTTP functions expose runnable handlers",
    function () {
        [
            "paymentWebhook",
            "ordersApi",
            "adminApi",
            "health"
        ].forEach(
            function (functionName) {
                const cloudFunction =
                    functions[
                        functionName
                    ];

                assert.equal(
                    typeof cloudFunction,
                    "function"
                );

                assert.ok(
                    cloudFunction
                        .__endpoint ||
                    cloudFunction
                        .run ||
                    cloudFunction
                        .handler,
                    functionName +
                        " should expose Cloud Functions metadata"
                );
            }
        );
    }
);

test(
    "callable functions expose callable metadata",
    function () {
        [
            "createOrder",
            "getOrder",
            "cancelOrder",
            "setUserRole",
            "setUserStatus"
        ].forEach(
            function (functionName) {
                const cloudFunction =
                    functions[
                        functionName
                    ];

                assert.equal(
                    typeof cloudFunction,
                    "function"
                );

                assert.ok(
                    cloudFunction
                        .__endpoint ||
                    cloudFunction
                        .run,
                    functionName +
                        " should expose callable metadata"
                );
            }
        );
    }
);

/* ==========================================================
   HEALTH ENDPOINT
========================================================== */

test(
    "health endpoint returns a successful service response",
    async function () {
        const wrapped =
            functionsTest.wrap(
                functions.health
            );

        const request =
            createHttpRequest({
                method:
                    "GET",

                path:
                    "/health"
            });

        const response =
            createHttpResponse();

        await wrapped(
            request,
            response.response
        );

        assert.equal(
            response.state.statusCode,
            200
        );

        assert.equal(
            response.state.body
                .success,
            true
        );

        assert.equal(
            response.state.body
                .service,
            "leternel-store-functions"
        );

        assert.equal(
            response.state.body
                .status,
            "healthy"
        );

        assert.match(
            response.state.body
                .timestamp,
            /^\d{4}-\d{2}-\d{2}T/
        );
    }
);

test(
    "health endpoint rejects unsupported methods",
    async function () {
        const wrapped =
            functionsTest.wrap(
                functions.health
            );

        const request =
            createHttpRequest({
                method:
                    "POST",

                path:
                    "/health"
            });

        const response =
            createHttpResponse();

        await wrapped(
            request,
            response.response
        );

        assert.equal(
            response.state.statusCode,
            405
        );

        assert.equal(
            response.state.body
                .success,
            false
        );

        assert.equal(
            response.state.body
                .error.code,
            "method-not-allowed"
        );
    }
);

/* ==========================================================
   CREATE ORDER CALLABLE
========================================================== */

test(
    "createOrder rejects unauthenticated callable requests",
    async function () {
        const wrapped =
            functionsTest.wrap(
                functions.createOrder
            );

        await assert.rejects(
            wrapped(
                {
                    items: [
                        {
                            productId:
                                "product-1",

                            quantity:
                                1
                        }
                    ]
                },
                {
                    auth:
                        null
                }
            ),
            function (error) {
                assert.match(
                    String(
                        error.code || ""
                    ),
                    /unauthenticated/
                );

                return true;
            }
        );
    }
);

test(
    "createOrder validates the callable payload before database work",
    async function () {
        const wrapped =
            functionsTest.wrap(
                functions.createOrder
            );

        await assert.rejects(
            wrapped(
                {
                    items: []
                },
                {
                    auth: {
                        uid:
                            "customer-1",

                        token: {
                            email:
                                "customer@example.com",

                            email_verified:
                                true,

                            role:
                                "customer"
                        }
                    },

                    app: {
                        token:
                            "app-check-token",

                        appId:
                            "test-app"
                    }
                }
            ),
            function (error) {
                assert.match(
                    String(
                        error.code || ""
                    ),
                    /invalid-argument/
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   GET ORDER CALLABLE
========================================================== */

test(
    "getOrder rejects unauthenticated requests",
    async function () {
        const wrapped =
            functionsTest.wrap(
                functions.getOrder
            );

        await assert.rejects(
            wrapped(
                {
                    orderId:
                        "order-1"
                },
                {
                    auth:
                        null
                }
            ),
            function (error) {
                assert.match(
                    String(
                        error.code || ""
                    ),
                    /unauthenticated/
                );

                return true;
            }
        );
    }
);

test(
    "getOrder validates the order identifier",
    async function () {
        const wrapped =
            functionsTest.wrap(
                functions.getOrder
            );

        await assert.rejects(
            wrapped(
                {
                    orderId:
                        "invalid/order"
                },
                {
                    auth: {
                        uid:
                            "customer-1",

                        token: {
                            role:
                                "customer"
                        }
                    }
                }
            ),
            function (error) {
                assert.match(
                    String(
                        error.code || ""
                    ),
                    /invalid-argument/
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   CANCEL ORDER CALLABLE
========================================================== */

test(
    "cancelOrder rejects unauthenticated requests",
    async function () {
        const wrapped =
            functionsTest.wrap(
                functions.cancelOrder
            );

        await assert.rejects(
            wrapped(
                {
                    orderId:
                        "order-1"
                },
                {
                    auth:
                        null
                }
            ),
            function (error) {
                assert.match(
                    String(
                        error.code || ""
                    ),
                    /unauthenticated/
                );

                return true;
            }
        );
    }
);

test(
    "cancelOrder validates cancellation reason length",
    async function () {
        const wrapped =
            functionsTest.wrap(
                functions.cancelOrder
            );

        await assert.rejects(
            wrapped(
                {
                    orderId:
                        "order-1",

                    reason:
                        "x".repeat(
                            2001
                        )
                },
                {
                    auth: {
                        uid:
                            "customer-1",

                        token: {
                            role:
                                "customer"
                        }
                    }
                }
            ),
            function (error) {
                assert.match(
                    String(
                        error.code || ""
                    ),
                    /invalid-argument/
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   ROLE MANAGEMENT CALLABLE
========================================================== */

test(
    "setUserRole rejects unauthenticated requests",
    async function () {
        const wrapped =
            functionsTest.wrap(
                functions.setUserRole
            );

        await assert.rejects(
            wrapped(
                {
                    userId:
                        "customer-1",

                    role:
                        "admin"
                },
                {
                    auth:
                        null
                }
            ),
            function (error) {
                assert.match(
                    String(
                        error.code || ""
                    ),
                    /unauthenticated/
                );

                return true;
            }
        );
    }
);

test(
    "setUserRole rejects ordinary customers",
    async function () {
        const wrapped =
            functionsTest.wrap(
                functions.setUserRole
            );

        await assert.rejects(
            wrapped(
                {
                    userId:
                        "customer-2",

                    role:
                        "admin"
                },
                {
                    auth: {
                        uid:
                            "customer-1",

                        token: {
                            email:
                                "customer-1@example.com",

                            role:
                                "customer",

                            admin:
                                false
                        }
                    }
                }
            ),
            function (error) {
                assert.match(
                    String(
                        error.code || ""
                    ),
                    /permission-denied/
                );

                return true;
            }
        );
    }
);

test(
    "setUserRole validates role values before account mutation",
    async function () {
        const wrapped =
            functionsTest.wrap(
                functions.setUserRole
            );

        await assert.rejects(
            wrapped(
                {
                    userId:
                        "customer-1",

                    role:
                        "manager"
                },
                {
                    auth: {
                        uid:
                            "superadmin-1",

                        token: {
                            email:
                                "owner@example.com",

                            role:
                                "superadmin",

                            admin:
                                true,

                            superadmin:
                                true
                        }
                    }
                }
            ),
            function (error) {
                assert.match(
                    String(
                        error.code || ""
                    ),
                    /invalid-argument/
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   STATUS MANAGEMENT CALLABLE
========================================================== */

test(
    "setUserStatus rejects unauthenticated requests",
    async function () {
        const wrapped =
            functionsTest.wrap(
                functions.setUserStatus
            );

        await assert.rejects(
            wrapped(
                {
                    userId:
                        "customer-1",

                    status:
                        "disabled"
                },
                {
                    auth:
                        null
                }
            ),
            function (error) {
                assert.match(
                    String(
                        error.code || ""
                    ),
                    /unauthenticated/
                );

                return true;
            }
        );
    }
);

test(
    "setUserStatus rejects invalid status values",
    async function () {
        const wrapped =
            functionsTest.wrap(
                functions.setUserStatus
            );

        await assert.rejects(
            wrapped(
                {
                    userId:
                        "customer-1",

                    status:
                        "suspended"
                },
                {
                    auth: {
                        uid:
                            "admin-1",

                        token: {
                            email:
                                "admin@example.com",

                            role:
                                "admin",

                            admin:
                                true
                        }
                    }
                }
            ),
            function (error) {
                assert.match(
                    String(
                        error.code || ""
                    ),
                    /invalid-argument/
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   PAYMENT WEBHOOK
========================================================== */

test(
    "paymentWebhook rejects unsupported methods",
    async function () {
        const wrapped =
            functionsTest.wrap(
                functions.paymentWebhook
            );

        const request =
            createHttpRequest({
                method:
                    "GET",

                path:
                    "/api/payment-webhook"
            });

        const response =
            createHttpResponse();

        await wrapped(
            request,
            response.response
        );

        assert.equal(
            response.state.statusCode,
            405
        );

        assert.equal(
            response.state.body
                .error.code,
            "method-not-allowed"
        );
    }
);

test(
    "paymentWebhook rejects unknown providers",
    async function () {
        const wrapped =
            functionsTest.wrap(
                functions.paymentWebhook
            );

        const request =
            createHttpRequest({
                method:
                    "POST",

                path:
                    "/api/payment-webhook",

                body: {
                    event:
                        "unknown"
                },

                rawBody:
                    Buffer.from(
                        JSON.stringify({
                            event:
                                "unknown"
                        }),
                        "utf8"
                    )
            });

        const response =
            createHttpResponse();

        await wrapped(
            request,
            response.response
        );

        assert.equal(
            response.state.statusCode,
            401
        );

        assert.equal(
            response.state.body
                .success,
            false
        );

        assert.equal(
            response.state.body
                .error.code,
            "invalid-signature"
        );
    }
);

/* ==========================================================
   ORDERS HTTP API
========================================================== */

test(
    "ordersApi rejects requests without bearer authentication",
    async function () {
        const wrapped =
            functionsTest.wrap(
                functions.ordersApi
            );

        const request =
            createHttpRequest({
                method:
                    "GET",

                path:
                    "/api/orders"
            });

        const response =
            createHttpResponse();

        await wrapped(
            request,
            response.response
        );

        assert.equal(
            response.state.statusCode,
            401
        );

        assert.equal(
            response.state.body
                .error.code,
            "unauthenticated"
        );
    }
);

test(
    "ordersApi handles CORS preflight",
    async function () {
        const wrapped =
            functionsTest.wrap(
                functions.ordersApi
            );

        const request =
            createHttpRequest({
                method:
                    "OPTIONS",

                path:
                    "/api/orders",

                headers: {
                    origin:
                        "https://shop.example.com",

                    "access-control-request-method":
                        "GET"
                }
            });

        const response =
            createHttpResponse();

        await wrapped(
            request,
            response.response
        );

        assert.equal(
            response.state.statusCode,
            204
        );
    }
);

/* ==========================================================
   ADMIN HTTP API
========================================================== */

test(
    "adminApi rejects requests without bearer authentication",
    async function () {
        const wrapped =
            functionsTest.wrap(
                functions.adminApi
            );

        const request =
            createHttpRequest({
                method:
                    "GET",

                path:
                    "/api/admin/metrics"
            });

        const response =
            createHttpResponse();

        await wrapped(
            request,
            response.response
        );

        assert.equal(
            response.state.statusCode,
            401
        );

        assert.equal(
            response.state.body
                .error.code,
            "unauthenticated"
        );
    }
);

test(
    "adminApi handles CORS preflight",
    async function () {
        const wrapped =
            functionsTest.wrap(
                functions.adminApi
            );

        const request =
            createHttpRequest({
                method:
                    "OPTIONS",

                path:
                    "/api/admin/metrics",

                headers: {
                    origin:
                        "https://shop.example.com",

                    "access-control-request-method":
                        "GET"
                }
            });

        const response =
            createHttpResponse();

        await wrapped(
            request,
            response.response
        );

        assert.equal(
            response.state.statusCode,
            204
        );
    }
);

/* ==========================================================
   FIRESTORE TRIGGERS
========================================================== */

test(
    "onUserProfileCreated is exported as a Firestore trigger",
    function () {
        const trigger =
            functions
                .onUserProfileCreated;

        assert.equal(
            typeof trigger,
            "function"
        );

        assert.ok(
            trigger.__endpoint ||
            trigger.run
        );
    }
);

test(
    "onUserProfileUpdated is exported as a Firestore trigger",
    function () {
        const trigger =
            functions
                .onUserProfileUpdated;

        assert.equal(
            typeof trigger,
            "function"
        );

        assert.ok(
            trigger.__endpoint ||
            trigger.run
        );
    }
);

test(
    "onOrderCreated is exported as a Firestore trigger",
    function () {
        const trigger =
            functions
                .onOrderCreated;

        assert.equal(
            typeof trigger,
            "function"
        );

        assert.ok(
            trigger.__endpoint ||
            trigger.run
        );
    }
);

/* ==========================================================
   REGION CONFIGURATION
========================================================== */

test(
    "deployed endpoints use the configured European region",
    function () {
        const endpointNames = [
            "createOrder",
            "paymentWebhook",
            "ordersApi",
            "adminApi",
            "getOrder",
            "cancelOrder",
            "setUserRole",
            "setUserStatus",
            "onUserProfileCreated",
            "onUserProfileUpdated",
            "onOrderCreated",
            "health"
        ];

        endpointNames.forEach(
            function (name) {
                const endpoint =
                    functions[name] &&
                    functions[name]
                        .__endpoint;

                if (
                    endpoint &&
                    endpoint.region
                ) {
                    const regions =
                        Array.isArray(
                            endpoint.region
                        )
                            ? endpoint.region
                            : [
                                  endpoint.region
                              ];

                    assert.ok(
                        regions.includes(
                            "europe-west1"
                        ),
                        name +
                            " should deploy to europe-west1"
                    );
                }
            }
        );
    }
);

/* ==========================================================
   HTTP TEST UTILITIES
========================================================== */

function createHttpRequest(options) {
    const settings =
        options || {};

    const headers =
        Object.keys(
            settings.headers || {}
        ).reduce(
            function (
                result,
                name
            ) {
                result[
                    name.toLowerCase()
                ] =
                    settings.headers[
                        name
                    ];

                return result;
            },
            {}
        );

    return {
        method:
            settings.method ||
            "GET",

        path:
            settings.path ||
            "/",

        url:
            settings.url ||
            settings.path ||
            "/",

        originalUrl:
            settings.url ||
            settings.path ||
            "/",

        query:
            settings.query ||
            {},

        body:
            settings.body,

        rawBody:
            settings.rawBody,

        headers:
            headers,

        ip:
            settings.ip ||
            "127.0.0.1",

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

function createHttpResponse() {
    const state = {
        statusCode:
            200,

        headers: {},

        body:
            undefined,

        sent:
            false
    };

    const response = {
        headersSent:
            false,

        status:
            function (statusCode) {
                state.statusCode =
                    Number(
                        statusCode
                    );

                return response;
            },

        set:
            function (
                name,
                value
            ) {
                if (
                    name &&
                    typeof name ===
                        "object"
                ) {
                    Object.keys(name)
                        .forEach(
                            function (
                                key
                            ) {
                                state.headers[
                                    key
                                ] =
                                    String(
                                        name[key]
                                    );
                            }
                        );

                    return response;
                }

                state.headers[
                    name
                ] =
                    String(value);

                return response;
            },

        setHeader:
            function (
                name,
                value
            ) {
                state.headers[
                    name
                ] =
                    String(value);

                return response;
            },

        getHeader:
            function (name) {
                return state.headers[
                    name
                ];
            },

        json:
            function (value) {
                state.body =
                    value;

                state.sent =
                    true;

                response.headersSent =
                    true;

                return response;
            },

        send:
            function (value) {
                state.body =
                    value;

                state.sent =
                    true;

                response.headersSent =
                    true;

                return response;
            },

        end:
            function (value) {
                if (
                    value !==
                    undefined
                ) {
                    state.body =
                        value;
                }

                state.sent =
                    true;

                response.headersSent =
                    true;

                return response;
            }
    };

    return {
        response:
            response,

        state:
            state
    };
}