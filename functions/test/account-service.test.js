"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ACCOUNT SERVICE TESTS
========================================================== */

const test = require("node:test");

const assert = require(
    "node:assert/strict"
);

const {
    Timestamp
} = require(
    "firebase-admin/firestore"
);

const accountService = require(
    "../src/accounts/account-service"
);

/* ==========================================================
   TEST HELPERS
========================================================== */

function createAuthUser(options) {
    const settings =
        options || {};

    return {
        uid:
            settings.uid ||
            "user-1",

        email:
            settings.email ||
            "customer@example.com",

        displayName:
            settings.displayName ||
            "Test Customer",

        photoURL:
            settings.photoURL ||
            "",

        emailVerified:
            settings.emailVerified !==
            false,

        disabled:
            Boolean(
                settings.disabled
            ),

        customClaims:
            settings.customClaims ||
            {}
    };
}

function createAuthService(options) {
    const settings =
        options || {};

    const users =
        new Map();

    const claimsWrites = [];
    const updateWrites = [];
    const revokedUsers = [];
    const deletedUsers = [];

    const initialUsers =
        settings.users || {
            "user-1":
                createAuthUser()
        };

    Object.keys(
        initialUsers
    ).forEach(function (userId) {
        users.set(
            userId,
            initialUsers[userId]
        );
    });

    return {
        users:
            users,

        claimsWrites:
            claimsWrites,

        updateWrites:
            updateWrites,

        revokedUsers:
            revokedUsers,

        deletedUsers:
            deletedUsers,

        getUser:
            async function (userId) {
                if (
                    !users.has(userId)
                ) {
                    const error =
                        new Error(
                            "User not found"
                        );

                    error.code =
                        "auth/user-not-found";

                    throw error;
                }

                return users.get(
                    userId
                );
            },

        setCustomUserClaims:
            async function (
                userId,
                claims
            ) {
                const user =
                    users.get(userId);

                if (!user) {
                    const error =
                        new Error(
                            "User not found"
                        );

                    error.code =
                        "auth/user-not-found";

                    throw error;
                }

                claimsWrites.push({
                    userId:
                        userId,
                    claims:
                        claims
                });

                user.customClaims =
                    Object.assign(
                        {},
                        claims
                    );
            },

        updateUser:
            async function (
                userId,
                changes
            ) {
                const user =
                    users.get(userId);

                if (!user) {
                    const error =
                        new Error(
                            "User not found"
                        );

                    error.code =
                        "auth/user-not-found";

                    throw error;
                }

                updateWrites.push({
                    userId:
                        userId,
                    changes:
                        changes
                });

                Object.assign(
                    user,
                    changes
                );

                return user;
            },

        revokeRefreshTokens:
            async function (
                userId
            ) {
                revokedUsers.push(
                    userId
                );
            },

        deleteUser:
            async function (
                userId
            ) {
                if (
                    !users.has(userId)
                ) {
                    const error =
                        new Error(
                            "User not found"
                        );

                    error.code =
                        "auth/user-not-found";

                    throw error;
                }

                deletedUsers.push(
                    userId
                );

                users.delete(
                    userId
                );
            }
    };
}

function createDatabase(
    initialDocuments
) {
    const documents =
        new Map();

    const writes = [];

    Object.keys(
        initialDocuments || {}
    ).forEach(function (path) {
        documents.set(
            path,
            Object.assign(
                {},
                initialDocuments[path]
            )
        );
    });

    function createDocumentReference(
        collectionName,
        documentId
    ) {
        const path =
            collectionName +
            "/" +
            documentId;

        return {
            id:
                documentId,

            path:
                path,

            get:
                async function () {
                    return createSnapshot(
                        documentId,
                        documents.get(
                            path
                        )
                    );
                },

            set:
                async function (
                    data,
                    options
                ) {
                    const existing =
                        documents.get(
                            path
                        ) || {};

                    const next =
                        options &&
                        options.merge
                            ? Object.assign(
                                  {},
                                  existing,
                                  data
                              )
                            : Object.assign(
                                  {},
                                  data
                              );

                    documents.set(
                        path,
                        next
                    );

                    writes.push({
                        operation:
                            "set",
                        path:
                            path,
                        data:
                            data,
                        options:
                            options || null
                    });
                }
        };
    }

    return {
        documents:
            documents,

        writes:
            writes,

        collection:
            function (
                collectionName
            ) {
                return {
                    doc:
                        function (
                            documentId
                        ) {
                            const id =
                                documentId ||
                                "generated-" +
                                    (
                                        writes.length +
                                        1
                                    );

                            return createDocumentReference(
                                collectionName,
                                id
                            );
                        },

                    where:
                        function (
                            field,
                            operator,
                            value
                        ) {
                            assert.equal(
                                operator,
                                "=="
                            );

                            return createQuery({
                                documents:
                                    documents,
                                collectionName:
                                    collectionName,
                                filters: [
                                    {
                                        field:
                                            field,
                                        value:
                                            value
                                    }
                                ]
                            });
                        }
                };
            }
    };
}

function createQuery(options) {
    const filters =
        options.filters || [];

    let maximum = null;

    const query = {
        where:
            function (
                field,
                operator,
                value
            ) {
                assert.equal(
                    operator,
                    "=="
                );

                filters.push({
                    field:
                        field,
                    value:
                        value
                });

                return query;
            },

        limit:
            function (value) {
                maximum =
                    Number(value);

                return query;
            },

        get:
            async function () {
                const prefix =
                    options.collectionName +
                    "/";

                let matching =
                    Array.from(
                        options.documents
                            .entries()
                    )
                        .filter(
                            function (
                                entry
                            ) {
                                return entry[0]
                                    .startsWith(
                                        prefix
                                    );
                            }
                        )
                        .filter(
                            function (
                                entry
                            ) {
                                const data =
                                    entry[1];

                                return filters.every(
                                    function (
                                        filter
                                    ) {
                                        return (
                                            data[
                                                filter.field
                                            ] ===
                                            filter.value
                                        );
                                    }
                                );
                            }
                        );

                if (
                    maximum !== null
                ) {
                    matching =
                        matching.slice(
                            0,
                            maximum
                        );
                }

                const docs =
                    matching.map(
                        function (
                            entry
                        ) {
                            const id =
                                entry[0]
                                    .slice(
                                        prefix.length
                                    );

                            return createSnapshot(
                                id,
                                entry[1]
                            );
                        }
                    );

                return {
                    size:
                        docs.length,

                    empty:
                        docs.length ===
                        0,

                    docs:
                        docs
                };
            }
    };

    return query;
}

function createSnapshot(
    id,
    data
) {
    return {
        id:
            id,

        exists:
            data !== undefined,

        data:
            function () {
                return data;
            },

        get:
            function (field) {
                return data
                    ? data[field]
                    : undefined;
            }
    };
}

function getDocument(
    database,
    path
) {
    return database.documents
        .get(path);
}

/* ==========================================================
   ROLE CLAIMS
========================================================== */

test(
    "buildRoleClaims creates customer claims",
    function () {
        assert.deepEqual(
            accountService
                ._internal
                .buildRoleClaims(
                    "customer"
                ),
            {
                role:
                    "customer",

                admin:
                    false,

                superadmin:
                    false
            }
        );
    }
);

test(
    "buildRoleClaims creates administrator claims",
    function () {
        assert.deepEqual(
            accountService
                ._internal
                .buildRoleClaims(
                    "admin"
                ),
            {
                role:
                    "admin",

                admin:
                    true,

                superadmin:
                    false
            }
        );
    }
);

test(
    "buildRoleClaims creates super-administrator claims",
    function () {
        assert.deepEqual(
            accountService
                ._internal
                .buildRoleClaims(
                    "superadmin"
                ),
            {
                role:
                    "superadmin",

                admin:
                    true,

                superadmin:
                    true
            }
        );
    }
);

/* ==========================================================
   ROLE NORMALIZATION
========================================================== */

test(
    "normalizeRole accepts valid roles",
    function () {
        assert.equal(
            accountService
                ._internal
                .normalizeRole(
                    " ADMIN "
                ),
            "admin"
        );

        assert.equal(
            accountService
                ._internal
                .normalizeRole(
                    "SUPERADMIN"
                ),
            "superadmin"
        );
    }
);

test(
    "normalizeRole defaults invalid roles to customer",
    function () {
        assert.equal(
            accountService
                ._internal
                .normalizeRole(
                    "manager"
                ),
            "customer"
        );
    }
);

test(
    "normalizeStatus accepts valid statuses",
    function () {
        assert.equal(
            accountService
                ._internal
                .normalizeStatus(
                    " DISABLED "
                ),
            "disabled"
        );

        assert.equal(
            accountService
                ._internal
                .normalizeStatus(
                    "active"
                ),
            "active"
        );
    }
);

test(
    "normalizeStatus defaults invalid statuses to active",
    function () {
        assert.equal(
            accountService
                ._internal
                .normalizeStatus(
                    "suspended"
                ),
            "active"
        );
    }
);

/* ==========================================================
   CLAIM COMPARISON
========================================================== */

test(
    "claimsEqual returns true for equivalent claims",
    function () {
        assert.equal(
            accountService
                ._internal
                .claimsEqual(
                    {
                        role:
                            "admin",
                        admin:
                            true
                    },
                    {
                        admin:
                            true,
                        role:
                            "admin"
                    }
                ),
            true
        );
    }
);

test(
    "claimsEqual returns false when a claim differs",
    function () {
        assert.equal(
            accountService
                ._internal
                .claimsEqual(
                    {
                        role:
                            "admin",
                        admin:
                            true
                    },
                    {
                        role:
                            "customer",
                        admin:
                            false
                    }
                ),
            false
        );
    }
);

/* ==========================================================
   SET USER ROLE
========================================================== */

test(
    "setUserRole updates claims, profile, audit log, and sessions",
    async function () {
        const auth =
            createAuthService({
                users: {
                    "user-1":
                        createAuthUser({
                            uid:
                                "user-1",

                            customClaims: {
                                marketing:
                                    true
                            }
                        })
                }
            });

        const db =
            createDatabase({
                "users/user-1": {
                    uid:
                        "user-1",

                    email:
                        "customer@example.com",

                    role:
                        "customer",

                    status:
                        "active"
                }
            });

        const result =
            await accountService
                .setUserRole({
                    db:
                        db,

                    auth:
                        auth,

                    userId:
                        "user-1",

                    role:
                        "admin",

                    administrator: {
                        uid:
                            "superadmin-1",

                        email:
                            "owner@example.com",

                        role:
                            "superadmin"
                    }
                });

        assert.equal(
            result.success,
            true
        );

        assert.equal(
            result.role,
            "admin"
        );

        assert.equal(
            result.previousRole,
            "customer"
        );

        assert.deepEqual(
            auth.claimsWrites[0]
                .claims,
            {
                marketing:
                    true,

                role:
                    "admin",

                admin:
                    true,

                superadmin:
                    false
            }
        );

        assert.deepEqual(
            auth.revokedUsers,
            [
                "user-1"
            ]
        );

        const profile =
            getDocument(
                db,
                "users/user-1"
            );

        assert.equal(
            profile.role,
            "admin"
        );

        assert.equal(
            profile.roleUpdatedBy,
            "superadmin-1"
        );

        assert.ok(
            profile.updatedAt instanceof
            Timestamp
        );

        const auditWrites =
            db.writes.filter(
                function (write) {
                    return write.path
                        .startsWith(
                            "auditLogs/"
                        );
                }
            );

        assert.equal(
            auditWrites.length,
            1
        );
    }
);

test(
    "setUserRole prevents a super-admin removing own role",
    async function () {
        const auth =
            createAuthService({
                users: {
                    "superadmin-1":
                        createAuthUser({
                            uid:
                                "superadmin-1",

                            customClaims: {
                                role:
                                    "superadmin"
                            }
                        })
                }
            });

        const db =
            createDatabase({
                "users/superadmin-1": {
                    role:
                        "superadmin",

                    status:
                        "active"
                }
            });

        await assert.rejects(
            accountService.setUserRole({
                db:
                    db,

                auth:
                    auth,

                userId:
                    "superadmin-1",

                role:
                    "admin",

                administrator: {
                    uid:
                        "superadmin-1",

                    role:
                        "superadmin"
                }
            }),
            function (error) {
                assert.equal(
                    error.code,
                    "failed-precondition"
                );

                assert.match(
                    error.message,
                    /cannot remove your own/i
                );

                return true;
            }
        );
    }
);

test(
    "setUserRole rejects missing Auth users",
    async function () {
        const auth =
            createAuthService({
                users: {}
            });

        const db =
            createDatabase();

        await assert.rejects(
            accountService.setUserRole({
                db:
                    db,

                auth:
                    auth,

                userId:
                    "missing-user",

                role:
                    "admin",

                administrator: {
                    uid:
                        "superadmin-1",

                    role:
                        "superadmin"
                }
            }),
            function (error) {
                assert.equal(
                    error.code,
                    "not-found"
                );

                assert.equal(
                    error.status,
                    404
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   SET USER STATUS
========================================================== */

test(
    "setUserStatus disables an Auth account and revokes sessions",
    async function () {
        const auth =
            createAuthService();

        const db =
            createDatabase({
                "users/user-1": {
                    uid:
                        "user-1",

                    email:
                        "customer@example.com",

                    role:
                        "customer",

                    status:
                        "active"
                }
            });

        const result =
            await accountService
                .setUserStatus({
                    db:
                        db,

                    auth:
                        auth,

                    userId:
                        "user-1",

                    status:
                        "disabled",

                    reason:
                        "Fraud review",

                    administrator: {
                        uid:
                            "admin-1",

                        email:
                            "admin@example.com",

                        role:
                            "admin"
                    }
                });

        assert.equal(
            result.success,
            true
        );

        assert.equal(
            result.status,
            "disabled"
        );

        assert.equal(
            auth.updateWrites[0]
                .changes.disabled,
            true
        );

        assert.deepEqual(
            auth.revokedUsers,
            [
                "user-1"
            ]
        );

        const profile =
            getDocument(
                db,
                "users/user-1"
            );

        assert.equal(
            profile.status,
            "disabled"
        );

        assert.equal(
            profile.statusReason,
            "Fraud review"
        );

        assert.ok(
            profile.disabledAt instanceof
            Timestamp
        );
    }
);

test(
    "setUserStatus reactivates a disabled account",
    async function () {
        const auth =
            createAuthService({
                users: {
                    "user-1":
                        createAuthUser({
                            uid:
                                "user-1",
                            disabled:
                                true
                        })
                }
            });

        const db =
            createDatabase({
                "users/user-1": {
                    role:
                        "customer",

                    status:
                        "disabled"
                }
            });

        const result =
            await accountService
                .setUserStatus({
                    db:
                        db,

                    auth:
                        auth,

                    userId:
                        "user-1",

                    status:
                        "active",

                    administrator: {
                        uid:
                            "admin-1",

                        role:
                            "admin"
                    }
                });

        assert.equal(
            result.status,
            "active"
        );

        assert.equal(
            auth.updateWrites[0]
                .changes.disabled,
            false
        );

        assert.deepEqual(
            auth.revokedUsers,
            []
        );

        const profile =
            getDocument(
                db,
                "users/user-1"
            );

        assert.ok(
            profile.reactivatedAt instanceof
            Timestamp
        );
    }
);

test(
    "setUserStatus prevents administrators disabling themselves",
    async function () {
        const auth =
            createAuthService({
                users: {
                    "admin-1":
                        createAuthUser({
                            uid:
                                "admin-1",

                            customClaims: {
                                role:
                                    "admin"
                            }
                        })
                }
            });

        const db =
            createDatabase({
                "users/admin-1": {
                    role:
                        "admin",

                    status:
                        "active"
                }
            });

        await assert.rejects(
            accountService.setUserStatus({
                db:
                    db,

                auth:
                    auth,

                userId:
                    "admin-1",

                status:
                    "disabled",

                administrator: {
                    uid:
                        "admin-1",

                    role:
                        "admin"
                }
            }),
            function (error) {
                assert.equal(
                    error.code,
                    "failed-precondition"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   PROFILE CREATION
========================================================== */

test(
    "handleProfileCreated normalizes defaults and Auth claims",
    async function () {
        const auth =
            createAuthService({
                users: {
                    "user-1":
                        createAuthUser({
                            uid:
                                "user-1",

                            email:
                                "customer@example.com",

                            displayName:
                                "Samuel Udom",

                            customClaims: {}
                        })
                }
            });

        const db =
            createDatabase();

        const result =
            await accountService
                .handleProfileCreated({
                    db:
                        db,

                    auth:
                        auth,

                    userId:
                        "user-1",

                    profile: {
                        role:
                            "customer"
                    }
                });

        assert.equal(
            result.success,
            true
        );

        assert.equal(
            result.role,
            "customer"
        );

        assert.equal(
            result.status,
            "active"
        );

        const profile =
            getDocument(
                db,
                "users/user-1"
            );

        assert.equal(
            profile.email,
            "customer@example.com"
        );

        assert.equal(
            profile.displayName,
            "Samuel Udom"
        );

        assert.equal(
            profile.emailVerified,
            true
        );

        assert.equal(
            profile.preferences.currency,
            "NGN"
        );

        assert.deepEqual(
            profile.addresses,
            []
        );

        assert.equal(
            auth.claimsWrites.length,
            1
        );

        assert.equal(
            auth.claimsWrites[0]
                .claims.role,
            "customer"
        );
    }
);

test(
    "handleProfileCreated preserves supplied preferences and addresses",
    async function () {
        const auth =
            createAuthService();

        const db =
            createDatabase();

        await accountService
            .handleProfileCreated({
                db:
                    db,

                auth:
                    auth,

                userId:
                    "user-1",

                profile: {
                    preferences: {
                        currency:
                            "USD",

                        language:
                            "fr"
                    },

                    addresses: [
                        {
                            city:
                                "Lagos"
                        }
                    ]
                }
            });

        const profile =
            getDocument(
                db,
                "users/user-1"
            );

        assert.deepEqual(
            profile.preferences,
            {
                currency:
                    "USD",

                language:
                    "fr"
            }
        );

        assert.deepEqual(
            profile.addresses,
            [
                {
                    city:
                        "Lagos"
                }
            ]
        );
    }
);

/* ==========================================================
   AUTH SYNCHRONIZATION
========================================================== */

test(
    "synchronizeAuthAccount updates claims when role changes",
    async function () {
        const auth =
            createAuthService();

        const db =
            createDatabase({
                "users/superadmin-2": {
                    role:
                        "superadmin",

                    status:
                        "active"
                }
            });

        const result =
            await accountService
                .synchronizeAuthAccount({
                    db:
                        db,

                    auth:
                        auth,

                    userId:
                        "user-1",

                    before: {
                        role:
                            "customer",

                        status:
                            "active"
                    },

                    after: {
                        role:
                            "admin",

                        status:
                            "active"
                    }
                });

        assert.equal(
            result.roleChanged,
            true
        );

        assert.equal(
            result.statusChanged,
            false
        );

        assert.equal(
            result.sessionsRevoked,
            true
        );

        assert.equal(
            auth.claimsWrites[0]
                .claims.role,
            "admin"
        );

        assert.deepEqual(
            auth.revokedUsers,
            [
                "user-1"
            ]
        );
    }
);

test(
    "synchronizeAuthAccount disables Auth when status changes",
    async function () {
        const auth =
            createAuthService();

        const db =
            createDatabase();

        const result =
            await accountService
                .synchronizeAuthAccount({
                    db:
                        db,

                    auth:
                        auth,

                    userId:
                        "user-1",

                    before: {
                        role:
                            "customer",

                        status:
                            "active"
                    },

                    after: {
                        role:
                            "customer",

                        status:
                            "disabled"
                    }
                });

        assert.equal(
            result.roleChanged,
            false
        );

        assert.equal(
            result.statusChanged,
            true
        );

        assert.equal(
            auth.updateWrites[0]
                .changes.disabled,
            true
        );

        assert.deepEqual(
            auth.revokedUsers,
            [
                "user-1"
            ]
        );
    }
);

test(
    "synchronizeAuthAccount avoids unnecessary writes",
    async function () {
        const auth =
            createAuthService();

        const db =
            createDatabase();

        const result =
            await accountService
                .synchronizeAuthAccount({
                    db:
                        db,

                    auth:
                        auth,

                    userId:
                        "user-1",

                    before: {
                        role:
                            "customer",

                        status:
                            "active"
                    },

                    after: {
                        role:
                            "customer",

                        status:
                            "active"
                    }
                });

        assert.equal(
            result.roleChanged,
            false
        );

        assert.equal(
            result.statusChanged,
            false
        );

        assert.equal(
            auth.claimsWrites.length,
            0
        );

        assert.equal(
            auth.updateWrites.length,
            0
        );

        assert.equal(
            auth.revokedUsers.length,
            0
        );
    }
);

/* ==========================================================
   CLAIM SYNCHRONIZATION
========================================================== */

test(
    "synchronizeClaims preserves unrelated custom claims",
    async function () {
        const auth =
            createAuthService({
                users: {
                    "user-1":
                        createAuthUser({
                            customClaims: {
                                marketing:
                                    true
                            }
                        })
                }
            });

        const changed =
            await accountService
                .synchronizeClaims({
                    auth:
                        auth,

                    userId:
                        "user-1",

                    role:
                        "admin"
                });

        assert.equal(
            changed,
            true
        );

        assert.deepEqual(
            auth.claimsWrites[0]
                .claims,
            {
                marketing:
                    true,

                role:
                    "admin",

                admin:
                    true,

                superadmin:
                    false
            }
        );
    }
);

test(
    "synchronizeClaims skips matching claims",
    async function () {
        const auth =
            createAuthService({
                users: {
                    "user-1":
                        createAuthUser({
                            customClaims: {
                                role:
                                    "customer",

                                admin:
                                    false,

                                superadmin:
                                    false
                            }
                        })
                }
            });

        const changed =
            await accountService
                .synchronizeClaims({
                    auth:
                        auth,

                    userId:
                        "user-1",

                    role:
                        "customer"
                });

        assert.equal(
            changed,
            false
        );

        assert.equal(
            auth.claimsWrites.length,
            0
        );
    }
);

/* ==========================================================
   SUPER-ADMIN SAFETY
========================================================== */

test(
    "ensureAnotherSuperAdmin accepts another active super-admin",
    async function () {
        const db =
            createDatabase({
                "users/superadmin-1": {
                    role:
                        "superadmin",

                    status:
                        "active"
                },

                "users/superadmin-2": {
                    role:
                        "superadmin",

                    status:
                        "active"
                }
            });

        assert.equal(
            await accountService
                .ensureAnotherSuperAdmin({
                    db:
                        db,

                    excludingUserId:
                        "superadmin-1"
                }),
            true
        );
    }
);

test(
    "ensureAnotherSuperAdmin rejects removal of the final active one",
    async function () {
        const db =
            createDatabase({
                "users/superadmin-1": {
                    role:
                        "superadmin",

                    status:
                        "active"
                },

                "users/superadmin-2": {
                    role:
                        "superadmin",

                    status:
                        "disabled"
                }
            });

        await assert.rejects(
            accountService
                .ensureAnotherSuperAdmin({
                    db:
                        db,

                    excludingUserId:
                        "superadmin-1"
                }),
            function (error) {
                assert.equal(
                    error.code,
                    "failed-precondition"
                );

                assert.match(
                    error.message,
                    /at least one active/i
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   ACCOUNT DELETION
========================================================== */

test(
    "deleteUserAccount anonymizes profile and deletes Auth user",
    async function () {
        const auth =
            createAuthService();

        const db =
            createDatabase({
                "users/user-1": {
                    email:
                        "customer@example.com",

                    displayName:
                        "Test Customer",

                    phoneNumber:
                        "+2348000000000",

                    photoURL:
                        "https://example.com/photo.jpg",

                    addresses: [
                        {
                            city:
                                "Lagos"
                        }
                    ],

                    role:
                        "customer",

                    status:
                        "active"
                }
            });

        const result =
            await accountService
                .deleteUserAccount({
                    db:
                        db,

                    auth:
                        auth,

                    userId:
                        "user-1",

                    administrator: {
                        uid:
                            "admin-1",

                        role:
                            "admin"
                    }
                });

        assert.equal(
            result.success,
            true
        );

        assert.deepEqual(
            auth.deletedUsers,
            [
                "user-1"
            ]
        );

        const profile =
            getDocument(
                db,
                "users/user-1"
            );

        assert.equal(
            profile.status,
            "deleted"
        );

        assert.equal(
            profile.displayName,
            "Deleted customer"
        );

        assert.deepEqual(
            profile.addresses,
            []
        );

        assert.match(
            profile.email,
            /^deleted\+user1@/
        );

        assert.ok(
            profile.deletedAt instanceof
            Timestamp
        );
    }
);

test(
    "deleteUserAccount tolerates an already-missing Auth user",
    async function () {
        const auth =
            createAuthService({
                users: {}
            });

        const db =
            createDatabase({
                "users/missing-user": {
                    email:
                        "missing@example.com",

                    role:
                        "customer",

                    status:
                        "active"
                }
            });

        const result =
            await accountService
                .deleteUserAccount({
                    db:
                        db,

                    auth:
                        auth,

                    userId:
                        "missing-user",

                    administrator: {
                        uid:
                            "admin-1",

                        role:
                            "admin"
                    }
                });

        assert.equal(
            result.success,
            true
        );

        assert.equal(
            auth.deletedUsers.length,
            0
        );
    }
);

/* ==========================================================
   EMAIL ANONYMIZATION
========================================================== */

test(
    "anonymizeEmail preserves the original domain",
    function () {
        assert.equal(
            accountService
                ._internal
                .anonymizeEmail(
                    "customer@example.com",
                    "user-123"
                ),
            "deleted+user123@example.com"
        );
    }
);

test(
    "anonymizeEmail uses a safe fallback domain",
    function () {
        assert.equal(
            accountService
                ._internal
                .anonymizeEmail(
                    "",
                    "user-123"
                ),
            "deleted+user123@deleted.invalid"
        );
    }
);

/* ==========================================================
   AUDIT LOGGING
========================================================== */

test(
    "writeAuditLog records actor, target, and changes",
    async function () {
        const db =
            createDatabase();

        const auditId =
            await accountService
                .writeAuditLog({
                    db:
                        db,

                    action:
                        "user.tested",

                    targetType:
                        "user",

                    targetId:
                        "user-1",

                    actor: {
                        uid:
                            "admin-1",

                        email:
                            "admin@example.com",

                        role:
                            "admin"
                    },

                    changes: {
                        before: {
                            status:
                                "active"
                        },

                        after: {
                            status:
                                "disabled"
                        }
                    }
                });

        assert.match(
            auditId,
            /^generated-/
        );

        const write =
            db.writes.find(
                function (entry) {
                    return entry.path
                        .startsWith(
                            "auditLogs/"
                        );
                }
            );

        assert.ok(write);

        assert.equal(
            write.data.action,
            "user.tested"
        );

        assert.equal(
            write.data.targetId,
            "user-1"
        );

        assert.equal(
            write.data.actor.userId,
            "admin-1"
        );

        assert.ok(
            write.data.createdAt instanceof
            Timestamp
        );
    }
);

test(
    "writeAuditLog returns null when database is unavailable",
    async function () {
        assert.equal(
            await accountService
                .writeAuditLog({
                    action:
                        "test"
                }),
            null
        );
    }
);