"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   VALIDATION TESTS
========================================================== */

const test = require("node:test");

const assert = require(
    "node:assert/strict"
);

const validation = require(
    "../src/shared/validation"
);

/* ==========================================================
   CALLABLE DATA
========================================================== */

test(
    "normalizeCallableData returns an empty object for missing data",
    function () {
        assert.deepEqual(
            validation.normalizeCallableData(
                undefined
            ),
            {}
        );

        assert.deepEqual(
            validation.normalizeCallableData(
                null
            ),
            {}
        );
    }
);

test(
    "normalizeCallableData accepts plain objects",
    function () {
        const source = {
            name: "Example"
        };

        assert.equal(
            validation.normalizeCallableData(
                source
            ),
            source
        );
    }
);

test(
    "normalizeCallableData rejects arrays",
    function () {
        assert.throws(
            function () {
                validation.normalizeCallableData(
                    []
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   STRINGS
========================================================== */

test(
    "normalizeString trims text by default",
    function () {
        assert.equal(
            validation.normalizeString(
                "  Luxury Coat  "
            ),
            "Luxury Coat"
        );
    }
);

test(
    "normalizeString can normalize case",
    function () {
        assert.equal(
            validation.normalizeString(
                "  Customer@Example.COM  ",
                {
                    lowercase: true
                }
            ),
            "customer@example.com"
        );

        assert.equal(
            validation.normalizeString(
                " summer25 ",
                {
                    uppercase: true
                }
            ),
            "SUMMER25"
        );
    }
);

test(
    "normalizeString enforces required values",
    function () {
        assert.throws(
            function () {
                validation.normalizeString(
                    "",
                    {
                        fieldName:
                            "Product name",

                        required:
                            true
                    }
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                assert.match(
                    error.message,
                    /product name/i
                );

                return true;
            }
        );
    }
);

test(
    "normalizeString enforces minimum length",
    function () {
        assert.throws(
            function () {
                validation.normalizeString(
                    "ab",
                    {
                        fieldName:
                            "Password",

                        minimumLength:
                            8
                    }
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

test(
    "normalizeString enforces maximum length",
    function () {
        assert.throws(
            function () {
                validation.normalizeString(
                    "123456",
                    {
                        fieldName:
                            "Code",

                        maximumLength:
                            5
                    }
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

test(
    "normalizeString validates patterns",
    function () {
        assert.equal(
            validation.normalizeString(
                "product-123",
                {
                    pattern:
                        /^[a-z0-9-]+$/
                }
            ),
            "product-123"
        );

        assert.throws(
            function () {
                validation.normalizeString(
                    "Product 123",
                    {
                        pattern:
                            /^[a-z0-9-]+$/
                    }
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   BOOLEAN VALUES
========================================================== */

test(
    "normalizeBoolean accepts boolean values",
    function () {
        assert.equal(
            validation.normalizeBoolean(
                true,
                false
            ),
            true
        );

        assert.equal(
            validation.normalizeBoolean(
                false,
                true
            ),
            false
        );
    }
);

test(
    "normalizeBoolean accepts common serialized values",
    function () {
        assert.equal(
            validation.normalizeBoolean(
                "true",
                false
            ),
            true
        );

        assert.equal(
            validation.normalizeBoolean(
                "1",
                false
            ),
            true
        );

        assert.equal(
            validation.normalizeBoolean(
                "false",
                true
            ),
            false
        );

        assert.equal(
            validation.normalizeBoolean(
                "0",
                true
            ),
            false
        );
    }
);

test(
    "normalizeBoolean uses its fallback for unknown values",
    function () {
        assert.equal(
            validation.normalizeBoolean(
                "maybe",
                true
            ),
            true
        );

        assert.equal(
            validation.normalizeBoolean(
                "maybe",
                false
            ),
            false
        );
    }
);

/* ==========================================================
   NUMBERS
========================================================== */

test(
    "normalizeNumber converts numeric strings",
    function () {
        assert.equal(
            validation.normalizeNumber(
                "42",
                {
                    required: true
                }
            ),
            42
        );
    }
);

test(
    "normalizeNumber uses a configured fallback",
    function () {
        assert.equal(
            validation.normalizeNumber(
                undefined,
                {
                    fallback: 20
                }
            ),
            20
        );
    }
);

test(
    "normalizeNumber rejects non-numeric input",
    function () {
        assert.throws(
            function () {
                validation.normalizeNumber(
                    "forty-two"
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

test(
    "normalizeNumber enforces integers",
    function () {
        assert.throws(
            function () {
                validation.normalizeNumber(
                    2.5,
                    {
                        integer: true
                    }
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

test(
    "normalizeNumber enforces minimum and maximum values",
    function () {
        assert.throws(
            function () {
                validation.normalizeNumber(
                    0,
                    {
                        minimum: 1
                    }
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );

        assert.throws(
            function () {
                validation.normalizeNumber(
                    101,
                    {
                        maximum: 100
                    }
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   ARRAYS
========================================================== */

test(
    "normalizeArray returns an empty array for omitted optional input",
    function () {
        assert.deepEqual(
            validation.normalizeArray(
                undefined
            ),
            []
        );
    }
);

test(
    "normalizeArray enforces required input",
    function () {
        assert.throws(
            function () {
                validation.normalizeArray(
                    undefined,
                    {
                        required: true
                    }
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

test(
    "normalizeArray rejects non-array values",
    function () {
        assert.throws(
            function () {
                validation.normalizeArray(
                    "not-an-array"
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

test(
    "normalizeArray enforces list length limits",
    function () {
        assert.throws(
            function () {
                validation.normalizeArray(
                    [],
                    {
                        minimumLength:
                            1
                    }
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );

        assert.throws(
            function () {
                validation.normalizeArray(
                    [1, 2, 3],
                    {
                        maximumLength:
                            2
                    }
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   EMAIL
========================================================== */

test(
    "normalizeEmail lowercases valid addresses",
    function () {
        assert.equal(
            validation.normalizeEmail(
                "Samuel@Example.COM",
                true
            ),
            "samuel@example.com"
        );
    }
);

test(
    "normalizeEmail rejects invalid addresses",
    function () {
        assert.throws(
            function () {
                validation.normalizeEmail(
                    "not-an-email",
                    true
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                assert.match(
                    error.message,
                    /valid email/i
                );

                return true;
            }
        );
    }
);

test(
    "normalizeEmail permits an omitted optional email",
    function () {
        assert.equal(
            validation.normalizeEmail(
                "",
                false
            ),
            ""
        );
    }
);

/* ==========================================================
   PHONE
========================================================== */

test(
    "normalizePhone removes formatting characters",
    function () {
        assert.equal(
            validation.normalizePhone(
                "+234 (800) 123-4567",
                true
            ),
            "+2348001234567"
        );
    }
);

test(
    "normalizePhone rejects short phone numbers",
    function () {
        assert.throws(
            function () {
                validation.normalizePhone(
                    "1234",
                    true
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   CUSTOMER
========================================================== */

test(
    "normalizeCustomer builds a display name",
    function () {
        const customer =
            validation.normalizeCustomer({
                firstName:
                    " Samuel ",

                lastName:
                    " Udom ",

                email:
                    "SAMUEL@EXAMPLE.COM",

                phone:
                    "+234 800 000 0000"
            });

        assert.deepEqual(
            customer,
            {
                firstName:
                    "Samuel",

                lastName:
                    "Udom",

                displayName:
                    "Samuel Udom",

                email:
                    "samuel@example.com",

                phone:
                    "+2348000000000"
            }
        );
    }
);

test(
    "normalizeCustomer requires an object",
    function () {
        assert.throws(
            function () {
                validation.normalizeCustomer(
                    null
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   ADDRESS
========================================================== */

test(
    "normalizeAddress returns a complete normalized address",
    function () {
        const address =
            validation.normalizeAddress({
                firstName:
                    "Samuel",

                lastName:
                    "Udom",

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
                    "ng",

                phone:
                    "+234 800 000 0000"
            });

        assert.equal(
            address.addressLine1,
            "10 Example Road"
        );

        assert.equal(
            address.countryCode,
            "NG"
        );

        assert.equal(
            address.phone,
            "+2348000000000"
        );
    }
);

test(
    "normalizeAddress applies the default country",
    function () {
        const address =
            validation.normalizeAddress(
                {
                    addressLine1:
                        "10 Example Road",

                    city:
                        "Lagos",

                    state:
                        "Lagos"
                },
                {
                    defaultCountry:
                        "Nigeria"
                }
            );

        assert.equal(
            address.country,
            "Nigeria"
        );
    }
);

test(
    "normalizeAddress rejects invalid postal codes",
    function () {
        assert.throws(
            function () {
                validation.normalizeAddress({
                    addressLine1:
                        "10 Example Road",

                    city:
                        "Lagos",

                    state:
                        "Lagos",

                    postalCode:
                        "###"
                });
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

test(
    "normalizeAddress returns null for an omitted optional address",
    function () {
        assert.equal(
            validation.normalizeAddress(
                undefined,
                {
                    required: false
                }
            ),
            null
        );
    }
);

/* ==========================================================
   ORDER ITEMS
========================================================== */

test(
    "normalizeOrderItem returns only trusted identifiers and quantity",
    function () {
        const item =
            validation.normalizeOrderItem(
                {
                    productId:
                        "product-1",

                    variantId:
                        "black-medium",

                    quantity:
                        "2",

                    price:
                        1,

                    lineTotal:
                        2,

                    name:
                        "Tampered product"
                },
                0
            );

        assert.deepEqual(
            item,
            {
                productId:
                    "product-1",

                variantId:
                    "black-medium",

                quantity:
                    2
            }
        );
    }
);

test(
    "normalizeOrderItem requires a valid product identifier",
    function () {
        assert.throws(
            function () {
                validation.normalizeOrderItem(
                    {
                        productId:
                            "invalid product id",

                        quantity:
                            1
                    },
                    0
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

test(
    "normalizeOrderItem rejects zero quantity",
    function () {
        assert.throws(
            function () {
                validation.normalizeOrderItem(
                    {
                        productId:
                            "product-1",

                        quantity:
                            0
                    },
                    0
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

test(
    "normalizeOrderItems merges duplicate product variants",
    function () {
        const items =
            validation.normalizeOrderItems([
                {
                    productId:
                        "product-1",

                    variantId:
                        "medium",

                    quantity:
                        2
                },
                {
                    productId:
                        "product-1",

                    variantId:
                        "medium",

                    quantity:
                        3
                },
                {
                    productId:
                        "product-1",

                    variantId:
                        "large",

                    quantity:
                        1
                }
            ]);

        assert.deepEqual(
            items,
            [
                {
                    productId:
                        "product-1",

                    variantId:
                        "medium",

                    quantity:
                        5
                },
                {
                    productId:
                        "product-1",

                    variantId:
                        "large",

                    quantity:
                        1
                }
            ]
        );
    }
);

test(
    "normalizeOrderItems rejects an empty basket",
    function () {
        assert.throws(
            function () {
                validation.normalizeOrderItems(
                    []
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   CHECKOUT
========================================================== */

function createValidCheckoutPayload() {
    return {
        customer: {
            firstName:
                "Samuel",

            lastName:
                "Udom",

            email:
                "samuel@example.com",

            phone:
                "+2348000000000"
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

        billingSameAsShipping:
            true,

        deliveryMethod:
            "standard",

        paymentMethod:
            "paystack",

        couponCode:
            " summer25 ",

        notes:
            "Leave with reception.",

        idempotencyKey:
            "checkout-session-123",

        items: [
            {
                productId:
                    "product-1",

                quantity:
                    2
            }
        ]
    };
}

test(
    "normalizeCreateOrderPayload returns normalized checkout data",
    function () {
        const payload =
            validation
                .normalizeCreateOrderPayload(
                    createValidCheckoutPayload()
                );

        assert.equal(
            payload.customer.displayName,
            "Samuel Udom"
        );

        assert.equal(
            payload.couponCode,
            "SUMMER25"
        );

        assert.equal(
            payload.billingSameAsShipping,
            true
        );

        assert.deepEqual(
            payload.billingAddress,
            payload.shippingAddress
        );

        assert.equal(
            payload.deliveryMethod,
            "standard"
        );

        assert.equal(
            payload.paymentMethod,
            "paystack"
        );
    }
);

test(
    "checkout supports a separate billing address",
    function () {
        const source =
            createValidCheckoutPayload();

        source.billingSameAsShipping =
            false;

        source.billingAddress = {
            addressLine1:
                "20 Billing Street",

            city:
                "Abuja",

            state:
                "FCT",

            country:
                "Nigeria"
        };

        const payload =
            validation
                .normalizeCreateOrderPayload(
                    source
                );

        assert.equal(
            payload.billingAddress
                .addressLine1,
            "20 Billing Street"
        );

        assert.notDeepEqual(
            payload.billingAddress,
            payload.shippingAddress
        );
    }
);

test(
    "checkout requires billing address when it differs from shipping",
    function () {
        const source =
            createValidCheckoutPayload();

        source.billingSameAsShipping =
            false;

        assert.throws(
            function () {
                validation
                    .normalizeCreateOrderPayload(
                        source
                    );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   DELIVERY METHOD
========================================================== */

test(
    "normalizeDeliveryMethod defaults to standard",
    function () {
        assert.equal(
            validation.normalizeDeliveryMethod(),
            "standard"
        );
    }
);

test(
    "normalizeDeliveryMethod accepts configured methods",
    function () {
        assert.equal(
            validation.normalizeDeliveryMethod(
                "EXPRESS"
            ),
            "express"
        );

        assert.equal(
            validation.normalizeDeliveryMethod(
                "international"
            ),
            "international"
        );
    }
);

test(
    "normalizeDeliveryMethod rejects unsupported methods",
    function () {
        assert.throws(
            function () {
                validation.normalizeDeliveryMethod(
                    "same-hour"
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   PAYMENT METHOD
========================================================== */

test(
    "normalizePaymentMethod defaults to card",
    function () {
        assert.equal(
            validation.normalizePaymentMethod(),
            "card"
        );
    }
);

test(
    "normalizePaymentMethod accepts supported providers",
    function () {
        assert.equal(
            validation.normalizePaymentMethod(
                "PAYSTACK"
            ),
            "paystack"
        );

        assert.equal(
            validation.normalizePaymentMethod(
                "flutterwave"
            ),
            "flutterwave"
        );

        assert.equal(
            validation.normalizePaymentMethod(
                "bank-transfer"
            ),
            "bank-transfer"
        );
    }
);

test(
    "normalizePaymentMethod rejects unsupported methods",
    function () {
        assert.throws(
            function () {
                validation.normalizePaymentMethod(
                    "cryptocurrency"
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   COUPON & IDEMPOTENCY
========================================================== */

test(
    "normalizeCouponCode uppercases valid codes",
    function () {
        assert.equal(
            validation.normalizeCouponCode(
                " summer-25 "
            ),
            "SUMMER-25"
        );
    }
);

test(
    "normalizeCouponCode rejects invalid characters",
    function () {
        assert.throws(
            function () {
                validation.normalizeCouponCode(
                    "SAVE 20%"
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

test(
    "normalizeIdempotencyKey accepts safe identifiers",
    function () {
        assert.equal(
            validation.normalizeIdempotencyKey(
                "customer:checkout.123"
            ),
            "customer:checkout.123"
        );
    }
);

test(
    "normalizeIdempotencyKey rejects spaces",
    function () {
        assert.throws(
            function () {
                validation.normalizeIdempotencyKey(
                    "checkout request"
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   ORDER IDENTIFIERS & STATUSES
========================================================== */

test(
    "normalizeOrderId accepts Firestore-safe identifiers",
    function () {
        assert.equal(
            validation.normalizeOrderId(
                "order_123-abc"
            ),
            "order_123-abc"
        );
    }
);

test(
    "normalizeOrderId rejects invalid identifiers",
    function () {
        assert.throws(
            function () {
                validation.normalizeOrderId(
                    "order/123"
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

test(
    "normalizeOrderStatus accepts supported states",
    function () {
        assert.equal(
            validation.normalizeOrderStatus(
                "SHIPPED"
            ),
            "shipped"
        );

        assert.equal(
            validation.normalizeOrderStatus(
                "delivered"
            ),
            "delivered"
        );
    }
);

test(
    "normalizeOrderStatus rejects unknown states",
    function () {
        assert.throws(
            function () {
                validation.normalizeOrderStatus(
                    "lost"
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

test(
    "normalizePaymentStatus accepts supported states",
    function () {
        assert.equal(
            validation.normalizePaymentStatus(
                "PAID"
            ),
            "paid"
        );

        assert.equal(
            validation.normalizePaymentStatus(
                "awaiting-payment"
            ),
            "awaiting-payment"
        );
    }
);

test(
    "normalizePaymentStatus rejects unknown states",
    function () {
        assert.throws(
            function () {
                validation.normalizePaymentStatus(
                    "processing-refund"
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   USER MANAGEMENT
========================================================== */

test(
    "normalizeUserId accepts Firebase-style user identifiers",
    function () {
        assert.equal(
            validation.normalizeUserId(
                "user_ABC-123"
            ),
            "user_ABC-123"
        );
    }
);

test(
    "normalizeUserRole accepts supported roles",
    function () {
        assert.equal(
            validation.normalizeUserRole(
                "ADMIN"
            ),
            "admin"
        );

        assert.equal(
            validation.normalizeUserRole(
                "superadmin"
            ),
            "superadmin"
        );
    }
);

test(
    "normalizeUserRole rejects unsupported roles",
    function () {
        assert.throws(
            function () {
                validation.normalizeUserRole(
                    "manager"
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

test(
    "normalizeUserStatus accepts active and disabled",
    function () {
        assert.equal(
            validation.normalizeUserStatus(
                "ACTIVE"
            ),
            "active"
        );

        assert.equal(
            validation.normalizeUserStatus(
                "disabled"
            ),
            "disabled"
        );
    }
);

test(
    "normalizeUserStatus rejects unsupported statuses",
    function () {
        assert.throws(
            function () {
                validation.normalizeUserStatus(
                    "suspended"
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   PAGINATION
========================================================== */

test(
    "normalizePagination uses defaults",
    function () {
        assert.deepEqual(
            validation.normalizePagination(
                {}
            ),
            {
                limit: 20,
                cursor: ""
            }
        );
    }
);

test(
    "normalizePagination accepts numeric strings",
    function () {
        assert.deepEqual(
            validation.normalizePagination({
                limit: "50",
                cursor:
                    "cursor-value"
            }),
            {
                limit: 50,
                cursor:
                    "cursor-value"
            }
        );
    }
);

test(
    "normalizePagination rejects excessive limits",
    function () {
        assert.throws(
            function () {
                validation.normalizePagination({
                    limit: 101
                });
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   OBJECT HELPERS
========================================================== */

test(
    "isPlainObject distinguishes objects from arrays and dates",
    function () {
        assert.equal(
            validation.isPlainObject(
                {}
            ),
            true
        );

        assert.equal(
            validation.isPlainObject(
                Object.create(null)
            ),
            true
        );

        assert.equal(
            validation.isPlainObject(
                []
            ),
            false
        );

        assert.equal(
            validation.isPlainObject(
                new Date()
            ),
            false
        );

        assert.equal(
            validation.isPlainObject(
                null
            ),
            false
        );
    }
);

test(
    "removeUndefined recursively removes undefined fields",
    function () {
        const value =
            validation.removeUndefined({
                first:
                    "value",

                second:
                    undefined,

                nested: {
                    retained:
                        true,

                    removed:
                        undefined
                },

                items: [
                    1,
                    undefined,
                    {
                        retained:
                            "yes",

                        removed:
                            undefined
                    }
                ]
            });

        assert.deepEqual(
            value,
            {
                first:
                    "value",

                nested: {
                    retained:
                        true
                },

                items: [
                    1,
                    {
                        retained:
                            "yes"
                    }
                ]
            }
        );
    }
);

test(
    "assertAllowedFields accepts known fields",
    function () {
        assert.equal(
            validation.assertAllowedFields(
                {
                    name:
                        "Coat",

                    price:
                        1000
                },
                [
                    "name",
                    "price"
                ]
            ),
            true
        );
    }
);

test(
    "assertAllowedFields reports unsupported fields",
    function () {
        assert.throws(
            function () {
                validation.assertAllowedFields(
                    {
                        name:
                            "Coat",

                        admin:
                            true
                    },
                    [
                        "name"
                    ]
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                assert.deepEqual(
                    error.details.fields,
                    [
                        "admin"
                    ]
                );

                return true;
            }
        );
    }
);

test(
    "requireFields accepts complete objects",
    function () {
        assert.equal(
            validation.requireFields(
                {
                    name:
                        "Coat",

                    price:
                        1000
                },
                [
                    "name",
                    "price"
                ]
            ),
            true
        );
    }
);

test(
    "requireFields reports missing fields",
    function () {
        assert.throws(
            function () {
                validation.requireFields(
                    {
                        name:
                            "Coat"
                    },
                    [
                        "name",
                        "price"
                    ]
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                assert.deepEqual(
                    error.details.fields,
                    [
                        "price"
                    ]
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   SERVICE ERROR
========================================================== */

test(
    "ServiceError stores public metadata",
    function () {
        const error =
            validation.createServiceError(
                "not-found",
                "Internal description",
                {
                    status:
                        404,

                    publicMessage:
                        "The item was not found.",

                    details: {
                        itemId:
                            "item-1"
                    }
                }
            );

        assert.ok(
            error instanceof
            validation.ServiceError
        );

        assert.equal(
            error.code,
            "not-found"
        );

        assert.equal(
            error.status,
            404
        );

        assert.equal(
            error.publicMessage,
            "The item was not found."
        );

        assert.deepEqual(
            error.details,
            {
                itemId:
                    "item-1"
            }
        );
    }
);