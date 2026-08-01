"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   FIRESTORE SECURITY RULES TESTS
========================================================== */

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const assert = require(
    "node:assert/strict"
);

const {
    initializeTestEnvironment,
    assertSucceeds,
    assertFails
} = require(
    "@firebase/rules-unit-testing"
);

const {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    collection,
    addDoc,
    getDocs,
    query,
    where
} = require(
    "firebase/firestore"
);

/* ==========================================================
   CONSTANTS
========================================================== */

const PROJECT_ID =
    "leternel-store-rules-test";

const RULES_PATH =
    path.resolve(
        __dirname,
        "../../firestore.rules"
    );

let testEnvironment;

/* ==========================================================
   TEST LIFECYCLE
========================================================== */

test.before(
    async function () {
        const rules =
            fs.readFileSync(
                RULES_PATH,
                "utf8"
            );

        testEnvironment =
            await initializeTestEnvironment({
                projectId:
                    PROJECT_ID,

                firestore: {
                    rules:
                        rules
                }
            });
    }
);

test.beforeEach(
    async function () {
        await testEnvironment
            .clearFirestore();

        await seedFirestore();
    }
);

test.after(
    async function () {
        if (testEnvironment) {
            await testEnvironment
                .cleanup();
        }
    }
);

/* ==========================================================
   TEST CONTEXT HELPERS
========================================================== */

function unauthenticatedDb() {
    return testEnvironment
        .unauthenticatedContext()
        .firestore();
}

function customerDb(
    userId,
    claims
) {
    return testEnvironment
        .authenticatedContext(
            userId,
            Object.assign(
                {
                    email:
                        userId +
                        "@example.com",

                    email_verified:
                        true,

                    role:
                        "customer"
                },
                claims || {}
            )
        )
        .firestore();
}

function adminDb(
    userId
) {
    return testEnvironment
        .authenticatedContext(
            userId || "admin-1",
            {
                email:
                    "admin@example.com",

                email_verified:
                    true,

                role:
                    "admin",

                admin:
                    true
            }
        )
        .firestore();
}

function superAdminDb(
    userId
) {
    return testEnvironment
        .authenticatedContext(
            userId ||
            "superadmin-1",
            {
                email:
                    "owner@example.com",

                email_verified:
                    true,

                role:
                    "superadmin",

                admin:
                    true,

                superadmin:
                    true
            }
        )
        .firestore();
}

/* ==========================================================
   SEED DATA
========================================================== */

async function seedFirestore() {
    await testEnvironment
        .withSecurityRulesDisabled(
            async function (context) {
                const db =
                    context.firestore();

                await Promise.all([
                    setDoc(
                        doc(
                            db,
                            "products/product-public"
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
                                10
                        }
                    ),

                    setDoc(
                        doc(
                            db,
                            "products/product-draft"
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
                                5
                        }
                    ),

                    setDoc(
                        doc(
                            db,
                            "categories/outerwear"
                        ),
                        {
                            name:
                                "Outerwear",

                            slug:
                                "outerwear",

                            active:
                                true
                        }
                    ),

                    setDoc(
                        doc(
                            db,
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
                    ),

                    setDoc(
                        doc(
                            db,
                            "users/customer-1"
                        ),
                        {
                            uid:
                                "customer-1",

                            email:
                                "customer-1@example.com",

                            displayName:
                                "Customer One",

                            role:
                                "customer",

                            status:
                                "active",

                            addresses:
                                []
                        }
                    ),

                    setDoc(
                        doc(
                            db,
                            "users/customer-2"
                        ),
                        {
                            uid:
                                "customer-2",

                            email:
                                "customer-2@example.com",

                            displayName:
                                "Customer Two",

                            role:
                                "customer",

                            status:
                                "active",

                            addresses:
                                []
                        }
                    ),

                    setDoc(
                        doc(
                            db,
                            "users/admin-1"
                        ),
                        {
                            uid:
                                "admin-1",

                            email:
                                "admin@example.com",

                            role:
                                "admin",

                            status:
                                "active"
                        }
                    ),

                    setDoc(
                        doc(
                            db,
                            "carts/customer-1"
                        ),
                        {
                            userId:
                                "customer-1",

                            items: [
                                {
                                    productId:
                                        "product-public",

                                    quantity:
                                        1
                                }
                            ]
                        }
                    ),

                    setDoc(
                        doc(
                            db,
                            "wishlists/customer-1"
                        ),
                        {
                            userId:
                                "customer-1",

                            productIds: [
                                "product-public"
                            ]
                        }
                    ),

                    setDoc(
                        doc(
                            db,
                            "orders/order-1"
                        ),
                        {
                            userId:
                                "customer-1",

                            orderNumber:
                                "LET-ORDER-1",

                            status:
                                "pending",

                            paymentStatus:
                                "pending",

                            total:
                                250000
                        }
                    ),

                    setDoc(
                        doc(
                            db,
                            "orders/order-2"
                        ),
                        {
                            userId:
                                "customer-2",

                            orderNumber:
                                "LET-ORDER-2",

                            status:
                                "confirmed",

                            paymentStatus:
                                "paid",

                            total:
                                180000
                        }
                    ),

                    setDoc(
                        doc(
                            db,
                            "coupons/SUMMER25"
                        ),
                        {
                            code:
                                "SUMMER25",

                            active:
                                true,

                            type:
                                "percentage",

                            value:
                                25
                        }
                    ),

                    setDoc(
                        doc(
                            db,
                            "auditLogs/audit-1"
                        ),
                        {
                            action:
                                "order.created",

                            targetId:
                                "order-1"
                        }
                    )
                ]);
            }
        );
}

/* ==========================================================
   PRODUCT READS
========================================================== */

test(
    "unauthenticated users can read a published active product",
    async function () {
        const db =
            unauthenticatedDb();

        await assertSucceeds(
            getDoc(
                doc(
                    db,
                    "products/product-public"
                )
            )
        );
    }
);

test(
    "unauthenticated users cannot read an unpublished product",
    async function () {
        const db =
            unauthenticatedDb();

        await assertFails(
            getDoc(
                doc(
                    db,
                    "products/product-draft"
                )
            )
        );
    }
);

test(
    "customers can query published active products",
    async function () {
        const db =
            customerDb(
                "customer-1"
            );

        await assertSucceeds(
            getDocs(
                query(
                    collection(
                        db,
                        "products"
                    ),
                    where(
                        "active",
                        "==",
                        true
                    ),
                    where(
                        "published",
                        "==",
                        true
                    )
                )
            )
        );
    }
);

test(
    "public product query without publication filters is rejected",
    async function () {
        const db =
            unauthenticatedDb();

        await assertFails(
            getDocs(
                collection(
                    db,
                    "products"
                )
            )
        );
    }
);

test(
    "customers cannot create products",
    async function () {
        const db =
            customerDb(
                "customer-1"
            );

        await assertFails(
            setDoc(
                doc(
                    db,
                    "products/customer-created"
                ),
                {
                    name:
                        "Unauthorized Product",

                    active:
                        true,

                    published:
                        true,

                    price:
                        1000
                }
            )
        );
    }
);

test(
    "administrators can create products",
    async function () {
        const db =
            adminDb();

        await assertSucceeds(
            setDoc(
                doc(
                    db,
                    "products/admin-created"
                ),
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
                        100000
                }
            )
        );
    }
);

test(
    "administrators can update products",
    async function () {
        const db =
            adminDb();

        await assertSucceeds(
            updateDoc(
                doc(
                    db,
                    "products/product-public"
                ),
                {
                    price:
                        275000
                }
            )
        );
    }
);

test(
    "customers cannot alter product inventory",
    async function () {
        const db =
            customerDb(
                "customer-1"
            );

        await assertFails(
            updateDoc(
                doc(
                    db,
                    "products/product-public"
                ),
                {
                    inventory:
                        999999
                }
            )
        );
    }
);

/* ==========================================================
   CATEGORY & COLLECTION READS
========================================================== */

test(
    "public users can read active categories",
    async function () {
        const db =
            unauthenticatedDb();

        await assertSucceeds(
            getDoc(
                doc(
                    db,
                    "categories/outerwear"
                )
            )
        );
    }
);

test(
    "public users can read active collections",
    async function () {
        const db =
            unauthenticatedDb();

        await assertSucceeds(
            getDoc(
                doc(
                    db,
                    "collections/signature"
                )
            )
        );
    }
);

test(
    "customers cannot create categories",
    async function () {
        const db =
            customerDb(
                "customer-1"
            );

        await assertFails(
            setDoc(
                doc(
                    db,
                    "categories/customer-category"
                ),
                {
                    name:
                        "Unauthorized",

                    slug:
                        "unauthorized",

                    active:
                        true
                }
            )
        );
    }
);

test(
    "administrators can create categories",
    async function () {
        const db =
            adminDb();

        await assertSucceeds(
            setDoc(
                doc(
                    db,
                    "categories/accessories"
                ),
                {
                    name:
                        "Accessories",

                    slug:
                        "accessories",

                    active:
                        true
                }
            )
        );
    }
);

/* ==========================================================
   USER PROFILES
========================================================== */

test(
    "customers can read their own profile",
    async function () {
        const db =
            customerDb(
                "customer-1"
            );

        await assertSucceeds(
            getDoc(
                doc(
                    db,
                    "users/customer-1"
                )
            )
        );
    }
);

test(
    "customers cannot read another customer's profile",
    async function () {
        const db =
            customerDb(
                "customer-1"
            );

        await assertFails(
            getDoc(
                doc(
                    db,
                    "users/customer-2"
                )
            )
        );
    }
);

test(
    "unauthenticated users cannot read user profiles",
    async function () {
        const db =
            unauthenticatedDb();

        await assertFails(
            getDoc(
                doc(
                    db,
                    "users/customer-1"
                )
            )
        );
    }
);

test(
    "customers can create their own profile with customer role",
    async function () {
        const db =
            customerDb(
                "new-customer"
            );

        await assertSucceeds(
            setDoc(
                doc(
                    db,
                    "users/new-customer"
                ),
                {
                    uid:
                        "new-customer",

                    email:
                        "new-customer@example.com",

                    displayName:
                        "New Customer",

                    role:
                        "customer",

                    status:
                        "active",

                    addresses:
                        []
                }
            )
        );
    }
);

test(
    "customers cannot create another user's profile",
    async function () {
        const db =
            customerDb(
                "customer-1"
            );

        await assertFails(
            setDoc(
                doc(
                    db,
                    "users/other-user"
                ),
                {
                    uid:
                        "other-user",

                    email:
                        "other@example.com",

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
    "customers cannot assign themselves administrator role",
    async function () {
        const db =
            customerDb(
                "new-customer"
            );

        await assertFails(
            setDoc(
                doc(
                    db,
                    "users/new-customer"
                ),
                {
                    uid:
                        "new-customer",

                    email:
                        "new-customer@example.com",

                    role:
                        "admin",

                    status:
                        "active"
                }
            )
        );
    }
);

test(
    "customers can update safe profile fields",
    async function () {
        const db =
            customerDb(
                "customer-1"
            );

        await assertSucceeds(
            updateDoc(
                doc(
                    db,
                    "users/customer-1"
                ),
                {
                    displayName:
                        "Updated Customer",

                    phoneNumber:
                        "+2348000000000"
                }
            )
        );
    }
);

test(
    "customers cannot change their role",
    async function () {
        const db =
            customerDb(
                "customer-1"
            );

        await assertFails(
            updateDoc(
                doc(
                    db,
                    "users/customer-1"
                ),
                {
                    role:
                        "admin"
                }
            )
        );
    }
);

test(
    "customers cannot change their account status",
    async function () {
        const db =
            customerDb(
                "customer-1"
            );

        await assertFails(
            updateDoc(
                doc(
                    db,
                    "users/customer-1"
                ),
                {
                    status:
                        "disabled"
                }
            )
        );
    }
);

test(
    "administrators can read customer profiles",
    async function () {
        const db =
            adminDb();

        await assertSucceeds(
            getDoc(
                doc(
                    db,
                    "users/customer-1"
                )
            )
        );
    }
);

/* ==========================================================
   CARTS
========================================================== */

test(
    "customers can read their own cart",
    async function () {
        const db =
            customerDb(
                "customer-1"
            );

        await assertSucceeds(
            getDoc(
                doc(
                    db,
                    "carts/customer-1"
                )
            )
        );
    }
);

test(
    "customers cannot read another customer's cart",
    async function () {
        const db =
            customerDb(
                "customer-2"
            );

        await assertFails(
            getDoc(
                doc(
                    db,
                    "carts/customer-1"
                )
            )
        );
    }
);

test(
    "customers can update their own cart",
    async function () {
        const db =
            customerDb(
                "customer-1"
            );

        await assertSucceeds(
            setDoc(
                doc(
                    db,
                    "carts/customer-1"
                ),
                {
                    userId:
                        "customer-1",

                    items: [
                        {
                            productId:
                                "product-public",

                            quantity:
                                2
                        }
                    ]
                }
            )
        );
    }
);

test(
    "customers cannot write another customer's cart",
    async function () {
        const db =
            customerDb(
                "customer-2"
            );

        await assertFails(
            setDoc(
                doc(
                    db,
                    "carts/customer-1"
                ),
                {
                    userId:
                        "customer-1",

                    items: []
                }
            )
        );
    }
);

test(
    "unauthenticated users cannot access carts",
    async function () {
        const db =
            unauthenticatedDb();

        await assertFails(
            getDoc(
                doc(
                    db,
                    "carts/customer-1"
                )
            )
        );
    }
);

/* ==========================================================
   WISHLISTS
========================================================== */

test(
    "customers can read their own wishlist",
    async function () {
        const db =
            customerDb(
                "customer-1"
            );

        await assertSucceeds(
            getDoc(
                doc(
                    db,
                    "wishlists/customer-1"
                )
            )
        );
    }
);

test(
    "customers can update their own wishlist",
    async function () {
        const db =
            customerDb(
                "customer-1"
            );

        await assertSucceeds(
            setDoc(
                doc(
                    db,
                    "wishlists/customer-1"
                ),
                {
                    userId:
                        "customer-1",

                    productIds: [
                        "product-public",
                        "product-draft"
                    ]
                }
            )
        );
    }
);

test(
    "customers cannot read another customer's wishlist",
    async function () {
        const db =
            customerDb(
                "customer-2"
            );

        await assertFails(
            getDoc(
                doc(
                    db,
                    "wishlists/customer-1"
                )
            )
        );
    }
);

/* ==========================================================
   ORDERS
========================================================== */

test(
    "customers can read their own order",
    async function () {
        const db =
            customerDb(
                "customer-1"
            );

        await assertSucceeds(
            getDoc(
                doc(
                    db,
                    "orders/order-1"
                )
            )
        );
    }
);

test(
    "customers cannot read another customer's order",
    async function () {
        const db =
            customerDb(
                "customer-1"
            );

        await assertFails(
            getDoc(
                doc(
                    db,
                    "orders/order-2"
                )
            )
        );
    }
);

test(
    "customers can query only their own orders",
    async function () {
        const db =
            customerDb(
                "customer-1"
            );

        await assertSucceeds(
            getDocs(
                query(
                    collection(
                        db,
                        "orders"
                    ),
                    where(
                        "userId",
                        "==",
                        "customer-1"
                    )
                )
            )
        );
    }
);

test(
    "customers cannot query another user's orders",
    async function () {
        const db =
            customerDb(
                "customer-1"
            );

        await assertFails(
            getDocs(
                query(
                    collection(
                        db,
                        "orders"
                    ),
                    where(
                        "userId",
                        "==",
                        "customer-2"
                    )
                )
            )
        );
    }
);

test(
    "customers cannot create orders directly",
    async function () {
        const db =
            customerDb(
                "customer-1"
            );

        await assertFails(
            addDoc(
                collection(
                    db,
                    "orders"
                ),
                {
                    userId:
                        "customer-1",

                    status:
                        "pending",

                    paymentStatus:
                        "paid",

                    total:
                        1
                }
            )
        );
    }
);

test(
    "customers cannot update order status directly",
    async function () {
        const db =
            customerDb(
                "customer-1"
            );

        await assertFails(
            updateDoc(
                doc(
                    db,
                    "orders/order-1"
                ),
                {
                    status:
                        "delivered"
                }
            )
        );
    }
);

test(
    "customers cannot delete orders",
    async function () {
        const db =
            customerDb(
                "customer-1"
            );

        await assertFails(
            deleteDoc(
                doc(
                    db,
                    "orders/order-1"
                )
            )
        );
    }
);

test(
    "administrators can read all orders",
    async function () {
        const db =
            adminDb();

        await assertSucceeds(
            getDocs(
                collection(
                    db,
                    "orders"
                )
            )
        );
    }
);

test(
    "administrators can update order status",
    async function () {
        const db =
            adminDb();

        await assertSucceeds(
            updateDoc(
                doc(
                    db,
                    "orders/order-1"
                ),
                {
                    status:
                        "processing"
                }
            )
        );
    }
);

/* ==========================================================
   COUPONS
========================================================== */

test(
    "customers cannot read coupon documents directly",
    async function () {
        const db =
            customerDb(
                "customer-1"
            );

        await assertFails(
            getDoc(
                doc(
                    db,
                    "coupons/SUMMER25"
                )
            )
        );
    }
);

test(
    "unauthenticated users cannot read coupons",
    async function () {
        const db =
            unauthenticatedDb();

        await assertFails(
            getDoc(
                doc(
                    db,
                    "coupons/SUMMER25"
                )
            )
        );
    }
);

test(
    "administrators can manage coupons",
    async function () {
        const db =
            adminDb();

        await assertSucceeds(
            updateDoc(
                doc(
                    db,
                    "coupons/SUMMER25"
                ),
                {
                    active:
                        false
                }
            )
        );
    }
);

/* ==========================================================
   AUDIT LOGS
========================================================== */

test(
    "customers cannot read audit logs",
    async function () {
        const db =
            customerDb(
                "customer-1"
            );

        await assertFails(
            getDoc(
                doc(
                    db,
                    "auditLogs/audit-1"
                )
            )
        );
    }
);

test(
    "customers cannot create audit logs",
    async function () {
        const db =
            customerDb(
                "customer-1"
            );

        await assertFails(
            addDoc(
                collection(
                    db,
                    "auditLogs"
                ),
                {
                    action:
                        "fake.audit"
                }
            )
        );
    }
);

test(
    "administrators can read audit logs",
    async function () {
        const db =
            adminDb();

        await assertSucceeds(
            getDoc(
                doc(
                    db,
                    "auditLogs/audit-1"
                )
            )
        );
    }
);

/* ==========================================================
   INTERNAL COLLECTIONS
========================================================== */

test(
    "customers cannot access order idempotency documents",
    async function () {
        const db =
            customerDb(
                "customer-1"
            );

        await assertFails(
            getDoc(
                doc(
                    db,
                    "orderIdempotency/key-1"
                )
            )
        );
    }
);

test(
    "customers cannot access payment webhook events",
    async function () {
        const db =
            customerDb(
                "customer-1"
            );

        await assertFails(
            getDoc(
                doc(
                    db,
                    "paymentWebhookEvents/event-1"
                )
            )
        );
    }
);

test(
    "administrators cannot directly write backend-only webhook events",
    async function () {
        const db =
            adminDb();

        await assertFails(
            setDoc(
                doc(
                    db,
                    "paymentWebhookEvents/event-1"
                ),
                {
                    processed:
                        true
                }
            )
        );
    }
);

/* ==========================================================
   ADMINISTRATOR CLAIMS
========================================================== */

test(
    "admin claim grants administrator access",
    async function () {
        const db =
            adminDb();

        await assertSucceeds(
            getDoc(
                doc(
                    db,
                    "users/customer-1"
                )
            )
        );
    }
);

test(
    "super-admin claim grants administrator access",
    async function () {
        const db =
            superAdminDb();

        await assertSucceeds(
            updateDoc(
                doc(
                    db,
                    "products/product-public"
                ),
                {
                    featured:
                        true
                }
            )
        );
    }
);

test(
    "role text without admin claim follows configured role logic",
    async function () {
        const db =
            customerDb(
                "fake-admin",
                {
                    role:
                        "admin",

                    admin:
                        false
                }
            );

        /*
         * This assertion reflects the intended hardened behavior:
         * the explicit admin claim must be trusted, rather than a
         * client-controlled profile document.
         */
        await assertFails(
            updateDoc(
                doc(
                    db,
                    "products/product-public"
                ),
                {
                    price:
                        1
                }
            )
        );
    }
);