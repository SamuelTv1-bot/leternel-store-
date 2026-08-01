"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   MAINTENANCE SERVICE TEST SUITE
========================================================== */

const test =
    require("node:test");

const assert =
    require("node:assert/strict");

const {
    createMaintenanceService,
    runMaintenance,
    executeMaintenanceTask,
    resolveMaintenanceTaskHandler,
    executeWithTimeout,
    persistMaintenanceRun,
    updateMaintenanceRunTasks,
    createMaintenanceRunRecord,
    getMaintenanceRun,
    queryMaintenanceRuns,
    normalizeMaintenanceQuery,
    cancelMaintenanceRun,
    createMaintenanceResult,
    createMaintenanceTaskResult,
    calculateDuration,
    sanitizeMaintenanceRunRecord,
    serializeMaintenanceError,
    createMaintenanceRunNotFoundError,
    stableStringify,
    normalizeStableValue,
    assertSerializableMaintenanceValue,
    normalizeMaintenanceRunId,
    normalizeMaintenanceStatus,
    normalizeMaintenanceTaskStatus,
    normalizeMaintenanceTaskName,
    normalizeMaintenanceTasks,
    normalizeMaintenanceDate,
    normalizeMaintenanceOrderField,
    normalizeQueryLimit,
    normalizePositiveInteger,
    normalizeNonNegativeInteger,
    normalizeOptionalString,
    normalizeCollection,
    normalizeMaintenanceOptions,
    createMaintenanceRunId,
    assertMaintenanceRuntime,
    resolveNow,
    createDatabaseTimestamp,
    toMilliseconds,
    serializeTimestamp,
    logMaintenanceEvent,
    logMaintenanceTaskEvent,
    logMaintenanceTaskFailure,
    logMaintenanceLockFailure,
    constants
} = require(
    "../src/shared/maintenance-service"
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
                            options
                        ) {
                            writes.push({
                                reference:
                                    reference,

                                value:
                                    clone(
                                        value
                                    ),

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
            }
    };
}

/* ==========================================================
   LOGGER, LOCK, CLEANUP, AND RUNTIME
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

function createLockServiceStub(
    options
) {
    const settings =
        options || {};

    const calls = {
        acquire:
            [],

        release:
            []
    };

    return {
        calls:
            calls,

        acquire:
            async function (
                key,
                ownerId,
                overrides
            ) {
                calls.acquire.push({
                    key:
                        key,

                    ownerId:
                        ownerId,

                    overrides:
                        overrides
                });

                if (
                    settings.acquireError
                ) {
                    throw settings.acquireError;
                }

                if (
                    settings.unavailable
                ) {
                    return {
                        acquired:
                            false
                    };
                }

                return {
                    acquired:
                        true,

                    token:
                        settings.token ||
                        "lock-token"
                };
            },

        release:
            async function (
                key,
                ownerId,
                token,
                overrides
            ) {
                calls.release.push({
                    key:
                        key,

                    ownerId:
                        ownerId,

                    token:
                        token,

                    overrides:
                        overrides
                });

                if (
                    settings.releaseError
                ) {
                    throw settings.releaseError;
                }

                return {
                    released:
                        true
                };
            }
    };
}

function createCleanupServiceStub(
    result
) {
    const calls =
        [];

    return {
        calls:
            calls,

        run:
            async function (
                options
            ) {
                calls.push(
                    options
                );

                return result || {
                    status:
                        "completed",

                    deletedCount:
                        5
                };
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

function maintenancePath(
    id
) {
    return (
        constants
            .MAINTENANCE_COLLECTION +
        "/" +
        id
    );
}

function createStoredMaintenanceRun(
    overrides
) {
    return Object.assign(
        {
            id:
                "run-1",

            status:
                "completed",

            disabled:
                false,

            dryRun:
                false,

            skipped:
                false,

            reason:
                null,

            cancellationReason:
                null,

            taskCount:
                1,

            completedCount:
                1,

            failedCount:
                0,

            skippedCount:
                0,

            tasks: [
                {
                    name:
                        "cleanup",

                    status:
                        "completed",

                    result: {
                        deletedCount:
                            5
                    },

                    error:
                        null,

                    startedAt:
                        new Date(
                            1000
                        ).toISOString(),

                    completedAt:
                        new Date(
                            2000
                        ).toISOString(),

                    durationMs:
                        1000
                }
            ],

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

/* ==========================================================
   SERVICE FACTORY
========================================================== */

test(
    "createMaintenanceService creates a frozen service",
    function () {
        const runtime =
            createRuntime();

        const service =
            createMaintenanceService({
                runtime:
                    runtime,

                tasks: [
                    "cleanup",
                    "health"
                ]
            });

        assert.equal(
            service.runtime,
            runtime
        );

        assert.deepEqual(
            service.options.tasks,
            [
                "cleanup",
                "health"
            ]
        );

        assert.equal(
            typeof service.run,
            "function"
        );

        assert.equal(
            typeof service.task,
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
    "normalizeMaintenanceOptions applies defaults",
    function () {
        const options =
            normalizeMaintenanceOptions(
                {}
            );

        assert.equal(
            options.collection,
            "_maintenanceRuns"
        );

        assert.deepEqual(
            options.tasks,
            [
                "cleanup"
            ]
        );

        assert.equal(
            options.maxTasks,
            50
        );

        assert.equal(
            options.taskTimeoutMs,
            300000
        );

        assert.equal(
            options.lockLeaseMs,
            600000
        );

        assert.equal(
            options.retentionMs,
            7776000000
        );

        assert.equal(
            options.queryLimit,
            100
        );

        assert.equal(
            options.maxResultBytes,
            500000
        );

        assert.equal(
            options.lockNamespace,
            "maintenance"
        );

        assert.equal(
            options.lockKey,
            "global"
        );

        assert.equal(
            options.returnTaskFailures,
            true
        );

        assert.equal(
            options.skipUnknownTasks,
            true
        );

        assert.equal(
            options.persistRuns,
            true
        );
    }
);

test(
    "normalizeMaintenanceOptions respects overrides",
    function () {
        const taskHandlers = {
            custom:
                async function () {
                    return {
                        ok:
                            true
                    };
                }
        };

        const options =
            normalizeMaintenanceOptions({
                collection:
                    "maintenanceRuns",

                tasks: [
                    "custom"
                ],

                maxTasks:
                    10,

                taskTimeoutMs:
                    1000,

                lockLeaseMs:
                    2000,

                lockAcquireTimeoutMs:
                    500,

                lockRetryIntervalMs:
                    50,

                retentionMs:
                    3000,

                queryLimit:
                    25,

                maxResultBytes:
                    1000,

                lockNamespace:
                    "store-maintenance",

                lockKey:
                    "daily",

                workerId:
                    "worker-1",

                runId:
                    "run-1",

                dryRun:
                    true,

                disabled:
                    true,

                stopOnError:
                    true,

                returnTaskFailures:
                    false,

                skipUnknownTasks:
                    false,

                persistRuns:
                    false,

                taskHandlers:
                    taskHandlers,

                log:
                    false
            });

        assert.equal(
            options.collection,
            "maintenanceRuns"
        );

        assert.deepEqual(
            options.tasks,
            [
                "custom"
            ]
        );

        assert.equal(
            options.taskTimeoutMs,
            1000
        );

        assert.equal(
            options.lockLeaseMs,
            2000
        );

        assert.equal(
            options.workerId,
            "worker-1"
        );

        assert.equal(
            options.runId,
            "run-1"
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
            options.returnTaskFailures,
            false
        );

        assert.equal(
            options.skipUnknownTasks,
            false
        );

        assert.equal(
            options.persistRuns,
            false
        );

        assert.equal(
            options.taskHandlers,
            taskHandlers
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
    "maintenance identifiers and statuses normalize values",
    function () {
        assert.equal(
            normalizeMaintenanceRunId(
                " run-1 "
            ),
            "run-1"
        );

        assert.equal(
            normalizeMaintenanceStatus(
                "COMPLETED"
            ),
            "completed"
        );

        assert.equal(
            normalizeMaintenanceTaskStatus(
                "TIMED-OUT"
            ),
            "timed-out"
        );

        assert.equal(
            normalizeMaintenanceTaskName(
                " Cache Refresh "
            ),
            "cache-refresh"
        );

        assert.throws(
            function () {
                normalizeMaintenanceRunId(
                    "maintenance/run"
                );
            },
            /run ID is invalid/
        );

        assert.throws(
            function () {
                normalizeMaintenanceStatus(
                    "unknown"
                );
            },
            /status is invalid/
        );

        assert.throws(
            function () {
                normalizeMaintenanceTaskStatus(
                    "unknown"
                );
            },
            /task status is invalid/
        );

        assert.throws(
            function () {
                normalizeMaintenanceTaskName(
                    ""
                );
            },
            /task name is invalid/
        );
    }
);

test(
    "normalizeMaintenanceTasks deduplicates tasks",
    function () {
        assert.deepEqual(
            normalizeMaintenanceTasks(
                [
                    "Cleanup",
                    "health",
                    "cleanup"
                ],
                10
            ),
            [
                "cleanup",
                "health"
            ]
        );

        assert.throws(
            function () {
                normalizeMaintenanceTasks(
                    [],
                    10
                );
            },
            /At least one maintenance task/
        );

        assert.throws(
            function () {
                normalizeMaintenanceTasks(
                    [
                        "cleanup",
                        "health"
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
    "numeric and collection normalizers validate values",
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
            normalizeQueryLimit(
                1000
            ),
            500
        );

        assert.equal(
            normalizeCollection(
                "_maintenanceRuns"
            ),
            "_maintenanceRuns"
        );

        assert.equal(
            normalizeOptionalString(
                " reason "
            ),
            "reason"
        );

        assert.equal(
            normalizeMaintenanceOrderField(
                "failedCount"
            ),
            "failedCount"
        );

        assert.equal(
            normalizeMaintenanceOrderField(
                "invalid"
            ),
            "startedAt"
        );

        assert.throws(
            function () {
                normalizeCollection(
                    "internal/maintenance"
                );
            },
            /Firestore collection name/
        );
    }
);

/* ==========================================================
   RESULT BUILDERS
========================================================== */

test(
    "createMaintenanceTaskResult normalizes task output",
    function () {
        const result =
            createMaintenanceTaskResult({
                name:
                    "cleanup",

                status:
                    "completed",

                result: {
                    deletedCount:
                        5
                },

                startedAt:
                    1000,

                completedAt:
                    3000
            });

        assert.equal(
            result.name,
            "cleanup"
        );

        assert.equal(
            result.status,
            "completed"
        );

        assert.equal(
            result.durationMs,
            2000
        );

        assert.deepEqual(
            result.result,
            {
                deletedCount:
                    5
            }
        );
    }
);

test(
    "createMaintenanceResult calculates task counts",
    function () {
        const result =
            createMaintenanceResult({
                id:
                    "run-1",

                status:
                    "partial",

                startedAt:
                    1000,

                completedAt:
                    5000,

                tasks: [
                    {
                        name:
                            "cleanup",

                        status:
                            "completed"
                    },
                    {
                        name:
                            "health",

                        status:
                            "failed"
                    },
                    {
                        name:
                            "cache",

                        status:
                            "skipped"
                    }
                ]
            });

        assert.equal(
            result.taskCount,
            3
        );

        assert.equal(
            result.completedCount,
            1
        );

        assert.equal(
            result.failedCount,
            1
        );

        assert.equal(
            result.skippedCount,
            1
        );

        assert.equal(
            result.durationMs,
            4000
        );
    }
);

test(
    "calculateDuration returns safe duration",
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
                0,
                3000
            ),
            0
        );
    }
);

/* ==========================================================
   TASK HANDLERS
========================================================== */

test(
    "resolveMaintenanceTaskHandler returns custom handler",
    function () {
        const handler =
            async function () {
                return {
                    ok:
                        true
                };
            };

        assert.equal(
            resolveMaintenanceTaskHandler(
                "custom",
                {
                    taskHandlers: {
                        custom:
                            handler
                    }
                }
            ),
            handler
        );
    }
);

test(
    "resolveMaintenanceTaskHandler returns built-in health handler",
    async function () {
        const handler =
            resolveMaintenanceTaskHandler(
                "health",
                {}
            );

        assert.deepEqual(
            await handler(),
            {
                healthy:
                    true
            }
        );
    }
);

test(
    "resolveMaintenanceTaskHandler uses configured health check",
    async function () {
        const handler =
            resolveMaintenanceTaskHandler(
                "health",
                {
                    healthCheck:
                        async function () {
                            return {
                                healthy:
                                    false
                            };
                        }
                }
            );

        assert.deepEqual(
            await handler(),
            {
                healthy:
                    false
            }
        );
    }
);

test(
    "resolveMaintenanceTaskHandler returns null for unknown task",
    function () {
        assert.equal(
            resolveMaintenanceTaskHandler(
                "unknown",
                {}
            ),
            null
        );
    }
);

/* ==========================================================
   EXECUTE TASK
========================================================== */

test(
    "executeMaintenanceTask executes custom task",
    async function () {
        const result =
            await executeMaintenanceTask(
                createRuntime({
                    now:
                        function () {
                            return 2000;
                        }
                }),
                "custom",
                {
                    runId:
                        "run-1"
                },
                {
                    tasks: [
                        "custom"
                    ],

                    taskHandlers: {
                        custom:
                            async function (
                                context
                            ) {
                                return {
                                    runId:
                                        context.runId
                                };
                            }
                    },

                    taskTimeoutMs:
                        1000,

                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            result.status,
            "completed"
        );

        assert.deepEqual(
            result.result,
            {
                runId:
                    "run-1"
            }
        );
    }
);

test(
    "executeMaintenanceTask returns skipped unknown task",
    async function () {
        const result =
            await executeMaintenanceTask(
                createRuntime(),
                "unknown",
                {},
                {
                    tasks: [
                        "unknown"
                    ],

                    skipUnknownTasks:
                        true,

                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            result.status,
            "skipped"
        );

        assert.equal(
            result.skipped,
            true
        );
    }
);

test(
    "executeMaintenanceTask throws for unknown task when configured",
    async function () {
        await assert.rejects(
            async function () {
                await executeMaintenanceTask(
                    createRuntime(),
                    "unknown",
                    {},
                    {
                        tasks: [
                            "unknown"
                        ],

                        skipUnknownTasks:
                            false
                    }
                );
            },
            function (
                error
            ) {
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
    "executeMaintenanceTask returns failure result",
    async function () {
        const result =
            await executeMaintenanceTask(
                createRuntime(),
                "custom",
                {},
                {
                    tasks: [
                        "custom"
                    ],

                    taskHandlers: {
                        custom:
                            async function () {
                                throw new Error(
                                    "Task failed."
                                );
                            }
                    },

                    returnTaskFailures:
                        true
                }
            );

        assert.equal(
            result.status,
            "failed"
        );

        assert.equal(
            result.error.message,
            "Task failed."
        );
    }
);

/* ==========================================================
   TIMEOUT
========================================================== */

test(
    "executeWithTimeout resolves operation",
    async function () {
        const result =
            await executeWithTimeout(
                async function () {
                    return {
                        ok:
                            true
                    };
                },
                100,
                "health"
            );

        assert.deepEqual(
            result,
            {
                ok:
                    true
            }
        );
    }
);

test(
    "executeWithTimeout rejects timed-out operation",
    async function () {
        await assert.rejects(
            async function () {
                await executeWithTimeout(
                    function () {
                        return new Promise(
                            function () {}
                        );
                    },
                    10,
                    "slow-task"
                );
            },
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "deadline-exceeded"
                );

                assert.equal(
                    error.status,
                    504
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   RUN MAINTENANCE
========================================================== */

test(
    "runMaintenance executes configured tasks",
    async function () {
        const firestore =
            createFirestoreStub();

        const lockService =
            createLockServiceStub();

        const result =
            await runMaintenance(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    runId:
                        "run-1",

                    tasks: [
                        "health",
                        "custom"
                    ],

                    lockService:
                        lockService,

                    taskHandlers: {
                        custom:
                            async function () {
                                return {
                                    refreshed:
                                        true
                                };
                            }
                    },

                    now:
                        function () {
                            return 5000;
                        }
                }
            );

        assert.equal(
            result.id,
            "run-1"
        );

        assert.equal(
            result.status,
            "completed"
        );

        assert.equal(
            result.taskCount,
            2
        );

        assert.equal(
            result.completedCount,
            2
        );

        assert.equal(
            result.failedCount,
            0
        );

        assert.equal(
            lockService.calls.acquire.length,
            1
        );

        assert.equal(
            lockService.calls.release.length,
            1
        );

        assert.equal(
            firestore.hasDocument(
                maintenancePath(
                    "run-1"
                )
            ),
            true
        );
    }
);

test(
    "runMaintenance returns partial result when task fails",
    async function () {
        const result =
            await runMaintenance(
                createRuntime(),
                {
                    runId:
                        "run-1",

                    tasks: [
                        "health",
                        "custom"
                    ],

                    lockService:
                        createLockServiceStub(),

                    taskHandlers: {
                        custom:
                            async function () {
                                throw new Error(
                                    "Failure."
                                );
                            }
                    },

                    returnTaskFailures:
                        true,

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
            result.completedCount,
            1
        );

        assert.equal(
            result.failedCount,
            1
        );
    }
);

test(
    "runMaintenance skips when lock is unavailable",
    async function () {
        const firestore =
            createFirestoreStub();

        const result =
            await runMaintenance(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    runId:
                        "run-1",

                    tasks: [
                        "health"
                    ],

                    lockService:
                        createLockServiceStub({
                            unavailable:
                                true
                        }),

                    now:
                        function () {
                            return 5000;
                        }
                }
            );

        assert.equal(
            result.status,
            "skipped"
        );

        assert.equal(
            result.skipped,
            true
        );

        assert.equal(
            result.reason,
            "Another maintenance run is active."
        );
    }
);

test(
    "runMaintenance returns disabled result",
    async function () {
        const result =
            await runMaintenance(
                null,
                {
                    runId:
                        "run-1",

                    tasks: [
                        "cleanup"
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
    }
);

test(
    "runMaintenance executes cleanup service",
    async function () {
        const cleanupService =
            createCleanupServiceStub({
                status:
                    "completed",

                deletedCount:
                    7
            });

        const result =
            await runMaintenance(
                createRuntime(),
                {
                    runId:
                        "run-1",

                    tasks: [
                        "cleanup"
                    ],

                    cleanupService:
                        cleanupService,

                    lockService:
                        createLockServiceStub(),

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
            "completed"
        );

        assert.equal(
            cleanupService.calls.length,
            1
        );

        assert.equal(
            cleanupService.calls[0].dryRun,
            true
        );
    }
);

/* ==========================================================
   PERSISTENCE
========================================================== */

test(
    "createMaintenanceRunRecord creates Firestore record",
    function () {
        const record =
            createMaintenanceRunRecord(
                createMaintenanceResult({
                    id:
                        "run-1",

                    status:
                        "completed",

                    startedAt:
                        1000,

                    completedAt:
                        2000,

                    tasks: [
                        {
                            name:
                                "health",

                            status:
                                "completed"
                        }
                    ]
                }),
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
            "run-1"
        );

        assert.equal(
            record.status,
            "completed"
        );

        assert.equal(
            record.startedAt.toMillis(),
            1000
        );

        assert.equal(
            record.completedAt.toMillis(),
            2000
        );

        assert.equal(
            record.expiresAt.toMillis(),
            7000
        );
    }
);

test(
    "persistMaintenanceRun stores record",
    async function () {
        const firestore =
            createFirestoreStub();

        await persistMaintenanceRun(
            createRuntime({
                firestore:
                    firestore
            }),
            createMaintenanceResult({
                id:
                    "run-1",

                status:
                    "completed",

                startedAt:
                    1000,

                completedAt:
                    2000,

                tasks:
                    []
            }),
            {
                persistRuns:
                    true,

                retentionMs:
                    5000,

                now:
                    function () {
                        return 2000;
                    }
            }
        );

        assert.equal(
            firestore.hasDocument(
                maintenancePath(
                    "run-1"
                )
            ),
            true
        );
    }
);

test(
    "updateMaintenanceRunTasks updates task list",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    maintenancePath(
                        "run-1"
                    )
                ]:
                    createStoredMaintenanceRun()
            });

        await updateMaintenanceRunTasks(
            createRuntime({
                firestore:
                    firestore
            }),
            "run-1",
            [
                {
                    name:
                        "health",

                    status:
                        "completed"
                }
            ],
            {
                persistRuns:
                    true,

                now:
                    function () {
                        return 3000;
                    }
            }
        );

        const stored =
            firestore.getDocument(
                maintenancePath(
                    "run-1"
                )
            );

        assert.equal(
            stored.tasks.length,
            1
        );

        assert.equal(
            stored.tasks[0].name,
            "health"
        );

        assert.equal(
            stored.updatedAt.toMillis(),
            3000
        );
    }
);

/* ==========================================================
   GET AND QUERY
========================================================== */

test(
    "getMaintenanceRun returns stored record",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    maintenancePath(
                        "run-1"
                    )
                ]:
                    createStoredMaintenanceRun()
            });

        const result =
            await getMaintenanceRun(
                createRuntime({
                    firestore:
                        firestore
                }),
                "run-1"
            );

        assert.equal(
            result.id,
            "run-1"
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
    "getMaintenanceRun returns null for missing or disabled record",
    async function () {
        assert.equal(
            await getMaintenanceRun(
                createRuntime(),
                "missing"
            ),
            null
        );

        assert.equal(
            await getMaintenanceRun(
                null,
                "run-1",
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
    "normalizeMaintenanceQuery normalizes filters",
    function () {
        assert.deepEqual(
            normalizeMaintenanceQuery(
                {
                    status:
                        "COMPLETED",

                    dryRun:
                        true,

                    startedAfter:
                        1000,

                    startedBefore:
                        5000,

                    orderBy:
                        "failedCount",

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

                dryRun:
                    true,

                startedAfter:
                    1000,

                startedBefore:
                    5000,

                orderBy:
                    "failedCount",

                direction:
                    "asc",

                limit:
                    25
            }
        );
    }
);

test(
    "queryMaintenanceRuns filters and orders records",
    async function () {
        const firestore =
            createFirestoreStub({
                "_maintenanceRuns/one":
                    createStoredMaintenanceRun({
                        id:
                            "one",

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

                "_maintenanceRuns/two":
                    createStoredMaintenanceRun({
                        id:
                            "two",

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

                "_maintenanceRuns/three":
                    createStoredMaintenanceRun({
                        id:
                            "three",

                        status:
                            "failed",

                        dryRun:
                            true
                    })
            });

        const results =
            await queryMaintenanceRuns(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
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
    "cancelMaintenanceRun cancels active run",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    maintenancePath(
                        "run-1"
                    )
                ]:
                    createStoredMaintenanceRun({
                        status:
                            "running",

                        completedAt:
                            null
                    })
            });

        const result =
            await cancelMaintenanceRun(
                createRuntime({
                    firestore:
                        firestore
                }),
                "run-1",
                "Administrative cancellation.",
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
            result.maintenance.status,
            "cancelled"
        );

        assert.equal(
            result.maintenance
                .cancellationReason,
            "Administrative cancellation."
        );

        assert.equal(
            result.maintenance.cancelledAt,
            new Date(
                3000
            ).toISOString()
        );
    }
);

test(
    "cancelMaintenanceRun rejects terminal run",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    maintenancePath(
                        "run-1"
                    )
                ]:
                    createStoredMaintenanceRun({
                        status:
                            "completed"
                    })
            });

        await assert.rejects(
            async function () {
                await cancelMaintenanceRun(
                    createRuntime({
                        firestore:
                            firestore
                    }),
                    "run-1",
                    "Cancel.",
                    {}
                );
            },
            /terminal maintenance run/
        );
    }
);

/* ==========================================================
   SANITIZATION AND ERRORS
========================================================== */

test(
    "sanitizeMaintenanceRunRecord serializes timestamps",
    function () {
        const result =
            sanitizeMaintenanceRunRecord(
                createStoredMaintenanceRun()
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

test(
    "serializeMaintenanceError returns safe metadata",
    function () {
        const error =
            new ServiceError(
                "maintenance-error",
                "Maintenance failed.",
                {
                    status:
                        503,

                    retryable:
                        true,

                    details: {
                        task:
                            "cleanup"
                    }
                }
            );

        assert.deepEqual(
            serializeMaintenanceError(
                error
            ),
            {
                name:
                    "ServiceError",

                code:
                    "maintenance-error",

                message:
                    "Maintenance failed.",

                status:
                    503,

                retryable:
                    true,

                details: {
                    task:
                        "cleanup"
                }
            }
        );
    }
);

test(
    "createMaintenanceRunNotFoundError creates service error",
    function () {
        const error =
            createMaintenanceRunNotFoundError(
                "run-1"
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
    "normalizeStableValue supports special values",
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
    "assertSerializableMaintenanceValue enforces size",
    function () {
        assert.equal(
            assertSerializableMaintenanceValue(
                {
                    healthy:
                        true
                },
                1000,
                "Result"
            ),
            true
        );

        assert.throws(
            function () {
                assertSerializableMaintenanceValue(
                    {
                        value:
                            "x".repeat(
                                100
                            )
                    },
                    10,
                    "Result"
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

/* ==========================================================
   RUNTIME AND TIME
========================================================== */

test(
    "assertMaintenanceRuntime validates runtime",
    function () {
        assert.doesNotThrow(
            function () {
                assertMaintenanceRuntime(
                    createRuntime()
                );
            }
        );

        assert.throws(
            function () {
                assertMaintenanceRuntime(
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
            serializeTimestamp(
                timestamp
            ),
            new Date(
                1000
            ).toISOString()
        );
    }
);

test(
    "createMaintenanceRunId creates unique IDs",
    function () {
        const first =
            createMaintenanceRunId(
                1000
            );

        const second =
            createMaintenanceRunId(
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
    "logMaintenanceEvent logs completed run",
    function () {
        const logger =
            createLoggerStub();

        logMaintenanceEvent(
            {
                logger:
                    logger
            },
            {
                id:
                    "run-1",

                status:
                    "completed"
            },
            "completed",
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
            "Maintenance event."
        );
    }
);

test(
    "logMaintenanceEvent logs partial run as warning",
    function () {
        const logger =
            createLoggerStub();

        logMaintenanceEvent(
            {
                logger:
                    logger
            },
            {
                id:
                    "run-1",

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
    }
);

test(
    "logMaintenanceEvent logs failure as error",
    function () {
        const logger =
            createLoggerStub();

        logMaintenanceEvent(
            {
                logger:
                    logger
            },
            {
                id:
                    "run-1",

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
    }
);

test(
    "task and lock logging helpers emit entries",
    function () {
        const logger =
            createLoggerStub();

        logMaintenanceTaskEvent(
            {
                logger:
                    logger
            },
            {
                name:
                    "cleanup",

                status:
                    "completed"
            },
            "completed",
            {
                log:
                    true
            }
        );

        logMaintenanceTaskFailure(
            {
                logger:
                    logger
            },
            {
                name:
                    "health",

                status:
                    "failed",

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

        logMaintenanceLockFailure(
            {
                logger:
                    logger
            },
            "run-1",
            new Error(
                "Release failed."
            ),
            {
                log:
                    true
            }
        );

        assert.equal(
            logger.entries.length,
            3
        );

        assert.equal(
            logger.entries[0].level,
            "info"
        );

        assert.equal(
            logger.entries[1].level,
            "error"
        );

        assert.equal(
            logger.entries[2].level,
            "warn"
        );
    }
);

/* ==========================================================
   CONSTANTS
========================================================== */

test(
    "maintenance constants expose expected defaults",
    function () {
        assert.equal(
            constants
                .MAINTENANCE_COLLECTION,
            "_maintenanceRuns"
        );

        assert.equal(
            constants.DEFAULT_STATUS,
            "pending"
        );

        assert.equal(
            constants
                .DEFAULT_TASK_TIMEOUT_MS,
            300000
        );

        assert.equal(
            constants
                .DEFAULT_LOCK_LEASE_MS,
            600000
        );

        assert.equal(
            constants
                .DEFAULT_RETENTION_MS,
            7776000000
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
                .DEFAULT_MAX_TASKS,
            50
        );

        assert.equal(
            constants
                .DEFAULT_LOCK_NAMESPACE,
            "maintenance"
        );

        assert.equal(
            constants
                .DEFAULT_LOCK_KEY,
            "global"
        );

        assert.deepEqual(
            constants
                .DEFAULT_TASKS,
            [
                "cleanup"
            ]
        );

        assert.equal(
            constants
                .TERMINAL_MAINTENANCE_STATUSES
                .includes(
                    "completed"
                ),
            true
        );

        assert.equal(
            Object.isFrozen(
                constants
                    .DEFAULT_TASKS
            ),
            true
        );
    }
);