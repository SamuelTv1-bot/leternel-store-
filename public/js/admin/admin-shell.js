"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ADMIN SHELL

   Responsibilities:
   - Initialize admin router
   - Initialize centralized auth guard
   - Populate administrator identity
   - Control mobile sidebar
   - Filter navigation by permissions
   - Resolve and initialize the active page controller
   - Handle sign out
========================================================== */

(function (global) {
    /* ======================================================
       CONSTANTS
    ====================================================== */

    const DEFAULT_SELECTORS =
        Object.freeze({
            shell:
                "[data-admin-shell]",

            sidebar:
                "[data-admin-sidebar]",

            menuToggle:
                "[data-admin-menu-toggle]",

            backdrop:
                "[data-admin-sidebar-backdrop]",

            navigation:
                "[data-admin-nav]",

            routeLinks:
                "[data-admin-route]",

            userName:
                "[data-admin-user-name]",

            userEmail:
                "[data-admin-user-email]",

            avatar:
                "[data-admin-avatar]",

            signout:
                "[data-admin-signout]",

            content:
                "[data-admin-content]",

            date:
                "[data-admin-date]"
        });

    const ROUTE_CONTROLLERS =
        Object.freeze({
            dashboard:
                Object.freeze({
                    globalName:
                        "LEternelDashboardController",

                    bootstrap:
                        "bootstrap"
                }),

            products:
                Object.freeze({
                    globalName:
                        "LEternelProductsController",

                    bootstrap:
                        "bootstrap"
                }),

            orders:
                Object.freeze({
                    globalName:
                        "LEternelOrdersController",

                    bootstrap:
                        "bootstrap"
                }),

            customers:
                Object.freeze({
                    globalName:
                        "LEternelCustomersController",

                    bootstrap:
                        "bootstrap"
                }),

            inventory:
                Object.freeze({
                    globalName:
                        "LEternelInventoryController",

                    bootstrap:
                        "bootstrap"
                }),

            operations:
                Object.freeze({
                    globalName:
                        "LEternelOperationsController",

                    bootstrap:
                        "bootstrap"
                }),

            administrators:
                Object.freeze({
                    globalName:
                        "LEternelAdministratorsController",

                    bootstrap:
                        "bootstrap"
                })
        });

    /* ======================================================
       ERROR
    ====================================================== */

    class AdminShellError extends Error {
        constructor(
            code,
            message,
            options
        ) {
            super(
                message ||
                "Administrator shell initialization failed."
            );

            this.name =
                "AdminShellError";

            this.code =
                code ||
                "admin-shell/unknown";

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
       FACTORY
    ====================================================== */

    function createAdminShell(
        options
    ) {
        const settings =
            normalizeOptions(
                options
            );

        const root =
            settings.root ||
            (
                global.document
                    ? global.document.querySelector(
                          settings.selectors.shell
                      )
                    : null
            );

        if (
            !root
        ) {
            throw new AdminShellError(
                "admin-shell/root-not-found",
                "Administrator shell root element was not found."
            );
        }

        const elements =
            collectElements(
                root,
                settings.selectors
            );

        const state = {
            initialized:
                false,

            destroyed:
                false,

            sidebarOpen:
                false,

            route:
                null,

            router:
                null,

            guard:
                null,

            authorization:
                null,

            pageController:
                null,

            listeners:
                []
        };

        /* ==================================================
           INITIALIZE
        ================================================== */

        async function initialize() {
            if (
                state.initialized
            ) {
                return api;
            }

            bindEvents();

            state.router =
                resolveRouter(
                    settings.router
                );

            if (
                state.router &&
                typeof state.router.initialize ===
                    "function"
            ) {
                state.router.initialize();
            }

            state.route =
                resolveCurrentRoute(
                    state.router
                );

            state.guard =
                resolveAuthGuard(
                    settings.guard
                );

            if (
                !state.guard
            ) {
                throw new AdminShellError(
                    "admin-shell/auth-guard-unavailable",
                    "Administrator authorization guard is unavailable."
                );
            }

            state.authorization =
                await authorizeCurrentPage(
                    state.guard
                );

            renderIdentity(
                state.authorization
            );

            renderDate();

            filterNavigation(
                state.authorization
            );

            state.pageController =
                await initializePageController(
                    state.route
                );

            state.initialized =
                true;

            root.classList.add(
                "is-ready"
            );

            root.dataset.adminReady =
                "true";

            return api;
        }

        /* ==================================================
           DESTROY
        ================================================== */

        function destroy() {
            for (
                const listener of
                state.listeners
            ) {
                listener.element
                    .removeEventListener(
                        listener.event,
                        listener.handler
                    );
            }

            state.listeners =
                [];

            if (
                state.pageController &&
                typeof state.pageController.destroy ===
                    "function"
            ) {
                try {
                    state.pageController.destroy();
                } catch (
                    error
                ) {
                    reportError(
                        error
                    );
                }
            }

            closeSidebar();

            state.destroyed =
                true;

            state.initialized =
                false;
        }

        /* ==================================================
           AUTHORIZATION
        ================================================== */

        async function authorizeCurrentPage(
            guard
        ) {
            try {
                if (
                    typeof guard.guardCurrentPage ===
                    "function"
                ) {
                    return await guard
                        .guardCurrentPage();
                }

                if (
                    typeof guard.authorizeCurrentRoute ===
                    "function"
                ) {
                    return await guard
                        .authorizeCurrentRoute();
                }

                if (
                    typeof guard.requireAdmin ===
                    "function"
                ) {
                    return await guard
                        .requireAdmin();
                }

                throw new AdminShellError(
                    "admin-shell/invalid-auth-guard",
                    "Administrator authorization guard does not expose a supported authorization method."
                );
            } catch (
                error
            ) {
                throw normalizeShellError(
                    error,
                    "admin-shell/authorization-failed",
                    "Administrator authorization failed."
                );
            }
        }

        /* ==================================================
           IDENTITY
        ================================================== */

        function renderIdentity(
            authorization
        ) {
            const source =
                authorization ||
                {};

            const user =
                state.guard &&
                state.guard.state &&
                state.guard.state.user
                    ? state.guard.state.user
                    : null;

            const displayName =
                normalizeOptionalString(
                    source.displayName
                ) ||
                normalizeOptionalString(
                    user &&
                    user.displayName
                ) ||
                "Administrator";

            const email =
                normalizeOptionalString(
                    source.email
                ) ||
                normalizeOptionalString(
                    user &&
                    user.email
                ) ||
                "—";

            setText(
                elements.userName,
                displayName
            );

            setText(
                elements.userEmail,
                email
            );

            setText(
                elements.avatar,
                getInitials(
                    displayName ||
                    email
                )
            );
        }

        /* ==================================================
           NAVIGATION PERMISSIONS
        ================================================== */

        function filterNavigation(
            authorization
        ) {
            if (
                !elements.navigation
            ) {
                return;
            }

            const links =
                elements.navigation
                    .querySelectorAll(
                        settings.selectors.routeLinks
                    );

            for (
                const link of
                links
            ) {
                const routeId =
                    normalizeRoute(
                        link.dataset
                            .adminRoute
                    );

                if (
                    !routeId
                ) {
                    continue;
                }

                const permission =
                    resolveRoutePermission(
                        routeId
                    );

                const allowed =
                    !permission ||
                    canAccessPermission(
                        permission,
                        authorization
                    );

                link.hidden =
                    !allowed;

                link.setAttribute(
                    "aria-hidden",
                    allowed
                        ? "false"
                        : "true"
                );

                if (
                    !allowed
                ) {
                    link.removeAttribute(
                        "aria-current"
                    );

                    link.classList.remove(
                        "is-active"
                    );

                    link.tabIndex =
                        -1;
                } else {
                    link.removeAttribute(
                        "tabindex"
                    );
                }
            }
        }

        function resolveRoutePermission(
            routeId
        ) {
            if (
                state.router &&
                typeof state.router
                    .getRoutePermission ===
                    "function"
            ) {
                const permission =
                    state.router
                        .getRoutePermission(
                            routeId
                        );

                if (
                    permission
                ) {
                    return permission;
                }
            }

            if (
                global.LEternelAdminRouter &&
                typeof global
                    .LEternelAdminRouter
                    .getRoute ===
                    "function"
            ) {
                const route =
                    global
                        .LEternelAdminRouter
                        .getRoute(
                            routeId
                        );

                if (
                    route &&
                    route.permission
                ) {
                    return route.permission;
                }
            }

            return null;
        }

        function canAccessPermission(
            permission,
            authorization
        ) {
            if (
                state.guard &&
                typeof state.guard.can ===
                    "function"
            ) {
                return state.guard.can(
                    permission
                );
            }

            const source =
                authorization ||
                {};

            const permissions =
                normalizeStringList(
                    source.permissions
                );

            return permissions.some(
                function (
                    granted
                ) {
                    return permissionMatches(
                        granted,
                        permission
                    );
                }
            );
        }

        /* ==================================================
           PAGE CONTROLLER
        ================================================== */

        async function initializePageController(
            route
        ) {
            const routeId =
                route &&
                route.id
                    ? route.id
                    : resolveRouteFromRoot();

            if (
                !routeId
            ) {
                return null;
            }

            const descriptor =
                ROUTE_CONTROLLERS[
                    routeId
                ];

            if (
                !descriptor
            ) {
                return null;
            }

            const controllerModule =
                global[
                    descriptor.globalName
                ];

            if (
                !controllerModule
            ) {
                return null;
            }

            const bootstrap =
                controllerModule[
                    descriptor.bootstrap
                ];

            if (
                typeof bootstrap !==
                    "function"
            ) {
                return null;
            }

            try {
                return await bootstrap.call(
                    controllerModule
                );
            } catch (
                error
            ) {
                throw normalizeShellError(
                    error,
                    "admin-shell/controller-failed",
                    "Unable to initialize administrator page controller."
                );
            }
        }

        function resolveRouteFromRoot() {
            const route =
                normalizeRoute(
                    root.dataset
                        .activeAdminRoute
                );

            return route ||
                null;
        }

        /* ==================================================
           SIDEBAR
        ================================================== */

        function openSidebar() {
            state.sidebarOpen =
                true;

            root.classList.add(
                "admin-sidebar-open"
            );

            if (
                elements.sidebar
            ) {
                elements.sidebar.classList.add(
                    "is-open"
                );
            }

            if (
                elements.menuToggle
            ) {
                elements.menuToggle.setAttribute(
                    "aria-expanded",
                    "true"
                );
            }

            if (
                elements.backdrop
            ) {
                elements.backdrop.hidden =
                    false;

                elements.backdrop.setAttribute(
                    "aria-hidden",
                    "false"
                );
            }
        }

        function closeSidebar() {
            state.sidebarOpen =
                false;

            root.classList.remove(
                "admin-sidebar-open"
            );

            if (
                elements.sidebar
            ) {
                elements.sidebar.classList.remove(
                    "is-open"
                );
            }

            if (
                elements.menuToggle
            ) {
                elements.menuToggle.setAttribute(
                    "aria-expanded",
                    "false"
                );
            }

            if (
                elements.backdrop
            ) {
                elements.backdrop.hidden =
                    true;

                elements.backdrop.setAttribute(
                    "aria-hidden",
                    "true"
                );
            }
        }

        function toggleSidebar() {
            if (
                state.sidebarOpen
            ) {
                closeSidebar();
            } else {
                openSidebar();
            }
        }

        /* ==================================================
           SIGN OUT
        ================================================== */

        async function signOut() {
            const auth =
                resolveFirebaseAuth();

            if (
                !auth ||
                typeof auth.signOut !==
                    "function"
            ) {
                throw new AdminShellError(
                    "admin-shell/auth-unavailable",
                    "Firebase Authentication is unavailable."
                );
            }

            try {
                await auth.signOut();

                if (
                    state.guard &&
                    typeof state.guard.redirectToLogin ===
                        "function"
                ) {
                    state.guard
                        .redirectToLogin();

                    return;
                }

                if (
                    global.location
                ) {
                    global.location.href =
                        "/";
                }
            } catch (
                error
            ) {
                throw normalizeShellError(
                    error,
                    "admin-shell/signout-failed",
                    "Unable to sign out."
                );
            }
        }

        /* ==================================================
           DATE
        ================================================== */

        function renderDate() {
            if (
                !elements.date
            ) {
                return;
            }

            try {
                elements.date.textContent =
                    new Intl.DateTimeFormat(
                        undefined,
                        {
                            weekday:
                                "long",

                            year:
                                "numeric",

                            month:
                                "long",

                            day:
                                "numeric"
                        }
                    ).format(
                        new Date()
                    );
            } catch (
                error
            ) {
                elements.date.textContent =
                    new Date()
                        .toLocaleDateString();
            }
        }

        /* ==================================================
           EVENTS
        ================================================== */

        function bindEvents() {
            bind(
                elements.menuToggle,
                "click",
                toggleSidebar
            );

            bind(
                elements.backdrop,
                "click",
                closeSidebar
            );

            bind(
                elements.navigation,
                "click",
                function (
                    event
                ) {
                    const link =
                        event.target.closest(
                            "[data-admin-route]"
                        );

                    if (
                        link
                    ) {
                        closeSidebar();
                    }
                }
            );

            bind(
                elements.signout,
                "click",
                function () {
                    signOut()
                        .catch(
                            reportError
                        );
                }
            );

            if (
                global.document
            ) {
                bind(
                    global.document,
                    "keydown",
                    function (
                        event
                    ) {
                        if (
                            event.key ===
                                "Escape" &&
                            state.sidebarOpen
                        ) {
                            closeSidebar();
                        }
                    }
                );
            }

            if (
                global.addEventListener
            ) {
                bind(
                    global,
                    "resize",
                    function () {
                        if (
                            global.innerWidth >
                            1024 &&
                            state.sidebarOpen
                        ) {
                            closeSidebar();
                        }
                    }
                );
            }
        }

        function bind(
            element,
            event,
            handler
        ) {
            if (
                !element ||
                typeof element.addEventListener !==
                    "function"
            ) {
                return;
            }

            element.addEventListener(
                event,
                handler
            );

            state.listeners.push({
                element,
                event,
                handler
            });
        }

        /* ==================================================
           PUBLIC API
        ================================================== */

        const api =
            Object.freeze({
                initialize,
                destroy,

                authorizeCurrentPage,

                renderIdentity,
                filterNavigation,

                initializePageController,

                openSidebar,
                closeSidebar,
                toggleSidebar,

                signOut,
                renderDate,

                state,
                elements,
                options:
                    settings
            });

        return api;
    }

    /* ======================================================
       ROUTER
    ====================================================== */

    function resolveRouter(
        provided
    ) {
        if (
            provided
        ) {
            return provided;
        }

        if (
            !global.LEternelAdminRouter ||
            typeof global
                .LEternelAdminRouter
                .getAdminRouter !==
                "function"
        ) {
            return null;
        }

        return global
            .LEternelAdminRouter
            .getAdminRouter();
    }

    function resolveCurrentRoute(
        router
    ) {
        if (
            router &&
            typeof router.getCurrentRoute ===
                "function"
        ) {
            return router
                .getCurrentRoute();
        }

        return null;
    }

    /* ======================================================
       AUTH GUARD
    ====================================================== */

    function resolveAuthGuard(
        provided
    ) {
        if (
            provided
        ) {
            return provided;
        }

        if (
            !global.LEternelAdminAuthGuard ||
            typeof global
                .LEternelAdminAuthGuard
                .getAdminAuthGuard !==
                "function"
        ) {
            return null;
        }

        return global
            .LEternelAdminAuthGuard
            .getAdminAuthGuard();
    }

    /* ======================================================
       FIREBASE
    ====================================================== */

    function resolveFirebaseAuth() {
        if (
            !global.firebase ||
            typeof global.firebase.auth !==
                "function"
        ) {
            return null;
        }

        try {
            return global.firebase
                .auth();
        } catch (
            error
        ) {
            reportError(
                error
            );

            return null;
        }
    }

    /* ======================================================
       ELEMENT COLLECTION
    ====================================================== */

    function collectElements(
        root,
        selectors
    ) {
        return {
            sidebar:
                root.querySelector(
                    selectors.sidebar
                ),

            menuToggle:
                root.querySelector(
                    selectors.menuToggle
                ),

            backdrop:
                root.querySelector(
                    selectors.backdrop
                ),

            navigation:
                root.querySelector(
                    selectors.navigation
                ),

            userName:
                root.querySelector(
                    selectors.userName
                ),

            userEmail:
                root.querySelector(
                    selectors.userEmail
                ),

            avatar:
                root.querySelector(
                    selectors.avatar
                ),

            signout:
                root.querySelector(
                    selectors.signout
                ),

            content:
                root.querySelector(
                    selectors.content
                ),

            date:
                root.querySelector(
                    selectors.date
                )
        };
    }

    /* ======================================================
       PERMISSION HELPERS
    ====================================================== */

    function permissionMatches(
        granted,
        required
    ) {
        const grant =
            normalizePermission(
                granted
            );

        const need =
            normalizePermission(
                required
            );

        if (
            !grant ||
            !need
        ) {
            return false;
        }

        if (
            grant ===
                "*" ||
            grant ===
                need
        ) {
            return true;
        }

        if (
            grant.endsWith(
                ".*"
            )
        ) {
            return need.startsWith(
                grant.slice(
                    0,
                    -1
                )
            );
        }

        return false;
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
            root:
                source.root ||
                null,

            router:
                source.router ||
                null,

            guard:
                source.guard ||
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

    function normalizeOptionalString(
        value
    ) {
        if (
            value ===
                undefined ||
            value ===
                null
        ) {
            return null;
        }

        const normalized =
            String(
                value
            ).trim();

        return normalized ||
            null;
    }

    function normalizeRoute(
        value
    ) {
        return String(
            value ||
            ""
        )
            .trim()
            .toLowerCase();
    }

    function normalizePermission(
        value
    ) {
        return String(
            value ||
            ""
        )
            .trim()
            .toLowerCase();
    }

    function normalizeStringList(
        value
    ) {
        if (
            value ===
                undefined ||
            value ===
                null ||
            value ===
                ""
        ) {
            return [];
        }

        const values =
            Array.isArray(
                value
            )
                ? value
                : [
                      value
                  ];

        return Array.from(
            new Set(
                values
                    .map(
                        function (
                            item
                        ) {
                            return String(
                                item ||
                                ""
                            )
                                .trim()
                                .toLowerCase();
                        }
                    )
                    .filter(
                        Boolean
                    )
            )
        );
    }

    /* ======================================================
       TEXT
    ====================================================== */

    function setText(
        element,
        value
    ) {
        if (
            !element
        ) {
            return;
        }

        element.textContent =
            value ===
                undefined ||
            value ===
                null
                ? ""
                : String(
                      value
                  );
    }

    function getInitials(
        value
    ) {
        const words =
            String(
                value ||
                "A"
            )
                .trim()
                .split(
                    /\s+/
                )
                .filter(
                    Boolean
                );

        if (
            !words.length
        ) {
            return "A";
        }

        if (
            words.length ===
            1
        ) {
            return words[0]
                .slice(
                    0,
                    2
                )
                .toUpperCase();
        }

        return (
            words[0].charAt(
                0
            ) +
            words[
                words.length -
                1
            ].charAt(
                0
            )
        ).toUpperCase();
    }

    /* ======================================================
       ERRORS
    ====================================================== */

    function normalizeShellError(
        error,
        fallbackCode,
        fallbackMessage
    ) {
        if (
            error instanceof
            AdminShellError
        ) {
            return error;
        }

        return new AdminShellError(
            error &&
            error.code
                ? String(
                      error.code
                  )
                : fallbackCode,
            error &&
            error.message
                ? String(
                      error.message
                  )
                : fallbackMessage,
            {
                details:
                    error &&
                    error.details
                        ? error.details
                        : null,

                originalError:
                    error
            }
        );
    }

    function reportError(
        error
    ) {
        if (
            global.console &&
            typeof global.console.error ===
                "function"
        ) {
            global.console.error(
                "Admin shell error.",
                error
            );
        }
    }

    /* ======================================================
       DEFAULT INSTANCE
    ====================================================== */

    let defaultShell =
        null;

    function getAdminShell(
        options
    ) {
        if (
            options
        ) {
            return createAdminShell(
                options
            );
        }

        if (
            !defaultShell
        ) {
            defaultShell =
                createAdminShell();
        }

        return defaultShell;
    }

    function resetAdminShell() {
        if (
            defaultShell &&
            typeof defaultShell.destroy ===
                "function"
        ) {
            defaultShell.destroy();
        }

        defaultShell =
            null;
    }

    async function bootstrap(
        options
    ) {
        const shell =
            getAdminShell(
                options
            );

        await shell.initialize();

        return shell;
    }

    /* ======================================================
       EXPORT
    ====================================================== */

    const api =
        Object.freeze({
            createAdminShell,
            getAdminShell,
            resetAdminShell,
            bootstrap,

            AdminShellError,

            resolveRouter,
            resolveCurrentRoute,
            resolveAuthGuard,
            resolveFirebaseAuth,

            permissionMatches,

            normalizeOptions,
            normalizeOptionalString,
            normalizeRoute,
            normalizePermission,
            normalizeStringList,

            getInitials,
            normalizeShellError,

            constants:
                Object.freeze({
                    DEFAULT_SELECTORS,
                    ROUTE_CONTROLLERS
                })
        });

    global.LEternelAdminShell =
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