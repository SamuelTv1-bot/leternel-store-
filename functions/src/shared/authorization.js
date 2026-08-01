"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   SHARED BACKEND AUTHORIZATION
========================================================== */

const {
    createServiceError,
    normalizeUserId
} = require("./validation");

/* ==========================================================
   CONSTANTS
========================================================== */

const ADMIN_ROLES =
    new Set([
        "admin",
        "superadmin"
    ]);

const ACTIVE_STATUS = "active";

/* ==========================================================
   CALLABLE AUTHENTICATION
========================================================== */

function requireAuthenticatedCallable(request) {
    if (
        !request ||
        !request.auth ||
        !request.auth.uid
    ) {
        throw createServiceError(
            "unauthenticated",
            "Sign in before continuing.",
            {
                status: 401
            }
        );
    }

    return {
        uid: request.auth.uid,

        email:
            request.auth.token &&
            request.auth.token.email
                ? request.auth.token.email
                : null,

        emailVerified:
            Boolean(
                request.auth.token &&
                request.auth.token.email_verified
            ),

        role:
            request.auth.token &&
            request.auth.token.role
                ? request.auth.token.role
                : "customer",

        claims:
            request.auth.token || {},

        appCheckToken:
            request.app &&
            request.app.token
                ? request.app.token
                : null
    };
}

/* ==========================================================
   ADMIN CALLABLE AUTHORIZATION
========================================================== */

async function requireAdminCallable(options) {
    const settings =
        options || {};

    const request =
        settings.request;

    const db =
        settings.db;

    const identity =
        requireAuthenticatedCallable(
            request
        );

    const administrator =
        await resolveAdministrator({
            db: db,
            identity: identity
        });

    if (!administrator.authorized) {
        throw createServiceError(
            "permission-denied",
            "Administrator access is required.",
            {
                status: 403
            }
        );
    }

    if (
        settings.superAdminOnly &&
        administrator.role !==
            "superadmin"
    ) {
        throw createServiceError(
            "permission-denied",
            "Super-administrator access is required.",
            {
                status: 403
            }
        );
    }

    return administrator;
}

/* ==========================================================
   HTTP AUTHENTICATION
========================================================== */

async function authenticateRequest(options) {
    const settings =
        options || {};

    const request =
        settings.request;

    const auth =
        settings.auth;

    if (!request || !auth) {
        throw createServiceError(
            "internal",
            "Authentication services are unavailable.",
            {
                status: 500
            }
        );
    }

    const authorization =
        String(
            request.headers &&
            request.headers.authorization
                ? request.headers.authorization
                : ""
        ).trim();

    if (
        !authorization.startsWith(
            "Bearer "
        )
    ) {
        throw createServiceError(
            "unauthenticated",
            "A valid Firebase ID token is required.",
            {
                status: 401
            }
        );
    }

    const token =
        authorization
            .slice(7)
            .trim();

    if (!token) {
        throw createServiceError(
            "unauthenticated",
            "A valid Firebase ID token is required.",
            {
                status: 401
            }
        );
    }

    try {
        const decodedToken =
            await auth.verifyIdToken(
                token,
                true
            );

        return {
            uid: decodedToken.uid,

            email:
                decodedToken.email ||
                null,

            emailVerified:
                Boolean(
                    decodedToken.email_verified
                ),

            role:
                decodedToken.role ||
                "customer",

            claims:
                decodedToken,

            token: token
        };
    } catch (error) {
        throw createServiceError(
            "unauthenticated",
            "The authentication token is invalid or expired.",
            {
                status: 401,
                cause: error
            }
        );
    }
}

/* ==========================================================
   ADMIN HTTP AUTHORIZATION
========================================================== */

async function requireAdminRequest(options) {
    const settings =
        options || {};

    const identity =
        await authenticateRequest({
            request:
                settings.request,
            auth:
                settings.auth
        });

    const administrator =
        await resolveAdministrator({
            db: settings.db,
            identity: identity
        });

    if (!administrator.authorized) {
        throw createServiceError(
            "permission-denied",
            "Administrator access is required.",
            {
                status: 403
            }
        );
    }

    if (
        settings.superAdminOnly &&
        administrator.role !==
            "superadmin"
    ) {
        throw createServiceError(
            "permission-denied",
            "Super-administrator access is required.",
            {
                status: 403
            }
        );
    }

    return administrator;
}

/* ==========================================================
   ADMIN RESOLUTION
========================================================== */

async function resolveAdministrator(options) {
    const settings =
        options || {};

    const db =
        settings.db;

    const identity =
        settings.identity || {};

    const uid =
        normalizeUserId(
            identity.uid
        );

    const claims =
        identity.claims || {};

    const claimRole =
        normalizeRole(
            claims.role ||
            identity.role
        );

    const claimAdmin =
        claims.admin === true;

    let profile = null;

    if (db) {
        const snapshot =
            await db
                .collection("users")
                .doc(uid)
                .get();

        if (snapshot.exists) {
            profile =
                Object.assign(
                    {
                        id:
                            snapshot.id
                    },
                    snapshot.data()
                );
        }
    }

    const profileRole =
        normalizeRole(
            profile &&
            profile.role
        );

    const profileStatus =
        profile &&
        profile.status
            ? String(
                  profile.status
              ).toLowerCase()
            : ACTIVE_STATUS;

    const role =
        profileRole ||
        claimRole ||
        (
            claimAdmin
                ? "admin"
                : "customer"
        );

    const roleAuthorized =
        ADMIN_ROLES.has(role);

    const accountActive =
        profileStatus ===
        ACTIVE_STATUS;

    return {
        uid: uid,

        email:
            identity.email ||
            (
                profile &&
                profile.email
            ) ||
            null,

        role: role,

        authorized:
            roleAuthorized &&
            accountActive,

        active:
            accountActive,

        claims: claims,

        profile: profile,

        source:
            profileRole
                ? "profile"
                : claimRole ||
                  claimAdmin
                ? "claim"
                : "none"
    };
}

/* ==========================================================
   OWNERSHIP AUTHORIZATION
========================================================== */

function requireResourceOwner(
    identity,
    ownerId
) {
    if (
        !identity ||
        !identity.uid
    ) {
        throw createServiceError(
            "unauthenticated",
            "Sign in before continuing.",
            {
                status: 401
            }
        );
    }

    const normalizedOwnerId =
        normalizeUserId(
            ownerId
        );

    if (
        identity.uid !==
        normalizedOwnerId
    ) {
        throw createServiceError(
            "permission-denied",
            "You do not have permission to access this resource.",
            {
                status: 403
            }
        );
    }

    return true;
}

async function requireOwnerOrAdmin(options) {
    const settings =
        options || {};

    const identity =
        settings.identity;

    const ownerId =
        normalizeUserId(
            settings.ownerId
        );

    if (
        identity &&
        identity.uid === ownerId
    ) {
        return {
            authorized: true,
            owner: true,
            administrator: false,
            identity: identity
        };
    }

    const administrator =
        await resolveAdministrator({
            db: settings.db,
            identity: identity
        });

    if (!administrator.authorized) {
        throw createServiceError(
            "permission-denied",
            "You do not have permission to access this resource.",
            {
                status: 403
            }
        );
    }

    return {
        authorized: true,
        owner: false,
        administrator: true,
        identity: administrator
    };
}

/* ==========================================================
   ACCOUNT STATUS
========================================================== */

async function requireActiveUser(options) {
    const settings =
        options || {};

    const identity =
        settings.identity;

    const db =
        settings.db;

    if (
        !identity ||
        !identity.uid
    ) {
        throw createServiceError(
            "unauthenticated",
            "Sign in before continuing.",
            {
                status: 401
            }
        );
    }

    if (!db) {
        return identity;
    }

    const snapshot =
        await db
            .collection("users")
            .doc(identity.uid)
            .get();

    if (!snapshot.exists) {
        return identity;
    }

    const profile =
        snapshot.data() || {};

    if (
        profile.status &&
        profile.status !==
            ACTIVE_STATUS
    ) {
        throw createServiceError(
            "permission-denied",
            "This account is not active.",
            {
                status: 403,
                details: {
                    status:
                        profile.status
                }
            }
        );
    }

    return Object.assign(
        {},
        identity,
        {
            profile: Object.assign(
                {
                    id:
                        snapshot.id
                },
                profile
            )
        }
    );
}

/* ==========================================================
   EMAIL VERIFICATION
========================================================== */

function requireVerifiedEmail(
    identity
) {
    if (
        !identity ||
        !identity.uid
    ) {
        throw createServiceError(
            "unauthenticated",
            "Sign in before continuing.",
            {
                status: 401
            }
        );
    }

    if (!identity.emailVerified) {
        throw createServiceError(
            "failed-precondition",
            "Verify your email address before continuing.",
            {
                status: 412
            }
        );
    }

    return true;
}

/* ==========================================================
   APP CHECK
========================================================== */

function requireAppCheck(request) {
    if (
        !request ||
        !request.app ||
        !request.app.token
    ) {
        throw createServiceError(
            "failed-precondition",
            "A valid App Check token is required.",
            {
                status: 412
            }
        );
    }

    return {
        token:
            request.app.token,

        appId:
            request.app.appId ||
            null
    };
}

/* ==========================================================
   ROLE HELPERS
========================================================== */

function normalizeRole(value) {
    const role =
        String(value || "")
            .trim()
            .toLowerCase();

    if (
        role === "customer" ||
        role === "admin" ||
        role === "superadmin"
    ) {
        return role;
    }

    return "";
}

function hasRole(
    identity,
    allowedRoles
) {
    const roles =
        new Set(
            Array.isArray(
                allowedRoles
            )
                ? allowedRoles.map(
                      normalizeRole
                  )
                : [
                      normalizeRole(
                          allowedRoles
                      )
                  ]
        );

    return roles.has(
        normalizeRole(
            identity &&
            identity.role
        )
    );
}

function requireRole(
    identity,
    allowedRoles
) {
    if (
        !identity ||
        !identity.uid
    ) {
        throw createServiceError(
            "unauthenticated",
            "Sign in before continuing.",
            {
                status: 401
            }
        );
    }

    if (
        !hasRole(
            identity,
            allowedRoles
        )
    ) {
        throw createServiceError(
            "permission-denied",
            "You do not have permission to perform this action.",
            {
                status: 403
            }
        );
    }

    return true;
}

/* ==========================================================
   ADMIN AUDIT CONTEXT
========================================================== */

function createAuditContext(
    identity,
    request
) {
    return {
        userId:
            identity &&
            identity.uid
                ? identity.uid
                : null,

        email:
            identity &&
            identity.email
                ? identity.email
                : null,

        role:
            identity &&
            identity.role
                ? identity.role
                : "unknown",

        ipAddress:
            request &&
            request.ip
                ? request.ip
                : null,

        userAgent:
            request &&
            request.headers
                ? request.headers[
                      "user-agent"
                  ] || ""
                : "",

        createdAt:
            new Date().toISOString()
    };
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    requireAuthenticatedCallable:
        requireAuthenticatedCallable,

    requireAdminCallable:
        requireAdminCallable,

    authenticateRequest:
        authenticateRequest,

    requireAdminRequest:
        requireAdminRequest,

    resolveAdministrator:
        resolveAdministrator,

    requireResourceOwner:
        requireResourceOwner,

    requireOwnerOrAdmin:
        requireOwnerOrAdmin,

    requireActiveUser:
        requireActiveUser,

    requireVerifiedEmail:
        requireVerifiedEmail,

    requireAppCheck:
        requireAppCheck,

    normalizeRole:
        normalizeRole,

    hasRole:
        hasRole,

    requireRole:
        requireRole,

    createAuditContext:
        createAuditContext,

    constants: {
        ADMIN_ROLES:
            Array.from(
                ADMIN_ROLES
            ),

        ACTIVE_STATUS:
            ACTIVE_STATUS
    }
};