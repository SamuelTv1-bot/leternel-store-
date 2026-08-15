"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ADMIN AUTH GUARD

   Responsibilities:
   - Resolve current Firebase user
   - Read refreshed custom claims
   - Enforce administrator roles and permissions
   - Guard individual routes
   - Redirect unauthorized users safely
========================================================== */

(function (global) {
    /* ======================================================
       CONSTANTS
    ====================================================== */

    const DEFAULT_LOGIN_PATH =
        "/";

    const DEFAULT_UNAUTHORIZED_PATH =
        "/";

    const DEFAULT_ADMIN_PATH =
        "/admin/";

    const DEFAULT_TIMEOUT =
        15000;

    const DEFAULT_CLAIM_MAX_AGE =
        5 * 60 * 1000;

    const ADMIN_ROLES =
        Object.freeze([
            "admin",
            "administrator",
            "owner",
            "super-admin",
            "catalogue",
            "fulfilment",
            "support",
            "analyst"
        ]);

    const PRIVILEGED_ROLES =
        Object.freeze([
            "owner",
            "super-admin"
        ]);

    const ROUTE_PERMISSIONS =
        Object.freeze({
            dashboard:
                "dashboard.read",

            products:
                "products.read",

            orders:
                "orders.read",

            customers:
                "customers.read",

            inventory:
                "inventory.read",

            operations:
                "operations.read",

            administrators:
                "admins.read"
        });

    const ROLE_PERMISSIONS =
        Object.freeze({
            owner: [
                "*"
            ],

            "super-admin": [
                "*"
            ],

            administrator: [
                "admin.access",
                "dashboard.read",

                "products.read",
                "products.write",

                "orders.read",
                "orders.write",
                "orders.refund",

                "customers.read",
                "customers.write",
                "customers.delete",

                "inventory.read",
                "inventory.write",

                "operations.read",
                "operations.write",

                "admins.read",
                "admins.write"
            ],

            admin: [
                "admin.access",
                "dashboard.read",

                "products.read",
                "products.write",

                "orders.read",
                "orders.write",

                "customers.read",
                "customers.write",

                "inventory.read",
                "inventory.write",

                "operations.read"
            ],

            catalogue: [
                "admin.access",
                "dashboard.read",

                "products.read",
                "products.write",

                "inventory.read",
                "inventory.write"
            ],

            fulfilment: [
                "admin.access",
                "dashboard.read",

                "orders.read",
                "orders.write",

                "inventory.read"
            ],

            support: [
                "admin.access",
                "dashboard.read",

                "orders.read",

                "customers.read",
                "customers.write"
            ],

            analyst: [
                "admin.access",
                "dashboard.read",

                "products.read",
                "orders.read",
                "customers.read",
                "inventory.read",
                "operations.read"
            ]
        });

    /* ======================================================
       ERROR
    ====================================================== */

    class AdminAuthGuardError extends Error {
        constructor(
            code,
            message,
            options
        ) {
            super(
                message ||
                "Administrator authorization failed."
            );

            this.name =
                "AdminAuthGuardError";

            this.code =
                code ||
                "admin-auth-guard/unknown";

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

    function createAdminAuthGuard(
        options
    ) {
        const settings =
            normalizeOptions(
                options
            );

        const auth =
            settings.auth ||
            resolveFirebaseAuth();

        if (
            !auth
        ) {
            throw new AdminAuthGuardError(
                "admin-auth-guard/auth-unavailable",
                "Firebase Authentication is unavailable."
            );
        }

        const state = {
            user:
                null,

            tokenResult:
                null,

            claims:
                {},

            roles:
                [],

            permissions:
                [],

            initialized:
                false,

            authorized:
                false,

            lastClaimRefresh:
                0
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

            const user =
                await waitForAuthUser(
                    auth,
                    settings.timeout
                );

            if (
                !user
            ) {
                state.initialized =
                    true;

                state.authorized =
                    false;

                return api;
            }

            state.user =
                user;

            await refreshClaims(
                true
            );

            state.initialized =
                true;

            return api;
        }

        /* ==================================================
           CLAIM REFRESH
        ================================================== */

        async function refreshClaims(
            force
        ) {
            if (
                !state.user
            ) {
                state.claims =
                    {};

                state.roles =
                    [];

                state.permissions =
                    [];

                state.authorized =
                    false;

                return null;
            }

            const now =
                Date.now();

            if (
                !force &&
                state.tokenResult &&
                now -
                state.lastClaimRefresh <
                    settings.claimMaxAge
            ) {
                return state.tokenResult;
            }

            const result =
                await state.user
                    .getIdTokenResult(
                        force ===
                        true
                    );

            state.tokenResult =
                result;

            state.claims =
                normalizeClaims(
                    result &&
                    result.claims
                );

            state.roles =
                extractRoles(
                    state.claims
                );

            state.permissions =
                extractPermissions(
                    state.claims
                );

            state.authorized =
                isAdministratorClaims(
                    state.claims
                );

            state.lastClaimRefresh =
                now;

            return result;
        }

        /* ==================================================
           BASIC ADMIN REQUIREMENT
        ================================================== */

        async function requireAdmin(
            options
        ) {
            const source =
                options ||
                {};

            await initialize();

            if (
                !state.user
            ) {
                if (
                    source.redirect !==
                    false
                ) {
                    redirectToLogin();
                }

                throw new AdminAuthGuardError(
                    "admin-auth-guard/unauthenticated",
                    "Administrator authentication is required."
                );
            }

            await refreshClaims(
                source.forceRefresh ===
                true
            );

            if (
                !isAdministratorClaims(
                    state.claims
                )
            ) {
                if (
                    source.redirect !==
                    false
                ) {
                    redirectUnauthorized();
                }

                throw new AdminAuthGuardError(
                    "admin-auth-guard/admin-required",
                    "Administrator access is required."
                );
            }

            return createAuthorizationSnapshot();
        }

        /* ==================================================
           PERMISSION REQUIREMENT
        ================================================== */

        async function requirePermission(
            permission,
            options
        ) {
            const normalizedPermission =
                normalizeRequiredString(
                    permission,
                    "Permission"
                );

            await requireAdmin(
                options
            );

            if (
                !can(
                    normalizedPermission
                )
            ) {
                if (
                    !options ||
                    options.redirect !==
                        false
                ) {
                    redirectUnauthorized();
                }

                throw new AdminAuthGuardError(
                    "admin-auth-guard/permission-denied",
                    "You do not have permission to access this administrator resource.",
                    {
                        details: {
                            permission:
                                normalizedPermission
                        }
                    }
                );
            }

            return createAuthorizationSnapshot();
        }

        /* ==================================================
           ROLE REQUIREMENT
        ================================================== */

        async function requireRole(
            role,
            options
        ) {
            const normalizedRole =
                normalizeRole(
                    role
                );

            await requireAdmin(
                options
            );

            if (
                !hasRole(
                    normalizedRole
                )
            ) {
                if (
                    !options ||
                    options.redirect !==
                        false
                ) {
                    redirectUnauthorized();
                }

                throw new AdminAuthGuardError(
                    "admin-auth-guard/role-required",
                    "Required administrator role is missing.",
                    {
                        details: {
                            role:
                                normalizedRole
                        }
                    }
                );
            }

            return createAuthorizationSnapshot();
        }

        /* ==================================================
           GENERIC AUTHORIZATION
        ================================================== */

        async function authorize(
            input
        ) {
            const source =
                input ||
                {};

            await requireAdmin(
                source
            );

            const permissions =
                normalizeStringList(
                    source.permissions ||
                    source.permission
                );

            const roles =
                normalizeStringList(
                    source.roles ||
                    source.role
                );

            if (
                permissions.length &&
                !permissions.every(
                    can
                )
            ) {
                if (
                    source.redirect !==
                    false
                ) {
                    redirectUnauthorized();
                }

                throw new AdminAuthGuardError(
                    "admin-auth-guard/permission-denied",
                    "Required administrator permission is missing."
                );
            }

            if (
                roles.length &&
                !roles.some(
                    hasRole
                )
            ) {
                if (
                    source.redirect !==
                    false
                ) {
                    redirectUnauthorized();
                }

                throw new AdminAuthGuardError(
                    "admin-auth-guard/role-required",
                    "Required administrator role is missing."
                );
            }

            return createAuthorizationSnapshot();
        }

        /* ==================================================
           CURRENT ROUTE
        ================================================== */

        async function authorizeCurrentRoute(
            options
        ) {
            const routeId =
                resolveCurrentRouteId();

            if (
                !routeId
            ) {
                return requireAdmin(
                    options
                );
            }

            const permission =
                ROUTE_PERMISSIONS[
                    routeId
                ] ||
                resolveRouterPermission(
                    routeId
                );

            if (
                permission
            ) {
                return requirePermission(
                    permission,
                    options
                );
            }

            return requireAdmin(
                options
            );
        }

        async function guardCurrentPage(
            options
        ) {
            return authorizeCurrentRoute(
                options
            );
        }

        /* ==================================================
           PERMISSION CHECKS
        ================================================== */

        function can(
            permission
        ) {
            const normalized =
                normalizePermission(
                    permission
                );

            if (
                !normalized
            ) {
                return false;
            }

            const effective =
                getEffectivePermissions();

            return effective.some(
                function (
                    granted
                ) {
                    return permissionMatches(
                        granted,
                        normalized
                    );
                }
            );
        }

        function canAny(
            permissions
        ) {
            const required =
                normalizeStringList(
                    permissions
                );

            return required.some(
                can
            );
        }

        function canAll(
            permissions
        ) {
            const required =
                normalizeStringList(
                    permissions
                );

            return required.every(
                can
            );
        }

        function hasRole(
            role
        ) {
            const normalized =
                normalizeRole(
                    role
                );

            return state.roles.includes(
                normalized
            );
        }

        function hasPrivilegedRole() {
            return PRIVILEGED_ROLES.some(
                hasRole
            );
        }

        function getEffectivePermissions() {
            const merged =
                new Set(
                    state.permissions
                );

            for (
                const role of
                state.roles
            ) {
                const mapped =
                    ROLE_PERMISSIONS[
                        role
                    ] ||
                    [];

                for (
                    const permission of
                    mapped
                ) {
                    merged.add(
                        permission
                    );
                }
            }

            return Array.from(
                merged
            );
        }

        /* ==================================================
           SNAPSHOT
        ================================================== */

        function createAuthorizationSnapshot() {
            return {
                uid:
                    state.user
                        ? state.user.uid
                        : null,

                email:
                    state.user &&
                    state.user.email
                        ? state.user.email
                        : state.claims.email ||
                          null,

                displayName:
                    state.user &&
                    state.user.displayName
                        ? state.user.displayName
                        : state.claims.name ||
                          null,

                claims:
                    cloneValue(
                        state.claims
                    ),

                roles:
                    state.roles.slice(),

                permissions:
                    getEffectivePermissions(),

                privileged:
                    hasPrivilegedRole()
            };
        }

        /* ==================================================
           REDIRECTS
        ================================================== */

        function redirectToLogin() {
            redirect(
                settings.loginPath
            );
        }

        function redirectUnauthorized() {
            redirect(
                settings.unauthorizedPath
            );
        }

        function redirectToAdmin() {
            redirect(
                settings.adminPath
            );
        }

        function redirect(
            path
        ) {
            if (
                !global.location
            ) {
                return path;
            }

            const destination =
                normalizeRequiredString(
                    path,
                    "Redirect path"
                );

            if (
                typeof global.location.replace ===
                "function"
            ) {
                global.location.replace(
                    destination
                );
            } else {
                global.location.href =
                    destination;
            }

            return destination;
        }

        /* ==================================================
           PUBLIC API
        ================================================== */

        const api =
            Object.freeze({
                initialize,

                refreshClaims,

                requireAdmin,
                requirePermission,
                requireRole,

                authorize,

                authorizeCurrentRoute,
                guardCurrentPage,

                can,
                canAny,
                canAll,

                hasRole,
                hasPrivilegedRole,

                getEffectivePermissions,
                createAuthorizationSnapshot,

                redirectToLogin,
                redirectUnauthorized,
                redirectToAdmin,
                redirect,

                state,
                options:
                    settings
            });

        return api;
    }

    /* ======================================================
       ROUTE RESOLUTION
    ====================================================== */

    function resolveCurrentRouteId() {
        if (
            global.LEternelAdminRouter &&
            typeof global
                .LEternelAdminRouter
                .getAdminRouter ===
                "function"
        ) {
            try {
                const router =
                    global
                        .LEternelAdminRouter
                        .getAdminRouter();

                if (
                    router &&
                    typeof router
                        .getCurrentRouteId ===
                        "function"
                ) {
                    const routeId =
                        router
                            .getCurrentRouteId();

                    if (
                        routeId
                    ) {
                        return routeId;
                    }
                }
            } catch (
                error
            ) {
                reportError(
                    error
                );
            }
        }

        if (
            global.document
        ) {
            const shell =
                global.document.querySelector(
                    "[data-active-admin-route]"
                );

            if (
                shell &&
                shell.dataset
                    .activeAdminRoute
            ) {
                return normalizeRoute(
                    shell.dataset
                        .activeAdminRoute
                );
            }
        }

        return resolveRouteFromPath(
            global.location &&
            global.location.pathname
        );
    }

    function resolveRouteFromPath(
        path
    ) {
        const normalized =
            String(
                path ||
                ""
            )
                .toLowerCase()
                .replace(
                    /\/+$/,
                    ""
                );

        if (
            normalized ===
                "/admin" ||
            normalized ===
                "/admin/index.html"
        ) {
            return "dashboard";
        }

        if (
            normalized.includes(
                "/products"
            )
        ) {
            return "products";
        }

        if (
            normalized.includes(
                "/orders"
            )
        ) {
            return "orders";
        }

        if (
            normalized.includes(
                "/customers"
            )
        ) {
            return "customers";
        }

        if (
            normalized.includes(
                "/inventory"
            )
        ) {
            return "inventory";
        }

        if (
            normalized.includes(
                "/operations"
            )
        ) {
            return "operations";
        }

        if (
            normalized.includes(
                "/administrators"
            )
        ) {
            return "administrators";
        }

        return null;
    }

    function resolveRouterPermission(
        routeId
    ) {
        if (
            !global.LEternelAdminRouter
        ) {
            return null;
        }

        try {
            const router =
                global.LEternelAdminRouter;

            if (
                typeof router.getRoute ===
                    "function"
            ) {
                const route =
                    router.getRoute(
                        routeId
                    );

                return route &&
                    route.permission
                    ? route.permission
                    : null;
            }
        } catch (
            error
        ) {
            reportError(
                error
            );
        }

        return null;
    }

    /* ======================================================
       CLAIM HELPERS
    ====================================================== */

    function normalizeClaims(
        claims
    ) {
        return claims &&
            typeof claims ===
                "object" &&
            !Array.isArray(
                claims
            )
            ? cloneValue(
                  claims
              )
            : {};
    }

    function extractRoles(
        claims
    ) {
        const source =
            normalizeClaims(
                claims
            );

        const roles =
            normalizeStringList(
                source.roles
            );

        const singular =
            normalizeRole(
                source.role
            );

        if (
            singular &&
            !roles.includes(
                singular
            )
        ) {
            roles.push(
                singular
            );
        }

        return Array.from(
            new Set(
                roles
            )
        );
    }

    function extractPermissions(
        claims
    ) {
        return normalizeStringList(
            normalizeClaims(
                claims
            ).permissions
        );
    }

    function isAdministratorClaims(
        claims
    ) {
        const source =
            normalizeClaims(
                claims
            );

        if (
            source.admin ===
                true ||
            source.isAdmin ===
                true
        ) {
            return true;
        }

        return extractRoles(
            source
        ).some(
            function (
                role
            ) {
                return ADMIN_ROLES.includes(
                    role
                );
            }
        );
    }

    /* ======================================================
       PERMISSION MATCHING
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
            "*"
        ) {
            return true;
        }

        if (
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
            const prefix =
                grant.slice(
                    0,
                    -1
                );

            return need.startsWith(
                prefix
            );
        }

        return false;
    }

    /* ======================================================
       AUTH WAIT
    ====================================================== */

    function waitForAuthUser(
        auth,
        timeout
    ) {
        if (
            auth.currentUser
        ) {
            return Promise.resolve(
                auth.currentUser
            );
        }

        return new Promise(
            function (
                resolve,
                reject
            ) {
                let settled =
                    false;

                let timer =
                    null;

                const finish =
                    function (
                        callback,
                        value
                    ) {
                        if (
                            settled
                        ) {
                            return;
                        }

                        settled =
                            true;

                        if (
                            timer
                        ) {
                            clearTimeout(
                                timer
                            );
                        }

                        callback(
                            value
                        );
                    };

                let unsubscribe =
                    null;

                try {
                    unsubscribe =
                        auth
                            .onAuthStateChanged(
                                function (
                                    user
                                ) {
                                    if (
                                        unsubscribe
                                    ) {
                                        unsubscribe();
                                    }

                                    finish(
                                        resolve,
                                        user ||
                                        null
                                    );
                                },
                                function (
                                    error
                                ) {
                                    if (
                                        unsubscribe
                                    ) {
                                        unsubscribe();
                                    }

                                    finish(
                                        reject,
                                        error
                                    );
                                }
                            );
                } catch (
                    error
                ) {
                    finish(
                        reject,
                        error
                    );

                    return;
                }

                timer =
                    setTimeout(
                        function () {
                            if (
                                unsubscribe
                            ) {
                                unsubscribe();
                            }

                            finish(
                                reject,
                                new AdminAuthGuardError(
                                    "admin-auth-guard/auth-timeout",
                                    "Administrator authentication timed out."
                                )
                            );
                        },
                        timeout
                    );
            }
        );
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
       NORMALIZATION
    ====================================================== */

    function normalizeOptions(
        options
    ) {
        const source =
            options ||
            {};

        return Object.freeze({
            auth:
                source.auth ||
                null,

            loginPath:
                normalizeOptionalString(
                    source.loginPath
                ) ||
                DEFAULT_LOGIN_PATH,

            unauthorizedPath:
                normalizeOptionalString(
                    source.unauthorizedPath
                ) ||
                DEFAULT_UNAUTHORIZED_PATH,

            adminPath:
                normalizeOptionalString(
                    source.adminPath
                ) ||
                DEFAULT_ADMIN_PATH,

            timeout:
                normalizePositiveInteger(
                    source.timeout,
                    DEFAULT_TIMEOUT
                ),

            claimMaxAge:
                normalizePositiveInteger(
                    source.claimMaxAge,
                    DEFAULT_CLAIM_MAX_AGE
                )
        });
    }

    function normalizePositiveInteger(
        value,
        fallback
    ) {
        const normalized =
            Number(
                value
            );

        return Number.isInteger(
            normalized
        ) &&
        normalized >
            0
            ? normalized
            : fallback;
    }

    function normalizeRequiredString(
        value,
        label
    ) {
        const normalized =
            String(
                value ||
                ""
            ).trim();

        if (
            !normalized
        ) {
            throw new AdminAuthGuardError(
                "admin-auth-guard/invalid-argument",
                (
                    label ||
                    "Value"
                ) +
                " is required."
            );
        }

        return normalized;
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

    function normalizeRole(
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
       CLONE
    ====================================================== */

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
                    output[
                        key
                    ] =
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

    function reportError(
        error
    ) {
        if (
            global.console &&
            typeof global.console.error ===
                "function"
        ) {
            global.console.error(
                "Admin auth guard error.",
                error
            );
        }
    }

    /* ======================================================
       DEFAULT INSTANCE
    ====================================================== */

    let defaultGuard =
        null;

    function getAdminAuthGuard(
        options
    ) {
        if (
            options
        ) {
            return createAdminAuthGuard(
                options
            );
        }

        if (
            !defaultGuard
        ) {
            defaultGuard =
                createAdminAuthGuard();
        }

        return defaultGuard;
    }

    function resetAdminAuthGuard() {
        defaultGuard =
            null;
    }

    async function bootstrap(
        options
    ) {
        const guard =
            getAdminAuthGuard(
                options
            );

        await guard.initialize();

        await guard.guardCurrentPage();

        return guard;
    }

    /* ======================================================
       EXPORT
    ====================================================== */

    const api =
        Object.freeze({
            createAdminAuthGuard,
            getAdminAuthGuard,
            resetAdminAuthGuard,
            bootstrap,

            AdminAuthGuardError,

            waitForAuthUser,
            resolveFirebaseAuth,

            resolveCurrentRouteId,
            resolveRouteFromPath,
            resolveRouterPermission,

            normalizeClaims,
            extractRoles,
            extractPermissions,
            isAdministratorClaims,

            permissionMatches,

            normalizeOptions,
            normalizePositiveInteger,
            normalizeRequiredString,
            normalizeOptionalString,
            normalizeRole,
            normalizePermission,
            normalizeRoute,
            normalizeStringList,

            cloneValue,

            constants:
                Object.freeze({
                    DEFAULT_LOGIN_PATH,
                    DEFAULT_UNAUTHORIZED_PATH,
                    DEFAULT_ADMIN_PATH,
                    DEFAULT_TIMEOUT,
                    DEFAULT_CLAIM_MAX_AGE,

                    ADMIN_ROLES,
                    PRIVILEGED_ROLES,

                    ROUTE_PERMISSIONS,
                    ROLE_PERMISSIONS
                })
        });

    global.LEternelAdminAuthGuard =
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