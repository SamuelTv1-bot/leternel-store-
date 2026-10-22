"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ADMIN DASHBOARD CONTROLLER

   Responsibilities:
   - Load dashboard commerce metrics
   - Query recent orders and low-stock products
   - Calculate revenue, order, and customer summaries
   - Render operational health and dashboard tables
   - Support refresh and lifecycle management
========================================================== */

(function (
    global
) {
    /* ======================================================
       CONSTANTS
    ====================================================== */

    const DEFAULT_SELECTORS =
        Object.freeze({
            root:
                "[data-admin-content]",

            revenue:
                "[data-dashboard-revenue]",

            revenueChange:
                "[data-dashboard-revenue-change]",

            orders:
                "[data-dashboard-orders]",

            ordersChange:
                "[data-dashboard-orders-change]",

            customers:
                "[data-dashboard-customers]",

            customersChange:
                "[data-dashboard-customers-change]",

            lowStock:
                "[data-dashboard-low-stock]",

            lowStockChange:
                "[data-dashboard-low-stock-change]",

            ordersTable:
                "[data-dashboard-orders-table]",

            lowStockList:
                "[data-dashboard-low-stock-list]",

            functionsHealth:
                "[data-dashboard-functions-health]",

            databaseHealth:
                "[data-dashboard-database-health]",

            authHealth:
                "[data-dashboard-auth-health]",

            healthTime:
                "[data-dashboard-health-time]",

            refreshButton:
                "[data-dashboard-refresh]"
        });

    const DEFAULT_CURRENCY =
        "GBP";

    const DEFAULT_LOCALE =
        "en-GB";

    const DEFAULT_RECENT_ORDER_LIMIT =
        8;

    const DEFAULT_LOW_STOCK_LIMIT =
        8;

    const DEFAULT_LOW_STOCK_THRESHOLD =
        5;

    const DEFAULT_PERIOD_DAYS =
        30;

    /* ======================================================
       CONTROLLER FACTORY
    ====================================================== */

    function createDashboardController(
        options
    ) {
        const settings =
            normalizeControllerOptions(
                options
            );

        const documentObject =
            settings.document ||
            global.document;

        if (
            !documentObject
        ) {
            throw new Error(
                "Admin dashboard controller requires a document."
            );
        }

        const root =
            resolveRoot(
                documentObject,
                settings.root,
                settings.selectors.root
            );

        const elements =
            resolveElements(
                root ||
                documentObject,
                settings.selectors
            );

        const firestore =
            settings.firestore ||
            resolveFirestore();

        const auth =
            settings.auth ||
            resolveAuth();

        const operationsService =
            settings.operationsService ||
            resolveOperationsService();

        const disposers =
            [];

        let initialized =
            false;

        let destroyed =
            false;

        let loading =
            false;

        let snapshot =
            createDashboardSnapshot();

        /* ==================================================
           LIFECYCLE
        ================================================== */

        async function init() {
            if (
                initialized
            ) {
                return controller;
            }

            assertActive();

            initialized =
                true;

            bindEvents();

            await refresh();

            return controller;
        }

        function destroy() {
            if (
                destroyed
            ) {
                return;
            }

            destroyed =
                true;

            while (
                disposers.length
            ) {
                const dispose =
                    disposers.pop();

                try {
                    dispose();
                } catch (
                    error
                ) {
                    reportError(
                        error
                    );
                }
            }

            initialized =
                false;
        }

        function assertActive() {
            if (
                destroyed
            ) {
                throw new Error(
                    "Admin dashboard controller has been destroyed."
                );
            }
        }

        /* ==================================================
           REFRESH
        ================================================== */

        async function refresh() {
            assertActive();

            if (
                loading
            ) {
                return snapshot;
            }

            loading =
                true;

            setRefreshBusy(
                true
            );

            try {
                const period =
                    createPeriodRange(
                        settings.periodDays
                    );

                const previousPeriod =
                    createPreviousPeriodRange(
                        period
                    );

                const [
                    currentOrders,
                    previousOrders,
                    customers,
                    previousCustomers,
                    lowStockProducts,
                    health
                ] =
                    await Promise.all([
                        queryOrders(
                            period.start,
                            period.end
                        ),

                        queryOrders(
                            previousPeriod.start,
                            previousPeriod.end
                        ),

                        queryCustomers(
                            period.end
                        ),

                        queryCustomers(
                            previousPeriod.end
                        ),

                        queryLowStockProducts(),

                        queryHealth()
                    ]);

                const metrics =
                    calculateDashboardMetrics({
                        currentOrders,
                        previousOrders,
                        customers,
                        previousCustomers,
                        lowStockProducts
                    });

                snapshot =
                    createDashboardSnapshot({
                        metrics,
                        recentOrders:
                            currentOrders.slice(
                                0,
                                settings.recentOrderLimit
                            ),

                        lowStockProducts:
                            lowStockProducts.slice(
                                0,
                                settings.lowStockLimit
                            ),

                        health,
                        loadedAt:
                            new Date()
                                .toISOString()
                    });

                render(
                    snapshot
                );

                return cloneValue(
                    snapshot
                );
            } catch (
                error
            ) {
                renderFailure(
                    error
                );

                throw error;
            } finally {
                loading =
                    false;

                setRefreshBusy(
                    false
                );
            }
        }

        /* ==================================================
           FIRESTORE QUERIES
        ================================================== */

        async function queryOrders(
            start,
            end
        ) {
            if (
                !firestore ||
                typeof firestore
                    .collection !==
                    "function"
            ) {
                return [];
            }

            let query =
                firestore
                    .collection(
                        settings.ordersCollection
                    );

            if (
                query &&
                typeof query.where ===
                    "function"
            ) {
                query =
                    query
                        .where(
                            settings.orderDateField,
                            ">=",
                            createFirestoreDate(
                                start
                            )
                        )
                        .where(
                            settings.orderDateField,
                            "<",
                            createFirestoreDate(
                                end
                            )
                        );
            }

            if (
                query &&
                typeof query.orderBy ===
                    "function"
            ) {
                query =
                    query.orderBy(
                        settings.orderDateField,
                        "desc"
                    );
            }

            if (
                query &&
                typeof query.limit ===
                    "function"
            ) {
                query =
                    query.limit(
                        settings.orderQueryLimit
                    );
            }

            const snapshotResult =
                await query.get();

            return mapSnapshotDocuments(
                snapshotResult
            ).map(
                normalizeOrder
            );
        }

        async function queryCustomers(
            before
        ) {
            if (
                !firestore ||
                typeof firestore
                    .collection !==
                    "function"
            ) {
                return [];
            }

            let query =
                firestore
                    .collection(
                        settings.customersCollection
                    );

            if (
                query &&
                typeof query.where ===
                    "function"
            ) {
                query =
                    query.where(
                        settings.customerDateField,
                        "<",
                        createFirestoreDate(
                            before
                        )
                    );
            }

            if (
                query &&
                typeof query.limit ===
                    "function"
            ) {
                query =
                    query.limit(
                        settings.customerQueryLimit
                    );
            }

            const snapshotResult =
                await query.get();

            return mapSnapshotDocuments(
                snapshotResult
            ).map(
                normalizeCustomer
            );
        }

        async function queryLowStockProducts() {
            if (
                !firestore ||
                typeof firestore
                    .collection !==
                    "function"
            ) {
                return [];
            }

            let query =
                firestore
                    .collection(
                        settings.productsCollection
                    );

            if (
                query &&
                typeof query.where ===
                    "function"
            ) {
                query =
                    query.where(
                        settings.stockField,
                        "<=",
                        settings.lowStockThreshold
                    );
            }

            if (
                query &&
                typeof query.orderBy ===
                    "function"
            ) {
                query =
                    query.orderBy(
                        settings.stockField,
                        "asc"
                    );
            }

            if (
                query &&
                typeof query.limit ===
                    "function"
            ) {
                query =
                    query.limit(
                        settings.lowStockQueryLimit
                    );
            }

            const snapshotResult =
                await query.get();

            return mapSnapshotDocuments(
                snapshotResult
            )
                .map(
                    normalizeProduct
                )
                .filter(
                    function (
                        product
                    ) {
                        return product.stock <=
                            settings.lowStockThreshold;
                    }
                );
        }

        async function queryHealth() {
            const health =
                {
                    functions:
                        "unknown",

                    database:
                        firestore
                            ? "healthy"
                            : "unavailable",

                    authentication:
                        auth
                            ? "healthy"
                            : "unavailable",

                    timestamp:
                        new Date()
                            .toISOString()
                };

            if (
                !operationsService ||
                typeof operationsService
                    .getHealth !==
                    "function"
            ) {
                return health;
            }

            try {
                const result =
                    await operationsService
                        .getHealth();

                health.functions =
                    result &&
                    result.ok
                        ? "healthy"
                        : "degraded";

                health.database =
                    result &&
                    result.services
                        ? "healthy"
                        : health.database;

                health.timestamp =
                    result &&
                    result.timestamp
                        ? result.timestamp
                        : health.timestamp;
            } catch (
                error
            ) {
                health.functions =
                    "unavailable";

                health.error =
                    serializeError(
                        error
                    );
            }

            return health;
        }

        /* ==================================================
           RENDER
        ================================================== */

        function render(
            data
        ) {
            const source =
                data ||
                createDashboardSnapshot();

            renderMetrics(
                source.metrics
            );

            renderRecentOrders(
                source.recentOrders
            );

            renderLowStockProducts(
                source.lowStockProducts
            );

            renderHealth(
                source.health
            );
        }

        function renderMetrics(
            metrics
        ) {
            const source =
                metrics ||
                createDashboardMetrics();

            setText(
                elements.revenue,
                formatCurrency(
                    source.revenueMinor,
                    settings.currency,
                    settings.locale
                )
            );

            setText(
                elements.revenueChange,
                formatPercentageChange(
                    source.revenueChange
                )
            );

            setChangeStatus(
                elements.revenueChange,
                source.revenueChange
            );

            setText(
                elements.orders,
                formatInteger(
                    source.orderCount,
                    settings.locale
                )
            );

            setText(
                elements.ordersChange,
                formatPercentageChange(
                    source.orderChange
                )
            );

            setChangeStatus(
                elements.ordersChange,
                source.orderChange
            );

            setText(
                elements.customers,
                formatInteger(
                    source.customerCount,
                    settings.locale
                )
            );

            setText(
                elements.customersChange,
                formatPercentageChange(
                    source.customerChange
                )
            );

            setChangeStatus(
                elements.customersChange,
                source.customerChange
            );

            setText(
                elements.lowStock,
                formatInteger(
                    source.lowStockCount,
                    settings.locale
                )
            );

            setText(
                elements.lowStockChange,
                source.lowStockCount ===
                    0
                    ? "Clear"
                    : "Attention"
            );

            if (
                elements.lowStockChange
            ) {
                elements
                    .lowStockChange
                    .dataset
                    .status =
                        source.lowStockCount ===
                            0
                            ? "positive"
                            : "negative";
            }
        }

        function renderRecentOrders(
            orders
        ) {
            const container =
                elements.ordersTable;

            if (
                !container
            ) {
                return;
            }

            const table =
                resolveTableElement(
                    container
                );

            const tbody =
                table.querySelector(
                    "tbody"
                ) ||
                table.appendChild(
                    createElement(
                        documentObject,
                        "tbody"
                    )
                );

            tbody.textContent =
                "";

            const rows =
                normalizeArray(
                    orders
                );

            if (
                !rows.length
            ) {
                const row =
                    createElement(
                        documentObject,
                        "tr"
                    );

                const cell =
                    createElement(
                        documentObject,
                        "td"
                    );

                cell.colSpan =
                    5;

                cell.className =
                    "admin-operation-empty";

                cell.textContent =
                    "No recent orders found.";

                row.appendChild(
                    cell
                );

                tbody.appendChild(
                    row
                );

                return;
            }

            for (
                const order of
                rows
            ) {
                const row =
                    createElement(
                        documentObject,
                        "tr"
                    );

                appendCell(
                    row,
                    order.displayId ||
                    order.id
                );

                appendCell(
                    row,
                    order.customerName ||
                    order.customerEmail ||
                    "Guest"
                );

                appendStatusCell(
                    row,
                    order.status
                );

                appendCell(
                    row,
                    formatCurrency(
                        order.totalMinor,
                        order.currency ||
                        settings.currency,
                        settings.locale
                    )
                );

                appendCell(
                    row,
                    formatDate(
                        order.createdAt,
                        settings.locale
                    )
                );

                tbody.appendChild(
                    row
                );
            }
        }

        function renderLowStockProducts(
            products
        ) {
            const container =
                elements.lowStockList;

            if (
                !container
            ) {
                return;
            }

            container.textContent =
                "";

            const rows =
                normalizeArray(
                    products
                );

            if (
                !rows.length
            ) {
                const empty =
                    createElement(
                        documentObject,
                        "div",
                        "admin-dashboard-empty"
                    );

                empty.textContent =
                    "All tracked products have sufficient stock.";

                container.appendChild(
                    empty
                );

                return;
            }

            for (
                const product of
                rows
            ) {
                const item =
                    createElement(
                        documentObject,
                        "article",
                        "admin-dashboard-list-item"
                    );

                const copy =
                    createElement(
                        documentObject,
                        "div",
                        "admin-dashboard-list-copy"
                    );

                const name =
                    createElement(
                        documentObject,
                        "strong"
                    );

                name.textContent =
                    product.name ||
                    product.id;

                const sku =
                    createElement(
                        documentObject,
                        "small"
                    );

                sku.textContent =
                    product.sku
                        ? "SKU " +
                          product.sku
                        : "No SKU";

                copy.appendChild(
                    name
                );

                copy.appendChild(
                    sku
                );

                const quantity =
                    createElement(
                        documentObject,
                        "span",
                        "admin-stock-badge"
                    );

                quantity.textContent =
                    String(
                        product.stock
                    ) +
                    " left";

                quantity.dataset.status =
                    product.stock <=
                        0
                        ? "critical"
                        : "low";

                item.appendChild(
                    copy
                );

                item.appendChild(
                    quantity
                );

                container.appendChild(
                    item
                );
            }
        }

        function renderHealth(
            health
        ) {
            const source =
                health ||
                {};

            setHealthValue(
                elements.functionsHealth,
                source.functions
            );

            setHealthValue(
                elements.databaseHealth,
                source.database
            );

            setHealthValue(
                elements.authHealth,
                source.authentication
            );

            setText(
                elements.healthTime,
                formatDate(
                    source.timestamp,
                    settings.locale
                )
            );
        }

        function renderFailure(
            error
        ) {
            setText(
                elements.revenue,
                "—"
            );

            setText(
                elements.orders,
                "—"
            );

            setText(
                elements.customers,
                "—"
            );

            setText(
                elements.lowStock,
                "—"
            );

            setHealthValue(
                elements.functionsHealth,
                "unavailable"
            );

            reportError(
                error
            );
        }

        /* ==================================================
           EVENTS
        ================================================== */

        function bindEvents() {
            if (
                !elements.refreshButton
            ) {
                return;
            }

            const listener =
                function (
                    event
                ) {
                    event.preventDefault();

                    refresh()
                        .catch(
                            reportError
                        );
                };

            elements
                .refreshButton
                .addEventListener(
                    "click",
                    listener
                );

            disposers.push(
                function () {
                    elements
                        .refreshButton
                        .removeEventListener(
                            "click",
                            listener
                        );
                }
            );
        }

        function setRefreshBusy(
            busy
        ) {
            if (
                !elements.refreshButton
            ) {
                return;
            }

            elements
                .refreshButton
                .disabled =
                    Boolean(
                        busy
                    );

            elements
                .refreshButton
                .setAttribute(
                    "aria-busy",
                    busy
                        ? "true"
                        : "false"
                );
        }

        /* ==================================================
           CONTROLLER
        ================================================== */

        const controller =
            Object.freeze({
                init,
                destroy,
                refresh,

                queryOrders,
                queryCustomers,
                queryLowStockProducts,
                queryHealth,

                render,
                renderMetrics,
                renderRecentOrders,
                renderLowStockProducts,
                renderHealth,

                getSnapshot:
                    function () {
                        return cloneValue(
                            snapshot
                        );
                    },

                get loading() {
                    return loading;
                },

                elements,
                options:
                    settings
            });

        return controller;
    }

    /* ======================================================
       METRIC CALCULATION
    ====================================================== */

    function calculateDashboardMetrics(
        input
    ) {
        const source =
            input ||
            {};

        const currentOrders =
            normalizeArray(
                source.currentOrders
            );

        const previousOrders =
            normalizeArray(
                source.previousOrders
            );

        const currentRevenue =
            currentOrders.reduce(
                function (
                    total,
                    order
                ) {
                    return total +
                        normalizeMinorAmount(
                            order.totalMinor
                        );
                },
                0
            );

        const previousRevenue =
            previousOrders.reduce(
                function (
                    total,
                    order
                ) {
                    return total +
                        normalizeMinorAmount(
                            order.totalMinor
                        );
                },
                0
            );

        const customers =
            normalizeArray(
                source.customers
            );

        const previousCustomers =
            normalizeArray(
                source.previousCustomers
            );

        const lowStockProducts =
            normalizeArray(
                source.lowStockProducts
            );

        return createDashboardMetrics({
            revenueMinor:
                currentRevenue,

            revenueChange:
                calculatePercentageChange(
                    currentRevenue,
                    previousRevenue
                ),

            orderCount:
                currentOrders.length,

            orderChange:
                calculatePercentageChange(
                    currentOrders.length,
                    previousOrders.length
                ),

            customerCount:
                customers.length,

            customerChange:
                calculatePercentageChange(
                    customers.length,
                    previousCustomers.length
                ),

            lowStockCount:
                lowStockProducts.length
        });
    }

    function calculatePercentageChange(
        current,
        previous
    ) {
        const normalizedCurrent =
            Number(
                current
            ) ||
            0;

        const normalizedPrevious =
            Number(
                previous
            ) ||
            0;

        if (
            normalizedPrevious ===
                0
        ) {
            return normalizedCurrent ===
                0
                ? 0
                : 100;
        }

        return (
            (
                normalizedCurrent -
                normalizedPrevious
            ) /
            Math.abs(
                normalizedPrevious
            )
        ) *
            100;
    }

    /* ======================================================
       NORMALIZATION
    ====================================================== */

    function normalizeControllerOptions(
        options
    ) {
        const source =
            options ||
            {};

        return Object.freeze({
            document:
                source.document ||
                null,

            root:
                source.root ||
                null,

            firestore:
                source.firestore ||
                null,

            auth:
                source.auth ||
                null,

            operationsService:
                source.operationsService ||
                null,

            currency:
                normalizeCurrency(
                    source.currency
                ),

            locale:
                normalizeLocale(
                    source.locale
                ),

            periodDays:
                normalizePositiveInteger(
                    source.periodDays,
                    DEFAULT_PERIOD_DAYS,
                    "Dashboard period"
                ),

            recentOrderLimit:
                normalizePositiveInteger(
                    source.recentOrderLimit,
                    DEFAULT_RECENT_ORDER_LIMIT,
                    "Recent order limit"
                ),

            lowStockLimit:
                normalizePositiveInteger(
                    source.lowStockLimit,
                    DEFAULT_LOW_STOCK_LIMIT,
                    "Low-stock display limit"
                ),

            lowStockThreshold:
                normalizeNonNegativeInteger(
                    source.lowStockThreshold,
                    DEFAULT_LOW_STOCK_THRESHOLD,
                    "Low-stock threshold"
                ),

            orderQueryLimit:
                normalizePositiveInteger(
                    source.orderQueryLimit,
                    500,
                    "Order query limit"
                ),

            customerQueryLimit:
                normalizePositiveInteger(
                    source.customerQueryLimit,
                    5000,
                    "Customer query limit"
                ),

            lowStockQueryLimit:
                normalizePositiveInteger(
                    source.lowStockQueryLimit,
                    100,
                    "Low-stock query limit"
                ),

            ordersCollection:
                normalizeCollectionName(
                    source.ordersCollection,
                    "orders"
                ),

            customersCollection:
                normalizeCollectionName(
                    source.customersCollection,
                    "users"
                ),

            productsCollection:
                normalizeCollectionName(
                    source.productsCollection,
                    "products"
                ),

            orderDateField:
                normalizeFieldName(
                    source.orderDateField,
                    "createdAt"
                ),

            customerDateField:
                normalizeFieldName(
                    source.customerDateField,
                    "createdAt"
                ),

            stockField:
                normalizeFieldName(
                    source.stockField,
                    "stock"
                ),

            selectors:
                Object.freeze(
                    Object.assign(
                        {},
                        DEFAULT_SELECTORS,
                        source.selectors ||
                        {}
                    )
                )
        });
    }

    function normalizeOrder(
        value
    ) {
        const source =
            value ||
            {};

        return {
            id:
                String(
                    source.id ||
                    ""
                ),

            displayId:
                source.displayId ||
                source.orderNumber ||
                source.reference ||
                source.id ||
                "—",

            customerName:
                source.customerName ||
                getNestedValue(
                    source,
                    "customer.name"
                ) ||
                null,

            customerEmail:
                source.customerEmail ||
                getNestedValue(
                    source,
                    "customer.email"
                ) ||
                null,

            status:
                String(
                    source.status ||
                    "pending"
                ).toLowerCase(),

            totalMinor:
                normalizeMinorAmount(
                    source.totalMinor !==
                        undefined
                        ? source.totalMinor
                        : source.total
                ),

            currency:
                normalizeCurrency(
                    source.currency ||
                    DEFAULT_CURRENCY
                ),

            createdAt:
                normalizeDateValue(
                    source.createdAt
                )
        };
    }

    function normalizeCustomer(
        value
    ) {
        const source =
            value ||
            {};

        return {
            id:
                String(
                    source.id ||
                    ""
                ),

            name:
                source.displayName ||
                source.name ||
                null,

            email:
                source.email ||
                null,

            createdAt:
                normalizeDateValue(
                    source.createdAt
                )
        };
    }

    function normalizeProduct(
        value
    ) {
        const source =
            value ||
            {};

        return {
            id:
                String(
                    source.id ||
                    ""
                ),

            name:
                source.name ||
                source.title ||
                source.id ||
                "Unnamed product",

            sku:
                source.sku ||
                source.productCode ||
                null,

            stock:
                normalizeNonNegativeInteger(
                    source.stock !==
                        undefined
                        ? source.stock
                        : source.quantity,
                    0,
                    "Stock"
                )
        };
    }

    function normalizeMinorAmount(
        value
    ) {
        const normalized =
            Number(
                value
            );

        if (
            !Number.isFinite(
                normalized
            )
        ) {
            return 0;
        }

        return Math.round(
            normalized
        );
    }

    function normalizeCurrency(
        value
    ) {
        const normalized =
            String(
                value ||
                DEFAULT_CURRENCY
            )
                .trim()
                .toUpperCase();

        return normalized ||
            DEFAULT_CURRENCY;
    }

    function normalizeLocale(
        value
    ) {
        const normalized =
            String(
                value ||
                DEFAULT_LOCALE
            ).trim();

        return normalized ||
            DEFAULT_LOCALE;
    }

    function normalizeCollectionName(
        value,
        fallback
    ) {
        const normalized =
            String(
                value ||
                fallback
            ).trim();

        if (
            !normalized ||
            normalized.includes(
                "/"
            )
        ) {
            throw new TypeError(
                "Firestore collection name is invalid."
            );
        }

        return normalized;
    }

    function normalizeFieldName(
        value,
        fallback
    ) {
        const normalized =
            String(
                value ||
                fallback
            ).trim();

        if (
            !normalized
        ) {
            throw new TypeError(
                "Firestore field name is required."
            );
        }

        return normalized;
    }

    function normalizePositiveInteger(
        value,
        fallback,
        label
    ) {
        if (
            value ===
                undefined ||
            value ===
                null ||
            value ===
                ""
        ) {
            return fallback;
        }

        const normalized =
            Number(
                value
            );

        if (
            !Number.isInteger(
                normalized
            ) ||
            normalized <=
                0
        ) {
            throw new TypeError(
                label +
                " must be a positive integer."
            );
        }

        return normalized;
    }

    function normalizeNonNegativeInteger(
        value,
        fallback,
        label
    ) {
        if (
            value ===
                undefined ||
            value ===
                null ||
            value ===
                ""
        ) {
            return fallback;
        }

        const normalized =
            Number(
                value
            );

        if (
            !Number.isInteger(
                normalized
            ) ||
            normalized <
                0
        ) {
            throw new TypeError(
                label +
                " must be a non-negative integer."
            );
        }

        return normalized;
    }

    /* ======================================================
       SNAPSHOT BUILDERS
    ====================================================== */

    function createDashboardMetrics(
        values
    ) {
        const source =
            values ||
            {};

        return {
            revenueMinor:
                normalizeMinorAmount(
                    source.revenueMinor
                ),

            revenueChange:
                Number(
                    source.revenueChange
                ) ||
                0,

            orderCount:
                normalizeNonNegativeInteger(
                    source.orderCount,
                    0,
                    "Order count"
                ),

            orderChange:
                Number(
                    source.orderChange
                ) ||
                0,

            customerCount:
                normalizeNonNegativeInteger(
                    source.customerCount,
                    0,
                    "Customer count"
                ),

            customerChange:
                Number(
                    source.customerChange
                ) ||
                0,

            lowStockCount:
                normalizeNonNegativeInteger(
                    source.lowStockCount,
                    0,
                    "Low-stock count"
                )
        };
    }

    function createDashboardSnapshot(
        values
    ) {
        const source =
            values ||
            {};

        return {
            metrics:
                createDashboardMetrics(
                    source.metrics
                ),

            recentOrders:
                normalizeArray(
                    source.recentOrders
                ).map(
                    normalizeOrder
                ),

            lowStockProducts:
                normalizeArray(
                    source.lowStockProducts
                ).map(
                    normalizeProduct
                ),

            health:
                cloneValue(
                    source.health ||
                    {
                        functions:
                            "unknown",

                        database:
                            "unknown",

                        authentication:
                            "unknown",

                        timestamp:
                            null
                    }
                ),

            loadedAt:
                source.loadedAt ||
                null
        };
    }

    /* ======================================================
       DATE HELPERS
    ====================================================== */

    function createPeriodRange(
        days,
        now
    ) {
        const end =
            now instanceof Date
                ? new Date(
                      now.getTime()
                  )
                : new Date();

        const start =
            new Date(
                end.getTime()
            );

        start.setDate(
            start.getDate() -
            days
        );

        return {
            start,
            end
        };
    }

    function createPreviousPeriodRange(
        period
    ) {
        const duration =
            period.end.getTime() -
            period.start.getTime();

        return {
            start:
                new Date(
                    period.start.getTime() -
                    duration
                ),

            end:
                new Date(
                    period.start.getTime()
                )
        };
    }

    function createFirestoreDate(
        date
    ) {
        if (
            global.firebase &&
            global.firebase.firestore &&
            global.firebase.firestore
                .Timestamp &&
            typeof global.firebase
                .firestore
                .Timestamp
                .fromDate ===
                "function"
        ) {
            return global.firebase
                .firestore
                .Timestamp
                .fromDate(
                    date
                );
        }

        return date;
    }

    function normalizeDateValue(
        value
    ) {
        if (
            !value
        ) {
            return null;
        }

        if (
            value instanceof Date
        ) {
            return value.toISOString();
        }

        if (
            typeof value.toDate ===
                "function"
        ) {
            return value
                .toDate()
                .toISOString();
        }

        if (
            typeof value.toMillis ===
                "function"
        ) {
            return new Date(
                value.toMillis()
            ).toISOString();
        }

        const date =
            new Date(
                value
            );

        return Number.isNaN(
            date.getTime()
        )
            ? null
            : date.toISOString();
    }

    /* ======================================================
       FORMATTERS
    ====================================================== */

    function formatCurrency(
        minorAmount,
        currency,
        locale
    ) {
        const amount =
            normalizeMinorAmount(
                minorAmount
            ) /
            100;

        try {
            return new Intl
                .NumberFormat(
                    locale ||
                    DEFAULT_LOCALE,
                    {
                        style:
                            "currency",

                        currency:
                            currency ||
                            DEFAULT_CURRENCY
                    }
                )
                .format(
                    amount
                );
        } catch (
            error
        ) {
            return (
                (
                    currency ||
                    DEFAULT_CURRENCY
                ) +
                " " +
                amount.toFixed(
                    2
                )
            );
        }
    }

    function formatInteger(
        value,
        locale
    ) {
        return new Intl
            .NumberFormat(
                locale ||
                DEFAULT_LOCALE,
                {
                    maximumFractionDigits:
                        0
                }
            )
            .format(
                Number(
                    value
                ) ||
                0
            );
    }

    function formatPercentageChange(
        value
    ) {
        const normalized =
            Number(
                value
            ) ||
            0;

        const prefix =
            normalized >
                0
                ? "+"
                : "";

        return (
            prefix +
            normalized.toFixed(
                1
            ) +
            "%"
        );
    }

    function formatDate(
        value,
        locale
    ) {
        if (
            !value
        ) {
            return "—";
        }

        const date =
            value instanceof Date
                ? value
                : new Date(
                      value
                  );

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {
            return "—";
        }

        return new Intl
            .DateTimeFormat(
                locale ||
                DEFAULT_LOCALE,
                {
                    dateStyle:
                        "medium",

                    timeStyle:
                        "short"
                }
            )
            .format(
                date
            );
    }

    /* ======================================================
       DOM HELPERS
    ====================================================== */

    function resolveRoot(
        documentObject,
        root,
        selector
    ) {
        if (
            root &&
            typeof root ===
                "object"
        ) {
            return root;
        }

        if (
            typeof root ===
                "string"
        ) {
            return documentObject
                .querySelector(
                    root
                );
        }

        return documentObject
            .querySelector(
                selector
            );
    }

    function resolveElements(
        root,
        selectors
    ) {
        const output =
            {};

        for (
            const [
                key,
                selector
            ] of
            Object.entries(
                selectors
            )
        ) {
            output[key] =
                root &&
                typeof root
                    .querySelector ===
                    "function"
                    ? root.querySelector(
                          selector
                      )
                    : null;
        }

        return output;
    }

    function createElement(
        documentObject,
        tagName,
        className
    ) {
        const element =
            documentObject
                .createElement(
                    tagName
                );

        if (
            className
        ) {
            element.className =
                className;
        }

        return element;
    }

    function resolveTableElement(
        element
    ) {
        if (
            String(
                element.tagName
            ).toLowerCase() ===
            "table"
        ) {
            return element;
        }

        let table =
            element.querySelector(
                "table"
            );

        if (
            !table
        ) {
            table =
                createElement(
                    element.ownerDocument ||
                    global.document,
                    "table",
                    "admin-operation-table"
                );

            element.appendChild(
                table
            );
        }

        return table;
    }

    function appendCell(
        row,
        value
    ) {
        const cell =
            createElement(
                row.ownerDocument ||
                global.document,
                "td"
            );

        cell.textContent =
            value ===
                undefined ||
            value ===
                null ||
            value ===
                ""
                ? "—"
                : String(
                      value
                  );

        row.appendChild(
            cell
        );

        return cell;
    }

    function appendStatusCell(
        row,
        status
    ) {
        const cell =
            appendCell(
                row,
                titleCase(
                    status
                )
            );

        cell.dataset.status =
            String(
                status ||
                "unknown"
            ).toLowerCase();

        return cell;
    }

    function setText(
        element,
        value
    ) {
        if (
            element
        ) {
            element.textContent =
                String(
                    value ===
                        undefined ||
                    value ===
                        null
                        ? "—"
                        : value
                );
        }
    }

    function setChangeStatus(
        element,
        value
    ) {
        if (
            !element
        ) {
            return;
        }

        const normalized =
            Number(
                value
            ) ||
            0;

        element.dataset.status =
            normalized >
                0
                ? "positive"
                : normalized <
                    0
                    ? "negative"
                    : "neutral";
    }

    function setHealthValue(
        element,
        status
    ) {
        if (
            !element
        ) {
            return;
        }

        const normalized =
            String(
                status ||
                "unknown"
            ).toLowerCase();

        const labels = {
            healthy:
                "Operational",

            degraded:
                "Degraded",

            unavailable:
                "Unavailable",

            unknown:
                "Unknown"
        };

        element.textContent =
            labels[
                normalized
            ] ||
            titleCase(
                normalized
            );

        element.dataset.status =
            normalized;
    }

    /* ======================================================
       SNAPSHOT HELPERS
    ====================================================== */

    function mapSnapshotDocuments(
        snapshot
    ) {
        if (
            !snapshot
        ) {
            return [];
        }

        const documents =
            Array.isArray(
                snapshot.docs
            )
                ? snapshot.docs
                : [];

        return documents.map(
            function (
                documentSnapshot
            ) {
                const data =
                    documentSnapshot &&
                    typeof documentSnapshot
                        .data ===
                        "function"
                        ? documentSnapshot.data()
                        : {};

                return Object.assign(
                    {
                        id:
                            documentSnapshot &&
                            documentSnapshot.id
                                ? documentSnapshot.id
                                : null
                    },
                    data ||
                    {}
                );
            }
        );
    }

    function normalizeArray(
        value
    ) {
        return Array.isArray(
            value
        )
            ? value
            : [];
    }

    function getNestedValue(
        object,
        path
    ) {
        return String(
            path
        )
            .split(".")
            .reduce(
                function (
                    current,
                    key
                ) {
                    if (
                        current ===
                            null ||
                        current ===
                            undefined
                    ) {
                        return undefined;
                    }

                    return current[
                        key
                    ];
                },
                object
            );
    }

    function titleCase(
        value
    ) {
        return String(
            value ||
            ""
        )
            .replace(
                /[-_]+/g,
                " "
            )
            .replace(
                /\b\w/g,
                function (
                    character
                ) {
                    return character
                        .toUpperCase();
                }
            );
    }

    /* ======================================================
       DEPENDENCY RESOLUTION
    ====================================================== */

    function resolveFirestore() {
        if (
            global.firebase &&
            typeof global.firebase
                .firestore ===
                "function"
        ) {
            return global.firebase
                .firestore();
        }

        return null;
    }

    function resolveAuth() {
        if (
            global.firebase &&
            typeof global.firebase
                .auth ===
                "function"
        ) {
            return global.firebase
                .auth();
        }

        return null;
    }

    function resolveOperationsService() {
        if (
            global
                .LEternelAdminOperations &&
            typeof global
                .LEternelAdminOperations
                .getAdminOperationsService ===
                "function"
        ) {
            try {
                return global
                    .LEternelAdminOperations
                    .getAdminOperationsService();
            } catch (
                error
            ) {
                return null;
            }
        }

        return null;
    }

    /* ======================================================
       ERROR / CLONE
    ====================================================== */

    function serializeError(
        error
    ) {
        return {
            name:
                error &&
                error.name
                    ? error.name
                    : "Error",

            code:
                error &&
                error.code
                    ? error.code
                    : null,

            message:
                error &&
                error.message
                    ? error.message
                    : "Unknown error."
        };
    }

    function reportError(
        error
    ) {
        if (
            global.console &&
            typeof global.console
                .error ===
                "function"
        ) {
            global.console.error(
                "Admin dashboard error.",
                error
            );
        }
    }

    function cloneValue(
        value
    ) {
        if (
            value ===
                undefined ||
            value ===
                null
        ) {
            return value;
        }

        if (
            value instanceof Date
        ) {
            return value
                .toISOString();
        }

        if (
            Array.isArray(
                value
            )
        ) {
            return value.map(
                cloneValue
            );
        }

        if (
            typeof value ===
                "object"
        ) {
            return Object.keys(
                value
            ).reduce(
                function (
                    output,
                    key
                ) {
                    output[key] =
                        cloneValue(
                            value[
                                key
                            ]
                        );

                    return output;
                },
                {}
            );
        }

        return value;
    }

    /* ======================================================
       DEFAULT INSTANCE
    ====================================================== */

    let defaultController =
        null;

    function getDashboardController(
        options
    ) {
        if (
            options
        ) {
            return createDashboardController(
                options
            );
        }

        if (
            !defaultController
        ) {
            defaultController =
                createDashboardController();
        }

        return defaultController;
    }

    function resetDashboardController() {
        if (
            defaultController
        ) {
            defaultController
                .destroy();
        }

        defaultController =
            null;
    }

    /* ======================================================
       EXPORT
    ====================================================== */

    const api =
        Object.freeze({
            createDashboardController,
            getDashboardController,
            resetDashboardController,

            calculateDashboardMetrics,
            calculatePercentageChange,

            normalizeControllerOptions,
            normalizeOrder,
            normalizeCustomer,
            normalizeProduct,
            normalizeMinorAmount,
            normalizeCurrency,
            normalizeLocale,
            normalizeCollectionName,
            normalizeFieldName,
            normalizePositiveInteger,
            normalizeNonNegativeInteger,

            createDashboardMetrics,
            createDashboardSnapshot,
            createPeriodRange,
            createPreviousPeriodRange,
            normalizeDateValue,

            formatCurrency,
            formatInteger,
            formatPercentageChange,
            formatDate,

            mapSnapshotDocuments,
            normalizeArray,
            getNestedValue,
            titleCase,
            serializeError,
            cloneValue,

            constants:
                Object.freeze({
                    DEFAULT_SELECTORS,
                    DEFAULT_CURRENCY,
                    DEFAULT_LOCALE,
                    DEFAULT_RECENT_ORDER_LIMIT,
                    DEFAULT_LOW_STOCK_LIMIT,
                    DEFAULT_LOW_STOCK_THRESHOLD,
                    DEFAULT_PERIOD_DAYS
                })
        });

    global.LEternelDashboardController =
        api;

    if (
        typeof module !==
            "undefined" &&
        module.exports
    ) {
        module.exports =
            api;
    }
})(
    typeof window !==
        "undefined"
        ? window
        : globalThis
);