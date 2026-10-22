"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   MIGRATION SERVICE TEST SUITE
========================================================== */

const test =
    require("node:test");

const assert =
    require("node:assert/strict");

const {
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
    constants
} = require(
    "../src/shared/migration-service"
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
   HELPERS
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
                "Unsupported operator: " +
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
                                            field,
                                            operator,
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
                                field,
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

                const deletes =
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
                                reference,
                                value:
                                    clone(
                                        value
                                    ),
                                options
                            });
                        },

                    delete:
                        function (
                            reference
                        ) {
                            deletes.push(
                                reference
                            );
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

                for (
                    const reference of
                    deletes
                ) {
                    await reference.delete();
                }

                return result;
            }
    };

    return {
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
   LOGGER AND RUNTIME
========================================================== */

function createLoggerStub() {
    const entries =
        [];

    return {
        entries,

        info:
            function (
                message,
                metadata
            ) {
                entries.push({
                    level:
                        "info",
                    message,
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
                    message,
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
                    message,
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

function migrationRunPath(
    id
) {
    return (
        constants
            .MIGRATION_COLLECTION +
        "/" +
        id
    );
}

function migrationStatePath(
    id
) {
    return (
        constants
            .MIGRATION_STATE_COLLECTION +
        "/" +
        id
    );
}

function createMigrationDefinition(
    overrides
) {
    return Object.assign(
        {
            id:
                "001-create-products",

            version:
                1,

            name:
                "Create products",

            description:
                "Creates product records.",

            up:
                async function () {
                    return {
                        created:
                            10
                    };
                },

            down:
                async function () {
                    return {
                        deleted:
                            10
                    };
                }
        },
        overrides || {}
    );
}

function createStoredMigrationRun(
    overrides
) {
    return Object.assign(
        {
            id:
                "run-1",

            status:
                "completed",

            direction:
                "up",

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

            migrationCount:
                1,

            completedCount:
                1,

            failedCount:
                0,

            skippedCount:
                0,

            migrations:
                [],

            error:
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

function createStoredMigrationState(
    overrides
) {
    return Object.assign(
        {
            id:
                "001-create-products",

            version:
                1,

            name:
                "Create products",

            applied:
                true,

            direction:
                "up",

            result: {
                created:
                    10
            },

            appliedAt:
                TestTimestamp
                    .fromMillis(
                        1000
                    ),

            rolledBackAt:
                null,

            updatedAt:
                TestTimestamp
                    .fromMillis(
                        1000
                    ),

            schemaVersion:
                1
        },
        overrides || {}
    );
}

/* ==========================================================
   FACTORY
========================================================== */

test(
    "createMigrationService creates frozen service",
    function () {
        const runtime =
            createRuntime();

        const migration =
            createMigrationDefinition();

        const service =
            createMigrationService({
                runtime,
                migrations: [
                    migration
                ]
            });

        assert.equal(
            service.runtime,
            runtime
        );

        assert.equal(
            service.options
                .migrations
                .length,
            1
        );

        assert.equal(
            typeof service.run,
            "function"
        );

        assert.equal(
            typeof service.plan,
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
            typeof service.state,
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
    "normalizeMigrationOptions applies defaults",
    function () {
        const options =
            normalizeMigrationOptions(
                {}
            );

        assert.equal(
            options.collection,
            "_migrationRuns"
        );

        assert.equal(
            options.stateCollection,
            "_migrationState"
        );

        assert.equal(
            options.direction,
            "up"
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
            options.maxMigrations,
            500
        );

        assert.equal(
            options.maxResultBytes,
            500000
        );

        assert.equal(
            options.retentionMs,
            15552000000
        );

        assert.equal(
            options.lockLeaseMs,
            900000
        );

        assert.equal(
            options.lockKey,
            "global"
        );

        assert.equal(
            options.returnStepFailures,
            true
        );

        assert.equal(
            options.persistRuns,
            true
        );
    }
);

test(
    "normalizeMigrationOptions respects overrides",
    function () {
        const migration =
            createMigrationDefinition();

        const options =
            normalizeMigrationOptions({
                collection:
                    "migrationRuns",

                stateCollection:
                    "migrationState",

                migrations: [
                    migration
                ],

                direction:
                    "down",

                batchSize:
                    25,

                queryLimit:
                    20,

                maxMigrations:
                    10,

                maxResultBytes:
                    1000,

                retentionMs:
                    5000,

                lockLeaseMs:
                    2000,

                lockKey:
                    "deploy",

                runId:
                    "run-1",

                dryRun:
                    true,

                disabled:
                    true,

                force:
                    true,

                stopOnError:
                    true,

                returnStepFailures:
                    false,

                persistRuns:
                    false,

                log:
                    false
            });

        assert.equal(
            options.collection,
            "migrationRuns"
        );

        assert.equal(
            options.stateCollection,
            "migrationState"
        );

        assert.equal(
            options.direction,
            "down"
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
            options.lockKey,
            "deploy"
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
            options.force,
            true
        );

        assert.equal(
            options.stopOnError,
            true
        );

        assert.equal(
            options.returnStepFailures,
            false
        );

        assert.equal(
            options.persistRuns,
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
    "migration identifiers and statuses normalize",
    function () {
        assert.equal(
            normalizeMigrationRunId(
                " run-1 "
            ),
            "run-1"
        );

        assert.equal(
            normalizeMigrationId(
                " 001 Create Products "
            ),
            "001-create-products"
        );

        assert.equal(
            normalizeMigrationName(
                " Create products "
            ),
            "Create products"
        );

        assert.equal(
            normalizeMigrationVersion(
                1
            ),
            1
        );

        assert.equal(
            normalizeMigrationStatus(
                "COMPLETED"
            ),
            "completed"
        );

        assert.equal(
            normalizeMigrationStepStatus(
                "ROLLED-BACK"
            ),
            "rolled-back"
        );

        assert.equal(
            normalizeMigrationDirection(
                "DOWN"
            ),
            "down"
        );

        assert.throws(
            function () {
                normalizeMigrationRunId(
                    "runs/one"
                );
            },
            /run ID is invalid/
        );

        assert.throws(
            function () {
                normalizeMigrationId(
                    ""
                );
            },
            /migration ID is invalid/
        );

        assert.throws(
            function () {
                normalizeMigrationVersion(
                    -1
                );
            },
            /non-negative integer/
        );

        assert.throws(
            function () {
                normalizeMigrationStatus(
                    "unknown"
                );
            },
            /status is invalid/
        );
    }
);

test(
    "numeric and collection normalizers validate",
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
                5,
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
            normalizeCollection(
                "_migrationRuns",
                "Collection"
            ),
            "_migrationRuns"
        );

        assert.equal(
            normalizeOptionalString(
                " reason "
            ),
            "reason"
        );

        assert.throws(
            function () {
                normalizeCollection(
                    "internal/migrations",
                    "Collection"
                );
            },
            /Firestore collection name/
        );
    }
);

/* ==========================================================
   DEFINITIONS
========================================================== */

test(
    "normalizeMigrationDefinition validates migration",
    function () {
        const migration =
            normalizeMigrationDefinition(
                createMigrationDefinition()
            );

        assert.equal(
            migration.id,
            "001-create-products"
        );

        assert.equal(
            migration.version,
            1
        );

        assert.equal(
            migration.name,
            "Create products"
        );

        assert.equal(
            typeof migration.up,
            "function"
        );

        assert.equal(
            typeof migration.down,
            "function"
        );
    }
);

test(
    "normalizeMigrationDefinition requires up handler",
    function () {
        assert.throws(
            function () {
                normalizeMigrationDefinition({
                    id:
                        "001-test",

                    version:
                        1,

                    name:
                        "Test"
                });
            },
            /up handler must be a function/
        );
    }
);

test(
    "normalizeMigrationDefinitions rejects duplicates",
    function () {
        const first =
            createMigrationDefinition();

        const duplicateId =
            createMigrationDefinition({
                version:
                    2
            });

        assert.throws(
            function () {
                normalizeMigrationDefinitions(
                    [
                        first,
                        duplicateId
                    ],
                    10
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

        const duplicateVersion =
            createMigrationDefinition({
                id:
                    "002-other"
            });

        assert.throws(
            function () {
                normalizeMigrationDefinitions(
                    [
                        first,
                        duplicateVersion
                    ],
                    10
                );
            },
            /duplicate migration version/
        );
    }
);

/* ==========================================================
   PLAN
========================================================== */

test(
    "createMigrationPlan orders upward migrations",
    function () {
        const plan =
            createMigrationPlan(
                {
                    direction:
                        "up",

                    migrations: [
                        createMigrationDefinition({
                            id:
                                "003-third",
                            version:
                                3
                        }),
                        createMigrationDefinition({
                            id:
                                "001-first",
                            version:
                                1
                        }),
                        createMigrationDefinition({
                            id:
                                "002-second",
                            version:
                                2
                        })
                    ]
                },
                {}
            );

        assert.deepEqual(
            plan.migrations.map(
                function (
                    migration
                ) {
                    return migration.version;
                }
            ),
            [
                1,
                2,
                3
            ]
        );
    }
);

test(
    "createMigrationPlan reverses downward migrations",
    function () {
        const plan =
            createMigrationPlan(
                {
                    direction:
                        "down",

                    migrations: [
                        createMigrationDefinition({
                            id:
                                "001-first",
                            version:
                                1
                        }),
                        createMigrationDefinition({
                            id:
                                "002-second",
                            version:
                                2
                        }),
                        createMigrationDefinition({
                            id:
                                "003-third",
                            version:
                                3
                        })
                    ]
                },
                {}
            );

        assert.deepEqual(
            plan.migrations.map(
                function (
                    migration
                ) {
                    return migration.version;
                }
            ),
            [
                3,
                2,
                1
            ]
        );
    }
);

test(
    "createMigrationPlan applies version boundaries",
    function () {
        const plan =
            createMigrationPlan(
                {
                    direction:
                        "up",

                    fromVersion:
                        1,

                    toVersion:
                        2,

                    migrations: [
                        createMigrationDefinition({
                            id:
                                "001-first",
                            version:
                                1
                        }),
                        createMigrationDefinition({
                            id:
                                "002-second",
                            version:
                                2
                        }),
                        createMigrationDefinition({
                            id:
                                "003-third",
                            version:
                                3
                        })
                    ]
                },
                {}
            );

        assert.deepEqual(
            plan.migrations.map(
                function (
                    migration
                ) {
                    return migration.version;
                }
            ),
            [
                2
            ]
        );
    }
);

test(
    "compareMigrations orders version then ID",
    function () {
        const migrations = [
            {
                id:
                    "b",
                version:
                    1
            },
            {
                id:
                    "a",
                version:
                    1
            },
            {
                id:
                    "c",
                version:
                    2
            }
        ];

        migrations.sort(
            compareMigrations
        );

        assert.deepEqual(
            migrations.map(
                function (
                    migration
                ) {
                    return migration.id;
                }
            ),
            [
                "a",
                "b",
                "c"
            ]
        );
    }
);

/* ==========================================================
   STATE
========================================================== */

test(
    "getMigrationState returns stored state",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    migrationStatePath(
                        "001-create-products"
                    )
                ]:
                    createStoredMigrationState()
            });

        const state =
            await getMigrationState(
                createRuntime({
                    firestore
                }),
                "001-create-products"
            );

        assert.equal(
            state.id,
            "001-create-products"
        );

        assert.equal(
            state.applied,
            true
        );

        assert.equal(
            state.appliedAt,
            new Date(
                1000
            ).toISOString()
        );
    }
);

test(
    "getMigrationState returns null for missing or disabled state",
    async function () {
        assert.equal(
            await getMigrationState(
                createRuntime(),
                "missing"
            ),
            null
        );

        assert.equal(
            await getMigrationState(
                null,
                "001-create-products",
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
    "persistMigrationState stores applied migration",
    async function () {
        const firestore =
            createFirestoreStub();

        const state =
            await persistMigrationState(
                createRuntime({
                    firestore
                }),
                normalizeMigrationDefinition(
                    createMigrationDefinition()
                ),
                "up",
                {
                    created:
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
            state.applied,
            true
        );

        assert.equal(
            state.direction,
            "up"
        );

        assert.equal(
            firestore.hasDocument(
                migrationStatePath(
                    "001-create-products"
                )
            ),
            true
        );
    }
);

test(
    "persistMigrationState stores rollback",
    async function () {
        const firestore =
            createFirestoreStub();

        const state =
            await persistMigrationState(
                createRuntime({
                    firestore
                }),
                normalizeMigrationDefinition(
                    createMigrationDefinition()
                ),
                "down",
                {
                    deleted:
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
            state.applied,
            false
        );

        assert.equal(
            state.direction,
            "down"
        );

        assert.equal(
            state.rolledBackAt,
            new Date(
                2000
            ).toISOString()
        );
    }
);

/* ==========================================================
   SKIPPING
========================================================== */

test(
    "shouldSkipMigration follows state and direction",
    function () {
        const migration =
            createMigrationDefinition();

        assert.equal(
            shouldSkipMigration(
                migration,
                {
                    applied:
                        true
                },
                "up",
                {}
            ),
            true
        );

        assert.equal(
            shouldSkipMigration(
                migration,
                {
                    applied:
                        false
                },
                "up",
                {}
            ),
            false
        );

        assert.equal(
            shouldSkipMigration(
                migration,
                {
                    applied:
                        true
                },
                "down",
                {}
            ),
            false
        );

        assert.equal(
            shouldSkipMigration(
                migration,
                null,
                "down",
                {}
            ),
            true
        );

        assert.equal(
            shouldSkipMigration(
                migration,
                {
                    applied:
                        true
                },
                "up",
                {
                    force:
                        true
                }
            ),
            false
        );
    }
);

/* ==========================================================
   EXECUTION
========================================================== */

test(
    "executeMigration runs upward handler",
    async function () {
        const firestore =
            createFirestoreStub();

        let called =
            false;

        const result =
            await executeMigration(
                createRuntime({
                    firestore
                }),
                createMigrationDefinition({
                    up:
                        async function (
                            context
                        ) {
                            called =
                                true;

                            assert.equal(
                                context.batchSize,
                                100
                            );

                            return {
                                created:
                                    5
                            };
                        }
                }),
                {
                    runId:
                        "run-1",

                    direction:
                        "up"
                },
                {
                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            called,
            true
        );

        assert.equal(
            result.status,
            "completed"
        );

        assert.deepEqual(
            result.result,
            {
                created:
                    5
            }
        );
    }
);

test(
    "executeMigration runs downward handler",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    migrationStatePath(
                        "001-create-products"
                    )
                ]:
                    createStoredMigrationState()
            });

        const result =
            await executeMigration(
                createRuntime({
                    firestore
                }),
                createMigrationDefinition({
                    down:
                        async function () {
                            return {
                                deleted:
                                    5
                            };
                        }
                }),
                {
                    runId:
                        "run-1",

                    direction:
                        "down"
                },
                {
                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            result.status,
            "rolled-back"
        );

        assert.deepEqual(
            result.result,
            {
                deleted:
                    5
            }
        );
    }
);

test(
    "executeMigration skips already applied migration",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    migrationStatePath(
                        "001-create-products"
                    )
                ]:
                    createStoredMigrationState()
            });

        const result =
            await executeMigration(
                createRuntime({
                    firestore
                }),
                createMigrationDefinition(),
                {
                    direction:
                        "up"
                },
                {
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
    "executeMigration supports dry run",
    async function () {
        const firestore =
            createFirestoreStub();

        let called =
            false;

        const result =
            await executeMigration(
                createRuntime({
                    firestore
                }),
                createMigrationDefinition({
                    up:
                        async function () {
                            called =
                                true;

                            return {};
                        }
                }),
                {
                    direction:
                        "up"
                },
                {
                    dryRun:
                        true,

                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            called,
            false
        );

        assert.equal(
            result.status,
            "completed"
        );

        assert.deepEqual(
            result.result,
            {
                dryRun:
                    true
            }
        );
    }
);

test(
    "executeMigration returns failed step",
    async function () {
        const result =
            await executeMigration(
                createRuntime(),
                createMigrationDefinition({
                    up:
                        async function () {
                            throw new Error(
                                "Migration failed."
                            );
                        }
                }),
                {
                    direction:
                        "up"
                },
                {
                    returnStepFailures:
                        true
                }
            );

        assert.equal(
            result.status,
            "failed"
        );

        assert.equal(
            result.error.message,
            "Migration failed."
        );
    }
);

/* ==========================================================
   LOCKING
========================================================== */

test(
    "acquireMigrationLock acquires available lock",
    async function () {
        const firestore =
            createFirestoreStub();

        const lock =
            await acquireMigrationLock(
                createRuntime({
                    firestore
                }),
                "run-1",
                {
                    lockKey:
                        "global",

                    lockLeaseMs:
                        5000,

                    now:
                        function () {
                            return 1000;
                        }
                }
            );

        assert.equal(
            lock.acquired,
            true
        );

        assert.equal(
            lock.ownerId,
            "run-1"
        );

        assert.equal(
            typeof lock.token,
            "string"
        );
    }
);

test(
    "acquireMigrationLock rejects active lock",
    async function () {
        const firestore =
            createFirestoreStub({
                "_migrationState/_lock_global": {
                    ownerId:
                        "run-existing",

                    token:
                        "token",

                    expiresAt:
                        TestTimestamp
                            .fromMillis(
                                5000
                            )
                }
            });

        const lock =
            await acquireMigrationLock(
                createRuntime({
                    firestore
                }),
                "run-1",
                {
                    lockKey:
                        "global",

                    now:
                        function () {
                            return 1000;
                        }
                }
            );

        assert.equal(
            lock.acquired,
            false
        );

        assert.equal(
            lock.ownerId,
            "run-existing"
        );
    }
);

test(
    "releaseMigrationLock releases matching lock",
    async function () {
        const firestore =
            createFirestoreStub({
                "_migrationState/_lock_global": {
                    ownerId:
                        "run-1",

                    token:
                        "token-1"
                }
            });

        const result =
            await releaseMigrationLock(
                createRuntime({
                    firestore
                }),
                {
                    acquired:
                        true,

                    token:
                        "token-1"
                },
                {
                    lockKey:
                        "global"
                }
            );

        assert.equal(
            result.released,
            true
        );

        assert.equal(
            firestore.hasDocument(
                "_migrationState/_lock_global"
            ),
            false
        );
    }
);

test(
    "createMigrationLockToken creates unique tokens",
    function () {
        assert.notEqual(
            createMigrationLockToken(),
            createMigrationLockToken()
        );
    }
);

/* ==========================================================
   RUN MIGRATIONS
========================================================== */

test(
    "runMigrations executes migration plan",
    async function () {
        const firestore =
            createFirestoreStub();

        const result =
            await runMigrations(
                createRuntime({
                    firestore
                }),
                {
                    runId:
                        "run-1",

                    direction:
                        "up",

                    migrations: [
                        createMigrationDefinition({
                            id:
                                "001-first",

                            version:
                                1
                        }),

                        createMigrationDefinition({
                            id:
                                "002-second",

                            version:
                                2
                        })
                    ]
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
            result.migrationCount,
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
            firestore.hasDocument(
                migrationRunPath(
                    "run-1"
                )
            ),
            true
        );
    }
);

test(
    "runMigrations returns partial result",
    async function () {
        const firestore =
            createFirestoreStub();

        const result =
            await runMigrations(
                createRuntime({
                    firestore
                }),
                {
                    runId:
                        "run-1",

                    migrations: [
                        createMigrationDefinition({
                            id:
                                "001-first",

                            version:
                                1
                        }),

                        createMigrationDefinition({
                            id:
                                "002-second",

                            version:
                                2,

                            up:
                                async function () {
                                    throw new Error(
                                        "Failure."
                                    );
                                }
                        })
                    ]
                },
                {
                    returnStepFailures:
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
    "runMigrations returns disabled result",
    async function () {
        const result =
            await runMigrations(
                null,
                {
                    runId:
                        "run-1",

                    migrations: [
                        createMigrationDefinition()
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

        assert.equal(
            result.migrations[0]
                .status,
            "skipped"
        );
    }
);

test(
    "runMigrations skips when lock is active",
    async function () {
        const firestore =
            createFirestoreStub({
                "_migrationState/_lock_global": {
                    ownerId:
                        "existing-run",

                    token:
                        "token",

                    expiresAt:
                        TestTimestamp
                            .fromMillis(
                                10000
                            )
                }
            });

        const result =
            await runMigrations(
                createRuntime({
                    firestore
                }),
                {
                    runId:
                        "run-1",

                    migrations: [
                        createMigrationDefinition()
                    ]
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
            "skipped"
        );

        assert.equal(
            result.skipped,
            true
        );
    }
);

/* ==========================================================
   PERSISTENCE
========================================================== */

test(
    "persistMigrationRun stores run",
    async function () {
        const firestore =
            createFirestoreStub();

        const result =
            createMigrationResult({
                id:
                    "run-1",

                status:
                    "completed",

                direction:
                    "up",

                startedAt:
                    1000,

                completedAt:
                    2000,

                migrations:
                    []
            });

        await persistMigrationRun(
            createRuntime({
                firestore
            }),
            result,
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
            firestore.hasDocument(
                migrationRunPath(
                    "run-1"
                )
            ),
            true
        );
    }
);

test(
    "updateMigrationRunSteps updates migration list",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    migrationRunPath(
                        "run-1"
                    )
                ]:
                    createStoredMigrationRun()
            });

        await updateMigrationRunSteps(
            createRuntime({
                firestore
            }),
            "run-1",
            [
                createMigrationStepResult({
                    id:
                        "001-test",

                    version:
                        1,

                    name:
                        "Test",

                    status:
                        "completed"
                })
            ],
            {
                now:
                    function () {
                        return 3000;
                    }
            }
        );

        const stored =
            firestore.getDocument(
                migrationRunPath(
                    "run-1"
                )
            );

        assert.equal(
            stored.migrations.length,
            1
        );

        assert.equal(
            stored.updatedAt.toMillis(),
            3000
        );
    }
);

/* ==========================================================
   RESULTS
========================================================== */

test(
    "createMigrationStepResult creates step summary",
    function () {
        const result =
            createMigrationStepResult({
                id:
                    "001-test",

                version:
                    1,

                name:
                    "Test",

                status:
                    "completed",

                startedAt:
                    1000,

                completedAt:
                    3000
            });

        assert.equal(
            result.id,
            "001-test"
        );

        assert.equal(
            result.status,
            "completed"
        );

        assert.equal(
            result.durationMs,
            2000
        );
    }
);

test(
    "createMigrationResult calculates counts",
    function () {
        const result =
            createMigrationResult({
                id:
                    "run-1",

                status:
                    "partial",

                direction:
                    "up",

                migrations: [
                    {
                        id:
                            "001-first",

                        version:
                            1,

                        name:
                            "First",

                        status:
                            "completed"
                    },
                    {
                        id:
                            "002-second",

                        version:
                            2,

                        name:
                            "Second",

                        status:
                            "failed"
                    },
                    {
                        id:
                            "003-third",

                        version:
                            3,

                        name:
                            "Third",

                        status:
                            "skipped"
                    }
                ]
            });

        assert.equal(
            result.migrationCount,
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
    }
);

test(
    "createMigrationRunRecord creates Firestore record",
    function () {
        const record =
            createMigrationRunRecord(
                {
                    id:
                        "run-1",

                    status:
                        "completed",

                    direction:
                        "up",

                    startedAt:
                        1000,

                    completedAt:
                        2000,

                    migrations:
                        []
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

/* ==========================================================
   GET AND QUERY
========================================================== */

test(
    "getMigrationRun returns stored run",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    migrationRunPath(
                        "run-1"
                    )
                ]:
                    createStoredMigrationRun()
            });

        const result =
            await getMigrationRun(
                createRuntime({
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
    "getMigrationRun returns null for missing or disabled run",
    async function () {
        assert.equal(
            await getMigrationRun(
                createRuntime(),
                "missing"
            ),
            null
        );

        assert.equal(
            await getMigrationRun(
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
    "normalizeMigrationQuery normalizes filters",
    function () {
        assert.deepEqual(
            normalizeMigrationQuery(
                {
                    status:
                        "COMPLETED",

                    direction:
                        "UP",

                    dryRun:
                        false,

                    startedAfter:
                        1000,

                    startedBefore:
                        5000,

                    orderBy:
                        "failedCount",

                    directionOrder:
                        "ASC",

                    limit:
                        25
                },
                {}
            ),
            {
                status:
                    "completed",

                direction:
                    "up",

                dryRun:
                    false,

                startedAfter:
                    1000,

                startedBefore:
                    5000,

                orderBy:
                    "failedCount",

                directionOrder:
                    "asc",

                limit:
                    25
            }
        );
    }
);

test(
    "queryMigrationRuns filters runs",
    async function () {
        const firestore =
            createFirestoreStub({
                "_migrationRuns/one":
                    createStoredMigrationRun({
                        id:
                            "one",

                        status:
                            "completed",

                        direction:
                            "up",

                        dryRun:
                            false,

                        startedAt:
                            TestTimestamp
                                .fromMillis(
                                    1000
                                )
                    }),

                "_migrationRuns/two":
                    createStoredMigrationRun({
                        id:
                            "two",

                        status:
                            "completed",

                        direction:
                            "up",

                        dryRun:
                            false,

                        startedAt:
                            TestTimestamp
                                .fromMillis(
                                    2000
                                )
                    }),

                "_migrationRuns/three":
                    createStoredMigrationRun({
                        id:
                            "three",

                        status:
                            "failed",

                        direction:
                            "down",

                        dryRun:
                            true
                    })
            });

        const results =
            await queryMigrationRuns(
                createRuntime({
                    firestore
                }),
                {
                    status:
                        "completed",

                    direction:
                        "up",

                    dryRun:
                        false,

                    orderBy:
                        "startedAt",

                    directionOrder:
                        "asc"
                },
                {}
            );

        assert.deepEqual(
            results.map(
                function (
                    result
                ) {
                    return result.id;
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
    "cancelMigrationRun cancels active run",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    migrationRunPath(
                        "run-1"
                    )
                ]:
                    createStoredMigrationRun({
                        status:
                            "running",

                        completedAt:
                            null
                    })
            });

        const result =
            await cancelMigrationRun(
                createRuntime({
                    firestore
                }),
                "run-1",
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
            result.migration.status,
            "cancelled"
        );

        assert.equal(
            result.migration
                .cancellationReason,
            "Cancelled by administrator."
        );

        assert.equal(
            result.migration
                .cancelledAt,
            new Date(
                3000
            ).toISOString()
        );
    }
);

test(
    "cancelMigrationRun rejects terminal run",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    migrationRunPath(
                        "run-1"
                    )
                ]:
                    createStoredMigrationRun({
                        status:
                            "completed"
                    })
            });

        await assert.rejects(
            async function () {
                await cancelMigrationRun(
                    createRuntime({
                        firestore
                    }),
                    "run-1",
                    "Cancel.",
                    {}
                );
            },
            /terminal migration run/
        );
    }
);

/* ==========================================================
   SERIALIZATION AND ERRORS
========================================================== */

test(
    "stable serialization supports special values",
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

        assert.deepEqual(
            normalizeStableValue({
                bigint:
                    10n,

                buffer:
                    Buffer.from(
                        "hello"
                    ),

                missing:
                    undefined
            }),
            {
                bigint:
                    "10",

                buffer:
                    "aGVsbG8=",

                missing:
                    null
            }
        );
    }
);

test(
    "assertSerializableMigrationValue enforces size",
    function () {
        assert.equal(
            assertSerializableMigrationValue(
                {
                    updated:
                        10
                },
                1000,
                "Result"
            ),
            true
        );

        assert.throws(
            function () {
                assertSerializableMigrationValue(
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

test(
    "serializeMigrationError returns safe metadata",
    function () {
        const error =
            new ServiceError(
                "migration-error",
                "Migration failed.",
                {
                    status:
                        503,

                    retryable:
                        true,

                    details: {
                        migrationId:
                            "001-test"
                    }
                }
            );

        assert.deepEqual(
            serializeMigrationError(
                error
            ),
            {
                name:
                    "ServiceError",

                code:
                    "migration-error",

                message:
                    "Migration failed.",

                status:
                    503,

                retryable:
                    true,

                details: {
                    migrationId:
                        "001-test"
                }
            }
        );
    }
);

test(
    "createMigrationRunNotFoundError creates service error",
    function () {
        const error =
            createMigrationRunNotFoundError(
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
   RUNTIME AND TIME
========================================================== */

test(
    "assertMigrationRuntime validates runtime",
    function () {
        assert.doesNotThrow(
            function () {
                assertMigrationRuntime(
                    createRuntime()
                );
            }
        );

        assert.throws(
            function () {
                assertMigrationRuntime(
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
    "time helpers work",
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
    }
);

test(
    "createMigrationRunId creates unique IDs",
    function () {
        const first =
            createMigrationRunId(
                1000
            );

        const second =
            createMigrationRunId(
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
    "migration logging helpers emit expected levels",
    function () {
        const logger =
            createLoggerStub();

        logMigrationEvent(
            {
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

        logMigrationEvent(
            {
                logger
            },
            {
                id:
                    "run-2",

                status:
                    "partial"
            },
            "completed",
            {
                log:
                    true
            }
        );

        logMigrationEvent(
            {
                logger
            },
            {
                id:
                    "run-3",

                status:
                    "failed"
            },
            "failed",
            {
                log:
                    true
            }
        );

        logMigrationStepEvent(
            {
                logger
            },
            {
                id:
                    "001-test",

                version:
                    1,

                status:
                    "completed"
            },
            "completed",
            {
                log:
                    true
            }
        );

        logMigrationStepFailure(
            {
                logger
            },
            {
                id:
                    "002-test",

                version:
                    2,

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

        logMigrationLockFailure(
            {
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

        assert.deepEqual(
            logger.entries.map(
                function (
                    entry
                ) {
                    return entry.level;
                }
            ),
            [
                "info",
                "warn",
                "error",
                "info",
                "error",
                "warn"
            ]
        );
    }
);

/* ==========================================================
   CONSTANTS
========================================================== */

test(
    "migration constants expose expected defaults",
    function () {
        assert.equal(
            constants
                .MIGRATION_COLLECTION,
            "_migrationRuns"
        );

        assert.equal(
            constants
                .MIGRATION_STATE_COLLECTION,
            "_migrationState"
        );

        assert.equal(
            constants.DEFAULT_STATUS,
            "pending"
        );

        assert.equal(
            constants.DEFAULT_DIRECTION,
            "up"
        );

        assert.equal(
            constants.DEFAULT_BATCH_SIZE,
            100
        );

        assert.equal(
            constants.MAX_BATCH_SIZE,
            500
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
            constants.DEFAULT_MAX_MIGRATIONS,
            500
        );

        assert.equal(
            constants.DEFAULT_MAX_RESULT_BYTES,
            500000
        );

        assert.equal(
            constants.DEFAULT_RETENTION_MS,
            15552000000
        );

        assert.equal(
            constants.DEFAULT_LOCK_LEASE_MS,
            900000
        );

        assert.equal(
            constants.DEFAULT_LOCK_KEY,
            "global"
        );

        assert.deepEqual(
            constants.MIGRATION_DIRECTIONS,
            {
                up:
                    "up",

                down:
                    "down"
            }
        );

        assert.equal(
            constants
                .TERMINAL_MIGRATION_STATUSES
                .includes(
                    "completed"
                ),
            true
        );

        assert.equal(
            Object.isFrozen(
                constants
                    .TERMINAL_MIGRATION_STATUSES
            ),
            true
        );
    }
);