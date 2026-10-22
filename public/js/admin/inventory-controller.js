"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ADMIN INVENTORY CONTROLLER

   Responsibilities:
   - Load and render product inventory
   - Search, filter, sort, and paginate stock records
   - Calculate stock availability and inventory metrics
   - Update stock levels and availability
   - Apply manual inventory adjustments
   - Maintain inventory adjustment history
   - Perform bulk inventory updates
   - Export visible inventory records as CSV
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
                "[data-admin-inventory]",

            refreshButton:
                "[data-inventory-refresh]",

            exportButton:
                "[data-inventory-export]",

            searchInput:
                "[data-inventory-search]",

            statusFilter:
                "[data-inventory-status-filter]",

            availabilityFilter:
                "[data-inventory-availability-filter]",

            categoryFilter:
                "[data-inventory-category-filter]",

            sortSelect:
                "[data-inventory-sort]",

            clearFiltersButton:
                "[data-inventory-clear-filters]",

            showLowStockButton:
                "[data-inventory-show-low-stock]",

            showOutOfStockButton:
                "[data-inventory-show-out-of-stock]",

            table:
                "[data-inventory-table]",

            selectAll:
                "[data-inventory-select-all]",

            visibleCount:
                "[data-inventory-visible-count]",

            previousButton:
                "[data-inventory-previous]",

            nextButton:
                "[data-inventory-next]",

            pageLabel:
                "[data-inventory-page-label]",

            bulkActions:
                "[data-inventory-bulk-actions]",

            selectedCount:
                "[data-inventory-selected-count]",

            bulkAvailableButton:
                "[data-inventory-bulk-available]",

            bulkUnavailableButton:
                "[data-inventory-bulk-unavailable]",

            bulkThresholdButton:
                "[data-inventory-bulk-set-threshold]",

            bulkClearButton:
                "[data-inventory-bulk-clear]",

            totalProductsMetric:
                "[data-inventory-total-products]",

            totalAvailableMetric:
                "[data-inventory-total-available]",

            lowStockMetric:
                "[data-inventory-low-stock]",

            outOfStockMetric:
                "[data-inventory-out-of-stock]",

            statusMessage:
                "[data-inventory-status]",

            loadingOverlay:
                "[data-inventory-loading]",

            loadingMessage:
                "[data-inventory-loading-message]",

            adjustmentsRefreshButton:
                "[data-inventory-adjustments-refresh]",

            adjustmentsTable:
                "[data-inventory-adjustments-table]",

            drawer:
                "[data-inventory-drawer]",

            drawerClose:
                "[data-inventory-drawer-close]",

            drawerProductName:
                "[data-inventory-drawer-product-name]",

            productId:
                "[data-inventory-product-id]",

            productName:
                "[data-inventory-product-name]",

            productSku:
                "[data-inventory-product-sku]",

            productImage:
                "[data-inventory-product-image]",

            productPlaceholder:
                "[data-inventory-product-placeholder]",

            stockStatusLabel:
                "[data-inventory-status-label]",

            availabilityLabel:
                "[data-inventory-availability-label]",

            onHandLabel:
                "[data-inventory-on-hand-label]",

            reservedLabel:
                "[data-inventory-reserved-label]",

            availableLabel:
                "[data-inventory-available-label]",

            updatedAt:
                "[data-inventory-updated-at]",

            onHand:
                "[data-inventory-on-hand]",

            reserved:
                "[data-inventory-reserved]",

            threshold:
                "[data-inventory-threshold]",

            reorderQuantity:
                "[data-inventory-reorder-quantity]",

            availability:
                "[data-inventory-availability]",

            tracking:
                "[data-inventory-tracking]",

            allowBackorder:
                "[data-inventory-allow-backorder]",

            notifyLowStock:
                "[data-inventory-notify-low-stock]",

            saveButton:
                "[data-inventory-save]",

            adjustmentType:
                "[data-inventory-adjustment-type]",

            adjustmentQuantity:
                "[data-inventory-adjustment-quantity]",

            adjustmentReason:
                "[data-inventory-adjustment-reason]",

            adjustmentNote:
                "[data-inventory-adjustment-note]",

            adjustButton:
                "[data-inventory-adjust]",

            warehouse:
                "[data-inventory-warehouse]",

            binLocation:
                "[data-inventory-bin-location]",

            supplier:
                "[data-inventory-supplier]",

            supplierSku:
                "[data-inventory-supplier-sku]",

            leadTime:
                "[data-inventory-lead-time]",

            saveLocationButton:
                "[data-inventory-save-location]",

            productAdjustments:
                "[data-inventory-product-adjustments]",

            thresholdModal:
                "[data-inventory-threshold-modal]",

            thresholdCancel:
                "[data-inventory-threshold-cancel]",

            thresholdValue:
                "[data-inventory-bulk-threshold-value]",

            thresholdConfirm:
                "[data-inventory-threshold-confirm]",

            confirmModal:
                "[data-inventory-confirm-modal]",

            confirmTitle:
                "[data-inventory-confirm-title]",

            confirmMessage:
                "[data-inventory-confirm-message]",

            confirmCancel:
                "[data-inventory-confirm-cancel]",

            confirmSubmit:
                "[data-inventory-confirm-submit]"
        });

    const DEFAULT_PRODUCTS_COLLECTION =
        "products";

    const DEFAULT_ADJUSTMENTS_COLLECTION =
        "inventoryAdjustments";

    const DEFAULT_PAGE_SIZE =
        20;

    const DEFAULT_QUERY_LIMIT =
        2000;

    const DEFAULT_ADJUSTMENT_LIMIT =
        100;

    const DEFAULT_LOW_STOCK_THRESHOLD =
        5;

    const DEFAULT_LOCALE =
        "en-GB";

    const INVENTORY_STATUSES =
        Object.freeze([
            "in-stock",
            "low-stock",
            "out-of-stock",
            "oversold",
            "not-tracked"
        ]);

    const AVAILABILITY_STATUSES =
        Object.freeze([
            "available",
            "unavailable",
            "preorder",
            "backorder"
        ]);

    const TRACKING_STATUSES =
        Object.freeze([
            "tracked",
            "not-tracked"
        ]);

    const ADJUSTMENT_TYPES =
        Object.freeze([
            "increase",
            "decrease",
            "set"
        ]);

    /* ======================================================
       ERROR
    ====================================================== */

    class InventoryControllerError extends Error {
        constructor(
            code,
            message,
            options
        ) {
            super(
                message ||
                "Inventory operation failed."
            );

            this.name =
                "InventoryControllerError";

            this.code =
                code ||
                "inventory/unknown";

            const settings =
                options ||
                {};

            this.details =
                settings.details ||
                null;

            this.originalError =
                settings.originalError ||
                null;
        }
    }

    /* ======================================================
       CONTROLLER FACTORY
    ====================================================== */

    function createInventoryController(
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
            throw new InventoryControllerError(
                "inventory/document-unavailable",
                "Inventory controller requires a document."
            );
        }

        const root =
            resolveRoot(
                documentObject,
                settings.root,
                settings.selectors.root
            );

        if (
            !root
        ) {
            throw new InventoryControllerError(
                "inventory/root-unavailable",
                "Inventory admin root element was not found."
            );
        }

        const elements =
            resolveElements(
                documentObject,
                settings.selectors
            );

        const firestore =
            settings.firestore ||
            resolveFirestore();

        const auth =
            settings.auth ||
            resolveAuth();

        if (
            !firestore ||
            typeof firestore.collection !==
                "function"
        ) {
            throw new InventoryControllerError(
                "inventory/firestore-unavailable",
                "Firestore is unavailable."
            );
        }

        const disposers =
            [];

        const selectedProductIds =
            new Set();

        let initialized =
            false;

        let destroyed =
            false;

        let loading =
            false;

        let allInventory =
            [];

        let filteredInventory =
            [];

        let adjustments =
            [];

        let currentPage =
            1;

        let activeRecord =
            null;

        let pendingConfirmation =
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

            await Promise.all([
                loadInventory(),
                loadAdjustments()
            ]);

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
                    reportError(
                        error
                    );
                }
            }

            selectedProductIds.clear();

            closeDrawer();
            closeThresholdModal();
            closeConfirmation();

            allInventory =
                [];

            filteredInventory =
                [];

            adjustments =
                [];

            initialized =
                false;
        }

        function assertActive() {
            if (
                destroyed
            ) {
                throw new InventoryControllerError(
                    "inventory/destroyed",
                    "Inventory controller has been destroyed."
                );
            }
        }

        /* ==================================================
           LOAD INVENTORY
        ================================================== */

        async function loadInventory() {
            assertActive();

            setLoading(
                true,
                "Loading inventory…"
            );

            setStatus(
                "Loading inventory records…",
                "loading"
            );

            try {
                let query =
                    firestore
                        .collection(
                            settings.productsCollection
                        );

                if (
                    typeof query.orderBy ===
                    "function"
                ) {
                    query =
                        query.orderBy(
                            "updatedAt",
                            "desc"
                        );
                }

                if (
                    typeof query.limit ===
                    "function"
                ) {
                    query =
                        query.limit(
                            settings.queryLimit
                        );
                }

                const snapshot =
                    await query.get();

                allInventory =
                    mapSnapshotDocuments(
                        snapshot
                    )
                        .map(
                            normalizeInventoryRecord
                        );

                selectedProductIds.clear();

                currentPage =
                    1;

                renderCategoryOptions();
                applyFilters();
                renderMetrics();
                renderBulkState();

                setStatus(
                    allInventory.length +
                    " inventory record" +
                    (
                        allInventory.length ===
                            1
                            ? ""
                            : "s"
                    ) +
                    " loaded.",
                    "success"
                );

                return cloneValue(
                    allInventory
                );
            } catch (
                error
            ) {
                const normalized =
                    normalizeInventoryError(
                        error,
                        "inventory/load-failed",
                        "Unable to load inventory."
                    );

                renderEmptyTable(
                    normalized.message
                );

                setStatus(
                    normalized.message,
                    "error"
                );

                throw normalized;
            } finally {
                setLoading(
                    false
                );
            }
        }

        async function loadAdjustments() {
            try {
                let query =
                    firestore
                        .collection(
                            settings.adjustmentsCollection
                        );

                if (
                    typeof query.orderBy ===
                    "function"
                ) {
                    query =
                        query.orderBy(
                            "createdAt",
                            "desc"
                        );
                }

                if (
                    typeof query.limit ===
                    "function"
                ) {
                    query =
                        query.limit(
                            settings.adjustmentLimit
                        );
                }

                const snapshot =
                    await query.get();

                adjustments =
                    mapSnapshotDocuments(
                        snapshot
                    )
                        .map(
                            normalizeAdjustment
                        );

                renderAdjustments();

                if (
                    activeRecord
                ) {
                    renderProductAdjustments(
                        activeRecord.id
                    );
                }

                return cloneValue(
                    adjustments
                );
            } catch (
                error
            ) {
                reportError(
                    error
                );

                adjustments =
                    [];

                renderAdjustments(
                    "Unable to load inventory adjustments."
                );

                return [];
            }
        }

        /* ==================================================
           FILTERS
        ================================================== */

        function applyFilters() {
            const search =
                normalizeSearchTerm(
                    getInputValue(
                        elements.searchInput
                    )
                );

            const status =
                getInputValue(
                    elements.statusFilter
                ).toLowerCase();

            const availability =
                getInputValue(
                    elements.availabilityFilter
                ).toLowerCase();

            const category =
                getInputValue(
                    elements.categoryFilter
                ).toLowerCase();

            const sort =
                getInputValue(
                    elements.sortSelect
                ) ||
                "availableStock-asc";

            filteredInventory =
                allInventory.filter(
                    function (
                        record
                    ) {
                        if (
                            status &&
                            record.stockStatus !==
                                status
                        ) {
                            return false;
                        }

                        if (
                            availability &&
                            record.availability !==
                                availability
                        ) {
                            return false;
                        }

                        if (
                            category &&
                            String(
                                record.category ||
                                ""
                            ).toLowerCase() !==
                                category
                        ) {
                            return false;
                        }

                        if (
                            search &&
                            !matchesInventorySearch(
                                record,
                                search
                            )
                        ) {
                            return false;
                        }

                        return true;
                    }
                );

            filteredInventory.sort(
                createInventoryComparator(
                    sort
                )
            );

            currentPage =
                Math.min(
                    Math.max(
                        currentPage,
                        1
                    ),
                    getPageCount()
                );

            renderInventory();
            renderPagination();
            renderMetrics();

            setText(
                elements.visibleCount,
                filteredInventory.length
            );

            return cloneValue(
                filteredInventory
            );
        }

        function clearFilters() {
            setInputValue(
                elements.searchInput,
                ""
            );

            setInputValue(
                elements.statusFilter,
                ""
            );

            setInputValue(
                elements.availabilityFilter,
                ""
            );

            setInputValue(
                elements.categoryFilter,
                ""
            );

            setInputValue(
                elements.sortSelect,
                "availableStock-asc"
            );

            currentPage =
                1;

            applyFilters();
        }

        function showLowStock() {
            clearFilters();

            setInputValue(
                elements.statusFilter,
                "low-stock"
            );

            applyFilters();
        }

        function showOutOfStock() {
            clearFilters();

            setInputValue(
                elements.statusFilter,
                "out-of-stock"
            );

            applyFilters();
        }

        function renderCategoryOptions() {
            if (
                !elements.categoryFilter
            ) {
                return;
            }

            const currentValue =
                elements.categoryFilter.value;

            const categories =
                collectCategories(
                    allInventory
                );

            elements.categoryFilter.textContent =
                "";

            const defaultOption =
                documentObject
                    .createElement(
                        "option"
                    );

            defaultOption.value =
                "";

            defaultOption.textContent =
                "All categories";

            elements.categoryFilter.appendChild(
                defaultOption
            );

            for (
                const category of
                categories
            ) {
                const option =
                    documentObject
                        .createElement(
                            "option"
                        );

                option.value =
                    category.toLowerCase();

                option.textContent =
                    category;

                elements.categoryFilter.appendChild(
                    option
                );
            }

            if (
                Array.from(
                    elements.categoryFilter.options
                ).some(
                    function (
                        option
                    ) {
                        return option.value ===
                            currentValue;
                    }
                )
            ) {
                elements.categoryFilter.value =
                    currentValue;
            }
        }

        /* ==================================================
           METRICS
        ================================================== */

        function renderMetrics() {
            const metrics =
                calculateInventoryMetrics(
                    filteredInventory
                );

            setText(
                elements.totalProductsMetric,
                metrics.totalProducts
            );

            setText(
                elements.totalAvailableMetric,
                metrics.totalAvailable
            );

            setText(
                elements.lowStockMetric,
                metrics.lowStock
            );

            setText(
                elements.outOfStockMetric,
                metrics.outOfStock
            );

            return metrics;
        }

        /* ==================================================
           INVENTORY TABLE
        ================================================== */

        function renderInventory() {
            const table =
                resolveTableElement(
                    elements.table,
                    documentObject
                );

            if (
                !table
            ) {
                return;
            }

            const tbody =
                table.querySelector(
                    "tbody"
                ) ||
                table.appendChild(
                    documentObject
                        .createElement(
                            "tbody"
                        )
                );

            tbody.textContent =
                "";

            const records =
                getCurrentPageRecords();

            if (
                !records.length
            ) {
                renderEmptyTable(
                    "No matching inventory records found."
                );

                return;
            }

            for (
                const record of
                records
            ) {
                tbody.appendChild(
                    createInventoryRow(
                        record
                    )
                );
            }

            updateSelectAllState();
        }

        function createInventoryRow(
            record
        ) {
            const row =
                documentObject
                    .createElement(
                        "tr"
                    );

            const selectCell =
                documentObject
                    .createElement(
                        "td"
                    );

            const checkbox =
                documentObject
                    .createElement(
                        "input"
                    );

            checkbox.type =
                "checkbox";

            checkbox.checked =
                selectedProductIds.has(
                    record.id
                );

            checkbox.setAttribute(
                "aria-label",
                "Select " +
                record.name
            );

            checkbox.addEventListener(
                "change",
                function () {
                    setProductSelected(
                        record.id,
                        checkbox.checked
                    );
                }
            );

            selectCell.appendChild(
                checkbox
            );

            row.appendChild(
                selectCell
            );

            const productCell =
                documentObject
                    .createElement(
                        "td"
                    );

            const product =
                documentObject
                    .createElement(
                        "div"
                    );

            product.className =
                "admin-product-cell";

            if (
                record.imageUrl
            ) {
                const image =
                    documentObject
                        .createElement(
                            "img"
                        );

                image.className =
                    "admin-product-thumbnail";

                image.src =
                    record.imageUrl;

                image.alt =
                    record.name;

                product.appendChild(
                    image
                );
            } else {
                const placeholder =
                    documentObject
                        .createElement(
                            "span"
                        );

                placeholder.className =
                    "admin-product-thumbnail admin-product-thumbnail-placeholder";

                placeholder.textContent =
                    record.name
                        .charAt(
                            0
                        )
                        .toUpperCase();

                product.appendChild(
                    placeholder
                );
            }

            const copy =
                documentObject
                    .createElement(
                        "div"
                    );

            const name =
                documentObject
                    .createElement(
                        "strong"
                    );

            name.textContent =
                record.name;

            const detail =
                documentObject
                    .createElement(
                        "small"
                    );

            detail.textContent =
                record.category ||
                record.collection ||
                record.id;

            copy.appendChild(
                name
            );

            copy.appendChild(
                detail
            );

            product.appendChild(
                copy
            );

            productCell.appendChild(
                product
            );

            row.appendChild(
                productCell
            );

            appendTextCell(
                row,
                record.sku ||
                "—"
            );

            appendTextCell(
                row,
                record.onHandStock
            );

            appendTextCell(
                row,
                record.reservedStock
            );

            const availableCell =
                appendTextCell(
                    row,
                    record.availableStock
                );

            availableCell.dataset.status =
                record.availableStock <
                    0
                    ? "critical"
                    : record.availableStock <=
                        record.lowStockThreshold
                        ? "low"
                        : "healthy";

            appendTextCell(
                row,
                record.lowStockThreshold
            );

            appendStatusCell(
                row,
                record.stockStatus
            );

            appendTextCell(
                row,
                formatDate(
                    record.updatedAt,
                    settings.locale
                )
            );

            const actionsCell =
                documentObject
                    .createElement(
                        "td"
                    );

            const actions =
                documentObject
                    .createElement(
                        "div"
                    );

            actions.className =
                "admin-operation-actions";

            actions.appendChild(
                createActionButton(
                    documentObject,
                    "Edit",
                    function () {
                        openDrawer(
                            record
                        );
                    }
                )
            );

            actions.appendChild(
                createActionButton(
                    documentObject,
                    "+1",
                    function () {
                        return applyDirectAdjustment(
                            record,
                            "increase",
                            1,
                            "manual-correction",
                            "Quick inventory increase."
                        );
                    }
                )
            );

            actions.appendChild(
                createActionButton(
                    documentObject,
                    "-1",
                    function () {
                        return applyDirectAdjustment(
                            record,
                            "decrease",
                            1,
                            "manual-correction",
                            "Quick inventory decrease."
                        );
                    }
                )
            );

            actionsCell.appendChild(
                actions
            );

            row.appendChild(
                actionsCell
            );

            return row;
        }

        function renderEmptyTable(
            message
        ) {
            const table =
                resolveTableElement(
                    elements.table,
                    documentObject
                );

            if (
                !table
            ) {
                return;
            }

            const tbody =
                table.querySelector(
                    "tbody"
                ) ||
                table.appendChild(
                    documentObject
                        .createElement(
                            "tbody"
                        )
                );

            tbody.textContent =
                "";

            const row =
                documentObject
                    .createElement(
                        "tr"
                    );

            const cell =
                documentObject
                    .createElement(
                        "td"
                    );

            cell.colSpan =
                10;

            cell.className =
                "admin-operation-empty";

            cell.textContent =
                message ||
                "No inventory records found.";

            row.appendChild(
                cell
            );

            tbody.appendChild(
                row
            );
        }

        /* ==================================================
           PAGINATION
        ================================================== */

        function getPageCount() {
            return Math.max(
                1,
                Math.ceil(
                    filteredInventory.length /
                    settings.pageSize
                )
            );
        }

        function getCurrentPageRecords() {
            const start =
                (
                    currentPage -
                    1
                ) *
                settings.pageSize;

            return filteredInventory.slice(
                start,
                start +
                settings.pageSize
            );
        }

        function previousPage() {
            if (
                currentPage >
                1
            ) {
                currentPage -=
                    1;

                renderInventory();
                renderPagination();
            }
        }

        function nextPage() {
            if (
                currentPage <
                getPageCount()
            ) {
                currentPage +=
                    1;

                renderInventory();
                renderPagination();
            }
        }

        function renderPagination() {
            const pageCount =
                getPageCount();

            if (
                elements.previousButton
            ) {
                elements.previousButton.disabled =
                    currentPage <=
                    1;
            }

            if (
                elements.nextButton
            ) {
                elements.nextButton.disabled =
                    currentPage >=
                    pageCount;
            }

            setText(
                elements.pageLabel,
                "Page " +
                currentPage +
                " of " +
                pageCount
            );
        }

        /* ==================================================
           SELECTION / BULK
        ================================================== */

        function setProductSelected(
            productId,
            selected
        ) {
            if (
                selected
            ) {
                selectedProductIds.add(
                    productId
                );
            } else {
                selectedProductIds.delete(
                    productId
                );
            }

            renderBulkState();
            updateSelectAllState();
        }

        function selectAllVisible(
            selected
        ) {
            for (
                const record of
                getCurrentPageRecords()
            ) {
                if (
                    selected
                ) {
                    selectedProductIds.add(
                        record.id
                    );
                } else {
                    selectedProductIds.delete(
                        record.id
                    );
                }
            }

            renderInventory();
            renderBulkState();
        }

        function clearSelection() {
            selectedProductIds.clear();

            renderInventory();
            renderBulkState();
        }

        function renderBulkState() {
            const count =
                selectedProductIds.size;

            if (
                elements.bulkActions
            ) {
                elements.bulkActions.hidden =
                    count ===
                    0;
            }

            setText(
                elements.selectedCount,
                count
            );
        }

        function updateSelectAllState() {
            if (
                !elements.selectAll
            ) {
                return;
            }

            const visible =
                getCurrentPageRecords();

            const selectedCount =
                visible.filter(
                    function (
                        record
                    ) {
                        return selectedProductIds.has(
                            record.id
                        );
                    }
                ).length;

            elements.selectAll.checked =
                visible.length >
                    0 &&
                selectedCount ===
                    visible.length;

            elements.selectAll.indeterminate =
                selectedCount >
                    0 &&
                selectedCount <
                    visible.length;
        }

        async function bulkUpdate(
            patch,
            message
        ) {
            const ids =
                Array.from(
                    selectedProductIds
                );

            if (
                !ids.length
            ) {
                return false;
            }

            setLoading(
                true,
                "Updating selected inventory records…"
            );

            try {
                const batch =
                    firestore.batch();

                const timestamp =
                    createServerTimestamp();

                for (
                    const id of
                    ids
                ) {
                    const reference =
                        firestore
                            .collection(
                                settings.productsCollection
                            )
                            .doc(
                                id
                            );

                    batch.set(
                        reference,
                        Object.assign(
                            {},
                            patch,
                            {
                                updatedAt:
                                    timestamp,

                                updatedBy:
                                    getCurrentUserId(
                                        auth
                                    )
                            }
                        ),
                        {
                            merge:
                                true
                        }
                    );
                }

                await batch.commit();

                clearSelection();

                setStatus(
                    message ||
                    "Inventory records updated.",
                    "success"
                );

                await loadInventory();

                return true;
            } catch (
                error
            ) {
                const normalized =
                    normalizeInventoryError(
                        error,
                        "inventory/bulk-update-failed",
                        "Unable to update selected inventory records."
                    );

                setStatus(
                    normalized.message,
                    "error"
                );

                throw normalized;
            } finally {
                setLoading(
                    false
                );
            }
        }

        function openThresholdModal() {
            if (
                !selectedProductIds.size
            ) {
                return false;
            }

            if (
                elements.thresholdModal
            ) {
                elements.thresholdModal.hidden =
                    false;

                elements.thresholdModal.setAttribute(
                    "aria-hidden",
                    "false"
                );
            }

            documentObject
                .documentElement
                .classList
                .add(
                    "admin-modal-open"
                );

            return true;
        }

        function closeThresholdModal() {
            if (
                elements.thresholdModal
            ) {
                elements.thresholdModal.hidden =
                    true;

                elements.thresholdModal.setAttribute(
                    "aria-hidden",
                    "true"
                );
            }

            documentObject
                .documentElement
                .classList
                .remove(
                    "admin-modal-open"
                );
        }

        async function applyBulkThreshold() {
            const threshold =
                normalizeNonNegativeInteger(
                    getInputValue(
                        elements.thresholdValue
                    ),
                    settings.lowStockThreshold,
                    "Low-stock threshold"
                );

            await bulkUpdate(
                {
                    lowStockThreshold:
                        threshold
                },
                "Low-stock threshold updated."
            );

            closeThresholdModal();

            return true;
        }

        /* ==================================================
           DRAWER
        ================================================== */

        function openDrawer(
            record
        ) {
            activeRecord =
                cloneValue(
                    record
                );

            renderRecordDetails(
                activeRecord
            );

            if (
                elements.drawer
            ) {
                elements.drawer.classList.add(
                    "is-open"
                );

                elements.drawer.setAttribute(
                    "aria-hidden",
                    "false"
                );
            }

            documentObject
                .documentElement
                .classList
                .add(
                    "admin-editor-open"
                );

            return activeRecord;
        }

        function closeDrawer() {
            activeRecord =
                null;

            if (
                elements.drawer
            ) {
                elements.drawer.classList.remove(
                    "is-open"
                );

                elements.drawer.setAttribute(
                    "aria-hidden",
                    "true"
                );
            }

            documentObject
                .documentElement
                .classList
                .remove(
                    "admin-editor-open"
                );
        }

        function renderRecordDetails(
            record
        ) {
            setText(
                elements.drawerProductName,
                record.name
            );

            setInputValue(
                elements.productId,
                record.id
            );

            setText(
                elements.productName,
                record.name
            );

            setText(
                elements.productSku,
                record.sku ||
                "—"
            );

            if (
                record.imageUrl &&
                elements.productImage
            ) {
                elements.productImage.src =
                    record.imageUrl;

                elements.productImage.alt =
                    record.name;

                elements.productImage.hidden =
                    false;

                if (
                    elements.productPlaceholder
                ) {
                    elements.productPlaceholder.hidden =
                        true;
                }
            } else {
                if (
                    elements.productImage
                ) {
                    elements.productImage.src =
                        "";

                    elements.productImage.hidden =
                        true;
                }

                if (
                    elements.productPlaceholder
                ) {
                    elements.productPlaceholder.hidden =
                        false;

                    elements.productPlaceholder.textContent =
                        record.name
                            .charAt(
                                0
                            )
                            .toUpperCase();
                }
            }

            setStatusText(
                elements.stockStatusLabel,
                record.stockStatus
            );

            setStatusText(
                elements.availabilityLabel,
                record.availability
            );

            setText(
                elements.onHandLabel,
                record.onHandStock
            );

            setText(
                elements.reservedLabel,
                record.reservedStock
            );

            setText(
                elements.availableLabel,
                record.availableStock
            );

            setText(
                elements.updatedAt,
                formatDate(
                    record.updatedAt,
                    settings.locale
                )
            );

            setInputValue(
                elements.onHand,
                record.onHandStock
            );

            setInputValue(
                elements.reserved,
                record.reservedStock
            );

            setInputValue(
                elements.threshold,
                record.lowStockThreshold
            );

            setInputValue(
                elements.reorderQuantity,
                record.reorderQuantity
            );

            setInputValue(
                elements.availability,
                record.availability
            );

            setInputValue(
                elements.tracking,
                record.tracking
            );

            setChecked(
                elements.allowBackorder,
                record.allowBackorder
            );

            setChecked(
                elements.notifyLowStock,
                record.notifyLowStock
            );

            setInputValue(
                elements.adjustmentType,
                "increase"
            );

            setInputValue(
                elements.adjustmentQuantity,
                ""
            );

            setInputValue(
                elements.adjustmentReason,
                "stock-received"
            );

            setInputValue(
                elements.adjustmentNote,
                ""
            );

            setInputValue(
                elements.warehouse,
                record.location.warehouse
            );

            setInputValue(
                elements.binLocation,
                record.location.binLocation
            );

            setInputValue(
                elements.supplier,
                record.location.supplier
            );

            setInputValue(
                elements.supplierSku,
                record.location.supplierSku
            );

            setInputValue(
                elements.leadTime,
                record.location.leadTimeDays
            );

            renderProductAdjustments(
                record.id
            );
        }

        /* ==================================================
           SAVE INVENTORY
        ================================================== */

        async function saveInventory() {
            if (
                !activeRecord
            ) {
                return false;
            }

            const onHandStock =
                normalizeNonNegativeInteger(
                    getInputValue(
                        elements.onHand
                    ),
                    0,
                    "On-hand quantity"
                );

            const reservedStock =
                normalizeNonNegativeInteger(
                    getInputValue(
                        elements.reserved
                    ),
                    0,
                    "Reserved quantity"
                );

            const lowStockThreshold =
                normalizeNonNegativeInteger(
                    getInputValue(
                        elements.threshold
                    ),
                    settings.lowStockThreshold,
                    "Low-stock threshold"
                );

            const reorderQuantity =
                normalizeNonNegativeInteger(
                    getInputValue(
                        elements.reorderQuantity
                    ),
                    0,
                    "Reorder quantity"
                );

            const availability =
                normalizeAvailability(
                    getInputValue(
                        elements.availability
                    )
                );

            const tracking =
                normalizeTracking(
                    getInputValue(
                        elements.tracking
                    )
                );

            const availableStock =
                onHandStock -
                reservedStock;

            const patch = {
                stock:
                    onHandStock,

                onHandStock:
                    onHandStock,

                reservedStock:
                    reservedStock,

                availableStock:
                    availableStock,

                inStock:
                    availableStock >
                    0,

                lowStockThreshold:
                    lowStockThreshold,

                reorderQuantity:
                    reorderQuantity,

                availability:
                    availability,

                inventoryTracking:
                    tracking,

                allowBackorder:
                    getChecked(
                        elements.allowBackorder
                    ),

                notifyLowStock:
                    getChecked(
                        elements.notifyLowStock
                    ),

                stockStatus:
                    calculateStockStatus({
                        tracking,
                        onHandStock,
                        reservedStock,
                        availableStock,
                        lowStockThreshold
                    }),

                updatedAt:
                    createServerTimestamp(),

                updatedBy:
                    getCurrentUserId(
                        auth
                    )
            };

            setLoading(
                true,
                "Saving inventory…"
            );

            try {
                await firestore
                    .collection(
                        settings.productsCollection
                    )
                    .doc(
                        activeRecord.id
                    )
                    .set(
                        patch,
                        {
                            merge:
                                true
                        }
                    );

                await createAdjustmentRecord({
                    product:
                        activeRecord,

                    type:
                        "set",

                    reason:
                        "manual-correction",

                    note:
                        "Inventory levels updated from admin editor.",

                    previousQuantity:
                        activeRecord.onHandStock,

                    newQuantity:
                        onHandStock,

                    change:
                        onHandStock -
                        activeRecord.onHandStock
                });

                setStatus(
                    "Inventory updated.",
                    "success"
                );

                await refreshActiveRecord();

                return true;
            } catch (
                error
            ) {
                const normalized =
                    normalizeInventoryError(
                        error,
                        "inventory/save-failed",
                        "Unable to save inventory."
                    );

                setStatus(
                    normalized.message,
                    "error"
                );

                throw normalized;
            } finally {
                setLoading(
                    false
                );
            }
        }

        async function saveLocation() {
            if (
                !activeRecord
            ) {
                return false;
            }

            const location = {
                warehouse:
                    normalizeOptionalString(
                        getInputValue(
                            elements.warehouse
                        )
                    ),

                binLocation:
                    normalizeOptionalString(
                        getInputValue(
                            elements.binLocation
                        )
                    ),

                supplier:
                    normalizeOptionalString(
                        getInputValue(
                            elements.supplier
                        )
                    ),

                supplierSku:
                    normalizeOptionalString(
                        getInputValue(
                            elements.supplierSku
                        )
                    ),

                leadTimeDays:
                    normalizeNonNegativeInteger(
                        getInputValue(
                            elements.leadTime
                        ),
                        0,
                        "Lead time"
                    )
            };

            setLoading(
                true,
                "Saving inventory location…"
            );

            try {
                await firestore
                    .collection(
                        settings.productsCollection
                    )
                    .doc(
                        activeRecord.id
                    )
                    .set(
                        {
                            inventoryLocation:
                                location,

                            updatedAt:
                                createServerTimestamp(),

                            updatedBy:
                                getCurrentUserId(
                                    auth
                                )
                        },
                        {
                            merge:
                                true
                        }
                    );

                setStatus(
                    "Inventory location updated.",
                    "success"
                );

                await refreshActiveRecord();

                return true;
            } catch (
                error
            ) {
                const normalized =
                    normalizeInventoryError(
                        error,
                        "inventory/location-save-failed",
                        "Unable to save inventory location."
                    );

                setStatus(
                    normalized.message,
                    "error"
                );

                throw normalized;
            } finally {
                setLoading(
                    false
                );
            }
        }

        /* ==================================================
           ADJUSTMENTS
        ================================================== */

        async function applyAdjustment() {
            if (
                !activeRecord
            ) {
                return false;
            }

            const type =
                normalizeAdjustmentType(
                    getInputValue(
                        elements.adjustmentType
                    )
                );

            const quantity =
                normalizeNonNegativeInteger(
                    getInputValue(
                        elements.adjustmentQuantity
                    ),
                    0,
                    "Adjustment quantity"
                );

            if (
                type !==
                    "set" &&
                quantity ===
                    0
            ) {
                throw new InventoryControllerError(
                    "inventory/invalid-adjustment",
                    "Adjustment quantity must be greater than zero."
                );
            }

            const reason =
                normalizeOptionalString(
                    getInputValue(
                        elements.adjustmentReason
                    )
                ) ||
                "other";

            const note =
                normalizeOptionalString(
                    getInputValue(
                        elements.adjustmentNote
                    )
                );

            return applyDirectAdjustment(
                activeRecord,
                type,
                quantity,
                reason,
                note
            );
        }

        async function applyDirectAdjustment(
            record,
            type,
            quantity,
            reason,
            note
        ) {
            const normalizedType =
                normalizeAdjustmentType(
                    type
                );

            const normalizedQuantity =
                normalizeNonNegativeInteger(
                    quantity,
                    0,
                    "Adjustment quantity"
                );

            const previousQuantity =
                record.onHandStock;

            const newQuantity =
                calculateAdjustedQuantity(
                    previousQuantity,
                    normalizedType,
                    normalizedQuantity
                );

            const change =
                newQuantity -
                previousQuantity;

            return openConfirmation({
                title:
                    "Apply Inventory Adjustment?",

                message:
                    record.name +
                    " will change from " +
                    previousQuantity +
                    " to " +
                    newQuantity +
                    " units.",

                action:
                    async function () {
                        setLoading(
                            true,
                            "Applying inventory adjustment…"
                        );

                        try {
                            const availableStock =
                                newQuantity -
                                record.reservedStock;

                            const patch = {
                                stock:
                                    newQuantity,

                                onHandStock:
                                    newQuantity,

                                availableStock:
                                    availableStock,

                                inStock:
                                    availableStock >
                                    0,

                                stockStatus:
                                    calculateStockStatus({
                                        tracking:
                                            record.tracking,

                                        onHandStock:
                                            newQuantity,

                                        reservedStock:
                                            record.reservedStock,

                                        availableStock:
                                            availableStock,

                                        lowStockThreshold:
                                            record.lowStockThreshold
                                    }),

                                updatedAt:
                                    createServerTimestamp(),

                                updatedBy:
                                    getCurrentUserId(
                                        auth
                                    )
                            };

                            const batch =
                                firestore.batch();

                            const productReference =
                                firestore
                                    .collection(
                                        settings.productsCollection
                                    )
                                    .doc(
                                        record.id
                                    );

                            const adjustmentReference =
                                firestore
                                    .collection(
                                        settings.adjustmentsCollection
                                    )
                                    .doc();

                            batch.set(
                                productReference,
                                patch,
                                {
                                    merge:
                                        true
                                }
                            );

                            batch.set(
                                adjustmentReference,
                                createAdjustmentPayload({
                                    id:
                                        adjustmentReference.id,

                                    product:
                                        record,

                                    type:
                                        normalizedType,

                                    quantity:
                                        normalizedQuantity,

                                    reason:
                                        reason,

                                    note:
                                        note,

                                    previousQuantity:
                                        previousQuantity,

                                    newQuantity:
                                        newQuantity,

                                    change:
                                        change,

                                    adminId:
                                        getCurrentUserId(
                                            auth
                                        ),

                                    adminName:
                                        getCurrentUserName(
                                            auth
                                        )
                                })
                            );

                            await batch.commit();

                            setStatus(
                                "Inventory adjustment applied.",
                                "success"
                            );

                            await Promise.all([
                                loadInventory(),
                                loadAdjustments()
                            ]);

                            const updated =
                                allInventory.find(
                                    function (
                                        item
                                    ) {
                                        return item.id ===
                                            record.id;
                                    }
                                );

                            if (
                                updated
                            ) {
                                activeRecord =
                                    cloneValue(
                                        updated
                                    );

                                renderRecordDetails(
                                    activeRecord
                                );
                            }

                            return true;
                        } finally {
                            setLoading(
                                false
                            );
                        }
                    }
            });
        }

        async function createAdjustmentRecord(
            input
        ) {
            const reference =
                firestore
                    .collection(
                        settings.adjustmentsCollection
                    )
                    .doc();

            await reference.set(
                createAdjustmentPayload(
                    Object.assign(
                        {},
                        input,
                        {
                            id:
                                reference.id,

                            adminId:
                                getCurrentUserId(
                                    auth
                                ),

                            adminName:
                                getCurrentUserName(
                                    auth
                                )
                        }
                    )
                )
            );

            return reference.id;
        }

        function renderAdjustments(
            errorMessage
        ) {
            const table =
                resolveTableElement(
                    elements.adjustmentsTable,
                    documentObject
                );

            if (
                !table
            ) {
                return;
            }

            const tbody =
                table.querySelector(
                    "tbody"
                ) ||
                table.appendChild(
                    documentObject
                        .createElement(
                            "tbody"
                        )
                );

            tbody.textContent =
                "";

            if (
                errorMessage ||
                !adjustments.length
            ) {
                const row =
                    documentObject
                        .createElement(
                            "tr"
                        );

                const cell =
                    documentObject
                        .createElement(
                            "td"
                        );

                cell.colSpan =
                    8;

                cell.className =
                    "admin-operation-empty";

                cell.textContent =
                    errorMessage ||
                    "No inventory adjustments found.";

                row.appendChild(
                    cell
                );

                tbody.appendChild(
                    row
                );

                return;
            }

            for (
                const adjustment of
                adjustments
            ) {
                const row =
                    documentObject
                        .createElement(
                            "tr"
                        );

                appendTextCell(
                    row,
                    adjustment.productName ||
                    adjustment.productId
                );

                appendTextCell(
                    row,
                    titleCase(
                        adjustment.type
                    )
                );

                const changeCell =
                    appendTextCell(
                        row,
                        formatSignedInteger(
                            adjustment.change
                        )
                    );

                changeCell.dataset.status =
                    adjustment.change >
                        0
                        ? "positive"
                        : adjustment.change <
                            0
                            ? "negative"
                            : "neutral";

                appendTextCell(
                    row,
                    adjustment.previousQuantity
                );

                appendTextCell(
                    row,
                    adjustment.newQuantity
                );

                appendTextCell(
                    row,
                    titleCase(
                        adjustment.reason
                    )
                );

                appendTextCell(
                    row,
                    adjustment.adminName ||
                    adjustment.adminId ||
                    "System"
                );

                appendTextCell(
                    row,
                    formatDate(
                        adjustment.createdAt,
                        settings.locale
                    )
                );

                tbody.appendChild(
                    row
                );
            }
        }

        function renderProductAdjustments(
            productId
        ) {
            if (
                !elements.productAdjustments
            ) {
                return;
            }

            elements.productAdjustments.textContent =
                "";

            const records =
                adjustments.filter(
                    function (
                        adjustment
                    ) {
                        return adjustment.productId ===
                            productId;
                    }
                );

            if (
                !records.length
            ) {
                appendEmptyState(
                    elements.productAdjustments,
                    "No adjustments found for this product."
                );

                return;
            }

            for (
                const adjustment of
                records
            ) {
                const item =
                    documentObject
                        .createElement(
                            "article"
                        );

                item.className =
                    "admin-order-note";

                const title =
                    documentObject
                        .createElement(
                            "strong"
                        );

                title.textContent =
                    titleCase(
                        adjustment.type
                    ) +
                    " " +
                    formatSignedInteger(
                        adjustment.change
                    );

                const detail =
                    documentObject
                        .createElement(
                            "p"
                        );

                detail.textContent =
                    [
                        titleCase(
                            adjustment.reason
                        ),
                        adjustment.note
                    ]
                        .filter(
                            Boolean
                        )
                        .join(
                            " · "
                        );

                const meta =
                    documentObject
                        .createElement(
                            "small"
                        );

                meta.textContent =
                    [
                        adjustment.adminName ||
                        adjustment.adminId,
                        formatDate(
                            adjustment.createdAt,
                            settings.locale
                        )
                    ]
                        .filter(
                            Boolean
                        )
                        .join(
                            " · "
                        );

                item.appendChild(
                    title
                );

                item.appendChild(
                    detail
                );

                item.appendChild(
                    meta
                );

                elements.productAdjustments.appendChild(
                    item
                );
            }
        }

        /* ==================================================
           REFRESH ACTIVE RECORD
        ================================================== */

        async function refreshActiveRecord() {
            if (
                !activeRecord
            ) {
                return null;
            }

            const productId =
                activeRecord.id;

            await Promise.all([
                loadInventory(),
                loadAdjustments()
            ]);

            const updated =
                allInventory.find(
                    function (
                        record
                    ) {
                        return record.id ===
                            productId;
                    }
                );

            if (
                !updated
            ) {
                closeDrawer();

                return null;
            }

            activeRecord =
                cloneValue(
                    updated
                );

            renderRecordDetails(
                activeRecord
            );

            return activeRecord;
        }

        /* ==================================================
           CONFIRMATION
        ================================================== */

        function openConfirmation(
            input
        ) {
            const source =
                input ||
                {};

            pendingConfirmation =
                typeof source.action ===
                    "function"
                    ? source.action
                    : null;

            setText(
                elements.confirmTitle,
                source.title ||
                "Confirm Action"
            );

            setText(
                elements.confirmMessage,
                source.message ||
                "Are you sure?"
            );

            if (
                elements.confirmModal
            ) {
                elements.confirmModal.hidden =
                    false;

                elements.confirmModal.setAttribute(
                    "aria-hidden",
                    "false"
                );
            }

            documentObject
                .documentElement
                .classList
                .add(
                    "admin-modal-open"
                );

            return true;
        }

        function closeConfirmation() {
            pendingConfirmation =
                null;

            if (
                elements.confirmModal
            ) {
                elements.confirmModal.hidden =
                    true;

                elements.confirmModal.setAttribute(
                    "aria-hidden",
                    "true"
                );
            }

            documentObject
                .documentElement
                .classList
                .remove(
                    "admin-modal-open"
                );
        }

        async function confirmAction() {
            if (
                !pendingConfirmation
            ) {
                closeConfirmation();

                return false;
            }

            const action =
                pendingConfirmation;

            setButtonBusy(
                elements.confirmSubmit,
                true
            );

            try {
                await action();

                closeConfirmation();

                return true;
            } catch (
                error
            ) {
                const normalized =
                    normalizeInventoryError(
                        error,
                        "inventory/action-failed",
                        "Unable to complete inventory action."
                    );

                setStatus(
                    normalized.message,
                    "error"
                );

                throw normalized;
            } finally {
                setButtonBusy(
                    elements.confirmSubmit,
                    false
                );
            }
        }

        /* ==================================================
           CSV EXPORT
        ================================================== */

        function exportCsv() {
            const rows =
                filteredInventory.map(
                    function (
                        record
                    ) {
                        return {
                            productId:
                                record.id,

                            name:
                                record.name,

                            sku:
                                record.sku ||
                                "",

                            category:
                                record.category ||
                                "",

                            collection:
                                record.collection ||
                                "",

                            onHand:
                                record.onHandStock,

                            reserved:
                                record.reservedStock,

                            available:
                                record.availableStock,

                            threshold:
                                record.lowStockThreshold,

                            reorderQuantity:
                                record.reorderQuantity,

                            stockStatus:
                                record.stockStatus,

                            availability:
                                record.availability,

                            tracking:
                                record.tracking,

                            allowBackorder:
                                record.allowBackorder
                                    ? "yes"
                                    : "no",

                            warehouse:
                                record.location.warehouse ||
                                "",

                            binLocation:
                                record.location.binLocation ||
                                "",

                            supplier:
                                record.location.supplier ||
                                "",

                            updatedAt:
                                record.updatedAt ||
                                ""
                        };
                    }
                );

            const csv =
                createCsv(
                    rows
                );

            downloadTextFile(
                global,
                documentObject,
                csv,
                "leternel-inventory-" +
                formatFileDate(
                    new Date()
                ) +
                ".csv",
                "text/csv;charset=utf-8"
            );

            setStatus(
                rows.length +
                " inventory record" +
                (
                    rows.length ===
                        1
                        ? ""
                        : "s"
                ) +
                " exported.",
                "success"
            );
        }

        /* ==================================================
           EVENTS
        ================================================== */

        function bindEvents() {
            bindClick(
                elements.refreshButton,
                function () {
                    return Promise.all([
                        loadInventory(),
                        loadAdjustments()
                    ]);
                }
            );

            bindClick(
                elements.exportButton,
                exportCsv
            );

            bindInput(
                elements.searchInput,
                debounce(
                    resetPageAndApply,
                    200
                )
            );

            bindChange(
                elements.statusFilter,
                resetPageAndApply
            );

            bindChange(
                elements.availabilityFilter,
                resetPageAndApply
            );

            bindChange(
                elements.categoryFilter,
                resetPageAndApply
            );

            bindChange(
                elements.sortSelect,
                resetPageAndApply
            );

            bindClick(
                elements.clearFiltersButton,
                clearFilters
            );

            bindClick(
                elements.showLowStockButton,
                showLowStock
            );

            bindClick(
                elements.showOutOfStockButton,
                showOutOfStock
            );

            bindClick(
                elements.previousButton,
                previousPage
            );

            bindClick(
                elements.nextButton,
                nextPage
            );

            bindChange(
                elements.selectAll,
                function () {
                    selectAllVisible(
                        elements.selectAll.checked
                    );
                }
            );

            bindClick(
                elements.bulkAvailableButton,
                function () {
                    return bulkUpdate(
                        {
                            availability:
                                "available"
                        },
                        "Selected products marked available."
                    );
                }
            );

            bindClick(
                elements.bulkUnavailableButton,
                function () {
                    return bulkUpdate(
                        {
                            availability:
                                "unavailable"
                        },
                        "Selected products marked unavailable."
                    );
                }
            );

            bindClick(
                elements.bulkThresholdButton,
                openThresholdModal
            );

            bindClick(
                elements.bulkClearButton,
                clearSelection
            );

            bindClick(
                elements.adjustmentsRefreshButton,
                loadAdjustments
            );

            bindClick(
                elements.drawerClose,
                closeDrawer
            );

            bindClick(
                elements.saveButton,
                saveInventory
            );

            bindClick(
                elements.adjustButton,
                applyAdjustment
            );

            bindClick(
                elements.saveLocationButton,
                saveLocation
            );

            bindClickMultiple(
                settings.selectors
                    .thresholdCancel,
                closeThresholdModal
            );

            bindClick(
                elements.thresholdConfirm,
                applyBulkThreshold
            );

            bindClickMultiple(
                settings.selectors
                    .confirmCancel,
                closeConfirmation
            );

            bindClick(
                elements.confirmSubmit,
                confirmAction
            );

            const keydownListener =
                function (
                    event
                ) {
                    if (
                        event.key !==
                        "Escape"
                    ) {
                        return;
                    }

                    if (
                        elements.confirmModal &&
                        !elements.confirmModal.hidden
                    ) {
                        closeConfirmation();

                        return;
                    }

                    if (
                        elements.thresholdModal &&
                        !elements.thresholdModal.hidden
                    ) {
                        closeThresholdModal();

                        return;
                    }

                    if (
                        elements.drawer &&
                        elements.drawer.classList
                            .contains(
                                "is-open"
                            )
                    ) {
                        closeDrawer();
                    }
                };

            documentObject.addEventListener(
                "keydown",
                keydownListener
            );

            disposers.push(
                function () {
                    documentObject.removeEventListener(
                        "keydown",
                        keydownListener
                    );
                }
            );
        }

        function resetPageAndApply() {
            currentPage =
                1;

            applyFilters();
        }

        function bindClick(
            element,
            handler
        ) {
            if (
                !element
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
                        reportError
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

        function bindClickMultiple(
            selector,
            handler
        ) {
            const nodes =
                Array.from(
                    documentObject
                        .querySelectorAll(
                            selector
                        )
                );

            for (
                const node of
                nodes
            ) {
                bindClick(
                    node,
                    handler
                );
            }
        }

        function bindInput(
            element,
            handler
        ) {
            if (
                !element
            ) {
                return;
            }

            element.addEventListener(
                "input",
                handler
            );

            disposers.push(
                function () {
                    element.removeEventListener(
                        "input",
                        handler
                    );
                }
            );
        }

        function bindChange(
            element,
            handler
        ) {
            if (
                !element
            ) {
                return;
            }

            element.addEventListener(
                "change",
                handler
            );

            disposers.push(
                function () {
                    element.removeEventListener(
                        "change",
                        handler
                    );
                }
            );
        }

        /* ==================================================
           UI STATE
        ================================================== */

        function setLoading(
            active,
            message
        ) {
            loading =
                Boolean(
                    active
                );

            if (
                elements.loadingOverlay
            ) {
                elements.loadingOverlay.hidden =
                    !loading;

                elements.loadingOverlay.setAttribute(
                    "aria-hidden",
                    loading
                        ? "false"
                        : "true"
                );
            }

            if (
                message &&
                elements.loadingMessage
            ) {
                elements.loadingMessage.textContent =
                    message;
            }
        }

        function setStatus(
            message,
            status
        ) {
            if (
                !elements.statusMessage
            ) {
                return;
            }

            elements.statusMessage.textContent =
                String(
                    message ||
                    ""
                );

            elements.statusMessage.dataset.status =
                status ||
                "info";
        }

        /* ==================================================
           SNAPSHOT
        ================================================== */

        function getSnapshot() {
            return {
                initialized,
                destroyed,
                loading,
                currentPage,

                pageCount:
                    getPageCount(),

                totalRecords:
                    allInventory.length,

                visibleRecords:
                    filteredInventory.length,

                selectedProductIds:
                    Array.from(
                        selectedProductIds
                    ),

                activeRecord:
                    cloneValue(
                        activeRecord
                    ),

                adjustmentCount:
                    adjustments.length
            };
        }

        const controller =
            Object.freeze({
                init,
                destroy,

                loadInventory,
                loadAdjustments,

                applyFilters,
                clearFilters,
                showLowStock,
                showOutOfStock,

                renderInventory,
                renderMetrics,
                renderPagination,
                renderAdjustments,

                openDrawer,
                closeDrawer,
                renderRecordDetails,

                saveInventory,
                saveLocation,

                applyAdjustment,
                applyDirectAdjustment,
                createAdjustmentRecord,

                selectAllVisible,
                clearSelection,
                bulkUpdate,

                exportCsv,

                getSnapshot,

                get inventory() {
                    return cloneValue(
                        allInventory
                    );
                },

                get filteredInventory() {
                    return cloneValue(
                        filteredInventory
                    );
                },

                get adjustments() {
                    return cloneValue(
                        adjustments
                    );
                },

                elements,
                options:
                    settings
            });

        return controller;
    }

    /* ======================================================
       NORMALIZATION
    ====================================================== */

    function normalizeInventoryRecord(
        input
    ) {
        const source =
            input ||
            {};

        const inventory =
            source.inventory &&
            typeof source.inventory ===
                "object"
                ? source.inventory
                : {};

        const location =
            source.inventoryLocation &&
            typeof source.inventoryLocation ===
                "object"
                ? source.inventoryLocation
                : inventory.location &&
                    typeof inventory.location ===
                        "object"
                    ? inventory.location
                    : {};

        const tracking =
            normalizeTracking(
                source.inventoryTracking ||
                inventory.tracking ||
                (
                    source.trackInventory ===
                        false
                        ? "not-tracked"
                        : "tracked"
                )
            );

        const onHandStock =
            normalizeInteger(
                source.onHandStock !==
                    undefined
                    ? source.onHandStock
                    : inventory.onHand !==
                        undefined
                        ? inventory.onHand
                        : source.stock !==
                            undefined
                            ? source.stock
                            : source.quantity,
                0,
                "On-hand stock"
            );

        const reservedStock =
            normalizeNonNegativeInteger(
                source.reservedStock !==
                    undefined
                    ? source.reservedStock
                    : inventory.reserved,
                0,
                "Reserved stock"
            );

        const availableStock =
            source.availableStock !==
                undefined
                ? normalizeInteger(
                      source.availableStock,
                      onHandStock -
                      reservedStock,
                      "Available stock"
                  )
                : onHandStock -
                  reservedStock;

        const lowStockThreshold =
            normalizeNonNegativeInteger(
                source.lowStockThreshold !==
                    undefined
                    ? source.lowStockThreshold
                    : inventory.lowStockThreshold,
                DEFAULT_LOW_STOCK_THRESHOLD,
                "Low-stock threshold"
            );

        return {
            id:
                normalizeRequiredId(
                    source.id,
                    "Product ID"
                ),

            name:
                normalizeRequiredString(
                    source.name ||
                    source.title ||
                    "Unnamed Product",
                    "Product name"
                ),

            sku:
                normalizeOptionalString(
                    source.sku
                ),

            category:
                normalizeOptionalString(
                    source.category
                ),

            collection:
                normalizeOptionalString(
                    source.collection
                ),

            imageUrl:
                normalizeOptionalString(
                    source.imageUrl ||
                    source.image
                ),

            tracking:
                tracking,

            onHandStock:
                onHandStock,

            reservedStock:
                reservedStock,

            availableStock:
                availableStock,

            lowStockThreshold:
                lowStockThreshold,

            reorderQuantity:
                normalizeNonNegativeInteger(
                    source.reorderQuantity !==
                        undefined
                        ? source.reorderQuantity
                        : inventory.reorderQuantity,
                    0,
                    "Reorder quantity"
                ),

            availability:
                normalizeAvailability(
                    source.availability ||
                    inventory.availability ||
                    (
                        availableStock >
                            0
                            ? "available"
                            : source.allowBackorder
                                ? "backorder"
                                : "unavailable"
                    )
                ),

            allowBackorder:
                Boolean(
                    source.allowBackorder ||
                    inventory.allowBackorder
                ),

            notifyLowStock:
                source.notifyLowStock !==
                    undefined
                    ? Boolean(
                          source.notifyLowStock
                      )
                    : inventory.notifyLowStock !==
                        undefined
                        ? Boolean(
                              inventory.notifyLowStock
                          )
                        : true,

            stockStatus:
                calculateStockStatus({
                    tracking,
                    onHandStock,
                    reservedStock,
                    availableStock,
                    lowStockThreshold
                }),

            location: {
                warehouse:
                    normalizeOptionalString(
                        location.warehouse
                    ),

                binLocation:
                    normalizeOptionalString(
                        location.binLocation ||
                        location.bin
                    ),

                supplier:
                    normalizeOptionalString(
                        location.supplier
                    ),

                supplierSku:
                    normalizeOptionalString(
                        location.supplierSku
                    ),

                leadTimeDays:
                    normalizeNonNegativeInteger(
                        location.leadTimeDays,
                        0,
                        "Lead time"
                    )
            },

            updatedAt:
                normalizeDateValue(
                    source.updatedAt ||
                    source.createdAt
                ),

            createdAt:
                normalizeDateValue(
                    source.createdAt
                )
        };
    }

    function normalizeAdjustment(
        input
    ) {
        const source =
            input ||
            {};

        return {
            id:
                normalizeRequiredId(
                    source.id,
                    "Adjustment ID"
                ),

            productId:
                normalizeRequiredId(
                    source.productId,
                    "Product ID"
                ),

            productName:
                normalizeOptionalString(
                    source.productName
                ),

            sku:
                normalizeOptionalString(
                    source.sku
                ),

            type:
                normalizeAdjustmentType(
                    source.type ||
                    "set"
                ),

            quantity:
                normalizeNonNegativeInteger(
                    source.quantity,
                    0,
                    "Adjustment quantity"
                ),

            change:
                normalizeInteger(
                    source.change,
                    0,
                    "Adjustment change"
                ),

            previousQuantity:
                normalizeInteger(
                    source.previousQuantity,
                    0,
                    "Previous quantity"
                ),

            newQuantity:
                normalizeInteger(
                    source.newQuantity,
                    0,
                    "New quantity"
                ),

            reason:
                normalizeOptionalString(
                    source.reason
                ) ||
                "other",

            note:
                normalizeOptionalString(
                    source.note
                ),

            adminId:
                normalizeOptionalString(
                    source.adminId ||
                    source.createdBy
                ),

            adminName:
                normalizeOptionalString(
                    source.adminName
                ),

            createdAt:
                normalizeDateValue(
                    source.createdAt
                )
        };
    }

    function createAdjustmentPayload(
        input
    ) {
        const source =
            input ||
            {};

        const product =
            source.product ||
            {};

        return {
            id:
                source.id ||
                null,

            productId:
                product.id,

            productName:
                product.name,

            sku:
                product.sku ||
                null,

            type:
                normalizeAdjustmentType(
                    source.type
                ),

            quantity:
                normalizeNonNegativeInteger(
                    source.quantity !==
                        undefined
                        ? source.quantity
                        : Math.abs(
                              Number(
                                  source.change
                              ) ||
                              0
                          ),
                    0,
                    "Adjustment quantity"
                ),

            change:
                normalizeInteger(
                    source.change,
                    0,
                    "Adjustment change"
                ),

            previousQuantity:
                normalizeInteger(
                    source.previousQuantity,
                    0,
                    "Previous quantity"
                ),

            newQuantity:
                normalizeInteger(
                    source.newQuantity,
                    0,
                    "New quantity"
                ),

            reason:
                normalizeOptionalString(
                    source.reason
                ) ||
                "other",

            note:
                normalizeOptionalString(
                    source.note
                ),

            adminId:
                source.adminId ||
                null,

            adminName:
                source.adminName ||
                null,

            createdAt:
                createServerTimestamp()
        };
    }

    /* ======================================================
       METRICS / STATUS / SORT
    ====================================================== */

    function calculateInventoryMetrics(
        records
    ) {
        const rows =
            Array.isArray(
                records
            )
                ? records
                : [];

        return {
            totalProducts:
                rows.length,

            totalOnHand:
                rows.reduce(
                    function (
                        total,
                        record
                    ) {
                        return total +
                            record.onHandStock;
                    },
                    0
                ),

            totalReserved:
                rows.reduce(
                    function (
                        total,
                        record
                    ) {
                        return total +
                            record.reservedStock;
                    },
                    0
                ),

            totalAvailable:
                rows.reduce(
                    function (
                        total,
                        record
                    ) {
                        return total +
                            Math.max(
                                0,
                                record.availableStock
                            );
                    },
                    0
                ),

            lowStock:
                rows.filter(
                    function (
                        record
                    ) {
                        return record.stockStatus ===
                            "low-stock";
                    }
                ).length,

            outOfStock:
                rows.filter(
                    function (
                        record
                    ) {
                        return (
                            record.stockStatus ===
                                "out-of-stock" ||
                            record.stockStatus ===
                                "oversold"
                        );
                    }
                ).length
        };
    }

    function calculateStockStatus(
        input
    ) {
        const source =
            input ||
            {};

        if (
            source.tracking ===
            "not-tracked"
        ) {
            return "not-tracked";
        }

        const availableStock =
            Number(
                source.availableStock
            );

        const threshold =
            Number(
                source.lowStockThreshold
            ) ||
            0;

        if (
            availableStock <
            0
        ) {
            return "oversold";
        }

        if (
            availableStock ===
            0
        ) {
            return "out-of-stock";
        }

        if (
            availableStock <=
            threshold
        ) {
            return "low-stock";
        }

        return "in-stock";
    }

    function calculateAdjustedQuantity(
        currentQuantity,
        type,
        quantity
    ) {
        const current =
            normalizeInteger(
                currentQuantity,
                0,
                "Current quantity"
            );

        const normalizedQuantity =
            normalizeNonNegativeInteger(
                quantity,
                0,
                "Adjustment quantity"
            );

        switch (
            normalizeAdjustmentType(
                type
            )
        ) {
            case "increase":
                return current +
                    normalizedQuantity;

            case "decrease":
                return Math.max(
                    0,
                    current -
                    normalizedQuantity
                );

            case "set":
                return normalizedQuantity;

            default:
                return current;
        }
    }

    function matchesInventorySearch(
        record,
        search
    ) {
        const haystack =
            [
                record.id,
                record.name,
                record.sku,
                record.category,
                record.collection,
                record.location.warehouse,
                record.location.binLocation,
                record.location.supplier,
                record.location.supplierSku
            ]
                .filter(
                    Boolean
                )
                .join(
                    " "
                )
                .toLowerCase();

        return haystack.includes(
            normalizeSearchTerm(
                search
            )
        );
    }

    function createInventoryComparator(
        value
    ) {
        const [
            field,
            direction
        ] =
            String(
                value ||
                "availableStock-asc"
            ).split(
                "-"
            );

        const multiplier =
            direction ===
                "asc"
                ? 1
                : -1;

        return function (
            first,
            second
        ) {
            const left =
                normalizeSortValue(
                    first[
                        field
                    ]
                );

            const right =
                normalizeSortValue(
                    second[
                        field
                    ]
                );

            if (
                left <
                right
            ) {
                return -1 *
                    multiplier;
            }

            if (
                left >
                right
            ) {
                return multiplier;
            }

            return String(
                first.id
            ).localeCompare(
                String(
                    second.id
                )
            );
        };
    }

    function collectCategories(
        records
    ) {
        return Array.from(
            new Set(
                (
                    Array.isArray(
                        records
                    )
                        ? records
                        : []
                )
                    .map(
                        function (
                            record
                        ) {
                            return record.category;
                        }
                    )
                    .filter(
                        Boolean
                    )
            )
        ).sort(
            function (
                first,
                second
            ) {
                return first.localeCompare(
                    second
                );
            }
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
            document:
                source.document ||
                null,

            root:
                source.root ||
                null,

            firestore:
                source.firestore ||
                null,

            auth:
                source.auth ||
                null,

            productsCollection:
                normalizeCollectionName(
                    source.productsCollection,
                    DEFAULT_PRODUCTS_COLLECTION
                ),

            adjustmentsCollection:
                normalizeCollectionName(
                    source.adjustmentsCollection,
                    DEFAULT_ADJUSTMENTS_COLLECTION
                ),

            pageSize:
                normalizePositiveInteger(
                    source.pageSize,
                    DEFAULT_PAGE_SIZE,
                    "Page size"
                ),

            queryLimit:
                normalizePositiveInteger(
                    source.queryLimit,
                    DEFAULT_QUERY_LIMIT,
                    "Query limit"
                ),

            adjustmentLimit:
                normalizePositiveInteger(
                    source.adjustmentLimit,
                    DEFAULT_ADJUSTMENT_LIMIT,
                    "Adjustment limit"
                ),

            lowStockThreshold:
                normalizeNonNegativeInteger(
                    source.lowStockThreshold,
                    DEFAULT_LOW_STOCK_THRESHOLD,
                    "Low-stock threshold"
                ),

            locale:
                normalizeLocale(
                    source.locale ||
                    DEFAULT_LOCALE
                ),

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
       NORMALIZERS
    ====================================================== */

    function normalizeRequiredId(
        value,
        label
    ) {
        const normalized =
            String(
                value ||
                ""
            ).trim();

        if (
            !normalized
        ) {
            throw new InventoryControllerError(
                "inventory/invalid-id",
                (
                    label ||
                    "ID"
                ) +
                " is required."
            );
        }

        return normalized;
    }

    function normalizeRequiredString(
        value,
        label
    ) {
        const normalized =
            String(
                value ||
                ""
            ).trim();

        if (
            !normalized
        ) {
            throw new InventoryControllerError(
                "inventory/invalid-string",
                (
                    label ||
                    "Value"
                ) +
                " is required."
            );
        }

        return normalized;
    }

    function normalizeOptionalString(
        value
    ) {
        if (
            value ===
                undefined ||
            value ===
                null
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

    function normalizeSearchTerm(
        value
    ) {
        return String(
            value ||
            ""
        )
            .trim()
            .toLowerCase();
    }

    function normalizePositiveInteger(
        value,
        fallback,
        label
    ) {
        if (
            value ===
                undefined ||
            value ===
                null ||
            value ===
                ""
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
            value ===
                undefined ||
            value ===
                null ||
            value ===
                ""
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
            value ===
                undefined ||
            value ===
                null ||
            value ===
                ""
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

    function normalizeCollectionName(
        value,
        fallback
    ) {
        const normalized =
            String(
                value ||
                fallback
            ).trim();

        if (
            !normalized ||
            normalized.includes(
                "/"
            )
        ) {
            throw new TypeError(
                "Firestore collection name is invalid."
            );
        }

        return normalized;
    }

    function normalizeLocale(
        value
    ) {
        return String(
            value ||
            DEFAULT_LOCALE
        ).trim() ||
            DEFAULT_LOCALE;
    }

    function normalizeAvailability(
        value
    ) {
        const normalized =
            String(
                value ||
                "available"
            )
                .trim()
                .toLowerCase();

        if (
            !AVAILABILITY_STATUSES.includes(
                normalized
            )
        ) {
            throw new InventoryControllerError(
                "inventory/invalid-availability",
                "Inventory availability is invalid."
            );
        }

        return normalized;
    }

    function normalizeTracking(
        value
    ) {
        const normalized =
            String(
                value ||
                "tracked"
            )
                .trim()
                .toLowerCase();

        if (
            !TRACKING_STATUSES.includes(
                normalized
            )
        ) {
            return "tracked";
        }

        return normalized;
    }

    function normalizeAdjustmentType(
        value
    ) {
        const normalized =
            String(
                value ||
                "set"
            )
                .trim()
                .toLowerCase();

        if (
            !ADJUSTMENT_TYPES.includes(
                normalized
            )
        ) {
            throw new InventoryControllerError(
                "inventory/invalid-adjustment-type",
                "Inventory adjustment type is invalid."
            );
        }

        return normalized;
    }

    /* ======================================================
       DATE / FORMAT
    ====================================================== */

    function normalizeDateValue(
        value
    ) {
        if (
            !value
        ) {
            return null;
        }

        if (
            value instanceof Date
        ) {
            return value.toISOString();
        }

        if (
            typeof value.toDate ===
                "function"
        ) {
            return value
                .toDate()
                .toISOString();
        }

        if (
            typeof value.toMillis ===
                "function"
        ) {
            return new Date(
                value.toMillis()
            ).toISOString();
        }

        const date =
            new Date(
                value
            );

        return Number.isNaN(
            date.getTime()
        )
            ? null
            : date.toISOString();
    }

    function formatDate(
        value,
        locale
    ) {
        if (
            !value
        ) {
            return "—";
        }

        const date =
            new Date(
                value
            );

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {
            return "—";
        }

        return new Intl
            .DateTimeFormat(
                locale ||
                DEFAULT_LOCALE,
                {
                    dateStyle:
                        "medium",

                    timeStyle:
                        "short"
                }
            )
            .format(
                date
            );
    }

    function formatSignedInteger(
        value
    ) {
        const normalized =
            Number(
                value
            ) ||
            0;

        return normalized >
            0
            ? "+" +
              normalized
            : String(
                  normalized
              );
    }

    function createServerTimestamp() {
        if (
            global.firebase &&
            global.firebase.firestore &&
            global.firebase.firestore
                .FieldValue &&
            typeof global.firebase
                .firestore
                .FieldValue
                .serverTimestamp ===
                "function"
        ) {
            return global.firebase
                .firestore
                .FieldValue
                .serverTimestamp();
        }

        return new Date();
    }

    /* ======================================================
       CSV
    ====================================================== */

    function createCsv(
        rows
    ) {
        if (
            !rows.length
        ) {
            return "";
        }

        const headers =
            Object.keys(
                rows[0]
            );

        const lines = [
            headers.map(
                escapeCsvValue
            ).join(
                ","
            )
        ];

        for (
            const row of
            rows
        ) {
            lines.push(
                headers.map(
                    function (
                        header
                    ) {
                        return escapeCsvValue(
                            row[
                                header
                            ]
                        );
                    }
                ).join(
                    ","
                )
            );
        }

        return lines.join(
            "\r\n"
        );
    }

    function escapeCsvValue(
        value
    ) {
        const normalized =
            String(
                value ===
                    undefined ||
                value ===
                    null
                    ? ""
                    : value
            );

        if (
            /[",\r\n]/.test(
                normalized
            )
        ) {
            return (
                '"' +
                normalized.replace(
                    /"/g,
                    '""'
                ) +
                '"'
            );
        }

        return normalized;
    }

    function downloadTextFile(
        windowObject,
        documentObject,
        content,
        filename,
        type
    ) {
        const blob =
            new Blob(
                [
                    content
                ],
                {
                    type:
                        type ||
                        "text/plain"
                }
            );

        const url =
            windowObject.URL
                .createObjectURL(
                    blob
                );

        const anchor =
            documentObject
                .createElement(
                    "a"
                );

        anchor.href =
            url;

        anchor.download =
            filename;

        documentObject.body
            .appendChild(
                anchor
            );

        anchor.click();
        anchor.remove();

        windowObject.URL
            .revokeObjectURL(
                url
            );
    }

    function formatFileDate(
        date
    ) {
        return date
            .toISOString()
            .slice(
                0,
                10
            );
    }

    /* ======================================================
       FIREBASE
    ====================================================== */

    function resolveFirestore() {
        if (
            global.firebase &&
            typeof global.firebase
                .firestore ===
                "function"
        ) {
            return global.firebase
                .firestore();
        }

        return null;
    }

    function resolveAuth() {
        if (
            global.firebase &&
            typeof global.firebase
                .auth ===
                "function"
        ) {
            return global.firebase
                .auth();
        }

        return null;
    }

    function getCurrentUserId(
        auth
    ) {
        return auth &&
        auth.currentUser
            ? auth.currentUser.uid ||
              null
            : null;
    }

    function getCurrentUserName(
        auth
    ) {
        return auth &&
        auth.currentUser
            ? auth.currentUser
                  .displayName ||
              auth.currentUser
                  .email ||
              null
            : null;
    }

    function mapSnapshotDocuments(
        snapshot
    ) {
        if (
            !snapshot ||
            !Array.isArray(
                snapshot.docs
            )
        ) {
            return [];
        }

        return snapshot.docs.map(
            function (
                documentSnapshot
            ) {
                const data =
                    typeof documentSnapshot
                        .data ===
                        "function"
                        ? documentSnapshot.data()
                        : {};

                return Object.assign(
                    {
                        id:
                            documentSnapshot.id
                    },
                    data ||
                    {}
                );
            }
        );
    }

    /* ======================================================
       DOM
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
        documentObject,
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
                documentObject
                    .querySelector(
                        selector
                    );
        }

        return output;
    }

    function resolveTableElement(
        element,
        documentObject
    ) {
        if (
            !element
        ) {
            return null;
        }

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
                documentObject
                    .createElement(
                        "table"
                    );

            table.className =
                "admin-operation-table";

            element.appendChild(
                table
            );
        }

        return table;
    }

    function appendTextCell(
        row,
        value
    ) {
        const cell =
            row.ownerDocument
                .createElement(
                    "td"
                );

        cell.textContent =
            value ===
                undefined ||
            value ===
                null ||
            value ===
                ""
                ? "—"
                : String(
                      value
                  );

        row.appendChild(
            cell
        );

        return cell;
    }

    function appendStatusCell(
        row,
        value
    ) {
        const cell =
            appendTextCell(
                row,
                titleCase(
                    value
                )
            );

        cell.dataset.status =
            value;

        return cell;
    }

    function createActionButton(
        documentObject,
        label,
        handler
    ) {
        const button =
            documentObject
                .createElement(
                    "button"
                );

        button.type =
            "button";

        button.className =
            "admin-operation-action";

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
                        reportError
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

    function appendEmptyState(
        container,
        message
    ) {
        const element =
            container.ownerDocument
                .createElement(
                    "div"
                );

        element.className =
            "admin-dashboard-empty";

        element.textContent =
            message;

        container.appendChild(
            element
        );
    }

    function setText(
        element,
        value
    ) {
        if (
            element
        ) {
            element.textContent =
                value ===
                    undefined ||
                value ===
                    null ||
                value ===
                    ""
                    ? "—"
                    : String(
                          value
                      );
        }
    }

    function setInputValue(
        element,
        value
    ) {
        if (
            element
        ) {
            element.value =
                value ===
                    undefined ||
                value ===
                    null
                    ? ""
                    : String(
                          value
                      );
        }
    }

    function getInputValue(
        element
    ) {
        return element
            ? String(
                  element.value ||
                  ""
              ).trim()
            : "";
    }

    function setChecked(
        element,
        value
    ) {
        if (
            element
        ) {
            element.checked =
                Boolean(
                    value
                );
        }
    }

    function getChecked(
        element
    ) {
        return Boolean(
            element &&
            element.checked
        );
    }

    function setStatusText(
        element,
        value
    ) {
        if (
            !element
        ) {
            return;
        }

        element.textContent =
            titleCase(
                value
            );

        element.dataset.status =
            value;
    }

    function setButtonBusy(
        element,
        busy
    ) {
        if (
            !element
        ) {
            return;
        }

        element.disabled =
            Boolean(
                busy
            );

        element.setAttribute(
            "aria-busy",
            busy
                ? "true"
                : "false"
        );
    }

    /* ======================================================
       HELPERS
    ====================================================== */

    function normalizeSortValue(
        value
    ) {
        if (
            value ===
                undefined ||
            value ===
                null
        ) {
            return "";
        }

        if (
            typeof value ===
                "number"
        ) {
            return value;
        }

        const timestamp =
            Date.parse(
                value
            );

        if (
            Number.isFinite(
                timestamp
            ) &&
            String(
                value
            ).includes(
                "-"
            )
        ) {
            return timestamp;
        }

        return String(
            value
        ).toLowerCase();
    }

    function titleCase(
        value
    ) {
        return String(
            value ||
            ""
        )
            .replace(
                /[-_]+/g,
                " "
            )
            .replace(
                /\b\w/g,
                function (
                    character
                ) {
                    return character
                        .toUpperCase();
                }
            );
    }

    function debounce(
        handler,
        delay
    ) {
        let timer =
            null;

        return function () {
            const args =
                arguments;

            global.clearTimeout(
                timer
            );

            timer =
                global.setTimeout(
                    function () {
                        handler.apply(
                            null,
                            args
                        );
                    },
                    delay
                );
        };
    }

    function normalizeInventoryError(
        error,
        fallbackCode,
        fallbackMessage
    ) {
        if (
            error instanceof
            InventoryControllerError
        ) {
            return error;
        }

        return new InventoryControllerError(
            error &&
            error.code
                ? String(
                      error.code
                  )
                : fallbackCode,
            error &&
            error.message
                ? String(
                      error.message
                  )
                : fallbackMessage,
            {
                originalError:
                    error,

                details:
                    error &&
                    error.details
                        ? cloneValue(
                              error.details
                          )
                        : null
            }
        );
    }

    function reportError(
        error
    ) {
        if (
            global.console &&
            typeof global.console
                .error ===
                "function"
        ) {
            global.console.error(
                "Inventory controller error.",
                error
            );
        }
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

    function getInventoryController(
        options
    ) {
        if (
            options
        ) {
            return createInventoryController(
                options
            );
        }

        if (
            !defaultController
        ) {
            defaultController =
                createInventoryController();
        }

        return defaultController;
    }

    function resetInventoryController() {
        if (
            defaultController
        ) {
            defaultController.destroy();
        }

        defaultController =
            null;
    }

    /* ======================================================
       EXPORT
    ====================================================== */

    const api =
        Object.freeze({
            createInventoryController,
            getInventoryController,
            resetInventoryController,

            InventoryControllerError,

            normalizeInventoryRecord,
            normalizeAdjustment,
            createAdjustmentPayload,

            calculateInventoryMetrics,
            calculateStockStatus,
            calculateAdjustedQuantity,
            matchesInventorySearch,
            createInventoryComparator,
            collectCategories,

            normalizeControllerOptions,
            normalizeRequiredId,
            normalizeRequiredString,
            normalizeOptionalString,
            normalizeSearchTerm,
            normalizePositiveInteger,
            normalizeNonNegativeInteger,
            normalizeInteger,
            normalizeCollectionName,
            normalizeLocale,
            normalizeAvailability,
            normalizeTracking,
            normalizeAdjustmentType,

            normalizeDateValue,
            formatDate,
            formatSignedInteger,

            createCsv,
            escapeCsvValue,
            formatFileDate,

            normalizeSortValue,
            titleCase,
            debounce,
            normalizeInventoryError,
            cloneValue,

            constants:
                Object.freeze({
                    DEFAULT_SELECTORS,
                    DEFAULT_PRODUCTS_COLLECTION,
                    DEFAULT_ADJUSTMENTS_COLLECTION,
                    DEFAULT_PAGE_SIZE,
                    DEFAULT_QUERY_LIMIT,
                    DEFAULT_ADJUSTMENT_LIMIT,
                    DEFAULT_LOW_STOCK_THRESHOLD,
                    DEFAULT_LOCALE,
                    INVENTORY_STATUSES,
                    AVAILABILITY_STATUSES,
                    TRACKING_STATUSES,
                    ADJUSTMENT_TYPES
                })
        });

    global.LEternelInventoryController =
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