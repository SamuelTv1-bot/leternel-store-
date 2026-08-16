//javascript
"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   CUSTOMER PROFILE & ACCOUNT MODULE — FIREBASE V8
========================================================== */

(function initializeProfileModule() {
    const app = window.LEternelApp;
    const router = window.LEternelRouter;
    const authModule = window.LEternelAuth;
    const wishlist = window.LEternelWishlist;
    const services = window.FirebaseServices;

    if (!app) {
        throw new Error(
            "LEternelApp was not found. Load app.js before profile.js."
        );
    }

    if (!services || !services.auth || !services.db) {
        throw new Error(
            "Firebase services were not found. Load firebase.js before profile.js."
        );
    }

    const auth = services.auth;
    const db = services.db;
    const storage = services.storage;
    const serverTimestamp = services.helpers.serverTimestamp;
    const createStoragePath = services.helpers.createStoragePath;
    const generateStorageFileName =
        services.helpers.generateStorageFileName;

    const Profile = {
        initialized: false,

        config: {
            usersCollection: "users",
            ordersCollection: "orders",
            paymentMethodsCollection: "paymentMethods",
            maximumAddresses: 8,
            maximumPaymentMethods: 6,
            avatarMaximumSize: 5 * 1024 * 1024,
            avatarAcceptedTypes: [
                "image/jpeg",
                "image/png",
                "image/webp"
            ],
            ordersPageSize: 10,
            defaultCurrency: "NGN",
            defaultLocale: "en-NG"
        },

        state: {
            user: null,
            profile: null,
            orders: [],
            addresses: [],
            paymentMethods: [],
            activeSection: "overview",
            loading: false,
            saving: false,
            lastOrderSnapshot: null,
            ordersComplete: false,
            unsubscribeProfile: null
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
            window.LEternelProducts &&
            typeof window.LEternelProducts.formatPrice === "function"
        ) {
            return window.LEternelProducts.formatPrice(
                value,
                currency || Profile.config.defaultCurrency
            );
        }

        try {
            return new Intl.NumberFormat(
                Profile.config.defaultLocale,
                {
                    style: "currency",
                    currency:
                        currency ||
                        Profile.config.defaultCurrency,
                    maximumFractionDigits: 0
                }
            ).format(toNumber(value, 0));
        } catch (error) {
            return (
                (currency || Profile.config.defaultCurrency) +
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
            Profile.config.defaultLocale,
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

    function createId(prefix) {
        return (
            String(prefix || "item") +
            "-" +
            Date.now() +
            "-" +
            Math.random()
                .toString(36)
                .slice(2, 8)
        );
    }

    /* ======================================================
       ELEMENT CACHE
    ====================================================== */

    function cacheElements() {
        Profile.elements = {
            page:
                getById("account-page") ||
                query('[data-page="account"]'),

            loading:
                getById("account-loading") ||
                query("[data-account-loading]"),

            sections: queryAll(
                "[data-account-section]"
            ),

            navigationButtons: queryAll(
                "[data-account-route]"
            ),

            userNameElements: queryAll(
                "[data-profile-name]"
            ),

            userEmailElements: queryAll(
                "[data-profile-email]"
            ),

            userAvatarElements: queryAll(
                "[data-profile-avatar]"
            ),

            memberSinceElements: queryAll(
                "[data-member-since]"
            ),

            overviewOrderCount: queryAll(
                "[data-overview-order-count]"
            ),

            overviewWishlistCount: queryAll(
                "[data-overview-wishlist-count]"
            ),

            overviewLifetimeValue: queryAll(
                "[data-overview-lifetime-value]"
            ),

            recentOrders:
                getById("account-recent-orders") ||
                query("[data-recent-orders]"),

            recentOrdersEmpty:
                getById("recent-orders-empty") ||
                query("[data-recent-orders-empty]"),

            ordersList:
                getById("account-orders-list") ||
                query("[data-account-orders]"),

            ordersEmpty:
                getById("account-orders-empty") ||
                query("[data-orders-empty]"),

            ordersLoadMore:
                getById("orders-load-more") ||
                query("[data-orders-load-more]"),

            addressesGrid:
                getById("account-addresses-grid") ||
                query("[data-account-addresses]"),

            addressesEmpty:
                getById("account-addresses-empty") ||
                query("[data-addresses-empty]"),

            addAddressButtons: queryAll(
                "[data-address-add]"
            ),

            addressModal:
                getById("address-modal") ||
                query("[data-address-modal]"),

            addressForm:
                getById("address-form") ||
                query("[data-address-form]"),

            addressModalTitle:
                getById("address-modal-title") ||
                query("[data-address-modal-title]"),

            paymentMethodsGrid:
                getById("payment-methods-grid") ||
                query("[data-payment-methods]"),

            paymentMethodsEmpty:
                getById("payment-methods-empty") ||
                query("[data-payment-methods-empty]"),

            addPaymentButtons: queryAll(
                "[data-payment-add]"
            ),

            paymentModal:
                getById("payment-method-modal") ||
                query("[data-payment-modal]"),

            paymentForm:
                getById("payment-method-form") ||
                query("[data-payment-form]"),

            profileForm:
                getById("profile-details-form") ||
                query("[data-profile-form]"),

            preferencesForm:
                getById("notification-preferences-form") ||
                query("[data-preferences-form]"),

            passwordForm:
                getById("change-password-form") ||
                query("[data-password-change-form]"),

            avatarInput:
                getById("profile-avatar-input") ||
                query("[data-avatar-input]"),

            avatarUploadButton:
                getById("profile-avatar-upload") ||
                query("[data-avatar-upload]"),

            logoutButtons: queryAll(
                "[data-profile-logout]"
            ),

            deleteAccountButtons: queryAll(
                "[data-account-delete]"
            ),

            deleteAccountModal:
                getById("delete-account-modal") ||
                query("[data-delete-account-modal]"),

            deleteAccountForm:
                getById("delete-account-form") ||
                query("[data-delete-account-form]"),

            orderDetailModal:
                getById("order-detail-modal") ||
                query("[data-order-detail-modal]"),

            orderDetailContent:
                getById("order-detail-content") ||
                query("[data-order-detail-content]")
        };
    }

    /* ======================================================
       FIRESTORE REFERENCES
    ====================================================== */

    function getUserReference(uid) {
        return db
            .collection(Profile.config.usersCollection)
            .doc(uid);
    }

    function getOrdersReference() {
        return db.collection(
            Profile.config.ordersCollection
        );
    }

    function getPaymentMethodsReference(uid) {
        return getUserReference(uid).collection(
            Profile.config.paymentMethodsCollection
        );
    }

    /* ======================================================
       PROFILE LOADING
    ====================================================== */

    async function loadProfile(user) {
        if (!user) {
            return null;
        }

        if (
            authModule &&
            typeof authModule.ensureUserProfile === "function"
        ) {
            return authModule.ensureUserProfile(user);
        }

        const snapshot =
            await getUserReference(user.uid).get();

        if (!snapshot.exists) {
            return null;
        }

        return Object.assign(
            {
                id: snapshot.id
            },
            snapshot.data()
        );
    }

    function subscribeToProfile(user) {
        unsubscribeFromProfile();

        if (!user) {
            return;
        }

        Profile.state.unsubscribeProfile =
            getUserReference(user.uid).onSnapshot(
                function (snapshot) {
                    if (!snapshot.exists) {
                        return;
                    }

                    Profile.state.profile = Object.assign(
                        {
                            id: snapshot.id
                        },
                        snapshot.data()
                    );

                    synchronizeProfileState();
                    renderProfile();
                },
                function (error) {
                    console.error(
                        "[Profile] Real-time profile synchronization failed:",
                        error
                    );
                }
            );
    }

    function unsubscribeFromProfile() {
        if (
            typeof Profile.state.unsubscribeProfile ===
            "function"
        ) {
            Profile.state.unsubscribeProfile();
        }

        Profile.state.unsubscribeProfile = null;
    }

    function synchronizeProfileState() {
        const profile =
            Profile.state.profile || {};

        Profile.state.addresses =
            Array.isArray(profile.addresses)
                ? profile.addresses.map(normalizeAddress)
                : [];

        Profile.state.paymentMethods =
            Array.isArray(profile.paymentMethods)
                ? profile.paymentMethods.map(
                      normalizePaymentMethod
                  )
                : Profile.state.paymentMethods;
    }

    /* ======================================================
       PROFILE RENDERING
    ====================================================== */

    function renderProfile() {
        const user = Profile.state.user;
        const profile =
            Profile.state.profile || {};

        if (!user) {
            return;
        }

        const displayName =
            profile.displayName ||
            user.displayName ||
            user.email ||
            "Customer";

        const email =
            profile.email ||
            user.email ||
            "";

        const photoURL =
            profile.photoURL ||
            user.photoURL ||
            "";

        Profile.elements.userNameElements.forEach(
            function (element) {
                element.textContent = displayName;
            }
        );

        Profile.elements.userEmailElements.forEach(
            function (element) {
                element.textContent = email;
            }
        );

        Profile.elements.userAvatarElements.forEach(
            function (element) {
                if (element.tagName === "IMG") {
                    if (photoURL) {
                        element.src = photoURL;
                    }

                    element.alt =
                        displayName + " profile photo";
                } else {
                    element.style.backgroundImage =
                        photoURL
                            ? 'url("' +
                              photoURL.replace(/"/g, '\\"') +
                              '")'
                            : "";
                }
            }
        );

        const memberSince =
            profile.createdAt ||
            user.metadata.creationTime;

        Profile.elements.memberSinceElements.forEach(
            function (element) {
                element.textContent =
                    memberSince
                        ? "Member since " +
                          formatDate(memberSince, {
                              month: "long",
                              year: "numeric"
                          })
                        : "";
            }
        );

        setElementsText(
            Profile.elements.overviewOrderCount,
            String(
                toNumber(
                    profile.orderCount,
                    Profile.state.orders.length
                )
            )
        );

        const wishlistCount =
            wishlist &&
            typeof wishlist.getItemCount === "function"
                ? wishlist.getItemCount()
                : 0;

        setElementsText(
            Profile.elements.overviewWishlistCount,
            String(wishlistCount)
        );

        setElementsText(
            Profile.elements.overviewLifetimeValue,
            formatPrice(
                toNumber(profile.lifetimeValue, 0)
            )
        );

        populateProfileForm();
        populatePreferencesForm();
        renderAddresses();
        renderPaymentMethods();
    }

    function setElementsText(elements, value) {
        elements.forEach(function (element) {
            element.textContent = value;
        });
    }

    function populateProfileForm() {
        const form = Profile.elements.profileForm;
        const profile =
            Profile.state.profile || {};

        if (!form) {
            return;
        }

        const values = {
            displayName:
                profile.displayName || "",
            email:
                profile.email ||
                (
                    Profile.state.user &&
                    Profile.state.user.email
                ) ||
                "",
            phoneNumber:
                profile.phoneNumber || "",
            dateOfBirth:
                profile.dateOfBirth || "",
            gender:
                profile.gender || "",
            country:
                profile.country || "",
            preferredCurrency:
                profile.preferredCurrency ||
                Profile.config.defaultCurrency
        };

        Object.keys(values).forEach(function (name) {
            if (form.elements[name]) {
                form.elements[name].value =
                    values[name];
            }
        });
    }

    function populatePreferencesForm() {
        const form =
            Profile.elements.preferencesForm;

        if (!form) {
            return;
        }

        const preferences =
            (
                Profile.state.profile &&
                Profile.state.profile.preferences
            ) ||
            {};

        [
            "marketingEmails",
            "orderUpdates",
            "productRecommendations",
            "wishlistUpdates",
            "securityAlerts"
        ].forEach(function (name) {
            if (form.elements[name]) {
                form.elements[name].checked =
                    preferences[name] !== false;
            }
        });
    }

    /* ======================================================
       ACCOUNT SECTIONS
    ====================================================== */

    function activateSection(sectionName) {
        const section =
            String(sectionName || "overview");

        Profile.state.activeSection = section;

        Profile.elements.sections.forEach(
            function (element) {
                const active =
                    element.dataset.accountSection === section;

                element.hidden = !active;
                element.classList.toggle(
                    "active",
                    active
                );
            }
        );

        Profile.elements.navigationButtons.forEach(
            function (button) {
                button.classList.toggle(
                    "active",
                    button.dataset.accountRoute === section
                );
            }
        );

        if (section === "orders") {
            ensureOrdersLoaded();
        }

        if (section === "addresses") {
            renderAddresses();
        }

        if (section === "payments") {
            loadPaymentMethods();
        }
    }

    /* ======================================================
       ORDERS
    ====================================================== */

    async function fetchOrders(options) {
        const settings = options || {};
        const user = Profile.state.user;

        if (!user) {
            return [];
        }

        let reference = getOrdersReference()
            .where("userId", "==", user.uid)
            .orderBy("createdAt", "desc")
            .limit(
                settings.limit ||
                Profile.config.ordersPageSize
            );

        if (settings.startAfter) {
            reference = reference.startAfter(
                settings.startAfter
            );
        }

        const snapshot = await reference.get();

        Profile.state.lastOrderSnapshot =
            snapshot.docs.length
                ? snapshot.docs[
                      snapshot.docs.length - 1
                  ]
                : Profile.state.lastOrderSnapshot;

        Profile.state.ordersComplete =
            snapshot.docs.length <
            (
                settings.limit ||
                Profile.config.ordersPageSize
            );

        return snapshot.docs.map(function (documentSnapshot) {
            return Object.assign(
                {
                    id: documentSnapshot.id
                },
                documentSnapshot.data()
            );
        });
    }

    async function ensureOrdersLoaded() {
        if (
            Profile.state.orders.length ||
            Profile.state.loading
        ) {
            renderOrders();
            return Profile.state.orders;
        }

        return loadInitialOrders();
    }

    async function loadInitialOrders() {
        setLoading(true);

        try {
            Profile.state.lastOrderSnapshot = null;
            Profile.state.ordersComplete = false;

            Profile.state.orders =
                await fetchOrders();

            renderOrders();

            return Profile.state.orders;
        } catch (error) {
            console.error(
                "[Profile] Orders could not be loaded:",
                error
            );

            app.showToast({
                type: "error",
                title: "Orders unavailable",
                message:
                    "Your order history could not be loaded."
            });

            return [];
        } finally {
            setLoading(false);
        }
    }

    async function loadMoreOrders() {
        if (
            Profile.state.ordersComplete ||
            !Profile.state.lastOrderSnapshot
        ) {
            return [];
        }

        if (Profile.elements.ordersLoadMore) {
            Profile.elements.ordersLoadMore.disabled = true;
            Profile.elements.ordersLoadMore.classList.add(
                "loading"
            );
        }

        try {
            const orders = await fetchOrders({
                startAfter:
                    Profile.state.lastOrderSnapshot
            });

            Profile.state.orders =
                Profile.state.orders.concat(orders);

            renderOrders();

            return orders;
        } finally {
            if (Profile.elements.ordersLoadMore) {
                Profile.elements.ordersLoadMore.disabled =
                    Profile.state.ordersComplete;

                Profile.elements.ordersLoadMore.classList.remove(
                    "loading"
                );
            }
        }
    }

    function createOrderCard(order) {
        const article =
            document.createElement("article");

        article.className = "account-order-card";
        article.dataset.orderId = order.id;

        const items =
            Array.isArray(order.items)
                ? order.items
                : [];

        const previewImages = items
            .slice(0, 3)
            .map(function (item) {
                return (
                    '<img src="' +
                    escapeHTML(
                        item.image ||
                        "https://placehold.co/150x190?text=L%27ÉTERNEL"
                    ) +
                    '" alt="' +
                    escapeHTML(item.name || "Order item") +
                    '">'
                );
            })
            .join("");

        article.innerHTML = [
            '<div class="account-order-header">',
            "<div>",
            '<span class="account-order-number">' +
                escapeHTML(
                    order.orderNumber ||
                    order.id
                ) +
                "</span>",
            "<p>Placed " +
                escapeHTML(
                    formatDate(order.createdAt)
                ) +
                "</p>",
            "</div>",
            '<span class="order-status ' +
                escapeHTML(
                    getOrderStatusClass(
                        order.status
                    )
                ) +
                '">' +
                escapeHTML(
                    formatOrderStatus(
                        order.status
                    )
                ) +
                "</span>",
            "</div>",

            '<div class="account-order-body">',
            '<div class="account-order-images">' +
                previewImages +
                (
                    items.length > 3
                        ? '<span class="order-more-items">+' +
                          escapeHTML(
                              items.length - 3
                          ) +
                          "</span>"
                        : ""
                ) +
                "</div>",

            '<div class="account-order-summary">',
            "<strong>" +
                escapeHTML(
                    order.itemCount ||
                    items.reduce(function (total, item) {
                        return total +
                            toNumber(item.quantity, 1);
                    }, 0)
                ) +
                " item" +
                (
                    (
                        order.itemCount ||
                        items.length
                    ) === 1
                        ? ""
                        : "s"
                ) +
                "</strong>",

            "<span>" +
                escapeHTML(
                    formatPrice(
                        order.total,
                        order.currency
                    )
                ) +
                "</span>",
            "</div>",

            '<button type="button" class="secondary-btn" data-order-view="' +
                escapeHTML(order.id) +
                '">View order</button>',
            "</div>"
        ].join("");

        return article;
    }

    function renderOrders() {
        renderOrdersInto(
            Profile.elements.ordersList,
            Profile.state.orders
        );

        renderOrdersInto(
            Profile.elements.recentOrders,
            Profile.state.orders.slice(0, 3)
        );

        const hasOrders =
            Profile.state.orders.length > 0;

        if (Profile.elements.ordersEmpty) {
            Profile.elements.ordersEmpty.hidden =
                hasOrders;
        }

        if (Profile.elements.recentOrdersEmpty) {
            Profile.elements.recentOrdersEmpty.hidden =
                hasOrders;
        }

        if (Profile.elements.ordersLoadMore) {
            Profile.elements.ordersLoadMore.hidden =
                !hasOrders ||
                Profile.state.ordersComplete;
        }
    }

    function renderOrdersInto(container, orders) {
        if (!container) {
            return;
        }

        container.innerHTML = "";

        const fragment =
            document.createDocumentFragment();

        orders.forEach(function (order) {
            fragment.appendChild(
                createOrderCard(order)
            );
        });

        container.appendChild(fragment);
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

    function getOrderStatusClass(status) {
        const classes = {
            pending: "pending",
            confirmed: "confirmed",
            processing: "processing",
            shipped: "shipped",
            delivered: "delivered",
            cancelled: "cancelled",
            refunded: "refunded"
        };

        return classes[status] || "pending";
    }

    async function openOrderDetail(orderId) {
        let order = Profile.state.orders.find(
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

            order = Object.assign(
                {
                    id: snapshot.id
                },
                snapshot.data()
            );
        }

        renderOrderDetail(order);
        openModal(
            Profile.elements.orderDetailModal
        );

        return order;
    }

    function renderOrderDetail(order) {
        const container =
            Profile.elements.orderDetailContent;

        if (!container) {
            return;
        }

        const items =
            Array.isArray(order.items)
                ? order.items
                : [];

        container.innerHTML = [
            '<div class="order-detail-heading">',
            "<div>",
            "<span>Order</span>",
            "<h3>" +
                escapeHTML(
                    order.orderNumber ||
                    order.id
                ) +
                "</h3>",
            "<p>Placed " +
                escapeHTML(
                    formatDate(order.createdAt, {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit"
                    })
                ) +
                "</p>",
            "</div>",
            '<span class="order-status ' +
                escapeHTML(
                    getOrderStatusClass(
                        order.status
                    )
                ) +
                '">' +
                escapeHTML(
                    formatOrderStatus(
                        order.status
                    )
                ) +
                "</span>",
            "</div>",

            '<div class="order-detail-items">',
            items
                .map(function (item) {
                    return [
                        '<article class="order-detail-item">',
                        '<img src="' +
                            escapeHTML(
                                item.image ||
                                "https://placehold.co/180x220?text=L%27ÉTERNEL"
                            ) +
                            '" alt="' +
                            escapeHTML(item.name) +
                            '">',
                        "<div>",
                        "<h4>" +
                            escapeHTML(item.name) +
                            "</h4>",
                        "<p>" +
                            escapeHTML(
                                [
                                    item.size
                                        ? "Size " +
                                          item.size
                                        : "",
                                    item.color || "",
                                    "Qty " +
                                        toNumber(
                                            item.quantity,
                                            1
                                        )
                                ]
                                    .filter(Boolean)
                                    .join(" · ")
                            ) +
                            "</p>",
                        "</div>",
                        "<strong>" +
                            escapeHTML(
                                formatPrice(
                                    item.lineTotal ||
                                    item.price *
                                        item.quantity,
                                    item.currency ||
                                    order.currency
                                )
                            ) +
                            "</strong>",
                        "</article>"
                    ].join("");
                })
                .join(""),
            "</div>",

            '<div class="order-detail-columns">',
            '<div class="order-detail-block">',
            "<h4>Delivery address</h4>",
            formatAddressHTML(
                order.shippingAddress
            ),
            "</div>",
            '<div class="order-detail-block">',
            "<h4>Delivery method</h4>",
            "<p>" +
                escapeHTML(
                    order.delivery &&
                    order.delivery.label
                        ? order.delivery.label
                        : "Standard delivery"
                ) +
                "</p>",
            order.delivery &&
            order.delivery.estimate
                ? "<span>" +
                  escapeHTML(
                      order.delivery.estimate
                  ) +
                  "</span>"
                : "",
            "</div>",
            "</div>",

            '<div class="order-detail-totals">',
            createTotalRow(
                "Subtotal",
                order.subtotal,
                order.currency
            ),
            createTotalRow(
                "Delivery",
                order.shipping,
                order.currency,
                order.shipping === 0
                    ? "Complimentary"
                    : null
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
                null,
                true
            ),
            "</div>"
        ].join("");
    }

    function createTotalRow(
        label,
        value,
        currency,
        customValue,
        total
    ) {
        return (
            '<div class="order-total-row' +
            (total ? " total" : "") +
            '">' +
            "<span>" +
            escapeHTML(label) +
            "</span>" +
            "<strong>" +
            escapeHTML(
                customValue ||
                formatPrice(value, currency)
            ) +
            "</strong>" +
            "</div>"
        );
    }

    /* ======================================================
       ADDRESSES
    ====================================================== */

    function normalizeAddress(address) {
        const source = address || {};

        return {
            id: source.id || createId("address"),
            label: source.label || "Address",
            firstName: source.firstName || "",
            lastName: source.lastName || "",
            phone: source.phone || "",
            addressLine1: source.addressLine1 || "",
            addressLine2: source.addressLine2 || "",
            city: source.city || "",
            state: source.state || "",
            postalCode: source.postalCode || "",
            country: source.country || "Nigeria",
            default: source.default === true
        };
    }

    function renderAddresses() {
        const container =
            Profile.elements.addressesGrid;

        if (!container) {
            return;
        }

        container.innerHTML = "";

        const fragment =
            document.createDocumentFragment();

        Profile.state.addresses.forEach(
            function (address) {
                fragment.appendChild(
                    createAddressCard(address)
                );
            }
        );

        container.appendChild(fragment);

        if (Profile.elements.addressesEmpty) {
            Profile.elements.addressesEmpty.hidden =
                Profile.state.addresses.length > 0;
        }
    }

    function createAddressCard(address) {
        const article =
            document.createElement("article");

        article.className = "account-address-card";
        article.dataset.addressId = address.id;

        article.innerHTML = [
            '<div class="account-address-header">',
            "<div>",
            "<h4>" +
                escapeHTML(address.label) +
                "</h4>",
            address.default
                ? '<span class="default-badge">Default</span>'
                : "",
            "</div>",
            '<div class="account-card-actions">',
            '<button type="button" data-address-edit="' +
                escapeHTML(address.id) +
                '" aria-label="Edit address">',
            '<i class="fa-regular fa-pen-to-square"></i>',
            "</button>",
            '<button type="button" data-address-delete="' +
                escapeHTML(address.id) +
                '" aria-label="Delete address">',
            '<i class="fa-regular fa-trash-can"></i>',
            "</button>",
            "</div>",
            "</div>",
            formatAddressHTML(address),
            address.phone
                ? "<span>" +
                  escapeHTML(address.phone) +
                  "</span>"
                : "",
            !address.default
                ? '<button type="button" class="text-button" data-address-default="' +
                  escapeHTML(address.id) +
                  '">Set as default</button>'
                : ""
        ].join("");

        return article;
    }

    function formatAddressHTML(address) {
        if (!address) {
            return "<p>Address unavailable</p>";
        }

        const name = [
            address.firstName,
            address.lastName
        ]
            .filter(Boolean)
            .join(" ");

        const lines = [
            name,
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
        ].filter(Boolean);

        return (
            "<p>" +
            lines
                .map(function (line) {
                    return escapeHTML(line);
                })
                .join("<br>") +
            "</p>"
        );
    }

    function openAddressModal(addressId) {
        const address = addressId
            ? Profile.state.addresses.find(
                  function (item) {
                      return item.id === addressId;
                  }
              )
            : null;

        const form =
            Profile.elements.addressForm;

        if (!form) {
            return;
        }

        form.reset();
        form.dataset.addressId =
            address ? address.id : "";

        if (Profile.elements.addressModalTitle) {
            Profile.elements.addressModalTitle.textContent =
                address
                    ? "Edit address"
                    : "Add address";
        }

        if (address) {
            Object.keys(address).forEach(function (name) {
                if (!form.elements[name]) {
                    return;
                }

                if (
                    form.elements[name].type ===
                    "checkbox"
                ) {
                    form.elements[name].checked =
                        Boolean(address[name]);
                } else {
                    form.elements[name].value =
                        address[name] || "";
                }
            });
        }

        openModal(Profile.elements.addressModal);
    }

    async function saveAddressFromForm(form) {
        if (
            Profile.state.addresses.length >=
                Profile.config.maximumAddresses &&
            !form.dataset.addressId
        ) {
            throw new Error(
                "You have reached the maximum number of saved addresses."
            );
        }

        const address = normalizeAddress({
            id:
                form.dataset.addressId ||
                createId("address"),
            label:
                getFormValue(form, "label") ||
                "Address",
            firstName: getFormValue(
                form,
                "firstName"
            ),
            lastName: getFormValue(
                form,
                "lastName"
            ),
            phone: getFormValue(form, "phone"),
            addressLine1: getFormValue(
                form,
                "addressLine1"
            ),
            addressLine2: getFormValue(
                form,
                "addressLine2"
            ),
            city: getFormValue(form, "city"),
            state: getFormValue(form, "state"),
            postalCode: getFormValue(
                form,
                "postalCode"
            ),
            country:
                getFormValue(form, "country") ||
                "Nigeria",
            default:
                Boolean(
                    form.elements.default &&
                    form.elements.default.checked
                )
        });

        if (
            !address.firstName ||
            !address.lastName ||
            !address.addressLine1 ||
            !address.city ||
            !address.state ||
            !address.country
        ) {
            throw new Error(
                "Complete all required address fields."
            );
        }

        let addresses =
            Profile.state.addresses.slice();

        if (address.default) {
            addresses = addresses.map(function (item) {
                return Object.assign({}, item, {
                    default: false
                });
            });
        }

        const existingIndex =
            addresses.findIndex(function (item) {
                return item.id === address.id;
            });

        if (existingIndex === -1) {
            if (!addresses.length) {
                address.default = true;
            }

            addresses.push(address);
        } else {
            addresses[existingIndex] = address;
        }

        await updateAddresses(addresses);

        return address;
    }

    async function updateAddresses(addresses) {
        const normalized =
            addresses.map(normalizeAddress);

        if (
            normalized.length &&
            !normalized.some(function (address) {
                return address.default;
            })
        ) {
            normalized[0].default = true;
        }

        await getUserReference(
            Profile.state.user.uid
        ).set(
            {
                addresses: normalized,
                updatedAt: serverTimestamp()
            },
            {
                merge: true
            }
        );

        Profile.state.addresses = normalized;
        renderAddresses();

        return normalized;
    }

    async function deleteAddress(addressId) {
        const addresses =
            Profile.state.addresses.filter(
                function (address) {
                    return address.id !== addressId;
                }
            );

        await updateAddresses(addresses);

        app.showToast({
            type: "success",
            title: "Address removed",
            message:
                "The saved address has been deleted."
        });
    }

    async function setDefaultAddress(addressId) {
        const addresses =
            Profile.state.addresses.map(
                function (address) {
                    return Object.assign({}, address, {
                        default:
                            address.id === addressId
                    });
                }
            );

        await updateAddresses(addresses);

        app.showToast({
            type: "success",
            title: "Default address updated",
            message:
                "Your preferred delivery address has been updated."
        });
    }

    /* ======================================================
       PAYMENT METHODS
    ====================================================== */

    function normalizePaymentMethod(method) {
        const source = method || {};

        return {
            id: source.id || createId("payment"),
            provider: source.provider || "",
            type: source.type || "card",
            brand: source.brand || "Card",
            last4: source.last4 || "",
            expiryMonth: source.expiryMonth || "",
            expiryYear: source.expiryYear || "",
            holderName: source.holderName || "",
            tokenReference:
                source.tokenReference || "",
            default: source.default === true,
            createdAt: source.createdAt || null
        };
    }

    async function loadPaymentMethods() {
        const user = Profile.state.user;

        if (!user) {
            return [];
        }

        try {
            const snapshot =
                await getPaymentMethodsReference(
                    user.uid
                )
                    .orderBy("createdAt", "desc")
                    .get();

            Profile.state.paymentMethods =
                snapshot.docs.map(
                    function (documentSnapshot) {
                        return normalizePaymentMethod(
                            Object.assign(
                                {
                                    id:
                                        documentSnapshot.id
                                },
                                documentSnapshot.data()
                            )
                        );
                    }
                );

            renderPaymentMethods();

            return Profile.state.paymentMethods;
        } catch (error) {
            console.warn(
                "[Profile] Payment methods could not be loaded:",
                error
            );

            renderPaymentMethods();

            return [];
        }
    }

    function renderPaymentMethods() {
        const container =
            Profile.elements.paymentMethodsGrid;

        if (!container) {
            return;
        }

        container.innerHTML = "";

        const fragment =
            document.createDocumentFragment();

        Profile.state.paymentMethods.forEach(
            function (method) {
                fragment.appendChild(
                    createPaymentMethodCard(method)
                );
            }
        );

        container.appendChild(fragment);

        if (Profile.elements.paymentMethodsEmpty) {
            Profile.elements.paymentMethodsEmpty.hidden =
                Profile.state.paymentMethods.length > 0;
        }
    }

    function createPaymentMethodCard(method) {
        const article =
            document.createElement("article");

        article.className =
            "account-payment-card";

        article.dataset.paymentMethodId =
            method.id;

        article.innerHTML = [
            '<div class="payment-card-brand">',
            '<i class="' +
                escapeHTML(
                    getPaymentBrandIcon(
                        method.brand
                    )
                ) +
                '"></i>',
            "<div>",
            "<h4>" +
                escapeHTML(method.brand) +
                " •••• " +
                escapeHTML(method.last4) +
                "</h4>",
            "<p>Expires " +
                escapeHTML(method.expiryMonth) +
                "/" +
                escapeHTML(method.expiryYear) +
                "</p>",
            "</div>",
            "</div>",
            method.default
                ? '<span class="default-badge">Default</span>'
                : "",
            '<div class="account-card-actions">',
            !method.default
                ? '<button type="button" data-payment-default="' +
                  escapeHTML(method.id) +
                  '">Set default</button>'
                : "",
            '<button type="button" data-payment-delete="' +
                escapeHTML(method.id) +
                '" aria-label="Remove payment method">',
            '<i class="fa-regular fa-trash-can"></i>',
            "</button>",
            "</div>"
        ].join("");

        return article;
    }

    function getPaymentBrandIcon(brand) {
        const value =
            String(brand || "").toLowerCase();

        if (value.indexOf("visa") !== -1) {
            return "fa-brands fa-cc-visa";
        }

        if (
            value.indexOf("master") !== -1
        ) {
            return "fa-brands fa-cc-mastercard";
        }

        if (value.indexOf("amex") !== -1) {
            return "fa-brands fa-cc-amex";
        }

        return "fa-regular fa-credit-card";
    }

    async function savePaymentReference(data) {
        const user = Profile.state.user;

        if (!user) {
            throw new Error(
                "Sign in before saving a payment method."
            );
        }

        if (
            Profile.state.paymentMethods.length >=
            Profile.config.maximumPaymentMethods
        ) {
            throw new Error(
                "You have reached the maximum number of saved payment methods."
            );
        }

        /*
         * Never store raw card numbers, CVVs, or full payment credentials.
         * This method accepts only tokenized references returned by a
         * PCI-compliant payment provider.
         */
        const method = normalizePaymentMethod(data);

        if (
            !method.tokenReference ||
            !method.last4
        ) {
            throw new Error(
                "A secure payment token and masked card details are required."
            );
        }

        const reference =
            getPaymentMethodsReference(
                user.uid
            ).doc();

        if (method.default) {
            await unsetDefaultPaymentMethods();
        }

        await reference.set({
            provider: method.provider,
            type: method.type,
            brand: method.brand,
            last4: method.last4,
            expiryMonth: method.expiryMonth,
            expiryYear: method.expiryYear,
            holderName: method.holderName,
            tokenReference:
                method.tokenReference,
            default:
                method.default ||
                Profile.state.paymentMethods.length === 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        await loadPaymentMethods();

        return Object.assign({}, method, {
            id: reference.id
        });
    }

    async function unsetDefaultPaymentMethods() {
        const user = Profile.state.user;

        if (!user) {
            return;
        }

        const snapshot =
            await getPaymentMethodsReference(
                user.uid
            )
                .where("default", "==", true)
                .get();

        if (snapshot.empty) {
            return;
        }

        const batch = db.batch();

        snapshot.docs.forEach(
            function (documentSnapshot) {
                batch.update(
                    documentSnapshot.ref,
                    {
                        default: false,
                        updatedAt:
                            serverTimestamp()
                    }
                );
            }
        );

        await batch.commit();
    }

    async function setDefaultPaymentMethod(methodId) {
        const user = Profile.state.user;

        if (!user) {
            return;
        }

        await unsetDefaultPaymentMethods();

        await getPaymentMethodsReference(
            user.uid
        )
            .doc(methodId)
            .set(
                {
                    default: true,
                    updatedAt: serverTimestamp()
                },
                {
                    merge: true
                }
            );

        await loadPaymentMethods();

        app.showToast({
            type: "success",
            title: "Payment method updated",
            message:
                "Your default payment method has been updated."
        });
    }

    async function deletePaymentMethod(methodId) {
        const user = Profile.state.user;

        if (!user) {
            return;
        }

        const current =
            Profile.state.paymentMethods.find(
                function (method) {
                    return method.id === methodId;
                }
            );

        await getPaymentMethodsReference(
            user.uid
        )
            .doc(methodId)
            .delete();

        await loadPaymentMethods();

        if (
            current &&
            current.default &&
            Profile.state.paymentMethods.length
        ) {
            await setDefaultPaymentMethod(
                Profile.state.paymentMethods[0].id
            );
        }

        app.showToast({
            type: "success",
            title: "Payment method removed",
            message:
                "The saved payment method has been deleted."
        });
    }

    /* ======================================================
       PERSONAL DETAILS
    ====================================================== */

    async function saveProfileDetails(form) {
        if (!authModule) {
            throw new Error(
                "The authentication module is unavailable."
            );
        }

        const displayName =
            getFormValue(form, "displayName");

        const data = {
            displayName: displayName,
            phoneNumber:
                getFormValue(
                    form,
                    "phoneNumber"
                ),
            dateOfBirth:
                getFormValue(
                    form,
                    "dateOfBirth"
                ),
            gender:
                getFormValue(form, "gender"),
            country:
                getFormValue(form, "country"),
            preferredCurrency:
                getFormValue(
                    form,
                    "preferredCurrency"
                ) ||
                Profile.config.defaultCurrency
        };

        Profile.state.profile =
            await authModule.updateProfile(data);

        renderProfile();

        return Profile.state.profile;
    }

    async function savePreferences(form) {
        const preferences = {};

        [
            "marketingEmails",
            "orderUpdates",
            "productRecommendations",
            "wishlistUpdates",
            "securityAlerts"
        ].forEach(function (name) {
            preferences[name] =
                Boolean(
                    form.elements[name] &&
                    form.elements[name].checked
                );
        });

        await getUserReference(
            Profile.state.user.uid
        ).set(
            {
                preferences: preferences,
                updatedAt: serverTimestamp()
            },
            {
                merge: true
            }
        );

        Profile.state.profile =
            Object.assign(
                {},
                Profile.state.profile,
                {
                    preferences: preferences
                }
            );

        return preferences;
    }

    /* ======================================================
       AVATAR UPLOAD
    ====================================================== */

    function validateAvatarFile(file) {
        if (!file) {
            throw new Error(
                "Choose an image to upload."
            );
        }

        if (
            Profile.config.avatarAcceptedTypes.indexOf(
                file.type
            ) === -1
        ) {
            throw new Error(
                "Use a JPEG, PNG, or WebP image."
            );
        }

        if (
            file.size >
            Profile.config.avatarMaximumSize
        ) {
            throw new Error(
                "The image must be smaller than 5 MB."
            );
        }

        return true;
    }

    async function uploadAvatar(file) {
        const user = Profile.state.user;

        if (!user) {
            throw new Error(
                "Sign in before uploading a profile photo."
            );
        }

        validateAvatarFile(file);

        const storagePath =
            createStoragePath(
                "users",
                user.uid,
                "profile",
                generateStorageFileName(file.name)
            );

        const reference =
            storage.ref().child(storagePath);

        const uploadTask =
            reference.put(file, {
                contentType: file.type,
                customMetadata: {
                    userId: user.uid,
                    purpose: "profile-avatar"
                }
            });

        const snapshot =
            await observeUploadTask(uploadTask);

        const downloadURL =
            await snapshot.ref.getDownloadURL();

        await authModule.updateProfile({
            photoURL: downloadURL
        });

        Profile.state.profile =
            Object.assign(
                {},
                Profile.state.profile,
                {
                    photoURL: downloadURL
                }
            );

        renderProfile();

        return downloadURL;
    }

    function observeUploadTask(uploadTask) {
        return new Promise(function (resolve, reject) {
            uploadTask.on(
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
                            "profile:avatarprogress",
                            {
                                detail: {
                                    progress: progress
                                }
                            }
                        )
                    );
                },
                reject,
                function () {
                    resolve(uploadTask.snapshot);
                }
            );
        });
    }

    /* ======================================================
       PASSWORD & SECURITY
    ====================================================== */

    async function changePassword(form) {
        if (
            !authModule ||
            typeof authModule.updatePassword !==
                "function"
        ) {
            throw new Error(
                "Password updates are unavailable."
            );
        }

        const currentPassword =
            getFormValue(
                form,
                "currentPassword"
            );

        const newPassword =
            getFormValue(
                form,
                "newPassword"
            );

        const confirmPassword =
            getFormValue(
                form,
                "confirmPassword"
            );

        if (
            !currentPassword ||
            !newPassword
        ) {
            throw new Error(
                "Enter your current and new password."
            );
        }

        if (
            newPassword !==
            confirmPassword
        ) {
            throw new Error(
                "The new passwords do not match."
            );
        }

        await authModule.updatePassword(
            currentPassword,
            newPassword
        );

        form.reset();

        return true;
    }

    async function deleteAccount(password) {
        if (
            !authModule ||
            typeof authModule.deleteAccount !==
                "function"
        ) {
            throw new Error(
                "Account deletion is unavailable."
            );
        }

        await authModule.deleteAccount(password);

        Profile.state.user = null;
        Profile.state.profile = null;
        Profile.state.orders = [];
        Profile.state.addresses = [];
        Profile.state.paymentMethods = [];

        if (router) {
            await router.navigate("/", {
                replace: true
            });
        }

        return true;
    }

    /* ======================================================
       MODALS
    ====================================================== */

    function openModal(modal) {
        if (!modal) {
            return;
        }

        modal.classList.add("active", "open");
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

        modal.classList.remove("active", "open");
        modal.setAttribute(
            "aria-hidden",
            "true"
        );

        document.body.classList.remove(
            "no-scroll"
        );
    }

    /* ======================================================
       LOADING & BUTTON STATES
    ====================================================== */

    function setLoading(loading) {
        Profile.state.loading =
            Boolean(loading);

        if (Profile.elements.loading) {
            Profile.elements.loading.hidden =
                !loading;

            Profile.elements.loading.classList.toggle(
                "active",
                loading
            );
        }

        if (Profile.elements.page) {
            Profile.elements.page.setAttribute(
                "aria-busy",
                String(loading)
            );
        }
    }

    function setFormSaving(form, saving, label) {
        const button = form
            ? query(
                  'button[type="submit"]',
                  form
              )
            : null;

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

        const labelElement =
            query(
                "[data-button-label]",
                button
            );

        if (labelElement) {
            labelElement.textContent =
                saving
                    ? label || "Saving…"
                    : button.dataset.originalLabel ||
                      "Save";
        }
    }

    /* ======================================================
       FORM EVENTS
    ====================================================== */

    function bindFormEvents() {
        if (Profile.elements.profileForm) {
            Profile.elements.profileForm.addEventListener(
                "submit",
                async function (event) {
                    event.preventDefault();

                    const form = event.currentTarget;

                    setFormSaving(
                        form,
                        true,
                        "Saving details…"
                    );

                    try {
                        await saveProfileDetails(form);

                        app.showToast({
                            type: "success",
                            title: "Profile updated",
                            message:
                                "Your personal details have been saved."
                        });
                    } catch (error) {
                        app.showToast({
                            type: "error",
                            title: "Unable to save profile",
                            message: error.message
                        });
                    } finally {
                        setFormSaving(form, false);
                    }
                }
            );
        }

        if (Profile.elements.preferencesForm) {
            Profile.elements.preferencesForm.addEventListener(
                "submit",
                async function (event) {
                    event.preventDefault();

                    const form = event.currentTarget;

                    setFormSaving(
                        form,
                        true,
                        "Saving preferences…"
                    );

                    try {
                        await savePreferences(form);

                        app.showToast({
                            type: "success",
                            title: "Preferences updated",
                            message:
                                "Your communication preferences have been saved."
                        });
                    } catch (error) {
                        app.showToast({
                            type: "error",
                            title:
                                "Unable to save preferences",
                            message: error.message
                        });
                    } finally {
                        setFormSaving(form, false);
                    }
                }
            );
        }

        if (Profile.elements.passwordForm) {
            Profile.elements.passwordForm.addEventListener(
                "submit",
                async function (event) {
                    event.preventDefault();

                    const form = event.currentTarget;

                    setFormSaving(
                        form,
                        true,
                        "Updating password…"
                    );

                    try {
                        await changePassword(form);

                        app.showToast({
                            type: "success",
                            title: "Password updated",
                            message:
                                "Your password has been changed securely."
                        });
                    } catch (error) {
                        app.showToast({
                            type: "error",
                            title:
                                "Unable to update password",
                            message: error.message
                        });
                    } finally {
                        setFormSaving(form, false);
                    }
                }
            );
        }

        if (Profile.elements.addressForm) {
            Profile.elements.addressForm.addEventListener(
                "submit",
                async function (event) {
                    event.preventDefault();

                    const form = event.currentTarget;

                    setFormSaving(
                        form,
                        true,
                        "Saving address…"
                    );

                    try {
                        await saveAddressFromForm(form);

                        closeModal(
                            Profile.elements.addressModal
                        );

                        app.showToast({
                            type: "success",
                            title: "Address saved",
                            message:
                                "Your address book has been updated."
                        });
                    } catch (error) {
                        app.showToast({
                            type: "error",
                            title:
                                "Unable to save address",
                            message: error.message
                        });
                    } finally {
                        setFormSaving(form, false);
                    }
                }
            );
        }

        if (Profile.elements.paymentForm) {
            Profile.elements.paymentForm.addEventListener(
                "submit",
                async function (event) {
                    event.preventDefault();

                    const form = event.currentTarget;

                    setFormSaving(
                        form,
                        true,
                        "Saving payment method…"
                    );

                    try {
                        if (
                            !window.LEternelPayment ||
                            typeof window.LEternelPayment
                                .tokenizePaymentMethod !==
                                "function"
                        ) {
                            throw new Error(
                                "Connect a secure payment provider before saving payment methods."
                            );
                        }

                        const tokenized =
                            await window.LEternelPayment
                                .tokenizePaymentMethod(form);

                        await savePaymentReference(
                            tokenized
                        );

                        form.reset();

                        closeModal(
                            Profile.elements.paymentModal
                        );

                        app.showToast({
                            type: "success",
                            title:
                                "Payment method saved",
                            message:
                                "Your tokenized payment method has been saved securely."
                        });
                    } catch (error) {
                        app.showToast({
                            type: "error",
                            title:
                                "Unable to save payment method",
                            message: error.message
                        });
                    } finally {
                        setFormSaving(form, false);
                    }
                }
            );
        }

        if (Profile.elements.deleteAccountForm) {
            Profile.elements.deleteAccountForm.addEventListener(
                "submit",
                async function (event) {
                    event.preventDefault();

                    const form = event.currentTarget;

                    setFormSaving(
                        form,
                        true,
                        "Deleting account…"
                    );

                    try {
                        const password =
                            getFormValue(
                                form,
                                "password"
                            );

                        await deleteAccount(password);

                        closeModal(
                            Profile.elements.deleteAccountModal
                        );

                        app.showToast({
                            type: "success",
                            title: "Account deleted",
                            message:
                                "Your account has been deleted."
                        });
                    } catch (error) {
                        app.showToast({
                            type: "error",
                            title:
                                "Unable to delete account",
                            message: error.message
                        });
                    } finally {
                        setFormSaving(form, false);
                    }
                }
            );
        }
    }

    /* ======================================================
       CLICK EVENTS
    ====================================================== */

    function bindClickEvents() {
        document.addEventListener(
            "click",
            function (event) {
                const orderButton =
                    event.target.closest(
                        "[data-order-view]"
                    );

                if (orderButton) {
                    event.preventDefault();

                    openOrderDetail(
                        orderButton.dataset.orderView
                    ).catch(function (error) {
                        app.showToast({
                            type: "error",
                            title: "Order unavailable",
                            message: error.message
                        });
                    });

                    return;
                }

                const addressAddButton =
                    event.target.closest(
                        "[data-address-add]"
                    );

                if (addressAddButton) {
                    event.preventDefault();
                    openAddressModal();
                    return;
                }

                const addressEditButton =
                    event.target.closest(
                        "[data-address-edit]"
                    );

                if (addressEditButton) {
                    event.preventDefault();

                    openAddressModal(
                        addressEditButton.dataset
                            .addressEdit
                    );

                    return;
                }

                const addressDeleteButton =
                    event.target.closest(
                        "[data-address-delete]"
                    );

                if (addressDeleteButton) {
                    event.preventDefault();

                    deleteAddress(
                        addressDeleteButton.dataset
                            .addressDelete
                    ).catch(function (error) {
                        app.showToast({
                            type: "error",
                            title:
                                "Unable to remove address",
                            message: error.message
                        });
                    });

                    return;
                }

                const defaultAddressButton =
                    event.target.closest(
                        "[data-address-default]"
                    );

                if (defaultAddressButton) {
                    event.preventDefault();

                    setDefaultAddress(
                        defaultAddressButton.dataset
                            .addressDefault
                    ).catch(function (error) {
                        app.showToast({
                            type: "error",
                            message: error.message
                        });
                    });

                    return;
                }

                const addPaymentButton =
                    event.target.closest(
                        "[data-payment-add]"
                    );

                if (addPaymentButton) {
                    event.preventDefault();

                    openModal(
                        Profile.elements.paymentModal
                    );

                    return;
                }

                const paymentDeleteButton =
                    event.target.closest(
                        "[data-payment-delete]"
                    );

                if (paymentDeleteButton) {
                    event.preventDefault();

                    deletePaymentMethod(
                        paymentDeleteButton.dataset
                            .paymentDelete
                    ).catch(function (error) {
                        app.showToast({
                            type: "error",
                            title:
                                "Unable to remove payment method",
                            message: error.message
                        });
                    });

                    return;
                }

                const paymentDefaultButton =
                    event.target.closest(
                        "[data-payment-default]"
                    );

                if (paymentDefaultButton) {
                    event.preventDefault();

                    setDefaultPaymentMethod(
                        paymentDefaultButton.dataset
                            .paymentDefault
                    ).catch(function (error) {
                        app.showToast({
                            type: "error",
                            message: error.message
                        });
                    });

                    return;
                }

                const deleteAccountButton =
                    event.target.closest(
                        "[data-account-delete]"
                    );

                if (deleteAccountButton) {
                    event.preventDefault();

                    openModal(
                        Profile.elements
                            .deleteAccountModal
                    );

                    return;
                }

                const modalCloseButton =
                    event.target.closest(
                        "[data-profile-modal-close]"
                    );

                if (modalCloseButton) {
                    event.preventDefault();

                    closeModal(
                        modalCloseButton.closest(
                            ".modal, .account-overlay"
                        )
                    );
                }
            }
        );

        if (Profile.elements.ordersLoadMore) {
            Profile.elements.ordersLoadMore.addEventListener(
                "click",
                function () {
                    loadMoreOrders().catch(
                        function (error) {
                            app.showToast({
                                type: "error",
                                title:
                                    "Unable to load more orders",
                                message: error.message
                            });
                        }
                    );
                }
            );
        }

        Profile.elements.logoutButtons.forEach(
            function (button) {
                button.addEventListener(
                    "click",
                    function (event) {
                        event.preventDefault();

                        if (
                            authModule &&
                            typeof authModule.logout ===
                                "function"
                        ) {
                            authModule.logout();
                        }
                    }
                );
            }
        );
    }

    /* ======================================================
       AVATAR EVENTS
    ====================================================== */

    function bindAvatarEvents() {
        if (
            Profile.elements.avatarUploadButton &&
            Profile.elements.avatarInput
        ) {
            Profile.elements.avatarUploadButton.addEventListener(
                "click",
                function (event) {
                    event.preventDefault();

                    Profile.elements.avatarInput.click();
                }
            );
        }

        if (Profile.elements.avatarInput) {
            Profile.elements.avatarInput.addEventListener(
                "change",
                async function () {
                    const file =
                        Profile.elements.avatarInput.files &&
                        Profile.elements.avatarInput.files[0];

                    if (!file) {
                        return;
                    }

                    app.showLoader(
                        "Uploading profile photo…"
                    );

                    try {
                        await uploadAvatar(file);

                        app.showToast({
                            type: "success",
                            title:
                                "Profile photo updated",
                            message:
                                "Your new profile photo has been saved."
                        });
                    } catch (error) {
                        app.showToast({
                            type: "error",
                            title:
                                "Unable to upload photo",
                            message: error.message
                        });
                    } finally {
                        app.hideLoader();
                        Profile.elements.avatarInput.value =
                            "";
                    }
                }
            );
        }
    }

    /* ======================================================
       AUTH & ROUTER EVENTS
    ====================================================== */

    async function handleUserChange(user, profile) {
        unsubscribeFromProfile();

        Profile.state.user = user || null;
        Profile.state.profile =
            profile || null;

        Profile.state.orders = [];
        Profile.state.lastOrderSnapshot = null;
        Profile.state.ordersComplete = false;

        if (!user) {
            Profile.state.addresses = [];
            Profile.state.paymentMethods = [];
            return;
        }

        setLoading(true);

        try {
            if (!Profile.state.profile) {
                Profile.state.profile =
                    await loadProfile(user);
            }

            synchronizeProfileState();
            renderProfile();
            subscribeToProfile(user);

            await Promise.all([
                loadInitialOrders(),
                loadPaymentMethods()
            ]);
        } catch (error) {
            console.error(
                "[Profile] Account data could not be initialized:",
                error
            );

            app.showToast({
                type: "warning",
                title: "Account data",
                message:
                    "Some account information could not be loaded."
            });
        } finally {
            setLoading(false);
        }
    }

    function bindApplicationEvents() {
        document.addEventListener(
            "auth:statechange",
            function (event) {
                const detail =
                    event.detail || {};

                handleUserChange(
                    detail.user || null,
                    detail.profile || null
                );
            }
        );

        document.addEventListener(
            "router:change",
            function (event) {
                const detail =
                    event.detail || {};

                if (
                    detail.route &&
                    detail.route.accountSection
                ) {
                    activateSection(
                        detail.route.accountSection
                    );
                } else if (
                    detail.name === "account"
                ) {
                    activateSection("overview");
                }
            }
        );

        document.addEventListener(
            "wishlist:change",
            function () {
                if (
                    wishlist &&
                    typeof wishlist.getItemCount ===
                        "function"
                ) {
                    setElementsText(
                        Profile.elements
                            .overviewWishlistCount,
                        String(
                            wishlist.getItemCount()
                        )
                    );
                }
            }
        );
    }

    /* ======================================================
       INITIALIZATION
    ====================================================== */

    async function initialize() {
        if (Profile.initialized) {
            return;
        }

        cacheElements();
        bindFormEvents();
        bindClickEvents();
        bindAvatarEvents();
        bindApplicationEvents();

        Profile.initialized = true;

        if (auth.currentUser) {
            await handleUserChange(
                auth.currentUser,
                authModule
                    ? authModule.currentProfile
                    : null
            );
        }

        if (
            router &&
            router.currentRoute &&
            router.currentRoute.route
        ) {
            activateSection(
                router.currentRoute.route
                    .accountSection ||
                "overview"
            );
        }

        document.dispatchEvent(
            new CustomEvent(
                "profile:ready",
                {
                    detail: {
                        profile: Profile
                    }
                }
            )
        );

        console.info(
            "[Profile] L'ÉTERNEL customer account initialized."
        );
    }

    /* ======================================================
       PUBLIC API
    ====================================================== */

    Profile.init = initialize;

    Profile.load = loadProfile;
    Profile.render = renderProfile;
    Profile.activateSection =
        activateSection;

    Profile.fetchOrders = fetchOrders;
    Profile.loadOrders =
        loadInitialOrders;
    Profile.loadMoreOrders =
        loadMoreOrders;
    Profile.openOrderDetail =
        openOrderDetail;

    Profile.saveProfileDetails =
        saveProfileDetails;
    Profile.savePreferences =
        savePreferences;

    Profile.uploadAvatar =
        uploadAvatar;
    Profile.changePassword =
        changePassword;
    Profile.deleteAccount =
        deleteAccount;

    Profile.saveAddress =
        saveAddressFromForm;
    Profile.deleteAddress =
        deleteAddress;
    Profile.setDefaultAddress =
        setDefaultAddress;

    Profile.loadPaymentMethods =
        loadPaymentMethods;
    Profile.savePaymentReference =
        savePaymentReference;
    Profile.deletePaymentMethod =
        deletePaymentMethod;
    Profile.setDefaultPaymentMethod =
        setDefaultPaymentMethod;

    window.LEternelProfile =
        Profile;

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
