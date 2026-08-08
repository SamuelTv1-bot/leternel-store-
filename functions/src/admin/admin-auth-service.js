"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ADMIN AUTH SERVICE

   Responsibilities:
   - Validate privileged administrator callers
   - Read and normalize Firebase custom claims
   - Assign, update, and remove administrator roles
   - Grant and revoke granular permissions
   - Preserve unrelated custom claims
   - Prevent accidental removal of the final owner
   - Write immutable administrator audit records
   - Support injectable Firebase Admin dependencies for tests
========================================================== */

const DEFAULT_USERS_COLLECTION =
    "users";

const DEFAULT_AUDIT_COLLECTION =
    "adminAuditLogs";

const DEFAULT_AUDIT_EVENT =
    "admin.claims.updated";

const DEFAULT_ROLE =
    "admin";

const DEFAULT_MAX_CLAIM_BYTES =
    900;

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

/* ==========================================================
   ERROR
========================================================== */

class AdminAuthServiceError extends Error {
    constructor(
        code,
        message,
        options
    ) {
        super(
            message ||
            "Administrator authorization operation failed."
        );

        this.name =
            "AdminAuthServiceError";

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

/* ==========================================================
   SERVICE FACTORY
========================================================== */

function createAdminAuthService(
    options
) {
    const settings =
        normalizeServiceOptions(
            options
        );

    const admin =
        settings.admin ||
        resolveFirebaseAdmin();

    const auth =
        settings.auth ||
        resolveAdminAuth(
            admin
        );

    const firestore =
        settings.firestore ||
        resolveAdminFirestore(
            admin
        );

    if (
        !auth ||
        typeof auth.getUser !==
            "function" ||
        typeof auth.setCustomUserClaims !==
            "function"
    ) {
        throw new AdminAuthServiceError(
            "admin-auth/auth-unavailable",
            "Firebase Admin Authentication is unavailable."
        );
    }

    if (
        !firestore ||
        typeof firestore.collection !==
            "function"
    ) {
        throw new AdminAuthServiceError(
            "admin-auth/firestore-unavailable",
            "Firebase Admin Firestore is unavailable."
        );
    }

    /* ======================================================
       READ
    ====================================================== */

    async function getAdministrator(
        uid
    ) {
        const normalizedUid =
            normalizeUid(
                uid
            );

        try {
            const user =
                await auth.getUser(
                    normalizedUid
                );

            return createAdministratorSnapshot(
                user,
                settings.rolePermissions
            );
        } catch (
            error
        ) {
            throw normalizeAdminAuthServiceError(
                error,
                "admin-auth/user-read-failed",
                "Unable to load administrator account."
            );
        }
    }

    async function listAdministrators(
        input
    ) {
        const request =
            normalizeListRequest(
                input
            );

        const administrators =
            [];

        let pageToken =
            request.pageToken;

        do {
            const result =
                await auth.listUsers(
                    request.pageSize,
                    pageToken ||
                    undefined
                );

            for (
                const user of
                result.users ||
                []
            ) {
                const snapshot =
                    createAdministratorSnapshot(
                        user,
                        settings.rolePermissions
                    );

                if (
                    snapshot.isAdministrator
                ) {
                    administrators.push(
                        snapshot
                    );
                }
            }

            pageToken =
                result.pageToken ||
                null;
        } while (
            request.fetchAll &&
            pageToken
        );

        administrators.sort(
            function (
                first,
                second
            ) {
                return String(
                    first.email ||
                    first.uid
                ).localeCompare(
                    String(
                        second.email ||
                        second.uid
                    )
                );
            }
        );

        return {
            administrators,
            count:
                administrators.length,

            nextPageToken:
                request.fetchAll
                    ? null
                    : pageToken
        };
    }

    /* ======================================================
       SET ROLE
    ====================================================== */

    async function setAdministratorRole(
        input
    ) {
        const request =
            normalizeRoleMutationRequest(
                input
            );

        const actor =
            await authorizeActor(
                request.actor,
                [
                    "admins.write"
                ]
            );

        enforcePrivilegedRoleAssignment(
            actor,
            request.role
        );

        const target =
            await auth.getUser(
                request.uid
            );

        const previousClaims =
            normalizeClaims(
                target.customClaims
            );

        const nextClaims =
            buildRoleClaims(
                previousClaims,
                request.role,
                request.permissions,
                {
                    replacePermissions:
                        request.replacePermissions,

                    rolePermissions:
                        settings.rolePermissions
                }
            );

        validateClaimsSize(
            nextClaims,
            settings.maxClaimBytes
        );

        await auth.setCustomUserClaims(
            request.uid,
            nextClaims
        );

        await syncUserProfile(
            request.uid,
            {
                adminRole:
                    request.role,

                adminRoles:
                    nextClaims.roles,

                adminPermissions:
                    nextClaims.permissions,

                isAdmin:
                    true,

                adminUpdatedAt:
                    createServerTimestamp(
                        admin
                    ),

                adminUpdatedBy:
                    actor.uid
            }
        );

        const audit =
            await writeAuditLog({
                actor,
                target,
                action:
                    "admin.role.set",

                previousClaims,
                nextClaims,

                metadata: {
                    role:
                        request.role,

                    replacePermissions:
                        request.replacePermissions,

                    reason:
                        request.reason
                }
            });

        return {
            success:
                true,

            administrator:
                await getAdministrator(
                    request.uid
                ),

            auditId:
                audit.id
        };
    }

    /* ======================================================
       REMOVE ROLE
    ====================================================== */

    async function removeAdministratorRole(
        input
    ) {
        const request =
            normalizeRemovalRequest(
                input
            );

        const actor =
            await authorizeActor(
                request.actor,
                [
                    "admins.write"
                ]
            );

        const target =
            await auth.getUser(
                request.uid
            );

        const previousClaims =
            normalizeClaims(
                target.customClaims
            );

        if (
            hasPrivilegedRole(
                extractRoles(
                    previousClaims
                )
            )
        ) {
            await assertAnotherPrivilegedAdministratorExists(
                request.uid
            );
        }

        const nextClaims =
            removeAdminClaims(
                previousClaims,
                {
                    preservePermissions:
                        request.preservePermissions
                }
            );

        validateClaimsSize(
            nextClaims,
            settings.maxClaimBytes
        );

        await auth.setCustomUserClaims(
            request.uid,
            nextClaims
        );

        await syncUserProfile(
            request.uid,
            {
                adminRole:
                    null,

                adminRoles:
                    [],

                adminPermissions:
                    request.preservePermissions
                        ? normalizePermissionList(
                              nextClaims.permissions
                          )
                        : [],

                isAdmin:
                    false,

                adminRemovedAt:
                    createServerTimestamp(
                        admin
                    ),

                adminRemovedBy:
                    actor.uid
            }
        );

        const audit =
            await writeAuditLog({
                actor,
                target,
                action:
                    "admin.role.removed",

                previousClaims,
                nextClaims,

                metadata: {
                    preservePermissions:
                        request.preservePermissions,

                    reason:
                        request.reason
                }
            });

        return {
            success:
                true,

            administrator:
                await getAdministrator(
                    request.uid
                ),

            auditId:
                audit.id
        };
    }

    /* ======================================================
       PERMISSIONS
    ====================================================== */

    async function grantPermissions(
        input
    ) {
        const request =
            normalizePermissionMutationRequest(
                input
            );

        const actor =
            await authorizeActor(
                request.actor,
                [
                    "admins.write"
                ]
            );

        const target =
            await auth.getUser(
                request.uid
            );

        const previousClaims =
            normalizeClaims(
                target.customClaims
            );

        const nextClaims =
            Object.assign(
                {},
                previousClaims,
                {
                    permissions:
                        mergePermissionLists(
                            extractPermissions(
                                previousClaims,
                                settings.rolePermissions
                            ),
                            request.permissions
                        )
                }
            );

        if (
            !extractRoles(
                nextClaims
            ).length
        ) {
            nextClaims.admin =
                true;

            nextClaims.role =
                DEFAULT_ROLE;

            nextClaims.roles =
                [
                    DEFAULT_ROLE
                ];
        }

        validateClaimsSize(
            nextClaims,
            settings.maxClaimBytes
        );

        await auth.setCustomUserClaims(
            request.uid,
            nextClaims
        );

        await syncUserProfile(
            request.uid,
            {
                adminPermissions:
                    nextClaims.permissions,

                isAdmin:
                    true,

                adminUpdatedAt:
                    createServerTimestamp(
                        admin
                    ),

                adminUpdatedBy:
                    actor.uid
            }
        );

        const audit =
            await writeAuditLog({
                actor,
                target,
                action:
                    "admin.permissions.granted",

                previousClaims,
                nextClaims,

                metadata: {
                    permissions:
                        request.permissions,

                    reason:
                        request.reason
                }
            });

        return {
            success:
                true,

            administrator:
                await getAdministrator(
                    request.uid
                ),

            auditId:
                audit.id
        };
    }

    async function revokePermissions(
        input
    ) {
        const request =
            normalizePermissionMutationRequest(
                input
            );

        const actor =
            await authorizeActor(
                request.actor,
                [
                    "admins.write"
                ]
            );

        const target =
            await auth.getUser(
                request.uid
            );

        const previousClaims =
            normalizeClaims(
                target.customClaims
            );

        const currentPermissions =
            extractPermissions(
                previousClaims,
                settings.rolePermissions
            );

        const revokeSet =
            new Set(
                request.permissions
            );

        const nextPermissions =
            currentPermissions.filter(
                function (
                    permission
                ) {
                    return !revokeSet.has(
                        permission
                    );
                }
            );

        const nextClaims =
            Object.assign(
                {},
                previousClaims,
                {
                    permissions:
                        nextPermissions
                }
            );

        validateClaimsSize(
            nextClaims,
            settings.maxClaimBytes
        );

        await auth.setCustomUserClaims(
            request.uid,
            nextClaims
        );

        await syncUserProfile(
            request.uid,
            {
                adminPermissions:
                    nextPermissions,

                adminUpdatedAt:
                    createServerTimestamp(
                        admin
                    ),

                adminUpdatedBy:
                    actor.uid
            }
        );

        const audit =
            await writeAuditLog({
                actor,
                target,
                action:
                    "admin.permissions.revoked",

                previousClaims,
                nextClaims,

                metadata: {
                    permissions:
                        request.permissions,

                    reason:
                        request.reason
                }
            });

        return {
            success:
                true,

            administrator:
                await getAdministrator(
                    request.uid
                ),

            auditId:
                audit.id
        };
    }

    /* ======================================================
       CLAIM PATCH
    ====================================================== */

    async function patchCustomClaims(
        input
    ) {
        const request =
            normalizeClaimsPatchRequest(
                input
            );

        const actor =
            await authorizeActor(
                request.actor,
                [
                    "admins.write"
                ]
            );

        if (
            request.uid ===
                actor.uid &&
            request.allowSelfMutation !==
                true
        ) {
            throw new AdminAuthServiceError(
                "admin-auth/self-mutation-denied",
                "Administrators cannot directly patch their own claims."
            );
        }

        const target =
            await auth.getUser(
                request.uid
            );

        const previousClaims =
            normalizeClaims(
                target.customClaims
            );

        const nextClaims =
            request.replace
                ? normalizeClaims(
                      request.claims
                  )
                : Object.assign(
                      {},
                      previousClaims,
                      normalizeClaims(
                          request.claims
                      )
                  );

        validateClaimsSize(
            nextClaims,
            settings.maxClaimBytes
        );

        await auth.setCustomUserClaims(
            request.uid,
            nextClaims
        );

        await syncUserProfile(
            request.uid,
            {
                adminRole:
                    extractRoles(
                        nextClaims
                    )[0] ||
                    null,

                adminRoles:
                    extractRoles(
                        nextClaims
                    ),

                adminPermissions:
                    extractPermissions(
                        nextClaims,
                        settings.rolePermissions
                    ),

                isAdmin:
                    isAdministratorClaims(
                        nextClaims
                    ),

                adminUpdatedAt:
                    createServerTimestamp(
                        admin
                    ),

                adminUpdatedBy:
                    actor.uid
            }
        );

        const audit =
            await writeAuditLog({
                actor,
                target,
                action:
                    request.replace
                        ? "admin.claims.replaced"
                        : "admin.claims.patched",

                previousClaims,
                nextClaims,

                metadata: {
                    reason:
                        request.reason
                }
            });

        return {
            success:
                true,

            administrator:
                await getAdministrator(
                    request.uid
                ),

            auditId:
                audit.id
        };
    }

    /* ======================================================
       ACTOR AUTHORIZATION
    ====================================================== */

    async function authorizeActor(
        actorInput,
        requiredPermissions
    ) {
        const actor =
            normalizeActor(
                actorInput
            );

        if (
            !actor.uid
        ) {
            throw new AdminAuthServiceError(
                "admin-auth/unauthenticated",
                "An authenticated administrator is required."
            );
        }

        const actorUser =
            await auth.getUser(
                actor.uid
            );

        const claims =
            normalizeClaims(
                actor.claims &&
                Object.keys(
                    actor.claims
                ).length
                    ? actor.claims
                    : actorUser.customClaims
            );

        const roles =
            extractRoles(
                claims
            );

        const permissions =
            extractPermissions(
                claims,
                settings.rolePermissions
            );

        if (
            !isAdministratorClaims(
                claims
            )
        ) {
            throw new AdminAuthServiceError(
                "admin-auth/admin-required",
                "Administrator privileges are required."
            );
        }

        if (
            !hasAllPermissions(
                permissions,
                requiredPermissions
            )
        ) {
            throw new AdminAuthServiceError(
                "admin-auth/permission-denied",
                "The administrator lacks the required permission.",
                {
                    details: {
                        requiredPermissions,
                        permissions
                    }
                }
            );
        }

        return {
            uid:
                actorUser.uid,

            email:
                actorUser.email ||
                actor.email ||
                null,

            displayName:
                actorUser.displayName ||
                actor.displayName ||
                null,

            roles,
            permissions,
            claims
        };
    }

    function enforcePrivilegedRoleAssignment(
        actor,
        role
    ) {
        if (
            !PRIVILEGED_ROLES.includes(
                role
            )
        ) {
            return;
        }

        if (
            !hasPrivilegedRole(
                actor.roles
            )
        ) {
            throw new AdminAuthServiceError(
                "admin-auth/privileged-role-required",
                "Only an owner or super administrator can assign privileged roles."
            );
        }
    }

    async function assertAnotherPrivilegedAdministratorExists(
        excludedUid
    ) {
        let pageToken =
            null;

        do {
            const result =
                await auth.listUsers(
                    1000,
                    pageToken ||
                    undefined
                );

            for (
                const user of
                result.users ||
                []
            ) {
                if (
                    user.uid ===
                    excludedUid
                ) {
                    continue;
                }

                if (
                    hasPrivilegedRole(
                        extractRoles(
                            user.customClaims
                        )
                    )
                ) {
                    return true;
                }
            }

            pageToken =
                result.pageToken ||
                null;
        } while (
            pageToken
        );

        throw new AdminAuthServiceError(
            "admin-auth/final-owner",
            "The final owner or super administrator cannot be removed."
        );
    }

    /* ======================================================
       USER PROFILE SYNC
    ====================================================== */

    async function syncUserProfile(
        uid,
        patch
    ) {
        if (
            settings.syncUserProfiles !==
            true
        ) {
            return null;
        }

        const reference =
            firestore
                .collection(
                    settings.usersCollection
                )
                .doc(
                    uid
                );

        await reference.set(
            Object.assign(
                {},
                patch,
                {
                    uid,
                    updatedAt:
                        createServerTimestamp(
                            admin
                        )
                }
            ),
            {
                merge:
                    true
            }
        );

        return reference;
    }

    /* ======================================================
       AUDIT
    ====================================================== */

    async function writeAuditLog(
        input
    ) {
        const source =
            input ||
            {};

        const reference =
            firestore
                .collection(
                    settings.auditCollection
                )
                .doc();

        const payload = {
            id:
                reference.id,

            event:
                settings.auditEvent,

            action:
                source.action ||
                settings.auditEvent,

            actor: {
                uid:
                    source.actor &&
                    source.actor.uid
                        ? source.actor.uid
                        : null,

                email:
                    source.actor &&
                    source.actor.email
                        ? source.actor.email
                        : null,

                displayName:
                    source.actor &&
                    source.actor.displayName
                        ? source.actor.displayName
                        : null,

                roles:
                    source.actor &&
                    source.actor.roles
                        ? cloneValue(
                              source.actor.roles
                          )
                        : [],

                permissions:
                    source.actor &&
                    source.actor.permissions
                        ? cloneValue(
                              source.actor.permissions
                          )
                        : []
            },

            target: {
                uid:
                    source.target &&
                    source.target.uid
                        ? source.target.uid
                        : null,

                email:
                    source.target &&
                    source.target.email
                        ? source.target.email
                        : null,

                displayName:
                    source.target &&
                    source.target.displayName
                        ? source.target.displayName
                        : null
            },

            previousClaims:
                redactClaims(
                    source.previousClaims
                ),

            nextClaims:
                redactClaims(
                    source.nextClaims
                ),

            metadata:
                cloneValue(
                    source.metadata ||
                    {}
                ),

            createdAt:
                createServerTimestamp(
                    admin
                )
        };

        await reference.set(
            payload
        );

        return {
            id:
                reference.id,

            payload
        };
    }

    /* ======================================================
       PUBLIC SERVICE
    ====================================================== */

    return Object.freeze({
        getAdministrator,
        listAdministrators,

        setAdministratorRole,
        removeAdministratorRole,

        grantPermissions,
        revokePermissions,
        patchCustomClaims,

        authorizeActor,
        writeAuditLog,

        options:
            settings
    });
}

/* ==========================================================
   CLAIM BUILDING
========================================================== */

function buildRoleClaims(
    currentClaims,
    role,
    permissions,
    options
) {
    const settings =
        options ||
        {};

    const normalizedRole =
        normalizeRole(
            role
        );

    const existing =
        normalizeClaims(
            currentClaims
        );

    const rolePermissions =
        settings.rolePermissions ||
        DEFAULT_ROLE_PERMISSIONS;

    const requestedPermissions =
        normalizePermissionList(
            permissions
        );

    const mappedPermissions =
        normalizePermissionList(
            rolePermissions[
                normalizedRole
            ]
        );

    const nextPermissions =
        settings.replacePermissions
            ? mergePermissionLists(
                  mappedPermissions,
                  requestedPermissions
              )
            : mergePermissionLists(
                  extractPermissions(
                      existing,
                      rolePermissions
                  ),
                  mappedPermissions,
                  requestedPermissions
              );

    return Object.assign(
        {},
        existing,
        {
            admin:
                true,

            isAdmin:
                true,

            role:
                normalizedRole,

            roles:
                [
                    normalizedRole
                ],

            permissions:
                nextPermissions
        }
    );
}

function removeAdminClaims(
    currentClaims,
    options
) {
    const settings =
        options ||
        {};

    const nextClaims =
        Object.assign(
            {},
            normalizeClaims(
                currentClaims
            )
        );

    delete nextClaims.admin;
    delete nextClaims.isAdmin;
    delete nextClaims.superAdmin;
    delete nextClaims.owner;
    delete nextClaims.adminRole;
    delete nextClaims.role;
    delete nextClaims.roles;
    delete nextClaims.adminPermissions;

    if (
        settings.preservePermissions !==
        true
    ) {
        delete nextClaims.permissions;
        delete nextClaims.permission;
        delete nextClaims.scopes;
    }

    return nextClaims;
}

/* ==========================================================
   SNAPSHOTS
========================================================== */

function createAdministratorSnapshot(
    user,
    rolePermissions
) {
    const claims =
        normalizeClaims(
            user.customClaims
        );

    const roles =
        extractRoles(
            claims
        );

    const permissions =
        extractPermissions(
            claims,
            rolePermissions
        );

    return {
        uid:
            user.uid,

        email:
            user.email ||
            null,

        displayName:
            user.displayName ||
            null,

        disabled:
            Boolean(
                user.disabled
            ),

        emailVerified:
            Boolean(
                user.emailVerified
            ),

        isAdministrator:
            isAdministratorClaims(
                claims
            ),

        roles,
        primaryRole:
            roles[0] ||
            null,

        permissions,

        claims:
            cloneValue(
                claims
            ),

        metadata: {
            creationTime:
                user.metadata &&
                user.metadata.creationTime
                    ? user.metadata.creationTime
                    : null,

            lastSignInTime:
                user.metadata &&
                user.metadata.lastSignInTime
                    ? user.metadata.lastSignInTime
                    : null
        }
    };
}

/* ==========================================================
   CLAIM EXTRACTION
========================================================== */

function extractRoles(
    claims
) {
    const source =
        normalizeClaims(
            claims
        );

    const roles =
        [];

    appendRole(
        roles,
        source.role
    );

    appendRole(
        roles,
        source.adminRole
    );

    appendRole(
        roles,
        source.userRole
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
        source.owner ===
        true
    ) {
        appendRole(
            roles,
            "owner"
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
        source.admin ===
            true ||
        source.isAdmin ===
            true
    ) {
        appendRole(
            roles,
            source.role ||
            DEFAULT_ROLE
        );
    }

    return Array.from(
        new Set(
            roles
        )
    );
}

function extractPermissions(
    claims,
    rolePermissions
) {
    const source =
        normalizeClaims(
            claims
        );

    const permissions =
        [];

    appendPermissions(
        permissions,
        source.permissions
    );

    appendPermissions(
        permissions,
        source.adminPermissions
    );

    appendPermissions(
        permissions,
        source.scopes
    );

    if (
        source.permission
    ) {
        appendPermissions(
            permissions,
            [
                source.permission
            ]
        );
    }

    const mapping =
        rolePermissions ||
        DEFAULT_ROLE_PERMISSIONS;

    for (
        const role of
        extractRoles(
            source
        )
    ) {
        appendPermissions(
            permissions,
            mapping[
                role
            ]
        );
    }

    const normalized =
        Array.from(
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

    return normalized.includes(
        "*"
    )
        ? [
              "*"
          ]
        : normalized;
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
            true ||
        source.owner ===
            true ||
        source.superAdmin ===
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

function hasPrivilegedRole(
    roles
) {
    return normalizeRoleList(
        roles
    ).some(
        function (
            role
        ) {
            return PRIVILEGED_ROLES.includes(
                role
            );
        }
    );
}

function hasAllPermissions(
    available,
    required
) {
    const availablePermissions =
        normalizePermissionList(
            available
        );

    const requiredPermissions =
        normalizePermissionList(
            required
        );

    if (
        availablePermissions.includes(
            "*"
        )
    ) {
        return true;
    }

    return requiredPermissions.every(
        function (
            permission
        ) {
            return permissionMatches(
                availablePermissions,
                permission
            );
        }
    );
}

function permissionMatches(
    available,
    required
) {
    if (
        available.includes(
            required
        )
    ) {
        return true;
    }

    const parts =
        required.split(
            "."
        );

    while (
        parts.length >
        1
    ) {
        parts.pop();

        if (
            available.includes(
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

/* ==========================================================
   REQUEST NORMALIZATION
========================================================== */

function normalizeRoleMutationRequest(
    input
) {
    const source =
        input ||
        {};

    return {
        uid:
            normalizeUid(
                source.uid ||
                source.targetUid
            ),

        role:
            normalizeAdminRole(
                source.role ||
                DEFAULT_ROLE
            ),

        permissions:
            normalizePermissionList(
                source.permissions
            ),

        replacePermissions:
            source.replacePermissions ===
            true,

        reason:
            normalizeOptionalString(
                source.reason
            ),

        actor:
            normalizeActor(
                source.actor ||
                {
                    uid:
                        source.actorUid,

                    claims:
                        source.actorClaims
                }
            )
    };
}

function normalizeRemovalRequest(
    input
) {
    const source =
        input ||
        {};

    return {
        uid:
            normalizeUid(
                source.uid ||
                source.targetUid
            ),

        preservePermissions:
            source.preservePermissions ===
            true,

        reason:
            normalizeOptionalString(
                source.reason
            ),

        actor:
            normalizeActor(
                source.actor ||
                {
                    uid:
                        source.actorUid,

                    claims:
                        source.actorClaims
                }
            )
    };
}

function normalizePermissionMutationRequest(
    input
) {
    const source =
        input ||
        {};

    const permissions =
        normalizePermissionList(
            source.permissions ||
            source.permission
        );

    if (
        !permissions.length
    ) {
        throw new AdminAuthServiceError(
            "admin-auth/permissions-required",
            "At least one permission is required."
        );
    }

    return {
        uid:
            normalizeUid(
                source.uid ||
                source.targetUid
            ),

        permissions,

        reason:
            normalizeOptionalString(
                source.reason
            ),

        actor:
            normalizeActor(
                source.actor ||
                {
                    uid:
                        source.actorUid,

                    claims:
                        source.actorClaims
                }
            )
    };
}

function normalizeClaimsPatchRequest(
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
        throw new AdminAuthServiceError(
            "admin-auth/claims-required",
            "A custom claims object is required."
        );
    }

    return {
        uid:
            normalizeUid(
                source.uid ||
                source.targetUid
            ),

        claims:
            normalizeClaims(
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
            ),

        actor:
            normalizeActor(
                source.actor ||
                {
                    uid:
                        source.actorUid,

                    claims:
                        source.actorClaims
                }
            )
    };
}

function normalizeListRequest(
    input
) {
    const source =
        input ||
        {};

    return {
        pageSize:
            normalizePositiveInteger(
                source.pageSize,
                1000,
                "Page size",
                1000
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

function normalizeActor(
    input
) {
    const source =
        input ||
        {};

    return {
        uid:
            normalizeOptionalString(
                source.uid
            ),

        email:
            normalizeOptionalString(
                source.email
            ),

        displayName:
            normalizeOptionalString(
                source.displayName
            ),

        claims:
            normalizeClaims(
                source.claims
            )
    };
}

/* ==========================================================
   SERVICE OPTIONS
========================================================== */

function normalizeServiceOptions(
    options
) {
    const source =
        options ||
        {};

    return Object.freeze({
        admin:
            source.admin ||
            null,

        auth:
            source.auth ||
            null,

        firestore:
            source.firestore ||
            null,

        usersCollection:
            normalizeCollectionName(
                source.usersCollection,
                DEFAULT_USERS_COLLECTION
            ),

        auditCollection:
            normalizeCollectionName(
                source.auditCollection,
                DEFAULT_AUDIT_COLLECTION
            ),

        auditEvent:
            normalizeRequiredString(
                source.auditEvent ||
                DEFAULT_AUDIT_EVENT,
                "Audit event"
            ),

        syncUserProfiles:
            source.syncUserProfiles !==
            false,

        maxClaimBytes:
            normalizePositiveInteger(
                source.maxClaimBytes,
                DEFAULT_MAX_CLAIM_BYTES,
                "Maximum claim bytes",
                1000
            ),

        rolePermissions:
            Object.freeze(
                normalizeRolePermissionMap(
                    Object.assign(
                        {},
                        DEFAULT_ROLE_PERMISSIONS,
                        source.rolePermissions ||
                        {}
                    )
                )
            )
    });
}

/* ==========================================================
   NORMALIZERS
========================================================== */

function normalizeUid(
    value
) {
    const normalized =
        String(
            value ||
            ""
        ).trim();

    if (
        !normalized
    ) {
        throw new AdminAuthServiceError(
            "admin-auth/uid-required",
            "A target user ID is required."
        );
    }

    return normalized;
}

function normalizeAdminRole(
    value
) {
    const normalized =
        normalizeRole(
            value
        );

    if (
        !ADMIN_ROLES.includes(
            normalized
        )
    ) {
        throw new AdminAuthServiceError(
            "admin-auth/invalid-role",
            "Administrator role is invalid.",
            {
                details: {
                    role:
                        normalized,

                    allowedRoles:
                        ADMIN_ROLES
                }
            }
        );
    }

    return normalized;
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

function normalizeRoleList(
    value
) {
    return normalizeStringList(
        value
    )
        .map(
            normalizeRole
        )
        .filter(
            Boolean
        );
}

function normalizePermissionList(
    value
) {
    return Array.from(
        new Set(
            normalizeStringList(
                value
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

function normalizeClaims(
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
        return {};
    }

    return cloneValue(
        value
    );
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
        throw new TypeError(
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

function normalizeCollectionName(
    value,
    fallback
) {
    const normalized =
        String(
            value ||
            fallback
        ).trim();

    if (
        !normalized ||
        normalized.includes(
            "/"
        )
    ) {
        throw new TypeError(
            "Firestore collection name is invalid."
        );
    }

    return normalized;
}

function normalizePositiveInteger(
    value,
    fallback,
    label,
    maximum
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
        (
            maximum &&
            normalized >
                maximum
        )
    ) {
        throw new TypeError(
            label +
            " must be a valid positive integer."
        );
    }

    return normalized;
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
            normalizePermissionList(
                permissions
            );
    }

    return output;
}

/* ==========================================================
   CLAIM UTILITIES
========================================================== */

function mergePermissionLists() {
    const output =
        [];

    for (
        const list of
        arguments
    ) {
        output.push.apply(
            output,
            normalizePermissionList(
                list
            )
        );
    }

    const unique =
        Array.from(
            new Set(
                output
            )
        );

    return unique.includes(
        "*"
    )
        ? [
              "*"
          ]
        : unique;
}

function appendRole(
    output,
    value
) {
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

function appendPermissions(
    output,
    value
) {
    output.push.apply(
        output,
        normalizePermissionList(
            value
        )
    );
}

function validateClaimsSize(
    claims,
    maximumBytes
) {
    const serialized =
        JSON.stringify(
            claims ||
            {}
        );

    const size =
        Buffer.byteLength(
            serialized,
            "utf8"
        );

    if (
        size >
        maximumBytes
    ) {
        throw new AdminAuthServiceError(
            "admin-auth/claims-too-large",
            "Custom claims exceed the configured size limit.",
            {
                details: {
                    size,
                    maximumBytes
                }
            }
        );
    }

    return size;
}

function redactClaims(
    claims
) {
    const output =
        cloneValue(
            claims ||
            {}
        );

    const sensitiveKeys = [
        "token",
        "accessToken",
        "refreshToken",
        "secret",
        "password",
        "apiKey"
    ];

    for (
        const key of
        sensitiveKeys
    ) {
        if (
            Object.prototype
                .hasOwnProperty
                .call(
                    output,
                    key
                )
        ) {
            output[
                key
            ] =
                "[REDACTED]";
        }
    }

    return output;
}

/* ==========================================================
   FIREBASE ADMIN
========================================================== */

function resolveFirebaseAdmin() {
    try {
        return require(
            "firebase-admin"
        );
    } catch (
        error
    ) {
        throw new AdminAuthServiceError(
            "admin-auth/firebase-admin-unavailable",
            "firebase-admin is unavailable.",
            {
                originalError:
                    error
            }
        );
    }
}

function resolveAdminAuth(
    admin
) {
    if (
        admin &&
        typeof admin.auth ===
        "function"
    ) {
        return admin.auth();
    }

    return null;
}

function resolveAdminFirestore(
    admin
) {
    if (
        admin &&
        typeof admin.firestore ===
        "function"
    ) {
        return admin.firestore();
    }

    return null;
}

function createServerTimestamp(
    admin
) {
    if (
        admin &&
        admin.firestore &&
        admin.firestore.FieldValue &&
        typeof admin.firestore
            .FieldValue
            .serverTimestamp ===
            "function"
    ) {
        return admin.firestore
            .FieldValue
            .serverTimestamp();
    }

    return new Date();
}

/* ==========================================================
   ERRORS
========================================================== */

function normalizeAdminAuthServiceError(
    error,
    fallbackCode,
    fallbackMessage
) {
    if (
        error instanceof
        AdminAuthServiceError
    ) {
        return error;
    }

    return new AdminAuthServiceError(
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

/* ==========================================================
   EXPORT
========================================================== */

module.exports =
    Object.freeze({
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
        cloneValue,

        constants:
            Object.freeze({
                DEFAULT_USERS_COLLECTION,
                DEFAULT_AUDIT_COLLECTION,
                DEFAULT_AUDIT_EVENT,
                DEFAULT_ROLE,
                DEFAULT_MAX_CLAIM_BYTES,
                ADMIN_ROLES,
                PRIVILEGED_ROLES,
                DEFAULT_ROLE_PERMISSIONS
            })
    });