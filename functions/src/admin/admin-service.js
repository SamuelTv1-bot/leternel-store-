"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ADMINISTRATOR SERVICE
========================================================== */

const {
    FieldValue,
    Timestamp
} = require("firebase-admin/firestore");

const {
    createServiceError,
    normalizeOrderId,
    normalizeOrderStatus,
    normalizePaymentStatus,
    normalizeProductIdentifier,
    normalizeUserId,
    normalizeUserStatus,
    normalizePagination,
    normalizeSearchTerm,
    normalizeString,
    normalizeNumber,
    normalizeBoolean,
    normalizeArray,
    isPlainObject,
    removeUndefined
} = require("../shared/validation");

const {
    getPathSegments,
    getQuery,
    parseJsonBody,
    encodeCursor,
    decodeCursor
} = require("../shared/http");

const {
    updateOrderStatus,
    restoreOrderInventory,
    serializeDocument
} = require("../orders/order-service");

const {
    setUserStatus,
    deleteUserAccount,
    writeAuditLog
} = require("../accounts/account-service");

/* ==========================================================
   CONSTANTS
========================================================== */

const PRODUCT_COLLECTION = "products";
const ORDER_COLLECTION = "orders";
const USER_COLLECTION = "users";
const CATEGORY_COLLECTION = "categories";

const DEFAULT_PAGE_SIZE = 20;
const MAXIMUM_PAGE_SIZE = 100;

const PRODUCT_STATUSES =
    new Set([
        "active",
        "inactive",
        "draft",
        "archived"
    ]);

const PROTECTED_PRODUCT_FIELDS =
    new Set([
        "salesCount",
        "viewCount",
        "reviewCount",
        "rating",
        "createdBy",
        "createdAt"
    ]);

/* ==========================================================
   ADMIN HTTP API
========================================================== */

async function handleAdminApi(options) {
    const settings = options || {};

    assertDependencies(settings);

    const request =
        settings.request;

    const segments =
        normalizeAdminApiSegments(
            getPathSegments(request)
        );

    if (
        request.method === "GET" &&
        segments.length === 1 &&
        segments[0] === "metrics"
    ) {
        return {
            status: 200,

            body: {
                success: true,

                data:
                    await getDashboardMetrics({
                        db: settings.db
                    })
            }
        };
    }

    if (
        segments[0] === "products"
    ) {
        return handleProductsRoute(
            Object.assign(
                {},
                settings,
                {
                    segments:
                        segments.slice(1)
                }
            )
        );
    }

    if (
        segments[0] === "orders"
    ) {
        return handleOrdersRoute(
            Object.assign(
                {},
                settings,
                {
                    segments:
                        segments.slice(1)
                }
            )
        );
    }

    if (
        segments[0] === "customers"
    ) {
        return handleCustomersRoute(
            Object.assign(
                {},
                settings,
                {
                    segments:
                        segments.slice(1)
                }
            )
        );
    }

    if (
        segments[0] === "categories"
    ) {
        return handleCategoriesRoute(
            Object.assign(
                {},
                settings,
                {
                    segments:
                        segments.slice(1)
                }
            )
        );
    }

    throw createServiceError(
        "not-found",
        "The requested administrator endpoint does not exist.",
        {
            status: 404
        }
    );
}

/* ==========================================================
   DASHBOARD METRICS
========================================================== */

async function getDashboardMetrics(options) {
    const db = options.db;

    const now = new Date();

    const todayStart =
        new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate()
        );

    const monthStart =
        new Date(
            now.getFullYear(),
            now.getMonth(),
            1
        );

    const previousMonthStart =
        new Date(
            now.getFullYear(),
            now.getMonth() - 1,
            1
        );

    const [
        productsSnapshot,
        customersSnapshot,
        recentOrdersSnapshot,
        todayOrdersSnapshot,
        monthOrdersSnapshot,
        previousMonthOrdersSnapshot,
        pendingOrdersSnapshot,
        lowStockSnapshot
    ] = await Promise.all([
        db.collection(
            PRODUCT_COLLECTION
        ).get(),

        db.collection(
            USER_COLLECTION
        )
            .where(
                "role",
                "==",
                "customer"
            )
            .get(),

        db.collection(
            ORDER_COLLECTION
        )
            .orderBy(
                "createdAt",
                "desc"
            )
            .limit(10)
            .get(),

        db.collection(
            ORDER_COLLECTION
        )
            .where(
                "createdAt",
                ">=",
                Timestamp.fromDate(
                    todayStart
                )
            )
            .get(),

        db.collection(
            ORDER_COLLECTION
        )
            .where(
                "createdAt",
                ">=",
                Timestamp.fromDate(
                    monthStart
                )
            )
            .get(),

        db.collection(
            ORDER_COLLECTION
        )
            .where(
                "createdAt",
                ">=",
                Timestamp.fromDate(
                    previousMonthStart
                )
            )
            .where(
                "createdAt",
                "<",
                Timestamp.fromDate(
                    monthStart
                )
            )
            .get(),

        db.collection(
            ORDER_COLLECTION
        )
            .where(
                "status",
                "in",
                [
                    "pending",
                    "confirmed",
                    "processing"
                ]
            )
            .get(),

        db.collection(
            PRODUCT_COLLECTION
        )
            .where(
                "inventory",
                "<=",
                5
            )
            .orderBy(
                "inventory",
                "asc"
            )
            .limit(20)
            .get()
    ]);

    const todaySummary =
        summarizeOrders(
            todayOrdersSnapshot.docs
        );

    const monthSummary =
        summarizeOrders(
            monthOrdersSnapshot.docs
        );

    const previousMonthSummary =
        summarizeOrders(
            previousMonthOrdersSnapshot.docs
        );

    const revenueChange =
        calculateChangePercentage(
            monthSummary.revenue,
            previousMonthSummary.revenue
        );

    const orderChange =
        calculateChangePercentage(
            monthSummary.orderCount,
            previousMonthSummary.orderCount
        );

    const activeProducts =
        productsSnapshot.docs.filter(
            function (document) {
                const product =
                    document.data() || {};

                return (
                    product.active === true &&
                    product.published === true
                );
            }
        ).length;

    const disabledCustomers =
        customersSnapshot.docs.filter(
            function (document) {
                return (
                    document.get(
                        "status"
                    ) === "disabled"
                );
            }
        ).length;

    return {
        generatedAt:
            new Date().toISOString(),

        totals: {
            products:
                productsSnapshot.size,

            activeProducts:
                activeProducts,

            customers:
                customersSnapshot.size,

            activeCustomers:
                customersSnapshot.size -
                disabledCustomers,

            disabledCustomers:
                disabledCustomers,

            pendingOrders:
                pendingOrdersSnapshot.size,

            lowStockProducts:
                lowStockSnapshot.size
        },

        today: todaySummary,

        currentMonth:
            Object.assign(
                {},
                monthSummary,
                {
                    revenueChange:
                        revenueChange,

                    orderChange:
                        orderChange
                }
            ),

        previousMonth:
            previousMonthSummary,

        recentOrders:
            recentOrdersSnapshot.docs.map(
                function (document) {
                    return sanitizeAdminOrder(
                        serializeDocument(
                            document
                        )
                    );
                }
            ),

        lowStock:
            lowStockSnapshot.docs.map(
                function (document) {
                    const product =
                        serializeDocument(
                            document
                        );

                    return {
                        id: product.id,
                        name:
                            product.name ||
                            "",
                        sku:
                            product.sku ||
                            "",
                        inventory:
                            Number(
                                product.inventory ||
                                0
                            ),
                        inStock:
                            product.inStock ===
                            true,
                        active:
                            product.active ===
                            true
                    };
                }
            )
    };
}

function summarizeOrders(documents) {
    return documents.reduce(
        function (summary, document) {
            const order =
                document.data() || {};

            summary.orderCount += 1;

            if (
                order.status ===
                "cancelled"
            ) {
                summary.cancelled += 1;
            }

            if (
                order.status ===
                "delivered"
            ) {
                summary.delivered += 1;
            }

            if (
                order.paymentStatus ===
                    "paid" ||
                order.paymentStatus ===
                    "successful"
            ) {
                summary.paidOrders += 1;

                summary.revenue +=
                    Number(
                        order.total ||
                        0
                    );
            }

            return summary;
        },
        {
            orderCount: 0,
            paidOrders: 0,
            cancelled: 0,
            delivered: 0,
            revenue: 0
        }
    );
}

/* ==========================================================
   PRODUCT ROUTES
========================================================== */

async function handleProductsRoute(options) {
    const segments =
        options.segments || [];

    if (
        options.request.method ===
            "GET" &&
        segments.length === 0
    ) {
        return {
            status: 200,

            body: {
                success: true,

                data:
                    await listProducts({
                        db: options.db,
                        query:
                            getQuery(
                                options.request
                            )
                    })
            }
        };
    }

    if (
        options.request.method ===
            "POST" &&
        segments.length === 0
    ) {
        const body =
            parseJsonBody(
                options.request,
                {
                    required: true,
                    maximumBytes:
                        2 * 1024 * 1024
                }
            );

        const product =
            await createProduct({
                db: options.db,
                administrator:
                    options.identity,
                payload: body
            });

        return {
            status: 201,

            body: {
                success: true,
                data: product
            }
        };
    }

    if (
        segments.length === 1
    ) {
        const productId =
            normalizeProductIdentifier(
                segments[0]
            );

        if (
            options.request.method ===
            "GET"
        ) {
            return {
                status: 200,

                body: {
                    success: true,

                    data:
                        await getProduct({
                            db: options.db,
                            productId:
                                productId
                        })
                }
            };
        }

        if (
            options.request.method ===
                "PATCH" ||
            options.request.method ===
                "PUT"
        ) {
            const body =
                parseJsonBody(
                    options.request,
                    {
                        required: true,
                        maximumBytes:
                            2 * 1024 *
                            1024
                    }
                );

            return {
                status: 200,

                body: {
                    success: true,

                    data:
                        await updateProduct({
                            db: options.db,
                            administrator:
                                options.identity,
                            productId:
                                productId,
                            payload: body,
                            replace:
                                options.request
                                    .method ===
                                "PUT"
                        })
                }
            };
        }

        if (
            options.request.method ===
            "DELETE"
        ) {
            return {
                status: 200,

                body: {
                    success: true,

                    data:
                        await deleteProduct({
                            db: options.db,
                            storage:
                                options.storage,
                            administrator:
                                options.identity,
                            productId:
                                productId
                        })
                }
            };
        }
    }

    throw createServiceError(
        "not-found",
        "The requested product endpoint does not exist.",
        {
            status: 404
        }
    );
}

async function listProducts(options) {
    const queryParameters =
        options.query || {};

    const pagination =
        normalizePagination(
            queryParameters
        );

    const limit =
        Math.min(
            pagination.limit ||
                DEFAULT_PAGE_SIZE,
            MAXIMUM_PAGE_SIZE
        );

    const searchTerm =
        normalizeSearchTerm(
            queryParameters.search
        );

    const status =
        String(
            queryParameters.status ||
            ""
        )
            .trim()
            .toLowerCase();

    const category =
        String(
            queryParameters.category ||
            ""
        ).trim();

    let query =
        options.db
            .collection(
                PRODUCT_COLLECTION
            )
            .orderBy(
                "createdAt",
                "desc"
            )
            .limit(
                limit + 1
            );

    if (category) {
        query =
            options.db
                .collection(
                    PRODUCT_COLLECTION
                )
                .where(
                    "categorySlug",
                    "==",
                    category
                )
                .orderBy(
                    "createdAt",
                    "desc"
                )
                .limit(
                    limit + 1
                );
    }

    if (
        status === "active"
    ) {
        query =
            options.db
                .collection(
                    PRODUCT_COLLECTION
                )
                .where(
                    "active",
                    "==",
                    true
                )
                .orderBy(
                    "createdAt",
                    "desc"
                )
                .limit(
                    limit + 1
                );
    }

    if (
        status === "inactive"
    ) {
        query =
            options.db
                .collection(
                    PRODUCT_COLLECTION
                )
                .where(
                    "active",
                    "==",
                    false
                )
                .orderBy(
                    "createdAt",
                    "desc"
                )
                .limit(
                    limit + 1
                );
    }

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

    let products =
        snapshot.docs.map(
            function (document) {
                return sanitizeAdminProduct(
                    serializeDocument(
                        document
                    )
                );
            }
        );

    if (searchTerm) {
        const normalizedSearch =
            searchTerm.toLowerCase();

        products =
            products.filter(
                function (product) {
                    return [
                        product.name,
                        product.sku,
                        product.slug,
                        product.category,
                        product.categorySlug
                    ]
                        .filter(Boolean)
                        .some(
                            function (value) {
                                return String(
                                    value
                                )
                                    .toLowerCase()
                                    .includes(
                                        normalizedSearch
                                    );
                            }
                        );
                }
            );
    }

    const hasMore =
        products.length >
        limit;

    products =
        products.slice(
            0,
            limit
        );

    const last =
        snapshot.docs[
            Math.min(
                snapshot.docs.length,
                limit
            ) - 1
        ];

    return {
        products: products,

        pagination: {
            limit: limit,
            hasMore: hasMore,

            nextCursor:
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
                    : null
        }
    };
}

async function getProduct(options) {
    const snapshot =
        await options.db
            .collection(
                PRODUCT_COLLECTION
            )
            .doc(
                options.productId
            )
            .get();

    if (!snapshot.exists) {
        throw createServiceError(
            "product-not-found",
            "The product could not be found.",
            {
                status: 404
            }
        );
    }

    return sanitizeAdminProduct(
        serializeDocument(
            snapshot
        )
    );
}

async function createProduct(options) {
    const payload =
        normalizeProductPayload(
            options.payload,
            {
                create: true
            }
        );

    const reference =
        options.db
            .collection(
                PRODUCT_COLLECTION
            )
            .doc();

    const now =
        Timestamp.now();

    const product =
        Object.assign(
            {},
            payload,
            {
                inventory:
                    calculateProductInventory(
                        payload
                    ),

                inStock:
                    calculateProductInventory(
                        payload
                    ) > 0,

                salesCount: 0,
                viewCount: 0,
                rating: 0,
                reviewCount: 0,

                createdBy:
                    options.administrator
                        .uid,

                updatedBy:
                    options.administrator
                        .uid,

                createdAt: now,
                updatedAt: now
            }
        );

    await reference.create(
        product
    );

    await writeAuditLog({
        db: options.db,
        action:
            "product.created",
        targetType:
            "product",
        targetId:
            reference.id,
        actor:
            options.administrator,
        changes: {
            after:
                sanitizeAuditValue(
                    product
                )
        }
    });

    return sanitizeAdminProduct(
        Object.assign(
            {
                id:
                    reference.id
            },
            product
        )
    );
}

async function updateProduct(options) {
    const reference =
        options.db
            .collection(
                PRODUCT_COLLECTION
            )
            .doc(
                options.productId
            );

    const snapshot =
        await reference.get();

    if (!snapshot.exists) {
        throw createServiceError(
            "product-not-found",
            "The product could not be found.",
            {
                status: 404
            }
        );
    }

    const before =
        snapshot.data() || {};

    const payload =
        normalizeProductPayload(
            options.payload,
            {
                create: false,
                existing:
                    before
            }
        );

    const merged =
        options.replace
            ? payload
            : Object.assign(
                  {},
                  before,
                  payload
              );

    const inventory =
        calculateProductInventory(
            merged
        );

    const update =
        Object.assign(
            {},
            payload,
            {
                inventory:
                    inventory,

                inStock:
                    inventory > 0,

                updatedBy:
                    options.administrator
                        .uid,

                updatedAt:
                    Timestamp.now()
            }
        );

    await reference.set(
        update,
        {
            merge:
                !options.replace
        }
    );

    await writeAuditLog({
        db: options.db,
        action:
            "product.updated",
        targetType:
            "product",
        targetId:
            options.productId,
        actor:
            options.administrator,
        changes: {
            before:
                sanitizeAuditValue(
                    before
                ),

            after:
                sanitizeAuditValue(
                    Object.assign(
                        {},
                        before,
                        update
                    )
                )
        }
    });

    return getProduct({
        db: options.db,
        productId:
            options.productId
    });
}

async function deleteProduct(options) {
    const reference =
        options.db
            .collection(
                PRODUCT_COLLECTION
            )
            .doc(
                options.productId
            );

    const snapshot =
        await reference.get();

    if (!snapshot.exists) {
        throw createServiceError(
            "product-not-found",
            "The product could not be found.",
            {
                status: 404
            }
        );
    }

    const product =
        snapshot.data() || {};

    const orderCheck =
        await options.db
            .collection(
                ORDER_COLLECTION
            )
            .where(
                "items",
                "array-contains",
                {
                    productId:
                        options.productId
                }
            )
            .limit(1)
            .get()
            .catch(function () {
                return null;
            });

    /*
     * Firestore cannot reliably array-contains a partial map, so
     * products are archived by default rather than hard-deleted.
     */
    const now =
        Timestamp.now();

    await reference.set(
        {
            active: false,
            published: false,
            archived: true,
            archivedAt: now,

            archivedBy:
                options.administrator
                    .uid,

            updatedAt: now
        },
        {
            merge: true
        }
    );

    await writeAuditLog({
        db: options.db,
        action:
            "product.archived",
        targetType:
            "product",
        targetId:
            options.productId,
        actor:
            options.administrator,
        changes: {
            before:
                sanitizeAuditValue(
                    product
                ),

            after: {
                active: false,
                published: false,
                archived: true
            }
        },

        metadata: {
            historicalOrderCheck:
                orderCheck
                    ? !orderCheck.empty
                    : "not-supported"
        }
    });

    return {
        success: true,
        productId:
            options.productId,
        archived: true
    };
}

/* ==========================================================
   ORDER ROUTES
========================================================== */

async function handleOrdersRoute(options) {
    const segments =
        options.segments || [];

    if (
        options.request.method ===
            "GET" &&
        segments.length === 0
    ) {
        return {
            status: 200,

            body: {
                success: true,

                data:
                    await listOrders({
                        db: options.db,
                        query:
                            getQuery(
                                options.request
                            )
                    })
            }
        };
    }

    if (
        segments.length === 1 &&
        options.request.method ===
            "GET"
    ) {
        return {
            status: 200,

            body: {
                success: true,

                data:
                    await getAdminOrder({
                        db: options.db,
                        orderId:
                            segments[0]
                    })
            }
        };
    }

    if (
        segments.length === 1 &&
        (
            options.request.method ===
                "PATCH" ||
            options.request.method ===
                "PUT"
        )
    ) {
        const body =
            parseJsonBody(
                options.request,
                {
                    required: true
                }
            );

        const result =
            await updateAdminOrder({
                db: options.db,
                administrator:
                    options.identity,
                orderId:
                    segments[0],
                payload: body
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
        segments.length === 2 &&
        segments[1] ===
            "restore-inventory" &&
        options.request.method ===
            "POST"
    ) {
        const orderId =
            normalizeOrderId(
                segments[0]
            );

        const result =
            await restoreOrderInventory({
                db: options.db,

                orderReference:
                    options.db
                        .collection(
                            ORDER_COLLECTION
                        )
                        .doc(orderId)
            });

        await writeAuditLog({
            db: options.db,
            action:
                "order.inventory-restored",
            targetType:
                "order",
            targetId:
                orderId,
            actor:
                options.identity,
            changes: result
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

async function listOrders(options) {
    const queryParameters =
        options.query || {};

    const pagination =
        normalizePagination(
            queryParameters
        );

    const limit =
        Math.min(
            pagination.limit ||
                DEFAULT_PAGE_SIZE,
            MAXIMUM_PAGE_SIZE
        );

    const status =
        String(
            queryParameters.status ||
            ""
        )
            .trim()
            .toLowerCase();

    const paymentStatus =
        String(
            queryParameters
                .paymentStatus ||
            ""
        )
            .trim()
            .toLowerCase();

    const userId =
        String(
            queryParameters.userId ||
            ""
        ).trim();

    let query =
        options.db
            .collection(
                ORDER_COLLECTION
            )
            .orderBy(
                "createdAt",
                "desc"
            )
            .limit(
                limit + 1
            );

    if (status) {
        query =
            options.db
                .collection(
                    ORDER_COLLECTION
                )
                .where(
                    "status",
                    "==",
                    status
                )
                .orderBy(
                    "createdAt",
                    "desc"
                )
                .limit(
                    limit + 1
                );
    } else if (paymentStatus) {
        query =
            options.db
                .collection(
                    ORDER_COLLECTION
                )
                .where(
                    "paymentStatus",
                    "==",
                    paymentStatus
                )
                .orderBy(
                    "createdAt",
                    "desc"
                )
                .limit(
                    limit + 1
                );
    } else if (userId) {
        query =
            options.db
                .collection(
                    ORDER_COLLECTION
                )
                .where(
                    "userId",
                    "==",
                    userId
                )
                .orderBy(
                    "createdAt",
                    "desc"
                )
                .limit(
                    limit + 1
                );
    }

    if (pagination.cursor) {
        const cursor =
            decodeCursor(
                pagination.cursor
            );

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

    const last =
        documents[
            documents.length - 1
        ];

    return {
        orders:
            documents.map(
                function (document) {
                    return sanitizeAdminOrder(
                        serializeDocument(
                            document
                        )
                    );
                }
            ),

        pagination: {
            limit: limit,
            hasMore: hasMore,

            nextCursor:
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
                    : null
        }
    };
}

async function getAdminOrder(options) {
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

    return sanitizeAdminOrder(
        serializeDocument(
            snapshot
        )
    );
}

async function updateAdminOrder(options) {
    const body =
        options.payload || {};

    const status =
        body.status
            ? normalizeOrderStatus(
                  body.status
              )
            : null;

    const paymentStatus =
        body.paymentStatus
            ? normalizePaymentStatus(
                  body.paymentStatus
              )
            : null;

    if (
        !status &&
        !paymentStatus
    ) {
        throw createServiceError(
            "invalid-argument",
            "Provide an order status or payment status.",
            {
                status: 400
            }
        );
    }

    const current =
        await getAdminOrder({
            db: options.db,
            orderId:
                options.orderId
        });

    const result =
        await updateOrderStatus({
            db: options.db,
            orderId:
                options.orderId,
            status:
                status ||
                current.status,
            paymentStatus:
                paymentStatus,
            note:
                body.note ||
                "",
            administratorId:
                options.administrator
                    .uid
        });

    await writeAuditLog({
        db: options.db,
        action:
            "order.updated",
        targetType:
            "order",
        targetId:
            normalizeOrderId(
                options.orderId
            ),
        actor:
            options.administrator,
        changes: {
            before: {
                status:
                    current.status,
                paymentStatus:
                    current.paymentStatus
            },

            after: {
                status:
                    status ||
                    current.status,

                paymentStatus:
                    paymentStatus ||
                    current.paymentStatus
            }
        }
    });

    return result;
}

/* ==========================================================
   CUSTOMER ROUTES
========================================================== */

async function handleCustomersRoute(options) {
    const segments =
        options.segments || [];

    if (
        options.request.method ===
            "GET" &&
        segments.length === 0
    ) {
        return {
            status: 200,

            body: {
                success: true,

                data:
                    await listCustomers({
                        db: options.db,
                        query:
                            getQuery(
                                options.request
                            )
                    })
            }
        };
    }

    if (
        segments.length === 1 &&
        options.request.method ===
            "GET"
    ) {
        return {
            status: 200,

            body: {
                success: true,

                data:
                    await getCustomer({
                        db: options.db,
                        userId:
                            segments[0]
                    })
            }
        };
    }

    if (
        segments.length === 1 &&
        options.request.method ===
            "PATCH"
    ) {
        const body =
            parseJsonBody(
                options.request,
                {
                    required: true
                }
            );

        const result =
            await updateCustomer({
                db: options.db,
                auth: options.auth,
                administrator:
                    options.identity,
                userId:
                    segments[0],
                payload: body
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
        segments.length === 1 &&
        options.request.method ===
            "DELETE"
    ) {
        const result =
            await deleteUserAccount({
                db: options.db,
                auth: options.auth,
                administrator:
                    options.identity,
                userId:
                    segments[0]
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
        "The requested customer endpoint does not exist.",
        {
            status: 404
        }
    );
}

async function listCustomers(options) {
    const queryParameters =
        options.query || {};

    const pagination =
        normalizePagination(
            queryParameters
        );

    const limit =
        Math.min(
            pagination.limit ||
                DEFAULT_PAGE_SIZE,
            MAXIMUM_PAGE_SIZE
        );

    const status =
        String(
            queryParameters.status ||
            ""
        )
            .trim()
            .toLowerCase();

    const search =
        normalizeSearchTerm(
            queryParameters.search
        ).toLowerCase();

    let query =
        options.db
            .collection(
                USER_COLLECTION
            )
            .where(
                "role",
                "==",
                "customer"
            )
            .orderBy(
                "createdAt",
                "desc"
            )
            .limit(
                limit + 1
            );

    if (status) {
        query =
            options.db
                .collection(
                    USER_COLLECTION
                )
                .where(
                    "role",
                    "==",
                    "customer"
                )
                .where(
                    "status",
                    "==",
                    status
                )
                .orderBy(
                    "createdAt",
                    "desc"
                )
                .limit(
                    limit + 1
                );
    }

    if (pagination.cursor) {
        const cursor =
            decodeCursor(
                pagination.cursor
            );

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

    let customers =
        snapshot.docs.map(
            function (document) {
                return sanitizeCustomer(
                    serializeDocument(
                        document
                    )
                );
            }
        );

    if (search) {
        customers =
            customers.filter(
                function (customer) {
                    return [
                        customer.displayName,
                        customer.email,
                        customer.phoneNumber
                    ]
                        .filter(Boolean)
                        .some(
                            function (value) {
                                return String(
                                    value
                                )
                                    .toLowerCase()
                                    .includes(
                                        search
                                    );
                            }
                        );
                }
            );
    }

    const hasMore =
        customers.length >
        limit;

    customers =
        customers.slice(
            0,
            limit
        );

    const last =
        snapshot.docs[
            Math.min(
                snapshot.docs.length,
                limit
            ) - 1
        ];

    return {
        customers: customers,

        pagination: {
            limit: limit,
            hasMore: hasMore,

            nextCursor:
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
                    : null
        }
    };
}

async function getCustomer(options) {
    const userId =
        normalizeUserId(
            options.userId
        );

    const [
        userSnapshot,
        ordersSnapshot
    ] = await Promise.all([
        options.db
            .collection(
                USER_COLLECTION
            )
            .doc(userId)
            .get(),

        options.db
            .collection(
                ORDER_COLLECTION
            )
            .where(
                "userId",
                "==",
                userId
            )
            .orderBy(
                "createdAt",
                "desc"
            )
            .limit(20)
            .get()
    ]);

    if (!userSnapshot.exists) {
        throw createServiceError(
            "not-found",
            "The customer could not be found.",
            {
                status: 404
            }
        );
    }

    const customer =
        sanitizeCustomer(
            serializeDocument(
                userSnapshot
            )
        );

    const orders =
        ordersSnapshot.docs.map(
            function (document) {
                return sanitizeAdminOrder(
                    serializeDocument(
                        document
                    )
                );
            }
        );

    const summary =
        orders.reduce(
            function (result, order) {
                result.orderCount += 1;

                if (
                    order.paymentStatus ===
                        "paid" ||
                    order.paymentStatus ===
                        "successful"
                ) {
                    result.totalSpent +=
                        Number(
                            order.total ||
                            0
                        );
                }

                return result;
            },
            {
                orderCount: 0,
                totalSpent: 0
            }
        );

    return {
        customer: customer,
        orders: orders,
        summary: summary
    };
}

async function updateCustomer(options) {
    const body =
        options.payload || {};

    if (body.status) {
        return setUserStatus({
            db: options.db,
            auth: options.auth,
            administrator:
                options.administrator,
            userId:
                options.userId,
            status:
                normalizeUserStatus(
                    body.status
                ),
            reason:
                body.reason ||
                ""
        });
    }

    throw createServiceError(
        "invalid-argument",
        "No supported customer update was provided.",
        {
            status: 400
        }
    );
}

/* ==========================================================
   CATEGORY ROUTES
========================================================== */

async function handleCategoriesRoute(options) {
    const segments =
        options.segments || [];

    if (
        options.request.method ===
            "GET" &&
        segments.length === 0
    ) {
        const snapshot =
            await options.db
                .collection(
                    CATEGORY_COLLECTION
                )
                .orderBy(
                    "sortOrder",
                    "asc"
                )
                .get();

        return {
            status: 200,

            body: {
                success: true,

                data: {
                    categories:
                        snapshot.docs.map(
                            function (
                                document
                            ) {
                                return serializeDocument(
                                    document
                                );
                            }
                        )
                }
            }
        };
    }

    if (
        options.request.method ===
            "POST" &&
        segments.length === 0
    ) {
        const body =
            parseJsonBody(
                options.request,
                {
                    required: true
                }
            );

        const category =
            await createCategory({
                db: options.db,
                administrator:
                    options.identity,
                payload: body
            });

        return {
            status: 201,

            body: {
                success: true,
                data: category
            }
        };
    }

    if (
        segments.length === 1 &&
        options.request.method ===
            "PATCH"
    ) {
        const body =
            parseJsonBody(
                options.request,
                {
                    required: true
                }
            );

        return {
            status: 200,

            body: {
                success: true,

                data:
                    await updateCategory({
                        db: options.db,
                        administrator:
                            options.identity,
                        categoryId:
                            segments[0],
                        payload: body
                    })
            }
        };
    }

    if (
        segments.length === 1 &&
        options.request.method ===
            "DELETE"
    ) {
        return {
            status: 200,

            body: {
                success: true,

                data:
                    await archiveCategory({
                        db: options.db,
                        administrator:
                            options.identity,
                        categoryId:
                            segments[0]
                    })
            }
        };
    }

    throw createServiceError(
        "not-found",
        "The requested category endpoint does not exist.",
        {
            status: 404
        }
    );
}

async function createCategory(options) {
    const payload =
        normalizeCategoryPayload(
            options.payload
        );

    const reference =
        options.db
            .collection(
                CATEGORY_COLLECTION
            )
            .doc();

    const now =
        Timestamp.now();

    const category =
        Object.assign(
            {},
            payload,
            {
                createdAt: now,
                updatedAt: now,

                createdBy:
                    options.administrator
                        .uid,

                updatedBy:
                    options.administrator
                        .uid
            }
        );

    await reference.create(
        category
    );

    await writeAuditLog({
        db: options.db,
        action:
            "category.created",
        targetType:
            "category",
        targetId:
            reference.id,
        actor:
            options.administrator,
        changes: {
            after:
                sanitizeAuditValue(
                    category
                )
        }
    });

    return Object.assign(
        {
            id: reference.id
        },
        serializeFirestoreValue(
            category
        )
    );
}

async function updateCategory(options) {
    const categoryId =
        normalizeString(
            options.categoryId,
            {
                fieldName:
                    "Category ID",
                required: true,
                maximumLength: 200,
                pattern:
                    /^[A-Za-z0-9_-]+$/
            }
        );

    const reference =
        options.db
            .collection(
                CATEGORY_COLLECTION
            )
            .doc(categoryId);

    const snapshot =
        await reference.get();

    if (!snapshot.exists) {
        throw createServiceError(
            "not-found",
            "The category could not be found.",
            {
                status: 404
            }
        );
    }

    const payload =
        normalizeCategoryPayload(
            options.payload,
            {
                partial: true
            }
        );

    const update =
        Object.assign(
            {},
            payload,
            {
                updatedAt:
                    Timestamp.now(),

                updatedBy:
                    options.administrator
                        .uid
            }
        );

    await reference.set(
        update,
        {
            merge: true
        }
    );

    await writeAuditLog({
        db: options.db,
        action:
            "category.updated",
        targetType:
            "category",
        targetId:
            categoryId,
        actor:
            options.administrator,
        changes: {
            before:
                sanitizeAuditValue(
                    snapshot.data()
                ),
            after:
                sanitizeAuditValue(
                    update
                )
        }
    });

    const updated =
        await reference.get();

    return serializeDocument(
        updated
    );
}

async function archiveCategory(options) {
    const categoryId =
        normalizeString(
            options.categoryId,
            {
                fieldName:
                    "Category ID",
                required: true,
                maximumLength: 200,
                pattern:
                    /^[A-Za-z0-9_-]+$/
            }
        );

    const reference =
        options.db
            .collection(
                CATEGORY_COLLECTION
            )
            .doc(categoryId);

    const snapshot =
        await reference.get();

    if (!snapshot.exists) {
        throw createServiceError(
            "not-found",
            "The category could not be found.",
            {
                status: 404
            }
        );
    }

    const now =
        Timestamp.now();

    await reference.set(
        {
            active: false,
            archived: true,
            archivedAt: now,
            updatedAt: now,

            updatedBy:
                options.administrator
                    .uid
        },
        {
            merge: true
        }
    );

    await writeAuditLog({
        db: options.db,
        action:
            "category.archived",
        targetType:
            "category",
        targetId:
            categoryId,
        actor:
            options.administrator,
        changes: {
            after: {
                active: false,
                archived: true
            }
        }
    });

    return {
        categoryId:
            categoryId,
        archived: true
    };
}

/* ==========================================================
   PRODUCT VALIDATION
========================================================== */

function normalizeProductPayload(
    value,
    options
) {
    const settings =
        options || {};

    if (!isPlainObject(value)) {
        throw createServiceError(
            "invalid-argument",
            "The product payload must be an object.",
            {
                status: 400
            }
        );
    }

    Object.keys(value).forEach(
        function (key) {
            if (
                PROTECTED_PRODUCT_FIELDS.has(
                    key
                )
            ) {
                throw createServiceError(
                    "invalid-argument",
                    "The field " +
                        key +
                        " cannot be changed directly.",
                    {
                        status: 400
                    }
                );
            }
        }
    );

    const output = {};

    assignNormalizedString(
        output,
        value,
        "name",
        {
            fieldName:
                "Product name",
            required:
                Boolean(
                    settings.create
                ),
            maximumLength: 200
        }
    );

    assignNormalizedString(
        output,
        value,
        "slug",
        {
            fieldName:
                "Product slug",
            required:
                Boolean(
                    settings.create
                ),
            maximumLength: 220,
            lowercase: true,
            pattern:
                /^[a-z0-9]+(?:-[a-z0-9]+)*$/
        }
    );

    assignNormalizedString(
        output,
        value,
        "sku",
        {
            fieldName: "SKU",
            maximumLength: 120
        }
    );

    assignNormalizedString(
        output,
        value,
        "description",
        {
            fieldName:
                "Description",
            maximumLength: 20000
        }
    );

    assignNormalizedString(
        output,
        value,
        "shortDescription",
        {
            fieldName:
                "Short description",
            maximumLength: 1000
        }
    );

    assignNormalizedString(
        output,
        value,
        "category",
        {
            fieldName:
                "Category",
            maximumLength: 120
        }
    );

    assignNormalizedString(
        output,
        value,
        "categorySlug",
        {
            fieldName:
                "Category slug",
            maximumLength: 120,
            lowercase: true
        }
    );

    assignNormalizedString(
        output,
        value,
        "collectionSlug",
        {
            fieldName:
                "Collection slug",
            maximumLength: 120,
            lowercase: true
        }
    );

    if (
        value.price !==
        undefined
    ) {
        output.price =
            normalizeNumber(
                value.price,
                {
                    fieldName:
                        "Product price",
                    required: true,
                    minimum: 0
                }
            );
    } else if (settings.create) {
        throw createServiceError(
            "invalid-argument",
            "Product price is required.",
            {
                status: 400
            }
        );
    }

    if (
        value.compareAtPrice !==
        undefined
    ) {
        output.compareAtPrice =
            normalizeNumber(
                value.compareAtPrice,
                {
                    fieldName:
                        "Compare-at price",
                    minimum: 0,
                    fallback: null
                }
            );
    }

    [
        "active",
        "published",
        "featured",
        "bestseller",
        "newArrival"
    ].forEach(function (field) {
        if (
            value[field] !==
            undefined
        ) {
            output[field] =
                normalizeBoolean(
                    value[field],
                    false
                );
        }
    });

    if (settings.create) {
        if (
            output.active ===
            undefined
        ) {
            output.active = true;
        }

        if (
            output.published ===
            undefined
        ) {
            output.published =
                false;
        }
    }

    if (
        value.inventory !==
        undefined
    ) {
        output.inventory =
            normalizeNumber(
                value.inventory,
                {
                    fieldName:
                        "Inventory",
                    integer: true,
                    minimum: 0
                }
            );
    }

    if (
        value.images !==
        undefined
    ) {
        output.images =
            normalizeImages(
                value.images
            );
    }

    if (
        value.variants !==
        undefined
    ) {
        output.variants =
            normalizeVariants(
                value.variants
            );
    }

    [
        "sizes",
        "colors",
        "tags",
        "materials",
        "care",
        "shipping"
    ].forEach(function (field) {
        if (
            value[field] !==
            undefined
        ) {
            output[field] =
                normalizeArray(
                    value[field],
                    {
                        fieldName:
                            field,
                        maximumLength: 100
                    }
                )
                    .map(function (item) {
                        return String(
                            item
                        ).trim();
                    })
                    .filter(Boolean);
        }
    });

    return removeUndefined(
        output
    );
}

function normalizeVariants(value) {
    return normalizeArray(
        value,
        {
            fieldName:
                "Product variants",
            maximumLength: 200
        }
    ).map(function (variant, index) {
        if (!isPlainObject(variant)) {
            throw createServiceError(
                "invalid-argument",
                "Variant " +
                    (index + 1) +
                    " is invalid.",
                {
                    status: 400
                }
            );
        }

        const inventory =
            normalizeNumber(
                variant.inventory !==
                undefined
                    ? variant.inventory
                    : variant.stock,
                {
                    fieldName:
                        "Variant inventory",
                    integer: true,
                    minimum: 0,
                    fallback: 0
                }
            );

        return removeUndefined({
            id:
                normalizeString(
                    variant.id ||
                    variant.variantId ||
                    variant.sku,
                    {
                        fieldName:
                            "Variant ID",
                        required: true,
                        maximumLength: 200,
                        pattern:
                            /^[A-Za-z0-9_.:-]+$/
                    }
                ),

            sku:
                normalizeString(
                    variant.sku,
                    {
                        fieldName:
                            "Variant SKU",
                        maximumLength: 120
                    }
                ),

            name:
                normalizeString(
                    variant.name,
                    {
                        fieldName:
                            "Variant name",
                        maximumLength: 200
                    }
                ),

            size:
                normalizeString(
                    variant.size,
                    {
                        fieldName:
                            "Variant size",
                        maximumLength: 100
                    }
                ),

            color:
                normalizeString(
                    variant.color,
                    {
                        fieldName:
                            "Variant color",
                        maximumLength: 100
                    }
                ),

            price:
                variant.price !==
                undefined
                    ? normalizeNumber(
                          variant.price,
                          {
                              fieldName:
                                  "Variant price",
                              minimum: 0
                          }
                      )
                    : undefined,

            compareAtPrice:
                variant
                    .compareAtPrice !==
                undefined
                    ? normalizeNumber(
                          variant
                              .compareAtPrice,
                          {
                              fieldName:
                                  "Variant compare-at price",
                              minimum: 0
                          }
                      )
                    : undefined,

            inventory:
                inventory,

            stock:
                inventory,

            active:
                normalizeBoolean(
                    variant.active,
                    true
                ),

            available:
                inventory > 0,

            image:
                normalizeImage(
                    variant.image
                )
        });
    });
}

function normalizeImages(value) {
    return normalizeArray(
        value,
        {
            fieldName:
                "Product images",
            maximumLength: 30
        }
    )
        .map(normalizeImage)
        .filter(Boolean);
}

function normalizeImage(value) {
    if (!value) {
        return null;
    }

    if (
        typeof value === "string"
    ) {
        return {
            url:
                normalizeString(
                    value,
                    {
                        fieldName:
                            "Image URL",
                        maximumLength: 2000
                    }
                ),

            alt: ""
        };
    }

    if (!isPlainObject(value)) {
        throw createServiceError(
            "invalid-argument",
            "A product image is invalid.",
            {
                status: 400
            }
        );
    }

    return removeUndefined({
        url:
            normalizeString(
                value.url ||
                value.src,
                {
                    fieldName:
                        "Image URL",
                    required: true,
                    maximumLength: 2000
                }
            ),

        alt:
            normalizeString(
                value.alt,
                {
                    fieldName:
                        "Image alternative text",
                    maximumLength: 300
                }
            ),

        storagePath:
            normalizeString(
                value.storagePath,
                {
                    fieldName:
                        "Image storage path",
                    maximumLength: 1000
                }
            )
    });
}

function calculateProductInventory(
    product
) {
    if (
        Array.isArray(
            product.variants
        ) &&
        product.variants.length
    ) {
        return product.variants.reduce(
            function (total, variant) {
                return (
                    total +
                    Math.max(
                        0,
                        Number(
                            variant.inventory ||
                            variant.stock ||
                            0
                        )
                    )
                );
            },
            0
        );
    }

    return Math.max(
        0,
        Number(
            product.inventory ||
            0
        )
    );
}

/* ==========================================================
   CATEGORY VALIDATION
========================================================== */

function normalizeCategoryPayload(
    value,
    options
) {
    const settings =
        options || {};

    if (!isPlainObject(value)) {
        throw createServiceError(
            "invalid-argument",
            "The category payload must be an object.",
            {
                status: 400
            }
        );
    }

    const output = {};

    assignNormalizedString(
        output,
        value,
        "name",
        {
            fieldName:
                "Category name",
            required:
                !settings.partial,
            maximumLength: 120
        }
    );

    assignNormalizedString(
        output,
        value,
        "slug",
        {
            fieldName:
                "Category slug",
            required:
                !settings.partial,
            maximumLength: 120,
            lowercase: true,
            pattern:
                /^[a-z0-9]+(?:-[a-z0-9]+)*$/
        }
    );

    assignNormalizedString(
        output,
        value,
        "description",
        {
            fieldName:
                "Category description",
            maximumLength: 2000
        }
    );

    assignNormalizedString(
        output,
        value,
        "image",
        {
            fieldName:
                "Category image",
            maximumLength: 2000
        }
    );

    if (
        value.active !==
        undefined
    ) {
        output.active =
            normalizeBoolean(
                value.active,
                true
            );
    } else if (!settings.partial) {
        output.active = true;
    }

    if (
        value.sortOrder !==
        undefined
    ) {
        output.sortOrder =
            normalizeNumber(
                value.sortOrder,
                {
                    fieldName:
                        "Sort order",
                    integer: true,
                    minimum: 0,
                    fallback: 0
                }
            );
    } else if (!settings.partial) {
        output.sortOrder = 0;
    }

    return output;
}

/* ==========================================================
   SANITIZATION
========================================================== */

function sanitizeAdminProduct(
    product
) {
    return product;
}

function sanitizeAdminOrder(order) {
    const output =
        Object.assign(
            {},
            order
        );

    if (
        output.payment &&
        output.payment.authorization
    ) {
        output.payment =
            Object.assign(
                {},
                output.payment,
                {
                    authorization:
                        sanitizePaymentAuthorization(
                            output.payment
                                .authorization
                        )
                }
            );
    }

    delete output
        .paymentAuthorization;

    delete output
        .idempotencyKeyHash;

    return output;
}

function sanitizePaymentAuthorization(
    value
) {
    if (!isPlainObject(value)) {
        return null;
    }

    return {
        reusable:
            Boolean(
                value.reusable
            ),

        channel:
            value.channel ||
            null,

        cardType:
            value.cardType ||
            null,

        bank:
            value.bank ||
            null,

        brand:
            value.brand ||
            null,

        countryCode:
            value.countryCode ||
            null,

        last4:
            value.last4 ||
            null,

        expiryMonth:
            value.expiryMonth ||
            null,

        expiryYear:
            value.expiryYear ||
            null
    };
}

function sanitizeCustomer(customer) {
    const output =
        Object.assign(
            {},
            customer
        );

    delete output
        .passwordHash;

    delete output
        .passwordSalt;

    delete output
        .customClaims;

    delete output
        .paymentAuthorization;

    return output;
}

function sanitizeAuditValue(value) {
    const serialized =
        serializeFirestoreValue(
            value
        );

    if (
        serialized &&
        serialized.payment
    ) {
        delete serialized.payment;
    }

    if (
        serialized &&
        serialized.paymentAuthorization
    ) {
        delete serialized
            .paymentAuthorization;
    }

    return serialized;
}

/* ==========================================================
   HELPERS
========================================================== */

function normalizeAdminApiSegments(
    segments
) {
    const normalized =
        segments.slice();

    const adminIndex =
        normalized.indexOf(
            "admin"
        );

    if (adminIndex >= 0) {
        return normalized.slice(
            adminIndex + 1
        );
    }

    return normalized;
}

function assignNormalizedString(
    output,
    source,
    field,
    options
) {
    if (
        source[field] ===
        undefined
    ) {
        return;
    }

    output[field] =
        normalizeString(
            source[field],
            options
        );
}

function calculateChangePercentage(
    current,
    previous
) {
    const currentValue =
        Number(current || 0);

    const previousValue =
        Number(previous || 0);

    if (
        previousValue === 0
    ) {
        return currentValue > 0
            ? 100
            : 0;
    }

    return Math.round(
        (
            (
                currentValue -
                previousValue
            ) /
            previousValue
        ) *
        10000
    ) / 100;
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

    const parsed =
        Date.parse(value);

    return Number.isNaN(parsed)
        ? 0
        : parsed;
}

function serializeFirestoreValue(
    value
) {
    if (
        value instanceof Timestamp
    ) {
        return value
            .toDate()
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
        return Object.keys(value)
            .reduce(
                function (
                    output,
                    key
                ) {
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

function assertDependencies(options) {
    if (!options.db) {
        throw createServiceError(
            "internal",
            "The database service is unavailable.",
            {
                status: 500
            }
        );
    }

    if (!options.auth) {
        throw createServiceError(
            "internal",
            "The authentication service is unavailable.",
            {
                status: 500
            }
        );
    }

    if (
        !options.identity ||
        !options.identity.uid
    ) {
        throw createServiceError(
            "permission-denied",
            "Administrator access is required.",
            {
                status: 403
            }
        );
    }
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    handleAdminApi:
        handleAdminApi,

    getDashboardMetrics:
        getDashboardMetrics,

    listProducts:
        listProducts,

    getProduct:
        getProduct,

    createProduct:
        createProduct,

    updateProduct:
        updateProduct,

    deleteProduct:
        deleteProduct,

    listOrders:
        listOrders,

    getAdminOrder:
        getAdminOrder,

    updateAdminOrder:
        updateAdminOrder,

    listCustomers:
        listCustomers,

    getCustomer:
        getCustomer,

    updateCustomer:
        updateCustomer,

    createCategory:
        createCategory,

    updateCategory:
        updateCategory,

    archiveCategory:
        archiveCategory,

    constants: {
        PRODUCT_COLLECTION:
            PRODUCT_COLLECTION,

        ORDER_COLLECTION:
            ORDER_COLLECTION,

        USER_COLLECTION:
            USER_COLLECTION,

        CATEGORY_COLLECTION:
            CATEGORY_COLLECTION
    },

    _internal: {
        normalizeProductPayload:
            normalizeProductPayload,

        normalizeVariants:
            normalizeVariants,

        normalizeImages:
            normalizeImages,

        calculateProductInventory:
            calculateProductInventory,

        normalizeCategoryPayload:
            normalizeCategoryPayload,

        sanitizeAdminOrder:
            sanitizeAdminOrder,

        sanitizeCustomer:
            sanitizeCustomer,

        calculateChangePercentage:
            calculateChangePercentage
    }
};