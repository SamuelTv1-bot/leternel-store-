"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   REQUEST CONTEXT TEST SUITE
========================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createRequestContext,
    createCallableContext,
    attachRequestContext,
    createRequestContextMiddleware,
    resolveRequestId,
    resolveCorrelationId,
    generateRequestId,
    isValidRequestId,
    resolveRequestIdentity,
    normalizeIdentity,
    createContextMetadata,
    createRequestLogger,
    resolveRequestMethod,
    resolveRequestPath,
    resolveRequestIp,
    resolveHeader,
    setResponseHeader,
    normalizeTime,
    createRequestContextError,
    constants
} = require(
    "../src/shared/request-context"
);

const {
    createRequest,
    createResponse,
    createNext,
    createCallableRequest
} = require(
    "./helpers"
);

/* ==========================================================
   TEST HELPERS
========================================================== */

function createLoggerStub() {
    const entries = [];
    const childContexts = [];

    const logger = {
        entries,
        childContexts,

        debug:
            function (
                message,
                metadata
            ) {
                entries.push({
                    level:
                        "debug",

                    message,
                    metadata
                });
            },

        info:
            function (
                message,
                metadata
            ) {
                entries.push({
                    level:
                        "info",

                    message,
                    metadata
                });
            },

        warn:
            function (
                message,
                metadata
            ) {
                entries.push({
                    level:
                        "warn",

                    message,
                    metadata
                });
            },

        error:
            function (
                message,
                metadata
            ) {
                entries.push({
                    level:
                        "error",

                    message,
                    metadata
                });
            },

        child:
            function (context) {
                childContexts.push(
                    context
                );

                return {
                    debug:
                        function (
                            message,
                            metadata
                        ) {
                            entries.push({
                                level:
                                    "debug",

                                message,
                                metadata,

                                context
                            });
                        },

                    info:
                        function (
                            message,
                            metadata
                        ) {
                            entries.push({
                                level:
                                    "info",

                                message,
                                metadata,

                                context
                            });
                        },

                    warn:
                        function (
                            message,
                            metadata
                        ) {
                            entries.push({
                                level:
                                    "warn",

                                message,
                                metadata,

                                context
                            });
                        },

                    error:
                        function (
                            message,
                            metadata
                        ) {
                            entries.push({
                                level:
                                    "error",

                                message,
                                metadata,

                                context
                            });
                        },

                    child:
                        logger.child
                };
            }
    };

    return logger;
}

/* ==========================================================
   REQUEST IDS
========================================================== */

test(
    "isValidRequestId accepts supported request IDs",
    function () {
        assert.equal(
            isValidRequestId(
                "req_123"
            ),
            true
        );

        assert.equal(
            isValidRequestId(
                "request-123.example:abc"
            ),
            true
        );
    }
);

test(
    "isValidRequestId rejects missing and malformed values",
    function () {
        assert.equal(
            isValidRequestId(
                null
            ),
            false
        );

        assert.equal(
            isValidRequestId(
                "ab"
            ),
            false
        );

        assert.equal(
            isValidRequestId(
                "invalid request id"
            ),
            false
        );

        assert.equal(
            isValidRequestId(
                "x".repeat(201)
            ),
            false
        );
    }
);

test(
    "generateRequestId uses a normalized prefix",
    function () {
        const requestId =
            generateRequestId(
                "order request"
            );

        assert.match(
            requestId,
            /^orderrequest_/
        );

        assert.equal(
            isValidRequestId(
                requestId
            ),
            true
        );
    }
);

test(
    "resolveRequestId uses request header",
    function () {
        const request =
            createRequest({
                headers: {
                    "x-request-id":
                        "req_header_123"
                }
            });

        assert.equal(
            resolveRequestId(
                request
            ),
            "req_header_123"
        );
    }
);

test(
    "resolveRequestId uses request property when header is unavailable",
    function () {
        const request = {
            requestId:
                "req_property_123",

            headers:
                {}
        };

        assert.equal(
            resolveRequestId(
                request
            ),
            "req_property_123"
        );
    }
);

test(
    "resolveRequestId ignores invalid supplied IDs",
    function () {
        const request =
            createRequest({
                headers: {
                    "x-request-id":
                        "invalid request"
                }
            });

        const requestId =
            resolveRequestId(
                request,
                {
                    generateRequestId:
                        function () {
                            return "req_generated_123";
                        }
                }
            );

        assert.equal(
            requestId,
            "req_generated_123"
        );
    }
);

test(
    "resolveRequestId supports a custom header",
    function () {
        const request =
            createRequest({
                headers: {
                    "x-trace-id":
                        "trace_123"
                }
            });

        assert.equal(
            resolveRequestId(
                request,
                {
                    requestIdHeader:
                        "x-trace-id"
                }
            ),
            "trace_123"
        );
    }
);

test(
    "resolveRequestId supports custom generation",
    function () {
        assert.equal(
            resolveRequestId(
                {},
                {
                    generateRequestId:
                        function () {
                            return "req_custom_123";
                        }
                }
            ),
            "req_custom_123"
        );
    }
);

test(
    "resolveRequestId rejects an invalid generated ID",
    function () {
        assert.throws(
            function () {
                resolveRequestId(
                    {},
                    {
                        generateRequestId:
                            function () {
                                return "invalid id";
                            }
                    }
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "request-context/invalid-generated-id"
                );

                return true;
            }
        );
    }
);

test(
    "resolveCorrelationId uses supplied correlation header",
    function () {
        const request =
            createRequest({
                headers: {
                    "x-correlation-id":
                        "corr_123"
                }
            });

        assert.equal(
            resolveCorrelationId(
                request,
                {
                    requestId:
                        "req_123"
                }
            ),
            "corr_123"
        );
    }
);

test(
    "resolveCorrelationId falls back to request ID",
    function () {
        assert.equal(
            resolveCorrelationId(
                {},
                {
                    requestId:
                        "req_123"
                }
            ),
            "req_123"
        );
    }
);

/* ==========================================================
   IDENTITY
========================================================== */

test(
    "normalizeIdentity creates customer identity",
    function () {
        const identity =
            normalizeIdentity({
                uid:
                    "customer-1",

                email:
                    "CUSTOMER@EXAMPLE.COM",

                emailVerified:
                    true,

                role:
                    "customer"
            });

        assert.deepEqual(
            identity,
            {
                uid:
                    "customer-1",

                email:
                    "customer@example.com",

                emailVerified:
                    true,

                role:
                    "customer",

                isAdmin:
                    false,

                isSuperAdmin:
                    false,

                disabled:
                    false
            }
        );

        assert.equal(
            Object.isFrozen(
                identity
            ),
            true
        );
    }
);

test(
    "normalizeIdentity recognizes admin role",
    function () {
        const identity =
            normalizeIdentity({
                uid:
                    "admin-1",

                role:
                    "admin"
            });

        assert.equal(
            identity.isAdmin,
            true
        );

        assert.equal(
            identity.isSuperAdmin,
            false
        );
    }
);

test(
    "normalizeIdentity recognizes superadmin role",
    function () {
        const identity =
            normalizeIdentity({
                uid:
                    "owner-1",

                role:
                    "superadmin"
            });

        assert.equal(
            identity.isAdmin,
            true
        );

        assert.equal(
            identity.isSuperAdmin,
            true
        );
    }
);

test(
    "normalizeIdentity reads custom claims",
    function () {
        const identity =
            normalizeIdentity({
                uid:
                    "admin-1",

                customClaims: {
                    role:
                        "admin",

                    admin:
                        true
                }
            });

        assert.equal(
            identity.role,
            "admin"
        );

        assert.equal(
            identity.isAdmin,
            true
        );
    }
);

test(
    "normalizeIdentity returns null for missing identity",
    function () {
        assert.equal(
            normalizeIdentity(
                null
            ),
            null
        );
    }
);

test(
    "resolveRequestIdentity reads callable auth token",
    function () {
        const identity =
            resolveRequestIdentity({
                auth: {
                    uid:
                        "admin-1",

                    token: {
                        email:
                            "admin@example.com",

                        email_verified:
                            true,

                        role:
                            "admin",

                        admin:
                            true
                    }
                }
            });

        assert.equal(
            identity.uid,
            "admin-1"
        );

        assert.equal(
            identity.email,
            "admin@example.com"
        );

        assert.equal(
            identity.emailVerified,
            true
        );

        assert.equal(
            identity.isAdmin,
            true
        );
    }
);

test(
    "resolveRequestIdentity reads request user",
    function () {
        const identity =
            resolveRequestIdentity({
                user: {
                    uid:
                        "customer-1",

                    email:
                        "customer@example.com",

                    role:
                        "customer"
                }
            });

        assert.equal(
            identity.uid,
            "customer-1"
        );
    }
);

test(
    "resolveRequestIdentity reads explicit request identity",
    function () {
        const identity =
            resolveRequestIdentity({
                identity: {
                    uid:
                        "customer-1",

                    role:
                        "customer"
                }
            });

        assert.equal(
            identity.uid,
            "customer-1"
        );
    }
);

test(
    "resolveRequestIdentity prefers injected identity",
    function () {
        const identity =
            resolveRequestIdentity(
                {
                    auth: {
                        uid:
                            "customer-1",

                        token: {
                            role:
                                "customer"
                        }
                    }
                },
                {
                    identity: {
                        uid:
                            "admin-1",

                        role:
                            "admin"
                    }
                }
            );

        assert.equal(
            identity.uid,
            "admin-1"
        );

        assert.equal(
            identity.isAdmin,
            true
        );
    }
);

test(
    "resolveRequestIdentity returns null for unauthenticated requests",
    function () {
        assert.equal(
            resolveRequestIdentity(
                {}
            ),
            null
        );
    }
);

/* ==========================================================
   REQUEST VALUES
========================================================== */

test(
    "resolveRequestMethod normalizes method",
    function () {
        assert.equal(
            resolveRequestMethod({
                method:
                    "post"
            }),
            "POST"
        );
    }
);

test(
    "resolveRequestMethod defaults to GET",
    function () {
        assert.equal(
            resolveRequestMethod(
                {}
            ),
            "GET"
        );
    }
);

test(
    "resolveRequestPath respects path priority",
    function () {
        assert.equal(
            resolveRequestPath({
                path:
                    "/orders",

                originalUrl:
                    "/orders?page=1",

                url:
                    "/fallback"
            }),
            "/orders"
        );
    }
);

test(
    "resolveRequestPath falls back through URL fields",
    function () {
        assert.equal(
            resolveRequestPath({
                originalUrl:
                    "/orders?page=1"
            }),
            "/orders?page=1"
        );

        assert.equal(
            resolveRequestPath({
                url:
                    "/health"
            }),
            "/health"
        );

        assert.equal(
            resolveRequestPath(
                null
            ),
            "/"
        );
    }
);

test(
    "resolveRequestIp uses direct IP by default",
    function () {
        const request = {
            ip:
                "127.0.0.1",

            headers: {
                "x-forwarded-for":
                    "203.0.113.10"
            }
        };

        assert.equal(
            resolveRequestIp(
                request
            ),
            "127.0.0.1"
        );
    }
);

test(
    "resolveRequestIp trusts first forwarded IP when enabled",
    function () {
        const request = {
            ip:
                "127.0.0.1",

            headers: {
                "x-forwarded-for":
                    "203.0.113.10, 198.51.100.20"
            }
        };

        assert.equal(
            resolveRequestIp(
                request,
                {
                    trustProxy:
                        true
                }
            ),
            "203.0.113.10"
        );
    }
);

test(
    "resolveRequestIp reads request IP list",
    function () {
        const request = {
            ips: [
                "203.0.113.10",
                "198.51.100.20"
            ],

            headers:
                {}
        };

        assert.equal(
            resolveRequestIp(
                request,
                {
                    trustProxy:
                        true
                }
            ),
            "203.0.113.10"
        );
    }
);

test(
    "resolveRequestIp falls back to socket address",
    function () {
        assert.equal(
            resolveRequestIp({
                socket: {
                    remoteAddress:
                        "::1"
                }
            }),
            "::1"
        );
    }
);

test(
    "resolveRequestIp falls back to connection address",
    function () {
        assert.equal(
            resolveRequestIp({
                connection: {
                    remoteAddress:
                        "127.0.0.2"
                }
            }),
            "127.0.0.2"
        );
    }
);

test(
    "resolveHeader reads Express get method",
    function () {
        const request = {
            get:
                function (name) {
                    return name ===
                        "x-request-id"
                        ? "req_123"
                        : undefined;
                }
        };

        assert.equal(
            resolveHeader(
                request,
                "x-request-id"
            ),
            "req_123"
        );
    }
);

test(
    "resolveHeader reads header method",
    function () {
        const request = {
            header:
                function (name) {
                    return name ===
                        "origin"
                        ? "https://shop.example.com"
                        : undefined;
                }
        };

        assert.equal(
            resolveHeader(
                request,
                "origin"
            ),
            "https://shop.example.com"
        );
    }
);

test(
    "resolveHeader reads Headers-like objects",
    function () {
        const request = {
            headers: {
                get:
                    function (name) {
                        return name ===
                            "user-agent"
                            ? "Test Agent"
                            : null;
                    }
            }
        };

        assert.equal(
            resolveHeader(
                request,
                "user-agent"
            ),
            "Test Agent"
        );
    }
);

test(
    "resolveHeader matches object keys case-insensitively",
    function () {
        assert.equal(
            resolveHeader(
                {
                    headers: {
                        Authorization:
                            "Bearer token"
                    }
                },
                "authorization"
            ),
            "Bearer token"
        );
    }
);

/* ==========================================================
   REQUEST CONTEXT
========================================================== */

test(
    "createRequestContext creates authenticated context",
    function () {
        let now =
            1000;

        const logger =
            createLoggerStub();

        const request =
            createRequest({
                method:
                    "POST",

                path:
                    "/orders",

                originalUrl:
                    "/orders?source=checkout",

                protocol:
                    "https",

                hostname:
                    "shop.example.com",

                ip:
                    "127.0.0.1",

                headers: {
                    "x-request-id":
                        "req_123",

                    "x-correlation-id":
                        "corr_123",

                    origin:
                        "https://shop.example.com",

                    "user-agent":
                        "Test Agent"
                },

                query: {
                    source:
                        "checkout"
                },

                params: {
                    orderId:
                        "order-1"
                },

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
                }
            });

        const context =
            createRequestContext(
                request,
                {
                    now:
                        function () {
                            return now;
                        },

                    logger:
                        logger
                }
            );

        assert.equal(
            context.requestId,
            "req_123"
        );

        assert.equal(
            context.correlationId,
            "corr_123"
        );

        assert.equal(
            context.startedAt,
            1000
        );

        assert.equal(
            context.method,
            "POST"
        );

        assert.equal(
            context.path,
            "/orders"
        );

        assert.equal(
            context.origin,
            "https://shop.example.com"
        );

        assert.equal(
            context.ip,
            "127.0.0.1"
        );

        assert.equal(
            context.userAgent,
            "Test Agent"
        );

        assert.equal(
            context.authenticated,
            true
        );

        assert.equal(
            context.userId,
            "customer-1"
        );

        assert.equal(
            context.role,
            "customer"
        );

        assert.equal(
            context.isAdmin,
            false
        );

        assert.deepEqual(
            context.query,
            {
                source:
                    "checkout"
            }
        );

        assert.deepEqual(
            context.params,
            {
                orderId:
                    "order-1"
            }
        );

        now =
            1250;

        assert.equal(
            context.elapsed(),
            250
        );

        assert.equal(
            Object.isFrozen(
                context
            ),
            true
        );
    }
);

test(
    "createRequestContext creates anonymous context",
    function () {
        const context =
            createRequestContext(
                createRequest({
                    method:
                        "GET",

                    path:
                        "/health"
                }),
                {
                    logger:
                        createLoggerStub(),

                    generateRequestId:
                        function () {
                            return "req_anonymous_123";
                        }
                }
            );

        assert.equal(
            context.authenticated,
            false
        );

        assert.equal(
            context.identity,
            null
        );

        assert.equal(
            context.userId,
            null
        );

        assert.equal(
            context.role,
            null
        );
    }
);

test(
    "createRequestContext supports explicit start time",
    function () {
        const context =
            createRequestContext(
                {},
                {
                    startedAt:
                        "2026-07-20T09:00:00.000Z",

                    now:
                        function () {
                            return Date.parse(
                                "2026-07-20T09:00:01.000Z"
                            );
                        },

                    logger:
                        createLoggerStub(),

                    generateRequestId:
                        function () {
                            return "req_time_123";
                        }
                }
            );

        assert.equal(
            context.startedAt,
            Date.parse(
                "2026-07-20T09:00:00.000Z"
            )
        );

        assert.equal(
            context.elapsed(),
            1000
        );
    }
);

test(
    "createRequestContext creates request-scoped logger",
    function () {
        const logger =
            createLoggerStub();

        const context =
            createRequestContext(
                createRequest({
                    method:
                        "GET",

                    path:
                        "/admin",

                    auth: {
                        uid:
                            "admin-1",

                        token: {
                            role:
                                "admin",

                            admin:
                                true
                        }
                    }
                }),
                {
                    logger:
                        logger,

                    generateRequestId:
                        function () {
                            return "req_logger_123";
                        }
                }
            );

        assert.equal(
            logger.childContexts.length,
            1
        );

        assert.deepEqual(
            logger.childContexts[0],
            {
                requestId:
                    "req_logger_123",

                correlationId:
                    "req_logger_123",

                method:
                    "GET",

                path:
                    "/admin",

                userId:
                    "admin-1",

                role:
                    "admin",

                requestType:
                    "http"
            }
        );

        assert.ok(
            context.logger
        );
    }
);

test(
    "context metadata includes elapsed time",
    function () {
        let now =
            1000;

        const context =
            createRequestContext(
                {},
                {
                    now:
                        function () {
                            return now;
                        },

                    startedAt:
                        900,

                    logger:
                        createLoggerStub(),

                    generateRequestId:
                        function () {
                            return "req_metadata_123";
                        }
                }
            );

        now =
            1200;

        assert.deepEqual(
            context.metadata({
                operation:
                    "checkout"
            }),
            {
                requestId:
                    "req_metadata_123",

                correlationId:
                    "req_metadata_123",

                method:
                    "GET",

                path:
                    "/",

                ip:
                    "",

                userId:
                    null,

                role:
                    null,

                authenticated:
                    false,

                elapsedMs:
                    300,

                operation:
                    "checkout"
            }
        );
    }
);

/* ==========================================================
   CALLABLE CONTEXT
========================================================== */

test(
    "createCallableContext creates callable metadata",
    function () {
        const callableRequest =
            createCallableRequest({
                data: {
                    orderId:
                        "order-1"
                },

                auth: {
                    uid:
                        "customer-1",

                    token: {
                        email:
                            "customer@example.com",

                        role:
                            "customer"
                    }
                },

                app: {
                    appId:
                        "test-app"
                }
            });

        const context =
            createCallableContext(
                callableRequest,
                {
                    logger:
                        createLoggerStub(),

                    generateRequestId:
                        function () {
                            return "req_callable_123";
                        }
                }
            );

        assert.equal(
            context.callable,
            true
        );

        assert.equal(
            context.userId,
            "customer-1"
        );

        assert.deepEqual(
            context.data,
            {
                orderId:
                    "order-1"
            }
        );

        assert.deepEqual(
            context.appCheck,
            {
                appId:
                    "test-app"
            }
        );

        assert.equal(
            Object.isFrozen(
                context
            ),
            true
        );
    }
);

/* ==========================================================
   ATTACHMENT AND MIDDLEWARE
========================================================== */

test(
    "attachRequestContext attaches context and response headers",
    function () {
        const request =
            createRequest({
                method:
                    "GET",

                path:
                    "/health"
            });

        const responseHarness =
            createResponse();

        const context =
            attachRequestContext(
                request,
                responseHarness.response,
                {
                    logger:
                        createLoggerStub(),

                    generateRequestId:
                        function () {
                            return "req_attach_123";
                        }
                }
            );

        assert.equal(
            request.context,
            context
        );

        assert.equal(
            request.requestContext,
            context
        );

        assert.equal(
            request.requestId,
            "req_attach_123"
        );

        assert.equal(
            responseHarness.getHeader(
                "x-request-id"
            ),
            "req_attach_123"
        );

        assert.equal(
            responseHarness.getHeader(
                "x-correlation-id"
            ),
            "req_attach_123"
        );

        assert.equal(
            responseHarness.response
                .locals
                .requestContext,
            context
        );
    }
);

test(
    "setResponseHeader uses response.set",
    function () {
        const values = {};

        setResponseHeader(
            {
                set:
                    function (
                        name,
                        value
                    ) {
                        values[name] =
                            value;
                    }
            },
            "x-request-id",
            "req_123"
        );

        assert.equal(
            values[
                "x-request-id"
            ],
            "req_123"
        );
    }
);

test(
    "setResponseHeader falls back to setHeader",
    function () {
        const values = {};

        setResponseHeader(
            {
                setHeader:
                    function (
                        name,
                        value
                    ) {
                        values[name] =
                            value;
                    }
            },
            "x-request-id",
            "req_123"
        );

        assert.equal(
            values[
                "x-request-id"
            ],
            "req_123"
        );
    }
);

test(
    "request context middleware attaches context and calls next",
    function () {
        const request =
            createRequest({
                path:
                    "/health"
            });

        const responseHarness =
            createResponse();

        const nextHarness =
            createNext();

        const middleware =
            createRequestContextMiddleware({
                logger:
                    createLoggerStub(),

                generateRequestId:
                    function () {
                        return "req_middleware_123";
                    }
            });

        middleware(
            request,
            responseHarness.response,
            nextHarness.next
        );

        assert.equal(
            nextHarness.wasCalled(),
            true
        );

        assert.equal(
            nextHarness.getError(),
            undefined
        );

        assert.equal(
            request.requestId,
            "req_middleware_123"
        );
    }
);

test(
    "request context middleware forwards errors",
    function () {
        const request =
            createRequest();

        const responseHarness =
            createResponse();

        const nextHarness =
            createNext();

        const middleware =
            createRequestContextMiddleware({
                logger:
                    createLoggerStub(),

                generateRequestId:
                    function () {
                        return "invalid id";
                    }
            });

        middleware(
            request,
            responseHarness.response,
            nextHarness.next
        );

        assert.equal(
            nextHarness.wasCalled(),
            true
        );

        assert.equal(
            nextHarness.getError()
                .code,
            "request-context/invalid-generated-id"
        );
    }
);

/* ==========================================================
   LOGGER HELPER
========================================================== */

test(
    "createRequestLogger uses child logger when available",
    function () {
        const logger =
            createLoggerStub();

        const requestLogger =
            createRequestLogger(
                logger,
                {
                    requestId:
                        "req_123",

                    correlationId:
                        "corr_123",

                    method:
                        "POST",

                    path:
                        "/orders",

                    userId:
                        "customer-1",

                    role:
                        "customer"
                },
                {
                    requestType:
                        "callable"
                }
            );

        assert.ok(
            requestLogger
        );

        assert.deepEqual(
            logger.childContexts[0],
            {
                requestId:
                    "req_123",

                correlationId:
                    "corr_123",

                method:
                    "POST",

                path:
                    "/orders",

                userId:
                    "customer-1",

                role:
                    "customer",

                requestType:
                    "callable"
            }
        );
    }
);

/* ==========================================================
   TIME HELPERS
========================================================== */

test(
    "normalizeTime uses now function for missing values",
    function () {
        assert.equal(
            normalizeTime(
                undefined,
                function () {
                    return 1000;
                }
            ),
            1000
        );
    }
);

test(
    "normalizeTime converts Date values",
    function () {
        const date =
            new Date(
                "2026-07-20T09:00:00.000Z"
            );

        assert.equal(
            normalizeTime(
                date,
                Date.now
            ),
            date.getTime()
        );
    }
);

test(
    "normalizeTime converts timestamp-like values",
    function () {
        assert.equal(
            normalizeTime(
                {
                    toMillis:
                        function () {
                            return 5000;
                        }
                },
                Date.now
            ),
            5000
        );
    }
);

test(
    "normalizeTime converts valid date strings",
    function () {
        assert.equal(
            normalizeTime(
                "2026-07-20T09:00:00.000Z",
                Date.now
            ),
            Date.parse(
                "2026-07-20T09:00:00.000Z"
            )
        );
    }
);

test(
    "normalizeTime converts numeric values",
    function () {
        assert.equal(
            normalizeTime(
                12345,
                Date.now
            ),
            12345
        );
    }
);

test(
    "normalizeTime rejects invalid strings",
    function () {
        assert.throws(
            function () {
                normalizeTime(
                    "not-a-date",
                    Date.now
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "request-context/invalid-time"
                );

                return true;
            }
        );
    }
);

test(
    "normalizeTime rejects invalid numbers",
    function () {
        assert.throws(
            function () {
                normalizeTime(
                    Number.NaN,
                    Date.now
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "request-context/invalid-time"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   ERRORS AND CONSTANTS
========================================================== */

test(
    "createRequestContextError creates structured errors",
    function () {
        const error =
            createRequestContextError(
                "request-context/test",
                "Test failure.",
                {
                    requestId:
                        "req_123"
                }
            );

        assert.equal(
            error.code,
            "request-context/test"
        );

        assert.equal(
            error.message,
            "Test failure."
        );

        assert.deepEqual(
            error.details,
            {
                requestId:
                    "req_123"
            }
        );
    }
);

test(
    "request-context constants expose expected headers",
    function () {
        assert.equal(
            constants
                .DEFAULT_REQUEST_ID_HEADER,
            "x-request-id"
        );

        assert.equal(
            constants
                .DEFAULT_CORRELATION_ID_HEADER,
            "x-correlation-id"
        );

        assert.equal(
            constants
                .DEFAULT_FORWARDED_FOR_HEADER,
            "x-forwarded-for"
        );

        assert.equal(
            constants
                .DEFAULT_REQUEST_ID_PREFIX,
            "req"
        );
    }
);