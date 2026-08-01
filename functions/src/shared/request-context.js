"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   REQUEST CONTEXT

   Responsibilities:
   - Create normalized request metadata
   - Resolve authenticated user identity
   - Resolve request IDs
   - Resolve IP address and user agent
   - Provide request-scoped loggers
   - Support callable and HTTP requests
========================================================== */

const crypto =
    require("node:crypto");

const {
    createLogger,
    getLogger
} = require(
    "./logger"
);

/* ==========================================================
   CONSTANTS
========================================================== */

const DEFAULT_REQUEST_ID_HEADER =
    "x-request-id";

const DEFAULT_CORRELATION_ID_HEADER =
    "x-correlation-id";

const DEFAULT_USER_AGENT_HEADER =
    "user-agent";

const DEFAULT_ORIGIN_HEADER =
    "origin";

const DEFAULT_FORWARDED_FOR_HEADER =
    "x-forwarded-for";

const DEFAULT_REQUEST_ID_PREFIX =
    "req";

/* ==========================================================
   REQUEST CONTEXT FACTORY
========================================================== */

function createRequestContext(
    request,
    options
) {
    const settings =
        options || {};

    const now =
        typeof settings.now ===
            "function"
            ? settings.now
            : Date.now;

    const startedAt =
        normalizeTime(
            settings.startedAt,
            now
        );

    const requestId =
        resolveRequestId(
            request,
            settings
        );

    const correlationId =
        resolveCorrelationId(
            request,
            {
                requestId:
                    requestId,

                headerName:
                    settings
                        .correlationIdHeader
            }
        );

    const identity =
        resolveRequestIdentity(
            request,
            settings
        );

    const method =
        resolveRequestMethod(
            request
        );

    const path =
        resolveRequestPath(
            request
        );

    const context = {
        requestId:
            requestId,

        correlationId:
            correlationId,

        startedAt:
            startedAt,

        startedAtIso:
            new Date(
                startedAt
            ).toISOString(),

        method:
            method,

        path:
            path,

        originalUrl:
            request &&
            request.originalUrl
                ? String(
                      request.originalUrl
                  )
                : path,

        protocol:
            request &&
            request.protocol
                ? String(
                      request.protocol
                  )
                : "",

        hostname:
            request &&
            request.hostname
                ? String(
                      request.hostname
                  )
                : "",

        origin:
            resolveHeader(
                request,
                settings.originHeader ||
                DEFAULT_ORIGIN_HEADER
            ) || "",

        ip:
            resolveRequestIp(
                request,
                settings
            ),

        userAgent:
            resolveHeader(
                request,
                settings.userAgentHeader ||
                DEFAULT_USER_AGENT_HEADER
            ) || "",

        identity:
            identity,

        userId:
            identity
                ? identity.uid
                : null,

        email:
            identity
                ? identity.email
                : null,

        role:
            identity
                ? identity.role
                : null,

        authenticated:
            Boolean(identity),

        isAdmin:
            Boolean(
                identity &&
                identity.isAdmin
            ),

        isSuperAdmin:
            Boolean(
                identity &&
                identity.isSuperAdmin
            ),

        query:
            cloneValue(
                request &&
                request.query
                    ? request.query
                    : {}
            ),

        params:
            cloneValue(
                request &&
                request.params
                    ? request.params
                    : {}
            ),

        app:
            cloneValue(
                request &&
                request.app
                    ? request.app
                    : null
            ),

        logger:
            null,

        now:
            now,

        elapsed:
            function () {
                return Math.max(
                    0,
                    Number(now()) -
                    startedAt
                );
            },

        metadata:
            function (
                additional
            ) {
                return createContextMetadata(
                    context,
                    additional
                );
            }
    };

    const baseLogger =
        settings.logger ||
        getLogger();

    context.logger =
        createRequestLogger(
            baseLogger,
            context,
            settings
        );

    return Object.freeze(
        context
    );
}

/* ==========================================================
   CALLABLE CONTEXT
========================================================== */

function createCallableContext(
    callableRequest,
    options
) {
    const settings =
        options || {};

    const rawRequest =
        callableRequest &&
        callableRequest.rawRequest
            ? callableRequest.rawRequest
            : callableRequest;

    const request =
        Object.assign(
            {},
            rawRequest || {},
            {
                auth:
                    callableRequest &&
                    callableRequest.auth
                        ? callableRequest.auth
                        : (
                              rawRequest &&
                              rawRequest.auth
                          ),

                app:
                    callableRequest &&
                    callableRequest.app
                        ? callableRequest.app
                        : (
                              rawRequest &&
                              rawRequest.app
                          ),

                data:
                    callableRequest &&
                    callableRequest.data
                        ? callableRequest.data
                        : {}
            }
        );

    const context =
        createRequestContext(
            request,
            Object.assign(
                {},
                settings,
                {
                    requestType:
                        "callable"
                }
            )
        );

    return Object.freeze(
        Object.assign(
            {},
            context,
            {
                callable:
                    true,

                data:
                    cloneValue(
                        callableRequest &&
                        callableRequest.data
                            ? callableRequest.data
                            : {}
                    ),

                appCheck:
                    cloneValue(
                        callableRequest &&
                        callableRequest.app
                            ? callableRequest.app
                            : null
                    )
            }
        )
    );
}

/* ==========================================================
   REQUEST IDENTIFIERS
========================================================== */

function resolveRequestId(
    request,
    options
) {
    const settings =
        options || {};

    const headerName =
        settings.requestIdHeader ||
        DEFAULT_REQUEST_ID_HEADER;

    const supplied =
        resolveHeader(
            request,
            headerName
        );

    if (
        supplied &&
        isValidRequestId(
            supplied
        )
    ) {
        return String(
            supplied
        ).trim();
    }

    if (
        request &&
        request.requestId &&
        isValidRequestId(
            request.requestId
        )
    ) {
        return String(
            request.requestId
        ).trim();
    }

    if (
        typeof settings.generateRequestId ===
        "function"
    ) {
        const generated =
            settings
                .generateRequestId();

        if (
            !isValidRequestId(
                generated
            )
        ) {
            throw createRequestContextError(
                "request-context/invalid-generated-id",
                "The generated request ID is invalid."
            );
        }

        return String(
            generated
        ).trim();
    }

    return generateRequestId(
        settings.requestIdPrefix ||
        DEFAULT_REQUEST_ID_PREFIX
    );
}

function resolveCorrelationId(
    request,
    options
) {
    const settings =
        options || {};

    const supplied =
        resolveHeader(
            request,
            settings.headerName ||
            DEFAULT_CORRELATION_ID_HEADER
        );

    if (
        supplied &&
        isValidRequestId(
            supplied
        )
    ) {
        return String(
            supplied
        ).trim();
    }

    return settings.requestId ||
        generateRequestId(
            "corr"
        );
}

function generateRequestId(
    prefix
) {
    const normalizedPrefix =
        String(
            prefix ||
            DEFAULT_REQUEST_ID_PREFIX
        )
            .trim()
            .replace(
                /[^a-zA-Z0-9_-]/g,
                ""
            ) ||
        DEFAULT_REQUEST_ID_PREFIX;

    if (
        typeof crypto.randomUUID ===
        "function"
    ) {
        return (
            normalizedPrefix +
            "_" +
            crypto.randomUUID()
        );
    }

    return (
        normalizedPrefix +
        "_" +
        crypto
            .randomBytes(16)
            .toString("hex")
    );
}

function isValidRequestId(value) {
    if (
        value === undefined ||
        value === null
    ) {
        return false;
    }

    const normalized =
        String(value)
            .trim();

    return (
        normalized.length >= 3 &&
        normalized.length <= 200 &&
        /^[A-Za-z0-9._:-]+$/
            .test(normalized)
    );
}

/* ==========================================================
   IDENTITY RESOLUTION
========================================================== */

function resolveRequestIdentity(
    request,
    options
) {
    const settings =
        options || {};

    if (
        settings.identity !==
        undefined
    ) {
        return normalizeIdentity(
            settings.identity
        );
    }

    const auth =
        request &&
        request.auth
            ? request.auth
            : null;

    if (
        auth &&
        auth.uid
    ) {
        return normalizeIdentity({
            uid:
                auth.uid,

            email:
                auth.token &&
                auth.token.email,

            emailVerified:
                auth.token &&
                (
                    auth.token
                        .email_verified ||
                    auth.token
                        .emailVerified
                ),

            role:
                auth.token &&
                auth.token.role,

            admin:
                auth.token &&
                auth.token.admin,

            superadmin:
                auth.token &&
                auth.token.superadmin,

            token:
                auth.token
        });
    }

    const user =
        request &&
        request.user
            ? request.user
            : null;

    if (
        user &&
        user.uid
    ) {
        return normalizeIdentity(
            user
        );
    }

    const identity =
        request &&
        request.identity
            ? request.identity
            : null;

    if (
        identity &&
        identity.uid
    ) {
        return normalizeIdentity(
            identity
        );
    }

    return null;
}

function normalizeIdentity(
    identity
) {
    if (!identity) {
        return null;
    }

    const role =
        String(
            identity.role ||
            (
                identity.customClaims &&
                identity.customClaims.role
            ) ||
            (
                identity.token &&
                identity.token.role
            ) ||
            "customer"
        )
            .trim()
            .toLowerCase();

    const isSuperAdmin =
        Boolean(
            identity.superadmin ||
            identity.isSuperAdmin ||
            (
                identity.customClaims &&
                identity
                    .customClaims
                    .superadmin
            ) ||
            (
                identity.token &&
                identity
                    .token
                    .superadmin
            ) ||
            role ===
                "superadmin"
        );

    const isAdmin =
        Boolean(
            identity.admin ||
            identity.isAdmin ||
            (
                identity.customClaims &&
                identity
                    .customClaims
                    .admin
            ) ||
            (
                identity.token &&
                identity
                    .token
                    .admin
            ) ||
            role ===
                "admin" ||
            isSuperAdmin
        );

    return Object.freeze({
        uid:
            String(
                identity.uid
            ),

        email:
            identity.email
                ? String(
                      identity.email
                  )
                      .trim()
                      .toLowerCase()
                : null,

        emailVerified:
            Boolean(
                identity.emailVerified ||
                identity.email_verified
            ),

        role:
            role,

        isAdmin:
            isAdmin,

        isSuperAdmin:
            isSuperAdmin,

        disabled:
            Boolean(
                identity.disabled
            )
    });
}

/* ==========================================================
   REQUEST METADATA
========================================================== */

function createContextMetadata(
    context,
    additional
) {
    return Object.assign(
        {
            requestId:
                context.requestId,

            correlationId:
                context.correlationId,

            method:
                context.method,

            path:
                context.path,

            ip:
                context.ip,

            userId:
                context.userId,

            role:
                context.role,

            authenticated:
                context.authenticated,

            elapsedMs:
                context.elapsed()
        },
        cloneValue(
            additional ||
            {}
        )
    );
}

function createRequestLogger(
    logger,
    context,
    options
) {
    const settings =
        options || {};

    if (
        logger &&
        typeof logger.child ===
            "function"
    ) {
        return logger.child({
            requestId:
                context.requestId,

            correlationId:
                context.correlationId,

            method:
                context.method,

            path:
                context.path,

            userId:
                context.userId,

            role:
                context.role,

            requestType:
                settings.requestType ||
                "http"
        });
    }

    return createLogger({
        context: {
            requestId:
                context.requestId,

            correlationId:
                context.correlationId,

            method:
                context.method,

            path:
                context.path,

            userId:
                context.userId,

            role:
                context.role,

            requestType:
                settings.requestType ||
                "http"
        }
    });
}

/* ==========================================================
   REQUEST VALUES
========================================================== */

function resolveRequestMethod(
    request
) {
    return String(
        request &&
        request.method
            ? request.method
            : "GET"
    ).toUpperCase();
}

function resolveRequestPath(
    request
) {
    if (!request) {
        return "/";
    }

    return String(
        request.path ||
        request.routePath ||
        request.originalUrl ||
        request.url ||
        "/"
    );
}

function resolveRequestIp(
    request,
    options
) {
    const settings =
        options || {};

    const trustProxy =
        Boolean(
            settings.trustProxy
        );

    if (trustProxy) {
        const forwarded =
            resolveHeader(
                request,
                settings
                    .forwardedForHeader ||
                DEFAULT_FORWARDED_FOR_HEADER
            );

        if (forwarded) {
            const first =
                String(forwarded)
                    .split(",")[0]
                    .trim();

            if (first) {
                return first;
            }
        }

        if (
            request &&
            Array.isArray(
                request.ips
            ) &&
            request.ips.length
        ) {
            return String(
                request.ips[0]
            );
        }
    }

    if (
        request &&
        request.ip
    ) {
        return String(
            request.ip
        );
    }

    if (
        request &&
        request.socket &&
        request.socket.remoteAddress
    ) {
        return String(
            request.socket
                .remoteAddress
        );
    }

    if (
        request &&
        request.connection &&
        request.connection
            .remoteAddress
    ) {
        return String(
            request.connection
                .remoteAddress
        );
    }

    return "";
}

function resolveHeader(
    request,
    name
) {
    if (
        !request ||
        !name
    ) {
        return undefined;
    }

    if (
        typeof request.get ===
        "function"
    ) {
        const value =
            request.get(name);

        if (
            value !== undefined
        ) {
            return value;
        }
    }

    if (
        typeof request.header ===
        "function"
    ) {
        const value =
            request.header(name);

        if (
            value !== undefined
        ) {
            return value;
        }
    }

    const headers =
        request.headers;

    if (!headers) {
        return undefined;
    }

    if (
        typeof headers.get ===
        "function"
    ) {
        return headers.get(name);
    }

    const normalized =
        String(name)
            .toLowerCase();

    const matchingKey =
        Object.keys(headers)
            .find(
                function (key) {
                    return (
                        String(key)
                            .toLowerCase() ===
                        normalized
                    );
                }
            );

    return matchingKey
        ? headers[
              matchingKey
          ]
        : undefined;
}

/* ==========================================================
   RESPONSE HELPERS
========================================================== */

function attachRequestContext(
    request,
    response,
    options
) {
    const context =
        createRequestContext(
            request,
            options
        );

    if (request) {
        request.context =
            context;

        request.requestContext =
            context;

        request.requestId =
            context.requestId;
    }

    if (response) {
        setResponseHeader(
            response,
            DEFAULT_REQUEST_ID_HEADER,
            context.requestId
        );

        setResponseHeader(
            response,
            DEFAULT_CORRELATION_ID_HEADER,
            context.correlationId
        );

        if (
            response.locals &&
            typeof response.locals ===
                "object"
        ) {
            response.locals
                .requestContext =
                context;
        }
    }

    return context;
}

function setResponseHeader(
    response,
    name,
    value
) {
    if (!response) {
        return;
    }

    if (
        typeof response.set ===
        "function"
    ) {
        response.set(
            name,
            value
        );

        return;
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
}

/* ==========================================================
   MIDDLEWARE
========================================================== */

function createRequestContextMiddleware(
    options
) {
    const settings =
        options || {};

    return function requestContextMiddleware(
        request,
        response,
        next
    ) {
        try {
            attachRequestContext(
                request,
                response,
                settings
            );

            if (
                typeof next ===
                "function"
            ) {
                next();
            }
        } catch (error) {
            if (
                typeof next ===
                "function"
            ) {
                next(error);

                return;
            }

            throw error;
        }
    };
}

/* ==========================================================
   TIME HELPERS
========================================================== */

function normalizeTime(
    value,
    now
) {
    if (
        value === undefined ||
        value === null
    ) {
        return Number(
            now()
        );
    }

    if (value instanceof Date) {
        return value.getTime();
    }

    if (
        value &&
        typeof value.toMillis ===
            "function"
    ) {
        return value.toMillis();
    }

    if (
        typeof value ===
        "string"
    ) {
        const parsed =
            Date.parse(value);

        if (
            Number.isNaN(parsed)
        ) {
            throw createRequestContextError(
                "request-context/invalid-time",
                "Invalid request start time."
            );
        }

        return parsed;
    }

    const numeric =
        Number(value);

    if (
        !Number.isFinite(
            numeric
        )
    ) {
        throw createRequestContextError(
            "request-context/invalid-time",
            "Invalid request start time."
        );
    }

    return numeric;
}

/* ==========================================================
   VALUE HELPERS
========================================================== */

function cloneValue(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    if (value instanceof Date) {
        return new Date(
            value.getTime()
        );
    }

    if (Buffer.isBuffer(value)) {
        return Buffer.from(value);
    }

    if (Array.isArray(value)) {
        return value.map(
            cloneValue
        );
    }

    if (
        typeof value ===
        "object"
    ) {
        return Object.keys(value)
            .reduce(
                function (
                    output,
                    key
                ) {
                    output[key] =
                        cloneValue(
                            value[key]
                        );

                    return output;
                },
                {}
            );
    }

    return value;
}

/* ==========================================================
   ERROR HELPER
========================================================== */

function createRequestContextError(
    code,
    message,
    details
) {
    const error =
        new Error(message);

    error.code =
        code;

    if (
        details !== undefined
    ) {
        error.details =
            details;
    }

    return error;
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
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
    constants: {
        DEFAULT_REQUEST_ID_HEADER,
        DEFAULT_CORRELATION_ID_HEADER,
        DEFAULT_USER_AGENT_HEADER,
        DEFAULT_ORIGIN_HEADER,
        DEFAULT_FORWARDED_FOR_HEADER,
        DEFAULT_REQUEST_ID_PREFIX
    }
};