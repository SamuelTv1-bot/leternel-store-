"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   CACHE SERVICE

   Responsibilities:
   - Provide Firestore-backed application caching
   - Support read-through cache operations
   - Enforce cache expiration
   - Generate deterministic cache keys
   - Serialize safe cache values
   - Support cache invalidation and namespaces
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

const CACHE_COLLECTION =
    "_cache";

const DEFAULT_NAMESPACE =
    "global";

const DEFAULT_TTL_MS =
    5 * 60 * 1000;

const DEFAULT_STALE_TTL_MS =
    0;

const DEFAULT_MAX_VALUE_BYTES =
    500000;

const DEFAULT_MAX_KEY_LENGTH =
    500;

const CACHE_STATUSES =
    Object.freeze({
        hit:
            "hit",

        miss:
            "miss",

        stale:
            "stale",

        disabled:
            "disabled"
    });

/* ==========================================================
   SERVICE FACTORY
========================================================== */

function createCacheService(
    options
) {
    const settings =
        normalizeCacheOptions(
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

        get:
            function (
                key,
                overrides
            ) {
                return getCachedValue(
                    runtime,
                    key,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        set:
            function (
                key,
                value,
                overrides
            ) {
                return setCachedValue(
                    runtime,
                    key,
                    value,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        delete:
            function (
                key,
                overrides
            ) {
                return deleteCachedValue(
                    runtime,
                    key,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        remember:
            function (
                key,
                loader,
                overrides
            ) {
                return rememberCachedValue(
                    runtime,
                    key,
                    loader,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        inspect:
            function (
                key,
                overrides
            ) {
                return inspectCachedValue(
                    runtime,
                    key,
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
   GET
========================================================== */

async function getCachedValue(
    runtime,
    key,
    options
) {
    const settings =
        normalizeCacheOptions(
            options
        );

    const descriptor =
        createCacheDescriptor(
            key,
            settings.namespace
        );

    if (
        settings.disabled
    ) {
        return createCacheResult(
            descriptor,
            {
                status:
                    CACHE_STATUSES
                        .disabled,

                hit:
                    false,

                value:
                    undefined
            }
        );
    }

    assertCacheRuntime(
        runtime
    );

    const now =
        resolveNow(
            runtime,
            settings
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
        const result =
            createCacheResult(
                descriptor,
                {
                    status:
                        CACHE_STATUSES
                            .miss,

                    hit:
                        false,

                    value:
                        undefined
                }
            );

        logCacheEvent(
            runtime,
            result,
            settings
        );

        return result;
    }

    const record =
        snapshot.data() ||
        {};

    const expiresAt =
        toMilliseconds(
            record.expiresAt
        );

    const staleUntil =
        toMilliseconds(
            record.staleUntil
        );

    if (
        expiresAt &&
        now < expiresAt
    ) {
        const result =
            createCacheResult(
                descriptor,
                {
                    status:
                        CACHE_STATUSES
                            .hit,

                    hit:
                        true,

                    stale:
                        false,

                    value:
                        cloneValue(
                            record.value
                        ),

                    createdAt:
                        record.createdAt,

                    updatedAt:
                        record.updatedAt,

                    expiresAt:
                        record.expiresAt,

                    staleUntil:
                        record.staleUntil,

                    metadata:
                        record.metadata
                }
            );

        logCacheEvent(
            runtime,
            result,
            settings
        );

        return result;
    }

    if (
        settings.allowStale &&
        staleUntil &&
        now < staleUntil
    ) {
        const result =
            createCacheResult(
                descriptor,
                {
                    status:
                        CACHE_STATUSES
                            .stale,

                    hit:
                        true,

                    stale:
                        true,

                    value:
                        cloneValue(
                            record.value
                        ),

                    createdAt:
                        record.createdAt,

                    updatedAt:
                        record.updatedAt,

                    expiresAt:
                        record.expiresAt,

                    staleUntil:
                        record.staleUntil,

                    metadata:
                        record.metadata
                }
            );

        logCacheEvent(
            runtime,
            result,
            settings
        );

        return result;
    }

    if (
        settings.deleteExpired
    ) {
        await runtime.db
            .collection(
                settings.collection
            )
            .doc(
                descriptor.documentId
            )
            .delete();
    }

    const result =
        createCacheResult(
            descriptor,
            {
                status:
                    CACHE_STATUSES
                        .miss,

                hit:
                    false,

                expired:
                    true,

                value:
                    undefined
            }
        );

    logCacheEvent(
        runtime,
        result,
        settings
    );

    return result;
}

/* ==========================================================
   SET
========================================================== */

async function setCachedValue(
    runtime,
    key,
    value,
    options
) {
    const settings =
        normalizeCacheOptions(
            options
        );

    const descriptor =
        createCacheDescriptor(
            key,
            settings.namespace
        );

    if (
        settings.disabled
    ) {
        return createCacheResult(
            descriptor,
            {
                status:
                    CACHE_STATUSES
                        .disabled,

                hit:
                    false,

                disabled:
                    true,

                value:
                    cloneValue(value)
            }
        );
    }

    assertCacheRuntime(
        runtime
    );

    assertSerializableCacheValue(
        value,
        settings
    );

    const now =
        resolveNow(
            runtime,
            settings
        );

    const expiresAt =
        now +
        settings.ttlMs;

    const staleUntil =
        expiresAt +
        settings.staleTtlMs;

    const reference =
        runtime.db
            .collection(
                settings.collection
            )
            .doc(
                descriptor.documentId
            );

    const record = {
        key:
            descriptor.key,

        keyHash:
            descriptor.keyHash,

        namespace:
            descriptor.namespace,

        compositeKey:
            descriptor.compositeKey,

        value:
            cloneValue(value),

        metadata:
            sanitizeMetadata(
                settings.metadata
            ),

        createdAt:
            createDatabaseTimestamp(
                runtime,
                now
            ),

        updatedAt:
            createDatabaseTimestamp(
                runtime,
                now
            ),

        expiresAt:
            createDatabaseTimestamp(
                runtime,
                expiresAt
            ),

        staleUntil:
            createDatabaseTimestamp(
                runtime,
                staleUntil
            )
    };

    await reference.set(
        record,
        {
            merge:
                false
        }
    );

    const result =
        createCacheResult(
            descriptor,
            {
                status:
                    CACHE_STATUSES
                        .hit,

                hit:
                    true,

                stale:
                    false,

                value:
                    cloneValue(value),

                createdAt:
                    record.createdAt,

                updatedAt:
                    record.updatedAt,

                expiresAt:
                    record.expiresAt,

                staleUntil:
                    record.staleUntil,

                metadata:
                    record.metadata
            }
        );

    logCacheEvent(
        runtime,
        Object.assign(
            {},
            result,
            {
                operation:
                    "set"
            }
        ),
        settings
    );

    return result;
}

/* ==========================================================
   DELETE
========================================================== */

async function deleteCachedValue(
    runtime,
    key,
    options
) {
    const settings =
        normalizeCacheOptions(
            options
        );

    const descriptor =
        createCacheDescriptor(
            key,
            settings.namespace
        );

    if (
        settings.disabled
    ) {
        return {
            deleted:
                false,

            disabled:
                true,

            key:
                descriptor.key,

            namespace:
                descriptor.namespace
        };
    }

    assertCacheRuntime(
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

    const result = {
        deleted:
            true,

        disabled:
            false,

        key:
            descriptor.key,

        namespace:
            descriptor.namespace,

        documentId:
            descriptor.documentId
    };

    logCacheEvent(
        runtime,
        {
            operation:
                "delete",

            status:
                "deleted",

            key:
                descriptor.key,

            namespace:
                descriptor.namespace,

            hit:
                false
        },
        settings
    );

    return result;
}

/* ==========================================================
   INSPECTION
========================================================== */

async function inspectCachedValue(
    runtime,
    key,
    options
) {
    const settings =
        normalizeCacheOptions(
            options
        );

    const descriptor =
        createCacheDescriptor(
            key,
            settings.namespace
        );

    if (
        settings.disabled
    ) {
        return null;
    }

    assertCacheRuntime(
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
        return null;
    }

    return sanitizeCacheRecord(
        snapshot.data()
    );
}

/* ==========================================================
   READ-THROUGH CACHE
========================================================== */

async function rememberCachedValue(
    runtime,
    key,
    loader,
    options
) {
    if (
        typeof loader !==
        "function"
    ) {
        throw new TypeError(
            "Cache loader must be a function."
        );
    }

    const settings =
        normalizeCacheOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return {
            status:
                CACHE_STATUSES
                    .disabled,

            hit:
                false,

            stale:
                false,

            disabled:
                true,

            value:
                await loader({
                    key:
                        normalizeCacheKey(
                            key
                        ),

                    namespace:
                        settings.namespace
                })
        };
    }

    const cached =
        await getCachedValue(
            runtime,
            key,
            settings
        );

    if (
        cached.hit &&
        !cached.stale
    ) {
        return cached;
    }

    if (
        cached.hit &&
        cached.stale &&
        settings.refreshStale ===
            false
    ) {
        return cached;
    }

    try {
        const value =
            await loader({
                key:
                    cached.key,

                namespace:
                    cached.namespace,

                stale:
                    cached.stale,

                staleValue:
                    cached.stale
                        ? cloneValue(
                              cached.value
                          )
                        : undefined
            });

        return setCachedValue(
            runtime,
            key,
            value,
            settings
        );
    } catch (error) {
        if (
            cached.hit &&
            cached.stale &&
            settings.useStaleOnError
        ) {
            logCacheLoadFailure(
                runtime,
                error,
                cached,
                settings
            );

            return Object.assign(
                {},
                cached,
                {
                    fallback:
                        true,

                    loaderError:
                        serializeCacheError(
                            error
                        )
                }
            );
        }

        throw error;
    }
}

/* ==========================================================
   DESCRIPTOR
========================================================== */

function createCacheDescriptor(
    key,
    namespace
) {
    const normalizedKey =
        normalizeCacheKey(
            key
        );

    const normalizedNamespace =
        normalizeNamespace(
            namespace
        );

    const compositeKey =
        normalizedNamespace +
        ":" +
        normalizedKey;

    const keyHash =
        hashCacheKey(
            compositeKey
        );

    return {
        key:
            normalizedKey,

        namespace:
            normalizedNamespace,

        compositeKey:
            compositeKey,

        keyHash:
            keyHash,

        documentId:
            keyHash
    };
}

function normalizeCacheKey(
    value
) {
    if (
        value &&
        typeof value ===
            "object"
    ) {
        value =
            stableStringify(
                value
            );
    }

    const normalized =
        String(
            value || ""
        ).trim();

    if (!normalized) {
        throw new ServiceError(
            "invalid-argument",
            "The cache key is invalid.",
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
            "The cache key is too long.",
            {
                status:
                    400,

                expose:
                    true,

                details: {
                    maximumLength:
                        DEFAULT_MAX_KEY_LENGTH
                }
            }
        );
    }

    return normalized;
}

function normalizeNamespace(
    value
) {
    const normalized =
        String(
            value ||
            DEFAULT_NAMESPACE
        )
            .trim()
            .toLowerCase()
            .replace(
                /[^a-z0-9._:-]/g,
                "-"
            );

    return normalized ||
        DEFAULT_NAMESPACE;
}

function hashCacheKey(
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

function createCacheResult(
    descriptor,
    values
) {
    const source =
        values || {};

    return {
        status:
            source.status ||
            CACHE_STATUSES.miss,

        hit:
            Boolean(
                source.hit
            ),

        stale:
            Boolean(
                source.stale
            ),

        expired:
            Boolean(
                source.expired
            ),

        disabled:
            Boolean(
                source.disabled
            ),

        key:
            descriptor.key,

        keyHash:
            descriptor.keyHash,

        namespace:
            descriptor.namespace,

        documentId:
            descriptor.documentId,

        value:
            cloneValue(
                source.value
            ),

        metadata:
            cloneValue(
                source.metadata
            ),

        createdAt:
            serializeTimestamp(
                source.createdAt
            ),

        updatedAt:
            serializeTimestamp(
                source.updatedAt
            ),

        expiresAt:
            serializeTimestamp(
                source.expiresAt
            ),

        staleUntil:
            serializeTimestamp(
                source.staleUntil
            )
    };
}

/* ==========================================================
   RECORD SANITIZATION
========================================================== */

function sanitizeCacheRecord(
    record
) {
    if (!record) {
        return null;
    }

    return {
        key:
            record.key,

        keyHash:
            record.keyHash,

        namespace:
            record.namespace,

        compositeKey:
            record.compositeKey,

        value:
            cloneValue(
                record.value
            ),

        metadata:
            cloneValue(
                record.metadata
            ),

        createdAt:
            serializeTimestamp(
                record.createdAt
            ),

        updatedAt:
            serializeTimestamp(
                record.updatedAt
            ),

        expiresAt:
            serializeTimestamp(
                record.expiresAt
            ),

        staleUntil:
            serializeTimestamp(
                record.staleUntil
            )
    };
}

/* ==========================================================
   VALUE VALIDATION
========================================================== */

function assertSerializableCacheValue(
    value,
    options
) {
    const settings =
        options || {};

    let serialized;

    try {
        serialized =
            stableStringify(
                value
            );
    } catch (error) {
        if (
            error instanceof
            ServiceError
        ) {
            throw error;
        }

        throw new ServiceError(
            "invalid-argument",
            "The cache value could not be serialized.",
            {
                status:
                    400,

                expose:
                    true,

                cause:
                    error
            }
        );
    }

    const bytes =
        Buffer.byteLength(
            serialized,
            "utf8"
        );

    if (
        bytes >
        settings.maxValueBytes
    ) {
        throw new ServiceError(
            "resource-exhausted",
            "The cache value is too large to store.",
            {
                status:
                    413,

                expose:
                    true,

                details: {
                    bytes:
                        bytes,

                    maximumBytes:
                        settings
                            .maxValueBytes
                }
            }
        );
    }

    return true;
}

/* ==========================================================
   STABLE SERIALIZATION
========================================================== */

function stableStringify(
    value
) {
    return JSON.stringify(
        normalizeStableValue(
            value
        )
    );
}

function normalizeStableValue(
    value,
    state
) {
    const currentState =
        state || {
            seen:
                new WeakSet()
        };

    if (
        value === undefined
    ) {
        return null;
    }

    if (
        value === null ||
        typeof value ===
            "string" ||
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
        value instanceof Date
    ) {
        return value.toISOString();
    }

    if (
        Buffer.isBuffer(value)
    ) {
        return value.toString(
            "base64"
        );
    }

    if (
        value &&
        typeof value.toMillis ===
            "function"
    ) {
        return value.toMillis();
    }

    if (
        typeof value !==
        "object"
    ) {
        return String(value);
    }

    if (
        currentState.seen.has(
            value
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The cache value contains a circular reference.",
            {
                status:
                    400,

                expose:
                    true
            }
        );
    }

    currentState.seen.add(
        value
    );

    if (
        Array.isArray(value)
    ) {
        const normalized =
            value.map(
                function (item) {
                    return normalizeStableValue(
                        item,
                        currentState
                    );
                }
            );

        currentState.seen.delete(
            value
        );

        return normalized;
    }

    const normalized =
        Object.keys(value)
            .sort()
            .reduce(
                function (
                    output,
                    key
                ) {
                    output[key] =
                        normalizeStableValue(
                            value[key],
                            currentState
                        );

                    return output;
                },
                {}
            );

    currentState.seen.delete(
        value
    );

    return normalized;
}

/* ==========================================================
   OPTIONS
========================================================== */

function normalizeCacheOptions(
    options
) {
    const settings =
        options || {};

    return {
        runtime:
            settings.runtime,

        collection:
            normalizeCollection(
                settings.collection ||
                CACHE_COLLECTION
            ),

        namespace:
            normalizeNamespace(
                settings.namespace ||
                DEFAULT_NAMESPACE
            ),

        ttlMs:
            normalizePositiveInteger(
                settings.ttlMs,
                DEFAULT_TTL_MS,
                "Cache TTL"
            ),

        staleTtlMs:
            normalizeNonNegativeInteger(
                settings.staleTtlMs,
                DEFAULT_STALE_TTL_MS,
                "Cache stale TTL"
            ),

        maxValueBytes:
            normalizePositiveInteger(
                settings.maxValueBytes,
                DEFAULT_MAX_VALUE_BYTES,
                "Maximum cache value size"
            ),

        allowStale:
            Boolean(
                settings.allowStale
            ),

        refreshStale:
            settings.refreshStale !==
            false,

        useStaleOnError:
            settings.useStaleOnError !==
            false,

        deleteExpired:
            settings.deleteExpired !==
            false,

        disabled:
            Boolean(
                settings.disabled
            ),

        metadata:
            sanitizeMetadata(
                settings.metadata
            ),

        log:
            settings.log !==
            false,

        exposeKey:
            Boolean(
                settings.exposeKey
            ),

        now:
            settings.now
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
            "Cache collection must be a Firestore collection name."
        );
    }

    return collection;
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
        normalized < 0
    ) {
        throw new TypeError(
            label +
            " must be a non-negative integer."
        );
    }

    return normalized;
}

/* ==========================================================
   RUNTIME
========================================================== */

function assertCacheRuntime(
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
            "The cache datastore is unavailable.",
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

function toMilliseconds(
    value
) {
    if (
        value === undefined ||
        value === null
    ) {
        return 0;
    }

    if (
        value instanceof Date
    ) {
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

        return Number.isNaN(
            parsed
        )
            ? 0
            : parsed;
    }

    const numeric =
        Number(value);

    return Number.isFinite(
        numeric
    )
        ? numeric
        : 0;
}

/* ==========================================================
   DATA HELPERS
========================================================== */

function sanitizeMetadata(
    value
) {
    if (
        value === undefined ||
        value === null
    ) {
        return {};
    }

    if (
        typeof value !==
        "object" ||
        Array.isArray(value)
    ) {
        return {
            value:
                cloneValue(value)
        };
    }

    return cloneValue(value);
}

function cloneValue(
    value
) {
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
        if (
            typeof value.toMillis ===
            "function"
        ) {
            return value;
        }

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

function serializeTimestamp(
    value
) {
    const milliseconds =
        toMilliseconds(
            value
        );

    return milliseconds
        ? new Date(
              milliseconds
          ).toISOString()
        : null;
}

function serializeCacheError(
    error
) {
    if (!error) {
        return null;
    }

    return {
        name:
            error.name ||
            "Error",

        code:
            error.code ||
            "internal",

        message:
            error.publicMessage ||
            error.message ||
            "Cache loader failed.",

        status:
            error.status ||
            500,

        retryable:
            Boolean(
                error.retryable
            )
    };
}

/* ==========================================================
   LOGGING
========================================================== */

function logCacheEvent(
    runtime,
    result,
    options
) {
    const settings =
        options || {};

    if (
        !settings.log ||
        !runtime ||
        !runtime.logger
    ) {
        return;
    }

    const logger =
        runtime.logger;

    const metadata = {
        operation:
            result.operation ||
            "get",

        status:
            result.status,

        namespace:
            result.namespace,

        hit:
            result.hit,

        stale:
            result.stale
    };

    if (
        settings.exposeKey
    ) {
        metadata.key =
            result.key;
    }

    if (
        result.status ===
        CACHE_STATUSES.miss
    ) {
        if (
            typeof logger.debug ===
            "function"
        ) {
            logger.debug(
                "Cache miss.",
                metadata
            );
        }

        return;
    }

    if (
        typeof logger.debug ===
        "function"
    ) {
        logger.debug(
            "Cache event.",
            metadata
        );
    }
}

function logCacheLoadFailure(
    runtime,
    error,
    cached,
    options
) {
    const settings =
        options || {};

    if (
        !settings.log ||
        !runtime ||
        !runtime.logger ||
        typeof runtime.logger.warn !==
            "function"
    ) {
        return;
    }

    const metadata = {
        namespace:
            cached.namespace,

        status:
            cached.status,

        error:
            serializeCacheError(
                error
            )
    };

    if (
        settings.exposeKey
    ) {
        metadata.key =
            cached.key;
    }

    runtime.logger.warn(
        "Cache loader failed; stale value returned.",
        metadata
    );
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    createCacheService,
    getCachedValue,
    setCachedValue,
    deleteCachedValue,
    inspectCachedValue,
    rememberCachedValue,
    createCacheDescriptor,
    normalizeCacheKey,
    normalizeNamespace,
    hashCacheKey,
    createCacheResult,
    sanitizeCacheRecord,
    assertSerializableCacheValue,
    stableStringify,
    normalizeStableValue,
    normalizeCacheOptions,
    normalizeCollection,
    normalizePositiveInteger,
    normalizeNonNegativeInteger,
    assertCacheRuntime,
    resolveNow,
    createDatabaseTimestamp,
    toMilliseconds,
    sanitizeMetadata,
    serializeTimestamp,
    serializeCacheError,
    logCacheEvent,
    logCacheLoadFailure,
    constants: {
        CACHE_COLLECTION,
        DEFAULT_NAMESPACE,
        DEFAULT_TTL_MS,
        DEFAULT_STALE_TTL_MS,
        DEFAULT_MAX_VALUE_BYTES,
        DEFAULT_MAX_KEY_LENGTH,
        CACHE_STATUSES
    }
};