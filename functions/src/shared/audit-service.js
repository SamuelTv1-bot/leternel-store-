"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   AUDIT SERVICE

   Responsibilities:
   - Record security and business audit events
   - Capture actors, resources, actions, and outcomes
   - Sanitize sensitive metadata
   - Support HTTP and callable request context
   - Provide deterministic event structure
   - Read and query audit records
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

const AUDIT_COLLECTION =
    "_auditLogs";

const DEFAULT_SERVICE =
    "leternel-store";

const DEFAULT_EVENT_TYPE =
    "application.event";

const DEFAULT_OUTCOME =
    "success";

const DEFAULT_MAX_METADATA_DEPTH =
    8;

const DEFAULT_MAX_STRING_LENGTH =
    5000;

const DEFAULT_MAX_ARRAY_LENGTH =
    100;

const DEFAULT_QUERY_LIMIT =
    100;

const MAX_QUERY_LIMIT =
    500;

const AUDIT_OUTCOMES =
    Object.freeze({
        success:
            "success",

        failure:
            "failure",

        denied:
            "denied",

        unknown:
            "unknown"
    });

const AUDIT_SEVERITIES =
    Object.freeze({
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
    });

const SENSITIVE_KEYS =
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
        "refreshtoken",
        "refresh_token",
        "refresh-token",
        "idtoken",
        "id_token",
        "id-token",
        "apikey",
        "api_key",
        "api-key",
        "privatekey",
        "private_key",
        "private-key",
        "clientsecret",
        "client_secret",
        "client-secret",
        "cardnumber",
        "card_number",
        "card-number",
        "cvv",
        "cvc"
    ]);

/* ==========================================================
   SERVICE FACTORY
========================================================== */

function createAuditService(
    options
) {
    const settings =
        normalizeAuditOptions(
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

        record:
            function (
                event,
                overrides
            ) {
                return recordAuditEvent(
                    runtime,
                    event,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        success:
            function (
                event,
                overrides
            ) {
                return recordAuditEvent(
                    runtime,
                    Object.assign(
                        {},
                        event || {},
                        {
                            outcome:
                                AUDIT_OUTCOMES
                                    .success
                        }
                    ),
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        failure:
            function (
                event,
                overrides
            ) {
                return recordAuditEvent(
                    runtime,
                    Object.assign(
                        {},
                        event || {},
                        {
                            outcome:
                                AUDIT_OUTCOMES
                                    .failure
                        }
                    ),
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        denied:
            function (
                event,
                overrides
            ) {
                return recordAuditEvent(
                    runtime,
                    Object.assign(
                        {},
                        event || {},
                        {
                            outcome:
                                AUDIT_OUTCOMES
                                    .denied
                        }
                    ),
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        get:
            function (
                eventId,
                overrides
            ) {
                return getAuditEvent(
                    runtime,
                    eventId,
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
                return queryAuditEvents(
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
   RECORD EVENT
========================================================== */

async function recordAuditEvent(
    runtime,
    event,
    options
) {
    const settings =
        normalizeAuditOptions(
            options
        );

    const normalizedEvent =
        normalizeAuditEvent(
            event,
            settings,
            runtime
        );

    if (
        settings.disabled
    ) {
        return {
            recorded:
                false,

            disabled:
                true,

            event:
                sanitizeAuditRecord(
                    normalizedEvent
                )
        };
    }

    assertAuditRuntime(
        runtime
    );

    const reference =
        runtime.db
            .collection(
                settings.collection
            )
            .doc(
                normalizedEvent.id
            );

    await reference.set(
        normalizedEvent,
        {
            merge:
                false
        }
    );

    logAuditEvent(
        runtime,
        normalizedEvent,
        settings
    );

    return {
        recorded:
            true,

        disabled:
            false,

        eventId:
            normalizedEvent.id,

        event:
            sanitizeAuditRecord(
                normalizedEvent
            )
    };
}

/* ==========================================================
   EVENT NORMALIZATION
========================================================== */

function normalizeAuditEvent(
    event,
    options,
    runtime
) {
    const source =
        event || {};

    if (
        typeof source !==
        "object" ||
        Array.isArray(source)
    ) {
        throw new TypeError(
            "Audit event must be an object."
        );
    }

    const settings =
        normalizeAuditOptions(
            options
        );

    const now =
        resolveNow(
            runtime,
            settings
        );

    const actor =
        normalizeAuditActor(
            source.actor ||
            resolveAuditActor(
                source.request ||
                source.context ||
                source.input
            )
        );

    const request =
        normalizeAuditRequest(
            source.request ||
            source.context ||
            source.input
        );

    const resource =
        normalizeAuditResource(
            source.resource
        );

    const error =
        source.error
            ? serializeAuditError(
                  source.error
              )
            : null;

    const outcome =
        normalizeAuditOutcome(
            source.outcome ||
            (
                error
                    ? AUDIT_OUTCOMES
                          .failure
                    : settings
                          .defaultOutcome
            )
        );

    const severity =
        normalizeAuditSeverity(
            source.severity ||
            inferAuditSeverity(
                outcome,
                error
            )
        );

    const eventType =
        normalizeEventType(
            source.type ||
            source.eventType ||
            settings.eventType
        );

    const action =
        normalizeAuditAction(
            source.action ||
            eventType
        );

    const eventId =
        source.id
            ? normalizeAuditId(
                  source.id
              )
            : generateAuditId(
                  now
              );

    const metadata =
        sanitizeAuditMetadata(
            source.metadata ||
            source.details ||
            {},
            settings
        );

    return {
        id:
            eventId,

        type:
            eventType,

        action:
            action,

        service:
            normalizeServiceName(
                source.service ||
                settings.service
            ),

        category:
            normalizeOptionalString(
                source.category
            ),

        description:
            normalizeOptionalString(
                source.description ||
                source.message,
                settings.maxStringLength
            ),

        outcome:
            outcome,

        severity:
            severity,

        actor:
            actor,

        resource:
            resource,

        request:
            request,

        error:
            error,

        metadata:
            metadata,

        tags:
            normalizeAuditTags(
                source.tags
            ),

        occurredAt:
            createDatabaseTimestamp(
                runtime,
                source.occurredAt !==
                undefined
                    ? toMilliseconds(
                          source.occurredAt
                      )
                    : now
            ),

        recordedAt:
            createDatabaseTimestamp(
                runtime,
                now
            ),

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
   ACTOR
========================================================== */

function resolveAuditActor(
    input
) {
    if (!input) {
        return {};
    }

    const context =
        input.requestContext ||
        input.context ||
        input;

    const auth =
        input.auth ||
        context.auth ||
        {};

    const user =
        input.user ||
        context.user ||
        {};

    return {
        id:
            context.userId ||
            auth.uid ||
            user.uid ||
            null,

        type:
            context.userId ||
            auth.uid ||
            user.uid
                ? "user"
                : "anonymous",

        email:
            context.email ||
            (
                auth.token &&
                auth.token.email
            ) ||
            user.email ||
            null,

        role:
            context.role ||
            (
                auth.token &&
                auth.token.role
            ) ||
            user.role ||
            null,

        ip:
            resolveRequestIp(
                input
            ),

        userAgent:
            resolveRequestHeader(
                input,
                "user-agent"
            )
    };
}

function normalizeAuditActor(
    actor
) {
    const source =
        actor || {};

    return {
        id:
            normalizeOptionalString(
                source.id ||
                source.uid ||
                source.userId
            ),

        type:
            normalizeOptionalString(
                source.type
            ) ||
            (
                source.id ||
                source.uid ||
                source.userId
                    ? "user"
                    : "anonymous"
            ),

        email:
            normalizeOptionalString(
                source.email
            ),

        role:
            normalizeOptionalString(
                source.role
            ),

        ip:
            normalizeOptionalString(
                source.ip
            ),

        userAgent:
            normalizeOptionalString(
                source.userAgent
            )
    };
}

/* ==========================================================
   RESOURCE
========================================================== */

function normalizeAuditResource(
    resource
) {
    const source =
        resource || {};

    if (
        typeof source ===
        "string"
    ) {
        return {
            type:
                null,

            id:
                source,

            path:
                null,

            ownerId:
                null
        };
    }

    return {
        type:
            normalizeOptionalString(
                source.type ||
                source.collection
            ),

        id:
            normalizeOptionalString(
                source.id ||
                source.resourceId
            ),

        path:
            normalizeOptionalString(
                source.path
            ),

        ownerId:
            normalizeOptionalString(
                source.ownerId
            )
    };
}

/* ==========================================================
   REQUEST
========================================================== */

function normalizeAuditRequest(
    input
) {
    if (!input) {
        return {
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
        };
    }

    const request =
        input.rawRequest ||
        input.request ||
        input;

    const context =
        input.requestContext ||
        input.context ||
        request.requestContext ||
        request.context ||
        {};

    return {
        requestId:
            normalizeOptionalString(
                context.requestId ||
                request.requestId
            ),

        correlationId:
            normalizeOptionalString(
                context.correlationId ||
                request.correlationId
            ),

        method:
            normalizeOptionalString(
                request.method
            ),

        path:
            normalizeOptionalString(
                request.originalUrl ||
                request.path ||
                request.url
            ),

        ip:
            normalizeOptionalString(
                resolveRequestIp(
                    request
                )
            ),

        userAgent:
            normalizeOptionalString(
                resolveRequestHeader(
                    request,
                    "user-agent"
                )
            )
    };
}

/* ==========================================================
   READ EVENT
========================================================== */

async function getAuditEvent(
    runtime,
    eventId,
    options
) {
    const settings =
        normalizeAuditOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return null;
    }

    assertAuditRuntime(
        runtime
    );

    const normalizedId =
        normalizeAuditId(
            eventId
        );

    const snapshot =
        await runtime.db
            .collection(
                settings.collection
            )
            .doc(
                normalizedId
            )
            .get();

    if (!snapshot.exists) {
        return null;
    }

    return sanitizeAuditRecord(
        snapshot.data()
    );
}

/* ==========================================================
   QUERY EVENTS
========================================================== */

async function queryAuditEvents(
    runtime,
    filters,
    options
) {
    const settings =
        normalizeAuditOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return [];
    }

    assertAuditRuntime(
        runtime
    );

    const queryFilters =
        normalizeAuditQuery(
            filters,
            settings
        );

    let query =
        runtime.db
            .collection(
                settings.collection
            );

    if (
        queryFilters.type
    ) {
        query =
            query.where(
                "type",
                "==",
                queryFilters.type
            );
    }

    if (
        queryFilters.action
    ) {
        query =
            query.where(
                "action",
                "==",
                queryFilters.action
            );
    }

    if (
        queryFilters.outcome
    ) {
        query =
            query.where(
                "outcome",
                "==",
                queryFilters.outcome
            );
    }

    if (
        queryFilters.severity
    ) {
        query =
            query.where(
                "severity",
                "==",
                queryFilters.severity
            );
    }

    if (
        queryFilters.actorId
    ) {
        query =
            query.where(
                "actor.id",
                "==",
                queryFilters.actorId
            );
    }

    if (
        queryFilters.resourceId
    ) {
        query =
            query.where(
                "resource.id",
                "==",
                queryFilters.resourceId
            );
    }

    if (
        queryFilters.requestId
    ) {
        query =
            query.where(
                "request.requestId",
                "==",
                queryFilters.requestId
            );
    }

    if (
        queryFilters.from
    ) {
        query =
            query.where(
                "occurredAt",
                ">=",
                createDatabaseTimestamp(
                    runtime,
                    queryFilters.from
                )
            );
    }

    if (
        queryFilters.to
    ) {
        query =
            query.where(
                "occurredAt",
                "<=",
                createDatabaseTimestamp(
                    runtime,
                    queryFilters.to
                )
            );
    }

    if (
        typeof query.orderBy ===
        "function"
    ) {
        query =
            query.orderBy(
                "occurredAt",
                queryFilters.direction
            );
    }

    if (
        typeof query.limit ===
        "function"
    ) {
        query =
            query.limit(
                queryFilters.limit
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
            return sanitizeAuditRecord(
                document.data()
            );
        }
    );
}

/* ==========================================================
   QUERY NORMALIZATION
========================================================== */

function normalizeAuditQuery(
    filters,
    options
) {
    const source =
        filters || {};

    const settings =
        options || {};

    const limit =
        normalizeQueryLimit(
            source.limit ||
            settings.queryLimit
        );

    const direction =
        String(
            source.direction ||
            "desc"
        ).toLowerCase() ===
        "asc"
            ? "asc"
            : "desc";

    return {
        type:
            source.type
                ? normalizeEventType(
                      source.type
                  )
                : null,

        action:
            source.action
                ? normalizeAuditAction(
                      source.action
                  )
                : null,

        outcome:
            source.outcome
                ? normalizeAuditOutcome(
                      source.outcome
                  )
                : null,

        severity:
            source.severity
                ? normalizeAuditSeverity(
                      source.severity
                  )
                : null,

        actorId:
            normalizeOptionalString(
                source.actorId
            ),

        resourceId:
            normalizeOptionalString(
                source.resourceId
            ),

        requestId:
            normalizeOptionalString(
                source.requestId
            ),

        from:
            source.from !==
            undefined
                ? normalizeDateFilter(
                      source.from,
                      "Audit query start date"
                  )
                : null,

        to:
            source.to !==
            undefined
                ? normalizeDateFilter(
                      source.to,
                      "Audit query end date"
                  )
                : null,

        limit:
            limit,

        direction:
            direction
    };
}

/* ==========================================================
   ERROR SERIALIZATION
========================================================== */

function serializeAuditError(
    error
) {
    if (!error) {
        return null;
    }

    return {
        name:
            normalizeOptionalString(
                error.name
            ) ||
            "Error",

        code:
            normalizeOptionalString(
                error.code
            ) ||
            "internal",

        message:
            normalizeOptionalString(
                error.publicMessage ||
                error.message
            ) ||
            "Operation failed.",

        status:
            normalizeOptionalNumber(
                error.status ||
                error.statusCode
            ),

        retryable:
            Boolean(
                error.retryable
            )
    };
}

/* ==========================================================
   RECORD SANITIZATION
========================================================== */

function sanitizeAuditRecord(
    record
) {
    if (!record) {
        return null;
    }

    return {
        id:
            record.id,

        type:
            record.type,

        action:
            record.action,

        service:
            record.service,

        category:
            record.category ||
            null,

        description:
            record.description ||
            null,

        outcome:
            normalizeAuditOutcome(
                record.outcome
            ),

        severity:
            normalizeAuditSeverity(
                record.severity
            ),

        actor:
            cloneValue(
                record.actor
            ),

        resource:
            cloneValue(
                record.resource
            ),

        request:
            cloneValue(
                record.request
            ),

        error:
            cloneValue(
                record.error
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

        occurredAt:
            serializeTimestamp(
                record.occurredAt
            ),

        recordedAt:
            serializeTimestamp(
                record.recordedAt
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

/* ==========================================================
   METADATA SANITIZATION
========================================================== */

function sanitizeAuditMetadata(
    value,
    options,
    state
) {
    const settings =
        options ||
        {};

    const currentState =
        state || {
            depth:
                0,

            seen:
                new WeakSet()
        };

    if (
        currentState.depth >
        (
            settings.maxMetadataDepth ||
            DEFAULT_MAX_METADATA_DEPTH
        )
    ) {
        return "[Maximum depth reached]";
    }

    if (
        value === null ||
        value === undefined
    ) {
        return value ===
        undefined
            ? null
            : value;
    }

    if (
        typeof value ===
        "string"
    ) {
        return truncateString(
            value,
            settings.maxStringLength ||
            DEFAULT_MAX_STRING_LENGTH
        );
    }

    if (
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
        return (
            "[Buffer " +
            value.length +
            " bytes]"
        );
    }

    if (
        value instanceof Error
    ) {
        return serializeAuditError(
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
        return truncateString(
            String(value),
            settings.maxStringLength ||
            DEFAULT_MAX_STRING_LENGTH
        );
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
        depth:
            currentState.depth +
            1,

        seen:
            currentState.seen
    };

    if (
        Array.isArray(value)
    ) {
        const maximum =
            settings.maxArrayLength ||
            DEFAULT_MAX_ARRAY_LENGTH;

        const result =
            value
                .slice(
                    0,
                    maximum
                )
                .map(
                    function (item) {
                        return sanitizeAuditMetadata(
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

    const output =
        {};

    Object.keys(value)
        .sort()
        .forEach(
            function (key) {
                if (
                    isSensitiveAuditKey(
                        key
                    )
                ) {
                    output[key] =
                        "[REDACTED]";

                    return;
                }

                output[key] =
                    sanitizeAuditMetadata(
                        value[key],
                        settings,
                        nextState
                    );
            }
        );

    currentState.seen.delete(
        value
    );

    return output;
}

function isSensitiveAuditKey(
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

    return SENSITIVE_KEYS.some(
        function (sensitiveKey) {
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

function normalizeAuditOutcome(
    value
) {
    const normalized =
        String(
            value ||
            DEFAULT_OUTCOME
        )
            .trim()
            .toLowerCase();

    return Object.values(
        AUDIT_OUTCOMES
    ).includes(
        normalized
    )
        ? normalized
        : AUDIT_OUTCOMES
              .unknown;
}

function normalizeAuditSeverity(
    value
) {
    const normalized =
        String(
            value ||
            AUDIT_SEVERITIES.info
        )
            .trim()
            .toLowerCase();

    return Object.values(
        AUDIT_SEVERITIES
    ).includes(
        normalized
    )
        ? normalized
        : AUDIT_SEVERITIES
              .info;
}

function inferAuditSeverity(
    outcome,
    error
) {
    if (
        outcome ===
        AUDIT_OUTCOMES.denied
    ) {
        return AUDIT_SEVERITIES
            .warning;
    }

    if (
        outcome ===
        AUDIT_OUTCOMES.failure
    ) {
        if (
            error &&
            Number(
                error.status
            ) >= 500
        ) {
            return AUDIT_SEVERITIES
                .error;
        }

        return AUDIT_SEVERITIES
            .warning;
    }

    return AUDIT_SEVERITIES
        .info;
}

function normalizeEventType(
    value
) {
    const normalized =
        String(
            value ||
            DEFAULT_EVENT_TYPE
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

    return normalized ||
        DEFAULT_EVENT_TYPE;
}

function normalizeAuditAction(
    value
) {
    return normalizeEventType(
        value
    );
}

function normalizeServiceName(
    value
) {
    const normalized =
        String(
            value ||
            DEFAULT_SERVICE
        ).trim();

    return normalized ||
        DEFAULT_SERVICE;
}

function normalizeAuditId(
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
            "The audit event ID is invalid.",
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

function normalizeAuditTags(
    value
) {
    if (
        value === undefined ||
        value === null
    ) {
        return [];
    }

    const values =
        Array.isArray(value)
            ? value
            : [
                  value
              ];

    return Array.from(
        new Set(
            values
                .map(
                    function (item) {
                        return String(
                            item || ""
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

function normalizeOptionalString(
    value,
    maximumLength
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

    if (!normalized) {
        return null;
    }

    return truncateString(
        normalized,
        maximumLength ||
        DEFAULT_MAX_STRING_LENGTH
    );
}

function normalizeOptionalNumber(
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
            "Audit query limit must be a positive integer."
        );
    }

    return Math.min(
        normalized,
        MAX_QUERY_LIMIT
    );
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

    return (
        text.slice(
            0,
            Math.max(
                0,
                maximumLength -
                15
            )
        ) +
        "[TRUNCATED]"
    );
}

/* ==========================================================
   OPTIONS
========================================================== */

function normalizeAuditOptions(
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
                AUDIT_COLLECTION
            ),

        service:
            normalizeServiceName(
                settings.service ||
                DEFAULT_SERVICE
            ),

        eventType:
            normalizeEventType(
                settings.eventType ||
                DEFAULT_EVENT_TYPE
            ),

        defaultOutcome:
            normalizeAuditOutcome(
                settings.defaultOutcome ||
                DEFAULT_OUTCOME
            ),

        retentionMs:
            normalizeNonNegativeInteger(
                settings.retentionMs,
                0,
                "Audit retention"
            ),

        maxMetadataDepth:
            normalizePositiveInteger(
                settings.maxMetadataDepth,
                DEFAULT_MAX_METADATA_DEPTH,
                "Maximum audit metadata depth"
            ),

        maxStringLength:
            normalizePositiveInteger(
                settings.maxStringLength,
                DEFAULT_MAX_STRING_LENGTH,
                "Maximum audit string length"
            ),

        maxArrayLength:
            normalizePositiveInteger(
                settings.maxArrayLength,
                DEFAULT_MAX_ARRAY_LENGTH,
                "Maximum audit array length"
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
            settings.now
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
            "Audit collection must be a Firestore collection name."
        );
    }

    return collection;
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

/* ==========================================================
   RUNTIME HELPERS
========================================================== */

function assertAuditRuntime(
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
            "The audit datastore is unavailable.",
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
   REQUEST HELPERS
========================================================== */

function resolveRequestHeader(
    request,
    name
) {
    if (
        !request ||
        !name
    ) {
        return null;
    }

    const rawRequest =
        request.rawRequest ||
        request;

    if (
        typeof rawRequest.get ===
        "function"
    ) {
        const value =
            rawRequest.get(name);

        if (
            value !== undefined
        ) {
            return value;
        }
    }

    const headers =
        rawRequest.headers ||
        {};

    const normalizedName =
        String(name)
            .toLowerCase();

    const matchingKey =
        Object.keys(headers)
            .find(
                function (key) {
                    return (
                        String(key)
                            .toLowerCase() ===
                        normalizedName
                    );
                }
            );

    return matchingKey
        ? headers[
              matchingKey
          ]
        : null;
}

function resolveRequestIp(
    request
) {
    if (!request) {
        return null;
    }

    const rawRequest =
        request.rawRequest ||
        request;

    const forwarded =
        resolveRequestHeader(
            rawRequest,
            "x-forwarded-for"
        );

    if (forwarded) {
        return String(
            forwarded
        )
            .split(",")[0]
            .trim();
    }

    return (
        rawRequest.ip ||
        (
            rawRequest.socket &&
            rawRequest.socket
                .remoteAddress
        ) ||
        (
            rawRequest.connection &&
            rawRequest.connection
                .remoteAddress
        ) ||
        null
    );
}

/* ==========================================================
   ID GENERATION
========================================================== */

function generateAuditId(
    timestamp
) {
    const prefix =
        Number(timestamp)
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

/* ==========================================================
   LOGGING
========================================================== */

function logAuditEvent(
    runtime,
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

    const logger =
        runtime.logger;

    const metadata = {
        auditEventId:
            event.id,

        type:
            event.type,

        action:
            event.action,

        outcome:
            event.outcome,

        severity:
            event.severity,

        actorId:
            event.actor &&
            event.actor.id,

        resourceId:
            event.resource &&
            event.resource.id,

        requestId:
            event.request &&
            event.request.requestId
    };

    if (
        (
            event.severity ===
                AUDIT_SEVERITIES.error ||
            event.severity ===
                AUDIT_SEVERITIES.critical
        ) &&
        typeof logger.error ===
            "function"
    ) {
        logger.error(
            "Audit event recorded.",
            metadata
        );

        return;
    }

    if (
        event.severity ===
            AUDIT_SEVERITIES.warning &&
        typeof logger.warn ===
            "function"
    ) {
        logger.warn(
            "Audit event recorded.",
            metadata
        );

        return;
    }

    if (
        typeof logger.info ===
        "function"
    ) {
        logger.info(
            "Audit event recorded.",
            metadata
        );
    }
}

/* ==========================================================
   DATA HELPERS
========================================================== */

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
   EXPORTS
========================================================== */

module.exports = {
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
    constants: {
        AUDIT_COLLECTION,
        DEFAULT_SERVICE,
        DEFAULT_EVENT_TYPE,
        DEFAULT_OUTCOME,
        DEFAULT_MAX_METADATA_DEPTH,
        DEFAULT_MAX_STRING_LENGTH,
        DEFAULT_MAX_ARRAY_LENGTH,
        DEFAULT_QUERY_LIMIT,
        MAX_QUERY_LIMIT,
        AUDIT_OUTCOMES,
        AUDIT_SEVERITIES,
        SENSITIVE_KEYS
    }
};