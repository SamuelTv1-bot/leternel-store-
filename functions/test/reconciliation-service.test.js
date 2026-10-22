"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   RECONCILIATION SERVICE TEST SUITE
========================================================== */

const test =
    require("node:test");

const assert =
    require("node:assert/strict");

const {
    createReconciliationService,
    runReconciliation,
    compareReconciliationRecords,
    groupReconciliationRecords,
    createReconciliationItem,
    persistReconciliationItems,
    createReconciliationItemRecord,
    getReconciliationRun,
    queryReconciliationRuns,
    normalizeReconciliationQuery,
    queryReconciliationItems,
    normalizeReconciliationItemQuery,
    resolveReconciliationItem,
    ignoreReconciliationItem,
    setReconciliationItemStatus,
    cancelReconciliationRun,
    normalizeReconciliationInput,
    normalizeReconciliationRecords,
    normalizeReconciliationRecord,
    createReconciliationResult,
    createReconciliationRunRecord,
    sanitizeReconciliationRunRecord,
    sanitizeReconciliationItemRecord,
    normalizeReconciliationRunId,
    normalizeReconciliationItemId,
    normalizeReconciliationKey,
    normalizeReconciliationStatus,
    normalizeReconciliationItemStatus,
    normalizeReconciliationItemType,
    normalizeReconciliationSource,
    normalizeCurrency,
    normalizeMoneyMinor,
    normalizeReconciliationRecordStatus,
    normalizeReconciliationDate,
    normalizeReconciliationOrderField,
    normalizeReconciliationItemOrderField,
    normalizeQueryLimit,
    normalizeBatchSize,
    normalizePositiveInteger,
    normalizeNonNegativeInteger,
    normalizeInteger,
    normalizeOptionalString,
    normalizeCollection,
    normalizeReconciliationOptions,
    createReconciliationRunId,
    createReconciliationItemId,
    createPersistedReconciliationItemId,
    hashReconciliationValue,
    stableStringify,
    normalizeStableValue,
    assertSerializableReconciliationValue,
    sanitizeReconciliationMetadata,
    serializeReconciliationError,
    createReconciliationRunNotFoundError,
    createReconciliationItemNotFoundError,
    assertReconciliationRuntime,
    resolveNow,
    createDatabaseTimestamp,
    toMilliseconds,
    serializeTimestamp,
    calculateDuration,
    logReconciliationEvent,
    logReconciliationItemEvent,
    constants
} = require(
    "../src/shared/reconciliation-service"
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
                clone(
                    value
                )
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
                                  clone(
                                      value
                                  )
                              )
                            : clone(
                                  value
                              );

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
                                    left <
                                    right
                                ) {
                                    return -1 *
                                        multiplier;
                                }

                                if (
                                    left >
                                    right
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

                return result;
            },

        batch:
            function () {
                const writes =
                    [];

                return {
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

                    commit:
                        async function () {
                            for (
                                const write of
                                writes
                            ) {
                                await write.reference.set(
                                    write.value,
                                    write.options
                                );
                            }
                        }
                };
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
            },

        count:
            function (
                collectionName
            ) {
                return Array.from(
                    documents.keys()
                ).filter(
                    function (
                        path
                    ) {
                        return path
                            .startsWith(
                                collectionName +
                                "/"
                            );
                    }
                ).length;
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

function reconciliationPath(
    id
) {
    return (
        constants
            .RECONCILIATION_COLLECTION +
        "/" +
        id
    );
}

function reconciliationItemPath(
    id
) {
    return (
        constants
            .RECONCILIATION_ITEM_COLLECTION +
        "/" +
        id
    );
}

function createStoredReconciliationRun(
    overrides
) {
    return Object.assign(
        {
            id:
                "run-1",

            status:
                "completed",

            disabled:
                false,

            dryRun:
                false,

            source:
                "payments",

            currency:
                "GBP",

            periodStart:
                TestTimestamp
                    .fromMillis(
                        1000
                    ),

            periodEnd:
                TestTimestamp
                    .fromMillis(
                        2000
                    ),

            internalCount:
                2,

            externalCount:
                2,

            matchedCount:
                2,

            discrepancyCount:
                0,

            missingInternalCount:
                0,

            missingExternalCount:
                0,

            amountMismatchCount:
                0,

            currencyMismatchCount:
                0,

            statusMismatchCount:
                0,

            duplicateInternalCount:
                0,

            duplicateExternalCount:
                0,

            internalTotalMinor:
                5000,

            externalTotalMinor:
                5000,

            differenceMinor:
                0,

            metadata:
                {},

            error:
                null,

            cancellationReason:
                null,

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

            cancelledAt:
                null,

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
                        10000
                    ),

            schemaVersion:
                1
        },
        overrides || {}
    );
}

function createStoredReconciliationItem(
    overrides
) {
    return Object.assign(
        {
            id:
                "item-1",

            runId:
                "run-1",

            key:
                "payment-1",

            type:
                "amount-mismatch",

            status:
                "open",

            internalRecord: {
                key:
                    "payment-1",

                amountMinor:
                    2000,

                currency:
                    "GBP",

                status:
                    "captured"
            },

            externalRecord: {
                key:
                    "payment-1",

                amountMinor:
                    1800,

                currency:
                    "GBP",

                status:
                    "captured"
            },

            internalRecords:
                [],

            externalRecords:
                [],

            amountDifferenceMinor:
                200,

            resolution:
                null,

            ignoreReason:
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

            resolvedAt:
                null,

            ignoredAt:
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
    "createReconciliationService creates a frozen service",
    function () {
        const runtime =
            createRuntime();

        const service =
            createReconciliationService({
                runtime:
                    runtime,

                defaultCurrency:
                    "GBP"
            });

        assert.equal(
            service.runtime,
            runtime
        );

        assert.equal(
            service.options.defaultCurrency,
            "GBP"
        );

        assert.equal(
            typeof service.run,
            "function"
        );

        assert.equal(
            typeof service.compare,
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
            typeof service.items,
            "function"
        );

        assert.equal(
            typeof service.resolve,
            "function"
        );

        assert.equal(
            typeof service.ignore,
            "function"
        );

        assert.equal(
            typeof service.cancel,
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
    "normalizeReconciliationOptions applies defaults",
    function () {
        const options =
            normalizeReconciliationOptions(
                {}
            );

        assert.equal(
            options.collection,
            "_reconciliationRuns"
        );

        assert.equal(
            options.itemCollection,
            "_reconciliationItems"
        );

        assert.equal(
            options.defaultSource,
            "payments"
        );

        assert.equal(
            options.defaultCurrency,
            "GBP"
        );

        assert.equal(
            options.toleranceMinor,
            0
        );

        assert.equal(
            options.queryLimit,
            100
        );

        assert.equal(
            options.batchSize,
            100
        );

        assert.equal(
            options.maxRecords,
            10000
        );

        assert.equal(
            options.retentionMs,
            7776000000
        );

        assert.equal(
            options.maxMetadataBytes,
            100000
        );

        assert.equal(
            options.compareStatus,
            true
        );

        assert.equal(
            options.includeMatches,
            false
        );

        assert.equal(
            options.persistRuns,
            true
        );

        assert.equal(
            options.persistItems,
            true
        );

        assert.equal(
            options.returnFailures,
            true
        );
    }
);

/* ==========================================================
   NORMALIZERS
========================================================== */

test(
    "reconciliation identifier normalizers validate values",
    function () {
        assert.equal(
            normalizeReconciliationRunId(
                " run-1 "
            ),
            "run-1"
        );

        assert.equal(
            normalizeReconciliationItemId(
                " item-1 "
            ),
            "item-1"
        );

        assert.equal(
            normalizeReconciliationKey(
                " payment-1 "
            ),
            "payment-1"
        );

        assert.throws(
            function () {
                normalizeReconciliationRunId(
                    "runs/one"
                );
            },
            /run ID is invalid/
        );

        assert.throws(
            function () {
                normalizeReconciliationItemId(
                    ""
                );
            },
            /item ID is invalid/
        );

        assert.throws(
            function () {
                normalizeReconciliationKey(
                    ""
                );
            },
            /record key is required/
        );
    }
);

test(
    "status, type, source, and currency normalizers work",
    function () {
        assert.equal(
            normalizeReconciliationStatus(
                "COMPLETED"
            ),
            "completed"
        );

        assert.equal(
            normalizeReconciliationItemStatus(
                "RESOLVED"
            ),
            "resolved"
        );

        assert.equal(
            normalizeReconciliationItemType(
                "amount-mismatch"
            ),
            "amount-mismatch"
        );

        assert.equal(
            normalizeReconciliationSource(
                " Payment Provider "
            ),
            "payment-provider"
        );

        assert.equal(
            normalizeCurrency(
                "gbp"
            ),
            "GBP"
        );

        assert.throws(
            function () {
                normalizeCurrency(
                    "pounds"
                );
            },
            /currency is invalid/
        );

        assert.throws(
            function () {
                normalizeReconciliationItemType(
                    "unknown"
                );
            },
            /item type is invalid/
        );
    }
);

test(
    "money and integer normalizers validate values",
    function () {
        assert.equal(
            normalizeMoneyMinor(
                1250,
                "Amount"
            ),
            1250
        );

        assert.equal(
            normalizeInteger(
                -200,
                0,
                "Difference"
            ),
            -200
        );

        assert.equal(
            normalizeNonNegativeInteger(
                0,
                1,
                "Count"
            ),
            0
        );

        assert.equal(
            normalizePositiveInteger(
                5,
                1,
                "Value"
            ),
            5
        );

        assert.throws(
            function () {
                normalizeMoneyMinor(
                    12.5,
                    "Amount"
                );
            },
            /minor currency units/
        );
    }
);

test(
    "query and batch limits apply maximums",
    function () {
        assert.equal(
            normalizeQueryLimit(
                1000
            ),
            500
        );

        assert.equal(
            normalizeBatchSize(
                1000
            ),
            500
        );
    }
);

/* ==========================================================
   RECORD NORMALIZATION
========================================================== */

test(
    "normalizeReconciliationRecord creates standard record",
    function () {
        const record =
            normalizeReconciliationRecord(
                {
                    paymentId:
                        "payment-1",

                    amountMinor:
                        2500,

                    currency:
                        "gbp",

                    status:
                        "Captured",

                    occurredAt:
                        1000,

                    metadata: {
                        orderId:
                            "order-1"
                    }
                },
                "internal",
                0,
                normalizeReconciliationOptions(
                    {}
                )
            );

        assert.equal(
            record.key,
            "payment-1"
        );

        assert.equal(
            record.amountMinor,
            2500
        );

        assert.equal(
            record.currency,
            "GBP"
        );

        assert.equal(
            record.status,
            "captured"
        );

        assert.equal(
            record.occurredAt,
            1000
        );
    }
);

test(
    "normalizeReconciliationRecords enforces record maximum",
    function () {
        assert.throws(
            function () {
                normalizeReconciliationRecords(
                    [
                        {
                            id:
                                "one",

                            amountMinor:
                                100
                        },
                        {
                            id:
                                "two",

                            amountMinor:
                                200
                        }
                    ],
                    "internal",
                    normalizeReconciliationOptions({
                        maxRecords:
                            1
                    })
                );
            },
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "resource-exhausted"
                );

                return true;
            }
        );
    }
);

test(
    "normalizeReconciliationInput supports aliases",
    function () {
        const input =
            normalizeReconciliationInput(
                {
                    id:
                        "run-1",

                    source:
                        "stripe",

                    currency:
                        "GBP",

                    internal: [
                        {
                            id:
                                "payment-1",

                            amountMinor:
                                1000
                        }
                    ],

                    external: [
                        {
                            id:
                                "payment-1",

                            amountMinor:
                                1000
                        }
                    ]
                },
                {}
            );

        assert.equal(
            input.id,
            "run-1"
        );

        assert.equal(
            input.source,
            "stripe"
        );

        assert.equal(
            input.internalRecords.length,
            1
        );

        assert.equal(
            input.externalRecords.length,
            1
        );
    }
);

/* ==========================================================
   COMPARISON
========================================================== */

test(
    "compareReconciliationRecords matches equal records",
    function () {
        const result =
            compareReconciliationRecords(
                [
                    {
                        id:
                            "payment-1",

                        amountMinor:
                            2500,

                        currency:
                            "GBP",

                        status:
                            "captured"
                    }
                ],
                [
                    {
                        id:
                            "payment-1",

                        amountMinor:
                            2500,

                        currency:
                            "GBP",

                        status:
                            "captured"
                    }
                ],
                {}
            );

        assert.equal(
            result.matchedCount,
            1
        );

        assert.equal(
            result.discrepancyCount,
            0
        );

        assert.equal(
            result.internalTotalMinor,
            2500
        );

        assert.equal(
            result.externalTotalMinor,
            2500
        );

        assert.equal(
            result.differenceMinor,
            0
        );
    }
);

test(
    "compareReconciliationRecords detects missing records",
    function () {
        const result =
            compareReconciliationRecords(
                [
                    {
                        id:
                            "internal-only",

                        amountMinor:
                            1000,

                        currency:
                            "GBP"
                    }
                ],
                [
                    {
                        id:
                            "external-only",

                        amountMinor:
                            2000,

                        currency:
                            "GBP"
                    }
                ],
                {}
            );

        assert.equal(
            result.missingInternalCount,
            1
        );

        assert.equal(
            result.missingExternalCount,
            1
        );

        assert.equal(
            result.discrepancyCount,
            2
        );
    }
);

test(
    "compareReconciliationRecords detects amount mismatch",
    function () {
        const result =
            compareReconciliationRecords(
                [
                    {
                        id:
                            "payment-1",

                        amountMinor:
                            2500,

                        currency:
                            "GBP"
                    }
                ],
                [
                    {
                        id:
                            "payment-1",

                        amountMinor:
                            2300,

                        currency:
                            "GBP"
                    }
                ],
                {}
            );

        assert.equal(
            result.amountMismatchCount,
            1
        );

        assert.equal(
            result.items[0].type,
            "amount-mismatch"
        );

        assert.equal(
            result.items[0]
                .amountDifferenceMinor,
            200
        );
    }
);

test(
    "compareReconciliationRecords honours tolerance",
    function () {
        const result =
            compareReconciliationRecords(
                [
                    {
                        id:
                            "payment-1",

                        amountMinor:
                            2500,

                        currency:
                            "GBP"
                    }
                ],
                [
                    {
                        id:
                            "payment-1",

                        amountMinor:
                            2499,

                        currency:
                            "GBP"
                    }
                ],
                {
                    toleranceMinor:
                        1
                }
            );

        assert.equal(
            result.matchedCount,
            1
        );

        assert.equal(
            result.amountMismatchCount,
            0
        );
    }
);

test(
    "compareReconciliationRecords detects currency mismatch",
    function () {
        const result =
            compareReconciliationRecords(
                [
                    {
                        id:
                            "payment-1",

                        amountMinor:
                            2500,

                        currency:
                            "GBP"
                    }
                ],
                [
                    {
                        id:
                            "payment-1",

                        amountMinor:
                            2500,

                        currency:
                            "EUR"
                    }
                ],
                {}
            );

        assert.equal(
            result.currencyMismatchCount,
            1
        );

        assert.equal(
            result.items[0].type,
            "currency-mismatch"
        );
    }
);

test(
    "compareReconciliationRecords detects status mismatch",
    function () {
        const result =
            compareReconciliationRecords(
                [
                    {
                        id:
                            "payment-1",

                        amountMinor:
                            2500,

                        currency:
                            "GBP",

                        status:
                            "captured"
                    }
                ],
                [
                    {
                        id:
                            "payment-1",

                        amountMinor:
                            2500,

                        currency:
                            "GBP",

                        status:
                            "refunded"
                    }
                ],
                {}
            );

        assert.equal(
            result.statusMismatchCount,
            1
        );
    }
);

test(
    "compareReconciliationRecords detects duplicates",
    function () {
        const result =
            compareReconciliationRecords(
                [
                    {
                        id:
                            "payment-1",

                        amountMinor:
                            1000
                    },
                    {
                        id:
                            "payment-1",

                        amountMinor:
                            1000
                    }
                ],
                [
                    {
                        id:
                            "payment-2",

                        amountMinor:
                            2000
                    },
                    {
                        id:
                            "payment-2",

                        amountMinor:
                            2000
                    }
                ],
                {}
            );

        assert.equal(
            result.duplicateInternalCount,
            1
        );

        assert.equal(
            result.duplicateExternalCount,
            1
        );

        assert.equal(
            result.discrepancyCount,
            2
        );
    }
);

test(
    "includeMatches includes matched item",
    function () {
        const result =
            compareReconciliationRecords(
                [
                    {
                        id:
                            "payment-1",

                        amountMinor:
                            1000
                    }
                ],
                [
                    {
                        id:
                            "payment-1",

                        amountMinor:
                            1000
                    }
                ],
                {
                    includeMatches:
                        true
                }
            );

        assert.equal(
            result.items.length,
            1
        );

        assert.equal(
            result.items[0].type,
            "matched"
        );
    }
);

/* ==========================================================
   GROUPS AND ITEMS
========================================================== */

test(
    "groupReconciliationRecords groups by key",
    function () {
        const groups =
            groupReconciliationRecords([
                {
                    key:
                        "one"
                },
                {
                    key:
                        "one"
                },
                {
                    key:
                        "two"
                }
            ]);

        assert.equal(
            groups.get(
                "one"
            ).length,
            2
        );

        assert.equal(
            groups.get(
                "two"
            ).length,
            1
        );
    }
);

test(
    "createReconciliationItem creates discrepancy item",
    function () {
        const item =
            createReconciliationItem({
                key:
                    "payment-1",

                type:
                    "amount-mismatch",

                internalRecord: {
                    amountMinor:
                        2500
                },

                externalRecord: {
                    amountMinor:
                        2300
                }
            });

        assert.equal(
            item.key,
            "payment-1"
        );

        assert.equal(
            item.status,
            "open"
        );

        assert.equal(
            item.amountDifferenceMinor,
            200
        );

        assert.match(
            item.id,
            /^[a-f0-9]{64}$/
        );
    }
);

/* ==========================================================
   RUN RECONCILIATION
========================================================== */

test(
    "runReconciliation completes matched run",
    async function () {
        const firestore =
            createFirestoreStub();

        const result =
            await runReconciliation(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    id:
                        "run-1",

                    currency:
                        "GBP",

                    internalRecords: [
                        {
                            id:
                                "payment-1",

                            amountMinor:
                                2500,

                            currency:
                                "GBP",

                            status:
                                "captured"
                        }
                    ],

                    externalRecords: [
                        {
                            id:
                                "payment-1",

                            amountMinor:
                                2500,

                            currency:
                                "GBP",

                            status:
                                "captured"
                        }
                    ]
                },
                {
                    now:
                        function () {
                            return 5000;
                        }
                }
            );

        assert.equal(
            result.status,
            "completed"
        );

        assert.equal(
            result.matchedCount,
            1
        );

        assert.equal(
            result.discrepancyCount,
            0
        );

        assert.equal(
            firestore.hasDocument(
                reconciliationPath(
                    "run-1"
                )
            ),
            true
        );
    }
);

test(
    "runReconciliation returns partial result for discrepancies",
    async function () {
        const firestore =
            createFirestoreStub();

        const result =
            await runReconciliation(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    id:
                        "run-1",

                    internalRecords: [
                        {
                            id:
                                "payment-1",

                            amountMinor:
                                2500
                        }
                    ],

                    externalRecords: [
                        {
                            id:
                                "payment-1",

                            amountMinor:
                                2000
                        }
                    ]
                },
                {
                    now:
                        function () {
                            return 5000;
                        }
                }
            );

        assert.equal(
            result.status,
            "partial"
        );

        assert.equal(
            result.amountMismatchCount,
            1
        );

        assert.equal(
            firestore.count(
                constants
                    .RECONCILIATION_ITEM_COLLECTION
            ),
            1
        );
    }
);

test(
    "runReconciliation dry run does not persist items",
    async function () {
        const firestore =
            createFirestoreStub();

        const result =
            await runReconciliation(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    id:
                        "run-1",

                    internalRecords: [
                        {
                            id:
                                "payment-1",

                            amountMinor:
                                2500
                        }
                    ],

                    externalRecords:
                        []
                },
                {
                    dryRun:
                        true,

                    now:
                        function () {
                            return 5000;
                        }
                }
            );

        assert.equal(
            result.dryRun,
            true
        );

        assert.equal(
            result.discrepancyCount,
            1
        );

        assert.equal(
            firestore.count(
                constants
                    .RECONCILIATION_ITEM_COLLECTION
            ),
            0
        );
    }
);

test(
    "runReconciliation returns disabled result",
    async function () {
        const result =
            await runReconciliation(
                null,
                {
                    id:
                        "run-1",

                    internalRecords:
                        [],

                    externalRecords:
                        []
                },
                {
                    disabled:
                        true,

                    now:
                        function () {
                            return 5000;
                        }
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
    }
);

/* ==========================================================
   ITEM PERSISTENCE
========================================================== */

test(
    "persistReconciliationItems stores items",
    async function () {
        const firestore =
            createFirestoreStub();

        const runtime =
            createRuntime({
                firestore:
                    firestore
            });

        const item =
            createReconciliationItem({
                key:
                    "payment-1",

                type:
                    "missing-external",

                internalRecord: {
                    key:
                        "payment-1",

                    amountMinor:
                        1000
                }
            });

        const written =
            await persistReconciliationItems(
                runtime,
                "run-1",
                [
                    item
                ],
                {
                    batchSize:
                        100,

                    retentionMs:
                        5000,

                    now:
                        function () {
                            return 1000;
                        }
                }
            );

        assert.equal(
            written,
            1
        );

        const persistedId =
            createPersistedReconciliationItemId(
                "run-1",
                item.id
            );

        assert.equal(
            firestore.hasDocument(
                reconciliationItemPath(
                    persistedId
                )
            ),
            true
        );
    }
);

test(
    "createReconciliationItemRecord creates Firestore record",
    function () {
        const item =
            createReconciliationItem({
                key:
                    "payment-1",

                type:
                    "amount-mismatch",

                internalRecord: {
                    amountMinor:
                        2500
                },

                externalRecord: {
                    amountMinor:
                        2300
                }
            });

        const record =
            createReconciliationItemRecord(
                "run-1",
                item,
                createRuntime({
                    now:
                        function () {
                            return 1000;
                        }
                }),
                {
                    retentionMs:
                        5000,

                    now:
                        function () {
                            return 1000;
                        }
                }
            );

        assert.equal(
            record.runId,
            "run-1"
        );

        assert.equal(
            record.type,
            "amount-mismatch"
        );

        assert.equal(
            record.createdAt.toMillis(),
            1000
        );

        assert.equal(
            record.expiresAt.toMillis(),
            6000
        );
    }
);

/* ==========================================================
   GET AND QUERY RUNS
========================================================== */

test(
    "getReconciliationRun returns stored run",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    reconciliationPath(
                        "run-1"
                    )
                ]:
                    createStoredReconciliationRun()
            });

        const result =
            await getReconciliationRun(
                createRuntime({
                    firestore:
                        firestore
                }),
                "run-1"
            );

        assert.equal(
            result.id,
            "run-1"
        );

        assert.equal(
            result.currency,
            "GBP"
        );

        assert.equal(
            result.startedAt,
            new Date(
                1000
            ).toISOString()
        );
    }
);

test(
    "getReconciliationRun returns null for missing record",
    async function () {
        assert.equal(
            await getReconciliationRun(
                createRuntime(),
                "missing"
            ),
            null
        );
    }
);

test(
    "normalizeReconciliationQuery normalizes filters",
    function () {
        assert.deepEqual(
            normalizeReconciliationQuery(
                {
                    status:
                        "COMPLETED",

                    currency:
                        "gbp",

                    source:
                        " Payment Provider ",

                    startedAfter:
                        1000,

                    startedBefore:
                        5000,

                    orderBy:
                        "differenceMinor",

                    direction:
                        "ASC",

                    limit:
                        25
                },
                {}
            ),
            {
                status:
                    "completed",

                currency:
                    "GBP",

                source:
                    "payment-provider",

                startedAfter:
                    1000,

                startedBefore:
                    5000,

                orderBy:
                    "differenceMinor",

                direction:
                    "asc",

                limit:
                    25
            }
        );
    }
);

test(
    "queryReconciliationRuns filters records",
    async function () {
        const firestore =
            createFirestoreStub({
                "_reconciliationRuns/one":
                    createStoredReconciliationRun({
                        id:
                            "one",

                        status:
                            "completed",

                        currency:
                            "GBP",

                        startedAt:
                            TestTimestamp
                                .fromMillis(
                                    1000
                                )
                    }),

                "_reconciliationRuns/two":
                    createStoredReconciliationRun({
                        id:
                            "two",

                        status:
                            "completed",

                        currency:
                            "GBP",

                        startedAt:
                            TestTimestamp
                                .fromMillis(
                                    2000
                                )
                    }),

                "_reconciliationRuns/three":
                    createStoredReconciliationRun({
                        id:
                            "three",

                        status:
                            "failed",

                        currency:
                            "EUR"
                    })
            });

        const results =
            await queryReconciliationRuns(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    status:
                        "completed",

                    currency:
                        "GBP",

                    orderBy:
                        "startedAt",

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

/* ==========================================================
   QUERY ITEMS
========================================================== */

test(
    "normalizeReconciliationItemQuery normalizes filters",
    function () {
        assert.deepEqual(
            normalizeReconciliationItemQuery(
                {
                    runId:
                        "run-1",

                    status:
                        "OPEN",

                    type:
                        "amount-mismatch",

                    orderBy:
                        "amountDifferenceMinor",

                    direction:
                        "DESC",

                    limit:
                        25
                },
                {}
            ),
            {
                runId:
                    "run-1",

                status:
                    "open",

                type:
                    "amount-mismatch",

                orderBy:
                    "amountDifferenceMinor",

                direction:
                    "desc",

                limit:
                    25
            }
        );
    }
);

test(
    "queryReconciliationItems filters records",
    async function () {
        const firestore =
            createFirestoreStub({
                "_reconciliationItems/one":
                    createStoredReconciliationItem({
                        id:
                            "one",

                        runId:
                            "run-1",

                        status:
                            "open",

                        type:
                            "amount-mismatch"
                    }),

                "_reconciliationItems/two":
                    createStoredReconciliationItem({
                        id:
                            "two",

                        runId:
                            "run-1",

                        status:
                            "resolved",

                        type:
                            "missing-external"
                    })
            });

        const results =
            await queryReconciliationItems(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    runId:
                        "run-1",

                    status:
                        "open",

                    type:
                        "amount-mismatch"
                },
                {}
            );

        assert.equal(
            results.length,
            1
        );

        assert.equal(
            results[0].id,
            "one"
        );
    }
);

/* ==========================================================
   RESOLVE AND IGNORE
========================================================== */

test(
    "resolveReconciliationItem resolves open item",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    reconciliationItemPath(
                        "item-1"
                    )
                ]:
                    createStoredReconciliationItem()
            });

        const result =
            await resolveReconciliationItem(
                createRuntime({
                    firestore:
                        firestore
                }),
                "item-1",
                {
                    action:
                        "refund-adjusted"
                },
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
            "resolved"
        );

        assert.deepEqual(
            result.item.resolution,
            {
                action:
                    "refund-adjusted"
            }
        );

        assert.equal(
            result.item.resolvedAt,
            new Date(
                3000
            ).toISOString()
        );
    }
);

test(
    "ignoreReconciliationItem ignores open item",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    reconciliationItemPath(
                        "item-1"
                    )
                ]:
                    createStoredReconciliationItem()
            });

        const result =
            await ignoreReconciliationItem(
                createRuntime({
                    firestore:
                        firestore
                }),
                "item-1",
                "Known provider rounding.",
                {
                    now:
                        function () {
                            return 3000;
                        }
                }
            );

        assert.equal(
            result.status,
            "ignored"
        );

        assert.equal(
            result.item.ignoreReason,
            "Known provider rounding."
        );

        assert.equal(
            result.item.ignoredAt,
            new Date(
                3000
            ).toISOString()
        );
    }
);

test(
    "setReconciliationItemStatus rejects closed item",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    reconciliationItemPath(
                        "item-1"
                    )
                ]:
                    createStoredReconciliationItem({
                        status:
                            "resolved"
                    })
            });

        await assert.rejects(
            async function () {
                await setReconciliationItemStatus(
                    createRuntime({
                        firestore:
                            firestore
                    }),
                    "item-1",
                    "ignored",
                    {
                        ignoreReason:
                            "Ignore."
                    },
                    {}
                );
            },
            /closed reconciliation item/
        );
    }
);

/* ==========================================================
   CANCEL
========================================================== */

test(
    "cancelReconciliationRun cancels active run",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    reconciliationPath(
                        "run-1"
                    )
                ]:
                    createStoredReconciliationRun({
                        status:
                            "running",

                        completedAt:
                            null
                    })
            });

        const result =
            await cancelReconciliationRun(
                createRuntime({
                    firestore:
                        firestore
                }),
                "run-1",
                "Cancelled by administrator.",
                {
                    now:
                        function () {
                            return 3000;
                        }
                }
            );

        assert.equal(
            result.cancelled,
            true
        );

        assert.equal(
            result.reconciliation.status,
            "cancelled"
        );

        assert.equal(
            result.reconciliation
                .cancellationReason,
            "Cancelled by administrator."
        );
    }
);

test(
    "cancelReconciliationRun rejects terminal run",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    reconciliationPath(
                        "run-1"
                    )
                ]:
                    createStoredReconciliationRun({
                        status:
                            "completed"
                    })
            });

        await assert.rejects(
            async function () {
                await cancelReconciliationRun(
                    createRuntime({
                        firestore:
                            firestore
                    }),
                    "run-1",
                    "Cancel.",
                    {}
                );
            },
            /terminal reconciliation run/
        );
    }
);

/* ==========================================================
   RESULTS AND SANITIZATION
========================================================== */

test(
    "createReconciliationResult creates summary",
    function () {
        const result =
            createReconciliationResult({
                id:
                    "run-1",

                status:
                    "partial",

                currency:
                    "GBP",

                internalCount:
                    2,

                externalCount:
                    2,

                matchedCount:
                    1,

                discrepancyCount:
                    1,

                internalTotalMinor:
                    5000,

                externalTotalMinor:
                    4800,

                differenceMinor:
                    200,

                startedAt:
                    1000,

                completedAt:
                    3000
            });

        assert.equal(
            result.id,
            "run-1"
        );

        assert.equal(
            result.status,
            "partial"
        );

        assert.equal(
            result.currency,
            "GBP"
        );

        assert.equal(
            result.differenceMinor,
            200
        );

        assert.equal(
            result.durationMs,
            2000
        );
    }
);

test(
    "createReconciliationRunRecord creates Firestore record",
    function () {
        const record =
            createReconciliationRunRecord(
                {
                    id:
                        "run-1",

                    status:
                        "completed",

                    currency:
                        "GBP",

                    startedAt:
                        1000,

                    completedAt:
                        2000
                },
                createRuntime({
                    now:
                        function () {
                            return 2000;
                        }
                }),
                {
                    retentionMs:
                        5000,

                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            record.id,
            "run-1"
        );

        assert.equal(
            record.startedAt.toMillis(),
            1000
        );

        assert.equal(
            record.completedAt.toMillis(),
            2000
        );

        assert.equal(
            record.expiresAt.toMillis(),
            7000
        );
    }
);

test(
    "sanitizeReconciliationRunRecord serializes timestamps",
    function () {
        const result =
            sanitizeReconciliationRunRecord(
                createStoredReconciliationRun()
            );

        assert.equal(
            result.startedAt,
            new Date(
                1000
            ).toISOString()
        );

        assert.equal(
            result.completedAt,
            new Date(
                2000
            ).toISOString()
        );

        assert.equal(
            result.expiresAt,
            new Date(
                10000
            ).toISOString()
        );
    }
);

test(
    "sanitizeReconciliationItemRecord serializes timestamps",
    function () {
        const result =
            sanitizeReconciliationItemRecord(
                createStoredReconciliationItem({
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
            result.resolvedAt,
            new Date(
                3000
            ).toISOString()
        );
    }
);

/* ==========================================================
   IDS AND SERIALIZATION
========================================================== */

test(
    "reconciliation identifiers are deterministic where expected",
    function () {
        assert.notEqual(
            createReconciliationRunId(
                1000
            ),
            createReconciliationRunId(
                1000
            )
        );

        assert.equal(
            createReconciliationItemId(
                "payment-1",
                "amount-mismatch"
            ),
            createReconciliationItemId(
                "payment-1",
                "amount-mismatch"
            )
        );

        assert.equal(
            createPersistedReconciliationItemId(
                "run-1",
                "item-1"
            ),
            createPersistedReconciliationItemId(
                "run-1",
                "item-1"
            )
        );

        assert.match(
            hashReconciliationValue(
                "value"
            ),
            /^[a-f0-9]{64}$/
        );
    }
);

test(
    "stable serialization supports special values",
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

        assert.deepEqual(
            normalizeStableValue({
                amount:
                    10n,

                missing:
                    undefined
            }),
            {
                amount:
                    "10",

                missing:
                    null
            }
        );
    }
);

test(
    "assertSerializableReconciliationValue enforces size",
    function () {
        assert.equal(
            assertSerializableReconciliationValue(
                {
                    reference:
                        "payment-1"
                },
                1000,
                "Metadata"
            ),
            true
        );

        assert.throws(
            function () {
                assertSerializableReconciliationValue(
                    {
                        value:
                            "x".repeat(
                                100
                            )
                    },
                    10,
                    "Metadata"
                );
            },
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "resource-exhausted"
                );

                return true;
            }
        );
    }
);

test(
    "sanitizeReconciliationMetadata normalizes metadata",
    function () {
        assert.deepEqual(
            sanitizeReconciliationMetadata(
                {
                    provider:
                        "stripe"
                },
                {
                    maxMetadataBytes:
                        1000
                }
            ),
            {
                provider:
                    "stripe"
            }
        );

        assert.deepEqual(
            sanitizeReconciliationMetadata(
                "stripe",
                {
                    maxMetadataBytes:
                        1000
                }
            ),
            {
                value:
                    "stripe"
            }
        );
    }
);

/* ==========================================================
   ERRORS
========================================================== */

test(
    "serializeReconciliationError returns safe metadata",
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
            serializeReconciliationError(
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
    "reconciliation error factories create service errors",
    function () {
        const runError =
            createReconciliationRunNotFoundError(
                "run-1"
            );

        const itemError =
            createReconciliationItemNotFoundError(
                "item-1"
            );

        assert.equal(
            runError.code,
            "not-found"
        );

        assert.equal(
            runError.status,
            404
        );

        assert.equal(
            itemError.code,
            "not-found"
        );

        assert.equal(
            itemError.status,
            404
        );
    }
);

/* ==========================================================
   RUNTIME AND TIME
========================================================== */

test(
    "assertReconciliationRuntime validates runtime",
    function () {
        assert.doesNotThrow(
            function () {
                assertReconciliationRuntime(
                    createRuntime()
                );
            }
        );

        assert.throws(
            function () {
                assertReconciliationRuntime(
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
    }
);

test(
    "timestamp and duration helpers work",
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
            serializeTimestamp(
                timestamp
            ),
            new Date(
                1000
            ).toISOString()
        );

        assert.equal(
            calculateDuration(
                1000,
                3000
            ),
            2000
        );

        assert.equal(
            calculateDuration(
                3000,
                1000
            ),
            0
        );
    }
);

/* ==========================================================
   LOGGING
========================================================== */

test(
    "logReconciliationEvent logs completed run",
    function () {
        const logger =
            createLoggerStub();

        logReconciliationEvent(
            {
                logger:
                    logger
            },
            {
                id:
                    "run-1",

                status:
                    "completed"
            },
            "completed",
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
            "Reconciliation event."
        );
    }
);

test(
    "logReconciliationEvent logs partial run as warning",
    function () {
        const logger =
            createLoggerStub();

        logReconciliationEvent(
            {
                logger:
                    logger
            },
            {
                id:
                    "run-1",

                status:
                    "partial"
            },
            "completed",
            {
                log:
                    true
            }
        );

        assert.equal(
            logger.entries[0].level,
            "warn"
        );
    }
);

test(
    "logReconciliationEvent logs failure as error",
    function () {
        const logger =
            createLoggerStub();

        logReconciliationEvent(
            {
                logger:
                    logger
            },
            {
                id:
                    "run-1",

                status:
                    "failed"
            },
            "failed",
            {
                log:
                    true
            }
        );

        assert.equal(
            logger.entries[0].level,
            "error"
        );
    }
);

test(
    "logReconciliationItemEvent logs item update",
    function () {
        const logger =
            createLoggerStub();

        logReconciliationItemEvent(
            {
                logger:
                    logger
            },
            createStoredReconciliationItem(),
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
            "Reconciliation item event."
        );
    }
);

/* ==========================================================
   CONSTANTS
========================================================== */

test(
    "reconciliation constants expose expected defaults",
    function () {
        assert.equal(
            constants
                .RECONCILIATION_COLLECTION,
            "_reconciliationRuns"
        );

        assert.equal(
            constants
                .RECONCILIATION_ITEM_COLLECTION,
            "_reconciliationItems"
        );

        assert.equal(
            constants.DEFAULT_STATUS,
            "pending"
        );

        assert.equal(
            constants
                .DEFAULT_ITEM_STATUS,
            "open"
        );

        assert.equal(
            constants
                .DEFAULT_CURRENCY,
            "GBP"
        );

        assert.equal(
            constants
                .DEFAULT_TOLERANCE_MINOR,
            0
        );

        assert.equal(
            constants
                .DEFAULT_QUERY_LIMIT,
            100
        );

        assert.equal(
            constants.MAX_QUERY_LIMIT,
            500
        );

        assert.equal(
            constants
                .DEFAULT_BATCH_SIZE,
            100
        );

        assert.equal(
            constants.MAX_BATCH_SIZE,
            500
        );

        assert.equal(
            constants
                .DEFAULT_MAX_RECORDS,
            10000
        );

        assert.equal(
            constants
                .RECONCILIATION_ITEM_TYPES
                .amountMismatch,
            "amount-mismatch"
        );

        assert.equal(
            constants
                .DISCREPANCY_TYPES
                .includes(
                    "missing-external"
                ),
            true
        );

        assert.equal(
            constants
                .TERMINAL_RECONCILIATION_STATUSES
                .includes(
                    "completed"
                ),
            true
        );

        assert.equal(
            Object.isFrozen(
                constants
                    .DISCREPANCY_TYPES
            ),
            true
        );
    }
);