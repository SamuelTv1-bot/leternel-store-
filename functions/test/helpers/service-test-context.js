"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   SHARED SERVICE TEST CONTEXT

   Combines:
   - In-memory Firestore
   - In-memory Firebase Auth
   - HTTP request/response harnesses
   - Provider fetch mocking
   - Deterministic timestamps
   - Shared configuration
   - Fixture seeding
   - Cleanup and inspection
========================================================== */

const {
    createFirestoreHarness,
    cloneValue,
    FieldValue,
    TestTimestamp
} = require(
    "./firestore-test-harness"
);

const {
    createAuthHarness
} = require(
    "./auth-test-harness"
);

const {
    createRequest,
    createResponse,
    createNext,
    executeHandler,
    createCallableRequest
} = require(
    "./http-test-harness"
);

const {
    createProviderFetchHarness
} = require(
    "./provider-fetch-harness"
);

/* ==========================================================
   DEFAULTS
========================================================== */

const DEFAULT_NOW =
    Date.parse(
        "2026-07-20T09:00:00.000Z"
    );

const DEFAULT_CONFIGURATION = {
    projectId:
        "leternel-store-test",

    region:
        "europe-west1",

    currency:
        "NGN",

    locale:
        "en-NG",

    appOrigin:
        "https://shop.example.com",

    storeName:
        "L'ÉTERNEL",

    supportEmail:
        "support@example.com",

    orderEmail:
        "orders@example.com",

    paymentProvider:
        "paystack",

    paystackSecretKey:
        "paystack-test-secret",

    paystackPublicKey:
        "pk_test_paystack",

    flutterwaveSecretKey:
        "flutterwave-test-secret",

    flutterwavePublicKey:
        "FLWPUBK_TEST",

    flutterwaveWebhookHash:
        "flutterwave-webhook-hash",

    emailProvider:
        "resend",

    emailApiKey:
        "email-test-api-key",

    emailFrom:
        "orders@example.com",

    emailReplyTo:
        "support@example.com",

    freeStandardDeliveryThreshold:
        500000,

    standardDeliveryFee:
        10000,

    expressDeliveryFee:
        25000,

    taxRate:
        0
};

/* ==========================================================
   FIXTURE BUILDERS
========================================================== */

function createCustomer(overrides) {
    return mergeValue(
        {
            uid:
                "customer-1",

            email:
                "customer@example.com",

            emailVerified:
                true,

            displayName:
                "Test Customer",

            photoURL:
                "",

            phoneNumber:
                "+2348000000000",

            disabled:
                false,

            customClaims: {
                role:
                    "customer",

                admin:
                    false,

                superadmin:
                    false
            }
        },
        overrides || {}
    );
}

function createAdministrator(
    overrides
) {
    return mergeValue(
        {
            uid:
                "admin-1",

            email:
                "admin@example.com",

            emailVerified:
                true,

            displayName:
                "Store Administrator",

            disabled:
                false,

            customClaims: {
                role:
                    "admin",

                admin:
                    true,

                superadmin:
                    false
            }
        },
        overrides || {}
    );
}

function createSuperAdministrator(
    overrides
) {
    return mergeValue(
        {
            uid:
                "superadmin-1",

            email:
                "owner@example.com",

            emailVerified:
                true,

            displayName:
                "Store Owner",

            disabled:
                false,

            customClaims: {
                role:
                    "superadmin",

                admin:
                    true,

                superadmin:
                    true
            }
        },
        overrides || {}
    );
}

function createUserProfile(
    user,
    overrides
) {
    const source =
        user || createCustomer();

    return mergeValue(
        {
            uid:
                source.uid,

            email:
                source.email,

            emailVerified:
                Boolean(
                    source.emailVerified
                ),

            displayName:
                source.displayName ||
                "",

            photoURL:
                source.photoURL ||
                "",

            phoneNumber:
                source.phoneNumber ||
                "",

            role:
                source.customClaims &&
                source.customClaims.role
                    ? source.customClaims.role
                    : "customer",

            status:
                source.disabled
                    ? "disabled"
                    : "active",

            addresses:
                [],

            preferences: {
                currency:
                    "NGN",

                language:
                    "en",

                marketingEmails:
                    true
            }
        },
        overrides || {}
    );
}

function createProduct(overrides) {
    return mergeValue(
        {
            id:
                "product-1",

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

            featured:
                false,

            currency:
                "NGN",

            price:
                250000,

            compareAtPrice:
                280000,

            inventory:
                8,

            stock:
                8,

            inStock:
                true,

            categoryId:
                "outerwear",

            collectionIds: [
                "signature"
            ],

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

                    name:
                        "Black / Medium",

                    color:
                        "Black",

                    size:
                        "M",

                    price:
                        250000,

                    inventory:
                        4,

                    stock:
                        4,

                    active:
                        true,

                    available:
                        true
                }
            ]
        },
        overrides || {}
    );
}

function createCoupon(overrides) {
    return mergeValue(
        {
            id:
                "WELCOME10",

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
                0
        },
        overrides || {}
    );
}

function createOrder(overrides) {
    return mergeValue(
        {
            id:
                "order-1",

            orderNumber:
                "LET-20260720-ORDER001",

            userId:
                "customer-1",

            status:
                "pending",

            paymentStatus:
                "pending",

            paymentMethod:
                "paystack",

            paymentReference:
                "LET-PS-ORDER001",

            currency:
                "NGN",

            subtotal:
                250000,

            discount:
                0,

            deliveryFee:
                10000,

            tax:
                0,

            total:
                260000,

            inventoryRestored:
                false,

            customer: {
                firstName:
                    "Test",

                lastName:
                    "Customer",

                displayName:
                    "Test Customer",

                email:
                    "customer@example.com",

                phone:
                    "+2348000000000"
            },

            shippingAddress: {
                firstName:
                    "Test",

                lastName:
                    "Customer",

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

            items: [
                {
                    productId:
                        "product-1",

                    variantId:
                        "black-medium",

                    sku:
                        "COAT-BLK-M",

                    name:
                        "Signature Coat",

                    color:
                        "Black",

                    size:
                        "M",

                    quantity:
                        1,

                    unitPrice:
                        250000,

                    price:
                        250000,

                    lineTotal:
                        250000,

                    image:
                        "https://example.com/coat.jpg"
                }
            ],

            statusHistory:
                []
        },
        overrides || {}
    );
}

function createCheckoutPayload(
    overrides
) {
    return mergeValue(
        {
            customer: {
                firstName:
                    "Test",

                lastName:
                    "Customer",

                email:
                    "customer@example.com",

                phone:
                    "+2348000000000"
            },

            shippingAddress: {
                firstName:
                    "Test",

                lastName:
                    "Customer",

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
                "",

            notes:
                "",

            idempotencyKey:
                "checkout-test-key",

            items: [
                {
                    productId:
                        "product-1",

                    variantId:
                        "black-medium",

                    quantity:
                        1
                }
            ]
        },
        overrides || {}
    );
}

/* ==========================================================
   CONTEXT FACTORY
========================================================== */

function createServiceTestContext(
    options
) {
    const settings =
        options || {};

    let currentTime =
        Number.isFinite(
            settings.now
        )
            ? Number(
                  settings.now
              )
            : DEFAULT_NOW;

    const clock =
        function () {
            return currentTime;
        };

    const configuration =
        mergeValue(
            DEFAULT_CONFIGURATION,
            settings.configuration ||
            {}
        );

    const initialUsers =
        cloneValue(
            settings.users ||
            settings.initialUsers ||
            {}
        );

    const initialDocuments =
        cloneValue(
            settings.documents ||
            settings.initialDocuments ||
            {}
        );

    const firestoreHarness =
        createFirestoreHarness({
            initialDocuments:
                initialDocuments,

            clock:
                clock,

            startingId:
                settings.startingDocumentId ||
                0
        });

    const authHarness =
        createAuthHarness({
            initialUsers:
                initialUsers,

            clock:
                clock,

            startingUid:
                settings.startingUid ||
                0,

            defaultPassword:
                settings.defaultPassword ||
                "Password123!"
        });

    const providerHarness =
        createProviderFetchHarness({
            autoInstall:
                settings.installFetch !==
                false,

            strict:
                settings.strictFetch !==
                false,

            routes:
                settings.providerRoutes ||
                []
        });

    const context = {
        configuration:
            configuration,

        config:
            configuration,

        db:
            firestoreHarness.db,

        firestore:
            firestoreHarness.firestore,

        auth:
            authHarness.auth,

        FieldValue:
            FieldValue,

        Timestamp:
            TestTimestamp,

        firestoreHarness:
            firestoreHarness,

        authHarness:
            authHarness,

        providerHarness:
            providerHarness,

        providers:
            providerHarness,

        clock:
            clock,

        now:
            function () {
                return currentTime;
            },

        nowDate:
            function () {
                return new Date(
                    currentTime
                );
            },

        nowTimestamp:
            function () {
                return TestTimestamp
                    .fromMillis(
                        currentTime
                    );
            },

        setTime:
            function (value) {
                currentTime =
                    normalizeTimeValue(
                        value
                    );

                return context;
            },

        advanceTime:
            function (milliseconds) {
                currentTime +=
                    Number(
                        milliseconds
                    );

                return context;
            },

        advanceSeconds:
            function (seconds) {
                return context
                    .advanceTime(
                        Number(seconds) *
                        1000
                    );
            },

        advanceMinutes:
            function (minutes) {
                return context
                    .advanceTime(
                        Number(minutes) *
                        60 *
                        1000
                    );
            },

        advanceHours:
            function (hours) {
                return context
                    .advanceTime(
                        Number(hours) *
                        60 *
                        60 *
                        1000
                    );
            },

        advanceDays:
            function (days) {
                return context
                    .advanceTime(
                        Number(days) *
                        24 *
                        60 *
                        60 *
                        1000
                    );
            },

        request:
            function (
                requestOptions
            ) {
                return createRequest(
                    requestOptions
                );
            },

        response:
            function (
                responseOptions
            ) {
                return createResponse(
                    responseOptions
                );
            },

        next:
            function () {
                return createNext();
            },

        callableRequest:
            function (
                callableOptions
            ) {
                return createCallableRequest(
                    callableOptions
                );
            },

        executeHandler:
            function (
                handler,
                handlerOptions
            ) {
                return executeHandler(
                    handler,
                    handlerOptions
                );
            },

        seedDocument:
            function (
                path,
                data
            ) {
                firestoreHarness
                    .setDocument(
                        path,
                        addFixtureTimestamps(
                            data,
                            currentTime
                        )
                    );

                return context;
            },

        seedDocuments:
            function (documents) {
                Object.keys(
                    documents || {}
                ).forEach(
                    function (path) {
                        context.seedDocument(
                            path,
                            documents[path]
                        );
                    }
                );

                return context;
            },

        seedUser:
            function (
                uid,
                user
            ) {
                authHarness.setUser(
                    uid,
                    user
                );

                return context;
            },

        seedUserWithProfile:
            function (
                user,
                profileOverrides
            ) {
                const normalizedUser =
                    mergeValue(
                        createCustomer(),
                        user || {}
                    );

                authHarness.setUser(
                    normalizedUser.uid,
                    normalizedUser
                );

                context.seedDocument(
                    "users/" +
                    normalizedUser.uid,
                    createUserProfile(
                        normalizedUser,
                        profileOverrides
                    )
                );

                return normalizedUser;
            },

        seedCustomer:
            function (
                userOverrides,
                profileOverrides
            ) {
                return context
                    .seedUserWithProfile(
                        createCustomer(
                            userOverrides
                        ),
                        profileOverrides
                    );
            },

        seedAdministrator:
            function (
                userOverrides,
                profileOverrides
            ) {
                return context
                    .seedUserWithProfile(
                        createAdministrator(
                            userOverrides
                        ),
                        profileOverrides
                    );
            },

        seedSuperAdministrator:
            function (
                userOverrides,
                profileOverrides
            ) {
                return context
                    .seedUserWithProfile(
                        createSuperAdministrator(
                            userOverrides
                        ),
                        profileOverrides
                    );
            },

        seedProduct:
            function (
                productOverrides
            ) {
                const product =
                    createProduct(
                        productOverrides
                    );

                context.seedDocument(
                    "products/" +
                    product.id,
                    omitIdentifier(
                        product
                    )
                );

                return product;
            },

        seedCoupon:
            function (
                couponOverrides
            ) {
                const coupon =
                    createCoupon(
                        couponOverrides
                    );

                context.seedDocument(
                    "coupons/" +
                    coupon.id,
                    omitIdentifier(
                        coupon
                    )
                );

                return coupon;
            },

        seedOrder:
            function (
                orderOverrides
            ) {
                const order =
                    createOrder(
                        orderOverrides
                    );

                context.seedDocument(
                    "orders/" +
                    order.id,
                    omitIdentifier(
                        order
                    )
                );

                return order;
            },

        getDocument:
            function (path) {
                return firestoreHarness
                    .getDocument(path);
            },

        hasDocument:
            function (path) {
                return firestoreHarness
                    .hasDocument(path);
            },

        listDocuments:
            function (
                collectionPath
            ) {
                return firestoreHarness
                    .listDocuments(
                        collectionPath
                    );
            },

        findDocuments:
            function (
                collectionPath,
                predicate
            ) {
                return firestoreHarness
                    .findDocuments(
                        collectionPath,
                        predicate
                    );
            },

        getUser:
            function (uid) {
                return authHarness
                    .getUser(uid);
            },

        hasUser:
            function (uid) {
                return authHarness
                    .hasUser(uid);
            },

        firestoreWrites:
            function (predicate) {
                return firestoreHarness
                    .findWrites(
                        predicate
                    );
            },

        authWrites:
            function (predicate) {
                return authHarness
                    .findWrites(
                        predicate
                    );
            },

        providerCalls:
            function (predicate) {
                return providerHarness
                    .findCalls(
                        predicate
                    );
            },

        resetWrites:
            function () {
                firestoreHarness
                    .resetWrites();

                authHarness
                    .resetWrites();

                providerHarness
                    .reset();

                return context;
            },

        snapshot:
            function () {
                return {
                    time:
                        currentTime,

                    configuration:
                        cloneValue(
                            configuration
                        ),

                    documents:
                        firestoreHarness
                            .snapshot(),

                    users:
                        authHarness
                            .listUsers(),

                    firestoreWrites:
                        cloneValue(
                            firestoreHarness
                                .writes
                        ),

                    authWrites:
                        cloneValue(
                            authHarness
                                .writes
                        ),

                    providerCalls:
                        providerHarness
                            .getCalls()
                };
            },

        restore:
            function () {
                providerHarness.restore();

                return context;
            },

        cleanup:
            function () {
                providerHarness.restore();

                firestoreHarness.clear();
                authHarness.clear();

                return context;
            }
    };

    if (
        settings.seedDefaults
    ) {
        seedDefaultFixtures(
            context,
            settings.defaultFixtures
        );
    }

    return context;
}

/* ==========================================================
   DEFAULT SEED SET
========================================================== */

function seedDefaultFixtures(
    context,
    options
) {
    const settings =
        options || {};

    const customer =
        context.seedCustomer(
            settings.customer,
            settings.customerProfile
        );

    const administrator =
        context.seedAdministrator(
            settings.administrator,
            settings.administratorProfile
        );

    const superAdministrator =
        context
            .seedSuperAdministrator(
                settings.superAdministrator,
                settings.superAdministratorProfile
            );

    const product =
        context.seedProduct(
            settings.product
        );

    const coupon =
        context.seedCoupon(
            settings.coupon
        );

    if (
        settings.order !==
        false
    ) {
        context.seedOrder(
            mergeValue(
                {
                    userId:
                        customer.uid,

                    customer: {
                        displayName:
                            customer.displayName,

                        email:
                            customer.email,

                        phone:
                            customer.phoneNumber
                    },

                    items: [
                        {
                            productId:
                                product.id,

                            variantId:
                                product.variants &&
                                product.variants[0]
                                    ? product
                                          .variants[0]
                                          .id
                                    : "",

                            sku:
                                product.variants &&
                                product.variants[0]
                                    ? product
                                          .variants[0]
                                          .sku
                                    : product.sku,

                            name:
                                product.name,

                            quantity:
                                1,

                            unitPrice:
                                product.price,

                            price:
                                product.price,

                            lineTotal:
                                product.price
                        }
                    ],

                    subtotal:
                        product.price,

                    total:
                        product.price +
                        context.configuration
                            .standardDeliveryFee
                },
                settings.order || {}
            )
        );
    }

    return {
        customer:
            customer,

        administrator:
            administrator,

        superAdministrator:
            superAdministrator,

        product:
            product,

        coupon:
            coupon
    };
}

/* ==========================================================
   SERVICE ARGUMENT HELPERS
========================================================== */

function createServiceDependencies(
    context,
    overrides
) {
    return mergeValue(
        {
            db:
                context.db,

            firestore:
                context.firestore,

            auth:
                context.auth,

            configuration:
                context.configuration,

            config:
                context.configuration,

            FieldValue:
                context.FieldValue,

            Timestamp:
                context.Timestamp,

            now:
                context.clock
        },
        overrides || {}
    );
}

function createAdministratorIdentity(
    user,
    overrides
) {
    const source =
        user ||
        createAdministrator();

    return mergeValue(
        {
            uid:
                source.uid,

            email:
                source.email,

            role:
                source.customClaims &&
                source.customClaims.role
                    ? source.customClaims.role
                    : "admin"
        },
        overrides || {}
    );
}

function createAuthContext(
    user,
    overrides
) {
    const source =
        user ||
        createCustomer();

    return mergeValue(
        {
            uid:
                source.uid,

            token:
                Object.assign(
                    {
                        email:
                            source.email,

                        email_verified:
                            Boolean(
                                source.emailVerified
                            )
                    },
                    cloneValue(
                        source.customClaims ||
                        {}
                    )
                )
        },
        overrides || {}
    );
}

/* ==========================================================
   PROVIDER ROUTE PRESETS
========================================================== */

function registerPaystackRoutes(
    context,
    options
) {
    const settings =
        options || {};

    const reference =
        settings.reference ||
        "LET-PS-TEST001";

    const amount =
        settings.amount ||
        260000;

    const email =
        settings.email ||
        "customer@example.com";

    context.providerHarness.once(
        "POST",
        "https://api.paystack.co/transaction/initialize",
        {
            status:
                200,

            json: {
                status:
                    true,

                message:
                    "Authorization URL created",

                data: {
                    authorization_url:
                        "https://checkout.paystack.com/test",

                    access_code:
                        "access-test",

                    reference:
                        reference
                }
            }
        },
        {
            body:
                settings.initializeBodyMatcher
        }
    );

    context.providerHarness.once(
        "GET",
        new RegExp(
            "^https://api\\.paystack\\.co/transaction/verify/"
        ),
        {
            status:
                200,

            json: {
                status:
                    true,

                data: {
                    id:
                        settings.transactionId ||
                        10001,

                    reference:
                        reference,

                    status:
                        settings.status ||
                        "success",

                    amount:
                        Math.round(
                            amount * 100
                        ),

                    currency:
                        settings.currency ||
                        "NGN",

                    paid_at:
                        context.nowDate()
                            .toISOString(),

                    gateway_response:
                        "Successful",

                    customer: {
                        email:
                            email
                    },

                    authorization: {
                        authorization_code:
                            "AUTH_PRIVATE",

                        reusable:
                            false,

                        channel:
                            "card",

                        card_type:
                            "visa",

                        last4:
                            "4081"
                    }
                }
            }
        }
    );

    return context;
}

function registerFlutterwaveRoutes(
    context,
    options
) {
    const settings =
        options || {};

    const transactionId =
        settings.transactionId ||
        20001;

    const reference =
        settings.reference ||
        "LET-FW-TEST001";

    const amount =
        settings.amount ||
        260000;

    context.providerHarness.once(
        "POST",
        "https://api.flutterwave.com/v3/payments",
        {
            status:
                200,

            json: {
                status:
                    "success",

                message:
                    "Hosted Link",

                data: {
                    link:
                        "https://checkout.flutterwave.com/test"
                }
            }
        }
    );

    context.providerHarness.once(
        "GET",
        new RegExp(
            "^https://api\\.flutterwave\\.com/v3/transactions/"
        ),
        {
            status:
                200,

            json: {
                status:
                    "success",

                data: {
                    id:
                        transactionId,

                    tx_ref:
                        reference,

                    status:
                        settings.status ||
                        "successful",

                    amount:
                        amount,

                    charged_amount:
                        amount,

                    currency:
                        settings.currency ||
                        "NGN",

                    customer: {
                        email:
                            settings.email ||
                            "customer@example.com"
                    }
                }
            }
        }
    );

    return context;
}

function registerResendRoute(
    context,
    options
) {
    const settings =
        options || {};

    context.providerHarness.route({
        method:
            "POST",

        url:
            "https://api.resend.com/emails",

        times:
            settings.times ||
            1,

        handler:
            function (
                call
            ) {
                const tags =
                    call.body &&
                    Array.isArray(
                        call.body.tags
                    )
                        ? call.body.tags
                        : [];

                const typeTag =
                    tags.find(
                        function (tag) {
                            return tag.name ===
                                "type";
                        }
                    );

                return {
                    status:
                        settings.status ||
                        200,

                    json: {
                        id:
                            settings.messageId ||
                            "email-" +
                            (
                                typeTag
                                    ? typeTag.value
                                    : "test"
                            )
                    }
                };
            }
    });

    return context;
}

/* ==========================================================
   INTERNAL HELPERS
========================================================== */

function mergeValue(
    current,
    update
) {
    const output =
        cloneValue(
            current || {}
        );

    Object.keys(
        update || {}
    ).forEach(
        function (key) {
            const incoming =
                update[key];

            if (
                incoming &&
                typeof incoming ===
                    "object" &&
                !Array.isArray(
                    incoming
                ) &&
                !(incoming instanceof Date) &&
                output[key] &&
                typeof output[key] ===
                    "object" &&
                !Array.isArray(
                    output[key]
                ) &&
                !(output[key] instanceof Date)
            ) {
                output[key] =
                    mergeValue(
                        output[key],
                        incoming
                    );
            } else {
                output[key] =
                    cloneValue(
                        incoming
                    );
            }
        }
    );

    return output;
}

function normalizeTimeValue(value) {
    if (
        value instanceof Date
    ) {
        return value.getTime();
    }

    if (
        value &&
        typeof value.toMillis ===
            "function"
    ) {
        return value.toMillis();
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
            throw new TypeError(
                "Invalid time value."
            );
        }

        return parsed;
    }

    const numeric =
        Number(value);

    if (
        !Number.isFinite(
            numeric
        )
    ) {
        throw new TypeError(
            "Invalid time value."
        );
    }

    return numeric;
}

function addFixtureTimestamps(
    data,
    milliseconds
) {
    const output =
        cloneValue(
            data || {}
        );

    const timestamp =
        TestTimestamp
            .fromMillis(
                milliseconds
            );

    if (
        output.createdAt ===
        undefined
    ) {
        output.createdAt =
            timestamp;
    }

    if (
        output.updatedAt ===
        undefined
    ) {
        output.updatedAt =
            timestamp;
    }

    return output;
}

function omitIdentifier(value) {
    const output =
        cloneValue(
            value || {}
        );

    delete output.id;

    return output;
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    createServiceTestContext,
    createServiceDependencies,
    createAdministratorIdentity,
    createAuthContext,
    seedDefaultFixtures,
    registerPaystackRoutes,
    registerFlutterwaveRoutes,
    registerResendRoute,
    createCustomer,
    createAdministrator,
    createSuperAdministrator,
    createUserProfile,
    createProduct,
    createCoupon,
    createOrder,
    createCheckoutPayload,
    DEFAULT_CONFIGURATION,
    DEFAULT_NOW
};