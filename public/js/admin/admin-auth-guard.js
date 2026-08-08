"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ADMIN AUTHORIZATION GUARD

   Responsibilities:
   - Resolve Firebase Authentication state
   - Validate administrator custom claims
   - Support role-based and permission-based access
   - Preserve intended redirect destinations
   - Prevent redirect loops
   - Refresh stale ID token claims
   - Expose reusable page and action authorization checks
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

    const DEFAULT_AUTH_TIMEOUT_MS =
        15000;

    const DEFAULT_CLAIMS_MAX_AGE_MS =
        5 * 60 * 1000;

    const DEFAULT_REDIRECT_PARAMETER =
        "redirect";

    const DEFAULT_REASON_PARAMETER =
        "reason";

    const DEFAULT_ADMIN_ROLES =
        Object.freeze([
            "admin",
            "administrator",
            "owner",
            "super-admin"
        ]);

    const DEFAULT_ADMIN_PERMISSIONS =
        Object.freeze([
            "admin.access"
        ]);

    const DEFAULT_ROLE_PERMISSIONS =
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
                "inventory.read",
                "inventory.write",
                "operations.read",
                "operations.write"
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

    const DEFAULT_ROUTE_PERMISSIONS =
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
                "operations.read"
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
                "admin-auth/unknown";

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
       GUARD FACTORY
    ====================================================== */

    function createAdminAuthGuard(options) {
        const settings =
            normalizeOptions(
                options
            );

        const windowObject =
            settings.window ||
            global;

        const documentObject =
            settings.document ||
            global.document ||
            null;

        const auth =
            settings.auth ||
            resolveAuth();

        let destroyed =
            false;

        let initialized =
            false;

        let authUnsubscribe =
            null;

        let authPromise =
            null;

        let currentUser =
            null;

        let currentTokenResult =
            null;

        let currentClaims =
            {};

        let currentRoles =
            [];

        let currentPermissions =
            [];

        let claimsLoadedAt =
            null;

        let lastDecision =
            null;

        /* ==================================================
           LIFECYCLE
        ================================================== */

        async function init() {
            if (
                initialized
            ) {
                return guard;
            }

            assertActive();

            if (
                !auth ||
                typeof auth.onAuthStateChanged !==
                    "function"
            ) {
                throw new AdminAuthGuardError(
                    "admin-auth/auth-unavailable",
                    "Firebase Authentication is unavailable."
                );
            }

            initialized =
                true;

            await waitForAuthState();

            return guard;
        }

        function destroy() {
            if (
                destroyed
            ) {
                return;
            }

            destroyed =
                true;

            if (
                typeof authUnsubscribe ===
                    "function"
            ) {
                try {
                    authUnsubscribe();
                } catch (
                    error
                ) {
                    reportError(
                        error
                    );
                }
            }

            authUnsubscribe =
                null;

            authPromise =
                null;

            currentUser =
                null;

            currentTokenResult =
                null;

            currentClaims =
                {};

            currentRoles =
                [];

            currentPermissions =
                [];

            claimsLoadedAt =
                null;

            lastDecision =
                null;

            initialized =
                false;
        }

        function assertActive() {
            if (
                destroyed
            ) {
                throw new AdminAuthGuardError(
                    "admin-auth/destroyed",
                    "Administrator authorization guard has been destroyed."
                );
            }
        }

        /* ==================================================
           AUTH STATE
        ================================================== */

        function waitForAuthState() {
            assertActive();

            if (
                authPromise
            ) {
                return authPromise;
            }

            authPromise =
                new Promise(
                    function (
                        resolve,
                        reject
                    ) {
                        let settled =
                            false;

                        const timeoutId =
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
                                        new AdminAuthGuardError(
                                            "admin-auth/timeout",
                                            "Authentication verification timed out."
                                        )
                                    );
                                },
                                settings.authTimeoutMs
                            );

                        authUnsubscribe =
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
                                        currentUser =
                                            user ||
                                            null;

                                        if (
                                            currentUser
                                        ) {
                                            await refreshClaims(
                                                settings.forceTokenRefreshOnInit
                                            );
                                        } else {
                                            clearClaims();
                                        }

                                        settled =
                                            true;

                                        windowObject.clearTimeout(
                                            timeoutId
                                        );

                                        resolve(
                                            currentUser
                                        );
                                    } catch (
                                        error
                                    ) {
                                        settled =
                                            true;

                                        windowObject.clearTimeout(
                                            timeoutId
                                        );

                                        reject(
                                            normalizeAdminAuthError(
                                                error,
                                                "admin-auth/token-failed",
                                                "Unable to verify administrator token."
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
                                        timeoutId
                                    );

                                    reject(
                                        normalizeAdminAuthError(
                                            error,
                                            "admin-auth/listener-failed",
                                            "Authentication listener failed."
                                        )
                                    );
                                }
                            );
                    }
                );

            return authPromise;
        }

        async function refreshClaims(
            forceRefresh
        ) {
            assertActive();

            if (
                !currentUser ||
                typeof currentUser.getIdTokenResult !==
                    "function"
            ) {
                clearClaims();

                return {};
            }

            const shouldForce =
                forceRefresh ===
                    true ||
                areClaimsStale();

            currentTokenResult =
                await currentUser
                    .getIdTokenResult(
                        shouldForce
                    );

            currentClaims =
                currentTokenResult &&
                currentTokenResult.claims
                    ? cloneValue(
                          currentTokenResult.claims
                      )
                    : {};

            currentRoles =
                extractRoles(
                    currentClaims
                );

            currentPermissions =
                extractPermissions(
                    currentClaims,
                    currentRoles,
                    settings.rolePermissions
                );

            claimsLoadedAt =
                Date.now();

            return cloneValue(
                currentClaims
            );
        }

        function clearClaims() {
            currentTokenResult =
                null;

            currentClaims =
                {};

            currentRoles =
                [];

            currentPermissions =
                [];

            claimsLoadedAt =
                null;
        }

        function areClaimsStale() {
            if (
                !claimsLoadedAt
            ) {
                return true;
            }

            return (
                Date.now() -
                claimsLoadedAt
            ) >
                settings.claimsMaxAgeMs;
        }

        /* ==================================================
           AUTHORIZATION
        ================================================== */

        async function authorize(input) {
            assertActive();

            const request =
                normalizeAuthorizationRequest(
                    input
                );

            await init();

            if (
                !currentUser
            ) {
                const decision =
                    createDecision({
                        allowed:
                            false,

                        authenticated:
                            false,

                        reason:
                            "authentication-required",

                        user:
                            null,

                        requiredRoles:
                            request.roles,

                        requiredPermissions:
                            request.permissions
                    });

                lastDecision =
                    decision;

                if (
                    request.redirect
                ) {
                    redirectToLogin(
                        request.redirectPath
                    );
                }

                return decision;
            }

            if (
                request.forceClaimsRefresh ||
                areClaimsStale()
            ) {
                await refreshClaims(
                    true
                );
            }

            const roleDecision =
                evaluateRoleRequirement(
                    currentRoles,
                    request.roles,
                    request.roleMode
                );

            const permissionDecision =
                evaluatePermissionRequirement(
                    currentPermissions,
                    request.permissions,
                    request.permissionMode
                );

            const emailDecision =
                evaluateEmailRequirement(
                    currentUser,
                    request.allowedEmails
                );

            const customDecision =
                await evaluateCustomRequirement(
                    request.validator,
                    {
                        user:
                            currentUser,

                        claims:
                            cloneValue(
                                currentClaims
                            ),

                        roles:
                            cloneValue(
                                currentRoles
                            ),

                        permissions:
                            cloneValue(
                                currentPermissions
                            )
                    }
                );

            const allowed =
                roleDecision.allowed &&
                permissionDecision.allowed &&
                emailDecision.allowed &&
                customDecision.allowed;

            const reason =
                allowed
                    ? "authorized"
                    : roleDecision.allowed ===
                        false
                        ? "role-required"
                        : permissionDecision.allowed ===
                            false
                            ? "permission-required"
                            : emailDecision.allowed ===
                                false
                                ? "email-not-allowed"
                                : "custom-check-failed";

            const decision =
                createDecision({
                    allowed,
                    authenticated:
                        true,

                    reason,

                    user:
                        currentUser,

                    claims:
                        currentClaims,

                    roles:
                        currentRoles,

                    permissions:
                        currentPermissions,

                    requiredRoles:
                        request.roles,

                    requiredPermissions:
                        request.permissions,

                    missingRoles:
                        roleDecision.missing,

                    missingPermissions:
                        permissionDecision.missing
                });

            lastDecision =
                decision;

            if (
                !allowed &&
                request.redirect
            ) {
                redirectUnauthorized(
                    reason,
                    request.redirectPath
                );
            }

            return decision;
        }

        async function requireAdmin(options) {
            const source =
                options ||
                {};

            const roles =
                normalizeStringList(
                    source.roles &&
                    source.roles.length
                        ? source.roles
                        : settings.adminRoles
                );

            const permissions =
                normalizeStringList(
                    source.permissions &&
                    source.permissions.length
                        ? source.permissions
                        : settings.adminPermissions
                );

            return authorize({
                roles,
                permissions,

                roleMode:
                    source.roleMode ||
                    "any",

                permissionMode:
                    source.permissionMode ||
                    "any",

                redirect:
                    source.redirect !==
                    false,

                redirectPath:
                    source.redirectPath,

                forceClaimsRefresh:
                    source.forceClaimsRefresh ===
                    true,

                allowedEmails:
                    source.allowedEmails,

                validator:
                    source.validator
            });
        }

        async function requirePermission(
            permission,
            options
        ) {
            const source =
                options ||
                {};

            return authorize({
                permissions:
                    normalizeStringList(
                        permission
                    ),

                permissionMode:
                    source.permissionMode ||
                    "all",

                redirect:
                    source.redirect ===
                    true,

                redirectPath:
                    source.redirectPath,

                forceClaimsRefresh:
                    source.forceClaimsRefresh ===
                    true
            });
        }

        async function requireRole(
            role,
            options
        ) {
            const source =
                options ||
                {};

            return authorize({
                roles:
                    normalizeStringList(
                        role
                    ),

                roleMode:
                    source.roleMode ||
                    "any",

                redirect:
                    source.redirect ===
                    true,

                redirectPath:
                    source.redirectPath,

                forceClaimsRefresh:
                    source.forceClaimsRefresh ===
                    true
            });
        }

        async function authorizeCurrentRoute(
            options
        ) {
            const source =
                options ||
                {};

            const route =
                source.route ||
                resolveCurrentAdminRoute(
                    documentObject,
                    windowObject
                );

            const permission =
                settings.routePermissions[
                    route
                ] ||
                null;

            const permissions =
                permission
                    ? [
                          permission
                      ]
                    : settings.adminPermissions;

            return requireAdmin({
                permissions,
                permissionMode:
                    "all",

                redirect:
                    source.redirect !==
                    false,

                redirectPath:
                    source.redirectPath,

                forceClaimsRefresh:
                    source.forceClaimsRefresh ===
                    true
            });
        }

        function can(permission) {
            const requested =
                normalizeStringList(
                    permission
                );

            if (
                !requested.length
            ) {
                return false;
            }

            return evaluatePermissionRequirement(
                currentPermissions,
                requested,
                "all"
            ).allowed;
        }

        function canAny(permissions) {
            return evaluatePermissionRequirement(
                currentPermissions,
                normalizeStringList(
                    permissions
                ),
                "any"
            ).allowed;
        }

        function hasRole(role) {
            return evaluateRoleRequirement(
                currentRoles,
                normalizeStringList(
                    role
                ),
                "any"
            ).allowed;
        }

        /* ==================================================
           REDIRECTS
        ================================================== */

        function redirectToLogin(
            requestedPath
        ) {
            const intendedPath =
                sanitizeInternalPath(
                    requestedPath ||
                    getCurrentRelativePath(
                        windowObject
                    ),
                    settings.adminPath
                );

            const destination =
                appendQueryParameters(
                    settings.loginPath,
                    {
                        [
                            settings.redirectParameter
                        ]:
                            intendedPath,

                        [
                            settings.reasonParameter
                        ]:
                            "authentication-required"
                    }
                );

            safeRedirect(
                destination
            );
        }

        function redirectUnauthorized(
            reason,
            requestedPath
        ) {
            const intendedPath =
                sanitizeInternalPath(
                    requestedPath ||
                    getCurrentRelativePath(
                        windowObject
                    ),
                    settings.adminPath
                );

            const destination =
                appendQueryParameters(
                    settings.unauthorizedPath,
                    {
                        [
                            settings.redirectParameter
                        ]:
                            intendedPath,

                        [
                            settings.reasonParameter
                        ]:
                            reason ||
                            "admin-required"
                    }
                );

            safeRedirect(
                destination
            );
        }

        function safeRedirect(path) {
            const destination =
                normalizeRedirectDestination(
                    path,
                    settings.unauthorizedPath
                );

            const currentPath =
                getCurrentRelativePath(
                    windowObject
                );

            if (
                normalizeComparablePath(
                    destination
                ) ===
                normalizeComparablePath(
                    currentPath
                )
            ) {
                throw new AdminAuthGuardError(
                    "admin-auth/redirect-loop",
                    "Administrator redirect loop prevented.",
                    {
                        details: {
                            destination,
                            currentPath
                        }
                    }
                );
            }

            if (
                windowObject.location &&
                typeof windowObject.location.assign ===
                    "function"
            ) {
                windowObject.location.assign(
                    destination
                );

                return destination;
            }

            if (
                windowObject.location
            ) {
                windowObject.location.href =
                    destination;
            }

            return destination;
        }

        /* ==================================================
           SNAPSHOT
        ================================================== */

        function getSnapshot() {
            return {
                initialized,
                destroyed,

                authenticated:
                    Boolean(
                        currentUser
                    ),

                user:
                    currentUser
                        ? {
                              uid:
                                  currentUser.uid ||
                                  null,

                              email:
                                  currentUser.email ||
                                  null,

                              displayName:
                                  currentUser.displayName ||
                                  null,

                              emailVerified:
                                  Boolean(
                                      currentUser.emailVerified
                                  )
                          }
                        : null,

                claims:
                    cloneValue(
                        currentClaims
                    ),

                roles:
                    cloneValue(
                        currentRoles
                    ),

                permissions:
                    cloneValue(
                        currentPermissions
                    ),

                claimsLoadedAt:
                    claimsLoadedAt
                        ? new Date(
                              claimsLoadedAt
                          ).toISOString()
                        : null,

                claimsStale:
                    areClaimsStale(),

                lastDecision:
                    cloneValue(
                        lastDecision
                    )
            };
        }

        /* ==================================================
           PUBLIC API
        ================================================== */

        const guard =
            Object.freeze({
                init,
                destroy,

                waitForAuthState,
                refreshClaims,

                authorize,
                requireAdmin,
                requirePermission,
                requireRole,
                authorizeCurrentRoute,

                can,
                canAny,
                hasRole,

                redirectToLogin,
                redirectUnauthorized,

                getSnapshot,

                get user() {
                    return currentUser;
                },

                get claims() {
                    return cloneValue(
                        currentClaims
                    );
                },

                get roles() {
                    return cloneValue(
                        currentRoles
                    );
                },

                get permissions() {
                    return cloneValue(
                        currentPermissions
                    );
                },

                options:
                    settings
            });

        return guard;
    }

    /* ======================================================
       CLAIM EXTRACTION
    ====================================================== */

    function extractRoles(claims) {
        const source =
            claims ||
            {};

        const roles =
            [];

        appendRole(
            roles,
            source.role
        );

        appendRole(
            roles,
            source.userRole
        );

        appendRole(
            roles,
            source.adminRole
        );

        if (
            Array.isArray(
                source.roles
            )
        ) {
            for (
                const role of
                source.roles
            ) {
                appendRole(
                    roles,
                    role
                );
            }
        }

        if (
            source.admin ===
            true
        ) {
            appendRole(
                roles,
                "admin"
            );
        }

        if (
            source.isAdmin ===
            true
        ) {
            appendRole(
                roles,
                "admin"
            );
        }

        if (
            source.superAdmin ===
            true
        ) {
            appendRole(
                roles,
                "super-admin"
            );
        }

        if (
            source.owner ===
            true
        ) {
            appendRole(
                roles,
                "owner"
            );
        }

        return Array.from(
            new Set(
                roles
            )
        );
    }

    function appendRole(
        output,
        value
    ) {
        if (
            value ===
                undefined ||
            value ===
                null
        ) {
            return;
        }

        const normalized =
            normalizeRole(
                value
            );

        if (
            normalized
        ) {
            output.push(
                normalized
            );
        }
    }

    function extractPermissions(
        claims,
        roles,
        rolePermissions
    ) {
        const source =
            claims ||
            {};

        const permissions =
            [];

        appendPermissions(
            permissions,
            source.permissions
        );

        appendPermissions(
            permissions,
            source.scopes
        );

        appendPermissions(
            permissions,
            source.adminPermissions
        );

        if (
            typeof source.permission ===
                "string"
        ) {
            appendPermissions(
                permissions,
                [
                    source.permission
                ]
            );
        }

        for (
            const role of
            normalizeStringList(
                roles
            )
        ) {
            const mapped =
                rolePermissions[
                    role
                ];

            appendPermissions(
                permissions,
                mapped
            );
        }

        if (
            permissions.includes(
                "*"
            )
        ) {
            return [
                "*"
            ];
        }

        return Array.from(
            new Set(
                permissions
                    .map(
                        normalizePermission
                    )
                    .filter(
                        Boolean
                    )
            )
        );
    }

    function appendPermissions(
        output,
        values
    ) {
        if (
            typeof values ===
            "string"
        ) {
            values =
                values.split(
                    /[\s,]+/
                );
        }

        if (
            !Array.isArray(
                values
            )
        ) {
            return;
        }

        for (
            const permission of
            values
        ) {
            const normalized =
                normalizePermission(
                    permission
                );

            if (
                normalized
            ) {
                output.push(
                    normalized
                );
            }
        }
    }

    /* ======================================================
       REQUIREMENT EVALUATION
    ====================================================== */

    function evaluateRoleRequirement(
        userRoles,
        requiredRoles,
        mode
    ) {
        const available =
            normalizeStringList(
                userRoles
            ).map(
                normalizeRole
            );

        const required =
            normalizeStringList(
                requiredRoles
            ).map(
                normalizeRole
            );

        if (
            !required.length
        ) {
            return {
                allowed:
                    true,

                missing:
                    []
            };
        }

        const missing =
            required.filter(
                function (
                    role
                ) {
                    return !available.includes(
                        role
                    );
                }
            );

        if (
            mode ===
            "all"
        ) {
            return {
                allowed:
                    missing.length ===
                    0,

                missing
            };
        }

        return {
            allowed:
                required.some(
                    function (
                        role
                    ) {
                        return available.includes(
                            role
                        );
                    }
                ),

            missing:
                required.filter(
                    function (
                        role
                    ) {
                        return !available.includes(
                            role
                        );
                    }
                )
        };
    }

    function evaluatePermissionRequirement(
        userPermissions,
        requiredPermissions,
        mode
    ) {
        const available =
            normalizeStringList(
                userPermissions
            ).map(
                normalizePermission
            );

        const required =
            normalizeStringList(
                requiredPermissions
            ).map(
                normalizePermission
            );

        if (
            !required.length
        ) {
            return {
                allowed:
                    true,

                missing:
                    []
            };
        }

        if (
            available.includes(
                "*"
            )
        ) {
            return {
                allowed:
                    true,

                missing:
                    []
            };
        }

        const missing =
            required.filter(
                function (
                    permission
                ) {
                    return !permissionMatches(
                        available,
                        permission
                    );
                }
            );

        if (
            mode ===
            "any"
        ) {
            return {
                allowed:
                    required.some(
                        function (
                            permission
                        ) {
                            return permissionMatches(
                                available,
                                permission
                            );
                        }
                    ),

                missing
            };
        }

        return {
            allowed:
                missing.length ===
                0,

            missing
        };
    }

    function permissionMatches(
        availablePermissions,
        requiredPermission
    ) {
        if (
            availablePermissions.includes(
                requiredPermission
            )
        ) {
            return true;
        }

        const parts =
            requiredPermission.split(
                "."
            );

        while (
            parts.length >
            1
        ) {
            parts.pop();

            if (
                availablePermissions.includes(
                    parts.join(
                        "."
                    ) +
                    ".*"
                )
            ) {
                return true;
            }
        }

        return false;
    }

    function evaluateEmailRequirement(
        user,
        allowedEmails
    ) {
        const normalizedEmails =
            normalizeEmailList(
                allowedEmails
            );

        if (
            !normalizedEmails.length
        ) {
            return {
                allowed:
                    true
            };
        }

        const email =
            user &&
            user.email
                ? String(
                      user.email
                  )
                      .trim()
                      .toLowerCase()
                : "";

        return {
            allowed:
                Boolean(
                    email &&
                    normalizedEmails.includes(
                        email
                    )
                )
        };
    }

    async function evaluateCustomRequirement(
        validator,
        context
    ) {
        if (
            typeof validator !==
            "function"
        ) {
            return {
                allowed:
                    true
            };
        }

        const result =
            await validator(
                context
            );

        if (
            result &&
            typeof result ===
                "object"
        ) {
            return {
                allowed:
                    result.allowed ===
                    true,

                details:
                    cloneValue(
                        result
                    )
            };
        }

        return {
            allowed:
                result ===
                true
        };
    }

    /* ======================================================
       DECISIONS
    ====================================================== */

    function createDecision(input) {
        const source =
            input ||
            {};

        const user =
            source.user ||
            null;

        return {
            allowed:
                source.allowed ===
                true,

            authenticated:
                source.authenticated ===
                true,

            reason:
                source.reason ||
                "unknown",

            user:
                user
                    ? {
                          uid:
                              user.uid ||
                              null,

                          email:
                              user.email ||
                              null,

                          displayName:
                              user.displayName ||
                              null,

                          emailVerified:
                              Boolean(
                                  user.emailVerified
                              )
                      }
                    : null,

            claims:
                cloneValue(
                    source.claims ||
                    {}
                ),

            roles:
                cloneValue(
                    source.roles ||
                    []
                ),

            permissions:
                cloneValue(
                    source.permissions ||
                    []
                ),

            requiredRoles:
                cloneValue(
                    source.requiredRoles ||
                    []
                ),

            requiredPermissions:
                cloneValue(
                    source.requiredPermissions ||
                    []
                ),

            missingRoles:
                cloneValue(
                    source.missingRoles ||
                    []
                ),

            missingPermissions:
                cloneValue(
                    source.missingPermissions ||
                    []
                ),

            checkedAt:
                new Date()
                    .toISOString()
        };
    }

    /* ======================================================
       REQUEST NORMALIZATION
    ====================================================== */

    function normalizeAuthorizationRequest(input) {
        const source =
            input ||
            {};

        return {
            roles:
                normalizeStringList(
                    source.roles ||
                    source.role
                ).map(
                    normalizeRole
                ),

            permissions:
                normalizeStringList(
                    source.permissions ||
                    source.permission
                ).map(
                    normalizePermission
                ),

            roleMode:
                normalizeRequirementMode(
                    source.roleMode,
                    "any"
                ),

            permissionMode:
                normalizeRequirementMode(
                    source.permissionMode,
                    "all"
                ),

            allowedEmails:
                normalizeEmailList(
                    source.allowedEmails
                ),

            validator:
                typeof source.validator ===
                    "function"
                    ? source.validator
                    : null,

            redirect:
                source.redirect ===
                true,

            redirectPath:
                source.redirectPath ||
                null,

            forceClaimsRefresh:
                source.forceClaimsRefresh ===
                true
        };
    }

    /* ======================================================
       ROUTE RESOLUTION
    ====================================================== */

    function resolveCurrentAdminRoute(
        documentObject,
        windowObject
    ) {
        if (
            documentObject
        ) {
            const activeRoot =
                documentObject.querySelector(
                    "[data-active-admin-route]"
                );

            if (
                activeRoot &&
                activeRoot.dataset &&
                activeRoot.dataset
                    .activeAdminRoute
            ) {
                return normalizeRouteName(
                    activeRoot.dataset
                        .activeAdminRoute
                );
            }

            const pageRoots = [
                [
                    "[data-admin-products]",
                    "products"
                ],

                [
                    "[data-admin-orders]",
                    "orders"
                ],

                [
                    "[data-admin-customers]",
                    "customers"
                ],

                [
                    "[data-admin-inventory]",
                    "inventory"
                ],

                [
                    "[data-admin-operations]",
                    "operations"
                ]
            ];

            for (
                const [
                    selector,
                    route
                ] of
                pageRoots
            ) {
                if (
                    documentObject.querySelector(
                        selector
                    )
                ) {
                    return route;
                }
            }
        }

        const pathname =
            windowObject &&
            windowObject.location
                ? windowObject.location.pathname
                : "";

        if (
            pathname.includes(
                "/products"
            )
        ) {
            return "products";
        }

        if (
            pathname.includes(
                "/orders"
            )
        ) {
            return "orders";
        }

        if (
            pathname.includes(
                "/customers"
            )
        ) {
            return "customers";
        }

        if (
            pathname.includes(
                "/inventory"
            )
        ) {
            return "inventory";
        }

        if (
            pathname.includes(
                "/operations"
            )
        ) {
            return "operations";
        }

        return "dashboard";
    }

    /* ======================================================
       REDIRECT HELPERS
    ====================================================== */

    function getCurrentRelativePath(
        windowObject
    ) {
        if (
            !windowObject ||
            !windowObject.location
        ) {
            return DEFAULT_ADMIN_PATH;
        }

        return (
            windowObject.location.pathname ||
            "/"
        ) +
            (
                windowObject.location.search ||
                ""
            ) +
            (
                windowObject.location.hash ||
                ""
            );
    }

    function sanitizeInternalPath(
        value,
        fallback
    ) {
        const normalized =
            String(
                value ||
                ""
            ).trim();

        if (
            !normalized
        ) {
            return fallback;
        }

        if (
            normalized.startsWith(
                "//"
            )
        ) {
            return fallback;
        }

        if (
            /^[a-z][a-z0-9+.-]*:/i.test(
                normalized
            )
        ) {
            return fallback;
        }

        if (
            !normalized.startsWith(
                "/"
            )
        ) {
            return fallback;
        }

        return normalized;
    }

    function normalizeRedirectDestination(
        value,
        fallback
    ) {
        return sanitizeInternalPath(
            value,
            fallback
        );
    }

    function appendQueryParameters(
        path,
        parameters
    ) {
        const source =
            parameters ||
            {};

        const hashIndex =
            path.indexOf(
                "#"
            );

        const hash =
            hashIndex >=
                0
                ? path.slice(
                      hashIndex
                  )
                : "";

        const basePath =
            hashIndex >=
                0
                ? path.slice(
                      0,
                      hashIndex
                  )
                : path;

        const pairs =
            [];

        for (
            const [
                key,
                value
            ] of
            Object.entries(
                source
            )
        ) {
            if (
                value ===
                    undefined ||
                value ===
                    null ||
                value ===
                    ""
            ) {
                continue;
            }

            pairs.push(
                encodeURIComponent(
                    key
                ) +
                "=" +
                encodeURIComponent(
                    String(
                        value
                    )
                )
            );
        }

        if (
            !pairs.length
        ) {
            return path;
        }

        return basePath +
            (
                basePath.includes(
                    "?"
                )
                    ? "&"
                    : "?"
            ) +
            pairs.join(
                "&"
            ) +
            hash;
    }

    function normalizeComparablePath(
        value
    ) {
        return String(
            value ||
            ""
        )
            .replace(
                /\/+$/,
                ""
            )
            .toLowerCase();
    }

    /* ======================================================
       OPTIONS
    ====================================================== */

    function normalizeOptions(options) {
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

            auth:
                source.auth ||
                null,

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

            adminPath:
                normalizePath(
                    source.adminPath,
                    DEFAULT_ADMIN_PATH
                ),

            authTimeoutMs:
                normalizePositiveInteger(
                    source.authTimeoutMs,
                    DEFAULT_AUTH_TIMEOUT_MS,
                    "Authentication timeout"
                ),

            claimsMaxAgeMs:
                normalizePositiveInteger(
                    source.claimsMaxAgeMs,
                    DEFAULT_CLAIMS_MAX_AGE_MS,
                    "Claims maximum age"
                ),

            forceTokenRefreshOnInit:
                source.forceTokenRefreshOnInit ===
                true,

            redirectParameter:
                normalizeParameterName(
                    source.redirectParameter,
                    DEFAULT_REDIRECT_PARAMETER
                ),

            reasonParameter:
                normalizeParameterName(
                    source.reasonParameter,
                    DEFAULT_REASON_PARAMETER
                ),

            adminRoles:
                normalizeStringList(
                    source.adminRoles &&
                    source.adminRoles.length
                        ? source.adminRoles
                        : DEFAULT_ADMIN_ROLES
                ).map(
                    normalizeRole
                ),

            adminPermissions:
                normalizeStringList(
                    source.adminPermissions &&
                    source.adminPermissions.length
                        ? source.adminPermissions
                        : DEFAULT_ADMIN_PERMISSIONS
                ).map(
                    normalizePermission
                ),

            rolePermissions:
                normalizeRolePermissionMap(
                    Object.assign(
                        {},
                        DEFAULT_ROLE_PERMISSIONS,
                        source.rolePermissions ||
                        {}
                    )
                ),

            routePermissions:
                Object.freeze(
                    Object.assign(
                        {},
                        DEFAULT_ROUTE_PERMISSIONS,
                        source.routePermissions ||
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

    function normalizeParameterName(
        value,
        fallback
    ) {
        const normalized =
            String(
                value ||
                fallback
            )
                .trim()
                .replace(
                    /[^a-zA-Z0-9_-]/g,
                    ""
                );

        return normalized ||
            fallback;
    }

    function normalizeRequirementMode(
        value,
        fallback
    ) {
        const normalized =
            String(
                value ||
                fallback
            )
                .trim()
                .toLowerCase();

        return normalized ===
            "any"
            ? "any"
            : "all";
    }

    function normalizeRole(
        value
    ) {
        return String(
            value ||
            ""
        )
            .trim()
            .toLowerCase()
            .replace(
                /[\s_]+/g,
                "-"
            );
    }

    function normalizePermission(
        value
    ) {
        return String(
            value ||
            ""
        )
            .trim()
            .toLowerCase()
            .replace(
                /\s+/g,
                ""
            );
    }

    function normalizeRouteName(
        value
    ) {
        return String(
            value ||
            "dashboard"
        )
            .trim()
            .toLowerCase()
            .replace(
                /[^a-z0-9-]/g,
                ""
            ) ||
            "dashboard";
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

        if (
            typeof value ===
                "string"
        ) {
            return value
                .split(
                    /[\s,]+/
                )
                .map(
                    function (
                        item
                    ) {
                        return item.trim();
                    }
                )
                .filter(
                    Boolean
                );
        }

        if (
            !Array.isArray(
                value
            )
        ) {
            return [
                String(
                    value
                ).trim()
            ].filter(
                Boolean
            );
        }

        return value
            .map(
                function (
                    item
                ) {
                    return String(
                        item ||
                        ""
                    ).trim();
                }
            )
            .filter(
                Boolean
            );
    }

    function normalizeEmailList(
        value
    ) {
        return Array.from(
            new Set(
                normalizeStringList(
                    value
                )
                    .map(
                        function (
                            email
                        ) {
                            return email
                                .trim()
                                .toLowerCase();
                        }
                    )
                    .filter(
                        function (
                            email
                        ) {
                            return email.includes(
                                "@"
                            );
                        }
                    )
            )
        );
    }

    function normalizeRolePermissionMap(
        input
    ) {
        const source =
            input ||
            {};

        const output =
            {};

        for (
            const [
                role,
                permissions
            ] of
            Object.entries(
                source
            )
        ) {
            const normalizedRole =
                normalizeRole(
                    role
                );

            if (
                !normalizedRole
            ) {
                continue;
            }

            output[
                normalizedRole
            ] =
                Array.from(
                    new Set(
                        normalizeStringList(
                            permissions
                        )
                            .map(
                                normalizePermission
                            )
                            .filter(
                                Boolean
                            )
                    )
                );
        }

        return Object.freeze(
            output
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
       ERRORS / CLONE
    ====================================================== */

    function normalizeAdminAuthError(
        error,
        fallbackCode,
        fallbackMessage
    ) {
        if (
            error instanceof
            AdminAuthGuardError
        ) {
            return error;
        }

        return new AdminAuthGuardError(
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

    function reportError(error) {
        if (
            global.console &&
            typeof global.console.error ===
                "function"
        ) {
            global.console.error(
                "Admin authorization guard error.",
                error
            );
        }
    }

    function cloneValue(value) {
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

    /* ======================================================
       DEFAULT INSTANCE
    ====================================================== */

    let defaultGuard =
        null;

    function getAdminAuthGuard(options) {
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
        if (
            defaultGuard
        ) {
            defaultGuard.destroy();
        }

        defaultGuard =
            null;
    }

    async function guardCurrentPage(options) {
        const guard =
            getAdminAuthGuard(
                options
            );

        const decision =
            await guard
                .authorizeCurrentRoute({
                    redirect:
                        true
                });

        return {
            guard,
            decision
        };
    }

    /* ======================================================
       EXPORT
    ====================================================== */

    const api =
        Object.freeze({
            createAdminAuthGuard,
            getAdminAuthGuard,
            resetAdminAuthGuard,
            guardCurrentPage,

            AdminAuthGuardError,

            extractRoles,
            extractPermissions,
            evaluateRoleRequirement,
            evaluatePermissionRequirement,
            permissionMatches,
            evaluateEmailRequirement,
            evaluateCustomRequirement,
            createDecision,

            resolveCurrentAdminRoute,

            getCurrentRelativePath,
            sanitizeInternalPath,
            normalizeRedirectDestination,
            appendQueryParameters,
            normalizeComparablePath,

            normalizeOptions,
            normalizePath,
            normalizePositiveInteger,
            normalizeParameterName,
            normalizeRequirementMode,
            normalizeRole,
            normalizePermission,
            normalizeRouteName,
            normalizeStringList,
            normalizeEmailList,
            normalizeRolePermissionMap,

            normalizeAdminAuthError,
            cloneValue,

            constants:
                Object.freeze({
                    DEFAULT_LOGIN_PATH,
                    DEFAULT_UNAUTHORIZED_PATH,
                    DEFAULT_ADMIN_PATH,
                    DEFAULT_AUTH_TIMEOUT_MS,
                    DEFAULT_CLAIMS_MAX_AGE_MS,
                    DEFAULT_REDIRECT_PARAMETER,
                    DEFAULT_REASON_PARAMETER,
                    DEFAULT_ADMIN_ROLES,
                    DEFAULT_ADMIN_PERMISSIONS,
                    DEFAULT_ROLE_PERMISSIONS,
                    DEFAULT_ROUTE_PERMISSIONS
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