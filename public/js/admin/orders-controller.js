"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ADMIN ORDERS CONTROLLER

   Responsibilities:
   - Load and render Firestore orders
   - Search, filter, sort, and paginate records
   - Render order details, items, notes, and timeline
   - Update fulfilment and shipment information
   - Cancel orders and issue refunds through callable functions
   - Export visible orders as CSV
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
                "[data-admin-orders]",

            refreshButton:
                "[data-orders-refresh]",

            searchInput:
                "[data-orders-search]",

            statusFilter:
                "[data-orders-status-filter]",

            paymentFilter:
                "[data-orders-payment-filter]",

            fulfilmentFilter:
                "[data-orders-fulfilment-filter]",

            sortSelect:
                "[data-orders-sort]",

            dateFrom:
                "[data-orders-date-from]",

            dateTo:
                "[data-orders-date-to]",

            clearFiltersButton:
                "[data-orders-clear-filters]",

            exportButton:
                "[data-orders-export]",

            table:
                "[data-orders-table]",

            selectAll:
                "[data-orders-select-all]",

            visibleCount:
                "[data-orders-visible-count]",

            previousButton:
                "[data-orders-previous]",

            nextButton:
                "[data-orders-next]",

            pageLabel:
                "[data-orders-page-label]",

            bulkActions:
                "[data-orders-bulk-actions]",

            selectedCount:
                "[data-orders-selected-count]",

            bulkProcessingButton:
                "[data-orders-bulk-processing]",

            bulkFulfilledButton:
                "[data-orders-bulk-fulfilled]",

            bulkClearButton:
                "[data-orders-bulk-clear]",

            totalMetric:
                "[data-orders-total]",

            awaitingMetric:
                "[data-orders-awaiting]",

            shippedMetric:
                "[data-orders-shipped]",

            revenueMetric:
                "[data-orders-revenue]",

            statusMessage:
                "[data-orders-status]",

            loadingOverlay:
                "[data-orders-loading]",

            loadingMessage:
                "[data-orders-loading-message]",

            drawer:
                "[data-order-drawer]",

            drawerClose:
                "[data-order-drawer-close]",

            orderNumber:
                "[data-order-number]",

            orderStatusLabel:
                "[data-order-status-label]",

            paymentLabel:
                "[data-order-payment-label]",

            fulfilmentLabel:
                "[data-order-fulfilment-label]",

            orderTotal:
                "[data-order-total]",

            createdAt:
                "[data-order-created-at]",

            updatedAt:
                "[data-order-updated-at]",

            customerName:
                "[data-order-customer-name]",

            customerEmail:
                "[data-order-customer-email]",

            customerPhone:
                "[data-order-customer-phone]",

            customerId:
                "[data-order-customer-id]",

            ipAddress:
                "[data-order-ip-address]",

            items:
                "[data-order-items]",

            subtotal:
                "[data-order-subtotal]",

            discount:
                "[data-order-discount]",

            shippingTotal:
                "[data-order-shipping-total]",

            tax:
                "[data-order-tax]",

            totalBreakdown:
                "[data-order-total-breakdown]",

            refundedTotal:
                "[data-order-refunded-total]",

            shippingAddress:
                "[data-order-shipping-address]",

            billingAddress:
                "[data-order-billing-address]",

            orderStatus:
                "[data-order-status]",

            fulfilmentStatus:
                "[data-order-fulfilment-status]",

            carrier:
                "[data-order-carrier]",

            trackingNumber:
                "[data-order-tracking-number]",

            trackingUrl:
                "[data-order-tracking-url]",

            updateStatusButton:
                "[data-order-update-status]",

            markShippedButton:
                "[data-order-mark-shipped]",

            markDeliveredButton:
                "[data-order-mark-delivered]",

            paymentProvider:
                "[data-order-payment-provider]",

            transactionId:
                "[data-order-transaction-id]",

            paidAt:
                "[data-order-paid-at]",

            paymentStatus:
                "[data-order-payment-status]",

            refundAmount:
                "[data-order-refund-amount]",

            refundReason:
                "[data-order-refund-reason]",

            refundNote:
                "[data-order-refund-note]",

            refundButton:
                "[data-order-refund]",

            noteInput:
                "[data-order-note-input]",

            addNoteButton:
                "[data-order-note-add]",

            notes:
                "[data-order-notes]",

            timeline:
                "[data-order-timeline]",

            resendConfirmationButton:
                "[data-order-resend-confirmation]",

            cancelOrderButton:
                "[data-order-cancel]",

            confirmModal:
                "[data-order-confirm-modal]",

            confirmTitle:
                "[data-order-confirm-title]",

            confirmMessage:
                "[data-order-confirm-message]",

            confirmCancel:
                "[data-order-confirm-cancel]",

            confirmSubmit:
                "[data-order-confirm-submit]"
        });

    const DEFAULT_COLLECTION =
        "orders";

    const DEFAULT_PAGE_SIZE =
        20;

    const DEFAULT_CURRENCY =
        "GBP";

    const DEFAULT_LOCALE =
        "en-GB";

    const ORDER_STATUSES =
        Object.freeze([
            "pending",
            "confirmed",
            "processing",
            "fulfilled",
            "shipped",
            "delivered",
            "cancelled",
            "refunded"
        ]);

    const PAYMENT_STATUSES =
        Object.freeze([
            "pending",
            "authorized",
            "paid",
            "failed",
            "partially-refunded",
            "refunded"
        ]);

    const FULFILMENT_STATUSES =
        Object.freeze([
            "unfulfilled",
            "processing",
            "fulfilled",
            "shipped",
            "delivered"
        ]);

    /* ======================================================
       ERROR
    ====================================================== */

    class OrdersControllerError extends Error {
        constructor(
            code,
            message,
            options
        ) {
            super(
                message ||
                "Order operation failed."
            );

            this.name =
                "OrdersControllerError";

            this.code =
                code ||
                "orders/unknown";

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

    function createOrdersController(
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
            throw new OrdersControllerError(
                "orders/document-unavailable",
                "Orders controller requires a document."
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
            throw new OrdersControllerError(
                "orders/root-unavailable",
                "Orders admin root element was not found."
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

        const functionsService =
            settings.functionsService ||
            resolveFunctionsService();

        if (
            !firestore ||
            typeof firestore.collection !==
                "function"
        ) {
            throw new OrdersControllerError(
                "orders/firestore-unavailable",
                "Firestore is unavailable."
            );
        }

        const disposers =
            [];

        const selectedOrderIds =
            new Set();

        let initialized =
            false;

        let destroyed =
            false;

        let loading =
            false;

        let allOrders =
            [];

        let filteredOrders =
            [];

        let currentPage =
            1;

        let activeOrder =
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

            await loadOrders();

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

            selectedOrderIds.clear();

            closeDrawer();
            closeConfirmation();

            allOrders =
                [];

            filteredOrders =
                [];

            initialized =
                false;
        }

        function assertActive() {
            if (
                destroyed
            ) {
                throw new OrdersControllerError(
                    "orders/destroyed",
                    "Orders controller has been destroyed."
                );
            }
        }

        /* ==================================================
           LOAD
        ================================================== */

        async function loadOrders() {
            assertActive();

            setLoading(
                true,
                "Loading orders…"
            );

            setStatus(
                "Loading orders…",
                "loading"
            );

            try {
                let query =
                    firestore
                        .collection(
                            settings.collection
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
                            settings.queryLimit
                        );
                }

                const snapshot =
                    await query.get();

                allOrders =
                    mapSnapshotDocuments(
                        snapshot
                    )
                        .map(
                            normalizeOrder
                        );

                selectedOrderIds.clear();

                currentPage =
                    1;

                applyFilters();
                renderMetrics();
                renderBulkState();

                setStatus(
                    allOrders.length +
                    " order" +
                    (
                        allOrders.length ===
                            1
                            ? ""
                            : "s"
                    ) +
                    " loaded.",
                    "success"
                );

                return cloneValue(
                    allOrders
                );
            } catch (
                error
            ) {
                const normalized =
                    normalizeOrdersError(
                        error,
                        "orders/load-failed",
                        "Unable to load orders."
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

            const paymentStatus =
                getInputValue(
                    elements.paymentFilter
                ).toLowerCase();

            const fulfilmentStatus =
                getInputValue(
                    elements.fulfilmentFilter
                ).toLowerCase();

            const dateFrom =
                normalizeFilterDate(
                    getInputValue(
                        elements.dateFrom
                    ),
                    false
                );

            const dateTo =
                normalizeFilterDate(
                    getInputValue(
                        elements.dateTo
                    ),
                    true
                );

            const sort =
                getInputValue(
                    elements.sortSelect
                ) ||
                "createdAt-desc";

            filteredOrders =
                allOrders.filter(
                    function (
                        order
                    ) {
                        if (
                            status &&
                            order.status !==
                                status
                        ) {
                            return false;
                        }

                        if (
                            paymentStatus &&
                            order.paymentStatus !==
                                paymentStatus
                        ) {
                            return false;
                        }

                        if (
                            fulfilmentStatus &&
                            order.fulfilmentStatus !==
                                fulfilmentStatus
                        ) {
                            return false;
                        }

                        if (
                            search &&
                            !matchesOrderSearch(
                                order,
                                search
                            )
                        ) {
                            return false;
                        }

                        const createdAt =
                            order.createdAt
                                ? Date.parse(
                                      order.createdAt
                                  )
                                : null;

                        if (
                            dateFrom &&
                            (
                                createdAt ===
                                    null ||
                                createdAt <
                                    dateFrom.getTime()
                            )
                        ) {
                            return false;
                        }

                        if (
                            dateTo &&
                            (
                                createdAt ===
                                    null ||
                                createdAt >
                                    dateTo.getTime()
                            )
                        ) {
                            return false;
                        }

                        return true;
                    }
                );

            filteredOrders.sort(
                createOrderComparator(
                    sort
                )
            );

            const pageCount =
                getPageCount();

            currentPage =
                Math.min(
                    Math.max(
                        currentPage,
                        1
                    ),
                    pageCount
                );

            renderOrders();
            renderPagination();
            renderMetrics();

            setText(
                elements.visibleCount,
                filteredOrders.length
            );

            return cloneValue(
                filteredOrders
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
                elements.paymentFilter,
                ""
            );

            setInputValue(
                elements.fulfilmentFilter,
                ""
            );

            setInputValue(
                elements.dateFrom,
                ""
            );

            setInputValue(
                elements.dateTo,
                ""
            );

            setInputValue(
                elements.sortSelect,
                "createdAt-desc"
            );

            currentPage =
                1;

            applyFilters();
        }

        /* ==================================================
           METRICS
        ================================================== */

        function renderMetrics() {
            const metrics =
                calculateOrderMetrics(
                    filteredOrders
                );

            setText(
                elements.totalMetric,
                metrics.total
            );

            setText(
                elements.awaitingMetric,
                metrics.awaitingFulfilment
            );

            setText(
                elements.shippedMetric,
                metrics.shipped
            );

            setText(
                elements.revenueMetric,
                formatCurrency(
                    metrics.revenueMinor,
                    settings.currency,
                    settings.locale
                )
            );

            return metrics;
        }

        /* ==================================================
           TABLE
        ================================================== */

        function renderOrders() {
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

            const rows =
                getCurrentPageOrders();

            if (
                !rows.length
            ) {
                renderEmptyTable(
                    "No matching orders found."
                );

                return;
            }

            for (
                const order of
                rows
            ) {
                tbody.appendChild(
                    createOrderRow(
                        order
                    )
                );
            }

            updateSelectAllState();
        }

        function createOrderRow(
            order
        ) {
            const row =
                documentObject
                    .createElement(
                        "tr"
                    );

            const selectionCell =
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
                selectedOrderIds.has(
                    order.id
                );

            checkbox.setAttribute(
                "aria-label",
                "Select order " +
                order.displayId
            );

            checkbox.addEventListener(
                "change",
                function () {
                    setOrderSelected(
                        order.id,
                        checkbox.checked
                    );
                }
            );

            selectionCell.appendChild(
                checkbox
            );

            row.appendChild(
                selectionCell
            );

            const orderCell =
                documentObject
                    .createElement(
                        "td"
                    );

            const orderCopy =
                documentObject
                    .createElement(
                        "div"
                    );

            orderCopy.className =
                "admin-order-cell";

            const orderNumber =
                documentObject
                    .createElement(
                        "strong"
                    );

            orderNumber.textContent =
                order.displayId;

            const itemCount =
                documentObject
                    .createElement(
                        "small"
                    );

            itemCount.textContent =
                order.itemCount +
                " item" +
                (
                    order.itemCount ===
                        1
                        ? ""
                        : "s"
                );

            orderCopy.appendChild(
                orderNumber
            );

            orderCopy.appendChild(
                itemCount
            );

            orderCell.appendChild(
                orderCopy
            );

            row.appendChild(
                orderCell
            );

            appendTextCell(
                row,
                order.customerName ||
                order.customerEmail ||
                "Guest"
            );

            appendStatusCell(
                row,
                order.status
            );

            appendStatusCell(
                row,
                order.paymentStatus
            );

            appendStatusCell(
                row,
                order.fulfilmentStatus
            );

            appendTextCell(
                row,
                formatCurrency(
                    order.totalMinor,
                    order.currency,
                    settings.locale
                )
            );

            appendTextCell(
                row,
                formatDate(
                    order.createdAt,
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
                    "View",
                    function () {
                        openDrawer(
                            order
                        );
                    }
                )
            );

            if (
                order.status !==
                    "cancelled" &&
                order.status !==
                    "refunded"
            ) {
                actions.appendChild(
                    createActionButton(
                        documentObject,
                        "Processing",
                        function () {
                            return updateOrder(
                                order.id,
                                {
                                    status:
                                        "processing",

                                    fulfilmentStatus:
                                        "processing"
                                },
                                "Order marked as processing."
                            );
                        }
                    )
                );
            }

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
                9;

            cell.className =
                "admin-operation-empty";

            cell.textContent =
                message ||
                "No orders found.";

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
                    filteredOrders.length /
                    settings.pageSize
                )
            );
        }

        function getCurrentPageOrders() {
            const start =
                (
                    currentPage -
                    1
                ) *
                settings.pageSize;

            return filteredOrders.slice(
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

                renderOrders();
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

                renderOrders();
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

        function setOrderSelected(
            orderId,
            selected
        ) {
            if (
                selected
            ) {
                selectedOrderIds.add(
                    orderId
                );
            } else {
                selectedOrderIds.delete(
                    orderId
                );
            }

            renderBulkState();
            updateSelectAllState();
        }

        function selectAllVisible(
            selected
        ) {
            for (
                const order of
                getCurrentPageOrders()
            ) {
                if (
                    selected
                ) {
                    selectedOrderIds.add(
                        order.id
                    );
                } else {
                    selectedOrderIds.delete(
                        order.id
                    );
                }
            }

            renderOrders();
            renderBulkState();
        }

        function clearSelection() {
            selectedOrderIds.clear();

            renderOrders();
            renderBulkState();
        }

        function renderBulkState() {
            const count =
                selectedOrderIds.size;

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
                getCurrentPageOrders();

            const selectedCount =
                visible.filter(
                    function (
                        order
                    ) {
                        return selectedOrderIds.has(
                            order.id
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
                    selectedOrderIds
                );

            if (
                !ids.length
            ) {
                return false;
            }

            setLoading(
                true,
                "Updating selected orders…"
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
                                settings.collection
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
                    message,
                    "success"
                );

                await loadOrders();

                return true;
            } catch (
                error
            ) {
                const normalized =
                    normalizeOrdersError(
                        error,
                        "orders/bulk-update-failed",
                        "Unable to update selected orders."
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
           DRAWER
        ================================================== */

        function openDrawer(
            order
        ) {
            activeOrder =
                cloneValue(
                    order
                );

            renderOrderDetails(
                activeOrder
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
        }

        function closeDrawer() {
            activeOrder =
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

        function renderOrderDetails(
            order
        ) {
            setText(
                elements.orderNumber,
                order.displayId
            );

            setStatusText(
                elements.orderStatusLabel,
                order.status
            );

            setStatusText(
                elements.paymentLabel,
                order.paymentStatus
            );

            setStatusText(
                elements.fulfilmentLabel,
                order.fulfilmentStatus
            );

            setText(
                elements.orderTotal,
                formatCurrency(
                    order.totalMinor,
                    order.currency,
                    settings.locale
                )
            );

            setText(
                elements.createdAt,
                formatDate(
                    order.createdAt,
                    settings.locale
                )
            );

            setText(
                elements.updatedAt,
                formatDate(
                    order.updatedAt,
                    settings.locale
                )
            );

            setText(
                elements.customerName,
                order.customerName ||
                "Guest"
            );

            setLink(
                elements.customerEmail,
                order.customerEmail
                    ? "mailto:" +
                      order.customerEmail
                    : null,
                order.customerEmail ||
                "—"
            );

            setLink(
                elements.customerPhone,
                order.customerPhone
                    ? "tel:" +
                      order.customerPhone
                    : null,
                order.customerPhone ||
                "—"
            );

            setText(
                elements.customerId,
                order.customerId ||
                "—"
            );

            setText(
                elements.ipAddress,
                order.ipAddress ||
                "—"
            );

            renderItems(
                order.items,
                order.currency
            );

            setText(
                elements.subtotal,
                formatCurrency(
                    order.subtotalMinor,
                    order.currency,
                    settings.locale
                )
            );

            setText(
                elements.discount,
                formatCurrency(
                    order.discountMinor,
                    order.currency,
                    settings.locale
                )
            );

            setText(
                elements.shippingTotal,
                formatCurrency(
                    order.shippingMinor,
                    order.currency,
                    settings.locale
                )
            );

            setText(
                elements.tax,
                formatCurrency(
                    order.taxMinor,
                    order.currency,
                    settings.locale
                )
            );

            setText(
                elements.totalBreakdown,
                formatCurrency(
                    order.totalMinor,
                    order.currency,
                    settings.locale
                )
            );

            setText(
                elements.refundedTotal,
                formatCurrency(
                    order.refundedMinor,
                    order.currency,
                    settings.locale
                )
            );

            setText(
                elements.shippingAddress,
                formatAddress(
                    order.shippingAddress
                )
            );

            setText(
                elements.billingAddress,
                formatAddress(
                    order.billingAddress
                )
            );

            setInputValue(
                elements.orderStatus,
                order.status
            );

            setInputValue(
                elements.fulfilmentStatus,
                order.fulfilmentStatus
            );

            setInputValue(
                elements.carrier,
                order.shipping.carrier
            );

            setInputValue(
                elements.trackingNumber,
                order.shipping.trackingNumber
            );

            setInputValue(
                elements.trackingUrl,
                order.shipping.trackingUrl
            );

            setText(
                elements.paymentProvider,
                order.payment.provider ||
                "—"
            );

            setText(
                elements.transactionId,
                order.payment.transactionId ||
                "—"
            );

            setText(
                elements.paidAt,
                formatDate(
                    order.payment.paidAt,
                    settings.locale
                )
            );

            setText(
                elements.paymentStatus,
                titleCase(
                    order.paymentStatus
                )
            );

            setInputValue(
                elements.refundAmount,
                ""
            );

            setInputValue(
                elements.refundNote,
                ""
            );

            renderNotes(
                order.notes
            );

            renderTimeline(
                order.timeline
            );
        }

        function renderItems(
            items,
            currency
        ) {
            if (
                !elements.items
            ) {
                return;
            }

            elements.items.textContent =
                "";

            if (
                !items.length
            ) {
                const empty =
                    documentObject
                        .createElement(
                            "div"
                        );

                empty.className =
                    "admin-dashboard-empty";

                empty.textContent =
                    "No items found.";

                elements.items.appendChild(
                    empty
                );

                return;
            }

            for (
                const item of
                items
            ) {
                const row =
                    documentObject
                        .createElement(
                            "article"
                        );

                row.className =
                    "admin-order-item";

                if (
                    item.imageUrl
                ) {
                    const image =
                        documentObject
                            .createElement(
                                "img"
                            );

                    image.src =
                        item.imageUrl;

                    image.alt =
                        item.name;

                    row.appendChild(
                        image
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
                    item.name;

                const variant =
                    documentObject
                        .createElement(
                            "small"
                        );

                variant.textContent =
                    [
                        item.sku,
                        item.variant
                    ]
                        .filter(
                            Boolean
                        )
                        .join(
                            " · "
                        ) ||
                    "Standard";

                copy.appendChild(
                    name
                );

                copy.appendChild(
                    variant
                );

                const total =
                    documentObject
                        .createElement(
                            "span"
                        );

                total.textContent =
                    item.quantity +
                    " × " +
                    formatCurrency(
                        item.unitPriceMinor,
                        currency,
                        settings.locale
                    );

                row.appendChild(
                    copy
                );

                row.appendChild(
                    total
                );

                elements.items.appendChild(
                    row
                );
            }
        }

        function renderNotes(
            notes
        ) {
            if (
                !elements.notes
            ) {
                return;
            }

            elements.notes.textContent =
                "";

            if (
                !notes.length
            ) {
                const empty =
                    documentObject
                        .createElement(
                            "div"
                        );

                empty.className =
                    "admin-dashboard-empty";

                empty.textContent =
                    "No notes.";

                elements.notes.appendChild(
                    empty
                );

                return;
            }

            for (
                const note of
                notes.slice()
                    .reverse()
            ) {
                const item =
                    documentObject
                        .createElement(
                            "article"
                        );

                item.className =
                    "admin-order-note";

                const copy =
                    documentObject
                        .createElement(
                            "p"
                        );

                copy.textContent =
                    note.message;

                const meta =
                    documentObject
                        .createElement(
                            "small"
                        );

                meta.textContent =
                    [
                        note.authorName ||
                        note.authorId,
                        formatDate(
                            note.createdAt,
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
                    copy
                );

                item.appendChild(
                    meta
                );

                elements.notes.appendChild(
                    item
                );
            }
        }

        function renderTimeline(
            timeline
        ) {
            if (
                !elements.timeline
            ) {
                return;
            }

            elements.timeline.textContent =
                "";

            if (
                !timeline.length
            ) {
                const item =
                    documentObject
                        .createElement(
                            "li"
                        );

                item.textContent =
                    "No timeline events.";

                elements.timeline.appendChild(
                    item
                );

                return;
            }

            const sorted =
                timeline.slice()
                    .sort(
                        function (
                            first,
                            second
                        ) {
                            return (
                                Date.parse(
                                    second.createdAt
                                ) -
                                Date.parse(
                                    first.createdAt
                                )
                            );
                        }
                    );

            for (
                const event of
                sorted
            ) {
                const item =
                    documentObject
                        .createElement(
                            "li"
                        );

                const title =
                    documentObject
                        .createElement(
                            "strong"
                        );

                title.textContent =
                    event.label ||
                    titleCase(
                        event.type
                    );

                const date =
                    documentObject
                        .createElement(
                            "time"
                        );

                date.textContent =
                    formatDate(
                        event.createdAt,
                        settings.locale
                    );

                item.appendChild(
                    title
                );

                if (
                    event.message
                ) {
                    const message =
                        documentObject
                            .createElement(
                                "p"
                            );

                    message.textContent =
                        event.message;

                    item.appendChild(
                        message
                    );
                }

                item.appendChild(
                    date
                );

                elements.timeline.appendChild(
                    item
                );
            }
        }

        /* ==================================================
           ORDER UPDATES
        ================================================== */

        async function saveFulfilment() {
            if (
                !activeOrder
            ) {
                return false;
            }

            const status =
                normalizeOrderStatus(
                    getInputValue(
                        elements.orderStatus
                    )
                );

            const fulfilmentStatus =
                normalizeFulfilmentStatus(
                    getInputValue(
                        elements.fulfilmentStatus
                    )
                );

            return updateOrder(
                activeOrder.id,
                {
                    status,
                    fulfilmentStatus,

                    shipping: {
                        carrier:
                            normalizeOptionalString(
                                getInputValue(
                                    elements.carrier
                                )
                            ),

                        trackingNumber:
                            normalizeOptionalString(
                                getInputValue(
                                    elements.trackingNumber
                                )
                            ),

                        trackingUrl:
                            normalizeOptionalString(
                                getInputValue(
                                    elements.trackingUrl
                                )
                            )
                    }
                },
                "Fulfilment details updated."
            );
        }

        async function markShipped() {
            if (
                !activeOrder
            ) {
                return false;
            }

            return updateOrder(
                activeOrder.id,
                {
                    status:
                        "shipped",

                    fulfilmentStatus:
                        "shipped",

                    shippedAt:
                        createServerTimestamp(),

                    shipping: {
                        carrier:
                            normalizeOptionalString(
                                getInputValue(
                                    elements.carrier
                                )
                            ),

                        trackingNumber:
                            normalizeOptionalString(
                                getInputValue(
                                    elements.trackingNumber
                                )
                            ),

                        trackingUrl:
                            normalizeOptionalString(
                                getInputValue(
                                    elements.trackingUrl
                                )
                            )
                    }
                },
                "Order marked as shipped."
            );
        }

        async function markDelivered() {
            if (
                !activeOrder
            ) {
                return false;
            }

            return updateOrder(
                activeOrder.id,
                {
                    status:
                        "delivered",

                    fulfilmentStatus:
                        "delivered",

                    deliveredAt:
                        createServerTimestamp()
                },
                "Order marked as delivered."
            );
        }

        async function updateOrder(
            orderId,
            patch,
            message
        ) {
            const id =
                normalizeRequiredId(
                    orderId,
                    "Order ID"
                );

            setLoading(
                true,
                "Updating order…"
            );

            try {
                const normalizedPatch =
                    Object.assign(
                        {},
                        cloneValue(
                            patch
                        ),
                        {
                            updatedAt:
                                createServerTimestamp(),

                            updatedBy:
                                getCurrentUserId(
                                    auth
                                )
                        }
                    );

                await firestore
                    .collection(
                        settings.collection
                    )
                    .doc(
                        id
                    )
                    .set(
                        normalizedPatch,
                        {
                            merge:
                                true
                        }
                    );

                setStatus(
                    message ||
                    "Order updated.",
                    "success"
                );

                await loadOrders();

                const updated =
                    allOrders.find(
                        function (
                            order
                        ) {
                            return order.id ===
                                id;
                        }
                    );

                if (
                    updated &&
                    activeOrder &&
                    activeOrder.id ===
                        id
                ) {
                    activeOrder =
                        cloneValue(
                            updated
                        );

                    renderOrderDetails(
                        activeOrder
                    );
                }

                return true;
            } catch (
                error
            ) {
                const normalized =
                    normalizeOrdersError(
                        error,
                        "orders/update-failed",
                        "Unable to update order."
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
           NOTES
        ================================================== */

        async function addNote() {
            if (
                !activeOrder
            ) {
                return false;
            }

            const message =
                normalizeRequiredString(
                    getInputValue(
                        elements.noteInput
                    ),
                    "Note"
                );

            const note = {
                id:
                    createRandomId(),

                message:
                    message,

                authorId:
                    getCurrentUserId(
                        auth
                    ),

                authorName:
                    getCurrentUserName(
                        auth
                    ),

                createdAt:
                    new Date()
                        .toISOString()
            };

            const notes =
                activeOrder.notes
                    .concat([
                        note
                    ]);

            await updateOrder(
                activeOrder.id,
                {
                    notes:
                        notes
                },
                "Order note added."
            );

            setInputValue(
                elements.noteInput,
                ""
            );

            return true;
        }

        /* ==================================================
           REFUND / CANCEL / NOTIFICATION
        ================================================== */

        async function issueRefund() {
            if (
                !activeOrder
            ) {
                return false;
            }

            const amountMajor =
                normalizeMoneyInput(
                    getInputValue(
                        elements.refundAmount
                    ),
                    "Refund amount"
                );

            const amountMinor =
                majorToMinor(
                    amountMajor
                );

            const remaining =
                Math.max(
                    0,
                    activeOrder.totalMinor -
                    activeOrder.refundedMinor
                );

            if (
                amountMinor <=
                    0 ||
                amountMinor >
                    remaining
            ) {
                throw new OrdersControllerError(
                    "orders/invalid-refund",
                    "Refund amount exceeds the refundable balance."
                );
            }

            const reason =
                getInputValue(
                    elements.refundReason
                ) ||
                "other";

            const note =
                normalizeOptionalString(
                    getInputValue(
                        elements.refundNote
                    )
                );

            return openConfirmation({
                title:
                    "Issue Refund?",

                message:
                    "Refund " +
                    formatCurrency(
                        amountMinor,
                        activeOrder.currency,
                        settings.locale
                    ) +
                    " for " +
                    activeOrder.displayId +
                    ".",

                action:
                    async function () {
                        if (
                            functionsService &&
                            typeof functionsService.call ===
                                "function"
                        ) {
                            await functionsService.call(
                                settings.refundFunctionName,
                                {
                                    orderId:
                                        activeOrder.id,

                                    amountMinor:
                                        amountMinor,

                                    reason:
                                        reason,

                                    note:
                                        note
                                },
                                {
                                    timeoutMs:
                                        120000
                                }
                            );
                        } else {
                            await updateOrder(
                                activeOrder.id,
                                {
                                    refundedMinor:
                                        activeOrder.refundedMinor +
                                        amountMinor,

                                    paymentStatus:
                                        amountMinor ===
                                        remaining
                                            ? "refunded"
                                            : "partially-refunded",

                                    status:
                                        amountMinor ===
                                        remaining
                                            ? "refunded"
                                            : activeOrder.status
                                },
                                "Refund recorded."
                            );
                        }

                        setStatus(
                            "Refund completed.",
                            "success"
                        );

                        await loadOrders();
                    }
            });
        }

        async function cancelOrder() {
            if (
                !activeOrder
            ) {
                return false;
            }

            return openConfirmation({
                title:
                    "Cancel Order?",

                message:
                    "Cancel " +
                    activeOrder.displayId +
                    ". This may affect fulfilment and inventory.",

                action:
                    async function () {
                        if (
                            functionsService &&
                            typeof functionsService.call ===
                                "function"
                        ) {
                            await functionsService.call(
                                settings.cancelFunctionName,
                                {
                                    orderId:
                                        activeOrder.id,

                                    reason:
                                        "Cancelled from admin console."
                                }
                            );
                        } else {
                            await updateOrder(
                                activeOrder.id,
                                {
                                    status:
                                        "cancelled",

                                    cancelledAt:
                                        createServerTimestamp(),

                                    cancellationReason:
                                        "Cancelled from admin console."
                                },
                                "Order cancelled."
                            );
                        }

                        closeDrawer();

                        await loadOrders();
                    }
            });
        }

        async function resendConfirmation() {
            if (
                !activeOrder
            ) {
                return false;
            }

            setLoading(
                true,
                "Sending confirmation…"
            );

            try {
                if (
                    !functionsService ||
                    typeof functionsService.call !==
                        "function"
                ) {
                    throw new OrdersControllerError(
                        "orders/functions-unavailable",
                        "Order notification function is unavailable."
                    );
                }

                await functionsService.call(
                    settings.resendFunctionName,
                    {
                        orderId:
                            activeOrder.id
                    }
                );

                setStatus(
                    "Order confirmation sent.",
                    "success"
                );

                return true;
            } finally {
                setLoading(
                    false
                );
            }
        }

        /* ==================================================
           CONFIRMATION MODAL
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

            setLoading(
                true,
                "Processing action…"
            );

            try {
                await action();

                closeConfirmation();

                return true;
            } catch (
                error
            ) {
                const normalized =
                    normalizeOrdersError(
                        error,
                        "orders/action-failed",
                        "Unable to complete order action."
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

                setLoading(
                    false
                );
            }
        }

        /* ==================================================
           CSV EXPORT
        ================================================== */

        function exportCsv() {
            const rows =
                filteredOrders.map(
                    function (
                        order
                    ) {
                        return {
                            order:
                                order.displayId,

                            customer:
                                order.customerName ||
                                "",

                            email:
                                order.customerEmail ||
                                "",

                            status:
                                order.status,

                            payment:
                                order.paymentStatus,

                            fulfilment:
                                order.fulfilmentStatus,

                            total:
                                (
                                    order.totalMinor /
                                    100
                                ).toFixed(
                                    2
                                ),

                            currency:
                                order.currency,

                            createdAt:
                                order.createdAt ||
                                "",

                            tracking:
                                order.shipping
                                    .trackingNumber ||
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
                "leternel-orders-" +
                formatFileDate(
                    new Date()
                ) +
                ".csv",
                "text/csv;charset=utf-8"
            );

            setStatus(
                rows.length +
                " order" +
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
                loadOrders
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
                elements.paymentFilter,
                resetPageAndApply
            );

            bindChange(
                elements.fulfilmentFilter,
                resetPageAndApply
            );

            bindChange(
                elements.sortSelect,
                resetPageAndApply
            );

            bindChange(
                elements.dateFrom,
                resetPageAndApply
            );

            bindChange(
                elements.dateTo,
                resetPageAndApply
            );

            bindClick(
                elements.clearFiltersButton,
                clearFilters
            );

            bindClick(
                elements.exportButton,
                exportCsv
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
                elements.bulkProcessingButton,
                function () {
                    return bulkUpdate(
                        {
                            status:
                                "processing",

                            fulfilmentStatus:
                                "processing"
                        },
                        "Selected orders marked as processing."
                    );
                }
            );

            bindClick(
                elements.bulkFulfilledButton,
                function () {
                    return bulkUpdate(
                        {
                            status:
                                "fulfilled",

                            fulfilmentStatus:
                                "fulfilled",

                            fulfilledAt:
                                createServerTimestamp()
                        },
                        "Selected orders marked as fulfilled."
                    );
                }
            );

            bindClick(
                elements.bulkClearButton,
                clearSelection
            );

            bindClick(
                elements.drawerClose,
                closeDrawer
            );

            bindClick(
                elements.updateStatusButton,
                saveFulfilment
            );

            bindClick(
                elements.markShippedButton,
                markShipped
            );

            bindClick(
                elements.markDeliveredButton,
                markDelivered
            );

            bindClick(
                elements.addNoteButton,
                addNote
            );

            bindClick(
                elements.refundButton,
                issueRefund
            );

            bindClick(
                elements.cancelOrderButton,
                cancelOrder
            );

            bindClick(
                elements.resendConfirmationButton,
                resendConfirmation
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

                totalOrders:
                    allOrders.length,

                visibleOrders:
                    filteredOrders.length,

                selectedOrders:
                    Array.from(
                        selectedOrderIds
                    ),

                activeOrder:
                    cloneValue(
                        activeOrder
                    )
            };
        }

        const controller =
            Object.freeze({
                init,
                destroy,

                loadOrders,
                applyFilters,
                clearFilters,

                renderOrders,
                renderMetrics,
                renderPagination,

                openDrawer,
                closeDrawer,
                renderOrderDetails,

                saveFulfilment,
                markShipped,
                markDelivered,
                updateOrder,

                addNote,
                issueRefund,
                cancelOrder,
                resendConfirmation,

                exportCsv,

                selectAllVisible,
                clearSelection,
                bulkUpdate,

                getSnapshot,

                get orders() {
                    return cloneValue(
                        allOrders
                    );
                },

                get filteredOrders() {
                    return cloneValue(
                        filteredOrders
                    );
                },

                elements,
                options:
                    settings
            });

        return controller;
    }

    /* ======================================================
       NORMALIZE ORDER
    ====================================================== */

    function normalizeOrder(
        input
    ) {
        const source =
            input ||
            {};

        const customer =
            source.customer &&
            typeof source.customer ===
                "object"
                ? source.customer
                : {};

        const payment =
            source.payment &&
            typeof source.payment ===
                "object"
                ? source.payment
                : {};

        const shipping =
            source.shipping &&
            typeof source.shipping ===
                "object"
                ? source.shipping
                : {};

        const items =
            normalizeOrderItems(
                source.items
            );

        return {
            id:
                normalizeRequiredId(
                    source.id,
                    "Order ID"
                ),

            displayId:
                String(
                    source.orderNumber ||
                    source.reference ||
                    source.displayId ||
                    source.id
                ),

            customerId:
                normalizeOptionalString(
                    source.customerId ||
                    customer.id
                ),

            customerName:
                normalizeOptionalString(
                    source.customerName ||
                    customer.name ||
                    customer.displayName
                ),

            customerEmail:
                normalizeOptionalString(
                    source.customerEmail ||
                    customer.email
                ),

            customerPhone:
                normalizeOptionalString(
                    source.customerPhone ||
                    customer.phone
                ),

            ipAddress:
                normalizeOptionalString(
                    source.ipAddress
                ),

            status:
                normalizeOrderStatus(
                    source.status ||
                    "pending"
                ),

            paymentStatus:
                normalizePaymentStatus(
                    source.paymentStatus ||
                    payment.status ||
                    "pending"
                ),

            fulfilmentStatus:
                normalizeFulfilmentStatus(
                    source.fulfilmentStatus ||
                    source.fulfillmentStatus ||
                    shipping.status ||
                    "unfulfilled"
                ),

            subtotalMinor:
                normalizeMinorAmount(
                    source.subtotalMinor
                ),

            discountMinor:
                normalizeMinorAmount(
                    source.discountMinor
                ),

            shippingMinor:
                normalizeMinorAmount(
                    source.shippingMinor ||
                    source.shippingTotalMinor
                ),

            taxMinor:
                normalizeMinorAmount(
                    source.taxMinor
                ),

            totalMinor:
                normalizeMinorAmount(
                    source.totalMinor !==
                        undefined
                        ? source.totalMinor
                        : source.total
                ),

            refundedMinor:
                normalizeMinorAmount(
                    source.refundedMinor ||
                    source.refundTotalMinor
                ),

            currency:
                normalizeCurrency(
                    source.currency ||
                    DEFAULT_CURRENCY
                ),

            items:
                items,

            itemCount:
                items.reduce(
                    function (
                        total,
                        item
                    ) {
                        return total +
                            item.quantity;
                    },
                    0
                ),

            payment: {
                provider:
                    normalizeOptionalString(
                        payment.provider ||
                        source.paymentProvider
                    ),

                transactionId:
                    normalizeOptionalString(
                        payment.transactionId ||
                        source.transactionId
                    ),

                paidAt:
                    normalizeDateValue(
                        payment.paidAt ||
                        source.paidAt
                    )
            },

            shipping: {
                carrier:
                    normalizeOptionalString(
                        shipping.carrier ||
                        source.carrier
                    ),

                trackingNumber:
                    normalizeOptionalString(
                        shipping.trackingNumber ||
                        source.trackingNumber
                    ),

                trackingUrl:
                    normalizeOptionalString(
                        shipping.trackingUrl ||
                        source.trackingUrl
                    )
            },

            shippingAddress:
                normalizeAddress(
                    source.shippingAddress
                ),

            billingAddress:
                normalizeAddress(
                    source.billingAddress ||
                    source.shippingAddress
                ),

            notes:
                normalizeNotes(
                    source.notes
                ),

            timeline:
                normalizeTimeline(
                    source.timeline ||
                    source.events
                ),

            createdAt:
                normalizeDateValue(
                    source.createdAt
                ),

            updatedAt:
                normalizeDateValue(
                    source.updatedAt ||
                    source.createdAt
                )
        };
    }

    function normalizeOrderItems(
        items
    ) {
        if (
            !Array.isArray(
                items
            )
        ) {
            return [];
        }

        return items.map(
            function (
                item
            ) {
                const source =
                    item ||
                    {};

                return {
                    id:
                        normalizeOptionalString(
                            source.id ||
                            source.productId
                        ),

                    name:
                        String(
                            source.name ||
                            source.title ||
                            "Product"
                        ),

                    sku:
                        normalizeOptionalString(
                            source.sku
                        ),

                    variant:
                        normalizeOptionalString(
                            source.variant ||
                            source.variantName
                        ),

                    imageUrl:
                        normalizeOptionalString(
                            source.imageUrl ||
                            source.image
                        ),

                    quantity:
                        normalizePositiveInteger(
                            source.quantity,
                            1,
                            "Item quantity"
                        ),

                    unitPriceMinor:
                        normalizeMinorAmount(
                            source.unitPriceMinor !==
                                undefined
                                ? source.unitPriceMinor
                                : source.priceMinor
                        )
                };
            }
        );
    }

    function normalizeAddress(
        input
    ) {
        const source =
            input &&
            typeof input ===
                "object"
                ? input
                : {};

        return {
            name:
                normalizeOptionalString(
                    source.name
                ),

            company:
                normalizeOptionalString(
                    source.company
                ),

            line1:
                normalizeOptionalString(
                    source.line1 ||
                    source.address1
                ),

            line2:
                normalizeOptionalString(
                    source.line2 ||
                    source.address2
                ),

            city:
                normalizeOptionalString(
                    source.city
                ),

            region:
                normalizeOptionalString(
                    source.region ||
                    source.state
                ),

            postalCode:
                normalizeOptionalString(
                    source.postalCode ||
                    source.postcode ||
                    source.zip
                ),

            country:
                normalizeOptionalString(
                    source.country
                )
        };
    }

    function normalizeNotes(
        notes
    ) {
        if (
            !Array.isArray(
                notes
            )
        ) {
            return [];
        }

        return notes.map(
            function (
                note,
                index
            ) {
                const source =
                    note ||
                    {};

                return {
                    id:
                        String(
                            source.id ||
                            index
                        ),

                    message:
                        String(
                            source.message ||
                            source.note ||
                            ""
                        ),

                    authorId:
                        normalizeOptionalString(
                            source.authorId
                        ),

                    authorName:
                        normalizeOptionalString(
                            source.authorName
                        ),

                    createdAt:
                        normalizeDateValue(
                            source.createdAt
                        )
                };
            }
        );
    }

    function normalizeTimeline(
        events
    ) {
        if (
            !Array.isArray(
                events
            )
        ) {
            return [];
        }

        return events.map(
            function (
                event,
                index
            ) {
                const source =
                    event ||
                    {};

                return {
                    id:
                        String(
                            source.id ||
                            index
                        ),

                    type:
                        String(
                            source.type ||
                            "event"
                        ),

                    label:
                        normalizeOptionalString(
                            source.label
                        ),

                    message:
                        normalizeOptionalString(
                            source.message
                        ),

                    createdAt:
                        normalizeDateValue(
                            source.createdAt
                        )
                };
            }
        );
    }

    /* ======================================================
       METRICS / SEARCH / SORT
    ====================================================== */

    function calculateOrderMetrics(
        orders
    ) {
        const rows =
            Array.isArray(
                orders
            )
                ? orders
                : [];

        return {
            total:
                rows.length,

            awaitingFulfilment:
                rows.filter(
                    function (
                        order
                    ) {
                        return (
                            [
                                "paid",
                                "authorized"
                            ].includes(
                                order.paymentStatus
                            ) &&
                            [
                                "unfulfilled",
                                "processing"
                            ].includes(
                                order.fulfilmentStatus
                            )
                        );
                    }
                ).length,

            shipped:
                rows.filter(
                    function (
                        order
                    ) {
                        return order.fulfilmentStatus ===
                            "shipped";
                    }
                ).length,

            revenueMinor:
                rows.reduce(
                    function (
                        total,
                        order
                    ) {
                        if (
                            order.status ===
                                "cancelled"
                        ) {
                            return total;
                        }

                        return total +
                            Math.max(
                                0,
                                order.totalMinor -
                                order.refundedMinor
                            );
                    },
                    0
                )
        };
    }

    function matchesOrderSearch(
        order,
        search
    ) {
        const haystack =
            [
                order.id,
                order.displayId,
                order.customerId,
                order.customerName,
                order.customerEmail,
                order.customerPhone,
                order.shipping
                    .trackingNumber,
                order.shipping
                    .carrier
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

    function createOrderComparator(
        value
    ) {
        const [
            field,
            direction
        ] =
            String(
                value ||
                "createdAt-desc"
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

            functionsService:
                source.functionsService ||
                null,

            collection:
                normalizeCollectionName(
                    source.collection,
                    DEFAULT_COLLECTION
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
                    1000,
                    "Query limit"
                ),

            currency:
                normalizeCurrency(
                    source.currency ||
                    DEFAULT_CURRENCY
                ),

            locale:
                normalizeLocale(
                    source.locale ||
                    DEFAULT_LOCALE
                ),

            refundFunctionName:
                String(
                    source.refundFunctionName ||
                    "refundOrder"
                ),

            cancelFunctionName:
                String(
                    source.cancelFunctionName ||
                    "cancelOrder"
                ),

            resendFunctionName:
                String(
                    source.resendFunctionName ||
                    "resendOrderConfirmation"
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
            throw new OrdersControllerError(
                "orders/invalid-id",
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
            throw new OrdersControllerError(
                "orders/invalid-string",
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

    function normalizeOrderStatus(
        value
    ) {
        const normalized =
            String(
                value ||
                "pending"
            )
                .trim()
                .toLowerCase();

        if (
            !ORDER_STATUSES.includes(
                normalized
            )
        ) {
            throw new OrdersControllerError(
                "orders/invalid-status",
                "Order status is invalid."
            );
        }

        return normalized;
    }

    function normalizePaymentStatus(
        value
    ) {
        const normalized =
            String(
                value ||
                "pending"
            )
                .trim()
                .toLowerCase();

        if (
            !PAYMENT_STATUSES.includes(
                normalized
            )
        ) {
            return "pending";
        }

        return normalized;
    }

    function normalizeFulfilmentStatus(
        value
    ) {
        const normalized =
            String(
                value ||
                "unfulfilled"
            )
                .trim()
                .toLowerCase();

        if (
            !FULFILMENT_STATUSES.includes(
                normalized
            )
        ) {
            throw new OrdersControllerError(
                "orders/invalid-fulfilment-status",
                "Fulfilment status is invalid."
            );
        }

        return normalized;
    }

    function normalizeMinorAmount(
        value
    ) {
        const normalized =
            Number(
                value
            );

        if (
            !Number.isFinite(
                normalized
            )
        ) {
            return 0;
        }

        return Math.round(
            normalized
        );
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

    function normalizeCurrency(
        value
    ) {
        return String(
            value ||
            DEFAULT_CURRENCY
        )
            .trim()
            .toUpperCase() ||
            DEFAULT_CURRENCY;
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

    function normalizeFilterDate(
        value,
        endOfDay
    ) {
        if (
            !value
        ) {
            return null;
        }

        const date =
            new Date(
                value +
                "T00:00:00"
            );

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {
            return null;
        }

        if (
            endOfDay
        ) {
            date.setHours(
                23,
                59,
                59,
                999
            );
        }

        return date;
    }

    function normalizeMoneyInput(
        value,
        label
    ) {
        const normalized =
            Number(
                value
            );

        if (
            !Number.isFinite(
                normalized
            ) ||
            normalized <
                0
        ) {
            throw new OrdersControllerError(
                "orders/invalid-money",
                (
                    label ||
                    "Amount"
                ) +
                " is invalid."
            );
        }

        return normalized;
    }

    /* ======================================================
       DATE / MONEY
    ====================================================== */

    function majorToMinor(
        value
    ) {
        return Math.round(
            Number(
                value
            ) *
            100
        );
    }

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

    function formatCurrency(
        minor,
        currency,
        locale
    ) {
        try {
            return new Intl
                .NumberFormat(
                    locale ||
                    DEFAULT_LOCALE,
                    {
                        style:
                            "currency",

                        currency:
                            currency ||
                            DEFAULT_CURRENCY
                    }
                )
                .format(
                    normalizeMinorAmount(
                        minor
                    ) /
                    100
                );
        } catch (
            error
        ) {
            return (
                (
                    currency ||
                    DEFAULT_CURRENCY
                ) +
                " " +
                (
                    normalizeMinorAmount(
                        minor
                    ) /
                    100
                ).toFixed(
                    2
                )
            );
        }
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

    function resolveFunctionsService() {
        if (
            global.LEternelFunctions &&
            typeof global
                .LEternelFunctions
                .getFunctionsService ===
                "function"
        ) {
            try {
                return global
                    .LEternelFunctions
                    .getFunctionsService();
            } catch (
                error
            ) {
                return null;
            }
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
        status
    ) {
        const cell =
            appendTextCell(
                row,
                titleCase(
                    status
                )
            );

        cell.dataset.status =
            status;

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

    function setLink(
        element,
        href,
        text
    ) {
        if (
            !element
        ) {
            return;
        }

        element.textContent =
            text;

        if (
            href
        ) {
            element.href =
                href;
        } else {
            element.removeAttribute(
                "href"
            );
        }
    }

    function setButtonBusy(
        element,
        busy
    ) {
        if (
            element
        ) {
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
    }

    /* ======================================================
       HELPERS
    ====================================================== */

    function formatAddress(
        address
    ) {
        const values =
            [
                address.name,
                address.company,
                address.line1,
                address.line2,
                [
                    address.city,
                    address.region,
                    address.postalCode
                ]
                    .filter(
                        Boolean
                    )
                    .join(
                        ", "
                    ),
                address.country
            ]
                .filter(
                    Boolean
                );

        return values.length
            ? values.join(
                  "\n"
              )
            : "—";
    }

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

    function createRandomId() {
        if (
            global.crypto &&
            typeof global.crypto
                .randomUUID ===
                "function"
        ) {
            return global.crypto
                .randomUUID();
        }

        return (
            Date.now()
                .toString(
                    36
                ) +
            "-" +
            Math.random()
                .toString(
                    36
                )
                .slice(
                    2,
                    12
                )
        );
    }

    function normalizeOrdersError(
        error,
        fallbackCode,
        fallbackMessage
    ) {
        if (
            error instanceof
            OrdersControllerError
        ) {
            return error;
        }

        return new OrdersControllerError(
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
                "Orders controller error.",
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

    function getOrdersController(
        options
    ) {
        if (
            options
        ) {
            return createOrdersController(
                options
            );
        }

        if (
            !defaultController
        ) {
            defaultController =
                createOrdersController();
        }

        return defaultController;
    }

    function resetOrdersController() {
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
            createOrdersController,
            getOrdersController,
            resetOrdersController,

            OrdersControllerError,

            normalizeOrder,
            normalizeOrderItems,
            normalizeAddress,
            normalizeNotes,
            normalizeTimeline,

            calculateOrderMetrics,
            matchesOrderSearch,
            createOrderComparator,

            normalizeControllerOptions,
            normalizeRequiredId,
            normalizeRequiredString,
            normalizeOptionalString,
            normalizeSearchTerm,
            normalizeOrderStatus,
            normalizePaymentStatus,
            normalizeFulfilmentStatus,
            normalizeMinorAmount,
            normalizePositiveInteger,
            normalizeCurrency,
            normalizeLocale,
            normalizeCollectionName,
            normalizeFilterDate,
            normalizeMoneyInput,

            majorToMinor,
            normalizeDateValue,
            formatCurrency,
            formatDate,

            createCsv,
            escapeCsvValue,
            formatAddress,
            normalizeSortValue,
            titleCase,
            debounce,
            createRandomId,
            normalizeOrdersError,
            cloneValue,

            constants:
                Object.freeze({
                    DEFAULT_SELECTORS,
                    DEFAULT_COLLECTION,
                    DEFAULT_PAGE_SIZE,
                    DEFAULT_CURRENCY,
                    DEFAULT_LOCALE,
                    ORDER_STATUSES,
                    PAYMENT_STATUSES,
                    FULFILMENT_STATUSES
                })
        });

    global.LEternelOrdersController =
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