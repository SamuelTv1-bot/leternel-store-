"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   SHARED HTTP UTILITIES
========================================================== */

const {
    createServiceError,
    isPlainObject
} = require("./validation");

/* ==========================================================
   RESPONSE HELPERS
========================================================== */

function sendJson(
    response,
    status,
    payload,
    headers
) {
    if (!response) {
        return;
    }

    const statusCode =
        normalizeStatusCode(
            status,
            200
        );

    applyHeaders(
        response,
        Object.assign(
            {
                "Cache-Control":
                    "no-store",

                "Content-Type":
                    "application/json; charset=utf-8"
            },
            headers || {}
        )
    );

    response
        .status(statusCode)
        .json(
            payload === undefined
                ? null
                : payload
        );
}

function sendSuccess(
    response,
    data,
    options
) {
    const settings =
        Object.assign(
            {
                status: 200,
                message: "",
                meta: null,
                headers: null
            },
            options || {}
        );

    const payload = {
        success: true,
        data:
            data === undefined
                ? null
                : data
    };

    if (settings.message) {
        payload.message =
            settings.message;
    }

    if (settings.meta) {
        payload.meta =
            settings.meta;
    }

    sendJson(
        response,
        settings.status,
        payload,
        settings.headers
    );
}

function sendError(
    response,
    error,
    options
) {
    const settings =
        Object.assign(
            {
                status: null,
                exposeDetails: false,
                headers: null
            },
            options || {}
        );

    const normalized =
        normalizeHttpError(error);

    const payload = {
        success: false,

        error: {
            code:
                normalized.code,

            message:
                normalized.publicMessage
        }
    };

    if (
        settings.exposeDetails &&
        normalized.details
    ) {
        payload.error.details =
            normalized.details;
    }

    sendJson(
        response,
        settings.status ||
            normalized.status,
        payload,
        settings.headers
    );
}

function sendNoContent(
    response,
    status
) {
    if (!response) {
        return;
    }

    response
        .status(
            normalizeStatusCode(
                status,
                204
            )
        )
        .set(
            "Cache-Control",
            "no-store"
        )
        .send();
}

/* ==========================================================
   ERROR HANDLING
========================================================== */

function handleHttpError(
    response,
    error,
    options
) {
    const settings =
        options || {};

    if (
        response &&
        response.headersSent
    ) {
        return;
    }

    sendError(
        response,
        error,
        {
            exposeDetails:
                Boolean(
                    settings.exposeDetails
                ),

            headers:
                settings.headers ||
                null
        }
    );
}

function normalizeHttpError(error) {
    if (!error) {
        return {
            code: "internal",
            status: 500,
            publicMessage:
                "An unexpected error occurred.",
            details: null,
            original: error
        };
    }

    const code =
        normalizeErrorCode(
            error.code ||
            error.name
        );

    const status =
        normalizeStatusCode(
            error.status ||
            mapCodeToStatus(code),
            500
        );

    return {
        code: code,
        status: status,

        publicMessage:
            error.publicMessage ||
            safeErrorMessage(
                error.message,
                status
            ),

        details:
            error.details || null,

        original: error
    };
}

function safeErrorMessage(
    message,
    status
) {
    if (
        status >= 500
    ) {
        return "The request could not be completed.";
    }

    const value =
        String(message || "")
            .trim();

    return value ||
        "The request could not be completed.";
}

function normalizeErrorCode(value) {
    const code =
        String(value || "internal")
            .trim()
            .toLowerCase()
            .replace(/^functions\//, "")
            .replace(/^https\//, "")
            .replace(/\s+/g, "-");

    const mappings = {
        unauthorized:
            "unauthenticated",

        forbidden:
            "permission-denied",

        validation:
            "invalid-argument",

        "invalid-request":
            "invalid-argument",

        "not-authorized":
            "permission-denied",

        "access-denied":
            "permission-denied",

        timeout:
            "deadline-exceeded",

        conflict:
            "aborted"
    };

    return mappings[code] ||
        code ||
        "internal";
}

function mapCodeToStatus(code) {
    const mappings = {
        cancelled: 499,
        unknown: 500,
        "invalid-argument": 400,
        "deadline-exceeded": 504,
        "not-found": 404,
        "already-exists": 409,
        "permission-denied": 403,
        "resource-exhausted": 429,
        "failed-precondition": 412,
        aborted: 409,
        "out-of-range": 400,
        unimplemented: 501,
        internal: 500,
        unavailable: 503,
        "data-loss": 500,
        unauthenticated: 401,
        "method-not-allowed": 405,
        "unsupported-media-type": 415,
        "payload-too-large": 413,
        "rate-limited": 429,
        "invalid-signature": 401,
        "order-not-found": 404,
        "product-not-found": 404,
        "out-of-stock": 409,
        "payment-failed": 402
    };

    return mappings[code] || 500;
}

/* ==========================================================
   METHOD HANDLING
========================================================== */

function requireMethod(
    request,
    allowedMethods
) {
    const methods =
        normalizeMethods(
            allowedMethods
        );

    const method =
        String(
            request &&
            request.method
                ? request.method
                : ""
        ).toUpperCase();

    if (!methods.includes(method)) {
        throw createServiceError(
            "method-not-allowed",
            "This HTTP method is not supported.",
            {
                status: 405,
                details: {
                    allowedMethods:
                        methods
                }
            }
        );
    }

    return method;
}

function rejectUnsupportedMethod(
    response,
    allowedMethods
) {
    const methods =
        normalizeMethods(
            allowedMethods
        );

    if (response) {
        response.set(
            "Allow",
            methods.join(", ")
        );
    }

    sendError(
        response,
        createServiceError(
            "method-not-allowed",
            "This HTTP method is not supported.",
            {
                status: 405,
                details: {
                    allowedMethods:
                        methods
                }
            }
        ),
        {
            headers: {
                "Allow":
                    methods.join(", ")
            }
        }
    );
}

function normalizeMethods(value) {
    const methods =
        Array.isArray(value)
            ? value
            : [value];

    return methods
        .filter(Boolean)
        .map(function (method) {
            return String(method)
                .trim()
                .toUpperCase();
        });
}

/* ==========================================================
   REQUEST BODY
========================================================== */

function parseJsonBody(
    request,
    options
) {
    const settings =
        Object.assign(
            {
                required: false,
                maximumBytes:
                    1024 * 1024
            },
            options || {}
        );

    enforceContentLength(
        request,
        settings.maximumBytes
    );

    const body =
        request &&
        request.body !== undefined
            ? request.body
            : null;

    if (
        body === null ||
        body === undefined ||
        body === ""
    ) {
        if (settings.required) {
            throw createServiceError(
                "invalid-argument",
                "A JSON request body is required.",
                {
                    status: 400
                }
            );
        }

        return {};
    }

    if (isPlainObject(body)) {
        return body;
    }

    if (Buffer.isBuffer(body)) {
        return parseJsonString(
            body.toString("utf8")
        );
    }

    if (
        typeof body === "string"
    ) {
        return parseJsonString(body);
    }

    throw createServiceError(
        "invalid-argument",
        "The request body must contain valid JSON.",
        {
            status: 400
        }
    );
}

function parseJsonString(value) {
    try {
        const parsed =
            JSON.parse(value);

        if (!isPlainObject(parsed)) {
            throw new Error(
                "JSON body is not an object."
            );
        }

        return parsed;
    } catch (error) {
        throw createServiceError(
            "invalid-argument",
            "The request body contains invalid JSON.",
            {
                status: 400,
                cause: error
            }
        );
    }
}

function requireJsonContentType(
    request
) {
    const contentType =
        getHeader(
            request,
            "content-type"
        ).toLowerCase();

    if (
        !contentType.includes(
            "application/json"
        )
    ) {
        throw createServiceError(
            "unsupported-media-type",
            "The request must use application/json.",
            {
                status: 415
            }
        );
    }

    return true;
}

function enforceContentLength(
    request,
    maximumBytes
) {
    const maximum =
        Number(maximumBytes) ||
        1024 * 1024;

    const header =
        getHeader(
            request,
            "content-length"
        );

    if (!header) {
        return;
    }

    const contentLength =
        Number(header);

    if (
        Number.isFinite(contentLength) &&
        contentLength > maximum
    ) {
        throw createServiceError(
            "payload-too-large",
            "The request body is too large.",
            {
                status: 413,
                details: {
                    maximumBytes:
                        maximum
                }
            }
        );
    }
}

/* ==========================================================
   QUERY & PATH HELPERS
========================================================== */

function getQuery(
    request
) {
    const query =
        request &&
        request.query
            ? request.query
            : {};

    return Object.keys(query).reduce(
        function (output, key) {
            const value =
                query[key];

            if (Array.isArray(value)) {
                output[key] =
                    value.map(
                        normalizeQueryValue
                    );
            } else {
                output[key] =
                    normalizeQueryValue(
                        value
                    );
            }

            return output;
        },
        {}
    );
}

function normalizeQueryValue(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return "";
    }

    return String(value).trim();
}

function getPathSegments(
    request,
    prefix
) {
    let path =
        String(
            request &&
            (
                request.path ||
                request.url
            )
                ? request.path ||
                  request.url
                : ""
        );

    path =
        path.split("?")[0];

    if (
        prefix &&
        path.startsWith(prefix)
    ) {
        path =
            path.slice(
                prefix.length
            );
    }

    return path
        .split("/")
        .map(function (segment) {
            return decodeURIComponent(
                segment
            ).trim();
        })
        .filter(Boolean);
}

function getRouteParameter(
    request,
    index,
    prefix
) {
    const segments =
        getPathSegments(
            request,
            prefix
        );

    return segments[
        Number(index) || 0
    ] || "";
}

/* ==========================================================
   HEADERS & CORS
========================================================== */

function getHeader(
    request,
    name
) {
    if (
        !request ||
        !request.headers
    ) {
        return "";
    }

    const key =
        String(name || "")
            .toLowerCase();

    const value =
        request.headers[key];

    if (Array.isArray(value)) {
        return value.join(", ");
    }

    return value === undefined
        ? ""
        : String(value);
}

function applyHeaders(
    response,
    headers
) {
    if (
        !response ||
        !headers
    ) {
        return;
    }

    Object.keys(headers).forEach(
        function (key) {
            const value =
                headers[key];

            if (
                value !== undefined &&
                value !== null
            ) {
                response.set(
                    key,
                    String(value)
                );
            }
        }
    );
}

function applyCors(
    request,
    response,
    options
) {
    const settings =
        Object.assign(
            {
                origins: [],
                methods: [
                    "GET",
                    "POST",
                    "PATCH",
                    "DELETE",
                    "OPTIONS"
                ],
                headers: [
                    "Authorization",
                    "Content-Type",
                    "X-Requested-With",
                    "X-Idempotency-Key"
                ],
                credentials: false,
                maximumAge: 3600
            },
            options || {}
        );

    const origin =
        getHeader(
            request,
            "origin"
        );

    const allowedOrigin =
        resolveAllowedOrigin(
            origin,
            settings.origins
        );

    if (allowedOrigin) {
        response.set(
            "Access-Control-Allow-Origin",
            allowedOrigin
        );

        response.set(
            "Vary",
            "Origin"
        );
    }

    response.set(
        "Access-Control-Allow-Methods",
        normalizeMethods(
            settings.methods
        ).join(", ")
    );

    response.set(
        "Access-Control-Allow-Headers",
        settings.headers.join(", ")
    );

    response.set(
        "Access-Control-Max-Age",
        String(
            settings.maximumAge
        )
    );

    if (settings.credentials) {
        response.set(
            "Access-Control-Allow-Credentials",
            "true"
        );
    }

    if (
        request.method === "OPTIONS"
    ) {
        sendNoContent(
            response,
            204
        );

        return true;
    }

    return false;
}

function resolveAllowedOrigin(
    origin,
    allowedOrigins
) {
    if (!origin) {
        return "";
    }

    const origins =
        Array.isArray(
            allowedOrigins
        )
            ? allowedOrigins
            : [allowedOrigins];

    if (
        origins.includes("*")
    ) {
        return "*";
    }

    return origins.includes(origin)
        ? origin
        : "";
}

/* ==========================================================
   CACHE & SECURITY HEADERS
========================================================== */

function setNoStore(response) {
    if (!response) {
        return;
    }

    response.set(
        "Cache-Control",
        "no-store, max-age=0"
    );

    response.set(
        "Pragma",
        "no-cache"
    );
}

function setPrivateCache(
    response,
    seconds
) {
    if (!response) {
        return;
    }

    const maximumAge =
        Math.max(
            0,
            Number(seconds) || 0
        );

    response.set(
        "Cache-Control",
        "private, max-age=" +
            maximumAge
    );
}

function applySecurityHeaders(
    response
) {
    applyHeaders(
        response,
        {
            "X-Content-Type-Options":
                "nosniff",

            "X-Frame-Options":
                "DENY",

            "Referrer-Policy":
                "no-referrer",

            "Permissions-Policy":
                "camera=(), microphone=(), geolocation=()"
        }
    );
}

/* ==========================================================
   IDEMPOTENCY & CLIENT INFORMATION
========================================================== */

function getIdempotencyKey(
    request
) {
    return getHeader(
        request,
        "x-idempotency-key"
    ).trim();
}

function getClientInformation(
    request
) {
    const forwardedFor =
        getHeader(
            request,
            "x-forwarded-for"
        );

    const firstForwardedAddress =
        forwardedFor
            .split(",")[0]
            .trim();

    return {
        ipAddress:
            firstForwardedAddress ||
            (
                request &&
                request.ip
                    ? request.ip
                    : null
            ),

        userAgent:
            getHeader(
                request,
                "user-agent"
            ),

        origin:
            getHeader(
                request,
                "origin"
            ),

        referer:
            getHeader(
                request,
                "referer"
            )
    };
}

/* ==========================================================
   PAGINATION
========================================================== */

function encodeCursor(value) {
    const payload =
        JSON.stringify(value);

    return Buffer
        .from(
            payload,
            "utf8"
        )
        .toString("base64url");
}

function decodeCursor(value) {
    if (!value) {
        return null;
    }

    try {
        const decoded =
            Buffer
                .from(
                    String(value),
                    "base64url"
                )
                .toString("utf8");

        return JSON.parse(
            decoded
        );
    } catch (error) {
        throw createServiceError(
            "invalid-argument",
            "The pagination cursor is invalid.",
            {
                status: 400,
                cause: error
            }
        );
    }
}

/* ==========================================================
   STATUS
========================================================== */

function normalizeStatusCode(
    value,
    fallback
) {
    const status =
        Number(value);

    if (
        Number.isInteger(status) &&
        status >= 100 &&
        status <= 599
    ) {
        return status;
    }

    return Number(fallback) || 500;
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    sendJson:
        sendJson,

    sendSuccess:
        sendSuccess,

    sendError:
        sendError,

    sendNoContent:
        sendNoContent,

    handleHttpError:
        handleHttpError,

    normalizeHttpError:
        normalizeHttpError,

    normalizeErrorCode:
        normalizeErrorCode,

    mapCodeToStatus:
        mapCodeToStatus,

    requireMethod:
        requireMethod,

    rejectUnsupportedMethod:
        rejectUnsupportedMethod,

    parseJsonBody:
        parseJsonBody,

    requireJsonContentType:
        requireJsonContentType,

    enforceContentLength:
        enforceContentLength,

    getQuery:
        getQuery,

    getPathSegments:
        getPathSegments,

    getRouteParameter:
        getRouteParameter,

    getHeader:
        getHeader,

    applyHeaders:
        applyHeaders,

    applyCors:
        applyCors,

    setNoStore:
        setNoStore,

    setPrivateCache:
        setPrivateCache,

    applySecurityHeaders:
        applySecurityHeaders,

    getIdempotencyKey:
        getIdempotencyKey,

    getClientInformation:
        getClientInformation,

    encodeCursor:
        encodeCursor,

    decodeCursor:
        decodeCursor,

    normalizeStatusCode:
        normalizeStatusCode
};