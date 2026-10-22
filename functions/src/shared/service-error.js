"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   SERVICE ERROR

   Responsibilities:
   - Standardize service-layer errors
   - Map internal errors to safe public errors
   - Normalize error codes and HTTP statuses
   - Support Firebase callable error conversion
   - Preserve structured details safely
========================================================== */

/* ==========================================================
   CONSTANTS
========================================================== */

const DEFAULT_ERROR_CODE =
    "internal";

const DEFAULT_ERROR_MESSAGE =
    "An unexpected error occurred.";

const DEFAULT_HTTP_STATUS =
    500;

const ERROR_DEFINITIONS =
    Object.freeze({
        "invalid-argument": {
            status:
                400,

            message:
                "The request contains invalid information.",

            callableCode:
                "invalid-argument"
        },

        "failed-precondition": {
            status:
                400,

            message:
                "The request cannot be completed in its current state.",

            callableCode:
                "failed-precondition"
        },

        unauthenticated: {
            status:
                401,

            message:
                "Authentication is required.",

            callableCode:
                "unauthenticated"
        },

        "permission-denied": {
            status:
                403,

            message:
                "You do not have permission to perform this action.",

            callableCode:
                "permission-denied"
        },

        "not-found": {
            status:
                404,

            message:
                "The requested resource was not found.",

            callableCode:
                "not-found"
        },

        "already-exists": {
            status:
                409,

            message:
                "The requested resource already exists.",

            callableCode:
                "already-exists"
        },

        aborted: {
            status:
                409,

            message:
                "The operation was interrupted.",

            callableCode:
                "aborted"
        },

        conflict: {
            status:
                409,

            message:
                "The request conflicts with the current resource state.",

            callableCode:
                "aborted"
        },

        "out-of-range": {
            status:
                400,

            message:
                "A supplied value is outside the permitted range.",

            callableCode:
                "out-of-range"
        },

        "resource-exhausted": {
            status:
                429,

            message:
                "The requested operation cannot be completed at this time.",

            callableCode:
                "resource-exhausted"
        },

        "too-many-requests": {
            status:
                429,

            message:
                "Too many requests were received. Please try again later.",

            callableCode:
                "resource-exhausted"
        },

        cancelled: {
            status:
                499,

            message:
                "The operation was cancelled.",

            callableCode:
                "cancelled"
        },

        "deadline-exceeded": {
            status:
                504,

            message:
                "The operation took too long to complete.",

            callableCode:
                "deadline-exceeded"
        },

        unavailable: {
            status:
                503,

            message:
                "The service is temporarily unavailable.",

            callableCode:
                "unavailable"
        },

        "provider-error": {
            status:
                502,

            message:
                "An external service could not complete the request.",

            callableCode:
                "unavailable"
        },

        "payment-failed": {
            status:
                402,

            message:
                "The payment could not be completed.",

            callableCode:
                "failed-precondition"
        },

        "inventory-unavailable": {
            status:
                409,

            message:
                "One or more items are no longer available in the requested quantity.",

            callableCode:
                "failed-precondition"
        },

        "order-not-cancellable": {
            status:
                409,

            message:
                "This order can no longer be cancelled.",

            callableCode:
                "failed-precondition"
        },

        "configuration-error": {
            status:
                500,

            message:
                "The service is not configured correctly.",

            callableCode:
                "internal"
        },

        internal: {
            status:
                500,

            message:
                DEFAULT_ERROR_MESSAGE,

            callableCode:
                "internal"
        }
    });

const HTTP_STATUS_TO_CODE =
    Object.freeze({
        400:
            "invalid-argument",

        401:
            "unauthenticated",

        402:
            "payment-failed",

        403:
            "permission-denied",

        404:
            "not-found",

        408:
            "deadline-exceeded",

        409:
            "conflict",

        412:
            "failed-precondition",

        422:
            "invalid-argument",

        429:
            "resource-exhausted",

        499:
            "cancelled",

        500:
            "internal",

        502:
            "provider-error",

        503:
            "unavailable",

        504:
            "deadline-exceeded"
    });

const FIREBASE_CODE_ALIASES =
    Object.freeze({
        "auth/argument-error":
            "invalid-argument",

        "auth/invalid-argument":
            "invalid-argument",

        "auth/id-token-expired":
            "unauthenticated",

        "auth/id-token-revoked":
            "unauthenticated",

        "auth/invalid-id-token":
            "unauthenticated",

        "auth/user-disabled":
            "permission-denied",

        "auth/user-not-found":
            "not-found",

        "auth/email-already-exists":
            "already-exists",

        "auth/uid-already-exists":
            "already-exists",

        "auth/insufficient-permission":
            "permission-denied",

        "firestore/already-exists":
            "already-exists",

        "firestore/not-found":
            "not-found",

        "firestore/permission-denied":
            "permission-denied",

        "firestore/failed-precondition":
            "failed-precondition",

        "firestore/aborted":
            "aborted",

        "firestore/resource-exhausted":
            "resource-exhausted",

        "firestore/unavailable":
            "unavailable",

        "storage/object-not-found":
            "not-found",

        "storage/unauthorized":
            "permission-denied",

        "storage/canceled":
            "cancelled",

        "storage/retry-limit-exceeded":
            "unavailable"
    });

/* ==========================================================
   SERVICE ERROR CLASS
========================================================== */

class ServiceError extends Error {
    constructor(
        code,
        message,
        options
    ) {
        const settings =
            options || {};

        const normalizedCode =
            normalizeErrorCode(
                code
            );

        const definition =
            getErrorDefinition(
                normalizedCode
            );

        const publicMessage =
            message ||
            settings.publicMessage ||
            definition.message;

        super(
            settings.internalMessage ||
            publicMessage,
            settings.cause
                ? {
                      cause:
                          settings.cause
                  }
                : undefined
        );

        this.name =
            "ServiceError";

        this.code =
            normalizedCode;

        this.status =
            normalizeHttpStatus(
                settings.status,
                definition.status
            );

        this.publicMessage =
            publicMessage;

        this.details =
            sanitizeErrorDetails(
                settings.details
            );

        this.expose =
            settings.expose !==
            undefined
                ? Boolean(
                      settings.expose
                  )
                : this.status < 500;

        this.retryable =
            settings.retryable !==
            undefined
                ? Boolean(
                      settings.retryable
                  )
                : isRetryableCode(
                      normalizedCode
                  );

        this.cause =
            settings.cause;

        this.requestId =
            settings.requestId ||
            null;

        this.correlationId =
            settings.correlationId ||
            null;

        this.timestamp =
            normalizeTimestamp(
                settings.timestamp
            );

        if (
            Error.captureStackTrace
        ) {
            Error.captureStackTrace(
                this,
                ServiceError
            );
        }
    }

    toJSON() {
        return {
            name:
                this.name,

            code:
                this.code,

            status:
                this.status,

            message:
                this.publicMessage,

            details:
                cloneValue(
                    this.details
                ),

            retryable:
                this.retryable,

            requestId:
                this.requestId,

            correlationId:
                this.correlationId,

            timestamp:
                this.timestamp
        };
    }

    toPublicJSON() {
        return createPublicErrorPayload(
            this
        );
    }
}

/* ==========================================================
   FACTORIES
========================================================== */

function createServiceError(
    code,
    message,
    options
) {
    if (
        code instanceof
        ServiceError
    ) {
        return code;
    }

    if (
        code instanceof Error
    ) {
        return normalizeServiceError(
            code,
            message &&
            typeof message ===
                "object"
                ? message
                : options
        );
    }

    return new ServiceError(
        code,
        message,
        options
    );
}

function invalidArgument(
    message,
    details,
    options
) {
    return new ServiceError(
        "invalid-argument",
        message,
        Object.assign(
            {},
            options || {},
            {
                details:
                    details
            }
        )
    );
}

function unauthenticated(
    message,
    details,
    options
) {
    return new ServiceError(
        "unauthenticated",
        message,
        Object.assign(
            {},
            options || {},
            {
                details:
                    details
            }
        )
    );
}

function permissionDenied(
    message,
    details,
    options
) {
    return new ServiceError(
        "permission-denied",
        message,
        Object.assign(
            {},
            options || {},
            {
                details:
                    details
            }
        )
    );
}

function notFound(
    message,
    details,
    options
) {
    return new ServiceError(
        "not-found",
        message,
        Object.assign(
            {},
            options || {},
            {
                details:
                    details
            }
        )
    );
}

function alreadyExists(
    message,
    details,
    options
) {
    return new ServiceError(
        "already-exists",
        message,
        Object.assign(
            {},
            options || {},
            {
                details:
                    details
            }
        )
    );
}

function failedPrecondition(
    message,
    details,
    options
) {
    return new ServiceError(
        "failed-precondition",
        message,
        Object.assign(
            {},
            options || {},
            {
                details:
                    details
            }
        )
    );
}

function conflict(
    message,
    details,
    options
) {
    return new ServiceError(
        "conflict",
        message,
        Object.assign(
            {},
            options || {},
            {
                details:
                    details
            }
        )
    );
}

function paymentFailed(
    message,
    details,
    options
) {
    return new ServiceError(
        "payment-failed",
        message,
        Object.assign(
            {},
            options || {},
            {
                details:
                    details
            }
        )
    );
}

function inventoryUnavailable(
    message,
    details,
    options
) {
    return new ServiceError(
        "inventory-unavailable",
        message,
        Object.assign(
            {},
            options || {},
            {
                details:
                    details
            }
        )
    );
}

function internalError(
    message,
    cause,
    options
) {
    const settings =
        Object.assign(
            {},
            options || {},
            {
                cause:
                    cause,

                expose:
                    false
            }
        );

    return new ServiceError(
        "internal",
        message ||
        DEFAULT_ERROR_MESSAGE,
        settings
    );
}

/* ==========================================================
   NORMALIZATION
========================================================== */

function normalizeServiceError(
    error,
    options
) {
    const settings =
        options || {};

    if (
        error instanceof
        ServiceError
    ) {
        return applyContextToError(
            error,
            settings
        );
    }

    const code =
        resolveErrorCode(
            error,
            settings
        );

    const definition =
        getErrorDefinition(
            code
        );

    const status =
        normalizeHttpStatus(
            settings.status ||
            error.status ||
            error.statusCode,
            definition.status
        );

    const expose =
        settings.expose !==
        undefined
            ? Boolean(
                  settings.expose
              )
            : status < 500;

    const publicMessage =
        settings.publicMessage ||
        (
            expose &&
            error.publicMessage
                ? error.publicMessage
                : null
        ) ||
        (
            expose &&
            error.message
                ? error.message
                : null
        ) ||
        definition.message;

    return new ServiceError(
        code,
        publicMessage,
        {
            status:
                status,

            internalMessage:
                error.message ||
                publicMessage,

            details:
                settings.details !==
                undefined
                    ? settings.details
                    : error.details,

            expose:
                expose,

            retryable:
                settings.retryable,

            cause:
                error,

            requestId:
                settings.requestId ||
                error.requestId,

            correlationId:
                settings.correlationId ||
                error.correlationId,

            timestamp:
                settings.timestamp
        }
    );
}

function resolveErrorCode(
    error,
    options
) {
    const settings =
        options || {};

    if (settings.code) {
        return normalizeErrorCode(
            settings.code
        );
    }

    const rawCode =
        error &&
        error.code
            ? String(
                  error.code
              )
            : "";

    if (
        rawCode &&
        FIREBASE_CODE_ALIASES[
            rawCode
        ]
    ) {
        return FIREBASE_CODE_ALIASES[
            rawCode
        ];
    }

    if (rawCode) {
        const normalized =
            normalizeErrorCode(
                rawCode
            );

        if (
            ERROR_DEFINITIONS[
                normalized
            ]
        ) {
            return normalized;
        }

        const finalSegment =
            normalized
                .split("/")
                .pop();

        if (
            ERROR_DEFINITIONS[
                finalSegment
            ]
        ) {
            return finalSegment;
        }
    }

    const status =
        Number(
            error &&
            (
                error.status ||
                error.statusCode
            )
        );

    if (
        Number.isInteger(status) &&
        HTTP_STATUS_TO_CODE[
            status
        ]
    ) {
        return HTTP_STATUS_TO_CODE[
            status
        ];
    }

    if (
        error &&
        error.name ===
            "AbortError"
    ) {
        return "deadline-exceeded";
    }

    return DEFAULT_ERROR_CODE;
}

function normalizeErrorCode(code) {
    if (
        code === undefined ||
        code === null
    ) {
        return DEFAULT_ERROR_CODE;
    }

    const normalized =
        String(code)
            .trim()
            .toLowerCase()
            .replace(
                /_/g,
                "-"
            )
            .replace(
                /\s+/g,
                "-"
            );

    return normalized ||
        DEFAULT_ERROR_CODE;
}

function normalizeHttpStatus(
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

    return fallback ||
        DEFAULT_HTTP_STATUS;
}

function getErrorDefinition(code) {
    return ERROR_DEFINITIONS[
        normalizeErrorCode(code)
    ] ||
    ERROR_DEFINITIONS.internal;
}

/* ==========================================================
   PUBLIC ERROR PAYLOADS
========================================================== */

function createPublicErrorPayload(
    error,
    options
) {
    const settings =
        options || {};

    const normalized =
        normalizeServiceError(
            error,
            settings
        );

    const message =
        normalized.expose
            ? normalized
                .publicMessage
            : getErrorDefinition(
                  normalized.code
              ).message;

    const payload = {
        code:
            normalized.code,

        message:
            message,

        retryable:
            normalized.retryable
    };

    if (
        normalized.details !==
            undefined &&
        normalized.details !==
            null &&
        (
            normalized.expose ||
            settings.includeDetails
        )
    ) {
        payload.details =
            cloneValue(
                normalized.details
            );
    }

    if (
        normalized.requestId
    ) {
        payload.requestId =
            normalized.requestId;
    }

    if (
        normalized.correlationId
    ) {
        payload.correlationId =
            normalized
                .correlationId;
    }

    return payload;
}

function createHttpErrorResponse(
    error,
    options
) {
    const settings =
        options || {};

    const normalized =
        normalizeServiceError(
            error,
            settings
        );

    return {
        status:
            normalized.status,

        body: {
            success:
                false,

            error:
                createPublicErrorPayload(
                    normalized,
                    settings
                )
        }
    };
}

/* ==========================================================
   CALLABLE ERROR SUPPORT
========================================================== */

function toCallableError(
    error,
    options
) {
    const settings =
        options || {};

    const normalized =
        normalizeServiceError(
            error,
            settings
        );

    const definition =
        getErrorDefinition(
            normalized.code
        );

    const callableCode =
        settings.callableCode ||
        definition.callableCode ||
        "internal";

    const message =
        normalized.expose
            ? normalized
                .publicMessage
            : definition.message;

    const details =
        createPublicErrorPayload(
            normalized,
            {
                includeDetails:
                    settings.includeDetails
            }
        );

    const HttpsError =
        settings.HttpsError ||
        loadHttpsError();

    if (HttpsError) {
        return new HttpsError(
            callableCode,
            message,
            details
        );
    }

    const callableError =
        new Error(message);

    callableError.name =
        "HttpsError";

    callableError.code =
        callableCode;

    callableError.details =
        details;

    callableError.httpErrorCode = {
        status:
            normalized.status,

        canonicalName:
            callableCode
    };

    return callableError;
}

function loadHttpsError() {
    try {
        const https =
            require(
                "firebase-functions/v2/https"
            );

        return https.HttpsError;
    } catch {
        try {
            const functions =
                require(
                    "firebase-functions"
                );

            return functions
                .https
                .HttpsError;
        } catch {
            return null;
        }
    }
}

/* ==========================================================
   RESPONSE WRITING
========================================================== */

function sendServiceError(
    response,
    error,
    options
) {
    const result =
        createHttpErrorResponse(
            error,
            options
        );

    if (!response) {
        return result;
    }

    if (
        typeof response.status ===
        "function"
    ) {
        response.status(
            result.status
        );
    } else {
        response.statusCode =
            result.status;
    }

    if (
        typeof response.json ===
        "function"
    ) {
        response.json(
            result.body
        );

        return response;
    }

    if (
        typeof response.send ===
        "function"
    ) {
        response.send(
            result.body
        );

        return response;
    }

    if (
        typeof response.end ===
        "function"
    ) {
        response.end(
            JSON.stringify(
                result.body
            )
        );

        return response;
    }

    return result;
}

/* ==========================================================
   CONTEXT
========================================================== */

function applyContextToError(
    error,
    context
) {
    if (
        !(error instanceof
            ServiceError)
    ) {
        return error;
    }

    const source =
        context || {};

    if (
        !error.requestId &&
        source.requestId
    ) {
        error.requestId =
            source.requestId;
    }

    if (
        !error.correlationId &&
        source.correlationId
    ) {
        error.correlationId =
            source.correlationId;
    }

    return error;
}

/* ==========================================================
   SAFETY
========================================================== */

function sanitizeErrorDetails(
    details,
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
        details === undefined ||
        details === null
    ) {
        return details;
    }

    if (
        typeof details ===
            "string" ||
        typeof details ===
            "number" ||
        typeof details ===
            "boolean"
    ) {
        return details;
    }

    if (
        details instanceof Date
    ) {
        return details
            .toISOString();
    }

    if (
        Buffer.isBuffer(
            details
        )
    ) {
        return (
            "[Buffer " +
            details.length +
            " bytes]"
        );
    }

    if (
        details instanceof Error
    ) {
        return {
            name:
                details.name,

            code:
                details.code,

            message:
                details.message
        };
    }

    if (
        typeof details !==
        "object"
    ) {
        return String(details);
    }

    if (
        currentState.depth >=
        (
            settings.maxDepth ||
            6
        )
    ) {
        return "[Maximum depth reached]";
    }

    if (
        currentState.seen.has(
            details
        )
    ) {
        return "[Circular]";
    }

    currentState.seen.add(
        details
    );

    const nextState = {
        depth:
            currentState.depth +
            1,

        seen:
            currentState.seen
    };

    if (
        Array.isArray(
            details
        )
    ) {
        return details.map(
            function (value) {
                return sanitizeErrorDetails(
                    value,
                    settings,
                    nextState
                );
            }
        );
    }

    return Object.keys(details)
        .reduce(
            function (
                output,
                key
            ) {
                if (
                    isSensitiveKey(
                        key
                    )
                ) {
                    output[key] =
                        "[REDACTED]";

                    return output;
                }

                output[key] =
                    sanitizeErrorDetails(
                        details[key],
                        settings,
                        nextState
                    );

                return output;
            },
            {}
        );
}

function isSensitiveKey(key) {
    const normalized =
        String(key)
            .toLowerCase()
            .replace(
                /[^a-z0-9]/g,
                ""
            );

    return [
        "authorization",
        "authorizationcode",
        "apikey",
        "password",
        "secret",
        "secretkey",
        "token",
        "idtoken",
        "refreshtoken",
        "accesstoken",
        "cvv",
        "cvc",
        "pin",
        "cardnumber",
        "signature",
        "webhooksecret"
    ].includes(
        normalized
    );
}

/* ==========================================================
   RETRYABILITY
========================================================== */

function isRetryableCode(code) {
    return [
        "aborted",
        "deadline-exceeded",
        "resource-exhausted",
        "too-many-requests",
        "unavailable",
        "provider-error"
    ].includes(
        normalizeErrorCode(
            code
        )
    );
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

    if (
        value instanceof Date
    ) {
        return new Date(
            value.getTime()
        );
    }

    if (
        Buffer.isBuffer(value)
    ) {
        return Buffer.from(value);
    }

    if (
        Array.isArray(value)
    ) {
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

function normalizeTimestamp(
    value
) {
    if (
        value instanceof Date
    ) {
        return value.toISOString();
    }

    if (
        typeof value ===
        "number"
    ) {
        return new Date(
            value
        ).toISOString();
    }

    if (
        typeof value ===
            "string" &&
        !Number.isNaN(
            Date.parse(value)
        )
    ) {
        return new Date(
            value
        ).toISOString();
    }

    return new Date()
        .toISOString();
}

/* ==========================================================
   TYPE GUARDS
========================================================== */

function isServiceError(error) {
    return (
        error instanceof
        ServiceError
    );
}

function hasErrorCode(
    error,
    code
) {
    if (!error) {
        return false;
    }

    return (
        normalizeErrorCode(
            error.code
        ) ===
        normalizeErrorCode(
            code
        )
    );
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    ServiceError,
    createServiceError,
    normalizeServiceError,
    resolveErrorCode,
    normalizeErrorCode,
    normalizeHttpStatus,
    getErrorDefinition,
    createPublicErrorPayload,
    createHttpErrorResponse,
    toCallableError,
    sendServiceError,
    applyContextToError,
    sanitizeErrorDetails,
    isSensitiveKey,
    isRetryableCode,
    isServiceError,
    hasErrorCode,
    invalidArgument,
    unauthenticated,
    permissionDenied,
    notFound,
    alreadyExists,
    failedPrecondition,
    conflict,
    paymentFailed,
    inventoryUnavailable,
    internalError,
    constants: {
        DEFAULT_ERROR_CODE,
        DEFAULT_ERROR_MESSAGE,
        DEFAULT_HTTP_STATUS,
        ERROR_DEFINITIONS,
        HTTP_STATUS_TO_CODE,
        FIREBASE_CODE_ALIASES
    }
};