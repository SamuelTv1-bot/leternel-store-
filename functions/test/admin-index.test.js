"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ADMIN MODULE INDEX TESTS

   Run with:
   node --test functions/test/admin-index.test.js
========================================================== */

const test =
    require(
        "node:test"
    );

const assert =
    require(
        "node:assert/strict"
    );

const adminModule =
    require(
        "../src/admin"
    );

/* ==========================================================
   EXPORT SURFACE
========================================================== */

test(
    "exports the admin authorization service module",
    function () {
        assert.ok(
            adminModule.adminAuthService
        );

        assert.equal(
            typeof adminModule.adminAuthService,
            "object"
        );
    }
);

test(
    "re-exports admin authorization service factories",
    function () {
        assert.equal(
            typeof adminModule.createAdminAuthService,
            "function"
        );

        assert.equal(
            typeof adminModule.getAdminAuthService,
            "function"
        );

        assert.equal(
            typeof adminModule.resetAdminAuthService,
            "function"
        );
    }
);

test(
    "re-exports the admin authorization service error",
    function () {
        assert.equal(
            typeof adminModule.AdminAuthServiceError,
            "function"
        );

        const error =
            new adminModule.AdminAuthServiceError(
                "admin-auth/test",
                "Test error."
            );

        assert.equal(
            error.name,
            "AdminAuthServiceError"
        );

        assert.equal(
            error.code,
            "admin-auth/test"
        );

        assert.equal(
            error.message,
            "Test error."
        );
    }
);

/* ==========================================================
   CLAIM BUILDERS
========================================================== */

test(
    "re-exports claim builders",
    function () {
        assert.equal(
            typeof adminModule.buildRoleClaims,
            "function"
        );

        assert.equal(
            typeof adminModule.removeAdminClaims,
            "function"
        );

        assert.equal(
            typeof adminModule.createAdministratorSnapshot,
            "function"
        );
    }
);

/* ==========================================================
   CLAIM INSPECTION
========================================================== */

test(
    "re-exports claim inspection helpers",
    function () {
        assert.equal(
            typeof adminModule.extractRoles,
            "function"
        );

        assert.equal(
            typeof adminModule.extractPermissions,
            "function"
        );

        assert.equal(
            typeof adminModule.isAdministratorClaims,
            "function"
        );

        assert.equal(
            typeof adminModule.hasPrivilegedRole,
            "function"
        );

        assert.equal(
            typeof adminModule.hasAllPermissions,
            "function"
        );

        assert.equal(
            typeof adminModule.permissionMatches,
            "function"
        );
    }
);

/* ==========================================================
   REQUEST NORMALIZATION
========================================================== */

test(
    "re-exports request normalization helpers",
    function () {
        assert.equal(
            typeof adminModule.normalizeRoleMutationRequest,
            "function"
        );

        assert.equal(
            typeof adminModule.normalizeRemovalRequest,
            "function"
        );

        assert.equal(
            typeof adminModule.normalizePermissionMutationRequest,
            "function"
        );

        assert.equal(
            typeof adminModule.normalizeClaimsPatchRequest,
            "function"
        );

        assert.equal(
            typeof adminModule.normalizeListRequest,
            "function"
        );

        assert.equal(
            typeof adminModule.normalizeActor,
            "function"
        );
    }
);

/* ==========================================================
   GENERAL NORMALIZATION
========================================================== */

test(
    "re-exports general normalization helpers",
    function () {
        const names = [
            "normalizeServiceOptions",
            "normalizeUid",
            "normalizeAdminRole",
            "normalizeRole",
            "normalizePermission",
            "normalizeRoleList",
            "normalizePermissionList",
            "normalizeStringList",
            "normalizeClaims",
            "normalizeRequiredString",
            "normalizeOptionalString",
            "normalizeCollectionName",
            "normalizePositiveInteger",
            "normalizeRolePermissionMap"
        ];

        for (
            const name of
            names
        ) {
            assert.equal(
                typeof adminModule[
                    name
                ],
                "function",
                name +
                " should be exported."
            );
        }
    }
);

/* ==========================================================
   CLAIM UTILITIES
========================================================== */

test(
    "re-exports claim utility helpers",
    function () {
        assert.equal(
            typeof adminModule.mergePermissionLists,
            "function"
        );

        assert.equal(
            typeof adminModule.validateClaimsSize,
            "function"
        );

        assert.equal(
            typeof adminModule.redactClaims,
            "function"
        );
    }
);

/* ==========================================================
   ERROR / CLONE
========================================================== */

test(
    "re-exports error and cloning helpers",
    function () {
        assert.equal(
            typeof adminModule.normalizeAdminAuthServiceError,
            "function"
        );

        assert.equal(
            typeof adminModule.cloneValue,
            "function"
        );
    }
);

/* ==========================================================
   CONSTANTS
========================================================== */

test(
    "exports aggregated admin constants",
    function () {
        assert.ok(
            adminModule.constants
        );

        assert.equal(
            adminModule.constants.DEFAULT_USERS_COLLECTION,
            "users"
        );

        assert.equal(
            adminModule.constants.DEFAULT_AUDIT_COLLECTION,
            "adminAuditLogs"
        );

        assert.equal(
            adminModule.constants.DEFAULT_AUDIT_EVENT,
            "admin.claims.updated"
        );

        assert.equal(
            adminModule.constants.DEFAULT_ROLE,
            "admin"
        );

        assert.equal(
            adminModule.constants.DEFAULT_MAX_CLAIM_BYTES,
            900
        );

        assert.ok(
            Array.isArray(
                adminModule.constants.ADMIN_ROLES
            )
        );

        assert.ok(
            adminModule.constants.ADMIN_ROLES.includes(
                "owner"
            )
        );

        assert.ok(
            Array.isArray(
                adminModule.constants.PRIVILEGED_ROLES
            )
        );

        assert.ok(
            adminModule.constants.PRIVILEGED_ROLES.includes(
                "super-admin"
            )
        );

        assert.ok(
            adminModule.constants.DEFAULT_ROLE_PERMISSIONS
        );
    }
);

test(
    "preserves nested adminAuth constants",
    function () {
        assert.ok(
            adminModule.constants.adminAuth
        );

        assert.equal(
            adminModule.constants.adminAuth.DEFAULT_ROLE,
            adminModule.constants.DEFAULT_ROLE
        );

        assert.deepEqual(
            adminModule.constants.adminAuth.ADMIN_ROLES,
            adminModule.constants.ADMIN_ROLES
        );

        assert.deepEqual(
            adminModule.constants.adminAuth.PRIVILEGED_ROLES,
            adminModule.constants.PRIVILEGED_ROLES
        );
    }
);

/* ==========================================================
   HELPER BEHAVIOUR THROUGH INDEX
========================================================== */

test(
    "claim helpers work correctly through admin module exports",
    function () {
        const claims =
            adminModule.buildRoleClaims(
                {
                    locale:
                        "en-GB"
                },
                "support",
                [
                    "products.read"
                ],
                {
                    rolePermissions:
                        adminModule.constants
                            .DEFAULT_ROLE_PERMISSIONS,

                    replacePermissions:
                        false
                }
            );

        assert.equal(
            claims.admin,
            true
        );

        assert.equal(
            claims.role,
            "support"
        );

        assert.equal(
            claims.locale,
            "en-GB"
        );

        assert.ok(
            claims.permissions.includes(
                "products.read"
            )
        );

        assert.ok(
            claims.permissions.includes(
                "orders.read"
            )
        );
    }
);

test(
    "permission matching works through admin module exports",
    function () {
        assert.equal(
            adminModule.permissionMatches(
                [
                    "orders.*"
                ],
                "orders.refund"
            ),
            true
        );

        assert.equal(
            adminModule.permissionMatches(
                [
                    "orders.read"
                ],
                "orders.write"
            ),
            false
        );

        assert.equal(
            adminModule.hasAllPermissions(
                [
                    "*"
                ],
                [
                    "admins.write",
                    "orders.refund"
                ]
            ),
            true
        );
    }
);

test(
    "role inspection works through admin module exports",
    function () {
        assert.deepEqual(
            adminModule.extractRoles({
                admin:
                    true,

                role:
                    "administrator"
            }),
            [
                "administrator"
            ]
        );

        assert.equal(
            adminModule.isAdministratorClaims({
                role:
                    "analyst"
            }),
            true
        );

        assert.equal(
            adminModule.hasPrivilegedRole([
                "admin",
                "owner"
            ]),
            true
        );
    }
);

test(
    "normalizers work through admin module exports",
    function () {
        assert.equal(
            adminModule.normalizeRole(
                "Super Admin"
            ),
            "super-admin"
        );

        assert.equal(
            adminModule.normalizePermission(
                " Orders.Write "
            ),
            "orders.write"
        );

        assert.deepEqual(
            adminModule.normalizePermissionList([
                "Orders.Read",
                "orders.read",
                "Orders.Write"
            ]),
            [
                "orders.read",
                "orders.write"
            ]
        );
    }
);

/* ==========================================================
   ADMIN SERVICE BUNDLE
========================================================== */

test(
    "exports admin service bundle helpers",
    function () {
        assert.equal(
            typeof adminModule.createAdminServices,
            "function"
        );

        assert.equal(
            typeof adminModule.getAdminServices,
            "function"
        );

        assert.equal(
            typeof adminModule.resetAdminServices,
            "function"
        );
    }
);

/* ==========================================================
   MOCKS FOR SERVICE BUNDLE
========================================================== */

function createMockAdmin() {
    function firestore() {
        return null;
    }

    firestore.FieldValue = {
        serverTimestamp() {
            return {
                __type:
                    "serverTimestamp"
            };
        }
    };

    return {
        firestore
    };
}

function createMockAuth() {
    return {
        async getUser(
            uid
        ) {
            return {
                uid,
                email:
                    null,
                displayName:
                    null,
                disabled:
                    false,
                emailVerified:
                    false,
                customClaims:
                    {},
                metadata:
                    {}
            };
        },

        async setCustomUserClaims() {
            return undefined;
        },

        async listUsers() {
            return {
                users:
                    []
            };
        }
    };
}

function createMockFirestore() {
    return {
        collection() {
            return {
                doc(
                    id
                ) {
                    return {
                        id:
                            id ||
                            "doc-1",

                        async set() {
                            return undefined;
                        }
                    };
                }
            };
        }
    };
}

/* ==========================================================
   CREATE ADMIN SERVICES
========================================================== */

test(
    "createAdminServices returns an immutable service bundle",
    function () {
        const services =
            adminModule.createAdminServices({
                admin:
                    createMockAdmin(),

                auth:
                    createMockAuth(),

                firestore:
                    createMockFirestore()
            });

        assert.ok(
            services
        );

        assert.ok(
            services.auth
        );

        assert.equal(
            typeof services.auth
                .getAdministrator,
            "function"
        );

        assert.equal(
            typeof services.auth
                .setAdministratorRole,
            "function"
        );

        assert.equal(
            typeof services.auth
                .removeAdministratorRole,
            "function"
        );

        assert.equal(
            Object.isFrozen(
                services
            ),
            true
        );
    }
);

test(
    "createAdminServices forwards nested auth options",
    function () {
        const services =
            adminModule.createAdminServices({
                auth: {
                    admin:
                        createMockAdmin(),

                    auth:
                        createMockAuth(),

                    firestore:
                        createMockFirestore(),

                    usersCollection:
                        "profiles",

                    auditCollection:
                        "auditRecords"
                }
            });

        assert.equal(
            services.auth.options
                .usersCollection,
            "profiles"
        );

        assert.equal(
            services.auth.options
                .auditCollection,
            "auditRecords"
        );
    }
);

/* ==========================================================
   DEFAULT SERVICE RESET
========================================================== */

test(
    "resetAdminServices clears the cached aggregate service",
    function () {
        adminModule.resetAdminServices();

        assert.doesNotThrow(
            function () {
                adminModule.resetAdminServices();
            }
        );
    }
);

/* ==========================================================
   MODULE IMMUTABILITY
========================================================== */

test(
    "admin module export surface is frozen",
    function () {
        assert.equal(
            Object.isFrozen(
                adminModule
            ),
            true
        );

        assert.equal(
            Object.isFrozen(
                adminModule.constants
            ),
            true
        );
    }
);

/* ==========================================================
   REFERENCE CONSISTENCY
========================================================== */

test(
    "direct re-exports reference the same admin auth implementation",
    function () {
        assert.equal(
            adminModule.createAdminAuthService,
            adminModule.adminAuthService
                .createAdminAuthService
        );

        assert.equal(
            adminModule.buildRoleClaims,
            adminModule.adminAuthService
                .buildRoleClaims
        );

        assert.equal(
            adminModule.extractRoles,
            adminModule.adminAuthService
                .extractRoles
        );

        assert.equal(
            adminModule.validateClaimsSize,
            adminModule.adminAuthService
                .validateClaimsSize
        );
    }
);