"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ADMIN CALLABLE FUNCTIONS

   Responsibilities:
   - Securely expose administrator management operations
   - Require authenticated callable context
   - Validate administrator claims and permissions
   - Resolve the shared admin auth service
   - Normalize callable payloads
   - Return safe structured responses
   - Translate service errors into Firebase HttpsError values
========================================================== */

const functions =
    require(
        "firebase-functions"
    );

const {
    getAdminAuthService,
    AdminAuthServiceError
} =
    require(
        "./admin-auth-service"
    );

/* ==========================================================
   CONSTANTS
========================================================== */

const DEFAULT_REGION =
    "europe-west1";

const DEFAULT_RUNTIME_OPTIONS =
    Object.freeze({
        timeoutSeconds:
            60,

        memory:
            "256MB"
    });

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

/* ==========================================================
   ERROR
========================================================== */

class AdminCallableError extends Error {
    constructor(
        code,
        message,
        options
    ) {
        super(
            message ||
            "Administrator callable operation failed."
        );

        this.name =
            "AdminCallableError";

        this.code =
            code ||
            "admin-callables/unknown";

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

/* ==========================================================
   CALLABLE FACTORY
========================================================== */

function createAdminCallables(
    options
) {
    const settings =
        normalizeCallableOptions(
            options
        );

    const service =
        settings.service ||
        getAdminAuthService(
            settings.serviceOptions
        );

    if (
        !service
    ) {
        throw new AdminCallableError(
            "admin-callables/service-unavailable",
            "Administrator authorization service is unavailable."
        );
    }

    /* ======================================================
       LIST ADMINISTRATORS
    ====================================================== */

    const listAdministrators =
        createCallable(
            settings,
            CALLABLE_NAMES.listAdministrators,
            async function (
                data,
                context
            ) {
                const actor =
                    await requireCallableAdministrator(
                        service,
                        context,
                        [
                            "admins.read"
                        ]
                    );

                const request =
                    normalizeListPayload(
                        data
                    );

                const result =
                    await service
                        .listAdministrators(
                            request
                        );

                return {
                    success:
                        true,

                    actor:
                        createSafeActorSnapshot(
                            actor
                        ),

                    administrators:
                        result.administrators,

                    count:
                        result.count,

                    nextPageToken:
                        result.nextPageToken ||
                        null
                };
            }
        );

    /* ======================================================
       GET ADMINISTRATOR
    ====================================================== */

    const getAdministrator =
        createCallable(
            settings,
            CALLABLE_NAMES.getAdministrator,
            async function (
                data,
                context
            ) {
                const actor =
                    await requireCallableAdministrator(
                        service,
                        context,
                        [
                            "admins.read"
                        ]
                    );

                const uid =
                    normalizeRequiredString(
                        data &&
                        (
                            data.uid ||
                            data.targetUid
                        ),
                        "Administrator user ID"
                    );

                const administrator =
                    await service
                        .getAdministrator(
                            uid
                        );

                return {
                    success:
                        true,

                    actor:
                        createSafeActorSnapshot(
                            actor
                        ),

                    administrator
                };
            }
        );

    /* ======================================================
       SET ROLE
    ====================================================== */

    const setAdministratorRole =
        createCallable(
            settings,
            CALLABLE_NAMES.setAdministratorRole,
            async function (
                data,
                context
            ) {
                const actor =
                    await requireCallableAdministrator(
                        service,
                        context,
                        [
                            "admins.write"
                        ]
                    );

                const result =
                    await service
                        .setAdministratorRole({
                            uid:
                                data &&
                                (
                                    data.uid ||
                                    data.targetUid
                                ),

                            role:
                                data &&
                                data.role,

                            permissions:
                                data &&
                                data.permissions,

                            replacePermissions:
                                Boolean(
                                    data &&
                                    data.replacePermissions
                                ),

                            reason:
                                data &&
                                data.reason,

                            actor
                        });

                return {
                    success:
                        true,

                    administrator:
                        result.administrator,

                    auditId:
                        result.auditId ||
                        null
                };
            }
        );

    /* ======================================================
       REMOVE ROLE
    ====================================================== */

    const removeAdministratorRole =
        createCallable(
            settings,
            CALLABLE_NAMES.removeAdministratorRole,
            async function (
                data,
                context
            ) {
                const actor =
                    await requireCallableAdministrator(
                        service,
                        context,
                        [
                            "admins.write"
                        ]
                    );

                const result =
                    await service
                        .removeAdministratorRole({
                            uid:
                                data &&
                                (
                                    data.uid ||
                                    data.targetUid
                                ),

                            preservePermissions:
                                Boolean(
                                    data &&
                                    data.preservePermissions
                                ),

                            reason:
                                data &&
                                data.reason,

                            actor
                        });

                return {
                    success:
                        true,

                    administrator:
                        result.administrator,

                    auditId:
                        result.auditId ||
                        null
                };
            }
        );

    /* ======================================================
       GRANT PERMISSIONS
    ====================================================== */

    const grantAdministratorPermissions =
        createCallable(
            settings,
            CALLABLE_NAMES.grantAdministratorPermissions,
            async function (
                data,
                context
            ) {
                const actor =
                    await requireCallableAdministrator(
                        service,
                        context,
                        [
                            "admins.write"
                        ]
                    );

                const result =
                    await service
                        .grantPermissions({
                            uid:
                                data &&
                                (
                                    data.uid ||
                                    data.targetUid
                                ),

                            permissions:
                                data &&
                                (
                                    data.permissions ||
                                    data.permission
                                ),

                            reason:
                                data &&
                                data.reason,

                            actor
                        });

                return {
                    success:
                        true,

                    administrator:
                        result.administrator,

                    auditId:
                        result.auditId ||
                        null
                };
            }
        );

    /* ======================================================
       REVOKE PERMISSIONS
    ====================================================== */

    const revokeAdministratorPermissions =
        createCallable(
            settings,
            CALLABLE_NAMES.revokeAdministratorPermissions,
            async function (
                data,
                context
            ) {
                const actor =
                    await requireCallableAdministrator(
                        service,
                        context,
                        [
                            "admins.write"
                        ]
                    );

                const result =
                    await service
                        .revokePermissions({
                            uid:
                                data &&
                                (
                                    data.uid ||
                                    data.targetUid
                                ),

                            permissions:
                                data &&
                                (
                                    data.permissions ||
                                    data.permission
                                ),

                            reason:
                                data &&
                                data.reason,

                            actor
                        });

                return {
                    success:
                        true,

                    administrator:
                        result.administrator,

                    auditId:
                        result.auditId ||
                        null
                };
            }
        );

    /* ======================================================
       PATCH CLAIMS
    ====================================================== */

    const patchAdministratorClaims =
        createCallable(
            settings,
            CALLABLE_NAMES.patchAdministratorClaims,
            async function (
                data,
                context
            ) {
                const actor =
                    await requireCallableAdministrator(
                        service,
                        context,
                        [
                            "admins.write"
                        ]
                    );

                if (
                    settings.allowRawClaimsPatch !==
                    true
                ) {
                    throw new AdminCallableError(
                        "admin-callables/raw-claims-disabled",
                        "Raw administrator claims patching is disabled."
                    );
                }

                const result =
                    await service
                        .patchCustomClaims({
                            uid:
                                data &&
                                (
                                    data.uid ||
                                    data.targetUid
                                ),

                            claims:
                                data &&
                                data.claims,

                            replace:
                                Boolean(
                                    data &&
                                    data.replace
                                ),

                            allowSelfMutation:
                                Boolean(
                                    data &&
                                    data.allowSelfMutation
                                ),

                            reason:
                                data &&
                                data.reason,

                            actor
                        });

                return {
                    success:
                        true,

                    administrator:
                        result.administrator,

                    auditId:
                        result.auditId ||
                        null
                };
            }
        );

    return Object.freeze({
        listAdministrators,
        getAdministrator,
        setAdministratorRole,
        removeAdministratorRole,
        grantAdministratorPermissions,
        revokeAdministratorPermissions,
        patchAdministratorClaims,

        service,
        options:
            settings
    });
}

/* ==========================================================
   CALLABLE WRAPPER
========================================================== */

function createCallable(
    settings,
    name,
    handler
) {
    if (
        typeof handler !==
        "function"
    ) {
        throw new TypeError(
            "Callable handler must be a function."
        );
    }

    const wrappedHandler =
        async function (
            data,
            context
        ) {
            try {
                return await handler(
                    normalizeCallableData(
                        data
                    ),
                    context ||
                    {}
                );
            } catch (
                error
            ) {
                throw toHttpsError(
                    error,
                    name
                );
            }
        };

    if (
        settings.rawHandlers ===
        true
    ) {
        return wrappedHandler;
    }

    let builder =
        functions;

    if (
        settings.region
    ) {
        builder =
            builder.region(
                settings.region
            );
    }

    if (
        settings.runtimeOptions &&
        Object.keys(
            settings.runtimeOptions
        ).length
    ) {
        builder =
            builder.runWith(
                settings.runtimeOptions
            );
    }

    return builder.https
        .onCall(
            wrappedHandler
        );
}

/* ==========================================================
   CALLABLE AUTHORIZATION
========================================================== */

async function requireCallableAdministrator(
    service,
    context,
    permissions
) {
    const actor =
        createActorFromCallableContext(
            context
        );

    if (
        !actor.uid
    ) {
        throw new AdminCallableError(
            "admin-callables/unauthenticated",
            "Authentication is required."
        );
    }

    try {
        return await service
            .authorizeActor(
                actor,
                permissions
            );
    } catch (
        error
    ) {
        throw normalizeAdminCallableError(
            error,
            "admin-callables/authorization-failed",
            "Administrator authorization failed."
        );
    }
}

function createActorFromCallableContext(
    context
) {
    const source =
        context ||
        {};

    const auth =
        source.auth ||
        null;

    const token =
        auth &&
        auth.token &&
        typeof auth.token ===
            "object"
            ? auth.token
            : {};

    return {
        uid:
            auth &&
            auth.uid
                ? String(
                      auth.uid
                  )
                : null,

        email:
            token.email
                ? String(
                      token.email
                  )
                : null,

        displayName:
            token.name
                ? String(
                      token.name
                  )
                : null,

        claims:
            sanitizeCallableClaims(
                token
            )
    };
}

/* ==========================================================
   PAYLOAD NORMALIZATION
========================================================== */

function normalizeCallableData(
    data
) {
    if (
        !data ||
        typeof data !==
            "object" ||
        Array.isArray(
            data
        )
    ) {
        return {};
    }

    return data;
}

function normalizeListPayload(
    data
) {
    const source =
        normalizeCallableData(
            data
        );

    return {
        pageSize:
            normalizePositiveInteger(
                source.pageSize,
                1000,
                1000,
                "Page size"
            ),

        pageToken:
            normalizeOptionalString(
                source.pageToken
            ),

        fetchAll:
            source.fetchAll !==
            false
    };
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
        throw new AdminCallableError(
            "admin-callables/invalid-argument",
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

function normalizePositiveInteger(
    value,
    fallback,
    maximum,
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
            0 ||
        normalized >
            maximum
    ) {
        throw new AdminCallableError(
            "admin-callables/invalid-argument",
            (
                label ||
                "Value"
            ) +
            " must be a positive integer no greater than " +
            maximum +
            "."
        );
    }

    return normalized;
}

/* ==========================================================
   CLAIM SANITIZATION
========================================================== */

function sanitizeCallableClaims(
    token
) {
    const source =
        token &&
        typeof token ===
            "object"
            ? token
            : {};

    const excluded =
        new Set([
            "aud",
            "auth_time",
            "email",
            "email_verified",
            "exp",
            "firebase",
            "iat",
            "iss",
            "name",
            "phone_number",
            "picture",
            "sub",
            "user_id"
        ]);

    const claims =
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
            excluded.has(
                key
            )
        ) {
            continue;
        }

        claims[
            key
        ] =
            cloneValue(
                value
            );
    }

    return claims;
}

/* ==========================================================
   SAFE RESPONSE
========================================================== */

function createSafeActorSnapshot(
    actor
) {
    const source =
        actor ||
        {};

    return {
        uid:
            source.uid ||
            null,

        email:
            source.email ||
            null,

        displayName:
            source.displayName ||
            null,

        roles:
            Array.isArray(
                source.roles
            )
                ? cloneValue(
                      source.roles
                  )
                : [],

        permissions:
            Array.isArray(
                source.permissions
            )
                ? cloneValue(
                      source.permissions
                  )
                : []
    };
}

/* ==========================================================
   HTTPS ERROR MAPPING
========================================================== */

function toHttpsError(
    error,
    operation
) {
    if (
        error &&
        error.name ===
            "HttpsError"
    ) {
        return error;
    }

    const normalized =
        normalizeAdminCallableError(
            error,
            "admin-callables/internal",
            "Administrator operation failed."
        );

    const code =
        mapServiceErrorToHttpsCode(
            normalized.code
        );

    const details = {
        code:
            normalized.code,

        operation:
            operation ||
            null
    };

    if (
        normalized.details
    ) {
        details.details =
            cloneValue(
                normalized.details
            );
    }

    return new functions.https.HttpsError(
        code,
        normalized.message,
        details
    );
}

function mapServiceErrorToHttpsCode(
    code
) {
    const normalized =
        String(
            code ||
            ""
        ).toLowerCase();

    if (
        normalized.includes(
            "unauthenticated"
        )
    ) {
        return "unauthenticated";
    }

    if (
        normalized.includes(
            "permission-denied"
        ) ||
        normalized.includes(
            "admin-required"
        ) ||
        normalized.includes(
            "privileged-role-required"
        ) ||
        normalized.includes(
            "self-mutation-denied"
        ) ||
        normalized.includes(
            "raw-claims-disabled"
        )
    ) {
        return "permission-denied";
    }

    if (
        normalized.includes(
            "user-not-found"
        )
    ) {
        return "not-found";
    }

    if (
        normalized.includes(
            "uid-required"
        ) ||
        normalized.includes(
            "invalid-role"
        ) ||
        normalized.includes(
            "permissions-required"
        ) ||
        normalized.includes(
            "claims-required"
        ) ||
        normalized.includes(
            "invalid-argument"
        )
    ) {
        return "invalid-argument";
    }

    if (
        normalized.includes(
            "claims-too-large"
        )
    ) {
        return "resource-exhausted";
    }

    if (
        normalized.includes(
            "final-owner"
        )
    ) {
        return "failed-precondition";
    }

    if (
        normalized.includes(
            "already"
        )
    ) {
        return "already-exists";
    }

    if (
        normalized.includes(
            "unavailable"
        )
    ) {
        return "unavailable";
    }

    return "internal";
}

/* ==========================================================
   OPTIONS
========================================================== */

function normalizeCallableOptions(
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

        rawHandlers:
            source.rawHandlers ===
            true,

        allowRawClaimsPatch:
            source.allowRawClaimsPatch ===
            true,

        service:
            source.service ||
            null,

        serviceOptions:
            source.serviceOptions ||
            null,

        runtimeOptions:
            Object.freeze(
                normalizeRuntimeOptions(
                    source.runtimeOptions
                )
            )
    });
}

function normalizeRuntimeOptions(
    input
) {
    const source =
        input &&
        typeof input ===
            "object" &&
        !Array.isArray(
            input
        )
            ? input
            : {};

    return {
        timeoutSeconds:
            normalizePositiveInteger(
                source.timeoutSeconds,
                DEFAULT_RUNTIME_OPTIONS
                    .timeoutSeconds,
                540,
                "Runtime timeout"
            ),

        memory:
            normalizeMemory(
                source.memory ||
                DEFAULT_RUNTIME_OPTIONS
                    .memory
            )
    };
}

function normalizeMemory(
    value
) {
    const allowed = [
        "128MB",
        "256MB",
        "512MB",
        "1GB",
        "2GB",
        "4GB",
        "8GB"
    ];

    const normalized =
        String(
            value ||
            DEFAULT_RUNTIME_OPTIONS
                .memory
        )
            .trim()
            .toUpperCase();

    if (
        !allowed.includes(
            normalized
        )
    ) {
        throw new AdminCallableError(
            "admin-callables/invalid-memory",
            "Callable memory configuration is invalid."
        );
    }

    return normalized;
}

/* ==========================================================
   ERROR NORMALIZATION
========================================================== */

function normalizeAdminCallableError(
    error,
    fallbackCode,
    fallbackMessage
) {
    if (
        error instanceof
        AdminCallableError
    ) {
        return error;
    }

    if (
        error instanceof
        AdminAuthServiceError
    ) {
        return new AdminCallableError(
            error.code,
            error.message,
            {
                details:
                    error.details,

                originalError:
                    error
            }
        );
    }

    return new AdminCallableError(
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
                    ? cloneValue(
                          error.details
                      )
                    : null,

            originalError:
                error
        }
    );
}

/* ==========================================================
   CLONE
========================================================== */

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

/* ==========================================================
   DEFAULT INSTANCE
========================================================== */

let defaultCallables =
    null;

function getAdminCallables(
    options
) {
    if (
        options
    ) {
        return createAdminCallables(
            options
        );
    }

    if (
        !defaultCallables
    ) {
        defaultCallables =
            createAdminCallables();
    }

    return defaultCallables;
}

function resetAdminCallables() {
    defaultCallables =
        null;
}

/* ==========================================================
   EXPORT
========================================================== */

module.exports =
    Object.freeze({
        createAdminCallables,
        getAdminCallables,
        resetAdminCallables,

        AdminCallableError,

        createCallable,
        requireCallableAdministrator,
        createActorFromCallableContext,

        normalizeCallableData,
        normalizeListPayload,
        normalizeRequiredString,
        normalizeOptionalString,
        normalizePositiveInteger,

        sanitizeCallableClaims,
        createSafeActorSnapshot,

        toHttpsError,
        mapServiceErrorToHttpsCode,

        normalizeCallableOptions,
        normalizeRuntimeOptions,
        normalizeMemory,

        normalizeAdminCallableError,
        cloneValue,

        constants:
            Object.freeze({
                DEFAULT_REGION,
                DEFAULT_RUNTIME_OPTIONS,
                CALLABLE_NAMES
            })
    });