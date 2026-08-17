"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   CORE APPLICATION
========================================================== */

(function initializeApplication(global) {
    /* ======================================================
       PREVENT DUPLICATE INITIALIZATION
    ====================================================== */

    if (global.LEternelApp) {
        console.warn(
            "[App] LEternelApp already exists."
        );

        return;
    }

    /* ======================================================
       APPLICATION STATE
    ====================================================== */

    const App = {
        name:
            "L'ÉTERNEL Store",

        version:
            "1.0.0",

        initialized:
            false,

        ready:
            false,

        /* --------------------------------------------------
           Shared application state
        -------------------------------------------------- */

        state: {
            route:
                null,

            user:
                null,

            products:
                [],

            cart:
                [],

            wishlist:
                [],

            search:
                {
                    query:
                        "",
                    results:
                        []
                }
        },

        /* --------------------------------------------------
           Shared module containers
        -------------------------------------------------- */

        modules:
            {},

        services:
            {},

        utils:
            {},

        config:
            {}
    };

    /* ======================================================
       MODULE REGISTRATION
    ====================================================== */

    function registerModule(
        name,
        module
    ) {
        const moduleName =
            String(
                name ||
                ""
            )
                .trim()
                .toLowerCase();

        if (!moduleName) {
            throw new Error(
                "A module name is required."
            );
        }

        App.modules[
            moduleName
        ] =
            module;

        return module;
    }

    function getModule(
        name
    ) {
        const moduleName =
            String(
                name ||
                ""
            )
                .trim()
                .toLowerCase();

        return (
            App.modules[
                moduleName
            ] ||
            null
        );
    }

    function hasModule(
        name
    ) {
        return Boolean(
            getModule(
                name
            )
        );
    }

    /* ======================================================
       SERVICE REGISTRATION
    ====================================================== */

    function registerService(
        name,
        service
    ) {
        const serviceName =
            String(
                name ||
                ""
            )
                .trim()
                .toLowerCase();

        if (!serviceName) {
            throw new Error(
                "A service name is required."
            );
        }

        App.services[
            serviceName
        ] =
            service;

        return service;
    }

    function getService(
        name
    ) {
        const serviceName =
            String(
                name ||
                ""
            )
                .trim()
                .toLowerCase();

        return (
            App.services[
                serviceName
            ] ||
            null
        );
    }

    /* ======================================================
       STATE
    ====================================================== */

    function setState(
        key,
        value
    ) {
        if (!key) {
            return;
        }

        App.state[
            key
        ] =
            value;

        document.dispatchEvent(
            new CustomEvent(
                "app:statechange",
                {
                    detail: {
                        key:
                            key,

                        value:
                            value,

                        state:
                            App.state
                    }
                }
            )
        );
    }

    function getState(
        key
    ) {
        if (!key) {
            return App.state;
        }

        return App.state[
            key
        ];
    }

    /* ======================================================
       EVENTS
    ====================================================== */

    function emit(
        name,
        detail
    ) {
        if (!name) {
            return;
        }

        document.dispatchEvent(
            new CustomEvent(
                name,
                {
                    detail:
                        detail ||
                        {}
                }
            )
        );
    }

    function on(
        name,
        handler,
        options
    ) {
        if (
            !name ||
            typeof handler !==
                "function"
        ) {
            return function () {};
        }

        document.addEventListener(
            name,
            handler,
            options
        );

        return function unsubscribe() {
            document.removeEventListener(
                name,
                handler,
                options
            );
        };
    }

    function once(
        name,
        handler
    ) {
        return on(
            name,
            handler,
            {
                once:
                    true
            }
        );
    }

    /* ======================================================
       APPLICATION READY
    ====================================================== */
function markReady() {
    if (App.ready) {
        return;
    }

    App.ready = true;
    App.initialized = true;

    /* ======================================================
       HIDE STARTUP / SPLASH SCREEN
    ====================================================== */

    const splashSelectors = [
        "#page-loader",
        "[data-app-splash]",
        "[data-splash]",
        "[data-preloader]",
        "[data-loading-screen]",
        "#splash-screen",
        "#preloader",
        "#loading-screen",
        ".splash-screen",
        ".preloader",
        ".loading-screen"
    ];

    splashSelectors.forEach(
        function (selector) {
            const elements =
                document.querySelectorAll(
                    selector
                );

            elements.forEach(
                function (element) {
                    element.classList.add(
                        "is-hidden"
                    );

                    element.setAttribute(
                        "aria-hidden",
                        "true"
                    );

                    window.setTimeout(
                        function () {
                            if (
                                element &&
                                element.parentNode
                            ) {
                                element.parentNode.removeChild(
                                    element
                                );
                            }
                        },
                        500
                    );
                }
            );
        }
    );

    /* ======================================================
       RESTORE MAIN APP VISIBILITY
    ====================================================== */

    const appWrapper =
        document.querySelector(
            "#app-wrapper"
        );

    if (appWrapper) {
        appWrapper.classList.add(
            "is-ready"
        );

        appWrapper.removeAttribute(
            "aria-hidden"
        );
    }

    document.documentElement
        .classList.add(
            "app-ready"
        );

    document.body
        .classList.add(
            "app-ready"
        );

    emit(
        "app:ready",
        {
            app:
                App
        }
    );

    console.info(
        "[App] L'ÉTERNEL Store ready."
    );
}

    /* ======================================================
       INITIALIZATION
    ====================================================== */

    function initialize() {
        if (App.initialized) {
            return App;
        }

        App.initialized =
            true;

        emit(
            "app:initialized",
            {
                app:
                    App
            }
        );

        console.info(
            "[App] L'ÉTERNEL core initialized."
        );

        return App;
    }

    /* ======================================================
   CART COUNT
====================================================== */

function setCartCount(count) {
    const normalizedCount =
        Math.max(
            0,
            Number(count) || 0
        );

    App.state.cartCount =
        normalizedCount;

    const counters =
        document.querySelectorAll(
            [
                "[data-cart-count]",
                "#cartCount",
                ".cart-count"
            ].join(",")
        );

    counters.forEach(
        function (element) {
            element.textContent =
                String(normalizedCount);

            element.hidden =
                normalizedCount <= 0;

            element.setAttribute(
                "aria-label",
                normalizedCount +
                (
                    normalizedCount === 1
                        ? " item in bag"
                        : " items in bag"
                )
            );
        }
    );

    emit(
        "cart:count",
        {
            count:
                normalizedCount
        }
    );

    return normalizedCount;
}


/* ======================================================
   TOAST NOTIFICATIONS
====================================================== */

function showToast(options) {
    const settings =
        typeof options === "string"
            ? {
                  message:
                      options
              }
            : options || {};

    const type =
        settings.type ||
        "info";

    const title =
        settings.title ||
        "";

    const message =
        settings.message ||
        "";

    /*
     * Allow another UI module to react to the event.
     */
    emit(
        "toast:show",
        {
            type:
                type,

            title:
                title,

            message:
                message
        }
    );

    /*
     * Basic fallback toast.
     */
    let container =
        document.querySelector(
            "[data-app-toast-container]"
        );

    if (!container) {
        container =
            document.createElement(
                "div"
            );

        container.setAttribute(
            "data-app-toast-container",
            ""
        );

        container.style.position =
            "fixed";

        container.style.right =
            "20px";

        container.style.bottom =
            "20px";

        container.style.zIndex =
            "99999";

        container.style.display =
            "grid";

        container.style.gap =
            "10px";

        container.style.maxWidth =
            "360px";

        document.body.appendChild(
            container
        );
    }

    const toast =
        document.createElement(
            "div"
        );

    toast.setAttribute(
        "data-app-toast",
        type
    );

    toast.style.background =
        "#111";

    toast.style.color =
        "#fff";

    toast.style.padding =
        "14px 16px";

    toast.style.border =
        "1px solid rgba(255,255,255,0.15)";

    toast.style.fontSize =
        "13px";

    toast.style.lineHeight =
        "1.5";

    toast.style.boxShadow =
        "0 12px 30px rgba(0,0,0,0.18)";

    if (title) {
        const heading =
            document.createElement(
                "strong"
            );

        heading.textContent =
            title;

        heading.style.display =
            "block";

        heading.style.marginBottom =
            "4px";

        toast.appendChild(
            heading
        );
    }

    if (message) {
        const text =
            document.createElement(
                "span"
            );

        text.textContent =
            message;

        toast.appendChild(
            text
        );
    }

    container.appendChild(
        toast
    );

    const duration =
        Number(
            settings.duration
        ) ||
        4000;

    window.setTimeout(
        function () {
            if (
                toast &&
                toast.parentNode
            ) {
                toast.parentNode.removeChild(
                    toast
                );
            }

            if (
                container &&
                !container.children.length &&
                container.parentNode
            ) {
                container.parentNode.removeChild(
                    container
                );
            }
        },
        duration
    );

    return toast;
}


/* ======================================================
   GLOBAL LOADER
====================================================== */

function showLoader(message) {
    let loader =
        document.querySelector(
            "[data-app-loader]"
        );

    if (!loader) {
        loader =
            document.createElement(
                "div"
            );

        loader.setAttribute(
            "data-app-loader",
            ""
        );

        loader.style.position =
            "fixed";

        loader.style.inset =
            "0";

        loader.style.zIndex =
            "99998";

        loader.style.display =
            "flex";

        loader.style.alignItems =
            "center";

        loader.style.justifyContent =
            "center";

        loader.style.background =
            "rgba(10, 10, 10, 0.72)";

        loader.style.backdropFilter =
            "blur(4px)";

        const content =
            document.createElement(
                "div"
            );

        content.setAttribute(
            "data-app-loader-content",
            ""
        );

        content.style.padding =
            "20px 26px";

        content.style.background =
            "#111";

        content.style.color =
            "#fff";

        content.style.fontSize =
            "12px";

        content.style.letterSpacing =
            "0.08em";

        content.style.textTransform =
            "uppercase";

        loader.appendChild(
            content
        );

        document.body.appendChild(
            loader
        );
    }

    const content =
        loader.querySelector(
            "[data-app-loader-content]"
        );

    if (content) {
        content.textContent =
            message ||
            "Loading…";
    }

    loader.hidden =
        false;

    emit(
        "loader:show",
        {
            message:
                message ||
                "Loading…"
        }
    );

    return loader;
}


function hideLoader() {
    const loader =
        document.querySelector(
            "[data-app-loader]"
        );

    if (loader) {
        loader.hidden =
            true;
    }

    emit(
        "loader:hide",
        {}
    );
}

    /* ======================================================
       PUBLIC API
    ====================================================== */

    Object.assign(
        App,
        {
            registerModule:
                registerModule,

            getModule:
                getModule,

            hasModule:
                hasModule,

            registerService:
                registerService,

            getService:
                getService,

            setState:
                setState,

            getState:
                getState,

            emit:
                emit,

            on:
                on,

            once:
                once,

                setCartCount:
    setCartCount,

showToast:
    showToast,

showLoader:
    showLoader,

hideLoader:
    hideLoader,

            markReady:
                markReady,

            init:
                initialize
        }
    );

    /* ======================================================
       IMPORTANT:
       EXPOSE APP BEFORE OTHER JS FILES EXECUTE
    ====================================================== */

    global.LEternelApp =
        App;

    /* ======================================================
       INITIALIZE CORE
    ====================================================== */

    initialize();

})(
    typeof window !==
        "undefined"
        ? window
        : globalThis
);