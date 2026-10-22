"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   CLEANUP SERVICE TEST SUITE
========================================================== */

const test =
    require("node:test");

const assert =
    require("node:assert/strict");

const {
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
    constants
} = require(
    "../src/shared/cleanup-service"
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
    constructor(
        milliseconds
    ) {
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
   GENERAL HELPERS
========================================================== */

function clone(
    value
) {
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
            clone
        );
    }

    if (
        typeof value ===
        "object"
    ) {
        return Object.keys(
            value
        ).reduce(
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

    switch (
        operator
    ) {
        case "<=":
            return (
                normalizedLeft <=
                normalizedRight
            );

        case ">=":
            return (
                normalizedLeft >=
                normalizedRight
            );

        case "==":
            return (
                normalizedLeft ===
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
    initialDocuments,
    options
) {
    const settings =
        options || {};

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

    function createSnapshot(
        path
    ) {
        return {
            exists:
                documents.has(
                    path
                ),

            id:
                path
                    .split("/")
                    .pop(),

            ref:
                createReferenceFromPath(
                    path
                ),

            data:
                function () {
                    return documents.has(
                        path
                    )
                        ? clone(
                              documents.get(
                                  path
                              )
                          )
                        : undefined;
                }
        };
    }

    function createReferenceFromPath(
        path
    ) {
        const segments =
            path.split("/");

        const collectionName =
            segments[0];

        const documentId =
            segments[1];

        return createReference(
            collectionName,
            documentId
        );
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
                    setOptions
                ) {
                    const stored =
                        setOptions &&
                        setOptions.merge
                            ? Object.assign(
                                  {},
                                  clone(
                                      documents.get(
                                          path
                                      ) || {}
                                  ),
                                  clone(
                                      value
                                  )
                              )
                            : clone(
                                  value
                              );

                    documents.set(
                        path,
                        stored
                    );
                },

            delete:
                async function () {
                    if (
                        settings.deleteFailurePaths &&
                        settings
                            .deleteFailurePaths
                            .includes(
                                path
                            )
                    ) {
                        throw new Error(
                            "Delete failed for " +
                            path
                        );
                    }

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
                                queryState
                                    .order,

                            limit:
                                queryState
                                    .limit
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
                                queryState
                                    .filters,

                            order: {
                                field:
                                    field,

                                direction:
                                    direction
                            },

                            limit:
                                queryState
                                    .limit
                        }
                    );
                },

            limit:
                function (
                    count
                ) {
                    return createQuery(
                        collectionName,
                        {
                            filters:
                                queryState
                                    .filters,

                            order:
                                queryState
                                    .order,

                            limit:
                                count
                        }
                    );
                },

            get:
                async function () {
                    if (
                        settings.queryFailureCollections &&
                        settings
                            .queryFailureCollections
                            .includes(
                                collectionName
                            )
                    ) {
                        throw new Error(
                            "Query failed for " +
                            collectionName
                        );
                    }

                    let records =
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
                                            clone(
                                                value
                                            )
                                    };
                                }
                            );

                    queryState
                        .filters
                        .forEach(
                            function (
                                filter
                            ) {
                                records =
                                    records.filter(
                                        function (
                                            record
                                        ) {
                                            return compareValues(
                                                getNestedValue(
                                                    record.value,
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
                        records.sort(
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
                        records =
                            records.slice(
                                0,
                                queryState.limit
                            );
                    }

                    return {
                        docs:
                            records.map(
                                function (
                                    record
                                ) {
                                    const id =
                                        record.path
                                            .split("/")
                                            .pop();

                                    return {
                                        id:
                                            id,

                                        ref:
                                            createReference(
                                                collectionName,
                                                id
                                            ),

                                        data:
                                            function () {
                                                return clone(
                                                    record.value
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
            }
    };

    if (
        settings.batch !==
        false
    ) {
        db.batch =
            function () {
                const deletes =
                    [];

                return {
                    delete:
                        function (
                            reference
                        ) {
                            deletes.push(
                                reference
                            );
                        },

                    commit:
                        async function () {
                            if (
                                settings.batchCommitFailure
                            ) {
                                throw new Error(
                                    "Batch commit failed."
                                );
                            }

                            for (
                                const reference of
                                deletes
                            ) {
                                await reference
                                    .delete();
                            }
                        }
                };
            };
    }

    return {
        db:
            db,

        getDocument:
            function (
                path
            ) {
                return documents.has(
                    path
                )
                    ? clone(
                          documents.get(
                              path
                          )
                      )
                    : undefined;
            },

        hasDocument:
            function (
                path
            ) {
                return documents.has(
                    path
                );
            },

        setDocument:
            function (
                path,
                value
            ) {
                documents.set(
                    path,
                    clone(
                        value
                    )
                );
            },

        count:
            function (
                collection
            ) {
                return Array.from(
                    documents.keys()
                ).filter(
                    function (
                        path
                    ) {
                        return path.startsWith(
                            collection +
                            "/"
                        );
                    }
                ).length;
            }
    };
}

/* ==========================================================
   LOGGER AND RUNTIME
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
                return 5000;
            },

        logger:
            settings.logger ||
            createLoggerStub()
    };
}

function createStoredRecord(
    overrides
) {
    return Object.assign(
        {
            createdAt:
                TestTimestamp
                    .fromMillis(
                        1000
                    ),

            updatedAt:
                TestTimestamp
                    .fromMillis(
                        2000
                    ),

            expiresAt:
                TestTimestamp
                    .fromMillis(
                        3000
                    )
        },
        overrides || {}
    );
}

/* ==========================================================
   SERVICE FACTORY
========================================================== */

test(
    "createCleanupService creates a frozen service",
    function () {
        const runtime =
            createRuntime();

        const service =
            createCleanupService({
                runtime:
                    runtime,

                collections: [
                    "_jobs"
                ],

                batchSize:
                    25
            });

        assert.equal(
            service.runtime,
            runtime
        );

        assert.deepEqual(
            service.options.collections,
            [
                "_jobs"
            ]
        );

        assert.equal(
            service.options.batchSize,
            25
        );

        assert.equal(
            typeof service.run,
            "function"
        );

        assert.equal(
            typeof service.collection,
            "function"
        );

        assert.equal(
            typeof service.inspect,
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
    "normalizeCleanupOptions applies defaults",
    function () {
        const options =
            normalizeCleanupOptions(
                {}
            );

        assert.deepEqual(
            options.collections,
            constants
                .DEFAULT_COLLECTIONS
        );

        assert.equal(
            options.maxCollections,
            constants
                .DEFAULT_MAX_COLLECTIONS
        );

        assert.equal(
            options.expirationField,
            constants
                .DEFAULT_EXPIRATION_FIELD
        );

        assert.equal(
            options.orderField,
            constants
                .DEFAULT_ORDER_FIELD
        );

        assert.equal(
            options.direction,
            constants
                .DEFAULT_DIRECTION
        );

        assert.equal(
            options.batchSize,
            constants
                .DEFAULT_BATCH_SIZE
        );

        assert.equal(
            options.queryLimit,
            constants
                .DEFAULT_QUERY_LIMIT
        );

        assert.equal(
            options.maxPasses,
            constants
                .DEFAULT_MAX_PASSES
        );

        assert.equal(
            options.dryRun,
            false
        );

        assert.equal(
            options.disabled,
            false
        );

        assert.equal(
            options.stopOnError,
            false
        );

        assert.equal(
            options.includeDeletedIds,
            false
        );

        assert.equal(
            options.log,
            true
        );
    }
);

test(
    "normalizeCleanupOptions respects overrides",
    function () {
        const now =
            function () {
                return 1000;
            };

        const options =
            normalizeCleanupOptions({
                collections: [
                    "_jobs",
                    "_locks"
                ],

                maxCollections:
                    10,

                expirationField:
                    "retention.expiresAt",

                orderField:
                    "retention.expiresAt",

                direction:
                    "desc",

                batchSize:
                    25,

                queryLimit:
                    50,

                maxPasses:
                    3,

                dryRun:
                    true,

                disabled:
                    true,

                stopOnError:
                    true,

                includeDeletedIds:
                    true,

                log:
                    false,

                now:
                    now
            });

        assert.deepEqual(
            options.collections,
            [
                "_jobs",
                "_locks"
            ]
        );

        assert.equal(
            options.maxCollections,
            10
        );

        assert.equal(
            options.expirationField,
            "retention.expiresAt"
        );

        assert.equal(
            options.orderField,
            "retention.expiresAt"
        );

        assert.equal(
            options.direction,
            "desc"
        );

        assert.equal(
            options.batchSize,
            25
        );

        assert.equal(
            options.queryLimit,
            50
        );

        assert.equal(
            options.maxPasses,
            3
        );

        assert.equal(
            options.dryRun,
            true
        );

        assert.equal(
            options.disabled,
            true
        );

        assert.equal(
            options.stopOnError,
            true
        );

        assert.equal(
            options.includeDeletedIds,
            true
        );

        assert.equal(
            options.log,
            false
        );

        assert.equal(
            options.now,
            now
        );
    }
);

/* ==========================================================
   NORMALIZERS
========================================================== */

test(
    "normalizeCleanupStatus validates status",
    function () {
        assert.equal(
            normalizeCleanupStatus(
                "PARTIAL"
            ),
            "partial"
        );

        assert.equal(
            normalizeCleanupStatus(
                undefined
            ),
            "completed"
        );

        assert.throws(
            function () {
                normalizeCleanupStatus(
                    "unknown"
                );
            },
            /cleanup status is invalid/
        );
    }
);

test(
    "normalizeCollection validates Firestore collection names",
    function () {
        assert.equal(
            normalizeCollection(
                " _jobs "
            ),
            "_jobs"
        );

        assert.throws(
            function () {
                normalizeCollection(
                    ""
                );
            },
            /Firestore collection name/
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

test(
    "normalizeCollections deduplicates values",
    function () {
        assert.deepEqual(
            normalizeCollections(
                [
                    "_jobs",
                    "_locks",
                    "_jobs"
                ],
                10
            ),
            [
                "_jobs",
                "_locks"
            ]
        );

        assert.deepEqual(
            normalizeCollections(
                "_jobs",
                10
            ),
            [
                "_jobs"
            ]
        );

        assert.throws(
            function () {
                normalizeCollections(
                    [],
                    10
                );
            },
            /At least one cleanup collection/
        );
    }
);

test(
    "normalizeCollections enforces maximum count",
    function () {
        assert.throws(
            function () {
                normalizeCollections(
                    [
                        "_one",
                        "_two"
                    ],
                    1
                );
            },
            function (
                error
            ) {
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

test(
    "field and direction normalizers validate values",
    function () {
        assert.equal(
            normalizeFieldPath(
                "retention.expiresAt",
                "expiresAt",
                "Field"
            ),
            "retention.expiresAt"
        );

        assert.equal(
            normalizeDirection(
                "DESC"
            ),
            "desc"
        );

        assert.equal(
            normalizeDirection(
                "invalid"
            ),
            "asc"
        );

        assert.throws(
            function () {
                normalizeFieldPath(
                    "expires-at",
                    "expiresAt",
                    "Field"
                );
            },
            /Field is invalid/
        );
    }
);

test(
    "batch and query size normalizers apply limits",
    function () {
        assert.equal(
            normalizeBatchSize(
                undefined
            ),
            100
        );

        assert.equal(
            normalizeBatchSize(
                1000
            ),
            500
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
    }
);

test(
    "integer normalizers validate values",
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
    }
);

/* ==========================================================
   NESTED VALUES AND EXPIRATION
========================================================== */

test(
    "getNestedValue reads nested properties",
    function () {
        const record = {
            retention: {
                expiresAt:
                    5000
            }
        };

        assert.equal(
            getNestedValue(
                record,
                "retention.expiresAt"
            ),
            5000
        );

        assert.equal(
            getNestedValue(
                record,
                "retention.missing"
            ),
            undefined
        );

        assert.equal(
            getNestedValue(
                null,
                "retention.expiresAt"
            ),
            undefined
        );
    }
);

test(
    "isRecordExpired identifies expired records",
    function () {
        assert.equal(
            isRecordExpired(
                createStoredRecord({
                    expiresAt:
                        TestTimestamp
                            .fromMillis(
                                3000
                            )
                }),
                5000,
                {
                    expirationField:
                        "expiresAt"
                }
            ),
            true
        );

        assert.equal(
            isRecordExpired(
                createStoredRecord({
                    expiresAt:
                        TestTimestamp
                            .fromMillis(
                                7000
                            )
                }),
                5000,
                {
                    expirationField:
                        "expiresAt"
                }
            ),
            false
        );
    }
);

test(
    "isRecordExpired supports nested expiration fields",
    function () {
        assert.equal(
            isRecordExpired(
                {
                    retention: {
                        expiresAt:
                            TestTimestamp
                                .fromMillis(
                                    3000
                                )
                    }
                },
                5000,
                {
                    expirationField:
                        "retention.expiresAt"
                }
            ),
            true
        );
    }
);

test(
    "isRecordExpired ignores missing and invalid dates",
    function () {
        assert.equal(
            isRecordExpired(
                {},
                5000,
                {
                    expirationField:
                        "expiresAt"
                }
            ),
            false
        );

        assert.equal(
            isRecordExpired(
                {
                    expiresAt:
                        "invalid"
                },
                5000,
                {
                    expirationField:
                        "expiresAt"
                }
            ),
            false
        );

        assert.equal(
            isRecordExpired(
                null,
                5000,
                {}
            ),
            false
        );
    }
);

/* ==========================================================
   LOAD EXPIRED RECORDS
========================================================== */

test(
    "loadExpiredRecords returns expired records ordered by date",
    async function () {
        const firestore =
            createFirestoreStub({
                "_jobs/one":
                    createStoredRecord({
                        expiresAt:
                            TestTimestamp
                                .fromMillis(
                                    3000
                                )
                    }),

                "_jobs/two":
                    createStoredRecord({
                        expiresAt:
                            TestTimestamp
                                .fromMillis(
                                    1000
                                )
                    }),

                "_jobs/future":
                    createStoredRecord({
                        expiresAt:
                            TestTimestamp
                                .fromMillis(
                                    9000
                                )
                    })
            });

        const records =
            await loadExpiredRecords(
                createRuntime({
                    firestore:
                        firestore
                }),
                "_jobs",
                {
                    batchSize:
                        100,

                    expirationField:
                        "expiresAt",

                    orderField:
                        "expiresAt",

                    direction:
                        "asc",

                    now:
                        function () {
                            return 5000;
                        }
                }
            );

        assert.deepEqual(
            records.map(
                function (
                    record
                ) {
                    return record.id;
                }
            ),
            [
                "two",
                "one"
            ]
        );

        assert.equal(
            typeof records[0]
                .reference
                .delete,
            "function"
        );
    }
);

test(
    "loadExpiredRecords respects batch size",
    async function () {
        const firestore =
            createFirestoreStub({
                "_jobs/one":
                    createStoredRecord(),

                "_jobs/two":
                    createStoredRecord(),

                "_jobs/three":
                    createStoredRecord()
            });

        const records =
            await loadExpiredRecords(
                createRuntime({
                    firestore:
                        firestore
                }),
                "_jobs",
                {
                    batchSize:
                        2,

                    expirationField:
                        "expiresAt",

                    orderField:
                        "expiresAt",

                    direction:
                        "asc",

                    now:
                        function () {
                            return 5000;
                        }
                }
            );

        assert.equal(
            records.length,
            2
        );
    }
);

/* ==========================================================
   DELETE RECORDS
========================================================== */

test(
    "deleteRecordsWithBatch deletes all records",
    async function () {
        const firestore =
            createFirestoreStub({
                "_jobs/one":
                    createStoredRecord(),

                "_jobs/two":
                    createStoredRecord()
            });

        const runtime =
            createRuntime({
                firestore:
                    firestore
            });

        const records = [
            {
                id:
                    "one",

                reference:
                    runtime.db
                        .collection(
                            "_jobs"
                        )
                        .doc(
                            "one"
                        )
            },
            {
                id:
                    "two",

                reference:
                    runtime.db
                        .collection(
                            "_jobs"
                        )
                        .doc(
                            "two"
                        )
            }
        ];

        const deleted =
            await deleteRecordsWithBatch(
                runtime,
                "_jobs",
                records
            );

        assert.equal(
            deleted,
            2
        );

        assert.equal(
            firestore.count(
                "_jobs"
            ),
            0
        );
    }
);

test(
    "deleteRecordsSequentially deletes all records",
    async function () {
        const firestore =
            createFirestoreStub(
                {
                    "_jobs/one":
                        createStoredRecord(),

                    "_jobs/two":
                        createStoredRecord()
                },
                {
                    batch:
                        false
                }
            );

        const runtime =
            createRuntime({
                firestore:
                    firestore
            });

        const records = [
            {
                id:
                    "one",

                reference:
                    runtime.db
                        .collection(
                            "_jobs"
                        )
                        .doc(
                            "one"
                        )
            },
            {
                id:
                    "two",

                reference:
                    runtime.db
                        .collection(
                            "_jobs"
                        )
                        .doc(
                            "two"
                        )
            }
        ];

        const deleted =
            await deleteRecordsSequentially(
                runtime,
                "_jobs",
                records
            );

        assert.equal(
            deleted,
            2
        );

        assert.equal(
            firestore.count(
                "_jobs"
            ),
            0
        );
    }
);

test(
    "deleteCleanupRecords uses Firestore batch when available",
    async function () {
        const firestore =
            createFirestoreStub({
                "_jobs/one":
                    createStoredRecord()
            });

        const runtime =
            createRuntime({
                firestore:
                    firestore
            });

        const deleted =
            await deleteCleanupRecords(
                runtime,
                "_jobs",
                [
                    {
                        id:
                            "one",

                        reference:
                            runtime.db
                                .collection(
                                    "_jobs"
                                )
                                .doc(
                                    "one"
                                )
                    }
                ],
                {
                    dryRun:
                        false
                }
            );

        assert.equal(
            deleted,
            1
        );

        assert.equal(
            firestore.hasDocument(
                "_jobs/one"
            ),
            false
        );
    }
);

test(
    "deleteCleanupRecords skips deletion during dry run",
    async function () {
        const firestore =
            createFirestoreStub({
                "_jobs/one":
                    createStoredRecord()
            });

        const runtime =
            createRuntime({
                firestore:
                    firestore
            });

        const deleted =
            await deleteCleanupRecords(
                runtime,
                "_jobs",
                [
                    {
                        id:
                            "one",

                        reference:
                            runtime.db
                                .collection(
                                    "_jobs"
                                )
                                .doc(
                                    "one"
                                )
                    }
                ],
                {
                    dryRun:
                        true
                }
            );

        assert.equal(
            deleted,
            0
        );

        assert.equal(
            firestore.hasDocument(
                "_jobs/one"
            ),
            true
        );
    }
);

test(
    "deleteCleanupRecords returns zero for empty input",
    async function () {
        assert.equal(
            await deleteCleanupRecords(
                createRuntime(),
                "_jobs",
                [],
                {}
            ),
            0
        );
    }
);

/* ==========================================================
   CLEANUP COLLECTION
========================================================== */

test(
    "cleanupCollection deletes expired records",
    async function () {
        const firestore =
            createFirestoreStub({
                "_jobs/one":
                    createStoredRecord({
                        expiresAt:
                            TestTimestamp
                                .fromMillis(
                                    1000
                                )
                    }),

                "_jobs/two":
                    createStoredRecord({
                        expiresAt:
                            TestTimestamp
                                .fromMillis(
                                    2000
                                )
                    }),

                "_jobs/future":
                    createStoredRecord({
                        expiresAt:
                            TestTimestamp
                                .fromMillis(
                                    9000
                                )
                    })
            });

        let now =
            5000;

        const result =
            await cleanupCollection(
                createRuntime({
                    firestore:
                        firestore
                }),
                "_jobs",
                {
                    collections: [
                        "_jobs"
                    ],

                    batchSize:
                        100,

                    maxPasses:
                        10,

                    includeDeletedIds:
                        true,

                    now:
                        function () {
                            return now;
                        }
                }
            );

        assert.equal(
            result.status,
            "completed"
        );

        assert.equal(
            result.complete,
            true
        );

        assert.equal(
            result.matchedCount,
            2
        );

        assert.equal(
            result.deletedCount,
            2
        );

        assert.deepEqual(
            result.deletedIds,
            [
                "one",
                "two"
            ]
        );

        assert.equal(
            firestore.hasDocument(
                "_jobs/future"
            ),
            true
        );
    }
);

test(
    "cleanupCollection processes multiple passes",
    async function () {
        const firestore =
            createFirestoreStub({
                "_jobs/one":
                    createStoredRecord(),

                "_jobs/two":
                    createStoredRecord(),

                "_jobs/three":
                    createStoredRecord()
            });

        const result =
            await cleanupCollection(
                createRuntime({
                    firestore:
                        firestore
                }),
                "_jobs",
                {
                    collections: [
                        "_jobs"
                    ],

                    batchSize:
                        2,

                    maxPasses:
                        10,

                    now:
                        function () {
                            return 5000;
                        }
                }
            );

        assert.equal(
            result.complete,
            true
        );

        assert.equal(
            result.passes,
            2
        );

        assert.equal(
            result.deletedCount,
            3
        );

        assert.equal(
            firestore.count(
                "_jobs"
            ),
            0
        );
    }
);

test(
    "cleanupCollection reports partial when pass limit is reached",
    async function () {
        const firestore =
            createFirestoreStub({
                "_jobs/one":
                    createStoredRecord(),

                "_jobs/two":
                    createStoredRecord(),

                "_jobs/three":
                    createStoredRecord()
            });

        const result =
            await cleanupCollection(
                createRuntime({
                    firestore:
                        firestore
                }),
                "_jobs",
                {
                    collections: [
                        "_jobs"
                    ],

                    batchSize:
                        1,

                    maxPasses:
                        1,

                    now:
                        function () {
                            return 5000;
                        }
                }
            );

        assert.equal(
            result.status,
            "partial"
        );

        assert.equal(
            result.complete,
            false
        );

        assert.equal(
            result.deletedCount,
            1
        );

        assert.equal(
            firestore.count(
                "_jobs"
            ),
            2
        );
    }
);

test(
    "cleanupCollection supports dry run",
    async function () {
        const firestore =
            createFirestoreStub({
                "_jobs/one":
                    createStoredRecord(),

                "_jobs/two":
                    createStoredRecord()
            });

        const result =
            await cleanupCollection(
                createRuntime({
                    firestore:
                        firestore
                }),
                "_jobs",
                {
                    collections: [
                        "_jobs"
                    ],

                    dryRun:
                        true,

                    batchSize:
                        100,

                    maxPasses:
                        10,

                    includeDeletedIds:
                        true,

                    now:
                        function () {
                            return 5000;
                        }
                }
            );

        assert.equal(
            result.dryRun,
            true
        );

        assert.equal(
            result.matchedCount,
            2
        );

        assert.equal(
            result.deletedCount,
            0
        );

        assert.equal(
            firestore.count(
                "_jobs"
            ),
            2
        );
    }
);

test(
    "cleanupCollection returns disabled result",
    async function () {
        const result =
            await cleanupCollection(
                null,
                "_jobs",
                {
                    collections: [
                        "_jobs"
                    ],

                    disabled:
                        true,

                    now:
                        function () {
                            return 5000;
                        }
                }
            );

        assert.equal(
            result.status,
            "disabled"
        );

        assert.equal(
            result.disabled,
            true
        );

        assert.equal(
            result.deletedCount,
            0
        );
    }
);

/* ==========================================================
   RUN CLEANUP
========================================================== */

test(
    "runCleanup cleans configured collections",
    async function () {
        const firestore =
            createFirestoreStub({
                "_jobs/job-1":
                    createStoredRecord(),

                "_locks/lock-1":
                    createStoredRecord(),

                "_jobs/future":
                    createStoredRecord({
                        expiresAt:
                            TestTimestamp
                                .fromMillis(
                                    9000
                                )
                    })
            });

        const result =
            await runCleanup(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    collections: [
                        "_jobs",
                        "_locks"
                    ],

                    batchSize:
                        100,

                    now:
                        function () {
                            return 5000;
                        }
                }
            );

        assert.equal(
            result.status,
            "completed"
        );

        assert.equal(
            result.collectionCount,
            2
        );

        assert.equal(
            result.matchedCount,
            2
        );

        assert.equal(
            result.deletedCount,
            2
        );

        assert.equal(
            result.errorCount,
            0
        );

        assert.equal(
            firestore.hasDocument(
                "_jobs/future"
            ),
            true
        );
    }
);

test(
    "runCleanup returns partial summary when one collection fails",
    async function () {
        const firestore =
            createFirestoreStub(
                {
                    "_jobs/job-1":
                        createStoredRecord(),

                    "_locks/lock-1":
                        createStoredRecord()
                },
                {
                    queryFailureCollections: [
                        "_locks"
                    ]
                }
            );

        const result =
            await runCleanup(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    collections: [
                        "_jobs",
                        "_locks"
                    ],

                    stopOnError:
                        false,

                    now:
                        function () {
                            return 5000;
                        }
                }
            );

        assert.equal(
            result.status,
            "partial"
        );

        assert.equal(
            result.deletedCount,
            1
        );

        assert.equal(
            result.errorCount,
            1
        );

        assert.equal(
            result.collections[1]
                .status,
            "failed"
        );
    }
);

test(
    "runCleanup returns failed when every collection fails",
    async function () {
        const firestore =
            createFirestoreStub(
                {},
                {
                    queryFailureCollections: [
                        "_jobs"
                    ]
                }
            );

        const result =
            await runCleanup(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    collections: [
                        "_jobs"
                    ],

                    stopOnError:
                        false,

                    now:
                        function () {
                            return 5000;
                        }
                }
            );

        assert.equal(
            result.status,
            "failed"
        );

        assert.equal(
            result.deletedCount,
            0
        );

        assert.equal(
            result.errorCount,
            1
        );
    }
);

test(
    "runCleanup stops on first error when configured",
    async function () {
        const firestore =
            createFirestoreStub(
                {},
                {
                    queryFailureCollections: [
                        "_jobs"
                    ]
                }
            );

        await assert.rejects(
            async function () {
                await runCleanup(
                    createRuntime({
                        firestore:
                            firestore
                    }),
                    {
                        collections: [
                            "_jobs",
                            "_locks"
                        ],

                        stopOnError:
                            true,

                        now:
                            function () {
                                return 5000;
                            }
                    }
                );
            },
            /Query failed/
        );
    }
);

test(
    "runCleanup returns disabled summary",
    async function () {
        const result =
            await runCleanup(
                null,
                {
                    collections: [
                        "_jobs"
                    ],

                    disabled:
                        true,

                    dryRun:
                        true,

                    now:
                        function () {
                            return 5000;
                        }
                }
            );

        assert.equal(
            result.status,
            "disabled"
        );

        assert.equal(
            result.disabled,
            true
        );

        assert.equal(
            result.dryRun,
            true
        );

        assert.equal(
            result.collectionCount,
            0
        );
    }
);

/* ==========================================================
   INSPECTION
========================================================== */

test(
    "inspectExpiredRecords returns expired records without deleting",
    async function () {
        const firestore =
            createFirestoreStub({
                "_jobs/one":
                    createStoredRecord(),

                "_jobs/future":
                    createStoredRecord({
                        expiresAt:
                            TestTimestamp
                                .fromMillis(
                                    9000
                                )
                    })
            });

        const result =
            await inspectExpiredRecords(
                createRuntime({
                    firestore:
                        firestore
                }),
                "_jobs",
                {
                    collections: [
                        "_jobs"
                    ],

                    now:
                        function () {
                            return 5000;
                        }
                }
            );

        assert.equal(
            result.collection,
            "_jobs"
        );

        assert.equal(
            result.count,
            1
        );

        assert.equal(
            result.records[0].id,
            "one"
        );

        assert.equal(
            firestore.count(
                "_jobs"
            ),
            2
        );
    }
);

test(
    "inspectExpiredRecords returns disabled result",
    async function () {
        const result =
            await inspectExpiredRecords(
                null,
                "_jobs",
                {
                    collections: [
                        "_jobs"
                    ],

                    disabled:
                        true
                }
            );

        assert.deepEqual(
            result,
            {
                collection:
                    "_jobs",

                records:
                    [],

                count:
                    0,

                disabled:
                    true
            }
        );
    }
);

test(
    "sanitizeExpiredRecord serializes timestamps",
    function () {
        const result =
            sanitizeExpiredRecord({
                id:
                    "record-1",

                data:
                    createStoredRecord()
            });

        assert.equal(
            result.id,
            "record-1"
        );

        assert.equal(
            result.expiresAt,
            new Date(
                3000
            ).toISOString()
        );

        assert.equal(
            result.createdAt,
            new Date(
                1000
            ).toISOString()
        );

        assert.equal(
            result.updatedAt,
            new Date(
                2000
            ).toISOString()
        );
    }
);

/* ==========================================================
   SUMMARY BUILDERS
========================================================== */

test(
    "createCleanupSummary creates aggregate result",
    function () {
        const summary =
            createCleanupSummary({
                status:
                    "completed",

                dryRun:
                    false,

                matchedCount:
                    5,

                deletedCount:
                    4,

                errorCount:
                    1,

                collections: [
                    {
                        collection:
                            "_jobs"
                    }
                ],

                startedAt:
                    1000,

                completedAt:
                    3000
            });

        assert.equal(
            summary.status,
            "completed"
        );

        assert.equal(
            summary.matchedCount,
            5
        );

        assert.equal(
            summary.deletedCount,
            4
        );

        assert.equal(
            summary.errorCount,
            1
        );

        assert.equal(
            summary.collectionCount,
            1
        );

        assert.equal(
            summary.durationMs,
            2000
        );
    }
);

test(
    "createCollectionCleanupResult normalizes output",
    function () {
        const result =
            createCollectionCleanupResult({
                collection:
                    "_jobs",

                status:
                    "partial",

                dryRun:
                    false,

                complete:
                    false,

                passes:
                    2,

                matchedCount:
                    10,

                deletedCount:
                    5,

                deletedIds: [
                    "one",
                    "two"
                ],

                startedAt:
                    1000,

                completedAt:
                    2500
            });

        assert.equal(
            result.collection,
            "_jobs"
        );

        assert.equal(
            result.status,
            "partial"
        );

        assert.equal(
            result.complete,
            false
        );

        assert.equal(
            result.passes,
            2
        );

        assert.equal(
            result.durationMs,
            1500
        );

        assert.deepEqual(
            result.deletedIds,
            [
                "one",
                "two"
            ]
        );
    }
);

test(
    "createCollectionCleanupFailure serializes error",
    function () {
        const failure =
            createCollectionCleanupFailure(
                "_jobs",
                new Error(
                    "Cleanup failed."
                )
            );

        assert.equal(
            failure.collection,
            "_jobs"
        );

        assert.equal(
            failure.status,
            "failed"
        );

        assert.equal(
            failure.complete,
            false
        );

        assert.equal(
            failure.error.message,
            "Cleanup failed."
        );
    }
);

test(
    "calculateDuration returns safe non-negative value",
    function () {
        assert.equal(
            calculateDuration(
                1000,
                3000
            ),
            2000
        );

        assert.equal(
            calculateDuration(
                3000,
                1000
            ),
            0
        );

        assert.equal(
            calculateDuration(
                Number.NaN,
                1000
            ),
            0
        );
    }
);

/* ==========================================================
   ERROR SERIALIZATION
========================================================== */

test(
    "serializeCleanupError returns safe metadata",
    function () {
        const error =
            new ServiceError(
                "cleanup-error",
                "Cleanup failed.",
                {
                    status:
                        503,

                    retryable:
                        true
                }
            );

        assert.deepEqual(
            serializeCleanupError(
                error
            ),
            {
                name:
                    "ServiceError",

                code:
                    "cleanup-error",

                message:
                    "Cleanup failed.",

                status:
                    503,

                retryable:
                    true
            }
        );
    }
);

test(
    "serializeCleanupError handles null",
    function () {
        assert.equal(
            serializeCleanupError(
                null
            ),
            null
        );
    }
);

/* ==========================================================
   RUNTIME AND TIME
========================================================== */

test(
    "assertCleanupRuntime validates runtime",
    function () {
        assert.doesNotThrow(
            function () {
                assertCleanupRuntime(
                    createRuntime()
                );
            }
        );

        assert.throws(
            function () {
                assertCleanupRuntime(
                    null
                );
            },
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "configuration-error"
                );

                assert.equal(
                    error.status,
                    500
                );

                return true;
            }
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
    "resolveNow falls back to runtime clock",
    function () {
        assert.equal(
            resolveNow(
                {
                    now:
                        function () {
                            return 1500;
                        }
                },
                {}
            ),
            1500
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

        assert.equal(
            serializeTimestamp(
                null
            ),
            null
        );
    }
);

/* ==========================================================
   LOGGING
========================================================== */

test(
    "logCleanupEvent logs completed cleanup",
    function () {
        const logger =
            createLoggerStub();

        logCleanupEvent(
            {
                logger:
                    logger
            },
            {
                status:
                    "completed",

                deletedCount:
                    5
            },
            "completed",
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
            "Cleanup event."
        );
    }
);

test(
    "logCleanupEvent logs partial cleanup as warning",
    function () {
        const logger =
            createLoggerStub();

        logCleanupEvent(
            {
                logger:
                    logger
            },
            {
                status:
                    "partial"
            },
            "completed",
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
            "Cleanup completed partially."
        );
    }
);

test(
    "logCleanupEvent logs failed cleanup as error",
    function () {
        const logger =
            createLoggerStub();

        logCleanupEvent(
            {
                logger:
                    logger
            },
            {
                status:
                    "failed"
            },
            "completed",
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
            "Cleanup failed."
        );
    }
);

test(
    "logCleanupFailure logs collection failure",
    function () {
        const logger =
            createLoggerStub();

        logCleanupFailure(
            {
                logger:
                    logger
            },
            {
                collection:
                    "_jobs",

                error: {
                    message:
                        "Failure."
                }
            },
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
            "error"
        );

        assert.equal(
            logger.entries[0].message,
            "Collection cleanup failed."
        );
    }
);

test(
    "cleanup logging can be disabled",
    function () {
        const logger =
            createLoggerStub();

        logCleanupEvent(
            {
                logger:
                    logger
            },
            {
                status:
                    "completed"
            },
            "completed",
            {
                log:
                    false
            }
        );

        logCleanupFailure(
            {
                logger:
                    logger
            },
            {
                collection:
                    "_jobs"
            },
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
    "cleanup constants expose expected defaults",
    function () {
        assert.equal(
            constants
                .DEFAULT_BATCH_SIZE,
            100
        );

        assert.equal(
            constants.MAX_BATCH_SIZE,
            500
        );

        assert.equal(
            constants
                .DEFAULT_QUERY_LIMIT,
            100
        );

        assert.equal(
            constants.MAX_QUERY_LIMIT,
            500
        );

        assert.equal(
            constants
                .DEFAULT_MAX_COLLECTIONS,
            50
        );

        assert.equal(
            constants
                .DEFAULT_MAX_PASSES,
            100
        );

        assert.equal(
            constants
                .DEFAULT_EXPIRATION_FIELD,
            "expiresAt"
        );

        assert.equal(
            constants
                .DEFAULT_ORDER_FIELD,
            "expiresAt"
        );

        assert.equal(
            constants
                .DEFAULT_DIRECTION,
            "asc"
        );

        assert.deepEqual(
            constants
                .CLEANUP_STATUSES,
            {
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
            }
        );

        assert.deepEqual(
    constants.DEFAULT_EXPIRING_COLLECTIONS,
    [
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
    ]
);

        assert.equal(
            Object.isFrozen(
                constants
                    .DEFAULT_EXPIRING_COLLECTIONS
            ),
            true
        );
    }
);