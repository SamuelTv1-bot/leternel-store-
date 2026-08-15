"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ADMIN FUNCTIONS INTEGRATION TESTS

   Covers:
   - Admin service
   - Admin callable layer
   - Admin module index
   - Root Cloud Functions export wiring

   Run with:
   node --test functions/test/admin-functions-integration.test.js
========================================================== */

const test =
    require(
        "node:test"
    );

const assert =
    require(
        "node:assert/strict"
    );

const Module =
    require(
        "node:module"
    );

/* ==========================================================
   FIREBASE FUNCTIONS MOCK
========================================================== */

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
            details ||
            null;
    }
}

function createFunctionsBuilder(
    metadata
) {
    const state =
        Object.assign(
            {
                region:
                    null,

                runtimeOptions:
                    null
            },
            metadata ||
            {}
        );

    return {
        region(
            region
        ) {
            return createFunctionsBuilder({
                region,

                runtimeOptions:
                    state.runtimeOptions
            });
        },

        runWith(
            runtimeOptions
        ) {
            return createFunctionsBuilder({
                region:
                    state.region,

                runtimeOptions:
                    runtimeOptions
            });
        },

        https: {
            onCall(
                handler
            ) {
                handler.__isCallable =
                    true;

                handler.__region =
                    state.region;

                handler.__runtimeOptions =
                    state.runtimeOptions;

                return handler;
            },

            HttpsError:
                MockHttpsError
        }
    };
}

const firebaseFunctionsMock =
    createFunctionsBuilder();

firebaseFunctionsMock.https.HttpsError =
    MockHttpsError;

/* ==========================================================
   FIREBASE ADMIN MOCK
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

function createUser(
    input
) {
    const source =
        input ||
        {};

    return {
        uid:
            source.uid,

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

        metadata: {
            creationTime:
                source.creationTime ||
                "2026-01-01T00:00:00.000Z",

            lastSignInTime:
                source.lastSignInTime ||
                "2026-08-01T10:00:00.000Z"
        }
    };
}

const users =
    new Map([
        [
            "owner-1",
            createUser({
                uid:
                    "owner-1",

                email:
                    "owner@example.com",

                displayName:
                    "Store Owner",

                emailVerified:
                    true,

                customClaims: {
                    admin:
                        true,

                    isAdmin:
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
            })
        ],

        [
            "admin-1",
            createUser({
                uid:
                    "admin-1",

                email:
                    "admin@example.com",

                displayName:
                    "Administrator",

                customClaims: {
                    admin:
                        true,

                    isAdmin:
                        true,

                    role:
                        "administrator",

                    roles: [
                        "administrator"
                    ],

                    permissions: [
                        "admin.access",
                        "admins.read",
                        "admins.write"
                    ]
                }
            })
        ],

        [
            "user-1",
            createUser({
                uid:
                    "user-1",

                email:
                    "customer@example.com",

                displayName:
                    "Customer",

                customClaims: {
                    locale:
                        "en-GB"
                }
            })
        ]
    ]);

const authWrites =
    [];

const mockAuth = {
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

        authWrites.push({
            uid,
            claims:
                cloneValue(
                    claims
                )
        });
    },

    async listUsers(
        pageSize,
        pageToken
    ) {
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
};

const firestoreCollections =
    new Map();

function ensureCollection(
    name
) {
    if (
        !firestoreCollections.has(
            name
        )
    ) {
        firestoreCollections.set(
            name,
            new Map()
        );
    }

    return firestoreCollections.get(
        name
    );
}

const mockFirestore = {
    collection(
        name
    ) {
        const collection =
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
                        collection.size +
                        1
                    );

                return {
                    id:
                        documentId,

                    async set(
                        payload,
                        options
                    ) {
                        const existing =
                            collection.get(
                                documentId
                            ) ||
                            {};

                        collection.set(
                            documentId,
                            options &&
                            options.merge
                                ? Object.assign(
                                      {},
                                      existing,
                                      cloneValue(
                                          payload
                                      )
                                  )
                                : cloneValue(
                                      payload
                                  )
                        );
                    },

                    async get() {
                        const value =
                            collection.get(
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
};

function firestoreFactory() {
    return mockFirestore;
}

firestoreFactory.FieldValue = {
    serverTimestamp() {
        return {
            __type:
                "serverTimestamp"
        };
    }
};

const firebaseAdminMock = {
    apps: [
        {
            name:
                "[DEFAULT]"
        }
    ],

    initializeApp() {
        return {
            name:
                "[DEFAULT]"
        };
    },

    auth() {
        return mockAuth;
    },

    firestore:
        firestoreFactory
};

/* ==========================================================
   MODULE OVERRIDES
========================================================== */

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

        if (
            request ===
            "firebase-admin"
        ) {
            return firebaseAdminMock;
        }

        return originalLoad.call(
            this,
            request,
            parent,
            isMain
        );
    };

/* ==========================================================
   LOAD MODULES UNDER TEST
========================================================== */

const adminModule =
    require(
        "../src/admin"
    );

/*
 * The real root index may contain additional project modules.
 * These tests focus on the administrator export chain.
 */
const adminCallableExports =
    adminModule
        .createAdminCallableExports({
            region:
                "europe-west1",

            runtimeOptions: {
                timeoutSeconds:
                    60,

                memory:
                    "256MB"
            },

            allowRawClaimsPatch:
                false
        });

Module._load =
    originalLoad;

/* ==========================================================
   CONTEXT HELPERS
========================================================== */

function createOwnerContext() {
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

                isAdmin:
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

function createAdminContext() {
    return {
        auth: {
            uid:
                "admin-1",

            token: {
                email:
                    "admin@example.com",

                name:
                    "Administrator",

                admin:
                    true,

                isAdmin:
                    true,

                role:
                    "administrator",

                roles: [
                    "administrator"
                ],

                permissions: [
                    "admin.access",
                    "admins.read",
                    "admins.write"
                ]
            }
        }
    };
}

function createUnauthenticatedContext() {
    return {};
}

/* ==========================================================
   EXPORT CHAIN
========================================================== */

test(
    "admin module exposes all administrator callable exports",
    function () {
        assert.deepEqual(
            Object.keys(
                adminCallableExports
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
    }
);

test(
    "all exported administrator handlers are callable functions",
    function () {
        for (
            const handler of
            Object.values(
                adminCallableExports
            )
        ) {
            assert.equal(
                typeof handler,
                "function"
            );

            assert.equal(
                handler.__isCallable,
                true
            );

            assert.equal(
                handler.__region,
                "europe-west1"
            );

            assert.deepEqual(
                handler.__runtimeOptions,
                {
                    timeoutSeconds:
                        60,

                    memory:
                        "256MB"
                }
            );
        }
    }
);

/* ==========================================================
   LIST ADMINISTRATORS
========================================================== */

test(
    "listAdministrators reaches auth service through callable layer",
    async function () {
        const result =
            await adminCallableExports
                .listAdministrators(
                    {
                        fetchAll:
                            true
                    },
                    createOwnerContext()
                );

        assert.equal(
            result.success,
            true
        );

        assert.equal(
            result.count,
            2
        );

        assert.deepEqual(
            result.administrators
                .map(
                    function (
                        administrator
                    ) {
                        return administrator.uid;
                    }
                )
                .sort(),
            [
                "admin-1",
                "owner-1"
            ]
        );

        assert.equal(
            result.actor.uid,
            "owner-1"
        );

        assert.equal(
            result.actor.claims,
            undefined
        );
    }
);

/* ==========================================================
   GET ADMINISTRATOR
========================================================== */

test(
    "getAdministrator returns normalized administrator record",
    async function () {
        const result =
            await adminCallableExports
                .getAdministrator(
                    {
                        uid:
                            "admin-1"
                    },
                    createOwnerContext()
                );

        assert.equal(
            result.success,
            true
        );

        assert.equal(
            result.administrator.uid,
            "admin-1"
        );

        assert.equal(
            result.administrator
                .isAdministrator,
            true
        );

        assert.equal(
            result.administrator
                .primaryRole,
            "administrator"
        );

        assert.ok(
            result.administrator
                .permissions
                .includes(
                    "admins.write"
                )
        );
    }
);

/* ==========================================================
   SET ROLE
========================================================== */

test(
    "setAdministratorRole updates Firebase Auth claims",
    async function () {
        const result =
            await adminCallableExports
                .setAdministratorRole(
                    {
                        uid:
                            "user-1",

                        role:
                            "support",

                        permissions: [
                            "products.read"
                        ],

                        reason:
                            "Support team promotion"
                    },
                    createOwnerContext()
                );

        assert.equal(
            result.success,
            true
        );

        assert.equal(
            result.administrator.uid,
            "user-1"
        );

        assert.equal(
            result.administrator.primaryRole,
            "support"
        );

        const updatedUser =
            users.get(
                "user-1"
            );

        assert.equal(
            updatedUser.customClaims.admin,
            true
        );

        assert.equal(
            updatedUser.customClaims.isAdmin,
            true
        );

        assert.equal(
            updatedUser.customClaims.role,
            "support"
        );

        assert.deepEqual(
            updatedUser.customClaims.roles,
            [
                "support"
            ]
        );

        assert.equal(
            updatedUser.customClaims.locale,
            "en-GB"
        );

        assert.ok(
            updatedUser.customClaims
                .permissions
                .includes(
                    "products.read"
                )
        );

        assert.ok(
            updatedUser.customClaims
                .permissions
                .includes(
                    "customers.read"
                )
        );

        assert.ok(
            authWrites.some(
                function (
                    write
                ) {
                    return write.uid ===
                        "user-1";
                }
            )
        );
    }
);

test(
    "setAdministratorRole synchronizes Firestore admin profile",
    async function () {
        const profile =
            firestoreCollections
                .get(
                    "users"
                )
                .get(
                    "user-1"
                );

        assert.ok(
            profile
        );

        assert.equal(
            profile.uid,
            "user-1"
        );

        assert.equal(
            profile.adminRole,
            "support"
        );

        assert.equal(
            profile.isAdmin,
            true
        );

        assert.equal(
            profile.adminUpdatedBy,
            "owner-1"
        );
    }
);

test(
    "setAdministratorRole writes administrator audit record",
    async function () {
        const logs =
            firestoreCollections
                .get(
                    "adminAuditLogs"
                );

        assert.ok(
            logs
        );

        const entries =
            Array.from(
                logs.values()
            );

        const entry =
            entries.find(
                function (
                    item
                ) {
                    return (
                        item.action ===
                            "admin.role.set" &&
                        item.target.uid ===
                            "user-1"
                    );
                }
            );

        assert.ok(
            entry
        );

        assert.equal(
            entry.actor.uid,
            "owner-1"
        );

        assert.equal(
            entry.target.uid,
            "user-1"
        );

        assert.equal(
            entry.metadata.reason,
            "Support team promotion"
        );
    }
);

/* ==========================================================
   PRIVILEGED ROLE PROTECTION
========================================================== */

test(
    "non-owner administrator cannot assign owner role",
    async function () {
        await assert.rejects(
            adminCallableExports
                .setAdministratorRole(
                    {
                        uid:
                            "user-1",

                        role:
                            "owner"
                    },
                    createAdminContext()
                ),
            function (
                error
            ) {
                assert.ok(
                    error instanceof
                    MockHttpsError
                );

                assert.equal(
                    error.code,
                    "permission-denied"
                );

                assert.equal(
                    error.details.code,
                    "admin-auth/privileged-role-required"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   GRANT PERMISSION
========================================================== */

test(
    "grantAdministratorPermissions updates custom claims",
    async function () {
        const result =
            await adminCallableExports
                .grantAdministratorPermissions(
                    {
                        uid:
                            "admin-1",

                        permissions: [
                            "orders.refund",
                            "customers.delete"
                        ],

                        reason:
                            "Senior administrator"
                    },
                    createOwnerContext()
                );

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

        const user =
            users.get(
                "admin-1"
            );

        assert.ok(
            user.customClaims
                .permissions
                .includes(
                    "orders.refund"
                )
        );
    }
);

/* ==========================================================
   REVOKE PERMISSION
========================================================== */

test(
    "revokeAdministratorPermissions removes permission",
    async function () {
        const result =
            await adminCallableExports
                .revokeAdministratorPermissions(
                    {
                        uid:
                            "admin-1",

                        permissions: [
                            "orders.refund"
                        ],

                        reason:
                            "Refund access removed"
                    },
                    createOwnerContext()
                );

        assert.equal(
            result.success,
            true
        );

        assert.equal(
            result.administrator
                .permissions
                .includes(
                    "orders.refund"
                ),
            false
        );
    }
);

/* ==========================================================
   REMOVE ROLE
========================================================== */

test(
    "removeAdministratorRole removes admin access",
    async function () {
        const result =
            await adminCallableExports
                .removeAdministratorRole(
                    {
                        uid:
                            "user-1",

                        reason:
                            "Support access ended"
                    },
                    createOwnerContext()
                );

        assert.equal(
            result.success,
            true
        );

        assert.equal(
            result.administrator
                .isAdministrator,
            false
        );

        const user =
            users.get(
                "user-1"
            );

        assert.equal(
            user.customClaims.admin,
            undefined
        );

        assert.equal(
            user.customClaims.isAdmin,
            undefined
        );

        assert.equal(
            user.customClaims.role,
            undefined
        );

        assert.equal(
            user.customClaims.locale,
            "en-GB"
        );

        const profile =
            firestoreCollections
                .get(
                    "users"
                )
                .get(
                    "user-1"
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

/* ==========================================================
   FINAL OWNER PROTECTION
========================================================== */

test(
    "final owner cannot remove their own privileged role",
    async function () {
        await assert.rejects(
            adminCallableExports
                .removeAdministratorRole(
                    {
                        uid:
                            "owner-1"
                    },
                    createOwnerContext()
                ),
            function (
                error
            ) {
                assert.ok(
                    error instanceof
                    MockHttpsError
                );

                assert.equal(
                    error.code,
                    "failed-precondition"
                );

                assert.equal(
                    error.details.code,
                    "admin-auth/final-owner"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   RAW CLAIM PATCH
========================================================== */

test(
    "raw administrator claims patch is disabled in root wiring",
    async function () {
        await assert.rejects(
            adminCallableExports
                .patchAdministratorClaims(
                    {
                        uid:
                            "admin-1",

                        claims: {
                            test:
                                true
                        }
                    },
                    createOwnerContext()
                ),
            function (
                error
            ) {
                assert.ok(
                    error instanceof
                    MockHttpsError
                );

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
    }
);

/* ==========================================================
   AUTHENTICATION
========================================================== */

test(
    "administrator callables reject unauthenticated requests",
    async function () {
        await assert.rejects(
            adminCallableExports
                .listAdministrators(
                    {},
                    createUnauthenticatedContext()
                ),
            function (
                error
            ) {
                assert.ok(
                    error instanceof
                    MockHttpsError
                );

                assert.equal(
                    error.code,
                    "unauthenticated"
                );

                assert.equal(
                    error.details.code,
                    "admin-callables/unauthenticated"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   PERMISSION ENFORCEMENT
========================================================== */

test(
    "administrator without admins.write cannot mutate admin roles",
    async function () {
        users.set(
            "readonly-admin",
            createUser({
                uid:
                    "readonly-admin",

                email:
                    "readonly@example.com",

                customClaims: {
                    admin:
                        true,

                    role:
                        "analyst",

                    roles: [
                        "analyst"
                    ],

                    permissions: [
                        "admin.access",
                        "admins.read"
                    ]
                }
            })
        );

        const context = {
            auth: {
                uid:
                    "readonly-admin",

                token: {
                    email:
                        "readonly@example.com",

                    admin:
                        true,

                    role:
                        "analyst",

                    permissions: [
                        "admin.access",
                        "admins.read"
                    ]
                }
            }
        };

        await assert.rejects(
            adminCallableExports
                .setAdministratorRole(
                    {
                        uid:
                            "user-1",

                        role:
                            "support"
                    },
                    context
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
                    "admin-auth/permission-denied"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   USER NOT FOUND
========================================================== */

test(
    "missing administrator maps to not-found HttpsError",
    async function () {
        await assert.rejects(
            adminCallableExports
                .getAdministrator(
                    {
                        uid:
                            "missing-user"
                    },
                    createOwnerContext()
                ),
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "not-found"
                );

                assert.equal(
                    error.details.code,
                    "auth/user-not-found"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   INVALID ARGUMENT
========================================================== */

test(
    "missing target uid maps to invalid-argument",
    async function () {
        await assert.rejects(
            adminCallableExports
                .getAdministrator(
                    {},
                    createOwnerContext()
                ),
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   ADMIN MODULE CONSISTENCY
========================================================== */

test(
    "admin module callable names match integration export names",
    function () {
        assert.deepEqual(
            Object.keys(
                adminCallableExports
            ).sort(),
            Object.values(
                adminModule.constants
                    .CALLABLE_NAMES
            ).sort()
        );
    }
);

test(
    "admin function bundle produces same callable surface",
    function () {
        const bundle =
            adminModule
                .createAdminFunctionBundle({
                    service:
                        adminModule
                            .getAdminAuthService({
                                admin:
                                    firebaseAdminMock,

                                auth:
                                    mockAuth,

                                firestore:
                                    mockFirestore
                            }),

                    rawHandlers:
                        true,

                    allowRawClaimsPatch:
                        false
                });

        assert.deepEqual(
            Object.keys(
                bundle.callables
            )
                .filter(
                    function (
                        key
                    ) {
                        return typeof bundle
                            .callables[
                                key
                            ] ===
                            "function";
                    }
                )
                .sort(),
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
    }
);

/* ==========================================================
   AUDIT CHAIN
========================================================== */

test(
    "admin mutations create audit records end-to-end",
    function () {
        const logs =
            firestoreCollections
                .get(
                    "adminAuditLogs"
                );

        assert.ok(
            logs
        );

        const actions =
            Array.from(
                logs.values()
            ).map(
                function (
                    record
                ) {
                    return record.action;
                }
            );

        assert.ok(
            actions.includes(
                "admin.role.set"
            )
        );

        assert.ok(
            actions.includes(
                "admin.permissions.granted"
            )
        );

        assert.ok(
            actions.includes(
                "admin.permissions.revoked"
            )
        );

        assert.ok(
            actions.includes(
                "admin.role.removed"
            )
        );
    }
);

/* ==========================================================
   MODULE IMMUTABILITY
========================================================== */

test(
    "admin callable export map is immutable",
    function () {
        assert.equal(
            Object.isFrozen(
                adminCallableExports
            ),
            true
        );
    }
);