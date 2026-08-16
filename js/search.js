"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   GLOBAL SEARCH & COMMAND PALETTE — FIREBASE V8
========================================================== */

(function initializeSearchModule() {
    const app = window.LEternelApp;
    const router = window.LEternelRouter;
    const productsModule = window.LEternelProducts;
    const services = window.FirebaseServices;

    if (!app) {
        throw new Error(
            "LEternelApp was not found. Load app.js before search.js."
        );
    }

    if (!services || !services.db) {
        throw new Error(
            "Firebase services were not found. Load firebase.js before search.js."
        );
    }

    const db = services.db;

    const Search = {
        initialized: false,

        config: {
            productsCollection: "products",
            categoriesCollection: "categories",

            recentStorageKey: "leternel_recent_searches",
            maximumRecentSearches: 6,
            maximumSuggestions: 8,
            maximumResults: 12,
            minimumQueryLength: 2,
            debounceDelay: 280,

            defaultCurrency: "NGN",
            defaultLocale: "en-NG",

            trendingTerms: [
                "New arrivals",
                "Evening dresses",
                "Tailored jackets",
                "Leather bags",
                "Silk",
                "Black",
                "Accessories"
            ]
        },

        state: {
            query: "",
            results: [],
            suggestions: [],
            recentSearches: [],
            activeIndex: -1,
            loading: false,
            requestId: 0,
            cachedProducts: [],
            cacheLoaded: false,
            cachePromise: null,
            commandMode: false
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
            const args = arguments;

            window.clearTimeout(timeoutId);

            timeoutId = window.setTimeout(function () {
                callback.apply(context, args);
            }, delay || Search.config.debounceDelay);
        };
    }

    function normalizeText(value) {
        return String(value || "")
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .trim();
    }

    function slugify(value) {
        return normalizeText(value)
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

    function formatPrice(value, currency) {
        if (
            productsModule &&
            typeof productsModule.formatPrice === "function"
        ) {
            return productsModule.formatPrice(
                value,
                currency || Search.config.defaultCurrency
            );
        }

        try {
            return new Intl.NumberFormat(
                Search.config.defaultLocale,
                {
                    style: "currency",
                    currency:
                        currency ||
                        Search.config.defaultCurrency,

                    maximumFractionDigits: 0
                }
            ).format(toNumber(value, 0));
        } catch (error) {
            return (
                (currency || Search.config.defaultCurrency) +
                " " +
                toNumber(value, 0).toLocaleString()
            );
        }
    }

    /* ======================================================
       ELEMENT CACHE
    ====================================================== */

    function cacheElements() {
        Search.elements = {
            overlay:
                getById("global-search-overlay") ||
                query(".global-search-overlay"),

            dialog:
                getById("global-search-dialog") ||
                query(".global-search-dialog") ||
                query("[data-search-dialog]"),

            input:
                getById("global-search-input") ||
                query(".global-search-input") ||
                query("[data-global-search-input]"),

            closeButton:
                getById("global-search-close") ||
                query(".global-search-close") ||
                query("[data-search-close]"),

            clearButton:
                getById("global-search-clear") ||
                query("[data-search-clear]"),

            submitButton:
                getById("global-search-submit") ||
                query("[data-search-submit]"),

            results:
                getById("global-search-results") ||
                query("[data-search-results]"),

            suggestions:
                getById("global-search-suggestions") ||
                query("[data-search-suggestions]"),

            recent:
                getById("recent-searches") ||
                query("[data-recent-searches]"),

            trending:
                getById("trending-searches") ||
                query("[data-trending-searches]"),

            empty:
                getById("search-empty-state") ||
                query("[data-search-empty]"),

            loading:
                getById("search-loading") ||
                query("[data-search-loading]"),

            resultCount:
                getById("search-result-count") ||
                query("[data-search-result-count]"),

            viewAll:
                getById("search-view-all") ||
                query("[data-search-view-all]"),

            clearRecent:
                getById("clear-recent-searches") ||
                query("[data-search-clear-recent]"),

            commandPalette:
                getById("command-palette") ||
                query("[data-command-palette]"),

            commandInput:
                getById("command-palette-input") ||
                query("[data-command-input]"),

            commandResults:
                getById("command-palette-results") ||
                query("[data-command-results]"),

            commandClose:
                getById("command-palette-close") ||
                query("[data-command-close]")
        };
    }

    /* ======================================================
       RECENT SEARCHES
    ====================================================== */

    function readRecentSearches() {
        try {
            const stored = window.localStorage.getItem(
                Search.config.recentStorageKey
            );

            const parsed = JSON.parse(stored || "[]");

            Search.state.recentSearches = Array.isArray(parsed)
                ? parsed
                      .map(function (item) {
                          return String(item || "").trim();
                      })
                      .filter(Boolean)
                      .slice(
                          0,
                          Search.config.maximumRecentSearches
                      )
                : [];
        } catch (error) {
            Search.state.recentSearches = [];
        }

        return Search.state.recentSearches;
    }

    function writeRecentSearches() {
        try {
            window.localStorage.setItem(
                Search.config.recentStorageKey,
                JSON.stringify(Search.state.recentSearches)
            );
        } catch (error) {
            console.warn(
                "[Search] Recent searches could not be saved:",
                error
            );
        }
    }

    function addRecentSearch(term) {
        const value = String(term || "").trim();

        if (!value) {
            return;
        }

        Search.state.recentSearches =
            Search.state.recentSearches.filter(function (item) {
                return normalizeText(item) !== normalizeText(value);
            });

        Search.state.recentSearches.unshift(value);

        Search.state.recentSearches =
            Search.state.recentSearches.slice(
                0,
                Search.config.maximumRecentSearches
            );

        writeRecentSearches();
        renderRecentSearches();
    }

    function removeRecentSearch(term) {
        Search.state.recentSearches =
            Search.state.recentSearches.filter(function (item) {
                return normalizeText(item) !== normalizeText(term);
            });

        writeRecentSearches();
        renderRecentSearches();
    }

    function clearRecentSearches() {
        Search.state.recentSearches = [];
        writeRecentSearches();
        renderRecentSearches();
    }

    function renderRecentSearches() {
        const container = Search.elements.recent;

        if (!container) {
            return;
        }

        container.innerHTML = "";

        if (!Search.state.recentSearches.length) {
            container.hidden = true;
            return;
        }

        container.hidden = false;

        container.innerHTML =
            Search.state.recentSearches
                .map(function (term) {
                    return [
                        '<div class="recent-search-item">',
                        '<button type="button" class="recent-search-term" data-search-term="' +
                            escapeHTML(term) +
                            '">',

                        '<i class="fa-solid fa-clock-rotate-left"></i>',
                        "<span>" +
                            escapeHTML(term) +
                            "</span>",
                        "</button>",

                        '<button type="button" class="recent-search-remove" data-search-remove-recent="' +
                            escapeHTML(term) +
                            '" aria-label="Remove ' +
                            escapeHTML(term) +
                            '">',

                        '<i class="fa-solid fa-xmark"></i>',
                        "</button>",
                        "</div>"
                    ].join("");
                })
                .join("");
    }

    function renderTrendingSearches() {
        const container = Search.elements.trending;

        if (!container) {
            return;
        }

        container.innerHTML =
            Search.config.trendingTerms
                .map(function (term) {
                    return (
                        '<button type="button" class="trending-search-chip" data-search-term="' +
                        escapeHTML(term) +
                        '">' +
                        escapeHTML(term) +
                        "</button>"
                    );
                })
                .join("");
    }

    /* ======================================================
       PRODUCT CACHE
    ====================================================== */

    async function loadProductCache(forceRefresh) {
        if (
            Search.state.cacheLoaded &&
            !forceRefresh
        ) {
            return Search.state.cachedProducts;
        }

        if (
            Search.state.cachePromise &&
            !forceRefresh
        ) {
            return Search.state.cachePromise;
        }

        Search.state.cachePromise = db
            .collection(Search.config.productsCollection)
            .where("active", "==", true)
            .where("published", "==", true)
            .limit(250)
            .get()
            .then(function (snapshot) {
                Search.state.cachedProducts =
                    snapshot.docs.map(function (documentSnapshot) {
                        if (
                            productsModule &&
                            typeof productsModule.normalizeProduct ===
                                "function"
                        ) {
                            return productsModule.normalizeProduct(
                                documentSnapshot
                            );
                        }

                        return normalizeProduct(documentSnapshot);
                    });

                Search.state.cacheLoaded = true;
                Search.state.cachePromise = null;

                return Search.state.cachedProducts;
            })
            .catch(function (error) {
                Search.state.cachePromise = null;
                throw error;
            });

        return Search.state.cachePromise;
    }

    function normalizeProduct(documentSnapshot) {
        const data =
            typeof documentSnapshot.data === "function"
                ? documentSnapshot.data() || {}
                : documentSnapshot || {};

        const images = Array.isArray(data.images)
            ? data.images
            : [];

        const primaryImage = images.length
            ? typeof images[0] === "string"
                ? images[0]
                : images[0].url ||
                  images[0].src ||
                  ""
            : data.image || "";

        return {
            id:
                documentSnapshot.id ||
                data.id ||
                "",

            name:
                data.name ||
                data.title ||
                "Product",

            slug:
                data.slug ||
                slugify(
                    data.name ||
                    data.title
                ),

            category: data.category || "",
            collection: data.collection || "",
            description: data.description || "",
            shortDescription:
                data.shortDescription || "",
            sku: data.sku || "",
            price: toNumber(data.price, 0),
            compareAtPrice: toNumber(
                data.compareAtPrice,
                0
            ),
            currency:
                data.currency ||
                Search.config.defaultCurrency,
            primaryImage: primaryImage,
            inStock: data.inStock !== false,
            featured: Boolean(data.featured),
            bestseller: Boolean(data.bestseller),
            newArrival: Boolean(
                data.newArrival ||
                data.isNew
            ),
            salesCount: toNumber(
                data.salesCount,
                0
            ),
            rating: toNumber(data.rating, 0)
        };
    }

    /* ======================================================
       SEARCH SCORING
    ====================================================== */

    function scoreProduct(product, searchTerm) {
        const term = normalizeText(searchTerm);

        if (!term) {
            return 0;
        }

        const name = normalizeText(product.name);
        const category = normalizeText(product.category);
        const collection = normalizeText(product.collection);
        const description = normalizeText(
            product.shortDescription ||
            product.description
        );
        const sku = normalizeText(product.sku);

        let score = 0;

        if (name === term) {
            score += 120;
        } else if (name.startsWith(term)) {
            score += 95;
        } else if (name.includes(term)) {
            score += 75;
        }

        if (category === term) {
            score += 65;
        } else if (category.includes(term)) {
            score += 45;
        }

        if (collection === term) {
            score += 60;
        } else if (collection.includes(term)) {
            score += 40;
        }

        if (sku === term) {
            score += 80;
        } else if (sku.includes(term)) {
            score += 30;
        }

        if (description.includes(term)) {
            score += 20;
        }

        const words = term.split(/\s+/).filter(Boolean);

        words.forEach(function (word) {
            if (name.includes(word)) {
                score += 18;
            }

            if (category.includes(word)) {
                score += 10;
            }

            if (collection.includes(word)) {
                score += 8;
            }

            if (description.includes(word)) {
                score += 4;
            }
        });

        if (product.featured) {
            score += 8;
        }

        if (product.bestseller) {
            score += 7;
        }

        if (product.newArrival) {
            score += 5;
        }

        score += Math.min(
            10,
            toNumber(product.salesCount, 0) / 10
        );

        score += Math.min(
            5,
            toNumber(product.rating, 0)
        );

        return score;
    }

    async function searchProducts(term, options) {
        const settings = options || {};
        const value = String(term || "").trim();

        Search.state.query = value;

        if (
            value.length <
            Search.config.minimumQueryLength
        ) {
            Search.state.results = [];
            renderInitialState();
            return [];
        }

        const requestId =
            ++Search.state.requestId;

        setLoading(true);

        try {
            const products =
                await loadProductCache(
                    Boolean(settings.forceRefresh)
                );

            if (
                requestId !==
                Search.state.requestId
            ) {
                return [];
            }

            const scored = products
                .map(function (product) {
                    return {
                        product: product,
                        score: scoreProduct(
                            product,
                            value
                        )
                    };
                })
                .filter(function (entry) {
                    return entry.score > 0;
                })
                .sort(function (a, b) {
                    if (b.score !== a.score) {
                        return b.score - a.score;
                    }

                    return (
                        toNumber(
                            b.product.salesCount,
                            0
                        ) -
                        toNumber(
                            a.product.salesCount,
                            0
                        )
                    );
                })
                .slice(
                    0,
                    settings.limit ||
                        Search.config.maximumResults
                )
                .map(function (entry) {
                    return entry.product;
                });

            Search.state.results = scored;
            Search.state.activeIndex = -1;

            renderResults(scored, value);

            document.dispatchEvent(
                new CustomEvent(
                    "search:results",
                    {
                        detail: {
                            query: value,
                            results: scored.slice()
                        }
                    }
                )
            );

            return scored;
        } catch (error) {
            console.error(
                "[Search] Product search failed:",
                error
            );

            renderSearchError();

            return [];
        } finally {
            if (
                requestId ===
                Search.state.requestId
            ) {
                setLoading(false);
            }
        }
    }

    /* ======================================================
       SUGGESTIONS
    ====================================================== */

    async function generateSuggestions(term) {
        const value = normalizeText(term);

        if (!value) {
            Search.state.suggestions = [];
            renderSuggestions([]);
            return [];
        }

        const products =
            await loadProductCache();

        const suggestionMap = new Map();

        products.forEach(function (product) {
            [
                product.name,
                product.category,
                product.collection
            ]
                .filter(Boolean)
                .forEach(function (candidate) {
                    const normalized =
                        normalizeText(candidate);

                    if (
                        normalized.includes(value)
                    ) {
                        const score =
                            normalized.startsWith(value)
                                ? 20
                                : 10;

                        const existing =
                            suggestionMap.get(candidate);

                        if (
                            !existing ||
                            score > existing.score
                        ) {
                            suggestionMap.set(
                                candidate,
                                {
                                    label: candidate,
                                    score: score
                                }
                            );
                        }
                    }
                });
        });

        Search.config.trendingTerms.forEach(
            function (termValue) {
                const normalized =
                    normalizeText(termValue);

                if (
                    normalized.includes(value)
                ) {
                    suggestionMap.set(
                        termValue,
                        {
                            label: termValue,
                            score:
                                normalized.startsWith(value)
                                    ? 18
                                    : 8
                        }
                    );
                }
            }
        );

        const suggestions =
            Array.from(
                suggestionMap.values()
            )
                .sort(function (a, b) {
                    return b.score - a.score;
                })
                .slice(
                    0,
                    Search.config.maximumSuggestions
                )
                .map(function (item) {
                    return item.label;
                });

        Search.state.suggestions =
            suggestions;

        renderSuggestions(suggestions);

        return suggestions;
    }

    function renderSuggestions(suggestions) {
        const container =
            Search.elements.suggestions;

        if (!container) {
            return;
        }

        if (!suggestions.length) {
            container.innerHTML = "";
            container.hidden = true;
            return;
        }

        container.hidden = false;

        container.innerHTML =
            suggestions
                .map(function (suggestion, index) {
                    return [
                        '<button type="button" class="search-suggestion-item" data-search-suggestion="' +
                            escapeHTML(suggestion) +
                            '" data-search-index="' +
                            index +
                            '">',

                        '<i class="fa-solid fa-magnifying-glass"></i>',
                        "<span>" +
                            highlightMatch(
                                suggestion,
                                Search.state.query
                            ) +
                            "</span>",
                        '<i class="fa-solid fa-arrow-up-right-from-square"></i>',
                        "</button>"
                    ].join("");
                })
                .join("");
    }

    function highlightMatch(value, term) {
        const text = String(value || "");
        const search = String(term || "").trim();

        if (!search) {
            return escapeHTML(text);
        }

        const index =
            normalizeText(text).indexOf(
                normalizeText(search)
            );

        if (index === -1) {
            return escapeHTML(text);
        }

        return (
            escapeHTML(text.slice(0, index)) +
            "<mark>" +
            escapeHTML(
                text.slice(
                    index,
                    index + search.length
                )
            ) +
            "</mark>" +
            escapeHTML(
                text.slice(
                    index + search.length
                )
            )
        );
    }

    /* ======================================================
       RESULT RENDERING
    ====================================================== */

    function renderResults(results, term) {
        const container =
            Search.elements.results;

        if (!container) {
            return;
        }

        if (Search.elements.resultCount) {
            Search.elements.resultCount.textContent =
                results.length === 1
                    ? "1 result"
                    : results.length +
                      " results";
        }

        if (!results.length) {
            container.innerHTML = "";

            if (Search.elements.empty) {
                Search.elements.empty.hidden =
                    false;

                const queryLabel = query(
                    "[data-search-empty-query]",
                    Search.elements.empty
                );

                if (queryLabel) {
                    queryLabel.textContent =
                        term;
                }
            }

            if (Search.elements.viewAll) {
                Search.elements.viewAll.hidden =
                    true;
            }

            return;
        }

        if (Search.elements.empty) {
            Search.elements.empty.hidden = true;
        }

        container.innerHTML =
            results
                .map(function (product, index) {
                    return createSearchResult(
                        product,
                        index,
                        term
                    );
                })
                .join("");

        if (Search.elements.viewAll) {
            Search.elements.viewAll.hidden =
                false;

            Search.elements.viewAll.dataset.searchViewAll =
                term;
        }

        updateActiveResult();
    }

    function createSearchResult(
        product,
        index,
        term
    ) {
        const productPath = router
            ? router.buildPath(
                  "product",
                  {
                      id: product.id
                  }
              )
            : "/product/" +
              encodeURIComponent(product.id);

        return [
            '<button type="button" class="global-search-result" data-search-result="' +
                escapeHTML(product.id) +
                '" data-search-index="' +
                index +
                '" data-search-path="' +
                escapeHTML(productPath) +
                '">',

            '<span class="global-search-result-image">',
            '<img src="' +
                escapeHTML(
                    product.primaryImage ||
                    "https://placehold.co/220x280?text=L%27ÉTERNEL"
                ) +
                '" alt="' +
                escapeHTML(product.name) +
                '" loading="lazy">',
            "</span>",

            '<span class="global-search-result-copy">',

            product.category
                ? '<small>' +
                  highlightMatch(
                      product.category,
                      term
                  ) +
                  "</small>"
                : "",

            "<strong>" +
                highlightMatch(
                    product.name,
                    term
                ) +
                "</strong>",

            product.collection
                ? "<span>" +
                  escapeHTML(
                      product.collection
                  ) +
                  "</span>"
                : "",

            "</span>",

            '<span class="global-search-result-price">',

            "<strong>" +
                escapeHTML(
                    formatPrice(
                        product.price,
                        product.currency
                    )
                ) +
                "</strong>",

            product.compareAtPrice >
            product.price
                ? "<del>" +
                  escapeHTML(
                      formatPrice(
                          product.compareAtPrice,
                          product.currency
                      )
                  ) +
                  "</del>"
                : "",

            !product.inStock
                ? '<small class="sold-out">Sold out</small>'
                : "",

            "</span>",

            '<i class="fa-solid fa-chevron-right"></i>',
            "</button>"
        ].join("");
    }

    function renderInitialState() {
        Search.state.results = [];
        Search.state.suggestions = [];
        Search.state.activeIndex = -1;

        if (Search.elements.results) {
            Search.elements.results.innerHTML = "";
        }

        if (Search.elements.suggestions) {
            Search.elements.suggestions.innerHTML = "";
            Search.elements.suggestions.hidden = true;
        }

        if (Search.elements.empty) {
            Search.elements.empty.hidden = true;
        }

        if (Search.elements.viewAll) {
            Search.elements.viewAll.hidden = true;
        }

        if (Search.elements.resultCount) {
            Search.elements.resultCount.textContent = "";
        }

        renderRecentSearches();
        renderTrendingSearches();
    }

    function renderSearchError() {
        if (Search.elements.results) {
            Search.elements.results.innerHTML =
                '<div class="search-error-state">' +
                '<i class="fa-solid fa-triangle-exclamation"></i>' +
                "<h3>Search unavailable</h3>" +
                "<p>We could not search the collection. Please try again.</p>" +
                "</div>";
        }
    }

    function setLoading(loading) {
        Search.state.loading =
            Boolean(loading);

        if (Search.elements.loading) {
            Search.elements.loading.hidden =
                !loading;

            Search.elements.loading.classList.toggle(
                "active",
                loading
            );
        }

        if (Search.elements.dialog) {
            Search.elements.dialog.setAttribute(
                "aria-busy",
                String(loading)
            );
        }
    }

    /* ======================================================
       SEARCH NAVIGATION
    ====================================================== */

    function getNavigableItems() {
        const container =
            Search.state.commandMode
                ? Search.elements.commandResults
                : Search.elements.dialog ||
                  Search.elements.overlay;

        if (!container) {
            return [];
        }

        return queryAll(
            [
                "[data-search-result]",
                "[data-search-suggestion]",
                "[data-search-term]",
                "[data-command-action]"
            ].join(","),
            container
        ).filter(function (element) {
            return (
                !element.disabled &&
                element.offsetParent !== null
            );
        });
    }

    function moveActiveIndex(direction) {
        const items =
            getNavigableItems();

        if (!items.length) {
            Search.state.activeIndex = -1;
            return;
        }

        Search.state.activeIndex += direction;

        if (
            Search.state.activeIndex <
            0
        ) {
            Search.state.activeIndex =
                items.length - 1;
        }

        if (
            Search.state.activeIndex >=
            items.length
        ) {
            Search.state.activeIndex = 0;
        }

        updateActiveResult();

        items[
            Search.state.activeIndex
        ].scrollIntoView({
            block: "nearest"
        });
    }

    function updateActiveResult() {
        const items =
            getNavigableItems();

        items.forEach(function (element, index) {
            const active =
                index ===
                Search.state.activeIndex;

            element.classList.toggle(
                "active",
                active
            );

            element.setAttribute(
                "aria-selected",
                String(active)
            );
        });
    }

    function activateCurrentItem() {
        const items =
            getNavigableItems();

        const active =
            items[
                Search.state.activeIndex
            ];

        if (active) {
            active.click();
            return true;
        }

        return false;
    }

    /* ======================================================
       SEARCH ACTIONS
    ====================================================== */

    async function submitSearch(term) {
        const value = String(
            term !== undefined
                ? term
                : Search.elements.input
                ? Search.elements.input.value
                : ""
        ).trim();

        if (
            value.length <
            Search.config.minimumQueryLength
        ) {
            return false;
        }

        addRecentSearch(value);

        if (router) {
            closeSearch();

            await router.navigate({
                name: "shop",
                query: {
                    q: value
                }
            });

            return true;
        }

        return false;
    }

    async function openProduct(path, productId) {
        addRecentSearch(
            Search.state.query
        );

        closeSearch();

        if (router) {
            if (path) {
                await router.navigate(path);
            } else {
                await router.navigate({
                    name: "product",
                    params: {
                        id: productId
                    }
                });
            }
        }
    }

    function applySearchTerm(term) {
        const value = String(term || "").trim();

        Search.state.query = value;

        if (Search.elements.input) {
            Search.elements.input.value =
                value;

            Search.elements.input.focus();
        }

        searchProducts(value);
        generateSuggestions(value);
    }

    function clearSearch() {
        Search.state.query = "";
        Search.state.results = [];
        Search.state.suggestions = [];
        Search.state.activeIndex = -1;

        if (Search.elements.input) {
            Search.elements.input.value = "";
            Search.elements.input.focus();
        }

        renderInitialState();
    }

    function openSearch() {
        if (
            typeof app.openSearch === "function"
        ) {
            app.openSearch();
        } else if (Search.elements.overlay) {
            Search.elements.overlay.classList.add(
                "active",
                "open"
            );

            Search.elements.overlay.setAttribute(
                "aria-hidden",
                "false"
            );

            document.body.classList.add(
                "no-scroll"
            );
        }

        Search.state.commandMode = false;
        Search.state.activeIndex = -1;

        renderInitialState();

        window.setTimeout(function () {
            if (Search.elements.input) {
                Search.elements.input.focus();
                Search.elements.input.select();
            }
        }, 100);
    }

    function closeSearch() {
        if (
            typeof app.closeSearch === "function"
        ) {
            app.closeSearch();
        } else if (Search.elements.overlay) {
            Search.elements.overlay.classList.remove(
                "active",
                "open"
            );

            Search.elements.overlay.setAttribute(
                "aria-hidden",
                "true"
            );

            document.body.classList.remove(
                "no-scroll"
            );
        }

        Search.state.activeIndex = -1;
    }

    /* ======================================================
       COMMAND PALETTE
    ====================================================== */

    const commands = [
        {
            id: "home",
            label: "Go to homepage",
            description: "Open the L'ÉTERNEL homepage",
            icon: "fa-solid fa-house",
            keywords: "home homepage start",
            action: function () {
                router.navigate("/");
            }
        },
        {
            id: "shop",
            label: "Browse the collection",
            description: "Open the complete product catalogue",
            icon: "fa-solid fa-bag-shopping",
            keywords: "shop store catalogue products",
            action: function () {
                router.navigate("/shop");
            }
        },
        {
            id: "wishlist",
            label: "Open wishlist",
            description: "View your saved pieces",
            icon: "fa-regular fa-heart",
            keywords: "wishlist saved favourites",
            action: function () {
                closeCommandPalette();
                app.openWishlist();
            }
        },
        {
            id: "cart",
            label: "Open shopping bag",
            description: "Review items in your bag",
            icon: "fa-solid fa-bag-shopping",
            keywords: "cart bag basket",
            action: function () {
                closeCommandPalette();
                app.openCart();
            }
        },
        {
            id: "account",
            label: "Open my account",
            description: "View orders, addresses, and settings",
            icon: "fa-regular fa-user",
            keywords: "account profile orders settings",
            action: function () {
                router.navigate("/account");
            }
        },
        {
            id: "orders",
            label: "View my orders",
            description: "Open your order history",
            icon: "fa-solid fa-box",
            keywords: "orders purchases delivery tracking",
            action: function () {
                router.navigate(
                    "/account/orders"
                );
            }
        },
        {
            id: "heritage",
            label: "Discover our heritage",
            description: "Read the L'ÉTERNEL story",
            icon: "fa-solid fa-landmark",
            keywords: "heritage story brand about",
            action: function () {
                router.navigate("/heritage");
            }
        },
        {
            id: "search",
            label: "Search products",
            description: "Search the L'ÉTERNEL collection",
            icon: "fa-solid fa-magnifying-glass",
            keywords: "search find products",
            action: function () {
                closeCommandPalette();
                openSearch();
            }
        },
        {
            id: "admin",
            label: "Open admin dashboard",
            description: "Manage products, orders, and customers",
            icon: "fa-solid fa-chart-line",
            keywords: "admin dashboard management",
            adminOnly: true,
            action: function () {
                router.navigate("/admin");
            }
        },
        {
            id: "logout",
            label: "Sign out",
            description: "Securely end your account session",
            icon: "fa-solid fa-arrow-right-from-bracket",
            keywords: "logout sign out exit",
            authOnly: true,
            action: function () {
                if (
                    window.LEternelAuth &&
                    typeof window.LEternelAuth.logout ===
                        "function"
                ) {
                    window.LEternelAuth.logout();
                }
            }
        }
    ];

    function getAvailableCommands(term) {
        const value = normalizeText(term);
        const user =
            services.auth.currentUser;

        const isAdmin =
            document.body.classList.contains(
                "is-admin"
            );

        return commands.filter(function (command) {
            if (
                command.authOnly &&
                !user
            ) {
                return false;
            }

            if (
                command.adminOnly &&
                !isAdmin
            ) {
                return false;
            }

            if (!value) {
                return true;
            }

            return normalizeText(
                [
                    command.label,
                    command.description,
                    command.keywords
                ].join(" ")
            ).includes(value);
        });
    }

    function renderCommands(term) {
        const container =
            Search.elements.commandResults;

        if (!container) {
            return;
        }

        const available =
            getAvailableCommands(term);

        Search.state.activeIndex = -1;

        container.innerHTML = available.length
            ? available
                  .map(function (command, index) {
                      return [
                          '<button type="button" class="command-palette-item" data-command-action="' +
                              escapeHTML(command.id) +
                              '" data-search-index="' +
                              index +
                              '">',

                          '<span class="command-palette-icon">',
                          '<i class="' +
                              escapeHTML(
                                  command.icon
                              ) +
                              '"></i>',
                          "</span>",

                          '<span class="command-palette-copy">',
                          "<strong>" +
                              escapeHTML(
                                  command.label
                              ) +
                              "</strong>",

                          "<small>" +
                              escapeHTML(
                                  command.description
                              ) +
                              "</small>",
                          "</span>",

                          '<span class="command-palette-enter">↵</span>',
                          "</button>"
                      ].join("");
                  })
                  .join("")
            : '<div class="command-palette-empty"><p>No matching commands.</p></div>';
    }

    function openCommandPalette() {
        const palette =
            Search.elements.commandPalette;

        if (!palette) {
            openSearch();
            return;
        }

        Search.state.commandMode = true;
        Search.state.activeIndex = -1;

        palette.classList.add(
            "active",
            "open"
        );

        palette.setAttribute(
            "aria-hidden",
            "false"
        );

        document.body.classList.add(
            "no-scroll"
        );

        if (Search.elements.commandInput) {
            Search.elements.commandInput.value = "";
        }

        renderCommands("");

        window.setTimeout(function () {
            if (Search.elements.commandInput) {
                Search.elements.commandInput.focus();
            }
        }, 100);
    }

    function closeCommandPalette() {
        const palette =
            Search.elements.commandPalette;

        if (!palette) {
            return;
        }

        palette.classList.remove(
            "active",
            "open"
        );

        palette.setAttribute(
            "aria-hidden",
            "true"
        );

        document.body.classList.remove(
            "no-scroll"
        );

        Search.state.commandMode = false;
        Search.state.activeIndex = -1;
    }

    function executeCommand(commandId) {
        const command = commands.find(
            function (item) {
                return item.id === commandId;
            }
        );

        if (!command) {
            return false;
        }

        closeCommandPalette();

        Promise.resolve(
            command.action()
        ).catch(function (error) {
            app.showToast({
                type: "error",
                title: "Command unavailable",
                message:
                    error.message ||
                    "The command could not be completed."
            });
        });

        return true;
    }

    /* ======================================================
       INPUT EVENTS
    ====================================================== */

    const handleSearchInput =
        debounce(function () {
            if (!Search.elements.input) {
                return;
            }

            const value =
                Search.elements.input.value.trim();

            Search.state.query = value;
            Search.state.activeIndex = -1;

            if (
                value.length <
                Search.config.minimumQueryLength
            ) {
                renderInitialState();

                if (value) {
                    generateSuggestions(value);
                }

                return;
            }

            searchProducts(value);
            generateSuggestions(value);
        }, Search.config.debounceDelay);

    function handleSearchKeydown(event) {
        switch (event.key) {
            case "ArrowDown":
                event.preventDefault();
                moveActiveIndex(1);
                break;

            case "ArrowUp":
                event.preventDefault();
                moveActiveIndex(-1);
                break;

            case "Enter":
                event.preventDefault();

                if (!activateCurrentItem()) {
                    submitSearch();
                }

                break;

            case "Escape":
                event.preventDefault();
                closeSearch();
                break;

            default:
                break;
        }
    }

    function handleCommandKeydown(event) {
        switch (event.key) {
            case "ArrowDown":
                event.preventDefault();
                moveActiveIndex(1);
                break;

            case "ArrowUp":
                event.preventDefault();
                moveActiveIndex(-1);
                break;

            case "Enter":
                event.preventDefault();
                activateCurrentItem();
                break;

            case "Escape":
                event.preventDefault();
                closeCommandPalette();
                break;

            default:
                break;
        }
    }

    /* ======================================================
       EVENT BINDING
    ====================================================== */

    function bindSearchEvents() {
        if (Search.elements.input) {
            Search.elements.input.addEventListener(
                "input",
                handleSearchInput
            );

            Search.elements.input.addEventListener(
                "keydown",
                handleSearchKeydown
            );
        }

        if (Search.elements.clearButton) {
            Search.elements.clearButton.addEventListener(
                "click",
                clearSearch
            );
        }

        if (Search.elements.submitButton) {
            Search.elements.submitButton.addEventListener(
                "click",
                function () {
                    submitSearch();
                }
            );
        }

        if (Search.elements.closeButton) {
            Search.elements.closeButton.addEventListener(
                "click",
                closeSearch
            );
        }

        if (Search.elements.clearRecent) {
            Search.elements.clearRecent.addEventListener(
                "click",
                clearRecentSearches
            );
        }

        if (Search.elements.viewAll) {
            Search.elements.viewAll.addEventListener(
                "click",
                function () {
                    submitSearch(
                        Search.elements.viewAll.dataset
                            .searchViewAll ||
                            Search.state.query
                    );
                }
            );
        }
    }

    function bindCommandEvents() {
        if (Search.elements.commandInput) {
            Search.elements.commandInput.addEventListener(
                "input",
                function () {
                    renderCommands(
                        Search.elements
                            .commandInput.value
                    );
                }
            );

            Search.elements.commandInput.addEventListener(
                "keydown",
                handleCommandKeydown
            );
        }

        if (Search.elements.commandClose) {
            Search.elements.commandClose.addEventListener(
                "click",
                closeCommandPalette
            );
        }
    }

    function bindDelegatedEvents() {
        document.addEventListener(
            "click",
            function (event) {
                const searchTermButton =
                    event.target.closest(
                        "[data-search-term]"
                    );

                if (searchTermButton) {
                    event.preventDefault();

                    applySearchTerm(
                        searchTermButton.dataset
                            .searchTerm
                    );

                    return;
                }

                const suggestionButton =
                    event.target.closest(
                        "[data-search-suggestion]"
                    );

                if (suggestionButton) {
                    event.preventDefault();

                    applySearchTerm(
                        suggestionButton.dataset
                            .searchSuggestion
                    );

                    return;
                }

                const resultButton =
                    event.target.closest(
                        "[data-search-result]"
                    );

                if (resultButton) {
                    event.preventDefault();

                    openProduct(
                        resultButton.dataset
                            .searchPath,

                        resultButton.dataset
                            .searchResult
                    );

                    return;
                }

                const removeRecentButton =
                    event.target.closest(
                        "[data-search-remove-recent]"
                    );

                if (removeRecentButton) {
                    event.preventDefault();
                    event.stopPropagation();

                    removeRecentSearch(
                        removeRecentButton.dataset
                            .searchRemoveRecent
                    );

                    return;
                }

                const commandButton =
                    event.target.closest(
                        "[data-command-action]"
                    );

                if (commandButton) {
                    event.preventDefault();

                    executeCommand(
                        commandButton.dataset
                            .commandAction
                    );

                    return;
                }

                const searchTrigger =
                    event.target.closest(
                        "[data-search-open], .search-trigger, .nav-search-button"
                    );

                if (searchTrigger) {
                    event.preventDefault();
                    openSearch();
                }
            }
        );

        document.addEventListener(
            "keydown",
            function (event) {
                const key =
                    event.key.toLowerCase();

                const commandShortcut =
                    (event.ctrlKey ||
                        event.metaKey) &&
                    key === "k";

                if (commandShortcut) {
                    event.preventDefault();

                    if (
                        Search.elements.commandPalette
                    ) {
                        if (
                            Search.elements.commandPalette.classList.contains(
                                "active"
                            )
                        ) {
                            closeCommandPalette();
                        } else {
                            openCommandPalette();
                        }
                    } else {
                        openSearch();
                    }

                    return;
                }

                if (
                    event.key === "/" &&
                    !isTextInput(event.target)
                ) {
                    event.preventDefault();
                    openSearch();
                }
            }
        );

        if (Search.elements.overlay) {
            Search.elements.overlay.addEventListener(
                "click",
                function (event) {
                    if (
                        event.target ===
                        Search.elements.overlay
                    ) {
                        closeSearch();
                    }
                }
            );
        }

        if (Search.elements.commandPalette) {
            Search.elements.commandPalette.addEventListener(
                "click",
                function (event) {
                    if (
                        event.target ===
                        Search.elements.commandPalette
                    ) {
                        closeCommandPalette();
                    }
                }
            );
        }
    }

    function isTextInput(element) {
        if (!element) {
            return false;
        }

        const tag =
            element.tagName.toLowerCase();

        return (
            tag === "input" ||
            tag === "textarea" ||
            tag === "select" ||
            element.isContentEditable
        );
    }

    function bindApplicationEvents() {
        document.addEventListener(
            "products:ready",
            function () {
                Search.state.cacheLoaded = false;
                Search.state.cachePromise = null;
            }
        );

        document.addEventListener(
            "router:change",
            function () {
                Search.state.activeIndex = -1;
            }
        );

        document.addEventListener(
            "auth:statechange",
            function () {
                if (
                    Search.state.commandMode
                ) {
                    renderCommands(
                        Search.elements.commandInput
                            ? Search.elements.commandInput.value
                            : ""
                    );
                }
            }
        );
    }

    /* ======================================================
       INITIALIZATION
    ====================================================== */

    function initialize() {
        if (Search.initialized) {
            return;
        }

        cacheElements();
        readRecentSearches();

        bindSearchEvents();
        bindCommandEvents();
        bindDelegatedEvents();
        bindApplicationEvents();

        renderInitialState();

        Search.initialized = true;

        document.dispatchEvent(
            new CustomEvent(
                "search:ready",
                {
                    detail: {
                        search: Search
                    }
                }
            )
        );

        console.info(
            "[Search] L'ÉTERNEL global search initialized."
        );
    }

    /* ======================================================
       PUBLIC API
    ====================================================== */

    Search.init = initialize;

    Search.open = openSearch;
    Search.close = closeSearch;
    Search.clear = clearSearch;

    Search.search = searchProducts;
    Search.submit = submitSearch;
    Search.applyTerm = applySearchTerm;

    Search.loadCache = loadProductCache;
    Search.refreshCache = function () {
        return loadProductCache(true);
    };

    Search.getRecentSearches = function () {
        return Search.state.recentSearches.slice();
    };

    Search.addRecentSearch = addRecentSearch;
    Search.removeRecentSearch =
        removeRecentSearch;
    Search.clearRecentSearches =
        clearRecentSearches;

    Search.openCommandPalette =
        openCommandPalette;

    Search.closeCommandPalette =
        closeCommandPalette;

    Search.executeCommand =
        executeCommand;

    window.LEternelSearch = Search;

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