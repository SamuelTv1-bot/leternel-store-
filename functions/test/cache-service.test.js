"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   CACHE SERVICE TEST SUITE
========================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createCacheService,
    getCachedValue,
    setCachedValue,
    deleteCachedValue,
    inspectCachedValue,
    rememberCachedValue,
    createCacheDescriptor,
    normalizeCacheKey,
    normalizeNamespace,
    hashCacheKey,
    createCacheResult,
    sanitizeCacheRecord,
    assertSerializableCacheValue,
    stableStringify,
    normalizeStableValue,
    normalizeCacheOptions,
    normalizeCollection,
    normalizePositiveInteger,
    normalizeNonNegativeInteger,
    assertCacheRuntime,
    resolveNow,
    createDatabaseTimestamp,
    toMilliseconds,
    sanitizeMetadata,
    serializeTimestamp,
    serializeCacheError,
    logCacheEvent,
    logCacheLoadFailure,
    constants
} = require(
    "../src/shared/cache-service"
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

    static fromMillis(milliseconds) {
        return new TestTimestamp(
            milliseconds
        );
    }
}

function clone(value) {
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
        return TestTimestamp.fromMillis(
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
        Buffer.isBuffer(value)
    ) {
        return Buffer.from(
            value
        );
    }

    if (
        Array.isArray(value)
    ) {
        return value.map(
            clone
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
                        clone(
                            value[key]
                        );

                    return output;
                },
                {}
            );
    }

    return value;
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
            value
        ]) {
            documents.set(
                path,
                clone(value)
            );
        }
    );

    function createSnapshot(path) {
        return {
            exists:
                documents.has(path),

            data:
                function () {
                    return documents.has(path)
                        ? clone(
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
                    const stored =
                        options &&
                        options.merge
                            ? Object.assign(
                                  {},
                                  clone(
                                      documents.get(
                                          path
                                      ) || {}
                                  ),
                                  clone(value)
                              )
                            : clone(value);

                    documents.set(
                        path,
                        stored
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

    return {
        db: {
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
                }
        },

        getDocument:
            function (path) {
                return documents.has(path)
                    ? clone(
                          documents.get(
                              path
                          )
                      )
                    : undefined;
            },

        hasDocument:
            function (path) {
                return documents.has(
                    path
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
            }
    };
}

function createRuntime(options) {
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

function getCachePath(
    key,
    namespace
) {
    const descriptor =
        createCacheDescriptor(
            key,
            namespace
        );

    return (
        constants.CACHE_COLLECTION +
        "/" +
        descriptor.documentId
    );
}

/* ==========================================================
   SERVICE FACTORY
========================================================== */

test(
    "createCacheService creates a frozen service",
    function () {
        const runtime =
            createRuntime();

        const service =
            createCacheService({
                runtime:
                    runtime,

                namespace:
                    "products",

                ttlMs:
                    10000
            });

        assert.equal(
            service.runtime,
            runtime
        );

        assert.equal(
            service.options.namespace,
            "products"
        );

        assert.equal(
            service.options.ttlMs,
            10000
        );

        assert.equal(
            typeof service.get,
            "function"
        );

        assert.equal(
            typeof service.set,
            "function"
        );

        assert.equal(
            typeof service.delete,
            "function"
        );

        assert.equal(
            typeof service.remember,
            "function"
        );

        assert.equal(
            typeof service.inspect,
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
    "normalizeCacheOptions applies defaults",
    function () {
        const options =
            normalizeCacheOptions(
                {}
            );

        assert.equal(
            options.collection,
            constants.CACHE_COLLECTION
        );

        assert.equal(
            options.namespace,
            constants.DEFAULT_NAMESPACE
        );

        assert.equal(
            options.ttlMs,
            constants.DEFAULT_TTL_MS
        );

        assert.equal(
            options.staleTtlMs,
            constants.DEFAULT_STALE_TTL_MS
        );

        assert.equal(
            options.maxValueBytes,
            constants.DEFAULT_MAX_VALUE_BYTES
        );

        assert.equal(
            options.allowStale,
            false
        );

        assert.equal(
            options.refreshStale,
            true
        );

        assert.equal(
            options.useStaleOnError,
            true
        );

        assert.equal(
            options.deleteExpired,
            true
        );

        assert.equal(
            options.disabled,
            false
        );

        assert.equal(
            options.log,
            true
        );
    }
);

test(
    "normalizeCacheOptions respects overrides",
    function () {
        const options =
            normalizeCacheOptions({
                collection:
                    "customCache",

                namespace:
                    "catalog",

                ttlMs:
                    10000,

                staleTtlMs:
                    5000,

                maxValueBytes:
                    1000,

                allowStale:
                    true,

                refreshStale:
                    false,

                useStaleOnError:
                    false,

                deleteExpired:
                    false,

                disabled:
                    true,

                exposeKey:
                    true,

                log:
                    false,

                metadata: {
                    source:
                        "products"
                }
            });

        assert.equal(
            options.collection,
            "customCache"
        );

        assert.equal(
            options.namespace,
            "catalog"
        );

        assert.equal(
            options.ttlMs,
            10000
        );

        assert.equal(
            options.staleTtlMs,
            5000
        );

        assert.equal(
            options.maxValueBytes,
            1000
        );

        assert.equal(
            options.allowStale,
            true
        );

        assert.equal(
            options.refreshStale,
            false
        );

        assert.equal(
            options.useStaleOnError,
            false
        );

        assert.equal(
            options.deleteExpired,
            false
        );

        assert.equal(
            options.disabled,
            true
        );

        assert.equal(
            options.exposeKey,
            true
        );

        assert.equal(
            options.log,
            false
        );

        assert.deepEqual(
            options.metadata,
            {
                source:
                    "products"
            }
        );
    }
);

test(
    "normalizeCollection validates collection names",
    function () {
        assert.equal(
            normalizeCollection(
                "_cache"
            ),
            "_cache"
        );

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
                    "internal/cache"
                );
            },
            /Firestore collection name/
        );
    }
);

test(
    "integer option helpers validate values",
    function () {
        assert.equal(
            normalizePositiveInteger(
                "10",
                1,
                "Value"
            ),
            10
        );

        assert.equal(
            normalizePositiveInteger(
                undefined,
                5,
                "Value"
            ),
            5
        );

        assert.throws(
            function () {
                normalizePositiveInteger(
                    0,
                    1,
                    "Value"
                );
            },
            /positive integer/
        );

        assert.equal(
            normalizeNonNegativeInteger(
                0,
                5,
                "Value"
            ),
            0
        );

        assert.equal(
            normalizeNonNegativeInteger(
                "10",
                5,
                "Value"
            ),
            10
        );

        assert.throws(
            function () {
                normalizeNonNegativeInteger(
                    -1,
                    0,
                    "Value"
                );
            },
            /non-negative integer/
        );
    }
);

/* ==========================================================
   KEYS AND DESCRIPTORS
========================================================== */

test(
    "normalizeCacheKey accepts strings",
    function () {
        assert.equal(
            normalizeCacheKey(
                " product:123 "
            ),
            "product:123"
        );
    }
);

test(
    "normalizeCacheKey serializes object keys deterministically",
    function () {
        assert.equal(
            normalizeCacheKey({
                b:
                    2,

                a:
                    1
            }),
            '{"a":1,"b":2}'
        );
    }
);

test(
    "normalizeCacheKey rejects invalid values",
    function () {
        assert.throws(
            function () {
                normalizeCacheKey(
                    ""
                );
            },
            /cache key is invalid/
        );

        assert.throws(
            function () {
                normalizeCacheKey(
                    "x".repeat(
                        constants.DEFAULT_MAX_KEY_LENGTH +
                        1
                    )
                );
            },
            /too long/
        );
    }
);

test(
    "normalizeNamespace sanitizes namespace values",
    function () {
        assert.equal(
            normalizeNamespace(
                " Product Catalog "
            ),
            "product-catalog"
        );

        assert.equal(
            normalizeNamespace(
                ""
            ),
            "global"
        );
    }
);

test(
    "hashCacheKey returns deterministic SHA-256 hashes",
    function () {
        const first =
            hashCacheKey(
                "products:product-1"
            );

        const second =
            hashCacheKey(
                "products:product-1"
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
    "createCacheDescriptor creates deterministic metadata",
    function () {
        const descriptor =
            createCacheDescriptor(
                "product-1",
                "products"
            );

        assert.equal(
            descriptor.key,
            "product-1"
        );

        assert.equal(
            descriptor.namespace,
            "products"
        );

        assert.equal(
            descriptor.compositeKey,
            "products:product-1"
        );

        assert.equal(
            descriptor.keyHash,
            hashCacheKey(
                "products:product-1"
            )
        );

        assert.equal(
            descriptor.documentId,
            descriptor.keyHash
        );
    }
);

/* ==========================================================
   STABLE SERIALIZATION
========================================================== */

test(
    "stableStringify sorts object keys",
    function () {
        assert.equal(
            stableStringify({
                z:
                    3,

                a:
                    1,

                m:
                    2
            }),
            '{"a":1,"m":2,"z":3}'
        );
    }
);

test(
    "normalizeStableValue handles special values",
    function () {
        assert.deepEqual(
            normalizeStableValue({
                date:
                    new Date(
                        "2026-07-20T09:00:00.000Z"
                    ),

                buffer:
                    Buffer.from(
                        "hello"
                    ),

                bigint:
                    10n,

                missing:
                    undefined
            }),
            {
                bigint:
                    "10",

                buffer:
                    "aGVsbG8=",

                date:
                    "2026-07-20T09:00:00.000Z",

                missing:
                    null
            }
        );
    }
);

test(
    "normalizeStableValue preserves array order",
    function () {
        assert.deepEqual(
            normalizeStableValue([
                3,
                1,
                2
            ]),
            [
                3,
                1,
                2
            ]
        );
    }
);

test(
    "normalizeStableValue rejects circular references",
    function () {
        const value = {};

        value.self =
            value;

        assert.throws(
            function () {
                normalizeStableValue(
                    value
                );
            },
            /circular reference/
        );
    }
);

/* ==========================================================
   CACHE VALUE VALIDATION
========================================================== */

test(
    "assertSerializableCacheValue accepts valid values",
    function () {
        assert.equal(
            assertSerializableCacheValue(
                {
                    productId:
                        "product-1"
                },
                {
                    maxValueBytes:
                        1000
                }
            ),
            true
        );
    }
);

test(
    "assertSerializableCacheValue rejects circular values",
    function () {
        const value = {};

        value.self =
            value;

        assert.throws(
            function () {
                assertSerializableCacheValue(
                    value,
                    {
                        maxValueBytes:
                            1000
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
    "assertSerializableCacheValue rejects oversized values",
    function () {
        assert.throws(
            function () {
                assertSerializableCacheValue(
                    {
                        value:
                            "x".repeat(100)
                    },
                    {
                        maxValueBytes:
                            10
                    }
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "resource-exhausted"
                );

                assert.equal(
                    error.status,
                    413
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   SET
========================================================== */

test(
    "setCachedValue stores a cache record",
    async function () {
        const firestore =
            createFirestoreStub();

        const runtime =
            createRuntime({
                firestore:
                    firestore
            });

        const result =
            await setCachedValue(
                runtime,
                "product-1",
                {
                    name:
                        "Silk Evening Dress"
                },
                {
                    namespace:
                        "products",

                    ttlMs:
                        5000,

                    staleTtlMs:
                        2000,

                    now:
                        function () {
                            return 1000;
                        },

                    metadata: {
                        source:
                            "catalog"
                    }
                }
            );

        assert.equal(
            result.status,
            "hit"
        );

        assert.equal(
            result.hit,
            true
        );

        assert.equal(
            result.stale,
            false
        );

        assert.deepEqual(
            result.value,
            {
                name:
                    "Silk Evening Dress"
            }
        );

        assert.equal(
            result.expiresAt,
            new Date(
                6000
            ).toISOString()
        );

        assert.equal(
            result.staleUntil,
            new Date(
                8000
            ).toISOString()
        );

        const stored =
            firestore.getDocument(
                getCachePath(
                    "product-1",
                    "products"
                )
            );

        assert.equal(
            stored.key,
            "product-1"
        );

        assert.equal(
            stored.namespace,
            "products"
        );

        assert.equal(
            stored.expiresAt.toMillis(),
            6000
        );

        assert.equal(
            stored.staleUntil.toMillis(),
            8000
        );

        assert.deepEqual(
            stored.metadata,
            {
                source:
                    "catalog"
            }
        );
    }
);

test(
    "setCachedValue bypasses datastore when disabled",
    async function () {
        const result =
            await setCachedValue(
                null,
                "product-1",
                {
                    available:
                        true
                },
                {
                    disabled:
                        true
                }
            );

        assert.equal(
            result.status,
            "disabled"
        );

        assert.equal(
            result.disabled,
            true
        );

        assert.deepEqual(
            result.value,
            {
                available:
                    true
            }
        );
    }
);

/* ==========================================================
   GET
========================================================== */

test(
    "getCachedValue returns cache miss for absent record",
    async function () {
        const result =
            await getCachedValue(
                createRuntime(),
                "missing-product",
                {
                    namespace:
                        "products",

                    now:
                        function () {
                            return 1000;
                        }
                }
            );

        assert.equal(
            result.status,
            "miss"
        );

        assert.equal(
            result.hit,
            false
        );

        assert.equal(
            result.value,
            undefined
        );
    }
);

test(
    "getCachedValue returns fresh cache hit",
    async function () {
        const runtime =
            createRuntime();

        await setCachedValue(
            runtime,
            "product-1",
            {
                price:
                    250000
            },
            {
                namespace:
                    "products",

                ttlMs:
                    5000,

                now:
                    function () {
                        return 1000;
                    }
            }
        );

        const result =
            await getCachedValue(
                runtime,
                "product-1",
                {
                    namespace:
                        "products",

                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            result.status,
            "hit"
        );

        assert.equal(
            result.hit,
            true
        );

        assert.equal(
            result.stale,
            false
        );

        assert.deepEqual(
            result.value,
            {
                price:
                    250000
            }
        );
    }
);

test(
    "getCachedValue returns stale value when allowed",
    async function () {
        const runtime =
            createRuntime();

        await setCachedValue(
            runtime,
            "product-1",
            {
                available:
                    true
            },
            {
                namespace:
                    "products",

                ttlMs:
                    1000,

                staleTtlMs:
                    5000,

                now:
                    function () {
                        return 1000;
                    }
            }
        );

        const result =
            await getCachedValue(
                runtime,
                "product-1",
                {
                    namespace:
                        "products",

                    allowStale:
                        true,

                    now:
                        function () {
                            return 3000;
                        }
                }
            );

        assert.equal(
            result.status,
            "stale"
        );

        assert.equal(
            result.hit,
            true
        );

        assert.equal(
            result.stale,
            true
        );

        assert.deepEqual(
            result.value,
            {
                available:
                    true
            }
        );
    }
);

test(
    "getCachedValue treats stale record as miss when stale is disabled",
    async function () {
        const runtime =
            createRuntime();

        await setCachedValue(
            runtime,
            "product-1",
            {
                available:
                    true
            },
            {
                namespace:
                    "products",

                ttlMs:
                    1000,

                staleTtlMs:
                    5000,

                now:
                    function () {
                        return 1000;
                    }
            }
        );

        const result =
            await getCachedValue(
                runtime,
                "product-1",
                {
                    namespace:
                        "products",

                    allowStale:
                        false,

                    deleteExpired:
                        false,

                    now:
                        function () {
                            return 3000;
                        }
                }
            );

        assert.equal(
            result.status,
            "miss"
        );

        assert.equal(
            result.hit,
            false
        );

        assert.equal(
            result.expired,
            true
        );
    }
);

test(
    "getCachedValue deletes fully expired records",
    async function () {
        const firestore =
            createFirestoreStub();

        const runtime =
            createRuntime({
                firestore:
                    firestore
            });

        await setCachedValue(
            runtime,
            "product-1",
            {
                available:
                    true
            },
            {
                namespace:
                    "products",

                ttlMs:
                    1000,

                staleTtlMs:
                    1000,

                now:
                    function () {
                        return 1000;
                    }
            }
        );

        const path =
            getCachePath(
                "product-1",
                "products"
            );

        assert.equal(
            firestore.hasDocument(
                path
            ),
            true
        );

        const result =
            await getCachedValue(
                runtime,
                "product-1",
                {
                    namespace:
                        "products",

                    allowStale:
                        true,

                    deleteExpired:
                        true,

                    now:
                        function () {
                            return 4000;
                        }
                }
            );

        assert.equal(
            result.status,
            "miss"
        );

        assert.equal(
            result.expired,
            true
        );

        assert.equal(
            firestore.hasDocument(
                path
            ),
            false
        );
    }
);

test(
    "getCachedValue bypasses datastore when disabled",
    async function () {
        const result =
            await getCachedValue(
                null,
                "product-1",
                {
                    disabled:
                        true
                }
            );

        assert.equal(
            result.status,
            "disabled"
        );

        assert.equal(
            result.hit,
            false
        );
    }
);

/* ==========================================================
   DELETE
========================================================== */

test(
    "deleteCachedValue removes a cache record",
    async function () {
        const firestore =
            createFirestoreStub();

        const runtime =
            createRuntime({
                firestore:
                    firestore
            });

        await setCachedValue(
            runtime,
            "product-1",
            {
                available:
                    true
            },
            {
                namespace:
                    "products",

                now:
                    function () {
                        return 1000;
                    }
            }
        );

        const path =
            getCachePath(
                "product-1",
                "products"
            );

        assert.equal(
            firestore.hasDocument(
                path
            ),
            true
        );

        const result =
            await deleteCachedValue(
                runtime,
                "product-1",
                {
                    namespace:
                        "products"
                }
            );

        assert.equal(
            result.deleted,
            true
        );

        assert.equal(
            result.disabled,
            false
        );

        assert.equal(
            firestore.hasDocument(
                path
            ),
            false
        );
    }
);

test(
    "deleteCachedValue is a no-op when disabled",
    async function () {
        const result =
            await deleteCachedValue(
                null,
                "product-1",
                {
                    disabled:
                        true,

                    namespace:
                        "products"
                }
            );

        assert.deepEqual(
            result,
            {
                deleted:
                    false,

                disabled:
                    true,

                key:
                    "product-1",

                namespace:
                    "products"
            }
        );
    }
);

/* ==========================================================
   INSPECTION
========================================================== */

test(
    "inspectCachedValue returns stored record",
    async function () {
        const runtime =
            createRuntime();

        await setCachedValue(
            runtime,
            "product-1",
            {
                name:
                    "Silk Dress"
            },
            {
                namespace:
                    "products",

                ttlMs:
                    5000,

                now:
                    function () {
                        return 1000;
                    }
            }
        );

        const record =
            await inspectCachedValue(
                runtime,
                "product-1",
                {
                    namespace:
                        "products"
                }
            );

        assert.equal(
            record.key,
            "product-1"
        );

        assert.equal(
            record.namespace,
            "products"
        );

        assert.deepEqual(
            record.value,
            {
                name:
                    "Silk Dress"
            }
        );

        assert.equal(
            record.expiresAt,
            new Date(
                6000
            ).toISOString()
        );
    }
);

test(
    "inspectCachedValue returns null for missing record",
    async function () {
        const record =
            await inspectCachedValue(
                createRuntime(),
                "missing",
                {
                    namespace:
                        "products"
                }
            );

        assert.equal(
            record,
            null
        );
    }
);

test(
    "inspectCachedValue returns null when disabled",
    async function () {
        assert.equal(
            await inspectCachedValue(
                null,
                "product-1",
                {
                    disabled:
                        true
                }
            ),
            null
        );
    }
);

/* ==========================================================
   READ-THROUGH CACHE
========================================================== */

test(
    "rememberCachedValue loads and stores a cache miss",
    async function () {
        const runtime =
            createRuntime();

        let calls =
            0;

        const result =
            await rememberCachedValue(
                runtime,
                "product-1",
                async function (
                    context
                ) {
                    calls +=
                        1;

                    assert.equal(
                        context.key,
                        "product-1"
                    );

                    assert.equal(
                        context.namespace,
                        "products"
                    );

                    return {
                        name:
                            "Silk Dress"
                    };
                },
                {
                    namespace:
                        "products",

                    ttlMs:
                        5000,

                    now:
                        function () {
                            return 1000;
                        }
                }
            );

        assert.equal(
            calls,
            1
        );

        assert.equal(
            result.hit,
            true
        );

        assert.deepEqual(
            result.value,
            {
                name:
                    "Silk Dress"
            }
        );
    }
);

test(
    "rememberCachedValue reuses a fresh cached value",
    async function () {
        const runtime =
            createRuntime();

        await setCachedValue(
            runtime,
            "product-1",
            {
                price:
                    250000
            },
            {
                namespace:
                    "products",

                ttlMs:
                    5000,

                now:
                    function () {
                        return 1000;
                    }
            }
        );

        let calls =
            0;

        const result =
            await rememberCachedValue(
                runtime,
                "product-1",
                async function () {
                    calls +=
                        1;

                    return {
                        price:
                            300000
                    };
                },
                {
                    namespace:
                        "products",

                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            calls,
            0
        );

        assert.deepEqual(
            result.value,
            {
                price:
                    250000
            }
        );
    }
);

test(
    "rememberCachedValue can return stale value without refreshing",
    async function () {
        const runtime =
            createRuntime();

        await setCachedValue(
            runtime,
            "product-1",
            {
                stock:
                    5
            },
            {
                namespace:
                    "products",

                ttlMs:
                    1000,

                staleTtlMs:
                    5000,

                now:
                    function () {
                        return 1000;
                    }
            }
        );

        let calls =
            0;

        const result =
            await rememberCachedValue(
                runtime,
                "product-1",
                async function () {
                    calls +=
                        1;

                    return {
                        stock:
                            4
                    };
                },
                {
                    namespace:
                        "products",

                    allowStale:
                        true,

                    refreshStale:
                        false,

                    now:
                        function () {
                            return 3000;
                        }
                }
            );

        assert.equal(
            calls,
            0
        );

        assert.equal(
            result.stale,
            true
        );

        assert.deepEqual(
            result.value,
            {
                stock:
                    5
            }
        );
    }
);

test(
    "rememberCachedValue refreshes stale value",
    async function () {
        const runtime =
            createRuntime();

        await setCachedValue(
            runtime,
            "product-1",
            {
                stock:
                    5
            },
            {
                namespace:
                    "products",

                ttlMs:
                    1000,

                staleTtlMs:
                    5000,

                now:
                    function () {
                        return 1000;
                    }
            }
        );

        let calls =
            0;

        const result =
            await rememberCachedValue(
                runtime,
                "product-1",
                async function (
                    context
                ) {
                    calls +=
                        1;

                    assert.equal(
                        context.stale,
                        true
                    );

                    assert.deepEqual(
                        context.staleValue,
                        {
                            stock:
                                5
                        }
                    );

                    return {
                        stock:
                            4
                    };
                },
                {
                    namespace:
                        "products",

                    allowStale:
                        true,

                    refreshStale:
                        true,

                    ttlMs:
                        1000,

                    staleTtlMs:
                        5000,

                    now:
                        function () {
                            return 3000;
                        }
                }
            );

        assert.equal(
            calls,
            1
        );

        assert.equal(
            result.stale,
            false
        );

        assert.deepEqual(
            result.value,
            {
                stock:
                    4
            }
        );
    }
);

test(
    "rememberCachedValue returns stale value when loader fails",
    async function () {
        const logger =
            createLoggerStub();

        const runtime =
            createRuntime({
                logger:
                    logger
            });

        await setCachedValue(
            runtime,
            "product-1",
            {
                stock:
                    5
            },
            {
                namespace:
                    "products",

                ttlMs:
                    1000,

                staleTtlMs:
                    5000,

                now:
                    function () {
                        return 1000;
                    }
            }
        );

        const loaderError =
            new Error(
                "Catalog unavailable."
            );

        loaderError.code =
            "provider-error";

        const result =
            await rememberCachedValue(
                runtime,
                "product-1",
                async function () {
                    throw loaderError;
                },
                {
                    namespace:
                        "products",

                    allowStale:
                        true,

                    refreshStale:
                        true,

                    useStaleOnError:
                        true,

                    now:
                        function () {
                            return 3000;
                        }
                }
            );

        assert.equal(
            result.fallback,
            true
        );

        assert.equal(
            result.stale,
            true
        );

        assert.equal(
            result.loaderError.code,
            "provider-error"
        );

        assert.deepEqual(
            result.value,
            {
                stock:
                    5
            }
        );

        assert.equal(
            logger.entries.some(
                function (entry) {
                    return (
                        entry.level ===
                            "warn" &&
                        entry.message ===
                            "Cache loader failed; stale value returned."
                    );
                }
            ),
            true
        );
    }
);

test(
    "rememberCachedValue rethrows loader failures without stale fallback",
    async function () {
        const expected =
            new Error(
                "Catalog unavailable."
            );

        await assert.rejects(
            async function () {
                await rememberCachedValue(
                    createRuntime(),
                    "product-1",
                    async function () {
                        throw expected;
                    },
                    {
                        namespace:
                            "products",

                        useStaleOnError:
                            false,

                        now:
                            function () {
                                return 1000;
                            }
                    }
                );
            },
            expected
        );
    }
);

test(
    "rememberCachedValue bypasses cache when disabled",
    async function () {
        let calls =
            0;

        const result =
            await rememberCachedValue(
                null,
                "product-1",
                async function (
                    context
                ) {
                    calls +=
                        1;

                    assert.equal(
                        context.key,
                        "product-1"
                    );

                    return {
                        available:
                            true
                    };
                },
                {
                    namespace:
                        "products",

                    disabled:
                        true
                }
            );

        assert.equal(
            calls,
            1
        );

        assert.equal(
            result.status,
            "disabled"
        );

        assert.equal(
            result.disabled,
            true
        );

        assert.deepEqual(
            result.value,
            {
                available:
                    true
            }
        );
    }
);

test(
    "rememberCachedValue requires a loader function",
    async function () {
        await assert.rejects(
            async function () {
                await rememberCachedValue(
                    createRuntime(),
                    "product-1",
                    null,
                    {}
                );
            },
            /must be a function/
        );
    }
);

/* ==========================================================
   RESULT AND RECORD HELPERS
========================================================== */

test(
    "createCacheResult creates normalized result",
    function () {
        const descriptor =
            createCacheDescriptor(
                "product-1",
                "products"
            );

        const result =
            createCacheResult(
                descriptor,
                {
                    status:
                        "hit",

                    hit:
                        true,

                    stale:
                        false,

                    value: {
                        price:
                            250000
                    },

                    expiresAt:
                        TestTimestamp
                            .fromMillis(
                                5000
                            )
                }
            );

        assert.equal(
            result.status,
            "hit"
        );

        assert.equal(
            result.hit,
            true
        );

        assert.equal(
            result.key,
            "product-1"
        );

        assert.equal(
            result.namespace,
            "products"
        );

        assert.equal(
            result.expiresAt,
            new Date(
                5000
            ).toISOString()
        );
    }
);

test(
    "sanitizeCacheRecord returns safe timestamp values",
    function () {
        const record =
            sanitizeCacheRecord({
                key:
                    "product-1",

                keyHash:
                    "hash",

                namespace:
                    "products",

                compositeKey:
                    "products:product-1",

                value: {
                    available:
                        true
                },

                metadata: {
                    source:
                        "catalog"
                },

                createdAt:
                    TestTimestamp
                        .fromMillis(
                            1000
                        ),

                updatedAt:
                    TestTimestamp
                        .fromMillis(
                            2000
                        ),

                expiresAt:
                    TestTimestamp
                        .fromMillis(
                            5000
                        ),

                staleUntil:
                    TestTimestamp
                        .fromMillis(
                            7000
                        )
            });

        assert.equal(
            record.createdAt,
            new Date(
                1000
            ).toISOString()
        );

        assert.equal(
            record.updatedAt,
            new Date(
                2000
            ).toISOString()
        );

        assert.equal(
            record.expiresAt,
            new Date(
                5000
            ).toISOString()
        );

        assert.equal(
            record.staleUntil,
            new Date(
                7000
            ).toISOString()
        );
    }
);

/* ==========================================================
   RUNTIME AND TIME HELPERS
========================================================== */

test(
    "assertCacheRuntime accepts valid runtime",
    function () {
        assert.doesNotThrow(
            function () {
                assertCacheRuntime(
                    createRuntime()
                );
            }
        );
    }
);

test(
    "assertCacheRuntime rejects unavailable datastore",
    function () {
        assert.throws(
            function () {
                assertCacheRuntime(
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
                1234
            );

        assert.equal(
            timestamp instanceof
                TestTimestamp,
            true
        );

        assert.equal(
            timestamp.toMillis(),
            1234
        );
    }
);

test(
    "createDatabaseTimestamp falls back to Date",
    function () {
        const timestamp =
            createDatabaseTimestamp(
                {},
                1234
            );

        assert.equal(
            timestamp instanceof Date,
            true
        );

        assert.equal(
            timestamp.getTime(),
            1234
        );
    }
);

test(
    "toMilliseconds supports common timestamp forms",
    function () {
        assert.equal(
            toMilliseconds(
                new Date(1000)
            ),
            1000
        );

        assert.equal(
            toMilliseconds(
                TestTimestamp
                    .fromMillis(
                        2000
                    )
            ),
            2000
        );

        assert.equal(
            toMilliseconds(
                "1970-01-01T00:00:03.000Z"
            ),
            3000
        );

        assert.equal(
            toMilliseconds(
                4000
            ),
            4000
        );

        assert.equal(
            toMilliseconds(
                null
            ),
            0
        );
    }
);

/* ==========================================================
   DATA HELPERS
========================================================== */

test(
    "sanitizeMetadata preserves objects and wraps primitives",
    function () {
        assert.deepEqual(
            sanitizeMetadata({
                source:
                    "catalog"
            }),
            {
                source:
                    "catalog"
            }
        );

        assert.deepEqual(
            sanitizeMetadata(
                "catalog"
            ),
            {
                value:
                    "catalog"
            }
        );

        assert.deepEqual(
            sanitizeMetadata(
                null
            ),
            {}
        );
    }
);

test(
    "serializeTimestamp returns ISO timestamps",
    function () {
        assert.equal(
            serializeTimestamp(
                TestTimestamp
                    .fromMillis(
                        1000
                    )
            ),
            new Date(
                1000
            ).toISOString()
        );

        assert.equal(
            serializeTimestamp(
                null
            ),
            null
        );
    }
);

test(
    "serializeCacheError creates safe error metadata",
    function () {
        const error =
            new ServiceError(
                "provider-error",
                "Catalog unavailable.",
                {
                    status:
                        503,

                    retryable:
                        true
                }
            );

        assert.deepEqual(
            serializeCacheError(
                error
            ),
            {
                name:
                    "ServiceError",

                code:
                    "provider-error",

                message:
                    "Catalog unavailable.",

                status:
                    503,

                retryable:
                    true
            }
        );
    }
);

/* ==========================================================
   LOGGING
========================================================== */

test(
    "logCacheEvent logs cache hits",
    function () {
        const logger =
            createLoggerStub();

        logCacheEvent(
            {
                logger:
                    logger
            },
            {
                operation:
                    "get",

                status:
                    "hit",

                namespace:
                    "products",

                hit:
                    true,

                stale:
                    false,

                key:
                    "product-1"
            },
            {
                log:
                    true,

                exposeKey:
                    true
            }
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
            "Cache event."
        );

        assert.equal(
            logger.entries[0]
                .metadata
                .key,
            "product-1"
        );
    }
);

test(
    "logCacheEvent logs cache misses",
    function () {
        const logger =
            createLoggerStub();

        logCacheEvent(
            {
                logger:
                    logger
            },
            {
                status:
                    "miss",

                namespace:
                    "products",

                hit:
                    false,

                stale:
                    false
            },
            {
                log:
                    true
            }
        );

        assert.equal(
            logger.entries[0].message,
            "Cache miss."
        );
    }
);

test(
    "logCacheEvent can be disabled",
    function () {
        const logger =
            createLoggerStub();

        logCacheEvent(
            {
                logger:
                    logger
            },
            {
                status:
                    "hit"
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

test(
    "logCacheLoadFailure logs stale fallback",
    function () {
        const logger =
            createLoggerStub();

        logCacheLoadFailure(
            {
                logger:
                    logger
            },
            new Error(
                "Catalog failed."
            ),
            {
                namespace:
                    "products",

                status:
                    "stale",

                key:
                    "product-1"
            },
            {
                log:
                    true,

                exposeKey:
                    true
            }
        );

        assert.equal(
            logger.entries.length,
            1
        );

        assert.equal(
            logger.entries[0].level,
            "warn"
        );

        assert.equal(
            logger.entries[0].message,
            "Cache loader failed; stale value returned."
        );

        assert.equal(
            logger.entries[0]
                .metadata
                .key,
            "product-1"
        );
    }
);

/* ==========================================================
   CONSTANTS
========================================================== */

test(
    "cache constants expose expected defaults",
    function () {
        assert.equal(
            constants.CACHE_COLLECTION,
            "_cache"
        );

        assert.equal(
            constants.DEFAULT_NAMESPACE,
            "global"
        );

        assert.equal(
            constants.DEFAULT_TTL_MS,
            300000
        );

        assert.equal(
            constants.DEFAULT_STALE_TTL_MS,
            0
        );

        assert.equal(
            constants.DEFAULT_MAX_VALUE_BYTES,
            500000
        );

        assert.equal(
            constants.DEFAULT_MAX_KEY_LENGTH,
            500
        );

        assert.deepEqual(
            constants.CACHE_STATUSES,
            {
                hit:
                    "hit",

                miss:
                    "miss",

                stale:
                    "stale",

                disabled:
                    "disabled"
            }
        );
    }
);