"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   AUTHORIZATION TESTS
========================================================== */

const test = require("node:test");

const assert = require(
    "node:assert/strict"
);

const authorization = require(
    "../src/shared/authorization"
);

/* ==========================================================
   TEST HELPERS
========================================================== */

function createCallableRequest(options) {
    const settings =
        options || {};

    return {
        auth:
            settings.auth ===
            undefined
                ? {
                      uid:
                          "user-1",

                      token: {
                          email:
                              "customer@example.com",

                          email_verified:
                              true,

                          role:
                              "customer"
                      }
                  }
                : settings.auth,

        app:
            settings.app ===
            undefined
                ? {
                      token:
                          "app-check-token",

                      appId:
                          "test-app"
                  }
                : settings.app
    };
}

function createHttpRequest(options) {
    const settings =
        options || {};

    return {
        headers:
            settings.headers ||
            {},

        ip:
            settings.ip ||
            "127.0.0.1"
    };
}

function createAuthService(options) {
    const settings =
        options || {};

    return {
        verifyIdToken:
            async function (
                token,
                checkRevoked
            ) {
                if (
                    settings.error
                ) {
                    throw settings.error;
                }

                if (
                    settings.expectedToken
                ) {
                    assert.equal(
                        token,
                        settings.expectedToken
                    );
                }

                assert.equal(
                    checkRevoked,
                    true
                );

                return settings.decodedToken || {
                    uid:
                        "user-1",

                    email:
                        "customer@example.com",

                    email_verified:
                        true,

                    role:
                        "customer"
                };
            }
    };
}

function createDatabase(
    profiles
) {
    const profileMap =
        profiles || {};

    return {
        collection:
            function (
                collectionName
            ) {
                assert.equal(
                    collectionName,
                    "users"
                );

                return {
                    doc:
                        function (
                            userId
                        ) {
                            return {
                                get:
                                    async function () {
                                        const profile =
                                            profileMap[
                                                userId
                                            ];

                                        return {
                                            id:
                                                userId,

                                            exists:
                                                profile !==
                                                undefined,

                                            data:
                                                function () {
                                                    return profile;
                                                }
                                        };
                                    }
                            };
                        }
                };
            }
    };
}

/* ==========================================================
   CALLABLE AUTHENTICATION
========================================================== */

test(
    "requireAuthenticatedCallable returns authenticated identity",
    function () {
        const identity =
            authorization
                .requireAuthenticatedCallable(
                    createCallableRequest()
                );

        assert.deepEqual(
            identity,
            {
                uid:
                    "user-1",

                email:
                    "customer@example.com",

                emailVerified:
                    true,

                role:
                    "customer",

                claims: {
                    email:
                        "customer@example.com",

                    email_verified:
                        true,

                    role:
                        "customer"
                },

                appCheckToken:
                    "app-check-token"
            }
        );
    }
);

test(
    "requireAuthenticatedCallable defaults missing claim values",
    function () {
        const identity =
            authorization
                .requireAuthenticatedCallable(
                    createCallableRequest({
                        auth: {
                            uid:
                                "user-2",

                            token: {}
                        },

                        app:
                            null
                    })
                );

        assert.equal(
            identity.uid,
            "user-2"
        );

        assert.equal(
            identity.email,
            null
        );

        assert.equal(
            identity.emailVerified,
            false
        );

        assert.equal(
            identity.role,
            "customer"
        );

        assert.equal(
            identity.appCheckToken,
            null
        );
    }
);

test(
    "requireAuthenticatedCallable rejects missing authentication",
    function () {
        assert.throws(
            function () {
                authorization
                    .requireAuthenticatedCallable(
                        createCallableRequest({
                            auth:
                                null
                        })
                    );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "unauthenticated"
                );

                assert.equal(
                    error.status,
                    401
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   HTTP AUTHENTICATION
========================================================== */

test(
    "authenticateRequest verifies a bearer token",
    async function () {
        const identity =
            await authorization
                .authenticateRequest({
                    request:
                        createHttpRequest({
                            headers: {
                                authorization:
                                    "Bearer valid-token"
                            }
                        }),

                    auth:
                        createAuthService({
                            expectedToken:
                                "valid-token",

                            decodedToken: {
                                uid:
                                    "admin-1",

                                email:
                                    "admin@example.com",

                                email_verified:
                                    true,

                                role:
                                    "admin",

                                admin:
                                    true
                            }
                        })
                });

        assert.equal(
            identity.uid,
            "admin-1"
        );

        assert.equal(
            identity.email,
            "admin@example.com"
        );

        assert.equal(
            identity.emailVerified,
            true
        );

        assert.equal(
            identity.role,
            "admin"
        );

        assert.equal(
            identity.token,
            "valid-token"
        );

        assert.equal(
            identity.claims.admin,
            true
        );
    }
);

test(
    "authenticateRequest rejects a missing bearer token",
    async function () {
        await assert.rejects(
            authorization
                .authenticateRequest({
                    request:
                        createHttpRequest(),

                    auth:
                        createAuthService()
                }),
            function (error) {
                assert.equal(
                    error.code,
                    "unauthenticated"
                );

                assert.equal(
                    error.status,
                    401
                );

                return true;
            }
        );
    }
);

test(
    "authenticateRequest rejects an empty bearer token",
    async function () {
        await assert.rejects(
            authorization
                .authenticateRequest({
                    request:
                        createHttpRequest({
                            headers: {
                                authorization:
                                    "Bearer "
                            }
                        }),

                    auth:
                        createAuthService()
                }),
            function (error) {
                assert.equal(
                    error.code,
                    "unauthenticated"
                );

                return true;
            }
        );
    }
);

test(
    "authenticateRequest rejects invalid tokens",
    async function () {
        await assert.rejects(
            authorization
                .authenticateRequest({
                    request:
                        createHttpRequest({
                            headers: {
                                authorization:
                                    "Bearer invalid-token"
                            }
                        }),

                    auth:
                        createAuthService({
                            error:
                                new Error(
                                    "Token verification failed"
                                )
                        })
                }),
            function (error) {
                assert.equal(
                    error.code,
                    "unauthenticated"
                );

                assert.equal(
                    error.status,
                    401
                );

                assert.ok(
                    error.cause
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   ADMIN RESOLUTION
========================================================== */

test(
    "resolveAdministrator accepts an admin custom claim",
    async function () {
        const administrator =
            await authorization
                .resolveAdministrator({
                    identity: {
                        uid:
                            "admin-1",

                        email:
                            "admin@example.com",

                        role:
                            "admin",

                        claims: {
                            role:
                                "admin",

                            admin:
                                true
                        }
                    }
                });

        assert.equal(
            administrator.authorized,
            true
        );

        assert.equal(
            administrator.role,
            "admin"
        );

        assert.equal(
            administrator.active,
            true
        );

        assert.equal(
            administrator.source,
            "claim"
        );
    }
);

test(
    "resolveAdministrator accepts boolean admin claim",
    async function () {
        const administrator =
            await authorization
                .resolveAdministrator({
                    identity: {
                        uid:
                            "admin-1",

                        claims: {
                            admin:
                                true
                        }
                    }
                });

        assert.equal(
            administrator.authorized,
            true
        );

        assert.equal(
            administrator.role,
            "admin"
        );

        assert.equal(
            administrator.source,
            "claim"
        );
    }
);

test(
    "Firestore profile role overrides customer claim",
    async function () {
        const administrator =
            await authorization
                .resolveAdministrator({
                    db:
                        createDatabase({
                            "admin-1": {
                                email:
                                    "admin@example.com",

                                role:
                                    "superadmin",

                                status:
                                    "active"
                            }
                        }),

                    identity: {
                        uid:
                            "admin-1",

                        role:
                            "customer",

                        claims: {
                            role:
                                "customer"
                        }
                    }
                });

        assert.equal(
            administrator.authorized,
            true
        );

        assert.equal(
            administrator.role,
            "superadmin"
        );

        assert.equal(
            administrator.source,
            "profile"
        );

        assert.equal(
            administrator.profile.id,
            "admin-1"
        );
    }
);

test(
    "disabled administrator profile is not authorized",
    async function () {
        const administrator =
            await authorization
                .resolveAdministrator({
                    db:
                        createDatabase({
                            "admin-1": {
                                role:
                                    "admin",

                                status:
                                    "disabled"
                            }
                        }),

                    identity: {
                        uid:
                            "admin-1",

                        role:
                            "admin",

                        claims: {
                            role:
                                "admin",

                            admin:
                                true
                        }
                    }
                });

        assert.equal(
            administrator.authorized,
            false
        );

        assert.equal(
            administrator.active,
            false
        );

        assert.equal(
            administrator.role,
            "admin"
        );
    }
);

test(
    "customer is not resolved as administrator",
    async function () {
        const administrator =
            await authorization
                .resolveAdministrator({
                    identity: {
                        uid:
                            "customer-1",

                        role:
                            "customer",

                        claims: {
                            role:
                                "customer"
                        }
                    }
                });

        assert.equal(
            administrator.authorized,
            false
        );

        assert.equal(
            administrator.role,
            "customer"
        );

        assert.equal(
            administrator.source,
            "claim"
        );
    }
);

/* ==========================================================
   CALLABLE ADMIN AUTHORIZATION
========================================================== */

test(
    "requireAdminCallable accepts an administrator",
    async function () {
        const administrator =
            await authorization
                .requireAdminCallable({
                    request:
                        createCallableRequest({
                            auth: {
                                uid:
                                    "admin-1",

                                token: {
                                    email:
                                        "admin@example.com",

                                    email_verified:
                                        true,

                                    role:
                                        "admin",

                                    admin:
                                        true
                                }
                            }
                        })
                });

        assert.equal(
            administrator.authorized,
            true
        );

        assert.equal(
            administrator.role,
            "admin"
        );
    }
);

test(
    "requireAdminCallable rejects customers",
    async function () {
        await assert.rejects(
            authorization
                .requireAdminCallable({
                    request:
                        createCallableRequest()
                }),
            function (error) {
                assert.equal(
                    error.code,
                    "permission-denied"
                );

                assert.equal(
                    error.status,
                    403
                );

                return true;
            }
        );
    }
);

test(
    "requireAdminCallable enforces super-admin access",
    async function () {
        await assert.rejects(
            authorization
                .requireAdminCallable({
                    request:
                        createCallableRequest({
                            auth: {
                                uid:
                                    "admin-1",

                                token: {
                                    role:
                                        "admin",

                                    admin:
                                        true
                                }
                            }
                        }),

                    superAdminOnly:
                        true
                }),
            function (error) {
                assert.equal(
                    error.code,
                    "permission-denied"
                );

                assert.match(
                    error.message,
                    /super-administrator/i
                );

                return true;
            }
        );
    }
);

test(
    "requireAdminCallable accepts a super-administrator",
    async function () {
        const administrator =
            await authorization
                .requireAdminCallable({
                    request:
                        createCallableRequest({
                            auth: {
                                uid:
                                    "superadmin-1",

                                token: {
                                    role:
                                        "superadmin",

                                    admin:
                                        true,

                                    superadmin:
                                        true
                                }
                            }
                        }),

                    superAdminOnly:
                        true
                });

        assert.equal(
            administrator.role,
            "superadmin"
        );

        assert.equal(
            administrator.authorized,
            true
        );
    }
);

/* ==========================================================
   HTTP ADMIN AUTHORIZATION
========================================================== */

test(
    "requireAdminRequest verifies token and administrator role",
    async function () {
        const administrator =
            await authorization
                .requireAdminRequest({
                    request:
                        createHttpRequest({
                            headers: {
                                authorization:
                                    "Bearer admin-token"
                            }
                        }),

                    auth:
                        createAuthService({
                            expectedToken:
                                "admin-token",

                            decodedToken: {
                                uid:
                                    "admin-1",

                                email:
                                    "admin@example.com",

                                role:
                                    "admin",

                                admin:
                                    true
                            }
                        }),

                    db:
                        createDatabase({
                            "admin-1": {
                                role:
                                    "admin",

                                status:
                                    "active"
                            }
                        })
                });

        assert.equal(
            administrator.authorized,
            true
        );

        assert.equal(
            administrator.uid,
            "admin-1"
        );

        assert.equal(
            administrator.role,
            "admin"
        );
    }
);

test(
    "requireAdminRequest rejects a disabled administrator",
    async function () {
        await assert.rejects(
            authorization
                .requireAdminRequest({
                    request:
                        createHttpRequest({
                            headers: {
                                authorization:
                                    "Bearer admin-token"
                            }
                        }),

                    auth:
                        createAuthService({
                            decodedToken: {
                                uid:
                                    "admin-1",

                                role:
                                    "admin",

                                admin:
                                    true
                            }
                        }),

                    db:
                        createDatabase({
                            "admin-1": {
                                role:
                                    "admin",

                                status:
                                    "disabled"
                            }
                        })
                }),
            function (error) {
                assert.equal(
                    error.code,
                    "permission-denied"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   RESOURCE OWNERSHIP
========================================================== */

test(
    "requireResourceOwner accepts the resource owner",
    function () {
        assert.equal(
            authorization
                .requireResourceOwner(
                    {
                        uid:
                            "customer-1"
                    },
                    "customer-1"
                ),
            true
        );
    }
);

test(
    "requireResourceOwner rejects another user",
    function () {
        assert.throws(
            function () {
                authorization
                    .requireResourceOwner(
                        {
                            uid:
                                "customer-1"
                        },
                        "customer-2"
                    );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "permission-denied"
                );

                return true;
            }
        );
    }
);

test(
    "requireResourceOwner rejects unauthenticated identity",
    function () {
        assert.throws(
            function () {
                authorization
                    .requireResourceOwner(
                        null,
                        "customer-1"
                    );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "unauthenticated"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   OWNER OR ADMIN
========================================================== */

test(
    "requireOwnerOrAdmin accepts the owner",
    async function () {
        const result =
            await authorization
                .requireOwnerOrAdmin({
                    identity: {
                        uid:
                            "customer-1",

                        role:
                            "customer",

                        claims: {
                            role:
                                "customer"
                        }
                    },

                    ownerId:
                        "customer-1"
                });

        assert.equal(
            result.authorized,
            true
        );

        assert.equal(
            result.owner,
            true
        );

        assert.equal(
            result.administrator,
            false
        );
    }
);

test(
    "requireOwnerOrAdmin accepts an administrator",
    async function () {
        const result =
            await authorization
                .requireOwnerOrAdmin({
                    identity: {
                        uid:
                            "admin-1",

                        role:
                            "admin",

                        claims: {
                            role:
                                "admin",

                            admin:
                                true
                        }
                    },

                    ownerId:
                        "customer-1"
                });

        assert.equal(
            result.authorized,
            true
        );

        assert.equal(
            result.owner,
            false
        );

        assert.equal(
            result.administrator,
            true
        );

        assert.equal(
            result.identity.role,
            "admin"
        );
    }
);

test(
    "requireOwnerOrAdmin rejects unrelated customers",
    async function () {
        await assert.rejects(
            authorization
                .requireOwnerOrAdmin({
                    identity: {
                        uid:
                            "customer-1",

                        role:
                            "customer",

                        claims: {
                            role:
                                "customer"
                        }
                    },

                    ownerId:
                        "customer-2"
                }),
            function (error) {
                assert.equal(
                    error.code,
                    "permission-denied"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   ACTIVE ACCOUNT
========================================================== */

test(
    "requireActiveUser accepts an active profile",
    async function () {
        const identity =
            await authorization
                .requireActiveUser({
                    identity: {
                        uid:
                            "customer-1",

                        email:
                            "customer@example.com"
                    },

                    db:
                        createDatabase({
                            "customer-1": {
                                email:
                                    "customer@example.com",

                                status:
                                    "active"
                            }
                        })
                });

        assert.equal(
            identity.uid,
            "customer-1"
        );

        assert.equal(
            identity.profile.status,
            "active"
        );

        assert.equal(
            identity.profile.id,
            "customer-1"
        );
    }
);

test(
    "requireActiveUser accepts users without a profile",
    async function () {
        const originalIdentity = {
            uid:
                "customer-1"
        };

        const identity =
            await authorization
                .requireActiveUser({
                    identity:
                        originalIdentity,

                    db:
                        createDatabase()
                });

        assert.equal(
            identity,
            originalIdentity
        );
    }
);

test(
    "requireActiveUser rejects a disabled profile",
    async function () {
        await assert.rejects(
            authorization
                .requireActiveUser({
                    identity: {
                        uid:
                            "customer-1"
                    },

                    db:
                        createDatabase({
                            "customer-1": {
                                status:
                                    "disabled"
                            }
                        })
                }),
            function (error) {
                assert.equal(
                    error.code,
                    "permission-denied"
                );

                assert.equal(
                    error.details.status,
                    "disabled"
                );

                return true;
            }
        );
    }
);

test(
    "requireActiveUser rejects unauthenticated users",
    async function () {
        await assert.rejects(
            authorization
                .requireActiveUser({
                    identity:
                        null,

                    db:
                        createDatabase()
                }),
            function (error) {
                assert.equal(
                    error.code,
                    "unauthenticated"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   EMAIL VERIFICATION
========================================================== */

test(
    "requireVerifiedEmail accepts a verified user",
    function () {
        assert.equal(
            authorization
                .requireVerifiedEmail({
                    uid:
                        "customer-1",

                    emailVerified:
                        true
                }),
            true
        );
    }
);

test(
    "requireVerifiedEmail rejects an unverified user",
    function () {
        assert.throws(
            function () {
                authorization
                    .requireVerifiedEmail({
                        uid:
                            "customer-1",

                        emailVerified:
                            false
                    });
            },
            function (error) {
                assert.equal(
                    error.code,
                    "failed-precondition"
                );

                assert.equal(
                    error.status,
                    412
                );

                return true;
            }
        );
    }
);

test(
    "requireVerifiedEmail rejects unauthenticated users",
    function () {
        assert.throws(
            function () {
                authorization
                    .requireVerifiedEmail(
                        null
                    );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "unauthenticated"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   APP CHECK
========================================================== */

test(
    "requireAppCheck returns the App Check context",
    function () {
        const context =
            authorization
                .requireAppCheck(
                    createCallableRequest()
                );

        assert.deepEqual(
            context,
            {
                token:
                    "app-check-token",

                appId:
                    "test-app"
            }
        );
    }
);

test(
    "requireAppCheck rejects requests without a token",
    function () {
        assert.throws(
            function () {
                authorization
                    .requireAppCheck({
                        app:
                            null
                    });
            },
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
   ROLE HELPERS
========================================================== */

test(
    "normalizeRole accepts supported roles",
    function () {
        assert.equal(
            authorization
                .normalizeRole(
                    " ADMIN "
                ),
            "admin"
        );

        assert.equal(
            authorization
                .normalizeRole(
                    "SUPERADMIN"
                ),
            "superadmin"
        );

        assert.equal(
            authorization
                .normalizeRole(
                    "customer"
                ),
            "customer"
        );
    }
);

test(
    "normalizeRole rejects unsupported roles",
    function () {
        assert.equal(
            authorization
                .normalizeRole(
                    "manager"
                ),
            ""
        );
    }
);

test(
    "hasRole detects a matching role",
    function () {
        assert.equal(
            authorization.hasRole(
                {
                    role:
                        "admin"
                },
                [
                    "admin",
                    "superadmin"
                ]
            ),
            true
        );

        assert.equal(
            authorization.hasRole(
                {
                    role:
                        "customer"
                },
                [
                    "admin",
                    "superadmin"
                ]
            ),
            false
        );
    }
);

test(
    "requireRole accepts allowed roles",
    function () {
        assert.equal(
            authorization.requireRole(
                {
                    uid:
                        "admin-1",

                    role:
                        "admin"
                },
                [
                    "admin",
                    "superadmin"
                ]
            ),
            true
        );
    }
);

test(
    "requireRole rejects disallowed roles",
    function () {
        assert.throws(
            function () {
                authorization.requireRole(
                    {
                        uid:
                            "customer-1",

                        role:
                            "customer"
                    },
                    [
                        "admin",
                        "superadmin"
                    ]
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "permission-denied"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   AUDIT CONTEXT
========================================================== */

test(
    "createAuditContext captures actor and request information",
    function () {
        const context =
            authorization
                .createAuditContext(
                    {
                        uid:
                            "admin-1",

                        email:
                            "admin@example.com",

                        role:
                            "admin"
                    },
                    {
                        ip:
                            "10.0.0.1",

                        headers: {
                            "user-agent":
                                "Test Agent"
                        }
                    }
                );

        assert.equal(
            context.userId,
            "admin-1"
        );

        assert.equal(
            context.email,
            "admin@example.com"
        );

        assert.equal(
            context.role,
            "admin"
        );

        assert.equal(
            context.ipAddress,
            "10.0.0.1"
        );

        assert.equal(
            context.userAgent,
            "Test Agent"
        );

        assert.match(
            context.createdAt,
            /^\d{4}-\d{2}-\d{2}T/
        );
    }
);

test(
    "createAuditContext supports a system actor",
    function () {
        const context =
            authorization
                .createAuditContext(
                    null,
                    null
                );

        assert.equal(
            context.userId,
            null
        );

        assert.equal(
            context.email,
            null
        );

        assert.equal(
            context.role,
            "unknown"
        );

        assert.equal(
            context.ipAddress,
            null
        );

        assert.equal(
            context.userAgent,
            ""
        );
    }
);