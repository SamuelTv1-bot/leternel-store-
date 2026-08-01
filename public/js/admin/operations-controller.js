"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ADMIN OPERATIONS CONTROLLER

   Responsibilities:
   - Bind admin operations UI to service layer
   - Load operational dashboard data
   - Handle cleanup, maintenance, reconciliation,
     backup, migration, and dead-letter actions
   - Render status, summaries, tables, and errors
========================================================== */

(function (
    global
) {
    /* ======================================================
       CONSTANTS
    ====================================================== */

    const DEFAULT_SELECTORS =
        Object.freeze({
            root:
                "[data-admin-operations]",

            refreshButton:
                "[data-operations-refresh]",

            healthStatus:
                "[data-operations-health]",

            healthTimestamp:
                "[data-operations-health-timestamp]",

            cleanupButton:
                "[data-operation-cleanup]",

            maintenanceButton:
                "[data-operation-maintenance]",

            deadLettersTable:
                "[data-dead-letters-table]",

            reconciliationRunsTable:
                "[data-reconciliation-runs-table]",

            reconciliationItemsTable:
                "[data-reconciliation-items-table]",

            backupRunsTable:
                "[data-backup-runs-table]",

            migrationRunsTable:
                "[data-migration-runs-table]",

            exportBackupButton:
                "[data-backup-export]",

            backupCollections:
                "[data-backup-collections]",

            backupOutput:
                "[data-backup-output]",

            backupInput:
                "[data-backup-input]",

            inspectBackupButton:
                "[data-backup-inspect]",

            restoreBackupButton:
                "[data-backup-restore]",

            migrationPlanButton:
                "[data-migration-plan]",

            migrationRunButton:
                "[data-migration-run]",

            migrationDirection:
                "[data-migration-direction]",

            migrationFromVersion:
                "[data-migration-from]",

            migrationToVersion:
                "[data-migration-to]",

            migrationOutput:
                "[data-migration-output]",

            reconciliationRunButton:
                "[data-reconciliation-run]",

            reconciliationInternal:
                "[data-reconciliation-internal]",

            reconciliationExternal:
                "[data-reconciliation-external]",

            reconciliationCurrency:
                "[data-reconciliation-currency]",

            reconciliationSource:
                "[data-reconciliation-source]",

            reconciliationOutput:
                "[data-reconciliation-output]",

            statusMessage:
                "[data-operations-status]",

            loadingOverlay:
                "[data-operations-loading]"
        });

    const STATUS_LABELS =
        Object.freeze({
            healthy:
                "Operational",

            degraded:
                "Degraded",

            unavailable:
                "Unavailable"
        });

    /* ======================================================
       CONTROLLER FACTORY
    ====================================================== */

    function createOperationsController(
        options
    ) {
        const settings =
            normalizeControllerOptions(
                options
            );

        const documentObject =
            settings.document ||
            global.document;

        if (
            !documentObject
        ) {
            throw new Error(
                "Admin operations controller requires a document."
            );
        }

        const service =
            settings.service ||
            resolveOperationsService();

        const root =
            resolveRoot(
                documentObject,
                settings.root,
                settings.selectors.root
            );

        const elements =
            resolveElements(
                root ||
                documentObject,
                settings.selectors
            );

        const disposers =
            [];

        let initialized =
            false;

        let destroyed =
            false;

        let dashboard =
            null;

        /* ==================================================
           LIFECYCLE
        ================================================== */

        async function init() {
            if (
                initialized
            ) {
                return controller;
            }

            assertActive();

            initialized =
                true;

            bindEvents();

            disposers.push(
                service.subscribe(
                    handleServiceEvent
                )
            );

            await refresh();

            return controller;
        }

        function destroy() {
            if (
                destroyed
            ) {
                return;
            }

            destroyed =
                true;

            while (
                disposers.length
            ) {
                const dispose =
                    disposers.pop();

                try {
                    dispose();
                } catch (
                    error
                ) {
                    reportConsoleError(
                        error
                    );
                }
            }

            initialized =
                false;
        }

        function assertActive() {
            if (
                destroyed
            ) {
                throw new Error(
                    "Admin operations controller has been destroyed."
                );
            }
        }

        /* ==================================================
           DASHBOARD
        ================================================== */

        async function refresh() {
            assertActive();

            setStatus(
                "Refreshing operations dashboard…",
                "loading"
            );

            try {
                dashboard =
                    await service
                        .loadOperationsDashboard();

                renderDashboard(
                    dashboard
                );

                setStatus(
                    "Operations dashboard updated.",
                    "success"
                );

                return dashboard;
            } catch (
                error
            ) {
                handleError(
                    error,
                    "Unable to refresh operations dashboard."
                );

                throw error;
            }
        }

        function renderDashboard(
            data
        ) {
            const source =
                data ||
                {};

            renderHealth(
                source.health
            );

            renderDeadLetters(
                source.deadLetters
            );

            renderReconciliationRuns(
                source.reconciliationRuns
            );

            renderBackupRuns(
                source.backupRuns
            );

            renderMigrationRuns(
                source.migrationRuns
            );
        }

        /* ==================================================
           HEALTH
        ================================================== */

        function renderHealth(
            health
        ) {
            if (
                !elements.healthStatus
            ) {
                return;
            }

            if (
                health &&
                health.ok
            ) {
                elements
                    .healthStatus
                    .textContent =
                        STATUS_LABELS
                            .healthy;

                elements
                    .healthStatus
                    .dataset
                    .status =
                        "healthy";
            } else {
                elements
                    .healthStatus
                    .textContent =
                        STATUS_LABELS
                            .degraded;

                elements
                    .healthStatus
                    .dataset
                    .status =
                        "degraded";
            }

            if (
                elements.healthTimestamp
            ) {
                elements
                    .healthTimestamp
                    .textContent =
                        formatDate(
                            health &&
                            health.timestamp
                        );
            }
        }

        /* ==================================================
           CLEANUP
        ================================================== */

        async function runCleanup() {
            setButtonBusy(
                elements.cleanupButton,
                true
            );

            try {
                const result =
                    await service
                        .runCleanup({
                            source:
                                "admin"
                        });

                setStatus(
                    createCleanupMessage(
                        result
                    ),
                    "success"
                );

                await refresh();

                return result;
            } catch (
                error
            ) {
                handleError(
                    error,
                    "Cleanup failed."
                );

                throw error;
            } finally {
                setButtonBusy(
                    elements.cleanupButton,
                    false
                );
            }
        }

        /* ==================================================
           MAINTENANCE
        ================================================== */

        async function runMaintenance() {
            setButtonBusy(
                elements.maintenanceButton,
                true
            );

            try {
                const result =
                    await service
                        .runMaintenance({
                            source:
                                "admin"
                        });

                setStatus(
                    "Maintenance completed with status: " +
                    String(
                        result &&
                        result.status ||
                        "unknown"
                    ) +
                    ".",
                    "success"
                );

                await refresh();

                return result;
            } catch (
                error
            ) {
                handleError(
                    error,
                    "Maintenance failed."
                );

                throw error;
            } finally {
                setButtonBusy(
                    elements.maintenanceButton,
                    false
                );
            }
        }

        /* ==================================================
           DEAD LETTERS
        ================================================== */

        function renderDeadLetters(
            records
        ) {
            renderTable(
                elements.deadLettersTable,
                normalizeArray(
                    records
                ),
                [
                    {
                        key:
                            "id",

                        label:
                            "ID"
                    },
                    {
                        key:
                            "type",

                        label:
                            "Type"
                    },
                    {
                        key:
                            "status",

                        label:
                            "Status"
                    },
                    {
                        key:
                            "attemptCount",

                        label:
                            "Attempts"
                    },
                    {
                        key:
                            "createdAt",

                        label:
                            "Created",

                        format:
                            formatDate
                    }
                ],
                createDeadLetterActions
            );
        }

        function createDeadLetterActions(
            record
        ) {
            const container =
                createElement(
                    "div",
                    "admin-operation-actions"
                );

            if (
                record.status !==
                "resolved"
            ) {
                container.appendChild(
                    createActionButton(
                        "Retry",
                        async function () {
                            await service
                                .retryDeadLetter(
                                    record.id
                                );

                            await refresh();
                        }
                    )
                );

                container.appendChild(
                    createActionButton(
                        "Resolve",
                        async function () {
                            await service
                                .resolveDeadLetter(
                                    record.id,
                                    {
                                        resolution:
                                            "Resolved from admin console."
                                    }
                                );

                            await refresh();
                        }
                    )
                );
            }

            return container;
        }

        /* ==================================================
           RECONCILIATION
        ================================================== */

        async function runReconciliation() {
            setButtonBusy(
                elements
                    .reconciliationRunButton,
                true
            );

            try {
                const internalRecords =
                    parseJsonTextarea(
                        elements
                            .reconciliationInternal,
                        []
                    );

                const externalRecords =
                    parseJsonTextarea(
                        elements
                            .reconciliationExternal,
                        []
                    );

                const payload = {
                    internalRecords,
                    externalRecords
                };

                const currency =
                    getInputValue(
                        elements
                            .reconciliationCurrency
                    );

                const source =
                    getInputValue(
                        elements
                            .reconciliationSource
                    );

                if (
                    currency
                ) {
                    payload.currency =
                        currency;
                }

                if (
                    source
                ) {
                    payload.source =
                        source;
                }

                const result =
                    await service
                        .runReconciliation(
                            payload
                        );

                renderJson(
                    elements
                        .reconciliationOutput,
                    result
                );

                setStatus(
                    "Reconciliation completed with status: " +
                    String(
                        result &&
                        result.status ||
                        "unknown"
                    ) +
                    ".",
                    "success"
                );

                await refresh();

                return result;
            } catch (
                error
            ) {
                handleError(
                    error,
                    "Reconciliation failed."
                );

                throw error;
            } finally {
                setButtonBusy(
                    elements
                        .reconciliationRunButton,
                    false
                );
            }
        }

        function renderReconciliationRuns(
            records
        ) {
            renderTable(
                elements
                    .reconciliationRunsTable,
                normalizeArray(
                    records
                ),
                [
                    {
                        key:
                            "id",

                        label:
                            "Run"
                    },
                    {
                        key:
                            "status",

                        label:
                            "Status"
                    },
                    {
                        key:
                            "source",

                        label:
                            "Source"
                    },
                    {
                        key:
                            "currency",

                        label:
                            "Currency"
                    },
                    {
                        key:
                            "matchedCount",

                        label:
                            "Matched"
                    },
                    {
                        key:
                            "discrepancyCount",

                        label:
                            "Issues"
                    },
                    {
                        key:
                            "startedAt",

                        label:
                            "Started",

                        format:
                            formatDate
                    }
                ],
                createReconciliationRunActions
            );
        }

        function createReconciliationRunActions(
            record
        ) {
            const container =
                createElement(
                    "div",
                    "admin-operation-actions"
                );

            container.appendChild(
                createActionButton(
                    "Items",
                    async function () {
                        const items =
                            await service
                                .listReconciliationItems({
                                    runId:
                                        record.id
                                });

                        renderReconciliationItems(
                            items
                        );
                    }
                )
            );

            if (
                !isTerminalStatus(
                    record.status
                )
            ) {
                container.appendChild(
                    createActionButton(
                        "Cancel",
                        async function () {
                            await service
                                .cancelReconciliation(
                                    record.id,
                                    "Cancelled from admin console."
                                );

                            await refresh();
                        }
                    )
                );
            }

            return container;
        }

        function renderReconciliationItems(
            records
        ) {
            renderTable(
                elements
                    .reconciliationItemsTable,
                normalizeArray(
                    records
                ),
                [
                    {
                        key:
                            "key",

                        label:
                            "Reference"
                    },
                    {
                        key:
                            "type",

                        label:
                            "Issue"
                    },
                    {
                        key:
                            "status",

                        label:
                            "Status"
                    },
                    {
                        key:
                            "amountDifferenceMinor",

                        label:
                            "Difference"
                    },
                    {
                        key:
                            "createdAt",

                        label:
                            "Created",

                        format:
                            formatDate
                    }
                ],
                createReconciliationItemActions
            );
        }

        function createReconciliationItemActions(
            record
        ) {
            const container =
                createElement(
                    "div",
                    "admin-operation-actions"
                );

            if (
                record.status ===
                "open"
            ) {
                container.appendChild(
                    createActionButton(
                        "Resolve",
                        async function () {
                            await service
                                .resolveReconciliationItem(
                                    record.id,
                                    {
                                        action:
                                            "resolved-from-admin"
                                    }
                                );

                            await refreshReconciliationItems(
                                record.runId
                            );
                        }
                    )
                );

                container.appendChild(
                    createActionButton(
                        "Ignore",
                        async function () {
                            await service
                                .ignoreReconciliationItem(
                                    record.id,
                                    "Ignored from admin console."
                                );

                            await refreshReconciliationItems(
                                record.runId
                            );
                        }
                    )
                );
            }

            return container;
        }

        async function refreshReconciliationItems(
            runId
        ) {
            if (
                !runId
            ) {
                return;
            }

            const items =
                await service
                    .listReconciliationItems({
                        runId
                    });

            renderReconciliationItems(
                items
            );
        }

        /* ==================================================
           BACKUPS
        ================================================== */

        async function exportBackup() {
            setButtonBusy(
                elements.exportBackupButton,
                true
            );

            try {
                const collections =
                    parseCollectionInput(
                        getInputValue(
                            elements
                                .backupCollections
                        )
                    );

                const result =
                    await service
                        .exportBackup({
                            collections
                        });

                renderJson(
                    elements.backupOutput,
                    result &&
                    result.backup
                        ? result.backup
                        : result
                );

                setStatus(
                    "Backup export completed.",
                    "success"
                );

                await refresh();

                return result;
            } catch (
                error
            ) {
                handleError(
                    error,
                    "Backup export failed."
                );

                throw error;
            } finally {
                setButtonBusy(
                    elements.exportBackupButton,
                    false
                );
            }
        }

        async function inspectBackup() {
            setButtonBusy(
                elements.inspectBackupButton,
                true
            );

            try {
                const backup =
                    parseJsonTextarea(
                        elements.backupInput,
                        null,
                        true
                    );

                const result =
                    await service
                        .inspectBackup(
                            backup
                        );

                renderJson(
                    elements.backupOutput,
                    result
                );

                setStatus(
                    "Backup is valid.",
                    "success"
                );

                return result;
            } catch (
                error
            ) {
                handleError(
                    error,
                    "Backup inspection failed."
                );

                throw error;
            } finally {
                setButtonBusy(
                    elements.inspectBackupButton,
                    false
                );
            }
        }

        async function restoreBackup() {
            setButtonBusy(
                elements.restoreBackupButton,
                true
            );

            try {
                const backup =
                    parseJsonTextarea(
                        elements.backupInput,
                        null,
                        true
                    );

                const result =
                    await service
                        .restoreBackup(
                            backup,
                            {
                                restoreMode:
                                    "create"
                            }
                        );

                renderJson(
                    elements.backupOutput,
                    result
                );

                setStatus(
                    "Backup restore completed.",
                    "success"
                );

                await refresh();

                return result;
            } catch (
                error
            ) {
                handleError(
                    error,
                    "Backup restore failed."
                );

                throw error;
            } finally {
                setButtonBusy(
                    elements.restoreBackupButton,
                    false
                );
            }
        }

        function renderBackupRuns(
            records
        ) {
            renderTable(
                elements.backupRunsTable,
                normalizeArray(
                    records
                ),
                [
                    {
                        key:
                            "id",

                        label:
                            "Run"
                    },
                    {
                        key:
                            "operation",

                        label:
                            "Operation"
                    },
                    {
                        key:
                            "status",

                        label:
                            "Status"
                    },
                    {
                        key:
                            "documentCount",

                        label:
                            "Documents"
                    },
                    {
                        key:
                            "errorCount",

                        label:
                            "Errors"
                    },
                    {
                        key:
                            "startedAt",

                        label:
                            "Started",

                        format:
                            formatDate
                    }
                ],
                createBackupActions
            );
        }

        function createBackupActions(
            record
        ) {
            const container =
                createElement(
                    "div",
                    "admin-operation-actions"
                );

            if (
                !isTerminalStatus(
                    record.status
                )
            ) {
                container.appendChild(
                    createActionButton(
                        "Cancel",
                        async function () {
                            await service
                                .cancelBackup(
                                    record.id,
                                    "Cancelled from admin console."
                                );

                            await refresh();
                        }
                    )
                );
            }

            return container;
        }

        /* ==================================================
           MIGRATIONS
        ================================================== */

        function buildMigrationInput() {
            const payload = {
                direction:
                    getInputValue(
                        elements
                            .migrationDirection
                    ) ||
                    "up"
            };

            const fromVersion =
                getInputValue(
                    elements
                        .migrationFromVersion
                );

            const toVersion =
                getInputValue(
                    elements
                        .migrationToVersion
                );

            if (
                fromVersion !==
                ""
            ) {
                payload.fromVersion =
                    Number(
                        fromVersion
                    );
            }

            if (
                toVersion !==
                ""
            ) {
                payload.toVersion =
                    Number(
                        toVersion
                    );
            }

            return payload;
        }

        async function planMigrations() {
            setButtonBusy(
                elements.migrationPlanButton,
                true
            );

            try {
                const result =
                    await service
                        .planMigrations(
                            buildMigrationInput()
                        );

                renderJson(
                    elements.migrationOutput,
                    result
                );

                setStatus(
                    "Migration plan generated.",
                    "success"
                );

                return result;
            } catch (
                error
            ) {
                handleError(
                    error,
                    "Unable to create migration plan."
                );

                throw error;
            } finally {
                setButtonBusy(
                    elements.migrationPlanButton,
                    false
                );
            }
        }

        async function runMigrations() {
            setButtonBusy(
                elements.migrationRunButton,
                true
            );

            try {
                const result =
                    await service
                        .runMigrations(
                            buildMigrationInput()
                        );

                renderJson(
                    elements.migrationOutput,
                    result
                );

                setStatus(
                    "Migration run completed with status: " +
                    String(
                        result &&
                        result.status ||
                        "unknown"
                    ) +
                    ".",
                    "success"
                );

                await refresh();

                return result;
            } catch (
                error
            ) {
                handleError(
                    error,
                    "Migration run failed."
                );

                throw error;
            } finally {
                setButtonBusy(
                    elements.migrationRunButton,
                    false
                );
            }
        }

        function renderMigrationRuns(
            records
        ) {
            renderTable(
                elements.migrationRunsTable,
                normalizeArray(
                    records
                ),
                [
                    {
                        key:
                            "id",

                        label:
                            "Run"
                    },
                    {
                        key:
                            "direction",

                        label:
                            "Direction"
                    },
                    {
                        key:
                            "status",

                        label:
                            "Status"
                    },
                    {
                        key:
                            "completedCount",

                        label:
                            "Completed"
                    },
                    {
                        key:
                            "failedCount",

                        label:
                            "Failed"
                    },
                    {
                        key:
                            "startedAt",

                        label:
                            "Started",

                        format:
                            formatDate
                    }
                ],
                createMigrationActions
            );
        }

        function createMigrationActions(
            record
        ) {
            const container =
                createElement(
                    "div",
                    "admin-operation-actions"
                );

            if (
                !isTerminalStatus(
                    record.status
                )
            ) {
                container.appendChild(
                    createActionButton(
                        "Cancel",
                        async function () {
                            await service
                                .cancelMigration(
                                    record.id,
                                    "Cancelled from admin console."
                                );

                            await refresh();
                        }
                    )
                );
            }

            return container;
        }

        /* ==================================================
           EVENT BINDING
        ================================================== */

        function bindEvents() {
            bindClick(
                elements.refreshButton,
                refresh
            );

            bindClick(
                elements.cleanupButton,
                runCleanup
            );

            bindClick(
                elements.maintenanceButton,
                runMaintenance
            );

            bindClick(
                elements
                    .reconciliationRunButton,
                runReconciliation
            );

            bindClick(
                elements.exportBackupButton,
                exportBackup
            );

            bindClick(
                elements.inspectBackupButton,
                inspectBackup
            );

            bindClick(
                elements.restoreBackupButton,
                restoreBackup
            );

            bindClick(
                elements.migrationPlanButton,
                planMigrations
            );

            bindClick(
                elements.migrationRunButton,
                runMigrations
            );
        }

        function bindClick(
            element,
            handler
        ) {
            if (
                !element ||
                typeof handler !==
                "function"
            ) {
                return;
            }

            const listener =
                function (
                    event
                ) {
                    event.preventDefault();

                    Promise.resolve(
                        handler()
                    ).catch(
                        reportConsoleError
                    );
                };

            element.addEventListener(
                "click",
                listener
            );

            disposers.push(
                function () {
                    element.removeEventListener(
                        "click",
                        listener
                    );
                }
            );
        }

        /* ==================================================
           SERVICE EVENTS
        ================================================== */

        function handleServiceEvent(
            event
        ) {
            if (
                !event
            ) {
                return;
            }

            if (
                event.type ===
                "operation-started"
            ) {
                setLoading(
                    true
                );
            }

            if (
                event.type ===
                    "operation-completed" ||
                event.type ===
                    "operation-failed"
            ) {
                setLoading(
                    false
                );
            }
        }

        /* ==================================================
           TABLE RENDERING
        ================================================== */

        function renderTable(
            element,
            rows,
            columns,
            actionFactory
        ) {
            if (
                !element
            ) {
                return;
            }

            const table =
                resolveTableElement(
                    element
                );

            table.textContent =
                "";

            const thead =
                createElement(
                    "thead"
                );

            const headingRow =
                createElement(
                    "tr"
                );

            for (
                const column of
                columns
            ) {
                const cell =
                    createElement(
                        "th"
                    );

                cell.textContent =
                    column.label;

                headingRow.appendChild(
                    cell
                );
            }

            if (
                actionFactory
            ) {
                const actionsHeader =
                    createElement(
                        "th"
                    );

                actionsHeader.textContent =
                    "Actions";

                headingRow.appendChild(
                    actionsHeader
                );
            }

            thead.appendChild(
                headingRow
            );

            table.appendChild(
                thead
            );

            const tbody =
                createElement(
                    "tbody"
                );

            if (
                !rows.length
            ) {
                const emptyRow =
                    createElement(
                        "tr"
                    );

                const emptyCell =
                    createElement(
                        "td"
                    );

                emptyCell.colSpan =
                    columns.length +
                    (
                        actionFactory
                            ? 1
                            : 0
                    );

                emptyCell.textContent =
                    "No records found.";

                emptyCell.className =
                    "admin-operation-empty";

                emptyRow.appendChild(
                    emptyCell
                );

                tbody.appendChild(
                    emptyRow
                );
            } else {
                for (
                    const row of
                    rows
                ) {
                    const rowElement =
                        createElement(
                            "tr"
                        );

                    for (
                        const column of
                        columns
                    ) {
                        const cell =
                            createElement(
                                "td"
                            );

                        const rawValue =
                            getNestedValue(
                                row,
                                column.key
                            );

                        const value =
                            column.format
                                ? column.format(
                                      rawValue,
                                      row
                                  )
                                : formatValue(
                                      rawValue
                                  );

                        cell.textContent =
                            value;

                        rowElement.appendChild(
                            cell
                        );
                    }

                    if (
                        actionFactory
                    ) {
                        const actionsCell =
                            createElement(
                                "td"
                            );

                        const actions =
                            actionFactory(
                                row
                            );

                        if (
                            actions
                        ) {
                            actionsCell.appendChild(
                                actions
                            );
                        }

                        rowElement.appendChild(
                            actionsCell
                        );
                    }

                    tbody.appendChild(
                        rowElement
                    );
                }
            }

            table.appendChild(
                tbody
            );
        }

        /* ==================================================
           STATUS / LOADING
        ================================================== */

        function setStatus(
            message,
            status
        ) {
            if (
                !elements.statusMessage
            ) {
                return;
            }

            elements
                .statusMessage
                .textContent =
                    String(
                        message ||
                        ""
                    );

            elements
                .statusMessage
                .dataset
                .status =
                    status ||
                    "info";
        }

        function setLoading(
            loading
        ) {
            if (
                !elements.loadingOverlay
            ) {
                return;
            }

            elements
                .loadingOverlay
                .hidden =
                    !loading;

            elements
                .loadingOverlay
                .setAttribute(
                    "aria-hidden",
                    loading
                        ? "false"
                        : "true"
                );
        }

        function setButtonBusy(
            button,
            busy
        ) {
            if (
                !button
            ) {
                return;
            }

            button.disabled =
                Boolean(
                    busy
                );

            button.setAttribute(
                "aria-busy",
                busy
                    ? "true"
                    : "false"
            );
        }

        /* ==================================================
           ERRORS
        ================================================== */

        function handleError(
            error,
            fallback
        ) {
            const message =
                error &&
                error.message
                    ? error.message
                    : fallback;

            setStatus(
                message ||
                "Operation failed.",
                "error"
            );

            reportConsoleError(
                error
            );
        }

        function reportConsoleError(
            error
        ) {
            if (
                global.console &&
                typeof global.console
                    .error ===
                    "function"
            ) {
                global.console.error(
                    error
                );
            }
        }

        /* ==================================================
           CONTROLLER
        ================================================== */

        const controller =
            Object.freeze({
                init,
                destroy,
                refresh,

                runCleanup,
                runMaintenance,

                runReconciliation,
                refreshReconciliationItems,

                exportBackup,
                inspectBackup,
                restoreBackup,

                planMigrations,
                runMigrations,

                renderDashboard,
                renderHealth,
                renderDeadLetters,
                renderReconciliationRuns,
                renderReconciliationItems,
                renderBackupRuns,
                renderMigrationRuns,

                getSnapshot:
                    function () {
                        return {
                            initialized,
                            destroyed,
                            dashboard:
                                cloneValue(
                                    dashboard
                                )
                        };
                    },

                service,
                elements,
                options:
                    settings
            });

        return controller;
    }

    /* ======================================================
       DEPENDENCY RESOLUTION
    ====================================================== */

    function resolveOperationsService() {
        if (
            global
                .LEternelAdminOperations &&
            typeof global
                .LEternelAdminOperations
                .getAdminOperationsService ===
                "function"
        ) {
            return global
                .LEternelAdminOperations
                .getAdminOperationsService();
        }

        throw new Error(
            "Admin operations service is unavailable."
        );
    }

    /* ======================================================
       OPTIONS
    ====================================================== */

    function normalizeControllerOptions(
        options
    ) {
        const source =
            options ||
            {};

        return Object.freeze({
            service:
                source.service ||
                null,

            document:
                source.document ||
                null,

            root:
                source.root ||
                null,

            selectors:
                Object.freeze(
                    Object.assign(
                        {},
                        DEFAULT_SELECTORS,
                        source.selectors ||
                        {}
                    )
                )
        });
    }

    /* ======================================================
       DOM HELPERS
    ====================================================== */

    function resolveRoot(
        documentObject,
        root,
        selector
    ) {
        if (
            root &&
            typeof root ===
                "object"
        ) {
            return root;
        }

        if (
            typeof root ===
            "string"
        ) {
            return documentObject
                .querySelector(
                    root
                );
        }

        return documentObject
            .querySelector(
                selector
            );
    }

    function resolveElements(
        root,
        selectors
    ) {
        const output =
            {};

        for (
            const [
                key,
                selector
            ] of
            Object.entries(
                selectors
            )
        ) {
            output[key] =
                root &&
                typeof root
                    .querySelector ===
                    "function"
                    ? root.querySelector(
                          selector
                      )
                    : null;
        }

        return output;
    }

    function createElement(
        tagName,
        className
    ) {
        const documentObject =
            global.document;

        const element =
            documentObject
                .createElement(
                    tagName
                );

        if (
            className
        ) {
            element.className =
                className;
        }

        return element;
    }

    function createActionButton(
        label,
        handler
    ) {
        const button =
            createElement(
                "button",
                "admin-operation-action"
            );

        button.type =
            "button";

        button.textContent =
            label;

        button.addEventListener(
            "click",
            function (
                event
            ) {
                event.preventDefault();

                button.disabled =
                    true;

                Promise.resolve(
                    handler()
                )
                    .catch(
                        reportGlobalError
                    )
                    .finally(
                        function () {
                            button.disabled =
                                false;
                        }
                    );
            }
        );

        return button;
    }

    function reportGlobalError(
        error
    ) {
        if (
            global.console &&
            typeof global.console
                .error ===
                "function"
        ) {
            global.console.error(
                error
            );
        }
    }

    function resolveTableElement(
        element
    ) {
        if (
            String(
                element.tagName
            ).toLowerCase() ===
            "table"
        ) {
            return element;
        }

        let table =
            element.querySelector(
                "table"
            );

        if (
            !table
        ) {
            table =
                createElement(
                    "table",
                    "admin-operation-table"
                );

            element.appendChild(
                table
            );
        }

        return table;
    }

    /* ======================================================
       VALUE HELPERS
    ====================================================== */

    function normalizeArray(
        value
    ) {
        return Array.isArray(
            value
        )
            ? value
            : [];
    }

    function getNestedValue(
        object,
        path
    ) {
        return String(
            path
        )
            .split(".")
            .reduce(
                function (
                    current,
                    segment
                ) {
                    if (
                        current ===
                            undefined ||
                        current ===
                            null
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

    function getInputValue(
        element
    ) {
        if (
            !element
        ) {
            return "";
        }

        return String(
            element.value ||
            ""
        ).trim();
    }

    function parseCollectionInput(
        value
    ) {
        return String(
            value ||
            ""
        )
            .split(
                /[\n,]+/
            )
            .map(
                function (
                    item
                ) {
                    return item.trim();
                }
            )
            .filter(
                Boolean
            );
    }

    function parseJsonTextarea(
        element,
        fallback,
        required
    ) {
        const value =
            getInputValue(
                element
            );

        if (
            !value
        ) {
            if (
                required
            ) {
                throw new Error(
                    "JSON input is required."
                );
            }

            return cloneValue(
                fallback
            );
        }

        try {
            return JSON.parse(
                value
            );
        } catch (
            error
        ) {
            throw new Error(
                "Invalid JSON input."
            );
        }
    }

    function renderJson(
        element,
        value
    ) {
        if (
            !element
        ) {
            return;
        }

        const serialized =
            JSON.stringify(
                value,
                null,
                2
            );

        if (
            "value" in
            element
        ) {
            element.value =
                serialized;
        } else {
            element.textContent =
                serialized;
        }
    }

    function formatValue(
        value
    ) {
        if (
            value ===
                undefined ||
            value ===
                null ||
            value ===
                ""
        ) {
            return "—";
        }

        if (
            typeof value ===
            "boolean"
        ) {
            return value
                ? "Yes"
                : "No";
        }

        if (
            typeof value ===
            "object"
        ) {
            return JSON.stringify(
                value
            );
        }

        return String(
            value
        );
    }

    function formatDate(
        value
    ) {
        if (
            !value
        ) {
            return "—";
        }

        const date =
            value instanceof Date
                ? value
                : new Date(
                      value
                  );

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {
            return String(
                value
            );
        }

        return date
            .toLocaleString();
    }

    function isTerminalStatus(
        status
    ) {
        return [
            "completed",
            "partial",
            "failed",
            "cancelled",
            "resolved",
            "ignored",
            "disabled",
            "skipped"
        ].includes(
            String(
                status ||
                ""
            ).toLowerCase()
        );
    }

    function createCleanupMessage(
        result
    ) {
        const deleted =
            Number(
                result &&
                result.deletedCount ||
                0
            );

        return (
            "Cleanup completed. " +
            deleted +
            " expired record" +
            (
                deleted ===
                1
                    ? ""
                    : "s"
            ) +
            " removed."
        );
    }

    function cloneValue(
        value
    ) {
        if (
            value ===
                undefined ||
            value ===
                null
        ) {
            return value;
        }

        if (
            value instanceof Date
        ) {
            return value
                .toISOString();
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
            return Object.keys(
                value
            ).reduce(
                function (
                    output,
                    key
                ) {
                    output[key] =
                        cloneValue(
                            value[
                                key
                            ]
                        );

                    return output;
                },
                {}
            );
        }

        return value;
    }

    /* ======================================================
       DEFAULT INSTANCE
    ====================================================== */

    let defaultController =
        null;

    function getOperationsController(
        options
    ) {
        if (
            options
        ) {
            return createOperationsController(
                options
            );
        }

        if (
            !defaultController
        ) {
            defaultController =
                createOperationsController();
        }

        return defaultController;
    }

    function resetOperationsController() {
        if (
            defaultController
        ) {
            defaultController
                .destroy();
        }

        defaultController =
            null;
    }

    /* ======================================================
       EXPORT
    ====================================================== */

    const api =
        Object.freeze({
            createOperationsController,
            getOperationsController,
            resetOperationsController,

            normalizeControllerOptions,
            resolveRoot,
            resolveElements,
            normalizeArray,
            getNestedValue,
            parseCollectionInput,
            formatValue,
            formatDate,
            isTerminalStatus,
            createCleanupMessage,
            cloneValue,

            constants:
                Object.freeze({
                    DEFAULT_SELECTORS,
                    STATUS_LABELS
                })
        });

    global.LEternelOperationsController =
        api;

    if (
        typeof module !==
            "undefined" &&
        module.exports
    ) {
        module.exports =
            api;
    }
})(
    typeof window !==
        "undefined"
        ? window
        : globalThis
);