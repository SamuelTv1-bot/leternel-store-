"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   LOCK SERVICE TEST SUITE
========================================================== */

const test =
    require("node:test");

const assert =
    require("node:assert/strict");

const {
    createLockService,
    acquireLock,
    tryAcquireLock,
    createLockRecord,
    renewLock,
    releaseLock,
    executeWithLock,
    inspectLock,
    queryLocks,
    normalizeLockQuery,
    createLockDescriptor,
    hashLockKey,
    createLockResult,
    sanitizeLockRecord,
    assertLockOwnership,
    isLockExpired,
    calculateRemainingLease,
    normalizeLockKey,
    normalizeNamespace,
    normalizeOwnerId,
    normalizeLockToken,
    normalizeLockDate,
    normalizeLockOrderField,
    normalizeQueryLimit,
    normalizePositiveInteger,
    normalizeNonNegativeInteger,
    normalizeOptionalString,
    normalizeCollection,
    normalizeLockOptions,
    stableStringify,
    normalizeStableValue,
    sanitizeLockMetadata,
    createLockNotFoundError,
    createLockUnavailableError,
    assertLockRuntime,
    resolveNow,
    createDatabaseTimestamp,
    toMilliseconds,
    serializeTimestamp,
    delay,
    generateLockToken,
    logLockEvent,
    logLockReleaseFailure,
    constants
} = require(
    "../src/shared/lock-service"
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

function clone(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    if (
        value instanceof TestTimestamp
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

function getNestedValue(
    object,
    path
) {
    return String(path)
        .split(".")
        .reduce(
            function (
                current,
                segment
            ) {
                if (
                    current === null ||
                    current === undefined
                ) {
                    return undefined;
                }

                return current[
                    segment
                ];
            },
            object
        );
}

function normalizeComparableValue(
    value
) {
    if (
        value &&
        typeof value.toMillis ===
            "function"
    ) {
        return value.toMillis();
    }

    return value;
}

function compareValues(
    left,
    operator,
    right
) {
    const normalizedLeft =
        normalizeComparableValue(
            left
        );

    const normalizedRight =
        normalizeComparableValue(
            right
        );

    switch (operator) {
        case "==":
            return (
                normalizedLeft ===
                normalizedRight
            );

        case ">=":
            return (
                normalizedLeft >=
                normalizedRight
            );

        case "<=":
            return (
                normalizedLeft <=
                normalizedRight
            );

        default:
            throw new Error(
                "Unsupported query operator: " +
                operator
            );
    }
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

            id:
                path
                    .split("/")
                    .pop(),

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

    function createQuery(
        collectionName,
        state
    ) {
        const queryState =
            state || {
                filters:
                    [],

                order:
                    null,

                limit:
                    null
            };

        return {
            where:
                function (
                    field,
                    operator,
                    value
                ) {
                    return createQuery(
                        collectionName,
                        {
                            filters:
                                queryState
                                    .filters
                                    .concat([
                                        {
                                            field:
                                                field,

                                            operator:
                                                operator,

                                            value:
                                                value
                                        }
                                    ]),

                            order:
                                queryState.order,

                            limit:
                                queryState.limit
                        }
                    );
                },

            orderBy:
                function (
                    field,
                    direction
                ) {
                    return createQuery(
                        collectionName,
                        {
                            filters:
                                queryState.filters,

                            order: {
                                field:
                                    field,

                                direction:
                                    direction
                            },

                            limit:
                                queryState.limit
                        }
                    );
                },

            limit:
                function (count) {
                    return createQuery(
                        collectionName,
                        {
                            filters:
                                queryState.filters,

                            order:
                                queryState.order,

                            limit:
                                count
                        }
                    );
                },

            get:
                async function () {
                    let results =
                        Array.from(
                            documents.entries()
                        )
                            .filter(
                                function ([
                                    path
                                ]) {
                                    return path.startsWith(
                                        collectionName +
                                        "/"
                                    );
                                }
                            )
                            .map(
                                function ([
                                    path,
                                    value
                                ]) {
                                    return {
                                        path:
                                            path,

                                        value:
                                            clone(value)
                                    };
                                }
                            );

                    queryState.filters
                        .forEach(
                            function (
                                filter
                            ) {
                                results =
                                    results.filter(
                                        function (
                                            entry
                                        ) {
                                            return compareValues(
                                                getNestedValue(
                                                    entry.value,
                                                    filter.field
                                                ),
                                                filter.operator,
                                                filter.value
                                            );
                                        }
                                    );
                            }
                        );

                    if (
                        queryState.order
                    ) {
                        results.sort(
                            function (
                                first,
                                second
                            ) {
                                const left =
                                    normalizeComparableValue(
                                        getNestedValue(
                                            first.value,
                                            queryState
                                                .order
                                                .field
                                        )
                                    );

                                const right =
                                    normalizeComparableValue(
                                        getNestedValue(
                                            second.value,
                                            queryState
                                                .order
                                                .field
                                        )
                                    );

                                const multiplier =
                                    queryState
                                        .order
                                        .direction ===
                                    "desc"
                                        ? -1
                                        : 1;

                                if (
                                    left < right
                                ) {
                                    return -1 *
                                        multiplier;
                                }

                                if (
                                    left > right
                                ) {
                                    return 1 *
                                        multiplier;
                                }

                                return 0;
                            }
                        );
                    }

                    if (
                        Number.isInteger(
                            queryState.limit
                        )
                    ) {
                        results =
                            results.slice(
                                0,
                                queryState.limit
                            );
                    }

                    return {
                        docs:
                            results.map(
                                function (
                                    entry
                                ) {
                                    return {
                                        id:
                                            entry.path
                                                .split("/")
                                                .pop(),

                                        data:
                                            function () {
                                                return clone(
                                                    entry.value
                                                );
                                            }
                                    };
                                }
                            )
                    };
                }
        };
    }

    const db = {
        collection:
            function (
                collectionName
            ) {
                return Object.assign(
                    {},
                    createQuery(
                        collectionName
                    ),
                    {
                        doc:
                            function (
                                documentId
                            ) {
                                return createReference(
                                    collectionName,
                                    documentId
                                );
                            }
                    }
                );
            },

        runTransaction:
            async function (
                callback
            ) {
                const writes =
                    [];

                const deletes =
                    [];

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
                                reference:
                                    reference,

                                value:
                                    clone(value),

                                options:
                                    options
                            });
                        },

                    delete:
                        function (
                            reference
                        ) {
                            deletes.push(
                                reference
                            );
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
                    await write.reference.set(
                        write.value,
                        write.options
                    );
                }

                for (
                    const reference of
                    deletes
                ) {
                    await reference.delete();
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
    const entries =
        [];

    return {
        entries:
            entries,

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

function lockPath(
    key,
    namespace
) {
    const descriptor =
        createLockDescriptor(
            key,
            namespace
        );

    return (
        constants
            .LOCK_COLLECTION +
        "/" +
        descriptor.documentId
    );
}

function createStoredLock(
    overrides
) {
    return Object.assign(
        {
            key:
                "order:order-1",

            namespace:
                "orders",

            compositeKey:
                "orders:order:order-1",

            keyHash:
                hashLockKey(
                    "orders:order:order-1"
                ),

            ownerId:
                "worker-1",

            token:
                "token-1",

            metadata:
                {},

            acquisitionCount:
                1,

            takeoverCount:
                0,

            createdAt:
                TestTimestamp.fromMillis(
                    1000
                ),

            acquiredAt:
                TestTimestamp.fromMillis(
                    1000
                ),

            renewedAt:
                null,

            updatedAt:
                TestTimestamp.fromMillis(
                    1000
                ),

            expiresAt:
                TestTimestamp.fromMillis(
                    5000
                ),

            schemaVersion:
                1
        },
        overrides || {}
    );
}

/* ==========================================================
   SERVICE FACTORY
========================================================== */

test(
    "createLockService creates a frozen service",
    function () {
        const runtime =
            createRuntime();

        const service =
            createLockService({
                runtime:
                    runtime,

                namespace:
                    "orders",

                leaseMs:
                    5000
            });

        assert.equal(
            service.runtime,
            runtime
        );

        assert.equal(
            service.options.namespace,
            "orders"
        );

        assert.equal(
            service.options.leaseMs,
            5000
        );

        assert.equal(
            typeof service.acquire,
            "function"
        );

        assert.equal(
            typeof service.renew,
            "function"
        );

        assert.equal(
            typeof service.release,
            "function"
        );

        assert.equal(
            typeof service.inspect,
            "function"
        );

        assert.equal(
            typeof service.query,
            "function"
        );

        assert.equal(
            typeof service.withLock,
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
   OPTIONS
========================================================== */

test(
    "normalizeLockOptions applies defaults",
    function () {
        const options =
            normalizeLockOptions(
                {}
            );

        assert.equal(
            options.collection,
            constants.LOCK_COLLECTION
        );

        assert.equal(
            options.namespace,
            constants.DEFAULT_NAMESPACE
        );

        assert.equal(
            options.leaseMs,
            constants.DEFAULT_LEASE_MS
        );

        assert.equal(
            options.acquireTimeoutMs,
            constants.DEFAULT_ACQUIRE_TIMEOUT_MS
        );

        assert.equal(
            options.retryIntervalMs,
            constants.DEFAULT_RETRY_INTERVAL_MS
        );

        assert.equal(
            options.queryLimit,
            constants.DEFAULT_QUERY_LIMIT
        );

        assert.equal(
            options.maxKeyLength,
            constants.DEFAULT_MAX_KEY_LENGTH
        );

        assert.deepEqual(
            options.metadata,
            {}
        );

        assert.equal(
            options.replaceMetadata,
            false
        );

        assert.equal(
            options.disabled,
            false
        );

        assert.equal(
            options.throwIfUnavailable,
            true
        );

        assert.equal(
            options.releaseAfterOperation,
            true
        );

        assert.equal(
            options.ignoreMissing,
            false
        );

        assert.equal(
            options.allowExpiredRelease,
            false
        );

        assert.equal(
            options.log,
            true
        );
    }
);

test(
    "normalizeLockOptions respects overrides",
    function () {
        const sleep =
            async function () {};

        const options =
            normalizeLockOptions({
                collection:
                    "locks",

                namespace:
                    "payments",

                leaseMs:
                    10000,

                acquireTimeoutMs:
                    2000,

                retryIntervalMs:
                    250,

                queryLimit:
                    25,

                maxKeyLength:
                    100,

                metadata: {
                    source:
                        "checkout"
                },

                replaceMetadata:
                    true,

                disabled:
                    true,

                throwIfUnavailable:
                    false,

                releaseAfterOperation:
                    false,

                ignoreMissing:
                    true,

                allowExpiredRelease:
                    true,

                log:
                    false,

                sleep:
                    sleep
            });

        assert.equal(
            options.collection,
            "locks"
        );

        assert.equal(
            options.namespace,
            "payments"
        );

        assert.equal(
            options.leaseMs,
            10000
        );

        assert.equal(
            options.acquireTimeoutMs,
            2000
        );

        assert.equal(
            options.retryIntervalMs,
            250
        );

        assert.equal(
            options.queryLimit,
            25
        );

        assert.equal(
            options.maxKeyLength,
            100
        );

        assert.deepEqual(
            options.metadata,
            {
                source:
                    "checkout"
            }
        );

        assert.equal(
            options.replaceMetadata,
            true
        );

        assert.equal(
            options.disabled,
            true
        );

        assert.equal(
            options.throwIfUnavailable,
            false
        );

        assert.equal(
            options.releaseAfterOperation,
            false
        );

        assert.equal(
            options.ignoreMissing,
            true
        );

        assert.equal(
            options.allowExpiredRelease,
            true
        );

        assert.equal(
            options.log,
            false
        );

        assert.equal(
            options.sleep,
            sleep
        );
    }
);

/* ==========================================================
   NORMALIZERS
========================================================== */

test(
    "lock normalizers validate values",
    function () {
        assert.equal(
            normalizeLockKey(
                " order:1 "
            ),
            "order:1"
        );

        assert.equal(
            normalizeNamespace(
                " Order Service "
            ),
            "order-service"
        );

        assert.equal(
            normalizeOwnerId(
                " worker-1 "
            ),
            "worker-1"
        );

        assert.equal(
            normalizeLockToken(
                " token-1 "
            ),
            "token-1"
        );

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

        assert.throws(
            function () {
                normalizeLockKey(
                    ""
                );
            },
            /lock key is invalid/
        );

        assert.throws(
            function () {
                normalizeOwnerId(
                    ""
                );
            },
            /owner ID is required/
        );

        assert.throws(
            function () {
                normalizeLockToken(
                    ""
                );
            },
            /lock token is required/
        );
    }
);

test(
    "normalizeLockKey supports deterministic object keys",
    function () {
        assert.equal(
            normalizeLockKey({
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
    "normalizeLockKey enforces maximum length",
    function () {
        assert.throws(
            function () {
                normalizeLockKey(
                    "x".repeat(11),
                    10
                );
            },
            /lock key is too long/
        );
    }
);

test(
    "integer and query normalizers validate values",
    function () {
        assert.equal(
            normalizePositiveInteger(
                "5",
                1,
                "Value"
            ),
            5
        );

        assert.equal(
            normalizeNonNegativeInteger(
                0,
                1,
                "Value"
            ),
            0
        );

        assert.equal(
            normalizeQueryLimit(
                undefined
            ),
            100
        );

        assert.equal(
            normalizeQueryLimit(
                1000
            ),
            500
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

        assert.throws(
            function () {
                normalizeQueryLimit(
                    0
                );
            },
            /positive integer/
        );
    }
);

test(
    "collection and date normalizers validate values",
    function () {
        assert.equal(
            normalizeCollection(
                "_locks"
            ),
            "_locks"
        );

        assert.equal(
            normalizeLockDate(
                1000,
                "Date"
            ),
            1000
        );

        assert.equal(
            normalizeLockOrderField(
                "acquiredAt"
            ),
            "acquiredAt"
        );

        assert.equal(
            normalizeLockOrderField(
                "invalid"
            ),
            "expiresAt"
        );

        assert.throws(
            function () {
                normalizeCollection(
                    "internal/locks"
                );
            },
            /Firestore collection name/
        );

        assert.throws(
            function () {
                normalizeLockDate(
                    "invalid",
                    "Date"
                );
            },
            /is invalid/
        );
    }
);

/* ==========================================================
   DESCRIPTORS
========================================================== */

test(
    "createLockDescriptor creates deterministic metadata",
    function () {
        const descriptor =
            createLockDescriptor(
                "order:order-1",
                "orders"
            );

        assert.equal(
            descriptor.key,
            "order:order-1"
        );

        assert.equal(
            descriptor.namespace,
            "orders"
        );

        assert.equal(
            descriptor.compositeKey,
            "orders:order:order-1"
        );

        assert.equal(
            descriptor.keyHash,
            hashLockKey(
                descriptor.compositeKey
            )
        );

        assert.equal(
            descriptor.documentId,
            descriptor.keyHash
        );
    }
);

test(
    "hashLockKey returns deterministic SHA-256 hashes",
    function () {
        const first =
            hashLockKey(
                "orders:order-1"
            );

        const second =
            hashLockKey(
                "orders:order-1"
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

/* ==========================================================
   SERIALIZATION
========================================================== */

test(
    "stableStringify sorts object keys",
    function () {
        assert.equal(
            stableStringify({
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
    "normalizeStableValue rejects circular values",
    function () {
        const value =
            {};

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
   RECORD CREATION
========================================================== */

test(
    "createLockRecord creates initial lock record",
    function () {
        const descriptor =
            createLockDescriptor(
                "order:order-1",
                "orders"
            );

        const record =
            createLockRecord(
                {
                    Timestamp:
                        TestTimestamp
                },
                descriptor,
                "worker-1",
                "token-1",
                null,
                1000,
                {
                    leaseMs:
                        5000,

                    metadata: {
                        orderId:
                            "order-1"
                    }
                }
            );

        assert.equal(
            record.key,
            "order:order-1"
        );

        assert.equal(
            record.ownerId,
            "worker-1"
        );

        assert.equal(
            record.token,
            "token-1"
        );

        assert.equal(
            record.acquisitionCount,
            1
        );

        assert.equal(
            record.takeoverCount,
            0
        );

        assert.equal(
            record.acquiredAt.toMillis(),
            1000
        );

        assert.equal(
            record.expiresAt.toMillis(),
            6000
        );
    }
);

test(
    "createLockRecord preserves creation and tracks takeover",
    function () {
        const descriptor =
            createLockDescriptor(
                "order:order-1",
                "orders"
            );

        const existing =
            createStoredLock({
                acquisitionCount:
                    2,

                takeoverCount:
                    1,

                createdAt:
                    TestTimestamp.fromMillis(
                        500
                    )
            });

        const record =
            createLockRecord(
                {
                    Timestamp:
                        TestTimestamp
                },
                descriptor,
                "worker-2",
                "token-2",
                existing,
                6000,
                {
                    leaseMs:
                        5000,

                    metadata:
                        {}
                }
            );

        assert.equal(
            record.acquisitionCount,
            3
        );

        assert.equal(
            record.takeoverCount,
            2
        );

        assert.equal(
            record.createdAt.toMillis(),
            500
        );

        assert.equal(
            record.ownerId,
            "worker-2"
        );
    }
);

/* ==========================================================
   ACQUIRE
========================================================== */

test(
    "tryAcquireLock stores an available lock",
    async function () {
        const firestore =
            createFirestoreStub();

        const runtime =
            createRuntime({
                firestore:
                    firestore
            });

        const descriptor =
            createLockDescriptor(
                "order:order-1",
                "orders"
            );

        const result =
            await tryAcquireLock(
                runtime,
                descriptor,
                "worker-1",
                {
                    namespace:
                        "orders",

                    leaseMs:
                        5000,

                    now:
                        function () {
                            return 1000;
                        }
                }
            );

        assert.equal(
            result.acquired,
            true
        );

        assert.equal(
            result.status,
            "acquired"
        );

        assert.equal(
            result.ownerId,
            "worker-1"
        );

        assert.equal(
            typeof result.token,
            "string"
        );

        assert.equal(
            result.expiresAt,
            new Date(
                6000
            ).toISOString()
        );

        assert.equal(
            firestore.hasDocument(
                lockPath(
                    "order:order-1",
                    "orders"
                )
            ),
            true
        );
    }
);

test(
    "tryAcquireLock returns unavailable for active lock",
    async function () {
        const path =
            lockPath(
                "order:order-1",
                "orders"
            );

        const firestore =
            createFirestoreStub({
                [path]:
                    createStoredLock()
            });

        const result =
            await tryAcquireLock(
                createRuntime({
                    firestore:
                        firestore
                }),
                createLockDescriptor(
                    "order:order-1",
                    "orders"
                ),
                "worker-2",
                {
                    namespace:
                        "orders",

                    leaseMs:
                        5000,

                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            result.acquired,
            false
        );

        assert.equal(
            result.status,
            "unavailable"
        );

        assert.equal(
            result.ownerId,
            "worker-1"
        );

        assert.equal(
            result.token,
            null
        );
    }
);

test(
    "tryAcquireLock takes over expired lock",
    async function () {
        const path =
            lockPath(
                "order:order-1",
                "orders"
            );

        const firestore =
            createFirestoreStub({
                [path]:
                    createStoredLock({
                        expiresAt:
                            TestTimestamp.fromMillis(
                                1000
                            )
                    })
            });

        const result =
            await tryAcquireLock(
                createRuntime({
                    firestore:
                        firestore
                }),
                createLockDescriptor(
                    "order:order-1",
                    "orders"
                ),
                "worker-2",
                {
                    namespace:
                        "orders",

                    leaseMs:
                        5000,

                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            result.acquired,
            true
        );

        assert.equal(
            result.ownerId,
            "worker-2"
        );

        assert.equal(
            result.takeoverCount,
            1
        );

        assert.equal(
            result.acquisitionCount,
            2
        );
    }
);

test(
    "acquireLock returns disabled acquisition",
    async function () {
        const result =
            await acquireLock(
                null,
                "order:order-1",
                "worker-1",
                {
                    namespace:
                        "orders",

                    disabled:
                        true,

                    leaseMs:
                        5000,

                    now:
                        function () {
                            return 1000;
                        }
                }
            );

        assert.equal(
            result.acquired,
            true
        );

        assert.equal(
            result.disabled,
            true
        );

        assert.equal(
            result.status,
            "disabled"
        );

        assert.equal(
            result.expiresAt,
            new Date(
                6000
            ).toISOString()
        );
    }
);

test(
    "acquireLock returns unavailable after one attempt",
    async function () {
        const path =
            lockPath(
                "order:order-1",
                "orders"
            );

        const firestore =
            createFirestoreStub({
                [path]:
                    createStoredLock()
            });

        const result =
            await acquireLock(
                createRuntime({
                    firestore:
                        firestore
                }),
                "order:order-1",
                "worker-2",
                {
                    namespace:
                        "orders",

                    acquireTimeoutMs:
                        0,

                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            result.acquired,
            false
        );

        assert.equal(
            result.attempts,
            1
        );
    }
);

test(
    "acquireLock retries until lock becomes available",
    async function () {
        const path =
            lockPath(
                "order:order-1",
                "orders"
            );

        const firestore =
            createFirestoreStub({
                [path]:
                    createStoredLock({
                        expiresAt:
                            TestTimestamp.fromMillis(
                                1500
                            )
                    })
            });

        let now =
            1000;

        const result =
            await acquireLock(
                createRuntime({
                    firestore:
                        firestore
                }),
                "order:order-1",
                "worker-2",
                {
                    namespace:
                        "orders",

                    acquireTimeoutMs:
                        1000,

                    retryIntervalMs:
                        500,

                    leaseMs:
                        5000,

                    now:
                        function () {
                            return now;
                        },

                    sleep:
                        async function (
                            milliseconds
                        ) {
                            now +=
                                milliseconds;
                        }
                }
            );

        assert.equal(
            result.acquired,
            true
        );

        assert.equal(
            result.attempts,
            2
        );

        assert.equal(
            result.ownerId,
            "worker-2"
        );
    }
);

/* ==========================================================
   EXPIRATION
========================================================== */

test(
    "isLockExpired identifies expired leases",
    function () {
        assert.equal(
            isLockExpired(
                createStoredLock({
                    expiresAt:
                        TestTimestamp.fromMillis(
                            1000
                        )
                }),
                1000
            ),
            true
        );

        assert.equal(
            isLockExpired(
                createStoredLock({
                    expiresAt:
                        TestTimestamp.fromMillis(
                            2000
                        )
                }),
                1000
            ),
            false
        );

        assert.equal(
            isLockExpired(
                null,
                1000
            ),
            true
        );
    }
);

test(
    "calculateRemainingLease returns safe duration",
    function () {
        assert.equal(
            calculateRemainingLease(
                createStoredLock({
                    expiresAt:
                        TestTimestamp.fromMillis(
                            5000
                        )
                }),
                2000
            ),
            3000
        );

        assert.equal(
            calculateRemainingLease(
                createStoredLock({
                    expiresAt:
                        TestTimestamp.fromMillis(
                            1000
                        )
                }),
                2000
            ),
            0
        );

        assert.equal(
            calculateRemainingLease(
                null,
                2000
            ),
            0
        );
    }
);

/* ==========================================================
   OWNERSHIP
========================================================== */

test(
    "assertLockOwnership accepts valid owner and token",
    function () {
        assert.equal(
            assertLockOwnership(
                createStoredLock(),
                "worker-1",
                "token-1",
                2000
            ),
            true
        );
    }
);

test(
    "assertLockOwnership rejects wrong owner",
    function () {
        assert.throws(
            function () {
                assertLockOwnership(
                    createStoredLock(),
                    "worker-2",
                    "token-1",
                    2000
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
    "assertLockOwnership rejects stale token",
    function () {
        assert.throws(
            function () {
                assertLockOwnership(
                    createStoredLock(),
                    "worker-1",
                    "token-2",
                    2000
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "aborted"
                );

                return true;
            }
        );
    }
);

test(
    "assertLockOwnership rejects expired lease",
    function () {
        assert.throws(
            function () {
                assertLockOwnership(
                    createStoredLock({
                        expiresAt:
                            TestTimestamp.fromMillis(
                                1000
                            )
                    }),
                    "worker-1",
                    "token-1",
                    2000
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "deadline-exceeded"
                );

                return true;
            }
        );
    }
);

test(
    "assertLockOwnership can allow expired lease",
    function () {
        assert.equal(
            assertLockOwnership(
                createStoredLock({
                    expiresAt:
                        TestTimestamp.fromMillis(
                            1000
                        )
                }),
                "worker-1",
                "token-1",
                2000,
                {
                    allowExpired:
                        true
                }
            ),
            true
        );
    }
);

/* ==========================================================
   RENEW
========================================================== */

test(
    "renewLock extends owned lease",
    async function () {
        const path =
            lockPath(
                "order:order-1",
                "orders"
            );

        const firestore =
            createFirestoreStub({
                [path]:
                    createStoredLock()
            });

        const result =
            await renewLock(
                createRuntime({
                    firestore:
                        firestore
                }),
                "order:order-1",
                "worker-1",
                "token-1",
                {
                    namespace:
                        "orders",

                    leaseMs:
                        5000,

                    now:
                        function () {
                            return 3000;
                        }
                }
            );

        assert.equal(
            result.acquired,
            true
        );

        assert.equal(
            result.renewed,
            true
        );

        assert.equal(
            result.status,
            "renewed"
        );

        assert.equal(
            result.renewedAt,
            new Date(
                3000
            ).toISOString()
        );

        assert.equal(
            result.expiresAt,
            new Date(
                8000
            ).toISOString()
        );
    }
);

test(
    "renewLock replaces metadata when configured",
    async function () {
        const path =
            lockPath(
                "order:order-1",
                "orders"
            );

        const firestore =
            createFirestoreStub({
                [path]:
                    createStoredLock({
                        metadata: {
                            old:
                                true
                        }
                    })
            });

        const result =
            await renewLock(
                createRuntime({
                    firestore:
                        firestore
                }),
                "order:order-1",
                "worker-1",
                "token-1",
                {
                    namespace:
                        "orders",

                    replaceMetadata:
                        true,

                    metadata: {
                        renewed:
                            true
                    },

                    now:
                        function () {
                            return 3000;
                        }
                }
            );

        assert.deepEqual(
            result.metadata,
            {
                renewed:
                    true
            }
        );
    }
);

test(
    "renewLock rejects missing lock",
    async function () {
        await assert.rejects(
            async function () {
                await renewLock(
                    createRuntime(),
                    "missing",
                    "worker-1",
                    "token-1",
                    {}
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "not-found"
                );

                return true;
            }
        );
    }
);

test(
    "renewLock returns disabled result",
    async function () {
        const result =
            await renewLock(
                null,
                "order:order-1",
                "worker-1",
                "token-1",
                {
                    namespace:
                        "orders",

                    disabled:
                        true,

                    leaseMs:
                        5000,

                    now:
                        function () {
                            return 1000;
                        }
                }
            );

        assert.equal(
            result.renewed,
            true
        );

        assert.equal(
            result.disabled,
            true
        );

        assert.equal(
            result.expiresAt,
            new Date(
                6000
            ).toISOString()
        );
    }
);

/* ==========================================================
   RELEASE
========================================================== */

test(
    "releaseLock deletes owned lock",
    async function () {
        const path =
            lockPath(
                "order:order-1",
                "orders"
            );

        const firestore =
            createFirestoreStub({
                [path]:
                    createStoredLock()
            });

        const result =
            await releaseLock(
                createRuntime({
                    firestore:
                        firestore
                }),
                "order:order-1",
                "worker-1",
                "token-1",
                {
                    namespace:
                        "orders",

                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            result.released,
            true
        );

        assert.equal(
            result.status,
            "released"
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
    "releaseLock can ignore missing lock",
    async function () {
        const result =
            await releaseLock(
                createRuntime(),
                "missing",
                "worker-1",
                "token-1",
                {
                    ignoreMissing:
                        true
                }
            );

        assert.equal(
            result.released,
            false
        );

        assert.equal(
            result.missing,
            true
        );
    }
);

test(
    "releaseLock rejects missing lock by default",
    async function () {
        await assert.rejects(
            async function () {
                await releaseLock(
                    createRuntime(),
                    "missing",
                    "worker-1",
                    "token-1",
                    {}
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "not-found"
                );

                return true;
            }
        );
    }
);

test(
    "releaseLock can release expired owned lock",
    async function () {
        const path =
            lockPath(
                "order:order-1",
                "orders"
            );

        const firestore =
            createFirestoreStub({
                [path]:
                    createStoredLock({
                        expiresAt:
                            TestTimestamp.fromMillis(
                                1000
                            )
                    })
            });

        const result =
            await releaseLock(
                createRuntime({
                    firestore:
                        firestore
                }),
                "order:order-1",
                "worker-1",
                "token-1",
                {
                    namespace:
                        "orders",

                    allowExpiredRelease:
                        true,

                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            result.released,
            true
        );
    }
);

test(
    "releaseLock returns disabled result",
    async function () {
        const result =
            await releaseLock(
                null,
                "order:order-1",
                "worker-1",
                "token-1",
                {
                    namespace:
                        "orders",

                    disabled:
                        true
                }
            );

        assert.equal(
            result.released,
            true
        );

        assert.equal(
            result.disabled,
            true
        );

        assert.equal(
            result.acquired,
            false
        );
    }
);

/* ==========================================================
   GUARDED EXECUTION
========================================================== */

test(
    "executeWithLock executes and releases operation",
    async function () {
        const firestore =
            createFirestoreStub();

        const runtime =
            createRuntime({
                firestore:
                    firestore
            });

        const result =
            await executeWithLock(
                runtime,
                "order:order-1",
                "worker-1",
                async function (
                    lock
                ) {
                    assert.equal(
                        lock.ownerId,
                        "worker-1"
                    );

                    assert.equal(
                        typeof lock.token,
                        "string"
                    );

                    return {
                        processed:
                            true
                    };
                },
                {
                    namespace:
                        "orders",

                    leaseMs:
                        5000,

                    now:
                        function () {
                            return 1000;
                        }
                }
            );

        assert.equal(
            result.executed,
            true
        );

        assert.equal(
            result.acquired,
            true
        );

        assert.deepEqual(
            result.result,
            {
                processed:
                    true
            }
        );

        assert.equal(
            result.release.released,
            true
        );

        assert.equal(
            firestore.hasDocument(
                lockPath(
                    "order:order-1",
                    "orders"
                )
            ),
            false
        );
    }
);

test(
    "executeWithLock supports lease renewal callback",
    async function () {
        const runtime =
            createRuntime();

        let now =
            1000;

        const result =
            await executeWithLock(
                runtime,
                "order:order-1",
                "worker-1",
                async function (
                    lock
                ) {
                    now =
                        2000;

                    const renewal =
                        await lock.renew();

                    assert.equal(
                        renewal.renewed,
                        true
                    );

                    assert.equal(
                        renewal.expiresAt,
                        new Date(
                            7000
                        ).toISOString()
                    );

                    return "done";
                },
                {
                    namespace:
                        "orders",

                    leaseMs:
                        5000,

                    now:
                        function () {
                            return now;
                        }
                }
            );

        assert.equal(
            result.result,
            "done"
        );
    }
);

test(
    "executeWithLock rethrows operation errors and releases lock",
    async function () {
        const firestore =
            createFirestoreStub();

        const expected =
            new Error(
                "Operation failed."
            );

        await assert.rejects(
            async function () {
                await executeWithLock(
                    createRuntime({
                        firestore:
                            firestore
                    }),
                    "order:order-1",
                    "worker-1",
                    async function () {
                        throw expected;
                    },
                    {
                        namespace:
                            "orders",

                        now:
                            function () {
                                return 1000;
                            }
                    }
                );
            },
            expected
        );

        assert.equal(
            firestore.hasDocument(
                lockPath(
                    "order:order-1",
                    "orders"
                )
            ),
            false
        );
    }
);

test(
    "executeWithLock returns unexecuted result when unavailable",
    async function () {
        const path =
            lockPath(
                "order:order-1",
                "orders"
            );

        const firestore =
            createFirestoreStub({
                [path]:
                    createStoredLock()
            });

        const result =
            await executeWithLock(
                createRuntime({
                    firestore:
                        firestore
                }),
                "order:order-1",
                "worker-2",
                async function () {
                    throw new Error(
                        "Should not run."
                    );
                },
                {
                    namespace:
                        "orders",

                    throwIfUnavailable:
                        false,

                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            result.executed,
            false
        );

        assert.equal(
            result.acquired,
            false
        );

        assert.equal(
            result.result,
            undefined
        );
    }
);

test(
    "executeWithLock throws when unavailable by default",
    async function () {
        const path =
            lockPath(
                "order:order-1",
                "orders"
            );

        const firestore =
            createFirestoreStub({
                [path]:
                    createStoredLock()
            });

        await assert.rejects(
            async function () {
                await executeWithLock(
                    createRuntime({
                        firestore:
                            firestore
                    }),
                    "order:order-1",
                    "worker-2",
                    async function () {},
                    {
                        namespace:
                            "orders",

                        now:
                            function () {
                                return 2000;
                            }
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
                    423
                );

                return true;
            }
        );
    }
);

test(
    "executeWithLock can retain lock after operation",
    async function () {
        const firestore =
            createFirestoreStub();

        const result =
            await executeWithLock(
                createRuntime({
                    firestore:
                        firestore
                }),
                "order:order-1",
                "worker-1",
                async function () {
                    return "done";
                },
                {
                    namespace:
                        "orders",

                    releaseAfterOperation:
                        false,

                    now:
                        function () {
                            return 1000;
                        }
                }
            );

        assert.equal(
            result.release,
            null
        );

        assert.equal(
            firestore.hasDocument(
                lockPath(
                    "order:order-1",
                    "orders"
                )
            ),
            true
        );
    }
);

test(
    "executeWithLock requires operation function",
    async function () {
        await assert.rejects(
            async function () {
                await executeWithLock(
                    createRuntime(),
                    "key",
                    "worker-1",
                    null,
                    {}
                );
            },
            /must be a function/
        );
    }
);

/* ==========================================================
   INSPECTION
========================================================== */

test(
    "inspectLock returns lock state",
    async function () {
        const path =
            lockPath(
                "order:order-1",
                "orders"
            );

        const firestore =
            createFirestoreStub({
                [path]:
                    createStoredLock()
            });

        const result =
            await inspectLock(
                createRuntime({
                    firestore:
                        firestore
                }),
                "order:order-1",
                {
                    namespace:
                        "orders",

                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            result.key,
            "order:order-1"
        );

        assert.equal(
            result.expired,
            false
        );

        assert.equal(
            result.remainingMs,
            3000
        );
    }
);

test(
    "inspectLock reports expired lock",
    async function () {
        const path =
            lockPath(
                "order:order-1",
                "orders"
            );

        const firestore =
            createFirestoreStub({
                [path]:
                    createStoredLock({
                        expiresAt:
                            TestTimestamp.fromMillis(
                                1000
                            )
                    })
            });

        const result =
            await inspectLock(
                createRuntime({
                    firestore:
                        firestore
                }),
                "order:order-1",
                {
                    namespace:
                        "orders",

                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            result.expired,
            true
        );

        assert.equal(
            result.remainingMs,
            0
        );
    }
);

test(
    "inspectLock returns null for missing and disabled locks",
    async function () {
        assert.equal(
            await inspectLock(
                createRuntime(),
                "missing"
            ),
            null
        );

        assert.equal(
            await inspectLock(
                null,
                "lock",
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
   QUERY
========================================================== */

test(
    "normalizeLockQuery normalizes filters",
    function () {
        assert.deepEqual(
            normalizeLockQuery(
                {
                    namespace:
                        "Order Service",

                    ownerId:
                        " worker-1 ",

                    expired:
                        true,

                    expiresBefore:
                        3000,

                    expiresAfter:
                        1000,

                    orderBy:
                        "acquiredAt",

                    direction:
                        "DESC",

                    limit:
                        25
                },
                {}
            ),
            {
                namespace:
                    "order-service",

                ownerId:
                    "worker-1",

                expired:
                    true,

                expiresBefore:
                    3000,

                expiresAfter:
                    1000,

                orderBy:
                    "acquiredAt",

                direction:
                    "desc",

                limit:
                    25
            }
        );
    }
);

test(
    "queryLocks filters and orders locks",
    async function () {
        const first =
            createStoredLock({
                key:
                    "order:one",

                compositeKey:
                    "orders:order:one",

                keyHash:
                    hashLockKey(
                        "orders:order:one"
                    ),

                ownerId:
                    "worker-1",

                acquiredAt:
                    TestTimestamp.fromMillis(
                        1000
                    ),

                expiresAt:
                    TestTimestamp.fromMillis(
                        5000
                    )
            });

        const second =
            createStoredLock({
                key:
                    "order:two",

                compositeKey:
                    "orders:order:two",

                keyHash:
                    hashLockKey(
                        "orders:order:two"
                    ),

                ownerId:
                    "worker-1",

                acquiredAt:
                    TestTimestamp.fromMillis(
                        2000
                    ),

                expiresAt:
                    TestTimestamp.fromMillis(
                        6000
                    )
            });

        const third =
            createStoredLock({
                key:
                    "payment:one",

                namespace:
                    "payments",

                compositeKey:
                    "payments:payment:one",

                keyHash:
                    hashLockKey(
                        "payments:payment:one"
                    ),

                ownerId:
                    "worker-2"
            });

        const firestore =
            createFirestoreStub({
                "_locks/one":
                    first,

                "_locks/two":
                    second,

                "_locks/three":
                    third
            });

        const results =
            await queryLocks(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    namespace:
                        "orders",

                    ownerId:
                        "worker-1",

                    orderBy:
                        "acquiredAt",

                    direction:
                        "desc"
                },
                {
                    now:
                        function () {
                            return 3000;
                        }
                }
            );

        assert.deepEqual(
            results.map(
                function (lock) {
                    return lock.key;
                }
            ),
            [
                "order:two",
                "order:one"
            ]
        );
    }
);

test(
    "queryLocks filters expired state in memory",
    async function () {
        const firestore =
            createFirestoreStub({
                "_locks/active":
                    createStoredLock({
                        key:
                            "active",

                        compositeKey:
                            "orders:active",

                        keyHash:
                            hashLockKey(
                                "orders:active"
                            ),

                        expiresAt:
                            TestTimestamp.fromMillis(
                                5000
                            )
                    }),

                "_locks/expired":
                    createStoredLock({
                        key:
                            "expired",

                        compositeKey:
                            "orders:expired",

                        keyHash:
                            hashLockKey(
                                "orders:expired"
                            ),

                        expiresAt:
                            TestTimestamp.fromMillis(
                                1000
                            )
                    })
            });

        const results =
            await queryLocks(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    namespace:
                        "orders",

                    expired:
                        true
                },
                {
                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.deepEqual(
            results.map(
                function (lock) {
                    return lock.key;
                }
            ),
            [
                "expired"
            ]
        );
    }
);

test(
    "queryLocks supports expiration date filters",
    async function () {
        const firestore =
            createFirestoreStub({
                "_locks/one":
                    createStoredLock({
                        key:
                            "one",

                        compositeKey:
                            "orders:one",

                        keyHash:
                            hashLockKey(
                                "orders:one"
                            ),

                        expiresAt:
                            TestTimestamp.fromMillis(
                                2000
                            )
                    }),

                "_locks/two":
                    createStoredLock({
                        key:
                            "two",

                        compositeKey:
                            "orders:two",

                        keyHash:
                            hashLockKey(
                                "orders:two"
                            ),

                        expiresAt:
                            TestTimestamp.fromMillis(
                                4000
                            )
                    })
            });

        const results =
            await queryLocks(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    namespace:
                        "orders",

                    expiresAfter:
                        3000,

                    expiresBefore:
                        5000
                },
                {
                    now:
                        function () {
                            return 1000;
                        }
                }
            );

        assert.deepEqual(
            results.map(
                function (lock) {
                    return lock.key;
                }
            ),
            [
                "two"
            ]
        );
    }
);

test(
    "queryLocks returns empty list when disabled",
    async function () {
        assert.deepEqual(
            await queryLocks(
                null,
                {},
                {
                    disabled:
                        true
                }
            ),
            []
        );
    }
);

/* ==========================================================
   RESULT AND RECORD SANITIZATION
========================================================== */

test(
    "createLockResult normalizes output",
    function () {
        const descriptor =
            createLockDescriptor(
                "order:order-1",
                "orders"
            );

        const result =
            createLockResult(
                descriptor,
                {
                    status:
                        "acquired",

                    acquired:
                        true,

                    ownerId:
                        "worker-1",

                    token:
                        "token-1",

                    acquisitionCount:
                        1,

                    takeoverCount:
                        0,

                    acquiredAt:
                        TestTimestamp.fromMillis(
                            1000
                        ),

                    expiresAt:
                        TestTimestamp.fromMillis(
                            5000
                        )
                }
            );

        assert.equal(
            result.acquired,
            true
        );

        assert.equal(
            result.key,
            "order:order-1"
        );

        assert.equal(
            result.acquiredAt,
            new Date(
                1000
            ).toISOString()
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
    "sanitizeLockRecord serializes timestamps",
    function () {
        const result =
            sanitizeLockRecord(
                createStoredLock({
                    renewedAt:
                        TestTimestamp.fromMillis(
                            2000
                        )
                })
            );

        assert.equal(
            result.createdAt,
            new Date(
                1000
            ).toISOString()
        );

        assert.equal(
            result.renewedAt,
            new Date(
                2000
            ).toISOString()
        );

        assert.equal(
            result.expiresAt,
            new Date(
                5000
            ).toISOString()
        );
    }
);

/* ==========================================================
   METADATA
========================================================== */

test(
    "sanitizeLockMetadata preserves objects and wraps primitives",
    function () {
        assert.deepEqual(
            sanitizeLockMetadata({
                orderId:
                    "order-1"
            }),
            {
                orderId:
                    "order-1"
            }
        );

        assert.deepEqual(
            sanitizeLockMetadata(
                "checkout"
            ),
            {
                value:
                    "checkout"
            }
        );

        assert.deepEqual(
            sanitizeLockMetadata(
                null
            ),
            {}
        );
    }
);

/* ==========================================================
   ERRORS
========================================================== */

test(
    "lock error factories create service errors",
    function () {
        const descriptor =
            createLockDescriptor(
                "order:order-1",
                "orders"
            );

        const notFound =
            createLockNotFoundError(
                descriptor
            );

        const unavailable =
            createLockUnavailableError({
                key:
                    "order:order-1",

                namespace:
                    "orders",

                ownerId:
                    "worker-1",

                expiresAt:
                    "2026-07-20T09:00:00.000Z"
            });

        assert.equal(
            notFound.code,
            "not-found"
        );

        assert.equal(
            notFound.status,
            404
        );

        assert.equal(
            unavailable.code,
            "resource-exhausted"
        );

        assert.equal(
            unavailable.status,
            423
        );

        assert.equal(
            unavailable.retryable,
            true
        );
    }
);

/* ==========================================================
   RUNTIME AND TIME
========================================================== */

test(
    "assertLockRuntime validates runtime",
    function () {
        assert.doesNotThrow(
            function () {
                assertLockRuntime(
                    createRuntime()
                );
            }
        );

        assert.throws(
            function () {
                assertLockRuntime(
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

        assert.throws(
            function () {
                assertLockRuntime({
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
    "resolveNow prefers option clock",
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
    "timestamp helpers support common values",
    function () {
        const timestamp =
            createDatabaseTimestamp(
                {
                    Timestamp:
                        TestTimestamp
                },
                1000
            );

        assert.equal(
            timestamp.toMillis(),
            1000
        );

        assert.equal(
            toMilliseconds(
                timestamp
            ),
            1000
        );

        assert.equal(
            toMilliseconds(
                new Date(
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
            serializeTimestamp(
                timestamp
            ),
            new Date(
                1000
            ).toISOString()
        );
    }
);

test(
    "delay supports custom sleep implementation",
    async function () {
        let received =
            null;

        await delay(
            250,
            {
                sleep:
                    async function (
                        milliseconds
                    ) {
                        received =
                            milliseconds;
                    }
            }
        );

        assert.equal(
            received,
            250
        );
    }
);

test(
    "generateLockToken creates a token",
    function () {
        const first =
            generateLockToken();

        const second =
            generateLockToken();

        assert.equal(
            typeof first,
            "string"
        );

        assert.notEqual(
            first,
            second
        );
    }
);

/* ==========================================================
   LOGGING
========================================================== */

test(
    "logLockEvent logs standard events",
    function () {
        const logger =
            createLoggerStub();

        logLockEvent(
            {
                logger:
                    logger
            },
            createStoredLock(),
            "acquired",
            {
                log:
                    true
            }
        );

        assert.equal(
            logger.entries.length,
            1
        );

        assert.equal(
            logger.entries[0].level,
            "info"
        );

        assert.equal(
            logger.entries[0].message,
            "Lock event."
        );
    }
);

test(
    "logLockEvent logs unavailable as debug",
    function () {
        const logger =
            createLoggerStub();

        logLockEvent(
            {
                logger:
                    logger
            },
            createStoredLock(),
            "unavailable",
            {
                log:
                    true
            }
        );

        assert.equal(
            logger.entries[0].level,
            "debug"
        );

        assert.equal(
            logger.entries[0].message,
            "Lock unavailable."
        );
    }
);

test(
    "logLockEvent can be disabled",
    function () {
        const logger =
            createLoggerStub();

        logLockEvent(
            {
                logger:
                    logger
            },
            createStoredLock(),
            "acquired",
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
    "logLockReleaseFailure writes warning",
    function () {
        const logger =
            createLoggerStub();

        logLockReleaseFailure(
            {
                logger:
                    logger
            },
            {
                key:
                    "order:order-1",

                namespace:
                    "orders",

                ownerId:
                    "worker-1"
            },
            {
                code:
                    "firestore/unavailable",

                message:
                    "Release failed."
            },
            {
                log:
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
            "Lock release failed after operation."
        );
    }
);

/* ==========================================================
   CONSTANTS
========================================================== */

test(
    "lock constants expose expected defaults",
    function () {
        assert.equal(
            constants.LOCK_COLLECTION,
            "_locks"
        );

        assert.equal(
            constants.DEFAULT_NAMESPACE,
            "global"
        );

        assert.equal(
            constants.DEFAULT_LEASE_MS,
            60000
        );

        assert.equal(
            constants.DEFAULT_ACQUIRE_TIMEOUT_MS,
            0
        );

        assert.equal(
            constants.DEFAULT_RETRY_INTERVAL_MS,
            100
        );

        assert.equal(
            constants.DEFAULT_QUERY_LIMIT,
            100
        );

        assert.equal(
            constants.MAX_QUERY_LIMIT,
            500
        );

        assert.equal(
            constants.DEFAULT_MAX_KEY_LENGTH,
            500
        );

        assert.deepEqual(
            constants.LOCK_STATUSES,
            {
                acquired:
                    "acquired",

                unavailable:
                    "unavailable",

                renewed:
                    "renewed",

                released:
                    "released",

                disabled:
                    "disabled"
            }
        );
    }
);