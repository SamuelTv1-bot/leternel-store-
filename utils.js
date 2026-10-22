"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   SHARED UTILITIES MODULE
========================================================== */

(function initializeUtilitiesModule() {
    const app = window.LEternelApp;

    if (!app) {
        throw new Error(
            "LEternelApp was not found. Load app.js before utils.js."
        );
    }

    const Utils = {
        initialized: false,

        config: {
            defaultLocale: "en-NG",
            defaultCurrency: "NGN",
            defaultDateFormat: {
                day: "numeric",
                month: "short",
                year: "numeric"
            },
            storagePrefix: "leternel_",
            requestTimeout: 15000,
            maximumRetryAttempts: 3
        }
    };

    /* ======================================================
       TYPE CHECKS
    ====================================================== */

    function isString(value) {
        return typeof value === "string";
    }

    function isNumber(value) {
        return (
            typeof value === "number" &&
            Number.isFinite(value)
        );
    }

    function isBoolean(value) {
        return typeof value === "boolean";
    }

    function isFunction(value) {
        return typeof value === "function";
    }

    function isObject(value) {
        return (
            value !== null &&
            typeof value === "object" &&
            !Array.isArray(value)
        );
    }

    function isArray(value) {
        return Array.isArray(value);
    }

    function isDate(value) {
        return (
            value instanceof Date &&
            !Number.isNaN(value.getTime())
        );
    }

    function isEmpty(value) {
        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {
            return true;
        }

        if (Array.isArray(value)) {
            return value.length === 0;
        }

        if (isObject(value)) {
            return Object.keys(value).length === 0;
        }

        return false;
    }

    /* ======================================================
       STRING UTILITIES
    ====================================================== */

    function escapeHTML(value) {
        const element =
            document.createElement("div");

        element.textContent =
            String(value ?? "");

        return element.innerHTML;
    }

    function decodeHTML(value) {
        const element =
            document.createElement("textarea");

        element.innerHTML =
            String(value ?? "");

        return element.value;
    }

    function capitalize(value) {
        const text =
            String(value || "");

        return (
            text.charAt(0).toUpperCase() +
            text.slice(1)
        );
    }

    function titleCase(value) {
        return String(value || "")
            .toLowerCase()
            .replace(
                /\b[a-z]/g,
                function (character) {
                    return character.toUpperCase();
                }
            );
    }

    function sentenceCase(value) {
        const text =
            String(value || "")
                .trim()
                .toLowerCase();

        return text
            ? text.charAt(0).toUpperCase() +
                  text.slice(1)
            : "";
    }

    function slugify(value) {
        return String(value || "")
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .trim()
            .replace(/&/g, " and ")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

    function truncate(value, maximumLength, suffix) {
        const text =
            String(value || "");

        const limit =
            Math.max(
                0,
                Number(maximumLength) || 0
            );

        const ending =
            suffix === undefined
                ? "…"
                : String(suffix);

        if (
            !limit ||
            text.length <= limit
        ) {
            return text;
        }

        return (
            text.slice(
                0,
                Math.max(
                    0,
                    limit - ending.length
                )
            ) + ending
        );
    }

    function stripHTML(value) {
        const element =
            document.createElement("div");

        element.innerHTML =
            String(value || "");

        return (
            element.textContent ||
            element.innerText ||
            ""
        ).trim();
    }

    function normalizeWhitespace(value) {
        return String(value || "")
            .replace(/\s+/g, " ")
            .trim();
    }

    function normalizeSearchText(value) {
        return String(value || "")
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function initials(value, maximumLetters) {
        const maximum =
            Math.max(
                1,
                Number(maximumLetters) || 2
            );

        return String(value || "")
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, maximum)
            .map(function (part) {
                return part.charAt(0);
            })
            .join("")
            .toUpperCase();
    }

    function pluralize(
        count,
        singular,
        plural
    ) {
        return Number(count) === 1
            ? singular
            : plural || singular + "s";
    }

    /* ======================================================
       NUMBER UTILITIES
    ====================================================== */

    function toNumber(value, fallback) {
        const number = Number(value);

        return Number.isFinite(number)
            ? number
            : Number(fallback) || 0;
    }

    function toInteger(value, fallback) {
        return Math.trunc(
            toNumber(value, fallback)
        );
    }

    function clamp(value, minimum, maximum) {
        return Math.min(
            maximum,
            Math.max(minimum, value)
        );
    }

    function round(value, decimals) {
        const precision =
            Math.max(
                0,
                Number(decimals) || 0
            );

        const factor =
            Math.pow(10, precision);

        return (
            Math.round(
                (
                    toNumber(value, 0) +
                    Number.EPSILON
                ) * factor
            ) / factor
        );
    }

    function percentage(value, total, decimals) {
        const totalValue =
            toNumber(total, 0);

        if (!totalValue) {
            return 0;
        }

        return round(
            (
                toNumber(value, 0) /
                totalValue
            ) * 100,
            decimals
        );
    }

    function randomNumber(minimum, maximum) {
        const minimumValue =
            Math.ceil(
                toNumber(minimum, 0)
            );

        const maximumValue =
            Math.floor(
                toNumber(maximum, minimumValue)
            );

        return Math.floor(
            Math.random() *
                (
                    maximumValue -
                    minimumValue +
                    1
                )
        ) + minimumValue;
    }

    function formatNumber(value, options) {
        try {
            return new Intl.NumberFormat(
                Utils.config.defaultLocale,
                options || {}
            ).format(toNumber(value, 0));
        } catch (error) {
            return toNumber(
                value,
                0
            ).toLocaleString();
        }
    }

    function formatCompactNumber(value) {
        return formatNumber(value, {
            notation: "compact",
            maximumFractionDigits: 1
        });
    }

    function formatCurrency(
        value,
        currency,
        options
    ) {
        const settings = Object.assign(
            {
                style: "currency",
                currency:
                    currency ||
                    Utils.config.defaultCurrency,
                maximumFractionDigits: 0
            },
            options || {}
        );

        try {
            return new Intl.NumberFormat(
                Utils.config.defaultLocale,
                settings
            ).format(toNumber(value, 0));
        } catch (error) {
            return (
                settings.currency +
                " " +
                formatNumber(value)
            );
        }
    }

    /* ======================================================
       DATE UTILITIES
    ====================================================== */

    function toDate(value) {
        if (!value) {
            return null;
        }

        if (
            value instanceof Date
        ) {
            return isDate(value)
                ? value
                : null;
        }

        if (
            typeof value.toDate ===
            "function"
        ) {
            const date = value.toDate();

            return isDate(date)
                ? date
                : null;
        }

        if (
            typeof value.seconds ===
            "number"
        ) {
            const date = new Date(
                value.seconds * 1000
            );

            return isDate(date)
                ? date
                : null;
        }

        const date = new Date(value);

        return isDate(date)
            ? date
            : null;
    }

    function formatDate(value, options) {
        const date = toDate(value);

        if (!date) {
            return "";
        }

        try {
            return new Intl.DateTimeFormat(
                Utils.config.defaultLocale,
                options ||
                    Utils.config
                        .defaultDateFormat
            ).format(date);
        } catch (error) {
            return date.toLocaleDateString();
        }
    }

    function formatDateTime(value) {
        return formatDate(value, {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });
    }

    function formatRelativeTime(value) {
        const date = toDate(value);

        if (!date) {
            return "";
        }

        const difference =
            date.getTime() - Date.now();

        const absolute =
            Math.abs(difference);

        const units = [
            {
                amount: 1000,
                unit: "second"
            },
            {
                amount: 60000,
                unit: "minute"
            },
            {
                amount: 3600000,
                unit: "hour"
            },
            {
                amount: 86400000,
                unit: "day"
            },
            {
                amount: 604800000,
                unit: "week"
            },
            {
                amount: 2629800000,
                unit: "month"
            },
            {
                amount: 31557600000,
                unit: "year"
            }
        ];

        let selected =
            units[units.length - 1];

        for (
            let index = 0;
            index < units.length;
            index += 1
        ) {
            if (
                absolute <
                units[index].amount
            ) {
                selected =
                    index === 0
                        ? units[0]
                        : units[index - 1];

                break;
            }
        }

        const quantity =
            Math.round(
                difference /
                selected.amount
            );

        try {
            return new Intl.RelativeTimeFormat(
                Utils.config.defaultLocale,
                {
                    numeric: "auto"
                }
            ).format(
                quantity,
                selected.unit
            );
        } catch (error) {
            return formatDate(date);
        }
    }

    function startOfDay(value) {
        const date =
            toDate(value) ||
            new Date();

        date.setHours(0, 0, 0, 0);

        return date;
    }

    function endOfDay(value) {
        const date =
            toDate(value) ||
            new Date();

        date.setHours(
            23,
            59,
            59,
            999
        );

        return date;
    }

    function addDays(value, days) {
        const date =
            toDate(value) ||
            new Date();

        date.setDate(
            date.getDate() +
            toInteger(days, 0)
        );

        return date;
    }

    function isExpired(value) {
        const date = toDate(value);

        return Boolean(
            date &&
            date.getTime() < Date.now()
        );
    }

    /* ======================================================
       VALIDATION
    ====================================================== */

    function isValidEmail(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
            String(value || "").trim()
        );
    }

    function isValidPhone(value) {
        const normalized =
            String(value || "")
                .replace(/[^\d+]/g, "");

        return /^\+?\d{7,15}$/.test(
            normalized
        );
    }

    function normalizePhone(value) {
        return String(value || "")
            .replace(/[^\d+]/g, "")
            .trim();
    }

    function isValidURL(value) {
        try {
            new URL(String(value || ""));
            return true;
        } catch (error) {
            return false;
        }
    }

    function isValidPostalCode(value) {
        return /^[A-Za-z0-9][A-Za-z0-9\s-]{2,11}$/.test(
            String(value || "").trim()
        );
    }

    function validatePassword(value) {
        const password =
            String(value || "");

        const rules = {
            length:
                password.length >= 8,
            uppercase:
                /[A-Z]/.test(password),
            lowercase:
                /[a-z]/.test(password),
            number:
                /\d/.test(password),
            special:
                /[^A-Za-z0-9]/.test(
                    password
                )
        };

        return {
            valid:
                rules.length &&
                rules.uppercase &&
                rules.lowercase &&
                rules.number,

            score:
                Object.keys(rules).reduce(
                    function (total, key) {
                        return (
                            total +
                            (
                                rules[key]
                                    ? 1
                                    : 0
                            )
                        );
                    },
                    0
                ),

            rules: rules
        };
    }

    function validateRequired(
        value,
        fieldName
    ) {
        if (
            value === null ||
            value === undefined ||
            String(value).trim() === ""
        ) {
            return {
                valid: false,
                message:
                    (
                        fieldName ||
                        "This field"
                    ) +
                    " is required."
            };
        }

        return {
            valid: true,
            message: ""
        };
    }

    function validateFile(
        file,
        options
    ) {
        const settings = Object.assign(
            {
                maximumSize: Infinity,
                acceptedTypes: [],
                acceptedExtensions: []
            },
            options || {}
        );

        if (!file) {
            return {
                valid: false,
                message:
                    "Choose a file."
            };
        }

        if (
            file.size >
            settings.maximumSize
        ) {
            return {
                valid: false,
                message:
                    "The file exceeds the maximum allowed size."
            };
        }

        if (
            settings.acceptedTypes.length &&
            settings.acceptedTypes.indexOf(
                file.type
            ) === -1
        ) {
            return {
                valid: false,
                message:
                    "The selected file type is not supported."
            };
        }

        if (
            settings.acceptedExtensions.length
        ) {
            const extension =
                file.name
                    .split(".")
                    .pop()
                    .toLowerCase();

            if (
                settings.acceptedExtensions.indexOf(
                    extension
                ) === -1
            ) {
                return {
                    valid: false,
                    message:
                        "The selected file extension is not supported."
                };
            }
        }

        return {
            valid: true,
            message: ""
        };
    }

    /* ======================================================
       OBJECT & ARRAY UTILITIES
    ====================================================== */

    function clone(value) {
        if (
            window.structuredClone
        ) {
            try {
                return window.structuredClone(
                    value
                );
            } catch (error) {
                // Fallback below.
            }
        }

        return JSON.parse(
            JSON.stringify(value)
        );
    }

    function deepMerge(target) {
        const sources =
            Array.prototype.slice.call(
                arguments,
                1
            );

        const output =
            isObject(target)
                ? Object.assign({}, target)
                : {};

        sources.forEach(function (source) {
            if (!isObject(source)) {
                return;
            }

            Object.keys(source).forEach(
                function (key) {
                    const value =
                        source[key];

                    if (isObject(value)) {
                        output[key] =
                            deepMerge(
                                isObject(
                                    output[key]
                                )
                                    ? output[key]
                                    : {},
                                value
                            );
                    } else if (
                        Array.isArray(value)
                    ) {
                        output[key] =
                            value.slice();
                    } else {
                        output[key] =
                            value;
                    }
                }
            );
        });

        return output;
    }

    function pick(object, keys) {
        const output = {};

        if (!object) {
            return output;
        }

        keys.forEach(function (key) {
            if (
                Object.prototype.hasOwnProperty.call(
                    object,
                    key
                )
            ) {
                output[key] =
                    object[key];
            }
        });

        return output;
    }

    function omit(object, keys) {
        const excluded =
            new Set(keys || []);

        return Object.keys(
            object || {}
        ).reduce(
            function (output, key) {
                if (!excluded.has(key)) {
                    output[key] =
                        object[key];
                }

                return output;
            },
            {}
        );
    }

    function unique(values) {
        return Array.from(
            new Set(
                Array.isArray(values)
                    ? values
                    : []
            )
        );
    }

    function uniqueBy(values, keyOrCallback) {
        const map = new Map();

        (
            Array.isArray(values)
                ? values
                : []
        ).forEach(function (item) {
            const key =
                typeof keyOrCallback ===
                "function"
                    ? keyOrCallback(item)
                    : item &&
                      item[keyOrCallback];

            if (!map.has(key)) {
                map.set(key, item);
            }
        });

        return Array.from(
            map.values()
        );
    }

    function groupBy(values, keyOrCallback) {
        return (
            Array.isArray(values)
                ? values
                : []
        ).reduce(function (groups, item) {
            const key =
                typeof keyOrCallback ===
                "function"
                    ? keyOrCallback(item)
                    : item &&
                      item[keyOrCallback];

            const groupKey =
                String(key || "undefined");

            if (!groups[groupKey]) {
                groups[groupKey] = [];
            }

            groups[groupKey].push(item);

            return groups;
        }, {});
    }

    function sortBy(
        values,
        keyOrCallback,
        direction
    ) {
        const multiplier =
            direction === "desc"
                ? -1
                : 1;

        return (
            Array.isArray(values)
                ? values.slice()
                : []
        ).sort(function (first, second) {
            const firstValue =
                typeof keyOrCallback ===
                "function"
                    ? keyOrCallback(first)
                    : first &&
                      first[keyOrCallback];

            const secondValue =
                typeof keyOrCallback ===
                "function"
                    ? keyOrCallback(second)
                    : second &&
                      second[keyOrCallback];

            if (
                firstValue ===
                secondValue
            ) {
                return 0;
            }

            return (
                firstValue >
                secondValue
                    ? 1
                    : -1
            ) * multiplier;
        });
    }

    function chunk(values, size) {
        const output = [];
        const items =
            Array.isArray(values)
                ? values
                : [];

        const chunkSize =
            Math.max(
                1,
                toInteger(size, 1)
            );

        for (
            let index = 0;
            index < items.length;
            index += chunkSize
        ) {
            output.push(
                items.slice(
                    index,
                    index + chunkSize
                )
            );
        }

        return output;
    }

    function compact(values) {
        return (
            Array.isArray(values)
                ? values
                : []
        ).filter(Boolean);
    }

    /* ======================================================
       IDENTIFIERS
    ====================================================== */

    function createId(prefix) {
        const random =
            Math.random()
                .toString(36)
                .slice(2, 10);

        return [
            prefix || "id",
            Date.now().toString(36),
            random
        ].join("-");
    }

    function createOrderReference(prefix) {
        const date = new Date();

        const dateCode = [
            date.getFullYear(),
            String(
                date.getMonth() + 1
            ).padStart(2, "0"),
            String(
                date.getDate()
            ).padStart(2, "0")
        ].join("");

        return [
            prefix || "LET",
            dateCode,
            Math.random()
                .toString(36)
                .slice(2, 8)
                .toUpperCase()
        ].join("-");
    }

    function uuid() {
        if (
            window.crypto &&
            typeof window.crypto.randomUUID ===
            "function"
        ) {
            return window.crypto.randomUUID();
        }

        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
            /[xy]/g,
            function (character) {
                const random =
                    Math.random() * 16 | 0;

                const value =
                    character === "x"
                        ? random
                        : random & 3 | 8;

                return value.toString(16);
            }
        );
    }

    /* ======================================================
       STORAGE
    ====================================================== */

    function getStorageKey(key) {
        const value =
            String(key || "");

        return value.startsWith(
            Utils.config.storagePrefix
        )
            ? value
            : Utils.config.storagePrefix +
                  value;
    }

    function setLocalStorage(
        key,
        value
    ) {
        try {
            window.localStorage.setItem(
                getStorageKey(key),
                JSON.stringify(value)
            );

            return true;
        } catch (error) {
            console.warn(
                "[Utils] Local storage write failed:",
                error
            );

            return false;
        }
    }

    function getLocalStorage(
        key,
        fallback
    ) {
        try {
            const stored =
                window.localStorage.getItem(
                    getStorageKey(key)
                );

            if (stored === null) {
                return fallback;
            }

            return JSON.parse(stored);
        } catch (error) {
            return fallback;
        }
    }

    function removeLocalStorage(key) {
        try {
            window.localStorage.removeItem(
                getStorageKey(key)
            );

            return true;
        } catch (error) {
            return false;
        }
    }

    function setSessionStorage(
        key,
        value
    ) {
        try {
            window.sessionStorage.setItem(
                getStorageKey(key),
                JSON.stringify(value)
            );

            return true;
        } catch (error) {
            return false;
        }
    }

    function getSessionStorage(
        key,
        fallback
    ) {
        try {
            const stored =
                window.sessionStorage.getItem(
                    getStorageKey(key)
                );

            return stored === null
                ? fallback
                : JSON.parse(stored);
        } catch (error) {
            return fallback;
        }
    }

    function removeSessionStorage(key) {
        try {
            window.sessionStorage.removeItem(
                getStorageKey(key)
            );

            return true;
        } catch (error) {
            return false;
        }
    }

    /* ======================================================
       URL & QUERY UTILITIES
    ====================================================== */

    function parseQuery(value) {
        const search =
            String(value || "")
                .replace(/^\?/, "");

        const output = {};

        new URLSearchParams(
            search
        ).forEach(function (
            parameterValue,
            key
        ) {
            if (
                Object.prototype.hasOwnProperty.call(
                    output,
                    key
                )
            ) {
                if (
                    !Array.isArray(
                        output[key]
                    )
                ) {
                    output[key] = [
                        output[key]
                    ];
                }

                output[key].push(
                    parameterValue
                );
            } else {
                output[key] =
                    parameterValue;
            }
        });

        return output;
    }

    function buildQuery(parameters) {
        const query =
            new URLSearchParams();

        Object.keys(
            parameters || {}
        ).forEach(function (key) {
            const value =
                parameters[key];

            if (
                value === null ||
                value === undefined ||
                value === ""
            ) {
                return;
            }

            if (Array.isArray(value)) {
                value.forEach(
                    function (item) {
                        query.append(
                            key,
                            item
                        );
                    }
                );
            } else {
                query.set(
                    key,
                    value
                );
            }
        });

        return query.toString();
    }

    function updateQueryParameter(
        key,
        value,
        replace
    ) {
        const url =
            new URL(
                window.location.href
            );

        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {
            url.searchParams.delete(key);
        } else {
            url.searchParams.set(
                key,
                value
            );
        }

        window.history[
            replace
                ? "replaceState"
                : "pushState"
        ](
            {},
            "",
            url.toString()
        );

        return url;
    }

    function getQueryParameter(key) {
        return new URLSearchParams(
            window.location.search
        ).get(key);
    }

    function isExternalURL(value) {
        try {
            const url = new URL(
                value,
                window.location.href
            );

            return (
                url.origin !==
                window.location.origin
            );
        } catch (error) {
            return false;
        }
    }

    /* ======================================================
       ASYNCHRONOUS UTILITIES
    ====================================================== */

    function sleep(milliseconds) {
        return new Promise(function (resolve) {
            window.setTimeout(
                resolve,
                Math.max(
                    0,
                    toNumber(
                        milliseconds,
                        0
                    )
                )
            );
        });
    }

    function debounce(
        callback,
        delay
    ) {
        let timeoutId = null;

        function debouncedFunction() {
            const context = this;
            const args = arguments;

            window.clearTimeout(
                timeoutId
            );

            timeoutId =
                window.setTimeout(
                    function () {
                        callback.apply(
                            context,
                            args
                        );
                    },
                    toNumber(delay, 300)
                );
        }

        debouncedFunction.cancel =
            function () {
                window.clearTimeout(
                    timeoutId
                );
            };

        return debouncedFunction;
    }

    function throttle(
        callback,
        delay
    ) {
        let lastExecution = 0;
        let timeoutId = null;

        return function throttledFunction() {
            const context = this;
            const args = arguments;
            const now = Date.now();
            const wait =
                toNumber(delay, 300) -
                (
                    now -
                    lastExecution
                );

            if (wait <= 0) {
                window.clearTimeout(
                    timeoutId
                );

                timeoutId = null;
                lastExecution = now;

                callback.apply(
                    context,
                    args
                );
            } else if (!timeoutId) {
                timeoutId =
                    window.setTimeout(
                        function () {
                            lastExecution =
                                Date.now();

                            timeoutId = null;

                            callback.apply(
                                context,
                                args
                            );
                        },
                        wait
                    );
            }
        };
    }

    function withTimeout(
        promise,
        milliseconds,
        message
    ) {
        const timeout =
            Math.max(
                1,
                toNumber(
                    milliseconds,
                    Utils.config
                        .requestTimeout
                )
            );

        return Promise.race([
            promise,
            new Promise(
                function (_, reject) {
                    window.setTimeout(
                        function () {
                            reject(
                                new Error(
                                    message ||
                                    "The request timed out."
                                )
                            );
                        },
                        timeout
                    );
                }
            )
        ]);
    }

    async function retry(
        callback,
        options
    ) {
        const settings =
            Object.assign(
                {
                    attempts:
                        Utils.config
                            .maximumRetryAttempts,
                    delay: 500,
                    factor: 2,
                    shouldRetry: function () {
                        return true;
                    }
                },
                options || {}
            );

        let lastError = null;

        for (
            let attempt = 1;
            attempt <=
            settings.attempts;
            attempt += 1
        ) {
            try {
                return await callback(
                    attempt
                );
            } catch (error) {
                lastError = error;

                if (
                    attempt >=
                        settings.attempts ||
                    !settings.shouldRetry(
                        error,
                        attempt
                    )
                ) {
                    throw error;
                }

                await sleep(
                    settings.delay *
                    Math.pow(
                        settings.factor,
                        attempt - 1
                    )
                );
            }
        }

        throw lastError;
    }

    function createDeferred() {
        let resolve;
        let reject;

        const promise =
            new Promise(function (
                resolveFunction,
                rejectFunction
            ) {
                resolve =
                    resolveFunction;

                reject =
                    rejectFunction;
            });

        return {
            promise: promise,
            resolve: resolve,
            reject: reject
        };
    }

    function onceEvent(
        target,
        eventName,
        options
    ) {
        return new Promise(
            function (resolve, reject) {
                const settings =
                    options || {};

                let timeoutId = null;

                function cleanup() {
                    target.removeEventListener(
                        eventName,
                        handleEvent
                    );

                    if (timeoutId) {
                        window.clearTimeout(
                            timeoutId
                        );
                    }
                }

                function handleEvent(event) {
                    cleanup();
                    resolve(event);
                }

                target.addEventListener(
                    eventName,
                    handleEvent,
                    {
                        once: true
                    }
                );

                if (settings.timeout) {
                    timeoutId =
                        window.setTimeout(
                            function () {
                                cleanup();

                                reject(
                                    new Error(
                                        settings.message ||
                                        "The event did not occur in time."
                                    )
                                );
                            },
                            settings.timeout
                        );
                }
            }
        );
    }

    /* ======================================================
       ERROR HANDLING
    ====================================================== */

    function normalizeError(error) {
        if (!error) {
            return {
                code: "unknown",
                message:
                    "An unknown error occurred.",
                original: error
            };
        }

        if (typeof error === "string") {
            return {
                code: "error",
                message: error,
                original: error
            };
        }

        return {
            code:
                error.code ||
                error.name ||
                "error",

            message:
                error.message ||
                "An unexpected error occurred.",

            stack:
                error.stack || "",

            original: error
        };
    }

    function friendlyFirebaseError(
        error
    ) {
        const normalized =
            normalizeError(error);

        const messages = {
            "permission-denied":
                "You do not have permission to perform this action.",

            "unauthenticated":
                "Sign in before continuing.",

            "not-found":
                "The requested information could not be found.",

            "already-exists":
                "This item already exists.",

            "resource-exhausted":
                "The service is temporarily busy. Please try again.",

            "failed-precondition":
                "This action cannot be completed in the current state.",

            unavailable:
                "The service is temporarily unavailable.",

            "deadline-exceeded":
                "The request took too long to complete.",

            "auth/network-request-failed":
                "Check your connection and try again.",

            "auth/too-many-requests":
                "Too many attempts were made. Please try again later."
        };

        return {
            code: normalized.code,
            message:
                messages[normalized.code] ||
                normalized.message,
            original:
                normalized.original
        };
    }

    function reportError(
        error,
        context
    ) {
        const normalized =
            normalizeError(error);

        console.error(
            "[L'ÉTERNEL]",
            context || "Application error",
            normalized
        );

        document.dispatchEvent(
            new CustomEvent(
                "app:error",
                {
                    detail: {
                        context:
                            context || "",
                        error: normalized
                    }
                }
            )
        );

        return normalized;
    }

    function safeExecute(
        callback,
        fallback,
        context
    ) {
        try {
            return callback();
        } catch (error) {
            reportError(
                error,
                context
            );

            return fallback;
        }
    }

    async function safeExecuteAsync(
        callback,
        fallback,
        context
    ) {
        try {
            return await callback();
        } catch (error) {
            reportError(
                error,
                context
            );

            return fallback;
        }
    }

    /* ======================================================
       DOM UTILITIES
    ====================================================== */

    function ready(callback) {
        if (
            document.readyState ===
            "loading"
        ) {
            document.addEventListener(
                "DOMContentLoaded",
                callback,
                {
                    once: true
                }
            );
        } else {
            callback();
        }
    }

    function createElement(
        tagName,
        attributes,
        children
    ) {
        const element =
            document.createElement(
                tagName
            );

        Object.keys(
            attributes || {}
        ).forEach(function (key) {
            const value =
                attributes[key];

            if (
                key === "className"
            ) {
                element.className = value;
            } else if (
                key === "textContent"
            ) {
                element.textContent =
                    value;
            } else if (
                key === "html"
            ) {
                element.innerHTML =
                    value;
            } else if (
                key.startsWith("on") &&
                typeof value === "function"
            ) {
                element.addEventListener(
                    key.slice(2)
                        .toLowerCase(),
                    value
                );
            } else if (
                value !== false &&
                value !== null &&
                value !== undefined
            ) {
                element.setAttribute(
                    key,
                    value === true
                        ? ""
                        : String(value)
                );
            }
        });

        (
            Array.isArray(children)
                ? children
                : children !== undefined
                ? [children]
                : []
        ).forEach(function (child) {
            if (
                child instanceof Node
            ) {
                element.appendChild(
                    child
                );
            } else if (
                child !== null &&
                child !== undefined
            ) {
                element.appendChild(
                    document.createTextNode(
                        String(child)
                    )
                );
            }
        });

        return element;
    }

    function scrollToElement(
        target,
        options
    ) {
        let element = target;

        if (typeof target === "string") {
            try {
                element =
                    document.getElementById(
                        target
                    ) ||
                    document.querySelector(
                        target
                    );
            } catch (error) {
                element =
                    document.getElementById(
                        target
                    );
            }
        }

        if (!element) {
            return false;
        }

        element.scrollIntoView(
            Object.assign(
                {
                    behavior:
                        window.matchMedia(
                            "(prefers-reduced-motion: reduce)"
                        ).matches
                            ? "auto"
                            : "smooth",

                    block: "start"
                },
                options || {}
            )
        );

        return true;
    }

    function focusFirst(container) {
        const element =
            container &&
            container.querySelector(
                [
                    "button:not([disabled])",
                    "a[href]",
                    "input:not([disabled])",
                    "select:not([disabled])",
                    "textarea:not([disabled])",
                    '[tabindex]:not([tabindex="-1"])'
                ].join(",")
            );

        if (element) {
            element.focus();
            return true;
        }

        return false;
    }

    function setText(
        selectorOrElement,
        value
    ) {
        const elements =
            typeof selectorOrElement ===
            "string"
                ? Array.prototype.slice.call(
                      document.querySelectorAll(
                          selectorOrElement
                      )
                  )
                : Array.isArray(
                      selectorOrElement
                  )
                ? selectorOrElement
                : [selectorOrElement];

        elements
            .filter(Boolean)
            .forEach(function (element) {
                element.textContent =
                    value === null ||
                    value === undefined
                        ? ""
                        : String(value);
            });
    }

    function toggleHidden(
        selectorOrElement,
        hidden
    ) {
        const elements =
            typeof selectorOrElement ===
            "string"
                ? Array.prototype.slice.call(
                      document.querySelectorAll(
                          selectorOrElement
                      )
                  )
                : Array.isArray(
                      selectorOrElement
                  )
                ? selectorOrElement
                : [selectorOrElement];

        elements
            .filter(Boolean)
            .forEach(function (element) {
                element.hidden =
                    Boolean(hidden);
            });
    }

    /* ======================================================
       FILE UTILITIES
    ====================================================== */

    function readFileAsDataURL(file) {
        return new Promise(
            function (resolve, reject) {
                const reader =
                    new FileReader();

                reader.onload =
                    function () {
                        resolve(reader.result);
                    };

                reader.onerror =
                    function () {
                        reject(
                            reader.error ||
                            new Error(
                                "The file could not be read."
                            )
                        );
                    };

                reader.readAsDataURL(
                    file
                );
            }
        );
    }

    function formatFileSize(bytes) {
        const size =
            Math.max(
                0,
                toNumber(bytes, 0)
            );

        if (size === 0) {
            return "0 B";
        }

        const units = [
            "B",
            "KB",
            "MB",
            "GB",
            "TB"
        ];

        const index =
            Math.min(
                units.length - 1,
                Math.floor(
                    Math.log(size) /
                    Math.log(1024)
                )
            );

        return (
            round(
                size /
                    Math.pow(
                        1024,
                        index
                    ),
                2
            ) +
            " " +
            units[index]
        );
    }

    function getFileExtension(
        filename
    ) {
        const parts =
            String(filename || "")
                .split(".");

        return parts.length > 1
            ? parts.pop().toLowerCase()
            : "";
    }

    function sanitizeFilename(
        filename
    ) {
        const extension =
            getFileExtension(
                filename
            );

        const base =
            String(filename || "")
                .replace(
                    /\.[^.]+$/,
                    ""
                );

        const safeBase =
            slugify(base) ||
            "file";

        return extension
            ? safeBase + "." + extension
            : safeBase;
    }

    /* ======================================================
       INITIALIZATION
    ====================================================== */

    function initialize() {
        if (Utils.initialized) {
            return;
        }

        /*
         * app.js may define a smaller utility collection before this file.
         * Merge rather than replace it so existing references remain valid.
         */
        app.utils = Object.assign(
            {},
            app.utils || {},
            Utils
        );

        Utils.initialized = true;

        document.dispatchEvent(
            new CustomEvent(
                "utils:ready",
                {
                    detail: {
                        utils: Utils
                    }
                }
            )
        );

        console.info(
            "[Utils] L'ÉTERNEL shared utilities initialized."
        );
    }

    /* ======================================================
       PUBLIC API
    ====================================================== */

    Object.assign(Utils, {
        isString: isString,
        isNumber: isNumber,
        isBoolean: isBoolean,
        isFunction: isFunction,
        isObject: isObject,
        isArray: isArray,
        isDate: isDate,
        isEmpty: isEmpty,

        escapeHTML: escapeHTML,
        decodeHTML: decodeHTML,
        capitalize: capitalize,
        titleCase: titleCase,
        sentenceCase: sentenceCase,
        slugify: slugify,
        truncate: truncate,
        stripHTML: stripHTML,
        normalizeWhitespace:
            normalizeWhitespace,
        normalizeSearchText:
            normalizeSearchText,
        initials: initials,
        pluralize: pluralize,

        toNumber: toNumber,
        toInteger: toInteger,
        clamp: clamp,
        round: round,
        percentage: percentage,
        randomNumber: randomNumber,
        formatNumber: formatNumber,
        formatCompactNumber:
            formatCompactNumber,
        formatCurrency:
            formatCurrency,

        toDate: toDate,
        formatDate: formatDate,
        formatDateTime:
            formatDateTime,
        formatRelativeTime:
            formatRelativeTime,
        startOfDay: startOfDay,
        endOfDay: endOfDay,
        addDays: addDays,
        isExpired: isExpired,

        isValidEmail:
            isValidEmail,
        isValidPhone:
            isValidPhone,
        normalizePhone:
            normalizePhone,
        isValidURL: isValidURL,
        isValidPostalCode:
            isValidPostalCode,
        validatePassword:
            validatePassword,
        validateRequired:
            validateRequired,
        validateFile:
            validateFile,

        clone: clone,
        deepMerge: deepMerge,
        pick: pick,
        omit: omit,
        unique: unique,
        uniqueBy: uniqueBy,
        groupBy: groupBy,
        sortBy: sortBy,
        chunk: chunk,
        compact: compact,

        createId: createId,
        createOrderReference:
            createOrderReference,
        uuid: uuid,

        getStorageKey:
            getStorageKey,
        setLocalStorage:
            setLocalStorage,
        getLocalStorage:
            getLocalStorage,
        removeLocalStorage:
            removeLocalStorage,
        setSessionStorage:
            setSessionStorage,
        getSessionStorage:
            getSessionStorage,
        removeSessionStorage:
            removeSessionStorage,

        parseQuery: parseQuery,
        buildQuery: buildQuery,
        updateQueryParameter:
            updateQueryParameter,
        getQueryParameter:
            getQueryParameter,
        isExternalURL:
            isExternalURL,

        sleep: sleep,
        debounce: debounce,
        throttle: throttle,
        withTimeout: withTimeout,
        retry: retry,
        createDeferred:
            createDeferred,
        onceEvent: onceEvent,

        normalizeError:
            normalizeError,
        friendlyFirebaseError:
            friendlyFirebaseError,
        reportError: reportError,
        safeExecute: safeExecute,
        safeExecuteAsync:
            safeExecuteAsync,

        ready: ready,
        createElement:
            createElement,
        scrollToElement:
            scrollToElement,
        focusFirst: focusFirst,
        setText: setText,
        toggleHidden:
            toggleHidden,

        readFileAsDataURL:
            readFileAsDataURL,
        formatFileSize:
            formatFileSize,
        getFileExtension:
            getFileExtension,
        sanitizeFilename:
            sanitizeFilename,

        init: initialize
    });

    window.LEternelUtils = Utils;

    if (
        document.readyState ===
        "loading"
    ) {
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