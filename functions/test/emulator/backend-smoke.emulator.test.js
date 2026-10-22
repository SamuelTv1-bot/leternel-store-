"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   FIREBASE EMULATOR BACKEND SMOKE TESTS

   Required emulators:
   - Functions
   - Firestore
   - Authentication
========================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");

/* ==========================================================
   ENVIRONMENT
========================================================== */

const PROJECT_ID =
    process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    "leternel-store-emulator-test";

const FUNCTIONS_HOST =
    process.env.FUNCTIONS_EMULATOR_HOST ||
    "127.0.0.1:5001";

const FIRESTORE_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ||
    "127.0.0.1:8080";

const AUTH_HOST =
    process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    "127.0.0.1:9099";

const FUNCTIONS_REGION =
    process.env.FUNCTIONS_REGION ||
    "europe-west1";

const FUNCTIONS_BASE_URL =
    "http://" +
    FUNCTIONS_HOST +
    "/" +
    PROJECT_ID +
    "/" +
    FUNCTIONS_REGION;

const AUTH_BASE_URL =
    "http://" +
    AUTH_HOST +
    "/identitytoolkit.googleapis.com/v1";

const TEST_TIMEOUT =
    Number(
        process.env.EMULATOR_TEST_TIMEOUT ||
        20000
    );

/* ==========================================================
   FIREBASE ADMIN INITIALIZATION
========================================================== */

process.env.GCLOUD_PROJECT =
    PROJECT_ID;

process.env.FIRESTORE_EMULATOR_HOST =
    FIRESTORE_HOST;

process.env.FIREBASE_AUTH_EMULATOR_HOST =
    AUTH_HOST;

if (!admin.apps.length) {
    admin.initializeApp({
        projectId:
            PROJECT_ID
    });
}

const db =
    admin.firestore();

const auth =
    admin.auth();

/* ==========================================================
   TEST STATE
========================================================== */

const createdUserIds =
    new Set();

const createdDocumentPaths =
    new Set();

/* ==========================================================
   LIFECYCLE
========================================================== */

test.before(
    async function () {
        await assertEmulatorsAvailable();
    }
);

test.beforeEach(
    async function () {
        await clearFirestoreEmulator();
        await clearAuthEmulator();

        createdUserIds.clear();
        createdDocumentPaths.clear();
    }
);

test.after(
    async function () {
        await clearFirestoreEmulator();
        await clearAuthEmulator();

        await admin.app().delete();
    }
);

/* ==========================================================
   HEALTH ENDPOINT
========================================================== */

test(
    "health endpoint reports a healthy backend",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const response =
            await fetchJson(
                FUNCTIONS_BASE_URL +
                "/health",
                {
                    method:
                        "GET"
                }
            );

        assert.equal(
            response.status,
            200
        );

        assert.equal(
            response.body.success,
            true
        );

        assert.equal(
            response.body.status,
            "healthy"
        );

        assert.equal(
            response.body.service,
            "leternel-store-functions"
        );

        assert.match(
            response.body.timestamp,
            /^\d{4}-\d{2}-\d{2}T/
        );
    }
);

test(
    "health endpoint rejects unsupported methods",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const response =
            await fetchJson(
                FUNCTIONS_BASE_URL +
                "/health",
                {
                    method:
                        "POST"
                }
            );

        assert.equal(
            response.status,
            405
        );

        assert.equal(
            response.body.success,
            false
        );

        assert.equal(
            response.body.error.code,
            "method-not-allowed"
        );
    }
);

/* ==========================================================
   HTTP AUTHENTICATION BOUNDARIES
========================================================== */

test(
    "orders API rejects unauthenticated requests",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const response =
            await fetchJson(
                FUNCTIONS_BASE_URL +
                "/ordersApi",
                {
                    method:
                        "GET"
                }
            );

        assert.equal(
            response.status,
            401
        );

        assert.equal(
            response.body.success,
            false
        );

        assert.equal(
            response.body.error.code,
            "unauthenticated"
        );
    }
);

test(
    "admin API rejects unauthenticated requests",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const response =
            await fetchJson(
                FUNCTIONS_BASE_URL +
                "/adminApi",
                {
                    method:
                        "GET"
                }
            );

        assert.equal(
            response.status,
            401
        );

        assert.equal(
            response.body.success,
            false
        );

        assert.equal(
            response.body.error.code,
            "unauthenticated"
        );
    }
);

test(
    "payment webhook rejects unsupported methods",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const response =
            await fetchJson(
                FUNCTIONS_BASE_URL +
                "/paymentWebhook",
                {
                    method:
                        "GET"
                }
            );

        assert.equal(
            response.status,
            405
        );

        assert.equal(
            response.body.error.code,
            "method-not-allowed"
        );
    }
);

/* ==========================================================
   AUTHENTICATED ORDERS API
========================================================== */

test(
    "authenticated customer can list only their orders",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const customer =
            await createEmulatorUser({
                email:
                    "customer@example.com",

                password:
                    "Password123!",

                displayName:
                    "Test Customer",

                claims: {
                    role:
                        "customer",

                    admin:
                        false,

                    superadmin:
                        false
                }
            });

        await seedDocument(
            "orders/customer-order",
            {
                userId:
                    customer.uid,

                orderNumber:
                    "LET-CUSTOMER-ORDER",

                status:
                    "confirmed",

                paymentStatus:
                    "paid",

                currency:
                    "NGN",

                subtotal:
                    250000,

                discount:
                    0,

                deliveryFee:
                    0,

                tax:
                    0,

                total:
                    250000,

                customer: {
                    email:
                        customer.email
                },

                items: [],

                createdAt:
                    admin.firestore
                        .FieldValue
                        .serverTimestamp(),

                updatedAt:
                    admin.firestore
                        .FieldValue
                        .serverTimestamp()
            }
        );

        await seedDocument(
            "orders/another-order",
            {
                userId:
                    "another-customer",

                orderNumber:
                    "LET-ANOTHER-ORDER",

                status:
                    "pending",

                paymentStatus:
                    "pending",

                currency:
                    "NGN",

                subtotal:
                    100000,

                discount:
                    0,

                deliveryFee:
                    0,

                tax:
                    0,

                total:
                    100000,

                customer: {
                    email:
                        "another@example.com"
                },

                items: [],

                createdAt:
                    admin.firestore
                        .FieldValue
                        .serverTimestamp(),

                updatedAt:
                    admin.firestore
                        .FieldValue
                        .serverTimestamp()
            }
        );

        const response =
            await fetchJson(
                FUNCTIONS_BASE_URL +
                "/ordersApi",
                {
                    method:
                        "GET",

                    headers: {
                        Authorization:
                            "Bearer " +
                            customer.idToken
                    }
                }
            );

        assert.equal(
            response.status,
            200
        );

        assert.equal(
            response.body.success,
            true
        );

        const orders =
            response.body.data.orders ||
            response.body.data.items ||
            response.body.data;

        assert.ok(
            Array.isArray(orders)
        );

        assert.equal(
            orders.length,
            1
        );

        assert.equal(
            orders[0].userId,
            customer.uid
        );

        assert.equal(
            orders[0].orderNumber,
            "LET-CUSTOMER-ORDER"
        );
    }
);

test(
    "customer cannot retrieve another customer's order",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const customer =
            await createEmulatorUser({
                email:
                    "customer@example.com",

                password:
                    "Password123!",

                claims: {
                    role:
                        "customer"
                }
            });

        await seedDocument(
            "orders/private-order",
            {
                userId:
                    "different-customer",

                orderNumber:
                    "LET-PRIVATE-ORDER",

                status:
                    "confirmed",

                paymentStatus:
                    "paid",

                currency:
                    "NGN",

                total:
                    150000,

                items: [],

                createdAt:
                    admin.firestore
                        .FieldValue
                        .serverTimestamp(),

                updatedAt:
                    admin.firestore
                        .FieldValue
                        .serverTimestamp()
            }
        );

        const response =
            await fetchJson(
                FUNCTIONS_BASE_URL +
                "/ordersApi/private-order",
                {
                    method:
                        "GET",

                    headers: {
                        Authorization:
                            "Bearer " +
                            customer.idToken
                    }
                }
            );

        assert.ok(
            [
                403,
                404
            ].includes(
                response.status
            )
        );

        assert.equal(
            response.body.success,
            false
        );
    }
);

/* ==========================================================
   ADMINISTRATOR API
========================================================== */

test(
    "administrator can retrieve dashboard metrics",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const administrator =
            await createEmulatorUser({
                email:
                    "admin@example.com",

                password:
                    "Password123!",

                claims: {
                    role:
                        "admin",

                    admin:
                        true,

                    superadmin:
                        false
                }
            });

        await seedDocument(
            "users/" +
            administrator.uid,
            {
                uid:
                    administrator.uid,

                email:
                    administrator.email,

                role:
                    "admin",

                status:
                    "active",

                createdAt:
                    admin.firestore
                        .FieldValue
                        .serverTimestamp(),

                updatedAt:
                    admin.firestore
                        .FieldValue
                        .serverTimestamp()
            }
        );

        await seedDocument(
            "products/product-1",
            {
                name:
                    "Signature Coat",

                slug:
                    "signature-coat",

                price:
                    250000,

                inventory:
                    4,

                stock:
                    4,

                active:
                    true,

                published:
                    true,

                archived:
                    false,

                createdAt:
                    admin.firestore
                        .FieldValue
                        .serverTimestamp(),

                updatedAt:
                    admin.firestore
                        .FieldValue
                        .serverTimestamp()
            }
        );

        await seedDocument(
            "users/customer-1",
            {
                uid:
                    "customer-1",

                email:
                    "customer@example.com",

                role:
                    "customer",

                status:
                    "active",

                createdAt:
                    admin.firestore
                        .FieldValue
                        .serverTimestamp(),

                updatedAt:
                    admin.firestore
                        .FieldValue
                        .serverTimestamp()
            }
        );

        await seedDocument(
            "orders/order-1",
            {
                userId:
                    "customer-1",

                status:
                    "confirmed",

                paymentStatus:
                    "paid",

                currency:
                    "NGN",

                total:
                    250000,

                items: [],

                createdAt:
                    admin.firestore
                        .FieldValue
                        .serverTimestamp(),

                updatedAt:
                    admin.firestore
                        .FieldValue
                        .serverTimestamp()
            }
        );

        const response =
            await fetchJson(
                FUNCTIONS_BASE_URL +
                "/adminApi/metrics",
                {
                    method:
                        "GET",

                    headers: {
                        Authorization:
                            "Bearer " +
                            administrator.idToken
                    }
                }
            );

        assert.equal(
            response.status,
            200
        );

        assert.equal(
            response.body.success,
            true
        );

        const metrics =
            response.body.data;

        assert.ok(
            metrics
        );

        assert.ok(
            metrics.totals
        );

        assert.equal(
            typeof metrics.totals.products,
            "number"
        );

        assert.equal(
            typeof metrics.totals.customers,
            "number"
        );
    }
);

test(
    "customer token cannot access administrator API",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const customer =
            await createEmulatorUser({
                email:
                    "customer@example.com",

                password:
                    "Password123!",

                claims: {
                    role:
                        "customer",

                    admin:
                        false
                }
            });

        const response =
            await fetchJson(
                FUNCTIONS_BASE_URL +
                "/adminApi/metrics",
                {
                    method:
                        "GET",

                    headers: {
                        Authorization:
                            "Bearer " +
                            customer.idToken
                    }
                }
            );

        assert.equal(
            response.status,
            403
        );

        assert.equal(
            response.body.success,
            false
        );

        assert.equal(
            response.body.error.code,
            "permission-denied"
        );
    }
);

/* ==========================================================
   CALLABLE FUNCTION PROTOCOL
========================================================== */

test(
    "createOrder callable rejects an unauthenticated request",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const response =
            await invokeCallable(
                "createOrder",
                {
                    items: []
                }
            );

        assert.ok(
            [
                401,
                403
            ].includes(
                response.status
            )
        );

        assert.ok(
            response.body.error
        );

        assert.match(
            String(
                response.body.error.status ||
                response.body.error.message ||
                ""
            ),
            /UNAUTHENTICATED|unauthenticated/i
        );
    }
);

test(
    "createOrder callable validates malformed authenticated checkout data",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const customer =
            await createEmulatorUser({
                email:
                    "customer@example.com",

                password:
                    "Password123!",

                claims: {
                    role:
                        "customer"
                }
            });

        const response =
            await invokeCallable(
                "createOrder",
                {
                    items: []
                },
                customer.idToken
            );

        assert.ok(
            response.status >= 400
        );

        assert.ok(
            response.body.error
        );

        assert.match(
            String(
                response.body.error.status ||
                response.body.error.message ||
                ""
            ),
            /INVALID_ARGUMENT|invalid-argument|items/i
        );
    }
);

/* ==========================================================
   FIRESTORE PROFILE TRIGGER
========================================================== */

test(
    "new profile trigger normalizes customer account fields",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const user =
            await createEmulatorUser({
                email:
                    "new-customer@example.com",

                password:
                    "Password123!",

                displayName:
                    "New Customer",

                claims: {}
            });

        const profileReference =
            db.collection("users")
                .doc(user.uid);

        createdDocumentPaths.add(
            profileReference.path
        );

        await profileReference.set({
            uid:
                user.uid,

            email:
                user.email,

            displayName:
                "New Customer"
        });

        const profile =
            await waitForDocument(
                profileReference,
                function (data) {
                    return (
                        data.role ===
                            "customer" &&
                        data.status ===
                            "active"
                    );
                }
            );

        assert.equal(
            profile.uid,
            user.uid
        );

        assert.equal(
            profile.role,
            "customer"
        );

        assert.equal(
            profile.status,
            "active"
        );

        assert.ok(
            Array.isArray(
                profile.addresses
            )
        );

        const authUser =
            await waitForAuthClaims(
                user.uid,
                function (claims) {
                    return claims.role ===
                        "customer";
                }
            );

        assert.equal(
            authUser.customClaims.role,
            "customer"
        );

        assert.equal(
            authUser.customClaims.admin,
            false
        );

        assert.equal(
            authUser.customClaims.superadmin,
            false
        );
    }
);

/* ==========================================================
   ORDER CREATED TRIGGER
========================================================== */

test(
    "new order trigger leaves a valid order document available",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const orderReference =
            db.collection("orders")
                .doc("trigger-smoke-order");

        createdDocumentPaths.add(
            orderReference.path
        );

        await orderReference.set({
            userId:
                "customer-1",

            orderNumber:
                "LET-TRIGGER-SMOKE",

            status:
                "pending",

            paymentStatus:
                "pending",

            currency:
                "NGN",

            subtotal:
                100000,

            discount:
                0,

            deliveryFee:
                5000,

            tax:
                0,

            total:
                105000,

            customer: {
                firstName:
                    "Test",

                lastName:
                    "Customer",

                email:
                    "customer@example.com"
            },

            shippingAddress: {
                addressLine1:
                    "10 Example Road",

                city:
                    "Lagos",

                state:
                    "Lagos",

                country:
                    "Nigeria"
            },

            items: [
                {
                    productId:
                        "product-1",

                    name:
                        "Test Product",

                    quantity:
                        1,

                    unitPrice:
                        100000,

                    lineTotal:
                        100000
                }
            ],

            createdAt:
                admin.firestore
                    .FieldValue
                    .serverTimestamp(),

            updatedAt:
                admin.firestore
                    .FieldValue
                    .serverTimestamp()
        });

        const snapshot =
            await orderReference.get();

        assert.equal(
            snapshot.exists,
            true
        );

        const order =
            snapshot.data();

        assert.equal(
            order.orderNumber,
            "LET-TRIGGER-SMOKE"
        );

        assert.equal(
            order.status,
            "pending"
        );

        assert.equal(
            order.total,
            105000
        );
    }
);

/* ==========================================================
   FIRESTORE DIRECT ACCESS
========================================================== */

test(
    "Admin SDK can write and read emulator documents",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const reference =
            db.collection(
                "smokeTests"
            ).doc(
                "backend-connectivity"
            );

        createdDocumentPaths.add(
            reference.path
        );

        await reference.set({
            successful:
                true,

            projectId:
                PROJECT_ID,

            createdAt:
                admin.firestore
                    .FieldValue
                    .serverTimestamp()
        });

        const snapshot =
            await reference.get();

        assert.equal(
            snapshot.exists,
            true
        );

        assert.equal(
            snapshot.data()
                .successful,
            true
        );

        assert.equal(
            snapshot.data()
                .projectId,
            PROJECT_ID
        );
    }
);

/* ==========================================================
   AUTHENTICATION EMULATOR
========================================================== */

test(
    "Auth emulator creates users and issues valid ID tokens",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const user =
            await createEmulatorUser({
                email:
                    "token-test@example.com",

                password:
                    "Password123!",

                claims: {
                    role:
                        "customer",

                    testAccount:
                        true
                }
            });

        assert.ok(
            user.uid
        );

        assert.ok(
            user.idToken
        );

        const decodedToken =
            await auth.verifyIdToken(
                user.idToken
            );

        assert.equal(
            decodedToken.uid,
            user.uid
        );

        assert.equal(
            decodedToken.email,
            "token-test@example.com"
        );

        assert.equal(
            decodedToken.role,
            "customer"
        );

        assert.equal(
            decodedToken.testAccount,
            true
        );
    }
);

/* ==========================================================
   EMULATOR HELPERS
========================================================== */

async function assertEmulatorsAvailable() {
    const failures = [];

    try {
        const healthResponse =
            await fetchWithTimeout(
                FUNCTIONS_BASE_URL +
                "/health",
                {
                    method:
                        "GET"
                },
                5000
            );

        if (
            !healthResponse.ok
        ) {
            failures.push(
                "Functions emulator returned HTTP " +
                healthResponse.status
            );
        }
    } catch (error) {
        failures.push(
            "Functions emulator unavailable at " +
            FUNCTIONS_BASE_URL +
            ": " +
            error.message
        );
    }

    try {
        await db.collection(
            "emulatorChecks"
        ).doc(
            "firestore"
        ).set({
            available:
                true
        });

        await db.collection(
            "emulatorChecks"
        ).doc(
            "firestore"
        ).delete();
    } catch (error) {
        failures.push(
            "Firestore emulator unavailable at " +
            FIRESTORE_HOST +
            ": " +
            error.message
        );
    }

    try {
        const response =
            await fetchWithTimeout(
                AUTH_BASE_URL +
                "/projects/" +
                PROJECT_ID +
                "/accounts",
                {
                    method:
                        "GET"
                },
                5000
            );

        /*
         * The emulator may return 400 or 404 for this probe.
         * Any HTTP response confirms that the server is reachable.
         */
        assert.ok(
            response.status >= 200
        );
    } catch (error) {
        failures.push(
            "Auth emulator unavailable at " +
            AUTH_HOST +
            ": " +
            error.message
        );
    }

    if (failures.length) {
        throw new Error(
            [
                "Firebase emulator smoke tests cannot start.",
                "",
                ...failures,
                "",
                "Start the suite with:",
                "firebase emulators:exec --only functions,firestore,auth \"npm --prefix functions run test:emulator\""
            ].join("\n")
        );
    }
}

async function clearFirestoreEmulator() {
    const url =
        "http://" +
        FIRESTORE_HOST +
        "/emulator/v1/projects/" +
        PROJECT_ID +
        "/databases/(default)/documents";

    const response =
        await fetchWithTimeout(
            url,
            {
                method:
                    "DELETE"
            },
            10000
        );

    if (
        !response.ok
    ) {
        throw new Error(
            "Unable to clear Firestore emulator: HTTP " +
            response.status
        );
    }
}

async function clearAuthEmulator() {
    const url =
        "http://" +
        AUTH_HOST +
        "/emulator/v1/projects/" +
        PROJECT_ID +
        "/accounts";

    const response =
        await fetchWithTimeout(
            url,
            {
                method:
                    "DELETE"
            },
            10000
        );

    if (
        !response.ok
    ) {
        throw new Error(
            "Unable to clear Auth emulator: HTTP " +
            response.status
        );
    }
}

async function seedDocument(
    documentPath,
    data
) {
    const reference =
        db.doc(documentPath);

    createdDocumentPaths.add(
        documentPath
    );

    await reference.set(data);

    return reference;
}

async function createEmulatorUser(options) {
    const settings =
        options || {};

    const email =
        settings.email;

    const password =
        settings.password ||
        "Password123!";

    const user =
        await auth.createUser({
            email:
                email,

            password:
                password,

            displayName:
                settings.displayName ||
                undefined,

            emailVerified:
                settings.emailVerified !==
                false,

            disabled:
                false
        });

    createdUserIds.add(
        user.uid
    );

    const claims =
        settings.claims || {};

    if (
        Object.keys(claims).length
    ) {
        await auth.setCustomUserClaims(
            user.uid,
            claims
        );
    }

    const authentication =
        await signInWithPassword(
            email,
            password
        );

    return {
        uid:
            user.uid,

        email:
            email,

        password:
            password,

        idToken:
            authentication.idToken,

        refreshToken:
            authentication.refreshToken
    };
}

async function signInWithPassword(
    email,
    password
) {
    const response =
        await fetchJson(
            AUTH_BASE_URL +
            "/accounts:signInWithPassword?key=fake-api-key",
            {
                method:
                    "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify({
                        email:
                            email,

                        password:
                            password,

                        returnSecureToken:
                            true
                    })
            }
        );

    if (
        response.status !==
        200
    ) {
        throw new Error(
            "Auth emulator sign-in failed: " +
            JSON.stringify(
                response.body
            )
        );
    }

    return response.body;
}

async function invokeCallable(
    functionName,
    data,
    idToken
) {
    const headers = {
        "Content-Type":
            "application/json"
    };

    if (idToken) {
        headers.Authorization =
            "Bearer " +
            idToken;
    }

    return fetchJson(
        FUNCTIONS_BASE_URL +
        "/" +
        functionName,
        {
            method:
                "POST",

            headers:
                headers,

            body:
                JSON.stringify({
                    data:
                        data
                })
        }
    );
}

async function waitForDocument(
    reference,
    predicate
) {
    const deadline =
        Date.now() +
        TEST_TIMEOUT;

    let lastData;

    while (
        Date.now() <
        deadline
    ) {
        const snapshot =
            await reference.get();

        if (snapshot.exists) {
            lastData =
                snapshot.data();

            if (
                predicate(lastData)
            ) {
                return lastData;
            }
        }

        await delay(200);
    }

    throw new Error(
        "Timed out waiting for document " +
        reference.path +
        ". Last value: " +
        JSON.stringify(
            lastData || null
        )
    );
}

async function waitForAuthClaims(
    userId,
    predicate
) {
    const deadline =
        Date.now() +
        TEST_TIMEOUT;

    let lastUser;

    while (
        Date.now() <
        deadline
    ) {
        lastUser =
            await auth.getUser(
                userId
            );

        if (
            predicate(
                lastUser.customClaims ||
                {}
            )
        ) {
            return lastUser;
        }

        await delay(200);
    }

    throw new Error(
        "Timed out waiting for Auth claims for " +
        userId +
        ". Last claims: " +
        JSON.stringify(
            lastUser
                ? lastUser.customClaims
                : null
        )
    );
}

async function fetchJson(
    url,
    options
) {
    const response =
        await fetchWithTimeout(
            url,
            options,
            TEST_TIMEOUT
        );

    const text =
        await response.text();

    let body = null;

    if (text) {
        try {
            body =
                JSON.parse(text);
        } catch {
            body = {
                raw:
                    text
            };
        }
    }

    return {
        status:
            response.status,

        headers:
            response.headers,

        body:
            body
    };
}

async function fetchWithTimeout(
    url,
    options,
    timeout
) {
    const controller =
        new AbortController();

    const timer =
        setTimeout(
            function () {
                controller.abort();
            },
            timeout
        );

    try {
        return await fetch(
            url,
            Object.assign(
                {},
                options || {},
                {
                    signal:
                        controller.signal
                }
            )
        );
    } finally {
        clearTimeout(timer);
    }
}

function delay(milliseconds) {
    return new Promise(
        function (resolve) {
            setTimeout(
                resolve,
                milliseconds
            );
        }
    );
}