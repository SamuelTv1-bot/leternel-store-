"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   PROVIDER FETCH TEST HARNESS

   Supports:
   - Global fetch interception
   - Ordered and reusable mock routes
   - Method, URL, header, and body matching
   - JSON, text, and empty responses
   - Network errors
   - Abort signals
   - Artificial delays
   - Request inspection
   - Strict unexpected-request handling
========================================================== */

/* ==========================================================
   VALUE HELPERS
========================================================== */

function cloneValue(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    if (Buffer.isBuffer(value)) {
        return Buffer.from(value);
    }

    if (value instanceof Date) {
        return new Date(
            value.getTime()
        );
    }

    if (value instanceof URL) {
        return new URL(
            value.toString()
        );
    }

    if (Array.isArray(value)) {
        return value.map(
            cloneValue
        );
    }

    if (
        typeof value === "object"
    ) {
        return Object.keys(value)
            .reduce(
                function (
                    output,
                    key
                ) {
                    output[key] =
                        cloneValue(
                            value[key]
                        );

                    return output;
                },
                {}
            );
    }

    return value;
}

function deepEqual(first, second) {
    if (first === second) {
        return true;
    }

    if (
        Buffer.isBuffer(first) &&
        Buffer.isBuffer(second)
    ) {
        return first.equals(second);
    }

    if (
        first instanceof Date &&
        second instanceof Date
    ) {
        return (
            first.getTime() ===
            second.getTime()
        );
    }

    if (
        Array.isArray(first) &&
        Array.isArray(second)
    ) {
        return (
            first.length ===
                second.length &&
            first.every(
                function (
                    value,
                    index
                ) {
                    return deepEqual(
                        value,
                        second[index]
                    );
                }
            )
        );
    }

    if (
        first &&
        second &&
        typeof first === "object" &&
        typeof second === "object"
    ) {
        const firstKeys =
            Object.keys(first);

        const secondKeys =
            Object.keys(second);

        return (
            firstKeys.length ===
                secondKeys.length &&
            firstKeys.every(
                function (key) {
                    return (
                        Object.prototype
                            .hasOwnProperty
                            .call(
                                second,
                                key
                            ) &&
                        deepEqual(
                            first[key],
                            second[key]
                        )
                    );
                }
            )
        );
    }

    return false;
}

function delay(milliseconds) {
    return new Promise(
        function (resolve) {
            setTimeout(
                resolve,
                milliseconds
            );
        }
    );
}

/* ==========================================================
   HEADER HELPERS
========================================================== */

function normalizeHeaderName(name) {
    return String(name || "")
        .trim()
        .toLowerCase();
}

function normalizeHeaders(headers) {
    const output = {};

    if (!headers) {
        return output;
    }

    if (
        typeof headers.forEach ===
        "function"
    ) {
        headers.forEach(
            function (
                value,
                name
            ) {
                output[
                    normalizeHeaderName(
                        name
                    )
                ] =
                    String(value);
            }
        );

        return output;
    }

    if (
        Array.isArray(headers)
    ) {
        headers.forEach(
            function (entry) {
                output[
                    normalizeHeaderName(
                        entry[0]
                    )
                ] =
                    String(entry[1]);
            }
        );

        return output;
    }

    Object.keys(headers)
        .forEach(
            function (name) {
                output[
                    normalizeHeaderName(
                        name
                    )
                ] =
                    String(headers[name]);
            }
        );

    return output;
}

function createHeaders(headers) {
    const values =
        normalizeHeaders(
            headers
        );

    return {
        get:
            function (name) {
                const key =
                    normalizeHeaderName(
                        name
                    );

                return Object.prototype
                    .hasOwnProperty
                    .call(
                        values,
                        key
                    )
                    ? values[key]
                    : null;
            },

        has:
            function (name) {
                return Object.prototype
                    .hasOwnProperty
                    .call(
                        values,
                        normalizeHeaderName(
                            name
                        )
                    );
            },

        entries:
            function () {
                return Object.entries(
                    values
                )[Symbol.iterator]();
            },

        keys:
            function () {
                return Object.keys(
                    values
                )[Symbol.iterator]();
            },

        values:
            function () {
                return Object.values(
                    values
                )[Symbol.iterator]();
            },

        forEach:
            function (
                callback,
                thisArgument
            ) {
                Object.entries(
                    values
                ).forEach(
                    function (entry) {
                        callback.call(
                            thisArgument,
                            entry[1],
                            entry[0],
                            this
                        );
                    },
                    this
                );
            },

        toJSON:
            function () {
                return cloneValue(
                    values
                );
            },

        [Symbol.iterator]:
            function () {
                return Object.entries(
                    values
                )[Symbol.iterator]();
            }
    };
}

/* ==========================================================
   BODY HELPERS
========================================================== */

function bodyToBuffer(body) {
    if (
        body === null ||
        body === undefined
    ) {
        return Buffer.alloc(0);
    }

    if (Buffer.isBuffer(body)) {
        return Buffer.from(body);
    }

    if (
        body instanceof
        Uint8Array
    ) {
        return Buffer.from(body);
    }

    if (
        typeof body ===
        "string"
    ) {
        return Buffer.from(
            body,
            "utf8"
        );
    }

    return Buffer.from(
        JSON.stringify(body),
        "utf8"
    );
}

function parseRequestBody(body) {
    if (
        body === null ||
        body === undefined
    ) {
        return undefined;
    }

    if (
        typeof body ===
        "object" &&
        !Buffer.isBuffer(body) &&
        !(body instanceof Uint8Array)
    ) {
        return cloneValue(body);
    }

    const text =
        Buffer.isBuffer(body) ||
        body instanceof Uint8Array
            ? Buffer.from(body)
                .toString("utf8")
            : String(body);

    if (!text) {
        return undefined;
    }

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

/* ==========================================================
   RESPONSE HARNESS
========================================================== */

function createFetchResponse(options) {
    const settings =
        options || {};

    const status =
        Number(
            settings.status ||
            200
        );

    const responseHeaders =
        Object.assign(
            {},
            settings.headers || {}
        );

    let body =
        settings.body;

    if (
        Object.prototype
            .hasOwnProperty
            .call(
                settings,
                "json"
            )
    ) {
        body =
            settings.json;

        if (
            !Object.keys(
                normalizeHeaders(
                    responseHeaders
                )
            ).some(
                function (name) {
                    return name ===
                        "content-type";
                }
            )
        ) {
            responseHeaders[
                "content-type"
            ] =
                "application/json";
        }
    }

    const bodyBuffer =
        bodyToBuffer(body);

    const headers =
        createHeaders(
            responseHeaders
        );

    const response = {
        ok:
            status >= 200 &&
            status < 300,

        status:
            status,

        statusText:
            settings.statusText ||
            defaultStatusText(
                status
            ),

        headers:
            headers,

        redirected:
            Boolean(
                settings.redirected
            ),

        url:
            settings.url ||
            "",

        type:
            settings.type ||
            "basic",

        bodyUsed:
            false,

        text:
            async function () {
                response.bodyUsed =
                    true;

                return bodyBuffer
                    .toString("utf8");
            },

        json:
            async function () {
                response.bodyUsed =
                    true;

                const text =
                    bodyBuffer
                        .toString("utf8");

                if (!text) {
                    return null;
                }

                return JSON.parse(text);
            },

        arrayBuffer:
            async function () {
                response.bodyUsed =
                    true;

                const copied =
                    Buffer.from(
                        bodyBuffer
                    );

                return copied.buffer.slice(
                    copied.byteOffset,
                    copied.byteOffset +
                    copied.byteLength
                );
            },

        blob:
            async function () {
                response.bodyUsed =
                    true;

                return {
                    size:
                        bodyBuffer.length,

                    type:
                        headers.get(
                            "content-type"
                        ) || "",

                    arrayBuffer:
                        async function () {
                            const copied =
                                Buffer.from(
                                    bodyBuffer
                                );

                            return copied
                                .buffer
                                .slice(
                                    copied
                                        .byteOffset,
                                    copied
                                        .byteOffset +
                                    copied
                                        .byteLength
                                );
                        },

                    text:
                        async function () {
                            return bodyBuffer
                                .toString(
                                    "utf8"
                                );
                        }
                };
            },

        clone:
            function () {
                return createFetchResponse({
                    status:
                        status,

                    statusText:
                        response.statusText,

                    headers:
                        headers.toJSON(),

                    body:
                        Buffer.from(
                            bodyBuffer
                        ),

                    redirected:
                        response.redirected,

                    url:
                        response.url,

                    type:
                        response.type
                });
            }
    };

    return response;
}

function defaultStatusText(status) {
    const values = {
        200:
            "OK",

        201:
            "Created",

        202:
            "Accepted",

        204:
            "No Content",

        400:
            "Bad Request",

        401:
            "Unauthorized",

        403:
            "Forbidden",

        404:
            "Not Found",

        409:
            "Conflict",

        422:
            "Unprocessable Entity",

        429:
            "Too Many Requests",

        500:
            "Internal Server Error",

        502:
            "Bad Gateway",

        503:
            "Service Unavailable",

        504:
            "Gateway Timeout"
    };

    return values[status] || "";
}

/* ==========================================================
   MATCHERS
========================================================== */

function matchValue(
    actual,
    expected
) {
    if (
        expected === undefined
    ) {
        return true;
    }

    if (
        expected instanceof
        RegExp
    ) {
        return expected.test(
            String(actual)
        );
    }

    if (
        typeof expected ===
        "function"
    ) {
        return Boolean(
            expected(actual)
        );
    }

    if (
        Array.isArray(expected) ||
        (
            expected &&
            typeof expected ===
                "object"
        )
    ) {
        return deepEqual(
            actual,
            expected
        );
    }

    return actual === expected;
}

function matchHeaders(
    actualHeaders,
    expectedHeaders
) {
    const normalizedActual =
        normalizeHeaders(
            actualHeaders
        );

    const normalizedExpected =
        normalizeHeaders(
            expectedHeaders
        );

    return Object.keys(
        normalizedExpected
    ).every(
        function (name) {
            return matchValue(
                normalizedActual[name],
                normalizedExpected[name]
            );
        }
    );
}

function matchesRoute(
    call,
    route
) {
    if (
        route.method &&
        String(route.method)
            .toUpperCase() !==
            call.method
    ) {
        return false;
    }

    const expectedUrl =
        route.url !==
        undefined
            ? route.url
            : route.match;

    if (
        expectedUrl !==
            undefined &&
        !matchValue(
            call.url,
            expectedUrl
        )
    ) {
        return false;
    }

    if (
        route.headers &&
        !matchHeaders(
            call.headers,
            route.headers
        )
    ) {
        return false;
    }

    if (
        Object.prototype
            .hasOwnProperty
            .call(
                route,
                "body"
            ) &&
        !matchValue(
            call.body,
            route.body
        )
    ) {
        return false;
    }

    if (
        Object.prototype
            .hasOwnProperty
            .call(
                route,
                "rawBody"
            ) &&
        !matchValue(
            call.rawBody,
            route.rawBody
        )
    ) {
        return false;
    }

    if (
        typeof route.predicate ===
            "function" &&
        !route.predicate(call)
    ) {
        return false;
    }

    return true;
}

/* ==========================================================
   HARNESS
========================================================== */

function createProviderFetchHarness(options) {
    const settings =
        options || {};

    const routes = [];
    const calls = [];

    const originalFetch =
        global.fetch;

    let installed = false;

    const strict =
        settings.strict !==
        false;

    function addRoute(route) {
        const normalized =
            Object.assign(
                {
                    method:
                        undefined,

                    times:
                        1,

                    used:
                        0
                },
                route || {}
            );

        if (
            normalized.times ===
            Infinity
        ) {
            normalized.remaining =
                Infinity;
        } else {
            normalized.remaining =
                Math.max(
                    0,
                    Number(
                        normalized.times
                    )
                );
        }

        routes.push(
            normalized
        );

        return harness;
    }

    function addJsonRoute(
        method,
        url,
        json,
        responseOptions
    ) {
        return addRoute(
            Object.assign(
                {
                    method:
                        method,

                    url:
                        url,

                    response: {
                        status:
                            200,

                        json:
                            json
                    }
                },
                responseOptions || {}
            )
        );
    }

    function addErrorRoute(
        method,
        url,
        error,
        routeOptions
    ) {
        return addRoute(
            Object.assign(
                {
                    method:
                        method,

                    url:
                        url,

                    error:
                        error
                },
                routeOptions || {}
            )
        );
    }

    async function mockedFetch(
        input,
        init
    ) {
        const request =
            normalizeRequest(
                input,
                init
            );

        const call = {
            index:
                calls.length,

            url:
                request.url,

            method:
                request.method,

            headers:
                request.headers,

            rawBody:
                request.rawBody,

            body:
                request.body,

            signal:
                request.signal,

            options:
                cloneValue(
                    request.options
                ),

            matchedRouteIndex:
                -1
        };

        calls.push(call);

        if (
            request.signal &&
            request.signal.aborted
        ) {
            throw createAbortError();
        }

        const routeIndex =
            routes.findIndex(
                function (route) {
                    return (
                        route.remaining !==
                            0 &&
                        matchesRoute(
                            call,
                            route
                        )
                    );
                }
            );

        if (routeIndex < 0) {
            if (
                typeof settings.fallback ===
                    "function"
            ) {
                return settings.fallback(
                    call
                );
            }

            if (!strict) {
                return createFetchResponse({
                    status:
                        404,

                    json: {
                        error:
                            "No provider mock matched."
                    },

                    url:
                        call.url
                });
            }

            throw new Error(
                formatUnexpectedRequest(
                    call,
                    routes
                )
            );
        }

        const route =
            routes[routeIndex];

        call.matchedRouteIndex =
            routeIndex;

        route.used += 1;

        if (
            route.remaining !==
            Infinity
        ) {
            route.remaining -= 1;
        }

        const wait =
            Number(
                typeof route.delay ===
                    "function"
                    ? route.delay(call)
                    : route.delay ||
                      0
            );

        if (wait > 0) {
            await waitForDelayOrAbort(
                wait,
                request.signal
            );
        }

        if (
            request.signal &&
            request.signal.aborted
        ) {
            throw createAbortError();
        }

        if (
            route.error !==
            undefined
        ) {
            const routeError =
                typeof route.error ===
                    "function"
                    ? await route.error(
                          call
                      )
                    : route.error;

            if (
                routeError instanceof
                Error
            ) {
                throw routeError;
            }

            throw new Error(
                String(routeError)
            );
        }

        let responseDefinition =
            route.response;

        if (
            typeof route.handler ===
            "function"
        ) {
            responseDefinition =
                await route.handler(
                    call,
                    route
                );
        } else if (
            typeof responseDefinition ===
            "function"
        ) {
            responseDefinition =
                await responseDefinition(
                    call,
                    route
                );
        }

        if (
            responseDefinition &&
            typeof responseDefinition
                .text ===
                "function" &&
            typeof responseDefinition
                .json ===
                "function"
        ) {
            return responseDefinition;
        }

        return createFetchResponse(
            Object.assign(
                {
                    url:
                        call.url
                },
                responseDefinition || {}
            )
        );
    }

    const harness = {
        routes:
            routes,

        calls:
            calls,

        install:
            function () {
                if (!installed) {
                    global.fetch =
                        mockedFetch;

                    installed =
                        true;
                }

                return harness;
            },

        restore:
            function () {
                if (installed) {
                    global.fetch =
                        originalFetch;

                    installed =
                        false;
                }

                return harness;
            },

        reset:
            function () {
                calls.length = 0;

                routes.forEach(
                    function (route) {
                        route.used = 0;

                        route.remaining =
                            route.times ===
                            Infinity
                                ? Infinity
                                : Math.max(
                                      0,
                                      Number(
                                          route.times
                                      )
                                  );
                    }
                );

                return harness;
            },

        clear:
            function () {
                calls.length = 0;
                routes.length = 0;

                return harness;
            },

        route:
            addRoute,

        json:
            addJsonRoute,

        error:
            addErrorRoute,

        once:
            function (
                method,
                url,
                response,
                routeOptions
            ) {
                return addRoute(
                    Object.assign(
                        {
                            method:
                                method,

                            url:
                                url,

                            times:
                                1,

                            response:
                                response
                        },
                        routeOptions || {}
                    )
                );
            },

        persist:
            function (
                method,
                url,
                response,
                routeOptions
            ) {
                return addRoute(
                    Object.assign(
                        {
                            method:
                                method,

                            url:
                                url,

                            times:
                                Infinity,

                            response:
                                response
                        },
                        routeOptions || {}
                    )
                );
            },

        getCalls:
            function () {
                return calls.map(
                    cloneValue
                );
            },

        getCall:
            function (index) {
                return calls[index]
                    ? cloneValue(
                          calls[index]
                      )
                    : undefined;
            },

        lastCall:
            function () {
                return calls.length
                    ? cloneValue(
                          calls[
                              calls.length -
                              1
                          ]
                      )
                    : undefined;
            },

        findCalls:
            function (predicate) {
                return calls
                    .filter(
                        predicate ||
                        function () {
                            return true;
                        }
                    )
                    .map(
                        cloneValue
                    );
            },

        countCalls:
            function (predicate) {
                return (
                    predicate
                        ? calls.filter(
                              predicate
                          )
                        : calls
                ).length;
            },

        assertComplete:
            function () {
                const incomplete =
                    routes.filter(
                        function (route) {
                            return (
                                route.remaining !==
                                    0 &&
                                route.remaining !==
                                    Infinity
                            );
                        }
                    );

                if (
                    incomplete.length
                ) {
                    throw new Error(
                        [
                            "Not all provider mocks were consumed.",
                            ...incomplete.map(
                                function (
                                    route,
                                    index
                                ) {
                                    return (
                                        "- Route " +
                                        index +
                                        ": " +
                                        describeRoute(
                                            route
                                        ) +
                                        ", remaining=" +
                                        route.remaining
                                    );
                                }
                            )
                        ].join("\n")
                    );
                }

                return true;
            },

        isInstalled:
            function () {
                return installed;
            }
    };

    (
        settings.routes ||
        []
    ).forEach(
        addRoute
    );

    if (
        settings.autoInstall !==
        false
    ) {
        harness.install();
    }

    return harness;
}

/* ==========================================================
   REQUEST NORMALIZATION
========================================================== */

function normalizeRequest(
    input,
    init
) {
    const options =
        init || {};

    let url;
    let inheritedMethod;
    let inheritedHeaders;
    let inheritedBody;
    let inheritedSignal;

    if (
        typeof input ===
        "string" ||
        input instanceof URL
    ) {
        url =
            String(input);
    } else if (
        input &&
        typeof input ===
            "object"
    ) {
        url =
            String(input.url);

        inheritedMethod =
            input.method;

        inheritedHeaders =
            input.headers;

        inheritedBody =
            input.body;

        inheritedSignal =
            input.signal;
    } else {
        throw new TypeError(
            "fetch input must be a URL or Request-like object."
        );
    }

    const method =
        String(
            options.method ||
            inheritedMethod ||
            "GET"
        ).toUpperCase();

    const headers =
        normalizeHeaders(
            options.headers ||
            inheritedHeaders
        );

    const rawBody =
        options.body !==
        undefined
            ? options.body
            : inheritedBody;

    return {
        url:
            url,

        method:
            method,

        headers:
            headers,

        rawBody:
            cloneValue(rawBody),

        body:
            parseRequestBody(
                rawBody
            ),

        signal:
            options.signal ||
            inheritedSignal,

        options:
            Object.assign(
                {},
                options,
                {
                    method:
                        method,

                    headers:
                        headers,

                    body:
                        cloneValue(
                            rawBody
                        )
                }
            )
    };
}

/* ==========================================================
   ABORT HELPERS
========================================================== */

function createAbortError() {
    const error =
        new Error(
            "The operation was aborted."
        );

    error.name =
        "AbortError";

    error.code =
        "ABORT_ERR";

    return error;
}

function waitForDelayOrAbort(
    milliseconds,
    signal
) {
    if (!signal) {
        return delay(
            milliseconds
        );
    }

    if (signal.aborted) {
        return Promise.reject(
            createAbortError()
        );
    }

    return new Promise(
        function (
            resolve,
            reject
        ) {
            const timer =
                setTimeout(
                    function () {
                        signal
                            .removeEventListener(
                                "abort",
                                handleAbort
                            );

                        resolve();
                    },
                    milliseconds
                );

            function handleAbort() {
                clearTimeout(timer);

                signal
                    .removeEventListener(
                        "abort",
                        handleAbort
                    );

                reject(
                    createAbortError()
                );
            }

            signal.addEventListener(
                "abort",
                handleAbort,
                {
                    once:
                        true
                }
            );
        }
    );
}

/* ==========================================================
   DEBUG HELPERS
========================================================== */

function describeRoute(route) {
    return [
        route.method ||
        "*",
        route.url instanceof
            RegExp
            ? route.url.toString()
            : String(
                  route.url ||
                  route.match ||
                  "*"
              )
    ].join(" ");
}

function formatUnexpectedRequest(
    call,
    routes
) {
    const body =
        call.body ===
        undefined
            ? ""
            : "\nBody: " +
              JSON.stringify(
                  call.body,
                  null,
                  2
              );

    const available =
        routes.length
            ? routes.map(
                  function (
                      route,
                      index
                  ) {
                      return (
                          index +
                          ": " +
                          describeRoute(
                              route
                          ) +
                          " [remaining=" +
                          route.remaining +
                          "]"
                      );
                  }
              )
            : [
                  "(no routes configured)"
              ];

    return [
        "Unexpected provider request:",
        call.method +
            " " +
            call.url,
        body,
        "",
        "Configured routes:",
        ...available
    ].join("\n");
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    createProviderFetchHarness,
    createFetchResponse,
    createHeaders,
    normalizeHeaders,
    normalizeHeaderName,
    normalizeRequest,
    parseRequestBody,
    bodyToBuffer,
    matchesRoute,
    matchValue,
    matchHeaders,
    createAbortError,
    cloneValue,
    deepEqual
};