"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   SCHEDULER SERVICE

   Responsibilities:
   - Create and update recurring schedules
   - Calculate future execution times
   - Claim due schedules atomically
   - Record successful and failed executions
   - Support retries, pausing, resuming, and cancellation
   - Query and inspect scheduler records
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

const SCHEDULE_COLLECTION =
    "_schedules";

const DEFAULT_STATUS =
    "active";

const DEFAULT_TIMEZONE =
    "UTC";

const DEFAULT_INTERVAL_MS =
    60 * 60 * 1000;

const DEFAULT_LEASE_MS =
    5 * 60 * 1000;

const DEFAULT_RETRY_DELAY_MS =
    30 * 1000;

const DEFAULT_MAX_RETRY_DELAY_MS =
    60 * 60 * 1000;

const DEFAULT_MAX_ATTEMPTS =
    5;

const DEFAULT_QUERY_LIMIT =
    100;

const MAX_QUERY_LIMIT =
    500;

const DEFAULT_RETENTION_MS =
    90 * 24 * 60 * 60 * 1000;

const DEFAULT_CLAIM_BATCH_SIZE =
    50;

const DEFAULT_MAX_PAYLOAD_BYTES =
    500000;

const DEFAULT_MAX_RESULT_BYTES =
    500000;

const SCHEDULE_STATUSES =
    Object.freeze({
        active:
            "active",

        processing:
            "processing",

        paused:
            "paused",

        completed:
            "completed",

        failed:
            "failed",

        cancelled:
            "cancelled"
    });

const SCHEDULE_TYPES =
    Object.freeze({
        once:
            "once",

        interval:
            "interval"
    });

const TERMINAL_SCHEDULE_STATUSES =
    Object.freeze([
        SCHEDULE_STATUSES.completed,
        SCHEDULE_STATUSES.failed,
        SCHEDULE_STATUSES.cancelled
    ]);

/* ==========================================================
   SERVICE FACTORY
========================================================== */

function createSchedulerService(
    options
) {
    const settings =
        normalizeSchedulerOptions(
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
                schedule,
                overrides
            ) {
                return createSchedule(
                    runtime,
                    schedule,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        update:
            function (
                scheduleId,
                changes,
                overrides
            ) {
                return updateSchedule(
                    runtime,
                    scheduleId,
                    changes,
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
                return claimNextSchedule(
                    runtime,
                    workerId,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        complete:
            function (
                scheduleId,
                workerId,
                result,
                overrides
            ) {
                return completeScheduleExecution(
                    runtime,
                    scheduleId,
                    workerId,
                    result,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        fail:
            function (
                scheduleId,
                workerId,
                error,
                overrides
            ) {
                return failScheduleExecution(
                    runtime,
                    scheduleId,
                    workerId,
                    error,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        pause:
            function (
                scheduleId,
                reason,
                overrides
            ) {
                return pauseSchedule(
                    runtime,
                    scheduleId,
                    reason,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        resume:
            function (
                scheduleId,
                overrides
            ) {
                return resumeSchedule(
                    runtime,
                    scheduleId,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        cancel:
            function (
                scheduleId,
                reason,
                overrides
            ) {
                return cancelSchedule(
                    runtime,
                    scheduleId,
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
                scheduleId,
                overrides
            ) {
                return getSchedule(
                    runtime,
                    scheduleId,
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
                return querySchedules(
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

async function createSchedule(
    runtime,
    schedule,
    options
) {
    const settings =
        normalizeSchedulerOptions(
            options
        );

    const record =
        normalizeScheduleRecord(
            schedule,
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

            scheduleId:
                record.id,

            schedule:
                sanitizeScheduleRecord(
                    record
                )
        };
    }

    assertSchedulerRuntime(
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

                                schedule:
                                    existing
                            };
                        }

                        throw createScheduleConflictError(
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

                        schedule:
                            record
                    };
                }
            );

    logScheduleEvent(
        runtime,
        result.schedule,
        result.duplicate
            ? "duplicate"
            : "created",
        settings
    );

    return {
        created:
            !result.duplicate,

        duplicate:
            result.duplicate,

        disabled:
            false,

        scheduleId:
            record.id,

        schedule:
            sanitizeScheduleRecord(
                result.schedule
            )
    };
}

/* ==========================================================
   UPDATE
========================================================== */

async function updateSchedule(
    runtime,
    scheduleId,
    changes,
    options
) {
    const settings =
        normalizeSchedulerOptions(
            options
        );

    const id =
        normalizeScheduleId(
            scheduleId
        );

    if (
        !changes ||
        typeof changes !==
            "object" ||
        Array.isArray(changes)
    ) {
        throw new TypeError(
            "Schedule changes must be an object."
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

            scheduleId:
                id
        };
    }

    assertSchedulerRuntime(
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
                        throw createScheduleNotFoundError(
                            id
                        );
                    }

                    const existing =
                        snapshot.data();

                    if (
                        TERMINAL_SCHEDULE_STATUSES
                            .includes(
                                normalizeScheduleStatus(
                                    existing.status
                                )
                            )
                    ) {
                        throw new ServiceError(
                            "failed-precondition",
                            "A terminal schedule cannot be updated.",
                            {
                                status:
                                    409,

                                expose:
                                    true
                            }
                        );
                    }

                    const update =
                        normalizeScheduleUpdate(
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

    logScheduleEvent(
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

        scheduleId:
            id,

        schedule:
            sanitizeScheduleRecord(
                record
            )
    };
}

function normalizeScheduleUpdate(
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
        changes.name !==
        undefined
    ) {
        update.name =
            normalizeScheduleName(
                changes.name
            );
    }

    if (
        changes.payload !==
        undefined
    ) {
        assertSerializableScheduleValue(
            changes.payload,
            settings.maxPayloadBytes,
            "Schedule payload"
        );

        update.payload =
            cloneValue(
                changes.payload
            );
    }

    if (
        changes.metadata !==
        undefined
    ) {
        update.metadata =
            sanitizeScheduleMetadata(
                changes.metadata
            );
    }

    if (
        changes.tags !==
        undefined
    ) {
        update.tags =
            normalizeScheduleTags(
                changes.tags
            );
    }

    if (
        changes.timezone !==
        undefined
    ) {
        update.timezone =
            normalizeTimezone(
                changes.timezone
            );
    }

    if (
        changes.intervalMs !==
        undefined
    ) {
        update.intervalMs =
            normalizePositiveInteger(
                changes.intervalMs,
                DEFAULT_INTERVAL_MS,
                "Schedule interval"
            );

        update.type =
            SCHEDULE_TYPES.interval;
    }

    if (
        changes.maxRuns !==
        undefined
    ) {
        update.maxRuns =
            normalizeOptionalPositiveInteger(
                changes.maxRuns,
                "Maximum schedule runs"
            );
    }

    if (
        changes.nextRunAt !==
        undefined
    ) {
        update.nextRunAt =
            createDatabaseTimestamp(
                runtime,
                normalizeScheduleDate(
                    changes.nextRunAt,
                    "Schedule next run"
                )
            );
    } else if (
        changes.intervalMs !==
        undefined
    ) {
        update.nextRunAt =
            createDatabaseTimestamp(
                runtime,
                calculateNextRunAt(
                    Object.assign(
                        {},
                        existing,
                        update
                    ),
                    now
                )
            );
    }

    return update;
}

/* ==========================================================
   CLAIM NEXT
========================================================== */

async function claimNextSchedule(
    runtime,
    workerId,
    options
) {
    const settings =
        normalizeSchedulerOptions(
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

    assertSchedulerRuntime(
        runtime
    );

    const now =
        resolveNow(
            runtime,
            settings
        );

    const candidates =
        await loadScheduleCandidates(
            runtime,
            settings,
            now
        );

    const ordered =
        candidates
            .filter(
                function (
                    record
                ) {
                    return isScheduleClaimable(
                        record,
                        now
                    );
                }
            )
            .sort(
                compareScheduleCandidates
            );

    for (
        const candidate of
        ordered
    ) {
        const result =
            await claimSchedule(
                runtime,
                candidate.id,
                normalizedWorkerId,
                settings
            );

        if (result) {
            return result;
        }
    }

    return null;
}

async function loadScheduleCandidates(
    runtime,
    options
) {
    const settings =
        options || {};

    let query =
        runtime.db
            .collection(
                settings.collection
            );

    if (
        typeof query.where ===
        "function"
    ) {
        query =
            query.where(
                "status",
                "==",
                SCHEDULE_STATUSES.active
            );
    }

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

async function claimSchedule(
    runtime,
    scheduleId,
    workerId,
    options
) {
    const settings =
        normalizeSchedulerOptions(
            options
        );

    const id =
        normalizeScheduleId(
            scheduleId
        );

    const normalizedWorkerId =
        normalizeWorkerId(
            workerId
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
                    !isScheduleClaimable(
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
                        SCHEDULE_STATUSES
                            .processing,

                    workerId:
                        normalizedWorkerId,

                    leaseToken:
                        leaseToken,

                    attempts:
                        normalizeNonNegativeInteger(
                            existing.attempts,
                            0,
                            "Schedule attempts"
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

                logScheduleEvent(
                    runtime,
                    record,
                    "claimed",
                    settings
                );

                return sanitizeScheduleRecord(
                    record
                );
            }
        );
}

function isScheduleClaimable(
    schedule,
    now
) {
    if (!schedule) {
        return false;
    }

    const status =
        normalizeScheduleStatus(
            schedule.status
        );

    if (
        status ===
        SCHEDULE_STATUSES.active
    ) {
        const nextRunAt =
            toMilliseconds(
                schedule.nextRunAt
            );

        return (
            !nextRunAt ||
            nextRunAt <=
            now
        );
    }

    if (
        status ===
        SCHEDULE_STATUSES.processing
    ) {
        const leaseExpiresAt =
            toMilliseconds(
                schedule.leaseExpiresAt
            );

        return (
            !leaseExpiresAt ||
            leaseExpiresAt <=
            now
        );
    }

    return false;
}

function compareScheduleCandidates(
    first,
    second
) {
    const firstRun =
        toMilliseconds(
            first.nextRunAt
        );

    const secondRun =
        toMilliseconds(
            second.nextRunAt
        );

    if (
        firstRun !==
        secondRun
    ) {
        return (
            firstRun -
            secondRun
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
   COMPLETE EXECUTION
========================================================== */

async function completeScheduleExecution(
    runtime,
    scheduleId,
    workerId,
    result,
    options
) {
    const settings =
        normalizeSchedulerOptions(
            options
        );

    const id =
        normalizeScheduleId(
            scheduleId
        );

    const normalizedWorkerId =
        normalizeWorkerId(
            workerId
        );

    assertSerializableScheduleValue(
        result,
        settings.maxResultBytes,
        "Schedule result"
    );

    if (
        settings.disabled
    ) {
        return {
            completed:
                false,

            disabled:
                true,

            scheduleId:
                id
        };
    }

    assertSchedulerRuntime(
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
                        throw createScheduleNotFoundError(
                            id
                        );
                    }

                    const existing =
                        snapshot.data();

                    assertScheduleOwnership(
                        existing,
                        normalizedWorkerId,
                        settings.leaseToken
                    );

                    const runCount =
                        normalizeNonNegativeInteger(
                            existing.runCount,
                            0,
                            "Schedule run count"
                        ) +
                        1;

                    const shouldComplete =
                        shouldCompleteSchedule(
                            existing,
                            runCount
                        );

                    const nextRunAt =
                        shouldComplete
                            ? null
                            : calculateNextRunAt(
                                  existing,
                                  now
                              );

                    const update = {
                        status:
                            shouldComplete
                                ? SCHEDULE_STATUSES
                                      .completed
                                : SCHEDULE_STATUSES
                                      .active,

                        runCount:
                            runCount,

                        attempts:
                            0,

                        lastResult:
                            cloneValue(
                                result
                            ),

                        lastError:
                            null,

                        lastRunAt:
                            createDatabaseTimestamp(
                                runtime,
                                now
                            ),

                        completedAt:
                            shouldComplete
                                ? createDatabaseTimestamp(
                                      runtime,
                                      now
                                  )
                                : null,

                        nextRunAt:
                            nextRunAt ===
                            null
                                ? null
                                : createDatabaseTimestamp(
                                      runtime,
                                      nextRunAt
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

    logScheduleEvent(
        runtime,
        record,
        record.status ===
            SCHEDULE_STATUSES.completed
            ? "completed"
            : "rescheduled",
        settings
    );

    return {
        completed:
            true,

        scheduleFinished:
            record.status ===
            SCHEDULE_STATUSES.completed,

        disabled:
            false,

        scheduleId:
            id,

        schedule:
            sanitizeScheduleRecord(
                record
            )
    };
}

/* ==========================================================
   FAIL EXECUTION
========================================================== */

async function failScheduleExecution(
    runtime,
    scheduleId,
    workerId,
    error,
    options
) {
    const settings =
        normalizeSchedulerOptions(
            options
        );

    const id =
        normalizeScheduleId(
            scheduleId
        );

    const normalizedWorkerId =
        normalizeWorkerId(
            workerId
        );

    if (
        settings.disabled
    ) {
        return {
            failed:
                false,

            retryScheduled:
                false,

            disabled:
                true,

            scheduleId:
                id
        };
    }

    assertSchedulerRuntime(
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
                        throw createScheduleNotFoundError(
                            id
                        );
                    }

                    const existing =
                        snapshot.data();

                    assertScheduleOwnership(
                        existing,
                        normalizedWorkerId,
                        settings.leaseToken
                    );

                    const attempts =
                        normalizeNonNegativeInteger(
                            existing.attempts,
                            0,
                            "Schedule attempts"
                        );

                    const maxAttempts =
                        normalizePositiveInteger(
                            existing.maxAttempts,
                            settings.maxAttempts,
                            "Maximum schedule attempts"
                        );

                    const retryable =
                        isRetryableScheduleError(
                            error,
                            settings
                        );

                    const retryScheduled =
                        retryable &&
                        attempts <
                        maxAttempts;

                    const retryDelayMs =
                        retryScheduled
                            ? resolveRetryDelay(
                                  attempts,
                                  error,
                                  settings
                              )
                            : 0;

                    const update = {
                        status:
                            retryScheduled
                                ? SCHEDULE_STATUSES
                                      .active
                                : SCHEDULE_STATUSES
                                      .failed,

                        lastError:
                            serializeScheduleError(
                                error
                            ),

                        nextRunAt:
                            retryScheduled
                                ? createDatabaseTimestamp(
                                      runtime,
                                      now +
                                      retryDelayMs
                                  )
                                : existing
                                      .nextRunAt,

                        failedAt:
                            retryScheduled
                                ? null
                                : createDatabaseTimestamp(
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
                        update,
                        {
                            retryScheduled:
                                retryScheduled,

                            retryDelayMs:
                                retryDelayMs
                        }
                    );
                }
            );

    logScheduleEvent(
        runtime,
        record,
        record.retryScheduled
            ? "retry-scheduled"
            : "failed",
        settings
    );

    return {
        failed:
            !record.retryScheduled,

        retryScheduled:
            Boolean(
                record.retryScheduled
            ),

        retryDelayMs:
            record.retryDelayMs ||
            0,

        disabled:
            false,

        scheduleId:
            id,

        schedule:
            sanitizeScheduleRecord(
                record
            )
    };
}

/* ==========================================================
   PAUSE, RESUME, CANCEL
========================================================== */

function pauseSchedule(
    runtime,
    scheduleId,
    reason,
    options
) {
    return setScheduleStatus(
        runtime,
        scheduleId,
        SCHEDULE_STATUSES.paused,
        {
            pauseReason:
                normalizeOptionalString(
                    reason
                )
        },
        options
    );
}

function resumeSchedule(
    runtime,
    scheduleId,
    options
) {
    return setScheduleStatus(
        runtime,
        scheduleId,
        SCHEDULE_STATUSES.active,
        {
            pauseReason:
                null
        },
        options
    );
}

function cancelSchedule(
    runtime,
    scheduleId,
    reason,
    options
) {
    return setScheduleStatus(
        runtime,
        scheduleId,
        SCHEDULE_STATUSES.cancelled,
        {
            cancellationReason:
                normalizeOptionalString(
                    reason
                )
        },
        options
    );
}

async function setScheduleStatus(
    runtime,
    scheduleId,
    status,
    details,
    options
) {
    const settings =
        normalizeSchedulerOptions(
            options
        );

    const id =
        normalizeScheduleId(
            scheduleId
        );

    const normalizedStatus =
        normalizeScheduleStatus(
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

            scheduleId:
                id,

            status:
                normalizedStatus
        };
    }

    assertSchedulerRuntime(
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
                        throw createScheduleNotFoundError(
                            id
                        );
                    }

                    const existing =
                        snapshot.data();

                    assertValidScheduleStatusChange(
                        existing.status,
                        normalizedStatus
                    );

                    const update = {
                        status:
                            normalizedStatus,

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

                    if (
                        normalizedStatus ===
                        SCHEDULE_STATUSES.active
                    ) {
                        update.nextRunAt =
                            createDatabaseTimestamp(
                                runtime,
                                calculateResumeRunAt(
                                    existing,
                                    now
                                )
                            );
                    }

                    if (
                        normalizedStatus ===
                        SCHEDULE_STATUSES.paused
                    ) {
                        update.pausedAt =
                            createDatabaseTimestamp(
                                runtime,
                                now
                            );

                        update.pauseReason =
                            details.pauseReason;
                    }

                    if (
                        normalizedStatus ===
                        SCHEDULE_STATUSES.cancelled
                    ) {
                        update.cancelledAt =
                            createDatabaseTimestamp(
                                runtime,
                                now
                            );

                        update.cancellationReason =
                            details.cancellationReason;
                    }

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

    logScheduleEvent(
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

        scheduleId:
            id,

        status:
            normalizedStatus,

        schedule:
            sanitizeScheduleRecord(
                record
            )
    };
}

function assertValidScheduleStatusChange(
    currentStatus,
    nextStatus
) {
    const current =
        normalizeScheduleStatus(
            currentStatus
        );

    const next =
        normalizeScheduleStatus(
            nextStatus
        );

    if (
        current === next
    ) {
        return true;
    }

    if (
        TERMINAL_SCHEDULE_STATUSES
            .includes(
                current
            )
    ) {
        throw new ServiceError(
            "failed-precondition",
            "A terminal schedule cannot change status.",
            {
                status:
                    409,

                expose:
                    true
            }
        );
    }

    const allowed = {
        active: [
            "paused",
            "cancelled"
        ],

        processing: [
            "paused",
            "cancelled"
        ],

        paused: [
            "active",
            "cancelled"
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
            "The schedule status transition is invalid.",
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
   GET
========================================================== */

async function getSchedule(
    runtime,
    scheduleId,
    options
) {
    const settings =
        normalizeSchedulerOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return null;
    }

    assertSchedulerRuntime(
        runtime
    );

    const id =
        normalizeScheduleId(
            scheduleId
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

    return sanitizeScheduleRecord(
        snapshot.data()
    );
}

/* ==========================================================
   QUERY
========================================================== */

async function querySchedules(
    runtime,
    filters,
    options
) {
    const settings =
        normalizeSchedulerOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return [];
    }

    assertSchedulerRuntime(
        runtime
    );

    const normalized =
        normalizeScheduleQuery(
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
        normalized.nextRunBefore
    ) {
        query =
            query.where(
                "nextRunAt",
                "<=",
                createDatabaseTimestamp(
                    runtime,
                    normalized
                        .nextRunBefore
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
        function (
            document
        ) {
            return sanitizeScheduleRecord(
                document.data()
            );
        }
    );
}

function normalizeScheduleQuery(
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
                ? normalizeScheduleStatus(
                      source.status
                  )
                : null,

        type:
            source.type
                ? normalizeScheduleType(
                      source.type
                  )
                : null,

        name:
            source.name
                ? normalizeScheduleName(
                      source.name
                  )
                : null,

        workerId:
            normalizeOptionalString(
                source.workerId
            ),

        nextRunBefore:
            source.nextRunBefore !==
            undefined
                ? normalizeScheduleDate(
                      source.nextRunBefore,
                      "Schedule next-run filter"
                  )
                : null,

        createdAfter:
            source.createdAfter !==
            undefined
                ? normalizeScheduleDate(
                      source.createdAfter,
                      "Schedule creation filter"
                  )
                : null,

        orderBy:
            normalizeScheduleOrderField(
                source.orderBy
            ),

        direction:
            String(
                source.direction ||
                "asc"
            ).toLowerCase() ===
            "desc"
                ? "desc"
                : "asc",

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

function normalizeScheduleRecord(
    schedule,
    options,
    runtime
) {
    const source =
        schedule || {};

    if (
        typeof source !==
            "object" ||
        Array.isArray(source)
    ) {
        throw new TypeError(
            "Schedule must be an object."
        );
    }

    const settings =
        normalizeSchedulerOptions(
            options
        );

    const now =
        resolveNow(
            runtime,
            settings
        );

    const type =
        normalizeScheduleType(
            source.type ||
            (
                source.intervalMs
                    ? SCHEDULE_TYPES
                          .interval
                    : SCHEDULE_TYPES
                          .once
            )
        );

    const intervalMs =
        type ===
        SCHEDULE_TYPES.interval
            ? normalizePositiveInteger(
                  source.intervalMs,
                  settings.defaultIntervalMs,
                  "Schedule interval"
              )
            : null;

    const firstRunAt =
        source.nextRunAt !==
            undefined &&
        source.nextRunAt !==
            null
            ? normalizeScheduleDate(
                  source.nextRunAt,
                  "Schedule next run"
              )
            : source.runAt !==
                  undefined &&
              source.runAt !==
                  null
              ? normalizeScheduleDate(
                    source.runAt,
                    "Schedule run time"
                )
              : now;

    const payload =
        cloneValue(
            source.payload ||
            source.data ||
            {}
        );

    assertSerializableScheduleValue(
        payload,
        settings.maxPayloadBytes,
        "Schedule payload"
    );

    const id =
        source.id
            ? normalizeScheduleId(
                  source.id
              )
            : createScheduleId(
                  source,
                  settings,
                  now
              );

    const name =
        normalizeScheduleName(
            source.name ||
            source.task ||
            source.handler
        );

    const fingerprint =
        createScheduleFingerprint({
            name:
                name,

            type:
                type,

            intervalMs:
                intervalMs,

            nextRunAt:
                firstRunAt,

            payload:
                payload
        });

    return {
        id:
            id,

        fingerprint:
            fingerprint,

        name:
            name,

        type:
            type,

        status:
            SCHEDULE_STATUSES
                .active,

        timezone:
            normalizeTimezone(
                source.timezone ||
                settings.defaultTimezone
            ),

        intervalMs:
            intervalMs,

        payload:
            payload,

        metadata:
            sanitizeScheduleMetadata(
                source.metadata
            ),

        tags:
            normalizeScheduleTags(
                source.tags
            ),

        runCount:
            0,

        maxRuns:
            normalizeOptionalPositiveInteger(
                source.maxRuns,
                "Maximum schedule runs"
            ),

        attempts:
            0,

        maxAttempts:
            normalizePositiveInteger(
                source.maxAttempts,
                settings.maxAttempts,
                "Maximum schedule attempts"
            ),

        workerId:
            null,

        leaseToken:
            null,

        lastResult:
            null,

        lastError:
            null,

        pauseReason:
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

        nextRunAt:
            createDatabaseTimestamp(
                runtime,
                firstRunAt
            ),

        lastRunAt:
            null,

        claimedAt:
            null,

        leaseExpiresAt:
            null,

        pausedAt:
            null,

        completedAt:
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
   SCHEDULE CALCULATIONS
========================================================== */

function calculateNextRunAt(
    schedule,
    now
) {
    const type =
        normalizeScheduleType(
            schedule.type
        );

    if (
        type ===
        SCHEDULE_TYPES.once
    ) {
        return null;
    }

    const intervalMs =
        normalizePositiveInteger(
            schedule.intervalMs,
            DEFAULT_INTERVAL_MS,
            "Schedule interval"
        );

    const previousRun =
        toMilliseconds(
            schedule.nextRunAt
        ) ||
        Number(now);

    let next =
        previousRun +
        intervalMs;

    while (
        next <=
        Number(now)
    ) {
        next +=
            intervalMs;
    }

    return next;
}

function calculateResumeRunAt(
    schedule,
    now
) {
    const nextRunAt =
        toMilliseconds(
            schedule.nextRunAt
        );

    if (
        nextRunAt >
        Number(now)
    ) {
        return nextRunAt;
    }

    if (
        normalizeScheduleType(
            schedule.type
        ) ===
        SCHEDULE_TYPES.once
    ) {
        return Number(now);
    }

    return (
        calculateNextRunAt(
            schedule,
            now
        ) ||
        Number(now)
    );
}

function shouldCompleteSchedule(
    schedule,
    nextRunCount
) {
    if (
        normalizeScheduleType(
            schedule.type
        ) ===
        SCHEDULE_TYPES.once
    ) {
        return true;
    }

    const maxRuns =
        normalizeOptionalPositiveInteger(
            schedule.maxRuns,
            "Maximum schedule runs"
        );

    return (
        maxRuns !== null &&
        nextRunCount >=
        maxRuns
    );
}

/* ==========================================================
   OWNERSHIP
========================================================== */

function assertScheduleOwnership(
    schedule,
    workerId,
    leaseToken
) {
    if (
        normalizeScheduleStatus(
            schedule.status
        ) !==
        SCHEDULE_STATUSES.processing
    ) {
        throw new ServiceError(
            "failed-precondition",
            "The schedule is not currently being processed.",
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
            schedule.workerId ||
            ""
        ) !==
        String(
            workerId ||
            ""
        )
    ) {
        throw new ServiceError(
            "permission-denied",
            "The worker does not own this schedule lease.",
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
            schedule.leaseToken ||
            ""
        ) !==
        String(
            leaseToken
        )
    ) {
        throw new ServiceError(
            "aborted",
            "The schedule lease token is no longer valid.",
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
   RETRY
========================================================== */

function isRetryableScheduleError(
    error,
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
                error
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

    return settings.retryFailed !==
        false;
}

function resolveRetryDelay(
    attempts,
    error,
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
                error
            ),
            settings.retryDelayMs,
            "Schedule retry delay"
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
        Math.round(delay),
        settings.maxRetryDelayMs
    );
}

/* ==========================================================
   SANITIZATION
========================================================== */

function sanitizeScheduleRecord(
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

        name:
            normalizeScheduleName(
                record.name
            ),

        type:
            normalizeScheduleType(
                record.type
            ),

        status:
            normalizeScheduleStatus(
                record.status
            ),

        timezone:
            normalizeTimezone(
                record.timezone
            ),

        intervalMs:
            record.intervalMs ===
            null
                ? null
                : normalizePositiveInteger(
                      record.intervalMs,
                      DEFAULT_INTERVAL_MS,
                      "Schedule interval"
                  ),

        payload:
            cloneValue(
                record.payload
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

        runCount:
            normalizeNonNegativeInteger(
                record.runCount,
                0,
                "Schedule run count"
            ),

        maxRuns:
            normalizeOptionalPositiveInteger(
                record.maxRuns,
                "Maximum schedule runs"
            ),

        attempts:
            normalizeNonNegativeInteger(
                record.attempts,
                0,
                "Schedule attempts"
            ),

        maxAttempts:
            normalizePositiveInteger(
                record.maxAttempts,
                DEFAULT_MAX_ATTEMPTS,
                "Maximum schedule attempts"
            ),

        workerId:
            record.workerId ||
            null,

        leaseToken:
            record.leaseToken ||
            null,

        lastResult:
            cloneValue(
                record.lastResult
            ),

        lastError:
            cloneValue(
                record.lastError
            ),

        pauseReason:
            record.pauseReason ||
            null,

        cancellationReason:
            record
                .cancellationReason ||
            null,

        createdAt:
            serializeTimestamp(
                record.createdAt
            ),

        updatedAt:
            serializeTimestamp(
                record.updatedAt
            ),

        nextRunAt:
            serializeTimestamp(
                record.nextRunAt
            ),

        lastRunAt:
            serializeTimestamp(
                record.lastRunAt
            ),

        claimedAt:
            serializeTimestamp(
                record.claimedAt
            ),

        leaseExpiresAt:
            serializeTimestamp(
                record.leaseExpiresAt
            ),

        pausedAt:
            serializeTimestamp(
                record.pausedAt
            ),

        completedAt:
            serializeTimestamp(
                record.completedAt
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

/* ==========================================================
   NORMALIZERS
========================================================== */

function normalizeScheduleId(
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
            "The schedule ID is invalid.",
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

function normalizeScheduleName(
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
            "The schedule name is invalid.",
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

function normalizeScheduleType(
    value
) {
    const normalized =
        String(
            value ||
            SCHEDULE_TYPES.once
        )
            .trim()
            .toLowerCase();

    if (
        !Object.values(
            SCHEDULE_TYPES
        ).includes(
            normalized
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The schedule type is invalid.",
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

function normalizeScheduleStatus(
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
            SCHEDULE_STATUSES
        ).includes(
            normalized
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The schedule status is invalid.",
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

function normalizeWorkerId(
    value
) {
    const normalized =
        String(
            value || ""
        ).trim();

    if (!normalized) {
        throw new ServiceError(
            "invalid-argument",
            "A scheduler worker ID is required.",
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

function normalizeTimezone(
    value
) {
    const normalized =
        String(
            value ||
            DEFAULT_TIMEZONE
        ).trim();

    return normalized ||
        DEFAULT_TIMEZONE;
}

function normalizeScheduleTags(
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
                .filter(Boolean)
        )
    ).slice(
        0,
        100
    );
}

function normalizeScheduleDate(
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

function normalizeScheduleOrderField(
    value
) {
    const allowed =
        new Set([
            "createdAt",
            "updatedAt",
            "nextRunAt",
            "lastRunAt",
            "runCount",
            "attempts",
            "completedAt",
            "failedAt"
        ]);

    const normalized =
        String(
            value ||
            "nextRunAt"
        ).trim();

    return allowed.has(
        normalized
    )
        ? normalized
        : "nextRunAt";
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
            "Schedule query limit must be a positive integer."
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
        normalized <= 0
    ) {
        throw new TypeError(
            label +
            " must be a positive number."
        );
    }

    return normalized;
}

function normalizeOptionalPositiveInteger(
    value,
    label
) {
    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {
        return null;
    }

    return normalizePositiveInteger(
        value,
        null,
        label
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
            "Schedule collection must be a Firestore collection name."
        );
    }

    return collection;
}

/* ==========================================================
   OPTIONS
========================================================== */

function normalizeSchedulerOptions(
    options
) {
    const settings =
        options || {};

    const retryDelayMs =
        normalizeNonNegativeInteger(
            settings.retryDelayMs,
            DEFAULT_RETRY_DELAY_MS,
            "Schedule retry delay"
        );

    return {
        runtime:
            settings.runtime,

        collection:
            normalizeCollection(
                settings.collection ||
                SCHEDULE_COLLECTION
            ),

        defaultTimezone:
            normalizeTimezone(
                settings.defaultTimezone ||
                DEFAULT_TIMEZONE
            ),

        defaultIntervalMs:
            normalizePositiveInteger(
                settings.defaultIntervalMs,
                DEFAULT_INTERVAL_MS,
                "Default schedule interval"
            ),

        leaseMs:
            normalizePositiveInteger(
                settings.leaseMs,
                DEFAULT_LEASE_MS,
                "Schedule lease duration"
            ),

        retryDelayMs:
            retryDelayMs,

        maxRetryDelayMs:
            normalizePositiveInteger(
                settings.maxRetryDelayMs,
                DEFAULT_MAX_RETRY_DELAY_MS,
                "Maximum schedule retry delay"
            ),

        retryBackoffMultiplier:
            normalizePositiveNumber(
                settings.retryBackoffMultiplier,
                2,
                "Schedule retry backoff multiplier"
            ),

        retryFailed:
            settings.retryFailed !==
            false,

        maxAttempts:
            normalizePositiveInteger(
                settings.maxAttempts,
                DEFAULT_MAX_ATTEMPTS,
                "Maximum schedule attempts"
            ),

        queryLimit:
            normalizeQueryLimit(
                settings.queryLimit
            ),

        claimBatchSize:
            normalizePositiveInteger(
                settings.claimBatchSize,
                DEFAULT_CLAIM_BATCH_SIZE,
                "Schedule claim batch size"
            ),

        retentionMs:
            normalizeNonNegativeInteger(
                settings.retentionMs,
                DEFAULT_RETENTION_MS,
                "Schedule retention"
            ),

        maxPayloadBytes:
            normalizePositiveInteger(
                settings.maxPayloadBytes,
                DEFAULT_MAX_PAYLOAD_BYTES,
                "Maximum schedule payload size"
            ),

        maxResultBytes:
            normalizePositiveInteger(
                settings.maxResultBytes,
                DEFAULT_MAX_RESULT_BYTES,
                "Maximum schedule result size"
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

        retryResolver:
            settings.retryResolver,

        retryDelayResolver:
            settings.retryDelayResolver,

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

function createScheduleId(
    schedule,
    options,
    now
) {
    const settings =
        options || {};

    if (
        typeof settings.idResolver ===
        "function"
    ) {
        return normalizeScheduleId(
            settings.idResolver(
                schedule
            )
        );
    }

    if (
        schedule &&
        schedule.idempotencyKey
    ) {
        return hashScheduleValue(
            schedule.idempotencyKey
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

function generateLeaseToken() {
    if (
        typeof crypto.randomUUID ===
        "function"
    ) {
        return crypto.randomUUID();
    }

    return crypto
        .randomBytes(24)
        .toString("hex");
}

function createScheduleFingerprint(
    value
) {
    return hashScheduleValue(
        stableStringify(
            value
        )
    );
}

function hashScheduleValue(
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
            "Schedule data contains a circular reference.",
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

function assertSerializableScheduleValue(
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

function sanitizeScheduleMetadata(
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

function serializeScheduleError(
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
            "schedule-failed",

        message:
            error.publicMessage ||
            error.message ||
            "Schedule execution failed.",

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

function createScheduleNotFoundError(
    scheduleId
) {
    return new ServiceError(
        "not-found",
        "The schedule was not found.",
        {
            status:
                404,

            expose:
                true,

            details: {
                scheduleId:
                    scheduleId
            }
        }
    );
}

function createScheduleConflictError(
    scheduleId,
    options
) {
    const settings =
        options || {};

    return new ServiceError(
        "already-exists",
        "A schedule with this ID already exists.",
        {
            status:
                409,

            expose:
                true,

            retryable:
                false,

            details: {
                scheduleId:
                    scheduleId
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

function assertSchedulerRuntime(
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
            "The scheduler datastore is unavailable.",
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
            "Firestore transactions are required for schedules.",
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
   DATA
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

/* ==========================================================
   LOGGING
========================================================== */

function logScheduleEvent(
    runtime,
    schedule,
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

        scheduleId:
            schedule &&
            schedule.id,

        name:
            schedule &&
            schedule.name,

        type:
            schedule &&
            schedule.type,

        status:
            schedule &&
            schedule.status,

        runCount:
            schedule &&
            schedule.runCount,

        attempts:
            schedule &&
            schedule.attempts,

        workerId:
            schedule &&
            schedule.workerId
    };

    if (
        event ===
            "failed" &&
        typeof runtime.logger.error ===
            "function"
    ) {
        runtime.logger.error(
            "Schedule failed.",
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
            "Schedule retry scheduled.",
            metadata
        );

        return;
    }

    if (
        typeof runtime.logger.info ===
        "function"
    ) {
        runtime.logger.info(
            "Schedule event.",
            metadata
        );
    } else if (
        typeof runtime.logger.debug ===
        "function"
    ) {
        runtime.logger.debug(
            "Schedule event.",
            metadata
        );
    }
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    createSchedulerService,
    createSchedule,
    updateSchedule,
    normalizeScheduleUpdate,
    claimNextSchedule,
    loadScheduleCandidates,
    claimSchedule,
    isScheduleClaimable,
    compareScheduleCandidates,
    completeScheduleExecution,
    failScheduleExecution,
    pauseSchedule,
    resumeSchedule,
    cancelSchedule,
    setScheduleStatus,
    assertValidScheduleStatusChange,
    getSchedule,
    querySchedules,
    normalizeScheduleQuery,
    normalizeScheduleRecord,
    calculateNextRunAt,
    calculateResumeRunAt,
    shouldCompleteSchedule,
    assertScheduleOwnership,
    isRetryableScheduleError,
    resolveRetryDelay,
    sanitizeScheduleRecord,
    normalizeScheduleId,
    normalizeScheduleName,
    normalizeScheduleType,
    normalizeScheduleStatus,
    normalizeWorkerId,
    normalizeTimezone,
    normalizeScheduleTags,
    normalizeScheduleDate,
    normalizeScheduleOrderField,
    normalizeQueryLimit,
    normalizePositiveInteger,
    normalizeNonNegativeInteger,
    normalizePositiveNumber,
    normalizeOptionalPositiveInteger,
    normalizeOptionalString,
    normalizeCollection,
    normalizeSchedulerOptions,
    createScheduleId,
    generateLeaseToken,
    createScheduleFingerprint,
    hashScheduleValue,
    stableStringify,
    normalizeStableValue,
    assertSerializableScheduleValue,
    sanitizeScheduleMetadata,
    serializeScheduleError,
    createScheduleNotFoundError,
    createScheduleConflictError,
    assertSchedulerRuntime,
    resolveNow,
    createDatabaseTimestamp,
    toMilliseconds,
    serializeTimestamp,
    logScheduleEvent,
    constants: {
        SCHEDULE_COLLECTION,
        DEFAULT_STATUS,
        DEFAULT_TIMEZONE,
        DEFAULT_INTERVAL_MS,
        DEFAULT_LEASE_MS,
        DEFAULT_RETRY_DELAY_MS,
        DEFAULT_MAX_RETRY_DELAY_MS,
        DEFAULT_MAX_ATTEMPTS,
        DEFAULT_QUERY_LIMIT,
        MAX_QUERY_LIMIT,
        DEFAULT_RETENTION_MS,
        DEFAULT_CLAIM_BATCH_SIZE,
        DEFAULT_MAX_PAYLOAD_BYTES,
        DEFAULT_MAX_RESULT_BYTES,
        SCHEDULE_STATUSES,
        SCHEDULE_TYPES,
        TERMINAL_SCHEDULE_STATUSES
    }
};