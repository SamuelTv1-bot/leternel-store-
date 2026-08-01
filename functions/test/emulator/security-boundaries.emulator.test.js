"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   FIREBASE EMULATOR SECURITY BOUNDARY TESTS

   Required emulators:
   - Firestore
   - Authentication
   - Storage
========================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");

const {
    initializeApp,
    deleteApp
} = require("firebase/app");

const {
    getAuth,
    connectAuthEmulator,
    signInWithEmailAndPassword
} = require("firebase/auth");

const {
    getFirestore,
    connectFirestoreEmulator,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    deleteDoc,
    collection,
    query,
    where
} = require("firebase/firestore");

const {
    getStorage,
    connectStorageEmulator,
    ref,
    getBytes,
    uploadBytes,
    deleteObject
} = require("firebase/storage");

/* ==========================================================
   ENVIRONMENT
========================================================== */

const PROJECT_ID =
    process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    "leternel-store-emulator-test";

const FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ||
    "127.0.0.1:8080";

const AUTH_EMULATOR_HOST =
    process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    "127.0.0.1:9099";

const STORAGE_EMULATOR_HOST =
    process.env.FIREBASE_STORAGE_EMULATOR_HOST ||
    "127.0.0.1:9199";

const STORAGE_BUCKET =
    process.env.FIREBASE_STORAGE_BUCKET ||
    PROJECT_ID + ".appspot.com";

const TEST_TIMEOUT =
    Number(
        process.env.EMULATOR_TEST_TIMEOUT ||
        20000
    );

const TEST_PASSWORD =
    "Password123!";

const SMALL_JPEG =
    Buffer.from([
        0xff,
        0xd8,
        0xff,
        0xe0,
        0x00,
        0x10,
        0x4a,
        0x46,
        0x49,
        0x46,
        0x00,
        0x01,
        0xff,
        0xd9
    ]);

/* ==========================================================
   ADMIN INITIALIZATION
========================================================== */

process.env.GCLOUD_PROJECT =
    PROJECT_ID;

process.env.FIRESTORE_EMULATOR_HOST =
    FIRESTORE_EMULATOR_HOST;

process.env.FIREBASE_AUTH_EMULATOR_HOST =
    AUTH_EMULATOR_HOST;

process.env.FIREBASE_STORAGE_EMULATOR_HOST =
    STORAGE_EMULATOR_HOST;

if (!admin.apps.length) {
    admin.initializeApp({
        projectId:
            PROJECT_ID,

        storageBucket:
            STORAGE_BUCKET
    });
}

const adminDb =
    admin.firestore();

const adminAuth =
    admin.auth();

const adminBucket =
    admin.storage()
        .bucket(STORAGE_BUCKET);

/* ==========================================================
   TEST STATE
========================================================== */

let customerOne;
let customerTwo;
let administrator;
let superAdministrator;

const clientApps =
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
        await clearStorageEmulator();

        await seedEnvironment();
    }
);

test.afterEach(
    async function () {
        await Promise.all(
            Array.from(clientApps)
                .map(
                    async function (app) {
                        try {
                            await deleteApp(app);
                        } catch {
                            // Ignore cleanup errors.
                        }
                    }
                )
        );

        clientApps.clear();
    }
);

test.after(
    async function () {
        await clearFirestoreEmulator();
        await clearAuthEmulator();
        await clearStorageEmulator();

        await admin.app().delete();
    }
);

/* ==========================================================
   PUBLIC PRODUCT ACCESS
========================================================== */

test(
    "unauthenticated client can read a published active product",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            createClient();

        const snapshot =
            await getDoc(
                doc(
                    client.db,
                    "products",
                    "published-product"
                )
            );

        assert.equal(
            snapshot.exists(),
            true
        );

        assert.equal(
            snapshot.data().published,
            true
        );

        assert.equal(
            snapshot.data().active,
            true
        );
    }
);

test(
    "unauthenticated client cannot read an unpublished product",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            createClient();

        await assertPermissionDenied(
            getDoc(
                doc(
                    client.db,
                    "products",
                    "draft-product"
                )
            )
        );
    }
);

test(
    "public product query succeeds when restricted to published active items",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            createClient();

        const snapshot =
            await getDocs(
                query(
                    collection(
                        client.db,
                        "products"
                    ),
                    where(
                        "published",
                        "==",
                        true
                    ),
                    where(
                        "active",
                        "==",
                        true
                    )
                )
            );

        assert.equal(
            snapshot.size,
            1
        );

        assert.equal(
            snapshot.docs[0].id,
            "published-product"
        );
    }
);

test(
    "unrestricted public product query is denied",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            createClient();

        await assertPermissionDenied(
            getDocs(
                collection(
                    client.db,
                    "products"
                )
            )
        );
    }
);

test(
    "customer cannot create or modify product documents",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        await assertPermissionDenied(
            setDoc(
                doc(
                    client.db,
                    "products",
                    "customer-product"
                ),
                {
                    name:
                        "Unauthorised Product",

                    active:
                        true,

                    published:
                        true,

                    price:
                        1
                }
            )
        );

        await assertPermissionDenied(
            updateDoc(
                doc(
                    client.db,
                    "products",
                    "published-product"
                ),
                {
                    inventory:
                        999999
                }
            )
        );

        await assertPermissionDenied(
            deleteDoc(
                doc(
                    client.db,
                    "products",
                    "published-product"
                )
            )
        );
    }
);

test(
    "administrator can manage product documents",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                administrator.email
            );

        const productReference =
            doc(
                client.db,
                "products",
                "administrator-product"
            );

        await setDoc(
            productReference,
            {
                name:
                    "Administrator Product",

                slug:
                    "administrator-product",

                active:
                    true,

                published:
                    false,

                price:
                    100000,

                inventory:
                    5
            }
        );

        await updateDoc(
            productReference,
            {
                published:
                    true
            }
        );

        const snapshot =
            await getDoc(
                productReference
            );

        assert.equal(
            snapshot.data().published,
            true
        );

        await deleteDoc(
            productReference
        );

        const deletedSnapshot =
            await adminDb
                .doc(
                    "products/administrator-product"
                )
                .get();

        assert.equal(
            deletedSnapshot.exists,
            false
        );
    }
);

/* ==========================================================
   CATEGORY AND COLLECTION ACCESS
========================================================== */

test(
    "public client can read active categories and collections",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            createClient();

        const category =
            await getDoc(
                doc(
                    client.db,
                    "categories",
                    "outerwear"
                )
            );

        const collectionSnapshot =
            await getDoc(
                doc(
                    client.db,
                    "collections",
                    "signature"
                )
            );

        assert.equal(
            category.exists(),
            true
        );

        assert.equal(
            collectionSnapshot.exists(),
            true
        );
    }
);

test(
    "customer cannot write categories or collections",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        await assertPermissionDenied(
            setDoc(
                doc(
                    client.db,
                    "categories",
                    "customer-category"
                ),
                {
                    name:
                        "Customer Category",

                    active:
                        true
                }
            )
        );

        await assertPermissionDenied(
            setDoc(
                doc(
                    client.db,
                    "collections",
                    "customer-collection"
                ),
                {
                    name:
                        "Customer Collection",

                    active:
                        true
                }
            )
        );
    }
);

/* ==========================================================
   PROFILE ISOLATION
========================================================== */

test(
    "customer can read their own profile",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        const snapshot =
            await getDoc(
                doc(
                    client.db,
                    "users",
                    customerOne.uid
                )
            );

        assert.equal(
            snapshot.exists(),
            true
        );

        assert.equal(
            snapshot.data().uid,
            customerOne.uid
        );
    }
);

test(
    "customer cannot read another customer's profile",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        await assertPermissionDenied(
            getDoc(
                doc(
                    client.db,
                    "users",
                    customerTwo.uid
                )
            )
        );
    }
);

test(
    "unauthenticated client cannot read customer profiles",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            createClient();

        await assertPermissionDenied(
            getDoc(
                doc(
                    client.db,
                    "users",
                    customerOne.uid
                )
            )
        );
    }
);

test(
    "customer can update safe fields on their own profile",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        const profileReference =
            doc(
                client.db,
                "users",
                customerOne.uid
            );

        await updateDoc(
            profileReference,
            {
                displayName:
                    "Updated Customer",

                phoneNumber:
                    "+2348000000000"
            }
        );

        const snapshot =
            await getDoc(
                profileReference
            );

        assert.equal(
            snapshot.data()
                .displayName,
            "Updated Customer"
        );
    }
);

test(
    "customer cannot change their own role or status",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        const profileReference =
            doc(
                client.db,
                "users",
                customerOne.uid
            );

        await assertPermissionDenied(
            updateDoc(
                profileReference,
                {
                    role:
                        "admin"
                }
            )
        );

        await assertPermissionDenied(
            updateDoc(
                profileReference,
                {
                    status:
                        "disabled"
                }
            )
        );

        const snapshot =
            await adminDb
                .doc(
                    "users/" +
                    customerOne.uid
                )
                .get();

        assert.equal(
            snapshot.data().role,
            "customer"
        );

        assert.equal(
            snapshot.data().status,
            "active"
        );
    }
);

test(
    "customer cannot create another user's profile",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        await assertPermissionDenied(
            setDoc(
                doc(
                    client.db,
                    "users",
                    "different-user"
                ),
                {
                    uid:
                        "different-user",

                    email:
                        "different@example.com",

                    role:
                        "customer",

                    status:
                        "active"
                }
            )
        );
    }
);

test(
    "administrator can read and update customer account controls",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                administrator.email
            );

        const profileReference =
            doc(
                client.db,
                "users",
                customerOne.uid
            );

        const before =
            await getDoc(
                profileReference
            );

        assert.equal(
            before.exists(),
            true
        );

        await updateDoc(
            profileReference,
            {
                status:
                    "disabled",

                statusReason:
                    "Emulator security test"
            }
        );

        const after =
            await getDoc(
                profileReference
            );

        assert.equal(
            after.data().status,
            "disabled"
        );
    }
);

/* ==========================================================
   CART OWNERSHIP
========================================================== */

test(
    "customer can read and update their own cart",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        const cartReference =
            doc(
                client.db,
                "carts",
                customerOne.uid
            );

        const before =
            await getDoc(
                cartReference
            );

        assert.equal(
            before.exists(),
            true
        );

        await setDoc(
            cartReference,
            {
                userId:
                    customerOne.uid,

                items: [
                    {
                        productId:
                            "published-product",

                        quantity:
                            2
                    }
                ]
            }
        );

        const after =
            await getDoc(
                cartReference
            );

        assert.equal(
            after.data().items[0]
                .quantity,
            2
        );
    }
);

test(
    "customer cannot access another customer's cart",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        await assertPermissionDenied(
            getDoc(
                doc(
                    client.db,
                    "carts",
                    customerTwo.uid
                )
            )
        );

        await assertPermissionDenied(
            setDoc(
                doc(
                    client.db,
                    "carts",
                    customerTwo.uid
                ),
                {
                    userId:
                        customerTwo.uid,

                    items: []
                }
            )
        );
    }
);

test(
    "unauthenticated client cannot access carts",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            createClient();

        await assertPermissionDenied(
            getDoc(
                doc(
                    client.db,
                    "carts",
                    customerOne.uid
                )
            )
        );
    }
);

/* ==========================================================
   WISHLIST OWNERSHIP
========================================================== */

test(
    "customer can read and update their own wishlist",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        const wishlistReference =
            doc(
                client.db,
                "wishlists",
                customerOne.uid
            );

        const before =
            await getDoc(
                wishlistReference
            );

        assert.equal(
            before.exists(),
            true
        );

        await setDoc(
            wishlistReference,
            {
                userId:
                    customerOne.uid,

                productIds: [
                    "published-product",
                    "draft-product"
                ]
            }
        );

        const after =
            await getDoc(
                wishlistReference
            );

        assert.equal(
            after.data()
                .productIds.length,
            2
        );
    }
);

test(
    "customer cannot access another customer's wishlist",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        await assertPermissionDenied(
            getDoc(
                doc(
                    client.db,
                    "wishlists",
                    customerTwo.uid
                )
            )
        );

        await assertPermissionDenied(
            setDoc(
                doc(
                    client.db,
                    "wishlists",
                    customerTwo.uid
                ),
                {
                    userId:
                        customerTwo.uid,

                    productIds: []
                }
            )
        );
    }
);

/* ==========================================================
   ORDER BOUNDARIES
========================================================== */

test(
    "customer can read their own order",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        const snapshot =
            await getDoc(
                doc(
                    client.db,
                    "orders",
                    "customer-one-order"
                )
            );

        assert.equal(
            snapshot.exists(),
            true
        );

        assert.equal(
            snapshot.data().userId,
            customerOne.uid
        );
    }
);

test(
    "customer cannot read another customer's order",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        await assertPermissionDenied(
            getDoc(
                doc(
                    client.db,
                    "orders",
                    "customer-two-order"
                )
            )
        );
    }
);

test(
    "customer can query only their own orders",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        const snapshot =
            await getDocs(
                query(
                    collection(
                        client.db,
                        "orders"
                    ),
                    where(
                        "userId",
                        "==",
                        customerOne.uid
                    )
                )
            );

        assert.equal(
            snapshot.size,
            1
        );

        assert.equal(
            snapshot.docs[0].id,
            "customer-one-order"
        );
    }
);

test(
    "customer query for another user's orders is denied",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        await assertPermissionDenied(
            getDocs(
                query(
                    collection(
                        client.db,
                        "orders"
                    ),
                    where(
                        "userId",
                        "==",
                        customerTwo.uid
                    )
                )
            )
        );
    }
);

test(
    "customer cannot create, modify, or delete order documents directly",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        await assertPermissionDenied(
            setDoc(
                doc(
                    client.db,
                    "orders",
                    "forged-order"
                ),
                {
                    userId:
                        customerOne.uid,

                    status:
                        "confirmed",

                    paymentStatus:
                        "paid",

                    total:
                        1
                }
            )
        );

        await assertPermissionDenied(
            updateDoc(
                doc(
                    client.db,
                    "orders",
                    "customer-one-order"
                ),
                {
                    status:
                        "delivered"
                }
            )
        );

        await assertPermissionDenied(
            deleteDoc(
                doc(
                    client.db,
                    "orders",
                    "customer-one-order"
                )
            )
        );
    }
);

test(
    "administrator can read and update orders",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                administrator.email
            );

        const snapshot =
            await getDocs(
                collection(
                    client.db,
                    "orders"
                )
            );

        assert.equal(
            snapshot.size,
            2
        );

        const orderReference =
            doc(
                client.db,
                "orders",
                "customer-one-order"
            );

        await updateDoc(
            orderReference,
            {
                status:
                    "processing"
            }
        );

        const updated =
            await getDoc(
                orderReference
            );

        assert.equal(
            updated.data().status,
            "processing"
        );
    }
);

/* ==========================================================
   SENSITIVE FIRESTORE COLLECTIONS
========================================================== */

test(
    "customers cannot access coupons directly",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        await assertPermissionDenied(
            getDoc(
                doc(
                    client.db,
                    "coupons",
                    "WELCOME10"
                )
            )
        );
    }
);

test(
    "customers cannot access audit logs",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        await assertPermissionDenied(
            getDoc(
                doc(
                    client.db,
                    "auditLogs",
                    "audit-1"
                )
            )
        );

        await assertPermissionDenied(
            setDoc(
                doc(
                    client.db,
                    "auditLogs",
                    "forged-audit"
                ),
                {
                    action:
                        "forged.action"
                }
            )
        );
    }
);

test(
    "customers cannot access payment webhook events",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        await assertPermissionDenied(
            getDoc(
                doc(
                    client.db,
                    "paymentWebhookEvents",
                    "event-1"
                )
            )
        );

        await assertPermissionDenied(
            setDoc(
                doc(
                    client.db,
                    "paymentWebhookEvents",
                    "forged-event"
                ),
                {
                    processed:
                        true
                }
            )
        );
    }
);

test(
    "administrator cannot forge backend-only webhook records",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                administrator.email
            );

        await assertPermissionDenied(
            setDoc(
                doc(
                    client.db,
                    "paymentWebhookEvents",
                    "administrator-event"
                ),
                {
                    processed:
                        true,

                    provider:
                        "paystack"
                }
            )
        );
    }
);

/* ==========================================================
   CLAIM HARDENING
========================================================== */

test(
    "role field in Firestore does not grant administrator access without claims",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        await adminDb
            .doc(
                "users/" +
                customerOne.uid
            )
            .update({
                role:
                    "admin"
            });

        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        await assertPermissionDenied(
            updateDoc(
                doc(
                    client.db,
                    "products",
                    "published-product"
                ),
                {
                    price:
                        1
                }
            )
        );
    }
);

test(
    "explicit administrator claim grants privileged access",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                administrator.email
            );

        await updateDoc(
            doc(
                client.db,
                "products",
                "published-product"
            ),
            {
                featured:
                    true
            }
        );

        const snapshot =
            await getDoc(
                doc(
                    client.db,
                    "products",
                    "published-product"
                )
            );

        assert.equal(
            snapshot.data().featured,
            true
        );
    }
);

test(
    "super-administrator claim also grants privileged access",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                superAdministrator.email
            );

        await updateDoc(
            doc(
                client.db,
                "categories",
                "outerwear"
            ),
            {
                featured:
                    true
            }
        );

        const snapshot =
            await getDoc(
                doc(
                    client.db,
                    "categories",
                    "outerwear"
                )
            );

        assert.equal(
            snapshot.data().featured,
            true
        );
    }
);

/* ==========================================================
   PUBLIC STORAGE ASSETS
========================================================== */

test(
    "unauthenticated client can read public product assets",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            createClient();

        const bytes =
            await getBytes(
                ref(
                    client.storage,
                    "products/published-product/hero.jpg"
                )
            );

        assert.ok(
            bytes.byteLength > 0
        );
    }
);

test(
    "customer cannot upload or delete product assets",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        await assertStorageDenied(
            uploadBytes(
                ref(
                    client.storage,
                    "products/customer-product/hero.jpg"
                ),
                SMALL_JPEG,
                {
                    contentType:
                        "image/jpeg"
                }
            )
        );

        await assertStorageDenied(
            deleteObject(
                ref(
                    client.storage,
                    "products/published-product/hero.jpg"
                )
            )
        );
    }
);

test(
    "administrator can upload and delete product assets",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                administrator.email
            );

        const assetReference =
            ref(
                client.storage,
                "products/administrator-product/hero.jpg"
            );

        await uploadBytes(
            assetReference,
            SMALL_JPEG,
            {
                contentType:
                    "image/jpeg"
            }
        );

        const bytes =
            await getBytes(
                assetReference
            );

        assert.ok(
            bytes.byteLength > 0
        );

        await deleteObject(
            assetReference
        );

        await assertStorageMissing(
            getBytes(
                assetReference
            )
        );
    }
);

/* ==========================================================
   PRIVATE PROFILE STORAGE
========================================================== */

test(
    "customer can read and manage their own profile image",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        const avatarReference =
            ref(
                client.storage,
                "users/" +
                customerOne.uid +
                "/profile/new-avatar.jpg"
            );

        await uploadBytes(
            avatarReference,
            SMALL_JPEG,
            {
                contentType:
                    "image/jpeg"
            }
        );

        const bytes =
            await getBytes(
                avatarReference
            );

        assert.ok(
            bytes.byteLength > 0
        );

        await deleteObject(
            avatarReference
        );
    }
);

test(
    "customer cannot access another user's profile image",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        await assertStorageDenied(
            getBytes(
                ref(
                    client.storage,
                    "users/" +
                    customerTwo.uid +
                    "/profile/avatar.jpg"
                )
            )
        );

        await assertStorageDenied(
            uploadBytes(
                ref(
                    client.storage,
                    "users/" +
                    customerTwo.uid +
                    "/profile/hijacked.jpg"
                ),
                SMALL_JPEG,
                {
                    contentType:
                        "image/jpeg"
                }
            )
        );
    }
);

test(
    "unauthenticated client cannot access profile images",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            createClient();

        await assertStorageDenied(
            getBytes(
                ref(
                    client.storage,
                    "users/" +
                    customerOne.uid +
                    "/profile/avatar.jpg"
                )
            )
        );
    }
);

test(
    "customer cannot upload executable content as a profile image",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        await assertStorageDenied(
            uploadBytes(
                ref(
                    client.storage,
                    "users/" +
                    customerOne.uid +
                    "/profile/avatar.js"
                ),
                Buffer.from(
                    "alert('test')",
                    "utf8"
                ),
                {
                    contentType:
                        "application/javascript"
                }
            )
        );
    }
);

/* ==========================================================
   ORDER AND ADMIN STORAGE
========================================================== */

test(
    "customer can read their own order receipt",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        const bytes =
            await getBytes(
                ref(
                    client.storage,
                    "users/" +
                    customerOne.uid +
                    "/orders/customer-one-order/receipt.pdf"
                )
            );

        assert.ok(
            bytes.byteLength > 0
        );
    }
);

test(
    "customer cannot upload forged order receipts",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        await assertStorageDenied(
            uploadBytes(
                ref(
                    client.storage,
                    "users/" +
                    customerOne.uid +
                    "/orders/customer-one-order/forged.pdf"
                ),
                Buffer.from(
                    "%PDF-1.4 forged",
                    "utf8"
                ),
                {
                    contentType:
                        "application/pdf"
                }
            )
        );
    }
);

test(
    "customer cannot read administrator private files",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        await assertStorageDenied(
            getBytes(
                ref(
                    client.storage,
                    "admin/private/report.csv"
                )
            )
        );
    }
);

test(
    "administrator can read private administrator files",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                administrator.email
            );

        const bytes =
            await getBytes(
                ref(
                    client.storage,
                    "admin/private/report.csv"
                )
            );

        assert.ok(
            bytes.byteLength > 0
        );
    }
);

/* ==========================================================
   UNKNOWN PATHS
========================================================== */

test(
    "customer cannot write to undefined Firestore collections",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                customerOne.email
            );

        await assertPermissionDenied(
            setDoc(
                doc(
                    client.db,
                    "unknownCollection",
                    "unknown-document"
                ),
                {
                    value:
                        true
                }
            )
        );
    }
);

test(
    "administrator cannot write to undefined storage paths",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const client =
            await createAuthenticatedClient(
                administrator.email
            );

        await assertStorageDenied(
            uploadBytes(
                ref(
                    client.storage,
                    "unknown/private-file.txt"
                ),
                Buffer.from(
                    "test",
                    "utf8"
                ),
                {
                    contentType:
                        "text/plain"
                }
            )
        );
    }
);

/* ==========================================================
   SEEDING
========================================================== */

async function seedEnvironment() {
    customerOne =
        await createAdminUser({
            email:
                "customer-one@example.com",

            displayName:
                "Customer One",

            claims: {
                role:
                    "customer",

                admin:
                    false,

                superadmin:
                    false
            }
        });

    customerTwo =
        await createAdminUser({
            email:
                "customer-two@example.com",

            displayName:
                "Customer Two",

            claims: {
                role:
                    "customer",

                admin:
                    false,

                superadmin:
                    false
            }
        });

    administrator =
        await createAdminUser({
            email:
                "admin@example.com",

            displayName:
                "Administrator",

            claims: {
                role:
                    "admin",

                admin:
                    true,

                superadmin:
                    false
            }
        });

    superAdministrator =
        await createAdminUser({
            email:
                "owner@example.com",

            displayName:
                "Store Owner",

            claims: {
                role:
                    "superadmin",

                admin:
                    true,

                superadmin:
                    true
            }
        });

    const timestamp =
        admin.firestore
            .FieldValue
            .serverTimestamp();

    const batch =
        adminDb.batch();

    batch.set(
        adminDb.doc(
            "products/published-product"
        ),
        {
            name:
                "Signature Coat",

            slug:
                "signature-coat",

            price:
                250000,

            active:
                true,

            published:
                true,

            inventory:
                10,

            featured:
                false,

            createdAt:
                timestamp,

            updatedAt:
                timestamp
        }
    );

    batch.set(
        adminDb.doc(
            "products/draft-product"
        ),
        {
            name:
                "Draft Dress",

            slug:
                "draft-dress",

            price:
                180000,

            active:
                true,

            published:
                false,

            inventory:
                5,

            createdAt:
                timestamp,

            updatedAt:
                timestamp
        }
    );

    batch.set(
        adminDb.doc(
            "categories/outerwear"
        ),
        {
            name:
                "Outerwear",

            slug:
                "outerwear",

            active:
                true,

            featured:
                false
        }
    );

    batch.set(
        adminDb.doc(
            "collections/signature"
        ),
        {
            name:
                "Signature",

            slug:
                "signature",

            active:
                true
        }
    );

    [
        customerOne,
        customerTwo,
        administrator,
        superAdministrator
    ].forEach(
        function (user) {
            const role =
                user.customClaims.role;

            batch.set(
                adminDb.doc(
                    "users/" +
                    user.uid
                ),
                {
                    uid:
                        user.uid,

                    email:
                        user.email,

                    displayName:
                        user.displayName,

                    role:
                        role,

                    status:
                        "active",

                    addresses:
                        [],

                    createdAt:
                        timestamp,

                    updatedAt:
                        timestamp
                }
            );
        }
    );

    batch.set(
        adminDb.doc(
            "carts/" +
            customerOne.uid
        ),
        {
            userId:
                customerOne.uid,

            items: [
                {
                    productId:
                        "published-product",

                    quantity:
                        1
                }
            ]
        }
    );

    batch.set(
        adminDb.doc(
            "carts/" +
            customerTwo.uid
        ),
        {
            userId:
                customerTwo.uid,

            items: []
        }
    );

    batch.set(
        adminDb.doc(
            "wishlists/" +
            customerOne.uid
        ),
        {
            userId:
                customerOne.uid,

            productIds: [
                "published-product"
            ]
        }
    );

    batch.set(
        adminDb.doc(
            "wishlists/" +
            customerTwo.uid
        ),
        {
            userId:
                customerTwo.uid,

            productIds: []
        }
    );

    batch.set(
        adminDb.doc(
            "orders/customer-one-order"
        ),
        {
            userId:
                customerOne.uid,

            orderNumber:
                "LET-CUSTOMER-ONE",

            status:
                "confirmed",

            paymentStatus:
                "paid",

            currency:
                "NGN",

            total:
                250000,

            items:
                [],

            createdAt:
                timestamp,

            updatedAt:
                timestamp
        }
    );

    batch.set(
        adminDb.doc(
            "orders/customer-two-order"
        ),
        {
            userId:
                customerTwo.uid,

            orderNumber:
                "LET-CUSTOMER-TWO",

            status:
                "pending",

            paymentStatus:
                "pending",

            currency:
                "NGN",

            total:
                180000,

            items:
                [],

            createdAt:
                timestamp,

            updatedAt:
                timestamp
        }
    );

    batch.set(
        adminDb.doc(
            "coupons/WELCOME10"
        ),
        {
            code:
                "WELCOME10",

            active:
                true,

            type:
                "percentage",

            value:
                10
        }
    );

    batch.set(
        adminDb.doc(
            "auditLogs/audit-1"
        ),
        {
            action:
                "test.seeded",

            actorId:
                administrator.uid,

            createdAt:
                timestamp
        }
    );

    batch.set(
        adminDb.doc(
            "paymentWebhookEvents/event-1"
        ),
        {
            provider:
                "paystack",

            processed:
                true,

            createdAt:
                timestamp
        }
    );

    await batch.commit();

    await Promise.all([
        uploadAdminFile(
            "products/published-product/hero.jpg",
            SMALL_JPEG,
            "image/jpeg"
        ),

        uploadAdminFile(
            "users/" +
            customerOne.uid +
            "/profile/avatar.jpg",
            SMALL_JPEG,
            "image/jpeg"
        ),

        uploadAdminFile(
            "users/" +
            customerTwo.uid +
            "/profile/avatar.jpg",
            SMALL_JPEG,
            "image/jpeg"
        ),

        uploadAdminFile(
            "users/" +
            customerOne.uid +
            "/orders/customer-one-order/receipt.pdf",
            Buffer.from(
                "%PDF-1.4 receipt",
                "utf8"
            ),
            "application/pdf"
        ),

        uploadAdminFile(
            "admin/private/report.csv",
            Buffer.from(
                "name,value\nsales,10",
                "utf8"
            ),
            "text/csv"
        )
    ]);
}

/* ==========================================================
   CLIENT HELPERS
========================================================== */

function createClient() {
    const app =
        initializeApp(
            {
                apiKey:
                    "fake-api-key",

                authDomain:
                    PROJECT_ID +
                    ".firebaseapp.com",

                projectId:
                    PROJECT_ID,

                storageBucket:
                    STORAGE_BUCKET
            },
            "client-" +
            Date.now() +
            "-" +
            Math.random()
                .toString(36)
                .slice(2)
        );

    clientApps.add(app);

    const authClient =
        getAuth(app);

    const firestoreClient =
        getFirestore(app);

    const storageClient =
        getStorage(app);

    const authAddress =
        parseHost(
            AUTH_EMULATOR_HOST
        );

    const firestoreAddress =
        parseHost(
            FIRESTORE_EMULATOR_HOST
        );

    const storageAddress =
        parseHost(
            STORAGE_EMULATOR_HOST
        );

    connectAuthEmulator(
        authClient,
        "http://" +
        AUTH_EMULATOR_HOST,
        {
            disableWarnings:
                true
        }
    );

    connectFirestoreEmulator(
        firestoreClient,
        firestoreAddress.host,
        firestoreAddress.port
    );

    connectStorageEmulator(
        storageClient,
        storageAddress.host,
        storageAddress.port
    );

    return {
        app:
            app,

        auth:
            authClient,

        db:
            firestoreClient,

        storage:
            storageClient
    };
}

async function createAuthenticatedClient(
    email
) {
    const client =
        createClient();

    await signInWithEmailAndPassword(
        client.auth,
        email,
        TEST_PASSWORD
    );

    return client;
}

async function createAdminUser(options) {
    const user =
        await adminAuth.createUser({
            email:
                options.email,

            password:
                TEST_PASSWORD,

            displayName:
                options.displayName,

            emailVerified:
                true,

            disabled:
                false
        });

    await adminAuth
        .setCustomUserClaims(
            user.uid,
            options.claims || {}
        );

    return Object.assign(
        {},
        user,

        {
            customClaims:
                options.claims || {}
        }
    );
}

/* ==========================================================
   ASSERTION HELPERS
========================================================== */

async function assertPermissionDenied(
    promise
) {
    await assert.rejects(
        promise,
        function (error) {
            const code =
                String(
                    error.code ||
                    ""
                );

            assert.match(
                code,
                /permission-denied|PERMISSION_DENIED/
            );

            return true;
        }
    );
}

async function assertStorageDenied(
    promise
) {
    await assert.rejects(
        promise,
        function (error) {
            const code =
                String(
                    error.code ||
                    ""
                );

            assert.match(
                code,
                /storage\/unauthorized|unauthorized|permission-denied/
            );

            return true;
        }
    );
}

async function assertStorageMissing(
    promise
) {
    await assert.rejects(
        promise,
        function (error) {
            const code =
                String(
                    error.code ||
                    ""
                );

            assert.match(
                code,
                /storage\/object-not-found|object-not-found/
            );

            return true;
        }
    );
}

/* ==========================================================
   EMULATOR MANAGEMENT
========================================================== */

async function assertEmulatorsAvailable() {
    const failures = [];

    try {
        await adminDb
            .doc(
                "emulatorChecks/firestore"
            )
            .set({
                available:
                    true
            });

        await adminDb
            .doc(
                "emulatorChecks/firestore"
            )
            .delete();
    } catch (error) {
        failures.push(
            "Firestore emulator unavailable at " +
            FIRESTORE_EMULATOR_HOST +
            ": " +
            error.message
        );
    }

    try {
        const response =
            await fetchWithTimeout(
                "http://" +
                AUTH_EMULATOR_HOST +
                "/emulator/v1/projects/" +
                PROJECT_ID +
                "/config",
                {
                    method:
                        "GET"
                },
                5000
            );

        if (
            response.status < 200 ||
            response.status >= 500
        ) {
            failures.push(
                "Auth emulator returned HTTP " +
                response.status
            );
        }
    } catch (error) {
        failures.push(
            "Auth emulator unavailable at " +
            AUTH_EMULATOR_HOST +
            ": " +
            error.message
        );
    }

    try {
        const response =
            await fetchWithTimeout(
                "http://" +
                STORAGE_EMULATOR_HOST,
                {
                    method:
                        "GET"
                },
                5000
            );

        assert.ok(
            response.status >= 200
        );
    } catch (error) {
        failures.push(
            "Storage emulator unavailable at " +
            STORAGE_EMULATOR_HOST +
            ": " +
            error.message
        );
    }

    if (failures.length) {
        throw new Error(
            [
                "Firebase security emulator tests cannot start.",
                "",
                ...failures,
                "",
                "Start them with:",
                "firebase emulators:exec --only firestore,auth,storage \"npm --prefix functions run test:emulator:security\""
            ].join("\n")
        );
    }
}

async function clearFirestoreEmulator() {
    const response =
        await fetchWithTimeout(
            "http://" +
            FIRESTORE_EMULATOR_HOST +
            "/emulator/v1/projects/" +
            PROJECT_ID +
            "/databases/(default)/documents",
            {
                method:
                    "DELETE"
            },
            10000
        );

    if (!response.ok) {
        throw new Error(
            "Unable to clear Firestore emulator: HTTP " +
            response.status
        );
    }
}

async function clearAuthEmulator() {
    const response =
        await fetchWithTimeout(
            "http://" +
            AUTH_EMULATOR_HOST +
            "/emulator/v1/projects/" +
            PROJECT_ID +
            "/accounts",
            {
                method:
                    "DELETE"
            },
            10000
        );

    if (!response.ok) {
        throw new Error(
            "Unable to clear Auth emulator: HTTP " +
            response.status
        );
    }
}

async function clearStorageEmulator() {
    const response =
        await fetchWithTimeout(
            "http://" +
            STORAGE_EMULATOR_HOST +
            "/emulator/v1/projects/" +
            PROJECT_ID +
            "/buckets/" +
            encodeURIComponent(
                STORAGE_BUCKET
            ) +
            "/objects",
            {
                method:
                    "DELETE"
            },
            10000
        );

    /*
     * Some emulator versions return 404 when the bucket has
     * not yet been created. That is equivalent to an empty bucket.
     */
    if (
        !response.ok &&
        response.status !== 404
    ) {
        throw new Error(
            "Unable to clear Storage emulator: HTTP " +
            response.status
        );
    }
}

async function uploadAdminFile(
    filePath,
    contents,
    contentType
) {
    const file =
        adminBucket.file(
            filePath
        );

    await file.save(
        contents,
        {
            resumable:
                false,

            metadata: {
                contentType:
                    contentType
            }
        }
    );
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

function parseHost(value) {
    const parts =
        String(value)
            .split(":");

    return {
        host:
            parts[0],

        port:
            Number(
                parts[1]
            )
    };
}