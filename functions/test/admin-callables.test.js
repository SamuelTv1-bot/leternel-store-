"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ADMIN CALLABLES TESTS

   Run with:
   node --test functions/test/admin-callables.test.js
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

const adminCallables =
    require(
        "../src/admin/admin-callables"
    );

Module._load =
    originalLoad;

const {
    createAdminCallables,
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

    constants
} =
    adminCallables;

/* ==========================================================
   MOCK SERVICE
========================================================== */

function createMockService(
    overrides
) {
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

    const defaultActor = {
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

    const service = {
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

            return cloneValue(
                defaultActor
            );
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

                        email:
                            "owner@example.com",

                        isAdministrator:
                            true,

                        primaryRole:
                            "owner",

                        roles: [
                            "owner"
                        ],

                        permissions: [
                            "*"
                        ]
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
                email:
                    uid +
                    "@example.com",

                isAdministrator:
                    true,

                primaryRole:
                    "admin",

                roles: [
                    "admin"
                ],

                permissions: [
                    "admin.access"
                ]
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
                        request.role,

                    roles: [
                        request.role
                    ],

                    permissions:
                        request.permissions ||
                        []
                },

                auditId:
                    "audit-role-1"
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
                        false,

                    roles:
                        [],

                    permissions:
                        request.preservePermissions
                            ? [
                                  "reports.read"
                              ]
                            : []
                },

                auditId:
                    "audit-remove-1"
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
                    "audit-grant-1"
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
                    "audit-revoke-1"
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
                        cloneValue(
                            request.claims
                        )
                },

                auditId:
                    "audit-claims-1"
            };
        }
    };

    Object.assign(
        service,
        overrides ||
        {}
    );

    return {
        service,
        calls
    };
}

function createAuthenticatedContext(
    overrides
) {
    const source =
        overrides ||
        {};

    return {
        auth: {
            uid:
                source.uid ||
                "owner-1",

            token:
                Object.assign(
                    {
                        email:
                            "owner@example.com",

                        name:
                            "Store Owner",

                        email_verified:
                            true,

                        admin:
                            true,

                        role:
                            "owner",

                        roles: [
                            "owner"
                        ],

                        permissions: [
                            "*"
                        ],

                        aud:
                            "project-id",

                        iss:
                            "https://securetoken.google.com/project-id",

                        sub:
                            "owner-1",

                        user_id:
                            "owner-1",

                        firebase: {
                            sign_in_provider:
                                "password"
                        }
                    },
                    source.token ||
                    {}
                )
        }
    };
}

/* ==========================================================
   CONSTANTS
========================================================== */

test(
    "exports callable constants",
    function () {
        assert.equal(
            constants.DEFAULT_REGION,
            "europe-west1"
        );

        assert.equal(
            constants.DEFAULT_RUNTIME_OPTIONS.timeoutSeconds,
            60
        );

        assert.equal(
            constants.DEFAULT_RUNTIME_OPTIONS.memory,
            "256MB"
        );

        assert.equal(
            constants.CALLABLE_NAMES.listAdministrators,
            "listAdministrators"
        );

        assert.equal(
            constants.CALLABLE_NAMES.patchAdministratorClaims,
            "patchAdministratorClaims"
        );
    }
);

/* ==========================================================
   NORMALIZATION
========================================================== */

test(
    "normalizes callable data",
    function () {
        const payload = {
            uid:
                "user-1"
        };

        assert.equal(
            normalizeCallableData(
                payload
            ),
            payload
        );

        assert.deepEqual(
            normalizeCallableData(
                null
            ),
            {}
        );

        assert.deepEqual(
            normalizeCallableData(
                []
            ),
            {}
        );

        assert.deepEqual(
            normalizeCallableData(
                "invalid"
            ),
            {}
        );
    }
);

test(
    "normalizes list payload",
    function () {
        assert.deepEqual(
            normalizeListPayload({}),
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
            normalizeListPayload({
                pageSize:
                    100,

                pageToken:
                    "100",

                fetchAll:
                    false
            }),
            {
                pageSize:
                    100,

                pageToken:
                    "100",

                fetchAll:
                    false
            }
        );
    }
);

test(
    "rejects invalid list page sizes",
    function () {
        assert.throws(
            function () {
                normalizeListPayload({
                    pageSize:
                        1001
                });
            },
            function (
                error
            ) {
                assert.ok(
                    error instanceof
                    AdminCallableError
                );

                assert.equal(
                    error.code,
                    "admin-callables/invalid-argument"
                );

                return true;
            }
        );
    }
);

test(
    "normalizes required strings",
    function () {
        assert.equal(
            normalizeRequiredString(
                " user-1 ",
                "User ID"
            ),
            "user-1"
        );

        assert.throws(
            function () {
                normalizeRequiredString(
                    "",
                    "User ID"
                );
            },
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "admin-callables/invalid-argument"
                );

                return true;
            }
        );
    }
);

test(
    "normalizes optional strings",
    function () {
        assert.equal(
            normalizeOptionalString(
                " value "
            ),
            "value"
        );

        assert.equal(
            normalizeOptionalString(
                ""
            ),
            null
        );

        assert.equal(
            normalizeOptionalString(
                undefined
            ),
            null
        );
    }
);

test(
    "normalizes positive integers",
    function () {
        assert.equal(
            normalizePositiveInteger(
                undefined,
                25,
                100,
                "Value"
            ),
            25
        );

        assert.equal(
            normalizePositiveInteger(
                50,
                25,
                100,
                "Value"
            ),
            50
        );

        assert.throws(
            function () {
                normalizePositiveInteger(
                    0,
                    25,
                    100,
                    "Value"
                );
            },
            /positive integer/
        );

        assert.throws(
            function () {
                normalizePositiveInteger(
                    101,
                    25,
                    100,
                    "Value"
                );
            },
            /no greater than 100/
        );
    }
);

/* ==========================================================
   CLAIM SANITIZATION
========================================================== */

test(
    "sanitizes Firebase standard token claims",
    function () {
        const claims =
            sanitizeCallableClaims({
                aud:
                    "project",

                auth_time:
                    1,

                email:
                    "owner@example.com",

                email_verified:
                    true,

                exp:
                    2,

                firebase: {
                    sign_in_provider:
                        "password"
                },

                iat:
                    1,

                iss:
                    "issuer",

                name:
                    "Store Owner",

                phone_number:
                    "+10000000",

                picture:
                    "https://example.com/image.jpg",

                sub:
                    "owner-1",

                user_id:
                    "owner-1",

                admin:
                    true,

                role:
                    "owner",

                permissions: [
                    "*"
                ],

                customFlag:
                    true
            });

        assert.deepEqual(
            claims,
            {
                admin:
                    true,

                role:
                    "owner",

                permissions: [
                    "*"
                ],

                customFlag:
                    true
            }
        );
    }
);

test(
    "creates actor from callable context",
    function () {
        const actor =
            createActorFromCallableContext(
                createAuthenticatedContext()
            );

        assert.equal(
            actor.uid,
            "owner-1"
        );

        assert.equal(
            actor.email,
            "owner@example.com"
        );

        assert.equal(
            actor.displayName,
            "Store Owner"
        );

        assert.equal(
            actor.claims.admin,
            true
        );

        assert.equal(
            actor.claims.aud,
            undefined
        );

        assert.equal(
            actor.claims.firebase,
            undefined
        );
    }
);

test(
    "creates empty actor from unauthenticated context",
    function () {
        assert.deepEqual(
            createActorFromCallableContext(
                {}
            ),
            {
                uid:
                    null,

                email:
                    null,

                displayName:
                    null,

                claims:
                    {}
            }
        );
    }
);

/* ==========================================================
   SAFE ACTOR SNAPSHOT
========================================================== */

test(
    "creates safe actor response snapshots",
    function () {
        assert.deepEqual(
            createSafeActorSnapshot({
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
                ],

                claims: {
                    secret:
                        true
                }
            }),
            {
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
            }
        );
    }
);

/* ==========================================================
   RUNTIME OPTIONS
========================================================== */

test(
    "normalizes runtime options",
    function () {
        assert.deepEqual(
            normalizeRuntimeOptions({}),
            {
                timeoutSeconds:
                    60,

                memory:
                    "256MB"
            }
        );

        assert.deepEqual(
            normalizeRuntimeOptions({
                timeoutSeconds:
                    120,

                memory:
                    "1GB"
            }),
            {
                timeoutSeconds:
                    120,

                memory:
                    "1GB"
            }
        );
    }
);

test(
    "normalizes callable memory",
    function () {
        assert.equal(
            normalizeMemory(
                "512mb"
            ),
            "512MB"
        );

        assert.equal(
            normalizeMemory(
                "2GB"
            ),
            "2GB"
        );

        assert.throws(
            function () {
                normalizeMemory(
                    "16GB"
                );
            },
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "admin-callables/invalid-memory"
                );

                return true;
            }
        );
    }
);

test(
    "normalizes callable options",
    function () {
        const mock =
            createMockService();

        const options =
            normalizeCallableOptions({
                region:
                    "us-central1",

                rawHandlers:
                    true,

                allowRawClaimsPatch:
                    true,

                service:
                    mock.service,

                runtimeOptions: {
                    timeoutSeconds:
                        120,

                    memory:
                        "512MB"
                }
            });

        assert.equal(
            options.region,
            "us-central1"
        );

        assert.equal(
            options.rawHandlers,
            true
        );

        assert.equal(
            options.allowRawClaimsPatch,
            true
        );

        assert.equal(
            options.service,
            mock.service
        );

        assert.equal(
            options.runtimeOptions.timeoutSeconds,
            120
        );

        assert.equal(
            options.runtimeOptions.memory,
            "512MB"
        );
    }
);

/* ==========================================================
   ERROR MAPPING
========================================================== */

test(
    "maps service error codes to Firebase HTTPS codes",
    function () {
        const cases = [
            [
                "admin-callables/unauthenticated",
                "unauthenticated"
            ],

            [
                "admin-auth/permission-denied",
                "permission-denied"
            ],

            [
                "admin-auth/admin-required",
                "permission-denied"
            ],

            [
                "admin-auth/privileged-role-required",
                "permission-denied"
            ],

            [
                "admin-auth/self-mutation-denied",
                "permission-denied"
            ],

            [
                "admin-callables/raw-claims-disabled",
                "permission-denied"
            ],

            [
                "auth/user-not-found",
                "not-found"
            ],

            [
                "admin-auth/uid-required",
                "invalid-argument"
            ],

            [
                "admin-auth/invalid-role",
                "invalid-argument"
            ],

            [
                "admin-auth/permissions-required",
                "invalid-argument"
            ],

            [
                "admin-auth/claims-required",
                "invalid-argument"
            ],

            [
                "admin-auth/claims-too-large",
                "resource-exhausted"
            ],

            [
                "admin-auth/final-owner",
                "failed-precondition"
            ],

            [
                "admin-auth/service-unavailable",
                "unavailable"
            ],

            [
                "admin-auth/unknown",
                "internal"
            ]
        ];

        for (
            const [
                input,
                expected
            ] of
            cases
        ) {
            assert.equal(
                mapServiceErrorToHttpsCode(
                    input
                ),
                expected,
                input
            );
        }
    }
);

test(
    "normalizes arbitrary callable errors",
    function () {
        const original =
            new Error(
                "Operation failed."
            );

        original.code =
            "admin-auth/failure";

        original.details = {
            retryable:
                false
        };

        const normalized =
            normalizeAdminCallableError(
                original,
                "fallback",
                "Fallback"
            );

        assert.ok(
            normalized instanceof
            AdminCallableError
        );

        assert.equal(
            normalized.code,
            "admin-auth/failure"
        );

        assert.equal(
            normalized.message,
            "Operation failed."
        );

        assert.deepEqual(
            normalized.details,
            {
                retryable:
                    false
            }
        );

        assert.equal(
            normalized.originalError,
            original
        );
    }
);

test(
    "preserves AdminCallableError during normalization",
    function () {
        const error =
            new AdminCallableError(
                "admin-callables/test",
                "Test."
            );

        assert.equal(
            normalizeAdminCallableError(
                error,
                "fallback",
                "Fallback"
            ),
            error
        );
    }
);

test(
    "converts callable errors to HttpsError",
    function () {
        const error =
            new AdminCallableError(
                "admin-auth/final-owner",
                "Final owner cannot be removed.",
                {
                    details: {
                        uid:
                            "owner-1"
                    }
                }
            );

        const converted =
            toHttpsError(
                error,
                "removeAdministratorRole"
            );

        assert.ok(
            converted instanceof
            MockHttpsError
        );

        assert.equal(
            converted.code,
            "failed-precondition"
        );

        assert.equal(
            converted.message,
            "Final owner cannot be removed."
        );

        assert.equal(
            converted.details.code,
            "admin-auth/final-owner"
        );

        assert.equal(
            converted.details.operation,
            "removeAdministratorRole"
        );

        assert.deepEqual(
            converted.details.details,
            {
                uid:
                    "owner-1"
            }
        );
    }
);

test(
    "returns existing HttpsError unchanged",
    function () {
        const error =
            new MockHttpsError(
                "permission-denied",
                "Denied."
            );

        assert.equal(
            toHttpsError(
                error,
                "test"
            ),
            error
        );
    }
);

/* ==========================================================
   CALLABLE AUTHORIZATION
========================================================== */

test(
    "requires authenticated callable administrator",
    async function () {
        const mock =
            createMockService();

        const actor =
            await requireCallableAdministrator(
                mock.service,
                createAuthenticatedContext(),
                [
                    "admins.read"
                ]
            );

        assert.equal(
            actor.uid,
            "owner-1"
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
    }
);

test(
    "rejects unauthenticated callable requests",
    async function () {
        const mock =
            createMockService();

        await assert.rejects(
            requireCallableAdministrator(
                mock.service,
                {},
                [
                    "admins.read"
                ]
            ),
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "admin-callables/unauthenticated"
                );

                return true;
            }
        );

        assert.equal(
            mock.calls
                .authorizeActor
                .length,
            0
        );
    }
);

/* ==========================================================
   CREATE RAW CALLABLE
========================================================== */

test(
    "creates raw callable handlers for tests",
    async function () {
        const handler =
            createCallable(
                {
                    rawHandlers:
                        true
                },
                "testCallable",
                async function (
                    data
                ) {
                    return {
                        value:
                            data.value ||
                            null
                    };
                }
            );

        const result =
            await handler(
                {
                    value:
                        "ok"
                },
                {}
            );

        assert.deepEqual(
            result,
            {
                value:
                    "ok"
            }
        );
    }
);

test(
    "raw callable wrapper converts failures to HttpsError",
    async function () {
        const handler =
            createCallable(
                {
                    rawHandlers:
                        true
                },
                "testCallable",
                async function () {
                    throw new AdminCallableError(
                        "admin-callables/unauthenticated",
                        "Sign in."
                    );
                }
            );

        await assert.rejects(
            handler(
                {},
                {}
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
                    error.details.operation,
                    "testCallable"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   CREATE DEPLOYABLE CALLABLE
========================================================== */

test(
    "creates deployable callable with configured region and runtime",
    function () {
        const handler =
            createCallable(
                {
                    rawHandlers:
                        false,

                    region:
                        "europe-west1",

                    runtimeOptions: {
                        timeoutSeconds:
                            60,

                        memory:
                            "256MB"
                    }
                },
                "testCallable",
                async function () {
                    return {
                        success:
                            true
                    };
                }
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
);

/* ==========================================================
   CREATE ADMIN CALLABLES
========================================================== */

test(
    "creates expected administrator callable handlers",
    function () {
        const mock =
            createMockService();

        const callables =
            createAdminCallables({
                service:
                    mock.service,

                rawHandlers:
                    true
            });

        const names = [
            "listAdministrators",
            "getAdministrator",
            "setAdministratorRole",
            "removeAdministratorRole",
            "grantAdministratorPermissions",
            "revokeAdministratorPermissions",
            "patchAdministratorClaims"
        ];

        for (
            const name of
            names
        ) {
            assert.equal(
                typeof callables[
                    name
                ],
                "function",
                name
            );
        }

        assert.equal(
            callables.service,
            mock.service
        );

        assert.equal(
            Object.isFrozen(
                callables
            ),
            true
        );
    }
);

/* ==========================================================
   LIST ADMINISTRATORS CALLABLE
========================================================== */

test(
    "listAdministrators requires admins.read and returns safe actor",
    async function () {
        const mock =
            createMockService();

        const callables =
            createAdminCallables({
                service:
                    mock.service,

                rawHandlers:
                    true
            });

        const result =
            await callables
                .listAdministrators(
                    {
                        pageSize:
                            100,

                        fetchAll:
                            false
                    },
                    createAuthenticatedContext()
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
            result.actor.uid,
            "owner-1"
        );

        assert.equal(
            result.actor.claims,
            undefined
        );

        assert.equal(
            mock.calls
                .authorizeActor[0]
                .permissions[0],
            "admins.read"
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

/* ==========================================================
   GET ADMINISTRATOR CALLABLE
========================================================== */

test(
    "getAdministrator returns requested administrator",
    async function () {
        const mock =
            createMockService();

        const callables =
            createAdminCallables({
                service:
                    mock.service,

                rawHandlers:
                    true
            });

        const result =
            await callables
                .getAdministrator(
                    {
                        uid:
                            "admin-2"
                    },
                    createAuthenticatedContext()
                );

        assert.equal(
            result.success,
            true
        );

        assert.equal(
            result.administrator.uid,
            "admin-2"
        );

        assert.deepEqual(
            mock.calls
                .getAdministrator,
            [
                "admin-2"
            ]
        );

        assert.deepEqual(
            mock.calls
                .authorizeActor[0]
                .permissions,
            [
                "admins.read"
            ]
        );
    }
);

test(
    "getAdministrator requires target uid",
    async function () {
        const mock =
            createMockService();

        const callables =
            createAdminCallables({
                service:
                    mock.service,

                rawHandlers:
                    true
            });

        await assert.rejects(
            callables
                .getAdministrator(
                    {},
                    createAuthenticatedContext()
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
   SET ADMIN ROLE CALLABLE
========================================================== */

test(
    "setAdministratorRole forwards role mutation payload",
    async function () {
        const mock =
            createMockService();

        const callables =
            createAdminCallables({
                service:
                    mock.service,

                rawHandlers:
                    true
            });

        const result =
            await callables
                .setAdministratorRole(
                    {
                        uid:
                            "user-2",

                        role:
                            "support",

                        permissions: [
                            "products.read"
                        ],

                        replacePermissions:
                            true,

                        reason:
                            "Support team"
                    },
                    createAuthenticatedContext()
                );

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
            result.auditId,
            "audit-role-1"
        );

        assert.equal(
            mock.calls
                .setAdministratorRole
                .length,
            1
        );

        const request =
            mock.calls
                .setAdministratorRole[0];

        assert.equal(
            request.uid,
            "user-2"
        );

        assert.equal(
            request.role,
            "support"
        );

        assert.equal(
            request.replacePermissions,
            true
        );

        assert.deepEqual(
            request.permissions,
            [
                "products.read"
            ]
        );

        assert.equal(
            request.actor.uid,
            "owner-1"
        );

        assert.deepEqual(
            mock.calls
                .authorizeActor[0]
                .permissions,
            [
                "admins.write"
            ]
        );
    }
);

/* ==========================================================
   REMOVE ADMIN ROLE CALLABLE
========================================================== */

test(
    "removeAdministratorRole forwards removal request",
    async function () {
        const mock =
            createMockService();

        const callables =
            createAdminCallables({
                service:
                    mock.service,

                rawHandlers:
                    true
            });

        const result =
            await callables
                .removeAdministratorRole(
                    {
                        targetUid:
                            "admin-2",

                        preservePermissions:
                            true,

                        reason:
                            "Role no longer required"
                    },
                    createAuthenticatedContext()
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
            result.administrator.isAdministrator,
            false
        );

        assert.equal(
            result.auditId,
            "audit-remove-1"
        );

        const request =
            mock.calls
                .removeAdministratorRole[0];

        assert.equal(
            request.uid,
            "admin-2"
        );

        assert.equal(
            request.preservePermissions,
            true
        );

        assert.equal(
            request.reason,
            "Role no longer required"
        );

        assert.equal(
            request.actor.uid,
            "owner-1"
        );
    }
);

/* ==========================================================
   GRANT PERMISSIONS CALLABLE
========================================================== */

test(
    "grantAdministratorPermissions forwards permission grants",
    async function () {
        const mock =
            createMockService();

        const callables =
            createAdminCallables({
                service:
                    mock.service,

                rawHandlers:
                    true
            });

        const result =
            await callables
                .grantAdministratorPermissions(
                    {
                        uid:
                            "admin-2",

                        permissions: [
                            "orders.refund",
                            "customers.delete"
                        ],

                        reason:
                            "Senior support"
                    },
                    createAuthenticatedContext()
                );

        assert.equal(
            result.success,
            true
        );

        assert.equal(
            result.auditId,
            "audit-grant-1"
        );

        assert.deepEqual(
            mock.calls
                .grantPermissions[0]
                .permissions,
            [
                "orders.refund",
                "customers.delete"
            ]
        );

        assert.equal(
            mock.calls
                .grantPermissions[0]
                .actor
                .uid,
            "owner-1"
        );
    }
);

test(
    "grantAdministratorPermissions accepts singular permission",
    async function () {
        const mock =
            createMockService();

        const callables =
            createAdminCallables({
                service:
                    mock.service,

                rawHandlers:
                    true
            });

        await callables
            .grantAdministratorPermissions(
                {
                    uid:
                        "admin-2",

                    permission:
                        "orders.refund"
                },
                createAuthenticatedContext()
            );

        assert.equal(
            mock.calls
                .grantPermissions[0]
                .permissions,
            "orders.refund"
        );
    }
);

/* ==========================================================
   REVOKE PERMISSIONS CALLABLE
========================================================== */

test(
    "revokeAdministratorPermissions forwards permission revocation",
    async function () {
        const mock =
            createMockService();

        const callables =
            createAdminCallables({
                service:
                    mock.service,

                rawHandlers:
                    true
            });

        const result =
            await callables
                .revokeAdministratorPermissions(
                    {
                        uid:
                            "admin-2",

                        permissions: [
                            "orders.refund"
                        ],

                        reason:
                            "Refund access removed"
                    },
                    createAuthenticatedContext()
                );

        assert.equal(
            result.success,
            true
        );

        assert.equal(
            result.auditId,
            "audit-revoke-1"
        );

        assert.deepEqual(
            mock.calls
                .revokePermissions[0]
                .permissions,
            [
                "orders.refund"
            ]
        );

        assert.equal(
            mock.calls
                .revokePermissions[0]
                .reason,
            "Refund access removed"
        );
    }
);

/* ==========================================================
   PATCH CLAIMS CALLABLE
========================================================== */

test(
    "raw claims patch callable is disabled by default",
    async function () {
        const mock =
            createMockService();

        const callables =
            createAdminCallables({
                service:
                    mock.service,

                rawHandlers:
                    true
            });

        await assert.rejects(
            callables
                .patchAdministratorClaims(
                    {
                        uid:
                            "admin-2",

                        claims: {
                            custom:
                                true
                        }
                    },
                    createAuthenticatedContext()
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

        assert.equal(
            mock.calls
                .patchCustomClaims
                .length,
            0
        );
    }
);

test(
    "raw claims patch callable forwards payload when enabled",
    async function () {
        const mock =
            createMockService();

        const callables =
            createAdminCallables({
                service:
                    mock.service,

                rawHandlers:
                    true,

                allowRawClaimsPatch:
                    true
            });

        const result =
            await callables
                .patchAdministratorClaims(
                    {
                        targetUid:
                            "admin-2",

                        claims: {
                            custom:
                                true
                        },

                        replace:
                            true,

                        allowSelfMutation:
                            true,

                        reason:
                            "Test claim"
                    },
                    createAuthenticatedContext()
                );

        assert.equal(
            result.success,
            true
        );

        assert.equal(
            result.auditId,
            "audit-claims-1"
        );

        const request =
            mock.calls
                .patchCustomClaims[0];

        assert.equal(
            request.uid,
            "admin-2"
        );

        assert.deepEqual(
            request.claims,
            {
                custom:
                    true
            }
        );

        assert.equal(
            request.replace,
            true
        );

        assert.equal(
            request.allowSelfMutation,
            true
        );

        assert.equal(
            request.actor.uid,
            "owner-1"
        );
    }
);

/* ==========================================================
   UNAUTHENTICATED CALLABLES
========================================================== */

test(
    "administrator callables reject unauthenticated callers",
    async function () {
        const mock =
            createMockService();

        const callables =
            createAdminCallables({
                service:
                    mock.service,

                rawHandlers:
                    true
            });

        await assert.rejects(
            callables
                .listAdministrators(
                    {},
                    {}
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
   SERVICE AUTHORIZATION FAILURES
========================================================== */

test(
    "translates service authorization errors",
    async function () {
        const mock =
            createMockService({
                async authorizeActor() {
                    const error =
                        new Error(
                            "Administrator permission required."
                        );

                    error.code =
                        "admin-auth/permission-denied";

                    throw error;
                }
            });

        const callables =
            createAdminCallables({
                service:
                    mock.service,

                rawHandlers:
                    true
            });

        await assert.rejects(
            callables
                .listAdministrators(
                    {},
                    createAuthenticatedContext()
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
   SERVICE FAILURES
========================================================== */

test(
    "translates service user-not-found errors",
    async function () {
        const mock =
            createMockService({
                async getAdministrator() {
                    const error =
                        new Error(
                            "User does not exist."
                        );

                    error.code =
                        "auth/user-not-found";

                    throw error;
                }
            });

        const callables =
            createAdminCallables({
                service:
                    mock.service,

                rawHandlers:
                    true
            });

        await assert.rejects(
            callables
                .getAdministrator(
                    {
                        uid:
                            "missing-user"
                    },
                    createAuthenticatedContext()
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

test(
    "translates final-owner protection errors",
    async function () {
        const mock =
            createMockService({
                async removeAdministratorRole() {
                    const error =
                        new Error(
                            "The final owner cannot be removed."
                        );

                    error.code =
                        "admin-auth/final-owner";

                    throw error;
                }
            });

        const callables =
            createAdminCallables({
                service:
                    mock.service,

                rawHandlers:
                    true
            });

        await assert.rejects(
            callables
                .removeAdministratorRole(
                    {
                        uid:
                            "owner-1"
                    },
                    createAuthenticatedContext()
                ),
            function (
                error
            ) {
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
   TARGET UID ALIASES
========================================================== */

test(
    "supports targetUid aliases",
    async function () {
        const mock =
            createMockService();

        const callables =
            createAdminCallables({
                service:
                    mock.service,

                rawHandlers:
                    true
            });

        await callables
            .getAdministrator(
                {
                    targetUid:
                        "admin-5"
                },
                createAuthenticatedContext()
            );

        await callables
            .setAdministratorRole(
                {
                    targetUid:
                        "admin-6",

                    role:
                        "analyst"
                },
                createAuthenticatedContext()
            );

        assert.equal(
            mock.calls
                .getAdministrator[0],
            "admin-5"
        );

        assert.equal(
            mock.calls
                .setAdministratorRole[0]
                .uid,
            "admin-6"
        );
    }
);

/* ==========================================================
   ACTOR CLAIMS
========================================================== */

test(
    "passes sanitized callable claims to authorization service",
    async function () {
        const mock =
            createMockService();

        const callables =
            createAdminCallables({
                service:
                    mock.service,

                rawHandlers:
                    true
            });

        await callables
            .listAdministrators(
                {},
                createAuthenticatedContext({
                    token: {
                        admin:
                            true,

                        role:
                            "owner",

                        privateFlag:
                            "allowed",

                        aud:
                            "should-not-pass",

                        firebase: {
                            sign_in_provider:
                                "password"
                        }
                    }
                })
            );

        const actor =
            mock.calls
                .authorizeActor[0]
                .actor;

        assert.equal(
            actor.claims.admin,
            true
        );

        assert.equal(
            actor.claims.role,
            "owner"
        );

        assert.equal(
            actor.claims.privateFlag,
            "allowed"
        );

        assert.equal(
            actor.claims.aud,
            undefined
        );

        assert.equal(
            actor.claims.firebase,
            undefined
        );
    }
);

/* ==========================================================
   IMMUTABILITY
========================================================== */

test(
    "callable options are frozen",
    function () {
        const options =
            normalizeCallableOptions({});

        assert.equal(
            Object.isFrozen(
                options
            ),
            true
        );

        assert.equal(
            Object.isFrozen(
                options.runtimeOptions
            ),
            true
        );
    }
);

test(
    "module export surface is frozen",
    function () {
        assert.equal(
            Object.isFrozen(
                adminCallables
            ),
            true
        );

        assert.equal(
            Object.isFrozen(
                adminCallables.constants
            ),
            true
        );
    }
);

/* ==========================================================
   CLONE
========================================================== */

test(
    "cloneValue deep-clones values",
    function () {
        const source = {
            date:
                new Date(
                    "2026-01-01T00:00:00.000Z"
                ),

            nested: {
                permissions: [
                    "admins.read"
                ]
            }
        };

        const cloned =
            cloneValue(
                source
            );

        assert.deepEqual(
            cloned,
            {
                date:
                    "2026-01-01T00:00:00.000Z",

                nested: {
                    permissions: [
                        "admins.read"
                    ]
                }
            }
        );

        cloned.nested
            .permissions
            .push(
                "admins.write"
            );

        assert.deepEqual(
            source.nested.permissions,
            [
                "admins.read"
            ]
        );
    }
);