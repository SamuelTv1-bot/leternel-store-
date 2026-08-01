"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   SCHEDULER SERVICE TEST SUITE
========================================================== */

const test =
    require("node:test");

const assert =
    require("node:assert/strict");

const {
    createSchedulerService,
    createSchedule,
    updateSchedule,
    normalizeScheduleUpdate,
    claimNextSchedule,
    loadScheduleCandidates,
    claimSchedule,
    isScheduleClaimable,
    compareScheduleCandidates,
    completeScheduleExecution,
    failScheduleExecution,
    pauseSchedule,
    resumeSchedule,
    cancelSchedule,
    setScheduleStatus,
    assertValidScheduleStatusChange,
    getSchedule,
    querySchedules,
    normalizeScheduleQuery,
    normalizeScheduleRecord,
    calculateNextRunAt,
    calculateResumeRunAt,
    shouldCompleteSchedule,
    assertScheduleOwnership,
    isRetryableScheduleError,
    resolveRetryDelay,
    sanitizeScheduleRecord,
    normalizeScheduleId,
    normalizeScheduleName,
    normalizeScheduleType,
    normalizeScheduleStatus,
    normalizeWorkerId,
    normalizeTimezone,
    normalizeScheduleTags,
    normalizeScheduleDate,
    normalizeScheduleOrderField,
    normalizeQueryLimit,
    normalizePositiveInteger,
    normalizeNonNegativeInteger,
    normalizePositiveNumber,
    normalizeOptionalPositiveInteger,
    normalizeOptionalString,
    normalizeCollection,
    normalizeSchedulerOptions,
    createScheduleId,
    generateLeaseToken,
    createScheduleFingerprint,
    hashScheduleValue,
    stableStringify,
    normalizeStableValue,
    assertSerializableScheduleValue,
    sanitizeScheduleMetadata,
    serializeScheduleError,
    createScheduleNotFoundError,
    createScheduleConflictError,
    assertSchedulerRuntime,
    resolveNow,
    createDatabaseTimestamp,
    toMilliseconds,
    serializeTimestamp,
    logScheduleEvent,
    constants
} = require(
    "../src/shared/scheduler-service"
);

const {
    ServiceError
} = require(
    "../src/shared/service-error"
);

/* ==========================================================
   TEST TIMESTAMP
========================================================== */

class TestTimestamp {
    constructor(milliseconds) {
        this.milliseconds =
            milliseconds;
    }

    toMillis() {
        return this.milliseconds;
    }

    toDate() {
        return new Date(
            this.milliseconds
        );
    }

    static fromMillis(
        milliseconds
    ) {
        return new TestTimestamp(
            milliseconds
        );
    }
}

/* ==========================================================
   CLONING
========================================================== */

function clone(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    if (
        value instanceof
        TestTimestamp
    ) {
        return TestTimestamp
            .fromMillis(
                value.toMillis()
            );
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
        return Buffer.from(
            value
        );
    }

    if (
        Array.isArray(value)
    ) {
        return value.map(
            clone
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
                        clone(
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
   QUERY HELPERS
========================================================== */

function getNestedValue(
    object,
    path
) {
    return String(path)
        .split(".")
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

function normalizeComparableValue(
    value
) {
    if (
        value &&
        typeof value.toMillis ===
            "function"
    ) {
        return value.toMillis();
    }

    return value;
}

function compareValues(
    left,
    operator,
    right
) {
    const normalizedLeft =
        normalizeComparableValue(
            left
        );

    const normalizedRight =
        normalizeComparableValue(
            right
        );

    switch (operator) {
        case "==":
            return (
                normalizedLeft ===
                normalizedRight
            );

        case ">=":
            return (
                normalizedLeft >=
                normalizedRight
            );

        case "<=":
            return (
                normalizedLeft <=
                normalizedRight
            );

        default:
            throw new Error(
                "Unsupported query operator: " +
                operator
            );
    }
}

/* ==========================================================
   FIRESTORE STUB
========================================================== */

function createFirestoreStub(
    initialDocuments
) {
    const documents =
        new Map();

    Object.entries(
        initialDocuments || {}
    ).forEach(
        function ([
            path,
            value
        ]) {
            documents.set(
                path,
                clone(value)
            );
        }
    );

    function createSnapshot(path) {
        return {
            exists:
                documents.has(path),

            id:
                path
                    .split("/")
                    .pop(),

            data:
                function () {
                    return documents.has(path)
                        ? clone(
                              documents.get(
                                  path
                              )
                          )
                        : undefined;
                }
        };
    }

    function createReference(
        collectionName,
        documentId
    ) {
        const path =
            collectionName +
            "/" +
            documentId;

        return {
            id:
                documentId,

            path:
                path,

            get:
                async function () {
                    return createSnapshot(
                        path
                    );
                },

            set:
                async function (
                    value,
                    options
                ) {
                    const stored =
                        options &&
                        options.merge
                            ? Object.assign(
                                  {},
                                  clone(
                                      documents.get(
                                          path
                                      ) || {}
                                  ),
                                  clone(value)
                              )
                            : clone(value);

                    documents.set(
                        path,
                        stored
                    );
                },

            delete:
                async function () {
                    documents.delete(
                        path
                    );
                }
        };
    }

    function createQuery(
        collectionName,
        state
    ) {
        const queryState =
            state || {
                filters:
                    [],

                order:
                    null,

                limit:
                    null
            };

        return {
            where:
                function (
                    field,
                    operator,
                    value
                ) {
                    return createQuery(
                        collectionName,
                        {
                            filters:
                                queryState
                                    .filters
                                    .concat([
                                        {
                                            field:
                                                field,

                                            operator:
                                                operator,

                                            value:
                                                value
                                        }
                                    ]),

                            order:
                                queryState.order,

                            limit:
                                queryState.limit
                        }
                    );
                },

            orderBy:
                function (
                    field,
                    direction
                ) {
                    return createQuery(
                        collectionName,
                        {
                            filters:
                                queryState.filters,

                            order: {
                                field:
                                    field,

                                direction:
                                    direction
                            },

                            limit:
                                queryState.limit
                        }
                    );
                },

            limit:
                function (count) {
                    return createQuery(
                        collectionName,
                        {
                            filters:
                                queryState.filters,

                            order:
                                queryState.order,

                            limit:
                                count
                        }
                    );
                },

            get:
                async function () {
                    let results =
                        Array.from(
                            documents.entries()
                        )
                            .filter(
                                function ([
                                    path
                                ]) {
                                    return path
                                        .startsWith(
                                            collectionName +
                                            "/"
                                        );
                                }
                            )
                            .map(
                                function ([
                                    path,
                                    value
                                ]) {
                                    return {
                                        path:
                                            path,

                                        value:
                                            clone(value)
                                    };
                                }
                            );

                    queryState.filters
                        .forEach(
                            function (
                                filter
                            ) {
                                results =
                                    results.filter(
                                        function (
                                            entry
                                        ) {
                                            return compareValues(
                                                getNestedValue(
                                                    entry.value,
                                                    filter.field
                                                ),
                                                filter.operator,
                                                filter.value
                                            );
                                        }
                                    );
                            }
                        );

                    if (
                        queryState.order
                    ) {
                        results.sort(
                            function (
                                first,
                                second
                            ) {
                                const left =
                                    normalizeComparableValue(
                                        getNestedValue(
                                            first.value,
                                            queryState
                                                .order
                                                .field
                                        )
                                    );

                                const right =
                                    normalizeComparableValue(
                                        getNestedValue(
                                            second.value,
                                            queryState
                                                .order
                                                .field
                                        )
                                    );

                                const multiplier =
                                    queryState
                                        .order
                                        .direction ===
                                    "desc"
                                        ? -1
                                        : 1;

                                if (
                                    left < right
                                ) {
                                    return -1 *
                                        multiplier;
                                }

                                if (
                                    left > right
                                ) {
                                    return 1 *
                                        multiplier;
                                }

                                return 0;
                            }
                        );
                    }

                    if (
                        Number.isInteger(
                            queryState.limit
                        )
                    ) {
                        results =
                            results.slice(
                                0,
                                queryState.limit
                            );
                    }

                    return {
                        docs:
                            results.map(
                                function (
                                    entry
                                ) {
                                    return {
                                        id:
                                            entry.path
                                                .split("/")
                                                .pop(),

                                        data:
                                            function () {
                                                return clone(
                                                    entry.value
                                                );
                                            }
                                    };
                                }
                            )
                    };
                }
        };
    }

    const db = {
        collection:
            function (
                collectionName
            ) {
                return Object.assign(
                    {},
                    createQuery(
                        collectionName
                    ),
                    {
                        doc:
                            function (
                                documentId
                            ) {
                                return createReference(
                                    collectionName,
                                    documentId
                                );
                            }
                    }
                );
            },

        runTransaction:
            async function (
                callback
            ) {
                const writes =
                    [];

                const transaction = {
                    get:
                        async function (
                            reference
                        ) {
                            return reference.get();
                        },

                    set:
                        function (
                            reference,
                            value,
                            options
                        ) {
                            writes.push({
                                reference:
                                    reference,

                                value:
                                    clone(value),

                                options:
                                    options
                            });
                        }
                };

                const result =
                    await callback(
                        transaction
                    );

                for (
                    const write of
                    writes
                ) {
                    await write
                        .reference
                        .set(
                            write.value,
                            write.options
                        );
                }

                return result;
            }
    };

    return {
        db:
            db,

        getDocument:
            function (path) {
                return documents.has(path)
                    ? clone(
                          documents.get(
                              path
                          )
                      )
                    : undefined;
            },

        hasDocument:
            function (path) {
                return documents.has(
                    path
                );
            }
    };
}

/* ==========================================================
   LOGGER STUB
========================================================== */

function createLoggerStub() {
    const entries =
        [];

    return {
        entries:
            entries,

        info:
            function (
                message,
                metadata
            ) {
                entries.push({
                    level:
                        "info",

                    message:
                        message,

                    metadata:
                        metadata
                });
            },

        debug:
            function (
                message,
                metadata
            ) {
                entries.push({
                    level:
                        "debug",

                    message:
                        message,

                    metadata:
                        metadata
                });
            },

        warn:
            function (
                message,
                metadata
            ) {
                entries.push({
                    level:
                        "warn",

                    message:
                        message,

                    metadata:
                        metadata
                });
            },

        error:
            function (
                message,
                metadata
            ) {
                entries.push({
                    level:
                        "error",

                    message:
                        message,

                    metadata:
                        metadata
                });
            }
    };
}

/* ==========================================================
   RUNTIME
========================================================== */

function createRuntime(
    options
) {
    const settings =
        options || {};

    const firestore =
        settings.firestore ||
        createFirestoreStub();

    return {
        db:
            firestore.db,

        Timestamp:
            settings.Timestamp ||
            TestTimestamp,

        now:
            settings.now ||
            function () {
                return 1000;
            },

        logger:
            settings.logger ||
            createLoggerStub()
    };
}

/* ==========================================================
   FIXTURES
========================================================== */

function schedulePath(id) {
    return (
        constants
            .SCHEDULE_COLLECTION +
        "/" +
        id
    );
}

function createStoredSchedule(
    overrides
) {
    return Object.assign(
        {
            id:
                "schedule-1",

            fingerprint:
                "fingerprint",

            name:
                "catalog.refresh",

            type:
                "interval",

            status:
                "active",

            timezone:
                "UTC",

            intervalMs:
                1000,

            payload: {
                catalogId:
                    "catalog-1"
            },

            metadata:
                {},

            tags:
                [],

            runCount:
                0,

            maxRuns:
                null,

            attempts:
                0,

            maxAttempts:
                5,

            workerId:
                null,

            leaseToken:
                null,

            lastResult:
                null,

            lastError:
                null,

            pauseReason:
                null,

            cancellationReason:
                null,

            createdAt:
                TestTimestamp
                    .fromMillis(
                        1000
                    ),

            updatedAt:
                TestTimestamp
                    .fromMillis(
                        1000
                    ),

            nextRunAt:
                TestTimestamp
                    .fromMillis(
                        1000
                    ),

            lastRunAt:
                null,

            claimedAt:
                null,

            leaseExpiresAt:
                null,

            pausedAt:
                null,

            completedAt:
                null,

            failedAt:
                null,

            cancelledAt:
                null,

            expiresAt:
                TestTimestamp
                    .fromMillis(
                        10000
                    ),

            schemaVersion:
                1
        },
        overrides || {}
    );
}

/* ==========================================================
   SERVICE FACTORY
========================================================== */

test(
    "createSchedulerService creates a frozen service",
    function () {
        const runtime =
            createRuntime();

        const service =
            createSchedulerService({
                runtime:
                    runtime,

                leaseMs:
                    5000,

                maxAttempts:
                    3
            });

        assert.equal(
            service.runtime,
            runtime
        );

        assert.equal(
            service.options.leaseMs,
            5000
        );

        assert.equal(
            service.options.maxAttempts,
            3
        );

        assert.equal(
            typeof service.create,
            "function"
        );

        assert.equal(
            typeof service.update,
            "function"
        );

        assert.equal(
            typeof service.claim,
            "function"
        );

        assert.equal(
            typeof service.complete,
            "function"
        );

        assert.equal(
            typeof service.fail,
            "function"
        );

        assert.equal(
            typeof service.pause,
            "function"
        );

        assert.equal(
            typeof service.resume,
            "function"
        );

        assert.equal(
            typeof service.cancel,
            "function"
        );

        assert.equal(
            typeof service.get,
            "function"
        );

        assert.equal(
            typeof service.query,
            "function"
        );

        assert.equal(
            Object.isFrozen(
                service
            ),
            true
        );
    }
);

/* ==========================================================
   OPTIONS
========================================================== */

test(
    "normalizeSchedulerOptions applies defaults",
    function () {
        const options =
            normalizeSchedulerOptions(
                {}
            );

        assert.equal(
            options.collection,
            constants
                .SCHEDULE_COLLECTION
        );

        assert.equal(
            options.defaultTimezone,
            constants
                .DEFAULT_TIMEZONE
        );

        assert.equal(
            options.defaultIntervalMs,
            constants
                .DEFAULT_INTERVAL_MS
        );

        assert.equal(
            options.leaseMs,
            constants
                .DEFAULT_LEASE_MS
        );

        assert.equal(
            options.retryDelayMs,
            constants
                .DEFAULT_RETRY_DELAY_MS
        );

        assert.equal(
            options.maxRetryDelayMs,
            constants
                .DEFAULT_MAX_RETRY_DELAY_MS
        );

        assert.equal(
            options.retryBackoffMultiplier,
            2
        );

        assert.equal(
            options.retryFailed,
            true
        );

        assert.equal(
            options.maxAttempts,
            constants
                .DEFAULT_MAX_ATTEMPTS
        );

        assert.equal(
            options.queryLimit,
            constants
                .DEFAULT_QUERY_LIMIT
        );

        assert.equal(
            options.claimBatchSize,
            constants
                .DEFAULT_CLAIM_BATCH_SIZE
        );

        assert.equal(
            options.retentionMs,
            constants
                .DEFAULT_RETENTION_MS
        );

        assert.equal(
            options.maxPayloadBytes,
            constants
                .DEFAULT_MAX_PAYLOAD_BYTES
        );

        assert.equal(
            options.maxResultBytes,
            constants
                .DEFAULT_MAX_RESULT_BYTES
        );

        assert.equal(
            options.preventDuplicates,
            true
        );

        assert.equal(
            options.disabled,
            false
        );

        assert.equal(
            options.log,
            true
        );
    }
);

test(
    "normalizeSchedulerOptions respects overrides",
    function () {
        const idResolver =
            function () {
                return "custom-id";
            };

        const retryResolver =
            function () {
                return false;
            };

        const retryDelayResolver =
            function () {
                return 2500;
            };

        const options =
            normalizeSchedulerOptions({
                collection:
                    "schedules",

                defaultTimezone:
                    "Africa/Lagos",

                defaultIntervalMs:
                    5000,

                leaseMs:
                    10000,

                retryDelayMs:
                    2000,

                maxRetryDelayMs:
                    10000,

                retryBackoffMultiplier:
                    3,

                retryFailed:
                    false,

                maxAttempts:
                    3,

                queryLimit:
                    25,

                claimBatchSize:
                    10,

                retentionMs:
                    5000,

                maxPayloadBytes:
                    1000,

                maxResultBytes:
                    2000,

                preventDuplicates:
                    false,

                disabled:
                    true,

                log:
                    false,

                idResolver:
                    idResolver,

                retryResolver:
                    retryResolver,

                retryDelayResolver:
                    retryDelayResolver,

                leaseToken:
                    "lease-1",

                requestId:
                    "req-1",

                correlationId:
                    "corr-1"
            });

        assert.equal(
            options.collection,
            "schedules"
        );

        assert.equal(
            options.defaultTimezone,
            "Africa/Lagos"
        );

        assert.equal(
            options.defaultIntervalMs,
            5000
        );

        assert.equal(
            options.leaseMs,
            10000
        );

        assert.equal(
            options.retryDelayMs,
            2000
        );

        assert.equal(
            options.maxRetryDelayMs,
            10000
        );

        assert.equal(
            options.retryBackoffMultiplier,
            3
        );

        assert.equal(
            options.retryFailed,
            false
        );

        assert.equal(
            options.maxAttempts,
            3
        );

        assert.equal(
            options.queryLimit,
            25
        );

        assert.equal(
            options.claimBatchSize,
            10
        );

        assert.equal(
            options.retentionMs,
            5000
        );

        assert.equal(
            options.maxPayloadBytes,
            1000
        );

        assert.equal(
            options.maxResultBytes,
            2000
        );

        assert.equal(
            options.preventDuplicates,
            false
        );

        assert.equal(
            options.disabled,
            true
        );

        assert.equal(
            options.log,
            false
        );

        assert.equal(
            options.idResolver,
            idResolver
        );

        assert.equal(
            options.retryResolver,
            retryResolver
        );

        assert.equal(
            options.retryDelayResolver,
            retryDelayResolver
        );

        assert.equal(
            options.leaseToken,
            "lease-1"
        );

        assert.equal(
            options.requestId,
            "req-1"
        );

        assert.equal(
            options.correlationId,
            "corr-1"
        );
    }
);

/* ==========================================================
   NORMALIZERS
========================================================== */

test(
    "schedule normalizers validate values",
    function () {
        assert.equal(
            normalizeScheduleId(
                " schedule-1 "
            ),
            "schedule-1"
        );

        assert.equal(
            normalizeScheduleName(
                " Refresh Catalog "
            ),
            "refresh.catalog"
        );

        assert.equal(
            normalizeScheduleType(
                "INTERVAL"
            ),
            "interval"
        );

        assert.equal(
            normalizeScheduleStatus(
                "ACTIVE"
            ),
            "active"
        );

        assert.equal(
            normalizeWorkerId(
                " worker-1 "
            ),
            "worker-1"
        );

        assert.equal(
            normalizeTimezone(
                " Africa/Lagos "
            ),
            "Africa/Lagos"
        );

        assert.throws(
            function () {
                normalizeScheduleId(
                    "schedules/one"
                );
            },
            /schedule ID is invalid/
        );

        assert.throws(
            function () {
                normalizeScheduleName(
                    ""
                );
            },
            /schedule name is invalid/
        );

        assert.throws(
            function () {
                normalizeScheduleType(
                    "cron"
                );
            },
            /schedule type is invalid/
        );

        assert.throws(
            function () {
                normalizeScheduleStatus(
                    "unknown"
                );
            },
            /schedule status is invalid/
        );

        assert.throws(
            function () {
                normalizeWorkerId(
                    ""
                );
            },
            /worker ID is required/
        );
    }
);

test(
    "schedule tags normalize and deduplicate",
    function () {
        assert.deepEqual(
            normalizeScheduleTags([
                "Catalog",
                " urgent ",
                "catalog",
                ""
            ]),
            [
                "catalog",
                "urgent"
            ]
        );

        assert.deepEqual(
            normalizeScheduleTags(
                "Inventory"
            ),
            [
                "inventory"
            ]
        );
    }
);

test(
    "number and query normalizers validate values",
    function () {
        assert.equal(
            normalizePositiveInteger(
                "5",
                1,
                "Value"
            ),
            5
        );

        assert.equal(
            normalizeNonNegativeInteger(
                0,
                1,
                "Value"
            ),
            0
        );

        assert.equal(
            normalizePositiveNumber(
                "1.5",
                1,
                "Value"
            ),
            1.5
        );

        assert.equal(
            normalizeOptionalPositiveInteger(
                null,
                "Maximum runs"
            ),
            null
        );

        assert.equal(
            normalizeOptionalPositiveInteger(
                5,
                "Maximum runs"
            ),
            5
        );

        assert.equal(
            normalizeQueryLimit(
                undefined
            ),
            100
        );

        assert.equal(
            normalizeQueryLimit(
                1000
            ),
            500
        );

        assert.throws(
            function () {
                normalizePositiveInteger(
                    0,
                    1,
                    "Value"
                );
            },
            /positive integer/
        );

        assert.throws(
            function () {
                normalizeNonNegativeInteger(
                    -1,
                    0,
                    "Value"
                );
            },
            /non-negative integer/
        );

        assert.throws(
            function () {
                normalizePositiveNumber(
                    0,
                    1,
                    "Value"
                );
            },
            /positive number/
        );
    }
);

test(
    "date, order, collection, and string normalizers work",
    function () {
        assert.equal(
            normalizeScheduleDate(
                1000,
                "Date"
            ),
            1000
        );

        assert.equal(
            normalizeScheduleOrderField(
                "runCount"
            ),
            "runCount"
        );

        assert.equal(
            normalizeScheduleOrderField(
                "invalid"
            ),
            "nextRunAt"
        );

        assert.equal(
            normalizeOptionalString(
                " value "
            ),
            "value"
        );

        assert.equal(
            normalizeOptionalString(
                ""
            ),
            null
        );

        assert.equal(
            normalizeCollection(
                "_schedules"
            ),
            "_schedules"
        );

        assert.throws(
            function () {
                normalizeScheduleDate(
                    "invalid",
                    "Date"
                );
            },
            /is invalid/
        );

        assert.throws(
            function () {
                normalizeCollection(
                    "internal/schedules"
                );
            },
            /Firestore collection name/
        );
    }
);

/* ==========================================================
   SERIALIZATION
========================================================== */

test(
    "stableStringify sorts object keys",
    function () {
        assert.equal(
            stableStringify({
                b:
                    2,

                a:
                    1
            }),
            '{"a":1,"b":2}'
        );
    }
);

test(
    "normalizeStableValue handles special values",
    function () {
        assert.deepEqual(
            normalizeStableValue({
                date:
                    new Date(
                        "2026-07-20T09:00:00.000Z"
                    ),

                buffer:
                    Buffer.from(
                        "hello"
                    ),

                bigint:
                    10n,

                missing:
                    undefined
            }),
            {
                bigint:
                    "10",

                buffer:
                    "aGVsbG8=",

                date:
                    "2026-07-20T09:00:00.000Z",

                missing:
                    null
            }
        );
    }
);

test(
    "normalizeStableValue rejects circular references",
    function () {
        const value =
            {};

        value.self =
            value;

        assert.throws(
            function () {
                normalizeStableValue(
                    value
                );
            },
            /circular reference/
        );
    }
);

test(
    "assertSerializableScheduleValue validates size",
    function () {
        assert.equal(
            assertSerializableScheduleValue(
                {
                    catalogId:
                        "catalog-1"
                },
                1000,
                "Schedule payload"
            ),
            true
        );

        assert.throws(
            function () {
                assertSerializableScheduleValue(
                    {
                        value:
                            "x".repeat(
                                100
                            )
                    },
                    10,
                    "Schedule payload"
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "resource-exhausted"
                );

                assert.equal(
                    error.status,
                    413
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   IDS AND FINGERPRINTS
========================================================== */

test(
    "createScheduleId uses custom resolver",
    function () {
        assert.equal(
            createScheduleId(
                {},
                {
                    idResolver:
                        function () {
                            return "custom-schedule";
                        }
                },
                1000
            ),
            "custom-schedule"
        );
    }
);

test(
    "createScheduleId hashes idempotency key",
    function () {
        const first =
            createScheduleId(
                {
                    idempotencyKey:
                        "catalog-refresh"
                },
                {},
                1000
            );

        const second =
            createScheduleId(
                {
                    idempotencyKey:
                        "catalog-refresh"
                },
                {},
                2000
            );

        assert.equal(
            first,
            second
        );

        assert.match(
            first,
            /^[a-f0-9]{64}$/
        );
    }
);

test(
    "createScheduleId generates unique values",
    function () {
        const first =
            createScheduleId(
                {},
                {},
                1000
            );

        const second =
            createScheduleId(
                {},
                {},
                1000
            );

        assert.notEqual(
            first,
            second
        );
    }
);

test(
    "fingerprint and hash helpers are deterministic",
    function () {
        assert.equal(
            createScheduleFingerprint({
                b:
                    2,

                a:
                    1
            }),
            createScheduleFingerprint({
                a:
                    1,

                b:
                    2
            })
        );

        assert.match(
            hashScheduleValue(
                "schedule"
            ),
            /^[a-f0-9]{64}$/
        );

        assert.equal(
            typeof generateLeaseToken(),
            "string"
        );
    }
);

/* ==========================================================
   RECORD NORMALIZATION
========================================================== */

test(
    "normalizeScheduleRecord creates interval schedule",
    function () {
        const record =
            normalizeScheduleRecord(
                {
                    id:
                        "schedule-1",

                    name:
                        "catalog.refresh",

                    type:
                        "interval",

                    intervalMs:
                        5000,

                    timezone:
                        "Africa/Lagos",

                    payload: {
                        catalogId:
                            "catalog-1"
                    },

                    metadata: {
                        source:
                            "admin"
                    },

                    tags: [
                        "Catalog"
                    ],

                    maxRuns:
                        10,

                    maxAttempts:
                        3,

                    nextRunAt:
                        2000
                },
                {
                    retentionMs:
                        5000
                },
                createRuntime({
                    now:
                        function () {
                            return 1000;
                        }
                })
            );

        assert.equal(
            record.id,
            "schedule-1"
        );

        assert.equal(
            record.name,
            "catalog.refresh"
        );

        assert.equal(
            record.type,
            "interval"
        );

        assert.equal(
            record.status,
            "active"
        );

        assert.equal(
            record.timezone,
            "Africa/Lagos"
        );

        assert.equal(
            record.intervalMs,
            5000
        );

        assert.equal(
            record.runCount,
            0
        );

        assert.equal(
            record.maxRuns,
            10
        );

        assert.equal(
            record.maxAttempts,
            3
        );

        assert.equal(
            record.nextRunAt.toMillis(),
            2000
        );

        assert.equal(
            record.expiresAt.toMillis(),
            6000
        );

        assert.match(
            record.fingerprint,
            /^[a-f0-9]{64}$/
        );
    }
);

test(
    "normalizeScheduleRecord creates one-time schedule",
    function () {
        const record =
            normalizeScheduleRecord(
                {
                    id:
                        "schedule-1",

                    name:
                        "email.send",

                    runAt:
                        3000,

                    payload:
                        {}
                },
                {},
                createRuntime({
                    now:
                        function () {
                            return 1000;
                        }
                })
            );

        assert.equal(
            record.type,
            "once"
        );

        assert.equal(
            record.intervalMs,
            null
        );

        assert.equal(
            record.nextRunAt.toMillis(),
            3000
        );
    }
);

test(
    "normalizeScheduleRecord rejects invalid input",
    function () {
        assert.throws(
            function () {
                normalizeScheduleRecord(
                    "invalid",
                    {},
                    createRuntime()
                );
            },
            /must be an object/
        );
    }
);

/* ==========================================================
   CREATE SCHEDULE
========================================================== */

test(
    "createSchedule stores schedule",
    async function () {
        const firestore =
            createFirestoreStub();

        const result =
            await createSchedule(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    id:
                        "schedule-1",

                    name:
                        "catalog.refresh",

                    type:
                        "interval",

                    intervalMs:
                        5000,

                    payload:
                        {}
                },
                {
                    now:
                        function () {
                            return 1000;
                        }
                }
            );

        assert.equal(
            result.created,
            true
        );

        assert.equal(
            result.duplicate,
            false
        );

        assert.equal(
            result.disabled,
            false
        );

        const stored =
            firestore.getDocument(
                schedulePath(
                    "schedule-1"
                )
            );

        assert.equal(
            stored.status,
            "active"
        );

        assert.equal(
            stored.name,
            "catalog.refresh"
        );
    }
);

test(
    "createSchedule detects duplicate fingerprint",
    async function () {
        const runtime =
            createRuntime();

        const input = {
            id:
                "schedule-1",

            name:
                "catalog.refresh",

            intervalMs:
                5000,

            nextRunAt:
                1000,

            payload:
                {}
        };

        const options = {
            now:
                function () {
                    return 1000;
                }
        };

        const first =
            await createSchedule(
                runtime,
                input,
                options
            );

        const second =
            await createSchedule(
                runtime,
                input,
                options
            );

        assert.equal(
            first.created,
            true
        );

        assert.equal(
            second.created,
            false
        );

        assert.equal(
            second.duplicate,
            true
        );
    }
);

test(
    "createSchedule rejects conflicting schedule ID",
    async function () {
        const runtime =
            createRuntime();

        await createSchedule(
            runtime,
            {
                id:
                    "schedule-1",

                name:
                    "catalog.refresh",

                payload:
                    {}
            },
            {
                now:
                    function () {
                        return 1000;
                    }
            }
        );

        await assert.rejects(
            async function () {
                await createSchedule(
                    runtime,
                    {
                        id:
                            "schedule-1",

                        name:
                            "inventory.refresh",

                        payload:
                            {}
                    },
                    {
                        now:
                            function () {
                                return 1000;
                            }
                    }
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "already-exists"
                );

                assert.equal(
                    error.status,
                    409
                );

                return true;
            }
        );
    }
);

test(
    "createSchedule returns disabled result",
    async function () {
        const result =
            await createSchedule(
                null,
                {
                    id:
                        "schedule-1",

                    name:
                        "catalog.refresh",

                    payload:
                        {}
                },
                {
                    disabled:
                        true,

                    now:
                        function () {
                            return 1000;
                        }
                }
            );

        assert.equal(
            result.created,
            false
        );

        assert.equal(
            result.disabled,
            true
        );

        assert.equal(
            result.schedule.id,
            "schedule-1"
        );
    }
);

/* ==========================================================
   UPDATE
========================================================== */

test(
    "normalizeScheduleUpdate builds safe update",
    function () {
        const update =
            normalizeScheduleUpdate(
                createStoredSchedule(),
                {
                    name:
                        "inventory.refresh",

                    payload: {
                        inventoryId:
                            "inventory-1"
                    },

                    metadata: {
                        source:
                            "admin"
                    },

                    tags: [
                        "Inventory"
                    ],

                    timezone:
                        "Africa/Lagos",

                    intervalMs:
                        5000,

                    maxRuns:
                        10,

                    nextRunAt:
                        3000
                },
                normalizeSchedulerOptions(
                    {}
                ),
                {
                    Timestamp:
                        TestTimestamp
                },
                2000
            );

        assert.equal(
            update.name,
            "inventory.refresh"
        );

        assert.equal(
            update.type,
            "interval"
        );

        assert.equal(
            update.intervalMs,
            5000
        );

        assert.equal(
            update.maxRuns,
            10
        );

        assert.equal(
            update.nextRunAt.toMillis(),
            3000
        );

        assert.equal(
            update.updatedAt.toMillis(),
            2000
        );
    }
);

test(
    "updateSchedule updates active schedule",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    schedulePath(
                        "schedule-1"
                    )
                ]:
                    createStoredSchedule()
            });

        const result =
            await updateSchedule(
                createRuntime({
                    firestore:
                        firestore
                }),
                "schedule-1",
                {
                    name:
                        "inventory.refresh",

                    intervalMs:
                        5000,

                    maxRuns:
                        10
                },
                {
                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            result.updated,
            true
        );

        assert.equal(
            result.schedule.name,
            "inventory.refresh"
        );

        assert.equal(
            result.schedule.intervalMs,
            5000
        );

        assert.equal(
            result.schedule.maxRuns,
            10
        );
    }
);

test(
    "updateSchedule rejects terminal schedules",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    schedulePath(
                        "schedule-1"
                    )
                ]:
                    createStoredSchedule({
                        status:
                            "completed"
                    })
            });

        await assert.rejects(
            async function () {
                await updateSchedule(
                    createRuntime({
                        firestore:
                            firestore
                    }),
                    "schedule-1",
                    {
                        name:
                            "updated"
                    },
                    {}
                );
            },
            /terminal schedule cannot be updated/
        );
    }
);

test(
    "updateSchedule rejects missing schedules",
    async function () {
        await assert.rejects(
            async function () {
                await updateSchedule(
                    createRuntime(),
                    "missing",
                    {
                        name:
                            "updated"
                    },
                    {}
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "not-found"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   RUN CALCULATIONS
========================================================== */

test(
    "calculateNextRunAt returns null for once schedule",
    function () {
        assert.equal(
            calculateNextRunAt(
                {
                    type:
                        "once",

                    nextRunAt:
                        TestTimestamp
                            .fromMillis(
                                1000
                            )
                },
                2000
            ),
            null
        );
    }
);

test(
    "calculateNextRunAt advances interval into future",
    function () {
        assert.equal(
            calculateNextRunAt(
                {
                    type:
                        "interval",

                    intervalMs:
                        1000,

                    nextRunAt:
                        TestTimestamp
                            .fromMillis(
                                1000
                            )
                },
                3500
            ),
            4000
        );
    }
);

test(
    "calculateResumeRunAt preserves future run",
    function () {
        assert.equal(
            calculateResumeRunAt(
                {
                    type:
                        "interval",

                    intervalMs:
                        1000,

                    nextRunAt:
                        TestTimestamp
                            .fromMillis(
                                5000
                            )
                },
                2000
            ),
            5000
        );
    }
);

test(
    "calculateResumeRunAt reschedules overdue schedules",
    function () {
        assert.equal(
            calculateResumeRunAt(
                {
                    type:
                        "interval",

                    intervalMs:
                        1000,

                    nextRunAt:
                        TestTimestamp
                            .fromMillis(
                                1000
                            )
                },
                2500
            ),
            3000
        );

        assert.equal(
            calculateResumeRunAt(
                {
                    type:
                        "once",

                    nextRunAt:
                        TestTimestamp
                            .fromMillis(
                                1000
                            )
                },
                2500
            ),
            2500
        );
    }
);

test(
    "shouldCompleteSchedule handles once and max runs",
    function () {
        assert.equal(
            shouldCompleteSchedule(
                {
                    type:
                        "once"
                },
                1
            ),
            true
        );

        assert.equal(
            shouldCompleteSchedule(
                {
                    type:
                        "interval",

                    maxRuns:
                        3
                },
                3
            ),
            true
        );

        assert.equal(
            shouldCompleteSchedule(
                {
                    type:
                        "interval",

                    maxRuns:
                        3
                },
                2
            ),
            false
        );

        assert.equal(
            shouldCompleteSchedule(
                {
                    type:
                        "interval",

                    maxRuns:
                        null
                },
                100
            ),
            false
        );
    }
);

/* ==========================================================
   CLAIMABILITY
========================================================== */

test(
    "isScheduleClaimable accepts due active schedule",
    function () {
        assert.equal(
            isScheduleClaimable(
                createStoredSchedule({
                    status:
                        "active",

                    nextRunAt:
                        TestTimestamp
                            .fromMillis(
                                1000
                            )
                }),
                2000
            ),
            true
        );
    }
);

test(
    "isScheduleClaimable rejects future active schedule",
    function () {
        assert.equal(
            isScheduleClaimable(
                createStoredSchedule({
                    nextRunAt:
                        TestTimestamp
                            .fromMillis(
                                3000
                            )
                }),
                2000
            ),
            false
        );
    }
);

test(
    "isScheduleClaimable allows expired processing lease",
    function () {
        assert.equal(
            isScheduleClaimable(
                createStoredSchedule({
                    status:
                        "processing",

                    leaseExpiresAt:
                        TestTimestamp
                            .fromMillis(
                                1000
                            )
                }),
                2000
            ),
            true
        );

        assert.equal(
            isScheduleClaimable(
                createStoredSchedule({
                    status:
                        "processing",

                    leaseExpiresAt:
                        TestTimestamp
                            .fromMillis(
                                3000
                            )
                }),
                2000
            ),
            false
        );
    }
);

test(
    "compareScheduleCandidates orders by next run then creation",
    function () {
        const schedules = [
            createStoredSchedule({
                id:
                    "later",

                nextRunAt:
                    TestTimestamp
                        .fromMillis(
                            3000
                        )
            }),

            createStoredSchedule({
                id:
                    "earlier",

                nextRunAt:
                    TestTimestamp
                        .fromMillis(
                            1000
                        )
            })
        ];

        schedules.sort(
            compareScheduleCandidates
        );

        assert.deepEqual(
            schedules.map(
                function (
                    schedule
                ) {
                    return schedule.id;
                }
            ),
            [
                "earlier",
                "later"
            ]
        );
    }
);

/* ==========================================================
   CLAIM
========================================================== */

test(
    "claimSchedule claims due schedule",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    schedulePath(
                        "schedule-1"
                    )
                ]:
                    createStoredSchedule()
            });

        const result =
            await claimSchedule(
                createRuntime({
                    firestore:
                        firestore
                }),
                "schedule-1",
                "worker-1",
                {
                    now:
                        function () {
                            return 2000;
                        },

                    leaseMs:
                        5000
                }
            );

        assert.equal(
            result.status,
            "processing"
        );

        assert.equal(
            result.workerId,
            "worker-1"
        );

        assert.equal(
            result.attempts,
            1
        );

        assert.equal(
            result.claimedAt,
            new Date(
                2000
            ).toISOString()
        );

        assert.equal(
            result.leaseExpiresAt,
            new Date(
                7000
            ).toISOString()
        );

        assert.equal(
            typeof result.leaseToken,
            "string"
        );
    }
);

test(
    "claimSchedule returns null when unavailable",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    schedulePath(
                        "schedule-1"
                    )
                ]:
                    createStoredSchedule({
                        nextRunAt:
                            TestTimestamp
                                .fromMillis(
                                    5000
                                )
                    })
            });

        const result =
            await claimSchedule(
                createRuntime({
                    firestore:
                        firestore
                }),
                "schedule-1",
                "worker-1",
                {
                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            result,
            null
        );
    }
);

test(
    "claimNextSchedule selects earliest due schedule",
    async function () {
        const firestore =
            createFirestoreStub({
                "_schedules/one":
                    createStoredSchedule({
                        id:
                            "one",

                        nextRunAt:
                            TestTimestamp
                                .fromMillis(
                                    2000
                                )
                    }),

                "_schedules/two":
                    createStoredSchedule({
                        id:
                            "two",

                        nextRunAt:
                            TestTimestamp
                                .fromMillis(
                                    1000
                                )
                    }),

                "_schedules/future":
                    createStoredSchedule({
                        id:
                            "future",

                        nextRunAt:
                            TestTimestamp
                                .fromMillis(
                                    5000
                                )
                    })
            });

        const result =
            await claimNextSchedule(
                createRuntime({
                    firestore:
                        firestore
                }),
                "worker-1",
                {
                    now:
                        function () {
                            return 3000;
                        },

                    leaseMs:
                        5000
                }
            );

        assert.equal(
            result.id,
            "two"
        );

        assert.equal(
            result.status,
            "processing"
        );
    }
);

test(
    "claimNextSchedule returns null when disabled",
    async function () {
        assert.equal(
            await claimNextSchedule(
                null,
                "worker-1",
                {
                    disabled:
                        true
                }
            ),
            null
        );
    }
);

/* ==========================================================
   OWNERSHIP
========================================================== */

test(
    "assertScheduleOwnership validates worker and token",
    function () {
        assert.equal(
            assertScheduleOwnership(
                {
                    status:
                        "processing",

                    workerId:
                        "worker-1",

                    leaseToken:
                        "lease-1"
                },
                "worker-1",
                "lease-1"
            ),
            true
        );

        assert.throws(
            function () {
                assertScheduleOwnership(
                    {
                        status:
                            "active"
                    },
                    "worker-1"
                );
            },
            /not currently being processed/
        );

        assert.throws(
            function () {
                assertScheduleOwnership(
                    {
                        status:
                            "processing",

                        workerId:
                            "worker-2"
                    },
                    "worker-1"
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "permission-denied"
                );

                return true;
            }
        );

        assert.throws(
            function () {
                assertScheduleOwnership(
                    {
                        status:
                            "processing",

                        workerId:
                            "worker-1",

                        leaseToken:
                            "old"
                    },
                    "worker-1",
                    "new"
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "aborted"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   COMPLETE EXECUTION
========================================================== */

test(
    "completeScheduleExecution reschedules interval schedule",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    schedulePath(
                        "schedule-1"
                    )
                ]:
                    createStoredSchedule({
                        status:
                            "processing",

                        workerId:
                            "worker-1",

                        leaseToken:
                            "lease-1",

                        attempts:
                            1,

                        intervalMs:
                            1000,

                        nextRunAt:
                            TestTimestamp
                                .fromMillis(
                                    1000
                                )
                    })
            });

        const result =
            await completeScheduleExecution(
                createRuntime({
                    firestore:
                        firestore
                }),
                "schedule-1",
                "worker-1",
                {
                    refreshed:
                        true
                },
                {
                    leaseToken:
                        "lease-1",

                    now:
                        function () {
                            return 2500;
                        }
                }
            );

        assert.equal(
            result.completed,
            true
        );

        assert.equal(
            result.scheduleFinished,
            false
        );

        assert.equal(
            result.schedule.status,
            "active"
        );

        assert.equal(
            result.schedule.runCount,
            1
        );

        assert.equal(
            result.schedule.attempts,
            0
        );

        assert.equal(
            result.schedule.nextRunAt,
            new Date(
                3000
            ).toISOString()
        );

        assert.deepEqual(
            result.schedule.lastResult,
            {
                refreshed:
                    true
            }
        );
    }
);

test(
    "completeScheduleExecution finishes one-time schedule",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    schedulePath(
                        "schedule-1"
                    )
                ]:
                    createStoredSchedule({
                        type:
                            "once",

                        intervalMs:
                            null,

                        status:
                            "processing",

                        workerId:
                            "worker-1",

                        leaseToken:
                            "lease-1",

                        attempts:
                            1
                    })
            });

        const result =
            await completeScheduleExecution(
                createRuntime({
                    firestore:
                        firestore
                }),
                "schedule-1",
                "worker-1",
                {
                    sent:
                        true
                },
                {
                    leaseToken:
                        "lease-1",

                    now:
                        function () {
                            return 3000;
                        }
                }
            );

        assert.equal(
            result.scheduleFinished,
            true
        );

        assert.equal(
            result.schedule.status,
            "completed"
        );

        assert.equal(
            result.schedule.nextRunAt,
            null
        );

        assert.equal(
            result.schedule.completedAt,
            new Date(
                3000
            ).toISOString()
        );
    }
);

test(
    "completeScheduleExecution finishes max-runs interval",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    schedulePath(
                        "schedule-1"
                    )
                ]:
                    createStoredSchedule({
                        status:
                            "processing",

                        workerId:
                            "worker-1",

                        leaseToken:
                            "lease-1",

                        runCount:
                            2,

                        maxRuns:
                            3,

                        attempts:
                            1
                    })
            });

        const result =
            await completeScheduleExecution(
                createRuntime({
                    firestore:
                        firestore
                }),
                "schedule-1",
                "worker-1",
                {},
                {
                    leaseToken:
                        "lease-1",

                    now:
                        function () {
                            return 3000;
                        }
                }
            );

        assert.equal(
            result.scheduleFinished,
            true
        );

        assert.equal(
            result.schedule.runCount,
            3
        );

        assert.equal(
            result.schedule.status,
            "completed"
        );
    }
);

/* ==========================================================
   RETRY
========================================================== */

test(
    "isRetryableScheduleError respects metadata",
    function () {
        assert.equal(
            isRetryableScheduleError(
                {
                    retryable:
                        false
                },
                {}
            ),
            false
        );

        assert.equal(
            isRetryableScheduleError(
                new Error(
                    "Failure."
                ),
                {
                    retryFailed:
                        true
                }
            ),
            true
        );

        assert.equal(
            isRetryableScheduleError(
                new Error(
                    "Failure."
                ),
                {
                    retryResolver:
                        function () {
                            return false;
                        }
                }
            ),
            false
        );
    }
);

test(
    "resolveRetryDelay uses exponential backoff",
    function () {
        assert.equal(
            resolveRetryDelay(
                1,
                null,
                {
                    retryDelayMs:
                        1000,

                    retryBackoffMultiplier:
                        2,

                    maxRetryDelayMs:
                        10000
                }
            ),
            1000
        );

        assert.equal(
            resolveRetryDelay(
                3,
                null,
                {
                    retryDelayMs:
                        1000,

                    retryBackoffMultiplier:
                        2,

                    maxRetryDelayMs:
                        10000
                }
            ),
            4000
        );

        assert.equal(
            resolveRetryDelay(
                10,
                null,
                {
                    retryDelayMs:
                        1000,

                    retryBackoffMultiplier:
                        2,

                    maxRetryDelayMs:
                        5000
                }
            ),
            5000
        );
    }
);

/* ==========================================================
   FAIL EXECUTION
========================================================== */

test(
    "failScheduleExecution schedules retry",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    schedulePath(
                        "schedule-1"
                    )
                ]:
                    createStoredSchedule({
                        status:
                            "processing",

                        workerId:
                            "worker-1",

                        leaseToken:
                            "lease-1",

                        attempts:
                            1,

                        maxAttempts:
                            3
                    })
            });

        const error =
            new Error(
                "Provider unavailable."
            );

        error.retryable =
            true;

        const result =
            await failScheduleExecution(
                createRuntime({
                    firestore:
                        firestore
                }),
                "schedule-1",
                "worker-1",
                error,
                {
                    leaseToken:
                        "lease-1",

                    retryDelayMs:
                        1000,

                    retryBackoffMultiplier:
                        2,

                    maxRetryDelayMs:
                        10000,

                    now:
                        function () {
                            return 3000;
                        }
                }
            );

        assert.equal(
            result.failed,
            false
        );

        assert.equal(
            result.retryScheduled,
            true
        );

        assert.equal(
            result.retryDelayMs,
            1000
        );

        assert.equal(
            result.schedule.status,
            "active"
        );

        assert.equal(
            result.schedule.nextRunAt,
            new Date(
                4000
            ).toISOString()
        );

        assert.equal(
            result.schedule.workerId,
            null
        );
    }
);

test(
    "failScheduleExecution permanently fails exhausted schedule",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    schedulePath(
                        "schedule-1"
                    )
                ]:
                    createStoredSchedule({
                        status:
                            "processing",

                        workerId:
                            "worker-1",

                        leaseToken:
                            "lease-1",

                        attempts:
                            3,

                        maxAttempts:
                            3
                    })
            });

        const result =
            await failScheduleExecution(
                createRuntime({
                    firestore:
                        firestore
                }),
                "schedule-1",
                "worker-1",
                new Error(
                    "Failure."
                ),
                {
                    leaseToken:
                        "lease-1",

                    now:
                        function () {
                            return 3000;
                        }
                }
            );

        assert.equal(
            result.failed,
            true
        );

        assert.equal(
            result.retryScheduled,
            false
        );

        assert.equal(
            result.schedule.status,
            "failed"
        );

        assert.equal(
            result.schedule.failedAt,
            new Date(
                3000
            ).toISOString()
        );
    }
);

/* ==========================================================
   STATUS CHANGES
========================================================== */

test(
    "assertValidScheduleStatusChange accepts valid transitions",
    function () {
        assert.equal(
            assertValidScheduleStatusChange(
                "active",
                "paused"
            ),
            true
        );

        assert.equal(
            assertValidScheduleStatusChange(
                "paused",
                "active"
            ),
            true
        );

        assert.equal(
            assertValidScheduleStatusChange(
                "active",
                "active"
            ),
            true
        );
    }
);

test(
    "assertValidScheduleStatusChange rejects invalid transitions",
    function () {
        assert.throws(
            function () {
                assertValidScheduleStatusChange(
                    "active",
                    "completed"
                );
            },
            /transition is invalid/
        );

        assert.throws(
            function () {
                assertValidScheduleStatusChange(
                    "completed",
                    "active"
                );
            },
            /terminal schedule/
        );
    }
);

test(
    "pauseSchedule pauses active schedule",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    schedulePath(
                        "schedule-1"
                    )
                ]:
                    createStoredSchedule()
            });

        const result =
            await pauseSchedule(
                createRuntime({
                    firestore:
                        firestore
                }),
                "schedule-1",
                "Maintenance.",
                {
                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            result.status,
            "paused"
        );

        assert.equal(
            result.schedule.pauseReason,
            "Maintenance."
        );

        assert.equal(
            result.schedule.pausedAt,
            new Date(
                2000
            ).toISOString()
        );
    }
);

test(
    "resumeSchedule reactivates paused schedule",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    schedulePath(
                        "schedule-1"
                    )
                ]:
                    createStoredSchedule({
                        status:
                            "paused",

                        nextRunAt:
                            TestTimestamp
                                .fromMillis(
                                    1000
                                ),

                        pausedAt:
                            TestTimestamp
                                .fromMillis(
                                    1500
                                ),

                        pauseReason:
                            "Maintenance."
                    })
            });

        const result =
            await resumeSchedule(
                createRuntime({
                    firestore:
                        firestore
                }),
                "schedule-1",
                {
                    now:
                        function () {
                            return 2500;
                        }
                }
            );

        assert.equal(
            result.status,
            "active"
        );

        assert.equal(
            result.schedule.nextRunAt,
            new Date(
                3000
            ).toISOString()
        );
    }
);

test(
    "cancelSchedule cancels schedule",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    schedulePath(
                        "schedule-1"
                    )
                ]:
                    createStoredSchedule()
            });

        const result =
            await cancelSchedule(
                createRuntime({
                    firestore:
                        firestore
                }),
                "schedule-1",
                "No longer needed.",
                {
                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            result.status,
            "cancelled"
        );

        assert.equal(
            result.schedule
                .cancellationReason,
            "No longer needed."
        );

        assert.equal(
            result.schedule.cancelledAt,
            new Date(
                2000
            ).toISOString()
        );
    }
);

/* ==========================================================
   GET
========================================================== */

test(
    "getSchedule returns stored schedule",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    schedulePath(
                        "schedule-1"
                    )
                ]:
                    createStoredSchedule()
            });

        const result =
            await getSchedule(
                createRuntime({
                    firestore:
                        firestore
                }),
                "schedule-1"
            );

        assert.equal(
            result.id,
            "schedule-1"
        );

        assert.equal(
            result.status,
            "active"
        );

        assert.equal(
            result.createdAt,
            new Date(
                1000
            ).toISOString()
        );
    }
);

test(
    "getSchedule returns null for missing schedule",
    async function () {
        assert.equal(
            await getSchedule(
                createRuntime(),
                "missing"
            ),
            null
        );
    }
);

test(
    "getSchedule returns null when disabled",
    async function () {
        assert.equal(
            await getSchedule(
                null,
                "schedule-1",
                {
                    disabled:
                        true
                }
            ),
            null
        );
    }
);

/* ==========================================================
   QUERY
========================================================== */

test(
    "normalizeScheduleQuery normalizes filters",
    function () {
        assert.deepEqual(
            normalizeScheduleQuery(
                {
                    status:
                        "ACTIVE",

                    type:
                        "INTERVAL",

                    name:
                        "Refresh Catalog",

                    workerId:
                        " worker-1 ",

                    nextRunBefore:
                        3000,

                    createdAfter:
                        1000,

                    orderBy:
                        "runCount",

                    direction:
                        "DESC",

                    limit:
                        25
                },
                {}
            ),
            {
                status:
                    "active",

                type:
                    "interval",

                name:
                    "refresh.catalog",

                workerId:
                    "worker-1",

                nextRunBefore:
                    3000,

                createdAfter:
                    1000,

                orderBy:
                    "runCount",

                direction:
                    "desc",

                limit:
                    25
            }
        );
    }
);

test(
    "querySchedules filters and orders schedules",
    async function () {
        const firestore =
            createFirestoreStub({
                "_schedules/one":
                    createStoredSchedule({
                        id:
                            "one",

                        status:
                            "active",

                        type:
                            "interval",

                        name:
                            "catalog.refresh",

                        nextRunAt:
                            TestTimestamp
                                .fromMillis(
                                    1000
                                )
                    }),

                "_schedules/two":
                    createStoredSchedule({
                        id:
                            "two",

                        status:
                            "active",

                        type:
                            "interval",

                        name:
                            "catalog.refresh",

                        nextRunAt:
                            TestTimestamp
                                .fromMillis(
                                    2000
                                )
                    }),

                "_schedules/three":
                    createStoredSchedule({
                        id:
                            "three",

                        status:
                            "paused",

                        name:
                            "inventory.refresh",

                        nextRunAt:
                            TestTimestamp
                                .fromMillis(
                                    3000
                                )
                    })
            });

        const results =
            await querySchedules(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    status:
                        "active",

                    type:
                        "interval",

                    name:
                        "catalog.refresh",

                    direction:
                        "desc"
                },
                {}
            );

        assert.deepEqual(
            results.map(
                function (
                    schedule
                ) {
                    return schedule.id;
                }
            ),
            [
                "two",
                "one"
            ]
        );
    }
);

test(
    "querySchedules supports date filters",
    async function () {
        const firestore =
            createFirestoreStub({
                "_schedules/one":
                    createStoredSchedule({
                        id:
                            "one",

                        createdAt:
                            TestTimestamp
                                .fromMillis(
                                    1000
                                ),

                        nextRunAt:
                            TestTimestamp
                                .fromMillis(
                                    2000
                                )
                    }),

                "_schedules/two":
                    createStoredSchedule({
                        id:
                            "two",

                        createdAt:
                            TestTimestamp
                                .fromMillis(
                                    3000
                                ),

                        nextRunAt:
                            TestTimestamp
                                .fromMillis(
                                    4000
                                )
                    })
            });

        const results =
            await querySchedules(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    createdAfter:
                        2000,

                    nextRunBefore:
                        5000
                },
                {}
            );

        assert.deepEqual(
            results.map(
                function (
                    schedule
                ) {
                    return schedule.id;
                }
            ),
            [
                "two"
            ]
        );
    }
);

test(
    "querySchedules returns empty list when disabled",
    async function () {
        assert.deepEqual(
            await querySchedules(
                null,
                {},
                {
                    disabled:
                        true
                }
            ),
            []
        );
    }
);

/* ==========================================================
   SANITIZATION
========================================================== */

test(
    "sanitizeScheduleRecord serializes timestamps",
    function () {
        const result =
            sanitizeScheduleRecord(
                createStoredSchedule({
                    lastRunAt:
                        TestTimestamp
                            .fromMillis(
                                2000
                            ),

                    completedAt:
                        TestTimestamp
                            .fromMillis(
                                3000
                            )
                })
            );

        assert.equal(
            result.createdAt,
            new Date(
                1000
            ).toISOString()
        );

        assert.equal(
            result.lastRunAt,
            new Date(
                2000
            ).toISOString()
        );

        assert.equal(
            result.completedAt,
            new Date(
                3000
            ).toISOString()
        );
    }
);

test(
    "sanitizeScheduleMetadata preserves objects and wraps primitives",
    function () {
        assert.deepEqual(
            sanitizeScheduleMetadata({
                source:
                    "admin"
            }),
            {
                source:
                    "admin"
            }
        );

        assert.deepEqual(
            sanitizeScheduleMetadata(
                "admin"
            ),
            {
                value:
                    "admin"
            }
        );

        assert.deepEqual(
            sanitizeScheduleMetadata(
                null
            ),
            {}
        );
    }
);

/* ==========================================================
   ERRORS
========================================================== */

test(
    "serializeScheduleError returns safe metadata",
    function () {
        const error =
            new ServiceError(
                "provider-error",
                "Provider failed.",
                {
                    status:
                        503,

                    retryable:
                        true
                }
            );

        assert.deepEqual(
            serializeScheduleError(
                error
            ),
            {
                name:
                    "ServiceError",

                code:
                    "provider-error",

                message:
                    "Provider failed.",

                status:
                    503,

                retryable:
                    true
            }
        );
    }
);

test(
    "schedule error factories create service errors",
    function () {
        const notFound =
            createScheduleNotFoundError(
                "schedule-1"
            );

        const conflict =
            createScheduleConflictError(
                "schedule-1",
                {
                    requestId:
                        "req-1",

                    correlationId:
                        "corr-1"
                }
            );

        assert.equal(
            notFound.code,
            "not-found"
        );

        assert.equal(
            notFound.status,
            404
        );

        assert.equal(
            conflict.code,
            "already-exists"
        );

        assert.equal(
            conflict.status,
            409
        );

        assert.equal(
            conflict.requestId,
            "req-1"
        );

        assert.equal(
            conflict.correlationId,
            "corr-1"
        );
    }
);

/* ==========================================================
   RUNTIME AND TIME
========================================================== */

test(
    "assertSchedulerRuntime validates runtime",
    function () {
        assert.doesNotThrow(
            function () {
                assertSchedulerRuntime(
                    createRuntime()
                );
            }
        );

        assert.throws(
            function () {
                assertSchedulerRuntime(
                    null
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "configuration-error"
                );

                return true;
            }
        );

        assert.throws(
            function () {
                assertSchedulerRuntime({
                    db: {
                        collection:
                            function () {}
                    }
                });
            },
            /transactions are required/
        );
    }
);

test(
    "resolveNow prefers option clock",
    function () {
        assert.equal(
            resolveNow(
                {
                    now:
                        function () {
                            return 1000;
                        }
                },
                {
                    now:
                        function () {
                            return 2000;
                        }
                }
            ),
            2000
        );
    }
);

test(
    "timestamp helpers support common values",
    function () {
        const timestamp =
            createDatabaseTimestamp(
                {
                    Timestamp:
                        TestTimestamp
                },
                1000
            );

        assert.equal(
            timestamp.toMillis(),
            1000
        );

        assert.equal(
            toMilliseconds(
                timestamp
            ),
            1000
        );

        assert.equal(
            toMilliseconds(
                new Date(
                    2000
                )
            ),
            2000
        );

        assert.equal(
            toMilliseconds(
                "1970-01-01T00:00:03.000Z"
            ),
            3000
        );

        assert.equal(
            serializeTimestamp(
                timestamp
            ),
            new Date(
                1000
            ).toISOString()
        );
    }
);

/* ==========================================================
   LOGGING
========================================================== */

test(
    "logScheduleEvent logs standard events",
    function () {
        const logger =
            createLoggerStub();

        logScheduleEvent(
            {
                logger:
                    logger
            },
            createStoredSchedule(),
            "created",
            {
                log:
                    true
            }
        );

        assert.equal(
            logger.entries.length,
            1
        );

        assert.equal(
            logger.entries[0].level,
            "info"
        );

        assert.equal(
            logger.entries[0].message,
            "Schedule event."
        );
    }
);

test(
    "logScheduleEvent logs retries as warnings",
    function () {
        const logger =
            createLoggerStub();

        logScheduleEvent(
            {
                logger:
                    logger
            },
            createStoredSchedule(),
            "retry-scheduled",
            {
                log:
                    true
            }
        );

        assert.equal(
            logger.entries[0].level,
            "warn"
        );

        assert.equal(
            logger.entries[0].message,
            "Schedule retry scheduled."
        );
    }
);

test(
    "logScheduleEvent logs failures as errors",
    function () {
        const logger =
            createLoggerStub();

        logScheduleEvent(
            {
                logger:
                    logger
            },
            createStoredSchedule({
                status:
                    "failed"
            }),
            "failed",
            {
                log:
                    true
            }
        );

        assert.equal(
            logger.entries[0].level,
            "error"
        );

        assert.equal(
            logger.entries[0].message,
            "Schedule failed."
        );
    }
);

test(
    "logScheduleEvent can be disabled",
    function () {
        const logger =
            createLoggerStub();

        logScheduleEvent(
            {
                logger:
                    logger
            },
            createStoredSchedule(),
            "created",
            {
                log:
                    false
            }
        );

        assert.equal(
            logger.entries.length,
            0
        );
    }
);

/* ==========================================================
   CONSTANTS
========================================================== */

test(
    "scheduler constants expose expected defaults",
    function () {
        assert.equal(
            constants
                .SCHEDULE_COLLECTION,
            "_schedules"
        );

        assert.equal(
            constants.DEFAULT_STATUS,
            "active"
        );

        assert.equal(
            constants.DEFAULT_TIMEZONE,
            "UTC"
        );

        assert.equal(
            constants.DEFAULT_INTERVAL_MS,
            3600000
        );

        assert.equal(
            constants.DEFAULT_LEASE_MS,
            300000
        );

        assert.equal(
            constants.DEFAULT_RETRY_DELAY_MS,
            30000
        );

        assert.equal(
            constants
                .DEFAULT_MAX_RETRY_DELAY_MS,
            3600000
        );

        assert.equal(
            constants.DEFAULT_MAX_ATTEMPTS,
            5
        );

        assert.equal(
            constants.DEFAULT_QUERY_LIMIT,
            100
        );

        assert.equal(
            constants.MAX_QUERY_LIMIT,
            500
        );

        assert.equal(
            constants.DEFAULT_RETENTION_MS,
            7776000000
        );

        assert.equal(
            constants
                .DEFAULT_CLAIM_BATCH_SIZE,
            50
        );

        assert.equal(
            constants
                .DEFAULT_MAX_PAYLOAD_BYTES,
            500000
        );

        assert.equal(
            constants
                .DEFAULT_MAX_RESULT_BYTES,
            500000
        );

        assert.deepEqual(
            constants.SCHEDULE_TYPES,
            {
                once:
                    "once",

                interval:
                    "interval"
            }
        );

        assert.deepEqual(
            constants.SCHEDULE_STATUSES,
            {
                active:
                    "active",

                processing:
                    "processing",

                paused:
                    "paused",

                completed:
                    "completed",

                failed:
                    "failed",

                cancelled:
                    "cancelled"
            }
        );

        assert.equal(
            constants
                .TERMINAL_SCHEDULE_STATUSES
                .includes(
                    "completed"
                ),
            true
        );
    }
);