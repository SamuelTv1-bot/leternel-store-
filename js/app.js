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

        App.ready =
            true;

        App.initialized =
            true;

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