"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ACCOUNT SERVICE
========================================================== */

const {
    FieldValue,
    Timestamp
} = require("firebase-admin/firestore");

const {
    createServiceError,
    normalizeUserId,
    normalizeUserRole,
    normalizeUserStatus,
    normalizeString
} = require("../shared/validation");

/* ==========================================================
   CONSTANTS
========================================================== */

const USER_COLLECTION = "users";
const AUDIT_COLLECTION = "auditLogs";

const VALID_ROLES =
    new Set([
        "customer",
        "admin",
        "superadmin"
    ]);

const VALID_STATUSES =
    new Set([
        "active",
        "disabled"
    ]);

/* ==========================================================
   ROLE MANAGEMENT
========================================================== */

async function setUserRole(options) {
    const settings = options || {};

    assertDependencies({
        db: settings.db,
        auth: settings.auth
    });

    const userId =
        normalizeUserId(
            settings.userId
        );

    const role =
        normalizeUserRole(
            settings.role
        );

    const administrator =
        settings.administrator || {};

    if (
        userId === administrator.uid &&
        role !== "superadmin"
    ) {
        throw createServiceError(
            "failed-precondition",
            "You cannot remove your own super-administrator access.",
            {
                status: 412
            }
        );
    }

    const targetUser =
        await getAuthUser(
            settings.auth,
            userId
        );

    const userReference =
        settings.db
            .collection(
                USER_COLLECTION
            )
            .doc(userId);

    const snapshot =
        await userReference.get();

    const profile =
        snapshot.exists
            ? snapshot.data() || {}
            : {};

    const previousRole =
        normalizeRole(
            profile.role ||
            (
                targetUser
                    .customClaims &&
                targetUser
                    .customClaims.role
            ) ||
            "customer"
        );

    if (
        previousRole ===
            "superadmin" &&
        role !==
            "superadmin"
    ) {
        await ensureAnotherSuperAdmin({
            db: settings.db,
            excludingUserId:
                userId
        });
    }

    const customClaims =
        Object.assign(
            {},
            targetUser.customClaims ||
            {},
            buildRoleClaims(role)
        );

    await settings.auth
        .setCustomUserClaims(
            userId,
            customClaims
        );

    const now =
        Timestamp.now();

    await userReference.set(
        {
            uid: userId,

            email:
                profile.email ||
                targetUser.email ||
                "",

            role: role,

            status:
                profile.status ||
                (
                    targetUser.disabled
                        ? "disabled"
                        : "active"
                ),

            roleUpdatedAt:
                now,

            roleUpdatedBy:
                administrator.uid ||
                null,

            updatedAt:
                now
        },
        {
            merge: true
        }
    );

    await writeAuditLog({
        db: settings.db,

        action:
            "user.role.updated",

        targetType:
            "user",

        targetId:
            userId,

        actor:
            administrator,

        changes: {
            before: {
                role:
                    previousRole
            },

            after: {
                role: role
            }
        }
    });

    await revokeUserSessions(
        settings.auth,
        userId
    );

    return {
        success: true,
        userId: userId,
        role: role,
        previousRole:
            previousRole,
        sessionsRevoked:
            true
    };
}

/* ==========================================================
   STATUS MANAGEMENT
========================================================== */

async function setUserStatus(options) {
    const settings = options || {};

    assertDependencies({
        db: settings.db,
        auth: settings.auth
    });

    const userId =
        normalizeUserId(
            settings.userId
        );

    const status =
        normalizeUserStatus(
            settings.status
        );

    const reason =
        normalizeString(
            settings.reason,
            {
                fieldName:
                    "Status reason",
                maximumLength: 1000
            }
        );

    const administrator =
        settings.administrator || {};

    if (
        userId === administrator.uid &&
        status === "disabled"
    ) {
        throw createServiceError(
            "failed-precondition",
            "You cannot disable your own account.",
            {
                status: 412
            }
        );
    }

    const targetUser =
        await getAuthUser(
            settings.auth,
            userId
        );

    const userReference =
        settings.db
            .collection(
                USER_COLLECTION
            )
            .doc(userId);

    const snapshot =
        await userReference.get();

    const profile =
        snapshot.exists
            ? snapshot.data() || {}
            : {};

    const role =
        normalizeRole(
            profile.role ||
            (
                targetUser
                    .customClaims &&
                targetUser
                    .customClaims.role
            ) ||
            "customer"
        );

    if (
        role === "superadmin" &&
        status === "disabled"
    ) {
        await ensureAnotherSuperAdmin({
            db: settings.db,
            excludingUserId:
                userId
        });
    }

    await settings.auth.updateUser(
        userId,
        {
            disabled:
                status === "disabled"
        }
    );

    const now =
        Timestamp.now();

    await userReference.set(
        {
            uid: userId,

            email:
                profile.email ||
                targetUser.email ||
                "",

            status: status,

            statusReason:
                reason ||
                null,

            statusUpdatedAt:
                now,

            statusUpdatedBy:
                administrator.uid ||
                null,

            disabledAt:
                status === "disabled"
                    ? now
                    : null,

            reactivatedAt:
                status === "active"
                    ? now
                    : null,

            updatedAt:
                now
        },
        {
            merge: true
        }
    );

    if (status === "disabled") {
        await revokeUserSessions(
            settings.auth,
            userId
        );
    }

    await writeAuditLog({
        db: settings.db,

        action:
            status === "disabled"
                ? "user.disabled"
                : "user.reactivated",

        targetType:
            "user",

        targetId:
            userId,

        actor:
            administrator,

        changes: {
            before: {
                status:
                    profile.status ||
                    (
                        targetUser.disabled
                            ? "disabled"
                            : "active"
                    )
            },

            after: {
                status: status,
                reason:
                    reason || null
            }
        }
    });

    return {
        success: true,
        userId: userId,
        status: status,
        sessionsRevoked:
            status === "disabled"
    };
}

/* ==========================================================
   PROFILE CREATED TRIGGER
========================================================== */

async function handleProfileCreated(options) {
    const settings = options || {};

    assertDependencies({
        db: settings.db,
        auth: settings.auth
    });

    const userId =
        normalizeUserId(
            settings.userId
        );

    const profile =
        settings.profile || {};

    const authUser =
        await getAuthUser(
            settings.auth,
            userId
        );

    const role =
        normalizeRole(
            profile.role ||
            (
                authUser.customClaims &&
                authUser
                    .customClaims.role
            ) ||
            "customer"
        );

    const status =
        normalizeStatus(
            profile.status ||
            (
                authUser.disabled
                    ? "disabled"
                    : "active"
            )
        );

    const now =
        Timestamp.now();

    await settings.db
        .collection(
            USER_COLLECTION
        )
        .doc(userId)
        .set(
            {
                uid: userId,

                email:
                    profile.email ||
                    authUser.email ||
                    "",

                displayName:
                    profile.displayName ||
                    authUser.displayName ||
                    "",

                photoURL:
                    profile.photoURL ||
                    authUser.photoURL ||
                    "",

                emailVerified:
                    Boolean(
                        authUser.emailVerified
                    ),

                role: role,
                status: status,

                preferences:
                    profile.preferences ||
                    {
                        currency: "NGN",
                        language: "en",
                        marketingEmails:
                            false,
                        orderUpdates:
                            true
                    },

                addresses:
                    Array.isArray(
                        profile.addresses
                    )
                        ? profile.addresses
                        : [],

                createdAt:
                    profile.createdAt ||
                    now,

                updatedAt:
                    now
            },
            {
                merge: true
            }
        );

    await synchronizeClaims({
        auth: settings.auth,
        userId: userId,
        role: role
    });

    if (
        authUser.disabled !==
        (
            status === "disabled"
        )
    ) {
        await settings.auth.updateUser(
            userId,
            {
                disabled:
                    status ===
                    "disabled"
            }
        );
    }

    await writeAuditLog({
        db: settings.db,

        action:
            "user.profile.created",

        targetType:
            "user",

        targetId:
            userId,

        actor: {
            uid: userId,
            email:
                authUser.email ||
                profile.email ||
                "",
            role: role
        },

        changes: {
            role: role,
            status: status
        }
    });

    return {
        success: true,
        userId: userId,
        role: role,
        status: status
    };
}

/* ==========================================================
   PROFILE UPDATED TRIGGER
========================================================== */

async function synchronizeAuthAccount(
    options
) {
    const settings = options || {};

    assertDependencies({
        db: settings.db,
        auth: settings.auth
    });

    const userId =
        normalizeUserId(
            settings.userId
        );

    const before =
        settings.before || {};

    const after =
        settings.after || {};

    const beforeRole =
        normalizeRole(
            before.role ||
            "customer"
        );

    const afterRole =
        normalizeRole(
            after.role ||
            "customer"
        );

    const beforeStatus =
        normalizeStatus(
            before.status ||
            "active"
        );

    const afterStatus =
        normalizeStatus(
            after.status ||
            "active"
        );

    if (
        beforeRole ===
            "superadmin" &&
        afterRole !==
            "superadmin"
    ) {
        await ensureAnotherSuperAdmin({
            db: settings.db,
            excludingUserId:
                userId
        });
    }

    if (
        beforeStatus ===
            "active" &&
        afterStatus ===
            "disabled" &&
        afterRole ===
            "superadmin"
    ) {
        await ensureAnotherSuperAdmin({
            db: settings.db,
            excludingUserId:
                userId
        });
    }

    const authUser =
        await getAuthUser(
            settings.auth,
            userId
        );

    const roleChanged =
        beforeRole !==
        afterRole;

    const statusChanged =
        beforeStatus !==
        afterStatus;

    if (roleChanged) {
        const customClaims =
            Object.assign(
                {},
                authUser.customClaims ||
                {},
                buildRoleClaims(
                    afterRole
                )
            );

        await settings.auth
            .setCustomUserClaims(
                userId,
                customClaims
            );
    }

    if (
        authUser.disabled !==
        (
            afterStatus ===
            "disabled"
        )
    ) {
        await settings.auth.updateUser(
            userId,
            {
                disabled:
                    afterStatus ===
                    "disabled"
            }
        );
    }

    if (
        roleChanged ||
        statusChanged
    ) {
        await revokeUserSessions(
            settings.auth,
            userId
        );
    }

    await writeAuditLog({
        db: settings.db,

        action:
            "user.auth.synchronized",

        targetType:
            "user",

        targetId:
            userId,

        actor: {
            uid: null,
            email: null,
            role: "system"
        },

        changes: {
            before: {
                role:
                    beforeRole,
                status:
                    beforeStatus
            },

            after: {
                role:
                    afterRole,
                status:
                    afterStatus
            }
        }
    });

    return {
        success: true,
        userId: userId,
        roleChanged:
            roleChanged,
        statusChanged:
            statusChanged,
        sessionsRevoked:
            roleChanged ||
            statusChanged
    };
}

/* ==========================================================
   CLAIM SYNCHRONIZATION
========================================================== */

async function synchronizeClaims(
    options
) {
    const authUser =
        await getAuthUser(
            options.auth,
            options.userId
        );

    const existingClaims =
        authUser.customClaims ||
        {};

    const desiredClaims =
        Object.assign(
            {},
            existingClaims,
            buildRoleClaims(
                options.role
            )
        );

    if (
        claimsEqual(
            existingClaims,
            desiredClaims
        )
    ) {
        return false;
    }

    await options.auth
        .setCustomUserClaims(
            options.userId,
            desiredClaims
        );

    return true;
}

function buildRoleClaims(role) {
    const normalized =
        normalizeRole(role);

    return {
        role: normalized,

        admin:
            normalized === "admin" ||
            normalized ===
                "superadmin",

        superadmin:
            normalized ===
            "superadmin"
    };
}

function claimsEqual(
    first,
    second
) {
    const keys =
        new Set([
            ...Object.keys(
                first || {}
            ),
            ...Object.keys(
                second || {}
            )
        ]);

    return Array.from(
        keys
    ).every(function (key) {
        return (
            first[key] ===
            second[key]
        );
    });
}

/* ==========================================================
   SUPER-ADMIN SAFETY
========================================================== */

async function ensureAnotherSuperAdmin(
    options
) {
    const snapshot =
        await options.db
            .collection(
                USER_COLLECTION
            )
            .where(
                "role",
                "==",
                "superadmin"
            )
            .where(
                "status",
                "==",
                "active"
            )
            .limit(2)
            .get();

    const remaining =
        snapshot.docs.filter(
            function (document) {
                return (
                    document.id !==
                    options.excludingUserId
                );
            }
        );

    if (!remaining.length) {
        throw createServiceError(
            "failed-precondition",
            "At least one active super-administrator must remain.",
            {
                status: 412
            }
        );
    }

    return true;
}

/* ==========================================================
   ACCOUNT DELETION SUPPORT
========================================================== */

async function deleteUserAccount(options) {
    const settings = options || {};

    assertDependencies({
        db: settings.db,
        auth: settings.auth
    });

    const userId =
        normalizeUserId(
            settings.userId
        );

    const userReference =
        settings.db
            .collection(
                USER_COLLECTION
            )
            .doc(userId);

    const snapshot =
        await userReference.get();

    const profile =
        snapshot.exists
            ? snapshot.data() || {}
            : {};

    const role =
        normalizeRole(
            profile.role ||
            "customer"
        );

    if (role === "superadmin") {
        await ensureAnotherSuperAdmin({
            db: settings.db,
            excludingUserId:
                userId
        });
    }

    const now =
        Timestamp.now();

    await userReference.set(
        {
            status: "deleted",

            deletedAt:
                now,

            deletedBy:
                settings.administrator &&
                settings.administrator.uid
                    ? settings.administrator
                          .uid
                    : userId,

            updatedAt:
                now,

            email:
                anonymizeEmail(
                    profile.email,
                    userId
                ),

            displayName:
                "Deleted customer",

            phoneNumber:
                FieldValue.delete(),

            photoURL:
                FieldValue.delete(),

            addresses: [],

            paymentMethods:
                FieldValue.delete()
        },
        {
            merge: true
        }
    );

    try {
        await settings.auth
            .deleteUser(
                userId
            );
    } catch (error) {
        if (
            !error ||
            error.code !==
                "auth/user-not-found"
        ) {
            throw error;
        }
    }

    await writeAuditLog({
        db: settings.db,

        action:
            "user.deleted",

        targetType:
            "user",

        targetId:
            userId,

        actor:
            settings.administrator ||
            {
                uid: userId,
                role: "customer"
            },

        changes: {
            status: "deleted"
        }
    });

    return {
        success: true,
        userId: userId
    };
}

/* ==========================================================
   AUDIT LOGGING
========================================================== */

async function writeAuditLog(options) {
    if (!options.db) {
        return null;
    }

    const actor =
        options.actor || {};

    const reference =
        options.db
            .collection(
                AUDIT_COLLECTION
            )
            .doc();

    await reference.set(
        {
            action:
                String(
                    options.action ||
                    "unknown"
                ),

            targetType:
                String(
                    options.targetType ||
                    "unknown"
                ),

            targetId:
                options.targetId ||
                null,

            actor: {
                userId:
                    actor.uid ||
                    actor.userId ||
                    null,

                email:
                    actor.email ||
                    null,

                role:
                    actor.role ||
                    "unknown"
            },

            changes:
                options.changes ||
                null,

            metadata:
                options.metadata ||
                null,

            createdAt:
                Timestamp.now()
        }
    );

    return reference.id;
}

/* ==========================================================
   HELPERS
========================================================== */

function assertDependencies(options) {
    if (!options.db) {
        throw createServiceError(
            "internal",
            "The database service is unavailable.",
            {
                status: 500
            }
        );
    }

    if (!options.auth) {
        throw createServiceError(
            "internal",
            "The authentication service is unavailable.",
            {
                status: 500
            }
        );
    }
}

async function getAuthUser(
    auth,
    userId
) {
    try {
        return await auth.getUser(
            userId
        );
    } catch (error) {
        if (
            error &&
            error.code ===
                "auth/user-not-found"
        ) {
            throw createServiceError(
                "not-found",
                "The user account could not be found.",
                {
                    status: 404,
                    cause: error
                }
            );
        }

        throw error;
    }
}

async function revokeUserSessions(
    auth,
    userId
) {
    await auth
        .revokeRefreshTokens(
            userId
        );
}

function normalizeRole(value) {
    const role =
        String(
            value || "customer"
        )
            .trim()
            .toLowerCase();

    if (!VALID_ROLES.has(role)) {
        return "customer";
    }

    return role;
}

function normalizeStatus(value) {
    const status =
        String(
            value || "active"
        )
            .trim()
            .toLowerCase();

    if (!VALID_STATUSES.has(status)) {
        return "active";
    }

    return status;
}

function anonymizeEmail(
    email,
    userId
) {
    const domain =
        String(email || "")
            .split("@")[1] ||
        "deleted.invalid";

    return (
        "deleted+" +
        String(userId)
            .replace(
                /[^A-Za-z0-9]/g,
                ""
            )
            .slice(0, 40) +
        "@" +
        domain
    );
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    setUserRole:
        setUserRole,

    setUserStatus:
        setUserStatus,

    handleProfileCreated:
        handleProfileCreated,

    synchronizeAuthAccount:
        synchronizeAuthAccount,

    synchronizeClaims:
        synchronizeClaims,

    deleteUserAccount:
        deleteUserAccount,

    ensureAnotherSuperAdmin:
        ensureAnotherSuperAdmin,

    writeAuditLog:
        writeAuditLog,

    constants: {
        USER_COLLECTION:
            USER_COLLECTION,

        AUDIT_COLLECTION:
            AUDIT_COLLECTION,

        VALID_ROLES:
            Array.from(
                VALID_ROLES
            ),

        VALID_STATUSES:
            Array.from(
                VALID_STATUSES
            )
    },

    _internal: {
        buildRoleClaims:
            buildRoleClaims,

        claimsEqual:
            claimsEqual,

        normalizeRole:
            normalizeRole,

        normalizeStatus:
            normalizeStatus,

        anonymizeEmail:
            anonymizeEmail
    }
};