"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   NOTIFICATION SERVICE

   Responsibilities:
   - Queue user notifications in Firestore
   - Support email, push, SMS, and in-app channels
   - Normalize recipients and message content
   - Prevent duplicate notifications
   - Track delivery lifecycle and failures
   - Query and update notification records
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

const NOTIFICATION_COLLECTION =
    "_notifications";

const DEFAULT_CHANNEL =
    "in-app";

const DEFAULT_STATUS =
    "pending";

const DEFAULT_PRIORITY =
    "normal";

const DEFAULT_MAX_TITLE_LENGTH =
    200;

const DEFAULT_MAX_BODY_LENGTH =
    10000;

const DEFAULT_MAX_METADATA_DEPTH =
    8;

const DEFAULT_MAX_ARRAY_LENGTH =
    100;

const DEFAULT_QUERY_LIMIT =
    100;

const MAX_QUERY_LIMIT =
    500;

const DEFAULT_RETENTION_MS =
    90 * 24 * 60 * 60 * 1000;

const NOTIFICATION_CHANNELS =
    Object.freeze({
        email:
            "email",

        push:
            "push",

        sms:
            "sms",

        inApp:
            "in-app"
    });

const NOTIFICATION_STATUSES =
    Object.freeze({
        pending:
            "pending",

        processing:
            "processing",

        sent:
            "sent",

        delivered:
            "delivered",

        failed:
            "failed",

        cancelled:
            "cancelled",

        read:
            "read"
    });

const NOTIFICATION_PRIORITIES =
    Object.freeze({
        low:
            "low",

        normal:
            "normal",

        high:
            "high",

        urgent:
            "urgent"
    });

const TERMINAL_STATUSES =
    Object.freeze([
        NOTIFICATION_STATUSES.delivered,
        NOTIFICATION_STATUSES.failed,
        NOTIFICATION_STATUSES.cancelled,
        NOTIFICATION_STATUSES.read
    ]);

const SENSITIVE_METADATA_KEYS =
    Object.freeze([
        "authorization",
        "cookie",
        "password",
        "passcode",
        "pin",
        "secret",
        "token",
        "access_token",
        "access-token",
        "refresh_token",
        "refresh-token",
        "api_key",
        "api-key",
        "private_key",
        "private-key",
        "card_number",
        "card-number",
        "cvv",
        "cvc"
    ]);

/* ==========================================================
   SERVICE FACTORY
========================================================== */

function createNotificationService(
    options
) {
    const settings =
        normalizeNotificationOptions(
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

        queue:
            function (
                notification,
                overrides
            ) {
                return queueNotification(
                    runtime,
                    notification,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        get:
            function (
                notificationId,
                overrides
            ) {
                return getNotification(
                    runtime,
                    notificationId,
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
                return queryNotifications(
                    runtime,
                    filters,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        updateStatus:
            function (
                notificationId,
                status,
                details,
                overrides
            ) {
                return updateNotificationStatus(
                    runtime,
                    notificationId,
                    status,
                    details,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        cancel:
            function (
                notificationId,
                reason,
                overrides
            ) {
                return cancelNotification(
                    runtime,
                    notificationId,
                    reason,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        markRead:
            function (
                notificationId,
                overrides
            ) {
                return markNotificationRead(
                    runtime,
                    notificationId,
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
   QUEUE
========================================================== */

async function queueNotification(
    runtime,
    notification,
    options
) {
    const settings =
        normalizeNotificationOptions(
            options
        );

    const record =
        normalizeNotificationRecord(
            notification,
            settings,
            runtime
        );

    if (
        settings.disabled
    ) {
        return {
            queued:
                false,

            duplicate:
                false,

            disabled:
                true,

            notificationId:
                record.id,

            notification:
                sanitizeNotificationRecord(
                    record
                )
        };
    }

    assertNotificationRuntime(
        runtime
    );

    const reference =
        runtime.db
            .collection(
                settings.collection
            )
            .doc(
                record.id
            );

    const result =
        settings.preventDuplicates
            ? await queueUniqueNotification(
                  runtime,
                  reference,
                  record,
                  settings
              )
            : await storeNotification(
                  reference,
                  record
              );

    logNotificationEvent(
        runtime,
        result.notification ||
        record,
        result.duplicate
            ? "duplicate"
            : "queued",
        settings
    );

    return {
        queued:
            !result.duplicate,

        duplicate:
            Boolean(
                result.duplicate
            ),

        disabled:
            false,

        notificationId:
            record.id,

        notification:
            sanitizeNotificationRecord(
                result.notification ||
                record
            )
    };
}

async function queueUniqueNotification(
    runtime,
    reference,
    record,
    options
) {
    const settings =
        options || {};

    if (
        !runtime.db ||
        typeof runtime.db
            .runTransaction !==
            "function"
    ) {
        return storeNotification(
            reference,
            record
        );
    }

    return runtime.db
        .runTransaction(
            async function (
                transaction
            ) {
                const snapshot =
                    await transaction.get(
                        reference
                    );

                if (
                    snapshot.exists
                ) {
                    const existing =
                        snapshot.data();

                    if (
                        existing &&
                        existing.fingerprint ===
                            record.fingerprint
                    ) {
                        return {
                            duplicate:
                                true,

                            notification:
                                existing
                        };
                    }

                    throw createNotificationConflictError(
                        record.id,
                        settings
                    );
                }

                transaction.set(
                    reference,
                    record,
                    {
                        merge:
                            false
                    }
                );

                return {
                    duplicate:
                        false,

                    notification:
                        record
                };
            }
        );
}

async function storeNotification(
    reference,
    record
) {
    await reference.set(
        record,
        {
            merge:
                false
        }
    );

    return {
        duplicate:
            false,

        notification:
            record
    };
}

/* ==========================================================
   RECORD NORMALIZATION
========================================================== */

function normalizeNotificationRecord(
    notification,
    options,
    runtime
) {
    const source =
        notification || {};

    if (
        typeof source !==
            "object" ||
        Array.isArray(source)
    ) {
        throw new TypeError(
            "Notification must be an object."
        );
    }

    const settings =
        normalizeNotificationOptions(
            options
        );

    const now =
        resolveNow(
            runtime,
            settings
        );

    const channel =
        normalizeNotificationChannel(
            source.channel ||
            settings.defaultChannel
        );

    const recipient =
        normalizeNotificationRecipient(
            source.recipient ||
            source.to,
            channel
        );

    const title =
        normalizeNotificationTitle(
            source.title ||
            source.subject,
            settings.maxTitleLength
        );

    const body =
        normalizeNotificationBody(
            source.body ||
            source.message,
            settings.maxBodyLength
        );

    const scheduledAt =
        source.scheduledAt !==
        undefined &&
        source.scheduledAt !==
        null
            ? normalizeNotificationDate(
                  source.scheduledAt,
                  "Notification schedule"
              )
            : now;

    const id =
        source.id
            ? normalizeNotificationId(
                  source.id
              )
            : createNotificationId(
                  source,
                  recipient,
                  channel,
                  settings,
                  now
              );

    const metadata =
        sanitizeNotificationMetadata(
            source.metadata ||
            source.data ||
            {},
            settings
        );

    const fingerprint =
        createNotificationFingerprint({
            channel:
                channel,

            recipient:
                recipient,

            title:
                title,

            body:
                body,

            template:
                source.template ||
                null,

            metadata:
                metadata,

            scheduledAt:
                scheduledAt
        });

    return {
        id:
            id,

        fingerprint:
            fingerprint,

        channel:
            channel,

        recipient:
            recipient,

        userId:
            normalizeOptionalString(
                source.userId ||
                recipient.userId
            ),

        title:
            title,

        body:
            body,

        template:
            normalizeOptionalString(
                source.template ||
                source.templateId
            ),

        locale:
            normalizeOptionalString(
                source.locale ||
                settings.defaultLocale
            ),

        priority:
            normalizeNotificationPriority(
                source.priority ||
                settings.defaultPriority
            ),

        status:
            NOTIFICATION_STATUSES
                .pending,

        metadata:
            metadata,

        tags:
            normalizeNotificationTags(
                source.tags
            ),

        attempts:
            0,

        provider:
            null,

        providerMessageId:
            null,

        lastError:
            null,

        createdAt:
            createDatabaseTimestamp(
                runtime,
                now
            ),

        updatedAt:
            createDatabaseTimestamp(
                runtime,
                now
            ),

        scheduledAt:
            createDatabaseTimestamp(
                runtime,
                scheduledAt
            ),

        processingAt:
            null,

        sentAt:
            null,

        deliveredAt:
            null,

        failedAt:
            null,

        cancelledAt:
            null,

        readAt:
            null,

        expiresAt:
            settings.retentionMs
                ? createDatabaseTimestamp(
                      runtime,
                      now +
                      settings
                          .retentionMs
                  )
                : null,

        schemaVersion:
            1
    };
}

/* ==========================================================
   RECIPIENT
========================================================== */

function normalizeNotificationRecipient(
    recipient,
    channel
) {
    if (
        recipient === undefined ||
        recipient === null
    ) {
        throw new ServiceError(
            "invalid-argument",
            "A notification recipient is required.",
            {
                status:
                    400,

                expose:
                    true
            }
        );
    }

    const source =
        typeof recipient ===
        "object" &&
        !Array.isArray(recipient)
            ? recipient
            : {
                  address:
                      recipient
              };

    const normalized = {
        userId:
            normalizeOptionalString(
                source.userId ||
                source.uid
            ),

        address:
            normalizeOptionalString(
                source.address ||
                source.email ||
                source.phone ||
                source.token
            ),

        email:
            normalizeOptionalString(
                source.email
            ),

        phone:
            normalizeOptionalString(
                source.phone
            ),

        deviceToken:
            normalizeOptionalString(
                source.deviceToken ||
                source.token
            ),

        name:
            normalizeOptionalString(
                source.name
            )
    };

    if (
        channel ===
        NOTIFICATION_CHANNELS.email
    ) {
        normalized.email =
            normalized.email ||
            normalized.address;

        assertValidEmail(
            normalized.email
        );
    }

    if (
        channel ===
        NOTIFICATION_CHANNELS.sms
    ) {
        normalized.phone =
            normalized.phone ||
            normalized.address;

        assertValidPhone(
            normalized.phone
        );
    }

    if (
        channel ===
        NOTIFICATION_CHANNELS.push
    ) {
        normalized.deviceToken =
            normalized.deviceToken ||
            normalized.address;

        if (
            !normalized.deviceToken
        ) {
            throw new ServiceError(
                "invalid-argument",
                "A push notification device token is required.",
                {
                    status:
                        400,

                    expose:
                        true
                }
            );
        }
    }

    if (
        channel ===
        NOTIFICATION_CHANNELS.inApp &&
        !normalized.userId
    ) {
        throw new ServiceError(
            "invalid-argument",
            "An in-app notification user ID is required.",
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

function assertValidEmail(
    value
) {
    if (
        !value ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
            .test(value)
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The notification email address is invalid.",
            {
                status:
                    400,

                expose:
                    true
            }
        );
    }

    return true;
}

function assertValidPhone(
    value
) {
    const normalized =
        String(
            value || ""
        ).replace(
            /[\s()-]/g,
            ""
        );

    if (
        !/^\+?[0-9]{7,20}$/
            .test(normalized)
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The notification phone number is invalid.",
            {
                status:
                    400,

                expose:
                    true
            }
        );
    }

    return true;
}

/* ==========================================================
   READ
========================================================== */

async function getNotification(
    runtime,
    notificationId,
    options
) {
    const settings =
        normalizeNotificationOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return null;
    }

    assertNotificationRuntime(
        runtime
    );

    const id =
        normalizeNotificationId(
            notificationId
        );

    const snapshot =
        await runtime.db
            .collection(
                settings.collection
            )
            .doc(
                id
            )
            .get();

    if (
        !snapshot.exists
    ) {
        return null;
    }

    return sanitizeNotificationRecord(
        snapshot.data()
    );
}

/* ==========================================================
   STATUS UPDATE
========================================================== */

async function updateNotificationStatus(
    runtime,
    notificationId,
    status,
    details,
    options
) {
    const settings =
        normalizeNotificationOptions(
            options
        );

    const id =
        normalizeNotificationId(
            notificationId
        );

    const normalizedStatus =
        normalizeNotificationStatus(
            status
        );

    if (
        settings.disabled
    ) {
        return {
            updated:
                false,

            disabled:
                true,

            notificationId:
                id,

            status:
                normalizedStatus
        };
    }

    assertNotificationRuntime(
        runtime
    );

    const reference =
        runtime.db
            .collection(
                settings.collection
            )
            .doc(
                id
            );

    const now =
        resolveNow(
            runtime,
            settings
        );

    const update =
        createStatusUpdate(
            runtime,
            normalizedStatus,
            details,
            now,
            settings
        );

    let record;

    if (
        runtime.db &&
        typeof runtime.db
            .runTransaction ===
            "function"
    ) {
        record =
            await runtime.db
                .runTransaction(
                    async function (
                        transaction
                    ) {
                        const snapshot =
                            await transaction.get(
                                reference
                            );

                        if (
                            !snapshot.exists
                        ) {
                            throw createNotificationNotFoundError(
                                id
                            );
                        }

                        const existing =
                            snapshot.data();

                        assertValidStatusTransition(
                            existing.status,
                            normalizedStatus
                        );

                        const merged =
                            Object.assign(
                                {},
                                existing,
                                update
                            );

                        transaction.set(
                            reference,
                            update,
                            {
                                merge:
                                    true
                            }
                        );

                        return merged;
                    }
                );
    } else {
        const snapshot =
            await reference.get();

        if (
            !snapshot.exists
        ) {
            throw createNotificationNotFoundError(
                id
            );
        }

        const existing =
            snapshot.data();

        assertValidStatusTransition(
            existing.status,
            normalizedStatus
        );

        await reference.set(
            update,
            {
                merge:
                    true
            }
        );

        record =
            Object.assign(
                {},
                existing,
                update
            );
    }

    logNotificationEvent(
        runtime,
        record,
        "status-updated",
        settings
    );

    return {
        updated:
            true,

        disabled:
            false,

        notificationId:
            id,

        status:
            normalizedStatus,

        notification:
            sanitizeNotificationRecord(
                record
            )
    };
}

function createStatusUpdate(
    runtime,
    status,
    details,
    now,
    options
) {
    const source =
        details || {};

    const settings =
        options || {};

    const update = {
        status:
            status,

        updatedAt:
            createDatabaseTimestamp(
                runtime,
                now
            )
    };

    if (
        status ===
        NOTIFICATION_STATUSES
            .processing
    ) {
        update.processingAt =
            createDatabaseTimestamp(
                runtime,
                now
            );

        update.attempts =
            normalizeNonNegativeInteger(
                source.attempts,
                1,
                "Notification attempts"
            );
    }

    if (
        status ===
        NOTIFICATION_STATUSES.sent
    ) {
        update.sentAt =
            createDatabaseTimestamp(
                runtime,
                now
            );
    }

    if (
        status ===
        NOTIFICATION_STATUSES.delivered
    ) {
        update.deliveredAt =
            createDatabaseTimestamp(
                runtime,
                now
            );
    }

    if (
        status ===
        NOTIFICATION_STATUSES.failed
    ) {
        update.failedAt =
            createDatabaseTimestamp(
                runtime,
                now
            );

        update.lastError =
            serializeNotificationError(
                source.error ||
                source
            );
    }

    if (
        status ===
        NOTIFICATION_STATUSES.cancelled
    ) {
        update.cancelledAt =
            createDatabaseTimestamp(
                runtime,
                now
            );

        update.cancellationReason =
            normalizeOptionalString(
                source.reason
            );
    }

    if (
        status ===
        NOTIFICATION_STATUSES.read
    ) {
        update.readAt =
            createDatabaseTimestamp(
                runtime,
                now
            );
    }

    if (
        source.provider
    ) {
        update.provider =
            normalizeOptionalString(
                source.provider
            );
    }

    if (
        source.providerMessageId
    ) {
        update.providerMessageId =
            normalizeOptionalString(
                source.providerMessageId
            );
    }

    if (
        source.metadata
    ) {
        update.deliveryMetadata =
            sanitizeNotificationMetadata(
                source.metadata,
                settings
            );
    }

    return update;
}

function assertValidStatusTransition(
    currentStatus,
    nextStatus
) {
    const current =
        normalizeNotificationStatus(
            currentStatus
        );

    const next =
        normalizeNotificationStatus(
            nextStatus
        );

    if (
        current === next
    ) {
        return true;
    }

    if (
        TERMINAL_STATUSES.includes(
            current
        )
    ) {
        throw new ServiceError(
            "failed-precondition",
            "A terminal notification cannot change status.",
            {
                status:
                    409,

                expose:
                    true,

                details: {
                    currentStatus:
                        current,

                    nextStatus:
                        next
                }
            }
        );
    }

    const allowed =
        {
            pending: [
                "processing",
                "sent",
                "cancelled",
                "failed"
            ],

            processing: [
                "sent",
                "delivered",
                "failed",
                "cancelled"
            ],

            sent: [
                "delivered",
                "failed",
                "read"
            ]
        };

    if (
        !allowed[current] ||
        !allowed[current].includes(
            next
        )
    ) {
        throw new ServiceError(
            "failed-precondition",
            "The notification status transition is invalid.",
            {
                status:
                    409,

                expose:
                    true,

                details: {
                    currentStatus:
                        current,

                    nextStatus:
                        next
                }
            }
        );
    }

    return true;
}

/* ==========================================================
   CANCEL AND READ
========================================================== */

function cancelNotification(
    runtime,
    notificationId,
    reason,
    options
) {
    return updateNotificationStatus(
        runtime,
        notificationId,
        NOTIFICATION_STATUSES
            .cancelled,
        {
            reason:
                reason
        },
        options
    );
}

function markNotificationRead(
    runtime,
    notificationId,
    options
) {
    return updateNotificationStatus(
        runtime,
        notificationId,
        NOTIFICATION_STATUSES
            .read,
        {},
        options
    );
}

/* ==========================================================
   QUERY
========================================================== */

async function queryNotifications(
    runtime,
    filters,
    options
) {
    const settings =
        normalizeNotificationOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return [];
    }

    assertNotificationRuntime(
        runtime
    );

    const normalized =
        normalizeNotificationQuery(
            filters,
            settings
        );

    let query =
        runtime.db
            .collection(
                settings.collection
            );

    if (
        normalized.userId
    ) {
        query =
            query.where(
                "userId",
                "==",
                normalized.userId
            );
    }

    if (
        normalized.channel
    ) {
        query =
            query.where(
                "channel",
                "==",
                normalized.channel
            );
    }

    if (
        normalized.status
    ) {
        query =
            query.where(
                "status",
                "==",
                normalized.status
            );
    }

    if (
        normalized.priority
    ) {
        query =
            query.where(
                "priority",
                "==",
                normalized.priority
            );
    }

    if (
        normalized.scheduledBefore
    ) {
        query =
            query.where(
                "scheduledAt",
                "<=",
                createDatabaseTimestamp(
                    runtime,
                    normalized
                        .scheduledBefore
                )
            );
    }

    if (
        normalized.createdAfter
    ) {
        query =
            query.where(
                "createdAt",
                ">=",
                createDatabaseTimestamp(
                    runtime,
                    normalized
                        .createdAfter
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
            return sanitizeNotificationRecord(
                document.data()
            );
        }
    );
}

function normalizeNotificationQuery(
    filters,
    options
) {
    const source =
        filters || {};

    const settings =
        options || {};

    return {
        userId:
            normalizeOptionalString(
                source.userId
            ),

        channel:
            source.channel
                ? normalizeNotificationChannel(
                      source.channel
                  )
                : null,

        status:
            source.status
                ? normalizeNotificationStatus(
                      source.status
                  )
                : null,

        priority:
            source.priority
                ? normalizeNotificationPriority(
                      source.priority
                  )
                : null,

        scheduledBefore:
            source.scheduledBefore !==
            undefined
                ? normalizeNotificationDate(
                      source.scheduledBefore,
                      "Notification schedule filter"
                  )
                : null,

        createdAfter:
            source.createdAfter !==
            undefined
                ? normalizeNotificationDate(
                      source.createdAfter,
                      "Notification creation filter"
                  )
                : null,

        orderBy:
            normalizeNotificationOrderField(
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
   SANITIZATION
========================================================== */

function sanitizeNotificationRecord(
    record
) {
    if (
        !record
    ) {
        return null;
    }

    return {
        id:
            record.id,

        fingerprint:
            record.fingerprint,

        channel:
            normalizeNotificationChannel(
                record.channel
            ),

        recipient:
            cloneValue(
                record.recipient
            ),

        userId:
            record.userId ||
            null,

        title:
            record.title ||
            null,

        body:
            record.body,

        template:
            record.template ||
            null,

        locale:
            record.locale ||
            null,

        priority:
            normalizeNotificationPriority(
                record.priority
            ),

        status:
            normalizeNotificationStatus(
                record.status
            ),

        metadata:
            cloneValue(
                record.metadata
            ),

        tags:
            Array.isArray(
                record.tags
            )
                ? record.tags.slice()
                : [],

        attempts:
            normalizeNonNegativeInteger(
                record.attempts,
                0,
                "Notification attempts"
            ),

        provider:
            record.provider ||
            null,

        providerMessageId:
            record.providerMessageId ||
            null,

        lastError:
            cloneValue(
                record.lastError
            ),

        cancellationReason:
            record.cancellationReason ||
            null,

        createdAt:
            serializeTimestamp(
                record.createdAt
            ),

        updatedAt:
            serializeTimestamp(
                record.updatedAt
            ),

        scheduledAt:
            serializeTimestamp(
                record.scheduledAt
            ),

        processingAt:
            serializeTimestamp(
                record.processingAt
            ),

        sentAt:
            serializeTimestamp(
                record.sentAt
            ),

        deliveredAt:
            serializeTimestamp(
                record.deliveredAt
            ),

        failedAt:
            serializeTimestamp(
                record.failedAt
            ),

        cancelledAt:
            serializeTimestamp(
                record.cancelledAt
            ),

        readAt:
            serializeTimestamp(
                record.readAt
            ),

        expiresAt:
            serializeTimestamp(
                record.expiresAt
            ),

        schemaVersion:
            Number(
                record.schemaVersion ||
                1
            )
    };
}

function sanitizeNotificationMetadata(
    value,
    options,
    state
) {
    const settings =
        options || {};

    const currentState =
        state || {
            seen:
                new WeakSet(),

            depth:
                0
        };

    if (
        currentState.depth >
        settings.maxMetadataDepth
    ) {
        return "[Maximum depth reached]";
    }

    if (
        value === undefined
    ) {
        return null;
    }

    if (
        value === null ||
        typeof value ===
            "number" ||
        typeof value ===
            "boolean"
    ) {
        return value;
    }

    if (
        typeof value ===
        "string"
    ) {
        return truncateString(
            value,
            settings.maxBodyLength
        );
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
        return (
            "[Buffer " +
            value.length +
            " bytes]"
        );
    }

    if (
        value instanceof Error
    ) {
        return serializeNotificationError(
            value
        );
    }

    if (
        value &&
        typeof value.toMillis ===
            "function"
    ) {
        return new Date(
            value.toMillis()
        ).toISOString();
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
        return "[Circular]";
    }

    currentState.seen.add(
        value
    );

    const nextState = {
        seen:
            currentState.seen,

        depth:
            currentState.depth +
            1
    };

    if (
        Array.isArray(value)
    ) {
        const result =
            value
                .slice(
                    0,
                    settings
                        .maxArrayLength
                )
                .map(
                    function (item) {
                        return sanitizeNotificationMetadata(
                            item,
                            settings,
                            nextState
                        );
                    }
                );

        currentState.seen.delete(
            value
        );

        return result;
    }

    const result =
        {};

    Object.keys(value)
        .sort()
        .forEach(
            function (key) {
                if (
                    isSensitiveMetadataKey(
                        key
                    )
                ) {
                    result[key] =
                        "[REDACTED]";

                    return;
                }

                result[key] =
                    sanitizeNotificationMetadata(
                        value[key],
                        settings,
                        nextState
                    );
            }
        );

    currentState.seen.delete(
        value
    );

    return result;
}

function isSensitiveMetadataKey(
    key
) {
    const normalized =
        String(
            key || ""
        )
            .trim()
            .toLowerCase()
            .replace(
                /\s+/g,
                ""
            );

    return SENSITIVE_METADATA_KEYS
        .some(
            function (
                sensitiveKey
            ) {
                const comparable =
                    sensitiveKey
                        .toLowerCase()
                        .replace(
                            /\s+/g,
                            ""
                        );

                return (
                    normalized ===
                        comparable ||
                    normalized.includes(
                        comparable
                    )
                );
            }
        );
}

/* ==========================================================
   NORMALIZERS
========================================================== */

function normalizeNotificationId(
    value
) {
    const normalized =
        String(
            value || ""
        ).trim();

    if (
        !normalized ||
        normalized.includes("/")
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The notification ID is invalid.",
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

function normalizeNotificationChannel(
    value
) {
    const normalized =
        String(
            value ||
            DEFAULT_CHANNEL
        )
            .trim()
            .toLowerCase();

    if (
        !Object.values(
            NOTIFICATION_CHANNELS
        ).includes(
            normalized
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The notification channel is invalid.",
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

function normalizeNotificationStatus(
    value
) {
    const normalized =
        String(
            value ||
            DEFAULT_STATUS
        )
            .trim()
            .toLowerCase();

    if (
        !Object.values(
            NOTIFICATION_STATUSES
        ).includes(
            normalized
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The notification status is invalid.",
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

function normalizeNotificationPriority(
    value
) {
    const normalized =
        String(
            value ||
            DEFAULT_PRIORITY
        )
            .trim()
            .toLowerCase();

    return Object.values(
        NOTIFICATION_PRIORITIES
    ).includes(
        normalized
    )
        ? normalized
        : DEFAULT_PRIORITY;
}

function normalizeNotificationTitle(
    value,
    maximumLength
) {
    if (
        value === undefined ||
        value === null
    ) {
        return null;
    }

    return truncateString(
        String(value).trim(),
        maximumLength
    ) || null;
}

function normalizeNotificationBody(
    value,
    maximumLength
) {
    const normalized =
        String(
            value || ""
        ).trim();

    if (
        !normalized
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The notification body is required.",
            {
                status:
                    400,

                expose:
                    true
            }
        );
    }

    return truncateString(
        normalized,
        maximumLength
    );
}

function normalizeNotificationTags(
    value
) {
    if (
        value === undefined ||
        value === null
    ) {
        return [];
    }

    const tags =
        Array.isArray(value)
            ? value
            : [
                  value
              ];

    return Array.from(
        new Set(
            tags
                .map(
                    function (tag) {
                        return String(
                            tag || ""
                        )
                            .trim()
                            .toLowerCase();
                    }
                )
                .filter(Boolean)
        )
    ).slice(
        0,
        DEFAULT_MAX_ARRAY_LENGTH
    );
}

function normalizeNotificationDate(
    value,
    label
) {
    const milliseconds =
        toMilliseconds(
            value
        );

    if (
        !Number.isFinite(
            milliseconds
        ) ||
        milliseconds < 0
    ) {
        throw new TypeError(
            label +
            " is invalid."
        );
    }

    return milliseconds;
}

function normalizeNotificationOrderField(
    value
) {
    const allowed =
        new Set([
            "createdAt",
            "updatedAt",
            "scheduledAt",
            "sentAt",
            "deliveredAt",
            "priority",
            "status"
        ]);

    const normalized =
        String(
            value ||
            "createdAt"
        ).trim();

    return allowed.has(
        normalized
    )
        ? normalized
        : "createdAt";
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
            "Notification query limit must be a positive integer."
        );
    }

    return Math.min(
        normalized,
        MAX_QUERY_LIMIT
    );
}

function normalizeOptionalString(
    value
) {
    if (
        value === undefined ||
        value === null
    ) {
        return null;
    }

    const normalized =
        String(value)
            .trim();

    return normalized ||
        null;
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
            "Notification collection must be a Firestore collection name."
        );
    }

    return collection;
}

/* ==========================================================
   OPTIONS
========================================================== */

function normalizeNotificationOptions(
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
                NOTIFICATION_COLLECTION
            ),

        defaultChannel:
            normalizeNotificationChannel(
                settings.defaultChannel ||
                DEFAULT_CHANNEL
            ),

        defaultPriority:
            normalizeNotificationPriority(
                settings.defaultPriority ||
                DEFAULT_PRIORITY
            ),

        defaultLocale:
            normalizeOptionalString(
                settings.defaultLocale ||
                "en"
            ),

        maxTitleLength:
            normalizePositiveInteger(
                settings.maxTitleLength,
                DEFAULT_MAX_TITLE_LENGTH,
                "Maximum notification title length"
            ),

        maxBodyLength:
            normalizePositiveInteger(
                settings.maxBodyLength,
                DEFAULT_MAX_BODY_LENGTH,
                "Maximum notification body length"
            ),

        maxMetadataDepth:
            normalizePositiveInteger(
                settings.maxMetadataDepth,
                DEFAULT_MAX_METADATA_DEPTH,
                "Maximum notification metadata depth"
            ),

        maxArrayLength:
            normalizePositiveInteger(
                settings.maxArrayLength,
                DEFAULT_MAX_ARRAY_LENGTH,
                "Maximum notification array length"
            ),

        queryLimit:
            normalizeQueryLimit(
                settings.queryLimit
            ),

        retentionMs:
            normalizeNonNegativeInteger(
                settings.retentionMs,
                DEFAULT_RETENTION_MS,
                "Notification retention"
            ),

        preventDuplicates:
            settings.preventDuplicates !==
            false,

        disabled:
            Boolean(
                settings.disabled
            ),

        log:
            settings.log !==
            false,

        now:
            settings.now,

        idResolver:
            settings.idResolver
    };
}

/* ==========================================================
   IDENTIFIERS AND FINGERPRINTS
========================================================== */

function createNotificationId(
    notification,
    recipient,
    channel,
    options,
    now
) {
    const settings =
        options || {};

    if (
        typeof settings.idResolver ===
        "function"
    ) {
        return normalizeNotificationId(
            settings.idResolver(
                notification,
                recipient,
                channel
            )
        );
    }

    const source =
        notification || {};

    if (
        source.idempotencyKey
    ) {
        return hashNotificationValue(
            [
                channel,
                source.idempotencyKey
            ].join(":")
        );
    }

    const prefix =
        Number(now)
            .toString(36)
            .padStart(
                9,
                "0"
            );

    const random =
        typeof crypto.randomUUID ===
        "function"
            ? crypto
                  .randomUUID()
                  .replace(
                      /-/g,
                      ""
                  )
            : crypto
                  .randomBytes(16)
                  .toString("hex");

    return (
        prefix +
        "_" +
        random
    );
}

function createNotificationFingerprint(
    value
) {
    return hashNotificationValue(
        stableStringify(
            value
        )
    );
}

function hashNotificationValue(
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
        value &&
        typeof value.toMillis ===
            "function"
    ) {
        return value.toMillis();
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
            "Notification data contains a circular reference.",
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

    let result;

    if (
        Array.isArray(value)
    ) {
        result =
            value.map(
                function (item) {
                    return normalizeStableValue(
                        item,
                        currentState
                    );
                }
            );
    } else {
        result =
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
    }

    currentState.seen.delete(
        value
    );

    return result;
}

/* ==========================================================
   ERRORS
========================================================== */

function serializeNotificationError(
    error
) {
    if (
        !error
    ) {
        return null;
    }

    return {
        name:
            error.name ||
            "Error",

        code:
            error.code ||
            "notification-failed",

        message:
            error.publicMessage ||
            error.message ||
            "Notification delivery failed.",

        status:
            Number(
                error.status ||
                error.statusCode ||
                500
            ),

        retryable:
            Boolean(
                error.retryable
            )
    };
}

function createNotificationNotFoundError(
    notificationId
) {
    return new ServiceError(
        "not-found",
        "The notification was not found.",
        {
            status:
                404,

            expose:
                true,

            details: {
                notificationId:
                    notificationId
            }
        }
    );
}

function createNotificationConflictError(
    notificationId,
    options
) {
    const settings =
        options || {};

    return new ServiceError(
        "already-exists",
        "A notification with this ID already exists.",
        {
            status:
                409,

            expose:
                true,

            retryable:
                false,

            details: {
                notificationId:
                    notificationId
            },

            requestId:
                settings.requestId,

            correlationId:
                settings
                    .correlationId
        }
    );
}

/* ==========================================================
   RUNTIME AND TIME
========================================================== */

function assertNotificationRuntime(
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
            "The notification datastore is unavailable.",
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
            ? Number.NaN
            : parsed;
    }

    const normalized =
        Number(value);

    return Number.isFinite(
        normalized
    )
        ? normalized
        : Number.NaN;
}

function serializeTimestamp(
    value
) {
    const milliseconds =
        toMilliseconds(
            value
        );

    return Number.isFinite(
        milliseconds
    ) &&
    milliseconds > 0
        ? new Date(
              milliseconds
          ).toISOString()
        : null;
}

/* ==========================================================
   DATA HELPERS
========================================================== */

function truncateString(
    value,
    maximumLength
) {
    const text =
        String(value);

    if (
        text.length <=
        maximumLength
    ) {
        return text;
    }

    const suffix =
        "[TRUNCATED]";

    return (
        text.slice(
            0,
            Math.max(
                0,
                maximumLength -
                suffix.length
            )
        ) +
        suffix
    );
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

/* ==========================================================
   LOGGING
========================================================== */

function logNotificationEvent(
    runtime,
    notification,
    event,
    options
) {
    const settings =
        options || {};

    if (
        !settings.log ||
        !runtime ||
        !runtime.logger
    ) {
        return;
    }

    const metadata = {
        event:
            event,

        notificationId:
            notification &&
            notification.id,

        channel:
            notification &&
            notification.channel,

        status:
            notification &&
            notification.status,

        userId:
            notification &&
            notification.userId
    };

    if (
        event ===
            "status-updated" &&
        notification &&
        notification.status ===
            NOTIFICATION_STATUSES
                .failed &&
        typeof runtime.logger.warn ===
            "function"
    ) {
        runtime.logger.warn(
            "Notification delivery failed.",
            metadata
        );

        return;
    }

    if (
        typeof runtime.logger.info ===
        "function"
    ) {
        runtime.logger.info(
            "Notification event.",
            metadata
        );
    } else if (
        typeof runtime.logger.debug ===
        "function"
    ) {
        runtime.logger.debug(
            "Notification event.",
            metadata
        );
    }
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
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
    constants: {
        NOTIFICATION_COLLECTION,
        DEFAULT_CHANNEL,
        DEFAULT_STATUS,
        DEFAULT_PRIORITY,
        DEFAULT_MAX_TITLE_LENGTH,
        DEFAULT_MAX_BODY_LENGTH,
        DEFAULT_MAX_METADATA_DEPTH,
        DEFAULT_MAX_ARRAY_LENGTH,
        DEFAULT_QUERY_LIMIT,
        MAX_QUERY_LIMIT,
        DEFAULT_RETENTION_MS,
        NOTIFICATION_CHANNELS,
        NOTIFICATION_STATUSES,
        NOTIFICATION_PRIORITIES,
        TERMINAL_STATUSES,
        SENSITIVE_METADATA_KEYS
    }
};