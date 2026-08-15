"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   FRONTEND ADMIN AUTH SERVICE

   Responsibilities:
   - Connect Firebase v8 frontend to admin callable functions
   - Normalize callable responses and errors
   - Expose administrator listing and lookup
   - Assign/remove roles
   - Grant/revoke permissions
   - Optionally patch raw claims when backend permits it
========================================================== */

(function (global) {
    /* ======================================================
       CONSTANTS
    ====================================================== */

    const DEFAULT_REGION =
        "europe-west1";

    const CALLABLE_NAMES =
        Object.freeze({
            listAdministrators:
                "listAdministrators",

            getAdministrator:
                "getAdministrator",

            setAdministratorRole:
                "setAdministratorRole",

            removeAdministratorRole:
                "removeAdministratorRole",

            grantAdministratorPermissions:
                "grantAdministratorPermissions",

            revokeAdministratorPermissions:
                "revokeAdministratorPermissions",

            patchAdministratorClaims:
                "patchAdministratorClaims"
        });

    /* ======================================================
       ERROR
    ====================================================== */

    class AdminAuthClientError extends Error {
        constructor(
            code,
            message,
            options
        ) {
            super(
                message ||
                "Administrator request failed."
            );

            this.name =
                "AdminAuthClientError";

            this.code =
                code ||
                "admin-auth-client/unknown";

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

    function createAdminAuthService(
        options
    ) {
        const settings =
            normalizeOptions(
                options
            );

        const functions =
            settings.functions ||
            resolveFunctions(
                settings.region
            );

        if (
            !functions ||
            typeof functions.httpsCallable !==
                "function"
        ) {
            throw new AdminAuthClientError(
                "admin-auth-client/functions-unavailable",
                "Firebase Cloud Functions is unavailable."
            );
        }

        const callables =
            createCallableMap(
                functions,
                settings.callableNames
            );

        /* ==================================================
           LIST
        ================================================== */

        async function listAdministrators(
            input
        ) {
            const source =
                input ||
                {};

            return invoke(
                "listAdministrators",
                {
                    pageSize:
                        source.pageSize,

                    pageToken:
                        source.pageToken,

                    fetchAll:
                        source.fetchAll
                }
            );
        }

        /* ==================================================
           GET
        ================================================== */

        async function getAdministrator(
            uid
        ) {
            return invoke(
                "getAdministrator",
                {
                    uid:
                        normalizeRequiredString(
                            uid,
                            "Administrator user ID"
                        )
                }
            );
        }

        /* ==================================================
           SET ROLE
        ================================================== */

        async function setAdministratorRole(
            input
        ) {
            const source =
                input ||
                {};

            return invoke(
                "setAdministratorRole",
                {
                    uid:
                        normalizeRequiredString(
                            source.uid ||
                            source.targetUid,
                            "Administrator user ID"
                        ),

                    role:
                        normalizeRequiredString(
                            source.role,
                            "Administrator role"
                        ),

                    permissions:
                        normalizeStringList(
                            source.permissions
                        ),

                    replacePermissions:
                        source.replacePermissions ===
                        true,

                    reason:
                        normalizeOptionalString(
                            source.reason
                        )
                }
            );
        }

        /* ==================================================
           REMOVE ROLE
        ================================================== */

        async function removeAdministratorRole(
            input
        ) {
            const source =
                input ||
                {};

            return invoke(
                "removeAdministratorRole",
                {
                    uid:
                        normalizeRequiredString(
                            source.uid ||
                            source.targetUid,
                            "Administrator user ID"
                        ),

                    preservePermissions:
                        source.preservePermissions ===
                        true,

                    reason:
                        normalizeOptionalString(
                            source.reason
                        )
                }
            );
        }

        /* ==================================================
           GRANT PERMISSIONS
        ================================================== */

        async function grantAdministratorPermissions(
            input
        ) {
            const source =
                input ||
                {};

            const permissions =
                normalizeStringList(
                    source.permissions ||
                    source.permission
                );

            if (
                !permissions.length
            ) {
                throw new AdminAuthClientError(
                    "admin-auth-client/permissions-required",
                    "At least one permission is required."
                );
            }

            return invoke(
                "grantAdministratorPermissions",
                {
                    uid:
                        normalizeRequiredString(
                            source.uid ||
                            source.targetUid,
                            "Administrator user ID"
                        ),

                    permissions,

                    reason:
                        normalizeOptionalString(
                            source.reason
                        )
                }
            );
        }

        /* ==================================================
           REVOKE PERMISSIONS
        ================================================== */

        async function revokeAdministratorPermissions(
            input
        ) {
            const source =
                input ||
                {};

            const permissions =
                normalizeStringList(
                    source.permissions ||
                    source.permission
                );

            if (
                !permissions.length
            ) {
                throw new AdminAuthClientError(
                    "admin-auth-client/permissions-required",
                    "At least one permission is required."
                );
            }

            return invoke(
                "revokeAdministratorPermissions",
                {
                    uid:
                        normalizeRequiredString(
                            source.uid ||
                            source.targetUid,
                            "Administrator user ID"
                        ),

                    permissions,

                    reason:
                        normalizeOptionalString(
                            source.reason
                        )
                }
            );
        }

        /* ==================================================
           RAW CLAIMS PATCH
        ================================================== */

        async function patchAdministratorClaims(
            input
        ) {
            const source =
                input ||
                {};

            if (
                !source.claims ||
                typeof source.claims !==
                    "object" ||
                Array.isArray(
                    source.claims
                )
            ) {
                throw new AdminAuthClientError(
                    "admin-auth-client/claims-required",
                    "A custom claims object is required."
                );
            }

            return invoke(
                "patchAdministratorClaims",
                {
                    uid:
                        normalizeRequiredString(
                            source.uid ||
                            source.targetUid,
                            "Administrator user ID"
                        ),

                    claims:
                        cloneValue(
                            source.claims
                        ),

                    replace:
                        source.replace ===
                        true,

                    allowSelfMutation:
                        source.allowSelfMutation ===
                        true,

                    reason:
                        normalizeOptionalString(
                            source.reason
                        )
                }
            );
        }

        /* ==================================================
           GENERIC INVOCATION
        ================================================== */

        async function invoke(
            key,
            payload
        ) {
            const callable =
                callables[
                    key
                ];

            if (
                typeof callable !==
                    "function"
            ) {
                throw new AdminAuthClientError(
                    "admin-auth-client/callable-unavailable",
                    key +
                    " callable is unavailable."
                );
            }

            try {
                const response =
                    await callable(
                        cleanPayload(
                            payload
                        )
                    );

                const data =
                    response &&
                    Object.prototype
                        .hasOwnProperty
                        .call(
                            response,
                            "data"
                        )
                        ? response.data
                        : response;

                return normalizeCallableResponse(
                    data
                );
            } catch (
                error
            ) {
                throw normalizeAdminAuthClientError(
                    error,
                    "admin-auth-client/request-failed",
                    "Administrator request failed."
                );
            }
        }

        /* ==================================================
           PUBLIC API
        ================================================== */

        return Object.freeze({
            listAdministrators,
            getAdministrator,

            setAdministratorRole,
            removeAdministratorRole,

            grantAdministratorPermissions,
            revokeAdministratorPermissions,

            patchAdministratorClaims,

            invoke,

            callables,
            options:
                settings
        });
    }

    /* ======================================================
       CALLABLE MAP
    ====================================================== */

    function createCallableMap(
        functions,
        names
    ) {
        const output =
            {};

        for (
            const [
                key,
                callableName
            ] of
            Object.entries(
                names
            )
        ) {
            output[
                key
            ] =
                functions
                    .httpsCallable(
                        callableName
                    );
        }

        return Object.freeze(
            output
        );
    }

    /* ======================================================
       RESPONSE NORMALIZATION
    ====================================================== */

    function normalizeCallableResponse(
        value
    ) {
        if (
            value ===
                undefined ||
            value ===
                null
        ) {
            return {
                success:
                    true
            };
        }

        if (
            typeof value !==
                "object" ||
            Array.isArray(
                value
            )
        ) {
            return {
                success:
                    true,

                value
            };
        }

        return cloneValue(
            value
        );
    }

    function cleanPayload(
        payload
    ) {
        const source =
            payload &&
            typeof payload ===
                "object"
                ? payload
                : {};

        const output =
            {};

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
                    undefined
            ) {
                continue;
            }

            output[
                key
            ] =
                cloneValue(
                    value
                );
        }

        return output;
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
            region:
                normalizeOptionalString(
                    source.region
                ) ||
                DEFAULT_REGION,

            functions:
                source.functions ||
                null,

            callableNames:
                Object.freeze(
                    Object.assign(
                        {},
                        CALLABLE_NAMES,
                        source.callableNames ||
                        {}
                    )
                )
        });
    }

    /* ======================================================
       FIREBASE
    ====================================================== */

    function resolveFunctions(
        region
    ) {
        if (
            !global.firebase ||
            typeof global.firebase.functions !==
                "function"
        ) {
            return null;
        }

        try {
            return global.firebase
                .app()
                .functions(
                    region
                );
        } catch (
            error
        ) {
            try {
                return global.firebase
                    .functions(
                        region
                    );
            } catch (
                secondError
            ) {
                reportError(
                    secondError
                );

                return null;
            }
        }
    }

    /* ======================================================
       NORMALIZERS
    ====================================================== */

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
            throw new AdminAuthClientError(
                "admin-auth-client/invalid-argument",
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
            return Array.from(
                new Set(
                    value
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
                        )
                )
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

        return Array.from(
            new Set(
                value
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
                    )
            )
        );
    }

    /* ======================================================
       ERROR NORMALIZATION
    ====================================================== */

    function normalizeAdminAuthClientError(
        error,
        fallbackCode,
        fallbackMessage
    ) {
        if (
            error instanceof
            AdminAuthClientError
        ) {
            return error;
        }

        const details =
            extractCallableErrorDetails(
                error
            );

        const serviceCode =
            details &&
            details.code
                ? String(
                      details.code
                  )
                : null;

        const firebaseCode =
            error &&
            error.code
                ? String(
                      error.code
                  )
                : null;

        return new AdminAuthClientError(
            serviceCode ||
            firebaseCode ||
            fallbackCode,
            error &&
            error.message
                ? String(
                      error.message
                  )
                : fallbackMessage,
            {
                details:
                    details,

                originalError:
                    error
            }
        );
    }

    function extractCallableErrorDetails(
        error
    ) {
        if (
            !error
        ) {
            return null;
        }

        if (
            error.details &&
            typeof error.details ===
                "object"
        ) {
            return cloneValue(
                error.details
            );
        }

        if (
            error.customData &&
            error.customData.details &&
            typeof error.customData.details ===
                "object"
        ) {
            return cloneValue(
                error.customData.details
            );
        }

        return null;
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
                "Admin auth frontend service error.",
                error
            );
        }
    }

    /* ======================================================
       DEFAULT INSTANCE
    ====================================================== */

    let defaultService =
        null;

    function getAdminAuthService(
        options
    ) {
        if (
            options
        ) {
            return createAdminAuthService(
                options
            );
        }

        if (
            !defaultService
        ) {
            defaultService =
                createAdminAuthService();
        }

        return defaultService;
    }

    function resetAdminAuthService() {
        defaultService =
            null;
    }

    /* ======================================================
       EXPORT
    ====================================================== */

    const api =
        Object.freeze({
            createAdminAuthService,
            getAdminAuthService,
            resetAdminAuthService,

            AdminAuthClientError,

            createCallableMap,
            normalizeCallableResponse,
            cleanPayload,

            normalizeOptions,
            resolveFunctions,

            normalizeRequiredString,
            normalizeOptionalString,
            normalizeStringList,

            normalizeAdminAuthClientError,
            extractCallableErrorDetails,

            cloneValue,

            constants:
                Object.freeze({
                    DEFAULT_REGION,
                    CALLABLE_NAMES
                })
        });

    global.LEternelAdminAuthService =
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