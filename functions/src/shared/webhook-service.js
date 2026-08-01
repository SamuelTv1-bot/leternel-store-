"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   WEBHOOK SERVICE

   Responsibilities:
   - Register outbound webhook endpoints
   - Sign webhook payloads
   - Queue and deliver webhook events
   - Track delivery attempts and responses
   - Retry transient failures
   - Verify inbound webhook signatures
   - Query and manage webhook records
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

const WEBHOOK_COLLECTION =
    "_webhooks";

const WEBHOOK_DELIVERY_COLLECTION =
    "_webhookDeliveries";

const DEFAULT_STATUS =
    "active";

const DEFAULT_DELIVERY_STATUS =
    "pending";

const DEFAULT_SIGNING_ALGORITHM =
    "sha256";

const DEFAULT_SIGNATURE_HEADER =
    "x-leternel-signature";

const DEFAULT_TIMESTAMP_HEADER =
    "x-leternel-timestamp";

const DEFAULT_EVENT_HEADER =
    "x-leternel-event";

const DEFAULT_DELIVERY_HEADER =
    "x-leternel-delivery";

const DEFAULT_TIMEOUT_MS =
    10000;

const DEFAULT_MAX_ATTEMPTS =
    5;

const DEFAULT_RETRY_DELAY_MS =
    30000;

const DEFAULT_MAX_RETRY_DELAY_MS =
    60 * 60 * 1000;

const DEFAULT_QUERY_LIMIT =
    100;

const MAX_QUERY_LIMIT =
    500;

const DEFAULT_RETENTION_MS =
    90 * 24 * 60 * 60 * 1000;

const DEFAULT_MAX_PAYLOAD_BYTES =
    500000;

const DEFAULT_MAX_RESPONSE_BYTES =
    100000;

const DEFAULT_SIGNATURE_TOLERANCE_MS =
    5 * 60 * 1000;

const WEBHOOK_STATUSES =
    Object.freeze({
        active:
            "active",

        paused:
            "paused",

        disabled:
            "disabled"
    });

const WEBHOOK_DELIVERY_STATUSES =
    Object.freeze({
        pending:
            "pending",

        processing:
            "processing",

        delivered:
            "delivered",

        retrying:
            "retrying",

        failed:
            "failed",

        cancelled:
            "cancelled"
    });

const TERMINAL_DELIVERY_STATUSES =
    Object.freeze([
        WEBHOOK_DELIVERY_STATUSES.delivered,
        WEBHOOK_DELIVERY_STATUSES.failed,
        WEBHOOK_DELIVERY_STATUSES.cancelled
    ]);

const RETRYABLE_HTTP_STATUSES =
    Object.freeze([
        408,
        409,
        425,
        429,
        500,
        502,
        503,
        504
    ]);

/* ==========================================================
   SERVICE FACTORY
========================================================== */

function createWebhookService(
    options
) {
    const settings =
        normalizeWebhookOptions(
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

        register:
            function (
                webhook,
                overrides
            ) {
                return registerWebhook(
                    runtime,
                    webhook,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        update:
            function (
                webhookId,
                changes,
                overrides
            ) {
                return updateWebhook(
                    runtime,
                    webhookId,
                    changes,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        get:
            function (
                webhookId,
                overrides
            ) {
                return getWebhook(
                    runtime,
                    webhookId,
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
                return queryWebhooks(
                    runtime,
                    filters,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        queue:
            function (
                webhookId,
                event,
                payload,
                overrides
            ) {
                return queueWebhookDelivery(
                    runtime,
                    webhookId,
                    event,
                    payload,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        deliver:
            function (
                deliveryId,
                overrides
            ) {
                return deliverWebhook(
                    runtime,
                    deliveryId,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        cancel:
            function (
                deliveryId,
                reason,
                overrides
            ) {
                return cancelWebhookDelivery(
                    runtime,
                    deliveryId,
                    reason,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        verify:
            function (
                payload,
                signature,
                secret,
                overrides
            ) {
                return verifyWebhookSignature(
                    payload,
                    signature,
                    secret,
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
   REGISTER
========================================================== */

async function registerWebhook(
    runtime,
    webhook,
    options
) {
    const settings =
        normalizeWebhookOptions(
            options
        );

    const record =
        normalizeWebhookRecord(
            webhook,
            settings,
            runtime
        );

    if (
        settings.disabled
    ) {
        return {
            created:
                false,

            duplicate:
                false,

            disabled:
                true,

            webhookId:
                record.id,

            webhook:
                sanitizeWebhookRecord(
                    record
                )
        };
    }

    assertWebhookRuntime(
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
                        snapshot.exists
                    ) {
                        const existing =
                            snapshot.data();

                        if (
                            settings.preventDuplicates &&
                            existing &&
                            existing.fingerprint ===
                                record.fingerprint
                        ) {
                            return {
                                duplicate:
                                    true,

                                webhook:
                                    existing
                            };
                        }

                        throw createWebhookConflictError(
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

                        webhook:
                            record
                    };
                }
            );

    logWebhookEvent(
        runtime,
        result.webhook,
        result.duplicate
            ? "duplicate"
            : "registered",
        settings
    );

    return {
        created:
            !result.duplicate,

        duplicate:
            Boolean(
                result.duplicate
            ),

        disabled:
            false,

        webhookId:
            record.id,

        webhook:
            sanitizeWebhookRecord(
                result.webhook
            )
    };
}

/* ==========================================================
   UPDATE
========================================================== */

async function updateWebhook(
    runtime,
    webhookId,
    changes,
    options
) {
    const settings =
        normalizeWebhookOptions(
            options
        );

    const id =
        normalizeWebhookId(
            webhookId
        );

    if (
        !changes ||
        typeof changes !==
            "object" ||
        Array.isArray(changes)
    ) {
        throw new TypeError(
            "Webhook changes must be an object."
        );
    }

    if (
        settings.disabled
    ) {
        return {
            updated:
                false,

            disabled:
                true,

            webhookId:
                id
        };
    }

    assertWebhookRuntime(
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

    const record =
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
                        throw createWebhookNotFoundError(
                            id
                        );
                    }

                    const existing =
                        snapshot.data();

                    const update =
                        normalizeWebhookUpdate(
                            existing,
                            changes,
                            settings,
                            runtime,
                            now
                        );

                    transaction.set(
                        reference,
                        update,
                        {
                            merge:
                                true
                        }
                    );

                    return Object.assign(
                        {},
                        existing,
                        update
                    );
                }
            );

    logWebhookEvent(
        runtime,
        record,
        "updated",
        settings
    );

    return {
        updated:
            true,

        disabled:
            false,

        webhookId:
            id,

        webhook:
            sanitizeWebhookRecord(
                record
            )
    };
}

function normalizeWebhookUpdate(
    existing,
    changes,
    options,
    runtime,
    now
) {
    const settings =
        options || {};

    const update = {
        updatedAt:
            createDatabaseTimestamp(
                runtime,
                now
            )
    };

    if (
        changes.url !==
        undefined
    ) {
        update.url =
            normalizeWebhookUrl(
                changes.url,
                settings
            );
    }

    if (
        changes.status !==
        undefined
    ) {
        update.status =
            normalizeWebhookStatus(
                changes.status
            );
    }

    if (
        changes.events !==
        undefined
    ) {
        update.events =
            normalizeWebhookEvents(
                changes.events
            );
    }

    if (
        changes.description !==
        undefined
    ) {
        update.description =
            normalizeOptionalString(
                changes.description
            );
    }

    if (
        changes.secret !==
        undefined
    ) {
        update.secret =
            normalizeWebhookSecret(
                changes.secret
            );

        update.secretHash =
            hashWebhookValue(
                update.secret
            );
    }

    if (
        changes.headers !==
        undefined
    ) {
        update.headers =
            sanitizeWebhookHeaders(
                changes.headers
            );
    }

    if (
        changes.metadata !==
        undefined
    ) {
        update.metadata =
            sanitizeWebhookMetadata(
                changes.metadata
            );
    }

    if (
        changes.timeoutMs !==
        undefined
    ) {
        update.timeoutMs =
            normalizePositiveInteger(
                changes.timeoutMs,
                settings.timeoutMs,
                "Webhook timeout"
            );
    }

    if (
        changes.maxAttempts !==
        undefined
    ) {
        update.maxAttempts =
            normalizePositiveInteger(
                changes.maxAttempts,
                settings.maxAttempts,
                "Maximum webhook attempts"
            );
    }

    const fingerprintSource =
        Object.assign(
            {},
            existing,
            update
        );

    update.fingerprint =
        createWebhookFingerprint({
            url:
                fingerprintSource.url,

            events:
                fingerprintSource.events,

            status:
                fingerprintSource.status
        });

    return update;
}

/* ==========================================================
   GET AND QUERY WEBHOOKS
========================================================== */

async function getWebhook(
    runtime,
    webhookId,
    options
) {
    const settings =
        normalizeWebhookOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return null;
    }

    assertWebhookRuntime(
        runtime
    );

    const id =
        normalizeWebhookId(
            webhookId
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

    return sanitizeWebhookRecord(
        snapshot.data()
    );
}

async function queryWebhooks(
    runtime,
    filters,
    options
) {
    const settings =
        normalizeWebhookOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return [];
    }

    assertWebhookRuntime(
        runtime
    );

    const normalized =
        normalizeWebhookQuery(
            filters,
            settings
        );

    let query =
        runtime.db
            .collection(
                settings.collection
            );

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
        normalized.event
    ) {
        query =
            query.where(
                "events",
                "array-contains",
                normalized.event
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
        function (
            document
        ) {
            return sanitizeWebhookRecord(
                document.data()
            );
        }
    );
}

function normalizeWebhookQuery(
    filters,
    options
) {
    const source =
        filters || {};

    const settings =
        options || {};

    return {
        status:
            source.status
                ? normalizeWebhookStatus(
                      source.status
                  )
                : null,

        event:
            source.event
                ? normalizeWebhookEvent(
                      source.event
                  )
                : null,

        orderBy:
            normalizeWebhookOrderField(
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
   QUEUE DELIVERY
========================================================== */

async function queueWebhookDelivery(
    runtime,
    webhookId,
    event,
    payload,
    options
) {
    const settings =
        normalizeWebhookOptions(
            options
        );

    const id =
        normalizeWebhookId(
            webhookId
        );

    const normalizedEvent =
        normalizeWebhookEvent(
            event
        );

    assertSerializableWebhookValue(
        payload,
        settings.maxPayloadBytes,
        "Webhook payload"
    );

    if (
        settings.disabled
    ) {
        return {
            queued:
                false,

            disabled:
                true,

            webhookId:
                id,

            delivery:
                null
        };
    }

    assertWebhookRuntime(
        runtime
    );

    const webhookSnapshot =
        await runtime.db
            .collection(
                settings.collection
            )
            .doc(
                id
            )
            .get();

    if (
        !webhookSnapshot.exists
    ) {
        throw createWebhookNotFoundError(
            id
        );
    }

    const webhook =
        webhookSnapshot.data();

    assertWebhookCanReceiveEvent(
        webhook,
        normalizedEvent
    );

    const record =
        normalizeWebhookDeliveryRecord(
            webhook,
            normalizedEvent,
            payload,
            settings,
            runtime
        );

    const reference =
        runtime.db
            .collection(
                settings.deliveryCollection
            )
            .doc(
                record.id
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

                                delivery:
                                    existing
                            };
                        }

                        throw createWebhookDeliveryConflictError(
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

                        delivery:
                            record
                    };
                }
            );

    logWebhookDeliveryEvent(
        runtime,
        result.delivery,
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

        webhookId:
            id,

        deliveryId:
            record.id,

        delivery:
            sanitizeWebhookDeliveryRecord(
                result.delivery
            )
    };
}

/* ==========================================================
   DELIVER
========================================================== */

async function deliverWebhook(
    runtime,
    deliveryId,
    options
) {
    const settings =
        normalizeWebhookOptions(
            options
        );

    const id =
        normalizeWebhookDeliveryId(
            deliveryId
        );

    if (
        settings.disabled
    ) {
        return {
            delivered:
                false,

            retryScheduled:
                false,

            disabled:
                true,

            deliveryId:
                id
        };
    }

    assertWebhookRuntime(
        runtime
    );

    const deliveryReference =
        runtime.db
            .collection(
                settings.deliveryCollection
            )
            .doc(
                id
            );

    const claim =
        await claimWebhookDelivery(
            runtime,
            deliveryReference,
            settings
        );

    if (
        !claim
    ) {
        return null;
    }

    const webhookSnapshot =
        await runtime.db
            .collection(
                settings.collection
            )
            .doc(
                claim.webhookId
            )
            .get();

    if (
        !webhookSnapshot.exists
    ) {
        return failClaimedWebhookDelivery(
            runtime,
            deliveryReference,
            claim,
            createWebhookNotFoundError(
                claim.webhookId
            ),
            settings
        );
    }

    const webhook =
        webhookSnapshot.data();

    let response;
    let deliveryError;

    try {
        response =
            await sendWebhookRequest(
                webhook,
                claim,
                settings,
                runtime
            );
    } catch (error) {
        deliveryError =
            error;
    }

    if (
        !deliveryError &&
        isSuccessfulHttpStatus(
            response.status
        )
    ) {
        return completeWebhookDelivery(
            runtime,
            deliveryReference,
            claim,
            response,
            settings
        );
    }

    const error =
        deliveryError ||
        createWebhookHttpError(
            response
        );

    return failClaimedWebhookDelivery(
        runtime,
        deliveryReference,
        claim,
        error,
        settings,
        response
    );
}

async function claimWebhookDelivery(
    runtime,
    reference,
    options
) {
    const settings =
        normalizeWebhookOptions(
            options
        );

    const now =
        resolveNow(
            runtime,
            settings
        );

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
                    !snapshot.exists
                ) {
                    throw createWebhookDeliveryNotFoundError(
                        reference.id
                    );
                }

                const existing =
                    snapshot.data();

                if (
                    !isWebhookDeliveryClaimable(
                        existing,
                        now
                    )
                ) {
                    return null;
                }

                const attempts =
                    normalizeNonNegativeInteger(
                        existing.attempts,
                        0,
                        "Webhook delivery attempts"
                    ) +
                    1;

                const update = {
                    status:
                        WEBHOOK_DELIVERY_STATUSES
                            .processing,

                    attempts:
                        attempts,

                    processingAt:
                        createDatabaseTimestamp(
                            runtime,
                            now
                        ),

                    updatedAt:
                        createDatabaseTimestamp(
                            runtime,
                            now
                        )
                };

                transaction.set(
                    reference,
                    update,
                    {
                        merge:
                            true
                    }
                );

                return Object.assign(
                    {},
                    existing,
                    update
                );
            }
        );
}

function isWebhookDeliveryClaimable(
    delivery,
    now
) {
    if (!delivery) {
        return false;
    }

    const status =
        normalizeWebhookDeliveryStatus(
            delivery.status
        );

    if (
        TERMINAL_DELIVERY_STATUSES
            .includes(
                status
            )
    ) {
        return false;
    }

    const scheduledAt =
        toMilliseconds(
            delivery.scheduledAt
        );

    if (
        scheduledAt &&
        scheduledAt >
        now
    ) {
        return false;
    }

    return (
        status ===
            WEBHOOK_DELIVERY_STATUSES.pending ||
        status ===
            WEBHOOK_DELIVERY_STATUSES.retrying
    );
}

/* ==========================================================
   SEND REQUEST
========================================================== */

async function sendWebhookRequest(
    webhook,
    delivery,
    options,
    runtime
) {
    const settings =
        normalizeWebhookOptions(
            options
        );

    const fetchImplementation =
        settings.fetch ||
        (
            runtime &&
            runtime.fetch
        ) ||
        globalThis.fetch;

    if (
        typeof fetchImplementation !==
        "function"
    ) {
        throw new ServiceError(
            "configuration-error",
            "A fetch implementation is required for webhook delivery.",
            {
                status:
                    500,

                expose:
                    false
            }
        );
    }

    const body =
        stableStringify({
            id:
                delivery.id,

            event:
                delivery.event,

            createdAt:
                serializeTimestamp(
                    delivery.createdAt
                ),

            data:
                cloneValue(
                    delivery.payload
                )
        });

    const timestamp =
        String(
            Math.floor(
                resolveNow(
                    runtime,
                    settings
                ) /
                1000
            )
        );

    const signature =
        createWebhookSignature(
            body,
            webhook.secret,
            {
                timestamp:
                    timestamp,

                algorithm:
                    settings.signingAlgorithm
            }
        );

    const headers =
        Object.assign(
            {
                "content-type":
                    "application/json",

                "user-agent":
                    settings.userAgent,

                [
                    settings.signatureHeader
                ]:
                    signature,

                [
                    settings.timestampHeader
                ]:
                    timestamp,

                [
                    settings.eventHeader
                ]:
                    delivery.event,

                [
                    settings.deliveryHeader
                ]:
                    delivery.id
            },
            sanitizeWebhookHeaders(
                webhook.headers
            )
        );

    const controller =
        typeof AbortController ===
        "function"
            ? new AbortController()
            : null;

    let timeoutHandle;

    if (
        controller &&
        settings.timeoutMs >
            0
    ) {
        timeoutHandle =
            setTimeout(
                function () {
                    controller.abort();
                },
                settings.timeoutMs
            );
    }

    let response;

    try {
        response =
            await fetchImplementation(
                webhook.url,
                {
                    method:
                        "POST",

                    headers:
                        headers,

                    body:
                        body,

                    signal:
                        controller
                            ? controller.signal
                            : undefined
                }
            );
    } finally {
        if (
            timeoutHandle
        ) {
            clearTimeout(
                timeoutHandle
            );
        }
    }

    const responseBody =
        await readWebhookResponseBody(
            response,
            settings.maxResponseBytes
        );

    return {
        status:
            Number(
                response.status
            ),

        statusText:
            response.statusText ||
            null,

        headers:
            normalizeResponseHeaders(
                response.headers
            ),

        body:
            responseBody
    };
}

/* ==========================================================
   COMPLETE DELIVERY
========================================================== */

async function completeWebhookDelivery(
    runtime,
    reference,
    claimed,
    response,
    options
) {
    const settings =
        normalizeWebhookOptions(
            options
        );

    const now =
        resolveNow(
            runtime,
            settings
        );

    const update = {
        status:
            WEBHOOK_DELIVERY_STATUSES
                .delivered,

        response:
            sanitizeWebhookResponse(
                response,
                settings
            ),

        lastError:
            null,

        deliveredAt:
            createDatabaseTimestamp(
                runtime,
                now
            ),

        updatedAt:
            createDatabaseTimestamp(
                runtime,
                now
            )
    };

    await reference.set(
        update,
        {
            merge:
                true
        }
    );

    const record =
        Object.assign(
            {},
            claimed,
            update
        );

    logWebhookDeliveryEvent(
        runtime,
        record,
        "delivered",
        settings
    );

    return {
        delivered:
            true,

        retryScheduled:
            false,

        disabled:
            false,

        deliveryId:
            claimed.id,

        delivery:
            sanitizeWebhookDeliveryRecord(
                record
            )
    };
}

/* ==========================================================
   FAIL DELIVERY
========================================================== */

async function failClaimedWebhookDelivery(
    runtime,
    reference,
    claimed,
    error,
    options,
    response
) {
    const settings =
        normalizeWebhookOptions(
            options
        );

    const now =
        resolveNow(
            runtime,
            settings
        );

    const attempts =
        normalizeNonNegativeInteger(
            claimed.attempts,
            0,
            "Webhook delivery attempts"
        );

    const maxAttempts =
        normalizePositiveInteger(
            claimed.maxAttempts,
            settings.maxAttempts,
            "Maximum webhook attempts"
        );

    const retryable =
        isRetryableWebhookError(
            error,
            response,
            settings
        );

    const retryScheduled =
        retryable &&
        attempts <
        maxAttempts;

    const retryDelayMs =
        retryScheduled
            ? resolveWebhookRetryDelay(
                  attempts,
                  error,
                  response,
                  settings
              )
            : 0;

    const update = {
        status:
            retryScheduled
                ? WEBHOOK_DELIVERY_STATUSES
                      .retrying
                : WEBHOOK_DELIVERY_STATUSES
                      .failed,

        response:
            response
                ? sanitizeWebhookResponse(
                      response,
                      settings
                  )
                : null,

        lastError:
            serializeWebhookError(
                error
            ),

        scheduledAt:
            retryScheduled
                ? createDatabaseTimestamp(
                      runtime,
                      now +
                      retryDelayMs
                  )
                : claimed.scheduledAt,

        failedAt:
            retryScheduled
                ? null
                : createDatabaseTimestamp(
                      runtime,
                      now
                  ),

        updatedAt:
            createDatabaseTimestamp(
                runtime,
                now
            )
    };

    await reference.set(
        update,
        {
            merge:
                true
        }
    );

    const record =
        Object.assign(
            {},
            claimed,
            update
        );

    logWebhookDeliveryEvent(
        runtime,
        record,
        retryScheduled
            ? "retry-scheduled"
            : "failed",
        settings
    );

    return {
        delivered:
            false,

        failed:
            !retryScheduled,

        retryScheduled:
            retryScheduled,

        retryDelayMs:
            retryDelayMs,

        disabled:
            false,

        deliveryId:
            claimed.id,

        delivery:
            sanitizeWebhookDeliveryRecord(
                record
            )
    };
}

/* ==========================================================
   CANCEL DELIVERY
========================================================== */

async function cancelWebhookDelivery(
    runtime,
    deliveryId,
    reason,
    options
) {
    const settings =
        normalizeWebhookOptions(
            options
        );

    const id =
        normalizeWebhookDeliveryId(
            deliveryId
        );

    if (
        settings.disabled
    ) {
        return {
            cancelled:
                false,

            disabled:
                true,

            deliveryId:
                id
        };
    }

    assertWebhookRuntime(
        runtime
    );

    const reference =
        runtime.db
            .collection(
                settings.deliveryCollection
            )
            .doc(
                id
            );

    const now =
        resolveNow(
            runtime,
            settings
        );

    const record =
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
                        throw createWebhookDeliveryNotFoundError(
                            id
                        );
                    }

                    const existing =
                        snapshot.data();

                    if (
                        TERMINAL_DELIVERY_STATUSES
                            .includes(
                                normalizeWebhookDeliveryStatus(
                                    existing.status
                                )
                            )
                    ) {
                        throw new ServiceError(
                            "failed-precondition",
                            "A terminal webhook delivery cannot be cancelled.",
                            {
                                status:
                                    409,

                                expose:
                                    true
                            }
                        );
                    }

                    const update = {
                        status:
                            WEBHOOK_DELIVERY_STATUSES
                                .cancelled,

                        cancellationReason:
                            normalizeOptionalString(
                                reason
                            ),

                        cancelledAt:
                            createDatabaseTimestamp(
                                runtime,
                                now
                            ),

                        updatedAt:
                            createDatabaseTimestamp(
                                runtime,
                                now
                            )
                    };

                    transaction.set(
                        reference,
                        update,
                        {
                            merge:
                                true
                        }
                    );

                    return Object.assign(
                        {},
                        existing,
                        update
                    );
                }
            );

    logWebhookDeliveryEvent(
        runtime,
        record,
        "cancelled",
        settings
    );

    return {
        cancelled:
            true,

        disabled:
            false,

        deliveryId:
            id,

        delivery:
            sanitizeWebhookDeliveryRecord(
                record
            )
    };
}

/* ==========================================================
   RECORD NORMALIZATION
========================================================== */

function normalizeWebhookRecord(
    webhook,
    options,
    runtime
) {
    const source =
        webhook || {};

    if (
        typeof source !==
            "object" ||
        Array.isArray(source)
    ) {
        throw new TypeError(
            "Webhook must be an object."
        );
    }

    const settings =
        normalizeWebhookOptions(
            options
        );

    const now =
        resolveNow(
            runtime,
            settings
        );

    const id =
        source.id
            ? normalizeWebhookId(
                  source.id
              )
            : createWebhookId(
                  source,
                  settings,
                  now
              );

    const url =
        normalizeWebhookUrl(
            source.url ||
            source.endpoint,
            settings
        );

    const events =
        normalizeWebhookEvents(
            source.events ||
            source.event
        );

    const secret =
        source.secret
            ? normalizeWebhookSecret(
                  source.secret
              )
            : generateWebhookSecret();

    return {
        id:
            id,

        fingerprint:
            createWebhookFingerprint({
                url:
                    url,

                events:
                    events,

                status:
                    WEBHOOK_STATUSES.active
            }),

        url:
            url,

        events:
            events,

        status:
            WEBHOOK_STATUSES.active,

        description:
            normalizeOptionalString(
                source.description
            ),

        secret:
            secret,

        secretHash:
            hashWebhookValue(
                secret
            ),

        headers:
            sanitizeWebhookHeaders(
                source.headers
            ),

        metadata:
            sanitizeWebhookMetadata(
                source.metadata
            ),

        timeoutMs:
            normalizePositiveInteger(
                source.timeoutMs,
                settings.timeoutMs,
                "Webhook timeout"
            ),

        maxAttempts:
            normalizePositiveInteger(
                source.maxAttempts,
                settings.maxAttempts,
                "Maximum webhook attempts"
            ),

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

        lastDeliveryAt:
            null,

        schemaVersion:
            1
    };
}

function normalizeWebhookDeliveryRecord(
    webhook,
    event,
    payload,
    options,
    runtime
) {
    const settings =
        normalizeWebhookOptions(
            options
        );

    const now =
        resolveNow(
            runtime,
            settings
        );

    const id =
        settings.deliveryId
            ? normalizeWebhookDeliveryId(
                  settings.deliveryId
              )
            : createWebhookDeliveryId(
                  webhook.id,
                  event,
                  payload,
                  settings,
                  now
              );

    const clonedPayload =
        cloneValue(
            payload
        );

    const fingerprint =
        createWebhookFingerprint({
            webhookId:
                webhook.id,

            event:
                event,

            payload:
                clonedPayload
        });

    return {
        id:
            id,

        fingerprint:
            fingerprint,

        webhookId:
            webhook.id,

        event:
            event,

        url:
            webhook.url,

        payload:
            clonedPayload,

        status:
            WEBHOOK_DELIVERY_STATUSES
                .pending,

        attempts:
            0,

        maxAttempts:
            normalizePositiveInteger(
                webhook.maxAttempts,
                settings.maxAttempts,
                "Maximum webhook attempts"
            ),

        response:
            null,

        lastError:
            null,

        cancellationReason:
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
                settings.scheduledAt !==
                null
                    ? settings.scheduledAt
                    : now
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
            settings.retentionMs
                ? createDatabaseTimestamp(
                      runtime,
                      now +
                      settings.retentionMs
                  )
                : null,

        schemaVersion:
            1
    };
}

/* ==========================================================
   EVENT VALIDATION
========================================================== */

function assertWebhookCanReceiveEvent(
    webhook,
    event
) {
    const status =
        normalizeWebhookStatus(
            webhook.status
        );

    if (
        status !==
        WEBHOOK_STATUSES.active
    ) {
        throw new ServiceError(
            "failed-precondition",
            "The webhook is not active.",
            {
                status:
                    409,

                expose:
                    true
            }
        );
    }

    const events =
        normalizeWebhookEvents(
            webhook.events
        );

    if (
        !events.includes("*") &&
        !events.includes(
            event
        )
    ) {
        throw new ServiceError(
            "failed-precondition",
            "The webhook does not subscribe to this event.",
            {
                status:
                    409,

                expose:
                    true,

                details: {
                    event:
                        event
                }
            }
        );
    }

    return true;
}

/* ==========================================================
   SIGNATURES
========================================================== */

function createWebhookSignature(
    payload,
    secret,
    options
) {
    const settings =
        options || {};

    const algorithm =
        normalizeSigningAlgorithm(
            settings.algorithm ||
            DEFAULT_SIGNING_ALGORITHM
        );

    const normalizedSecret =
        normalizeWebhookSecret(
            secret
        );

    const body =
        normalizeWebhookPayloadString(
            payload
        );

    const timestamp =
        normalizeOptionalString(
            settings.timestamp
        );

    const signedPayload =
        timestamp
            ? timestamp +
              "." +
              body
            : body;

    const digest =
        crypto
            .createHmac(
                algorithm,
                normalizedSecret
            )
            .update(
                signedPayload
            )
            .digest(
                "hex"
            );

    return (
        algorithm +
        "=" +
        digest
    );
}

function verifyWebhookSignature(
    payload,
    signature,
    secret,
    options
) {
    const settings =
        normalizeWebhookOptions(
            options
        );

    const parsed =
        parseWebhookSignature(
            signature
        );

    const algorithm =
        normalizeSigningAlgorithm(
            parsed.algorithm ||
            settings.signingAlgorithm
        );

    const timestamp =
        settings.timestamp !==
        undefined &&
        settings.timestamp !==
        null
            ? String(
                  settings.timestamp
              )
            : null;

    if (
        timestamp &&
        settings.signatureToleranceMs >
            0
    ) {
        const now =
            resolveNow(
                null,
                settings
            );

        const timestampMs =
            normalizeSignatureTimestamp(
                timestamp
            );

        if (
            Math.abs(
                now -
                timestampMs
            ) >
            settings.signatureToleranceMs
        ) {
            return false;
        }
    }

    const expected =
        createWebhookSignature(
            payload,
            secret,
            {
                algorithm:
                    algorithm,

                timestamp:
                    timestamp
            }
        );

    return timingSafeEqualStrings(
        expected,
        parsed.original
    );
}

function parseWebhookSignature(
    signature
) {
    const normalized =
        String(
            signature || ""
        ).trim();

    const separatorIndex =
        normalized.indexOf(
            "="
        );

    if (
        separatorIndex <=
        0
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The webhook signature is invalid.",
            {
                status:
                    400,

                expose:
                    true
            }
        );
    }

    const algorithm =
        normalized
            .slice(
                0,
                separatorIndex
            )
            .toLowerCase();

    const digest =
        normalized
            .slice(
                separatorIndex +
                1
            )
            .toLowerCase();

    if (
        !/^[a-f0-9]+$/
            .test(
                digest
            )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The webhook signature digest is invalid.",
            {
                status:
                    400,

                expose:
                    true
            }
        );
    }

    return {
        algorithm:
            algorithm,

        digest:
            digest,

        original:
            algorithm +
            "=" +
            digest
    };
}

function timingSafeEqualStrings(
    first,
    second
) {
    const firstBuffer =
        Buffer.from(
            String(first)
        );

    const secondBuffer =
        Buffer.from(
            String(second)
        );

    if (
        firstBuffer.length !==
        secondBuffer.length
    ) {
        return false;
    }

    return crypto
        .timingSafeEqual(
            firstBuffer,
            secondBuffer
        );
}

/* ==========================================================
   RETRY
========================================================== */

function isRetryableWebhookError(
    error,
    response,
    options
) {
    const settings =
        options || {};

    if (
        typeof settings.retryResolver ===
        "function"
    ) {
        return Boolean(
            settings.retryResolver(
                error,
                response
            )
        );
    }

    if (
        error &&
        error.retryable !==
        undefined
    ) {
        return Boolean(
            error.retryable
        );
    }

    const status =
        response &&
        Number(
            response.status
        );

    if (
        Number.isInteger(
            status
        )
    ) {
        return RETRYABLE_HTTP_STATUSES
            .includes(
                status
            );
    }

    return settings.retryFailed !==
        false;
}

function resolveWebhookRetryDelay(
    attempts,
    error,
    response,
    options
) {
    const settings =
        options || {};

    if (
        typeof settings
            .retryDelayResolver ===
        "function"
    ) {
        return normalizeNonNegativeInteger(
            settings.retryDelayResolver(
                attempts,
                error,
                response
            ),
            settings.retryDelayMs,
            "Webhook retry delay"
        );
    }

    const retryAfter =
        getRetryAfterMilliseconds(
            response
        );

    if (
        retryAfter !==
        null
    ) {
        return Math.min(
            retryAfter,
            settings.maxRetryDelayMs
        );
    }

    const exponent =
        Math.max(
            0,
            Number(attempts) -
            1
        );

    const delay =
        settings.retryDelayMs *
        Math.pow(
            settings.retryBackoffMultiplier,
            exponent
        );

    return Math.min(
        Math.round(
            delay
        ),
        settings.maxRetryDelayMs
    );
}

function getRetryAfterMilliseconds(
    response
) {
    if (
        !response ||
        !response.headers
    ) {
        return null;
    }

    const headers =
        response.headers;

    let value;

    if (
        typeof headers.get ===
        "function"
    ) {
        value =
            headers.get(
                "retry-after"
            );
    } else {
        value =
            headers[
                "retry-after"
            ] ||
            headers[
                "Retry-After"
            ];
    }

    if (
        value ===
            undefined ||
        value ===
            null ||
        value ===
            ""
    ) {
        return null;
    }

    const seconds =
        Number(value);

    if (
        Number.isFinite(
            seconds
        )
    ) {
        return Math.max(
            0,
            Math.round(
                seconds *
                1000
            )
        );
    }

    const parsed =
        Date.parse(
            value
        );

    if (
        Number.isNaN(
            parsed
        )
    ) {
        return null;
    }

    return Math.max(
        0,
        parsed -
        Date.now()
    );
}

/* ==========================================================
   RESPONSE HELPERS
========================================================== */

async function readWebhookResponseBody(
    response,
    maximumBytes
) {
    if (
        !response ||
        typeof response.text !==
            "function"
    ) {
        return null;
    }

    const body =
        await response.text();

    return truncateUtf8String(
        body,
        maximumBytes
    );
}

function normalizeResponseHeaders(
    headers
) {
    if (!headers) {
        return {};
    }

    const result =
        {};

    if (
        typeof headers.forEach ===
        "function"
    ) {
        headers.forEach(
            function (
                value,
                key
            ) {
                result[
                    String(key)
                        .toLowerCase()
                ] =
                    String(value);
            }
        );

        return result;
    }

    return Object.keys(
        headers
    ).reduce(
        function (
            output,
            key
        ) {
            output[
                key.toLowerCase()
            ] =
                String(
                    headers[key]
                );

            return output;
        },
        {}
    );
}

function sanitizeWebhookResponse(
    response,
    options
) {
    if (!response) {
        return null;
    }

    const settings =
        options || {};

    return {
        status:
            Number(
                response.status ||
                0
            ),

        statusText:
            normalizeOptionalString(
                response.statusText
            ),

        headers:
            sanitizeWebhookHeaders(
                response.headers
            ),

        body:
            truncateUtf8String(
                response.body ||
                "",
                settings.maxResponseBytes ||
                DEFAULT_MAX_RESPONSE_BYTES
            )
    };
}

function isSuccessfulHttpStatus(
    status
) {
    const normalized =
        Number(status);

    return (
        normalized >=
            200 &&
        normalized <
            300
    );
}

/* ==========================================================
   SANITIZATION
========================================================== */

function sanitizeWebhookRecord(
    record
) {
    if (!record) {
        return null;
    }

    return {
        id:
            record.id,

        fingerprint:
            record.fingerprint,

        url:
            record.url,

        events:
            normalizeWebhookEvents(
                record.events
            ),

        status:
            normalizeWebhookStatus(
                record.status
            ),

        description:
            record.description ||
            null,

        secretHash:
            record.secretHash ||
            null,

        headers:
            sanitizeWebhookHeaders(
                record.headers
            ),

        metadata:
            cloneValue(
                record.metadata
            ),

        timeoutMs:
            normalizePositiveInteger(
                record.timeoutMs,
                DEFAULT_TIMEOUT_MS,
                "Webhook timeout"
            ),

        maxAttempts:
            normalizePositiveInteger(
                record.maxAttempts,
                DEFAULT_MAX_ATTEMPTS,
                "Maximum webhook attempts"
            ),

        createdAt:
            serializeTimestamp(
                record.createdAt
            ),

        updatedAt:
            serializeTimestamp(
                record.updatedAt
            ),

        lastDeliveryAt:
            serializeTimestamp(
                record.lastDeliveryAt
            ),

        schemaVersion:
            Number(
                record.schemaVersion ||
                1
            )
    };
}

function sanitizeWebhookDeliveryRecord(
    record
) {
    if (!record) {
        return null;
    }

    return {
        id:
            record.id,

        fingerprint:
            record.fingerprint,

        webhookId:
            record.webhookId,

        event:
            normalizeWebhookEvent(
                record.event
            ),

        url:
            record.url,

        payload:
            cloneValue(
                record.payload
            ),

        status:
            normalizeWebhookDeliveryStatus(
                record.status
            ),

        attempts:
            normalizeNonNegativeInteger(
                record.attempts,
                0,
                "Webhook delivery attempts"
            ),

        maxAttempts:
            normalizePositiveInteger(
                record.maxAttempts,
                DEFAULT_MAX_ATTEMPTS,
                "Maximum webhook attempts"
            ),

        response:
            cloneValue(
                record.response
            ),

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

function sanitizeWebhookHeaders(
    value
) {
    if (
        !value ||
        typeof value !==
            "object" ||
        Array.isArray(value)
    ) {
        return {};
    }

    const blocked =
        new Set([
            "host",
            "content-length",
            "connection",
            "transfer-encoding"
        ]);

    return Object.keys(
        value
    ).reduce(
        function (
            output,
            key
        ) {
            const normalizedKey =
                String(key)
                    .trim()
                    .toLowerCase();

            if (
                !normalizedKey ||
                blocked.has(
                    normalizedKey
                )
            ) {
                return output;
            }

            const normalizedValue =
                normalizeOptionalString(
                    value[key]
                );

            if (
                normalizedValue !==
                null
            ) {
                output[
                    normalizedKey
                ] =
                    normalizedValue;
            }

            return output;
        },
        {}
    );
}

function sanitizeWebhookMetadata(
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
                cloneValue(
                    value
                )
        };
    }

    return cloneValue(
        value
    );
}

/* ==========================================================
   NORMALIZERS
========================================================== */

function normalizeWebhookId(
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
            "The webhook ID is invalid.",
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

function normalizeWebhookDeliveryId(
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
            "The webhook delivery ID is invalid.",
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

function normalizeWebhookUrl(
    value,
    options
) {
    const settings =
        options || {};

    let parsed;

    try {
        parsed =
            new URL(
                String(
                    value || ""
                )
            );
    } catch (error) {
        throw new ServiceError(
            "invalid-argument",
            "The webhook URL is invalid.",
            {
                status:
                    400,

                expose:
                    true
            }
        );
    }

    const allowedProtocols =
        settings.allowHttp
            ? [
                  "https:",
                  "http:"
              ]
            : [
                  "https:"
              ];

    if (
        !allowedProtocols.includes(
            parsed.protocol
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The webhook URL protocol is not allowed.",
            {
                status:
                    400,

                expose:
                    true
            }
        );
    }

    if (
        parsed.username ||
        parsed.password
    ) {
        throw new ServiceError(
            "invalid-argument",
            "Webhook URLs cannot contain credentials.",
            {
                status:
                    400,

                expose:
                    true
            }
        );
    }

    return parsed.toString();
}

function normalizeWebhookStatus(
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
            WEBHOOK_STATUSES
        ).includes(
            normalized
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The webhook status is invalid.",
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

function normalizeWebhookDeliveryStatus(
    value
) {
    const normalized =
        String(
            value ||
            DEFAULT_DELIVERY_STATUS
        )
            .trim()
            .toLowerCase();

    if (
        !Object.values(
            WEBHOOK_DELIVERY_STATUSES
        ).includes(
            normalized
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The webhook delivery status is invalid.",
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

function normalizeWebhookEvent(
    value
) {
    const normalized =
        String(
            value || ""
        )
            .trim()
            .toLowerCase()
            .replace(
                /[^a-z0-9.*_:-]/g,
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
            "The webhook event is invalid.",
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

function normalizeWebhookEvents(
    value
) {
    const values =
        Array.isArray(value)
            ? value
            : [
                  value
              ];

    const normalized =
        Array.from(
            new Set(
                values
                    .filter(
                        function (
                            item
                        ) {
                            return (
                                item !==
                                    undefined &&
                                item !==
                                    null &&
                                String(
                                    item
                                ).trim() !==
                                    ""
                            );
                        }
                    )
                    .map(
                        normalizeWebhookEvent
                    )
            )
        );

    if (
        normalized.length ===
        0
    ) {
        throw new ServiceError(
            "invalid-argument",
            "At least one webhook event is required.",
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

function normalizeWebhookSecret(
    value
) {
    const normalized =
        String(
            value || ""
        ).trim();

    if (
        normalized.length <
        16
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The webhook secret must contain at least 16 characters.",
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

function normalizeSigningAlgorithm(
    value
) {
    const normalized =
        String(
            value ||
            DEFAULT_SIGNING_ALGORITHM
        )
            .trim()
            .toLowerCase();

    const supported =
        new Set([
            "sha256",
            "sha384",
            "sha512"
        ]);

    if (
        !supported.has(
            normalized
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The webhook signing algorithm is unsupported.",
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

function normalizeWebhookPayloadString(
    value
) {
    if (
        typeof value ===
        "string"
    ) {
        return value;
    }

    if (
        Buffer.isBuffer(
            value
        )
    ) {
        return value.toString(
            "utf8"
        );
    }

    return stableStringify(
        value
    );
}

function normalizeSignatureTimestamp(
    value
) {
    const normalized =
        Number(value);

    if (
        !Number.isFinite(
            normalized
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The webhook signature timestamp is invalid.",
            {
                status:
                    400,

                expose:
                    true
            }
        );
    }

    return normalized <
        100000000000
        ? normalized *
          1000
        : normalized;
}

function normalizeWebhookOrderField(
    value
) {
    const allowed =
        new Set([
            "createdAt",
            "updatedAt",
            "lastDeliveryAt",
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
        normalized <=
            0
    ) {
        throw new TypeError(
            "Webhook query limit must be a positive integer."
        );
    }

    return Math.min(
        normalized,
        MAX_QUERY_LIMIT
    );
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
        normalized <=
            0
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
        normalized <
            0
    ) {
        throw new TypeError(
            label +
            " must be a non-negative integer."
        );
    }

    return normalized;
}

function normalizePositiveNumber(
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
        !Number.isFinite(
            normalized
        ) ||
        normalized <=
            0
    ) {
        throw new TypeError(
            label +
            " must be a positive number."
        );
    }

    return normalized;
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

function normalizeCollection(
    value,
    label
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
            (
                label ||
                "Webhook collection"
            ) +
            " must be a Firestore collection name."
        );
    }

    return collection;
}

/* ==========================================================
   OPTIONS
========================================================== */

function normalizeWebhookOptions(
    options
) {
    const settings =
        options || {};

    const retryDelayMs =
        normalizeNonNegativeInteger(
            settings.retryDelayMs,
            DEFAULT_RETRY_DELAY_MS,
            "Webhook retry delay"
        );

    return {
        runtime:
            settings.runtime,

        collection:
            normalizeCollection(
                settings.collection ||
                WEBHOOK_COLLECTION,
                "Webhook collection"
            ),

        deliveryCollection:
            normalizeCollection(
                settings.deliveryCollection ||
                WEBHOOK_DELIVERY_COLLECTION,
                "Webhook delivery collection"
            ),

        timeoutMs:
            normalizePositiveInteger(
                settings.timeoutMs,
                DEFAULT_TIMEOUT_MS,
                "Webhook timeout"
            ),

        maxAttempts:
            normalizePositiveInteger(
                settings.maxAttempts,
                DEFAULT_MAX_ATTEMPTS,
                "Maximum webhook attempts"
            ),

        retryDelayMs:
            retryDelayMs,

        maxRetryDelayMs:
            normalizePositiveInteger(
                settings.maxRetryDelayMs,
                DEFAULT_MAX_RETRY_DELAY_MS,
                "Maximum webhook retry delay"
            ),

        retryBackoffMultiplier:
            normalizePositiveNumber(
                settings.retryBackoffMultiplier,
                2,
                "Webhook retry backoff multiplier"
            ),

        retryFailed:
            settings.retryFailed !==
            false,

        retentionMs:
            normalizeNonNegativeInteger(
                settings.retentionMs,
                DEFAULT_RETENTION_MS,
                "Webhook retention"
            ),

        maxPayloadBytes:
            normalizePositiveInteger(
                settings.maxPayloadBytes,
                DEFAULT_MAX_PAYLOAD_BYTES,
                "Maximum webhook payload size"
            ),

        maxResponseBytes:
            normalizePositiveInteger(
                settings.maxResponseBytes,
                DEFAULT_MAX_RESPONSE_BYTES,
                "Maximum webhook response size"
            ),

        signatureToleranceMs:
            normalizeNonNegativeInteger(
                settings.signatureToleranceMs,
                DEFAULT_SIGNATURE_TOLERANCE_MS,
                "Webhook signature tolerance"
            ),

        signingAlgorithm:
            normalizeSigningAlgorithm(
                settings.signingAlgorithm ||
                DEFAULT_SIGNING_ALGORITHM
            ),

        signatureHeader:
            normalizeHeaderName(
                settings.signatureHeader ||
                DEFAULT_SIGNATURE_HEADER
            ),

        timestampHeader:
            normalizeHeaderName(
                settings.timestampHeader ||
                DEFAULT_TIMESTAMP_HEADER
            ),

        eventHeader:
            normalizeHeaderName(
                settings.eventHeader ||
                DEFAULT_EVENT_HEADER
            ),

        deliveryHeader:
            normalizeHeaderName(
                settings.deliveryHeader ||
                DEFAULT_DELIVERY_HEADER
            ),

        userAgent:
            normalizeOptionalString(
                settings.userAgent
            ) ||
            "LEternel-Webhook/1.0",

        queryLimit:
            normalizeQueryLimit(
                settings.queryLimit
            ),

        preventDuplicates:
            settings.preventDuplicates !==
            false,

        allowHttp:
            Boolean(
                settings.allowHttp
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

        fetch:
            settings.fetch,

        idResolver:
            settings.idResolver,

        deliveryIdResolver:
            settings.deliveryIdResolver,

        retryResolver:
            settings.retryResolver,

        retryDelayResolver:
            settings.retryDelayResolver,

        deliveryId:
            settings.deliveryId,

        scheduledAt:
            settings.scheduledAt !==
                undefined &&
            settings.scheduledAt !==
                null
                ? normalizeWebhookDate(
                      settings.scheduledAt,
                      "Webhook delivery schedule"
                  )
                : null,

        timestamp:
            settings.timestamp,

        requestId:
            settings.requestId,

        correlationId:
            settings.correlationId
    };
}

function normalizeHeaderName(
    value
) {
    const normalized =
        String(
            value || ""
        )
            .trim()
            .toLowerCase();

    if (
        !normalized ||
        !/^[a-z0-9-]+$/
            .test(
                normalized
            )
    ) {
        throw new TypeError(
            "Webhook header name is invalid."
        );
    }

    return normalized;
}

function normalizeWebhookDate(
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
        milliseconds <
            0
    ) {
        throw new TypeError(
            label +
            " is invalid."
        );
    }

    return milliseconds;
}

/* ==========================================================
   IDENTIFIERS
========================================================== */

function createWebhookId(
    webhook,
    options,
    now
) {
    const settings =
        options || {};

    if (
        typeof settings.idResolver ===
        "function"
    ) {
        return normalizeWebhookId(
            settings.idResolver(
                webhook
            )
        );
    }

    if (
        webhook &&
        webhook.idempotencyKey
    ) {
        return hashWebhookValue(
            webhook.idempotencyKey
        );
    }

    return createRandomIdentifier(
        now
    );
}

function createWebhookDeliveryId(
    webhookId,
    event,
    payload,
    options,
    now
) {
    const settings =
        options || {};

    if (
        typeof settings.deliveryIdResolver ===
        "function"
    ) {
        return normalizeWebhookDeliveryId(
            settings.deliveryIdResolver(
                webhookId,
                event,
                payload
            )
        );
    }

    if (
        settings.idempotencyKey
    ) {
        return hashWebhookValue(
            [
                webhookId,
                event,
                settings.idempotencyKey
            ].join(":")
        );
    }

    return createRandomIdentifier(
        now
    );
}

function createRandomIdentifier(
    now
) {
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

function generateWebhookSecret() {
    return crypto
        .randomBytes(32)
        .toString("hex");
}

function createWebhookFingerprint(
    value
) {
    return hashWebhookValue(
        stableStringify(
            value
        )
    );
}

function hashWebhookValue(
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
        value ===
        undefined
    ) {
        return null;
    }

    if (
        value ===
            null ||
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
        value instanceof
        Date
    ) {
        return value.toISOString();
    }

    if (
        Buffer.isBuffer(
            value
        )
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
        return String(
            value
        );
    }

    if (
        currentState.seen.has(
            value
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "Webhook data contains a circular reference.",
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
        Array.isArray(
            value
        )
    ) {
        result =
            value.map(
                function (
                    item
                ) {
                    return normalizeStableValue(
                        item,
                        currentState
                    );
                }
            );
    } else {
        result =
            Object.keys(
                value
            )
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

function assertSerializableWebhookValue(
    value,
    maximumBytes,
    label
) {
    const serialized =
        stableStringify(
            value
        );

    const bytes =
        Buffer.byteLength(
            serialized,
            "utf8"
        );

    if (
        bytes >
        maximumBytes
    ) {
        throw new ServiceError(
            "resource-exhausted",
            label +
            " is too large.",
            {
                status:
                    413,

                expose:
                    true,

                details: {
                    bytes:
                        bytes,

                    maximumBytes:
                        maximumBytes
                }
            }
        );
    }

    return true;
}

/* ==========================================================
   ERRORS
========================================================== */

function createWebhookHttpError(
    response
) {
    const status =
        Number(
            response &&
            response.status
        ) ||
        500;

    const error =
        new ServiceError(
            "webhook-http-error",
            "The webhook endpoint returned an unsuccessful response.",
            {
                status:
                    status,

                expose:
                    false,

                retryable:
                    RETRYABLE_HTTP_STATUSES
                        .includes(
                            status
                        ),

                details: {
                    status:
                        status,

                    statusText:
                        response &&
                        response.statusText
                }
            }
        );

    return error;
}

function serializeWebhookError(
    error
) {
    if (!error) {
        return null;
    }

    return {
        name:
            error.name ||
            "Error",

        code:
            error.code ||
            "webhook-delivery-failed",

        message:
            error.publicMessage ||
            error.message ||
            "Webhook delivery failed.",

        status:
            Number(
                error.status ||
                error.statusCode ||
                500
            ),

        retryable:
            error.retryable !==
            undefined
                ? Boolean(
                      error.retryable
                  )
                : true
    };
}

function createWebhookNotFoundError(
    webhookId
) {
    return new ServiceError(
        "not-found",
        "The webhook was not found.",
        {
            status:
                404,

            expose:
                true,

            details: {
                webhookId:
                    webhookId
            }
        }
    );
}

function createWebhookDeliveryNotFoundError(
    deliveryId
) {
    return new ServiceError(
        "not-found",
        "The webhook delivery was not found.",
        {
            status:
                404,

            expose:
                true,

            details: {
                deliveryId:
                    deliveryId
            }
        }
    );
}

function createWebhookConflictError(
    webhookId,
    options
) {
    const settings =
        options || {};

    return new ServiceError(
        "already-exists",
        "A webhook with this ID already exists.",
        {
            status:
                409,

            expose:
                true,

            details: {
                webhookId:
                    webhookId
            },

            requestId:
                settings.requestId,

            correlationId:
                settings.correlationId
        }
    );
}

function createWebhookDeliveryConflictError(
    deliveryId,
    options
) {
    const settings =
        options || {};

    return new ServiceError(
        "already-exists",
        "A webhook delivery with this ID already exists.",
        {
            status:
                409,

            expose:
                true,

            details: {
                deliveryId:
                    deliveryId
            },

            requestId:
                settings.requestId,

            correlationId:
                settings.correlationId
        }
    );
}

/* ==========================================================
   RUNTIME AND TIME
========================================================== */

function assertWebhookRuntime(
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
            "The webhook datastore is unavailable.",
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
            "Firestore transactions are required for webhooks.",
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
        value ===
            undefined ||
        value ===
            null
    ) {
        return 0;
    }

    if (
        value instanceof
        Date
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
            Date.parse(
                value
            );

        return Number.isNaN(
            parsed
        )
            ? Number.NaN
            : parsed;
    }

    const normalized =
        Number(
            value
        );

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
    milliseconds >
        0
        ? new Date(
              milliseconds
          ).toISOString()
        : null;
}

/* ==========================================================
   DATA
========================================================== */

function truncateUtf8String(
    value,
    maximumBytes
) {
    const text =
        String(
            value || ""
        );

    if (
        Buffer.byteLength(
            text,
            "utf8"
        ) <=
        maximumBytes
    ) {
        return text;
    }

    const suffix =
        "[TRUNCATED]";

    let output =
        text;

    while (
        output.length >
            0 &&
        Buffer.byteLength(
            output +
            suffix,
            "utf8"
        ) >
            maximumBytes
    ) {
        output =
            output.slice(
                0,
                -1
            );
    }

    return (
        output +
        suffix
    );
}

function cloneValue(
    value
) {
    if (
        value ===
            null ||
        value ===
            undefined
    ) {
        return value;
    }

    if (
        value instanceof
        Date
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

        return Object.keys(
            value
        ).reduce(
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

function logWebhookEvent(
    runtime,
    webhook,
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

        webhookId:
            webhook &&
            webhook.id,

        url:
            webhook &&
            webhook.url,

        status:
            webhook &&
            webhook.status
    };

    if (
        typeof runtime.logger.info ===
        "function"
    ) {
        runtime.logger.info(
            "Webhook event.",
            metadata
        );
    } else if (
        typeof runtime.logger.debug ===
        "function"
    ) {
        runtime.logger.debug(
            "Webhook event.",
            metadata
        );
    }
}

function logWebhookDeliveryEvent(
    runtime,
    delivery,
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

        deliveryId:
            delivery &&
            delivery.id,

        webhookId:
            delivery &&
            delivery.webhookId,

        webhookEvent:
            delivery &&
            delivery.event,

        status:
            delivery &&
            delivery.status,

        attempts:
            delivery &&
            delivery.attempts
    };

    if (
        event ===
            "failed" &&
        typeof runtime.logger.error ===
            "function"
    ) {
        runtime.logger.error(
            "Webhook delivery failed.",
            metadata
        );

        return;
    }

    if (
        event ===
            "retry-scheduled" &&
        typeof runtime.logger.warn ===
            "function"
    ) {
        runtime.logger.warn(
            "Webhook retry scheduled.",
            metadata
        );

        return;
    }

    if (
        typeof runtime.logger.info ===
        "function"
    ) {
        runtime.logger.info(
            "Webhook delivery event.",
            metadata
        );
    } else if (
        typeof runtime.logger.debug ===
        "function"
    ) {
        runtime.logger.debug(
            "Webhook delivery event.",
            metadata
        );
    }
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
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
    constants: {
        WEBHOOK_COLLECTION,
        WEBHOOK_DELIVERY_COLLECTION,
        DEFAULT_STATUS,
        DEFAULT_DELIVERY_STATUS,
        DEFAULT_SIGNING_ALGORITHM,
        DEFAULT_SIGNATURE_HEADER,
        DEFAULT_TIMESTAMP_HEADER,
        DEFAULT_EVENT_HEADER,
        DEFAULT_DELIVERY_HEADER,
        DEFAULT_TIMEOUT_MS,
        DEFAULT_MAX_ATTEMPTS,
        DEFAULT_RETRY_DELAY_MS,
        DEFAULT_MAX_RETRY_DELAY_MS,
        DEFAULT_QUERY_LIMIT,
        MAX_QUERY_LIMIT,
        DEFAULT_RETENTION_MS,
        DEFAULT_MAX_PAYLOAD_BYTES,
        DEFAULT_MAX_RESPONSE_BYTES,
        DEFAULT_SIGNATURE_TOLERANCE_MS,
        WEBHOOK_STATUSES,
        WEBHOOK_DELIVERY_STATUSES,
        TERMINAL_DELIVERY_STATUSES,
        RETRYABLE_HTTP_STATUSES
    }
};