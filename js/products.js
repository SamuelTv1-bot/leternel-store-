//javascript
"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   PRODUCTS & CATALOG MODULE — FIREBASE V8
========================================================== */

(function initializeProductsModule() {
    const app = window.LEternelApp;
    const router = window.LEternelRouter;
    const services = window.FirebaseServices;

    if (!app) {
        throw new Error(
            "LEternelApp was not found. Load app.js before products.js."
        );
    }

    if (!services || !services.db) {
        throw new Error(
            "Firebase services were not found. Load firebase.js before products.js."
        );
    }

    const db = services.db;
    const serverTimestamp = services.helpers.serverTimestamp;

    const Products = {
        initialized: false,

        config: {
            collection: "products",
            categoriesCollection: "categories",
            reviewsCollection: "reviews",
            pageSize: 12,
            featuredLimit: 8,
            relatedLimit: 4,
            recentlyViewedLimit: 8,
            recentlyViewedStorageKey: "leternel_recently_viewed",
            defaultCurrency: "NGN",
            defaultLocale: "en-NG"
        },

        state: {
            products: [],
            featuredProducts: [],
            categories: [],
            currentProduct: null,
            currentPage: 1,
            totalPages: 1,
            totalProducts: 0,
            lastVisible: null,
            firstVisible: null,
            pageCursors: {},
            loading: false,
            filters: {
                category: "",
                collection: "",
                sizes: [],
                colors: [],
                minPrice: null,
                maxPrice: null,
                inStock: false,
                featured: false,
                search: ""
            },
            sort: "featured"
        },

        elements: {}
    };

    /* ======================================================
       DOM HELPERS
    ====================================================== */

    function query(selector, parent) {
        return (parent || document).querySelector(selector);
    }

    function queryAll(selector, parent) {
        return Array.prototype.slice.call(
            (parent || document).querySelectorAll(selector)
        );
    }

    function getById(id) {
        return document.getElementById(id);
    }

    function escapeHTML(value) {
        return app.utils.escapeHTML(value);
    }

    function toArray(value) {
        return Array.isArray(value) ? value : [];
    }

    function toNumber(value, fallback) {
        const number = Number(value);

        return Number.isFinite(number)
            ? number
            : Number(fallback) || 0;
    }

    function debounce(callback, delay) {
        let timeoutId = null;

        return function debouncedFunction() {
            const context = this;
            const argumentsList = arguments;

            window.clearTimeout(timeoutId);

            timeoutId = window.setTimeout(function () {
                callback.apply(context, argumentsList);
            }, delay || 300);
        };
    }

    function slugify(value) {
        return String(value || "")
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

    /* ======================================================
       ELEMENT CACHE
    ====================================================== */

    function cacheElements() {
        Products.elements = {
            featuredGrid:
                getById("featured-products-grid") ||
                query("[data-featured-products]"),

            shopGrid:
                getById("shop-products-grid") ||
                query("[data-shop-products]") ||
                query(".shop-product-grid"),

            shopSkeleton:
                getById("shop-products-skeleton") ||
                query("[data-products-skeleton]"),

            shopEmpty:
                getById("shop-empty-state") ||
                query("[data-products-empty]"),

            resultCount:
                getById("shop-result-count") ||
                query("[data-product-count]"),

            sortSelect:
                getById("product-sort") ||
                query("[data-product-sort]"),

            categoryFilters: queryAll(
                "[data-filter-category]"
            ),

            sizeFilters: queryAll(
                "[data-filter-size]"
            ),

            colorFilters: queryAll(
                "[data-filter-color]"
            ),

            stockFilter:
                getById("filter-in-stock") ||
                query("[data-filter-stock]"),

            minimumPrice:
                getById("filter-min-price") ||
                query("[data-filter-min-price]"),

            maximumPrice:
                getById("filter-max-price") ||
                query("[data-filter-max-price]"),

            clearFilters: queryAll(
                "[data-clear-filters]"
            ),

            activeFilters:
                getById("active-filter-chips") ||
                query("[data-active-filters]"),

            pagination:
                getById("shop-pagination") ||
                query("[data-product-pagination]"),

            productPage:
                getById("product-page") ||
                query('[data-page="product"]'),

            productTitle:
                getById("product-detail-title") ||
                query("[data-product-title]"),

            productCategory:
                getById("product-detail-category") ||
                query("[data-product-category]"),

            productPrice:
                getById("product-detail-price") ||
                query("[data-product-price]"),

            productOldPrice:
                getById("product-detail-old-price") ||
                query("[data-product-old-price]"),

            productDescription:
                getById("product-detail-description") ||
                query("[data-product-description]"),

            productMainImage:
                getById("product-main-image") ||
                query("[data-product-main-image]"),

            productThumbnails:
                getById("product-thumbnails") ||
                query("[data-product-thumbnails]"),

            productBadge:
                getById("product-detail-badge") ||
                query("[data-product-badge]"),

            productRating:
                getById("product-detail-rating") ||
                query("[data-product-rating]"),

            productReviewCount:
                getById("product-review-count") ||
                query("[data-product-review-count]"),

            productSizes:
                getById("product-size-options") ||
                query("[data-product-sizes]"),

            productColors:
                getById("product-color-options") ||
                query("[data-product-colors]"),

            productStock:
                getById("product-stock-status") ||
                query("[data-product-stock]"),

            productSku:
                getById("product-sku") ||
                query("[data-product-sku]"),

            productMaterials:
                getById("product-materials") ||
                query("[data-product-materials]"),

            productCare:
                getById("product-care") ||
                query("[data-product-care]"),

            productShipping:
                getById("product-shipping") ||
                query("[data-product-shipping]"),

            addToCartButton:
                getById("add-to-cart-button") ||
                query("[data-add-current-product]"),

            buyNowButton:
                getById("buy-now-button") ||
                query("[data-buy-current-product]"),

            productQuantity:
                getById("product-quantity") ||
                query("[data-product-quantity]"),

            relatedGrid:
                getById("related-products-grid") ||
                query("[data-related-products]"),

            recentlyViewedGrid:
                getById("recently-viewed-grid") ||
                query("[data-recently-viewed]"),

            productLoading:
                getById("product-detail-loading") ||
                query("[data-product-loading]")
        };
    }

    /* ======================================================
       PRODUCT NORMALIZATION
    ====================================================== */

    function normalizeImage(image) {
        if (!image) {
            return {
                url: "",
                alt: ""
            };
        }

        if (typeof image === "string") {
            return {
                url: image,
                alt: ""
            };
        }

        return {
            url: image.url || image.src || "",
            alt: image.alt || ""
        };
    }

    function normalizeVariant(variant) {
        const value = variant || {};

        return {
            id:
                value.id ||
                [
                    value.size || "default",
                    value.color || "default"
                ].join("-"),

            size: value.size || "",
            color: value.color || "",
            colorHex:
                value.colorHex ||
                value.hex ||
                "",

            sku: value.sku || "",
            stock: Math.max(
                0,
                toNumber(value.stock, 0)
            ),

            price:
                value.price !== undefined
                    ? toNumber(value.price, 0)
                    : null,

            active: value.active !== false
        };
    }

    function normalizeProduct(documentSnapshot) {
        const source =
            typeof documentSnapshot.data === "function"
                ? documentSnapshot.data() || {}
                : documentSnapshot || {};

        const id =
            documentSnapshot.id ||
            source.id ||
            "";

        const images = toArray(source.images)
            .map(normalizeImage)
            .filter(function (image) {
                return Boolean(image.url);
            });

        if (!images.length && source.image) {
            images.push(
                normalizeImage(source.image)
            );
        }

        const variants = toArray(source.variants)
            .map(normalizeVariant)
            .filter(function (variant) {
                return variant.active;
            });

        const price = toNumber(
            source.price,
            variants.length && variants[0].price !== null
                ? variants[0].price
                : 0
        );

        const compareAtPrice = toNumber(
            source.compareAtPrice ||
                source.oldPrice,
            0
        );

        const inventoryFromVariants =
            variants.reduce(function (total, variant) {
                return total + variant.stock;
            }, 0);

        const inventory =
            source.inventory !== undefined
                ? Math.max(
                      0,
                      toNumber(source.inventory, 0)
                  )
                : inventoryFromVariants;

        return {
            id: id,
            name:
                source.name ||
                source.title ||
                "Untitled Product",

            slug:
                source.slug ||
                slugify(
                    source.name ||
                    source.title ||
                    id
                ),

            description:
                source.description || "",

            shortDescription:
                source.shortDescription ||
                source.description ||
                "",

            category:
                source.category || "",

            categorySlug:
                source.categorySlug ||
                slugify(source.category),

            collection:
                source.collection || "",

            collectionSlug:
                source.collectionSlug ||
                slugify(source.collection),

            gender: source.gender || "",
            sku: source.sku || "",
            materials:
                source.materials ||
                source.material ||
                "",

            care: source.care || "",
            shipping: source.shipping || "",
            origin: source.origin || "",

            price: price,
            compareAtPrice: compareAtPrice,
            currency:
                source.currency ||
                Products.config.defaultCurrency,

            images: images,
            primaryImage:
                images.length
                    ? images[0].url
                    : "",

            secondaryImage:
                images.length > 1
                    ? images[1].url
                    : "",

            variants: variants,
            sizes:
                source.sizes ||
                uniqueValues(
                    variants.map(function (variant) {
                        return variant.size;
                    })
                ),

            colors:
                source.colors ||
                uniqueValues(
                    variants.map(function (variant) {
                        return variant.color;
                    })
                ),

            inventory: inventory,
            inStock:
                source.inStock !== undefined
                    ? Boolean(source.inStock)
                    : inventory > 0,

            featured: Boolean(source.featured),
            bestseller: Boolean(source.bestseller),
            newArrival: Boolean(
                source.newArrival ||
                source.isNew
            ),

            active: source.active !== false,
            published: source.published !== false,

            rating: Math.max(
                0,
                Math.min(
                    5,
                    toNumber(source.rating, 0)
                )
            ),

            reviewCount: Math.max(
                0,
                toNumber(source.reviewCount, 0)
            ),

            salesCount: Math.max(
                0,
                toNumber(source.salesCount, 0)
            ),

            createdAt: source.createdAt || null,
            updatedAt: source.updatedAt || null,

            metadata: source.metadata || {}
        };
    }

    function uniqueValues(values) {
        return values
            .filter(Boolean)
            .filter(function (value, index, array) {
                return array.indexOf(value) === index;
            });
    }

    /* ======================================================
       CURRENCY & PRODUCT LABELS
    ====================================================== */

    function formatPrice(value, currency) {
        try {
            return new Intl.NumberFormat(
                Products.config.defaultLocale,
                {
                    style: "currency",
                    currency:
                        currency ||
                        Products.config.defaultCurrency,

                    maximumFractionDigits: 0
                }
            ).format(toNumber(value, 0));
        } catch (error) {
            return (
                (currency ||
                    Products.config.defaultCurrency) +
                " " +
                toNumber(value, 0).toLocaleString()
            );
        }
    }

    function getDiscountPercentage(product) {
        if (
            !product.compareAtPrice ||
            product.compareAtPrice <= product.price
        ) {
            return 0;
        }

        return Math.round(
            (
                (
                    product.compareAtPrice -
                    product.price
                ) /
                product.compareAtPrice
            ) *
                100
        );
    }

    function getProductBadge(product) {
        const discount = getDiscountPercentage(product);

        if (discount > 0) {
            return {
                label: "-" + discount + "%",
                className: "sale"
            };
        }

        if (product.newArrival) {
            return {
                label: "New",
                className: "new"
            };
        }

        if (product.bestseller) {
            return {
                label: "Bestseller",
                className: "bestseller"
            };
        }

        if (!product.inStock) {
            return {
                label: "Sold out",
                className: "sold-out"
            };
        }

        return null;
    }

    /* ======================================================
       FIRESTORE QUERIES
    ====================================================== */

    function getProductsCollection() {
        return db.collection(
            Products.config.collection
        );
    }

    function buildBaseProductQuery() {
        return getProductsCollection()
            .where("active", "==", true)
            .where("published", "==", true);
    }

    function applyServerFilters(reference, filters) {
        let queryReference = reference;
        const values = filters || Products.state.filters;

        if (values.category) {
            queryReference = queryReference.where(
                "categorySlug",
                "==",
                slugify(values.category)
            );
        }

        if (values.collection) {
            queryReference = queryReference.where(
                "collectionSlug",
                "==",
                slugify(values.collection)
            );
        }

        if (values.featured) {
            queryReference = queryReference.where(
                "featured",
                "==",
                true
            );
        }

        if (values.inStock) {
            queryReference = queryReference.where(
                "inStock",
                "==",
                true
            );
        }

        return queryReference;
    }

    function applySorting(reference, sort) {
        const sortValue =
            sort || Products.state.sort;

        switch (sortValue) {
            case "price-low":
                return reference.orderBy(
                    "price",
                    "asc"
                );

            case "price-high":
                return reference.orderBy(
                    "price",
                    "desc"
                );

            case "newest":
                return reference.orderBy(
                    "createdAt",
                    "desc"
                );

            case "popular":
                return reference.orderBy(
                    "salesCount",
                    "desc"
                );

            case "rating":
                return reference.orderBy(
                    "rating",
                    "desc"
                );

            case "name":
                return reference.orderBy(
                    "name",
                    "asc"
                );

            case "featured":
            default:
                return reference
                    .orderBy("featured", "desc")
                    .orderBy("createdAt", "desc");
        }
    }

    function requiresClientFiltering(filters) {
        const values = filters || {};

        return Boolean(
            values.search ||
            values.sizes.length ||
            values.colors.length ||
            values.minPrice !== null ||
            values.maxPrice !== null
        );
    }

    function applyClientFilters(products, filters) {
        const values = filters || Products.state.filters;

        return products.filter(function (product) {
            if (values.search) {
                const searchValue =
                    values.search.toLowerCase();

                const searchText = [
                    product.name,
                    product.category,
                    product.collection,
                    product.description,
                    product.sku
                ]
                    .join(" ")
                    .toLowerCase();

                if (
                    searchText.indexOf(searchValue) === -1
                ) {
                    return false;
                }
            }

            if (
                values.sizes.length &&
                !values.sizes.some(function (size) {
                    return product.sizes.indexOf(size) !== -1;
                })
            ) {
                return false;
            }

            if (
                values.colors.length &&
                !values.colors.some(function (color) {
                    return product.colors.indexOf(color) !== -1;
                })
            ) {
                return false;
            }

            if (
                values.minPrice !== null &&
                product.price < values.minPrice
            ) {
                return false;
            }

            if (
                values.maxPrice !== null &&
                product.price > values.maxPrice
            ) {
                return false;
            }

            return true;
        });
    }

    function applyClientSorting(products, sort) {
        const sortedProducts = products.slice();

        switch (sort) {
            case "price-low":
                return sortedProducts.sort(function (a, b) {
                    return a.price - b.price;
                });

            case "price-high":
                return sortedProducts.sort(function (a, b) {
                    return b.price - a.price;
                });

            case "newest":
                return sortedProducts.sort(function (a, b) {
                    return getTimestampValue(b.createdAt) -
                        getTimestampValue(a.createdAt);
                });

            case "popular":
                return sortedProducts.sort(function (a, b) {
                    return b.salesCount - a.salesCount;
                });

            case "rating":
                return sortedProducts.sort(function (a, b) {
                    return b.rating - a.rating;
                });

            case "name":
                return sortedProducts.sort(function (a, b) {
                    return a.name.localeCompare(b.name);
                });

            case "featured":
            default:
                return sortedProducts.sort(function (a, b) {
                    if (a.featured !== b.featured) {
                        return a.featured ? -1 : 1;
                    }

                    return getTimestampValue(b.createdAt) -
                        getTimestampValue(a.createdAt);
                });
        }
    }

    function getTimestampValue(value) {
        if (!value) {
            return 0;
        }

        if (typeof value.toMillis === "function") {
            return value.toMillis();
        }

        if (value instanceof Date) {
            return value.getTime();
        }

        return new Date(value).getTime() || 0;
    }

    /* ======================================================
       PRODUCT RETRIEVAL
    ====================================================== */

    async function fetchFeaturedProducts(limit) {
        const maximum =
            Number(limit) ||
            Products.config.featuredLimit;

        try {
            const snapshot = await getProductsCollection()
                .where("active", "==", true)
                .where("published", "==", true)
                .where("featured", "==", true)
                .orderBy("createdAt", "desc")
                .limit(maximum)
                .get();

            const products = snapshot.docs.map(
                normalizeProduct
            );

            Products.state.featuredProducts = products;

            return products;
        } catch (error) {
            console.error(
                "[Products] Unable to retrieve featured products:",
                error
            );

            throw error;
        }
    }

    async function fetchProducts(options) {
        const settings = options || {};
        const filters = Object.assign(
            {},
            Products.state.filters,
            settings.filters || {}
        );

        filters.sizes = toArray(filters.sizes);
        filters.colors = toArray(filters.colors);

        const page = Math.max(
            1,
            Number(settings.page) ||
                Products.state.currentPage
        );

        const pageSize = Math.max(
            1,
            Number(settings.pageSize) ||
                Products.config.pageSize
        );

        Products.state.loading = true;
        showCatalogLoading(true);

        try {
            /*
             * Client-side filtering requires a broader result set because
             * Firestore cannot combine arbitrary text, array and range
             * filters in one simple query.
             */
            if (requiresClientFiltering(filters)) {
                let broadQuery =
                    applyServerFilters(
                        buildBaseProductQuery(),
                        filters
                    );

                const snapshot =
                    await broadQuery.limit(200).get();

                let products =
                    snapshot.docs.map(normalizeProduct);

                products = applyClientFilters(
                    products,
                    filters
                );

                products = applyClientSorting(
                    products,
                    settings.sort ||
                        Products.state.sort
                );

                const totalProducts =
                    products.length;

                const totalPages = Math.max(
                    1,
                    Math.ceil(
                        totalProducts / pageSize
                    )
                );

                const startIndex =
                    (page - 1) * pageSize;

                products = products.slice(
                    startIndex,
                    startIndex + pageSize
                );

                updateCatalogState({
                    products: products,
                    page: page,
                    totalPages: totalPages,
                    totalProducts: totalProducts,
                    firstVisible: null,
                    lastVisible: null
                });

                return products;
            }

            let productQuery =
                applyServerFilters(
                    buildBaseProductQuery(),
                    filters
                );

            productQuery = applySorting(
                productQuery,
                settings.sort ||
                    Products.state.sort
            );

            if (
                settings.cursor &&
                settings.direction === "previous"
            ) {
                productQuery = productQuery
                    .endBefore(settings.cursor)
                    .limitToLast(pageSize);
            } else if (settings.cursor) {
                productQuery = productQuery
                    .startAfter(settings.cursor)
                    .limit(pageSize);
            } else {
                productQuery =
                    productQuery.limit(pageSize);
            }

            const snapshot =
                await productQuery.get();

            const products =
                snapshot.docs.map(normalizeProduct);

            updateCatalogState({
                products: products,
                page: page,
                totalPages:
                    products.length < pageSize
                        ? page
                        : Math.max(
                              page,
                              Products.state.totalPages
                          ),

                totalProducts:
                    settings.totalProducts ||
                    Products.state.totalProducts,

                firstVisible:
                    snapshot.docs.length
                        ? snapshot.docs[0]
                        : null,

                lastVisible:
                    snapshot.docs.length
                        ? snapshot.docs[
                              snapshot.docs.length - 1
                          ]
                        : null
            });

            Products.state.pageCursors[page] = {
                firstVisible:
                    Products.state.firstVisible,

                lastVisible:
                    Products.state.lastVisible
            };

            return products;
        } catch (error) {
            console.error(
                "[Products] Unable to retrieve catalog:",
                error
            );

            showCatalogError(error);
            throw error;
        } finally {
            Products.state.loading = false;
            showCatalogLoading(false);
        }
    }

    async function fetchProductById(id) {
        const productId = String(id || "").trim();

        if (!productId) {
            return null;
        }

        const snapshot =
            await getProductsCollection()
                .doc(productId)
                .get();

        if (!snapshot.exists) {
            return null;
        }

        const product =
            normalizeProduct(snapshot);

        if (!product.active || !product.published) {
            return null;
        }

        return product;
    }

    async function fetchProductBySlug(slug) {
        const normalizedSlug = slugify(slug);

        if (!normalizedSlug) {
            return null;
        }

        const snapshot =
            await getProductsCollection()
                .where("slug", "==", normalizedSlug)
                .where("active", "==", true)
                .where("published", "==", true)
                .limit(1)
                .get();

        if (snapshot.empty) {
            return null;
        }

        return normalizeProduct(snapshot.docs[0]);
    }

    async function fetchRelatedProducts(product, limit) {
        if (!product) {
            return [];
        }

        const maximum =
            Number(limit) ||
            Products.config.relatedLimit;

        let snapshot;

        try {
            snapshot = await getProductsCollection()
                .where("active", "==", true)
                .where("published", "==", true)
                .where(
                    "categorySlug",
                    "==",
                    product.categorySlug
                )
                .limit(maximum + 1)
                .get();
        } catch (error) {
            console.warn(
                "[Products] Related product query failed:",
                error
            );

            return [];
        }

        return snapshot.docs
            .map(normalizeProduct)
            .filter(function (item) {
                return item.id !== product.id;
            })
            .slice(0, maximum);
    }

    async function fetchCategories() {
        try {
            const snapshot = await db
                .collection(
                    Products.config.categoriesCollection
                )
                .where("active", "==", true)
                .orderBy("order", "asc")
                .get();

            Products.state.categories =
                snapshot.docs.map(function (documentSnapshot) {
                    return Object.assign(
                        {
                            id: documentSnapshot.id
                        },
                        documentSnapshot.data()
                    );
                });

            return Products.state.categories;
        } catch (error) {
            console.warn(
                "[Products] Unable to retrieve categories:",
                error
            );

            return [];
        }
    }

    function updateCatalogState(settings) {
        Products.state.products =
            settings.products || [];

        Products.state.currentPage =
            settings.page || 1;

        Products.state.totalPages =
            settings.totalPages || 1;

        Products.state.totalProducts =
            settings.totalProducts || 0;

        Products.state.firstVisible =
            settings.firstVisible || null;

        Products.state.lastVisible =
            settings.lastVisible || null;
    }

    /* ======================================================
       PRODUCT CARD RENDERING
    ====================================================== */

    function renderRating(rating) {
        const normalizedRating = Math.max(
            0,
            Math.min(5, Number(rating) || 0)
        );

        let html = "";

        for (let index = 1; index <= 5; index += 1) {
            html +=
                '<i class="' +
                (
                    index <= Math.round(normalizedRating)
                        ? "fa-solid"
                        : "fa-regular"
                ) +
                ' fa-star"></i>';
        }

        return html;
    }

    function createProductCard(product) {
        const badge = getProductBadge(product);

        const card = document.createElement("article");
        card.className = "product-card";
        card.dataset.productId = product.id;
        card.dataset.productSlug = product.slug;

        const productPath = router
            ? router.buildPath("product", {
                  id: product.id
              })
            : "/product/" +
              encodeURIComponent(product.id);

        const primaryImage =
            product.primaryImage ||
            "https://placehold.co/800x1000?text=L%27ÉTERNEL";

        const secondaryImage =
            product.secondaryImage ||
            product.primaryImage ||
            primaryImage;

        card.innerHTML = [
            '<div class="product-card-image">',
            '<a href="#' +
                productPath +
                '" data-route="' +
                productPath +
                '" aria-label="View ' +
                escapeHTML(product.name) +
                '">',

            '<img class="product-image-primary" src="' +
                escapeHTML(primaryImage) +
                '" alt="' +
                escapeHTML(product.name) +
                '" loading="lazy">',

            product.secondaryImage
                ? '<img class="product-image-secondary" src="' +
                  escapeHTML(secondaryImage) +
                  '" alt="" loading="lazy">'
                : "",

            "</a>",

            badge
                ? '<span class="product-badge ' +
                  escapeHTML(badge.className) +
                  '">' +
                  escapeHTML(badge.label) +
                  "</span>"
                : "",

            '<div class="product-card-actions">',

            '<button type="button" class="product-action-button" data-product-wishlist="' +
                escapeHTML(product.id) +
                '" aria-label="Add ' +
                escapeHTML(product.name) +
                ' to wishlist">',

            '<i class="fa-regular fa-heart"></i>',
            "</button>",

            '<button type="button" class="product-action-button" data-product-quick-view="' +
                escapeHTML(product.id) +
                '" aria-label="Quick view ' +
                escapeHTML(product.name) +
                '">',

            '<i class="fa-regular fa-eye"></i>',
            "</button>",

            "</div>",

            product.inStock
                ? '<button type="button" class="product-quick-add" data-product-add="' +
                  escapeHTML(product.id) +
                  '">Quick add</button>'
                : '<span class="product-sold-out">Sold out</span>',

            "</div>",

            '<div class="product-card-content">',

            product.category
                ? '<span class="product-category">' +
                  escapeHTML(product.category) +
                  "</span>"
                : "",

            '<h3 class="product-card-title">',
            '<a href="#' +
                productPath +
                '" data-route="' +
                productPath +
                '">' +
                escapeHTML(product.name) +
                "</a>",
            "</h3>",

            '<div class="product-card-meta">',
            '<div class="product-card-rating" aria-label="' +
                escapeHTML(
                    product.rating + " out of 5 stars"
                ) +
                '">',
            renderRating(product.rating),
            product.reviewCount
                ? "<span>(" +
                  escapeHTML(product.reviewCount) +
                  ")</span>"
                : "",
            "</div>",
            "</div>",

            '<div class="product-price-row">',
            '<span class="product-price">' +
                escapeHTML(
                    formatPrice(
                        product.price,
                        product.currency
                    )
                ) +
                "</span>",

            product.compareAtPrice >
            product.price
                ? '<span class="product-old-price">' +
                  escapeHTML(
                      formatPrice(
                          product.compareAtPrice,
                          product.currency
                      )
                  ) +
                  "</span>"
                : "",

            "</div>",
            "</div>"
        ].join("");

        return card;
    }

    function renderProductGrid(container, products) {
        if (!container) {
            return;
        }

        container.innerHTML = "";

        const fragment =
            document.createDocumentFragment();

        products.forEach(function (product) {
            fragment.appendChild(
                createProductCard(product)
            );
        });

        container.appendChild(fragment);
    }

    async function renderFeaturedProducts() {
        if (!Products.elements.featuredGrid) {
            return;
        }

        try {
            const products =
                await fetchFeaturedProducts();

            renderProductGrid(
                Products.elements.featuredGrid,
                products
            );
        } catch (error) {
            Products.elements.featuredGrid.innerHTML =
                '<div class="account-empty-state">' +
                '<i class="fa-regular fa-gem"></i>' +
                "<h3>Featured collection unavailable</h3>" +
                "<p>Please return shortly to explore our latest selection.</p>" +
                "</div>";
        }
    }

    async function renderShopProducts(options) {
        if (!Products.elements.shopGrid) {
            return;
        }

        try {
            const products =
                await fetchProducts(options);

            renderProductGrid(
                Products.elements.shopGrid,
                products
            );

            renderResultCount();
            renderPagination();
            renderActiveFilters();

            if (Products.elements.shopEmpty) {
                Products.elements.shopEmpty.hidden =
                    products.length > 0;
            }
        } catch (error) {
            if (Products.elements.shopEmpty) {
                Products.elements.shopEmpty.hidden =
                    false;
            }
        }
    }

    function renderResultCount() {
        if (!Products.elements.resultCount) {
            return;
        }

        const count =
            Products.state.totalProducts ||
            Products.state.products.length;

        Products.elements.resultCount.textContent =
            count === 1
                ? "1 piece"
                : count + " pieces";
    }

    /* ======================================================
       PRODUCT DETAIL RENDERING
    ====================================================== */

    function setText(element, value) {
        if (element) {
            element.textContent =
                value === undefined ||
                value === null
                    ? ""
                    : String(value);
        }
    }

    function showProductLoading(loading) {
        if (Products.elements.productLoading) {
            Products.elements.productLoading.classList.toggle(
                "active",
                loading
            );

            Products.elements.productLoading.hidden =
                !loading;
        }
    }

    function renderProductImages(product) {
        const images = product.images.length
            ? product.images
            : [
                  {
                      url:
                          "https://placehold.co/1000x1250?text=L%27ÉTERNEL",
                      alt: product.name
                  }
              ];

        if (Products.elements.productMainImage) {
            Products.elements.productMainImage.src =
                images[0].url;

            Products.elements.productMainImage.alt =
                images[0].alt ||
                product.name;
        }

        if (!Products.elements.productThumbnails) {
            return;
        }

        Products.elements.productThumbnails.innerHTML =
            "";

        images.forEach(function (image, index) {
            const button =
                document.createElement("button");

            button.type = "button";
            button.className =
                "product-thumbnail" +
                (index === 0 ? " active" : "");

            button.dataset.productImage =
                image.url;

            button.setAttribute(
                "aria-label",
                "View product image " +
                    (index + 1)
            );

            button.innerHTML =
                '<img src="' +
                escapeHTML(image.url) +
                '" alt="' +
                escapeHTML(
                    image.alt ||
                        product.name
                ) +
                '">';

            Products.elements.productThumbnails.appendChild(
                button
            );
        });
    }

    function renderSizeOptions(product) {
        if (!Products.elements.productSizes) {
            return;
        }

        Products.elements.productSizes.innerHTML =
            "";

        product.sizes.forEach(function (size) {
            const available =
                !product.variants.length ||
                product.variants.some(function (variant) {
                    return (
                        variant.size === size &&
                        variant.stock > 0
                    );
                });

            const button =
                document.createElement("button");

            button.type = "button";
            button.className = "size-option";
            button.dataset.productSize = size;
            button.textContent = size;
            button.disabled = !available;

            if (!available) {
                button.classList.add("unavailable");
            }

            Products.elements.productSizes.appendChild(
                button
            );
        });
    }

    function renderColorOptions(product) {
        if (!Products.elements.productColors) {
            return;
        }

        Products.elements.productColors.innerHTML =
            "";

        product.colors.forEach(function (color) {
            const variant =
                product.variants.find(function (item) {
                    return item.color === color;
                });

            const button =
                document.createElement("button");

            button.type = "button";
            button.className = "color-option";
            button.dataset.productColor = color;
            button.setAttribute(
                "aria-label",
                "Select " + color
            );

            if (variant && variant.colorHex) {
                button.style.setProperty(
                    "--product-color",
                    variant.colorHex
                );
            }

            button.innerHTML =
                '<span class="color-swatch"></span>' +
                '<span class="color-name">' +
                escapeHTML(color) +
                "</span>";

            Products.elements.productColors.appendChild(
                button
            );
        });
    }

    function renderProductDetail(product) {
        Products.state.currentProduct = product;

        setText(
            Products.elements.productTitle,
            product.name
        );

        setText(
            Products.elements.productCategory,
            product.category
        );

        setText(
            Products.elements.productPrice,
            formatPrice(
                product.price,
                product.currency
            )
        );

        if (Products.elements.productOldPrice) {
            Products.elements.productOldPrice.textContent =
                product.compareAtPrice >
                product.price
                    ? formatPrice(
                          product.compareAtPrice,
                          product.currency
                      )
                    : "";

            Products.elements.productOldPrice.hidden =
                !(
                    product.compareAtPrice >
                    product.price
                );
        }

        setText(
            Products.elements.productDescription,
            product.description
        );

        setText(
            Products.elements.productReviewCount,
            product.reviewCount
                ? product.reviewCount +
                      " reviews"
                : "No reviews yet"
        );

        if (Products.elements.productRating) {
            Products.elements.productRating.innerHTML =
                renderRating(product.rating);
        }

        const badge = getProductBadge(product);

        if (Products.elements.productBadge) {
            Products.elements.productBadge.hidden =
                !badge;

            Products.elements.productBadge.textContent =
                badge ? badge.label : "";

            Products.elements.productBadge.className =
                "product-badge" +
                (
                    badge
                        ? " " + badge.className
                        : ""
                );
        }

        setText(
            Products.elements.productStock,
            product.inStock
                ? product.inventory +
                      " available"
                : "Currently unavailable"
        );

        if (Products.elements.productStock) {
            Products.elements.productStock.classList.toggle(
                "in-stock",
                product.inStock
            );

            Products.elements.productStock.classList.toggle(
                "out-of-stock",
                !product.inStock
            );
        }

        setText(
            Products.elements.productSku,
            product.sku
        );

        setText(
            Products.elements.productMaterials,
            product.materials
        );

        setText(
            Products.elements.productCare,
            product.care
        );

        setText(
            Products.elements.productShipping,
            product.shipping
        );

        renderProductImages(product);
        renderSizeOptions(product);
        renderColorOptions(product);

        if (Products.elements.addToCartButton) {
            Products.elements.addToCartButton.disabled =
                !product.inStock;

            Products.elements.addToCartButton.dataset.productId =
                product.id;
        }

        if (Products.elements.buyNowButton) {
            Products.elements.buyNowButton.disabled =
                !product.inStock;

            Products.elements.buyNowButton.dataset.productId =
                product.id;
        }

        addRecentlyViewed(product);

        document.dispatchEvent(
            new CustomEvent(
                "products:detailrendered",
                {
                    detail: {
                        product: product
                    }
                }
            )
        );
    }

    async function loadProductDetail(identifier) {
        showProductLoading(true);

        try {
            let product =
                await fetchProductById(identifier);

            if (!product) {
                product =
                    await fetchProductBySlug(identifier);
            }

            if (!product) {
                app.showToast({
                    type: "error",
                    title: "Product unavailable",
                    message:
                        "This product could not be found."
                });

                if (router) {
                    await router.navigate("/shop", {
                        replace: true
                    });
                }

                return null;
            }

            renderProductDetail(product);

            const relatedProducts =
                await fetchRelatedProducts(product);

            renderProductGrid(
                Products.elements.relatedGrid,
                relatedProducts
            );

            await renderRecentlyViewed(
                product.id
            );

            document.title =
                product.name +
                " — L'ÉTERNEL";

            return product;
        } catch (error) {
            console.error(
                "[Products] Unable to load product detail:",
                error
            );

            app.showToast({
                type: "error",
                title: "Product unavailable",
                message:
                    "The product could not be loaded."
            });

            return null;
        } finally {
            showProductLoading(false);
        }
    }

    /* ======================================================
       PRODUCT SELECTION
    ====================================================== */

    function getSelectedSize() {
        const selected = query(
            "[data-product-size].active",
            Products.elements.productSizes
        );

        return selected
            ? selected.dataset.productSize
            : "";
    }

    function getSelectedColor() {
        const selected = query(
            "[data-product-color].active",
            Products.elements.productColors
        );

        return selected
            ? selected.dataset.productColor
            : "";
    }

    function getSelectedQuantity() {
        if (!Products.elements.productQuantity) {
            return 1;
        }

        return Math.max(
            1,
            toNumber(
                Products.elements.productQuantity.value ||
                    Products.elements.productQuantity.textContent,
                1
            )
        );
    }

    function findSelectedVariant(product) {
        if (!product || !product.variants.length) {
            return null;
        }

        const size = getSelectedSize();
        const color = getSelectedColor();

        return (
            product.variants.find(function (variant) {
                const sizeMatches =
                    !size ||
                    variant.size === size;

                const colorMatches =
                    !color ||
                    variant.color === color;

                return (
                    sizeMatches &&
                    colorMatches
                );
            }) || null
        );
    }

    function validateProductSelection(product) {
        if (!product) {
            return {
                valid: false,
                message:
                    "No product is currently selected."
            };
        }

        if (!product.inStock) {
            return {
                valid: false,
                message:
                    "This product is currently unavailable."
            };
        }

        const selectedSize =
            getSelectedSize();

        const selectedColor =
            getSelectedColor();

        if (
            product.sizes.length &&
            !selectedSize
        ) {
            return {
                valid: false,
                message:
                    "Select a size before adding this piece."
            };
        }

        if (
            product.colors.length &&
            !selectedColor
        ) {
            return {
                valid: false,
                message:
                    "Select a colour before adding this piece."
            };
        }

        const variant =
            findSelectedVariant(product);

        if (
            product.variants.length &&
            (!variant || variant.stock < 1)
        ) {
            return {
                valid: false,
                message:
                    "The selected variation is unavailable."
            };
        }

        const quantity =
            getSelectedQuantity();

        if (
            variant &&
            quantity > variant.stock
        ) {
            return {
                valid: false,
                message:
                    "Only " +
                    variant.stock +
                    " units are available."
            };
        }

        return {
            valid: true,
            variant: variant,
            size: selectedSize,
            color: selectedColor,
            quantity: quantity
        };
    }

    function buildCartProduct(product) {
        const selection =
            validateProductSelection(product);

        if (!selection.valid) {
            throw new Error(selection.message);
        }

        const variant = selection.variant;

        return {
            productId: product.id,
            name: product.name,
            slug: product.slug,
            image: product.primaryImage,
            price:
                variant &&
                variant.price !== null
                    ? variant.price
                    : product.price,

            currency: product.currency,
            quantity: selection.quantity,
            size: selection.size,
            color: selection.color,
            variantId:
                variant ? variant.id : "",

            sku:
                variant && variant.sku
                    ? variant.sku
                    : product.sku,

            stock:
                variant
                    ? variant.stock
                    : product.inventory
        };
    }

    /* ======================================================
       RECENTLY VIEWED
    ====================================================== */

    function readRecentlyViewedIds() {
        try {
            const storedValue =
                window.localStorage.getItem(
                    Products.config
                        .recentlyViewedStorageKey
                );

            const parsedValue =
                JSON.parse(storedValue || "[]");

            return Array.isArray(parsedValue)
                ? parsedValue
                : [];
        } catch (error) {
            return [];
        }
    }

    function writeRecentlyViewedIds(ids) {
        try {
            window.localStorage.setItem(
                Products.config
                    .recentlyViewedStorageKey,
                JSON.stringify(ids)
            );
        } catch (error) {
            console.warn(
                "[Products] Recently viewed products could not be saved:",
                error
            );
        }
    }

    function addRecentlyViewed(product) {
        if (!product || !product.id) {
            return;
        }

        const ids = readRecentlyViewedIds()
            .filter(function (id) {
                return id !== product.id;
            });

        ids.unshift(product.id);

        writeRecentlyViewedIds(
            ids.slice(
                0,
                Products.config
                    .recentlyViewedLimit
            )
        );
    }

    async function renderRecentlyViewed(
        excludedProductId
    ) {
        if (!Products.elements.recentlyViewedGrid) {
            return [];
        }

        const ids = readRecentlyViewedIds()
            .filter(function (id) {
                return id !== excludedProductId;
            })
            .slice(
                0,
                Products.config
                    .recentlyViewedLimit
            );

        if (!ids.length) {
            Products.elements.recentlyViewedGrid.innerHTML =
                "";

            return [];
        }

        const snapshots = await Promise.all(
            ids.map(function (id) {
                return getProductsCollection()
                    .doc(id)
                    .get();
            })
        );

        const products = snapshots
            .filter(function (snapshot) {
                return snapshot.exists;
            })
            .map(normalizeProduct)
            .filter(function (product) {
                return (
                    product.active &&
                    product.published
                );
            });

        renderProductGrid(
            Products.elements.recentlyViewedGrid,
            products
        );

        return products;
    }

    /* ======================================================
       FILTERS
    ====================================================== */

    function setFilter(name, value) {
        if (
            !Object.prototype.hasOwnProperty.call(
                Products.state.filters,
                name
            )
        ) {
            return;
        }

        Products.state.filters[name] = value;
        Products.state.currentPage = 1;
        Products.state.pageCursors = {};

        renderShopProducts({
            page: 1
        });

        updateShopQueryString();
    }

    function toggleArrayFilter(name, value) {
        const currentValues = toArray(
            Products.state.filters[name]
        );

        const index =
            currentValues.indexOf(value);

        if (index === -1) {
            currentValues.push(value);
        } else {
            currentValues.splice(index, 1);
        }

        setFilter(name, currentValues);
    }

    function clearAllFilters() {
        Products.state.filters = {
            category: "",
            collection: "",
            sizes: [],
            colors: [],
            minPrice: null,
            maxPrice: null,
            inStock: false,
            featured: false,
            search: ""
        };

        Products.state.currentPage = 1;
        Products.state.pageCursors = {};

        syncFilterControls();
        renderShopProducts({
            page: 1
        });

        updateShopQueryString();
    }

    function syncFilterControls() {
        Products.elements.categoryFilters.forEach(
            function (control) {
                const category =
                    control.dataset.filterCategory;

                control.classList.toggle(
                    "active",
                    Products.state.filters.category ===
                        category
                );

                if (
                    control.type === "checkbox" ||
                    control.type === "radio"
                ) {
                    control.checked =
                        Products.state.filters.category ===
                        category;
                }
            }
        );

        Products.elements.sizeFilters.forEach(
            function (control) {
                const active =
                    Products.state.filters.sizes.indexOf(
                        control.dataset.filterSize
                    ) !== -1;

                control.classList.toggle(
                    "active",
                    active
                );

                if (control.type === "checkbox") {
                    control.checked = active;
                }
            }
        );

        Products.elements.colorFilters.forEach(
            function (control) {
                const active =
                    Products.state.filters.colors.indexOf(
                        control.dataset.filterColor
                    ) !== -1;

                control.classList.toggle(
                    "active",
                    active
                );

                if (control.type === "checkbox") {
                    control.checked = active;
                }
            }
        );

        if (Products.elements.stockFilter) {
            Products.elements.stockFilter.checked =
                Products.state.filters.inStock;
        }

        if (Products.elements.minimumPrice) {
            Products.elements.minimumPrice.value =
                Products.state.filters.minPrice === null
                    ? ""
                    : Products.state.filters.minPrice;
        }

        if (Products.elements.maximumPrice) {
            Products.elements.maximumPrice.value =
                Products.state.filters.maxPrice === null
                    ? ""
                    : Products.state.filters.maxPrice;
        }

        if (Products.elements.sortSelect) {
            Products.elements.sortSelect.value =
                Products.state.sort;
        }
    }

    function renderActiveFilters() {
        if (!Products.elements.activeFilters) {
            return;
        }

        Products.elements.activeFilters.innerHTML =
            "";

        const filters =
            Products.state.filters;

        const chips = [];

        if (filters.category) {
            chips.push({
                type: "category",
                value: filters.category,
                label: filters.category
            });
        }

        if (filters.collection) {
            chips.push({
                type: "collection",
                value: filters.collection,
                label: filters.collection
            });
        }

        filters.sizes.forEach(function (size) {
            chips.push({
                type: "size",
                value: size,
                label: "Size " + size
            });
        });

        filters.colors.forEach(function (color) {
            chips.push({
                type: "color",
                value: color,
                label: color
            });
        });

        if (filters.minPrice !== null) {
            chips.push({
                type: "minPrice",
                value: filters.minPrice,
                label:
                    "From " +
                    formatPrice(
                        filters.minPrice
                    )
            });
        }

        if (filters.maxPrice !== null) {
            chips.push({
                type: "maxPrice",
                value: filters.maxPrice,
                label:
                    "Up to " +
                    formatPrice(
                        filters.maxPrice
                    )
            });
        }

        if (filters.inStock) {
            chips.push({
                type: "inStock",
                value: true,
                label: "In stock"
            });
        }

        chips.forEach(function (chip) {
            const button =
                document.createElement("button");

            button.type = "button";
            button.className =
                "active-filter-chip";

            button.dataset.removeFilter =
                chip.type;

            button.dataset.filterValue =
                chip.value;

            button.innerHTML =
                "<span>" +
                escapeHTML(chip.label) +
                "</span>" +
                '<i class="fa-solid fa-xmark"></i>';

            Products.elements.activeFilters.appendChild(
                button
            );
        });

        Products.elements.activeFilters.hidden =
            chips.length === 0;
    }

    function removeFilter(type, value) {
        switch (type) {
            case "size":
                Products.state.filters.sizes =
                    Products.state.filters.sizes.filter(
                        function (size) {
                            return size !== value;
                        }
                    );
                break;

            case "color":
                Products.state.filters.colors =
                    Products.state.filters.colors.filter(
                        function (color) {
                            return color !== value;
                        }
                    );
                break;

            case "minPrice":
            case "maxPrice":
                Products.state.filters[type] = null;
                break;

            case "inStock":
                Products.state.filters.inStock = false;
                break;

            default:
                Products.state.filters[type] = "";
        }

        syncFilterControls();
        renderShopProducts({
            page: 1
        });

        updateShopQueryString();
    }

    function updateShopQueryString() {
        if (!router) {
            return;
        }

        const filters =
            Products.state.filters;

        const queryParameters = {};

        if (filters.category) {
            queryParameters.category =
                filters.category;
        }

        if (filters.collection) {
            queryParameters.collection =
                filters.collection;
        }

        if (filters.sizes.length) {
            queryParameters.sizes =
                filters.sizes.join(",");
        }

        if (filters.colors.length) {
            queryParameters.colors =
                filters.colors.join(",");
        }

        if (filters.minPrice !== null) {
            queryParameters.min =
                filters.minPrice;
        }

        if (filters.maxPrice !== null) {
            queryParameters.max =
                filters.maxPrice;
        }

        if (filters.inStock) {
            queryParameters.stock = "1";
        }

        if (filters.search) {
            queryParameters.q =
                filters.search;
        }

        if (
            Products.state.sort !== "featured"
        ) {
            queryParameters.sort =
                Products.state.sort;
        }

        router.navigate(
            {
                name: "shop",
                query: queryParameters
            },
            {
                replace: true,
                preserveScroll: true
            }
        );
    }

    function applyRouteFilters(queryParameters) {
        const queryValues =
            queryParameters || {};

        Products.state.filters.category =
            queryValues.category || "";

        Products.state.filters.collection =
            queryValues.collection || "";

        Products.state.filters.sizes =
            queryValues.sizes
                ? String(queryValues.sizes)
                      .split(",")
                      .filter(Boolean)
                : [];

        Products.state.filters.colors =
            queryValues.colors
                ? String(queryValues.colors)
                      .split(",")
                      .filter(Boolean)
                : [];

        Products.state.filters.minPrice =
            queryValues.min !== undefined
                ? toNumber(queryValues.min, null)
                : null;

        Products.state.filters.maxPrice =
            queryValues.max !== undefined
                ? toNumber(queryValues.max, null)
                : null;

        Products.state.filters.inStock =
            queryValues.stock === "1" ||
            queryValues.stock === "true";

        Products.state.filters.search =
            queryValues.q || "";

        Products.state.sort =
            queryValues.sort || "featured";

        syncFilterControls();
    }

    /* ======================================================
       PAGINATION
    ====================================================== */

    function renderPagination() {
        if (!Products.elements.pagination) {
            return;
        }

        Products.elements.pagination.innerHTML =
            "";

        const currentPage =
            Products.state.currentPage;

        const totalPages =
            Products.state.totalPages;

        const previousButton =
            createPageButton(
                "Previous",
                currentPage - 1,
                currentPage <= 1,
                "fa-solid fa-chevron-left"
            );

        Products.elements.pagination.appendChild(
            previousButton
        );

        const visiblePages =
            getVisiblePageNumbers(
                currentPage,
                totalPages
            );

        visiblePages.forEach(function (pageNumber) {
            if (pageNumber === "...") {
                const separator =
                    document.createElement("span");

                separator.className =
                    "pagination-separator";

                separator.textContent = "...";

                Products.elements.pagination.appendChild(
                    separator
                );

                return;
            }

            const button =
                createPageButton(
                    String(pageNumber),
                    pageNumber,
                    false
                );

            button.classList.toggle(
                "active",
                pageNumber === currentPage
            );

            Products.elements.pagination.appendChild(
                button
            );
        });

        const nextDisabled =
            Products.state.products.length <
                Products.config.pageSize ||
            currentPage >= totalPages;

        const nextButton =
            createPageButton(
                "Next",
                currentPage + 1,
                nextDisabled,
                "fa-solid fa-chevron-right",
                true
            );

        Products.elements.pagination.appendChild(
            nextButton
        );
    }

    function createPageButton(
        label,
        page,
        disabled,
        icon,
        iconAfter
    ) {
        const button =
            document.createElement("button");

        button.type = "button";
        button.className =
            "pagination-button";

        button.dataset.productPage =
            String(page);

        button.disabled = disabled;

        if (icon) {
            button.innerHTML = iconAfter
                ? escapeHTML(label) +
                  ' <i class="' +
                  icon +
                  '"></i>'
                : '<i class="' +
                  icon +
                  '"></i> ' +
                  escapeHTML(label);
        } else {
            button.textContent = label;
        }

        return button;
    }

    function getVisiblePageNumbers(
        currentPage,
        totalPages
    ) {
        if (totalPages <= 7) {
            return Array.from(
                {
                    length: totalPages
                },
                function (_, index) {
                    return index + 1;
                }
            );
        }

        const pages = [1];

        if (currentPage > 4) {
            pages.push("...");
        }

        const start = Math.max(
            2,
            currentPage - 1
        );

        const end = Math.min(
            totalPages - 1,
            currentPage + 1
        );

        for (
            let page = start;
            page <= end;
            page += 1
        ) {
            pages.push(page);
        }

        if (currentPage < totalPages - 3) {
            pages.push("...");
        }

        pages.push(totalPages);

        return pages;
    }

    async function goToPage(page) {
        const targetPage = Math.max(
            1,
            Number(page) || 1
        );

        if (
            targetPage ===
            Products.state.currentPage
        ) {
            return;
        }

        if (targetPage === 1) {
            await renderShopProducts({
                page: 1
            });

            return;
        }

        const movingForward =
            targetPage >
            Products.state.currentPage;

        const cursor = movingForward
            ? Products.state.lastVisible
            : Products.state.firstVisible;

        await renderShopProducts({
            page: targetPage,
            cursor: cursor,
            direction: movingForward
                ? "next"
                : "previous"
        });

        const shopGrid =
            Products.elements.shopGrid;

        if (shopGrid) {
            shopGrid.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        }
    }

    /* ======================================================
       UI STATES
    ====================================================== */

    function showCatalogLoading(loading) {
        if (Products.elements.shopSkeleton) {
            Products.elements.shopSkeleton.hidden =
                !loading;

            Products.elements.shopSkeleton.classList.toggle(
                "active",
                loading
            );
        }

        if (Products.elements.shopGrid) {
            Products.elements.shopGrid.classList.toggle(
                "is-loading",
                loading
            );

            Products.elements.shopGrid.setAttribute(
                "aria-busy",
                String(loading)
            );
        }
    }

    function showCatalogError(error) {
        app.showToast({
            type: "error",
            title: "Collection unavailable",
            message:
                error && error.message
                    ? error.message
                    : "The collection could not be loaded."
        });
    }

    /* ======================================================
       PRODUCT ACTIONS
    ====================================================== */

    async function handleQuickAdd(productId) {
        try {
            const product =
                await fetchProductById(productId);

            if (!product) {
                throw new Error(
                    "The selected product is unavailable."
                );
            }

            if (
                product.sizes.length ||
                product.colors.length
            ) {
                if (router) {
                    await router.navigate({
                        name: "product",
                        params: {
                            id: product.id
                        }
                    });
                }

                app.showToast({
                    type: "info",
                    title: "Choose your options",
                    message:
                        "Select the preferred size and colour before adding this piece."
                });

                return;
            }

            const cartItem = {
                productId: product.id,
                name: product.name,
                slug: product.slug,
                image: product.primaryImage,
                price: product.price,
                currency: product.currency,
                quantity: 1,
                size: "",
                color: "",
                variantId: "",
                sku: product.sku,
                stock: product.inventory
            };

            if (
                window.LEternelCart &&
                typeof window.LEternelCart.addItem ===
                    "function"
            ) {
                await window.LEternelCart.addItem(
                    cartItem
                );
            } else {
                document.dispatchEvent(
                    new CustomEvent(
                        "products:addtocart",
                        {
                            detail: {
                                item: cartItem
                            }
                        }
                    )
                );
            }

            app.showToast({
                type: "success",
                title: "Added to your bag",
                message:
                    product.name +
                    " has been added to your shopping bag.",

                actionLabel: "View bag",
                onAction: app.openCart
            });
        } catch (error) {
            app.showToast({
                type: "error",
                title: "Unable to add product",
                message:
                    error.message ||
                    "The product could not be added."
            });
        }
    }

    async function handleCurrentProductAdd(
        buyImmediately
    ) {
        try {
            const item =
                buildCartProduct(
                    Products.state.currentProduct
                );

            if (
                window.LEternelCart &&
                typeof window.LEternelCart.addItem ===
                    "function"
            ) {
                await window.LEternelCart.addItem(
                    item
                );
            } else {
                document.dispatchEvent(
                    new CustomEvent(
                        "products:addtocart",
                        {
                            detail: {
                                item: item
                            }
                        }
                    )
                );
            }

            if (buyImmediately && router) {
                await router.navigate("/checkout");
                return;
            }

            app.showToast({
                type: "success",
                title: "Added to your bag",
                message:
                    item.name +
                    " has been added to your shopping bag.",

                actionLabel: "View bag",
                onAction: app.openCart
            });
        } catch (error) {
            app.showToast({
                type: "warning",
                title: "Complete your selection",
                message:
                    error.message ||
                    "Select the required product options."
            });
        }
    }

    async function handleWishlist(productId) {
        try {
            const product =
                await fetchProductById(productId);

            if (!product) {
                throw new Error(
                    "The selected product is unavailable."
                );
            }

            if (
                window.LEternelWishlist &&
                typeof window.LEternelWishlist.toggle ===
                    "function"
            ) {
                await window.LEternelWishlist.toggle(
                    product
                );
            } else {
                document.dispatchEvent(
                    new CustomEvent(
                        "products:wishlist",
                        {
                            detail: {
                                product: product
                            }
                        }
                    )
                );
            }
        } catch (error) {
            app.showToast({
                type: "error",
                title: "Wishlist unavailable",
                message:
                    error.message ||
                    "The wishlist could not be updated."
            });
        }
    }

    /* ======================================================
       EVENT BINDING
    ====================================================== */

    function bindCatalogEvents() {
        Products.elements.categoryFilters.forEach(
            function (control) {
                control.addEventListener(
                    "click",
                    function () {
                        const category =
                            control.dataset
                                .filterCategory;

                        setFilter(
                            "category",
                            Products.state.filters
                                .category === category
                                ? ""
                                : category
                        );

                        syncFilterControls();
                    }
                );
            }
        );

        Products.elements.sizeFilters.forEach(
            function (control) {
                control.addEventListener(
                    "click",
                    function () {
                        toggleArrayFilter(
                            "sizes",
                            control.dataset.filterSize
                        );

                        syncFilterControls();
                    }
                );
            }
        );

        Products.elements.colorFilters.forEach(
            function (control) {
                control.addEventListener(
                    "click",
                    function () {
                        toggleArrayFilter(
                            "colors",
                            control.dataset.filterColor
                        );

                        syncFilterControls();
                    }
                );
            }
        );

        if (Products.elements.stockFilter) {
            Products.elements.stockFilter.addEventListener(
                "change",
                function () {
                    setFilter(
                        "inStock",
                        Products.elements.stockFilter
                            .checked
                    );
                }
            );
        }

        const handlePriceChange = debounce(
            function () {
                Products.state.filters.minPrice =
                    Products.elements.minimumPrice &&
                    Products.elements.minimumPrice.value !==
                        ""
                        ? toNumber(
                              Products.elements.minimumPrice
                                  .value,
                              null
                          )
                        : null;

                Products.state.filters.maxPrice =
                    Products.elements.maximumPrice &&
                    Products.elements.maximumPrice.value !==
                        ""
                        ? toNumber(
                              Products.elements.maximumPrice
                                  .value,
                              null
                          )
                        : null;

                renderShopProducts({
                    page: 1
                });

                updateShopQueryString();
            },
            450
        );

        if (Products.elements.minimumPrice) {
            Products.elements.minimumPrice.addEventListener(
                "input",
                handlePriceChange
            );
        }

        if (Products.elements.maximumPrice) {
            Products.elements.maximumPrice.addEventListener(
                "input",
                handlePriceChange
            );
        }

        if (Products.elements.sortSelect) {
            Products.elements.sortSelect.addEventListener(
                "change",
                function () {
                    Products.state.sort =
                        Products.elements.sortSelect
                            .value;

                    Products.state.currentPage = 1;
                    Products.state.pageCursors = {};

                    renderShopProducts({
                        page: 1
                    });

                    updateShopQueryString();
                }
            );
        }

        Products.elements.clearFilters.forEach(
            function (button) {
                button.addEventListener(
                    "click",
                    clearAllFilters
                );
            }
        );
    }

    function bindProductDetailEvents() {
        if (Products.elements.productThumbnails) {
            Products.elements.productThumbnails.addEventListener(
                "click",
                function (event) {
                    const thumbnail =
                        event.target.closest(
                            "[data-product-image]"
                        );

                    if (!thumbnail) {
                        return;
                    }

                    queryAll(
                        "[data-product-image]",
                        Products.elements
                            .productThumbnails
                    ).forEach(function (button) {
                        button.classList.remove(
                            "active"
                        );
                    });

                    thumbnail.classList.add("active");

                    if (
                        Products.elements
                            .productMainImage
                    ) {
                        Products.elements.productMainImage.src =
                            thumbnail.dataset.productImage;
                    }
                }
            );
        }

        if (Products.elements.productSizes) {
            Products.elements.productSizes.addEventListener(
                "click",
                function (event) {
                    const option =
                        event.target.closest(
                            "[data-product-size]"
                        );

                    if (!option || option.disabled) {
                        return;
                    }

                    queryAll(
                        "[data-product-size]",
                        Products.elements.productSizes
                    ).forEach(function (button) {
                        button.classList.remove(
                            "active"
                        );
                    });

                    option.classList.add("active");
                }
            );
        }

        if (Products.elements.productColors) {
            Products.elements.productColors.addEventListener(
                "click",
                function (event) {
                    const option =
                        event.target.closest(
                            "[data-product-color]"
                        );

                    if (!option) {
                        return;
                    }

                    queryAll(
                        "[data-product-color]",
                        Products.elements.productColors
                    ).forEach(function (button) {
                        button.classList.remove(
                            "active"
                        );
                    });

                    option.classList.add("active");
                }
            );
        }

        if (Products.elements.addToCartButton) {
            Products.elements.addToCartButton.addEventListener(
                "click",
                function () {
                    handleCurrentProductAdd(false);
                }
            );
        }

        if (Products.elements.buyNowButton) {
            Products.elements.buyNowButton.addEventListener(
                "click",
                function () {
                    handleCurrentProductAdd(true);
                }
            );
        }
    }

    function bindDelegatedEvents() {
        document.addEventListener(
            "click",
            function (event) {
                const quickAddButton =
                    event.target.closest(
                        "[data-product-add]"
                    );

                if (quickAddButton) {
                    event.preventDefault();

                    handleQuickAdd(
                        quickAddButton.dataset.productAdd
                    );

                    return;
                }

                const wishlistButton =
                    event.target.closest(
                        "[data-product-wishlist]"
                    );

                if (wishlistButton) {
                    event.preventDefault();

                    handleWishlist(
                        wishlistButton.dataset
                            .productWishlist
                    );

                    return;
                }

                const quickViewButton =
                    event.target.closest(
                        "[data-product-quick-view]"
                    );

                if (quickViewButton) {
                    event.preventDefault();

                    if (router) {
                        router.navigate({
                            name: "product",
                            params: {
                                id:
                                    quickViewButton.dataset
                                        .productQuickView
                            }
                        });
                    }

                    return;
                }

                const pageButton =
                    event.target.closest(
                        "[data-product-page]"
                    );

                if (pageButton) {
                    event.preventDefault();

                    goToPage(
                        pageButton.dataset.productPage
                    );

                    return;
                }

                const removeFilterButton =
                    event.target.closest(
                        "[data-remove-filter]"
                    );

                if (removeFilterButton) {
                    event.preventDefault();

                    removeFilter(
                        removeFilterButton.dataset
                            .removeFilter,

                        removeFilterButton.dataset
                            .filterValue
                    );
                }
            }
        );
    }

    function bindRouterEvents() {
        document.addEventListener(
            "router:change",
            function (event) {
                const detail = event.detail || {};

                if (detail.name === "shop") {
                    applyRouteFilters(detail.query);
                    renderShopProducts({
                        page: 1
                    });
                }

                if (
                    detail.name === "collection"
                ) {
                    Products.state.filters.collection =
                        detail.params.slug || "";

                    syncFilterControls();

                    renderShopProducts({
                        page: 1
                    });
                }

                if (detail.name === "product") {
                    loadProductDetail(
                        detail.params.id
                    );
                }
            }
        );
    }

    /* ======================================================
       INITIALIZATION
    ====================================================== */

    async function initialize() {
        if (Products.initialized) {
            return;
        }

        cacheElements();
        bindCatalogEvents();
        bindProductDetailEvents();
        bindDelegatedEvents();
        bindRouterEvents();

        Products.initialized = true;

        const currentRoute =
            router &&
            router.currentRoute
                ? router.currentRoute
                : null;

        if (
            Products.elements.featuredGrid
        ) {
            renderFeaturedProducts();
        }

        if (
            currentRoute &&
            currentRoute.route.name === "shop"
        ) {
            applyRouteFilters(
                currentRoute.query
            );

            renderShopProducts({
                page: 1
            });
        }

        if (
            currentRoute &&
            currentRoute.route.name === "product"
        ) {
            loadProductDetail(
                currentRoute.params.id
            );
        }

        fetchCategories();

        document.dispatchEvent(
            new CustomEvent(
                "products:ready",
                {
                    detail: {
                        products: Products
                    }
                }
            )
        );

        console.info(
            "[Products] L'ÉTERNEL product catalog initialized."
        );
    }

    /* ======================================================
       PUBLIC API
    ====================================================== */

    Products.init = initialize;

    Products.fetchProducts =
        fetchProducts;

    Products.fetchFeaturedProducts =
        fetchFeaturedProducts;

    Products.fetchProductById =
        fetchProductById;

    Products.fetchProductBySlug =
        fetchProductBySlug;

    Products.fetchRelatedProducts =
        fetchRelatedProducts;

    Products.fetchCategories =
        fetchCategories;

    Products.renderShop =
        renderShopProducts;

    Products.renderFeatured =
        renderFeaturedProducts;

    Products.loadProduct =
        loadProductDetail;

    Products.createCard =
        createProductCard;

    Products.renderGrid =
        renderProductGrid;

    Products.formatPrice =
        formatPrice;

    Products.normalizeProduct =
        normalizeProduct;

    Products.setFilter = setFilter;
    Products.clearFilters =
        clearAllFilters;

    Products.getSelectedVariant =
        function () {
            return findSelectedVariant(
                Products.state.currentProduct
            );
        };

    Products.buildCartProduct =
        buildCartProduct;

    Products.getRecentlyViewed =
        readRecentlyViewedIds;

    window.LEternelProducts = Products;

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initialize,
            {
                once: true
            }
        );
    } else {
        initialize();
    }
})();

