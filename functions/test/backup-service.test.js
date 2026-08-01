"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   BACKUP SERVICE TEST SUITE
========================================================== */

const test =
    require("node:test");

const assert =
    require("node:assert/strict");

const {
    createBackupService,
    exportBackup,
    exportBackupCollection,
    restoreBackup,
    restoreBackupCollection,
    restoreBackupDocument,
    inspectBackup,
    createBackupManifest,
    normalizeBackupPayload,
    normalizeBackupManifest,
    normalizeBackupCollectionsPayload,
    normalizeBackupRecords,
    encodeBackupValue,
    decodeBackupValue,
    createBackupChecksum,
    hashBackupValue,
    getBackupRun,
    queryBackupRuns,
    normalizeBackupQuery,
    cancelBackupRun,
    createBackupResult,
    createBackupRunRecord,
    sanitizeBackupRunRecord,
    normalizeBackupExportInput,
    normalizeBackupRunId,
    normalizeBackupDocumentId,
    normalizeBackupStatus,
    normalizeBackupOperation,
    normalizeBackupFormat,
    normalizeRestoreMode,
    normalizeCollections,
    normalizeCollection,
    normalizeBackupDate,
    normalizeBackupOrderField,
    normalizeDirection,
    normalizeQueryLimit,
    normalizeBatchSize,
    normalizePositiveInteger,
    normalizeNonNegativeInteger,
    normalizeOptionalString,
    sanitizeBackupMetadata,
    normalizeBackupOptions,
    stableStringify,
    normalizeStableValue,
    assertSerializableBackupValue,
    serializeBackupError,
    createBackupRunNotFoundError,
    createBackupRunId,
    assertBackupRuntime,
    resolveNow,
    createDatabaseTimestamp,
    toMilliseconds,
    serializeTimestamp,
    calculateDuration,
    logBackupEvent,
    constants
} = require(
    "../src/shared/backup-service"
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

function getNestedValue(
    object,
    path
) {
    return String(
        path
    )
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

    switch (
        operator
    ) {
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
                clone(
                    value
                )
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
                    if (
                        settings.writeFailurePaths &&
                        settings
                            .writeFailurePaths
                            .includes(
                                path
                            )
                    ) {
                        throw new Error(
                            "Write failed for " +
                            path
                        );
                    }

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
                function (
                    count
                ) {
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
                                            clone(
                                                value
                                            )
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
                                    left <
                                    right
                                ) {
                                    return -1 *
                                        multiplier;
                                }

                                if (
                                    left >
                                    right
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
                            setOptions
                        ) {
                            writes.push({
                                reference:
                                    reference,

                                value:
                                    clone(
                                        value
                                    ),

                                options:
                                    setOptions
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
                    await write.reference.set(
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

        count:
            function (
                collectionName
            ) {
                return Array.from(
                    documents.keys()
                ).filter(
                    function (
                        path
                    ) {
                        return path
                            .startsWith(
                                collectionName +
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

function backupRunPath(
    id
) {
    return (
        constants
            .BACKUP_COLLECTION +
        "/" +
        id
    );
}

function createStoredBackupRun(
    overrides
) {
    return Object.assign(
        {
            id:
                "backup-1",

            operation:
                "export",

            status:
                "completed",

            disabled:
                false,

            dryRun:
                false,

            collections: [
                "orders"
            ],

            collectionResults: [
                {
                    collection:
                        "orders",

                    status:
                        "completed",

                    documentCount:
                        2
                }
            ],

            collectionCount:
                1,

            documentCount:
                2,

            writtenCount:
                0,

            skippedCount:
                0,

            errorCount:
                0,

            error:
                null,

            cancellationReason:
                null,

            startedAt:
                TestTimestamp
                    .fromMillis(
                        1000
                    ),

            completedAt:
                TestTimestamp
                    .fromMillis(
                        2000
                    ),

            cancelledAt:
                null,

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
                        10000
                    ),

            schemaVersion:
                1
        },
        overrides || {}
    );
}

function createBackupPayload(
    overrides
) {
    const collections =
        Object.assign(
            {
                orders: [
                    {
                        id:
                            "order-1",

                        data: {
                            totalMinor:
                                12500,

                            currency:
                                "GBP",

                            createdAt: {
                                __backupType:
                                    "timestamp",

                                value:
                                    1000
                            }
                        }
                    }
                ]
            },
            overrides &&
            overrides.collections
                ? overrides.collections
                : {}
        );

    return {
        manifest:
            Object.assign(
                {
                    id:
                        "backup-1",

                    format:
                        "json",

                    schemaVersion:
                        1,

                    createdAt:
                        new Date(
                            1000
                        ).toISOString(),

                    collectionCount:
                        Object.keys(
                            collections
                        ).length,

                    documentCount:
                        Object.values(
                            collections
                        ).reduce(
                            function (
                                total,
                                records
                            ) {
                                return (
                                    total +
                                    records.length
                                );
                            },
                            0
                        ),

                    collections:
                        Object.keys(
                            collections
                        ),

                    checksum:
                        createBackupChecksum(
                            collections
                        ),

                    metadata:
                        {}
                },
                overrides &&
                overrides.manifest
                    ? overrides.manifest
                    : {}
            ),

        collections:
            collections
    };
}

/* ==========================================================
   SERVICE FACTORY
========================================================== */

test(
    "createBackupService creates a frozen service",
    function () {
        const runtime =
            createRuntime();

        const service =
            createBackupService({
                runtime:
                    runtime,

                collections: [
                    "orders",
                    "products"
                ]
            });

        assert.equal(
            service.runtime,
            runtime
        );

        assert.deepEqual(
            service.options.collections,
            [
                "orders",
                "products"
            ]
        );

        assert.equal(
            typeof service.export,
            "function"
        );

        assert.equal(
            typeof service.restore,
            "function"
        );

        assert.equal(
            typeof service.inspect,
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
            typeof service.cancel,
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
    "normalizeBackupOptions applies defaults",
    function () {
        const options =
            normalizeBackupOptions(
                {}
            );

        assert.equal(
            options.collection,
            "_backupRuns"
        );

        assert.deepEqual(
            options.collections,
            []
        );

        assert.equal(
            options.format,
            "json"
        );

        assert.equal(
            options.restoreMode,
            "create"
        );

        assert.equal(
            options.batchSize,
            100
        );

        assert.equal(
            options.queryLimit,
            100
        );

        assert.equal(
            options.maxCollections,
            100
        );

        assert.equal(
            options.maxDocuments,
            50000
        );

        assert.equal(
            options.maxBackupBytes,
            26214400
        );

        assert.equal(
            options.retentionMs,
            7776000000
        );

        assert.equal(
            options.verifyChecksum,
            true
        );

        assert.equal(
            options.persistRuns,
            true
        );

        assert.equal(
            options.returnFailures,
            true
        );
    }
);

test(
    "normalizeBackupOptions respects overrides",
    function () {
        const options =
            normalizeBackupOptions({
                collection:
                    "backupRuns",

                collections: [
                    "orders"
                ],

                restoreMode:
                    "merge",

                batchSize:
                    25,

                queryLimit:
                    20,

                maxCollections:
                    10,

                maxDocuments:
                    100,

                maxBackupBytes:
                    10000,

                retentionMs:
                    5000,

                orderField:
                    "createdAt",

                direction:
                    "desc",

                runId:
                    "backup-1",

                dryRun:
                    true,

                disabled:
                    true,

                stopOnError:
                    true,

                verifyChecksum:
                    false,

                persistRuns:
                    false,

                returnFailures:
                    false,

                log:
                    false
            });

        assert.equal(
            options.collection,
            "backupRuns"
        );

        assert.deepEqual(
            options.collections,
            [
                "orders"
            ]
        );

        assert.equal(
            options.restoreMode,
            "merge"
        );

        assert.equal(
            options.batchSize,
            25
        );

        assert.equal(
            options.queryLimit,
            20
        );

        assert.equal(
            options.orderField,
            "createdAt"
        );

        assert.equal(
            options.direction,
            "desc"
        );

        assert.equal(
            options.runId,
            "backup-1"
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
            options.verifyChecksum,
            false
        );

        assert.equal(
            options.persistRuns,
            false
        );

        assert.equal(
            options.returnFailures,
            false
        );

        assert.equal(
            options.log,
            false
        );
    }
);

/* ==========================================================
   NORMALIZERS
========================================================== */

test(
    "backup identifier normalizers validate values",
    function () {
        assert.equal(
            normalizeBackupRunId(
                " backup-1 "
            ),
            "backup-1"
        );

        assert.equal(
            normalizeBackupDocumentId(
                " order-1 "
            ),
            "order-1"
        );

        assert.throws(
            function () {
                normalizeBackupRunId(
                    "backups/one"
                );
            },
            /run ID is invalid/
        );

        assert.throws(
            function () {
                normalizeBackupDocumentId(
                    ""
                );
            },
            /document ID is invalid/
        );
    }
);

test(
    "backup status, operation, format, and restore mode normalize",
    function () {
        assert.equal(
            normalizeBackupStatus(
                "COMPLETED"
            ),
            "completed"
        );

        assert.equal(
            normalizeBackupOperation(
                "RESTORE"
            ),
            "restore"
        );

        assert.equal(
            normalizeBackupFormat(
                "JSON"
            ),
            "json"
        );

        assert.equal(
            normalizeRestoreMode(
                "OVERWRITE"
            ),
            "overwrite"
        );

        assert.throws(
            function () {
                normalizeBackupStatus(
                    "unknown"
                );
            },
            /status is invalid/
        );

        assert.throws(
            function () {
                normalizeBackupOperation(
                    "copy"
                );
            },
            /operation is invalid/
        );

        assert.throws(
            function () {
                normalizeBackupFormat(
                    "csv"
                );
            },
            /format is unsupported/
        );

        assert.throws(
            function () {
                normalizeRestoreMode(
                    "replace-all"
                );
            },
            /restore mode is invalid/
        );
    }
);

test(
    "collection normalizers validate and deduplicate values",
    function () {
        assert.equal(
            normalizeCollection(
                "orders",
                "Collection"
            ),
            "orders"
        );

        assert.deepEqual(
            normalizeCollections(
                [
                    "orders",
                    "products",
                    "orders"
                ],
                10
            ),
            [
                "orders",
                "products"
            ]
        );

        assert.throws(
            function () {
                normalizeCollection(
                    "store/orders",
                    "Collection"
                );
            },
            /Firestore collection name/
        );

        assert.throws(
            function () {
                normalizeCollections(
                    [
                        "orders",
                        "products"
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

                return true;
            }
        );
    }
);

test(
    "numeric and query normalizers enforce limits",
    function () {
        assert.equal(
            normalizeBatchSize(
                1000
            ),
            500
        );

        assert.equal(
            normalizeQueryLimit(
                1000
            ),
            500
        );

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
            normalizeDirection(
                "DESC"
            ),
            "desc"
        );

        assert.equal(
            normalizeBackupOrderField(
                "documentCount"
            ),
            "documentCount"
        );

        assert.equal(
            normalizeBackupOrderField(
                "invalid"
            ),
            "startedAt"
        );
    }
);

/* ==========================================================
   VALUE ENCODING
========================================================== */

test(
    "encodeBackupValue serializes supported special values",
    function () {
        const encoded =
            encodeBackupValue({
                missing:
                    undefined,

                bigint:
                    10n,

                date:
                    new Date(
                        "2026-07-25T08:00:00.000Z"
                    ),

                buffer:
                    Buffer.from(
                        "hello"
                    ),

                timestamp:
                    TestTimestamp
                        .fromMillis(
                            1000
                        ),

                nested: [
                    true,
                    10
                ]
            });

        assert.deepEqual(
            encoded,
            {
                missing: {
                    __backupType:
                        "undefined"
                },

                bigint: {
                    __backupType:
                        "bigint",

                    value:
                        "10"
                },

                date: {
                    __backupType:
                        "date",

                    value:
                        "2026-07-25T08:00:00.000Z"
                },

                buffer: {
                    __backupType:
                        "buffer",

                    value:
                        "aGVsbG8="
                },

                timestamp: {
                    __backupType:
                        "timestamp",

                    value:
                        1000
                },

                nested: [
                    true,
                    10
                ]
            }
        );
    }
);

test(
    "decodeBackupValue restores supported special values",
    function () {
        const decoded =
            decodeBackupValue(
                {
                    date: {
                        __backupType:
                            "date",

                        value:
                            "2026-07-25T08:00:00.000Z"
                    },

                    timestamp: {
                        __backupType:
                            "timestamp",

                        value:
                            1000
                    },

                    buffer: {
                        __backupType:
                            "buffer",

                        value:
                            "aGVsbG8="
                    },

                    bigint: {
                        __backupType:
                            "bigint",

                        value:
                            "10"
                    },

                    missing: {
                        __backupType:
                            "undefined"
                    }
                },
                {
                    Timestamp:
                        TestTimestamp
                }
            );

        assert.equal(
            decoded.date.toISOString(),
            "2026-07-25T08:00:00.000Z"
        );

        assert.equal(
            decoded.timestamp.toMillis(),
            1000
        );

        assert.equal(
            decoded.buffer.toString(),
            "hello"
        );

        assert.equal(
            decoded.bigint,
            "10"
        );

        assert.equal(
            decoded.missing,
            null
        );
    }
);

test(
    "decodeBackupValue rejects unsupported encoded type",
    function () {
        assert.throws(
            function () {
                decodeBackupValue(
                    {
                        __backupType:
                            "unknown",

                        value:
                            "data"
                    },
                    {}
                );
            },
            /unsupported encoded value/
        );
    }
);

/* ==========================================================
   CHECKSUM AND MANIFEST
========================================================== */

test(
    "backup checksum is deterministic",
    function () {
        const first =
            createBackupChecksum({
                orders: [
                    {
                        id:
                            "order-1",

                        data: {
                            totalMinor:
                                1000
                        }
                    }
                ]
            });

        const second =
            createBackupChecksum({
                orders: [
                    {
                        id:
                            "order-1",

                        data: {
                            totalMinor:
                                1000
                        }
                    }
                ]
            });

        assert.equal(
            first,
            second
        );

        assert.match(
            first,
            /^[a-f0-9]{64}$/
        );

        assert.match(
            hashBackupValue(
                "backup"
            ),
            /^[a-f0-9]{64}$/
        );
    }
);

test(
    "createBackupManifest calculates counts and checksum",
    function () {
        const manifest =
            createBackupManifest({
                id:
                    "backup-1",

                format:
                    "json",

                createdAt:
                    1000,

                collections: {
                    orders: [
                        {
                            id:
                                "order-1",

                            data:
                                {}
                        }
                    ],

                    products: [
                        {
                            id:
                                "product-1",

                            data:
                                {}
                        },
                        {
                            id:
                                "product-2",

                            data:
                                {}
                        }
                    ]
                },

                metadata: {
                    environment:
                        "test"
                }
            });

        assert.equal(
            manifest.id,
            "backup-1"
        );

        assert.equal(
            manifest.collectionCount,
            2
        );

        assert.equal(
            manifest.documentCount,
            3
        );

        assert.deepEqual(
            manifest.collections,
            [
                "orders",
                "products"
            ]
        );

        assert.match(
            manifest.checksum,
            /^[a-f0-9]{64}$/
        );
    }
);

test(
    "normalizeBackupManifest validates schema version",
    function () {
        const manifest =
            normalizeBackupManifest({
                id:
                    "backup-1",

                format:
                    "json",

                schemaVersion:
                    1,

                createdAt:
                    1000,

                checksum:
                    "checksum"
            });

        assert.equal(
            manifest.id,
            "backup-1"
        );

        assert.equal(
            manifest.schemaVersion,
            1
        );

        assert.throws(
            function () {
                normalizeBackupManifest({
                    id:
                        "backup-1",

                    format:
                        "json",

                    schemaVersion:
                        2
                });
            },
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "failed-precondition"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   BACKUP PAYLOAD VALIDATION
========================================================== */

test(
    "normalizeBackupPayload validates checksum",
    function () {
        const backup =
            createBackupPayload();

        const normalized =
            normalizeBackupPayload(
                backup,
                {}
            );

        assert.equal(
            normalized.manifest.id,
            "backup-1"
        );

        assert.equal(
            normalized.manifest.collectionCount,
            1
        );

        assert.equal(
            normalized.manifest.documentCount,
            1
        );
    }
);

test(
    "normalizeBackupPayload rejects invalid checksum",
    function () {
        const backup =
            createBackupPayload({
                manifest: {
                    checksum:
                        "invalid"
                }
            });

        assert.throws(
            function () {
                normalizeBackupPayload(
                    backup,
                    {
                        verifyChecksum:
                            true
                    }
                );
            },
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "data-loss"
                );

                assert.equal(
                    error.status,
                    422
                );

                return true;
            }
        );
    }
);

test(
    "normalizeBackupRecords rejects duplicate document IDs",
    function () {
        assert.throws(
            function () {
                normalizeBackupRecords(
                    [
                        {
                            id:
                                "order-1",

                            data:
                                {}
                        },
                        {
                            id:
                                "order-1",

                            data:
                                {}
                        }
                    ],
                    {
                        maxDocuments:
                            100
                    }
                );
            },
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "already-exists"
                );

                return true;
            }
        );
    }
);

test(
    "normalizeBackupCollectionsPayload validates collection data",
    function () {
        const result =
            normalizeBackupCollectionsPayload(
                {
                    orders: [
                        {
                            id:
                                "order-1",

                            data:
                                {}
                        }
                    ]
                },
                normalizeBackupOptions({
                    maxCollections:
                        10,

                    maxDocuments:
                        100
                })
            );

        assert.equal(
            result.orders.length,
            1
        );
    }
);

/* ==========================================================
   EXPORT INPUT
========================================================== */

test(
    "normalizeBackupExportInput uses configured collections",
    function () {
        const result =
            normalizeBackupExportInput(
                {
                    id:
                        "backup-1",

                    metadata: {
                        reason:
                            "scheduled"
                    }
                },
                {
                    collections: [
                        "orders",
                        "products"
                    ]
                }
            );

        assert.equal(
            result.id,
            "backup-1"
        );

        assert.deepEqual(
            result.collections,
            [
                "orders",
                "products"
            ]
        );

        assert.deepEqual(
            result.metadata,
            {
                reason:
                    "scheduled"
            }
        );
    }
);

/* ==========================================================
   EXPORT COLLECTION
========================================================== */

test(
    "exportBackupCollection exports and encodes documents",
    async function () {
        const firestore =
            createFirestoreStub({
                "orders/order-1": {
                    totalMinor:
                        12500,

                    currency:
                        "GBP",

                    createdAt:
                        TestTimestamp
                            .fromMillis(
                                1000
                            )
                },

                "orders/order-2": {
                    totalMinor:
                        2500,

                    currency:
                        "GBP",

                    createdAt:
                        TestTimestamp
                            .fromMillis(
                                2000
                            )
                }
            });

        const records =
            await exportBackupCollection(
                createRuntime({
                    firestore:
                        firestore
                }),
                "orders",
                {
                    maxDocuments:
                        100,

                    maxBackupBytes:
                        100000,

                    orderField:
                        "createdAt",

                    direction:
                        "asc"
                }
            );

        assert.equal(
            records.length,
            2
        );

        assert.equal(
            records[0].id,
            "order-1"
        );

        assert.deepEqual(
            records[0]
                .data
                .createdAt,
            {
                __backupType:
                    "timestamp",

                value:
                    1000
            }
        );
    }
);

/* ==========================================================
   EXPORT BACKUP
========================================================== */

test(
    "exportBackup exports configured collections",
    async function () {
        const firestore =
            createFirestoreStub({
                "orders/order-1": {
                    totalMinor:
                        12500,

                    currency:
                        "GBP"
                },

                "products/product-1": {
                    name:
                        "Silk Scarf"
                }
            });

        const result =
            await exportBackup(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    id:
                        "backup-1",

                    collections: [
                        "orders",
                        "products"
                    ],

                    metadata: {
                        reason:
                            "scheduled"
                    }
                },
                {
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
            result.operation,
            "export"
        );

        assert.equal(
            result.collectionCount,
            2
        );

        assert.equal(
            result.documentCount,
            2
        );

        assert.equal(
            result.backup.manifest.id,
            "backup-1"
        );

        assert.equal(
            result.backup
                .collections
                .orders
                .length,
            1
        );

        assert.equal(
            firestore.hasDocument(
                backupRunPath(
                    "backup-1"
                )
            ),
            true
        );
    }
);

test(
    "exportBackup returns partial result when one collection fails",
    async function () {
        const firestore =
            createFirestoreStub(
                {
                    "orders/order-1": {
                        totalMinor:
                            1000
                    }
                },
                {
                    queryFailureCollections: [
                        "products"
                    ]
                }
            );

        const result =
            await exportBackup(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    id:
                        "backup-1",

                    collections: [
                        "orders",
                        "products"
                    ]
                },
                {
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
            result.documentCount,
            1
        );

        assert.equal(
            result.errorCount,
            1
        );

        assert.equal(
            result.collectionResults[1]
                .status,
            "failed"
        );
    }
);

test(
    "exportBackup returns disabled result",
    async function () {
        const result =
            await exportBackup(
                null,
                {
                    id:
                        "backup-1",

                    collections: [
                        "orders"
                    ]
                },
                {
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
    }
);

/* ==========================================================
   RESTORE DOCUMENT
========================================================== */

test(
    "restoreBackupDocument creates missing document",
    async function () {
        const firestore =
            createFirestoreStub();

        const result =
            await restoreBackupDocument(
                createRuntime({
                    firestore:
                        firestore
                }),
                "orders",
                {
                    id:
                        "order-1",

                    data: {
                        totalMinor:
                            12500,

                        createdAt: {
                            __backupType:
                                "timestamp",

                            value:
                                1000
                        }
                    }
                },
                {
                    restoreMode:
                        "create"
                }
            );

        assert.equal(
            result.written,
            true
        );

        const stored =
            firestore.getDocument(
                "orders/order-1"
            );

        assert.equal(
            stored.totalMinor,
            12500
        );

        assert.equal(
            stored.createdAt
                .toMillis(),
            1000
        );
    }
);

test(
    "restoreBackupDocument skips existing document in create mode",
    async function () {
        const firestore =
            createFirestoreStub({
                "orders/order-1": {
                    totalMinor:
                        1000
                }
            });

        const result =
            await restoreBackupDocument(
                createRuntime({
                    firestore:
                        firestore
                }),
                "orders",
                {
                    id:
                        "order-1",

                    data: {
                        totalMinor:
                            2000
                    }
                },
                {
                    restoreMode:
                        "create"
                }
            );

        assert.equal(
            result.written,
            false
        );

        assert.equal(
            result.skipped,
            true
        );

        assert.equal(
            firestore
                .getDocument(
                    "orders/order-1"
                )
                .totalMinor,
            1000
        );
    }
);

test(
    "restoreBackupDocument merges existing document",
    async function () {
        const firestore =
            createFirestoreStub({
                "orders/order-1": {
                    status:
                        "pending",

                    totalMinor:
                        1000
                }
            });

        await restoreBackupDocument(
            createRuntime({
                firestore:
                    firestore
            }),
            "orders",
            {
                id:
                    "order-1",

                data: {
                    status:
                        "paid"
                }
            },
            {
                restoreMode:
                    "merge"
            }
        );

        assert.deepEqual(
            firestore.getDocument(
                "orders/order-1"
            ),
            {
                status:
                    "paid",

                totalMinor:
                    1000
            }
        );
    }
);

test(
    "restoreBackupDocument overwrites existing document",
    async function () {
        const firestore =
            createFirestoreStub({
                "orders/order-1": {
                    status:
                        "pending",

                    totalMinor:
                        1000
                }
            });

        await restoreBackupDocument(
            createRuntime({
                firestore:
                    firestore
            }),
            "orders",
            {
                id:
                    "order-1",

                data: {
                    status:
                        "paid"
                }
            },
            {
                restoreMode:
                    "overwrite"
            }
        );

        assert.deepEqual(
            firestore.getDocument(
                "orders/order-1"
            ),
            {
                status:
                    "paid"
            }
        );
    }
);

/* ==========================================================
   RESTORE COLLECTION
========================================================== */

test(
    "restoreBackupCollection restores records",
    async function () {
        const firestore =
            createFirestoreStub();

        const result =
            await restoreBackupCollection(
                createRuntime({
                    firestore:
                        firestore
                }),
                "orders",
                [
                    {
                        id:
                            "order-1",

                        data: {
                            totalMinor:
                                1000
                        }
                    },
                    {
                        id:
                            "order-2",

                        data: {
                            totalMinor:
                                2000
                        }
                    }
                ],
                {
                    restoreMode:
                        "create",

                    batchSize:
                        1,

                    maxDocuments:
                        100
                }
            );

        assert.equal(
            result.status,
            "completed"
        );

        assert.equal(
            result.documentCount,
            2
        );

        assert.equal(
            result.writtenCount,
            2
        );

        assert.equal(
            result.skippedCount,
            0
        );
    }
);

test(
    "restoreBackupCollection supports dry run",
    async function () {
        const firestore =
            createFirestoreStub();

        const result =
            await restoreBackupCollection(
                createRuntime({
                    firestore:
                        firestore
                }),
                "orders",
                [
                    {
                        id:
                            "order-1",

                        data:
                            {}
                    }
                ],
                {
                    dryRun:
                        true,

                    maxDocuments:
                        100
                }
            );

        assert.equal(
            result.status,
            "completed"
        );

        assert.equal(
            result.writtenCount,
            0
        );

        assert.equal(
            result.skippedCount,
            1
        );

        assert.equal(
            firestore.hasDocument(
                "orders/order-1"
            ),
            false
        );
    }
);

/* ==========================================================
   RESTORE BACKUP
========================================================== */

test(
    "restoreBackup restores valid backup",
    async function () {
        const firestore =
            createFirestoreStub();

        const backup =
            createBackupPayload();

        const result =
            await restoreBackup(
                createRuntime({
                    firestore:
                        firestore
                }),
                backup,
                {
                    runId:
                        "restore-1",

                    restoreMode:
                        "create",

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
            result.operation,
            "restore"
        );

        assert.equal(
            result.documentCount,
            1
        );

        assert.equal(
            result.writtenCount,
            1
        );

        assert.equal(
            firestore.hasDocument(
                "orders/order-1"
            ),
            true
        );

        assert.equal(
            firestore.hasDocument(
                backupRunPath(
                    "restore-1"
                )
            ),
            true
        );
    }
);

test(
    "restoreBackup skips existing records in create mode",
    async function () {
        const firestore =
            createFirestoreStub({
                "orders/order-1": {
                    totalMinor:
                        5000
                }
            });

        const result =
            await restoreBackup(
                createRuntime({
                    firestore:
                        firestore
                }),
                createBackupPayload(),
                {
                    runId:
                        "restore-1",

                    restoreMode:
                        "create",

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
            result.writtenCount,
            0
        );

        assert.equal(
            result.skippedCount,
            1
        );

        assert.equal(
            firestore
                .getDocument(
                    "orders/order-1"
                )
                .totalMinor,
            5000
        );
    }
);

test(
    "restoreBackup returns disabled result",
    async function () {
        const result =
            await restoreBackup(
                null,
                createBackupPayload(),
                {
                    runId:
                        "restore-1",

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
    }
);

/* ==========================================================
   INSPECTION
========================================================== */

test(
    "inspectBackup returns backup summary",
    function () {
        const result =
            inspectBackup(
                createBackupPayload(),
                {}
            );

        assert.equal(
            result.valid,
            true
        );

        assert.equal(
            result.id,
            "backup-1"
        );

        assert.equal(
            result.format,
            "json"
        );

        assert.equal(
            result.collectionCount,
            1
        );

        assert.equal(
            result.documentCount,
            1
        );

        assert.deepEqual(
            result.collections,
            [
                {
                    collection:
                        "orders",

                    documentCount:
                        1
                }
            ]
        );
    }
);

/* ==========================================================
   RESULT AND STORAGE RECORDS
========================================================== */

test(
    "createBackupResult creates summary",
    function () {
        const result =
            createBackupResult({
                id:
                    "backup-1",

                operation:
                    "export",

                status:
                    "completed",

                collections: [
                    "orders"
                ],

                documentCount:
                    2,

                startedAt:
                    1000,

                completedAt:
                    3000
            });

        assert.equal(
            result.id,
            "backup-1"
        );

        assert.equal(
            result.operation,
            "export"
        );

        assert.equal(
            result.status,
            "completed"
        );

        assert.equal(
            result.collectionCount,
            1
        );

        assert.equal(
            result.documentCount,
            2
        );

        assert.equal(
            result.durationMs,
            2000
        );
    }
);

test(
    "createBackupRunRecord creates Firestore record",
    function () {
        const record =
            createBackupRunRecord(
                {
                    id:
                        "backup-1",

                    operation:
                        "export",

                    status:
                        "completed",

                    collections: [
                        "orders"
                    ],

                    startedAt:
                        1000,

                    completedAt:
                        2000
                },
                createRuntime({
                    now:
                        function () {
                            return 2000;
                        }
                }),
                {
                    retentionMs:
                        5000,

                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            record.id,
            "backup-1"
        );

        assert.equal(
            record.startedAt
                .toMillis(),
            1000
        );

        assert.equal(
            record.completedAt
                .toMillis(),
            2000
        );

        assert.equal(
            record.expiresAt
                .toMillis(),
            7000
        );
    }
);

test(
    "sanitizeBackupRunRecord serializes timestamps",
    function () {
        const result =
            sanitizeBackupRunRecord(
                createStoredBackupRun()
            );

        assert.equal(
            result.startedAt,
            new Date(
                1000
            ).toISOString()
        );

        assert.equal(
            result.completedAt,
            new Date(
                2000
            ).toISOString()
        );

        assert.equal(
            result.expiresAt,
            new Date(
                10000
            ).toISOString()
        );
    }
);

/* ==========================================================
   GET AND QUERY
========================================================== */

test(
    "getBackupRun returns stored run",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    backupRunPath(
                        "backup-1"
                    )
                ]:
                    createStoredBackupRun()
            });

        const result =
            await getBackupRun(
                createRuntime({
                    firestore:
                        firestore
                }),
                "backup-1"
            );

        assert.equal(
            result.id,
            "backup-1"
        );

        assert.equal(
            result.status,
            "completed"
        );

        assert.equal(
            result.startedAt,
            new Date(
                1000
            ).toISOString()
        );
    }
);

test(
    "getBackupRun returns null for missing or disabled run",
    async function () {
        assert.equal(
            await getBackupRun(
                createRuntime(),
                "missing"
            ),
            null
        );

        assert.equal(
            await getBackupRun(
                null,
                "backup-1",
                {
                    disabled:
                        true
                }
            ),
            null
        );
    }
);

test(
    "normalizeBackupQuery normalizes filters",
    function () {
        assert.deepEqual(
            normalizeBackupQuery(
                {
                    status:
                        "COMPLETED",

                    operation:
                        "EXPORT",

                    dryRun:
                        false,

                    startedAfter:
                        1000,

                    startedBefore:
                        5000,

                    orderBy:
                        "documentCount",

                    direction:
                        "ASC",

                    limit:
                        25
                },
                {}
            ),
            {
                status:
                    "completed",

                operation:
                    "export",

                dryRun:
                    false,

                startedAfter:
                    1000,

                startedBefore:
                    5000,

                orderBy:
                    "documentCount",

                direction:
                    "asc",

                limit:
                    25
            }
        );
    }
);

test(
    "queryBackupRuns filters and orders records",
    async function () {
        const firestore =
            createFirestoreStub({
                "_backupRuns/one":
                    createStoredBackupRun({
                        id:
                            "one",

                        operation:
                            "export",

                        status:
                            "completed",

                        dryRun:
                            false,

                        startedAt:
                            TestTimestamp
                                .fromMillis(
                                    1000
                                )
                    }),

                "_backupRuns/two":
                    createStoredBackupRun({
                        id:
                            "two",

                        operation:
                            "export",

                        status:
                            "completed",

                        dryRun:
                            false,

                        startedAt:
                            TestTimestamp
                                .fromMillis(
                                    2000
                                )
                    }),

                "_backupRuns/three":
                    createStoredBackupRun({
                        id:
                            "three",

                        operation:
                            "restore",

                        status:
                            "failed",

                        dryRun:
                            true
                    })
            });

        const results =
            await queryBackupRuns(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    operation:
                        "export",

                    status:
                        "completed",

                    dryRun:
                        false,

                    orderBy:
                        "startedAt",

                    direction:
                        "asc"
                },
                {}
            );

        assert.deepEqual(
            results.map(
                function (
                    record
                ) {
                    return record.id;
                }
            ),
            [
                "one",
                "two"
            ]
        );
    }
);

/* ==========================================================
   CANCEL
========================================================== */

test(
    "cancelBackupRun cancels active run",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    backupRunPath(
                        "backup-1"
                    )
                ]:
                    createStoredBackupRun({
                        status:
                            "running",

                        completedAt:
                            null
                    })
            });

        const result =
            await cancelBackupRun(
                createRuntime({
                    firestore:
                        firestore
                }),
                "backup-1",
                "Cancelled by administrator.",
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
            result.backup.status,
            "cancelled"
        );

        assert.equal(
            result.backup
                .cancellationReason,
            "Cancelled by administrator."
        );

        assert.equal(
            result.backup.cancelledAt,
            new Date(
                3000
            ).toISOString()
        );
    }
);

test(
    "cancelBackupRun rejects terminal run",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    backupRunPath(
                        "backup-1"
                    )
                ]:
                    createStoredBackupRun({
                        status:
                            "completed"
                    })
            });

        await assert.rejects(
            async function () {
                await cancelBackupRun(
                    createRuntime({
                        firestore:
                            firestore
                    }),
                    "backup-1",
                    "Cancel.",
                    {}
                );
            },
            /terminal backup run/
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
                bigint:
                    10n,

                buffer:
                    Buffer.from(
                        "hello"
                    ),

                date:
                    new Date(
                        "2026-07-25T08:00:00.000Z"
                    ),

                missing:
                    undefined
            }),
            {
                bigint:
                    "10",

                buffer:
                    "aGVsbG8=",

                date:
                    "2026-07-25T08:00:00.000Z",

                missing:
                    null
            }
        );
    }
);

test(
    "assertSerializableBackupValue enforces size",
    function () {
        assert.equal(
            assertSerializableBackupValue(
                {
                    orderId:
                        "order-1"
                },
                1000,
                "Backup"
            ),
            true
        );

        assert.throws(
            function () {
                assertSerializableBackupValue(
                    {
                        value:
                            "x".repeat(
                                100
                            )
                    },
                    10,
                    "Backup"
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

/* ==========================================================
   METADATA AND ERRORS
========================================================== */

test(
    "sanitizeBackupMetadata preserves objects and wraps primitives",
    function () {
        assert.deepEqual(
            sanitizeBackupMetadata({
                environment:
                    "production"
            }),
            {
                environment:
                    "production"
            }
        );

        assert.deepEqual(
            sanitizeBackupMetadata(
                "scheduled"
            ),
            {
                value:
                    "scheduled"
            }
        );

        assert.deepEqual(
            sanitizeBackupMetadata(
                null
            ),
            {}
        );
    }
);

test(
    "serializeBackupError returns safe metadata",
    function () {
        const error =
            new ServiceError(
                "storage-error",
                "Backup storage unavailable.",
                {
                    status:
                        503,

                    retryable:
                        true,

                    details: {
                        provider:
                            "storage"
                    }
                }
            );

        assert.deepEqual(
            serializeBackupError(
                error
            ),
            {
                name:
                    "ServiceError",

                code:
                    "storage-error",

                message:
                    "Backup storage unavailable.",

                status:
                    503,

                retryable:
                    true,

                details: {
                    provider:
                        "storage"
                }
            }
        );
    }
);

test(
    "createBackupRunNotFoundError creates service error",
    function () {
        const error =
            createBackupRunNotFoundError(
                "backup-1"
            );

        assert.equal(
            error.code,
            "not-found"
        );

        assert.equal(
            error.status,
            404
        );
    }
);

/* ==========================================================
   RUNTIME AND TIME
========================================================== */

test(
    "assertBackupRuntime validates runtime",
    function () {
        assert.doesNotThrow(
            function () {
                assertBackupRuntime(
                    createRuntime()
                );
            }
        );

        assert.throws(
            function () {
                assertBackupRuntime(
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

                return true;
            }
        );

        assert.throws(
            function () {
                assertBackupRuntime({
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
    "timestamp and duration helpers work",
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
            serializeTimestamp(
                timestamp
            ),
            new Date(
                1000
            ).toISOString()
        );

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
    }
);

test(
    "createBackupRunId creates unique IDs",
    function () {
        const first =
            createBackupRunId(
                1000
            );

        const second =
            createBackupRunId(
                1000
            );

        assert.notEqual(
            first,
            second
        );

        assert.match(
            first,
            /^[a-z0-9_]+$/
        );
    }
);

/* ==========================================================
   LOGGING
========================================================== */

test(
    "logBackupEvent logs completed operation",
    function () {
        const logger =
            createLoggerStub();

        logBackupEvent(
            {
                logger:
                    logger
            },
            {
                id:
                    "backup-1",

                operation:
                    "export",

                status:
                    "completed"
            },
            "export-completed",
            {
                log:
                    true
            }
        );

        assert.equal(
            logger.entries[0].level,
            "info"
        );

        assert.equal(
            logger.entries[0].message,
            "Backup event."
        );
    }
);

test(
    "logBackupEvent logs partial operation as warning",
    function () {
        const logger =
            createLoggerStub();

        logBackupEvent(
            {
                logger:
                    logger
            },
            {
                id:
                    "backup-1",

                operation:
                    "export",

                status:
                    "partial"
            },
            "export-completed",
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
            "Backup operation completed with warnings."
        );
    }
);

test(
    "logBackupEvent logs failed operation as error",
    function () {
        const logger =
            createLoggerStub();

        logBackupEvent(
            {
                logger:
                    logger
            },
            {
                id:
                    "backup-1",

                operation:
                    "restore",

                status:
                    "failed"
            },
            "restore-failed",
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
            "Backup operation failed."
        );
    }
);

test(
    "backup logging can be disabled",
    function () {
        const logger =
            createLoggerStub();

        logBackupEvent(
            {
                logger:
                    logger
            },
            {
                id:
                    "backup-1",

                status:
                    "completed"
            },
            "completed",
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
    "backup constants expose expected defaults",
    function () {
        assert.equal(
            constants
                .BACKUP_COLLECTION,
            "_backupRuns"
        );

        assert.equal(
            constants.DEFAULT_STATUS,
            "pending"
        );

        assert.equal(
            constants.DEFAULT_FORMAT,
            "json"
        );

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
            100
        );

        assert.equal(
            constants
                .DEFAULT_MAX_DOCUMENTS,
            50000
        );

        assert.equal(
            constants
                .DEFAULT_MAX_BACKUP_BYTES,
            26214400
        );

        assert.equal(
            constants
                .DEFAULT_RETENTION_MS,
            7776000000
        );

        assert.equal(
            constants
                .DEFAULT_SCHEMA_VERSION,
            1
        );

        assert.deepEqual(
            constants
                .BACKUP_OPERATION_TYPES,
            {
                export:
                    "export",

                restore:
                    "restore"
            }
        );

        assert.deepEqual(
            constants
                .RESTORE_MODES,
            {
                create:
                    "create",

                merge:
                    "merge",

                overwrite:
                    "overwrite"
            }
        );

        assert.equal(
            constants
                .TERMINAL_BACKUP_STATUSES
                .includes(
                    "completed"
                ),
            true
        );

        assert.equal(
            Object.isFrozen(
                constants
                    .TERMINAL_BACKUP_STATUSES
            ),
            true
        );
    }
);