"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ASYNC HANDLER

   Responsibilities:
   - Wrap asynchronous HTTP handlers
   - Wrap Firebase callable handlers
   - Normalize service errors
   - Attach request context
   - Log failures consistently
   - Prevent duplicate response writes
========================================================== */

const {
    createRequestContext,
    createCallableContext,
    attachRequestContext
} = require(
    "./request-context"
);

const {
    normalizeServiceError,
    sendServiceError,
    toCallableError,
    applyContextToError
} = require(
    "./service-error"
);

const {
    getLogger
} = require(
    "./logger"
);

/* ==========================================================
   HTTP HANDLER
========================================================== */

function asyncHandler(
    handler,
    options
) {
    if (
        typeof handler !==
        "function"
    ) {
        throw new TypeError(
            "asyncHandler requires a handler function."
        );
    }

    const settings =
        options || {};

    return async function wrappedHttpHandler(
        request,
        response,
        next
    ) {
        let context;

        try {
            context =
                resolveHttpContext(
                    request,
                    response,
                    settings
                );

            logRequestStart(
                context,
                request,
                settings
            );

            const result =
                await handler(
                    request,
                    response,
                    context
                );

            if (
                !isResponseFinished(
                    response
                ) &&
                result !== undefined &&
                settings.autoSend !==
                    false
            ) {
                sendHandlerResult(
                    response,
                    result,
                    settings
                );
            }

            logRequestCompletion(
                context,
                response,
                settings
            );

            return result;
        } catch (error) {
            return handleHttpFailure(
                error,
                {
                    request:
                        request,

                    response:
                        response,

                    next:
                        next,

                    context:
                        context,

                    options:
                        settings
                }
            );
        }
    };
}

/* ==========================================================
   CALLABLE HANDLER
========================================================== */

function callableHandler(
    handler,
    options
) {
    if (
        typeof handler !==
        "function"
    ) {
        throw new TypeError(
            "callableHandler requires a handler function."
        );
    }

    const settings =
        options || {};

    return async function wrappedCallableHandler(
        request
    ) {
        let context;

        try {
            context =
                createCallableContext(
                    request,
                    {
                        logger:
                            settings.logger,

                        now:
                            settings.now,

                        startedAt:
                            settings.startedAt,

                        trustProxy:
                            settings.trustProxy,

                        generateRequestId:
                            settings
                                .generateRequestId,

                        requestIdHeader:
                            settings
                                .requestIdHeader,

                        correlationIdHeader:
                            settings
                                .correlationIdHeader
                    }
                );

            logCallableStart(
                context,
                settings
            );

            const result =
                await handler(
                    request.data,
                    context,
                    request
                );

            logCallableCompletion(
                context,
                settings
            );

            return result;
        } catch (error) {
            const normalized =
                normalizeHandlerError(
                    error,
                    context,
                    settings
                );

            logHandlerError(
                normalized,
                context,
                settings
            );

            throw toCallableError(
                normalized,
                {
                    HttpsError:
                        settings.HttpsError,

                    callableCode:
                        settings.callableCode,

                    includeDetails:
                        settings.includeErrorDetails,

                    requestId:
                        context &&
                        context.requestId,

                    correlationId:
                        context &&
                        context.correlationId
                }
            );
        }
    };
}

/* ==========================================================
   GENERIC ASYNC WRAPPER
========================================================== */

function wrapAsync(
    handler,
    options
) {
    if (
        typeof handler !==
        "function"
    ) {
        throw new TypeError(
            "wrapAsync requires a function."
        );
    }

    const settings =
        options || {};

    return async function wrappedFunction(
        ...args
    ) {
        try {
            return await handler(
                ...args
            );
        } catch (error) {
            const normalized =
                normalizeServiceError(
                    error,
                    settings.errorOptions
                );

            if (
                typeof settings.onError ===
                "function"
            ) {
                return settings.onError(
                    normalized,
                    args
                );
            }

            throw normalized;
        }
    };
}

/* ==========================================================
   HTTP FAILURE HANDLING
========================================================== */

function handleHttpFailure(
    error,
    input
) {
    const source =
        input || {};

    const request =
        source.request;

    const response =
        source.response;

    const next =
        source.next;

    const context =
        source.context;

    const settings =
        source.options ||
        {};

    const normalized =
        normalizeHandlerError(
            error,
            context,
            settings
        );

    logHandlerError(
        normalized,
        context,
        settings
    );

    if (
        typeof settings.onError ===
        "function"
    ) {
        const customResult =
            settings.onError(
                normalized,
                {
                    request:
                        request,

                    response:
                        response,

                    context:
                        context
                }
            );

        if (
            customResult !==
            undefined
        ) {
            return customResult;
        }
    }

    if (
        settings.forwardErrors &&
        typeof next ===
            "function"
    ) {
        next(normalized);

        return undefined;
    }

    if (
        isResponseFinished(
            response
        )
    ) {
        if (
            typeof next ===
                "function" &&
            settings.forwardAfterHeadersSent
        ) {
            next(normalized);
        }

        return undefined;
    }

    return sendServiceError(
        response,
        normalized,
        {
            includeDetails:
                settings
                    .includeErrorDetails,

            requestId:
                context &&
                context.requestId,

            correlationId:
                context &&
                context.correlationId
        }
    );
}

/* ==========================================================
   CONTEXT
========================================================== */

function resolveHttpContext(
    request,
    response,
    options
) {
    const settings =
        options || {};

    if (
        request &&
        request.requestContext
    ) {
        return request.requestContext;
    }

    if (
        request &&
        request.context &&
        request.context.requestId
    ) {
        return request.context;
    }

    if (
        settings.attachContext ===
        false
    ) {
        return createRequestContext(
            request,
            {
                logger:
                    settings.logger,

                now:
                    settings.now,

                startedAt:
                    settings.startedAt,

                trustProxy:
                    settings.trustProxy,

                generateRequestId:
                    settings
                        .generateRequestId,

                requestIdHeader:
                    settings
                        .requestIdHeader,

                correlationIdHeader:
                    settings
                        .correlationIdHeader
            }
        );
    }

    return attachRequestContext(
        request,
        response,
        {
            logger:
                settings.logger,

            now:
                settings.now,

            startedAt:
                settings.startedAt,

            trustProxy:
                settings.trustProxy,

            generateRequestId:
                settings
                    .generateRequestId,

            requestIdHeader:
                settings
                    .requestIdHeader,

            correlationIdHeader:
                settings
                    .correlationIdHeader
        }
    );
}

/* ==========================================================
   ERROR NORMALIZATION
========================================================== */

function normalizeHandlerError(
    error,
    context,
    options
) {
    const settings =
        options || {};

    const normalized =
        normalizeServiceError(
            error,
            {
                code:
                    settings.errorCode,

                status:
                    settings.errorStatus,

                expose:
                    settings.exposeErrors,

                publicMessage:
                    settings
                        .publicErrorMessage,

                retryable:
                    settings.retryable,

                requestId:
                    context &&
                    context.requestId,

                correlationId:
                    context &&
                    context.correlationId
            }
        );

    applyContextToError(
        normalized,
        context
    );

    return normalized;
}

/* ==========================================================
   RESPONSE HELPERS
========================================================== */

function sendHandlerResult(
    response,
    result,
    options
) {
    const settings =
        options || {};

    if (!response) {
        return result;
    }

    if (
        settings.statusCode
    ) {
        setResponseStatus(
            response,
            settings.statusCode
        );
    }

    if (
        settings.responseHeaders &&
        typeof settings
            .responseHeaders ===
            "object"
    ) {
        Object.keys(
            settings.responseHeaders
        ).forEach(
            function (name) {
                setResponseHeader(
                    response,
                    name,
                    settings
                        .responseHeaders[
                        name
                    ]
                );
            }
        );
    }

    if (
        typeof settings.transformResult ===
        "function"
    ) {
        result =
            settings.transformResult(
                result
            );
    }

    if (
        settings.rawResponse
    ) {
        return sendRawResponse(
            response,
            result
        );
    }

    const payload =
        settings.wrapResult ===
        false
            ? result
            : {
                  success:
                      true,

                  data:
                      result
              };

    if (
        typeof response.json ===
        "function"
    ) {
        return response.json(
            payload
        );
    }

    if (
        typeof response.send ===
        "function"
    ) {
        return response.send(
            payload
        );
    }

    if (
        typeof response.end ===
        "function"
    ) {
        response.end(
            typeof payload ===
                "string"
                ? payload
                : JSON.stringify(
                      payload
                  )
        );

        return response;
    }

    return payload;
}

function sendRawResponse(
    response,
    result
) {
    if (
        Buffer.isBuffer(result) ||
        typeof result ===
            "string"
    ) {
        if (
            typeof response.send ===
            "function"
        ) {
            return response.send(
                result
            );
        }

        if (
            typeof response.end ===
            "function"
        ) {
            response.end(result);

            return response;
        }
    }

    if (
        typeof response.json ===
        "function" &&
        result &&
        typeof result ===
            "object"
    ) {
        return response.json(
            result
        );
    }

    if (
        typeof response.send ===
        "function"
    ) {
        return response.send(
            result
        );
    }

    if (
        typeof response.end ===
        "function"
    ) {
        response.end(
            result === undefined
                ? ""
                : String(result)
        );

        return response;
    }

    return result;
}

function setResponseStatus(
    response,
    statusCode
) {
    const normalized =
        Number(statusCode);

    if (
        !Number.isInteger(
            normalized
        ) ||
        normalized < 100 ||
        normalized > 599
    ) {
        throw new TypeError(
            "Invalid HTTP status code."
        );
    }

    if (
        typeof response.status ===
        "function"
    ) {
        response.status(
            normalized
        );

        return response;
    }

    response.statusCode =
        normalized;

    return response;
}

function setResponseHeader(
    response,
    name,
    value
) {
    if (!response) {
        return response;
    }

    if (
        typeof response.set ===
        "function"
    ) {
        response.set(
            name,
            value
        );

        return response;
    }

    if (
        typeof response.setHeader ===
        "function"
    ) {
        response.setHeader(
            name,
            value
        );
    }

    return response;
}

function isResponseFinished(
    response
) {
    if (!response) {
        return false;
    }

    return Boolean(
        response.headersSent ||
        response.finished ||
        response.writableEnded
    );
}

/* ==========================================================
   LOGGING
========================================================== */

function logRequestStart(
    context,
    request,
    options
) {
    const settings =
        options || {};

    if (
        settings.logRequests ===
        false
    ) {
        return;
    }

    const logger =
        resolveLogger(
            context,
            settings
        );

    if (
        logger &&
        typeof logger.info ===
            "function"
    ) {
        logger.info(
            settings.requestStartMessage ||
            "Request started.",
            {
                query:
                    request &&
                    request.query,

                params:
                    request &&
                    request.params
            }
        );
    }
}

function logRequestCompletion(
    context,
    response,
    options
) {
    const settings =
        options || {};

    if (
        settings.logRequests ===
        false
    ) {
        return;
    }

    const logger =
        resolveLogger(
            context,
            settings
        );

    if (
        logger &&
        typeof logger.info ===
            "function"
    ) {
        logger.info(
            settings.requestCompleteMessage ||
            "Request completed.",
            {
                statusCode:
                    response &&
                    response.statusCode,

                durationMs:
                    context &&
                    typeof context.elapsed ===
                        "function"
                        ? context.elapsed()
                        : undefined
            }
        );
    }
}

function logCallableStart(
    context,
    options
) {
    const settings =
        options || {};

    if (
        settings.logRequests ===
        false
    ) {
        return;
    }

    const logger =
        resolveLogger(
            context,
            settings
        );

    if (
        logger &&
        typeof logger.info ===
            "function"
    ) {
        logger.info(
            settings.callableStartMessage ||
            "Callable request started."
        );
    }
}

function logCallableCompletion(
    context,
    options
) {
    const settings =
        options || {};

    if (
        settings.logRequests ===
        false
    ) {
        return;
    }

    const logger =
        resolveLogger(
            context,
            settings
        );

    if (
        logger &&
        typeof logger.info ===
            "function"
    ) {
        logger.info(
            settings.callableCompleteMessage ||
            "Callable request completed.",
            {
                durationMs:
                    context &&
                    typeof context.elapsed ===
                        "function"
                        ? context.elapsed()
                        : undefined
            }
        );
    }
}

function logHandlerError(
    error,
    context,
    options
) {
    const settings =
        options || {};

    if (
        settings.logErrors ===
        false
    ) {
        return;
    }

    const logger =
        resolveLogger(
            context,
            settings
        );

    if (
        logger &&
        typeof logger.error ===
            "function"
    ) {
        logger.error(
            settings.errorMessage ||
            "Request handler failed.",
            error,
            {
                requestId:
                    context &&
                    context.requestId,

                correlationId:
                    context &&
                    context.correlationId,

                durationMs:
                    context &&
                    typeof context.elapsed ===
                        "function"
                        ? context.elapsed()
                        : undefined,

                errorCode:
                    error &&
                    error.code,

                status:
                    error &&
                    error.status
            }
        );
    }
}

function resolveLogger(
    context,
    options
) {
    const settings =
        options || {};

    if (
        context &&
        context.logger
    ) {
        return context.logger;
    }

    if (settings.logger) {
        return settings.logger;
    }

    return getLogger();
}

/* ==========================================================
   COMPOSITION
========================================================== */

function composeHandlers(
    ...handlers
) {
    const normalized =
        handlers.flat()
            .filter(Boolean);

    normalized.forEach(
        function (handler) {
            if (
                typeof handler !==
                "function"
            ) {
                throw new TypeError(
                    "composeHandlers only accepts functions."
                );
            }
        }
    );

    return async function composedHandler(
        request,
        response,
        context
    ) {
        let index =
            -1;

        async function dispatch(
            position
        ) {
            if (
                position <=
                index
            ) {
                throw new Error(
                    "next() called multiple times."
                );
            }

            index =
                position;

            const handler =
                normalized[
                    position
                ];

            if (!handler) {
                return undefined;
            }

            return handler(
                request,
                response,
                context,
                function next() {
                    return dispatch(
                        position + 1
                    );
                }
            );
        }

        return dispatch(0);
    };
}

/* ==========================================================
   TIMEOUT
========================================================== */

function withTimeout(
    handler,
    timeoutMs,
    options
) {
    if (
        typeof handler !==
        "function"
    ) {
        throw new TypeError(
            "withTimeout requires a handler function."
        );
    }

    const duration =
        Number(timeoutMs);

    if (
        !Number.isInteger(
            duration
        ) ||
        duration <= 0
    ) {
        throw new TypeError(
            "withTimeout requires a positive integer timeout."
        );
    }

    const settings =
        options || {};

    return async function timedHandler(
        ...args
    ) {
        let timer;

        const timeout =
            new Promise(
                function (
                    resolve,
                    reject
                ) {
                    timer =
                        setTimeout(
                            function () {
                                const error =
                                    new Error(
                                        settings.message ||
                                        "The operation exceeded its allowed duration."
                                    );

                                error.code =
                                    settings.code ||
                                    "deadline-exceeded";

                                error.status =
                                    settings.status ||
                                    504;

                                reject(error);
                            },
                            duration
                        );
                }
            );

        try {
            return await Promise.race([
                handler(...args),
                timeout
            ]);
        } finally {
            clearTimeout(timer);
        }
    };
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
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
};