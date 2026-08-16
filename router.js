//javascript
"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   SPA ROUTER
========================================================== */

(function initializeRouterModule() {
    const app = window.LEternelApp;

    if (!app) {
        throw new Error(
            "LEternelApp was not found. Load app.js before router.js."
        );
    }

    const Router = {
        initialized: false,
        currentRoute: null,
        previousRoute: null,
        pendingRoute: null,
        routes: new Map(),
        fallbackRoute: "home",
        unsubscribeAuth: null
    };

    const routePatterns = {
        parameter: /:([a-zA-Z0-9_]+)/g,
        wildcard: /\*/g
    };

    /* ======================================================
       ROUTE CONFIGURATION
    ====================================================== */

    const defaultRoutes = [
        {
            name: "home",
            path: "/",
            page: "home",
            title: "L'ÉTERNEL — Timeless Luxury",
            description:
                "Discover timeless luxury fashion, refined craftsmanship, and enduring design.",
            public: true
        },
        {
            name: "shop",
            path: "/shop",
            page: "shop",
            title: "Shop — L'ÉTERNEL",
            description:
                "Explore the complete L'ÉTERNEL collection.",
            public: true
        },
        {
            name: "collection",
            path: "/collection/:slug",
            page: "shop",
            title: "Collection — L'ÉTERNEL",
            public: true
        },
        {
            name: "product",
            path: "/product/:id",
            page: "product",
            title: "Product — L'ÉTERNEL",
            public: true
        },
        {
            name: "heritage",
            path: "/heritage",
            page: "heritage",
            title: "Our Heritage — L'ÉTERNEL",
            description:
                "Discover the philosophy, craftsmanship, and heritage behind L'ÉTERNEL.",
            public: true
        },
        {
            name: "contact",
            path: "/contact",
            page: "home",
            title: "Contact — L'ÉTERNEL",
            public: true,
            scrollTarget: "contact"
        },
        {
            name: "checkout",
            path: "/checkout",
            page: "checkout",
            title: "Secure Checkout — L'ÉTERNEL",
            requiresCart: true,
            public: true
        },
        {
            name: "account",
            path: "/account",
            page: "account",
            title: "My Account — L'ÉTERNEL",
            requiresAuth: true
        },
        {
            name: "account-overview",
            path: "/account/overview",
            page: "account",
            accountSection: "overview",
            title: "Account Overview — L'ÉTERNEL",
            requiresAuth: true
        },
        {
            name: "account-orders",
            path: "/account/orders",
            page: "account",
            accountSection: "orders",
            title: "My Orders — L'ÉTERNEL",
            requiresAuth: true
        },
        {
            name: "account-wishlist",
            path: "/account/wishlist",
            page: "account",
            accountSection: "wishlist",
            title: "My Wishlist — L'ÉTERNEL",
            requiresAuth: true
        },
        {
            name: "account-addresses",
            path: "/account/addresses",
            page: "account",
            accountSection: "addresses",
            title: "Address Book — L'ÉTERNEL",
            requiresAuth: true
        },
        {
            name: "account-payments",
            path: "/account/payments",
            page: "account",
            accountSection: "payments",
            title: "Payment Methods — L'ÉTERNEL",
            requiresAuth: true
        },
        {
            name: "account-settings",
            path: "/account/settings",
            page: "account",
            accountSection: "settings",
            title: "Account Settings — L'ÉTERNEL",
            requiresAuth: true
        },
        {
            name: "admin",
            path: "/admin",
            page: "admin",
            adminSection: "dashboard",
            title: "Admin Dashboard — L'ÉTERNEL",
            requiresAuth: true,
            requiresAdmin: true
        },
        {
            name: "admin-products",
            path: "/admin/products",
            page: "admin",
            adminSection: "products",
            title: "Products — L'ÉTERNEL Admin",
            requiresAuth: true,
            requiresAdmin: true
        },
        {
            name: "admin-product-new",
            path: "/admin/products/new",
            page: "admin",
            adminSection: "product-form",
            title: "Add Product — L'ÉTERNEL Admin",
            requiresAuth: true,
            requiresAdmin: true
        },
        {
            name: "admin-product-edit",
            path: "/admin/products/:id/edit",
            page: "admin",
            adminSection: "product-form",
            title: "Edit Product — L'ÉTERNEL Admin",
            requiresAuth: true,
            requiresAdmin: true
        },
        {
            name: "admin-orders",
            path: "/admin/orders",
            page: "admin",
            adminSection: "orders",
            title: "Orders — L'ÉTERNEL Admin",
            requiresAuth: true,
            requiresAdmin: true
        },
        {
            name: "admin-order",
            path: "/admin/orders/:id",
            page: "admin",
            adminSection: "order-detail",
            title: "Order Details — L'ÉTERNEL Admin",
            requiresAuth: true,
            requiresAdmin: true
        },
        {
            name: "admin-customers",
            path: "/admin/customers",
            page: "admin",
            adminSection: "customers",
            title: "Customers — L'ÉTERNEL Admin",
            requiresAuth: true,
            requiresAdmin: true
        },
        {
            name: "admin-analytics",
            path: "/admin/analytics",
            page: "admin",
            adminSection: "analytics",
            title: "Analytics — L'ÉTERNEL Admin",
            requiresAuth: true,
            requiresAdmin: true
        },
        {
            name: "not-found",
            path: "/404",
            page: "not-found",
            title: "Page Not Found — L'ÉTERNEL",
            public: true
        }
    ];

    /* ======================================================
       PATH UTILITIES
    ====================================================== */

    function normalizePath(path) {
        let normalized = String(path || "/").trim();

        normalized = normalized
            .replace(/^#/, "")
            .replace(/^!/, "");

        if (!normalized.startsWith("/")) {
            normalized = "/" + normalized;
        }

        normalized = normalized
            .replace(/\/{2,}/g, "/")
            .replace(/\/+$/, "");

        return normalized || "/";
    }

    function getPathFromLocation() {
        const hash = window.location.hash;

        if (!hash || hash === "#") {
            return "/";
        }

        return normalizePath(
            hash.replace(/^#\/?/, "/")
        );
    }

    function buildHash(path) {
        return "#" + normalizePath(path);
    }

    function parseQueryString(search) {
        const query = {};
        const value = String(search || "").replace(/^\?/, "");

        if (!value) {
            return query;
        }

        const parameters = new URLSearchParams(value);

        parameters.forEach(function (parameterValue, key) {
            if (Object.prototype.hasOwnProperty.call(query, key)) {
                if (!Array.isArray(query[key])) {
                    query[key] = [query[key]];
                }

                query[key].push(parameterValue);
            } else {
                query[key] = parameterValue;
            }
        });

        return query;
    }

    function splitPathAndQuery(path) {
        const rawPath = String(path || "/");
        const questionMarkIndex = rawPath.indexOf("?");

        if (questionMarkIndex === -1) {
            return {
                pathname: normalizePath(rawPath),
                queryString: "",
                query: {}
            };
        }

        const pathname = rawPath.slice(0, questionMarkIndex);
        const queryString = rawPath.slice(questionMarkIndex + 1);

        return {
            pathname: normalizePath(pathname),
            queryString: queryString,
            query: parseQueryString(queryString)
        };
    }

    function decodeParameter(value) {
        try {
            return decodeURIComponent(value);
        } catch (error) {
            return value;
        }
    }

    function encodeParameter(value) {
        return encodeURIComponent(String(value));
    }

    /* ======================================================
       ROUTE COMPILATION
    ====================================================== */

    function compileRoutePath(path) {
        const parameterNames = [];
        let pattern = normalizePath(path);

        if (pattern === "/") {
            return {
                regex: /^\/$/,
                parameterNames: parameterNames
            };
        }

        pattern = pattern.replace(
            routePatterns.parameter,
            function (match, parameterName) {
                parameterNames.push(parameterName);
                return "([^/]+)";
            }
        );

        pattern = pattern.replace(
            routePatterns.wildcard,
            function () {
                parameterNames.push("wildcard");
                return "(.*)";
            }
        );

        return {
            regex: new RegExp("^" + pattern + "$"),
            parameterNames: parameterNames
        };
    }

    function registerRoute(route) {
        if (!route || !route.name || !route.path) {
            throw new TypeError(
                "Every route requires a unique name and path."
            );
        }

        const compiled = compileRoutePath(route.path);

        Router.routes.set(
            route.name,
            Object.freeze(
                Object.assign({}, route, {
                    path: normalizePath(route.path),
                    regex: compiled.regex,
                    parameterNames: compiled.parameterNames
                })
            )
        );
    }

    function registerRoutes(routes) {
        routes.forEach(registerRoute);
    }

    function findRouteByName(name) {
        return Router.routes.get(name) || null;
    }

    function matchRoute(path) {
        const splitPath = splitPathAndQuery(path);
        const routes = Array.from(Router.routes.values());

        for (let index = 0; index < routes.length; index += 1) {
            const route = routes[index];
            const match = splitPath.pathname.match(route.regex);

            if (!match) {
                continue;
            }

            const params = {};

            route.parameterNames.forEach(
                function (parameterName, parameterIndex) {
                    params[parameterName] = decodeParameter(
                        match[parameterIndex + 1] || ""
                    );
                }
            );

            return {
                route: route,
                params: params,
                query: splitPath.query,
                pathname: splitPath.pathname,
                queryString: splitPath.queryString,
                fullPath:
                    splitPath.pathname +
                    (splitPath.queryString
                        ? "?" + splitPath.queryString
                        : "")
            };
        }

        return null;
    }

    function buildPath(name, params, query) {
        const route = findRouteByName(name);

        if (!route) {
            throw new Error(
                'Unknown route "' + name + '".'
            );
        }

        const values = params || {};
        let path = route.path;

        path = path.replace(
            routePatterns.parameter,
            function (match, parameterName) {
                if (
                    !Object.prototype.hasOwnProperty.call(
                        values,
                        parameterName
                    )
                ) {
                    throw new Error(
                        'Missing route parameter "' +
                        parameterName +
                        '" for route "' +
                        name +
                        '".'
                    );
                }

                return encodeParameter(values[parameterName]);
            }
        );

        if (query && typeof query === "object") {
            const queryParameters = new URLSearchParams();

            Object.keys(query).forEach(function (key) {
                const value = query[key];

                if (
                    value === undefined ||
                    value === null ||
                    value === ""
                ) {
                    return;
                }

                if (Array.isArray(value)) {
                    value.forEach(function (item) {
                        queryParameters.append(key, item);
                    });
                } else {
                    queryParameters.set(key, value);
                }
            });

            const queryString = queryParameters.toString();

            if (queryString) {
                path += "?" + queryString;
            }
        }

        return path;
    }

    /* ======================================================
       AUTHENTICATION & ADMIN HELPERS
    ====================================================== */

    function getCurrentUser() {
        if (
            window.FirebaseServices &&
            window.FirebaseServices.auth
        ) {
            return window.FirebaseServices.auth.currentUser;
        }

        return app.state.currentUser || null;
    }

    async function getUserRole(user) {
        if (!user) {
            return null;
        }

        if (
            window.LEternelAuth &&
            typeof window.LEternelAuth.getUserRole === "function"
        ) {
            return window.LEternelAuth.getUserRole(user);
        }

        if (
            !window.FirebaseServices ||
            !window.FirebaseServices.db
        ) {
            return null;
        }

        try {
            const userDocument = await window.FirebaseServices.db
                .collection("users")
                .doc(user.uid)
                .get();

            if (!userDocument.exists) {
                return null;
            }

            const userData = userDocument.data() || {};

            return userData.role || null;
        } catch (error) {
            console.error(
                "[Router] Unable to retrieve user role:",
                error
            );

            return null;
        }
    }

    async function isAdmin(user) {
        if (!user) {
            return false;
        }

        try {
            const tokenResult = await user.getIdTokenResult();

            if (
                tokenResult &&
                tokenResult.claims &&
                tokenResult.claims.admin === true
            ) {
                return true;
            }
        } catch (error) {
            console.warn(
                "[Router] Unable to inspect custom claims:",
                error
            );
        }

        const role = await getUserRole(user);

        return role === "admin" || role === "superadmin";
    }

    function hasCartItems() {
        if (
            window.LEternelCart &&
            typeof window.LEternelCart.getItemCount === "function"
        ) {
            return window.LEternelCart.getItemCount() > 0;
        }

        return Number(app.state.cartCount) > 0;
    }

    /* ======================================================
       ROUTE GUARDS
    ====================================================== */

    async function runRouteGuards(match) {
        const route = match.route;
        const user = getCurrentUser();

        if (route.requiresAuth && !user) {
            Router.pendingRoute = match.fullPath;

            app.showToast({
                type: "info",
                title: "Sign in required",
                message:
                    "Please sign in to access this section."
            });

            app.openAuth("login");

            return {
                allowed: false,
                reason: "authentication-required"
            };
        }

        if (route.requiresAdmin) {
            app.showLoader("Verifying administrator access…");

            const adminAccess = await isAdmin(user);

            app.hideLoader();

            if (!adminAccess) {
                app.showToast({
                    type: "error",
                    title: "Access denied",
                    message:
                        "You do not have permission to access the administration area."
                });

                return {
                    allowed: false,
                    redirect: user ? "/account" : "/",
                    reason: "admin-required"
                };
            }
        }

        if (route.requiresCart && !hasCartItems()) {
            app.showToast({
                type: "warning",
                title: "Your bag is empty",
                message:
                    "Add at least one item before proceeding to checkout."
            });

            return {
                allowed: false,
                redirect: "/shop",
                reason: "cart-required"
            };
        }

        if (typeof route.guard === "function") {
            try {
                const guardResult = await route.guard({
                    route: route,
                    params: match.params,
                    query: match.query,
                    user: user
                });

                if (guardResult === false) {
                    return {
                        allowed: false,
                        reason: "custom-guard"
                    };
                }

                if (
                    guardResult &&
                    typeof guardResult === "object"
                ) {
                    return Object.assign(
                        {
                            allowed: true
                        },
                        guardResult
                    );
                }
            } catch (error) {
                console.error(
                    "[Router] Custom route guard failed:",
                    error
                );

                app.showToast({
                    type: "error",
                    title: "Navigation error",
                    message:
                        "This page could not be opened."
                });

                return {
                    allowed: false,
                    reason: "guard-error"
                };
            }
        }

        return {
            allowed: true
        };
    }

    /* ======================================================
       PAGE RENDERING
    ====================================================== */

    function findPageElement(pageName) {
        if (!pageName) {
            return null;
        }

        return (
            document.querySelector(
                '[data-page="' + pageName + '"]'
            ) ||
            document.getElementById(pageName + "-page") ||
            document.querySelector(
                ".page-" + pageName
            )
        );
    }

    function renderPage(pageName) {
        const pageElements = Array.prototype.slice.call(
            document.querySelectorAll(
                "[data-page], .page-section"
            )
        );

        if (!pageElements.length) {
            app.state.currentRoute = pageName;
            return;
        }

        let matchedElement = null;

        pageElements.forEach(function (pageElement) {
            const elementPageName =
                pageElement.dataset.page ||
                pageElement.id.replace(/-page$/, "");

            const isActive = elementPageName === pageName;

            pageElement.classList.toggle("active", isActive);
            pageElement.hidden = !isActive;

            if (isActive) {
                matchedElement = pageElement;
            }
        });

        if (!matchedElement) {
            matchedElement = findPageElement(pageName);

            if (matchedElement) {
                matchedElement.classList.add("active");
                matchedElement.hidden = false;
            }
        }

        return matchedElement;
    }

    function activateAccountSection(sectionName) {
        if (!sectionName) {
            return;
        }

        document
            .querySelectorAll("[data-account-section]")
            .forEach(function (section) {
                const active =
                    section.dataset.accountSection === sectionName;

                section.classList.toggle("active", active);
                section.hidden = !active;
            });

        document
            .querySelectorAll("[data-account-route]")
            .forEach(function (button) {
                button.classList.toggle(
                    "active",
                    button.dataset.accountRoute === sectionName
                );
            });
    }

    function activateAdminSection(sectionName) {
        if (!sectionName) {
            return;
        }

        document
            .querySelectorAll("[data-admin-section]")
            .forEach(function (section) {
                const active =
                    section.dataset.adminSection === sectionName;

                section.classList.toggle("active", active);
                section.hidden = !active;
            });

        document
            .querySelectorAll("[data-admin-route]")
            .forEach(function (button) {
                button.classList.toggle(
                    "active",
                    button.dataset.adminRoute === sectionName
                );
            });
    }

    function updateActiveNavigation(match) {
        const path = match.pathname;
        const routeName = match.route.name;

        document
            .querySelectorAll(
                "[data-route], [data-route-name], .nav-link"
            )
            .forEach(function (link) {
                const routePath =
                    link.dataset.route ||
                    link.getAttribute("href") ||
                    "";

                const linkName =
                    link.dataset.routeName || "";

                const normalizedLinkPath = routePath
                    ? normalizePath(
                        routePath.replace(/^#/, "")
                    )
                    : "";

                const active =
                    linkName === routeName ||
                    normalizedLinkPath === path ||
                    (
                        normalizedLinkPath !== "/" &&
                        path.startsWith(
                            normalizedLinkPath + "/"
                        )
                    );

                link.classList.toggle("active", active);

                if (active) {
                    link.setAttribute("aria-current", "page");
                } else {
                    link.removeAttribute("aria-current");
                }
            });
    }

    function updateDocumentMetadata(match) {
        const route = match.route;
        const title =
            typeof route.title === "function"
                ? route.title(match)
                : route.title;

        if (title) {
            document.title = title;
        }

        if (route.description) {
            let metaDescription = document.querySelector(
                'meta[name="description"]'
            );

            if (!metaDescription) {
                metaDescription = document.createElement("meta");
                metaDescription.name = "description";
                document.head.appendChild(metaDescription);
            }

            metaDescription.content =
                typeof route.description === "function"
                    ? route.description(match)
                    : route.description;
        }
    }

    function updateBodyRouteClasses(match) {
        const routeName = match.route.name;
        const pageName = match.route.page;

        Array.prototype.slice
            .call(document.body.classList)
            .filter(function (className) {
                return (
                    className.startsWith("route-") ||
                    className.startsWith("page-")
                );
            })
            .forEach(function (className) {
                document.body.classList.remove(className);
            });

        document.body.classList.add(
            "route-" + routeName.replace(/[^a-z0-9-]/gi, "-")
        );

        if (pageName) {
            document.body.classList.add(
                "page-" + pageName.replace(/[^a-z0-9-]/gi, "-")
            );
        }
    }

    function scrollAfterNavigation(match, options) {
        const settings = options || {};
        const route = match.route;

        window.requestAnimationFrame(function () {
            if (settings.preserveScroll) {
                return;
            }

            if (settings.scrollTo) {
                scrollToElement(settings.scrollTo);
                return;
            }

            if (route.scrollTarget) {
                scrollToElement(route.scrollTarget);
                return;
            }

            if (match.query.section) {
                scrollToElement(match.query.section);
                return;
            }

            window.scrollTo({
                top: 0,
                left: 0,
                behavior: settings.smooth ? "smooth" : "auto"
            });
        });
    }

    function scrollToElement(target) {
        const element =
            typeof target === "string"
                ? document.getElementById(target) ||
                  document.querySelector(
                      '[data-section="' + target + '"]'
                  ) ||
                  document.querySelector(target)
                : target;

        if (!element) {
            return false;
        }

        element.scrollIntoView({
            behavior: window.matchMedia(
                "(prefers-reduced-motion: reduce)"
            ).matches
                ? "auto"
                : "smooth",
            block: "start"
        });

        return true;
    }

    /* ======================================================
       NAVIGATION
    ====================================================== */

    async function resolve(path, options) {
        const settings = options || {};
        let match = matchRoute(path);

        if (!match) {
            match = matchRoute("/404");
        }

        if (!match) {
            throw new Error(
                "The router requires a registered 404 route."
            );
        }

        const guardResult = await runRouteGuards(match);

        if (!guardResult.allowed) {
            if (guardResult.redirect) {
                return navigate(guardResult.redirect, {
                    replace: true
                });
            }

            return false;
        }

        const previousMatch = Router.currentRoute;

        Router.previousRoute = previousMatch;
        Router.currentRoute = match;

        updateDocumentMetadata(match);
        updateBodyRouteClasses(match);
        updateActiveNavigation(match);

        const pageElement = renderPage(match.route.page);

        if (match.route.accountSection) {
            activateAccountSection(
                match.route.accountSection
            );
        }

        if (match.route.adminSection) {
            activateAdminSection(
                match.route.adminSection
            );
        }

        app.state.currentRoute = match.route.name;

        if (
            match.route.name !== "contact" &&
            typeof app.closeAllOverlays === "function"
        ) {
            app.closeAllOverlays();
        }

        scrollAfterNavigation(match, settings);

        const routeDetail = {
            name: match.route.name,
            path: match.fullPath,
            pathname: match.pathname,
            params: Object.assign({}, match.params),
            query: Object.assign({}, match.query),
            route: match.route,
            pageElement: pageElement,
            previousRoute: previousMatch
        };

        document.dispatchEvent(
            new CustomEvent("router:change", {
                detail: routeDetail
            })
        );

        if (typeof match.route.onEnter === "function") {
            try {
                await match.route.onEnter(routeDetail);
            } catch (error) {
                console.error(
                    "[Router] Route onEnter handler failed:",
                    error
                );
            }
        }

        return routeDetail;
    }

    async function navigate(destination, options) {
        const settings = options || {};
        let path = destination;

        if (
            destination &&
            typeof destination === "object"
        ) {
            path = buildPath(
                destination.name,
                destination.params,
                destination.query
            );
        } else if (
            typeof destination === "string" &&
            Router.routes.has(destination)
        ) {
            path = buildPath(destination);
        }

        const splitPath = splitPathAndQuery(path);
        const fullPath =
            splitPath.pathname +
            (splitPath.queryString
                ? "?" + splitPath.queryString
                : "");

        const currentPath = getPathFromLocation();
        const samePath =
            splitPathAndQuery(currentPath).pathname ===
                splitPath.pathname &&
            window.location.hash === buildHash(fullPath);

        if (!settings.skipHistory && !samePath) {
            const method = settings.replace
                ? "replaceState"
                : "pushState";

            window.history[method](
                {
                    path: fullPath
                },
                "",
                buildHash(fullPath)
            );
        }

        return resolve(fullPath, settings);
    }

    function replace(destination, options) {
        return navigate(
            destination,
            Object.assign({}, options, {
                replace: true
            })
        );
    }

    function back(fallbackPath) {
        if (window.history.length > 1) {
            window.history.back();
            return;
        }

        navigate(fallbackPath || "/");
    }

    function reload() {
        const path =
            Router.currentRoute &&
            Router.currentRoute.fullPath
                ? Router.currentRoute.fullPath
                : getPathFromLocation();

        return resolve(path, {
            preserveScroll: true
        });
    }

    /* ======================================================
       AUTHENTICATION REDIRECT
    ====================================================== */

    function handleAuthStateChange(event) {
        const user =
            event &&
            event.detail
                ? event.detail.user
                : null;

        if (user && Router.pendingRoute) {
            const pendingRoute = Router.pendingRoute;
            Router.pendingRoute = null;

            navigate(pendingRoute, {
                replace: true
            });

            return;
        }

        if (
            !user &&
            Router.currentRoute &&
            Router.currentRoute.route.requiresAuth
        ) {
            navigate("/", {
                replace: true
            });
        }
    }

    /* ======================================================
       LINK INTERCEPTION
    ====================================================== */

    function shouldIgnoreLink(link, event) {
        if (!link) {
            return true;
        }

        if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
        ) {
            return true;
        }

        if (
            link.hasAttribute("download") ||
            link.target === "_blank" ||
            link.dataset.routerIgnore !== undefined
        ) {
            return true;
        }

        const href = link.getAttribute("href");

        if (
            !href ||
            href.startsWith("mailto:") ||
            href.startsWith("tel:") ||
            href.startsWith("javascript:")
        ) {
            return true;
        }

        if (
            href.startsWith("http://") ||
            href.startsWith("https://")
        ) {
            try {
                const url = new URL(href);

                if (url.origin !== window.location.origin) {
                    return true;
                }
            } catch (error) {
                return true;
            }
        }

        return false;
    }

    function getLinkDestination(link) {
        if (link.dataset.routeName) {
            const params = {};

            Object.keys(link.dataset).forEach(function (key) {
                if (key.startsWith("param")) {
                    const parameterName =
                        key.charAt(5).toLowerCase() +
                        key.slice(6);

                    params[parameterName] =
                        link.dataset[key];
                }
            });

            return {
                name: link.dataset.routeName,
                params: params
            };
        }

        if (link.dataset.route) {
            const routeValue = link.dataset.route;

            if (Router.routes.has(routeValue)) {
                return {
                    name: routeValue
                };
            }

            return normalizePath(routeValue);
        }

        const href = link.getAttribute("href");

        if (href.startsWith("#")) {
            return normalizePath(
                href.replace(/^#\/?/, "/")
            );
        }

        try {
            const url = new URL(
                href,
                window.location.href
            );

            return normalizePath(url.pathname);
        } catch (error) {
            return null;
        }
    }

    function handleDocumentClick(event) {
        const link = event.target.closest(
            "a[data-route], a[data-route-name], a[href^='#/']"
        );

        if (shouldIgnoreLink(link, event)) {
            return;
        }

        const destination = getLinkDestination(link);

        if (!destination) {
            return;
        }

        event.preventDefault();
        navigate(destination);
    }

    /* ======================================================
       BROWSER EVENTS
    ====================================================== */

    function handleLocationChange() {
        resolve(getPathFromLocation(), {
            skipHistory: true
        });
    }

    function bindEvents() {
        document.addEventListener(
            "click",
            handleDocumentClick
        );

        window.addEventListener(
            "popstate",
            handleLocationChange
        );

        window.addEventListener(
            "hashchange",
            handleLocationChange
        );

        document.addEventListener(
            "app:authchange",
            handleAuthStateChange
        );

        document.addEventListener(
            "click",
            function (event) {
                const accountControl = event.target.closest(
                    "[data-account-route]"
                );

                if (accountControl) {
                    event.preventDefault();

                    navigate(
                        "/account/" +
                        accountControl.dataset.accountRoute
                    );
                    return;
                }

                const adminControl = event.target.closest(
                    "[data-admin-route]"
                );

                if (adminControl) {
                    event.preventDefault();

                    const adminSection =
                        adminControl.dataset.adminRoute;

                    navigate(
                        adminSection === "dashboard"
                            ? "/admin"
                            : "/admin/" + adminSection
                    );
                }
            }
        );
    }

    /* ======================================================
       INITIALIZATION
    ====================================================== */

    function initialize() {
        if (Router.initialized) {
            return;
        }

        registerRoutes(defaultRoutes);
        bindEvents();

        Router.initialized = true;

        resolve(getPathFromLocation(), {
            skipHistory: true
        });

        document.dispatchEvent(
            new CustomEvent("router:ready", {
                detail: {
                    router: Router
                }
            })
        );

        console.info(
            "[Router] L'ÉTERNEL SPA router initialized."
        );
    }

    /* ======================================================
       PUBLIC API
    ====================================================== */

    Router.init = initialize;
    Router.register = registerRoute;
    Router.registerMany = registerRoutes;

    Router.navigate = navigate;
    Router.replace = replace;
    Router.resolve = resolve;
    Router.reload = reload;
    Router.back = back;

    Router.buildPath = buildPath;
    Router.match = matchRoute;
    Router.getRoute = findRouteByName;
    Router.getCurrentPath = getPathFromLocation;
    Router.scrollTo = scrollToElement;

    Router.isAdmin = isAdmin;
    Router.getUserRole = getUserRole;

    window.LEternelRouter = Router;

    /*
     * Override the basic navigation method from app.js so all subsequent
     * application modules use the structured router.
     */
    app.navigate = navigate;

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

