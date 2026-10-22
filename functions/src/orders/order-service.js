"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   SECURE ORDER SERVICE
========================================================== */

const {
    FieldValue,
    Timestamp
} = require("firebase-admin/firestore");

const {
    createServiceError,
    normalizeCreateOrderPayload,
    normalizeOrderId,
    normalizeCancellationReason,
    normalizePagination,
    normalizeSearchTerm,
    normalizeOrderStatus,
    normalizePaymentStatus,
    normalizeString
} = require("../shared/validation");

const {
    getPathSegments,
    getQuery,
    parseJsonBody,
    requireMethod,
    encodeCursor,
    decodeCursor
} = require("../shared/http");

/* ==========================================================
   CONSTANTS
========================================================== */

const ORDER_COLLECTION = "orders";
const PRODUCT_COLLECTION = "products";
const COUPON_COLLECTION = "coupons";
const IDEMPOTENCY_COLLECTION =
    "orderIdempotency";
const AUDIT_COLLECTION = "auditLogs";

const DEFAULT_CURRENCY = "NGN";

const ORDER_STATUSES = {
    PENDING: "pending",
    CONFIRMED: "confirmed",
    PROCESSING: "processing",
    SHIPPED: "shipped",
    DELIVERED: "delivered",
    CANCELLED: "cancelled",
    REFUNDED: "refunded"
};

const PAYMENT_STATUSES = {
    PENDING: "pending",
    PAID: "paid",
    FAILED: "failed",
    REFUNDED: "refunded",
    AWAITING_PAYMENT:
        "awaiting-payment"
};

const CANCELLABLE_STATUSES =
    new Set([
        ORDER_STATUSES.PENDING,
        ORDER_STATUSES.CONFIRMED
    ]);

const DEFAULT_DELIVERY_METHODS = {
    standard: {
        id: "standard",
        name: "Standard delivery",
        amount: 5000,
        estimatedDays: {
            minimum: 3,
            maximum: 7
        }
    },

    express: {
        id: "express",
        name: "Express delivery",
        amount: 12000,
        estimatedDays: {
            minimum: 1,
            maximum: 3
        }
    },

    international: {
        id: "international",
        name: "International delivery",
        amount: 35000,
        estimatedDays: {
            minimum: 7,
            maximum: 21
        }
    }
};

const FREE_STANDARD_DELIVERY_THRESHOLD =
    250000;

const MAXIMUM_ORDERS_PER_PAGE = 50;

/* ==========================================================
   ORDER CREATION
========================================================== */

async function createOrder(options) {
    const settings = options || {};

    const db = settings.db;
    const identity =
        settings.identity || {};
    const configuration =
        settings.configuration || {};
    const paymentService =
        settings.paymentService;

    assertServiceDependencies({
        db: db,
        paymentService:
            paymentService
    });

    const payload =
        normalizeCreateOrderPayload(
            settings.payload,
            {
                defaultCountry:
                    "Nigeria"
            }
        );

    const currency =
        normalizeCurrency(
            configuration.currency ||
            DEFAULT_CURRENCY
        );

    const idempotencyKey =
        resolveIdempotencyKey(
            payload.idempotencyKey,
            identity
        );

    if (idempotencyKey) {
        const existingOrder =
            await findExistingIdempotentOrder({
                db: db,
                idempotencyKey:
                    idempotencyKey,
                identity: identity
            });

        if (existingOrder) {
            return createOrderResponse(
                existingOrder,
                true
            );
        }
    }

    const orderReference =
        db.collection(
            ORDER_COLLECTION
        ).doc();

    const idempotencyReference =
        idempotencyKey
            ? db.collection(
                  IDEMPOTENCY_COLLECTION
              ).doc(
                  hashIdempotencyKey(
                      idempotencyKey
                  )
              )
            : null;

    const transactionResult =
        await db.runTransaction(
            async function (
                transaction
            ) {
                if (
                    idempotencyReference
                ) {
                    const existingIdempotency =
                        await transaction.get(
                            idempotencyReference
                        );

                    if (
                        existingIdempotency.exists
                    ) {
                        const data =
                            existingIdempotency.data() ||
                            {};

                        if (data.orderId) {
                            const existingOrderReference =
                                db.collection(
                                    ORDER_COLLECTION
                                ).doc(
                                    data.orderId
                                );

                            const existingOrderSnapshot =
                                await transaction.get(
                                    existingOrderReference
                                );

                            if (
                                existingOrderSnapshot.exists
                            ) {
                                return {
                                    existing: true,

                                    order:
                                        serializeDocument(
                                            existingOrderSnapshot
                                        )
                                };
                            }
                        }

                        throw createServiceError(
                            "aborted",
                            "This checkout request is already being processed.",
                            {
                                status: 409
                            }
                        );
                    }
                }

                const catalogItems =
                    await loadCatalogItems({
                        db: db,
                        transaction:
                            transaction,
                        requestedItems:
                            payload.items
                    });

                const pricedItems =
                    catalogItems.map(
                        function (
                            catalogItem
                        ) {
                            return priceOrderItem(
                                catalogItem
                            );
                        }
                    );

                const subtotal =
                    calculateSubtotal(
                        pricedItems
                    );

                const coupon =
                    await resolveCoupon({
                        db: db,
                        transaction:
                            transaction,
                        couponCode:
                            payload.couponCode,
                        subtotal:
                            subtotal,
                        items:
                            pricedItems,
                        identity:
                            identity
                    });

                const discount =
                    calculateDiscount({
                        coupon: coupon,
                        subtotal:
                            subtotal,
                        items:
                            pricedItems
                    });

                const delivery =
                    calculateDelivery({
                        method:
                            payload.deliveryMethod,
                        subtotal:
                            subtotal,
                        discount:
                            discount,
                        shippingAddress:
                            payload.shippingAddress
                    });

                const tax =
                    calculateTax({
                        subtotal:
                            subtotal,
                        discount:
                            discount,
                        delivery:
                            delivery,
                        shippingAddress:
                            payload.shippingAddress
                    });

                const total =
                    normalizeMoney(
                        subtotal -
                        discount +
                        delivery.amount +
                        tax
                    );

                if (total < 0) {
                    throw createServiceError(
                        "internal",
                        "The order total could not be calculated.",
                        {
                            status: 500
                        }
                    );
                }

                const now =
                    Timestamp.now();

                const orderNumber =
                    createOrderNumber(
                        orderReference.id,
                        now.toDate()
                    );

                const paymentState =
                    determineInitialPaymentState(
                        payload.paymentMethod
                    );

                const order = {
                    orderNumber:
                        orderNumber,

                    userId:
                        identity.uid ||
                        null,

                    guest:
                        !identity.uid,

                    customer:
                        payload.customer,

                    customerEmail:
                        payload.customer.email,

                    customerName:
                        payload.customer
                            .displayName,

                    shippingAddress:
                        payload.shippingAddress,

                    billingAddress:
                        payload.billingAddress,

                    billingSameAsShipping:
                        payload
                            .billingSameAsShipping,

                    deliveryMethod:
                        delivery.id,

                    delivery:
                        delivery,

                    paymentMethod:
                        payload.paymentMethod,

                    paymentProvider:
                        resolvePaymentProvider(
                            payload.paymentMethod,
                            configuration
                                .paymentProvider
                        ),

                    paymentStatus:
                        paymentState
                            .paymentStatus,

                    status:
                        paymentState
                            .orderStatus,

                    currency:
                        currency,

                    items:
                        pricedItems,

                    itemCount:
                        pricedItems.reduce(
                            function (
                                totalQuantity,
                                item
                            ) {
                                return (
                                    totalQuantity +
                                    item.quantity
                                );
                            },
                            0
                        ),

                    subtotal:
                        subtotal,

                    discount:
                        discount,

                    deliveryFee:
                        delivery.amount,

                    tax:
                        tax,

                    total:
                        total,

                    coupon:
                        coupon
                            ? sanitizeCouponForOrder(
                                  coupon
                              )
                            : null,

                    couponCode:
                        coupon
                            ? coupon.code
                            : null,

                    notes:
                        payload.notes ||
                        "",

                    paymentReference:
                        payload.paymentReference ||
                        null,

                    paymentAuthorization:
                        null,

                    payment: {
                        providerReference:
                            null,

                        authorizationUrl:
                            null,

                        accessCode:
                            null,

                        initializedAt:
                            null,

                        paidAt:
                            null,

                        failedAt:
                            null
                    },

                    inventoryReserved:
                        true,

                    inventoryRestored:
                        false,

                    statusHistory: [
                        {
                            status:
                                paymentState
                                    .orderStatus,

                            paymentStatus:
                                paymentState
                                    .paymentStatus,

                            note:
                                "Order created.",

                            source:
                                "checkout",

                            userId:
                                identity.uid ||
                                null,

                            createdAt:
                                now
                        }
                    ],

                    client: {
                        ipAddress:
                            identity.ipAddress ||
                            null,

                        userAgent:
                            truncateText(
                                identity.userAgent,
                                500
                            ),

                        appCheck:
                            Boolean(
                                identity.appCheckToken
                            )
                    },

                    idempotencyKeyHash:
                        idempotencyKey
                            ? hashIdempotencyKey(
                                  idempotencyKey
                              )
                            : null,

                    createdAt:
                        now,

                    updatedAt:
                        now,

                    confirmedAt:
                        null,

                    cancelledAt:
                        null,

                    deliveredAt:
                        null
                };

                reserveInventory({
                    transaction:
                        transaction,
                    catalogItems:
                        catalogItems,
                    now: now
                });

                transaction.create(
                    orderReference,
                    order
                );

                if (coupon) {
                    incrementCouponUsage({
                        transaction:
                            transaction,
                        coupon:
                            coupon,
                        userId:
                            identity.uid,
                        orderId:
                            orderReference.id,
                        now: now
                    });
                }

                if (
                    idempotencyReference
                ) {
                    transaction.create(
                        idempotencyReference,
                        {
                            orderId:
                                orderReference.id,

                            userId:
                                identity.uid ||
                                null,

                            customerEmail:
                                payload.customer
                                    .email,

                            createdAt: now,

                            expiresAt:
                                Timestamp.fromDate(
                                    new Date(
                                        now.toMillis() +
                                        24 *
                                            60 *
                                            60 *
                                            1000
                                    )
                                )
                        }
                    );
                }

                return {
                    existing: false,

                    order: Object.assign(
                        {
                            id:
                                orderReference.id
                        },
                        order
                    )
                };
            }
        );

    if (transactionResult.existing) {
        return createOrderResponse(
            transactionResult.order,
            true
        );
    }

    let order =
        transactionResult.order;

    try {
        const paymentResult =
            await initializeOrderPayment({
                db: db,
                order: order,
                payload: payload,
                configuration:
                    configuration,
                paymentService:
                    paymentService
            });

        if (paymentResult) {
            order = Object.assign(
                {},
                order,
                {
                    payment:
                        Object.assign(
                            {},
                            order.payment,
                            paymentResult.payment ||
                                {}
                        ),

                    paymentReference:
                        paymentResult
                            .paymentReference ||
                        order.paymentReference,

                    paymentStatus:
                        paymentResult
                            .paymentStatus ||
                        order.paymentStatus,

                    status:
                        paymentResult
                            .orderStatus ||
                        order.status,

                    updatedAt:
                        Timestamp.now()
                }
            );
        }
    } catch (error) {
        await handlePaymentInitializationFailure({
            db: db,
            order: order,
            error: error
        });

        throw error;
    }

    return createOrderResponse(
        order,
        false
    );
}

/* ==========================================================
   CATALOG LOADING
========================================================== */

async function loadCatalogItems(options) {
    const settings = options || {};

    const db = settings.db;
    const transaction =
        settings.transaction;
    const requestedItems =
        settings.requestedItems || [];

    const references =
        requestedItems.map(
            function (item) {
                return db
                    .collection(
                        PRODUCT_COLLECTION
                    )
                    .doc(
                        item.productId
                    );
            }
        );

    const snapshots =
        await Promise.all(
            references.map(
                function (reference) {
                    return transaction.get(
                        reference
                    );
                }
            )
        );

    return snapshots.map(
        function (snapshot, index) {
            const requestedItem =
                requestedItems[index];

            if (!snapshot.exists) {
                throw createServiceError(
                    "product-not-found",
                    "A product in your basket is no longer available.",
                    {
                        status: 404,
                        details: {
                            productId:
                                requestedItem
                                    .productId
                        }
                    }
                );
            }

            const product =
                snapshot.data() || {};

            validatePurchasableProduct({
                product:
                    product,
                productId:
                    snapshot.id
            });

            const variant =
                resolveProductVariant({
                    product:
                        product,
                    productId:
                        snapshot.id,
                    variantId:
                        requestedItem
                            .variantId
                });

            const stock =
                resolveAvailableStock(
                    product,
                    variant
                );

            if (
                stock <
                requestedItem.quantity
            ) {
                throw createServiceError(
                    "out-of-stock",
                    createStockErrorMessage(
                        product,
                        stock
                    ),
                    {
                        status: 409,
                        details: {
                            productId:
                                snapshot.id,

                            variantId:
                                requestedItem
                                    .variantId ||
                                null,

                            requestedQuantity:
                                requestedItem
                                    .quantity,

                            availableQuantity:
                                stock
                        }
                    }
                );
            }

            return {
                reference:
                    snapshot.ref,

                productId:
                    snapshot.id,

                product:
                    product,

                variant:
                    variant,

                variantId:
                    requestedItem
                        .variantId ||
                    "",

                quantity:
                    requestedItem.quantity,

                availableStock:
                    stock
            };
        }
    );
}

function validatePurchasableProduct(
    options
) {
    const product =
        options.product || {};

    if (
        product.active === false ||
        product.published === false
    ) {
        throw createServiceError(
            "product-not-found",
            "A product in your basket is no longer available.",
            {
                status: 404,
                details: {
                    productId:
                        options.productId
                }
            }
        );
    }

    const price =
        Number(product.price);

    if (
        !Number.isFinite(price) ||
        price < 0
    ) {
        throw createServiceError(
            "failed-precondition",
            "A product has invalid pricing.",
            {
                status: 412,
                details: {
                    productId:
                        options.productId
                }
            }
        );
    }
}

function resolveProductVariant(options) {
    const product =
        options.product || {};

    const variantId =
        options.variantId || "";

    const variants =
        Array.isArray(
            product.variants
        )
            ? product.variants
            : [];

    if (!variantId) {
        return null;
    }

    const variant =
        variants.find(
            function (candidate) {
                return (
                    String(
                        candidate.id ||
                        candidate.variantId ||
                        candidate.sku ||
                        ""
                    ) === variantId
                );
            }
        );

    if (!variant) {
        throw createServiceError(
            "product-not-found",
            "The selected product option is no longer available.",
            {
                status: 404,
                details: {
                    productId:
                        options.productId,
                    variantId:
                        variantId
                }
            }
        );
    }

    if (
        variant.active === false ||
        variant.available === false
    ) {
        throw createServiceError(
            "out-of-stock",
            "The selected product option is unavailable.",
            {
                status: 409,
                details: {
                    productId:
                        options.productId,
                    variantId:
                        variantId
                }
            }
        );
    }

    return variant;
}

function resolveAvailableStock(
    product,
    variant
) {
    if (variant) {
        return normalizeInventory(
            firstDefined(
                variant.inventory,
                variant.stock,
                variant.quantity,
                0
            )
        );
    }

    return normalizeInventory(
        firstDefined(
            product.inventory,
            product.stock,
            product.quantity,
            0
        )
    );
}

/* ==========================================================
   ITEM PRICING
========================================================== */

function priceOrderItem(
    catalogItem
) {
    const product =
        catalogItem.product;
    const variant =
        catalogItem.variant;

    const unitPrice =
        normalizeMoney(
            variant &&
            variant.price !==
                undefined
                ? variant.price
                : product.price
        );

    const compareAtPrice =
        normalizeOptionalMoney(
            variant &&
            variant.compareAtPrice !==
                undefined
                ? variant.compareAtPrice
                : product.compareAtPrice
        );

    const quantity =
        catalogItem.quantity;

    const lineTotal =
        normalizeMoney(
            unitPrice * quantity
        );

    return {
        productId:
            catalogItem.productId,

        variantId:
            catalogItem.variantId ||
            null,

        sku:
            String(
                (
                    variant &&
                    variant.sku
                ) ||
                product.sku ||
                ""
            ),

        name:
            String(
                product.name ||
                "Product"
            ),

        slug:
            String(
                product.slug ||
                ""
            ),

        variantName:
            resolveVariantName(
                variant
            ),

        size:
            String(
                (
                    variant &&
                    variant.size
                ) ||
                ""
            ),

        color:
            String(
                (
                    variant &&
                    variant.color
                ) ||
                ""
            ),

        image:
            resolveProductImage(
                product,
                variant
            ),

        price:
            unitPrice,

        unitPrice:
            unitPrice,

        compareAtPrice:
            compareAtPrice,

        quantity:
            quantity,

        lineTotal:
            lineTotal
    };
}

function calculateSubtotal(items) {
    return normalizeMoney(
        items.reduce(
            function (total, item) {
                return (
                    total +
                    item.lineTotal
                );
            },
            0
        )
    );
}

/* ==========================================================
   COUPONS
========================================================== */

async function resolveCoupon(options) {
    const settings = options || {};

    if (!settings.couponCode) {
        return null;
    }

    const couponQuery =
        settings.db
            .collection(
                COUPON_COLLECTION
            )
            .where(
                "code",
                "==",
                settings.couponCode
            )
            .limit(1);

    const couponSnapshot =
        await settings.transaction.get(
            couponQuery
        );

    if (couponSnapshot.empty) {
        throw createServiceError(
            "failed-precondition",
            "The coupon code is invalid.",
            {
                status: 412
            }
        );
    }

    const document =
        couponSnapshot.docs[0];

    const coupon =
        Object.assign(
            {
                id: document.id,
                reference:
                    document.ref
            },
            document.data() || {}
        );

    validateCoupon({
        coupon: coupon,
        subtotal:
            settings.subtotal,
        items:
            settings.items,
        identity:
            settings.identity
    });

    return coupon;
}

function validateCoupon(options) {
    const coupon =
        options.coupon || {};

    const now = Date.now();

    if (coupon.active !== true) {
        throw createServiceError(
            "failed-precondition",
            "This coupon is not active.",
            {
                status: 412
            }
        );
    }

    const startsAt =
        toMilliseconds(
            coupon.startsAt
        );

    const expiresAt =
        toMilliseconds(
            coupon.expiresAt
        );

    if (
        startsAt &&
        startsAt > now
    ) {
        throw createServiceError(
            "failed-precondition",
            "This coupon is not active yet.",
            {
                status: 412
            }
        );
    }

    if (
        expiresAt &&
        expiresAt <= now
    ) {
        throw createServiceError(
            "failed-precondition",
            "This coupon has expired.",
            {
                status: 412
            }
        );
    }

    const minimumSubtotal =
        normalizeOptionalMoney(
            coupon.minimumSubtotal
        ) || 0;

    if (
        options.subtotal <
        minimumSubtotal
    ) {
        throw createServiceError(
            "failed-precondition",
            "Your basket does not meet the minimum value for this coupon.",
            {
                status: 412,
                details: {
                    minimumSubtotal:
                        minimumSubtotal
                }
            }
        );
    }

    const maximumUses =
        Number(
            coupon.maximumUses ||
            coupon.usageLimit ||
            0
        );

    const usageCount =
        Number(
            coupon.usageCount || 0
        );

    if (
        maximumUses > 0 &&
        usageCount >= maximumUses
    ) {
        throw createServiceError(
            "failed-precondition",
            "This coupon has reached its usage limit.",
            {
                status: 412
            }
        );
    }

    validateCouponProductScope(
        coupon,
        options.items
    );
}

function validateCouponProductScope(
    coupon,
    items
) {
    const includedProducts =
        Array.isArray(
            coupon.productIds
        )
            ? coupon.productIds
            : [];

    const excludedProducts =
        Array.isArray(
            coupon.excludedProductIds
        )
            ? coupon.excludedProductIds
            : [];

    if (
        includedProducts.length &&
        !items.some(
            function (item) {
                return includedProducts.includes(
                    item.productId
                );
            }
        )
    ) {
        throw createServiceError(
            "failed-precondition",
            "This coupon does not apply to the products in your basket.",
            {
                status: 412
            }
        );
    }

    if (
        excludedProducts.length &&
        items.every(
            function (item) {
                return excludedProducts.includes(
                    item.productId
                );
            }
        )
    ) {
        throw createServiceError(
            "failed-precondition",
            "This coupon does not apply to the products in your basket.",
            {
                status: 412
            }
        );
    }
}

function calculateDiscount(options) {
    const coupon =
        options.coupon;

    if (!coupon) {
        return 0;
    }

    const subtotal =
        options.subtotal;

    let eligibleSubtotal =
        subtotal;

    if (
        Array.isArray(
            coupon.productIds
        ) &&
        coupon.productIds.length
    ) {
        eligibleSubtotal =
            options.items.reduce(
                function (
                    total,
                    item
                ) {
                    return (
                        total +
                        (
                            coupon.productIds.includes(
                                item.productId
                            )
                                ? item.lineTotal
                                : 0
                        )
                    );
                },
                0
            );
    }

    if (
        Array.isArray(
            coupon.excludedProductIds
        ) &&
        coupon.excludedProductIds.length
    ) {
        eligibleSubtotal =
            options.items.reduce(
                function (
                    total,
                    item
                ) {
                    return (
                        total +
                        (
                            coupon.excludedProductIds.includes(
                                item.productId
                            )
                                ? 0
                                : item.lineTotal
                        )
                    );
                },
                0
            );
    }

    const type =
        String(
            coupon.type ||
            coupon.discountType ||
            ""
        ).toLowerCase();

    const value =
        Number(
            coupon.value ||
            coupon.discountValue ||
            0
        );

    let discount = 0;

    if (
        type === "percentage" ||
        type === "percent"
    ) {
        discount =
            eligibleSubtotal *
            (
                Math.max(
                    0,
                    Math.min(
                        100,
                        value
                    )
                ) / 100
            );
    } else if (
        type === "fixed" ||
        type === "amount"
    ) {
        discount = value;
    } else if (
        type === "free-shipping"
    ) {
        discount = 0;
    } else {
        throw createServiceError(
            "failed-precondition",
            "The coupon configuration is invalid.",
            {
                status: 412
            }
        );
    }

    const maximumDiscount =
        normalizeOptionalMoney(
            coupon.maximumDiscount
        );

    if (
        maximumDiscount !== null &&
        maximumDiscount >= 0
    ) {
        discount =
            Math.min(
                discount,
                maximumDiscount
            );
    }

    return normalizeMoney(
        Math.min(
            Math.max(
                0,
                discount
            ),
            subtotal
        )
    );
}

function incrementCouponUsage(options) {
    const coupon =
        options.coupon;

    options.transaction.update(
        coupon.reference,
        {
            usageCount:
                FieldValue.increment(1),

            updatedAt:
                options.now
        }
    );

    const redemptionReference =
        coupon.reference
            .collection(
                "redemptions"
            )
            .doc(
                options.orderId
            );

    options.transaction.set(
        redemptionReference,
        {
            orderId:
                options.orderId,

            userId:
                options.userId ||
                null,

            createdAt:
                options.now
        }
    );
}

/* ==========================================================
   DELIVERY & TAX
========================================================== */

function calculateDelivery(options) {
    const method =
        options.method;

    const configured =
        DEFAULT_DELIVERY_METHODS[
            method
        ];

    if (!configured) {
        throw createServiceError(
            "invalid-argument",
            "The selected delivery method is unavailable.",
            {
                status: 400
            }
        );
    }

    let amount =
        configured.amount;

    if (
        method === "standard" &&
        options.subtotal -
            options.discount >=
            FREE_STANDARD_DELIVERY_THRESHOLD
    ) {
        amount = 0;
    }

    return {
        id:
            configured.id,

        name:
            configured.name,

        amount:
            normalizeMoney(
                amount
            ),

        estimatedDays:
            configured.estimatedDays
    };
}

function calculateTax() {
    /*
     * Nigerian VAT or destination-specific taxes should be configured
     * through a dedicated tax service before charging customers.
     *
     * Returning zero is intentional until a verified tax policy has
     * been implemented.
     */
    return 0;
}

/* ==========================================================
   INVENTORY
========================================================== */

function reserveInventory(options) {
    const transaction =
        options.transaction;

    options.catalogItems.forEach(
        function (catalogItem) {
            const product =
                catalogItem.product;

            const variant =
                catalogItem.variant;

            const quantity =
                catalogItem.quantity;

            if (variant) {
                const variants =
                    Array.isArray(
                        product.variants
                    )
                        ? product.variants.map(
                              function (
                                  candidate
                              ) {
                                  if (
                                      String(
                                          candidate.id ||
                                          candidate.variantId ||
                                          candidate.sku ||
                                          ""
                                      ) !==
                                      catalogItem.variantId
                                  ) {
                                      return candidate;
                                  }

                                  const inventory =
                                      resolveAvailableStock(
                                          product,
                                          candidate
                                      ) -
                                      quantity;

                                  return Object.assign(
                                      {},
                                      candidate,
                                      {
                                          inventory:
                                              inventory,

                                          stock:
                                              inventory,

                                          available:
                                              inventory >
                                              0
                                      }
                                  );
                              }
                          )
                        : [];

                const totalInventory =
                    variants.reduce(
                        function (
                            total,
                            candidate
                        ) {
                            return (
                                total +
                                normalizeInventory(
                                    firstDefined(
                                        candidate.inventory,
                                        candidate.stock,
                                        0
                                    )
                                )
                            );
                        },
                        0
                    );

                transaction.update(
                    catalogItem.reference,
                    {
                        variants:
                            variants,

                        inventory:
                            totalInventory,

                        stock:
                            totalInventory,

                        inStock:
                            totalInventory >
                            0,

                        salesCount:
                            FieldValue.increment(
                                quantity
                            ),

                        updatedAt:
                            options.now
                    }
                );
            } else {
                const inventory =
                    catalogItem
                        .availableStock -
                    quantity;

                transaction.update(
                    catalogItem.reference,
                    {
                        inventory:
                            inventory,

                        stock:
                            inventory,

                        inStock:
                            inventory > 0,

                        salesCount:
                            FieldValue.increment(
                                quantity
                            ),

                        updatedAt:
                            options.now
                    }
                );
            }
        }
    );
}

async function restoreOrderInventory(
    options
) {
    const settings = options || {};

    const db = settings.db;
    const orderReference =
        settings.orderReference;

    return db.runTransaction(
        async function (
            transaction
        ) {
            const orderSnapshot =
                await transaction.get(
                    orderReference
                );

            if (
                !orderSnapshot.exists
            ) {
                throw createServiceError(
                    "order-not-found",
                    "The order could not be found.",
                    {
                        status: 404
                    }
                );
            }

            const order =
                orderSnapshot.data() ||
                {};

            if (
                order.inventoryRestored ===
                true
            ) {
                return {
                    restored: false,
                    duplicate: true
                };
            }

            const items =
                Array.isArray(
                    order.items
                )
                    ? order.items
                    : [];

            const productReferences =
                items.map(
                    function (item) {
                        return db
                            .collection(
                                PRODUCT_COLLECTION
                            )
                            .doc(
                                item.productId
                            );
                    }
                );

            const productSnapshots =
                await Promise.all(
                    productReferences.map(
                        function (
                            reference
                        ) {
                            return transaction.get(
                                reference
                            );
                        }
                    )
                );

            productSnapshots.forEach(
                function (
                    productSnapshot,
                    index
                ) {
                    if (
                        !productSnapshot.exists
                    ) {
                        return;
                    }

                    const item =
                        items[index];

                    const product =
                        productSnapshot.data() ||
                        {};

                    if (item.variantId) {
                        const variants =
                            Array.isArray(
                                product.variants
                            )
                                ? product.variants.map(
                                      function (
                                          variant
                                      ) {
                                          const variantId =
                                              String(
                                                  variant.id ||
                                                  variant.variantId ||
                                                  variant.sku ||
                                                  ""
                                              );

                                          if (
                                              variantId !==
                                              item.variantId
                                          ) {
                                              return variant;
                                          }

                                          const inventory =
                                              normalizeInventory(
                                                  firstDefined(
                                                      variant.inventory,
                                                      variant.stock,
                                                      0
                                                  )
                                              ) +
                                              item.quantity;

                                          return Object.assign(
                                              {},
                                              variant,
                                              {
                                                  inventory:
                                                      inventory,

                                                  stock:
                                                      inventory,

                                                  available:
                                                      true
                                              }
                                          );
                                      }
                                  )
                                : [];

                        const totalInventory =
                            variants.reduce(
                                function (
                                    total,
                                    variant
                                ) {
                                    return (
                                        total +
                                        normalizeInventory(
                                            firstDefined(
                                                variant.inventory,
                                                variant.stock,
                                                0
                                            )
                                        )
                                    );
                                },
                                0
                            );

                        transaction.update(
                            productSnapshot.ref,
                            {
                                variants:
                                    variants,

                                inventory:
                                    totalInventory,

                                stock:
                                    totalInventory,

                                inStock:
                                    totalInventory >
                                    0,

                                salesCount:
                                    FieldValue.increment(
                                        -item.quantity
                                    ),

                                updatedAt:
                                    Timestamp.now()
                            }
                        );
                    } else {
                        const inventory =
                            normalizeInventory(
                                firstDefined(
                                    product.inventory,
                                    product.stock,
                                    0
                                )
                            ) +
                            item.quantity;

                        transaction.update(
                            productSnapshot.ref,
                            {
                                inventory:
                                    inventory,

                                stock:
                                    inventory,

                                inStock:
                                    true,

                                salesCount:
                                    FieldValue.increment(
                                        -item.quantity
                                    ),

                                updatedAt:
                                    Timestamp.now()
                            }
                        );
                    }
                }
            );

            transaction.update(
                orderReference,
                {
                    inventoryRestored:
                        true,

                    inventoryRestoredAt:
                        Timestamp.now(),

                    updatedAt:
                        Timestamp.now()
                }
            );

            return {
                restored: true,
                duplicate: false
            };
        }
    );
}

/* ==========================================================
   PAYMENT INITIALIZATION
========================================================== */

async function initializeOrderPayment(
    options
) {
    const order =
        options.order;

    const paymentMethod =
        order.paymentMethod;

    if (
        paymentMethod ===
        "cash-on-delivery"
    ) {
        await updateOrderPaymentState({
            db: options.db,
            orderId: order.id,
            paymentStatus:
                PAYMENT_STATUSES
                    .AWAITING_PAYMENT,
            orderStatus:
                ORDER_STATUSES.CONFIRMED,
            payment: {
                initializedAt:
                    Timestamp.now()
            },
            note:
                "Cash-on-delivery order confirmed."
        });

        return {
            paymentStatus:
                PAYMENT_STATUSES
                    .AWAITING_PAYMENT,

            orderStatus:
                ORDER_STATUSES.CONFIRMED,

            payment: {
                initializedAt:
                    Timestamp.now()
            }
        };
    }

    if (
        paymentMethod ===
        "bank-transfer"
    ) {
        await updateOrderPaymentState({
            db: options.db,
            orderId: order.id,
            paymentStatus:
                PAYMENT_STATUSES
                    .AWAITING_PAYMENT,
            orderStatus:
                ORDER_STATUSES.PENDING,
            payment: {
                initializedAt:
                    Timestamp.now()
            },
            note:
                "Awaiting bank transfer."
        });

        return {
            paymentStatus:
                PAYMENT_STATUSES
                    .AWAITING_PAYMENT,

            orderStatus:
                ORDER_STATUSES.PENDING,

            payment: {
                initializedAt:
                    Timestamp.now()
            }
        };
    }

    if (
        !options.paymentService ||
        typeof options.paymentService
            .initializePayment !==
            "function"
    ) {
        throw createServiceError(
            "payment-failed",
            "The payment service is unavailable.",
            {
                status: 503
            }
        );
    }

    const initialized =
        await options.paymentService
            .initializePayment({
                order: order,

                customer:
                    order.customer,

                provider:
                    order.paymentProvider,

                configuration:
                    options.configuration
            });

    const payment = {
        providerReference:
            initialized.reference ||
            initialized
                .providerReference ||
            null,

        authorizationUrl:
            initialized.authorizationUrl ||
            initialized
                .authorization_url ||
            null,

        accessCode:
            initialized.accessCode ||
            initialized.access_code ||
            null,

        initializedAt:
            Timestamp.now()
    };

    await updateOrderPaymentState({
        db: options.db,
        orderId: order.id,
        paymentStatus:
            PAYMENT_STATUSES.PENDING,
        orderStatus:
            ORDER_STATUSES.PENDING,
        paymentReference:
            payment.providerReference,
        payment: payment,
        note:
            "Payment initialized."
    });

    return {
        paymentStatus:
            PAYMENT_STATUSES.PENDING,

        orderStatus:
            ORDER_STATUSES.PENDING,

        paymentReference:
            payment.providerReference,

        payment: payment
    };
}

async function updateOrderPaymentState(
    options
) {
    const reference =
        options.db
            .collection(
                ORDER_COLLECTION
            )
            .doc(
                options.orderId
            );

    const now =
        Timestamp.now();

    const update = {
        paymentStatus:
            options.paymentStatus,

        status:
            options.orderStatus,

        payment:
            options.payment || {},

        updatedAt:
            now,

        statusHistory:
            FieldValue.arrayUnion({
                status:
                    options.orderStatus,

                paymentStatus:
                    options.paymentStatus,

                note:
                    options.note ||
                    "",

                source:
                    "payment",

                userId:
                    null,

                createdAt:
                    now
            })
    };

    if (
        options.paymentReference
    ) {
        update.paymentReference =
            options.paymentReference;
    }

    await reference.set(
        update,
        {
            merge: true
        }
    );
}

async function handlePaymentInitializationFailure(
    options
) {
    const now =
        Timestamp.now();

    await options.db
        .collection(
            ORDER_COLLECTION
        )
        .doc(
            options.order.id
        )
        .set(
            {
                paymentStatus:
                    PAYMENT_STATUSES.FAILED,

                payment: {
                    failedAt: now,

                    failureMessage:
                        truncateText(
                            options.error &&
                            options.error.message,
                            500
                        )
                },

                updatedAt: now,

                statusHistory:
                    FieldValue.arrayUnion({
                        status:
                            ORDER_STATUSES.PENDING,

                        paymentStatus:
                            PAYMENT_STATUSES
                                .FAILED,

                        note:
                            "Payment initialization failed.",

                        source:
                            "payment",

                        userId: null,

                        createdAt: now
                    })
            },
            {
                merge: true
            }
        );
}

/* ==========================================================
   CUSTOMER ORDER QUERIES
========================================================== */

async function getCustomerOrder(
    options
) {
    const orderId =
        normalizeOrderId(
            options.orderId
        );

    const snapshot =
        await options.db
            .collection(
                ORDER_COLLECTION
            )
            .doc(orderId)
            .get();

    if (!snapshot.exists) {
        throw createServiceError(
            "order-not-found",
            "The order could not be found.",
            {
                status: 404
            }
        );
    }

    const order =
        serializeDocument(
            snapshot
        );

    if (
        !options.userId ||
        order.userId !==
            options.userId
    ) {
        throw createServiceError(
            "permission-denied",
            "You do not have permission to access this order.",
            {
                status: 403
            }
        );
    }

    return sanitizeOrderForCustomer(
        order
    );
}

async function listCustomerOrders(
    options
) {
    const pagination =
        normalizePagination(
            options.pagination
        );

    const limit =
        Math.min(
            pagination.limit,
            MAXIMUM_ORDERS_PER_PAGE
        );

    let query =
        options.db
            .collection(
                ORDER_COLLECTION
            )
            .where(
                "userId",
                "==",
                options.userId
            )
            .orderBy(
                "createdAt",
                "desc"
            )
            .limit(
                limit + 1
            );

    if (pagination.cursor) {
        const cursor =
            decodeCursor(
                pagination.cursor
            );

        if (
            !cursor ||
            !cursor.createdAt ||
            !cursor.id
        ) {
            throw createServiceError(
                "invalid-argument",
                "The pagination cursor is invalid.",
                {
                    status: 400
                }
            );
        }

        query =
            query.startAfter(
                Timestamp.fromMillis(
                    Number(
                        cursor.createdAt
                    )
                ),
                cursor.id
            );
    }

    const snapshot =
        await query.get();

    const documents =
        snapshot.docs.slice(
            0,
            limit
        );

    const hasMore =
        snapshot.docs.length >
        limit;

    const orders =
        documents.map(
            function (document) {
                return sanitizeOrderForCustomer(
                    serializeDocument(
                        document
                    )
                );
            }
        );

    const last =
        documents[
            documents.length - 1
        ];

    const nextCursor =
        hasMore && last
            ? encodeCursor({
                  createdAt:
                      toMilliseconds(
                          last.get(
                              "createdAt"
                          )
                      ),

                  id: last.id
              })
            : null;

    return {
        orders: orders,
        pagination: {
            limit: limit,
            hasMore: hasMore,
            nextCursor:
                nextCursor
        }
    };
}

/* ==========================================================
   ORDER CANCELLATION
========================================================== */

async function cancelCustomerOrder(
    options
) {
    const orderId =
        normalizeOrderId(
            options.orderId
        );

    const reason =
        normalizeCancellationReason(
            options.reason
        );

    const orderReference =
        options.db
            .collection(
                ORDER_COLLECTION
            )
            .doc(orderId);

    const result =
        await options.db.runTransaction(
            async function (
                transaction
            ) {
                const snapshot =
                    await transaction.get(
                        orderReference
                    );

                if (!snapshot.exists) {
                    throw createServiceError(
                        "order-not-found",
                        "The order could not be found.",
                        {
                            status: 404
                        }
                    );
                }

                const order =
                    snapshot.data() ||
                    {};

                if (
                    order.userId !==
                    options.userId
                ) {
                    throw createServiceError(
                        "permission-denied",
                        "You do not have permission to cancel this order.",
                        {
                            status: 403
                        }
                    );
                }

                if (
                    !CANCELLABLE_STATUSES.has(
                        order.status
                    )
                ) {
                    throw createServiceError(
                        "failed-precondition",
                        "This order can no longer be cancelled online.",
                        {
                            status: 412,
                            details: {
                                status:
                                    order.status
                            }
                        }
                    );
                }

                if (
                    order.paymentStatus ===
                    PAYMENT_STATUSES.PAID
                ) {
                    throw createServiceError(
                        "failed-precondition",
                        "This paid order requires a refund before cancellation.",
                        {
                            status: 412
                        }
                    );
                }

                const now =
                    Timestamp.now();

                transaction.update(
                    orderReference,
                    {
                        status:
                            ORDER_STATUSES
                                .CANCELLED,

                        cancellationReason:
                            reason ||
                            "Cancelled by customer.",

                        cancelledAt:
                            now,

                        updatedAt:
                            now,

                        statusHistory:
                            FieldValue.arrayUnion({
                                status:
                                    ORDER_STATUSES
                                        .CANCELLED,

                                paymentStatus:
                                    order.paymentStatus ||
                                    PAYMENT_STATUSES
                                        .PENDING,

                                note:
                                    reason ||
                                    "Cancelled by customer.",

                                source:
                                    "customer",

                                userId:
                                    options.userId,

                                createdAt:
                                    now
                            })
                    }
                );

                return {
                    orderId: orderId,
                    inventoryRestored:
                        order.inventoryRestored ===
                        true
                };
            }
        );

    if (!result.inventoryRestored) {
        await restoreOrderInventory({
            db: options.db,
            orderReference:
                orderReference
        });
    }

    return {
        success: true,
        orderId: orderId,
        status:
            ORDER_STATUSES.CANCELLED
    };
}

/* ==========================================================
   CUSTOMER HTTP API
========================================================== */

async function handleOrdersApi(
    options
) {
    const request =
        options.request;

    const identity =
        options.identity;

    if (
        !identity ||
        !identity.uid
    ) {
        throw createServiceError(
            "unauthenticated",
            "Sign in before continuing.",
            {
                status: 401
            }
        );
    }

    const segments =
        normalizeOrdersApiSegments(
            getPathSegments(
                request
            )
        );

    if (
        request.method === "GET" &&
        segments.length === 0
    ) {
        const query =
            getQuery(request);

        const result =
            await listCustomerOrders({
                db: options.db,
                userId:
                    identity.uid,
                pagination: {
                    limit:
                        query.limit,
                    cursor:
                        query.cursor
                }
            });

        return {
            status: 200,
            body: {
                success: true,
                data: result
            }
        };
    }

    if (
        request.method === "GET" &&
        segments.length === 1
    ) {
        const order =
            await getCustomerOrder({
                db: options.db,
                userId:
                    identity.uid,
                orderId:
                    segments[0]
            });

        return {
            status: 200,
            body: {
                success: true,
                data: order
            }
        };
    }

    if (
        request.method === "POST" &&
        segments.length === 2 &&
        segments[1] === "cancel"
    ) {
        const body =
            parseJsonBody(
                request
            );

        const result =
            await cancelCustomerOrder({
                db: options.db,
                userId:
                    identity.uid,
                orderId:
                    segments[0],
                reason:
                    body.reason ||
                    ""
            });

        return {
            status: 200,
            body: {
                success: true,
                data: result
            }
        };
    }

    throw createServiceError(
        "not-found",
        "The requested order endpoint does not exist.",
        {
            status: 404
        }
    );
}

function normalizeOrdersApiSegments(
    segments
) {
    const normalized =
        segments.slice();

    const ordersIndex =
        normalized.indexOf(
            "orders"
        );

    if (ordersIndex >= 0) {
        return normalized.slice(
            ordersIndex + 1
        );
    }

    const apiIndex =
        normalized.indexOf("api");

    if (
        apiIndex >= 0 &&
        normalized[
            apiIndex + 1
        ] === "orders"
    ) {
        return normalized.slice(
            apiIndex + 2
        );
    }

    return normalized;
}

/* ==========================================================
   ADMIN ORDER HELPERS
========================================================== */

async function updateOrderStatus(
    options
) {
    const orderId =
        normalizeOrderId(
            options.orderId
        );

    const status =
        normalizeOrderStatus(
            options.status
        );

    const paymentStatus =
        options.paymentStatus
            ? normalizePaymentStatus(
                  options.paymentStatus
              )
            : null;

    const note =
        normalizeString(
            options.note,
            {
                fieldName:
                    "Status note",
                maximumLength: 1000
            }
        );

    const reference =
        options.db
            .collection(
                ORDER_COLLECTION
            )
            .doc(orderId);

    let shouldRestoreInventory =
        false;

    await options.db.runTransaction(
        async function (
            transaction
        ) {
            const snapshot =
                await transaction.get(
                    reference
                );

            if (!snapshot.exists) {
                throw createServiceError(
                    "order-not-found",
                    "The order could not be found.",
                    {
                        status: 404
                    }
                );
            }

            const order =
                snapshot.data() || {};

            const now =
                Timestamp.now();

            const update = {
                status: status,
                updatedAt: now,

                statusHistory:
                    FieldValue.arrayUnion({
                        status:
                            status,

                        paymentStatus:
                            paymentStatus ||
                            order.paymentStatus ||
                            PAYMENT_STATUSES
                                .PENDING,

                        note:
                            note ||
                            "Order status updated.",

                        source:
                            "admin",

                        userId:
                            options.administratorId ||
                            null,

                        createdAt:
                            now
                    })
            };

            if (paymentStatus) {
                update.paymentStatus =
                    paymentStatus;
            }

            if (
                status ===
                ORDER_STATUSES.CONFIRMED
            ) {
                update.confirmedAt =
                    now;
            }

            if (
                status ===
                ORDER_STATUSES.SHIPPED
            ) {
                update.shippedAt =
                    now;
            }

            if (
                status ===
                ORDER_STATUSES.DELIVERED
            ) {
                update.deliveredAt =
                    now;
            }

            if (
                status ===
                ORDER_STATUSES.CANCELLED
            ) {
                update.cancelledAt =
                    now;

                shouldRestoreInventory =
                    order.inventoryRestored !==
                    true;
            }

            transaction.update(
                reference,
                update
            );
        }
    );

    if (shouldRestoreInventory) {
        await restoreOrderInventory({
            db: options.db,
            orderReference:
                reference
        });
    }

    return {
        success: true,
        orderId: orderId,
        status: status,
        paymentStatus:
            paymentStatus
    };
}

/* ==========================================================
   IDEMPOTENCY
========================================================== */

async function findExistingIdempotentOrder(
    options
) {
    const reference =
        options.db
            .collection(
                IDEMPOTENCY_COLLECTION
            )
            .doc(
                hashIdempotencyKey(
                    options.idempotencyKey
                )
            );

    const snapshot =
        await reference.get();

    if (!snapshot.exists) {
        return null;
    }

    const data =
        snapshot.data() || {};

    if (!data.orderId) {
        return null;
    }

    const orderSnapshot =
        await options.db
            .collection(
                ORDER_COLLECTION
            )
            .doc(
                data.orderId
            )
            .get();

    if (!orderSnapshot.exists) {
        return null;
    }

    const order =
        serializeDocument(
            orderSnapshot
        );

    const sameOwner =
        options.identity.uid
            ? order.userId ===
              options.identity.uid
            : order.guest === true;

    if (!sameOwner) {
        throw createServiceError(
            "permission-denied",
            "The checkout request could not be reused.",
            {
                status: 403
            }
        );
    }

    return order;
}

function resolveIdempotencyKey(
    payloadKey,
    identity
) {
    const key =
        String(
            payloadKey || ""
        ).trim();

    if (!key) {
        return "";
    }

    return [
        identity.uid ||
            "guest",
        key
    ].join(":");
}

function hashIdempotencyKey(value) {
    /*
     * Firestore document IDs cannot safely contain arbitrary client
     * strings. This deterministic non-cryptographic hash is used only
     * as a document-key normalization mechanism.
     */
    let first = 2166136261;
    let second = 16777619;

    const text =
        String(value || "");

    for (
        let index = 0;
        index < text.length;
        index += 1
    ) {
        const code =
            text.charCodeAt(index);

        first ^= code;

        first =
            Math.imul(
                first,
                16777619
            );

        second ^=
            code +
            index;

        second =
            Math.imul(
                second,
                2246822519
            );
    }

    return (
        unsignedHex(first) +
        unsignedHex(second)
    );
}

function unsignedHex(value) {
    return (
        value >>> 0
    )
        .toString(16)
        .padStart(8, "0");
}

/* ==========================================================
   RESPONSE SANITIZATION
========================================================== */

function createOrderResponse(
    order,
    reused
) {
    const sanitized =
        sanitizeOrderForCustomer(
            order
        );

    return {
        success: true,
        reused:
            Boolean(reused),

        orderId:
            sanitized.id,

        orderNumber:
            sanitized.orderNumber,

        status:
            sanitized.status,

        paymentStatus:
            sanitized.paymentStatus,

        currency:
            sanitized.currency,

        subtotal:
            sanitized.subtotal,

        discount:
            sanitized.discount,

        deliveryFee:
            sanitized.deliveryFee,

        tax:
            sanitized.tax,

        total:
            sanitized.total,

        payment:
            sanitized.payment
    };
}

function sanitizeOrderForCustomer(
    order
) {
    return {
        id: order.id,

        orderNumber:
            order.orderNumber,

        userId:
            order.userId,

        guest:
            Boolean(order.guest),

        customer:
            order.customer,

        shippingAddress:
            order.shippingAddress,

        billingAddress:
            order.billingAddress,

        deliveryMethod:
            order.deliveryMethod,

        delivery:
            order.delivery,

        paymentMethod:
            order.paymentMethod,

        paymentProvider:
            order.paymentProvider,

        paymentStatus:
            order.paymentStatus,

        status:
            order.status,

        currency:
            order.currency,

        items:
            order.items || [],

        itemCount:
            order.itemCount || 0,

        subtotal:
            order.subtotal || 0,

        discount:
            order.discount || 0,

        deliveryFee:
            order.deliveryFee || 0,

        tax:
            order.tax || 0,

        total:
            order.total || 0,

        couponCode:
            order.couponCode ||
            null,

        notes:
            order.notes || "",

        paymentReference:
            order.paymentReference ||
            null,

        payment: {
            providerReference:
                order.payment &&
                order.payment
                    .providerReference
                    ? order.payment
                          .providerReference
                    : null,

            authorizationUrl:
                order.payment &&
                order.payment
                    .authorizationUrl
                    ? order.payment
                          .authorizationUrl
                    : null,

            accessCode:
                order.payment &&
                order.payment.accessCode
                    ? order.payment
                          .accessCode
                    : null
        },

        statusHistory:
            order.statusHistory ||
            [],

        createdAt:
            order.createdAt,

        updatedAt:
            order.updatedAt,

        confirmedAt:
            order.confirmedAt ||
            null,

        shippedAt:
            order.shippedAt ||
            null,

        deliveredAt:
            order.deliveredAt ||
            null,

        cancelledAt:
            order.cancelledAt ||
            null,

        cancellationReason:
            order.cancellationReason ||
            ""
    };
}

function serializeDocument(
    snapshot
) {
    return Object.assign(
        {
            id: snapshot.id
        },
        serializeFirestoreValue(
            snapshot.data() || {}
        )
    );
}

function serializeFirestoreValue(
    value
) {
    if (
        value instanceof Timestamp
    ) {
        return value.toDate()
            .toISOString();
    }

    if (Array.isArray(value)) {
        return value.map(
            serializeFirestoreValue
        );
    }

    if (
        value &&
        typeof value === "object"
    ) {
        return Object.keys(value).reduce(
            function (output, key) {
                output[key] =
                    serializeFirestoreValue(
                        value[key]
                    );

                return output;
            },
            {}
        );
    }

    return value;
}

/* ==========================================================
   GENERAL HELPERS
========================================================== */

function assertServiceDependencies(
    options
) {
    if (!options.db) {
        throw createServiceError(
            "internal",
            "The database service is unavailable.",
            {
                status: 500
            }
        );
    }
}

function determineInitialPaymentState(
    paymentMethod
) {
    if (
        paymentMethod ===
        "cash-on-delivery"
    ) {
        return {
            orderStatus:
                ORDER_STATUSES
                    .CONFIRMED,

            paymentStatus:
                PAYMENT_STATUSES
                    .AWAITING_PAYMENT
        };
    }

    return {
        orderStatus:
            ORDER_STATUSES.PENDING,

        paymentStatus:
            PAYMENT_STATUSES.PENDING
    };
}

function resolvePaymentProvider(
    paymentMethod,
    configuredProvider
) {
    if (
        paymentMethod === "paystack"
    ) {
        return "paystack";
    }

    if (
        paymentMethod ===
        "flutterwave"
    ) {
        return "flutterwave";
    }

    if (
        paymentMethod === "card"
    ) {
        return String(
            configuredProvider ||
            "paystack"
        ).toLowerCase();
    }

    return paymentMethod;
}

function createOrderNumber(
    orderId,
    date
) {
    const year =
        date.getUTCFullYear();

    const month =
        String(
            date.getUTCMonth() + 1
        ).padStart(2, "0");

    const day =
        String(
            date.getUTCDate()
        ).padStart(2, "0");

    const suffix =
        String(orderId)
            .replace(
                /[^A-Za-z0-9]/g,
                ""
            )
            .slice(-8)
            .toUpperCase();

    return [
        "LET",
        String(year) +
            month +
            day,
        suffix
    ].join("-");
}

function normalizeCurrency(value) {
    const currency =
        String(
            value ||
            DEFAULT_CURRENCY
        )
            .trim()
            .toUpperCase();

    if (
        !/^[A-Z]{3}$/.test(
            currency
        )
    ) {
        throw createServiceError(
            "internal",
            "The store currency is invalid.",
            {
                status: 500
            }
        );
    }

    return currency;
}

function normalizeMoney(value) {
    const number =
        Number(value);

    if (
        !Number.isFinite(number)
    ) {
        throw createServiceError(
            "failed-precondition",
            "A monetary value is invalid.",
            {
                status: 412
            }
        );
    }

    return Math.round(
        (
            number +
            Number.EPSILON
        ) * 100
    ) / 100;
}

function normalizeOptionalMoney(
    value
) {
    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {
        return null;
    }

    return normalizeMoney(value);
}

function normalizeInventory(value) {
    const number =
        Number(value);

    if (
        !Number.isFinite(number)
    ) {
        return 0;
    }

    return Math.max(
        0,
        Math.floor(number)
    );
}

function resolveVariantName(
    variant
) {
    if (!variant) {
        return "";
    }

    if (variant.name) {
        return String(
            variant.name
        );
    }

    return [
        variant.color,
        variant.size
    ]
        .filter(Boolean)
        .join(" / ");
}

function resolveProductImage(
    product,
    variant
) {
    if (
        variant &&
        variant.image
    ) {
        if (
            typeof variant.image ===
            "string"
        ) {
            return variant.image;
        }

        return (
            variant.image.url ||
            variant.image.src ||
            ""
        );
    }

    const images =
        Array.isArray(
            product.images
        )
            ? product.images
            : [];

    if (images.length) {
        const image =
            images[0];

        if (
            typeof image ===
            "string"
        ) {
            return image;
        }

        return (
            image.url ||
            image.src ||
            ""
        );
    }

    return (
        product.image ||
        product.imageUrl ||
        ""
    );
}

function createStockErrorMessage(
    product,
    availableStock
) {
    const name =
        String(
            product.name ||
            "This product"
        );

    if (availableStock <= 0) {
        return (
            name +
            " is out of stock."
        );
    }

    return (
        "Only " +
        availableStock +
        " unit(s) of " +
        name +
        " remain."
    );
}

function sanitizeCouponForOrder(
    coupon
) {
    return {
        id: coupon.id,
        code: coupon.code,
        type:
            coupon.type ||
            coupon.discountType ||
            "",
        value:
            coupon.value ||
            coupon.discountValue ||
            0
    };
}

function toMilliseconds(value) {
    if (!value) {
        return 0;
    }

    if (
        typeof value.toMillis ===
        "function"
    ) {
        return value.toMillis();
    }

    if (
        typeof value.toDate ===
        "function"
    ) {
        return value
            .toDate()
            .getTime();
    }

    if (
        value instanceof Date
    ) {
        return value.getTime();
    }

    if (
        typeof value ===
        "string"
    ) {
        const parsed =
            Date.parse(value);

        return Number.isNaN(parsed)
            ? 0
            : parsed;
    }

    if (
        typeof value ===
        "number"
    ) {
        return value;
    }

    return 0;
}

function firstDefined() {
    for (
        let index = 0;
        index < arguments.length;
        index += 1
    ) {
        if (
            arguments[index] !==
                undefined &&
            arguments[index] !== null
        ) {
            return arguments[index];
        }
    }

    return undefined;
}

function truncateText(
    value,
    maximumLength
) {
    return String(
        value || ""
    ).slice(
        0,
        maximumLength
    );
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    createOrder:
        createOrder,

    getCustomerOrder:
        getCustomerOrder,

    listCustomerOrders:
        listCustomerOrders,

    cancelCustomerOrder:
        cancelCustomerOrder,

    handleOrdersApi:
        handleOrdersApi,

    updateOrderStatus:
        updateOrderStatus,

    restoreOrderInventory:
        restoreOrderInventory,

    sanitizeOrderForCustomer:
        sanitizeOrderForCustomer,

    serializeDocument:
        serializeDocument,

    calculateSubtotal:
        calculateSubtotal,

    calculateDiscount:
        calculateDiscount,

    calculateDelivery:
        calculateDelivery,

    calculateTax:
        calculateTax,

    normalizeMoney:
        normalizeMoney,

    constants: {
        ORDER_COLLECTION:
            ORDER_COLLECTION,

        PRODUCT_COLLECTION:
            PRODUCT_COLLECTION,

        ORDER_STATUSES:
            ORDER_STATUSES,

        PAYMENT_STATUSES:
            PAYMENT_STATUSES,

        CANCELLABLE_STATUSES:
            Array.from(
                CANCELLABLE_STATUSES
            ),

        DEFAULT_DELIVERY_METHODS:
            DEFAULT_DELIVERY_METHODS,

        FREE_STANDARD_DELIVERY_THRESHOLD:
            FREE_STANDARD_DELIVERY_THRESHOLD
    },

    _internal: {
        loadCatalogItems:
            loadCatalogItems,

        priceOrderItem:
            priceOrderItem,

        resolveCoupon:
            resolveCoupon,

        validateCoupon:
            validateCoupon,

        reserveInventory:
            reserveInventory,

        resolveProductVariant:
            resolveProductVariant,

        resolveAvailableStock:
            resolveAvailableStock,

        initializeOrderPayment:
            initializeOrderPayment,

        hashIdempotencyKey:
            hashIdempotencyKey,

        createOrderNumber:
            createOrderNumber
    }
};