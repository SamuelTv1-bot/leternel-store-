"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   STRUCTURED LOGGER

   Responsibilities:
   - Consistent structured application logs
   - Configurable log levels
   - Safe metadata sanitization
   - Error serialization
   - Request and provider logging helpers
   - Firebase logger compatibility
========================================================== */

const {
    getConfiguration
} = require(
    "./configuration"
);

/* ==========================================================
   CONSTANTS
========================================================== */

const LOG_LEVELS =
    Object.freeze({
        debug:
            10,

        info:
            20,

        warn:
            30,

        error:
            40
    });

const SENSITIVE_KEYS =
    new Set([
        "authorization",
        "authorizationcode",
        "authorization_code",
        "apikey",
        "api_key",
        "password",
        "passwordhash",
        "passwordsalt",
        "secret",
        "secretkey",
        "secret_key",
        "token",
        "idtoken",
        "id_token",
        "refreshtoken",
        "refresh_token",
        "accesstoken",
        "access_token",
        "cvv",
        "cvc",
        "pin",
        "cardnumber",
        "card_number",
        "webhooksecret",
        "webhook_secret",
        "signature"
    ]);

const DEFAULT_REDACTION =
    "[REDACTED]";

const DEFAULT_MAX_DEPTH =
    8;

const DEFAULT_MAX_STRING_LENGTH =
    2000;

const DEFAULT_MAX_ARRAY_LENGTH =
    100;

/* ==========================================================
   LOGGER FACTORY
========================================================== */

function createLogger(options) {
    const settings =
        options || {};

    const configuration =
        settings.configuration ||
        safeGetConfiguration();

    const configuredLevel =
        normalizeLogLevel(
            settings.level ||
            (
                configuration &&
                configuration.logging &&
                configuration.logging.level
            ) ||
            "info"
        );

    const context =
        sanitizeMetadata(
            settings.context ||
            {},
            settings
        );

    const transport =
        resolveTransport(
            settings.transport
        );

    function shouldLog(level) {
        return (
            LOG_LEVELS[level] >=
            LOG_LEVELS[
                configuredLevel
            ]
        );
    }

    function write(
        level,
        message,
        metadata
    ) {
        if (!shouldLog(level)) {
            return;
        }

        const entry =
            createLogEntry({
                level:
                    level,

                message:
                    message,

                context:
                    context,

                metadata:
                    metadata,

                timestamp:
                    settings.timestamp,

                options:
                    settings
            });

        transport[level](
            entry.message,
            entry
        );
    }

    const logger = {
        level:
            configuredLevel,

        debug:
            function (
                message,
                metadata
            ) {
                write(
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
                write(
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
                write(
                    "warn",
                    message,
                    metadata
                );
            },

        error:
            function (
                message,
                errorOrMetadata,
                possibleMetadata
            ) {
                const normalized =
                    normalizeErrorArguments(
                        errorOrMetadata,
                        possibleMetadata
                    );

                write(
                    "error",
                    message,
                    normalized
                );
            },

        child:
            function (
                childContext
            ) {
                return createLogger(
                    Object.assign(
                        {},
                        settings,
                        {
                            level:
                                configuredLevel,

                            configuration:
                                configuration,

                            transport:
                                transport,

                            context:
                                Object.assign(
                                    {},
                                    context,
                                    sanitizeMetadata(
                                        childContext ||
                                        {},
                                        settings
                                    )
                                )
                        }
                    )
                );
            },

        request:
            function (
                request,
                metadata
            ) {
                write(
                    "info",
                    "HTTP request received.",
                    Object.assign(
                        {},
                        createRequestMetadata(
                            request,
                            settings
                        ),
                        sanitizeMetadata(
                            metadata ||
                            {},
                            settings
                        )
                    )
                );
            },

        response:
            function (
                request,
                response,
                metadata
            ) {
                write(
                    "info",
                    "HTTP response completed.",
                    Object.assign(
                        {},
                        createRequestMetadata(
                            request,
                            settings
                        ),
                        createResponseMetadata(
                            response
                        ),
                        sanitizeMetadata(
                            metadata ||
                            {},
                            settings
                        )
                    )
                );
            },

        providerRequest:
            function (
                provider,
                request,
                metadata
            ) {
                if (
                    configuration &&
                    configuration.logging &&
                    !configuration.logging
                        .providerResponses &&
                    settings.logProviderRequests ===
                        false
                ) {
                    return;
                }

                write(
                    "debug",
                    "Provider request.",
                    Object.assign(
                        {
                            provider:
                                provider
                        },
                        sanitizeMetadata(
                            request ||
                            {},
                            settings
                        ),
                        sanitizeMetadata(
                            metadata ||
                            {},
                            settings
                        )
                    )
                );
            },

        providerResponse:
            function (
                provider,
                response,
                metadata
            ) {
                const shouldIncludePayload =
                    Boolean(
                        settings.logProviderResponses ||
                        (
                            configuration &&
                            configuration.logging &&
                            configuration.logging
                                .providerResponses
                        )
                    );

                const responseMetadata = {
                    provider:
                        provider,

                    status:
                        response &&
                        response.status,

                    ok:
                        response &&
                        response.ok,

                    durationMs:
                        metadata &&
                        metadata.durationMs
                };

                if (shouldIncludePayload) {
                    responseMetadata.body =
                        response &&
                        response.body;
                }

                write(
                    "debug",
                    "Provider response.",
                    Object.assign(
                        responseMetadata,
                        sanitizeMetadata(
                            metadata ||
                            {},
                            settings
                        )
                    )
                );
            },

        webhook:
            function (
                provider,
                event,
                metadata
            ) {
                const shouldIncludePayload =
                    Boolean(
                        settings.logWebhookPayloads ||
                        (
                            configuration &&
                            configuration.logging &&
                            configuration.logging
                                .webhookPayloads
                        )
                    );

                write(
                    "info",
                    "Payment webhook received.",
                    Object.assign(
                        {
                            provider:
                                provider,

                            eventType:
                                event &&
                                (
                                    event.event ||
                                    event.type
                                )
                        },
                        shouldIncludePayload
                            ? {
                                  payload:
                                      event
                              }
                            : {},
                        sanitizeMetadata(
                            metadata ||
                            {},
                            settings
                        )
                    )
                );
            }
    };

    return logger;
}

/* ==========================================================
   LOG ENTRY CREATION
========================================================== */

function createLogEntry(options) {
    const settings =
        options || {};

    const timestamp =
        resolveTimestamp(
            settings.timestamp
        );

    const metadata =
        normalizeMetadata(
            settings.metadata
        );

    const entry = Object.assign(
        {
            timestamp:
                timestamp,

            level:
                settings.level,

            message:
                normalizeMessage(
                    settings.message
                )
        },
        sanitizeMetadata(
            settings.context ||
            {},
            settings.options
        ),
        sanitizeMetadata(
            metadata,
            settings.options
        )
    );

    return entry;
}

function normalizeMessage(message) {
    if (
        message instanceof Error
    ) {
        return message.message;
    }

    if (
        message === undefined ||
        message === null
    ) {
        return "";
    }

    return String(message);
}

function normalizeMetadata(metadata) {
    if (
        metadata === undefined ||
        metadata === null
    ) {
        return {};
    }

    if (metadata instanceof Error) {
        return {
            error:
                serializeError(
                    metadata
                )
        };
    }

    if (
        typeof metadata !==
        "object"
    ) {
        return {
            value:
                metadata
        };
    }

    return metadata;
}

function normalizeErrorArguments(
    errorOrMetadata,
    possibleMetadata
) {
    if (
        errorOrMetadata instanceof
        Error
    ) {
        return Object.assign(
            {
                error:
                    serializeError(
                        errorOrMetadata
                    )
            },
            normalizeMetadata(
                possibleMetadata
            )
        );
    }

    return normalizeMetadata(
        errorOrMetadata
    );
}

/* ==========================================================
   SANITIZATION
========================================================== */

function sanitizeMetadata(
    value,
    options,
    state
) {
    const settings =
        options || {};

    const currentState =
        state || {
            depth:
                0,

            seen:
                new WeakSet()
        };

    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    if (
        typeof value ===
        "string"
    ) {
        return truncateString(
            value,
            settings.maxStringLength ||
            DEFAULT_MAX_STRING_LENGTH
        );
    }

    if (
        typeof value ===
            "number" ||
        typeof value ===
            "boolean"
    ) {
        return value;
    }

    if (
        typeof value ===
        "bigint"
    ) {
        return value.toString();
    }

    if (
        typeof value ===
        "function"
    ) {
        return (
            "[Function " +
            (
                value.name ||
                "anonymous"
            ) +
            "]"
        );
    }

    if (
        value instanceof Date
    ) {
        return value.toISOString();
    }

    if (
        Buffer.isBuffer(value)
    ) {
        return (
            "[Buffer " +
            value.length +
            " bytes]"
        );
    }

    if (
        value instanceof Error
    ) {
        return serializeError(
            value,
            settings
        );
    }

    if (
        value &&
        typeof value.toDate ===
            "function"
    ) {
        try {
            return value
                .toDate()
                .toISOString();
        } catch {
            return "[Invalid Timestamp]";
        }
    }

    if (
        typeof value !==
        "object"
    ) {
        return String(value);
    }

    if (
        currentState.depth >=
        (
            settings.maxDepth ||
            DEFAULT_MAX_DEPTH
        )
    ) {
        return "[Maximum depth reached]";
    }

    if (
        currentState.seen.has(
            value
        )
    ) {
        return "[Circular]";
    }

    currentState.seen.add(value);

    const nextState = {
        depth:
            currentState.depth +
            1,

        seen:
            currentState.seen
    };

    if (Array.isArray(value)) {
        const maximumLength =
            settings.maxArrayLength ||
            DEFAULT_MAX_ARRAY_LENGTH;

        const output =
            value
                .slice(
                    0,
                    maximumLength
                )
                .map(
                    function (item) {
                        return sanitizeMetadata(
                            item,
                            settings,
                            nextState
                        );
                    }
                );

        if (
            value.length >
            maximumLength
        ) {
            output.push(
                "[+" +
                (
                    value.length -
                    maximumLength
                ) +
                " more items]"
            );
        }

        return output;
    }

    return Object.keys(value)
        .reduce(
            function (
                output,
                key
            ) {
                const normalizedKey =
                    normalizeSensitiveKey(
                        key
                    );

                if (
                    SENSITIVE_KEYS.has(
                        normalizedKey
                    ) ||
                    isCustomSensitiveKey(
                        key,
                        settings.sensitiveKeys
                    )
                ) {
                    output[key] =
                        settings.redaction ||
                        DEFAULT_REDACTION;

                    return output;
                }

                output[key] =
                    sanitizeMetadata(
                        value[key],
                        settings,
                        nextState
                    );

                return output;
            },
            {}
        );
}

function normalizeSensitiveKey(key) {
    return String(key)
        .toLowerCase()
        .replace(
            /[^a-z0-9]/g,
            ""
        );
}

function isCustomSensitiveKey(
    key,
    customKeys
) {
    if (
        !Array.isArray(
            customKeys
        )
    ) {
        return false;
    }

    const normalized =
        normalizeSensitiveKey(
            key
        );

    return customKeys.some(
        function (
            customKey
        ) {
            return (
                normalizeSensitiveKey(
                    customKey
                ) ===
                normalized
            );
        }
    );
}

function truncateString(
    value,
    maximumLength
) {
    if (
        value.length <=
        maximumLength
    ) {
        return value;
    }

    return (
        value.slice(
            0,
            maximumLength
        ) +
        "…[truncated]"
    );
}

/* ==========================================================
   ERROR SERIALIZATION
========================================================== */

function serializeError(
    error,
    options
) {
    if (!error) {
        return null;
    }

    const serialized = {
        name:
            error.name ||
            "Error",

        message:
            error.message ||
            String(error),

        code:
            error.code,

        status:
            error.status,

        stack:
            error.stack
    };

    if (
        error.details !==
        undefined
    ) {
        serialized.details =
            error.details;
    }

    if (
        error.cause !==
        undefined
    ) {
        serialized.cause =
            error.cause instanceof
            Error
                ? serializeError(
                      error.cause,
                      options
                  )
                : error.cause;
    }

    return sanitizeMetadata(
        serialized,
        options
    );
}

/* ==========================================================
   REQUEST AND RESPONSE METADATA
========================================================== */

function createRequestMetadata(
    request,
    options
) {
    if (!request) {
        return {};
    }

    const headers =
        request.headers ||
        {};

    return sanitizeMetadata(
        {
            request: {
                method:
                    request.method,

                path:
                    request.path ||
                    request.url,

                originalUrl:
                    request.originalUrl,

                hostname:
                    request.hostname,

                protocol:
                    request.protocol,

                ip:
                    request.ip,

                userAgent:
                    getHeader(
                        headers,
                        "user-agent"
                    ),

                origin:
                    getHeader(
                        headers,
                        "origin"
                    ),

                requestId:
                    getHeader(
                        headers,
                        "x-request-id"
                    ) ||
                    request.requestId,

                userId:
                    request.auth &&
                    request.auth.uid
                        ? request.auth.uid
                        : (
                              request.user &&
                              request.user.uid
                          ),

                query:
                    request.query,

                params:
                    request.params
            }
        },
        options
    );
}

function createResponseMetadata(
    response
) {
    if (!response) {
        return {};
    }

    return {
        response: {
            statusCode:
                response.statusCode,

            headersSent:
                response.headersSent,

            finished:
                response.finished
        }
    };
}

function getHeader(
    headers,
    name
) {
    if (!headers) {
        return undefined;
    }

    if (
        typeof headers.get ===
        "function"
    ) {
        return headers.get(name);
    }

    const normalizedName =
        String(name)
            .toLowerCase();

    const key =
        Object.keys(headers)
            .find(
                function (
                    headerName
                ) {
                    return (
                        headerName
                            .toLowerCase() ===
                        normalizedName
                    );
                }
            );

    return key
        ? headers[key]
        : undefined;
}

/* ==========================================================
   TRANSPORT
========================================================== */

function resolveTransport(
    transport
) {
    if (
        transport &&
        typeof transport ===
            "object"
    ) {
        return {
            debug:
                typeof transport.debug ===
                    "function"
                    ? transport.debug
                        .bind(transport)
                    : console.debug
                        .bind(console),

            info:
                typeof transport.info ===
                    "function"
                    ? transport.info
                        .bind(transport)
                    : console.info
                        .bind(console),

            warn:
                typeof transport.warn ===
                    "function"
                    ? transport.warn
                        .bind(transport)
                    : console.warn
                        .bind(console),

            error:
                typeof transport.error ===
                    "function"
                    ? transport.error
                        .bind(transport)
                    : console.error
                        .bind(console)
        };
    }

    const firebaseLogger =
        loadFirebaseLogger();

    if (firebaseLogger) {
        return {
            debug:
                firebaseLogger.debug
                    .bind(
                        firebaseLogger
                    ),

            info:
                firebaseLogger.info
                    .bind(
                        firebaseLogger
                    ),

            warn:
                firebaseLogger.warn
                    .bind(
                        firebaseLogger
                    ),

            error:
                firebaseLogger.error
                    .bind(
                        firebaseLogger
                    )
        };
    }

    return {
        debug:
            console.debug
                .bind(console),

        info:
            console.info
                .bind(console),

        warn:
            console.warn
                .bind(console),

        error:
            console.error
                .bind(console)
    };
}

function loadFirebaseLogger() {
    try {
        return require(
            "firebase-functions/logger"
        );
    } catch {
        return null;
    }
}

/* ==========================================================
   HELPERS
========================================================== */

function normalizeLogLevel(
    value
) {
    const normalized =
        String(value || "")
            .trim()
            .toLowerCase();

    if (
        !Object.prototype
            .hasOwnProperty
            .call(
                LOG_LEVELS,
                normalized
            )
    ) {
        const error =
            new Error(
                "Unsupported log level: " +
                normalized
            );

        error.code =
            "logger/invalid-level";

        throw error;
    }

    return normalized;
}

function resolveTimestamp(
    timestamp
) {
    if (
        typeof timestamp ===
        "function"
    ) {
        return resolveTimestamp(
            timestamp()
        );
    }

    if (
        timestamp instanceof Date
    ) {
        return timestamp
            .toISOString();
    }

    if (
        typeof timestamp ===
        "number"
    ) {
        return new Date(
            timestamp
        ).toISOString();
    }

    if (
        typeof timestamp ===
            "string" &&
        !Number.isNaN(
            Date.parse(timestamp)
        )
    ) {
        return new Date(
            timestamp
        ).toISOString();
    }

    return new Date()
        .toISOString();
}

function safeGetConfiguration() {
    try {
        return getConfiguration();
    } catch {
        return {
            logging: {
                level:
                    "info",

                providerResponses:
                    false,

                webhookPayloads:
                    false
            }
        };
    }
}

/* ==========================================================
   DEFAULT LOGGER
========================================================== */

let defaultLogger;

function getLogger(options) {
    if (
        !defaultLogger ||
        (
            options &&
            options.reload
        )
    ) {
        defaultLogger =
            createLogger(
                options
            );
    }

    return defaultLogger;
}

function resetLogger() {
    defaultLogger =
        undefined;
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
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
    LOG_LEVELS,
    SENSITIVE_KEYS:
        Array.from(
            SENSITIVE_KEYS
        ),
    DEFAULT_REDACTION,
    DEFAULT_MAX_DEPTH,
    DEFAULT_MAX_STRING_LENGTH,
    DEFAULT_MAX_ARRAY_LENGTH
};