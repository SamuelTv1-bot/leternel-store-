"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   RATE LIMIT SERVICE TEST SUITE
========================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createRateLimitService,
    consumeRateLimit,
    inspectRateLimit,
    resetRateLimit,
    enforceRateLimit,
    createRateLimitError,
    createRateLimitMiddleware,
    createCallableRateLimitGuard,
    resolveRateLimitIdentity,
    resolveUserId,
    resolveIpAddress,
    normalizeIdentityKey,
    createRateLimitDescriptor,
    hashRateLimitKey,
    createRateLimitResult,
    createResultFromError,
    attachRateLimitHeaders,
    normalizeRateLimitOptions,
    normalizeCollection,
    normalizePrefix,
    normalizePositiveInteger,
    normalizeNonNegativeInteger,
    normalizeCount,
    assertRateLimitRuntime,
    resolveNow,
    createDatabaseTimestamp,
    logRateLimitResult,
    constants
} = require(
    "../src/shared/rate-limit-service"
);

const {
    ServiceError
} = require(
    "../src/shared/service-error"
);

/* ==========================================================
   TEST HELPERS
========================================================== */

class TestTimestamp {
    constructor(milliseconds) {
        this.milliseconds =
            milliseconds;
    }

    toMillis() {
        return this.milliseconds;
    }

    toDate() {
        return new Date(
            this.milliseconds
        );
    }

    static fromMillis(
        milliseconds
    ) {
        return new TestTimestamp(
            milliseconds
        );
    }
}

function cloneValue(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    if (
        value instanceof
        TestTimestamp
    ) {
        return TestTimestamp
            .fromMillis(
                value.toMillis()
            );
    }

    if (
        value instanceof Date
    ) {
        return new Date(
            value.getTime()
        );
    }

    if (
        Array.isArray(value)
    ) {
        return value.map(
            cloneValue
        );
    }

    if (
        typeof value ===
        "object"
    ) {
        return Object.keys(value)
            .reduce(
                function (
                    output,
                    key
                ) {
                    output[key] =
                        cloneValue(
                            value[key]
                        );

                    return output;
                },
                {}
            );
    }

    return value;
}

function mergeValues(
    existing,
    update
) {
    const output =
        cloneValue(
            existing || {}
        );

    Object.keys(
        update || {}
    ).forEach(
        function (key) {
            output[key] =
                cloneValue(
                    update[key]
                );
        }
    );

    return output;
}

function createFirestoreStub(
    initialDocuments
) {
    const documents =
        new Map();

    Object.entries(
        initialDocuments || {}
    ).forEach(
        function ([
            path,
            data
        ]) {
            documents.set(
                path,
                cloneValue(data)
            );
        }
    );

    function createSnapshot(
        path
    ) {
        const exists =
            documents.has(path);

        return {
            exists:
                exists,

            id:
                path
                    .split("/")
                    .pop(),

            data:
                function () {
                    return exists
                        ? cloneValue(
                              documents.get(
                                  path
                              )
                          )
                        : undefined;
                }
        };
    }

    function createReference(
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
                        path
                    );
                },

            set:
                async function (
                    value,
                    options
                ) {
                    const nextValue =
                        options &&
                        options.merge
                            ? mergeValues(
                                  documents.get(
                                      path
                                  ),
                                  value
                              )
                            : cloneValue(
                                  value
                              );

                    documents.set(
                        path,
                        nextValue
                    );
                },

            delete:
                async function () {
                    documents.delete(
                        path
                    );
                }
        };
    }

    const db = {
        collection:
            function (
                collectionName
            ) {
                return {
                    doc:
                        function (
                            documentId
                        ) {
                            return createReference(
                                collectionName,
                                documentId
                            );
                        }
                };
            },

        runTransaction:
            async function (
                callback
            ) {
                const writes = [];

                const transaction = {
                    get:
                        async function (
                            reference
                        ) {
                            return reference.get();
                        },

                    set:
                        function (
                            reference,
                            value,
                            options
                        ) {
                            writes.push({
                                type:
                                    "set",

                                reference:
                                    reference,

                                value:
                                    cloneValue(
                                        value
                                    ),

                                options:
                                    options
                            });
                        },

                    delete:
                        function (
                            reference
                        ) {
                            writes.push({
                                type:
                                    "delete",

                                reference:
                                    reference
                            });
                        }
                };

                const result =
                    await callback(
                        transaction
                    );

                for (
                    const write of
                    writes
                ) {
                    if (
                        write.type ===
                        "set"
                    ) {
                        await write
                            .reference
                            .set(
                                write.value,
                                write.options
                            );
                    }

                    if (
                        write.type ===
                        "delete"
                    ) {
                        await write
                            .reference
                            .delete();
                    }
                }

                return result;
            }
    };

    return {
        db:
            db,

        getDocument:
            function (path) {
                return documents.has(path)
                    ? cloneValue(
                          documents.get(
                              path
                          )
                      )
                    : undefined;
            },

        hasDocument:
            function (path) {
                return documents.has(path);
            },

        listDocuments:
            function () {
                return Array.from(
                    documents.entries()
                ).map(
                    function ([
                        path,
                        data
                    ]) {
                        return {
                            path:
                                path,

                            data:
                                cloneValue(
                                    data
                                )
                        };
                    }
                );
            }
    };
}

function createLoggerStub() {
    const entries = [];

    return {
        entries:
            entries,

        debug:
            function (
                message,
                metadata
            ) {
                entries.push({
                    level:
                        "debug",

                    message:
                        message,

                    metadata:
                        metadata
                });
            },

        info:
            function (
                message,
                metadata
            ) {
                entries.push({
                    level:
                        "info",

                    message:
                        message,

                    metadata:
                        metadata
                });
            },

        warn:
            function (
                message,
                metadata
            ) {
                entries.push({
                    level:
                        "warn",

                    message:
                        message,

                    metadata:
                        metadata
                });
            },

        error:
            function (
                message,
                metadata
            ) {
                entries.push({
                    level:
                        "error",

                    message:
                        message,

                    metadata:
                        metadata
                });
            }
    };
}

function createRuntime(
    options
) {
    const settings =
        options || {};

    const firestore =
        settings.firestore ||
        createFirestoreStub();

    return {
        db:
            firestore.db,

        Timestamp:
            settings.Timestamp ||
            TestTimestamp,

        now:
            settings.now ||
            function () {
                return 1000;
            },

        logger:
            settings.logger ||
            createLoggerStub()
    };
}

function createResponseStub() {
    const state = {
        headers:
            {}
    };

    const response = {
        set:
            function (
                name,
                value
            ) {
                state.headers[
                    String(name)
                        .toLowerCase()
                ] = String(value);

                return response;
            },

        setHeader:
            function (
                name,
                value
            ) {
                state.headers[
                    String(name)
                        .toLowerCase()
                ] = String(value);
            }
    };

    return {
        response:
            response,

        state:
            state
    };
}

function createNextStub() {
    const state = {
        called:
            false,

        error:
            undefined
    };

    return {
        next:
            function (error) {
                state.called =
                    true;

                state.error =
                    error;
            },

        state:
            state
    };
}

/* ==========================================================
   SERVICE FACTORY
========================================================== */

test(
    "createRateLimitService creates a frozen service",
    function () {
        const runtime =
            createRuntime();

        const service =
            createRateLimitService({
                runtime:
                    runtime,

                prefix:
                    "checkout",

                limit:
                    5,

                windowMs:
                    60000
            });

        assert.equal(
            service.runtime,
            runtime
        );

        assert.equal(
            service.options.prefix,
            "checkout"
        );

        assert.equal(
            service.options.limit,
            5
        );

        assert.equal(
            typeof service.consume,
            "function"
        );

        assert.equal(
            typeof service.peek,
            "function"
        );

        assert.equal(
            typeof service.reset,
            "function"
        );

        assert.equal(
            typeof service.enforce,
            "function"
        );

        assert.equal(
            Object.isFrozen(service),
            true
        );
    }
);

/* ==========================================================
   OPTION NORMALIZATION
========================================================== */

test(
    "normalizeRateLimitOptions applies defaults",
    function () {
        const options =
            normalizeRateLimitOptions(
                {}
            );

        assert.equal(
            options.collection,
            constants
                .RATE_LIMIT_COLLECTION
        );

        assert.equal(
            options.prefix,
            constants
                .DEFAULT_KEY_PREFIX
        );

        assert.equal(
            options.limit,
            constants.DEFAULT_LIMIT
        );

        assert.equal(
            options.windowMs,
            constants
                .DEFAULT_WINDOW_MS
        );

        assert.equal(
            options.cost,
            1
        );

        assert.equal(
            options.countRejected,
            true
        );

        assert.equal(
            options.allowAnonymousKey,
            true
        );
    }
);

test(
    "normalizeRateLimitOptions respects overrides",
    function () {
        const options =
            normalizeRateLimitOptions({
                collection:
                    "customRateLimits",

                prefix:
                    "orders",

                limit:
                    10,

                cost:
                    2,

                windowMs:
                    30000,

                retentionMs:
                    120000,

                countRejected:
                    false,

                trustProxy:
                    true,

                allowAnonymousKey:
                    false,

                exposeKey:
                    true,

                disabled:
                    true
            });

        assert.equal(
            options.collection,
            "customRateLimits"
        );

        assert.equal(
            options.prefix,
            "orders"
        );

        assert.equal(
            options.limit,
            10
        );

        assert.equal(
            options.cost,
            2
        );

        assert.equal(
            options.windowMs,
            30000
        );

        assert.equal(
            options.retentionMs,
            120000
        );

        assert.equal(
            options.countRejected,
            false
        );

        assert.equal(
            options.trustProxy,
            true
        );

        assert.equal(
            options.allowAnonymousKey,
            false
        );

        assert.equal(
            options.exposeKey,
            true
        );

        assert.equal(
            options.disabled,
            true
        );
    }
);

test(
    "normalizeCollection accepts valid Firestore collection names",
    function () {
        assert.equal(
            normalizeCollection(
                "_rateLimits"
            ),
            "_rateLimits"
        );
    }
);

test(
    "normalizeCollection rejects empty and nested paths",
    function () {
        assert.throws(
            function () {
                normalizeCollection(
                    ""
                );
            },
            /Firestore collection name/
        );

        assert.throws(
            function () {
                normalizeCollection(
                    "internal/rateLimits"
                );
            },
            /Firestore collection name/
        );
    }
);

test(
    "normalizePrefix sanitizes values",
    function () {
        assert.equal(
            normalizePrefix(
                " Checkout Orders "
            ),
            "checkout-orders"
        );

        assert.equal(
            normalizePrefix(
                ""
            ),
            "global"
        );
    }
);

test(
    "normalizePositiveInteger accepts numbers and numeric strings",
    function () {
        assert.equal(
            normalizePositiveInteger(
                5,
                1,
                "Limit"
            ),
            5
        );

        assert.equal(
            normalizePositiveInteger(
                "10",
                1,
                "Limit"
            ),
            10
        );

        assert.equal(
            normalizePositiveInteger(
                undefined,
                3,
                "Limit"
            ),
            3
        );
    }
);

test(
    "normalizePositiveInteger rejects invalid values",
    function () {
        assert.throws(
            function () {
                normalizePositiveInteger(
                    0,
                    1,
                    "Limit"
                );
            },
            /positive integer/
        );

        assert.throws(
            function () {
                normalizePositiveInteger(
                    1.5,
                    1,
                    "Limit"
                );
            },
            /positive integer/
        );
    }
);

test(
    "normalizeNonNegativeInteger accepts valid values",
    function () {
        assert.equal(
            normalizeNonNegativeInteger(
                0,
                100
            ),
            0
        );

        assert.equal(
            normalizeNonNegativeInteger(
                "500",
                100
            ),
            500
        );

        assert.equal(
            normalizeNonNegativeInteger(
                undefined,
                100
            ),
            100
        );
    }
);

test(
    "normalizeNonNegativeInteger rejects negative and fractional values",
    function () {
        assert.throws(
            function () {
                normalizeNonNegativeInteger(
                    -1,
                    100
                );
            },
            /non-negative integer/
        );

        assert.throws(
            function () {
                normalizeNonNegativeInteger(
                    1.5,
                    100
                );
            },
            /non-negative integer/
        );
    }
);

test(
    "normalizeCount clamps malformed values to zero",
    function () {
        assert.equal(
            normalizeCount(
                "5"
            ),
            5
        );

        assert.equal(
            normalizeCount(
                3.9
            ),
            3
        );

        assert.equal(
            normalizeCount(
                -1
            ),
            0
        );

        assert.equal(
            normalizeCount(
                "invalid"
            ),
            0
        );
    }
);

/* ==========================================================
   IDENTITY RESOLUTION
========================================================== */

test(
    "resolveUserId supports direct and contextual user IDs",
    function () {
        assert.equal(
            resolveUserId({
                userId:
                    "user-1"
            }),
            "user-1"
        );

        assert.equal(
            resolveUserId({
                context: {
                    userId:
                        "user-2"
                }
            }),
            "user-2"
        );

        assert.equal(
            resolveUserId({
                requestContext: {
                    userId:
                        "user-3"
                }
            }),
            "user-3"
        );

        assert.equal(
            resolveUserId({
                auth: {
                    uid:
                        "user-4"
                }
            }),
            "user-4"
        );

        assert.equal(
            resolveUserId({
                user: {
                    uid:
                        "user-5"
                }
            }),
            "user-5"
        );
    }
);

test(
    "resolveUserId returns an empty string when unavailable",
    function () {
        assert.equal(
            resolveUserId(
                {}
            ),
            ""
        );
    }
);

test(
    "resolveIpAddress uses direct IP by default",
    function () {
        assert.equal(
            resolveIpAddress(
                {
                    ip:
                        "127.0.0.1",

                    headers: {
                        "x-forwarded-for":
                            "203.0.113.10"
                    }
                },
                {}
            ),
            "127.0.0.1"
        );
    }
);

test(
    "resolveIpAddress trusts forwarded IP when enabled",
    function () {
        assert.equal(
            resolveIpAddress(
                {
                    ip:
                        "127.0.0.1",

                    headers: {
                        "x-forwarded-for":
                            "203.0.113.10, 198.51.100.20"
                    }
                },
                {
                    trustProxy:
                        true
                }
            ),
            "203.0.113.10"
        );
    }
);

test(
    "resolveIpAddress supports callable raw requests",
    function () {
        assert.equal(
            resolveIpAddress(
                {
                    rawRequest: {
                        ip:
                            "127.0.0.2"
                    }
                },
                {}
            ),
            "127.0.0.2"
        );
    }
);

test(
    "resolveRateLimitIdentity prefers custom resolver",
    function () {
        assert.equal(
            resolveRateLimitIdentity(
                {
                    userId:
                        "user-1"
                },
                {
                    keyResolver:
                        function () {
                            return "custom:key";
                        }
                }
            ),
            "custom:key"
        );
    }
);

test(
    "resolveRateLimitIdentity supports fixed key",
    function () {
        assert.equal(
            resolveRateLimitIdentity(
                {},
                {
                    key:
                        "global-checkout"
                }
            ),
            "global-checkout"
        );
    }
);

test(
    "resolveRateLimitIdentity prefers authenticated user",
    function () {
        assert.equal(
            resolveRateLimitIdentity(
                {
                    auth: {
                        uid:
                            "customer-1"
                    },

                    ip:
                        "127.0.0.1"
                },
                {}
            ),
            "user:customer-1"
        );
    }
);

test(
    "resolveRateLimitIdentity falls back to IP",
    function () {
        assert.equal(
            resolveRateLimitIdentity(
                {
                    ip:
                        "127.0.0.1"
                },
                {}
            ),
            "ip:127.0.0.1"
        );
    }
);

test(
    "resolveRateLimitIdentity supports anonymous keys",
    function () {
        assert.equal(
            resolveRateLimitIdentity(
                {},
                {
                    allowAnonymousKey:
                        true
                }
            ),
            "anonymous"
        );
    }
);

test(
    "resolveRateLimitIdentity rejects unresolved required identity",
    function () {
        assert.throws(
            function () {
                resolveRateLimitIdentity(
                    {},
                    {
                        allowAnonymousKey:
                            false
                    }
                );
            },
            function (error) {
                assert.equal(
                    error instanceof
                        ServiceError,
                    true
                );

                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

test(
    "normalizeIdentityKey validates key values",
    function () {
        assert.equal(
            normalizeIdentityKey(
                " custom:key "
            ),
            "custom:key"
        );

        assert.throws(
            function () {
                normalizeIdentityKey(
                    ""
                );
            },
            /rate-limit key is invalid/
        );

        assert.throws(
            function () {
                normalizeIdentityKey(
                    "x".repeat(
                        constants
                            .DEFAULT_MAX_KEY_LENGTH +
                        1
                    )
                );
            },
            /too long/
        );
    }
);

/* ==========================================================
   DESCRIPTORS AND HASHING
========================================================== */

test(
    "hashRateLimitKey creates deterministic SHA-256 hashes",
    function () {
        const first =
            hashRateLimitKey(
                "checkout:user:customer-1"
            );

        const second =
            hashRateLimitKey(
                "checkout:user:customer-1"
            );

        assert.equal(
            first,
            second
        );

        assert.match(
            first,
            /^[a-f0-9]{64}$/
        );
    }
);

test(
    "createRateLimitDescriptor creates fixed-window metadata",
    function () {
        const descriptor =
            createRateLimitDescriptor(
                "user:customer-1",
                65000,
                {
                    prefix:
                        "checkout",

                    limit:
                        5,

                    cost:
                        1,

                    windowMs:
                        60000
                }
            );

        assert.equal(
            descriptor.identity,
            "user:customer-1"
        );

        assert.equal(
            descriptor.prefix,
            "checkout"
        );

        assert.equal(
            descriptor.key,
            "checkout:user:customer-1"
        );

        assert.equal(
            descriptor.windowStart,
            60000
        );

        assert.equal(
            descriptor.windowEnd,
            120000
        );

        assert.equal(
            descriptor.limit,
            5
        );

        assert.equal(
            descriptor.cost,
            1
        );

        assert.equal(
            descriptor.documentId,
            descriptor.keyHash +
            "_60000"
        );
    }
);

/* ==========================================================
   RESULT HELPERS
========================================================== */

test(
    "createRateLimitResult calculates remaining and retry values",
    function () {
        const descriptor =
            createRateLimitDescriptor(
                "user:customer-1",
                65000,
                {
                    prefix:
                        "checkout",

                    limit:
                        5,

                    cost:
                        1,

                    windowMs:
                        60000
                }
            );

        const result =
            createRateLimitResult(
                descriptor,
                {
                    count:
                        3,

                    attemptedCount:
                        3,

                    allowed:
                        true,

                    now:
                        65000
                }
            );

        assert.equal(
            result.allowed,
            true
        );

        assert.equal(
            result.count,
            3
        );

        assert.equal(
            result.remaining,
            2
        );

        assert.equal(
            result.retryAfterMs,
            55000
        );

        assert.equal(
            result.retryAfterSeconds,
            55
        );

        assert.equal(
            result.resetAt,
            new Date(
                120000
            ).toISOString()
        );
    }
);

test(
    "createRateLimitResult clamps remaining to zero",
    function () {
        const descriptor =
            createRateLimitDescriptor(
                "anonymous",
                0,
                {
                    limit:
                        2,

                    cost:
                        1,

                    windowMs:
                        60000
                }
            );

        const result =
            createRateLimitResult(
                descriptor,
                {
                    count:
                        5,

                    allowed:
                        false,

                    now:
                        0
                }
            );

        assert.equal(
            result.remaining,
            0
        );
    }
);

test(
    "createResultFromError extracts response metadata",
    function () {
        const error =
            new ServiceError(
                "too-many-requests",
                "Rate limit exceeded.",
                {
                    details: {
                        limit:
                            5,

                        remaining:
                            0,

                        retryAfterMs:
                            30000,

                        retryAfterSeconds:
                            30,

                        resetAt:
                            "2026-07-20T09:01:00.000Z"
                    }
                }
            );

        assert.deepEqual(
            createResultFromError(
                error
            ),
            {
                limit:
                    5,

                remaining:
                    0,

                retryAfterMs:
                    30000,

                retryAfterSeconds:
                    30,

                resetAt:
                    "2026-07-20T09:01:00.000Z"
            }
        );
    }
);

/* ==========================================================
   CONSUMPTION
========================================================== */

test(
    "consumeRateLimit creates a new counter",
    async function () {
        const firestore =
            createFirestoreStub();

        const runtime =
            createRuntime({
                firestore:
                    firestore,

                now:
                    function () {
                        return 1000;
                    }
            });

        const result =
            await consumeRateLimit(
                runtime,
                {
                    auth: {
                        uid:
                            "customer-1"
                    }
                },
                {
                    prefix:
                        "checkout",

                    limit:
                        3,

                    windowMs:
                        60000,

                    now:
                        function () {
                            return 1000;
                        }
                }
            );

        assert.equal(
            result.allowed,
            true
        );

        assert.equal(
            result.count,
            1
        );

        assert.equal(
            result.remaining,
            2
        );

        const stored =
            firestore.getDocument(
                constants
                    .RATE_LIMIT_COLLECTION +
                "/" +
                result.documentId
            );

        assert.equal(
            stored.count,
            1
        );

        assert.equal(
            stored.limit,
            3
        );

        assert.equal(
            stored.identity,
            "user:customer-1"
        );

        assert.equal(
            stored.createdAt
                instanceof
                TestTimestamp,
            true
        );

        assert.equal(
            stored.expiresAt
                .toMillis(),
            120000
        );
    }
);

test(
    "consumeRateLimit increments an active counter",
    async function () {
        const firestore =
            createFirestoreStub();

        const runtime =
            createRuntime({
                firestore:
                    firestore
            });

        const options = {
            prefix:
                "checkout",

            limit:
                3,

            windowMs:
                60000,

            now:
                function () {
                    return 1000;
                }
        };

        const first =
            await consumeRateLimit(
                runtime,
                {
                    userId:
                        "customer-1"
                },
                options
            );

        const second =
            await consumeRateLimit(
                runtime,
                {
                    userId:
                        "customer-1"
                },
                options
            );

        assert.equal(
            first.count,
            1
        );

        assert.equal(
            second.count,
            2
        );

        assert.equal(
            second.remaining,
            1
        );
    }
);

test(
    "consumeRateLimit supports request costs",
    async function () {
        const runtime =
            createRuntime();

        const result =
            await consumeRateLimit(
                runtime,
                {
                    userId:
                        "customer-1"
                },
                {
                    limit:
                        5,

                    cost:
                        2,

                    windowMs:
                        60000,

                    now:
                        function () {
                            return 1000;
                        }
                }
            );

        assert.equal(
            result.count,
            2
        );

        assert.equal(
            result.remaining,
            3
        );
    }
);

test(
    "consumeRateLimit rejects requests beyond limit",
    async function () {
        const runtime =
            createRuntime();

        const options = {
            limit:
                2,

            windowMs:
                60000,

            now:
                function () {
                    return 1000;
                }
        };

        await consumeRateLimit(
            runtime,
            {
                userId:
                    "customer-1"
            },
            options
        );

        await consumeRateLimit(
            runtime,
            {
                userId:
                    "customer-1"
            },
            options
        );

        const rejected =
            await consumeRateLimit(
                runtime,
                {
                    userId:
                        "customer-1"
                },
                options
            );

        assert.equal(
            rejected.allowed,
            false
        );

        assert.equal(
            rejected.count,
            3
        );

        assert.equal(
            rejected.attemptedCount,
            3
        );

        assert.equal(
            rejected.remaining,
            0
        );
    }
);

test(
    "consumeRateLimit can avoid counting rejected attempts",
    async function () {
        const runtime =
            createRuntime();

        const options = {
            limit:
                1,

            countRejected:
                false,

            windowMs:
                60000,

            now:
                function () {
                    return 1000;
                }
        };

        await consumeRateLimit(
            runtime,
            {
                userId:
                    "customer-1"
            },
            options
        );

        const rejected =
            await consumeRateLimit(
                runtime,
                {
                    userId:
                        "customer-1"
                },
                options
            );

        assert.equal(
            rejected.allowed,
            false
        );

        assert.equal(
            rejected.count,
            1
        );

        assert.equal(
            rejected.attemptedCount,
            2
        );
    }
);

test(
    "consumeRateLimit starts a new counter in a new window",
    async function () {
        let now =
            1000;

        const runtime =
            createRuntime({
                now:
                    function () {
                        return now;
                    }
            });

        const options = {
            limit:
                2,

            windowMs:
                60000,

            now:
                function () {
                    return now;
                }
        };

        const first =
            await consumeRateLimit(
                runtime,
                {
                    userId:
                        "customer-1"
                },
                options
            );

        now =
            61000;

        const second =
            await consumeRateLimit(
                runtime,
                {
                    userId:
                        "customer-1"
                },
                options
            );

        assert.equal(
            first.windowStart,
            0
        );

        assert.equal(
            second.windowStart,
            60000
        );

        assert.equal(
            second.count,
            1
        );

        assert.notEqual(
            first.documentId,
            second.documentId
        );
    }
);

test(
    "consumeRateLimit bypasses datastore when disabled",
    async function () {
        const result =
            await consumeRateLimit(
                null,
                {},
                {
                    disabled:
                        true,

                    key:
                        "disabled",

                    limit:
                        5,

                    windowMs:
                        60000,

                    now:
                        function () {
                            return 1000;
                        }
                }
            );

        assert.equal(
            result.allowed,
            true
        );

        assert.equal(
            result.disabled,
            true
        );

        assert.equal(
            result.count,
            0
        );
    }
);

/* ==========================================================
   INSPECTION
========================================================== */

test(
    "inspectRateLimit reports unused limit",
    async function () {
        const runtime =
            createRuntime();

        const result =
            await inspectRateLimit(
                runtime,
                {
                    userId:
                        "customer-1"
                },
                {
                    limit:
                        3,

                    windowMs:
                        60000,

                    now:
                        function () {
                            return 1000;
                        }
                }
            );

        assert.equal(
            result.allowed,
            true
        );

        assert.equal(
            result.count,
            0
        );

        assert.equal(
            result.remaining,
            3
        );
    }
);

test(
    "inspectRateLimit reports active counter state",
    async function () {
        const runtime =
            createRuntime();

        const options = {
            limit:
                3,

            windowMs:
                60000,

            now:
                function () {
                    return 1000;
                }
        };

        await consumeRateLimit(
            runtime,
            {
                userId:
                    "customer-1"
            },
            options
        );

        await consumeRateLimit(
            runtime,
            {
                userId:
                    "customer-1"
            },
            options
        );

        const result =
            await inspectRateLimit(
                runtime,
                {
                    userId:
                        "customer-1"
                },
                options
            );

        assert.equal(
            result.count,
            2
        );

        assert.equal(
            result.remaining,
            1
        );

        assert.equal(
            result.allowed,
            true
        );
    }
);

test(
    "inspectRateLimit reports whether next cost would be allowed",
    async function () {
        const runtime =
            createRuntime();

        const consumeOptions = {
            limit:
                3,

            cost:
                1,

            windowMs:
                60000,

            now:
                function () {
                    return 1000;
                }
        };

        await consumeRateLimit(
            runtime,
            {
                userId:
                    "customer-1"
            },
            consumeOptions
        );

        await consumeRateLimit(
            runtime,
            {
                userId:
                    "customer-1"
            },
            consumeOptions
        );

        const result =
            await inspectRateLimit(
                runtime,
                {
                    userId:
                        "customer-1"
                },
                Object.assign(
                    {},
                    consumeOptions,
                    {
                        cost:
                            2
                    }
                )
            );

        assert.equal(
            result.allowed,
            false
        );
    }
);

/* ==========================================================
   RESET
========================================================== */

test(
    "resetRateLimit deletes the active counter",
    async function () {
        const firestore =
            createFirestoreStub();

        const runtime =
            createRuntime({
                firestore:
                    firestore
            });

        const options = {
            limit:
                3,

            windowMs:
                60000,

            now:
                function () {
                    return 1000;
                }
        };

        const consumed =
            await consumeRateLimit(
                runtime,
                {
                    userId:
                        "customer-1"
                },
                options
            );

        assert.equal(
            firestore.hasDocument(
                constants
                    .RATE_LIMIT_COLLECTION +
                "/" +
                consumed.documentId
            ),
            true
        );

        const reset =
            await resetRateLimit(
                runtime,
                {
                    userId:
                        "customer-1"
                },
                options
            );

        assert.equal(
            reset.reset,
            true
        );

        assert.equal(
            firestore.hasDocument(
                constants
                    .RATE_LIMIT_COLLECTION +
                "/" +
                consumed.documentId
            ),
            false
        );
    }
);

test(
    "resetRateLimit is a no-op when disabled",
    async function () {
        const result =
            await resetRateLimit(
                null,
                {},
                {
                    disabled:
                        true,

                    key:
                        "disabled",

                    now:
                        function () {
                            return 1000;
                        }
                }
            );

        assert.deepEqual(
            result,
            {
                reset:
                    false,

                disabled:
                    true,

                key:
                    "global:disabled"
            }
        );
    }
);

/* ==========================================================
   ENFORCEMENT AND ERRORS
========================================================== */

test(
    "enforceRateLimit returns allowed results",
    async function () {
        const result =
            await enforceRateLimit(
                createRuntime(),
                {
                    userId:
                        "customer-1"
                },
                {
                    limit:
                        1,

                    windowMs:
                        60000,

                    now:
                        function () {
                            return 1000;
                        }
                }
            );

        assert.equal(
            result.allowed,
            true
        );
    }
);

test(
    "enforceRateLimit throws when limit is exceeded",
    async function () {
        const runtime =
            createRuntime();

        const options = {
            limit:
                1,

            windowMs:
                60000,

            now:
                function () {
                    return 1000;
                },

            requestId:
                "req_123",

            correlationId:
                "corr_123"
        };

        await enforceRateLimit(
            runtime,
            {
                userId:
                    "customer-1"
            },
            options
        );

        await assert.rejects(
            async function () {
                await enforceRateLimit(
                    runtime,
                    {
                        userId:
                            "customer-1"
                    },
                    options
                );
            },
            function (error) {
                assert.equal(
                    error instanceof
                        ServiceError,
                    true
                );

                assert.equal(
                    error.code,
                    "too-many-requests"
                );

                assert.equal(
                    error.status,
                    429
                );

                assert.equal(
                    error.retryable,
                    true
                );

                assert.equal(
                    error.requestId,
                    "req_123"
                );

                assert.equal(
                    error.correlationId,
                    "corr_123"
                );

                assert.equal(
                    error.details.limit,
                    1
                );

                assert.equal(
                    error.details.remaining,
                    0
                );

                return true;
            }
        );
    }
);

test(
    "createRateLimitError hides key by default",
    function () {
        const error =
            createRateLimitError(
                {
                    limit:
                        5,

                    remaining:
                        0,

                    retryAfterMs:
                        30000,

                    retryAfterSeconds:
                        30,

                    resetAt:
                        "2026-07-20T09:01:00.000Z",

                    key:
                        "checkout:user:customer-1"
                },
                {}
            );

        assert.equal(
            error.details.key,
            undefined
        );
    }
);

test(
    "createRateLimitError can expose key explicitly",
    function () {
        const error =
            createRateLimitError(
                {
                    limit:
                        5,

                    remaining:
                        0,

                    retryAfterMs:
                        30000,

                    retryAfterSeconds:
                        30,

                    resetAt:
                        "2026-07-20T09:01:00.000Z",

                    key:
                        "checkout:user:customer-1"
                },
                {
                    exposeKey:
                        true,

                    message:
                        "Checkout rate limit exceeded."
                }
            );

        assert.equal(
            error.publicMessage,
            "Checkout rate limit exceeded."
        );

        assert.equal(
            error.details.key,
            "checkout:user:customer-1"
        );
    }
);

/* ==========================================================
   MIDDLEWARE
========================================================== */

test(
    "createRateLimitMiddleware attaches headers and request result",
    async function () {
        const response =
            createResponseStub();

        const next =
            createNextStub();

        const service = {
            enforce:
                async function () {
                    return {
                        allowed:
                            true,

                        limit:
                            5,

                        remaining:
                            4,

                        retryAfterSeconds:
                            60,

                        windowEnd:
                            60000
                    };
                }
        };

        const request = {
            requestContext: {
                requestId:
                    "req_123",

                correlationId:
                    "corr_123"
            }
        };

        const middleware =
            createRateLimitMiddleware({
                service:
                    service
            });

        const result =
            await middleware(
                request,
                response.response,
                next.next
            );

        assert.equal(
            next.state.called,
            true
        );

        assert.equal(
            next.state.error,
            undefined
        );

        assert.equal(
            request.rateLimit,
            result
        );

        assert.equal(
            response.state
                .headers[
                "ratelimit-limit"
            ],
            "5"
        );

        assert.equal(
            response.state
                .headers[
                "ratelimit-remaining"
            ],
            "4"
        );
    }
);

test(
    "createRateLimitMiddleware forwards rate-limit errors",
    async function () {
        const response =
            createResponseStub();

        const next =
            createNextStub();

        const service = {
            enforce:
                async function () {
                    throw new ServiceError(
                        "too-many-requests",
                        "Too many requests.",
                        {
                            status:
                                429,

                            details: {
                                limit:
                                    5,

                                remaining:
                                    0,

                                retryAfterMs:
                                    30000,

                                retryAfterSeconds:
                                    30,

                                resetAt:
                                    "2026-07-20T09:01:00.000Z"
                            }
                        }
                    );
                }
        };

        const middleware =
            createRateLimitMiddleware({
                service:
                    service
            });

        await middleware(
            {},
            response.response,
            next.next
        );

        assert.equal(
            next.state.called,
            true
        );

        assert.equal(
            next.state.error.code,
            "too-many-requests"
        );

        assert.equal(
            response.state
                .headers[
                "retry-after"
            ],
            "30"
        );
    }
);

test(
    "createRateLimitMiddleware throws without next callback",
    async function () {
        const expected =
            new Error(
                "Unexpected failure."
            );

        const middleware =
            createRateLimitMiddleware({
                service: {
                    enforce:
                        async function () {
                            throw expected;
                        }
                }
            });

        await assert.rejects(
            async function () {
                await middleware(
                    {},
                    createResponseStub()
                        .response
                );
            },
            expected
        );
    }
);

/* ==========================================================
   CALLABLE GUARD
========================================================== */

test(
    "createCallableRateLimitGuard forwards callable identity and context",
    async function () {
        let receivedInput;
        let receivedOverrides;

        const service = {
            enforce:
                async function (
                    input,
                    overrides
                ) {
                    receivedInput =
                        input;

                    receivedOverrides =
                        overrides;

                    return {
                        allowed:
                            true
                    };
                }
        };

        const guard =
            createCallableRateLimitGuard({
                service:
                    service
            });

        const rawRequest = {
            ip:
                "127.0.0.1"
        };

        const context = {
            requestId:
                "req_123",

            correlationId:
                "corr_123"
        };

        const result =
            await guard(
                {
                    auth: {
                        uid:
                            "customer-1"
                    },

                    rawRequest:
                        rawRequest
                },
                context
            );

        assert.equal(
            result.allowed,
            true
        );

        assert.deepEqual(
            receivedInput,
            {
                auth: {
                    uid:
                        "customer-1"
                },

                rawRequest:
                    rawRequest,

                context:
                    context
            }
        );

        assert.deepEqual(
            receivedOverrides,
            {
                requestId:
                    "req_123",

                correlationId:
                    "corr_123"
            }
        );
    }
);

/* ==========================================================
   RESPONSE HEADERS
========================================================== */

test(
    "attachRateLimitHeaders writes standard headers",
    function () {
        const response =
            createResponseStub();

        attachRateLimitHeaders(
            response.response,
            {
                allowed:
                    true,

                limit:
                    10,

                remaining:
                    8,

                retryAfterSeconds:
                    45,

                windowEnd:
                    123456
            }
        );

        assert.deepEqual(
            response.state.headers,
            {
                "ratelimit-limit":
                    "10",

                "ratelimit-remaining":
                    "8",

                "ratelimit-reset":
                    "45",

                "x-ratelimit-limit":
                    "10",

                "x-ratelimit-remaining":
                    "8",

                "x-ratelimit-reset":
                    "123456"
            }
        );
    }
);

test(
    "attachRateLimitHeaders writes Retry-After for rejected requests",
    function () {
        const response =
            createResponseStub();

        attachRateLimitHeaders(
            response.response,
            {
                allowed:
                    false,

                limit:
                    10,

                remaining:
                    0,

                retryAfterSeconds:
                    45,

                windowEnd:
                    123456
            }
        );

        assert.equal(
            response.state
                .headers[
                "retry-after"
            ],
            "45"
        );
    }
);

test(
    "attachRateLimitHeaders safely ignores missing response",
    function () {
        assert.equal(
            attachRateLimitHeaders(
                null,
                {
                    limit:
                        1
                }
            ),
            null
        );
    }
);

/* ==========================================================
   RUNTIME HELPERS
========================================================== */

test(
    "assertRateLimitRuntime accepts valid runtime",
    function () {
        assert.doesNotThrow(
            function () {
                assertRateLimitRuntime(
                    createRuntime()
                );
            }
        );
    }
);

test(
    "assertRateLimitRuntime rejects missing Firestore",
    function () {
        assert.throws(
            function () {
                assertRateLimitRuntime(
                    null
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "configuration-error"
                );

                return true;
            }
        );
    }
);

test(
    "assertRateLimitRuntime requires transactions",
    function () {
        assert.throws(
            function () {
                assertRateLimitRuntime({
                    db: {
                        collection:
                            function () {}
                    }
                });
            },
            /transactions are required/
        );
    }
);

test(
    "resolveNow prefers options clock",
    function () {
        assert.equal(
            resolveNow(
                {
                    now:
                        function () {
                            return 1000;
                        }
                },
                {
                    now:
                        function () {
                            return 2000;
                        }
                }
            ),
            2000
        );
    }
);

test(
    "resolveNow falls back to runtime clock",
    function () {
        assert.equal(
            resolveNow(
                {
                    now:
                        function () {
                            return 1000;
                        }
                },
                {}
            ),
            1000
        );
    }
);

test(
    "createDatabaseTimestamp uses runtime Timestamp",
    function () {
        const timestamp =
            createDatabaseTimestamp(
                {
                    Timestamp:
                        TestTimestamp
                },
                12345
            );

        assert.equal(
            timestamp instanceof
                TestTimestamp,
            true
        );

        assert.equal(
            timestamp.toMillis(),
            12345
        );
    }
);

test(
    "createDatabaseTimestamp falls back to Date",
    function () {
        const timestamp =
            createDatabaseTimestamp(
                {},
                12345
            );

        assert.equal(
            timestamp instanceof Date,
            true
        );

        assert.equal(
            timestamp.getTime(),
            12345
        );
    }
);

/* ==========================================================
   LOGGING
========================================================== */

test(
    "logRateLimitResult logs allowed requests at debug level",
    function () {
        const logger =
            createLoggerStub();

        logRateLimitResult(
            {
                logger:
                    logger
            },
            {
                prefix:
                    "checkout",

                identity:
                    "user:customer-1",

                allowed:
                    true,

                count:
                    1,

                limit:
                    5,

                remaining:
                    4,

                resetAt:
                    "2026-07-20T09:01:00.000Z"
            },
            {}
        );

        assert.equal(
            logger.entries.length,
            1
        );

        assert.equal(
            logger.entries[0].level,
            "debug"
        );

        assert.equal(
            logger.entries[0].message,
            "Rate limit consumed."
        );
    }
);

test(
    "logRateLimitResult logs rejected requests at warn level",
    function () {
        const logger =
            createLoggerStub();

        logRateLimitResult(
            {
                logger:
                    logger
            },
            {
                prefix:
                    "checkout",

                identity:
                    "user:customer-1",

                allowed:
                    false,

                count:
                    6,

                limit:
                    5,

                remaining:
                    0,

                resetAt:
                    "2026-07-20T09:01:00.000Z"
            },
            {}
        );

        assert.equal(
            logger.entries[0].level,
            "warn"
        );

        assert.equal(
            logger.entries[0].message,
            "Rate limit exceeded."
        );
    }
);

test(
    "logRateLimitResult can be disabled",
    function () {
        const logger =
            createLoggerStub();

        logRateLimitResult(
            {
                logger:
                    logger
            },
            {
                allowed:
                    true
            },
            {
                log:
                    false
            }
        );

        assert.equal(
            logger.entries.length,
            0
        );
    }
);

/* ==========================================================
   CONSTANTS
========================================================== */

test(
    "rate-limit constants expose expected defaults",
    function () {
        assert.equal(
            constants
                .RATE_LIMIT_COLLECTION,
            "_rateLimits"
        );

        assert.equal(
            constants.DEFAULT_LIMIT,
            60
        );

        assert.equal(
            constants
                .DEFAULT_WINDOW_MS,
            60000
        );

        assert.equal(
            constants
                .DEFAULT_KEY_PREFIX,
            "global"
        );

        assert.equal(
            constants
                .DEFAULT_MAX_KEY_LENGTH,
            500
        );

        assert.equal(
            constants.RATE_LIMIT_CODE,
            "too-many-requests"
        );
    }
);