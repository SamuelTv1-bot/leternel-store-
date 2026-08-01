"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   TEST HELPERS SELF-TEST SUITE
========================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createFirestoreHarness,
    createAuthHarness,
    createRequest,
    createResponse,
    executeHandler,
    createCallableRequest,
    createProviderFetchHarness,
    createServiceTestContext,
    createFixtureSet,
    createCustomerUser,
    createAdministratorUser,
    createProduct,
    createOrder,
    createCheckoutPayload,
    assertDocumentExists,
    assertDocumentMissing,
    assertDocumentField,
    assertCollectionSize,
    assertFirestoreWrite,
    assertNoFirestoreWrite,
    assertAuthUser,
    assertAuthUserMissing,
    assertAuthClaims,
    assertAuthWrite,
    assertNoAuthWrite,
    assertProviderCall,
    assertProviderCallCount,
    assertNoProviderCall,
    assertHttpResponse,
    assertSuccessResponse,
    assertErrorResponse,
    assertOrderState,
    assertOrderTotals,
    assertInventory,
    assertAuditEntry,
    assertPaymentSanitized,
    assertValidTimestamp,
    assertRejectsWithCode,
    assertObjectContains,
    FieldValue,
    TestTimestamp,
    FIXED_DATE_MS
} = require("./index");

/* ==========================================================
   FIRESTORE HARNESS
========================================================== */

test(
    "Firestore harness reads seeded documents",
    async function () {
        const harness =
            createFirestoreHarness({
                initialDocuments: {
                    "products/product-1": {
                        name:
                            "Signature Coat",

                        inventory:
                            5
                    }
                }
            });

        const snapshot =
            await harness.db
                .doc(
                    "products/product-1"
                )
                .get();

        assert.equal(
            snapshot.exists,
            true
        );

        assert.equal(
            snapshot.id,
            "product-1"
        );

        assert.equal(
            snapshot.data().name,
            "Signature Coat"
        );

        assert.equal(
            snapshot.get(
                "inventory"
            ),
            5
        );
    }
);

test(
    "Firestore harness creates, updates, merges, and deletes documents",
    async function () {
        const harness =
            createFirestoreHarness();

        const reference =
            harness.db.doc(
                "products/product-1"
            );

        await reference.create({
            name:
                "Signature Coat",

            inventory:
                4,

            metadata: {
                featured:
                    false
            }
        });

        await reference.set(
            {
                metadata: {
                    featured:
                        true
                }
            },
            {
                merge:
                    true
            }
        );

        await reference.update({
            inventory:
                3,

            "metadata.position":
                1
        });

        const beforeDelete =
            await reference.get();

        assert.deepEqual(
            beforeDelete.data(),
            {
                name:
                    "Signature Coat",

                inventory:
                    3,

                metadata: {
                    featured:
                        true,

                    position:
                        1
                }
            }
        );

        await reference.delete();

        const afterDelete =
            await reference.get();

        assert.equal(
            afterDelete.exists,
            false
        );
    }
);

test(
    "Firestore harness applies server timestamps",
    async function () {
        const now =
            FIXED_DATE_MS;

        const harness =
            createFirestoreHarness({
                clock:
                    function () {
                        return now;
                    }
            });

        await harness.db
            .doc(
                "orders/order-1"
            )
            .set({
                createdAt:
                    FieldValue
                        .serverTimestamp()
            });

        const order =
            harness.getDocument(
                "orders/order-1"
            );

        assert.ok(
            order.createdAt instanceof
            TestTimestamp
        );

        assert.equal(
            order.createdAt.toMillis(),
            now
        );
    }
);

test(
    "Firestore harness applies increment operations",
    async function () {
        const harness =
            createFirestoreHarness({
                initialDocuments: {
                    "products/product-1": {
                        inventory:
                            4
                    }
                }
            });

        await harness.db
            .doc(
                "products/product-1"
            )
            .update({
                inventory:
                    FieldValue.increment(
                        -1
                    )
            });

        assert.equal(
            harness.getDocument(
                "products/product-1"
            ).inventory,
            3
        );
    }
);

test(
    "Firestore harness applies array union and removal",
    async function () {
        const harness =
            createFirestoreHarness({
                initialDocuments: {
                    "wishlists/customer-1": {
                        productIds: [
                            "product-1"
                        ]
                    }
                }
            });

        const reference =
            harness.db.doc(
                "wishlists/customer-1"
            );

        await reference.update({
            productIds:
                FieldValue.arrayUnion(
                    "product-2",
                    "product-1"
                )
        });

        assert.deepEqual(
            harness.getDocument(
                "wishlists/customer-1"
            ).productIds,
            [
                "product-1",
                "product-2"
            ]
        );

        await reference.update({
            productIds:
                FieldValue.arrayRemove(
                    "product-1"
                )
        });

        assert.deepEqual(
            harness.getDocument(
                "wishlists/customer-1"
            ).productIds,
            [
                "product-2"
            ]
        );
    }
);

test(
    "Firestore harness applies field deletion",
    async function () {
        const harness =
            createFirestoreHarness({
                initialDocuments: {
                    "users/customer-1": {
                        displayName:
                            "Customer",

                        phoneNumber:
                            "+2348000000000"
                    }
                }
            });

        await harness.db
            .doc(
                "users/customer-1"
            )
            .update({
                phoneNumber:
                    FieldValue.delete()
            });

        const user =
            harness.getDocument(
                "users/customer-1"
            );

        assert.equal(
            Object.prototype
                .hasOwnProperty
                .call(
                    user,
                    "phoneNumber"
                ),
            false
        );
    }
);

test(
    "Firestore harness rejects duplicate create operations",
    async function () {
        const harness =
            createFirestoreHarness({
                initialDocuments: {
                    "products/product-1": {
                        name:
                            "Existing Product"
                    }
                }
            });

        await assertRejectsWithCode(
            harness.db
                .doc(
                    "products/product-1"
                )
                .create({
                    name:
                        "Duplicate Product"
                }),
            "already-exists"
        );
    }
);

test(
    "Firestore harness rejects updates to missing documents",
    async function () {
        const harness =
            createFirestoreHarness();

        await assertRejectsWithCode(
            harness.db
                .doc(
                    "products/missing"
                )
                .update({
                    inventory:
                        1
                }),
            "not-found"
        );
    }
);

test(
    "Firestore harness queries with equality filters",
    async function () {
        const harness =
            createFirestoreHarness({
                initialDocuments: {
                    "products/product-1": {
                        active:
                            true,

                        published:
                            true
                    },

                    "products/product-2": {
                        active:
                            true,

                        published:
                            false
                    },

                    "products/product-3": {
                        active:
                            false,

                        published:
                            true
                    }
                }
            });

        const snapshot =
            await harness.db
                .collection(
                    "products"
                )
                .where(
                    "active",
                    "==",
                    true
                )
                .where(
                    "published",
                    "==",
                    true
                )
                .get();

        assert.equal(
            snapshot.size,
            1
        );

        assert.equal(
            snapshot.docs[0].id,
            "product-1"
        );
    }
);

test(
    "Firestore harness supports comparison and in filters",
    async function () {
        const harness =
            createFirestoreHarness({
                initialDocuments: {
                    "orders/order-1": {
                        total:
                            100,

                        status:
                            "pending"
                    },

                    "orders/order-2": {
                        total:
                            200,

                        status:
                            "confirmed"
                    },

                    "orders/order-3": {
                        total:
                            300,

                        status:
                            "delivered"
                    }
                }
            });

        const snapshot =
            await harness.db
                .collection(
                    "orders"
                )
                .where(
                    "total",
                    ">=",
                    200
                )
                .where(
                    "status",
                    "in",
                    [
                        "confirmed",
                        "delivered"
                    ]
                )
                .get();

        assert.equal(
            snapshot.size,
            2
        );
    }
);

test(
    "Firestore harness supports array query operators",
    async function () {
        const harness =
            createFirestoreHarness({
                initialDocuments: {
                    "products/product-1": {
                        tags: [
                            "coat",
                            "luxury"
                        ]
                    },

                    "products/product-2": {
                        tags: [
                            "bag"
                        ]
                    }
                }
            });

        const snapshot =
            await harness.db
                .collection(
                    "products"
                )
                .where(
                    "tags",
                    "array-contains",
                    "luxury"
                )
                .get();

        assert.equal(
            snapshot.size,
            1
        );

        assert.equal(
            snapshot.docs[0].id,
            "product-1"
        );
    }
);

test(
    "Firestore harness orders and limits query results",
    async function () {
        const harness =
            createFirestoreHarness({
                initialDocuments: {
                    "products/product-1": {
                        price:
                            300
                    },

                    "products/product-2": {
                        price:
                            100
                    },

                    "products/product-3": {
                        price:
                            200
                    }
                }
            });

        const snapshot =
            await harness.db
                .collection(
                    "products"
                )
                .orderBy(
                    "price",
                    "asc"
                )
                .limit(2)
                .get();

        assert.deepEqual(
            snapshot.docs.map(
                function (document) {
                    return document.id;
                }
            ),
            [
                "product-2",
                "product-3"
            ]
        );
    }
);

test(
    "Firestore harness supports startAfter document snapshots",
    async function () {
        const harness =
            createFirestoreHarness({
                initialDocuments: {
                    "products/product-1": {
                        price:
                            100
                    },

                    "products/product-2": {
                        price:
                            200
                    },

                    "products/product-3": {
                        price:
                            300
                    }
                }
            });

        const firstPage =
            await harness.db
                .collection(
                    "products"
                )
                .orderBy(
                    "price",
                    "asc"
                )
                .limit(1)
                .get();

        const secondPage =
            await harness.db
                .collection(
                    "products"
                )
                .orderBy(
                    "price",
                    "asc"
                )
                .startAfter(
                    firstPage.docs[0]
                )
                .limit(2)
                .get();

        assert.deepEqual(
            secondPage.docs.map(
                function (document) {
                    return document.id;
                }
            ),
            [
                "product-2",
                "product-3"
            ]
        );
    }
);

test(
    "Firestore harness transactions read and update documents",
    async function () {
        const harness =
            createFirestoreHarness({
                initialDocuments: {
                    "products/product-1": {
                        inventory:
                            3
                    }
                }
            });

        const reference =
            harness.db.doc(
                "products/product-1"
            );

        const result =
            await harness.db
                .runTransaction(
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

                        return "complete";
                    }
                );

        assert.equal(
            result,
            "complete"
        );

        assert.equal(
            harness.getDocument(
                "products/product-1"
            ).inventory,
            2
        );

        assertFirestoreWrite(
            harness,
            {
                operation:
                    "transaction-update",

                path:
                    "products/product-1",

                data: {
                    inventory:
                        2
                }
            }
        );
    }
);

test(
    "Firestore harness batches commit multiple writes",
    async function () {
        const harness =
            createFirestoreHarness();

        const batch =
            harness.db.batch();

        batch.set(
            harness.db.doc(
                "products/product-1"
            ),
            {
                name:
                    "Product One"
            }
        );

        batch.set(
            harness.db.doc(
                "products/product-2"
            ),
            {
                name:
                    "Product Two"
            }
        );

        await batch.commit();

        assertCollectionSize(
            harness,
            "products",
            2
        );
    }
);

/* ==========================================================
   AUTH HARNESS
========================================================== */

test(
    "Auth harness reads seeded users",
    async function () {
        const harness =
            createAuthHarness({
                initialUsers: {
                    "customer-1": {
                        email:
                            "CUSTOMER@EXAMPLE.COM",

                        displayName:
                            "Test Customer",

                        customClaims: {
                            role:
                                "customer"
                        }
                    }
                }
            });

        const user =
            await harness.auth
                .getUser(
                    "customer-1"
                );

        assert.equal(
            user.email,
            "customer@example.com"
        );

        assert.equal(
            user.customClaims.role,
            "customer"
        );
    }
);

test(
    "Auth harness creates and retrieves users by email",
    async function () {
        const harness =
            createAuthHarness();

        const created =
            await harness.auth
                .createUser({
                    email:
                        "customer@example.com",

                    displayName:
                        "Customer"
                });

        const found =
            await harness.auth
                .getUserByEmail(
                    "CUSTOMER@EXAMPLE.COM"
                );

        assert.equal(
            found.uid,
            created.uid
        );

        assertAuthWrite(
            harness,
            {
                operation:
                    "createUser",

                userId:
                    created.uid
            }
        );
    }
);

test(
    "Auth harness rejects duplicate email addresses",
    async function () {
        const harness =
            createAuthHarness({
                initialUsers: {
                    "customer-1": {
                        email:
                            "customer@example.com"
                    }
                }
            });

        await assertRejectsWithCode(
            harness.auth
                .createUser({
                    email:
                        "CUSTOMER@EXAMPLE.COM"
                }),
            "auth/email-already-exists"
        );
    }
);

test(
    "Auth harness updates user fields",
    async function () {
        const harness =
            createAuthHarness({
                initialUsers: {
                    "customer-1": {
                        email:
                            "customer@example.com",

                        disabled:
                            false
                    }
                }
            });

        await harness.auth
            .updateUser(
                "customer-1",
                {
                    displayName:
                        "Updated Customer",

                    disabled:
                        true
                }
            );

        assertAuthUser(
            harness,
            "customer-1",
            {
                displayName:
                    "Updated Customer",

                disabled:
                    true
            }
        );
    }
);

test(
    "Auth harness replaces custom claims",
    async function () {
        const harness =
            createAuthHarness({
                initialUsers: {
                    "customer-1": {
                        email:
                            "customer@example.com",

                        customClaims: {
                            role:
                                "customer"
                        }
                    }
                }
            });

        await harness.auth
            .setCustomUserClaims(
                "customer-1",
                {
                    role:
                        "admin",

                    admin:
                        true
                }
            );

        assertAuthClaims(
            harness,
            "customer-1",
            {
                role:
                    "admin",

                admin:
                    true
            }
        );
    }
);

test(
    "Auth harness revokes refresh tokens",
    async function () {
        const before =
            Date.parse(
                "2026-07-20T09:00:00.000Z"
            );

        let now =
            before;

        const harness =
            createAuthHarness({
                clock:
                    function () {
                        return now;
                    },

                initialUsers: {
                    "customer-1": {
                        email:
                            "customer@example.com"
                    }
                }
            });

        now += 60000;

        await harness.auth
            .revokeRefreshTokens(
                "customer-1"
            );

        const user =
            harness.getUser(
                "customer-1"
            );

        assert.equal(
            Date.parse(
                user.tokensValidAfterTime
            ),
            now
        );

        assertAuthWrite(
            harness,
            {
                operation:
                    "revokeRefreshTokens",

                userId:
                    "customer-1"
            }
        );
    }
);

test(
    "Auth harness deletes users",
    async function () {
        const harness =
            createAuthHarness({
                initialUsers: {
                    "customer-1": {
                        email:
                            "customer@example.com"
                    }
                }
            });

        await harness.auth
            .deleteUser(
                "customer-1"
            );

        assertAuthUserMissing(
            harness,
            "customer-1"
        );
    }
);

test(
    "Auth harness lists users with pagination",
    async function () {
        const harness =
            createAuthHarness({
                initialUsers: {
                    "user-1": {
                        email:
                            "one@example.com"
                    },

                    "user-2": {
                        email:
                            "two@example.com"
                    },

                    "user-3": {
                        email:
                            "three@example.com"
                    }
                }
            });

        const firstPage =
            await harness.auth
                .listUsers(
                    2
                );

        assert.equal(
            firstPage.users.length,
            2
        );

        assert.equal(
            firstPage.pageToken,
            "2"
        );

        const secondPage =
            await harness.auth
                .listUsers(
                    2,
                    firstPage.pageToken
                );

        assert.equal(
            secondPage.users.length,
            1
        );

        assert.equal(
            secondPage.pageToken,
            undefined
        );
    }
);

test(
    "Auth harness verifies generated test tokens",
    async function () {
        const harness =
            createAuthHarness({
                initialUsers: {
                    "admin-1": {
                        email:
                            "admin@example.com",

                        customClaims: {
                            role:
                                "admin",

                            admin:
                                true
                        }
                    }
                }
            });

        const token =
            harness.createIdToken(
                "admin-1"
            );

        const decoded =
            await harness.auth
                .verifyIdToken(
                    token
                );

        assert.equal(
            decoded.uid,
            "admin-1"
        );

        assert.equal(
            decoded.role,
            "admin"
        );

        assert.equal(
            decoded.admin,
            true
        );
    }
);

test(
    "Auth harness rejects tokens for disabled users",
    async function () {
        const harness =
            createAuthHarness({
                initialUsers: {
                    "customer-1": {
                        email:
                            "customer@example.com",

                        disabled:
                            true
                    }
                }
            });

        const token =
            harness.createIdToken(
                "customer-1"
            );

        await assertRejectsWithCode(
            harness.auth
                .verifyIdToken(
                    token
                ),
            "auth/user-disabled"
        );
    }
);

/* ==========================================================
   HTTP HARNESS
========================================================== */

test(
    "HTTP request harness normalizes method and headers",
    function () {
        const request =
            createRequest({
                method:
                    "post",

                path:
                    "/orders",

                headers: {
                    Authorization:
                        "Bearer token",

                    "Content-Type":
                        "application/json"
                },

                body: {
                    item:
                        true
                }
            });

        assert.equal(
            request.method,
            "POST"
        );

        assert.equal(
            request.get(
                "authorization"
            ),
            "Bearer token"
        );

        assert.equal(
            request.is("json"),
            "application/json"
        );

        assert.deepEqual(
            JSON.parse(
                request.rawBody
                    .toString("utf8")
            ),
            {
                item:
                    true
            }
        );
    }
);

test(
    "HTTP request harness parses cookies",
    function () {
        const request =
            createRequest({
                headers: {
                    cookie:
                        "session=abc123; currency=NGN"
                }
            });

        assert.deepEqual(
            request.cookies,
            {
                session:
                    "abc123",

                currency:
                    "NGN"
            }
        );
    }
);

test(
    "HTTP response harness captures JSON output",
    function () {
        const harness =
            createResponse();

        harness.response
            .status(201)
            .json({
                success:
                    true
            });

        assert.equal(
            harness.getStatus(),
            201
        );

        assert.deepEqual(
            harness.getJson(),
            {
                success:
                    true
            }
        );

        assert.equal(
            harness.isSent(),
            true
        );
    }
);

test(
    "HTTP response harness captures cookies and redirects",
    function () {
        const harness =
            createResponse();

        harness.response
            .cookie(
                "session",
                "abc123",
                {
                    httpOnly:
                        true,

                    secure:
                        true,

                    sameSite:
                        "strict",

                    path:
                        "/"
                }
            )
            .redirect(
                303,
                "/account"
            );

        assert.equal(
            harness.getStatus(),
            303
        );

        assert.equal(
            harness.getHeader(
                "location"
            ),
            "/account"
        );

        assert.equal(
            harness.getCookies()
                .length,
            1
        );

        assert.match(
            harness.getCookies()[0]
                .serialized,
            /HttpOnly/
        );
    }
);

test(
    "executeHandler captures a successful handler response",
    async function () {
        const result =
            await executeHandler(
                async function (
                    request,
                    response
                ) {
                    response.status(200)
                        .json({
                            success:
                                true,

                            path:
                                request.path
                        });
                },
                {
                    method:
                        "GET",

                    path:
                        "/health"
                }
            );

        assertSuccessResponse(
            result,
            {
                path:
                    "/health"
            }
        );
    }
);

test(
    "executeHandler captures forwarded errors when rethrow is false",
    async function () {
        const failure =
            new Error(
                "Handler failed"
            );

        const result =
            await executeHandler(
                async function () {
                    throw failure;
                },
                {
                    rethrow:
                        false
                }
            );

        assert.equal(
            result.error,
            failure
        );

        assert.equal(
            result.sent,
            false
        );
    }
);

test(
    "callable request harness creates authenticated context",
    function () {
        const request =
            createCallableRequest({
                data: {
                    orderId:
                        "order-1"
                },

                auth: {
                    uid:
                        "customer-1",

                    token: {
                        role:
                            "customer"
                    }
                }
            });

        assert.equal(
            request.auth.uid,
            "customer-1"
        );

        assert.equal(
            request.data.orderId,
            "order-1"
        );
    }
);

/* ==========================================================
   PROVIDER FETCH HARNESS
========================================================== */

test(
    "provider harness matches and returns a JSON response",
    async function () {
        const provider =
            createProviderFetchHarness();

        provider.once(
            "POST",
            "https://api.example.com/payments",
            {
                status:
                    201,

                json: {
                    success:
                        true,

                    id:
                        "payment-1"
                }
            },
            {
                headers: {
                    authorization:
                        "Bearer secret"
                },

                body: {
                    amount:
                        1000
                }
            }
        );

        try {
            const response =
                await fetch(
                    "https://api.example.com/payments",
                    {
                        method:
                            "POST",

                        headers: {
                            Authorization:
                                "Bearer secret",

                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify({
                                amount:
                                    1000
                            })
                    }
                );

            assert.equal(
                response.status,
                201
            );

            assert.deepEqual(
                await response.json(),
                {
                    success:
                        true,

                    id:
                        "payment-1"
                }
            );

            assertProviderCall(
                provider,
                {
                    method:
                        "POST",

                    url:
                        "https://api.example.com/payments",

                    body: {
                        amount:
                            1000
                    }
                }
            );

            provider.assertComplete();
        } finally {
            provider.restore();
        }
    }
);

test(
    "provider harness supports persistent routes",
    async function () {
        const provider =
            createProviderFetchHarness();

        provider.persist(
            "GET",
            /^https:\/\/api\.example\.com\/items/,
            {
                status:
                    200,

                json: {
                    items: []
                }
            }
        );

        try {
            await fetch(
                "https://api.example.com/items?page=1"
            );

            await fetch(
                "https://api.example.com/items?page=2"
            );

            assertProviderCallCount(
                provider,
                2
            );
        } finally {
            provider.restore();
        }
    }
);

test(
    "provider harness supports network failures",
    async function () {
        const provider =
            createProviderFetchHarness();

        provider.error(
            "POST",
            "https://api.example.com/failure",
            new Error(
                "Network unavailable"
            )
        );

        try {
            await assert.rejects(
                fetch(
                    "https://api.example.com/failure",
                    {
                        method:
                            "POST"
                    }
                ),
                /Network unavailable/
            );
        } finally {
            provider.restore();
        }
    }
);

test(
    "provider harness rejects unexpected requests in strict mode",
    async function () {
        const provider =
            createProviderFetchHarness();

        try {
            await assert.rejects(
                fetch(
                    "https://api.example.com/unexpected"
                ),
                /Unexpected provider request/
            );
        } finally {
            provider.restore();
        }
    }
);

test(
    "provider harness supports delayed abortable requests",
    async function () {
        const provider =
            createProviderFetchHarness();

        provider.route({
            method:
                "GET",

            url:
                "https://api.example.com/slow",

            delay:
                1000,

            response: {
                status:
                    200,

                json: {
                    success:
                        true
                }
            }
        });

        const controller =
            new AbortController();

        setTimeout(
            function () {
                controller.abort();
            },
            10
        );

        try {
            await assert.rejects(
                fetch(
                    "https://api.example.com/slow",
                    {
                        signal:
                            controller.signal
                    }
                ),
                function (error) {
                    assert.equal(
                        error.name,
                        "AbortError"
                    );

                    return true;
                }
            );
        } finally {
            provider.restore();
        }
    }
);

/* ==========================================================
   FIXTURE LIBRARY
========================================================== */

test(
    "fixture set contains users, documents, and provider payloads",
    function () {
        const fixtures =
            createFixtureSet();

        assert.ok(
            fixtures.users[
                "customer-1"
            ]
        );

        assert.ok(
            fixtures.documents[
                "products/product-coat"
            ]
        );

        assert.ok(
            fixtures.documents[
                "orders/order-1"
            ]
        );

        assert.equal(
            fixtures.checkout
                .items[0]
                .productId,
            "product-coat"
        );

        assert.equal(
            fixtures.paystack
                .verification
                .data.reference,
            "LET-PS-ORDER001"
        );
    }
);

test(
    "fixture builders do not mutate source defaults",
    function () {
        const first =
            createCustomerUser({
                customClaims: {
                    beta:
                        true
                }
            });

        const second =
            createCustomerUser();

        assert.equal(
            first.customClaims.beta,
            true
        );

        assert.equal(
            second.customClaims.beta,
            undefined
        );
    }
);

test(
    "product fixture supports nested overrides",
    function () {
        const product =
            createProduct({
                price:
                    300000,

                seo: {
                    title:
                        "Custom Title"
                }
            });

        assert.equal(
            product.price,
            300000
        );

        assert.equal(
            product.seo.title,
            "Custom Title"
        );

        assert.equal(
            product.seo.description,
            "Shop the L'ÉTERNEL Signature Coat."
        );
    }
);

test(
    "order fixture supports status overrides",
    function () {
        const order =
            createOrder({
                status:
                    "delivered",

                paymentStatus:
                    "paid"
            });

        assertOrderState(
            order,
            {
                id:
                    "order-1",

                status:
                    "delivered",

                paymentStatus:
                    "paid",

                itemCount:
                    1
            }
        );
    }
);

test(
    "checkout fixture accepts item overrides",
    function () {
        const payload =
            createCheckoutPayload({
                items: [
                    {
                        productId:
                            "product-bag",

                        quantity:
                            2
                    }
                ]
            });

        assert.equal(
            payload.items.length,
            1
        );

        assert.equal(
            payload.items[0]
                .quantity,
            2
        );
    }
);

/* ==========================================================
   SERVICE TEST CONTEXT
========================================================== */

test(
    "service context combines seeded Firestore and Auth fixtures",
    function () {
        const fixtures =
            createFixtureSet();

        const context =
            createServiceTestContext({
                initialUsers:
                    fixtures.users,

                initialDocuments:
                    fixtures.documents,

                now:
                    fixtures.now
            });

        try {
            assertDocumentExists(
                context.firestoreHarness,
                "products/product-coat"
            );

            assertAuthClaims(
                context.authHarness,
                "admin-1",
                {
                    role:
                        "admin",

                    admin:
                        true
                }
            );

            assert.equal(
                context.now(),
                FIXED_DATE_MS
            );
        } finally {
            context.cleanup();
        }
    }
);

test(
    "service context advances deterministic time",
    function () {
        const context =
            createServiceTestContext({
                now:
                    FIXED_DATE_MS
            });

        try {
            context.advanceMinutes(
                30
            );

            assert.equal(
                context.now(),
                FIXED_DATE_MS +
                30 *
                60 *
                1000
            );

            context.advanceDays(1);

            assert.equal(
                context.now(),
                FIXED_DATE_MS +
                30 *
                60 *
                1000 +
                24 *
                60 *
                60 *
                1000
            );
        } finally {
            context.cleanup();
        }
    }
);

test(
    "service context seeds customer and profile together",
    function () {
        const context =
            createServiceTestContext();

        try {
            const customer =
                context.seedCustomer(
                    {
                        uid:
                            "customer-special",

                        email:
                            "special@example.com"
                    },
                    {
                        preferences: {
                            currency:
                                "USD"
                        }
                    }
                );

            assert.equal(
                context.hasUser(
                    "customer-special"
                ),
                true
            );

            assertDocumentExists(
                context.firestoreHarness,
                "users/customer-special",
                {
                    email:
                        "special@example.com",

                    preferences: {
                        currency:
                            "USD"
                    }
                }
            );

            assert.equal(
                customer.uid,
                "customer-special"
            );
        } finally {
            context.cleanup();
        }
    }
);

test(
    "service context seeds products and orders",
    function () {
        const context =
            createServiceTestContext();

        try {
            const product =
                context.seedProduct({
                    id:
                        "special-product",

                    inventory:
                        2
                });

            const order =
                context.seedOrder({
                    id:
                        "special-order",

                    items: [
                        {
                            productId:
                                product.id,

                            quantity:
                                1,

                            unitPrice:
                                product.price,

                            lineTotal:
                                product.price
                        }
                    ]
                });

            assertDocumentExists(
                context.firestoreHarness,
                "products/special-product",
                {
                    inventory:
                        2
                }
            );

            assertDocumentExists(
                context.firestoreHarness,
                "orders/special-order"
            );

            assert.equal(
                order.id,
                "special-order"
            );
        } finally {
            context.cleanup();
        }
    }
);

/* ==========================================================
   ASSERTION HELPERS
========================================================== */

test(
    "document assertion helpers inspect Firestore state",
    function () {
        const harness =
            createFirestoreHarness({
                initialDocuments: {
                    "products/product-1": {
                        name:
                            "Signature Coat",

                        inventory:
                            4
                    }
                }
            });

        assertDocumentExists(
            harness,
            "products/product-1",
            {
                name:
                    "Signature Coat"
            }
        );

        assertDocumentField(
            harness,
            "products/product-1",
            "inventory",
            4
        );

        assertDocumentMissing(
            harness,
            "products/missing"
        );
    }
);

test(
    "Firestore assertion helpers find and reject writes",
    async function () {
        const harness =
            createFirestoreHarness();

        await harness.db
            .doc(
                "products/product-1"
            )
            .set({
                name:
                    "Product"
            });

        assertFirestoreWrite(
            harness,
            {
                operation:
                    "set",

                path:
                    "products/product-1"
            }
        );

        assertNoFirestoreWrite(
            harness,
            {
                operation:
                    "delete",

                path:
                    "products/product-1"
            }
        );
    }
);

test(
    "Auth assertion helpers inspect users and writes",
    async function () {
        const harness =
            createAuthHarness({
                initialUsers: {
                    "admin-1": {
                        email:
                            "admin@example.com",

                        customClaims: {
                            role:
                                "admin"
                        }
                    }
                }
            });

        await harness.auth
            .updateUser(
                "admin-1",
                {
                    disabled:
                        true
                }
            );

        assertAuthUser(
            harness,
            "admin-1",
            {
                disabled:
                    true
            }
        );

        assertAuthWrite(
            harness,
            {
                operation:
                    "updateUser",

                userId:
                    "admin-1",

                changes: {
                    disabled:
                        true
                }
            }
        );

        assertNoAuthWrite(
            harness,
            function (write) {
                return write.operation ===
                    "deleteUser";
            }
        );
    }
);

test(
    "HTTP assertion helpers inspect success and error responses",
    async function () {
        const success =
            await executeHandler(
                async function (
                    request,
                    response
                ) {
                    response.json({
                        success:
                            true,

                        data: {
                            value:
                                1
                        }
                    });
                }
            );

        assertHttpResponse(
            success,
            {
                status:
                    200,

                json: {
                    success:
                        true
                }
            }
        );

        assertSuccessResponse(
            success,
            {
                value:
                    1
            }
        );

        const failure =
            await executeHandler(
                async function (
                    request,
                    response
                ) {
                    response.status(403)
                        .json({
                            success:
                                false,

                            error: {
                                code:
                                    "permission-denied",

                                message:
                                    "Forbidden"
                            }
                        });
                }
            );

        assertErrorResponse(
            failure,
            {
                status:
                    403,

                code:
                    "permission-denied",

                messageMatches:
                    /forbidden/i
            }
        );
    }
);

test(
    "order assertion helpers validate totals",
    function () {
        const order =
            createOrder({
                subtotal:
                    300000,

                discount:
                    25000,

                deliveryFee:
                    10000,

                tax:
                    15000,

                total:
                    300000
            });

        assertOrderTotals(
            order,
            {
                subtotal:
                    300000,

                discount:
                    25000,

                deliveryFee:
                    10000,

                tax:
                    15000,

                total:
                    300000
            }
        );
    }
);

test(
    "inventory assertion helper validates product and variant stock",
    function () {
        const harness =
            createFirestoreHarness({
                initialDocuments: {
                    "products/product-1": {
                        inventory:
                            3,

                        stock:
                            3,

                        variants: [
                            {
                                id:
                                    "black-medium",

                                inventory:
                                    1,

                                stock:
                                    1
                            }
                        ]
                    }
                }
            });

        assertInventory(
            harness,
            "product-1",
            {
                inventory:
                    3,

                stock:
                    3,

                variantId:
                    "black-medium",

                variantInventory:
                    1,

                variantStock:
                    1
            }
        );
    }
);

test(
    "audit assertion helper finds attributable entries",
    function () {
        const harness =
            createFirestoreHarness({
                initialDocuments: {
                    "auditLogs/audit-1": {
                        action:
                            "order.status.updated",

                        targetId:
                            "order-1",

                        actorId:
                            "admin-1",

                        metadata: {
                            status:
                                "processing"
                        }
                    }
                }
            });

        assertAuditEntry(
            harness,
            {
                action:
                    "order.status.updated",

                targetId:
                    "order-1",

                actorId:
                    "admin-1",

                metadata: {
                    status:
                        "processing"
                }
            }
        );
    }
);

test(
    "payment sanitization assertion accepts safe payment data",
    function () {
        assertPaymentSanitized({
            payment: {
                provider:
                    "paystack",

                providerReference:
                    "LET-PS-001",

                authorization: {
                    last4:
                        "4081",

                    cardType:
                        "visa"
                }
            }
        });
    }
);

test(
    "payment sanitization assertion rejects secret fields",
    function () {
        assert.throws(
            function () {
                assertPaymentSanitized({
                    payment: {
                        authorizationCode:
                            "AUTH_PRIVATE"
                    }
                });
            }
        );
    }
);

test(
    "timestamp assertion accepts Date and timestamp-like values",
    function () {
        assertValidTimestamp(
            new Date()
        );

        assertValidTimestamp(
            TestTimestamp.now()
        );

        assertValidTimestamp(
            "2026-07-20T09:00:00.000Z"
        );
    }
);

test(
    "partial object assertion validates nested values",
    function () {
        assertObjectContains(
            {
                customer: {
                    email:
                        "customer@example.com",

                    preferences: {
                        currency:
                            "NGN",

                        language:
                            "en"
                    }
                }
            },
            {
                customer: {
                    preferences: {
                        currency:
                            "NGN"
                    }
                }
            }
        );
    }
);

/* ==========================================================
   BARREL EXPORT
========================================================== */

test(
    "helpers barrel exposes grouped modules",
    function () {
        const helpers =
            require("./index");

        assert.ok(
            helpers.firestore
        );

        assert.ok(
            helpers.auth
        );

        assert.ok(
            helpers.http
        );

        assert.ok(
            helpers.providers
        );

        assert.ok(
            helpers.serviceContext
        );

        assert.ok(
            helpers.assertions
        );

        assert.ok(
            helpers.fixtures
        );
    }
);

test(
    "helpers barrel exposes primary factories",
    function () {
        const helpers =
            require("./index");

        assert.equal(
            typeof helpers
                .createFirestoreHarness,
            "function"
        );

        assert.equal(
            typeof helpers
                .createAuthHarness,
            "function"
        );

        assert.equal(
            typeof helpers
                .createProviderFetchHarness,
            "function"
        );

        assert.equal(
            typeof helpers
                .createServiceTestContext,
            "function"
        );

        assert.equal(
            typeof helpers
                .createFixtureSet,
            "function"
        );
    }
);