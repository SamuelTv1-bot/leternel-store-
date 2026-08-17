"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   SHARED USER INTERFACE MODULE
========================================================== */

(function initializeUIModule() {
    const app = window.LEternelApp;

    if (!app) {
        throw new Error(
            "LEternelApp was not found. Load app.js before ui.js."
        );
    }

    const UI = {
        initialized: false,

        config: {
            animationThreshold: 0.14,
            animationRootMargin: "0px 0px -60px 0px",
            counterDuration: 1200,
            lightboxTransitionDuration: 300,
            dropdownCloseDelay: 120,
            mobileBreakpoint: 768
        },

        state: {
            activeDropdown: null,
            activeLightboxIndex: 0,
            lightboxImages: [],
            confirmationResolver: null,
            observer: null,
            resizeTimer: null
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
        if (
            app.utils &&
            typeof app.utils.escapeHTML === "function"
        ) {
            return app.utils.escapeHTML(value);
        }

        const element = document.createElement("div");
        element.textContent = String(value || "");

        return element.innerHTML;
    }

    function toNumber(value, fallback) {
        const number = Number(value);

        return Number.isFinite(number)
            ? number
            : Number(fallback) || 0;
    }

    function clamp(value, minimum, maximum) {
        return Math.min(
            maximum,
            Math.max(minimum, value)
        );
    }

    function isReducedMotion() {
        return window.matchMedia(
            "(prefers-reduced-motion: reduce)"
        ).matches;
    }

    function getFocusableElements(container) {
        if (!container) {
            return [];
        }

        return queryAll(
            [
                "a[href]",
                "button:not([disabled])",
                "input:not([disabled])",
                "select:not([disabled])",
                "textarea:not([disabled])",
                '[tabindex]:not([tabindex="-1"])'
            ].join(","),
            container
        ).filter(function (element) {
            return (
                element.offsetParent !== null &&
                !element.hidden
            );
        });
    }

    /* ======================================================
       ELEMENT CACHE
    ====================================================== */

    function cacheElements() {
        UI.elements = {
            accordions: queryAll(
                "[data-accordion]"
            ),

            tabs: queryAll(
                "[data-tabs]"
            ),

            counters: queryAll(
                "[data-counter]"
            ),

            quantityControls: queryAll(
                "[data-quantity-control]"
            ),

            dropdowns: queryAll(
                "[data-dropdown]"
            ),

            revealElements: queryAll(
                "[data-reveal], .reveal-on-scroll"
            ),

            lightbox:
                getById("image-lightbox") ||
                query("[data-lightbox]"),

            lightboxImage:
                getById("lightbox-image") ||
                query("[data-lightbox-image]"),

            lightboxCaption:
                getById("lightbox-caption") ||
                query("[data-lightbox-caption]"),

            lightboxClose:
                getById("lightbox-close") ||
                query("[data-lightbox-close]"),

            lightboxPrevious:
                getById("lightbox-previous") ||
                query("[data-lightbox-previous]"),

            lightboxNext:
                getById("lightbox-next") ||
                query("[data-lightbox-next]"),

            confirmationModal:
                getById("utility-confirm-modal") ||
                query("[data-confirm-modal]"),

            confirmationTitle:
                getById("utility-confirm-title") ||
                query("[data-confirm-title]"),

            confirmationMessage:
                getById("utility-confirm-message") ||
                query("[data-confirm-message]"),

            confirmationAccept:
                getById("utility-confirm-accept") ||
                query("[data-confirm-accept]"),

            confirmationCancel:
                getById("utility-confirm-cancel") ||
                query("[data-confirm-cancel]"),

            scrollProgress:
                getById("scroll-progress") ||
                query("[data-scroll-progress]"),

            stickyPurchase:
                getById("sticky-purchase-bar") ||
                query("[data-sticky-purchase]"),

            productPurchasePanel:
                getById("product-purchase-panel") ||
                query("[data-product-purchase-panel]"),

            announcementBars: queryAll(
                "[data-announcement]"
            ),

            tooltipElements: queryAll(
                "[data-tooltip]"
            ),

            copyButtons: queryAll(
                "[data-copy]"
            )
        };
    }

    /* ======================================================
       ACCORDIONS
    ====================================================== */

    function initializeAccordions() {
        UI.elements.accordions.forEach(
            function (accordion) {
                const multiple =
                    accordion.dataset.accordionMultiple ===
                    "true";

                queryAll(
                    "[data-accordion-item]",
                    accordion
                ).forEach(function (item) {
                    const trigger = query(
                        "[data-accordion-trigger]",
                        item
                    );

                    const panel = query(
                        "[data-accordion-panel]",
                        item
                    );

                    if (!trigger || !panel) {
                        return;
                    }

                    const initiallyOpen =
                        item.classList.contains("active") ||
                        item.dataset.open === "true";

                    setAccordionState(
                        item,
                        initiallyOpen,
                        false
                    );

                    trigger.addEventListener(
                        "click",
                        function () {
                            const shouldOpen =
                                !item.classList.contains(
                                    "active"
                                );

                            if (
                                shouldOpen &&
                                !multiple
                            ) {
                                queryAll(
                                    "[data-accordion-item].active",
                                    accordion
                                ).forEach(function (
                                    openItem
                                ) {
                                    if (
                                        openItem !==
                                        item
                                    ) {
                                        setAccordionState(
                                            openItem,
                                            false,
                                            true
                                        );
                                    }
                                });
                            }

                            setAccordionState(
                                item,
                                shouldOpen,
                                true
                            );
                        }
                    );
                });
            }
        );
    }

    function setAccordionState(
        item,
        open,
        animate
    ) {
        const trigger = query(
            "[data-accordion-trigger]",
            item
        );

        const panel = query(
            "[data-accordion-panel]",
            item
        );

        if (!trigger || !panel) {
            return;
        }

        item.classList.toggle(
            "active",
            open
        );

        trigger.setAttribute(
            "aria-expanded",
            String(open)
        );

        panel.setAttribute(
            "aria-hidden",
            String(!open)
        );

        if (!animate || isReducedMotion()) {
            panel.hidden = !open;
            panel.style.height = "";
            return;
        }

        panel.hidden = false;

        if (open) {
            panel.style.height = "0px";

            window.requestAnimationFrame(
                function () {
                    panel.style.height =
                        panel.scrollHeight + "px";
                }
            );

            window.setTimeout(function () {
                panel.style.height = "auto";
            }, 320);
        } else {
            panel.style.height =
                panel.scrollHeight + "px";

            window.requestAnimationFrame(
                function () {
                    panel.style.height = "0px";
                }
            );

            window.setTimeout(function () {
                panel.hidden = true;
                panel.style.height = "";
            }, 320);
        }
    }

    /* ======================================================
       TABS
    ====================================================== */

    function initializeTabs() {
        UI.elements.tabs.forEach(
            function (tabGroup) {
                const tabs = queryAll(
                    "[data-tab]",
                    tabGroup
                );

                const panels = queryAll(
                    "[data-tab-panel]",
                    tabGroup
                );

                tabs.forEach(function (tab, index) {
                    tab.setAttribute(
                        "role",
                        "tab"
                    );

                    tab.addEventListener(
                        "click",
                        function () {
                            activateTab(
                                tabGroup,
                                tab.dataset.tab,
                                true
                            );
                        }
                    );

                    tab.addEventListener(
                        "keydown",
                        function (event) {
                            handleTabKeydown(
                                event,
                                tabs,
                                index,
                                tabGroup
                            );
                        }
                    );
                });

                panels.forEach(function (panel) {
                    panel.setAttribute(
                        "role",
                        "tabpanel"
                    );
                });

                const initiallyActive =
                    tabs.find(function (tab) {
                        return tab.classList.contains(
                            "active"
                        );
                    }) || tabs[0];

                if (initiallyActive) {
                    activateTab(
                        tabGroup,
                        initiallyActive.dataset.tab,
                        false
                    );
                }
            }
        );
    }

    function activateTab(
        tabGroup,
        tabName,
        focus
    ) {
        const tabs = queryAll(
            "[data-tab]",
            tabGroup
        );

        const panels = queryAll(
            "[data-tab-panel]",
            tabGroup
        );

        tabs.forEach(function (tab) {
            const active =
                tab.dataset.tab === tabName;

            tab.classList.toggle(
                "active",
                active
            );

            tab.setAttribute(
                "aria-selected",
                String(active)
            );

            tab.tabIndex =
                active ? 0 : -1;

            if (active && focus) {
                tab.focus();
            }
        });

        panels.forEach(function (panel) {
            const active =
                panel.dataset.tabPanel ===
                tabName;

            panel.classList.toggle(
                "active",
                active
            );

            panel.hidden = !active;
        });

        document.dispatchEvent(
            new CustomEvent(
                "ui:tabchange",
                {
                    detail: {
                        group:
                            tabGroup.dataset.tabs ||
                            "",
                        tab: tabName
                    }
                }
            )
        );
    }

    function handleTabKeydown(
        event,
        tabs,
        index,
        tabGroup
    ) {
        let targetIndex = index;

        switch (event.key) {
            case "ArrowRight":
            case "ArrowDown":
                targetIndex =
                    (index + 1) %
                    tabs.length;
                break;

            case "ArrowLeft":
            case "ArrowUp":
                targetIndex =
                    (
                        index -
                        1 +
                        tabs.length
                    ) %
                    tabs.length;
                break;

            case "Home":
                targetIndex = 0;
                break;

            case "End":
                targetIndex =
                    tabs.length - 1;
                break;

            default:
                return;
        }

        event.preventDefault();

        activateTab(
            tabGroup,
            tabs[targetIndex].dataset.tab,
            true
        );
    }

    /* ======================================================
       COUNTERS
    ====================================================== */

    function initializeCounters() {
        if (!UI.elements.counters.length) {
            return;
        }

        if (
            !("IntersectionObserver" in window) ||
            isReducedMotion()
        ) {
            UI.elements.counters.forEach(
                function (counter) {
                    renderCounterFinal(counter);
                }
            );

            return;
        }

        const observer =
            new IntersectionObserver(
                function (entries) {
                    entries.forEach(
                        function (entry) {
                            if (
                                entry.isIntersecting &&
                                !entry.target.dataset
                                    .counterComplete
                            ) {
                                animateCounter(
                                    entry.target
                                );

                                observer.unobserve(
                                    entry.target
                                );
                            }
                        }
                    );
                },
                {
                    threshold: 0.5
                }
            );

        UI.elements.counters.forEach(
            function (counter) {
                observer.observe(counter);
            }
        );
    }

    function animateCounter(element) {
        const target =
            toNumber(
                element.dataset.counter,
                0
            );

        const start =
            toNumber(
                element.dataset.counterStart,
                0
            );

        const duration =
            toNumber(
                element.dataset.counterDuration,
                UI.config.counterDuration
            );

        const prefix =
            element.dataset.counterPrefix ||
            "";

        const suffix =
            element.dataset.counterSuffix ||
            "";

        const decimals =
            Math.max(
                0,
                toNumber(
                    element.dataset.counterDecimals,
                    0
                )
            );

        const startTime =
            performance.now();

        function update(currentTime) {
            const progress = clamp(
                (
                    currentTime -
                    startTime
                ) / duration,
                0,
                1
            );

            const eased =
                1 -
                Math.pow(
                    1 - progress,
                    3
                );

            const current =
                start +
                (
                    target -
                    start
                ) *
                    eased;

            element.textContent =
                prefix +
                current.toFixed(decimals) +
                suffix;

            if (progress < 1) {
                window.requestAnimationFrame(
                    update
                );
            } else {
                element.dataset.counterComplete =
                    "true";
            }
        }

        window.requestAnimationFrame(update);
    }

    function renderCounterFinal(element) {
        const target =
            toNumber(
                element.dataset.counter,
                0
            );

        const prefix =
            element.dataset.counterPrefix ||
            "";

        const suffix =
            element.dataset.counterSuffix ||
            "";

        const decimals =
            Math.max(
                0,
                toNumber(
                    element.dataset.counterDecimals,
                    0
                )
            );

        element.textContent =
            prefix +
            target.toFixed(decimals) +
            suffix;

        element.dataset.counterComplete =
            "true";
    }

    /* ======================================================
       QUANTITY CONTROLS
    ====================================================== */

    function initializeQuantityControls() {
        UI.elements.quantityControls.forEach(
            function (control) {
                const input = query(
                    "[data-quantity-input], input",
                    control
                );

                const decrease = query(
                    "[data-quantity-decrease]",
                    control
                );

                const increase = query(
                    "[data-quantity-increase]",
                    control
                );

                if (!input) {
                    return;
                }

                if (decrease) {
                    decrease.addEventListener(
                        "click",
                        function () {
                            changeQuantity(
                                input,
                                -1
                            );
                        }
                    );
                }

                if (increase) {
                    increase.addEventListener(
                        "click",
                        function () {
                            changeQuantity(
                                input,
                                1
                            );
                        }
                    );
                }

                input.addEventListener(
                    "change",
                    function () {
                        normalizeQuantityInput(
                            input
                        );
                    }
                );
            }
        );
    }

    function changeQuantity(input, amount) {
        const minimum =
            input.min !== ""
                ? toNumber(input.min, 1)
                : 1;

        const maximum =
            input.max !== ""
                ? toNumber(
                      input.max,
                      Number.MAX_SAFE_INTEGER
                  )
                : Number.MAX_SAFE_INTEGER;

        const current =
            toNumber(input.value, minimum);

        const next = clamp(
            current + amount,
            minimum,
            maximum
        );

        if (next === current) {
            return;
        }

        input.value = next;

        input.dispatchEvent(
            new Event("change", {
                bubbles: true
            })
        );

        input.dispatchEvent(
            new CustomEvent(
                "quantity:change",
                {
                    bubbles: true,
                    detail: {
                        value: next,
                        previousValue:
                            current
                    }
                }
            )
        );
    }

    function normalizeQuantityInput(input) {
        const minimum =
            input.min !== ""
                ? toNumber(input.min, 1)
                : 1;

        const maximum =
            input.max !== ""
                ? toNumber(
                      input.max,
                      Number.MAX_SAFE_INTEGER
                  )
                : Number.MAX_SAFE_INTEGER;

        input.value = clamp(
            Math.floor(
                toNumber(
                    input.value,
                    minimum
                )
            ),
            minimum,
            maximum
        );
    }

    /* ======================================================
       DROPDOWNS
    ====================================================== */

    function initializeDropdowns() {
        UI.elements.dropdowns.forEach(
            function (dropdown) {
                const trigger = query(
                    "[data-dropdown-trigger]",
                    dropdown
                );

                const menu = query(
                    "[data-dropdown-menu]",
                    dropdown
                );

                if (!trigger || !menu) {
                    return;
                }

                trigger.setAttribute(
                    "aria-expanded",
                    "false"
                );

                menu.setAttribute(
                    "aria-hidden",
                    "true"
                );

                trigger.addEventListener(
                    "click",
                    function (event) {
                        event.stopPropagation();

                        if (
                            dropdown.classList.contains(
                                "active"
                            )
                        ) {
                            closeDropdown(
                                dropdown
                            );
                        } else {
                            openDropdown(
                                dropdown
                            );
                        }
                    }
                );

                dropdown.addEventListener(
                    "keydown",
                    function (event) {
                        handleDropdownKeydown(
                            event,
                            dropdown
                        );
                    }
                );
            }
        );
    }

    function openDropdown(dropdown) {
        if (
            UI.state.activeDropdown &&
            UI.state.activeDropdown !==
                dropdown
        ) {
            closeDropdown(
                UI.state.activeDropdown
            );
        }

        const trigger = query(
            "[data-dropdown-trigger]",
            dropdown
        );

        const menu = query(
            "[data-dropdown-menu]",
            dropdown
        );

        dropdown.classList.add("active");

        if (trigger) {
            trigger.setAttribute(
                "aria-expanded",
                "true"
            );
        }

        if (menu) {
            menu.setAttribute(
                "aria-hidden",
                "false"
            );
        }

        UI.state.activeDropdown =
            dropdown;
    }

    function closeDropdown(dropdown) {
        if (!dropdown) {
            return;
        }

        const trigger = query(
            "[data-dropdown-trigger]",
            dropdown
        );

        const menu = query(
            "[data-dropdown-menu]",
            dropdown
        );

        dropdown.classList.remove("active");

        if (trigger) {
            trigger.setAttribute(
                "aria-expanded",
                "false"
            );
        }

        if (menu) {
            menu.setAttribute(
                "aria-hidden",
                "true"
            );
        }

        if (
            UI.state.activeDropdown ===
            dropdown
        ) {
            UI.state.activeDropdown =
                null;
        }
    }

    function closeAllDropdowns() {
        UI.elements.dropdowns.forEach(
            closeDropdown
        );
    }

    function handleDropdownKeydown(
        event,
        dropdown
    ) {
        if (event.key === "Escape") {
            closeDropdown(dropdown);

            const trigger = query(
                "[data-dropdown-trigger]",
                dropdown
            );

            if (trigger) {
                trigger.focus();
            }
        }
    }

    /* ======================================================
       SCROLL REVEALS
    ====================================================== */

    function initializeScrollReveals() {
        if (!UI.elements.revealElements.length) {
            return;
        }

        if (
            !("IntersectionObserver" in window) ||
            isReducedMotion()
        ) {
            UI.elements.revealElements.forEach(
                function (element) {
                    element.classList.add(
                        "revealed"
                    );
                }
            );

            return;
        }

        UI.state.observer =
            new IntersectionObserver(
                function (entries) {
                    entries.forEach(
                        function (entry) {
                            if (
                                entry.isIntersecting
                            ) {
                                const delay =
                                    toNumber(
                                        entry.target.dataset
                                            .revealDelay,
                                        0
                                    );

                                window.setTimeout(
                                    function () {
                                        entry.target.classList.add(
                                            "revealed"
                                        );
                                    },
                                    delay
                                );

                                UI.state.observer.unobserve(
                                    entry.target
                                );
                            }
                        }
                    );
                },
                {
                    threshold:
                        UI.config
                            .animationThreshold,

                    rootMargin:
                        UI.config
                            .animationRootMargin
                }
            );

        UI.elements.revealElements.forEach(
            function (element) {
                UI.state.observer.observe(
                    element
                );
            }
        );
    }

    function observeNewRevealElements(
        container
    ) {
        if (!UI.state.observer) {
            return;
        }

        queryAll(
            "[data-reveal]:not(.revealed), .reveal-on-scroll:not(.revealed)",
            container || document
        ).forEach(function (element) {
            UI.state.observer.observe(element);
        });
    }

    /* ======================================================
       IMAGE LIGHTBOX
    ====================================================== */

    function initializeLightbox() {
        ensureLightbox();

        if (UI.elements.lightboxClose) {
            UI.elements.lightboxClose.addEventListener(
                "click",
                closeLightbox
            );
        }

        if (UI.elements.lightboxPrevious) {
            UI.elements.lightboxPrevious.addEventListener(
                "click",
                function () {
                    moveLightbox(-1);
                }
            );
        }

        if (UI.elements.lightboxNext) {
            UI.elements.lightboxNext.addEventListener(
                "click",
                function () {
                    moveLightbox(1);
                }
            );
        }

        if (UI.elements.lightbox) {
            UI.elements.lightbox.addEventListener(
                "click",
                function (event) {
                    if (
                        event.target ===
                        UI.elements.lightbox
                    ) {
                        closeLightbox();
                    }
                }
            );
        }
    }

    function ensureLightbox() {
        if (UI.elements.lightbox) {
            return;
        }

        const lightbox =
            document.createElement("div");

        lightbox.id = "image-lightbox";
        lightbox.className =
            "image-lightbox";

        lightbox.setAttribute(
            "aria-hidden",
            "true"
        );

        lightbox.innerHTML = [
            '<button type="button" class="lightbox-close" data-lightbox-close aria-label="Close image viewer">',
            '<i class="fa-solid fa-xmark"></i>',
            "</button>",

            '<button type="button" class="lightbox-navigation previous" data-lightbox-previous aria-label="Previous image">',
            '<i class="fa-solid fa-chevron-left"></i>',
            "</button>",

            '<figure class="lightbox-figure">',
            '<img data-lightbox-image alt="">',
            '<figcaption data-lightbox-caption></figcaption>',
            "</figure>",

            '<button type="button" class="lightbox-navigation next" data-lightbox-next aria-label="Next image">',
            '<i class="fa-solid fa-chevron-right"></i>',
            "</button>"
        ].join("");

        document.body.appendChild(lightbox);

        UI.elements.lightbox = lightbox;
        UI.elements.lightboxImage = query(
            "[data-lightbox-image]",
            lightbox
        );
        UI.elements.lightboxCaption = query(
            "[data-lightbox-caption]",
            lightbox
        );
        UI.elements.lightboxClose = query(
            "[data-lightbox-close]",
            lightbox
        );
        UI.elements.lightboxPrevious = query(
            "[data-lightbox-previous]",
            lightbox
        );
        UI.elements.lightboxNext = query(
            "[data-lightbox-next]",
            lightbox
        );
    }

    function openLightbox(images, index) {
        ensureLightbox();

        UI.state.lightboxImages =
            normalizeLightboxImages(images);

        if (!UI.state.lightboxImages.length) {
            return;
        }

        UI.state.activeLightboxIndex =
            clamp(
                toNumber(index, 0),
                0,
                UI.state.lightboxImages.length -
                    1
            );

        renderLightboxImage();

        UI.elements.lightbox.classList.add(
            "active",
            "open"
        );

        UI.elements.lightbox.setAttribute(
            "aria-hidden",
            "false"
        );

        document.body.classList.add(
            "no-scroll"
        );

        window.setTimeout(function () {
            if (UI.elements.lightboxClose) {
                UI.elements.lightboxClose.focus();
            }
        }, 50);
    }

    function closeLightbox() {
        if (!UI.elements.lightbox) {
            return;
        }

        UI.elements.lightbox.classList.remove(
            "active",
            "open"
        );

        UI.elements.lightbox.setAttribute(
            "aria-hidden",
            "true"
        );

        document.body.classList.remove(
            "no-scroll"
        );

        UI.state.lightboxImages = [];
        UI.state.activeLightboxIndex = 0;
    }

    function moveLightbox(direction) {
        const count =
            UI.state.lightboxImages.length;

        if (count <= 1) {
            return;
        }

        UI.state.activeLightboxIndex =
            (
                UI.state.activeLightboxIndex +
                direction +
                count
            ) % count;

        renderLightboxImage();
    }

    function renderLightboxImage() {
        const image =
            UI.state.lightboxImages[
                UI.state.activeLightboxIndex
            ];

        if (
            !image ||
            !UI.elements.lightboxImage
        ) {
            return;
        }

        UI.elements.lightboxImage.classList.add(
            "changing"
        );

        window.setTimeout(function () {
            UI.elements.lightboxImage.src =
                image.url;

            UI.elements.lightboxImage.alt =
                image.alt || "";

            if (UI.elements.lightboxCaption) {
                UI.elements.lightboxCaption.textContent =
                    image.caption ||
                    image.alt ||
                    "";
            }

            UI.elements.lightboxImage.classList.remove(
                "changing"
            );
        }, 120);

        const multiple =
            UI.state.lightboxImages.length > 1;

        if (UI.elements.lightboxPrevious) {
            UI.elements.lightboxPrevious.hidden =
                !multiple;
        }

        if (UI.elements.lightboxNext) {
            UI.elements.lightboxNext.hidden =
                !multiple;
        }
    }

    function normalizeLightboxImages(images) {
        const values = Array.isArray(images)
            ? images
            : [images];

        return values
            .map(function (image) {
                if (typeof image === "string") {
                    return {
                        url: image,
                        alt: "",
                        caption: ""
                    };
                }

                return {
                    url:
                        image &&
                        (
                            image.url ||
                            image.src
                        )
                            ? image.url ||
                              image.src
                            : "",

                    alt:
                        image &&
                        image.alt
                            ? image.alt
                            : "",

                    caption:
                        image &&
                        image.caption
                            ? image.caption
                            : ""
                };
            })
            .filter(function (image) {
                return Boolean(image.url);
            });
    }

    function openLightboxFromElement(
        trigger
    ) {
        const group =
            trigger.dataset.lightboxGroup;

        let elements = [trigger];

        if (group) {
            elements = queryAll(
                '[data-lightbox-trigger][data-lightbox-group="' +
                    CSS.escape(group) +
                    '"]'
            );
        }

        const images = elements.map(
            function (element) {
                const image =
                    element.tagName === "IMG"
                        ? element
                        : query("img", element);

                return {
                    url:
                        element.dataset.lightboxSrc ||
                        (
                            image
                                ? image.currentSrc ||
                                  image.src
                                : ""
                        ),

                    alt:
                        element.dataset.lightboxAlt ||
                        (
                            image
                                ? image.alt
                                : ""
                        ),

                    caption:
                        element.dataset
                            .lightboxCaption ||
                        ""
                };
            }
        );

        const index =
            Math.max(
                0,
                elements.indexOf(trigger)
            );

        openLightbox(images, index);
    }

    /* ======================================================
       CONFIRMATION DIALOG
    ====================================================== */

    function confirm(options) {
        const settings = Object.assign(
            {
                title: "Confirm action",
                message:
                    "Are you sure you want to continue?",
                confirmLabel: "Confirm",
                cancelLabel: "Cancel",
                danger: false
            },
            options || {}
        );

        ensureConfirmationModal();

        if (!UI.elements.confirmationModal) {
            return Promise.resolve(
                window.confirm(
                    settings.message
                )
            );
        }

        if (UI.state.confirmationResolver) {
            UI.state.confirmationResolver(
                false
            );
        }

        if (UI.elements.confirmationTitle) {
            UI.elements.confirmationTitle.textContent =
                settings.title;
        }

        if (UI.elements.confirmationMessage) {
            UI.elements.confirmationMessage.textContent =
                settings.message;
        }

        if (UI.elements.confirmationAccept) {
            UI.elements.confirmationAccept.textContent =
                settings.confirmLabel;

            UI.elements.confirmationAccept.classList.toggle(
                "danger",
                settings.danger
            );
        }

        if (UI.elements.confirmationCancel) {
            UI.elements.confirmationCancel.textContent =
                settings.cancelLabel;
        }

        openModal(
            UI.elements.confirmationModal
        );

        return new Promise(function (resolve) {
            UI.state.confirmationResolver =
                resolve;
        });
    }

    function ensureConfirmationModal() {
        if (UI.elements.confirmationModal) {
            return;
        }

        const modal =
            document.createElement("div");

        modal.id = "utility-confirm-modal";
        modal.className =
            "utility-confirm-overlay";

        modal.setAttribute(
            "aria-hidden",
            "true"
        );

        modal.innerHTML = [
            '<div class="utility-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="utility-confirm-title">',
            '<div class="utility-confirm-icon">',
            '<i class="fa-solid fa-circle-question"></i>',
            "</div>",

            '<h3 id="utility-confirm-title" data-confirm-title>Confirm action</h3>',
            '<p data-confirm-message>Are you sure you want to continue?</p>',

            '<div class="utility-confirm-actions">',
            '<button type="button" class="secondary-btn" data-confirm-cancel>Cancel</button>',
            '<button type="button" class="primary-btn" data-confirm-accept>Confirm</button>',
            "</div>",
            "</div>"
        ].join("");

        document.body.appendChild(modal);

        UI.elements.confirmationModal =
            modal;

        UI.elements.confirmationTitle =
            query(
                "[data-confirm-title]",
                modal
            );

        UI.elements.confirmationMessage =
            query(
                "[data-confirm-message]",
                modal
            );

        UI.elements.confirmationAccept =
            query(
                "[data-confirm-accept]",
                modal
            );

        UI.elements.confirmationCancel =
            query(
                "[data-confirm-cancel]",
                modal
            );

        UI.elements.confirmationAccept.addEventListener(
            "click",
            function () {
                resolveConfirmation(true);
            }
        );

        UI.elements.confirmationCancel.addEventListener(
            "click",
            function () {
                resolveConfirmation(false);
            }
        );

        modal.addEventListener(
            "click",
            function (event) {
                if (event.target === modal) {
                    resolveConfirmation(false);
                }
            }
        );
    }

    function resolveConfirmation(value) {
        closeModal(
            UI.elements.confirmationModal
        );

        if (
            typeof UI.state.confirmationResolver ===
            "function"
        ) {
            const resolver =
                UI.state.confirmationResolver;

            UI.state.confirmationResolver =
                null;

            resolver(Boolean(value));
        }
    }

    /* ======================================================
       MODALS & FOCUS
    ====================================================== */

    function openModal(modal) {
        if (!modal) {
            return;
        }

        modal.classList.add(
            "active",
            "open"
        );

        modal.setAttribute(
            "aria-hidden",
            "false"
        );

        document.body.classList.add(
            "no-scroll"
        );

        const focusable =
            getFocusableElements(modal);

        if (focusable.length) {
            window.setTimeout(function () {
                focusable[0].focus();
            }, 50);
        }
    }

    function closeModal(modal) {
        if (!modal) {
            return;
        }

        modal.classList.remove(
            "active",
            "open"
        );

        modal.setAttribute(
            "aria-hidden",
            "true"
        );

        document.body.classList.remove(
            "no-scroll"
        );
    }

    function trapFocus(event, container) {
        if (
            event.key !== "Tab" ||
            !container
        ) {
            return;
        }

        const focusable =
            getFocusableElements(container);

        if (!focusable.length) {
            event.preventDefault();
            return;
        }

        const first = focusable[0];
        const last =
            focusable[
                focusable.length - 1
            ];

        if (
            event.shiftKey &&
            document.activeElement === first
        ) {
            event.preventDefault();
            last.focus();
        } else if (
            !event.shiftKey &&
            document.activeElement === last
        ) {
            event.preventDefault();
            first.focus();
        }
    }

    /* ======================================================
       SCROLL PROGRESS & STICKY PURCHASE
    ====================================================== */

    function updateScrollUI() {
        updateScrollProgress();
        updateStickyPurchaseBar();
    }

    function updateScrollProgress() {
        const progressBar =
            UI.elements.scrollProgress;

        if (!progressBar) {
            return;
        }

        const documentHeight =
            document.documentElement
                .scrollHeight -
            window.innerHeight;

        const progress =
            documentHeight > 0
                ? clamp(
                      window.scrollY /
                          documentHeight,
                      0,
                      1
                  )
                : 0;

        progressBar.style.transform =
            "scaleX(" + progress + ")";

        progressBar.setAttribute(
            "aria-valuenow",
            String(
                Math.round(
                    progress * 100
                )
            )
        );
    }

    function updateStickyPurchaseBar() {
        const sticky =
            UI.elements.stickyPurchase;

        const panel =
            UI.elements.productPurchasePanel;

        if (!sticky || !panel) {
            return;
        }

        const productPageActive =
            document.body.classList.contains(
                "page-product"
            ) ||
            (
                window.LEternelRouter &&
                window.LEternelRouter
                    .currentRoute &&
                window.LEternelRouter
                    .currentRoute.route.name ===
                    "product"
            );

        if (!productPageActive) {
            sticky.classList.remove(
                "visible"
            );

            return;
        }

        const rectangle =
            panel.getBoundingClientRect();

        const visible =
            rectangle.bottom < 0;

        sticky.classList.toggle(
            "visible",
            visible
        );
    }

    /* ======================================================
       ANNOUNCEMENTS
    ====================================================== */

    function initializeAnnouncements() {
        UI.elements.announcementBars.forEach(
            function (announcement) {
                const close = query(
                    "[data-announcement-close]",
                    announcement
                );

                const storageKey =
                    announcement.dataset
                        .announcementStorageKey;

                if (
                    storageKey &&
                    window.localStorage.getItem(
                        storageKey
                    ) === "dismissed"
                ) {
                    announcement.hidden = true;
                    return;
                }

                if (close) {
                    close.addEventListener(
                        "click",
                        function () {
                            announcement.classList.add(
                                "hiding"
                            );

                            window.setTimeout(
                                function () {
                                    announcement.hidden =
                                        true;
                                },
                                280
                            );

                            if (storageKey) {
                                window.localStorage.setItem(
                                    storageKey,
                                    "dismissed"
                                );
                            }
                        }
                    );
                }
            }
        );
    }

    /* ======================================================
       TOOLTIP & COPY
    ====================================================== */

    function initializeTooltips() {
        UI.elements.tooltipElements.forEach(
            function (element) {
                if (
                    !element.getAttribute(
                        "aria-label"
                    ) &&
                    element.dataset.tooltip
                ) {
                    element.setAttribute(
                        "aria-label",
                        element.dataset.tooltip
                    );
                }
            }
        );
    }

    function initializeCopyButtons() {
        UI.elements.copyButtons.forEach(
            function (button) {
                button.addEventListener(
                    "click",
                    async function () {
                        const value =
                            button.dataset.copy ||
                            "";

                        try {
                            await copyText(value);

                            const original =
                                button.dataset
                                    .originalLabel ||
                                button.textContent;

                            button.dataset.originalLabel =
                                original;

                            button.classList.add(
                                "copied"
                            );

                            const label = query(
                                "[data-copy-label]",
                                button
                            );

                            if (label) {
                                label.textContent =
                                    "Copied";
                            }

                            window.setTimeout(
                                function () {
                                    button.classList.remove(
                                        "copied"
                                    );

                                    if (label) {
                                        label.textContent =
                                            original;
                                    }
                                },
                                1600
                            );
                        } catch (error) {
                            app.showToast({
                                type: "error",
                                title:
                                    "Unable to copy",
                                message:
                                    "The text could not be copied."
                            });
                        }
                    }
                );
            }
        );
    }

    async function copyText(value) {
        if (
            navigator.clipboard &&
            window.isSecureContext
        ) {
            await navigator.clipboard.writeText(
                String(value || "")
            );

            return true;
        }

        const textarea =
            document.createElement(
                "textarea"
            );

        textarea.value =
            String(value || "");

        textarea.style.position =
            "fixed";

        textarea.style.opacity = "0";

        document.body.appendChild(
            textarea
        );

        textarea.focus();
        textarea.select();

        const copied =
            document.execCommand("copy");

        textarea.remove();

        if (!copied) {
            throw new Error(
                "Copy failed."
            );
        }

        return true;
    }

    /* ======================================================
       DELEGATED EVENTS
    ====================================================== */

    function bindDelegatedEvents() {
        document.addEventListener(
            "click",
            function (event) {
                const lightboxTrigger =
                    event.target.closest(
                        "[data-lightbox-trigger]"
                    );

                if (lightboxTrigger) {
                    event.preventDefault();

                    openLightboxFromElement(
                        lightboxTrigger
                    );

                    return;
                }

                const tabTrigger =
                    event.target.closest(
                        "[data-tab-target]"
                    );

                if (tabTrigger) {
                    const groupSelector =
                        tabTrigger.dataset
                            .tabGroup;

                    const group =
                        groupSelector
                            ? query(
                                  groupSelector
                              )
                            : tabTrigger.closest(
                                  "[data-tabs]"
                              );

                    if (group) {
                        event.preventDefault();

                        activateTab(
                            group,
                            tabTrigger.dataset
                                .tabTarget,
                            true
                        );
                    }

                    return;
                }

                const scrollTrigger =
                    event.target.closest(
                        "[data-scroll-to]"
                    );

                if (scrollTrigger) {
                    event.preventDefault();

                    scrollToTarget(
                        scrollTrigger.dataset
                            .scrollTo
                    );

                    return;
                }

                const modalOpen =
                    event.target.closest(
                        "[data-modal-open]"
                    );

                if (modalOpen) {
                    event.preventDefault();

                    const modal =
                        getById(
                            modalOpen.dataset
                                .modalOpen
                        ) ||
                        query(
                            modalOpen.dataset
                                .modalOpen
                        );

                    openModal(modal);

                    return;
                }

                const modalClose =
                    event.target.closest(
                        "[data-ui-modal-close]"
                    );

                if (modalClose) {
                    event.preventDefault();

                    closeModal(
                        modalClose.closest(
                            ".modal, .account-overlay, [data-modal]"
                        )
                    );
                }
            }
        );

        document.addEventListener(
            "click",
            function (event) {
                if (
                    UI.state.activeDropdown &&
                    !UI.state.activeDropdown.contains(
                        event.target
                    )
                ) {
                    closeAllDropdowns();
                }
            }
        );

        document.addEventListener(
            "keydown",
            function (event) {
                if (event.key === "Escape") {
                    if (
                        UI.elements.lightbox &&
                        UI.elements.lightbox.classList.contains(
                            "active"
                        )
                    ) {
                        closeLightbox();
                        return;
                    }

                    if (
                        UI.elements.confirmationModal &&
                        UI.elements.confirmationModal.classList.contains(
                            "active"
                        )
                    ) {
                        resolveConfirmation(false);
                        return;
                    }

                    closeAllDropdowns();
                }

                if (
                    UI.elements.lightbox &&
                    UI.elements.lightbox.classList.contains(
                        "active"
                    )
                ) {
                    if (event.key === "ArrowLeft") {
                        moveLightbox(-1);
                    }

                    if (event.key === "ArrowRight") {
                        moveLightbox(1);
                    }

                    trapFocus(
                        event,
                        UI.elements.lightbox
                    );
                }

                if (
                    UI.elements.confirmationModal &&
                    UI.elements.confirmationModal.classList.contains(
                        "active"
                    )
                ) {
                    trapFocus(
                        event,
                        UI.elements
                            .confirmationModal
                    );
                }
            }
        );
    }

    function scrollToTarget(target) {
        let element = null;

        try {
            element =
                getById(target) ||
                query(target) ||
                query(
                    '[data-section="' +
                        CSS.escape(target) +
                        '"]'
                );
        } catch (error) {
            element =
                getById(target);
        }

        if (!element) {
            return false;
        }

        element.scrollIntoView({
            behavior:
                isReducedMotion()
                    ? "auto"
                    : "smooth",

            block: "start"
        });

        return true;
    }

    /* ======================================================
       APPLICATION EVENTS
    ====================================================== */

    function bindApplicationEvents() {
        window.addEventListener(
            "scroll",
            updateScrollUI,
            {
                passive: true
            }
        );

        window.addEventListener(
            "resize",
            function () {
                window.clearTimeout(
                    UI.state.resizeTimer
                );

                UI.state.resizeTimer =
                    window.setTimeout(
                        function () {
                            updateScrollUI();

                            if (
                                window.innerWidth >
                                UI.config
                                    .mobileBreakpoint
                            ) {
                                closeAllDropdowns();
                            }
                        },
                        100
                    );
            }
        );

        document.addEventListener(
            "router:change",
            function () {
                updateScrollUI();
                observeNewRevealElements();
                closeAllDropdowns();
            }
        );

        document.addEventListener(
            "products:detailrendered",
            function () {
                cacheDynamicElements();
                updateScrollUI();
            }
        );

        document.addEventListener(
            "products:ready",
            function () {
                observeNewRevealElements();
            }
        );
    }

    function cacheDynamicElements() {
        UI.elements.stickyPurchase =
            getById(
                "sticky-purchase-bar"
            ) ||
            query(
                "[data-sticky-purchase]"
            );

        UI.elements.productPurchasePanel =
            getById(
                "product-purchase-panel"
            ) ||
            query(
                "[data-product-purchase-panel]"
            );
    }

    /* ======================================================
       INITIALIZATION
    ====================================================== */

    function initialize() {
        if (UI.initialized) {
            return;
        }

        cacheElements();

        initializeAccordions();
        initializeTabs();
        initializeCounters();
        initializeQuantityControls();
        initializeDropdowns();
        initializeScrollReveals();
        initializeLightbox();
        initializeAnnouncements();
        initializeTooltips();
        initializeCopyButtons();

        bindDelegatedEvents();
        bindApplicationEvents();

        updateScrollUI();

        UI.initialized = true;

        if (
    app &&
    typeof app.markReady === "function"
) {
    app.markReady();
}

        document.dispatchEvent(
            new CustomEvent(
                "ui:ready",
                {
                    detail: {
                        ui: UI
                    }
                }
            )
        );

        console.info(
            "[UI] L'ÉTERNEL shared interface initialized."
        );
    }

    /* ======================================================
       PUBLIC API
    ====================================================== */

    UI.init = initialize;

    UI.activateTab = activateTab;

    UI.openDropdown = openDropdown;
    UI.closeDropdown = closeDropdown;
    UI.closeAllDropdowns =
        closeAllDropdowns;

    UI.openLightbox = openLightbox;
    UI.closeLightbox = closeLightbox;
    UI.nextLightboxImage =
        function () {
            moveLightbox(1);
        };

    UI.previousLightboxImage =
        function () {
            moveLightbox(-1);
        };

    UI.confirm = confirm;

    UI.openModal = openModal;
    UI.closeModal = closeModal;

    UI.scrollTo = scrollToTarget;
    UI.copyText = copyText;

    UI.observeReveals =
        observeNewRevealElements;

    UI.refresh = function () {
        cacheElements();
        cacheDynamicElements();
        updateScrollUI();
        observeNewRevealElements();
    };

    window.LEternelUI = UI;

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