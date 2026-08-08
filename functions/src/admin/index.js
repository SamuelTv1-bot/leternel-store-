"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ADMIN MODULE INDEX

   Central export surface for:
   - Administrator authorization service
   - Administrator callable functions
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
   ADMIN AUTH SERVICE EXPORTS
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
   ADMIN CALLABLE EXPORTS
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
   AGGREGATED CONSTANTS
========================================================== */

const constants =
    Object.freeze({
        /* ----------------------------------------------
           Nested module constants
        ---------------------------------------------- */

        adminAuth:
            adminAuthConstants,

        adminCallables:
            adminCallableConstants,

        /* ----------------------------------------------
           Admin auth constants
        ---------------------------------------------- */

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

        /* ----------------------------------------------
           Callable constants
        ---------------------------------------------- */

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
   SERVICE BUNDLE
========================================================== */

function createAdminServices(
    options
) {
    const settings =
        options ||
        {};

    const authOptions =
        settings.auth ||
        settings.adminAuth ||
        settings;

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
   CALLABLE BUNDLE
========================================================== */

function createAdminFunctionBundle(
    options
) {
    const settings =
        options ||
        {};

    const services =
        settings.services ||
        (
            settings.service
                ? null
                : createAdminServices(
                      settings.serviceOptions ||
                      settings.adminServices ||
                      settings
                  )
        );

    const service =
        settings.service ||
        (
            services
                ? services.auth
                : null
        );

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

            service:
                service,

            serviceOptions:
                settings.serviceOptions ||
                null
        });

    return Object.freeze({
        services:
            services ||
            Object.freeze({
                auth:
                    service
            }),

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
   DEPLOYABLE CALLABLE EXPORT MAP
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
           Aggregated service bundle
        ---------------------------------------------- */

        createAdminServices,
        getAdminServices,
        resetAdminServices,

        /* ----------------------------------------------
           Aggregate service + callable bundle
        ---------------------------------------------- */

        createAdminFunctionBundle,
        getAdminFunctionBundle,
        resetAdminFunctionBundle,

        createAdminCallableExports,

        /* ----------------------------------------------
           Admin authorization service
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
           Claim builders
        ---------------------------------------------- */

        buildRoleClaims,
        removeAdminClaims,
        createAdministratorSnapshot,

        /* ----------------------------------------------
           Claim inspection
        ---------------------------------------------- */

        extractRoles,
        extractPermissions,
        isAdministratorClaims,
        hasPrivilegedRole,
        hasAllPermissions,
        permissionMatches,

        /* ----------------------------------------------
           Admin auth request normalization
        ---------------------------------------------- */

        normalizeRoleMutationRequest,
        normalizeRemovalRequest,
        normalizePermissionMutationRequest,
        normalizeClaimsPatchRequest,
        normalizeListRequest,
        normalizeActor,

        /* ----------------------------------------------
           General admin auth normalization
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

        /* ----------------------------------------------
           Callable construction
        ---------------------------------------------- */

        createCallable,
        requireCallableAdministrator,
        createActorFromCallableContext,

        /* ----------------------------------------------
           Callable payload helpers
        ---------------------------------------------- */

        normalizeCallableData,
        normalizeListPayload,

        normalizeCallableRequiredString,
        normalizeCallableOptionalString,
        normalizeCallablePositiveInteger,

        sanitizeCallableClaims,
        createSafeActorSnapshot,

        /* ----------------------------------------------
           Callable HTTPS errors
        ---------------------------------------------- */

        toHttpsError,
        mapServiceErrorToHttpsCode,

        normalizeCallableOptions,
        normalizeRuntimeOptions,
        normalizeMemory,

        normalizeAdminCallableError,

        /* ----------------------------------------------
           Error helpers
        ---------------------------------------------- */

        normalizeAdminAuthServiceError,

        /* ----------------------------------------------
           Clone helpers
        ---------------------------------------------- */

        cloneValue,
        cloneAdminAuthValue,
        cloneAdminCallableValue,

        /* ----------------------------------------------
           Constants
        ---------------------------------------------- */

        constants
    });