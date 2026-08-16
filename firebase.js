//javascript
"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   FIREBASE V8 INITIALIZATION
========================================================== */

(function initializeFirebase() {
    const firebaseConfig = {
        apiKey: "AIzaSyAtRZUiFnujmajhWNC57f483JtMkri8aPg",
        authDomain: "leternel-store.firebaseapp.com",
        projectId: "leternel-store",
        storageBucket: "leternel-store.firebasestorage.app",
        messagingSenderId: "205898698924",
        appId: "1:205898698924:web:a4b30f0036461461158f09",
        measurementId: "G-DDRRD53H18"
    };

    /* ------------------------------------------------------
       VERIFY REQUIRED FIREBASE V8 SCRIPTS
    ------------------------------------------------------ */

    if (typeof window.firebase === "undefined") {
        throw new Error(
            "Firebase SDK was not found. Load the Firebase v8 SDK scripts before firebase.js."
        );
    }

    const requiredServices = [
        {
            name: "Authentication",
            available: typeof firebase.auth === "function"
        },
        {
            name: "Cloud Firestore",
            available: typeof firebase.firestore === "function"
        },
        {
            name: "Cloud Storage",
            available: typeof firebase.storage === "function"
        }
    ];

    const missingServices = requiredServices
        .filter(function (service) {
            return !service.available;
        })
        .map(function (service) {
            return service.name;
        });

    if (missingServices.length > 0) {
        throw new Error(
            "Missing Firebase services: " + missingServices.join(", ") + "."
        );
    }

    /* ------------------------------------------------------
       INITIALIZE FIREBASE APP
    ------------------------------------------------------ */

    const firebaseApp = firebase.apps.length
        ? firebase.app()
        : firebase.initializeApp(firebaseConfig);

    /* ------------------------------------------------------
       FIREBASE SERVICE REFERENCES
    ------------------------------------------------------ */

    const auth = firebase.auth();
    const db = firebase.firestore();
    const storage = firebase.storage();

    /* ------------------------------------------------------
       FIRESTORE SETTINGS
    ------------------------------------------------------ */

    try {
        db.settings({
            ignoreUndefinedProperties: true
        });
    } catch (error) {
        /*
         * Firestore settings cannot be changed after the database has
         * already been used. This can occur during hot reloads.
         */
        console.warn(
            "[Firebase] Firestore settings were already applied:",
            error.message
        );
    }

    /* ------------------------------------------------------
       AUTHENTICATION PERSISTENCE
    ------------------------------------------------------ */

    let authPersistencePromise = null;

    function configureAuthPersistence() {
        if (!authPersistencePromise) {
            authPersistencePromise = auth
                .setPersistence(firebase.auth.Auth.Persistence.LOCAL)
                .then(function () {
                    return true;
                })
                .catch(function (error) {
                    console.error(
                        "[Firebase] Unable to enable local authentication persistence:",
                        error
                    );

                    return false;
                });
        }

        return authPersistencePromise;
    }

    /* ------------------------------------------------------
       FIRESTORE HELPERS
    ------------------------------------------------------ */

    const fieldValue = firebase.firestore.FieldValue;
    const timestamp = firebase.firestore.Timestamp;

    function serverTimestamp() {
        return fieldValue.serverTimestamp();
    }

    function increment(value) {
        const amount = Number(value);

        if (!Number.isFinite(amount)) {
            throw new TypeError(
                "Firebase increment value must be a finite number."
            );
        }

        return fieldValue.increment(amount);
    }

    function arrayUnion() {
        return fieldValue.arrayUnion.apply(fieldValue, arguments);
    }

    function arrayRemove() {
        return fieldValue.arrayRemove.apply(fieldValue, arguments);
    }

    function deleteField() {
        return fieldValue.delete();
    }

    function createTimestamp(date) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
            throw new TypeError(
                "createTimestamp requires a valid JavaScript Date."
            );
        }

        return timestamp.fromDate(date);
    }

    /* ------------------------------------------------------
       STORAGE HELPERS
    ------------------------------------------------------ */

    function createStoragePath() {
        return Array.prototype.slice
            .call(arguments)
            .filter(function (segment) {
                return segment !== null &&
                    segment !== undefined &&
                    String(segment).trim() !== "";
            })
            .map(function (segment) {
                return String(segment)
                    .trim()
                    .replace(/^\/+|\/+$/g, "");
            })
            .join("/");
    }

    function sanitizeFileName(fileName) {
        const originalName = String(fileName || "file");

        const extensionIndex = originalName.lastIndexOf(".");
        const hasExtension = extensionIndex > 0;

        const baseName = hasExtension
            ? originalName.slice(0, extensionIndex)
            : originalName;

        const extension = hasExtension
            ? originalName.slice(extensionIndex).toLowerCase()
            : "";

        const safeBaseName = baseName
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-zA-Z0-9_-]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .toLowerCase() || "file";

        return safeBaseName + extension;
    }

    function generateStorageFileName(fileName) {
        const safeFileName = sanitizeFileName(fileName);
        const randomId = Math.random()
            .toString(36)
            .slice(2, 10);

        return Date.now() + "-" + randomId + "-" + safeFileName;
    }

    /* ------------------------------------------------------
       FIREBASE ERROR NORMALIZATION
    ------------------------------------------------------ */

    function normalizeFirebaseError(error) {
        const fallback = {
            code: "unknown",
            message: "An unexpected Firebase error occurred.",
            originalError: error || null
        };

        if (!error) {
            return fallback;
        }

        return {
            code: error.code || fallback.code,
            message: error.message || fallback.message,
            originalError: error
        };
    }

    /* ------------------------------------------------------
       CONNECTION STATUS
    ------------------------------------------------------ */

    function isOnline() {
        return window.navigator.onLine;
    }

    /* ------------------------------------------------------
       PUBLIC FIREBASE SERVICES
    ------------------------------------------------------ */

    const FirebaseServices = Object.freeze({
        app: firebaseApp,
        auth: auth,
        db: db,
        storage: storage,

        config: Object.freeze(
            Object.assign({}, firebaseConfig)
        ),

        configureAuthPersistence: configureAuthPersistence,

        helpers: Object.freeze({
            serverTimestamp: serverTimestamp,
            increment: increment,
            arrayUnion: arrayUnion,
            arrayRemove: arrayRemove,
            deleteField: deleteField,
            createTimestamp: createTimestamp,
            createStoragePath: createStoragePath,
            sanitizeFileName: sanitizeFileName,
            generateStorageFileName: generateStorageFileName,
            normalizeFirebaseError: normalizeFirebaseError,
            isOnline: isOnline
        })
    });

    /*
     * These globals allow the remaining application files to use the same
     * initialized Firebase services without initializing Firebase again.
     */
    window.FirebaseServices = FirebaseServices;
    window.firebaseApp = firebaseApp;
    window.auth = auth;
    window.db = db;
    window.storage = storage;

    /* ------------------------------------------------------
       BEGIN PERSISTENCE CONFIGURATION
    ------------------------------------------------------ */

    configureAuthPersistence();

    console.info(
        "[Firebase] L'ÉTERNEL Store connected to project:",
        firebaseConfig.projectId
    );
})();