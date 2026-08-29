```javascript
"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   APPLICATION BOOTSTRAP
========================================================== */

(function initializeApplication() {
    const App = {
        state: {
            initialized: false,
            currentUser: null,
            currentRoute: "home",
            cartCount: 0,
            wishlistCount: 0,
            isOnline: window.navigator.onLine,
            activeOverlay: null
        },

        elements: {},

        config: {
            mobileBreakpoint: 768,
            scrollThreshold: 80,
            toastDuration: 4200
        }
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

    function createElement(tagName, className, attributes) {
        const element = document.createElement(tagName);

        if (className) {
            element.className = className;
        }

        Object.keys(attributes || {}).forEach(function (key) {
            const value = attributes[key];

            if (key === "text") {
                element.textContent = value;
                return;
            }

            if (key === "html") {
                element.innerHTML = value;
                return;
            }

            element.setAttribute(key, value);
        });

        return element;
    }

    function escapeHTML(value) {
        const temporaryElement = document.createElement("div");
        temporaryElement.textContent = String(value || "");
        return temporaryElement.innerHTML;
    }

    /* ======================================================
       ELEMENT CACHE
    ====================================================== */

    function cacheElements() {
        App.elements = {
            body: document.body,

            navbar:
                query(".navbar") ||
                query(".site-header") ||
                query("header"),

            mobileMenuToggle:
                getById("mobile-menu-toggle") ||
                query(".mobile-menu-toggle") ||
                query("[data-mobile-menu-toggle]"),

            mobileMenu:
                getById("mobile-menu") ||
                query(".mobile-menu-drawer") ||
                query("[data-mobile-menu]"),

            mobileMenuOverlay:
                getById("mobile-menu-overlay") ||
                query(".mobile-menu-overlay"),

            mobileMenuClose:
                getById("mobile-menu-close") ||
                query(".mobile-menu-close"),

            searchTriggers: queryAll(
                "[data-search-open], .search-trigger, .nav-search-button"
            ),

            searchOverlay:
                getById("global-search-overlay") ||
                query(".global-search-overlay"),

            searchClose:
                getById("global-search-close") ||
                query(".global-search-close"),

            searchInput:
                getById("global-search-input") ||
                query(".global-search-input"),

            cartTriggers: queryAll(
                "[data-cart-open], .cart-trigger, .nav-cart"
            ),

            cartDrawer:
                getById("cart-drawer") ||
                query(".cart-drawer"),

            cartOverlay:
                getById("cart-overlay") ||
                query(".cart-overlay") ||
                query(".drawer-overlay"),

            cartClose:
                getById("cart-close") ||
                query(".cart-close"),

            wishlistTriggers: queryAll(
                "[data-wishlist-open], .wishlist-trigger, .nav-wishlist"
            ),

            wishlistDrawer:
                getById("wishlist-drawer") ||
                query(".wishlist-drawer"),

            wishlistClose:
                getById("wishlist-close") ||
                query(".wishlist-close"),

            profileTriggers: queryAll(
                "[data-profile-open], .profile-trigger, .nav-profile"
            ),

            profileModal:
                getById("profile-modal") ||
                query(".profile-modal") ||
                query("[data-profile-modal]"),

            authModal:
                getById("auth-modal") ||
                query(".auth-modal"),

            authTriggers: queryAll(
                "[data-auth-open], .auth-trigger"
            ),

            modalCloseButtons: queryAll(
                "[data-modal-close], .modal-close, .account-overlay-close"
            ),

            pageSections: queryAll(
                "[data-page], .page-section"
            ),

            navigationLinks: queryAll(
                "[data-route], .nav-link, .mobile-bottom-nav-item"
            ),

            toastContainer:
                getById("toast-container") ||
                query(".toast-container"),

            globalLoader:
                getById("global-loader") ||
                query(".global-loading-overlay"),

            offlineBanner:
                getById("offline-banner") ||
                query(".offline-banner"),

            scrollToTop:
                getById("scroll-to-top") ||
                query(".scroll-to-top"),

            supportButton:
                getById("support-fab") ||
                query(".support-fab"),

            supportPanel:
                getById("support-panel") ||
                query(".support-panel"),

            supportClose:
                getById("support-panel-close") ||
                query(".support-panel-close"),

            cartBadges: queryAll(
                "[data-cart-count], .cart-count, .mobile-cart-count"
            ),

            wishlistBadges: queryAll(
                "[data-wishlist-count], .wishlist-count, .mobile-wishlist-count"
            ),

            newsletterForms: queryAll(
                ".newsletter-form, .footer-newsletter"
            ),

            contactForm:
                getById("contact-form") ||
                query(".contact-form")
        };
    }

    /* ======================================================
       GLOBAL LOADER
    ====================================================== */

    function showLoader(message) {
        const loader = App.elements.globalLoader;

        if (!loader) {
            return;
        }

        const label =
            query("[data-loading-text]", loader) ||
            query("p", loader);

        if (label && message) {
            label.textContent = message;
        }

        loader.classList.add("active");
        loader.setAttribute("aria-hidden", "false");
        document.body.classList.add("no-scroll");
    }

    function hideLoader() {
        const loader = App.elements.globalLoader;

        if (!loader) {
            return;
        }

        loader.classList.remove("active");
        loader.setAttribute("aria-hidden", "true");

        if (!App.state.activeOverlay) {
            document.body.classList.remove("no-scroll");
        }
    }

    /* ======================================================
       TOAST NOTIFICATIONS
    ====================================================== */

    function ensureToastContainer() {
        if (App.elements.toastContainer) {
            return App.elements.toastContainer;
        }

        const container = createElement(
            "div",
            "toast-container",
            {
                id: "toast-container",
                "aria-live": "polite",
                "aria-atomic": "true"
            }
        );

        document.body.appendChild(container);
        App.elements.toastContainer = container;

        return container;
    }

    function getToastIcon(type) {
        const icons = {
            success: "fa-solid fa-check",
            error: "fa-solid fa-xmark",
            warning: "fa-solid fa-triangle-exclamation",
            info: "fa-solid fa-circle-info"
        };

        return icons[type] || icons.info;
    }

    function showToast(options) {
        const settings =
            typeof options === "string"
                ? {
                    message: options
                }
                : options || {};

        const type = settings.type || "info";
        const title =
            settings.title ||
            {
                success: "Success",
                error: "Something went wrong",
                warning: "Please note",
                info: "Information"
            }[type];

        const message =
            settings.message || "Your request has been processed.";

        const duration =
            Number(settings.duration) > 0
                ? Number(settings.duration)
                : App.config.toastDuration;

        const container = ensureToastContainer();

        const toast = createElement(
            "div",
            "toast " + type,
            {
                role: type === "error" ? "alert" : "status"
            }
        );

        toast.style.setProperty(
            "--toast-duration",
            duration + "ms"
        );

        toast.innerHTML = [
            '<div class="toast-icon">',
            '<i class="' + getToastIcon(type) + '"></i>',
            "</div>",
            '<div class="toast-content">',
            "<h4>" + escapeHTML(title) + "</h4>",
            "<p>" + escapeHTML(message) + "</p>",
            settings.actionLabel
                ? '<button class="toast-action" type="button">' +
                  escapeHTML(settings.actionLabel) +
                  "</button>"
                : "",
            "</div>",
            '<button class="toast-close" type="button" aria-label="Close notification">',
            '<i class="fa-solid fa-xmark"></i>',
            "</button>",
            '<div class="toast-progress">',
            '<div class="toast-progress-bar"></div>',
            "</div>"
        ].join("");

        container.appendChild(toast);

        window.requestAnimationFrame(function () {
            toast.classList.add("show");
        });

        let timeoutId = window.setTimeout(function () {
            removeToast(toast);
        }, duration);

        const closeButton = query(".toast-close", toast);
        const actionButton = query(".toast-action", toast);

        if (closeButton) {
            closeButton.addEventListener("click", function () {
                window.clearTimeout(timeoutId);
                removeToast(toast);
            });
        }

        if (
            actionButton &&
            typeof settings.onAction === "function"
        ) {
            actionButton.addEventListener("click", function () {
                window.clearTimeout(timeoutId);
                settings.onAction();
                removeToast(toast);
            });
        }

        toast.addEventListener("mouseenter", function () {
            window.clearTimeout(timeoutId);
        });

        toast.addEventListener("mouseleave", function () {
            timeoutId = window.setTimeout(function () {
                removeToast(toast);
            }, Math.min(duration, 2500));
        });

        return toast;
    }

    function removeToast(toast) {
        if (!toast || !toast.parentNode) {
            return;
        }

        toast.classList.add("hiding");
        toast.classList.remove("show");

        window.setTimeout(function () {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 350);
    }

    /* ======================================================
       OVERLAY MANAGEMENT
    ====================================================== */

    function setOverlayState(name, isOpen) {
        if (isOpen) {
            App.state.activeOverlay = name;
            document.body.classList.add("no-scroll");
        } else if (App.state.activeOverlay === name) {
            App.state.activeOverlay = null;
            document.body.classList.remove("no-scroll");
        }
    }

    function openElement(element, name) {
        if (!element) {
            return false;
        }

        element.classList.add("active", "open");
        element.setAttribute("aria-hidden", "false");
        setOverlayState(name, true);

        return true;
    }

    function closeElement(element, name) {
        if (!element) {
            return false;
        }

        element.classList.remove("active", "open");
        element.setAttribute("aria-hidden", "true");
        setOverlayState(name, false);

        return true;
    }

    function closeAllOverlays() {
        closeSearch();
        closeCart();
        closeWishlist();
        closeProfileModal();
        closeAuthModal();
        closeMobileMenu();
        closeSupportPanel();

        queryAll(
            ".account-overlay.active, .modal.active, .utility-confirm-overlay.active"
        ).forEach(function (element) {
            element.classList.remove("active", "open");
            element.setAttribute("aria-hidden", "true");
        });

        App.state.activeOverlay = null;
        document.body.classList.remove("no-scroll");
    }

    /* ======================================================
       GLOBAL SEARCH
    ====================================================== */

    function openSearch() {
        const opened = openElement(
            App.elements.searchOverlay,
            "search"
        );

        if (!opened) {
            return;
        }

        document.body.classList.add("search-open");

        window.setTimeout(function () {
            if (App.elements.searchInput) {
                App.elements.searchInput.focus();
            }
        }, 180);
    }

    function closeSearch() {
        closeElement(
            App.elements.searchOverlay,
            "search"
        );

        document.body.classList.remove("search-open");
    }

    /* ======================================================
       CART DRAWER
    ====================================================== */

    function openCart() {
        if (!App.elements.cartDrawer) {
            showToast({
                type: "info",
                title: "Shopping bag",
                message: "Your shopping bag is not available yet."
            });

            return;
        }

        openElement(
            App.elements.cartDrawer,
            "cart"
        );

        if (App.elements.cartOverlay) {
            App.elements.cartOverlay.classList.add("active");
        }
    }

    function closeCart() {
        closeElement(
            App.elements.cartDrawer,
            "cart"
        );

        if (App.elements.cartOverlay) {
            App.elements.cartOverlay.classList.remove("active");
        }
    }

    /* ======================================================
       WISHLIST DRAWER
    ====================================================== */

    function openWishlist() {
        if (!App.elements.wishlistDrawer) {
            showToast({
                type: "info",
                title: "Wishlist",
                message: "Your wishlist is not available yet."
            });

            return;
        }

        openElement(
            App.elements.wishlistDrawer,
            "wishlist"
        );

        if (App.elements.cartOverlay) {
            App.elements.cartOverlay.classList.add("active");
        }
    }

    function closeWishlist() {
        closeElement(
            App.elements.wishlistDrawer,
            "wishlist"
        );

        if (App.elements.cartOverlay) {
            App.elements.cartOverlay.classList.remove("active");
        }
    }

    /* ======================================================
       PROFILE & AUTH MODALS
    ====================================================== */

    function openProfileModal() {
        if (!App.state.currentUser) {
            openAuthModal();
            return;
        }

        openElement(
            App.elements.profileModal,
            "profile"
        );
    }

    function closeProfileModal() {
        closeElement(
            App.elements.profileModal,
            "profile"
        );
    }

    function openAuthModal(panelName) {
        if (!App.elements.authModal) {
            showToast({
                type: "error",
                message: "The authentication interface could not be found."
            });

            return;
        }

        openElement(
            App.elements.authModal,
            "auth"
        );

        if (panelName) {
            activateAuthPanel(panelName);
        }
    }

    function closeAuthModal() {
        closeElement(
            App.elements.authModal,
            "auth"
        );
    }

    function activateAuthPanel(panelName) {
        const authModal = App.elements.authModal;

        if (!authModal) {
            return;
        }

        queryAll("[data-auth-panel]", authModal).forEach(
            function (panel) {
                panel.classList.toggle(
                    "active",
                    panel.dataset.authPanel === panelName
                );
            }
        );

        queryAll("[data-auth-tab]", authModal).forEach(
            function (tab) {
                tab.classList.toggle(
                    "active",
                    tab.dataset.authTab === panelName
                );
            }
        );
    }

    /* ======================================================
       MOBILE MENU
    ====================================================== */

    function openMobileMenu() {
        if (!App.elements.mobileMenu) {
            return;
        }

        App.elements.mobileMenu.classList.add("active");
        App.elements.mobileMenu.setAttribute(
            "aria-hidden",
            "false"
        );

        if (App.elements.mobileMenuOverlay) {
            App.elements.mobileMenuOverlay.classList.add(
                "active"
            );
        }

        setOverlayState("mobile-menu", true);
    }

    function closeMobileMenu() {
        if (App.elements.mobileMenu) {
            App.elements.mobileMenu.classList.remove("active");
            App.elements.mobileMenu.setAttribute(
                "aria-hidden",
                "true"
            );
        }

        if (App.elements.mobileMenuOverlay) {
            App.elements.mobileMenuOverlay.classList.remove(
                "active"
            );
        }

        setOverlayState("mobile-menu", false);
    }

    /* ======================================================
       SUPPORT PANEL
    ====================================================== */

    function openSupportPanel() {
        openElement(
            App.elements.supportPanel,
            "support"
        );
    }

    function closeSupportPanel() {
        closeElement(
            App.elements.supportPanel,
            "support"
        );
    }

    function toggleSupportPanel() {
        const panel = App.elements.supportPanel;

        if (!panel) {
            return;
        }

        if (panel.classList.contains("active")) {
            closeSupportPanel();
        } else {
            openSupportPanel();
        }
    }

    /* ======================================================
       COUNTER BADGES
    ====================================================== */

    function renderCountBadges(elements, count) {
        const normalizedCount = Math.max(
            0,
            Number(count) || 0
        );

        elements.forEach(function (badge) {
            badge.textContent =
                normalizedCount > 99
                    ? "99+"
                    : String(normalizedCount);

            badge.hidden = normalizedCount === 0;
            badge.setAttribute(
                "aria-label",
                normalizedCount + " items"
            );
        });
    }

    function setCartCount(count) {
        App.state.cartCount = Math.max(
            0,
            Number(count) || 0
        );

        renderCountBadges(
            App.elements.cartBadges,
            App.state.cartCount
        );
    }

    function setWishlistCount(count) {
        App.state.wishlistCount = Math.max(
            0,
            Number(count) || 0
        );

        renderCountBadges(
            App.elements.wishlistBadges,
            App.state.wishlistCount
        );
    }

    /* ======================================================
       NAVIGATION STATE
    ====================================================== */

    function normalizeRoute(route) {
        return String(route || "home")
            .trim()
            .replace(/^#\/?/, "")
            .replace(/^\/+|\/+$/g, "")
            .toLowerCase() || "home";
    }

    function updateNavigationState(route) {
        const normalizedRoute = normalizeRoute(route);

        App.elements.navigationLinks.forEach(
            function (link) {
                const linkRoute = normalizeRoute(
                    link.dataset.route ||
                    link.getAttribute("href")
                );

                const isActive =
                    linkRoute === normalizedRoute;

                link.classList.toggle(
                    "active",
                    isActive
                );

                if (isActive) {
                    link.setAttribute(
                        "aria-current",
                        "page"
                    );
                } else {
                    link.removeAttribute(
                        "aria-current"
                    );
                }
            }
        );
    }

    function showPage(route) {
        const normalizedRoute = normalizeRoute(route);

        if (!App.elements.pageSections.length) {
            App.state.currentRoute = normalizedRoute;
            updateNavigationState(normalizedRoute);
            return;
        }

        let pageFound = false;

        App.elements.pageSections.forEach(
            function (section) {
                const sectionRoute = normalizeRoute(
                    section.dataset.page ||
                    section.id.replace(/-page$/, "")
                );

                const isActive =
                    sectionRoute === normalizedRoute;

                section.classList.toggle(
                    "active",
                    isActive
                );

                section.hidden = !isActive;

                if (isActive) {
                    pageFound = true;
                }
            }
        );

        if (!pageFound && normalizedRoute !== "home") {
            showPage("home");
            return;
        }

        App.state.currentRoute = normalizedRoute;
        updateNavigationState(normalizedRoute);
        closeMobileMenu();

        window.scrollTo({
            top: 0,
            behavior:
                window.matchMedia(
                    "(prefers-reduced-motion: reduce)"
                ).matches
                    ? "auto"
                    : "smooth"
        });

        document.dispatchEvent(
            new CustomEvent("app:routechange", {
                detail: {
                    route: normalizedRoute
                }
            })
        );
    }

    function navigate(route, options) {
        const normalizedRoute = normalizeRoute(route);
        const settings = options || {};

        if (!settings.skipHistory) {
            window.history.pushState(
                {
                    route: normalizedRoute
                },
                "",
                "#/" + normalizedRoute
            );
        }

        showPage(normalizedRoute);
    }

    function getInitialRoute() {
        return normalizeRoute(
            window.location.hash || "home"
        );
    }

    /* ======================================================
       NAVBAR & SCROLL
    ====================================================== */

    function handleScroll() {
        const scrollTop =
            window.pageYOffset ||
            document.documentElement.scrollTop;

        if (App.elements.navbar) {
            App.elements.navbar.classList.toggle(
                "scrolled",
                scrollTop > App.config.scrollThreshold
            );
        }

        if (App.elements.scrollToTop) {
            App.elements.scrollToTop.classList.toggle(
                "visible",
                scrollTop > 650
            );
        }
    }

    function scrollToTop() {
        window.scrollTo({
            top: 0,
            behavior:
                window.matchMedia(
                    "(prefers-reduced-motion: reduce)"
                ).matches
                    ? "auto"
                    : "smooth"
        });
    }

    /* ======================================================
       ONLINE / OFFLINE STATE
    ====================================================== */

    function updateConnectionStatus(isOnline) {
        App.state.isOnline = Boolean(isOnline);

        const banner = App.elements.offlineBanner;

        if (banner) {
            banner.classList.toggle(
                "active",
                !App.state.isOnline
            );

            banner.classList.toggle(
                "online",
                App.state.isOnline
            );

            const text =
                query("[data-offline-text]", banner) ||
                query("span", banner);

            if (text) {
                text.textContent = App.state.isOnline
                    ? "You are back online."
                    : "You are offline. Some features may be unavailable.";
            }
        }

        document.dispatchEvent(
            new CustomEvent(
                "app:connectionchange",
                {
                    detail: {
                        isOnline: App.state.isOnline
                    }
                }
            )
        );

        if (App.state.isOnline) {
            showToast({
                type: "success",
                title: "Connection restored",
                message: "You are back online.",
                duration: 2800
            });
        }
    }

    /* ======================================================
       AUTHENTICATION STATE
    ====================================================== */

    function setCurrentUser(user) {
        App.state.currentUser = user || null;

        document.body.classList.toggle(
            "is-authenticated",
            Boolean(user)
        );

        document.body.classList.toggle(
            "is-guest",
            !user
        );

        queryAll("[data-auth-only]").forEach(
            function (element) {
                element.hidden = !user;
            }
        );

        queryAll("[data-guest-only]").forEach(
            function (element) {
                element.hidden = Boolean(user);
            }
        );

        queryAll("[data-user-name]").forEach(
            function (element) {
                element.textContent = user
                    ? user.displayName ||
                      user.email ||
                      "Customer"
                    : "Guest";
            }
        );

        queryAll("[data-user-email]").forEach(
            function (element) {
                element.textContent = user
                    ? user.email || ""
                    : "";
            }
        );

        queryAll("[data-user-avatar]").forEach(
            function (image) {
                if (user && user.photoURL) {
                    image.src = user.photoURL;
                }
            }
        );

        document.dispatchEvent(
            new CustomEvent(
                "app:authchange",
                {
                    detail: {
                        user: user || null
                    }
                }
            )
        );
    }

    function observeAuthentication() {
        if (
            !window.FirebaseServices ||
            !window.FirebaseServices.auth
        ) {
            console.warn(
                "[App] Firebase authentication is unavailable."
            );

            return;
        }

        window.FirebaseServices.auth.onAuthStateChanged(
            function (user) {
                setCurrentUser(user);

                if (
                    user &&
                    App.elements.authModal &&
                    App.elements.authModal.classList.contains(
                        "active"
                    )
                ) {
                    closeAuthModal();
                }
            },
            function (error) {
                console.error(
                    "[App] Authentication state error:",
                    error
                );

                showToast({
                    type: "error",
                    title: "Authentication error",
                    message:
                        error.message ||
                        "Unable to verify your session."
                });
            }
        );
    }

    /* ======================================================
       NEWSLETTER
    ====================================================== */

    function handleNewsletterSubmit(event) {
        event.preventDefault();

        const form = event.currentTarget;
        const input = query(
            'input[type="email"]',
            form
        );

        if (!input) {
            return;
        }

        const email = input.value.trim();

        if (!isValidEmail(email)) {
            showToast({
                type: "error",
                title: "Invalid email",
                message:
                    "Please enter a valid email address."
            });

            input.focus();
            return;
        }

        showToast({
            type: "success",
            title: "Welcome to L'ÉTERNEL",
            message:
                "You have successfully joined our private newsletter."
        });

        form.reset();

        document.dispatchEvent(
            new CustomEvent(
                "app:newsletter",
                {
                    detail: {
                        email: email
                    }
                }
            )
        );
    }

    function isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
            String(email || "")
        );
    }

    /* ======================================================
       CONTACT FORM
    ====================================================== */

    function handleContactSubmit(event) {
        event.preventDefault();

        const form = event.currentTarget;
        const submitButton = query(
            'button[type="submit"]',
            form
        );

        const formData = new FormData(form);

        const name = String(
            formData.get("name") ||
            formData.get("fullName") ||
            ""
        ).trim();

        const email = String(
            formData.get("email") || ""
        ).trim();

        const message = String(
            formData.get("message") || ""
        ).trim();

        if (!name || !isValidEmail(email) || !message) {
            showToast({
                type: "error",
                title: "Incomplete message",
                message:
                    "Please provide your name, email address, and message."
            });

            return;
        }

        if (submitButton) {
            submitButton.classList.add("loading");
            submitButton.disabled = true;
        }

        document.dispatchEvent(
            new CustomEvent(
                "app:contactsubmit",
                {
                    detail: {
                        name: name,
                        email: email,
                        subject:
                            String(
                                formData.get("subject") || ""
                            ).trim(),
                        message: message,
                        form: form
                    }
                }
            )
        );

        window.setTimeout(function () {
            if (submitButton) {
                submitButton.classList.remove("loading");
                submitButton.disabled = false;
            }

            form.reset();

            showToast({
                type: "success",
                title: "Message received",
                message:
                    "Thank you. Our client services team will respond shortly."
            });
        }, 650);
    }

    /* ======================================================
       EVENT BINDING
    ====================================================== */

    function bindNavigationEvents() {
        document.addEventListener(
            "click",
            function (event) {
                const routeLink = event.target.closest(
                    "[data-route]"
                );

                if (!routeLink) {
                    return;
                }

                const route =
                    routeLink.dataset.route;

                if (!route) {
                    return;
                }

                event.preventDefault();
                navigate(route);
            }
        );

        window.addEventListener(
            "popstate",
            function (event) {
                const route =
                    event.state &&
                    event.state.route
                        ? event.state.route
                        : getInitialRoute();

                showPage(route);
            }
        );

        window.addEventListener(
            "hashchange",
            function () {
                showPage(getInitialRoute());
            }
        );
    }

    function bindOverlayEvents() {
        App.elements.searchTriggers.forEach(
            function (trigger) {
                trigger.addEventListener(
                    "click",
                    openSearch
                );
            }
        );

        if (App.elements.searchClose) {
            App.elements.searchClose.addEventListener(
                "click",
                closeSearch
            );
        }

        App.elements.cartTriggers.forEach(
            function (trigger) {
                trigger.addEventListener(
                    "click",
                    openCart
                );
            }
        );

        if (App.elements.cartClose) {
            App.elements.cartClose.addEventListener(
                "click",
                closeCart
            );
        }

        App.elements.wishlistTriggers.forEach(
            function (trigger) {
                trigger.addEventListener(
                    "click",
                    openWishlist
                );
            }
        );

        if (App.elements.wishlistClose) {
            App.elements.wishlistClose.addEventListener(
                "click",
                closeWishlist
            );
        }

        App.elements.profileTriggers.forEach(
            function (trigger) {
                trigger.addEventListener(
                    "click",
                    openProfileModal
                );
            }
        );

        App.elements.authTriggers.forEach(
            function (trigger) {
                trigger.addEventListener(
                    "click",
                    function () {
                        openAuthModal(
                            trigger.dataset.authPanel ||
                            "login"
                        );
                    }
                );
            }
        );

        App.elements.modalCloseButtons.forEach(
            function (button) {
                button.addEventListener(
                    "click",
                    function () {
                        const overlay = button.closest(
                            ".modal, .account-overlay, .auth-modal, .profile-modal"
                        );

                        if (overlay) {
                            overlay.classList.remove(
                                "active",
                                "open"
                            );

                            overlay.setAttribute(
                                "aria-hidden",
                                "true"
                            );

                            App.state.activeOverlay = null;
                            document.body.classList.remove(
                                "no-scroll"
                            );
                        }
                    }
                );
            }
        );

        if (App.elements.cartOverlay) {
            App.elements.cartOverlay.addEventListener(
                "click",
                function () {
                    closeCart();
                    closeWishlist();
                }
            );
        }

        if (App.elements.searchOverlay) {
            App.elements.searchOverlay.addEventListener(
                "click",
                function (event) {
                    if (
                        event.target ===
                        App.elements.searchOverlay
                    ) {
                        closeSearch();
                    }
                }
            );
        }

        queryAll(
            ".account-overlay, .modal, .auth-modal, .profile-modal"
        ).forEach(function (overlay) {
            overlay.addEventListener(
                "click",
                function (event) {
                    if (event.target === overlay) {
                        overlay.classList.remove(
                            "active",
                            "open"
                        );

                        overlay.setAttribute(
                            "aria-hidden",
                            "true"
                        );

                        App.state.activeOverlay = null;
                        document.body.classList.remove(
                            "no-scroll"
                        );
                    }
                }
            );
        });
    }

    function bindMobileMenuEvents() {
        if (App.elements.mobileMenuToggle) {
            App.elements.mobileMenuToggle.addEventListener(
                "click",
                openMobileMenu
            );
        }

        if (App.elements.mobileMenuClose) {
            App.elements.mobileMenuClose.addEventListener(
                "click",
                closeMobileMenu
            );
        }

        if (App.elements.mobileMenuOverlay) {
            App.elements.mobileMenuOverlay.addEventListener(
                "click",
                closeMobileMenu
            );
        }
    }

    function bindSupportEvents() {
        if (App.elements.supportButton) {
            App.elements.supportButton.addEventListener(
                "click",
                toggleSupportPanel
            );
        }

        if (App.elements.supportClose) {
            App.elements.supportClose.addEventListener(
                "click",
                closeSupportPanel
            );
        }
    }

    function bindFormEvents() {
        App.elements.newsletterForms.forEach(
            function (form) {
                form.addEventListener(
                    "submit",
                    handleNewsletterSubmit
                );
            }
        );

        if (App.elements.contactForm) {
            App.elements.contactForm.addEventListener(
                "submit",
                handleContactSubmit
            );
        }
    }

    function bindGlobalEvents() {
        window.addEventListener(
            "scroll",
            handleScroll,
            {
                passive: true
            }
        );

        window.addEventListener(
            "online",
            function () {
                updateConnectionStatus(true);
            }
        );

        window.addEventListener(
            "offline",
            function () {
                updateConnectionStatus(false);
            }
        );

        window.addEventListener(
            "resize",
            function () {
                if (
                    window.innerWidth >
                    App.config.mobileBreakpoint
                ) {
                    closeMobileMenu();
                }
            }
        );

        document.addEventListener(
            "keydown",
            function (event) {
                if (event.key === "Escape") {
                    closeAllOverlays();
                }

                const searchShortcut =
                    (event.ctrlKey || event.metaKey) &&
                    event.key.toLowerCase() === "k";

                if (searchShortcut) {
                    event.preventDefault();

                    if (
                        App.elements.searchOverlay &&
                        App.elements.searchOverlay.classList.contains(
                            "active"
                        )
                    ) {
                        closeSearch();
                    } else {
                        openSearch();
                    }
                }
            }
        );

        if (App.elements.scrollToTop) {
            App.elements.scrollToTop.addEventListener(
                "click",
                scrollToTop
            );
        }

        document.addEventListener(
            "click",
            function (event) {
                const authSwitch = event.target.closest(
                    "[data-auth-tab]"
                );

                if (authSwitch) {
                    activateAuthPanel(
                        authSwitch.dataset.authTab
                    );
                }
            }
        );
    }

    /* ======================================================
       INITIAL INTERFACE STATE
    ====================================================== */

    function initializeInterfaceState() {
        setCartCount(0);
        setWishlistCount(0);
        handleScroll();

        const initialRoute = getInitialRoute();

        window.history.replaceState(
            {
                route: initialRoute
            },
            "",
            "#/" + initialRoute
        );

        showPage(initialRoute);

        if (!App.state.isOnline) {
            updateConnectionStatus(false);
        }
    }

    /* ======================================================
       APPLICATION INITIALIZATION
    ====================================================== */

    function initialize() {
        if (App.state.initialized) {
            return;
        }

        cacheElements();

        bindNavigationEvents();
        bindOverlayEvents();
        bindMobileMenuEvents();
        bindSupportEvents();
        bindFormEvents();
        bindGlobalEvents();

        initializeInterfaceState();
        observeAuthentication();

        App.state.initialized = true;

        document.documentElement.classList.add(
            "app-ready"
        );

        document.dispatchEvent(
            new CustomEvent("app:ready", {
                detail: {
                    app: App
                }
            })
        );

        hideLoader();

        console.info(
            "[App] L'ÉTERNEL Store initialized."
        );
    }

    /* ======================================================
       PUBLIC APPLICATION API
    ====================================================== */

    App.init = initialize;

    App.navigate = navigate;
    App.showPage = showPage;

    App.showLoader = showLoader;
    App.hideLoader = hideLoader;

    App.showToast = showToast;
    App.removeToast = removeToast;

    App.openSearch = openSearch;
    App.closeSearch = closeSearch;

    App.openCart = openCart;
    App.closeCart = closeCart;

    App.openWishlist = openWishlist;
    App.closeWishlist = closeWishlist;

    App.openProfile = openProfileModal;
    App.closeProfile = closeProfileModal;

    App.openAuth = openAuthModal;
    App.closeAuth = closeAuthModal;
    App.activateAuthPanel = activateAuthPanel;

    App.openMobileMenu = openMobileMenu;
    App.closeMobileMenu = closeMobileMenu;

    App.setCartCount = setCartCount;
    App.setWishlistCount = setWishlistCount;

    App.setCurrentUser = setCurrentUser;
    App.closeAllOverlays = closeAllOverlays;

    App.utils = Object.freeze({
        query: query,
        queryAll: queryAll,
        getById: getById,
        createElement: createElement,
        escapeHTML: escapeHTML,
        isValidEmail: isValidEmail,
        normalizeRoute: normalizeRoute
    });

    window.LEternelApp = App;

    /* ======================================================
       START APPLICATION
    ====================================================== */

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
