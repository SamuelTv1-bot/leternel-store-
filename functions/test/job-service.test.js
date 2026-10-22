"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   JOB SERVICE TEST SUITE
========================================================== */

const test =
    require("node:test");

const assert =
    require("node:assert/strict");

const {
    createJobService,
    enqueueJob,
    enqueueUniqueJob,
    storeJob,
    claimNextJob,
    loadJobCandidates,
    claimJob,
    isJobClaimable,
    compareJobCandidates,
    sanitizeClaimCandidate,
    completeJob,
    failJob,
    cancelJob,
    getJob,
    queryJobs,
    normalizeJobQuery,
    normalizeJobRecord,
    sanitizeJobRecord,
    assertJobOwnership,
    isRetryableJobError,
    resolveRetryDelay,
    createJobId,
    generateLeaseToken,
    createJobFingerprint,
    hashJobValue,
    stableStringify,
    normalizeStableValue,
    assertSerializableJobValue,
    normalizeJobId,
    normalizeWorkerId,
    normalizeJobType,
    normalizeQueueName,
    normalizeJobStatus,
    normalizeJobPriority,
    normalizeJobTags,
    normalizeJobDate,
    normalizeJobOrderField,
    normalizeQueryLimit,
    normalizePositiveInteger,
    normalizeNonNegativeInteger,
    normalizePositiveNumber,
    normalizeOptionalString,
    normalizeCollection,
    sanitizeJobMetadata,
    normalizeJobOptions,
    serializeJobError,
    createJobNotFoundError,
    createJobConflictError,
    assertJobRuntime,
    resolveNow,
    createDatabaseTimestamp,
    toMilliseconds,
    serializeTimestamp,
    logJobEvent,
    constants
} = require(
    "../src/shared/job-service"
);

const {
    ServiceError
} = require(
    "../src/shared/service-error"
);

/* ==========================================================
   TEST HELPERS
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

function jobPath(
    id
) {
    return (
        constants
            .JOB_COLLECTION +
        "/" +
        id
    );
}

function createStoredJob(
    overrides
) {
    return Object.assign(
        {
            id:
                "job-1",

            fingerprint:
                "fingerprint",

            queue:
                "default",

            type:
                "order.process",

            status:
                "pending",

            priority:
                "normal",

            priorityWeight:
                200,

            payload: {
                orderId:
                    "order-1"
            },

            result:
                null,

            metadata:
                {},

            tags:
                [],

            attempts:
                0,

            maxAttempts:
                5,

            workerId:
                null,

            leaseToken:
                null,

            lastError:
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

            scheduledAt:
                TestTimestamp
                    .fromMillis(
                        1000
                    ),

            claimedAt:
                null,

            leaseExpiresAt:
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
    "createJobService creates a frozen service",
    function () {
        const runtime =
            createRuntime();

        const service =
            createJobService({
                runtime:
                    runtime,

                queue:
                    "orders",

                maxAttempts:
                    3
            });

        assert.equal(
            service.runtime,
            runtime
        );

        assert.equal(
            service.options.queue,
            "orders"
        );

        assert.equal(
            service.options.maxAttempts,
            3
        );

        assert.equal(
            typeof service.enqueue,
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
    "normalizeJobOptions applies defaults",
    function () {
        const options =
            normalizeJobOptions(
                {}
            );

        assert.equal(
            options.collection,
            constants.JOB_COLLECTION
        );

        assert.equal(
            options.queue,
            constants.DEFAULT_QUEUE
        );

        assert.equal(
            options.defaultPriority,
            constants.DEFAULT_PRIORITY
        );

        assert.equal(
            options.maxAttempts,
            constants.DEFAULT_MAX_ATTEMPTS
        );

        assert.equal(
            options.leaseMs,
            constants.DEFAULT_LEASE_MS
        );

        assert.equal(
            options.retryDelayMs,
            constants.DEFAULT_RETRY_DELAY_MS
        );

        assert.equal(
            options.retentionMs,
            constants.DEFAULT_RETENTION_MS
        );

        assert.equal(
            options.maxPayloadBytes,
            constants.DEFAULT_MAX_PAYLOAD_BYTES
        );

        assert.equal(
            options.maxResultBytes,
            constants.DEFAULT_MAX_RESULT_BYTES
        );

        assert.equal(
            options.queryLimit,
            constants.DEFAULT_QUERY_LIMIT
        );

        assert.equal(
            options.claimBatchSize,
            50
        );

        assert.equal(
            options.preventDuplicates,
            true
        );

        assert.equal(
            options.retryFailed,
            true
        );

        assert.equal(
            options.retryBackoffMultiplier,
            2
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
    "normalizeJobOptions respects overrides",
    function () {
        const resolver =
            function () {
                return "job-id";
            };

        const retryResolver =
            function () {
                return false;
            };

        const delayResolver =
            function () {
                return 1000;
            };

        const options =
            normalizeJobOptions({
                collection:
                    "jobs",

                queue:
                    "payments",

                defaultPriority:
                    "urgent",

                maxAttempts:
                    3,

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

                retentionMs:
                    5000,

                maxPayloadBytes:
                    1000,

                maxResultBytes:
                    2000,

                queryLimit:
                    25,

                claimBatchSize:
                    10,

                preventDuplicates:
                    false,

                disabled:
                    true,

                log:
                    false,

                idResolver:
                    resolver,

                retryResolver:
                    retryResolver,

                retryDelayResolver:
                    delayResolver,

                leaseToken:
                    "lease-token"
            });

        assert.equal(
            options.collection,
            "jobs"
        );

        assert.equal(
            options.queue,
            "payments"
        );

        assert.equal(
            options.defaultPriority,
            "urgent"
        );

        assert.equal(
            options.maxAttempts,
            3
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
            options.queryLimit,
            25
        );

        assert.equal(
            options.claimBatchSize,
            10
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
            resolver
        );

        assert.equal(
            options.retryResolver,
            retryResolver
        );

        assert.equal(
            options.retryDelayResolver,
            delayResolver
        );

        assert.equal(
            options.leaseToken,
            "lease-token"
        );
    }
);

/* ==========================================================
   NORMALIZERS
========================================================== */

test(
    "job normalizers validate identifiers and values",
    function () {
        assert.equal(
            normalizeJobId(
                " job-1 "
            ),
            "job-1"
        );

        assert.equal(
            normalizeWorkerId(
                " worker-1 "
            ),
            "worker-1"
        );

        assert.equal(
            normalizeJobType(
                " Process Order "
            ),
            "process.order"
        );

        assert.equal(
            normalizeQueueName(
                " Order Queue "
            ),
            "order-queue"
        );

        assert.equal(
            normalizeJobStatus(
                "PROCESSING"
            ),
            "processing"
        );

        assert.equal(
            normalizeJobPriority(
                "URGENT"
            ),
            "urgent"
        );

        assert.equal(
            normalizeJobPriority(
                "invalid"
            ),
            "normal"
        );

        assert.throws(
            function () {
                normalizeJobId(
                    "jobs/job-1"
                );
            },
            /job ID is invalid/
        );

        assert.throws(
            function () {
                normalizeWorkerId(
                    ""
                );
            },
            /worker ID is required/
        );

        assert.throws(
            function () {
                normalizeJobType(
                    ""
                );
            },
            /job type is invalid/
        );

        assert.throws(
            function () {
                normalizeJobStatus(
                    "unknown"
                );
            },
            /job status is invalid/
        );
    }
);

test(
    "job tags normalize and deduplicate",
    function () {
        assert.deepEqual(
            normalizeJobTags([
                "Orders",
                " urgent ",
                "orders",
                ""
            ]),
            [
                "orders",
                "urgent"
            ]
        );

        assert.deepEqual(
            normalizeJobTags(
                "Payments"
            ),
            [
                "payments"
            ]
        );
    }
);

test(
    "numeric normalizers validate values",
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
    "collection and optional string normalizers work",
    function () {
        assert.equal(
            normalizeCollection(
                "_jobs"
            ),
            "_jobs"
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

        assert.throws(
            function () {
                normalizeCollection(
                    "internal/jobs"
                );
            },
            /Firestore collection name/
        );
    }
);

/* ==========================================================
   RECORD NORMALIZATION
========================================================== */

test(
    "normalizeJobRecord creates complete job record",
    function () {
        const record =
            normalizeJobRecord(
                {
                    id:
                        "job-1",

                    type:
                        "order.process",

                    queue:
                        "orders",

                    priority:
                        "high",

                    payload: {
                        orderId:
                            "order-1"
                    },

                    metadata: {
                        source:
                            "checkout"
                    },

                    tags: [
                        "Orders"
                    ],

                    maxAttempts:
                        3,

                    scheduledAt:
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
            "job-1"
        );

        assert.equal(
            record.type,
            "order.process"
        );

        assert.equal(
            record.queue,
            "orders"
        );

        assert.equal(
            record.status,
            "pending"
        );

        assert.equal(
            record.priority,
            "high"
        );

        assert.equal(
            record.priorityWeight,
            300
        );

        assert.deepEqual(
            record.payload,
            {
                orderId:
                    "order-1"
            }
        );

        assert.equal(
            record.attempts,
            0
        );

        assert.equal(
            record.maxAttempts,
            3
        );

        assert.equal(
            record.createdAt.toMillis(),
            1000
        );

        assert.equal(
            record.scheduledAt.toMillis(),
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
    "normalizeJobRecord rejects invalid input",
    function () {
        assert.throws(
            function () {
                normalizeJobRecord(
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
    "assertSerializableJobValue accepts valid values",
    function () {
        assert.equal(
            assertSerializableJobValue(
                {
                    orderId:
                        "order-1"
                },
                1000,
                "Job payload"
            ),
            true
        );
    }
);

test(
    "assertSerializableJobValue rejects oversized values",
    function () {
        assert.throws(
            function () {
                assertSerializableJobValue(
                    {
                        value:
                            "x".repeat(
                                100
                            )
                    },
                    10,
                    "Job payload"
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
   IDENTIFIERS
========================================================== */

test(
    "createJobId uses custom resolver",
    function () {
        assert.equal(
            createJobId(
                {},
                "orders",
                "order.process",
                {
                    idResolver:
                        function () {
                            return "custom-job";
                        }
                },
                1000
            ),
            "custom-job"
        );
    }
);

test(
    "createJobId hashes idempotency keys",
    function () {
        const first =
            createJobId(
                {
                    idempotencyKey:
                        "order-1"
                },
                "orders",
                "order.process",
                {},
                1000
            );

        const second =
            createJobId(
                {
                    idempotencyKey:
                        "order-1"
                },
                "orders",
                "order.process",
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
    "createJobId generates unique identifiers",
    function () {
        const first =
            createJobId(
                {},
                "orders",
                "order.process",
                {},
                1000
            );

        const second =
            createJobId(
                {},
                "orders",
                "order.process",
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
    "job fingerprints and hashes are deterministic",
    function () {
        assert.equal(
            createJobFingerprint({
                b:
                    2,

                a:
                    1
            }),
            createJobFingerprint({
                a:
                    1,

                b:
                    2
            })
        );

        assert.match(
            hashJobValue(
                "job-value"
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
   ENQUEUE
========================================================== */

test(
    "enqueueJob stores a job",
    async function () {
        const firestore =
            createFirestoreStub();

        const runtime =
            createRuntime({
                firestore:
                    firestore
            });

        const result =
            await enqueueJob(
                runtime,
                {
                    id:
                        "job-1",

                    type:
                        "order.process",

                    queue:
                        "orders",

                    payload: {
                        orderId:
                            "order-1"
                    }
                },
                {
                    now:
                        function () {
                            return 1000;
                        }
                }
            );

        assert.equal(
            result.queued,
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
                jobPath(
                    "job-1"
                )
            );

        assert.equal(
            stored.status,
            "pending"
        );

        assert.equal(
            stored.type,
            "order.process"
        );
    }
);

test(
    "enqueueJob detects duplicate jobs",
    async function () {
        const runtime =
            createRuntime();

        const input = {
            id:
                "job-1",

            type:
                "order.process",

            payload: {
                orderId:
                    "order-1"
            }
        };

        const options = {
            now:
                function () {
                    return 1000;
                }
        };

        const first =
            await enqueueJob(
                runtime,
                input,
                options
            );

        const second =
            await enqueueJob(
                runtime,
                input,
                options
            );

        assert.equal(
            first.queued,
            true
        );

        assert.equal(
            second.queued,
            false
        );

        assert.equal(
            second.duplicate,
            true
        );
    }
);

test(
    "enqueueJob rejects conflicting job IDs",
    async function () {
        const runtime =
            createRuntime();

        await enqueueJob(
            runtime,
            {
                id:
                    "job-1",

                type:
                    "order.process",

                payload: {
                    orderId:
                        "order-1"
                }
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
                await enqueueJob(
                    runtime,
                    {
                        id:
                            "job-1",

                        type:
                            "order.process",

                        payload: {
                            orderId:
                                "order-2"
                        }
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
    "enqueueJob bypasses storage when disabled",
    async function () {
        const result =
            await enqueueJob(
                null,
                {
                    id:
                        "job-1",

                    type:
                        "order.process",

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
            result.queued,
            false
        );

        assert.equal(
            result.disabled,
            true
        );

        assert.equal(
            result.job.id,
            "job-1"
        );
    }
);

/* ==========================================================
   CLAIMABILITY
========================================================== */

test(
    "isJobClaimable accepts due pending jobs",
    function () {
        assert.equal(
            isJobClaimable(
                createStoredJob({
                    status:
                        "pending",

                    scheduledAt:
                        TestTimestamp
                            .fromMillis(
                                1000
                            )
                }),
                2000,
                {
                    maxAttempts:
                        5
                }
            ),
            true
        );
    }
);

test(
    "isJobClaimable rejects future and exhausted jobs",
    function () {
        assert.equal(
            isJobClaimable(
                createStoredJob({
                    scheduledAt:
                        TestTimestamp
                            .fromMillis(
                                3000
                            )
                }),
                2000,
                {
                    maxAttempts:
                        5
                }
            ),
            false
        );

        assert.equal(
            isJobClaimable(
                createStoredJob({
                    attempts:
                        5,

                    maxAttempts:
                        5
                }),
                2000,
                {
                    maxAttempts:
                        5
                }
            ),
            false
        );
    }
);

test(
    "isJobClaimable allows expired processing leases",
    function () {
        assert.equal(
            isJobClaimable(
                createStoredJob({
                    status:
                        "processing",

                    attempts:
                        1,

                    leaseExpiresAt:
                        TestTimestamp
                            .fromMillis(
                                1000
                            )
                }),
                2000,
                {
                    maxAttempts:
                        5
                }
            ),
            true
        );

        assert.equal(
            isJobClaimable(
                createStoredJob({
                    status:
                        "processing",

                    attempts:
                        1,

                    leaseExpiresAt:
                        TestTimestamp
                            .fromMillis(
                                3000
                            )
                }),
                2000,
                {
                    maxAttempts:
                        5
                }
            ),
            false
        );
    }
);

/* ==========================================================
   CANDIDATE ORDERING
========================================================== */

test(
    "compareJobCandidates prioritizes priority",
    function () {
        const jobs = [
            createStoredJob({
                id:
                    "low",

                priority:
                    "low"
            }),

            createStoredJob({
                id:
                    "urgent",

                priority:
                    "urgent"
            }),

            createStoredJob({
                id:
                    "normal",

                priority:
                    "normal"
            })
        ];

        jobs.sort(
            compareJobCandidates
        );

        assert.deepEqual(
            jobs.map(
                function (job) {
                    return job.id;
                }
            ),
            [
                "urgent",
                "normal",
                "low"
            ]
        );
    }
);

test(
    "compareJobCandidates uses schedule and creation time",
    function () {
        const jobs = [
            createStoredJob({
                id:
                    "later",

                scheduledAt:
                    TestTimestamp
                        .fromMillis(
                            3000
                        )
            }),

            createStoredJob({
                id:
                    "earlier",

                scheduledAt:
                    TestTimestamp
                        .fromMillis(
                            1000
                        ),

                createdAt:
                    TestTimestamp
                        .fromMillis(
                            500
                        )
            })
        ];

        jobs.sort(
            compareJobCandidates
        );

        assert.equal(
            jobs[0].id,
            "earlier"
        );
    }
);

test(
    "sanitizeClaimCandidate normalizes fields",
    function () {
        const result =
            sanitizeClaimCandidate({
                id:
                    "job-1",

                queue:
                    "Orders Queue",

                type:
                    "order.process",

                status:
                    "PENDING",

                priority:
                    "HIGH"
            });

        assert.equal(
            result.queue,
            "orders-queue"
        );

        assert.equal(
            result.status,
            "pending"
        );

        assert.equal(
            result.priority,
            "high"
        );
    }
);

/* ==========================================================
   CLAIM
========================================================== */

test(
    "claimJob claims an available job",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    jobPath(
                        "job-1"
                    )
                ]: createStoredJob()
            });

        const result =
            await claimJob(
                createRuntime({
                    firestore:
                        firestore
                }),
                "job-1",
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
    "claimJob returns null for unavailable job",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    jobPath(
                        "job-1"
                    )
                ]: createStoredJob({
                    scheduledAt:
                        TestTimestamp
                            .fromMillis(
                                5000
                            )
                })
            });

        const result =
            await claimJob(
                createRuntime({
                    firestore:
                        firestore
                }),
                "job-1",
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
    "claimNextJob selects highest-priority due job",
    async function () {
        const firestore =
            createFirestoreStub({
                "_jobs/low":
                    createStoredJob({
                        id:
                            "low",

                        queue:
                            "orders",

                        priority:
                            "low"
                    }),

                "_jobs/urgent":
                    createStoredJob({
                        id:
                            "urgent",

                        queue:
                            "orders",

                        priority:
                            "urgent"
                    }),

                "_jobs/future":
                    createStoredJob({
                        id:
                            "future",

                        queue:
                            "orders",

                        priority:
                            "urgent",

                        scheduledAt:
                            TestTimestamp
                                .fromMillis(
                                    5000
                                )
                    })
            });

        const result =
            await claimNextJob(
                createRuntime({
                    firestore:
                        firestore
                }),
                "worker-1",
                {
                    queue:
                        "orders",

                    now:
                        function () {
                            return 2000;
                        },

                    leaseMs:
                        5000
                }
            );

        assert.equal(
            result.id,
            "urgent"
        );

        assert.equal(
            result.status,
            "processing"
        );
    }
);

test(
    "claimNextJob returns null when disabled",
    async function () {
        assert.equal(
            await claimNextJob(
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
    "assertJobOwnership validates worker and lease token",
    function () {
        assert.equal(
            assertJobOwnership(
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
                assertJobOwnership(
                    {
                        status:
                            "pending"
                    },
                    "worker-1"
                );
            },
            /not currently being processed/
        );

        assert.throws(
            function () {
                assertJobOwnership(
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
                assertJobOwnership(
                    {
                        status:
                            "processing",

                        workerId:
                            "worker-1",

                        leaseToken:
                            "old-token"
                    },
                    "worker-1",
                    "new-token"
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
   COMPLETE
========================================================== */

test(
    "completeJob completes owned job",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    jobPath(
                        "job-1"
                    )
                ]: createStoredJob({
                    status:
                        "processing",

                    attempts:
                        1,

                    workerId:
                        "worker-1",

                    leaseToken:
                        "lease-1",

                    leaseExpiresAt:
                        TestTimestamp
                            .fromMillis(
                                5000
                            )
                })
            });

        const result =
            await completeJob(
                createRuntime({
                    firestore:
                        firestore
                }),
                "job-1",
                "worker-1",
                {
                    processed:
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
            result.completed,
            true
        );

        assert.equal(
            result.job.status,
            "completed"
        );

        assert.deepEqual(
            result.job.result,
            {
                processed:
                    true
            }
        );

        assert.equal(
            result.job.completedAt,
            new Date(
                3000
            ).toISOString()
        );

        assert.equal(
            result.job.leaseToken,
            null
        );
    }
);

test(
    "completeJob rejects missing jobs",
    async function () {
        await assert.rejects(
            async function () {
                await completeJob(
                    createRuntime(),
                    "missing-job",
                    "worker-1",
                    {},
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

test(
    "completeJob returns disabled result",
    async function () {
        const result =
            await completeJob(
                null,
                "job-1",
                "worker-1",
                {},
                {
                    disabled:
                        true
                }
            );

        assert.deepEqual(
            result,
            {
                completed:
                    false,

                disabled:
                    true,

                jobId:
                    "job-1"
            }
        );
    }
);

/* ==========================================================
   RETRY
========================================================== */

test(
    "isRetryableJobError respects resolver and error metadata",
    function () {
        assert.equal(
            isRetryableJobError(
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

        assert.equal(
            isRetryableJobError(
                {
                    retryable:
                        false
                },
                {}
            ),
            false
        );

        assert.equal(
            isRetryableJobError(
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
    }
);

test(
    "resolveRetryDelay applies exponential backoff",
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

test(
    "resolveRetryDelay supports custom resolver",
    function () {
        assert.equal(
            resolveRetryDelay(
                2,
                null,
                {
                    retryDelayMs:
                        1000,

                    retryDelayResolver:
                        function () {
                            return 2500;
                        }
                }
            ),
            2500
        );
    }
);

/* ==========================================================
   FAIL
========================================================== */

test(
    "failJob schedules retry for retryable job",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    jobPath(
                        "job-1"
                    )
                ]: createStoredJob({
                    status:
                        "processing",

                    attempts:
                        1,

                    maxAttempts:
                        3,

                    workerId:
                        "worker-1",

                    leaseToken:
                        "lease-1"
                })
            });

        const error =
            new Error(
                "Provider unavailable."
            );

        error.code =
            "provider-unavailable";

        error.retryable =
            true;

        const result =
            await failJob(
                createRuntime({
                    firestore:
                        firestore
                }),
                "job-1",
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
            result.job.status,
            "pending"
        );

        assert.equal(
            result.job.scheduledAt,
            new Date(
                4000
            ).toISOString()
        );

        assert.equal(
            result.job.workerId,
            null
        );
    }
);

test(
    "failJob permanently fails exhausted job",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    jobPath(
                        "job-1"
                    )
                ]: createStoredJob({
                    status:
                        "processing",

                    attempts:
                        3,

                    maxAttempts:
                        3,

                    workerId:
                        "worker-1",

                    leaseToken:
                        "lease-1"
                })
            });

        const result =
            await failJob(
                createRuntime({
                    firestore:
                        firestore
                }),
                "job-1",
                "worker-1",
                new Error(
                    "Permanent failure."
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
            result.job.status,
            "failed"
        );

        assert.equal(
            result.job.failedAt,
            new Date(
                3000
            ).toISOString()
        );
    }
);

test(
    "failJob permanently fails non-retryable errors",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    jobPath(
                        "job-1"
                    )
                ]: createStoredJob({
                    status:
                        "processing",

                    attempts:
                        1,

                    workerId:
                        "worker-1",

                    leaseToken:
                        "lease-1"
                })
            });

        const error =
            new Error(
                "Invalid payload."
            );

        error.retryable =
            false;

        const result =
            await failJob(
                createRuntime({
                    firestore:
                        firestore
                }),
                "job-1",
                "worker-1",
                error,
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
    }
);

test(
    "failJob returns disabled result",
    async function () {
        const result =
            await failJob(
                null,
                "job-1",
                "worker-1",
                new Error(
                    "Failure."
                ),
                {
                    disabled:
                        true
                }
            );

        assert.deepEqual(
            result,
            {
                failed:
                    false,

                retryScheduled:
                    false,

                disabled:
                    true,

                jobId:
                    "job-1"
            }
        );
    }
);

/* ==========================================================
   CANCEL
========================================================== */

test(
    "cancelJob cancels non-terminal job",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    jobPath(
                        "job-1"
                    )
                ]: createStoredJob()
            });

        const result =
            await cancelJob(
                createRuntime({
                    firestore:
                        firestore
                }),
                "job-1",
                "No longer required.",
                {
                    now:
                        function () {
                            return 3000;
                        }
                }
            );

        assert.equal(
            result.cancelled,
            true
        );

        assert.equal(
            result.job.status,
            "cancelled"
        );

        assert.equal(
            result.job.cancellationReason,
            "No longer required."
        );

        assert.equal(
            result.job.cancelledAt,
            new Date(
                3000
            ).toISOString()
        );
    }
);

test(
    "cancelJob rejects terminal jobs",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    jobPath(
                        "job-1"
                    )
                ]: createStoredJob({
                    status:
                        "completed"
                })
            });

        await assert.rejects(
            async function () {
                await cancelJob(
                    createRuntime({
                        firestore:
                            firestore
                    }),
                    "job-1",
                    "Cancel.",
                    {}
                );
            },
            /terminal job cannot be cancelled/
        );
    }
);

test(
    "cancelJob returns disabled result",
    async function () {
        assert.deepEqual(
            await cancelJob(
                null,
                "job-1",
                "Cancel.",
                {
                    disabled:
                        true
                }
            ),
            {
                cancelled:
                    false,

                disabled:
                    true,

                jobId:
                    "job-1"
            }
        );
    }
);

/* ==========================================================
   GET
========================================================== */

test(
    "getJob returns stored job",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    jobPath(
                        "job-1"
                    )
                ]: createStoredJob()
            });

        const result =
            await getJob(
                createRuntime({
                    firestore:
                        firestore
                }),
                "job-1"
            );

        assert.equal(
            result.id,
            "job-1"
        );

        assert.equal(
            result.status,
            "pending"
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
    "getJob returns null for missing job",
    async function () {
        assert.equal(
            await getJob(
                createRuntime(),
                "missing-job"
            ),
            null
        );
    }
);

test(
    "getJob returns null when disabled",
    async function () {
        assert.equal(
            await getJob(
                null,
                "job-1",
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
    "normalizeJobQuery normalizes filters",
    function () {
        assert.deepEqual(
            normalizeJobQuery(
                {
                    queue:
                        "Order Queue",

                    type:
                        "Process Order",

                    status:
                        "PENDING",

                    priority:
                        "HIGH",

                    workerId:
                        " worker-1 ",

                    scheduledBefore:
                        3000,

                    createdAfter:
                        1000,

                    orderBy:
                        "priorityWeight",

                    direction:
                        "DESC",

                    limit:
                        25
                },
                {}
            ),
            {
                queue:
                    "order-queue",

                type:
                    "process.order",

                status:
                    "pending",

                priority:
                    "high",

                workerId:
                    "worker-1",

                scheduledBefore:
                    3000,

                createdAfter:
                    1000,

                orderBy:
                    "priorityWeight",

                direction:
                    "desc",

                limit:
                    25
            }
        );
    }
);

test(
    "queryJobs filters and orders jobs",
    async function () {
        const firestore =
            createFirestoreStub({
                "_jobs/one":
                    createStoredJob({
                        id:
                            "one",

                        queue:
                            "orders",

                        type:
                            "order.process",

                        status:
                            "pending",

                        priority:
                            "normal",

                        scheduledAt:
                            TestTimestamp
                                .fromMillis(
                                    1000
                                )
                    }),

                "_jobs/two":
                    createStoredJob({
                        id:
                            "two",

                        queue:
                            "orders",

                        type:
                            "order.process",

                        status:
                            "pending",

                        priority:
                            "normal",

                        scheduledAt:
                            TestTimestamp
                                .fromMillis(
                                    2000
                                )
                    }),

                "_jobs/three":
                    createStoredJob({
                        id:
                            "three",

                        queue:
                            "payments",

                        type:
                            "payment.capture",

                        status:
                            "pending",

                        scheduledAt:
                            TestTimestamp
                                .fromMillis(
                                    3000
                                )
                    })
            });

        const results =
            await queryJobs(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    queue:
                        "orders",

                    type:
                        "order.process",

                    status:
                        "pending",

                    direction:
                        "asc"
                },
                {}
            );

        assert.deepEqual(
            results.map(
                function (job) {
                    return job.id;
                }
            ),
            [
                "one",
                "two"
            ]
        );
    }
);

test(
    "queryJobs supports date filters",
    async function () {
        const firestore =
            createFirestoreStub({
                "_jobs/one":
                    createStoredJob({
                        id:
                            "one",

                        createdAt:
                            TestTimestamp
                                .fromMillis(
                                    1000
                                ),

                        scheduledAt:
                            TestTimestamp
                                .fromMillis(
                                    2000
                                )
                    }),

                "_jobs/two":
                    createStoredJob({
                        id:
                            "two",

                        createdAt:
                            TestTimestamp
                                .fromMillis(
                                    3000
                                ),

                        scheduledAt:
                            TestTimestamp
                                .fromMillis(
                                    4000
                                )
                    })
            });

        const results =
            await queryJobs(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    createdAfter:
                        2000,

                    scheduledBefore:
                        5000
                },
                {}
            );

        assert.deepEqual(
            results.map(
                function (job) {
                    return job.id;
                }
            ),
            [
                "two"
            ]
        );
    }
);

test(
    "queryJobs returns empty list when disabled",
    async function () {
        assert.deepEqual(
            await queryJobs(
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
   RECORD SANITIZATION
========================================================== */

test(
    "sanitizeJobRecord serializes timestamps",
    function () {
        const result =
            sanitizeJobRecord(
                createStoredJob({
                    status:
                        "completed",

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
            result.completedAt,
            new Date(
                3000
            ).toISOString()
        );

        assert.equal(
            result.status,
            "completed"
        );
    }
);

/* ==========================================================
   METADATA AND ERRORS
========================================================== */

test(
    "sanitizeJobMetadata preserves objects and wraps primitives",
    function () {
        assert.deepEqual(
            sanitizeJobMetadata({
                source:
                    "checkout"
            }),
            {
                source:
                    "checkout"
            }
        );

        assert.deepEqual(
            sanitizeJobMetadata(
                "checkout"
            ),
            {
                value:
                    "checkout"
            }
        );

        assert.deepEqual(
            sanitizeJobMetadata(
                null
            ),
            {}
        );
    }
);

test(
    "serializeJobError returns safe metadata",
    function () {
        const error =
            new ServiceError(
                "provider-error",
                "Provider unavailable.",
                {
                    status:
                        503,

                    retryable:
                        true
                }
            );

        assert.deepEqual(
            serializeJobError(
                error
            ),
            {
                name:
                    "ServiceError",

                code:
                    "provider-error",

                message:
                    "Provider unavailable.",

                status:
                    503,

                retryable:
                    true
            }
        );
    }
);

test(
    "job error factories create service errors",
    function () {
        const notFound =
            createJobNotFoundError(
                "job-1"
            );

        const conflict =
            createJobConflictError(
                "job-1",
                {
                    requestId:
                        "req_1",

                    correlationId:
                        "corr_1"
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
            "req_1"
        );

        assert.equal(
            conflict.correlationId,
            "corr_1"
        );
    }
);

/* ==========================================================
   RUNTIME AND TIME
========================================================== */

test(
    "assertJobRuntime validates datastore",
    function () {
        assert.doesNotThrow(
            function () {
                assertJobRuntime(
                    createRuntime()
                );
            }
        );

        assert.throws(
            function () {
                assertJobRuntime(
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
                assertJobRuntime({
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
    "logJobEvent logs normal events",
    function () {
        const logger =
            createLoggerStub();

        logJobEvent(
            {
                logger:
                    logger
            },
            {
                id:
                    "job-1",

                queue:
                    "orders",

                type:
                    "order.process",

                status:
                    "pending",

                attempts:
                    0,

                workerId:
                    null
            },
            "queued",
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
            "Job event."
        );
    }
);

test(
    "logJobEvent logs retries as warnings",
    function () {
        const logger =
            createLoggerStub();

        logJobEvent(
            {
                logger:
                    logger
            },
            {
                id:
                    "job-1",

                status:
                    "pending"
            },
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
            "Job retry scheduled."
        );
    }
);

test(
    "logJobEvent logs failures as errors",
    function () {
        const logger =
            createLoggerStub();

        logJobEvent(
            {
                logger:
                    logger
            },
            {
                id:
                    "job-1",

                status:
                    "failed"
            },
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
            "Job failed."
        );
    }
);

test(
    "logJobEvent can be disabled",
    function () {
        const logger =
            createLoggerStub();

        logJobEvent(
            {
                logger:
                    logger
            },
            {},
            "queued",
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
    "job constants expose expected defaults",
    function () {
        assert.equal(
            constants.JOB_COLLECTION,
            "_jobs"
        );

        assert.equal(
            constants.DEFAULT_QUEUE,
            "default"
        );

        assert.equal(
            constants.DEFAULT_STATUS,
            "pending"
        );

        assert.equal(
            constants.DEFAULT_PRIORITY,
            "normal"
        );

        assert.equal(
            constants.DEFAULT_MAX_ATTEMPTS,
            5
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
            constants.DEFAULT_RETENTION_MS,
            2592000000
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
            constants.DEFAULT_MAX_PAYLOAD_BYTES,
            500000
        );

        assert.equal(
            constants.DEFAULT_MAX_RESULT_BYTES,
            500000
        );

        assert.deepEqual(
            constants.JOB_STATUSES,
            {
                pending:
                    "pending",

                processing:
                    "processing",

                completed:
                    "completed",

                failed:
                    "failed",

                cancelled:
                    "cancelled"
            }
        );

        assert.deepEqual(
            constants.JOB_PRIORITIES,
            {
                low:
                    "low",

                normal:
                    "normal",

                high:
                    "high",

                urgent:
                    "urgent"
            }
        );

        assert.deepEqual(
            constants.PRIORITY_WEIGHTS,
            {
                urgent:
                    400,

                high:
                    300,

                normal:
                    200,

                low:
                    100
            }
        );

        assert.equal(
            constants
                .TERMINAL_JOB_STATUSES
                .includes(
                    "completed"
                ),
            true
        );
    }
);