"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   METRICS SERVICE

   Responsibilities:
   - Record counters, gauges, and timing metrics
   - Store aggregated metrics in Firestore
   - Support dimensions and deterministic metric keys
   - Provide HTTP and callable request instrumentation
   - Read and query metric snapshots
========================================================== */

const crypto =
    require("node:crypto");

const {
    getRuntime
} = require(
    "./runtime"
);

const {
    ServiceError
} = require(
    "./service-error"
);

/* ==========================================================
   CONSTANTS
========================================================== */

const METRICS_COLLECTION =
    "_metrics";

const DEFAULT_NAMESPACE =
    "application";

const DEFAULT_RETENTION_MS =
    30 * 24 * 60 * 60 * 1000;

const DEFAULT_MAX_DIMENSIONS =
    20;

const DEFAULT_MAX_DIMENSION_LENGTH =
    200;

const DEFAULT_QUERY_LIMIT =
    100;

const MAX_QUERY_LIMIT =
    500;

const METRIC_TYPES =
    Object.freeze({
        counter:
            "counter",

        gauge:
            "gauge",

        timing:
            "timing"
    });

/* ==========================================================
   SERVICE FACTORY
========================================================== */

function createMetricsService(
    options
) {
    const settings =
        normalizeMetricsOptions(
            options
        );

    const runtime =
        settings.runtime ||
        getRuntime();

    return Object.freeze({
        runtime:
            runtime,

        options:
            settings,

        increment:
            function (
                name,
                value,
                overrides
            ) {
                return incrementMetric(
                    runtime,
                    name,
                    value,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        gauge:
            function (
                name,
                value,
                overrides
            ) {
                return setGaugeMetric(
                    runtime,
                    name,
                    value,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        timing:
            function (
                name,
                durationMs,
                overrides
            ) {
                return recordTimingMetric(
                    runtime,
                    name,
                    durationMs,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        measure:
            function (
                name,
                operation,
                overrides
            ) {
                return measureOperation(
                    runtime,
                    name,
                    operation,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        get:
            function (
                name,
                overrides
            ) {
                return getMetric(
                    runtime,
                    name,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        query:
            function (
                filters,
                overrides
            ) {
                return queryMetrics(
                    runtime,
                    filters,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            }
    });
}

/* ==========================================================
   COUNTERS
========================================================== */

async function incrementMetric(
    runtime,
    name,
    value,
    options
) {
    const amount =
        value === undefined
            ? 1
            : normalizeFiniteNumber(
                  value,
                  "Counter value"
              );

    const settings =
        normalizeMetricsOptions(
            options
        );

    return writeMetric(
        runtime,
        {
            name:
                name,

            type:
                METRIC_TYPES.counter,

            value:
                amount
        },
        settings
    );
}

/* ==========================================================
   GAUGES
========================================================== */

async function setGaugeMetric(
    runtime,
    name,
    value,
    options
) {
    const normalized =
        normalizeFiniteNumber(
            value,
            "Gauge value"
        );

    const settings =
        normalizeMetricsOptions(
            options
        );

    return writeMetric(
        runtime,
        {
            name:
                name,

            type:
                METRIC_TYPES.gauge,

            value:
                normalized
        },
        settings
    );
}

/* ==========================================================
   TIMINGS
========================================================== */

async function recordTimingMetric(
    runtime,
    name,
    durationMs,
    options
) {
    const duration =
        normalizeNonNegativeNumber(
            durationMs,
            "Timing duration"
        );

    const settings =
        normalizeMetricsOptions(
            options
        );

    return writeMetric(
        runtime,
        {
            name:
                name,

            type:
                METRIC_TYPES.timing,

            value:
                duration
        },
        settings
    );
}

/* ==========================================================
   WRITE METRIC
========================================================== */

async function writeMetric(
    runtime,
    metric,
    options
) {
    const settings =
        normalizeMetricsOptions(
            options
        );

    const descriptor =
        createMetricDescriptor(
            metric.name,
            settings.namespace,
            settings.dimensions
        );

    const now =
        resolveNow(
            runtime,
            settings
        );

    if (
        settings.disabled
    ) {
        return createMetricResult(
            descriptor,
            {
                type:
                    metric.type,

                value:
                    metric.value,

                disabled:
                    true,

                recorded:
                    false,

                updatedAt:
                    now
            }
        );
    }

    assertMetricsRuntime(
        runtime
    );

    const reference =
        runtime.db
            .collection(
                settings.collection
            )
            .doc(
                descriptor.documentId
            );

    const result =
        await runtime.db
            .runTransaction(
                async function (
                    transaction
                ) {
                    const snapshot =
                        await transaction.get(
                            reference
                        );

                    const existing =
                        snapshot.exists
                            ? snapshot.data()
                            : null;

                    const record =
                        createMetricRecord(
                            runtime,
                            descriptor,
                            metric,
                            existing,
                            now,
                            settings
                        );

                    transaction.set(
                        reference,
                        record,
                        {
                            merge:
                                false
                        }
                    );

                    return record;
                }
            );

    logMetricEvent(
        runtime,
        result,
        settings
    );

    return createMetricResult(
        descriptor,
        Object.assign(
            {},
            result,
            {
                recorded:
                    true,

                disabled:
                    false
            }
        )
    );
}

/* ==========================================================
   RECORD CREATION
========================================================== */

function createMetricRecord(
    runtime,
    descriptor,
    metric,
    existing,
    now,
    options
) {
    const settings =
        options || {};

    const previous =
        existing || {};

    const type =
        normalizeMetricType(
            metric.type
        );

    const value =
        normalizeFiniteNumber(
            metric.value,
            "Metric value"
        );

    const count =
        normalizeNonNegativeInteger(
            previous.count,
            0,
            "Metric count"
        );

    const previousTotal =
        normalizeFiniteNumber(
            previous.total,
            0
        );

    const previousMinimum =
        normalizeOptionalMetricNumber(
            previous.minimum
        );

    const previousMaximum =
        normalizeOptionalMetricNumber(
            previous.maximum
        );

    let recordValue;
    let total;
    let nextCount;
    let minimum;
    let maximum;
    let average;

    if (
        type ===
        METRIC_TYPES.counter
    ) {
        recordValue =
            normalizeFiniteNumber(
                previous.value,
                0
            ) +
            value;

        total =
            recordValue;

        nextCount =
            count +
            1;

        minimum =
            null;

        maximum =
            null;

        average =
            null;
    } else if (
        type ===
        METRIC_TYPES.gauge
    ) {
        recordValue =
            value;

        total =
            value;

        nextCount =
            count +
            1;

        minimum =
            previousMinimum ===
            null
                ? value
                : Math.min(
                      previousMinimum,
                      value
                  );

        maximum =
            previousMaximum ===
            null
                ? value
                : Math.max(
                      previousMaximum,
                      value
                  );

        average =
            null;
    } else {
        recordValue =
            value;

        total =
            previousTotal +
            value;

        nextCount =
            count +
            1;

        minimum =
            previousMinimum ===
            null
                ? value
                : Math.min(
                      previousMinimum,
                      value
                  );

        maximum =
            previousMaximum ===
            null
                ? value
                : Math.max(
                      previousMaximum,
                      value
                  );

        average =
            nextCount
                ? total /
                  nextCount
                : 0;
    }

    return {
        name:
            descriptor.name,

        namespace:
            descriptor.namespace,

        type:
            type,

        metricKey:
            descriptor.metricKey,

        metricHash:
            descriptor.metricHash,

        dimensions:
            cloneValue(
                descriptor.dimensions
            ),

        value:
            recordValue,

        total:
            total,

        count:
            nextCount,

        minimum:
            minimum,

        maximum:
            maximum,

        average:
            average,

        metadata:
            sanitizeMetricMetadata(
                settings.metadata
            ),

        createdAt:
            previous.createdAt ||
            createDatabaseTimestamp(
                runtime,
                now
            ),

        updatedAt:
            createDatabaseTimestamp(
                runtime,
                now
            ),

        expiresAt:
            settings.retentionMs
                ? createDatabaseTimestamp(
                      runtime,
                      now +
                      settings.retentionMs
                  )
                : null
    };
}

/* ==========================================================
   MEASUREMENT
========================================================== */

async function measureOperation(
    runtime,
    name,
    operation,
    options
) {
    if (
        typeof operation !==
        "function"
    ) {
        throw new TypeError(
            "Measured operation must be a function."
        );
    }

    const settings =
        normalizeMetricsOptions(
            options
        );

    const startedAt =
        resolveHighResolutionTime(
            settings
        );

    try {
        const result =
            await operation();

        const durationMs =
            resolveElapsedMilliseconds(
                startedAt,
                settings
            );

        await recordTimingMetric(
            runtime,
            name,
            durationMs,
            Object.assign(
                {},
                settings,
                {
                    dimensions:
                        Object.assign(
                            {},
                            settings.dimensions,
                            {
                                outcome:
                                    "success"
                            }
                        )
                }
            )
        );

        return result;
    } catch (error) {
        const durationMs =
            resolveElapsedMilliseconds(
                startedAt,
                settings
            );

        await recordTimingMetric(
            runtime,
            name,
            durationMs,
            Object.assign(
                {},
                settings,
                {
                    dimensions:
                        Object.assign(
                            {},
                            settings.dimensions,
                            {
                                outcome:
                                    "failure"
                            }
                        )
                }
            )
        );

        throw error;
    }
}

/* ==========================================================
   READ METRIC
========================================================== */

async function getMetric(
    runtime,
    name,
    options
) {
    const settings =
        normalizeMetricsOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return null;
    }

    assertMetricsRuntime(
        runtime
    );

    const descriptor =
        createMetricDescriptor(
            name,
            settings.namespace,
            settings.dimensions
        );

    const snapshot =
        await runtime.db
            .collection(
                settings.collection
            )
            .doc(
                descriptor.documentId
            )
            .get();

    if (!snapshot.exists) {
        return null;
    }

    return sanitizeMetricRecord(
        snapshot.data()
    );
}

/* ==========================================================
   QUERY METRICS
========================================================== */

async function queryMetrics(
    runtime,
    filters,
    options
) {
    const settings =
        normalizeMetricsOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return [];
    }

    assertMetricsRuntime(
        runtime
    );

    const normalized =
        normalizeMetricQuery(
            filters,
            settings
        );

    let query =
        runtime.db
            .collection(
                settings.collection
            );

    if (
        normalized.namespace
    ) {
        query =
            query.where(
                "namespace",
                "==",
                normalized.namespace
            );
    }

    if (
        normalized.name
    ) {
        query =
            query.where(
                "name",
                "==",
                normalized.name
            );
    }

    if (
        normalized.type
    ) {
        query =
            query.where(
                "type",
                "==",
                normalized.type
            );
    }

    if (
        normalized.updatedAfter
    ) {
        query =
            query.where(
                "updatedAt",
                ">=",
                createDatabaseTimestamp(
                    runtime,
                    normalized
                        .updatedAfter
                )
            );
    }

    if (
        normalized.updatedBefore
    ) {
        query =
            query.where(
                "updatedAt",
                "<=",
                createDatabaseTimestamp(
                    runtime,
                    normalized
                        .updatedBefore
                )
            );
    }

    if (
        typeof query.orderBy ===
        "function"
    ) {
        query =
            query.orderBy(
                normalized.orderBy,
                normalized.direction
            );
    }

    if (
        typeof query.limit ===
        "function"
    ) {
        query =
            query.limit(
                normalized.limit
            );
    }

    const snapshot =
        await query.get();

    const documents =
        snapshot &&
        Array.isArray(
            snapshot.docs
        )
            ? snapshot.docs
            : [];

    return documents.map(
        function (document) {
            return sanitizeMetricRecord(
                document.data()
            );
        }
    );
}

/* ==========================================================
   QUERY NORMALIZATION
========================================================== */

function normalizeMetricQuery(
    filters,
    options
) {
    const source =
        filters || {};

    const settings =
        options || {};

    return {
        namespace:
            source.namespace
                ? normalizeNamespace(
                      source.namespace
                  )
                : settings.namespace ||
                  null,

        name:
            source.name
                ? normalizeMetricName(
                      source.name
                  )
                : null,

        type:
            source.type
                ? normalizeMetricType(
                      source.type
                  )
                : null,

        updatedAfter:
            source.updatedAfter !==
            undefined
                ? normalizeDateFilter(
                      source.updatedAfter,
                      "Metrics query start date"
                  )
                : null,

        updatedBefore:
            source.updatedBefore !==
            undefined
                ? normalizeDateFilter(
                      source.updatedBefore,
                      "Metrics query end date"
                  )
                : null,

        orderBy:
            normalizeMetricOrderField(
                source.orderBy
            ),

        direction:
            String(
                source.direction ||
                "desc"
            ).toLowerCase() ===
            "asc"
                ? "asc"
                : "desc",

        limit:
            normalizeQueryLimit(
                source.limit ||
                settings.queryLimit
            )
    };
}

/* ==========================================================
   DESCRIPTOR
========================================================== */

function createMetricDescriptor(
    name,
    namespace,
    dimensions
) {
    const normalizedName =
        normalizeMetricName(
            name
        );

    const normalizedNamespace =
        normalizeNamespace(
            namespace
        );

    const normalizedDimensions =
        normalizeMetricDimensions(
            dimensions
        );

    const dimensionString =
        stableStringify(
            normalizedDimensions
        );

    const metricKey =
        normalizedNamespace +
        ":" +
        normalizedName +
        ":" +
        dimensionString;

    const metricHash =
        hashMetricKey(
            metricKey
        );

    return {
        name:
            normalizedName,

        namespace:
            normalizedNamespace,

        dimensions:
            normalizedDimensions,

        metricKey:
            metricKey,

        metricHash:
            metricHash,

        documentId:
            metricHash
    };
}

/* ==========================================================
   RESULT AND RECORD SANITIZATION
========================================================== */

function createMetricResult(
    descriptor,
    values
) {
    const source =
        values || {};

    return {
        recorded:
            Boolean(
                source.recorded
            ),

        disabled:
            Boolean(
                source.disabled
            ),

        name:
            descriptor.name,

        namespace:
            descriptor.namespace,

        type:
            source.type ||
            null,

        metricKey:
            descriptor.metricKey,

        metricHash:
            descriptor.metricHash,

        documentId:
            descriptor.documentId,

        dimensions:
            cloneValue(
                descriptor.dimensions
            ),

        value:
            normalizeOptionalMetricNumber(
                source.value
            ),

        total:
            normalizeOptionalMetricNumber(
                source.total
            ),

        count:
            normalizeNonNegativeInteger(
                source.count,
                0,
                "Metric count"
            ),

        minimum:
            normalizeOptionalMetricNumber(
                source.minimum
            ),

        maximum:
            normalizeOptionalMetricNumber(
                source.maximum
            ),

        average:
            normalizeOptionalMetricNumber(
                source.average
            ),

        metadata:
            cloneValue(
                source.metadata
            ),

        createdAt:
            serializeTimestamp(
                source.createdAt
            ),

        updatedAt:
            serializeTimestamp(
                source.updatedAt
            ),

        expiresAt:
            serializeTimestamp(
                source.expiresAt
            )
    };
}

function sanitizeMetricRecord(
    record
) {
    if (!record) {
        return null;
    }

    return {
        name:
            record.name,

        namespace:
            record.namespace,

        type:
            normalizeMetricType(
                record.type
            ),

        metricKey:
            record.metricKey,

        metricHash:
            record.metricHash,

        dimensions:
            cloneValue(
                record.dimensions
            ),

        value:
            normalizeOptionalMetricNumber(
                record.value
            ),

        total:
            normalizeOptionalMetricNumber(
                record.total
            ),

        count:
            normalizeNonNegativeInteger(
                record.count,
                0,
                "Metric count"
            ),

        minimum:
            normalizeOptionalMetricNumber(
                record.minimum
            ),

        maximum:
            normalizeOptionalMetricNumber(
                record.maximum
            ),

        average:
            normalizeOptionalMetricNumber(
                record.average
            ),

        metadata:
            cloneValue(
                record.metadata
            ),

        createdAt:
            serializeTimestamp(
                record.createdAt
            ),

        updatedAt:
            serializeTimestamp(
                record.updatedAt
            ),

        expiresAt:
            serializeTimestamp(
                record.expiresAt
            )
    };
}

/* ==========================================================
   NORMALIZERS
========================================================== */

function normalizeMetricName(
    value
) {
    const normalized =
        String(
            value || ""
        )
            .trim()
            .toLowerCase()
            .replace(
                /[^a-z0-9._:-]/g,
                "."
            )
            .replace(
                /\.{2,}/g,
                "."
            )
            .replace(
                /^\.+|\.+$/g,
                ""
            );

    if (!normalized) {
        throw new ServiceError(
            "invalid-argument",
            "The metric name is invalid.",
            {
                status:
                    400,

                expose:
                    true
            }
        );
    }

    return normalized;
}

function normalizeNamespace(
    value
) {
    const normalized =
        String(
            value ||
            DEFAULT_NAMESPACE
        )
            .trim()
            .toLowerCase()
            .replace(
                /[^a-z0-9._:-]/g,
                "-"
            );

    return normalized ||
        DEFAULT_NAMESPACE;
}

function normalizeMetricType(
    value
) {
    const normalized =
        String(
            value || ""
        )
            .trim()
            .toLowerCase();

    if (
        !Object.values(
            METRIC_TYPES
        ).includes(
            normalized
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The metric type is invalid.",
            {
                status:
                    400,

                expose:
                    true
            }
        );
    }

    return normalized;
}

function normalizeMetricDimensions(
    value,
    options
) {
    const settings =
        options || {};

    if (
        value === undefined ||
        value === null
    ) {
        return {};
    }

    if (
        typeof value !==
            "object" ||
        Array.isArray(value)
    ) {
        throw new ServiceError(
            "invalid-argument",
            "Metric dimensions must be an object.",
            {
                status:
                    400,

                expose:
                    true
            }
        );
    }

    const keys =
        Object.keys(value)
            .sort();

    const maximumDimensions =
        settings.maxDimensions ||
        DEFAULT_MAX_DIMENSIONS;

    if (
        keys.length >
        maximumDimensions
    ) {
        throw new ServiceError(
            "invalid-argument",
            "Too many metric dimensions were provided.",
            {
                status:
                    400,

                expose:
                    true,

                details: {
                    maximumDimensions:
                        maximumDimensions
                }
            }
        );
    }

    return keys.reduce(
        function (
            output,
            key
        ) {
            const normalizedKey =
                normalizeDimensionComponent(
                    key,
                    "Metric dimension name",
                    settings
                );

            output[
                normalizedKey
            ] =
                normalizeDimensionComponent(
                    value[key],
                    "Metric dimension value",
                    settings
                );

            return output;
        },
        {}
    );
}

function normalizeDimensionComponent(
    value,
    label,
    options
) {
    const settings =
        options || {};

    const normalized =
        String(
            value === undefined ||
            value === null
                ? ""
                : value
        ).trim();

    if (!normalized) {
        throw new ServiceError(
            "invalid-argument",
            label +
            " is invalid.",
            {
                status:
                    400,

                expose:
                    true
            }
        );
    }

    const maximumLength =
        settings.maxDimensionLength ||
        DEFAULT_MAX_DIMENSION_LENGTH;

    if (
        normalized.length >
        maximumLength
    ) {
        throw new ServiceError(
            "invalid-argument",
            label +
            " is too long.",
            {
                status:
                    400,

                expose:
                    true,

                details: {
                    maximumLength:
                        maximumLength
                }
            }
        );
    }

    return normalized;
}

function normalizeFiniteNumber(
    value,
    fallbackOrLabel
) {
    const hasFallback =
        typeof fallbackOrLabel ===
        "number";

    const normalized =
        Number(value);

    if (
        !Number.isFinite(
            normalized
        )
    ) {
        if (hasFallback) {
            return fallbackOrLabel;
        }

        throw new TypeError(
            String(
                fallbackOrLabel ||
                "Value"
            ) +
            " must be a finite number."
        );
    }

    return normalized;
}

function normalizeNonNegativeNumber(
    value,
    label
) {
    const normalized =
        normalizeFiniteNumber(
            value,
            label
        );

    if (
        normalized < 0
    ) {
        throw new TypeError(
            label +
            " must be non-negative."
        );
    }

    return normalized;
}

function normalizeOptionalMetricNumber(
    value
) {
    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {
        return null;
    }

    const normalized =
        Number(value);

    return Number.isFinite(
        normalized
    )
        ? normalized
        : null;
}

function normalizeNonNegativeInteger(
    value,
    fallback,
    label
) {
    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {
        return fallback;
    }

    const normalized =
        Number(value);

    if (
        !Number.isInteger(
            normalized
        ) ||
        normalized < 0
    ) {
        throw new TypeError(
            label +
            " must be a non-negative integer."
        );
    }

    return normalized;
}

function normalizePositiveInteger(
    value,
    fallback,
    label
) {
    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {
        return fallback;
    }

    const normalized =
        Number(value);

    if (
        !Number.isInteger(
            normalized
        ) ||
        normalized <= 0
    ) {
        throw new TypeError(
            label +
            " must be a positive integer."
        );
    }

    return normalized;
}

function normalizeQueryLimit(
    value
) {
    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {
        return DEFAULT_QUERY_LIMIT;
    }

    const normalized =
        Number(value);

    if (
        !Number.isInteger(
            normalized
        ) ||
        normalized <= 0
    ) {
        throw new TypeError(
            "Metrics query limit must be a positive integer."
        );
    }

    return Math.min(
        normalized,
        MAX_QUERY_LIMIT
    );
}

function normalizeMetricOrderField(
    value
) {
    const allowed =
        new Set([
            "updatedAt",
            "createdAt",
            "value",
            "count",
            "total",
            "average",
            "minimum",
            "maximum"
        ]);

    const normalized =
        String(
            value ||
            "updatedAt"
        ).trim();

    return allowed.has(
        normalized
    )
        ? normalized
        : "updatedAt";
}

function normalizeDateFilter(
    value,
    label
) {
    const milliseconds =
        toMilliseconds(
            value
        );

    if (!milliseconds) {
        throw new TypeError(
            label +
            " is invalid."
        );
    }

    return milliseconds;
}

/* ==========================================================
   OPTIONS
========================================================== */

function normalizeMetricsOptions(
    options
) {
    const settings =
        options || {};

    return {
        runtime:
            settings.runtime,

        collection:
            normalizeCollection(
                settings.collection ||
                METRICS_COLLECTION
            ),

        namespace:
            normalizeNamespace(
                settings.namespace ||
                DEFAULT_NAMESPACE
            ),

        dimensions:
            normalizeMetricDimensions(
                settings.dimensions,
                {
                    maxDimensions:
                        settings.maxDimensions,

                    maxDimensionLength:
                        settings
                            .maxDimensionLength
                }
            ),

        metadata:
            sanitizeMetricMetadata(
                settings.metadata
            ),

        retentionMs:
            normalizeNonNegativeInteger(
                settings.retentionMs,
                DEFAULT_RETENTION_MS,
                "Metrics retention"
            ),

        maxDimensions:
            normalizePositiveInteger(
                settings.maxDimensions,
                DEFAULT_MAX_DIMENSIONS,
                "Maximum metric dimensions"
            ),

        maxDimensionLength:
            normalizePositiveInteger(
                settings.maxDimensionLength,
                DEFAULT_MAX_DIMENSION_LENGTH,
                "Maximum metric dimension length"
            ),

        queryLimit:
            normalizeQueryLimit(
                settings.queryLimit
            ),

        disabled:
            Boolean(
                settings.disabled
            ),

        log:
            settings.log !==
            false,

        now:
            settings.now,

        highResolutionNow:
            settings.highResolutionNow
    };
}

function normalizeCollection(
    value
) {
    const collection =
        String(
            value || ""
        ).trim();

    if (
        !collection ||
        collection.includes("/")
    ) {
        throw new TypeError(
            "Metrics collection must be a Firestore collection name."
        );
    }

    return collection;
}

/* ==========================================================
   RUNTIME
========================================================== */

function assertMetricsRuntime(
    runtime
) {
    if (
        !runtime ||
        !runtime.db ||
        typeof runtime.db
            .collection !==
            "function"
    ) {
        throw new ServiceError(
            "configuration-error",
            "The metrics datastore is unavailable.",
            {
                status:
                    500,

                expose:
                    false
            }
        );
    }

    if (
        typeof runtime.db
            .runTransaction !==
            "function"
    ) {
        throw new ServiceError(
            "configuration-error",
            "Firestore transactions are required for metrics.",
            {
                status:
                    500,

                expose:
                    false
            }
        );
    }
}

function resolveNow(
    runtime,
    options
) {
    const settings =
        options || {};

    if (
        typeof settings.now ===
        "function"
    ) {
        return Number(
            settings.now()
        );
    }

    if (
        runtime &&
        typeof runtime.now ===
            "function"
    ) {
        return Number(
            runtime.now()
        );
    }

    return Date.now();
}

function resolveHighResolutionTime(
    options
) {
    const settings =
        options || {};

    if (
        typeof settings
            .highResolutionNow ===
        "function"
    ) {
        return Number(
            settings
                .highResolutionNow()
        );
    }

    if (
        typeof performance !==
            "undefined" &&
        performance &&
        typeof performance.now ===
            "function"
    ) {
        return performance.now();
    }

    return Date.now();
}

function resolveElapsedMilliseconds(
    startedAt,
    options
) {
    const completedAt =
        resolveHighResolutionTime(
            options
        );

    return Math.max(
        0,
        completedAt -
        startedAt
    );
}

function createDatabaseTimestamp(
    runtime,
    milliseconds
) {
    if (
        runtime &&
        runtime.Timestamp &&
        typeof runtime.Timestamp
            .fromMillis ===
            "function"
    ) {
        return runtime.Timestamp
            .fromMillis(
                milliseconds
            );
    }

    return new Date(
        milliseconds
    );
}

function toMilliseconds(
    value
) {
    if (
        value === undefined ||
        value === null
    ) {
        return 0;
    }

    if (
        value instanceof Date
    ) {
        return value.getTime();
    }

    if (
        value &&
        typeof value.toMillis ===
            "function"
    ) {
        return value.toMillis();
    }

    if (
        typeof value ===
        "string"
    ) {
        const parsed =
            Date.parse(value);

        return Number.isNaN(
            parsed
        )
            ? 0
            : parsed;
    }

    const normalized =
        Number(value);

    return Number.isFinite(
        normalized
    )
        ? normalized
        : 0;
}

/* ==========================================================
   SERIALIZATION
========================================================== */

function stableStringify(
    value
) {
    return JSON.stringify(
        normalizeStableValue(
            value
        )
    );
}

function normalizeStableValue(
    value,
    state
) {
    const currentState =
        state || {
            seen:
                new WeakSet()
        };

    if (
        value === undefined
    ) {
        return null;
    }

    if (
        value === null ||
        typeof value ===
            "string" ||
        typeof value ===
            "number" ||
        typeof value ===
            "boolean"
    ) {
        return value;
    }

    if (
        typeof value ===
        "bigint"
    ) {
        return value.toString();
    }

    if (
        value instanceof Date
    ) {
        return value.toISOString();
    }

    if (
        Buffer.isBuffer(value)
    ) {
        return value.toString(
            "base64"
        );
    }

    if (
        typeof value !==
        "object"
    ) {
        return String(value);
    }

    if (
        currentState.seen.has(
            value
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "Metric data contains a circular reference.",
            {
                status:
                    400,

                expose:
                    true
            }
        );
    }

    currentState.seen.add(
        value
    );

    if (
        Array.isArray(value)
    ) {
        const result =
            value.map(
                function (item) {
                    return normalizeStableValue(
                        item,
                        currentState
                    );
                }
            );

        currentState.seen.delete(
            value
        );

        return result;
    }

    const result =
        Object.keys(value)
            .sort()
            .reduce(
                function (
                    output,
                    key
                ) {
                    output[key] =
                        normalizeStableValue(
                            value[key],
                            currentState
                        );

                    return output;
                },
                {}
            );

    currentState.seen.delete(
        value
    );

    return result;
}

function hashMetricKey(
    value
) {
    return crypto
        .createHash(
            "sha256"
        )
        .update(
            String(value)
        )
        .digest(
            "hex"
        );
}

/* ==========================================================
   DATA HELPERS
========================================================== */

function sanitizeMetricMetadata(
    value
) {
    if (
        value === undefined ||
        value === null
    ) {
        return {};
    }

    if (
        typeof value !==
            "object" ||
        Array.isArray(value)
    ) {
        return {
            value:
                cloneValue(value)
        };
    }

    return cloneValue(value);
}

function cloneValue(
    value
) {
    if (
        value === null ||
        value === undefined
    ) {
        return value;
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
            cloneValue
        );
    }

    if (
        typeof value ===
        "object"
    ) {
        if (
            typeof value.toMillis ===
            "function"
        ) {
            return value;
        }

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

function serializeTimestamp(
    value
) {
    const milliseconds =
        toMilliseconds(
            value
        );

    return milliseconds
        ? new Date(
              milliseconds
          ).toISOString()
        : null;
}

/* ==========================================================
   REQUEST INSTRUMENTATION
========================================================== */

function createHttpMetricsMiddleware(
    options
) {
    const settings =
        normalizeMetricsOptions(
            options
        );

    const service =
        settings.service ||
        createMetricsService(
            settings
        );

    return async function metricsMiddleware(
        request,
        response,
        next
    ) {
        const startedAt =
            resolveHighResolutionTime(
                settings
            );

        let finished =
            false;

        async function recordResponse() {
            if (finished) {
                return;
            }

            finished =
                true;

            const durationMs =
                resolveElapsedMilliseconds(
                    startedAt,
                    settings
                );

            const statusCode =
                Number(
                    response &&
                    response.statusCode
                ) ||
                200;

            const dimensions = {
                method:
                    String(
                        request &&
                        request.method ||
                        "UNKNOWN"
                    ).toUpperCase(),

                route:
                    resolveRequestRoute(
                        request
                    ),

                status:
                    String(statusCode),

                outcome:
                    statusCode >= 500
                        ? "error"
                        : statusCode >= 400
                          ? "client-error"
                          : "success"
            };

            await service.timing(
                settings.requestMetricName ||
                "http.request.duration",
                durationMs,
                {
                    dimensions:
                        dimensions
                }
            );

            await service.increment(
                settings.requestCountMetricName ||
                "http.request.count",
                1,
                {
                    dimensions:
                        dimensions
                }
            );
        }

        attachResponseCompletion(
            response,
            recordResponse
        );

        try {
            if (
                typeof next ===
                "function"
            ) {
                const result =
                    next();

                if (
                    result &&
                    typeof result.then ===
                        "function"
                ) {
                    await result;
                }
            }

            return undefined;
        } catch (error) {
            await recordResponse();

            throw error;
        }
    };
}

function createCallableMetricsWrapper(
    handler,
    options
) {
    if (
        typeof handler !==
        "function"
    ) {
        throw new TypeError(
            "Callable metrics wrapper requires a handler function."
        );
    }

    const settings =
        normalizeMetricsOptions(
            options
        );

    const service =
        settings.service ||
        createMetricsService(
            settings
        );

    return async function wrappedCallable(
        request
    ) {
        const startedAt =
            resolveHighResolutionTime(
                settings
            );

        try {
            const result =
                await handler(
                    request
                );

            const durationMs =
                resolveElapsedMilliseconds(
                    startedAt,
                    settings
                );

            await recordCallableMetrics(
                service,
                request,
                durationMs,
                "success",
                settings
            );

            return result;
        } catch (error) {
            const durationMs =
                resolveElapsedMilliseconds(
                    startedAt,
                    settings
                );

            await recordCallableMetrics(
                service,
                request,
                durationMs,
                "failure",
                settings
            );

            throw error;
        }
    };
}

async function recordCallableMetrics(
    service,
    request,
    durationMs,
    outcome,
    options
) {
    const settings =
        options || {};

    const dimensions = {
        callable:
            settings.callableName ||
            "unknown",

        outcome:
            outcome,

        authenticated:
            request &&
            request.auth &&
            request.auth.uid
                ? "true"
                : "false"
    };

    await service.timing(
        settings.callableMetricName ||
        "callable.request.duration",
        durationMs,
        {
            dimensions:
                dimensions
        }
    );

    await service.increment(
        settings.callableCountMetricName ||
        "callable.request.count",
        1,
        {
            dimensions:
                dimensions
        }
    );
}

function attachResponseCompletion(
    response,
    callback
) {
    if (
        !response ||
        typeof callback !==
            "function"
    ) {
        return response;
    }

    if (
        typeof response.once ===
        "function"
    ) {
        response.once(
            "finish",
            callback
        );

        response.once(
            "close",
            callback
        );

        return response;
    }

    const originalEnd =
        response.end;

    if (
        typeof originalEnd ===
        "function"
    ) {
        response.end =
            function wrappedEnd(
                ...args
            ) {
                const result =
                    originalEnd.apply(
                        response,
                        args
                    );

                Promise.resolve(
                    callback()
                ).catch(
                    function () {}
                );

                return result;
            };
    }

    return response;
}

function resolveRequestRoute(
    request
) {
    if (!request) {
        return "unknown";
    }

    return String(
        (
            request.route &&
            request.route.path
        ) ||
        request.path ||
        request.originalUrl ||
        request.url ||
        "unknown"
    );
}

/* ==========================================================
   LOGGING
========================================================== */

function logMetricEvent(
    runtime,
    record,
    options
) {
    const settings =
        options || {};

    if (
        !settings.log ||
        !runtime ||
        !runtime.logger ||
        typeof runtime.logger.debug !==
            "function"
    ) {
        return;
    }

    runtime.logger.debug(
        "Metric recorded.",
        {
            name:
                record.name,

            namespace:
                record.namespace,

            type:
                record.type,

            value:
                record.value,

            count:
                record.count,

            dimensions:
                record.dimensions
        }
    );
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
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
    constants: {
        METRICS_COLLECTION,
        DEFAULT_NAMESPACE,
        DEFAULT_RETENTION_MS,
        DEFAULT_MAX_DIMENSIONS,
        DEFAULT_MAX_DIMENSION_LENGTH,
        DEFAULT_QUERY_LIMIT,
        MAX_QUERY_LIMIT,
        METRIC_TYPES
    }
};