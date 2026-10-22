"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   HEALTH SERVICE

   Responsibilities:
   - Report application health
   - Check Firestore, Auth, and Storage availability
   - Expose safe runtime metadata
   - Support readiness and liveness checks
   - Enforce configurable health-check timeouts
========================================================== */

const {
    getRuntime,
    getRuntimeHealth
} = require(
    "./runtime"
);

const {
    withTimeout
} = require(
    "./async-handler"
);

const {
    ServiceError
} = require(
    "./service-error"
);

/* ==========================================================
   CONSTANTS
========================================================== */

const DEFAULT_TIMEOUT_MS =
    5000;

const DEFAULT_HEALTH_DOCUMENT =
    "_health/runtime";

const HEALTH_STATUSES =
    Object.freeze({
        healthy:
            "healthy",

        degraded:
            "degraded",

        unhealthy:
            "unhealthy"
    });

/* ==========================================================
   HEALTH SERVICE
========================================================== */

function createHealthService(options) {
    const settings =
        options || {};

    const runtime =
        settings.runtime ||
        getRuntime();

    const timeoutMs =
        normalizeTimeout(
            settings.timeoutMs ||
            DEFAULT_TIMEOUT_MS
        );

    return Object.freeze({
        runtime:
            runtime,

        timeoutMs:
            timeoutMs,

        liveness:
            function () {
                return checkLiveness(
                    runtime,
                    settings
                );
            },

        readiness:
            function () {
                return checkReadiness(
                    runtime,
                    Object.assign(
                        {},
                        settings,
                        {
                            timeoutMs:
                                timeoutMs
                        }
                    )
                );
            },

        firestore:
            function () {
                return checkFirestore(
                    runtime,
                    settings
                );
            },

        auth:
            function () {
                return checkAuth(
                    runtime,
                    settings
                );
            },

        storage:
            function () {
                return checkStorage(
                    runtime,
                    settings
                );
            }
    });
}

/* ==========================================================
   LIVENESS
========================================================== */

function checkLiveness(
    runtime,
    options
) {
    const settings =
        options || {};

    const timestamp =
        resolveNow(
            runtime,
            settings
        );

    return {
        status:
            HEALTH_STATUSES
                .healthy,

        healthy:
            true,

        type:
            "liveness",

        timestamp:
            new Date(
                timestamp
            ).toISOString(),

        uptimeSeconds:
            normalizeUptime(
                settings.uptimeSeconds
            ),

        service:
            resolveServiceName(
                runtime,
                settings
            ),

        environment:
            runtime &&
            runtime.configuration
                ? runtime
                    .configuration
                    .nodeEnvironment
                : "unknown"
    };
}

/* ==========================================================
   READINESS
========================================================== */

async function checkReadiness(
    runtime,
    options
) {
    const settings =
        options || {};

    const startedAt =
        resolveNow(
            runtime,
            settings
        );

    const timeoutMs =
        normalizeTimeout(
            settings.timeoutMs ||
            DEFAULT_TIMEOUT_MS
        );

    const checks = {
        firestore:
            createPendingCheck(
                "firestore"
            ),

        auth:
            createPendingCheck(
                "auth"
            ),

        storage:
            createPendingCheck(
                "storage"
            )
    };

    const selectedChecks =
        resolveSelectedChecks(
            settings
        );

    const tasks = [];

    if (
        selectedChecks
            .includes(
                "firestore"
            )
    ) {
        tasks.push(
            executeHealthCheck(
                "firestore",
                function () {
                    return checkFirestore(
                        runtime,
                        settings
                    );
                },
                timeoutMs
            ).then(
                function (result) {
                    checks.firestore =
                        result;
                }
            )
        );
    } else {
        checks.firestore =
            createSkippedCheck(
                "firestore"
            );
    }

    if (
        selectedChecks
            .includes(
                "auth"
            )
    ) {
        tasks.push(
            executeHealthCheck(
                "auth",
                function () {
                    return checkAuth(
                        runtime,
                        settings
                    );
                },
                timeoutMs
            ).then(
                function (result) {
                    checks.auth =
                        result;
                }
            )
        );
    } else {
        checks.auth =
            createSkippedCheck(
                "auth"
            );
    }

    if (
        selectedChecks
            .includes(
                "storage"
            )
    ) {
        tasks.push(
            executeHealthCheck(
                "storage",
                function () {
                    return checkStorage(
                        runtime,
                        settings
                    );
                },
                timeoutMs
            ).then(
                function (result) {
                    checks.storage =
                        result;
                }
            )
        );
    } else {
        checks.storage =
            createSkippedCheck(
                "storage"
            );
    }

    await Promise.all(
        tasks
    );

    const completedAt =
        resolveNow(
            runtime,
            settings
        );

    const status =
        resolveOverallStatus(
            checks,
            settings
        );

    const healthy =
        status ===
        HEALTH_STATUSES
            .healthy;

    return {
        status:
            status,

        healthy:
            healthy,

        type:
            "readiness",

        timestamp:
            new Date(
                completedAt
            ).toISOString(),

        durationMs:
            Math.max(
                0,
                completedAt -
                startedAt
            ),

        service:
            resolveServiceName(
                runtime,
                settings
            ),

        runtime:
            sanitizeRuntimeHealth(
                getRuntimeHealth(
                    runtime
                )
            ),

        checks:
            checks
    };
}

/* ==========================================================
   FIRESTORE CHECK
========================================================== */

async function checkFirestore(
    runtime,
    options
) {
    const settings =
        options || {};

    const startedAt =
        resolveNow(
            runtime,
            settings
        );

    if (
        !runtime ||
        !runtime.db
    ) {
        return createFailedCheck(
            "firestore",
            "Firestore is unavailable.",
            startedAt,
            resolveNow(
                runtime,
                settings
            ),
            "health/firestore-unavailable"
        );
    }

    try {
        if (
            typeof settings
                .firestoreCheck ===
                "function"
        ) {
            await settings
                .firestoreCheck(
                    runtime.db,
                    runtime
                );
        } else {
            await performFirestoreCheck(
                runtime,
                settings
            );
        }

        return createHealthyCheck(
            "firestore",
            startedAt,
            resolveNow(
                runtime,
                settings
            )
        );
    } catch (error) {
        return createFailedCheck(
            "firestore",
            error.message ||
            "Firestore health check failed.",
            startedAt,
            resolveNow(
                runtime,
                settings
            ),
            error.code ||
            "health/firestore-failed"
        );
    }
}

async function performFirestoreCheck(
    runtime,
    options
) {
    const settings =
        options || {};

    if (
        typeof runtime.db.doc ===
        "function"
    ) {
        const reference =
            runtime.db.doc(
                settings.healthDocument ||
                DEFAULT_HEALTH_DOCUMENT
            );

        if (
            reference &&
            typeof reference.get ===
                "function"
        ) {
            await reference.get();

            return;
        }
    }

    if (
        typeof runtime.db
            .collection ===
            "function"
    ) {
        const collection =
            runtime.db.collection(
                "_health"
            );

        if (
            collection &&
            typeof collection.limit ===
                "function"
        ) {
            await collection
                .limit(1)
                .get();

            return;
        }
    }

    throw createHealthError(
        "health/firestore-unsupported",
        "Firestore does not support a readable health operation."
    );
}

/* ==========================================================
   AUTH CHECK
========================================================== */

async function checkAuth(
    runtime,
    options
) {
    const settings =
        options || {};

    const startedAt =
        resolveNow(
            runtime,
            settings
        );

    if (
        !runtime ||
        !runtime.auth
    ) {
        return createFailedCheck(
            "auth",
            "Firebase Auth is unavailable.",
            startedAt,
            resolveNow(
                runtime,
                settings
            ),
            "health/auth-unavailable"
        );
    }

    try {
        if (
            typeof settings
                .authCheck ===
                "function"
        ) {
            await settings.authCheck(
                runtime.auth,
                runtime
            );
        } else {
            await performAuthCheck(
                runtime
            );
        }

        return createHealthyCheck(
            "auth",
            startedAt,
            resolveNow(
                runtime,
                settings
            )
        );
    } catch (error) {
        return createFailedCheck(
            "auth",
            error.message ||
            "Firebase Auth health check failed.",
            startedAt,
            resolveNow(
                runtime,
                settings
            ),
            error.code ||
            "health/auth-failed"
        );
    }
}

async function performAuthCheck(
    runtime
) {
    if (
        typeof runtime.auth
            .listUsers ===
            "function"
    ) {
        await runtime.auth
            .listUsers(1);

        return;
    }

    if (
        typeof runtime.auth
            .getUser ===
            "function"
    ) {
        try {
            await runtime.auth
                .getUser(
                    "__health_check__"
                );
        } catch (error) {
            if (
                error &&
                (
                    error.code ===
                        "auth/user-not-found" ||
                    error.code ===
                        "not-found"
                )
            ) {
                return;
            }

            throw error;
        }

        return;
    }

    throw createHealthError(
        "health/auth-unsupported",
        "Firebase Auth does not support a readable health operation."
    );
}

/* ==========================================================
   STORAGE CHECK
========================================================== */

async function checkStorage(
    runtime,
    options
) {
    const settings =
        options || {};

    const startedAt =
        resolveNow(
            runtime,
            settings
        );

    if (
        !runtime ||
        (
            !runtime.storage &&
            !runtime.bucket
        )
    ) {
        if (
            settings.storageRequired ===
            false
        ) {
            return createSkippedCheck(
                "storage",
                "Storage is not required."
            );
        }

        return createFailedCheck(
            "storage",
            "Firebase Storage is unavailable.",
            startedAt,
            resolveNow(
                runtime,
                settings
            ),
            "health/storage-unavailable"
        );
    }

    try {
        if (
            typeof settings
                .storageCheck ===
                "function"
        ) {
            await settings
                .storageCheck(
                    runtime.bucket ||
                    runtime.storage,
                    runtime
                );
        } else {
            await performStorageCheck(
                runtime
            );
        }

        return createHealthyCheck(
            "storage",
            startedAt,
            resolveNow(
                runtime,
                settings
            )
        );
    } catch (error) {
        return createFailedCheck(
            "storage",
            error.message ||
            "Firebase Storage health check failed.",
            startedAt,
            resolveNow(
                runtime,
                settings
            ),
            error.code ||
            "health/storage-failed"
        );
    }
}

async function performStorageCheck(
    runtime
) {
    const bucket =
        runtime.bucket ||
        (
            runtime.storage &&
            typeof runtime.storage
                .bucket ===
                "function"
                ? runtime.storage
                    .bucket()
                : null
        );

    if (!bucket) {
        throw createHealthError(
            "health/storage-bucket-unavailable",
            "Storage bucket is unavailable."
        );
    }

    if (
        typeof bucket.exists ===
        "function"
    ) {
        await bucket.exists();

        return;
    }

    if (
        typeof bucket.getMetadata ===
        "function"
    ) {
        await bucket
            .getMetadata();

        return;
    }

    if (
        typeof bucket.getFiles ===
        "function"
    ) {
        await bucket.getFiles({
            maxResults:
                1
        });

        return;
    }

    throw createHealthError(
        "health/storage-unsupported",
        "Storage does not support a readable health operation."
    );
}

/* ==========================================================
   CHECK EXECUTION
========================================================== */

async function executeHealthCheck(
    name,
    check,
    timeoutMs
) {
    try {
        const timedCheck =
            withTimeout(
                check,
                timeoutMs,
                {
                    message:
                        name +
                        " health check timed out.",

                    code:
                        "health/check-timeout",

                    status:
                        504
                }
            );

        return await timedCheck();
    } catch (error) {
        return {
            name:
                name,

            status:
                HEALTH_STATUSES
                    .unhealthy,

            healthy:
                false,

            skipped:
                false,

            durationMs:
                timeoutMs,

            error: {
                code:
                    error.code ||
                    "health/check-failed",

                message:
                    error.message ||
                    "Health check failed."
            }
        };
    }
}

/* ==========================================================
   STATUS RESOLUTION
========================================================== */

function resolveOverallStatus(
    checks,
    options
) {
    const settings =
        options || {};

    const values =
        Object.values(
            checks || {}
        );

    const active =
        values.filter(
            function (check) {
                return !check.skipped;
            }
        );

    if (!active.length) {
        return HEALTH_STATUSES
            .healthy;
    }

    const failed =
        active.filter(
            function (check) {
                return !check.healthy;
            }
        );

    if (!failed.length) {
        return HEALTH_STATUSES
            .healthy;
    }

    const criticalChecks =
        new Set(
            settings.criticalChecks ||
            [
                "firestore",
                "auth"
            ]
        );

    const criticalFailure =
        failed.some(
            function (check) {
                return criticalChecks
                    .has(
                        check.name
                    );
            }
        );

    if (criticalFailure) {
        return HEALTH_STATUSES
            .unhealthy;
    }

    return HEALTH_STATUSES
        .degraded;
}

/* ==========================================================
   CHECK RESULT FACTORIES
========================================================== */

function createPendingCheck(
    name
) {
    return {
        name:
            name,

        status:
            "pending",

        healthy:
            false,

        skipped:
            false,

        durationMs:
            0
    };
}

function createHealthyCheck(
    name,
    startedAt,
    completedAt
) {
    return {
        name:
            name,

        status:
            HEALTH_STATUSES
                .healthy,

        healthy:
            true,

        skipped:
            false,

        durationMs:
            Math.max(
                0,
                completedAt -
                startedAt
            )
    };
}

function createFailedCheck(
    name,
    message,
    startedAt,
    completedAt,
    code
) {
    return {
        name:
            name,

        status:
            HEALTH_STATUSES
                .unhealthy,

        healthy:
            false,

        skipped:
            false,

        durationMs:
            Math.max(
                0,
                completedAt -
                startedAt
            ),

        error: {
            code:
                code ||
                "health/check-failed",

            message:
                message ||
                "Health check failed."
        }
    };
}

function createSkippedCheck(
    name,
    reason
) {
    return {
        name:
            name,

        status:
            "skipped",

        healthy:
            true,

        skipped:
            true,

        durationMs:
            0,

        reason:
            reason ||
            "Health check was not requested."
    };
}

/* ==========================================================
   HELPERS
========================================================== */

function resolveSelectedChecks(
    options
) {
    const settings =
        options || {};

    const checks =
        settings.checks ||
        [
            "firestore",
            "auth",
            "storage"
        ];

    if (!Array.isArray(checks)) {
        throw new TypeError(
            "Health checks must be provided as an array."
        );
    }

    const supported =
        new Set([
            "firestore",
            "auth",
            "storage"
        ]);

    const normalized =
        checks.map(
            function (name) {
                return String(name)
                    .trim()
                    .toLowerCase();
            }
        );

    normalized.forEach(
        function (name) {
            if (
                !supported.has(name)
            ) {
                throw new TypeError(
                    "Unsupported health check: " +
                    name
                );
            }
        }
    );

    return Array.from(
        new Set(normalized)
    );
}

function normalizeTimeout(
    value
) {
    const timeout =
        Number(value);

    if (
        !Number.isInteger(
            timeout
        ) ||
        timeout <= 0
    ) {
        throw new TypeError(
            "Health-check timeout must be a positive integer."
        );
    }

    return timeout;
}

function normalizeUptime(
    value
) {
    if (
        value !== undefined
    ) {
        const uptime =
            Number(value);

        return Number.isFinite(
            uptime
        )
            ? Math.max(
                  0,
                  uptime
              )
            : 0;
    }

    if (
        typeof process.uptime ===
        "function"
    ) {
        return Math.max(
            0,
            process.uptime()
        );
    }

    return 0;
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

function resolveServiceName(
    runtime,
    options
) {
    const settings =
        options || {};

    return settings.serviceName ||
        (
            runtime &&
            runtime.configuration &&
            runtime
                .configuration
                .storeName
        ) ||
        "L'ÉTERNEL";
}

function sanitizeRuntimeHealth(
    health
) {
    return {
        projectId:
            health.projectId,

        region:
            health.region,

        environment:
            health.environment,

        emulator:
            health.emulator,

        services:
            Object.assign(
                {},
                health.services
            ),

        paymentProvider:
            health.paymentProvider,

        emailProvider:
            health.emailProvider
    };
}

function createHealthError(
    code,
    message,
    details
) {
    return new ServiceError(
        "unavailable",
        message,
        {
            status:
                503,

            internalMessage:
                message,

            expose:
                false,

            retryable:
                true,

            details:
                Object.assign(
                    {
                        healthCode:
                            code
                    },
                    details || {}
                )
        }
    );
}

/* ==========================================================
   HTTP HANDLERS
========================================================== */

async function handleLivenessRequest(
    request,
    response,
    options
) {
    const settings =
        options || {};

    const service =
        settings.service ||
        createHealthService(
            settings
        );

    const result =
        service.liveness();

    if (
        response &&
        typeof response
            .status ===
            "function"
    ) {
        response.status(200);
    } else if (response) {
        response.statusCode =
            200;
    }

    if (
        response &&
        typeof response
            .json ===
            "function"
    ) {
        response.json(result);

        return response;
    }

    return result;
}

async function handleReadinessRequest(
    request,
    response,
    options
) {
    const settings =
        options || {};

    const service =
        settings.service ||
        createHealthService(
            settings
        );

    const result =
        await service
            .readiness();

    const statusCode =
        result.status ===
        HEALTH_STATUSES
            .unhealthy
            ? 503
            : 200;

    if (
        response &&
        typeof response
            .status ===
            "function"
    ) {
        response.status(
            statusCode
        );
    } else if (response) {
        response.statusCode =
            statusCode;
    }

    if (
        response &&
        typeof response
            .json ===
            "function"
    ) {
        response.json(result);

        return response;
    }

    return result;
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    createHealthService,
    checkLiveness,
    checkReadiness,
    checkFirestore,
    checkAuth,
    checkStorage,
    performFirestoreCheck,
    performAuthCheck,
    performStorageCheck,
    executeHealthCheck,
    resolveOverallStatus,
    resolveSelectedChecks,
    createPendingCheck,
    createHealthyCheck,
    createFailedCheck,
    createSkippedCheck,
    normalizeTimeout,
    normalizeUptime,
    resolveNow,
    resolveServiceName,
    sanitizeRuntimeHealth,
    createHealthError,
    handleLivenessRequest,
    handleReadinessRequest,
    constants: {
        DEFAULT_TIMEOUT_MS,
        DEFAULT_HEALTH_DOCUMENT,
        HEALTH_STATUSES
    }
};