"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ADMIN AUTH SERVICE TESTS

   Run with:
   node --test functions/test/admin-auth-service.test.js
========================================================== */

const test =
    require(
        "node:test"
    );

const assert =
    require(
        "node:assert/strict"
    );

const {
    createAdminAuthService,
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

    constants
} =
    require(
        "../src/admin/admin-auth-service"
    );

/* ==========================================================
   MOCK HELPERS
========================================================== */

function createMockTimestamp() {
    return {
        __type:
            "serverTimestamp"
    };
}

function createMockAdmin() {
    function firestore() {
        throw new Error(
            "Mock admin.firestore() should not be called directly."
        );
    }

    firestore.FieldValue = {
        serverTimestamp:
            createMockTimestamp
    };

    return {
        firestore
    };
}

function createMockUser(
    input
) {
    const source =
        input ||
        {};

    return {
        uid:
            source.uid ||
            "user-1",

        email:
            source.email ||
            null,

        displayName:
            source.displayName ||
            null,

        disabled:
            Boolean(
                source.disabled
            ),

        emailVerified:
            Boolean(
                source.emailVerified
            ),

        customClaims:
            cloneValue(
                source.customClaims ||
                {}
            ),

        metadata:
            Object.assign(
                {
                    creationTime:
                        "2026-01-01T00:00:00.000Z",

                    lastSignInTime:
                        "2026-02-01T00:00:00.000Z"
                },
                source.metadata ||
                {}
            )
    };
}

function createMockAuth(
    initialUsers
) {
    const users =
        new Map();

    const setClaimsCalls =
        [];

    const getUserCalls =
        [];

    const listUsersCalls =
        [];

    for (
        const user of
        initialUsers ||
        []
    ) {
        users.set(
            user.uid,
            cloneValue(
                user
            )
        );
    }

    async function getUser(
        uid
    ) {
        getUserCalls.push(
            uid
        );

        const user =
            users.get(
                uid
            );

        if (
            !user
        ) {
            const error =
                new Error(
                    "User not found."
                );

            error.code =
                "auth/user-not-found";

            throw error;
        }

        return cloneValue(
            user
        );
    }

    async function setCustomUserClaims(
        uid,
        claims
    ) {
        setClaimsCalls.push({
            uid,
            claims:
                cloneValue(
                    claims
                )
        });

        const user =
            users.get(
                uid
            );

        if (
            !user
        ) {
            const error =
                new Error(
                    "User not found."
                );

            error.code =
                "auth/user-not-found";

            throw error;
        }

        user.customClaims =
            cloneValue(
                claims
            );
    }

    async function listUsers(
        pageSize,
        pageToken
    ) {
        listUsersCalls.push({
            pageSize,
            pageToken:
                pageToken ||
                null
        });

        const values =
            Array.from(
                users.values()
            );

        const start =
            pageToken
                ? Number(
                      pageToken
                  )
                : 0;

        const end =
            Math.min(
                start +
                pageSize,
                values.length
            );

        return {
            users:
                values
                    .slice(
                        start,
                        end
                    )
                    .map(
                        cloneValue
                    ),

            pageToken:
                end <
                values.length
                    ? String(
                          end
                      )
                    : undefined
        };
    }

    return {
        getUser,
        setCustomUserClaims,
        listUsers,

        users,
        setClaimsCalls,
        getUserCalls,
        listUsersCalls
    };
}

function createMockFirestore() {
    const collections =
        new Map();

    const writes =
        [];

    function ensureCollection(
        name
    ) {
        if (
            !collections.has(
                name
            )
        ) {
            collections.set(
                name,
                new Map()
            );
        }

        return collections.get(
            name
        );
    }

    function collection(
        name
    ) {
        const store =
            ensureCollection(
                name
            );

        return {
            doc(
                id
            ) {
                const documentId =
                    id ||
                    "doc-" +
                    (
                        store.size +
                        1
                    );

                return {
                    id:
                        documentId,

                    async set(
                        value,
                        options
                    ) {
                        const existing =
                            store.get(
                                documentId
                            ) ||
                            {};

                        const nextValue =
                            options &&
                            options.merge
                                ? Object.assign(
                                      {},
                                      existing,
                                      cloneValue(
                                          value
                                      )
                                  )
                                : cloneValue(
                                      value
                                  );

                        store.set(
                            documentId,
                            nextValue
                        );

                        writes.push({
                            collection:
                                name,

                            id:
                                documentId,

                            value:
                                cloneValue(
                                    value
                                ),

                            options:
                                cloneValue(
                                    options ||
                                    null
                                )
                        });
                    },

                    async get() {
                        const value =
                            store.get(
                                documentId
                            );

                        return {
                            exists:
                                Boolean(
                                    value
                                ),

                            id:
                                documentId,

                            data() {
                                return cloneValue(
                                    value
                                );
                            }
                        };
                    }
                };
            }
        };
    }

    return {
        collection,
        collections,
        writes
    };
}

function createServiceFixture(
    input
) {
    const source =
        input ||
        {};

    const admin =
        createMockAdmin();

    const auth =
        createMockAuth(
            source.users ||
            []
        );

    const firestore =
        createMockFirestore();

    const service =
        createAdminAuthService({
            admin,
            auth,
            firestore,

            syncUserProfiles:
                source.syncUserProfiles !==
                false,

            maxClaimBytes:
                source.maxClaimBytes ||
                constants.DEFAULT_MAX_CLAIM_BYTES,

            rolePermissions:
                source.rolePermissions ||
                undefined
        });

    return {
        admin,
        auth,
        firestore,
        service
    };
}

function ownerClaims() {
    return {
        admin:
            true,

        role:
            "owner",

        roles: [
            "owner"
        ],

        permissions: [
            "*"
        ]
    };
}

function administratorClaims() {
    return {
        admin:
            true,

        role:
            "administrator",

        roles: [
            "administrator"
        ],

        permissions: [
            "admins.write",
            "admins.read",
            "admin.access"
        ]
    };
}

function adminClaims() {
    return {
        admin:
            true,

        role:
            "admin",

        roles: [
            "admin"
        ],

        permissions: [
            "admin.access"
        ]
    };
}

/* ==========================================================
   CONSTANTS
========================================================== */

test(
    "exports expected administrator constants",
    function () {
        assert.equal(
            constants.DEFAULT_USERS_COLLECTION,
            "users"
        );

        assert.equal(
            constants.DEFAULT_AUDIT_COLLECTION,
            "adminAuditLogs"
        );

        assert.equal(
            constants.DEFAULT_ROLE,
            "admin"
        );

        assert.ok(
            constants.ADMIN_ROLES.includes(
                "owner"
            )
        );

        assert.ok(
            constants.PRIVILEGED_ROLES.includes(
                "super-admin"
            )
        );

        assert.deepEqual(
            constants.DEFAULT_ROLE_PERMISSIONS.owner,
            [
                "*"
            ]
        );
    }
);

/* ==========================================================
   BASIC NORMALIZATION
========================================================== */

test(
    "normalizes roles and permissions",
    function () {
        assert.equal(
            normalizeRole(
                "Super Admin"
            ),
            "super-admin"
        );

        assert.equal(
            normalizeRole(
                "catalogue_manager"
            ),
            "catalogue-manager"
        );

        assert.equal(
            normalizePermission(
                " Products.Write "
            ),
            "products.write"
        );

        assert.deepEqual(
            normalizeRoleList([
                "Admin",
                "SUPER ADMIN"
            ]),
            [
                "admin",
                "super-admin"
            ]
        );

        assert.deepEqual(
            normalizePermissionList([
                "Orders.Read",
                "orders.read",
                " orders.write "
            ]),
            [
                "orders.read",
                "orders.write"
            ]
        );
    }
);

test(
    "normalizes string lists from strings, arrays, and values",
    function () {
        assert.deepEqual(
            normalizeStringList(
                "admin, owner support"
            ),
            [
                "admin",
                "owner",
                "support"
            ]
        );

        assert.deepEqual(
            normalizeStringList([
                "admin",
                "",
                null,
                "owner"
            ]),
            [
                "admin",
                "owner"
            ]
        );

        assert.deepEqual(
            normalizeStringList(
                42
            ),
            [
                "42"
            ]
        );

        assert.deepEqual(
            normalizeStringList(
                null
            ),
            []
        );
    }
);

test(
    "normalizes claims and protects against invalid claim values",
    function () {
        assert.deepEqual(
            normalizeClaims({
                admin:
                    true
            }),
            {
                admin:
                    true
            }
        );

        assert.deepEqual(
            normalizeClaims(
                null
            ),
            {}
        );

        assert.deepEqual(
            normalizeClaims([
                "admin"
            ]),
            {}
        );
    }
);

test(
    "normalizes required and optional strings",
    function () {
        assert.equal(
            normalizeRequiredString(
                "  Admin  ",
                "Role"
            ),
            "Admin"
        );

        assert.equal(
            normalizeOptionalString(
                "  note "
            ),
            "note"
        );

        assert.equal(
            normalizeOptionalString(
                " "
            ),
            null
        );

        assert.throws(
            function () {
                normalizeRequiredString(
                    "",
                    "Role"
                );
            },
            /Role is required/
        );
    }
);

test(
    "normalizes collection names",
    function () {
        assert.equal(
            normalizeCollectionName(
                "admins",
                "users"
            ),
            "admins"
        );

        assert.equal(
            normalizeCollectionName(
                "",
                "users"
            ),
            "users"
        );

        assert.throws(
            function () {
                normalizeCollectionName(
                    "users/admins",
                    "users"
                );
            },
            /collection name is invalid/i
        );
    }
);

test(
    "normalizes positive integers",
    function () {
        assert.equal(
            normalizePositiveInteger(
                undefined,
                10,
                "Page size",
                100
            ),
            10
        );

        assert.equal(
            normalizePositiveInteger(
                25,
                10,
                "Page size",
                100
            ),
            25
        );

        assert.throws(
            function () {
                normalizePositiveInteger(
                    0,
                    10,
                    "Page size",
                    100
                );
            },
            /valid positive integer/
        );

        assert.throws(
            function () {
                normalizePositiveInteger(
                    101,
                    10,
                    "Page size",
                    100
                );
            },
            /valid positive integer/
        );
    }
);

test(
    "normalizes valid administrator roles and rejects invalid roles",
    function () {
        assert.equal(
            normalizeAdminRole(
                "Super Admin"
            ),
            "super-admin"
        );

        assert.throws(
            function () {
                normalizeAdminRole(
                    "customer"
                );
            },
            function (
                error
            ) {
                assert.ok(
                    error instanceof
                    AdminAuthServiceError
                );

                assert.equal(
                    error.code,
                    "admin-auth/invalid-role"
                );

                return true;
            }
        );
    }
);

test(
    "requires valid user IDs",
    function () {
        assert.equal(
            normalizeUid(
                " user-1 "
            ),
            "user-1"
        );

        assert.throws(
            function () {
                normalizeUid(
                    ""
                );
            },
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "admin-auth/uid-required"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   ROLE PERMISSION MAP
========================================================== */

test(
    "normalizes role permission maps",
    function () {
        assert.deepEqual(
            normalizeRolePermissionMap({
                "Super Admin": [
                    "*"
                ],

                Support: [
                    "Orders.Read",
                    "customers.read"
                ]
            }),
            {
                "super-admin": [
                    "*"
                ],

                support: [
                    "orders.read",
                    "customers.read"
                ]
            }
        );
    }
);

/* ==========================================================
   CLAIM EXTRACTION
========================================================== */

test(
    "extracts roles from supported claim formats",
    function () {
        assert.deepEqual(
            extractRoles({
                role:
                    "admin",

                roles: [
                    "support",
                    "admin"
                ],

                owner:
                    true
            }),
            [
                "admin",
                "support",
                "owner"
            ]
        );

        assert.deepEqual(
            extractRoles({
                admin:
                    true
            }),
            [
                "admin"
            ]
        );

        assert.deepEqual(
            extractRoles({
                superAdmin:
                    true
            }),
            [
                "super-admin"
            ]
        );
    }
);

test(
    "extracts explicit and role-derived permissions",
    function () {
        const permissions =
            extractPermissions(
                {
                    role:
                        "support",

                    permissions: [
                        "products.read"
                    ],

                    scopes:
                        "orders.write customers.read"
                },
                constants.DEFAULT_ROLE_PERMISSIONS
            );

        assert.ok(
            permissions.includes(
                "products.read"
            )
        );

        assert.ok(
            permissions.includes(
                "orders.write"
            )
        );

        assert.ok(
            permissions.includes(
                "customers.read"
            )
        );

        assert.ok(
            permissions.includes(
                "admin.access"
            )
        );
    }
);

test(
    "collapses owner permissions to wildcard",
    function () {
        assert.deepEqual(
            extractPermissions(
                {
                    role:
                        "owner",

                    permissions: [
                        "orders.read"
                    ]
                },
                constants.DEFAULT_ROLE_PERMISSIONS
            ),
            [
                "*"
            ]
        );
    }
);

test(
    "detects administrator claims",
    function () {
        assert.equal(
            isAdministratorClaims({
                admin:
                    true
            }),
            true
        );

        assert.equal(
            isAdministratorClaims({
                role:
                    "analyst"
            }),
            true
        );

        assert.equal(
            isAdministratorClaims({
                role:
                    "customer"
            }),
            false
        );

        assert.equal(
            isAdministratorClaims({}),
            false
        );
    }
);

test(
    "detects privileged administrator roles",
    function () {
        assert.equal(
            hasPrivilegedRole([
                "admin",
                "owner"
            ]),
            true
        );

        assert.equal(
            hasPrivilegedRole([
                "administrator"
            ]),
            false
        );
    }
);

/* ==========================================================
   PERMISSION MATCHING
========================================================== */

test(
    "matches exact and wildcard permissions",
    function () {
        assert.equal(
            permissionMatches(
                [
                    "orders.read"
                ],
                "orders.read"
            ),
            true
        );

        assert.equal(
            permissionMatches(
                [
                    "orders.*"
                ],
                "orders.refund"
            ),
            true
        );

        assert.equal(
            permissionMatches(
                [
                    "admin.*"
                ],
                "admin.users.write"
            ),
            true
        );

        assert.equal(
            permissionMatches(
                [
                    "orders.read"
                ],
                "orders.write"
            ),
            false
        );
    }
);

test(
    "requires all requested permissions",
    function () {
        assert.equal(
            hasAllPermissions(
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

        assert.equal(
            hasAllPermissions(
                [
                    "admins.*",
                    "orders.read"
                ],
                [
                    "admins.write",
                    "orders.read"
                ]
            ),
            true
        );

        assert.equal(
            hasAllPermissions(
                [
                    "admins.read"
                ],
                [
                    "admins.write"
                ]
            ),
            false
        );
    }
);

/* ==========================================================
   CLAIM BUILDING
========================================================== */

test(
    "builds role claims while preserving unrelated claims",
    function () {
        const claims =
            buildRoleClaims(
                {
                    locale:
                        "en-GB",

                    marketing:
                        true,

                    permissions: [
                        "legacy.read"
                    ]
                },
                "support",
                [
                    "products.read"
                ],
                {
                    replacePermissions:
                        false,

                    rolePermissions:
                        constants.DEFAULT_ROLE_PERMISSIONS
                }
            );

        assert.equal(
            claims.admin,
            true
        );

        assert.equal(
            claims.isAdmin,
            true
        );

        assert.equal(
            claims.role,
            "support"
        );

        assert.deepEqual(
            claims.roles,
            [
                "support"
            ]
        );

        assert.equal(
            claims.locale,
            "en-GB"
        );

        assert.equal(
            claims.marketing,
            true
        );

        assert.ok(
            claims.permissions.includes(
                "legacy.read"
            )
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
    "replaces existing permissions when requested",
    function () {
        const claims =
            buildRoleClaims(
                {
                    permissions: [
                        "legacy.read"
                    ]
                },
                "analyst",
                [
                    "reports.export"
                ],
                {
                    replacePermissions:
                        true,

                    rolePermissions:
                        constants.DEFAULT_ROLE_PERMISSIONS
                }
            );

        assert.equal(
            claims.permissions.includes(
                "legacy.read"
            ),
            false
        );

        assert.equal(
            claims.permissions.includes(
                "reports.export"
            ),
            true
        );

        assert.equal(
            claims.permissions.includes(
                "dashboard.read"
            ),
            true
        );
    }
);

test(
    "removes administrator claims while preserving unrelated claims",
    function () {
        const claims =
            removeAdminClaims(
                {
                    locale:
                        "en-GB",

                    admin:
                        true,

                    isAdmin:
                        true,

                    role:
                        "admin",

                    roles: [
                        "admin"
                    ],

                    permissions: [
                        "orders.read"
                    ]
                }
            );

        assert.deepEqual(
            claims,
            {
                locale:
                    "en-GB"
            }
        );
    }
);

test(
    "can preserve permissions while removing administrator role claims",
    function () {
        const claims =
            removeAdminClaims(
                {
                    admin:
                        true,

                    role:
                        "admin",

                    roles: [
                        "admin"
                    ],

                    permissions: [
                        "reports.read"
                    ]
                },
                {
                    preservePermissions:
                        true
                }
            );

        assert.deepEqual(
            claims,
            {
                permissions: [
                    "reports.read"
                ]
            }
        );
    }
);

/* ==========================================================
   CLAIM UTILITIES
========================================================== */

test(
    "merges and deduplicates permission lists",
    function () {
        assert.deepEqual(
            mergePermissionLists(
                [
                    "orders.read"
                ],
                [
                    "orders.read",
                    "orders.write"
                ]
            ),
            [
                "orders.read",
                "orders.write"
            ]
        );

        assert.deepEqual(
            mergePermissionLists(
                [
                    "orders.read"
                ],
                [
                    "*"
                ]
            ),
            [
                "*"
            ]
        );
    }
);

test(
    "validates claim byte size",
    function () {
        const size =
            validateClaimsSize(
                {
                    admin:
                        true
                },
                100
            );

        assert.ok(
            size >
            0
        );

        assert.throws(
            function () {
                validateClaimsSize(
                    {
                        value:
                            "x".repeat(
                                100
                            )
                    },
                    20
                );
            },
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "admin-auth/claims-too-large"
                );

                return true;
            }
        );
    }
);

test(
    "redacts sensitive top-level claim values",
    function () {
        assert.deepEqual(
            redactClaims({
                admin:
                    true,

                apiKey:
                    "secret-key",

                password:
                    "secret-password",

                locale:
                    "en-GB"
            }),
            {
                admin:
                    true,

                apiKey:
                    "[REDACTED]",

                password:
                    "[REDACTED]",

                locale:
                    "en-GB"
            }
        );
    }
);

/* ==========================================================
   SNAPSHOT
========================================================== */

test(
    "creates administrator snapshots",
    function () {
        const snapshot =
            createAdministratorSnapshot(
                createMockUser({
                    uid:
                        "owner-1",

                    email:
                        "owner@example.com",

                    displayName:
                        "Store Owner",

                    emailVerified:
                        true,

                    customClaims:
                        ownerClaims()
                }),
                constants.DEFAULT_ROLE_PERMISSIONS
            );

        assert.equal(
            snapshot.uid,
            "owner-1"
        );

        assert.equal(
            snapshot.email,
            "owner@example.com"
        );

        assert.equal(
            snapshot.displayName,
            "Store Owner"
        );

        assert.equal(
            snapshot.isAdministrator,
            true
        );

        assert.equal(
            snapshot.primaryRole,
            "owner"
        );

        assert.deepEqual(
            snapshot.permissions,
            [
                "*"
            ]
        );

        assert.equal(
            snapshot.emailVerified,
            true
        );
    }
);

/* ==========================================================
   REQUEST NORMALIZATION
========================================================== */

test(
    "normalizes role mutation requests",
    function () {
        const request =
            normalizeRoleMutationRequest({
                targetUid:
                    " user-2 ",

                role:
                    "Super Admin",

                permissions: [
                    "Orders.Refund"
                ],

                replacePermissions:
                    true,

                reason:
                    "Promotion",

                actorUid:
                    "owner-1",

                actorClaims:
                    ownerClaims()
            });

        assert.equal(
            request.uid,
            "user-2"
        );

        assert.equal(
            request.role,
            "super-admin"
        );

        assert.deepEqual(
            request.permissions,
            [
                "orders.refund"
            ]
        );

        assert.equal(
            request.replacePermissions,
            true
        );

        assert.equal(
            request.actor.uid,
            "owner-1"
        );
    }
);

test(
    "normalizes removal requests",
    function () {
        const request =
            normalizeRemovalRequest({
                uid:
                    "admin-1",

                preservePermissions:
                    true,

                actor: {
                    uid:
                        "owner-1"
                }
            });

        assert.equal(
            request.uid,
            "admin-1"
        );

        assert.equal(
            request.preservePermissions,
            true
        );

        assert.equal(
            request.actor.uid,
            "owner-1"
        );
    }
);

test(
    "normalizes permission mutation requests",
    function () {
        const request =
            normalizePermissionMutationRequest({
                uid:
                    "admin-1",

                permission:
                    "Orders.Refund",

                actorUid:
                    "owner-1"
            });

        assert.deepEqual(
            request.permissions,
            [
                "orders.refund"
            ]
        );

        assert.throws(
            function () {
                normalizePermissionMutationRequest({
                    uid:
                        "admin-1",

                    permissions:
                        []
                });
            },
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "admin-auth/permissions-required"
                );

                return true;
            }
        );
    }
);

test(
    "normalizes claims patch requests",
    function () {
        const request =
            normalizeClaimsPatchRequest({
                uid:
                    "admin-1",

                claims: {
                    custom:
                        true
                },

                replace:
                    true,

                actorUid:
                    "owner-1"
            });

        assert.equal(
            request.replace,
            true
        );

        assert.deepEqual(
            request.claims,
            {
                custom:
                    true
            }
        );

        assert.throws(
            function () {
                normalizeClaimsPatchRequest({
                    uid:
                        "admin-1",

                    claims:
                        null
                });
            },
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "admin-auth/claims-required"
                );

                return true;
            }
        );
    }
);

test(
    "normalizes administrator list requests",
    function () {
        assert.deepEqual(
            normalizeListRequest({}),
            {
                pageSize:
                    1000,

                pageToken:
                    null,

                fetchAll:
                    true
            }
        );

        assert.deepEqual(
            normalizeListRequest({
                pageSize:
                    50,

                pageToken:
                    "50",

                fetchAll:
                    false
            }),
            {
                pageSize:
                    50,

                pageToken:
                    "50",

                fetchAll:
                    false
            }
        );
    }
);

test(
    "normalizes actors",
    function () {
        assert.deepEqual(
            normalizeActor({
                uid:
                    " owner-1 ",

                email:
                    " owner@example.com ",

                claims:
                    ownerClaims()
            }),
            {
                uid:
                    "owner-1",

                email:
                    "owner@example.com",

                displayName:
                    null,

                claims:
                    ownerClaims()
            }
        );
    }
);

/* ==========================================================
   SERVICE OPTIONS
========================================================== */

test(
    "normalizes service options",
    function () {
        const options =
            normalizeServiceOptions({
                usersCollection:
                    "profiles",

                auditCollection:
                    "audit",

                syncUserProfiles:
                    false,

                maxClaimBytes:
                    800,

                rolePermissions: {
                    custom: [
                        "custom.read"
                    ]
                }
            });

        assert.equal(
            options.usersCollection,
            "profiles"
        );

        assert.equal(
            options.auditCollection,
            "audit"
        );

        assert.equal(
            options.syncUserProfiles,
            false
        );

        assert.equal(
            options.maxClaimBytes,
            800
        );

        assert.deepEqual(
            options.rolePermissions.custom,
            [
                "custom.read"
            ]
        );
    }
);

/* ==========================================================
   SERVICE CONSTRUCTION
========================================================== */

test(
    "requires Firebase Admin Authentication",
    function () {
        assert.throws(
            function () {
                createAdminAuthService({
                    admin:
                        createMockAdmin(),

                    auth:
                        {},

                    firestore:
                        createMockFirestore()
                });
            },
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "admin-auth/auth-unavailable"
                );

                return true;
            }
        );
    }
);

test(
    "requires Firestore",
    function () {
        const auth =
            createMockAuth([]);

        assert.throws(
            function () {
                createAdminAuthService({
                    admin:
                        createMockAdmin(),

                    auth,

                    firestore:
                        {}
                });
            },
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "admin-auth/firestore-unavailable"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   GET ADMINISTRATOR
========================================================== */

test(
    "loads and normalizes an administrator account",
    async function () {
        const fixture =
            createServiceFixture({
                users: [
                    createMockUser({
                        uid:
                            "admin-1",

                        email:
                            "admin@example.com",

                        customClaims:
                            administratorClaims()
                    })
                ]
            });

        const administrator =
            await fixture.service
                .getAdministrator(
                    "admin-1"
                );

        assert.equal(
            administrator.uid,
            "admin-1"
        );

        assert.equal(
            administrator.isAdministrator,
            true
        );

        assert.equal(
            administrator.primaryRole,
            "administrator"
        );

        assert.ok(
            administrator.permissions.includes(
                "admins.write"
            )
        );
    }
);

test(
    "normalizes getAdministrator errors",
    async function () {
        const fixture =
            createServiceFixture();

        await assert.rejects(
            fixture.service
                .getAdministrator(
                    "missing-user"
                ),
            function (
                error
            ) {
                assert.ok(
                    error instanceof
                    AdminAuthServiceError
                );

                assert.equal(
                    error.code,
                    "auth/user-not-found"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   LIST ADMINISTRATORS
========================================================== */

test(
    "lists only administrator accounts",
    async function () {
        const fixture =
            createServiceFixture({
                users: [
                    createMockUser({
                        uid:
                            "customer-1",

                        email:
                            "customer@example.com"
                    }),

                    createMockUser({
                        uid:
                            "admin-1",

                        email:
                            "z-admin@example.com",

                        customClaims:
                            adminClaims()
                    }),

                    createMockUser({
                        uid:
                            "owner-1",

                        email:
                            "a-owner@example.com",

                        customClaims:
                            ownerClaims()
                    })
                ]
            });

        const result =
            await fixture.service
                .listAdministrators();

        assert.equal(
            result.count,
            2
        );

        assert.deepEqual(
            result.administrators.map(
                function (
                    administrator
                ) {
                    return administrator.uid;
                }
            ),
            [
                "owner-1",
                "admin-1"
            ]
        );

        assert.equal(
            result.nextPageToken,
            null
        );
    }
);

test(
    "supports paginated administrator listing",
    async function () {
        const fixture =
            createServiceFixture({
                users: [
                    createMockUser({
                        uid:
                            "admin-1",

                        customClaims:
                            adminClaims()
                    }),

                    createMockUser({
                        uid:
                            "admin-2",

                        customClaims:
                            adminClaims()
                    }),

                    createMockUser({
                        uid:
                            "admin-3",

                        customClaims:
                            adminClaims()
                    })
                ]
            });

        const result =
            await fixture.service
                .listAdministrators({
                    pageSize:
                        2,

                    fetchAll:
                        false
                });

        assert.equal(
            result.count,
            2
        );

        assert.equal(
            result.nextPageToken,
            "2"
        );

        assert.equal(
            fixture.auth
                .listUsersCalls
                .length,
            1
        );
    }
);

/* ==========================================================
   ACTOR AUTHORIZATION
========================================================== */

test(
    "authorizes actors with required permissions",
    async function () {
        const fixture =
            createServiceFixture({
                users: [
                    createMockUser({
                        uid:
                            "owner-1",

                        email:
                            "owner@example.com",

                        customClaims:
                            ownerClaims()
                    })
                ]
            });

        const actor =
            await fixture.service
                .authorizeActor(
                    {
                        uid:
                            "owner-1"
                    },
                    [
                        "admins.write"
                    ]
                );

        assert.equal(
            actor.uid,
            "owner-1"
        );

        assert.deepEqual(
            actor.roles,
            [
                "owner"
            ]
        );

        assert.deepEqual(
            actor.permissions,
            [
                "*"
            ]
        );
    }
);

test(
    "rejects unauthenticated actors",
    async function () {
        const fixture =
            createServiceFixture();

        await assert.rejects(
            fixture.service
                .authorizeActor(
                    {},
                    [
                        "admins.write"
                    ]
                ),
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "admin-auth/unauthenticated"
                );

                return true;
            }
        );
    }
);

test(
    "rejects actors without administrator claims",
    async function () {
        const fixture =
            createServiceFixture({
                users: [
                    createMockUser({
                        uid:
                            "customer-1"
                    })
                ]
            });

        await assert.rejects(
            fixture.service
                .authorizeActor(
                    {
                        uid:
                            "customer-1"
                    },
                    [
                        "admins.write"
                    ]
                ),
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "admin-auth/admin-required"
                );

                return true;
            }
        );
    }
);

test(
    "rejects administrators without required permissions",
    async function () {
        const fixture =
            createServiceFixture({
                users: [
                    createMockUser({
                        uid:
                            "admin-1",

                        customClaims:
                            adminClaims()
                    })
                ]
            });

        await assert.rejects(
            fixture.service
                .authorizeActor(
                    {
                        uid:
                            "admin-1"
                    },
                    [
                        "admins.write"
                    ]
                ),
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "admin-auth/permission-denied"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   SET ROLE
========================================================== */

test(
    "sets an administrator role, syncs profile, and writes audit log",
    async function () {
        const fixture =
            createServiceFixture({
                users: [
                    createMockUser({
                        uid:
                            "owner-1",

                        email:
                            "owner@example.com",

                        displayName:
                            "Store Owner",

                        customClaims:
                            ownerClaims()
                    }),

                    createMockUser({
                        uid:
                            "user-2",

                        email:
                            "user@example.com",

                        customClaims: {
                            locale:
                                "en-GB"
                        }
                    })
                ]
            });

        const result =
            await fixture.service
                .setAdministratorRole({
                    uid:
                        "user-2",

                    role:
                        "support",

                    permissions: [
                        "products.read"
                    ],

                    actor: {
                        uid:
                            "owner-1"
                    },

                    reason:
                        "Customer care team"
                });

        assert.equal(
            result.success,
            true
        );

        assert.equal(
            result.administrator.uid,
            "user-2"
        );

        assert.equal(
            result.administrator.primaryRole,
            "support"
        );

        assert.equal(
            fixture.auth
                .setClaimsCalls
                .length,
            1
        );

        const claimWrite =
            fixture.auth
                .setClaimsCalls[0];

        assert.equal(
            claimWrite.uid,
            "user-2"
        );

        assert.equal(
            claimWrite.claims.admin,
            true
        );

        assert.equal(
            claimWrite.claims.locale,
            "en-GB"
        );

        assert.ok(
            claimWrite.claims
                .permissions
                .includes(
                    "products.read"
                )
        );

        const userProfile =
            fixture.firestore
                .collections
                .get(
                    "users"
                )
                .get(
                    "user-2"
                );

        assert.equal(
            userProfile.adminRole,
            "support"
        );

        assert.equal(
            userProfile.isAdmin,
            true
        );

        const auditLogs =
            fixture.firestore
                .collections
                .get(
                    "adminAuditLogs"
                );

        assert.equal(
            auditLogs.size,
            1
        );

        const audit =
            Array.from(
                auditLogs.values()
            )[0];

        assert.equal(
            audit.action,
            "admin.role.set"
        );

        assert.equal(
            audit.actor.uid,
            "owner-1"
        );

        assert.equal(
            audit.target.uid,
            "user-2"
        );

        assert.equal(
            audit.metadata.reason,
            "Customer care team"
        );
    }
);

test(
    "requires privileged actor to assign owner or super-admin roles",
    async function () {
        const fixture =
            createServiceFixture({
                users: [
                    createMockUser({
                        uid:
                            "administrator-1",

                        customClaims:
                            administratorClaims()
                    }),

                    createMockUser({
                        uid:
                            "user-2"
                    })
                ]
            });

        await assert.rejects(
            fixture.service
                .setAdministratorRole({
                    uid:
                        "user-2",

                    role:
                        "owner",

                    actor: {
                        uid:
                            "administrator-1"
                    }
                }),
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "admin-auth/privileged-role-required"
                );

                return true;
            }
        );

        assert.equal(
            fixture.auth
                .setClaimsCalls
                .length,
            0
        );
    }
);

test(
    "allows an owner to assign another owner",
    async function () {
        const fixture =
            createServiceFixture({
                users: [
                    createMockUser({
                        uid:
                            "owner-1",

                        customClaims:
                            ownerClaims()
                    }),

                    createMockUser({
                        uid:
                            "user-2"
                    })
                ]
            });

        const result =
            await fixture.service
                .setAdministratorRole({
                    uid:
                        "user-2",

                    role:
                        "owner",

                    actor: {
                        uid:
                            "owner-1"
                    }
                });

        assert.equal(
            result.administrator.primaryRole,
            "owner"
        );

        assert.deepEqual(
            result.administrator.permissions,
            [
                "*"
            ]
        );
    }
);

/* ==========================================================
   REMOVE ROLE
========================================================== */

test(
    "removes administrator claims and preserves unrelated claims",
    async function () {
        const fixture =
            createServiceFixture({
                users: [
                    createMockUser({
                        uid:
                            "owner-1",

                        customClaims:
                            ownerClaims()
                    }),

                    createMockUser({
                        uid:
                            "admin-1",

                        customClaims: {
                            admin:
                                true,

                            role:
                                "admin",

                            roles: [
                                "admin"
                            ],

                            permissions: [
                                "orders.read"
                            ],

                            locale:
                                "en-GB"
                        }
                    })
                ]
            });

        const result =
            await fixture.service
                .removeAdministratorRole({
                    uid:
                        "admin-1",

                    actor: {
                        uid:
                            "owner-1"
                    },

                    reason:
                        "Access no longer required"
                });

        assert.equal(
            result.success,
            true
        );

        assert.equal(
            result.administrator.isAdministrator,
            false
        );

        assert.deepEqual(
            fixture.auth
                .setClaimsCalls[0]
                .claims,
            {
                locale:
                    "en-GB"
            }
        );

        const profile =
            fixture.firestore
                .collections
                .get(
                    "users"
                )
                .get(
                    "admin-1"
                );

        assert.equal(
            profile.isAdmin,
            false
        );

        assert.equal(
            profile.adminRole,
            null
        );
    }
);

test(
    "prevents removal of final privileged administrator",
    async function () {
        const fixture =
            createServiceFixture({
                users: [
                    createMockUser({
                        uid:
                            "owner-1",

                        customClaims:
                            ownerClaims()
                    }),

                    createMockUser({
                        uid:
                            "admin-1",

                        customClaims:
                            administratorClaims()
                    })
                ]
            });

        await assert.rejects(
            fixture.service
                .removeAdministratorRole({
                    uid:
                        "owner-1",

                    actor: {
                        uid:
                            "owner-1"
                    }
                }),
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "admin-auth/final-owner"
                );

                return true;
            }
        );

        assert.equal(
            fixture.auth
                .setClaimsCalls
                .length,
            0
        );
    }
);

test(
    "allows removal when another privileged administrator exists",
    async function () {
        const fixture =
            createServiceFixture({
                users: [
                    createMockUser({
                        uid:
                            "owner-1",

                        customClaims:
                            ownerClaims()
                    }),

                    createMockUser({
                        uid:
                            "owner-2",

                        customClaims:
                            ownerClaims()
                    })
                ]
            });

        const result =
            await fixture.service
                .removeAdministratorRole({
                    uid:
                        "owner-1",

                    actor: {
                        uid:
                            "owner-2"
                    }
                });

        assert.equal(
            result.success,
            true
        );

        assert.equal(
            result.administrator.isAdministrator,
            false
        );
    }
);

test(
    "preserves permissions when requested during role removal",
    async function () {
        const fixture =
            createServiceFixture({
                users: [
                    createMockUser({
                        uid:
                            "owner-1",

                        customClaims:
                            ownerClaims()
                    }),

                    createMockUser({
                        uid:
                            "admin-1",

                        customClaims: {
                            admin:
                                true,

                            role:
                                "admin",

                            permissions: [
                                "reports.read"
                            ]
                        }
                    })
                ]
            });

        await fixture.service
            .removeAdministratorRole({
                uid:
                    "admin-1",

                preservePermissions:
                    true,

                actor: {
                    uid:
                        "owner-1"
                }
            });

        assert.deepEqual(
            fixture.auth
                .setClaimsCalls[0]
                .claims,
            {
                permissions: [
                    "reports.read"
                ]
            }
        );
    }
);

/* ==========================================================
   GRANT PERMISSIONS
========================================================== */

test(
    "grants permissions to an existing administrator",
    async function () {
        const fixture =
            createServiceFixture({
                users: [
                    createMockUser({
                        uid:
                            "owner-1",

                        customClaims:
                            ownerClaims()
                    }),

                    createMockUser({
                        uid:
                            "admin-1",

                        customClaims:
                            adminClaims()
                    })
                ]
            });

        const result =
            await fixture.service
                .grantPermissions({
                    uid:
                        "admin-1",

                    permissions: [
                        "orders.refund",
                        "customers.delete"
                    ],

                    actor: {
                        uid:
                            "owner-1"
                    }
                });

        assert.equal(
            result.success,
            true
        );

        assert.ok(
            result.administrator
                .permissions
                .includes(
                    "orders.refund"
                )
        );

        assert.ok(
            result.administrator
                .permissions
                .includes(
                    "customers.delete"
                )
        );
    }
);

test(
    "granting permissions promotes a non-admin user to default admin",
    async function () {
        const fixture =
            createServiceFixture({
                users: [
                    createMockUser({
                        uid:
                            "owner-1",

                        customClaims:
                            ownerClaims()
                    }),

                    createMockUser({
                        uid:
                            "user-2",

                        customClaims: {
                            locale:
                                "en-GB"
                        }
                    })
                ]
            });

        const result =
            await fixture.service
                .grantPermissions({
                    uid:
                        "user-2",

                    permissions:
                        "reports.read",

                    actor: {
                        uid:
                            "owner-1"
                    }
                });

        assert.equal(
            result.administrator.isAdministrator,
            true
        );

        assert.equal(
            result.administrator.primaryRole,
            "admin"
        );

        assert.ok(
            result.administrator
                .permissions
                .includes(
                    "reports.read"
                )
        );
    }
);

/* ==========================================================
   REVOKE PERMISSIONS
========================================================== */

test(
    "revokes explicit permissions",
    async function () {
        const fixture =
            createServiceFixture({
                users: [
                    createMockUser({
                        uid:
                            "owner-1",

                        customClaims:
                            ownerClaims()
                    }),

                    createMockUser({
                        uid:
                            "admin-1",

                        customClaims: {
                            admin:
                                true,

                            role:
                                "admin",

                            permissions: [
                                "orders.read",
                                "orders.refund",
                                "customers.read"
                            ]
                        }
                    })
                ]
            });

        const result =
            await fixture.service
                .revokePermissions({
                    uid:
                        "admin-1",

                    permissions: [
                        "orders.refund"
                    ],

                    actor: {
                        uid:
                            "owner-1"
                    }
                });

        assert.equal(
            result.administrator
                .permissions
                .includes(
                    "orders.refund"
                ),
            false
        );

        assert.equal(
            result.administrator
                .permissions
                .includes(
                    "orders.read"
                ),
            true
        );
    }
);

/* ==========================================================
   PATCH CLAIMS
========================================================== */

test(
    "patches custom claims while preserving existing claims",
    async function () {
        const fixture =
            createServiceFixture({
                users: [
                    createMockUser({
                        uid:
                            "owner-1",

                        customClaims:
                            ownerClaims()
                    }),

                    createMockUser({
                        uid:
                            "admin-1",

                        customClaims: {
                            admin:
                                true,

                            role:
                                "admin",

                            locale:
                                "en-GB"
                        }
                    })
                ]
            });

        const result =
            await fixture.service
                .patchCustomClaims({
                    uid:
                        "admin-1",

                    claims: {
                        region:
                            "eu"
                    },

                    actor: {
                        uid:
                            "owner-1"
                    }
                });

        assert.equal(
            result.administrator.claims.admin,
            true
        );

        assert.equal(
            result.administrator.claims.locale,
            "en-GB"
        );

        assert.equal(
            result.administrator.claims.region,
            "eu"
        );
    }
);

test(
    "replaces custom claims when requested",
    async function () {
        const fixture =
            createServiceFixture({
                users: [
                    createMockUser({
                        uid:
                            "owner-1",

                        customClaims:
                            ownerClaims()
                    }),

                    createMockUser({
                        uid:
                            "admin-1",

                        customClaims: {
                            admin:
                                true,

                            role:
                                "admin",

                            locale:
                                "en-GB"
                        }
                    })
                ]
            });

        const result =
            await fixture.service
                .patchCustomClaims({
                    uid:
                        "admin-1",

                    claims: {
                        custom:
                            true
                    },

                    replace:
                        true,

                    actor: {
                        uid:
                            "owner-1"
                    }
                });

        assert.deepEqual(
            result.administrator.claims,
            {
                custom:
                    true
            }
        );

        assert.equal(
            result.administrator.isAdministrator,
            false
        );
    }
);

test(
    "denies direct self-mutation by default",
    async function () {
        const fixture =
            createServiceFixture({
                users: [
                    createMockUser({
                        uid:
                            "owner-1",

                        customClaims:
                            ownerClaims()
                    })
                ]
            });

        await assert.rejects(
            fixture.service
                .patchCustomClaims({
                    uid:
                        "owner-1",

                    claims: {
                        custom:
                            true
                    },

                    actor: {
                        uid:
                            "owner-1"
                    }
                }),
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "admin-auth/self-mutation-denied"
                );

                return true;
            }
        );
    }
);

test(
    "allows self-mutation when explicitly enabled",
    async function () {
        const fixture =
            createServiceFixture({
                users: [
                    createMockUser({
                        uid:
                            "owner-1",

                        customClaims:
                            ownerClaims()
                    })
                ]
            });

        const result =
            await fixture.service
                .patchCustomClaims({
                    uid:
                        "owner-1",

                    claims: {
                        locale:
                            "fr-FR"
                    },

                    allowSelfMutation:
                        true,

                    actor: {
                        uid:
                            "owner-1"
                    }
                });

        assert.equal(
            result.administrator.claims.locale,
            "fr-FR"
        );
    }
);

/* ==========================================================
   PROFILE SYNC
========================================================== */

test(
    "can disable user profile synchronization",
    async function () {
        const fixture =
            createServiceFixture({
                syncUserProfiles:
                    false,

                users: [
                    createMockUser({
                        uid:
                            "owner-1",

                        customClaims:
                            ownerClaims()
                    }),

                    createMockUser({
                        uid:
                            "user-2"
                    })
                ]
            });

        await fixture.service
            .setAdministratorRole({
                uid:
                    "user-2",

                role:
                    "admin",

                actor: {
                    uid:
                        "owner-1"
                }
            });

        assert.equal(
            fixture.firestore
                .collections
                .has(
                    "users"
                ),
            false
        );

        assert.equal(
            fixture.firestore
                .collections
                .get(
                    "adminAuditLogs"
                )
                .size,
            1
        );
    }
);

/* ==========================================================
   AUDIT REDACTION
========================================================== */

test(
    "redacts sensitive claims in administrator audit records",
    async function () {
        const fixture =
            createServiceFixture({
                users: [
                    createMockUser({
                        uid:
                            "owner-1",

                        customClaims:
                            ownerClaims()
                    }),

                    createMockUser({
                        uid:
                            "admin-1",

                        customClaims: {
                            admin:
                                true,

                            role:
                                "admin",

                            apiKey:
                                "existing-secret"
                        }
                    })
                ]
            });

        await fixture.service
            .patchCustomClaims({
                uid:
                    "admin-1",

                claims: {
                    password:
                        "new-secret"
                },

                actor: {
                    uid:
                        "owner-1"
                }
            });

        const audit =
            Array.from(
                fixture.firestore
                    .collections
                    .get(
                        "adminAuditLogs"
                    )
                    .values()
            )[0];

        assert.equal(
            audit.previousClaims.apiKey,
            "[REDACTED]"
        );

        assert.equal(
            audit.nextClaims.password,
            "[REDACTED]"
        );
    }
);

/* ==========================================================
   CLAIM SIZE ENFORCEMENT
========================================================== */

test(
    "rejects role assignment when custom claims exceed limit",
    async function () {
        const fixture =
            createServiceFixture({
                maxClaimBytes:
                    100,

                users: [
                    createMockUser({
                        uid:
                            "owner-1",

                        customClaims:
                            ownerClaims()
                    }),

                    createMockUser({
                        uid:
                            "user-2",

                        customClaims: {
                            large:
                                "x".repeat(
                                    200
                                )
                        }
                    })
                ]
            });

        await assert.rejects(
            fixture.service
                .setAdministratorRole({
                    uid:
                        "user-2",

                    role:
                        "admin",

                    actor: {
                        uid:
                            "owner-1"
                    }
                }),
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "admin-auth/claims-too-large"
                );

                return true;
            }
        );

        assert.equal(
            fixture.auth
                .setClaimsCalls
                .length,
            0
        );
    }
);

/* ==========================================================
   ERROR NORMALIZATION
========================================================== */

test(
    "preserves existing service errors during normalization",
    function () {
        const error =
            new AdminAuthServiceError(
                "admin-auth/custom",
                "Custom error."
            );

        assert.equal(
            normalizeAdminAuthServiceError(
                error,
                "fallback",
                "Fallback"
            ),
            error
        );
    }
);

test(
    "normalizes arbitrary errors",
    function () {
        const original =
            new Error(
                "Firebase failed."
            );

        original.code =
            "auth/internal-error";

        original.details = {
            retryable:
                true
        };

        const normalized =
            normalizeAdminAuthServiceError(
                original,
                "fallback",
                "Fallback"
            );

        assert.ok(
            normalized instanceof
            AdminAuthServiceError
        );

        assert.equal(
            normalized.code,
            "auth/internal-error"
        );

        assert.equal(
            normalized.message,
            "Firebase failed."
        );

        assert.deepEqual(
            normalized.details,
            {
                retryable:
                    true
            }
        );

        assert.equal(
            normalized.originalError,
            original
        );
    }
);

/* ==========================================================
   CLONING
========================================================== */

test(
    "deep-clones values",
    function () {
        const input = {
            date:
                new Date(
                    "2026-01-01T00:00:00.000Z"
                ),

            nested: {
                roles: [
                    "admin"
                ]
            }
        };

        const cloned =
            cloneValue(
                input
            );

        assert.deepEqual(
            cloned,
            {
                date:
                    "2026-01-01T00:00:00.000Z",

                nested: {
                    roles: [
                        "admin"
                    ]
                }
            }
        );

        cloned.nested.roles.push(
            "owner"
        );

        assert.deepEqual(
            input.nested.roles,
            [
                "admin"
            ]
        );
    }
);