"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   FRONTEND ADMIN AUTH SERVICE TESTS

   Run with:
   node --test public/js/services/admin-auth-service.test.js
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
   LOAD MODULE
========================================================== */

const adminAuthClient =
    require(
        "./admin-auth-service"
    );

const {
    createAdminAuthService,
    AdminAuthClientError,

    createCallableMap,
    normalizeCallableResponse,
    cleanPayload,

    normalizeOptions,
    normalizeRequiredString,
    normalizeOptionalString,
    normalizeStringList,

    normalizeAdminAuthClientError,
    extractCallableErrorDetails,

    cloneValue,

    constants
} =
    adminAuthClient;

/* ==========================================================
   HELPERS
========================================================== */

function createFunctionsMock(
    implementations
) {
    const calls =
        [];

    const handlers =
        Object.assign(
            {},
            implementations ||
            {}
        );

    return {
        calls,

        httpsCallable(
            name
        ) {
            return async function (
                payload
            ) {
                calls.push({
                    name,
                    payload:
                        cloneValue(
                            payload
                        )
                });

                if (
                    typeof handlers[
                        name
                    ] ===
                    "function"
                ) {
                    return handlers[
                        name
                    ](
                        payload
                    );
                }

                return {
                    data: {
                        success:
                            true
                    }
                };
            };
        }
    };
}

/* ==========================================================
   CONSTANTS
========================================================== */

test(
    "exports expected constants",
    function () {
        assert.equal(
            constants.DEFAULT_REGION,
            "europe-west1"
        );

        assert.equal(
            constants.CALLABLE_NAMES
                .listAdministrators,
            "listAdministrators"
        );

        assert.equal(
            constants.CALLABLE_NAMES
                .patchAdministratorClaims,
            "patchAdministratorClaims"
        );
    }
);

/* ==========================================================
   CALLABLE MAP
========================================================== */

test(
    "creates callable map from Firebase Functions instance",
    function () {
        const functions =
            createFunctionsMock();

        const map =
            createCallableMap(
                functions,
                constants.CALLABLE_NAMES
            );

        assert.equal(
            typeof map.listAdministrators,
            "function"
        );

        assert.equal(
            typeof map.setAdministratorRole,
            "function"
        );

        assert.equal(
            Object.isFrozen(
                map
            ),
            true
        );
    }
);

/* ==========================================================
   RESPONSE NORMALIZATION
========================================================== */

test(
    "normalizes object callable responses",
    function () {
        const value = {
            success:
                true,

            count:
                2
        };

        const normalized =
            normalizeCallableResponse(
                value
            );

        assert.deepEqual(
            normalized,
            value
        );

        assert.notEqual(
            normalized,
            value
        );
    }
);

test(
    "normalizes null callable response",
    function () {
        assert.deepEqual(
            normalizeCallableResponse(
                null
            ),
            {
                success:
                    true
            }
        );
    }
);

test(
    "normalizes primitive callable response",
    function () {
        assert.deepEqual(
            normalizeCallableResponse(
                "ok"
            ),
            {
                success:
                    true,

                value:
                    "ok"
            }
        );
    }
);

/* ==========================================================
   PAYLOAD CLEANUP
========================================================== */

test(
    "cleanPayload removes undefined values",
    function () {
        assert.deepEqual(
            cleanPayload({
                uid:
                    "user-1",

                reason:
                    undefined,

                permissions: [
                    "orders.read"
                ]
            }),
            {
                uid:
                    "user-1",

                permissions: [
                    "orders.read"
                ]
            }
        );
    }
);

/* ==========================================================
   OPTIONS
========================================================== */

test(
    "normalizes frontend admin auth service options",
    function () {
        const functions =
            createFunctionsMock();

        const options =
            normalizeOptions({
                region:
                    "us-central1",

                functions,

                callableNames: {
                    listAdministrators:
                        "customListAdmins"
                }
            });

        assert.equal(
            options.region,
            "us-central1"
        );

        assert.equal(
            options.functions,
            functions
        );

        assert.equal(
            options.callableNames
                .listAdministrators,
            "customListAdmins"
        );

        assert.equal(
            options.callableNames
                .getAdministrator,
            "getAdministrator"
        );

        assert.equal(
            Object.isFrozen(
                options
            ),
            true
        );
    }
);

/* ==========================================================
   STRING NORMALIZERS
========================================================== */

test(
    "normalizes required strings",
    function () {
        assert.equal(
            normalizeRequiredString(
                " user-1 ",
                "UID"
            ),
            "user-1"
        );

        assert.throws(
            function () {
                normalizeRequiredString(
                    "",
                    "UID"
                );
            },
            function (
                error
            ) {
                assert.ok(
                    error instanceof
                    AdminAuthClientError
                );

                assert.equal(
                    error.code,
                    "admin-auth-client/invalid-argument"
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
                " reason "
            ),
            "reason"
        );

        assert.equal(
            normalizeOptionalString(
                ""
            ),
            null
        );

        assert.equal(
            normalizeOptionalString(
                null
            ),
            null
        );
    }
);

test(
    "normalizes string lists",
    function () {
        assert.deepEqual(
            normalizeStringList(
                "orders.read, orders.write customers.read"
            ),
            [
                "orders.read",
                "orders.write",
                "customers.read"
            ]
        );

        assert.deepEqual(
            normalizeStringList([
                "orders.read",
                " orders.read ",
                "customers.read"
            ]),
            [
                "orders.read",
                "customers.read"
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

/* ==========================================================
   CREATE SERVICE
========================================================== */

test(
    "creates admin auth frontend service",
    function () {
        const functions =
            createFunctionsMock();

        const service =
            createAdminAuthService({
                functions
            });

        assert.equal(
            typeof service.listAdministrators,
            "function"
        );

        assert.equal(
            typeof service.getAdministrator,
            "function"
        );

        assert.equal(
            typeof service.setAdministratorRole,
            "function"
        );

        assert.equal(
            typeof service.removeAdministratorRole,
            "function"
        );

        assert.equal(
            typeof service.grantAdministratorPermissions,
            "function"
        );

        assert.equal(
            typeof service.revokeAdministratorPermissions,
            "function"
        );

        assert.equal(
            typeof service.patchAdministratorClaims,
            "function"
        );

        assert.equal(
            Object.isFrozen(
                service
            ),
            true
        );
    }
);

/* ==========================================================
   LIST ADMINISTRATORS
========================================================== */

test(
    "listAdministrators calls correct backend callable",
    async function () {
        const functions =
            createFunctionsMock({
                listAdministrators(
                    payload
                ) {
                    return {
                        data: {
                            success:
                                true,

                            administrators: [
                                {
                                    uid:
                                        "owner-1"
                                }
                            ],

                            count:
                                1,

                            received:
                                payload
                        }
                    };
                }
            });

        const service =
            createAdminAuthService({
                functions
            });

        const result =
            await service
                .listAdministrators({
                    pageSize:
                        100,

                    pageToken:
                        "page-2",

                    fetchAll:
                        false
                });

        assert.equal(
            result.success,
            true
        );

        assert.equal(
            result.count,
            1
        );

        assert.deepEqual(
            functions.calls[0],
            {
                name:
                    "listAdministrators",

                payload: {
                    pageSize:
                        100,

                    pageToken:
                        "page-2",

                    fetchAll:
                        false
                }
            }
        );
    }
);

/* ==========================================================
   GET ADMINISTRATOR
========================================================== */

test(
    "getAdministrator sends normalized uid",
    async function () {
        const functions =
            createFunctionsMock({
                getAdministrator(
                    payload
                ) {
                    return {
                        data: {
                            success:
                                true,

                            administrator: {
                                uid:
                                    payload.uid
                            }
                        }
                    };
                }
            });

        const service =
            createAdminAuthService({
                functions
            });

        const result =
            await service
                .getAdministrator(
                    " admin-2 "
                );

        assert.equal(
            result.administrator.uid,
            "admin-2"
        );

        assert.deepEqual(
            functions.calls[0],
            {
                name:
                    "getAdministrator",

                payload: {
                    uid:
                        "admin-2"
                }
            }
        );
    }
);

test(
    "getAdministrator rejects empty uid",
    async function () {
        const service =
            createAdminAuthService({
                functions:
                    createFunctionsMock()
            });

        await assert.rejects(
            service.getAdministrator(
                ""
            ),
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "admin-auth-client/invalid-argument"
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
    "setAdministratorRole sends normalized mutation payload",
    async function () {
        const functions =
            createFunctionsMock({
                setAdministratorRole(
                    payload
                ) {
                    return {
                        data: {
                            success:
                                true,

                            administrator: {
                                uid:
                                    payload.uid,

                                primaryRole:
                                    payload.role
                            }
                        }
                    };
                }
            });

        const service =
            createAdminAuthService({
                functions
            });

        const result =
            await service
                .setAdministratorRole({
                    targetUid:
                        " user-2 ",

                    role:
                        " support ",

                    permissions: [
                        "orders.read",
                        " orders.read ",
                        "customers.read"
                    ],

                    replacePermissions:
                        true,

                    reason:
                        " Support team "
                });

        assert.equal(
            result.administrator.uid,
            "user-2"
        );

        assert.equal(
            result.administrator.primaryRole,
            "support"
        );

        assert.deepEqual(
            functions.calls[0],
            {
                name:
                    "setAdministratorRole",

                payload: {
                    uid:
                        "user-2",

                    role:
                        "support",

                    permissions: [
                        "orders.read",
                        "customers.read"
                    ],

                    replacePermissions:
                        true,

                    reason:
                        "Support team"
                }
            }
        );
    }
);

/* ==========================================================
   REMOVE ROLE
========================================================== */

test(
    "removeAdministratorRole sends expected payload",
    async function () {
        const functions =
            createFunctionsMock();

        const service =
            createAdminAuthService({
                functions
            });

        await service
            .removeAdministratorRole({
                uid:
                    "admin-2",

                preservePermissions:
                    true,

                reason:
                    "Access ended"
            });

        assert.deepEqual(
            functions.calls[0],
            {
                name:
                    "removeAdministratorRole",

                payload: {
                    uid:
                        "admin-2",

                    preservePermissions:
                        true,

                    reason:
                        "Access ended"
                }
            }
        );
    }
);

/* ==========================================================
   GRANT PERMISSIONS
========================================================== */

test(
    "grantAdministratorPermissions sends permissions array",
    async function () {
        const functions =
            createFunctionsMock();

        const service =
            createAdminAuthService({
                functions
            });

        await service
            .grantAdministratorPermissions({
                uid:
                    "admin-2",

                permission:
                    "orders.refund",

                reason:
                    "Senior support"
            });

        assert.deepEqual(
            functions.calls[0],
            {
                name:
                    "grantAdministratorPermissions",

                payload: {
                    uid:
                        "admin-2",

                    permissions: [
                        "orders.refund"
                    ],

                    reason:
                        "Senior support"
                }
            }
        );
    }
);

test(
    "grantAdministratorPermissions rejects empty permissions",
    async function () {
        const service =
            createAdminAuthService({
                functions:
                    createFunctionsMock()
            });

        await assert.rejects(
            service
                .grantAdministratorPermissions({
                    uid:
                        "admin-2",

                    permissions:
                        []
                }),
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "admin-auth-client/permissions-required"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   REVOKE PERMISSIONS
========================================================== */

test(
    "revokeAdministratorPermissions sends permissions array",
    async function () {
        const functions =
            createFunctionsMock();

        const service =
            createAdminAuthService({
                functions
            });

        await service
            .revokeAdministratorPermissions({
                targetUid:
                    "admin-2",

                permissions: [
                    "orders.refund",
                    "customers.delete"
                ],

                reason:
                    "Reduced access"
            });

        assert.deepEqual(
            functions.calls[0],
            {
                name:
                    "revokeAdministratorPermissions",

                payload: {
                    uid:
                        "admin-2",

                    permissions: [
                        "orders.refund",
                        "customers.delete"
                    ],

                    reason:
                        "Reduced access"
                }
            }
        );
    }
);

/* ==========================================================
   PATCH CLAIMS
========================================================== */

test(
    "patchAdministratorClaims sends raw claims payload",
    async function () {
        const functions =
            createFunctionsMock();

        const service =
            createAdminAuthService({
                functions
            });

        await service
            .patchAdministratorClaims({
                uid:
                    "owner-1",

                claims: {
                    region:
                        "eu"
                },

                replace:
                    true,

                allowSelfMutation:
                    true,

                reason:
                    "Test"
            });

        assert.deepEqual(
            functions.calls[0],
            {
                name:
                    "patchAdministratorClaims",

                payload: {
                    uid:
                        "owner-1",

                    claims: {
                        region:
                            "eu"
                    },

                    replace:
                        true,

                    allowSelfMutation:
                        true,

                    reason:
                        "Test"
                }
            }
        );
    }
);

test(
    "patchAdministratorClaims rejects missing claims",
    async function () {
        const service =
            createAdminAuthService({
                functions:
                    createFunctionsMock()
            });

        await assert.rejects(
            service
                .patchAdministratorClaims({
                    uid:
                        "owner-1"
                }),
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "admin-auth-client/claims-required"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   CUSTOM CALLABLE NAMES
========================================================== */

test(
    "supports custom callable names",
    async function () {
        const functions =
            createFunctionsMock({
                customAdminList() {
                    return {
                        data: {
                            success:
                                true,

                            administrators:
                                []
                        }
                    };
                }
            });

        const service =
            createAdminAuthService({
                functions,

                callableNames: {
                    listAdministrators:
                        "customAdminList"
                }
            });

        await service
            .listAdministrators();

        assert.equal(
            functions.calls[0]
                .name,
            "customAdminList"
        );
    }
);

/* ==========================================================
   CALLABLE ERROR DETAILS
========================================================== */

test(
    "extracts callable error details",
    function () {
        assert.deepEqual(
            extractCallableErrorDetails({
                details: {
                    code:
                        "admin-auth/final-owner",

                    operation:
                        "removeAdministratorRole"
                }
            }),
            {
                code:
                    "admin-auth/final-owner",

                operation:
                    "removeAdministratorRole"
            }
        );
    }
);

test(
    "extracts Firebase customData callable details",
    function () {
        assert.deepEqual(
            extractCallableErrorDetails({
                customData: {
                    details: {
                        code:
                            "admin-auth/permission-denied"
                    }
                }
            }),
            {
                code:
                    "admin-auth/permission-denied"
            }
        );
    }
);

/* ==========================================================
   ERROR NORMALIZATION
========================================================== */

test(
    "normalizes callable backend error using service code",
    function () {
        const source =
            new Error(
                "Final owner cannot be removed."
            );

        source.code =
            "functions/failed-precondition";

        source.details = {
            code:
                "admin-auth/final-owner",

            operation:
                "removeAdministratorRole"
        };

        const normalized =
            normalizeAdminAuthClientError(
                source,
                "fallback",
                "Fallback"
            );

        assert.ok(
            normalized instanceof
            AdminAuthClientError
        );

        assert.equal(
            normalized.code,
            "admin-auth/final-owner"
        );

        assert.equal(
            normalized.message,
            "Final owner cannot be removed."
        );

        assert.equal(
            normalized.details.operation,
            "removeAdministratorRole"
        );

        assert.equal(
            normalized.originalError,
            source
        );
    }
);

test(
    "normalizes Firebase error code when service details are absent",
    function () {
        const source =
            new Error(
                "Permission denied."
            );

        source.code =
            "functions/permission-denied";

        const normalized =
            normalizeAdminAuthClientError(
                source,
                "fallback",
                "Fallback"
            );

        assert.equal(
            normalized.code,
            "functions/permission-denied"
        );
    }
);

test(
    "preserves AdminAuthClientError",
    function () {
        const source =
            new AdminAuthClientError(
                "admin-auth-client/test",
                "Test"
            );

        assert.equal(
            normalizeAdminAuthClientError(
                source,
                "fallback",
                "Fallback"
            ),
            source
        );
    }
);

/* ==========================================================
   INVOCATION ERROR
========================================================== */

test(
    "service converts callable failures to AdminAuthClientError",
    async function () {
        const functions =
            createFunctionsMock({
                listAdministrators() {
                    const error =
                        new Error(
                            "Administrator permission required."
                        );

                    error.code =
                        "functions/permission-denied";

                    error.details = {
                        code:
                            "admin-auth/permission-denied"
                    };

                    throw error;
                }
            });

        const service =
            createAdminAuthService({
                functions
            });

        await assert.rejects(
            service.listAdministrators(),
            function (
                error
            ) {
                assert.ok(
                    error instanceof
                    AdminAuthClientError
                );

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
   FUNCTIONS AVAILABILITY
========================================================== */

test(
    "rejects creation when Firebase Functions is unavailable",
    function () {
        assert.throws(
            function () {
                createAdminAuthService({
                    functions: {
                        httpsCallable:
                            null
                    }
                });
            },
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "admin-auth-client/functions-unavailable"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   CLONE
========================================================== */

test(
    "cloneValue deep clones objects",
    function () {
        const source = {
            nested: {
                values: [
                    "one"
                ]
            },

            date:
                new Date(
                    "2026-01-01T00:00:00.000Z"
                )
        };

        const cloned =
            cloneValue(
                source
            );

        assert.deepEqual(
            cloned,
            {
                nested: {
                    values: [
                        "one"
                    ]
                },

                date:
                    "2026-01-01T00:00:00.000Z"
            }
        );

        cloned.nested.values.push(
            "two"
        );

        assert.deepEqual(
            source.nested.values,
            [
                "one"
            ]
        );
    }
);

/* ==========================================================
   COMPLETE CALLABLE SURFACE
========================================================== */

test(
    "frontend service callable names match backend contract",
    function () {
        assert.deepEqual(
            Object.values(
                constants.CALLABLE_NAMES
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

/* ==========================================================
   MODULE IMMUTABILITY
========================================================== */

test(
    "frontend admin auth module is frozen",
    function () {
        assert.equal(
            Object.isFrozen(
                adminAuthClient
            ),
            true
        );

        assert.equal(
            Object.isFrozen(
                adminAuthClient.constants
            ),
            true
        );

        assert.equal(
            Object.isFrozen(
                adminAuthClient.constants
                    .CALLABLE_NAMES
            ),
            true
        );
    }
);