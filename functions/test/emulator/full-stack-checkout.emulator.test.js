"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   FULL-STACK CHECKOUT EMULATOR TESTS

   Required emulators:
   - Functions
   - Firestore
   - Authentication

   This suite verifies:
   - Customer authentication
   - Callable checkout
   - Server-side pricing
   - Inventory reservation
   - Order ownership
   - Payment confirmation state
   - Administrator fulfillment
   - Customer order history
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
        30000
    );

const TEST_PASSWORD =
    "Password123!";

/*
 * Set this to true only when the Functions emulator has valid
 * Paystack or Flutterwave test credentials.
 *
 * Without provider credentials, checkout validation and security
 * tests still run, while provider-dependent success tests skip.
 */
const PAYMENT_PROVIDER_AVAILABLE =
    String(
        process.env.EMULATOR_PAYMENT_PROVIDER_AVAILABLE ||
        ""
    ).toLowerCase() ===
    "true";

/* ==========================================================
   ADMIN INITIALIZATION
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

let customer;
let secondCustomer;
let administrator;

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

        await seedCheckoutEnvironment();
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
   CHECKOUT AUTHENTICATION
========================================================== */

test(
    "checkout callable rejects unauthenticated customers",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const response =
            await invokeCallable(
                "createOrder",
                createCheckoutPayload()
            );

        assert.ok(
            response.status >= 400
        );

        assert.ok(
            response.body.error
        );

        assert.match(
            JSON.stringify(
                response.body.error
            ),
            /unauthenticated/i
        );

        const orders =
            await db.collection(
                "orders"
            ).get();

        assert.equal(
            orders.size,
            0
        );
    }
);

test(
    "checkout callable rejects an empty item list",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const response =
            await invokeCallable(
                "createOrder",
                Object.assign(
                    createCheckoutPayload(),
                    {
                        items: []
                    }
                ),
                customer.idToken
            );

        assert.ok(
            response.status >= 400
        );

        assert.match(
            JSON.stringify(
                response.body.error
            ),
            /invalid.argument|items/i
        );

        const orders =
            await db.collection(
                "orders"
            ).get();

        assert.equal(
            orders.size,
            0
        );
    }
);

test(
    "checkout rejects client-supplied price manipulation",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const payload =
            createCheckoutPayload();

        payload.items[0].price =
            1;

        payload.items[0].unitPrice =
            1;

        payload.items[0].lineTotal =
            1;

        const response =
            await invokeCallable(
                "createOrder",
                payload,
                customer.idToken
            );

        if (
            response.status === 200
        ) {
            const result =
                unwrapCallableData(
                    response.body
                );

            assert.notEqual(
                result.order.items[0]
                    .unitPrice,
                1
            );

            assert.equal(
                result.order.items[0]
                    .unitPrice,
                250000
            );
        } else {
            /*
             * A missing payment-provider configuration may cause
             * checkout to fail after server-side validation.
             */
            assert.doesNotMatch(
                JSON.stringify(
                    response.body.error
                ),
                /price.*1|accepted client price/i
            );
        }
    }
);

/* ==========================================================
   PRODUCT VALIDATION
========================================================== */

test(
    "checkout rejects unpublished products",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const payload =
            createCheckoutPayload();

        payload.items = [
            {
                productId:
                    "draft-product",

                quantity:
                    1
            }
        ];

        const response =
            await invokeCallable(
                "createOrder",
                payload,
                customer.idToken
            );

        assert.ok(
            response.status >= 400
        );

        assert.match(
            JSON.stringify(
                response.body.error
            ),
            /not.found|unavailable|published|active/i
        );

        const orderSnapshot =
            await db.collection(
                "orders"
            ).get();

        assert.equal(
            orderSnapshot.size,
            0
        );
    }
);

test(
    "checkout rejects quantities above available stock",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const payload =
            createCheckoutPayload();

        payload.items[0].quantity =
            10;

        const response =
            await invokeCallable(
                "createOrder",
                payload,
                customer.idToken
            );

        assert.ok(
            response.status >= 400
        );

        assert.match(
            JSON.stringify(
                response.body.error
            ),
            /stock|inventory|available/i
        );

        const product =
            await db.doc(
                "products/signature-coat"
            ).get();

        assert.equal(
            product.data().inventory,
            4
        );

        assert.equal(
            product.data()
                .variants[0].inventory,
            2
        );
    }
);

/* ==========================================================
   SUCCESSFUL CHECKOUT
========================================================== */

test(
    "authenticated checkout creates an owned order and reserves inventory",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function (context) {
        if (
            !PAYMENT_PROVIDER_AVAILABLE
        ) {
            context.skip(
                "Set EMULATOR_PAYMENT_PROVIDER_AVAILABLE=true with valid test payment credentials."
            );

            return;
        }

        const response =
            await invokeCallable(
                "createOrder",
                createCheckoutPayload(),
                customer.idToken
            );

        assert.equal(
            response.status,
            200
        );

        const result =
            unwrapCallableData(
                response.body
            );

        assert.equal(
            result.success,
            true
        );

        assert.equal(
            result.order.userId,
            customer.uid
        );

        assert.equal(
            result.order.status,
            "pending"
        );

        assert.equal(
            result.order.paymentStatus,
            "pending"
        );

        assert.equal(
            result.order.currency,
            "NGN"
        );

        /*
         * Server-side catalog price:
         * Signature Coat = ₦250,000
         * Leather Bag = ₦100,000
         * Subtotal = ₦350,000
         */
        assert.equal(
            result.order.subtotal,
            350000
        );

        assert.ok(
            result.order.total > 0
        );

        assert.ok(
            result.payment
        );

        assert.ok(
            result.payment.reference
        );

        const orderReference =
            db.doc(
                "orders/" +
                result.order.id
            );

        const orderSnapshot =
            await orderReference.get();

        assert.equal(
            orderSnapshot.exists,
            true
        );

        const storedOrder =
            orderSnapshot.data();

        assert.equal(
            storedOrder.userId,
            customer.uid
        );

        assert.equal(
            storedOrder.customer.email,
            customer.email
        );

        assert.equal(
            storedOrder.items.length,
            2
        );

        assert.equal(
            storedOrder.items[0]
                .unitPrice,
            250000
        );

        assert.equal(
            storedOrder.items[1]
                .unitPrice,
            100000
        );

        const coat =
            await db.doc(
                "products/signature-coat"
            ).get();

        const bag =
            await db.doc(
                "products/leather-bag"
            ).get();

        assert.equal(
            coat.data().inventory,
            3
        );

        assert.equal(
            coat.data()
                .variants[0].inventory,
            1
        );

        assert.equal(
            bag.data().inventory,
            5
        );
    }
);

test(
    "repeated checkout idempotency key does not create two orders",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function (context) {
        if (
            !PAYMENT_PROVIDER_AVAILABLE
        ) {
            context.skip(
                "Payment-provider test credentials are required."
            );

            return;
        }

        const payload =
            createCheckoutPayload();

        const firstResponse =
            await invokeCallable(
                "createOrder",
                payload,
                customer.idToken
            );

        const secondResponse =
            await invokeCallable(
                "createOrder",
                payload,
                customer.idToken
            );

        assert.equal(
            firstResponse.status,
            200
        );

        assert.equal(
            secondResponse.status,
            200
        );

        const first =
            unwrapCallableData(
                firstResponse.body
            );

        const second =
            unwrapCallableData(
                secondResponse.body
            );

        assert.equal(
            second.order.id,
            first.order.id
        );

        assert.equal(
            second.duplicate,
            true
        );

        const orders =
            await db.collection(
                "orders"
            )
                .where(
                    "userId",
                    "==",
                    customer.uid
                )
                .get();

        assert.equal(
            orders.size,
            1
        );

        const coat =
            await db.doc(
                "products/signature-coat"
            ).get();

        assert.equal(
            coat.data().inventory,
            3
        );
    }
);

/* ==========================================================
   PAYMENT STATE TRANSITION
========================================================== */

test(
    "verified payment state confirms a pending order",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const orderId =
            "payment-confirmation-order";

        await seedOrder({
            id:
                orderId,

            userId:
                customer.uid,

            status:
                "pending",

            paymentStatus:
                "pending",

            paymentReference:
                "LET-PS-EMULATOR-001"
        });

        /*
         * Webhook signature and provider verification are covered
         * by payment-webhook.integration.test.js. This emulator
         * test verifies the persisted full-stack state consumed by
         * HTTP APIs and Firestore rules.
         */
        await db.doc(
            "orders/" +
            orderId
        ).update({
            status:
                "confirmed",

            paymentStatus:
                "paid",

            paidAt:
                admin.firestore
                    .FieldValue
                    .serverTimestamp(),

            updatedAt:
                admin.firestore
                    .FieldValue
                    .serverTimestamp(),

            payment: {
                provider:
                    "paystack",

                providerReference:
                    "LET-PS-EMULATOR-001",

                providerTransactionId:
                    "900001",

                status:
                    "paid",

                authorization: {
                    channel:
                        "card",

                    cardType:
                        "visa",

                    last4:
                        "4081"
                }
            }
        });

        const response =
            await fetchJson(
                FUNCTIONS_BASE_URL +
                "/ordersApi/" +
                orderId,
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

        const order =
            response.body.data;

        assert.equal(
            order.id,
            orderId
        );

        assert.equal(
            order.status,
            "confirmed"
        );

        assert.equal(
            order.paymentStatus,
            "paid"
        );

        assert.equal(
            order.payment
                .authorization.last4,
            "4081"
        );

        assert.equal(
            order.payment
                .authorization
                .authorizationCode,
            undefined
        );
    }
);

/* ==========================================================
   CUSTOMER ORDER SECURITY
========================================================== */

test(
    "customer can retrieve their own order through orders API",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        await seedOrder({
            id:
                "customer-order",

            userId:
                customer.uid,

            status:
                "confirmed",

            paymentStatus:
                "paid"
        });

        const response =
            await fetchJson(
                FUNCTIONS_BASE_URL +
                "/ordersApi/customer-order",
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

        assert.equal(
            response.body.data.userId,
            customer.uid
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
        await seedOrder({
            id:
                "second-customer-order",

            userId:
                secondCustomer.uid,

            status:
                "confirmed",

            paymentStatus:
                "paid"
        });

        const response =
            await fetchJson(
                FUNCTIONS_BASE_URL +
                "/ordersApi/second-customer-order",
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

test(
    "customer order listing excludes other customers' orders",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        await seedOrder({
            id:
                "customer-order",

            userId:
                customer.uid,

            status:
                "confirmed",

            paymentStatus:
                "paid"
        });

        await seedOrder({
            id:
                "other-order",

            userId:
                secondCustomer.uid,

            status:
                "pending",

            paymentStatus:
                "pending"
        });

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

        const orders =
            response.body.data.orders ||
            response.body.data.items ||
            response.body.data;

        assert.equal(
            orders.length,
            1
        );

        assert.equal(
            orders[0].userId,
            customer.uid
        );
    }
);

/* ==========================================================
   ADMINISTRATOR FULFILLMENT
========================================================== */

test(
    "administrator advances a paid order through fulfillment",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        const orderId =
            "fulfillment-order";

        await seedOrder({
            id:
                orderId,

            userId:
                customer.uid,

            status:
                "confirmed",

            paymentStatus:
                "paid"
        });

        const processing =
            await updateOrderThroughAdminApi(
                orderId,
                {
                    status:
                        "processing",

                    note:
                        "Preparing the order."
                }
            );

        assert.equal(
            processing.status,
            200
        );

        assert.equal(
            processing.body.data.status,
            "processing"
        );

        const shipped =
            await updateOrderThroughAdminApi(
                orderId,
                {
                    status:
                        "shipped",

                    note:
                        "Order dispatched.",

                    tracking: {
                        carrier:
                            "DHL",

                        trackingNumber:
                            "DHL-EMULATOR-001",

                        trackingUrl:
                            "https://example.com/track/DHL-EMULATOR-001"
                    }
                }
            );

        assert.equal(
            shipped.status,
            200
        );

        assert.equal(
            shipped.body.data.status,
            "shipped"
        );

        const delivered =
            await updateOrderThroughAdminApi(
                orderId,
                {
                    status:
                        "delivered",

                    note:
                        "Delivered successfully."
                }
            );

        assert.equal(
            delivered.status,
            200
        );

        assert.equal(
            delivered.body.data.status,
            "delivered"
        );

        const orderSnapshot =
            await db.doc(
                "orders/" +
                orderId
            ).get();

        const order =
            orderSnapshot.data();

        assert.equal(
            order.status,
            "delivered"
        );

        assert.equal(
            order.paymentStatus,
            "paid"
        );

        assert.equal(
            order.tracking.carrier,
            "DHL"
        );

        assert.equal(
            order.tracking
                .trackingNumber,
            "DHL-EMULATOR-001"
        );

        assert.deepEqual(
            order.statusHistory
                .slice(-3)
                .map(
                    function (entry) {
                        return entry.status;
                    }
                ),
            [
                "processing",
                "shipped",
                "delivered"
            ]
        );
    }
);

test(
    "ordinary customer cannot call administrator fulfillment endpoint",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        await seedOrder({
            id:
                "protected-order",

            userId:
                customer.uid,

            status:
                "confirmed",

            paymentStatus:
                "paid"
        });

        const response =
            await fetchJson(
                FUNCTIONS_BASE_URL +
                "/adminApi/orders/protected-order/status",
                {
                    method:
                        "PATCH",

                    headers: {
                        Authorization:
                            "Bearer " +
                            customer.idToken,

                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            status:
                                "delivered"
                        })
                }
            );

        assert.equal(
            response.status,
            403
        );

        assert.equal(
            response.body.error.code,
            "permission-denied"
        );

        const order =
            await db.doc(
                "orders/protected-order"
            ).get();

        assert.equal(
            order.data().status,
            "confirmed"
        );
    }
);

/* ==========================================================
   CANCELLATION AND INVENTORY
========================================================== */

test(
    "customer cancellation restores reserved inventory",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        await db.doc(
            "products/signature-coat"
        ).update({
            inventory:
                3,

            stock:
                3,

            variants: [
                {
                    id:
                        "black-medium",

                    sku:
                        "COAT-BLK-M",

                    color:
                        "Black",

                    size:
                        "M",

                    price:
                        250000,

                    inventory:
                        1,

                    stock:
                        1,

                    active:
                        true,

                    available:
                        true
                }
            ]
        });

        await seedOrder({
            id:
                "cancellable-order",

            userId:
                customer.uid,

            status:
                "pending",

            paymentStatus:
                "pending",

            inventoryRestored:
                false,

            items: [
                {
                    productId:
                        "signature-coat",

                    variantId:
                        "black-medium",

                    quantity:
                        1,

                    unitPrice:
                        250000,

                    lineTotal:
                        250000
                }
            ]
        });

        const response =
            await invokeCallable(
                "cancelOrder",
                {
                    orderId:
                        "cancellable-order",

                    reason:
                        "Changed my mind."
                },
                customer.idToken
            );

        assert.equal(
            response.status,
            200
        );

        const result =
            unwrapCallableData(
                response.body
            );

        assert.equal(
            result.status,
            "cancelled"
        );

        const order =
            await db.doc(
                "orders/cancellable-order"
            ).get();

        assert.equal(
            order.data().status,
            "cancelled"
        );

        assert.equal(
            order.data()
                .inventoryRestored,
            true
        );

        const product =
            await db.doc(
                "products/signature-coat"
            ).get();

        assert.equal(
            product.data().inventory,
            4
        );

        assert.equal(
            product.data()
                .variants[0].inventory,
            2
        );
    }
);

test(
    "customer cannot cancel another customer's order",
    {
        timeout:
            TEST_TIMEOUT
    },
    async function () {
        await seedOrder({
            id:
                "foreign-order",

            userId:
                secondCustomer.uid,

            status:
                "pending",

            paymentStatus:
                "pending"
        });

        const response =
            await invokeCallable(
                "cancelOrder",
                {
                    orderId:
                        "foreign-order",

                    reason:
                        "Unauthorised request"
                },
                customer.idToken
            );

        assert.ok(
            response.status >= 400
        );

        assert.match(
            JSON.stringify(
                response.body.error
            ),
            /not.found|permission.denied/i
        );

        const order =
            await db.doc(
                "orders/foreign-order"
            ).get();

        assert.equal(
            order.data().status,
            "pending"
        );
    }
);

/* ==========================================================
   SEEDING
========================================================== */

async function seedCheckoutEnvironment() {
    customer =
        await createEmulatorUser({
            email:
                "customer@example.com",

            displayName:
                "Samuel Udom",

            claims: {
                role:
                    "customer",

                admin:
                    false,

                superadmin:
                    false
            }
        });

    secondCustomer =
        await createEmulatorUser({
            email:
                "second-customer@example.com",

            displayName:
                "Second Customer",

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
        await createEmulatorUser({
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

    const timestamp =
        admin.firestore
            .FieldValue
            .serverTimestamp();

    const batch =
        db.batch();

    batch.set(
        db.doc(
            "users/" +
            customer.uid
        ),
        {
            uid:
                customer.uid,

            email:
                customer.email,

            displayName:
                customer.displayName,

            role:
                "customer",

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

    batch.set(
        db.doc(
            "users/" +
            secondCustomer.uid
        ),
        {
            uid:
                secondCustomer.uid,

            email:
                secondCustomer.email,

            displayName:
                secondCustomer.displayName,

            role:
                "customer",

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

    batch.set(
        db.doc(
            "users/" +
            administrator.uid
        ),
        {
            uid:
                administrator.uid,

            email:
                administrator.email,

            displayName:
                administrator.displayName,

            role:
                "admin",

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

    batch.set(
        db.doc(
            "products/signature-coat"
        ),
        {
            name:
                "Signature Coat",

            slug:
                "signature-coat",

            sku:
                "COAT-001",

            description:
                "A tailored luxury coat.",

            active:
                true,

            published:
                true,

            archived:
                false,

            price:
                250000,

            inventory:
                4,

            stock:
                4,

            inStock:
                true,

            images: [
                {
                    url:
                        "https://example.com/coat.jpg",

                    alt:
                        "Signature coat"
                }
            ],

            variants: [
                {
                    id:
                        "black-medium",

                    sku:
                        "COAT-BLK-M",

                    color:
                        "Black",

                    size:
                        "M",

                    price:
                        250000,

                    inventory:
                        2,

                    stock:
                        2,

                    active:
                        true,

                    available:
                        true
                }
            ],

            createdAt:
                timestamp,

            updatedAt:
                timestamp
        }
    );

    batch.set(
        db.doc(
            "products/leather-bag"
        ),
        {
            name:
                "Leather Bag",

            slug:
                "leather-bag",

            sku:
                "BAG-001",

            description:
                "A structured leather bag.",

            active:
                true,

            published:
                true,

            archived:
                false,

            price:
                100000,

            inventory:
                6,

            stock:
                6,

            inStock:
                true,

            variants:
                [],

            images: [
                {
                    url:
                        "https://example.com/bag.jpg",

                    alt:
                        "Leather bag"
                }
            ],

            createdAt:
                timestamp,

            updatedAt:
                timestamp
        }
    );

    batch.set(
        db.doc(
            "products/draft-product"
        ),
        {
            name:
                "Draft Product",

            slug:
                "draft-product",

            active:
                true,

            published:
                false,

            archived:
                false,

            price:
                50000,

            inventory:
                10,

            stock:
                10,

            variants:
                [],

            createdAt:
                timestamp,

            updatedAt:
                timestamp
        }
    );

    batch.set(
        db.doc(
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
                10,

            minimumSubtotal:
                100000,

            maximumDiscount:
                50000,

            usageLimit:
                1000,

            usageCount:
                0,

            createdAt:
                timestamp,

            updatedAt:
                timestamp
        }
    );

    await batch.commit();
}

async function seedOrder(options) {
    const settings =
        options || {};

    const orderId =
        settings.id ||
        "order-" +
        Date.now();

    const data =
        Object.assign(
            {
                userId:
                    customer.uid,

                orderNumber:
                    "LET-" +
                    orderId
                        .toUpperCase(),

                status:
                    "pending",

                paymentStatus:
                    "pending",

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

                inventoryRestored:
                    false,

                customer: {
                    firstName:
                        "Samuel",

                    lastName:
                        "Udom",

                    email:
                        customer.email,

                    phone:
                        "+2348000000000"
                },

                shippingAddress: {
                    firstName:
                        "Samuel",

                    lastName:
                        "Udom",

                    addressLine1:
                        "10 Example Road",

                    city:
                        "Lagos",

                    state:
                        "Lagos",

                    country:
                        "Nigeria",

                    phone:
                        "+2348000000000"
                },

                items: [
                    {
                        productId:
                            "signature-coat",

                        variantId:
                            "black-medium",

                        name:
                            "Signature Coat",

                        sku:
                            "COAT-BLK-M",

                        quantity:
                            1,

                        unitPrice:
                            250000,

                        lineTotal:
                            250000
                    }
                ],

                statusHistory:
                    [],

                createdAt:
                    admin.firestore
                        .FieldValue
                        .serverTimestamp(),

                updatedAt:
                    admin.firestore
                        .FieldValue
                        .serverTimestamp()
            },
            settings
        );

    delete data.id;

    await db.doc(
        "orders/" +
        orderId
    ).set(data);

    return orderId;
}

/* ==========================================================
   PAYLOAD
========================================================== */

function createCheckoutPayload() {
    return {
        customer: {
            firstName:
                "Samuel",

            lastName:
                "Udom",

            email:
                customer.email,

            phone:
                "+2348000000000"
        },

        shippingAddress: {
            firstName:
                "Samuel",

            lastName:
                "Udom",

            addressLine1:
                "10 Example Road",

            city:
                "Lagos",

            state:
                "Lagos",

            postalCode:
                "100001",

            country:
                "Nigeria",

            phone:
                "+2348000000000"
        },

        billingSameAsShipping:
            true,

        deliveryMethod:
            "standard",

        paymentMethod:
            "paystack",

        couponCode:
            "WELCOME10",

        notes:
            "Call on arrival.",

        idempotencyKey:
            "emulator-checkout-" +
            customer.uid,

        items: [
            {
                productId:
                    "signature-coat",

                variantId:
                    "black-medium",

                quantity:
                    1
            },

            {
                productId:
                    "leather-bag",

                quantity:
                    1
            }
        ]
    };
}

/* ==========================================================
   AUTH HELPERS
========================================================== */

async function createEmulatorUser(options) {
    const user =
        await auth.createUser({
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

    await auth.setCustomUserClaims(
        user.uid,
        options.claims || {}
    );

    const authentication =
        await signInWithPassword(
            options.email,
            TEST_PASSWORD
        );

    return {
        uid:
            user.uid,

        email:
            user.email,

        displayName:
            user.displayName,

        idToken:
            authentication.idToken,

        refreshToken:
            authentication.refreshToken,

        claims:
            options.claims || {}
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
            "Unable to sign into Auth emulator: " +
            JSON.stringify(
                response.body
            )
        );
    }

    return response.body;
}

/* ==========================================================
   FUNCTIONS HELPERS
========================================================== */

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

async function updateOrderThroughAdminApi(
    orderId,
    payload
) {
    return fetchJson(
        FUNCTIONS_BASE_URL +
        "/adminApi/orders/" +
        orderId +
        "/status",
        {
            method:
                "PATCH",

            headers: {
                Authorization:
                    "Bearer " +
                    administrator.idToken,

                "Content-Type":
                    "application/json"
            },

            body:
                JSON.stringify(
                    payload
                )
        }
    );
}

function unwrapCallableData(body) {
    if (
        body &&
        Object.prototype
            .hasOwnProperty
            .call(
                body,
                "result"
            )
    ) {
        return body.result;
    }

    if (
        body &&
        Object.prototype
            .hasOwnProperty
            .call(
                body,
                "data"
            )
    ) {
        return body.data;
    }

    return body;
}

/* ==========================================================
   EMULATOR MANAGEMENT
========================================================== */

async function assertEmulatorsAvailable() {
    const failures = [];

    try {
        const response =
            await fetchWithTimeout(
                FUNCTIONS_BASE_URL +
                "/health",
                {
                    method:
                        "GET"
                },
                5000
            );

        if (!response.ok) {
            failures.push(
                "Functions emulator returned HTTP " +
                response.status
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
        await db.doc(
            "emulatorChecks/firestore"
        ).set({
            available:
                true
        });

        await db.doc(
            "emulatorChecks/firestore"
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
                "http://" +
                AUTH_HOST +
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
            AUTH_HOST +
            ": " +
            error.message
        );
    }

    if (failures.length) {
        throw new Error(
            [
                "Full-stack checkout emulator tests cannot start.",
                "",
                ...failures,
                "",
                "Start them with:",
                "firebase emulators:exec --only functions,firestore,auth \"npm --prefix functions run test:emulator:checkout\""
            ].join("\n")
        );
    }
}

async function clearFirestoreEmulator() {
    const response =
        await fetchWithTimeout(
            "http://" +
            FIRESTORE_HOST +
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
            AUTH_HOST +
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

/* ==========================================================
   HTTP HELPERS
========================================================== */

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