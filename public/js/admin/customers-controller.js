"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ADMIN CUSTOMERS CONTROLLER

   Responsibilities:
   - Load and render customer profiles
   - Search, filter, sort, and paginate customers
   - Load customer order history and wishlist
   - Update account status, customer type, tags, and marketing
   - Add internal notes
   - Send password resets
   - Disable, anonymize, and delete customer accounts
   - Export visible customer data as CSV
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
                "[data-admin-customers]",

            refreshButton:
                "[data-customers-refresh]",

            searchInput:
                "[data-customers-search]",

            statusFilter:
                "[data-customers-status-filter]",

            typeFilter:
                "[data-customers-type-filter]",

            marketingFilter:
                "[data-customers-marketing-filter]",

            sortSelect:
                "[data-customers-sort]",

            dateFrom:
                "[data-customers-date-from]",

            dateTo:
                "[data-customers-date-to]",

            clearFiltersButton:
                "[data-customers-clear-filters]",

            exportButton:
                "[data-customers-export]",

            table:
                "[data-customers-table]",

            visibleCount:
                "[data-customers-visible-count]",

            previousButton:
                "[data-customers-previous]",

            nextButton:
                "[data-customers-next]",

            pageLabel:
                "[data-customers-page-label]",

            totalMetric:
                "[data-customers-total]",

            activeMetric:
                "[data-customers-active]",

            newMetric:
                "[data-customers-new]",

            lifetimeValueMetric:
                "[data-customers-lifetime-value]",

            statusMessage:
                "[data-customers-status]",

            loadingOverlay:
                "[data-customers-loading]",

            loadingMessage:
                "[data-customers-loading-message]",

            drawer:
                "[data-customer-drawer]",

            drawerClose:
                "[data-customer-drawer-close]",

            drawerName:
                "[data-customer-drawer-name]",

            avatar:
                "[data-customer-avatar]",

            name:
                "[data-customer-name]",

            email:
                "[data-customer-email]",

            phone:
                "[data-customer-phone]",

            statusLabel:
                "[data-customer-status-label]",

            typeLabel:
                "[data-customer-type-label]",

            orderCount:
                "[data-customer-order-count]",

            lifetimeValue:
                "[data-customer-lifetime-value]",

            createdAt:
                "[data-customer-created-at]",

            lastActiveAt:
                "[data-customer-last-active-at]",

            customerId:
                "[data-customer-id]",

            authUid:
                "[data-customer-auth-uid]",

            emailVerified:
                "[data-customer-email-verified]",

            lastSignIn:
                "[data-customer-last-sign-in]",

            status:
                "[data-customer-status]",

            type:
                "[data-customer-type]",

            saveStatusButton:
                "[data-customer-save-status]",

            passwordResetButton:
                "[data-customer-send-password-reset]",

            marketingEmail:
                "[data-customer-marketing-email]",

            marketingSms:
                "[data-customer-marketing-sms]",

            marketingPersonalization:
                "[data-customer-marketing-personalization]",

            marketingUpdatedAt:
                "[data-customer-marketing-updated-at]",

            marketingSource:
                "[data-customer-marketing-source]",

            saveMarketingButton:
                "[data-customer-save-marketing]",

            shippingAddress:
                "[data-customer-shipping-address]",

            billingAddress:
                "[data-customer-billing-address]",

            addresses:
                "[data-customer-addresses]",

            orders:
                "[data-customer-orders]",

            viewOrders:
                "[data-customer-view-orders]",

            wishlist:
                "[data-customer-wishlist]",

            noteInput:
                "[data-customer-note-input]",

            noteAddButton:
                "[data-customer-note-add]",

            notes:
                "[data-customer-notes]",

            tags:
                "[data-customer-tags]",

            saveTagsButton:
                "[data-customer-save-tags]",

            disableButton:
                "[data-customer-disable]",

            anonymizeButton:
                "[data-customer-anonymize]",

            deleteButton:
                "[data-customer-delete]",

            confirmModal:
                "[data-customer-confirm-modal]",

            confirmTitle:
                "[data-customer-confirm-title]",

            confirmMessage:
                "[data-customer-confirm-message]",

            confirmCancel:
                "[data-customer-confirm-cancel]",

            confirmSubmit:
                "[data-customer-confirm-submit]"
        });

    const DEFAULT_CUSTOMERS_COLLECTION =
        "users";

    const DEFAULT_ORDERS_COLLECTION =
        "orders";

    const DEFAULT_WISHLISTS_COLLECTION =
        "wishlists";

    const DEFAULT_PAGE_SIZE =
        20;

    const DEFAULT_QUERY_LIMIT =
        2000;

    const DEFAULT_RELATED_QUERY_LIMIT =
        50;

    const DEFAULT_CURRENCY =
        "GBP";

    const DEFAULT_LOCALE =
        "en-GB";

    const CUSTOMER_STATUSES =
        Object.freeze([
            "active",
            "disabled",
            "blocked"
        ]);

    const CUSTOMER_TYPES =
        Object.freeze([
            "new",
            "returning",
            "vip",
            "guest-converted"
        ]);

    /* ======================================================
       ERROR
    ====================================================== */

    class CustomersControllerError extends Error {
        constructor(
            code,
            message,
            options
        ) {
            super(
                message ||
                "Customer operation failed."
            );

            this.name =
                "CustomersControllerError";

            this.code =
                code ||
                "customers/unknown";

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

    function createCustomersController(
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
            throw new CustomersControllerError(
                "customers/document-unavailable",
                "Customers controller requires a document."
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
            throw new CustomersControllerError(
                "customers/root-unavailable",
                "Customers admin root element was not found."
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
            throw new CustomersControllerError(
                "customers/firestore-unavailable",
                "Firestore is unavailable."
            );
        }

        const disposers =
            [];

        let initialized =
            false;

        let destroyed =
            false;

        let loading =
            false;

        let allCustomers =
            [];

        let filteredCustomers =
            [];

        let currentPage =
            1;

        let activeCustomer =
            null;

        let activeCustomerOrders =
            [];

        let activeCustomerWishlist =
            [];

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

            await loadCustomers();

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

            closeDrawer();
            closeConfirmation();

            allCustomers =
                [];

            filteredCustomers =
                [];

            activeCustomerOrders =
                [];

            activeCustomerWishlist =
                [];

            initialized =
                false;
        }

        function assertActive() {
            if (
                destroyed
            ) {
                throw new CustomersControllerError(
                    "customers/destroyed",
                    "Customers controller has been destroyed."
                );
            }
        }

        /* ==================================================
           LOAD CUSTOMERS
        ================================================== */

        async function loadCustomers() {
            assertActive();

            setLoading(
                true,
                "Loading customers…"
            );

            setStatus(
                "Loading customer profiles…",
                "loading"
            );

            try {
                let query =
                    firestore
                        .collection(
                            settings.customersCollection
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

                allCustomers =
                    mapSnapshotDocuments(
                        snapshot
                    )
                        .map(
                            normalizeCustomer
                        );

                currentPage =
                    1;

                applyFilters();
                renderMetrics();

                setStatus(
                    allCustomers.length +
                    " customer" +
                    (
                        allCustomers.length ===
                            1
                            ? ""
                            : "s"
                    ) +
                    " loaded.",
                    "success"
                );

                return cloneValue(
                    allCustomers
                );
            } catch (
                error
            ) {
                const normalized =
                    normalizeCustomersError(
                        error,
                        "customers/load-failed",
                        "Unable to load customers."
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
           FILTERING
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

            const type =
                getInputValue(
                    elements.typeFilter
                ).toLowerCase();

            const marketing =
                getInputValue(
                    elements.marketingFilter
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

            filteredCustomers =
                allCustomers.filter(
                    function (
                        customer
                    ) {
                        if (
                            status &&
                            customer.status !==
                                status
                        ) {
                            return false;
                        }

                        if (
                            type &&
                            customer.type !==
                                type
                        ) {
                            return false;
                        }

                        if (
                            marketing &&
                            !matchesMarketingFilter(
                                customer,
                                marketing
                            )
                        ) {
                            return false;
                        }

                        if (
                            search &&
                            !matchesCustomerSearch(
                                customer,
                                search
                            )
                        ) {
                            return false;
                        }

                        const createdAt =
                            customer.createdAt
                                ? Date.parse(
                                      customer.createdAt
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

            filteredCustomers.sort(
                createCustomerComparator(
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

            renderCustomers();
            renderPagination();
            renderMetrics();

            setText(
                elements.visibleCount,
                filteredCustomers.length
            );

            return cloneValue(
                filteredCustomers
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
                elements.typeFilter,
                ""
            );

            setInputValue(
                elements.marketingFilter,
                ""
            );

            setInputValue(
                elements.sortSelect,
                "createdAt-desc"
            );

            setInputValue(
                elements.dateFrom,
                ""
            );

            setInputValue(
                elements.dateTo,
                ""
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
                calculateCustomerMetrics(
                    filteredCustomers,
                    new Date()
                );

            setText(
                elements.totalMetric,
                metrics.total
            );

            setText(
                elements.activeMetric,
                metrics.active
            );

            setText(
                elements.newMetric,
                metrics.newThisMonth
            );

            setText(
                elements.lifetimeValueMetric,
                formatCurrency(
                    metrics.lifetimeValueMinor,
                    settings.currency,
                    settings.locale
                )
            );

            return metrics;
        }

        /* ==================================================
           TABLE
        ================================================== */

        function renderCustomers() {
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

            const customers =
                getCurrentPageCustomers();

            if (
                !customers.length
            ) {
                renderEmptyTable(
                    "No matching customers found."
                );

                return;
            }

            for (
                const customer of
                customers
            ) {
                tbody.appendChild(
                    createCustomerRow(
                        customer
                    )
                );
            }
        }

        function createCustomerRow(
            customer
        ) {
            const row =
                documentObject
                    .createElement(
                        "tr"
                    );

            const customerCell =
                documentObject
                    .createElement(
                        "td"
                    );

            const profile =
                documentObject
                    .createElement(
                        "div"
                    );

            profile.className =
                "admin-customer-cell";

            const avatar =
                documentObject
                    .createElement(
                        "span"
                    );

            avatar.className =
                "admin-customer-avatar admin-customer-avatar-small";

            avatar.textContent =
                createCustomerInitials(
                    customer.name,
                    customer.email
                );

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
                customer.name ||
                "Unnamed Customer";

            const email =
                documentObject
                    .createElement(
                        "small"
                    );

            email.textContent =
                customer.email ||
                customer.id;

            copy.appendChild(
                name
            );

            copy.appendChild(
                email
            );

            profile.appendChild(
                avatar
            );

            profile.appendChild(
                copy
            );

            customerCell.appendChild(
                profile
            );

            row.appendChild(
                customerCell
            );

            appendStatusCell(
                row,
                customer.status
            );

            appendTextCell(
                row,
                titleCase(
                    customer.type
                )
            );

            appendTextCell(
                row,
                customer.orderCount
            );

            appendTextCell(
                row,
                formatCurrency(
                    customer.lifetimeValueMinor,
                    customer.currency,
                    settings.locale
                )
            );

            appendTextCell(
                row,
                formatDate(
                    customer.lastOrderAt,
                    settings.locale
                )
            );

            appendTextCell(
                row,
                formatDate(
                    customer.createdAt,
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
                        return openDrawer(
                            customer
                        );
                    }
                )
            );

            if (
                customer.status ===
                "active"
            ) {
                actions.appendChild(
                    createActionButton(
                        documentObject,
                        "Disable",
                        function () {
                            return updateCustomerAccount({
                                status:
                                    "disabled"
                            });
                        }
                    )
                );
            } else {
                actions.appendChild(
                    createActionButton(
                        documentObject,
                        "Activate",
                        function () {
                            activeCustomer =
                                cloneValue(
                                    customer
                                );

                            return updateCustomerAccount({
                                status:
                                    "active"
                            });
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
                8;

            cell.className =
                "admin-operation-empty";

            cell.textContent =
                message ||
                "No customers found.";

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
                    filteredCustomers.length /
                    settings.pageSize
                )
            );
        }

        function getCurrentPageCustomers() {
            const start =
                (
                    currentPage -
                    1
                ) *
                settings.pageSize;

            return filteredCustomers.slice(
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

                renderCustomers();
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

                renderCustomers();
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
           CUSTOMER DRAWER
        ================================================== */

        async function openDrawer(
            customer
        ) {
            assertActive();

            activeCustomer =
                cloneValue(
                    customer
                );

            activeCustomerOrders =
                [];

            activeCustomerWishlist =
                [];

            renderCustomerDetails(
                activeCustomer
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

            await loadCustomerRelations(
                activeCustomer
            );

            return activeCustomer;
        }

        function closeDrawer() {
            activeCustomer =
                null;

            activeCustomerOrders =
                [];

            activeCustomerWishlist =
                [];

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

        function renderCustomerDetails(
            customer
        ) {
            setText(
                elements.drawerName,
                customer.name ||
                "Customer"
            );

            setText(
                elements.avatar,
                createCustomerInitials(
                    customer.name,
                    customer.email
                )
            );

            setText(
                elements.name,
                customer.name ||
                "Unnamed Customer"
            );

            setLink(
                elements.email,
                customer.email
                    ? "mailto:" +
                      customer.email
                    : null,
                customer.email ||
                "—"
            );

            setLink(
                elements.phone,
                customer.phone
                    ? "tel:" +
                      customer.phone
                    : null,
                customer.phone ||
                "—"
            );

            setStatusText(
                elements.statusLabel,
                customer.status
            );

            setText(
                elements.typeLabel,
                titleCase(
                    customer.type
                )
            );

            setText(
                elements.orderCount,
                customer.orderCount
            );

            setText(
                elements.lifetimeValue,
                formatCurrency(
                    customer.lifetimeValueMinor,
                    customer.currency,
                    settings.locale
                )
            );

            setText(
                elements.createdAt,
                formatDate(
                    customer.createdAt,
                    settings.locale
                )
            );

            setText(
                elements.lastActiveAt,
                formatDate(
                    customer.lastActiveAt,
                    settings.locale
                )
            );

            setText(
                elements.customerId,
                customer.id
            );

            setText(
                elements.authUid,
                customer.authUid ||
                customer.id
            );

            setText(
                elements.emailVerified,
                customer.emailVerified
                    ? "Yes"
                    : "No"
            );

            setText(
                elements.lastSignIn,
                formatDate(
                    customer.lastSignInAt,
                    settings.locale
                )
            );

            setInputValue(
                elements.status,
                customer.status
            );

            setInputValue(
                elements.type,
                customer.type
            );

            setChecked(
                elements.marketingEmail,
                customer.marketing.email
            );

            setChecked(
                elements.marketingSms,
                customer.marketing.sms
            );

            setChecked(
                elements.marketingPersonalization,
                customer.marketing.personalization
            );

            setText(
                elements.marketingUpdatedAt,
                formatDate(
                    customer.marketing.updatedAt,
                    settings.locale
                )
            );

            setText(
                elements.marketingSource,
                customer.marketing.source ||
                "—"
            );

            setText(
                elements.shippingAddress,
                formatAddress(
                    customer.defaultShippingAddress
                )
            );

            setText(
                elements.billingAddress,
                formatAddress(
                    customer.defaultBillingAddress
                )
            );

            renderAddresses(
                customer.addresses
            );

            renderNotes(
                customer.notes
            );

            setInputValue(
                elements.tags,
                customer.tags.join(
                    ", "
                )
            );

            if (
                elements.viewOrders
            ) {
                const query =
                    customer.email
                        ? "?customer=" +
                          encodeURIComponent(
                              customer.email
                          )
                        : "?customerId=" +
                          encodeURIComponent(
                              customer.id
                          );

                elements.viewOrders.href =
                    "/admin/orders.html" +
                    query;
            }
        }

        /* ==================================================
           RELATIONS
        ================================================== */

        async function loadCustomerRelations(
            customer
        ) {
            setLoading(
                true,
                "Loading customer activity…"
            );

            try {
                const [
                    orders,
                    wishlist
                ] =
                    await Promise.all([
                        loadCustomerOrders(
                            customer
                        ),

                        loadCustomerWishlist(
                            customer
                        )
                    ]);

                activeCustomerOrders =
                    orders;

                activeCustomerWishlist =
                    wishlist;

                renderCustomerOrders(
                    orders
                );

                renderWishlist(
                    wishlist
                );

                return {
                    orders:
                        cloneValue(
                            orders
                        ),

                    wishlist:
                        cloneValue(
                            wishlist
                        )
                };
            } catch (
                error
            ) {
                reportError(
                    error
                );

                renderCustomerOrders(
                    []
                );

                renderWishlist(
                    []
                );

                return {
                    orders:
                        [],

                    wishlist:
                        []
                };
            } finally {
                setLoading(
                    false
                );
            }
        }

        async function loadCustomerOrders(
            customer
        ) {
            let query =
                firestore
                    .collection(
                        settings.ordersCollection
                    );

            if (
                customer.id &&
                typeof query.where ===
                    "function"
            ) {
                query =
                    query.where(
                        "customerId",
                        "==",
                        customer.id
                    );
            } else if (
                customer.email &&
                typeof query.where ===
                    "function"
            ) {
                query =
                    query.where(
                        "customerEmail",
                        "==",
                        customer.email
                    );
            }

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
                        settings.relatedQueryLimit
                    );
            }

            const snapshot =
                await query.get();

            return mapSnapshotDocuments(
                snapshot
            )
                .map(
                    normalizeCustomerOrder
                );
        }

        async function loadCustomerWishlist(
            customer
        ) {
            const directReference =
                firestore
                    .collection(
                        settings.wishlistsCollection
                    )
                    .doc(
                        customer.id
                    );

            const directSnapshot =
                await directReference.get();

            if (
                directSnapshot &&
                directSnapshot.exists
            ) {
                const data =
                    directSnapshot.data() ||
                    {};

                return normalizeWishlistItems(
                    data.items ||
                    data.products
                );
            }

            let query =
                firestore
                    .collection(
                        settings.wishlistsCollection
                    );

            if (
                typeof query.where ===
                "function"
            ) {
                query =
                    query.where(
                        "customerId",
                        "==",
                        customer.id
                    );
            }

            if (
                typeof query.limit ===
                "function"
            ) {
                query =
                    query.limit(
                        1
                    );
            }

            const snapshot =
                await query.get();

            const documents =
                mapSnapshotDocuments(
                    snapshot
                );

            if (
                !documents.length
            ) {
                return [];
            }

            return normalizeWishlistItems(
                documents[0].items ||
                documents[0].products
            );
        }

        /* ==================================================
           RELATED RENDERING
        ================================================== */

        function renderCustomerOrders(
            orders
        ) {
            if (
                !elements.orders
            ) {
                return;
            }

            elements.orders.textContent =
                "";

            if (
                !orders.length
            ) {
                appendEmptyState(
                    elements.orders,
                    "No customer orders found."
                );

                return;
            }

            for (
                const order of
                orders
            ) {
                const item =
                    documentObject
                        .createElement(
                            "article"
                        );

                item.className =
                    "admin-customer-order";

                const copy =
                    documentObject
                        .createElement(
                            "div"
                        );

                const number =
                    documentObject
                        .createElement(
                            "strong"
                        );

                number.textContent =
                    order.displayId;

                const date =
                    documentObject
                        .createElement(
                            "small"
                        );

                date.textContent =
                    formatDate(
                        order.createdAt,
                        settings.locale
                    );

                copy.appendChild(
                    number
                );

                copy.appendChild(
                    date
                );

                const meta =
                    documentObject
                        .createElement(
                            "div"
                        );

                meta.className =
                    "admin-customer-order-meta";

                const status =
                    documentObject
                        .createElement(
                            "span"
                        );

                status.dataset.status =
                    order.status;

                status.textContent =
                    titleCase(
                        order.status
                    );

                const total =
                    documentObject
                        .createElement(
                            "strong"
                        );

                total.textContent =
                    formatCurrency(
                        order.totalMinor,
                        order.currency,
                        settings.locale
                    );

                meta.appendChild(
                    status
                );

                meta.appendChild(
                    total
                );

                item.appendChild(
                    copy
                );

                item.appendChild(
                    meta
                );

                elements.orders.appendChild(
                    item
                );
            }
        }

        function renderWishlist(
            items
        ) {
            if (
                !elements.wishlist
            ) {
                return;
            }

            elements.wishlist.textContent =
                "";

            if (
                !items.length
            ) {
                appendEmptyState(
                    elements.wishlist,
                    "No wishlist items."
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
                    "admin-wishlist-item";

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

                const detail =
                    documentObject
                        .createElement(
                            "small"
                        );

                detail.textContent =
                    [
                        item.sku,
                        item.addedAt
                            ? formatDate(
                                  item.addedAt,
                                  settings.locale
                              )
                            : null
                    ]
                        .filter(
                            Boolean
                        )
                        .join(
                            " · "
                        ) ||
                    item.productId;

                copy.appendChild(
                    name
                );

                copy.appendChild(
                    detail
                );

                row.appendChild(
                    copy
                );

                elements.wishlist.appendChild(
                    row
                );
            }
        }

        function renderAddresses(
            addresses
        ) {
            if (
                !elements.addresses
            ) {
                return;
            }

            elements.addresses.textContent =
                "";

            if (
                !addresses.length
            ) {
                appendEmptyState(
                    elements.addresses,
                    "No saved addresses."
                );

                return;
            }

            for (
                const address of
                addresses
            ) {
                const item =
                    documentObject
                        .createElement(
                            "address"
                        );

                item.className =
                    "admin-customer-address";

                item.textContent =
                    formatAddress(
                        address
                    );

                elements.addresses.appendChild(
                    item
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
                appendEmptyState(
                    elements.notes,
                    "No notes."
                );

                return;
            }

            const sorted =
                notes.slice()
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
                const note of
                sorted
            ) {
                const item =
                    documentObject
                        .createElement(
                            "article"
                        );

                item.className =
                    "admin-order-note";

                const message =
                    documentObject
                        .createElement(
                            "p"
                        );

                message.textContent =
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
                    message
                );

                item.appendChild(
                    meta
                );

                elements.notes.appendChild(
                    item
                );
            }
        }

        /* ==================================================
           ACCOUNT UPDATE
        ================================================== */

        async function saveAccount() {
            if (
                !activeCustomer
            ) {
                return false;
            }

            return updateCustomerAccount({
                status:
                    normalizeCustomerStatus(
                        getInputValue(
                            elements.status
                        )
                    ),

                type:
                    normalizeCustomerType(
                        getInputValue(
                            elements.type
                        )
                    )
            });
        }

        async function updateCustomerAccount(
            patch
        ) {
            if (
                !activeCustomer
            ) {
                throw new CustomersControllerError(
                    "customers/no-active-customer",
                    "No customer is selected."
                );
            }

            setLoading(
                true,
                "Updating customer account…"
            );

            try {
                const normalizedPatch =
                    Object.assign(
                        {},
                        patch,
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
                        settings.customersCollection
                    )
                    .doc(
                        activeCustomer.id
                    )
                    .set(
                        normalizedPatch,
                        {
                            merge:
                                true
                        }
                    );

                setStatus(
                    "Customer account updated.",
                    "success"
                );

                await refreshActiveCustomer();

                return true;
            } catch (
                error
            ) {
                const normalized =
                    normalizeCustomersError(
                        error,
                        "customers/update-failed",
                        "Unable to update customer account."
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

        async function saveMarketing() {
            if (
                !activeCustomer
            ) {
                return false;
            }

            const marketing = {
                email:
                    getChecked(
                        elements.marketingEmail
                    ),

                sms:
                    getChecked(
                        elements.marketingSms
                    ),

                personalization:
                    getChecked(
                        elements.marketingPersonalization
                    ),

                updatedAt:
                    createServerTimestamp(),

                source:
                    "admin",

                updatedBy:
                    getCurrentUserId(
                        auth
                    )
            };

            return updateCustomerAccount({
                marketing:
                    marketing
            });
        }

        async function saveTags() {
            if (
                !activeCustomer
            ) {
                return false;
            }

            const tags =
                parseCommaList(
                    getInputValue(
                        elements.tags
                    )
                );

            return updateCustomerAccount({
                tags:
                    tags
            });
        }

        /* ==================================================
           NOTES
        ================================================== */

        async function addNote() {
            if (
                !activeCustomer
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
                activeCustomer.notes.concat([
                    note
                ]);

            await updateCustomerAccount({
                notes:
                    notes
            });

            setInputValue(
                elements.noteInput,
                ""
            );

            setStatus(
                "Customer note added.",
                "success"
            );

            return true;
        }

        /* ==================================================
           PASSWORD RESET
        ================================================== */

        async function sendPasswordReset() {
            if (
                !activeCustomer ||
                !activeCustomer.email
            ) {
                throw new CustomersControllerError(
                    "customers/email-required",
                    "Customer email is unavailable."
                );
            }

            setLoading(
                true,
                "Sending password reset…"
            );

            try {
                if (
                    functionsService &&
                    typeof functionsService.call ===
                        "function"
                ) {
                    await functionsService.call(
                        settings.passwordResetFunctionName,
                        {
                            customerId:
                                activeCustomer.id,

                            email:
                                activeCustomer.email
                        }
                    );
                } else if (
                    auth &&
                    typeof auth.sendPasswordResetEmail ===
                        "function"
                ) {
                    await auth.sendPasswordResetEmail(
                        activeCustomer.email
                    );
                } else {
                    throw new CustomersControllerError(
                        "customers/password-reset-unavailable",
                        "Password reset service is unavailable."
                    );
                }

                setStatus(
                    "Password reset email sent.",
                    "success"
                );

                return true;
            } catch (
                error
            ) {
                const normalized =
                    normalizeCustomersError(
                        error,
                        "customers/password-reset-failed",
                        "Unable to send password reset."
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
           DISABLE / ANONYMIZE / DELETE
        ================================================== */

        function requestDisable() {
            if (
                !activeCustomer
            ) {
                return false;
            }

            const targetStatus =
                activeCustomer.status ===
                    "disabled"
                    ? "active"
                    : "disabled";

            return openConfirmation({
                title:
                    targetStatus ===
                        "disabled"
                        ? "Disable Account?"
                        : "Activate Account?",

                message:
                    (
                        targetStatus ===
                            "disabled"
                            ? "Disable access for "
                            : "Restore access for "
                    ) +
                    (
                        activeCustomer.name ||
                        activeCustomer.email ||
                        activeCustomer.id
                    ) +
                    ".",

                action:
                    async function () {
                        if (
                            functionsService &&
                            typeof functionsService.call ===
                                "function"
                        ) {
                            await functionsService.call(
                                settings.setAccountStatusFunctionName,
                                {
                                    customerId:
                                        activeCustomer.id,

                                    uid:
                                        activeCustomer.authUid ||
                                        activeCustomer.id,

                                    status:
                                        targetStatus
                                }
                            );
                        }

                        await updateCustomerAccount({
                            status:
                                targetStatus
                        });
                    }
            });
        }

        function requestAnonymize() {
            if (
                !activeCustomer
            ) {
                return false;
            }

            return openConfirmation({
                title:
                    "Anonymize Customer?",

                message:
                    "Replace personal profile data for " +
                    (
                        activeCustomer.name ||
                        activeCustomer.email ||
                        activeCustomer.id
                    ) +
                    ". Order records may remain for accounting purposes.",

                action:
                    anonymizeCustomer
            });
        }

        async function anonymizeCustomer() {
            if (
                !activeCustomer
            ) {
                return false;
            }

            setLoading(
                true,
                "Anonymizing customer…"
            );

            try {
                if (
                    functionsService &&
                    typeof functionsService.call ===
                        "function"
                ) {
                    await functionsService.call(
                        settings.anonymizeFunctionName,
                        {
                            customerId:
                                activeCustomer.id,

                            uid:
                                activeCustomer.authUid ||
                                activeCustomer.id
                        },
                        {
                            timeoutMs:
                                120000
                        }
                    );
                } else {
                    await firestore
                        .collection(
                            settings.customersCollection
                        )
                        .doc(
                            activeCustomer.id
                        )
                        .set(
                            createAnonymizedCustomerPatch(
                                activeCustomer.id,
                                getCurrentUserId(
                                    auth
                                )
                            ),
                            {
                                merge:
                                    true
                            }
                        );
                }

                setStatus(
                    "Customer data anonymized.",
                    "success"
                );

                closeDrawer();

                await loadCustomers();

                return true;
            } catch (
                error
            ) {
                const normalized =
                    normalizeCustomersError(
                        error,
                        "customers/anonymize-failed",
                        "Unable to anonymize customer."
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

        function requestDelete() {
            if (
                !activeCustomer
            ) {
                return false;
            }

            return openConfirmation({
                title:
                    "Delete Customer?",

                message:
                    "Permanently delete the customer profile for " +
                    (
                        activeCustomer.name ||
                        activeCustomer.email ||
                        activeCustomer.id
                    ) +
                    ". This action cannot be undone.",

                action:
                    deleteCustomer
            });
        }

        async function deleteCustomer() {
            if (
                !activeCustomer
            ) {
                return false;
            }

            setLoading(
                true,
                "Deleting customer…"
            );

            try {
                const customerId =
                    activeCustomer.id;

                if (
                    functionsService &&
                    typeof functionsService.call ===
                        "function"
                ) {
                    await functionsService.call(
                        settings.deleteFunctionName,
                        {
                            customerId:
                                customerId,

                            uid:
                                activeCustomer.authUid ||
                                customerId,

                            deleteAuthenticationUser:
                                true
                        },
                        {
                            timeoutMs:
                                120000
                        }
                    );
                } else {
                    await firestore
                        .collection(
                            settings.customersCollection
                        )
                        .doc(
                            customerId
                        )
                        .delete();
                }

                setStatus(
                    "Customer deleted.",
                    "success"
                );

                closeDrawer();

                await loadCustomers();

                return true;
            } catch (
                error
            ) {
                const normalized =
                    normalizeCustomersError(
                        error,
                        "customers/delete-failed",
                        "Unable to delete customer."
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
           REFRESH ACTIVE CUSTOMER
        ================================================== */

        async function refreshActiveCustomer() {
            if (
                !activeCustomer
            ) {
                return null;
            }

            const customerId =
                activeCustomer.id;

            await loadCustomers();

            const updated =
                allCustomers.find(
                    function (
                        customer
                    ) {
                        return customer.id ===
                            customerId;
                    }
                );

            if (
                !updated
            ) {
                closeDrawer();

                return null;
            }

            activeCustomer =
                cloneValue(
                    updated
                );

            renderCustomerDetails(
                activeCustomer
            );

            return activeCustomer;
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
                    normalizeCustomersError(
                        error,
                        "customers/action-failed",
                        "Unable to complete customer action."
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
                filteredCustomers.map(
                    function (
                        customer
                    ) {
                        return {
                            id:
                                customer.id,

                            name:
                                customer.name ||
                                "",

                            email:
                                customer.email ||
                                "",

                            phone:
                                customer.phone ||
                                "",

                            status:
                                customer.status,

                            type:
                                customer.type,

                            orders:
                                customer.orderCount,

                            lifetimeValue:
                                (
                                    customer.lifetimeValueMinor /
                                    100
                                ).toFixed(
                                    2
                                ),

                            currency:
                                customer.currency,

                            marketingEmail:
                                customer.marketing.email
                                    ? "yes"
                                    : "no",

                            marketingSms:
                                customer.marketing.sms
                                    ? "yes"
                                    : "no",

                            joined:
                                customer.createdAt ||
                                "",

                            lastActive:
                                customer.lastActiveAt ||
                                "",

                            tags:
                                customer.tags.join(
                                    "|"
                                )
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
                "leternel-customers-" +
                formatFileDate(
                    new Date()
                ) +
                ".csv",
                "text/csv;charset=utf-8"
            );

            setStatus(
                rows.length +
                " customer" +
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
                loadCustomers
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
                elements.typeFilter,
                resetPageAndApply
            );

            bindChange(
                elements.marketingFilter,
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

            bindClick(
                elements.drawerClose,
                closeDrawer
            );

            bindClick(
                elements.saveStatusButton,
                saveAccount
            );

            bindClick(
                elements.passwordResetButton,
                sendPasswordReset
            );

            bindClick(
                elements.saveMarketingButton,
                saveMarketing
            );

            bindClick(
                elements.noteAddButton,
                addNote
            );

            bindClick(
                elements.saveTagsButton,
                saveTags
            );

            bindClick(
                elements.disableButton,
                requestDisable
            );

            bindClick(
                elements.anonymizeButton,
                requestAnonymize
            );

            bindClick(
                elements.deleteButton,
                requestDelete
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

                totalCustomers:
                    allCustomers.length,

                visibleCustomers:
                    filteredCustomers.length,

                activeCustomer:
                    cloneValue(
                        activeCustomer
                    ),

                activeCustomerOrders:
                    cloneValue(
                        activeCustomerOrders
                    ),

                activeCustomerWishlist:
                    cloneValue(
                        activeCustomerWishlist
                    )
            };
        }

        const controller =
            Object.freeze({
                init,
                destroy,

                loadCustomers,
                applyFilters,
                clearFilters,

                renderCustomers,
                renderMetrics,
                renderPagination,

                openDrawer,
                closeDrawer,
                renderCustomerDetails,

                loadCustomerRelations,
                loadCustomerOrders,
                loadCustomerWishlist,

                saveAccount,
                saveMarketing,
                saveTags,
                addNote,

                sendPasswordReset,
                requestDisable,
                requestAnonymize,
                requestDelete,

                anonymizeCustomer,
                deleteCustomer,

                exportCsv,

                getSnapshot,

                get customers() {
                    return cloneValue(
                        allCustomers
                    );
                },

                get filteredCustomers() {
                    return cloneValue(
                        filteredCustomers
                    );
                },

                elements,
                options:
                    settings
            });

        return controller;
    }

    /* ======================================================
       CUSTOMER NORMALIZATION
    ====================================================== */

    function normalizeCustomer(
        input
    ) {
        const source =
            input ||
            {};

        const marketing =
            source.marketing &&
            typeof source.marketing ===
                "object"
                ? source.marketing
                : {};

        const statistics =
            source.statistics &&
            typeof source.statistics ===
                "object"
                ? source.statistics
                : {};

        return {
            id:
                normalizeRequiredId(
                    source.id ||
                    source.uid,
                    "Customer ID"
                ),

            authUid:
                normalizeOptionalString(
                    source.authUid ||
                    source.uid ||
                    source.id
                ),

            name:
                normalizeOptionalString(
                    source.displayName ||
                    source.name ||
                    [
                        source.firstName,
                        source.lastName
                    ]
                        .filter(
                            Boolean
                        )
                        .join(
                            " "
                        )
                ),

            email:
                normalizeOptionalString(
                    source.email
                ),

            phone:
                normalizeOptionalString(
                    source.phone ||
                    source.phoneNumber
                ),

            status:
                normalizeCustomerStatus(
                    source.status ||
                    (
                        source.disabled
                            ? "disabled"
                            : "active"
                    )
                ),

            type:
                normalizeCustomerType(
                    source.type ||
                    source.customerType ||
                    inferCustomerType(
                        source
                    )
                ),

            emailVerified:
                Boolean(
                    source.emailVerified
                ),

            orderCount:
                normalizeNonNegativeInteger(
                    source.orderCount !==
                        undefined
                        ? source.orderCount
                        : statistics.orderCount,
                    0,
                    "Order count"
                ),

            lifetimeValueMinor:
                normalizeMinorAmount(
                    source.lifetimeValueMinor !==
                        undefined
                        ? source.lifetimeValueMinor
                        : statistics.lifetimeValueMinor
                ),

            currency:
                normalizeCurrency(
                    source.currency ||
                    statistics.currency ||
                    DEFAULT_CURRENCY
                ),

            lastOrderAt:
                normalizeDateValue(
                    source.lastOrderAt ||
                    statistics.lastOrderAt
                ),

            lastActiveAt:
                normalizeDateValue(
                    source.lastActiveAt ||
                    source.updatedAt
                ),

            lastSignInAt:
                normalizeDateValue(
                    source.lastSignInAt ||
                    source.lastLoginAt
                ),

            marketing: {
                email:
                    Boolean(
                        marketing.email ||
                        marketing.emailSubscribed ||
                        source.marketingEmail
                    ),

                sms:
                    Boolean(
                        marketing.sms ||
                        marketing.smsSubscribed ||
                        source.marketingSms
                    ),

                personalization:
                    Boolean(
                        marketing.personalization ||
                        source.personalizationConsent
                    ),

                updatedAt:
                    normalizeDateValue(
                        marketing.updatedAt
                    ),

                source:
                    normalizeOptionalString(
                        marketing.source
                    )
            },

            defaultShippingAddress:
                normalizeAddress(
                    source.defaultShippingAddress ||
                    source.shippingAddress
                ),

            defaultBillingAddress:
                normalizeAddress(
                    source.defaultBillingAddress ||
                    source.billingAddress ||
                    source.defaultShippingAddress ||
                    source.shippingAddress
                ),

            addresses:
                normalizeAddresses(
                    source.addresses
                ),

            notes:
                normalizeNotes(
                    source.notes
                ),

            tags:
                normalizeStringArray(
                    source.tags
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

    function normalizeCustomerOrder(
        input
    ) {
        const source =
            input ||
            {};

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

            status:
                String(
                    source.status ||
                    "pending"
                )
                    .trim()
                    .toLowerCase(),

            totalMinor:
                normalizeMinorAmount(
                    source.totalMinor !==
                        undefined
                        ? source.totalMinor
                        : source.total
                ),

            currency:
                normalizeCurrency(
                    source.currency ||
                    DEFAULT_CURRENCY
                ),

            createdAt:
                normalizeDateValue(
                    source.createdAt
                )
        };
    }

    function normalizeWishlistItems(
        input
    ) {
        if (
            !Array.isArray(
                input
            )
        ) {
            return [];
        }

        return input.map(
            function (
                item,
                index
            ) {
                const source =
                    item ||
                    {};

                return {
                    id:
                        String(
                            source.id ||
                            source.productId ||
                            index
                        ),

                    productId:
                        normalizeOptionalString(
                            source.productId ||
                            source.id
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

                    imageUrl:
                        normalizeOptionalString(
                            source.imageUrl ||
                            source.image
                        ),

                    addedAt:
                        normalizeDateValue(
                            source.addedAt ||
                            source.createdAt
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
            id:
                normalizeOptionalString(
                    source.id
                ),

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

    function normalizeAddresses(
        input
    ) {
        if (
            !Array.isArray(
                input
            )
        ) {
            return [];
        }

        return input
            .map(
                normalizeAddress
            )
            .filter(
                function (
                    address
                ) {
                    return Boolean(
                        address.line1 ||
                        address.city ||
                        address.country
                    );
                }
            );
    }

    function normalizeNotes(
        input
    ) {
        if (
            !Array.isArray(
                input
            )
        ) {
            return [];
        }

        return input.map(
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

    /* ======================================================
       METRICS / SEARCH / SORT
    ====================================================== */

    function calculateCustomerMetrics(
        customers,
        now
    ) {
        const rows =
            Array.isArray(
                customers
            )
                ? customers
                : [];

        const currentDate =
            now instanceof Date
                ? now
                : new Date();

        const monthStart =
            new Date(
                currentDate.getFullYear(),
                currentDate.getMonth(),
                1
            );

        return {
            total:
                rows.length,

            active:
                rows.filter(
                    function (
                        customer
                    ) {
                        return customer.status ===
                            "active";
                    }
                ).length,

            newThisMonth:
                rows.filter(
                    function (
                        customer
                    ) {
                        if (
                            !customer.createdAt
                        ) {
                            return false;
                        }

                        return Date.parse(
                            customer.createdAt
                        ) >=
                            monthStart.getTime();
                    }
                ).length,

            lifetimeValueMinor:
                rows.reduce(
                    function (
                        total,
                        customer
                    ) {
                        return total +
                            customer.lifetimeValueMinor;
                    },
                    0
                )
        };
    }

    function matchesCustomerSearch(
        customer,
        search
    ) {
        const haystack =
            [
                customer.id,
                customer.authUid,
                customer.name,
                customer.email,
                customer.phone,
                customer.type
            ]
                .concat(
                    customer.tags
                )
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

    function matchesMarketingFilter(
        customer,
        filter
    ) {
        switch (
            filter
        ) {
            case "subscribed":
                return customer.marketing.email ===
                    true;

            case "not-subscribed":
                return customer.marketing.email ===
                    false;

            case "unsubscribed":
                return (
                    customer.marketing.email ===
                        false &&
                    Boolean(
                        customer.marketing.updatedAt
                    )
                );

            default:
                return true;
        }
    }

    function createCustomerComparator(
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

    function inferCustomerType(
        source
    ) {
        const orderCount =
            Number(
                source.orderCount ||
                (
                    source.statistics &&
                    source.statistics.orderCount
                ) ||
                0
            );

        const lifetimeValue =
            Number(
                source.lifetimeValueMinor ||
                (
                    source.statistics &&
                    source.statistics
                        .lifetimeValueMinor
                ) ||
                0
            );

        if (
            lifetimeValue >=
            500000
        ) {
            return "vip";
        }

        if (
            orderCount >
            1
        ) {
            return "returning";
        }

        return "new";
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

            customersCollection:
                normalizeCollectionName(
                    source.customersCollection,
                    DEFAULT_CUSTOMERS_COLLECTION
                ),

            ordersCollection:
                normalizeCollectionName(
                    source.ordersCollection,
                    DEFAULT_ORDERS_COLLECTION
                ),

            wishlistsCollection:
                normalizeCollectionName(
                    source.wishlistsCollection,
                    DEFAULT_WISHLISTS_COLLECTION
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

            relatedQueryLimit:
                normalizePositiveInteger(
                    source.relatedQueryLimit,
                    DEFAULT_RELATED_QUERY_LIMIT,
                    "Related query limit"
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

            passwordResetFunctionName:
                String(
                    source.passwordResetFunctionName ||
                    "sendCustomerPasswordReset"
                ),

            setAccountStatusFunctionName:
                String(
                    source.setAccountStatusFunctionName ||
                    "setCustomerAccountStatus"
                ),

            anonymizeFunctionName:
                String(
                    source.anonymizeFunctionName ||
                    "anonymizeCustomer"
                ),

            deleteFunctionName:
                String(
                    source.deleteFunctionName ||
                    "deleteCustomer"
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
            throw new CustomersControllerError(
                "customers/invalid-id",
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
            throw new CustomersControllerError(
                "customers/invalid-string",
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

    function normalizeCustomerStatus(
        value
    ) {
        const normalized =
            String(
                value ||
                "active"
            )
                .trim()
                .toLowerCase();

        if (
            !CUSTOMER_STATUSES.includes(
                normalized
            )
        ) {
            throw new CustomersControllerError(
                "customers/invalid-status",
                "Customer status is invalid."
            );
        }

        return normalized;
    }

    function normalizeCustomerType(
        value
    ) {
        const normalized =
            String(
                value ||
                "new"
            )
                .trim()
                .toLowerCase();

        if (
            !CUSTOMER_TYPES.includes(
                normalized
            )
        ) {
            return "new";
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

    function normalizeStringArray(
        value
    ) {
        if (
            !Array.isArray(
                value
            )
        ) {
            return [];
        }

        return value
            .map(
                function (
                    item
                ) {
                    return String(
                        item ||
                        ""
                    ).trim();
                }
            )
            .filter(
                Boolean
            );
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

    /* ======================================================
       PARSING
    ====================================================== */

    function parseCommaList(
        value
    ) {
        return Array.from(
            new Set(
                String(
                    value ||
                    ""
                )
                    .split(
                        ","
                    )
                    .map(
                        function (
                            item
                        ) {
                            return item
                                .trim()
                                .toLowerCase();
                        }
                    )
                    .filter(
                        Boolean
                    )
            )
        );
    }

    /* ======================================================
       DATE / MONEY
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
       ANONYMIZATION
    ====================================================== */

    function createAnonymizedCustomerPatch(
        customerId,
        adminId
    ) {
        return {
            displayName:
                "Deleted Customer",

            name:
                "Deleted Customer",

            firstName:
                null,

            lastName:
                null,

            email:
                "deleted+" +
                customerId +
                "@invalid.local",

            phone:
                null,

            phoneNumber:
                null,

            addresses:
                [],

            defaultShippingAddress:
                null,

            defaultBillingAddress:
                null,

            shippingAddress:
                null,

            billingAddress:
                null,

            marketing: {
                email:
                    false,

                sms:
                    false,

                personalization:
                    false,

                source:
                    "anonymization",

                updatedAt:
                    new Date()
                        .toISOString()
            },

            tags:
                [],

            notes:
                [],

            status:
                "disabled",

            anonymized:
                true,

            anonymizedAt:
                createServerTimestamp(),

            anonymizedBy:
                adminId ||
                null,

            updatedAt:
                createServerTimestamp(),

            updatedBy:
                adminId ||
                null
        };
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

        const output = [
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
            output.push(
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

        return output.join(
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

    function appendEmptyState(
        container,
        message
    ) {
        const empty =
            container.ownerDocument
                .createElement(
                    "div"
                );

        empty.className =
            "admin-dashboard-empty";

        empty.textContent =
            message;

        container.appendChild(
            empty
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

    function formatAddress(
        address
    ) {
        if (
            !address
        ) {
            return "—";
        }

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

    function createCustomerInitials(
        name,
        email
    ) {
        const normalizedName =
            String(
                name ||
                ""
            ).trim();

        if (
            normalizedName
        ) {
            const parts =
                normalizedName
                    .split(
                        /\s+/
                    )
                    .filter(
                        Boolean
                    );

            return (
                parts[0]
                    .charAt(
                        0
                    ) +
                (
                    parts.length >
                        1
                        ? parts[
                              parts.length -
                              1
                          ].charAt(
                              0
                          )
                        : ""
                )
            ).toUpperCase();
        }

        return String(
            email ||
            "C"
        )
            .charAt(
                0
            )
            .toUpperCase();
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

    function normalizeCustomersError(
        error,
        fallbackCode,
        fallbackMessage
    ) {
        if (
            error instanceof
            CustomersControllerError
        ) {
            return error;
        }

        return new CustomersControllerError(
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
                "Customers controller error.",
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

    function getCustomersController(
        options
    ) {
        if (
            options
        ) {
            return createCustomersController(
                options
            );
        }

        if (
            !defaultController
        ) {
            defaultController =
                createCustomersController();
        }

        return defaultController;
    }

    function resetCustomersController() {
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
            createCustomersController,
            getCustomersController,
            resetCustomersController,

            CustomersControllerError,

            normalizeCustomer,
            normalizeCustomerOrder,
            normalizeWishlistItems,
            normalizeAddress,
            normalizeAddresses,
            normalizeNotes,

            calculateCustomerMetrics,
            matchesCustomerSearch,
            matchesMarketingFilter,
            createCustomerComparator,
            inferCustomerType,

            normalizeControllerOptions,
            normalizeRequiredId,
            normalizeRequiredString,
            normalizeOptionalString,
            normalizeSearchTerm,
            normalizeCustomerStatus,
            normalizeCustomerType,
            normalizeMinorAmount,
            normalizePositiveInteger,
            normalizeNonNegativeInteger,
            normalizeCurrency,
            normalizeLocale,
            normalizeCollectionName,
            normalizeStringArray,
            normalizeFilterDate,

            parseCommaList,

            normalizeDateValue,
            formatCurrency,
            formatDate,

            createAnonymizedCustomerPatch,

            createCsv,
            escapeCsvValue,
            formatFileDate,

            formatAddress,
            createCustomerInitials,
            normalizeSortValue,
            titleCase,
            debounce,
            createRandomId,
            normalizeCustomersError,
            cloneValue,

            constants:
                Object.freeze({
                    DEFAULT_SELECTORS,
                    DEFAULT_CUSTOMERS_COLLECTION,
                    DEFAULT_ORDERS_COLLECTION,
                    DEFAULT_WISHLISTS_COLLECTION,
                    DEFAULT_PAGE_SIZE,
                    DEFAULT_QUERY_LIMIT,
                    DEFAULT_RELATED_QUERY_LIMIT,
                    DEFAULT_CURRENCY,
                    DEFAULT_LOCALE,
                    CUSTOMER_STATUSES,
                    CUSTOMER_TYPES
                })
        });

    global.LEternelCustomersController =
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