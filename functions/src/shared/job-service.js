"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   JOB SERVICE

   Responsibilities:
   - Queue background jobs in Firestore
   - Claim jobs atomically for workers
   - Track attempts, leases, retries, and failures
   - Support scheduled execution
   - Complete, fail, cancel, inspect, and query jobs
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

const JOB_COLLECTION =
    "_jobs";

const DEFAULT_QUEUE =
    "default";

const DEFAULT_STATUS =
    "pending";

const DEFAULT_PRIORITY =
    "normal";

const DEFAULT_MAX_ATTEMPTS =
    5;

const DEFAULT_LEASE_MS =
    5 * 60 * 1000;

const DEFAULT_RETRY_DELAY_MS =
    30 * 1000;

const DEFAULT_RETENTION_MS =
    30 * 24 * 60 * 60 * 1000;

const DEFAULT_QUERY_LIMIT =
    100;

const MAX_QUERY_LIMIT =
    500;

const DEFAULT_MAX_PAYLOAD_BYTES =
    500000;

const DEFAULT_MAX_RESULT_BYTES =
    500000;

const JOB_STATUSES =
    Object.freeze({
        pending:
            "pending",

        processing:
            "processing",

        completed:
            "completed",

        failed:
            "failed",

        cancelled:
            "cancelled"
    });

const JOB_PRIORITIES =
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

const TERMINAL_JOB_STATUSES =
    Object.freeze([
        JOB_STATUSES.completed,
        JOB_STATUSES.failed,
        JOB_STATUSES.cancelled
    ]);

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

/* ==========================================================
   SERVICE FACTORY
========================================================== */

function createJobService(
    options
) {
    const settings =
        normalizeJobOptions(
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

        enqueue:
            function (
                job,
                overrides
            ) {
                return enqueueJob(
                    runtime,
                    job,
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
                return claimNextJob(
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
                jobId,
                workerId,
                result,
                overrides
            ) {
                return completeJob(
                    runtime,
                    jobId,
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
                jobId,
                workerId,
                error,
                overrides
            ) {
                return failJob(
                    runtime,
                    jobId,
                    workerId,
                    error,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        cancel:
            function (
                jobId,
                reason,
                overrides
            ) {
                return cancelJob(
                    runtime,
                    jobId,
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
                jobId,
                overrides
            ) {
                return getJob(
                    runtime,
                    jobId,
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
                return queryJobs(
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
   ENQUEUE
========================================================== */

async function enqueueJob(
    runtime,
    job,
    options
) {
    const settings =
        normalizeJobOptions(
            options
        );

    const record =
        normalizeJobRecord(
            job,
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

            jobId:
                record.id,

            job:
                sanitizeJobRecord(
                    record
                )
        };
    }

    assertJobRuntime(
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
            ? await enqueueUniqueJob(
                  runtime,
                  reference,
                  record,
                  settings
              )
            : await storeJob(
                  reference,
                  record
              );

    logJobEvent(
        runtime,
        result.job ||
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

        jobId:
            record.id,

        job:
            sanitizeJobRecord(
                result.job ||
                record
            )
    };
}

async function enqueueUniqueJob(
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
        return storeJob(
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

                            job:
                                existing
                        };
                    }

                    throw createJobConflictError(
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

                    job:
                        record
                };
            }
        );
}

async function storeJob(
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

        job:
            record
    };
}

/* ==========================================================
   CLAIM
========================================================== */

async function claimNextJob(
    runtime,
    workerId,
    options
) {
    const settings =
        normalizeJobOptions(
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

    assertJobRuntime(
        runtime
    );

    const now =
        resolveNow(
            runtime,
            settings
        );

    const candidates =
        await loadJobCandidates(
            runtime,
            settings,
            now
        );

    const ordered =
        candidates
            .map(
                function (record) {
                    return sanitizeClaimCandidate(
                        record
                    );
                }
            )
            .filter(
                function (record) {
                    return isJobClaimable(
                        record,
                        now,
                        settings
                    );
                }
            )
            .sort(
                compareJobCandidates
            );

    for (
        const candidate of
        ordered
    ) {
        const claimed =
            await claimJob(
                runtime,
                candidate.id,
                normalizedWorkerId,
                settings
            );

        if (claimed) {
            return claimed;
        }
    }

    return null;
}

async function loadJobCandidates(
    runtime,
    options,
    now
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
                "queue",
                "==",
                settings.queue
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
        function (document) {
            return Object.assign(
                {},
                document.data(),
                {
                    id:
                        document.data().id ||
                        document.id
                }
            );
        }
    );
}

async function claimJob(
    runtime,
    jobId,
    workerId,
    options
) {
    const settings =
        normalizeJobOptions(
            options
        );

    const id =
        normalizeJobId(
            jobId
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

    if (
        typeof runtime.db
            .runTransaction !==
        "function"
    ) {
        throw new ServiceError(
            "configuration-error",
            "Firestore transactions are required to claim jobs.",
            {
                status:
                    500,

                expose:
                    false
            }
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
                    !snapshot.exists
                ) {
                    return null;
                }

                const existing =
                    snapshot.data();

                if (
                    !isJobClaimable(
                        existing,
                        now,
                        settings
                    )
                ) {
                    return null;
                }

                const leaseToken =
                    generateLeaseToken();

                const attempts =
                    normalizeNonNegativeInteger(
                        existing.attempts,
                        0,
                        "Job attempts"
                    ) +
                    1;

                const update = {
                    status:
                        JOB_STATUSES
                            .processing,

                    workerId:
                        normalizedWorkerId,

                    leaseToken:
                        leaseToken,

                    attempts:
                        attempts,

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
                        ),

                    lastError:
                        null
                };

                transaction.set(
                    reference,
                    update,
                    {
                        merge:
                            true
                    }
                );

                const claimed =
                    Object.assign(
                        {},
                        existing,
                        update
                    );

                logJobEvent(
                    runtime,
                    claimed,
                    "claimed",
                    settings
                );

                return sanitizeJobRecord(
                    claimed
                );
            }
        );
}

function isJobClaimable(
    job,
    now,
    options
) {
    const settings =
        options || {};

    if (!job) {
        return false;
    }

    const status =
        normalizeJobStatus(
            job.status
        );

    const attempts =
        normalizeNonNegativeInteger(
            job.attempts,
            0,
            "Job attempts"
        );

    const maxAttempts =
        normalizePositiveInteger(
            job.maxAttempts,
            settings.maxAttempts ||
            DEFAULT_MAX_ATTEMPTS,
            "Maximum job attempts"
        );

    if (
        attempts >=
        maxAttempts
    ) {
        return false;
    }

    const scheduledAt =
        toMilliseconds(
            job.scheduledAt
        );

    if (
        scheduledAt &&
        scheduledAt >
        now
    ) {
        return false;
    }

    if (
        status ===
        JOB_STATUSES.pending
    ) {
        return true;
    }

    if (
        status ===
        JOB_STATUSES.processing
    ) {
        const leaseExpiresAt =
            toMilliseconds(
                job.leaseExpiresAt
            );

        return (
            !leaseExpiresAt ||
            leaseExpiresAt <=
            now
        );
    }

    return false;
}

function compareJobCandidates(
    first,
    second
) {
    const firstPriority =
        PRIORITY_WEIGHTS[
            normalizeJobPriority(
                first.priority
            )
        ];

    const secondPriority =
        PRIORITY_WEIGHTS[
            normalizeJobPriority(
                second.priority
            )
        ];

    if (
        firstPriority !==
        secondPriority
    ) {
        return (
            secondPriority -
            firstPriority
        );
    }

    const firstSchedule =
        toMilliseconds(
            first.scheduledAt
        );

    const secondSchedule =
        toMilliseconds(
            second.scheduledAt
        );

    if (
        firstSchedule !==
        secondSchedule
    ) {
        return (
            firstSchedule -
            secondSchedule
        );
    }

    const firstCreated =
        toMilliseconds(
            first.createdAt
        );

    const secondCreated =
        toMilliseconds(
            second.createdAt
        );

    return (
        firstCreated -
        secondCreated
    );
}

function sanitizeClaimCandidate(
    record
) {
    return Object.assign(
        {},
        record || {},
        {
            id:
                normalizeJobId(
                    record &&
                    record.id
                ),

            queue:
                normalizeQueueName(
                    record &&
                    record.queue
                ),

            status:
                normalizeJobStatus(
                    record &&
                    record.status
                ),

            priority:
                normalizeJobPriority(
                    record &&
                    record.priority
                )
        }
    );
}

/* ==========================================================
   COMPLETE
========================================================== */

async function completeJob(
    runtime,
    jobId,
    workerId,
    result,
    options
) {
    const settings =
        normalizeJobOptions(
            options
        );

    const id =
        normalizeJobId(
            jobId
        );

    const normalizedWorkerId =
        normalizeWorkerId(
            workerId
        );

    assertSerializableJobValue(
        result,
        settings.maxResultBytes,
        "Job result"
    );

    if (
        settings.disabled
    ) {
        return {
            completed:
                false,

            disabled:
                true,

            jobId:
                id
        };
    }

    assertJobRuntime(
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
                        throw createJobNotFoundError(
                            id
                        );
                    }

                    const existing =
                        snapshot.data();

                    assertJobOwnership(
                        existing,
                        normalizedWorkerId,
                        settings.leaseToken
                    );

                    const update = {
                        status:
                            JOB_STATUSES
                                .completed,

                        result:
                            cloneValue(
                                result
                            ),

                        completedAt:
                            createDatabaseTimestamp(
                                runtime,
                                now
                            ),

                        updatedAt:
                            createDatabaseTimestamp(
                                runtime,
                                now
                            ),

                        leaseExpiresAt:
                            null,

                        leaseToken:
                            null
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

    logJobEvent(
        runtime,
        record,
        "completed",
        settings
    );

    return {
        completed:
            true,

        disabled:
            false,

        jobId:
            id,

        job:
            sanitizeJobRecord(
                record
            )
    };
}

/* ==========================================================
   FAIL
========================================================== */

async function failJob(
    runtime,
    jobId,
    workerId,
    error,
    options
) {
    const settings =
        normalizeJobOptions(
            options
        );

    const id =
        normalizeJobId(
            jobId
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

            jobId:
                id
        };
    }

    assertJobRuntime(
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
                        throw createJobNotFoundError(
                            id
                        );
                    }

                    const existing =
                        snapshot.data();

                    assertJobOwnership(
                        existing,
                        normalizedWorkerId,
                        settings.leaseToken
                    );

                    const attempts =
                        normalizeNonNegativeInteger(
                            existing.attempts,
                            0,
                            "Job attempts"
                        );

                    const maxAttempts =
                        normalizePositiveInteger(
                            existing.maxAttempts,
                            settings.maxAttempts,
                            "Maximum job attempts"
                        );

                    const retryable =
                        isRetryableJobError(
                            error,
                            settings
                        );

                    const retryScheduled =
                        retryable &&
                        attempts <
                        maxAttempts;

                    const delayMs =
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
                                ? JOB_STATUSES
                                      .pending
                                : JOB_STATUSES
                                      .failed,

                        lastError:
                            serializeJobError(
                                error
                            ),

                        failedAt:
                            retryScheduled
                                ? null
                                : createDatabaseTimestamp(
                                      runtime,
                                      now
                                  ),

                        scheduledAt:
                            retryScheduled
                                ? createDatabaseTimestamp(
                                      runtime,
                                      now +
                                      delayMs
                                  )
                                : existing
                                      .scheduledAt,

                        updatedAt:
                            createDatabaseTimestamp(
                                runtime,
                                now
                            ),

                        leaseExpiresAt:
                            null,

                        leaseToken:
                            null,

                        workerId:
                            retryScheduled
                                ? null
                                : normalizedWorkerId
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
                                delayMs
                        }
                    );
                }
            );

    logJobEvent(
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

        jobId:
            id,

        job:
            sanitizeJobRecord(
                record
            )
    };
}

/* ==========================================================
   CANCEL
========================================================== */

async function cancelJob(
    runtime,
    jobId,
    reason,
    options
) {
    const settings =
        normalizeJobOptions(
            options
        );

    const id =
        normalizeJobId(
            jobId
        );

    if (
        settings.disabled
    ) {
        return {
            cancelled:
                false,

            disabled:
                true,

            jobId:
                id
        };
    }

    assertJobRuntime(
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
                        throw createJobNotFoundError(
                            id
                        );
                    }

                    const existing =
                        snapshot.data();

                    if (
                        TERMINAL_JOB_STATUSES
                            .includes(
                                normalizeJobStatus(
                                    existing.status
                                )
                            )
                    ) {
                        throw new ServiceError(
                            "failed-precondition",
                            "A terminal job cannot be cancelled.",
                            {
                                status:
                                    409,

                                expose:
                                    true,

                                details: {
                                    jobId:
                                        id,

                                    status:
                                        existing
                                            .status
                                }
                            }
                        );
                    }

                    const update = {
                        status:
                            JOB_STATUSES
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
                            ),

                        leaseExpiresAt:
                            null,

                        leaseToken:
                            null
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

    logJobEvent(
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

        jobId:
            id,

        job:
            sanitizeJobRecord(
                record
            )
    };
}

/* ==========================================================
   GET
========================================================== */

async function getJob(
    runtime,
    jobId,
    options
) {
    const settings =
        normalizeJobOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return null;
    }

    assertJobRuntime(
        runtime
    );

    const id =
        normalizeJobId(
            jobId
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

    return sanitizeJobRecord(
        snapshot.data()
    );
}

/* ==========================================================
   QUERY
========================================================== */

async function queryJobs(
    runtime,
    filters,
    options
) {
    const settings =
        normalizeJobOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return [];
    }

    assertJobRuntime(
        runtime
    );

    const normalized =
        normalizeJobQuery(
            filters,
            settings
        );

    let query =
        runtime.db
            .collection(
                settings.collection
            );

    if (
        normalized.queue
    ) {
        query =
            query.where(
                "queue",
                "==",
                normalized.queue
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
            return sanitizeJobRecord(
                document.data()
            );
        }
    );
}

function normalizeJobQuery(
    filters,
    options
) {
    const source =
        filters || {};

    const settings =
        options || {};

    return {
        queue:
            source.queue
                ? normalizeQueueName(
                      source.queue
                  )
                : settings.queue,

        type:
            source.type
                ? normalizeJobType(
                      source.type
                  )
                : null,

        status:
            source.status
                ? normalizeJobStatus(
                      source.status
                  )
                : null,

        priority:
            source.priority
                ? normalizeJobPriority(
                      source.priority
                  )
                : null,

        workerId:
            normalizeOptionalString(
                source.workerId
            ),

        scheduledBefore:
            source.scheduledBefore !==
            undefined
                ? normalizeJobDate(
                      source.scheduledBefore,
                      "Job schedule filter"
                  )
                : null,

        createdAfter:
            source.createdAfter !==
            undefined
                ? normalizeJobDate(
                      source.createdAfter,
                      "Job creation filter"
                  )
                : null,

        orderBy:
            normalizeJobOrderField(
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

function normalizeJobRecord(
    job,
    options,
    runtime
) {
    const source =
        job || {};

    if (
        typeof source !==
            "object" ||
        Array.isArray(source)
    ) {
        throw new TypeError(
            "Job must be an object."
        );
    }

    const settings =
        normalizeJobOptions(
            options
        );

    const now =
        resolveNow(
            runtime,
            settings
        );

    const type =
        normalizeJobType(
            source.type ||
            source.name
        );

    const queue =
        normalizeQueueName(
            source.queue ||
            settings.queue
        );

    const payload =
        cloneValue(
            source.payload ||
            source.data ||
            {}
        );

    assertSerializableJobValue(
        payload,
        settings.maxPayloadBytes,
        "Job payload"
    );

    const scheduledAt =
        source.scheduledAt !==
        undefined &&
        source.scheduledAt !==
        null
            ? normalizeJobDate(
                  source.scheduledAt,
                  "Job schedule"
              )
            : now;

    const id =
        source.id
            ? normalizeJobId(
                  source.id
              )
            : createJobId(
                  source,
                  queue,
                  type,
                  settings,
                  now
              );

    const fingerprint =
        createJobFingerprint({
            queue:
                queue,

            type:
                type,

            payload:
                payload,

            scheduledAt:
                scheduledAt
        });

    return {
        id:
            id,

        fingerprint:
            fingerprint,

        queue:
            queue,

        type:
            type,

        status:
            JOB_STATUSES
                .pending,

        priority:
            normalizeJobPriority(
                source.priority ||
                settings.defaultPriority
            ),

        priorityWeight:
            PRIORITY_WEIGHTS[
                normalizeJobPriority(
                    source.priority ||
                    settings
                        .defaultPriority
                )
            ],

        payload:
            payload,

        result:
            null,

        metadata:
            sanitizeJobMetadata(
                source.metadata
            ),

        tags:
            normalizeJobTags(
                source.tags
            ),

        attempts:
            0,

        maxAttempts:
            normalizePositiveInteger(
                source.maxAttempts,
                settings.maxAttempts,
                "Maximum job attempts"
            ),

        workerId:
            null,

        leaseToken:
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
                scheduledAt
            ),

        claimedAt:
            null,

        leaseExpiresAt:
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
                      settings
                          .retentionMs
                  )
                : null,

        schemaVersion:
            1
    };
}

/* ==========================================================
   RECORD SANITIZATION
========================================================== */

function sanitizeJobRecord(
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

        queue:
            normalizeQueueName(
                record.queue
            ),

        type:
            normalizeJobType(
                record.type
            ),

        status:
            normalizeJobStatus(
                record.status
            ),

        priority:
            normalizeJobPriority(
                record.priority
            ),

        priorityWeight:
            Number(
                record.priorityWeight ||
                PRIORITY_WEIGHTS[
                    normalizeJobPriority(
                        record.priority
                    )
                ]
            ),

        payload:
            cloneValue(
                record.payload
            ),

        result:
            cloneValue(
                record.result
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
                "Job attempts"
            ),

        maxAttempts:
            normalizePositiveInteger(
                record.maxAttempts,
                DEFAULT_MAX_ATTEMPTS,
                "Maximum job attempts"
            ),

        workerId:
            record.workerId ||
            null,

        leaseToken:
            record.leaseToken ||
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

        claimedAt:
            serializeTimestamp(
                record.claimedAt
            ),

        leaseExpiresAt:
            serializeTimestamp(
                record.leaseExpiresAt
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
   OWNERSHIP
========================================================== */

function assertJobOwnership(
    job,
    workerId,
    leaseToken
) {
    if (
        normalizeJobStatus(
            job.status
        ) !==
        JOB_STATUSES.processing
    ) {
        throw new ServiceError(
            "failed-precondition",
            "The job is not currently being processed.",
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
            job.workerId || ""
        ) !==
        String(
            workerId || ""
        )
    ) {
        throw new ServiceError(
            "permission-denied",
            "The worker does not own this job lease.",
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
            job.leaseToken || ""
        ) !==
        String(
            leaseToken
        )
    ) {
        throw new ServiceError(
            "aborted",
            "The job lease token is no longer valid.",
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

function isRetryableJobError(
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
        typeof settings.retryDelayResolver ===
        "function"
    ) {
        return normalizeNonNegativeInteger(
            settings.retryDelayResolver(
                attempts,
                error
            ),
            settings.retryDelayMs,
            "Job retry delay"
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
   IDENTIFIERS
========================================================== */

function createJobId(
    job,
    queue,
    type,
    options,
    now
) {
    const settings =
        options || {};

    if (
        typeof settings.idResolver ===
        "function"
    ) {
        return normalizeJobId(
            settings.idResolver(
                job,
                queue,
                type
            )
        );
    }

    if (
        job &&
        job.idempotencyKey
    ) {
        return hashJobValue(
            [
                queue,
                type,
                job.idempotencyKey
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

function createJobFingerprint(
    value
) {
    return hashJobValue(
        stableStringify(
            value
        )
    );
}

function hashJobValue(
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
            "Job data contains a circular reference.",
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

function assertSerializableJobValue(
    value,
    maximumBytes,
    label
) {
    let serialized;

    try {
        serialized =
            stableStringify(
                value
            );
    } catch (error) {
        if (
            error instanceof
            ServiceError
        ) {
            throw error;
        }

        throw new ServiceError(
            "invalid-argument",
            label +
            " could not be serialized.",
            {
                status:
                    400,

                expose:
                    true
            }
        );
    }

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
   NORMALIZERS
========================================================== */

function normalizeJobId(
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
            "The job ID is invalid.",
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
            "A worker ID is required.",
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

function normalizeJobType(
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
            "The job type is invalid.",
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

function normalizeQueueName(
    value
) {
    const normalized =
        String(
            value ||
            DEFAULT_QUEUE
        )
            .trim()
            .toLowerCase()
            .replace(
                /[^a-z0-9._:-]/g,
                "-"
            );

    return normalized ||
        DEFAULT_QUEUE;
}

function normalizeJobStatus(
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
            JOB_STATUSES
        ).includes(
            normalized
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The job status is invalid.",
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

function normalizeJobPriority(
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
        JOB_PRIORITIES
    ).includes(
        normalized
    )
        ? normalized
        : DEFAULT_PRIORITY;
}

function normalizeJobTags(
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
        100
    );
}

function normalizeJobDate(
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

function normalizeJobOrderField(
    value
) {
    const allowed =
        new Set([
            "createdAt",
            "updatedAt",
            "scheduledAt",
            "priorityWeight",
            "attempts",
            "completedAt",
            "failedAt"
        ]);

    const normalized =
        String(
            value ||
            "scheduledAt"
        ).trim();

    return allowed.has(
        normalized
    )
        ? normalized
        : "scheduledAt";
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
            "Job query limit must be a positive integer."
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
            "Job collection must be a Firestore collection name."
        );
    }

    return collection;
}

function sanitizeJobMetadata(
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

/* ==========================================================
   OPTIONS
========================================================== */

function normalizeJobOptions(
    options
) {
    const settings =
        options || {};

    const retryDelayMs =
        normalizeNonNegativeInteger(
            settings.retryDelayMs,
            DEFAULT_RETRY_DELAY_MS,
            "Job retry delay"
        );

    return {
        runtime:
            settings.runtime,

        collection:
            normalizeCollection(
                settings.collection ||
                JOB_COLLECTION
            ),

        queue:
            normalizeQueueName(
                settings.queue ||
                DEFAULT_QUEUE
            ),

        defaultPriority:
            normalizeJobPriority(
                settings.defaultPriority ||
                DEFAULT_PRIORITY
            ),

        maxAttempts:
            normalizePositiveInteger(
                settings.maxAttempts,
                DEFAULT_MAX_ATTEMPTS,
                "Maximum job attempts"
            ),

        leaseMs:
            normalizePositiveInteger(
                settings.leaseMs,
                DEFAULT_LEASE_MS,
                "Job lease duration"
            ),

        retryDelayMs:
            retryDelayMs,

        maxRetryDelayMs:
            normalizePositiveInteger(
                settings.maxRetryDelayMs,
                Math.max(
                    retryDelayMs,
                    60 * 60 * 1000
                ),
                "Maximum job retry delay"
            ),

        retryBackoffMultiplier:
            normalizePositiveNumber(
                settings
                    .retryBackoffMultiplier,
                2,
                "Job retry backoff multiplier"
            ),

        retryFailed:
            settings.retryFailed !==
            false,

        retentionMs:
            normalizeNonNegativeInteger(
                settings.retentionMs,
                DEFAULT_RETENTION_MS,
                "Job retention"
            ),

        maxPayloadBytes:
            normalizePositiveInteger(
                settings.maxPayloadBytes,
                DEFAULT_MAX_PAYLOAD_BYTES,
                "Maximum job payload size"
            ),

        maxResultBytes:
            normalizePositiveInteger(
                settings.maxResultBytes,
                DEFAULT_MAX_RESULT_BYTES,
                "Maximum job result size"
            ),

        queryLimit:
            normalizeQueryLimit(
                settings.queryLimit
            ),

        claimBatchSize:
            normalizePositiveInteger(
                settings.claimBatchSize,
                50,
                "Job claim batch size"
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
   ERRORS
========================================================== */

function serializeJobError(
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
            "job-failed",

        message:
            error.publicMessage ||
            error.message ||
            "Job execution failed.",

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

function createJobNotFoundError(
    jobId
) {
    return new ServiceError(
        "not-found",
        "The job was not found.",
        {
            status:
                404,

            expose:
                true,

            details: {
                jobId:
                    jobId
            }
        }
    );
}

function createJobConflictError(
    jobId,
    options
) {
    const settings =
        options || {};

    return new ServiceError(
        "already-exists",
        "A job with this ID already exists.",
        {
            status:
                409,

            expose:
                true,

            retryable:
                false,

            details: {
                jobId:
                    jobId
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

function assertJobRuntime(
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
            "The job datastore is unavailable.",
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
            "Firestore transactions are required for jobs.",
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

function logJobEvent(
    runtime,
    job,
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

        jobId:
            job &&
            job.id,

        queue:
            job &&
            job.queue,

        type:
            job &&
            job.type,

        status:
            job &&
            job.status,

        attempts:
            job &&
            job.attempts,

        workerId:
            job &&
            job.workerId
    };

    if (
        event ===
            "failed" &&
        typeof runtime.logger.error ===
            "function"
    ) {
        runtime.logger.error(
            "Job failed.",
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
            "Job retry scheduled.",
            metadata
        );

        return;
    }

    if (
        typeof runtime.logger.info ===
        "function"
    ) {
        runtime.logger.info(
            "Job event.",
            metadata
        );
    } else if (
        typeof runtime.logger.debug ===
        "function"
    ) {
        runtime.logger.debug(
            "Job event.",
            metadata
        );
    }
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    createJobService,
    enqueueJob,
    enqueueUniqueJob,
    storeJob,
    claimNextJob,
    loadJobCandidates,
    claimJob,
    isJobClaimable,
    compareJobCandidates,
    sanitizeClaimCandidate,
    completeJob,
    failJob,
    cancelJob,
    getJob,
    queryJobs,
    normalizeJobQuery,
    normalizeJobRecord,
    sanitizeJobRecord,
    assertJobOwnership,
    isRetryableJobError,
    resolveRetryDelay,
    createJobId,
    generateLeaseToken,
    createJobFingerprint,
    hashJobValue,
    stableStringify,
    normalizeStableValue,
    assertSerializableJobValue,
    normalizeJobId,
    normalizeWorkerId,
    normalizeJobType,
    normalizeQueueName,
    normalizeJobStatus,
    normalizeJobPriority,
    normalizeJobTags,
    normalizeJobDate,
    normalizeJobOrderField,
    normalizeQueryLimit,
    normalizePositiveInteger,
    normalizeNonNegativeInteger,
    normalizePositiveNumber,
    normalizeOptionalString,
    normalizeCollection,
    sanitizeJobMetadata,
    normalizeJobOptions,
    serializeJobError,
    createJobNotFoundError,
    createJobConflictError,
    assertJobRuntime,
    resolveNow,
    createDatabaseTimestamp,
    toMilliseconds,
    serializeTimestamp,
    logJobEvent,
    constants: {
        JOB_COLLECTION,
        DEFAULT_QUEUE,
        DEFAULT_STATUS,
        DEFAULT_PRIORITY,
        DEFAULT_MAX_ATTEMPTS,
        DEFAULT_LEASE_MS,
        DEFAULT_RETRY_DELAY_MS,
        DEFAULT_RETENTION_MS,
        DEFAULT_QUERY_LIMIT,
        MAX_QUERY_LIMIT,
        DEFAULT_MAX_PAYLOAD_BYTES,
        DEFAULT_MAX_RESULT_BYTES,
        JOB_STATUSES,
        JOB_PRIORITIES,
        TERMINAL_JOB_STATUSES,
        PRIORITY_WEIGHTS
    }
};