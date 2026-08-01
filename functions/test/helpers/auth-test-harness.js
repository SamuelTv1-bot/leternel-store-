"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   IN-MEMORY FIREBASE AUTH TEST HARNESS

   Supports:
   - User creation
   - User lookup by UID and email
   - User updates
   - Custom claims
   - Token revocation
   - User deletion
   - User listing
   - Auth write inspection
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

function normalizeEmail(email) {
    return String(
        email || ""
    )
        .trim()
        .toLowerCase();
}

function createAuthError(
    code,
    message
) {
    const error =
        new Error(message);

    error.code =
        code;

    return error;
}

/* ==========================================================
   USER NORMALIZATION
========================================================== */

function createDefaultUser(
    uid,
    overrides
) {
    const source =
        overrides || {};

    const createdAt =
        source.metadata &&
        source.metadata.creationTime
            ? new Date(
                  source.metadata.creationTime
              )
            : new Date();

    const updatedAt =
        source.metadata &&
        source.metadata.lastRefreshTime
            ? new Date(
                  source.metadata
                      .lastRefreshTime
              )
            : createdAt;

    return {
        uid:
            uid,

        email:
            source.email
                ? normalizeEmail(
                      source.email
                  )
                : undefined,

        emailVerified:
            Boolean(
                source.emailVerified
            ),

        displayName:
            source.displayName ||
            undefined,

        photoURL:
            source.photoURL ||
            undefined,

        phoneNumber:
            source.phoneNumber ||
            undefined,

        disabled:
            Boolean(
                source.disabled
            ),

        passwordHash:
            source.passwordHash,

        passwordSalt:
            source.passwordSalt,

        customClaims:
            cloneValue(
                source.customClaims ||
                {}
            ),

        providerData:
            cloneValue(
                source.providerData ||
                []
            ),

        tokensValidAfterTime:
            source.tokensValidAfterTime ||
            createdAt.toISOString(),

        metadata: {
            creationTime:
                createdAt.toISOString(),

            lastSignInTime:
                source.metadata &&
                source.metadata
                    .lastSignInTime
                    ? new Date(
                          source.metadata
                              .lastSignInTime
                      ).toISOString()
                    : undefined,

            lastRefreshTime:
                updatedAt.toISOString()
        },

        tenantId:
            source.tenantId,

        multiFactor:
            cloneValue(
                source.multiFactor || {
                    enrolledFactors: []
                }
            ),

        toJSON:
            function () {
                return cloneValue({
                    uid:
                        this.uid,

                    email:
                        this.email,

                    emailVerified:
                        this.emailVerified,

                    displayName:
                        this.displayName,

                    photoURL:
                        this.photoURL,

                    phoneNumber:
                        this.phoneNumber,

                    disabled:
                        this.disabled,

                    customClaims:
                        this.customClaims,

                    providerData:
                        this.providerData,

                    tokensValidAfterTime:
                        this.tokensValidAfterTime,

                    metadata:
                        this.metadata,

                    tenantId:
                        this.tenantId,

                    multiFactor:
                        this.multiFactor
                });
            }
    };
}

/* ==========================================================
   AUTH HARNESS
========================================================== */

function createAuthHarness(options) {
    const settings =
        options || {};

    const users =
        new Map();

    const writes =
        [];

    let generatedUid =
        Number(
            settings.startingUid ||
            0
        );

    const clock =
        typeof settings.clock ===
            "function"
            ? settings.clock
            : Date.now;

    const defaultPassword =
        settings.defaultPassword ||
        "Password123!";

    Object.keys(
        settings.users ||
        settings.initialUsers ||
        {}
    ).forEach(
        function (uid) {
            const source =
                (
                    settings.users ||
                    settings.initialUsers
                )[uid];

            users.set(
                uid,
                createDefaultUser(
                    uid,
                    source
                )
            );
        }
    );

    function recordWrite(
        operation,
        details
    ) {
        writes.push(
            Object.assign(
                {
                    operation:
                        operation,

                    timestamp:
                        new Date(
                            clock()
                        )
                },
                cloneValue(
                    details || {}
                )
            )
        );
    }

    function findUserByEmail(
        email
    ) {
        const normalized =
            normalizeEmail(email);

        return Array.from(
            users.values()
        ).find(
            function (user) {
                return (
                    user.email ===
                    normalized
                );
            }
        );
    }

    function generateUid() {
        generatedUid += 1;

        return (
            "test-user-" +
            String(
                generatedUid
            ).padStart(
                6,
                "0"
            )
        );
    }

    function requireUser(uid) {
        const user =
            users.get(uid);

        if (!user) {
            throw createAuthError(
                "auth/user-not-found",
                "No user record found for UID: " +
                uid
            );
        }

        return user;
    }

    function assertUniqueEmail(
        email,
        excludedUid
    ) {
        if (!email) {
            return;
        }

        const existing =
            findUserByEmail(email);

        if (
            existing &&
            existing.uid !==
                excludedUid
        ) {
            throw createAuthError(
                "auth/email-already-exists",
                "The email address is already in use."
            );
        }
    }

    function sanitizeUserRecord(
        user
    ) {
        return user;
    }

    const auth = {
        createUser:
            async function (
                properties
            ) {
                const input =
                    properties || {};

                const uid =
                    input.uid ||
                    generateUid();

                if (users.has(uid)) {
                    throw createAuthError(
                        "auth/uid-already-exists",
                        "The UID is already in use."
                    );
                }

                const email =
                    input.email
                        ? normalizeEmail(
                              input.email
                          )
                        : undefined;

                assertUniqueEmail(
                    email
                );

                const now =
                    new Date(
                        clock()
                    );

                const user =
                    createDefaultUser(
                        uid,
                        {
                            email:
                                email,

                            emailVerified:
                                Boolean(
                                    input.emailVerified
                                ),

                            displayName:
                                input.displayName,

                            photoURL:
                                input.photoURL,

                            phoneNumber:
                                input.phoneNumber,

                            disabled:
                                Boolean(
                                    input.disabled
                                ),

                            customClaims:
                                {},

                            providerData:
                                email
                                    ? [
                                          {
                                              uid:
                                                  email,

                                              email:
                                                  email,

                                              providerId:
                                                  "password",

                                              displayName:
                                                  input.displayName ||
                                                  null,

                                              photoURL:
                                                  input.photoURL ||
                                                  null,

                                              phoneNumber:
                                                  input.phoneNumber ||
                                                  null
                                          }
                                      ]
                                    : [],

                            metadata: {
                                creationTime:
                                    now,

                                lastRefreshTime:
                                    now
                            }
                        }
                    );

                user.password =
                    input.password ||
                    defaultPassword;

                users.set(
                    uid,
                    user
                );

                recordWrite(
                    "createUser",
                    {
                        userId:
                            uid,

                        properties:
                            cloneValue(input)
                    }
                );

                return sanitizeUserRecord(
                    user
                );
            },

        getUser:
            async function (uid) {
                return sanitizeUserRecord(
                    requireUser(uid)
                );
            },

        getUserByEmail:
            async function (email) {
                const user =
                    findUserByEmail(
                        email
                    );

                if (!user) {
                    throw createAuthError(
                        "auth/user-not-found",
                        "No user record found for email: " +
                        email
                    );
                }

                return sanitizeUserRecord(
                    user
                );
            },

        getUserByPhoneNumber:
            async function (
                phoneNumber
            ) {
                const user =
                    Array.from(
                        users.values()
                    ).find(
                        function (
                            candidate
                        ) {
                            return (
                                candidate
                                    .phoneNumber ===
                                phoneNumber
                            );
                        }
                    );

                if (!user) {
                    throw createAuthError(
                        "auth/user-not-found",
                        "No user record found for phone number."
                    );
                }

                return sanitizeUserRecord(
                    user
                );
            },

        updateUser:
            async function (
                uid,
                properties
            ) {
                const user =
                    requireUser(uid);

                const changes =
                    properties || {};

                if (
                    Object.prototype
                        .hasOwnProperty
                        .call(
                            changes,
                            "email"
                        )
                ) {
                    const email =
                        changes.email
                            ? normalizeEmail(
                                  changes.email
                              )
                            : undefined;

                    assertUniqueEmail(
                        email,
                        uid
                    );

                    user.email =
                        email;
                }

                if (
                    Object.prototype
                        .hasOwnProperty
                        .call(
                            changes,
                            "emailVerified"
                        )
                ) {
                    user.emailVerified =
                        Boolean(
                            changes.emailVerified
                        );
                }

                if (
                    Object.prototype
                        .hasOwnProperty
                        .call(
                            changes,
                            "displayName"
                        )
                ) {
                    user.displayName =
                        changes.displayName ||
                        undefined;
                }

                if (
                    Object.prototype
                        .hasOwnProperty
                        .call(
                            changes,
                            "photoURL"
                        )
                ) {
                    user.photoURL =
                        changes.photoURL ||
                        undefined;
                }

                if (
                    Object.prototype
                        .hasOwnProperty
                        .call(
                            changes,
                            "phoneNumber"
                        )
                ) {
                    user.phoneNumber =
                        changes.phoneNumber ||
                        undefined;
                }

                if (
                    Object.prototype
                        .hasOwnProperty
                        .call(
                            changes,
                            "disabled"
                        )
                ) {
                    user.disabled =
                        Boolean(
                            changes.disabled
                        );
                }

                if (
                    Object.prototype
                        .hasOwnProperty
                        .call(
                            changes,
                            "password"
                        )
                ) {
                    user.password =
                        changes.password;
                }

                user.metadata
                    .lastRefreshTime =
                    new Date(
                        clock()
                    ).toISOString();

                recordWrite(
                    "updateUser",
                    {
                        userId:
                            uid,

                        changes:
                            cloneValue(
                                changes
                            )
                    }
                );

                return sanitizeUserRecord(
                    user
                );
            },

        setCustomUserClaims:
            async function (
                uid,
                claims
            ) {
                const user =
                    requireUser(uid);

                if (
                    claims !== null &&
                    (
                        typeof claims !==
                            "object" ||
                        Array.isArray(
                            claims
                        )
                    )
                ) {
                    throw createAuthError(
                        "auth/invalid-claims",
                        "Custom claims must be an object or null."
                    );
                }

                user.customClaims =
                    cloneValue(
                        claims || {}
                    );

                user.metadata
                    .lastRefreshTime =
                    new Date(
                        clock()
                    ).toISOString();

                recordWrite(
                    "setCustomUserClaims",
                    {
                        userId:
                            uid,

                        claims:
                            cloneValue(
                                claims || {}
                            )
                    }
                );
            },

        revokeRefreshTokens:
            async function (uid) {
                const user =
                    requireUser(uid);

                user.tokensValidAfterTime =
                    new Date(
                        clock()
                    ).toISOString();

                user.metadata
                    .lastRefreshTime =
                    user.tokensValidAfterTime;

                recordWrite(
                    "revokeRefreshTokens",
                    {
                        userId:
                            uid,

                        tokensValidAfterTime:
                            user.tokensValidAfterTime
                    }
                );
            },

        deleteUser:
            async function (uid) {
                requireUser(uid);

                users.delete(uid);

                recordWrite(
                    "deleteUser",
                    {
                        userId:
                            uid
                    }
                );
            },

        deleteUsers:
            async function (
                userIds
            ) {
                const source =
                    Array.isArray(
                        userIds
                    )
                        ? userIds
                        : [];

                const errors = [];

                let successCount =
                    0;

                source.forEach(
                    function (
                        uid,
                        index
                    ) {
                        if (
                            users.has(uid)
                        ) {
                            users.delete(uid);
                            successCount += 1;

                            recordWrite(
                                "deleteUser",
                                {
                                    userId:
                                        uid
                                }
                            );
                        } else {
                            errors.push({
                                index:
                                    index,

                                error:
                                    createAuthError(
                                        "auth/user-not-found",
                                        "No user record found for UID: " +
                                        uid
                                    )
                            });
                        }
                    }
                );

                return {
                    successCount:
                        successCount,

                    failureCount:
                        errors.length,

                    errors:
                        errors
                };
            },

        listUsers:
            async function (
                maxResults,
                pageToken
            ) {
                const maximum =
                    Math.min(
                        Math.max(
                            Number(
                                maxResults ||
                                1000
                            ),
                            1
                        ),
                        1000
                    );

                const start =
                    pageToken
                        ? Number(
                              pageToken
                          )
                        : 0;

                const allUsers =
                    Array.from(
                        users.values()
                    );

                const page =
                    allUsers.slice(
                        start,
                        start +
                        maximum
                    );

                const nextIndex =
                    start +
                    page.length;

                return {
                    users:
                        page.map(
                            sanitizeUserRecord
                        ),

                    pageToken:
                        nextIndex <
                        allUsers.length
                            ? String(
                                  nextIndex
                              )
                            : undefined
                };
            },

        verifyIdToken:
            async function (
                token
            ) {
                const decoded =
                    decodeTestToken(
                        token
                    );

                const user =
                    requireUser(
                        decoded.uid
                    );

                if (user.disabled) {
                    throw createAuthError(
                        "auth/user-disabled",
                        "The user account is disabled."
                    );
                }

                return Object.assign(
                    {
                        uid:
                            user.uid,

                        sub:
                            user.uid,

                        email:
                            user.email,

                        email_verified:
                            user.emailVerified,

                        auth_time:
                            Math.floor(
                                clock() /
                                1000
                            ),

                        iat:
                            Math.floor(
                                clock() /
                                1000
                            ),

                        exp:
                            Math.floor(
                                clock() /
                                1000
                            ) +
                            3600
                    },
                    cloneValue(
                        user.customClaims ||
                        {}
                    ),
                    cloneValue(
                        decoded.claims ||
                        {}
                    )
                );
            },

        createCustomToken:
            async function (
                uid,
                additionalClaims
            ) {
                requireUser(uid);

                return encodeTestToken({
                    uid:
                        uid,

                    claims:
                        additionalClaims ||
                        {}
                });
            }
    };

    return {
        auth:
            auth,

        users:
            users,

        writes:
            writes,

        seedUser:
            function (
                uid,
                properties
            ) {
                users.set(
                    uid,
                    createDefaultUser(
                        uid,
                        properties
                    )
                );

                return this;
            },

        seedUsers:
            function (source) {
                Object.keys(
                    source || {}
                ).forEach(
                    function (uid) {
                        users.set(
                            uid,
                            createDefaultUser(
                                uid,
                                source[uid]
                            )
                        );
                    }
                );

                return this;
            },

        hasUser:
            function (uid) {
                return users.has(uid);
            },

        getUser:
            function (uid) {
                const user =
                    users.get(uid);

                return user
                    ? cloneUserForInspection(
                          user
                      )
                    : undefined;
            },

        getUserByEmail:
            function (email) {
                const user =
                    findUserByEmail(
                        email
                    );

                return user
                    ? cloneUserForInspection(
                          user
                      )
                    : undefined;
            },

        setUser:
            function (
                uid,
                properties
            ) {
                users.set(
                    uid,
                    createDefaultUser(
                        uid,
                        properties
                    )
                );

                return this;
            },

        deleteUser:
            function (uid) {
                users.delete(uid);

                return this;
            },

        clear:
            function () {
                users.clear();
                writes.length = 0;
            },

        resetWrites:
            function () {
                writes.length = 0;
            },

        listUsers:
            function () {
                return Array.from(
                    users.values()
                ).map(
                    cloneUserForInspection
                );
            },

        findUsers:
            function (predicate) {
                return this
                    .listUsers()
                    .filter(
                        predicate ||
                        function () {
                            return true;
                        }
                    );
            },

        findWrites:
            function (predicate) {
                return writes.filter(
                    predicate ||
                    function () {
                        return true;
                    }
                );
            },

        lastWrite:
            function () {
                return writes.length
                    ? cloneValue(
                          writes[
                              writes.length -
                              1
                          ]
                      )
                    : undefined;
            },

        createIdToken:
            function (
                uid,
                additionalClaims
            ) {
                requireUser(uid);

                return encodeTestToken({
                    uid:
                        uid,

                    claims:
                        additionalClaims ||
                        {}
                });
            },

        decodeIdToken:
            function (token) {
                return decodeTestToken(
                    token
                );
            }
    };
}

/* ==========================================================
   TOKEN HELPERS
========================================================== */

function encodeTestToken(payload) {
    return Buffer.from(
        JSON.stringify(payload),
        "utf8"
    ).toString(
        "base64url"
    );
}

function decodeTestToken(token) {
    try {
        const parsed =
            JSON.parse(
                Buffer.from(
                    String(token),
                    "base64url"
                ).toString(
                    "utf8"
                )
            );

        if (
            !parsed ||
            typeof parsed.uid !==
                "string"
        ) {
            throw new Error(
                "Missing UID."
            );
        }

        return parsed;
    } catch {
        throw createAuthError(
            "auth/argument-error",
            "Invalid test authentication token."
        );
    }
}

function cloneUserForInspection(
    user
) {
    return cloneValue({
        uid:
            user.uid,

        email:
            user.email,

        emailVerified:
            user.emailVerified,

        displayName:
            user.displayName,

        photoURL:
            user.photoURL,

        phoneNumber:
            user.phoneNumber,

        disabled:
            user.disabled,

        customClaims:
            user.customClaims,

        providerData:
            user.providerData,

        tokensValidAfterTime:
            user.tokensValidAfterTime,

        metadata:
            user.metadata,

        tenantId:
            user.tenantId,

        multiFactor:
            user.multiFactor
    });
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    createAuthHarness,
    createDefaultUser,
    createAuthError,
    cloneValue,
    normalizeEmail,
    encodeTestToken,
    decodeTestToken
};