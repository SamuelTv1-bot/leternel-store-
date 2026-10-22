"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   WISHLIST MODULE — FIREBASE V8
========================================================== */

(function initializeWishlistModule() {
    const app = window.LEternelApp;
    const router = window.LEternelRouter;
    const productsModule = window.LEternelProducts;
    const cartModule = window.LEternelCart;
    const services = window.FirebaseServices;

    if (!app) {
        throw new Error(
            "LEternelApp was not found. Load app.js before wishlist.js."
        );
    }

    if (!services || !services.auth || !services.db) {
        throw new Error(
            "Firebase services were not found. Load firebase.js before wishlist.js."
        );
    }

    const auth = services.auth;
    const db = services.db;
    const serverTimestamp = services.helpers.serverTimestamp;

    const Wishlist = {
        initialized: false,

        config: {
            wishlistsCollection: "wishlists",
            productsCollection: "products",
            guestStorageKey: "leternel_guest_wishlist",
            maximumItems: 100,
            defaultCurrency: "NGN"
        },

        state: {
            user: null,
            items: [],
            loading: false,
            syncing: false,
            unsubscribeWishlist: null
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

    function formatPrice(value, currency) {
        if (
            productsModule &&
            typeof productsModule.formatPrice === "function"
        ) {
            return productsModule.formatPrice(
                value,
                currency || Wishlist.config.defaultCurrency
            );
        }

        try {
            return new Intl.NumberFormat("en-NG", {
                style: "currency",
                currency:
                    currency ||
                    Wishlist.config.defaultCurrency,
                maximumFractionDigits: 0
            }).format(toNumber(value, 0));
        } catch (error) {
            return (
                (currency || Wishlist.config.defaultCurrency) +
                " " +
                toNumber(value, 0).toLocaleString()
            );
        }
    }

    /* ======================================================
       ELEMENT CACHE
    ====================================================== */

    function cacheElements() {
        Wishlist.elements = {
            drawer:
                getById("wishlist-drawer") ||
                query(".wishlist-drawer"),

            drawerItems:
                getById("wishlist-items") ||
                query("[data-wishlist-items]"),

            drawerEmpty:
                getById("wishlist-empty-state") ||
                query("[data-wishlist-empty]"),

            drawerContent:
                getById("wishlist-content") ||
                query("[data-wishlist-content]"),

            loading:
                getById("wishlist-loading") ||
                query("[data-wishlist-loading]"),

            clearButtons: queryAll(
                "[data-wishlist-clear]"
            ),

            accountGrid:
                getById("account-wishlist-grid") ||
                query("[data-account-wishlist-grid]"),

            accountEmpty:
                getById("account-wishlist-empty") ||
                query("[data-account-wishlist-empty]"),

            countElements: queryAll(
                "[data-wishlist-item-count]"
            )
        };
    }

    /* ======================================================
       ITEM NORMALIZATION
    ====================================================== */

    function normalizeWishlistItem(item) {
        const source = item || {};

        return {
            productId: String(
                source.productId ||
                source.id ||
                ""
            ),

            name:
                source.name ||
                source.title ||
                "Product",

            slug: source.slug || "",

            category: source.category || "",

            image:
                source.image ||
                source.primaryImage ||
                (
                    Array.isArray(source.images) &&
                    source.images.length
                        ? typeof source.images[0] === "string"
                            ? source.images[0]
                            : source.images[0].url ||
                              source.images[0].src ||
                              ""
                        : ""
                ),

            secondaryImage:
                source.secondaryImage || "",

            price: Math.max(
                0,
                toNumber(source.price, 0)
            ),

            compareAtPrice: Math.max(
                0,
                toNumber(
                    source.compareAtPrice ||
                    source.oldPrice,
                    0
                )
            ),

            currency:
                source.currency ||
                Wishlist.config.defaultCurrency,

            inStock:
                source.inStock !== false,

            inventory: Math.max(
                0,
                toNumber(
                    source.inventory ||
                    source.stock,
                    0
                )
            ),

            sizes: Array.isArray(source.sizes)
                ? source.sizes
                : [],

            colors: Array.isArray(source.colors)
                ? source.colors
                : [],

            variants: Array.isArray(source.variants)
                ? source.variants
                : [],

            sku: source.sku || "",

            addedAt:
                source.addedAt ||
                new Date().toISOString(),

            updatedAt:
                source.updatedAt ||
                new Date().toISOString()
        };
    }

    function normalizeWishlistItems(items) {
        const uniqueProducts = new Map();

        (Array.isArray(items) ? items : [])
            .map(normalizeWishlistItem)
            .filter(function (item) {
                return Boolean(item.productId);
            })
            .forEach(function (item) {
                uniqueProducts.set(
                    item.productId,
                    item
                );
            });

        return Array.from(
            uniqueProducts.values()
        ).slice(
            0,
            Wishlist.config.maximumItems
        );
    }

    function normalizeProductForWishlist(product) {
        if (
            productsModule &&
            typeof productsModule.normalizeProduct === "function"
        ) {
            return normalizeWishlistItem(
                productsModule.normalizeProduct(product)
            );
        }

        return normalizeWishlistItem(product);
    }

    /* ======================================================
       GUEST STORAGE
    ====================================================== */

    function readGuestWishlist() {
        try {
            const storedValue =
                window.localStorage.getItem(
                    Wishlist.config.guestStorageKey
                );

            const parsedValue =
                JSON.parse(storedValue || "[]");

            return normalizeWishlistItems(
                parsedValue
            );
        } catch (error) {
            console.warn(
                "[Wishlist] Guest wishlist could not be read:",
                error
            );

            return [];
        }
    }

    function writeGuestWishlist(items) {
        try {
            window.localStorage.setItem(
                Wishlist.config.guestStorageKey,
                JSON.stringify(
                    normalizeWishlistItems(items)
                )
            );

            return true;
        } catch (error) {
            console.error(
                "[Wishlist] Guest wishlist could not be saved:",
                error
            );

            return false;
        }
    }

    function clearGuestWishlistStorage() {
        try {
            window.localStorage.removeItem(
                Wishlist.config.guestStorageKey
            );
        } catch (error) {
            console.warn(
                "[Wishlist] Guest wishlist storage could not be cleared:",
                error
            );
        }
    }

    /* ======================================================
       FIRESTORE WISHLIST
    ====================================================== */

    function getWishlistDocumentReference(uid) {
        return db
            .collection(
                Wishlist.config.wishlistsCollection
            )
            .doc(uid);
    }

    async function readUserWishlist(uid) {
        if (!uid) {
            return [];
        }

        const snapshot =
            await getWishlistDocumentReference(uid).get();

        if (!snapshot.exists) {
            return [];
        }

        const data = snapshot.data() || {};

        return normalizeWishlistItems(
            data.items
        );
    }

    async function writeUserWishlist(uid, items) {
        if (!uid) {
            return false;
        }

        const normalizedItems =
            normalizeWishlistItems(items);

        await getWishlistDocumentReference(uid).set(
            {
                userId: uid,
                items: normalizedItems,
                itemCount: normalizedItems.length,
                updatedAt: serverTimestamp()
            },
            {
                merge: true
            }
        );

        return true;
    }

    function subscribeToUserWishlist(uid) {
        unsubscribeFromUserWishlist();

        if (!uid) {
            return;
        }

        Wishlist.state.unsubscribeWishlist =
            getWishlistDocumentReference(uid)
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
                            data.items || [],
                            {
                                skipPersistence: true
                            }
                        );
                    },
                    function (error) {
                        console.error(
                            "[Wishlist] Real-time synchronization failed:",
                            error
                        );

                        app.showToast({
                            type: "warning",
                            title: "Wishlist synchronization",
                            message:
                                "Your wishlist could not be synchronized in real time."
                        });
                    }
                );
    }

    function unsubscribeFromUserWishlist() {
        if (
            typeof Wishlist.state
                .unsubscribeWishlist === "function"
        ) {
            Wishlist.state.unsubscribeWishlist();
        }

        Wishlist.state.unsubscribeWishlist = null;
    }

    /* ======================================================
       MERGING
    ====================================================== */

    function mergeWishlistItems(
        primaryItems,
        secondaryItems
    ) {
        return normalizeWishlistItems(
            normalizeWishlistItems(primaryItems).concat(
                normalizeWishlistItems(secondaryItems)
            )
        );
    }

    async function mergeGuestWishlistIntoUserWishlist(
        user
    ) {
        if (!user) {
            return [];
        }

        const guestItems =
            readGuestWishlist();

        const userItems =
            await readUserWishlist(user.uid);

        if (!guestItems.length) {
            return userItems;
        }

        const mergedItems =
            mergeWishlistItems(
                userItems,
                guestItems
            );

        await writeUserWishlist(
            user.uid,
            mergedItems
        );

        clearGuestWishlistStorage();

        app.showToast({
            type: "success",
            title: "Wishlist synchronized",
            message:
                "Your saved pieces have been added to your account."
        });

        return mergedItems;
    }

    /* ======================================================
       STATE & PERSISTENCE
    ====================================================== */

    function setItems(items, options) {
        const settings = options || {};

        Wishlist.state.items =
            normalizeWishlistItems(items);

        render();
        updateProductButtons();
        updateCount();
        dispatchWishlistChange();

        if (!settings.skipPersistence) {
            persistWishlist().catch(
                function (error) {
                    console.error(
                        "[Wishlist] Persistence failed:",
                        error
                    );
                }
            );
        }

        return Wishlist.state.items;
    }

    async function persistWishlist() {
        if (Wishlist.state.syncing) {
            return false;
        }

        Wishlist.state.syncing = true;

        try {
            if (Wishlist.state.user) {
                await writeUserWishlist(
                    Wishlist.state.user.uid,
                    Wishlist.state.items
                );
            } else {
                writeGuestWishlist(
                    Wishlist.state.items
                );
            }

            return true;
        } finally {
            Wishlist.state.syncing = false;
        }
    }

    function dispatchWishlistChange() {
        document.dispatchEvent(
            new CustomEvent(
                "wishlist:change",
                {
                    detail: {
                        items: clone(
                            Wishlist.state.items
                        ),
                        itemCount:
                            Wishlist.state.items.length
                    }
                }
            )
        );
    }

    function updateCount() {
        const count =
            Wishlist.state.items.length;

        if (
            typeof app.setWishlistCount === "function"
        ) {
            app.setWishlistCount(count);
        }

        Wishlist.elements.countElements.forEach(
            function (element) {
                element.textContent =
                    count === 1
                        ? "1 item"
                        : count + " items";
            }
        );
    }

    /* ======================================================
       BASIC ACTIONS
    ====================================================== */

    function getItems() {
        return clone(
            Wishlist.state.items
        );
    }

    function getItemCount() {
        return Wishlist.state.items.length;
    }

    function hasItem(productId) {
        const normalizedId =
            String(productId || "");

        return Wishlist.state.items.some(
            function (item) {
                return (
                    item.productId ===
                    normalizedId
                );
            }
        );
    }

    function getItem(productId) {
        const normalizedId =
            String(productId || "");

        return (
            Wishlist.state.items.find(
                function (item) {
                    return (
                        item.productId ===
                        normalizedId
                    );
                }
            ) || null
        );
    }

    async function add(product, options) {
        const settings = options || {};
        const item =
            normalizeProductForWishlist(product);

        if (!item.productId) {
            throw new Error(
                "A valid product is required."
            );
        }

        if (hasItem(item.productId)) {
            return getItem(item.productId);
        }

        if (
            Wishlist.state.items.length >=
            Wishlist.config.maximumItems
        ) {
            throw new Error(
                "Your wishlist has reached its maximum capacity."
            );
        }

        const items =
            Wishlist.state.items.slice();

        items.unshift(item);

        await setItems(items);

        if (!settings.silent) {
            app.showToast({
                type: "success",
                title: "Saved to wishlist",
                message:
                    item.name +
                    " has been added to your wishlist.",

                actionLabel: "View wishlist",
                onAction: app.openWishlist
            });
        }

        return item;
    }

    async function remove(productId, options) {
        const settings = options || {};
        const item = getItem(productId);

        if (!item) {
            return false;
        }

        const nextItems =
            Wishlist.state.items.filter(
                function (wishlistItem) {
                    return (
                        wishlistItem.productId !==
                        item.productId
                    );
                }
            );

        await setItems(nextItems);

        if (!settings.silent) {
            app.showToast({
                type: "info",
                title: "Removed from wishlist",
                message:
                    item.name +
                    " was removed from your wishlist.",

                actionLabel: "Undo",
                onAction: function () {
                    add(item, {
                        silent: true
                    }).catch(function (error) {
                        app.showToast({
                            type: "error",
                            message: error.message
                        });
                    });
                }
            });
        }

        return true;
    }

    async function toggle(product, options) {
        const item =
            normalizeProductForWishlist(product);

        if (hasItem(item.productId)) {
            await remove(
                item.productId,
                options
            );

            return {
                added: false,
                item: item
            };
        }

        await add(item, options);

        return {
            added: true,
            item: item
        };
    }

    async function clear(options) {
        const settings = options || {};

        await setItems([]);

        if (!settings.silent) {
            app.showToast({
                type: "success",
                title: "Wishlist cleared",
                message:
                    "All saved pieces have been removed."
            });
        }

        return true;
    }

    /* ======================================================
       PRODUCT REFRESH
    ====================================================== */

    async function fetchFreshProduct(productId) {
        if (
            productsModule &&
            typeof productsModule.fetchProductById ===
                "function"
        ) {
            return productsModule.fetchProductById(
                productId
            );
        }

        const snapshot = await db
            .collection(
                Wishlist.config.productsCollection
            )
            .doc(productId)
            .get();

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

    async function refreshItem(productId) {
        const freshProduct =
            await fetchFreshProduct(productId);

        if (!freshProduct) {
            await remove(productId, {
                silent: true
            });

            return null;
        }

        const normalizedProduct =
            normalizeProductForWishlist(
                freshProduct
            );

        const items =
            Wishlist.state.items.map(
                function (item) {
                    return item.productId ===
                        productId
                        ? Object.assign(
                              {},
                              item,
                              normalizedProduct,
                              {
                                  addedAt:
                                      item.addedAt
                              }
                          )
                        : item;
                }
            );

        await setItems(items);

        return normalizedProduct;
    }

    async function refreshAllItems() {
        if (!Wishlist.state.items.length) {
            return [];
        }

        const results =
            await Promise.all(
                Wishlist.state.items.map(
                    function (item) {
                        return fetchFreshProduct(
                            item.productId
                        ).catch(function () {
                            return null;
                        });
                    }
                )
            );

        const refreshedItems =
            results
                .filter(Boolean)
                .map(
                    normalizeProductForWishlist
                );

        await setItems(refreshedItems);

        return refreshedItems;
    }

    /* ======================================================
       MOVE TO CART
    ====================================================== */

    function requiresProductOptions(product) {
        return Boolean(
            (
                Array.isArray(product.sizes) &&
                product.sizes.length
            ) ||
            (
                Array.isArray(product.colors) &&
                product.colors.length
            ) ||
            (
                Array.isArray(product.variants) &&
                product.variants.length
            )
        );
    }

    function buildSimpleCartItem(product) {
        return {
            productId: product.productId,
            name: product.name,
            slug: product.slug,
            image: product.image,
            price: product.price,
            currency: product.currency,
            quantity: 1,
            size: "",
            color: "",
            variantId: "",
            sku: product.sku,
            stock: product.inventory
        };
    }

    async function moveToCart(
        productId,
        options
    ) {
        const settings = options || {};
        const savedItem =
            getItem(productId);

        if (!savedItem) {
            throw new Error(
                "The wishlist item could not be found."
            );
        }

        const freshProduct =
            await fetchFreshProduct(productId);

        if (!freshProduct) {
            await remove(productId, {
                silent: true
            });

            throw new Error(
                "This product is no longer available."
            );
        }

        const product =
            normalizeProductForWishlist(
                freshProduct
            );

        if (!product.inStock) {
            throw new Error(
                "This product is currently out of stock."
            );
        }

        if (requiresProductOptions(product)) {
            if (router) {
                await router.navigate({
                    name: "product",
                    params: {
                        id: product.productId
                    }
                });
            }

            app.showToast({
                type: "info",
                title: "Choose your options",
                message:
                    "Select a size and colour before adding this piece to your bag."
            });

            return {
                moved: false,
                requiresOptions: true
            };
        }

        const cart =
            window.LEternelCart ||
            cartModule;

        if (
            !cart ||
            typeof cart.addItem !== "function"
        ) {
            throw new Error(
                "The shopping bag is unavailable."
            );
        }

        await cart.addItem(
            buildSimpleCartItem(product),
            {
                openDrawer:
                    settings.openDrawer !== false
            }
        );

        if (settings.keepInWishlist !== true) {
            await remove(productId, {
                silent: true
            });
        }

        app.showToast({
            type: "success",
            title: "Moved to your bag",
            message:
                product.name +
                " has been added to your shopping bag."
        });

        return {
            moved: true,
            requiresOptions: false
        };
    }

    async function moveAllAvailableToCart() {
        const items =
            Wishlist.state.items.slice();

        if (!items.length) {
            app.showToast({
                type: "info",
                title: "Wishlist empty",
                message:
                    "There are no saved products to move."
            });

            return {
                moved: 0,
                skipped: 0
            };
        }

        let moved = 0;
        let skipped = 0;

        for (
            let index = 0;
            index < items.length;
            index += 1
        ) {
            const item = items[index];

            try {
                const result =
                    await moveToCart(
                        item.productId,
                        {
                            openDrawer: false
                        }
                    );

                if (result.moved) {
                    moved += 1;
                } else {
                    skipped += 1;
                }
            } catch (error) {
                skipped += 1;
            }
        }

        if (moved > 0) {
            app.openCart();
        }

        app.showToast({
            type:
                moved > 0
                    ? "success"
                    : "warning",

            title:
                moved > 0
                    ? "Wishlist updated"
                    : "No products moved",

            message:
                moved +
                " product" +
                (moved === 1 ? "" : "s") +
                " moved to your bag" +
                (
                    skipped
                        ? ". " +
                          skipped +
                          " require attention."
                        : "."
                )
        });

        return {
            moved: moved,
            skipped: skipped
        };
    }

    /* ======================================================
       RENDERING
    ====================================================== */

    function getProductPath(item) {
        if (router) {
            return router.buildPath(
                "product",
                {
                    id: item.productId
                }
            );
        }

        return (
            "/product/" +
            encodeURIComponent(
                item.productId
            )
        );
    }

    function createDrawerItem(item) {
        const article =
            document.createElement("article");

        article.className =
            "wishlist-drawer-item";

        article.dataset.wishlistProductId =
            item.productId;

        const productPath =
            getProductPath(item);

        const image =
            item.image ||
            "https://placehold.co/500x650?text=L%27ÉTERNEL";

        article.innerHTML = [
            '<a class="wishlist-drawer-image" href="#' +
                productPath +
                '" data-route="' +
                productPath +
                '">',

            '<img src="' +
                escapeHTML(image) +
                '" alt="' +
                escapeHTML(item.name) +
                '" loading="lazy">',

            "</a>",

            '<div class="wishlist-drawer-content">',

            item.category
                ? '<span class="product-category">' +
                  escapeHTML(item.category) +
                  "</span>"
                : "",

            '<h4><a href="#' +
                productPath +
                '" data-route="' +
                productPath +
                '">' +
                escapeHTML(item.name) +
                "</a></h4>",

            '<div class="wishlist-drawer-price">',

            "<strong>" +
                escapeHTML(
                    formatPrice(
                        item.price,
                        item.currency
                    )
                ) +
                "</strong>",

            item.compareAtPrice >
            item.price
                ? "<del>" +
                  escapeHTML(
                      formatPrice(
                          item.compareAtPrice,
                          item.currency
                      )
                  ) +
                  "</del>"
                : "",

            "</div>",

            '<div class="wishlist-drawer-actions">',

            '<button type="button" class="primary-btn" data-wishlist-move="' +
                escapeHTML(item.productId) +
                '"' +
                (
                    item.inStock
                        ? ""
                        : " disabled"
                ) +
                ">",

            '<i class="fa-solid fa-bag-shopping"></i>',
            item.inStock
                ? "Move to bag"
                : "Out of stock",
            "</button>",

            '<button type="button" class="wishlist-remove-button" data-wishlist-remove="' +
                escapeHTML(item.productId) +
                '" aria-label="Remove ' +
                escapeHTML(item.name) +
                '">',

            '<i class="fa-regular fa-trash-can"></i>',
            "</button>",

            "</div>",
            "</div>"
        ].join("");

        return article;
    }

    function createAccountCard(item) {
        const article =
            document.createElement("article");

        article.className =
            "account-wishlist-card";

        article.dataset.wishlistProductId =
            item.productId;

        const productPath =
            getProductPath(item);

        const image =
            item.image ||
            "https://placehold.co/700x900?text=L%27ÉTERNEL";

        article.innerHTML = [
            '<div class="account-wishlist-image">',

            '<a href="#' +
                productPath +
                '" data-route="' +
                productPath +
                '">',

            '<img src="' +
                escapeHTML(image) +
                '" alt="' +
                escapeHTML(item.name) +
                '" loading="lazy">',

            "</a>",

            '<button type="button" class="account-wishlist-remove" data-wishlist-remove="' +
                escapeHTML(item.productId) +
                '" aria-label="Remove ' +
                escapeHTML(item.name) +
                '">',

            '<i class="fa-solid fa-xmark"></i>',
            "</button>",

            "</div>",

            '<div class="account-wishlist-content">',

            item.category
                ? '<span class="product-category">' +
                  escapeHTML(item.category) +
                  "</span>"
                : "",

            '<h4><a href="#' +
                productPath +
                '" data-route="' +
                productPath +
                '">' +
                escapeHTML(item.name) +
                "</a></h4>",

            '<span class="account-wishlist-price">' +
                escapeHTML(
                    formatPrice(
                        item.price,
                        item.currency
                    )
                ) +
                "</span>",

            '<button type="button" class="primary-btn" data-wishlist-move="' +
                escapeHTML(item.productId) +
                '"' +
                (
                    item.inStock
                        ? ""
                        : " disabled"
                ) +
                ">",

            '<i class="fa-solid fa-bag-shopping"></i>',
            item.inStock
                ? "Move to bag"
                : "Out of stock",
            "</button>",

            "</div>"
        ].join("");

        return article;
    }

    function renderContainer(
        container,
        factory
    ) {
        if (!container) {
            return;
        }

        container.innerHTML = "";

        const fragment =
            document.createDocumentFragment();

        Wishlist.state.items.forEach(
            function (item) {
                fragment.appendChild(
                    factory(item)
                );
            }
        );

        container.appendChild(fragment);
    }

    function renderEmptyStates() {
        const hasItems =
            Wishlist.state.items.length > 0;

        if (Wishlist.elements.drawerEmpty) {
            Wishlist.elements.drawerEmpty.hidden =
                hasItems;
        }

        if (Wishlist.elements.drawerContent) {
            Wishlist.elements.drawerContent.hidden =
                !hasItems;
        }

        if (Wishlist.elements.accountEmpty) {
            Wishlist.elements.accountEmpty.hidden =
                hasItems;
        }

        if (Wishlist.elements.accountGrid) {
            Wishlist.elements.accountGrid.hidden =
                !hasItems;
        }
    }

    function renderLoading(loading) {
        Wishlist.state.loading =
            Boolean(loading);

        if (Wishlist.elements.loading) {
            Wishlist.elements.loading.hidden =
                !loading;

            Wishlist.elements.loading.classList.toggle(
                "active",
                loading
            );
        }

        if (Wishlist.elements.drawer) {
            Wishlist.elements.drawer.setAttribute(
                "aria-busy",
                String(loading)
            );
        }
    }

    function render() {
        renderContainer(
            Wishlist.elements.drawerItems,
            createDrawerItem
        );

        renderContainer(
            Wishlist.elements.accountGrid,
            createAccountCard
        );

        renderEmptyStates();
    }

    /* ======================================================
       PRODUCT BUTTON STATES
    ====================================================== */

    function updateProductButtons() {
        queryAll(
            "[data-product-wishlist]"
        ).forEach(function (button) {
            const productId =
                button.dataset.productWishlist;

            const active =
                hasItem(productId);

            button.classList.toggle(
                "active",
                active
            );

            button.setAttribute(
                "aria-pressed",
                String(active)
            );

            button.setAttribute(
                "aria-label",
                active
                    ? "Remove from wishlist"
                    : "Add to wishlist"
            );

            const icon = query("i", button);

            if (icon) {
                icon.classList.toggle(
                    "fa-solid",
                    active
                );

                icon.classList.toggle(
                    "fa-regular",
                    !active
                );
            }
        });

        queryAll(
            "[data-current-product-wishlist]"
        ).forEach(function (button) {
            const currentProduct =
                productsModule &&
                productsModule.state
                    ? productsModule.state
                          .currentProduct
                    : null;

            const productId =
                currentProduct
                    ? currentProduct.id
                    : button.dataset
                          .currentProductWishlist;

            const active =
                productId &&
                hasItem(productId);

            button.classList.toggle(
                "active",
                Boolean(active)
            );

            button.setAttribute(
                "aria-pressed",
                String(Boolean(active))
            );

            const label =
                query(
                    "[data-wishlist-label]",
                    button
                );

            if (label) {
                label.textContent = active
                    ? "Saved"
                    : "Add to wishlist";
            }
        });
    }

    /* ======================================================
       AUTH SYNCHRONIZATION
    ====================================================== */

    async function handleUserChange(user) {
        renderLoading(true);

        try {
            unsubscribeFromUserWishlist();

            Wishlist.state.user =
                user || null;

            if (user) {
                const mergedItems =
                    await mergeGuestWishlistIntoUserWishlist(
                        user
                    );

                setItems(
                    mergedItems,
                    {
                        skipPersistence: true
                    }
                );

                subscribeToUserWishlist(
                    user.uid
                );
            } else {
                setItems(
                    readGuestWishlist(),
                    {
                        skipPersistence: true
                    }
                );
            }
        } catch (error) {
            console.error(
                "[Wishlist] User synchronization failed:",
                error
            );

            app.showToast({
                type: "warning",
                title: "Wishlist synchronization",
                message:
                    "Your wishlist could not be fully synchronized."
            });
        } finally {
            renderLoading(false);
        }
    }

    /* ======================================================
       EVENT HANDLERS
    ====================================================== */

    async function handleProductToggle(
        productId,
        button
    ) {
        try {
            let product = null;

            if (
                productsModule &&
                productsModule.state &&
                productsModule.state.currentProduct &&
                productsModule.state.currentProduct.id ===
                    productId
            ) {
                product =
                    productsModule.state.currentProduct;
            }

            if (
                !product &&
                productsModule &&
                typeof productsModule.fetchProductById ===
                    "function"
            ) {
                product =
                    await productsModule.fetchProductById(
                        productId
                    );
            }

            if (!product) {
                throw new Error(
                    "The selected product is unavailable."
                );
            }

            const result =
                await toggle(product);

            if (button) {
                button.classList.toggle(
                    "active",
                    result.added
                );
            }
        } catch (error) {
            app.showToast({
                type: "error",
                title: "Wishlist unavailable",
                message:
                    error.message ||
                    "The wishlist could not be updated."
            });
        }
    }

    function bindEvents() {
        document.addEventListener(
            "click",
            function (event) {
                const removeButton =
                    event.target.closest(
                        "[data-wishlist-remove]"
                    );

                if (removeButton) {
                    event.preventDefault();

                    remove(
                        removeButton.dataset
                            .wishlistRemove
                    ).catch(function (error) {
                        app.showToast({
                            type: "error",
                            message: error.message
                        });
                    });

                    return;
                }

                const moveButton =
                    event.target.closest(
                        "[data-wishlist-move]"
                    );

                if (moveButton) {
                    event.preventDefault();

                    moveButton.disabled = true;
                    moveButton.classList.add(
                        "loading"
                    );

                    moveToCart(
                        moveButton.dataset
                            .wishlistMove
                    )
                        .catch(function (error) {
                            app.showToast({
                                type: "warning",
                                title:
                                    "Unable to move product",
                                message:
                                    error.message
                            });
                        })
                        .finally(function () {
                            moveButton.disabled =
                                false;

                            moveButton.classList.remove(
                                "loading"
                            );
                        });

                    return;
                }

                const clearButton =
                    event.target.closest(
                        "[data-wishlist-clear]"
                    );

                if (clearButton) {
                    event.preventDefault();

                    clear().catch(
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

                const moveAllButton =
                    event.target.closest(
                        "[data-wishlist-move-all]"
                    );

                if (moveAllButton) {
                    event.preventDefault();

                    moveAllButton.disabled = true;
                    moveAllButton.classList.add(
                        "loading"
                    );

                    moveAllAvailableToCart()
                        .finally(function () {
                            moveAllButton.disabled =
                                false;

                            moveAllButton.classList.remove(
                                "loading"
                            );
                        });

                    return;
                }

                const currentProductButton =
                    event.target.closest(
                        "[data-current-product-wishlist]"
                    );

                if (currentProductButton) {
                    event.preventDefault();

                    const currentProduct =
                        productsModule &&
                        productsModule.state
                            ? productsModule.state
                                  .currentProduct
                            : null;

                    if (!currentProduct) {
                        return;
                    }

                    handleProductToggle(
                        currentProduct.id,
                        currentProductButton
                    );
                }
            }
        );

        /*
         * Product cards already dispatch this event from products.js.
         * Listening here prevents duplicate product fetching logic.
         */
        document.addEventListener(
            "products:wishlist",
            function (event) {
                const product =
                    event.detail &&
                    event.detail.product;

                if (!product) {
                    return;
                }

                toggle(product).catch(
                    function (error) {
                        app.showToast({
                            type: "error",
                            title:
                                "Wishlist unavailable",
                            message:
                                error.message
                        });
                    }
                );
            }
        );

        document.addEventListener(
            "products:detailrendered",
            updateProductButtons
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

        document.addEventListener(
            "router:change",
            function (event) {
                const detail =
                    event.detail || {};

                if (
                    detail.name ===
                    "account-wishlist"
                ) {
                    render();
                }

                updateProductButtons();
            }
        );
    }

    /* ======================================================
       INITIALIZATION
    ====================================================== */

    async function initialize() {
        if (Wishlist.initialized) {
            return;
        }

        cacheElements();
        bindEvents();

        Wishlist.initialized = true;

        await handleUserChange(
            auth.currentUser
        );

        document.dispatchEvent(
            new CustomEvent(
                "wishlist:ready",
                {
                    detail: {
                        wishlist: Wishlist
                    }
                }
            )
        );

        console.info(
            "[Wishlist] L'ÉTERNEL wishlist initialized."
        );
    }

    /* ======================================================
       PUBLIC API
    ====================================================== */

    Wishlist.init = initialize;

    Wishlist.add = add;
    Wishlist.remove = remove;
    Wishlist.toggle = toggle;
    Wishlist.clear = clear;

    Wishlist.getItems = getItems;
    Wishlist.getItem = getItem;
    Wishlist.getItemCount =
        getItemCount;
    Wishlist.hasItem = hasItem;

    Wishlist.moveToCart =
        moveToCart;

    Wishlist.moveAllToCart =
        moveAllAvailableToCart;

    Wishlist.refreshItem =
        refreshItem;

    Wishlist.refreshAll =
        refreshAllItems;

    Wishlist.render = render;
    Wishlist.persist =
        persistWishlist;

    window.LEternelWishlist =
        Wishlist;

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

