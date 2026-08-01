"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   RATE LIMIT SERVICE

   Responsibilities:
   - Apply Firestore-backed rate limits
   - Support fixed-window request counting
   - Resolve user, IP, and custom identities
   - Expose HTTP and callable guards
   - Return consistent retry metadata
========================================================== */

const crypto =
    require("node:crypto");

const {
    getRuntime
} = require(
    "./runtime"
);

const {
    ServiceError
} = require(
    "./service-error"
);

/* ==========================================================
   CONSTANTS
========================================================== */

const RATE_LIMIT_COLLECTION =
    "_rateLimits";

const DEFAULT_LIMIT =
    60;

const DEFAULT_WINDOW_MS =
    60 * 1000;

const DEFAULT_KEY_PREFIX =
    "global";

const DEFAULT_MAX_KEY_LENGTH =
    500;

const RATE_LIMIT_CODE =
    "too-many-requests";

/* ==========================================================
   SERVICE FACTORY
========================================================== */

function createRateLimitService(
    options
) {
    const settings =
        normalizeRateLimitOptions(
            options
        );

    const runtime =
        settings.runtime ||
        getRuntime();

    return Object.freeze({
        runtime:
            runtime,

        options:
            settings,

        consume:
            function (
                input,
                overrides
            ) {
                return consumeRateLimit(
                    runtime,
                    input,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        peek:
            function (
                input,
                overrides
            ) {
                return inspectRateLimit(
                    runtime,
                    input,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        reset:
            function (
                input,
                overrides
            ) {
                return resetRateLimit(
                    runtime,
                    input,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        enforce:
            function (
                input,
                overrides
            ) {
                return enforceRateLimit(
                    runtime,
                    input,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            }
    });
}

/* ==========================================================
   CONSUMPTION
========================================================== */

async function consumeRateLimit(
    runtime,
    input,
    options
) {
    const settings =
        normalizeRateLimitOptions(
            options
        );

    const now =
        resolveNow(
            runtime,
            settings
        );

    const identity =
        resolveRateLimitIdentity(
            input,
            settings
        );

    const descriptor =
        createRateLimitDescriptor(
            identity,
            now,
            settings
        );

    if (
        settings.disabled
    ) {
        return createRateLimitResult(
            descriptor,
            {
                count:
                    0,

                allowed:
                    true,

                disabled:
                    true
            }
        );
    }

    assertRateLimitRuntime(
        runtime
    );

    const reference =
        runtime.db
            .collection(
                settings.collection
            )
            .doc(
                descriptor.documentId
            );

    const transactionResult =
        await runtime.db
            .runTransaction(
                async function (
                    transaction
                ) {
                    const snapshot =
                        await transaction.get(
                            reference
                        );

                    const existing =
                        snapshot.exists
                            ? snapshot.data()
                            : null;

                    const active =
                        existing &&
                        Number(
                            existing.windowStart
                        ) ===
                        descriptor.windowStart &&
                        Number(
                            existing.windowEnd
                        ) ===
                        descriptor.windowEnd;

                    const previousCount =
                        active
                            ? normalizeCount(
                                  existing.count
                              )
                            : 0;

                    const nextCount =
                        previousCount +
                        settings.cost;

                    const allowed =
                        nextCount <=
                        settings.limit;

                    const storedCount =
                        allowed ||
                        settings.countRejected
                            ? nextCount
                            : previousCount;

                    const document = {
                        key:
                            descriptor.key,

                        keyHash:
                            descriptor.keyHash,

                        prefix:
                            descriptor.prefix,

                        identity:
                            descriptor.identity,

                        windowStart:
                            descriptor.windowStart,

                        windowEnd:
                            descriptor.windowEnd,

                        count:
                            storedCount,

                        limit:
                            settings.limit,

                        updatedAt:
                            createDatabaseTimestamp(
                                runtime,
                                now
                            ),

                        expiresAt:
                            createDatabaseTimestamp(
                                runtime,
                                descriptor.windowEnd +
                                settings.retentionMs
                            )
                    };

                    if (!active) {
                        document.createdAt =
                            createDatabaseTimestamp(
                                runtime,
                                now
                            );
                    }

                    transaction.set(
                        reference,
                        document,
                        {
                            merge:
                                true
                        }
                    );

                    return {
                        count:
                            storedCount,

                        attemptedCount:
                            nextCount,

                        allowed:
                            allowed
                    };
                }
            );

    const result =
        createRateLimitResult(
            descriptor,
            {
                count:
                    transactionResult
                        .count,

                attemptedCount:
                    transactionResult
                        .attemptedCount,

                allowed:
                    transactionResult
                        .allowed,

                disabled:
                    false
            }
        );

    logRateLimitResult(
        runtime,
        result,
        settings
    );

    return result;
}

/* ==========================================================
   INSPECTION
========================================================== */

async function inspectRateLimit(
    runtime,
    input,
    options
) {
    const settings =
        normalizeRateLimitOptions(
            options
        );

    const now =
        resolveNow(
            runtime,
            settings
        );

    const identity =
        resolveRateLimitIdentity(
            input,
            settings
        );

    const descriptor =
        createRateLimitDescriptor(
            identity,
            now,
            settings
        );

    if (
        settings.disabled
    ) {
        return createRateLimitResult(
            descriptor,
            {
                count:
                    0,

                allowed:
                    true,

                disabled:
                    true
            }
        );
    }

    assertRateLimitRuntime(
        runtime
    );

    const snapshot =
        await runtime.db
            .collection(
                settings.collection
            )
            .doc(
                descriptor.documentId
            )
            .get();

    if (!snapshot.exists) {
        return createRateLimitResult(
            descriptor,
            {
                count:
                    0,

                allowed:
                    true,

                disabled:
                    false
            }
        );
    }

    const data =
        snapshot.data();

    const active =
        Number(
            data.windowStart
        ) ===
        descriptor.windowStart &&
        Number(
            data.windowEnd
        ) ===
        descriptor.windowEnd;

    const count =
        active
            ? normalizeCount(
                  data.count
              )
            : 0;

    return createRateLimitResult(
        descriptor,
        {
            count:
                count,

            allowed:
                count +
                settings.cost <=
                settings.limit,

            disabled:
                false
        }
    );
}

/* ==========================================================
   RESET
========================================================== */

async function resetRateLimit(
    runtime,
    input,
    options
) {
    const settings =
        normalizeRateLimitOptions(
            options
        );

    const now =
        resolveNow(
            runtime,
            settings
        );

    const identity =
        resolveRateLimitIdentity(
            input,
            settings
        );

    const descriptor =
        createRateLimitDescriptor(
            identity,
            now,
            settings
        );

    if (
        settings.disabled
    ) {
        return {
            reset:
                false,

            disabled:
                true,

            key:
                descriptor.key
        };
    }

    assertRateLimitRuntime(
        runtime
    );

    await runtime.db
        .collection(
            settings.collection
        )
        .doc(
            descriptor.documentId
        )
        .delete();

    return {
        reset:
            true,

        disabled:
            false,

        key:
            descriptor.key,

        documentId:
            descriptor.documentId
    };
}

/* ==========================================================
   ENFORCEMENT
========================================================== */

async function enforceRateLimit(
    runtime,
    input,
    options
) {
    const result =
        await consumeRateLimit(
            runtime,
            input,
            options
        );

    if (!result.allowed) {
        throw createRateLimitError(
            result,
            options
        );
    }

    return result;
}

function createRateLimitError(
    result,
    options
) {
    const settings =
        options || {};

    return new ServiceError(
        RATE_LIMIT_CODE,
        settings.message ||
        "Too many requests were received. Please try again later.",
        {
            status:
                429,

            expose:
                true,

            retryable:
                true,

            details: {
                limit:
                    result.limit,

                remaining:
                    result.remaining,

                retryAfterMs:
                    result.retryAfterMs,

                retryAfterSeconds:
                    result.retryAfterSeconds,

                resetAt:
                    result.resetAt,

                key:
                    settings.exposeKey
                        ? result.key
                        : undefined
            },

            requestId:
                settings.requestId,

            correlationId:
                settings.correlationId
        }
    );
}

/* ==========================================================
   HTTP GUARD
========================================================== */

function createRateLimitMiddleware(
    options
) {
    const settings =
        normalizeRateLimitOptions(
            options
        );

    const service =
        settings.service ||
        createRateLimitService(
            settings
        );

    return async function rateLimitMiddleware(
        request,
        response,
        next
    ) {
        try {
            const context =
                request &&
                (
                    request.requestContext ||
                    request.context
                );

            const result =
                await service.enforce(
                    request,
                    {
                        requestId:
                            context &&
                            context.requestId,

                        correlationId:
                            context &&
                            context.correlationId
                    }
                );

            attachRateLimitHeaders(
                response,
                result
            );

            if (request) {
                request.rateLimit =
                    result;
            }

            if (
                typeof next ===
                "function"
            ) {
                next();
            }

            return result;
        } catch (error) {
            if (
                error &&
                error.code ===
                    RATE_LIMIT_CODE
            ) {
                attachRateLimitHeaders(
                    response,
                    createResultFromError(
                        error
                    )
                );
            }

            if (
                typeof next ===
                "function"
            ) {
                next(error);

                return undefined;
            }

            throw error;
        }
    };
}

/* ==========================================================
   CALLABLE GUARD
========================================================== */

function createCallableRateLimitGuard(
    options
) {
    const settings =
        normalizeRateLimitOptions(
            options
        );

    const service =
        settings.service ||
        createRateLimitService(
            settings
        );

    return async function callableRateLimitGuard(
        request,
        context
    ) {
        return service.enforce(
            {
                auth:
                    request &&
                    request.auth,

                rawRequest:
                    request &&
                    request.rawRequest,

                context:
                    context
            },
            {
                requestId:
                    context &&
                    context.requestId,

                correlationId:
                    context &&
                    context.correlationId
            }
        );
    };
}

/* ==========================================================
   IDENTITY
========================================================== */

function resolveRateLimitIdentity(
    input,
    options
) {
    const settings =
        options || {};

    if (
        typeof settings.keyResolver ===
        "function"
    ) {
        const custom =
            settings.keyResolver(
                input
            );

        return normalizeIdentityKey(
            custom
        );
    }

    if (
        typeof settings.key ===
        "string" &&
        settings.key.trim()
    ) {
        return normalizeIdentityKey(
            settings.key
        );
    }

    const userId =
        resolveUserId(
            input
        );

    if (userId) {
        return "user:" +
            userId;
    }

    const ip =
        resolveIpAddress(
            input,
            settings
        );

    if (ip) {
        return "ip:" +
            ip;
    }

    if (
        settings.allowAnonymousKey
    ) {
        return "anonymous";
    }

    throw new ServiceError(
        "invalid-argument",
        "A rate-limit identity could not be resolved.",
        {
            status:
                400,

            expose:
                true
        }
    );
}

function resolveUserId(
    input
) {
    if (!input) {
        return "";
    }

    if (
        input.userId
    ) {
        return String(
            input.userId
        );
    }

    if (
        input.context &&
        input.context.userId
    ) {
        return String(
            input.context.userId
        );
    }

    if (
        input.requestContext &&
        input.requestContext.userId
    ) {
        return String(
            input.requestContext
                .userId
        );
    }

    if (
        input.auth &&
        input.auth.uid
    ) {
        return String(
            input.auth.uid
        );
    }

    if (
        input.user &&
        input.user.uid
    ) {
        return String(
            input.user.uid
        );
    }

    return "";
}

function resolveIpAddress(
    input,
    options
) {
    const settings =
        options || {};

    const request =
        input &&
        input.rawRequest
            ? input.rawRequest
            : input;

    if (!request) {
        return "";
    }

    if (
        settings.trustProxy
    ) {
        const headers =
            request.headers ||
            {};

        const forwarded =
            headers[
                "x-forwarded-for"
            ] ||
            headers[
                "X-Forwarded-For"
            ];

        if (forwarded) {
            return String(
                forwarded
            )
                .split(",")[0]
                .trim();
        }

        if (
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

    return String(
        request.ip ||
        (
            request.socket &&
            request.socket
                .remoteAddress
        ) ||
        (
            request.connection &&
            request.connection
                .remoteAddress
        ) ||
        ""
    );
}

function normalizeIdentityKey(
    value
) {
    const normalized =
        String(
            value || ""
        ).trim();

    if (!normalized) {
        throw new ServiceError(
            "invalid-argument",
            "The rate-limit key is invalid.",
            {
                status:
                    400,

                expose:
                    true
            }
        );
    }

    if (
        normalized.length >
        DEFAULT_MAX_KEY_LENGTH
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The rate-limit key is too long.",
            {
                status:
                    400,

                expose:
                    true
            }
        );
    }

    return normalized;
}

/* ==========================================================
   DESCRIPTOR
========================================================== */

function createRateLimitDescriptor(
    identity,
    now,
    options
) {
    const settings =
        normalizeRateLimitOptions(
            options
        );

    const prefix =
        normalizePrefix(
            settings.prefix
        );

    const windowStart =
        Math.floor(
            now /
            settings.windowMs
        ) *
        settings.windowMs;

    const windowEnd =
        windowStart +
        settings.windowMs;

    const key =
        prefix +
        ":" +
        identity;

    const keyHash =
        hashRateLimitKey(
            key
        );

    return {
        identity:
            identity,

        prefix:
            prefix,

        key:
            key,

        keyHash:
            keyHash,

        documentId:
            keyHash +
            "_" +
            windowStart,

        windowStart:
            windowStart,

        windowEnd:
            windowEnd,

        limit:
            settings.limit,

        cost:
            settings.cost
    };
}

function hashRateLimitKey(
    value
) {
    return crypto
        .createHash(
            "sha256"
        )
        .update(
            String(value)
        )
        .digest(
            "hex"
        );
}

/* ==========================================================
   RESULT
========================================================== */

function createRateLimitResult(
    descriptor,
    values
) {
    const source =
        values || {};

    const count =
        normalizeCount(
            source.count
        );

    const remaining =
        Math.max(
            0,
            descriptor.limit -
            count
        );

    const now =
        source.now !==
        undefined
            ? Number(source.now)
            : Date.now();

    const retryAfterMs =
        Math.max(
            0,
            descriptor.windowEnd -
            now
        );

    return {
        allowed:
            Boolean(
                source.allowed
            ),

        disabled:
            Boolean(
                source.disabled
            ),

        key:
            descriptor.key,

        keyHash:
            descriptor.keyHash,

        documentId:
            descriptor.documentId,

        identity:
            descriptor.identity,

        prefix:
            descriptor.prefix,

        limit:
            descriptor.limit,

        cost:
            descriptor.cost,

        count:
            count,

        attemptedCount:
            source.attemptedCount !==
                undefined
                ? normalizeCount(
                      source.attemptedCount
                  )
                : count,

        remaining:
            remaining,

        windowStart:
            descriptor.windowStart,

        windowEnd:
            descriptor.windowEnd,

        resetAt:
            new Date(
                descriptor.windowEnd
            ).toISOString(),

        retryAfterMs:
            retryAfterMs,

        retryAfterSeconds:
            Math.max(
                0,
                Math.ceil(
                    retryAfterMs /
                    1000
                )
            )
    };
}

function createResultFromError(
    error
) {
    const details =
        error &&
        error.details
            ? error.details
            : {};

    return {
        limit:
            details.limit,

        remaining:
            details.remaining,

        retryAfterMs:
            details.retryAfterMs,

        retryAfterSeconds:
            details.retryAfterSeconds,

        resetAt:
            details.resetAt
    };
}

/* ==========================================================
   RESPONSE HEADERS
========================================================== */

function attachRateLimitHeaders(
    response,
    result
) {
    if (
        !response ||
        !result
    ) {
        return response;
    }

    setHeader(
        response,
        "RateLimit-Limit",
        result.limit
    );

    setHeader(
        response,
        "RateLimit-Remaining",
        result.remaining
    );

    setHeader(
        response,
        "RateLimit-Reset",
        result.retryAfterSeconds
    );

    setHeader(
        response,
        "X-RateLimit-Limit",
        result.limit
    );

    setHeader(
        response,
        "X-RateLimit-Remaining",
        result.remaining
    );

    setHeader(
        response,
        "X-RateLimit-Reset",
        result.windowEnd
    );

    if (
        result.allowed ===
        false
    ) {
        setHeader(
            response,
            "Retry-After",
            result.retryAfterSeconds
        );
    }

    return response;
}

function setHeader(
    response,
    name,
    value
) {
    if (
        value === undefined ||
        value === null
    ) {
        return;
    }

    if (
        typeof response.set ===
        "function"
    ) {
        response.set(
            name,
            String(value)
        );

        return;
    }

    if (
        typeof response.setHeader ===
        "function"
    ) {
        response.setHeader(
            name,
            String(value)
        );
    }
}

/* ==========================================================
   OPTIONS
========================================================== */

function normalizeRateLimitOptions(
    options
) {
    const settings =
        options || {};

    return {
        runtime:
            settings.runtime,

        service:
            settings.service,

        collection:
            normalizeCollection(
                settings.collection ||
                RATE_LIMIT_COLLECTION
            ),

        prefix:
            settings.prefix ||
            DEFAULT_KEY_PREFIX,

        key:
            settings.key,

        keyResolver:
            settings.keyResolver,

        limit:
            normalizePositiveInteger(
                settings.limit,
                DEFAULT_LIMIT,
                "Rate-limit limit"
            ),

        cost:
            normalizePositiveInteger(
                settings.cost,
                1,
                "Rate-limit cost"
            ),

        windowMs:
            normalizePositiveInteger(
                settings.windowMs,
                DEFAULT_WINDOW_MS,
                "Rate-limit window"
            ),

        retentionMs:
            normalizeNonNegativeInteger(
                settings.retentionMs,
                DEFAULT_WINDOW_MS
            ),

        countRejected:
            settings.countRejected !==
            false,

        trustProxy:
            Boolean(
                settings.trustProxy
            ),

        allowAnonymousKey:
            settings.allowAnonymousKey !==
            false,

        exposeKey:
            Boolean(
                settings.exposeKey
            ),

        disabled:
            Boolean(
                settings.disabled
            ),

        message:
            settings.message,

        requestId:
            settings.requestId,

        correlationId:
            settings.correlationId
    };
}

function normalizeCollection(
    value
) {
    const collection =
        String(
            value || ""
        ).trim();

    if (
        !collection ||
        collection.includes("/")
    ) {
        throw new TypeError(
            "Rate-limit collection must be a Firestore collection name."
        );
    }

    return collection;
}

function normalizePrefix(
    value
) {
    const prefix =
        String(
            value ||
            DEFAULT_KEY_PREFIX
        )
            .trim()
            .toLowerCase()
            .replace(
                /[^a-z0-9._:-]/g,
                "-"
            );

    return prefix ||
        DEFAULT_KEY_PREFIX;
}

function normalizePositiveInteger(
    value,
    fallback,
    label
) {
    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {
        return fallback;
    }

    const normalized =
        Number(value);

    if (
        !Number.isInteger(
            normalized
        ) ||
        normalized <= 0
    ) {
        throw new TypeError(
            label +
            " must be a positive integer."
        );
    }

    return normalized;
}

function normalizeNonNegativeInteger(
    value,
    fallback
) {
    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {
        return fallback;
    }

    const normalized =
        Number(value);

    if (
        !Number.isInteger(
            normalized
        ) ||
        normalized < 0
    ) {
        throw new TypeError(
            "Rate-limit retention must be a non-negative integer."
        );
    }

    return normalized;
}

function normalizeCount(
    value
) {
    const count =
        Number(value);

    if (
        !Number.isFinite(
            count
        ) ||
        count < 0
    ) {
        return 0;
    }

    return Math.floor(
        count
    );
}

/* ==========================================================
   RUNTIME HELPERS
========================================================== */

function assertRateLimitRuntime(
    runtime
) {
    if (
        !runtime ||
        !runtime.db ||
        typeof runtime.db
            .collection !==
            "function"
    ) {
        throw new ServiceError(
            "configuration-error",
            "The rate-limit datastore is unavailable.",
            {
                status:
                    500,

                expose:
                    false
            }
        );
    }

    if (
        typeof runtime.db
            .runTransaction !==
            "function"
    ) {
        throw new ServiceError(
            "configuration-error",
            "Firestore transactions are required for rate limiting.",
            {
                status:
                    500,

                expose:
                    false
            }
        );
    }
}

function resolveNow(
    runtime,
    options
) {
    const settings =
        options || {};

    if (
        typeof settings.now ===
        "function"
    ) {
        return Number(
            settings.now()
        );
    }

    if (
        runtime &&
        typeof runtime.now ===
            "function"
    ) {
        return Number(
            runtime.now()
        );
    }

    return Date.now();
}

function createDatabaseTimestamp(
    runtime,
    milliseconds
) {
    if (
        runtime &&
        runtime.Timestamp &&
        typeof runtime.Timestamp
            .fromMillis ===
            "function"
    ) {
        return runtime.Timestamp
            .fromMillis(
                milliseconds
            );
    }

    return new Date(
        milliseconds
    );
}

/* ==========================================================
   LOGGING
========================================================== */

function logRateLimitResult(
    runtime,
    result,
    options
) {
    const settings =
        options || {};

    if (
        settings.log ===
        false ||
        !runtime ||
        !runtime.logger
    ) {
        return;
    }

    const logger =
        runtime.logger;

    const metadata = {
        prefix:
            result.prefix,

        identity:
            result.identity,

        allowed:
            result.allowed,

        count:
            result.count,

        limit:
            result.limit,

        remaining:
            result.remaining,

        resetAt:
            result.resetAt
    };

    if (
        result.allowed
    ) {
        if (
            typeof logger.debug ===
            "function"
        ) {
            logger.debug(
                "Rate limit consumed.",
                metadata
            );
        }

        return;
    }

    if (
        typeof logger.warn ===
        "function"
    ) {
        logger.warn(
            "Rate limit exceeded.",
            metadata
        );
    }
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    createRateLimitService,
    consumeRateLimit,
    inspectRateLimit,
    resetRateLimit,
    enforceRateLimit,
    createRateLimitError,
    createRateLimitMiddleware,
    createCallableRateLimitGuard,
    resolveRateLimitIdentity,
    resolveUserId,
    resolveIpAddress,
    normalizeIdentityKey,
    createRateLimitDescriptor,
    hashRateLimitKey,
    createRateLimitResult,
    createResultFromError,
    attachRateLimitHeaders,
    normalizeRateLimitOptions,
    normalizeCollection,
    normalizePrefix,
    normalizePositiveInteger,
    normalizeNonNegativeInteger,
    normalizeCount,
    assertRateLimitRuntime,
    resolveNow,
    createDatabaseTimestamp,
    logRateLimitResult,
    constants: {
        RATE_LIMIT_COLLECTION,
        DEFAULT_LIMIT,
        DEFAULT_WINDOW_MS,
        DEFAULT_KEY_PREFIX,
        DEFAULT_MAX_KEY_LENGTH,
        RATE_LIMIT_CODE
    }
};