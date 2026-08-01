"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   MAINTENANCE SERVICE

   Responsibilities:
   - Coordinate scheduled maintenance tasks
   - Run cleanup, health, cache, and recovery operations
   - Prevent overlapping maintenance executions
   - Track maintenance runs and task outcomes
   - Support dry-run and disabled modes
   - Provide queryable operational history
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

const {
    createCleanupService
} = require(
    "./cleanup-service"
);

const {
    createLockService
} = require(
    "./lock-service"
);

/* ==========================================================
   CONSTANTS
========================================================== */

const MAINTENANCE_COLLECTION =
    "_maintenanceRuns";

const DEFAULT_STATUS =
    "pending";

const DEFAULT_TASK_TIMEOUT_MS =
    5 * 60 * 1000;

const DEFAULT_LOCK_LEASE_MS =
    10 * 60 * 1000;

const DEFAULT_RETENTION_MS =
    90 * 24 * 60 * 60 * 1000;

const DEFAULT_QUERY_LIMIT =
    100;

const MAX_QUERY_LIMIT =
    500;

const DEFAULT_MAX_TASKS =
    50;

const DEFAULT_MAX_RESULT_BYTES =
    500000;

const DEFAULT_LOCK_NAMESPACE =
    "maintenance";

const DEFAULT_LOCK_KEY =
    "global";

const MAINTENANCE_STATUSES =
    Object.freeze({
        pending:
            "pending",

        running:
            "running",

        completed:
            "completed",

        partial:
            "partial",

        failed:
            "failed",

        skipped:
            "skipped",

        cancelled:
            "cancelled",

        disabled:
            "disabled"
    });

const MAINTENANCE_TASK_STATUSES =
    Object.freeze({
        pending:
            "pending",

        running:
            "running",

        completed:
            "completed",

        failed:
            "failed",

        skipped:
            "skipped",

        timedOut:
            "timed-out"
    });

const TERMINAL_MAINTENANCE_STATUSES =
    Object.freeze([
        MAINTENANCE_STATUSES.completed,
        MAINTENANCE_STATUSES.partial,
        MAINTENANCE_STATUSES.failed,
        MAINTENANCE_STATUSES.skipped,
        MAINTENANCE_STATUSES.cancelled,
        MAINTENANCE_STATUSES.disabled
    ]);

const DEFAULT_TASKS =
    Object.freeze([
        "cleanup"
    ]);

/* ==========================================================
   SERVICE FACTORY
========================================================== */

function createMaintenanceService(
    options
) {
    const settings =
        normalizeMaintenanceOptions(
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
                return runMaintenance(
                    runtime,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        task:
            function (
                taskName,
                context,
                overrides
            ) {
                return executeMaintenanceTask(
                    runtime,
                    taskName,
                    context,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        get:
            function (
                runId,
                overrides
            ) {
                return getMaintenanceRun(
                    runtime,
                    runId,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        query:
            function (
                filters,
                overrides
            ) {
                return queryMaintenanceRuns(
                    runtime,
                    filters,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        cancel:
            function (
                runId,
                reason,
                overrides
            ) {
                return cancelMaintenanceRun(
                    runtime,
                    runId,
                    reason,
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
   RUN MAINTENANCE
========================================================== */

async function runMaintenance(
    runtime,
    options
) {
    const settings =
        normalizeMaintenanceOptions(
            options
        );

    const startedAt =
        resolveNow(
            runtime,
            settings
        );

    const runId =
        settings.runId ||
        createMaintenanceRunId(
            startedAt
        );

    if (
        settings.disabled
    ) {
        return createMaintenanceResult({
            id:
                runId,

            status:
                MAINTENANCE_STATUSES
                    .disabled,

            disabled:
                true,

            dryRun:
                settings.dryRun,

            startedAt:
                startedAt,

            completedAt:
                startedAt,

            tasks:
                []
        });
    }

    assertMaintenanceRuntime(
        runtime
    );

    const lockService =
        settings.lockService ||
        createLockService({
            runtime:
                runtime,

            namespace:
                settings.lockNamespace,

            leaseMs:
                settings.lockLeaseMs,

            acquireTimeoutMs:
                settings.lockAcquireTimeoutMs,

            retryIntervalMs:
                settings.lockRetryIntervalMs,

            log:
                settings.log
        });

    const lockOwnerId =
        settings.workerId ||
        (
            "maintenance:" +
            runId
        );

    const lock =
        await lockService.acquire(
            settings.lockKey,
            lockOwnerId,
            {
                throwIfUnavailable:
                    false,

                metadata: {
                    runId:
                        runId
                }
            }
        );

    if (
        !lock ||
        !lock.acquired
    ) {
        const skipped =
            createMaintenanceResult({
                id:
                    runId,

                status:
                    MAINTENANCE_STATUSES
                        .skipped,

                skipped:
                    true,

                disabled:
                    false,

                dryRun:
                    settings.dryRun,

                reason:
                    "Another maintenance run is active.",

                startedAt:
                    startedAt,

                completedAt:
                    resolveNow(
                        runtime,
                        settings
                    ),

                tasks:
                    []
            });

        if (
            settings.persistRuns
        ) {
            await persistMaintenanceRun(
                runtime,
                skipped,
                settings
            );
        }

        logMaintenanceEvent(
            runtime,
            skipped,
            "skipped",
            settings
        );

        return skipped;
    }

    const initialRecord =
        createMaintenanceResult({
            id:
                runId,

            status:
                MAINTENANCE_STATUSES
                    .running,

            disabled:
                false,

            dryRun:
                settings.dryRun,

            startedAt:
                startedAt,

            completedAt:
                null,

            tasks:
                settings.tasks.map(
                    function (
                        taskName
                    ) {
                        return createMaintenanceTaskResult({
                            name:
                                taskName,

                            status:
                                MAINTENANCE_TASK_STATUSES
                                    .pending
                        });
                    }
                )
        });

    if (
        settings.persistRuns
    ) {
        await persistMaintenanceRun(
            runtime,
            initialRecord,
            settings
        );
    }

    const taskResults =
        [];

    let completedCount =
        0;

    let failedCount =
        0;

    let skippedCount =
        0;

    try {
        for (
            const taskName of
            settings.tasks
        ) {
            const context = {
                runId:
                    runId,

                workerId:
                    lockOwnerId,

                dryRun:
                    settings.dryRun,

                startedAt:
                    startedAt,

                options:
                    settings
            };

            try {
                const result =
                    await executeMaintenanceTask(
                        runtime,
                        taskName,
                        context,
                        settings
                    );

                taskResults.push(
                    result
                );

                if (
                    result.status ===
                    MAINTENANCE_TASK_STATUSES
                        .completed
                ) {
                    completedCount +=
                        1;
                } else if (
                    result.status ===
                    MAINTENANCE_TASK_STATUSES
                        .skipped
                ) {
                    skippedCount +=
                        1;
                } else {
                    failedCount +=
                        1;
                }
            } catch (error) {
                const failure =
                    createMaintenanceTaskResult({
                        name:
                            taskName,

                        status:
                            MAINTENANCE_TASK_STATUSES
                                .failed,

                        error:
                            serializeMaintenanceError(
                                error
                            )
                    });

                taskResults.push(
                    failure
                );

                failedCount +=
                    1;

                logMaintenanceTaskFailure(
                    runtime,
                    failure,
                    settings
                );

                if (
                    settings.stopOnError
                ) {
                    break;
                }
            }

            if (
                settings.persistRuns
            ) {
                await updateMaintenanceRunTasks(
                    runtime,
                    runId,
                    taskResults,
                    settings
                );
            }
        }

        const completedAt =
            resolveNow(
                runtime,
                settings
            );

        const status =
            failedCount >
            0
                ? completedCount >
                      0 ||
                  skippedCount >
                      0
                    ? MAINTENANCE_STATUSES
                          .partial
                    : MAINTENANCE_STATUSES
                          .failed
                : MAINTENANCE_STATUSES
                      .completed;

        const result =
            createMaintenanceResult({
                id:
                    runId,

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

                taskCount:
                    taskResults.length,

                completedCount:
                    completedCount,

                failedCount:
                    failedCount,

                skippedCount:
                    skippedCount,

                tasks:
                    taskResults
            });

        if (
            settings.persistRuns
        ) {
            await persistMaintenanceRun(
                runtime,
                result,
                settings
            );
        }

        logMaintenanceEvent(
            runtime,
            result,
            "completed",
            settings
        );

        return result;
    } finally {
        try {
            await lockService.release(
                settings.lockKey,
                lockOwnerId,
                lock.token,
                {
                    ignoreMissing:
                        true,

                    allowExpiredRelease:
                        true
                }
            );
        } catch (error) {
            logMaintenanceLockFailure(
                runtime,
                runId,
                error,
                settings
            );
        }
    }
}

/* ==========================================================
   TASK EXECUTION
========================================================== */

async function executeMaintenanceTask(
    runtime,
    taskName,
    context,
    options
) {
    const settings =
        normalizeMaintenanceOptions(
            options
        );

    const normalizedTaskName =
        normalizeMaintenanceTaskName(
            taskName
        );

    const startedAt =
        resolveNow(
            runtime,
            settings
        );

    if (
        settings.disabled
    ) {
        return createMaintenanceTaskResult({
            name:
                normalizedTaskName,

            status:
                MAINTENANCE_TASK_STATUSES
                    .skipped,

            skipped:
                true,

            reason:
                "Maintenance is disabled.",

            startedAt:
                startedAt,

            completedAt:
                startedAt
        });
    }

    const handler =
        resolveMaintenanceTaskHandler(
            normalizedTaskName,
            settings
        );

    if (
        typeof handler !==
        "function"
    ) {
        if (
            settings.skipUnknownTasks
        ) {
            return createMaintenanceTaskResult({
                name:
                    normalizedTaskName,

                status:
                    MAINTENANCE_TASK_STATUSES
                        .skipped,

                skipped:
                    true,

                reason:
                    "No maintenance task handler is registered.",

                startedAt:
                    startedAt,

                completedAt:
                    startedAt
            });
        }

        throw new ServiceError(
            "not-found",
            "The maintenance task handler was not found.",
            {
                status:
                    404,

                expose:
                    true,

                details: {
                    taskName:
                        normalizedTaskName
                }
            }
        );
    }

    const runningResult =
        createMaintenanceTaskResult({
            name:
                normalizedTaskName,

            status:
                MAINTENANCE_TASK_STATUSES
                    .running,

            startedAt:
                startedAt
        });

    logMaintenanceTaskEvent(
        runtime,
        runningResult,
        "started",
        settings
    );

    try {
        const result =
            await executeWithTimeout(
                function () {
                    return handler(
                        context || {},
                        settings
                    );
                },
                settings.taskTimeoutMs,
                normalizedTaskName
            );

        assertSerializableMaintenanceValue(
            result,
            settings.maxResultBytes,
            "Maintenance task result"
        );

        const completed =
            createMaintenanceTaskResult({
                name:
                    normalizedTaskName,

                status:
                    MAINTENANCE_TASK_STATUSES
                        .completed,

                result:
                    result,

                startedAt:
                    startedAt,

                completedAt:
                    resolveNow(
                        runtime,
                        settings
                    )
            });

        logMaintenanceTaskEvent(
            runtime,
            completed,
            "completed",
            settings
        );

        return completed;
    } catch (error) {
        const status =
            error &&
            error.code ===
                "deadline-exceeded"
                ? MAINTENANCE_TASK_STATUSES
                      .timedOut
                : MAINTENANCE_TASK_STATUSES
                      .failed;

        const failure =
            createMaintenanceTaskResult({
                name:
                    normalizedTaskName,

                status:
                    status,

                error:
                    serializeMaintenanceError(
                        error
                    ),

                startedAt:
                    startedAt,

                completedAt:
                    resolveNow(
                        runtime,
                        settings
                    )
            });

        logMaintenanceTaskFailure(
            runtime,
            failure,
            settings
        );

        if (
            settings.returnTaskFailures
        ) {
            return failure;
        }

        throw error;
    }
}

function resolveMaintenanceTaskHandler(
    taskName,
    options
) {
    const settings =
        options || {};

    if (
        settings.taskHandlers &&
        typeof settings.taskHandlers[
            taskName
        ] ===
            "function"
    ) {
        return settings.taskHandlers[
            taskName
        ];
    }

    const builtInHandlers = {
        cleanup:
            function (
                context
            ) {
                const cleanupService =
                    settings.cleanupService ||
                    createCleanupService({
                        runtime:
                            settings.runtime,

                        collections:
                            settings.cleanupCollections,

                        batchSize:
                            settings.cleanupBatchSize,

                        maxPasses:
                            settings.cleanupMaxPasses,

                        dryRun:
                            Boolean(
                                context &&
                                context.dryRun
                            ),

                        includeDeletedIds:
                            settings.includeDeletedIds,

                        stopOnError:
                            settings.cleanupStopOnError,

                        log:
                            settings.log
                    });

                return cleanupService.run({
                    dryRun:
                        Boolean(
                            context &&
                            context.dryRun
                        )
                });
            },

        health:
            function () {
                if (
                    typeof settings.healthCheck ===
                    "function"
                ) {
                    return settings.healthCheck();
                }

                return {
                    healthy:
                        true
                };
            },

        cache:
            function (
                context
            ) {
                if (
                    typeof settings.cacheMaintenance ===
                    "function"
                ) {
                    return settings.cacheMaintenance(
                        context
                    );
                }

                return {
                    skipped:
                        true,

                    reason:
                        "No cache maintenance handler is configured."
                };
            },

        recovery:
            function (
                context
            ) {
                if (
                    typeof settings.recoveryHandler ===
                    "function"
                ) {
                    return settings.recoveryHandler(
                        context
                    );
                }

                return {
                    skipped:
                        true,

                    reason:
                        "No recovery handler is configured."
                };
            }
    };

    return builtInHandlers[
        taskName
    ] ||
    null;
}

/* ==========================================================
   TIMEOUT
========================================================== */

function executeWithTimeout(
    operation,
    timeoutMs,
    taskName
) {
    if (
        typeof operation !==
        "function"
    ) {
        return Promise.reject(
            new TypeError(
                "Maintenance operation must be a function."
            )
        );
    }

    const normalizedTimeout =
        normalizePositiveInteger(
            timeoutMs,
            DEFAULT_TASK_TIMEOUT_MS,
            "Maintenance task timeout"
        );

    return new Promise(
        function (
            resolve,
            reject
        ) {
            let settled =
                false;

            const timer =
                setTimeout(
                    function () {
                        if (
                            settled
                        ) {
                            return;
                        }

                        settled =
                            true;

                        reject(
                            new ServiceError(
                                "deadline-exceeded",
                                "The maintenance task timed out.",
                                {
                                    status:
                                        504,

                                    expose:
                                        true,

                                    retryable:
                                        true,

                                    details: {
                                        taskName:
                                            taskName,

                                        timeoutMs:
                                            normalizedTimeout
                                    }
                                }
                            )
                        );
                    },
                    normalizedTimeout
                );

            Promise.resolve()
                .then(
                    operation
                )
                .then(
                    function (
                        result
                    ) {
                        if (
                            settled
                        ) {
                            return;
                        }

                        settled =
                            true;

                        clearTimeout(
                            timer
                        );

                        resolve(
                            result
                        );
                    },
                    function (
                        error
                    ) {
                        if (
                            settled
                        ) {
                            return;
                        }

                        settled =
                            true;

                        clearTimeout(
                            timer
                        );

                        reject(
                            error
                        );
                    }
                );
        }
    );
}

/* ==========================================================
   PERSISTENCE
========================================================== */

async function persistMaintenanceRun(
    runtime,
    result,
    options
) {
    const settings =
        normalizeMaintenanceOptions(
            options
        );

    if (
        !settings.persistRuns
    ) {
        return result;
    }

    assertMaintenanceRuntime(
        runtime
    );

    const record =
        createMaintenanceRunRecord(
            result,
            runtime,
            settings
        );

    await runtime.db
        .collection(
            settings.collection
        )
        .doc(
            record.id
        )
        .set(
            record,
            {
                merge:
                    true
            }
        );

    return result;
}

async function updateMaintenanceRunTasks(
    runtime,
    runId,
    tasks,
    options
) {
    const settings =
        normalizeMaintenanceOptions(
            options
        );

    if (
        !settings.persistRuns
    ) {
        return;
    }

    await runtime.db
        .collection(
            settings.collection
        )
        .doc(
            normalizeMaintenanceRunId(
                runId
            )
        )
        .set(
            {
                tasks:
                    cloneValue(
                        tasks
                    ),

                updatedAt:
                    createDatabaseTimestamp(
                        runtime,
                        resolveNow(
                            runtime,
                            settings
                        )
                    )
            },
            {
                merge:
                    true
            }
        );
}

function createMaintenanceRunRecord(
    result,
    runtime,
    options
) {
    const settings =
        options || {};

    const startedAt =
        toMilliseconds(
            result.startedAt
        );

    const completedAt =
        toMilliseconds(
            result.completedAt
        );

    return {
        id:
            normalizeMaintenanceRunId(
                result.id
            ),

        status:
            normalizeMaintenanceStatus(
                result.status
            ),

        disabled:
            Boolean(
                result.disabled
            ),

        dryRun:
            Boolean(
                result.dryRun
            ),

        skipped:
            Boolean(
                result.skipped
            ),

        reason:
            normalizeOptionalString(
                result.reason
            ),

        taskCount:
            normalizeNonNegativeInteger(
                result.taskCount,
                Array.isArray(
                    result.tasks
                )
                    ? result.tasks
                          .length
                    : 0,
                "Maintenance task count"
            ),

        completedCount:
            normalizeNonNegativeInteger(
                result.completedCount,
                0,
                "Maintenance completed count"
            ),

        failedCount:
            normalizeNonNegativeInteger(
                result.failedCount,
                0,
                "Maintenance failed count"
            ),

        skippedCount:
            normalizeNonNegativeInteger(
                result.skippedCount,
                0,
                "Maintenance skipped count"
            ),

        tasks:
            Array.isArray(
                result.tasks
            )
                ? cloneValue(
                      result.tasks
                  )
                : [],

        startedAt:
            startedAt
                ? createDatabaseTimestamp(
                      runtime,
                      startedAt
                  )
                : null,

        completedAt:
            completedAt
                ? createDatabaseTimestamp(
                      runtime,
                      completedAt
                  )
                : null,

        createdAt:
            createDatabaseTimestamp(
                runtime,
                startedAt ||
                resolveNow(
                    runtime,
                    settings
                )
            ),

        updatedAt:
            createDatabaseTimestamp(
                runtime,
                resolveNow(
                    runtime,
                    settings
                )
            ),

        expiresAt:
            settings.retentionMs
                ? createDatabaseTimestamp(
                      runtime,
                      (
                          completedAt ||
                          startedAt ||
                          resolveNow(
                              runtime,
                              settings
                          )
                      ) +
                      settings.retentionMs
                  )
                : null,

        schemaVersion:
            1
    };
}

/* ==========================================================
   GET
========================================================== */

async function getMaintenanceRun(
    runtime,
    runId,
    options
) {
    const settings =
        normalizeMaintenanceOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return null;
    }

    assertMaintenanceRuntime(
        runtime
    );

    const id =
        normalizeMaintenanceRunId(
            runId
        );

    const snapshot =
        await runtime.db
            .collection(
                settings.collection
            )
            .doc(
                id
            )
            .get();

    if (
        !snapshot.exists
    ) {
        return null;
    }

    return sanitizeMaintenanceRunRecord(
        snapshot.data()
    );
}

/* ==========================================================
   QUERY
========================================================== */

async function queryMaintenanceRuns(
    runtime,
    filters,
    options
) {
    const settings =
        normalizeMaintenanceOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return [];
    }

    assertMaintenanceRuntime(
        runtime
    );

    const normalized =
        normalizeMaintenanceQuery(
            filters,
            settings
        );

    let query =
        runtime.db
            .collection(
                settings.collection
            );

    if (
        normalized.status
    ) {
        query =
            query.where(
                "status",
                "==",
                normalized.status
            );
    }

    if (
        normalized.dryRun !==
        null
    ) {
        query =
            query.where(
                "dryRun",
                "==",
                normalized.dryRun
            );
    }

    if (
        normalized.startedAfter
    ) {
        query =
            query.where(
                "startedAt",
                ">=",
                createDatabaseTimestamp(
                    runtime,
                    normalized
                        .startedAfter
                )
            );
    }

    if (
        normalized.startedBefore
    ) {
        query =
            query.where(
                "startedAt",
                "<=",
                createDatabaseTimestamp(
                    runtime,
                    normalized
                        .startedBefore
                )
            );
    }

    if (
        typeof query.orderBy ===
        "function"
    ) {
        query =
            query.orderBy(
                normalized.orderBy,
                normalized.direction
            );
    }

    if (
        typeof query.limit ===
        "function"
    ) {
        query =
            query.limit(
                normalized.limit
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

    return documents.map(
        function (
            document
        ) {
            return sanitizeMaintenanceRunRecord(
                document.data()
            );
        }
    );
}

function normalizeMaintenanceQuery(
    filters,
    options
) {
    const source =
        filters || {};

    const settings =
        options || {};

    return {
        status:
            source.status
                ? normalizeMaintenanceStatus(
                      source.status
                  )
                : null,

        dryRun:
            source.dryRun ===
                undefined ||
            source.dryRun ===
                null
                ? null
                : Boolean(
                      source.dryRun
                  ),

        startedAfter:
            source.startedAfter !==
            undefined
                ? normalizeMaintenanceDate(
                      source.startedAfter,
                      "Maintenance start filter"
                  )
                : null,

        startedBefore:
            source.startedBefore !==
            undefined
                ? normalizeMaintenanceDate(
                      source.startedBefore,
                      "Maintenance start filter"
                  )
                : null,

        orderBy:
            normalizeMaintenanceOrderField(
                source.orderBy
            ),

        direction:
            String(
                source.direction ||
                "desc"
            ).toLowerCase() ===
            "asc"
                ? "asc"
                : "desc",

        limit:
            normalizeQueryLimit(
                source.limit ||
                settings.queryLimit
            )
    };
}

/* ==========================================================
   CANCEL
========================================================== */

async function cancelMaintenanceRun(
    runtime,
    runId,
    reason,
    options
) {
    const settings =
        normalizeMaintenanceOptions(
            options
        );

    const id =
        normalizeMaintenanceRunId(
            runId
        );

    if (
        settings.disabled
    ) {
        return {
            cancelled:
                false,

            disabled:
                true,

            runId:
                id
        };
    }

    assertMaintenanceRuntime(
        runtime
    );

    const reference =
        runtime.db
            .collection(
                settings.collection
            )
            .doc(
                id
            );

    const now =
        resolveNow(
            runtime,
            settings
        );

    const record =
        await runtime.db
            .runTransaction(
                async function (
                    transaction
                ) {
                    const snapshot =
                        await transaction.get(
                            reference
                        );

                    if (
                        !snapshot.exists
                    ) {
                        throw createMaintenanceRunNotFoundError(
                            id
                        );
                    }

                    const existing =
                        snapshot.data();

                    if (
                        TERMINAL_MAINTENANCE_STATUSES
                            .includes(
                                normalizeMaintenanceStatus(
                                    existing.status
                                )
                            )
                    ) {
                        throw new ServiceError(
                            "failed-precondition",
                            "A terminal maintenance run cannot be cancelled.",
                            {
                                status:
                                    409,

                                expose:
                                    true
                            }
                        );
                    }

                    const update = {
                        status:
                            MAINTENANCE_STATUSES
                                .cancelled,

                        cancellationReason:
                            normalizeOptionalString(
                                reason
                            ),

                        cancelledAt:
                            createDatabaseTimestamp(
                                runtime,
                                now
                            ),

                        completedAt:
                            createDatabaseTimestamp(
                                runtime,
                                now
                            ),

                        updatedAt:
                            createDatabaseTimestamp(
                                runtime,
                                now
                            )
                    };

                    transaction.set(
                        reference,
                        update,
                        {
                            merge:
                                true
                        }
                    );

                    return Object.assign(
                        {},
                        existing,
                        update
                    );
                }
            );

    const result =
        sanitizeMaintenanceRunRecord(
            record
        );

    logMaintenanceEvent(
        runtime,
        result,
        "cancelled",
        settings
    );

    return {
        cancelled:
            true,

        disabled:
            false,

        runId:
            id,

        maintenance:
            result
    };
}

/* ==========================================================
   RESULT BUILDERS
========================================================== */

function createMaintenanceResult(
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

    const tasks =
        Array.isArray(
            source.tasks
        )
            ? source.tasks.map(
                  function (
                      task
                  ) {
                      return createMaintenanceTaskResult(
                          task
                      );
                  }
              )
            : [];

    return {
        id:
            normalizeMaintenanceRunId(
                source.id
            ),

        status:
            normalizeMaintenanceStatus(
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

        skipped:
            Boolean(
                source.skipped
            ),

        reason:
            normalizeOptionalString(
                source.reason
            ),

        taskCount:
            normalizeNonNegativeInteger(
                source.taskCount,
                tasks.length,
                "Maintenance task count"
            ),

        completedCount:
            normalizeNonNegativeInteger(
                source.completedCount,
                tasks.filter(
                    function (
                        task
                    ) {
                        return (
                            task.status ===
                            MAINTENANCE_TASK_STATUSES
                                .completed
                        );
                    }
                ).length,
                "Maintenance completed count"
            ),

        failedCount:
            normalizeNonNegativeInteger(
                source.failedCount,
                tasks.filter(
                    function (
                        task
                    ) {
                        return (
                            task.status ===
                                MAINTENANCE_TASK_STATUSES
                                    .failed ||
                            task.status ===
                                MAINTENANCE_TASK_STATUSES
                                    .timedOut
                        );
                    }
                ).length,
                "Maintenance failed count"
            ),

        skippedCount:
            normalizeNonNegativeInteger(
                source.skippedCount,
                tasks.filter(
                    function (
                        task
                    ) {
                        return (
                            task.status ===
                            MAINTENANCE_TASK_STATUSES
                                .skipped
                        );
                    }
                ).length,
                "Maintenance skipped count"
            ),

        tasks:
            tasks,

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

function createMaintenanceTaskResult(
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
        name:
            normalizeMaintenanceTaskName(
                source.name
            ),

        status:
            normalizeMaintenanceTaskStatus(
                source.status
            ),

        skipped:
            Boolean(
                source.skipped
            ),

        reason:
            normalizeOptionalString(
                source.reason
            ),

        result:
            cloneValue(
                source.result
            ),

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
        ) ||
        startedAt <=
            0 ||
        completedAt <=
            0
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
   SANITIZATION
========================================================== */

function sanitizeMaintenanceRunRecord(
    record
) {
    if (
        !record
    ) {
        return null;
    }

    return {
        id:
            record.id,

        status:
            normalizeMaintenanceStatus(
                record.status
            ),

        disabled:
            Boolean(
                record.disabled
            ),

        dryRun:
            Boolean(
                record.dryRun
            ),

        skipped:
            Boolean(
                record.skipped
            ),

        reason:
            record.reason ||
            null,

        cancellationReason:
            record.cancellationReason ||
            null,

        taskCount:
            normalizeNonNegativeInteger(
                record.taskCount,
                0,
                "Maintenance task count"
            ),

        completedCount:
            normalizeNonNegativeInteger(
                record.completedCount,
                0,
                "Maintenance completed count"
            ),

        failedCount:
            normalizeNonNegativeInteger(
                record.failedCount,
                0,
                "Maintenance failed count"
            ),

        skippedCount:
            normalizeNonNegativeInteger(
                record.skippedCount,
                0,
                "Maintenance skipped count"
            ),

        tasks:
            Array.isArray(
                record.tasks
            )
                ? cloneValue(
                      record.tasks
                  )
                : [],

        startedAt:
            serializeTimestamp(
                record.startedAt
            ),

        completedAt:
            serializeTimestamp(
                record.completedAt
            ),

        cancelledAt:
            serializeTimestamp(
                record.cancelledAt
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

        schemaVersion:
            Number(
                record.schemaVersion ||
                1
            )
    };
}

/* ==========================================================
   ERROR HELPERS
========================================================== */

function serializeMaintenanceError(
    error
) {
    if (
        !error
    ) {
        return null;
    }

    return {
        name:
            error.name ||
            "Error",

        code:
            error.code ||
            "maintenance-failed",

        message:
            error.publicMessage ||
            error.message ||
            "Maintenance failed.",

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
                : false,

        details:
            error.details &&
            typeof error.details ===
                "object"
                ? cloneValue(
                      error.details
                  )
                : null
    };
}

function createMaintenanceRunNotFoundError(
    runId
) {
    return new ServiceError(
        "not-found",
        "The maintenance run was not found.",
        {
            status:
                404,

            expose:
                true,

            details: {
                runId:
                    runId
            }
        }
    );
}

/* ==========================================================
   SERIALIZATION
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
        Buffer.isBuffer(
            value
        )
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
        return String(
            value
        );
    }

    if (
        currentState.seen.has(
            value
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "Maintenance data contains a circular reference.",
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

    let result;

    if (
        Array.isArray(
            value
        )
    ) {
        result =
            value.map(
                function (
                    item
                ) {
                    return normalizeStableValue(
                        item,
                        currentState
                    );
                }
            );
    } else {
        result =
            Object.keys(
                value
            )
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
    }

    currentState.seen.delete(
        value
    );

    return result;
}

function assertSerializableMaintenanceValue(
    value,
    maximumBytes,
    label
) {
    const serialized =
        stableStringify(
            value
        );

    const bytes =
        Buffer.byteLength(
            serialized,
            "utf8"
        );

    if (
        bytes >
        maximumBytes
    ) {
        throw new ServiceError(
            "resource-exhausted",
            label +
            " is too large.",
            {
                status:
                    413,

                expose:
                    true,

                details: {
                    bytes:
                        bytes,

                    maximumBytes:
                        maximumBytes
                }
            }
        );
    }

    return true;
}

/* ==========================================================
   NORMALIZERS
========================================================== */

function normalizeMaintenanceRunId(
    value
) {
    const normalized =
        String(
            value || ""
        ).trim();

    if (
        !normalized ||
        normalized.includes(
            "/"
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The maintenance run ID is invalid.",
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

function normalizeMaintenanceStatus(
    value
) {
    const normalized =
        String(
            value ||
            DEFAULT_STATUS
        )
            .trim()
            .toLowerCase();

    if (
        !Object.values(
            MAINTENANCE_STATUSES
        ).includes(
            normalized
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The maintenance status is invalid.",
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

function normalizeMaintenanceTaskStatus(
    value
) {
    const normalized =
        String(
            value ||
            MAINTENANCE_TASK_STATUSES
                .pending
        )
            .trim()
            .toLowerCase();

    if (
        !Object.values(
            MAINTENANCE_TASK_STATUSES
        ).includes(
            normalized
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The maintenance task status is invalid.",
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

function normalizeMaintenanceTaskName(
    value
) {
    const normalized =
        String(
            value || ""
        )
            .trim()
            .toLowerCase()
            .replace(
                /[^a-z0-9._:-]/g,
                "-"
            )
            .replace(
                /-{2,}/g,
                "-"
            )
            .replace(
                /^-+|-+$/g,
                ""
            );

    if (
        !normalized
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The maintenance task name is invalid.",
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

function normalizeMaintenanceTasks(
    value,
    maximumTasks
) {
    const values =
        value ===
            undefined ||
        value ===
            null
            ? DEFAULT_TASKS
                  .slice()
            : Array.isArray(
                  value
              )
              ? value
              : [
                    value
                ];

    const tasks =
        Array.from(
            new Set(
                values.map(
                    normalizeMaintenanceTaskName
                )
            )
        );

    if (
        tasks.length ===
        0
    ) {
        throw new TypeError(
            "At least one maintenance task is required."
        );
    }

    if (
        tasks.length >
        maximumTasks
    ) {
        throw new ServiceError(
            "resource-exhausted",
            "Too many maintenance tasks were requested.",
            {
                status:
                    413,

                expose:
                    true,

                details: {
                    taskCount:
                        tasks.length,

                    maximumTasks:
                        maximumTasks
                }
            }
        );
    }

    return tasks;
}

function normalizeMaintenanceDate(
    value,
    label
) {
    const milliseconds =
        toMilliseconds(
            value
        );

    if (
        !Number.isFinite(
            milliseconds
        ) ||
        milliseconds <
            0
    ) {
        throw new TypeError(
            label +
            " is invalid."
        );
    }

    return milliseconds;
}

function normalizeMaintenanceOrderField(
    value
) {
    const allowed =
        new Set([
            "startedAt",
            "completedAt",
            "createdAt",
            "updatedAt",
            "status",
            "taskCount",
            "failedCount"
        ]);

    const normalized =
        String(
            value ||
            "startedAt"
        ).trim();

    return allowed.has(
        normalized
    )
        ? normalized
        : "startedAt";
}

function normalizeQueryLimit(
    value
) {
    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {
        return DEFAULT_QUERY_LIMIT;
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
            "Maintenance query limit must be a positive integer."
        );
    }

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

function normalizeOptionalString(
    value
) {
    if (
        value === undefined ||
        value === null
    ) {
        return null;
    }

    const normalized =
        String(
            value
        ).trim();

    return normalized ||
        null;
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
        normalized.includes(
            "/"
        )
    ) {
        throw new TypeError(
            "Maintenance collection must be a Firestore collection name."
        );
    }

    return normalized;
}

/* ==========================================================
   OPTIONS
========================================================== */

function normalizeMaintenanceOptions(
    options
) {
    const settings =
        options || {};

    const maximumTasks =
        normalizePositiveInteger(
            settings.maxTasks,
            DEFAULT_MAX_TASKS,
            "Maximum maintenance tasks"
        );

    return {
        runtime:
            settings.runtime,

        collection:
            normalizeCollection(
                settings.collection ||
                MAINTENANCE_COLLECTION
            ),

        tasks:
            normalizeMaintenanceTasks(
                settings.tasks,
                maximumTasks
            ),

        maxTasks:
            maximumTasks,

        taskTimeoutMs:
            normalizePositiveInteger(
                settings.taskTimeoutMs,
                DEFAULT_TASK_TIMEOUT_MS,
                "Maintenance task timeout"
            ),

        lockLeaseMs:
            normalizePositiveInteger(
                settings.lockLeaseMs,
                DEFAULT_LOCK_LEASE_MS,
                "Maintenance lock lease"
            ),

        lockAcquireTimeoutMs:
            normalizeNonNegativeInteger(
                settings.lockAcquireTimeoutMs,
                0,
                "Maintenance lock acquisition timeout"
            ),

        lockRetryIntervalMs:
            normalizePositiveInteger(
                settings.lockRetryIntervalMs,
                100,
                "Maintenance lock retry interval"
            ),

        retentionMs:
            normalizeNonNegativeInteger(
                settings.retentionMs,
                DEFAULT_RETENTION_MS,
                "Maintenance retention"
            ),

        queryLimit:
            normalizeQueryLimit(
                settings.queryLimit
            ),

        maxResultBytes:
            normalizePositiveInteger(
                settings.maxResultBytes,
                DEFAULT_MAX_RESULT_BYTES,
                "Maximum maintenance result size"
            ),

        lockNamespace:
            normalizeMaintenanceTaskName(
                settings.lockNamespace ||
                DEFAULT_LOCK_NAMESPACE
            ),

        lockKey:
            normalizeMaintenanceTaskName(
                settings.lockKey ||
                DEFAULT_LOCK_KEY
            ),

        workerId:
            normalizeOptionalString(
                settings.workerId
            ),

        runId:
            settings.runId
                ? normalizeMaintenanceRunId(
                      settings.runId
                  )
                : null,

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

        returnTaskFailures:
            settings.returnTaskFailures !==
            false,

        skipUnknownTasks:
            settings.skipUnknownTasks !==
            false,

        persistRuns:
            settings.persistRuns !==
            false,

        includeDeletedIds:
            Boolean(
                settings.includeDeletedIds
            ),

        cleanupCollections:
            settings.cleanupCollections,

        cleanupBatchSize:
            settings.cleanupBatchSize,

        cleanupMaxPasses:
            settings.cleanupMaxPasses,

        cleanupStopOnError:
            Boolean(
                settings.cleanupStopOnError
            ),

        taskHandlers:
            settings.taskHandlers ||
            {},

        cleanupService:
            settings.cleanupService,

        lockService:
            settings.lockService,

        healthCheck:
            settings.healthCheck,

        cacheMaintenance:
            settings.cacheMaintenance,

        recoveryHandler:
            settings.recoveryHandler,

        log:
            settings.log !==
            false,

        now:
            settings.now
    };
}

/* ==========================================================
   IDENTIFIERS
========================================================== */

function createMaintenanceRunId(
    now
) {
    const prefix =
        Number(
            now
        )
            .toString(
                36
            )
            .padStart(
                9,
                "0"
            );

    const random =
        typeof crypto.randomUUID ===
        "function"
            ? crypto
                  .randomUUID()
                  .replace(
                      /-/g,
                      ""
                  )
            : crypto
                  .randomBytes(
                      16
                  )
                  .toString(
                      "hex"
                  );

    return (
        prefix +
        "_" +
        random
    );
}

/* ==========================================================
   RUNTIME AND TIME
========================================================== */

function assertMaintenanceRuntime(
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
            "The maintenance datastore is unavailable.",
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

function logMaintenanceEvent(
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

        runId:
            result &&
            result.id,

        status:
            result &&
            result.status,

        taskCount:
            result &&
            result.taskCount,

        completedCount:
            result &&
            result.completedCount,

        failedCount:
            result &&
            result.failedCount,

        skippedCount:
            result &&
            result.skippedCount,

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
            MAINTENANCE_STATUSES
                .failed &&
        typeof runtime.logger.error ===
            "function"
    ) {
        runtime.logger.error(
            "Maintenance failed.",
            metadata
        );

        return;
    }

    if (
        result &&
        (
            result.status ===
                MAINTENANCE_STATUSES
                    .partial ||
            result.status ===
                MAINTENANCE_STATUSES
                    .skipped
        ) &&
        typeof runtime.logger.warn ===
            "function"
    ) {
        runtime.logger.warn(
            "Maintenance completed with warnings.",
            metadata
        );

        return;
    }

    if (
        typeof runtime.logger.info ===
        "function"
    ) {
        runtime.logger.info(
            "Maintenance event.",
            metadata
        );
    }
}

function logMaintenanceTaskEvent(
    runtime,
    task,
    event,
    options
) {
    const settings =
        options || {};

    if (
        !settings.log ||
        !runtime ||
        !runtime.logger ||
        typeof runtime.logger.info !==
            "function"
    ) {
        return;
    }

    runtime.logger.info(
        "Maintenance task event.",
        {
            event:
                event,

            taskName:
                task &&
                task.name,

            status:
                task &&
                task.status,

            durationMs:
                task &&
                task.durationMs
        }
    );
}

function logMaintenanceTaskFailure(
    runtime,
    task,
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
        "Maintenance task failed.",
        {
            taskName:
                task &&
                task.name,

            status:
                task &&
                task.status,

            error:
                task &&
                task.error
        }
    );
}

function logMaintenanceLockFailure(
    runtime,
    runId,
    error,
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

    runtime.logger.warn(
        "Maintenance lock release failed.",
        {
            runId:
                runId,

            error:
                serializeMaintenanceError(
                    error
                )
        }
    );
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
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
    constants: {
        MAINTENANCE_COLLECTION,
        DEFAULT_STATUS,
        DEFAULT_TASK_TIMEOUT_MS,
        DEFAULT_LOCK_LEASE_MS,
        DEFAULT_RETENTION_MS,
        DEFAULT_QUERY_LIMIT,
        MAX_QUERY_LIMIT,
        DEFAULT_MAX_TASKS,
        DEFAULT_MAX_RESULT_BYTES,
        DEFAULT_LOCK_NAMESPACE,
        DEFAULT_LOCK_KEY,
        MAINTENANCE_STATUSES,
        MAINTENANCE_TASK_STATUSES,
        TERMINAL_MAINTENANCE_STATUSES,
        DEFAULT_TASKS
    }
};