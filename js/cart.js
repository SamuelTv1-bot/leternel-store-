//javascript
"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   SHOPPING CART MODULE — FIREBASE V8
========================================================== */

(function initializeCartModule() {
    const app = window.LEternelApp;
    const router = window.LEternelRouter;
    const productsModule = window.LEternelProducts;
    const services = window.FirebaseServices;

    if (!app) {
        throw new Error(
            "LEternelApp was not found. Load app.js before cart.js."
        );
    }

    if (!services || !services.auth || !services.db) {
        throw new Error(
            "Firebase services were not found. Load firebase.js before cart.js."
        );
    }

    const auth = services.auth;
    const db = services.db;
    const serverTimestamp = services.helpers.serverTimestamp;

    const Cart = {
        initialized: false,

        config: {
            cartsCollection: "carts",
            productsCollection: "products",
            guestStorageKey: "leternel_guest_cart",
            currency: "NGN",
            locale: "en-NG",
            freeShippingThreshold: 250000,
            standardShippingFee: 15000,
            maximumItemQuantity: 10
        },

        state: {
            user: null,
            items: [],
            loading: false,
            syncing: false,
            subtotal: 0,
            shipping: 0,
            discount: 0,
            tax: 0,
            total: 0,
            itemCount: 0,
            coupon: null,
            unsubscribeCart: null
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

    function toNumber(value, fallback) {
        const number = Number(value);

        return Number.isFinite(number)
            ? number
            : Number(fallback) || 0;
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function createItemKey(item) {
        return [
            item.productId || "",
            item.variantId || "",
            item.size || "",
            item.color || ""
        ].join("::");
    }

    function normalizeQuantity(quantity) {
        return Math.min(
            Cart.config.maximumItemQuantity,
            Math.max(1, Math.floor(toNumber(quantity, 1)))
        );
    }

    function formatPrice(value, currency) {
        if (
            productsModule &&
            typeof productsModule.formatPrice === "function"
        ) {
            return productsModule.formatPrice(
                value,
                currency || Cart.config.currency
            );
        }

        try {
            return new Intl.NumberFormat(
                Cart.config.locale,
                {
                    style: "currency",
                    currency:
                        currency ||
                        Cart.config.currency,

                    maximumFractionDigits: 0
                }
            ).format(toNumber(value, 0));
        } catch (error) {
            return (
                (currency || Cart.config.currency) +
                " " +
                toNumber(value, 0).toLocaleString()
            );
        }
    }

    /* ======================================================
       ELEMENT CACHE
    ====================================================== */

    function cacheElements() {
        Cart.elements = {
          drawer:
    getById("cartDrawer") ||
    getById("cart-drawer") ||
    query(".cart-drawer") ||
    query(".drawer#cartDrawer"),

           drawerBody:
                getById("cart-items") ||
                query("[data-cart-items]"),

            emptyState:
                getById("cart-empty-state") ||
                query("[data-cart-empty]"),

            content:
                getById("cart-content") ||
                query("[data-cart-content]"),

            loading:
                getById("cart-loading") ||
                query("[data-cart-loading]"),

            subtotalElements: queryAll(
                "[data-cart-subtotal]"
            ),

            shippingElements: queryAll(
                "[data-cart-shipping]"
            ),

            discountElements: queryAll(
                "[data-cart-discount]"
            ),

            taxElements: queryAll(
                "[data-cart-tax]"
            ),

            totalElements: queryAll(
                "[data-cart-total]"
            ),

            itemCountElements: queryAll(
                "[data-cart-item-count]"
            ),

            checkoutButtons: queryAll(
                "[data-cart-checkout], .cart-checkout-button"
            ),

            clearButtons: queryAll(
                "[data-cart-clear]"
            ),

            shippingProgress:
                getById("cart-shipping-progress") ||
                query("[data-cart-shipping-progress]"),

            shippingMessage:
                getById("cart-shipping-message") ||
                query("[data-cart-shipping-message]"),

            couponForm:
                getById("cart-coupon-form") ||
                query("[data-cart-coupon-form]"),

            couponInput:
                getById("cart-coupon-input") ||
                query("[data-cart-coupon-input]"),

            couponMessage:
                getById("cart-coupon-message") ||
                query("[data-cart-coupon-message]")
        };
    }

    /* ======================================================
       ITEM NORMALIZATION
    ====================================================== */

    function normalizeCartItem(item) {
        const source = item || {};

        const normalized = {
            key: source.key || "",
            productId: String(source.productId || ""),
            variantId: String(source.variantId || ""),
            name: source.name || "Product",
            slug: source.slug || "",
            image: source.image || "",
            price: Math.max(0, toNumber(source.price, 0)),
            compareAtPrice: Math.max(
                0,
                toNumber(source.compareAtPrice, 0)
            ),
            currency:
                source.currency ||
                Cart.config.currency,

            quantity: normalizeQuantity(
                source.quantity
            ),

            size: source.size || "",
            color: source.color || "",
            sku: source.sku || "",
            stock: Math.max(
                0,
                toNumber(source.stock, 0)
            ),

            addedAt:
                source.addedAt || null,

            updatedAt:
                source.updatedAt || null
        };

        normalized.key =
            normalized.key ||
            createItemKey(normalized);

        return normalized;
    }

    function normalizeCartItems(items) {
        return Array.isArray(items)
            ? items
                  .map(normalizeCartItem)
                  .filter(function (item) {
                      return Boolean(item.productId);
                  })
            : [];
    }

    /* ======================================================
       GUEST CART STORAGE
    ====================================================== */

    function readGuestCart() {
        try {
            const storedValue =
                window.localStorage.getItem(
                    Cart.config.guestStorageKey
                );

            const parsedValue =
                JSON.parse(storedValue || "[]");

            return normalizeCartItems(parsedValue);
        } catch (error) {
            console.warn(
                "[Cart] Guest cart could not be read:",
                error
            );

            return [];
        }
    }

    function writeGuestCart(items) {
        try {
            window.localStorage.setItem(
                Cart.config.guestStorageKey,
                JSON.stringify(
                    normalizeCartItems(items)
                )
            );

            return true;
        } catch (error) {
            console.error(
                "[Cart] Guest cart could not be saved:",
                error
            );

            return false;
        }
    }

    function clearGuestCartStorage() {
        try {
            window.localStorage.removeItem(
                Cart.config.guestStorageKey
            );
        } catch (error) {
            console.warn(
                "[Cart] Guest cart storage could not be cleared:",
                error
            );
        }
    }

    /* ======================================================
       FIRESTORE CART
    ====================================================== */

    function getCartDocumentReference(uid) {
        return db
            .collection(Cart.config.cartsCollection)
            .doc(uid);
    }

    async function readUserCart(uid) {
        if (!uid) {
            return [];
        }

        const snapshot =
            await getCartDocumentReference(uid).get();

        if (!snapshot.exists) {
            return [];
        }

        const data = snapshot.data() || {};

        return normalizeCartItems(data.items);
    }

    async function writeUserCart(uid, items) {
        if (!uid) {
            return false;
        }

        const normalizedItems =
            normalizeCartItems(items);

        await getCartDocumentReference(uid).set(
            {
                userId: uid,
                items: normalizedItems.map(
                    serializeItemForFirestore
                ),
                itemCount: normalizedItems.reduce(
                    function (total, item) {
                        return total + item.quantity;
                    },
                    0
                ),
                subtotal: normalizedItems.reduce(
                    function (total, item) {
                        return (
                            total +
                            item.price *
                                item.quantity
                        );
                    },
                    0
                ),
                updatedAt: serverTimestamp()
            },
            {
                merge: true
            }
        );

        return true;
    }

    function serializeItemForFirestore(item) {
        return {
            key: item.key,
            productId: item.productId,
            variantId: item.variantId,
            name: item.name,
            slug: item.slug,
            image: item.image,
            price: item.price,
            compareAtPrice:
                item.compareAtPrice || 0,
            currency: item.currency,
            quantity: item.quantity,
            size: item.size,
            color: item.color,
            sku: item.sku,
            stock: item.stock,
            addedAt:
                item.addedAt ||
                new Date().toISOString(),
            updatedAt:
                new Date().toISOString()
        };
    }

    function subscribeToUserCart(uid) {
        unsubscribeFromUserCart();

        if (!uid) {
            return;
        }

        Cart.state.unsubscribeCart =
            getCartDocumentReference(uid)
                .onSnapshot(
                    function (snapshot) {
                        if (!snapshot.exists) {
                            setItems([], {
                                skipPersistence: true
                            });

                            return;
                        }

                        const data =
                            snapshot.data() || {};

                        setItems(
                            normalizeCartItems(data.items),
                            {
                                skipPersistence: true
                            }
                        );
                    },
                    function (error) {
                        console.error(
                            "[Cart] Real-time cart synchronization failed:",
                            error
                        );

                        app.showToast({
                            type: "warning",
                            title: "Cart synchronization",
                            message:
                                "Your cart could not be synchronized in real time."
                        });
                    }
                );
    }

    function unsubscribeFromUserCart() {
        if (
            typeof Cart.state.unsubscribeCart ===
            "function"
        ) {
            Cart.state.unsubscribeCart();
        }

        Cart.state.unsubscribeCart = null;
    }

    /* ======================================================
       CART MERGING
    ====================================================== */

    function mergeCartItems(primaryItems, secondaryItems) {
        const mergedMap = new Map();

        normalizeCartItems(primaryItems)
            .concat(
                normalizeCartItems(secondaryItems)
            )
            .forEach(function (item) {
                const existing =
                    mergedMap.get(item.key);

                if (!existing) {
                    mergedMap.set(
                        item.key,
                        clone(item)
                    );

                    return;
                }

                const combinedQuantity =
                    existing.quantity +
                    item.quantity;

                existing.quantity = Math.min(
                    item.stock > 0
                        ? item.stock
                        : Cart.config
                              .maximumItemQuantity,

                    Cart.config
                        .maximumItemQuantity,

                    combinedQuantity
                );

                existing.price = item.price;
                existing.stock = item.stock;
                existing.updatedAt =
                    new Date().toISOString();

                mergedMap.set(
                    item.key,
                    existing
                );
            });

        return Array.from(
            mergedMap.values()
        );
    }

    async function mergeGuestCartIntoUserCart(user) {
        if (!user) {
            return [];
        }

        const guestItems = readGuestCart();

        if (!guestItems.length) {
            const userItems =
                await readUserCart(user.uid);

            return userItems;
        }

        const userItems =
            await readUserCart(user.uid);

        const mergedItems =
            mergeCartItems(
                userItems,
                guestItems
            );

        await writeUserCart(
            user.uid,
            mergedItems
        );

        clearGuestCartStorage();

        app.showToast({
            type: "success",
            title: "Bag synchronized",
            message:
                "Your saved shopping bag has been added to your account."
        });

        return mergedItems;
    }

    /* ======================================================
       CART CALCULATIONS
    ====================================================== */

    function calculateTotals() {
        const subtotal =
            Cart.state.items.reduce(
                function (total, item) {
                    return (
                        total +
                        item.price *
                            item.quantity
                    );
                },
                0
            );

        const itemCount =
            Cart.state.items.reduce(
                function (total, item) {
                    return total + item.quantity;
                },
                0
            );

        const shipping =
            subtotal === 0 ||
            subtotal >=
                Cart.config.freeShippingThreshold
                ? 0
                : Cart.config
                      .standardShippingFee;

        const discount =
            calculateCouponDiscount(
                subtotal,
                Cart.state.coupon
            );

        const tax = 0;

        const total = Math.max(
            0,
            subtotal +
                shipping +
                tax -
                discount
        );

        Cart.state.subtotal = subtotal;
        Cart.state.shipping = shipping;
        Cart.state.discount = discount;
        Cart.state.tax = tax;
        Cart.state.total = total;
        Cart.state.itemCount = itemCount;

        return {
            subtotal: subtotal,
            shipping: shipping,
            discount: discount,
            tax: tax,
            total: total,
            itemCount: itemCount
        };
    }

    function calculateCouponDiscount(
        subtotal,
        coupon
    ) {
        if (!coupon || subtotal <= 0) {
            return 0;
        }

        if (
            coupon.minimumSpend &&
            subtotal < coupon.minimumSpend
        ) {
            return 0;
        }

        if (coupon.type === "percentage") {
            const discount =
                subtotal *
                (
                    toNumber(
                        coupon.value,
                        0
                    ) / 100
                );

            if (coupon.maximumDiscount) {
                return Math.min(
                    discount,
                    coupon.maximumDiscount
                );
            }

            return discount;
        }

        if (coupon.type === "fixed") {
            return Math.min(
                subtotal,
                toNumber(coupon.value, 0)
            );
        }

        return 0;
    }

    /* ======================================================
       CART STATE
    ====================================================== */

    function setItems(items, options) {
        const settings = options || {};

        Cart.state.items =
            normalizeCartItems(items);

        calculateTotals();
        render();

        if (!settings.skipPersistence) {
            persistCart().catch(
                function (error) {
                    console.error(
                        "[Cart] Cart persistence failed:",
                        error
                    );
                }
            );
        }

        dispatchCartChange();

        return Cart.state.items;
    }

    async function persistCart() {
        if (Cart.state.syncing) {
            return;
        }

        Cart.state.syncing = true;

        try {
            if (Cart.state.user) {
                await writeUserCart(
                    Cart.state.user.uid,
                    Cart.state.items
                );
            } else {
                writeGuestCart(
                    Cart.state.items
                );
            }
        } finally {
            Cart.state.syncing = false;
        }
    }

    function dispatchCartChange() {
        const detail = {
            items: clone(Cart.state.items),
            itemCount: Cart.state.itemCount,
            subtotal: Cart.state.subtotal,
            shipping: Cart.state.shipping,
            discount: Cart.state.discount,
            tax: Cart.state.tax,
            total: Cart.state.total,
            coupon: Cart.state.coupon
                ? clone(Cart.state.coupon)
                : null
        };

        document.dispatchEvent(
            new CustomEvent("cart:change", {
                detail: detail
            })
        );

        app.setCartCount(
            Cart.state.itemCount
        );
    }

    /* ======================================================
       PRODUCT VALIDATION
    ====================================================== */

    async function fetchFreshProduct(item) {
        if (
            productsModule &&
            typeof productsModule.fetchProductById ===
                "function"
        ) {
            return productsModule.fetchProductById(
                item.productId
            );
        }

        const snapshot = await db
            .collection(
                Cart.config.productsCollection
            )
            .doc(item.productId)
            .get();

        if (!snapshot.exists) {
            return null;
        }

        const data = snapshot.data() || {};

        return Object.assign(
            {
                id: snapshot.id
            },
            data
        );
    }

    function findProductVariant(
        product,
        item
    ) {
        const variants =
            Array.isArray(product.variants)
                ? product.variants
                : [];

        if (!variants.length) {
            return null;
        }

        return (
            variants.find(function (variant) {
                if (
                    item.variantId &&
                    variant.id === item.variantId
                ) {
                    return true;
                }

                return (
                    (!item.size ||
                        variant.size ===
                            item.size) &&
                    (!item.color ||
                        variant.color ===
                            item.color)
                );
            }) || null
        );
    }

    async function validateCartItem(item) {
        const product =
            await fetchFreshProduct(item);

        if (
            !product ||
            product.active === false ||
            product.published === false
        ) {
            return {
                valid: false,
                reason: "unavailable",
                message:
                    item.name +
                    " is no longer available."
            };
        }

        const variant =
            findProductVariant(
                product,
                item
            );

        const stock = variant
            ? Math.max(
                  0,
                  toNumber(variant.stock, 0)
              )
            : Math.max(
                  0,
                  toNumber(
                      product.inventory,
                      product.stock
                  )
              );

        const price =
            variant &&
            variant.price !== undefined &&
            variant.price !== null
                ? toNumber(
                      variant.price,
                      item.price
                  )
                : toNumber(
                      product.price,
                      item.price
                  );

        if (stock <= 0) {
            return {
                valid: false,
                reason: "out-of-stock",
                message:
                    item.name +
                    " is currently out of stock."
            };
        }

        return {
            valid: true,
            stock: stock,
            price: price,
            product: product,
            variant: variant
        };
    }

    async function validateCart() {
        if (!Cart.state.items.length) {
            return {
                valid: false,
                items: [],
                issues: [
                    {
                        reason: "empty",
                        message:
                            "Your shopping bag is empty."
                    }
                ]
            };
        }

        const validationResults =
            await Promise.all(
                Cart.state.items.map(
                    validateCartItem
                )
            );

        const validItems = [];
        const issues = [];
        let cartChanged = false;

        validationResults.forEach(
            function (result, index) {
                const item =
                    clone(
                        Cart.state.items[index]
                    );

                if (!result.valid) {
                    issues.push(result);
                    cartChanged = true;
                    return;
                }

                if (item.quantity > result.stock) {
                    item.quantity =
                        result.stock;

                    issues.push({
                        reason:
                            "quantity-adjusted",

                        message:
                            item.name +
                            " was adjusted to " +
                            result.stock +
                            " available unit" +
                            (
                                result.stock === 1
                                    ? ""
                                    : "s"
                            ) +
                            "."
                    });

                    cartChanged = true;
                }

                if (item.price !== result.price) {
                    item.price =
                        result.price;

                    issues.push({
                        reason:
                            "price-updated",

                        message:
                            "The price of " +
                            item.name +
                            " has been updated."
                    });

                    cartChanged = true;
                }

                item.stock =
                    result.stock;

                validItems.push(item);
            }
        );

        if (cartChanged) {
            await setItems(validItems);
        }

        return {
            valid:
                validItems.length > 0 &&
                issues.every(
                    function (issue) {
                        return (
                            issue.reason !==
                                "unavailable" &&
                            issue.reason !==
                                "out-of-stock"
                        );
                    }
                ),

            items: validItems,
            issues: issues
        };
    }

    /* ======================================================
       CART ACTIONS
    ====================================================== */

    async function addItem(item, options) {
        const settings = options || {};
        const normalizedItem =
            normalizeCartItem(item);

        if (!normalizedItem.productId) {
            throw new Error(
                "A valid product is required."
            );
        }

        if (
            normalizedItem.stock > 0 &&
            normalizedItem.quantity >
                normalizedItem.stock
        ) {
            throw new Error(
                "Only " +
                    normalizedItem.stock +
                    " units are available."
            );
        }

        const items =
            Cart.state.items.slice();

        const existingIndex =
            items.findIndex(function (cartItem) {
                return (
                    cartItem.key ===
                    normalizedItem.key
                );
            });

        if (existingIndex !== -1) {
            const existingItem =
                clone(items[existingIndex]);

            const requestedQuantity =
                existingItem.quantity +
                normalizedItem.quantity;

            const maximumAllowed =
                normalizedItem.stock > 0
                    ? Math.min(
                          normalizedItem.stock,
                          Cart.config
                              .maximumItemQuantity
                      )
                    : Cart.config
                          .maximumItemQuantity;

            if (
                requestedQuantity >
                maximumAllowed
            ) {
                throw new Error(
                    "You cannot add more than " +
                        maximumAllowed +
                        " of this item."
                );
            }

            existingItem.quantity =
                requestedQuantity;

            existingItem.price =
                normalizedItem.price;

            existingItem.stock =
                normalizedItem.stock;

            existingItem.updatedAt =
                new Date().toISOString();

            items[existingIndex] =
                existingItem;
        } else {
            normalizedItem.addedAt =
                normalizedItem.addedAt ||
                new Date().toISOString();

            normalizedItem.updatedAt =
                new Date().toISOString();

            items.push(normalizedItem);
        }

        await setItems(items);

        if (settings.openDrawer !== false) {
            app.openCart();
        }

        return normalizedItem;
    }

    async function removeItem(key, options) {
        const settings = options || {};

        const item =
            Cart.state.items.find(
                function (cartItem) {
                    return cartItem.key === key;
                }
            );

        const nextItems =
            Cart.state.items.filter(
                function (cartItem) {
                    return cartItem.key !== key;
                }
            );

        await setItems(nextItems);

        if (!settings.silent && item) {
            app.showToast({
                type: "info",
                title: "Removed from bag",
                message:
                    item.name +
                    " was removed from your shopping bag.",

                actionLabel: "Undo",
                onAction: function () {
                    addItem(item, {
                        openDrawer: false
                    }).catch(function (error) {
                        app.showToast({
                            type: "error",
                            message:
                                error.message
                        });
                    });
                }
            });
        }

        return true;
    }

    async function updateQuantity(
        key,
        quantity
    ) {
        const normalizedQuantity =
            Math.floor(
                toNumber(quantity, 1)
            );

        if (normalizedQuantity <= 0) {
            return removeItem(key);
        }

        const items =
            Cart.state.items.slice();

        const itemIndex =
            items.findIndex(function (item) {
                return item.key === key;
            });

        if (itemIndex === -1) {
            throw new Error(
                "The cart item could not be found."
            );
        }

        const item =
            clone(items[itemIndex]);

        const maximumAllowed =
            item.stock > 0
                ? Math.min(
                      item.stock,
                      Cart.config
                          .maximumItemQuantity
                  )
                : Cart.config
                      .maximumItemQuantity;

        if (
            normalizedQuantity >
            maximumAllowed
        ) {
            throw new Error(
                "Only " +
                    maximumAllowed +
                    " units are available."
            );
        }

        item.quantity =
            normalizedQuantity;

        item.updatedAt =
            new Date().toISOString();

        items[itemIndex] = item;

        await setItems(items);

        return item;
    }

    async function incrementItem(key) {
        const item =
            Cart.state.items.find(
                function (cartItem) {
                    return cartItem.key === key;
                }
            );

        if (!item) {
            return;
        }

        return updateQuantity(
            key,
            item.quantity + 1
        );
    }

    async function decrementItem(key) {
        const item =
            Cart.state.items.find(
                function (cartItem) {
                    return cartItem.key === key;
                }
            );

        if (!item) {
            return;
        }

        return updateQuantity(
            key,
            item.quantity - 1
        );
    }

    async function clearCart(options) {
        const settings = options || {};

        await setItems([]);

        Cart.state.coupon = null;

        if (!settings.silent) {
            app.showToast({
                type: "success",
                title: "Bag cleared",
                message:
                    "Your shopping bag is now empty."
            });
        }

        return true;
    }

    function getItems() {
        return clone(Cart.state.items);
    }

    function getItemCount() {
        return Cart.state.itemCount;
    }

    function getTotals() {
        return {
            subtotal: Cart.state.subtotal,
            shipping: Cart.state.shipping,
            discount: Cart.state.discount,
            tax: Cart.state.tax,
            total: Cart.state.total,
            itemCount: Cart.state.itemCount
        };
    }

    function hasItem(keyOrProductId) {
        return Cart.state.items.some(
            function (item) {
                return (
                    item.key === keyOrProductId ||
                    item.productId ===
                        keyOrProductId
                );
            }
        );
    }

    /* ======================================================
       COUPONS
    ====================================================== */

    async function applyCoupon(code) {
        const normalizedCode = String(
            code || ""
        )
            .trim()
            .toUpperCase();

        if (!normalizedCode) {
            throw new Error(
                "Enter a promo code."
            );
        }

        const snapshot = await db
            .collection("coupons")
            .where(
                "code",
                "==",
                normalizedCode
            )
            .where(
                "active",
                "==",
                true
            )
            .limit(1)
            .get();

        if (snapshot.empty) {
            throw new Error(
                "This promo code is invalid."
            );
        }

        const coupon = Object.assign(
            {
                id: snapshot.docs[0].id
            },
            snapshot.docs[0].data()
        );

        const now = Date.now();

        if (
            coupon.startsAt &&
            getDateValue(coupon.startsAt) > now
        ) {
            throw new Error(
                "This promo code is not active yet."
            );
        }

        if (
            coupon.expiresAt &&
            getDateValue(coupon.expiresAt) < now
        ) {
            throw new Error(
                "This promo code has expired."
            );
        }

        if (
            coupon.minimumSpend &&
            Cart.state.subtotal <
                coupon.minimumSpend
        ) {
            throw new Error(
                "Spend at least " +
                    formatPrice(
                        coupon.minimumSpend
                    ) +
                    " to use this code."
            );
        }

        Cart.state.coupon = {
            id: coupon.id,
            code: coupon.code,
            type: coupon.type,
            value: toNumber(
                coupon.value,
                0
            ),
            minimumSpend: toNumber(
                coupon.minimumSpend,
                0
            ),
            maximumDiscount: toNumber(
                coupon.maximumDiscount,
                0
            )
        };

        calculateTotals();
        render();
        dispatchCartChange();

        return Cart.state.coupon;
    }

    function removeCoupon() {
        Cart.state.coupon = null;

        calculateTotals();
        render();
        dispatchCartChange();
    }

    function getDateValue(value) {
        if (!value) {
            return 0;
        }

        if (
            typeof value.toMillis ===
            "function"
        ) {
            return value.toMillis();
        }

        if (value instanceof Date) {
            return value.getTime();
        }

        return new Date(value).getTime();
    }

    /* ======================================================
       CART RENDERING
    ====================================================== */

    function renderCartItem(item) {
        const article =
            document.createElement("article");

        article.className = "cart-item";
        article.dataset.cartItemKey =
            item.key;

        const productPath = router
            ? router.buildPath(
                  "product",
                  {
                      id: item.productId
                  }
              )
            : "/product/" +
              encodeURIComponent(
                  item.productId
              );

        const image =
            item.image ||
            "https://placehold.co/400x500?text=L%27ÉTERNEL";

        const details = [
            item.size
                ? "Size: " + item.size
                : "",

            item.color
                ? "Colour: " + item.color
                : "",

            item.sku
                ? "SKU: " + item.sku
                : ""
        ].filter(Boolean);

        article.innerHTML = [
            '<a class="cart-item-image" href="#' +
                productPath +
                '" data-route="' +
                productPath +
                '">',

            '<img src="' +
                escapeHTML(image) +
                '" alt="' +
                escapeHTML(item.name) +
                '">',

            "</a>",

            '<div class="cart-item-content">',

            '<div class="cart-item-header">',

            "<div>",

            '<h4 class="cart-item-title">',
            '<a href="#' +
                productPath +
                '" data-route="' +
                productPath +
                '">' +
                escapeHTML(item.name) +
                "</a>",
            "</h4>",

            details.length
                ? '<p class="cart-item-meta">' +
                  escapeHTML(
                      details.join(" · ")
                  ) +
                  "</p>"
                : "",

            "</div>",

            '<button type="button" class="cart-item-remove" data-cart-remove="' +
                escapeHTML(item.key) +
                '" aria-label="Remove ' +
                escapeHTML(item.name) +
                '">',

            '<i class="fa-solid fa-xmark"></i>',
            "</button>",

            "</div>",

            '<div class="cart-item-footer">',

            '<div class="cart-quantity-control">',

            '<button type="button" data-cart-decrease="' +
                escapeHTML(item.key) +
                '" aria-label="Decrease quantity">',

            '<i class="fa-solid fa-minus"></i>',
            "</button>",

            '<input type="number" min="1" max="' +
                escapeHTML(
                    item.stock ||
                        Cart.config
                            .maximumItemQuantity
                ) +
                '" value="' +
                escapeHTML(item.quantity) +
                '" data-cart-quantity="' +
                escapeHTML(item.key) +
                '" aria-label="Quantity for ' +
                escapeHTML(item.name) +
                '">',

            '<button type="button" data-cart-increase="' +
                escapeHTML(item.key) +
                '" aria-label="Increase quantity">',

            '<i class="fa-solid fa-plus"></i>',
            "</button>",

            "</div>",

            '<div class="cart-item-price">',

            item.quantity > 1
                ? '<small>' +
                  escapeHTML(
                      item.quantity +
                          " × " +
                          formatPrice(
                              item.price,
                              item.currency
                          )
                  ) +
                  "</small>"
                : "",

            "<strong>" +
                escapeHTML(
                    formatPrice(
                        item.price *
                            item.quantity,
                        item.currency
                    )
                ) +
                "</strong>",

            "</div>",
            "</div>",
            "</div>"
        ].join("");

        return article;
    }

    function renderItems() {
        const container =
            Cart.elements.drawerBody;

        if (!container) {
            return;
        }

        container.innerHTML = "";

        const fragment =
            document.createDocumentFragment();

        Cart.state.items.forEach(
            function (item) {
                fragment.appendChild(
                    renderCartItem(item)
                );
            }
        );

        container.appendChild(fragment);
    }

    function renderTotals() {
        setElementsText(
            Cart.elements.subtotalElements,
            formatPrice(
                Cart.state.subtotal
            )
        );

        setElementsText(
            Cart.elements.shippingElements,
            Cart.state.shipping === 0
                ? "Complimentary"
                : formatPrice(
                      Cart.state.shipping
                  )
        );

        setElementsText(
            Cart.elements.discountElements,
            Cart.state.discount > 0
                ? "-" +
                  formatPrice(
                      Cart.state.discount
                  )
                : formatPrice(0)
        );

        setElementsText(
            Cart.elements.taxElements,
            formatPrice(
                Cart.state.tax
            )
        );

        setElementsText(
            Cart.elements.totalElements,
            formatPrice(
                Cart.state.total
            )
        );

        setElementsText(
            Cart.elements.itemCountElements,
            Cart.state.itemCount === 1
                ? "1 item"
                : Cart.state.itemCount +
                  " items"
        );
    }

    function setElementsText(
        elements,
        value
    ) {
        elements.forEach(
            function (element) {
                element.textContent = value;
            }
        );
    }

    function renderShippingProgress() {
        const remaining = Math.max(
            0,
            Cart.config
                    .freeShippingThreshold -
                Cart.state.subtotal
        );

        const percentage = Math.min(
            100,
            (
                Cart.state.subtotal /
                Cart.config
                    .freeShippingThreshold
            ) *
                100
        );

        if (Cart.elements.shippingProgress) {
            Cart.elements.shippingProgress.style.width =
                percentage + "%";

            Cart.elements.shippingProgress.setAttribute(
                "aria-valuenow",
                String(
                    Math.round(percentage)
                )
            );
        }

        if (Cart.elements.shippingMessage) {
            Cart.elements.shippingMessage.textContent =
                remaining <= 0
                    ? "You qualify for complimentary delivery."
                    : "Add " +
                      formatPrice(remaining) +
                      " more for complimentary delivery.";
        }
    }

    function renderCoupon() {
        if (!Cart.elements.couponMessage) {
            return;
        }

        const coupon =
            Cart.state.coupon;

        Cart.elements.couponMessage.classList.remove(
            "success",
            "error"
        );

        if (!coupon) {
            Cart.elements.couponMessage.textContent =
                "";

            Cart.elements.couponMessage.hidden =
                true;

            return;
        }

        Cart.elements.couponMessage.hidden =
            false;

        Cart.elements.couponMessage.classList.add(
            "success"
        );

        Cart.elements.couponMessage.innerHTML =
            "Promo code <strong>" +
            escapeHTML(coupon.code) +
            "</strong> applied. " +
            '<button type="button" data-cart-coupon-remove>Remove</button>';
    }

    function renderEmptyState() {
        const hasItems =
            Cart.state.items.length > 0;

        if (Cart.elements.emptyState) {
            Cart.elements.emptyState.hidden =
                hasItems;
        }

        if (Cart.elements.content) {
            Cart.elements.content.hidden =
                !hasItems;
        }

        Cart.elements.checkoutButtons.forEach(
            function (button) {
                button.disabled = !hasItems;
            }
        );
    }

    function renderLoading(loading) {
        Cart.state.loading = Boolean(loading);

        if (Cart.elements.loading) {
            Cart.elements.loading.hidden =
                !loading;

            Cart.elements.loading.classList.toggle(
                "active",
                loading
            );
        }

        if (Cart.elements.drawer) {
            Cart.elements.drawer.setAttribute(
                "aria-busy",
                String(loading)
            );
        }
    }

    function render() {
        renderItems();
        renderTotals();
        renderShippingProgress();
        renderCoupon();
        renderEmptyState();
    }

    /* ======================================================
       CHECKOUT
    ====================================================== */

    async function proceedToCheckout() {
        if (!Cart.state.items.length) {
            app.showToast({
                type: "warning",
                title: "Your bag is empty",
                message:
                    "Add at least one piece before checking out."
            });

            return false;
        }

        app.showLoader(
            "Checking availability…"
        );

        try {
            const validation =
                await validateCart();

            validation.issues.forEach(
                function (issue) {
                    app.showToast({
                        type:
                            issue.reason ===
                                "unavailable" ||
                            issue.reason ===
                                "out-of-stock"
                                ? "error"
                                : "warning",

                        title: "Bag updated",
                        message: issue.message
                    });
                }
            );

            if (
                !validation.items.length
            ) {
                return false;
            }

            if (router) {
                await router.navigate(
                    "/checkout"
                );
            }

            return true;
        } catch (error) {
            app.showToast({
                type: "error",
                title: "Checkout unavailable",
                message:
                    error.message ||
                    "Your bag could not be validated."
            });

            return false;
        } finally {
            app.hideLoader();
        }
    }

    /* ======================================================
       AUTHENTICATION SYNCHRONIZATION
    ====================================================== */

    async function handleUserChange(user) {
        renderLoading(true);

        try {
            unsubscribeFromUserCart();

            Cart.state.user = user || null;

            if (user) {
                const mergedItems =
                    await mergeGuestCartIntoUserCart(
                        user
                    );

                setItems(
                    mergedItems,
                    {
                        skipPersistence: true
                    }
                );

                subscribeToUserCart(
                    user.uid
                );
            } else {
                const guestItems =
                    readGuestCart();

                setItems(
                    guestItems,
                    {
                        skipPersistence: true
                    }
                );
            }
        } catch (error) {
            console.error(
                "[Cart] User cart initialization failed:",
                error
            );

            app.showToast({
                type: "warning",
                title: "Cart synchronization",
                message:
                    "Your shopping bag could not be fully synchronized."
            });
        } finally {
            renderLoading(false);
        }
    }

    /* ======================================================
       EVENT HANDLERS
    ====================================================== */

    async function handleQuantityInput(input) {
        try {
            await updateQuantity(
                input.dataset.cartQuantity,
                input.value
            );
        } catch (error) {
            const item =
                Cart.state.items.find(
                    function (cartItem) {
                        return (
                            cartItem.key ===
                            input.dataset
                                .cartQuantity
                        );
                    }
                );

            if (item) {
                input.value =
                    item.quantity;
            }

            app.showToast({
                type: "warning",
                title: "Quantity unavailable",
                message: error.message
            });
        }
    }

    async function handleCouponSubmit(event) {
        event.preventDefault();

        const input =
            Cart.elements.couponInput ||
            query(
                'input[name="coupon"]',
                event.currentTarget
            );

        const button = query(
            'button[type="submit"]',
            event.currentTarget
        );

        if (!input) {
            return;
        }

        if (button) {
            button.disabled = true;
            button.classList.add("loading");
        }

        try {
            const coupon =
                await applyCoupon(
                    input.value
                );

            input.value = "";

            app.showToast({
                type: "success",
                title: "Promo applied",
                message:
                    coupon.code +
                    " has been applied to your order."
            });
        } catch (error) {
            if (Cart.elements.couponMessage) {
                Cart.elements.couponMessage.hidden =
                    false;

                Cart.elements.couponMessage.classList.remove(
                    "success"
                );

                Cart.elements.couponMessage.classList.add(
                    "error"
                );

                Cart.elements.couponMessage.textContent =
                    error.message;
            }

            app.showToast({
                type: "error",
                title: "Promo unavailable",
                message: error.message
            });
        } finally {
            if (button) {
                button.disabled = false;
                button.classList.remove(
                    "loading"
                );
            }
        }
    }

    function bindCartEvents() {
        document.addEventListener(
            "click",
            function (event) {
                const removeButton =
                    event.target.closest(
                        "[data-cart-remove]"
                    );

                if (removeButton) {
                    event.preventDefault();

                    removeItem(
                        removeButton.dataset
                            .cartRemove
                    ).catch(function (error) {
                        app.showToast({
                            type: "error",
                            message:
                                error.message
                        });
                    });

                    return;
                }

                const increaseButton =
                    event.target.closest(
                        "[data-cart-increase]"
                    );

                if (increaseButton) {
                    event.preventDefault();

                    incrementItem(
                        increaseButton.dataset
                            .cartIncrease
                    ).catch(function (error) {
                        app.showToast({
                            type: "warning",
                            message:
                                error.message
                        });
                    });

                    return;
                }

                const decreaseButton =
                    event.target.closest(
                        "[data-cart-decrease]"
                    );

                if (decreaseButton) {
                    event.preventDefault();

                    decrementItem(
                        decreaseButton.dataset
                            .cartDecrease
                    ).catch(function (error) {
                        app.showToast({
                            type: "warning",
                            message:
                                error.message
                        });
                    });

                    return;
                }

                const checkoutButton =
                    event.target.closest(
                        "[data-cart-checkout], .cart-checkout-button"
                    );

                if (checkoutButton) {
                    event.preventDefault();
                    proceedToCheckout();
                    return;
                }

                const clearButton =
                    event.target.closest(
                        "[data-cart-clear]"
                    );

                if (clearButton) {
                    event.preventDefault();

                    clearCart().catch(
                        function (error) {
                            app.showToast({
                                type: "error",
                                message:
                                    error.message
                            });
                        }
                    );

                    return;
                }

                const removeCouponButton =
                    event.target.closest(
                        "[data-cart-coupon-remove]"
                    );

                if (removeCouponButton) {
                    event.preventDefault();
                    removeCoupon();
                }
            }
        );

        document.addEventListener(
            "change",
            function (event) {
                const quantityInput =
                    event.target.closest(
                        "[data-cart-quantity]"
                    );

                if (quantityInput) {
                    handleQuantityInput(
                        quantityInput
                    );
                }
            }
        );

        if (Cart.elements.couponForm) {
            Cart.elements.couponForm.addEventListener(
                "submit",
                handleCouponSubmit
            );
        }

        document.addEventListener(
            "products:addtocart",
            function (event) {
                if (
                    !event.detail ||
                    !event.detail.item
                ) {
                    return;
                }

                addItem(
                    event.detail.item
                ).catch(function (error) {
                    app.showToast({
                        type: "error",
                        title:
                            "Unable to add product",
                        message:
                            error.message
                    });
                });
            }
        );

        document.addEventListener(
            "auth:statechange",
            function (event) {
                handleUserChange(
                    event.detail
                        ? event.detail.user
                        : null
                );
            }
        );
    }

    /* ======================================================
       INITIALIZATION
    ====================================================== */

    async function initialize() {
        if (Cart.initialized) {
            return;
        }

        cacheElements();
        bindCartEvents();

        Cart.initialized = true;

        const currentUser =
            auth.currentUser;

        await handleUserChange(
            currentUser
        );

        document.dispatchEvent(
            new CustomEvent("cart:ready", {
                detail: {
                    cart: Cart
                }
            })
        );

        console.info(
            "[Cart] L'ÉTERNEL shopping cart initialized."
        );
    }

    /* ======================================================
       PUBLIC API
    ====================================================== */

    Cart.init = initialize;

    Cart.addItem = addItem;
    Cart.removeItem = removeItem;
    Cart.updateQuantity = updateQuantity;
    Cart.incrementItem = incrementItem;
    Cart.decrementItem = decrementItem;
    Cart.clear = clearCart;

    Cart.getItems = getItems;
    Cart.getItemCount = getItemCount;
    Cart.getTotals = getTotals;
    Cart.hasItem = hasItem;

    Cart.applyCoupon = applyCoupon;
    Cart.removeCoupon = removeCoupon;

    Cart.validate = validateCart;
    Cart.proceedToCheckout =
        proceedToCheckout;

    Cart.render = render;
    Cart.persist = persistCart;

    window.LEternelCart = Cart;

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
