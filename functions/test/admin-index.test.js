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

/* ==========================================================
   FIREBASE FUNCTIONS MOCK

   admin/index.js now imports admin-callables.js, which imports
   firebase-functions. The test isolates the admin module from
   the real Firebase Functions runtime.
========================================================== */

const Module =
    require(
        "node:module"
    );

const originalLoad =
    Module._load;

class MockHttpsError extends Error {
    constructor(
        code,
        message,
        details
    ) {
        super(
            message
        );

        this.name =
            "HttpsError";

        this.code =
            code;

        this.details =
            details;
    }
}

const firebaseFunctionsMock = {
    region(
        region
    ) {
        return {
            runWith(
                runtimeOptions
            ) {
                return {
                    https: {
                        onCall(
                            handler
                        ) {
                            handler.__region =
                                region;

                            handler.__runtimeOptions =
                                runtimeOptions;

                            return handler;
                        }
                    }
                };
            }
        };
    },

    https: {
        HttpsError:
            MockHttpsError,

        onCall(
            handler
        ) {
            return handler;
        }
    }
};

Module._load =
    function (
        request,
        parent,
        isMain
    ) {
        if (
            request ===
            "firebase-functions"
        ) {
            return firebaseFunctionsMock;
        }

        return originalLoad.call(
            this,
            request,
            parent,
            isMain
        );
    };

const adminModule =
    require(
        "../src/admin"
    );

Module._load =
    originalLoad;

/* ==========================================================
   MOCK HELPERS
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
        Array.isArray(
            value
        )
    ) {
        return value.map(
            cloneValue
        );
    }

    if (
        value instanceof Date
    ) {
        return value.toISOString();
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

function createMockAdmin() {
    function firestore() {
        throw new Error(
            "Mock admin.firestore() should not be called directly."
        );
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

function createMockAuth(
    initialUsers
) {
    const users =
        new Map();

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

    return {
        users,

        async getUser(
            uid
        ) {
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
        },

        async setCustomUserClaims(
            uid,
            claims
        ) {
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
        },

        async listUsers(
            pageSize,
            pageToken
        ) {
            const rows =
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
                    rows.length
                );

            return {
                users:
                    rows
                        .slice(
                            start,
                            end
                        )
                        .map(
                            cloneValue
                        ),

                pageToken:
                    end <
                    rows.length
                        ? String(
                              end
                          )
                        : undefined
            };
        }
    };
}

function createMockFirestore() {
    const collections =
        new Map();

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

    return {
        collections,

        collection(
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

                            store.set(
                                documentId,
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
                                      )
                            );
                        }
                    };
                }
            };
        }
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

function createServiceFixture() {
    const admin =
        createMockAdmin();

    const auth =
        createMockAuth([
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
                    "admin-1",

                email:
                    "admin@example.com",

                customClaims: {
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
                }
            }),

            createMockUser({
                uid:
                    "customer-1",

                email:
                    "customer@example.com"
            })
        ]);

    const firestore =
        createMockFirestore();

    return {
        admin,
        auth,
        firestore
    };
}

function createMockAdminAuthService() {
    const calls = {
        authorizeActor:
            [],

        listAdministrators:
            [],

        getAdministrator:
            [],

        setAdministratorRole:
            [],

        removeAdministratorRole:
            [],

        grantPermissions:
            [],

        revokePermissions:
            [],

        patchCustomClaims:
            []
    };

    const service = {
        options:
            Object.freeze({
                usersCollection:
                    "users"
            }),

        async authorizeActor(
            actor,
            permissions
        ) {
            calls.authorizeActor.push({
                actor:
                    cloneValue(
                        actor
                    ),

                permissions:
                    cloneValue(
                        permissions
                    )
            });

            return {
                uid:
                    "owner-1",

                email:
                    "owner@example.com",

                displayName:
                    "Store Owner",

                roles: [
                    "owner"
                ],

                permissions: [
                    "*"
                ]
            };
        },

        async listAdministrators(
            request
        ) {
            calls.listAdministrators.push(
                cloneValue(
                    request
                )
            );

            return {
                administrators: [
                    {
                        uid:
                            "owner-1",

                        isAdministrator:
                            true,

                        primaryRole:
                            "owner"
                    }
                ],

                count:
                    1,

                nextPageToken:
                    null
            };
        },

        async getAdministrator(
            uid
        ) {
            calls.getAdministrator.push(
                uid
            );

            return {
                uid,
                isAdministrator:
                    true,

                primaryRole:
                    "admin"
            };
        },

        async setAdministratorRole(
            request
        ) {
            calls.setAdministratorRole.push(
                cloneValue(
                    request
                )
            );

            return {
                administrator: {
                    uid:
                        request.uid,

                    primaryRole:
                        request.role
                },

                auditId:
                    "audit-set"
            };
        },

        async removeAdministratorRole(
            request
        ) {
            calls.removeAdministratorRole.push(
                cloneValue(
                    request
                )
            );

            return {
                administrator: {
                    uid:
                        request.uid,

                    isAdministrator:
                        false
                },

                auditId:
                    "audit-remove"
            };
        },

        async grantPermissions(
            request
        ) {
            calls.grantPermissions.push(
                cloneValue(
                    request
                )
            );

            return {
                administrator: {
                    uid:
                        request.uid,

                    permissions:
                        request.permissions
                },

                auditId:
                    "audit-grant"
            };
        },

        async revokePermissions(
            request
        ) {
            calls.revokePermissions.push(
                cloneValue(
                    request
                )
            );

            return {
                administrator: {
                    uid:
                        request.uid,

                    permissions:
                        []
                },

                auditId:
                    "audit-revoke"
            };
        },

        async patchCustomClaims(
            request
        ) {
            calls.patchCustomClaims.push(
                cloneValue(
                    request
                )
            );

            return {
                administrator: {
                    uid:
                        request.uid,

                    claims:
                        request.claims
                },

                auditId:
                    "audit-patch"
            };
        }
    };

    return {
        service,
        calls
    };
}

function createCallableContext() {
    return {
        auth: {
            uid:
                "owner-1",

            token: {
                email:
                    "owner@example.com",

                name:
                    "Store Owner",

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
            }
        }
    };
}

/* ==========================================================
   MODULE EXPORTS
========================================================== */

test(
    "exports both admin modules",
    function () {
        assert.ok(
            adminModule.adminAuthService
        );

        assert.ok(
            adminModule.adminCallables
        );

        assert.equal(
            typeof adminModule.adminAuthService,
            "object"
        );

        assert.equal(
            typeof adminModule.adminCallables,
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
    "re-exports admin callable factories",
    function () {
        assert.equal(
            typeof adminModule.createAdminCallables,
            "function"
        );

        assert.equal(
            typeof adminModule.getAdminCallables,
            "function"
        );

        assert.equal(
            typeof adminModule.resetAdminCallables,
            "function"
        );
    }
);

test(
    "re-exports administrator errors",
    function () {
        assert.equal(
            typeof adminModule.AdminAuthServiceError,
            "function"
        );

        assert.equal(
            typeof adminModule.AdminCallableError,
            "function"
        );
    }
);

/* ==========================================================
   SERVICE BUNDLE EXPORTS
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

test(
    "exports combined function bundle helpers",
    function () {
        assert.equal(
            typeof adminModule.createAdminFunctionBundle,
            "function"
        );

        assert.equal(
            typeof adminModule.getAdminFunctionBundle,
            "function"
        );

        assert.equal(
            typeof adminModule.resetAdminFunctionBundle,
            "function"
        );

        assert.equal(
            typeof adminModule.createAdminCallableExports,
            "function"
        );
    }
);

/* ==========================================================
   CLAIM BUILDERS / INSPECTION
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

test(
    "re-exports claim inspection helpers",
    function () {
        const names = [
            "extractRoles",
            "extractPermissions",
            "isAdministratorClaims",
            "hasPrivilegedRole",
            "hasAllPermissions",
            "permissionMatches"
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
                name
            );
        }
    }
);

/* ==========================================================
   ADMIN AUTH NORMALIZERS
========================================================== */

test(
    "re-exports admin auth request normalizers",
    function () {
        const names = [
            "normalizeRoleMutationRequest",
            "normalizeRemovalRequest",
            "normalizePermissionMutationRequest",
            "normalizeClaimsPatchRequest",
            "normalizeListRequest",
            "normalizeActor"
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
                name
            );
        }
    }
);

test(
    "re-exports admin auth general normalizers",
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
                name
            );
        }
    }
);

/* ==========================================================
   CALLABLE HELPERS
========================================================== */

test(
    "re-exports callable construction helpers",
    function () {
        const names = [
            "createCallable",
            "requireCallableAdministrator",
            "createActorFromCallableContext",
            "normalizeCallableData",
            "normalizeListPayload",
            "sanitizeCallableClaims",
            "createSafeActorSnapshot",
            "toHttpsError",
            "mapServiceErrorToHttpsCode",
            "normalizeCallableOptions",
            "normalizeRuntimeOptions",
            "normalizeMemory",
            "normalizeAdminCallableError"
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
                name
            );
        }
    }
);

test(
    "exports callable-specific normalizer aliases",
    function () {
        assert.equal(
            typeof adminModule.normalizeCallableRequiredString,
            "function"
        );

        assert.equal(
            typeof adminModule.normalizeCallableOptionalString,
            "function"
        );

        assert.equal(
            typeof adminModule.normalizeCallablePositiveInteger,
            "function"
        );

        assert.equal(
            adminModule.normalizeCallableRequiredString(
                " admin-1 ",
                "UID"
            ),
            "admin-1"
        );

        assert.equal(
            adminModule.normalizeCallableOptionalString(
                " note "
            ),
            "note"
        );

        assert.equal(
            adminModule.normalizeCallablePositiveInteger(
                5,
                10,
                100,
                "Value"
            ),
            5
        );
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
   CLONE HELPERS
========================================================== */

test(
    "exports shared and module-specific clone helpers",
    function () {
        assert.equal(
            typeof adminModule.cloneValue,
            "function"
        );

        assert.equal(
            typeof adminModule.cloneAdminAuthValue,
            "function"
        );

        assert.equal(
            typeof adminModule.cloneAdminCallableValue,
            "function"
        );

        const source = {
            nested: {
                value:
                    1
            }
        };

        const first =
            adminModule.cloneValue(
                source
            );

        const second =
            adminModule.cloneAdminAuthValue(
                source
            );

        const third =
            adminModule.cloneAdminCallableValue(
                source
            );

        assert.deepEqual(
            first,
            source
        );

        assert.deepEqual(
            second,
            source
        );

        assert.deepEqual(
            third,
            source
        );

        assert.notEqual(
            first.nested,
            source.nested
        );
    }
);

/* ==========================================================
   CONSTANTS
========================================================== */

test(
    "exports nested admin auth constants",
    function () {
        assert.ok(
            adminModule.constants.adminAuth
        );

        assert.equal(
            adminModule.constants.adminAuth
                .DEFAULT_USERS_COLLECTION,
            "users"
        );

        assert.equal(
            adminModule.constants.adminAuth
                .DEFAULT_AUDIT_COLLECTION,
            "adminAuditLogs"
        );
    }
);

test(
    "exports nested admin callable constants",
    function () {
        assert.ok(
            adminModule.constants.adminCallables
        );

        assert.equal(
            adminModule.constants.adminCallables
                .DEFAULT_REGION,
            "europe-west1"
        );

        assert.equal(
            adminModule.constants.adminCallables
                .CALLABLE_NAMES
                .listAdministrators,
            "listAdministrators"
        );
    }
);

test(
    "exports flattened admin auth constants",
    function () {
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
            adminModule.constants
                .ADMIN_ROLES
                .includes(
                    "owner"
                )
        );

        assert.ok(
            adminModule.constants
                .PRIVILEGED_ROLES
                .includes(
                    "super-admin"
                )
        );
    }
);

test(
    "exports flattened callable constants",
    function () {
        assert.equal(
            adminModule.constants.DEFAULT_REGION,
            "europe-west1"
        );

        assert.deepEqual(
            adminModule.constants.DEFAULT_RUNTIME_OPTIONS,
            {
                timeoutSeconds:
                    60,

                memory:
                    "256MB"
            }
        );

        assert.equal(
            adminModule.constants
                .CALLABLE_NAMES
                .setAdministratorRole,
            "setAdministratorRole"
        );

        assert.equal(
            adminModule.constants
                .CALLABLE_NAMES
                .grantAdministratorPermissions,
            "grantAdministratorPermissions"
        );
    }
);

/* ==========================================================
   REFERENCE CONSISTENCY
========================================================== */

test(
    "admin auth re-exports reference the original implementation",
    function () {
        assert.equal(
            adminModule.createAdminAuthService,
            adminModule
                .adminAuthService
                .createAdminAuthService
        );

        assert.equal(
            adminModule.buildRoleClaims,
            adminModule
                .adminAuthService
                .buildRoleClaims
        );

        assert.equal(
            adminModule.extractRoles,
            adminModule
                .adminAuthService
                .extractRoles
        );
    }
);

test(
    "callable re-exports reference the original implementation",
    function () {
        assert.equal(
            adminModule.createAdminCallables,
            adminModule
                .adminCallables
                .createAdminCallables
        );

        assert.equal(
            adminModule.createCallable,
            adminModule
                .adminCallables
                .createCallable
        );

        assert.equal(
            adminModule.toHttpsError,
            adminModule
                .adminCallables
                .toHttpsError
        );

        assert.equal(
            adminModule.normalizeMemory,
            adminModule
                .adminCallables
                .normalizeMemory
        );
    }
);

/* ==========================================================
   AUTH SERVICE BEHAVIOUR THROUGH INDEX
========================================================== */

test(
    "claim helpers work through the admin index",
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
                    replacePermissions:
                        false,

                    rolePermissions:
                        adminModule.constants
                            .DEFAULT_ROLE_PERMISSIONS
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
    "permission helpers work through the admin index",
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
            adminModule.hasAllPermissions(
                [
                    "*"
                ],
                [
                    "admins.write",
                    "customers.delete"
                ]
            ),
            true
        );
    }
);

/* ==========================================================
   CREATE ADMIN SERVICES
========================================================== */

test(
    "createAdminServices creates an immutable auth service bundle",
    function () {
        const fixture =
            createServiceFixture();

        const services =
            adminModule.createAdminServices({
                admin:
                    fixture.admin,

                auth:
                    fixture.auth,

                firestore:
                    fixture.firestore
            });

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
                .grantPermissions,
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
    "createAdminServices supports nested auth options",
    function () {
        const fixture =
            createServiceFixture();

        const services =
            adminModule.createAdminServices({
                auth: {
                    admin:
                        fixture.admin,

                    auth:
                        fixture.auth,

                    firestore:
                        fixture.firestore,

                    usersCollection:
                        "profiles",

                    auditCollection:
                        "administratorAudit"
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
            "administratorAudit"
        );
    }
);

/* ==========================================================
   CREATE FUNCTION BUNDLE
========================================================== */

test(
    "createAdminFunctionBundle combines service and raw callables",
    function () {
        const mock =
            createMockAdminAuthService();

        const bundle =
            adminModule
                .createAdminFunctionBundle({
                    service:
                        mock.service,

                    rawHandlers:
                        true,

                    allowRawClaimsPatch:
                        true
                });

        assert.ok(
            bundle.services
        );

        assert.equal(
            bundle.services.auth,
            mock.service
        );

        assert.ok(
            bundle.callables
        );

        assert.equal(
            bundle.callables.service,
            mock.service
        );

        assert.equal(
            typeof bundle.callables
                .listAdministrators,
            "function"
        );

        assert.equal(
            typeof bundle.callables
                .setAdministratorRole,
            "function"
        );

        assert.equal(
            Object.isFrozen(
                bundle
            ),
            true
        );

        assert.equal(
            Object.isFrozen(
                bundle.services
            ),
            true
        );
    }
);

test(
    "createAdminFunctionBundle can create its own service",
    function () {
        const fixture =
            createServiceFixture();

        const bundle =
            adminModule
                .createAdminFunctionBundle({
                    admin:
                        fixture.admin,

                    auth:
                        fixture.auth,

                    firestore:
                        fixture.firestore,

                    rawHandlers:
                        true
                });

        assert.ok(
            bundle.services.auth
        );

        assert.equal(
            bundle.callables.service,
            bundle.services.auth
        );
    }
);

/* ==========================================================
   FUNCTION BUNDLE BEHAVIOUR
========================================================== */

test(
    "combined bundle callables use the bundled service",
    async function () {
        const mock =
            createMockAdminAuthService();

        const bundle =
            adminModule
                .createAdminFunctionBundle({
                    service:
                        mock.service,

                    rawHandlers:
                        true
                });

        const result =
            await bundle
                .callables
                .listAdministrators(
                    {
                        pageSize:
                            100,

                        fetchAll:
                            false
                    },
                    createCallableContext()
                );

        assert.equal(
            result.success,
            true
        );

        assert.equal(
            result.count,
            1
        );

        assert.equal(
            mock.calls
                .authorizeActor
                .length,
            1
        );

        assert.deepEqual(
            mock.calls
                .authorizeActor[0]
                .permissions,
            [
                "admins.read"
            ]
        );

        assert.deepEqual(
            mock.calls
                .listAdministrators[0],
            {
                pageSize:
                    100,

                pageToken:
                    null,

                fetchAll:
                    false
            }
        );
    }
);

test(
    "combined bundle forwards administrator role mutations",
    async function () {
        const mock =
            createMockAdminAuthService();

        const bundle =
            adminModule
                .createAdminFunctionBundle({
                    service:
                        mock.service,

                    rawHandlers:
                        true
                });

        const result =
            await bundle
                .callables
                .setAdministratorRole(
                    {
                        uid:
                            "admin-2",

                        role:
                            "support",

                        permissions: [
                            "products.read"
                        ],

                        reason:
                            "Support team"
                    },
                    createCallableContext()
                );

        assert.equal(
            result.success,
            true
        );

        assert.equal(
            result.administrator.uid,
            "admin-2"
        );

        assert.equal(
            result.administrator.primaryRole,
            "support"
        );

        assert.equal(
            result.auditId,
            "audit-set"
        );

        assert.equal(
            mock.calls
                .setAdministratorRole[0]
                .actor
                .uid,
            "owner-1"
        );
    }
);

/* ==========================================================
   CALLABLE EXPORT MAP
========================================================== */

test(
    "createAdminCallableExports exposes only deployable callable handlers",
    function () {
        const mock =
            createMockAdminAuthService();

        const exportsMap =
            adminModule
                .createAdminCallableExports({
                    service:
                        mock.service,

                    rawHandlers:
                        true,

                    allowRawClaimsPatch:
                        true
                });

        assert.deepEqual(
            Object.keys(
                exportsMap
            ).sort(),
            [
                "getAdministrator",
                "grantAdministratorPermissions",
                "listAdministrators",
                "patchAdministratorClaims",
                "removeAdministratorRole",
                "revokeAdministratorPermissions",
                "setAdministratorRole"
            ].sort()
        );

        for (
            const value of
            Object.values(
                exportsMap
            )
        ) {
            assert.equal(
                typeof value,
                "function"
            );
        }

        assert.equal(
            Object.isFrozen(
                exportsMap
            ),
            true
        );
    }
);

test(
    "callable export map handlers remain functional",
    async function () {
        const mock =
            createMockAdminAuthService();

        const exportsMap =
            adminModule
                .createAdminCallableExports({
                    service:
                        mock.service,

                    rawHandlers:
                        true
                });

        const administrator =
            await exportsMap
                .getAdministrator(
                    {
                        uid:
                            "admin-5"
                    },
                    createCallableContext()
                );

        assert.equal(
            administrator.success,
            true
        );

        assert.equal(
            administrator.administrator.uid,
            "admin-5"
        );

        assert.deepEqual(
            mock.calls
                .getAdministrator,
            [
                "admin-5"
            ]
        );
    }
);

/* ==========================================================
   RAW CLAIM PATCH CONFIGURATION
========================================================== */

test(
    "function bundle keeps raw claims patch disabled by default",
    async function () {
        const mock =
            createMockAdminAuthService();

        const bundle =
            adminModule
                .createAdminFunctionBundle({
                    service:
                        mock.service,

                    rawHandlers:
                        true
                });

        await assert.rejects(
            bundle
                .callables
                .patchAdministratorClaims(
                    {
                        uid:
                            "admin-2",

                        claims: {
                            test:
                                true
                        }
                    },
                    createCallableContext()
                ),
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "permission-denied"
                );

                assert.equal(
                    error.details.code,
                    "admin-callables/raw-claims-disabled"
                );

                return true;
            }
        );

        assert.equal(
            mock.calls
                .patchCustomClaims
                .length,
            0
        );
    }
);

test(
    "function bundle can explicitly enable raw claims patch",
    async function () {
        const mock =
            createMockAdminAuthService();

        const bundle =
            adminModule
                .createAdminFunctionBundle({
                    service:
                        mock.service,

                    rawHandlers:
                        true,

                    allowRawClaimsPatch:
                        true
                });

        const result =
            await bundle
                .callables
                .patchAdministratorClaims(
                    {
                        uid:
                            "admin-2",

                        claims: {
                            region:
                                "eu"
                        }
                    },
                    createCallableContext()
                );

        assert.equal(
            result.success,
            true
        );

        assert.equal(
            result.auditId,
            "audit-patch"
        );

        assert.deepEqual(
            mock.calls
                .patchCustomClaims[0]
                .claims,
            {
                region:
                    "eu"
            }
        );
    }
);

/* ==========================================================
   CALLABLE HTTPS CONFIGURATION
========================================================== */

test(
    "function bundle creates deployable handlers with runtime settings",
    function () {
        const mock =
            createMockAdminAuthService();

        const bundle =
            adminModule
                .createAdminFunctionBundle({
                    service:
                        mock.service,

                    region:
                        "europe-west1",

                    runtimeOptions: {
                        timeoutSeconds:
                            120,

                        memory:
                            "512MB"
                    }
                });

        assert.equal(
            bundle.callables
                .listAdministrators
                .__region,
            "europe-west1"
        );

        assert.deepEqual(
            bundle.callables
                .listAdministrators
                .__runtimeOptions,
            {
                timeoutSeconds:
                    120,

                memory:
                    "512MB"
            }
        );

        assert.equal(
            bundle.callables
                .setAdministratorRole
                .__region,
            "europe-west1"
        );
    }
);

/* ==========================================================
   ERROR MAPPING THROUGH INDEX
========================================================== */

test(
    "callable error mapping works through the admin index",
    function () {
        assert.equal(
            adminModule
                .mapServiceErrorToHttpsCode(
                    "admin-auth/permission-denied"
                ),
            "permission-denied"
        );

        assert.equal(
            adminModule
                .mapServiceErrorToHttpsCode(
                    "admin-auth/final-owner"
                ),
            "failed-precondition"
        );

        assert.equal(
            adminModule
                .mapServiceErrorToHttpsCode(
                    "auth/user-not-found"
                ),
            "not-found"
        );
    }
);

/* ==========================================================
   RESET HELPERS
========================================================== */

test(
    "resetAdminServices is idempotent",
    function () {
        assert.doesNotThrow(
            function () {
                adminModule
                    .resetAdminServices();

                adminModule
                    .resetAdminServices();
            }
        );
    }
);

test(
    "resetAdminFunctionBundle is idempotent",
    function () {
        assert.doesNotThrow(
            function () {
                adminModule
                    .resetAdminFunctionBundle();

                adminModule
                    .resetAdminFunctionBundle();
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
    }
);

test(
    "aggregated constants are frozen",
    function () {
        assert.equal(
            Object.isFrozen(
                adminModule.constants
            ),
            true
        );

        assert.equal(
            Object.isFrozen(
                adminModule.constants
                    .adminAuth
            ),
            true
        );

        assert.equal(
            Object.isFrozen(
                adminModule.constants
                    .adminCallables
            ),
            true
        );
    }
);