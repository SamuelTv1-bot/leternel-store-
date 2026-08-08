"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   CLOUD FUNCTIONS ENTRYPOINT
========================================================== */

const functions =
    require("firebase-functions");

const admin =
    require("firebase-admin");

/* ==========================================================
   INITIALIZE FIREBASE ADMIN
========================================================== */

if (
    !admin.apps.length
) {
    admin.initializeApp();
}

/* ==========================================================
   SHARED SERVICES
========================================================== */

const shared =
    require(
        "./src/shared"
    );

const {
    createCleanupService,
    createDeadLetterService,
    createMaintenanceService,
    createReconciliationService,
    createBackupService,
    createMigrationService
} = shared;

/* ==========================================================
   RUNTIME
========================================================== */

const runtime =
    shared.getRuntime
        ? shared.getRuntime()
        : {
              db:
                  admin.firestore(),

              Timestamp:
                  admin.firestore
                      .Timestamp,

              now:
                  function () {
                      return Date.now();
                  },

              logger:
                  functions.logger
          };

/* ==========================================================
   OPERATIONAL SERVICES
========================================================== */

const cleanupService =
    createCleanupService({
        runtime:
            runtime
    });

const deadLetterService =
    createDeadLetterService({
        runtime:
            runtime
    });

const maintenanceService =
    createMaintenanceService({
        runtime:
            runtime
    });

const reconciliationService =
    createReconciliationService({
        runtime:
            runtime
    });

const backupService =
    createBackupService({
        runtime:
            runtime
    });

const migrationService =
    createMigrationService({
        runtime:
            runtime,

        migrations:
            []
    });

/* ==========================================================
   ADMIN AUTHORIZATION
========================================================== */

async function assertAdminRequest(
    context
) {
    if (
        !context ||
        !context.auth
    ) {
        throw new functions
            .https
            .HttpsError(
                "unauthenticated",
                "Authentication is required."
            );
    }

    const token =
        context.auth.token ||
        {};

    const isAdmin =
        token.admin ===
            true ||
        token.role ===
            "admin" ||
        (
            Array.isArray(
                token.roles
            ) &&
            token.roles.includes(
                "admin"
            )
        );

    if (
        !isAdmin
    ) {
        throw new functions
            .https
            .HttpsError(
                "permission-denied",
                "Administrator access is required."
            );
    }

    return context.auth;
}

/* ==========================================================
   ERROR NORMALIZATION
========================================================== */

function toHttpsError(
    error
) {
    if (
        error instanceof
        functions
            .https
            .HttpsError
    ) {
        return error;
    }

    const codeMap = {
        "invalid-argument":
            "invalid-argument",

        "not-found":
            "not-found",

        "already-exists":
            "already-exists",

        "permission-denied":
            "permission-denied",

        unauthenticated:
            "unauthenticated",

        "failed-precondition":
            "failed-precondition",

        aborted:
            "aborted",

        "resource-exhausted":
            "resource-exhausted",

        unavailable:
            "unavailable",

        "deadline-exceeded":
            "deadline-exceeded",

        internal:
            "internal"
    };

    const code =
        codeMap[
            error &&
            error.code
        ] ||
        "internal";

    return new functions
        .https
        .HttpsError(
            code,
            error &&
            (
                error.publicMessage ||
                error.message
            )
                ? (
                      error.publicMessage ||
                      error.message
                  )
                : "An internal error occurred.",
            error &&
            error.details
                ? error.details
                : undefined
        );
}

async function runCallable(
    handler
) {
    try {
        return await handler();
    } catch (error) {
        functions.logger.error(
            "Callable function failed.",
            {
                code:
                    error &&
                    error.code,

                message:
                    error &&
                    error.message,

                stack:
                    error &&
                    error.stack
            }
        );

        throw toHttpsError(
            error
        );
    }
}

/* ==========================================================
   CLEANUP
========================================================== */

exports.runCleanup =
    functions
        .runWith({
            timeoutSeconds:
                540,

            memory:
                "512MB"
        })
        .https
        .onCall(
            async function (
                data,
                context
            ) {
                return runCallable(
                    async function () {
                        await assertAdminRequest(
                            context
                        );

                        return cleanupService.run(
                            data || {}
                        );
                    }
                );
            }
        );

exports.scheduledCleanup =
    functions
        .runWith({
            timeoutSeconds:
                540,

            memory:
                "512MB"
        })
        .pubsub
        .schedule(
            "every 24 hours"
        )
        .timeZone(
            "Africa/Lagos"
        )
        .onRun(
            async function () {
                const result =
                    await cleanupService.run({
                        source:
                            "scheduled"
                    });

                functions.logger.info(
                    "Scheduled cleanup completed.",
                    {
                        status:
                            result &&
                            result.status,

                        deletedCount:
                            result &&
                            result.deletedCount
                    }
                );

                return null;
            }
        );

/* ==========================================================
   DEAD LETTERS
========================================================== */

exports.queryDeadLetters =
    functions
        .https
        .onCall(
            async function (
                data,
                context
            ) {
                return runCallable(
                    async function () {
                        await assertAdminRequest(
                            context
                        );

                        return deadLetterService.query(
                            data || {}
                        );
                    }
                );
            }
        );

exports.retryDeadLetter =
    functions
        .https
        .onCall(
            async function (
                data,
                context
            ) {
                return runCallable(
                    async function () {
                        await assertAdminRequest(
                            context
                        );

                        const input =
                            data || {};

                        return deadLetterService.retry(
                            input.id,
                            input
                        );
                    }
                );
            }
        );

exports.resolveDeadLetter =
    functions
        .https
        .onCall(
            async function (
                data,
                context
            ) {
                return runCallable(
                    async function () {
                        await assertAdminRequest(
                            context
                        );

                        const input =
                            data || {};

                        return deadLetterService.resolve(
                            input.id,
                            input.resolution,
                            input
                        );
                    }
                );
            }
        );

/* ==========================================================
   MAINTENANCE
========================================================== */

exports.runMaintenance =
    functions
        .runWith({
            timeoutSeconds:
                540,

            memory:
                "512MB"
        })
        .https
        .onCall(
            async function (
                data,
                context
            ) {
                return runCallable(
                    async function () {
                        await assertAdminRequest(
                            context
                        );

                        return maintenanceService.run(
                            data || {}
                        );
                    }
                );
            }
        );

exports.scheduledMaintenance =
    functions
        .runWith({
            timeoutSeconds:
                540,

            memory:
                "512MB"
        })
        .pubsub
        .schedule(
            "every 24 hours"
        )
        .timeZone(
            "Africa/Lagos"
        )
        .onRun(
            async function () {
                const result =
                    await maintenanceService.run({
                        source:
                            "scheduled"
                    });

                functions.logger.info(
                    "Scheduled maintenance completed.",
                    {
                        status:
                            result &&
                            result.status
                    }
                );

                return null;
            }
        );

/* ==========================================================
   RECONCILIATION
========================================================== */

exports.runReconciliation =
    functions
        .runWith({
            timeoutSeconds:
                540,

            memory:
                "512MB"
        })
        .https
        .onCall(
            async function (
                data,
                context
            ) {
                return runCallable(
                    async function () {
                        await assertAdminRequest(
                            context
                        );

                        return reconciliationService.run(
                            data || {}
                        );
                    }
                );
            }
        );

exports.queryReconciliationRuns =
    functions
        .https
        .onCall(
            async function (
                data,
                context
            ) {
                return runCallable(
                    async function () {
                        await assertAdminRequest(
                            context
                        );

                        return reconciliationService.query(
                            data || {}
                        );
                    }
                );
            }
        );

exports.queryReconciliationItems =
    functions
        .https
        .onCall(
            async function (
                data,
                context
            ) {
                return runCallable(
                    async function () {
                        await assertAdminRequest(
                            context
                        );

                        return reconciliationService.items(
                            data || {}
                        );
                    }
                );
            }
        );

exports.resolveReconciliationItem =
    functions
        .https
        .onCall(
            async function (
                data,
                context
            ) {
                return runCallable(
                    async function () {
                        await assertAdminRequest(
                            context
                        );

                        const input =
                            data || {};

                        return reconciliationService.resolve(
                            input.id,
                            input.resolution,
                            input
                        );
                    }
                );
            }
        );

exports.ignoreReconciliationItem =
    functions
        .https
        .onCall(
            async function (
                data,
                context
            ) {
                return runCallable(
                    async function () {
                        await assertAdminRequest(
                            context
                        );

                        const input =
                            data || {};

                        return reconciliationService.ignore(
                            input.id,
                            input.reason,
                            input
                        );
                    }
                );
            }
        );

/* ==========================================================
   BACKUPS
========================================================== */

exports.exportBackup =
    functions
        .runWith({
            timeoutSeconds:
                540,

            memory:
                "1GB"
        })
        .https
        .onCall(
            async function (
                data,
                context
            ) {
                return runCallable(
                    async function () {
                        await assertAdminRequest(
                            context
                        );

                        return backupService.export(
                            data || {}
                        );
                    }
                );
            }
        );

exports.inspectBackup =
    functions
        .https
        .onCall(
            async function (
                data,
                context
            ) {
                return runCallable(
                    async function () {
                        await assertAdminRequest(
                            context
                        );

                        const input =
                            data || {};

                        return backupService.inspect(
                            input.backup,
                            input.options || {}
                        );
                    }
                );
            }
        );

exports.restoreBackup =
    functions
        .runWith({
            timeoutSeconds:
                540,

            memory:
                "1GB"
        })
        .https
        .onCall(
            async function (
                data,
                context
            ) {
                return runCallable(
                    async function () {
                        await assertAdminRequest(
                            context
                        );

                        const input =
                            data || {};

                        return backupService.restore(
                            input.backup,
                            input.options || {}
                        );
                    }
                );
            }
        );

exports.queryBackupRuns =
    functions
        .https
        .onCall(
            async function (
                data,
                context
            ) {
                return runCallable(
                    async function () {
                        await assertAdminRequest(
                            context
                        );

                        return backupService.query(
                            data || {}
                        );
                    }
                );
            }
        );

/* ==========================================================
   MIGRATIONS
========================================================== */

exports.planMigrations =
    functions
        .https
        .onCall(
            async function (
                data,
                context
            ) {
                return runCallable(
                    async function () {
                        await assertAdminRequest(
                            context
                        );

                        return migrationService.plan(
                            data || {}
                        );
                    }
                );
            }
        );

exports.runMigrations =
    functions
        .runWith({
            timeoutSeconds:
                540,

            memory:
                "1GB"
        })
        .https
        .onCall(
            async function (
                data,
                context
            ) {
                return runCallable(
                    async function () {
                        await assertAdminRequest(
                            context
                        );

                        return migrationService.run(
                            data || {}
                        );
                    }
                );
            }
        );

exports.queryMigrationRuns =
    functions
        .https
        .onCall(
            async function (
                data,
                context
            ) {
                return runCallable(
                    async function () {
                        await assertAdminRequest(
                            context
                        );

                        return migrationService.query(
                            data || {}
                        );
                    }
                );
            }
        );

exports.getMigrationState =
    functions
        .https
        .onCall(
            async function (
                data,
                context
            ) {
                return runCallable(
                    async function () {
                        await assertAdminRequest(
                            context
                        );

                        const input =
                            data || {};

                        return migrationService.state(
                            input.id
                        );
                    }
                );
            }
        );

/* ==========================================================
   CANCELLATION ENDPOINTS
========================================================== */

exports.cancelReconciliation =
    functions
        .https
        .onCall(
            async function (
                data,
                context
            ) {
                return runCallable(
                    async function () {
                        await assertAdminRequest(
                            context
                        );

                        const input =
                            data || {};

                        return reconciliationService.cancel(
                            input.id,
                            input.reason,
                            input
                        );
                    }
                );
            }
        );

exports.cancelBackup =
    functions
        .https
        .onCall(
            async function (
                data,
                context
            ) {
                return runCallable(
                    async function () {
                        await assertAdminRequest(
                            context
                        );

                        const input =
                            data || {};

                        return backupService.cancel(
                            input.id,
                            input.reason,
                            input
                        );
                    }
                );
            }
        );

exports.cancelMigration =
    functions
        .https
        .onCall(
            async function (
                data,
                context
            ) {
                return runCallable(
                    async function () {
                        await assertAdminRequest(
                            context
                        );

                        const input =
                            data || {};

                        return migrationService.cancel(
                            input.id,
                            input.reason,
                            input
                        );
                    }
                );
            }
        );

/* ==========================================================
   OPERATIONAL HEALTH ENDPOINT
========================================================== */

exports.operationsHealth =
    functions
        .https
        .onCall(
            async function (
                data,
                context
            ) {
                return runCallable(
                    async function () {
                        await assertAdminRequest(
                            context
                        );

                        return {
                            ok:
                                true,

                            timestamp:
                                new Date()
                                    .toISOString(),

                            services: {
                                cleanup:
                                    Boolean(
                                        cleanupService
                                    ),

                                deadLetter:
                                    Boolean(
                                        deadLetterService
                                    ),

                                maintenance:
                                    Boolean(
                                        maintenanceService
                                    ),

                                reconciliation:
                                    Boolean(
                                        reconciliationService
                                    ),

                                backup:
                                    Boolean(
                                        backupService
                                    ),

                                migration:
                                    Boolean(
                                        migrationService
                                    )
                            }
                        };
                    }
                );
            }
        );

/* ==========================================================
   INTERNAL EXPORTS FOR TESTING
========================================================== */

exports.__test =
    Object.freeze({
        assertAdminRequest,
        toHttpsError,
        runCallable,

        services:
            Object.freeze({
                cleanupService,
                deadLetterService,
                maintenanceService,
                reconciliationService,
                backupService,
                migrationService
            })
    });

    const adminModule =
    require(
        "./src/admin"
    );

const adminCallableExports =
    adminModule
        .createAdminCallableExports();

exports.listAdministrators =
    adminCallableExports
        .listAdministrators;

exports.getAdministrator =
    adminCallableExports
        .getAdministrator;

exports.setAdministratorRole =
    adminCallableExports
        .setAdministratorRole;

exports.removeAdministratorRole =
    adminCallableExports
        .removeAdministratorRole;

exports.grantAdministratorPermissions =
    adminCallableExports
        .grantAdministratorPermissions;

exports.revokeAdministratorPermissions =
    adminCallableExports
        .revokeAdministratorPermissions;

exports.patchAdministratorClaims =
    adminCallableExports
        .patchAdministratorClaims;