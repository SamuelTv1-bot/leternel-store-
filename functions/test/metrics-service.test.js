"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   METRICS SERVICE TEST SUITE
========================================================== */

const test =
    require("node:test");

const assert =
    require("node:assert/strict");

const {
    createMetricsService,
    incrementMetric,
    setGaugeMetric,
    recordTimingMetric,
    writeMetric,
    createMetricRecord,
    measureOperation,
    getMetric,
    queryMetrics,
    normalizeMetricQuery,
    createMetricDescriptor,
    createMetricResult,
    sanitizeMetricRecord,
    normalizeMetricName,
    normalizeNamespace,
    normalizeMetricType,
    normalizeMetricDimensions,
    normalizeDimensionComponent,
    normalizeFiniteNumber,
    normalizeNonNegativeNumber,
    normalizeOptionalMetricNumber,
    normalizeNonNegativeInteger,
    normalizePositiveInteger,
    normalizeQueryLimit,
    normalizeMetricOrderField,
    normalizeDateFilter,
    normalizeMetricsOptions,
    normalizeCollection,
    assertMetricsRuntime,
    resolveNow,
    resolveHighResolutionTime,
    resolveElapsedMilliseconds,
    createDatabaseTimestamp,
    toMilliseconds,
    stableStringify,
    normalizeStableValue,
    hashMetricKey,
    sanitizeMetricMetadata,
    serializeTimestamp,
    createHttpMetricsMiddleware,
    createCallableMetricsWrapper,
    recordCallableMetrics,
    attachResponseCompletion,
    resolveRequestRoute,
    logMetricEvent,
    constants
} = require(
    "../src/shared/metrics-service"
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

function compareValues(
    left,
    operator,
    right
) {
    const normalizedLeft =
        left &&
        typeof left.toMillis ===
            "function"
            ? left.toMillis()
            : left;

    const normalizedRight =
        right &&
        typeof right.toMillis ===
            "function"
            ? right.toMillis()
            : right;

    if (
        operator === "=="
    ) {
        return (
            normalizedLeft ===
            normalizedRight
        );
    }

    if (
        operator === ">="
    ) {
        return (
            normalizedLeft >=
            normalizedRight
        );
    }

    if (
        operator === "<="
    ) {
        return (
            normalizedLeft <=
            normalizedRight
        );
    }

    throw new Error(
        "Unsupported query operator."
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
                                            field,
                                            operator,
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
                                field,
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
                                const leftValue =
                                    getNestedValue(
                                        first.value,
                                        queryState
                                            .order
                                            .field
                                    );

                                const rightValue =
                                    getNestedValue(
                                        second.value,
                                        queryState
                                            .order
                                            .field
                                    );

                                const left =
                                    leftValue &&
                                    typeof leftValue
                                        .toMillis ===
                                        "function"
                                        ? leftValue
                                            .toMillis()
                                        : leftValue;

                                const right =
                                    rightValue &&
                                    typeof rightValue
                                        .toMillis ===
                                        "function"
                                        ? rightValue
                                            .toMillis()
                                        : rightValue;

                                const multiplier =
                                    queryState
                                        .order
                                        .direction ===
                                    "asc"
                                        ? 1
                                        : -1;

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
                                reference,
                                value:
                                    clone(value),
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
            }
    };
}

function createLoggerStub() {
    const entries = [];

    return {
        entries,

        debug:
            function (
                message,
                metadata
            ) {
                entries.push({
                    level:
                        "debug",

                    message,

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

function getMetricPath(
    name,
    namespace,
    dimensions
) {
    const descriptor =
        createMetricDescriptor(
            name,
            namespace,
            dimensions
        );

    return (
        constants.METRICS_COLLECTION +
        "/" +
        descriptor.documentId
    );
}

function createResponseStub() {
    const listeners =
        new Map();

    return {
        statusCode:
            200,

        once:
            function (
                event,
                callback
            ) {
                listeners.set(
                    event,
                    callback
                );
            },

        emit:
            async function (
                event
            ) {
                const callback =
                    listeners.get(
                        event
                    );

                if (callback) {
                    await callback();
                }
            }
    };
}

/* ==========================================================
   SERVICE FACTORY
========================================================== */

test(
    "createMetricsService creates a frozen service",
    function () {
        const runtime =
            createRuntime();

        const service =
            createMetricsService({
                runtime,

                namespace:
                    "orders"
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
            typeof service.increment,
            "function"
        );

        assert.equal(
            typeof service.gauge,
            "function"
        );

        assert.equal(
            typeof service.timing,
            "function"
        );

        assert.equal(
            typeof service.measure,
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
    "normalizeMetricsOptions applies defaults",
    function () {
        const options =
            normalizeMetricsOptions(
                {}
            );

        assert.equal(
            options.collection,
            constants
                .METRICS_COLLECTION
        );

        assert.equal(
            options.namespace,
            constants
                .DEFAULT_NAMESPACE
        );

        assert.equal(
            options.retentionMs,
            constants
                .DEFAULT_RETENTION_MS
        );

        assert.equal(
            options.maxDimensions,
            constants
                .DEFAULT_MAX_DIMENSIONS
        );

        assert.equal(
            options.maxDimensionLength,
            constants
                .DEFAULT_MAX_DIMENSION_LENGTH
        );

        assert.equal(
            options.queryLimit,
            constants
                .DEFAULT_QUERY_LIMIT
        );

        assert.deepEqual(
            options.dimensions,
            {}
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
    "normalizeMetricsOptions respects overrides",
    function () {
        const options =
            normalizeMetricsOptions({
                collection:
                    "customMetrics",

                namespace:
                    "payments",

                dimensions: {
                    provider:
                        "paystack"
                },

                metadata: {
                    region:
                        "NG"
                },

                retentionMs:
                    10000,

                maxDimensions:
                    5,

                maxDimensionLength:
                    50,

                queryLimit:
                    20,

                disabled:
                    true,

                log:
                    false
            });

        assert.equal(
            options.collection,
            "customMetrics"
        );

        assert.equal(
            options.namespace,
            "payments"
        );

        assert.deepEqual(
            options.dimensions,
            {
                provider:
                    "paystack"
            }
        );

        assert.deepEqual(
            options.metadata,
            {
                region:
                    "NG"
            }
        );

        assert.equal(
            options.retentionMs,
            10000
        );

        assert.equal(
            options.maxDimensions,
            5
        );

        assert.equal(
            options.maxDimensionLength,
            50
        );

        assert.equal(
            options.queryLimit,
            20
        );

        assert.equal(
            options.disabled,
            true
        );

        assert.equal(
            options.log,
            false
        );
    }
);

test(
    "normalizeCollection validates collection names",
    function () {
        assert.equal(
            normalizeCollection(
                "_metrics"
            ),
            "_metrics"
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
                    "internal/metrics"
                );
            },
            /Firestore collection name/
        );
    }
);

/* ==========================================================
   METRIC NORMALIZATION
========================================================== */

test(
    "normalizeMetricName sanitizes names",
    function () {
        assert.equal(
            normalizeMetricName(
                " HTTP Request Duration "
            ),
            "http.request.duration"
        );

        assert.throws(
            function () {
                normalizeMetricName(
                    ""
                );
            },
            function (error) {
                assert.equal(
                    error instanceof
                        ServiceError,
                    true
                );

                return true;
            }
        );
    }
);

test(
    "normalizeNamespace sanitizes namespaces",
    function () {
        assert.equal(
            normalizeNamespace(
                " Order Service "
            ),
            "order-service"
        );

        assert.equal(
            normalizeNamespace(
                ""
            ),
            "application"
        );
    }
);

test(
    "normalizeMetricType validates metric types",
    function () {
        assert.equal(
            normalizeMetricType(
                "COUNTER"
            ),
            "counter"
        );

        assert.throws(
            function () {
                normalizeMetricType(
                    "histogram"
                );
            },
            /metric type is invalid/
        );
    }
);

test(
    "normalizeMetricDimensions sorts and normalizes values",
    function () {
        assert.deepEqual(
            normalizeMetricDimensions({
                status:
                    200,

                method:
                    "POST"
            }),
            {
                method:
                    "POST",

                status:
                    "200"
            }
        );
    }
);

test(
    "normalizeMetricDimensions rejects invalid input",
    function () {
        assert.throws(
            function () {
                normalizeMetricDimensions(
                    []
                );
            },
            /must be an object/
        );

        assert.throws(
            function () {
                normalizeMetricDimensions({
                    empty:
                        ""
                });
            },
            /dimension value is invalid/
        );
    }
);

test(
    "normalizeMetricDimensions enforces maximum count",
    function () {
        assert.throws(
            function () {
                normalizeMetricDimensions(
                    {
                        a:
                            1,

                        b:
                            2
                    },
                    {
                        maxDimensions:
                            1
                    }
                );
            },
            /Too many metric dimensions/
        );
    }
);

test(
    "normalizeDimensionComponent validates length",
    function () {
        assert.equal(
            normalizeDimensionComponent(
                " value ",
                "Dimension",
                {
                    maxDimensionLength:
                        20
                }
            ),
            "value"
        );

        assert.throws(
            function () {
                normalizeDimensionComponent(
                    "x".repeat(21),
                    "Dimension",
                    {
                        maxDimensionLength:
                            20
                    }
                );
            },
            /too long/
        );
    }
);

/* ==========================================================
   NUMBER HELPERS
========================================================== */

test(
    "number helpers normalize valid values",
    function () {
        assert.equal(
            normalizeFiniteNumber(
                "5",
                "Value"
            ),
            5
        );

        assert.equal(
            normalizeFiniteNumber(
                "invalid",
                10
            ),
            10
        );

        assert.equal(
            normalizeNonNegativeNumber(
                5,
                "Duration"
            ),
            5
        );

        assert.equal(
            normalizeOptionalMetricNumber(
                "5"
            ),
            5
        );

        assert.equal(
            normalizeOptionalMetricNumber(
                "invalid"
            ),
            null
        );
    }
);

test(
    "number helpers reject invalid values",
    function () {
        assert.throws(
            function () {
                normalizeFiniteNumber(
                    "invalid",
                    "Value"
                );
            },
            /finite number/
        );

        assert.throws(
            function () {
                normalizeNonNegativeNumber(
                    -1,
                    "Duration"
                );
            },
            /non-negative/
        );

        assert.throws(
            function () {
                normalizeNonNegativeInteger(
                    -1,
                    0,
                    "Count"
                );
            },
            /non-negative integer/
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
   DESCRIPTORS
========================================================== */

test(
    "createMetricDescriptor creates deterministic metadata",
    function () {
        const descriptor =
            createMetricDescriptor(
                "order.created",
                "orders",
                {
                    channel:
                        "web",

                    region:
                        "NG"
                }
            );

        assert.equal(
            descriptor.name,
            "order.created"
        );

        assert.equal(
            descriptor.namespace,
            "orders"
        );

        assert.deepEqual(
            descriptor.dimensions,
            {
                channel:
                    "web",

                region:
                    "NG"
            }
        );

        assert.equal(
            descriptor.metricHash,
            hashMetricKey(
                descriptor.metricKey
            )
        );

        assert.equal(
            descriptor.documentId,
            descriptor.metricHash
        );
    }
);

test(
    "hashMetricKey returns deterministic SHA-256 hashes",
    function () {
        const first =
            hashMetricKey(
                "orders:created"
            );

        const second =
            hashMetricKey(
                "orders:created"
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
   COUNTERS
========================================================== */

test(
    "incrementMetric creates a counter",
    async function () {
        const firestore =
            createFirestoreStub();

        const runtime =
            createRuntime({
                firestore
            });

        const result =
            await incrementMetric(
                runtime,
                "order.created",
                undefined,
                {
                    namespace:
                        "orders",

                    now:
                        function () {
                            return 1000;
                        }
                }
            );

        assert.equal(
            result.recorded,
            true
        );

        assert.equal(
            result.type,
            "counter"
        );

        assert.equal(
            result.value,
            1
        );

        assert.equal(
            result.total,
            1
        );

        assert.equal(
            result.count,
            1
        );

        const stored =
            firestore.getDocument(
                getMetricPath(
                    "order.created",
                    "orders",
                    {}
                )
            );

        assert.equal(
            stored.value,
            1
        );

        assert.equal(
            stored.count,
            1
        );
    }
);

test(
    "incrementMetric aggregates counter values",
    async function () {
        const runtime =
            createRuntime();

        const options = {
            namespace:
                "orders",

            now:
                function () {
                    return 1000;
                }
        };

        await incrementMetric(
            runtime,
            "order.created",
            2,
            options
        );

        const result =
            await incrementMetric(
                runtime,
                "order.created",
                3,
                options
            );

        assert.equal(
            result.value,
            5
        );

        assert.equal(
            result.total,
            5
        );

        assert.equal(
            result.count,
            2
        );
    }
);

/* ==========================================================
   GAUGES
========================================================== */

test(
    "setGaugeMetric stores current value and extrema",
    async function () {
        const runtime =
            createRuntime();

        const options = {
            namespace:
                "inventory",

            now:
                function () {
                    return 1000;
                }
        };

        await setGaugeMetric(
            runtime,
            "stock.available",
            10,
            options
        );

        await setGaugeMetric(
            runtime,
            "stock.available",
            5,
            options
        );

        const result =
            await setGaugeMetric(
                runtime,
                "stock.available",
                12,
                options
            );

        assert.equal(
            result.value,
            12
        );

        assert.equal(
            result.minimum,
            5
        );

        assert.equal(
            result.maximum,
            12
        );

        assert.equal(
            result.count,
            3
        );
    }
);

/* ==========================================================
   TIMINGS
========================================================== */

test(
    "recordTimingMetric calculates timing statistics",
    async function () {
        const runtime =
            createRuntime();

        const options = {
            namespace:
                "http",

            now:
                function () {
                    return 1000;
                }
        };

        await recordTimingMetric(
            runtime,
            "request.duration",
            100,
            options
        );

        await recordTimingMetric(
            runtime,
            "request.duration",
            200,
            options
        );

        const result =
            await recordTimingMetric(
                runtime,
                "request.duration",
                300,
                options
            );

        assert.equal(
            result.value,
            300
        );

        assert.equal(
            result.total,
            600
        );

        assert.equal(
            result.count,
            3
        );

        assert.equal(
            result.minimum,
            100
        );

        assert.equal(
            result.maximum,
            300
        );

        assert.equal(
            result.average,
            200
        );
    }
);

/* ==========================================================
   DISABLED WRITES
========================================================== */

test(
    "writeMetric returns disabled result without datastore",
    async function () {
        const result =
            await writeMetric(
                null,
                {
                    name:
                        "order.created",

                    type:
                        "counter",

                    value:
                        1
                },
                {
                    namespace:
                        "orders",

                    disabled:
                        true,

                    now:
                        function () {
                            return 1000;
                        }
                }
            );

        assert.equal(
            result.recorded,
            false
        );

        assert.equal(
            result.disabled,
            true
        );

        assert.equal(
            result.value,
            1
        );
    }
);

/* ==========================================================
   METRIC RECORD CREATION
========================================================== */

test(
    "createMetricRecord preserves original creation time",
    function () {
        const descriptor =
            createMetricDescriptor(
                "order.created",
                "orders",
                {}
            );

        const record =
            createMetricRecord(
                {
                    Timestamp:
                        TestTimestamp
                },
                descriptor,
                {
                    type:
                        "counter",

                    value:
                        2
                },
                {
                    value:
                        3,

                    total:
                        3,

                    count:
                        1,

                    createdAt:
                        TestTimestamp
                            .fromMillis(
                                500
                            )
                },
                1000,
                {
                    retentionMs:
                        5000,

                    metadata:
                        {}
                }
            );

        assert.equal(
            record.value,
            5
        );

        assert.equal(
            record.createdAt.toMillis(),
            500
        );

        assert.equal(
            record.updatedAt.toMillis(),
            1000
        );

        assert.equal(
            record.expiresAt.toMillis(),
            6000
        );
    }
);

/* ==========================================================
   MEASURE OPERATION
========================================================== */

test(
    "measureOperation records successful duration",
    async function () {
        const runtime =
            createRuntime();

        let highResolution =
            10;

        const result =
            await measureOperation(
                runtime,
                "order.process",
                async function () {
                    highResolution =
                        35;

                    return {
                        success:
                            true
                    };
                },
                {
                    namespace:
                        "orders",

                    now:
                        function () {
                            return 1000;
                        },

                    highResolutionNow:
                        function () {
                            return highResolution;
                        }
                }
            );

        assert.deepEqual(
            result,
            {
                success:
                    true
            }
        );

        const metric =
            await getMetric(
                runtime,
                "order.process",
                {
                    namespace:
                        "orders",

                    dimensions: {
                        outcome:
                            "success"
                    }
                }
            );

        assert.equal(
            metric.value,
            25
        );
    }
);

test(
    "measureOperation records failed duration and rethrows",
    async function () {
        const runtime =
            createRuntime();

        let highResolution =
            10;

        const expected =
            new Error(
                "Operation failed."
            );

        await assert.rejects(
            async function () {
                await measureOperation(
                    runtime,
                    "order.process",
                    async function () {
                        highResolution =
                            40;

                        throw expected;
                    },
                    {
                        namespace:
                            "orders",

                        now:
                            function () {
                                return 1000;
                            },

                        highResolutionNow:
                            function () {
                                return highResolution;
                            }
                    }
                );
            },
            expected
        );

        const metric =
            await getMetric(
                runtime,
                "order.process",
                {
                    namespace:
                        "orders",

                    dimensions: {
                        outcome:
                            "failure"
                    }
                }
            );

        assert.equal(
            metric.value,
            30
        );
    }
);

test(
    "measureOperation requires an operation function",
    async function () {
        await assert.rejects(
            async function () {
                await measureOperation(
                    createRuntime(),
                    "operation",
                    null,
                    {}
                );
            },
            /must be a function/
        );
    }
);

/* ==========================================================
   GET METRIC
========================================================== */

test(
    "getMetric returns stored metric",
    async function () {
        const runtime =
            createRuntime();

        await incrementMetric(
            runtime,
            "order.created",
            1,
            {
                namespace:
                    "orders",

                dimensions: {
                    channel:
                        "web"
                },

                now:
                    function () {
                        return 1000;
                    }
            }
        );

        const result =
            await getMetric(
                runtime,
                "order.created",
                {
                    namespace:
                        "orders",

                    dimensions: {
                        channel:
                            "web"
                    }
                }
            );

        assert.equal(
            result.name,
            "order.created"
        );

        assert.equal(
            result.value,
            1
        );

        assert.equal(
            result.updatedAt,
            new Date(
                1000
            ).toISOString()
        );
    }
);

test(
    "getMetric returns null for missing metric",
    async function () {
        assert.equal(
            await getMetric(
                createRuntime(),
                "missing.metric",
                {
                    namespace:
                        "orders"
                }
            ),
            null
        );
    }
);

test(
    "getMetric returns null when disabled",
    async function () {
        assert.equal(
            await getMetric(
                null,
                "metric",
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
   QUERY METRICS
========================================================== */

test(
    "queryMetrics filters and orders metrics",
    async function () {
        const firestore =
            createFirestoreStub({
                "_metrics/one": {
                    name:
                        "order.created",

                    namespace:
                        "orders",

                    type:
                        "counter",

                    metricKey:
                        "one",

                    metricHash:
                        "one",

                    dimensions:
                        {},

                    value:
                        2,

                    total:
                        2,

                    count:
                        2,

                    metadata:
                        {},

                    createdAt:
                        TestTimestamp
                            .fromMillis(
                                1000
                            ),

                    updatedAt:
                        TestTimestamp
                            .fromMillis(
                                1000
                            )
                },

                "_metrics/two": {
                    name:
                        "order.created",

                    namespace:
                        "orders",

                    type:
                        "counter",

                    metricKey:
                        "two",

                    metricHash:
                        "two",

                    dimensions:
                        {},

                    value:
                        5,

                    total:
                        5,

                    count:
                        5,

                    metadata:
                        {},

                    createdAt:
                        TestTimestamp
                            .fromMillis(
                                2000
                            ),

                    updatedAt:
                        TestTimestamp
                            .fromMillis(
                                2000
                            )
                },

                "_metrics/three": {
                    name:
                        "payment.failed",

                    namespace:
                        "payments",

                    type:
                        "counter",

                    metricKey:
                        "three",

                    metricHash:
                        "three",

                    dimensions:
                        {},

                    value:
                        1,

                    total:
                        1,

                    count:
                        1,

                    metadata:
                        {},

                    createdAt:
                        TestTimestamp
                            .fromMillis(
                                3000
                            ),

                    updatedAt:
                        TestTimestamp
                            .fromMillis(
                                3000
                            )
                }
            });

        const results =
            await queryMetrics(
                createRuntime({
                    firestore
                }),
                {
                    namespace:
                        "orders",

                    name:
                        "order.created",

                    direction:
                        "desc"
                },
                {}
            );

        assert.deepEqual(
            results.map(
                function (metric) {
                    return metric.value;
                }
            ),
            [
                5,
                2
            ]
        );
    }
);

test(
    "queryMetrics supports date filters",
    async function () {
        const firestore =
            createFirestoreStub({
                "_metrics/one": {
                    name:
                        "order.created",

                    namespace:
                        "orders",

                    type:
                        "counter",

                    metricKey:
                        "one",

                    metricHash:
                        "one",

                    dimensions:
                        {},

                    value:
                        1,

                    count:
                        1,

                    updatedAt:
                        TestTimestamp
                            .fromMillis(
                                1000
                            )
                },

                "_metrics/two": {
                    name:
                        "order.created",

                    namespace:
                        "orders",

                    type:
                        "counter",

                    metricKey:
                        "two",

                    metricHash:
                        "two",

                    dimensions:
                        {},

                    value:
                        2,

                    count:
                        2,

                    updatedAt:
                        TestTimestamp
                            .fromMillis(
                                3000
                            )
                }
            });

        const results =
            await queryMetrics(
                createRuntime({
                    firestore
                }),
                {
                    updatedAfter:
                        2000,

                    updatedBefore:
                        4000
                },
                {
                    namespace:
                        "orders"
                }
            );

        assert.deepEqual(
            results.map(
                function (metric) {
                    return metric.value;
                }
            ),
            [
                2
            ]
        );
    }
);

test(
    "queryMetrics returns empty list when disabled",
    async function () {
        assert.deepEqual(
            await queryMetrics(
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
   QUERY NORMALIZATION
========================================================== */

test(
    "normalizeMetricQuery normalizes filters",
    function () {
        assert.deepEqual(
            normalizeMetricQuery(
                {
                    namespace:
                        "Order Service",

                    name:
                        "Order Created",

                    type:
                        "COUNTER",

                    updatedAfter:
                        1000,

                    updatedBefore:
                        2000,

                    orderBy:
                        "count",

                    direction:
                        "ASC",

                    limit:
                        25
                },
                {}
            ),
            {
                namespace:
                    "order-service",

                name:
                    "order.created",

                type:
                    "counter",

                updatedAfter:
                    1000,

                updatedBefore:
                    2000,

                orderBy:
                    "count",

                direction:
                    "asc",

                limit:
                    25
            }
        );
    }
);

test(
    "query helper normalizers apply safe defaults",
    function () {
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

        assert.equal(
            normalizeMetricOrderField(
                "unknown"
            ),
            "updatedAt"
        );

        assert.equal(
            normalizeDateFilter(
                "1970-01-01T00:00:01.000Z",
                "Date"
            ),
            1000
        );
    }
);

/* ==========================================================
   RESULT SANITIZATION
========================================================== */

test(
    "createMetricResult normalizes metric output",
    function () {
        const descriptor =
            createMetricDescriptor(
                "order.created",
                "orders",
                {}
            );

        const result =
            createMetricResult(
                descriptor,
                {
                    recorded:
                        true,

                    type:
                        "counter",

                    value:
                        2,

                    total:
                        2,

                    count:
                        1,

                    updatedAt:
                        TestTimestamp
                            .fromMillis(
                                1000
                            )
                }
            );

        assert.equal(
            result.recorded,
            true
        );

        assert.equal(
            result.name,
            "order.created"
        );

        assert.equal(
            result.updatedAt,
            new Date(
                1000
            ).toISOString()
        );
    }
);

test(
    "sanitizeMetricRecord serializes timestamps",
    function () {
        const result =
            sanitizeMetricRecord({
                name:
                    "request.duration",

                namespace:
                    "http",

                type:
                    "timing",

                metricKey:
                    "key",

                metricHash:
                    "hash",

                dimensions:
                    {},

                value:
                    100,

                total:
                    200,

                count:
                    2,

                minimum:
                    50,

                maximum:
                    150,

                average:
                    100,

                metadata:
                    {},

                createdAt:
                    TestTimestamp
                        .fromMillis(
                            1000
                        ),

                updatedAt:
                    TestTimestamp
                        .fromMillis(
                            2000
                        )
            });

        assert.equal(
            result.createdAt,
            new Date(
                1000
            ).toISOString()
        );

        assert.equal(
            result.updatedAt,
            new Date(
                2000
            ).toISOString()
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
   RUNTIME HELPERS
========================================================== */

test(
    "assertMetricsRuntime validates runtime",
    function () {
        assert.doesNotThrow(
            function () {
                assertMetricsRuntime(
                    createRuntime()
                );
            }
        );

        assert.throws(
            function () {
                assertMetricsRuntime(
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
                assertMetricsRuntime({
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
    "time helpers resolve deterministic values",
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

        assert.equal(
            resolveHighResolutionTime({
                highResolutionNow:
                    function () {
                        return 25;
                    }
            }),
            25
        );

        let current =
            40;

        assert.equal(
            resolveElapsedMilliseconds(
                10,
                {
                    highResolutionNow:
                        function () {
                            return current;
                        }
                }
            ),
            30
        );
    }
);

test(
    "timestamp helpers support runtime timestamps",
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
    }
);

/* ==========================================================
   METADATA
========================================================== */

test(
    "sanitizeMetricMetadata preserves objects and wraps primitives",
    function () {
        assert.deepEqual(
            sanitizeMetricMetadata({
                source:
                    "checkout"
            }),
            {
                source:
                    "checkout"
            }
        );

        assert.deepEqual(
            sanitizeMetricMetadata(
                "checkout"
            ),
            {
                value:
                    "checkout"
            }
        );

        assert.deepEqual(
            sanitizeMetricMetadata(
                null
            ),
            {}
        );
    }
);

/* ==========================================================
   HTTP METRICS
========================================================== */

test(
    "createHttpMetricsMiddleware records completed requests",
    async function () {
        const calls = [];

        let clock =
            10;

        const service = {
            timing:
                async function (
                    name,
                    duration,
                    options
                ) {
                    calls.push({
                        operation:
                            "timing",

                        name,

                        duration,

                        options
                    });
                },

            increment:
                async function (
                    name,
                    value,
                    options
                ) {
                    calls.push({
                        operation:
                            "increment",

                        name,

                        value,

                        options
                    });
                }
        };

        const response =
            createResponseStub();

        const middleware =
            createHttpMetricsMiddleware({
                service,

                highResolutionNow:
                    function () {
                        return clock;
                    }
            });

        await middleware(
            {
                method:
                    "POST",

                route: {
                    path:
                        "/orders"
                }
            },
            response,
            function () {}
        );

        clock =
            35;

        await response.emit(
            "finish"
        );

        assert.equal(
            calls.length,
            2
        );

        assert.equal(
            calls[0].name,
            "http.request.duration"
        );

        assert.equal(
            calls[0].duration,
            25
        );

        assert.deepEqual(
            calls[0]
                .options
                .dimensions,
            {
                method:
                    "POST",

                route:
                    "/orders",

                status:
                    "200",

                outcome:
                    "success"
            }
        );
    }
);

test(
    "attachResponseCompletion wraps response end",
    async function () {
        let callbackCalls =
            0;

        let endCalls =
            0;

        const response = {
            end:
                function () {
                    endCalls +=
                        1;
                }
        };

        attachResponseCompletion(
            response,
            async function () {
                callbackCalls +=
                    1;
            }
        );

        response.end();

        await new Promise(
            function (resolve) {
                setImmediate(
                    resolve
                );
            }
        );

        assert.equal(
            endCalls,
            1
        );

        assert.equal(
            callbackCalls,
            1
        );
    }
);

test(
    "resolveRequestRoute uses route and URL fallbacks",
    function () {
        assert.equal(
            resolveRequestRoute({
                route: {
                    path:
                        "/orders"
                }
            }),
            "/orders"
        );

        assert.equal(
            resolveRequestRoute({
                originalUrl:
                    "/checkout"
            }),
            "/checkout"
        );

        assert.equal(
            resolveRequestRoute(
                null
            ),
            "unknown"
        );
    }
);

/* ==========================================================
   CALLABLE METRICS
========================================================== */

test(
    "createCallableMetricsWrapper records success",
    async function () {
        const calls = [];

        let clock =
            10;

        const service = {
            timing:
                async function (
                    name,
                    duration,
                    options
                ) {
                    calls.push({
                        operation:
                            "timing",

                        name,

                        duration,

                        options
                    });
                },

            increment:
                async function (
                    name,
                    value,
                    options
                ) {
                    calls.push({
                        operation:
                            "increment",

                        name,

                        value,

                        options
                    });
                }
        };

        const wrapper =
            createCallableMetricsWrapper(
                async function () {
                    clock =
                        40;

                    return {
                        success:
                            true
                    };
                },
                {
                    service,

                    callableName:
                        "createOrder",

                    highResolutionNow:
                        function () {
                            return clock;
                        }
                }
            );

        const result =
            await wrapper({
                auth: {
                    uid:
                        "customer-1"
                }
            });

        assert.deepEqual(
            result,
            {
                success:
                    true
            }
        );

        assert.equal(
            calls[0].duration,
            30
        );

        assert.deepEqual(
            calls[0]
                .options
                .dimensions,
            {
                callable:
                    "createOrder",

                outcome:
                    "success",

                authenticated:
                    "true"
            }
        );
    }
);

test(
    "createCallableMetricsWrapper records failure",
    async function () {
        const calls = [];

        let clock =
            10;

        const expected =
            new Error(
                "Callable failed."
            );

        const service = {
            timing:
                async function (
                    name,
                    duration,
                    options
                ) {
                    calls.push({
                        name,
                        duration,
                        options
                    });
                },

            increment:
                async function () {}
        };

        const wrapper =
            createCallableMetricsWrapper(
                async function () {
                    clock =
                        30;

                    throw expected;
                },
                {
                    service,

                    callableName:
                        "createOrder",

                    highResolutionNow:
                        function () {
                            return clock;
                        }
                }
            );

        await assert.rejects(
            async function () {
                await wrapper({});
            },
            expected
        );

        assert.equal(
            calls[0]
                .options
                .dimensions
                .outcome,
            "failure"
        );

        assert.equal(
            calls[0]
                .options
                .dimensions
                .authenticated,
            "false"
        );
    }
);

test(
    "createCallableMetricsWrapper requires handler",
    function () {
        assert.throws(
            function () {
                createCallableMetricsWrapper(
                    null,
                    {}
                );
            },
            /requires a handler function/
        );
    }
);

test(
    "recordCallableMetrics writes timing and count metrics",
    async function () {
        const calls = [];

        const service = {
            timing:
                async function (
                    name,
                    duration,
                    options
                ) {
                    calls.push({
                        type:
                            "timing",

                        name,

                        duration,

                        options
                    });
                },

            increment:
                async function (
                    name,
                    value,
                    options
                ) {
                    calls.push({
                        type:
                            "increment",

                        name,

                        value,

                        options
                    });
                }
        };

        await recordCallableMetrics(
            service,
            {
                auth: {
                    uid:
                        "customer-1"
                }
            },
            25,
            "success",
            {
                callableName:
                    "checkout"
            }
        );

        assert.equal(
            calls.length,
            2
        );

        assert.equal(
            calls[0].name,
            "callable.request.duration"
        );

        assert.equal(
            calls[1].name,
            "callable.request.count"
        );
    }
);

/* ==========================================================
   LOGGING
========================================================== */

test(
    "logMetricEvent writes debug log",
    function () {
        const logger =
            createLoggerStub();

        logMetricEvent(
            {
                logger
            },
            {
                name:
                    "order.created",

                namespace:
                    "orders",

                type:
                    "counter",

                value:
                    1,

                count:
                    1,

                dimensions:
                    {}
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
            logger.entries[0].message,
            "Metric recorded."
        );
    }
);

test(
    "logMetricEvent can be disabled",
    function () {
        const logger =
            createLoggerStub();

        logMetricEvent(
            {
                logger
            },
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
    "metrics constants expose expected defaults",
    function () {
        assert.equal(
            constants
                .METRICS_COLLECTION,
            "_metrics"
        );

        assert.equal(
            constants
                .DEFAULT_NAMESPACE,
            "application"
        );

        assert.equal(
            constants
                .DEFAULT_RETENTION_MS,
            2592000000
        );

        assert.equal(
            constants
                .DEFAULT_MAX_DIMENSIONS,
            20
        );

        assert.equal(
            constants
                .DEFAULT_MAX_DIMENSION_LENGTH,
            200
        );

        assert.equal(
            constants
                .DEFAULT_QUERY_LIMIT,
            100
        );

        assert.equal(
            constants
                .MAX_QUERY_LIMIT,
            500
        );

        assert.deepEqual(
            constants
                .METRIC_TYPES,
            {
                counter:
                    "counter",

                gauge:
                    "gauge",

                timing:
                    "timing"
            }
        );
    }
);