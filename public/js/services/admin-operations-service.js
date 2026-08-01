"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ADMIN OPERATIONS SERVICE

   Responsibilities:
   - Coordinate operational Cloud Function actions
   - Expose admin-friendly methods and state
   - Normalize loading, success, and error results
   - Handle cleanup, maintenance, reconciliation,
     backups, migrations, and dead-letter workflows
========================================================== */

(function (
    global
) {
    /* ======================================================
       CONSTANTS
    ====================================================== */

    const OPERATION_STATES =
        Object.freeze({
            idle:
                "idle",

            loading:
                "loading",

            success:
                "success",

            error:
                "error"
        });

    const DEFAULT_QUERY_LIMIT =
        50;

    /* ======================================================
       SERVICE ERROR
    ====================================================== */

    class AdminOperationsError extends Error {
        constructor(
            code,
            message,
            options
        ) {
            super(
                message ||
                "Admin operation failed."
            );

            this.name =
                "AdminOperationsError";

            this.code =
                code ||
                "admin-operations/unknown";

            const settings =
                options ||
                {};

            this.operation =
                settings.operation ||
                null;

            this.details =
                settings.details ||
                null;

            this.retryable =
                Boolean(
                    settings.retryable
                );

            this.originalError =
                settings.originalError ||
                null;
        }
    }

    /* ======================================================
       SERVICE FACTORY
    ====================================================== */

    function createAdminOperationsService(
        options
    ) {
        const settings =
            normalizeAdminOperationsOptions(
                options
            );

        const functionsService =
            settings.functionsService ||
            resolveFunctionsService();

        const listeners =
            new Set();

        const operationState =
            new Map();

        let disposed =
            false;

        /* ==================================================
           STATE
        ================================================== */

        function ensureActive() {
            if (
                disposed
            ) {
                throw new AdminOperationsError(
                    "admin-operations/disposed",
                    "The admin operations service has been disposed."
                );
            }
        }

        function createState(
            operation
        ) {
            return {
                operation:
                    operation,

                status:
                    OPERATION_STATES.idle,

                loading:
                    false,

                data:
                    null,

                error:
                    null,

                startedAt:
                    null,

                completedAt:
                    null
            };
        }

        function getOperationState(
            operation
        ) {
            const name =
                normalizeOperationName(
                    operation
                );

            if (
                !operationState.has(
                    name
                )
            ) {
                operationState.set(
                    name,
                    createState(
                        name
                    )
                );
            }

            return cloneValue(
                operationState.get(
                    name
                )
            );
        }

        function setOperationState(
            operation,
            patch
        ) {
            const name =
                normalizeOperationName(
                    operation
                );

            const current =
                operationState.get(
                    name
                ) ||
                createState(
                    name
                );

            const next =
                Object.assign(
                    {},
                    current,
                    patch || {},
                    {
                        operation:
                            name
                    }
                );

            operationState.set(
                name,
                next
            );

            emit({
                type:
                    "state",

                operation:
                    name,

                state:
                    cloneValue(
                        next
                    )
            });

            return cloneValue(
                next
            );
        }

        function getSnapshot() {
            const operations =
                {};

            for (
                const [
                    key,
                    value
                ] of
                operationState
            ) {
                operations[key] =
                    cloneValue(
                        value
                    );
            }

            return {
                disposed:
                    disposed,

                operations:
                    operations
            };
        }

        /* ==================================================
           EVENTS
        ================================================== */

        function subscribe(
            listener
        ) {
            ensureActive();

            if (
                typeof listener !==
                "function"
            ) {
                throw new TypeError(
                    "Admin operations listener must be a function."
                );
            }

            listeners.add(
                listener
            );

            return function unsubscribe() {
                listeners.delete(
                    listener
                );
            };
        }

        function emit(
            event
        ) {
            for (
                const listener of
                listeners
            ) {
                try {
                    listener(
                        cloneValue(
                            event
                        )
                    );
                } catch (
                    error
                ) {
                    if (
                        global.console &&
                        typeof global.console
                            .error ===
                            "function"
                    ) {
                        global.console.error(
                            "Admin operations listener failed.",
                            error
                        );
                    }
                }
            }
        }

        /* ==================================================
           EXECUTION
        ================================================== */

        async function execute(
            operation,
            handler
        ) {
            ensureActive();

            const name =
                normalizeOperationName(
                    operation
                );

            if (
                typeof handler !==
                "function"
            ) {
                throw new TypeError(
                    "Admin operation handler must be a function."
                );
            }

            const startedAt =
                Date.now();

            setOperationState(
                name,
                {
                    status:
                        OPERATION_STATES
                            .loading,

                    loading:
                        true,

                    error:
                        null,

                    startedAt:
                        startedAt,

                    completedAt:
                        null
                }
            );

            emit({
                type:
                    "operation-started",

                operation:
                    name,

                startedAt:
                    startedAt
            });

            try {
                const data =
                    await handler();

                const completedAt =
                    Date.now();

                setOperationState(
                    name,
                    {
                        status:
                            OPERATION_STATES
                                .success,

                        loading:
                            false,

                        data:
                            cloneValue(
                                data
                            ),

                        error:
                            null,

                        completedAt:
                            completedAt
                    }
                );

                emit({
                    type:
                        "operation-completed",

                    operation:
                        name,

                    data:
                        cloneValue(
                            data
                        ),

                    startedAt:
                        startedAt,

                    completedAt:
                        completedAt
                });

                return data;
            } catch (
                error
            ) {
                const normalized =
                    normalizeAdminOperationsError(
                        error,
                        name
                    );

                const completedAt =
                    Date.now();

                setOperationState(
                    name,
                    {
                        status:
                            OPERATION_STATES
                                .error,

                        loading:
                            false,

                        error:
                            serializeAdminOperationsError(
                                normalized
                            ),

                        completedAt:
                            completedAt
                    }
                );

                emit({
                    type:
                        "operation-failed",

                    operation:
                        name,

                    error:
                        serializeAdminOperationsError(
                            normalized
                        ),

                    startedAt:
                        startedAt,

                    completedAt:
                        completedAt
                });

                throw normalized;
            }
        }

        /* ==================================================
           HEALTH
        ================================================== */

        async function getHealth() {
            return execute(
                "operationsHealth",
                function () {
                    return functionsService
                        .operationsHealth();
                }
            );
        }

        /* ==================================================
           CLEANUP
        ================================================== */

        async function runCleanup(
            input
        ) {
            return execute(
                "runCleanup",
                function () {
                    return functionsService
                        .runCleanup(
                            normalizeObject(
                                input
                            )
                        );
                }
            );
        }

        /* ==================================================
           MAINTENANCE
        ================================================== */

        async function runMaintenance(
            input
        ) {
            return execute(
                "runMaintenance",
                function () {
                    return functionsService
                        .runMaintenance(
                            normalizeObject(
                                input
                            )
                        );
                }
            );
        }

        /* ==================================================
           DEAD LETTERS
        ================================================== */

        async function listDeadLetters(
            filters
        ) {
            return execute(
                "queryDeadLetters",
                function () {
                    return functionsService
                        .queryDeadLetters(
                            normalizeQuery(
                                filters
                            )
                        );
                }
            );
        }

        async function retryDeadLetter(
            id,
            options
        ) {
            return execute(
                "retryDeadLetter",
                function () {
                    return functionsService
                        .retryDeadLetter(
                            normalizeRequiredId(
                                id,
                                "Dead-letter ID"
                            ),
                            normalizeObject(
                                options
                            )
                        );
                }
            );
        }

        async function resolveDeadLetter(
            id,
            resolution,
            options
        ) {
            return execute(
                "resolveDeadLetter",
                function () {
                    return functionsService
                        .resolveDeadLetter(
                            normalizeRequiredId(
                                id,
                                "Dead-letter ID"
                            ),
                            normalizeResolution(
                                resolution
                            ),
                            normalizeObject(
                                options
                            )
                        );
                }
            );
        }

        /* ==================================================
           RECONCILIATION
        ================================================== */

        async function runReconciliation(
            input
        ) {
            return execute(
                "runReconciliation",
                function () {
                    return functionsService
                        .runReconciliation(
                            normalizeObject(
                                input
                            )
                        );
                }
            );
        }

        async function listReconciliationRuns(
            filters
        ) {
            return execute(
                "queryReconciliationRuns",
                function () {
                    return functionsService
                        .queryReconciliationRuns(
                            normalizeQuery(
                                filters
                            )
                        );
                }
            );
        }

        async function listReconciliationItems(
            filters
        ) {
            return execute(
                "queryReconciliationItems",
                function () {
                    return functionsService
                        .queryReconciliationItems(
                            normalizeQuery(
                                filters
                            )
                        );
                }
            );
        }

        async function resolveReconciliationItem(
            id,
            resolution,
            options
        ) {
            return execute(
                "resolveReconciliationItem",
                function () {
                    return functionsService
                        .resolveReconciliationItem(
                            normalizeRequiredId(
                                id,
                                "Reconciliation item ID"
                            ),
                            normalizeResolution(
                                resolution
                            ),
                            normalizeObject(
                                options
                            )
                        );
                }
            );
        }

        async function ignoreReconciliationItem(
            id,
            reason,
            options
        ) {
            return execute(
                "ignoreReconciliationItem",
                function () {
                    return functionsService
                        .ignoreReconciliationItem(
                            normalizeRequiredId(
                                id,
                                "Reconciliation item ID"
                            ),
                            normalizeOptionalString(
                                reason
                            ),
                            normalizeObject(
                                options
                            )
                        );
                }
            );
        }

        async function cancelReconciliation(
            id,
            reason,
            options
        ) {
            return execute(
                "cancelReconciliation",
                function () {
                    return functionsService
                        .cancelReconciliation(
                            normalizeRequiredId(
                                id,
                                "Reconciliation run ID"
                            ),
                            normalizeOptionalString(
                                reason
                            ),
                            normalizeObject(
                                options
                            )
                        );
                }
            );
        }

        /* ==================================================
           BACKUPS
        ================================================== */

        async function exportBackup(
            input
        ) {
            return execute(
                "exportBackup",
                function () {
                    return functionsService
                        .exportBackup(
                            normalizeObject(
                                input
                            )
                        );
                }
            );
        }

        async function inspectBackup(
            backup,
            options
        ) {
            return execute(
                "inspectBackup",
                function () {
                    return functionsService
                        .inspectBackup(
                            normalizeBackup(
                                backup
                            ),
                            normalizeObject(
                                options
                            )
                        );
                }
            );
        }

        async function restoreBackup(
            backup,
            options
        ) {
            return execute(
                "restoreBackup",
                function () {
                    return functionsService
                        .restoreBackup(
                            normalizeBackup(
                                backup
                            ),
                            normalizeObject(
                                options
                            )
                        );
                }
            );
        }

        async function listBackupRuns(
            filters
        ) {
            return execute(
                "queryBackupRuns",
                function () {
                    return functionsService
                        .queryBackupRuns(
                            normalizeQuery(
                                filters
                            )
                        );
                }
            );
        }

        async function cancelBackup(
            id,
            reason,
            options
        ) {
            return execute(
                "cancelBackup",
                function () {
                    return functionsService
                        .cancelBackup(
                            normalizeRequiredId(
                                id,
                                "Backup run ID"
                            ),
                            normalizeOptionalString(
                                reason
                            ),
                            normalizeObject(
                                options
                            )
                        );
                }
            );
        }

        /* ==================================================
           MIGRATIONS
        ================================================== */

        async function planMigrations(
            input
        ) {
            return execute(
                "planMigrations",
                function () {
                    return functionsService
                        .planMigrations(
                            normalizeObject(
                                input
                            )
                        );
                }
            );
        }

        async function runMigrations(
            input
        ) {
            return execute(
                "runMigrations",
                function () {
                    return functionsService
                        .runMigrations(
                            normalizeObject(
                                input
                            )
                        );
                }
            );
        }

        async function listMigrationRuns(
            filters
        ) {
            return execute(
                "queryMigrationRuns",
                function () {
                    return functionsService
                        .queryMigrationRuns(
                            normalizeQuery(
                                filters
                            )
                        );
                }
            );
        }

        async function getMigrationState(
            id
        ) {
            return execute(
                "getMigrationState",
                function () {
                    return functionsService
                        .getMigrationState(
                            normalizeRequiredId(
                                id,
                                "Migration ID"
                            )
                        );
                }
            );
        }

        async function cancelMigration(
            id,
            reason,
            options
        ) {
            return execute(
                "cancelMigration",
                function () {
                    return functionsService
                        .cancelMigration(
                            normalizeRequiredId(
                                id,
                                "Migration run ID"
                            ),
                            normalizeOptionalString(
                                reason
                            ),
                            normalizeObject(
                                options
                            )
                        );
                }
            );
        }

        /* ==================================================
           DASHBOARD LOAD
        ================================================== */

        async function loadOperationsDashboard(
            options
        ) {
            const source =
                normalizeObject(
                    options
                );

            return execute(
                "loadOperationsDashboard",
                async function () {
                    const [
                        health,
                        deadLetters,
                        reconciliationRuns,
                        backupRuns,
                        migrationRuns
                    ] =
                        await Promise.all([
                            functionsService
                                .operationsHealth(),

                            functionsService
                                .queryDeadLetters(
                                    normalizeQuery(
                                        source.deadLetters
                                    )
                                ),

                            functionsService
                                .queryReconciliationRuns(
                                    normalizeQuery(
                                        source.reconciliation
                                    )
                                ),

                            functionsService
                                .queryBackupRuns(
                                    normalizeQuery(
                                        source.backups
                                    )
                                ),

                            functionsService
                                .queryMigrationRuns(
                                    normalizeQuery(
                                        source.migrations
                                    )
                                )
                        ]);

                    return {
                        health:
                            health,

                        deadLetters:
                            normalizeList(
                                deadLetters
                            ),

                        reconciliationRuns:
                            normalizeList(
                                reconciliationRuns
                            ),

                        backupRuns:
                            normalizeList(
                                backupRuns
                            ),

                        migrationRuns:
                            normalizeList(
                                migrationRuns
                            ),

                        loadedAt:
                            new Date()
                                .toISOString()
                    };
                }
            );
        }

        /* ==================================================
           STATE RESET
        ================================================== */

        function resetOperation(
            operation
        ) {
            ensureActive();

            const name =
                normalizeOperationName(
                    operation
                );

            operationState.set(
                name,
                createState(
                    name
                )
            );

            emit({
                type:
                    "state-reset",

                operation:
                    name,

                state:
                    getOperationState(
                        name
                    )
            });

            return getOperationState(
                name
            );
        }

        function resetAll() {
            ensureActive();

            operationState.clear();

            emit({
                type:
                    "state-reset-all"
            });
        }

        function dispose() {
            if (
                disposed
            ) {
                return;
            }

            disposed =
                true;

            listeners.clear();
            operationState.clear();
        }

        /* ==================================================
           SERVICE
        ================================================== */

        return Object.freeze({
            getHealth,

            runCleanup,
            runMaintenance,

            listDeadLetters,
            retryDeadLetter,
            resolveDeadLetter,

            runReconciliation,
            listReconciliationRuns,
            listReconciliationItems,
            resolveReconciliationItem,
            ignoreReconciliationItem,
            cancelReconciliation,

            exportBackup,
            inspectBackup,
            restoreBackup,
            listBackupRuns,
            cancelBackup,

            planMigrations,
            runMigrations,
            listMigrationRuns,
            getMigrationState,
            cancelMigration,

            loadOperationsDashboard,

            execute,
            subscribe,
            getOperationState,
            getSnapshot,
            resetOperation,
            resetAll,
            dispose,

            functionsService,

            options:
                Object.freeze(
                    Object.assign(
                        {},
                        settings
                    )
                )
        });
    }

    /* ======================================================
       DEPENDENCY RESOLUTION
    ====================================================== */

    function resolveFunctionsService() {
        if (
            global
                .LEternelFunctions &&
            typeof global
                .LEternelFunctions
                .getFunctionsService ===
                "function"
        ) {
            return global
                .LEternelFunctions
                .getFunctionsService();
        }

        throw new AdminOperationsError(
            "admin-operations/configuration",
            "The Cloud Functions service is unavailable."
        );
    }

    /* ======================================================
       OPTIONS
    ====================================================== */

    function normalizeAdminOperationsOptions(
        options
    ) {
        const source =
            options ||
            {};

        return {
            functionsService:
                source.functionsService ||
                null,

            defaultQueryLimit:
                normalizePositiveInteger(
                    source.defaultQueryLimit,
                    DEFAULT_QUERY_LIMIT,
                    "Default query limit"
                )
        };
    }

    /* ======================================================
       NORMALIZERS
    ====================================================== */

    function normalizeOperationName(
        value
    ) {
        const normalized =
            String(
                value ||
                ""
            ).trim();

        if (
            !normalized
        ) {
            throw new TypeError(
                "Admin operation name is required."
            );
        }

        return normalized;
    }

    function normalizeObject(
        value
    ) {
        if (
            value ===
                undefined ||
            value ===
                null
        ) {
            return {};
        }

        if (
            typeof value !==
                "object" ||
            Array.isArray(
                value
            )
        ) {
            throw new TypeError(
                "Admin operation input must be an object."
            );
        }

        return cloneValue(
            value
        );
    }

    function normalizeQuery(
        value
    ) {
        const query =
            normalizeObject(
                value
            );

        if (
            query.limit ===
                undefined ||
            query.limit ===
                null ||
            query.limit ===
                ""
        ) {
            query.limit =
                DEFAULT_QUERY_LIMIT;
        } else {
            query.limit =
                normalizePositiveInteger(
                    query.limit,
                    DEFAULT_QUERY_LIMIT,
                    "Query limit"
                );
        }

        return query;
    }

    function normalizeRequiredId(
        value,
        label
    ) {
        const normalized =
            String(
                value ||
                ""
            ).trim();

        if (
            !normalized
        ) {
            throw new TypeError(
                (
                    label ||
                    "ID"
                ) +
                " is required."
            );
        }

        return normalized;
    }

    function normalizeOptionalString(
        value
    ) {
        if (
            value ===
                undefined ||
            value ===
                null
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

    function normalizeResolution(
        value
    ) {
        if (
            value ===
                undefined ||
            value ===
                null
        ) {
            return {};
        }

        if (
            typeof value !==
                "object" ||
            Array.isArray(
                value
            )
        ) {
            return {
                value:
                    cloneValue(
                        value
                    )
            };
        }

        return cloneValue(
            value
        );
    }

    function normalizeBackup(
        value
    ) {
        if (
            !value ||
            typeof value !==
                "object" ||
            Array.isArray(
                value
            )
        ) {
            throw new TypeError(
                "Backup payload must be an object."
            );
        }

        return cloneValue(
            value
        );
    }

    function normalizePositiveInteger(
        value,
        fallback,
        label
    ) {
        if (
            value ===
                undefined ||
            value ===
                null ||
            value ===
                ""
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

    function normalizeList(
        value
    ) {
        if (
            Array.isArray(
                value
            )
        ) {
            return cloneValue(
                value
            );
        }

        if (
            value &&
            Array.isArray(
                value.items
            )
        ) {
            return cloneValue(
                value.items
            );
        }

        if (
            value &&
            Array.isArray(
                value.results
            )
        ) {
            return cloneValue(
                value.results
            );
        }

        return [];
    }

    /* ======================================================
       ERRORS
    ====================================================== */

    function normalizeAdminOperationsError(
        error,
        operation
    ) {
        if (
            error instanceof
            AdminOperationsError
        ) {
            return error;
        }

        const code =
            error &&
            error.code
                ? String(
                      error.code
                  )
                : "admin-operations/unknown";

        const message =
            error &&
            error.message
                ? String(
                      error.message
                  )
                : "Admin operation failed.";

        return new AdminOperationsError(
            code,
            message,
            {
                operation:
                    operation,

                details:
                    error &&
                    error.details !==
                        undefined
                        ? cloneValue(
                              error.details
                          )
                        : null,

                retryable:
                    Boolean(
                        error &&
                        error.retryable
                    ),

                originalError:
                    error
            }
        );
    }

    function serializeAdminOperationsError(
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
                "AdminOperationsError",

            code:
                error.code ||
                "admin-operations/unknown",

            message:
                error.message ||
                "Admin operation failed.",

            operation:
                error.operation ||
                null,

            details:
                cloneValue(
                    error.details
                ),

            retryable:
                Boolean(
                    error.retryable
                )
        };
    }

    /* ======================================================
       CLONE
    ====================================================== */

    function cloneValue(
        value
    ) {
        if (
            value ===
                undefined ||
            value ===
                null
        ) {
            return value;
        }

        if (
            value instanceof Date
        ) {
            return value.toISOString();
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
            return Object.keys(
                value
            ).reduce(
                function (
                    output,
                    key
                ) {
                    output[
                        key
                    ] =
                        cloneValue(
                            value[
                                key
                            ]
                        );

                    return output;
                },
                {}
            );
        }

        return value;
    }

    /* ======================================================
       DEFAULT INSTANCE
    ====================================================== */

    let defaultInstance =
        null;

    function getAdminOperationsService(
        options
    ) {
        if (
            options
        ) {
            return createAdminOperationsService(
                options
            );
        }

        if (
            !defaultInstance
        ) {
            defaultInstance =
                createAdminOperationsService();
        }

        return defaultInstance;
    }

    function resetAdminOperationsService() {
        if (
            defaultInstance &&
            typeof defaultInstance
                .dispose ===
                "function"
        ) {
            defaultInstance.dispose();
        }

        defaultInstance =
            null;
    }

    /* ======================================================
       EXPORT
    ====================================================== */

    const api =
        Object.freeze({
            createAdminOperationsService,
            getAdminOperationsService,
            resetAdminOperationsService,

            AdminOperationsError,

            normalizeAdminOperationsOptions,
            normalizeOperationName,
            normalizeObject,
            normalizeQuery,
            normalizeRequiredId,
            normalizeOptionalString,
            normalizeResolution,
            normalizeBackup,
            normalizePositiveInteger,
            normalizeList,
            normalizeAdminOperationsError,
            serializeAdminOperationsError,
            cloneValue,

            constants:
                Object.freeze({
                    OPERATION_STATES,
                    DEFAULT_QUERY_LIMIT
                })
        });

    global.LEternelAdminOperations =
        api;

    if (
        typeof module !==
            "undefined" &&
        module.exports
    ) {
        module.exports =
            api;
    }
})(
    typeof window !==
        "undefined"
        ? window
        : globalThis
);