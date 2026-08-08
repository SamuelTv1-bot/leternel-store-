"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ADMIN SHELL

   Responsibilities:
   - Manage responsive admin sidebar state
   - Populate administrator identity
   - Guard admin pages with Firebase Authentication
   - Verify administrator claims
   - Handle sign-out
   - Initialize the shared admin router
   - Initialize page-specific controllers
========================================================== */

(function (
    global
) {
    /* ======================================================
       CONSTANTS
    ====================================================== */

    const DEFAULT_SELECTORS =
        Object.freeze({
            shell:
                "[data-admin-shell], .admin-shell",

            sidebar:
                "[data-admin-sidebar], .admin-sidebar",

            menuToggle:
                "[data-admin-menu-toggle]",

            overlay:
                "[data-admin-overlay], [data-admin-sidebar-backdrop]",

            navigation:
                "[data-admin-nav]",

            navigationLinks:
                "[data-admin-nav] a",

            userName:
                "[data-admin-user-name]",

            userEmail:
                "[data-admin-user-email]",

            userAvatar:
                "[data-admin-avatar]",

            signOutButton:
                "[data-admin-signout]",

            content:
                "[data-admin-content]",

            currentDate:
                "[data-admin-current-date]"
        });

    const DEFAULT_LOGIN_PATH =
        "/";

    const DEFAULT_UNAUTHORIZED_PATH =
        "/";

    const ADMIN_ROLE_NAMES =
        Object.freeze([
            "admin",
            "administrator",
            "owner",
            "super-admin"
        ]);

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
                "Admin shell operation failed."
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

        const documentObject =
            settings.document ||
            global.document;

        const windowObject =
            settings.window ||
            global;

        if (
            !documentObject
        ) {
            throw new AdminShellError(
                "admin-shell/document-unavailable",
                "Admin shell requires a document."
            );
        }

        const elements =
            resolveElements(
                documentObject,
                settings.selectors
            );

        const auth =
            settings.auth ||
            resolveAuth();

        const disposers =
            [];

        let initialized =
            false;

        let destroyed =
            false;

        let sidebarOpen =
            false;

        let authenticatedUser =
            null;

        let administratorClaims =
            null;

        let activeController =
            null;

        let authResolved =
            false;

        /* ==================================================
           LIFECYCLE
        ================================================== */

        async function init() {
            if (
                initialized
            ) {
                return shell;
            }

            assertActive();

            initialized =
                true;

            bindEvents();

            setCurrentDate();

            await initializeRouter();

            if (
                settings.requireAuthentication
            ) {
                await waitForAuthentication();
            } else {
                populateIdentity(
                    auth &&
                    auth.currentUser
                        ? auth.currentUser
                        : null
                );
            }

            await initializePageController();

            return shell;
        }

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

            if (
                activeController &&
                typeof activeController.destroy ===
                    "function"
            ) {
                try {
                    activeController.destroy();
                } catch (
                    error
                ) {
                    reportError(
                        error
                    );
                }
            }

            activeController =
                null;

            closeSidebar();

            initialized =
                false;
        }

        function assertActive() {
            if (
                destroyed
            ) {
                throw new AdminShellError(
                    "admin-shell/destroyed",
                    "Admin shell has been destroyed."
                );
            }
        }

        /* ==================================================
           AUTHENTICATION
        ================================================== */

        function waitForAuthentication() {
            if (
                !auth ||
                typeof auth.onAuthStateChanged !==
                    "function"
            ) {
                throw new AdminShellError(
                    "admin-shell/auth-unavailable",
                    "Firebase Authentication is unavailable."
                );
            }

            return new Promise(
                function (
                    resolve,
                    reject
                ) {
                    let settled =
                        false;

                    const timeout =
                        windowObject.setTimeout(
                            function () {
                                if (
                                    settled
                                ) {
                                    return;
                                }

                                settled =
                                    true;

                                reject(
                                    new AdminShellError(
                                        "admin-shell/auth-timeout",
                                        "Authentication verification timed out."
                                    )
                                );
                            },
                            settings.authenticationTimeoutMs
                        );

                    const unsubscribe =
                        auth.onAuthStateChanged(
                            async function (
                                user
                            ) {
                                if (
                                    settled
                                ) {
                                    return;
                                }

                                try {
                                    authenticatedUser =
                                        user ||
                                        null;

                                    populateIdentity(
                                        authenticatedUser
                                    );

                                    if (
                                        !authenticatedUser
                                    ) {
                                        settled =
                                            true;

                                        windowObject.clearTimeout(
                                            timeout
                                        );

                                        redirectToLogin();

                                        resolve(
                                            null
                                        );

                                        return;
                                    }

                                    administratorClaims =
                                        await loadClaims(
                                            authenticatedUser
                                        );

                                    if (
                                        settings.requireAdministrator &&
                                        !isAdministrator(
                                            administratorClaims,
                                            authenticatedUser
                                        )
                                    ) {
                                        settled =
                                            true;

                                        windowObject.clearTimeout(
                                            timeout
                                        );

                                        redirectUnauthorized();

                                        resolve(
                                            null
                                        );

                                        return;
                                    }

                                    authResolved =
                                        true;

                                    settled =
                                        true;

                                    windowObject.clearTimeout(
                                        timeout
                                    );

                                    resolve(
                                        authenticatedUser
                                    );
                                } catch (
                                    error
                                ) {
                                    settled =
                                        true;

                                    windowObject.clearTimeout(
                                        timeout
                                    );

                                    reject(
                                        normalizeAdminShellError(
                                            error,
                                            "admin-shell/auth-verification-failed",
                                            "Unable to verify administrator access."
                                        )
                                    );
                                }
                            },
                            function (
                                error
                            ) {
                                if (
                                    settled
                                ) {
                                    return;
                                }

                                settled =
                                    true;

                                windowObject.clearTimeout(
                                    timeout
                                );

                                reject(
                                    normalizeAdminShellError(
                                        error,
                                        "admin-shell/auth-listener-failed",
                                        "Authentication listener failed."
                                    )
                                );
                            }
                        );

                    disposers.push(
                        function () {
                            if (
                                typeof unsubscribe ===
                                "function"
                            ) {
                                unsubscribe();
                            }
                        }
                    );
                }
            );
        }

        async function loadClaims(
            user
        ) {
            if (
                !user ||
                typeof user.getIdTokenResult !==
                    "function"
            ) {
                return {};
            }

            const result =
                await user.getIdTokenResult(
                    settings.forceTokenRefresh
                );

            return result &&
                result.claims
                    ? cloneValue(
                          result.claims
                      )
                    : {};
        }

        function isAdministrator(
            claims,
            user
        ) {
            const source =
                claims ||
                {};

            if (
                source.admin ===
                    true ||
                source.isAdmin ===
                    true ||
                source.superAdmin ===
                    true
            ) {
                return true;
            }

            const role =
                String(
                    source.role ||
                    source.userRole ||
                    ""
                )
                    .trim()
                    .toLowerCase();

            if (
                ADMIN_ROLE_NAMES.includes(
                    role
                )
            ) {
                return true;
            }

            const roles =
                Array.isArray(
                    source.roles
                )
                    ? source.roles.map(
                          function (
                              item
                          ) {
                              return String(
                                  item
                              )
                                  .trim()
                                  .toLowerCase();
                          }
                      )
                    : [];

            if (
                roles.some(
                    function (
                        item
                    ) {
                        return ADMIN_ROLE_NAMES.includes(
                            item
                        );
                    }
                )
            ) {
                return true;
            }

            if (
                settings.allowedAdminEmails.length &&
                user &&
                user.email
            ) {
                return settings.allowedAdminEmails.includes(
                    String(
                        user.email
                    )
                        .trim()
                        .toLowerCase()
                );
            }

            return settings.allowAuthenticatedFallback;
        }

        function redirectToLogin() {
            const currentPath =
                windowObject.location
                    ? windowObject.location.pathname +
                      windowObject.location.search
                    : "/admin/";

            const destination =
                appendQueryParameter(
                    settings.loginPath,
                    "redirect",
                    currentPath
                );

            redirect(
                destination
            );
        }

        function redirectUnauthorized() {
            const destination =
                appendQueryParameter(
                    settings.unauthorizedPath,
                    "reason",
                    "admin-required"
                );

            redirect(
                destination
            );
        }

        function redirect(
            path
        ) {
            if (
                windowObject.location &&
                typeof windowObject.location.assign ===
                    "function"
            ) {
                windowObject.location.assign(
                    path
                );

                return;
            }

            if (
                windowObject.location
            ) {
                windowObject.location.href =
                    path;
            }
        }

        /* ==================================================
           IDENTITY
        ================================================== */

        function populateIdentity(
            user
        ) {
            const displayName =
                getUserDisplayName(
                    user
                );

            const email =
                user &&
                user.email
                    ? user.email
                    : "—";

            setText(
                elements.userName,
                displayName
            );

            setText(
                elements.userEmail,
                email
            );

            setText(
                elements.userAvatar,
                createInitials(
                    displayName,
                    email
                )
            );

            if (
                elements.userAvatar
            ) {
                elements.userAvatar.setAttribute(
                    "title",
                    displayName
                );
            }
        }

        function getUserDisplayName(
            user
        ) {
            if (
                user &&
                user.displayName
            ) {
                return String(
                    user.displayName
                ).trim();
            }

            if (
                user &&
                user.email
            ) {
                const emailName =
                    String(
                        user.email
                    )
                        .split(
                            "@"
                        )[0]
                        .replace(
                            /[._-]+/g,
                            " "
                        )
                        .trim();

                if (
                    emailName
                ) {
                    return titleCase(
                        emailName
                    );
                }
            }

            return "Administrator";
        }

        /* ==================================================
           SIDEBAR
        ================================================== */

        function openSidebar() {
            setSidebarOpen(
                true
            );
        }

        function closeSidebar() {
            setSidebarOpen(
                false
            );
        }

        function toggleSidebar() {
            setSidebarOpen(
                !sidebarOpen
            );
        }

        function setSidebarOpen(
            open
        ) {
            sidebarOpen =
                Boolean(
                    open
                );

            if (
                elements.sidebar
            ) {
                elements.sidebar.classList.toggle(
                    "is-open",
                    sidebarOpen
                );

                elements.sidebar.setAttribute(
                    "aria-hidden",
                    sidebarOpen
                        ? "false"
                        : "true"
                );
            }

            if (
                elements.menuToggle
            ) {
                elements.menuToggle.setAttribute(
                    "aria-expanded",
                    sidebarOpen
                        ? "true"
                        : "false"
                );
            }

            if (
                elements.overlay
            ) {
                elements.overlay.hidden =
                    !sidebarOpen;

                elements.overlay.setAttribute(
                    "aria-hidden",
                    sidebarOpen
                        ? "false"
                        : "true"
                );
            }

            documentObject
                .documentElement
                .classList
                .toggle(
                    "admin-menu-open",
                    sidebarOpen
                );
        }

        /* ==================================================
           SIGN OUT
        ================================================== */

        async function signOut() {
            if (
                !auth ||
                typeof auth.signOut !==
                    "function"
            ) {
                throw new AdminShellError(
                    "admin-shell/signout-unavailable",
                    "Sign-out is unavailable."
                );
            }

            setButtonBusy(
                elements.signOutButton,
                true
            );

            try {
                await auth.signOut();

                redirect(
                    settings.loginPath
                );

                return true;
            } catch (
                error
            ) {
                throw normalizeAdminShellError(
                    error,
                    "admin-shell/signout-failed",
                    "Unable to sign out."
                );
            } finally {
                setButtonBusy(
                    elements.signOutButton,
                    false
                );
            }
        }

        /* ==================================================
           ROUTER
        ================================================== */

        async function initializeRouter() {
            if (
                !global.LEternelAdminRouter ||
                typeof global
                    .LEternelAdminRouter
                    .getAdminRouter !==
                    "function"
            ) {
                return null;
            }

            const router =
                global
                    .LEternelAdminRouter
                    .getAdminRouter();

            if (
                router &&
                typeof router.init ===
                    "function"
            ) {
                await router.init();
            }

            return router;
        }

        /* ==================================================
           PAGE CONTROLLER
        ================================================== */

        async function initializePageController() {
            const descriptor =
                resolvePageController(
                    documentObject
                );

            if (
                !descriptor
            ) {
                return null;
            }

            const namespace =
                global[
                    descriptor.namespace
                ];

            if (
                !namespace ||
                typeof namespace[
                    descriptor.factory
                ] !==
                    "function"
            ) {
                if (
                    settings.strictControllerResolution
                ) {
                    throw new AdminShellError(
                        "admin-shell/controller-unavailable",
                        descriptor.namespace +
                        " is unavailable."
                    );
                }

                return null;
            }

            const controller =
                namespace[
                    descriptor.factory
                ]();

            if (
                controller &&
                typeof controller.init ===
                    "function"
            ) {
                await controller.init();
            }

            activeController =
                controller ||
                null;

            if (
                descriptor.globalName
            ) {
                global[
                    descriptor.globalName
                ] =
                    activeController;
            }

            return activeController;
        }

        /* ==================================================
           DATE
        ================================================== */

        function setCurrentDate() {
            if (
                !elements.currentDate
            ) {
                return;
            }

            elements.currentDate.textContent =
                new Intl.DateTimeFormat(
                    settings.locale,
                    {
                        day:
                            "numeric",

                        month:
                            "long",

                        year:
                            "numeric"
                    }
                ).format(
                    new Date()
                );
        }

        /* ==================================================
           EVENTS
        ================================================== */

        function bindEvents() {
            bindClick(
                elements.menuToggle,
                toggleSidebar
            );

            bindClick(
                elements.overlay,
                closeSidebar
            );

            bindClick(
                elements.signOutButton,
                signOut
            );

            const navigationLinks =
                elements.navigationLinks;

            for (
                const link of
                navigationLinks
            ) {
                const listener =
                    function () {
                        closeSidebar();
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

            const keydownListener =
                function (
                    event
                ) {
                    if (
                        event.key ===
                            "Escape" &&
                        sidebarOpen
                    ) {
                        closeSidebar();
                    }
                };

            documentObject.addEventListener(
                "keydown",
                keydownListener
            );

            disposers.push(
                function () {
                    documentObject.removeEventListener(
                        "keydown",
                        keydownListener
                    );
                }
            );

            const resizeListener =
                function () {
                    if (
                        windowObject.innerWidth >
                        settings.mobileBreakpoint
                    ) {
                        closeSidebar();
                    }
                };

            windowObject.addEventListener(
                "resize",
                resizeListener
            );

            disposers.push(
                function () {
                    windowObject.removeEventListener(
                        "resize",
                        resizeListener
                    );
                }
            );
        }

        function bindClick(
            element,
            handler
        ) {
            if (
                !element
            ) {
                return;
            }

            const listener =
                function (
                    event
                ) {
                    event.preventDefault();

                    Promise.resolve(
                        handler()
                    ).catch(
                        reportError
                    );
                };

            element.addEventListener(
                "click",
                listener
            );

            disposers.push(
                function () {
                    element.removeEventListener(
                        "click",
                        listener
                    );
                }
            );
        }

        /* ==================================================
           SNAPSHOT
        ================================================== */

        function getSnapshot() {
            return {
                initialized,
                destroyed,
                sidebarOpen,
                authResolved,

                authenticatedUser: authenticatedUser
                    ? {
                          uid:
                              authenticatedUser.uid ||
                              null,

                          email:
                              authenticatedUser.email ||
                              null,

                          displayName:
                              authenticatedUser.displayName ||
                              null
                      }
                    : null,

                administratorClaims:
                    cloneValue(
                        administratorClaims
                    ),

                hasActiveController:
                    Boolean(
                        activeController
                    )
            };
        }

        /* ==================================================
           PUBLIC API
        ================================================== */

        const shell =
            Object.freeze({
                init,
                destroy,

                openSidebar,
                closeSidebar,
                toggleSidebar,
                setSidebarOpen,

                populateIdentity,
                signOut,

                initializeRouter,
                initializePageController,

                getSnapshot,

                get activeController() {
                    return activeController;
                },

                get user() {
                    return authenticatedUser;
                },

                get claims() {
                    return cloneValue(
                        administratorClaims
                    );
                },

                elements,
                options:
                    settings
            });

        return shell;
    }

    /* ======================================================
       PAGE CONTROLLER RESOLUTION
    ====================================================== */

    function resolvePageController(
        documentObject
    ) {
        const definitions = [
            {
                selector:
                    "[data-admin-products]",

                namespace:
                    "LEternelProductsController",

                factory:
                    "getProductsController",

                globalName:
                    "LEternelProductsAdmin"
            },

            {
                selector:
                    "[data-admin-orders]",

                namespace:
                    "LEternelOrdersController",

                factory:
                    "getOrdersController",

                globalName:
                    "LEternelOrdersAdmin"
            },

            {
                selector:
                    "[data-admin-customers]",

                namespace:
                    "LEternelCustomersController",

                factory:
                    "getCustomersController",

                globalName:
                    "LEternelCustomersAdmin"
            },

            {
                selector:
                    "[data-admin-inventory]",

                namespace:
                    "LEternelInventoryController",

                factory:
                    "getInventoryController",

                globalName:
                    "LEternelInventoryAdmin"
            },

            {
                selector:
                    "[data-admin-operations]",

                namespace:
                    "LEternelOperationsController",

                factory:
                    "getOperationsController",

                globalName:
                    "LEternelOperationsAdmin"
            },

            {
                selector:
                    "[data-active-admin-route='dashboard']",

                namespace:
                    "LEternelDashboardController",

                factory:
                    "getDashboardController",

                globalName:
                    "LEternelDashboardAdmin"
            }
        ];

        for (
            const definition of
            definitions
        ) {
            if (
                documentObject.querySelector(
                    definition.selector
                )
            ) {
                return definition;
            }
        }

        return null;
    }

    /* ======================================================
       OPTIONS
    ====================================================== */

    function normalizeOptions(
        options
    ) {
        const source =
            options ||
            {};

        return Object.freeze({
            document:
                source.document ||
                null,

            window:
                source.window ||
                null,

            auth:
                source.auth ||
                null,

            requireAuthentication:
                source.requireAuthentication !==
                    false,

            requireAdministrator:
                source.requireAdministrator !==
                    false,

            allowAuthenticatedFallback:
                source.allowAuthenticatedFallback ===
                    true,

            forceTokenRefresh:
                source.forceTokenRefresh ===
                    true,

            strictControllerResolution:
                source.strictControllerResolution ===
                    true,

            loginPath:
                normalizePath(
                    source.loginPath,
                    DEFAULT_LOGIN_PATH
                ),

            unauthorizedPath:
                normalizePath(
                    source.unauthorizedPath,
                    DEFAULT_UNAUTHORIZED_PATH
                ),

            authenticationTimeoutMs:
                normalizePositiveInteger(
                    source.authenticationTimeoutMs,
                    15000,
                    "Authentication timeout"
                ),

            mobileBreakpoint:
                normalizePositiveInteger(
                    source.mobileBreakpoint,
                    1024,
                    "Mobile breakpoint"
                ),

            locale:
                String(
                    source.locale ||
                    "en-GB"
                ).trim() ||
                "en-GB",

            allowedAdminEmails:
                normalizeEmailList(
                    source.allowedAdminEmails
                ),

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

    function normalizePath(
        value,
        fallback
    ) {
        const normalized =
            String(
                value ||
                fallback
            ).trim();

        return normalized ||
            fallback;
    }

    function normalizePositiveInteger(
        value,
        fallback,
        label
    ) {
        if (
            value ===
                undefined ||
            value ===
                null ||
            value ===
                ""
        ) {
            return fallback;
        }

        const normalized =
            Number(
                value
            );

        if (
            !Number.isInteger(
                normalized
            ) ||
            normalized <=
                0
        ) {
            throw new TypeError(
                label +
                " must be a positive integer."
            );
        }

        return normalized;
    }

    function normalizeEmailList(
        value
    ) {
        if (
            !Array.isArray(
                value
            )
        ) {
            return [];
        }

        return Array.from(
            new Set(
                value
                    .map(
                        function (
                            email
                        ) {
                            return String(
                                email ||
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
       FIREBASE
    ====================================================== */

    function resolveAuth() {
        if (
            global.firebase &&
            typeof global.firebase.auth ===
                "function"
        ) {
            return global.firebase.auth();
        }

        return null;
    }

    /* ======================================================
       DOM
    ====================================================== */

    function resolveElements(
        documentObject,
        selectors
    ) {
        return {
            shell:
                documentObject.querySelector(
                    selectors.shell
                ),

            sidebar:
                documentObject.querySelector(
                    selectors.sidebar
                ),

            menuToggle:
                documentObject.querySelector(
                    selectors.menuToggle
                ),

            overlay:
                documentObject.querySelector(
                    selectors.overlay
                ),

            navigation:
                documentObject.querySelector(
                    selectors.navigation
                ),

            navigationLinks:
                Array.from(
                    documentObject.querySelectorAll(
                        selectors.navigationLinks
                    )
                ),

            userName:
                documentObject.querySelector(
                    selectors.userName
                ),

            userEmail:
                documentObject.querySelector(
                    selectors.userEmail
                ),

            userAvatar:
                documentObject.querySelector(
                    selectors.userAvatar
                ),

            signOutButton:
                documentObject.querySelector(
                    selectors.signOutButton
                ),

            content:
                documentObject.querySelector(
                    selectors.content
                ),

            currentDate:
                documentObject.querySelector(
                    selectors.currentDate
                )
        };
    }

    function setText(
        element,
        value
    ) {
        if (
            element
        ) {
            element.textContent =
                value ===
                    undefined ||
                value ===
                    null ||
                value ===
                    ""
                    ? "—"
                    : String(
                          value
                      );
        }
    }

    function setButtonBusy(
        element,
        busy
    ) {
        if (
            !element
        ) {
            return;
        }

        element.disabled =
            Boolean(
                busy
            );

        element.setAttribute(
            "aria-busy",
            busy
                ? "true"
                : "false"
        );
    }

    /* ======================================================
       HELPERS
    ====================================================== */

    function createInitials(
        name,
        email
    ) {
        const normalizedName =
            String(
                name ||
                ""
            ).trim();

        if (
            normalizedName
        ) {
            const parts =
                normalizedName
                    .split(
                        /\s+/
                    )
                    .filter(
                        Boolean
                    );

            return (
                parts[0]
                    .charAt(
                        0
                    ) +
                (
                    parts.length >
                        1
                        ? parts[
                              parts.length -
                              1
                          ].charAt(
                              0
                          )
                        : ""
                )
            ).toUpperCase();
        }

        return String(
            email ||
            "A"
        )
            .charAt(
                0
            )
            .toUpperCase();
    }

    function titleCase(
        value
    ) {
        return String(
            value ||
            ""
        )
            .replace(
                /[-_.]+/g,
                " "
            )
            .replace(
                /\b\w/g,
                function (
                    character
                ) {
                    return character.toUpperCase();
                }
            );
    }

    function appendQueryParameter(
        path,
        key,
        value
    ) {
        const separator =
            String(
                path
            ).includes(
                "?"
            )
                ? "&"
                : "?";

        return (
            path +
            separator +
            encodeURIComponent(
                key
            ) +
            "=" +
            encodeURIComponent(
                value
            )
        );
    }

    function normalizeAdminShellError(
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
                originalError:
                    error,

                details:
                    error &&
                    error.details
                        ? cloneValue(
                              error.details
                          )
                        : null
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

    function cloneValue(
        value
    ) {
        if (
            value ===
                undefined ||
            value ===
                null
        ) {
            return value;
        }

        if (
            value instanceof Date
        ) {
            return value.toISOString();
        }

        if (
            Array.isArray(
                value
            )
        ) {
            return value.map(
                cloneValue
            );
        }

        if (
            typeof value ===
                "object"
        ) {
            return Object.keys(
                value
            ).reduce(
                function (
                    output,
                    key
                ) {
                    output[key] =
                        cloneValue(
                            value[
                                key
                            ]
                        );

                    return output;
                },
                {}
            );
        }

        return value;
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
            defaultShell
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

        await shell.init();

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

            resolvePageController,
            normalizeOptions,
            normalizePath,
            normalizePositiveInteger,
            normalizeEmailList,

            createInitials,
            titleCase,
            appendQueryParameter,
            normalizeAdminShellError,
            cloneValue,

            constants:
                Object.freeze({
                    DEFAULT_SELECTORS,
                    DEFAULT_LOGIN_PATH,
                    DEFAULT_UNAUTHORIZED_PATH,
                    ADMIN_ROLE_NAMES
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