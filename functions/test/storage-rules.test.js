"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   STORAGE SECURITY RULES TESTS
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
    ref,
    uploadBytes,
    getBytes,
    deleteObject,
    getMetadata,
    updateMetadata
} = require(
    "firebase/storage"
);

/* ==========================================================
   CONSTANTS
========================================================== */

const PROJECT_ID =
    "leternel-store-storage-rules-test";

const STORAGE_BUCKET =
    PROJECT_ID +
    ".appspot.com";

const RULES_PATH =
    path.resolve(
        __dirname,
        "../../storage.rules"
    );

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

const SMALL_PNG =
    Buffer.from([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a,
        0x00,
        0x00,
        0x00,
        0x0d,
        0x49,
        0x48,
        0x44,
        0x52
    ]);

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

                storage: {
                    rules:
                        rules,

                    host:
                        "127.0.0.1",

                    port:
                        9199
                }
            });
    }
);

test.beforeEach(
    async function () {
        await testEnvironment
            .clearStorage();

        await seedStorage();
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
   CONTEXT HELPERS
========================================================== */

function unauthenticatedStorage() {
    return testEnvironment
        .unauthenticatedContext()
        .storage(
            STORAGE_BUCKET
        );
}

function customerStorage(
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
        .storage(
            STORAGE_BUCKET
        );
}

function adminStorage(
    userId
) {
    return testEnvironment
        .authenticatedContext(
            userId ||
            "admin-1",
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
        .storage(
            STORAGE_BUCKET
        );
}

function superAdminStorage(
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
        .storage(
            STORAGE_BUCKET
        );
}

/* ==========================================================
   SEED DATA
========================================================== */

async function seedStorage() {
    await testEnvironment
        .withSecurityRulesDisabled(
            async function (context) {
                const storage =
                    context.storage(
                        STORAGE_BUCKET
                    );

                await Promise.all([
                    uploadBytes(
                        ref(
                            storage,
                            "products/product-1/hero.jpg"
                        ),
                        SMALL_JPEG,
                        {
                            contentType:
                                "image/jpeg",

                            customMetadata: {
                                productId:
                                    "product-1"
                            }
                        }
                    ),

                    uploadBytes(
                        ref(
                            storage,
                            "categories/outerwear.jpg"
                        ),
                        SMALL_JPEG,
                        {
                            contentType:
                                "image/jpeg"
                        }
                    ),

                    uploadBytes(
                        ref(
                            storage,
                            "collections/signature.jpg"
                        ),
                        SMALL_JPEG,
                        {
                            contentType:
                                "image/jpeg"
                        }
                    ),

                    uploadBytes(
                        ref(
                            storage,
                            "users/customer-1/profile/avatar.jpg"
                        ),
                        SMALL_JPEG,
                        {
                            contentType:
                                "image/jpeg",

                            customMetadata: {
                                userId:
                                    "customer-1"
                            }
                        }
                    ),

                    uploadBytes(
                        ref(
                            storage,
                            "users/customer-1/orders/order-1/receipt.pdf"
                        ),
                        Buffer.from(
                            "%PDF-1.4 test",
                            "utf8"
                        ),
                        {
                            contentType:
                                "application/pdf"
                        }
                    ),

                    uploadBytes(
                        ref(
                            storage,
                            "admin/private/report.csv"
                        ),
                        Buffer.from(
                            "name,value\nsales,10",
                            "utf8"
                        ),
                        {
                            contentType:
                                "text/csv"
                        }
                    )
                ]);
            }
        );
}

/* ==========================================================
   PUBLIC PRODUCT ASSETS
========================================================== */

test(
    "unauthenticated users can read product images",
    async function () {
        const storage =
            unauthenticatedStorage();

        await assertSucceeds(
            getBytes(
                ref(
                    storage,
                    "products/product-1/hero.jpg"
                )
            )
        );
    }
);

test(
    "customers can read product image metadata",
    async function () {
        const storage =
            customerStorage(
                "customer-1"
            );

        const metadata =
            await assertSucceeds(
                getMetadata(
                    ref(
                        storage,
                        "products/product-1/hero.jpg"
                    )
                )
            );

        assert.equal(
            metadata.contentType,
            "image/jpeg"
        );
    }
);

test(
    "unauthenticated users cannot upload product images",
    async function () {
        const storage =
            unauthenticatedStorage();

        await assertFails(
            uploadBytes(
                ref(
                    storage,
                    "products/product-2/hero.jpg"
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
    "customers cannot upload product images",
    async function () {
        const storage =
            customerStorage(
                "customer-1"
            );

        await assertFails(
            uploadBytes(
                ref(
                    storage,
                    "products/product-2/hero.jpg"
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
    "administrators can upload product images",
    async function () {
        const storage =
            adminStorage();

        await assertSucceeds(
            uploadBytes(
                ref(
                    storage,
                    "products/product-2/hero.jpg"
                ),
                SMALL_JPEG,
                {
                    contentType:
                        "image/jpeg",

                    customMetadata: {
                        productId:
                            "product-2"
                    }
                }
            )
        );
    }
);

test(
    "administrators can replace product images",
    async function () {
        const storage =
            adminStorage();

        await assertSucceeds(
            uploadBytes(
                ref(
                    storage,
                    "products/product-1/hero.jpg"
                ),
                SMALL_PNG,
                {
                    contentType:
                        "image/png"
                }
            )
        );
    }
);

test(
    "administrators can delete product images",
    async function () {
        const storage =
            adminStorage();

        await assertSucceeds(
            deleteObject(
                ref(
                    storage,
                    "products/product-1/hero.jpg"
                )
            )
        );
    }
);

test(
    "customers cannot delete product images",
    async function () {
        const storage =
            customerStorage(
                "customer-1"
            );

        await assertFails(
            deleteObject(
                ref(
                    storage,
                    "products/product-1/hero.jpg"
                )
            )
        );
    }
);

/* ==========================================================
   CATEGORY AND COLLECTION ASSETS
========================================================== */

test(
    "public users can read category images",
    async function () {
        const storage =
            unauthenticatedStorage();

        await assertSucceeds(
            getBytes(
                ref(
                    storage,
                    "categories/outerwear.jpg"
                )
            )
        );
    }
);

test(
    "public users can read collection images",
    async function () {
        const storage =
            unauthenticatedStorage();

        await assertSucceeds(
            getBytes(
                ref(
                    storage,
                    "collections/signature.jpg"
                )
            )
        );
    }
);

test(
    "customers cannot upload category images",
    async function () {
        const storage =
            customerStorage(
                "customer-1"
            );

        await assertFails(
            uploadBytes(
                ref(
                    storage,
                    "categories/accessories.jpg"
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
    "administrators can upload category images",
    async function () {
        const storage =
            adminStorage();

        await assertSucceeds(
            uploadBytes(
                ref(
                    storage,
                    "categories/accessories.jpg"
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
    "administrators can upload collection images",
    async function () {
        const storage =
            adminStorage();

        await assertSucceeds(
            uploadBytes(
                ref(
                    storage,
                    "collections/evening.jpg"
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

/* ==========================================================
   PROFILE IMAGES
========================================================== */

test(
    "customers can read their own profile image",
    async function () {
        const storage =
            customerStorage(
                "customer-1"
            );

        await assertSucceeds(
            getBytes(
                ref(
                    storage,
                    "users/customer-1/profile/avatar.jpg"
                )
            )
        );
    }
);

test(
    "customers cannot read another user's private profile image",
    async function () {
        const storage =
            customerStorage(
                "customer-2"
            );

        await assertFails(
            getBytes(
                ref(
                    storage,
                    "users/customer-1/profile/avatar.jpg"
                )
            )
        );
    }
);

test(
    "unauthenticated users cannot read profile images",
    async function () {
        const storage =
            unauthenticatedStorage();

        await assertFails(
            getBytes(
                ref(
                    storage,
                    "users/customer-1/profile/avatar.jpg"
                )
            )
        );
    }
);

test(
    "customers can upload their own JPEG profile image",
    async function () {
        const storage =
            customerStorage(
                "customer-1"
            );

        await assertSucceeds(
            uploadBytes(
                ref(
                    storage,
                    "users/customer-1/profile/new-avatar.jpg"
                ),
                SMALL_JPEG,
                {
                    contentType:
                        "image/jpeg",

                    customMetadata: {
                        userId:
                            "customer-1"
                    }
                }
            )
        );
    }
);

test(
    "customers can upload their own PNG profile image",
    async function () {
        const storage =
            customerStorage(
                "customer-1"
            );

        await assertSucceeds(
            uploadBytes(
                ref(
                    storage,
                    "users/customer-1/profile/new-avatar.png"
                ),
                SMALL_PNG,
                {
                    contentType:
                        "image/png",

                    customMetadata: {
                        userId:
                            "customer-1"
                    }
                }
            )
        );
    }
);

test(
    "customers cannot upload another user's profile image",
    async function () {
        const storage =
            customerStorage(
                "customer-2"
            );

        await assertFails(
            uploadBytes(
                ref(
                    storage,
                    "users/customer-1/profile/hijacked.jpg"
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
    "customers cannot upload executable profile files",
    async function () {
        const storage =
            customerStorage(
                "customer-1"
            );

        await assertFails(
            uploadBytes(
                ref(
                    storage,
                    "users/customer-1/profile/avatar.js"
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

test(
    "customers cannot upload SVG profile files",
    async function () {
        const storage =
            customerStorage(
                "customer-1"
            );

        await assertFails(
            uploadBytes(
                ref(
                    storage,
                    "users/customer-1/profile/avatar.svg"
                ),
                Buffer.from(
                    "<svg></svg>",
                    "utf8"
                ),
                {
                    contentType:
                        "image/svg+xml"
                }
            )
        );
    }
);

test(
    "customers can replace their own profile image",
    async function () {
        const storage =
            customerStorage(
                "customer-1"
            );

        await assertSucceeds(
            uploadBytes(
                ref(
                    storage,
                    "users/customer-1/profile/avatar.jpg"
                ),
                SMALL_JPEG,
                {
                    contentType:
                        "image/jpeg",

                    customMetadata: {
                        userId:
                            "customer-1"
                    }
                }
            )
        );
    }
);

test(
    "customers can delete their own profile image",
    async function () {
        const storage =
            customerStorage(
                "customer-1"
            );

        await assertSucceeds(
            deleteObject(
                ref(
                    storage,
                    "users/customer-1/profile/avatar.jpg"
                )
            )
        );
    }
);

test(
    "customers cannot delete another user's profile image",
    async function () {
        const storage =
            customerStorage(
                "customer-2"
            );

        await assertFails(
            deleteObject(
                ref(
                    storage,
                    "users/customer-1/profile/avatar.jpg"
                )
            )
        );
    }
);

test(
    "administrators can manage customer profile images",
    async function () {
        const storage =
            adminStorage();

        await assertSucceeds(
            deleteObject(
                ref(
                    storage,
                    "users/customer-1/profile/avatar.jpg"
                )
            )
        );
    }
);

/* ==========================================================
   FILE SIZE LIMITS
========================================================== */

test(
    "customers cannot upload oversized profile images",
    async function () {
        const storage =
            customerStorage(
                "customer-1"
            );

        const oversizedImage =
            Buffer.alloc(
                6 * 1024 * 1024,
                1
            );

        await assertFails(
            uploadBytes(
                ref(
                    storage,
                    "users/customer-1/profile/oversized.jpg"
                ),
                oversizedImage,
                {
                    contentType:
                        "image/jpeg"
                }
            )
        );
    }
);

test(
    "administrators cannot bypass configured product image size limits",
    async function () {
        const storage =
            adminStorage();

        const oversizedImage =
            Buffer.alloc(
                16 * 1024 * 1024,
                1
            );

        await assertFails(
            uploadBytes(
                ref(
                    storage,
                    "products/product-1/oversized.jpg"
                ),
                oversizedImage,
                {
                    contentType:
                        "image/jpeg"
                }
            )
        );
    }
);

/* ==========================================================
   USER ORDER DOCUMENTS
========================================================== */

test(
    "customers can read documents attached to their own orders",
    async function () {
        const storage =
            customerStorage(
                "customer-1"
            );

        await assertSucceeds(
            getBytes(
                ref(
                    storage,
                    "users/customer-1/orders/order-1/receipt.pdf"
                )
            )
        );
    }
);

test(
    "customers cannot read another user's order documents",
    async function () {
        const storage =
            customerStorage(
                "customer-2"
            );

        await assertFails(
            getBytes(
                ref(
                    storage,
                    "users/customer-1/orders/order-1/receipt.pdf"
                )
            )
        );
    }
);

test(
    "unauthenticated users cannot read order documents",
    async function () {
        const storage =
            unauthenticatedStorage();

        await assertFails(
            getBytes(
                ref(
                    storage,
                    "users/customer-1/orders/order-1/receipt.pdf"
                )
            )
        );
    }
);

test(
    "customers cannot upload payment receipts directly",
    async function () {
        const storage =
            customerStorage(
                "customer-1"
            );

        await assertFails(
            uploadBytes(
                ref(
                    storage,
                    "users/customer-1/orders/order-1/fake-receipt.pdf"
                ),
                Buffer.from(
                    "%PDF-1.4 fake",
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
    "administrators can upload order documents",
    async function () {
        const storage =
            adminStorage();

        await assertSucceeds(
            uploadBytes(
                ref(
                    storage,
                    "users/customer-1/orders/order-1/invoice.pdf"
                ),
                Buffer.from(
                    "%PDF-1.4 invoice",
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

/* ==========================================================
   ADMIN PRIVATE FILES
========================================================== */

test(
    "administrators can read private administrator files",
    async function () {
        const storage =
            adminStorage();

        await assertSucceeds(
            getBytes(
                ref(
                    storage,
                    "admin/private/report.csv"
                )
            )
        );
    }
);

test(
    "super-administrators can read private administrator files",
    async function () {
        const storage =
            superAdminStorage();

        await assertSucceeds(
            getBytes(
                ref(
                    storage,
                    "admin/private/report.csv"
                )
            )
        );
    }
);

test(
    "customers cannot read private administrator files",
    async function () {
        const storage =
            customerStorage(
                "customer-1"
            );

        await assertFails(
            getBytes(
                ref(
                    storage,
                    "admin/private/report.csv"
                )
            )
        );
    }
);

test(
    "unauthenticated users cannot read private administrator files",
    async function () {
        const storage =
            unauthenticatedStorage();

        await assertFails(
            getBytes(
                ref(
                    storage,
                    "admin/private/report.csv"
                )
            )
        );
    }
);

test(
    "administrators can upload private files",
    async function () {
        const storage =
            adminStorage();

        await assertSucceeds(
            uploadBytes(
                ref(
                    storage,
                    "admin/private/inventory.csv"
                ),
                Buffer.from(
                    "sku,stock\nSC-001,10",
                    "utf8"
                ),
                {
                    contentType:
                        "text/csv"
                }
            )
        );
    }
);

/* ==========================================================
   METADATA
========================================================== */

test(
    "customers can update metadata on their own profile image",
    async function () {
        const storage =
            customerStorage(
                "customer-1"
            );

        await assertSucceeds(
            updateMetadata(
                ref(
                    storage,
                    "users/customer-1/profile/avatar.jpg"
                ),
                {
                    customMetadata: {
                        userId:
                            "customer-1",

                        alt:
                            "Customer profile photo"
                    }
                }
            )
        );
    }
);

test(
    "customers cannot update product image metadata",
    async function () {
        const storage =
            customerStorage(
                "customer-1"
            );

        await assertFails(
            updateMetadata(
                ref(
                    storage,
                    "products/product-1/hero.jpg"
                ),
                {
                    customMetadata: {
                        productId:
                            "product-2"
                    }
                }
            )
        );
    }
);

test(
    "administrators can update product image metadata",
    async function () {
        const storage =
            adminStorage();

        await assertSucceeds(
            updateMetadata(
                ref(
                    storage,
                    "products/product-1/hero.jpg"
                ),
                {
                    customMetadata: {
                        productId:
                            "product-1",

                        alt:
                            "Signature coat"
                    }
                }
            )
        );
    }
);

/* ==========================================================
   UNKNOWN PATHS
========================================================== */

test(
    "unauthenticated users cannot read unknown storage paths",
    async function () {
        const storage =
            unauthenticatedStorage();

        await assertFails(
            getBytes(
                ref(
                    storage,
                    "unknown/file.txt"
                )
            )
        );
    }
);

test(
    "customers cannot upload to unknown storage paths",
    async function () {
        const storage =
            customerStorage(
                "customer-1"
            );

        await assertFails(
            uploadBytes(
                ref(
                    storage,
                    "unknown/file.txt"
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

test(
    "administrators cannot write to undefined paths unless rules allow it",
    async function () {
        const storage =
            adminStorage();

        await assertFails(
            uploadBytes(
                ref(
                    storage,
                    "unknown/admin-file.txt"
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
   CLAIM HARDENING
========================================================== */

test(
    "role text without the explicit admin claim cannot manage products",
    async function () {
        const storage =
            customerStorage(
                "fake-admin",
                {
                    role:
                        "admin",

                    admin:
                        false
                }
            );

        await assertFails(
            uploadBytes(
                ref(
                    storage,
                    "products/product-3/hero.jpg"
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
    "the explicit administrator claim grants product asset access",
    async function () {
        const storage =
            customerStorage(
                "claim-admin",
                {
                    role:
                        "customer",

                    admin:
                        true
                }
            );

        await assertSucceeds(
            uploadBytes(
                ref(
                    storage,
                    "products/product-3/hero.jpg"
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

/* ==========================================================
   ENVIRONMENT CHECK
========================================================== */

test(
    "storage rules file exists and is not empty",
    function () {
        assert.equal(
            fs.existsSync(
                RULES_PATH
            ),
            true
        );

        const rules =
            fs.readFileSync(
                RULES_PATH,
                "utf8"
            );

        assert.ok(
            rules.trim().length >
            0
        );
    }
);