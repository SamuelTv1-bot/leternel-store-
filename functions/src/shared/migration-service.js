"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   MIGRATION SERVICE

   Responsibilities:
   - Run versioned Firestore data migrations
   - Register and validate migration definitions
   - Prevent concurrent or duplicate migration execution
   - Track migration runs and per-step outcomes
   - Support dry-run, rollback, disabled, and resume modes
   - Query, inspect, cancel, and retry migration runs
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

const MIGRATION_COLLECTION =
    "_migrationRuns";

const MIGRATION_STATE_COLLECTION =
    "_migrationState";

const DEFAULT_STATUS =
    "pending";

const DEFAULT_DIRECTION =
    "up";

const DEFAULT_BATCH_SIZE =
    100;

const MAX_BATCH_SIZE =
    500;

const DEFAULT_QUERY_LIMIT =
    100;

const MAX_QUERY_LIMIT =
    500;

const DEFAULT_MAX_MIGRATIONS =
    500;

const DEFAULT_MAX_RESULT_BYTES =
    500000;

const DEFAULT_RETENTION_MS =
    180 * 24 * 60 * 60 * 1000;

const DEFAULT_LOCK_LEASE_MS =
    15 * 60 * 1000;

const DEFAULT_LOCK_KEY =
    "global";

const MIGRATION_STATUSES =
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

        cancelled:
            "cancelled",

        skipped:
            "skipped",

        disabled:
            "disabled"
    });

const MIGRATION_STEP_STATUSES =
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

        rolledBack:
            "rolled-back"
    });

const MIGRATION_DIRECTIONS =
    Object.freeze({
        up:
            "up",

        down:
            "down"
    });

const TERMINAL_MIGRATION_STATUSES =
    Object.freeze([
        MIGRATION_STATUSES.completed,
        MIGRATION_STATUSES.partial,
        MIGRATION_STATUSES.failed,
        MIGRATION_STATUSES.cancelled,
        MIGRATION_STATUSES.skipped,
        MIGRATION_STATUSES.disabled
    ]);

/* ==========================================================
   SERVICE FACTORY
========================================================== */

function createMigrationService(
    options
) {
    const settings =
        normalizeMigrationOptions(
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
                input,
                overrides
            ) {
                return runMigrations(
                    runtime,
                    input,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        plan:
            function (
                input,
                overrides
            ) {
                return createMigrationPlan(
                    input,
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
                return getMigrationRun(
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
                return queryMigrationRuns(
                    runtime,
                    filters,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        state:
            function (
                migrationId,
                overrides
            ) {
                return getMigrationState(
                    runtime,
                    migrationId,
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
                return cancelMigrationRun(
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
   RUN MIGRATIONS
========================================================== */

async function runMigrations(
    runtime,
    input,
    options
) {
    const settings =
        normalizeMigrationOptions(
            options
        );

    const source =
        normalizeMigrationRunInput(
            input,
            settings
        );

    const startedAt =
        resolveNow(
            runtime,
            settings
        );

    const runId =
        source.runId ||
        settings.runId ||
        createMigrationRunId(
            startedAt
        );

    const plan =
        createMigrationPlan(
            source,
            settings
        );

    if (
        settings.disabled
    ) {
        return createMigrationResult({
            id:
                runId,

            status:
                MIGRATION_STATUSES
                    .disabled,

            direction:
                source.direction,

            disabled:
                true,

            dryRun:
                settings.dryRun,

            migrationCount:
                plan.migrations.length,

            migrations:
                plan.migrations.map(
                    function (
                        migration
                    ) {
                        return createMigrationStepResult({
                            id:
                                migration.id,

                            version:
                                migration.version,

                            name:
                                migration.name,

                            status:
                                MIGRATION_STEP_STATUSES
                                    .skipped,

                            skipped:
                                true,

                            reason:
                                "Migrations are disabled."
                        });
                    }
                ),

            startedAt:
                startedAt,

            completedAt:
                startedAt
        });
    }

    assertMigrationRuntime(
        runtime
    );

    const lock =
        await acquireMigrationLock(
            runtime,
            runId,
            settings
        );

    if (
        !lock.acquired
    ) {
        const skipped =
            createMigrationResult({
                id:
                    runId,

                status:
                    MIGRATION_STATUSES
                        .skipped,

                direction:
                    source.direction,

                skipped:
                    true,

                reason:
                    "Another migration run is active.",

                migrationCount:
                    plan.migrations.length,

                migrations:
                    [],

                startedAt:
                    startedAt,

                completedAt:
                    resolveNow(
                        runtime,
                        settings
                    )
            });

        if (
            settings.persistRuns
        ) {
            await persistMigrationRun(
                runtime,
                skipped,
                settings
            );
        }

        logMigrationEvent(
            runtime,
            skipped,
            "skipped",
            settings
        );

        return skipped;
    }

    const initial =
        createMigrationResult({
            id:
                runId,

            status:
                MIGRATION_STATUSES
                    .running,

            direction:
                source.direction,

            disabled:
                false,

            dryRun:
                settings.dryRun,

            migrationCount:
                plan.migrations.length,

            migrations:
                plan.migrations.map(
                    function (
                        migration
                    ) {
                        return createMigrationStepResult({
                            id:
                                migration.id,

                            version:
                                migration.version,

                            name:
                                migration.name,

                            status:
                                MIGRATION_STEP_STATUSES
                                    .pending
                        });
                    }
                ),

            startedAt:
                startedAt,

            completedAt:
                null
        });

    if (
        settings.persistRuns
    ) {
        await persistMigrationRun(
            runtime,
            initial,
            settings
        );
    }

    const results =
        [];

    let completedCount =
        0;

    let failedCount =
        0;

    let skippedCount =
        0;

    try {
        for (
            const migration of
            plan.migrations
        ) {
            try {
                const result =
                    await executeMigration(
                        runtime,
                        migration,
                        {
                            runId:
                                runId,

                            direction:
                                source.direction,

                            dryRun:
                                settings.dryRun,

                            metadata:
                                source.metadata
                        },
                        settings
                    );

                results.push(
                    result
                );

                if (
                    result.status ===
                    MIGRATION_STEP_STATUSES
                        .completed ||
                    result.status ===
                    MIGRATION_STEP_STATUSES
                        .rolledBack
                ) {
                    completedCount +=
                        1;
                } else if (
                    result.status ===
                    MIGRATION_STEP_STATUSES
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
                    createMigrationStepResult({
                        id:
                            migration.id,

                        version:
                            migration.version,

                        name:
                            migration.name,

                        status:
                            MIGRATION_STEP_STATUSES
                                .failed,

                        error:
                            serializeMigrationError(
                                error
                            )
                    });

                results.push(
                    failure
                );

                failedCount +=
                    1;

                logMigrationStepFailure(
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
                await updateMigrationRunSteps(
                    runtime,
                    runId,
                    results,
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
                    ? MIGRATION_STATUSES
                          .partial
                    : MIGRATION_STATUSES
                          .failed
                : MIGRATION_STATUSES
                      .completed;

        const result =
            createMigrationResult({
                id:
                    runId,

                status:
                    status,

                direction:
                    source.direction,

                disabled:
                    false,

                dryRun:
                    settings.dryRun,

                migrationCount:
                    plan.migrations.length,

                completedCount:
                    completedCount,

                failedCount:
                    failedCount,

                skippedCount:
                    skippedCount,

                migrations:
                    results,

                startedAt:
                    startedAt,

                completedAt:
                    completedAt
            });

        if (
            settings.persistRuns
        ) {
            await persistMigrationRun(
                runtime,
                result,
                settings
            );
        }

        logMigrationEvent(
            runtime,
            result,
            "completed",
            settings
        );

        return result;
    } finally {
        try {
            await releaseMigrationLock(
                runtime,
                lock,
                settings
            );
        } catch (error) {
            logMigrationLockFailure(
                runtime,
                runId,
                error,
                settings
            );
        }
    }
}

/* ==========================================================
   PLAN
========================================================== */

function createMigrationPlan(
    input,
    options
) {
    const settings =
        normalizeMigrationOptions(
            options
        );

    const source =
        normalizeMigrationRunInput(
            input,
            settings
        );

    const migrations =
        source.migrations
            .slice()
            .sort(
                compareMigrations
            );

    const selected =
        migrations.filter(
            function (
                migration
            ) {
                if (
                    source.fromVersion !==
                    null
                ) {
                    if (
                        source.direction ===
                        MIGRATION_DIRECTIONS.up &&
                        migration.version <=
                            source.fromVersion
                    ) {
                        return false;
                    }

                    if (
                        source.direction ===
                        MIGRATION_DIRECTIONS.down &&
                        migration.version >
                            source.fromVersion
                    ) {
                        return false;
                    }
                }

                if (
                    source.toVersion !==
                    null
                ) {
                    if (
                        source.direction ===
                        MIGRATION_DIRECTIONS.up &&
                        migration.version >
                            source.toVersion
                    ) {
                        return false;
                    }

                    if (
                        source.direction ===
                        MIGRATION_DIRECTIONS.down &&
                        migration.version <=
                            source.toVersion
                    ) {
                        return false;
                    }
                }

                return true;
            }
        );

    if (
        source.direction ===
        MIGRATION_DIRECTIONS.down
    ) {
        selected.reverse();
    }

    return {
        direction:
            source.direction,

        fromVersion:
            source.fromVersion,

        toVersion:
            source.toVersion,

        migrationCount:
            selected.length,

        migrations:
            selected
    };
}

function compareMigrations(
    first,
    second
) {
    if (
        first.version !==
        second.version
    ) {
        return (
            first.version -
            second.version
        );
    }

    return first.id.localeCompare(
        second.id
    );
}

/* ==========================================================
   EXECUTE MIGRATION
========================================================== */

async function executeMigration(
    runtime,
    migration,
    context,
    options
) {
    const settings =
        normalizeMigrationOptions(
            options
        );

    const normalizedMigration =
        normalizeMigrationDefinition(
            migration
        );

    const direction =
        normalizeMigrationDirection(
            context &&
            context.direction
        );

    const startedAt =
        resolveNow(
            runtime,
            settings
        );

    const currentState =
        await getMigrationState(
            runtime,
            normalizedMigration.id,
            settings
        );

    if (
        shouldSkipMigration(
            normalizedMigration,
            currentState,
            direction,
            settings
        )
    ) {
        return createMigrationStepResult({
            id:
                normalizedMigration.id,

            version:
                normalizedMigration.version,

            name:
                normalizedMigration.name,

            status:
                MIGRATION_STEP_STATUSES
                    .skipped,

            skipped:
                true,

            reason:
                direction ===
                MIGRATION_DIRECTIONS.up
                    ? "Migration is already applied."
                    : "Migration is not currently applied.",

            startedAt:
                startedAt,

            completedAt:
                startedAt
        });
    }

    const handler =
        direction ===
        MIGRATION_DIRECTIONS.up
            ? normalizedMigration.up
            : normalizedMigration.down;

    if (
        typeof handler !==
        "function"
    ) {
        throw new ServiceError(
            "failed-precondition",
            "The migration does not support the requested direction.",
            {
                status:
                    409,

                expose:
                    true,

                details: {
                    migrationId:
                        normalizedMigration.id,

                    direction:
                        direction
                }
            }
        );
    }

    logMigrationStepEvent(
        runtime,
        normalizedMigration,
        "started",
        settings
    );

    try {
        const result =
            settings.dryRun
                ? {
                      dryRun:
                          true
                  }
                : await handler({
                      runtime:
                          runtime,

                      db:
                          runtime.db,

                      batchSize:
                          settings.batchSize,

                      runId:
                          context &&
                          context.runId,

                      migration:
                          normalizedMigration,

                      metadata:
                          context &&
                          context.metadata,

                      now:
                          function () {
                              return resolveNow(
                                  runtime,
                                  settings
                              );
                          }
                  });

        assertSerializableMigrationValue(
            result,
            settings.maxResultBytes,
            "Migration result"
        );

        const completedAt =
            resolveNow(
                runtime,
                settings
            );

        if (
            !settings.dryRun
        ) {
            await persistMigrationState(
                runtime,
                normalizedMigration,
                direction,
                result,
                settings
            );
        }

        const step =
            createMigrationStepResult({
                id:
                    normalizedMigration.id,

                version:
                    normalizedMigration.version,

                name:
                    normalizedMigration.name,

                status:
                    direction ===
                    MIGRATION_DIRECTIONS.down
                        ? MIGRATION_STEP_STATUSES
                              .rolledBack
                        : MIGRATION_STEP_STATUSES
                              .completed,

                result:
                    result,

                startedAt:
                    startedAt,

                completedAt:
                    completedAt
            });

        logMigrationStepEvent(
            runtime,
            step,
            "completed",
            settings
        );

        return step;
    } catch (error) {
        const failure =
            createMigrationStepResult({
                id:
                    normalizedMigration.id,

                version:
                    normalizedMigration.version,

                name:
                    normalizedMigration.name,

                status:
                    MIGRATION_STEP_STATUSES
                        .failed,

                error:
                    serializeMigrationError(
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

        logMigrationStepFailure(
            runtime,
            failure,
            settings
        );

        if (
            settings.returnStepFailures
        ) {
            return failure;
        }

        throw error;
    }
}

function shouldSkipMigration(
    migration,
    state,
    direction,
    options
) {
    const settings =
        options || {};

    if (
        settings.force
    ) {
        return false;
    }

    if (
        direction ===
        MIGRATION_DIRECTIONS.up
    ) {
        return Boolean(
            state &&
            state.applied
        );
    }

    return !(
        state &&
        state.applied
    );
}

/* ==========================================================
   STATE
========================================================== */

async function getMigrationState(
    runtime,
    migrationId,
    options
) {
    const settings =
        normalizeMigrationOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return null;
    }

    assertMigrationRuntime(
        runtime
    );

    const id =
        normalizeMigrationId(
            migrationId
        );

    const snapshot =
        await runtime.db
            .collection(
                settings.stateCollection
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

    return sanitizeMigrationState(
        snapshot.data()
    );
}

async function persistMigrationState(
    runtime,
    migration,
    direction,
    result,
    options
) {
    const settings =
        normalizeMigrationOptions(
            options
        );

    const now =
        resolveNow(
            runtime,
            settings
        );

    const reference =
        runtime.db
            .collection(
                settings.stateCollection
            )
            .doc(
                migration.id
            );

    const applied =
        direction ===
        MIGRATION_DIRECTIONS.up;

    const record = {
        id:
            migration.id,

        version:
            migration.version,

        name:
            migration.name,

        applied:
            applied,

        direction:
            direction,

        result:
            cloneValue(
                result
            ),

        appliedAt:
            applied
                ? createDatabaseTimestamp(
                      runtime,
                      now
                  )
                : null,

        rolledBackAt:
            applied
                ? null
                : createDatabaseTimestamp(
                      runtime,
                      now
                  ),

        updatedAt:
            createDatabaseTimestamp(
                runtime,
                now
            ),

        schemaVersion:
            1
    };

    await reference.set(
        record,
        {
            merge:
                true
        }
    );

    return sanitizeMigrationState(
        record
    );
}

function sanitizeMigrationState(
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

        version:
            normalizeMigrationVersion(
                record.version
            ),

        name:
            normalizeMigrationName(
                record.name
            ),

        applied:
            Boolean(
                record.applied
            ),

        direction:
            normalizeMigrationDirection(
                record.direction
            ),

        result:
            cloneValue(
                record.result
            ),

        appliedAt:
            serializeTimestamp(
                record.appliedAt
            ),

        rolledBackAt:
            serializeTimestamp(
                record.rolledBackAt
            ),

        updatedAt:
            serializeTimestamp(
                record.updatedAt
            ),

        schemaVersion:
            Number(
                record.schemaVersion ||
                1
            )
    };
}

/* ==========================================================
   LOCKING
========================================================== */

async function acquireMigrationLock(
    runtime,
    runId,
    options
) {
    const settings =
        normalizeMigrationOptions(
            options
        );

    const reference =
        runtime.db
            .collection(
                settings.stateCollection
            )
            .doc(
                "_lock_" +
                settings.lockKey
            );

    const now =
        resolveNow(
            runtime,
            settings
        );

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

                const expiresAt =
                    existing
                        ? toMilliseconds(
                              existing.expiresAt
                          )
                        : 0;

                if (
                    existing &&
                    existing.ownerId &&
                    expiresAt >
                        now
                ) {
                    return {
                        acquired:
                            false,

                        ownerId:
                            existing.ownerId,

                        token:
                            null
                    };
                }

                const token =
                    createMigrationLockToken();

                transaction.set(
                    reference,
                    {
                        ownerId:
                            runId,

                        token:
                            token,

                        acquiredAt:
                            createDatabaseTimestamp(
                                runtime,
                                now
                            ),

                        expiresAt:
                            createDatabaseTimestamp(
                                runtime,
                                now +
                                settings.lockLeaseMs
                            ),

                        updatedAt:
                            createDatabaseTimestamp(
                                runtime,
                                now
                            )
                    },
                    {
                        merge:
                            false
                    }
                );

                return {
                    acquired:
                        true,

                    ownerId:
                        runId,

                    token:
                        token,

                    reference:
                        reference
                };
            }
        );
}

async function releaseMigrationLock(
    runtime,
    lock,
    options
) {
    const settings =
        normalizeMigrationOptions(
            options
        );

    if (
        !lock ||
        !lock.acquired
    ) {
        return {
            released:
                false
        };
    }

    const reference =
        lock.reference ||
        runtime.db
            .collection(
                settings.stateCollection
            )
            .doc(
                "_lock_" +
                settings.lockKey
            );

    return runtime.db
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
                    return {
                        released:
                            false
                    };
                }

                const existing =
                    snapshot.data();

                if (
                    existing.token !==
                    lock.token
                ) {
                    return {
                        released:
                            false
                    };
                }

                if (
                    typeof transaction.delete ===
                    "function"
                ) {
                    transaction.delete(
                        reference
                    );
                } else {
                    transaction.set(
                        reference,
                        {
                            ownerId:
                                null,

                            token:
                                null,

                            expiresAt:
                                null,

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

                return {
                    released:
                        true
                };
            }
        );
}

function createMigrationLockToken() {
    if (
        typeof crypto.randomUUID ===
        "function"
    ) {
        return crypto.randomUUID();
    }

    return crypto
        .randomBytes(
            24
        )
        .toString(
            "hex"
        );
}

/* ==========================================================
   PERSIST RUNS
========================================================== */

async function persistMigrationRun(
    runtime,
    result,
    options
) {
    const settings =
        normalizeMigrationOptions(
            options
        );

    if (
        !settings.persistRuns
    ) {
        return result;
    }

    const record =
        createMigrationRunRecord(
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

async function updateMigrationRunSteps(
    runtime,
    runId,
    migrations,
    options
) {
    const settings =
        normalizeMigrationOptions(
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
            normalizeMigrationRunId(
                runId
            )
        )
        .set(
            {
                migrations:
                    cloneValue(
                        migrations
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

/* ==========================================================
   GET AND QUERY RUNS
========================================================== */

async function getMigrationRun(
    runtime,
    runId,
    options
) {
    const settings =
        normalizeMigrationOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return null;
    }

    assertMigrationRuntime(
        runtime
    );

    const id =
        normalizeMigrationRunId(
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

    return sanitizeMigrationRunRecord(
        snapshot.data()
    );
}

async function queryMigrationRuns(
    runtime,
    filters,
    options
) {
    const settings =
        normalizeMigrationOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return [];
    }

    assertMigrationRuntime(
        runtime
    );

    const normalized =
        normalizeMigrationQuery(
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
        normalized.direction
    ) {
        query =
            query.where(
                "direction",
                "==",
                normalized.direction
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
                normalized.directionOrder
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
            return sanitizeMigrationRunRecord(
                document.data()
            );
        }
    );
}

function normalizeMigrationQuery(
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
                ? normalizeMigrationStatus(
                      source.status
                  )
                : null,

        direction:
            source.direction
                ? normalizeMigrationDirection(
                      source.direction
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
                ? normalizeMigrationDate(
                      source.startedAfter,
                      "Migration start filter"
                  )
                : null,

        startedBefore:
            source.startedBefore !==
            undefined
                ? normalizeMigrationDate(
                      source.startedBefore,
                      "Migration start filter"
                  )
                : null,

        orderBy:
            normalizeMigrationOrderField(
                source.orderBy
            ),

        directionOrder:
            String(
                source.directionOrder ||
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

async function cancelMigrationRun(
    runtime,
    runId,
    reason,
    options
) {
    const settings =
        normalizeMigrationOptions(
            options
        );

    const id =
        normalizeMigrationRunId(
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

    assertMigrationRuntime(
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
                        throw createMigrationRunNotFoundError(
                            id
                        );
                    }

                    const existing =
                        snapshot.data();

                    if (
                        TERMINAL_MIGRATION_STATUSES
                            .includes(
                                normalizeMigrationStatus(
                                    existing.status
                                )
                            )
                    ) {
                        throw new ServiceError(
                            "failed-precondition",
                            "A terminal migration run cannot be cancelled.",
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
                            MIGRATION_STATUSES
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
        sanitizeMigrationRunRecord(
            record
        );

    logMigrationEvent(
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

        migration:
            result
    };
}

/* ==========================================================
   RESULT BUILDERS
========================================================== */

function createMigrationResult(
    values
) {
    const source =
        values || {};

    const migrations =
        Array.isArray(
            source.migrations
        )
            ? source.migrations.map(
                  createMigrationStepResult
              )
            : [];

    const startedAt =
        toMilliseconds(
            source.startedAt
        );

    const completedAt =
        toMilliseconds(
            source.completedAt
        );

    return {
        id:
            normalizeMigrationRunId(
                source.id
            ),

        status:
            normalizeMigrationStatus(
                source.status
            ),

        direction:
            normalizeMigrationDirection(
                source.direction
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

        cancellationReason:
            normalizeOptionalString(
                source.cancellationReason
            ),

        migrationCount:
            normalizeNonNegativeInteger(
                source.migrationCount,
                migrations.length,
                "Migration count"
            ),

        completedCount:
            normalizeNonNegativeInteger(
                source.completedCount,
                migrations.filter(
                    function (
                        migration
                    ) {
                        return (
                            migration.status ===
                                MIGRATION_STEP_STATUSES
                                    .completed ||
                            migration.status ===
                                MIGRATION_STEP_STATUSES
                                    .rolledBack
                        );
                    }
                ).length,
                "Completed migration count"
            ),

        failedCount:
            normalizeNonNegativeInteger(
                source.failedCount,
                migrations.filter(
                    function (
                        migration
                    ) {
                        return (
                            migration.status ===
                            MIGRATION_STEP_STATUSES
                                .failed
                        );
                    }
                ).length,
                "Failed migration count"
            ),

        skippedCount:
            normalizeNonNegativeInteger(
                source.skippedCount,
                migrations.filter(
                    function (
                        migration
                    ) {
                        return (
                            migration.status ===
                            MIGRATION_STEP_STATUSES
                                .skipped
                        );
                    }
                ).length,
                "Skipped migration count"
            ),

        migrations:
            migrations,

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

        cancelledAt:
            serializeTimestamp(
                source.cancelledAt
            ),

        durationMs:
            calculateDuration(
                startedAt,
                completedAt
            )
    };
}

function createMigrationStepResult(
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
        id:
            normalizeMigrationId(
                source.id
            ),

        version:
            normalizeMigrationVersion(
                source.version
            ),

        name:
            normalizeMigrationName(
                source.name
            ),

        status:
            normalizeMigrationStepStatus(
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

function createMigrationRunRecord(
    values,
    runtime,
    options
) {
    const result =
        createMigrationResult(
            values
        );

    const settings =
        options || {};

    const now =
        resolveNow(
            runtime,
            settings
        );

    return {
        id:
            result.id,

        status:
            result.status,

        direction:
            result.direction,

        disabled:
            result.disabled,

        dryRun:
            result.dryRun,

        skipped:
            result.skipped,

        reason:
            result.reason,

        cancellationReason:
            result.cancellationReason,

        migrationCount:
            result.migrationCount,

        completedCount:
            result.completedCount,

        failedCount:
            result.failedCount,

        skippedCount:
            result.skippedCount,

        migrations:
            cloneValue(
                result.migrations
            ),

        error:
            cloneValue(
                result.error
            ),

        startedAt:
            result.startedAt
                ? createDatabaseTimestamp(
                      runtime,
                      toMilliseconds(
                          result.startedAt
                      )
                  )
                : null,

        completedAt:
            result.completedAt
                ? createDatabaseTimestamp(
                      runtime,
                      toMilliseconds(
                          result.completedAt
                      )
                  )
                : null,

        cancelledAt:
            result.cancelledAt
                ? createDatabaseTimestamp(
                      runtime,
                      toMilliseconds(
                          result.cancelledAt
                      )
                  )
                : null,

        createdAt:
            createDatabaseTimestamp(
                runtime,
                result.startedAt
                    ? toMilliseconds(
                          result.startedAt
                      )
                    : now
            ),

        updatedAt:
            createDatabaseTimestamp(
                runtime,
                now
            ),

        expiresAt:
            settings.retentionMs
                ? createDatabaseTimestamp(
                      runtime,
                      (
                          result.completedAt
                              ? toMilliseconds(
                                    result.completedAt
                                )
                              : now
                      ) +
                      settings.retentionMs
                  )
                : null,

        schemaVersion:
            1
    };
}

/* ==========================================================
   SANITIZATION
========================================================== */

function sanitizeMigrationRunRecord(
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
            normalizeMigrationStatus(
                record.status
            ),

        direction:
            normalizeMigrationDirection(
                record.direction
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

        migrationCount:
            normalizeNonNegativeInteger(
                record.migrationCount,
                0,
                "Migration count"
            ),

        completedCount:
            normalizeNonNegativeInteger(
                record.completedCount,
                0,
                "Completed migration count"
            ),

        failedCount:
            normalizeNonNegativeInteger(
                record.failedCount,
                0,
                "Failed migration count"
            ),

        skippedCount:
            normalizeNonNegativeInteger(
                record.skippedCount,
                0,
                "Skipped migration count"
            ),

        migrations:
            Array.isArray(
                record.migrations
            )
                ? cloneValue(
                      record.migrations
                  )
                : [],

        error:
            cloneValue(
                record.error
            ),

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
   INPUT AND DEFINITIONS
========================================================== */

function normalizeMigrationRunInput(
    input,
    options
) {
    const source =
        input || {};

    const settings =
        normalizeMigrationOptions(
            options
        );

    if (
        typeof source !==
            "object" ||
        Array.isArray(
            source
        )
    ) {
        throw new TypeError(
            "Migration input must be an object."
        );
    }

    return {
        runId:
            source.runId
                ? normalizeMigrationRunId(
                      source.runId
                  )
                : null,

        direction:
            normalizeMigrationDirection(
                source.direction ||
                settings.direction
            ),

        fromVersion:
            source.fromVersion ===
                undefined ||
            source.fromVersion ===
                null
                ? null
                : normalizeMigrationVersion(
                      source.fromVersion
                  ),

        toVersion:
            source.toVersion ===
                undefined ||
            source.toVersion ===
                null
                ? null
                : normalizeMigrationVersion(
                      source.toVersion
                  ),

        migrations:
            normalizeMigrationDefinitions(
                source.migrations ||
                settings.migrations,
                settings.maxMigrations
            ),

        metadata:
            sanitizeMigrationMetadata(
                source.metadata
            )
    };
}

function normalizeMigrationDefinitions(
    migrations,
    maximumMigrations
) {
    if (
        !Array.isArray(
            migrations
        )
    ) {
        throw new TypeError(
            "Migration definitions must be an array."
        );
    }

    if (
        migrations.length >
        maximumMigrations
    ) {
        throw new ServiceError(
            "resource-exhausted",
            "Too many migrations were provided.",
            {
                status:
                    413,

                expose:
                    true
            }
        );
    }

    const normalized =
        migrations.map(
            normalizeMigrationDefinition
        );

    const ids =
        new Set();

    const versions =
        new Set();

    for (
        const migration of
        normalized
    ) {
        if (
            ids.has(
                migration.id
            )
        ) {
            throw new ServiceError(
                "already-exists",
                "A duplicate migration ID was provided.",
                {
                    status:
                        409,

                    expose:
                        true,

                    details: {
                        migrationId:
                            migration.id
                    }
                }
            );
        }

        if (
            versions.has(
                migration.version
            )
        ) {
            throw new ServiceError(
                "already-exists",
                "A duplicate migration version was provided.",
                {
                    status:
                        409,

                    expose:
                        true,

                    details: {
                        version:
                            migration.version
                    }
                }
            );
        }

        ids.add(
            migration.id
        );

        versions.add(
            migration.version
        );
    }

    return normalized;
}

function normalizeMigrationDefinition(
    migration
) {
    const source =
        migration || {};

    if (
        typeof source !==
            "object" ||
        Array.isArray(
            source
        )
    ) {
        throw new TypeError(
            "Migration definition must be an object."
        );
    }

    const up =
        source.up;

    const down =
        source.down;

    if (
        typeof up !==
            "function"
    ) {
        throw new TypeError(
            "Migration up handler must be a function."
        );
    }

    if (
        down !==
            undefined &&
        down !==
            null &&
        typeof down !==
            "function"
    ) {
        throw new TypeError(
            "Migration down handler must be a function."
        );
    }

    return {
        id:
            normalizeMigrationId(
                source.id
            ),

        version:
            normalizeMigrationVersion(
                source.version
            ),

        name:
            normalizeMigrationName(
                source.name ||
                source.id
            ),

        description:
            normalizeOptionalString(
                source.description
            ),

        up:
            up,

        down:
            down ||
            null,

        metadata:
            sanitizeMigrationMetadata(
                source.metadata
            )
    };
}

/* ==========================================================
   NORMALIZERS
========================================================== */

function normalizeMigrationRunId(
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
            "The migration run ID is invalid.",
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

function normalizeMigrationId(
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
            "The migration ID is invalid.",
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

function normalizeMigrationName(
    value
) {
    const normalized =
        String(
            value || ""
        ).trim();

    if (
        !normalized
    ) {
        throw new TypeError(
            "Migration name is required."
        );
    }

    return normalized;
}

function normalizeMigrationVersion(
    value
) {
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
            "Migration version must be a non-negative integer."
        );
    }

    return normalized;
}

function normalizeMigrationStatus(
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
            MIGRATION_STATUSES
        ).includes(
            normalized
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The migration status is invalid.",
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

function normalizeMigrationStepStatus(
    value
) {
    const normalized =
        String(
            value ||
            MIGRATION_STEP_STATUSES
                .pending
        )
            .trim()
            .toLowerCase();

    if (
        !Object.values(
            MIGRATION_STEP_STATUSES
        ).includes(
            normalized
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The migration step status is invalid.",
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

function normalizeMigrationDirection(
    value
) {
    const normalized =
        String(
            value ||
            DEFAULT_DIRECTION
        )
            .trim()
            .toLowerCase();

    if (
        !Object.values(
            MIGRATION_DIRECTIONS
        ).includes(
            normalized
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The migration direction is invalid.",
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

function normalizeMigrationDate(
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

function normalizeMigrationOrderField(
    value
) {
    const allowed =
        new Set([
            "startedAt",
            "completedAt",
            "createdAt",
            "updatedAt",
            "status",
            "direction",
            "migrationCount",
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
            "Migration query limit must be a positive integer."
        );
    }

    return Math.min(
        normalized,
        MAX_QUERY_LIMIT
    );
}

function normalizeBatchSize(
    value
) {
    const normalized =
        normalizePositiveInteger(
            value,
            DEFAULT_BATCH_SIZE,
            "Migration batch size"
        );

    return Math.min(
        normalized,
        MAX_BATCH_SIZE
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
    value,
    label
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
            (
                label ||
                "Migration collection"
            ) +
            " must be a Firestore collection name."
        );
    }

    return normalized;
}

function sanitizeMigrationMetadata(
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

/* ==========================================================
   OPTIONS
========================================================== */

function normalizeMigrationOptions(
    options
) {
    const settings =
        options || {};

    const maxMigrations =
        normalizePositiveInteger(
            settings.maxMigrations,
            DEFAULT_MAX_MIGRATIONS,
            "Maximum migrations"
        );

    return {
        runtime:
            settings.runtime,

        collection:
            normalizeCollection(
                settings.collection ||
                MIGRATION_COLLECTION,
                "Migration run collection"
            ),

        stateCollection:
            normalizeCollection(
                settings.stateCollection ||
                MIGRATION_STATE_COLLECTION,
                "Migration state collection"
            ),

        migrations:
            settings.migrations
                ? normalizeMigrationDefinitions(
                      settings.migrations,
                      maxMigrations
                  )
                : [],

        maxMigrations:
            maxMigrations,

        direction:
            normalizeMigrationDirection(
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

        maxResultBytes:
            normalizePositiveInteger(
                settings.maxResultBytes,
                DEFAULT_MAX_RESULT_BYTES,
                "Maximum migration result size"
            ),

        retentionMs:
            normalizeNonNegativeInteger(
                settings.retentionMs,
                DEFAULT_RETENTION_MS,
                "Migration retention"
            ),

        lockLeaseMs:
            normalizePositiveInteger(
                settings.lockLeaseMs,
                DEFAULT_LOCK_LEASE_MS,
                "Migration lock lease"
            ),

        lockKey:
            normalizeMigrationId(
                settings.lockKey ||
                DEFAULT_LOCK_KEY
            ),

        runId:
            settings.runId
                ? normalizeMigrationRunId(
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

        force:
            Boolean(
                settings.force
            ),

        stopOnError:
            Boolean(
                settings.stopOnError
            ),

        returnStepFailures:
            settings.returnStepFailures !==
            false,

        persistRuns:
            settings.persistRuns !==
            false,

        log:
            settings.log !==
            false,

        now:
            settings.now
    };
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
            "Migration data contains a circular reference.",
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

function assertSerializableMigrationValue(
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
   ERRORS
========================================================== */

function serializeMigrationError(
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
            "migration-failed",

        message:
            error.publicMessage ||
            error.message ||
            "Migration failed.",

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

function createMigrationRunNotFoundError(
    runId
) {
    return new ServiceError(
        "not-found",
        "The migration run was not found.",
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
   IDS
========================================================== */

function createMigrationRunId(
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

function assertMigrationRuntime(
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
            "The migration datastore is unavailable.",
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
            "Firestore transactions are required for migrations.",
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

function logMigrationEvent(
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

        direction:
            result &&
            result.direction,

        migrationCount:
            result &&
            result.migrationCount,

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
            MIGRATION_STATUSES
                .failed &&
        typeof runtime.logger.error ===
            "function"
    ) {
        runtime.logger.error(
            "Migration run failed.",
            metadata
        );

        return;
    }

    if (
        result &&
        (
            result.status ===
                MIGRATION_STATUSES
                    .partial ||
            result.status ===
                MIGRATION_STATUSES
                    .skipped ||
            result.status ===
                MIGRATION_STATUSES
                    .cancelled
        ) &&
        typeof runtime.logger.warn ===
            "function"
    ) {
        runtime.logger.warn(
            "Migration run completed with warnings.",
            metadata
        );

        return;
    }

    if (
        typeof runtime.logger.info ===
        "function"
    ) {
        runtime.logger.info(
            "Migration event.",
            metadata
        );
    }
}

function logMigrationStepEvent(
    runtime,
    migration,
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
        "Migration step event.",
        {
            event:
                event,

            migrationId:
                migration &&
                migration.id,

            version:
                migration &&
                migration.version,

            status:
                migration &&
                migration.status,

            durationMs:
                migration &&
                migration.durationMs
        }
    );
}

function logMigrationStepFailure(
    runtime,
    migration,
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
        "Migration step failed.",
        {
            migrationId:
                migration &&
                migration.id,

            version:
                migration &&
                migration.version,

            error:
                migration &&
                migration.error
        }
    );
}

function logMigrationLockFailure(
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
        "Migration lock release failed.",
        {
            runId:
                runId,

            error:
                serializeMigrationError(
                    error
                )
        }
    );
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    createMigrationService,
    runMigrations,
    createMigrationPlan,
    compareMigrations,
    executeMigration,
    shouldSkipMigration,
    getMigrationState,
    persistMigrationState,
    sanitizeMigrationState,
    acquireMigrationLock,
    releaseMigrationLock,
    createMigrationLockToken,
    persistMigrationRun,
    updateMigrationRunSteps,
    getMigrationRun,
    queryMigrationRuns,
    normalizeMigrationQuery,
    cancelMigrationRun,
    createMigrationResult,
    createMigrationStepResult,
    createMigrationRunRecord,
    sanitizeMigrationRunRecord,
    normalizeMigrationRunInput,
    normalizeMigrationDefinitions,
    normalizeMigrationDefinition,
    normalizeMigrationRunId,
    normalizeMigrationId,
    normalizeMigrationName,
    normalizeMigrationVersion,
    normalizeMigrationStatus,
    normalizeMigrationStepStatus,
    normalizeMigrationDirection,
    normalizeMigrationDate,
    normalizeMigrationOrderField,
    normalizeQueryLimit,
    normalizeBatchSize,
    normalizePositiveInteger,
    normalizeNonNegativeInteger,
    normalizeOptionalString,
    normalizeCollection,
    sanitizeMigrationMetadata,
    normalizeMigrationOptions,
    stableStringify,
    normalizeStableValue,
    assertSerializableMigrationValue,
    serializeMigrationError,
    createMigrationRunNotFoundError,
    createMigrationRunId,
    assertMigrationRuntime,
    resolveNow,
    createDatabaseTimestamp,
    toMilliseconds,
    serializeTimestamp,
    calculateDuration,
    logMigrationEvent,
    logMigrationStepEvent,
    logMigrationStepFailure,
    logMigrationLockFailure,
    constants: {
        MIGRATION_COLLECTION,
        MIGRATION_STATE_COLLECTION,
        DEFAULT_STATUS,
        DEFAULT_DIRECTION,
        DEFAULT_BATCH_SIZE,
        MAX_BATCH_SIZE,
        DEFAULT_QUERY_LIMIT,
        MAX_QUERY_LIMIT,
        DEFAULT_MAX_MIGRATIONS,
        DEFAULT_MAX_RESULT_BYTES,
        DEFAULT_RETENTION_MS,
        DEFAULT_LOCK_LEASE_MS,
        DEFAULT_LOCK_KEY,
        MIGRATION_STATUSES,
        MIGRATION_STEP_STATUSES,
        MIGRATION_DIRECTIONS,
        TERMINAL_MIGRATION_STATUSES
    }
};