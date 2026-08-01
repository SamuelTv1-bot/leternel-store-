"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ACCOUNT LIFECYCLE INTEGRATION TESTS
========================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");

const accountService = require(
    "../../src/accounts/account-service"
);

/* ==========================================================
   VALUE HELPERS
========================================================== */

function cloneValue(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map(cloneValue);
    }

    if (
        value instanceof Date ||
        typeof value.toDate === "function"
    ) {
        return value;
    }

    if (
        typeof value === "object"
    ) {
        return Object.keys(value).reduce(
            function (output, key) {
                output[key] =
                    cloneValue(value[key]);

                return output;
            },
            {}
        );
    }

    return value;
}

function mergeValue(current, update) {
    const output =
        cloneValue(current || {});

    Object.keys(update || {}).forEach(
        function (key) {
            const incoming =
                update[key];

            if (
                incoming &&
                typeof incoming === "object" &&
                !Array.isArray(incoming) &&
                !(incoming instanceof Date) &&
                typeof incoming.toDate !==
                    "function" &&
                output[key] &&
                typeof output[key] === "object" &&
                !Array.isArray(output[key])
            ) {
                output[key] =
                    mergeValue(
                        output[key],
                        incoming
                    );
            } else {
                output[key] =
                    cloneValue(incoming);
            }
        }
    );

    return output;
}

function resolveNestedField(value, path) {
    return String(path)
        .split(".")
        .reduce(
            function (current, key) {
                if (
                    current === null ||
                    current === undefined
                ) {
                    return undefined;
                }

                return current[key];
            },
            value
        );
}

/* ==========================================================
   FIRESTORE TEST DATABASE
========================================================== */

function createSnapshot(reference, data) {
    return {
        id:
            reference.id,

        ref:
            reference,

        exists:
            data !== undefined,

        data:
            function () {
                return cloneValue(data);
            },

        get:
            function (field) {
                return resolveNestedField(
                    data,
                    field
                );
            }
    };
}

function createDatabase(initialDocuments) {
    const documents =
        new Map();

    const writes = [];

    let generatedId =
        0;

    Object.keys(
        initialDocuments || {}
    ).forEach(function (path) {
        documents.set(
            path,
            cloneValue(
                initialDocuments[path]
            )
        );
    });

    function createDocumentReference(
        collectionName,
        documentId
    ) {
        const id =
            documentId ||
            "generated-" +
                String(++generatedId);

        const path =
            collectionName +
            "/" +
            id;

        const reference = {
            id:
                id,

            path:
                path,

            get:
                async function () {
                    return createSnapshot(
                        reference,
                        documents.get(path)
                    );
                },

            create:
                async function (data) {
                    if (
                        documents.has(path)
                    ) {
                        const error =
                            new Error(
                                "Document already exists"
                            );

                        error.code =
                            "already-exists";

                        throw error;
                    }

                    documents.set(
                        path,
                        cloneValue(data)
                    );

                    writes.push({
                        operation:
                            "create",

                        path:
                            path,

                        data:
                            cloneValue(data)
                    });
                },

            set:
                async function (
                    data,
                    options
                ) {
                    const existing =
                        documents.get(path);

                    documents.set(
                        path,
                        options &&
                        options.merge
                            ? mergeValue(
                                  existing,
                                  data
                              )
                            : cloneValue(data)
                    );

                    writes.push({
                        operation:
                            "set",

                        path:
                            path,

                        data:
                            cloneValue(data),

                        options:
                            options || null
                    });
                },

            update:
                async function (data) {
                    const existing =
                        documents.get(path);

                    if (!existing) {
                        const error =
                            new Error(
                                "Document does not exist"
                            );

                        error.code =
                            "not-found";

                        throw error;
                    }

                    documents.set(
                        path,
                        mergeValue(
                            existing,
                            data
                        )
                    );

                    writes.push({
                        operation:
                            "update",

                        path:
                            path,

                        data:
                            cloneValue(data)
                    });
                },

            delete:
                async function () {
                    documents.delete(path);

                    writes.push({
                        operation:
                            "delete",

                        path:
                            path
                    });
                }
        };

        return reference;
    }

    function listCollectionDocuments(
        collectionName
    ) {
        const prefix =
            collectionName +
            "/";

        return Array.from(
            documents.entries()
        )
            .filter(
                function (entry) {
                    if (
                        !entry[0].startsWith(
                            prefix
                        )
                    ) {
                        return false;
                    }

                    return !entry[0]
                        .slice(prefix.length)
                        .includes("/");
                }
            )
            .map(
                function (entry) {
                    const id =
                        entry[0].slice(
                            prefix.length
                        );

                    return {
                        id:
                            id,

                        data:
                            cloneValue(
                                entry[1]
                            ),

                        ref:
                            createDocumentReference(
                                collectionName,
                                id
                            )
                    };
                }
            );
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
                    filters.push({
                        field:
                            field,

                        operator:
                            operator,

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
                    let matching =
                        listCollectionDocuments(
                            options.collectionName
                        );

                    matching =
                        matching.filter(
                            function (document) {
                                return filters.every(
                                    function (filter) {
                                        const actual =
                                            resolveNestedField(
                                                document.data,
                                                filter.field
                                            );

                                        if (
                                            filter.operator ===
                                            "=="
                                        ) {
                                            return (
                                                actual ===
                                                filter.value
                                            );
                                        }

                                        if (
                                            filter.operator ===
                                            "in"
                                        ) {
                                            return (
                                                Array.isArray(
                                                    filter.value
                                                ) &&
                                                filter.value
                                                    .includes(
                                                        actual
                                                    )
                                            );
                                        }

                                        throw new Error(
                                            "Unsupported query operator: " +
                                            filter.operator
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

                    const snapshots =
                        matching.map(
                            function (document) {
                                return createSnapshot(
                                    document.ref,
                                    document.data
                                );
                            }
                        );

                    return {
                        size:
                            snapshots.length,

                        empty:
                            snapshots.length ===
                            0,

                        docs:
                            snapshots
                    };
                }
        };

        return query;
    }

    return {
        documents:
            documents,

        writes:
            writes,

        collection:
            function (collectionName) {
                return {
                    doc:
                        function (documentId) {
                            return createDocumentReference(
                                collectionName,
                                documentId
                            );
                        },

                    where:
                        function (
                            field,
                            operator,
                            value
                        ) {
                            return createQuery({
                                collectionName:
                                    collectionName,

                                filters: [
                                    {
                                        field:
                                            field,

                                        operator:
                                            operator,

                                        value:
                                            value
                                    }
                                ]
                            });
                        },

                    get:
                        async function () {
                            const documents =
                                listCollectionDocuments(
                                    collectionName
                                );

                            const snapshots =
                                documents.map(
                                    function (document) {
                                        return createSnapshot(
                                            document.ref,
                                            document.data
                                        );
                                    }
                                );

                            return {
                                size:
                                    snapshots.length,

                                empty:
                                    snapshots.length ===
                                    0,

                                docs:
                                    snapshots
                            };
                        }
                };
            },

        runTransaction:
            async function (callback) {
                const transaction = {
                    get:
                        async function (
                            reference
                        ) {
                            return reference.get();
                        },

                    create:
                        function (
                            reference,
                            data
                        ) {
                            if (
                                documents.has(
                                    reference.path
                                )
                            ) {
                                const error =
                                    new Error(
                                        "Document already exists"
                                    );

                                error.code =
                                    "already-exists";

                                throw error;
                            }

                            documents.set(
                                reference.path,
                                cloneValue(data)
                            );

                            writes.push({
                                operation:
                                    "transaction-create",

                                path:
                                    reference.path,

                                data:
                                    cloneValue(data)
                            });
                        },

                    set:
                        function (
                            reference,
                            data,
                            options
                        ) {
                            const existing =
                                documents.get(
                                    reference.path
                                );

                            documents.set(
                                reference.path,
                                options &&
                                options.merge
                                    ? mergeValue(
                                          existing,
                                          data
                                      )
                                    : cloneValue(
                                          data
                                      )
                            );

                            writes.push({
                                operation:
                                    "transaction-set",

                                path:
                                    reference.path,

                                data:
                                    cloneValue(data),

                                options:
                                    options || null
                            });
                        },

                    update:
                        function (
                            reference,
                            data
                        ) {
                            const existing =
                                documents.get(
                                    reference.path
                                );

                            if (!existing) {
                                const error =
                                    new Error(
                                        "Document does not exist"
                                    );

                                error.code =
                                    "not-found";

                                throw error;
                            }

                            documents.set(
                                reference.path,
                                mergeValue(
                                    existing,
                                    data
                                )
                            );

                            writes.push({
                                operation:
                                    "transaction-update",

                                path:
                                    reference.path,

                                data:
                                    cloneValue(data)
                            });
                        }
                };

                return callback(transaction);
            }
    };
}

/* ==========================================================
   AUTH TEST SERVICE
========================================================== */

function createAuthUser(overrides) {
    return Object.assign(
        {
            uid:
                "customer-1",

            email:
                "customer@example.com",

            emailVerified:
                true,

            displayName:
                "Test Customer",

            photoURL:
                "",

            disabled:
                false,

            customClaims: {
                role:
                    "customer",

                admin:
                    false,

                superadmin:
                    false
            }
        },
        overrides || {}
    );
}

function createAuthService(initialUsers) {
    const users =
        new Map();

    const writes = [];

    Object.keys(
        initialUsers || {}
    ).forEach(function (userId) {
        users.set(
            userId,
            createAuthUser(
                Object.assign(
                    {
                        uid:
                            userId
                    },
                    initialUsers[userId]
                )
            )
        );
    });

    return {
        users:
            users,

        writes:
            writes,

        getUser:
            async function (userId) {
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

                return user;
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

                Object.assign(
                    user,
                    cloneValue(changes)
                );

                writes.push({
                    operation:
                        "updateUser",

                    userId:
                        userId,

                    changes:
                        cloneValue(changes)
                });

                return user;
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

                user.customClaims =
                    cloneValue(claims);

                writes.push({
                    operation:
                        "setCustomUserClaims",

                    userId:
                        userId,

                    claims:
                        cloneValue(claims)
                });
            },

        revokeRefreshTokens:
            async function (userId) {
                writes.push({
                    operation:
                        "revokeRefreshTokens",

                    userId:
                        userId
                });
            },

        deleteUser:
            async function (userId) {
                if (!users.has(userId)) {
                    const error =
                        new Error(
                            "User not found"
                        );

                    error.code =
                        "auth/user-not-found";

                    throw error;
                }

                users.delete(userId);

                writes.push({
                    operation:
                        "deleteUser",

                    userId:
                        userId
                });
            }
    };
}

/* ==========================================================
   FIXTURE HELPERS
========================================================== */

function createAdministrator(overrides) {
    return Object.assign(
        {
            uid:
                "admin-1",

            email:
                "admin@example.com",

            role:
                "admin"
        },
        overrides || {}
    );
}

function createSuperAdministrator() {
    return createAdministrator({
        uid:
            "superadmin-1",

        email:
            "owner@example.com",

        role:
            "superadmin"
    });
}

function getDocument(database, path) {
    return database.documents
        .get(path);
}

function getAuditEntries(database) {
    return Array.from(
        database.documents.entries()
    )
        .filter(
            function (entry) {
                return entry[0]
                    .startsWith(
                        "auditLogs/"
                    );
            }
        )
        .map(
            function (entry) {
                return entry[1];
            }
        );
}

/* ==========================================================
   PROFILE CREATION
========================================================== */

test(
    "new customer profile receives normalized defaults and Auth claims",
    async function () {
        const db =
            createDatabase();

        const auth =
            createAuthService({
                "customer-1": {
                    email:
                        "CUSTOMER@EXAMPLE.COM",

                    displayName:
                        "Test Customer",

                    photoURL:
                        "https://example.com/avatar.jpg",

                    emailVerified:
                        true,

                    customClaims: {}
                }
            });

        const result =
            await accountService
                .handleProfileCreated({
                    db:
                        db,

                    auth:
                        auth,

                    userId:
                        "customer-1",

                    profile: {
                        email:
                            "customer@example.com",

                        displayName:
                            "Test Customer"
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
                "users/customer-1"
            );

        assert.equal(
            profile.uid,
            "customer-1"
        );

        assert.equal(
            profile.email,
            "customer@example.com"
        );

        assert.equal(
            profile.displayName,
            "Test Customer"
        );

        assert.equal(
            profile.photoURL,
            "https://example.com/avatar.jpg"
        );

        assert.equal(
            profile.emailVerified,
            true
        );

        assert.equal(
            profile.role,
            "customer"
        );

        assert.equal(
            profile.status,
            "active"
        );

        assert.deepEqual(
            profile.addresses,
            []
        );

        assert.equal(
            profile.preferences.currency,
            "NGN"
        );

        assert.equal(
            auth.users.get(
                "customer-1"
            ).customClaims.role,
            "customer"
        );

        assert.equal(
            auth.users.get(
                "customer-1"
            ).customClaims.admin,
            false
        );
    }
);

test(
    "profile creation preserves customer preferences and addresses",
    async function () {
        const db =
            createDatabase();

        const auth =
            createAuthService({
                "customer-1": {
                    email:
                        "customer@example.com"
                }
            });

        await accountService
            .handleProfileCreated({
                db:
                    db,

                auth:
                    auth,

                userId:
                    "customer-1",

                profile: {
                    preferences: {
                        currency:
                            "USD",

                        language:
                            "fr",

                        marketingEmails:
                            false
                    },

                    addresses: [
                        {
                            id:
                                "home",

                            label:
                                "Home",

                            addressLine1:
                                "10 Example Road",

                            city:
                                "Lagos",

                            country:
                                "Nigeria"
                        }
                    ]
                }
            });

        const profile =
            getDocument(
                db,
                "users/customer-1"
            );

        assert.deepEqual(
            profile.preferences,
            {
                currency:
                    "USD",

                language:
                    "fr",

                marketingEmails:
                    false
            }
        );

        assert.equal(
            profile.addresses.length,
            1
        );

        assert.equal(
            profile.addresses[0].id,
            "home"
        );
    }
);

/* ==========================================================
   PROFILE-TO-AUTH SYNCHRONIZATION
========================================================== */

test(
    "profile role change synchronizes Auth claims and revokes sessions",
    async function () {
        const db =
            createDatabase({
                "users/customer-1": {
                    uid:
                        "customer-1",

                    email:
                        "customer@example.com",

                    role:
                        "admin",

                    status:
                        "active"
                }
            });

        const auth =
            createAuthService({
                "customer-1": {
                    email:
                        "customer@example.com",

                    customClaims: {
                        marketing:
                            true,

                        role:
                            "customer",

                        admin:
                            false,

                        superadmin:
                            false
                    }
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
                        "customer-1",

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

        assert.deepEqual(
            auth.users.get(
                "customer-1"
            ).customClaims,
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

        assert.ok(
            auth.writes.some(
                function (write) {
                    return (
                        write.operation ===
                            "revokeRefreshTokens" &&
                        write.userId ===
                            "customer-1"
                    );
                }
            )
        );
    }
);

test(
    "profile status change disables Auth and revokes sessions",
    async function () {
        const db =
            createDatabase({
                "users/customer-1": {
                    uid:
                        "customer-1",

                    role:
                        "customer",

                    status:
                        "disabled"
                }
            });

        const auth =
            createAuthService({
                "customer-1": {
                    disabled:
                        false
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
                        "customer-1",

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
            result.statusChanged,
            true
        );

        assert.equal(
            auth.users.get(
                "customer-1"
            ).disabled,
            true
        );

        assert.ok(
            auth.writes.some(
                function (write) {
                    return (
                        write.operation ===
                            "revokeRefreshTokens"
                    );
                }
            )
        );
    }
);

test(
    "unchanged profile produces no Auth writes",
    async function () {
        const db =
            createDatabase();

        const auth =
            createAuthService({
                "customer-1": {
                    disabled:
                        false,

                    customClaims: {
                        role:
                            "customer",

                        admin:
                            false,

                        superadmin:
                            false
                    }
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
                        "customer-1",

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
            auth.writes.length,
            0
        );
    }
);

/* ==========================================================
   ROLE LIFECYCLE
========================================================== */

test(
    "super-administrator promotes a customer to administrator",
    async function () {
        const db =
            createDatabase({
                "users/customer-1": {
                    uid:
                        "customer-1",

                    email:
                        "customer@example.com",

                    role:
                        "customer",

                    status:
                        "active"
                },

                "users/superadmin-1": {
                    uid:
                        "superadmin-1",

                    email:
                        "owner@example.com",

                    role:
                        "superadmin",

                    status:
                        "active"
                }
            });

        const auth =
            createAuthService({
                "customer-1": {
                    email:
                        "customer@example.com",

                    customClaims: {
                        newsletter:
                            true,

                        role:
                            "customer",

                        admin:
                            false,

                        superadmin:
                            false
                    }
                },

                "superadmin-1": {
                    email:
                        "owner@example.com",

                    customClaims: {
                        role:
                            "superadmin",

                        admin:
                            true,

                        superadmin:
                            true
                    }
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
                        "customer-1",

                    role:
                        "admin",

                    administrator:
                        createSuperAdministrator()
                });

        assert.equal(
            result.success,
            true
        );

        assert.equal(
            result.previousRole,
            "customer"
        );

        assert.equal(
            result.role,
            "admin"
        );

        const profile =
            getDocument(
                db,
                "users/customer-1"
            );

        assert.equal(
            profile.role,
            "admin"
        );

        assert.equal(
            profile.roleUpdatedBy,
            "superadmin-1"
        );

        assert.deepEqual(
            auth.users.get(
                "customer-1"
            ).customClaims,
            {
                newsletter:
                    true,

                role:
                    "admin",

                admin:
                    true,

                superadmin:
                    false
            }
        );

        assert.ok(
            auth.writes.some(
                function (write) {
                    return (
                        write.operation ===
                            "revokeRefreshTokens"
                    );
                }
            )
        );

        const audit =
            getAuditEntries(db);

        assert.ok(
            audit.some(
                function (entry) {
                    return /role/i.test(
                        entry.action
                    );
                }
            )
        );
    }
);

test(
    "super-administrator demotes an administrator to customer",
    async function () {
        const db =
            createDatabase({
                "users/admin-2": {
                    uid:
                        "admin-2",

                    role:
                        "admin",

                    status:
                        "active"
                },

                "users/superadmin-1": {
                    uid:
                        "superadmin-1",

                    role:
                        "superadmin",

                    status:
                        "active"
                }
            });

        const auth =
            createAuthService({
                "admin-2": {
                    customClaims: {
                        role:
                            "admin",

                        admin:
                            true,

                        superadmin:
                            false
                    }
                },

                "superadmin-1": {
                    customClaims: {
                        role:
                            "superadmin",

                        admin:
                            true,

                        superadmin:
                            true
                    }
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
                        "admin-2",

                    role:
                        "customer",

                    administrator:
                        createSuperAdministrator()
                });

        assert.equal(
            result.previousRole,
            "admin"
        );

        assert.equal(
            result.role,
            "customer"
        );

        assert.equal(
            getDocument(
                db,
                "users/admin-2"
            ).role,
            "customer"
        );

        assert.equal(
            auth.users.get(
                "admin-2"
            ).customClaims.admin,
            false
        );
    }
);

test(
    "super-administrator cannot remove their own role",
    async function () {
        const db =
            createDatabase({
                "users/superadmin-1": {
                    uid:
                        "superadmin-1",

                    role:
                        "superadmin",

                    status:
                        "active"
                }
            });

        const auth =
            createAuthService({
                "superadmin-1": {
                    customClaims: {
                        role:
                            "superadmin",

                        admin:
                            true,

                        superadmin:
                            true
                    }
                }
            });

        await assert.rejects(
            accountService
                .setUserRole({
                    db:
                        db,

                    auth:
                        auth,

                    userId:
                        "superadmin-1",

                    role:
                        "admin",

                    administrator:
                        createSuperAdministrator()
                }),
            function (error) {
                assert.equal(
                    error.code,
                    "failed-precondition"
                );

                return true;
            }
        );

        assert.equal(
            getDocument(
                db,
                "users/superadmin-1"
            ).role,
            "superadmin"
        );
    }
);

test(
    "final active super-administrator cannot be demoted",
    async function () {
        const db =
            createDatabase({
                "users/superadmin-1": {
                    uid:
                        "superadmin-1",

                    role:
                        "superadmin",

                    status:
                        "active"
                },

                "users/superadmin-2": {
                    uid:
                        "superadmin-2",

                    role:
                        "superadmin",

                    status:
                        "disabled"
                }
            });

        const auth =
            createAuthService({
                "superadmin-1": {
                    customClaims: {
                        role:
                            "superadmin",

                        admin:
                            true,

                        superadmin:
                            true
                    }
                },

                "superadmin-2": {
                    disabled:
                        true,

                    customClaims: {
                        role:
                            "superadmin",

                        admin:
                            true,

                        superadmin:
                            true
                    }
                }
            });

        await assert.rejects(
            accountService
                .setUserRole({
                    db:
                        db,

                    auth:
                        auth,

                    userId:
                        "superadmin-1",

                    role:
                        "customer",

                    administrator: {
                        uid:
                            "different-superadmin",

                        email:
                            "different@example.com",

                        role:
                            "superadmin"
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
   STATUS LIFECYCLE
========================================================== */

test(
    "administrator disables a customer and revokes access",
    async function () {
        const db =
            createDatabase({
                "users/customer-1": {
                    uid:
                        "customer-1",

                    email:
                        "customer@example.com",

                    role:
                        "customer",

                    status:
                        "active"
                }
            });

        const auth =
            createAuthService({
                "customer-1": {
                    email:
                        "customer@example.com",

                    disabled:
                        false
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
                        "customer-1",

                    status:
                        "disabled",

                    reason:
                        "Fraud investigation",

                    administrator:
                        createAdministrator()
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
            auth.users.get(
                "customer-1"
            ).disabled,
            true
        );

        const profile =
            getDocument(
                db,
                "users/customer-1"
            );

        assert.equal(
            profile.status,
            "disabled"
        );

        assert.equal(
            profile.statusReason,
            "Fraud investigation"
        );

        assert.equal(
            profile.statusUpdatedBy,
            "admin-1"
        );

        assert.ok(
            profile.disabledAt
        );
    }
);

test(
    "administrator reactivates a disabled customer",
    async function () {
        const db =
            createDatabase({
                "users/customer-1": {
                    uid:
                        "customer-1",

                    role:
                        "customer",

                    status:
                        "disabled",

                    statusReason:
                        "Previous review"
                }
            });

        const auth =
            createAuthService({
                "customer-1": {
                    disabled:
                        true
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
                        "customer-1",

                    status:
                        "active",

                    reason:
                        "Review completed",

                    administrator:
                        createAdministrator()
                });

        assert.equal(
            result.status,
            "active"
        );

        assert.equal(
            auth.users.get(
                "customer-1"
            ).disabled,
            false
        );

        const profile =
            getDocument(
                db,
                "users/customer-1"
            );

        assert.equal(
            profile.status,
            "active"
        );

        assert.ok(
            profile.reactivatedAt
        );
    }
);

test(
    "administrator cannot disable their own account",
    async function () {
        const db =
            createDatabase({
                "users/admin-1": {
                    uid:
                        "admin-1",

                    role:
                        "admin",

                    status:
                        "active"
                }
            });

        const auth =
            createAuthService({
                "admin-1": {
                    customClaims: {
                        role:
                            "admin",

                        admin:
                            true,

                        superadmin:
                            false
                    }
                }
            });

        await assert.rejects(
            accountService
                .setUserStatus({
                    db:
                        db,

                    auth:
                        auth,

                    userId:
                        "admin-1",

                    status:
                        "disabled",

                    reason:
                        "Self-disable",

                    administrator:
                        createAdministrator()
                }),
            function (error) {
                assert.equal(
                    error.code,
                    "failed-precondition"
                );

                return true;
            }
        );

        assert.equal(
            auth.users.get(
                "admin-1"
            ).disabled,
            false
        );
    }
);

/* ==========================================================
   CLAIM SYNCHRONIZATION
========================================================== */

test(
    "claim synchronization preserves unrelated custom claims",
    async function () {
        const auth =
            createAuthService({
                "customer-1": {
                    customClaims: {
                        betaTester:
                            true,

                        preferredRegion:
                            "ng",

                        role:
                            "customer",

                        admin:
                            false,

                        superadmin:
                            false
                    }
                }
            });

        const changed =
            await accountService
                .synchronizeClaims({
                    auth:
                        auth,

                    userId:
                        "customer-1",

                    role:
                        "admin"
                });

        assert.equal(
            changed,
            true
        );

        assert.deepEqual(
            auth.users.get(
                "customer-1"
            ).customClaims,
            {
                betaTester:
                    true,

                preferredRegion:
                    "ng",

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
    "matching claims do not trigger another Auth write",
    async function () {
        const auth =
            createAuthService({
                "customer-1": {
                    customClaims: {
                        role:
                            "customer",

                        admin:
                            false,

                        superadmin:
                            false
                    }
                }
            });

        const changed =
            await accountService
                .synchronizeClaims({
                    auth:
                        auth,

                    userId:
                        "customer-1",

                    role:
                        "customer"
                });

        assert.equal(
            changed,
            false
        );

        assert.equal(
            auth.writes.length,
            0
        );
    }
);

/* ==========================================================
   ACCOUNT DELETION
========================================================== */

test(
    "account deletion anonymizes the profile and removes Auth user",
    async function () {
        const db =
            createDatabase({
                "users/customer-1": {
                    uid:
                        "customer-1",

                    email:
                        "customer@example.com",

                    displayName:
                        "Test Customer",

                    phone:
                        "+2348000000000",

                    phoneNumber:
                        "+2348000000000",

                    photoURL:
                        "https://example.com/avatar.jpg",

                    addresses: [
                        {
                            id:
                                "home",

                            city:
                                "Lagos"
                        }
                    ],

                    preferences: {
                        currency:
                            "NGN"
                    },

                    role:
                        "customer",

                    status:
                        "active"
                },

                "orders/order-1": {
                    userId:
                        "customer-1",

                    customer: {
                        email:
                            "customer@example.com",

                        displayName:
                            "Test Customer"
                    },

                    status:
                        "delivered",

                    paymentStatus:
                        "paid",

                    total:
                        250000
                }
            });

        const auth =
            createAuthService({
                "customer-1": {
                    email:
                        "customer@example.com"
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
                        "customer-1",

                    administrator:
                        createAdministrator()
                });

        assert.equal(
            result.success,
            true
        );

        assert.equal(
            auth.users.has(
                "customer-1"
            ),
            false
        );

        const profile =
            getDocument(
                db,
                "users/customer-1"
            );

        assert.equal(
            profile.status,
            "deleted"
        );

        assert.equal(
            profile.displayName,
            "Deleted customer"
        );

        assert.match(
            profile.email,
            /^deleted\+customer1@/
        );

        assert.equal(
            profile.phone,
            ""
        );

        assert.equal(
            profile.phoneNumber,
            ""
        );

        assert.equal(
            profile.photoURL,
            ""
        );

        assert.deepEqual(
            profile.addresses,
            []
        );

        assert.ok(
            profile.deletedAt
        );

        assert.equal(
            profile.deletedBy,
            "admin-1"
        );

        assert.ok(
            getDocument(
                db,
                "orders/order-1"
            )
        );

        const audit =
            getAuditEntries(db);

        assert.ok(
            audit.some(
                function (entry) {
                    return /delet/i.test(
                        entry.action
                    );
                }
            )
        );
    }
);

test(
    "account deletion succeeds when Auth user is already missing",
    async function () {
        const db =
            createDatabase({
                "users/missing-user": {
                    uid:
                        "missing-user",

                    email:
                        "missing@example.com",

                    displayName:
                        "Missing User",

                    role:
                        "customer",

                    status:
                        "active",

                    addresses: []
                }
            });

        const auth =
            createAuthService();

        const result =
            await accountService
                .deleteUserAccount({
                    db:
                        db,

                    auth:
                        auth,

                    userId:
                        "missing-user",

                    administrator:
                        createAdministrator()
                });

        assert.equal(
            result.success,
            true
        );

        assert.equal(
            getDocument(
                db,
                "users/missing-user"
            ).status,
            "deleted"
        );
    }
);

/* ==========================================================
   AUDIT ATTRIBUTION
========================================================== */

test(
    "role, status, and deletion actions create attributable audit logs",
    async function () {
        const db =
            createDatabase({
                "users/customer-1": {
                    uid:
                        "customer-1",

                    email:
                        "customer@example.com",

                    role:
                        "customer",

                    status:
                        "active"
                },

                "users/customer-2": {
                    uid:
                        "customer-2",

                    email:
                        "customer-2@example.com",

                    role:
                        "customer",

                    status:
                        "active"
                },

                "users/superadmin-1": {
                    uid:
                        "superadmin-1",

                    email:
                        "owner@example.com",

                    role:
                        "superadmin",

                    status:
                        "active"
                }
            });

        const auth =
            createAuthService({
                "customer-1": {
                    email:
                        "customer@example.com"
                },

                "customer-2": {
                    email:
                        "customer-2@example.com"
                },

                "superadmin-1": {
                    email:
                        "owner@example.com",

                    customClaims: {
                        role:
                            "superadmin",

                        admin:
                            true,

                        superadmin:
                            true
                    }
                }
            });

        await accountService
            .setUserRole({
                db:
                    db,

                auth:
                    auth,

                userId:
                    "customer-1",

                role:
                    "admin",

                administrator:
                    createSuperAdministrator()
            });

        await accountService
            .setUserStatus({
                db:
                    db,

                auth:
                    auth,

                userId:
                    "customer-2",

                status:
                    "disabled",

                reason:
                    "Policy violation",

                administrator:
                    createAdministrator()
            });

        await accountService
            .deleteUserAccount({
                db:
                    db,

                auth:
                    auth,

                userId:
                    "customer-2",

                administrator:
                    createAdministrator()
            });

        const auditEntries =
            getAuditEntries(db);

        assert.ok(
            auditEntries.length >=
            3
        );

        auditEntries.forEach(
            function (entry) {
                assert.ok(
                    entry.action
                );

                assert.ok(
                    entry.targetId
                );

                assert.ok(
                    entry.createdAt
                );

                const actor =
                    entry.actor || {};

                assert.ok(
                    actor.userId ||
                    entry.actorId ||
                    entry.performedBy
                );
            }
        );
    }
);