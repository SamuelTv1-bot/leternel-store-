"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   RECONCILIATION SERVICE

   Responsibilities:
   - Compare internal and external financial records
   - Detect missing, duplicate, and mismatched transactions
   - Track reconciliation runs and discrepancies
   - Resolve and ignore reconciliation discrepancies
   - Support dry-run and disabled execution modes
   - Provide queryable reconciliation history
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

const RECONCILIATION_COLLECTION =
    "_reconciliationRuns";

const RECONCILIATION_ITEM_COLLECTION =
    "_reconciliationItems";

const DEFAULT_STATUS =
    "pending";

const DEFAULT_ITEM_STATUS =
    "open";

const DEFAULT_CURRENCY =
    "GBP";

const DEFAULT_TOLERANCE_MINOR =
    0;

const DEFAULT_QUERY_LIMIT =
    100;

const MAX_QUERY_LIMIT =
    500;

const DEFAULT_BATCH_SIZE =
    100;

const MAX_BATCH_SIZE =
    500;

const DEFAULT_MAX_RECORDS =
    10000;

const DEFAULT_RETENTION_MS =
    90 * 24 * 60 * 60 * 1000;

const DEFAULT_MAX_METADATA_BYTES =
    100000;

const RECONCILIATION_STATUSES =
    Object.freeze({
        pending:
            "pending",

        running:
            "running",

        completed:
            "completed",

        partial:
            "partial",

        failed:
            "failed",

        cancelled:
            "cancelled",

        disabled:
            "disabled"
    });

const RECONCILIATION_ITEM_STATUSES =
    Object.freeze({
        open:
            "open",

        resolved:
            "resolved",

        ignored:
            "ignored"
    });

const RECONCILIATION_ITEM_TYPES =
    Object.freeze({
        matched:
            "matched",

        missingInternal:
            "missing-internal",

        missingExternal:
            "missing-external",

        amountMismatch:
            "amount-mismatch",

        currencyMismatch:
            "currency-mismatch",

        statusMismatch:
            "status-mismatch",

        duplicateInternal:
            "duplicate-internal",

        duplicateExternal:
            "duplicate-external"
    });

const TERMINAL_RECONCILIATION_STATUSES =
    Object.freeze([
        RECONCILIATION_STATUSES.completed,
        RECONCILIATION_STATUSES.partial,
        RECONCILIATION_STATUSES.failed,
        RECONCILIATION_STATUSES.cancelled,
        RECONCILIATION_STATUSES.disabled
    ]);

const DISCREPANCY_TYPES =
    Object.freeze([
        RECONCILIATION_ITEM_TYPES.missingInternal,
        RECONCILIATION_ITEM_TYPES.missingExternal,
        RECONCILIATION_ITEM_TYPES.amountMismatch,
        RECONCILIATION_ITEM_TYPES.currencyMismatch,
        RECONCILIATION_ITEM_TYPES.statusMismatch,
        RECONCILIATION_ITEM_TYPES.duplicateInternal,
        RECONCILIATION_ITEM_TYPES.duplicateExternal
    ]);

/* ==========================================================
   SERVICE FACTORY
========================================================== */

function createReconciliationService(
    options
) {
    const settings =
        normalizeReconciliationOptions(
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

        run:
            function (
                input,
                overrides
            ) {
                return runReconciliation(
                    runtime,
                    input,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        compare:
            function (
                internalRecords,
                externalRecords,
                overrides
            ) {
                return compareReconciliationRecords(
                    internalRecords,
                    externalRecords,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        get:
            function (
                runId,
                overrides
            ) {
                return getReconciliationRun(
                    runtime,
                    runId,
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
                return queryReconciliationRuns(
                    runtime,
                    filters,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        items:
            function (
                filters,
                overrides
            ) {
                return queryReconciliationItems(
                    runtime,
                    filters,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        resolve:
            function (
                itemId,
                resolution,
                overrides
            ) {
                return resolveReconciliationItem(
                    runtime,
                    itemId,
                    resolution,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        ignore:
            function (
                itemId,
                reason,
                overrides
            ) {
                return ignoreReconciliationItem(
                    runtime,
                    itemId,
                    reason,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        cancel:
            function (
                runId,
                reason,
                overrides
            ) {
                return cancelReconciliationRun(
                    runtime,
                    runId,
                    reason,
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
   RUN
========================================================== */

async function runReconciliation(
    runtime,
    input,
    options
) {
    const settings =
        normalizeReconciliationOptions(
            options
        );

    const source =
        normalizeReconciliationInput(
            input,
            settings
        );

    const startedAt =
        resolveNow(
            runtime,
            settings
        );

    const runId =
        source.id ||
        settings.runId ||
        createReconciliationRunId(
            startedAt
        );

    if (
        settings.disabled
    ) {
        return createReconciliationResult({
            id:
                runId,

            status:
                RECONCILIATION_STATUSES
                    .disabled,

            disabled:
                true,

            dryRun:
                settings.dryRun,

            startedAt:
                startedAt,

            completedAt:
                startedAt,

            currency:
                source.currency,

            items:
                []
        });
    }

    assertReconciliationRuntime(
        runtime
    );

    const runningRecord =
        createReconciliationRunRecord({
            id:
                runId,

            status:
                RECONCILIATION_STATUSES
                    .running,

            disabled:
                false,

            dryRun:
                settings.dryRun,

            currency:
                source.currency,

            source:
                source.source,

            periodStart:
                source.periodStart,

            periodEnd:
                source.periodEnd,

            internalCount:
                source.internalRecords
                    .length,

            externalCount:
                source.externalRecords
                    .length,

            metadata:
                source.metadata,

            startedAt:
                startedAt,

            completedAt:
                null
        },
        runtime,
        settings);

    if (
        settings.persistRuns
    ) {
        await runtime.db
            .collection(
                settings.collection
            )
            .doc(
                runId
            )
            .set(
                runningRecord,
                {
                    merge:
                        false
                }
            );
    }

    try {
        const comparison =
            compareReconciliationRecords(
                source.internalRecords,
                source.externalRecords,
                settings
            );

        const completedAt =
            resolveNow(
                runtime,
                settings
            );

        const status =
            comparison.discrepancyCount >
            0
                ? RECONCILIATION_STATUSES
                      .partial
                : RECONCILIATION_STATUSES
                      .completed;

        const result =
            createReconciliationResult({
                id:
                    runId,

                status:
                    status,

                disabled:
                    false,

                dryRun:
                    settings.dryRun,

                currency:
                    source.currency,

                source:
                    source.source,

                periodStart:
                    source.periodStart,

                periodEnd:
                    source.periodEnd,

                internalCount:
                    source.internalRecords
                        .length,

                externalCount:
                    source.externalRecords
                        .length,

                matchedCount:
                    comparison.matchedCount,

                discrepancyCount:
                    comparison.discrepancyCount,

                missingInternalCount:
                    comparison
                        .missingInternalCount,

                missingExternalCount:
                    comparison
                        .missingExternalCount,

                amountMismatchCount:
                    comparison
                        .amountMismatchCount,

                currencyMismatchCount:
                    comparison
                        .currencyMismatchCount,

                statusMismatchCount:
                    comparison
                        .statusMismatchCount,

                duplicateInternalCount:
                    comparison
                        .duplicateInternalCount,

                duplicateExternalCount:
                    comparison
                        .duplicateExternalCount,

                internalTotalMinor:
                    comparison
                        .internalTotalMinor,

                externalTotalMinor:
                    comparison
                        .externalTotalMinor,

                differenceMinor:
                    comparison
                        .differenceMinor,

                metadata:
                    source.metadata,

                items:
                    comparison.items,

                startedAt:
                    startedAt,

                completedAt:
                    completedAt
            });

        if (
            settings.persistItems &&
            !settings.dryRun
        ) {
            await persistReconciliationItems(
                runtime,
                runId,
                comparison.items,
                settings
            );
        }

        if (
            settings.persistRuns
        ) {
            const record =
                createReconciliationRunRecord(
                    result,
                    runtime,
                    settings
                );

            await runtime.db
                .collection(
                    settings.collection
                )
                .doc(
                    runId
                )
                .set(
                    record,
                    {
                        merge:
                            true
                    }
                );
        }

        logReconciliationEvent(
            runtime,
            result,
            "completed",
            settings
        );

        return result;
    } catch (error) {
        const completedAt =
            resolveNow(
                runtime,
                settings
            );

        const failure =
            createReconciliationResult({
                id:
                    runId,

                status:
                    RECONCILIATION_STATUSES
                        .failed,

                disabled:
                    false,

                dryRun:
                    settings.dryRun,

                currency:
                    source.currency,

                source:
                    source.source,

                periodStart:
                    source.periodStart,

                periodEnd:
                    source.periodEnd,

                internalCount:
                    source.internalRecords
                        .length,

                externalCount:
                    source.externalRecords
                        .length,

                error:
                    serializeReconciliationError(
                        error
                    ),

                metadata:
                    source.metadata,

                startedAt:
                    startedAt,

                completedAt:
                    completedAt,

                items:
                    []
            });

        if (
            settings.persistRuns
        ) {
            await runtime.db
                .collection(
                    settings.collection
                )
                .doc(
                    runId
                )
                .set(
                    createReconciliationRunRecord(
                        failure,
                        runtime,
                        settings
                    ),
                    {
                        merge:
                            true
                    }
                );
        }

        logReconciliationEvent(
            runtime,
            failure,
            "failed",
            settings
        );

        if (
            settings.returnFailures
        ) {
            return failure;
        }

        throw error;
    }
}

/* ==========================================================
   COMPARISON
========================================================== */

function compareReconciliationRecords(
    internalRecords,
    externalRecords,
    options
) {
    const settings =
        normalizeReconciliationOptions(
            options
        );

    const normalizedInternal =
        normalizeReconciliationRecords(
            internalRecords,
            "internal",
            settings
        );

    const normalizedExternal =
        normalizeReconciliationRecords(
            externalRecords,
            "external",
            settings
        );

    const internalGroups =
        groupReconciliationRecords(
            normalizedInternal
        );

    const externalGroups =
        groupReconciliationRecords(
            normalizedExternal
        );

    const keys =
        Array.from(
            new Set([
                ...internalGroups.keys(),
                ...externalGroups.keys()
            ])
        ).sort();

    const items =
        [];

    let matchedCount =
        0;

    let missingInternalCount =
        0;

    let missingExternalCount =
        0;

    let amountMismatchCount =
        0;

    let currencyMismatchCount =
        0;

    let statusMismatchCount =
        0;

    let duplicateInternalCount =
        0;

    let duplicateExternalCount =
        0;

    for (
        const key of
        keys
    ) {
        const internalGroup =
            internalGroups.get(
                key
            ) || [];

        const externalGroup =
            externalGroups.get(
                key
            ) || [];

        if (
            internalGroup.length >
            1
        ) {
            duplicateInternalCount +=
                1;

            items.push(
                createReconciliationItem({
                    key:
                        key,

                    type:
                        RECONCILIATION_ITEM_TYPES
                            .duplicateInternal,

                    internalRecords:
                        internalGroup,

                    externalRecords:
                        externalGroup
                })
            );

            continue;
        }

        if (
            externalGroup.length >
            1
        ) {
            duplicateExternalCount +=
                1;

            items.push(
                createReconciliationItem({
                    key:
                        key,

                    type:
                        RECONCILIATION_ITEM_TYPES
                            .duplicateExternal,

                    internalRecords:
                        internalGroup,

                    externalRecords:
                        externalGroup
                })
            );

            continue;
        }

        const internalRecord =
            internalGroup[0] ||
            null;

        const externalRecord =
            externalGroup[0] ||
            null;

        if (
            !internalRecord
        ) {
            missingInternalCount +=
                1;

            items.push(
                createReconciliationItem({
                    key:
                        key,

                    type:
                        RECONCILIATION_ITEM_TYPES
                            .missingInternal,

                    internalRecord:
                        null,

                    externalRecord:
                        externalRecord
                })
            );

            continue;
        }

        if (
            !externalRecord
        ) {
            missingExternalCount +=
                1;

            items.push(
                createReconciliationItem({
                    key:
                        key,

                    type:
                        RECONCILIATION_ITEM_TYPES
                            .missingExternal,

                    internalRecord:
                        internalRecord,

                    externalRecord:
                        null
                })
            );

            continue;
        }

        if (
            internalRecord.currency !==
            externalRecord.currency
        ) {
            currencyMismatchCount +=
                1;

            items.push(
                createReconciliationItem({
                    key:
                        key,

                    type:
                        RECONCILIATION_ITEM_TYPES
                            .currencyMismatch,

                    internalRecord:
                        internalRecord,

                    externalRecord:
                        externalRecord
                })
            );

            continue;
        }

        if (
            Math.abs(
                internalRecord.amountMinor -
                externalRecord.amountMinor
            ) >
            settings.toleranceMinor
        ) {
            amountMismatchCount +=
                1;

            items.push(
                createReconciliationItem({
                    key:
                        key,

                    type:
                        RECONCILIATION_ITEM_TYPES
                            .amountMismatch,

                    internalRecord:
                        internalRecord,

                    externalRecord:
                        externalRecord
                })
            );

            continue;
        }

        if (
            settings.compareStatus &&
            internalRecord.status !==
                externalRecord.status
        ) {
            statusMismatchCount +=
                1;

            items.push(
                createReconciliationItem({
                    key:
                        key,

                    type:
                        RECONCILIATION_ITEM_TYPES
                            .statusMismatch,

                    internalRecord:
                        internalRecord,

                    externalRecord:
                        externalRecord
                })
            );

            continue;
        }

        matchedCount +=
            1;

        if (
            settings.includeMatches
        ) {
            items.push(
                createReconciliationItem({
                    key:
                        key,

                    type:
                        RECONCILIATION_ITEM_TYPES
                            .matched,

                    internalRecord:
                        internalRecord,

                    externalRecord:
                        externalRecord
                })
            );
        }
    }

    const discrepancyCount =
        missingInternalCount +
        missingExternalCount +
        amountMismatchCount +
        currencyMismatchCount +
        statusMismatchCount +
        duplicateInternalCount +
        duplicateExternalCount;

    const internalTotalMinor =
        normalizedInternal.reduce(
            function (
                total,
                record
            ) {
                return (
                    total +
                    record.amountMinor
                );
            },
            0
        );

    const externalTotalMinor =
        normalizedExternal.reduce(
            function (
                total,
                record
            ) {
                return (
                    total +
                    record.amountMinor
                );
            },
            0
        );

    return {
        matchedCount:
            matchedCount,

        discrepancyCount:
            discrepancyCount,

        missingInternalCount:
            missingInternalCount,

        missingExternalCount:
            missingExternalCount,

        amountMismatchCount:
            amountMismatchCount,

        currencyMismatchCount:
            currencyMismatchCount,

        statusMismatchCount:
            statusMismatchCount,

        duplicateInternalCount:
            duplicateInternalCount,

        duplicateExternalCount:
            duplicateExternalCount,

        internalTotalMinor:
            internalTotalMinor,

        externalTotalMinor:
            externalTotalMinor,

        differenceMinor:
            internalTotalMinor -
            externalTotalMinor,

        items:
            items
    };
}

function groupReconciliationRecords(
    records
) {
    const groups =
        new Map();

    for (
        const record of
        records
    ) {
        if (
            !groups.has(
                record.key
            )
        ) {
            groups.set(
                record.key,
                []
            );
        }

        groups.get(
            record.key
        ).push(
            record
        );
    }

    return groups;
}

function createReconciliationItem(
    values
) {
    const source =
        values || {};

    const type =
        normalizeReconciliationItemType(
            source.type
        );

    const internalRecord =
        source.internalRecord ||
        (
            Array.isArray(
                source.internalRecords
            )
                ? source.internalRecords[0] ||
                  null
                : null
        );

    const externalRecord =
        source.externalRecord ||
        (
            Array.isArray(
                source.externalRecords
            )
                ? source.externalRecords[0] ||
                  null
                : null
        );

    return {
        id:
            source.id ||
            createReconciliationItemId(
                source.key,
                type
            ),

        key:
            normalizeReconciliationKey(
                source.key
            ),

        type:
            type,

        status:
            RECONCILIATION_ITEM_STATUSES
                .open,

        internalRecord:
            cloneValue(
                internalRecord
            ),

        externalRecord:
            cloneValue(
                externalRecord
            ),

        internalRecords:
            Array.isArray(
                source.internalRecords
            )
                ? cloneValue(
                      source.internalRecords
                  )
                : [],

        externalRecords:
            Array.isArray(
                source.externalRecords
            )
                ? cloneValue(
                      source.externalRecords
                  )
                : [],

        amountDifferenceMinor:
            internalRecord &&
            externalRecord
                ? internalRecord
                      .amountMinor -
                  externalRecord
                      .amountMinor
                : null,

        resolution:
            null,

        ignoreReason:
            null,

        resolvedAt:
            null,

        ignoredAt:
            null
    };
}

/* ==========================================================
   PERSIST ITEMS
========================================================== */

async function persistReconciliationItems(
    runtime,
    runId,
    items,
    options
) {
    const settings =
        normalizeReconciliationOptions(
            options
        );

    if (
        !Array.isArray(
            items
        ) ||
        items.length ===
        0
    ) {
        return 0;
    }

    const normalizedRunId =
        normalizeReconciliationRunId(
            runId
        );

    let written =
        0;

    for (
        let index = 0;
        index < items.length;
        index += settings.batchSize
    ) {
        const chunk =
            items.slice(
                index,
                index +
                settings.batchSize
            );

        if (
            typeof runtime.db.batch ===
            "function"
        ) {
            const batch =
                runtime.db.batch();

            for (
                const item of
                chunk
            ) {
                const record =
                    createReconciliationItemRecord(
                        normalizedRunId,
                        item,
                        runtime,
                        settings
                    );

                batch.set(
                    runtime.db
                        .collection(
                            settings.itemCollection
                        )
                        .doc(
                            record.id
                        ),
                    record,
                    {
                        merge:
                            false
                    }
                );
            }

            await batch.commit();

            written +=
                chunk.length;
        } else {
            for (
                const item of
                chunk
            ) {
                const record =
                    createReconciliationItemRecord(
                        normalizedRunId,
                        item,
                        runtime,
                        settings
                    );

                await runtime.db
                    .collection(
                        settings.itemCollection
                    )
                    .doc(
                        record.id
                    )
                    .set(
                        record,
                        {
                            merge:
                                false
                        }
                    );

                written +=
                    1;
            }
        }
    }

    return written;
}

function createReconciliationItemRecord(
    runId,
    item,
    runtime,
    options
) {
    const settings =
        options || {};

    const now =
        resolveNow(
            runtime,
            settings
        );

    return {
        id:
            createPersistedReconciliationItemId(
                runId,
                item.id
            ),

        runId:
            runId,

        key:
            item.key,

        type:
            normalizeReconciliationItemType(
                item.type
            ),

        status:
            normalizeReconciliationItemStatus(
                item.status
            ),

        internalRecord:
            cloneValue(
                item.internalRecord
            ),

        externalRecord:
            cloneValue(
                item.externalRecord
            ),

        internalRecords:
            cloneValue(
                item.internalRecords
            ),

        externalRecords:
            cloneValue(
                item.externalRecords
            ),

        amountDifferenceMinor:
            item.amountDifferenceMinor,

        resolution:
            cloneValue(
                item.resolution
            ),

        ignoreReason:
            item.ignoreReason ||
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

        resolvedAt:
            item.resolvedAt
                ? createDatabaseTimestamp(
                      runtime,
                      toMilliseconds(
                          item.resolvedAt
                      )
                  )
                : null,

        ignoredAt:
            item.ignoredAt
                ? createDatabaseTimestamp(
                      runtime,
                      toMilliseconds(
                          item.ignoredAt
                      )
                  )
                : null,

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
   GET RUN
========================================================== */

async function getReconciliationRun(
    runtime,
    runId,
    options
) {
    const settings =
        normalizeReconciliationOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return null;
    }

    assertReconciliationRuntime(
        runtime
    );

    const id =
        normalizeReconciliationRunId(
            runId
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

    return sanitizeReconciliationRunRecord(
        snapshot.data()
    );
}

/* ==========================================================
   QUERY RUNS
========================================================== */

async function queryReconciliationRuns(
    runtime,
    filters,
    options
) {
    const settings =
        normalizeReconciliationOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return [];
    }

    assertReconciliationRuntime(
        runtime
    );

    const normalized =
        normalizeReconciliationQuery(
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
        normalized.currency
    ) {
        query =
            query.where(
                "currency",
                "==",
                normalized.currency
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
        normalized.startedAfter
    ) {
        query =
            query.where(
                "startedAt",
                ">=",
                createDatabaseTimestamp(
                    runtime,
                    normalized
                        .startedAfter
                )
            );
    }

    if (
        normalized.startedBefore
    ) {
        query =
            query.where(
                "startedAt",
                "<=",
                createDatabaseTimestamp(
                    runtime,
                    normalized
                        .startedBefore
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
            return sanitizeReconciliationRunRecord(
                document.data()
            );
        }
    );
}

function normalizeReconciliationQuery(
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
                ? normalizeReconciliationStatus(
                      source.status
                  )
                : null,

        currency:
            source.currency
                ? normalizeCurrency(
                      source.currency
                  )
                : null,

        source:
            source.source
                ? normalizeReconciliationSource(
                      source.source
                  )
                : null,

        startedAfter:
            source.startedAfter !==
            undefined
                ? normalizeReconciliationDate(
                      source.startedAfter,
                      "Reconciliation start filter"
                  )
                : null,

        startedBefore:
            source.startedBefore !==
            undefined
                ? normalizeReconciliationDate(
                      source.startedBefore,
                      "Reconciliation start filter"
                  )
                : null,

        orderBy:
            normalizeReconciliationOrderField(
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
   QUERY ITEMS
========================================================== */

async function queryReconciliationItems(
    runtime,
    filters,
    options
) {
    const settings =
        normalizeReconciliationOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return [];
    }

    assertReconciliationRuntime(
        runtime
    );

    const normalized =
        normalizeReconciliationItemQuery(
            filters,
            settings
        );

    let query =
        runtime.db
            .collection(
                settings.itemCollection
            );

    if (
        normalized.runId
    ) {
        query =
            query.where(
                "runId",
                "==",
                normalized.runId
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
            return sanitizeReconciliationItemRecord(
                document.data()
            );
        }
    );
}

function normalizeReconciliationItemQuery(
    filters,
    options
) {
    const source =
        filters || {};

    const settings =
        options || {};

    return {
        runId:
            source.runId
                ? normalizeReconciliationRunId(
                      source.runId
                  )
                : null,

        status:
            source.status
                ? normalizeReconciliationItemStatus(
                      source.status
                  )
                : null,

        type:
            source.type
                ? normalizeReconciliationItemType(
                      source.type
                  )
                : null,

        orderBy:
            normalizeReconciliationItemOrderField(
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
   RESOLVE AND IGNORE ITEMS
========================================================== */

async function resolveReconciliationItem(
    runtime,
    itemId,
    resolution,
    options
) {
    return setReconciliationItemStatus(
        runtime,
        itemId,
        RECONCILIATION_ITEM_STATUSES
            .resolved,
        {
            resolution:
                resolution
        },
        options
    );
}

async function ignoreReconciliationItem(
    runtime,
    itemId,
    reason,
    options
) {
    return setReconciliationItemStatus(
        runtime,
        itemId,
        RECONCILIATION_ITEM_STATUSES
            .ignored,
        {
            ignoreReason:
                reason
        },
        options
    );
}

async function setReconciliationItemStatus(
    runtime,
    itemId,
    status,
    values,
    options
) {
    const settings =
        normalizeReconciliationOptions(
            options
        );

    const id =
        normalizeReconciliationItemId(
            itemId
        );

    const normalizedStatus =
        normalizeReconciliationItemStatus(
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

            itemId:
                id,

            status:
                normalizedStatus
        };
    }

    assertReconciliationRuntime(
        runtime
    );

    const reference =
        runtime.db
            .collection(
                settings.itemCollection
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
                        throw createReconciliationItemNotFoundError(
                            id
                        );
                    }

                    const existing =
                        snapshot.data();

                    if (
                        normalizeReconciliationItemStatus(
                            existing.status
                        ) !==
                        RECONCILIATION_ITEM_STATUSES
                            .open
                    ) {
                        throw new ServiceError(
                            "failed-precondition",
                            "A closed reconciliation item cannot change status.",
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
                            normalizedStatus,

                        updatedAt:
                            createDatabaseTimestamp(
                                runtime,
                                now
                            )
                    };

                    if (
                        normalizedStatus ===
                        RECONCILIATION_ITEM_STATUSES
                            .resolved
                    ) {
                        assertSerializableReconciliationValue(
                            values &&
                            values.resolution,
                            settings
                                .maxMetadataBytes,
                            "Reconciliation resolution"
                        );

                        update.resolution =
                            cloneValue(
                                values &&
                                values.resolution
                            );

                        update.resolvedAt =
                            createDatabaseTimestamp(
                                runtime,
                                now
                            );
                    }

                    if (
                        normalizedStatus ===
                        RECONCILIATION_ITEM_STATUSES
                            .ignored
                    ) {
                        update.ignoreReason =
                            normalizeOptionalString(
                                values &&
                                values.ignoreReason
                            );

                        update.ignoredAt =
                            createDatabaseTimestamp(
                                runtime,
                                now
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

    logReconciliationItemEvent(
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

        itemId:
            id,

        status:
            normalizedStatus,

        item:
            sanitizeReconciliationItemRecord(
                record
            )
    };
}

/* ==========================================================
   CANCEL RUN
========================================================== */

async function cancelReconciliationRun(
    runtime,
    runId,
    reason,
    options
) {
    const settings =
        normalizeReconciliationOptions(
            options
        );

    const id =
        normalizeReconciliationRunId(
            runId
        );

    if (
        settings.disabled
    ) {
        return {
            cancelled:
                false,

            disabled:
                true,

            runId:
                id
        };
    }

    assertReconciliationRuntime(
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
                        throw createReconciliationRunNotFoundError(
                            id
                        );
                    }

                    const existing =
                        snapshot.data();

                    if (
                        TERMINAL_RECONCILIATION_STATUSES
                            .includes(
                                normalizeReconciliationStatus(
                                    existing.status
                                )
                            )
                    ) {
                        throw new ServiceError(
                            "failed-precondition",
                            "A terminal reconciliation run cannot be cancelled.",
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
                            RECONCILIATION_STATUSES
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

                        completedAt:
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

    const result =
        sanitizeReconciliationRunRecord(
            record
        );

    logReconciliationEvent(
        runtime,
        result,
        "cancelled",
        settings
    );

    return {
        cancelled:
            true,

        disabled:
            false,

        runId:
            id,

        reconciliation:
            result
    };
}

/* ==========================================================
   INPUT AND RECORD NORMALIZATION
========================================================== */

function normalizeReconciliationInput(
    input,
    options
) {
    const source =
        input || {};

    if (
        typeof source !==
            "object" ||
        Array.isArray(
            source
        )
    ) {
        throw new TypeError(
            "Reconciliation input must be an object."
        );
    }

    const settings =
        normalizeReconciliationOptions(
            options
        );

    return {
        id:
            source.id
                ? normalizeReconciliationRunId(
                      source.id
                  )
                : null,

        source:
            normalizeReconciliationSource(
                source.source ||
                settings.defaultSource
            ),

        currency:
            normalizeCurrency(
                source.currency ||
                settings.defaultCurrency
            ),

        periodStart:
            source.periodStart !==
                undefined &&
            source.periodStart !==
                null
                ? normalizeReconciliationDate(
                      source.periodStart,
                      "Reconciliation period start"
                  )
                : null,

        periodEnd:
            source.periodEnd !==
                undefined &&
            source.periodEnd !==
                null
                ? normalizeReconciliationDate(
                      source.periodEnd,
                      "Reconciliation period end"
                  )
                : null,

        internalRecords:
            normalizeReconciliationRecords(
                source.internalRecords ||
                source.internal ||
                [],
                "internal",
                settings
            ),

        externalRecords:
            normalizeReconciliationRecords(
                source.externalRecords ||
                source.external ||
                [],
                "external",
                settings
            ),

        metadata:
            sanitizeReconciliationMetadata(
                source.metadata,
                settings
            )
    };
}

function normalizeReconciliationRecords(
    records,
    side,
    options
) {
    const settings =
        options || {};

    if (
        !Array.isArray(
            records
        )
    ) {
        throw new TypeError(
            "Reconciliation " +
            side +
            " records must be an array."
        );
    }

    if (
        records.length >
        settings.maxRecords
    ) {
        throw new ServiceError(
            "resource-exhausted",
            "Too many reconciliation records were provided.",
            {
                status:
                    413,

                expose:
                    true,

                details: {
                    side:
                        side,

                    recordCount:
                        records.length,

                    maximumRecords:
                        settings.maxRecords
                }
            }
        );
    }

    return records.map(
        function (
            record,
            index
        ) {
            return normalizeReconciliationRecord(
                record,
                side,
                index,
                settings
            );
        }
    );
}

function normalizeReconciliationRecord(
    record,
    side,
    index,
    options
) {
    const source =
        record || {};

    if (
        typeof source !==
            "object" ||
        Array.isArray(
            source
        )
    ) {
        throw new TypeError(
            "Reconciliation record must be an object."
        );
    }

    const key =
        normalizeReconciliationKey(
            source.key ||
            source.reference ||
            source.transactionId ||
            source.paymentId ||
            source.orderId ||
            source.id
        );

    const amountMinor =
        normalizeMoneyMinor(
            source.amountMinor !==
                undefined
                ? source.amountMinor
                : source.amount,
            "Reconciliation amount"
        );

    return {
        key:
            key,

        id:
            normalizeOptionalString(
                source.id
            ) ||
            (
                side +
                "-" +
                index
            ),

        reference:
            normalizeOptionalString(
                source.reference
            ),

        amountMinor:
            amountMinor,

        currency:
            normalizeCurrency(
                source.currency ||
                options.defaultCurrency
            ),

        status:
            normalizeReconciliationRecordStatus(
                source.status
            ),

        occurredAt:
            source.occurredAt !==
                undefined &&
            source.occurredAt !==
                null
                ? normalizeReconciliationDate(
                      source.occurredAt,
                      "Reconciliation occurrence date"
                  )
                : null,

        metadata:
            sanitizeReconciliationMetadata(
                source.metadata,
                options
            )
    };
}

/* ==========================================================
   RESULT AND STORAGE RECORDS
========================================================== */

function createReconciliationResult(
    values
) {
    const source =
        values || {};

    const startedAt =
        toMilliseconds(
            source.startedAt
        );

    const completedAt =
        toMilliseconds(
            source.completedAt
        );

    return {
        id:
            normalizeReconciliationRunId(
                source.id
            ),

        status:
            normalizeReconciliationStatus(
                source.status
            ),

        disabled:
            Boolean(
                source.disabled
            ),

        dryRun:
            Boolean(
                source.dryRun
            ),

        source:
            normalizeReconciliationSource(
                source.source
            ),

        currency:
            normalizeCurrency(
                source.currency
            ),

        periodStart:
            serializeTimestamp(
                source.periodStart
            ),

        periodEnd:
            serializeTimestamp(
                source.periodEnd
            ),

        internalCount:
            normalizeNonNegativeInteger(
                source.internalCount,
                0,
                "Internal reconciliation count"
            ),

        externalCount:
            normalizeNonNegativeInteger(
                source.externalCount,
                0,
                "External reconciliation count"
            ),

        matchedCount:
            normalizeNonNegativeInteger(
                source.matchedCount,
                0,
                "Matched reconciliation count"
            ),

        discrepancyCount:
            normalizeNonNegativeInteger(
                source.discrepancyCount,
                0,
                "Reconciliation discrepancy count"
            ),

        missingInternalCount:
            normalizeNonNegativeInteger(
                source.missingInternalCount,
                0,
                "Missing internal count"
            ),

        missingExternalCount:
            normalizeNonNegativeInteger(
                source.missingExternalCount,
                0,
                "Missing external count"
            ),

        amountMismatchCount:
            normalizeNonNegativeInteger(
                source.amountMismatchCount,
                0,
                "Amount mismatch count"
            ),

        currencyMismatchCount:
            normalizeNonNegativeInteger(
                source.currencyMismatchCount,
                0,
                "Currency mismatch count"
            ),

        statusMismatchCount:
            normalizeNonNegativeInteger(
                source.statusMismatchCount,
                0,
                "Status mismatch count"
            ),

        duplicateInternalCount:
            normalizeNonNegativeInteger(
                source.duplicateInternalCount,
                0,
                "Duplicate internal count"
            ),

        duplicateExternalCount:
            normalizeNonNegativeInteger(
                source.duplicateExternalCount,
                0,
                "Duplicate external count"
            ),

        internalTotalMinor:
            normalizeInteger(
                source.internalTotalMinor,
                0,
                "Internal reconciliation total"
            ),

        externalTotalMinor:
            normalizeInteger(
                source.externalTotalMinor,
                0,
                "External reconciliation total"
            ),

        differenceMinor:
            normalizeInteger(
                source.differenceMinor,
                0,
                "Reconciliation difference"
            ),

        metadata:
            cloneValue(
                source.metadata
            ) ||
            {},

        error:
            source.error
                ? cloneValue(
                      source.error
                  )
                : null,

        items:
            Array.isArray(
                source.items
            )
                ? cloneValue(
                      source.items
                  )
                : [],

        startedAt:
            serializeTimestamp(
                startedAt
            ),

        completedAt:
            serializeTimestamp(
                completedAt
            ),

        durationMs:
            calculateDuration(
                startedAt,
                completedAt
            )
    };
}

function createReconciliationRunRecord(
    values,
    runtime,
    options
) {
    const result =
        createReconciliationResult(
            values
        );

    const settings =
        options || {};

    const now =
        resolveNow(
            runtime,
            settings
        );

    return {
        id:
            result.id,

        status:
            result.status,

        disabled:
            result.disabled,

        dryRun:
            result.dryRun,

        source:
            result.source,

        currency:
            result.currency,

        periodStart:
            result.periodStart
                ? createDatabaseTimestamp(
                      runtime,
                      toMilliseconds(
                          result.periodStart
                      )
                  )
                : null,

        periodEnd:
            result.periodEnd
                ? createDatabaseTimestamp(
                      runtime,
                      toMilliseconds(
                          result.periodEnd
                      )
                  )
                : null,

        internalCount:
            result.internalCount,

        externalCount:
            result.externalCount,

        matchedCount:
            result.matchedCount,

        discrepancyCount:
            result.discrepancyCount,

        missingInternalCount:
            result.missingInternalCount,

        missingExternalCount:
            result.missingExternalCount,

        amountMismatchCount:
            result.amountMismatchCount,

        currencyMismatchCount:
            result.currencyMismatchCount,

        statusMismatchCount:
            result.statusMismatchCount,

        duplicateInternalCount:
            result.duplicateInternalCount,

        duplicateExternalCount:
            result.duplicateExternalCount,

        internalTotalMinor:
            result.internalTotalMinor,

        externalTotalMinor:
            result.externalTotalMinor,

        differenceMinor:
            result.differenceMinor,

        metadata:
            cloneValue(
                result.metadata
            ),

        error:
            cloneValue(
                result.error
            ),

        cancellationReason:
            values.cancellationReason ||
            null,

        startedAt:
            result.startedAt
                ? createDatabaseTimestamp(
                      runtime,
                      toMilliseconds(
                          result.startedAt
                      )
                  )
                : null,

        completedAt:
            result.completedAt
                ? createDatabaseTimestamp(
                      runtime,
                      toMilliseconds(
                          result.completedAt
                      )
                  )
                : null,

        cancelledAt:
            values.cancelledAt
                ? createDatabaseTimestamp(
                      runtime,
                      toMilliseconds(
                          values.cancelledAt
                      )
                  )
                : null,

        createdAt:
            createDatabaseTimestamp(
                runtime,
                result.startedAt
                    ? toMilliseconds(
                          result.startedAt
                      )
                    : now
            ),

        updatedAt:
            createDatabaseTimestamp(
                runtime,
                now
            ),

        expiresAt:
            settings.retentionMs
                ? createDatabaseTimestamp(
                      runtime,
                      (
                          result.completedAt
                              ? toMilliseconds(
                                    result.completedAt
                                )
                              : now
                      ) +
                      settings.retentionMs
                  )
                : null,

        schemaVersion:
            1
    };
}

/* ==========================================================
   SANITIZATION
========================================================== */

function sanitizeReconciliationRunRecord(
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

        status:
            normalizeReconciliationStatus(
                record.status
            ),

        disabled:
            Boolean(
                record.disabled
            ),

        dryRun:
            Boolean(
                record.dryRun
            ),

        source:
            normalizeReconciliationSource(
                record.source
            ),

        currency:
            normalizeCurrency(
                record.currency
            ),

        periodStart:
            serializeTimestamp(
                record.periodStart
            ),

        periodEnd:
            serializeTimestamp(
                record.periodEnd
            ),

        internalCount:
            normalizeNonNegativeInteger(
                record.internalCount,
                0,
                "Internal reconciliation count"
            ),

        externalCount:
            normalizeNonNegativeInteger(
                record.externalCount,
                0,
                "External reconciliation count"
            ),

        matchedCount:
            normalizeNonNegativeInteger(
                record.matchedCount,
                0,
                "Matched reconciliation count"
            ),

        discrepancyCount:
            normalizeNonNegativeInteger(
                record.discrepancyCount,
                0,
                "Reconciliation discrepancy count"
            ),

        missingInternalCount:
            normalizeNonNegativeInteger(
                record.missingInternalCount,
                0,
                "Missing internal count"
            ),

        missingExternalCount:
            normalizeNonNegativeInteger(
                record.missingExternalCount,
                0,
                "Missing external count"
            ),

        amountMismatchCount:
            normalizeNonNegativeInteger(
                record.amountMismatchCount,
                0,
                "Amount mismatch count"
            ),

        currencyMismatchCount:
            normalizeNonNegativeInteger(
                record.currencyMismatchCount,
                0,
                "Currency mismatch count"
            ),

        statusMismatchCount:
            normalizeNonNegativeInteger(
                record.statusMismatchCount,
                0,
                "Status mismatch count"
            ),

        duplicateInternalCount:
            normalizeNonNegativeInteger(
                record.duplicateInternalCount,
                0,
                "Duplicate internal count"
            ),

        duplicateExternalCount:
            normalizeNonNegativeInteger(
                record.duplicateExternalCount,
                0,
                "Duplicate external count"
            ),

        internalTotalMinor:
            normalizeInteger(
                record.internalTotalMinor,
                0,
                "Internal reconciliation total"
            ),

        externalTotalMinor:
            normalizeInteger(
                record.externalTotalMinor,
                0,
                "External reconciliation total"
            ),

        differenceMinor:
            normalizeInteger(
                record.differenceMinor,
                0,
                "Reconciliation difference"
            ),

        metadata:
            cloneValue(
                record.metadata
            ) ||
            {},

        error:
            cloneValue(
                record.error
            ),

        cancellationReason:
            record.cancellationReason ||
            null,

        startedAt:
            serializeTimestamp(
                record.startedAt
            ),

        completedAt:
            serializeTimestamp(
                record.completedAt
            ),

        cancelledAt:
            serializeTimestamp(
                record.cancelledAt
            ),

        createdAt:
            serializeTimestamp(
                record.createdAt
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

function sanitizeReconciliationItemRecord(
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

        runId:
            record.runId,

        key:
            record.key,

        type:
            normalizeReconciliationItemType(
                record.type
            ),

        status:
            normalizeReconciliationItemStatus(
                record.status
            ),

        internalRecord:
            cloneValue(
                record.internalRecord
            ),

        externalRecord:
            cloneValue(
                record.externalRecord
            ),

        internalRecords:
            cloneValue(
                record.internalRecords
            ) ||
            [],

        externalRecords:
            cloneValue(
                record.externalRecords
            ) ||
            [],

        amountDifferenceMinor:
            record.amountDifferenceMinor ===
                null ||
            record.amountDifferenceMinor ===
                undefined
                ? null
                : normalizeInteger(
                      record.amountDifferenceMinor,
                      0,
                      "Reconciliation item difference"
                  ),

        resolution:
            cloneValue(
                record.resolution
            ),

        ignoreReason:
            record.ignoreReason ||
            null,

        createdAt:
            serializeTimestamp(
                record.createdAt
            ),

        updatedAt:
            serializeTimestamp(
                record.updatedAt
            ),

        resolvedAt:
            serializeTimestamp(
                record.resolvedAt
            ),

        ignoredAt:
            serializeTimestamp(
                record.ignoredAt
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

function normalizeReconciliationRunId(
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
            "The reconciliation run ID is invalid.",
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

function normalizeReconciliationItemId(
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
            "The reconciliation item ID is invalid.",
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

function normalizeReconciliationKey(
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
            "A reconciliation record key is required.",
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

function normalizeReconciliationStatus(
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
            RECONCILIATION_STATUSES
        ).includes(
            normalized
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The reconciliation status is invalid.",
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

function normalizeReconciliationItemStatus(
    value
) {
    const normalized =
        String(
            value ||
            DEFAULT_ITEM_STATUS
        )
            .trim()
            .toLowerCase();

    if (
        !Object.values(
            RECONCILIATION_ITEM_STATUSES
        ).includes(
            normalized
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The reconciliation item status is invalid.",
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

function normalizeReconciliationItemType(
    value
) {
    const normalized =
        String(
            value || ""
        )
            .trim()
            .toLowerCase();

    if (
        !Object.values(
            RECONCILIATION_ITEM_TYPES
        ).includes(
            normalized
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The reconciliation item type is invalid.",
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

function normalizeReconciliationSource(
    value
) {
    const normalized =
        String(
            value ||
            "payments"
        )
            .trim()
            .toLowerCase()
            .replace(
                /[^a-z0-9._:-]/g,
                "-"
            );

    return normalized ||
        "payments";
}

function normalizeCurrency(
    value
) {
    const normalized =
        String(
            value ||
            DEFAULT_CURRENCY
        )
            .trim()
            .toUpperCase();

    if (
        !/^[A-Z]{3}$/
            .test(
                normalized
            )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The reconciliation currency is invalid.",
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

function normalizeMoneyMinor(
    value,
    label
) {
    const normalized =
        Number(
            value
        );

    if (
        !Number.isInteger(
            normalized
        )
    ) {
        throw new TypeError(
            label +
            " must be an integer in minor currency units."
        );
    }

    return normalized;
}

function normalizeReconciliationRecordStatus(
    value
) {
    return String(
        value ||
        "unknown"
    )
        .trim()
        .toLowerCase()
        .replace(
            /[^a-z0-9._:-]/g,
            "-"
        ) ||
        "unknown";
}

function normalizeReconciliationDate(
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

function normalizeReconciliationOrderField(
    value
) {
    const allowed =
        new Set([
            "startedAt",
            "completedAt",
            "createdAt",
            "updatedAt",
            "status",
            "discrepancyCount",
            "differenceMinor"
        ]);

    const normalized =
        String(
            value ||
            "startedAt"
        ).trim();

    return allowed.has(
        normalized
    )
        ? normalized
        : "startedAt";
}

function normalizeReconciliationItemOrderField(
    value
) {
    const allowed =
        new Set([
            "createdAt",
            "updatedAt",
            "key",
            "type",
            "status",
            "amountDifferenceMinor"
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
            "Reconciliation query limit must be a positive integer."
        );
    }

    return Math.min(
        normalized,
        MAX_QUERY_LIMIT
    );
}

function normalizeBatchSize(
    value
) {
    const normalized =
        normalizePositiveInteger(
            value,
            DEFAULT_BATCH_SIZE,
            "Reconciliation batch size"
        );

    return Math.min(
        normalized,
        MAX_BATCH_SIZE
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

function normalizeInteger(
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
        )
    ) {
        throw new TypeError(
            label +
            " must be an integer."
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
    value,
    label
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
            (
                label ||
                "Reconciliation collection"
            ) +
            " must be a Firestore collection name."
        );
    }

    return normalized;
}

/* ==========================================================
   OPTIONS
========================================================== */

function normalizeReconciliationOptions(
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
                RECONCILIATION_COLLECTION,
                "Reconciliation collection"
            ),

        itemCollection:
            normalizeCollection(
                settings.itemCollection ||
                RECONCILIATION_ITEM_COLLECTION,
                "Reconciliation item collection"
            ),

        defaultSource:
            normalizeReconciliationSource(
                settings.defaultSource ||
                "payments"
            ),

        defaultCurrency:
            normalizeCurrency(
                settings.defaultCurrency ||
                DEFAULT_CURRENCY
            ),

        toleranceMinor:
            normalizeNonNegativeInteger(
                settings.toleranceMinor,
                DEFAULT_TOLERANCE_MINOR,
                "Reconciliation tolerance"
            ),

        queryLimit:
            normalizeQueryLimit(
                settings.queryLimit
            ),

        batchSize:
            normalizeBatchSize(
                settings.batchSize
            ),

        maxRecords:
            normalizePositiveInteger(
                settings.maxRecords,
                DEFAULT_MAX_RECORDS,
                "Maximum reconciliation records"
            ),

        retentionMs:
            normalizeNonNegativeInteger(
                settings.retentionMs,
                DEFAULT_RETENTION_MS,
                "Reconciliation retention"
            ),

        maxMetadataBytes:
            normalizePositiveInteger(
                settings.maxMetadataBytes,
                DEFAULT_MAX_METADATA_BYTES,
                "Maximum reconciliation metadata size"
            ),

        compareStatus:
            settings.compareStatus !==
            false,

        includeMatches:
            Boolean(
                settings.includeMatches
            ),

        persistRuns:
            settings.persistRuns !==
            false,

        persistItems:
            settings.persistItems !==
            false,

        returnFailures:
            settings.returnFailures !==
            false,

        dryRun:
            Boolean(
                settings.dryRun
            ),

        disabled:
            Boolean(
                settings.disabled
            ),

        log:
            settings.log !==
            false,

        runId:
            settings.runId
                ? normalizeReconciliationRunId(
                      settings.runId
                  )
                : null,

        now:
            settings.now
    };
}

/* ==========================================================
   IDS AND SERIALIZATION
========================================================== */

function createReconciliationRunId(
    now
) {
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

function createReconciliationItemId(
    key,
    type
) {
    return hashReconciliationValue(
        normalizeReconciliationKey(
            key
        ) +
        ":" +
        normalizeReconciliationItemType(
            type
        )
    );
}

function createPersistedReconciliationItemId(
    runId,
    itemId
) {
    return hashReconciliationValue(
        normalizeReconciliationRunId(
            runId
        ) +
        ":" +
        normalizeReconciliationItemId(
            itemId
        )
    );
}

function hashReconciliationValue(
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
            "Reconciliation data contains a circular reference.",
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

function assertSerializableReconciliationValue(
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

function sanitizeReconciliationMetadata(
    value,
    options
) {
    const settings =
        options || {};

    if (
        value === undefined ||
        value === null
    ) {
        return {};
    }

    const normalized =
        typeof value ===
            "object" &&
        !Array.isArray(
            value
        )
            ? cloneValue(
                  value
              )
            : {
                  value:
                      cloneValue(
                          value
                      )
              };

    assertSerializableReconciliationValue(
        normalized,
        settings.maxMetadataBytes ||
        DEFAULT_MAX_METADATA_BYTES,
        "Reconciliation metadata"
    );

    return normalized;
}

/* ==========================================================
   ERROR HELPERS
========================================================== */

function serializeReconciliationError(
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
            "reconciliation-failed",

        message:
            error.publicMessage ||
            error.message ||
            "Reconciliation failed.",

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

function createReconciliationRunNotFoundError(
    runId
) {
    return new ServiceError(
        "not-found",
        "The reconciliation run was not found.",
        {
            status:
                404,

            expose:
                true,

            details: {
                runId:
                    runId
            }
        }
    );
}

function createReconciliationItemNotFoundError(
    itemId
) {
    return new ServiceError(
        "not-found",
        "The reconciliation item was not found.",
        {
            status:
                404,

            expose:
                true,

            details: {
                itemId:
                    itemId
            }
        }
    );
}

/* ==========================================================
   RUNTIME AND TIME
========================================================== */

function assertReconciliationRuntime(
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
            "The reconciliation datastore is unavailable.",
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
            "Firestore transactions are required for reconciliation.",
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

function calculateDuration(
    startedAt,
    completedAt
) {
    if (
        !Number.isFinite(
            startedAt
        ) ||
        !Number.isFinite(
            completedAt
        ) ||
        startedAt <=
            0 ||
        completedAt <=
            0
    ) {
        return 0;
    }

    return Math.max(
        0,
        completedAt -
        startedAt
    );
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

function logReconciliationEvent(
    runtime,
    result,
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

        runId:
            result &&
            result.id,

        status:
            result &&
            result.status,

        currency:
            result &&
            result.currency,

        internalCount:
            result &&
            result.internalCount,

        externalCount:
            result &&
            result.externalCount,

        matchedCount:
            result &&
            result.matchedCount,

        discrepancyCount:
            result &&
            result.discrepancyCount,

        differenceMinor:
            result &&
            result.differenceMinor,

        dryRun:
            result &&
            result.dryRun,

        durationMs:
            result &&
            result.durationMs
    };

    if (
        result &&
        result.status ===
            RECONCILIATION_STATUSES
                .failed &&
        typeof runtime.logger.error ===
            "function"
    ) {
        runtime.logger.error(
            "Reconciliation failed.",
            metadata
        );

        return;
    }

    if (
        result &&
        (
            result.status ===
                RECONCILIATION_STATUSES
                    .partial ||
            result.status ===
                RECONCILIATION_STATUSES
                    .cancelled
        ) &&
        typeof runtime.logger.warn ===
            "function"
    ) {
        runtime.logger.warn(
            "Reconciliation completed with discrepancies.",
            metadata
        );

        return;
    }

    if (
        typeof runtime.logger.info ===
        "function"
    ) {
        runtime.logger.info(
            "Reconciliation event.",
            metadata
        );
    }
}

function logReconciliationItemEvent(
    runtime,
    item,
    event,
    options
) {
    const settings =
        options || {};

    if (
        !settings.log ||
        !runtime ||
        !runtime.logger ||
        typeof runtime.logger.info !==
            "function"
    ) {
        return;
    }

    runtime.logger.info(
        "Reconciliation item event.",
        {
            event:
                event,

            itemId:
                item &&
                item.id,

            runId:
                item &&
                item.runId,

            type:
                item &&
                item.type,

            status:
                item &&
                item.status
        }
    );
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    createReconciliationService,
    runReconciliation,
    compareReconciliationRecords,
    groupReconciliationRecords,
    createReconciliationItem,
    persistReconciliationItems,
    createReconciliationItemRecord,
    getReconciliationRun,
    queryReconciliationRuns,
    normalizeReconciliationQuery,
    queryReconciliationItems,
    normalizeReconciliationItemQuery,
    resolveReconciliationItem,
    ignoreReconciliationItem,
    setReconciliationItemStatus,
    cancelReconciliationRun,
    normalizeReconciliationInput,
    normalizeReconciliationRecords,
    normalizeReconciliationRecord,
    createReconciliationResult,
    createReconciliationRunRecord,
    sanitizeReconciliationRunRecord,
    sanitizeReconciliationItemRecord,
    normalizeReconciliationRunId,
    normalizeReconciliationItemId,
    normalizeReconciliationKey,
    normalizeReconciliationStatus,
    normalizeReconciliationItemStatus,
    normalizeReconciliationItemType,
    normalizeReconciliationSource,
    normalizeCurrency,
    normalizeMoneyMinor,
    normalizeReconciliationRecordStatus,
    normalizeReconciliationDate,
    normalizeReconciliationOrderField,
    normalizeReconciliationItemOrderField,
    normalizeQueryLimit,
    normalizeBatchSize,
    normalizePositiveInteger,
    normalizeNonNegativeInteger,
    normalizeInteger,
    normalizeOptionalString,
    normalizeCollection,
    normalizeReconciliationOptions,
    createReconciliationRunId,
    createReconciliationItemId,
    createPersistedReconciliationItemId,
    hashReconciliationValue,
    stableStringify,
    normalizeStableValue,
    assertSerializableReconciliationValue,
    sanitizeReconciliationMetadata,
    serializeReconciliationError,
    createReconciliationRunNotFoundError,
    createReconciliationItemNotFoundError,
    assertReconciliationRuntime,
    resolveNow,
    createDatabaseTimestamp,
    toMilliseconds,
    serializeTimestamp,
    calculateDuration,
    logReconciliationEvent,
    logReconciliationItemEvent,
    constants: {
        RECONCILIATION_COLLECTION,
        RECONCILIATION_ITEM_COLLECTION,
        DEFAULT_STATUS,
        DEFAULT_ITEM_STATUS,
        DEFAULT_CURRENCY,
        DEFAULT_TOLERANCE_MINOR,
        DEFAULT_QUERY_LIMIT,
        MAX_QUERY_LIMIT,
        DEFAULT_BATCH_SIZE,
        MAX_BATCH_SIZE,
        DEFAULT_MAX_RECORDS,
        DEFAULT_RETENTION_MS,
        DEFAULT_MAX_METADATA_BYTES,
        RECONCILIATION_STATUSES,
        RECONCILIATION_ITEM_STATUSES,
        RECONCILIATION_ITEM_TYPES,
        TERMINAL_RECONCILIATION_STATUSES,
        DISCREPANCY_TYPES
    }
};