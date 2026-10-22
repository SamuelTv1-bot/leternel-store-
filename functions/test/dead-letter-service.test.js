"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   DEAD-LETTER SERVICE TEST SUITE
========================================================== */

const test =
    require("node:test");

const assert =
    require("node:assert/strict");

const {
    createDeadLetterService,
    createDeadLetter,
    claimNextDeadLetter,
    loadDeadLetterCandidates,
    claimDeadLetter,
    isDeadLetterClaimable,
    compareDeadLetterCandidates,
    resolveDeadLetter,
    retryDeadLetter,
    releaseDeadLetter,
    archiveDeadLetter,
    discardDeadLetter,
    setDeadLetterTerminalStatus,
    getDeadLetter,
    queryDeadLetters,
    normalizeDeadLetterQuery,
    normalizeDeadLetterRecord,
    assertDeadLetterOwnership,
    sanitizeDeadLetterRecord,
    normalizeDeadLetterId,
    normalizeDeadLetterSource,
    normalizeDeadLetterEvent,
    normalizeDeadLetterStatus,
    normalizeDeadLetterPriority,
    normalizeWorkerId,
    normalizeDeadLetterTags,
    normalizeDeadLetterDate,
    normalizeDeadLetterOrderField,
    normalizeQueryLimit,
    normalizePositiveInteger,
    normalizeNonNegativeInteger,
    normalizeOptionalString,
    normalizeCollection,
    normalizeDeadLetterOptions,
    createDeadLetterId,
    generateLeaseToken,
    createDeadLetterFingerprint,
    hashDeadLetterValue,
    stableStringify,
    normalizeStableValue,
    assertSerializableDeadLetterValue,
    sanitizeDeadLetterMetadata,
    serializeDeadLetterError,
    createDeadLetterNotFoundError,
    createDeadLetterConflictError,
    assertDeadLetterRuntime,
    resolveNow,
    createDatabaseTimestamp,
    toMilliseconds,
    serializeTimestamp,
    logDeadLetterEvent,
    constants
} = require(
    "../src/shared/dead-letter-service"
);

const {
    ServiceError
} = require(
    "../src/shared/service-error"
);

/* ==========================================================
   TEST TIMESTAMP
========================================================== */

class TestTimestamp {
    constructor(
        milliseconds
    ) {
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

/* ==========================================================
   GENERAL HELPERS
========================================================== */

function clone(
    value
) {
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
        Buffer.isBuffer(
            value
        )
    ) {
        return Buffer.from(
            value
        );
    }

    if (
        Array.isArray(
            value
        )
    ) {
        return value.map(
            clone
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
    return String(
        path
    )
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

    switch (
        operator
    ) {
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

/* ==========================================================
   FIRESTORE STUB
========================================================== */

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

    function createSnapshot(
        path
    ) {
        return {
            exists:
                documents.has(
                    path
                ),

            id:
                path
                    .split("/")
                    .pop(),

            data:
                function () {
                    return documents.has(
                        path
                    )
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
                    const next =
                        options &&
                        options.merge
                            ? Object.assign(
                                  {},
                                  clone(
                                      documents.get(
                                          path
                                      ) || {}
                                  ),
                                  clone(
                                      value
                                  )
                              )
                            : clone(
                                  value
                              );

                    documents.set(
                        path,
                        next
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
                function (
                    count
                ) {
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
                                    return path
                                        .startsWith(
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
                                            clone(
                                                value
                                            )
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
                                    clone(
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
            function (
                path
            ) {
                return documents.has(
                    path
                )
                    ? clone(
                          documents.get(
                              path
                          )
                      )
                    : undefined;
            },

        hasDocument:
            function (
                path
            ) {
                return documents.has(
                    path
                );
            }
    };
}

/* ==========================================================
   LOGGER AND RUNTIME
========================================================== */

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
                return 5000;
            },

        logger:
            settings.logger ||
            createLoggerStub()
    };
}

function deadLetterPath(
    id
) {
    return (
        constants
            .DEAD_LETTER_COLLECTION +
        "/" +
        id
    );
}

function createStoredDeadLetter(
    overrides
) {
    return Object.assign(
        {
            id:
                "dead-letter-1",

            fingerprint:
                "fingerprint",

            source:
                "jobs",

            sourceId:
                "job-1",

            event:
                "order.process",

            status:
                "pending",

            priority:
                "normal",

            priorityWeight:
                200,

            payload: {
                orderId:
                    "order-1"
            },

            error: {
                name:
                    "Error",

                code:
                    "processing-failed",

                message:
                    "Processing failed.",

                status:
                    500,

                retryable:
                    false,

                details:
                    null
            },

            metadata:
                {},

            tags:
                [],

            claimCount:
                0,

            retryCount:
                0,

            workerId:
                null,

            leaseToken:
                null,

            resolution:
                null,

            retryResult:
                null,

            processingError:
                null,

            archiveReason:
                null,

            discardReason:
                null,

            createdAt:
                TestTimestamp
                    .fromMillis(
                        1000
                    ),

            updatedAt:
                TestTimestamp
                    .fromMillis(
                        1000
                    ),

            availableAt:
                TestTimestamp
                    .fromMillis(
                        1000
                    ),

            claimedAt:
                null,

            leaseExpiresAt:
                null,

            resolvedAt:
                null,

            retriedAt:
                null,

            archivedAt:
                null,

            discardedAt:
                null,

            expiresAt:
                TestTimestamp
                    .fromMillis(
                        10000
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
    "createDeadLetterService creates a frozen service",
    function () {
        const runtime =
            createRuntime();

        const service =
            createDeadLetterService({
                runtime:
                    runtime,

                defaultSource:
                    "jobs",

                defaultPriority:
                    "high"
            });

        assert.equal(
            service.runtime,
            runtime
        );

        assert.equal(
            service.options.defaultSource,
            "jobs"
        );

        assert.equal(
            service.options.defaultPriority,
            "high"
        );

        assert.equal(
            typeof service.create,
            "function"
        );

        assert.equal(
            typeof service.claim,
            "function"
        );

        assert.equal(
            typeof service.resolve,
            "function"
        );

        assert.equal(
            typeof service.retry,
            "function"
        );

        assert.equal(
            typeof service.release,
            "function"
        );

        assert.equal(
            typeof service.archive,
            "function"
        );

        assert.equal(
            typeof service.discard,
            "function"
        );

        assert.equal(
            typeof service.get,
            "function"
        );

        assert.equal(
            typeof service.query,
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
    "normalizeDeadLetterOptions applies defaults",
    function () {
        const options =
            normalizeDeadLetterOptions(
                {}
            );

        assert.equal(
            options.collection,
            "_deadLetters"
        );

        assert.equal(
            options.defaultSource,
            "unknown"
        );

        assert.equal(
            options.defaultPriority,
            "normal"
        );

        assert.equal(
            options.leaseMs,
            300000
        );

        assert.equal(
            options.retentionMs,
            7776000000
        );

        assert.equal(
            options.queryLimit,
            100
        );

        assert.equal(
            options.claimBatchSize,
            50
        );

        assert.equal(
            options.maxPayloadBytes,
            500000
        );

        assert.equal(
            options.maxResultBytes,
            500000
        );

        assert.equal(
            options.releaseDelayMs,
            0
        );

        assert.equal(
            options.preventDuplicates,
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
    "normalizeDeadLetterOptions respects overrides",
    function () {
        const idResolver =
            function () {
                return "custom-id";
            };

        const options =
            normalizeDeadLetterOptions({
                collection:
                    "deadLetters",

                defaultSource:
                    "webhooks",

                defaultPriority:
                    "urgent",

                leaseMs:
                    1000,

                retentionMs:
                    5000,

                queryLimit:
                    25,

                claimBatchSize:
                    10,

                maxPayloadBytes:
                    1000,

                maxResultBytes:
                    2000,

                releaseDelayMs:
                    500,

                preventDuplicates:
                    false,

                disabled:
                    true,

                log:
                    false,

                idResolver:
                    idResolver,

                leaseToken:
                    "lease-1"
            });

        assert.equal(
            options.collection,
            "deadLetters"
        );

        assert.equal(
            options.defaultSource,
            "webhooks"
        );

        assert.equal(
            options.defaultPriority,
            "urgent"
        );

        assert.equal(
            options.leaseMs,
            1000
        );

        assert.equal(
            options.retentionMs,
            5000
        );

        assert.equal(
            options.queryLimit,
            25
        );

        assert.equal(
            options.claimBatchSize,
            10
        );

        assert.equal(
            options.maxPayloadBytes,
            1000
        );

        assert.equal(
            options.maxResultBytes,
            2000
        );

        assert.equal(
            options.releaseDelayMs,
            500
        );

        assert.equal(
            options.preventDuplicates,
            false
        );

        assert.equal(
            options.disabled,
            true
        );

        assert.equal(
            options.log,
            false
        );

        assert.equal(
            options.idResolver,
            idResolver
        );

        assert.equal(
            options.leaseToken,
            "lease-1"
        );
    }
);

/* ==========================================================
   NORMALIZERS
========================================================== */

test(
    "dead-letter normalizers validate values",
    function () {
        assert.equal(
            normalizeDeadLetterId(
                " dead-letter-1 "
            ),
            "dead-letter-1"
        );

        assert.equal(
            normalizeDeadLetterSource(
                " Job Worker "
            ),
            "job-worker"
        );

        assert.equal(
            normalizeDeadLetterEvent(
                " Order Process "
            ),
            "order.process"
        );

        assert.equal(
            normalizeDeadLetterStatus(
                "PROCESSING"
            ),
            "processing"
        );

        assert.equal(
            normalizeDeadLetterPriority(
                "URGENT"
            ),
            "urgent"
        );

        assert.equal(
            normalizeDeadLetterPriority(
                "invalid"
            ),
            "normal"
        );

        assert.equal(
            normalizeWorkerId(
                " worker-1 "
            ),
            "worker-1"
        );

        assert.throws(
            function () {
                normalizeDeadLetterId(
                    "dead/letter"
                );
            },
            /dead-letter ID is invalid/
        );

        assert.throws(
            function () {
                normalizeDeadLetterEvent(
                    ""
                );
            },
            /event is invalid/
        );

        assert.throws(
            function () {
                normalizeDeadLetterStatus(
                    "unknown"
                );
            },
            /status is invalid/
        );

        assert.throws(
            function () {
                normalizeWorkerId(
                    ""
                );
            },
            /worker ID is required/
        );
    }
);

test(
    "normalizeDeadLetterTags deduplicates values",
    function () {
        assert.deepEqual(
            normalizeDeadLetterTags([
                "Orders",
                " urgent ",
                "orders",
                ""
            ]),
            [
                "orders",
                "urgent"
            ]
        );

        assert.deepEqual(
            normalizeDeadLetterTags(
                "Payments"
            ),
            [
                "payments"
            ]
        );
    }
);

test(
    "numeric normalizers validate values",
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
    }
);

test(
    "collection and date normalizers validate values",
    function () {
        assert.equal(
            normalizeCollection(
                "_deadLetters"
            ),
            "_deadLetters"
        );

        assert.equal(
            normalizeDeadLetterDate(
                1000,
                "Date"
            ),
            1000
        );

        assert.equal(
            normalizeDeadLetterOrderField(
                "priorityWeight"
            ),
            "priorityWeight"
        );

        assert.equal(
            normalizeDeadLetterOrderField(
                "invalid"
            ),
            "createdAt"
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
                normalizeCollection(
                    "internal/deadLetters"
                );
            },
            /Firestore collection name/
        );

        assert.throws(
            function () {
                normalizeDeadLetterDate(
                    "invalid",
                    "Date"
                );
            },
            /is invalid/
        );
    }
);

/* ==========================================================
   RECORD NORMALIZATION
========================================================== */

test(
    "normalizeDeadLetterRecord creates complete record",
    function () {
        const error =
            new ServiceError(
                "processing-failed",
                "Order processing failed.",
                {
                    status:
                        500,

                    retryable:
                        false
                }
            );

        const record =
            normalizeDeadLetterRecord(
                {
                    id:
                        "dead-letter-1",

                    source:
                        "jobs",

                    sourceId:
                        "job-1",

                    event:
                        "order.process",

                    priority:
                        "urgent",

                    payload: {
                        orderId:
                            "order-1"
                    },

                    error:
                        error,

                    metadata: {
                        queue:
                            "orders"
                    },

                    tags: [
                        "Orders"
                    ]
                },
                {
                    retentionMs:
                        5000
                },
                createRuntime({
                    now:
                        function () {
                            return 1000;
                        }
                })
            );

        assert.equal(
            record.id,
            "dead-letter-1"
        );

        assert.equal(
            record.source,
            "jobs"
        );

        assert.equal(
            record.sourceId,
            "job-1"
        );

        assert.equal(
            record.event,
            "order.process"
        );

        assert.equal(
            record.status,
            "pending"
        );

        assert.equal(
            record.priority,
            "urgent"
        );

        assert.equal(
            record.priorityWeight,
            400
        );

        assert.equal(
            record.claimCount,
            0
        );

        assert.equal(
            record.retryCount,
            0
        );

        assert.equal(
            record.createdAt.toMillis(),
            1000
        );

        assert.equal(
            record.availableAt.toMillis(),
            1000
        );

        assert.equal(
            record.expiresAt.toMillis(),
            6000
        );

        assert.match(
            record.fingerprint,
            /^[a-f0-9]{64}$/
        );
    }
);

test(
    "normalizeDeadLetterRecord supports alternate source fields",
    function () {
        const record =
            normalizeDeadLetterRecord(
                {
                    jobId:
                        "job-1",

                    type:
                        "catalog.refresh",

                    data: {
                        category:
                            "new-arrivals"
                    },

                    failure:
                        new Error(
                            "Refresh failed."
                        )
                },
                {
                    defaultSource:
                        "jobs"
                },
                createRuntime({
                    now:
                        function () {
                            return 1000;
                        }
                })
            );

        assert.equal(
            record.source,
            "jobs"
        );

        assert.equal(
            record.sourceId,
            "job-1"
        );

        assert.equal(
            record.event,
            "catalog.refresh"
        );

        assert.deepEqual(
            record.payload,
            {
                category:
                    "new-arrivals"
            }
        );
    }
);

/* ==========================================================
   IDENTIFIERS AND SERIALIZATION
========================================================== */

test(
    "createDeadLetterId uses custom resolver",
    function () {
        assert.equal(
            createDeadLetterId(
                {},
                {
                    idResolver:
                        function () {
                            return "custom-id";
                        }
                },
                1000
            ),
            "custom-id"
        );
    }
);

test(
    "createDeadLetterId hashes idempotency key",
    function () {
        const first =
            createDeadLetterId(
                {
                    idempotencyKey:
                        "job-1-failure"
                },
                {},
                1000
            );

        const second =
            createDeadLetterId(
                {
                    idempotencyKey:
                        "job-1-failure"
                },
                {},
                2000
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
    "generated IDs and tokens are unique",
    function () {
        const firstId =
            createDeadLetterId(
                {},
                {},
                1000
            );

        const secondId =
            createDeadLetterId(
                {},
                {},
                1000
            );

        const firstToken =
            generateLeaseToken();

        const secondToken =
            generateLeaseToken();

        assert.notEqual(
            firstId,
            secondId
        );

        assert.notEqual(
            firstToken,
            secondToken
        );
    }
);

test(
    "dead-letter fingerprints are deterministic",
    function () {
        assert.equal(
            createDeadLetterFingerprint({
                b:
                    2,

                a:
                    1
            }),
            createDeadLetterFingerprint({
                a:
                    1,

                b:
                    2
            })
        );

        assert.match(
            hashDeadLetterValue(
                "value"
            ),
            /^[a-f0-9]{64}$/
        );
    }
);

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
                bigint:
                    10n,

                buffer:
                    Buffer.from(
                        "hello"
                    ),

                date:
                    new Date(
                        "2026-07-25T08:00:00.000Z"
                    ),

                missing:
                    undefined
            }),
            {
                bigint:
                    "10",

                buffer:
                    "aGVsbG8=",

                date:
                    "2026-07-25T08:00:00.000Z",

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

test(
    "assertSerializableDeadLetterValue enforces maximum size",
    function () {
        assert.equal(
            assertSerializableDeadLetterValue(
                {
                    orderId:
                        "order-1"
                },
                1000,
                "Payload"
            ),
            true
        );

        assert.throws(
            function () {
                assertSerializableDeadLetterValue(
                    {
                        value:
                            "x".repeat(
                                100
                            )
                    },
                    10,
                    "Payload"
                );
            },
            function (
                error
            ) {
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
   CREATE
========================================================== */

test(
    "createDeadLetter stores record",
    async function () {
        const firestore =
            createFirestoreStub();

        const result =
            await createDeadLetter(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    id:
                        "dead-letter-1",

                    source:
                        "jobs",

                    sourceId:
                        "job-1",

                    event:
                        "order.process",

                    payload: {
                        orderId:
                            "order-1"
                    },

                    error:
                        new Error(
                            "Processing failed."
                        )
                },
                {
                    now:
                        function () {
                            return 1000;
                        }
                }
            );

        assert.equal(
            result.created,
            true
        );

        assert.equal(
            result.duplicate,
            false
        );

        assert.equal(
            result.disabled,
            false
        );

        assert.equal(
            firestore.hasDocument(
                deadLetterPath(
                    "dead-letter-1"
                )
            ),
            true
        );
    }
);

test(
    "createDeadLetter detects duplicate fingerprint",
    async function () {
        const runtime =
            createRuntime();

        const input = {
            id:
                "dead-letter-1",

            source:
                "jobs",

            sourceId:
                "job-1",

            event:
                "order.process",

            payload:
                {},

            error:
                new Error(
                    "Failure."
                )
        };

        const options = {
            now:
                function () {
                    return 1000;
                }
        };

        const first =
            await createDeadLetter(
                runtime,
                input,
                options
            );

        const second =
            await createDeadLetter(
                runtime,
                input,
                options
            );

        assert.equal(
            first.created,
            true
        );

        assert.equal(
            second.created,
            false
        );

        assert.equal(
            second.duplicate,
            true
        );
    }
);

test(
    "createDeadLetter rejects conflicting ID",
    async function () {
        const runtime =
            createRuntime();

        await createDeadLetter(
            runtime,
            {
                id:
                    "dead-letter-1",

                source:
                    "jobs",

                event:
                    "order.process",

                payload: {
                    version:
                        1
                },

                error:
                    new Error(
                        "Failure."
                    )
            },
            {
                now:
                    function () {
                        return 1000;
                    }
            }
        );

        await assert.rejects(
            async function () {
                await createDeadLetter(
                    runtime,
                    {
                        id:
                            "dead-letter-1",

                        source:
                            "jobs",

                        event:
                            "order.process",

                        payload: {
                            version:
                                2
                        },

                        error:
                            new Error(
                                "Different failure."
                            )
                    },
                    {
                        now:
                            function () {
                            return 1000;
                        }
                    }
                );
            },
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "already-exists"
                );

                return true;
            }
        );
    }
);

test(
    "createDeadLetter returns disabled result",
    async function () {
        const result =
            await createDeadLetter(
                null,
                {
                    id:
                        "dead-letter-1",

                    source:
                        "jobs",

                    event:
                        "order.process",

                    payload:
                        {},

                    error:
                        new Error(
                            "Failure."
                        )
                },
                {
                    disabled:
                        true,

                    now:
                        function () {
                            return 1000;
                        }
                }
            );

        assert.equal(
            result.created,
            false
        );

        assert.equal(
            result.disabled,
            true
        );

        assert.equal(
            result.deadLetter.id,
            "dead-letter-1"
        );
    }
);

/* ==========================================================
   CLAIMABILITY
========================================================== */

test(
    "isDeadLetterClaimable accepts available pending record",
    function () {
        assert.equal(
            isDeadLetterClaimable(
                createStoredDeadLetter({
                    availableAt:
                        TestTimestamp
                            .fromMillis(
                                1000
                            )
                }),
                2000
            ),
            true
        );
    }
);

test(
    "isDeadLetterClaimable rejects future record",
    function () {
        assert.equal(
            isDeadLetterClaimable(
                createStoredDeadLetter({
                    availableAt:
                        TestTimestamp
                            .fromMillis(
                                5000
                            )
                }),
                2000
            ),
            false
        );
    }
);

test(
    "isDeadLetterClaimable accepts expired processing lease",
    function () {
        assert.equal(
            isDeadLetterClaimable(
                createStoredDeadLetter({
                    status:
                        "processing",

                    leaseExpiresAt:
                        TestTimestamp
                            .fromMillis(
                                1000
                            )
                }),
                2000
            ),
            true
        );

        assert.equal(
            isDeadLetterClaimable(
                createStoredDeadLetter({
                    status:
                        "processing",

                    leaseExpiresAt:
                        TestTimestamp
                            .fromMillis(
                                5000
                            )
                }),
                2000
            ),
            false
        );
    }
);

test(
    "isDeadLetterClaimable rejects terminal records",
    function () {
        assert.equal(
            isDeadLetterClaimable(
                createStoredDeadLetter({
                    status:
                        "resolved"
                }),
                2000
            ),
            false
        );

        assert.equal(
            isDeadLetterClaimable(
                createStoredDeadLetter({
                    status:
                        "archived"
                }),
                2000
            ),
            false
        );
    }
);

test(
    "compareDeadLetterCandidates prioritises urgency",
    function () {
        const records = [
            createStoredDeadLetter({
                id:
                    "low",

                priority:
                    "low",

                priorityWeight:
                    100
            }),

            createStoredDeadLetter({
                id:
                    "urgent",

                priority:
                    "urgent",

                priorityWeight:
                    400
            }),

            createStoredDeadLetter({
                id:
                    "high",

                priority:
                    "high",

                priorityWeight:
                    300
            })
        ];

        records.sort(
            compareDeadLetterCandidates
        );

        assert.deepEqual(
            records.map(
                function (
                    record
                ) {
                    return record.id;
                }
            ),
            [
                "urgent",
                "high",
                "low"
            ]
        );
    }
);

/* ==========================================================
   CLAIM
========================================================== */

test(
    "loadDeadLetterCandidates returns stored records",
    async function () {
        const firestore =
            createFirestoreStub({
                "_deadLetters/one":
                    createStoredDeadLetter({
                        id:
                            "one"
                    }),

                "_deadLetters/two":
                    createStoredDeadLetter({
                        id:
                            "two"
                    })
            });

        const records =
            await loadDeadLetterCandidates(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    claimBatchSize:
                        10
                }
            );

        assert.equal(
            records.length,
            2
        );
    }
);

test(
    "claimDeadLetter claims available record",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    deadLetterPath(
                        "dead-letter-1"
                    )
                ]:
                    createStoredDeadLetter()
            });

        const result =
            await claimDeadLetter(
                createRuntime({
                    firestore:
                        firestore
                }),
                "dead-letter-1",
                "worker-1",
                {
                    leaseMs:
                        5000,

                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            result.status,
            "processing"
        );

        assert.equal(
            result.workerId,
            "worker-1"
        );

        assert.equal(
            result.claimCount,
            1
        );

        assert.equal(
            result.claimedAt,
            new Date(
                2000
            ).toISOString()
        );

        assert.equal(
            result.leaseExpiresAt,
            new Date(
                7000
            ).toISOString()
        );

        assert.equal(
            typeof result.leaseToken,
            "string"
        );
    }
);

test(
    "claimDeadLetter returns null for unavailable record",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    deadLetterPath(
                        "dead-letter-1"
                    )
                ]:
                    createStoredDeadLetter({
                        availableAt:
                            TestTimestamp
                                .fromMillis(
                                    5000
                                )
                    })
            });

        const result =
            await claimDeadLetter(
                createRuntime({
                    firestore:
                        firestore
                }),
                "dead-letter-1",
                "worker-1",
                {
                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            result,
            null
        );
    }
);

test(
    "claimNextDeadLetter selects highest-priority record",
    async function () {
        const firestore =
            createFirestoreStub({
                "_deadLetters/normal":
                    createStoredDeadLetter({
                        id:
                            "normal",

                        priority:
                            "normal",

                        priorityWeight:
                            200
                    }),

                "_deadLetters/urgent":
                    createStoredDeadLetter({
                        id:
                            "urgent",

                        priority:
                            "urgent",

                        priorityWeight:
                            400
                    })
            });

        const result =
            await claimNextDeadLetter(
                createRuntime({
                    firestore:
                        firestore
                }),
                "worker-1",
                {
                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            result.id,
            "urgent"
        );

        assert.equal(
            result.status,
            "processing"
        );
    }
);

test(
    "claimNextDeadLetter returns null when disabled",
    async function () {
        assert.equal(
            await claimNextDeadLetter(
                null,
                "worker-1",
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
   OWNERSHIP
========================================================== */

test(
    "assertDeadLetterOwnership validates worker and token",
    function () {
        assert.equal(
            assertDeadLetterOwnership(
                createStoredDeadLetter({
                    status:
                        "processing",

                    workerId:
                        "worker-1",

                    leaseToken:
                        "lease-1"
                }),
                "worker-1",
                "lease-1"
            ),
            true
        );

        assert.throws(
            function () {
                assertDeadLetterOwnership(
                    createStoredDeadLetter({
                        status:
                            "pending"
                    }),
                    "worker-1"
                );
            },
            /not being processed/
        );

        assert.throws(
            function () {
                assertDeadLetterOwnership(
                    createStoredDeadLetter({
                        status:
                            "processing",

                        workerId:
                            "worker-2"
                    }),
                    "worker-1"
                );
            },
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "permission-denied"
                );

                return true;
            }
        );

        assert.throws(
            function () {
                assertDeadLetterOwnership(
                    createStoredDeadLetter({
                        status:
                            "processing",

                        workerId:
                            "worker-1",

                        leaseToken:
                            "old"
                    }),
                    "worker-1",
                    "new"
                );
            },
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "aborted"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   RESOLVE
========================================================== */

test(
    "resolveDeadLetter resolves owned record",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    deadLetterPath(
                        "dead-letter-1"
                    )
                ]:
                    createStoredDeadLetter({
                        status:
                            "processing",

                        workerId:
                            "worker-1",

                        leaseToken:
                            "lease-1"
                    })
            });

        const result =
            await resolveDeadLetter(
                createRuntime({
                    firestore:
                        firestore
                }),
                "dead-letter-1",
                "worker-1",
                {
                    action:
                        "manually-corrected"
                },
                {
                    leaseToken:
                        "lease-1",

                    now:
                        function () {
                            return 3000;
                        }
                }
            );

        assert.equal(
            result.resolved,
            true
        );

        assert.equal(
            result.deadLetter.status,
            "resolved"
        );

        assert.deepEqual(
            result.deadLetter.resolution,
            {
                action:
                    "manually-corrected"
            }
        );

        assert.equal(
            result.deadLetter.resolvedAt,
            new Date(
                3000
            ).toISOString()
        );

        assert.equal(
            result.deadLetter.workerId,
            null
        );
    }
);

/* ==========================================================
   RETRY
========================================================== */

test(
    "retryDeadLetter marks successful retry resolved",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    deadLetterPath(
                        "dead-letter-1"
                    )
                ]:
                    createStoredDeadLetter({
                        status:
                            "processing",

                        retryCount:
                            1,

                        workerId:
                            "worker-1",

                        leaseToken:
                            "lease-1"
                    })
            });

        const result =
            await retryDeadLetter(
                createRuntime({
                    firestore:
                        firestore
                }),
                "dead-letter-1",
                "worker-1",
                {
                    jobId:
                        "job-retry-1"
                },
                {
                    leaseToken:
                        "lease-1",

                    now:
                        function () {
                            return 3000;
                        }
                }
            );

        assert.equal(
            result.retried,
            true
        );

        assert.equal(
            result.resolved,
            true
        );

        assert.equal(
            result.deadLetter.status,
            "resolved"
        );

        assert.equal(
            result.deadLetter.retryCount,
            2
        );

        assert.deepEqual(
            result.deadLetter.retryResult,
            {
                jobId:
                    "job-retry-1"
            }
        );

        assert.equal(
            result.deadLetter.retriedAt,
            new Date(
                3000
            ).toISOString()
        );
    }
);

/* ==========================================================
   RELEASE
========================================================== */

test(
    "releaseDeadLetter returns record to pending",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    deadLetterPath(
                        "dead-letter-1"
                    )
                ]:
                    createStoredDeadLetter({
                        status:
                            "processing",

                        workerId:
                            "worker-1",

                        leaseToken:
                            "lease-1"
                    })
            });

        const result =
            await releaseDeadLetter(
                createRuntime({
                    firestore:
                        firestore
                }),
                "dead-letter-1",
                "worker-1",
                new Error(
                    "Investigation failed."
                ),
                {
                    leaseToken:
                        "lease-1",

                    releaseDelayMs:
                        0,

                    now:
                        function () {
                            return 3000;
                        }
                }
            );

        assert.equal(
            result.released,
            true
        );

        assert.equal(
            result.deadLetter.status,
            "pending"
        );

        assert.equal(
            result.deadLetter.availableAt,
            new Date(
                3000
            ).toISOString()
        );

        assert.equal(
            result.deadLetter
                .processingError
                .message,
            "Investigation failed."
        );
    }
);

test(
    "releaseDeadLetter schedules delayed retry",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    deadLetterPath(
                        "dead-letter-1"
                    )
                ]:
                    createStoredDeadLetter({
                        status:
                            "processing",

                        workerId:
                            "worker-1",

                        leaseToken:
                            "lease-1"
                    })
            });

        const result =
            await releaseDeadLetter(
                createRuntime({
                    firestore:
                        firestore
                }),
                "dead-letter-1",
                "worker-1",
                new Error(
                    "Temporary failure."
                ),
                {
                    leaseToken:
                        "lease-1",

                    releaseDelayMs:
                        5000,

                    now:
                        function () {
                            return 3000;
                        }
                }
            );

        assert.equal(
            result.deadLetter.status,
            "retrying"
        );

        assert.equal(
            result.deadLetter.availableAt,
            new Date(
                8000
            ).toISOString()
        );
    }
);

/* ==========================================================
   ARCHIVE AND DISCARD
========================================================== */

test(
    "archiveDeadLetter archives non-terminal record",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    deadLetterPath(
                        "dead-letter-1"
                    )
                ]:
                    createStoredDeadLetter()
            });

        const result =
            await archiveDeadLetter(
                createRuntime({
                    firestore:
                        firestore
                }),
                "dead-letter-1",
                "Retained for audit.",
                {
                    now:
                        function () {
                            return 3000;
                        }
                }
            );

        assert.equal(
            result.updated,
            true
        );

        assert.equal(
            result.status,
            "archived"
        );

        assert.equal(
            result.deadLetter.archiveReason,
            "Retained for audit."
        );

        assert.equal(
            result.deadLetter.archivedAt,
            new Date(
                3000
            ).toISOString()
        );
    }
);

test(
    "discardDeadLetter discards non-terminal record",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    deadLetterPath(
                        "dead-letter-1"
                    )
                ]:
                    createStoredDeadLetter()
            });

        const result =
            await discardDeadLetter(
                createRuntime({
                    firestore:
                        firestore
                }),
                "dead-letter-1",
                "Invalid test record.",
                {
                    now:
                        function () {
                            return 3000;
                        }
                }
            );

        assert.equal(
            result.status,
            "discarded"
        );

        assert.equal(
            result.deadLetter.discardReason,
            "Invalid test record."
        );

        assert.equal(
            result.deadLetter.discardedAt,
            new Date(
                3000
            ).toISOString()
        );
    }
);

test(
    "setDeadLetterTerminalStatus rejects terminal record",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    deadLetterPath(
                        "dead-letter-1"
                    )
                ]:
                    createStoredDeadLetter({
                        status:
                            "resolved"
                    })
            });

        await assert.rejects(
            async function () {
                await setDeadLetterTerminalStatus(
                    createRuntime({
                        firestore:
                            firestore
                    }),
                    "dead-letter-1",
                    "archived",
                    "Archive.",
                    {}
                );
            },
            /terminal dead-letter record/
        );
    }
);

/* ==========================================================
   GET AND QUERY
========================================================== */

test(
    "getDeadLetter returns stored record",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    deadLetterPath(
                        "dead-letter-1"
                    )
                ]:
                    createStoredDeadLetter()
            });

        const result =
            await getDeadLetter(
                createRuntime({
                    firestore:
                        firestore
                }),
                "dead-letter-1"
            );

        assert.equal(
            result.id,
            "dead-letter-1"
        );

        assert.equal(
            result.status,
            "pending"
        );

        assert.equal(
            result.createdAt,
            new Date(
                1000
            ).toISOString()
        );
    }
);

test(
    "getDeadLetter returns null for missing or disabled record",
    async function () {
        assert.equal(
            await getDeadLetter(
                createRuntime(),
                "missing"
            ),
            null
        );

        assert.equal(
            await getDeadLetter(
                null,
                "dead-letter-1",
                {
                    disabled:
                        true
                }
            ),
            null
        );
    }
);

test(
    "normalizeDeadLetterQuery normalizes filters",
    function () {
        assert.deepEqual(
            normalizeDeadLetterQuery(
                {
                    status:
                        "PENDING",

                    source:
                        " Job Worker ",

                    event:
                        "Order Process",

                    priority:
                        "URGENT",

                    workerId:
                        " worker-1 ",

                    createdAfter:
                        1000,

                    createdBefore:
                        5000,

                    orderBy:
                        "priorityWeight",

                    direction:
                        "ASC",

                    limit:
                        25
                },
                {}
            ),
            {
                status:
                    "pending",

                source:
                    "job-worker",

                event:
                    "order.process",

                priority:
                    "urgent",

                workerId:
                    "worker-1",

                createdAfter:
                    1000,

                createdBefore:
                    5000,

                orderBy:
                    "priorityWeight",

                direction:
                    "asc",

                limit:
                    25
            }
        );
    }
);

test(
    "queryDeadLetters filters and orders records",
    async function () {
        const firestore =
            createFirestoreStub({
                "_deadLetters/one":
                    createStoredDeadLetter({
                        id:
                            "one",

                        source:
                            "jobs",

                        status:
                            "pending",

                        priority:
                            "normal",

                        priorityWeight:
                            200,

                        createdAt:
                            TestTimestamp
                                .fromMillis(
                                    1000
                                )
                    }),

                "_deadLetters/two":
                    createStoredDeadLetter({
                        id:
                            "two",

                        source:
                            "jobs",

                        status:
                            "pending",

                        priority:
                            "urgent",

                        priorityWeight:
                            400,

                        createdAt:
                            TestTimestamp
                                .fromMillis(
                                    2000
                                )
                    }),

                "_deadLetters/three":
                    createStoredDeadLetter({
                        id:
                            "three",

                        source:
                            "webhooks",

                        status:
                            "archived"
                    })
            });

        const results =
            await queryDeadLetters(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    status:
                        "pending",

                    source:
                        "jobs",

                    orderBy:
                        "createdAt",

                    direction:
                        "asc"
                },
                {}
            );

        assert.deepEqual(
            results.map(
                function (
                    record
                ) {
                    return record.id;
                }
            ),
            [
                "one",
                "two"
            ]
        );
    }
);

test(
    "queryDeadLetters returns empty list when disabled",
    async function () {
        assert.deepEqual(
            await queryDeadLetters(
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
   SANITIZATION
========================================================== */

test(
    "sanitizeDeadLetterRecord serializes timestamps",
    function () {
        const result =
            sanitizeDeadLetterRecord(
                createStoredDeadLetter({
                    resolvedAt:
                        TestTimestamp
                            .fromMillis(
                                3000
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
            result.availableAt,
            new Date(
                1000
            ).toISOString()
        );

        assert.equal(
            result.resolvedAt,
            new Date(
                3000
            ).toISOString()
        );
    }
);

test(
    "sanitizeDeadLetterMetadata preserves objects and wraps primitives",
    function () {
        assert.deepEqual(
            sanitizeDeadLetterMetadata({
                queue:
                    "orders"
            }),
            {
                queue:
                    "orders"
            }
        );

        assert.deepEqual(
            sanitizeDeadLetterMetadata(
                "orders"
            ),
            {
                value:
                    "orders"
            }
        );

        assert.deepEqual(
            sanitizeDeadLetterMetadata(
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
    "serializeDeadLetterError returns safe metadata",
    function () {
        const error =
            new ServiceError(
                "provider-error",
                "Provider unavailable.",
                {
                    status:
                        503,

                    retryable:
                        true,

                    details: {
                        provider:
                            "payments"
                    }
                }
            );

        assert.deepEqual(
            serializeDeadLetterError(
                error
            ),
            {
                name:
                    "ServiceError",

                code:
                    "provider-error",

                message:
                    "Provider unavailable.",

                status:
                    503,

                retryable:
                    true,

                details: {
                    provider:
                        "payments"
                }
            }
        );
    }
);

test(
    "dead-letter error factories create service errors",
    function () {
        const notFound =
            createDeadLetterNotFoundError(
                "dead-letter-1"
            );

        const conflict =
            createDeadLetterConflictError(
                "dead-letter-1",
                {
                    requestId:
                        "req-1",

                    correlationId:
                        "corr-1"
                }
            );

        assert.equal(
            notFound.code,
            "not-found"
        );

        assert.equal(
            notFound.status,
            404
        );

        assert.equal(
            conflict.code,
            "already-exists"
        );

        assert.equal(
            conflict.status,
            409
        );

        assert.equal(
            conflict.requestId,
            "req-1"
        );

        assert.equal(
            conflict.correlationId,
            "corr-1"
        );
    }
);

/* ==========================================================
   RUNTIME AND TIME
========================================================== */

test(
    "assertDeadLetterRuntime validates runtime",
    function () {
        assert.doesNotThrow(
            function () {
                assertDeadLetterRuntime(
                    createRuntime()
                );
            }
        );

        assert.throws(
            function () {
                assertDeadLetterRuntime(
                    null
                );
            },
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "configuration-error"
                );

                return true;
            }
        );

        assert.throws(
            function () {
                assertDeadLetterRuntime({
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

/* ==========================================================
   DISABLED OPERATIONS
========================================================== */

test(
    "resolve, retry, release, and terminal updates support disabled mode",
    async function () {
        const resolveResult =
            await resolveDeadLetter(
                null,
                "dead-letter-1",
                "worker-1",
                {},
                {
                    disabled:
                        true
                }
            );

        const retryResult =
            await retryDeadLetter(
                null,
                "dead-letter-1",
                "worker-1",
                {},
                {
                    disabled:
                        true
                }
            );

        const releaseResult =
            await releaseDeadLetter(
                null,
                "dead-letter-1",
                "worker-1",
                new Error(
                    "Failure."
                ),
                {
                    disabled:
                        true
                }
            );

        const archiveResult =
            await archiveDeadLetter(
                null,
                "dead-letter-1",
                "Reason.",
                {
                    disabled:
                        true
                }
            );

        assert.equal(
            resolveResult.disabled,
            true
        );

        assert.equal(
            retryResult.disabled,
            true
        );

        assert.equal(
            releaseResult.disabled,
            true
        );

        assert.equal(
            archiveResult.disabled,
            true
        );
    }
);

/* ==========================================================
   LOGGING
========================================================== */

test(
    "logDeadLetterEvent logs creation as error",
    function () {
        const logger =
            createLoggerStub();

        logDeadLetterEvent(
            {
                logger:
                    logger
            },
            createStoredDeadLetter(),
            "created",
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
            "error"
        );

        assert.equal(
            logger.entries[0].message,
            "Dead-letter record created."
        );
    }
);

test(
    "logDeadLetterEvent logs release as warning",
    function () {
        const logger =
            createLoggerStub();

        logDeadLetterEvent(
            {
                logger:
                    logger
            },
            createStoredDeadLetter(),
            "released",
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
            "Dead-letter processing released."
        );
    }
);

test(
    "logDeadLetterEvent logs standard events as info",
    function () {
        const logger =
            createLoggerStub();

        logDeadLetterEvent(
            {
                logger:
                    logger
            },
            createStoredDeadLetter(),
            "resolved",
            {
                log:
                    true
            }
        );

        assert.equal(
            logger.entries[0].level,
            "info"
        );

        assert.equal(
            logger.entries[0].message,
            "Dead-letter event."
        );
    }
);

test(
    "dead-letter logging can be disabled",
    function () {
        const logger =
            createLoggerStub();

        logDeadLetterEvent(
            {
                logger:
                    logger
            },
            createStoredDeadLetter(),
            "created",
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
    "dead-letter constants expose expected defaults",
    function () {
        assert.equal(
            constants
                .DEAD_LETTER_COLLECTION,
            "_deadLetters"
        );

        assert.equal(
            constants.DEFAULT_STATUS,
            "pending"
        );

        assert.equal(
            constants.DEFAULT_SOURCE,
            "unknown"
        );

        assert.equal(
            constants.DEFAULT_PRIORITY,
            "normal"
        );

        assert.equal(
            constants.DEFAULT_LEASE_MS,
            300000
        );

        assert.equal(
            constants.DEFAULT_RETENTION_MS,
            7776000000
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
            constants
                .DEFAULT_CLAIM_BATCH_SIZE,
            50
        );

        assert.deepEqual(
            constants
                .DEAD_LETTER_STATUSES,
            {
                pending:
                    "pending",

                processing:
                    "processing",

                retrying:
                    "retrying",

                resolved:
                    "resolved",

                archived:
                    "archived",

                discarded:
                    "discarded"
            }
        );

        assert.deepEqual(
            constants
                .DEAD_LETTER_PRIORITIES,
            {
                low:
                    "low",

                normal:
                    "normal",

                high:
                    "high",

                urgent:
                    "urgent"
            }
        );

        assert.equal(
            constants
                .PRIORITY_WEIGHTS
                .urgent,
            400
        );

        assert.equal(
            constants
                .TERMINAL_DEAD_LETTER_STATUSES
                .includes(
                    "resolved"
                ),
            true
        );

        assert.equal(
            Object.isFrozen(
                constants
                    .TERMINAL_DEAD_LETTER_STATUSES
            ),
            true
        );
    }
);