"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ORDER & PAYMENT SERVICE TESTS
========================================================== */

const test = require("node:test");

const assert = require(
    "node:assert/strict"
);

const {
    Timestamp
} = require(
    "firebase-admin/firestore"
);

const orderService = require(
    "../src/orders/order-service"
);

const paymentService = require(
    "../src/payments/payment-service"
);

const validation = require(
    "../src/shared/validation"
);

/* ==========================================================
   TEST HELPERS
========================================================== */

function createDocumentSnapshot(
    id,
    data,
    reference
) {
    return {
        id: id,

        exists:
            data !== null &&
            data !== undefined,

        ref:
            reference || {
                id: id
            },

        data: function () {
            return data;
        },

        get: function (field) {
            return data
                ? data[field]
                : undefined;
        }
    };
}

function createDocumentReference(
    collectionName,
    documentId
) {
    return {
        id:
            documentId,

        path:
            collectionName +
            "/" +
            documentId,

        collectionName:
            collectionName
    };
}

function createCancellationDatabase(
    orderData
) {
    const orderReference =
        createDocumentReference(
            "orders",
            "order-test-1"
        );

    const updates = [];

    const database = {
        collection:
            function (collectionName) {
                return {
                    doc:
                        function (documentId) {
                            assert.equal(
                                collectionName,
                                "orders"
                            );

                            assert.equal(
                                documentId,
                                "order-test-1"
                            );

                            return orderReference;
                        }
                };
            },

        runTransaction:
            async function (callback) {
                const transaction = {
                    get:
                        async function (
                            reference
                        ) {
                            assert.equal(
                                reference,
                                orderReference
                            );

                            return createDocumentSnapshot(
                                "order-test-1",
                                orderData,
                                orderReference
                            );
                        },

                    update:
                        function (
                            reference,
                            value
                        ) {
                            assert.equal(
                                reference,
                                orderReference
                            );

                            updates.push(
                                value
                            );
                        }
                };

                return callback(
                    transaction
                );
            }
    };

    return {
        database:
            database,

        orderReference:
            orderReference,

        updates:
            updates
    };
}

/* ==========================================================
   MONEY & TOTALS
========================================================== */

test(
    "normalizeMoney rounds monetary values to two decimals",
    function () {
        assert.equal(
            orderService.normalizeMoney(
                123.456
            ),
            123.46
        );

        assert.equal(
            orderService.normalizeMoney(
                99.994
            ),
            99.99
        );

        assert.equal(
            orderService.normalizeMoney(
                0
            ),
            0
        );
    }
);

test(
    "normalizeMoney rejects invalid monetary values",
    function () {
        assert.throws(
            function () {
                orderService.normalizeMoney(
                    "not-a-number"
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "failed-precondition"
                );

                return true;
            }
        );
    }
);

test(
    "calculateSubtotal totals order line values",
    function () {
        const subtotal =
            orderService.calculateSubtotal([
                {
                    lineTotal: 45000
                },
                {
                    lineTotal: 27500.5
                },
                {
                    lineTotal: 10000
                }
            ]);

        assert.equal(
            subtotal,
            82500.5
        );
    }
);

test(
    "percentage coupon applies to the eligible subtotal",
    function () {
        const discount =
            orderService.calculateDiscount({
                coupon: {
                    type:
                        "percentage",

                    value:
                        10
                },

                subtotal:
                    200000,

                items: [
                    {
                        productId:
                            "product-1",
                        lineTotal:
                            120000
                    },
                    {
                        productId:
                            "product-2",
                        lineTotal:
                            80000
                    }
                ]
            });

        assert.equal(
            discount,
            20000
        );
    }
);

test(
    "fixed coupon cannot reduce the order below zero",
    function () {
        const discount =
            orderService.calculateDiscount({
                coupon: {
                    type:
                        "fixed",

                    value:
                        100000
                },

                subtotal:
                    40000,

                items: [
                    {
                        productId:
                            "product-1",
                        lineTotal:
                            40000
                    }
                ]
            });

        assert.equal(
            discount,
            40000
        );
    }
);

test(
    "coupon maximum discount is enforced",
    function () {
        const discount =
            orderService.calculateDiscount({
                coupon: {
                    type:
                        "percentage",

                    value:
                        50,

                    maximumDiscount:
                        15000
                },

                subtotal:
                    100000,

                items: [
                    {
                        productId:
                            "product-1",
                        lineTotal:
                            100000
                    }
                ]
            });

        assert.equal(
            discount,
            15000
        );
    }
);

test(
    "product-scoped coupon discounts only eligible items",
    function () {
        const discount =
            orderService.calculateDiscount({
                coupon: {
                    type:
                        "percentage",

                    value:
                        20,

                    productIds: [
                        "product-2"
                    ]
                },

                subtotal:
                    150000,

                items: [
                    {
                        productId:
                            "product-1",
                        lineTotal:
                            100000
                    },
                    {
                        productId:
                            "product-2",
                        lineTotal:
                            50000
                    }
                ]
            });

        assert.equal(
            discount,
            10000
        );
    }
);

/* ==========================================================
   DELIVERY
========================================================== */

test(
    "standard delivery is free above the configured threshold",
    function () {
        const delivery =
            orderService.calculateDelivery({
                method:
                    "standard",

                subtotal:
                    300000,

                discount:
                    0,

                shippingAddress: {
                    country:
                        "Nigeria"
                }
            });

        assert.equal(
            delivery.amount,
            0
        );

        assert.equal(
            delivery.id,
            "standard"
        );
    }
);

test(
    "standard delivery has a fee below the free-delivery threshold",
    function () {
        const delivery =
            orderService.calculateDelivery({
                method:
                    "standard",

                subtotal:
                    100000,

                discount:
                    0,

                shippingAddress: {
                    country:
                        "Nigeria"
                }
            });

        assert.equal(
            delivery.amount,
            5000
        );
    }
);

test(
    "express delivery retains its configured fee",
    function () {
        const delivery =
            orderService.calculateDelivery({
                method:
                    "express",

                subtotal:
                    500000,

                discount:
                    0,

                shippingAddress: {
                    country:
                        "Nigeria"
                }
            });

        assert.equal(
            delivery.amount,
            12000
        );
    }
);

test(
    "unsupported delivery method is rejected",
    function () {
        assert.throws(
            function () {
                orderService.calculateDelivery({
                    method:
                        "teleport",

                    subtotal:
                        100000,

                    discount:
                        0
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
   INVENTORY & VARIANTS
========================================================== */

test(
    "resolveAvailableStock reads product-level inventory",
    function () {
        const stock =
            orderService
                ._internal
                .resolveAvailableStock(
                    {
                        inventory:
                            12
                    },
                    null
                );

        assert.equal(
            stock,
            12
        );
    }
);

test(
    "resolveAvailableStock prefers variant inventory",
    function () {
        const stock =
            orderService
                ._internal
                .resolveAvailableStock(
                    {
                        inventory:
                            100
                    },
                    {
                        inventory:
                            4
                    }
                );

        assert.equal(
            stock,
            4
        );
    }
);

test(
    "resolveProductVariant returns the selected active variant",
    function () {
        const variant =
            orderService
                ._internal
                .resolveProductVariant({
                    productId:
                        "coat-1",

                    variantId:
                        "black-medium",

                    product: {
                        variants: [
                            {
                                id:
                                    "black-small",

                                active:
                                    true
                            },
                            {
                                id:
                                    "black-medium",

                                active:
                                    true,

                                inventory:
                                    3
                            }
                        ]
                    }
                });

        assert.equal(
            variant.id,
            "black-medium"
        );

        assert.equal(
            variant.inventory,
            3
        );
    }
);

test(
    "resolveProductVariant rejects a missing variant",
    function () {
        assert.throws(
            function () {
                orderService
                    ._internal
                    .resolveProductVariant({
                        productId:
                            "coat-1",

                        variantId:
                            "missing",

                        product: {
                            variants: []
                        }
                    });
            },
            function (error) {
                assert.equal(
                    error.code,
                    "product-not-found"
                );

                return true;
            }
        );
    }
);

test(
    "resolveProductVariant rejects an unavailable variant",
    function () {
        assert.throws(
            function () {
                orderService
                    ._internal
                    .resolveProductVariant({
                        productId:
                            "coat-1",

                        variantId:
                            "black-large",

                        product: {
                            variants: [
                                {
                                    id:
                                        "black-large",

                                    available:
                                        false
                                }
                            ]
                        }
                    });
            },
            function (error) {
                assert.equal(
                    error.code,
                    "out-of-stock"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   ORDER ITEM PRICING
========================================================== */

test(
    "priceOrderItem ignores client pricing and uses catalog pricing",
    function () {
        const item =
            orderService
                ._internal
                .priceOrderItem({
                    productId:
                        "product-1",

                    variantId:
                        "",

                    quantity:
                        3,

                    product: {
                        name:
                            "Signature Coat",

                        slug:
                            "signature-coat",

                        sku:
                            "SC-001",

                        price:
                            45000,

                        images: [
                            {
                                url:
                                    "https://example.com/coat.jpg"
                            }
                        ]
                    },

                    variant:
                        null
                });

        assert.equal(
            item.unitPrice,
            45000
        );

        assert.equal(
            item.quantity,
            3
        );

        assert.equal(
            item.lineTotal,
            135000
        );
    }
);

test(
    "variant price overrides the base product price",
    function () {
        const item =
            orderService
                ._internal
                .priceOrderItem({
                    productId:
                        "product-1",

                    variantId:
                        "limited",

                    quantity:
                        2,

                    product: {
                        name:
                            "Signature Coat",

                        price:
                            45000
                    },

                    variant: {
                        id:
                            "limited",

                        name:
                            "Limited Edition",

                        price:
                            60000,

                        inventory:
                            5
                    }
                });

        assert.equal(
            item.unitPrice,
            60000
        );

        assert.equal(
            item.lineTotal,
            120000
        );
    }
);

/* ==========================================================
   IDEMPOTENCY
========================================================== */

test(
    "idempotency hash is deterministic",
    function () {
        const first =
            orderService
                ._internal
                .hashIdempotencyKey(
                    "user-1:checkout-123"
                );

        const second =
            orderService
                ._internal
                .hashIdempotencyKey(
                    "user-1:checkout-123"
                );

        assert.equal(
            first,
            second
        );

        assert.match(
            first,
            /^[a-f0-9]{16}$/
        );
    }
);

test(
    "different idempotency keys create different hashes",
    function () {
        const first =
            orderService
                ._internal
                .hashIdempotencyKey(
                    "checkout-1"
                );

        const second =
            orderService
                ._internal
                .hashIdempotencyKey(
                    "checkout-2"
                );

        assert.notEqual(
            first,
            second
        );
    }
);

/* ==========================================================
   ORDER NUMBER
========================================================== */

test(
    "createOrderNumber produces a readable deterministic reference",
    function () {
        const orderNumber =
            orderService
                ._internal
                .createOrderNumber(
                    "abc123xyz789",
                    new Date(
                        "2026-07-19T12:00:00.000Z"
                    )
                );

        assert.equal(
            orderNumber,
            "LET-20260719-23XYZ789"
        );
    }
);

/* ==========================================================
   CHECKOUT PAYLOAD VALIDATION
========================================================== */

test(
    "checkout payload normalization removes client price fields",
    function () {
        const payload =
            validation
                .normalizeCreateOrderPayload({
                    customer: {
                        firstName:
                            "Samuel",

                        lastName:
                            "Udom",

                        email:
                            "Samuel@example.com",

                        phone:
                            "+234 800 000 0000"
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

                    items: [
                        {
                            productId:
                                "product-1",

                            variantId:
                                "black-medium",

                            quantity:
                                2,

                            price:
                                1,

                            lineTotal:
                                2
                        }
                    ]
                });

        assert.deepEqual(
            payload.items,
            [
                {
                    productId:
                        "product-1",

                    variantId:
                        "black-medium",

                    quantity:
                        2
                }
            ]
        );

        assert.equal(
            payload.customer.email,
            "samuel@example.com"
        );

        assert.equal(
            payload.customer.phone,
            "+2348000000000"
        );
    }
);

test(
    "duplicate checkout items are merged",
    function () {
        const items =
            validation
                .normalizeOrderItems([
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
                }
            ]
        );
    }
);

test(
    "merged checkout quantity cannot exceed the maximum",
    function () {
        assert.throws(
            function () {
                validation
                    .normalizeOrderItems([
                        {
                            productId:
                                "product-1",

                            variantId:
                                "medium",

                            quantity:
                                6
                        },
                        {
                            productId:
                                "product-1",

                            variantId:
                                "medium",

                            quantity:
                                5
                        }
                    ]);
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
   PAYMENT AMOUNTS
========================================================== */

test(
    "Paystack amount conversion uses minor currency units",
    function () {
        const amount =
            paymentService
                ._internal
                .toMinorUnits(
                    1250.5,
                    "NGN"
                );

        assert.equal(
            amount,
            125050
        );
    }
);

test(
    "minor units convert back to the original amount",
    function () {
        const amount =
            paymentService
                ._internal
                .fromMinorUnits(
                    125050,
                    "NGN"
                );

        assert.equal(
            amount,
            1250.5
        );
    }
);

test(
    "zero-decimal currencies are not multiplied by one hundred",
    function () {
        assert.equal(
            paymentService
                ._internal
                .toMinorUnits(
                    5000,
                    "JPY"
                ),
            5000
        );
    }
);

/* ==========================================================
   PAYMENT VERIFICATION
========================================================== */

test(
    "verified payment passes when order details match",
    function () {
        const result =
            paymentService
                .validateVerifiedPayment({
                    order: {
                        total:
                            120000,

                        currency:
                            "NGN",

                        paymentReference:
                            "LET-PS-123",

                        customer: {
                            email:
                                "customer@example.com"
                        }
                    },

                    verification: {
                        amount:
                            120000,

                        currency:
                            "NGN",

                        reference:
                            "LET-PS-123",

                        customerEmail:
                            "customer@example.com"
                    }
                });

        assert.equal(
            result,
            true
        );
    }
);

test(
    "verified payment rejects an amount mismatch",
    function () {
        assert.throws(
            function () {
                paymentService
                    .validateVerifiedPayment({
                        order: {
                            total:
                                120000,

                            currency:
                                "NGN",

                            paymentReference:
                                "LET-PS-123"
                        },

                        verification: {
                            amount:
                                100000,

                            currency:
                                "NGN",

                            reference:
                                "LET-PS-123"
                        }
                    });
            },
            function (error) {
                assert.equal(
                    error.code,
                    "failed-precondition"
                );

                assert.equal(
                    error.details
                        .expectedAmount,
                    120000
                );

                assert.equal(
                    error.details
                        .receivedAmount,
                    100000
                );

                return true;
            }
        );
    }
);

test(
    "verified payment rejects a currency mismatch",
    function () {
        assert.throws(
            function () {
                paymentService
                    .validateVerifiedPayment({
                        order: {
                            total:
                                120000,

                            currency:
                                "NGN"
                        },

                        verification: {
                            amount:
                                120000,

                            currency:
                                "USD"
                        }
                    });
            },
            function (error) {
                assert.equal(
                    error.code,
                    "failed-precondition"
                );

                return true;
            }
        );
    }
);

test(
    "verified payment rejects a reference mismatch",
    function () {
        assert.throws(
            function () {
                paymentService
                    .validateVerifiedPayment({
                        order: {
                            total:
                                120000,

                            currency:
                                "NGN",

                            paymentReference:
                                "EXPECTED-REFERENCE"
                        },

                        verification: {
                            amount:
                                120000,

                            currency:
                                "NGN",

                            reference:
                                "OTHER-REFERENCE"
                        }
                    });
            },
            function (error) {
                assert.equal(
                    error.code,
                    "failed-precondition"
                );

                return true;
            }
        );
    }
);

test(
    "verified payment rejects a customer email mismatch",
    function () {
        assert.throws(
            function () {
                paymentService
                    .validateVerifiedPayment({
                        order: {
                            total:
                                120000,

                            currency:
                                "NGN",

                            customer: {
                                email:
                                    "correct@example.com"
                            }
                        },

                        verification: {
                            amount:
                                120000,

                            currency:
                                "NGN",

                            customerEmail:
                                "wrong@example.com"
                        }
                    });
            },
            function (error) {
                assert.equal(
                    error.code,
                    "failed-precondition"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   WEBHOOK SIGNATURES
========================================================== */

test(
    "safeCompare accepts identical values",
    function () {
        assert.equal(
            paymentService
                ._internal
                .safeCompare(
                    "signature",
                    "signature"
                ),
            true
        );
    }
);

test(
    "safeCompare rejects different values",
    function () {
        assert.equal(
            paymentService
                ._internal
                .safeCompare(
                    "signature-one",
                    "signature-two"
                ),
            false
        );
    }
);

/* ==========================================================
   ORDER CANCELLATION
========================================================== */

test(
    "customer can cancel an eligible unpaid order",
    async function () {
        const fixture =
            createCancellationDatabase({
                userId:
                    "customer-1",

                status:
                    "pending",

                paymentStatus:
                    "pending",

                inventoryRestored:
                    true
            });

        const result =
            await orderService
                .cancelCustomerOrder({
                    db:
                        fixture.database,

                    userId:
                        "customer-1",

                    orderId:
                        "order-test-1",

                    reason:
                        "Ordered by mistake"
                });

        assert.equal(
            result.success,
            true
        );

        assert.equal(
            result.status,
            "cancelled"
        );

        assert.equal(
            fixture.updates.length,
            1
        );

        assert.equal(
            fixture.updates[0]
                .status,
            "cancelled"
        );

        assert.equal(
            fixture.updates[0]
                .cancellationReason,
            "Ordered by mistake"
        );

        assert.ok(
            fixture.updates[0]
                .cancelledAt instanceof
                Timestamp
        );
    }
);

test(
    "customer cannot cancel another customer's order",
    async function () {
        const fixture =
            createCancellationDatabase({
                userId:
                    "customer-2",

                status:
                    "pending",

                paymentStatus:
                    "pending",

                inventoryRestored:
                    true
            });

        await assert.rejects(
            orderService
                .cancelCustomerOrder({
                    db:
                        fixture.database,

                    userId:
                        "customer-1",

                    orderId:
                        "order-test-1"
                }),
            function (error) {
                assert.equal(
                    error.code,
                    "permission-denied"
                );

                return true;
            }
        );

        assert.equal(
            fixture.updates.length,
            0
        );
    }
);

test(
    "customer cannot cancel a shipped order",
    async function () {
        const fixture =
            createCancellationDatabase({
                userId:
                    "customer-1",

                status:
                    "shipped",

                paymentStatus:
                    "paid",

                inventoryRestored:
                    false
            });

        await assert.rejects(
            orderService
                .cancelCustomerOrder({
                    db:
                        fixture.database,

                    userId:
                        "customer-1",

                    orderId:
                        "order-test-1"
                }),
            function (error) {
                assert.equal(
                    error.code,
                    "failed-precondition"
                );

                return true;
            }
        );

        assert.equal(
            fixture.updates.length,
            0
        );
    }
);

test(
    "paid order requires a refund before customer cancellation",
    async function () {
        const fixture =
            createCancellationDatabase({
                userId:
                    "customer-1",

                status:
                    "confirmed",

                paymentStatus:
                    "paid",

                inventoryRestored:
                    false
            });

        await assert.rejects(
            orderService
                .cancelCustomerOrder({
                    db:
                        fixture.database,

                    userId:
                        "customer-1",

                    orderId:
                        "order-test-1"
                }),
            function (error) {
                assert.equal(
                    error.code,
                    "failed-precondition"
                );

                assert.match(
                    error.message,
                    /refund/i
                );

                return true;
            }
        );

        assert.equal(
            fixture.updates.length,
            0
        );
    }
);