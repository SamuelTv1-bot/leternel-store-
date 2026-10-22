"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   SHARED RUNTIME

   Responsibilities:
   - Initialize Firebase Admin once
   - Expose Firestore and Auth services
   - Load and validate configuration
   - Expose FieldValue and Timestamp helpers
   - Provide dependency injection for tests
   - Cache runtime resources safely
========================================================== */

const admin =
    require(
        "firebase-admin"
    );

const {
    getConfiguration,
    validateConfiguration
} = require(
    "./configuration"
);

const {
    getLogger
} = require(
    "./logger"
);

/* ==========================================================
   RUNTIME STATE
========================================================== */

let cachedRuntime;

/* ==========================================================
   FIREBASE INITIALIZATION
========================================================== */

function initializeFirebaseAdmin(
    options
) {
    const settings =
        options || {};

    if (
        settings.adminApp
    ) {
        return settings.adminApp;
    }

    if (
        admin.apps &&
        admin.apps.length
    ) {
        return admin.app();
    }

    const initializationOptions =
        createInitializationOptions(
            settings
        );

    return admin.initializeApp(
        initializationOptions
    );
}

function createInitializationOptions(
    options
) {
    const settings =
        options || {};

    const configuration =
        settings.configuration;

    const initializationOptions = {};

    if (
        configuration &&
        configuration.projectId
    ) {
        initializationOptions.projectId =
            configuration.projectId;
    }

    if (
        settings.storageBucket
    ) {
        initializationOptions.storageBucket =
            settings.storageBucket;
    }

    if (
        settings.databaseURL
    ) {
        initializationOptions.databaseURL =
            settings.databaseURL;
    }

    if (
        settings.credential
    ) {
        initializationOptions.credential =
            settings.credential;
    }

    return initializationOptions;
}

/* ==========================================================
   RUNTIME FACTORY
========================================================== */

function createRuntime(options) {
    const settings =
        options || {};

    const configuration =
        settings.configuration ||
        getConfiguration({
            reload:
                Boolean(
                    settings.reloadConfiguration
                ),

            environment:
                settings.environment
        });

    if (
        settings.validateConfiguration !==
        false
    ) {
        validateConfiguration(
            configuration,
            {
                requireProviderSecrets:
                    settings.requireProviderSecrets !==
                    false
            }
        );
    }

    const adminApp =
        settings.adminApp ||
        (
            settings.db &&
            settings.auth
                ? null
                : initializeFirebaseAdmin({
                      configuration:
                          configuration,

                      storageBucket:
                          settings.storageBucket,

                      databaseURL:
                          settings.databaseURL,

                      credential:
                          settings.credential
                  })
        );

    const db =
        settings.db ||
        resolveFirestore(
            adminApp
        );

    const auth =
        settings.auth ||
        resolveAuth(
            adminApp
        );

    const storage =
        settings.storage ||
        resolveStorage(
            adminApp,
            settings
        );

    const logger =
        settings.logger ||
        getLogger({
            configuration:
                configuration,

            reload:
                Boolean(
                    settings.reloadLogger
                ),

            context:
                settings.logContext ||
                {
                    projectId:
                        configuration.projectId,

                    region:
                        configuration.region
                }
        });

    const runtime = {
        admin:
            admin,

        app:
            adminApp,

        db:
            db,

        firestore:
            db,

        auth:
            auth,

        storage:
            storage,

        bucket:
            storage &&
            typeof storage.bucket ===
                "function"
                ? storage.bucket(
                      settings.storageBucket
                  )
                : null,

        FieldValue:
            resolveFieldValue(
                settings
            ),

        Timestamp:
            resolveTimestamp(
                settings
            ),

        configuration:
            configuration,

        config:
            configuration,

        logger:
            logger,

        now:
            typeof settings.now ===
                "function"
                ? settings.now
                : Date.now,

        environment:
            settings.environment ||
            process.env,

        isEmulator:
            detectEmulatorEnvironment(
                settings.environment ||
                process.env
            )
    };

    return Object.freeze(
        runtime
    );
}

/* ==========================================================
   SERVICE RESOLUTION
========================================================== */

function resolveFirestore(
    app
) {
    if (
        app &&
        typeof app.firestore ===
            "function"
    ) {
        return app.firestore();
    }

    if (
        typeof admin.firestore ===
            "function"
    ) {
        return admin.firestore();
    }

    throw createRuntimeError(
        "runtime/firestore-unavailable",
        "Firebase Firestore is unavailable."
    );
}

function resolveAuth(app) {
    if (
        app &&
        typeof app.auth ===
            "function"
    ) {
        return app.auth();
    }

    if (
        typeof admin.auth ===
            "function"
    ) {
        return admin.auth();
    }

    throw createRuntimeError(
        "runtime/auth-unavailable",
        "Firebase Auth is unavailable."
    );
}

function resolveStorage(
    app,
    options
) {
    const settings =
        options || {};

    if (
        settings.disableStorage
    ) {
        return null;
    }

    if (
        app &&
        typeof app.storage ===
            "function"
    ) {
        return app.storage();
    }

    if (
        typeof admin.storage ===
            "function"
    ) {
        return admin.storage();
    }

    return null;
}

function resolveFieldValue(options) {
    const settings =
        options || {};

    if (settings.FieldValue) {
        return settings.FieldValue;
    }

    if (
        admin.firestore &&
        admin.firestore.FieldValue
    ) {
        return admin.firestore
            .FieldValue;
    }

    throw createRuntimeError(
        "runtime/field-value-unavailable",
        "Firestore FieldValue is unavailable."
    );
}

function resolveTimestamp(options) {
    const settings =
        options || {};

    if (settings.Timestamp) {
        return settings.Timestamp;
    }

    if (
        admin.firestore &&
        admin.firestore.Timestamp
    ) {
        return admin.firestore
            .Timestamp;
    }

    throw createRuntimeError(
        "runtime/timestamp-unavailable",
        "Firestore Timestamp is unavailable."
    );
}

/* ==========================================================
   CACHED RUNTIME
========================================================== */

function getRuntime(options) {
    const settings =
        options || {};

    if (
        !cachedRuntime ||
        settings.reload
    ) {
        cachedRuntime =
            createRuntime(
                settings
            );
    }

    return cachedRuntime;
}

function resetRuntime() {
    cachedRuntime =
        undefined;
}

/* ==========================================================
   DEPENDENCY HELPERS
========================================================== */

function createServiceDependencies(
    runtime,
    overrides
) {
    const source =
        runtime ||
        getRuntime();

    return Object.assign(
        {
            admin:
                source.admin,

            app:
                source.app,

            db:
                source.db,

            firestore:
                source.firestore,

            auth:
                source.auth,

            storage:
                source.storage,

            bucket:
                source.bucket,

            FieldValue:
                source.FieldValue,

            Timestamp:
                source.Timestamp,

            configuration:
                source.configuration,

            config:
                source.configuration,

            logger:
                source.logger,

            now:
                source.now,

            isEmulator:
                source.isEmulator
        },
        overrides || {}
    );
}

function createTestRuntime(options) {
    const settings =
        options || {};

    if (!settings.db) {
        throw createRuntimeError(
            "runtime/test-firestore-required",
            "createTestRuntime requires a Firestore test double."
        );
    }

    if (!settings.auth) {
        throw createRuntimeError(
            "runtime/test-auth-required",
            "createTestRuntime requires an Auth test double."
        );
    }

    return createRuntime(
        Object.assign(
            {
                validateConfiguration:
                    false,

                requireProviderSecrets:
                    false,

                disableStorage:
                    true
            },
            settings
        )
    );
}

/* ==========================================================
   EMULATOR DETECTION
========================================================== */

function detectEmulatorEnvironment(
    environment
) {
    const env =
        environment ||
        process.env;

    return Boolean(
        env.FUNCTIONS_EMULATOR ||
        env.FIRESTORE_EMULATOR_HOST ||
        env.FIREBASE_AUTH_EMULATOR_HOST ||
        env.FIREBASE_STORAGE_EMULATOR_HOST ||
        env.FUNCTIONS_EMULATOR_HOST
    );
}

function getEmulatorHosts(
    environment
) {
    const env =
        environment ||
        process.env;

    return {
        firestore:
            env.FIRESTORE_EMULATOR_HOST ||
            "",

        auth:
            env.FIREBASE_AUTH_EMULATOR_HOST ||
            "",

        storage:
            env.FIREBASE_STORAGE_EMULATOR_HOST ||
            "",

        functions:
            env.FUNCTIONS_EMULATOR_HOST ||
            ""
    };
}

/* ==========================================================
   TRANSACTION AND BATCH HELPERS
========================================================== */

function runTransaction(
    runtime,
    callback,
    options
) {
    const source =
        runtime ||
        getRuntime();

    if (
        !source.db ||
        typeof source.db
            .runTransaction !==
            "function"
    ) {
        throw createRuntimeError(
            "runtime/transactions-unavailable",
            "Firestore transactions are unavailable."
        );
    }

    return source.db.runTransaction(
        callback,
        options
    );
}

function createBatch(runtime) {
    const source =
        runtime ||
        getRuntime();

    if (
        !source.db ||
        typeof source.db.batch !==
            "function"
    ) {
        throw createRuntimeError(
            "runtime/batches-unavailable",
            "Firestore write batches are unavailable."
        );
    }

    return source.db.batch();
}

function serverTimestamp(runtime) {
    const source =
        runtime ||
        getRuntime();

    return source.FieldValue
        .serverTimestamp();
}

function createTimestamp(
    value,
    runtime
) {
    const source =
        runtime ||
        getRuntime();

    if (
        value === undefined
    ) {
        if (
            typeof source.Timestamp
                .now ===
                "function"
        ) {
            return source.Timestamp
                .now();
        }

        return source.Timestamp
            .fromMillis(
                source.now()
            );
    }

    if (
        value instanceof Date
    ) {
        return source.Timestamp
            .fromDate(value);
    }

    if (
        value &&
        typeof value.toMillis ===
            "function"
    ) {
        return source.Timestamp
            .fromMillis(
                value.toMillis()
            );
    }

    if (
        typeof value ===
        "string"
    ) {
        const parsed =
            Date.parse(value);

        if (
            Number.isNaN(parsed)
        ) {
            throw createRuntimeError(
                "runtime/invalid-timestamp",
                "Invalid timestamp string."
            );
        }

        return source.Timestamp
            .fromMillis(parsed);
    }

    const milliseconds =
        Number(value);

    if (
        !Number.isFinite(
            milliseconds
        )
    ) {
        throw createRuntimeError(
            "runtime/invalid-timestamp",
            "Invalid timestamp value."
        );
    }

    return source.Timestamp
        .fromMillis(
            milliseconds
        );
}

/* ==========================================================
   HEALTH INFORMATION
========================================================== */

function getRuntimeHealth(runtime) {
    const source =
        runtime ||
        getRuntime();

    return {
        projectId:
            source.configuration
                .projectId,

        region:
            source.configuration
                .region,

        environment:
            source.configuration
                .nodeEnvironment,

        emulator:
            source.isEmulator,

        services: {
            firestore:
                Boolean(
                    source.db
                ),

            auth:
                Boolean(
                    source.auth
                ),

            storage:
                Boolean(
                    source.storage
                )
        },

        paymentProvider:
            source.configuration
                .payments
                .provider,

        emailProvider:
            source.configuration
                .email
                .provider
    };
}

/* ==========================================================
   ERROR HELPERS
========================================================== */

function createRuntimeError(
    code,
    message,
    details
) {
    const error =
        new Error(message);

    error.code =
        code;

    if (
        details !== undefined
    ) {
        error.details =
            details;
    }

    return error;
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    initializeFirebaseAdmin,
    createInitializationOptions,
    createRuntime,
    getRuntime,
    resetRuntime,
    createServiceDependencies,
    createTestRuntime,
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
};