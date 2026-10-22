"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   NOTIFICATION SERVICE TEST SUITE
========================================================== */

const test =
    require("node:test");

const assert =
    require("node:assert/strict");

const {
    createNotificationService,
    queueNotification,
    queueUniqueNotification,
    storeNotification,
    normalizeNotificationRecord,
    normalizeNotificationRecipient,
    assertValidEmail,
    assertValidPhone,
    getNotification,
    updateNotificationStatus,
    createStatusUpdate,
    assertValidStatusTransition,
    cancelNotification,
    markNotificationRead,
    queryNotifications,
    normalizeNotificationQuery,
    sanitizeNotificationRecord,
    sanitizeNotificationMetadata,
    isSensitiveMetadataKey,
    normalizeNotificationId,
    normalizeNotificationChannel,
    normalizeNotificationStatus,
    normalizeNotificationPriority,
    normalizeNotificationTitle,
    normalizeNotificationBody,
    normalizeNotificationTags,
    normalizeNotificationDate,
    normalizeNotificationOrderField,
    normalizeQueryLimit,
    normalizeOptionalString,
    normalizePositiveInteger,
    normalizeNonNegativeInteger,
    normalizeCollection,
    normalizeNotificationOptions,
    createNotificationId,
    createNotificationFingerprint,
    hashNotificationValue,
    stableStringify,
    normalizeStableValue,
    serializeNotificationError,
    createNotificationNotFoundError,
    createNotificationConflictError,
    assertNotificationRuntime,
    resolveNow,
    createDatabaseTimestamp,
    toMilliseconds,
    serializeTimestamp,
    truncateString,
    logNotificationEvent,
    constants
} = require(
    "../src/shared/notification-service"
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

function notificationPath(
    id
) {
    return (
        constants
            .NOTIFICATION_COLLECTION +
        "/" +
        id
    );
}

function createStoredNotification(
    overrides
) {
    return Object.assign(
        {
            id:
                "notification-1",

            fingerprint:
                "fingerprint",

            channel:
                "in-app",

            recipient: {
                userId:
                    "customer-1",

                address:
                    null,

                email:
                    null,

                phone:
                    null,

                deviceToken:
                    null,

                name:
                    null
            },

            userId:
                "customer-1",

            title:
                "Order update",

            body:
                "Your order has shipped.",

            template:
                null,

            locale:
                "en",

            priority:
                "normal",

            status:
                "pending",

            metadata:
                {},

            tags:
                [],

            attempts:
                0,

            provider:
                null,

            providerMessageId:
                null,

            lastError:
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

            scheduledAt:
                TestTimestamp
                    .fromMillis(
                        1000
                    ),

            expiresAt:
                TestTimestamp
                    .fromMillis(
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
    "createNotificationService creates a frozen service",
    function () {
        const runtime =
            createRuntime();

        const service =
            createNotificationService({
                runtime:
                    runtime,

                defaultChannel:
                    "email",

                defaultPriority:
                    "high"
            });

        assert.equal(
            service.runtime,
            runtime
        );

        assert.equal(
            service.options.defaultChannel,
            "email"
        );

        assert.equal(
            service.options.defaultPriority,
            "high"
        );

        assert.equal(
            typeof service.queue,
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
            typeof service.updateStatus,
            "function"
        );

        assert.equal(
            typeof service.cancel,
            "function"
        );

        assert.equal(
            typeof service.markRead,
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
    "normalizeNotificationOptions applies defaults",
    function () {
        const options =
            normalizeNotificationOptions(
                {}
            );

        assert.equal(
            options.collection,
            constants
                .NOTIFICATION_COLLECTION
        );

        assert.equal(
            options.defaultChannel,
            "in-app"
        );

        assert.equal(
            options.defaultPriority,
            "normal"
        );

        assert.equal(
            options.defaultLocale,
            "en"
        );

        assert.equal(
            options.maxTitleLength,
            200
        );

        assert.equal(
            options.maxBodyLength,
            10000
        );

        assert.equal(
            options.maxMetadataDepth,
            8
        );

        assert.equal(
            options.maxArrayLength,
            100
        );

        assert.equal(
            options.queryLimit,
            100
        );

        assert.equal(
            options.retentionMs,
            constants
                .DEFAULT_RETENTION_MS
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
    "normalizeNotificationOptions respects overrides",
    function () {
        const resolver =
            function () {
                return "custom-id";
            };

        const options =
            normalizeNotificationOptions({
                collection:
                    "notifications",

                defaultChannel:
                    "email",

                defaultPriority:
                    "urgent",

                defaultLocale:
                    "fr",

                maxTitleLength:
                    100,

                maxBodyLength:
                    1000,

                maxMetadataDepth:
                    4,

                maxArrayLength:
                    10,

                queryLimit:
                    25,

                retentionMs:
                    5000,

                preventDuplicates:
                    false,

                disabled:
                    true,

                log:
                    false,

                idResolver:
                    resolver
            });

        assert.equal(
            options.collection,
            "notifications"
        );

        assert.equal(
            options.defaultChannel,
            "email"
        );

        assert.equal(
            options.defaultPriority,
            "urgent"
        );

        assert.equal(
            options.defaultLocale,
            "fr"
        );

        assert.equal(
            options.maxTitleLength,
            100
        );

        assert.equal(
            options.maxBodyLength,
            1000
        );

        assert.equal(
            options.maxMetadataDepth,
            4
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
            options.retentionMs,
            5000
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
            resolver
        );
    }
);

/* ==========================================================
   NORMALIZERS
========================================================== */

test(
    "notification normalizers validate values",
    function () {
        assert.equal(
            normalizeNotificationId(
                " notification-1 "
            ),
            "notification-1"
        );

        assert.equal(
            normalizeNotificationChannel(
                "EMAIL"
            ),
            "email"
        );

        assert.equal(
            normalizeNotificationStatus(
                "SENT"
            ),
            "sent"
        );

        assert.equal(
            normalizeNotificationPriority(
                "URGENT"
            ),
            "urgent"
        );

        assert.equal(
            normalizeNotificationPriority(
                "invalid"
            ),
            "normal"
        );

        assert.throws(
            function () {
                normalizeNotificationId(
                    "notifications/one"
                );
            },
            /ID is invalid/
        );

        assert.throws(
            function () {
                normalizeNotificationChannel(
                    "fax"
                );
            },
            /channel is invalid/
        );

        assert.throws(
            function () {
                normalizeNotificationStatus(
                    "unknown"
                );
            },
            /status is invalid/
        );
    }
);

test(
    "title and body normalizers apply limits",
    function () {
        assert.equal(
            normalizeNotificationTitle(
                " Hello ",
                100
            ),
            "Hello"
        );

        assert.equal(
            normalizeNotificationTitle(
                null,
                100
            ),
            null
        );

        assert.equal(
            normalizeNotificationBody(
                " Message ",
                100
            ),
            "Message"
        );

        assert.throws(
            function () {
                normalizeNotificationBody(
                    "",
                    100
                );
            },
            /body is required/
        );

        assert.match(
            normalizeNotificationBody(
                "x".repeat(100),
                20
            ),
            /\[TRUNCATED\]$/
        );
    }
);

test(
    "notification tags normalize and deduplicate",
    function () {
        assert.deepEqual(
            normalizeNotificationTags([
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
            normalizeNotificationTags(
                "Account"
            ),
            [
                "account"
            ]
        );
    }
);

test(
    "query and integer normalizers validate values",
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

        assert.throws(
            function () {
                normalizeQueryLimit(
                    0
                );
            },
            /positive integer/
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
    "normalizeCollection validates collection names",
    function () {
        assert.equal(
            normalizeCollection(
                "_notifications"
            ),
            "_notifications"
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
                    "internal/notifications"
                );
            },
            /Firestore collection name/
        );
    }
);

/* ==========================================================
   RECIPIENTS
========================================================== */

test(
    "normalizeNotificationRecipient handles email recipient",
    function () {
        const recipient =
            normalizeNotificationRecipient(
                {
                    email:
                        "customer@example.com",

                    name:
                        "Customer"
                },
                "email"
            );

        assert.equal(
            recipient.email,
            "customer@example.com"
        );

        assert.equal(
            recipient.name,
            "Customer"
        );
    }
);

test(
    "normalizeNotificationRecipient handles SMS recipient",
    function () {
        const recipient =
            normalizeNotificationRecipient(
                "+2348012345678",
                "sms"
            );

        assert.equal(
            recipient.phone,
            "+2348012345678"
        );
    }
);

test(
    "normalizeNotificationRecipient handles push recipient",
    function () {
        const recipient =
            normalizeNotificationRecipient(
                {
                    deviceToken:
                        "device-token"
                },
                "push"
            );

        assert.equal(
            recipient.deviceToken,
            "device-token"
        );
    }
);

test(
    "normalizeNotificationRecipient handles in-app recipient",
    function () {
        const recipient =
            normalizeNotificationRecipient(
                {
                    userId:
                        "customer-1"
                },
                "in-app"
            );

        assert.equal(
            recipient.userId,
            "customer-1"
        );
    }
);

test(
    "recipient validation rejects invalid destinations",
    function () {
        assert.throws(
            function () {
                normalizeNotificationRecipient(
                    null,
                    "email"
                );
            },
            /recipient is required/
        );

        assert.throws(
            function () {
                assertValidEmail(
                    "invalid"
                );
            },
            /email address is invalid/
        );

        assert.throws(
            function () {
                assertValidPhone(
                    "123"
                );
            },
            /phone number is invalid/
        );

        assert.throws(
            function () {
                normalizeNotificationRecipient(
                    {},
                    "push"
                );
            },
            /device token is required/
        );

        assert.throws(
            function () {
                normalizeNotificationRecipient(
                    {},
                    "in-app"
                );
            },
            /user ID is required/
        );
    }
);

/* ==========================================================
   RECORD NORMALIZATION
========================================================== */

test(
    "normalizeNotificationRecord creates complete record",
    function () {
        const record =
            normalizeNotificationRecord(
                {
                    id:
                        "notification-1",

                    channel:
                        "email",

                    recipient: {
                        email:
                            "customer@example.com",

                        name:
                            "Customer"
                    },

                    userId:
                        "customer-1",

                    title:
                        "Order confirmation",

                    body:
                        "Your order has been received.",

                    template:
                        "order-confirmation",

                    locale:
                        "en-NG",

                    priority:
                        "high",

                    metadata: {
                        orderId:
                            "order-1"
                    },

                    tags: [
                        "orders"
                    ],

                    scheduledAt:
                        2000
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
            "notification-1"
        );

        assert.equal(
            record.channel,
            "email"
        );

        assert.equal(
            record.recipient.email,
            "customer@example.com"
        );

        assert.equal(
            record.status,
            "pending"
        );

        assert.equal(
            record.priority,
            "high"
        );

        assert.equal(
            record.attempts,
            0
        );

        assert.equal(
            record.createdAt.toMillis(),
            1000
        );

        assert.equal(
            record.scheduledAt.toMillis(),
            2000
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
    "normalizeNotificationRecord rejects invalid input",
    function () {
        assert.throws(
            function () {
                normalizeNotificationRecord(
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
   IDS AND FINGERPRINTS
========================================================== */

test(
    "createNotificationId uses custom resolver",
    function () {
        assert.equal(
            createNotificationId(
                {},
                {},
                "email",
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
    "createNotificationId hashes idempotency key",
    function () {
        const first =
            createNotificationId(
                {
                    idempotencyKey:
                        "order-1"
                },
                {},
                "email",
                {},
                1000
            );

        const second =
            createNotificationId(
                {
                    idempotencyKey:
                        "order-1"
                },
                {},
                "email",
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
    "createNotificationId generates unique IDs",
    function () {
        const first =
            createNotificationId(
                {},
                {},
                "in-app",
                {},
                1000
            );

        const second =
            createNotificationId(
                {},
                {},
                "in-app",
                {},
                1000
            );

        assert.notEqual(
            first,
            second
        );
    }
);

test(
    "notification fingerprints are deterministic",
    function () {
        assert.equal(
            createNotificationFingerprint({
                b:
                    2,

                a:
                    1
            }),
            createNotificationFingerprint({
                a:
                    1,

                b:
                    2
            })
        );

        assert.match(
            hashNotificationValue(
                "value"
            ),
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
    "normalizeStableValue rejects circular input",
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
   QUEUE
========================================================== */

test(
    "queueNotification stores notification",
    async function () {
        const firestore =
            createFirestoreStub();

        const runtime =
            createRuntime({
                firestore:
                    firestore
            });

        const result =
            await queueNotification(
                runtime,
                {
                    id:
                        "notification-1",

                    channel:
                        "in-app",

                    recipient: {
                        userId:
                            "customer-1"
                    },

                    title:
                        "Order update",

                    body:
                        "Your order has shipped."
                },
                {
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
            result.duplicate,
            false
        );

        assert.equal(
            result.disabled,
            false
        );

        const stored =
            firestore.getDocument(
                notificationPath(
                    "notification-1"
                )
            );

        assert.equal(
            stored.status,
            "pending"
        );

        assert.equal(
            stored.userId,
            "customer-1"
        );
    }
);

test(
    "queueNotification detects duplicate notification",
    async function () {
        const runtime =
            createRuntime();

        const input = {
            id:
                "notification-1",

            channel:
                "in-app",

            recipient: {
                userId:
                    "customer-1"
            },

            body:
                "Your order has shipped."
        };

        const options = {
            now:
                function () {
                    return 1000;
                }
        };

        const first =
            await queueNotification(
                runtime,
                input,
                options
            );

        const second =
            await queueNotification(
                runtime,
                input,
                options
            );

        assert.equal(
            first.queued,
            true
        );

        assert.equal(
            second.queued,
            false
        );

        assert.equal(
            second.duplicate,
            true
        );
    }
);

test(
    "queueNotification rejects conflicting duplicate ID",
    async function () {
        const runtime =
            createRuntime();

        await queueNotification(
            runtime,
            {
                id:
                    "notification-1",

                channel:
                    "in-app",

                recipient: {
                    userId:
                        "customer-1"
                },

                body:
                    "First message."
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
                await queueNotification(
                    runtime,
                    {
                        id:
                            "notification-1",

                        channel:
                            "in-app",

                        recipient: {
                            userId:
                                "customer-1"
                        },

                        body:
                            "Different message."
                    },
                    {
                        now:
                            function () {
                            return 1000;
                        }
                    }
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "already-exists"
                );

                assert.equal(
                    error.status,
                    409
                );

                return true;
            }
        );
    }
);

test(
    "queueNotification bypasses storage when disabled",
    async function () {
        const result =
            await queueNotification(
                null,
                {
                    id:
                        "notification-1",

                    channel:
                        "in-app",

                    recipient: {
                        userId:
                            "customer-1"
                    },

                    body:
                        "Message."
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
            result.queued,
            false
        );

        assert.equal(
            result.disabled,
            true
        );

        assert.equal(
            result.notification.id,
            "notification-1"
        );
    }
);

/* ==========================================================
   READ
========================================================== */

test(
    "getNotification returns stored notification",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    notificationPath(
                        "notification-1"
                    )
                ]: createStoredNotification()
            });

        const result =
            await getNotification(
                createRuntime({
                    firestore:
                        firestore
                }),
                "notification-1"
            );

        assert.equal(
            result.id,
            "notification-1"
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
    "getNotification returns null for missing notification",
    async function () {
        assert.equal(
            await getNotification(
                createRuntime(),
                "missing"
            ),
            null
        );
    }
);

test(
    "getNotification returns null when disabled",
    async function () {
        assert.equal(
            await getNotification(
                null,
                "notification-1",
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
   STATUS TRANSITIONS
========================================================== */

test(
    "assertValidStatusTransition accepts valid transitions",
    function () {
        assert.equal(
            assertValidStatusTransition(
                "pending",
                "processing"
            ),
            true
        );

        assert.equal(
            assertValidStatusTransition(
                "processing",
                "sent"
            ),
            true
        );

        assert.equal(
            assertValidStatusTransition(
                "sent",
                "delivered"
            ),
            true
        );

        assert.equal(
            assertValidStatusTransition(
                "sent",
                "sent"
            ),
            true
        );
    }
);

test(
    "assertValidStatusTransition rejects invalid transitions",
    function () {
        assert.throws(
            function () {
                assertValidStatusTransition(
                    "pending",
                    "delivered"
                );
            },
            /transition is invalid/
        );

        assert.throws(
            function () {
                assertValidStatusTransition(
                    "failed",
                    "pending"
                );
            },
            /terminal notification/
        );
    }
);

test(
    "createStatusUpdate builds processing update",
    function () {
        const update =
            createStatusUpdate(
                {
                    Timestamp:
                        TestTimestamp
                },
                "processing",
                {
                    attempts:
                        2,

                    provider:
                        "firebase"
                },
                1000,
                {
                    maxMetadataDepth:
                        8,

                    maxBodyLength:
                        1000,

                    maxArrayLength:
                        100
                }
            );

        assert.equal(
            update.status,
            "processing"
        );

        assert.equal(
            update.attempts,
            2
        );

        assert.equal(
            update.provider,
            "firebase"
        );

        assert.equal(
            update.processingAt.toMillis(),
            1000
        );
    }
);

test(
    "createStatusUpdate builds failure metadata",
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

        const update =
            createStatusUpdate(
                {
                    Timestamp:
                        TestTimestamp
                },
                "failed",
                {
                    error:
                        error
                },
                1000,
                {
                    maxMetadataDepth:
                        8,

                    maxBodyLength:
                        1000,

                    maxArrayLength:
                        100
                }
            );

        assert.equal(
            update.status,
            "failed"
        );

        assert.equal(
            update.lastError.code,
            "provider-error"
        );

        assert.equal(
            update.failedAt.toMillis(),
            1000
        );
    }
);

/* ==========================================================
   STATUS UPDATE
========================================================== */

test(
    "updateNotificationStatus updates stored record",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    notificationPath(
                        "notification-1"
                    )
                ]: createStoredNotification()
            });

        const result =
            await updateNotificationStatus(
                createRuntime({
                    firestore:
                        firestore
                }),
                "notification-1",
                "processing",
                {
                    attempts:
                        1,

                    provider:
                        "firebase"
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
            result.status,
            "processing"
        );

        assert.equal(
            result.notification.attempts,
            1
        );

        assert.equal(
            result.notification.provider,
            "firebase"
        );

        assert.equal(
            result.notification.processingAt,
            new Date(
                2000
            ).toISOString()
        );
    }
);

test(
    "updateNotificationStatus rejects missing notification",
    async function () {
        await assert.rejects(
            async function () {
                await updateNotificationStatus(
                    createRuntime(),
                    "missing",
                    "sent",
                    {},
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
    "updateNotificationStatus returns disabled result",
    async function () {
        const result =
            await updateNotificationStatus(
                null,
                "notification-1",
                "sent",
                {},
                {
                    disabled:
                        true
                }
            );

        assert.deepEqual(
            result,
            {
                updated:
                    false,

                disabled:
                    true,

                notificationId:
                    "notification-1",

                status:
                    "sent"
            }
        );
    }
);

test(
    "cancelNotification updates cancellation state",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    notificationPath(
                        "notification-1"
                    )
                ]: createStoredNotification()
            });

        const result =
            await cancelNotification(
                createRuntime({
                    firestore:
                        firestore
                }),
                "notification-1",
                "Customer opted out.",
                {
                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            result.status,
            "cancelled"
        );

        assert.equal(
            result.notification
                .cancellationReason,
            "Customer opted out."
        );
    }
);

test(
    "markNotificationRead updates sent notification",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    notificationPath(
                        "notification-1"
                    )
                ]: createStoredNotification({
                    status:
                        "sent",

                    sentAt:
                        TestTimestamp
                            .fromMillis(
                                1500
                            )
                })
            });

        const result =
            await markNotificationRead(
                createRuntime({
                    firestore:
                        firestore
                }),
                "notification-1",
                {
                    now:
                        function () {
                            return 2000;
                        }
                }
            );

        assert.equal(
            result.status,
            "read"
        );

        assert.equal(
            result.notification.readAt,
            new Date(
                2000
            ).toISOString()
        );
    }
);

/* ==========================================================
   QUERY
========================================================== */

test(
    "normalizeNotificationQuery normalizes filters",
    function () {
        assert.deepEqual(
            normalizeNotificationQuery(
                {
                    userId:
                        " customer-1 ",

                    channel:
                        "EMAIL",

                    status:
                        "SENT",

                    priority:
                        "HIGH",

                    scheduledBefore:
                        3000,

                    createdAfter:
                        1000,

                    orderBy:
                        "scheduledAt",

                    direction:
                        "ASC",

                    limit:
                        25
                },
                {}
            ),
            {
                userId:
                    "customer-1",

                channel:
                    "email",

                status:
                    "sent",

                priority:
                    "high",

                scheduledBefore:
                    3000,

                createdAfter:
                    1000,

                orderBy:
                    "scheduledAt",

                direction:
                    "asc",

                limit:
                    25
            }
        );
    }
);

test(
    "queryNotifications filters and orders records",
    async function () {
        const firestore =
            createFirestoreStub({
                "_notifications/one":
                    createStoredNotification({
                        id:
                            "one",

                        userId:
                            "customer-1",

                        channel:
                            "email",

                        status:
                            "sent",

                        priority:
                            "high",

                        createdAt:
                            TestTimestamp
                                .fromMillis(
                                    1000
                                )
                    }),

                "_notifications/two":
                    createStoredNotification({
                        id:
                            "two",

                        userId:
                            "customer-1",

                        channel:
                            "email",

                        status:
                            "sent",

                        priority:
                            "high",

                        createdAt:
                            TestTimestamp
                                .fromMillis(
                                    2000
                                )
                    }),

                "_notifications/three":
                    createStoredNotification({
                        id:
                            "three",

                        userId:
                            "customer-2",

                        channel:
                            "sms",

                        status:
                            "pending",

                        createdAt:
                            TestTimestamp
                                .fromMillis(
                                    3000
                                )
                    })
            });

        const results =
            await queryNotifications(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    userId:
                        "customer-1",

                    channel:
                        "email",

                    status:
                        "sent",

                    direction:
                        "desc"
                },
                {}
            );

        assert.deepEqual(
            results.map(
                function (
                    notification
                ) {
                    return notification.id;
                }
            ),
            [
                "two",
                "one"
            ]
        );
    }
);

test(
    "queryNotifications supports date filters",
    async function () {
        const firestore =
            createFirestoreStub({
                "_notifications/one":
                    createStoredNotification({
                        id:
                            "one",

                        createdAt:
                            TestTimestamp
                                .fromMillis(
                                    1000
                                ),

                        scheduledAt:
                            TestTimestamp
                                .fromMillis(
                                    2000
                                )
                    }),

                "_notifications/two":
                    createStoredNotification({
                        id:
                            "two",

                        createdAt:
                            TestTimestamp
                                .fromMillis(
                                    3000
                                ),

                        scheduledAt:
                            TestTimestamp
                                .fromMillis(
                                    4000
                                )
                    })
            });

        const results =
            await queryNotifications(
                createRuntime({
                    firestore:
                        firestore
                }),
                {
                    createdAfter:
                        2000,

                    scheduledBefore:
                        5000
                },
                {}
            );

        assert.deepEqual(
            results.map(
                function (
                    notification
                ) {
                    return notification.id;
                }
            ),
            [
                "two"
            ]
        );
    }
);

test(
    "queryNotifications returns empty list when disabled",
    async function () {
        assert.deepEqual(
            await queryNotifications(
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
    "sanitizeNotificationMetadata redacts sensitive fields",
    function () {
        const result =
            sanitizeNotificationMetadata(
                {
                    password:
                        "secret",

                    authorization:
                        "Bearer token",

                    nested: {
                        apiKey:
                            "private"
                    },

                    safe:
                        "visible"
                },
                {
                    maxMetadataDepth:
                        8,

                    maxBodyLength:
                        1000,

                    maxArrayLength:
                        100
                }
            );

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

                safe:
                    "visible"
            }
        );
    }
);

test(
    "sanitizeNotificationMetadata handles special values",
    function () {
        const error =
            new Error(
                "Failure."
            );

        error.code =
            "test-error";

        const result =
            sanitizeNotificationMetadata(
                {
                    date:
                        new Date(
                            "2026-07-20T09:00:00.000Z"
                        ),

                    buffer:
                        Buffer.from(
                            "hello"
                        ),

                    amount:
                        10n,

                    error:
                        error
                },
                {
                    maxMetadataDepth:
                        8,

                    maxBodyLength:
                        1000,

                    maxArrayLength:
                        100
                }
            );

        assert.equal(
            result.date,
            "2026-07-20T09:00:00.000Z"
        );

        assert.equal(
            result.buffer,
            "[Buffer 5 bytes]"
        );

        assert.equal(
            result.amount,
            "10"
        );

        assert.equal(
            result.error.code,
            "test-error"
        );
    }
);

test(
    "sanitizeNotificationMetadata handles circular values",
    function () {
        const value = {
            safe:
                true
        };

        value.self =
            value;

        const result =
            sanitizeNotificationMetadata(
                value,
                {
                    maxMetadataDepth:
                        8,

                    maxBodyLength:
                        1000,

                    maxArrayLength:
                        100
                }
            );

        assert.equal(
            result.self,
            "[Circular]"
        );
    }
);

test(
    "isSensitiveMetadataKey detects sensitive names",
    function () {
        assert.equal(
            isSensitiveMetadataKey(
                "password"
            ),
            true
        );

        assert.equal(
            isSensitiveMetadataKey(
                "customerApiKey"
            ),
            true
        );

        assert.equal(
            isSensitiveMetadataKey(
                "orderId"
            ),
            false
        );
    }
);

test(
    "sanitizeNotificationRecord serializes timestamps",
    function () {
        const result =
            sanitizeNotificationRecord(
                createStoredNotification({
                    sentAt:
                        TestTimestamp
                            .fromMillis(
                                2000
                            ),

                    deliveredAt:
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
            result.sentAt,
            new Date(
                2000
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
    "serializeNotificationError returns safe metadata",
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
            serializeNotificationError(
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
    "notification error factories create service errors",
    function () {
        const notFound =
            createNotificationNotFoundError(
                "notification-1"
            );

        const conflict =
            createNotificationConflictError(
                "notification-1",
                {
                    requestId:
                        "req_1"
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
            "req_1"
        );
    }
);

/* ==========================================================
   RUNTIME AND TIME
========================================================== */

test(
    "assertNotificationRuntime validates datastore",
    function () {
        assert.doesNotThrow(
            function () {
                assertNotificationRuntime(
                    createRuntime()
                );
            }
        );

        assert.throws(
            function () {
                assertNotificationRuntime(
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
   GENERAL HELPERS
========================================================== */

test(
    "truncateString preserves and truncates text",
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
                "x".repeat(100),
                20
            );

        assert.equal(
            truncated.length,
            20
        );

        assert.match(
            truncated,
            /\[TRUNCATED\]$/
        );
    }
);

test(
    "normalizeOptionalString handles empty values",
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
    }
);

/* ==========================================================
   LOGGING
========================================================== */

test(
    "logNotificationEvent logs normal events",
    function () {
        const logger =
            createLoggerStub();

        logNotificationEvent(
            {
                logger:
                    logger
            },
            {
                id:
                    "notification-1",

                channel:
                    "email",

                status:
                    "pending",

                userId:
                    "customer-1"
            },
            "queued",
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
            "Notification event."
        );
    }
);

test(
    "logNotificationEvent logs failures as warnings",
    function () {
        const logger =
            createLoggerStub();

        logNotificationEvent(
            {
                logger:
                    logger
            },
            {
                id:
                    "notification-1",

                channel:
                    "email",

                status:
                    "failed",

                userId:
                    "customer-1"
            },
            "status-updated",
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
            "Notification delivery failed."
        );
    }
);

test(
    "logNotificationEvent can be disabled",
    function () {
        const logger =
            createLoggerStub();

        logNotificationEvent(
            {
                logger:
                    logger
            },
            {},
            "queued",
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
    "notification constants expose expected defaults",
    function () {
        assert.equal(
            constants
                .NOTIFICATION_COLLECTION,
            "_notifications"
        );

        assert.equal(
            constants.DEFAULT_CHANNEL,
            "in-app"
        );

        assert.equal(
            constants.DEFAULT_STATUS,
            "pending"
        );

        assert.equal(
            constants.DEFAULT_PRIORITY,
            "normal"
        );

        assert.equal(
            constants
                .DEFAULT_MAX_TITLE_LENGTH,
            200
        );

        assert.equal(
            constants
                .DEFAULT_MAX_BODY_LENGTH,
            10000
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
                .NOTIFICATION_CHANNELS,
            {
                email:
                    "email",

                push:
                    "push",

                sms:
                    "sms",

                inApp:
                    "in-app"
            }
        );

        assert.deepEqual(
            constants
                .NOTIFICATION_PRIORITIES,
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
                .TERMINAL_STATUSES
                .includes(
                    "failed"
                ),
            true
        );

        assert.equal(
            constants
                .SENSITIVE_METADATA_KEYS
                .includes(
                    "password"
                ),
            true
        );
    }
);