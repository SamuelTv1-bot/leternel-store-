"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   SHARED INDEX TEST SUITE
========================================================== */

const test =
    require("node:test");

const assert =
    require("node:assert/strict");

const shared =
    require(
        "../src/shared"
    );

/* ==========================================================
   EXPECTED MODULES
========================================================== */

const expectedTopLevelModules =
    Object.freeze([
        "runtime",
        "serviceError",
        "logger",

        "authService",
        "validationService",
        "rateLimitService",
        "idempotencyService",
        "signatureService",

        "cacheService",
        "lockService",
        "queueService",
        "retryService",
        "circuitBreakerService",
        "healthService",
        "metricsService",
        "auditService",

        "cleanupService",
        "deadLetterService",
        "maintenanceService",
        "reconciliationService",
        "backupService",
        "migrationService",

        "inventoryService",
        "orderService",
        "paymentService",
        "refundService",
        "shippingService",
        "notificationService"
    ]);

const expectedFactories =
    Object.freeze([
        "createAuthService",
        "createValidationService",
        "createRateLimitService",
        "createIdempotencyService",
        "createSignatureService",

        "createCacheService",
        "createLockService",
        "createQueueService",
        "createRetryService",
        "createCircuitBreakerService",
        "createHealthService",
        "createMetricsService",
        "createAuditService",

        "createCleanupService",
        "createDeadLetterService",
        "createMaintenanceService",
        "createReconciliationService",
        "createBackupService",
        "createMigrationService",

        "createInventoryService",
        "createOrderService",
        "createPaymentService",
        "createRefundService",
        "createShippingService",
        "createNotificationService"
    ]);

/* ==========================================================
   ROOT EXPORT
========================================================== */

test(
    "shared index exports a frozen object",
    function () {
        assert.equal(
            typeof shared,
            "object"
        );

        assert.equal(
            Object.isFrozen(
                shared
            ),
            true
        );
    }
);

test(
    "shared index exports all service modules",
    function () {
        for (
            const moduleName of
            expectedTopLevelModules
        ) {
            assert.ok(
                Object.prototype
                    .hasOwnProperty
                    .call(
                        shared,
                        moduleName
                    ),
                "Missing shared module export: " +
                moduleName
            );

            assert.equal(
                typeof shared[
                    moduleName
                ],
                "object",
                moduleName +
                " must export an object"
            );
        }
    }
);

test(
    "shared index exports service groups",
    function () {
        assert.equal(
            typeof shared.core,
            "object"
        );

        assert.equal(
            typeof shared.security,
            "object"
        );

        assert.equal(
            typeof shared.infrastructure,
            "object"
        );

        assert.equal(
            typeof shared.operations,
            "object"
        );

        assert.equal(
            typeof shared.domain,
            "object"
        );

        assert.equal(
            typeof shared.factories,
            "object"
        );
    }
);

test(
    "shared service groups are frozen",
    function () {
        assert.equal(
            Object.isFrozen(
                shared.core
            ),
            true
        );

        assert.equal(
            Object.isFrozen(
                shared.security
            ),
            true
        );

        assert.equal(
            Object.isFrozen(
                shared.infrastructure
            ),
            true
        );

        assert.equal(
            Object.isFrozen(
                shared.operations
            ),
            true
        );

        assert.equal(
            Object.isFrozen(
                shared.domain
            ),
            true
        );

        assert.equal(
            Object.isFrozen(
                shared.factories
            ),
            true
        );
    }
);

/* ==========================================================
   CORE GROUP
========================================================== */

test(
    "core group references root modules",
    function () {
        assert.equal(
            shared.core.runtime,
            shared.runtime
        );

        assert.equal(
            shared.core.serviceError,
            shared.serviceError
        );

        assert.equal(
            shared.core.logger,
            shared.logger
        );
    }
);

test(
    "core shortcuts reference source module functions",
    function () {
        assert.equal(
            shared.getRuntime,
            shared.runtime
                .getRuntime
        );

        assert.equal(
            shared.createRuntime,
            shared.runtime
                .createRuntime
        );

        assert.equal(
            shared.resetRuntime,
            shared.runtime
                .resetRuntime
        );

        assert.equal(
            shared.ServiceError,
            shared.serviceError
                .ServiceError
        );

        assert.equal(
            shared.isServiceError,
            shared.serviceError
                .isServiceError
        );

        assert.equal(
            shared.normalizeServiceError,
            shared.serviceError
                .normalizeServiceError
        );

        assert.equal(
            shared.serializeServiceError,
            shared.serviceError
                .serializeServiceError
        );

        assert.equal(
            shared.createLogger,
            shared.logger
                .createLogger
        );
    }
);

/* ==========================================================
   SECURITY GROUP
========================================================== */

test(
    "security group contains expected services",
    function () {
        assert.deepEqual(
            Object.keys(
                shared.security
            ),
            [
                "authService",
                "validationService",
                "rateLimitService",
                "idempotencyService",
                "signatureService"
            ]
        );
    }
);

test(
    "security group references root service modules",
    function () {
        assert.equal(
            shared.security
                .authService,
            shared.authService
        );

        assert.equal(
            shared.security
                .validationService,
            shared.validationService
        );

        assert.equal(
            shared.security
                .rateLimitService,
            shared.rateLimitService
        );

        assert.equal(
            shared.security
                .idempotencyService,
            shared.idempotencyService
        );

        assert.equal(
            shared.security
                .signatureService,
            shared.signatureService
        );
    }
);

/* ==========================================================
   INFRASTRUCTURE GROUP
========================================================== */

test(
    "infrastructure group contains expected services",
    function () {
        assert.deepEqual(
            Object.keys(
                shared.infrastructure
            ),
            [
                "cacheService",
                "lockService",
                "queueService",
                "retryService",
                "circuitBreakerService",
                "healthService",
                "metricsService",
                "auditService"
            ]
        );
    }
);

test(
    "infrastructure group references root service modules",
    function () {
        assert.equal(
            shared.infrastructure
                .cacheService,
            shared.cacheService
        );

        assert.equal(
            shared.infrastructure
                .lockService,
            shared.lockService
        );

        assert.equal(
            shared.infrastructure
                .queueService,
            shared.queueService
        );

        assert.equal(
            shared.infrastructure
                .retryService,
            shared.retryService
        );

        assert.equal(
            shared.infrastructure
                .circuitBreakerService,
            shared.circuitBreakerService
        );

        assert.equal(
            shared.infrastructure
                .healthService,
            shared.healthService
        );

        assert.equal(
            shared.infrastructure
                .metricsService,
            shared.metricsService
        );

        assert.equal(
            shared.infrastructure
                .auditService,
            shared.auditService
        );
    }
);

/* ==========================================================
   OPERATIONS GROUP
========================================================== */

test(
    "operations group contains expected services",
    function () {
        assert.deepEqual(
            Object.keys(
                shared.operations
            ),
            [
                "cleanupService",
                "deadLetterService",
                "maintenanceService",
                "reconciliationService",
                "backupService",
                "migrationService"
            ]
        );
    }
);

test(
    "operations group references root service modules",
    function () {
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
   DOMAIN GROUP
========================================================== */

test(
    "domain group contains expected services",
    function () {
        assert.deepEqual(
            Object.keys(
                shared.domain
            ),
            [
                "inventoryService",
                "orderService",
                "paymentService",
                "refundService",
                "shippingService",
                "notificationService"
            ]
        );
    }
);

test(
    "domain group references root service modules",
    function () {
        assert.equal(
            shared.domain
                .inventoryService,
            shared.inventoryService
        );

        assert.equal(
            shared.domain
                .orderService,
            shared.orderService
        );

        assert.equal(
            shared.domain
                .paymentService,
            shared.paymentService
        );

        assert.equal(
            shared.domain
                .refundService,
            shared.refundService
        );

        assert.equal(
            shared.domain
                .shippingService,
            shared.shippingService
        );

        assert.equal(
            shared.domain
                .notificationService,
            shared.notificationService
        );
    }
);

/* ==========================================================
   FACTORY EXPORTS
========================================================== */

test(
    "factory group exports all service factories",
    function () {
        assert.deepEqual(
            Object.keys(
                shared.factories
            ),
            expectedFactories
        );

        for (
            const factoryName of
            expectedFactories
        ) {
            assert.equal(
                typeof shared.factories[
                    factoryName
                ],
                "function",
                factoryName +
                " must be a function"
            );
        }
    }
);

test(
    "root exports all factory shortcuts",
    function () {
        for (
            const factoryName of
            expectedFactories
        ) {
            assert.equal(
                typeof shared[
                    factoryName
                ],
                "function",
                "Missing root factory: " +
                factoryName
            );

            assert.equal(
                shared[
                    factoryName
                ],
                shared.factories[
                    factoryName
                ]
            );
        }
    }
);

/* ==========================================================
   FACTORY REFERENCES
========================================================== */

test(
    "security factory shortcuts reference service factories",
    function () {
        assert.equal(
            shared.createAuthService,
            shared.authService
                .createAuthService
        );

        assert.equal(
            shared.createValidationService,
            shared.validationService
                .createValidationService
        );

        assert.equal(
            shared.createRateLimitService,
            shared.rateLimitService
                .createRateLimitService
        );

        assert.equal(
            shared.createIdempotencyService,
            shared.idempotencyService
                .createIdempotencyService
        );

        assert.equal(
            shared.createSignatureService,
            shared.signatureService
                .createSignatureService
        );
    }
);

test(
    "infrastructure factory shortcuts reference service factories",
    function () {
        assert.equal(
            shared.createCacheService,
            shared.cacheService
                .createCacheService
        );

        assert.equal(
            shared.createLockService,
            shared.lockService
                .createLockService
        );

        assert.equal(
            shared.createQueueService,
            shared.queueService
                .createQueueService
        );

        assert.equal(
            shared.createRetryService,
            shared.retryService
                .createRetryService
        );

        assert.equal(
            shared.createCircuitBreakerService,
            shared.circuitBreakerService
                .createCircuitBreakerService
        );

        assert.equal(
            shared.createHealthService,
            shared.healthService
                .createHealthService
        );

        assert.equal(
            shared.createMetricsService,
            shared.metricsService
                .createMetricsService
        );

        assert.equal(
            shared.createAuditService,
            shared.auditService
                .createAuditService
        );
    }
);

test(
    "operations factory shortcuts reference service factories",
    function () {
        assert.equal(
            shared.createCleanupService,
            shared.cleanupService
                .createCleanupService
        );

        assert.equal(
            shared.createDeadLetterService,
            shared.deadLetterService
                .createDeadLetterService
        );

        assert.equal(
            shared.createMaintenanceService,
            shared.maintenanceService
                .createMaintenanceService
        );

        assert.equal(
            shared.createReconciliationService,
            shared.reconciliationService
                .createReconciliationService
        );

        assert.equal(
            shared.createBackupService,
            shared.backupService
                .createBackupService
        );

        assert.equal(
            shared.createMigrationService,
            shared.migrationService
                .createMigrationService
        );
    }
);

test(
    "domain factory shortcuts reference service factories",
    function () {
        assert.equal(
            shared.createInventoryService,
            shared.inventoryService
                .createInventoryService
        );

        assert.equal(
            shared.createOrderService,
            shared.orderService
                .createOrderService
        );

        assert.equal(
            shared.createPaymentService,
            shared.paymentService
                .createPaymentService
        );

        assert.equal(
            shared.createRefundService,
            shared.refundService
                .createRefundService
        );

        assert.equal(
            shared.createShippingService,
            shared.shippingService
                .createShippingService
        );

        assert.equal(
            shared.createNotificationService,
            shared.notificationService
                .createNotificationService
        );
    }
);

/* ==========================================================
   MODULE IDENTITY
========================================================== */

test(
    "shared modules reference direct requires",
    function () {
        assert.equal(
            shared.runtime,
            require(
                "../src/shared/runtime"
            )
        );

        assert.equal(
            shared.serviceError,
            require(
                "../src/shared/service-error"
            )
        );

        assert.equal(
            shared.logger,
            require(
                "../src/shared/logger"
            )
        );

        assert.equal(
            shared.cleanupService,
            require(
                "../src/shared/cleanup-service"
            )
        );

        assert.equal(
            shared.deadLetterService,
            require(
                "../src/shared/dead-letter-service"
            )
        );

        assert.equal(
            shared.maintenanceService,
            require(
                "../src/shared/maintenance-service"
            )
        );

        assert.equal(
            shared.reconciliationService,
            require(
                "../src/shared/reconciliation-service"
            )
        );

        assert.equal(
            shared.backupService,
            require(
                "../src/shared/backup-service"
            )
        );

        assert.equal(
            shared.migrationService,
            require(
                "../src/shared/migration-service"
            )
        );
    }
);

/* ==========================================================
   ERROR CLASS
========================================================== */

test(
    "ServiceError shortcut constructs exported service error",
    function () {
        const error =
            new shared.ServiceError(
                "test-error",
                "Test failure.",
                {
                    status:
                        400,

                    expose:
                        true
                }
            );

        assert.equal(
            error instanceof
                shared.serviceError
                    .ServiceError,
            true
        );

        assert.equal(
            error.code,
            "test-error"
        );

        assert.equal(
            error.message,
            "Test failure."
        );

        assert.equal(
            error.status,
            400
        );
    }
);

/* ==========================================================
   IMMUTABILITY
========================================================== */

test(
    "shared export cannot be extended",
    function () {
        assert.throws(
            function () {
                shared.newService =
                    {};
            },
            TypeError
        );

        assert.equal(
            Object.prototype
                .hasOwnProperty
                .call(
                    shared,
                    "newService"
                ),
            false
        );
    }
);

test(
    "service groups cannot be extended",
    function () {
        assert.throws(
            function () {
                shared.operations
                    .newService =
                    {};
            },
            TypeError
        );

        assert.throws(
            function () {
                shared.factories
                    .createNewService =
                    function () {};
            },
            TypeError
        );
    }
);

/* ==========================================================
   STRUCTURAL COMPLETENESS
========================================================== */

test(
    "every grouped service is also exported at root",
    function () {
        const groups = [
            shared.core,
            shared.security,
            shared.infrastructure,
            shared.operations,
            shared.domain
        ];

        for (
            const group of
            groups
        ) {
            for (
                const [
                    key,
                    value
                ] of
                Object.entries(
                    group
                )
            ) {
                assert.equal(
                    shared[
                        key
                    ],
                    value,
                    "Root export does not match grouped export: " +
                    key
                );
            }
        }
    }
);

test(
    "every factory shortcut exists in factory group and root",
    function () {
        for (
            const [
                name,
                factory
            ] of
            Object.entries(
                shared.factories
            )
        ) {
            assert.equal(
                shared[
                    name
                ],
                factory
            );

            assert.equal(
                typeof factory,
                "function"
            );
        }
    }
);