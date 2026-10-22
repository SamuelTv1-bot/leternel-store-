"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ADMIN PRODUCTS CONTROLLER

   Responsibilities:
   - Load and render Firestore products
   - Search, filter, sort, and paginate catalogue records
   - Create, edit, archive, publish, and delete products
   - Upload product images to Firebase Storage
   - Maintain product metrics and editor state
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
                "[data-admin-products]",

            createButton:
                "[data-product-create]",

            refreshButton:
                "[data-products-refresh]",

            clearFiltersButton:
                "[data-products-clear-filters]",

            searchInput:
                "[data-products-search]",

            statusFilter:
                "[data-products-status-filter]",

            categoryFilter:
                "[data-products-category-filter]",

            sortSelect:
                "[data-products-sort]",

            table:
                "[data-products-table]",

            totalMetric:
                "[data-products-total]",

            publishedMetric:
                "[data-products-published]",

            draftsMetric:
                "[data-products-drafts]",

            lowStockMetric:
                "[data-products-low-stock]",

            visibleCount:
                "[data-products-visible-count]",

            previousButton:
                "[data-products-previous]",

            nextButton:
                "[data-products-next]",

            pageLabel:
                "[data-products-page-label]",

            statusMessage:
                "[data-products-status]",

            loadingOverlay:
                "[data-products-loading]",

            loadingMessage:
                "[data-products-loading-message]",

            editor:
                "[data-product-editor]",

            editorClose:
                "[data-product-editor-close]",

            editorCancel:
                "[data-product-editor-cancel]",

            form:
                "[data-product-form]",

            productId:
                "[data-product-id]",

            name:
                "[data-product-name]",

            sku:
                "[data-product-sku]",

            slug:
                "[data-product-slug]",

            category:
                "[data-product-category]",

            collection:
                "[data-product-collection]",

            summary:
                "[data-product-summary]",

            description:
                "[data-product-description]",

            price:
                "[data-product-price]",

            comparePrice:
                "[data-product-compare-price]",

            currency:
                "[data-product-currency]",

            stock:
                "[data-product-stock]",

            lowStockThreshold:
                "[data-product-low-stock-threshold]",

            weight:
                "[data-product-weight]",

            imageFile:
                "[data-product-image-file]",

            imagePreview:
                "[data-product-image-preview]",

            imagePreviewElement:
                "[data-product-image-preview-element]",

            imageRemove:
                "[data-product-image-remove]",

            imageUrl:
                "[data-product-image-url]",

            imageAlt:
                "[data-product-image-alt]",

            gallery:
                "[data-product-gallery]",

            sizes:
                "[data-product-sizes]",

            colours:
                "[data-product-colours]",

            materials:
                "[data-product-materials]",

            tags:
                "[data-product-tags]",

            status:
                "[data-product-status]",

            visibility:
                "[data-product-visibility]",

            featured:
                "[data-product-featured]",

            newArrival:
                "[data-product-new-arrival]",

            seoTitle:
                "[data-product-seo-title]",

            seoDescription:
                "[data-product-seo-description]",

            editorialNote:
                "[data-product-editorial-note]",

            saveButton:
                "[data-product-save]",

            deleteModal:
                "[data-product-delete-modal]",

            deleteCancel:
                "[data-product-delete-cancel]",

            deleteConfirm:
                "[data-product-delete-confirm]"
        });

    const DEFAULT_COLLECTION =
        "products";

    const DEFAULT_STORAGE_FOLDER =
        "products";

    const DEFAULT_PAGE_SIZE =
        20;

    const DEFAULT_LOW_STOCK_THRESHOLD =
        5;

    const DEFAULT_CURRENCY =
        "GBP";

    const DEFAULT_LOCALE =
        "en-GB";

    const PRODUCT_STATUSES =
        Object.freeze([
            "draft",
            "published",
            "archived"
        ]);

    const PRODUCT_VISIBILITIES =
        Object.freeze([
            "public",
            "hidden"
        ]);

    /* ======================================================
       ERROR
    ====================================================== */

    class ProductsControllerError extends Error {
        constructor(
            code,
            message,
            options
        ) {
            super(
                message ||
                "Product operation failed."
            );

            this.name =
                "ProductsControllerError";

            this.code =
                code ||
                "products/unknown";

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

    function createProductsController(
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
            throw new ProductsControllerError(
                "products/document-unavailable",
                "Products controller requires a document."
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
            throw new ProductsControllerError(
                "products/root-unavailable",
                "Products admin root element was not found."
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

        const storage =
            settings.storage ||
            resolveStorage();

        const auth =
            settings.auth ||
            resolveAuth();

        if (
            !firestore ||
            typeof firestore.collection !==
                "function"
        ) {
            throw new ProductsControllerError(
                "products/firestore-unavailable",
                "Firestore is unavailable."
            );
        }

        const listeners =
            [];

        let initialized =
            false;

        let destroyed =
            false;

        let loading =
            false;

        let allProducts =
            [];

        let filteredProducts =
            [];

        let categories =
            [];

        let currentPage =
            1;

        let editorMode =
            "create";

        let editingProduct =
            null;

        let deletingProduct =
            null;

        let selectedImageFile =
            null;

        let removeExistingImage =
            false;

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

            await loadProducts();

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
                listeners.length
            ) {
                const dispose =
                    listeners.pop();

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

            closeEditor();
            closeDeleteModal();

            allProducts =
                [];

            filteredProducts =
                [];

            initialized =
                false;
        }

        function assertActive() {
            if (
                destroyed
            ) {
                throw new ProductsControllerError(
                    "products/destroyed",
                    "Products controller has been destroyed."
                );
            }
        }

        /* ==================================================
           LOAD PRODUCTS
        ================================================== */

        async function loadProducts() {
            assertActive();

            setLoading(
                true,
                "Loading products…"
            );

            setStatus(
                "Loading catalogue…",
                "loading"
            );

            try {
                let query =
                    firestore
                        .collection(
                            settings.collection
                        );

                if (
                    query &&
                    typeof query.orderBy ===
                        "function"
                ) {
                    query =
                        query.orderBy(
                            "updatedAt",
                            "desc"
                        );
                }

                const snapshot =
                    await query.get();

                allProducts =
                    mapSnapshotDocuments(
                        snapshot
                    )
                        .map(
                            normalizeProduct
                        );

                categories =
                    collectCategories(
                        allProducts
                    );

                renderCategoryOptions();

                applyFilters();

                renderMetrics();

                setStatus(
                    allProducts.length +
                    " product" +
                    (
                        allProducts.length ===
                            1
                            ? ""
                            : "s"
                    ) +
                    " loaded.",
                    "success"
                );

                return cloneValue(
                    allProducts
                );
            } catch (
                error
            ) {
                const normalized =
                    normalizeProductsError(
                        error,
                        "products/load-failed",
                        "Unable to load products."
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

            const category =
                getInputValue(
                    elements.categoryFilter
                ).toLowerCase();

            const sort =
                getInputValue(
                    elements.sortSelect
                ) ||
                "updatedAt-desc";

            filteredProducts =
                allProducts.filter(
                    function (
                        product
                    ) {
                        if (
                            status &&
                            product.status !==
                                status
                        ) {
                            return false;
                        }

                        if (
                            category &&
                            String(
                                product.category ||
                                ""
                            ).toLowerCase() !==
                                category
                        ) {
                            return false;
                        }

                        if (
                            search &&
                            !matchesProductSearch(
                                product,
                                search
                            )
                        ) {
                            return false;
                        }

                        return true;
                    }
                );

            filteredProducts.sort(
                createProductComparator(
                    sort
                )
            );

            const pageCount =
                getPageCount();

            if (
                currentPage >
                pageCount
            ) {
                currentPage =
                    pageCount;
            }

            if (
                currentPage <
                1
            ) {
                currentPage =
                    1;
            }

            renderProducts();
            renderPagination();

            setText(
                elements.visibleCount,
                filteredProducts.length
            );

            return cloneValue(
                filteredProducts
            );
        }

        function clearFilters() {
            if (
                elements.searchInput
            ) {
                elements.searchInput.value =
                    "";
            }

            if (
                elements.statusFilter
            ) {
                elements.statusFilter.value =
                    "";
            }

            if (
                elements.categoryFilter
            ) {
                elements.categoryFilter.value =
                    "";
            }

            if (
                elements.sortSelect
            ) {
                elements.sortSelect.value =
                    "updatedAt-desc";
            }

            currentPage =
                1;

            applyFilters();
        }

        function renderCategoryOptions() {
            const select =
                elements.categoryFilter;

            if (
                !select
            ) {
                return;
            }

            const existingValue =
                select.value;

            select.textContent =
                "";

            const allOption =
                documentObject
                    .createElement(
                        "option"
                    );

            allOption.value =
                "";

            allOption.textContent =
                "All categories";

            select.appendChild(
                allOption
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

                select.appendChild(
                    option
                );
            }

            if (
                Array.from(
                    select.options
                ).some(
                    function (
                        option
                    ) {
                        return option.value ===
                            existingValue;
                    }
                )
            ) {
                select.value =
                    existingValue;
            }
        }

        /* ==================================================
           METRICS
        ================================================== */

        function renderMetrics() {
            const metrics =
                calculateProductMetrics(
                    allProducts,
                    settings.lowStockThreshold
                );

            setText(
                elements.totalMetric,
                metrics.total
            );

            setText(
                elements.publishedMetric,
                metrics.published
            );

            setText(
                elements.draftsMetric,
                metrics.drafts
            );

            setText(
                elements.lowStockMetric,
                metrics.lowStock
            );

            return metrics;
        }

        /* ==================================================
           TABLE
        ================================================== */

        function renderProducts() {
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

            const products =
                getCurrentPageProducts();

            if (
                !products.length
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
                    filteredProducts.length
                        ? "No products on this page."
                        : "No matching products found.";

                row.appendChild(
                    cell
                );

                tbody.appendChild(
                    row
                );

                return;
            }

            for (
                const product of
                products
            ) {
                tbody.appendChild(
                    createProductRow(
                        product
                    )
                );
            }
        }

        function createProductRow(
            product
        ) {
            const row =
                documentObject
                    .createElement(
                        "tr"
                    );

            const productCell =
                documentObject
                    .createElement(
                        "td"
                    );

            const productInfo =
                documentObject
                    .createElement(
                        "div"
                    );

            productInfo.className =
                "admin-product-cell";

            if (
                product.imageUrl
            ) {
                const image =
                    documentObject
                        .createElement(
                            "img"
                        );

                image.className =
                    "admin-product-thumbnail";

                image.src =
                    product.imageUrl;

                image.alt =
                    product.imageAlt ||
                    product.name;

                productInfo.appendChild(
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
                    product.name
                        .charAt(
                            0
                        )
                        .toUpperCase();

                productInfo.appendChild(
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
                product.name;

            const detail =
                documentObject
                    .createElement(
                        "small"
                    );

            detail.textContent =
                product.collection ||
                product.slug ||
                product.id;

            copy.appendChild(
                name
            );

            copy.appendChild(
                detail
            );

            productInfo.appendChild(
                copy
            );

            productCell.appendChild(
                productInfo
            );

            row.appendChild(
                productCell
            );

            appendTextCell(
                row,
                product.sku ||
                "—"
            );

            appendTextCell(
                row,
                product.category ||
                "—"
            );

            const statusCell =
                appendTextCell(
                    row,
                    titleCase(
                        product.status
                    )
                );

            statusCell.dataset.status =
                product.status;

            appendTextCell(
                row,
                formatCurrency(
                    product.priceMinor,
                    product.currency,
                    settings.locale
                )
            );

            const stockCell =
                appendTextCell(
                    row,
                    product.stock
                );

            stockCell.dataset.status =
                product.stock <=
                    product.lowStockThreshold
                    ? product.stock <=
                        0
                        ? "critical"
                        : "low"
                    : "healthy";

            appendTextCell(
                row,
                formatDate(
                    product.updatedAt,
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
                    "Edit",
                    function () {
                        openEditor(
                            product
                        );
                    }
                )
            );

            if (
                product.status ===
                "published"
            ) {
                actions.appendChild(
                    createActionButton(
                        "Unpublish",
                        function () {
                            return updateProductStatus(
                                product.id,
                                "draft"
                            );
                        }
                    )
                );
            } else if (
                product.status !==
                "archived"
            ) {
                actions.appendChild(
                    createActionButton(
                        "Publish",
                        function () {
                            return updateProductStatus(
                                product.id,
                                "published"
                            );
                        }
                    )
                );
            }

            if (
                product.status !==
                "archived"
            ) {
                actions.appendChild(
                    createActionButton(
                        "Archive",
                        function () {
                            return updateProductStatus(
                                product.id,
                                "archived"
                            );
                        }
                    )
                );
            }

            actions.appendChild(
                createActionButton(
                    "Delete",
                    function () {
                        openDeleteModal(
                            product
                        );
                    },
                    "danger"
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
                8;

            cell.className =
                "admin-operation-empty";

            cell.textContent =
                message ||
                "No products found.";

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
                    filteredProducts.length /
                    settings.pageSize
                )
            );
        }

        function getCurrentPageProducts() {
            const start =
                (
                    currentPage -
                    1
                ) *
                settings.pageSize;

            return filteredProducts.slice(
                start,
                start +
                settings.pageSize
            );
        }

        function goToPreviousPage() {
            if (
                currentPage <=
                1
            ) {
                return;
            }

            currentPage -=
                1;

            renderProducts();
            renderPagination();
        }

        function goToNextPage() {
            if (
                currentPage >=
                getPageCount()
            ) {
                return;
            }

            currentPage +=
                1;

            renderProducts();
            renderPagination();
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
           EDITOR
        ================================================== */

        function openEditor(
            product
        ) {
            assertActive();

            editorMode =
                product
                    ? "edit"
                    : "create";

            editingProduct =
                product
                    ? cloneValue(
                          product
                      )
                    : null;

            selectedImageFile =
                null;

            removeExistingImage =
                false;

            populateForm(
                product ||
                createEmptyProduct()
            );

            if (
                elements.editor
            ) {
                elements.editor.classList.add(
                    "is-open"
                );

                elements.editor.setAttribute(
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

            if (
                elements.name
            ) {
                global.setTimeout(
                    function () {
                        elements.name.focus();
                    },
                    0
                );
            }
        }

        function closeEditor() {
            if (
                elements.editor
            ) {
                elements.editor.classList.remove(
                    "is-open"
                );

                elements.editor.setAttribute(
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

            editorMode =
                "create";

            editingProduct =
                null;

            selectedImageFile =
                null;

            removeExistingImage =
                false;

            resetForm();
        }

        function populateForm(
            product
        ) {
            setInputValue(
                elements.productId,
                product.id
            );

            setInputValue(
                elements.name,
                product.name
            );

            setInputValue(
                elements.sku,
                product.sku
            );

            setInputValue(
                elements.slug,
                product.slug
            );

            setInputValue(
                elements.category,
                product.category
            );

            setInputValue(
                elements.collection,
                product.collection
            );

            setInputValue(
                elements.summary,
                product.summary
            );

            setInputValue(
                elements.description,
                product.description
            );

            setInputValue(
                elements.price,
                minorToMajor(
                    product.priceMinor
                )
            );

            setInputValue(
                elements.comparePrice,
                product.compareAtPriceMinor !==
                    null
                    ? minorToMajor(
                          product.compareAtPriceMinor
                      )
                    : ""
            );

            setInputValue(
                elements.currency,
                product.currency ||
                settings.currency
            );

            setInputValue(
                elements.stock,
                product.stock
            );

            setInputValue(
                elements.lowStockThreshold,
                product.lowStockThreshold
            );

            setInputValue(
                elements.weight,
                product.weight
            );

            setInputValue(
                elements.imageUrl,
                product.imageUrl
            );

            setInputValue(
                elements.imageAlt,
                product.imageAlt
            );

            setInputValue(
                elements.gallery,
                product.gallery.join(
                    "\n"
                )
            );

            setInputValue(
                elements.sizes,
                product.sizes.join(
                    ", "
                )
            );

            setInputValue(
                elements.colours,
                product.colours.join(
                    ", "
                )
            );

            setInputValue(
                elements.materials,
                product.materials.join(
                    ", "
                )
            );

            setInputValue(
                elements.tags,
                product.tags.join(
                    ", "
                )
            );

            setInputValue(
                elements.status,
                product.status
            );

            setInputValue(
                elements.visibility,
                product.visibility
            );

            setChecked(
                elements.featured,
                product.featured
            );

            setChecked(
                elements.newArrival,
                product.newArrival
            );

            setInputValue(
                elements.seoTitle,
                product.seoTitle
            );

            setInputValue(
                elements.seoDescription,
                product.seoDescription
            );

            setInputValue(
                elements.editorialNote,
                product.editorialNote
            );

            renderImagePreview(
                product.imageUrl,
                product.imageAlt ||
                product.name
            );
        }

        function resetForm() {
            if (
                elements.form &&
                typeof elements.form.reset ===
                    "function"
            ) {
                elements.form.reset();
            }

            setInputValue(
                elements.productId,
                ""
            );

            setInputValue(
                elements.currency,
                settings.currency
            );

            setInputValue(
                elements.status,
                "draft"
            );

            setInputValue(
                elements.visibility,
                "public"
            );

            setInputValue(
                elements.lowStockThreshold,
                settings.lowStockThreshold
            );

            renderImagePreview(
                null
            );
        }

        async function submitForm(
            event
        ) {
            if (
                event
            ) {
                event.preventDefault();
            }

            assertActive();

            const payload =
                collectFormData();

            validateProductPayload(
                payload
            );

            setButtonBusy(
                elements.saveButton,
                true
            );

            setLoading(
                true,
                editorMode ===
                    "edit"
                    ? "Updating product…"
                    : "Creating product…"
            );

            try {
                let productId =
                    editingProduct &&
                    editingProduct.id
                        ? editingProduct.id
                        : null;

                if (
                    !productId
                ) {
                    productId =
                        firestore
                            .collection(
                                settings.collection
                            )
                            .doc()
                            .id;
                }

                if (
                    selectedImageFile
                ) {
                    const upload =
                        await uploadProductImage(
                            productId,
                            selectedImageFile
                        );

                    payload.imageUrl =
                        upload.url;

                    payload.imagePath =
                        upload.path;
                } else if (
                    removeExistingImage
                ) {
                    payload.imageUrl =
                        null;

                    payload.imagePath =
                        null;
                } else if (
                    editingProduct
                ) {
                    payload.imagePath =
                        editingProduct.imagePath ||
                        null;
                }

                const now =
                    createServerTimestamp();

                const record =
                    Object.assign(
                        {},
                        payload,
                        {
                            id:
                                productId,

                            updatedAt:
                                now,

                            updatedBy:
                                getCurrentUserId(
                                    auth
                                ),

                            schemaVersion:
                                1
                        }
                    );

                if (
                    editorMode ===
                    "create"
                ) {
                    record.createdAt =
                        now;

                    record.createdBy =
                        getCurrentUserId(
                            auth
                        );
                }

                await firestore
                    .collection(
                        settings.collection
                    )
                    .doc(
                        productId
                    )
                    .set(
                        record,
                        {
                            merge:
                                editorMode ===
                                "edit"
                        }
                    );

                setStatus(
                    editorMode ===
                        "edit"
                        ? "Product updated."
                        : "Product created.",
                    "success"
                );

                closeEditor();

                await loadProducts();

                return productId;
            } catch (
                error
            ) {
                const normalized =
                    normalizeProductsError(
                        error,
                        "products/save-failed",
                        "Unable to save product."
                    );

                setStatus(
                    normalized.message,
                    "error"
                );

                throw normalized;
            } finally {
                setButtonBusy(
                    elements.saveButton,
                    false
                );

                setLoading(
                    false
                );
            }
        }

        function collectFormData() {
            const name =
                getInputValue(
                    elements.name
                );

            const suppliedSlug =
                getInputValue(
                    elements.slug
                );

            const price =
                normalizeMoneyInput(
                    getInputValue(
                        elements.price
                    ),
                    "Price"
                );

            const comparePriceValue =
                getInputValue(
                    elements.comparePrice
                );

            const stock =
                normalizeNonNegativeInteger(
                    getInputValue(
                        elements.stock
                    ),
                    0,
                    "Stock"
                );

            const lowStockThreshold =
                normalizeNonNegativeInteger(
                    getInputValue(
                        elements.lowStockThreshold
                    ),
                    settings.lowStockThreshold,
                    "Low-stock threshold"
                );

            return {
                name:
                    name,

                nameLower:
                    name.toLowerCase(),

                sku:
                    normalizeOptionalString(
                        getInputValue(
                            elements.sku
                        )
                    ),

                slug:
                    normalizeSlug(
                        suppliedSlug ||
                        name
                    ),

                category:
                    normalizeOptionalString(
                        getInputValue(
                            elements.category
                        )
                    ),

                collection:
                    normalizeOptionalString(
                        getInputValue(
                            elements.collection
                        )
                    ),

                summary:
                    normalizeOptionalString(
                        getInputValue(
                            elements.summary
                        )
                    ),

                description:
                    normalizeOptionalString(
                        getInputValue(
                            elements.description
                        )
                    ),

                priceMinor:
                    majorToMinor(
                        price
                    ),

                compareAtPriceMinor:
                    comparePriceValue
                        ? majorToMinor(
                              normalizeMoneyInput(
                                  comparePriceValue,
                                  "Compare-at price"
                              )
                          )
                        : null,

                currency:
                    normalizeCurrency(
                        getInputValue(
                            elements.currency
                        ) ||
                        settings.currency
                    ),

                stock:
                    stock,

                inStock:
                    stock >
                    0,

                lowStockThreshold:
                    lowStockThreshold,

                weight:
                    normalizeOptionalNumber(
                        getInputValue(
                            elements.weight
                        )
                    ),

                imageUrl:
                    normalizeOptionalString(
                        getInputValue(
                            elements.imageUrl
                        )
                    ),

                imageAlt:
                    normalizeOptionalString(
                        getInputValue(
                            elements.imageAlt
                        )
                    ),

                gallery:
                    parseLineList(
                        getInputValue(
                            elements.gallery
                        )
                    ),

                sizes:
                    parseCommaList(
                        getInputValue(
                            elements.sizes
                        )
                    ),

                colours:
                    parseCommaList(
                        getInputValue(
                            elements.colours
                        )
                    ),

                materials:
                    parseCommaList(
                        getInputValue(
                            elements.materials
                        )
                    ),

                tags:
                    parseCommaList(
                        getInputValue(
                            elements.tags
                        )
                    ),

                status:
                    normalizeProductStatus(
                        getInputValue(
                            elements.status
                        )
                    ),

                visibility:
                    normalizeProductVisibility(
                        getInputValue(
                            elements.visibility
                        )
                    ),

                featured:
                    getChecked(
                        elements.featured
                    ),

                newArrival:
                    getChecked(
                        elements.newArrival
                    ),

                seoTitle:
                    normalizeOptionalString(
                        getInputValue(
                            elements.seoTitle
                        )
                    ),

                seoDescription:
                    normalizeOptionalString(
                        getInputValue(
                            elements.seoDescription
                        )
                    ),

                editorialNote:
                    normalizeOptionalString(
                        getInputValue(
                            elements.editorialNote
                        )
                    ),

                publishedAt:
                    getInputValue(
                        elements.status
                    ) ===
                    "published"
                        ? (
                              editingProduct &&
                              editingProduct.publishedAt
                                  ? editingProduct.publishedAt
                                  : createServerTimestamp()
                          )
                        : null
            };
        }

        function validateProductPayload(
            product
        ) {
            if (
                !product.name
            ) {
                throw new ProductsControllerError(
                    "products/name-required",
                    "Product name is required."
                );
            }

            if (
                !product.slug
            ) {
                throw new ProductsControllerError(
                    "products/slug-required",
                    "Product slug is required."
                );
            }

            if (
                product.priceMinor <
                0
            ) {
                throw new ProductsControllerError(
                    "products/invalid-price",
                    "Product price cannot be negative."
                );
            }

            if (
                product.compareAtPriceMinor !==
                    null &&
                product.compareAtPriceMinor <
                    product.priceMinor
            ) {
                throw new ProductsControllerError(
                    "products/invalid-compare-price",
                    "Compare-at price cannot be lower than the product price."
                );
            }

            return true;
        }

        /* ==================================================
           IMAGE
        ================================================== */

        function handleImageFileChange() {
            const file =
                elements.imageFile &&
                elements.imageFile.files
                    ? elements.imageFile.files[0]
                    : null;

            if (
                !file
            ) {
                selectedImageFile =
                    null;

                return;
            }

            validateImageFile(
                file,
                settings.maxImageBytes
            );

            selectedImageFile =
                file;

            removeExistingImage =
                false;

            const url =
                global.URL &&
                typeof global.URL.createObjectURL ===
                    "function"
                    ? global.URL.createObjectURL(
                          file
                      )
                    : null;

            renderImagePreview(
                url,
                file.name
            );
        }

        function removeImage() {
            selectedImageFile =
                null;

            removeExistingImage =
                true;

            if (
                elements.imageFile
            ) {
                elements.imageFile.value =
                    "";
            }

            setInputValue(
                elements.imageUrl,
                ""
            );

            renderImagePreview(
                null
            );
        }

        function renderImagePreview(
            url,
            alt
        ) {
            if (
                !elements.imagePreview ||
                !elements.imagePreviewElement
            ) {
                return;
            }

            if (
                !url
            ) {
                elements.imagePreview.hidden =
                    true;

                elements.imagePreviewElement.src =
                    "";

                elements.imagePreviewElement.alt =
                    "";

                return;
            }

            elements.imagePreview.hidden =
                false;

            elements.imagePreviewElement.src =
                url;

            elements.imagePreviewElement.alt =
                alt ||
                "Product image preview";
        }

        async function uploadProductImage(
            productId,
            file
        ) {
            if (
                !storage ||
                typeof storage.ref !==
                    "function"
            ) {
                throw new ProductsControllerError(
                    "products/storage-unavailable",
                    "Firebase Storage is unavailable."
                );
            }

            validateImageFile(
                file,
                settings.maxImageBytes
            );

            const extension =
                getFileExtension(
                    file.name
                ) ||
                getExtensionFromMimeType(
                    file.type
                ) ||
                "jpg";

            const filename =
                Date.now() +
                "-" +
                createRandomToken() +
                "." +
                extension;

            const path =
                [
                    settings.storageFolder,
                    productId,
                    filename
                ].join(
                    "/"
                );

            const reference =
                storage.ref(
                    path
                );

            const snapshot =
                await reference.put(
                    file,
                    {
                        contentType:
                            file.type,

                        customMetadata: {
                            productId:
                                productId
                        }
                    }
                );

            const downloadReference =
                snapshot &&
                snapshot.ref
                    ? snapshot.ref
                    : reference;

            const url =
                await downloadReference
                    .getDownloadURL();

            return {
                path,
                url
            };
        }

        /* ==================================================
           STATUS UPDATES
        ================================================== */

        async function updateProductStatus(
            productId,
            status
        ) {
            const normalizedId =
                normalizeRequiredId(
                    productId,
                    "Product ID"
                );

            const normalizedStatus =
                normalizeProductStatus(
                    status
                );

            setLoading(
                true,
                "Updating product status…"
            );

            try {
                const patch = {
                    status:
                        normalizedStatus,

                    updatedAt:
                        createServerTimestamp(),

                    updatedBy:
                        getCurrentUserId(
                            auth
                        )
                };

                if (
                    normalizedStatus ===
                    "published"
                ) {
                    patch.publishedAt =
                        createServerTimestamp();
                }

                await firestore
                    .collection(
                        settings.collection
                    )
                    .doc(
                        normalizedId
                    )
                    .set(
                        patch,
                        {
                            merge:
                                true
                        }
                    );

                setStatus(
                    "Product status updated.",
                    "success"
                );

                await loadProducts();

                return true;
            } catch (
                error
            ) {
                const normalized =
                    normalizeProductsError(
                        error,
                        "products/status-update-failed",
                        "Unable to update product status."
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
           DELETE
        ================================================== */

        function openDeleteModal(
            product
        ) {
            deletingProduct =
                product
                    ? cloneValue(
                          product
                      )
                    : null;

            if (
                !elements.deleteModal
            ) {
                return;
            }

            elements.deleteModal.hidden =
                false;

            elements.deleteModal.setAttribute(
                "aria-hidden",
                "false"
            );

            documentObject
                .documentElement
                .classList
                .add(
                    "admin-modal-open"
                );
        }

        function closeDeleteModal() {
            deletingProduct =
                null;

            if (
                elements.deleteModal
            ) {
                elements.deleteModal.hidden =
                    true;

                elements.deleteModal.setAttribute(
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

        async function confirmDelete() {
            if (
                !deletingProduct
            ) {
                return false;
            }

            const product =
                cloneValue(
                    deletingProduct
                );

            setButtonBusy(
                elements.deleteConfirm,
                true
            );

            setLoading(
                true,
                "Deleting product…"
            );

            try {
                await firestore
                    .collection(
                        settings.collection
                    )
                    .doc(
                        product.id
                    )
                    .delete();

                if (
                    product.imagePath &&
                    storage &&
                    typeof storage.ref ===
                        "function"
                ) {
                    try {
                        await storage
                            .ref(
                                product.imagePath
                            )
                            .delete();
                    } catch (
                        error
                    ) {
                        reportError(
                            error
                        );
                    }
                }

                closeDeleteModal();

                setStatus(
                    "Product deleted.",
                    "success"
                );

                await loadProducts();

                return true;
            } catch (
                error
            ) {
                const normalized =
                    normalizeProductsError(
                        error,
                        "products/delete-failed",
                        "Unable to delete product."
                    );

                setStatus(
                    normalized.message,
                    "error"
                );

                throw normalized;
            } finally {
                setButtonBusy(
                    elements.deleteConfirm,
                    false
                );

                setLoading(
                    false
                );
            }
        }

        /* ==================================================
           EVENTS
        ================================================== */

        function bindEvents() {
            bindClick(
                elements.createButton,
                function () {
                    openEditor();
                }
            );

            bindClick(
                elements.refreshButton,
                loadProducts
            );

            bindClick(
                elements.clearFiltersButton,
                clearFilters
            );

            bindInput(
                elements.searchInput,
                debounce(
                    function () {
                        currentPage =
                            1;

                        applyFilters();
                    },
                    200
                )
            );

            bindChange(
                elements.statusFilter,
                resetPageAndFilter
            );

            bindChange(
                elements.categoryFilter,
                resetPageAndFilter
            );

            bindChange(
                elements.sortSelect,
                resetPageAndFilter
            );

            bindClick(
                elements.previousButton,
                goToPreviousPage
            );

            bindClick(
                elements.nextButton,
                goToNextPage
            );

            bindClick(
                elements.editorClose,
                closeEditor
            );

            bindClick(
                elements.editorCancel,
                closeEditor
            );

            bindSubmit(
                elements.form,
                submitForm
            );

            bindChange(
                elements.imageFile,
                handleImageFileChange
            );

            bindClick(
                elements.imageRemove,
                removeImage
            );

            bindClick(
                elements.deleteCancel,
                closeDeleteModal,
                true
            );

            bindClick(
                elements.deleteConfirm,
                confirmDelete
            );

            if (
                elements.name
            ) {
                const listener =
                    function () {
                        if (
                            !elements.slug ||
                            elements.slug.dataset
                                .manual ===
                                "true"
                        ) {
                            return;
                        }

                        elements.slug.value =
                            normalizeSlug(
                                elements.name.value
                            );
                    };

                elements.name.addEventListener(
                    "input",
                    listener
                );

                listeners.push(
                    function () {
                        elements.name.removeEventListener(
                            "input",
                            listener
                        );
                    }
                );
            }

            if (
                elements.slug
            ) {
                const listener =
                    function () {
                        elements.slug.dataset.manual =
                            elements.slug.value
                                .trim()
                                ? "true"
                                : "false";
                    };

                elements.slug.addEventListener(
                    "input",
                    listener
                );

                listeners.push(
                    function () {
                        elements.slug.removeEventListener(
                            "input",
                            listener
                        );
                    }
                );
            }

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
                        elements.deleteModal &&
                        !elements.deleteModal.hidden
                    ) {
                        closeDeleteModal();

                        return;
                    }

                    if (
                        elements.editor &&
                        elements.editor.classList
                            .contains(
                                "is-open"
                            )
                    ) {
                        closeEditor();
                    }
                };

            documentObject.addEventListener(
                "keydown",
                keydownListener
            );

            listeners.push(
                function () {
                    documentObject.removeEventListener(
                        "keydown",
                        keydownListener
                    );
                }
            );
        }

        function resetPageAndFilter() {
            currentPage =
                1;

            applyFilters();
        }

        function bindClick(
            element,
            handler,
            multiple
        ) {
            const elementsToBind =
                multiple
                    ? Array.from(
                          documentObject
                              .querySelectorAll(
                                  settings.selectors
                                      .deleteCancel
                              )
                      )
                    : element
                        ? [
                              element
                          ]
                        : [];

            for (
                const currentElement of
                elementsToBind
            ) {
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

                currentElement.addEventListener(
                    "click",
                    listener
                );

                listeners.push(
                    function () {
                        currentElement.removeEventListener(
                            "click",
                            listener
                        );
                    }
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

            listeners.push(
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

            listeners.push(
                function () {
                    element.removeEventListener(
                        "change",
                        handler
                    );
                }
            );
        }

        function bindSubmit(
            element,
            handler
        ) {
            if (
                !element
            ) {
                return;
            }

            element.addEventListener(
                "submit",
                handler
            );

            listeners.push(
                function () {
                    element.removeEventListener(
                        "submit",
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
                elements.loadingMessage &&
                message
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
           SNAPSHOT
        ================================================== */

        function getSnapshot() {
            return {
                initialized,
                destroyed,
                loading,
                editorMode,
                currentPage,
                pageCount:
                    getPageCount(),

                totalProducts:
                    allProducts.length,

                visibleProducts:
                    filteredProducts.length,

                categories:
                    cloneValue(
                        categories
                    ),

                editingProduct:
                    cloneValue(
                        editingProduct
                    ),

                deletingProduct:
                    cloneValue(
                        deletingProduct
                    )
            };
        }

        /* ==================================================
           CONTROLLER
        ================================================== */

        const controller =
            Object.freeze({
                init,
                destroy,

                loadProducts,
                applyFilters,
                clearFilters,

                openEditor,
                closeEditor,
                submitForm,

                updateProductStatus,

                openDeleteModal,
                closeDeleteModal,
                confirmDelete,

                goToPreviousPage,
                goToNextPage,

                renderProducts,
                renderMetrics,
                renderPagination,

                getSnapshot,

                get products() {
                    return cloneValue(
                        allProducts
                    );
                },

                get filteredProducts() {
                    return cloneValue(
                        filteredProducts
                    );
                },

                elements,
                options:
                    settings
            });

        return controller;
    }

    /* ======================================================
       PRODUCT NORMALIZATION
    ====================================================== */

    function normalizeProduct(
        input
    ) {
        const source =
            input ||
            {};

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

            slug:
                normalizeSlug(
                    source.slug ||
                    source.name ||
                    source.id
                ),

            category:
                normalizeOptionalString(
                    source.category
                ),

            collection:
                normalizeOptionalString(
                    source.collection
                ),

            summary:
                normalizeOptionalString(
                    source.summary ||
                    source.shortDescription
                ),

            description:
                normalizeOptionalString(
                    source.description
                ),

            priceMinor:
                normalizeMinorAmount(
                    source.priceMinor !==
                        undefined
                        ? source.priceMinor
                        : source.price
                ),

            compareAtPriceMinor:
                source.compareAtPriceMinor !==
                    undefined &&
                source.compareAtPriceMinor !==
                    null
                    ? normalizeMinorAmount(
                          source.compareAtPriceMinor
                      )
                    : null,

            currency:
                normalizeCurrency(
                    source.currency ||
                    DEFAULT_CURRENCY
                ),

            stock:
                normalizeNonNegativeInteger(
                    source.stock !==
                        undefined
                        ? source.stock
                        : source.quantity,
                    0,
                    "Stock"
                ),

            lowStockThreshold:
                normalizeNonNegativeInteger(
                    source.lowStockThreshold,
                    DEFAULT_LOW_STOCK_THRESHOLD,
                    "Low-stock threshold"
                ),

            weight:
                normalizeOptionalNumber(
                    source.weight
                ),

            imageUrl:
                normalizeOptionalString(
                    source.imageUrl ||
                    source.image
                ),

            imagePath:
                normalizeOptionalString(
                    source.imagePath
                ),

            imageAlt:
                normalizeOptionalString(
                    source.imageAlt
                ),

            gallery:
                normalizeStringArray(
                    source.gallery
                ),

            sizes:
                normalizeStringArray(
                    source.sizes
                ),

            colours:
                normalizeStringArray(
                    source.colours ||
                    source.colors
                ),

            materials:
                normalizeStringArray(
                    source.materials
                ),

            tags:
                normalizeStringArray(
                    source.tags
                ),

            status:
                normalizeProductStatus(
                    source.status ||
                    "draft"
                ),

            visibility:
                normalizeProductVisibility(
                    source.visibility ||
                    "public"
                ),

            featured:
                Boolean(
                    source.featured
                ),

            newArrival:
                Boolean(
                    source.newArrival
                ),

            seoTitle:
                normalizeOptionalString(
                    source.seoTitle
                ),

            seoDescription:
                normalizeOptionalString(
                    source.seoDescription
                ),

            editorialNote:
                normalizeOptionalString(
                    source.editorialNote
                ),

            createdAt:
                normalizeDateValue(
                    source.createdAt
                ),

            updatedAt:
                normalizeDateValue(
                    source.updatedAt ||
                    source.createdAt
                ),

            publishedAt:
                normalizeDateValue(
                    source.publishedAt
                )
        };
    }

    function createEmptyProduct() {
        return {
            id:
                "",

            name:
                "",

            sku:
                "",

            slug:
                "",

            category:
                "",

            collection:
                "",

            summary:
                "",

            description:
                "",

            priceMinor:
                0,

            compareAtPriceMinor:
                null,

            currency:
                DEFAULT_CURRENCY,

            stock:
                0,

            lowStockThreshold:
                DEFAULT_LOW_STOCK_THRESHOLD,

            weight:
                null,

            imageUrl:
                "",

            imagePath:
                "",

            imageAlt:
                "",

            gallery:
                [],

            sizes:
                [],

            colours:
                [],

            materials:
                [],

            tags:
                [],

            status:
                "draft",

            visibility:
                "public",

            featured:
                false,

            newArrival:
                false,

            seoTitle:
                "",

            seoDescription:
                "",

            editorialNote:
                "",

            publishedAt:
                null
        };
    }

    /* ======================================================
       METRICS AND SEARCH
    ====================================================== */

    function calculateProductMetrics(
        products,
        lowStockThreshold
    ) {
        const rows =
            Array.isArray(
                products
            )
                ? products
                : [];

        const threshold =
            normalizeNonNegativeInteger(
                lowStockThreshold,
                DEFAULT_LOW_STOCK_THRESHOLD,
                "Low-stock threshold"
            );

        return {
            total:
                rows.length,

            published:
                rows.filter(
                    function (
                        product
                    ) {
                        return product.status ===
                            "published";
                    }
                ).length,

            drafts:
                rows.filter(
                    function (
                        product
                    ) {
                        return product.status ===
                            "draft";
                    }
                ).length,

            archived:
                rows.filter(
                    function (
                        product
                    ) {
                        return product.status ===
                            "archived";
                    }
                ).length,

            lowStock:
                rows.filter(
                    function (
                        product
                    ) {
                        return product.stock <=
                            (
                                product.lowStockThreshold !==
                                    undefined
                                    ? product.lowStockThreshold
                                    : threshold
                            );
                    }
                ).length
        };
    }

    function matchesProductSearch(
        product,
        searchTerm
    ) {
        const haystack =
            [
                product.name,
                product.sku,
                product.slug,
                product.category,
                product.collection,
                product.summary,
                product.description
            ]
                .concat(
                    product.tags ||
                    []
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
                searchTerm
            )
        );
    }

    function createProductComparator(
        sortValue
    ) {
        const [
            field,
            direction
        ] =
            String(
                sortValue ||
                "updatedAt-desc"
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
                return 1 *
                    multiplier;
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
        products
    ) {
        return Array.from(
            new Set(
                (
                    Array.isArray(
                        products
                    )
                        ? products
                        : []
                )
                    .map(
                        function (
                            product
                        ) {
                            return normalizeOptionalString(
                                product.category
                            );
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

            storage:
                source.storage ||
                null,

            auth:
                source.auth ||
                null,

            collection:
                normalizeCollectionName(
                    source.collection,
                    DEFAULT_COLLECTION
                ),

            storageFolder:
                normalizeStorageFolder(
                    source.storageFolder,
                    DEFAULT_STORAGE_FOLDER
                ),

            pageSize:
                normalizePositiveInteger(
                    source.pageSize,
                    DEFAULT_PAGE_SIZE,
                    "Page size"
                ),

            lowStockThreshold:
                normalizeNonNegativeInteger(
                    source.lowStockThreshold,
                    DEFAULT_LOW_STOCK_THRESHOLD,
                    "Low-stock threshold"
                ),

            maxImageBytes:
                normalizePositiveInteger(
                    source.maxImageBytes,
                    10 *
                    1024 *
                    1024,
                    "Maximum image size"
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
       GENERAL NORMALIZERS
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
            throw new ProductsControllerError(
                "products/invalid-id",
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
            throw new ProductsControllerError(
                "products/invalid-string",
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

    function normalizeSlug(
        value
    ) {
        return String(
            value ||
            ""
        )
            .trim()
            .toLowerCase()
            .normalize(
                "NFD"
            )
            .replace(
                /[\u0300-\u036f]/g,
                ""
            )
            .replace(
                /[^a-z0-9]+/g,
                "-"
            )
            .replace(
                /^-+|-+$/g,
                ""
            )
            .replace(
                /-{2,}/g,
                "-"
            );
    }

    function normalizeProductStatus(
        value
    ) {
        const normalized =
            String(
                value ||
                "draft"
            )
                .trim()
                .toLowerCase();

        if (
            !PRODUCT_STATUSES.includes(
                normalized
            )
        ) {
            throw new ProductsControllerError(
                "products/invalid-status",
                "Product status is invalid."
            );
        }

        return normalized;
    }

    function normalizeProductVisibility(
        value
    ) {
        const normalized =
            String(
                value ||
                "public"
            )
                .trim()
                .toLowerCase();

        if (
            !PRODUCT_VISIBILITIES.includes(
                normalized
            )
        ) {
            throw new ProductsControllerError(
                "products/invalid-visibility",
                "Product visibility is invalid."
            );
        }

        return normalized;
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

        return normalized ||
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

    function normalizeStorageFolder(
        value,
        fallback
    ) {
        const normalized =
            String(
                value ||
                fallback
            )
                .trim()
                .replace(
                    /^\/+|\/+$/g,
                    ""
                );

        if (
            !normalized
        ) {
            throw new TypeError(
                "Storage folder is required."
            );
        }

        return normalized;
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

    function normalizeOptionalNumber(
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
            return null;
        }

        const normalized =
            Number(
                value
            );

        if (
            !Number.isFinite(
                normalized
            )
        ) {
            throw new TypeError(
                "Numeric value is invalid."
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
            throw new ProductsControllerError(
                "products/invalid-money",
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
       PARSERS
    ====================================================== */

    function parseCommaList(
        value
    ) {
        return String(
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
                    return item.trim();
                }
            )
            .filter(
                Boolean
            );
    }

    function parseLineList(
        value
    ) {
        return String(
            value ||
            ""
        )
            .split(
                /\r?\n/
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

    /* ======================================================
       MONEY AND DATE
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

    function minorToMajor(
        value
    ) {
        return (
            normalizeMinorAmount(
                value
            ) /
            100
        ).toFixed(
            2
        );
    }

    function formatCurrency(
        minorAmount,
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
                        minorAmount
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
                        minorAmount
                    ) /
                    100
                ).toFixed(
                    2
                )
            );
        }
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

    function resolveStorage() {
        if (
            global.firebase &&
            typeof global.firebase
                .storage ===
                "function"
        ) {
            return global.firebase
                .storage();
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
        auth.currentUser &&
        auth.currentUser.uid
            ? auth.currentUser.uid
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
                    documentSnapshot &&
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
       IMAGE VALIDATION
    ====================================================== */

    function validateImageFile(
        file,
        maxBytes
    ) {
        if (
            !file
        ) {
            throw new ProductsControllerError(
                "products/image-required",
                "Image file is required."
            );
        }

        const allowedTypes = [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/avif"
        ];

        if (
            !allowedTypes.includes(
                file.type
            )
        ) {
            throw new ProductsControllerError(
                "products/invalid-image-type",
                "Image must be JPEG, PNG, WebP, or AVIF."
            );
        }

        if (
            Number(
                file.size
            ) >
            maxBytes
        ) {
            throw new ProductsControllerError(
                "products/image-too-large",
                "Image file is too large."
            );
        }

        return true;
    }

    function getFileExtension(
        filename
    ) {
        const match =
            String(
                filename ||
                ""
            ).match(
                /\.([a-zA-Z0-9]+)$/
            );

        return match
            ? match[1]
                .toLowerCase()
            : null;
    }

    function getExtensionFromMimeType(
        mimeType
    ) {
        const map = {
            "image/jpeg":
                "jpg",

            "image/png":
                "png",

            "image/webp":
                "webp",

            "image/avif":
                "avif"
        };

        return map[
            mimeType
        ] ||
            null;
    }

    function createRandomToken() {
        if (
            global.crypto &&
            typeof global.crypto
                .randomUUID ===
                "function"
        ) {
            return global.crypto
                .randomUUID()
                .replace(
                    /-/g,
                    ""
                )
                .slice(
                    0,
                    16
                );
        }

        return Math.random()
            .toString(
                36
            )
            .slice(
                2,
                18
            );
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

    function createActionButton(
        label,
        handler,
        type
    ) {
        const button =
            document
                .createElement(
                    "button"
                );

        button.type =
            "button";

        button.className =
            "admin-operation-action";

        if (
            type ===
            "danger"
        ) {
            button.classList.add(
                "admin-operation-action-danger"
            );
        }

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

    function getChecked(
        element
    ) {
        return Boolean(
            element &&
            element.checked
        );
    }

    function setChecked(
        element,
        checked
    ) {
        if (
            element
        ) {
            element.checked =
                Boolean(
                    checked
                );
        }
    }

    function setText(
        element,
        value
    ) {
        if (
            element
        ) {
            element.textContent =
                String(
                    value ===
                        undefined ||
                    value ===
                        null
                        ? "—"
                        : value
                );
        }
    }

    /* ======================================================
       MISCELLANEOUS
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

        const date =
            Date.parse(
                value
            );

        if (
            Number.isFinite(
                date
            ) &&
            String(
                value
            ).includes(
                "-"
            )
        ) {
            return date;
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

    function normalizeProductsError(
        error,
        fallbackCode,
        fallbackMessage
    ) {
        if (
            error instanceof
            ProductsControllerError
        ) {
            return error;
        }

        return new ProductsControllerError(
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
                "Products controller error.",
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

    function getProductsController(
        options
    ) {
        if (
            options
        ) {
            return createProductsController(
                options
            );
        }

        if (
            !defaultController
        ) {
            defaultController =
                createProductsController();
        }

        return defaultController;
    }

    function resetProductsController() {
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
            createProductsController,
            getProductsController,
            resetProductsController,

            ProductsControllerError,

            normalizeProduct,
            createEmptyProduct,
            calculateProductMetrics,
            matchesProductSearch,
            createProductComparator,
            collectCategories,

            normalizeControllerOptions,
            normalizeRequiredId,
            normalizeRequiredString,
            normalizeOptionalString,
            normalizeSearchTerm,
            normalizeSlug,
            normalizeProductStatus,
            normalizeProductVisibility,
            normalizeCurrency,
            normalizeLocale,
            normalizeCollectionName,
            normalizeStorageFolder,
            normalizePositiveInteger,
            normalizeNonNegativeInteger,
            normalizeMinorAmount,
            normalizeOptionalNumber,
            normalizeStringArray,
            normalizeMoneyInput,

            parseCommaList,
            parseLineList,

            majorToMinor,
            minorToMajor,
            formatCurrency,
            normalizeDateValue,
            formatDate,

            mapSnapshotDocuments,
            validateImageFile,
            getFileExtension,
            getExtensionFromMimeType,
            createRandomToken,
            normalizeSortValue,
            titleCase,
            debounce,
            normalizeProductsError,
            cloneValue,

            constants:
                Object.freeze({
                    DEFAULT_SELECTORS,
                    DEFAULT_COLLECTION,
                    DEFAULT_STORAGE_FOLDER,
                    DEFAULT_PAGE_SIZE,
                    DEFAULT_LOW_STOCK_THRESHOLD,
                    DEFAULT_CURRENCY,
                    DEFAULT_LOCALE,
                    PRODUCT_STATUSES,
                    PRODUCT_VISIBILITIES
                })
        });

    global.LEternelProductsController =
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