"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   SHARED TEST FIXTURES

   Provides:
   - Customer and administrator users
   - Firestore user profiles
   - Products and variants
   - Categories and collections
   - Coupons
   - Orders and order items
   - Checkout payloads
   - Payment provider responses
   - Payment webhook payloads
   - Email configuration
   - Complete seeded document maps
========================================================== */

/* ==========================================================
   CONSTANTS
========================================================== */

const FIXED_DATE =
    "2026-07-20T09:00:00.000Z";

const FIXED_DATE_MS =
    Date.parse(FIXED_DATE);

const DEFAULT_PASSWORD =
    "Password123!";

const DEFAULT_CURRENCY =
    "NGN";

const CUSTOMER_ID =
    "customer-1";

const SECOND_CUSTOMER_ID =
    "customer-2";

const ADMIN_ID =
    "admin-1";

const SUPERADMIN_ID =
    "superadmin-1";

const PRODUCT_ID =
    "product-coat";

const SECOND_PRODUCT_ID =
    "product-bag";

const ORDER_ID =
    "order-1";

const COUPON_ID =
    "WELCOME10";

/* ==========================================================
   VALUE HELPERS
========================================================== */

function isPlainObject(value) {
    if (
        value === null ||
        typeof value !== "object"
    ) {
        return false;
    }

    const prototype =
        Object.getPrototypeOf(value);

    return (
        prototype ===
            Object.prototype ||
        prototype === null
    );
}

function cloneValue(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    if (value instanceof Date) {
        return new Date(
            value.getTime()
        );
    }

    if (Buffer.isBuffer(value)) {
        return Buffer.from(value);
    }

    if (Array.isArray(value)) {
        return value.map(
            cloneValue
        );
    }

    if (isPlainObject(value)) {
        return Object.keys(value)
            .reduce(
                function (
                    output,
                    key
                ) {
                    output[key] =
                        cloneValue(
                            value[key]
                        );

                    return output;
                },
                {}
            );
    }

    return value;
}

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
                isPlainObject(
                    incoming
                ) &&
                isPlainObject(
                    output[key]
                )
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

function omitIdentifier(value) {
    const output =
        cloneValue(
            value || {}
        );

    delete output.id;

    return output;
}

function createTimestamp(
    value
) {
    const milliseconds =
        value === undefined
            ? FIXED_DATE_MS
            : normalizeTime(value);

    return {
        toDate:
            function () {
                return new Date(
                    milliseconds
                );
            },

        toMillis:
            function () {
                return milliseconds;
            },

        valueOf:
            function () {
                return milliseconds;
            },

        toJSON:
            function () {
                return new Date(
                    milliseconds
                ).toISOString();
            }
    };
}

function normalizeTime(value) {
    if (value instanceof Date) {
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
                "Invalid fixture timestamp."
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
            "Invalid fixture timestamp."
        );
    }

    return numeric;
}

/* ==========================================================
   AUTH USERS
========================================================== */

function createCustomerUser(
    overrides
) {
    return mergeValue(
        {
            uid:
                CUSTOMER_ID,

            email:
                "customer@example.com",

            emailVerified:
                true,

            displayName:
                "Test Customer",

            photoURL:
                "https://example.com/customer.jpg",

            phoneNumber:
                "+2348000000000",

            disabled:
                false,

            password:
                DEFAULT_PASSWORD,

            customClaims: {
                role:
                    "customer",

                admin:
                    false,

                superadmin:
                    false
            },

            providerData: [
                {
                    uid:
                        "customer@example.com",

                    email:
                        "customer@example.com",

                    providerId:
                        "password",

                    displayName:
                        "Test Customer"
                }
            ],

            metadata: {
                creationTime:
                    FIXED_DATE,

                lastSignInTime:
                    FIXED_DATE,

                lastRefreshTime:
                    FIXED_DATE
            }
        },
        overrides || {}
    );
}

function createSecondCustomerUser(
    overrides
) {
    return createCustomerUser(
        mergeValue(
            {
                uid:
                    SECOND_CUSTOMER_ID,

                email:
                    "customer-2@example.com",

                displayName:
                    "Second Customer",

                phoneNumber:
                    "+2348111111111",

                photoURL:
                    "https://example.com/customer-2.jpg",

                providerData: [
                    {
                        uid:
                            "customer-2@example.com",

                        email:
                            "customer-2@example.com",

                        providerId:
                            "password",

                        displayName:
                            "Second Customer"
                    }
                ]
            },
            overrides || {}
        )
    );
}

function createAdministratorUser(
    overrides
) {
    return mergeValue(
        {
            uid:
                ADMIN_ID,

            email:
                "admin@example.com",

            emailVerified:
                true,

            displayName:
                "Store Administrator",

            photoURL:
                "",

            phoneNumber:
                "+2348222222222",

            disabled:
                false,

            password:
                DEFAULT_PASSWORD,

            customClaims: {
                role:
                    "admin",

                admin:
                    true,

                superadmin:
                    false
            },

            providerData: [
                {
                    uid:
                        "admin@example.com",

                    email:
                        "admin@example.com",

                    providerId:
                        "password",

                    displayName:
                        "Store Administrator"
                }
            ],

            metadata: {
                creationTime:
                    FIXED_DATE,

                lastSignInTime:
                    FIXED_DATE,

                lastRefreshTime:
                    FIXED_DATE
            }
        },
        overrides || {}
    );
}

function createSuperAdministratorUser(
    overrides
) {
    return mergeValue(
        {
            uid:
                SUPERADMIN_ID,

            email:
                "owner@example.com",

            emailVerified:
                true,

            displayName:
                "Store Owner",

            photoURL:
                "",

            phoneNumber:
                "+2348333333333",

            disabled:
                false,

            password:
                DEFAULT_PASSWORD,

            customClaims: {
                role:
                    "superadmin",

                admin:
                    true,

                superadmin:
                    true
            },

            providerData: [
                {
                    uid:
                        "owner@example.com",

                    email:
                        "owner@example.com",

                    providerId:
                        "password",

                    displayName:
                        "Store Owner"
                }
            ],

            metadata: {
                creationTime:
                    FIXED_DATE,

                lastSignInTime:
                    FIXED_DATE,

                lastRefreshTime:
                    FIXED_DATE
            }
        },
        overrides || {}
    );
}

/* ==========================================================
   USER PROFILES
========================================================== */

function createUserProfile(
    user,
    overrides
) {
    const source =
        user ||
        createCustomerUser();

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

            firstName:
                source.displayName
                    ? source.displayName
                        .split(" ")[0]
                    : "",

            lastName:
                source.displayName
                    ? source.displayName
                        .split(" ")
                        .slice(1)
                        .join(" ")
                    : "",

            phone:
                source.phoneNumber ||
                "",

            phoneNumber:
                source.phoneNumber ||
                "",

            photoURL:
                source.photoURL ||
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

            addresses: [
                createAddress()
            ],

            preferences: {
                currency:
                    DEFAULT_CURRENCY,

                language:
                    "en",

                marketingEmails:
                    true,

                orderUpdates:
                    true
            },

            createdAt:
                createTimestamp(),

            updatedAt:
                createTimestamp()
        },
        overrides || {}
    );
}

function createAddress(
    overrides
) {
    return mergeValue(
        {
            id:
                "address-home",

            label:
                "Home",

            firstName:
                "Test",

            lastName:
                "Customer",

            addressLine1:
                "10 Example Road",

            addressLine2:
                "Apartment 4",

            city:
                "Lagos",

            state:
                "Lagos",

            postalCode:
                "100001",

            country:
                "Nigeria",

            countryCode:
                "NG",

            phone:
                "+2348000000000",

            isDefault:
                true
        },
        overrides || {}
    );
}

/* ==========================================================
   PRODUCT FIXTURES
========================================================== */

function createProductVariant(
    overrides
) {
    return mergeValue(
        {
            id:
                "black-medium",

            sku:
                "COAT-BLK-M",

            name:
                "Black / Medium",

            color:
                "Black",

            colorCode:
                "#000000",

            size:
                "M",

            price:
                250000,

            compareAtPrice:
                280000,

            inventory:
                4,

            stock:
                4,

            reserved:
                0,

            active:
                true,

            available:
                true,

            image:
                "https://example.com/coat-black.jpg"
        },
        overrides || {}
    );
}

function createProduct(
    overrides
) {
    return mergeValue(
        {
            id:
                PRODUCT_ID,

            name:
                "Signature Coat",

            slug:
                "signature-coat",

            sku:
                "COAT-001",

            shortDescription:
                "A tailored luxury coat.",

            description:
                "A timeless tailored coat crafted for refined everyday wear.",

            active:
                true,

            published:
                true,

            archived:
                false,

            featured:
                true,

            currency:
                DEFAULT_CURRENCY,

            price:
                250000,

            compareAtPrice:
                280000,

            costPrice:
                120000,

            inventory:
                8,

            stock:
                8,

            reserved:
                0,

            inStock:
                true,

            lowStockThreshold:
                2,

            categoryId:
                "outerwear",

            categoryName:
                "Outerwear",

            collectionIds: [
                "signature"
            ],

            tags: [
                "coat",
                "outerwear",
                "luxury"
            ],

            images: [
                {
                    url:
                        "https://example.com/coat.jpg",

                    alt:
                        "Signature Coat",

                    position:
                        0
                },

                {
                    url:
                        "https://example.com/coat-back.jpg",

                    alt:
                        "Signature Coat rear view",

                    position:
                        1
                }
            ],

            variants: [
                createProductVariant()
            ],

            seo: {
                title:
                    "Signature Coat | L'ÉTERNEL",

                description:
                    "Shop the L'ÉTERNEL Signature Coat."
            },

            createdAt:
                createTimestamp(),

            updatedAt:
                createTimestamp()
        },
        overrides || {}
    );
}

function createSecondProduct(
    overrides
) {
    return createProduct(
        mergeValue(
            {
                id:
                    SECOND_PRODUCT_ID,

                name:
                    "Leather Bag",

                slug:
                    "leather-bag",

                sku:
                    "BAG-001",

                shortDescription:
                    "A structured leather bag.",

                description:
                    "A refined leather bag with a structured silhouette.",

                price:
                    100000,

                compareAtPrice:
                    120000,

                costPrice:
                    45000,

                inventory:
                    6,

                stock:
                    6,

                categoryId:
                    "accessories",

                categoryName:
                    "Accessories",

                collectionIds: [
                    "essentials"
                ],

                tags: [
                    "bag",
                    "leather",
                    "accessories"
                ],

                images: [
                    {
                        url:
                            "https://example.com/bag.jpg",

                        alt:
                            "Leather Bag",

                        position:
                            0
                    }
                ],

                variants:
                    [],

                seo: {
                    title:
                        "Leather Bag | L'ÉTERNEL",

                    description:
                        "Shop the L'ÉTERNEL Leather Bag."
                }
            },
            overrides || {}
        )
    );
}

function createDraftProduct(
    overrides
) {
    return createProduct(
        mergeValue(
            {
                id:
                    "product-draft",

                name:
                    "Draft Dress",

                slug:
                    "draft-dress",

                sku:
                    "DRESS-DRAFT",

                price:
                    180000,

                compareAtPrice:
                    200000,

                published:
                    false,

                featured:
                    false,

                inventory:
                    5,

                stock:
                    5,

                variants:
                    []
            },
            overrides || {}
        )
    );
}

function createOutOfStockProduct(
    overrides
) {
    return createProduct(
        mergeValue(
            {
                id:
                    "product-out-of-stock",

                name:
                    "Sold Out Jacket",

                slug:
                    "sold-out-jacket",

                sku:
                    "JACKET-SOLD",

                inventory:
                    0,

                stock:
                    0,

                inStock:
                    false,

                variants: [
                    createProductVariant({
                        id:
                            "navy-large",

                        sku:
                            "JACKET-NVY-L",

                        color:
                            "Navy",

                        size:
                            "L",

                        inventory:
                            0,

                        stock:
                            0,

                        available:
                            false
                    })
                ]
            },
            overrides || {}
        )
    );
}

/* ==========================================================
   CATEGORIES AND COLLECTIONS
========================================================== */

function createCategory(
    overrides
) {
    return mergeValue(
        {
            id:
                "outerwear",

            name:
                "Outerwear",

            slug:
                "outerwear",

            description:
                "Refined coats and jackets.",

            active:
                true,

            archived:
                false,

            featured:
                true,

            image:
                "https://example.com/category-outerwear.jpg",

            position:
                1,

            productCount:
                1,

            createdAt:
                createTimestamp(),

            updatedAt:
                createTimestamp()
        },
        overrides || {}
    );
}

function createCollection(
    overrides
) {
    return mergeValue(
        {
            id:
                "signature",

            name:
                "Signature",

            slug:
                "signature",

            description:
                "The defining pieces of L'ÉTERNEL.",

            active:
                true,

            archived:
                false,

            featured:
                true,

            image:
                "https://example.com/collection-signature.jpg",

            productIds: [
                PRODUCT_ID
            ],

            position:
                1,

            createdAt:
                createTimestamp(),

            updatedAt:
                createTimestamp()
        },
        overrides || {}
    );
}

/* ==========================================================
   COUPONS
========================================================== */

function createCoupon(
    overrides
) {
    return mergeValue(
        {
            id:
                COUPON_ID,

            code:
                COUPON_ID,

            name:
                "Welcome Discount",

            description:
                "Ten percent off eligible orders.",

            active:
                true,

            archived:
                false,

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

            perCustomerLimit:
                1,

            startsAt:
                createTimestamp(
                    "2026-01-01T00:00:00.000Z"
                ),

            expiresAt:
                createTimestamp(
                    "2026-12-31T23:59:59.000Z"
                ),

            createdAt:
                createTimestamp(),

            updatedAt:
                createTimestamp()
        },
        overrides || {}
    );
}

function createExpiredCoupon(
    overrides
) {
    return createCoupon(
        mergeValue(
            {
                id:
                    "EXPIRED10",

                code:
                    "EXPIRED10",

                active:
                    true,

                expiresAt:
                    createTimestamp(
                        "2026-01-01T00:00:00.000Z"
                    )
            },
            overrides || {}
        )
    );
}

function createFixedCoupon(
    overrides
) {
    return createCoupon(
        mergeValue(
            {
                id:
                    "SAVE20000",

                code:
                    "SAVE20000",

                type:
                    "fixed",

                value:
                    20000,

                minimumSubtotal:
                    150000,

                maximumDiscount:
                    20000
            },
            overrides || {}
        )
    );
}

/* ==========================================================
   ORDER FIXTURES
========================================================== */

function createOrderItem(
    overrides
) {
    return mergeValue(
        {
            productId:
                PRODUCT_ID,

            variantId:
                "black-medium",

            sku:
                "COAT-BLK-M",

            name:
                "Signature Coat",

            slug:
                "signature-coat",

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
        },
        overrides || {}
    );
}

function createSecondOrderItem(
    overrides
) {
    return createOrderItem(
        mergeValue(
            {
                productId:
                    SECOND_PRODUCT_ID,

                variantId:
                    "",

                sku:
                    "BAG-001",

                name:
                    "Leather Bag",

                slug:
                    "leather-bag",

                color:
                    "",

                size:
                    "",

                quantity:
                    1,

                unitPrice:
                    100000,

                price:
                    100000,

                lineTotal:
                    100000,

                image:
                    "https://example.com/bag.jpg"
            },
            overrides || {}
        )
    );
}

function createCustomerDetails(
    overrides
) {
    return mergeValue(
        {
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
        overrides || {}
    );
}

function createShippingAddress(
    overrides
) {
    return mergeValue(
        {
            firstName:
                "Test",

            lastName:
                "Customer",

            addressLine1:
                "10 Example Road",

            addressLine2:
                "Apartment 4",

            city:
                "Lagos",

            state:
                "Lagos",

            postalCode:
                "100001",

            country:
                "Nigeria",

            countryCode:
                "NG",

            phone:
                "+2348000000000"
        },
        overrides || {}
    );
}

function createPaymentDetails(
    overrides
) {
    return mergeValue(
        {
            provider:
                "paystack",

            reference:
                "LET-PS-ORDER001",

            providerReference:
                "LET-PS-ORDER001",

            providerTransactionId:
                "100001",

            status:
                "pending",

            currency:
                DEFAULT_CURRENCY,

            amount:
                260000,

            authorization: {
                channel:
                    "card",

                cardType:
                    "visa",

                last4:
                    "4081",

                reusable:
                    false
            }
        },
        overrides || {}
    );
}

function createOrder(
    overrides
) {
    return mergeValue(
        {
            id:
                ORDER_ID,

            orderNumber:
                "LET-20260720-ORDER001",

            userId:
                CUSTOMER_ID,

            status:
                "pending",

            paymentStatus:
                "pending",

            paymentMethod:
                "paystack",

            paymentProvider:
                "paystack",

            paymentReference:
                "LET-PS-ORDER001",

            currency:
                DEFAULT_CURRENCY,

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

            couponCode:
                "",

            deliveryMethod:
                "standard",

            inventoryRestored:
                false,

            customer:
                createCustomerDetails(),

            shippingAddress:
                createShippingAddress(),

            billingAddress:
                createShippingAddress(),

            billingSameAsShipping:
                true,

            notes:
                "Call on arrival.",

            items: [
                createOrderItem()
            ],

            payment:
                createPaymentDetails(),

            tracking:
                null,

            statusHistory: [
                {
                    status:
                        "pending",

                    note:
                        "Order created.",

                    actorType:
                        "system",

                    createdAt:
                        createTimestamp()
                }
            ],

            createdAt:
                createTimestamp(),

            updatedAt:
                createTimestamp()
        },
        overrides || {}
    );
}

function createPaidOrder(
    overrides
) {
    return createOrder(
        mergeValue(
            {
                status:
                    "confirmed",

                paymentStatus:
                    "paid",

                paidAt:
                    createTimestamp(),

                payment:
                    createPaymentDetails({
                        status:
                            "paid"
                    }),

                statusHistory: [
                    {
                        status:
                            "pending",

                        note:
                            "Order created.",

                        actorType:
                            "system",

                        createdAt:
                            createTimestamp(
                                FIXED_DATE_MS -
                                60000
                            )
                    },

                    {
                        status:
                            "confirmed",

                        note:
                            "Payment confirmed.",

                        actorType:
                            "system",

                        createdAt:
                            createTimestamp()
                    }
                ]
            },
            overrides || {}
        )
    );
}

function createShippedOrder(
    overrides
) {
    return createPaidOrder(
        mergeValue(
            {
                status:
                    "shipped",

                tracking: {
                    carrier:
                        "DHL",

                    trackingNumber:
                        "DHL-LETERNEL-001",

                    trackingUrl:
                        "https://example.com/track/DHL-LETERNEL-001",

                    shippedAt:
                        createTimestamp()
                },

                statusHistory: [
                    {
                        status:
                            "pending",

                        createdAt:
                            createTimestamp(
                                FIXED_DATE_MS -
                                180000
                            )
                    },

                    {
                        status:
                            "confirmed",

                        createdAt:
                            createTimestamp(
                                FIXED_DATE_MS -
                                120000
                            )
                    },

                    {
                        status:
                            "processing",

                        createdAt:
                            createTimestamp(
                                FIXED_DATE_MS -
                                60000
                            )
                    },

                    {
                        status:
                            "shipped",

                        createdAt:
                            createTimestamp()
                    }
                ]
            },
            overrides || {}
        )
    );
}

/* ==========================================================
   CHECKOUT PAYLOADS
========================================================== */

function createCheckoutPayload(
    overrides
) {
    return mergeValue(
        {
            customer:
                createCustomerDetails(),

            shippingAddress:
                createShippingAddress(),

            billingAddress:
                createShippingAddress(),

            billingSameAsShipping:
                true,

            deliveryMethod:
                "standard",

            paymentMethod:
                "paystack",

            couponCode:
                "",

            notes:
                "Call on arrival.",

            idempotencyKey:
                "checkout-test-key-001",

            items: [
                {
                    productId:
                        PRODUCT_ID,

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

function createMultiItemCheckoutPayload(
    overrides
) {
    return createCheckoutPayload(
        mergeValue(
            {
                couponCode:
                    COUPON_ID,

                idempotencyKey:
                    "checkout-multi-item-001",

                items: [
                    {
                        productId:
                            PRODUCT_ID,

                        variantId:
                            "black-medium",

                        quantity:
                            1
                    },

                    {
                        productId:
                            SECOND_PRODUCT_ID,

                        quantity:
                            1
                    }
                ]
            },
            overrides || {}
        )
    );
}

/* ==========================================================
   PAYMENT PROVIDER FIXTURES
========================================================== */

function createPaystackInitializationResponse(
    overrides
) {
    return mergeValue(
        {
            status:
                true,

            message:
                "Authorization URL created",

            data: {
                authorization_url:
                    "https://checkout.paystack.com/test",

                access_code:
                    "access-test-001",

                reference:
                    "LET-PS-ORDER001"
            }
        },
        overrides || {}
    );
}

function createPaystackVerificationResponse(
    overrides
) {
    return mergeValue(
        {
            status:
                true,

            message:
                "Verification successful",

            data: {
                id:
                    100001,

                domain:
                    "test",

                status:
                    "success",

                reference:
                    "LET-PS-ORDER001",

                amount:
                    26000000,

                message:
                    null,

                gateway_response:
                    "Successful",

                paid_at:
                    FIXED_DATE,

                created_at:
                    FIXED_DATE,

                channel:
                    "card",

                currency:
                    DEFAULT_CURRENCY,

                customer: {
                    id:
                        40001,

                    first_name:
                        "Test",

                    last_name:
                        "Customer",

                    email:
                        "customer@example.com"
                },

                authorization: {
                    authorization_code:
                        "AUTH_PRIVATE",

                    bin:
                        "408408",

                    last4:
                        "4081",

                    exp_month:
                        "12",

                    exp_year:
                        "2030",

                    channel:
                        "card",

                    card_type:
                        "visa",

                    bank:
                        "TEST BANK",

                    country_code:
                        "NG",

                    brand:
                        "visa",

                    reusable:
                        false
                },

                metadata: {
                    orderId:
                        ORDER_ID,

                    userId:
                        CUSTOMER_ID
                }
            }
        },
        overrides || {}
    );
}

function createFlutterwaveInitializationResponse(
    overrides
) {
    return mergeValue(
        {
            status:
                "success",

            message:
                "Hosted Link",

            data: {
                link:
                    "https://checkout.flutterwave.com/test"
            }
        },
        overrides || {}
    );
}

function createFlutterwaveVerificationResponse(
    overrides
) {
    return mergeValue(
        {
            status:
                "success",

            message:
                "Transaction fetched successfully",

            data: {
                id:
                    200001,

                tx_ref:
                    "LET-FW-ORDER001",

                flw_ref:
                    "FLW-MOCK-REFERENCE",

                device_fingerprint:
                    "test-device",

                amount:
                    260000,

                charged_amount:
                    260000,

                app_fee:
                    3640,

                merchant_fee:
                    0,

                processor_response:
                    "Approved",

                auth_model:
                    "PIN",

                currency:
                    DEFAULT_CURRENCY,

                ip:
                    "127.0.0.1",

                narration:
                    "L'ÉTERNEL order",

                status:
                    "successful",

                payment_type:
                    "card",

                created_at:
                    FIXED_DATE,

                account_id:
                    10001,

                customer: {
                    id:
                        50001,

                    name:
                        "Test Customer",

                    phone_number:
                        "+2348000000000",

                    email:
                        "customer@example.com"
                },

                card: {
                    first_6digits:
                        "408408",

                    last_4digits:
                        "4081",

                    issuer:
                        "TEST BANK",

                    country:
                        "NG",

                    type:
                        "VISA",

                    expiry:
                        "12/30"
                },

                meta: {
                    orderId:
                        ORDER_ID,

                    userId:
                        CUSTOMER_ID
                }
            }
        },
        overrides || {}
    );
}

/* ==========================================================
   WEBHOOK PAYLOADS
========================================================== */

function createPaystackWebhook(
    overrides
) {
    return mergeValue(
        {
            event:
                "charge.success",

            data:
                createPaystackVerificationResponse()
                    .data
        },
        overrides || {}
    );
}

function createPaystackFailureWebhook(
    overrides
) {
    return createPaystackWebhook(
        mergeValue(
            {
                event:
                    "charge.failed",

                data: {
                    status:
                        "failed",

                    gateway_response:
                        "Declined"
                }
            },
            overrides || {}
        )
    );
}

function createPaystackRefundWebhook(
    overrides
) {
    return mergeValue(
        {
            event:
                "refund.processed",

            data: {
                id:
                    70001,

                transaction: {
                    id:
                        100001,

                    reference:
                        "LET-PS-ORDER001"
                },

                amount:
                    26000000,

                currency:
                    DEFAULT_CURRENCY,

                status:
                    "processed",

                refunded_at:
                    FIXED_DATE,

                customer: {
                    email:
                        "customer@example.com"
                },

                metadata: {
                    orderId:
                        ORDER_ID
                }
            }
        },
        overrides || {}
    );
}

function createFlutterwaveWebhook(
    overrides
) {
    return mergeValue(
        {
            event:
                "charge.completed",

            data:
                createFlutterwaveVerificationResponse()
                    .data
        },
        overrides || {}
    );
}

/* ==========================================================
   EMAIL FIXTURES
========================================================== */

function createEmailConfiguration(
    overrides
) {
    return mergeValue(
        {
            provider:
                "resend",

            apiKey:
                "email-test-api-key",

            from:
                "orders@example.com",

            replyTo:
                "support@example.com",

            storeName:
                "L'ÉTERNEL",

            appOrigin:
                "https://shop.example.com"
        },
        overrides || {}
    );
}

function createResendResponse(
    overrides
) {
    return mergeValue(
        {
            id:
                "email-message-001"
        },
        overrides || {}
    );
}

/* ==========================================================
   AUDIT FIXTURES
========================================================== */

function createAuditLog(
    overrides
) {
    return mergeValue(
        {
            id:
                "audit-1",

            action:
                "order.status.updated",

            targetType:
                "order",

            targetId:
                ORDER_ID,

            actorId:
                ADMIN_ID,

            actor: {
                userId:
                    ADMIN_ID,

                email:
                    "admin@example.com",

                role:
                    "admin"
            },

            metadata: {
                previousStatus:
                    "confirmed",

                status:
                    "processing"
            },

            createdAt:
                createTimestamp()
        },
        overrides || {}
    );
}

/* ==========================================================
   DOCUMENT MAPS
========================================================== */

function createCatalogDocuments(
    overrides
) {
    const settings =
        overrides || {};

    const product =
        createProduct(
            settings.product
        );

    const secondProduct =
        createSecondProduct(
            settings.secondProduct
        );

    const draftProduct =
        createDraftProduct(
            settings.draftProduct
        );

    const category =
        createCategory(
            settings.category
        );

    const collection =
        createCollection(
            settings.collection
        );

    const coupon =
        createCoupon(
            settings.coupon
        );

    return {
        [
            "products/" +
            product.id
        ]:
            omitIdentifier(
                product
            ),

        [
            "products/" +
            secondProduct.id
        ]:
            omitIdentifier(
                secondProduct
            ),

        [
            "products/" +
            draftProduct.id
        ]:
            omitIdentifier(
                draftProduct
            ),

        [
            "categories/" +
            category.id
        ]:
            omitIdentifier(
                category
            ),

        [
            "collections/" +
            collection.id
        ]:
            omitIdentifier(
                collection
            ),

        [
            "coupons/" +
            coupon.id
        ]:
            omitIdentifier(
                coupon
            )
    };
}

function createAccountDocuments(
    overrides
) {
    const settings =
        overrides || {};

    const customer =
        createCustomerUser(
            settings.customer
        );

    const secondCustomer =
        createSecondCustomerUser(
            settings.secondCustomer
        );

    const administrator =
        createAdministratorUser(
            settings.administrator
        );

    const superAdministrator =
        createSuperAdministratorUser(
            settings.superAdministrator
        );

    return {
        [
            "users/" +
            customer.uid
        ]:
            createUserProfile(
                customer,
                settings.customerProfile
            ),

        [
            "users/" +
            secondCustomer.uid
        ]:
            createUserProfile(
                secondCustomer,
                settings.secondCustomerProfile
            ),

        [
            "users/" +
            administrator.uid
        ]:
            createUserProfile(
                administrator,
                settings.administratorProfile
            ),

        [
            "users/" +
            superAdministrator.uid
        ]:
            createUserProfile(
                superAdministrator,
                settings.superAdministratorProfile
            )
    };
}

function createCommerceDocuments(
    overrides
) {
    const settings =
        overrides || {};

    const order =
        createOrder(
            settings.order
        );

    const paidOrder =
        createPaidOrder(
            mergeValue(
                {
                    id:
                        "order-paid",

                    orderNumber:
                        "LET-20260720-ORDER002"
                },
                settings.paidOrder ||
                {}
            )
        );

    const audit =
        createAuditLog(
            settings.audit
        );

    return {
        [
            "orders/" +
            order.id
        ]:
            omitIdentifier(
                order
            ),

        [
            "orders/" +
            paidOrder.id
        ]:
            omitIdentifier(
                paidOrder
            ),

        [
            "carts/" +
            CUSTOMER_ID
        ]: {
            userId:
                CUSTOMER_ID,

            items: [
                {
                    productId:
                        PRODUCT_ID,

                    variantId:
                        "black-medium",

                    quantity:
                        1
                }
            ],

            updatedAt:
                createTimestamp()
        },

        [
            "wishlists/" +
            CUSTOMER_ID
        ]: {
            userId:
                CUSTOMER_ID,

            productIds: [
                PRODUCT_ID
            ],

            updatedAt:
                createTimestamp()
        },

        [
            "auditLogs/" +
            audit.id
        ]:
            omitIdentifier(
                audit
            )
    };
}

function createInitialDocuments(
    overrides
) {
    const settings =
        overrides || {};

    return Object.assign(
        {},
        createCatalogDocuments(
            settings.catalog
        ),
        createAccountDocuments(
            settings.accounts
        ),
        createCommerceDocuments(
            settings.commerce
        ),
        cloneValue(
            settings.additionalDocuments ||
            {}
        )
    );
}

function createInitialUsers(
    overrides
) {
    const settings =
        overrides || {};

    const customer =
        createCustomerUser(
            settings.customer
        );

    const secondCustomer =
        createSecondCustomerUser(
            settings.secondCustomer
        );

    const administrator =
        createAdministratorUser(
            settings.administrator
        );

    const superAdministrator =
        createSuperAdministratorUser(
            settings.superAdministrator
        );

    return {
        [customer.uid]:
            customer,

        [secondCustomer.uid]:
            secondCustomer,

        [administrator.uid]:
            administrator,

        [superAdministrator.uid]:
            superAdministrator
    };
}

/* ==========================================================
   COMPLETE FIXTURE SET
========================================================== */

function createFixtureSet(
    overrides
) {
    const settings =
        overrides || {};

    return {
        now:
            settings.now ||
            FIXED_DATE_MS,

        users:
            createInitialUsers(
                settings.users
            ),

        documents:
            createInitialDocuments(
                settings.documents
            ),

        checkout:
            createCheckoutPayload(
                settings.checkout
            ),

        multiItemCheckout:
            createMultiItemCheckoutPayload(
                settings.multiItemCheckout
            ),

        paystack: {
            initialization:
                createPaystackInitializationResponse(
                    settings.paystackInitialization
                ),

            verification:
                createPaystackVerificationResponse(
                    settings.paystackVerification
                ),

            successWebhook:
                createPaystackWebhook(
                    settings.paystackWebhook
                ),

            failureWebhook:
                createPaystackFailureWebhook(
                    settings.paystackFailureWebhook
                ),

            refundWebhook:
                createPaystackRefundWebhook(
                    settings.paystackRefundWebhook
                )
        },

        flutterwave: {
            initialization:
                createFlutterwaveInitializationResponse(
                    settings.flutterwaveInitialization
                ),

            verification:
                createFlutterwaveVerificationResponse(
                    settings.flutterwaveVerification
                ),

            successWebhook:
                createFlutterwaveWebhook(
                    settings.flutterwaveWebhook
                )
        },

        emailConfiguration:
            createEmailConfiguration(
                settings.emailConfiguration
            )
    };
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    FIXED_DATE,
    FIXED_DATE_MS,
    DEFAULT_PASSWORD,
    DEFAULT_CURRENCY,
    CUSTOMER_ID,
    SECOND_CUSTOMER_ID,
    ADMIN_ID,
    SUPERADMIN_ID,
    PRODUCT_ID,
    SECOND_PRODUCT_ID,
    ORDER_ID,
    COUPON_ID,

    createTimestamp,
    createCustomerUser,
    createSecondCustomerUser,
    createAdministratorUser,
    createSuperAdministratorUser,
    createUserProfile,
    createAddress,
    createProductVariant,
    createProduct,
    createSecondProduct,
    createDraftProduct,
    createOutOfStockProduct,
    createCategory,
    createCollection,
    createCoupon,
    createExpiredCoupon,
    createFixedCoupon,
    createOrderItem,
    createSecondOrderItem,
    createCustomerDetails,
    createShippingAddress,
    createPaymentDetails,
    createOrder,
    createPaidOrder,
    createShippedOrder,
    createCheckoutPayload,
    createMultiItemCheckoutPayload,
    createPaystackInitializationResponse,
    createPaystackVerificationResponse,
    createFlutterwaveInitializationResponse,
    createFlutterwaveVerificationResponse,
    createPaystackWebhook,
    createPaystackFailureWebhook,
    createPaystackRefundWebhook,
    createFlutterwaveWebhook,
    createEmailConfiguration,
    createResendResponse,
    createAuditLog,
    createCatalogDocuments,
    createAccountDocuments,
    createCommerceDocuments,
    createInitialDocuments,
    createInitialUsers,
    createFixtureSet,
    cloneValue,
    mergeValue,
    omitIdentifier
};