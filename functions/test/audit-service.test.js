"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   AUDIT SERVICE TEST SUITE
========================================================== */

const test =
    require("node:test");

const assert =
    require("node:assert/strict");

const {
    createAuditService,
    recordAuditEvent,
    normalizeAuditEvent,
    resolveAuditActor,
    normalizeAuditActor,
    normalizeAuditResource,
    normalizeAuditRequest,
    getAuditEvent,
    queryAuditEvents,
    normalizeAuditQuery,
    serializeAuditError,
    sanitizeAuditRecord,
    sanitizeAuditMetadata,
    isSensitiveAuditKey,
    normalizeAuditOutcome,
    normalizeAuditSeverity,
    inferAuditSeverity,
    normalizeEventType,
    normalizeAuditAction,
    normalizeServiceName,
    normalizeAuditId,
    normalizeAuditTags,
    normalizeOptionalString,
    normalizeOptionalNumber,
    normalizeQueryLimit,
    normalizeDateFilter,
    truncateString,
    normalizeAuditOptions,
    normalizeCollection,
    normalizePositiveInteger,
    normalizeNonNegativeInteger,
    assertAuditRuntime,
    resolveNow,
    createDatabaseTimestamp,
    toMilliseconds,
    resolveRequestHeader,
    resolveRequestIp,
    generateAuditId,
    logAuditEvent,
    serializeTimestamp,
    constants
} = require(
    "../src/shared/audit-service"
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
                value,
                segment
            ) {
                if (
                    value === null ||
                    value === undefined
                ) {
                    return undefined;
                }

                return value[
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

    function createDocumentSnapshot(
        path
    ) {
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

    function createDocumentReference(
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
                    return createDocumentSnapshot(
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
                                const firstValue =
                                    getNestedValue(
                                        first.value,
                                        queryState
                                            .order
                                            .field
                                    );

                                const secondValue =
                                    getNestedValue(
                                        second.value,
                                        queryState
                                            .order
                                            .field
                                    );

                                const left =
                                    firstValue &&
                                    typeof firstValue
                                        .toMillis ===
                                        "function"
                                        ? firstValue
                                            .toMillis()
                                        : firstValue;

                                const right =
                                    secondValue &&
                                    typeof secondValue
                                        .toMillis ===
                                        "function"
                                        ? secondValue
                                            .toMillis()
                                        : secondValue;

                                const direction =
                                    queryState
                                        .order
                                        .direction ===
                                    "asc"
                                        ? 1
                                        : -1;

                                if (
                                    left <
                                    right
                                ) {
                                    return -1 *
                                        direction;
                                }

                                if (
                                    left >
                                    right
                                ) {
                                    return 1 *
                                        direction;
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
                const query =
                    createQuery(
                        collectionName
                    );

                return Object.assign(
                    {},
                    query,
                    {
                        doc:
                            function (
                                documentId
                            ) {
                                return createDocumentReference(
                                    collectionName,
                                    documentId
                                );
                            }
                    }
                );
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
            },

        listDocuments:
            function () {
                return Array.from(
                    documents.entries()
                ).map(
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
            }
    };
}

function createLoggerStub() {
    const entries = [];

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

/* ==========================================================
   SERVICE FACTORY
========================================================== */

test(
    "createAuditService creates a frozen service",
    function () {
        const runtime =
            createRuntime();

        const service =
            createAuditService({
                runtime:
                    runtime,

                service:
                    "store-api",

                eventType:
                    "application.action"
            });

        assert.equal(
            service.runtime,
            runtime
        );

        assert.equal(
            service.options.service,
            "store-api"
        );

        assert.equal(
            service.options.eventType,
            "application.action"
        );

        assert.equal(
            typeof service.record,
            "function"
        );

        assert.equal(
            typeof service.success,
            "function"
        );

        assert.equal(
            typeof service.failure,
            "function"
        );

        assert.equal(
            typeof service.denied,
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
   OPTION NORMALIZATION
========================================================== */

test(
    "normalizeAuditOptions applies defaults",
    function () {
        const options =
            normalizeAuditOptions(
                {}
            );

        assert.equal(
            options.collection,
            constants
                .AUDIT_COLLECTION
        );

        assert.equal(
            options.service,
            constants
                .DEFAULT_SERVICE
        );

        assert.equal(
            options.eventType,
            constants
                .DEFAULT_EVENT_TYPE
        );

        assert.equal(
            options.defaultOutcome,
            constants
                .DEFAULT_OUTCOME
        );

        assert.equal(
            options.retentionMs,
            0
        );

        assert.equal(
            options.maxMetadataDepth,
            constants
                .DEFAULT_MAX_METADATA_DEPTH
        );

        assert.equal(
            options.maxStringLength,
            constants
                .DEFAULT_MAX_STRING_LENGTH
        );

        assert.equal(
            options.maxArrayLength,
            constants
                .DEFAULT_MAX_ARRAY_LENGTH
        );

        assert.equal(
            options.queryLimit,
            constants
                .DEFAULT_QUERY_LIMIT
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
    "normalizeAuditOptions respects overrides",
    function () {
        const options =
            normalizeAuditOptions({
                collection:
                    "auditEvents",

                service:
                    "admin-api",

                eventType:
                    "admin.action",

                defaultOutcome:
                    "unknown",

                retentionMs:
                    10000,

                maxMetadataDepth:
                    4,

                maxStringLength:
                    100,

                maxArrayLength:
                    10,

                queryLimit:
                    25,

                disabled:
                    true,

                log:
                    false
            });

        assert.equal(
            options.collection,
            "auditEvents"
        );

        assert.equal(
            options.service,
            "admin-api"
        );

        assert.equal(
            options.eventType,
            "admin.action"
        );

        assert.equal(
            options.defaultOutcome,
            "unknown"
        );

        assert.equal(
            options.retentionMs,
            10000
        );

        assert.equal(
            options.maxMetadataDepth,
            4
        );

        assert.equal(
            options.maxStringLength,
            100
        );

        assert.equal(
            options.maxArrayLength,
            10
        );

        assert.equal(
            options.queryLimit,
            25
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
    "normalizeCollection validates Firestore collection names",
    function () {
        assert.equal(
            normalizeCollection(
                "_auditLogs"
            ),
            "_auditLogs"
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
                    "internal/audit"
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

        assert.equal(
            normalizeNonNegativeInteger(
                0,
                10,
                "Value"
            ),
            0
        );

        assert.equal(
            normalizeNonNegativeInteger(
                "20",
                10,
                "Value"
            ),
            20
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
   EVENT NORMALIZATION
========================================================== */

test(
    "normalizeAuditEvent creates a complete audit record",
    function () {
        const runtime =
            createRuntime({
                now:
                    function () {
                        return 1000;
                    }
            });

        const event =
            normalizeAuditEvent(
                {
                    id:
                        "event-1",

                    type:
                        "order.created",

                    action:
                        "create-order",

                    category:
                        "orders",

                    description:
                        "Customer created an order.",

                    outcome:
                        "success",

                    severity:
                        "info",

                    actor: {
                        id:
                            "customer-1",

                        email:
                            "customer@example.com",

                        role:
                            "customer"
                    },

                    resource: {
                        type:
                            "order",

                        id:
                            "order-1",

                        ownerId:
                            "customer-1"
                    },

                    metadata: {
                        amount:
                            250000
                    },

                    tags: [
                        "Orders",
                        "Checkout"
                    ],

                    occurredAt:
                        500
                },
                {
                    service:
                        "store-api",

                    retentionMs:
                        10000
                },
                runtime
            );

        assert.equal(
            event.id,
            "event-1"
        );

        assert.equal(
            event.type,
            "order.created"
        );

        assert.equal(
            event.action,
            "create-order"
        );

        assert.equal(
            event.service,
            "store-api"
        );

        assert.equal(
            event.category,
            "orders"
        );

        assert.equal(
            event.outcome,
            "success"
        );

        assert.equal(
            event.severity,
            "info"
        );

        assert.equal(
            event.actor.id,
            "customer-1"
        );

        assert.equal(
            event.resource.id,
            "order-1"
        );

        assert.deepEqual(
            event.tags,
            [
                "orders",
                "checkout"
            ]
        );

        assert.equal(
            event.occurredAt.toMillis(),
            500
        );

        assert.equal(
            event.recordedAt.toMillis(),
            1000
        );

        assert.equal(
            event.expiresAt.toMillis(),
            11000
        );

        assert.equal(
            event.schemaVersion,
            1
        );
    }
);

test(
    "normalizeAuditEvent infers failure outcome from error",
    function () {
        const error =
            new ServiceError(
                "payment-failed",
                "Payment failed.",
                {
                    status:
                        402
                }
            );

        const event =
            normalizeAuditEvent(
                {
                    id:
                        "event-1",

                    type:
                        "payment.failed",

                    error:
                        error
                },
                {},
                createRuntime()
            );

        assert.equal(
            event.outcome,
            "failure"
        );

        assert.equal(
            event.severity,
            "warning"
        );

        assert.equal(
            event.error.code,
            "payment-failed"
        );
    }
);

test(
    "normalizeAuditEvent rejects non-object events",
    function () {
        assert.throws(
            function () {
                normalizeAuditEvent(
                    "invalid",
                    {},
                    createRuntime()
                );
            },
            /must be an object/
        );
    }
);

/* ==========================================================
   ACTOR NORMALIZATION
========================================================== */

test(
    "resolveAuditActor extracts authenticated request identity",
    function () {
        const actor =
            resolveAuditActor({
                auth: {
                    uid:
                        "customer-1",

                    token: {
                        email:
                            "customer@example.com",

                        role:
                            "customer"
                    }
                },

                headers: {
                    "user-agent":
                        "Test Browser",

                    "x-forwarded-for":
                        "203.0.113.10, 198.51.100.20"
                },

                ip:
                    "127.0.0.1"
            });

        assert.deepEqual(
            actor,
            {
                id:
                    "customer-1",

                type:
                    "user",

                email:
                    "customer@example.com",

                role:
                    "customer",

                ip:
                    "203.0.113.10",

                userAgent:
                    "Test Browser"
            }
        );
    }
);

test(
    "resolveAuditActor returns anonymous identity",
    function () {
        const actor =
            resolveAuditActor({
                ip:
                    "127.0.0.1"
            });

        assert.equal(
            actor.id,
            null
        );

        assert.equal(
            actor.type,
            "anonymous"
        );

        assert.equal(
            actor.ip,
            "127.0.0.1"
        );
    }
);

test(
    "normalizeAuditActor supports alternate identity fields",
    function () {
        assert.deepEqual(
            normalizeAuditActor({
                uid:
                    "admin-1",

                type:
                    "administrator",

                email:
                    "admin@example.com",

                role:
                    "admin"
            }),
            {
                id:
                    "admin-1",

                type:
                    "administrator",

                email:
                    "admin@example.com",

                role:
                    "admin",

                ip:
                    null,

                userAgent:
                    null
            }
        );
    }
);

/* ==========================================================
   RESOURCE AND REQUEST NORMALIZATION
========================================================== */

test(
    "normalizeAuditResource supports string resources",
    function () {
        assert.deepEqual(
            normalizeAuditResource(
                "order-1"
            ),
            {
                type:
                    null,

                id:
                    "order-1",

                path:
                    null,

                ownerId:
                    null
            }
        );
    }
);

test(
    "normalizeAuditResource normalizes object resources",
    function () {
        assert.deepEqual(
            normalizeAuditResource({
                collection:
                    "orders",

                resourceId:
                    "order-1",

                path:
                    "orders/order-1",

                ownerId:
                    "customer-1"
            }),
            {
                type:
                    "orders",

                id:
                    "order-1",

                path:
                    "orders/order-1",

                ownerId:
                    "customer-1"
            }
        );
    }
);

test(
    "normalizeAuditRequest extracts request context",
    function () {
        const result =
            normalizeAuditRequest({
                method:
                    "POST",

                originalUrl:
                    "/orders",

                ip:
                    "127.0.0.1",

                headers: {
                    "user-agent":
                        "Test Browser"
                },

                requestContext: {
                    requestId:
                        "req_123",

                    correlationId:
                        "corr_123"
                }
            });

        assert.deepEqual(
            result,
            {
                requestId:
                    "req_123",

                correlationId:
                    "corr_123",

                method:
                    "POST",

                path:
                    "/orders",

                ip:
                    "127.0.0.1",

                userAgent:
                    "Test Browser"
            }
        );
    }
);

test(
    "normalizeAuditRequest returns null fields without input",
    function () {
        assert.deepEqual(
            normalizeAuditRequest(
                null
            ),
            {
                requestId:
                    null,

                correlationId:
                    null,

                method:
                    null,

                path:
                    null,

                ip:
                    null,

                userAgent:
                    null
            }
        );
    }
);

/* ==========================================================
   RECORDING
========================================================== */

test(
    "recordAuditEvent stores an audit record",
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
            await recordAuditEvent(
                runtime,
                {
                    id:
                        "event-1",

                    type:
                        "order.created",

                    actor: {
                        id:
                            "customer-1"
                    },

                    resource: {
                        type:
                            "order",

                        id:
                            "order-1"
                    },

                    metadata: {
                        amount:
                            250000
                    }
                },
                {
                    service:
                        "store-api"
                }
            );

        assert.equal(
            result.recorded,
            true
        );

        assert.equal(
            result.disabled,
            false
        );

        assert.equal(
            result.eventId,
            "event-1"
        );

        assert.equal(
            result.event.type,
            "order.created"
        );

        const stored =
            firestore.getDocument(
                constants
                    .AUDIT_COLLECTION +
                "/event-1"
            );

        assert.equal(
            stored.id,
            "event-1"
        );

        assert.equal(
            stored.service,
            "store-api"
        );

        assert.equal(
            stored.occurredAt
                instanceof
                TestTimestamp,
            true
        );
    }
);

test(
    "recordAuditEvent returns normalized event when disabled",
    async function () {
        const result =
            await recordAuditEvent(
                null,
                {
                    id:
                        "event-1",

                    type:
                        "order.created"
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
            result.recorded,
            false
        );

        assert.equal(
            result.disabled,
            true
        );

        assert.equal(
            result.event.id,
            "event-1"
        );

        assert.equal(
            result.event.occurredAt,
            new Date(
                1000
            ).toISOString()
        );
    }
);

test(
    "audit service outcome helpers override event outcomes",
    async function () {
        const service =
            createAuditService({
                runtime:
                    createRuntime(),

                disabled:
                    true,

                now:
                    function () {
                        return 1000;
                    }
            });

        const success =
            await service.success({
                id:
                    "success-event"
            });

        const failure =
            await service.failure({
                id:
                    "failure-event"
            });

        const denied =
            await service.denied({
                id:
                    "denied-event"
            });

        assert.equal(
            success.event.outcome,
            "success"
        );

        assert.equal(
            failure.event.outcome,
            "failure"
        );

        assert.equal(
            denied.event.outcome,
            "denied"
        );
    }
);

/* ==========================================================
   READ EVENT
========================================================== */

test(
    "getAuditEvent returns a stored event",
    async function () {
        const runtime =
            createRuntime();

        await recordAuditEvent(
            runtime,
            {
                id:
                    "event-1",

                type:
                    "account.updated"
            },
            {
                now:
                    function () {
                        return 1000;
                    }
            }
        );

        const event =
            await getAuditEvent(
                runtime,
                "event-1"
            );

        assert.equal(
            event.id,
            "event-1"
        );

        assert.equal(
            event.type,
            "account.updated"
        );

        assert.equal(
            event.recordedAt,
            new Date(
                1000
            ).toISOString()
        );
    }
);

test(
    "getAuditEvent returns null for missing events",
    async function () {
        assert.equal(
            await getAuditEvent(
                createRuntime(),
                "missing-event"
            ),
            null
        );
    }
);

test(
    "getAuditEvent returns null when disabled",
    async function () {
        assert.equal(
            await getAuditEvent(
                null,
                "event-1",
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
   QUERY EVENTS
========================================================== */

test(
    "queryAuditEvents filters and orders records",
    async function () {
        const firestore =
            createFirestoreStub({
                "_auditLogs/event-1": {
                    id:
                        "event-1",

                    type:
                        "order.created",

                    action:
                        "order.create",

                    outcome:
                        "success",

                    severity:
                        "info",

                    actor: {
                        id:
                            "customer-1"
                    },

                    resource: {
                        id:
                            "order-1"
                    },

                    request: {
                        requestId:
                            "req_1"
                    },

                    occurredAt:
                        TestTimestamp
                            .fromMillis(
                                1000
                            ),

                    recordedAt:
                        TestTimestamp
                            .fromMillis(
                                1000
                            ),

                    metadata:
                        {},

                    tags:
                        []
                },

                "_auditLogs/event-2": {
                    id:
                        "event-2",

                    type:
                        "order.created",

                    action:
                        "order.create",

                    outcome:
                        "failure",

                    severity:
                        "warning",

                    actor: {
                        id:
                            "customer-2"
                    },

                    resource: {
                        id:
                            "order-2"
                    },

                    request: {
                        requestId:
                            "req_2"
                    },

                    occurredAt:
                        TestTimestamp
                            .fromMillis(
                                2000
                            ),

                    recordedAt:
                        TestTimestamp
                            .fromMillis(
                                2000
                            ),

                    metadata:
                        {},

                    tags:
                        []
                },

                "_auditLogs/event-3": {
                    id:
                        "event-3",

                    type:
                        "account.updated",

                    action:
                        "account.update",

                    outcome:
                        "success",

                    severity:
                        "info",

                    actor: {
                        id:
                            "customer-1"
                    },

                    resource: {
                        id:
                            "customer-1"
                    },

                    request: {
                        requestId:
                            "req_3"
                    },

                    occurredAt:
                        TestTimestamp
                            .fromMillis(
                                3000
                            ),

                    recordedAt:
                        TestTimestamp
                            .fromMillis(
                                3000
                            ),

                    metadata:
                        {},

                    tags:
                        []
                }
            });

        const events =
            await queryAuditEvents(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    type:
                        "order.created",

                    direction:
                        "desc",

                    limit:
                        10
                }
            );

        assert.deepEqual(
            events.map(
                function (event) {
                    return event.id;
                }
            ),
            [
                "event-2",
                "event-1"
            ]
        );
    }
);

test(
    "queryAuditEvents supports actor and date filters",
    async function () {
        const firestore =
            createFirestoreStub({
                "_auditLogs/event-1": {
                    id:
                        "event-1",

                    type:
                        "order.created",

                    action:
                        "order.create",

                    outcome:
                        "success",

                    severity:
                        "info",

                    actor: {
                        id:
                            "customer-1"
                    },

                    resource: {
                        id:
                            "order-1"
                    },

                    request: {
                        requestId:
                            "req_1"
                    },

                    occurredAt:
                        TestTimestamp
                            .fromMillis(
                                1000
                            ),

                    metadata:
                        {},

                    tags:
                        []
                },

                "_auditLogs/event-2": {
                    id:
                        "event-2",

                    type:
                        "order.created",

                    action:
                        "order.create",

                    outcome:
                        "success",

                    severity:
                        "info",

                    actor: {
                        id:
                            "customer-1"
                    },

                    resource: {
                        id:
                            "order-2"
                    },

                    request: {
                        requestId:
                            "req_2"
                    },

                    occurredAt:
                        TestTimestamp
                            .fromMillis(
                                3000
                            ),

                    metadata:
                        {},

                    tags:
                        []
                }
            });

        const events =
            await queryAuditEvents(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    actorId:
                        "customer-1",

                    from:
                        2000,

                    to:
                        4000
                }
            );

        assert.deepEqual(
            events.map(
                function (event) {
                    return event.id;
                }
            ),
            [
                "event-2"
            ]
        );
    }
);

test(
    "queryAuditEvents returns empty array when disabled",
    async function () {
        assert.deepEqual(
            await queryAuditEvents(
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
    "normalizeAuditQuery normalizes filters",
    function () {
        assert.deepEqual(
            normalizeAuditQuery(
                {
                    type:
                        "Order Created",

                    action:
                        "Create Order",

                    outcome:
                        "SUCCESS",

                    severity:
                        "WARNING",

                    actorId:
                        " customer-1 ",

                    resourceId:
                        " order-1 ",

                    requestId:
                        " req_123 ",

                    from:
                        1000,

                    to:
                        2000,

                    limit:
                        25,

                    direction:
                        "ASC"
                },
                {}
            ),
            {
                type:
                    "order.created",

                action:
                    "create.order",

                outcome:
                    "success",

                severity:
                    "warning",

                actorId:
                    "customer-1",

                resourceId:
                    "order-1",

                requestId:
                    "req_123",

                from:
                    1000,

                to:
                    2000,

                limit:
                    25,

                direction:
                    "asc"
            }
        );
    }
);

test(
    "normalizeQueryLimit clamps values to maximum",
    function () {
        assert.equal(
            normalizeQueryLimit(
                undefined
            ),
            constants
                .DEFAULT_QUERY_LIMIT
        );

        assert.equal(
            normalizeQueryLimit(
                1000
            ),
            constants
                .MAX_QUERY_LIMIT
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
    "normalizeDateFilter validates dates",
    function () {
        assert.equal(
            normalizeDateFilter(
                "1970-01-01T00:00:01.000Z",
                "Date"
            ),
            1000
        );

        assert.throws(
            function () {
                normalizeDateFilter(
                    "invalid",
                    "Date"
                );
            },
            /is invalid/
        );
    }
);

/* ==========================================================
   METADATA SANITIZATION
========================================================== */

test(
    "sanitizeAuditMetadata redacts sensitive fields",
    function () {
        const result =
            sanitizeAuditMetadata({
                password:
                    "secret",

                authorization:
                    "Bearer private",

                refreshToken:
                    "private-token",

                nested: {
                    apiKey:
                        "private-key"
                },

                safe:
                    "visible"
            });

        assert.deepEqual(
            result,
            {
                authorization:
                    "[REDACTED]",

                nested: {
                    apiKey:
                        "[REDACTED]"
                },

                password:
                    "[REDACTED]",

                refreshToken:
                    "[REDACTED]",

                safe:
                    "visible"
            }
        );
    }
);

test(
    "sanitizeAuditMetadata handles dates, buffers, errors, and bigint",
    function () {
        const error =
            new Error(
                "Failure."
            );

        error.code =
            "test-error";

        const result =
            sanitizeAuditMetadata({
                date:
                    new Date(
                        "2026-07-20T09:00:00.000Z"
                    ),

                buffer:
                    Buffer.from(
                        "hello"
                    ),

                error:
                    error,

                amount:
                    10n
            });

        assert.equal(
            result.date,
            "2026-07-20T09:00:00.000Z"
        );

        assert.equal(
            result.buffer,
            "[Buffer 5 bytes]"
        );

        assert.equal(
            result.error.code,
            "test-error"
        );

        assert.equal(
            result.amount,
            "10"
        );
    }
);

test(
    "sanitizeAuditMetadata truncates strings and arrays",
    function () {
        const result =
            sanitizeAuditMetadata(
                {
                    message:
                        "x".repeat(50),

                    items: [
                        1,
                        2,
                        3,
                        4
                    ]
                },
                {
                    maxStringLength:
                        20,

                    maxArrayLength:
                        2
                }
            );

        assert.equal(
            result.message.length <=
                20,
            true
        );

        assert.match(
            result.message,
            /\[TRUNCATED\]$/
        );

        assert.deepEqual(
            result.items,
            [
                1,
                2
            ]
        );
    }
);

test(
    "sanitizeAuditMetadata handles circular values",
    function () {
        const value = {
            safe:
                true
        };

        value.self =
            value;

        const result =
            sanitizeAuditMetadata(
                value
            );

        assert.equal(
            result.self,
            "[Circular]"
        );
    }
);

test(
    "sanitizeAuditMetadata limits nesting depth",
    function () {
        const result =
            sanitizeAuditMetadata(
                {
                    first: {
                        second: {
                            third: {
                                value:
                                    true
                            }
                        }
                    }
                },
                {
                    maxMetadataDepth:
                        2
                }
            );

        assert.equal(
            result
                .first
                .second
                .third,
            "[Maximum depth reached]"
        );
    }
);

test(
    "isSensitiveAuditKey detects sensitive names",
    function () {
        assert.equal(
            isSensitiveAuditKey(
                "password"
            ),
            true
        );

        assert.equal(
            isSensitiveAuditKey(
                "refresh_token"
            ),
            true
        );

        assert.equal(
            isSensitiveAuditKey(
                "customerApiKey"
            ),
            true
        );

        assert.equal(
            isSensitiveAuditKey(
                "orderId"
            ),
            false
        );
    }
);

/* ==========================================================
   ERROR AND RECORD SERIALIZATION
========================================================== */

test(
    "serializeAuditError returns safe error metadata",
    function () {
        const error =
            new ServiceError(
                "permission-denied",
                "Admin access required.",
                {
                    status:
                        403,

                    retryable:
                        false
                }
            );

        assert.deepEqual(
            serializeAuditError(
                error
            ),
            {
                name:
                    "ServiceError",

                code:
                    "permission-denied",

                message:
                    "Admin access required.",

                status:
                    403,

                retryable:
                    false
            }
        );
    }
);

test(
    "sanitizeAuditRecord serializes timestamps",
    function () {
        const record =
            sanitizeAuditRecord({
                id:
                    "event-1",

                type:
                    "order.created",

                action:
                    "order.create",

                service:
                    "store-api",

                outcome:
                    "success",

                severity:
                    "info",

                actor:
                    {},

                resource:
                    {},

                request:
                    {},

                error:
                    null,

                metadata:
                    {},

                tags:
                    [
                        "orders"
                    ],

                occurredAt:
                    TestTimestamp
                        .fromMillis(
                            1000
                        ),

                recordedAt:
                    TestTimestamp
                        .fromMillis(
                            2000
                        ),

                expiresAt:
                    TestTimestamp
                        .fromMillis(
                            3000
                        ),

                schemaVersion:
                    1
            });

        assert.equal(
            record.occurredAt,
            new Date(
                1000
            ).toISOString()
        );

        assert.equal(
            record.recordedAt,
            new Date(
                2000
            ).toISOString()
        );

        assert.equal(
            record.expiresAt,
            new Date(
                3000
            ).toISOString()
        );
    }
);

/* ==========================================================
   NORMALIZERS
========================================================== */

test(
    "outcome and severity normalizers handle invalid values",
    function () {
        assert.equal(
            normalizeAuditOutcome(
                "SUCCESS"
            ),
            "success"
        );

        assert.equal(
            normalizeAuditOutcome(
                "invalid"
            ),
            "unknown"
        );

        assert.equal(
            normalizeAuditSeverity(
                "CRITICAL"
            ),
            "critical"
        );

        assert.equal(
            normalizeAuditSeverity(
                "invalid"
            ),
            "info"
        );
    }
);

test(
    "inferAuditSeverity maps outcomes and errors",
    function () {
        assert.equal(
            inferAuditSeverity(
                "success",
                null
            ),
            "info"
        );

        assert.equal(
            inferAuditSeverity(
                "denied",
                null
            ),
            "warning"
        );

        assert.equal(
            inferAuditSeverity(
                "failure",
                {
                    status:
                        400
                }
            ),
            "warning"
        );

        assert.equal(
            inferAuditSeverity(
                "failure",
                {
                    status:
                        500
                }
            ),
            "error"
        );
    }
);

test(
    "event and action normalizers sanitize text",
    function () {
        assert.equal(
            normalizeEventType(
                " Order Created "
            ),
            "order.created"
        );

        assert.equal(
            normalizeAuditAction(
                "Create Order"
            ),
            "create.order"
        );

        assert.equal(
            normalizeEventType(
                ""
            ),
            constants
                .DEFAULT_EVENT_TYPE
        );
    }
);

test(
    "normalizeServiceName applies defaults",
    function () {
        assert.equal(
            normalizeServiceName(
                " Store API "
            ),
            "Store API"
        );

        assert.equal(
            normalizeServiceName(
                ""
            ),
            constants
                .DEFAULT_SERVICE
        );
    }
);

test(
    "normalizeAuditId validates event IDs",
    function () {
        assert.equal(
            normalizeAuditId(
                " event-1 "
            ),
            "event-1"
        );

        assert.throws(
            function () {
                normalizeAuditId(
                    ""
                );
            },
            /ID is invalid/
        );

        assert.throws(
            function () {
                normalizeAuditId(
                    "events/event-1"
                );
            },
            /ID is invalid/
        );
    }
);

test(
    "normalizeAuditTags normalizes and deduplicates tags",
    function () {
        assert.deepEqual(
            normalizeAuditTags([
                "Orders",
                " checkout ",
                "orders",
                ""
            ]),
            [
                "orders",
                "checkout"
            ]
        );

        assert.deepEqual(
            normalizeAuditTags(
                "Admin"
            ),
            [
                "admin"
            ]
        );
    }
);

test(
    "optional value normalizers handle empty values",
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
            normalizeOptionalNumber(
                "403"
            ),
            403
        );

        assert.equal(
            normalizeOptionalNumber(
                "invalid"
            ),
            null
        );
    }
);

test(
    "truncateString preserves and truncates values",
    function () {
        assert.equal(
            truncateString(
                "short",
                10
            ),
            "short"
        );

        const truncated =
            truncateString(
                "x".repeat(50),
                20
            );

        assert.equal(
            truncated.length <=
                20,
            true
        );

        assert.match(
            truncated,
            /\[TRUNCATED\]$/
        );
    }
);

/* ==========================================================
   RUNTIME AND REQUEST HELPERS
========================================================== */

test(
    "assertAuditRuntime accepts a valid runtime",
    function () {
        assert.doesNotThrow(
            function () {
                assertAuditRuntime(
                    createRuntime()
                );
            }
        );
    }
);

test(
    "assertAuditRuntime rejects unavailable datastore",
    function () {
        assert.throws(
            function () {
                assertAuditRuntime(
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
    "toMilliseconds supports common timestamp values",
    function () {
        assert.equal(
            toMilliseconds(
                new Date(
                    1000
                )
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

test(
    "resolveRequestHeader supports case-insensitive headers",
    function () {
        assert.equal(
            resolveRequestHeader(
                {
                    headers: {
                        "User-Agent":
                            "Browser"
                    }
                },
                "user-agent"
            ),
            "Browser"
        );

        assert.equal(
            resolveRequestHeader(
                null,
                "user-agent"
            ),
            null
        );
    }
);

test(
    "resolveRequestIp prefers forwarded address",
    function () {
        assert.equal(
            resolveRequestIp({
                headers: {
                    "x-forwarded-for":
                        "203.0.113.10, 198.51.100.20"
                },

                ip:
                    "127.0.0.1"
            }),
            "203.0.113.10"
        );

        assert.equal(
            resolveRequestIp({
                ip:
                    "127.0.0.1"
            }),
            "127.0.0.1"
        );
    }
);

/* ==========================================================
   ID GENERATION
========================================================== */

test(
    "generateAuditId creates valid unique identifiers",
    function () {
        const first =
            generateAuditId(
                1000
            );

        const second =
            generateAuditId(
                1000
            );

        assert.match(
            first,
            /^[a-z0-9]+_[a-f0-9]+$/
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
    "logAuditEvent logs informational events",
    function () {
        const logger =
            createLoggerStub();

        logAuditEvent(
            {
                logger:
                    logger
            },
            {
                id:
                    "event-1",

                type:
                    "order.created",

                action:
                    "order.create",

                outcome:
                    "success",

                severity:
                    "info",

                actor: {
                    id:
                        "customer-1"
                },

                resource: {
                    id:
                        "order-1"
                },

                request: {
                    requestId:
                        "req_123"
                }
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
            "info"
        );

        assert.equal(
            logger.entries[0].message,
            "Audit event recorded."
        );
    }
);

test(
    "logAuditEvent logs warnings and errors appropriately",
    function () {
        const logger =
            createLoggerStub();

        logAuditEvent(
            {
                logger:
                    logger
            },
            {
                id:
                    "warning-event",

                severity:
                    "warning",

                actor:
                    {},

                resource:
                    {},

                request:
                    {}
            },
            {
                log:
                    true
            }
        );

        logAuditEvent(
            {
                logger:
                    logger
            },
            {
                id:
                    "error-event",

                severity:
                    "error",

                actor:
                    {},

                resource:
                    {},

                request:
                    {}
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
            logger.entries[1].level,
            "error"
        );
    }
);

test(
    "logAuditEvent can be disabled",
    function () {
        const logger =
            createLoggerStub();

        logAuditEvent(
            {
                logger:
                    logger
            },
            {
                severity:
                    "info"
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
   TIMESTAMP SERIALIZATION
========================================================== */

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
   CONSTANTS
========================================================== */

test(
    "audit constants expose expected defaults",
    function () {
        assert.equal(
            constants
                .AUDIT_COLLECTION,
            "_auditLogs"
        );

        assert.equal(
            constants
                .DEFAULT_SERVICE,
            "leternel-store"
        );

        assert.equal(
            constants
                .DEFAULT_EVENT_TYPE,
            "application.event"
        );

        assert.equal(
            constants
                .DEFAULT_OUTCOME,
            "success"
        );

        assert.equal(
            constants
                .DEFAULT_MAX_METADATA_DEPTH,
            8
        );

        assert.equal(
            constants
                .DEFAULT_MAX_STRING_LENGTH,
            5000
        );

        assert.equal(
            constants
                .DEFAULT_MAX_ARRAY_LENGTH,
            100
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
                .AUDIT_OUTCOMES,
            {
                success:
                    "success",

                failure:
                    "failure",

                denied:
                    "denied",

                unknown:
                    "unknown"
            }
        );

        assert.deepEqual(
            constants
                .AUDIT_SEVERITIES,
            {
                debug:
                    "debug",

                info:
                    "info",

                warning:
                    "warning",

                error:
                    "error",

                critical:
                    "critical"
            }
        );

        assert.equal(
            Array.isArray(
                constants
                    .SENSITIVE_KEYS
            ),
            true
        );

        assert.equal(
            constants
                .SENSITIVE_KEYS
                .includes(
                    "password"
                ),
            true
        );
    }
);