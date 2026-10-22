"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   IDEMPOTENCY SERVICE

   Responsibilities:
   - Prevent duplicate write operations
   - Store operation state in Firestore
   - Reuse completed responses safely
   - Detect conflicting payloads
   - Handle in-progress and failed operations
   - Support HTTP and callable request keys
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

const IDEMPOTENCY_COLLECTION =
    "_idempotency";

const DEFAULT_TTL_MS =
    24 * 60 * 60 * 1000;

const DEFAULT_PROCESSING_TIMEOUT_MS =
    5 * 60 * 1000;

const DEFAULT_KEY_HEADER =
    "idempotency-key";

const DEFAULT_NAMESPACE =
    "global";

const DEFAULT_MAX_KEY_LENGTH =
    200;

const DEFAULT_MAX_RESULT_BYTES =
    500000;

const IDEMPOTENCY_STATUSES =
    Object.freeze({
        processing:
            "processing",

        completed:
            "completed",

        failed:
            "failed"
    });

/* ==========================================================
   SERVICE FACTORY
========================================================== */

function createIdempotencyService(
    options
) {
    const settings =
        normalizeIdempotencyOptions(
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

        execute:
            function (
                input,
                operation,
                overrides
            ) {
                return executeIdempotentOperation(
                    runtime,
                    input,
                    operation,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        inspect:
            function (
                input,
                overrides
            ) {
                return inspectIdempotencyRecord(
                    runtime,
                    input,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        clear:
            function (
                input,
                overrides
            ) {
                return clearIdempotencyRecord(
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
   EXECUTION
========================================================== */

async function executeIdempotentOperation(
    runtime,
    input,
    operation,
    options
) {
    if (
        typeof operation !==
        "function"
    ) {
        throw new TypeError(
            "Idempotent operation must be a function."
        );
    }

    const settings =
        normalizeIdempotencyOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return {
            reused:
                false,

            disabled:
                true,

            result:
                await operation()
        };
    }

    assertIdempotencyRuntime(
        runtime
    );

    const now =
        resolveNow(
            runtime,
            settings
        );

    const key =
        resolveIdempotencyKey(
            input,
            settings
        );

    const namespace =
        normalizeNamespace(
            settings.namespace
        );

    const fingerprint =
        createRequestFingerprint(
            resolveFingerprintValue(
                input,
                settings
            )
        );

    const descriptor =
        createIdempotencyDescriptor(
            key,
            namespace
        );

    const reference =
        runtime.db
            .collection(
                settings.collection
            )
            .doc(
                descriptor.documentId
            );

    const reservation =
        await reserveIdempotencyRecord(
            runtime,
            reference,
            {
                key:
                    key,

                namespace:
                    namespace,

                keyHash:
                    descriptor.keyHash,

                fingerprint:
                    fingerprint,

                now:
                    now,

                ttlMs:
                    settings.ttlMs,

                processingTimeoutMs:
                    settings
                        .processingTimeoutMs,

                ownerId:
                    settings.ownerId,

                metadata:
                    settings.metadata
            }
        );

    if (
        reservation.action ===
        "reuse"
    ) {
        logIdempotencyEvent(
            runtime,
            "reused",
            reservation.record,
            settings
        );

        return {
            reused:
                true,

            disabled:
                false,

            key:
                key,

            namespace:
                namespace,

            result:
                cloneValue(
                    reservation.record
                        .result
                ),

            record:
                sanitizeIdempotencyRecord(
                    reservation.record
                )
        };
    }

    if (
        reservation.action ===
        "conflict"
    ) {
        throw createIdempotencyConflictError(
            key,
            namespace,
            reservation.record,
            settings
        );
    }

    if (
        reservation.action ===
        "processing"
    ) {
        throw createIdempotencyProcessingError(
            key,
            namespace,
            reservation.record,
            settings
        );
    }

    try {
        const result =
            await operation({
                key:
                    key,

                namespace:
                    namespace,

                fingerprint:
                    fingerprint,

                documentId:
                    descriptor.documentId,

                record:
                    sanitizeIdempotencyRecord(
                        reservation.record
                    )
            });

        assertSerializableResult(
            result,
            settings
        );

        const completedAt =
            resolveNow(
                runtime,
                settings
            );

        const completedRecord =
            await completeIdempotencyRecord(
                runtime,
                reference,
                {
                    key:
                        key,

                    namespace:
                        namespace,

                    fingerprint:
                        fingerprint,

                    result:
                        result,

                    completedAt:
                        completedAt,

                    ttlMs:
                        settings.ttlMs,

                    metadata:
                        settings.metadata
                }
            );

        logIdempotencyEvent(
            runtime,
            "completed",
            completedRecord,
            settings
        );

        return {
            reused:
                false,

            disabled:
                false,

            key:
                key,

            namespace:
                namespace,

            result:
                result,

            record:
                sanitizeIdempotencyRecord(
                    completedRecord
                )
        };
    } catch (error) {
        const failedAt =
            resolveNow(
                runtime,
                settings
            );

        await failIdempotencyRecord(
            runtime,
            reference,
            {
                key:
                    key,

                namespace:
                    namespace,

                fingerprint:
                    fingerprint,

                failedAt:
                    failedAt,

                ttlMs:
                    settings.failureTtlMs,

                error:
                    error,

                retainFailed:
                    settings.retainFailed,

                metadata:
                    settings.metadata
            }
        );

        logIdempotencyEvent(
            runtime,
            "failed",
            {
                key:
                    key,

                namespace:
                    namespace,

                fingerprint:
                    fingerprint,

                error:
                    serializeOperationError(
                        error
                    )
            },
            settings
        );

        throw error;
    }
}

/* ==========================================================
   RESERVATION
========================================================== */

async function reserveIdempotencyRecord(
    runtime,
    reference,
    input
) {
    const source =
        input || {};

    return runtime.db
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

                if (existing) {
                    const decision =
                        evaluateExistingRecord(
                            existing,
                            source
                        );

                    if (
                        decision.action !==
                        "reserve"
                    ) {
                        return {
                            action:
                                decision.action,

                            record:
                                existing
                        };
                    }
                }

                const record =
                    createProcessingRecord(
                        runtime,
                        source
                    );

                transaction.set(
                    reference,
                    record,
                    {
                        merge:
                            false
                    }
                );

                return {
                    action:
                        "execute",

                    record:
                        record
                };
            }
        );
}

function evaluateExistingRecord(
    record,
    input
) {
    const source =
        input || {};

    if (
        record.fingerprint &&
        source.fingerprint &&
        record.fingerprint !==
            source.fingerprint
    ) {
        return {
            action:
                "conflict"
        };
    }

    const status =
        normalizeStatus(
            record.status
        );

    if (
        status ===
        IDEMPOTENCY_STATUSES
            .completed
    ) {
        return {
            action:
                "reuse"
        };
    }

    if (
        status ===
        IDEMPOTENCY_STATUSES
            .processing
    ) {
        const startedAt =
            toMilliseconds(
                record.startedAt
            );

        const stale =
            !startedAt ||
            source.now -
            startedAt >=
            source
                .processingTimeoutMs;

        if (!stale) {
            return {
                action:
                    "processing"
            };
        }

        return {
            action:
                "reserve"
        };
    }

    if (
        status ===
        IDEMPOTENCY_STATUSES
            .failed
    ) {
        return {
            action:
                "reserve"
        };
    }

    return {
        action:
            "reserve"
    };
}

function createProcessingRecord(
    runtime,
    input
) {
    const source =
        input || {};

    return {
        key:
            source.key,

        keyHash:
            source.keyHash,

        namespace:
            source.namespace,

        fingerprint:
            source.fingerprint,

        status:
            IDEMPOTENCY_STATUSES
                .processing,

        ownerId:
            source.ownerId ||
            null,

        attempt:
            1,

        result:
            null,

        error:
            null,

        metadata:
            sanitizeMetadata(
                source.metadata
            ),

        startedAt:
            createDatabaseTimestamp(
                runtime,
                source.now
            ),

        updatedAt:
            createDatabaseTimestamp(
                runtime,
                source.now
            ),

        expiresAt:
            createDatabaseTimestamp(
                runtime,
                source.now +
                source.ttlMs
            )
    };
}

/* ==========================================================
   COMPLETION
========================================================== */

async function completeIdempotencyRecord(
    runtime,
    reference,
    input
) {
    const source =
        input || {};

    const record = {
        key:
            source.key,

        namespace:
            source.namespace,

        fingerprint:
            source.fingerprint,

        status:
            IDEMPOTENCY_STATUSES
                .completed,

        result:
            cloneValue(
                source.result
            ),

        error:
            null,

        metadata:
            sanitizeMetadata(
                source.metadata
            ),

        completedAt:
            createDatabaseTimestamp(
                runtime,
                source.completedAt
            ),

        updatedAt:
            createDatabaseTimestamp(
                runtime,
                source.completedAt
            ),

        expiresAt:
            createDatabaseTimestamp(
                runtime,
                source.completedAt +
                source.ttlMs
            )
    };

    await reference.set(
        record,
        {
            merge:
                true
        }
    );

    return record;
}

/* ==========================================================
   FAILURE
========================================================== */

async function failIdempotencyRecord(
    runtime,
    reference,
    input
) {
    const source =
        input || {};

    if (
        source.retainFailed ===
        false
    ) {
        await reference.delete();

        return {
            deleted:
                true
        };
    }

    const record = {
        key:
            source.key,

        namespace:
            source.namespace,

        fingerprint:
            source.fingerprint,

        status:
            IDEMPOTENCY_STATUSES
                .failed,

        result:
            null,

        error:
            serializeOperationError(
                source.error
            ),

        metadata:
            sanitizeMetadata(
                source.metadata
            ),

        failedAt:
            createDatabaseTimestamp(
                runtime,
                source.failedAt
            ),

        updatedAt:
            createDatabaseTimestamp(
                runtime,
                source.failedAt
            ),

        expiresAt:
            createDatabaseTimestamp(
                runtime,
                source.failedAt +
                source.ttlMs
            )
    };

    await reference.set(
        record,
        {
            merge:
                true
        }
    );

    return record;
}

/* ==========================================================
   INSPECTION
========================================================== */

async function inspectIdempotencyRecord(
    runtime,
    input,
    options
) {
    const settings =
        normalizeIdempotencyOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return null;
    }

    assertIdempotencyRuntime(
        runtime
    );

    const key =
        resolveIdempotencyKey(
            input,
            settings
        );

    const descriptor =
        createIdempotencyDescriptor(
            key,
            settings.namespace
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

    return sanitizeIdempotencyRecord(
        snapshot.data()
    );
}

/* ==========================================================
   CLEARING
========================================================== */

async function clearIdempotencyRecord(
    runtime,
    input,
    options
) {
    const settings =
        normalizeIdempotencyOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return {
            cleared:
                false,

            disabled:
                true
        };
    }

    assertIdempotencyRuntime(
        runtime
    );

    const key =
        resolveIdempotencyKey(
            input,
            settings
        );

    const descriptor =
        createIdempotencyDescriptor(
            key,
            settings.namespace
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
        cleared:
            true,

        disabled:
            false,

        key:
            key,

        namespace:
            descriptor.namespace,

        documentId:
            descriptor.documentId
    };
}

/* ==========================================================
   KEY RESOLUTION
========================================================== */

function resolveIdempotencyKey(
    input,
    options
) {
    const settings =
        options || {};

    if (
        typeof settings.keyResolver ===
        "function"
    ) {
        return normalizeIdempotencyKey(
            settings.keyResolver(
                input
            )
        );
    }

    if (
        settings.key
    ) {
        return normalizeIdempotencyKey(
            settings.key
        );
    }

    const request =
        input &&
        input.rawRequest
            ? input.rawRequest
            : input;

    const headerValue =
        getHeader(
            request,
            settings.headerName ||
            DEFAULT_KEY_HEADER
        );

    if (headerValue) {
        return normalizeIdempotencyKey(
            headerValue
        );
    }

    if (
        input &&
        input.idempotencyKey
    ) {
        return normalizeIdempotencyKey(
            input.idempotencyKey
        );
    }

    if (
        settings.required ===
        false
    ) {
        return generateIdempotencyKey();
    }

    throw new ServiceError(
        "invalid-argument",
        "An idempotency key is required.",
        {
            status:
                400,

            expose:
                true,

            details: {
                header:
                    settings.headerName ||
                    DEFAULT_KEY_HEADER
            }
        }
    );
}

function normalizeIdempotencyKey(
    value
) {
    const normalized =
        String(
            value || ""
        ).trim();

    if (!normalized) {
        throw new ServiceError(
            "invalid-argument",
            "The idempotency key is invalid.",
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
            "The idempotency key is too long.",
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

    if (
        !/^[A-Za-z0-9._:-]+$/
            .test(normalized)
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The idempotency key contains unsupported characters.",
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

function generateIdempotencyKey() {
    if (
        typeof crypto.randomUUID ===
        "function"
    ) {
        return crypto.randomUUID();
    }

    return crypto
        .randomBytes(24)
        .toString("hex");
}

/* ==========================================================
   DESCRIPTOR
========================================================== */

function createIdempotencyDescriptor(
    key,
    namespace
) {
    const normalizedKey =
        normalizeIdempotencyKey(
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
        hashValue(
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

function normalizeNamespace(
    value
) {
    const namespace =
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

    return namespace ||
        DEFAULT_NAMESPACE;
}

/* ==========================================================
   FINGERPRINTING
========================================================== */

function resolveFingerprintValue(
    input,
    options
) {
    const settings =
        options || {};

    if (
        typeof settings.fingerprintResolver ===
        "function"
    ) {
        return settings
            .fingerprintResolver(
                input
            );
    }

    if (
        settings.fingerprint !==
        undefined
    ) {
        return settings.fingerprint;
    }

    if (
        input &&
        input.data !==
        undefined
    ) {
        return input.data;
    }

    if (
        input &&
        input.body !==
        undefined
    ) {
        return input.body;
    }

    return input || {};
}

function createRequestFingerprint(
    value
) {
    return hashValue(
        stableStringify(
            value
        )
    );
}

function stableStringify(value) {
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
        value === null ||
        value === undefined
    ) {
        return value === undefined
            ? null
            : value;
    }

    if (
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
            "The idempotency payload contains a circular reference.",
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

    if (Array.isArray(value)) {
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

function hashValue(value) {
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
   CONFLICT ERRORS
========================================================== */

function createIdempotencyConflictError(
    key,
    namespace,
    record,
    options
) {
    const settings =
        options || {};

    return new ServiceError(
        "conflict",
        settings.conflictMessage ||
        "The idempotency key has already been used with different request data.",
        {
            status:
                409,

            expose:
                true,

            retryable:
                false,

            details: {
                key:
                    settings.exposeKey
                        ? key
                        : undefined,

                namespace:
                    namespace,

                status:
                    record &&
                    record.status
            },

            requestId:
                settings.requestId,

            correlationId:
                settings
                    .correlationId
        }
    );
}

function createIdempotencyProcessingError(
    key,
    namespace,
    record,
    options
) {
    const settings =
        options || {};

    const startedAt =
        toMilliseconds(
            record &&
            record.startedAt
        );

    return new ServiceError(
        "conflict",
        settings.processingMessage ||
        "An operation with this idempotency key is already being processed.",
        {
            status:
                409,

            expose:
                true,

            retryable:
                true,

            details: {
                key:
                    settings.exposeKey
                        ? key
                        : undefined,

                namespace:
                    namespace,

                status:
                    IDEMPOTENCY_STATUSES
                        .processing,

                startedAt:
                    startedAt
                        ? new Date(
                              startedAt
                          ).toISOString()
                        : null
            },

            requestId:
                settings.requestId,

            correlationId:
                settings
                    .correlationId
        }
    );
}

/* ==========================================================
   RESULT VALIDATION
========================================================== */

function assertSerializableResult(
    result,
    options
) {
    const settings =
        options || {};

    let serialized;

    try {
        serialized =
            JSON.stringify(result);
    } catch {
        throw new ServiceError(
            "internal",
            "The operation result could not be stored.",
            {
                status:
                    500,

                expose:
                    false
            }
        );
    }

    const bytes =
        Buffer.byteLength(
            serialized ===
                undefined
                ? "null"
                : serialized,
            "utf8"
        );

    if (
        bytes >
        settings.maxResultBytes
    ) {
        throw new ServiceError(
            "resource-exhausted",
            "The operation result is too large to store.",
            {
                status:
                    500,

                expose:
                    false,

                details: {
                    bytes:
                        bytes,

                    maximumBytes:
                        settings
                            .maxResultBytes
                }
            }
        );
    }

    return true;
}

/* ==========================================================
   RECORD SANITIZATION
========================================================== */

function sanitizeIdempotencyRecord(
    record
) {
    if (!record) {
        return null;
    }

    return {
        key:
            record.key,

        namespace:
            record.namespace,

        fingerprint:
            record.fingerprint,

        status:
            normalizeStatus(
                record.status
            ),

        ownerId:
            record.ownerId ||
            null,

        attempt:
            Number(
                record.attempt ||
                1
            ),

        result:
            cloneValue(
                record.result
            ),

        error:
            cloneValue(
                record.error
            ),

        metadata:
            cloneValue(
                record.metadata
            ),

        startedAt:
            serializeTimestamp(
                record.startedAt
            ),

        completedAt:
            serializeTimestamp(
                record.completedAt
            ),

        failedAt:
            serializeTimestamp(
                record.failedAt
            ),

        updatedAt:
            serializeTimestamp(
                record.updatedAt
            ),

        expiresAt:
            serializeTimestamp(
                record.expiresAt
            )
    };
}

function serializeOperationError(
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
            "Operation failed.",

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
   OPTIONS
========================================================== */

function normalizeIdempotencyOptions(
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
                IDEMPOTENCY_COLLECTION
            ),

        namespace:
            normalizeNamespace(
                settings.namespace ||
                DEFAULT_NAMESPACE
            ),

        key:
            settings.key,

        keyResolver:
            settings.keyResolver,

        headerName:
            String(
                settings.headerName ||
                DEFAULT_KEY_HEADER
            ).toLowerCase(),

        required:
            settings.required !==
            false,

        fingerprint:
            settings.fingerprint,

        fingerprintResolver:
            settings
                .fingerprintResolver,

        ttlMs:
            normalizePositiveInteger(
                settings.ttlMs,
                DEFAULT_TTL_MS,
                "Idempotency TTL"
            ),

        failureTtlMs:
            normalizePositiveInteger(
                settings.failureTtlMs,
                settings.ttlMs ||
                DEFAULT_TTL_MS,
                "Idempotency failure TTL"
            ),

        processingTimeoutMs:
            normalizePositiveInteger(
                settings.processingTimeoutMs,
                DEFAULT_PROCESSING_TIMEOUT_MS,
                "Idempotency processing timeout"
            ),

        maxResultBytes:
            normalizePositiveInteger(
                settings.maxResultBytes,
                DEFAULT_MAX_RESULT_BYTES,
                "Maximum idempotency result size"
            ),

        retainFailed:
            settings.retainFailed !==
            false,

        disabled:
            Boolean(
                settings.disabled
            ),

        ownerId:
            settings.ownerId ||
            null,

        metadata:
            sanitizeMetadata(
                settings.metadata
            ),

        exposeKey:
            Boolean(
                settings.exposeKey
            ),

        conflictMessage:
            settings.conflictMessage,

        processingMessage:
            settings.processingMessage,

        requestId:
            settings.requestId,

        correlationId:
            settings.correlationId,

        log:
            settings.log !==
            false
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
            "Idempotency collection must be a Firestore collection name."
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

/* ==========================================================
   RUNTIME HELPERS
========================================================== */

function assertIdempotencyRuntime(
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
            "The idempotency datastore is unavailable.",
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
            "Firestore transactions are required for idempotency.",
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
   HTTP HELPERS
========================================================== */

function getHeader(
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
   DATA HELPERS
========================================================== */

function normalizeStatus(
    value
) {
    const status =
        String(
            value || ""
        )
            .trim()
            .toLowerCase();

    if (
        Object.values(
            IDEMPOTENCY_STATUSES
        ).includes(status)
    ) {
        return status;
    }

    return IDEMPOTENCY_STATUSES
        .processing;
}

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

/* ==========================================================
   LOGGING
========================================================== */

function logIdempotencyEvent(
    runtime,
    event,
    record,
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
        event:
            event,

        namespace:
            record &&
            record.namespace,

        status:
            record &&
            record.status,

        fingerprint:
            record &&
            record.fingerprint
    };

    if (
        settings.exposeKey
    ) {
        metadata.key =
            record &&
            record.key;
    }

    if (
        event ===
        "failed"
    ) {
        if (
            typeof logger.warn ===
            "function"
        ) {
            logger.warn(
                "Idempotent operation failed.",
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
            "Idempotency event.",
            metadata
        );
    }
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    createIdempotencyService,
    executeIdempotentOperation,
    reserveIdempotencyRecord,
    evaluateExistingRecord,
    createProcessingRecord,
    completeIdempotencyRecord,
    failIdempotencyRecord,
    inspectIdempotencyRecord,
    clearIdempotencyRecord,
    resolveIdempotencyKey,
    normalizeIdempotencyKey,
    generateIdempotencyKey,
    createIdempotencyDescriptor,
    normalizeNamespace,
    resolveFingerprintValue,
    createRequestFingerprint,
    stableStringify,
    normalizeStableValue,
    hashValue,
    createIdempotencyConflictError,
    createIdempotencyProcessingError,
    assertSerializableResult,
    sanitizeIdempotencyRecord,
    serializeOperationError,
    normalizeIdempotencyOptions,
    normalizeCollection,
    normalizePositiveInteger,
    assertIdempotencyRuntime,
    resolveNow,
    createDatabaseTimestamp,
    toMilliseconds,
    getHeader,
    normalizeStatus,
    sanitizeMetadata,
    serializeTimestamp,
    logIdempotencyEvent,
    constants: {
        IDEMPOTENCY_COLLECTION,
        DEFAULT_TTL_MS,
        DEFAULT_PROCESSING_TIMEOUT_MS,
        DEFAULT_KEY_HEADER,
        DEFAULT_NAMESPACE,
        DEFAULT_MAX_KEY_LENGTH,
        DEFAULT_MAX_RESULT_BYTES,
        IDEMPOTENCY_STATUSES
    }
};