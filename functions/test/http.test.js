"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   HTTP UTILITY TESTS
========================================================== */

const test = require("node:test");

const assert = require(
    "node:assert/strict"
);

const http = require(
    "../src/shared/http"
);

const {
    createServiceError
} = require(
    "../src/shared/validation"
);

/* ==========================================================
   TEST HELPERS
========================================================== */

function createResponse() {
    const state = {
        statusCode: null,
        headers: {},
        body: undefined,
        sent: false
    };

    const response = {
        headersSent: false,

        status:
            function (statusCode) {
                state.statusCode =
                    statusCode;

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

        json:
            function (body) {
                state.body = body;
                state.sent = true;
                response.headersSent =
                    true;

                return response;
            },

        send:
            function (body) {
                state.body = body;
                state.sent = true;
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

function createRequest(options) {
    const settings =
        options || {};

    return {
        method:
            settings.method ||
            "GET",

        headers:
            normalizeHeaders(
                settings.headers ||
                {}
            ),

        body:
            settings.body,

        query:
            settings.query ||
            {},

        path:
            settings.path ||
            "",

        url:
            settings.url ||
            settings.path ||
            "",

        ip:
            settings.ip ||
            "127.0.0.1"
    };
}

function normalizeHeaders(headers) {
    return Object.keys(headers)
        .reduce(
            function (
                output,
                key
            ) {
                output[
                    key.toLowerCase()
                ] =
                    headers[key];

                return output;
            },
            {}
        );
}

/* ==========================================================
   JSON RESPONSES
========================================================== */

test(
    "sendJson writes status, headers, and JSON body",
    function () {
        const fixture =
            createResponse();

        http.sendJson(
            fixture.response,
            201,
            {
                created: true
            }
        );

        assert.equal(
            fixture.state
                .statusCode,
            201
        );

        assert.deepEqual(
            fixture.state.body,
            {
                created: true
            }
        );

        assert.equal(
            fixture.state.headers[
                "Cache-Control"
            ],
            "no-store"
        );

        assert.equal(
            fixture.state.headers[
                "Content-Type"
            ],
            "application/json; charset=utf-8"
        );
    }
);

test(
    "sendJson normalizes invalid status codes",
    function () {
        const fixture =
            createResponse();

        http.sendJson(
            fixture.response,
            "invalid",
            {
                ok: true
            }
        );

        assert.equal(
            fixture.state
                .statusCode,
            200
        );
    }
);

test(
    "sendJson sends null for undefined payload",
    function () {
        const fixture =
            createResponse();

        http.sendJson(
            fixture.response,
            200,
            undefined
        );

        assert.equal(
            fixture.state.body,
            null
        );
    }
);

test(
    "sendSuccess wraps data in a success envelope",
    function () {
        const fixture =
            createResponse();

        http.sendSuccess(
            fixture.response,
            {
                orderId:
                    "order-1"
            },
            {
                status:
                    201,

                message:
                    "Order created.",

                meta: {
                    requestId:
                        "request-1"
                }
            }
        );

        assert.equal(
            fixture.state
                .statusCode,
            201
        );

        assert.deepEqual(
            fixture.state.body,
            {
                success:
                    true,

                data: {
                    orderId:
                        "order-1"
                },

                message:
                    "Order created.",

                meta: {
                    requestId:
                        "request-1"
                }
            }
        );
    }
);

test(
    "sendNoContent sends an empty response",
    function () {
        const fixture =
            createResponse();

        http.sendNoContent(
            fixture.response
        );

        assert.equal(
            fixture.state
                .statusCode,
            204
        );

        assert.equal(
            fixture.state.body,
            undefined
        );

        assert.equal(
            fixture.state.sent,
            true
        );
    }
);

/* ==========================================================
   ERROR RESPONSES
========================================================== */

test(
    "sendError returns a normalized public error",
    function () {
        const fixture =
            createResponse();

        http.sendError(
            fixture.response,
            createServiceError(
                "not-found",
                "Order not found.",
                {
                    status:
                        404,

                    details: {
                        orderId:
                            "order-1"
                    }
                }
            )
        );

        assert.equal(
            fixture.state
                .statusCode,
            404
        );

        assert.deepEqual(
            fixture.state.body,
            {
                success:
                    false,

                error: {
                    code:
                        "not-found",

                    message:
                        "Order not found."
                }
            }
        );
    }
);

test(
    "sendError can expose safe details",
    function () {
        const fixture =
            createResponse();

        http.sendError(
            fixture.response,
            createServiceError(
                "invalid-argument",
                "Invalid request.",
                {
                    status:
                        400,

                    details: {
                        field:
                            "email"
                    }
                }
            ),
            {
                exposeDetails:
                    true
            }
        );

        assert.deepEqual(
            fixture.state.body
                .error.details,
            {
                field:
                    "email"
            }
        );
    }
);

test(
    "internal errors use a generic public message",
    function () {
        const normalized =
            http.normalizeHttpError(
                new Error(
                    "Database credentials leaked"
                )
            );

        assert.equal(
            normalized.status,
            500
        );

        assert.equal(
            normalized.publicMessage,
            "The request could not be completed."
        );
    }
);

test(
    "client errors preserve their message",
    function () {
        const normalized =
            http.normalizeHttpError(
                createServiceError(
                    "invalid-argument",
                    "Enter a valid email.",
                    {
                        status:
                            400
                    }
                )
            );

        assert.equal(
            normalized.status,
            400
        );

        assert.equal(
            normalized.publicMessage,
            "Enter a valid email."
        );
    }
);

test(
    "handleHttpError does nothing after headers are sent",
    function () {
        const fixture =
            createResponse();

        fixture.response
            .headersSent = true;

        http.handleHttpError(
            fixture.response,
            new Error(
                "Failure"
            )
        );

        assert.equal(
            fixture.state.sent,
            false
        );
    }
);

/* ==========================================================
   ERROR CODE MAPPING
========================================================== */

test(
    "normalizeErrorCode maps common aliases",
    function () {
        assert.equal(
            http.normalizeErrorCode(
                "unauthorized"
            ),
            "unauthenticated"
        );

        assert.equal(
            http.normalizeErrorCode(
                "forbidden"
            ),
            "permission-denied"
        );

        assert.equal(
            http.normalizeErrorCode(
                "validation"
            ),
            "invalid-argument"
        );

        assert.equal(
            http.normalizeErrorCode(
                "functions/not-found"
            ),
            "not-found"
        );
    }
);

test(
    "mapCodeToStatus maps service errors",
    function () {
        assert.equal(
            http.mapCodeToStatus(
                "unauthenticated"
            ),
            401
        );

        assert.equal(
            http.mapCodeToStatus(
                "permission-denied"
            ),
            403
        );

        assert.equal(
            http.mapCodeToStatus(
                "out-of-stock"
            ),
            409
        );

        assert.equal(
            http.mapCodeToStatus(
                "payment-failed"
            ),
            402
        );

        assert.equal(
            http.mapCodeToStatus(
                "unknown-code"
            ),
            500
        );
    }
);

/* ==========================================================
   METHODS
========================================================== */

test(
    "requireMethod accepts an allowed method",
    function () {
        const request =
            createRequest({
                method:
                    "post"
            });

        assert.equal(
            http.requireMethod(
                request,
                [
                    "GET",
                    "POST"
                ]
            ),
            "POST"
        );
    }
);

test(
    "requireMethod rejects unsupported methods",
    function () {
        assert.throws(
            function () {
                http.requireMethod(
                    createRequest({
                        method:
                            "DELETE"
                    }),
                    [
                        "GET",
                        "POST"
                    ]
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "method-not-allowed"
                );

                assert.equal(
                    error.status,
                    405
                );

                assert.deepEqual(
                    error.details
                        .allowedMethods,
                    [
                        "GET",
                        "POST"
                    ]
                );

                return true;
            }
        );
    }
);

test(
    "rejectUnsupportedMethod sends Allow header",
    function () {
        const fixture =
            createResponse();

        http.rejectUnsupportedMethod(
            fixture.response,
            [
                "GET",
                "POST"
            ]
        );

        assert.equal(
            fixture.state
                .statusCode,
            405
        );

        assert.equal(
            fixture.state.headers
                .Allow,
            "GET, POST"
        );

        assert.equal(
            fixture.state.body
                .error.code,
            "method-not-allowed"
        );
    }
);

/* ==========================================================
   JSON BODY PARSING
========================================================== */

test(
    "parseJsonBody accepts a plain object",
    function () {
        const body = {
            name:
                "Signature Coat"
        };

        assert.equal(
            http.parseJsonBody(
                createRequest({
                    body:
                        body
                })
            ),
            body
        );
    }
);

test(
    "parseJsonBody parses JSON strings",
    function () {
        const result =
            http.parseJsonBody(
                createRequest({
                    body:
                        "{\"quantity\":2}"
                })
            );

        assert.deepEqual(
            result,
            {
                quantity:
                    2
            }
        );
    }
);

test(
    "parseJsonBody parses buffer content",
    function () {
        const result =
            http.parseJsonBody(
                createRequest({
                    body:
                        Buffer.from(
                            "{\"status\":\"paid\"}",
                            "utf8"
                        )
                })
            );

        assert.deepEqual(
            result,
            {
                status:
                    "paid"
            }
        );
    }
);

test(
    "parseJsonBody returns an empty object for omitted optional body",
    function () {
        assert.deepEqual(
            http.parseJsonBody(
                createRequest()
            ),
            {}
        );
    }
);

test(
    "parseJsonBody rejects an omitted required body",
    function () {
        assert.throws(
            function () {
                http.parseJsonBody(
                    createRequest(),
                    {
                        required:
                            true
                    }
                );
            },
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
    "parseJsonBody rejects malformed JSON",
    function () {
        assert.throws(
            function () {
                http.parseJsonBody(
                    createRequest({
                        body:
                            "{invalid"
                    })
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                assert.equal(
                    error.status,
                    400
                );

                return true;
            }
        );
    }
);

test(
    "parseJsonBody rejects JSON arrays",
    function () {
        assert.throws(
            function () {
                http.parseJsonBody(
                    createRequest({
                        body:
                            "[1,2,3]"
                    })
                );
            },
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
    "parseJsonBody rejects unsupported body types",
    function () {
        assert.throws(
            function () {
                http.parseJsonBody(
                    createRequest({
                        body:
                            42
                    })
                );
            },
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

/* ==========================================================
   CONTENT TYPE & LENGTH
========================================================== */

test(
    "requireJsonContentType accepts application/json",
    function () {
        assert.equal(
            http.requireJsonContentType(
                createRequest({
                    headers: {
                        "Content-Type":
                            "application/json; charset=utf-8"
                    }
                })
            ),
            true
        );
    }
);

test(
    "requireJsonContentType rejects other media types",
    function () {
        assert.throws(
            function () {
                http.requireJsonContentType(
                    createRequest({
                        headers: {
                            "Content-Type":
                                "text/plain"
                        }
                    })
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "unsupported-media-type"
                );

                assert.equal(
                    error.status,
                    415
                );

                return true;
            }
        );
    }
);

test(
    "enforceContentLength permits payloads within the limit",
    function () {
        assert.doesNotThrow(
            function () {
                http.enforceContentLength(
                    createRequest({
                        headers: {
                            "Content-Length":
                                "500"
                        }
                    }),
                    1000
                );
            }
        );
    }
);

test(
    "enforceContentLength rejects oversized payloads",
    function () {
        assert.throws(
            function () {
                http.enforceContentLength(
                    createRequest({
                        headers: {
                            "Content-Length":
                                "2000"
                        }
                    }),
                    1000
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "payload-too-large"
                );

                assert.equal(
                    error.status,
                    413
                );

                assert.equal(
                    error.details
                        .maximumBytes,
                    1000
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   QUERY HELPERS
========================================================== */

test(
    "getQuery normalizes scalar query values",
    function () {
        const query =
            http.getQuery(
                createRequest({
                    query: {
                        status:
                            " pending ",

                        limit:
                            20,

                        missing:
                            null
                    }
                })
            );

        assert.deepEqual(
            query,
            {
                status:
                    "pending",

                limit:
                    "20",

                missing:
                    ""
            }
        );
    }
);

test(
    "getQuery normalizes array values",
    function () {
        const query =
            http.getQuery(
                createRequest({
                    query: {
                        tags: [
                            " new ",
                            "sale"
                        ]
                    }
                })
            );

        assert.deepEqual(
            query,
            {
                tags: [
                    "new",
                    "sale"
                ]
            }
        );
    }
);

/* ==========================================================
   PATH HELPERS
========================================================== */

test(
    "getPathSegments parses and decodes path segments",
    function () {
        const segments =
            http.getPathSegments(
                createRequest({
                    path:
                        "/api/orders/order%201/cancel"
                })
            );

        assert.deepEqual(
            segments,
            [
                "api",
                "orders",
                "order 1",
                "cancel"
            ]
        );
    }
);

test(
    "getPathSegments removes a configured prefix",
    function () {
        const segments =
            http.getPathSegments(
                createRequest({
                    path:
                        "/api/admin/products/product-1"
                }),
                "/api/admin"
            );

        assert.deepEqual(
            segments,
            [
                "products",
                "product-1"
            ]
        );
    }
);

test(
    "getRouteParameter returns a selected segment",
    function () {
        assert.equal(
            http.getRouteParameter(
                createRequest({
                    path:
                        "/orders/order-1/cancel"
                }),
                1
            ),
            "order-1"
        );
    }
);

test(
    "getRouteParameter returns an empty value when missing",
    function () {
        assert.equal(
            http.getRouteParameter(
                createRequest({
                    path:
                        "/orders"
                }),
                5
            ),
            ""
        );
    }
);

/* ==========================================================
   HEADERS
========================================================== */

test(
    "getHeader reads case-normalized headers",
    function () {
        const request =
            createRequest({
                headers: {
                    Authorization:
                        "Bearer token"
                }
            });

        assert.equal(
            http.getHeader(
                request,
                "authorization"
            ),
            "Bearer token"
        );
    }
);

test(
    "getHeader joins array values",
    function () {
        const request =
            createRequest();

        request.headers[
            "x-example"
        ] = [
            "one",
            "two"
        ];

        assert.equal(
            http.getHeader(
                request,
                "x-example"
            ),
            "one, two"
        );
    }
);

test(
    "applyHeaders writes all defined headers",
    function () {
        const fixture =
            createResponse();

        http.applyHeaders(
            fixture.response,
            {
                "X-Test":
                    "value",

                "X-Number":
                    42,

                "X-Skipped":
                    undefined
            }
        );

        assert.equal(
            fixture.state.headers[
                "X-Test"
            ],
            "value"
        );

        assert.equal(
            fixture.state.headers[
                "X-Number"
            ],
            "42"
        );

        assert.equal(
            fixture.state.headers[
                "X-Skipped"
            ],
            undefined
        );
    }
);

/* ==========================================================
   CORS
========================================================== */

test(
    "applyCors allows a configured origin",
    function () {
        const fixture =
            createResponse();

        const handled =
            http.applyCors(
                createRequest({
                    method:
                        "GET",

                    headers: {
                        Origin:
                            "https://shop.example.com"
                    }
                }),
                fixture.response,
                {
                    origins: [
                        "https://shop.example.com"
                    ]
                }
            );

        assert.equal(
            handled,
            false
        );

        assert.equal(
            fixture.state.headers[
                "Access-Control-Allow-Origin"
            ],
            "https://shop.example.com"
        );

        assert.equal(
            fixture.state.headers.Vary,
            "Origin"
        );
    }
);

test(
    "applyCors does not allow an unknown origin",
    function () {
        const fixture =
            createResponse();

        http.applyCors(
            createRequest({
                headers: {
                    Origin:
                        "https://malicious.example"
                }
            }),
            fixture.response,
            {
                origins: [
                    "https://shop.example.com"
                ]
            }
        );

        assert.equal(
            fixture.state.headers[
                "Access-Control-Allow-Origin"
            ],
            undefined
        );
    }
);

test(
    "applyCors supports wildcard origins",
    function () {
        const fixture =
            createResponse();

        http.applyCors(
            createRequest({
                headers: {
                    Origin:
                        "https://any.example"
                }
            }),
            fixture.response,
            {
                origins: [
                    "*"
                ]
            }
        );

        assert.equal(
            fixture.state.headers[
                "Access-Control-Allow-Origin"
            ],
            "*"
        );
    }
);

test(
    "applyCors handles preflight requests",
    function () {
        const fixture =
            createResponse();

        const handled =
            http.applyCors(
                createRequest({
                    method:
                        "OPTIONS",

                    headers: {
                        Origin:
                            "https://shop.example.com"
                    }
                }),
                fixture.response,
                {
                    origins: [
                        "https://shop.example.com"
                    ],

                    methods: [
                        "GET",
                        "POST"
                    ]
                }
            );

        assert.equal(
            handled,
            true
        );

        assert.equal(
            fixture.state
                .statusCode,
            204
        );

        assert.equal(
            fixture.state.headers[
                "Access-Control-Allow-Methods"
            ],
            "GET, POST"
        );
    }
);

/* ==========================================================
   CACHE & SECURITY
========================================================== */

test(
    "setNoStore applies private no-cache headers",
    function () {
        const fixture =
            createResponse();

        http.setNoStore(
            fixture.response
        );

        assert.equal(
            fixture.state.headers[
                "Cache-Control"
            ],
            "no-store, max-age=0"
        );

        assert.equal(
            fixture.state.headers.Pragma,
            "no-cache"
        );
    }
);

test(
    "setPrivateCache applies private max-age",
    function () {
        const fixture =
            createResponse();

        http.setPrivateCache(
            fixture.response,
            300
        );

        assert.equal(
            fixture.state.headers[
                "Cache-Control"
            ],
            "private, max-age=300"
        );
    }
);

test(
    "setPrivateCache prevents negative max-age",
    function () {
        const fixture =
            createResponse();

        http.setPrivateCache(
            fixture.response,
            -30
        );

        assert.equal(
            fixture.state.headers[
                "Cache-Control"
            ],
            "private, max-age=0"
        );
    }
);

test(
    "applySecurityHeaders sets defensive headers",
    function () {
        const fixture =
            createResponse();

        http.applySecurityHeaders(
            fixture.response
        );

        assert.equal(
            fixture.state.headers[
                "X-Content-Type-Options"
            ],
            "nosniff"
        );

        assert.equal(
            fixture.state.headers[
                "X-Frame-Options"
            ],
            "DENY"
        );

        assert.equal(
            fixture.state.headers[
                "Referrer-Policy"
            ],
            "no-referrer"
        );
    }
);

/* ==========================================================
   IDEMPOTENCY & CLIENT INFORMATION
========================================================== */

test(
    "getIdempotencyKey reads and trims the header",
    function () {
        assert.equal(
            http.getIdempotencyKey(
                createRequest({
                    headers: {
                        "X-Idempotency-Key":
                            " checkout-123 "
                    }
                })
            ),
            "checkout-123"
        );
    }
);

test(
    "getClientInformation prefers forwarded address",
    function () {
        const information =
            http.getClientInformation(
                createRequest({
                    ip:
                        "10.0.0.10",

                    headers: {
                        "X-Forwarded-For":
                            "203.0.113.10, 10.0.0.10",

                        "User-Agent":
                            "Test Agent",

                        Origin:
                            "https://shop.example.com",

                        Referer:
                            "https://shop.example.com/cart"
                    }
                })
            );

        assert.deepEqual(
            information,
            {
                ipAddress:
                    "203.0.113.10",

                userAgent:
                    "Test Agent",

                origin:
                    "https://shop.example.com",

                referer:
                    "https://shop.example.com/cart"
            }
        );
    }
);

test(
    "getClientInformation falls back to request IP",
    function () {
        const information =
            http.getClientInformation(
                createRequest({
                    ip:
                        "10.0.0.10"
                })
            );

        assert.equal(
            information.ipAddress,
            "10.0.0.10"
        );
    }
);

/* ==========================================================
   CURSORS
========================================================== */

test(
    "encodeCursor and decodeCursor round-trip data",
    function () {
        const source = {
            createdAt:
                1784462400000,

            id:
                "order-1"
        };

        const encoded =
            http.encodeCursor(
                source
            );

        assert.match(
            encoded,
            /^[A-Za-z0-9_-]+$/
        );

        assert.deepEqual(
            http.decodeCursor(
                encoded
            ),
            source
        );
    }
);

test(
    "decodeCursor returns null for an empty value",
    function () {
        assert.equal(
            http.decodeCursor(
                ""
            ),
            null
        );
    }
);

test(
    "decodeCursor rejects invalid cursor data",
    function () {
        assert.throws(
            function () {
                http.decodeCursor(
                    "not-valid-json"
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                assert.equal(
                    error.status,
                    400
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   STATUS NORMALIZATION
========================================================== */

test(
    "normalizeStatusCode accepts valid HTTP status codes",
    function () {
        assert.equal(
            http.normalizeStatusCode(
                201,
                500
            ),
            201
        );

        assert.equal(
            http.normalizeStatusCode(
                "404",
                500
            ),
            404
        );
    }
);

test(
    "normalizeStatusCode returns the fallback for invalid values",
    function () {
        assert.equal(
            http.normalizeStatusCode(
                99,
                500
            ),
            500
        );

        assert.equal(
            http.normalizeStatusCode(
                700,
                400
            ),
            400
        );

        assert.equal(
            http.normalizeStatusCode(
                "invalid",
                422
            ),
            422
        );
    }
);