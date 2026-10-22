"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   WEBHOOK SERVICE TEST SUITE
========================================================== */

const test =
    require("node:test");

const assert =
    require("node:assert/strict");

const {
    createWebhookService,
    registerWebhook,
    updateWebhook,
    normalizeWebhookUpdate,
    getWebhook,
    queryWebhooks,
    normalizeWebhookQuery,
    queueWebhookDelivery,
    deliverWebhook,
    claimWebhookDelivery,
    isWebhookDeliveryClaimable,
    sendWebhookRequest,
    completeWebhookDelivery,
    failClaimedWebhookDelivery,
    cancelWebhookDelivery,
    normalizeWebhookRecord,
    normalizeWebhookDeliveryRecord,
    assertWebhookCanReceiveEvent,
    createWebhookSignature,
    verifyWebhookSignature,
    parseWebhookSignature,
    timingSafeEqualStrings,
    isRetryableWebhookError,
    resolveWebhookRetryDelay,
    getRetryAfterMilliseconds,
    readWebhookResponseBody,
    normalizeResponseHeaders,
    sanitizeWebhookResponse,
    isSuccessfulHttpStatus,
    sanitizeWebhookRecord,
    sanitizeWebhookDeliveryRecord,
    sanitizeWebhookHeaders,
    sanitizeWebhookMetadata,
    normalizeWebhookId,
    normalizeWebhookDeliveryId,
    normalizeWebhookUrl,
    normalizeWebhookStatus,
    normalizeWebhookDeliveryStatus,
    normalizeWebhookEvent,
    normalizeWebhookEvents,
    normalizeWebhookSecret,
    normalizeSigningAlgorithm,
    normalizeWebhookPayloadString,
    normalizeSignatureTimestamp,
    normalizeWebhookOrderField,
    normalizeQueryLimit,
    normalizePositiveInteger,
    normalizeNonNegativeInteger,
    normalizePositiveNumber,
    normalizeOptionalString,
    normalizeCollection,
    normalizeWebhookOptions,
    normalizeHeaderName,
    normalizeWebhookDate,
    createWebhookId,
    createWebhookDeliveryId,
    createRandomIdentifier,
    generateWebhookSecret,
    createWebhookFingerprint,
    hashWebhookValue,
    stableStringify,
    normalizeStableValue,
    assertSerializableWebhookValue,
    createWebhookHttpError,
    serializeWebhookError,
    createWebhookNotFoundError,
    createWebhookDeliveryNotFoundError,
    createWebhookConflictError,
    createWebhookDeliveryConflictError,
    assertWebhookRuntime,
    resolveNow,
    createDatabaseTimestamp,
    toMilliseconds,
    serializeTimestamp,
    truncateUtf8String,
    logWebhookEvent,
    logWebhookDeliveryEvent,
    constants
} = require(
    "../src/shared/webhook-service"
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

        case "array-contains":
            return (
                Array.isArray(
                    normalizedLeft
                ) &&
                normalizedLeft.includes(
                    normalizedRight
                )
            );

        default:
            throw new Error(
                "Unsupported query operator."
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
                                  clone(value)
                              )
                            : clone(value);

                    documents.set(
                        path,
                        next
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
                    const write of writes
                ) {
                    await write.reference.set(
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
            },

        hasDocument:
            function (path) {
                return documents.has(path);
            }
    };
}

function createLoggerStub() {
    const entries =
        [];

    return {
        entries,

        info:
            function (
                message,
                metadata
            ) {
                entries.push({
                    level:
                        "info",
                    message,
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
                    message,
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
                    message,
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
            TestTimestamp,

        now:
            settings.now ||
            function () {
                return 1000;
            },

        logger:
            settings.logger ||
            createLoggerStub(),

        fetch:
            settings.fetch
    };
}

function webhookPath(id) {
    return (
        constants
            .WEBHOOK_COLLECTION +
        "/" +
        id
    );
}

function deliveryPath(id) {
    return (
        constants
            .WEBHOOK_DELIVERY_COLLECTION +
        "/" +
        id
    );
}

function createStoredWebhook(
    overrides
) {
    return Object.assign(
        {
            id:
                "webhook-1",

            fingerprint:
                "fingerprint",

            url:
                "https://example.com/webhook",

            events: [
                "order.created"
            ],

            status:
                "active",

            description:
                null,

            secret:
                "0123456789abcdef",

            secretHash:
                hashWebhookValue(
                    "0123456789abcdef"
                ),

            headers:
                {},

            metadata:
                {},

            timeoutMs:
                10000,

            maxAttempts:
                5,

            createdAt:
                TestTimestamp.fromMillis(
                    1000
                ),

            updatedAt:
                TestTimestamp.fromMillis(
                    1000
                ),

            lastDeliveryAt:
                null,

            schemaVersion:
                1
        },
        overrides || {}
    );
}

function createStoredDelivery(
    overrides
) {
    return Object.assign(
        {
            id:
                "delivery-1",

            fingerprint:
                "fingerprint",

            webhookId:
                "webhook-1",

            event:
                "order.created",

            url:
                "https://example.com/webhook",

            payload: {
                orderId:
                    "order-1"
            },

            status:
                "pending",

            attempts:
                0,

            maxAttempts:
                5,

            response:
                null,

            lastError:
                null,

            cancellationReason:
                null,

            createdAt:
                TestTimestamp.fromMillis(
                    1000
                ),

            updatedAt:
                TestTimestamp.fromMillis(
                    1000
                ),

            scheduledAt:
                TestTimestamp.fromMillis(
                    1000
                ),

            processingAt:
                null,

            deliveredAt:
                null,

            failedAt:
                null,

            cancelledAt:
                null,

            expiresAt:
                TestTimestamp.fromMillis(
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
    "createWebhookService creates frozen service",
    function () {
        const runtime =
            createRuntime();

        const service =
            createWebhookService({
                runtime
            });

        assert.equal(
            service.runtime,
            runtime
        );

        assert.equal(
            typeof service.register,
            "function"
        );

        assert.equal(
            typeof service.update,
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
            typeof service.queue,
            "function"
        );

        assert.equal(
            typeof service.deliver,
            "function"
        );

        assert.equal(
            typeof service.cancel,
            "function"
        );

        assert.equal(
            typeof service.verify,
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
    "normalizeWebhookOptions applies defaults",
    function () {
        const options =
            normalizeWebhookOptions(
                {}
            );

        assert.equal(
            options.collection,
            "_webhooks"
        );

        assert.equal(
            options.deliveryCollection,
            "_webhookDeliveries"
        );

        assert.equal(
            options.timeoutMs,
            10000
        );

        assert.equal(
            options.maxAttempts,
            5
        );

        assert.equal(
            options.retryDelayMs,
            30000
        );

        assert.equal(
            options.maxRetryDelayMs,
            3600000
        );

        assert.equal(
            options.signingAlgorithm,
            "sha256"
        );

        assert.equal(
            options.signatureHeader,
            "x-leternel-signature"
        );

        assert.equal(
            options.allowHttp,
            false
        );

        assert.equal(
            options.disabled,
            false
        );
    }
);

/* ==========================================================
   NORMALIZERS
========================================================== */

test(
    "webhook normalizers validate identifiers",
    function () {
        assert.equal(
            normalizeWebhookId(
                " webhook-1 "
            ),
            "webhook-1"
        );

        assert.equal(
            normalizeWebhookDeliveryId(
                " delivery-1 "
            ),
            "delivery-1"
        );

        assert.equal(
            normalizeWebhookStatus(
                "PAUSED"
            ),
            "paused"
        );

        assert.equal(
            normalizeWebhookDeliveryStatus(
                "RETRYING"
            ),
            "retrying"
        );

        assert.throws(
            function () {
                normalizeWebhookId(
                    "webhooks/one"
                );
            },
            /webhook ID is invalid/
        );

        assert.throws(
            function () {
                normalizeWebhookDeliveryId(
                    ""
                );
            },
            /delivery ID is invalid/
        );
    }
);

test(
    "normalizeWebhookUrl enforces HTTPS",
    function () {
        assert.equal(
            normalizeWebhookUrl(
                "https://example.com/hook",
                {}
            ),
            "https://example.com/hook"
        );

        assert.throws(
            function () {
                normalizeWebhookUrl(
                    "http://example.com/hook",
                    {}
                );
            },
            /protocol is not allowed/
        );

        assert.equal(
            normalizeWebhookUrl(
                "http://localhost:8080/hook",
                {
                    allowHttp:
                        true
                }
            ),
            "http://localhost:8080/hook"
        );

        assert.throws(
            function () {
                normalizeWebhookUrl(
                    "https://user:pass@example.com",
                    {}
                );
            },
            /cannot contain credentials/
        );
    }
);

test(
    "event normalizers format and deduplicate values",
    function () {
        assert.equal(
            normalizeWebhookEvent(
                " Order Created "
            ),
            "order.created"
        );

        assert.deepEqual(
            normalizeWebhookEvents([
                "Order Created",
                "order.created",
                "payment.captured"
            ]),
            [
                "order.created",
                "payment.captured"
            ]
        );

        assert.throws(
            function () {
                normalizeWebhookEvents(
                    []
                );
            },
            /At least one webhook event/
        );
    }
);

test(
    "secret and signing algorithm normalizers validate values",
    function () {
        assert.equal(
            normalizeWebhookSecret(
                "0123456789abcdef"
            ),
            "0123456789abcdef"
        );

        assert.equal(
            normalizeSigningAlgorithm(
                "SHA512"
            ),
            "sha512"
        );

        assert.throws(
            function () {
                normalizeWebhookSecret(
                    "short"
                );
            },
            /at least 16 characters/
        );

        assert.throws(
            function () {
                normalizeSigningAlgorithm(
                    "md5"
                );
            },
            /unsupported/
        );
    }
);

test(
    "header and numeric normalizers work",
    function () {
        assert.equal(
            normalizeHeaderName(
                "X-Custom-Header"
            ),
            "x-custom-header"
        );

        assert.equal(
            normalizeQueryLimit(
                1000
            ),
            500
        );

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
            normalizePositiveNumber(
                "1.5",
                1,
                "Value"
            ),
            1.5
        );

        assert.throws(
            function () {
                normalizeHeaderName(
                    "invalid header"
                );
            },
            /header name is invalid/
        );
    }
);

/* ==========================================================
   RECORD NORMALIZATION
========================================================== */

test(
    "normalizeWebhookRecord creates complete record",
    function () {
        const record =
            normalizeWebhookRecord(
                {
                    id:
                        "webhook-1",

                    url:
                        "https://example.com/webhook",

                    events: [
                        "order.created"
                    ],

                    secret:
                        "0123456789abcdef",

                    headers: {
                        "X-Store":
                            "leternel"
                    }
                },
                {},
                createRuntime({
                    now:
                        function () {
                            return 1000;
                        }
                })
            );

        assert.equal(
            record.id,
            "webhook-1"
        );

        assert.equal(
            record.status,
            "active"
        );

        assert.equal(
            record.url,
            "https://example.com/webhook"
        );

        assert.equal(
            record.secretHash,
            hashWebhookValue(
                "0123456789abcdef"
            )
        );

        assert.equal(
            record.headers["x-store"],
            "leternel"
        );

        assert.equal(
            record.createdAt.toMillis(),
            1000
        );
    }
);

test(
    "normalizeWebhookDeliveryRecord creates delivery record",
    function () {
        const record =
            normalizeWebhookDeliveryRecord(
                createStoredWebhook(),
                "order.created",
                {
                    orderId:
                        "order-1"
                },
                {
                    deliveryId:
                        "delivery-1",
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
            "delivery-1"
        );

        assert.equal(
            record.status,
            "pending"
        );

        assert.equal(
            record.attempts,
            0
        );

        assert.equal(
            record.scheduledAt.toMillis(),
            1000
        );

        assert.equal(
            record.expiresAt.toMillis(),
            6000
        );
    }
);

/* ==========================================================
   REGISTER AND UPDATE
========================================================== */

test(
    "registerWebhook stores webhook",
    async function () {
        const firestore =
            createFirestoreStub();

        const result =
            await registerWebhook(
                createRuntime({
                    firestore
                }),
                {
                    id:
                        "webhook-1",

                    url:
                        "https://example.com/webhook",

                    events: [
                        "order.created"
                    ],

                    secret:
                        "0123456789abcdef"
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
            firestore.hasDocument(
                webhookPath(
                    "webhook-1"
                )
            ),
            true
        );

        assert.equal(
            result.webhook.secret,
            undefined
        );
    }
);

test(
    "registerWebhook detects duplicate",
    async function () {
        const runtime =
            createRuntime();

        const input = {
            id:
                "webhook-1",

            url:
                "https://example.com/webhook",

            events: [
                "order.created"
            ],

            secret:
                "0123456789abcdef"
        };

        const options = {
            now:
                function () {
                    return 1000;
                }
        };

        const first =
            await registerWebhook(
                runtime,
                input,
                options
            );

        const second =
            await registerWebhook(
                runtime,
                input,
                options
            );

        assert.equal(
            first.created,
            true
        );

        assert.equal(
            second.duplicate,
            true
        );
    }
);

test(
    "updateWebhook updates stored webhook",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    webhookPath(
                        "webhook-1"
                    )
                ]:
                    createStoredWebhook()
            });

        const result =
            await updateWebhook(
                createRuntime({
                    firestore
                }),
                "webhook-1",
                {
                    status:
                        "paused",

                    events: [
                        "order.created",
                        "order.updated"
                    ]
                },
                {
                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            result.updated,
            true
        );

        assert.equal(
            result.webhook.status,
            "paused"
        );

        assert.deepEqual(
            result.webhook.events,
            [
                "order.created",
                "order.updated"
            ]
        );
    }
);

/* ==========================================================
   GET AND QUERY
========================================================== */

test(
    "getWebhook returns stored webhook",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    webhookPath(
                        "webhook-1"
                    )
                ]:
                    createStoredWebhook()
            });

        const result =
            await getWebhook(
                createRuntime({
                    firestore
                }),
                "webhook-1"
            );

        assert.equal(
            result.id,
            "webhook-1"
        );

        assert.equal(
            result.secret,
            undefined
        );
    }
);

test(
    "queryWebhooks filters by status and event",
    async function () {
        const firestore =
            createFirestoreStub({
                "_webhooks/one":
                    createStoredWebhook({
                        id:
                            "one"
                    }),

                "_webhooks/two":
                    createStoredWebhook({
                        id:
                            "two",

                        events: [
                            "payment.captured"
                        ]
                    }),

                "_webhooks/three":
                    createStoredWebhook({
                        id:
                            "three",

                        status:
                            "paused"
                    })
            });

        const results =
            await queryWebhooks(
                createRuntime({
                    firestore
                }),
                {
                    status:
                        "active",

                    event:
                        "order.created"
                },
                {}
            );

        assert.deepEqual(
            results.map(
                function (
                    webhook
                ) {
                    return webhook.id;
                }
            ),
            [
                "one"
            ]
        );
    }
);

/* ==========================================================
   EVENT VALIDATION
========================================================== */

test(
    "assertWebhookCanReceiveEvent accepts subscribed event",
    function () {
        assert.equal(
            assertWebhookCanReceiveEvent(
                createStoredWebhook(),
                "order.created"
            ),
            true
        );

        assert.equal(
            assertWebhookCanReceiveEvent(
                createStoredWebhook({
                    events: [
                        "*"
                    ]
                }),
                "anything.happened"
            ),
            true
        );
    }
);

test(
    "assertWebhookCanReceiveEvent rejects inactive or unsubscribed webhook",
    function () {
        assert.throws(
            function () {
                assertWebhookCanReceiveEvent(
                    createStoredWebhook({
                        status:
                            "paused"
                    }),
                    "order.created"
                );
            },
            /not active/
        );

        assert.throws(
            function () {
                assertWebhookCanReceiveEvent(
                    createStoredWebhook(),
                    "payment.captured"
                );
            },
            /does not subscribe/
        );
    }
);

/* ==========================================================
   QUEUE DELIVERY
========================================================== */

test(
    "queueWebhookDelivery stores delivery",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    webhookPath(
                        "webhook-1"
                    )
                ]:
                    createStoredWebhook()
            });

        const result =
            await queueWebhookDelivery(
                createRuntime({
                    firestore
                }),
                "webhook-1",
                "order.created",
                {
                    orderId:
                        "order-1"
                },
                {
                    deliveryId:
                        "delivery-1",

                    now:
                        function () {
                            return 1000;
                        }
                }
            );

        assert.equal(
            result.queued,
            true
        );

        assert.equal(
            result.deliveryId,
            "delivery-1"
        );

        assert.equal(
            firestore.hasDocument(
                deliveryPath(
                    "delivery-1"
                )
            ),
            true
        );
    }
);

test(
    "queueWebhookDelivery rejects missing webhook",
    async function () {
        await assert.rejects(
            async function () {
                await queueWebhookDelivery(
                    createRuntime(),
                    "missing",
                    "order.created",
                    {},
                    {}
                );
            },
            function (
                error
            ) {
                assert.equal(
                    error.code,
                    "not-found"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   SIGNATURES
========================================================== */

test(
    "createWebhookSignature creates deterministic signature",
    function () {
        const signature =
            createWebhookSignature(
                '{"orderId":"order-1"}',
                "0123456789abcdef",
                {
                    timestamp:
                        "1000",
                    algorithm:
                        "sha256"
                }
            );

        assert.match(
            signature,
            /^sha256=[a-f0-9]{64}$/
        );

        assert.equal(
            signature,
            createWebhookSignature(
                '{"orderId":"order-1"}',
                "0123456789abcdef",
                {
                    timestamp:
                        "1000",
                    algorithm:
                        "sha256"
                }
            )
        );
    }
);

test(
    "verifyWebhookSignature verifies valid signature",
    function () {
        const signature =
            createWebhookSignature(
                "payload",
                "0123456789abcdef",
                {
                    timestamp:
                        "1"
                }
            );

        assert.equal(
            verifyWebhookSignature(
                "payload",
                signature,
                "0123456789abcdef",
                {
                    timestamp:
                        "1",

                    now:
                        function () {
                            return 1000;
                        }
                }
            ),
            true
        );

        assert.equal(
            verifyWebhookSignature(
                "different",
                signature,
                "0123456789abcdef",
                {
                    timestamp:
                        "1",

                    now:
                        function () {
                            return 1000;
                        }
                }
            ),
            false
        );
    }
);

test(
    "verifyWebhookSignature rejects stale timestamp",
    function () {
        const signature =
            createWebhookSignature(
                "payload",
                "0123456789abcdef",
                {
                    timestamp:
                        "1"
                }
            );

        assert.equal(
            verifyWebhookSignature(
                "payload",
                signature,
                "0123456789abcdef",
                {
                    timestamp:
                        "1",

                    signatureToleranceMs:
                        1000,

                    now:
                        function () {
                            return 10000;
                        }
                }
            ),
            false
        );
    }
);

test(
    "parseWebhookSignature parses signature",
    function () {
        assert.deepEqual(
            parseWebhookSignature(
                "sha256=abcdef"
            ),
            {
                algorithm:
                    "sha256",

                digest:
                    "abcdef",

                original:
                    "sha256=abcdef"
            }
        );

        assert.throws(
            function () {
                parseWebhookSignature(
                    "invalid"
                );
            },
            /signature is invalid/
        );
    }
);

test(
    "timingSafeEqualStrings compares strings",
    function () {
        assert.equal(
            timingSafeEqualStrings(
                "same",
                "same"
            ),
            true
        );

        assert.equal(
            timingSafeEqualStrings(
                "same",
                "different"
            ),
            false
        );
    }
);

/* ==========================================================
   DELIVERY CLAIMABILITY
========================================================== */

test(
    "isWebhookDeliveryClaimable validates status and schedule",
    function () {
        assert.equal(
            isWebhookDeliveryClaimable(
                createStoredDelivery(),
                2000
            ),
            true
        );

        assert.equal(
            isWebhookDeliveryClaimable(
                createStoredDelivery({
                    status:
                        "delivered"
                }),
                2000
            ),
            false
        );

        assert.equal(
            isWebhookDeliveryClaimable(
                createStoredDelivery({
                    scheduledAt:
                        TestTimestamp.fromMillis(
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
    "claimWebhookDelivery claims pending delivery",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    deliveryPath(
                        "delivery-1"
                    )
                ]:
                    createStoredDelivery()
            });

        const reference =
            firestore.db
                .collection(
                    constants
                        .WEBHOOK_DELIVERY_COLLECTION
                )
                .doc(
                    "delivery-1"
                );

        const result =
            await claimWebhookDelivery(
                createRuntime({
                    firestore
                }),
                reference,
                {
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
            result.attempts,
            1
        );

        assert.equal(
            result.processingAt.toMillis(),
            2000
        );
    }
);

/* ==========================================================
   HTTP HELPERS
========================================================== */

test(
    "isSuccessfulHttpStatus recognises successful responses",
    function () {
        assert.equal(
            isSuccessfulHttpStatus(
                200
            ),
            true
        );

        assert.equal(
            isSuccessfulHttpStatus(
                299
            ),
            true
        );

        assert.equal(
            isSuccessfulHttpStatus(
                300
            ),
            false
        );
    }
);

test(
    "normalizeResponseHeaders lowercases keys",
    function () {
        assert.deepEqual(
            normalizeResponseHeaders({
                "Content-Type":
                    "application/json"
            }),
            {
                "content-type":
                    "application/json"
            }
        );
    }
);

test(
    "readWebhookResponseBody truncates response",
    async function () {
        const body =
            await readWebhookResponseBody(
                {
                    text:
                        async function () {
                            return "x".repeat(
                                100
                            );
                        }
                },
                20
            );

        assert.match(
            body,
            /\[TRUNCATED\]$/
        );
    }
);

test(
    "sendWebhookRequest signs and sends payload",
    async function () {
        let captured;

        const response =
            await sendWebhookRequest(
                createStoredWebhook(),
                createStoredDelivery(),
                {
                    timeoutMs:
                        1000,

                    maxResponseBytes:
                        1000,

                    signingAlgorithm:
                        "sha256",

                    signatureHeader:
                        "x-signature",

                    timestampHeader:
                        "x-timestamp",

                    eventHeader:
                        "x-event",

                    deliveryHeader:
                        "x-delivery",

                    userAgent:
                        "Test-Agent",

                    fetch:
                        async function (
                            url,
                            request
                        ) {
                            captured = {
                                url,
                                request
                            };

                            return {
                                status:
                                    200,

                                statusText:
                                    "OK",

                                headers: {
                                    "content-type":
                                        "application/json"
                                },

                                text:
                                    async function () {
                                        return '{"ok":true}';
                                    }
                            };
                        },

                    now:
                        function () {
                            return 1000;
                        }
                },
                createRuntime()
            );

        assert.equal(
            captured.url,
            "https://example.com/webhook"
        );

        assert.equal(
            captured.request.method,
            "POST"
        );

        assert.match(
            captured.request.headers[
                "x-signature"
            ],
            /^sha256=/
        );

        assert.equal(
            response.status,
            200
        );

        assert.equal(
            response.body,
            '{"ok":true}'
        );
    }
);

/* ==========================================================
   RETRY
========================================================== */

test(
    "isRetryableWebhookError handles response status",
    function () {
        assert.equal(
            isRetryableWebhookError(
                null,
                {
                    status:
                        503
                },
                {}
            ),
            true
        );

        assert.equal(
            isRetryableWebhookError(
                null,
                {
                    status:
                        400
                },
                {}
            ),
            false
        );
    }
);

test(
    "resolveWebhookRetryDelay applies exponential backoff",
    function () {
        assert.equal(
            resolveWebhookRetryDelay(
                1,
                null,
                null,
                {
                    retryDelayMs:
                        1000,

                    retryBackoffMultiplier:
                        2,

                    maxRetryDelayMs:
                        10000
                }
            ),
            1000
        );

        assert.equal(
            resolveWebhookRetryDelay(
                3,
                null,
                null,
                {
                    retryDelayMs:
                        1000,

                    retryBackoffMultiplier:
                        2,

                    maxRetryDelayMs:
                        10000
                }
            ),
            4000
        );
    }
);

test(
    "getRetryAfterMilliseconds reads numeric header",
    function () {
        assert.equal(
            getRetryAfterMilliseconds({
                headers: {
                    "retry-after":
                        "5"
                }
            }),
            5000
        );
    }
);

/* ==========================================================
   DELIVERY COMPLETION AND FAILURE
========================================================== */

test(
    "completeWebhookDelivery marks delivery delivered",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    deliveryPath(
                        "delivery-1"
                    )
                ]:
                    createStoredDelivery({
                        status:
                            "processing",

                        attempts:
                            1
                    })
            });

        const reference =
            firestore.db
                .collection(
                    constants
                        .WEBHOOK_DELIVERY_COLLECTION
                )
                .doc(
                    "delivery-1"
                );

        const result =
            await completeWebhookDelivery(
                createRuntime({
                    firestore
                }),
                reference,
                createStoredDelivery({
                    status:
                        "processing",

                    attempts:
                        1
                }),
                {
                    status:
                        200,

                    statusText:
                        "OK",

                    headers:
                        {},

                    body:
                        "accepted"
                },
                {
                    maxResponseBytes:
                        1000,

                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            result.delivered,
            true
        );

        assert.equal(
            result.delivery.status,
            "delivered"
        );

        assert.equal(
            result.delivery.deliveredAt,
            new Date(
                2000
            ).toISOString()
        );
    }
);

test(
    "failClaimedWebhookDelivery schedules retry",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    deliveryPath(
                        "delivery-1"
                    )
                ]:
                    createStoredDelivery({
                        status:
                            "processing",

                        attempts:
                            1
                    })
            });

        const reference =
            firestore.db
                .collection(
                    constants
                        .WEBHOOK_DELIVERY_COLLECTION
                )
                .doc(
                    "delivery-1"
                );

        const error =
            new Error(
                "Unavailable"
            );

        error.retryable =
            true;

        const result =
            await failClaimedWebhookDelivery(
                createRuntime({
                    firestore
                }),
                reference,
                createStoredDelivery({
                    status:
                        "processing",

                    attempts:
                        1
                }),
                error,
                {
                    retryDelayMs:
                        1000,

                    retryBackoffMultiplier:
                        2,

                    maxRetryDelayMs:
                        10000,

                    maxAttempts:
                        5,

                    maxResponseBytes:
                        1000,

                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            result.retryScheduled,
            true
        );

        assert.equal(
            result.delivery.status,
            "retrying"
        );

        assert.equal(
            result.delivery.scheduledAt,
            new Date(
                3000
            ).toISOString()
        );
    }
);

/* ==========================================================
   DELIVER END-TO-END
========================================================== */

test(
    "deliverWebhook delivers successful request",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    webhookPath(
                        "webhook-1"
                    )
                ]:
                    createStoredWebhook(),

                [
                    deliveryPath(
                        "delivery-1"
                    )
                ]:
                    createStoredDelivery()
            });

        const result =
            await deliverWebhook(
                createRuntime({
                    firestore,
                    fetch:
                        async function () {
                            return {
                                status:
                                    200,

                                statusText:
                                    "OK",

                                headers:
                                    {},

                                text:
                                    async function () {
                                        return "accepted";
                                    }
                            };
                        }
                }),
                "delivery-1",
                {
                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            result.delivered,
            true
        );

        assert.equal(
            result.delivery.status,
            "delivered"
        );
    }
);

test(
    "deliverWebhook schedules retry on server error",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    webhookPath(
                        "webhook-1"
                    )
                ]:
                    createStoredWebhook(),

                [
                    deliveryPath(
                        "delivery-1"
                    )
                ]:
                    createStoredDelivery()
            });

        const result =
            await deliverWebhook(
                createRuntime({
                    firestore,
                    fetch:
                        async function () {
                            return {
                                status:
                                    503,

                                statusText:
                                    "Unavailable",

                                headers:
                                    {},

                                text:
                                    async function () {
                                        return "try later";
                                    }
                            };
                        }
                }),
                "delivery-1",
                {
                    retryDelayMs:
                        1000,

                    maxRetryDelayMs:
                        10000,

                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            result.delivered,
            false
        );

        assert.equal(
            result.retryScheduled,
            true
        );
    }
);

/* ==========================================================
   CANCEL
========================================================== */

test(
    "cancelWebhookDelivery cancels pending delivery",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    deliveryPath(
                        "delivery-1"
                    )
                ]:
                    createStoredDelivery()
            });

        const result =
            await cancelWebhookDelivery(
                createRuntime({
                    firestore
                }),
                "delivery-1",
                "No longer required.",
                {
                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            result.cancelled,
            true
        );

        assert.equal(
            result.delivery.status,
            "cancelled"
        );

        assert.equal(
            result.delivery
                .cancellationReason,
            "No longer required."
        );
    }
);

/* ==========================================================
   SANITIZATION
========================================================== */

test(
    "sanitizeWebhookHeaders normalises and blocks unsafe headers",
    function () {
        assert.deepEqual(
            sanitizeWebhookHeaders({
                "X-Test":
                    "value",

                Host:
                    "malicious.example",

                "Content-Length":
                    "999"
            }),
            {
                "x-test":
                    "value"
            }
        );
    }
);

test(
    "sanitizeWebhookRecord hides secret",
    function () {
        const result =
            sanitizeWebhookRecord(
                createStoredWebhook()
            );

        assert.equal(
            result.secret,
            undefined
        );

        assert.equal(
            result.secretHash,
            hashWebhookValue(
                "0123456789abcdef"
            )
        );
    }
);

test(
    "sanitizeWebhookDeliveryRecord serializes timestamps",
    function () {
        const result =
            sanitizeWebhookDeliveryRecord(
                createStoredDelivery({
                    deliveredAt:
                        TestTimestamp.fromMillis(
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
            result.deliveredAt,
            new Date(
                3000
            ).toISOString()
        );
    }
);

/* ==========================================================
   ERRORS
========================================================== */

test(
    "createWebhookHttpError creates retryable HTTP error",
    function () {
        const error =
            createWebhookHttpError({
                status:
                    503,

                statusText:
                    "Unavailable"
            });

        assert.equal(
            error.code,
            "webhook-http-error"
        );

        assert.equal(
            error.status,
            503
        );

        assert.equal(
            error.retryable,
            true
        );
    }
);

test(
    "serializeWebhookError returns safe error",
    function () {
        const error =
            new ServiceError(
                "provider-error",
                "Provider failed.",
                {
                    status:
                        503,

                    retryable:
                        true
                }
            );

        assert.deepEqual(
            serializeWebhookError(
                error
            ),
            {
                name:
                    "ServiceError",

                code:
                    "provider-error",

                message:
                    "Provider failed.",

                status:
                    503,

                retryable:
                    true
            }
        );
    }
);

test(
    "webhook error factories create service errors",
    function () {
        assert.equal(
            createWebhookNotFoundError(
                "webhook-1"
            ).code,
            "not-found"
        );

        assert.equal(
            createWebhookDeliveryNotFoundError(
                "delivery-1"
            ).code,
            "not-found"
        );

        assert.equal(
            createWebhookConflictError(
                "webhook-1",
                {}
            ).code,
            "already-exists"
        );

        assert.equal(
            createWebhookDeliveryConflictError(
                "delivery-1",
                {}
            ).code,
            "already-exists"
        );
    }
);

/* ==========================================================
   RUNTIME AND TIME
========================================================== */

test(
    "assertWebhookRuntime validates runtime",
    function () {
        assert.doesNotThrow(
            function () {
                assertWebhookRuntime(
                    createRuntime()
                );
            }
        );

        assert.throws(
            function () {
                assertWebhookRuntime(
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
   IDENTIFIERS AND SERIALIZATION
========================================================== */

test(
    "webhook identifiers and fingerprints are deterministic",
    function () {
        assert.equal(
            createWebhookId(
                {
                    idempotencyKey:
                        "hook-1"
                },
                {},
                1000
            ),
            hashWebhookValue(
                "hook-1"
            )
        );

        assert.match(
            createWebhookDeliveryId(
                "webhook-1",
                "order.created",
                {},
                {
                    idempotencyKey:
                        "delivery-1"
                },
                1000
            ),
            /^[a-f0-9]{64}$/
        );

        assert.match(
            createRandomIdentifier(
                1000
            ),
            /^[a-z0-9_]+$/
        );

        assert.equal(
            generateWebhookSecret()
                .length,
            64
        );

        assert.equal(
            createWebhookFingerprint({
                b:
                    2,
                a:
                    1
            }),
            createWebhookFingerprint({
                a:
                    1,
                b:
                    2
            })
        );
    }
);

test(
    "stable serialization handles special values",
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
    "assertSerializableWebhookValue enforces size",
    function () {
        assert.equal(
            assertSerializableWebhookValue(
                {
                    id:
                        "order-1"
                },
                1000,
                "Webhook payload"
            ),
            true
        );

        assert.throws(
            function () {
                assertSerializableWebhookValue(
                    {
                        value:
                            "x".repeat(
                                100
                            )
                    },
                    10,
                    "Webhook payload"
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

/* ==========================================================
   LOGGING
========================================================== */

test(
    "logWebhookEvent logs webhook event",
    function () {
        const logger =
            createLoggerStub();

        logWebhookEvent(
            {
                logger
            },
            createStoredWebhook(),
            "registered",
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
            "Webhook event."
        );
    }
);

test(
    "logWebhookDeliveryEvent logs retries and failures",
    function () {
        const logger =
            createLoggerStub();

        logWebhookDeliveryEvent(
            {
                logger
            },
            createStoredDelivery(),
            "retry-scheduled",
            {
                log:
                    true
            }
        );

        logWebhookDeliveryEvent(
            {
                logger
            },
            createStoredDelivery({
                status:
                    "failed"
            }),
            "failed",
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

/* ==========================================================
   CONSTANTS
========================================================== */

test(
    "webhook constants expose expected defaults",
    function () {
        assert.equal(
            constants
                .WEBHOOK_COLLECTION,
            "_webhooks"
        );

        assert.equal(
            constants
                .WEBHOOK_DELIVERY_COLLECTION,
            "_webhookDeliveries"
        );

        assert.equal(
            constants
                .DEFAULT_SIGNING_ALGORITHM,
            "sha256"
        );

        assert.equal(
            constants
                .DEFAULT_TIMEOUT_MS,
            10000
        );

        assert.equal(
            constants
                .DEFAULT_MAX_ATTEMPTS,
            5
        );

        assert.equal(
            constants
                .DEFAULT_SIGNATURE_TOLERANCE_MS,
            300000
        );

        assert.equal(
            constants
                .RETRYABLE_HTTP_STATUSES
                .includes(
                    503
                ),
            true
        );

        assert.equal(
            constants
                .TERMINAL_DELIVERY_STATUSES
                .includes(
                    "delivered"
                ),
            true
        );
    }
);