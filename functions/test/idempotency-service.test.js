"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   IDEMPOTENCY SERVICE TEST SUITE
========================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createIdempotencyService,
    executeIdempotentOperation,
    reserveIdempotencyRecord,
    evaluateExistingRecord,
    createProcessingRecord,
    completeIdempotencyRecord,
    failIdempotencyRecord,
    inspectIdempotencyRecord,
    clearIdempotencyRecord,
    resolveIdempotencyKey,
    normalizeIdempotencyKey,
    generateIdempotencyKey,
    createIdempotencyDescriptor,
    normalizeNamespace,
    resolveFingerprintValue,
    createRequestFingerprint,
    stableStringify,
    normalizeStableValue,
    hashValue,
    createIdempotencyConflictError,
    createIdempotencyProcessingError,
    assertSerializableResult,
    sanitizeIdempotencyRecord,
    serializeOperationError,
    normalizeIdempotencyOptions,
    normalizeCollection,
    normalizePositiveInteger,
    assertIdempotencyRuntime,
    resolveNow,
    createDatabaseTimestamp,
    toMilliseconds,
    getHeader,
    normalizeStatus,
    sanitizeMetadata,
    serializeTimestamp,
    logIdempotencyEvent,
    constants
} = require(
    "../src/shared/idempotency-service"
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
        return Buffer.from(value);
    }

    if (
        Array.isArray(value)
    ) {
        return value.map(clone);
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

function merge(
    existing,
    update
) {
    return Object.assign(
        {},
        clone(existing || {}),
        clone(update || {})
    );
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

    function snapshotFor(path) {
        return {
            exists:
                documents.has(path),

            data:
                function () {
                    return documents.has(path)
                        ? clone(
                              documents.get(path)
                          )
                        : undefined;
                }
        };
    }

    function referenceFor(
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
                    return snapshotFor(
                        path
                    );
                },

            set:
                async function (
                    value,
                    options
                ) {
                    documents.set(
                        path,
                        options &&
                        options.merge
                            ? merge(
                                  documents.get(
                                      path
                                  ),
                                  value
                              )
                            : clone(value)
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
                            return referenceFor(
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
                                    clone(value),

                                options:
                                    options
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
                    await write
                        .reference
                        .set(
                            write.value,
                            write.options
                        );
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
                          documents.get(path)
                      )
                    : undefined;
            },

        hasDocument:
            function (path) {
                return documents.has(path);
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

function getDocumentPath(
    key,
    namespace
) {
    const descriptor =
        createIdempotencyDescriptor(
            key,
            namespace
        );

    return constants
        .IDEMPOTENCY_COLLECTION +
        "/" +
        descriptor.documentId;
}

/* ==========================================================
   SERVICE FACTORY
========================================================== */

test(
    "createIdempotencyService creates a frozen service",
    function () {
        const runtime =
            createRuntime();

        const service =
            createIdempotencyService({
                runtime:
                    runtime,

                namespace:
                    "checkout"
            });

        assert.equal(
            service.runtime,
            runtime
        );

        assert.equal(
            service.options.namespace,
            "checkout"
        );

        assert.equal(
            typeof service.execute,
            "function"
        );

        assert.equal(
            typeof service.inspect,
            "function"
        );

        assert.equal(
            typeof service.clear,
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
    "normalizeIdempotencyOptions applies defaults",
    function () {
        const options =
            normalizeIdempotencyOptions(
                {}
            );

        assert.equal(
            options.collection,
            constants
                .IDEMPOTENCY_COLLECTION
        );

        assert.equal(
            options.namespace,
            constants.DEFAULT_NAMESPACE
        );

        assert.equal(
            options.headerName,
            constants.DEFAULT_KEY_HEADER
        );

        assert.equal(
            options.ttlMs,
            constants.DEFAULT_TTL_MS
        );

        assert.equal(
            options.processingTimeoutMs,
            constants
                .DEFAULT_PROCESSING_TIMEOUT_MS
        );

        assert.equal(
            options.maxResultBytes,
            constants
                .DEFAULT_MAX_RESULT_BYTES
        );

        assert.equal(
            options.required,
            true
        );

        assert.equal(
            options.retainFailed,
            true
        );
    }
);

test(
    "normalizeIdempotencyOptions respects overrides",
    function () {
        const options =
            normalizeIdempotencyOptions({
                collection:
                    "customIdempotency",

                namespace:
                    "orders",

                headerName:
                    "x-operation-key",

                required:
                    false,

                ttlMs:
                    10000,

                failureTtlMs:
                    5000,

                processingTimeoutMs:
                    2000,

                maxResultBytes:
                    1000,

                retainFailed:
                    false,

                disabled:
                    true,

                exposeKey:
                    true,

                log:
                    false
            });

        assert.equal(
            options.collection,
            "customIdempotency"
        );

        assert.equal(
            options.namespace,
            "orders"
        );

        assert.equal(
            options.headerName,
            "x-operation-key"
        );

        assert.equal(
            options.required,
            false
        );

        assert.equal(
            options.ttlMs,
            10000
        );

        assert.equal(
            options.failureTtlMs,
            5000
        );

        assert.equal(
            options.processingTimeoutMs,
            2000
        );

        assert.equal(
            options.maxResultBytes,
            1000
        );

        assert.equal(
            options.retainFailed,
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
    }
);

test(
    "normalizeCollection validates Firestore collection names",
    function () {
        assert.equal(
            normalizeCollection(
                "_idempotency"
            ),
            "_idempotency"
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
                    "internal/idempotency"
                );
            },
            /Firestore collection name/
        );
    }
);

test(
    "normalizePositiveInteger validates values",
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
            normalizePositiveInteger(
                undefined,
                10,
                "Value"
            ),
            10
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
    }
);

/* ==========================================================
   KEY RESOLUTION
========================================================== */

test(
    "resolveIdempotencyKey uses custom resolver",
    function () {
        assert.equal(
            resolveIdempotencyKey(
                {},
                {
                    keyResolver:
                        function () {
                            return "custom-key";
                        }
                }
            ),
            "custom-key"
        );
    }
);

test(
    "resolveIdempotencyKey uses explicit key",
    function () {
        assert.equal(
            resolveIdempotencyKey(
                {},
                {
                    key:
                        "explicit-key"
                }
            ),
            "explicit-key"
        );
    }
);

test(
    "resolveIdempotencyKey reads HTTP header",
    function () {
        assert.equal(
            resolveIdempotencyKey(
                {
                    headers: {
                        "Idempotency-Key":
                            "header-key"
                    }
                },
                {
                    headerName:
                        "idempotency-key"
                }
            ),
            "header-key"
        );
    }
);

test(
    "resolveIdempotencyKey reads callable raw request",
    function () {
        assert.equal(
            resolveIdempotencyKey(
                {
                    rawRequest: {
                        headers: {
                            "idempotency-key":
                                "callable-key"
                        }
                    }
                },
                {}
            ),
            "callable-key"
        );
    }
);

test(
    "resolveIdempotencyKey reads direct property",
    function () {
        assert.equal(
            resolveIdempotencyKey(
                {
                    idempotencyKey:
                        "direct-key"
                },
                {}
            ),
            "direct-key"
        );
    }
);

test(
    "resolveIdempotencyKey generates key when optional",
    function () {
        const key =
            resolveIdempotencyKey(
                {},
                {
                    required:
                        false
                }
            );

        assert.equal(
            typeof key,
            "string"
        );

        assert.ok(
            key.length > 0
        );
    }
);

test(
    "resolveIdempotencyKey rejects missing required key",
    function () {
        assert.throws(
            function () {
                resolveIdempotencyKey(
                    {},
                    {
                        required:
                            true
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
    "normalizeIdempotencyKey validates content",
    function () {
        assert.equal(
            normalizeIdempotencyKey(
                " order_123:key "
            ),
            "order_123:key"
        );

        assert.throws(
            function () {
                normalizeIdempotencyKey(
                    ""
                );
            },
            /invalid/
        );

        assert.throws(
            function () {
                normalizeIdempotencyKey(
                    "invalid key"
                );
            },
            /unsupported characters/
        );

        assert.throws(
            function () {
                normalizeIdempotencyKey(
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

test(
    "generateIdempotencyKey returns unique-looking keys",
    function () {
        const first =
            generateIdempotencyKey();

        const second =
            generateIdempotencyKey();

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
   DESCRIPTOR AND HASHING
========================================================== */

test(
    "normalizeNamespace sanitizes values",
    function () {
        assert.equal(
            normalizeNamespace(
                " Checkout Orders "
            ),
            "checkout-orders"
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
    "createIdempotencyDescriptor creates deterministic metadata",
    function () {
        const descriptor =
            createIdempotencyDescriptor(
                "order-123",
                "checkout"
            );

        assert.deepEqual(
            descriptor,
            {
                key:
                    "order-123",

                namespace:
                    "checkout",

                compositeKey:
                    "checkout:order-123",

                keyHash:
                    hashValue(
                        "checkout:order-123"
                    ),

                documentId:
                    hashValue(
                        "checkout:order-123"
                    )
            }
        );
    }
);

test(
    "hashValue returns SHA-256 hashes",
    function () {
        const hash =
            hashValue(
                "value"
            );

        assert.match(
            hash,
            /^[a-f0-9]{64}$/
        );

        assert.equal(
            hash,
            hashValue(
                "value"
            )
        );
    }
);

/* ==========================================================
   FINGERPRINTING
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
    "stableStringify preserves array order",
    function () {
        assert.equal(
            stableStringify([
                3,
                1,
                2
            ]),
            "[3,1,2]"
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

                undefinedValue:
                    undefined
            }),
            {
                bigint:
                    "10",

                buffer:
                    "aGVsbG8=",

                date:
                    "2026-07-20T09:00:00.000Z",

                undefinedValue:
                    null
            }
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

test(
    "createRequestFingerprint is stable across key order",
    function () {
        assert.equal(
            createRequestFingerprint({
                a:
                    1,

                b:
                    2
            }),
            createRequestFingerprint({
                b:
                    2,

                a:
                    1
            })
        );
    }
);

test(
    "resolveFingerprintValue follows resolver precedence",
    function () {
        assert.deepEqual(
            resolveFingerprintValue(
                {
                    body: {
                        value:
                            1
                    }
                },
                {
                    fingerprintResolver:
                        function () {
                            return {
                                custom:
                                    true
                            };
                        }
                }
            ),
            {
                custom:
                    true
            }
        );

        assert.equal(
            resolveFingerprintValue(
                {},
                {
                    fingerprint:
                        "fixed"
                }
            ),
            "fixed"
        );

        assert.deepEqual(
            resolveFingerprintValue(
                {
                    data: {
                        callable:
                            true
                    }
                },
                {}
            ),
            {
                callable:
                    true
            }
        );
    }
);

/* ==========================================================
   RECORD EVALUATION
========================================================== */

test(
    "evaluateExistingRecord reuses completed matching records",
    function () {
        assert.deepEqual(
            evaluateExistingRecord(
                {
                    status:
                        "completed",

                    fingerprint:
                        "fingerprint"
                },
                {
                    fingerprint:
                        "fingerprint",

                    now:
                        1000,

                    processingTimeoutMs:
                        500
                }
            ),
            {
                action:
                    "reuse"
            }
        );
    }
);

test(
    "evaluateExistingRecord detects fingerprint conflicts",
    function () {
        assert.deepEqual(
            evaluateExistingRecord(
                {
                    status:
                        "completed",

                    fingerprint:
                        "first"
                },
                {
                    fingerprint:
                        "second"
                }
            ),
            {
                action:
                    "conflict"
            }
        );
    }
);

test(
    "evaluateExistingRecord blocks active processing records",
    function () {
        assert.deepEqual(
            evaluateExistingRecord(
                {
                    status:
                        "processing",

                    fingerprint:
                        "fingerprint",

                    startedAt:
                        TestTimestamp
                            .fromMillis(
                                900
                            )
                },
                {
                    fingerprint:
                        "fingerprint",

                    now:
                        1000,

                    processingTimeoutMs:
                        500
                }
            ),
            {
                action:
                    "processing"
            }
        );
    }
);

test(
    "evaluateExistingRecord reserves stale processing records",
    function () {
        assert.deepEqual(
            evaluateExistingRecord(
                {
                    status:
                        "processing",

                    fingerprint:
                        "fingerprint",

                    startedAt:
                        TestTimestamp
                            .fromMillis(
                                100
                            )
                },
                {
                    fingerprint:
                        "fingerprint",

                    now:
                        1000,

                    processingTimeoutMs:
                        500
                }
            ),
            {
                action:
                    "reserve"
            }
        );
    }
);

test(
    "evaluateExistingRecord retries failed records",
    function () {
        assert.deepEqual(
            evaluateExistingRecord(
                {
                    status:
                        "failed",

                    fingerprint:
                        "fingerprint"
                },
                {
                    fingerprint:
                        "fingerprint"
                }
            ),
            {
                action:
                    "reserve"
            }
        );
    }
);

/* ==========================================================
   RECORD FACTORIES
========================================================== */

test(
    "createProcessingRecord creates processing state",
    function () {
        const record =
            createProcessingRecord(
                {
                    Timestamp:
                        TestTimestamp
                },
                {
                    key:
                        "order-123",

                    keyHash:
                        "hash",

                    namespace:
                        "checkout",

                    fingerprint:
                        "fingerprint",

                    now:
                        1000,

                    ttlMs:
                        5000,

                    ownerId:
                        "customer-1",

                    metadata: {
                        orderId:
                            "order-123"
                    }
                }
            );

        assert.equal(
            record.status,
            "processing"
        );

        assert.equal(
            record.attempt,
            1
        );

        assert.equal(
            record.startedAt.toMillis(),
            1000
        );

        assert.equal(
            record.expiresAt.toMillis(),
            6000
        );

        assert.deepEqual(
            record.metadata,
            {
                orderId:
                    "order-123"
            }
        );
    }
);

test(
    "completeIdempotencyRecord stores completed result",
    async function () {
        const firestore =
            createFirestoreStub();

        const runtime =
            createRuntime({
                firestore:
                    firestore
            });

        const reference =
            runtime.db
                .collection(
                    constants
                        .IDEMPOTENCY_COLLECTION
                )
                .doc("record");

        const record =
            await completeIdempotencyRecord(
                runtime,
                reference,
                {
                    key:
                        "order-123",

                    namespace:
                        "checkout",

                    fingerprint:
                        "fingerprint",

                    result: {
                        orderId:
                            "order-123"
                    },

                    completedAt:
                        1000,

                    ttlMs:
                        5000
                }
            );

        assert.equal(
            record.status,
            "completed"
        );

        assert.deepEqual(
            record.result,
            {
                orderId:
                    "order-123"
            }
        );

        assert.equal(
            record.expiresAt.toMillis(),
            6000
        );
    }
);

test(
    "failIdempotencyRecord stores failure metadata",
    async function () {
        const firestore =
            createFirestoreStub();

        const runtime =
            createRuntime({
                firestore:
                    firestore
            });

        const reference =
            runtime.db
                .collection(
                    constants
                        .IDEMPOTENCY_COLLECTION
                )
                .doc("record");

        const error =
            new ServiceError(
                "payment-failed",
                "Payment failed.",
                {
                    status:
                        402,

                    retryable:
                        false
                }
            );

        const record =
            await failIdempotencyRecord(
                runtime,
                reference,
                {
                    key:
                        "payment-123",

                    namespace:
                        "payments",

                    fingerprint:
                        "fingerprint",

                    failedAt:
                        1000,

                    ttlMs:
                        5000,

                    error:
                        error,

                    retainFailed:
                        true
                }
            );

        assert.equal(
            record.status,
            "failed"
        );

        assert.equal(
            record.error.code,
            "payment-failed"
        );

        assert.equal(
            record.failedAt.toMillis(),
            1000
        );
    }
);

test(
    "failIdempotencyRecord deletes record when failures are not retained",
    async function () {
        const firestore =
            createFirestoreStub({
                "_idempotency/record": {
                    status:
                        "processing"
                }
            });

        const runtime =
            createRuntime({
                firestore:
                    firestore
            });

        const reference =
            runtime.db
                .collection(
                    constants
                        .IDEMPOTENCY_COLLECTION
                )
                .doc("record");

        const result =
            await failIdempotencyRecord(
                runtime,
                reference,
                {
                    retainFailed:
                        false
                }
            );

        assert.deepEqual(
            result,
            {
                deleted:
                    true
            }
        );

        assert.equal(
            firestore.hasDocument(
                "_idempotency/record"
            ),
            false
        );
    }
);

/* ==========================================================
   RESERVATION
========================================================== */

test(
    "reserveIdempotencyRecord creates a new reservation",
    async function () {
        const firestore =
            createFirestoreStub();

        const runtime =
            createRuntime({
                firestore:
                    firestore
            });

        const reference =
            runtime.db
                .collection(
                    constants
                        .IDEMPOTENCY_COLLECTION
                )
                .doc("record");

        const result =
            await reserveIdempotencyRecord(
                runtime,
                reference,
                {
                    key:
                        "order-123",

                    keyHash:
                        "hash",

                    namespace:
                        "checkout",

                    fingerprint:
                        "fingerprint",

                    now:
                        1000,

                    ttlMs:
                        5000,

                    processingTimeoutMs:
                        1000
                }
            );

        assert.equal(
            result.action,
            "execute"
        );

        assert.equal(
            result.record.status,
            "processing"
        );
    }
);

/* ==========================================================
   EXECUTION
========================================================== */

test(
    "executeIdempotentOperation executes and stores result",
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

        let calls =
            0;

        const result =
            await executeIdempotentOperation(
                runtime,
                {
                    headers: {
                        "idempotency-key":
                            "order-123"
                    },

                    body: {
                        productId:
                            "product-1"
                    }
                },
                async function () {
                    calls +=
                        1;

                    return {
                        orderId:
                            "order-123"
                    };
                },
                {
                    namespace:
                        "checkout",

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
            result.reused,
            false
        );

        assert.deepEqual(
            result.result,
            {
                orderId:
                    "order-123"
            }
        );

        const stored =
            firestore.getDocument(
                getDocumentPath(
                    "order-123",
                    "checkout"
                )
            );

        assert.equal(
            stored.status,
            "completed"
        );
    }
);

test(
    "executeIdempotentOperation reuses completed result",
    async function () {
        const runtime =
            createRuntime();

        const options = {
            namespace:
                "checkout",

            now:
                function () {
                    return 1000;
                }
        };

        const input = {
            headers: {
                "idempotency-key":
                    "order-123"
            },

            body: {
                productId:
                    "product-1"
            }
        };

        let calls =
            0;

        const first =
            await executeIdempotentOperation(
                runtime,
                input,
                async function () {
                    calls +=
                        1;

                    return {
                        orderId:
                            "order-123"
                    };
                },
                options
            );

        const second =
            await executeIdempotentOperation(
                runtime,
                input,
                async function () {
                    calls +=
                        1;

                    return {
                        orderId:
                            "different"
                    };
                },
                options
            );

        assert.equal(
            calls,
            1
        );

        assert.equal(
            first.reused,
            false
        );

        assert.equal(
            second.reused,
            true
        );

        assert.deepEqual(
            second.result,
            {
                orderId:
                    "order-123"
            }
        );
    }
);

test(
    "executeIdempotentOperation rejects key reuse with different payload",
    async function () {
        const runtime =
            createRuntime();

        const options = {
            namespace:
                "checkout",

            now:
                function () {
                    return 1000;
                }
        };

        await executeIdempotentOperation(
            runtime,
            {
                headers: {
                    "idempotency-key":
                        "order-123"
                },

                body: {
                    productId:
                        "product-1"
                }
            },
            async function () {
                return {
                    orderId:
                        "order-123"
                };
            },
            options
        );

        await assert.rejects(
            async function () {
                await executeIdempotentOperation(
                    runtime,
                    {
                        headers: {
                            "idempotency-key":
                                "order-123"
                        },

                        body: {
                            productId:
                                "product-2"
                        }
                    },
                    async function () {
                        return {};
                    },
                    options
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "conflict"
                );

                assert.match(
                    error.message,
                    /different request data/
                );

                return true;
            }
        );
    }
);

test(
    "executeIdempotentOperation rejects active processing record",
    async function () {
        const key =
            "order-123";

        const namespace =
            "checkout";

        const descriptor =
            createIdempotencyDescriptor(
                key,
                namespace
            );

        const fingerprint =
            createRequestFingerprint({
                productId:
                    "product-1"
            });

        const firestore =
            createFirestoreStub({
                [
                    constants
                        .IDEMPOTENCY_COLLECTION +
                    "/" +
                    descriptor.documentId
                ]: {
                    key:
                        key,

                    namespace:
                        namespace,

                    fingerprint:
                        fingerprint,

                    status:
                        "processing",

                    startedAt:
                        TestTimestamp
                            .fromMillis(
                                900
                            )
                }
            });

        await assert.rejects(
            async function () {
                await executeIdempotentOperation(
                    createRuntime({
                        firestore:
                            firestore
                    }),
                    {
                        headers: {
                            "idempotency-key":
                                key
                        },

                        body: {
                            productId:
                                "product-1"
                        }
                    },
                    async function () {
                        return {};
                    },
                    {
                        namespace:
                            namespace,

                        now:
                            function () {
                                return 1000;
                            },

                        processingTimeoutMs:
                            500
                    }
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "conflict"
                );

                assert.equal(
                    error.retryable,
                    true
                );

                assert.match(
                    error.message,
                    /already being processed/
                );

                return true;
            }
        );
    }
);

test(
    "executeIdempotentOperation retries stale processing record",
    async function () {
        const key =
            "order-123";

        const namespace =
            "checkout";

        const descriptor =
            createIdempotencyDescriptor(
                key,
                namespace
            );

        const fingerprint =
            createRequestFingerprint({
                productId:
                    "product-1"
            });

        const firestore =
            createFirestoreStub({
                [
                    constants
                        .IDEMPOTENCY_COLLECTION +
                    "/" +
                    descriptor.documentId
                ]: {
                    key:
                        key,

                    namespace:
                        namespace,

                    fingerprint:
                        fingerprint,

                    status:
                        "processing",

                    startedAt:
                        TestTimestamp
                            .fromMillis(
                                100
                            )
                }
            });

        const result =
            await executeIdempotentOperation(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    headers: {
                        "idempotency-key":
                            key
                    },

                    body: {
                        productId:
                            "product-1"
                    }
                },
                async function () {
                    return {
                        recovered:
                            true
                    };
                },
                {
                    namespace:
                        namespace,

                    now:
                        function () {
                            return 1000;
                        },

                    processingTimeoutMs:
                        500
                }
            );

        assert.equal(
            result.reused,
            false
        );

        assert.equal(
            result.result.recovered,
            true
        );
    }
);

test(
    "executeIdempotentOperation stores failed operations",
    async function () {
        const firestore =
            createFirestoreStub();

        const runtime =
            createRuntime({
                firestore:
                    firestore
            });

        const expected =
            new Error(
                "Payment provider failed."
            );

        expected.code =
            "provider-error";

        await assert.rejects(
            async function () {
                await executeIdempotentOperation(
                    runtime,
                    {
                        headers: {
                            "idempotency-key":
                                "payment-123"
                        },

                        body: {
                            amount:
                                5000
                        }
                    },
                    async function () {
                        throw expected;
                    },
                    {
                        namespace:
                            "payments",

                        now:
                            function () {
                                return 1000;
                            }
                    }
                );
            },
            expected
        );

        const stored =
            firestore.getDocument(
                getDocumentPath(
                    "payment-123",
                    "payments"
                )
            );

        assert.equal(
            stored.status,
            "failed"
        );

        assert.equal(
            stored.error.code,
            "provider-error"
        );
    }
);

test(
    "executeIdempotentOperation bypasses storage when disabled",
    async function () {
        const result =
            await executeIdempotentOperation(
                null,
                {},
                async function () {
                    return {
                        success:
                            true
                    };
                },
                {
                    disabled:
                        true
                }
            );

        assert.deepEqual(
            result,
            {
                reused:
                    false,

                disabled:
                    true,

                result: {
                    success:
                        true
                }
            }
        );
    }
);

test(
    "executeIdempotentOperation requires an operation function",
    async function () {
        await assert.rejects(
            async function () {
                await executeIdempotentOperation(
                    createRuntime(),
                    {},
                    null,
                    {}
                );
            },
            /must be a function/
        );
    }
);

/* ==========================================================
   INSPECTION AND CLEARING
========================================================== */

test(
    "inspectIdempotencyRecord returns stored record",
    async function () {
        const runtime =
            createRuntime();

        await executeIdempotentOperation(
            runtime,
            {
                headers: {
                    "idempotency-key":
                        "order-123"
                },

                body: {
                    productId:
                        "product-1"
                }
            },
            async function () {
                return {
                    orderId:
                        "order-123"
                };
            },
            {
                namespace:
                    "checkout",

                now:
                    function () {
                        return 1000;
                    }
            }
        );

        const record =
            await inspectIdempotencyRecord(
                runtime,
                {
                    headers: {
                        "idempotency-key":
                            "order-123"
                    }
                },
                {
                    namespace:
                        "checkout"
                }
            );

        assert.equal(
            record.status,
            "completed"
        );

        assert.deepEqual(
            record.result,
            {
                orderId:
                    "order-123"
            }
        );
    }
);

test(
    "inspectIdempotencyRecord returns null for missing record",
    async function () {
        const record =
            await inspectIdempotencyRecord(
                createRuntime(),
                {
                    headers: {
                        "idempotency-key":
                            "missing"
                    }
                },
                {
                    namespace:
                        "checkout"
                }
            );

        assert.equal(
            record,
            null
        );
    }
);

test(
    "clearIdempotencyRecord deletes stored record",
    async function () {
        const firestore =
            createFirestoreStub();

        const runtime =
            createRuntime({
                firestore:
                    firestore
            });

        await executeIdempotentOperation(
            runtime,
            {
                headers: {
                    "idempotency-key":
                        "order-123"
                },

                body:
                    {}
            },
            async function () {
                return {
                    success:
                        true
                };
            },
            {
                namespace:
                    "checkout",

                now:
                    function () {
                        return 1000;
                    }
            }
        );

        const result =
            await clearIdempotencyRecord(
                runtime,
                {
                    headers: {
                        "idempotency-key":
                            "order-123"
                    }
                },
                {
                    namespace:
                        "checkout"
                }
            );

        assert.equal(
            result.cleared,
            true
        );

        assert.equal(
            firestore.hasDocument(
                getDocumentPath(
                    "order-123",
                    "checkout"
                )
            ),
            false
        );
    }
);

test(
    "clearIdempotencyRecord is a no-op when disabled",
    async function () {
        assert.deepEqual(
            await clearIdempotencyRecord(
                null,
                {},
                {
                    disabled:
                        true
                }
            ),
            {
                cleared:
                    false,

                disabled:
                    true
            }
        );
    }
);

/* ==========================================================
   ERROR FACTORIES
========================================================== */

test(
    "createIdempotencyConflictError creates public conflict",
    function () {
        const error =
            createIdempotencyConflictError(
                "order-123",
                "checkout",
                {
                    status:
                        "completed"
                },
                {
                    exposeKey:
                        true,

                    requestId:
                        "req_123"
                }
            );

        assert.equal(
            error.code,
            "conflict"
        );

        assert.equal(
            error.status,
            409
        );

        assert.equal(
            error.retryable,
            false
        );

        assert.equal(
            error.details.key,
            "order-123"
        );

        assert.equal(
            error.requestId,
            "req_123"
        );
    }
);

test(
    "createIdempotencyProcessingError creates retryable conflict",
    function () {
        const error =
            createIdempotencyProcessingError(
                "order-123",
                "checkout",
                {
                    startedAt:
                        TestTimestamp
                            .fromMillis(
                                1000
                            )
                },
                {
                    exposeKey:
                        true
                }
            );

        assert.equal(
            error.code,
            "conflict"
        );

        assert.equal(
            error.retryable,
            true
        );

        assert.equal(
            error.details.startedAt,
            new Date(
                1000
            ).toISOString()
        );
    }
);

/* ==========================================================
   RESULT VALIDATION
========================================================== */

test(
    "assertSerializableResult accepts normal results",
    function () {
        assert.equal(
            assertSerializableResult(
                {
                    orderId:
                        "order-123"
                },
                {
                    maxResultBytes:
                        1000
                }
            ),
            true
        );
    }
);

test(
    "assertSerializableResult rejects circular results",
    function () {
        const result = {};

        result.self =
            result;

        assert.throws(
            function () {
                assertSerializableResult(
                    result,
                    {
                        maxResultBytes:
                            1000
                    }
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "internal"
                );

                return true;
            }
        );
    }
);

test(
    "assertSerializableResult rejects oversized results",
    function () {
        assert.throws(
            function () {
                assertSerializableResult(
                    {
                        value:
                            "x".repeat(100)
                    },
                    {
                        maxResultBytes:
                            10
                    }
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "resource-exhausted"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   RECORD SANITIZATION
========================================================== */

test(
    "sanitizeIdempotencyRecord serializes timestamps",
    function () {
        const record =
            sanitizeIdempotencyRecord({
                key:
                    "order-123",

                namespace:
                    "checkout",

                fingerprint:
                    "fingerprint",

                status:
                    "completed",

                result: {
                    success:
                        true
                },

                metadata:
                    {},

                startedAt:
                    TestTimestamp
                        .fromMillis(
                            1000
                        ),

                completedAt:
                    TestTimestamp
                        .fromMillis(
                            2000
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
                        )
            });

        assert.equal(
            record.startedAt,
            new Date(
                1000
            ).toISOString()
        );

        assert.equal(
            record.completedAt,
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
    }
);

test(
    "serializeOperationError creates safe error metadata",
    function () {
        const error =
            new ServiceError(
                "payment-failed",
                "Payment failed.",
                {
                    status:
                        402,

                    retryable:
                        false
                }
            );

        assert.deepEqual(
            serializeOperationError(
                error
            ),
            {
                name:
                    "ServiceError",

                code:
                    "payment-failed",

                message:
                    "Payment failed.",

                status:
                    402,

                retryable:
                    false
            }
        );
    }
);

/* ==========================================================
   RUNTIME AND TIME HELPERS
========================================================== */

test(
    "assertIdempotencyRuntime accepts valid runtime",
    function () {
        assert.doesNotThrow(
            function () {
                assertIdempotencyRuntime(
                    createRuntime()
                );
            }
        );
    }
);

test(
    "assertIdempotencyRuntime rejects missing datastore",
    function () {
        assert.throws(
            function () {
                assertIdempotencyRuntime(
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
    "assertIdempotencyRuntime requires transactions",
    function () {
        assert.throws(
            function () {
                assertIdempotencyRuntime({
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
    "createDatabaseTimestamp uses runtime Timestamp",
    function () {
        const result =
            createDatabaseTimestamp(
                {
                    Timestamp:
                        TestTimestamp
                },
                1234
            );

        assert.equal(
            result instanceof
                TestTimestamp,
            true
        );

        assert.equal(
            result.toMillis(),
            1234
        );
    }
);

test(
    "toMilliseconds supports timestamp forms",
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
    }
);

/* ==========================================================
   GENERAL HELPERS
========================================================== */

test(
    "getHeader supports common request interfaces",
    function () {
        assert.equal(
            getHeader(
                {
                    get:
                        function () {
                            return "get-value";
                        }
                },
                "idempotency-key"
            ),
            "get-value"
        );

        assert.equal(
            getHeader(
                {
                    headers: {
                        "Idempotency-Key":
                            "header-value"
                    }
                },
                "idempotency-key"
            ),
            "header-value"
        );
    }
);

test(
    "normalizeStatus falls back to processing",
    function () {
        assert.equal(
            normalizeStatus(
                "completed"
            ),
            "completed"
        );

        assert.equal(
            normalizeStatus(
                "unknown"
            ),
            "processing"
        );
    }
);

test(
    "sanitizeMetadata wraps primitive values",
    function () {
        assert.deepEqual(
            sanitizeMetadata(
                "checkout"
            ),
            {
                value:
                    "checkout"
            }
        );

        assert.deepEqual(
            sanitizeMetadata({
                orderId:
                    "order-123"
            }),
            {
                orderId:
                    "order-123"
            }
        );
    }
);

test(
    "serializeTimestamp returns ISO strings",
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

/* ==========================================================
   LOGGING
========================================================== */

test(
    "logIdempotencyEvent logs successful events at debug level",
    function () {
        const logger =
            createLoggerStub();

        logIdempotencyEvent(
            {
                logger:
                    logger
            },
            "completed",
            {
                namespace:
                    "checkout",

                status:
                    "completed",

                fingerprint:
                    "fingerprint"
            },
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
            "Idempotency event."
        );
    }
);

test(
    "logIdempotencyEvent logs failures at warn level",
    function () {
        const logger =
            createLoggerStub();

        logIdempotencyEvent(
            {
                logger:
                    logger
            },
            "failed",
            {
                namespace:
                    "payments",

                status:
                    "failed"
            },
            {
                log:
                    true
            }
        );

        assert.equal(
            logger.entries[0].level,
            "warn"
        );

        assert.equal(
            logger.entries[0].message,
            "Idempotent operation failed."
        );
    }
);

test(
    "logIdempotencyEvent can be disabled",
    function () {
        const logger =
            createLoggerStub();

        logIdempotencyEvent(
            {
                logger:
                    logger
            },
            "completed",
            {},
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
    "idempotency constants expose expected defaults",
    function () {
        assert.equal(
            constants
                .IDEMPOTENCY_COLLECTION,
            "_idempotency"
        );

        assert.equal(
            constants.DEFAULT_TTL_MS,
            86400000
        );

        assert.equal(
            constants
                .DEFAULT_PROCESSING_TIMEOUT_MS,
            300000
        );

        assert.equal(
            constants.DEFAULT_KEY_HEADER,
            "idempotency-key"
        );

        assert.equal(
            constants.DEFAULT_NAMESPACE,
            "global"
        );

        assert.equal(
            constants
                .DEFAULT_MAX_KEY_LENGTH,
            200
        );

        assert.equal(
            constants
                .DEFAULT_MAX_RESULT_BYTES,
            500000
        );

        assert.deepEqual(
            constants
                .IDEMPOTENCY_STATUSES,
            {
                processing:
                    "processing",

                completed:
                    "completed",

                failed:
                    "failed"
            }
        );
    }
);