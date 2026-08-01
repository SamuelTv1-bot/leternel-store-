"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   CLOUD FUNCTIONS INTEGRATION / SMOKE TEST SUITE

   Purpose:
   - Verify all shared services load successfully
   - Verify critical factory exports remain connected
   - Verify operational services expose expected surfaces
   - Verify constants and collections remain consistent
   - Catch circular import / missing module regressions
   - Provide a final backend readiness smoke test
========================================================== */

const test =
    require("node:test");

const assert =
    require("node:assert/strict");

const fs =
    require("node:fs");

const path =
    require("node:path");

const Module =
    require("node:module");

/* ==========================================================
   PATHS
========================================================== */

const FUNCTIONS_ROOT =
    path.resolve(
        __dirname,
        ".."
    );

const SHARED_ROOT =
    path.join(
        FUNCTIONS_ROOT,
        "src",
        "shared"
    );

const FUNCTIONS_INDEX =
    path.join(
        FUNCTIONS_ROOT,
        "index.js"
    );

/* ==========================================================
   REQUIRED SHARED FILES
========================================================== */

const REQUIRED_SHARED_FILES =
    Object.freeze([
        "runtime.js",
        "service-error.js",
        "logger.js",

        "auth-service.js",
        "validation-service.js",
        "rate-limit-service.js",
        "idempotency-service.js",
        "signature-service.js",

        "cache-service.js",
        "lock-service.js",
        "queue-service.js",
        "retry-service.js",
        "circuit-breaker-service.js",
        "health-service.js",
        "metrics-service.js",
        "audit-service.js",

        "cleanup-service.js",
        "dead-letter-service.js",
        "maintenance-service.js",
        "reconciliation-service.js",
        "backup-service.js",
        "migration-service.js",

        "inventory-service.js",
        "order-service.js",
        "payment-service.js",
        "refund-service.js",
        "shipping-service.js",
        "notification-service.js",

        "index.js"
    ]);

/* ==========================================================
   EXPECTED SERVICE EXPORTS
========================================================== */

const EXPECTED_SERVICE_FACTORIES =
    Object.freeze({
        "auth-service":
            "createAuthService",

        "validation-service":
            "createValidationService",

        "rate-limit-service":
            "createRateLimitService",

        "idempotency-service":
            "createIdempotencyService",

        "signature-service":
            "createSignatureService",

        "cache-service":
            "createCacheService",

        "lock-service":
            "createLockService",

        "queue-service":
            "createQueueService",

        "retry-service":
            "createRetryService",

        "circuit-breaker-service":
            "createCircuitBreakerService",

        "health-service":
            "createHealthService",

        "metrics-service":
            "createMetricsService",

        "audit-service":
            "createAuditService",

        "cleanup-service":
            "createCleanupService",

        "dead-letter-service":
            "createDeadLetterService",

        "maintenance-service":
            "createMaintenanceService",

        "reconciliation-service":
            "createReconciliationService",

        "backup-service":
            "createBackupService",

        "migration-service":
            "createMigrationService",

        "inventory-service":
            "createInventoryService",

        "order-service":
            "createOrderService",

        "payment-service":
            "createPaymentService",

        "refund-service":
            "createRefundService",

        "shipping-service":
            "createShippingService",

        "notification-service":
            "createNotificationService"
    });

/* ==========================================================
   HELPERS
========================================================== */

function requireShared(
    moduleName
) {
    return require(
        path.join(
            SHARED_ROOT,
            moduleName
        )
    );
}

function clearRequire(
    filename
) {
    const resolved =
        require.resolve(
            filename
        );

    delete require.cache[
        resolved
    ];
}

function getJavaScriptFiles(
    directory
) {
    return fs
        .readdirSync(
            directory,
            {
                withFileTypes:
                    true
            }
        )
        .filter(
            function (
                entry
            ) {
                return (
                    entry.isFile() &&
                    entry.name.endsWith(
                        ".js"
                    )
                );
            }
        )
        .map(
            function (
                entry
            ) {
                return entry.name;
            }
        )
        .sort();
}

/* ==========================================================
   FIREBASE FUNCTIONS MOCK
========================================================== */

function createHttpsErrorClass() {
    return class HttpsError extends Error {
        constructor(
            code,
            message,
            details
        ) {
            super(
                message
            );

            this.name =
                "HttpsError";

            this.code =
                code;

            this.details =
                details;
        }
    };
}

function createFirebaseFunctionsMock() {
    const HttpsError =
        createHttpsErrorClass();

    function wrapCallable(
        handler
    ) {
        const callable =
            async function (
                data,
                context
            ) {
                return handler(
                    data,
                    context
                );
            };

        callable.__handler =
            handler;

        return callable;
    }

    function wrapScheduled(
        handler
    ) {
        const scheduled =
            async function (
                context
            ) {
                return handler(
                    context
                );
            };

        scheduled.__handler =
            handler;

        return scheduled;
    }

    function createRunWithBuilder() {
        return {
            https: {
                onCall:
                    wrapCallable
            },

            pubsub: {
                schedule:
                    function () {
                        return {
                            timeZone:
                                function () {
                                    return {
                                        onRun:
                                            wrapScheduled
                                    };
                                }
                        };
                    }
            }
        };
    }

    return {
        logger: {
            info:
                function () {},

            warn:
                function () {},

            error:
                function () {}
        },

        https: {
            HttpsError,

            onCall:
                wrapCallable
        },

        runWith:
            function () {
                return createRunWithBuilder();
            },

        pubsub: {
            schedule:
                function () {
                    return {
                        timeZone:
                            function () {
                                return {
                                    onRun:
                                        wrapScheduled
                                };
                            }
                    };
                }
        }
    };
}

/* ==========================================================
   FIREBASE ADMIN MOCK
========================================================== */

class MockTimestamp {
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
        return new MockTimestamp(
            milliseconds
        );
    }
}

function createFirestoreMock() {
    function unsupported() {
        throw new Error(
            "Firestore operation was not expected during module initialization."
        );
    }

    return {
        collection:
            function () {
                return {
                    doc:
                        function () {
                            return {
                                get:
                                    unsupported,

                                set:
                                    unsupported
                            };
                        },

                    where:
                        function () {
                            return this;
                        },

                    orderBy:
                        function () {
                            return this;
                        },

                    limit:
                        function () {
                            return this;
                        },

                    get:
                        unsupported
                };
            },

        runTransaction:
            unsupported
    };
}

function createFirebaseAdminMock() {
    const firestore =
        function () {
            return createFirestoreMock();
        };

    firestore.Timestamp =
        MockTimestamp;

    return {
        apps:
            [],

        initializeApp:
            function () {
                this.apps.push(
                    {
                        name:
                            "[DEFAULT]"
                    }
                );

                return this.apps[0];
            },

        firestore:
            firestore
    };
}

/* ==========================================================
   REQUIRE WITH FIREBASE MOCKS
========================================================== */

function requireFunctionsIndexWithMocks() {
    const functionsMock =
        createFirebaseFunctionsMock();

    const adminMock =
        createFirebaseAdminMock();

    const originalLoad =
        Module._load;

    Module._load =
        function (
            request,
            parent,
            isMain
        ) {
            if (
                request ===
                "firebase-functions"
            ) {
                return functionsMock;
            }

            if (
                request ===
                "firebase-admin"
            ) {
                return adminMock;
            }

            return originalLoad.call(
                this,
                request,
                parent,
                isMain
            );
        };

    try {
        clearRequire(
            FUNCTIONS_INDEX
        );

        const loaded =
            require(
                FUNCTIONS_INDEX
            );

        return {
            loaded,
            functionsMock,
            adminMock
        };
    } finally {
        Module._load =
            originalLoad;

        clearRequire(
            FUNCTIONS_INDEX
        );
    }
}

/* ==========================================================
   FILE EXISTENCE
========================================================== */

test(
    "all required shared service files exist",
    function () {
        for (
            const filename of
            REQUIRED_SHARED_FILES
        ) {
            const fullPath =
                path.join(
                    SHARED_ROOT,
                    filename
                );

            assert.equal(
                fs.existsSync(
                    fullPath
                ),
                true,
                "Missing shared file: " +
                filename
            );
        }
    }
);

test(
    "functions entrypoint exists",
    function () {
        assert.equal(
            fs.existsSync(
                FUNCTIONS_INDEX
            ),
            true
        );
    }
);

/* ==========================================================
   MODULE LOAD SMOKE TEST
========================================================== */

test(
    "every shared JavaScript module can be required",
    function () {
        const files =
            getJavaScriptFiles(
                SHARED_ROOT
            );

        assert.ok(
            files.length >
            0
        );

        for (
            const filename of
            files
        ) {
            const fullPath =
                path.join(
                    SHARED_ROOT,
                    filename
                );

            assert.doesNotThrow(
                function () {
                    require(
                        fullPath
                    );
                },
                "Unable to load shared module: " +
                filename
            );
        }
    }
);

/* ==========================================================
   SERVICE FACTORIES
========================================================== */

test(
    "all expected service modules export their factories",
    function () {
        for (
            const [
                moduleName,
                factoryName
            ] of
            Object.entries(
                EXPECTED_SERVICE_FACTORIES
            )
        ) {
            const service =
                requireShared(
                    moduleName
                );

            assert.equal(
                typeof service[
                    factoryName
                ],
                "function",
                moduleName +
                " must export " +
                factoryName
            );
        }
    }
);

/* ==========================================================
   SHARED INDEX
========================================================== */

test(
    "shared index exposes critical operational services",
    function () {
        const shared =
            requireShared(
                "index"
            );

        assert.equal(
            typeof shared
                .createCleanupService,
            "function"
        );

        assert.equal(
            typeof shared
                .createDeadLetterService,
            "function"
        );

        assert.equal(
            typeof shared
                .createMaintenanceService,
            "function"
        );

        assert.equal(
            typeof shared
                .createReconciliationService,
            "function"
        );

        assert.equal(
            typeof shared
                .createBackupService,
            "function"
        );

        assert.equal(
            typeof shared
                .createMigrationService,
            "function"
        );
    }
);

test(
    "shared operational service references match grouped exports",
    function () {
        const shared =
            requireShared(
                "index"
            );

        assert.equal(
            shared.operations
                .cleanupService,
            shared.cleanupService
        );

        assert.equal(
            shared.operations
                .deadLetterService,
            shared.deadLetterService
        );

        assert.equal(
            shared.operations
                .maintenanceService,
            shared.maintenanceService
        );

        assert.equal(
            shared.operations
                .reconciliationService,
            shared.reconciliationService
        );

        assert.equal(
            shared.operations
                .backupService,
            shared.backupService
        );

        assert.equal(
            shared.operations
                .migrationService,
            shared.migrationService
        );
    }
);

/* ==========================================================
   OPERATIONAL COLLECTION CONSISTENCY
========================================================== */

test(
    "cleanup defaults include expiring operational collections",
    function () {
        const cleanup =
            requireShared(
                "cleanup-service"
            );

        const collections =
            cleanup.constants
                .DEFAULT_EXPIRING_COLLECTIONS;

        const required = [
            "_backupRuns",
            "_deadLetters",
            "_maintenanceRuns",
            "_migrationRuns",
            "_reconciliationItems",
            "_reconciliationRuns"
        ];

        for (
            const collection of
            required
        ) {
            assert.equal(
                collections.includes(
                    collection
                ),
                true,
                "Cleanup defaults missing: " +
                collection
            );
        }
    }
);

test(
    "operational collection constants agree with cleanup defaults",
    function () {
        const cleanup =
            requireShared(
                "cleanup-service"
            );

        const backup =
            requireShared(
                "backup-service"
            );

        const migration =
            requireShared(
                "migration-service"
            );

        const reconciliation =
            requireShared(
                "reconciliation-service"
            );

        const defaults =
            cleanup.constants
                .DEFAULT_EXPIRING_COLLECTIONS;

        assert.equal(
            defaults.includes(
                backup.constants
                    .BACKUP_COLLECTION
            ),
            true
        );

        assert.equal(
            defaults.includes(
                migration.constants
                    .MIGRATION_COLLECTION
            ),
            true
        );

        assert.equal(
            defaults.includes(
                reconciliation.constants
                    .RECONCILIATION_COLLECTION
            ),
            true
        );

        assert.equal(
            defaults.includes(
                reconciliation.constants
                    .RECONCILIATION_ITEM_COLLECTION
            ),
            true
        );
    }
);

/* ==========================================================
   CLOUD FUNCTIONS ENTRYPOINT
========================================================== */

test(
    "functions index loads with Firebase mocks",
    function () {
        const {
            loaded
        } =
            requireFunctionsIndexWithMocks();

        assert.equal(
            typeof loaded,
            "object"
        );
    }
);

test(
    "functions index exports operational callable functions",
    function () {
        const {
            loaded
        } =
            requireFunctionsIndexWithMocks();

        const expected = [
            "runCleanup",
            "queryDeadLetters",
            "retryDeadLetter",
            "resolveDeadLetter",
            "runMaintenance",

            "runReconciliation",
            "queryReconciliationRuns",
            "queryReconciliationItems",
            "resolveReconciliationItem",
            "ignoreReconciliationItem",
            "cancelReconciliation",

            "exportBackup",
            "inspectBackup",
            "restoreBackup",
            "queryBackupRuns",
            "cancelBackup",

            "planMigrations",
            "runMigrations",
            "queryMigrationRuns",
            "getMigrationState",
            "cancelMigration",

            "operationsHealth"
        ];

        for (
            const name of
            expected
        ) {
            assert.equal(
                typeof loaded[
                    name
                ],
                "function",
                "Missing function export: " +
                name
            );
        }
    }
);

test(
    "functions index exports scheduled operational functions",
    function () {
        const {
            loaded
        } =
            requireFunctionsIndexWithMocks();

        assert.equal(
            typeof loaded
                .scheduledCleanup,
            "function"
        );

        assert.equal(
            typeof loaded
                .scheduledMaintenance,
            "function"
        );
    }
);

/* ==========================================================
   INTERNAL TEST EXPORTS
========================================================== */

test(
    "functions index exposes internal helpers for tests",
    function () {
        const {
            loaded
        } =
            requireFunctionsIndexWithMocks();

        assert.ok(
            loaded.__test
        );

        assert.equal(
            typeof loaded
                .__test
                .assertAdminRequest,
            "function"
        );

        assert.equal(
            typeof loaded
                .__test
                .toHttpsError,
            "function"
        );

        assert.equal(
            typeof loaded
                .__test
                .runCallable,
            "function"
        );

        assert.ok(
            loaded.__test
                .services
        );

        assert.equal(
            Object.isFrozen(
                loaded.__test
                    .services
            ),
            true
        );
    }
);

/* ==========================================================
   ADMIN AUTHORIZATION
========================================================== */

test(
    "assertAdminRequest accepts admin claim",
    async function () {
        const {
            loaded
        } =
            requireFunctionsIndexWithMocks();

        const auth =
            await loaded.__test
                .assertAdminRequest({
                    auth: {
                        uid:
                            "admin-1",

                        token: {
                            admin:
                                true
                        }
                    }
                });

        assert.equal(
            auth.uid,
            "admin-1"
        );
    }
);

test(
    "assertAdminRequest accepts admin role",
    async function () {
        const {
            loaded
        } =
            requireFunctionsIndexWithMocks();

        const auth =
            await loaded.__test
                .assertAdminRequest({
                    auth: {
                        uid:
                            "admin-1",

                        token: {
                            role:
                                "admin"
                        }
                    }
                });

        assert.equal(
            auth.uid,
            "admin-1"
        );
    }
);

test(
    "assertAdminRequest accepts admin in roles array",
    async function () {
        const {
            loaded
        } =
            requireFunctionsIndexWithMocks();

        const auth =
            await loaded.__test
                .assertAdminRequest({
                    auth: {
                        uid:
                            "admin-1",

                        token: {
                            roles: [
                                "staff",
                                "admin"
                            ]
                        }
                    }
                });

        assert.equal(
            auth.uid,
            "admin-1"
        );
    }
);

test(
    "assertAdminRequest rejects unauthenticated request",
    async function () {
        const {
            loaded
        } =
            requireFunctionsIndexWithMocks();

        await assert.rejects(
            async function () {
                await loaded.__test
                    .assertAdminRequest(
                        {}
                    );
            },
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "unauthenticated"
                );

                return true;
            }
        );
    }
);

test(
    "assertAdminRequest rejects non-admin request",
    async function () {
        const {
            loaded
        } =
            requireFunctionsIndexWithMocks();

        await assert.rejects(
            async function () {
                await loaded.__test
                    .assertAdminRequest({
                        auth: {
                            uid:
                                "customer-1",

                            token: {
                                role:
                                    "customer"
                            }
                        }
                    });
            },
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "permission-denied"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   HTTPS ERROR NORMALIZATION
========================================================== */

test(
    "toHttpsError preserves existing HttpsError",
    function () {
        const {
            loaded,
            functionsMock
        } =
            requireFunctionsIndexWithMocks();

        const original =
            new functionsMock
                .https
                .HttpsError(
                    "not-found",
                    "Missing."
                );

        const converted =
            loaded.__test
                .toHttpsError(
                    original
                );

        assert.equal(
            converted,
            original
        );
    }
);

test(
    "toHttpsError maps service error codes",
    function () {
        const {
            loaded
        } =
            requireFunctionsIndexWithMocks();

        const converted =
            loaded.__test
                .toHttpsError({
                    code:
                        "failed-precondition",

                    publicMessage:
                        "Operation cannot run.",

                    details: {
                        reason:
                            "locked"
                    }
                });

        assert.equal(
            converted.code,
            "failed-precondition"
        );

        assert.equal(
            converted.message,
            "Operation cannot run."
        );

        assert.deepEqual(
            converted.details,
            {
                reason:
                    "locked"
            }
        );
    }
);

test(
    "toHttpsError converts unknown failures to internal",
    function () {
        const {
            loaded
        } =
            requireFunctionsIndexWithMocks();

        const converted =
            loaded.__test
                .toHttpsError(
                    new Error(
                        "Unexpected."
                    )
                );

        assert.equal(
            converted.code,
            "internal"
        );

        assert.equal(
            converted.message,
            "Unexpected."
        );
    }
);

/* ==========================================================
   CALLABLE WRAPPER
========================================================== */

test(
    "runCallable returns handler result",
    async function () {
        const {
            loaded
        } =
            requireFunctionsIndexWithMocks();

        const result =
            await loaded.__test
                .runCallable(
                    async function () {
                        return {
                            ok:
                                true
                        };
                    }
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
    "runCallable converts failures to HttpsError",
    async function () {
        const {
            loaded
        } =
            requireFunctionsIndexWithMocks();

        await assert.rejects(
            async function () {
                await loaded.__test
                    .runCallable(
                        async function () {
                            throw {
                                code:
                                    "invalid-argument",

                                message:
                                    "Invalid request."
                            };
                        }
                    );
            },
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                assert.equal(
                    error.message,
                    "Invalid request."
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   OPERATIONS HEALTH
========================================================== */

test(
    "operationsHealth reports operational services",
    async function () {
        const {
            loaded
        } =
            requireFunctionsIndexWithMocks();

        const result =
            await loaded
                .operationsHealth(
                    {},
                    {
                        auth: {
                            uid:
                                "admin-1",

                            token: {
                                admin:
                                    true
                            }
                        }
                    }
                );

        assert.equal(
            result.ok,
            true
        );

        assert.equal(
            typeof result.timestamp,
            "string"
        );

        assert.deepEqual(
            result.services,
            {
                cleanup:
                    true,

                deadLetter:
                    true,

                maintenance:
                    true,

                reconciliation:
                    true,

                backup:
                    true,

                migration:
                    true
            }
        );
    }
);

/* ==========================================================
   SERVICE ERROR INTEGRATION
========================================================== */

test(
    "shared ServiceError integrates with HTTPS conversion",
    function () {
        const shared =
            requireShared(
                "index"
            );

        const {
            loaded
        } =
            requireFunctionsIndexWithMocks();

        const error =
            new shared.ServiceError(
                "resource-exhausted",
                "Operation limit reached.",
                {
                    status:
                        429,

                    expose:
                        true,

                    details: {
                        limit:
                            10
                    }
                }
            );

        const converted =
            loaded.__test
                .toHttpsError(
                    error
                );

        assert.equal(
            converted.code,
            "resource-exhausted"
        );

        assert.equal(
            converted.message,
            "Operation limit reached."
        );

        assert.deepEqual(
            converted.details,
            {
                limit:
                    10
            }
        );
    }
);

/* ==========================================================
   CONSTANT IMMUTABILITY
========================================================== */

test(
    "critical operational constant collections are frozen",
    function () {
        const cleanup =
            requireShared(
                "cleanup-service"
            );

        const reconciliation =
            requireShared(
                "reconciliation-service"
            );

        const backup =
            requireShared(
                "backup-service"
            );

        const migration =
            requireShared(
                "migration-service"
            );

        assert.equal(
            Object.isFrozen(
                cleanup.constants
                    .DEFAULT_EXPIRING_COLLECTIONS
            ),
            true
        );

        assert.equal(
            Object.isFrozen(
                reconciliation.constants
                    .DISCREPANCY_TYPES
            ),
            true
        );

        assert.equal(
            Object.isFrozen(
                reconciliation.constants
                    .TERMINAL_RECONCILIATION_STATUSES
            ),
            true
        );

        assert.equal(
            Object.isFrozen(
                backup.constants
                    .TERMINAL_BACKUP_STATUSES
            ),
            true
        );

        assert.equal(
            Object.isFrozen(
                migration.constants
                    .TERMINAL_MIGRATION_STATUSES
            ),
            true
        );
    }
);

/* ==========================================================
   FINAL BACKEND READINESS
========================================================== */

test(
    "backend operational surface is structurally complete",
    function () {
        const shared =
            requireShared(
                "index"
            );

        const requiredOperations = [
            "cleanupService",
            "deadLetterService",
            "maintenanceService",
            "reconciliationService",
            "backupService",
            "migrationService"
        ];

        for (
            const serviceName of
            requiredOperations
        ) {
            assert.ok(
                shared.operations[
                    serviceName
                ],
                "Missing operational service: " +
                serviceName
            );
        }

        const requiredDomain = [
            "inventoryService",
            "orderService",
            "paymentService",
            "refundService",
            "shippingService",
            "notificationService"
        ];

        for (
            const serviceName of
            requiredDomain
        ) {
            assert.ok(
                shared.domain[
                    serviceName
                ],
                "Missing domain service: " +
                serviceName
            );
        }
    }
);