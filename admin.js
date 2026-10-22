"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ADMINISTRATION MODULE — FIREBASE V8
========================================================== */

(function initializeAdminModule() {
    const app = window.LEternelApp;
    const router = window.LEternelRouter;
    const authModule = window.LEternelAuth;
    const productsModule = window.LEternelProducts;
    const services = window.FirebaseServices;

    if (!app) {
        throw new Error(
            "LEternelApp was not found. Load app.js before admin.js."
        );
    }

    if (!services || !services.auth || !services.db || !services.storage) {
        throw new Error(
            "Firebase services were not found. Load firebase.js before admin.js."
        );
    }

    const auth = services.auth;
    const db = services.db;
    const storage = services.storage;

    const serverTimestamp =
        services.helpers.serverTimestamp;

    const createStoragePath =
        services.helpers.createStoragePath;

    const generateStorageFileName =
        services.helpers.generateStorageFileName;

    const Admin = {
        initialized: false,

        config: {
            productsCollection: "products",
            ordersCollection: "orders",
            usersCollection: "users",
            categoriesCollection: "categories",

            productImagesFolder: "products",

            productsPageSize: 20,
            ordersPageSize: 20,
            customersPageSize: 20,

            dashboardRecentOrdersLimit: 6,
            dashboardTopProductsLimit: 6,
            dashboardLowStockLimit: 8,

            lowStockThreshold: 5,
            maximumProductImages: 8,
            maximumImageSize: 8 * 1024 * 1024,

            acceptedImageTypes: [
                "image/jpeg",
                "image/png",
                "image/webp"
            ],

            defaultCurrency: "NGN",
            defaultLocale: "en-NG"
        },

        state: {
            user: null,
            profile: null,
            authorized: false,
            activeSection: "dashboard",
            loading: false,

            dashboard: {
                revenue: 0,
                orderCount: 0,
                customerCount: 0,
                productCount: 0,
                pendingOrders: 0,
                lowStockCount: 0,
                recentOrders: [],
                topProducts: [],
                lowStockProducts: []
            },

            products: [],
            productSearch: "",
            productStatus: "all",
            productCategory: "",
            productSort: "newest",
            productLastSnapshot: null,
            productsComplete: false,

            orders: [],
            orderSearch: "",
            orderStatus: "all",
            orderLastSnapshot: null,
            ordersComplete: false,

            customers: [],
            customerSearch: "",
            customerStatus: "all",
            customerLastSnapshot: null,
            customersComplete: false,

            editingProduct: null,
            uploadedImages: [],
            pendingImageFiles: [],

            unsubscribeOrders: null
        },

        elements: {}
    };

    /* ======================================================
       DOM HELPERS
    ====================================================== */

    function query(selector, parent) {
        return (parent || document).querySelector(selector);
    }

    function queryAll(selector, parent) {
        return Array.prototype.slice.call(
            (parent || document).querySelectorAll(selector)
        );
    }

    function getById(id) {
        return document.getElementById(id);
    }

    function escapeHTML(value) {
        return app.utils.escapeHTML(value);
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function toNumber(value, fallback) {
        const number = Number(value);

        return Number.isFinite(number)
            ? number
            : Number(fallback) || 0;
    }

    function toBoolean(value) {
        if (typeof value === "boolean") {
            return value;
        }

        return (
            value === "true" ||
            value === "1" ||
            value === 1 ||
            value === "on"
        );
    }

    function slugify(value) {
        return String(value || "")
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

    function getFormValue(form, names) {
        const fieldNames = Array.isArray(names)
            ? names
            : [names];

        for (
            let index = 0;
            index < fieldNames.length;
            index += 1
        ) {
            const field = form.elements[fieldNames[index]];

            if (field) {
                return String(field.value || "").trim();
            }
        }

        return "";
    }

    function formatPrice(value, currency) {
        if (
            productsModule &&
            typeof productsModule.formatPrice === "function"
        ) {
            return productsModule.formatPrice(
                value,
                currency || Admin.config.defaultCurrency
            );
        }

        try {
            return new Intl.NumberFormat(
                Admin.config.defaultLocale,
                {
                    style: "currency",
                    currency:
                        currency ||
                        Admin.config.defaultCurrency,

                    maximumFractionDigits: 0
                }
            ).format(toNumber(value, 0));
        } catch (error) {
            return (
                (currency || Admin.config.defaultCurrency) +
                " " +
                toNumber(value, 0).toLocaleString()
            );
        }
    }

    function formatDate(value, options) {
        const date = toDate(value);

        if (!date) {
            return "";
        }

        return new Intl.DateTimeFormat(
            Admin.config.defaultLocale,
            options || {
                day: "numeric",
                month: "short",
                year: "numeric"
            }
        ).format(date);
    }

    function toDate(value) {
        if (!value) {
            return null;
        }

        if (typeof value.toDate === "function") {
            return value.toDate();
        }

        if (value instanceof Date) {
            return value;
        }

        const date = new Date(value);

        return Number.isNaN(date.getTime())
            ? null
            : date;
    }

    function debounce(callback, delay) {
        let timeoutId = null;

        return function debouncedFunction() {
            const context = this;
            const args = arguments;

            window.clearTimeout(timeoutId);

            timeoutId = window.setTimeout(function () {
                callback.apply(context, args);
            }, delay || 350);
        };
    }

    function uniqueValues(values) {
        return values.filter(function (value, index, array) {
            return Boolean(value) && array.indexOf(value) === index;
        });
    }

    /* ======================================================
       ELEMENT CACHE
    ====================================================== */

    function cacheElements() {
        Admin.elements = {
            page:
                getById("admin-page") ||
                query('[data-page="admin"]'),

            loading:
                getById("admin-loading") ||
                query("[data-admin-loading]"),

            sections: queryAll(
                "[data-admin-section]"
            ),

            navigationButtons: queryAll(
                "[data-admin-route]"
            ),

            sidebar:
                getById("admin-sidebar") ||
                query(".admin-sidebar"),

            sidebarOverlay:
                getById("admin-sidebar-overlay") ||
                query(".admin-sidebar-overlay"),

            sidebarToggle:
                getById("admin-sidebar-toggle") ||
                query("[data-admin-sidebar-toggle]"),

            sidebarClose:
                getById("admin-sidebar-close") ||
                query("[data-admin-sidebar-close]"),

            pageTitle:
                getById("admin-page-title") ||
                query("[data-admin-page-title]"),

            pageDescription:
                getById("admin-page-description") ||
                query("[data-admin-page-description]"),

            revenueStat: queryAll(
                "[data-admin-revenue]"
            ),

            orderCountStat: queryAll(
                "[data-admin-order-count]"
            ),

            customerCountStat: queryAll(
                "[data-admin-customer-count]"
            ),

            productCountStat: queryAll(
                "[data-admin-product-count]"
            ),

            pendingOrderStat: queryAll(
                "[data-admin-pending-count]"
            ),

            lowStockStat: queryAll(
                "[data-admin-low-stock-count]"
            ),

            recentOrders:
                getById("admin-recent-orders") ||
                query("[data-admin-recent-orders]"),

            topProducts:
                getById("admin-top-products") ||
                query("[data-admin-top-products]"),

            lowStockProducts:
                getById("admin-low-stock-products") ||
                query("[data-admin-low-stock-products]"),

            salesChart:
                getById("admin-sales-chart") ||
                query("[data-admin-sales-chart]"),

            productsTable:
                getById("admin-products-table") ||
                query("[data-admin-products-table]"),

            productsEmpty:
                getById("admin-products-empty") ||
                query("[data-admin-products-empty]"),

            productSearch:
                getById("admin-product-search") ||
                query("[data-admin-product-search]"),

            productStatus:
                getById("admin-product-status") ||
                query("[data-admin-product-status]"),

            productCategory:
                getById("admin-product-category") ||
                query("[data-admin-product-category]"),

            productSort:
                getById("admin-product-sort") ||
                query("[data-admin-product-sort]"),

            productsLoadMore:
                getById("admin-products-load-more") ||
                query("[data-admin-products-load-more]"),

            productForm:
                getById("admin-product-form") ||
                query("[data-admin-product-form]"),

            productFormTitle:
                getById("admin-product-form-title") ||
                query("[data-admin-product-form-title]"),

            productImageInput:
                getById("admin-product-images") ||
                query("[data-admin-product-images]"),

            productImageDropzone:
                getById("admin-image-dropzone") ||
                query("[data-admin-image-dropzone]"),

            productImagePreview:
                getById("admin-image-preview") ||
                query("[data-admin-image-preview]"),

            variantContainer:
                getById("admin-product-variants") ||
                query("[data-admin-product-variants]"),

            addVariantButton:
                getById("admin-add-variant") ||
                query("[data-admin-add-variant]"),

            productSaveButton:
                getById("admin-product-save") ||
                query("[data-admin-product-save]"),

            productDeleteButton:
                getById("admin-product-delete") ||
                query("[data-admin-product-delete]"),

            ordersTable:
                getById("admin-orders-table") ||
                query("[data-admin-orders-table]"),

            ordersEmpty:
                getById("admin-orders-empty") ||
                query("[data-admin-orders-empty]"),

            orderSearch:
                getById("admin-order-search") ||
                query("[data-admin-order-search]"),

            orderStatus:
                getById("admin-order-status") ||
                query("[data-admin-order-status]"),

            ordersLoadMore:
                getById("admin-orders-load-more") ||
                query("[data-admin-orders-load-more]"),

            orderDetail:
                getById("admin-order-detail") ||
                query("[data-admin-order-detail]"),

            customersTable:
                getById("admin-customers-table") ||
                query("[data-admin-customers-table]"),

            customersEmpty:
                getById("admin-customers-empty") ||
                query("[data-admin-customers-empty]"),

            customerSearch:
                getById("admin-customer-search") ||
                query("[data-admin-customer-search]"),

            customerStatus:
                getById("admin-customer-status") ||
                query("[data-admin-customer-status]"),

            customersLoadMore:
                getById("admin-customers-load-more") ||
                query("[data-admin-customers-load-more]"),

            customerDetail:
                getById("admin-customer-detail") ||
                query("[data-admin-customer-detail]"),

            confirmationModal:
                getById("admin-confirmation-modal") ||
                query("[data-admin-confirmation-modal]"),

            confirmationTitle:
                getById("admin-confirmation-title") ||
                query("[data-admin-confirmation-title]"),

            confirmationMessage:
                getById("admin-confirmation-message") ||
                query("[data-admin-confirmation-message]"),

            confirmationAccept:
                getById("admin-confirmation-accept") ||
                query("[data-admin-confirmation-accept]"),

            confirmationCancel:
                getById("admin-confirmation-cancel") ||
                query("[data-admin-confirmation-cancel]")
        };
    }

    /* ======================================================
       AUTHORIZATION
    ====================================================== */

    async function verifyAdminAccess(user) {
        if (!user) {
            Admin.state.authorized = false;
            return false;
        }

        let authorized = false;

        if (
            authModule &&
            typeof authModule.isAdmin === "function"
        ) {
            authorized = await authModule.isAdmin();
        } else if (
            router &&
            typeof router.isAdmin === "function"
        ) {
            authorized = await router.isAdmin(user);
        } else {
            const token = await user.getIdTokenResult();

            authorized = Boolean(
                token.claims &&
                (
                    token.claims.admin === true ||
                    token.claims.role === "admin" ||
                    token.claims.role === "superadmin"
                )
            );
        }

        Admin.state.user = user;
        Admin.state.authorized = authorized;

        document.body.classList.toggle(
            "admin-authorized",
            authorized
        );

        document.body.classList.toggle(
            "admin-unauthorized",
            !authorized
        );

        return authorized;
    }

    async function requireAdmin() {
        const user = auth.currentUser;

        if (!user) {
            app.showToast({
                type: "info",
                title: "Sign in required",
                message:
                    "Sign in with an administrator account."
            });

            app.openAuth("login");

            return false;
        }

        const authorized =
            await verifyAdminAccess(user);

        if (!authorized) {
            app.showToast({
                type: "error",
                title: "Access denied",
                message:
                    "You do not have permission to access the administration area."
            });

            if (router) {
                await router.navigate(
                    "/account",
                    {
                        replace: true
                    }
                );
            }

            return false;
        }

        return true;
    }

    /* ======================================================
       REFERENCES
    ====================================================== */

    function getProductsReference() {
        return db.collection(
            Admin.config.productsCollection
        );
    }

    function getOrdersReference() {
        return db.collection(
            Admin.config.ordersCollection
        );
    }

    function getUsersReference() {
        return db.collection(
            Admin.config.usersCollection
        );
    }

    /* ======================================================
       SECTION MANAGEMENT
    ====================================================== */

    const sectionMetadata = {
        dashboard: {
            title: "Dashboard",
            description:
                "Monitor sales, orders, customers, and inventory."
        },

        products: {
            title: "Products",
            description:
                "Manage the L'ÉTERNEL catalogue and inventory."
        },

        "product-form": {
            title: "Product Editor",
            description:
                "Create or update product information and variants."
        },

        orders: {
            title: "Orders",
            description:
                "Manage customer orders and fulfilment."
        },

        "order-detail": {
            title: "Order Details",
            description:
                "Review payment, delivery, and fulfilment details."
        },

        customers: {
            title: "Customers",
            description:
                "Review customer profiles and account status."
        },

        "customer-detail": {
            title: "Customer Details",
            description:
                "Review customer activity and account information."
        },

        analytics: {
            title: "Analytics",
            description:
                "Review store performance and sales trends."
        }
    };

    function activateSection(sectionName) {
        const section =
            String(sectionName || "dashboard");

        Admin.state.activeSection = section;

        Admin.elements.sections.forEach(
            function (element) {
                const active =
                    element.dataset.adminSection === section;

                element.hidden = !active;
                element.classList.toggle(
                    "active",
                    active
                );
            }
        );

        Admin.elements.navigationButtons.forEach(
            function (button) {
                button.classList.toggle(
                    "active",
                    button.dataset.adminRoute === section
                );
            }
        );

        const metadata =
            sectionMetadata[section] ||
            sectionMetadata.dashboard;

        if (Admin.elements.pageTitle) {
            Admin.elements.pageTitle.textContent =
                metadata.title;
        }

        if (Admin.elements.pageDescription) {
            Admin.elements.pageDescription.textContent =
                metadata.description;
        }

        closeSidebar();
    }

    /* ======================================================
       DASHBOARD ANALYTICS
    ====================================================== */

    async function loadDashboard() {
        setLoading(true);

        try {
            const results = await Promise.all([
                loadOrderMetrics(),
                loadProductMetrics(),
                loadCustomerMetrics(),
                loadRecentOrders(),
                loadTopProducts(),
                loadLowStockProducts()
            ]);

            Admin.state.dashboard = Object.assign(
                {},
                Admin.state.dashboard,
                results[0],
                results[1],
                results[2],
                {
                    recentOrders: results[3],
                    topProducts: results[4],
                    lowStockProducts: results[5]
                }
            );

            renderDashboard();

            return Admin.state.dashboard;
        } catch (error) {
            console.error(
                "[Admin] Dashboard could not be loaded:",
                error
            );

            app.showToast({
                type: "error",
                title: "Dashboard unavailable",
                message:
                    "Administrator statistics could not be loaded."
            });

            return null;
        } finally {
            setLoading(false);
        }
    }

    async function loadOrderMetrics() {
        const snapshot =
            await getOrdersReference().get();

        let revenue = 0;
        let pendingOrders = 0;

        snapshot.docs.forEach(
            function (documentSnapshot) {
                const order =
                    documentSnapshot.data() || {};

                if (
                    order.status !== "cancelled" &&
                    order.status !== "refunded"
                ) {
                    revenue += toNumber(
                        order.total,
                        0
                    );
                }

                if (
                    order.status === "pending" ||
                    order.status === "confirmed" ||
                    order.status === "processing"
                ) {
                    pendingOrders += 1;
                }
            }
        );

        return {
            revenue: revenue,
            orderCount: snapshot.size,
            pendingOrders: pendingOrders
        };
    }

    async function loadProductMetrics() {
        const snapshot =
            await getProductsReference().get();

        let lowStockCount = 0;

        snapshot.docs.forEach(
            function (documentSnapshot) {
                const product =
                    documentSnapshot.data() || {};

                const inventory =
                    calculateProductInventory(product);

                if (
                    inventory <=
                        Admin.config.lowStockThreshold &&
                    product.active !== false
                ) {
                    lowStockCount += 1;
                }
            }
        );

        return {
            productCount: snapshot.size,
            lowStockCount: lowStockCount
        };
    }

    async function loadCustomerMetrics() {
        const snapshot =
            await getUsersReference()
                .where("role", "==", "customer")
                .get();

        return {
            customerCount: snapshot.size
        };
    }

    async function loadRecentOrders() {
        const snapshot =
            await getOrdersReference()
                .orderBy("createdAt", "desc")
                .limit(
                    Admin.config
                        .dashboardRecentOrdersLimit
                )
                .get();

        return snapshot.docs.map(
            normalizeOrderSnapshot
        );
    }

    async function loadTopProducts() {
        const snapshot =
            await getProductsReference()
                .orderBy("salesCount", "desc")
                .limit(
                    Admin.config
                        .dashboardTopProductsLimit
                )
                .get();

        return snapshot.docs.map(
            normalizeProductSnapshot
        );
    }

    async function loadLowStockProducts() {
        const snapshot =
            await getProductsReference()
                .where("active", "==", true)
                .limit(100)
                .get();

        return snapshot.docs
            .map(normalizeProductSnapshot)
            .filter(function (product) {
                return (
                    product.inventory <=
                    Admin.config.lowStockThreshold
                );
            })
            .sort(function (a, b) {
                return a.inventory - b.inventory;
            })
            .slice(
                0,
                Admin.config.dashboardLowStockLimit
            );
    }

    function renderDashboard() {
        const dashboard =
            Admin.state.dashboard;

        setElementsText(
            Admin.elements.revenueStat,
            formatPrice(dashboard.revenue)
        );

        setElementsText(
            Admin.elements.orderCountStat,
            String(dashboard.orderCount)
        );

        setElementsText(
            Admin.elements.customerCountStat,
            String(dashboard.customerCount)
        );

        setElementsText(
            Admin.elements.productCountStat,
            String(dashboard.productCount)
        );

        setElementsText(
            Admin.elements.pendingOrderStat,
            String(dashboard.pendingOrders)
        );

        setElementsText(
            Admin.elements.lowStockStat,
            String(dashboard.lowStockCount)
        );

        renderDashboardOrders(
            dashboard.recentOrders
        );

        renderTopProducts(
            dashboard.topProducts
        );

        renderLowStockProducts(
            dashboard.lowStockProducts
        );

        renderSalesChart(
            dashboard.recentOrders
        );
    }

    function setElementsText(elements, value) {
        elements.forEach(function (element) {
            element.textContent = value;
        });
    }

    function renderDashboardOrders(orders) {
        const container =
            Admin.elements.recentOrders;

        if (!container) {
            return;
        }

        container.innerHTML = orders
            .map(function (order) {
                return [
                    '<button type="button" class="admin-activity-item" data-admin-order-view="' +
                        escapeHTML(order.id) +
                        '">',

                    '<span class="admin-activity-icon">',
                    '<i class="fa-solid fa-bag-shopping"></i>',
                    "</span>",

                    '<span class="admin-activity-copy">',
                    "<strong>" +
                        escapeHTML(
                            order.orderNumber ||
                            order.id
                        ) +
                        "</strong>",

                    "<small>" +
                        escapeHTML(
                            getCustomerDisplayName(
                                order.customer
                            )
                        ) +
                        " · " +
                        escapeHTML(
                            formatDate(
                                order.createdAt
                            )
                        ) +
                        "</small>",
                    "</span>",

                    '<span class="admin-activity-value">' +
                        escapeHTML(
                            formatPrice(
                                order.total,
                                order.currency
                            )
                        ) +
                        "</span>",

                    "</button>"
                ].join("");
            })
            .join("");
    }

    function renderTopProducts(products) {
        const container =
            Admin.elements.topProducts;

        if (!container) {
            return;
        }

        container.innerHTML = products
            .map(function (product, index) {
                return [
                    '<article class="admin-top-product">',
                    '<span class="admin-product-rank">' +
                        escapeHTML(index + 1) +
                        "</span>",

                    '<img src="' +
                        escapeHTML(
                            product.primaryImage ||
                            "https://placehold.co/120x150?text=L%27ÉTERNEL"
                        ) +
                        '" alt="' +
                        escapeHTML(product.name) +
                        '">',

                    "<div>",
                    "<strong>" +
                        escapeHTML(product.name) +
                        "</strong>",

                    "<span>" +
                        escapeHTML(
                            product.salesCount
                        ) +
                        " sold</span>",
                    "</div>",

                    "<b>" +
                        escapeHTML(
                            formatPrice(
                                product.price,
                                product.currency
                            )
                        ) +
                        "</b>",
                    "</article>"
                ].join("");
            })
            .join("");
    }

    function renderLowStockProducts(products) {
        const container =
            Admin.elements.lowStockProducts;

        if (!container) {
            return;
        }

        container.innerHTML = products
            .map(function (product) {
                return [
                    '<button type="button" class="admin-low-stock-item" data-admin-product-edit="' +
                        escapeHTML(product.id) +
                        '">',

                    '<img src="' +
                        escapeHTML(
                            product.primaryImage ||
                            "https://placehold.co/100x125?text=L%27ÉTERNEL"
                        ) +
                        '" alt="' +
                        escapeHTML(product.name) +
                        '">',

                    "<span>",
                    "<strong>" +
                        escapeHTML(product.name) +
                        "</strong>",

                    "<small>" +
                        escapeHTML(
                            product.sku ||
                            product.category
                        ) +
                        "</small>",
                    "</span>",

                    '<b class="' +
                        (
                            product.inventory === 0
                                ? "out"
                                : "low"
                        ) +
                        '">' +
                        escapeHTML(
                            product.inventory
                        ) +
                        " left</b>",
                    "</button>"
                ].join("");
            })
            .join("");
    }

    function renderSalesChart(orders) {
        const container =
            Admin.elements.salesChart;

        if (!container) {
            return;
        }

        const dailySales = {};

        orders.forEach(function (order) {
            const date = toDate(order.createdAt);

            if (!date) {
                return;
            }

            const key = date.toISOString().slice(0, 10);

            dailySales[key] =
                (dailySales[key] || 0) +
                toNumber(order.total, 0);
        });

        const entries =
            Object.keys(dailySales)
                .sort()
                .slice(-7)
                .map(function (date) {
                    return {
                        date: date,
                        value: dailySales[date]
                    };
                });

        const maximum = Math.max(
            1,
            ...entries.map(function (entry) {
                return entry.value;
            })
        );

        container.innerHTML = entries.length
            ? entries
                  .map(function (entry) {
                      const percentage =
                          Math.max(
                              4,
                              (
                                  entry.value /
                                  maximum
                              ) * 100
                          );

                      return [
                          '<div class="admin-chart-column">',
                          '<span class="admin-chart-value">' +
                              escapeHTML(
                                  formatPrice(
                                      entry.value
                                  )
                              ) +
                              "</span>",

                          '<div class="admin-chart-track">',
                          '<div class="admin-chart-bar" style="height:' +
                              percentage +
                              '%"></div>',
                          "</div>",

                          '<span class="admin-chart-label">' +
                              escapeHTML(
                                  formatDate(
                                      entry.date,
                                      {
                                          weekday:
                                              "short"
                                      }
                                  )
                              ) +
                              "</span>",
                          "</div>"
                      ].join("");
                  })
                  .join("")
            : '<div class="admin-empty-state"><p>No sales data yet.</p></div>';
    }

    /* ======================================================
       PRODUCT NORMALIZATION
    ====================================================== */

    function normalizeProductSnapshot(snapshot) {
        const data =
            typeof snapshot.data === "function"
                ? snapshot.data() || {}
                : snapshot || {};

        const images =
            Array.isArray(data.images)
                ? data.images
                : [];

        const normalizedImages = images
            .map(function (image) {
                if (typeof image === "string") {
                    return {
                        url: image,
                        alt: data.name || ""
                    };
                }

                return {
                    url:
                        image.url ||
                        image.src ||
                        "",
                    alt:
                        image.alt ||
                        data.name ||
                        ""
                };
            })
            .filter(function (image) {
                return Boolean(image.url);
            });

        return {
            id:
                snapshot.id ||
                data.id ||
                "",

            name:
                data.name ||
                data.title ||
                "Untitled product",

            slug:
                data.slug ||
                slugify(
                    data.name ||
                    data.title
                ),

            description:
                data.description || "",

            shortDescription:
                data.shortDescription || "",

            category:
                data.category || "",

            categorySlug:
                data.categorySlug ||
                slugify(data.category),

            collection:
                data.collection || "",

            collectionSlug:
                data.collectionSlug ||
                slugify(data.collection),

            sku: data.sku || "",
            price: toNumber(data.price, 0),

            compareAtPrice: toNumber(
                data.compareAtPrice,
                0
            ),

            currency:
                data.currency ||
                Admin.config.defaultCurrency,

            images: normalizedImages,

            primaryImage:
                normalizedImages.length
                    ? normalizedImages[0].url
                    : "",

            variants:
                Array.isArray(data.variants)
                    ? data.variants
                    : [],

            sizes:
                Array.isArray(data.sizes)
                    ? data.sizes
                    : [],

            colors:
                Array.isArray(data.colors)
                    ? data.colors
                    : [],

            inventory:
                calculateProductInventory(data),

            active: data.active !== false,
            published:
                data.published !== false,

            featured: Boolean(data.featured),
            bestseller:
                Boolean(data.bestseller),

            newArrival:
                Boolean(
                    data.newArrival ||
                    data.isNew
                ),

            salesCount:
                toNumber(
                    data.salesCount,
                    0
                ),

            rating:
                toNumber(data.rating, 0),

            reviewCount:
                toNumber(
                    data.reviewCount,
                    0
                ),

            materials:
                data.materials || "",

            care: data.care || "",
            shipping: data.shipping || "",
            createdAt: data.createdAt || null,
            updatedAt: data.updatedAt || null
        };
    }

    function calculateProductInventory(product) {
        if (
            Array.isArray(product.variants) &&
            product.variants.length
        ) {
            return product.variants.reduce(
                function (total, variant) {
                    return (
                        total +
                        Math.max(
                            0,
                            toNumber(
                                variant.stock,
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
            toNumber(
                product.inventory,
                product.stock
            )
        );
    }

    /* ======================================================
       PRODUCT LIST
    ====================================================== */

    async function loadProducts(options) {
        const settings = options || {};

        if (!settings.append) {
            Admin.state.products = [];
            Admin.state.productLastSnapshot = null;
            Admin.state.productsComplete = false;
        }

        setLoading(true);

        try {
            let reference =
                getProductsReference();

            if (
                Admin.state.productStatus === "active"
            ) {
                reference = reference.where(
                    "active",
                    "==",
                    true
                );
            }

            if (
                Admin.state.productStatus === "inactive"
            ) {
                reference = reference.where(
                    "active",
                    "==",
                    false
                );
            }

            if (
                Admin.state.productCategory
            ) {
                reference = reference.where(
                    "categorySlug",
                    "==",
                    slugify(
                        Admin.state.productCategory
                    )
                );
            }

            reference =
                applyProductSort(reference);

            if (
                settings.append &&
                Admin.state.productLastSnapshot
            ) {
                reference = reference.startAfter(
                    Admin.state
                        .productLastSnapshot
                );
            }

            reference = reference.limit(
                Admin.config.productsPageSize
            );

            const snapshot =
                await reference.get();

            let products =
                snapshot.docs.map(
                    normalizeProductSnapshot
                );

            if (Admin.state.productSearch) {
                const search =
                    Admin.state.productSearch
                        .toLowerCase();

                products = products.filter(
                    function (product) {
                        return [
                            product.name,
                            product.sku,
                            product.category,
                            product.collection
                        ]
                            .join(" ")
                            .toLowerCase()
                            .includes(search);
                    }
                );
            }

            Admin.state.productLastSnapshot =
                snapshot.docs.length
                    ? snapshot.docs[
                          snapshot.docs.length - 1
                      ]
                    : Admin.state
                          .productLastSnapshot;

            Admin.state.productsComplete =
                snapshot.docs.length <
                Admin.config.productsPageSize;

            Admin.state.products =
                settings.append
                    ? Admin.state.products.concat(
                          products
                      )
                    : products;

            renderProducts();

            return Admin.state.products;
        } catch (error) {
            console.error(
                "[Admin] Products could not be loaded:",
                error
            );

            app.showToast({
                type: "error",
                title: "Products unavailable",
                message:
                    error.message ||
                    "The product catalogue could not be loaded."
            });

            return [];
        } finally {
            setLoading(false);
        }
    }

    function applyProductSort(reference) {
        switch (Admin.state.productSort) {
            case "oldest":
                return reference.orderBy(
                    "createdAt",
                    "asc"
                );

            case "price-low":
                return reference.orderBy(
                    "price",
                    "asc"
                );

            case "price-high":
                return reference.orderBy(
                    "price",
                    "desc"
                );

            case "name":
                return reference.orderBy(
                    "name",
                    "asc"
                );

            case "inventory":
                return reference.orderBy(
                    "inventory",
                    "asc"
                );

            case "newest":
            default:
                return reference.orderBy(
                    "createdAt",
                    "desc"
                );
        }
    }

    function renderProducts() {
        const table =
            Admin.elements.productsTable;

        if (!table) {
            return;
        }

        const body =
            table.tagName === "TBODY"
                ? table
                : query("tbody", table) ||
                  table;

        body.innerHTML =
            Admin.state.products
                .map(createProductRow)
                .join("");

        if (Admin.elements.productsEmpty) {
            Admin.elements.productsEmpty.hidden =
                Admin.state.products.length > 0;
        }

        if (Admin.elements.productsLoadMore) {
            Admin.elements.productsLoadMore.hidden =
                !Admin.state.products.length ||
                Admin.state.productsComplete;

            Admin.elements.productsLoadMore.disabled =
                Admin.state.productsComplete;
        }
    }

    function createProductRow(product) {
        const status = product.active
            ? product.published
                ? "Published"
                : "Draft"
            : "Inactive";

        const stockClass =
            product.inventory === 0
                ? "out-of-stock"
                : product.inventory <=
                    Admin.config.lowStockThreshold
                ? "low-stock"
                : "in-stock";

        return [
            '<tr data-admin-product-id="' +
                escapeHTML(product.id) +
                '">',

            "<td>",
            '<div class="admin-table-product">',
            '<img src="' +
                escapeHTML(
                    product.primaryImage ||
                    "https://placehold.co/120x150?text=L%27ÉTERNEL"
                ) +
                '" alt="' +
                escapeHTML(product.name) +
                '">',

            "<div>",
            "<strong>" +
                escapeHTML(product.name) +
                "</strong>",

            "<span>" +
                escapeHTML(
                    product.sku ||
                    product.id
                ) +
                "</span>",
            "</div>",
            "</div>",
            "</td>",

            "<td>" +
                escapeHTML(
                    product.category || "—"
                ) +
                "</td>",

            "<td>" +
                escapeHTML(
                    formatPrice(
                        product.price,
                        product.currency
                    )
                ) +
                "</td>",

            '<td><span class="inventory-status ' +
                stockClass +
                '">' +
                escapeHTML(product.inventory) +
                "</span></td>",

            '<td><span class="admin-status-badge ' +
                status.toLowerCase() +
                '">' +
                escapeHTML(status) +
                "</span></td>",

            "<td>" +
                escapeHTML(
                    formatDate(
                        product.updatedAt ||
                        product.createdAt
                    )
                ) +
                "</td>",

            '<td class="admin-table-actions">',

            '<button type="button" data-admin-product-edit="' +
                escapeHTML(product.id) +
                '" aria-label="Edit ' +
                escapeHTML(product.name) +
                '">',

            '<i class="fa-regular fa-pen-to-square"></i>',
            "</button>",

            '<button type="button" data-admin-product-toggle="' +
                escapeHTML(product.id) +
                '" aria-label="' +
                (
                    product.active
                        ? "Deactivate"
                        : "Activate"
                ) +
                " " +
                escapeHTML(product.name) +
                '">',

            '<i class="fa-solid ' +
                (
                    product.active
                        ? "fa-eye-slash"
                        : "fa-eye"
                ) +
                '"></i>',
            "</button>",

            '<button type="button" class="danger" data-admin-product-delete="' +
                escapeHTML(product.id) +
                '" aria-label="Delete ' +
                escapeHTML(product.name) +
                '">',

            '<i class="fa-regular fa-trash-can"></i>',
            "</button>",

            "</td>",
            "</tr>"
        ].join("");
    }

    /* ======================================================
       PRODUCT FORM
    ====================================================== */

    function resetProductForm() {
        const form =
            Admin.elements.productForm;

        if (form) {
            form.reset();
            form.dataset.productId = "";
        }

        Admin.state.editingProduct = null;
        Admin.state.uploadedImages = [];
        Admin.state.pendingImageFiles = [];

        if (Admin.elements.variantContainer) {
            Admin.elements.variantContainer.innerHTML = "";
        }

        if (Admin.elements.productFormTitle) {
            Admin.elements.productFormTitle.textContent =
                "Add product";
        }

        if (Admin.elements.productDeleteButton) {
            Admin.elements.productDeleteButton.hidden =
                true;
        }

        renderImagePreview();
    }

    async function openProductEditor(productId) {
        resetProductForm();

        if (!productId) {
            activateSection("product-form");
            addVariantRow();
            return null;
        }

        setLoading(true);

        try {
            const snapshot =
                await getProductsReference()
                    .doc(productId)
                    .get();

            if (!snapshot.exists) {
                throw new Error(
                    "The selected product could not be found."
                );
            }

            const product =
                normalizeProductSnapshot(
                    snapshot
                );

            Admin.state.editingProduct =
                product;

            Admin.state.uploadedImages =
                product.images.slice();

            populateProductForm(product);
            renderImagePreview();
            renderVariantRows(
                product.variants
            );

            activateSection("product-form");

            return product;
        } finally {
            setLoading(false);
        }
    }

    function populateProductForm(product) {
        const form =
            Admin.elements.productForm;

        if (!form) {
            return;
        }

        form.dataset.productId =
            product.id;

        const values = {
            name: product.name,
            slug: product.slug,
            sku: product.sku,
            category: product.category,
            collection: product.collection,
            price: product.price,
            compareAtPrice:
                product.compareAtPrice,
            currency: product.currency,
            description:
                product.description,
            shortDescription:
                product.shortDescription,
            materials:
                product.materials,
            care: product.care,
            shipping: product.shipping
        };

        Object.keys(values).forEach(
            function (name) {
                if (form.elements[name]) {
                    form.elements[name].value =
                        values[name] === undefined ||
                        values[name] === null
                            ? ""
                            : values[name];
                }
            }
        );

        [
            "active",
            "published",
            "featured",
            "bestseller",
            "newArrival"
        ].forEach(function (name) {
            if (form.elements[name]) {
                form.elements[name].checked =
                    Boolean(product[name]);
            }
        });

        if (Admin.elements.productFormTitle) {
            Admin.elements.productFormTitle.textContent =
                "Edit " + product.name;
        }

        if (Admin.elements.productDeleteButton) {
            Admin.elements.productDeleteButton.hidden =
                false;
        }
    }

    function collectProductForm() {
        const form =
            Admin.elements.productForm;

        if (!form) {
            throw new Error(
                "The product form could not be found."
            );
        }

        const name =
            getFormValue(form, "name");

        const price =
            toNumber(
                getFormValue(form, "price"),
                0
            );

        if (!name) {
            throw new Error(
                "Enter a product name."
            );
        }

        if (price < 0) {
            throw new Error(
                "Enter a valid product price."
            );
        }

        const category =
            getFormValue(form, "category");

        const collection =
            getFormValue(form, "collection");

        const variants =
            collectVariantRows();

        const sizes =
            uniqueValues(
                variants.map(function (variant) {
                    return variant.size;
                })
            );

        const colors =
            uniqueValues(
                variants.map(function (variant) {
                    return variant.color;
                })
            );

        const inventory =
            variants.length
                ? variants.reduce(
                      function (total, variant) {
                          return (
                              total +
                              variant.stock
                          );
                      },
                      0
                  )
                : Math.max(
                      0,
                      toNumber(
                          getFormValue(
                              form,
                              "inventory"
                          ),
                          0
                      )
                  );

        return {
            name: name,

            slug:
                getFormValue(form, "slug") ||
                slugify(name),

            sku:
                getFormValue(form, "sku"),

            category: category,

            categorySlug:
                slugify(category),

            collection: collection,

            collectionSlug:
                slugify(collection),

            price: price,

            compareAtPrice:
                toNumber(
                    getFormValue(
                        form,
                        "compareAtPrice"
                    ),
                    0
                ),

            currency:
                getFormValue(
                    form,
                    "currency"
                ) ||
                Admin.config.defaultCurrency,

            description:
                getFormValue(
                    form,
                    "description"
                ),

            shortDescription:
                getFormValue(
                    form,
                    "shortDescription"
                ),

            materials:
                getFormValue(
                    form,
                    "materials"
                ),

            care:
                getFormValue(form, "care"),

            shipping:
                getFormValue(
                    form,
                    "shipping"
                ),

            active:
                !form.elements.active ||
                form.elements.active.checked,

            published:
                !form.elements.published ||
                form.elements.published.checked,

            featured:
                Boolean(
                    form.elements.featured &&
                    form.elements.featured.checked
                ),

            bestseller:
                Boolean(
                    form.elements.bestseller &&
                    form.elements.bestseller.checked
                ),

            newArrival:
                Boolean(
                    form.elements.newArrival &&
                    form.elements.newArrival.checked
                ),

            variants: variants,
            sizes: sizes,
            colors: colors,
            inventory: inventory,
            inStock: inventory > 0
        };
    }

    async function saveProduct() {
        if (!(await requireAdmin())) {
            return null;
        }

        const productData =
            collectProductForm();

        setProductSaving(true);

        try {
            const productId =
                Admin.state.editingProduct
                    ? Admin.state.editingProduct.id
                    : getProductsReference().doc().id;

            const uploadedImages =
                await uploadPendingImages(
                    productId
                );

            productData.images =
                Admin.state.uploadedImages.concat(
                    uploadedImages
                );

            if (!productData.images.length) {
                throw new Error(
                    "Upload at least one product image."
                );
            }

            productData.updatedAt =
                serverTimestamp();

            if (!Admin.state.editingProduct) {
                productData.createdAt =
                    serverTimestamp();

                productData.salesCount = 0;
                productData.rating = 0;
                productData.reviewCount = 0;
            }

            await getProductsReference()
                .doc(productId)
                .set(
                    productData,
                    {
                        merge: true
                    }
                );

            Admin.state.pendingImageFiles = [];
            Admin.state.uploadedImages =
                productData.images;

            app.showToast({
                type: "success",
                title:
                    Admin.state.editingProduct
                        ? "Product updated"
                        : "Product created",

                message:
                    productData.name +
                    " has been saved successfully."
            });

            await loadProducts();

            if (router) {
                await router.navigate(
                    "/admin/products"
                );
            } else {
                activateSection("products");
            }

            return Object.assign(
                {
                    id: productId
                },
                productData
            );
        } catch (error) {
            console.error(
                "[Admin] Product could not be saved:",
                error
            );

            app.showToast({
                type: "error",
                title: "Unable to save product",
                message:
                    error.message ||
                    "The product could not be saved."
            });

            return null;
        } finally {
            setProductSaving(false);
        }
    }

    function setProductSaving(saving) {
        const button =
            Admin.elements.productSaveButton;

        if (!button) {
            return;
        }

        if (
            saving &&
            !button.dataset.originalLabel
        ) {
            button.dataset.originalLabel =
                button.textContent.trim();
        }

        button.disabled = saving;
        button.classList.toggle(
            "loading",
            saving
        );

        button.setAttribute(
            "aria-busy",
            String(saving)
        );

        const label =
            query(
                "[data-button-label]",
                button
            );

        if (label) {
            label.textContent = saving
                ? "Saving product…"
                : button.dataset.originalLabel ||
                  "Save product";
        }
    }

    async function toggleProductStatus(productId) {
        const snapshot =
            await getProductsReference()
                .doc(productId)
                .get();

        if (!snapshot.exists) {
            throw new Error(
                "The selected product could not be found."
            );
        }

        const product =
            snapshot.data() || {};

        const active =
            product.active === false;

        await snapshot.ref.set(
            {
                active: active,
                updatedAt: serverTimestamp()
            },
            {
                merge: true
            }
        );

        app.showToast({
            type: "success",
            title:
                active
                    ? "Product activated"
                    : "Product deactivated",

            message:
                (
                    product.name ||
                    "The product"
                ) +
                (
                    active
                        ? " is now available."
                        : " has been hidden from the store."
                )
        });

        await loadProducts();
    }

    async function deleteProduct(productId) {
        const snapshot =
            await getProductsReference()
                .doc(productId)
                .get();

        if (!snapshot.exists) {
            return false;
        }

        const product =
            normalizeProductSnapshot(
                snapshot
            );

        await snapshot.ref.delete();

        await Promise.all(
            product.images.map(
                function (image) {
                    return deleteStorageImage(
                        image.url
                    );
                }
            )
        );

        app.showToast({
            type: "success",
            title: "Product deleted",
            message:
                product.name +
                " has been permanently deleted."
        });

        await loadProducts();

        return true;
    }

    /* ======================================================
       PRODUCT IMAGES
    ====================================================== */

    function validateImageFile(file) {
        if (
            Admin.config.acceptedImageTypes.indexOf(
                file.type
            ) === -1
        ) {
            throw new Error(
                file.name +
                " must be a JPEG, PNG, or WebP image."
            );
        }

        if (
            file.size >
            Admin.config.maximumImageSize
        ) {
            throw new Error(
                file.name +
                " must be smaller than 8 MB."
            );
        }

        return true;
    }

    function addPendingImageFiles(files) {
        const selectedFiles =
            Array.prototype.slice.call(files || []);

        selectedFiles.forEach(
            validateImageFile
        );

        const totalImages =
            Admin.state.uploadedImages.length +
            Admin.state.pendingImageFiles.length +
            selectedFiles.length;

        if (
            totalImages >
            Admin.config.maximumProductImages
        ) {
            throw new Error(
                "A product can contain no more than " +
                Admin.config.maximumProductImages +
                " images."
            );
        }

        Admin.state.pendingImageFiles =
            Admin.state.pendingImageFiles.concat(
                selectedFiles
            );

        renderImagePreview();
    }

    function renderImagePreview() {
        const container =
            Admin.elements.productImagePreview;

        if (!container) {
            return;
        }

        const uploadedHTML =
            Admin.state.uploadedImages
                .map(function (image, index) {
                    return [
                        '<article class="admin-upload-preview" data-uploaded-image-index="' +
                            index +
                            '">',

                        '<img src="' +
                            escapeHTML(image.url) +
                            '" alt="' +
                            escapeHTML(
                                image.alt ||
                                "Product image"
                            ) +
                            '">',

                        index === 0
                            ? '<span class="primary-image-badge">Primary</span>'
                            : "",

                        '<button type="button" data-admin-image-remove-uploaded="' +
                            index +
                            '" aria-label="Remove image">',

                        '<i class="fa-solid fa-xmark"></i>',
                        "</button>",

                        "</article>"
                    ].join("");
                })
                .join("");

        const pendingHTML =
            Admin.state.pendingImageFiles
                .map(function (file, index) {
                    const url =
                        URL.createObjectURL(file);

                    return [
                        '<article class="admin-upload-preview pending" data-pending-image-index="' +
                            index +
                            '">',

                        '<img src="' +
                            escapeHTML(url) +
                            '" alt="' +
                            escapeHTML(file.name) +
                            '">',

                        '<span class="upload-pending-badge">Pending</span>',

                        '<button type="button" data-admin-image-remove-pending="' +
                            index +
                            '" aria-label="Remove image">',

                        '<i class="fa-solid fa-xmark"></i>',
                        "</button>",

                        "</article>"
                    ].join("");
                })
                .join("");

        container.innerHTML =
            uploadedHTML + pendingHTML;
    }

    async function uploadPendingImages(productId) {
        if (!Admin.state.pendingImageFiles.length) {
            return [];
        }

        const uploaded = [];

        for (
            let index = 0;
            index <
            Admin.state.pendingImageFiles.length;
            index += 1
        ) {
            const file =
                Admin.state.pendingImageFiles[index];

            const image =
                await uploadProductImage(
                    productId,
                    file,
                    index
                );

            uploaded.push(image);
        }

        return uploaded;
    }

    async function uploadProductImage(
        productId,
        file,
        index
    ) {
        validateImageFile(file);

        const path =
            createStoragePath(
                Admin.config.productImagesFolder,
                productId,
                generateStorageFileName(file.name)
            );

        const reference =
            storage.ref().child(path);

        const task =
            reference.put(file, {
                contentType: file.type,
                customMetadata: {
                    productId: productId,
                    uploadedBy:
                        Admin.state.user
                            ? Admin.state.user.uid
                            : "",
                    imageIndex: String(index)
                }
            });

        const snapshot =
            await observeUploadTask(
                task,
                file.name
            );

        const url =
            await snapshot.ref.getDownloadURL();

        return {
            url: url,
            path: path,
            alt:
                Admin.elements.productForm
                    ? getFormValue(
                          Admin.elements
                              .productForm,
                          "name"
                      )
                    : ""
        };
    }

    function observeUploadTask(task, fileName) {
        return new Promise(function (resolve, reject) {
            task.on(
                "state_changed",

                function (snapshot) {
                    const progress =
                        snapshot.totalBytes
                            ? (
                                  snapshot.bytesTransferred /
                                  snapshot.totalBytes
                              ) * 100
                            : 0;

                    document.dispatchEvent(
                        new CustomEvent(
                            "admin:imageuploadprogress",
                            {
                                detail: {
                                    fileName:
                                        fileName,
                                    progress:
                                        progress
                                }
                            }
                        )
                    );
                },

                reject,

                function () {
                    resolve(task.snapshot);
                }
            );
        });
    }

    async function deleteStorageImage(urlOrPath) {
        if (!urlOrPath) {
            return false;
        }

        try {
            const reference =
                urlOrPath.startsWith("http")
                    ? storage.refFromURL(
                          urlOrPath
                      )
                    : storage.ref().child(
                          urlOrPath
                      );

            await reference.delete();

            return true;
        } catch (error) {
            console.warn(
                "[Admin] Storage image could not be deleted:",
                error
            );

            return false;
        }
    }

    /* ======================================================
       VARIANTS
    ====================================================== */

    function renderVariantRows(variants) {
        const container =
            Admin.elements.variantContainer;

        if (!container) {
            return;
        }

        container.innerHTML = "";

        const items =
            Array.isArray(variants) &&
            variants.length
                ? variants
                : [{}];

        items.forEach(function (variant) {
            addVariantRow(variant);
        });
    }

    function addVariantRow(variant) {
        const container =
            Admin.elements.variantContainer;

        if (!container) {
            return;
        }

        const value = variant || {};

        const row =
            document.createElement("div");

        row.className =
            "admin-variant-row";

        row.dataset.variantId =
            value.id ||
            createVariantId(value);

        row.innerHTML = [
            '<div class="admin-form-group">',
            "<label>Size</label>",
            '<input type="text" data-variant-size value="' +
                escapeHTML(
                    value.size || ""
                ) +
                '" placeholder="M">',
            "</div>",

            '<div class="admin-form-group">',
            "<label>Colour</label>",
            '<input type="text" data-variant-color value="' +
                escapeHTML(
                    value.color || ""
                ) +
                '" placeholder="Black">',
            "</div>",

            '<div class="admin-form-group">',
            "<label>Colour hex</label>",
            '<input type="text" data-variant-color-hex value="' +
                escapeHTML(
                    value.colorHex ||
                    value.hex ||
                    ""
                ) +
                '" placeholder="#111111">',
            "</div>",

            '<div class="admin-form-group">',
            "<label>SKU</label>",
            '<input type="text" data-variant-sku value="' +
                escapeHTML(
                    value.sku || ""
                ) +
                '" placeholder="LET-001-M-BLK">',
            "</div>",

            '<div class="admin-form-group">',
            "<label>Stock</label>",
            '<input type="number" min="0" data-variant-stock value="' +
                escapeHTML(
                    toNumber(
                        value.stock,
                        0
                    )
                ) +
                '">',
            "</div>",

            '<div class="admin-form-group">',
            "<label>Price override</label>",
            '<input type="number" min="0" data-variant-price value="' +
                escapeHTML(
                    value.price === undefined ||
                    value.price === null
                        ? ""
                        : value.price
                ) +
                '">',
            "</div>",

            '<button type="button" class="admin-variant-remove" data-admin-variant-remove aria-label="Remove variant">',
            '<i class="fa-solid fa-xmark"></i>',
            "</button>"
        ].join("");

        container.appendChild(row);
    }

    function createVariantId(variant) {
        return [
            slugify(variant.size || "default"),
            slugify(variant.color || "default"),
            Math.random()
                .toString(36)
                .slice(2, 7)
        ].join("-");
    }

    function collectVariantRows() {
        const container =
            Admin.elements.variantContainer;

        if (!container) {
            return [];
        }

        return queryAll(
            ".admin-variant-row",
            container
        )
            .map(function (row) {
                const size =
                    getVariantValue(
                        row,
                        "[data-variant-size]"
                    );

                const color =
                    getVariantValue(
                        row,
                        "[data-variant-color]"
                    );

                const stock =
                    Math.max(
                        0,
                        toNumber(
                            getVariantValue(
                                row,
                                "[data-variant-stock]"
                            ),
                            0
                        )
                    );

                const priceValue =
                    getVariantValue(
                        row,
                        "[data-variant-price]"
                    );

                return {
                    id:
                        row.dataset.variantId ||
                        createVariantId({
                            size: size,
                            color: color
                        }),

                    size: size,
                    color: color,

                    colorHex:
                        getVariantValue(
                            row,
                            "[data-variant-color-hex]"
                        ),

                    sku:
                        getVariantValue(
                            row,
                            "[data-variant-sku]"
                        ),

                    stock: stock,

                    price:
                        priceValue === ""
                            ? null
                            : Math.max(
                                  0,
                                  toNumber(
                                      priceValue,
                                      0
                                  )
                              ),

                    active: true
                };
            })
            .filter(function (variant) {
                return Boolean(
                    variant.size ||
                    variant.color ||
                    variant.sku ||
                    variant.stock ||
                    variant.price !== null
                );
            });
    }

    function getVariantValue(row, selector) {
        const field = query(selector, row);

        return field
            ? String(field.value || "").trim()
            : "";
    }

    /* ======================================================
       ORDERS
    ====================================================== */

    function normalizeOrderSnapshot(snapshot) {
        const data =
            typeof snapshot.data === "function"
                ? snapshot.data() || {}
                : snapshot || {};

        return Object.assign(
            {
                id:
                    snapshot.id ||
                    data.id ||
                    ""
            },
            data
        );
    }

    async function loadOrders(options) {
        const settings = options || {};

        if (!settings.append) {
            Admin.state.orders = [];
            Admin.state.orderLastSnapshot = null;
            Admin.state.ordersComplete = false;
        }

        setLoading(true);

        try {
            let reference =
                getOrdersReference()
                    .orderBy(
                        "createdAt",
                        "desc"
                    );

            if (
                Admin.state.orderStatus !==
                "all"
            ) {
                reference = reference.where(
                    "status",
                    "==",
                    Admin.state.orderStatus
                );
            }

            if (
                settings.append &&
                Admin.state.orderLastSnapshot
            ) {
                reference = reference.startAfter(
                    Admin.state
                        .orderLastSnapshot
                );
            }

            reference = reference.limit(
                Admin.config.ordersPageSize
            );

            const snapshot =
                await reference.get();

            let orders =
                snapshot.docs.map(
                    normalizeOrderSnapshot
                );

            if (Admin.state.orderSearch) {
                const search =
                    Admin.state.orderSearch
                        .toLowerCase();

                orders = orders.filter(
                    function (order) {
                        return [
                            order.orderNumber,
                            order.id,
                            order.customer &&
                                order.customer.email,
                            getCustomerDisplayName(
                                order.customer
                            )
                        ]
                            .join(" ")
                            .toLowerCase()
                            .includes(search);
                    }
                );
            }

            Admin.state.orderLastSnapshot =
                snapshot.docs.length
                    ? snapshot.docs[
                          snapshot.docs.length - 1
                      ]
                    : Admin.state
                          .orderLastSnapshot;

            Admin.state.ordersComplete =
                snapshot.docs.length <
                Admin.config.ordersPageSize;

            Admin.state.orders =
                settings.append
                    ? Admin.state.orders.concat(
                          orders
                      )
                    : orders;

            renderOrders();

            return Admin.state.orders;
        } catch (error) {
            console.error(
                "[Admin] Orders could not be loaded:",
                error
            );

            app.showToast({
                type: "error",
                title: "Orders unavailable",
                message:
                    error.message ||
                    "Orders could not be loaded."
            });

            return [];
        } finally {
            setLoading(false);
        }
    }

    function renderOrders() {
        const table =
            Admin.elements.ordersTable;

        if (!table) {
            return;
        }

        const body =
            table.tagName === "TBODY"
                ? table
                : query("tbody", table) ||
                  table;

        body.innerHTML =
            Admin.state.orders
                .map(createOrderRow)
                .join("");

        if (Admin.elements.ordersEmpty) {
            Admin.elements.ordersEmpty.hidden =
                Admin.state.orders.length > 0;
        }

        if (Admin.elements.ordersLoadMore) {
            Admin.elements.ordersLoadMore.hidden =
                !Admin.state.orders.length ||
                Admin.state.ordersComplete;
        }
    }

    function createOrderRow(order) {
        return [
            '<tr data-admin-order-id="' +
                escapeHTML(order.id) +
                '">',

            '<td><button type="button" class="admin-order-link" data-admin-order-view="' +
                escapeHTML(order.id) +
                '">' +
                escapeHTML(
                    order.orderNumber ||
                    order.id
                ) +
                "</button></td>",

            "<td>",
            "<strong>" +
                escapeHTML(
                    getCustomerDisplayName(
                        order.customer
                    )
                ) +
                "</strong>",
            "<span>" +
                escapeHTML(
                    order.customer &&
                    order.customer.email
                        ? order.customer.email
                        : ""
                ) +
                "</span>",
            "</td>",

            "<td>" +
                escapeHTML(
                    formatDate(order.createdAt)
                ) +
                "</td>",

            "<td>" +
                escapeHTML(
                    order.itemCount ||
                    (
                        Array.isArray(order.items)
                            ? order.items.length
                            : 0
                    )
                ) +
                "</td>",

            "<td>" +
                escapeHTML(
                    formatPrice(
                        order.total,
                        order.currency
                    )
                ) +
                "</td>",

            '<td><span class="admin-status-badge ' +
                escapeHTML(
                    getStatusClass(
                        order.paymentStatus ||
                        (
                            order.payment &&
                            order.payment.status
                        )
                    )
                ) +
                '">' +
                escapeHTML(
                    formatPaymentStatus(
                        order.paymentStatus ||
                        (
                            order.payment &&
                            order.payment.status
                        )
                    )
                ) +
                "</span></td>",

            '<td><select data-admin-order-status="' +
                escapeHTML(order.id) +
                '">',

            createStatusOptions(
                order.status
            ),

            "</select></td>",

            '<td class="admin-table-actions">',
            '<button type="button" data-admin-order-view="' +
                escapeHTML(order.id) +
                '" aria-label="View order">',

            '<i class="fa-regular fa-eye"></i>',
            "</button>",
            "</td>",
            "</tr>"
        ].join("");
    }

    function createStatusOptions(selectedStatus) {
        return [
            "pending",
            "confirmed",
            "processing",
            "shipped",
            "delivered",
            "cancelled",
            "refunded"
        ]
            .map(function (status) {
                return (
                    '<option value="' +
                    status +
                    '"' +
                    (
                        status === selectedStatus
                            ? " selected"
                            : ""
                    ) +
                    ">" +
                    formatOrderStatus(status) +
                    "</option>"
                );
            })
            .join("");
    }

    function formatOrderStatus(status) {
        const labels = {
            pending: "Pending",
            confirmed: "Confirmed",
            processing: "Processing",
            shipped: "Shipped",
            delivered: "Delivered",
            cancelled: "Cancelled",
            refunded: "Refunded"
        };

        return (
            labels[status] ||
            String(status || "Pending")
        );
    }

    function formatPaymentStatus(status) {
        const labels = {
            paid: "Paid",
            successful: "Paid",
            pending: "Pending",
            "awaiting-payment":
                "Awaiting payment",
            failed: "Failed",
            declined: "Declined",
            refunded: "Refunded"
        };

        return (
            labels[status] ||
            String(status || "Pending")
        );
    }

    function getStatusClass(status) {
        return String(
            status || "pending"
        )
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-");
    }

    async function updateOrderStatus(
        orderId,
        status
    ) {
        await getOrdersReference()
            .doc(orderId)
            .set(
                {
                    status: status,
                    updatedAt: serverTimestamp(),
                    statusHistory:
                        firebase.firestore.FieldValue.arrayUnion(
                            {
                                status: status,
                                changedBy:
                                    Admin.state.user
                                        ? Admin.state.user.uid
                                        : "",
                                changedAt:
                                    new Date().toISOString()
                            }
                        )
                },
                {
                    merge: true
                }
            );

        app.showToast({
            type: "success",
            title: "Order updated",
            message:
                "The order status is now " +
                formatOrderStatus(status) +
                "."
        });

        await loadOrders();
    }

    async function openOrderDetail(orderId) {
        let order =
            Admin.state.orders.find(
                function (item) {
                    return item.id === orderId;
                }
            );

        if (!order) {
            const snapshot =
                await getOrdersReference()
                    .doc(orderId)
                    .get();

            if (!snapshot.exists) {
                throw new Error(
                    "The selected order could not be found."
                );
            }

            order =
                normalizeOrderSnapshot(
                    snapshot
                );
        }

        renderOrderDetail(order);
        activateSection("order-detail");

        return order;
    }

    function renderOrderDetail(order) {
        const container =
            Admin.elements.orderDetail;

        if (!container) {
            return;
        }

        const items =
            Array.isArray(order.items)
                ? order.items
                : [];

        container.innerHTML = [
            '<div class="admin-order-detail-header">',
            "<div>",
            "<span>Order</span>",
            "<h2>" +
                escapeHTML(
                    order.orderNumber ||
                    order.id
                ) +
                "</h2>",
            "<p>" +
                escapeHTML(
                    formatDate(
                        order.createdAt,
                        {
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit"
                        }
                    )
                ) +
                "</p>",
            "</div>",

            '<select data-admin-order-status="' +
                escapeHTML(order.id) +
                '">' +
                createStatusOptions(
                    order.status
                ) +
                "</select>",
            "</div>",

            '<div class="admin-detail-grid">',

            '<section class="admin-card">',
            "<h3>Customer</h3>",
            "<strong>" +
                escapeHTML(
                    getCustomerDisplayName(
                        order.customer
                    )
                ) +
                "</strong>",
            "<p>" +
                escapeHTML(
                    order.customer &&
                    order.customer.email
                        ? order.customer.email
                        : ""
                ) +
                "</p>",
            "<p>" +
                escapeHTML(
                    order.customer &&
                    order.customer.phone
                        ? order.customer.phone
                        : ""
                ) +
                "</p>",
            "</section>",

            '<section class="admin-card">',
            "<h3>Delivery address</h3>",
            formatAddressHTML(
                order.shippingAddress
            ),
            "</section>",

            '<section class="admin-card">',
            "<h3>Payment</h3>",
            "<p>Method: " +
                escapeHTML(
                    order.payment &&
                    order.payment.method
                        ? order.payment.method
                        : "—"
                ) +
                "</p>",
            "<p>Status: " +
                escapeHTML(
                    formatPaymentStatus(
                        order.paymentStatus ||
                        (
                            order.payment &&
                            order.payment.status
                        )
                    )
                ) +
                "</p>",
            "<p>Reference: " +
                escapeHTML(
                    order.payment &&
                    order.payment.reference
                        ? order.payment.reference
                        : "—"
                ) +
                "</p>",
            "</section>",
            "</div>",

            '<section class="admin-card">',
            "<h3>Items</h3>",
            '<div class="admin-order-items">',
            items
                .map(function (item) {
                    return [
                        '<article class="admin-order-item">',
                        '<img src="' +
                            escapeHTML(
                                item.image ||
                                "https://placehold.co/150x190?text=L%27ÉTERNEL"
                            ) +
                            '" alt="' +
                            escapeHTML(item.name) +
                            '">',

                        "<div>",
                        "<strong>" +
                            escapeHTML(item.name) +
                            "</strong>",
                        "<span>" +
                            escapeHTML(
                                [
                                    item.size
                                        ? "Size " +
                                          item.size
                                        : "",
                                    item.color || "",
                                    "Qty " +
                                        item.quantity
                                ]
                                    .filter(Boolean)
                                    .join(" · ")
                            ) +
                            "</span>",
                        "</div>",

                        "<b>" +
                            escapeHTML(
                                formatPrice(
                                    item.lineTotal ||
                                    item.price *
                                        item.quantity,
                                    item.currency ||
                                    order.currency
                                )
                            ) +
                            "</b>",
                        "</article>"
                    ].join("");
                })
                .join(""),
            "</div>",

            '<div class="admin-order-totals">',
            createTotalRow(
                "Subtotal",
                order.subtotal,
                order.currency
            ),
            createTotalRow(
                "Delivery",
                order.shipping,
                order.currency
            ),
            order.discount
                ? createTotalRow(
                      "Discount",
                      -order.discount,
                      order.currency
                  )
                : "",
            createTotalRow(
                "Total",
                order.total,
                order.currency,
                true
            ),
            "</div>",
            "</section>"
        ].join("");
    }

    function createTotalRow(
        label,
        value,
        currency,
        total
    ) {
        return (
            '<div class="admin-order-total-row' +
            (total ? " total" : "") +
            '">' +
            "<span>" +
            escapeHTML(label) +
            "</span>" +
            "<strong>" +
            escapeHTML(
                formatPrice(
                    value,
                    currency
                )
            ) +
            "</strong>" +
            "</div>"
        );
    }

    /* ======================================================
       CUSTOMERS
    ====================================================== */

    async function loadCustomers(options) {
        const settings = options || {};

        if (!settings.append) {
            Admin.state.customers = [];
            Admin.state.customerLastSnapshot = null;
            Admin.state.customersComplete = false;
        }

        setLoading(true);

        try {
            let reference =
                getUsersReference()
                    .orderBy(
                        "createdAt",
                        "desc"
                    );

            if (
                Admin.state.customerStatus !==
                "all"
            ) {
                reference = reference.where(
                    "status",
                    "==",
                    Admin.state.customerStatus
                );
            }

            if (
                settings.append &&
                Admin.state.customerLastSnapshot
            ) {
                reference = reference.startAfter(
                    Admin.state
                        .customerLastSnapshot
                );
            }

            reference = reference.limit(
                Admin.config.customersPageSize
            );

            const snapshot =
                await reference.get();

            let customers =
                snapshot.docs.map(
                    function (documentSnapshot) {
                        return Object.assign(
                            {
                                id:
                                    documentSnapshot.id
                            },
                            documentSnapshot.data()
                        );
                    }
                );

            customers = customers.filter(
                function (customer) {
                    return (
                        customer.role !== "admin" &&
                        customer.role !==
                            "superadmin"
                    );
                }
            );

            if (Admin.state.customerSearch) {
                const search =
                    Admin.state.customerSearch
                        .toLowerCase();

                customers = customers.filter(
                    function (customer) {
                        return [
                            customer.displayName,
                            customer.email,
                            customer.phoneNumber
                        ]
                            .join(" ")
                            .toLowerCase()
                            .includes(search);
                    }
                );
            }

            Admin.state.customerLastSnapshot =
                snapshot.docs.length
                    ? snapshot.docs[
                          snapshot.docs.length - 1
                      ]
                    : Admin.state
                          .customerLastSnapshot;

            Admin.state.customersComplete =
                snapshot.docs.length <
                Admin.config.customersPageSize;

            Admin.state.customers =
                settings.append
                    ? Admin.state.customers.concat(
                          customers
                      )
                    : customers;

            renderCustomers();

            return Admin.state.customers;
        } catch (error) {
            console.error(
                "[Admin] Customers could not be loaded:",
                error
            );

            app.showToast({
                type: "error",
                title: "Customers unavailable",
                message:
                    error.message ||
                    "Customer accounts could not be loaded."
            });

            return [];
        } finally {
            setLoading(false);
        }
    }

    function renderCustomers() {
        const table =
            Admin.elements.customersTable;

        if (!table) {
            return;
        }

        const body =
            table.tagName === "TBODY"
                ? table
                : query("tbody", table) ||
                  table;

        body.innerHTML =
            Admin.state.customers
                .map(createCustomerRow)
                .join("");

        if (Admin.elements.customersEmpty) {
            Admin.elements.customersEmpty.hidden =
                Admin.state.customers.length > 0;
        }

        if (Admin.elements.customersLoadMore) {
            Admin.elements.customersLoadMore.hidden =
                !Admin.state.customers.length ||
                Admin.state.customersComplete;
        }
    }

    function createCustomerRow(customer) {
        const name =
            customer.displayName ||
            customer.email ||
            "Customer";

        const status =
            customer.status || "active";

        return [
            '<tr data-admin-customer-id="' +
                escapeHTML(customer.id) +
                '">',

            "<td>",
            '<div class="admin-customer-cell">',
            customer.photoURL
                ? '<img src="' +
                  escapeHTML(
                      customer.photoURL
                  ) +
                  '" alt="' +
                  escapeHTML(name) +
                  '">'
                : '<span class="admin-customer-avatar">' +
                  escapeHTML(
                      getInitials(name)
                  ) +
                  "</span>",

            "<div>",
            "<strong>" +
                escapeHTML(name) +
                "</strong>",
            "<span>" +
                escapeHTML(
                    customer.email || ""
                ) +
                "</span>",
            "</div>",
            "</div>",
            "</td>",

            "<td>" +
                escapeHTML(
                    customer.orderCount || 0
                ) +
                "</td>",

            "<td>" +
                escapeHTML(
                    formatPrice(
                        customer.lifetimeValue ||
                        0
                    )
                ) +
                "</td>",

            "<td>" +
                escapeHTML(
                    formatDate(
                        customer.lastOrderAt ||
                        customer.lastLoginAt
                    ) || "—"
                ) +
                "</td>",

            '<td><span class="admin-status-badge ' +
                escapeHTML(status) +
                '">' +
                escapeHTML(
                    capitalize(status)
                ) +
                "</span></td>",

            '<td class="admin-table-actions">',
            '<button type="button" data-admin-customer-view="' +
                escapeHTML(customer.id) +
                '" aria-label="View customer">',

            '<i class="fa-regular fa-eye"></i>',
            "</button>",

            '<button type="button" data-admin-customer-toggle="' +
                escapeHTML(customer.id) +
                '" aria-label="' +
                (
                    status === "disabled"
                        ? "Enable"
                        : "Disable"
                ) +
                ' customer">',

            '<i class="fa-solid ' +
                (
                    status === "disabled"
                        ? "fa-user-check"
                        : "fa-user-slash"
                ) +
                '"></i>',
            "</button>",
            "</td>",
            "</tr>"
        ].join("");
    }

    async function openCustomerDetail(customerId) {
        let customer =
            Admin.state.customers.find(
                function (item) {
                    return item.id === customerId;
                }
            );

        if (!customer) {
            const snapshot =
                await getUsersReference()
                    .doc(customerId)
                    .get();

            if (!snapshot.exists) {
                throw new Error(
                    "The selected customer could not be found."
                );
            }

            customer = Object.assign(
                {
                    id: snapshot.id
                },
                snapshot.data()
            );
        }

        const ordersSnapshot =
            await getOrdersReference()
                .where(
                    "userId",
                    "==",
                    customerId
                )
                .orderBy(
                    "createdAt",
                    "desc"
                )
                .limit(10)
                .get();

        const orders =
            ordersSnapshot.docs.map(
                normalizeOrderSnapshot
            );

        renderCustomerDetail(
            customer,
            orders
        );

        activateSection("customer-detail");

        return customer;
    }

    function renderCustomerDetail(
        customer,
        orders
    ) {
        const container =
            Admin.elements.customerDetail;

        if (!container) {
            return;
        }

        const name =
            customer.displayName ||
            customer.email ||
            "Customer";

        container.innerHTML = [
            '<div class="admin-customer-detail-header">',
            customer.photoURL
                ? '<img src="' +
                  escapeHTML(
                      customer.photoURL
                  ) +
                  '" alt="' +
                  escapeHTML(name) +
                  '">'
                : '<span class="admin-customer-avatar large">' +
                  escapeHTML(
                      getInitials(name)
                  ) +
                  "</span>",

            "<div>",
            "<h2>" +
                escapeHTML(name) +
                "</h2>",
            "<p>" +
                escapeHTML(
                    customer.email || ""
                ) +
                "</p>",
            "<span>Joined " +
                escapeHTML(
                    formatDate(
                        customer.createdAt
                    )
                ) +
                "</span>",
            "</div>",
            "</div>",

            '<div class="admin-stat-grid">',
            createMiniStat(
                "Orders",
                customer.orderCount || 0
            ),
            createMiniStat(
                "Lifetime value",
                formatPrice(
                    customer.lifetimeValue ||
                    0
                )
            ),
            createMiniStat(
                "Status",
                capitalize(
                    customer.status ||
                    "active"
                )
            ),
            "</div>",

            '<section class="admin-card">',
            "<h3>Recent orders</h3>",
            orders.length
                ? orders
                      .map(function (order) {
                          return [
                              '<button type="button" class="admin-customer-order" data-admin-order-view="' +
                                  escapeHTML(
                                      order.id
                                  ) +
                                  '">',

                              "<span>" +
                                  escapeHTML(
                                      order.orderNumber ||
                                      order.id
                                  ) +
                                  "</span>",

                              "<small>" +
                                  escapeHTML(
                                      formatDate(
                                          order.createdAt
                                      )
                                  ) +
                                  "</small>",

                              "<strong>" +
                                  escapeHTML(
                                      formatPrice(
                                          order.total,
                                          order.currency
                                      )
                                  ) +
                                  "</strong>",
                              "</button>"
                          ].join("");
                      })
                      .join("")
                : "<p>No orders yet.</p>",
            "</section>"
        ].join("");
    }

    function createMiniStat(label, value) {
        return (
            '<article class="admin-mini-stat">' +
            "<span>" +
            escapeHTML(label) +
            "</span>" +
            "<strong>" +
            escapeHTML(value) +
            "</strong>" +
            "</article>"
        );
    }

    async function toggleCustomerStatus(
        customerId
    ) {
        const reference =
            getUsersReference().doc(
                customerId
            );

        const snapshot =
            await reference.get();

        if (!snapshot.exists) {
            throw new Error(
                "The selected customer could not be found."
            );
        }

        const customer =
            snapshot.data() || {};

        const status =
            customer.status === "disabled"
                ? "active"
                : "disabled";

        await reference.set(
            {
                status: status,
                updatedAt: serverTimestamp()
            },
            {
                merge: true
            }
        );

        app.showToast({
            type: "success",
            title: "Customer updated",
            message:
                "The customer account is now " +
                status +
                "."
        });

        await loadCustomers();
    }

    /* ======================================================
       CONFIRMATION
    ====================================================== */

    function confirmAction(options) {
        const settings = options || {};

        if (!Admin.elements.confirmationModal) {
            return Promise.resolve(
                window.confirm(
                    settings.message ||
                    "Are you sure?"
                )
            );
        }

        return new Promise(function (resolve) {
            if (Admin.elements.confirmationTitle) {
                Admin.elements.confirmationTitle.textContent =
                    settings.title ||
                    "Confirm action";
            }

            if (Admin.elements.confirmationMessage) {
                Admin.elements.confirmationMessage.textContent =
                    settings.message ||
                    "This action cannot be undone.";
            }

            openModal(
                Admin.elements.confirmationModal
            );

            function cleanup(value) {
                closeModal(
                    Admin.elements.confirmationModal
                );

                Admin.elements.confirmationAccept.removeEventListener(
                    "click",
                    accept
                );

                Admin.elements.confirmationCancel.removeEventListener(
                    "click",
                    cancel
                );

                resolve(value);
            }

            function accept() {
                cleanup(true);
            }

            function cancel() {
                cleanup(false);
            }

            Admin.elements.confirmationAccept.addEventListener(
                "click",
                accept
            );

            Admin.elements.confirmationCancel.addEventListener(
                "click",
                cancel
            );
        });
    }

    /* ======================================================
       SIDEBAR
    ====================================================== */

    function openSidebar() {
        if (Admin.elements.sidebar) {
            Admin.elements.sidebar.classList.add(
                "active"
            );
        }

        if (Admin.elements.sidebarOverlay) {
            Admin.elements.sidebarOverlay.classList.add(
                "active"
            );
        }

        document.body.classList.add(
            "admin-sidebar-open"
        );
    }

    function closeSidebar() {
        if (Admin.elements.sidebar) {
            Admin.elements.sidebar.classList.remove(
                "active"
            );
        }

        if (Admin.elements.sidebarOverlay) {
            Admin.elements.sidebarOverlay.classList.remove(
                "active"
            );
        }

        document.body.classList.remove(
            "admin-sidebar-open"
        );
    }

    /* ======================================================
       MODALS
    ====================================================== */

    function openModal(modal) {
        if (!modal) {
            return;
        }

        modal.classList.add(
            "active",
            "open"
        );

        modal.setAttribute(
            "aria-hidden",
            "false"
        );

        document.body.classList.add(
            "no-scroll"
        );
    }

    function closeModal(modal) {
        if (!modal) {
            return;
        }

        modal.classList.remove(
            "active",
            "open"
        );

        modal.setAttribute(
            "aria-hidden",
            "true"
        );

        document.body.classList.remove(
            "no-scroll"
        );
    }

    /* ======================================================
       GENERAL UTILITIES
    ====================================================== */

    function setLoading(loading) {
        Admin.state.loading =
            Boolean(loading);

        if (Admin.elements.loading) {
            Admin.elements.loading.hidden =
                !loading;

            Admin.elements.loading.classList.toggle(
                "active",
                loading
            );
        }

        if (Admin.elements.page) {
            Admin.elements.page.setAttribute(
                "aria-busy",
                String(loading)
            );
        }
    }

    function getCustomerDisplayName(customer) {
        if (!customer) {
            return "Guest customer";
        }

        return (
            [
                customer.firstName,
                customer.lastName
            ]
                .filter(Boolean)
                .join(" ") ||
            customer.displayName ||
            customer.email ||
            "Customer"
        );
    }

    function formatAddressHTML(address) {
        if (!address) {
            return "<p>Address unavailable</p>";
        }

        return (
            "<p>" +
            [
                [
                    address.firstName,
                    address.lastName
                ]
                    .filter(Boolean)
                    .join(" "),
                address.addressLine1,
                address.addressLine2,
                [
                    address.city,
                    address.state,
                    address.postalCode
                ]
                    .filter(Boolean)
                    .join(", "),
                address.country
            ]
                .filter(Boolean)
                .map(function (line) {
                    return escapeHTML(line);
                })
                .join("<br>") +
            "</p>"
        );
    }

    function capitalize(value) {
        const text =
            String(value || "");

        return (
            text.charAt(0).toUpperCase() +
            text.slice(1)
        );
    }

    function getInitials(value) {
        return String(value || "C")
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map(function (part) {
                return part.charAt(0);
            })
            .join("")
            .toUpperCase();
    }

    /* ======================================================
       FILTER EVENTS
    ====================================================== */

    function bindFilterEvents() {
        if (Admin.elements.productSearch) {
            Admin.elements.productSearch.addEventListener(
                "input",
                debounce(function () {
                    Admin.state.productSearch =
                        Admin.elements.productSearch
                            .value.trim();

                    loadProducts();
                }, 400)
            );
        }

        if (Admin.elements.productStatus) {
            Admin.elements.productStatus.addEventListener(
                "change",
                function () {
                    Admin.state.productStatus =
                        Admin.elements.productStatus
                            .value;

                    loadProducts();
                }
            );
        }

        if (Admin.elements.productCategory) {
            Admin.elements.productCategory.addEventListener(
                "change",
                function () {
                    Admin.state.productCategory =
                        Admin.elements.productCategory
                            .value;

                    loadProducts();
                }
            );
        }

        if (Admin.elements.productSort) {
            Admin.elements.productSort.addEventListener(
                "change",
                function () {
                    Admin.state.productSort =
                        Admin.elements.productSort
                            .value;

                    loadProducts();
                }
            );
        }

        if (Admin.elements.orderSearch) {
            Admin.elements.orderSearch.addEventListener(
                "input",
                debounce(function () {
                    Admin.state.orderSearch =
                        Admin.elements.orderSearch
                            .value.trim();

                    loadOrders();
                }, 400)
            );
        }

        if (Admin.elements.orderStatus) {
            Admin.elements.orderStatus.addEventListener(
                "change",
                function () {
                    Admin.state.orderStatus =
                        Admin.elements.orderStatus
                            .value;

                    loadOrders();
                }
            );
        }

        if (Admin.elements.customerSearch) {
            Admin.elements.customerSearch.addEventListener(
                "input",
                debounce(function () {
                    Admin.state.customerSearch =
                        Admin.elements.customerSearch
                            .value.trim();

                    loadCustomers();
                }, 400)
            );
        }

        if (Admin.elements.customerStatus) {
            Admin.elements.customerStatus.addEventListener(
                "change",
                function () {
                    Admin.state.customerStatus =
                        Admin.elements.customerStatus
                            .value;

                    loadCustomers();
                }
            );
        }
    }

    /* ======================================================
       PRODUCT FORM EVENTS
    ====================================================== */

    function bindProductFormEvents() {
        if (Admin.elements.productForm) {
            Admin.elements.productForm.addEventListener(
                "submit",
                function (event) {
                    event.preventDefault();
                    saveProduct();
                }
            );

            const nameField =
                Admin.elements.productForm.elements
                    .name;

            const slugField =
                Admin.elements.productForm.elements
                    .slug;

            if (nameField && slugField) {
                nameField.addEventListener(
                    "input",
                    function () {
                        if (
                            !Admin.state.editingProduct ||
                            !slugField.value
                        ) {
                            slugField.value =
                                slugify(
                                    nameField.value
                                );
                        }
                    }
                );
            }
        }

        if (Admin.elements.addVariantButton) {
            Admin.elements.addVariantButton.addEventListener(
                "click",
                function (event) {
                    event.preventDefault();
                    addVariantRow();
                }
            );
        }

        if (Admin.elements.productImageInput) {
            Admin.elements.productImageInput.addEventListener(
                "change",
                function () {
                    try {
                        addPendingImageFiles(
                            Admin.elements
                                .productImageInput
                                .files
                        );
                    } catch (error) {
                        app.showToast({
                            type: "error",
                            title:
                                "Image unavailable",
                            message:
                                error.message
                        });
                    }

                    Admin.elements.productImageInput.value =
                        "";
                }
            );
        }

        if (Admin.elements.productImageDropzone) {
            Admin.elements.productImageDropzone.addEventListener(
                "click",
                function () {
                    if (
                        Admin.elements
                            .productImageInput
                    ) {
                        Admin.elements.productImageInput.click();
                    }
                }
            );

            [
                "dragenter",
                "dragover"
            ].forEach(function (eventName) {
                Admin.elements.productImageDropzone.addEventListener(
                    eventName,
                    function (event) {
                        event.preventDefault();

                        Admin.elements.productImageDropzone.classList.add(
                            "dragging"
                        );
                    }
                );
            });

            [
                "dragleave",
                "drop"
            ].forEach(function (eventName) {
                Admin.elements.productImageDropzone.addEventListener(
                    eventName,
                    function (event) {
                        event.preventDefault();

                        Admin.elements.productImageDropzone.classList.remove(
                            "dragging"
                        );
                    }
                );
            });

            Admin.elements.productImageDropzone.addEventListener(
                "drop",
                function (event) {
                    try {
                        addPendingImageFiles(
                            event.dataTransfer.files
                        );
                    } catch (error) {
                        app.showToast({
                            type: "error",
                            title:
                                "Image unavailable",
                            message:
                                error.message
                        });
                    }
                }
            );
        }
    }

    /* ======================================================
       CLICK & CHANGE EVENTS
    ====================================================== */

    function bindClickEvents() {
        document.addEventListener(
            "click",
            async function (event) {
                const productNewButton =
                    event.target.closest(
                        "[data-admin-product-new]"
                    );

                if (productNewButton) {
                    event.preventDefault();

                    if (router) {
                        router.navigate(
                            "/admin/products/new"
                        );
                    } else {
                        openProductEditor();
                    }

                    return;
                }

                const productEditButton =
                    event.target.closest(
                        "[data-admin-product-edit]"
                    );

                if (productEditButton) {
                    event.preventDefault();

                    const productId =
                        productEditButton.dataset
                            .adminProductEdit;

                    if (router) {
                        router.navigate({
                            name:
                                "admin-product-edit",
                            params: {
                                id: productId
                            }
                        });
                    } else {
                        openProductEditor(
                            productId
                        );
                    }

                    return;
                }

                const productToggleButton =
                    event.target.closest(
                        "[data-admin-product-toggle]"
                    );

                if (productToggleButton) {
                    event.preventDefault();

                    toggleProductStatus(
                        productToggleButton.dataset
                            .adminProductToggle
                    ).catch(function (error) {
                        app.showToast({
                            type: "error",
                            title:
                                "Unable to update product",
                            message:
                                error.message
                        });
                    });

                    return;
                }

                const productDeleteButton =
                    event.target.closest(
                        "[data-admin-product-delete]"
                    );

                if (productDeleteButton) {
                    event.preventDefault();

                    const accepted =
                        await confirmAction({
                            title:
                                "Delete product",
                            message:
                                "This permanently removes the product and its uploaded images."
                        });

                    if (accepted) {
                        deleteProduct(
                            productDeleteButton.dataset
                                .adminProductDelete
                        ).catch(function (error) {
                            app.showToast({
                                type: "error",
                                title:
                                    "Unable to delete product",
                                message:
                                    error.message
                            });
                        });
                    }

                    return;
                }

                const formDeleteButton =
                    event.target.closest(
                        "[data-admin-delete-current-product]"
                    );

                if (
                    formDeleteButton &&
                    Admin.state.editingProduct
                ) {
                    event.preventDefault();

                    const accepted =
                        await confirmAction({
                            title:
                                "Delete product",
                            message:
                                "This action cannot be undone."
                        });

                    if (accepted) {
                        deleteProduct(
                            Admin.state
                                .editingProduct.id
                        );
                    }

                    return;
                }

                const variantRemoveButton =
                    event.target.closest(
                        "[data-admin-variant-remove]"
                    );

                if (variantRemoveButton) {
                    event.preventDefault();

                    const row =
                        variantRemoveButton.closest(
                            ".admin-variant-row"
                        );

                    if (row) {
                        row.remove();
                    }

                    return;
                }

                const removeUploadedImage =
                    event.target.closest(
                        "[data-admin-image-remove-uploaded]"
                    );

                if (removeUploadedImage) {
                    event.preventDefault();

                    const index =
                        Number(
                            removeUploadedImage.dataset
                                .adminImageRemoveUploaded
                        );

                    const image =
                        Admin.state
                            .uploadedImages[index];

                    Admin.state.uploadedImages.splice(
                        index,
                        1
                    );

                    renderImagePreview();

                    if (image && image.path) {
                        deleteStorageImage(
                            image.path
                        );
                    }

                    return;
                }

                const removePendingImage =
                    event.target.closest(
                        "[data-admin-image-remove-pending]"
                    );

                if (removePendingImage) {
                    event.preventDefault();

                    Admin.state.pendingImageFiles.splice(
                        Number(
                            removePendingImage.dataset
                                .adminImageRemovePending
                        ),
                        1
                    );

                    renderImagePreview();

                    return;
                }

                const orderViewButton =
                    event.target.closest(
                        "[data-admin-order-view]"
                    );

                if (orderViewButton) {
                    event.preventDefault();

                    const orderId =
                        orderViewButton.dataset
                            .adminOrderView;

                    if (router) {
                        router.navigate({
                            name: "admin-order",
                            params: {
                                id: orderId
                            }
                        });
                    } else {
                        openOrderDetail(orderId);
                    }

                    return;
                }

                const customerViewButton =
                    event.target.closest(
                        "[data-admin-customer-view]"
                    );

                if (customerViewButton) {
                    event.preventDefault();

                    openCustomerDetail(
                        customerViewButton.dataset
                            .adminCustomerView
                    ).catch(function (error) {
                        app.showToast({
                            type: "error",
                            title:
                                "Customer unavailable",
                            message:
                                error.message
                        });
                    });

                    return;
                }

                const customerToggleButton =
                    event.target.closest(
                        "[data-admin-customer-toggle]"
                    );

                if (customerToggleButton) {
                    event.preventDefault();

                    toggleCustomerStatus(
                        customerToggleButton.dataset
                            .adminCustomerToggle
                    ).catch(function (error) {
                        app.showToast({
                            type: "error",
                            title:
                                "Unable to update customer",
                            message:
                                error.message
                        });
                    });
                }
            }
        );

        document.addEventListener(
            "change",
            function (event) {
                const orderStatusControl =
                    event.target.closest(
                        "[data-admin-order-status]"
                    );

                if (orderStatusControl) {
                    updateOrderStatus(
                        orderStatusControl.dataset
                            .adminOrderStatus,

                        orderStatusControl.value
                    ).catch(function (error) {
                        app.showToast({
                            type: "error",
                            title:
                                "Unable to update order",
                            message:
                                error.message
                        });
                    });
                }
            }
        );

        if (Admin.elements.productsLoadMore) {
            Admin.elements.productsLoadMore.addEventListener(
                "click",
                function () {
                    loadProducts({
                        append: true
                    });
                }
            );
        }

        if (Admin.elements.ordersLoadMore) {
            Admin.elements.ordersLoadMore.addEventListener(
                "click",
                function () {
                    loadOrders({
                        append: true
                    });
                }
            );
        }

        if (Admin.elements.customersLoadMore) {
            Admin.elements.customersLoadMore.addEventListener(
                "click",
                function () {
                    loadCustomers({
                        append: true
                    });
                }
            );
        }

        if (Admin.elements.sidebarToggle) {
            Admin.elements.sidebarToggle.addEventListener(
                "click",
                openSidebar
            );
        }

        if (Admin.elements.sidebarClose) {
            Admin.elements.sidebarClose.addEventListener(
                "click",
                closeSidebar
            );
        }

        if (Admin.elements.sidebarOverlay) {
            Admin.elements.sidebarOverlay.addEventListener(
                "click",
                closeSidebar
            );
        }
    }

    /* ======================================================
       ROUTER EVENTS
    ====================================================== */

    async function handleAdminRoute(detail) {
        if (!(await requireAdmin())) {
            return;
        }

        const section =
            detail.route &&
            detail.route.adminSection
                ? detail.route.adminSection
                : "dashboard";

        activateSection(section);

        switch (detail.name) {
            case "admin":
                await loadDashboard();
                break;

            case "admin-products":
                await loadProducts();
                break;

            case "admin-product-new":
                await openProductEditor();
                break;

            case "admin-product-edit":
                await openProductEditor(
                    detail.params.id
                );
                break;

            case "admin-orders":
                await loadOrders();
                break;

            case "admin-order":
                await openOrderDetail(
                    detail.params.id
                );
                break;

            case "admin-customers":
                await loadCustomers();
                break;

            case "admin-analytics":
                await loadDashboard();
                break;

            default:
                break;
        }
    }

    function bindApplicationEvents() {
        document.addEventListener(
            "router:change",
            function (event) {
                const detail =
                    event.detail || {};

                if (
                    detail.name &&
                    detail.name.startsWith(
                        "admin"
                    )
                ) {
                    handleAdminRoute(detail).catch(
                        function (error) {
                            console.error(
                                "[Admin] Route handling failed:",
                                error
                            );

                            app.showToast({
                                type: "error",
                                title:
                                    "Administrator page unavailable",
                                message:
                                    error.message
                            });
                        }
                    );
                }
            }
        );

        document.addEventListener(
            "auth:statechange",
            function (event) {
                const detail =
                    event.detail || {};

                Admin.state.user =
                    detail.user || null;

                Admin.state.profile =
                    detail.profile || null;

                if (!detail.user) {
                    Admin.state.authorized =
                        false;
                }
            }
        );

        window.addEventListener(
            "resize",
            function () {
                if (
                    window.innerWidth > 1024
                ) {
                    closeSidebar();
                }
            }
        );
    }

    /* ======================================================
       INITIALIZATION
    ====================================================== */

    async function initialize() {
        if (Admin.initialized) {
            return;
        }

        cacheElements();
        bindFilterEvents();
        bindProductFormEvents();
        bindClickEvents();
        bindApplicationEvents();

        Admin.state.user =
            auth.currentUser;

        Admin.initialized = true;

        if (
            router &&
            router.currentRoute &&
            router.currentRoute.route &&
            router.currentRoute.route.name.startsWith(
                "admin"
            )
        ) {
            await handleAdminRoute({
                name:
                    router.currentRoute.route.name,
                route:
                    router.currentRoute.route,
                params:
                    router.currentRoute.params ||
                    {},
                query:
                    router.currentRoute.query ||
                    {}
            });
        }

        document.dispatchEvent(
            new CustomEvent(
                "admin:ready",
                {
                    detail: {
                        admin: Admin
                    }
                }
            )
        );

        console.info(
            "[Admin] L'ÉTERNEL administration initialized."
        );
    }

    /* ======================================================
       PUBLIC API
    ====================================================== */

    Admin.init = initialize;

    Admin.requireAdmin =
        requireAdmin;

    Admin.verifyAccess =
        verifyAdminAccess;

    Admin.activateSection =
        activateSection;

    Admin.loadDashboard =
        loadDashboard;

    Admin.loadProducts =
        loadProducts;

    Admin.openProductEditor =
        openProductEditor;

    Admin.saveProduct =
        saveProduct;

    Admin.deleteProduct =
        deleteProduct;

    Admin.toggleProductStatus =
        toggleProductStatus;

    Admin.uploadProductImage =
        uploadProductImage;

    Admin.loadOrders =
        loadOrders;

    Admin.openOrder =
        openOrderDetail;

    Admin.updateOrderStatus =
        updateOrderStatus;

    Admin.loadCustomers =
        loadCustomers;

    Admin.openCustomer =
        openCustomerDetail;

    Admin.toggleCustomerStatus =
        toggleCustomerStatus;

    Admin.openSidebar =
        openSidebar;

    Admin.closeSidebar =
        closeSidebar;

    window.LEternelAdmin = Admin;

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initialize,
            {
                once: true
            }
        );
    } else {
        initialize();
    }
})();
```
