"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ADMIN ROUTER

   Responsibilities:
   - Detect active administrator route
   - Normalize admin paths
   - Resolve route metadata
   - Highlight active navigation
   - Expose route permissions
   - Support SPA-like administrative navigation helpers
========================================================== */

(function (global) {
    /* ======================================================
       CONSTANTS
    ====================================================== */

    const ADMIN_BASE_PATH =
        "/admin/";

    const ROUTES =
        Object.freeze({
            dashboard:
                Object.freeze({
                    id:
                        "dashboard",

                    label:
                        "Dashboard",

                    path:
                        "/admin/",

                    aliases: [
                        "/admin",
                        "/admin/",
                        "/admin/index.html"
                    ],

                    permission:
                        "dashboard.read"
                }),

            products:
                Object.freeze({
                    id:
                        "products",

                    label:
                        "Products",

                    path:
                        "/admin/products.html",

                    aliases: [
                        "/admin/products",
                        "/admin/products/",
                        "/admin/products.html"
                    ],

                    permission:
                        "products.read"
                }),

            orders:
                Object.freeze({
                    id:
                        "orders",

                    label:
                        "Orders",

                    path:
                        "/admin/orders.html",

                    aliases: [
                        "/admin/orders",
                        "/admin/orders/",
                        "/admin/orders.html"
                    ],

                    permission:
                        "orders.read"
                }),

            customers:
                Object.freeze({
                    id:
                        "customers",

                    label:
                        "Customers",

                    path:
                        "/admin/customers.html",

                    aliases: [
                        "/admin/customers",
                        "/admin/customers/",
                        "/admin/customers.html"
                    ],

                    permission:
                        "customers.read"
                }),

            inventory:
                Object.freeze({
                    id:
                        "inventory",

                    label:
                        "Inventory",

                    path:
                        "/admin/inventory.html",

                    aliases: [
                        "/admin/inventory",
                        "/admin/inventory/",
                        "/admin/inventory.html"
                    ],

                    permission:
                        "inventory.read"
                }),

            operations:
                Object.freeze({
                    id:
                        "operations",

                    label:
                        "Operations",

                    path:
                        "/admin/operations.html",

                    aliases: [
                        "/admin/operations",
                        "/admin/operations/",
                        "/admin/operations.html"
                    ],

                    permission:
                        "operations.read"
                }),

            administrators:
                Object.freeze({
                    id:
                        "administrators",

                    label:
                        "Administrators",

                    path:
                        "/admin/administrators.html",

                    aliases: [
                        "/admin/administrators",
                        "/admin/administrators/",
                        "/admin/administrators.html"
                    ],

                    permission:
                        "admins.read"
                })
        });

    const ROUTE_IDS =
        Object.freeze(
            Object.keys(
                ROUTES
            )
        );

    const ROUTE_LIST =
        Object.freeze(
            ROUTE_IDS.map(
                function (
                    id
                ) {
                    return ROUTES[
                        id
                    ];
                }
            )
        );

    const DEFAULT_SELECTORS =
        Object.freeze({
            shell:
                "[data-admin-shell]",

            navigation:
                "[data-admin-nav]",

            routeLink:
                "[data-admin-route]"
        });

    /* ======================================================
       ERROR
    ====================================================== */

    class AdminRouterError extends Error {
        constructor(
            code,
            message,
            options
        ) {
            super(
                message ||
                "Administrator routing failed."
            );

            this.name =
                "AdminRouterError";

            this.code =
                code ||
                "admin-router/unknown";

            const settings =
                options ||
                {};

            this.details =
                settings.details ||
                null;

            this.originalError =
                settings.originalError ||
                null;
        }
    }

    /* ======================================================
       ROUTER FACTORY
    ====================================================== */

    function createAdminRouter(
        options
    ) {
        const settings =
            normalizeOptions(
                options
            );

        const state = {
            initialized:
                false,

            activeRoute:
                null,

            activeRouteId:
                null,

            currentPath:
                null
        };

        /* ==================================================
           INITIALIZE
        ================================================== */

        function initialize() {
            if (
                state.initialized
            ) {
                return api;
            }

            refresh();

            state.initialized =
                true;

            return api;
        }

        /* ==================================================
           REFRESH
        ================================================== */

        function refresh(
            path
        ) {
            const currentPath =
                normalizePath(
                    path ||
                    getCurrentPath()
                );

            const route =
                resolveRoute(
                    currentPath
                );

            state.currentPath =
                currentPath;

            state.activeRoute =
                route;

            state.activeRouteId =
                route
                    ? route.id
                    : null;

            applyActiveNavigation(
                route
            );

            applyShellRoute(
                route
            );

            return route;
        }

        /* ==================================================
           ROUTE RESOLUTION
        ================================================== */

        function getRoute(
            routeId
        ) {
            const normalized =
                normalizeRouteId(
                    routeId
                );

            return normalized &&
                ROUTES[
                    normalized
                ]
                ? ROUTES[
                      normalized
                  ]
                : null;
        }

        function resolveRoute(
            path
        ) {
            const normalizedPath =
                normalizePath(
                    path
                );

            for (
                const route of
                ROUTE_LIST
            ) {
                if (
                    route.aliases.some(
                        function (
                            alias
                        ) {
                            return normalizePath(
                                alias
                            ) ===
                                normalizedPath;
                        }
                    )
                ) {
                    return route;
                }
            }

            return null;
        }

        function resolveRouteId(
            path
        ) {
            const route =
                resolveRoute(
                    path
                );

            return route
                ? route.id
                : null;
        }

        /* ==================================================
           CURRENT ROUTE
        ================================================== */

        function getCurrentRoute() {
            if (
                state.activeRoute
            ) {
                return state.activeRoute;
            }

            return refresh();
        }

        function getCurrentRouteId() {
            const route =
                getCurrentRoute();

            return route
                ? route.id
                : null;
        }

        function getCurrentPermission() {
            const route =
                getCurrentRoute();

            return route
                ? route.permission
                : null;
        }

        /* ==================================================
           ROUTE PERMISSIONS
        ================================================== */

        function getRoutePermission(
            routeOrId
        ) {
            if (
                !routeOrId
            ) {
                return null;
            }

            if (
                typeof routeOrId ===
                "object"
            ) {
                return routeOrId.permission ||
                    null;
            }

            const route =
                getRoute(
                    routeOrId
                ) ||
                resolveRoute(
                    routeOrId
                );

            return route
                ? route.permission
                : null;
        }

        function routeRequiresPermission(
            routeOrId
        ) {
            return Boolean(
                getRoutePermission(
                    routeOrId
                )
            );
        }

        /* ==================================================
           NAVIGATION
        ================================================== */

        function navigate(
            routeOrPath,
            options
        ) {
            const navigationOptions =
                options ||
                {};

            let path =
                null;

            const route =
                getRoute(
                    routeOrPath
                );

            if (
                route
            ) {
                path =
                    route.path;
            } else if (
                typeof routeOrPath ===
                "string"
            ) {
                path =
                    normalizePath(
                        routeOrPath
                    );
            }

            if (
                !path
            ) {
                throw new AdminRouterError(
                    "admin-router/invalid-route",
                    "Administrator route is invalid."
                );
            }

            if (
                !global.location
            ) {
                return path;
            }

            if (
                navigationOptions.replace ===
                true &&
                typeof global.location.replace ===
                    "function"
            ) {
                global.location.replace(
                    path
                );

                return path;
            }

            if (
                navigationOptions.assign ===
                true &&
                typeof global.location.assign ===
                    "function"
            ) {
                global.location.assign(
                    path
                );

                return path;
            }

            global.location.href =
                path;

            return path;
        }

        function navigateToDashboard(
            options
        ) {
            return navigate(
                "dashboard",
                options
            );
        }

        /* ==================================================
           ACTIVE NAVIGATION
        ================================================== */

        function applyActiveNavigation(
            route
        ) {
            if (
                !global.document
            ) {
                return;
            }

            const selector =
                settings.selectors
                    .routeLink;

            const links =
                global.document
                    .querySelectorAll(
                        selector
                    );

            for (
                const link of
                links
            ) {
                const routeId =
                    normalizeRouteId(
                        link.dataset
                            .adminRoute
                    );

                const isActive =
                    Boolean(
                        route &&
                        route.id ===
                            routeId
                    );

                link.classList.toggle(
                    "is-active",
                    isActive
                );

                if (
                    isActive
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

        function applyShellRoute(
            route
        ) {
            if (
                !global.document
            ) {
                return;
            }

            const shell =
                global.document
                    .querySelector(
                        settings.selectors
                            .shell
                    );

            if (
                !shell
            ) {
                return;
            }

            if (
                route
            ) {
                shell.dataset
                    .activeAdminRoute =
                    route.id;
            } else {
                delete shell.dataset
                    .activeAdminRoute;
            }
        }

        /* ==================================================
           ROUTE CHECKS
        ================================================== */

        function isRoute(
            routeId
        ) {
            const current =
                getCurrentRouteId();

            return current ===
                normalizeRouteId(
                    routeId
                );
        }

        function isAdminPath(
            path
        ) {
            const normalized =
                normalizePath(
                    path ||
                    getCurrentPath()
                );

            return (
                normalized ===
                    "/admin" ||
                normalized.startsWith(
                    ADMIN_BASE_PATH
                )
            );
        }

        /* ==================================================
           PUBLIC API
        ================================================== */

        const api =
            Object.freeze({
                initialize,
                refresh,

                getRoute,
                resolveRoute,
                resolveRouteId,

                getCurrentRoute,
                getCurrentRouteId,
                getCurrentPermission,

                getRoutePermission,
                routeRequiresPermission,

                navigate,
                navigateToDashboard,

                applyActiveNavigation,
                applyShellRoute,

                isRoute,
                isAdminPath,

                state,
                options:
                    settings
            });

        return api;
    }

    /* ======================================================
       NORMALIZATION
    ====================================================== */

    function normalizeOptions(
        options
    ) {
        const source =
            options ||
            {};

        return Object.freeze({
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

    function normalizeRouteId(
        value
    ) {
        const normalized =
            String(
                value ||
                ""
            )
                .trim()
                .toLowerCase();

        return normalized ||
            null;
    }

    function normalizePath(
        value
    ) {
        let path =
            String(
                value ||
                "/"
            ).trim();

        if (
            !path
        ) {
            path =
                "/";
        }

        try {
            if (
                /^https?:\/\//i.test(
                    path
                )
            ) {
                const url =
                    new URL(
                        path
                    );

                path =
                    url.pathname;
            }
        } catch (
            error
        ) {
            /* Ignore invalid absolute URL and use raw path. */
        }

        path =
            path.split(
                "?"
            )[0]
                .split(
                    "#"
                )[0];

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
                /\/{2,}/g,
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
       LOCATION
    ====================================================== */

    function getCurrentPath() {
        if (
            !global.location
        ) {
            return "/";
        }

        return global.location.pathname ||
            "/";
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
        defaultRouter =
            null;
    }

    function bootstrap(
        options
    ) {
        const router =
            getAdminRouter(
                options
            );

        router.initialize();

        return router;
    }

    /* ======================================================
       EXPORT
    ====================================================== */

    const api =
        Object.freeze({
            createAdminRouter,
            getAdminRouter,
            resetAdminRouter,
            bootstrap,

            AdminRouterError,

            normalizeOptions,
            normalizeRouteId,
            normalizePath,
            getCurrentPath,

            getRoute(
                routeId
            ) {
                const id =
                    normalizeRouteId(
                        routeId
                    );

                return id &&
                    ROUTES[
                        id
                    ]
                    ? ROUTES[
                          id
                      ]
                    : null;
            },

            resolveRoute(
                path
            ) {
                const normalizedPath =
                    normalizePath(
                        path
                    );

                for (
                    const route of
                    ROUTE_LIST
                ) {
                    if (
                        route.aliases.some(
                            function (
                                alias
                            ) {
                                return normalizePath(
                                    alias
                                ) ===
                                    normalizedPath;
                            }
                        )
                    ) {
                        return route;
                    }
                }

                return null;
            },

            constants:
                Object.freeze({
                    ADMIN_BASE_PATH,
                    ROUTES,
                    ROUTE_IDS,
                    ROUTE_LIST,
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