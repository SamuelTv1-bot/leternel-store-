"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   BACKUP SERVICE

   Responsibilities:
   - Export Firestore collections into portable backup records
   - Restore backup records safely and idempotently
   - Validate backup payloads and manifests
   - Track backup and restore runs
   - Support dry-run, disabled, overwrite, and merge modes
   - Provide retention metadata and operational summaries
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

const BACKUP_COLLECTION =
    "_backupRuns";

const DEFAULT_STATUS =
    "pending";

const DEFAULT_FORMAT =
    "json";

const DEFAULT_BATCH_SIZE =
    100;

const MAX_BATCH_SIZE =
    500;

const DEFAULT_QUERY_LIMIT =
    100;

const MAX_QUERY_LIMIT =
    500;

const DEFAULT_MAX_COLLECTIONS =
    100;

const DEFAULT_MAX_DOCUMENTS =
    50000;

const DEFAULT_MAX_BACKUP_BYTES =
    25 * 1024 * 1024;

const DEFAULT_RETENTION_MS =
    90 * 24 * 60 * 60 * 1000;

const DEFAULT_SCHEMA_VERSION =
    1;

const BACKUP_STATUSES =
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

const BACKUP_OPERATION_TYPES =
    Object.freeze({
        export:
            "export",

        restore:
            "restore"
    });

const RESTORE_MODES =
    Object.freeze({
        create:
            "create",

        merge:
            "merge",

        overwrite:
            "overwrite"
    });

const TERMINAL_BACKUP_STATUSES =
    Object.freeze([
        BACKUP_STATUSES.completed,
        BACKUP_STATUSES.partial,
        BACKUP_STATUSES.failed,
        BACKUP_STATUSES.cancelled,
        BACKUP_STATUSES.disabled
    ]);

/* ==========================================================
   SERVICE FACTORY
========================================================== */

function createBackupService(
    options
) {
    const settings =
        normalizeBackupOptions(
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

        export:
            function (
                input,
                overrides
            ) {
                return exportBackup(
                    runtime,
                    input,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        restore:
            function (
                backup,
                overrides
            ) {
                return restoreBackup(
                    runtime,
                    backup,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        inspect:
            function (
                backup,
                overrides
            ) {
                return inspectBackup(
                    backup,
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
                return getBackupRun(
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
                return queryBackupRuns(
                    runtime,
                    filters,
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
                return cancelBackupRun(
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
   EXPORT
========================================================== */

async function exportBackup(
    runtime,
    input,
    options
) {
    const settings =
        normalizeBackupOptions(
            options
        );

    const source =
        normalizeBackupExportInput(
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
        createBackupRunId(
            startedAt
        );

    if (
        settings.disabled
    ) {
        return createBackupResult({
            id:
                runId,

            operation:
                BACKUP_OPERATION_TYPES
                    .export,

            status:
                BACKUP_STATUSES
                    .disabled,

            disabled:
                true,

            dryRun:
                settings.dryRun,

            collections:
                source.collections,

            startedAt:
                startedAt,

            completedAt:
                startedAt,

            backup:
                null
        });
    }

    assertBackupRuntime(
        runtime
    );

    const runningRecord =
        createBackupRunRecord(
            {
                id:
                    runId,

                operation:
                    BACKUP_OPERATION_TYPES
                        .export,

                status:
                    BACKUP_STATUSES
                        .running,

                disabled:
                    false,

                dryRun:
                    settings.dryRun,

                collections:
                    source.collections,

                startedAt:
                    startedAt,

                completedAt:
                    null
            },
            runtime,
            settings
        );

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

    const collectionResults =
        [];

    const backupCollections =
        {};

    let documentCount =
        0;

    let errorCount =
        0;

    try {
        for (
            const collectionName of
            source.collections
        ) {
            try {
                const records =
                    await exportBackupCollection(
                        runtime,
                        collectionName,
                        settings
                    );

                documentCount +=
                    records.length;

                if (
                    documentCount >
                    settings.maxDocuments
                ) {
                    throw new ServiceError(
                        "resource-exhausted",
                        "The backup contains too many documents.",
                        {
                            status:
                                413,

                            expose:
                                true,

                            details: {
                                documentCount:
                                    documentCount,

                                maximumDocuments:
                                    settings.maxDocuments
                            }
                        }
                    );
                }

                backupCollections[
                    collectionName
                ] =
                    records;

                collectionResults.push({
                    collection:
                        collectionName,

                    status:
                        "completed",

                    documentCount:
                        records.length,

                    error:
                        null
                });
            } catch (error) {
                errorCount +=
                    1;

                collectionResults.push({
                    collection:
                        collectionName,

                    status:
                        "failed",

                    documentCount:
                        0,

                    error:
                        serializeBackupError(
                            error
                        )
                });

                if (
                    settings.stopOnError
                ) {
                    throw error;
                }
            }
        }

        const manifest =
            createBackupManifest({
                id:
                    runId,

                format:
                    settings.format,

                createdAt:
                    startedAt,

                collections:
                    backupCollections,

                metadata:
                    source.metadata
            });

        const backup = {
            manifest:
                manifest,

            collections:
                backupCollections
        };

        assertSerializableBackupValue(
            backup,
            settings.maxBackupBytes,
            "Backup payload"
        );

        const completedAt =
            resolveNow(
                runtime,
                settings
            );

        const status =
            errorCount >
            0
                ? documentCount >
                  0
                    ? BACKUP_STATUSES
                          .partial
                    : BACKUP_STATUSES
                          .failed
                : BACKUP_STATUSES
                      .completed;

        const result =
            createBackupResult({
                id:
                    runId,

                operation:
                    BACKUP_OPERATION_TYPES
                        .export,

                status:
                    status,

                disabled:
                    false,

                dryRun:
                    settings.dryRun,

                collections:
                    source.collections,

                collectionResults:
                    collectionResults,

                collectionCount:
                    source.collections
                        .length,

                documentCount:
                    documentCount,

                writtenCount:
                    0,

                skippedCount:
                    0,

                errorCount:
                    errorCount,

                backup:
                    backup,

                startedAt:
                    startedAt,

                completedAt:
                    completedAt
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
                    createBackupRunRecord(
                        result,
                        runtime,
                        settings
                    ),
                    {
                        merge:
                            true
                    }
                );
        }

        logBackupEvent(
            runtime,
            result,
            "export-completed",
            settings
        );

        return result;
    } catch (error) {
        const failure =
            createBackupResult({
                id:
                    runId,

                operation:
                    BACKUP_OPERATION_TYPES
                        .export,

                status:
                    BACKUP_STATUSES
                        .failed,

                disabled:
                    false,

                dryRun:
                    settings.dryRun,

                collections:
                    source.collections,

                collectionResults:
                    collectionResults,

                collectionCount:
                    source.collections
                        .length,

                documentCount:
                    documentCount,

                errorCount:
                    errorCount +
                    1,

                error:
                    serializeBackupError(
                        error
                    ),

                backup:
                    null,

                startedAt:
                    startedAt,

                completedAt:
                    resolveNow(
                        runtime,
                        settings
                    )
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
                    createBackupRunRecord(
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

        logBackupEvent(
            runtime,
            failure,
            "export-failed",
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

async function exportBackupCollection(
    runtime,
    collectionName,
    options
) {
    const settings =
        normalizeBackupOptions(
            options
        );

    const collection =
        normalizeCollection(
            collectionName,
            "Backup source collection"
        );

    let query =
        runtime.db
            .collection(
                collection
            );

    if (
        typeof query.orderBy ===
        "function" &&
        settings.orderField
    ) {
        query =
            query.orderBy(
                settings.orderField,
                settings.direction
            );
    }

    if (
        typeof query.limit ===
        "function"
    ) {
        query =
            query.limit(
                settings.maxDocuments
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

            assertSerializableBackupValue(
                data,
                settings.maxBackupBytes,
                "Backup document"
            );

            return {
                id:
                    document.id,

                data:
                    encodeBackupValue(
                        data
                    )
            };
        }
    );
}

/* ==========================================================
   RESTORE
========================================================== */

async function restoreBackup(
    runtime,
    backup,
    options
) {
    const settings =
        normalizeBackupOptions(
            options
        );

    const normalizedBackup =
        normalizeBackupPayload(
            backup,
            settings
        );

    const startedAt =
        resolveNow(
            runtime,
            settings
        );

    const runId =
        settings.runId ||
        createBackupRunId(
            startedAt
        );

    if (
        settings.disabled
    ) {
        return createBackupResult({
            id:
                runId,

            operation:
                BACKUP_OPERATION_TYPES
                    .restore,

            status:
                BACKUP_STATUSES
                    .disabled,

            disabled:
                true,

            dryRun:
                settings.dryRun,

            collections:
                Object.keys(
                    normalizedBackup
                        .collections
                ),

            startedAt:
                startedAt,

            completedAt:
                startedAt
        });
    }

    assertBackupRuntime(
        runtime
    );

    const collections =
        Object.keys(
            normalizedBackup
                .collections
        );

    const runningRecord =
        createBackupRunRecord(
            {
                id:
                    runId,

                operation:
                    BACKUP_OPERATION_TYPES
                        .restore,

                status:
                    BACKUP_STATUSES
                        .running,

                disabled:
                    false,

                dryRun:
                    settings.dryRun,

                collections:
                    collections,

                startedAt:
                    startedAt
            },
            runtime,
            settings
        );

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

    const collectionResults =
        [];

    let documentCount =
        0;

    let writtenCount =
        0;

    let skippedCount =
        0;

    let errorCount =
        0;

    try {
        for (
            const collectionName of
            collections
        ) {
            const records =
                normalizedBackup
                    .collections[
                    collectionName
                ];

            documentCount +=
                records.length;

            try {
                const result =
                    await restoreBackupCollection(
                        runtime,
                        collectionName,
                        records,
                        settings
                    );

                writtenCount +=
                    result.writtenCount;

                skippedCount +=
                    result.skippedCount;

                errorCount +=
                    result.errorCount;

                collectionResults.push(
                    result
                );
            } catch (error) {
                errorCount +=
                    1;

                collectionResults.push({
                    collection:
                        collectionName,

                    status:
                        "failed",

                    documentCount:
                        records.length,

                    writtenCount:
                        0,

                    skippedCount:
                        0,

                    errorCount:
                        1,

                    error:
                        serializeBackupError(
                            error
                        )
                });

                if (
                    settings.stopOnError
                ) {
                    throw error;
                }
            }
        }

        const completedAt =
            resolveNow(
                runtime,
                settings
            );

        const status =
            errorCount >
            0
                ? writtenCount >
                  0 ||
                  skippedCount >
                  0
                    ? BACKUP_STATUSES
                          .partial
                    : BACKUP_STATUSES
                          .failed
                : BACKUP_STATUSES
                      .completed;

        const result =
            createBackupResult({
                id:
                    runId,

                operation:
                    BACKUP_OPERATION_TYPES
                        .restore,

                status:
                    status,

                disabled:
                    false,

                dryRun:
                    settings.dryRun,

                collections:
                    collections,

                collectionResults:
                    collectionResults,

                collectionCount:
                    collections.length,

                documentCount:
                    documentCount,

                writtenCount:
                    writtenCount,

                skippedCount:
                    skippedCount,

                errorCount:
                    errorCount,

                startedAt:
                    startedAt,

                completedAt:
                    completedAt
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
                    createBackupRunRecord(
                        result,
                        runtime,
                        settings
                    ),
                    {
                        merge:
                            true
                    }
                );
        }

        logBackupEvent(
            runtime,
            result,
            "restore-completed",
            settings
        );

        return result;
    } catch (error) {
        const failure =
            createBackupResult({
                id:
                    runId,

                operation:
                    BACKUP_OPERATION_TYPES
                        .restore,

                status:
                    BACKUP_STATUSES
                        .failed,

                disabled:
                    false,

                dryRun:
                    settings.dryRun,

                collections:
                    collections,

                collectionResults:
                    collectionResults,

                collectionCount:
                    collections.length,

                documentCount:
                    documentCount,

                writtenCount:
                    writtenCount,

                skippedCount:
                    skippedCount,

                errorCount:
                    errorCount +
                    1,

                error:
                    serializeBackupError(
                        error
                    ),

                startedAt:
                    startedAt,

                completedAt:
                    resolveNow(
                        runtime,
                        settings
                    )
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
                    createBackupRunRecord(
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

        logBackupEvent(
            runtime,
            failure,
            "restore-failed",
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

async function restoreBackupCollection(
    runtime,
    collectionName,
    records,
    options
) {
    const settings =
        normalizeBackupOptions(
            options
        );

    const collection =
        normalizeCollection(
            collectionName,
            "Backup destination collection"
        );

    const normalizedRecords =
        normalizeBackupRecords(
            records,
            settings
        );

    let writtenCount =
        0;

    let skippedCount =
        0;

    let errorCount =
        0;

    if (
        settings.dryRun
    ) {
        return {
            collection:
                collection,

            status:
                "completed",

            documentCount:
                normalizedRecords
                    .length,

            writtenCount:
                0,

            skippedCount:
                normalizedRecords
                    .length,

            errorCount:
                0,

            error:
                null
        };
    }

    for (
        let index = 0;
        index < normalizedRecords.length;
        index += settings.batchSize
    ) {
        const chunk =
            normalizedRecords.slice(
                index,
                index +
                settings.batchSize
            );

        for (
            const record of
            chunk
        ) {
            try {
                const result =
                    await restoreBackupDocument(
                        runtime,
                        collection,
                        record,
                        settings
                    );

                if (
                    result.written
                ) {
                    writtenCount +=
                        1;
                } else {
                    skippedCount +=
                        1;
                }
            } catch (error) {
                errorCount +=
                    1;

                if (
                    settings.stopOnError
                ) {
                    throw error;
                }
            }
        }
    }

    return {
        collection:
            collection,

        status:
            errorCount >
            0
                ? writtenCount >
                  0 ||
                  skippedCount >
                  0
                    ? "partial"
                    : "failed"
                : "completed",

        documentCount:
            normalizedRecords
                .length,

        writtenCount:
            writtenCount,

        skippedCount:
            skippedCount,

        errorCount:
            errorCount,

        error:
            null
    };
}

async function restoreBackupDocument(
    runtime,
    collectionName,
    record,
    options
) {
    const settings =
        normalizeBackupOptions(
            options
        );

    const reference =
        runtime.db
            .collection(
                collectionName
            )
            .doc(
                record.id
            );

    const decoded =
        decodeBackupValue(
            record.data,
            runtime
        );

    if (
        settings.restoreMode ===
        RESTORE_MODES.overwrite
    ) {
        await reference.set(
            decoded,
            {
                merge:
                    false
            }
        );

        return {
            written:
                true,

            skipped:
                false
        };
    }

    if (
        settings.restoreMode ===
        RESTORE_MODES.merge
    ) {
        await reference.set(
            decoded,
            {
                merge:
                    true
            }
        );

        return {
            written:
                true,

            skipped:
                false
        };
    }

    const snapshot =
        await reference.get();

    if (
        snapshot.exists
    ) {
        return {
            written:
                false,

            skipped:
                true
        };
    }

    await reference.set(
        decoded,
        {
            merge:
                false
        }
    );

    return {
        written:
            true,

        skipped:
            false
    };
}

/* ==========================================================
   INSPECTION
========================================================== */

function inspectBackup(
    backup,
    options
) {
    const settings =
        normalizeBackupOptions(
            options
        );

    const normalized =
        normalizeBackupPayload(
            backup,
            settings
        );

    const collections =
        Object.entries(
            normalized.collections
        ).map(
            function ([
                collectionName,
                records
            ]) {
                return {
                    collection:
                        collectionName,

                    documentCount:
                        records.length
                };
            }
        );

    const documentCount =
        collections.reduce(
            function (
                total,
                item
            ) {
                return (
                    total +
                    item.documentCount
                );
            },
            0
        );

    return {
        valid:
            true,

        id:
            normalized
                .manifest
                .id,

        format:
            normalized
                .manifest
                .format,

        schemaVersion:
            normalized
                .manifest
                .schemaVersion,

        checksum:
            normalized
                .manifest
                .checksum,

        collectionCount:
            collections.length,

        documentCount:
            documentCount,

        collections:
            collections,

        createdAt:
            normalized
                .manifest
                .createdAt,

        metadata:
            cloneValue(
                normalized
                    .manifest
                    .metadata
            )
    };
}

/* ==========================================================
   BACKUP PAYLOAD
========================================================== */

function createBackupManifest(
    values
) {
    const source =
        values || {};

    const collections =
        source.collections ||
        {};

    const collectionNames =
        Object.keys(
            collections
        ).sort();

    const documentCount =
        collectionNames.reduce(
            function (
                total,
                collectionName
            ) {
                const records =
                    collections[
                        collectionName
                    ];

                return (
                    total +
                    (
                        Array.isArray(
                            records
                        )
                            ? records.length
                            : 0
                    )
                );
            },
            0
        );

    const checksum =
        createBackupChecksum(
            collections
        );

    return {
        id:
            normalizeBackupRunId(
                source.id
            ),

        format:
            normalizeBackupFormat(
                source.format
            ),

        schemaVersion:
            DEFAULT_SCHEMA_VERSION,

        createdAt:
            serializeTimestamp(
                source.createdAt
            ),

        collectionCount:
            collectionNames.length,

        documentCount:
            documentCount,

        collections:
            collectionNames,

        checksum:
            checksum,

        metadata:
            sanitizeBackupMetadata(
                source.metadata
            )
    };
}

function normalizeBackupPayload(
    backup,
    options
) {
    const settings =
        normalizeBackupOptions(
            options
        );

    if (
        !backup ||
        typeof backup !==
            "object" ||
        Array.isArray(
            backup
        )
    ) {
        throw new TypeError(
            "Backup payload must be an object."
        );
    }

    const manifest =
        normalizeBackupManifest(
            backup.manifest
        );

    const collections =
        normalizeBackupCollectionsPayload(
            backup.collections,
            settings
        );

    const checksum =
        createBackupChecksum(
            collections
        );

    if (
        settings.verifyChecksum &&
        manifest.checksum &&
        manifest.checksum !==
            checksum
    ) {
        throw new ServiceError(
            "data-loss",
            "The backup checksum is invalid.",
            {
                status:
                    422,

                expose:
                    true,

                details: {
                    expected:
                        manifest.checksum,

                    actual:
                        checksum
                }
            }
        );
    }

    const normalized = {
        manifest:
            Object.assign(
                {},
                manifest,
                {
                    checksum:
                        checksum,

                    collectionCount:
                        Object.keys(
                            collections
                        ).length,

                    documentCount:
                        Object.values(
                            collections
                        ).reduce(
                            function (
                                total,
                                records
                            ) {
                                return (
                                    total +
                                    records.length
                                );
                            },
                            0
                        )
                }
            ),

        collections:
            collections
    };

    assertSerializableBackupValue(
        normalized,
        settings.maxBackupBytes,
        "Backup payload"
    );

    return normalized;
}

function normalizeBackupManifest(
    manifest
) {
    const source =
        manifest || {};

    if (
        typeof source !==
            "object" ||
        Array.isArray(
            source
        )
    ) {
        throw new TypeError(
            "Backup manifest must be an object."
        );
    }

    const schemaVersion =
        normalizePositiveInteger(
            source.schemaVersion,
            DEFAULT_SCHEMA_VERSION,
            "Backup schema version"
        );

    if (
        schemaVersion !==
        DEFAULT_SCHEMA_VERSION
    ) {
        throw new ServiceError(
            "failed-precondition",
            "The backup schema version is unsupported.",
            {
                status:
                    409,

                expose:
                    true,

                details: {
                    schemaVersion:
                        schemaVersion
                }
            }
        );
    }

    return {
        id:
            normalizeBackupRunId(
                source.id
            ),

        format:
            normalizeBackupFormat(
                source.format
            ),

        schemaVersion:
            schemaVersion,

        createdAt:
            serializeTimestamp(
                source.createdAt
            ),

        collectionCount:
            normalizeNonNegativeInteger(
                source.collectionCount,
                0,
                "Backup collection count"
            ),

        documentCount:
            normalizeNonNegativeInteger(
                source.documentCount,
                0,
                "Backup document count"
            ),

        collections:
            Array.isArray(
                source.collections
            )
                ? source.collections.map(
                      function (
                          value
                      ) {
                          return normalizeCollection(
                              value,
                              "Backup manifest collection"
                          );
                      }
                  )
                : [],

        checksum:
            normalizeOptionalString(
                source.checksum
            ),

        metadata:
            sanitizeBackupMetadata(
                source.metadata
            )
    };
}

function normalizeBackupCollectionsPayload(
    collections,
    options
) {
    const settings =
        options || {};

    if (
        !collections ||
        typeof collections !==
            "object" ||
        Array.isArray(
            collections
        )
    ) {
        throw new TypeError(
            "Backup collections must be an object."
        );
    }

    const names =
        Object.keys(
            collections
        );

    if (
        names.length >
        settings.maxCollections
    ) {
        throw new ServiceError(
            "resource-exhausted",
            "The backup contains too many collections.",
            {
                status:
                    413,

                expose:
                    true
            }
        );
    }

    let documentCount =
        0;

    return names.reduce(
        function (
            output,
            collectionName
        ) {
            const normalizedCollection =
                normalizeCollection(
                    collectionName,
                    "Backup collection"
                );

            const records =
                normalizeBackupRecords(
                    collections[
                        collectionName
                    ],
                    settings
                );

            documentCount +=
                records.length;

            if (
                documentCount >
                settings.maxDocuments
            ) {
                throw new ServiceError(
                    "resource-exhausted",
                    "The backup contains too many documents.",
                    {
                        status:
                            413,

                        expose:
                            true
                    }
                );
            }

            output[
                normalizedCollection
            ] =
                records;

            return output;
        },
        {}
    );
}

function normalizeBackupRecords(
    records,
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
            "Backup collection records must be an array."
        );
    }

    if (
        records.length >
        settings.maxDocuments
    ) {
        throw new ServiceError(
            "resource-exhausted",
            "The backup collection contains too many documents.",
            {
                status:
                    413,

                expose:
                    true
            }
        );
    }

    const seen =
        new Set();

    return records.map(
        function (
            record
        ) {
            if (
                !record ||
                typeof record !==
                    "object" ||
                Array.isArray(
                    record
                )
            ) {
                throw new TypeError(
                    "Backup record must be an object."
                );
            }

            const id =
                normalizeBackupDocumentId(
                    record.id
                );

            if (
                seen.has(
                    id
                )
            ) {
                throw new ServiceError(
                    "already-exists",
                    "The backup contains a duplicate document ID.",
                    {
                        status:
                            409,

                        expose:
                            true,

                        details: {
                            documentId:
                                id
                        }
                    }
                );
            }

            seen.add(
                id
            );

            return {
                id:
                    id,

                data:
                    cloneValue(
                        record.data
                    )
            };
        }
    );
}

/* ==========================================================
   VALUE ENCODING
========================================================== */

function encodeBackupValue(
    value
) {
    if (
        value === undefined
    ) {
        return {
            __backupType:
                "undefined"
        };
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
        return {
            __backupType:
                "bigint",

            value:
                value.toString()
        };
    }

    if (
        value instanceof Date
    ) {
        return {
            __backupType:
                "date",

            value:
                value.toISOString()
        };
    }

    if (
        Buffer.isBuffer(
            value
        )
    ) {
        return {
            __backupType:
                "buffer",

            value:
                value.toString(
                    "base64"
                )
        };
    }

    if (
        value &&
        typeof value.toMillis ===
            "function"
    ) {
        return {
            __backupType:
                "timestamp",

            value:
                value.toMillis()
        };
    }

    if (
        Array.isArray(
            value
        )
    ) {
        return value.map(
            encodeBackupValue
        );
    }

    if (
        typeof value ===
        "object"
    ) {
        return Object.keys(
            value
        ).reduce(
            function (
                output,
                key
            ) {
                output[key] =
                    encodeBackupValue(
                        value[key]
                    );

                return output;
            },
            {}
        );
    }

    return {
        __backupType:
            "string",

        value:
            String(
                value
            )
    };
}

function decodeBackupValue(
    value,
    runtime
) {
    if (
        value === null ||
        value === undefined ||
        typeof value !==
            "object"
    ) {
        return value;
    }

    if (
        Array.isArray(
            value
        )
    ) {
        return value.map(
            function (
                item
            ) {
                return decodeBackupValue(
                    item,
                    runtime
                );
            }
        );
    }

    if (
        value.__backupType
    ) {
        switch (
            value.__backupType
        ) {
            case "undefined":
                return null;

            case "bigint":
                return value.value;

            case "date":
                return new Date(
                    value.value
                );

            case "buffer":
                return Buffer.from(
                    value.value,
                    "base64"
                );

            case "timestamp":
                return createDatabaseTimestamp(
                    runtime,
                    Number(
                        value.value
                    )
                );

            case "string":
                return String(
                    value.value
                );

            default:
                throw new ServiceError(
                    "invalid-argument",
                    "The backup contains an unsupported encoded value.",
                    {
                        status:
                            400,

                        expose:
                            true
                    }
                );
        }
    }

    return Object.keys(
        value
    ).reduce(
        function (
            output,
            key
        ) {
            output[key] =
                decodeBackupValue(
                    value[key],
                    runtime
                );

            return output;
        },
        {}
    );
}

/* ==========================================================
   CHECKSUM
========================================================== */

function createBackupChecksum(
    collections
) {
    return hashBackupValue(
        stableStringify(
            collections
        )
    );
}

function hashBackupValue(
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
   GET AND QUERY
========================================================== */

async function getBackupRun(
    runtime,
    runId,
    options
) {
    const settings =
        normalizeBackupOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return null;
    }

    assertBackupRuntime(
        runtime
    );

    const id =
        normalizeBackupRunId(
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

    return sanitizeBackupRunRecord(
        snapshot.data()
    );
}

async function queryBackupRuns(
    runtime,
    filters,
    options
) {
    const settings =
        normalizeBackupOptions(
            options
        );

    if (
        settings.disabled
    ) {
        return [];
    }

    assertBackupRuntime(
        runtime
    );

    const normalized =
        normalizeBackupQuery(
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
        normalized.operation
    ) {
        query =
            query.where(
                "operation",
                "==",
                normalized.operation
            );
    }

    if (
        normalized.dryRun !==
        null
    ) {
        query =
            query.where(
                "dryRun",
                "==",
                normalized.dryRun
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
            return sanitizeBackupRunRecord(
                document.data()
            );
        }
    );
}

function normalizeBackupQuery(
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
                ? normalizeBackupStatus(
                      source.status
                  )
                : null,

        operation:
            source.operation
                ? normalizeBackupOperation(
                      source.operation
                  )
                : null,

        dryRun:
            source.dryRun ===
                undefined ||
            source.dryRun ===
                null
                ? null
                : Boolean(
                      source.dryRun
                  ),

        startedAfter:
            source.startedAfter !==
            undefined
                ? normalizeBackupDate(
                      source.startedAfter,
                      "Backup start filter"
                  )
                : null,

        startedBefore:
            source.startedBefore !==
            undefined
                ? normalizeBackupDate(
                      source.startedBefore,
                      "Backup start filter"
                  )
                : null,

        orderBy:
            normalizeBackupOrderField(
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
   CANCEL
========================================================== */

async function cancelBackupRun(
    runtime,
    runId,
    reason,
    options
) {
    const settings =
        normalizeBackupOptions(
            options
        );

    const id =
        normalizeBackupRunId(
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

    assertBackupRuntime(
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
                        throw createBackupRunNotFoundError(
                            id
                        );
                    }

                    const existing =
                        snapshot.data();

                    if (
                        TERMINAL_BACKUP_STATUSES
                            .includes(
                                normalizeBackupStatus(
                                    existing.status
                                )
                            )
                    ) {
                        throw new ServiceError(
                            "failed-precondition",
                            "A terminal backup run cannot be cancelled.",
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
                            BACKUP_STATUSES
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
        sanitizeBackupRunRecord(
            record
        );

    logBackupEvent(
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

        backup:
            result
    };
}

/* ==========================================================
   RESULT AND STORAGE
========================================================== */

function createBackupResult(
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
            normalizeBackupRunId(
                source.id
            ),

        operation:
            normalizeBackupOperation(
                source.operation
            ),

        status:
            normalizeBackupStatus(
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

        collections:
            normalizeCollections(
                source.collections ||
                []
            ),

        collectionResults:
            Array.isArray(
                source.collectionResults
            )
                ? cloneValue(
                      source.collectionResults
                  )
                : [],

        collectionCount:
            normalizeNonNegativeInteger(
                source.collectionCount,
                Array.isArray(
                    source.collections
                )
                    ? source.collections
                          .length
                    : 0,
                "Backup collection count"
            ),

        documentCount:
            normalizeNonNegativeInteger(
                source.documentCount,
                0,
                "Backup document count"
            ),

        writtenCount:
            normalizeNonNegativeInteger(
                source.writtenCount,
                0,
                "Backup written count"
            ),

        skippedCount:
            normalizeNonNegativeInteger(
                source.skippedCount,
                0,
                "Backup skipped count"
            ),

        errorCount:
            normalizeNonNegativeInteger(
                source.errorCount,
                0,
                "Backup error count"
            ),

        error:
            source.error
                ? cloneValue(
                      source.error
                  )
                : null,

        backup:
            source.backup
                ? cloneValue(
                      source.backup
                  )
                : null,

        cancellationReason:
            normalizeOptionalString(
                source.cancellationReason
            ),

        startedAt:
            serializeTimestamp(
                startedAt
            ),

        completedAt:
            serializeTimestamp(
                completedAt
            ),

        cancelledAt:
            serializeTimestamp(
                source.cancelledAt
            ),

        durationMs:
            calculateDuration(
                startedAt,
                completedAt
            )
    };
}

function createBackupRunRecord(
    values,
    runtime,
    options
) {
    const result =
        createBackupResult(
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

        operation:
            result.operation,

        status:
            result.status,

        disabled:
            result.disabled,

        dryRun:
            result.dryRun,

        collections:
            result.collections,

        collectionResults:
            result.collectionResults,

        collectionCount:
            result.collectionCount,

        documentCount:
            result.documentCount,

        writtenCount:
            result.writtenCount,

        skippedCount:
            result.skippedCount,

        errorCount:
            result.errorCount,

        error:
            cloneValue(
                result.error
            ),

        cancellationReason:
            result.cancellationReason,

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
            result.cancelledAt
                ? createDatabaseTimestamp(
                      runtime,
                      toMilliseconds(
                          result.cancelledAt
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
            DEFAULT_SCHEMA_VERSION
    };
}

function sanitizeBackupRunRecord(
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

        operation:
            normalizeBackupOperation(
                record.operation
            ),

        status:
            normalizeBackupStatus(
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

        collections:
            Array.isArray(
                record.collections
            )
                ? record.collections
                    .slice()
                : [],

        collectionResults:
            cloneValue(
                record.collectionResults
            ) ||
            [],

        collectionCount:
            normalizeNonNegativeInteger(
                record.collectionCount,
                0,
                "Backup collection count"
            ),

        documentCount:
            normalizeNonNegativeInteger(
                record.documentCount,
                0,
                "Backup document count"
            ),

        writtenCount:
            normalizeNonNegativeInteger(
                record.writtenCount,
                0,
                "Backup written count"
            ),

        skippedCount:
            normalizeNonNegativeInteger(
                record.skippedCount,
                0,
                "Backup skipped count"
            ),

        errorCount:
            normalizeNonNegativeInteger(
                record.errorCount,
                0,
                "Backup error count"
            ),

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
                DEFAULT_SCHEMA_VERSION
            )
    };
}

/* ==========================================================
   INPUT NORMALIZATION
========================================================== */

function normalizeBackupExportInput(
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
            "Backup export input must be an object."
        );
    }

    const settings =
        normalizeBackupOptions(
            options
        );

    return {
        id:
            source.id
                ? normalizeBackupRunId(
                      source.id
                  )
                : null,

        collections:
            normalizeCollections(
                source.collections ||
                settings.collections,
                settings.maxCollections
            ),

        metadata:
            sanitizeBackupMetadata(
                source.metadata
            )
    };
}

/* ==========================================================
   NORMALIZERS
========================================================== */

function normalizeBackupRunId(
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
            "The backup run ID is invalid.",
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

function normalizeBackupDocumentId(
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
            "The backup document ID is invalid.",
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

function normalizeBackupStatus(
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
            BACKUP_STATUSES
        ).includes(
            normalized
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The backup status is invalid.",
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

function normalizeBackupOperation(
    value
) {
    const normalized =
        String(
            value ||
            BACKUP_OPERATION_TYPES
                .export
        )
            .trim()
            .toLowerCase();

    if (
        !Object.values(
            BACKUP_OPERATION_TYPES
        ).includes(
            normalized
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The backup operation is invalid.",
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

function normalizeBackupFormat(
    value
) {
    const normalized =
        String(
            value ||
            DEFAULT_FORMAT
        )
            .trim()
            .toLowerCase();

    if (
        normalized !==
        "json"
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The backup format is unsupported.",
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

function normalizeRestoreMode(
    value
) {
    const normalized =
        String(
            value ||
            RESTORE_MODES.create
        )
            .trim()
            .toLowerCase();

    if (
        !Object.values(
            RESTORE_MODES
        ).includes(
            normalized
        )
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The backup restore mode is invalid.",
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

function normalizeCollections(
    value,
    maximumCollections
) {
    const values =
        value ===
            undefined ||
        value ===
            null
            ? []
            : Array.isArray(
                  value
              )
              ? value
              : [
                    value
                ];

    const collections =
        Array.from(
            new Set(
                values.map(
                    function (
                        collection
                    ) {
                        return normalizeCollection(
                            collection,
                            "Backup collection"
                        );
                    }
                )
            )
        );

    const maximum =
        maximumCollections ||
        DEFAULT_MAX_COLLECTIONS;

    if (
        collections.length >
        maximum
    ) {
        throw new ServiceError(
            "resource-exhausted",
            "Too many backup collections were requested.",
            {
                status:
                    413,

                expose:
                    true
            }
        );
    }

    return collections;
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
                "Backup collection"
            ) +
            " must be a Firestore collection name."
        );
    }

    return normalized;
}

function normalizeBackupDate(
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

function normalizeBackupOrderField(
    value
) {
    const allowed =
        new Set([
            "startedAt",
            "completedAt",
            "createdAt",
            "updatedAt",
            "status",
            "operation",
            "documentCount",
            "errorCount"
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

function normalizeDirection(
    value
) {
    return String(
        value ||
        "asc"
    ).toLowerCase() ===
    "desc"
        ? "desc"
        : "asc";
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
            "Backup query limit must be a positive integer."
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
            "Backup batch size"
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

function sanitizeBackupMetadata(
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

/* ==========================================================
   OPTIONS
========================================================== */

function normalizeBackupOptions(
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
                BACKUP_COLLECTION,
                "Backup run collection"
            ),

        collections:
            normalizeCollections(
                settings.collections ||
                []
            ),

        format:
            normalizeBackupFormat(
                settings.format
            ),

        restoreMode:
            normalizeRestoreMode(
                settings.restoreMode
            ),

        batchSize:
            normalizeBatchSize(
                settings.batchSize
            ),

        queryLimit:
            normalizeQueryLimit(
                settings.queryLimit
            ),

        maxCollections:
            normalizePositiveInteger(
                settings.maxCollections,
                DEFAULT_MAX_COLLECTIONS,
                "Maximum backup collections"
            ),

        maxDocuments:
            normalizePositiveInteger(
                settings.maxDocuments,
                DEFAULT_MAX_DOCUMENTS,
                "Maximum backup documents"
            ),

        maxBackupBytes:
            normalizePositiveInteger(
                settings.maxBackupBytes,
                DEFAULT_MAX_BACKUP_BYTES,
                "Maximum backup size"
            ),

        retentionMs:
            normalizeNonNegativeInteger(
                settings.retentionMs,
                DEFAULT_RETENTION_MS,
                "Backup retention"
            ),

        orderField:
            normalizeOptionalString(
                settings.orderField
            ),

        direction:
            normalizeDirection(
                settings.direction
            ),

        runId:
            settings.runId
                ? normalizeBackupRunId(
                      settings.runId
                  )
                : null,

        dryRun:
            Boolean(
                settings.dryRun
            ),

        disabled:
            Boolean(
                settings.disabled
            ),

        stopOnError:
            Boolean(
                settings.stopOnError
            ),

        verifyChecksum:
            settings.verifyChecksum !==
            false,

        persistRuns:
            settings.persistRuns !==
            false,

        returnFailures:
            settings.returnFailures !==
            false,

        log:
            settings.log !==
            false,

        now:
            settings.now
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
            "Backup data contains a circular reference.",
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

function assertSerializableBackupValue(
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

function serializeBackupError(
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
            "backup-failed",

        message:
            error.publicMessage ||
            error.message ||
            "Backup operation failed.",

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

function createBackupRunNotFoundError(
    runId
) {
    return new ServiceError(
        "not-found",
        "The backup run was not found.",
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

/* ==========================================================
   IDENTIFIERS
========================================================== */

function createBackupRunId(
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

/* ==========================================================
   RUNTIME AND TIME
========================================================== */

function assertBackupRuntime(
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
            "The backup datastore is unavailable.",
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
            "Firestore transactions are required for backup operations.",
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

function logBackupEvent(
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

        operation:
            result &&
            result.operation,

        status:
            result &&
            result.status,

        collectionCount:
            result &&
            result.collectionCount,

        documentCount:
            result &&
            result.documentCount,

        writtenCount:
            result &&
            result.writtenCount,

        skippedCount:
            result &&
            result.skippedCount,

        errorCount:
            result &&
            result.errorCount,

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
            BACKUP_STATUSES
                .failed &&
        typeof runtime.logger.error ===
            "function"
    ) {
        runtime.logger.error(
            "Backup operation failed.",
            metadata
        );

        return;
    }

    if (
        result &&
        (
            result.status ===
                BACKUP_STATUSES
                    .partial ||
            result.status ===
                BACKUP_STATUSES
                    .cancelled
        ) &&
        typeof runtime.logger.warn ===
            "function"
    ) {
        runtime.logger.warn(
            "Backup operation completed with warnings.",
            metadata
        );

        return;
    }

    if (
        typeof runtime.logger.info ===
        "function"
    ) {
        runtime.logger.info(
            "Backup event.",
            metadata
        );
    }
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    createBackupService,
    exportBackup,
    exportBackupCollection,
    restoreBackup,
    restoreBackupCollection,
    restoreBackupDocument,
    inspectBackup,
    createBackupManifest,
    normalizeBackupPayload,
    normalizeBackupManifest,
    normalizeBackupCollectionsPayload,
    normalizeBackupRecords,
    encodeBackupValue,
    decodeBackupValue,
    createBackupChecksum,
    hashBackupValue,
    getBackupRun,
    queryBackupRuns,
    normalizeBackupQuery,
    cancelBackupRun,
    createBackupResult,
    createBackupRunRecord,
    sanitizeBackupRunRecord,
    normalizeBackupExportInput,
    normalizeBackupRunId,
    normalizeBackupDocumentId,
    normalizeBackupStatus,
    normalizeBackupOperation,
    normalizeBackupFormat,
    normalizeRestoreMode,
    normalizeCollections,
    normalizeCollection,
    normalizeBackupDate,
    normalizeBackupOrderField,
    normalizeDirection,
    normalizeQueryLimit,
    normalizeBatchSize,
    normalizePositiveInteger,
    normalizeNonNegativeInteger,
    normalizeOptionalString,
    sanitizeBackupMetadata,
    normalizeBackupOptions,
    stableStringify,
    normalizeStableValue,
    assertSerializableBackupValue,
    serializeBackupError,
    createBackupRunNotFoundError,
    createBackupRunId,
    assertBackupRuntime,
    resolveNow,
    createDatabaseTimestamp,
    toMilliseconds,
    serializeTimestamp,
    calculateDuration,
    logBackupEvent,
    constants: {
        BACKUP_COLLECTION,
        DEFAULT_STATUS,
        DEFAULT_FORMAT,
        DEFAULT_BATCH_SIZE,
        MAX_BATCH_SIZE,
        DEFAULT_QUERY_LIMIT,
        MAX_QUERY_LIMIT,
        DEFAULT_MAX_COLLECTIONS,
        DEFAULT_MAX_DOCUMENTS,
        DEFAULT_MAX_BACKUP_BYTES,
        DEFAULT_RETENTION_MS,
        DEFAULT_SCHEMA_VERSION,
        BACKUP_STATUSES,
        BACKUP_OPERATION_TYPES,
        RESTORE_MODES,
        TERMINAL_BACKUP_STATUSES
    }
};