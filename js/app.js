//javascript
"use strict";

/*
============================================================
L'ÉTERNEL STORE
CORE APPLICATION — COMPLETE FRONTEND FOUNDATION
Firebase v8 compatible
============================================================

IMPORTANT:
- This file does NOT initialize Firebase.
- Firebase v8 remains handled by your existing Firebase setup.
- This file creates window.LEternelApp.
- Existing modules can continue using:
    window.LEternelApp
    window.LEternelRouter
    window.LEternelProducts
    window.LEternelCart
    window.LEternelWishlist
    window.LEternelAuth
    window.LEternelUI
    window.FirebaseServices

This file also provides a safe fallback SPA navigation layer
for existing data-target navigation in the HTML.
============================================================
*/

(function (global) {

    /* ========================================================
       PREVENT DUPLICATE INITIALIZATION
    ======================================================== */

    if (global.LEternelApp) {
        console.warn(
            "[L'ÉTERNEL] App already initialized."
        );
        return;
    }


    /* ========================================================
       APPLICATION STATE
    ======================================================== */

    const App = {

        name: "L'ÉTERNEL Store",

        version: "2.0.0",

        initialized: false,

        ready: false,

        state: {

            route: "home",

            currentPage: "home-page",

            user: null,

            products: [],

            cart: [],

            wishlist: [],

            cartCount: 0,

            wishlistCount: 0,

            search: {
                query: "",
                results: []
            },

            shop: {
                category: "all",
                price: "all",
                sort: "latest",
                page: 1
            },

            product: {
                current: null
            }

        },

        modules: {},

        services: {},

        utils: {},

        config: {}

    };


    /* ========================================================
       DOM HELPERS
    ======================================================== */

    function $(selector, parent) {

        return (parent || document)
            .querySelector(selector);

    }


    function $all(selector, parent) {

        return Array.prototype.slice.call(
            (parent || document)
                .querySelectorAll(selector)
        );

    }


    function byId(id) {

        return document.getElementById(id);

    }


    /* ========================================================
       HTML ESCAPING
    ======================================================== */

    function escapeHTML(value) {

        if (
            value === null ||
            value === undefined
        ) {
            return "";
        }

        const element =
            document.createElement("div");

        element.textContent =
            String(value);

        return element.innerHTML;

    }


    /* ========================================================
       NUMBER HELPERS
    ======================================================== */

    function toNumber(value, fallback) {

        const number =
            Number(value);

        if (
            Number.isFinite(number)
        ) {
            return number;
        }

        return Number(fallback) || 0;

    }


    function clamp(value, minimum, maximum) {

        return Math.min(
            maximum,
            Math.max(
                minimum,
                value
            )
        );

    }


    /* ========================================================
       PRICE FORMATTER
    ======================================================== */

    function formatPrice(
        value,
        currency
    ) {

        const amount =
            toNumber(value, 0);

        const currencyCode =
            currency || "NGN";

        try {

            return new Intl.NumberFormat(
                "en-NG",
                {
                    style: "currency",
                    currency: currencyCode,
                    maximumFractionDigits: 0
                }
            ).format(amount);

        } catch (error) {

            return (
                currencyCode +
                " " +
                amount.toLocaleString()
            );

        }

    }


    /* ========================================================
       DATE FORMATTER
    ======================================================== */

    function formatDate(value) {

        if (!value) {
            return "";
        }

        try {

            let date;

            if (
                value &&
                typeof value.toDate === "function"
            ) {

                date =
                    value.toDate();

            } else {

                date =
                    new Date(value);

            }

            if (
                Number.isNaN(
                    date.getTime()
                )
            ) {
                return "";
            }

            return new Intl.DateTimeFormat(
                "en-NG",
                {
                    day: "2-digit",
                    month: "short",
                    year: "numeric"
                }
            ).format(date);

        } catch (error) {

            return "";

        }

    }


    /* ========================================================
       DEEP CLONE
    ======================================================== */

    function clone(value) {

        if (
            value === undefined ||
            value === null
        ) {
            return value;
        }

        try {

            return JSON.parse(
                JSON.stringify(value)
            );

        } catch (error) {

            return value;

        }

    }


    /* ========================================================
       MODULE REGISTRATION
    ======================================================== */

    function registerModule(
        name,
        module
    ) {

        const moduleName =
            String(name || "")
                .trim()
                .toLowerCase();

        if (!moduleName) {

            throw new Error(
                "A module name is required."
            );

        }

        App.modules[moduleName] =
            module;

        return module;

    }


    function getModule(name) {

        const moduleName =
            String(name || "")
                .trim()
                .toLowerCase();

        return (
            App.modules[moduleName] ||
            null
        );

    }


    function hasModule(name) {

        return Boolean(
            getModule(name)
        );

    }


    /* ========================================================
       SERVICE REGISTRATION
    ======================================================== */

    function registerService(
        name,
        service
    ) {

        const serviceName =
            String(name || "")
                .trim()
                .toLowerCase();

        if (!serviceName) {

            throw new Error(
                "A service name is required."
            );

        }

        App.services[serviceName] =
            service;

        return service;

    }


    function getService(name) {

        const serviceName =
            String(name || "")
                .trim()
                .toLowerCase();

        return (
            App.services[serviceName] ||
            null
        );

    }


    /* ========================================================
       STATE
    ======================================================== */

    function setState(
        key,
        value
    ) {

        if (!key) {
            return;
        }

        App.state[key] =
            value;

        emit(
            "app:statechange",
            {
                key: key,
                value: value,
                state: App.state
            }
        );

    }


    function getState(key) {

        if (!key) {
            return App.state;
        }

        return App.state[key];

    }


    /* ========================================================
       EVENTS
    ======================================================== */

    function emit(
        name,
        detail
    ) {

        if (!name) {
            return;
        }

        document.dispatchEvent(
            new CustomEvent(
                name,
                {
                    detail:
                        detail || {}
                }
            )
        );

    }


    function on(
        name,
        handler,
        options
    ) {

        if (
            !name ||
            typeof handler !==
                "function"
        ) {

            return function () {};

        }

        document.addEventListener(
            name,
            handler,
            options
        );

        return function () {

            document.removeEventListener(
                name,
                handler,
                options
            );

        };

    }


    function once(
        name,
        handler
    ) {

        return on(
            name,
            handler,
            {
                once: true
            }
        );

    }


    /* ========================================================
       CART COUNTER
    ======================================================== */

    function setCartCount(count) {

        const normalizedCount =
            Math.max(
                0,
                Number(count) || 0
            );

        App.state.cartCount =
            normalizedCount;

        const counters =
            $all(
                [
                    "[data-cart-count]",
                    "#cartCount",
                    ".cart-count"
                ].join(",")
            );

        counters.forEach(
            function (element) {

                element.textContent =
                    String(
                        normalizedCount
                    );

                element.hidden =
                    normalizedCount <= 0;

                element.setAttribute(
                    "aria-label",
                    normalizedCount +
                    (
                        normalizedCount === 1
                            ? " item in bag"
                            : " items in bag"
                    )
                );

            }
        );

        emit(
            "cart:count",
            {
                count:
                    normalizedCount
            }
        );

        return normalizedCount;

    }


    /* ========================================================
       WISHLIST COUNTER
    ======================================================== */

    function setWishlistCount(count) {

        const normalizedCount =
            Math.max(
                0,
                Number(count) || 0
            );

        App.state.wishlistCount =
            normalizedCount;

        const counters =
            $all(
                [
                    "[data-wishlist-count]",
                    "#wishlistCount",
                    ".wishlist-count"
                ].join(",")
            );

        counters.forEach(
            function (element) {

                element.textContent =
                    String(
                        normalizedCount
                    );

                element.hidden =
                    normalizedCount <= 0;

                element.setAttribute(
                    "aria-label",
                    normalizedCount +
                    (
                        normalizedCount === 1
                            ? " item in wishlist"
                            : " items in wishlist"
                    )
                );

            }
        );

        emit(
            "wishlist:count",
            {
                count:
                    normalizedCount
            }
        );

        return normalizedCount;

    }


    /* ========================================================
       TOAST
    ======================================================== */

    function showToast(options) {

        const settings =
            typeof options === "string"
                ? {
                    message: options
                }
                : (
                    options || {}
                );

        const type =
            settings.type ||
            "info";

        const title =
            settings.title ||
            "";

        const message =
            settings.message ||
            "";

        emit(
            "toast:show",
            {
                type: type,
                title: title,
                message: message
            }
        );

        let container =
            $(
                "[data-app-toast-container]"
            );

        if (!container) {

            container =
                document.createElement(
                    "div"
                );

            container.setAttribute(
                "data-app-toast-container",
                ""
            );

            container.style.position =
                "fixed";

            container.style.right =
                "24px";

            container.style.bottom =
                "24px";

            container.style.zIndex =
                "99999";

            container.style.display =
                "flex";

            container.style.flexDirection =
                "column";

            container.style.gap =
                "10px";

            container.style.width =
                "min(380px, calc(100vw - 40px))";

            container.style.pointerEvents =
                "none";

            document.body.appendChild(
                container
            );

        }

        const toast =
            document.createElement(
                "div"
            );

        toast.style.pointerEvents =
            "auto";

        toast.style.background =
            "#111";

        toast.style.color =
            "#fff";

        toast.style.padding =
            "15px 17px";

        toast.style.border =
            "1px solid rgba(255,255,255,.14)";

        toast.style.borderRadius =
            "4px";

        toast.style.fontSize =
            "13px";

        toast.style.lineHeight =
            "1.5";

        toast.style.boxShadow =
            "0 16px 45px rgba(0,0,0,.18)";

        toast.style.opacity =
            "0";

        toast.style.transform =
            "translateY(10px)";

        toast.style.transition =
            "opacity .25s ease, transform .25s ease";

        if (title) {

            const heading =
                document.createElement(
                    "strong"
                );

            heading.textContent =
                title;

            heading.style.display =
                "block";

            heading.style.marginBottom =
                "4px";

            toast.appendChild(
                heading
            );

        }

        if (message) {

            const text =
                document.createElement(
                    "span"
                );

            text.textContent =
                message;

            toast.appendChild(
                text
            );

        }

        container.appendChild(
            toast
        );

        requestAnimationFrame(
            function () {

                toast.style.opacity =
                    "1";

                toast.style.transform =
                    "translateY(0)";

            }
        );

        const duration =
            Number(
                settings.duration
            ) || 3500;

        window.setTimeout(
            function () {

                toast.style.opacity =
                    "0";

                toast.style.transform =
                    "translateY(10px)";

                window.setTimeout(
                    function () {

                        if (
                            toast.parentNode
                        ) {

                            toast.parentNode
                                .removeChild(
                                    toast
                                );

                        }

                        if (
                            container &&
                            !container.children.length &&
                            container.parentNode
                        ) {

                            container.parentNode
                                .removeChild(
                                    container
                                );

                        }

                    },
                    300
                );

            },
            duration
        );

        return toast;

    }


    /* ========================================================
       LOADER
    ======================================================== */

    function showLoader(message) {

        let loader =
            $(
                "[data-app-loader]"
            );

        if (!loader) {

            loader =
                document.createElement(
                    "div"
                );

            loader.setAttribute(
                "data-app-loader",
                ""
            );

            loader.style.position =
                "fixed";

            loader.style.inset =
                "0";

            loader.style.zIndex =
                "99998";

            loader.style.display =
                "flex";

            loader.style.alignItems =
                "center";

            loader.style.justifyContent =
                "center";

            loader.style.background =
                "rgba(255,255,255,.82)";

            loader.style.backdropFilter =
                "blur(5px)";

            const content =
                document.createElement(
                    "div"
                );

            content.setAttribute(
                "data-app-loader-content",
                ""
            );

            content.style.padding =
                "18px 24px";

            content.style.background =
                "#111";

            content.style.color =
                "#fff";

            content.style.fontSize =
                "11px";

            content.style.letterSpacing =
                ".16em";

            content.style.textTransform =
                "uppercase";

            loader.appendChild(
                content
            );

            document.body.appendChild(
                loader
            );

        }

        const content =
            $(
                "[data-app-loader-content]",
                loader
            );

        if (content) {

            content.textContent =
                message ||
                "Loading…";

        }

        loader.hidden =
            false;

        emit(
            "loader:show",
            {
                message:
                    message ||
                    "Loading…"
            }
        );

        return loader;

    }


    function hideLoader() {

        const loader =
            $(
                "[data-app-loader]"
            );

        if (loader) {

            loader.hidden =
                true;

        }

        emit(
            "loader:hide",
            {}
        );

    }


    /* ========================================================
       MODAL HELPERS
    ======================================================== */

    function openModal(element) {

        if (!element) {
            return false;
        }

        element.classList.add(
            "active",
            "open"
        );

        element.setAttribute(
            "aria-hidden",
            "false"
        );

        document.body.classList.add(
            "no-scroll"
        );

        return true;

    }


    function closeModal(element) {

        if (!element) {
            return false;
        }

        element.classList.remove(
            "active",
            "open"
        );

        element.setAttribute(
            "aria-hidden",
            "true"
        );

        if (
            !document.querySelector(
                ".modal.active, .modal.open, .drawer.active, .drawer.open, [aria-modal='true'].active"
            )
        ) {

            document.body.classList.remove(
                "no-scroll"
            );

        }

        return true;

    }


    function closeAllOverlays() {

        $all(
            [
                ".modal.active",
                ".modal.open",
                ".drawer.active",
                ".drawer.open",
                "[aria-modal='true'].active"
            ].join(",")
        ).forEach(
            function (element) {

                element.classList.remove(
                    "active",
                    "open"
                );

                element.setAttribute(
                    "aria-hidden",
                    "true"
                );

            }
        );

        document.body.classList.remove(
            "no-scroll"
        );

    }


    /* ========================================================
       SPA PAGE HELPERS
    ======================================================== */

    function getViewSections() {

        return $all(
            ".view-section"
        );

    }


    function normalizePageTarget(target) {

        if (!target) {
            return "home-page";
        }

        let value =
            String(target)
                .trim();

        const aliases = {

            "home":
                "home-page",

            "/":
                "home-page",

            "shop":
                "shop-page",

            "/shop":
                "shop-page",

            "collection":
                "shop-page",

            "product":
                "product-page",

            "heritage":
                "heritage-page",

            "/heritage":
                "heritage-page",

            "contact":
                "contact-page",

            "/contact":
                "contact-page",

            "checkout":
                "checkout-page",

            "/checkout":
                "checkout-page",

            "account":
                "account-page",

            "/account":
                "account-page"

        };

        if (
            aliases[value]
        ) {

            return aliases[value];

        }

        if (
            value.charAt(0) === "#"
        ) {

            value =
                value.substring(1);

        }

        if (
            document.getElementById(value)
        ) {

            return value;

        }

        if (
            document.getElementById(
                value + "-page"
            )
        ) {

            return value + "-page";

        }

        return value;

    }


    function findPage(target) {

        const normalized =
            normalizePageTarget(
                target
            );

        return (
            document.getElementById(
                normalized
            ) ||
            null
        );

    }


    function updateBodyPageClasses(page) {

        if (!page) {
            return;
        }

        const classes =
            Array.prototype.slice.call(
                document.body.classList
            );

        classes.forEach(
            function (className) {

                if (
                    className.indexOf(
                        "page-"
                    ) === 0
                ) {

                    document.body.classList.remove(
                        className
                    );

                }

            }
        );

        const pageName =
            page.id
                .replace(
                    /-page$/,
                    ""
                )
                .replace(
                    /[^a-z0-9-]/gi,
                    "-"
                );

        document.body.classList.add(
            "page-" +
            pageName
        );

    }


    /* ========================================================
       SHOP FILTER
    ======================================================== */

    function applyShopFilter(filter) {

        const categorySelect =
            byId(
                "filter-category"
            );

        const normalized =
            String(
                filter || "all"
            )
                .toLowerCase()
                .trim();

        if (categorySelect) {

            const validValues = [
                "all",
                "menswear",
                "womenswear",
                "accessories"
            ];

            categorySelect.value =
                validValues.indexOf(
                    normalized
                ) !== -1
                    ? normalized
                    : "all";

            categorySelect.dispatchEvent(
                new Event(
                    "change",
                    {
                        bubbles: true
                    }
                )
            );

        }

        App.state.shop.category =
            normalized;

        emit(
            "leternel:shop-filter",
            {
                filter:
                    normalized
            }
        );

        window.dispatchEvent(
            new CustomEvent(
                "leternel:shop-filter",
                {
                    detail: {
                        filter:
                            normalized
                    }
                }
            )
        );

    }


    /* ========================================================
       SHOW PAGE
    ======================================================== */

    function showPage(
        target,
        filter,
        options
    ) {

        const settings =
            options || {};

        const page =
            findPage(target);

        if (!page) {

            console.warn(
                "[L'ÉTERNEL] Page not found:",
                target
            );

            return false;

        }

        const sections =
            getViewSections();

        /*
         * Only hide view sections.
         * Do NOT hide arbitrary sections such as
         * contact, newsletter, footer, etc.
         */
        sections.forEach(
            function (section) {

                section.classList.remove(
                    "active",
                    "active-view"
                );

                section.setAttribute(
                    "aria-hidden",
                    "true"
                );

                /*
                 * Use inline display only when necessary.
                 * This prevents old CSS from trapping the page.
                 */
                section.style.display =
                    "none";

            }
        );

        page.classList.add(
            "active",
            "active-view"
        );

        page.setAttribute(
            "aria-hidden",
            "false"
        );

        /*
         * Do not impose a fixed width here.
         * The existing CSS remains responsible for layout.
         */
        page.style.display =
            "";

        updateBodyPageClasses(
            page
        );

        App.state.currentPage =
            page.id;

        if (
            page.id ===
            "home-page"
        ) {

            App.state.route =
                "home";

        } else if (
            page.id ===
            "shop-page"
        ) {

            App.state.route =
                "shop";

            if (filter) {

                applyShopFilter(
                    filter
                );

            }

        } else {

            App.state.route =
                page.id.replace(
                    /-page$/,
                    ""
                );

        }

        emit(
            "navigation:changed",
            {
                page:
                    page.id,
                route:
                    App.state.route,
                filter:
                    filter || null
            }
        );

        emit(
            "route:changed",
            {
                page:
                    page.id,
                route:
                    App.state.route
            }
        );

        /*
         * Update active navigation state.
         */
        $all(
            "[data-target]"
        ).forEach(
            function (element) {

                element.classList.remove(
                    "active"
                );

            }
        );

        $all(
            '[data-target="' +
            page.id +
            '"]'
        ).forEach(
            function (element) {

                element.classList.add(
                    "active"
                );

            }
        );

        /*
         * Close mobile menu after navigation.
         */
        const mobileMenu =
            byId(
                "mobile-menu"
            );

        if (mobileMenu) {

            mobileMenu.classList.remove(
                "open",
                "active"
            );

        }

        /*
         * Scroll to top unless explicitly disabled.
         */
        if (
            !settings.preserveScroll
        ) {

            window.requestAnimationFrame(
                function () {

                    window.scrollTo(
                        0,
                        0
                    );

                }
            );

        }

        /*
         * Give product module a chance
         * to react to the page.
         */
        if (
            page.id ===
            "shop-page"
        ) {

            emit(
                "shop:opened",
                {
                    filter:
                        filter ||
                        "all"
                }
            );

        }

        if (
            page.id ===
            "heritage-page"
        ) {

            emit(
                "heritage:opened",
                {}
            );

        }

        return true;

    }


    /* ========================================================
       NAVIGATION
    ======================================================== */

    function navigate(
        target,
        options
    ) {

        const settings =
            options || {};

        const targetPage =
            normalizePageTarget(
                target
            );

        const success =
            showPage(
                targetPage,
                settings.filter,
                settings
            );

        if (!success) {
            return false;
        }

        /*
         * Use the hash instead of changing
         * the actual document URL path.
         *
         * This keeps the site an SPA and
         * avoids unnecessary Firebase Hosting
         * 404 problems.
         */
        if (
            settings.updateHash !== false
        ) {

            try {

                const hash =
                    targetPage
                        .replace(
                            /-page$/,
                            ""
                        );

                history.replaceState(
                    null,
                    "",
                    "#" +
                    hash
                );

            } catch (error) {

                console.warn(
                    "[L'ÉTERNEL] Could not update URL hash.",
                    error
                );

            }

        }

        return true;

    }


    /* ========================================================
       GLOBAL DATA-TARGET NAVIGATION
       ======================================================== */

    function installNavigation() {

        document.addEventListener(
            "click",
            function (event) {

                const trigger =
                    event.target.closest(
                        "[data-target]"
                    );

                if (!trigger) {
                    return;
                }

                if (
                    trigger.dataset
                        .noNavigation ===
                    "true"
                ) {

                    return;

                }

                /*
                 * Never hijack form controls.
                 */
                if (
                    trigger.tagName ===
                    "INPUT" ||
                    trigger.tagName ===
                    "SELECT" ||
                    trigger.tagName ===
                    "TEXTAREA"
                ) {

                    return;

                }

                const target =
                    trigger.getAttribute(
                        "data-target"
                    );

                if (!target) {
                    return;
                }

                const page =
                    findPage(target);

                /*
                 * If it is not an actual SPA
                 * page target, allow other modules
                 * to handle it.
                 */
                if (!page) {
                    return;
                }

                event.preventDefault();

                /*
                 * Do NOT use stopImmediatePropagation().
                 *
                 * Other modules such as Cart,
                 * Wishlist and Product Details
                 * still need their click handlers.
                 */
                event.stopPropagation();

                const filter =
                    trigger.getAttribute(
                        "data-filter"
                    );

                navigate(
                    target,
                    {
                        filter:
                            filter || null
                    }
                );

            },
            false
        );

    }


    /* ========================================================
       MOBILE MENU
    ======================================================== */

    function installMobileMenu() {

        document.addEventListener(
            "click",
            function (event) {

                const hamburger =
                    event.target.closest(
                        "#hamburger, #menu-toggle, [data-menu-toggle]"
                    );

                if (!hamburger) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();

                const mobileMenu =
                    byId(
                        "mobile-menu"
                    );

                if (!mobileMenu) {
                    return;
                }

                mobileMenu.classList.toggle(
                    "open"
                );

                mobileMenu.classList.toggle(
                    "active"
                );

                const expanded =
                    mobileMenu.classList.contains(
                        "open"
                    );

                hamburger.setAttribute(
                    "aria-expanded",
                    expanded
                        ? "true"
                        : "false"
                );

            },
            false
        );

    }


    /* ========================================================
       ESCAPE KEY
    ======================================================== */

    function installEscapeHandler() {

        document.addEventListener(
            "keydown",
            function (event) {

                if (
                    event.key !==
                    "Escape"
                ) {
                    return;
                }

                closeAllOverlays();

                const mobileMenu =
                    byId(
                        "mobile-menu"
                    );

                if (mobileMenu) {

                    mobileMenu.classList.remove(
                        "open",
                        "active"
                    );

                }

            }
        );

    }


    /* ========================================================
       BACK / FORWARD SUPPORT
    ======================================================== */

    function restoreHashRoute() {

        let hash =
            window.location.hash
                .replace(
                    /^#/,
                    ""
                );

        if (!hash) {

            navigate(
                "home-page",
                {
                    updateHash:
                        false,
                    preserveScroll:
                        true
                }
            );

            return;

        }

        /*
         * Convert:
         *
         * #shop
         * #heritage
         * #menswear
         *
         * into their appropriate page.
         */
        if (
            hash ===
            "shop"
        ) {

            navigate(
                "shop-page",
                {
                    updateHash:
                        false
                }
            );

            return;

        }

        if (
            hash ===
            "heritage"
        ) {

            navigate(
                "heritage-page",
                {
                    updateHash:
                        false
                }
            );

            return;

        }

        if (
            hash ===
            "menswear" ||
            hash ===
            "womenswear" ||
            hash ===
            "accessories"
        ) {

            navigate(
                "shop-page",
                {
                    filter:
                        hash,
                    updateHash:
                        false
                }
            );

            return;

        }

        const page =
            findPage(hash);

        if (page) {

            navigate(
                page.id,
                {
                    updateHash:
                        false
                }
            );

            return;

        }

        navigate(
            "home-page",
            {
                updateHash:
                    false
            }
        );

    }


    /* ========================================================
       SAFE PRODUCT CARD FALLBACK
    ======================================================== */

    function installProductFallback() {

        document.addEventListener(
            "click",
            function (event) {

                const trigger =
                    event.target.closest(
                        "[data-product-id], [data-product]"
                    );

                if (!trigger) {
                    return;
                }

                /*
                 * Product module gets first opportunity.
                 */
                if (
                    trigger.dataset
                        .noProductNavigation ===
                    "true"
                ) {

                    return;

                }

                const productId =
                    trigger.getAttribute(
                        "data-product-id"
                    ) ||
                    trigger.getAttribute(
                        "data-product"
                    );

                if (!productId) {
                    return;
                }

                /*
                 * If a real Product module exists,
                 * don't interfere with it.
                 */
                if (
                    global.LEternelProducts &&
                    typeof global.LEternelProducts
                        .openProduct ===
                        "function"
                ) {

                    return;

                }

                const productPage =
                    findPage(
                        "product-page"
                    );

                if (!productPage) {
                    return;
                }

                event.preventDefault();

                App.state.product.current =
                    productId;

                navigate(
                    "product-page"
                );

                emit(
                    "product:open",
                    {
                        productId:
                            productId
                    }
                );

            },
            false
        );

    }


    /* ========================================================
       AUTH STATE BRIDGE
    ======================================================== */

    function installAuthBridge() {

        /*
         * Firebase v8 auth listener is only installed
         * when FirebaseServices is already available.
         *
         * This prevents app.js from breaking when
         * firebase.js loads afterward.
         */

        function connectAuth() {

            const services =
                global.FirebaseServices;

            if (
                !services ||
                !services.auth ||
                typeof services.auth
                    .onAuthStateChanged !==
                    "function"
            ) {

                return false;

            }

            services.auth.onAuthStateChanged(
                function (user) {

                    App.state.user =
                        user || null;

                    emit(
                        "auth:changed",
                        {
                            user:
                                user || null
                        }
                    );

                }
            );

            return true;

        }

        if (!connectAuth()) {

            document.addEventListener(
                "firebase:ready",
                function () {

                    connectAuth();

                },
                {
                    once: true
                }
            );

        }

    }


    /* ========================================================
       STARTUP SPLASH
    ======================================================== */

    function removeStartupScreens() {

        const selectors = [

            "#page-loader",

            "#splash-screen",

            "#preloader",

            "#loading-screen",

            ".splash-screen",

            ".preloader",

            ".loading-screen",

            "[data-app-splash]",

            "[data-preloader]",

            "[data-loading-screen]"

        ];

        selectors.forEach(
            function (selector) {

                $all(
                    selector
                ).forEach(
                    function (element) {

                        element.classList.add(
                            "is-hidden"
                        );

                        element.setAttribute(
                            "aria-hidden",
                            "true"
                        );

                        window.setTimeout(
                            function () {

                                if (
                                    element &&
                                    element.parentNode
                                ) {

                                    element.parentNode
                                        .removeChild(
                                            element
                                        );

                                }

                            },
                            500
                        );

                    }
                );

            }
        );

        const wrapper =
            byId(
                "app-wrapper"
            );

        if (wrapper) {

            wrapper.classList.add(
                "is-ready"
            );

            wrapper.removeAttribute(
                "aria-hidden"
            );

        }

        document.documentElement
            .classList.add(
                "app-ready"
            );

        document.body
            .classList.add(
                "app-ready"
            );

    }


    /* ========================================================
       INITIAL PAGE
    ======================================================== */

    function initializePage() {

        const sections =
            getViewSections();

        if (!sections.length) {

            console.warn(
                "[L'ÉTERNEL] No .view-section elements found."
            );

            return;

        }

        /*
         * Hide only SPA views.
         */
        sections.forEach(
            function (section) {

                section.classList.remove(
                    "active",
                    "active-view"
                );

                section.setAttribute(
                    "aria-hidden",
                    "true"
                );

                section.style.display =
                    "none";

            }
        );

        /*
         * Hash determines startup route.
         */
        restoreHashRoute();

    }


    /* ========================================================
       APPLICATION READY
    ======================================================== */

    function markReady() {

        if (App.ready) {
            return;
        }

        App.ready =
            true;

        App.initialized =
            true;

        removeStartupScreens();

        emit(
            "app:ready",
            {
                app:
                    App
            }
        );

        console.info(
            "[L'ÉTERNEL] Store ready."
        );

    }


    /* ========================================================
       INITIALIZATION
    ======================================================== */

    function initialize() {

        if (
            App.initialized
        ) {

            return App;

        }

        App.initialized =
            true;

        installNavigation();

        installMobileMenu();

        installEscapeHandler();

        installProductFallback();

        installAuthBridge();

        /*
         * DOMContentLoaded can already have fired
         * when this file is loaded at the bottom
         * of the document.
         */
        if (
            document.readyState ===
            "loading"
        ) {

            document.addEventListener(
                "DOMContentLoaded",
                function () {

                    initializePage();

                    window.setTimeout(
                        markReady,
                        0
                    );

                },
                {
                    once: true
                }
            );

        } else {

            initializePage();

            window.setTimeout(
                markReady,
                0
            );

        }

        emit(
            "app:initialized",
            {
                app:
                    App
            }
        );

        console.info(
            "[L'ÉTERNEL] Core initialized."
        );

        return App;

    }


    /* ========================================================
       PUBLIC API
    ======================================================== */

    App.registerModule =
        registerModule;

    App.getModule =
        getModule;

    App.hasModule =
        hasModule;

    App.registerService =
        registerService;

    App.getService =
        getService;

    App.setState =
        setState;

    App.getState =
        getState;

    App.emit =
        emit;

    App.on =
        on;

    App.once =
        once;

    App.utils.$ =
        $;

    App.utils.$all =
        $all;

    App.utils.byId =
        byId;

    App.utils.escapeHTML =
        escapeHTML;

    App.utils.toNumber =
        toNumber;

    App.utils.clamp =
        clamp;

    App.utils.clone =
        clone;

    App.utils.formatPrice =
        formatPrice;

    App.utils.formatDate =
        formatDate;

    App.setCartCount =
        setCartCount;

    App.setWishlistCount =
        setWishlistCount;

    App.showToast =
        showToast;

    App.showLoader =
        showLoader;

    App.hideLoader =
        hideLoader;

    App.openModal =
        openModal;

    App.closeModal =
        closeModal;

    App.closeAllOverlays =
        closeAllOverlays;

    App.showPage =
        showPage;

    App.navigate =
        navigate;

    App.applyShopFilter =
        applyShopFilter;

    App.markReady =
        markReady;

    App.init =
        initialize;


    /* ========================================================
       EXPOSE BEFORE OTHER MODULES LOAD
    ======================================================== */

    global.LEternelApp =
        App;


    /* ========================================================
       INITIALIZE
    ======================================================== */

    initialize();


})(
    typeof window !==
        "undefined"
        ? window
        : globalThis
);
