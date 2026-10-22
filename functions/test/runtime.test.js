"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   RUNTIME TEST SUITE
========================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createRuntime,
    getRuntime,
    resetRuntime,
    createServiceDependencies,
    createTestRuntime,
    createInitializationOptions,
    resolveFirestore,
    resolveAuth,
    resolveStorage,
    resolveFieldValue,
    resolveTimestamp,
    detectEmulatorEnvironment,
    getEmulatorHosts,
    runTransaction,
    createBatch,
    serverTimestamp,
    createTimestamp,
    getRuntimeHealth,
    createRuntimeError
} = require(
    "../src/shared/runtime"
);

const {
    loadConfiguration
} = require(
    "../src/shared/configuration"
);

const {
    createFirestoreHarness,
    createAuthHarness,
    FieldValue,
    TestTimestamp
} = require(
    "./helpers"
);

/* ==========================================================
   TEST HELPERS
========================================================== */

function createEnvironment(
    overrides
) {
    return Object.assign(
        {
            NODE_ENV:
                "test",

            FIREBASE_PROJECT_ID:
                "leternel-runtime-test",

            FUNCTIONS_REGION:
                "europe-west1",

            APP_ORIGIN:
                "https://shop.example.com",

            ALLOWED_ORIGINS:
                "https://shop.example.com",

            STORE_NAME:
                "L'ÉTERNEL",

            DEFAULT_CURRENCY:
                "NGN",

            DEFAULT_LOCALE:
                "en-NG",

            SUPPORT_EMAIL:
                "support@example.com",

            ORDER_EMAIL:
                "orders@example.com",

            PAYMENT_PROVIDER:
                "paystack",

            PAYSTACK_SECRET_KEY:
                "sk_test_runtime",

            PAYSTACK_WEBHOOK_SECRET:
                "paystack-webhook-secret",

            EMAIL_PROVIDER:
                "resend",

            EMAIL_FROM:
                "orders@example.com",

            EMAIL_REPLY_TO:
                "support@example.com",

            RESEND_API_KEY:
                "re_test_runtime"
        },
        overrides || {}
    );
}

function createConfiguration(
    overrides
) {
    return loadConfiguration(
        createEnvironment(
            overrides
        )
    );
}

function createLoggerStub() {
    return {
        debug:
            function () {},

        info:
            function () {},

        warn:
            function () {},

        error:
            function () {},

        child:
            function () {
                return this;
            }
    };
}

function createStorageStub() {
    const bucket = {
        name:
            "test-bucket",

        file:
            function (path) {
                return {
                    path:
                        path
                };
            }
    };

    return {
        bucket:
            function () {
                return bucket;
            }
    };
}

function createAdminAppStub(
    services
) {
    const source =
        services || {};

    return {
        firestore:
            function () {
                return source.db;
            },

        auth:
            function () {
                return source.auth;
            },

        storage:
            function () {
                return source.storage;
            }
    };
}

/* ==========================================================
   INITIALIZATION OPTIONS
========================================================== */

test(
    "createInitializationOptions includes configured project ID",
    function () {
        const options =
            createInitializationOptions({
                configuration: {
                    projectId:
                        "leternel-test"
                }
            });

        assert.deepEqual(
            options,
            {
                projectId:
                    "leternel-test"
            }
        );
    }
);

test(
    "createInitializationOptions includes optional Firebase settings",
    function () {
        const credential = {
            type:
                "test-credential"
        };

        const options =
            createInitializationOptions({
                configuration: {
                    projectId:
                        "leternel-test"
                },

                storageBucket:
                    "leternel-test.appspot.com",

                databaseURL:
                    "https://leternel-test.firebaseio.com",

                credential:
                    credential
            });

        assert.deepEqual(
            options,
            {
                projectId:
                    "leternel-test",

                storageBucket:
                    "leternel-test.appspot.com",

                databaseURL:
                    "https://leternel-test.firebaseio.com",

                credential:
                    credential
            }
        );
    }
);

test(
    "createInitializationOptions omits unavailable values",
    function () {
        assert.deepEqual(
            createInitializationOptions(
                {}
            ),
            {}
        );
    }
);

/* ==========================================================
   SERVICE RESOLUTION
========================================================== */

test(
    "resolveFirestore uses app-scoped Firestore",
    function () {
        const db = {
            name:
                "firestore"
        };

        const app =
            createAdminAppStub({
                db:
                    db
            });

        assert.equal(
            resolveFirestore(app),
            db
        );
    }
);

test(
    "resolveAuth uses app-scoped Auth",
    function () {
        const auth = {
            name:
                "auth"
        };

        const app =
            createAdminAppStub({
                auth:
                    auth
            });

        assert.equal(
            resolveAuth(app),
            auth
        );
    }
);

test(
    "resolveStorage uses app-scoped Storage",
    function () {
        const storage =
            createStorageStub();

        const app =
            createAdminAppStub({
                storage:
                    storage
            });

        assert.equal(
            resolveStorage(
                app,
                {}
            ),
            storage
        );
    }
);

test(
    "resolveStorage returns null when disabled",
    function () {
        assert.equal(
            resolveStorage(
                null,
                {
                    disableStorage:
                        true
                }
            ),
            null
        );
    }
);

test(
    "resolveFieldValue uses an injected implementation",
    function () {
        assert.equal(
            resolveFieldValue({
                FieldValue:
                    FieldValue
            }),
            FieldValue
        );
    }
);

test(
    "resolveTimestamp uses an injected implementation",
    function () {
        assert.equal(
            resolveTimestamp({
                Timestamp:
                    TestTimestamp
            }),
            TestTimestamp
        );
    }
);

/* ==========================================================
   RUNTIME FACTORY
========================================================== */

test(
    "createRuntime creates a complete injected runtime",
    function () {
        const firestoreHarness =
            createFirestoreHarness();

        const authHarness =
            createAuthHarness();

        const storage =
            createStorageStub();

        const logger =
            createLoggerStub();

        const configuration =
            createConfiguration();

        const runtime =
            createRuntime({
                configuration:
                    configuration,

                db:
                    firestoreHarness.db,

                auth:
                    authHarness.auth,

                storage:
                    storage,

                FieldValue:
                    FieldValue,

                Timestamp:
                    TestTimestamp,

                logger:
                    logger,

                now:
                    function () {
                        return 12345;
                    },

                validateConfiguration:
                    false
            });

        assert.equal(
            runtime.db,
            firestoreHarness.db
        );

        assert.equal(
            runtime.firestore,
            firestoreHarness.db
        );

        assert.equal(
            runtime.auth,
            authHarness.auth
        );

        assert.equal(
            runtime.storage,
            storage
        );

        assert.equal(
            runtime.bucket.name,
            "test-bucket"
        );

        assert.equal(
            runtime.FieldValue,
            FieldValue
        );

        assert.equal(
            runtime.Timestamp,
            TestTimestamp
        );

        assert.equal(
            runtime.configuration,
            configuration
        );

        assert.equal(
            runtime.logger,
            logger
        );

        assert.equal(
            runtime.now(),
            12345
        );

        assert.equal(
            Object.isFrozen(
                runtime
            ),
            true
        );
    }
);

test(
    "createRuntime resolves services from an injected admin app",
    function () {
        const firestoreHarness =
            createFirestoreHarness();

        const authHarness =
            createAuthHarness();

        const storage =
            createStorageStub();

        const app =
            createAdminAppStub({
                db:
                    firestoreHarness.db,

                auth:
                    authHarness.auth,

                storage:
                    storage
            });

        const runtime =
            createRuntime({
                configuration:
                    createConfiguration(),

                adminApp:
                    app,

                FieldValue:
                    FieldValue,

                Timestamp:
                    TestTimestamp,

                logger:
                    createLoggerStub(),

                validateConfiguration:
                    false
            });

        assert.equal(
            runtime.app,
            app
        );

        assert.equal(
            runtime.db,
            firestoreHarness.db
        );

        assert.equal(
            runtime.auth,
            authHarness.auth
        );

        assert.equal(
            runtime.storage,
            storage
        );
    }
);

test(
    "createRuntime validates configuration by default",
    function () {
        const environment =
            createEnvironment();

        delete environment
            .PAYSTACK_SECRET_KEY;

        delete environment
            .PAYSTACK_WEBHOOK_SECRET;

        const configuration =
            loadConfiguration(
                environment
            );

        assert.throws(
            function () {
                createRuntime({
                    configuration:
                        configuration,

                    db:
                        createFirestoreHarness()
                            .db,

                    auth:
                        createAuthHarness()
                            .auth,

                    FieldValue:
                        FieldValue,

                    Timestamp:
                        TestTimestamp,

                    logger:
                        createLoggerStub()
                });
            },
            /PAYSTACK_SECRET_KEY/
        );
    }
);

test(
    "createRuntime can skip provider-secret validation",
    function () {
        const environment =
            createEnvironment();

        delete environment
            .PAYSTACK_SECRET_KEY;

        delete environment
            .PAYSTACK_WEBHOOK_SECRET;

        delete environment
            .RESEND_API_KEY;

        const runtime =
            createRuntime({
                configuration:
                    loadConfiguration(
                        environment
                    ),

                db:
                    createFirestoreHarness()
                        .db,

                auth:
                    createAuthHarness()
                        .auth,

                FieldValue:
                    FieldValue,

                Timestamp:
                    TestTimestamp,

                logger:
                    createLoggerStub(),

                requireProviderSecrets:
                    false
            });

        assert.ok(runtime);
    }
);

test(
    "createRuntime detects emulator configuration",
    function () {
        const runtime =
            createRuntime({
                configuration:
                    createConfiguration(),

                environment: {
                    FIRESTORE_EMULATOR_HOST:
                        "127.0.0.1:8080"
                },

                db:
                    createFirestoreHarness()
                        .db,

                auth:
                    createAuthHarness()
                        .auth,

                FieldValue:
                    FieldValue,

                Timestamp:
                    TestTimestamp,

                logger:
                    createLoggerStub(),

                validateConfiguration:
                    false
            });

        assert.equal(
            runtime.isEmulator,
            true
        );
    }
);

/* ==========================================================
   TEST RUNTIME
========================================================== */

test(
    "createTestRuntime creates an isolated runtime",
    function () {
        const firestoreHarness =
            createFirestoreHarness();

        const authHarness =
            createAuthHarness();

        const runtime =
            createTestRuntime({
                configuration:
                    createConfiguration(),

                db:
                    firestoreHarness.db,

                auth:
                    authHarness.auth,

                FieldValue:
                    FieldValue,

                Timestamp:
                    TestTimestamp,

                logger:
                    createLoggerStub(),

                now:
                    function () {
                        return 1000;
                    }
            });

        assert.equal(
            runtime.db,
            firestoreHarness.db
        );

        assert.equal(
            runtime.auth,
            authHarness.auth
        );

        assert.equal(
            runtime.storage,
            null
        );

        assert.equal(
            runtime.bucket,
            null
        );

        assert.equal(
            runtime.now(),
            1000
        );
    }
);

test(
    "createTestRuntime requires Firestore",
    function () {
        assert.throws(
            function () {
                createTestRuntime({
                    auth:
                        createAuthHarness()
                            .auth
                });
            },
            function (error) {
                assert.equal(
                    error.code,
                    "runtime/test-firestore-required"
                );

                return true;
            }
        );
    }
);

test(
    "createTestRuntime requires Auth",
    function () {
        assert.throws(
            function () {
                createTestRuntime({
                    db:
                        createFirestoreHarness()
                            .db
                });
            },
            function (error) {
                assert.equal(
                    error.code,
                    "runtime/test-auth-required"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   RUNTIME CACHE
========================================================== */

test(
    "getRuntime returns a cached runtime",
    function () {
        resetRuntime();

        const first =
            getRuntime({
                configuration:
                    createConfiguration(),

                db:
                    createFirestoreHarness()
                        .db,

                auth:
                    createAuthHarness()
                        .auth,

                FieldValue:
                    FieldValue,

                Timestamp:
                    TestTimestamp,

                logger:
                    createLoggerStub(),

                validateConfiguration:
                    false
            });

        const second =
            getRuntime({
                configuration:
                    createConfiguration(),

                db:
                    createFirestoreHarness()
                        .db,

                auth:
                    createAuthHarness()
                        .auth,

                FieldValue:
                    FieldValue,

                Timestamp:
                    TestTimestamp,

                logger:
                    createLoggerStub(),

                validateConfiguration:
                    false
            });

        assert.equal(
            first,
            second
        );

        resetRuntime();
    }
);

test(
    "getRuntime reloads when requested",
    function () {
        resetRuntime();

        const first =
            getRuntime({
                configuration:
                    createConfiguration(),

                db:
                    createFirestoreHarness()
                        .db,

                auth:
                    createAuthHarness()
                        .auth,

                FieldValue:
                    FieldValue,

                Timestamp:
                    TestTimestamp,

                logger:
                    createLoggerStub(),

                validateConfiguration:
                    false
            });

        const second =
            getRuntime({
                reload:
                    true,

                configuration:
                    createConfiguration(),

                db:
                    createFirestoreHarness()
                        .db,

                auth:
                    createAuthHarness()
                        .auth,

                FieldValue:
                    FieldValue,

                Timestamp:
                    TestTimestamp,

                logger:
                    createLoggerStub(),

                validateConfiguration:
                    false
            });

        assert.notEqual(
            first,
            second
        );

        resetRuntime();
    }
);

/* ==========================================================
   SERVICE DEPENDENCIES
========================================================== */

test(
    "createServiceDependencies maps runtime services",
    function () {
        const runtime =
            createTestRuntime({
                configuration:
                    createConfiguration(),

                db:
                    createFirestoreHarness()
                        .db,

                auth:
                    createAuthHarness()
                        .auth,

                FieldValue:
                    FieldValue,

                Timestamp:
                    TestTimestamp,

                logger:
                    createLoggerStub(),

                now:
                    function () {
                        return 123;
                    }
            });

        const dependencies =
            createServiceDependencies(
                runtime
            );

        assert.equal(
            dependencies.db,
            runtime.db
        );

        assert.equal(
            dependencies.firestore,
            runtime.firestore
        );

        assert.equal(
            dependencies.auth,
            runtime.auth
        );

        assert.equal(
            dependencies.FieldValue,
            FieldValue
        );

        assert.equal(
            dependencies.Timestamp,
            TestTimestamp
        );

        assert.equal(
            dependencies.configuration,
            runtime.configuration
        );

        assert.equal(
            dependencies.config,
            runtime.configuration
        );

        assert.equal(
            dependencies.logger,
            runtime.logger
        );

        assert.equal(
            dependencies.now(),
            123
        );
    }
);

test(
    "createServiceDependencies applies overrides",
    function () {
        const runtime =
            createTestRuntime({
                configuration:
                    createConfiguration(),

                db:
                    createFirestoreHarness()
                        .db,

                auth:
                    createAuthHarness()
                        .auth,

                FieldValue:
                    FieldValue,

                Timestamp:
                    TestTimestamp,

                logger:
                    createLoggerStub()
            });

        const customLogger =
            createLoggerStub();

        const dependencies =
            createServiceDependencies(
                runtime,
                {
                    logger:
                        customLogger,

                    requestId:
                        "request-1"
                }
            );

        assert.equal(
            dependencies.logger,
            customLogger
        );

        assert.equal(
            dependencies.requestId,
            "request-1"
        );
    }
);

/* ==========================================================
   EMULATOR HELPERS
========================================================== */

test(
    "detectEmulatorEnvironment detects supported emulator variables",
    function () {
        assert.equal(
            detectEmulatorEnvironment({
                FUNCTIONS_EMULATOR:
                    "true"
            }),
            true
        );

        assert.equal(
            detectEmulatorEnvironment({
                FIRESTORE_EMULATOR_HOST:
                    "127.0.0.1:8080"
            }),
            true
        );

        assert.equal(
            detectEmulatorEnvironment({
                FIREBASE_AUTH_EMULATOR_HOST:
                    "127.0.0.1:9099"
            }),
            true
        );

        assert.equal(
            detectEmulatorEnvironment({
                FIREBASE_STORAGE_EMULATOR_HOST:
                    "127.0.0.1:9199"
            }),
            true
        );

        assert.equal(
            detectEmulatorEnvironment({
                FUNCTIONS_EMULATOR_HOST:
                    "127.0.0.1:5001"
            }),
            true
        );
    }
);

test(
    "detectEmulatorEnvironment returns false without emulator variables",
    function () {
        assert.equal(
            detectEmulatorEnvironment(
                {}
            ),
            false
        );
    }
);

test(
    "getEmulatorHosts returns normalized emulator host map",
    function () {
        assert.deepEqual(
            getEmulatorHosts({
                FIRESTORE_EMULATOR_HOST:
                    "127.0.0.1:8080",

                FIREBASE_AUTH_EMULATOR_HOST:
                    "127.0.0.1:9099",

                FIREBASE_STORAGE_EMULATOR_HOST:
                    "127.0.0.1:9199",

                FUNCTIONS_EMULATOR_HOST:
                    "127.0.0.1:5001"
            }),
            {
                firestore:
                    "127.0.0.1:8080",

                auth:
                    "127.0.0.1:9099",

                storage:
                    "127.0.0.1:9199",

                functions:
                    "127.0.0.1:5001"
            }
        );
    }
);

test(
    "getEmulatorHosts returns empty strings for missing hosts",
    function () {
        assert.deepEqual(
            getEmulatorHosts(
                {}
            ),
            {
                firestore:
                    "",

                auth:
                    "",

                storage:
                    "",

                functions:
                    ""
            }
        );
    }
);

/* ==========================================================
   TRANSACTION AND BATCH HELPERS
========================================================== */

test(
    "runTransaction delegates to Firestore",
    async function () {
        const firestoreHarness =
            createFirestoreHarness({
                initialDocuments: {
                    "products/product-1": {
                        inventory:
                            3
                    }
                }
            });

        const runtime =
            createTestRuntime({
                configuration:
                    createConfiguration(),

                db:
                    firestoreHarness.db,

                auth:
                    createAuthHarness()
                        .auth,

                FieldValue:
                    FieldValue,

                Timestamp:
                    TestTimestamp,

                logger:
                    createLoggerStub()
            });

        const reference =
            runtime.db.doc(
                "products/product-1"
            );

        const result =
            await runTransaction(
                runtime,
                async function (
                    transaction
                ) {
                    const snapshot =
                        await transaction.get(
                            reference
                        );

                    transaction.update(
                        reference,
                        {
                            inventory:
                                snapshot
                                    .data()
                                    .inventory -
                                1
                        }
                    );

                    return "updated";
                }
            );

        assert.equal(
            result,
            "updated"
        );

        assert.equal(
            firestoreHarness
                .getDocument(
                    "products/product-1"
                )
                .inventory,
            2
        );
    }
);

test(
    "runTransaction rejects runtimes without transaction support",
    async function () {
        await assert.rejects(
            async function () {
                await runTransaction(
                    {
                        db:
                            {}
                    },
                    async function () {}
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "runtime/transactions-unavailable"
                );

                return true;
            }
        );
    }
);

test(
    "createBatch delegates to Firestore",
    async function () {
        const firestoreHarness =
            createFirestoreHarness();

        const runtime =
            createTestRuntime({
                configuration:
                    createConfiguration(),

                db:
                    firestoreHarness.db,

                auth:
                    createAuthHarness()
                        .auth,

                FieldValue:
                    FieldValue,

                Timestamp:
                    TestTimestamp,

                logger:
                    createLoggerStub()
            });

        const batch =
            createBatch(runtime);

        batch.set(
            runtime.db.doc(
                "products/product-1"
            ),
            {
                name:
                    "Signature Coat"
            }
        );

        await batch.commit();

        assert.equal(
            firestoreHarness
                .hasDocument(
                    "products/product-1"
                ),
            true
        );
    }
);

test(
    "createBatch rejects runtimes without batch support",
    function () {
        assert.throws(
            function () {
                createBatch({
                    db:
                        {}
                });
            },
            function (error) {
                assert.equal(
                    error.code,
                    "runtime/batches-unavailable"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   TIMESTAMP HELPERS
========================================================== */

test(
    "serverTimestamp uses runtime FieldValue",
    function () {
        const runtime = {
            FieldValue:
                FieldValue
        };

        const value =
            serverTimestamp(runtime);

        assert.equal(
            value.type,
            "serverTimestamp"
        );
    }
);

test(
    "createTimestamp uses Timestamp.now when no value is supplied",
    function () {
        const runtime = {
            Timestamp:
                TestTimestamp,

            now:
                function () {
                    return 1000;
                }
        };

        const timestamp =
            createTimestamp(
                undefined,
                runtime
            );

        assert.ok(
            timestamp instanceof
            TestTimestamp
        );

        assert.ok(
            Number.isFinite(
                timestamp.toMillis()
            )
        );
    }
);

test(
    "createTimestamp converts Date values",
    function () {
        const date =
            new Date(
                "2026-07-20T09:00:00.000Z"
            );

        const timestamp =
            createTimestamp(
                date,
                {
                    Timestamp:
                        TestTimestamp
                }
            );

        assert.equal(
            timestamp.toMillis(),
            date.getTime()
        );
    }
);

test(
    "createTimestamp converts timestamp-like values",
    function () {
        const source =
            TestTimestamp.fromMillis(
                5000
            );

        const timestamp =
            createTimestamp(
                source,
                {
                    Timestamp:
                        TestTimestamp
                }
            );

        assert.equal(
            timestamp.toMillis(),
            5000
        );
    }
);

test(
    "createTimestamp converts valid timestamp strings",
    function () {
        const timestamp =
            createTimestamp(
                "2026-07-20T09:00:00.000Z",
                {
                    Timestamp:
                        TestTimestamp
                }
            );

        assert.equal(
            timestamp.toMillis(),
            Date.parse(
                "2026-07-20T09:00:00.000Z"
            )
        );
    }
);

test(
    "createTimestamp converts millisecond values",
    function () {
        const timestamp =
            createTimestamp(
                12345,
                {
                    Timestamp:
                        TestTimestamp
                }
            );

        assert.equal(
            timestamp.toMillis(),
            12345
        );
    }
);

test(
    "createTimestamp rejects invalid timestamp strings",
    function () {
        assert.throws(
            function () {
                createTimestamp(
                    "not-a-date",
                    {
                        Timestamp:
                            TestTimestamp
                    }
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "runtime/invalid-timestamp"
                );

                return true;
            }
        );
    }
);

test(
    "createTimestamp rejects invalid numeric values",
    function () {
        assert.throws(
            function () {
                createTimestamp(
                    Number.NaN,
                    {
                        Timestamp:
                            TestTimestamp
                    }
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "runtime/invalid-timestamp"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   HEALTH INFORMATION
========================================================== */

test(
    "getRuntimeHealth summarizes runtime services",
    function () {
        const runtime =
            createRuntime({
                configuration:
                    createConfiguration(),

                environment: {
                    FIRESTORE_EMULATOR_HOST:
                        "127.0.0.1:8080"
                },

                db:
                    createFirestoreHarness()
                        .db,

                auth:
                    createAuthHarness()
                        .auth,

                storage:
                    createStorageStub(),

                FieldValue:
                    FieldValue,

                Timestamp:
                    TestTimestamp,

                logger:
                    createLoggerStub(),

                validateConfiguration:
                    false
            });

        assert.deepEqual(
            getRuntimeHealth(
                runtime
            ),
            {
                projectId:
                    "leternel-runtime-test",

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
                        true
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
   RUNTIME ERRORS
========================================================== */

test(
    "createRuntimeError creates a structured runtime error",
    function () {
        const error =
            createRuntimeError(
                "runtime/test-error",
                "Runtime test error.",
                {
                    service:
                        "firestore"
                }
            );

        assert.equal(
            error.code,
            "runtime/test-error"
        );

        assert.equal(
            error.message,
            "Runtime test error."
        );

        assert.deepEqual(
            error.details,
            {
                service:
                    "firestore"
            }
        );
    }
);