"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ADMIN ROUTER

   Responsibilities:
   - Resolve admin routes
   - Activate the correct navigation item
   - Support direct navigation and SPA-style links
   - Initialize page-specific controllers
========================================================== */

(function (
    global
) {
    /* ======================================================
       ROUTES
    ====================================================== */

    const ROUTES =
        Object.freeze({
            dashboard:
                Object.freeze({
                    key:
                        "dashboard",

                    path:
                        "/admin/",

                    aliases:
                        [
                            "/admin",
                            "/admin/index.html"
                        ],

                    title:
                        "Dashboard"
                }),

            products:
                Object.freeze({
                    key:
                        "products",

                    path:
                        "/admin/products.html",

                    aliases:
                        [],

                    title:
                        "Products"
                }),

            orders:
                Object.freeze({
                    key:
                        "orders",

                    path:
                        "/admin/orders.html",

                    aliases:
                        [],

                    title:
                        "Orders"
                }),

            customers:
                Object.freeze({
                    key:
                        "customers",

                    path:
                        "/admin/customers.html",

                    aliases:
                        [],

                    title:
                        "Customers"
                }),

            inventory:
                Object.freeze({
                    key:
                        "inventory",

                    path:
                        "/admin/inventory.html",

                    aliases:
                        [],

                    title:
                        "Inventory"
                }),

            operations:
                Object.freeze({
                    key:
                        "operations",

                    path:
                        "/admin/operations.html",

                    aliases:
                        [],

                    title:
                        "Operations"
                })
        });

    /* ======================================================
       SELECTORS
    ====================================================== */

    const DEFAULT_SELECTORS =
        Object.freeze({
            navigation:
                "[data-admin-nav]",

            navigationLink:
                "[data-admin-route]",

            content:
                "[data-admin-content]"
        });

    /* ======================================================
       ROUTER FACTORY
    ====================================================== */

    function createAdminRouter(
        options
    ) {
        const settings =
            normalizeRouterOptions(
                options
            );

        const windowObject =
            settings.window ||
            global;

        const documentObject =
            settings.document ||
            windowObject.document;

        if (
            !documentObject
        ) {
            throw new Error(
                "Admin router requires a document."
            );
        }

        let initialized =
            false;

        let destroyed =
            false;

        let activeRoute =
            null;

        const disposers =
            [];

        /* ==================================================
           INITIALIZE
        ================================================== */

        async function init() {
            if (
                initialized
            ) {
                return router;
            }

            assertActive();

            initialized =
                true;

            bindNavigation();

            activeRoute =
                resolveCurrentRoute(
                    windowObject.location
                );

            updateNavigation(
                activeRoute
            );

            updateDocumentTitle(
                documentObject,
                activeRoute
            );

            await initializeRoute(
                activeRoute
            );

            return router;
        }

        /* ==================================================
           DESTROY
        ================================================== */

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

            activeRoute =
                null;
        }

        function assertActive() {
            if (
                destroyed
            ) {
                throw new Error(
                    "Admin router has been destroyed."
                );
            }
        }

        /* ==================================================
           NAVIGATION
        ================================================== */

        function bindNavigation() {
            const links =
                documentObject
                    .querySelectorAll(
                        settings
                            .selectors
                            .navigationLink
                    );

            for (
                const link of
                links
            ) {
                const listener =
                    function (
                        event
                    ) {
                        const routeKey =
                            link.getAttribute(
                                "data-admin-route"
                            );

                        const route =
                            ROUTES[
                                routeKey
                            ];

                        if (
                            !route
                        ) {
                            return;
                        }

                        const href =
                            link.getAttribute(
                                "href"
                            );

                        if (
                            shouldUseNativeNavigation(
                                event,
                                link,
                                href
                            )
                        ) {
                            return;
                        }

                        event.preventDefault();

                        navigate(
                            route.key
                        ).catch(
                            reportError
                        );
                    };

                link.addEventListener(
                    "click",
                    listener
                );

                disposers.push(
                    function () {
                        link.removeEventListener(
                            "click",
                            listener
                        );
                    }
                );
            }

            const popstateListener =
                function () {
                    handleLocationChange()
                        .catch(
                            reportError
                        );
                };

            windowObject
                .addEventListener(
                    "popstate",
                    popstateListener
                );

            disposers.push(
                function () {
                    windowObject
                        .removeEventListener(
                            "popstate",
                            popstateListener
                        );
                }
            );
        }

        /* ==================================================
           NAVIGATE
        ================================================== */

        async function navigate(
            routeKey,
            options
        ) {
            assertActive();

            const route =
                resolveRouteByKey(
                    routeKey
                );

            const navOptions =
                options ||
                {};

            if (
                navOptions.fullReload ===
                true
            ) {
                windowObject.location.href =
                    route.path;

                return route;
            }

            const currentPath =
                normalizePath(
                    windowObject
                        .location
                        .pathname
                );

            const targetPath =
                normalizePath(
                    route.path
                );

            if (
                currentPath !==
                targetPath
            ) {
                if (
                    navOptions.replace ===
                    true
                ) {
                    windowObject
                        .history
                        .replaceState(
                            {
                                route:
                                    route.key
                            },
                            "",
                            route.path
                        );
                } else {
                    windowObject
                        .history
                        .pushState(
                            {
                                route:
                                    route.key
                            },
                            "",
                            route.path
                        );
                }
            }

            await handleLocationChange();

            return route;
        }

        /* ==================================================
           LOCATION CHANGE
        ================================================== */

        async function handleLocationChange() {
            const route =
                resolveCurrentRoute(
                    windowObject.location
                );

            if (
                activeRoute &&
                activeRoute.key ===
                    route.key
            ) {
                updateNavigation(
                    route
                );

                updateDocumentTitle(
                    documentObject,
                    route
                );

                return route;
            }

            activeRoute =
                route;

            updateNavigation(
                route
            );

            updateDocumentTitle(
                documentObject,
                route
            );

            await initializeRoute(
                route
            );

            return route;
        }

        /* ==================================================
           NAV ACTIVE STATE
        ================================================== */

        function updateNavigation(
            route
        ) {
            const links =
                documentObject
                    .querySelectorAll(
                        settings
                            .selectors
                            .navigationLink
                    );

            for (
                const link of
                links
            ) {
                const routeKey =
                    link.getAttribute(
                        "data-admin-route"
                    );

                const active =
                    Boolean(
                        route &&
                        route.key ===
                            routeKey
                    );

                link.classList.toggle(
                    "is-active",
                    active
                );

                if (
                    active
                ) {
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
        }

        /* ==================================================
           ROUTE INITIALIZATION
        ================================================== */

        async function initializeRoute(
            route
        ) {
            if (
                !route
            ) {
                return;
            }

            switch (
                route.key
            ) {
                case "operations":
                    await initializeOperationsRoute();
                    break;

                default:
                    initializeGenericRoute(
                        route
                    );
                    break;
            }
        }

        async function initializeOperationsRoute() {
            if (
                !documentObject
                    .querySelector(
                        "[data-admin-operations]"
                    )
            ) {
                return;
            }

            if (
                !global
                    .LEternelOperationsController
            ) {
                return;
            }

            const controller =
                global
                    .LEternelOperationsController
                    .getOperationsController();

            await controller.init();

            global
                .LEternelOperationsAdmin =
                controller;
        }

        function initializeGenericRoute(
            route
        ) {
            const content =
                documentObject
                    .querySelector(
                        settings
                            .selectors
                            .content
                    );

            if (
                content
            ) {
                content.setAttribute(
                    "data-active-admin-route",
                    route.key
                );
            }
        }

        /* ==================================================
           SNAPSHOT
        ================================================== */

        function getSnapshot() {
            return {
                initialized:
                    initialized,

                destroyed:
                    destroyed,

                activeRoute:
                    activeRoute
                        ? Object.assign(
                              {},
                              activeRoute
                          )
                        : null
            };
        }

        /* ==================================================
           ROUTER
        ================================================== */

        const router =
            Object.freeze({
                init,
                destroy,
                navigate,
                handleLocationChange,
                updateNavigation,
                initializeRoute,
                getSnapshot,

                get activeRoute() {
                    return activeRoute;
                },

                routes:
                    ROUTES,

                options:
                    settings
            });

        return router;
    }

    /* ======================================================
       ROUTE RESOLUTION
    ====================================================== */

    function resolveCurrentRoute(
        locationObject
    ) {
        const pathname =
            normalizePath(
                locationObject &&
                locationObject.pathname
            );

        const routes =
            Object.values(
                ROUTES
            );

        for (
            const route of
            routes
        ) {
            if (
                normalizePath(
                    route.path
                ) ===
                pathname
            ) {
                return route;
            }

            for (
                const alias of
                route.aliases
            ) {
                if (
                    normalizePath(
                        alias
                    ) ===
                    pathname
                ) {
                    return route;
                }
            }
        }

        return ROUTES.dashboard;
    }

    function resolveRouteByKey(
        routeKey
    ) {
        const key =
            String(
                routeKey ||
                ""
            ).trim();

        const route =
            ROUTES[
                key
            ];

        if (
            !route
        ) {
            throw new Error(
                "Unknown admin route: " +
                key
            );
        }

        return route;
    }

    function normalizePath(
        value
    ) {
        let path =
            String(
                value ||
                "/"
            )
                .trim()
                .split("?")[0]
                .split("#")[0];

        if (
            !path.startsWith(
                "/"
            )
        ) {
            path =
                "/" +
                path;
        }

        path =
            path.replace(
                /\/+/g,
                "/"
            );

        if (
            path.length >
                1 &&
            path.endsWith(
                "/"
            )
        ) {
            path =
                path.slice(
                    0,
                    -1
                );
        }

        return path;
    }

    /* ======================================================
       DOCUMENT TITLE
    ====================================================== */

    function updateDocumentTitle(
        documentObject,
        route
    ) {
        if (
            !documentObject ||
            !route
        ) {
            return;
        }

        documentObject.title =
            "L'ÉTERNEL Admin · " +
            route.title;
    }

    /* ======================================================
       NATIVE NAVIGATION
    ====================================================== */

    function shouldUseNativeNavigation(
        event,
        link,
        href
    ) {
        if (
            !event ||
            !link
        ) {
            return true;
        }

        if (
            event.defaultPrevented
        ) {
            return true;
        }

        if (
            event.button !==
                undefined &&
            event.button !==
                0
        ) {
            return true;
        }

        if (
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
        ) {
            return true;
        }

        if (
            link.target &&
            link.target !==
                "_self"
        ) {
            return true;
        }

        if (
            link.hasAttribute(
                "download"
            )
        ) {
            return true;
        }

        if (
            !href ||
            href.startsWith(
                "#"
            )
        ) {
            return true;
        }

        return false;
    }

    /* ======================================================
       OPTIONS
    ====================================================== */

    function normalizeRouterOptions(
        options
    ) {
        const source =
            options ||
            {};

        return Object.freeze({
            window:
                source.window ||
                null,

            document:
                source.document ||
                null,

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

    /* ======================================================
       ERROR REPORTING
    ====================================================== */

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
                "Admin router error.",
                error
            );
        }
    }

    /* ======================================================
       DEFAULT INSTANCE
    ====================================================== */

    let defaultRouter =
        null;

    function getAdminRouter(
        options
    ) {
        if (
            options
        ) {
            return createAdminRouter(
                options
            );
        }

        if (
            !defaultRouter
        ) {
            defaultRouter =
                createAdminRouter();
        }

        return defaultRouter;
    }

    function resetAdminRouter() {
        if (
            defaultRouter
        ) {
            defaultRouter.destroy();
        }

        defaultRouter =
            null;
    }

    /* ======================================================
       EXPORT
    ====================================================== */

    const api =
        Object.freeze({
            createAdminRouter,
            getAdminRouter,
            resetAdminRouter,

            resolveCurrentRoute,
            resolveRouteByKey,
            normalizePath,
            updateDocumentTitle,
            shouldUseNativeNavigation,
            normalizeRouterOptions,

            constants:
                Object.freeze({
                    ROUTES,
                    DEFAULT_SELECTORS
                })
        });

    global.LEternelAdminRouter =
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