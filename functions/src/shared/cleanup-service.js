"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   CLEANUP SERVICE

   Responsibilities:
   - Remove expired internal records
   - Process cleanup collections in configurable batches
   - Support dry-run execution
   - Respect retention and expiration timestamps
   - Record cleanup summaries and failures
   - Provide reusable cleanup predicates and query helpers
========================================================== */

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

const DEFAULT_BATCH_SIZE =
    100;

const MAX_BATCH_SIZE =
    500;

const DEFAULT_QUERY_LIMIT =
    100;

const MAX_QUERY_LIMIT =
    500;

const DEFAULT_MAX_COLLECTIONS =
    50;

const DEFAULT_MAX_PASSES =
    100;

const DEFAULT_EXPIRATION_FIELD =
    "expiresAt";

const DEFAULT_ORDER_FIELD =
    "expiresAt";

const DEFAULT_DIRECTION =
    "asc";

const CLEANUP_STATUSES =
    Object.freeze({
        completed:
            "completed",

        partial:
            "partial",

        skipped:
            "skipped",

        disabled:
            "disabled",

        failed:
            "failed"
    });

const DEFAULT_EXPIRING_COLLECTIONS =
    Object.freeze([
        "_auditLogs",
        "_backupRuns",
        "_cacheEntries",
        "_circuitBreakerEvents",
        "_deadLetters",
        "_healthChecks",
        "_idempotencyKeys",
        "_maintenanceRuns",
        "_metrics",
        "_migrationRuns",
        "_notifications",
        "_queueJobs",
        "_rateLimits",
        "_reconciliationItems",
        "_reconciliationRuns",
        "_retryAttempts"
    ]);

/* ==========================================================
   SERVICE FACTORY
========================================================== */

function createCleanupService(
    options
) {
    const settings =
        normalizeCleanupOptions(
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

        run:
            function (
                overrides
            ) {
                return runCleanup(
                    runtime,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        collection:
            function (
                collection,
                overrides
            ) {
                return cleanupCollection(
                    runtime,
                    collection,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        inspect:
            function (
                collection,
                overrides
            ) {
                return inspectExpiredRecords(
                    runtime,
                    collection,
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
   RUN CLEANUP
========================================================== */

async function runCleanup(
    runtime,
    options
) {
    const settings =
        normalizeCleanupOptions(
            options
        );

    const startedAt =
        resolveNow(
            runtime,
            settings
        );

    if (
        settings.disabled
    ) {
        return createCleanupSummary({
            status:
                CLEANUP_STATUSES
                    .disabled,

            disabled:
                true,

            dryRun:
                settings.dryRun,

            startedAt:
                startedAt,

            completedAt:
                startedAt,

            collections:
                []
        });
    }

    assertCleanupRuntime(
        runtime
    );

    const collections =
        settings.collections;

    const results =
        [];

    let deletedCount =
        0;

    let matchedCount =
        0;

    let errorCount =
        0;

    for (
        const collection of
        collections
    ) {
        try {
            const result =
                await cleanupCollection(
                    runtime,
                    collection,
                    settings
                );

            results.push(
                result
            );

            deletedCount +=
                result.deletedCount;

            matchedCount +=
                result.matchedCount;
        } catch (error) {
            errorCount +=
                1;

            const failure =
                createCollectionCleanupFailure(
                    collection,
                    error
                );

            results.push(
                failure
            );

            logCleanupFailure(
                runtime,
                failure,
                settings
            );

            if (
                settings.stopOnError
            ) {
                throw error;
            }
        }
    }

    const completedAt =
        resolveNow(
            runtime,
            settings
        );

    const status =
        errorCount >
        0
            ? deletedCount >
                  0 ||
              matchedCount >
                  0
                ? CLEANUP_STATUSES
                      .partial
                : CLEANUP_STATUSES
                      .failed
            : CLEANUP_STATUSES
                  .completed;

    const summary =
        createCleanupSummary({
            status:
                status,

            disabled:
                false,

            dryRun:
                settings.dryRun,

            startedAt:
                startedAt,

            completedAt:
                completedAt,

            matchedCount:
                matchedCount,

            deletedCount:
                deletedCount,

            errorCount:
                errorCount,

            collections:
                results
        });

    logCleanupEvent(
        runtime,
        summary,
        "completed",
        settings
    );

    return summary;
}

/* ==========================================================
   COLLECTION CLEANUP
========================================================== */

async function cleanupCollection(
    runtime,
    collection,
    options
) {
    const settings =
        normalizeCleanupOptions(
            options
        );

    const collectionName =
        normalizeCollection(
            collection
        );

    const startedAt =
        resolveNow(
            runtime,
            settings
        );

    if (
        settings.disabled
    ) {
        return createCollectionCleanupResult({
            collection:
                collectionName,

            status:
                CLEANUP_STATUSES
                    .disabled,

            disabled:
                true,

            dryRun:
                settings.dryRun,

            startedAt:
                startedAt,

            completedAt:
                startedAt
        });
    }

    assertCleanupRuntime(
        runtime
    );

    let pass =
        0;

    let matchedCount =
        0;

    let deletedCount =
        0;

    let complete =
        false;

    const deletedIds =
        [];

    while (
        pass <
        settings.maxPasses
    ) {
        pass +=
            1;

        const records =
            await loadExpiredRecords(
                runtime,
                collectionName,
                settings
            );

        if (
            records.length ===
            0
        ) {
            complete =
                true;

            break;
        }

        matchedCount +=
            records.length;

        if (
            settings.includeDeletedIds
        ) {
            deletedIds.push(
                ...records.map(
                    function (
                        record
                    ) {
                        return record.id;
                    }
                )
            );
        }

        if (
            settings.dryRun
        ) {
            complete =
                records.length <
                settings.batchSize;

            break;
        }

        const deleted =
            await deleteCleanupRecords(
                runtime,
                collectionName,
                records,
                settings
            );

        deletedCount +=
            deleted;

        if (
            records.length <
            settings.batchSize
        ) {
            complete =
                true;

            break;
        }
    }

    const completedAt =
        resolveNow(
            runtime,
            settings
        );

    const status =
        complete
            ? CLEANUP_STATUSES
                  .completed
            : CLEANUP_STATUSES
                  .partial;

    const result =
        createCollectionCleanupResult({
            collection:
                collectionName,

            status:
                status,

            disabled:
                false,

            dryRun:
                settings.dryRun,

            complete:
                complete,

            passes:
                pass,

            matchedCount:
                matchedCount,

            deletedCount:
                deletedCount,

            deletedIds:
                deletedIds,

            startedAt:
                startedAt,

            completedAt:
                completedAt
        });

    logCleanupEvent(
        runtime,
        result,
        "collection-cleaned",
        settings
    );

    return result;
}

/* ==========================================================
   LOAD EXPIRED RECORDS
========================================================== */

async function loadExpiredRecords(
    runtime,
    collection,
    options
) {
    const settings =
        normalizeCleanupOptions(
            options
        );

    const now =
        resolveNow(
            runtime,
            settings
        );

    let query =
        runtime.db
            .collection(
                normalizeCollection(
                    collection
                )
            );

    if (
        typeof query.where ===
        "function"
    ) {
        query =
            query.where(
                settings.expirationField,
                "<=",
                createDatabaseTimestamp(
                    runtime,
                    now
                )
            );
    }

    if (
        typeof query.orderBy ===
        "function"
    ) {
        query =
            query.orderBy(
                settings.orderField,
                settings.direction
            );
    }

    if (
        typeof query.limit ===
        "function"
    ) {
        query =
            query.limit(
                settings.batchSize
            );
    }

    const snapshot =
        await query.get();

    const documents =
        snapshot &&
        Array.isArray(
            snapshot.docs
        )
            ? snapshot.docs
            : [];

    return documents
        .map(
            function (
                document
            ) {
                const data =
                    document.data();

                return {
                    id:
                        document.id,

                    reference:
                        document.ref ||
                        runtime.db
                            .collection(
                                collection
                            )
                            .doc(
                                document.id
                            ),

                    data:
                        data
                };
            }
        )
        .filter(
            function (
                record
            ) {
                return isRecordExpired(
                    record.data,
                    now,
                    settings
                );
            }
        );
}

/* ==========================================================
   DELETE RECORDS
========================================================== */

async function deleteCleanupRecords(
    runtime,
    collection,
    records,
    options
) {
    const settings =
        normalizeCleanupOptions(
            options
        );

    if (
        records.length ===
        0
    ) {
        return 0;
    }

    if (
        settings.dryRun
    ) {
        return 0;
    }

    if (
        runtime.db &&
        typeof runtime.db.batch ===
            "function"
    ) {
        return deleteRecordsWithBatch(
            runtime,
            collection,
            records
        );
    }

    return deleteRecordsSequentially(
        runtime,
        collection,
        records
    );
}

async function deleteRecordsWithBatch(
    runtime,
    collection,
    records
) {
    const batch =
        runtime.db.batch();

    for (
        const record of
        records
    ) {
        const reference =
            record.reference ||
            runtime.db
                .collection(
                    collection
                )
                .doc(
                    record.id
                );

        batch.delete(
            reference
        );
    }

    await batch.commit();

    return records.length;
}

async function deleteRecordsSequentially(
    runtime,
    collection,
    records
) {
    let deleted =
        0;

    for (
        const record of
        records
    ) {
        const reference =
            record.reference ||
            runtime.db
                .collection(
                    collection
                )
                .doc(
                    record.id
                );

        if (
            typeof reference.delete !==
            "function"
        ) {
            throw new ServiceError(
                "configuration-error",
                "The cleanup datastore cannot delete records.",
                {
                    status:
                        500,

                    expose:
                        false
                }
            );
        }

        await reference.delete();

        deleted +=
            1;
    }

    return deleted;
}

/* ==========================================================
   INSPECTION
========================================================== */

async function inspectExpiredRecords(
    runtime,
    collection,
    options
) {
    const settings =
        normalizeCleanupOptions(
            Object.assign(
                {},
                options || {},
                {
                    dryRun:
                        true
                }
            )
        );

    if (
        settings.disabled
    ) {
        return {
            collection:
                normalizeCollection(
                    collection
                ),

            records:
                [],

            count:
                0,

            disabled:
                true
        };
    }

    assertCleanupRuntime(
        runtime
    );

    const records =
        await loadExpiredRecords(
            runtime,
            collection,
            settings
        );

    return {
        collection:
            normalizeCollection(
                collection
            ),

        records:
            records.map(
                sanitizeExpiredRecord
            ),

        count:
            records.length,

        disabled:
            false,

        inspectedAt:
            serializeTimestamp(
                resolveNow(
                    runtime,
                    settings
                )
            )
    };
}

function sanitizeExpiredRecord(
    record
) {
    return {
        id:
            record.id,

        expiresAt:
            serializeTimestamp(
                record.data &&
                record.data.expiresAt
            ),

        createdAt:
            serializeTimestamp(
                record.data &&
                record.data.createdAt
            ),

        updatedAt:
            serializeTimestamp(
                record.data &&
                record.data.updatedAt
            )
    };
}

/* ==========================================================
   EXPIRATION
========================================================== */

function isRecordExpired(
    record,
    now,
    options
) {
    const settings =
        options || {};

    if (
        !record ||
        typeof record !==
            "object"
    ) {
        return false;
    }

    const field =
        settings.expirationField ||
        DEFAULT_EXPIRATION_FIELD;

    const expiration =
        getNestedValue(
            record,
            field
        );

    const milliseconds =
        toMilliseconds(
            expiration
        );

    if (
        !Number.isFinite(
            milliseconds
        ) ||
        milliseconds <=
            0
    ) {
        return false;
    }

    return (
        milliseconds <=
        Number(now)
    );
}

function getNestedValue(
    object,
    path
) {
    return String(
        path || ""
    )
        .split(".")
        .filter(Boolean)
        .reduce(
            function (
                current,
                segment
            ) {
                if (
                    current === null ||
                    current === undefined
                ) {
                    return undefined;
                }

                return current[
                    segment
                ];
            },
            object
        );
}

/* ==========================================================
   SUMMARY BUILDERS
========================================================== */

function createCleanupSummary(
    values
) {
    const source =
        values || {};

    const startedAt =
        toMilliseconds(
            source.startedAt
        );

    const completedAt =
        toMilliseconds(
            source.completedAt
        );

    return {
        status:
            normalizeCleanupStatus(
                source.status
            ),

        disabled:
            Boolean(
                source.disabled
            ),

        dryRun:
            Boolean(
                source.dryRun
            ),

        matchedCount:
            normalizeNonNegativeInteger(
                source.matchedCount,
                0,
                "Cleanup matched count"
            ),

        deletedCount:
            normalizeNonNegativeInteger(
                source.deletedCount,
                0,
                "Cleanup deleted count"
            ),

        errorCount:
            normalizeNonNegativeInteger(
                source.errorCount,
                0,
                "Cleanup error count"
            ),

        collectionCount:
            Array.isArray(
                source.collections
            )
                ? source.collections
                    .length
                : 0,

        collections:
            Array.isArray(
                source.collections
            )
                ? source.collections
                    .map(
                        cloneValue
                    )
                : [],

        startedAt:
            serializeTimestamp(
                startedAt
            ),

        completedAt:
            serializeTimestamp(
                completedAt
            ),

        durationMs:
            calculateDuration(
                startedAt,
                completedAt
            )
    };
}

function createCollectionCleanupResult(
    values
) {
    const source =
        values || {};

    const startedAt =
        toMilliseconds(
            source.startedAt
        );

    const completedAt =
        toMilliseconds(
            source.completedAt
        );

    return {
        collection:
            normalizeCollection(
                source.collection
            ),

        status:
            normalizeCleanupStatus(
                source.status
            ),

        disabled:
            Boolean(
                source.disabled
            ),

        dryRun:
            Boolean(
                source.dryRun
            ),

        complete:
            source.complete ===
            undefined
                ? true
                : Boolean(
                      source.complete
                  ),

        passes:
            normalizeNonNegativeInteger(
                source.passes,
                0,
                "Cleanup pass count"
            ),

        matchedCount:
            normalizeNonNegativeInteger(
                source.matchedCount,
                0,
                "Cleanup matched count"
            ),

        deletedCount:
            normalizeNonNegativeInteger(
                source.deletedCount,
                0,
                "Cleanup deleted count"
            ),

        deletedIds:
            Array.isArray(
                source.deletedIds
            )
                ? source.deletedIds
                    .map(
                        function (
                            value
                        ) {
                            return String(
                                value
                            );
                        }
                    )
                : [],

        error:
            source.error
                ? cloneValue(
                      source.error
                  )
                : null,

        startedAt:
            serializeTimestamp(
                startedAt
            ),

        completedAt:
            serializeTimestamp(
                completedAt
            ),

        durationMs:
            calculateDuration(
                startedAt,
                completedAt
            )
    };
}

function createCollectionCleanupFailure(
    collection,
    error
) {
    return createCollectionCleanupResult({
        collection:
            normalizeCollection(
                collection
            ),

        status:
            CLEANUP_STATUSES
                .failed,

        complete:
            false,

        error:
            serializeCleanupError(
                error
            )
    });
}

function calculateDuration(
    startedAt,
    completedAt
) {
    if (
        !Number.isFinite(
            startedAt
        ) ||
        !Number.isFinite(
            completedAt
        )
    ) {
        return 0;
    }

    return Math.max(
        0,
        completedAt -
        startedAt
    );
}

/* ==========================================================
   ERROR SERIALIZATION
========================================================== */

function serializeCleanupError(
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
            "cleanup-failed",

        message:
            error.publicMessage ||
            error.message ||
            "Cleanup failed.",

        status:
            Number(
                error.status ||
                error.statusCode ||
                500
            ),

        retryable:
            error.retryable !==
            undefined
                ? Boolean(
                      error.retryable
                  )
                : false
    };
}

/* ==========================================================
   NORMALIZERS
========================================================== */

function normalizeCleanupStatus(
    value
) {
    const normalized =
        String(
            value ||
            CLEANUP_STATUSES
                .completed
        )
            .trim()
            .toLowerCase();

    if (
        !Object.values(
            CLEANUP_STATUSES
        ).includes(
            normalized
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The cleanup status is invalid.",
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

function normalizeCollection(
    value
) {
    const normalized =
        String(
            value || ""
        ).trim();

    if (
        !normalized ||
        normalized.includes("/")
    ) {
        throw new TypeError(
            "Cleanup collection must be a Firestore collection name."
        );
    }

    return normalized;
}

function normalizeCollections(
    value,
    maximumCollections
) {
    const values =
        value ===
            undefined ||
        value ===
            null
            ? DEFAULT_EXPIRING_COLLECTIONS
                .slice()
            : Array.isArray(
                  value
              )
              ? value
              : [
                    value
                ];

    const normalized =
        Array.from(
            new Set(
                values.map(
                    normalizeCollection
                )
            )
        );

    if (
        normalized.length ===
        0
    ) {
        throw new TypeError(
            "At least one cleanup collection is required."
        );
    }

    const maximum =
        normalizePositiveInteger(
            maximumCollections,
            DEFAULT_MAX_COLLECTIONS,
            "Maximum cleanup collections"
        );

    if (
        normalized.length >
        maximum
    ) {
        throw new ServiceError(
            "resource-exhausted",
            "Too many cleanup collections were requested.",
            {
                status:
                    413,

                expose:
                    true,

                details: {
                    collectionCount:
                        normalized.length,

                    maximumCollections:
                        maximum
                }
            }
        );
    }

    return normalized;
}

function normalizeFieldPath(
    value,
    fallback,
    label
) {
    const normalized =
        String(
            value ||
            fallback ||
            ""
        ).trim();

    if (
        !normalized ||
        !/^[a-zA-Z0-9_.]+$/
            .test(
                normalized
            )
    ) {
        throw new TypeError(
            label +
            " is invalid."
        );
    }

    return normalized;
}

function normalizeDirection(
    value
) {
    return String(
        value ||
        DEFAULT_DIRECTION
    ).toLowerCase() ===
    "desc"
        ? "desc"
        : "asc";
}

function normalizeBatchSize(
    value
) {
    const normalized =
        normalizePositiveInteger(
            value,
            DEFAULT_BATCH_SIZE,
            "Cleanup batch size"
        );

    return Math.min(
        normalized,
        MAX_BATCH_SIZE
    );
}

function normalizeQueryLimit(
    value
) {
    const normalized =
        normalizePositiveInteger(
            value,
            DEFAULT_QUERY_LIMIT,
            "Cleanup query limit"
        );

    return Math.min(
        normalized,
        MAX_QUERY_LIMIT
    );
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
        Number(
            value
        );

    if (
        !Number.isInteger(
            normalized
        ) ||
        normalized <=
            0
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
        Number(
            value
        );

    if (
        !Number.isInteger(
            normalized
        ) ||
        normalized <
            0
    ) {
        throw new TypeError(
            label +
            " must be a non-negative integer."
        );
    }

    return normalized;
}

/* ==========================================================
   OPTIONS
========================================================== */

function normalizeCleanupOptions(
    options
) {
    const settings =
        options || {};

    const maximumCollections =
        normalizePositiveInteger(
            settings.maxCollections,
            DEFAULT_MAX_COLLECTIONS,
            "Maximum cleanup collections"
        );

    return {
        runtime:
            settings.runtime,

        collections:
            normalizeCollections(
                settings.collections,
                maximumCollections
            ),

        maxCollections:
            maximumCollections,

        expirationField:
            normalizeFieldPath(
                settings.expirationField,
                DEFAULT_EXPIRATION_FIELD,
                "Cleanup expiration field"
            ),

        orderField:
            normalizeFieldPath(
                settings.orderField,
                settings.expirationField ||
                DEFAULT_ORDER_FIELD,
                "Cleanup order field"
            ),

        direction:
            normalizeDirection(
                settings.direction
            ),

        batchSize:
            normalizeBatchSize(
                settings.batchSize
            ),

        queryLimit:
            normalizeQueryLimit(
                settings.queryLimit
            ),

        maxPasses:
            normalizePositiveInteger(
                settings.maxPasses,
                DEFAULT_MAX_PASSES,
                "Maximum cleanup passes"
            ),

        dryRun:
            Boolean(
                settings.dryRun
            ),

        disabled:
            Boolean(
                settings.disabled
            ),

        stopOnError:
            Boolean(
                settings.stopOnError
            ),

        includeDeletedIds:
            Boolean(
                settings.includeDeletedIds
            ),

        log:
            settings.log !==
            false,

        now:
            settings.now
    };
}

/* ==========================================================
   RUNTIME AND TIME
========================================================== */

function assertCleanupRuntime(
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
            "The cleanup datastore is unavailable.",
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
            Date.parse(
                value
            );

        return Number.isNaN(
            parsed
        )
            ? Number.NaN
            : parsed;
    }

    const normalized =
        Number(
            value
        );

    return Number.isFinite(
        normalized
    )
        ? normalized
        : Number.NaN;
}

function serializeTimestamp(
    value
) {
    const milliseconds =
        toMilliseconds(
            value
        );

    return Number.isFinite(
        milliseconds
    ) &&
    milliseconds >
        0
        ? new Date(
              milliseconds
          ).toISOString()
        : null;
}

/* ==========================================================
   DATA
========================================================== */

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
        Buffer.isBuffer(
            value
        )
    ) {
        return Buffer.from(
            value
        );
    }

    if (
        Array.isArray(
            value
        )
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

        return Object.keys(
            value
        ).reduce(
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
   LOGGING
========================================================== */

function logCleanupEvent(
    runtime,
    result,
    event,
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

    const metadata = {
        event:
            event,

        status:
            result &&
            result.status,

        collection:
            result &&
            result.collection,

        collectionCount:
            result &&
            result.collectionCount,

        matchedCount:
            result &&
            result.matchedCount,

        deletedCount:
            result &&
            result.deletedCount,

        errorCount:
            result &&
            result.errorCount,

        dryRun:
            result &&
            result.dryRun,

        durationMs:
            result &&
            result.durationMs
    };

    if (
        result &&
        result.status ===
            CLEANUP_STATUSES
                .partial &&
        typeof runtime.logger.warn ===
            "function"
    ) {
        runtime.logger.warn(
            "Cleanup completed partially.",
            metadata
        );

        return;
    }

    if (
        result &&
        result.status ===
            CLEANUP_STATUSES
                .failed &&
        typeof runtime.logger.error ===
            "function"
    ) {
        runtime.logger.error(
            "Cleanup failed.",
            metadata
        );

        return;
    }

    if (
        typeof runtime.logger.info ===
        "function"
    ) {
        runtime.logger.info(
            "Cleanup event.",
            metadata
        );
    } else if (
        typeof runtime.logger.debug ===
        "function"
    ) {
        runtime.logger.debug(
            "Cleanup event.",
            metadata
        );
    }
}

function logCleanupFailure(
    runtime,
    failure,
    options
) {
    const settings =
        options || {};

    if (
        !settings.log ||
        !runtime ||
        !runtime.logger ||
        typeof runtime.logger.error !==
            "function"
    ) {
        return;
    }

    runtime.logger.error(
        "Collection cleanup failed.",
        {
            collection:
                failure &&
                failure.collection,

            error:
                failure &&
                failure.error
        }
    );
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    createCleanupService,
    runCleanup,
    cleanupCollection,
    loadExpiredRecords,
    deleteCleanupRecords,
    deleteRecordsWithBatch,
    deleteRecordsSequentially,
    inspectExpiredRecords,
    sanitizeExpiredRecord,
    isRecordExpired,
    getNestedValue,
    createCleanupSummary,
    createCollectionCleanupResult,
    createCollectionCleanupFailure,
    calculateDuration,
    serializeCleanupError,
    normalizeCleanupStatus,
    normalizeCollection,
    normalizeCollections,
    normalizeFieldPath,
    normalizeDirection,
    normalizeBatchSize,
    normalizeQueryLimit,
    normalizePositiveInteger,
    normalizeNonNegativeInteger,
    normalizeCleanupOptions,
    assertCleanupRuntime,
    resolveNow,
    createDatabaseTimestamp,
    toMilliseconds,
    serializeTimestamp,
    logCleanupEvent,
    logCleanupFailure,
    constants: {
        DEFAULT_BATCH_SIZE,
        MAX_BATCH_SIZE,
        DEFAULT_QUERY_LIMIT,
        MAX_QUERY_LIMIT,
        DEFAULT_MAX_COLLECTIONS,
        DEFAULT_MAX_PASSES,
        DEFAULT_EXPIRATION_FIELD,
        DEFAULT_ORDER_FIELD,
        DEFAULT_DIRECTION,
        CLEANUP_STATUSES,
        DEFAULT_EXPIRING_COLLECTIONS
    }
};