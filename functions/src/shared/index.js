"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   SHARED SERVICES INDEX

   Central export surface for reusable Cloud Functions modules.
========================================================== */

/* ==========================================================
   CORE RUNTIME AND ERRORS
========================================================== */

const runtime =
    require(
        "./runtime"
    );

const serviceError =
    require(
        "./service-error"
    );

const logger =
    require(
        "./logger"
    );

/* ==========================================================
   SECURITY AND REQUEST UTILITIES
========================================================== */

const authService =
    require(
        "./auth-service"
    );

const validationService =
    require(
        "./validation-service"
    );

const rateLimitService =
    require(
        "./rate-limit-service"
    );

const idempotencyService =
    require(
        "./idempotency-service"
    );

const signatureService =
    require(
        "./signature-service"
    );

/* ==========================================================
   DATA AND INFRASTRUCTURE SERVICES
========================================================== */

const cacheService =
    require(
        "./cache-service"
    );

const lockService =
    require(
        "./lock-service"
    );

const queueService =
    require(
        "./queue-service"
    );

const retryService =
    require(
        "./retry-service"
    );

const circuitBreakerService =
    require(
        "./circuit-breaker-service"
    );

const healthService =
    require(
        "./health-service"
    );

const metricsService =
    require(
        "./metrics-service"
    );

const auditService =
    require(
        "./audit-service"
    );

/* ==========================================================
   OPERATIONAL SERVICES
========================================================== */

const cleanupService =
    require(
        "./cleanup-service"
    );

const deadLetterService =
    require(
        "./dead-letter-service"
    );

const maintenanceService =
    require(
        "./maintenance-service"
    );

const reconciliationService =
    require(
        "./reconciliation-service"
    );

const backupService =
    require(
        "./backup-service"
    );

const migrationService =
    require(
        "./migration-service"
    );

/* ==========================================================
   DOMAIN SERVICES
========================================================== */

const inventoryService =
    require(
        "./inventory-service"
    );

const orderService =
    require(
        "./order-service"
    );

const paymentService =
    require(
        "./payment-service"
    );

const refundService =
    require(
        "./refund-service"
    );

const shippingService =
    require(
        "./shipping-service"
    );

const notificationService =
    require(
        "./notification-service"
    );

/* ==========================================================
   SERVICE GROUPS
========================================================== */

const core =
    Object.freeze({
        runtime,
        serviceError,
        logger
    });

const security =
    Object.freeze({
        authService,
        validationService,
        rateLimitService,
        idempotencyService,
        signatureService
    });

const infrastructure =
    Object.freeze({
        cacheService,
        lockService,
        queueService,
        retryService,
        circuitBreakerService,
        healthService,
        metricsService,
        auditService
    });

const operations =
    Object.freeze({
        cleanupService,
        deadLetterService,
        maintenanceService,
        reconciliationService,
        backupService,
        migrationService
    });

const domain =
    Object.freeze({
        inventoryService,
        orderService,
        paymentService,
        refundService,
        shippingService,
        notificationService
    });

/* ==========================================================
   FACTORY SHORTCUTS
========================================================== */

const factories =
    Object.freeze({
        createAuthService:
            authService
                .createAuthService,

        createValidationService:
            validationService
                .createValidationService,

        createRateLimitService:
            rateLimitService
                .createRateLimitService,

        createIdempotencyService:
            idempotencyService
                .createIdempotencyService,

        createSignatureService:
            signatureService
                .createSignatureService,

        createCacheService:
            cacheService
                .createCacheService,

        createLockService:
            lockService
                .createLockService,

        createQueueService:
            queueService
                .createQueueService,

        createRetryService:
            retryService
                .createRetryService,

        createCircuitBreakerService:
            circuitBreakerService
                .createCircuitBreakerService,

        createHealthService:
            healthService
                .createHealthService,

        createMetricsService:
            metricsService
                .createMetricsService,

        createAuditService:
            auditService
                .createAuditService,

        createCleanupService:
            cleanupService
                .createCleanupService,

        createDeadLetterService:
            deadLetterService
                .createDeadLetterService,

        createMaintenanceService:
            maintenanceService
                .createMaintenanceService,

        createReconciliationService:
            reconciliationService
                .createReconciliationService,

        createBackupService:
            backupService
                .createBackupService,

        createMigrationService:
            migrationService
                .createMigrationService,

        createInventoryService:
            inventoryService
                .createInventoryService,

        createOrderService:
            orderService
                .createOrderService,

        createPaymentService:
            paymentService
                .createPaymentService,

        createRefundService:
            refundService
                .createRefundService,

        createShippingService:
            shippingService
                .createShippingService,

        createNotificationService:
            notificationService
                .createNotificationService
    });

/* ==========================================================
   CORE SHORTCUTS
========================================================== */

const coreExports =
    Object.freeze({
        getRuntime:
            runtime.getRuntime,

        createRuntime:
            runtime.createRuntime,

        resetRuntime:
            runtime.resetRuntime,

        ServiceError:
            serviceError.ServiceError,

        isServiceError:
            serviceError.isServiceError,

        normalizeServiceError:
            serviceError.normalizeServiceError,

        serializeServiceError:
            serviceError.serializeServiceError,

        createLogger:
            logger.createLogger
    });

/* ==========================================================
   EXPORTS
========================================================== */

module.exports =
    Object.freeze({
        core,
        security,
        infrastructure,
        operations,
        domain,
        factories,

        runtime,
        serviceError,
        logger,

        authService,
        validationService,
        rateLimitService,
        idempotencyService,
        signatureService,

        cacheService,
        lockService,
        queueService,
        retryService,
        circuitBreakerService,
        healthService,
        metricsService,
        auditService,

        cleanupService,
        deadLetterService,
        maintenanceService,
        reconciliationService,
        backupService,
        migrationService,

        inventoryService,
        orderService,
        paymentService,
        refundService,
        shippingService,
        notificationService,

        getRuntime:
            coreExports.getRuntime,

        createRuntime:
            coreExports.createRuntime,

        resetRuntime:
            coreExports.resetRuntime,

        ServiceError:
            coreExports.ServiceError,

        isServiceError:
            coreExports.isServiceError,

        normalizeServiceError:
            coreExports.normalizeServiceError,

        serializeServiceError:
            coreExports.serializeServiceError,

        createLogger:
            coreExports.createLogger,

        createAuthService:
            factories.createAuthService,

        createValidationService:
            factories.createValidationService,

        createRateLimitService:
            factories.createRateLimitService,

        createIdempotencyService:
            factories.createIdempotencyService,

        createSignatureService:
            factories.createSignatureService,

        createCacheService:
            factories.createCacheService,

        createLockService:
            factories.createLockService,

        createQueueService:
            factories.createQueueService,

        createRetryService:
            factories.createRetryService,

        createCircuitBreakerService:
            factories.createCircuitBreakerService,

        createHealthService:
            factories.createHealthService,

        createMetricsService:
            factories.createMetricsService,

        createAuditService:
            factories.createAuditService,

        createCleanupService:
            factories.createCleanupService,

        createDeadLetterService:
            factories.createDeadLetterService,

        createMaintenanceService:
            factories.createMaintenanceService,

        createReconciliationService:
            factories.createReconciliationService,

        createBackupService:
            factories.createBackupService,

        createMigrationService:
            factories.createMigrationService,

        createInventoryService:
            factories.createInventoryService,

        createOrderService:
            factories.createOrderService,

        createPaymentService:
            factories.createPaymentService,

        createRefundService:
            factories.createRefundService,

        createShippingService:
            factories.createShippingService,

        createNotificationService:
            factories.createNotificationService
    });