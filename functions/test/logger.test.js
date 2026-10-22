"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   LOGGER TEST SUITE
========================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createLogger,
    getLogger,
    resetLogger,
    createLogEntry,
    sanitizeMetadata,
    serializeError,
    createRequestMetadata,
    createResponseMetadata,
    normalizeLogLevel,
    resolveTimestamp,
    truncateString,
    DEFAULT_REDACTION
} = require(
    "../src/shared/logger"
);

/* ==========================================================
   TEST TRANSPORT
========================================================== */

function createTransport() {
    const entries = [];

    function capture(
        level,
        message,
        entry
    ) {
        entries.push({
            level:
                level,

            message:
                message,

            entry:
                entry
        });
    }

    return {
        entries:
            entries,

        debug:
            function (
                message,
                entry
            ) {
                capture(
                    "debug",
                    message,
                    entry
                );
            },

        info:
            function (
                message,
                entry
            ) {
                capture(
                    "info",
                    message,
                    entry
                );
            },

        warn:
            function (
                message,
                entry
            ) {
                capture(
                    "warn",
                    message,
                    entry
                );
            },

        error:
            function (
                message,
                entry
            ) {
                capture(
                    "error",
                    message,
                    entry
                );
            }
    };
}

function createConfiguration(
    overrides
) {
    const base = {
        logging: {
            level:
                "debug",

            providerResponses:
                false,

            webhookPayloads:
                false
        }
    };

    return Object.assign(
        {},
        base,
        overrides || {},
        {
            logging:
                Object.assign(
                    {},
                    base.logging,
                    overrides &&
                    overrides.logging
                        ? overrides.logging
                        : {}
                )
        }
    );
}

/* ==========================================================
   LOG LEVELS
========================================================== */

test(
    "normalizeLogLevel accepts supported levels",
    function () {
        assert.equal(
            normalizeLogLevel(
                " DEBUG "
            ),
            "debug"
        );

        assert.equal(
            normalizeLogLevel(
                "info"
            ),
            "info"
        );

        assert.equal(
            normalizeLogLevel(
                "warn"
            ),
            "warn"
        );

        assert.equal(
            normalizeLogLevel(
                "error"
            ),
            "error"
        );
    }
);

test(
    "normalizeLogLevel rejects unsupported levels",
    function () {
        assert.throws(
            function () {
                normalizeLogLevel(
                    "trace"
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "logger/invalid-level"
                );

                assert.match(
                    error.message,
                    /Unsupported log level/
                );

                return true;
            }
        );
    }
);

test(
    "logger respects minimum configured level",
    function () {
        const transport =
            createTransport();

        const logger =
            createLogger({
                configuration:
                    createConfiguration({
                        logging: {
                            level:
                                "warn"
                        }
                    }),

                transport:
                    transport,

                timestamp:
                    "2026-07-20T09:00:00.000Z"
            });

        logger.debug(
            "Debug message"
        );

        logger.info(
            "Info message"
        );

        logger.warn(
            "Warning message"
        );

        logger.error(
            "Error message"
        );

        assert.deepEqual(
            transport.entries.map(
                function (entry) {
                    return entry.level;
                }
            ),
            [
                "warn",
                "error"
            ]
        );
    }
);

test(
    "debug level emits all supported levels",
    function () {
        const transport =
            createTransport();

        const logger =
            createLogger({
                level:
                    "debug",

                configuration:
                    createConfiguration(),

                transport:
                    transport
            });

        logger.debug("debug");
        logger.info("info");
        logger.warn("warn");
        logger.error("error");

        assert.equal(
            transport.entries.length,
            4
        );
    }
);

/* ==========================================================
   BASIC LOG ENTRIES
========================================================== */

test(
    "logger emits structured info entries",
    function () {
        const transport =
            createTransport();

        const logger =
            createLogger({
                level:
                    "debug",

                configuration:
                    createConfiguration(),

                transport:
                    transport,

                timestamp:
                    "2026-07-20T09:00:00.000Z",

                context: {
                    service:
                        "orders"
                }
            });

        logger.info(
            "Order created.",
            {
                orderId:
                    "order-1",

                userId:
                    "customer-1"
            }
        );

        assert.equal(
            transport.entries.length,
            1
        );

        const captured =
            transport.entries[0];

        assert.equal(
            captured.level,
            "info"
        );

        assert.equal(
            captured.message,
            "Order created."
        );

        assert.deepEqual(
            captured.entry,
            {
                timestamp:
                    "2026-07-20T09:00:00.000Z",

                level:
                    "info",

                message:
                    "Order created.",

                service:
                    "orders",

                orderId:
                    "order-1",

                userId:
                    "customer-1"
            }
        );
    }
);

test(
    "logger normalizes non-string messages",
    function () {
        const transport =
            createTransport();

        const logger =
            createLogger({
                configuration:
                    createConfiguration(),

                transport:
                    transport
            });

        logger.info(123);

        assert.equal(
            transport.entries[0]
                .entry.message,
            "123"
        );
    }
);

test(
    "createLogEntry merges context and metadata",
    function () {
        const entry =
            createLogEntry({
                level:
                    "info",

                message:
                    "Created.",

                timestamp:
                    "2026-07-20T09:00:00.000Z",

                context: {
                    service:
                        "accounts",

                    requestId:
                        "request-1"
                },

                metadata: {
                    userId:
                        "customer-1"
                }
            });

        assert.deepEqual(
            entry,
            {
                timestamp:
                    "2026-07-20T09:00:00.000Z",

                level:
                    "info",

                message:
                    "Created.",

                service:
                    "accounts",

                requestId:
                    "request-1",

                userId:
                    "customer-1"
            }
        );
    }
);

/* ==========================================================
   CHILD LOGGERS
========================================================== */

test(
    "child logger inherits and extends context",
    function () {
        const transport =
            createTransport();

        const logger =
            createLogger({
                configuration:
                    createConfiguration(),

                transport:
                    transport,

                context: {
                    service:
                        "payments"
                },

                timestamp:
                    "2026-07-20T09:00:00.000Z"
            });

        const child =
            logger.child({
                provider:
                    "paystack",

                orderId:
                    "order-1"
            });

        child.info(
            "Payment initialized.",
            {
                reference:
                    "LET-PS-001"
            }
        );

        assert.deepEqual(
            transport.entries[0]
                .entry,
            {
                timestamp:
                    "2026-07-20T09:00:00.000Z",

                level:
                    "info",

                message:
                    "Payment initialized.",

                service:
                    "payments",

                provider:
                    "paystack",

                orderId:
                    "order-1",

                reference:
                    "LET-PS-001"
            }
        );
    }
);

test(
    "child logger metadata can override inherited context",
    function () {
        const transport =
            createTransport();

        const logger =
            createLogger({
                configuration:
                    createConfiguration(),

                transport:
                    transport,

                context: {
                    role:
                        "customer"
                }
            });

        logger
            .child({
                role:
                    "admin"
            })
            .info(
                "Role changed."
            );

        assert.equal(
            transport.entries[0]
                .entry.role,
            "admin"
        );
    }
);

/* ==========================================================
   SANITIZATION
========================================================== */

test(
    "sanitizeMetadata redacts sensitive keys",
    function () {
        const sanitized =
            sanitizeMetadata({
                authorization:
                    "Bearer secret",

                password:
                    "Password123!",

                secretKey:
                    "private-secret",

                api_key:
                    "private-api-key",

                nested: {
                    refreshToken:
                        "refresh-secret"
                },

                safe:
                    "visible"
            });

        assert.deepEqual(
            sanitized,
            {
                authorization:
                    DEFAULT_REDACTION,

                password:
                    DEFAULT_REDACTION,

                secretKey:
                    DEFAULT_REDACTION,

                api_key:
                    DEFAULT_REDACTION,

                nested: {
                    refreshToken:
                        DEFAULT_REDACTION
                },

                safe:
                    "visible"
            }
        );
    }
);

test(
    "sanitizeMetadata supports custom sensitive keys",
    function () {
        const sanitized =
            sanitizeMetadata(
                {
                    privateReference:
                        "private",

                    safeReference:
                        "public"
                },
                {
                    sensitiveKeys: [
                        "privateReference"
                    ]
                }
            );

        assert.equal(
            sanitized.privateReference,
            DEFAULT_REDACTION
        );

        assert.equal(
            sanitized.safeReference,
            "public"
        );
    }
);

test(
    "sanitizeMetadata supports custom redaction text",
    function () {
        const sanitized =
            sanitizeMetadata(
                {
                    password:
                        "secret"
                },
                {
                    redaction:
                        "***"
                }
            );

        assert.equal(
            sanitized.password,
            "***"
        );
    }
);

test(
    "sanitizeMetadata truncates long strings",
    function () {
        const sanitized =
            sanitizeMetadata(
                {
                    description:
                        "abcdefghij"
                },
                {
                    maxStringLength:
                        5
                }
            );

        assert.equal(
            sanitized.description,
            "abcde…[truncated]"
        );
    }
);

test(
    "truncateString preserves short values",
    function () {
        assert.equal(
            truncateString(
                "short",
                10
            ),
            "short"
        );
    }
);

test(
    "truncateString truncates oversized values",
    function () {
        assert.equal(
            truncateString(
                "abcdefghij",
                4
            ),
            "abcd…[truncated]"
        );
    }
);

test(
    "sanitizeMetadata truncates oversized arrays",
    function () {
        const sanitized =
            sanitizeMetadata(
                {
                    items: [
                        1,
                        2,
                        3,
                        4
                    ]
                },
                {
                    maxArrayLength:
                        2
                }
            );

        assert.deepEqual(
            sanitized.items,
            [
                1,
                2,
                "[+2 more items]"
            ]
        );
    }
);

test(
    "sanitizeMetadata handles circular references",
    function () {
        const source = {
            name:
                "circular"
        };

        source.self =
            source;

        const sanitized =
            sanitizeMetadata(
                source
            );

        assert.equal(
            sanitized.self,
            "[Circular]"
        );
    }
);

test(
    "sanitizeMetadata limits nested depth",
    function () {
        const sanitized =
            sanitizeMetadata(
                {
                    level1: {
                        level2: {
                            level3: {
                                value:
                                    true
                            }
                        }
                    }
                },
                {
                    maxDepth:
                        2
                }
            );

        assert.equal(
            sanitized
                .level1
                .level2,
            "[Maximum depth reached]"
        );
    }
);

test(
    "sanitizeMetadata converts Date values",
    function () {
        const sanitized =
            sanitizeMetadata({
                createdAt:
                    new Date(
                        "2026-07-20T09:00:00.000Z"
                    )
            });

        assert.equal(
            sanitized.createdAt,
            "2026-07-20T09:00:00.000Z"
        );
    }
);

test(
    "sanitizeMetadata converts timestamp-like values",
    function () {
        const sanitized =
            sanitizeMetadata({
                createdAt: {
                    toDate:
                        function () {
                            return new Date(
                                "2026-07-20T09:00:00.000Z"
                            );
                        }
                }
            });

        assert.equal(
            sanitized.createdAt,
            "2026-07-20T09:00:00.000Z"
        );
    }
);

test(
    "sanitizeMetadata summarizes buffers",
    function () {
        const sanitized =
            sanitizeMetadata({
                rawBody:
                    Buffer.from(
                        "hello"
                    )
            });

        assert.equal(
            sanitized.rawBody,
            "[Buffer 5 bytes]"
        );
    }
);

test(
    "sanitizeMetadata serializes bigint values",
    function () {
        const sanitized =
            sanitizeMetadata({
                value:
                    100n
            });

        assert.equal(
            sanitized.value,
            "100"
        );
    }
);

test(
    "sanitizeMetadata represents functions safely",
    function () {
        function namedFunction() {
            return true;
        }

        const sanitized =
            sanitizeMetadata({
                callback:
                    namedFunction
            });

        assert.equal(
            sanitized.callback,
            "[Function namedFunction]"
        );
    }
);

/* ==========================================================
   ERROR SERIALIZATION
========================================================== */

test(
    "serializeError includes structured error fields",
    function () {
        const error =
            new Error(
                "Payment failed."
            );

        error.code =
            "payment/failed";

        error.status =
            502;

        error.details = {
            reference:
                "LET-PS-001"
        };

        const serialized =
            serializeError(error);

        assert.equal(
            serialized.name,
            "Error"
        );

        assert.equal(
            serialized.message,
            "Payment failed."
        );

        assert.equal(
            serialized.code,
            "payment/failed"
        );

        assert.equal(
            serialized.status,
            502
        );

        assert.deepEqual(
            serialized.details,
            {
                reference:
                    "LET-PS-001"
            }
        );

        assert.match(
            serialized.stack,
            /Payment failed/
        );
    }
);

test(
    "serializeError redacts sensitive error details",
    function () {
        const error =
            new Error(
                "Provider failed."
            );

        error.details = {
            secretKey:
                "private",

            reference:
                "public"
        };

        const serialized =
            serializeError(error);

        assert.equal(
            serialized.details
                .secretKey,
            DEFAULT_REDACTION
        );

        assert.equal(
            serialized.details
                .reference,
            "public"
        );
    }
);

test(
    "serializeError serializes nested causes",
    function () {
        const cause =
            new Error(
                "Network unavailable."
            );

        cause.code =
            "network/unavailable";

        const error =
            new Error(
                "Payment request failed.",
                {
                    cause:
                        cause
                }
            );

        const serialized =
            serializeError(error);

        assert.equal(
            serialized.cause.message,
            "Network unavailable."
        );

        assert.equal(
            serialized.cause.code,
            "network/unavailable"
        );
    }
);

test(
    "logger.error accepts an Error and metadata",
    function () {
        const transport =
            createTransport();

        const logger =
            createLogger({
                configuration:
                    createConfiguration(),

                transport:
                    transport,

                timestamp:
                    "2026-07-20T09:00:00.000Z"
            });

        const error =
            new Error(
                "Order creation failed."
            );

        error.code =
            "order/create-failed";

        logger.error(
            "Unable to create order.",
            error,
            {
                orderId:
                    "order-1"
            }
        );

        const entry =
            transport.entries[0]
                .entry;

        assert.equal(
            entry.level,
            "error"
        );

        assert.equal(
            entry.orderId,
            "order-1"
        );

        assert.equal(
            entry.error.code,
            "order/create-failed"
        );

        assert.equal(
            entry.error.message,
            "Order creation failed."
        );
    }
);

test(
    "logger.error accepts metadata without an Error",
    function () {
        const transport =
            createTransport();

        const logger =
            createLogger({
                configuration:
                    createConfiguration(),

                transport:
                    transport
            });

        logger.error(
            "Unable to process order.",
            {
                orderId:
                    "order-1"
            }
        );

        assert.equal(
            transport.entries[0]
                .entry.orderId,
            "order-1"
        );
    }
);

/* ==========================================================
   REQUEST LOGGING
========================================================== */

test(
    "createRequestMetadata extracts safe request fields",
    function () {
        const metadata =
            createRequestMetadata({
                method:
                    "POST",

                path:
                    "/orders",

                originalUrl:
                    "/orders?source=checkout",

                hostname:
                    "shop.example.com",

                protocol:
                    "https",

                ip:
                    "127.0.0.1",

                headers: {
                    "user-agent":
                        "Test Agent",

                    origin:
                        "https://shop.example.com",

                    "x-request-id":
                        "request-1",

                    authorization:
                        "Bearer private"
                },

                auth: {
                    uid:
                        "customer-1"
                },

                query: {
                    source:
                        "checkout"
                },

                params: {
                    orderId:
                        "order-1"
                }
            });

        assert.deepEqual(
            metadata,
            {
                request: {
                    method:
                        "POST",

                    path:
                        "/orders",

                    originalUrl:
                        "/orders?source=checkout",

                    hostname:
                        "shop.example.com",

                    protocol:
                        "https",

                    ip:
                        "127.0.0.1",

                    userAgent:
                        "Test Agent",

                    origin:
                        "https://shop.example.com",

                    requestId:
                        "request-1",

                    userId:
                        "customer-1",

                    query: {
                        source:
                            "checkout"
                    },

                    params: {
                        orderId:
                            "order-1"
                    }
                }
            }
        );
    }
);

test(
    "createRequestMetadata supports Headers-like objects",
    function () {
        const metadata =
            createRequestMetadata({
                method:
                    "GET",

                path:
                    "/health",

                headers: {
                    get:
                        function (name) {
                            if (
                                name ===
                                "user-agent"
                            ) {
                                return "Headers Agent";
                            }

                            return null;
                        }
                }
            });

        assert.equal(
            metadata.request
                .userAgent,
            "Headers Agent"
        );
    }
);

test(
    "createResponseMetadata extracts response state",
    function () {
        assert.deepEqual(
            createResponseMetadata({
                statusCode:
                    201,

                headersSent:
                    true,

                finished:
                    true
            }),
            {
                response: {
                    statusCode:
                        201,

                    headersSent:
                        true,

                    finished:
                        true
                }
            }
        );
    }
);

test(
    "logger.request emits request metadata",
    function () {
        const transport =
            createTransport();

        const logger =
            createLogger({
                configuration:
                    createConfiguration(),

                transport:
                    transport
            });

        logger.request(
            {
                method:
                    "GET",

                path:
                    "/orders/order-1",

                headers: {
                    "x-request-id":
                        "request-1"
                },

                auth: {
                    uid:
                        "customer-1"
                }
            },
            {
                service:
                    "orders"
            }
        );

        const entry =
            transport.entries[0]
                .entry;

        assert.equal(
            entry.message,
            "HTTP request received."
        );

        assert.equal(
            entry.request.method,
            "GET"
        );

        assert.equal(
            entry.request.userId,
            "customer-1"
        );

        assert.equal(
            entry.service,
            "orders"
        );
    }
);

test(
    "logger.response emits request and response metadata",
    function () {
        const transport =
            createTransport();

        const logger =
            createLogger({
                configuration:
                    createConfiguration(),

                transport:
                    transport
            });

        logger.response(
            {
                method:
                    "POST",

                path:
                    "/orders",

                headers: {}
            },
            {
                statusCode:
                    201,

                headersSent:
                    true,

                finished:
                    true
            },
            {
                durationMs:
                    25
            }
        );

        const entry =
            transport.entries[0]
                .entry;

        assert.equal(
            entry.message,
            "HTTP response completed."
        );

        assert.equal(
            entry.request.path,
            "/orders"
        );

        assert.equal(
            entry.response.statusCode,
            201
        );

        assert.equal(
            entry.durationMs,
            25
        );
    }
);

/* ==========================================================
   PROVIDER LOGGING
========================================================== */

test(
    "providerRequest logs sanitized request data",
    function () {
        const transport =
            createTransport();

        const logger =
            createLogger({
                level:
                    "debug",

                configuration:
                    createConfiguration(),

                transport:
                    transport
            });

        logger.providerRequest(
            "paystack",
            {
                method:
                    "POST",

                url:
                    "https://api.paystack.co/transaction/initialize",

                authorization:
                    "Bearer private",

                body: {
                    email:
                        "customer@example.com",

                    amount:
                        26000000
                }
            }
        );

        const entry =
            transport.entries[0]
                .entry;

        assert.equal(
            entry.provider,
            "paystack"
        );

        assert.equal(
            entry.authorization,
            DEFAULT_REDACTION
        );

        assert.equal(
            entry.body.amount,
            26000000
        );
    }
);

test(
    "providerResponse omits response body by default",
    function () {
        const transport =
            createTransport();

        const logger =
            createLogger({
                level:
                    "debug",

                configuration:
                    createConfiguration({
                        logging: {
                            providerResponses:
                                false
                        }
                    }),

                transport:
                    transport
            });

        logger.providerResponse(
            "paystack",
            {
                status:
                    200,

                ok:
                    true,

                body: {
                    authorizationCode:
                        "private"
                }
            },
            {
                durationMs:
                    20
            }
        );

        const entry =
            transport.entries[0]
                .entry;

        assert.equal(
            entry.status,
            200
        );

        assert.equal(
            entry.durationMs,
            20
        );

        assert.equal(
            Object.prototype
                .hasOwnProperty
                .call(
                    entry,
                    "body"
                ),
            false
        );
    }
);

test(
    "providerResponse includes sanitized body when enabled",
    function () {
        const transport =
            createTransport();

        const logger =
            createLogger({
                level:
                    "debug",

                configuration:
                    createConfiguration({
                        logging: {
                            providerResponses:
                                true
                        }
                    }),

                transport:
                    transport
            });

        logger.providerResponse(
            "paystack",
            {
                status:
                    200,

                ok:
                    true,

                body: {
                    authorizationCode:
                        "private",

                    reference:
                        "LET-PS-001"
                }
            }
        );

        const entry =
            transport.entries[0]
                .entry;

        assert.equal(
            entry.body
                .authorizationCode,
            DEFAULT_REDACTION
        );

        assert.equal(
            entry.body.reference,
            "LET-PS-001"
        );
    }
);

/* ==========================================================
   WEBHOOK LOGGING
========================================================== */

test(
    "webhook logger records event type without payload by default",
    function () {
        const transport =
            createTransport();

        const logger =
            createLogger({
                configuration:
                    createConfiguration({
                        logging: {
                            webhookPayloads:
                                false
                        }
                    }),

                transport:
                    transport
            });

        logger.webhook(
            "paystack",
            {
                event:
                    "charge.success",

                data: {
                    reference:
                        "LET-PS-001"
                }
            }
        );

        const entry =
            transport.entries[0]
                .entry;

        assert.equal(
            entry.provider,
            "paystack"
        );

        assert.equal(
            entry.eventType,
            "charge.success"
        );

        assert.equal(
            Object.prototype
                .hasOwnProperty
                .call(
                    entry,
                    "payload"
                ),
            false
        );
    }
);

test(
    "webhook logger includes sanitized payload when enabled",
    function () {
        const transport =
            createTransport();

        const logger =
            createLogger({
                configuration:
                    createConfiguration({
                        logging: {
                            webhookPayloads:
                                true
                        }
                    }),

                transport:
                    transport
            });

        logger.webhook(
            "flutterwave",
            {
                type:
                    "charge.completed",

                data: {
                    authorization:
                        "private",

                    tx_ref:
                        "LET-FW-001"
                }
            }
        );

        const entry =
            transport.entries[0]
                .entry;

        assert.equal(
            entry.payload
                .data
                .authorization,
            DEFAULT_REDACTION
        );

        assert.equal(
            entry.payload
                .data
                .tx_ref,
            "LET-FW-001"
        );
    }
);

/* ==========================================================
   TIMESTAMPS
========================================================== */

test(
    "resolveTimestamp accepts Date values",
    function () {
        assert.equal(
            resolveTimestamp(
                new Date(
                    "2026-07-20T09:00:00.000Z"
                )
            ),
            "2026-07-20T09:00:00.000Z"
        );
    }
);

test(
    "resolveTimestamp accepts millisecond values",
    function () {
        assert.equal(
            resolveTimestamp(
                Date.parse(
                    "2026-07-20T09:00:00.000Z"
                )
            ),
            "2026-07-20T09:00:00.000Z"
        );
    }
);

test(
    "resolveTimestamp accepts timestamp functions",
    function () {
        assert.equal(
            resolveTimestamp(
                function () {
                    return "2026-07-20T09:00:00.000Z";
                }
            ),
            "2026-07-20T09:00:00.000Z"
        );
    }
);

test(
    "resolveTimestamp normalizes valid timestamp strings",
    function () {
        assert.equal(
            resolveTimestamp(
                "2026-07-20T10:00:00+01:00"
            ),
            "2026-07-20T09:00:00.000Z"
        );
    }
);

/* ==========================================================
   DEFAULT LOGGER CACHE
========================================================== */

test(
    "getLogger returns a cached logger",
    function () {
        resetLogger();

        const transport =
            createTransport();

        const first =
            getLogger({
                configuration:
                    createConfiguration(),

                transport:
                    transport
            });

        const second =
            getLogger({
                configuration:
                    createConfiguration(),

                transport:
                    createTransport()
            });

        assert.equal(
            first,
            second
        );

        resetLogger();
    }
);

test(
    "getLogger reloads logger when requested",
    function () {
        resetLogger();

        const first =
            getLogger({
                configuration:
                    createConfiguration(),

                transport:
                    createTransport()
            });

        const second =
            getLogger({
                reload:
                    true,

                configuration:
                    createConfiguration(),

                transport:
                    createTransport()
            });

        assert.notEqual(
            first,
            second
        );

        resetLogger();
    }
);