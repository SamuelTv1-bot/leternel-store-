"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   HEALTH SERVICE TEST SUITE
========================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
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
    constants
} = require(
    "../src/shared/health-service"
);

const {
    ServiceError
} = require(
    "../src/shared/service-error"
);

/* ==========================================================
   TEST HELPERS
========================================================== */

function createConfiguration(
    overrides
) {
    const base = {
        projectId:
            "leternel-health-test",

        region:
            "europe-west1",

        nodeEnvironment:
            "test",

        storeName:
            "L'ÉTERNEL",

        payments: {
            provider:
                "paystack"
        },

        email: {
            provider:
                "resend"
        }
    };

    return Object.assign(
        {},
        base,
        overrides || {},
        {
            payments:
                Object.assign(
                    {},
                    base.payments,
                    overrides &&
                    overrides.payments
                        ? overrides.payments
                        : {}
                ),

            email:
                Object.assign(
                    {},
                    base.email,
                    overrides &&
                    overrides.email
                        ? overrides.email
                        : {}
                )
        }
    );
}

function createFirestoreStub(
    options
) {
    const settings =
        options || {};

    const state = {
        requestedDocuments:
            [],

        requestedCollections:
            [],

        reads:
            0
    };

    const db = {
        doc:
            settings.disableDoc
                ? undefined
                : function (path) {
                      state
                          .requestedDocuments
                          .push(path);

                      return {
                          get:
                              settings.disableDocumentGet
                                  ? undefined
                                  : async function () {
                                        state.reads +=
                                            1;

                                        if (
                                            settings.error
                                        ) {
                                            throw settings.error;
                                        }

                                        return {
                                            exists:
                                                settings.exists !==
                                                false
                                        };
                                    }
                      };
                  },

        collection:
            settings.disableCollection
                ? undefined
                : function (path) {
                      state
                          .requestedCollections
                          .push(path);

                      return {
                          limit:
                              function () {
                                  return {
                                      get:
                                          async function () {
                                              state.reads +=
                                                  1;

                                              if (
                                                  settings.error
                                              ) {
                                                  throw settings.error;
                                              }

                                              return {
                                                  empty:
                                                      true
                                              };
                                          }
                                  };
                              }
                      };
                  }
    };

    return {
        db,
        state
    };
}

function createAuthStub(
    options
) {
    const settings =
        options || {};

    const state = {
        listUsersCalls:
            [],

        getUserCalls:
            []
    };

    const auth = {};

    if (
        !settings.disableListUsers
    ) {
        auth.listUsers =
            async function (limit) {
                state
                    .listUsersCalls
                    .push(limit);

                if (
                    settings.error
                ) {
                    throw settings.error;
                }

                return {
                    users:
                        []
                };
            };
    }

    if (
        !settings.disableGetUser
    ) {
        auth.getUser =
            async function (uid) {
                state
                    .getUserCalls
                    .push(uid);

                if (
                    settings.getUserError
                ) {
                    throw settings
                        .getUserError;
                }

                return {
                    uid:
                        uid
                };
            };
    }

    return {
        auth,
        state
    };
}

function createStorageStub(
    options
) {
    const settings =
        options || {};

    const state = {
        existsCalls:
            0,

        metadataCalls:
            0,

        getFilesCalls:
            []
    };

    const bucket = {};

    if (
        !settings.disableExists
    ) {
        bucket.exists =
            async function () {
                state.existsCalls +=
                    1;

                if (
                    settings.error
                ) {
                    throw settings.error;
                }

                return [
                    true
                ];
            };
    }

    if (
        !settings.disableMetadata
    ) {
        bucket.getMetadata =
            async function () {
                state.metadataCalls +=
                    1;

                if (
                    settings.error
                ) {
                    throw settings.error;
                }

                return [
                    {
                        name:
                            "test-bucket"
                    }
                ];
            };
    }

    if (
        !settings.disableGetFiles
    ) {
        bucket.getFiles =
            async function (input) {
                state
                    .getFilesCalls
                    .push(input);

                if (
                    settings.error
                ) {
                    throw settings.error;
                }

                return [
                    []
                ];
            };
    }

    const storage = {
        bucket:
            function () {
                return bucket;
            }
    };

    return {
        storage,
        bucket,
        state
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

    const auth =
        settings.auth ||
        createAuthStub();

    const storage =
        settings.storage ||
        createStorageStub();

    return {
        db:
            firestore.db,

        auth:
            auth.auth,

        storage:
            storage.storage,

        bucket:
            storage.bucket,

        configuration:
            settings.configuration ||
            createConfiguration(),

        isEmulator:
            settings.isEmulator !==
            undefined
                ? settings.isEmulator
                : true,

        now:
            settings.now ||
            Date.now
    };
}

function createResponseStub() {
    const state = {
        statusCode:
            null,

        body:
            null
    };

    const response = {
        status:
            function (statusCode) {
                state.statusCode =
                    statusCode;

                return response;
            },

        json:
            function (body) {
                state.body =
                    body;

                return response;
            }
    };

    return {
        response,
        state
    };
}

/* ==========================================================
   SERVICE FACTORY
========================================================== */

test(
    "createHealthService creates a frozen service",
    function () {
        const runtime =
            createRuntime();

        const service =
            createHealthService({
                runtime,
                timeoutMs:
                    2500
            });

        assert.equal(
            service.runtime,
            runtime
        );

        assert.equal(
            service.timeoutMs,
            2500
        );

        assert.equal(
            typeof service.liveness,
            "function"
        );

        assert.equal(
            typeof service.readiness,
            "function"
        );

        assert.equal(
            typeof service.firestore,
            "function"
        );

        assert.equal(
            typeof service.auth,
            "function"
        );

        assert.equal(
            typeof service.storage,
            "function"
        );

        assert.equal(
            Object.isFrozen(service),
            true
        );
    }
);

test(
    "createHealthService uses default timeout",
    function () {
        const service =
            createHealthService({
                runtime:
                    createRuntime()
            });

        assert.equal(
            service.timeoutMs,
            constants.DEFAULT_TIMEOUT_MS
        );
    }
);

/* ==========================================================
   LIVENESS
========================================================== */

test(
    "checkLiveness reports healthy process state",
    function () {
        const runtime =
            createRuntime({
                now:
                    function () {
                        return Date.parse(
                            "2026-07-20T09:00:00.000Z"
                        );
                    }
            });

        const result =
            checkLiveness(
                runtime,
                {
                    uptimeSeconds:
                        120
                }
            );

        assert.deepEqual(
            result,
            {
                status:
                    "healthy",

                healthy:
                    true,

                type:
                    "liveness",

                timestamp:
                    "2026-07-20T09:00:00.000Z",

                uptimeSeconds:
                    120,

                service:
                    "L'ÉTERNEL",

                environment:
                    "test"
            }
        );
    }
);

test(
    "checkLiveness supports custom service name",
    function () {
        const result =
            checkLiveness(
                createRuntime({
                    now:
                        function () {
                            return 1000;
                        }
                }),
                {
                    serviceName:
                        "L'ÉTERNEL API",

                    uptimeSeconds:
                        10
                }
            );

        assert.equal(
            result.service,
            "L'ÉTERNEL API"
        );
    }
);

/* ==========================================================
   FIRESTORE HEALTH
========================================================== */

test(
    "checkFirestore reports healthy Firestore",
    async function () {
        let now =
            1000;

        const firestore =
            createFirestoreStub();

        const runtime =
            createRuntime({
                firestore,

                now:
                    function () {
                        const current =
                            now;

                        now +=
                            15;

                        return current;
                    }
            });

        const result =
            await checkFirestore(
                runtime
            );

        assert.equal(
            result.name,
            "firestore"
        );

        assert.equal(
            result.status,
            "healthy"
        );

        assert.equal(
            result.healthy,
            true
        );

        assert.equal(
            result.durationMs,
            15
        );

        assert.deepEqual(
            firestore
                .state
                .requestedDocuments,
            [
                "_health/runtime"
            ]
        );
    }
);

test(
    "checkFirestore supports custom check functions",
    async function () {
        const runtime =
            createRuntime();

        let receivedDatabase;
        let receivedRuntime;

        const result =
            await checkFirestore(
                runtime,
                {
                    firestoreCheck:
                        async function (
                            db,
                            source
                        ) {
                            receivedDatabase =
                                db;

                            receivedRuntime =
                                source;
                        }
                }
            );

        assert.equal(
            receivedDatabase,
            runtime.db
        );

        assert.equal(
            receivedRuntime,
            runtime
        );

        assert.equal(
            result.healthy,
            true
        );
    }
);

test(
    "checkFirestore reports unavailable Firestore",
    async function () {
        const result =
            await checkFirestore({
                db:
                    null,

                now:
                    function () {
                        return 1000;
                    }
            });

        assert.equal(
            result.healthy,
            false
        );

        assert.equal(
            result.error.code,
            "health/firestore-unavailable"
        );
    }
);

test(
    "checkFirestore reports read failures",
    async function () {
        const error =
            new Error(
                "Firestore unavailable."
            );

        error.code =
            "firestore/unavailable";

        const result =
            await checkFirestore(
                createRuntime({
                    firestore:
                        createFirestoreStub({
                            error
                        })
                })
            );

        assert.equal(
            result.healthy,
            false
        );

        assert.equal(
            result.error.code,
            "firestore/unavailable"
        );

        assert.equal(
            result.error.message,
            "Firestore unavailable."
        );
    }
);

test(
    "performFirestoreCheck falls back to collection query",
    async function () {
        const firestore =
            createFirestoreStub({
                disableDoc:
                    true
            });

        await performFirestoreCheck({
            db:
                firestore.db
        });

        assert.deepEqual(
            firestore
                .state
                .requestedCollections,
            [
                "_health"
            ]
        );
    }
);

test(
    "performFirestoreCheck rejects unsupported Firestore clients",
    async function () {
        await assert.rejects(
            async function () {
                await performFirestoreCheck({
                    db:
                        {}
                });
            },
            function (error) {
                assert.equal(
                    error instanceof
                        ServiceError,
                    true
                );

                assert.equal(
                    error.details
                        .healthCode,
                    "health/firestore-unsupported"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   AUTH HEALTH
========================================================== */

test(
    "checkAuth reports healthy Auth",
    async function () {
        const auth =
            createAuthStub();

        const result =
            await checkAuth(
                createRuntime({
                    auth
                })
            );

        assert.equal(
            result.healthy,
            true
        );

        assert.deepEqual(
            auth.state
                .listUsersCalls,
            [
                1
            ]
        );
    }
);

test(
    "checkAuth supports custom check functions",
    async function () {
        const runtime =
            createRuntime();

        let receivedAuth;
        let receivedRuntime;

        const result =
            await checkAuth(
                runtime,
                {
                    authCheck:
                        async function (
                            auth,
                            source
                        ) {
                            receivedAuth =
                                auth;

                            receivedRuntime =
                                source;
                        }
                }
            );

        assert.equal(
            receivedAuth,
            runtime.auth
        );

        assert.equal(
            receivedRuntime,
            runtime
        );

        assert.equal(
            result.healthy,
            true
        );
    }
);

test(
    "checkAuth reports unavailable Auth",
    async function () {
        const result =
            await checkAuth({
                auth:
                    null,

                now:
                    function () {
                        return 1000;
                    }
            });

        assert.equal(
            result.healthy,
            false
        );

        assert.equal(
            result.error.code,
            "health/auth-unavailable"
        );
    }
);

test(
    "performAuthCheck falls back to getUser",
    async function () {
        const notFoundError =
            new Error(
                "User not found."
            );

        notFoundError.code =
            "auth/user-not-found";

        const auth =
            createAuthStub({
                disableListUsers:
                    true,

                getUserError:
                    notFoundError
            });

        await performAuthCheck({
            auth:
                auth.auth
        });

        assert.deepEqual(
            auth.state
                .getUserCalls,
            [
                "__health_check__"
            ]
        );
    }
);

test(
    "performAuthCheck rethrows unexpected getUser errors",
    async function () {
        const error =
            new Error(
                "Auth unavailable."
            );

        error.code =
            "auth/internal-error";

        const auth =
            createAuthStub({
                disableListUsers:
                    true,

                getUserError:
                    error
            });

        await assert.rejects(
            async function () {
                await performAuthCheck({
                    auth:
                        auth.auth
                });
            },
            error
        );
    }
);

test(
    "performAuthCheck rejects unsupported Auth clients",
    async function () {
        await assert.rejects(
            async function () {
                await performAuthCheck({
                    auth:
                        {}
                });
            },
            function (error) {
                assert.equal(
                    error.details
                        .healthCode,
                    "health/auth-unsupported"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   STORAGE HEALTH
========================================================== */

test(
    "checkStorage reports healthy Storage",
    async function () {
        const storage =
            createStorageStub();

        const result =
            await checkStorage(
                createRuntime({
                    storage
                })
            );

        assert.equal(
            result.healthy,
            true
        );

        assert.equal(
            storage.state
                .existsCalls,
            1
        );
    }
);

test(
    "checkStorage supports custom checks",
    async function () {
        const runtime =
            createRuntime();

        let receivedStorage;
        let receivedRuntime;

        const result =
            await checkStorage(
                runtime,
                {
                    storageCheck:
                        async function (
                            storage,
                            source
                        ) {
                            receivedStorage =
                                storage;

                            receivedRuntime =
                                source;
                        }
                }
            );

        assert.equal(
            receivedStorage,
            runtime.bucket
        );

        assert.equal(
            receivedRuntime,
            runtime
        );

        assert.equal(
            result.healthy,
            true
        );
    }
);

test(
    "checkStorage skips optional unavailable Storage",
    async function () {
        const result =
            await checkStorage(
                {
                    storage:
                        null,

                    bucket:
                        null,

                    now:
                        function () {
                            return 1000;
                        }
                },
                {
                    storageRequired:
                        false
                }
            );

        assert.equal(
            result.skipped,
            true
        );

        assert.equal(
            result.healthy,
            true
        );

        assert.equal(
            result.status,
            "skipped"
        );
    }
);

test(
    "checkStorage reports required unavailable Storage",
    async function () {
        const result =
            await checkStorage({
                storage:
                    null,

                bucket:
                    null,

                now:
                    function () {
                        return 1000;
                    }
            });

        assert.equal(
            result.healthy,
            false
        );

        assert.equal(
            result.error.code,
            "health/storage-unavailable"
        );
    }
);

test(
    "performStorageCheck falls back to bucket metadata",
    async function () {
        const storage =
            createStorageStub({
                disableExists:
                    true
            });

        await performStorageCheck({
            bucket:
                storage.bucket
        });

        assert.equal(
            storage.state
                .metadataCalls,
            1
        );
    }
);

test(
    "performStorageCheck falls back to listing files",
    async function () {
        const storage =
            createStorageStub({
                disableExists:
                    true,

                disableMetadata:
                    true
            });

        await performStorageCheck({
            bucket:
                storage.bucket
        });

        assert.deepEqual(
            storage.state
                .getFilesCalls,
            [
                {
                    maxResults:
                        1
                }
            ]
        );
    }
);

test(
    "performStorageCheck resolves bucket from storage service",
    async function () {
        const storage =
            createStorageStub();

        await performStorageCheck({
            bucket:
                null,

            storage:
                storage.storage
        });

        assert.equal(
            storage.state
                .existsCalls,
            1
        );
    }
);

test(
    "performStorageCheck rejects missing buckets",
    async function () {
        await assert.rejects(
            async function () {
                await performStorageCheck({
                    storage:
                        null,

                    bucket:
                        null
                });
            },
            function (error) {
                assert.equal(
                    error.details
                        .healthCode,
                    "health/storage-bucket-unavailable"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   CHECK EXECUTION
========================================================== */

test(
    "executeHealthCheck returns completed result",
    async function () {
        const result =
            await executeHealthCheck(
                "firestore",
                async function () {
                    return {
                        name:
                            "firestore",

                        status:
                            "healthy",

                        healthy:
                            true,

                        skipped:
                            false,

                        durationMs:
                            5
                    };
                },
                100
            );

        assert.equal(
            result.healthy,
            true
        );
    }
);

test(
    "executeHealthCheck converts thrown errors",
    async function () {
        const result =
            await executeHealthCheck(
                "auth",
                async function () {
                    const error =
                        new Error(
                            "Auth failed."
                        );

                    error.code =
                        "auth/internal-error";

                    throw error;
                },
                100
            );

        assert.equal(
            result.healthy,
            false
        );

        assert.equal(
            result.error.code,
            "auth/internal-error"
        );

        assert.equal(
            result.error.message,
            "Auth failed."
        );
    }
);

test(
    "executeHealthCheck converts timeouts",
    async function () {
        const result =
            await executeHealthCheck(
                "storage",
                async function () {
                    await new Promise(
                        function (resolve) {
                            setTimeout(
                                resolve,
                                30
                            );
                        }
                    );
                },
                5
            );

        assert.equal(
            result.healthy,
            false
        );

        assert.equal(
            result.error.code,
            "health/check-timeout"
        );

        assert.equal(
            result.durationMs,
            5
        );
    }
);

/* ==========================================================
   READINESS
========================================================== */

test(
    "checkReadiness reports healthy services",
    async function () {
        let now =
            1000;

        const result =
            await checkReadiness(
                createRuntime({
                    now:
                        function () {
                            const current =
                                now;

                            now +=
                                10;

                            return current;
                        }
                }),
                {
                    timeoutMs:
                        100
                }
            );

        assert.equal(
            result.status,
            "healthy"
        );

        assert.equal(
            result.healthy,
            true
        );

        assert.equal(
            result.type,
            "readiness"
        );

        assert.equal(
            result.checks
                .firestore
                .healthy,
            true
        );

        assert.equal(
            result.checks
                .auth
                .healthy,
            true
        );

        assert.equal(
            result.checks
                .storage
                .healthy,
            true
        );

        assert.equal(
            result.runtime.projectId,
            "leternel-health-test"
        );
    }
);

test(
    "checkReadiness supports selected checks",
    async function () {
        const result =
            await checkReadiness(
                createRuntime(),
                {
                    checks: [
                        "firestore"
                    ],

                    timeoutMs:
                        100
                }
            );

        assert.equal(
            result.checks
                .firestore
                .healthy,
            true
        );

        assert.equal(
            result.checks
                .auth
                .skipped,
            true
        );

        assert.equal(
            result.checks
                .storage
                .skipped,
            true
        );
    }
);

test(
    "checkReadiness reports unhealthy critical failures",
    async function () {
        const firestoreError =
            new Error(
                "Firestore failed."
            );

        const result =
            await checkReadiness(
                createRuntime({
                    firestore:
                        createFirestoreStub({
                            error:
                                firestoreError
                        })
                }),
                {
                    timeoutMs:
                        100
                }
            );

        assert.equal(
            result.status,
            "unhealthy"
        );

        assert.equal(
            result.healthy,
            false
        );
    }
);

test(
    "checkReadiness reports degraded non-critical failures",
    async function () {
        const storageError =
            new Error(
                "Storage failed."
            );

        const result =
            await checkReadiness(
                createRuntime({
                    storage:
                        createStorageStub({
                            error:
                                storageError
                        })
                }),
                {
                    timeoutMs:
                        100,

                    criticalChecks: [
                        "firestore",
                        "auth"
                    ]
                }
            );

        assert.equal(
            result.status,
            "degraded"
        );

        assert.equal(
            result.healthy,
            false
        );
    }
);

/* ==========================================================
   STATUS RESOLUTION
========================================================== */

test(
    "resolveOverallStatus returns healthy for successful checks",
    function () {
        const checks = {
            firestore:
                createHealthyCheck(
                    "firestore",
                    0,
                    5
                ),

            auth:
                createHealthyCheck(
                    "auth",
                    0,
                    5
                )
        };

        assert.equal(
            resolveOverallStatus(
                checks
            ),
            "healthy"
        );
    }
);

test(
    "resolveOverallStatus returns unhealthy for critical failures",
    function () {
        const checks = {
            firestore:
                createFailedCheck(
                    "firestore",
                    "Failure.",
                    0,
                    5
                ),

            storage:
                createHealthyCheck(
                    "storage",
                    0,
                    5
                )
        };

        assert.equal(
            resolveOverallStatus(
                checks
            ),
            "unhealthy"
        );
    }
);

test(
    "resolveOverallStatus returns degraded for non-critical failures",
    function () {
        const checks = {
            firestore:
                createHealthyCheck(
                    "firestore",
                    0,
                    5
                ),

            auth:
                createHealthyCheck(
                    "auth",
                    0,
                    5
                ),

            storage:
                createFailedCheck(
                    "storage",
                    "Failure.",
                    0,
                    5
                )
        };

        assert.equal(
            resolveOverallStatus(
                checks
            ),
            "degraded"
        );
    }
);

test(
    "resolveOverallStatus ignores skipped checks",
    function () {
        assert.equal(
            resolveOverallStatus({
                firestore:
                    createSkippedCheck(
                        "firestore"
                    )
            }),
            "healthy"
        );
    }
);

/* ==========================================================
   CHECK FACTORIES
========================================================== */

test(
    "createPendingCheck creates pending state",
    function () {
        assert.deepEqual(
            createPendingCheck(
                "firestore"
            ),
            {
                name:
                    "firestore",

                status:
                    "pending",

                healthy:
                    false,

                skipped:
                    false,

                durationMs:
                    0
            }
        );
    }
);

test(
    "createHealthyCheck calculates duration",
    function () {
        assert.deepEqual(
            createHealthyCheck(
                "auth",
                100,
                125
            ),
            {
                name:
                    "auth",

                status:
                    "healthy",

                healthy:
                    true,

                skipped:
                    false,

                durationMs:
                    25
            }
        );
    }
);

test(
    "createFailedCheck creates structured failure",
    function () {
        assert.deepEqual(
            createFailedCheck(
                "storage",
                "Storage failed.",
                100,
                150,
                "storage/error"
            ),
            {
                name:
                    "storage",

                status:
                    "unhealthy",

                healthy:
                    false,

                skipped:
                    false,

                durationMs:
                    50,

                error: {
                    code:
                        "storage/error",

                    message:
                        "Storage failed."
                }
            }
        );
    }
);

test(
    "createSkippedCheck creates skipped state",
    function () {
        assert.deepEqual(
            createSkippedCheck(
                "storage",
                "Storage disabled."
            ),
            {
                name:
                    "storage",

                status:
                    "skipped",

                healthy:
                    true,

                skipped:
                    true,

                durationMs:
                    0,

                reason:
                    "Storage disabled."
            }
        );
    }
);

/* ==========================================================
   OPTION NORMALIZATION
========================================================== */

test(
    "resolveSelectedChecks normalizes and deduplicates checks",
    function () {
        assert.deepEqual(
            resolveSelectedChecks({
                checks: [
                    " Firestore ",
                    "AUTH",
                    "firestore"
                ]
            }),
            [
                "firestore",
                "auth"
            ]
        );
    }
);

test(
    "resolveSelectedChecks returns default checks",
    function () {
        assert.deepEqual(
            resolveSelectedChecks(
                {}
            ),
            [
                "firestore",
                "auth",
                "storage"
            ]
        );
    }
);

test(
    "resolveSelectedChecks rejects invalid input",
    function () {
        assert.throws(
            function () {
                resolveSelectedChecks({
                    checks:
                        "firestore"
                });
            },
            /provided as an array/
        );
    }
);

test(
    "resolveSelectedChecks rejects unsupported checks",
    function () {
        assert.throws(
            function () {
                resolveSelectedChecks({
                    checks: [
                        "database"
                    ]
                });
            },
            /Unsupported health check/
        );
    }
);

test(
    "normalizeTimeout accepts positive integers",
    function () {
        assert.equal(
            normalizeTimeout(
                5000
            ),
            5000
        );

        assert.equal(
            normalizeTimeout(
                "2500"
            ),
            2500
        );
    }
);

test(
    "normalizeTimeout rejects invalid values",
    function () {
        assert.throws(
            function () {
                normalizeTimeout(
                    0
                );
            },
            /positive integer/
        );

        assert.throws(
            function () {
                normalizeTimeout(
                    10.5
                );
            },
            /positive integer/
        );
    }
);

test(
    "normalizeUptime supports supplied values",
    function () {
        assert.equal(
            normalizeUptime(
                120
            ),
            120
        );

        assert.equal(
            normalizeUptime(
                -5
            ),
            0
        );

        assert.equal(
            normalizeUptime(
                "invalid"
            ),
            0
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
    "resolveNow falls back to runtime clock",
    function () {
        assert.equal(
            resolveNow(
                {
                    now:
                        function () {
                            return 1000;
                        }
                },
                {}
            ),
            1000
        );
    }
);

test(
    "resolveServiceName uses configured store name",
    function () {
        assert.equal(
            resolveServiceName(
                createRuntime(),
                {}
            ),
            "L'ÉTERNEL"
        );
    }
);

test(
    "resolveServiceName supports explicit override",
    function () {
        assert.equal(
            resolveServiceName(
                createRuntime(),
                {
                    serviceName:
                        "Store API"
                }
            ),
            "Store API"
        );
    }
);

/* ==========================================================
   RUNTIME SANITIZATION
========================================================== */

test(
    "sanitizeRuntimeHealth preserves safe runtime information",
    function () {
        const result =
            sanitizeRuntimeHealth({
                projectId:
                    "leternel-test",

                region:
                    "europe-west1",

                environment:
                    "test",

                emulator:
                    true,

                services: {
                    firestore:
                        true,

                    auth:
                        true,

                    storage:
                        false
                },

                paymentProvider:
                    "paystack",

                emailProvider:
                    "resend",

                secret:
                    "hidden"
            });

        assert.deepEqual(
            result,
            {
                projectId:
                    "leternel-test",

                region:
                    "europe-west1",

                environment:
                    "test",

                emulator:
                    true,

                services: {
                    firestore:
                        true,

                    auth:
                        true,

                    storage:
                        false
                },

                paymentProvider:
                    "paystack",

                emailProvider:
                    "resend"
            }
        );
    }
);

/* ==========================================================
   ERRORS
========================================================== */

test(
    "createHealthError creates hidden retryable errors",
    function () {
        const error =
            createHealthError(
                "health/test",
                "Health check failed.",
                {
                    service:
                        "firestore"
                }
            );

        assert.equal(
            error instanceof
                ServiceError,
            true
        );

        assert.equal(
            error.code,
            "unavailable"
        );

        assert.equal(
            error.status,
            503
        );

        assert.equal(
            error.expose,
            false
        );

        assert.equal(
            error.retryable,
            true
        );

        assert.deepEqual(
            error.details,
            {
                healthCode:
                    "health/test",

                service:
                    "firestore"
            }
        );
    }
);

/* ==========================================================
   HTTP HANDLERS
========================================================== */

test(
    "handleLivenessRequest writes successful response",
    async function () {
        const response =
            createResponseStub();

        const service = {
            liveness:
                function () {
                    return {
                        status:
                            "healthy",

                        healthy:
                            true
                    };
                }
        };

        const result =
            await handleLivenessRequest(
                {},
                response.response,
                {
                    service
                }
            );

        assert.equal(
            result,
            response.response
        );

        assert.equal(
            response.state
                .statusCode,
            200
        );

        assert.deepEqual(
            response.state.body,
            {
                status:
                    "healthy",

                healthy:
                    true
            }
        );
    }
);

test(
    "handleLivenessRequest returns result without response",
    async function () {
        const result =
            await handleLivenessRequest(
                {},
                null,
                {
                    service: {
                        liveness:
                            function () {
                                return {
                                    status:
                                        "healthy"
                                };
                            }
                    }
                }
            );

        assert.deepEqual(
            result,
            {
                status:
                    "healthy"
            }
        );
    }
);

test(
    "handleReadinessRequest writes HTTP 200 for healthy state",
    async function () {
        const response =
            createResponseStub();

        await handleReadinessRequest(
            {},
            response.response,
            {
                service: {
                    readiness:
                        async function () {
                            return {
                                status:
                                    "healthy",

                                healthy:
                                    true
                            };
                        }
                }
            }
        );

        assert.equal(
            response.state
                .statusCode,
            200
        );
    }
);

test(
    "handleReadinessRequest writes HTTP 200 for degraded state",
    async function () {
        const response =
            createResponseStub();

        await handleReadinessRequest(
            {},
            response.response,
            {
                service: {
                    readiness:
                        async function () {
                            return {
                                status:
                                    "degraded",

                                healthy:
                                    false
                            };
                        }
                }
            }
        );

        assert.equal(
            response.state
                .statusCode,
            200
        );
    }
);

test(
    "handleReadinessRequest writes HTTP 503 for unhealthy state",
    async function () {
        const response =
            createResponseStub();

        await handleReadinessRequest(
            {},
            response.response,
            {
                service: {
                    readiness:
                        async function () {
                            return {
                                status:
                                    "unhealthy",

                                healthy:
                                    false
                            };
                        }
                }
            }
        );

        assert.equal(
            response.state
                .statusCode,
            503
        );
    }
);

/* ==========================================================
   CONSTANTS
========================================================== */

test(
    "health constants expose expected defaults",
    function () {
        assert.equal(
            constants.DEFAULT_TIMEOUT_MS,
            5000
        );

        assert.equal(
            constants.DEFAULT_HEALTH_DOCUMENT,
            "_health/runtime"
        );

        assert.deepEqual(
            constants.HEALTH_STATUSES,
            {
                healthy:
                    "healthy",

                degraded:
                    "degraded",

                unhealthy:
                    "unhealthy"
            }
        );
    }
);