"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   DEAD-LETTER SERVICE

   Responsibilities:
   - Persist terminally failed jobs and deliveries
   - Prevent duplicate dead-letter records
   - Claim records for replay or investigation
   - Resolve, retry, archive, and discard failures
   - Track failure history and operational metadata
   - Query and inspect dead-letter records
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

const DEAD_LETTER_COLLECTION =
    "_deadLetters";

const DEFAULT_STATUS =
    "pending";

const DEFAULT_SOURCE =
    "unknown";

const DEFAULT_PRIORITY =
    "normal";

const DEFAULT_LEASE_MS =
    5 * 60 * 1000;

const DEFAULT_RETENTION_MS =
    90 * 24 * 60 * 60 * 1000;

const DEFAULT_QUERY_LIMIT =
    100;

const MAX_QUERY_LIMIT =
    500;

const DEFAULT_CLAIM_BATCH_SIZE =
    50;

const DEFAULT_MAX_PAYLOAD_BYTES =
    500000;

const DEFAULT_MAX_RESULT_BYTES =
    500000;

const DEAD_LETTER_STATUSES =
    Object.freeze({
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
    });

const DEAD_LETTER_PRIORITIES =
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

const PRIORITY_WEIGHTS =
    Object.freeze({
        urgent:
            400,

        high:
            300,

        normal:
            200,

        low:
            100
    });

const TERMINAL_DEAD_LETTER_STATUSES =
    Object.freeze([
        DEAD_LETTER_STATUSES.resolved,
        DEAD_LETTER_STATUSES.archived,
        DEAD_LETTER_STATUSES.discarded
    ]);

/* ==========================================================
   SERVICE FACTORY
========================================================== */

function createDeadLetterService(
    options
) {
    const settings =
        normalizeDeadLetterOptions(
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

        create:
            function (
                failure,
                overrides
            ) {
                return createDeadLetter(
                    runtime,
                    failure,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        claim:
            function (
                workerId,
                overrides
            ) {
                return claimNextDeadLetter(
                    runtime,
                    workerId,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        resolve:
            function (
                deadLetterId,
                workerId,
                result,
                overrides
            ) {
                return resolveDeadLetter(
                    runtime,
                    deadLetterId,
                    workerId,
                    result,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        retry:
            function (
                deadLetterId,
                workerId,
                result,
                overrides
            ) {
                return retryDeadLetter(
                    runtime,
                    deadLetterId,
                    workerId,
                    result,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        release:
            function (
                deadLetterId,
                workerId,
                error,
                overrides
            ) {
                return releaseDeadLetter(
                    runtime,
                    deadLetterId,
                    workerId,
                    error,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        archive:
            function (
                deadLetterId,
                reason,
                overrides
            ) {
                return archiveDeadLetter(
                    runtime,
                    deadLetterId,
                    reason,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        discard:
            function (
                deadLetterId,
                reason,
                overrides
            ) {
                return discardDeadLetter(
                    runtime,
                    deadLetterId,
                    reason,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        get:
            function (
                deadLetterId,
                overrides
            ) {
                return getDeadLetter(
                    runtime,
                    deadLetterId,
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
                return queryDeadLetters(
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
   CREATE
========================================================== */

async function createDeadLetter(
    runtime,
    failure,
    options
) {
    const settings =
        normalizeDeadLetterOptions(
            options
        );

    const record =
        normalizeDeadLetterRecord(
            failure,
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

            deadLetterId:
                record.id,

            deadLetter:
                sanitizeDeadLetterRecord(
                    record
                )
        };
    }

    assertDeadLetterRuntime(
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

                                deadLetter:
                                    existing
                            };
                        }

                        throw createDeadLetterConflictError(
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

                        deadLetter:
                            record
                    };
                }
            );

    logDeadLetterEvent(
        runtime,
        result.deadLetter,
        result.duplicate
            ? "duplicate"
            : "created",
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

        deadLetterId:
            record.id,

        deadLetter:
            sanitizeDeadLetterRecord(
                result.deadLetter
            )
    };
}

/* ==========================================================
   CLAIM NEXT
========================================================== */

async function claimNextDeadLetter(
    runtime,
    workerId,
    options
) {
    const settings =
        normalizeDeadLetterOptions(
            options
        );

    const normalizedWorkerId =
        normalizeWorkerId(
            workerId
        );

    if (
        settings.disabled
    ) {
        return null;
    }

    assertDeadLetterRuntime(
        runtime
    );

    const now =
        resolveNow(
            runtime,
            settings
        );

    const candidates =
        await loadDeadLetterCandidates(
            runtime,
            settings
        );

    const ordered =
        candidates
            .filter(
                function (
                    record
                ) {
                    return isDeadLetterClaimable(
                        record,
                        now
                    );
                }
            )
            .sort(
                compareDeadLetterCandidates
            );

    for (
        const candidate of
        ordered
    ) {
        const claimed =
            await claimDeadLetter(
                runtime,
                candidate.id,
                normalizedWorkerId,
                settings
            );

        if (
            claimed
        ) {
            return claimed;
        }
    }

    return null;
}

async function loadDeadLetterCandidates(
    runtime,
    options
) {
    const settings =
        normalizeDeadLetterOptions(
            options
        );

    let query =
        runtime.db
            .collection(
                settings.collection
            );

    if (
        typeof query.limit ===
        "function"
    ) {
        query =
            query.limit(
                settings.claimBatchSize
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
            const data =
                document.data();

            return Object.assign(
                {},
                data,
                {
                    id:
                        data.id ||
                        document.id
                }
            );
        }
    );
}

async function claimDeadLetter(
    runtime,
    deadLetterId,
    workerId,
    options
) {
    const settings =
        normalizeDeadLetterOptions(
            options
        );

    const id =
        normalizeDeadLetterId(
            deadLetterId
        );

    const normalizedWorkerId =
        normalizeWorkerId(
            workerId
        );

    const now =
        resolveNow(
            runtime,
            settings
        );

    const reference =
        runtime.db
            .collection(
                settings.collection
            )
            .doc(
                id
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
                    return null;
                }

                const existing =
                    snapshot.data();

                if (
                    !isDeadLetterClaimable(
                        existing,
                        now
                    )
                ) {
                    return null;
                }

                const leaseToken =
                    generateLeaseToken();

                const update = {
                    status:
                        DEAD_LETTER_STATUSES
                            .processing,

                    workerId:
                        normalizedWorkerId,

                    leaseToken:
                        leaseToken,

                    claimCount:
                        normalizeNonNegativeInteger(
                            existing.claimCount,
                            0,
                            "Dead-letter claim count"
                        ) +
                        1,

                    claimedAt:
                        createDatabaseTimestamp(
                            runtime,
                            now
                        ),

                    leaseExpiresAt:
                        createDatabaseTimestamp(
                            runtime,
                            now +
                            settings.leaseMs
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

                const record =
                    Object.assign(
                        {},
                        existing,
                        update
                    );

                logDeadLetterEvent(
                    runtime,
                    record,
                    "claimed",
                    settings
                );

                return sanitizeDeadLetterRecord(
                    record
                );
            }
        );
}

function isDeadLetterClaimable(
    record,
    now
) {
    if (
        !record
    ) {
        return false;
    }

    const status =
        normalizeDeadLetterStatus(
            record.status
        );

    if (
        status ===
            DEAD_LETTER_STATUSES.pending ||
        status ===
            DEAD_LETTER_STATUSES.retrying
    ) {
        const availableAt =
            toMilliseconds(
                record.availableAt
            );

        return (
            !availableAt ||
            availableAt <=
                Number(now)
        );
    }

    if (
        status ===
        DEAD_LETTER_STATUSES.processing
    ) {
        const leaseExpiresAt =
            toMilliseconds(
                record.leaseExpiresAt
            );

        return (
            !leaseExpiresAt ||
            leaseExpiresAt <=
                Number(now)
        );
    }

    return false;
}

function compareDeadLetterCandidates(
    first,
    second
) {
    const firstWeight =
        PRIORITY_WEIGHTS[
            normalizeDeadLetterPriority(
                first.priority
            )
        ];

    const secondWeight =
        PRIORITY_WEIGHTS[
            normalizeDeadLetterPriority(
                second.priority
            )
        ];

    if (
        firstWeight !==
        secondWeight
    ) {
        return (
            secondWeight -
            firstWeight
        );
    }

    const firstAvailable =
        toMilliseconds(
            first.availableAt
        );

    const secondAvailable =
        toMilliseconds(
            second.availableAt
        );

    if (
        firstAvailable !==
        secondAvailable
    ) {
        return (
            firstAvailable -
            secondAvailable
        );
    }

    return (
        toMilliseconds(
            first.createdAt
        ) -
        toMilliseconds(
            second.createdAt
        )
    );
}

/* ==========================================================
   RESOLVE
========================================================== */

async function resolveDeadLetter(
    runtime,
    deadLetterId,
    workerId,
    result,
    options
) {
    const settings =
        normalizeDeadLetterOptions(
            options
        );

    const id =
        normalizeDeadLetterId(
            deadLetterId
        );

    const normalizedWorkerId =
        normalizeWorkerId(
            workerId
        );

    assertSerializableDeadLetterValue(
        result,
        settings.maxResultBytes,
        "Dead-letter result"
    );

    if (
        settings.disabled
    ) {
        return {
            resolved:
                false,

            disabled:
                true,

            deadLetterId:
                id
        };
    }

    assertDeadLetterRuntime(
        runtime
    );

    const now =
        resolveNow(
            runtime,
            settings
        );

    const reference =
        runtime.db
            .collection(
                settings.collection
            )
            .doc(
                id
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
                        throw createDeadLetterNotFoundError(
                            id
                        );
                    }

                    const existing =
                        snapshot.data();

                    assertDeadLetterOwnership(
                        existing,
                        normalizedWorkerId,
                        settings.leaseToken
                    );

                    const update = {
                        status:
                            DEAD_LETTER_STATUSES
                                .resolved,

                        resolution:
                            cloneValue(
                                result
                            ),

                        resolvedAt:
                            createDatabaseTimestamp(
                                runtime,
                                now
                            ),

                        workerId:
                            null,

                        leaseToken:
                            null,

                        leaseExpiresAt:
                            null,

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

    logDeadLetterEvent(
        runtime,
        record,
        "resolved",
        settings
    );

    return {
        resolved:
            true,

        disabled:
            false,

        deadLetterId:
            id,

        deadLetter:
            sanitizeDeadLetterRecord(
                record
            )
    };
}

/* ==========================================================
   RETRY
========================================================== */

async function retryDeadLetter(
    runtime,
    deadLetterId,
    workerId,
    result,
    options
) {
    const settings =
        normalizeDeadLetterOptions(
            options
        );

    const id =
        normalizeDeadLetterId(
            deadLetterId
        );

    const normalizedWorkerId =
        normalizeWorkerId(
            workerId
        );

    assertSerializableDeadLetterValue(
        result,
        settings.maxResultBytes,
        "Dead-letter retry result"
    );

    if (
        settings.disabled
    ) {
        return {
            retried:
                false,

            disabled:
                true,

            deadLetterId:
                id
        };
    }

    assertDeadLetterRuntime(
        runtime
    );

    const now =
        resolveNow(
            runtime,
            settings
        );

    const reference =
        runtime.db
            .collection(
                settings.collection
            )
            .doc(
                id
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
                        throw createDeadLetterNotFoundError(
                            id
                        );
                    }

                    const existing =
                        snapshot.data();

                    assertDeadLetterOwnership(
                        existing,
                        normalizedWorkerId,
                        settings.leaseToken
                    );

                    const update = {
                        status:
                            DEAD_LETTER_STATUSES
                                .resolved,

                        retryCount:
                            normalizeNonNegativeInteger(
                                existing.retryCount,
                                0,
                                "Dead-letter retry count"
                            ) +
                            1,

                        retryResult:
                            cloneValue(
                                result
                            ),

                        retriedAt:
                            createDatabaseTimestamp(
                                runtime,
                                now
                            ),

                        resolvedAt:
                            createDatabaseTimestamp(
                                runtime,
                                now
                            ),

                        workerId:
                            null,

                        leaseToken:
                            null,

                        leaseExpiresAt:
                            null,

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

    logDeadLetterEvent(
        runtime,
        record,
        "retried",
        settings
    );

    return {
        retried:
            true,

        resolved:
            true,

        disabled:
            false,

        deadLetterId:
            id,

        deadLetter:
            sanitizeDeadLetterRecord(
                record
            )
    };
}

/* ==========================================================
   RELEASE AFTER FAILED PROCESSING
========================================================== */

async function releaseDeadLetter(
    runtime,
    deadLetterId,
    workerId,
    error,
    options
) {
    const settings =
        normalizeDeadLetterOptions(
            options
        );

    const id =
        normalizeDeadLetterId(
            deadLetterId
        );

    const normalizedWorkerId =
        normalizeWorkerId(
            workerId
        );

    if (
        settings.disabled
    ) {
        return {
            released:
                false,

            disabled:
                true,

            deadLetterId:
                id
        };
    }

    assertDeadLetterRuntime(
        runtime
    );

    const now =
        resolveNow(
            runtime,
            settings
        );

    const reference =
        runtime.db
            .collection(
                settings.collection
            )
            .doc(
                id
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
                        throw createDeadLetterNotFoundError(
                            id
                        );
                    }

                    const existing =
                        snapshot.data();

                    assertDeadLetterOwnership(
                        existing,
                        normalizedWorkerId,
                        settings.leaseToken
                    );

                    const delayMs =
                        normalizeNonNegativeInteger(
                            settings.releaseDelayMs,
                            0,
                            "Dead-letter release delay"
                        );

                    const update = {
                        status:
                            delayMs >
                            0
                                ? DEAD_LETTER_STATUSES
                                      .retrying
                                : DEAD_LETTER_STATUSES
                                      .pending,

                        processingError:
                            serializeDeadLetterError(
                                error
                            ),

                        availableAt:
                            createDatabaseTimestamp(
                                runtime,
                                now +
                                delayMs
                            ),

                        workerId:
                            null,

                        leaseToken:
                            null,

                        leaseExpiresAt:
                            null,

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

    logDeadLetterEvent(
        runtime,
        record,
        "released",
        settings
    );

    return {
        released:
            true,

        disabled:
            false,

        deadLetterId:
            id,

        deadLetter:
            sanitizeDeadLetterRecord(
                record
            )
    };
}

/* ==========================================================
   ARCHIVE AND DISCARD
========================================================== */

function archiveDeadLetter(
    runtime,
    deadLetterId,
    reason,
    options
) {
    return setDeadLetterTerminalStatus(
        runtime,
        deadLetterId,
        DEAD_LETTER_STATUSES.archived,
        reason,
        options
    );
}

function discardDeadLetter(
    runtime,
    deadLetterId,
    reason,
    options
) {
    return setDeadLetterTerminalStatus(
        runtime,
        deadLetterId,
        DEAD_LETTER_STATUSES.discarded,
        reason,
        options
    );
}

async function setDeadLetterTerminalStatus(
    runtime,
    deadLetterId,
    status,
    reason,
    options
) {
    const settings =
        normalizeDeadLetterOptions(
            options
        );

    const id =
        normalizeDeadLetterId(
            deadLetterId
        );

    const normalizedStatus =
        normalizeDeadLetterStatus(
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

            deadLetterId:
                id,

            status:
                normalizedStatus
        };
    }

    assertDeadLetterRuntime(
        runtime
    );

    const now =
        resolveNow(
            runtime,
            settings
        );

    const reference =
        runtime.db
            .collection(
                settings.collection
            )
            .doc(
                id
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
                        throw createDeadLetterNotFoundError(
                            id
                        );
                    }

                    const existing =
                        snapshot.data();

                    const currentStatus =
                        normalizeDeadLetterStatus(
                            existing.status
                        );

                    if (
                        TERMINAL_DEAD_LETTER_STATUSES
                            .includes(
                                currentStatus
                            )
                    ) {
                        throw new ServiceError(
                            "failed-precondition",
                            "A terminal dead-letter record cannot change status.",
                            {
                                status:
                                    409,

                                expose:
                                    true
                            }
                        );
                    }

                    const timestampField =
                        normalizedStatus ===
                        DEAD_LETTER_STATUSES.archived
                            ? "archivedAt"
                            : "discardedAt";

                    const reasonField =
                        normalizedStatus ===
                        DEAD_LETTER_STATUSES.archived
                            ? "archiveReason"
                            : "discardReason";

                    const update = {
                        status:
                            normalizedStatus,

                        [timestampField]:
                            createDatabaseTimestamp(
                                runtime,
                                now
                            ),

                        [reasonField]:
                            normalizeOptionalString(
                                reason
                            ),

                        workerId:
                            null,

                        leaseToken:
                            null,

                        leaseExpiresAt:
                            null,

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

    logDeadLetterEvent(
        runtime,
        record,
        normalizedStatus,
        settings
    );

    return {
        updated:
            true,

        disabled:
            false,

        deadLetterId:
            id,

        status:
            normalizedStatus,

        deadLetter:
            sanitizeDeadLetterRecord(
                record
            )
    };
}

/* ==========================================================
   GET
========================================================== */

async function getDeadLetter(
    runtime,
    deadLetterId,
    options
) {
    const settings =
        normalizeDeadLetterOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return null;
    }

    assertDeadLetterRuntime(
        runtime
    );

    const id =
        normalizeDeadLetterId(
            deadLetterId
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

    return sanitizeDeadLetterRecord(
        snapshot.data()
    );
}

/* ==========================================================
   QUERY
========================================================== */

async function queryDeadLetters(
    runtime,
    filters,
    options
) {
    const settings =
        normalizeDeadLetterOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return [];
    }

    assertDeadLetterRuntime(
        runtime
    );

    const normalized =
        normalizeDeadLetterQuery(
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
        normalized.source
    ) {
        query =
            query.where(
                "source",
                "==",
                normalized.source
            );
    }

    if (
        normalized.event
    ) {
        query =
            query.where(
                "event",
                "==",
                normalized.event
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
        normalized.workerId
    ) {
        query =
            query.where(
                "workerId",
                "==",
                normalized.workerId
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
        normalized.createdBefore
    ) {
        query =
            query.where(
                "createdAt",
                "<=",
                createDatabaseTimestamp(
                    runtime,
                    normalized
                        .createdBefore
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
        function (
            document
        ) {
            return sanitizeDeadLetterRecord(
                document.data()
            );
        }
    );
}

function normalizeDeadLetterQuery(
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
                ? normalizeDeadLetterStatus(
                      source.status
                  )
                : null,

        source:
            source.source
                ? normalizeDeadLetterSource(
                      source.source
                  )
                : null,

        event:
            source.event
                ? normalizeDeadLetterEvent(
                      source.event
                  )
                : null,

        priority:
            source.priority
                ? normalizeDeadLetterPriority(
                      source.priority
                  )
                : null,

        workerId:
            normalizeOptionalString(
                source.workerId
            ),

        createdAfter:
            source.createdAfter !==
            undefined
                ? normalizeDeadLetterDate(
                      source.createdAfter,
                      "Dead-letter creation filter"
                  )
                : null,

        createdBefore:
            source.createdBefore !==
            undefined
                ? normalizeDeadLetterDate(
                      source.createdBefore,
                      "Dead-letter creation filter"
                  )
                : null,

        orderBy:
            normalizeDeadLetterOrderField(
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
   RECORD NORMALIZATION
========================================================== */

function normalizeDeadLetterRecord(
    failure,
    options,
    runtime
) {
    const source =
        failure || {};

    if (
        typeof source !==
            "object" ||
        Array.isArray(
            source
        )
    ) {
        throw new TypeError(
            "Dead-letter failure must be an object."
        );
    }

    const settings =
        normalizeDeadLetterOptions(
            options
        );

    const now =
        resolveNow(
            runtime,
            settings
        );

    const payload =
        cloneValue(
            source.payload ||
            source.data ||
            {}
        );

    assertSerializableDeadLetterValue(
        payload,
        settings.maxPayloadBytes,
        "Dead-letter payload"
    );

    const sourceName =
        normalizeDeadLetterSource(
            source.source ||
            settings.defaultSource
        );

    const event =
        normalizeDeadLetterEvent(
            source.event ||
            source.type ||
            source.operation ||
            "unknown"
        );

    const sourceId =
        normalizeOptionalString(
            source.sourceId ||
            source.recordId ||
            source.jobId ||
            source.deliveryId
        );

    const id =
        source.id
            ? normalizeDeadLetterId(
                  source.id
              )
            : createDeadLetterId(
                  source,
                  settings,
                  now
              );

    const error =
        serializeDeadLetterError(
            source.error ||
            source.failure ||
            new Error(
                "Unknown dead-letter failure."
            )
        );

    const priority =
        normalizeDeadLetterPriority(
            source.priority ||
            settings.defaultPriority
        );

    const fingerprint =
        createDeadLetterFingerprint({
            source:
                sourceName,

            sourceId:
                sourceId,

            event:
                event,

            payload:
                payload,

            error:
                error
        });

    return {
        id:
            id,

        fingerprint:
            fingerprint,

        source:
            sourceName,

        sourceId:
            sourceId,

        event:
            event,

        status:
            DEAD_LETTER_STATUSES
                .pending,

        priority:
            priority,

        priorityWeight:
            PRIORITY_WEIGHTS[
                priority
            ],

        payload:
            payload,

        error:
            error,

        metadata:
            sanitizeDeadLetterMetadata(
                source.metadata
            ),

        tags:
            normalizeDeadLetterTags(
                source.tags
            ),

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
            createDatabaseTimestamp(
                runtime,
                now
            ),

        updatedAt:
            createDatabaseTimestamp(
                runtime,
                now
            ),

        availableAt:
            createDatabaseTimestamp(
                runtime,
                source.availableAt !==
                    undefined &&
                source.availableAt !==
                    null
                    ? normalizeDeadLetterDate(
                          source.availableAt,
                          "Dead-letter availability"
                      )
                    : now
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
   OWNERSHIP
========================================================== */

function assertDeadLetterOwnership(
    record,
    workerId,
    leaseToken
) {
    if (
        normalizeDeadLetterStatus(
            record.status
        ) !==
        DEAD_LETTER_STATUSES
            .processing
    ) {
        throw new ServiceError(
            "failed-precondition",
            "The dead-letter record is not being processed.",
            {
                status:
                    409,

                expose:
                    true
            }
        );
    }

    if (
        String(
            record.workerId ||
            ""
        ) !==
        String(
            workerId ||
            ""
        )
    ) {
        throw new ServiceError(
            "permission-denied",
            "The worker does not own this dead-letter lease.",
            {
                status:
                    403,

                expose:
                    true
            }
        );
    }

    if (
        leaseToken &&
        String(
            record.leaseToken ||
            ""
        ) !==
        String(
            leaseToken
        )
    ) {
        throw new ServiceError(
            "aborted",
            "The dead-letter lease token is no longer valid.",
            {
                status:
                    409,

                expose:
                    true,

                retryable:
                    true
            }
        );
    }

    return true;
}

/* ==========================================================
   SANITIZATION
========================================================== */

function sanitizeDeadLetterRecord(
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

        source:
            normalizeDeadLetterSource(
                record.source
            ),

        sourceId:
            record.sourceId ||
            null,

        event:
            normalizeDeadLetterEvent(
                record.event
            ),

        status:
            normalizeDeadLetterStatus(
                record.status
            ),

        priority:
            normalizeDeadLetterPriority(
                record.priority
            ),

        priorityWeight:
            Number(
                record.priorityWeight ||
                PRIORITY_WEIGHTS[
                    normalizeDeadLetterPriority(
                        record.priority
                    )
                ]
            ),

        payload:
            cloneValue(
                record.payload
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

        claimCount:
            normalizeNonNegativeInteger(
                record.claimCount,
                0,
                "Dead-letter claim count"
            ),

        retryCount:
            normalizeNonNegativeInteger(
                record.retryCount,
                0,
                "Dead-letter retry count"
            ),

        workerId:
            record.workerId ||
            null,

        leaseToken:
            record.leaseToken ||
            null,

        resolution:
            cloneValue(
                record.resolution
            ),

        retryResult:
            cloneValue(
                record.retryResult
            ),

        processingError:
            cloneValue(
                record.processingError
            ),

        archiveReason:
            record.archiveReason ||
            null,

        discardReason:
            record.discardReason ||
            null,

        createdAt:
            serializeTimestamp(
                record.createdAt
            ),

        updatedAt:
            serializeTimestamp(
                record.updatedAt
            ),

        availableAt:
            serializeTimestamp(
                record.availableAt
            ),

        claimedAt:
            serializeTimestamp(
                record.claimedAt
            ),

        leaseExpiresAt:
            serializeTimestamp(
                record.leaseExpiresAt
            ),

        resolvedAt:
            serializeTimestamp(
                record.resolvedAt
            ),

        retriedAt:
            serializeTimestamp(
                record.retriedAt
            ),

        archivedAt:
            serializeTimestamp(
                record.archivedAt
            ),

        discardedAt:
            serializeTimestamp(
                record.discardedAt
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
   NORMALIZERS
========================================================== */

function normalizeDeadLetterId(
    value
) {
    const normalized =
        String(
            value || ""
        ).trim();

    if (
        !normalized ||
        normalized.includes(
            "/"
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The dead-letter ID is invalid.",
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

function normalizeDeadLetterSource(
    value
) {
    const normalized =
        String(
            value ||
            DEFAULT_SOURCE
        )
            .trim()
            .toLowerCase()
            .replace(
                /[^a-z0-9._:-]/g,
                "-"
            );

    return normalized ||
        DEFAULT_SOURCE;
}

function normalizeDeadLetterEvent(
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

    if (
        !normalized
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The dead-letter event is invalid.",
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

function normalizeDeadLetterStatus(
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
            DEAD_LETTER_STATUSES
        ).includes(
            normalized
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The dead-letter status is invalid.",
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

function normalizeDeadLetterPriority(
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
        DEAD_LETTER_PRIORITIES
    ).includes(
        normalized
    )
        ? normalized
        : DEFAULT_PRIORITY;
}

function normalizeWorkerId(
    value
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
            "A dead-letter worker ID is required.",
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

function normalizeDeadLetterTags(
    value
) {
    if (
        value === undefined ||
        value === null
    ) {
        return [];
    }

    const values =
        Array.isArray(
            value
        )
            ? value
            : [
                  value
              ];

    return Array.from(
        new Set(
            values
                .map(
                    function (
                        item
                    ) {
                        return String(
                            item || ""
                        )
                            .trim()
                            .toLowerCase();
                    }
                )
                .filter(
                    Boolean
                )
        )
    ).slice(
        0,
        100
    );
}

function normalizeDeadLetterDate(
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

function normalizeDeadLetterOrderField(
    value
) {
    const allowed =
        new Set([
            "createdAt",
            "updatedAt",
            "availableAt",
            "priorityWeight",
            "claimCount",
            "retryCount",
            "resolvedAt",
            "archivedAt",
            "discardedAt"
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
        Number(
            value
        );

    if (
        !Number.isInteger(
            normalized
        ) ||
        normalized <=
            0
    ) {
        throw new TypeError(
            "Dead-letter query limit must be a positive integer."
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
        Number(
            value
        );

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
        Number(
            value
        );

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
        String(
            value
        ).trim();

    return normalized ||
        null;
}

function normalizeCollection(
    value
) {
    const normalized =
        String(
            value || ""
        ).trim();

    if (
        !normalized ||
        normalized.includes(
            "/"
        )
    ) {
        throw new TypeError(
            "Dead-letter collection must be a Firestore collection name."
        );
    }

    return normalized;
}

/* ==========================================================
   OPTIONS
========================================================== */

function normalizeDeadLetterOptions(
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
                DEAD_LETTER_COLLECTION
            ),

        defaultSource:
            normalizeDeadLetterSource(
                settings.defaultSource ||
                DEFAULT_SOURCE
            ),

        defaultPriority:
            normalizeDeadLetterPriority(
                settings.defaultPriority ||
                DEFAULT_PRIORITY
            ),

        leaseMs:
            normalizePositiveInteger(
                settings.leaseMs,
                DEFAULT_LEASE_MS,
                "Dead-letter lease duration"
            ),

        retentionMs:
            normalizeNonNegativeInteger(
                settings.retentionMs,
                DEFAULT_RETENTION_MS,
                "Dead-letter retention"
            ),

        queryLimit:
            normalizeQueryLimit(
                settings.queryLimit
            ),

        claimBatchSize:
            normalizePositiveInteger(
                settings.claimBatchSize,
                DEFAULT_CLAIM_BATCH_SIZE,
                "Dead-letter claim batch size"
            ),

        maxPayloadBytes:
            normalizePositiveInteger(
                settings.maxPayloadBytes,
                DEFAULT_MAX_PAYLOAD_BYTES,
                "Maximum dead-letter payload size"
            ),

        maxResultBytes:
            normalizePositiveInteger(
                settings.maxResultBytes,
                DEFAULT_MAX_RESULT_BYTES,
                "Maximum dead-letter result size"
            ),

        releaseDelayMs:
            normalizeNonNegativeInteger(
                settings.releaseDelayMs,
                0,
                "Dead-letter release delay"
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
            settings.idResolver,

        leaseToken:
            settings.leaseToken,

        requestId:
            settings.requestId,

        correlationId:
            settings.correlationId
    };
}

/* ==========================================================
   IDENTIFIERS AND FINGERPRINTS
========================================================== */

function createDeadLetterId(
    failure,
    options,
    now
) {
    const settings =
        options || {};

    if (
        typeof settings.idResolver ===
        "function"
    ) {
        return normalizeDeadLetterId(
            settings.idResolver(
                failure
            )
        );
    }

    if (
        failure &&
        failure.idempotencyKey
    ) {
        return hashDeadLetterValue(
            failure.idempotencyKey
        );
    }

    const prefix =
        Number(
            now
        )
            .toString(
                36
            )
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
                  .randomBytes(
                      16
                  )
                  .toString(
                      "hex"
                  );

    return (
        prefix +
        "_" +
        random
    );
}

function generateLeaseToken() {
    if (
        typeof crypto.randomUUID ===
        "function"
    ) {
        return crypto.randomUUID();
    }

    return crypto
        .randomBytes(
            24
        )
        .toString(
            "hex"
        );
}

function createDeadLetterFingerprint(
    value
) {
    return hashDeadLetterValue(
        stableStringify(
            value
        )
    );
}

function hashDeadLetterValue(
    value
) {
    return crypto
        .createHash(
            "sha256"
        )
        .update(
            String(
                value
            )
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
            "Dead-letter data contains a circular reference.",
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

function assertSerializableDeadLetterValue(
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
   METADATA AND ERRORS
========================================================== */

function sanitizeDeadLetterMetadata(
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
        Array.isArray(
            value
        )
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

function serializeDeadLetterError(
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
            "dead-letter-failure",

        message:
            error.publicMessage ||
            error.message ||
            "The operation failed.",

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
                : false,

        details:
            error.details &&
            typeof error.details ===
                "object"
                ? cloneValue(
                      error.details
                  )
                : null
    };
}

function createDeadLetterNotFoundError(
    deadLetterId
) {
    return new ServiceError(
        "not-found",
        "The dead-letter record was not found.",
        {
            status:
                404,

            expose:
                true,

            details: {
                deadLetterId:
                    deadLetterId
            }
        }
    );
}

function createDeadLetterConflictError(
    deadLetterId,
    options
) {
    const settings =
        options || {};

    return new ServiceError(
        "already-exists",
        "A dead-letter record with this ID already exists.",
        {
            status:
                409,

            expose:
                true,

            retryable:
                false,

            details: {
                deadLetterId:
                    deadLetterId
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

function assertDeadLetterRuntime(
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
            "The dead-letter datastore is unavailable.",
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
            "Firestore transactions are required for dead-letter records.",
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
   DATA CLONING
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

function logDeadLetterEvent(
    runtime,
    record,
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

        deadLetterId:
            record &&
            record.id,

        source:
            record &&
            record.source,

        sourceId:
            record &&
            record.sourceId,

        deadLetterEvent:
            record &&
            record.event,

        status:
            record &&
            record.status,

        priority:
            record &&
            record.priority,

        claimCount:
            record &&
            record.claimCount,

        retryCount:
            record &&
            record.retryCount,

        workerId:
            record &&
            record.workerId
    };

    if (
        event ===
            "created" &&
        typeof runtime.logger.error ===
            "function"
    ) {
        runtime.logger.error(
            "Dead-letter record created.",
            metadata
        );

        return;
    }

    if (
        event ===
            "released" &&
        typeof runtime.logger.warn ===
            "function"
    ) {
        runtime.logger.warn(
            "Dead-letter processing released.",
            metadata
        );

        return;
    }

    if (
        typeof runtime.logger.info ===
        "function"
    ) {
        runtime.logger.info(
            "Dead-letter event.",
            metadata
        );
    } else if (
        typeof runtime.logger.debug ===
        "function"
    ) {
        runtime.logger.debug(
            "Dead-letter event.",
            metadata
        );
    }
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
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
    constants: {
        DEAD_LETTER_COLLECTION,
        DEFAULT_STATUS,
        DEFAULT_SOURCE,
        DEFAULT_PRIORITY,
        DEFAULT_LEASE_MS,
        DEFAULT_RETENTION_MS,
        DEFAULT_QUERY_LIMIT,
        MAX_QUERY_LIMIT,
        DEFAULT_CLAIM_BATCH_SIZE,
        DEFAULT_MAX_PAYLOAD_BYTES,
        DEFAULT_MAX_RESULT_BYTES,
        DEAD_LETTER_STATUSES,
        DEAD_LETTER_PRIORITIES,
        PRIORITY_WEIGHTS,
        TERMINAL_DEAD_LETTER_STATUSES
    }
};