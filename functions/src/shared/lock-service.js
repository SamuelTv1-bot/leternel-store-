"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   DISTRIBUTED LOCK SERVICE

   Responsibilities:
   - Acquire Firestore-backed distributed locks
   - Renew and release owned locks
   - Prevent concurrent processing
   - Support lock expiration and takeover
   - Provide guarded operation helpers
   - Inspect and query active locks
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

const LOCK_COLLECTION =
    "_locks";

const DEFAULT_NAMESPACE =
    "global";

const DEFAULT_LEASE_MS =
    60 * 1000;

const DEFAULT_ACQUIRE_TIMEOUT_MS =
    0;

const DEFAULT_RETRY_INTERVAL_MS =
    100;

const DEFAULT_QUERY_LIMIT =
    100;

const MAX_QUERY_LIMIT =
    500;

const DEFAULT_MAX_KEY_LENGTH =
    500;

const LOCK_STATUSES =
    Object.freeze({
        acquired:
            "acquired",

        unavailable:
            "unavailable",

        renewed:
            "renewed",

        released:
            "released",

        disabled:
            "disabled"
    });

/* ==========================================================
   SERVICE FACTORY
========================================================== */

function createLockService(
    options
) {
    const settings =
        normalizeLockOptions(
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

        acquire:
            function (
                key,
                ownerId,
                overrides
            ) {
                return acquireLock(
                    runtime,
                    key,
                    ownerId,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        renew:
            function (
                key,
                ownerId,
                token,
                overrides
            ) {
                return renewLock(
                    runtime,
                    key,
                    ownerId,
                    token,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        release:
            function (
                key,
                ownerId,
                token,
                overrides
            ) {
                return releaseLock(
                    runtime,
                    key,
                    ownerId,
                    token,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        inspect:
            function (
                key,
                overrides
            ) {
                return inspectLock(
                    runtime,
                    key,
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
                return queryLocks(
                    runtime,
                    filters,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        withLock:
            function (
                key,
                ownerId,
                operation,
                overrides
            ) {
                return executeWithLock(
                    runtime,
                    key,
                    ownerId,
                    operation,
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
   ACQUIRE
========================================================== */

async function acquireLock(
    runtime,
    key,
    ownerId,
    options
) {
    const settings =
        normalizeLockOptions(
            options
        );

    const descriptor =
        createLockDescriptor(
            key,
            settings.namespace
        );

    const normalizedOwnerId =
        normalizeOwnerId(
            ownerId
        );

    if (
        settings.disabled
    ) {
        return createLockResult(
            descriptor,
            {
                status:
                    LOCK_STATUSES
                        .disabled,

                acquired:
                    true,

                disabled:
                    true,

                ownerId:
                    normalizedOwnerId,

                token:
                    generateLockToken(),

                acquiredAt:
                    resolveNow(
                        runtime,
                        settings
                    ),

                expiresAt:
                    resolveNow(
                        runtime,
                        settings
                    ) +
                    settings.leaseMs
            }
        );
    }

    assertLockRuntime(
        runtime
    );

    const startedAt =
        resolveNow(
            runtime,
            settings
        );

    const deadline =
        startedAt +
        settings.acquireTimeoutMs;

    let attempt =
        0;

    while (true) {
        attempt +=
            1;

        const result =
            await tryAcquireLock(
                runtime,
                descriptor,
                normalizedOwnerId,
                settings
            );

        if (
            result.acquired
        ) {
            return Object.assign(
                {},
                result,
                {
                    attempts:
                        attempt
                }
            );
        }

        const now =
            resolveNow(
                runtime,
                settings
            );

        if (
            settings.acquireTimeoutMs <=
                0 ||
            now >=
                deadline
        ) {
            return Object.assign(
                {},
                result,
                {
                    attempts:
                        attempt
                }
            );
        }

        await delay(
            Math.min(
                settings.retryIntervalMs,
                Math.max(
                    0,
                    deadline -
                    now
                )
            ),
            settings
        );
    }
}

async function tryAcquireLock(
    runtime,
    descriptor,
    ownerId,
    options
) {
    const settings =
        normalizeLockOptions(
            options
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

                    if (
                        existing &&
                        !isLockExpired(
                            existing,
                            now
                        )
                    ) {
                        return {
                            acquired:
                                false,

                            existing:
                                existing
                        };
                    }

                    const token =
                        generateLockToken();

                    const record =
                        createLockRecord(
                            runtime,
                            descriptor,
                            ownerId,
                            token,
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

                    return {
                        acquired:
                            true,

                        record:
                            record
                    };
                }
            );

    if (
        result.acquired
    ) {
        logLockEvent(
            runtime,
            result.record,
            "acquired",
            settings
        );

        return createLockResult(
            descriptor,
            Object.assign(
                {},
                result.record,
                {
                    status:
                        LOCK_STATUSES
                            .acquired,

                    acquired:
                        true,

                    disabled:
                        false
                }
            )
        );
    }

    logLockEvent(
        runtime,
        result.existing,
        "unavailable",
        settings
    );

    return createLockResult(
        descriptor,
        {
            status:
                LOCK_STATUSES
                    .unavailable,

            acquired:
                false,

            disabled:
                false,

            ownerId:
                result.existing &&
                result.existing
                    .ownerId,

            token:
                null,

            acquiredAt:
                result.existing &&
                result.existing
                    .acquiredAt,

            renewedAt:
                result.existing &&
                result.existing
                    .renewedAt,

            expiresAt:
                result.existing &&
                result.existing
                    .expiresAt,

            metadata:
                result.existing &&
                result.existing
                    .metadata
        }
    );
}

/* ==========================================================
   RECORD CREATION
========================================================== */

function createLockRecord(
    runtime,
    descriptor,
    ownerId,
    token,
    existing,
    now,
    options
) {
    const settings =
        options || {};

    const takeover =
        Boolean(existing);

    return {
        key:
            descriptor.key,

        namespace:
            descriptor.namespace,

        compositeKey:
            descriptor.compositeKey,

        keyHash:
            descriptor.keyHash,

        ownerId:
            ownerId,

        token:
            token,

        metadata:
            sanitizeLockMetadata(
                settings.metadata
            ),

        acquisitionCount:
            normalizeNonNegativeInteger(
                existing &&
                existing.acquisitionCount,
                0,
                "Lock acquisition count"
            ) +
            1,

        takeoverCount:
            normalizeNonNegativeInteger(
                existing &&
                existing.takeoverCount,
                0,
                "Lock takeover count"
            ) +
            (
                takeover
                    ? 1
                    : 0
            ),

        createdAt:
            existing &&
            existing.createdAt
                ? existing.createdAt
                : createDatabaseTimestamp(
                      runtime,
                      now
                  ),

        acquiredAt:
            createDatabaseTimestamp(
                runtime,
                now
            ),

        renewedAt:
            null,

        updatedAt:
            createDatabaseTimestamp(
                runtime,
                now
            ),

        expiresAt:
            createDatabaseTimestamp(
                runtime,
                now +
                settings.leaseMs
            ),

        schemaVersion:
            1
    };
}

/* ==========================================================
   RENEW
========================================================== */

async function renewLock(
    runtime,
    key,
    ownerId,
    token,
    options
) {
    const settings =
        normalizeLockOptions(
            options
        );

    const descriptor =
        createLockDescriptor(
            key,
            settings.namespace
        );

    const normalizedOwnerId =
        normalizeOwnerId(
            ownerId
        );

    const normalizedToken =
        normalizeLockToken(
            token
        );

    if (
        settings.disabled
    ) {
        const now =
            resolveNow(
                runtime,
                settings
            );

        return createLockResult(
            descriptor,
            {
                status:
                    LOCK_STATUSES
                        .disabled,

                acquired:
                    true,

                renewed:
                    true,

                disabled:
                    true,

                ownerId:
                    normalizedOwnerId,

                token:
                    normalizedToken,

                renewedAt:
                    now,

                expiresAt:
                    now +
                    settings.leaseMs
            }
        );
    }

    assertLockRuntime(
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
                        throw createLockNotFoundError(
                            descriptor
                        );
                    }

                    const existing =
                        snapshot.data();

                    assertLockOwnership(
                        existing,
                        normalizedOwnerId,
                        normalizedToken,
                        now
                    );

                    const update = {
                        renewedAt:
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
                            createDatabaseTimestamp(
                                runtime,
                                now +
                                settings.leaseMs
                            )
                    };

                    if (
                        settings.metadata &&
                        settings.replaceMetadata
                    ) {
                        update.metadata =
                            sanitizeLockMetadata(
                                settings.metadata
                            );
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

    logLockEvent(
        runtime,
        record,
        "renewed",
        settings
    );

    return createLockResult(
        descriptor,
        Object.assign(
            {},
            record,
            {
                status:
                    LOCK_STATUSES
                        .renewed,

                acquired:
                    true,

                renewed:
                    true,

                disabled:
                    false
            }
        )
    );
}

/* ==========================================================
   RELEASE
========================================================== */

async function releaseLock(
    runtime,
    key,
    ownerId,
    token,
    options
) {
    const settings =
        normalizeLockOptions(
            options
        );

    const descriptor =
        createLockDescriptor(
            key,
            settings.namespace
        );

    const normalizedOwnerId =
        normalizeOwnerId(
            ownerId
        );

    const normalizedToken =
        normalizeLockToken(
            token
        );

    if (
        settings.disabled
    ) {
        return createLockResult(
            descriptor,
            {
                status:
                    LOCK_STATUSES
                        .disabled,

                acquired:
                    false,

                released:
                    true,

                disabled:
                    true,

                ownerId:
                    normalizedOwnerId,

                token:
                    normalizedToken
            }
        );
    }

    assertLockRuntime(
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

    const now =
        resolveNow(
            runtime,
            settings
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
                        !snapshot.exists
                    ) {
                        if (
                            settings.ignoreMissing
                        ) {
                            return {
                                released:
                                    false,

                                missing:
                                    true,

                                record:
                                    null
                            };
                        }

                        throw createLockNotFoundError(
                            descriptor
                        );
                    }

                    const existing =
                        snapshot.data();

                    assertLockOwnership(
                        existing,
                        normalizedOwnerId,
                        normalizedToken,
                        now,
                        {
                            allowExpired:
                                settings.allowExpiredRelease
                        }
                    );

                    transaction.delete(
                        reference
                    );

                    return {
                        released:
                            true,

                        missing:
                            false,

                        record:
                            existing
                    };
                }
            );

    if (
        result.released
    ) {
        logLockEvent(
            runtime,
            result.record,
            "released",
            settings
        );
    }

    return createLockResult(
        descriptor,
        {
            status:
                LOCK_STATUSES
                    .released,

            acquired:
                false,

            released:
                result.released,

            missing:
                result.missing,

            disabled:
                false,

            ownerId:
                normalizedOwnerId,

            token:
                null
        }
    );
}

/* ==========================================================
   GUARDED EXECUTION
========================================================== */

async function executeWithLock(
    runtime,
    key,
    ownerId,
    operation,
    options
) {
    if (
        typeof operation !==
        "function"
    ) {
        throw new TypeError(
            "Locked operation must be a function."
        );
    }

    const settings =
        normalizeLockOptions(
            options
        );

    const acquisition =
        await acquireLock(
            runtime,
            key,
            ownerId,
            settings
        );

    if (
        !acquisition.acquired
    ) {
        if (
            settings.throwIfUnavailable
        ) {
            throw createLockUnavailableError(
                acquisition
            );
        }

        return {
            executed:
                false,

            acquired:
                false,

            lock:
                acquisition,

            result:
                undefined
        };
    }

    let operationError;
    let operationResult;
    let releaseResult;

    try {
        operationResult =
            await operation({
                key:
                    acquisition.key,

                namespace:
                    acquisition.namespace,

                ownerId:
                    acquisition.ownerId,

                token:
                    acquisition.token,

                expiresAt:
                    acquisition.expiresAt,

                renew:
                    function (
                        overrides
                    ) {
                        return renewLock(
                            runtime,
                            key,
                            ownerId,
                            acquisition.token,
                            Object.assign(
                                {},
                                settings,
                                overrides || {}
                            )
                        );
                    }
            });
    } catch (error) {
        operationError =
            error;
    }

    try {
        if (
            settings.releaseAfterOperation
        ) {
            releaseResult =
                await releaseLock(
                    runtime,
                    key,
                    ownerId,
                    acquisition.token,
                    Object.assign(
                        {},
                        settings,
                        {
                            ignoreMissing:
                                true
                        }
                    )
                );
        }
    } catch (error) {
        if (
            !operationError
        ) {
            operationError =
                error;
        } else {
            logLockReleaseFailure(
                runtime,
                acquisition,
                error,
                settings
            );
        }
    }

    if (
        operationError
    ) {
        throw operationError;
    }

    return {
        executed:
            true,

        acquired:
            true,

        lock:
            acquisition,

        release:
            releaseResult ||
            null,

        result:
            operationResult
    };
}

/* ==========================================================
   INSPECTION
========================================================== */

async function inspectLock(
    runtime,
    key,
    options
) {
    const settings =
        normalizeLockOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return null;
    }

    assertLockRuntime(
        runtime
    );

    const descriptor =
        createLockDescriptor(
            key,
            settings.namespace
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

    if (
        !snapshot.exists
    ) {
        return null;
    }

    const record =
        sanitizeLockRecord(
            snapshot.data()
        );

    const now =
        resolveNow(
            runtime,
            settings
        );

    return Object.assign(
        {},
        record,
        {
            expired:
                isLockExpired(
                    snapshot.data(),
                    now
                ),

            remainingMs:
                calculateRemainingLease(
                    snapshot.data(),
                    now
                )
        }
    );
}

/* ==========================================================
   QUERY
========================================================== */

async function queryLocks(
    runtime,
    filters,
    options
) {
    const settings =
        normalizeLockOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return [];
    }

    assertLockRuntime(
        runtime
    );

    const normalized =
        normalizeLockQuery(
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
        normalized.ownerId
    ) {
        query =
            query.where(
                "ownerId",
                "==",
                normalized.ownerId
            );
    }

    if (
        normalized.expiresBefore
    ) {
        query =
            query.where(
                "expiresAt",
                "<=",
                createDatabaseTimestamp(
                    runtime,
                    normalized
                        .expiresBefore
                )
            );
    }

    if (
        normalized.expiresAfter
    ) {
        query =
            query.where(
                "expiresAt",
                ">=",
                createDatabaseTimestamp(
                    runtime,
                    normalized
                        .expiresAfter
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

    const now =
        resolveNow(
            runtime,
            settings
        );

    return documents
        .map(
            function (document) {
                const raw =
                    document.data();

                return Object.assign(
                    {},
                    sanitizeLockRecord(
                        raw
                    ),
                    {
                        expired:
                            isLockExpired(
                                raw,
                                now
                            ),

                        remainingMs:
                            calculateRemainingLease(
                                raw,
                                now
                            )
                    }
                );
            }
        )
        .filter(
            function (record) {
                if (
                    normalized.expired ===
                    null
                ) {
                    return true;
                }

                return (
                    record.expired ===
                    normalized.expired
                );
            }
        );
}

function normalizeLockQuery(
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
                : settings.namespace,

        ownerId:
            normalizeOptionalString(
                source.ownerId
            ),

        expired:
            source.expired ===
            undefined
                ? null
                : Boolean(
                      source.expired
                  ),

        expiresBefore:
            source.expiresBefore !==
            undefined
                ? normalizeLockDate(
                      source.expiresBefore,
                      "Lock expiration filter"
                  )
                : null,

        expiresAfter:
            source.expiresAfter !==
            undefined
                ? normalizeLockDate(
                      source.expiresAfter,
                      "Lock expiration filter"
                  )
                : null,

        orderBy:
            normalizeLockOrderField(
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
   DESCRIPTOR
========================================================== */

function createLockDescriptor(
    key,
    namespace
) {
    const normalizedKey =
        normalizeLockKey(
            key
        );

    const normalizedNamespace =
        normalizeNamespace(
            namespace
        );

    const compositeKey =
        normalizedNamespace +
        ":" +
        normalizedKey;

    const keyHash =
        hashLockKey(
            compositeKey
        );

    return {
        key:
            normalizedKey,

        namespace:
            normalizedNamespace,

        compositeKey:
            compositeKey,

        keyHash:
            keyHash,

        documentId:
            keyHash
    };
}

function hashLockKey(
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
   RESULT AND RECORD SANITIZATION
========================================================== */

function createLockResult(
    descriptor,
    values
) {
    const source =
        values || {};

    return {
        status:
            source.status ||
            (
                source.acquired
                    ? LOCK_STATUSES
                          .acquired
                    : LOCK_STATUSES
                          .unavailable
            ),

        acquired:
            Boolean(
                source.acquired
            ),

        renewed:
            Boolean(
                source.renewed
            ),

        released:
            Boolean(
                source.released
            ),

        missing:
            Boolean(
                source.missing
            ),

        disabled:
            Boolean(
                source.disabled
            ),

        key:
            descriptor.key,

        namespace:
            descriptor.namespace,

        compositeKey:
            descriptor.compositeKey,

        keyHash:
            descriptor.keyHash,

        documentId:
            descriptor.documentId,

        ownerId:
            source.ownerId ||
            null,

        token:
            source.token ||
            null,

        acquisitionCount:
            normalizeNonNegativeInteger(
                source.acquisitionCount,
                0,
                "Lock acquisition count"
            ),

        takeoverCount:
            normalizeNonNegativeInteger(
                source.takeoverCount,
                0,
                "Lock takeover count"
            ),

        metadata:
            cloneValue(
                source.metadata
            ),

        createdAt:
            serializeTimestamp(
                source.createdAt
            ),

        acquiredAt:
            serializeTimestamp(
                source.acquiredAt
            ),

        renewedAt:
            serializeTimestamp(
                source.renewedAt
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

function sanitizeLockRecord(
    record
) {
    if (!record) {
        return null;
    }

    return {
        key:
            normalizeLockKey(
                record.key
            ),

        namespace:
            normalizeNamespace(
                record.namespace
            ),

        compositeKey:
            record.compositeKey ||
            (
                normalizeNamespace(
                    record.namespace
                ) +
                ":" +
                normalizeLockKey(
                    record.key
                )
            ),

        keyHash:
            record.keyHash ||
            hashLockKey(
                normalizeNamespace(
                    record.namespace
                ) +
                ":" +
                normalizeLockKey(
                    record.key
                )
            ),

        ownerId:
            normalizeOwnerId(
                record.ownerId
            ),

        token:
            record.token ||
            null,

        metadata:
            cloneValue(
                record.metadata
            ),

        acquisitionCount:
            normalizeNonNegativeInteger(
                record.acquisitionCount,
                0,
                "Lock acquisition count"
            ),

        takeoverCount:
            normalizeNonNegativeInteger(
                record.takeoverCount,
                0,
                "Lock takeover count"
            ),

        createdAt:
            serializeTimestamp(
                record.createdAt
            ),

        acquiredAt:
            serializeTimestamp(
                record.acquiredAt
            ),

        renewedAt:
            serializeTimestamp(
                record.renewedAt
            ),

        updatedAt:
            serializeTimestamp(
                record.updatedAt
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
   OWNERSHIP AND EXPIRATION
========================================================== */

function assertLockOwnership(
    lock,
    ownerId,
    token,
    now,
    options
) {
    const settings =
        options || {};

    if (!lock) {
        throw new ServiceError(
            "not-found",
            "The lock was not found.",
            {
                status:
                    404,

                expose:
                    true
            }
        );
    }

    if (
        String(
            lock.ownerId || ""
        ) !==
        String(
            ownerId || ""
        )
    ) {
        throw new ServiceError(
            "permission-denied",
            "The lock is owned by another owner.",
            {
                status:
                    403,

                expose:
                    true
            }
        );
    }

    if (
        String(
            lock.token || ""
        ) !==
        String(
            token || ""
        )
    ) {
        throw new ServiceError(
            "aborted",
            "The lock token is no longer valid.",
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

    if (
        !settings.allowExpired &&
        isLockExpired(
            lock,
            now
        )
    ) {
        throw new ServiceError(
            "deadline-exceeded",
            "The lock lease has expired.",
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

function isLockExpired(
    lock,
    now
) {
    if (!lock) {
        return true;
    }

    const expiresAt =
        toMilliseconds(
            lock.expiresAt
        );

    if (!expiresAt) {
        return true;
    }

    return (
        expiresAt <=
        Number(now)
    );
}

function calculateRemainingLease(
    lock,
    now
) {
    if (!lock) {
        return 0;
    }

    const expiresAt =
        toMilliseconds(
            lock.expiresAt
        );

    if (!expiresAt) {
        return 0;
    }

    return Math.max(
        0,
        expiresAt -
        Number(now)
    );
}

/* ==========================================================
   NORMALIZERS
========================================================== */

function normalizeLockKey(
    value,
    maximumLength
) {
    let normalized;

    if (
        value &&
        typeof value ===
            "object"
    ) {
        normalized =
            stableStringify(
                value
            );
    } else {
        normalized =
            String(
                value || ""
            ).trim();
    }

    if (!normalized) {
        throw new ServiceError(
            "invalid-argument",
            "The lock key is invalid.",
            {
                status:
                    400,

                expose:
                    true
            }
        );
    }

    const limit =
        maximumLength ||
        DEFAULT_MAX_KEY_LENGTH;

    if (
        normalized.length >
        limit
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The lock key is too long.",
            {
                status:
                    400,

                expose:
                    true,

                details: {
                    maximumLength:
                        limit
                }
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

function normalizeOwnerId(
    value
) {
    const normalized =
        String(
            value || ""
        ).trim();

    if (!normalized) {
        throw new ServiceError(
            "invalid-argument",
            "A lock owner ID is required.",
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

function normalizeLockToken(
    value
) {
    const normalized =
        String(
            value || ""
        ).trim();

    if (!normalized) {
        throw new ServiceError(
            "invalid-argument",
            "A lock token is required.",
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

function normalizeLockDate(
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

function normalizeLockOrderField(
    value
) {
    const allowed =
        new Set([
            "createdAt",
            "acquiredAt",
            "renewedAt",
            "updatedAt",
            "expiresAt",
            "acquisitionCount",
            "takeoverCount"
        ]);

    const normalized =
        String(
            value ||
            "expiresAt"
        ).trim();

    return allowed.has(
        normalized
    )
        ? normalized
        : "expiresAt";
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
            "Lock query limit must be a positive integer."
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
            "Lock collection must be a Firestore collection name."
        );
    }

    return collection;
}

/* ==========================================================
   OPTIONS
========================================================== */

function normalizeLockOptions(
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
                LOCK_COLLECTION
            ),

        namespace:
            normalizeNamespace(
                settings.namespace ||
                DEFAULT_NAMESPACE
            ),

        leaseMs:
            normalizePositiveInteger(
                settings.leaseMs,
                DEFAULT_LEASE_MS,
                "Lock lease duration"
            ),

        acquireTimeoutMs:
            normalizeNonNegativeInteger(
                settings.acquireTimeoutMs,
                DEFAULT_ACQUIRE_TIMEOUT_MS,
                "Lock acquire timeout"
            ),

        retryIntervalMs:
            normalizePositiveInteger(
                settings.retryIntervalMs,
                DEFAULT_RETRY_INTERVAL_MS,
                "Lock retry interval"
            ),

        queryLimit:
            normalizeQueryLimit(
                settings.queryLimit
            ),

        maxKeyLength:
            normalizePositiveInteger(
                settings.maxKeyLength,
                DEFAULT_MAX_KEY_LENGTH,
                "Maximum lock key length"
            ),

        metadata:
            sanitizeLockMetadata(
                settings.metadata
            ),

        replaceMetadata:
            Boolean(
                settings.replaceMetadata
            ),

        disabled:
            Boolean(
                settings.disabled
            ),

        throwIfUnavailable:
            settings.throwIfUnavailable !==
            false,

        releaseAfterOperation:
            settings.releaseAfterOperation !==
            false,

        ignoreMissing:
            Boolean(
                settings.ignoreMissing
            ),

        allowExpiredRelease:
            Boolean(
                settings.allowExpiredRelease
            ),

        log:
            settings.log !==
            false,

        now:
            settings.now,

        sleep:
            settings.sleep
    };
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
            "Lock data contains a circular reference.",
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
   METADATA
========================================================== */

function sanitizeLockMetadata(
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
   ERRORS
========================================================== */

function createLockNotFoundError(
    descriptor
) {
    return new ServiceError(
        "not-found",
        "The lock was not found.",
        {
            status:
                404,

            expose:
                true,

            details: {
                key:
                    descriptor.key,

                namespace:
                    descriptor.namespace
            }
        }
    );
}

function createLockUnavailableError(
    result
) {
    return new ServiceError(
        "resource-exhausted",
        "The lock is currently unavailable.",
        {
            status:
                423,

            expose:
                true,

            retryable:
                true,

            details: {
                key:
                    result.key,

                namespace:
                    result.namespace,

                ownerId:
                    result.ownerId,

                expiresAt:
                    result.expiresAt
            }
        }
    );
}

/* ==========================================================
   RUNTIME AND TIME
========================================================== */

function assertLockRuntime(
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
            "The lock datastore is unavailable.",
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
            "Firestore transactions are required for locks.",
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

function delay(
    milliseconds,
    options
) {
    const settings =
        options || {};

    if (
        typeof settings.sleep ===
        "function"
    ) {
        return Promise.resolve(
            settings.sleep(
                milliseconds
            )
        );
    }

    return new Promise(
        function (resolve) {
            setTimeout(
                resolve,
                milliseconds
            );
        }
    );
}

/* ==========================================================
   TOKEN
========================================================== */

function generateLockToken() {
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

function logLockEvent(
    runtime,
    lock,
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

        key:
            lock &&
            lock.key,

        namespace:
            lock &&
            lock.namespace,

        ownerId:
            lock &&
            lock.ownerId,

        expiresAt:
            serializeTimestamp(
                lock &&
                lock.expiresAt
            )
    };

    if (
        event ===
            "unavailable" &&
        typeof runtime.logger.debug ===
            "function"
    ) {
        runtime.logger.debug(
            "Lock unavailable.",
            metadata
        );

        return;
    }

    if (
        typeof runtime.logger.info ===
        "function"
    ) {
        runtime.logger.info(
            "Lock event.",
            metadata
        );
    } else if (
        typeof runtime.logger.debug ===
        "function"
    ) {
        runtime.logger.debug(
            "Lock event.",
            metadata
        );
    }
}

function logLockReleaseFailure(
    runtime,
    lock,
    error,
    options
) {
    const settings =
        options || {};

    if (
        !settings.log ||
        !runtime ||
        !runtime.logger ||
        typeof runtime.logger.warn !==
            "function"
    ) {
        return;
    }

    runtime.logger.warn(
        "Lock release failed after operation.",
        {
            key:
                lock &&
                lock.key,

            namespace:
                lock &&
                lock.namespace,

            ownerId:
                lock &&
                lock.ownerId,

            code:
                error &&
                error.code,

            message:
                error &&
                error.message
        }
    );
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    createLockService,
    acquireLock,
    tryAcquireLock,
    createLockRecord,
    renewLock,
    releaseLock,
    executeWithLock,
    inspectLock,
    queryLocks,
    normalizeLockQuery,
    createLockDescriptor,
    hashLockKey,
    createLockResult,
    sanitizeLockRecord,
    assertLockOwnership,
    isLockExpired,
    calculateRemainingLease,
    normalizeLockKey,
    normalizeNamespace,
    normalizeOwnerId,
    normalizeLockToken,
    normalizeLockDate,
    normalizeLockOrderField,
    normalizeQueryLimit,
    normalizePositiveInteger,
    normalizeNonNegativeInteger,
    normalizeOptionalString,
    normalizeCollection,
    normalizeLockOptions,
    stableStringify,
    normalizeStableValue,
    sanitizeLockMetadata,
    createLockNotFoundError,
    createLockUnavailableError,
    assertLockRuntime,
    resolveNow,
    createDatabaseTimestamp,
    toMilliseconds,
    serializeTimestamp,
    delay,
    generateLockToken,
    logLockEvent,
    logLockReleaseFailure,
    constants: {
        LOCK_COLLECTION,
        DEFAULT_NAMESPACE,
        DEFAULT_LEASE_MS,
        DEFAULT_ACQUIRE_TIMEOUT_MS,
        DEFAULT_RETRY_INTERVAL_MS,
        DEFAULT_QUERY_LIMIT,
        MAX_QUERY_LIMIT,
        DEFAULT_MAX_KEY_LENGTH,
        LOCK_STATUSES
    }
};