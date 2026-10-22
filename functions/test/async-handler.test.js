"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ASYNC HANDLER TEST SUITE
========================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    asyncHandler,
    callableHandler,
    wrapAsync,
    handleHttpFailure,
    resolveHttpContext,
    normalizeHandlerError,
    sendHandlerResult,
    sendRawResponse,
    setResponseStatus,
    setResponseHeader,
    isResponseFinished,
    logRequestStart,
    logRequestCompletion,
    logCallableStart,
    logCallableCompletion,
    logHandlerError,
    resolveLogger,
    composeHandlers,
    withTimeout
} = require(
    "../src/shared/async-handler"
);

const {
    ServiceError,
    invalidArgument,
    notFound
} = require(
    "../src/shared/service-error"
);

/* ==========================================================
   TEST HELPERS
========================================================== */

function createLoggerStub() {
    const entries = [];
    const childContexts = [];

    function record(
        level,
        message,
        errorOrMetadata,
        possibleMetadata
    ) {
        entries.push({
            level,
            message,
            errorOrMetadata,
            metadata:
                possibleMetadata
        });
    }

    const logger = {
        entries,
        childContexts,

        debug:
            function (
                message,
                metadata
            ) {
                record(
                    "debug",
                    message,
                    metadata
                );
            },

        info:
            function (
                message,
                metadata
            ) {
                record(
                    "info",
                    message,
                    metadata
                );
            },

        warn:
            function (
                message,
                metadata
            ) {
                record(
                    "warn",
                    message,
                    metadata
                );
            },

        error:
            function (
                message,
                errorOrMetadata,
                metadata
            ) {
                record(
                    "error",
                    message,
                    errorOrMetadata,
                    metadata
                );
            },

        child:
            function (context) {
                childContexts.push(
                    context
                );

                return logger;
            }
    };

    return logger;
}

function createRequest(
    overrides
) {
    return Object.assign(
        {
            method:
                "GET",

            path:
                "/health",

            originalUrl:
                "/health",

            headers:
                {},

            query:
                {},

            params:
                {},

            ip:
                "127.0.0.1"
        },
        overrides || {}
    );
}

function createResponse() {
    const state = {
        statusCode:
            200,

        headers:
            {},

        body:
            undefined,

        headersSent:
            false,

        finished:
            false,

        writableEnded:
            false
    };

    const response = {
        locals:
            {},

        get statusCode() {
            return state.statusCode;
        },

        set statusCode(value) {
            state.statusCode =
                value;
        },

        get headersSent() {
            return state.headersSent;
        },

        set headersSent(value) {
            state.headersSent =
                value;
        },

        get finished() {
            return state.finished;
        },

        set finished(value) {
            state.finished =
                value;
        },

        get writableEnded() {
            return state.writableEnded;
        },

        set writableEnded(value) {
            state.writableEnded =
                value;
        },

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
                state.headers[
                    String(name)
                        .toLowerCase()
                ] = value;

                return response;
            },

        setHeader:
            function (
                name,
                value
            ) {
                state.headers[
                    String(name)
                        .toLowerCase()
                ] = value;
            },

        json:
            function (body) {
                state.body =
                    body;

                state.headersSent =
                    true;

                state.finished =
                    true;

                state.writableEnded =
                    true;

                return response;
            },

        send:
            function (body) {
                state.body =
                    body;

                state.headersSent =
                    true;

                state.finished =
                    true;

                state.writableEnded =
                    true;

                return response;
            },

        end:
            function (body) {
                state.body =
                    body;

                state.headersSent =
                    true;

                state.finished =
                    true;

                state.writableEnded =
                    true;

                return response;
            }
    };

    return {
        response,
        state
    };
}

function createNext() {
    const state = {
        called:
            false,

        error:
            undefined
    };

    return {
        next:
            function (error) {
                state.called =
                    true;

                state.error =
                    error;
            },

        state
    };
}

class TestHttpsError extends Error {
    constructor(
        code,
        message,
        details
    ) {
        super(message);

        this.name =
            "HttpsError";

        this.code =
            code;

        this.details =
            details;
    }
}

/* ==========================================================
   HTTP HANDLER
========================================================== */

test(
    "asyncHandler requires a function",
    function () {
        assert.throws(
            function () {
                asyncHandler(
                    null
                );
            },
            /requires a handler function/
        );
    }
);

test(
    "asyncHandler executes handler with request context",
    async function () {
        const logger =
            createLoggerStub();

        const request =
            createRequest({
                method:
                    "POST",

                path:
                    "/orders"
            });

        const responseHarness =
            createResponse();

        let receivedContext;

        const handler =
            asyncHandler(
                async function (
                    receivedRequest,
                    receivedResponse,
                    context
                ) {
                    assert.equal(
                        receivedRequest,
                        request
                    );

                    assert.equal(
                        receivedResponse,
                        responseHarness
                            .response
                    );

                    receivedContext =
                        context;

                    return {
                        orderId:
                            "order-1"
                    };
                },
                {
                    logger,

                    generateRequestId:
                        function () {
                            return "req_async_123";
                        }
                }
            );

        const result =
            await handler(
                request,
                responseHarness.response
            );

        assert.deepEqual(
            result,
            {
                orderId:
                    "order-1"
            }
        );

        assert.equal(
            receivedContext.requestId,
            "req_async_123"
        );

        assert.equal(
            request.requestContext,
            receivedContext
        );
    }
);

test(
    "asyncHandler automatically sends successful results",
    async function () {
        const responseHarness =
            createResponse();

        const handler =
            asyncHandler(
                async function () {
                    return {
                        orderId:
                            "order-1"
                    };
                },
                {
                    logger:
                        createLoggerStub(),

                    generateRequestId:
                        function () {
                            return "req_auto_123";
                        }
                }
            );

        await handler(
            createRequest(),
            responseHarness.response
        );

        assert.deepEqual(
            responseHarness.state.body,
            {
                success:
                    true,

                data: {
                    orderId:
                        "order-1"
                }
            }
        );
    }
);

test(
    "asyncHandler does not send undefined results",
    async function () {
        const responseHarness =
            createResponse();

        const handler =
            asyncHandler(
                async function () {
                    return undefined;
                },
                {
                    logger:
                        createLoggerStub(),

                    generateRequestId:
                        function () {
                            return "req_undefined_123";
                        }
                }
            );

        await handler(
            createRequest(),
            responseHarness.response
        );

        assert.equal(
            responseHarness.state.body,
            undefined
        );
    }
);

test(
    "asyncHandler respects autoSend false",
    async function () {
        const responseHarness =
            createResponse();

        const handler =
            asyncHandler(
                async function () {
                    return {
                        value:
                            true
                    };
                },
                {
                    autoSend:
                        false,

                    logger:
                        createLoggerStub(),

                    generateRequestId:
                        function () {
                            return "req_no_send_123";
                        }
                }
            );

        const result =
            await handler(
                createRequest(),
                responseHarness.response
            );

        assert.deepEqual(
            result,
            {
                value:
                    true
            }
        );

        assert.equal(
            responseHarness.state.body,
            undefined
        );
    }
);

test(
    "asyncHandler does not overwrite a completed response",
    async function () {
        const responseHarness =
            createResponse();

        const handler =
            asyncHandler(
                async function (
                    request,
                    response
                ) {
                    response.status(204);
                    response.end();

                    return {
                        ignored:
                            true
                    };
                },
                {
                    logger:
                        createLoggerStub(),

                    generateRequestId:
                        function () {
                            return "req_finished_123";
                        }
                }
            );

        await handler(
            createRequest(),
            responseHarness.response
        );

        assert.equal(
            responseHarness.state.statusCode,
            204
        );

        assert.equal(
            responseHarness.state.body,
            undefined
        );
    }
);

test(
    "asyncHandler converts thrown errors to HTTP responses",
    async function () {
        const responseHarness =
            createResponse();

        const handler =
            asyncHandler(
                async function () {
                    throw notFound(
                        "Order not found.",
                        {
                            orderId:
                                "order-1"
                        }
                    );
                },
                {
                    logger:
                        createLoggerStub(),

                    generateRequestId:
                        function () {
                            return "req_error_123";
                        }
                }
            );

        await handler(
            createRequest(),
            responseHarness.response
        );

        assert.equal(
            responseHarness.state.statusCode,
            404
        );

        assert.deepEqual(
            responseHarness.state.body,
            {
                success:
                    false,

                error: {
                    code:
                        "not-found",

                    message:
                        "Order not found.",

                    retryable:
                        false,

                    details: {
                        orderId:
                            "order-1"
                    },

                    requestId:
                        "req_error_123",

                    correlationId:
                        "req_error_123"
                }
            }
        );
    }
);

test(
    "asyncHandler forwards errors when configured",
    async function () {
        const responseHarness =
            createResponse();

        const nextHarness =
            createNext();

        const handler =
            asyncHandler(
                async function () {
                    throw new Error(
                        "Failure."
                    );
                },
                {
                    forwardErrors:
                        true,

                    logger:
                        createLoggerStub(),

                    generateRequestId:
                        function () {
                            return "req_forward_123";
                        }
                }
            );

        await handler(
            createRequest(),
            responseHarness.response,
            nextHarness.next
        );

        assert.equal(
            nextHarness.state.called,
            true
        );

        assert.equal(
            nextHarness.state.error
                instanceof ServiceError,
            true
        );

        assert.equal(
            responseHarness.state.body,
            undefined
        );
    }
);

/* ==========================================================
   CALLABLE HANDLER
========================================================== */

test(
    "callableHandler requires a function",
    function () {
        assert.throws(
            function () {
                callableHandler(
                    null
                );
            },
            /requires a handler function/
        );
    }
);

test(
    "callableHandler executes with data and callable context",
    async function () {
        const wrapped =
            callableHandler(
                async function (
                    data,
                    context,
                    request
                ) {
                    assert.equal(
                        context.callable,
                        true
                    );

                    assert.equal(
                        context.userId,
                        "customer-1"
                    );

                    assert.deepEqual(
                        request.data,
                        data
                    );

                    return {
                        received:
                            data.orderId
                    };
                },
                {
                    logger:
                        createLoggerStub(),

                    generateRequestId:
                        function () {
                            return "req_callable_123";
                        }
                }
            );

        const result =
            await wrapped({
                data: {
                    orderId:
                        "order-1"
                },

                auth: {
                    uid:
                        "customer-1",

                    token: {
                        role:
                            "customer"
                    }
                },

                rawRequest:
                    createRequest()
            });

        assert.deepEqual(
            result,
            {
                received:
                    "order-1"
            }
        );
    }
);

test(
    "callableHandler converts failures to HttpsError",
    async function () {
        const wrapped =
            callableHandler(
                async function () {
                    throw invalidArgument(
                        "Invalid quantity.",
                        {
                            field:
                                "quantity"
                        }
                    );
                },
                {
                    HttpsError:
                        TestHttpsError,

                    logger:
                        createLoggerStub(),

                    generateRequestId:
                        function () {
                            return "req_callable_error_123";
                        }
                }
            );

        await assert.rejects(
            async function () {
                await wrapped({
                    data:
                        {},

                    rawRequest:
                        createRequest()
                });
            },
            function (error) {
                assert.equal(
                    error instanceof
                        TestHttpsError,
                    true
                );

                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                assert.equal(
                    error.details
                        .requestId,
                    "req_callable_error_123"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   GENERIC WRAPPER
========================================================== */

test(
    "wrapAsync requires a function",
    function () {
        assert.throws(
            function () {
                wrapAsync(
                    null
                );
            },
            /requires a function/
        );
    }
);

test(
    "wrapAsync returns successful values",
    async function () {
        const wrapped =
            wrapAsync(
                async function (
                    first,
                    second
                ) {
                    return first +
                        second;
                }
            );

        assert.equal(
            await wrapped(
                2,
                3
            ),
            5
        );
    }
);

test(
    "wrapAsync normalizes thrown errors",
    async function () {
        const wrapped =
            wrapAsync(
                async function () {
                    const error =
                        new Error(
                            "Missing."
                        );

                    error.status =
                        404;

                    throw error;
                }
            );

        await assert.rejects(
            async function () {
                await wrapped();
            },
            function (error) {
                assert.equal(
                    error instanceof
                        ServiceError,
                    true
                );

                assert.equal(
                    error.code,
                    "not-found"
                );

                return true;
            }
        );
    }
);

test(
    "wrapAsync supports custom error callbacks",
    async function () {
        const wrapped =
            wrapAsync(
                async function () {
                    throw new Error(
                        "Failure."
                    );
                },
                {
                    onError:
                        function (
                            error,
                            args
                        ) {
                            return {
                                code:
                                    error.code,

                                arguments:
                                    args
                            };
                        }
                }
            );

        assert.deepEqual(
            await wrapped(
                "first"
            ),
            {
                code:
                    "internal",

                arguments: [
                    "first"
                ]
            }
        );
    }
);

/* ==========================================================
   HTTP FAILURE HANDLING
========================================================== */

test(
    "handleHttpFailure writes normalized service errors",
    function () {
        const responseHarness =
            createResponse();

        handleHttpFailure(
            notFound(
                "Order missing."
            ),
            {
                request:
                    createRequest(),

                response:
                    responseHarness
                        .response,

                context: {
                    requestId:
                        "req_123",

                    correlationId:
                        "corr_123"
                },

                options: {
                    logger:
                        createLoggerStub()
                }
            }
        );

        assert.equal(
            responseHarness.state.statusCode,
            404
        );

        assert.equal(
            responseHarness.state.body
                .error
                .requestId,
            "req_123"
        );
    }
);

test(
    "handleHttpFailure supports custom error handling",
    function () {
        const responseHarness =
            createResponse();

        const result =
            handleHttpFailure(
                new Error(
                    "Failure."
                ),
                {
                    response:
                        responseHarness
                            .response,

                    options: {
                        logger:
                            createLoggerStub(),

                        onError:
                            function (error) {
                                return {
                                    handled:
                                        true,

                                    code:
                                        error.code
                                };
                            }
                    }
                }
            );

        assert.deepEqual(
            result,
            {
                handled:
                    true,

                code:
                    "internal"
            }
        );

        assert.equal(
            responseHarness.state.body,
            undefined
        );
    }
);

test(
    "handleHttpFailure leaves completed responses unchanged",
    function () {
        const responseHarness =
            createResponse();

        responseHarness
            .response
            .end("done");

        handleHttpFailure(
            new Error(
                "Late failure."
            ),
            {
                response:
                    responseHarness
                        .response,

                options: {
                    logger:
                        createLoggerStub()
                }
            }
        );

        assert.equal(
            responseHarness.state.body,
            "done"
        );
    }
);

/* ==========================================================
   CONTEXT RESOLUTION
========================================================== */

test(
    "resolveHttpContext reuses requestContext",
    function () {
        const existing = {
            requestId:
                "req_existing"
        };

        const request = {
            requestContext:
                existing
        };

        assert.equal(
            resolveHttpContext(
                request,
                null,
                {}
            ),
            existing
        );
    }
);

test(
    "resolveHttpContext reuses compatible context property",
    function () {
        const existing = {
            requestId:
                "req_existing"
        };

        const request = {
            context:
                existing
        };

        assert.equal(
            resolveHttpContext(
                request,
                null,
                {}
            ),
            existing
        );
    }
);

test(
    "resolveHttpContext can avoid attaching context",
    function () {
        const request =
            createRequest();

        const context =
            resolveHttpContext(
                request,
                null,
                {
                    attachContext:
                        false,

                    logger:
                        createLoggerStub(),

                    generateRequestId:
                        function () {
                            return "req_detached_123";
                        }
                }
            );

        assert.equal(
            context.requestId,
            "req_detached_123"
        );

        assert.equal(
            request.requestContext,
            undefined
        );
    }
);

/* ==========================================================
   ERROR NORMALIZATION
========================================================== */

test(
    "normalizeHandlerError attaches request identifiers",
    function () {
        const error =
            normalizeHandlerError(
                new Error(
                    "Failure."
                ),
                {
                    requestId:
                        "req_123",

                    correlationId:
                        "corr_123"
                },
                {}
            );

        assert.equal(
            error instanceof
                ServiceError,
            true
        );

        assert.equal(
            error.requestId,
            "req_123"
        );

        assert.equal(
            error.correlationId,
            "corr_123"
        );
    }
);

test(
    "normalizeHandlerError honors configured public error options",
    function () {
        const error =
            normalizeHandlerError(
                new Error(
                    "Private database error."
                ),
                null,
                {
                    errorCode:
                        "unavailable",

                    errorStatus:
                        503,

                    publicErrorMessage:
                        "Service temporarily unavailable.",

                    exposeErrors:
                        true,

                    retryable:
                        true
                }
            );

        assert.equal(
            error.code,
            "unavailable"
        );

        assert.equal(
            error.status,
            503
        );

        assert.equal(
            error.publicMessage,
            "Service temporarily unavailable."
        );

        assert.equal(
            error.retryable,
            true
        );
    }
);

/* ==========================================================
   RESPONSE HELPERS
========================================================== */

test(
    "sendHandlerResult sends wrapped JSON responses",
    function () {
        const responseHarness =
            createResponse();

        sendHandlerResult(
            responseHarness.response,
            {
                orderId:
                    "order-1"
            }
        );

        assert.deepEqual(
            responseHarness.state.body,
            {
                success:
                    true,

                data: {
                    orderId:
                        "order-1"
                }
            }
        );
    }
);

test(
    "sendHandlerResult supports unwrapped responses",
    function () {
        const responseHarness =
            createResponse();

        sendHandlerResult(
            responseHarness.response,
            {
                healthy:
                    true
            },
            {
                wrapResult:
                    false
            }
        );

        assert.deepEqual(
            responseHarness.state.body,
            {
                healthy:
                    true
            }
        );
    }
);

test(
    "sendHandlerResult applies status and headers",
    function () {
        const responseHarness =
            createResponse();

        sendHandlerResult(
            responseHarness.response,
            {
                created:
                    true
            },
            {
                statusCode:
                    201,

                responseHeaders: {
                    "cache-control":
                        "no-store",

                    "x-service":
                        "orders"
                }
            }
        );

        assert.equal(
            responseHarness.state.statusCode,
            201
        );

        assert.equal(
            responseHarness.state
                .headers[
                "cache-control"
            ],
            "no-store"
        );

        assert.equal(
            responseHarness.state
                .headers[
                "x-service"
            ],
            "orders"
        );
    }
);

test(
    "sendHandlerResult transforms results",
    function () {
        const responseHarness =
            createResponse();

        sendHandlerResult(
            responseHarness.response,
            {
                total:
                    100
            },
            {
                transformResult:
                    function (result) {
                        return {
                            amount:
                                result.total
                        };
                    }
            }
        );

        assert.deepEqual(
            responseHarness.state.body,
            {
                success:
                    true,

                data: {
                    amount:
                        100
                }
            }
        );
    }
);

test(
    "sendRawResponse sends strings directly",
    function () {
        const responseHarness =
            createResponse();

        sendRawResponse(
            responseHarness.response,
            "healthy"
        );

        assert.equal(
            responseHarness.state.body,
            "healthy"
        );
    }
);

test(
    "sendRawResponse sends objects as JSON",
    function () {
        const responseHarness =
            createResponse();

        sendRawResponse(
            responseHarness.response,
            {
                healthy:
                    true
            }
        );

        assert.deepEqual(
            responseHarness.state.body,
            {
                healthy:
                    true
            }
        );
    }
);

test(
    "setResponseStatus supports Express status",
    function () {
        const responseHarness =
            createResponse();

        setResponseStatus(
            responseHarness.response,
            202
        );

        assert.equal(
            responseHarness.state.statusCode,
            202
        );
    }
);

test(
    "setResponseStatus rejects invalid status codes",
    function () {
        assert.throws(
            function () {
                setResponseStatus(
                    {},
                    99
                );
            },
            /Invalid HTTP status code/
        );
    }
);

test(
    "setResponseHeader supports response.set",
    function () {
        const responseHarness =
            createResponse();

        setResponseHeader(
            responseHarness.response,
            "x-test",
            "value"
        );

        assert.equal(
            responseHarness.state
                .headers[
                "x-test"
            ],
            "value"
        );
    }
);

test(
    "isResponseFinished detects common completion flags",
    function () {
        assert.equal(
            isResponseFinished({
                headersSent:
                    true
            }),
            true
        );

        assert.equal(
            isResponseFinished({
                finished:
                    true
            }),
            true
        );

        assert.equal(
            isResponseFinished({
                writableEnded:
                    true
            }),
            true
        );

        assert.equal(
            isResponseFinished(
                {}
            ),
            false
        );
    }
);

/* ==========================================================
   LOGGING
========================================================== */

test(
    "logRequestStart emits request metadata",
    function () {
        const logger =
            createLoggerStub();

        logRequestStart(
            {
                logger
            },
            {
                query: {
                    page:
                        "1"
                },

                params: {
                    orderId:
                        "order-1"
                }
            },
            {}
        );

        assert.equal(
            logger.entries[0]
                .level,
            "info"
        );

        assert.equal(
            logger.entries[0]
                .message,
            "Request started."
        );
    }
);

test(
    "logRequestCompletion includes status and duration",
    function () {
        const logger =
            createLoggerStub();

        logRequestCompletion(
            {
                logger,

                elapsed:
                    function () {
                        return 125;
                    }
            },
            {
                statusCode:
                    201
            },
            {}
        );

        assert.deepEqual(
            logger.entries[0]
                .errorOrMetadata,
            {
                statusCode:
                    201,

                durationMs:
                    125
            }
        );
    }
);

test(
    "logCallableStart and completion emit callable logs",
    function () {
        const logger =
            createLoggerStub();

        const context = {
            logger,

            elapsed:
                function () {
                    return 50;
                }
        };

        logCallableStart(
            context,
            {}
        );

        logCallableCompletion(
            context,
            {}
        );

        assert.equal(
            logger.entries.length,
            2
        );

        assert.equal(
            logger.entries[0]
                .message,
            "Callable request started."
        );

        assert.equal(
            logger.entries[1]
                .message,
            "Callable request completed."
        );
    }
);

test(
    "logHandlerError writes structured errors",
    function () {
        const logger =
            createLoggerStub();

        const error =
            notFound(
                "Order missing."
            );

        logHandlerError(
            error,
            {
                logger,

                requestId:
                    "req_123",

                correlationId:
                    "corr_123",

                elapsed:
                    function () {
                        return 80;
                    }
            },
            {}
        );

        assert.equal(
            logger.entries[0]
                .level,
            "error"
        );

        assert.equal(
            logger.entries[0]
                .errorOrMetadata,
            error
        );

        assert.equal(
            logger.entries[0]
                .metadata
                .durationMs,
            80
        );
    }
);

test(
    "logging helpers respect disabled request logging",
    function () {
        const logger =
            createLoggerStub();

        logRequestStart(
            {
                logger
            },
            {},
            {
                logRequests:
                    false
            }
        );

        logRequestCompletion(
            {
                logger
            },
            {},
            {
                logRequests:
                    false
            }
        );

        assert.equal(
            logger.entries.length,
            0
        );
    }
);

test(
    "resolveLogger prefers context logger",
    function () {
        const contextLogger =
            createLoggerStub();

        const optionLogger =
            createLoggerStub();

        assert.equal(
            resolveLogger(
                {
                    logger:
                        contextLogger
                },
                {
                    logger:
                        optionLogger
                }
            ),
            contextLogger
        );
    }
);

/* ==========================================================
   COMPOSITION
========================================================== */

test(
    "composeHandlers executes middleware in order",
    async function () {
        const calls = [];

        const composed =
            composeHandlers(
                async function (
                    request,
                    response,
                    context,
                    next
                ) {
                    calls.push(
                        "first-before"
                    );

                    const result =
                        await next();

                    calls.push(
                        "first-after"
                    );

                    return result;
                },
                async function (
                    request,
                    response,
                    context,
                    next
                ) {
                    calls.push(
                        "second-before"
                    );

                    const result =
                        await next();

                    calls.push(
                        "second-after"
                    );

                    return result;
                },
                async function () {
                    calls.push(
                        "final"
                    );

                    return "complete";
                }
            );

        const result =
            await composed(
                {},
                {},
                {}
            );

        assert.equal(
            result,
            "complete"
        );

        assert.deepEqual(
            calls,
            [
                "first-before",
                "second-before",
                "final",
                "second-after",
                "first-after"
            ]
        );
    }
);

test(
    "composeHandlers accepts nested handler arrays",
    async function () {
        const composed =
            composeHandlers([
                async function (
                    request,
                    response,
                    context,
                    next
                ) {
                    request.value =
                        1;

                    return next();
                },

                async function (
                    request
                ) {
                    return request.value +
                        1;
                }
            ]);

        assert.equal(
            await composed(
                {},
                {},
                {}
            ),
            2
        );
    }
);

test(
    "composeHandlers rejects non-function values",
    function () {
        assert.throws(
            function () {
                composeHandlers(
                    function () {},
                    "invalid"
                );
            },
            /only accepts functions/
        );
    }
);

test(
    "composeHandlers rejects multiple next calls",
    async function () {
        const composed =
            composeHandlers(
                async function (
                    request,
                    response,
                    context,
                    next
                ) {
                    await next();
                    await next();
                },
                async function () {
                    return true;
                }
            );

        await assert.rejects(
            async function () {
                await composed(
                    {},
                    {},
                    {}
                );
            },
            /next\(\) called multiple times/
        );
    }
);

/* ==========================================================
   TIMEOUT
========================================================== */

test(
    "withTimeout requires a function",
    function () {
        assert.throws(
            function () {
                withTimeout(
                    null,
                    100
                );
            },
            /requires a handler function/
        );
    }
);

test(
    "withTimeout requires a positive integer duration",
    function () {
        assert.throws(
            function () {
                withTimeout(
                    async function () {},
                    0
                );
            },
            /positive integer timeout/
        );

        assert.throws(
            function () {
                withTimeout(
                    async function () {},
                    10.5
                );
            },
            /positive integer timeout/
        );
    }
);

test(
    "withTimeout returns completed handler results",
    async function () {
        const wrapped =
            withTimeout(
                async function (
                    value
                ) {
                    return value *
                        2;
                },
                100
            );

        assert.equal(
            await wrapped(
                5
            ),
            10
        );
    }
);

test(
    "withTimeout rejects slow handlers",
    async function () {
        const wrapped =
            withTimeout(
                async function () {
                    await new Promise(
                        function (
                            resolve
                        ) {
                            setTimeout(
                                resolve,
                                50
                            );
                        }
                    );

                    return true;
                },
                5
            );

        await assert.rejects(
            async function () {
                await wrapped();
            },
            function (error) {
                assert.equal(
                    error.code,
                    "deadline-exceeded"
                );

                assert.equal(
                    error.status,
                    504
                );

                return true;
            }
        );
    }
);

test(
    "withTimeout supports custom timeout errors",
    async function () {
        const wrapped =
            withTimeout(
                async function () {
                    await new Promise(
                        function (
                            resolve
                        ) {
                            setTimeout(
                                resolve,
                                40
                            );
                        }
                    );
                },
                5,
                {
                    message:
                        "Provider request timed out.",

                    code:
                        "provider-timeout",

                    status:
                        502
                }
            );

        await assert.rejects(
            async function () {
                await wrapped();
            },
            function (error) {
                assert.equal(
                    error.message,
                    "Provider request timed out."
                );

                assert.equal(
                    error.code,
                    "provider-timeout"
                );

                assert.equal(
                    error.status,
                    502
                );

                return true;
            }
        );
    }
);