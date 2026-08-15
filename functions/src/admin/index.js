"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ADMIN MODULE INDEX

   Integration-safe central export surface for:
   - Administrator authorization
   - Administrator Cloud Function callables
   - Service bundles
   - Deployable callable export map
========================================================== */

/* ==========================================================
   MODULES
========================================================== */

const adminAuthService =
    require(
        "./admin-auth-service"
    );

const adminCallables =
    require(
        "./admin-callables"
    );

/* ==========================================================
   AUTH EXPORTS
========================================================== */

const {
    createAdminAuthService,
    getAdminAuthService,
    resetAdminAuthService,

    AdminAuthServiceError,

    buildRoleClaims,
    removeAdminClaims,
    createAdministratorSnapshot,

    extractRoles,
    extractPermissions,
    isAdministratorClaims,
    hasPrivilegedRole,
    hasAllPermissions,
    permissionMatches,

    normalizeRoleMutationRequest,
    normalizeRemovalRequest,
    normalizePermissionMutationRequest,
    normalizeClaimsPatchRequest,
    normalizeListRequest,
    normalizeActor,

    normalizeServiceOptions,
    normalizeUid,
    normalizeAdminRole,
    normalizeRole,
    normalizePermission,
    normalizeRoleList,
    normalizePermissionList,
    normalizeStringList,
    normalizeClaims,
    normalizeRequiredString,
    normalizeOptionalString,
    normalizeCollectionName,
    normalizePositiveInteger,
    normalizeRolePermissionMap,

    mergePermissionLists,
    validateClaimsSize,
    redactClaims,

    normalizeAdminAuthServiceError,

    cloneValue:
        cloneAdminAuthValue,

    constants:
        adminAuthConstants
} =
    adminAuthService;

/* ==========================================================
   CALLABLE EXPORTS
========================================================== */

const {
    createAdminCallables,
    getAdminCallables,
    resetAdminCallables,

    AdminCallableError,

    createCallable,
    requireCallableAdministrator,
    createActorFromCallableContext,

    normalizeCallableData,
    normalizeListPayload,

    normalizeRequiredString:
        normalizeCallableRequiredString,

    normalizeOptionalString:
        normalizeCallableOptionalString,

    normalizePositiveInteger:
        normalizeCallablePositiveInteger,

    sanitizeCallableClaims,
    createSafeActorSnapshot,

    toHttpsError,
    mapServiceErrorToHttpsCode,

    normalizeCallableOptions,
    normalizeRuntimeOptions,
    normalizeMemory,

    normalizeAdminCallableError,

    cloneValue:
        cloneAdminCallableValue,

    constants:
        adminCallableConstants
} =
    adminCallables;

/* ==========================================================
   CONSTANTS
========================================================== */

const constants =
    Object.freeze({
        adminAuth:
            adminAuthConstants,

        adminCallables:
            adminCallableConstants,

        DEFAULT_USERS_COLLECTION:
            adminAuthConstants
                .DEFAULT_USERS_COLLECTION,

        DEFAULT_AUDIT_COLLECTION:
            adminAuthConstants
                .DEFAULT_AUDIT_COLLECTION,

        DEFAULT_AUDIT_EVENT:
            adminAuthConstants
                .DEFAULT_AUDIT_EVENT,

        DEFAULT_ROLE:
            adminAuthConstants
                .DEFAULT_ROLE,

        DEFAULT_MAX_CLAIM_BYTES:
            adminAuthConstants
                .DEFAULT_MAX_CLAIM_BYTES,

        ADMIN_ROLES:
            adminAuthConstants
                .ADMIN_ROLES,

        PRIVILEGED_ROLES:
            adminAuthConstants
                .PRIVILEGED_ROLES,

        DEFAULT_ROLE_PERMISSIONS:
            adminAuthConstants
                .DEFAULT_ROLE_PERMISSIONS,

        DEFAULT_REGION:
            adminCallableConstants
                .DEFAULT_REGION,

        DEFAULT_RUNTIME_OPTIONS:
            adminCallableConstants
                .DEFAULT_RUNTIME_OPTIONS,

        CALLABLE_NAMES:
            adminCallableConstants
                .CALLABLE_NAMES
    });

/* ==========================================================
   SERVICE OPTION RESOLUTION

   Supports BOTH:

   createAdminServices({
       admin,
       auth,
       firestore
   });

   AND:

   createAdminServices({
       adminAuth: {
           admin,
           auth,
           firestore
       }
   });

   AND:

   createAdminServices({
       auth: {
           admin,
           auth,
           firestore
       }
   });

   without confusing a raw Firebase Auth object with nested
   service configuration.
========================================================== */

function resolveAdminAuthOptions(
    options
) {
    const settings =
        options &&
        typeof options ===
            "object"
            ? options
            : {};

    /* ------------------------------------------------------
       Explicit nested adminAuth configuration has priority.
    ------------------------------------------------------ */

    if (
        isAdminAuthOptionsObject(
            settings.adminAuth
        )
    ) {
        return settings
            .adminAuth;
    }

    /* ------------------------------------------------------
       "auth" may itself be a nested service-options object.

       Only treat it that way if it actually looks like one.
    ------------------------------------------------------ */

    if (
        isAdminAuthOptionsObject(
            settings.auth
        )
    ) {
        return settings
            .auth;
    }

    /* ------------------------------------------------------
       Otherwise preserve the entire top-level object.

       This correctly supports:
       {
           admin: firebaseAdmin,
           auth: firebaseAuth,
           firestore: firestore
       }
    ------------------------------------------------------ */

    return settings;
}

function isAdminAuthOptionsObject(
    value
) {
    if (
        !value ||
        typeof value !==
            "object" ||
        Array.isArray(
            value
        )
    ) {
        return false;
    }

    /*
     * A raw Firebase Auth instance exposes methods such as
     * getUser(), setCustomUserClaims(), listUsers().
     *
     * That must NOT be mistaken for an options container.
     */
    if (
        typeof value.getUser ===
            "function" ||
        typeof value.setCustomUserClaims ===
            "function" ||
        typeof value.listUsers ===
            "function"
    ) {
        return false;
    }

    return Boolean(
        value.admin ||
        value.auth ||
        value.firestore ||
        value.usersCollection ||
        value.auditCollection ||
        value.rolePermissions ||
        value.defaultRole ||
        value.maxClaimBytes
    );
}

/* ==========================================================
   ADMIN SERVICES
========================================================== */

function createAdminServices(
    options
) {
    const authOptions =
        resolveAdminAuthOptions(
            options
        );

    const auth =
        createAdminAuthService(
            authOptions
        );

    return Object.freeze({
        auth
    });
}

let defaultAdminServices =
    null;

function getAdminServices(
    options
) {
    if (
        options
    ) {
        return createAdminServices(
            options
        );
    }

    if (
        !defaultAdminServices
    ) {
        defaultAdminServices =
            createAdminServices();
    }

    return defaultAdminServices;
}

function resetAdminServices() {
    resetAdminAuthService();

    defaultAdminServices =
        null;
}

/* ==========================================================
   ADMIN FUNCTION BUNDLE
========================================================== */

function createAdminFunctionBundle(
    options
) {
    const settings =
        options &&
        typeof options ===
            "object"
            ? options
            : {};

    let services =
        null;

    let service =
        settings.service ||
        settings.adminAuthService ||
        null;

    /* ------------------------------------------------------
       If a service is directly injected, don't recreate it.
    ------------------------------------------------------ */

    if (
        service
    ) {
        services =
            Object.freeze({
                auth:
                    service
            });
    } else if (
        settings.services &&
        settings.services.auth
    ) {
        services =
            settings.services;

        service =
            settings.services.auth;
    } else {
        services =
            createAdminServices(
                settings.serviceOptions ||
                settings.adminServices ||
                settings
            );

        service =
            services.auth;
    }

    const callables =
        createAdminCallables({
            region:
                settings.region,

            rawHandlers:
                settings.rawHandlers,

            allowRawClaimsPatch:
                settings.allowRawClaimsPatch,

            runtimeOptions:
                settings.runtimeOptions,

            service
        });

    return Object.freeze({
        services,
        callables
    });
}

let defaultAdminFunctionBundle =
    null;

function getAdminFunctionBundle(
    options
) {
    if (
        options
    ) {
        return createAdminFunctionBundle(
            options
        );
    }

    if (
        !defaultAdminFunctionBundle
    ) {
        const services =
            getAdminServices();

        const callables =
            createAdminCallables({
                service:
                    services.auth
            });

        defaultAdminFunctionBundle =
            Object.freeze({
                services,
                callables
            });
    }

    return defaultAdminFunctionBundle;
}

function resetAdminFunctionBundle() {
    resetAdminCallables();

    resetAdminServices();

    defaultAdminFunctionBundle =
        null;
}

/* ==========================================================
   DEPLOYABLE EXPORT MAP
========================================================== */

function createAdminCallableExports(
    options
) {
    const bundle =
        createAdminFunctionBundle(
            options
        );

    const callables =
        bundle.callables;

    return Object.freeze({
        listAdministrators:
            callables
                .listAdministrators,

        getAdministrator:
            callables
                .getAdministrator,

        setAdministratorRole:
            callables
                .setAdministratorRole,

        removeAdministratorRole:
            callables
                .removeAdministratorRole,

        grantAdministratorPermissions:
            callables
                .grantAdministratorPermissions,

        revokeAdministratorPermissions:
            callables
                .revokeAdministratorPermissions,

        patchAdministratorClaims:
            callables
                .patchAdministratorClaims
    });
}

/* ==========================================================
   SHARED CLONE
========================================================== */

function cloneValue(
    value
) {
    return cloneAdminAuthValue(
        value
    );
}

/* ==========================================================
   EXPORT
========================================================== */

module.exports =
    Object.freeze({
        /* ----------------------------------------------
           Modules
        ---------------------------------------------- */

        adminAuthService,
        adminCallables,

        /* ----------------------------------------------
           Option resolution
        ---------------------------------------------- */

        resolveAdminAuthOptions,
        isAdminAuthOptionsObject,

        /* ----------------------------------------------
           Service bundles
        ---------------------------------------------- */

        createAdminServices,
        getAdminServices,
        resetAdminServices,

        createAdminFunctionBundle,
        getAdminFunctionBundle,
        resetAdminFunctionBundle,

        createAdminCallableExports,

        /* ----------------------------------------------
           Admin auth service
        ---------------------------------------------- */

        createAdminAuthService,
        getAdminAuthService,
        resetAdminAuthService,

        AdminAuthServiceError,

        /* ----------------------------------------------
           Admin callable service
        ---------------------------------------------- */

        createAdminCallables,
        getAdminCallables,
        resetAdminCallables,

        AdminCallableError,

        /* ----------------------------------------------
           Claims
        ---------------------------------------------- */

        buildRoleClaims,
        removeAdminClaims,
        createAdministratorSnapshot,

        extractRoles,
        extractPermissions,
        isAdministratorClaims,
        hasPrivilegedRole,
        hasAllPermissions,
        permissionMatches,

        /* ----------------------------------------------
           Request normalization
        ---------------------------------------------- */

        normalizeRoleMutationRequest,
        normalizeRemovalRequest,
        normalizePermissionMutationRequest,
        normalizeClaimsPatchRequest,
        normalizeListRequest,
        normalizeActor,

        /* ----------------------------------------------
           General auth normalization
        ---------------------------------------------- */

        normalizeServiceOptions,
        normalizeUid,
        normalizeAdminRole,
        normalizeRole,
        normalizePermission,
        normalizeRoleList,
        normalizePermissionList,
        normalizeStringList,
        normalizeClaims,
        normalizeRequiredString,
        normalizeOptionalString,
        normalizeCollectionName,
        normalizePositiveInteger,
        normalizeRolePermissionMap,

        /* ----------------------------------------------
           Claim utilities
        ---------------------------------------------- */

        mergePermissionLists,
        validateClaimsSize,
        redactClaims,

        normalizeAdminAuthServiceError,

        /* ----------------------------------------------
           Callable helpers
        ---------------------------------------------- */

        createCallable,
        requireCallableAdministrator,
        createActorFromCallableContext,

        normalizeCallableData,
        normalizeListPayload,

        normalizeCallableRequiredString,
        normalizeCallableOptionalString,
        normalizeCallablePositiveInteger,

        sanitizeCallableClaims,
        createSafeActorSnapshot,

        toHttpsError,
        mapServiceErrorToHttpsCode,

        normalizeCallableOptions,
        normalizeRuntimeOptions,
        normalizeMemory,

        normalizeAdminCallableError,

        /* ----------------------------------------------
           Clone utilities
        ---------------------------------------------- */

        cloneValue,
        cloneAdminAuthValue,
        cloneAdminCallableValue,

        /* ----------------------------------------------
           Constants
        ---------------------------------------------- */

        constants
    });