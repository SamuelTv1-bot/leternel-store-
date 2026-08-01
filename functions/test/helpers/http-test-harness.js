"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   HTTP TEST HARNESS

   Supports:
   - Express-style request objects
   - Express-style response objects
   - Header normalization
   - Query parameters
   - Route parameters
   - Cookies
   - Raw request bodies
   - JSON and text responses
   - Redirects
   - Handler execution
   - Response inspection
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

function normalizeHeaderName(name) {
    return String(name || "")
        .trim()
        .toLowerCase();
}

function normalizeHeaders(headers) {
    return Object.keys(
        headers || {}
    ).reduce(
        function (
            output,
            name
        ) {
            output[
                normalizeHeaderName(
                    name
                )
            ] =
                cloneValue(
                    headers[name]
                );

            return output;
        },
        {}
    );
}

function serializeCookie(
    name,
    value,
    options
) {
    const settings =
        options || {};

    const parts = [
        encodeURIComponent(
            name
        ) +
        "=" +
        encodeURIComponent(
            value
        )
    ];

    if (settings.maxAge !== undefined) {
        parts.push(
            "Max-Age=" +
            Math.floor(
                Number(
                    settings.maxAge
                ) /
                1000
            )
        );
    }

    if (settings.domain) {
        parts.push(
            "Domain=" +
            settings.domain
        );
    }

    if (settings.path) {
        parts.push(
            "Path=" +
            settings.path
        );
    }

    if (settings.expires) {
        const expiration =
            settings.expires instanceof
                Date
                ? settings.expires
                : new Date(
                      settings.expires
                  );

        parts.push(
            "Expires=" +
            expiration.toUTCString()
        );
    }

    if (settings.httpOnly) {
        parts.push(
            "HttpOnly"
        );
    }

    if (settings.secure) {
        parts.push(
            "Secure"
        );
    }

    if (settings.sameSite) {
        const sameSite =
            settings.sameSite === true
                ? "Strict"
                : String(
                      settings.sameSite
                  );

        parts.push(
            "SameSite=" +
            sameSite
                .charAt(0)
                .toUpperCase() +
            sameSite
                .slice(1)
                .toLowerCase()
        );
    }

    return parts.join("; ");
}

function parseCookieHeader(value) {
    if (!value) {
        return {};
    }

    return String(value)
        .split(";")
        .reduce(
            function (
                output,
                part
            ) {
                const separator =
                    part.indexOf("=");

                if (separator < 0) {
                    return output;
                }

                const name =
                    part
                        .slice(
                            0,
                            separator
                        )
                        .trim();

                const cookieValue =
                    part
                        .slice(
                            separator + 1
                        )
                        .trim();

                if (name) {
                    output[
                        decodeURIComponent(
                            name
                        )
                    ] =
                        decodeURIComponent(
                            cookieValue
                        );
                }

                return output;
            },
            {}
        );
}

/* ==========================================================
   REQUEST HARNESS
========================================================== */

function createRequest(options) {
    const settings =
        options || {};

    const method =
        String(
            settings.method ||
            "GET"
        ).toUpperCase();

    const path =
        settings.path ||
        settings.url ||
        "/";

    const headers =
        normalizeHeaders(
            settings.headers
        );

    const body =
        cloneValue(
            settings.body
        );

    let rawBody =
        settings.rawBody;

    if (
        rawBody === undefined &&
        body !== undefined
    ) {
        if (Buffer.isBuffer(body)) {
            rawBody =
                Buffer.from(body);
        } else if (
            typeof body ===
            "string"
        ) {
            rawBody =
                Buffer.from(
                    body,
                    "utf8"
                );
        } else {
            rawBody =
                Buffer.from(
                    JSON.stringify(
                        body
                    ),
                    "utf8"
                );
        }
    }

    if (
        rawBody !== undefined &&
        !Buffer.isBuffer(
            rawBody
        )
    ) {
        rawBody =
            Buffer.from(
                String(rawBody),
                "utf8"
            );
    }

    const request = {
        method:
            method,

        path:
            path,

        url:
            settings.url ||
            path,

        originalUrl:
            settings.originalUrl ||
            settings.url ||
            path,

        baseUrl:
            settings.baseUrl ||
            "",

        protocol:
            settings.protocol ||
            "https",

        secure:
            settings.secure !==
            undefined
                ? Boolean(
                      settings.secure
                  )
                : (
                      settings.protocol ||
                      "https"
                  ) === "https",

        hostname:
            settings.hostname ||
            headers.host ||
            "localhost",

        ip:
            settings.ip ||
            "127.0.0.1",

        ips:
            cloneValue(
                settings.ips ||
                []
            ),

        headers:
            headers,

        query:
            cloneValue(
                settings.query ||
                {}
            ),

        params:
            cloneValue(
                settings.params ||
                {}
            ),

        body:
            body,

        rawBody:
            rawBody,

        cookies:
            Object.assign(
                {},
                parseCookieHeader(
                    headers.cookie
                ),
                cloneValue(
                    settings.cookies ||
                    {}
                )
            ),

        signedCookies:
            cloneValue(
                settings.signedCookies ||
                {}
            ),

        auth:
            cloneValue(
                settings.auth
            ),

        user:
            cloneValue(
                settings.user
            ),

        identity:
            cloneValue(
                settings.identity
            ),

        firebase:
            cloneValue(
                settings.firebase
            ),

        app:
            cloneValue(
                settings.app
            ),

        context:
            cloneValue(
                settings.context
            ),

        locals:
            cloneValue(
                settings.locals ||
                {}
            ),

        get:
            function (name) {
                return headers[
                    normalizeHeaderName(
                        name
                    )
                ];
            },

        header:
            function (name) {
                return request.get(
                    name
                );
            },

        accepts:
            function (...types) {
                const accept =
                    String(
                        headers.accept ||
                        "*/*"
                    );

                if (
                    accept === "*/*"
                ) {
                    return (
                        types[0] ||
                        false
                    );
                }

                return types.find(
                    function (type) {
                        return accept.includes(
                            type
                        );
                    }
                ) || false;
            },

        is:
            function (type) {
                const contentType =
                    String(
                        headers[
                            "content-type"
                        ] ||
                        ""
                    )
                        .split(";")[0]
                        .trim();

                if (!contentType) {
                    return false;
                }

                if (
                    type === "json" ||
                    type ===
                        "application/json"
                ) {
                    return contentType ===
                        "application/json"
                        ? contentType
                        : false;
                }

                if (
                    type === "text" ||
                    type ===
                        "text/plain"
                ) {
                    return contentType ===
                        "text/plain"
                        ? contentType
                        : false;
                }

                return contentType ===
                    type
                    ? contentType
                    : false;
            }
    };

    return request;
}

/* ==========================================================
   RESPONSE HARNESS
========================================================== */

function createResponse(options) {
    const settings =
        options || {};

    const state = {
        statusCode:
            Number(
                settings.statusCode ||
                200
            ),

        statusMessage:
            settings.statusMessage ||
            "",

        headers:
            normalizeHeaders(
                settings.headers
            ),

        body:
            undefined,

        json:
            undefined,

        text:
            undefined,

        cookies:
            [],

        redirected:
            false,

        redirectUrl:
            undefined,

        finished:
            false,

        sent:
            false,

        ended:
            false,

        headersSent:
            false
    };

    const response = {
        locals:
            cloneValue(
                settings.locals ||
                {}
            ),

        get statusCode() {
            return state.statusCode;
        },

        set statusCode(value) {
            state.statusCode =
                Number(value);
        },

        get statusMessage() {
            return state.statusMessage;
        },

        set statusMessage(value) {
            state.statusMessage =
                String(value);
        },

        get headersSent() {
            return state.headersSent;
        },

        set headersSent(value) {
            state.headersSent =
                Boolean(value);
        },

        get finished() {
            return state.finished;
        },

        status:
            function (statusCode) {
                state.statusCode =
                    Number(
                        statusCode
                    );

                return response;
            },

        sendStatus:
            function (statusCode) {
                state.statusCode =
                    Number(
                        statusCode
                    );

                return response.send(
                    String(
                        statusCode
                    )
                );
            },

        set:
            function (
                name,
                value
            ) {
                if (
                    name &&
                    typeof name ===
                        "object"
                ) {
                    Object.keys(name)
                        .forEach(
                            function (key) {
                                state.headers[
                                    normalizeHeaderName(
                                        key
                                    )
                                ] =
                                    cloneValue(
                                        name[key]
                                    );
                            }
                        );

                    return response;
                }

                state.headers[
                    normalizeHeaderName(
                        name
                    )
                ] =
                    cloneValue(value);

                return response;
            },

        header:
            function (
                name,
                value
            ) {
                if (
                    value === undefined
                ) {
                    return response.get(
                        name
                    );
                }

                return response.set(
                    name,
                    value
                );
            },

        setHeader:
            function (
                name,
                value
            ) {
                state.headers[
                    normalizeHeaderName(
                        name
                    )
                ] =
                    cloneValue(value);
            },

        append:
            function (
                name,
                value
            ) {
                const key =
                    normalizeHeaderName(
                        name
                    );

                const current =
                    state.headers[key];

                if (
                    current === undefined
                ) {
                    state.headers[key] =
                        cloneValue(value);
                } else if (
                    Array.isArray(current)
                ) {
                    state.headers[key] =
                        current.concat(
                            cloneValue(value)
                        );
                } else {
                    state.headers[key] =
                        [
                            current
                        ].concat(
                            cloneValue(value)
                        );
                }

                return response;
            },

        get:
            function (name) {
                return state.headers[
                    normalizeHeaderName(
                        name
                    )
                ];
            },

        getHeader:
            function (name) {
                return response.get(
                    name
                );
            },

        getHeaders:
            function () {
                return cloneValue(
                    state.headers
                );
            },

        removeHeader:
            function (name) {
                delete state.headers[
                    normalizeHeaderName(
                        name
                    )
                ];
            },

        type:
            function (value) {
                const contentType =
                    resolveContentType(
                        value
                    );

                response.set(
                    "content-type",
                    contentType
                );

                return response;
            },

        contentType:
            function (value) {
                return response.type(
                    value
                );
            },

        json:
            function (value) {
                if (
                    !response.get(
                        "content-type"
                    )
                ) {
                    response.type(
                        "application/json"
                    );
                }

                state.json =
                    cloneValue(value);

                state.body =
                    cloneValue(value);

                state.text =
                    JSON.stringify(
                        value
                    );

                markSent();

                return response;
            },

        jsonp:
            function (value) {
                return response.json(
                    value
                );
            },

        send:
            function (value) {
                state.body =
                    cloneValue(value);

                if (
                    Buffer.isBuffer(value)
                ) {
                    state.text =
                        value.toString(
                            "utf8"
                        );
                } else if (
                    typeof value ===
                    "object" &&
                    value !== null
                ) {
                    if (
                        !response.get(
                            "content-type"
                        )
                    ) {
                        response.type(
                            "application/json"
                        );
                    }

                    state.json =
                        cloneValue(value);

                    state.text =
                        JSON.stringify(
                            value
                        );
                } else if (
                    value !== undefined
                ) {
                    state.text =
                        String(value);
                }

                markSent();

                return response;
            },

        end:
            function (value) {
                if (
                    value !== undefined
                ) {
                    state.body =
                        cloneValue(value);

                    state.text =
                        Buffer.isBuffer(
                            value
                        )
                            ? value.toString(
                                  "utf8"
                              )
                            : String(value);
                }

                state.ended =
                    true;

                markSent();

                return response;
            },

        redirect:
            function (
                statusOrUrl,
                possibleUrl
            ) {
                let statusCode =
                    302;

                let url =
                    statusOrUrl;

                if (
                    typeof statusOrUrl ===
                    "number"
                ) {
                    statusCode =
                        statusOrUrl;

                    url =
                        possibleUrl;
                }

                state.statusCode =
                    statusCode;

                state.redirected =
                    true;

                state.redirectUrl =
                    String(url);

                response.set(
                    "location",
                    String(url)
                );

                return response.end();
            },

        location:
            function (url) {
                response.set(
                    "location",
                    url
                );

                return response;
            },

        cookie:
            function (
                name,
                value,
                cookieOptions
            ) {
                const serialized =
                    serializeCookie(
                        name,
                        value,
                        cookieOptions
                    );

                state.cookies.push({
                    name:
                        name,

                    value:
                        value,

                    options:
                        cloneValue(
                            cookieOptions ||
                            {}
                        ),

                    serialized:
                        serialized
                });

                response.append(
                    "set-cookie",
                    serialized
                );

                return response;
            },

        clearCookie:
            function (
                name,
                cookieOptions
            ) {
                return response.cookie(
                    name,
                    "",
                    Object.assign(
                        {},
                        cookieOptions || {},
                        {
                            expires:
                                new Date(1),

                            maxAge:
                                0
                        }
                    )
                );
            },

        vary:
            function (field) {
                const existing =
                    response.get(
                        "vary"
                    );

                const values =
                    String(
                        existing || ""
                    )
                        .split(",")
                        .map(
                            function (value) {
                                return value.trim();
                            }
                        )
                        .filter(Boolean);

                if (
                    !values.includes(
                        field
                    )
                ) {
                    values.push(field);
                }

                response.set(
                    "vary",
                    values.join(", ")
                );

                return response;
            },

        format:
            function (handlers) {
                const keys =
                    Object.keys(
                        handlers || {}
                    );

                const handler =
                    handlers.json ||
                    handlers.default ||
                    handlers[
                        keys[0]
                    ];

                if (
                    typeof handler ===
                    "function"
                ) {
                    handler();
                }

                return response;
            }
    };

    function markSent() {
        state.sent =
            true;

        state.finished =
            true;

        state.headersSent =
            true;
    }

    return {
        response:
            response,

        res:
            response,

        state:
            state,

        getStatus:
            function () {
                return state.statusCode;
            },

        getHeader:
            function (name) {
                return cloneValue(
                    state.headers[
                        normalizeHeaderName(
                            name
                        )
                    ]
                );
            },

        getHeaders:
            function () {
                return cloneValue(
                    state.headers
                );
            },

        getBody:
            function () {
                return cloneValue(
                    state.body
                );
            },

        getJson:
            function () {
                return cloneValue(
                    state.json
                );
            },

        getText:
            function () {
                return state.text;
            },

        getCookies:
            function () {
                return cloneValue(
                    state.cookies
                );
            },

        isSent:
            function () {
                return state.sent;
            }
    };
}

/* ==========================================================
   NEXT FUNCTION HARNESS
========================================================== */

function createNext() {
    const state = {
        called:
            false,

        error:
            undefined,

        callCount:
            0
    };

    const next =
        function (error) {
            state.called =
                true;

            state.error =
                error;

            state.callCount +=
                1;
        };

    return {
        next:
            next,

        state:
            state,

        wasCalled:
            function () {
                return state.called;
            },

        getError:
            function () {
                return state.error;
            }
    };
}

/* ==========================================================
   HANDLER EXECUTION
========================================================== */

async function executeHandler(
    handler,
    options
) {
    if (
        typeof handler !==
        "function"
    ) {
        throw new TypeError(
            "executeHandler requires a function."
        );
    }

    const settings =
        options || {};

    const request =
        settings.request ||
        createRequest(
            settings.requestOptions ||
            settings
        );

    const responseHarness =
        settings.responseHarness ||
        createResponse(
            settings.responseOptions
        );

    const nextHarness =
        settings.nextHarness ||
        createNext();

    let returned;
    let thrownError;

    try {
        returned =
            await handler(
                request,
                responseHarness.response,
                nextHarness.next
            );
    } catch (error) {
        thrownError =
            error;

        if (
            settings.rethrow !==
            false
        ) {
            throw error;
        }
    }

    return {
        request:
            request,

        response:
            responseHarness.response,

        state:
            responseHarness.state,

        body:
            responseHarness.getBody(),

        json:
            responseHarness.getJson(),

        text:
            responseHarness.getText(),

        statusCode:
            responseHarness.getStatus(),

        headers:
            responseHarness.getHeaders(),

        cookies:
            responseHarness.getCookies(),

        sent:
            responseHarness.isSent(),

        next:
            nextHarness.next,

        nextState:
            nextHarness.state,

        returned:
            returned,

        error:
            thrownError
    };
}

/* ==========================================================
   CORS HELPERS
========================================================== */

function createCorsPreflightRequest(
    options
) {
    const settings =
        options || {};

    return createRequest({
        method:
            "OPTIONS",

        path:
            settings.path ||
            "/",

        headers:
            Object.assign(
                {
                    origin:
                        settings.origin ||
                        "https://shop.example.com",

                    "access-control-request-method":
                        settings.requestMethod ||
                        "GET",

                    "access-control-request-headers":
                        settings.requestHeaders ||
                        "authorization, content-type"
                },
                settings.headers ||
                {}
            )
    });
}

/* ==========================================================
   CALLABLE REQUEST HELPERS
========================================================== */

function createCallableRequest(
    options
) {
    const settings =
        options || {};

    return {
        data:
            cloneValue(
                settings.data ||
                {}
            ),

        auth:
            settings.auth ===
            null
                ? null
                : cloneValue(
                      settings.auth || {
                          uid:
                              "customer-1",

                          token: {
                              email:
                                  "customer@example.com",

                              email_verified:
                                  true,

                              role:
                                  "customer"
                          }
                      }
                  ),

        app:
            settings.app ===
            null
                ? null
                : cloneValue(
                      settings.app || {
                          appId:
                              "test-app",

                          token:
                              "test-app-check-token"
                      }
                  ),

        instanceIdToken:
            settings.instanceIdToken,

        rawRequest:
            settings.rawRequest ||
            createRequest({
                method:
                    "POST",

                path:
                    settings.path ||
                    "/callable",

                headers:
                    settings.headers ||
                    {
                        "content-type":
                            "application/json"
                    },

                body: {
                    data:
                        cloneValue(
                            settings.data ||
                            {}
                        )
                }
            })
    };
}

/* ==========================================================
   CONTENT TYPES
========================================================== */

function resolveContentType(value) {
    const normalized =
        String(value || "")
            .trim()
            .toLowerCase();

    const knownTypes = {
        json:
            "application/json; charset=utf-8",

        html:
            "text/html; charset=utf-8",

        text:
            "text/plain; charset=utf-8",

        txt:
            "text/plain; charset=utf-8",

        csv:
            "text/csv; charset=utf-8",

        xml:
            "application/xml; charset=utf-8",

        pdf:
            "application/pdf"
    };

    if (
        Object.prototype
            .hasOwnProperty
            .call(
                knownTypes,
                normalized
            )
    ) {
        return knownTypes[
            normalized
        ];
    }

    if (
        normalized.includes("/")
    ) {
        return normalized;
    }

    return (
        "application/" +
        normalized
    );
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    createRequest,
    createResponse,
    createNext,
    executeHandler,
    createCorsPreflightRequest,
    createCallableRequest,
    normalizeHeaderName,
    normalizeHeaders,
    parseCookieHeader,
    serializeCookie,
    resolveContentType,
    cloneValue
};