"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   FEATURE FLAG SERVICE

   Responsibilities:
   - Read feature flags from Firestore
   - Support global and user-targeted rollouts
   - Support deterministic percentage rollouts
   - Cache feature evaluations in memory
   - Provide safe defaults when flags are unavailable
========================================================== */

const crypto =
    require("node:crypto");

const {
    getRuntime
} = require(
    "./runtime"
);

const {
    ServiceError
} = require(
    "./service-error"
);

/* ==========================================================
   CONSTANTS
========================================================== */

const FEATURE_FLAG_COLLECTION =
    "_featureFlags";

const DEFAULT_CACHE_TTL_MS =
    30 * 1000;

const DEFAULT_ROLLOUT_PERCENTAGE =
    100;

const DEFAULT_VARIANT =
    "default";

const DEFAULT_MAX_CACHE_ENTRIES =
    1000;

const FEATURE_FLAG_STATUSES =
    Object.freeze({
        enabled:
            "enabled",

        disabled:
            "disabled",

        missing:
            "missing",

        error:
            "error"
    });

/* ==========================================================
   MEMORY CACHE
========================================================== */

const featureFlagCache =
    new Map();

/* ==========================================================
   SERVICE FACTORY
========================================================== */

function createFeatureFlagService(
    options
) {
    const settings =
        normalizeFeatureFlagOptions(
            options
        );

    const runtime =
        settings.runtime ||
        getRuntime();

    return Object.freeze({
        runtime:
            runtime,

        options:
            settings,

        evaluate:
            function (
                key,
                context,
                overrides
            ) {
                return evaluateFeatureFlag(
                    runtime,
                    key,
                    context,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        isEnabled:
            async function (
                key,
                context,
                overrides
            ) {
                const result =
                    await evaluateFeatureFlag(
                        runtime,
                        key,
                        context,
                        Object.assign(
                            {},
                            settings,
                            overrides || {}
                        )
                    );

                return result.enabled;
            },

        get:
            function (
                key,
                overrides
            ) {
                return getFeatureFlag(
                    runtime,
                    key,
                    Object.assign(
                        {},
                        settings,
                        overrides || {}
                    )
                );
            },

        clearCache:
            function (key) {
                return clearFeatureFlagCache(
                    key,
                    settings.namespace
                );
            }
    });
}

/* ==========================================================
   EVALUATION
========================================================== */

async function evaluateFeatureFlag(
    runtime,
    key,
    context,
    options
) {
    const settings =
        normalizeFeatureFlagOptions(
            options
        );

    const normalizedKey =
        normalizeFeatureFlagKey(
            key
        );

    const normalizedContext =
        normalizeEvaluationContext(
            context
        );

    if (
        settings.disabled
    ) {
        return createFeatureFlagResult(
            normalizedKey,
            {
                enabled:
                    settings.defaultValue,

                status:
                    settings.defaultValue
                        ? FEATURE_FLAG_STATUSES
                              .enabled
                        : FEATURE_FLAG_STATUSES
                              .disabled,

                reason:
                    "service-disabled",

                variant:
                    settings.defaultVariant,

                source:
                    "default"
            }
        );
    }

    try {
        const flag =
            await getFeatureFlag(
                runtime,
                normalizedKey,
                settings
            );

        if (!flag) {
            return createFeatureFlagResult(
                normalizedKey,
                {
                    enabled:
                        settings.defaultValue,

                    status:
                        FEATURE_FLAG_STATUSES
                            .missing,

                    reason:
                        "flag-missing",

                    variant:
                        settings.defaultVariant,

                    source:
                        "default"
                }
            );
        }

        return evaluateFeatureFlagRecord(
            flag,
            normalizedContext,
            settings
        );
    } catch (error) {
        logFeatureFlagError(
            runtime,
            normalizedKey,
            error,
            settings
        );

        if (
            settings.throwOnError
        ) {
            throw error;
        }

        return createFeatureFlagResult(
            normalizedKey,
            {
                enabled:
                    settings.defaultValue,

                status:
                    FEATURE_FLAG_STATUSES
                        .error,

                reason:
                    "evaluation-error",

                variant:
                    settings.defaultVariant,

                source:
                    "default",

                error:
                    serializeFeatureFlagError(
                        error
                    )
            }
        );
    }
}

/* ==========================================================
   RECORD EVALUATION
========================================================== */

function evaluateFeatureFlagRecord(
    flag,
    context,
    options
) {
    const settings =
        options || {};

    const normalizedFlag =
        normalizeFeatureFlagRecord(
            flag
        );

    if (
        normalizedFlag.archived
    ) {
        return createFeatureFlagResult(
            normalizedFlag.key,
            {
                enabled:
                    false,

                status:
                    FEATURE_FLAG_STATUSES
                        .disabled,

                reason:
                    "flag-archived",

                variant:
                    normalizedFlag
                        .disabledVariant,

                source:
                    "flag",

                flag:
                    normalizedFlag
            }
        );
    }

    if (
        normalizedFlag.enabled ===
        false
    ) {
        return createFeatureFlagResult(
            normalizedFlag.key,
            {
                enabled:
                    false,

                status:
                    FEATURE_FLAG_STATUSES
                        .disabled,

                reason:
                    "flag-disabled",

                variant:
                    normalizedFlag
                        .disabledVariant,

                source:
                    "flag",

                flag:
                    normalizedFlag
            }
        );
    }

    const targetingResult =
        evaluateTargetingRules(
            normalizedFlag,
            context
        );

    if (
        targetingResult.matched
    ) {
        return createFeatureFlagResult(
            normalizedFlag.key,
            {
                enabled:
                    targetingResult.enabled,

                status:
                    targetingResult.enabled
                        ? FEATURE_FLAG_STATUSES
                              .enabled
                        : FEATURE_FLAG_STATUSES
                              .disabled,

                reason:
                    targetingResult.reason,

                variant:
                    targetingResult.variant,

                source:
                    "targeting",

                ruleId:
                    targetingResult.ruleId,

                flag:
                    normalizedFlag
            }
        );
    }

    const rolloutResult =
        evaluatePercentageRollout(
            normalizedFlag,
            context,
            settings
        );

    return createFeatureFlagResult(
        normalizedFlag.key,
        {
            enabled:
                rolloutResult.enabled,

            status:
                rolloutResult.enabled
                    ? FEATURE_FLAG_STATUSES
                          .enabled
                    : FEATURE_FLAG_STATUSES
                          .disabled,

            reason:
                rolloutResult.reason,

            variant:
                rolloutResult.variant,

            source:
                rolloutResult.source,

            bucket:
                rolloutResult.bucket,

            flag:
                normalizedFlag
        }
    );
}

/* ==========================================================
   TARGETING
========================================================== */

function evaluateTargetingRules(
    flag,
    context
) {
    const rules =
        Array.isArray(
            flag.rules
        )
            ? flag.rules
            : [];

    for (
        const rule of rules
    ) {
        if (
            evaluateTargetingRule(
                rule,
                context
            )
        ) {
            return {
                matched:
                    true,

                enabled:
                    rule.enabled !==
                    false,

                variant:
                    normalizeVariant(
                        rule.variant ||
                        (
                            rule.enabled ===
                            false
                                ? flag
                                      .disabledVariant
                                : flag
                                      .enabledVariant
                        )
                    ),

                reason:
                    "targeting-rule",

                ruleId:
                    rule.id ||
                    null
            };
        }
    }

    return {
        matched:
            false
    };
}

function evaluateTargetingRule(
    rule,
    context
) {
    if (
        !rule ||
        typeof rule !==
        "object"
    ) {
        return false;
    }

    const conditions =
        Array.isArray(
            rule.conditions
        )
            ? rule.conditions
            : [];

    if (!conditions.length) {
        return false;
    }

    const operator =
        String(
            rule.operator ||
            "all"
        ).toLowerCase();

    const evaluations =
        conditions.map(
            function (condition) {
                return evaluateCondition(
                    condition,
                    context
                );
            }
        );

    if (
        operator ===
        "any"
    ) {
        return evaluations.some(
            Boolean
        );
    }

    return evaluations.every(
        Boolean
    );
}

function evaluateCondition(
    condition,
    context
) {
    if (
        !condition ||
        typeof condition !==
        "object"
    ) {
        return false;
    }

    const attribute =
        String(
            condition.attribute ||
            condition.field ||
            ""
        ).trim();

    if (!attribute) {
        return false;
    }

    const actual =
        getNestedValue(
            context,
            attribute
        );

    const expected =
        condition.value;

    const operator =
        String(
            condition.operator ||
            "equals"
        )
            .trim()
            .toLowerCase();

    switch (operator) {
        case "equals":
        case "eq":
            return valuesEqual(
                actual,
                expected
            );

        case "not-equals":
        case "neq":
            return !valuesEqual(
                actual,
                expected
            );

        case "in":
            return Array.isArray(
                expected
            ) &&
            expected.some(
                function (value) {
                    return valuesEqual(
                        actual,
                        value
                    );
                }
            );

        case "not-in":
            return Array.isArray(
                expected
            ) &&
            !expected.some(
                function (value) {
                    return valuesEqual(
                        actual,
                        value
                    );
                }
            );

        case "contains":
            if (
                Array.isArray(actual)
            ) {
                return actual.some(
                    function (value) {
                        return valuesEqual(
                            value,
                            expected
                        );
                    }
                );
            }

            return String(
                actual || ""
            ).includes(
                String(
                    expected || ""
                )
            );

        case "starts-with":
            return String(
                actual || ""
            ).startsWith(
                String(
                    expected || ""
                )
            );

        case "ends-with":
            return String(
                actual || ""
            ).endsWith(
                String(
                    expected || ""
                )
            );

        case "greater-than":
        case "gt":
            return (
                Number(actual) >
                Number(expected)
            );

        case "greater-than-or-equal":
        case "gte":
            return (
                Number(actual) >=
                Number(expected)
            );

        case "less-than":
        case "lt":
            return (
                Number(actual) <
                Number(expected)
            );

        case "less-than-or-equal":
        case "lte":
            return (
                Number(actual) <=
                Number(expected)
            );

        case "exists":
            return actual !==
                undefined &&
                actual !==
                null;

        case "not-exists":
            return actual ===
                undefined ||
                actual ===
                null;

        default:
            return false;
    }
}

/* ==========================================================
   PERCENTAGE ROLLOUT
========================================================== */

function evaluatePercentageRollout(
    flag,
    context,
    options
) {
    const percentage =
        normalizeRolloutPercentage(
            flag.rolloutPercentage
        );

    if (
        percentage <= 0
    ) {
        return {
            enabled:
                false,

            variant:
                flag.disabledVariant,

            reason:
                "rollout-excluded",

            source:
                "rollout",

            bucket:
                null
        };
    }

    if (
        percentage >= 100
    ) {
        return {
            enabled:
                true,

            variant:
                flag.enabledVariant,

            reason:
                "rollout-full",

            source:
                "rollout",

            bucket:
                null
        };
    }

    const identity =
        resolveRolloutIdentity(
            context,
            options
        );

    if (!identity) {
        return {
            enabled:
                Boolean(
                    options &&
                    options.defaultValue
                ),

            variant:
                options &&
                options.defaultValue
                    ? flag.enabledVariant
                    : flag.disabledVariant,

            reason:
                "rollout-identity-missing",

            source:
                "default",

            bucket:
                null
        };
    }

    const bucket =
        calculateRolloutBucket(
            flag.key,
            identity
        );

    const enabled =
        bucket <
        percentage;

    return {
        enabled:
            enabled,

        variant:
            enabled
                ? flag.enabledVariant
                : flag.disabledVariant,

        reason:
            enabled
                ? "rollout-included"
                : "rollout-excluded",

        source:
            "rollout",

        bucket:
            bucket
    };
}

function resolveRolloutIdentity(
    context,
    options
) {
    const settings =
        options || {};

    if (
        typeof settings
            .identityResolver ===
        "function"
    ) {
        const resolved =
            settings.identityResolver(
                context
            );

        return normalizeOptionalString(
            resolved
        );
    }

    return normalizeOptionalString(
        context.userId ||
        context.uid ||
        context.sessionId ||
        context.deviceId ||
        context.ip
    );
}

function calculateRolloutBucket(
    flagKey,
    identity
) {
    const hash =
        crypto
            .createHash(
                "sha256"
            )
            .update(
                String(flagKey) +
                ":" +
                String(identity)
            )
            .digest();

    const integer =
        hash.readUInt32BE(0);

    return (
        integer %
        10000
    ) /
    100;
}

/* ==========================================================
   FIRESTORE READ
========================================================== */

async function getFeatureFlag(
    runtime,
    key,
    options
) {
    const settings =
        normalizeFeatureFlagOptions(
            options
        );

    const normalizedKey =
        normalizeFeatureFlagKey(
            key
        );

    if (
        settings.disabled
    ) {
        return null;
    }

    assertFeatureFlagRuntime(
        runtime
    );

    const cacheKey =
        createCacheKey(
            settings.namespace,
            normalizedKey
        );

    if (
        settings.cache
    ) {
        const cached =
            readFeatureFlagCache(
                cacheKey,
                resolveNow(
                    runtime,
                    settings
                )
            );

        if (
            cached.hit
        ) {
            return cloneValue(
                cached.value
            );
        }
    }

    const snapshot =
        await runtime.db
            .collection(
                settings.collection
            )
            .doc(
                normalizedKey
            )
            .get();

    const flag =
        snapshot.exists
            ? normalizeFeatureFlagRecord(
                  Object.assign(
                      {},
                      snapshot.data(),
                      {
                          key:
                              normalizedKey
                      }
                  )
              )
            : null;

    if (
        settings.cache
    ) {
        writeFeatureFlagCache(
            cacheKey,
            flag,
            resolveNow(
                runtime,
                settings
            ) +
            settings.cacheTtlMs,
            settings.maxCacheEntries
        );
    }

    return cloneValue(flag);
}

/* ==========================================================
   RECORD NORMALIZATION
========================================================== */

function normalizeFeatureFlagRecord(
    record
) {
    const source =
        record || {};

    return {
        key:
            normalizeFeatureFlagKey(
                source.key
            ),

        enabled:
            source.enabled !==
            false,

        archived:
            Boolean(
                source.archived
            ),

        description:
            normalizeOptionalString(
                source.description
            ),

        rolloutPercentage:
            normalizeRolloutPercentage(
                source.rolloutPercentage
            ),

        enabledVariant:
            normalizeVariant(
                source.enabledVariant ||
                source.variant ||
                DEFAULT_VARIANT
            ),

        disabledVariant:
            normalizeVariant(
                source.disabledVariant ||
                "disabled"
            ),

        rules:
            normalizeTargetingRules(
                source.rules
            ),

        metadata:
            cloneValue(
                source.metadata ||
                {}
            ),

        createdAt:
            serializeTimestamp(
                source.createdAt
            ),

        updatedAt:
            serializeTimestamp(
                source.updatedAt
            )
    };
}

function normalizeTargetingRules(
    value
) {
    if (
        !Array.isArray(value)
    ) {
        return [];
    }

    return value
        .filter(
            function (rule) {
                return (
                    rule &&
                    typeof rule ===
                        "object"
                );
            }
        )
        .map(
            function (rule) {
                return {
                    id:
                        normalizeOptionalString(
                            rule.id
                        ),

                    enabled:
                        rule.enabled !==
                        false,

                    variant:
                        rule.variant
                            ? normalizeVariant(
                                  rule.variant
                              )
                            : null,

                    operator:
                        String(
                            rule.operator ||
                            "all"
                        ).toLowerCase() ===
                        "any"
                            ? "any"
                            : "all",

                    conditions:
                        Array.isArray(
                            rule.conditions
                        )
                            ? rule.conditions
                                  .filter(
                                      function (
                                          condition
                                      ) {
                                          return (
                                              condition &&
                                              typeof condition ===
                                                  "object"
                                          );
                                      }
                                  )
                                  .map(
                                      function (
                                          condition
                                      ) {
                                          return {
                                              attribute:
                                                  normalizeOptionalString(
                                                      condition.attribute ||
                                                      condition.field
                                                  ),

                                              operator:
                                                  normalizeOptionalString(
                                                      condition.operator
                                                  ) ||
                                                  "equals",

                                              value:
                                                  cloneValue(
                                                      condition.value
                                                  )
                                          };
                                      }
                                  )
                            : []
                };
            }
        );
}

/* ==========================================================
   RESULT
========================================================== */

function createFeatureFlagResult(
    key,
    values
) {
    const source =
        values || {};

    return {
        key:
            normalizeFeatureFlagKey(
                key
            ),

        enabled:
            Boolean(
                source.enabled
            ),

        status:
            source.status ||
            (
                source.enabled
                    ? FEATURE_FLAG_STATUSES
                          .enabled
                    : FEATURE_FLAG_STATUSES
                          .disabled
            ),

        reason:
            source.reason ||
            null,

        variant:
            normalizeVariant(
                source.variant ||
                DEFAULT_VARIANT
            ),

        source:
            source.source ||
            "default",

        ruleId:
            source.ruleId ||
            null,

        bucket:
            source.bucket !==
            undefined
                ? source.bucket
                : null,

        error:
            source.error ||
            null,

        flag:
            source.flag
                ? cloneValue(
                      source.flag
                  )
                : null
    };
}

/* ==========================================================
   CACHE HELPERS
========================================================== */

function createCacheKey(
    namespace,
    key
) {
    return (
        normalizeNamespace(
            namespace
        ) +
        ":" +
        normalizeFeatureFlagKey(
            key
        )
    );
}

function readFeatureFlagCache(
    key,
    now
) {
    const entry =
        featureFlagCache.get(
            key
        );

    if (!entry) {
        return {
            hit:
                false,

            value:
                null
        };
    }

    if (
        Number(entry.expiresAt) <=
        Number(now)
    ) {
        featureFlagCache.delete(
            key
        );

        return {
            hit:
                false,

            value:
                null
        };
    }

    return {
        hit:
            true,

        value:
            cloneValue(
                entry.value
            )
    };
}

function writeFeatureFlagCache(
    key,
    value,
    expiresAt,
    maximumEntries
) {
    if (
        featureFlagCache.size >=
        maximumEntries &&
        !featureFlagCache.has(
            key
        )
    ) {
        const firstKey =
            featureFlagCache
                .keys()
                .next()
                .value;

        if (
            firstKey !==
            undefined
        ) {
            featureFlagCache.delete(
                firstKey
            );
        }
    }

    featureFlagCache.set(
        key,
        {
            value:
                cloneValue(value),

            expiresAt:
                Number(expiresAt)
        }
    );

    return true;
}

function clearFeatureFlagCache(
    key,
    namespace
) {
    if (
        key === undefined ||
        key === null
    ) {
        const count =
            featureFlagCache.size;

        featureFlagCache.clear();

        return count;
    }

    const cacheKey =
        createCacheKey(
            namespace,
            key
        );

    return featureFlagCache.delete(
        cacheKey
    )
        ? 1
        : 0;
}

/* ==========================================================
   CONTEXT
========================================================== */

function normalizeEvaluationContext(
    context
) {
    const source =
        context || {};

    const auth =
        source.auth ||
        {};

    const token =
        auth.token ||
        {};

    const request =
        source.rawRequest ||
        source.request ||
        source;

    return Object.assign(
        {},
        cloneValue(source),
        {
            userId:
                source.userId ||
                source.uid ||
                auth.uid ||
                null,

            email:
                source.email ||
                token.email ||
                null,

            role:
                source.role ||
                token.role ||
                null,

            ip:
                source.ip ||
                request.ip ||
                (
                    request.socket &&
                    request.socket
                        .remoteAddress
                ) ||
                null,

            country:
                source.country ||
                (
                    request.headers &&
                    (
                        request.headers[
                            "x-country"
                        ] ||
                        request.headers[
                            "cf-ipcountry"
                        ]
                    )
                ) ||
                null
        }
    );
}

function getNestedValue(
    object,
    path
) {
    return String(path)
        .split(".")
        .reduce(
            function (
                current,
                segment
            ) {
                if (
                    current === null ||
                    current === undefined
                ) {
                    return undefined;
                }

                return current[
                    segment
                ];
            },
            object
        );
}

function valuesEqual(
    left,
    right
) {
    if (
        typeof left ===
            "number" ||
        typeof right ===
            "number"
    ) {
        return (
            Number(left) ===
            Number(right)
        );
    }

    if (
        typeof left ===
            "boolean" ||
        typeof right ===
            "boolean"
    ) {
        return (
            Boolean(left) ===
            Boolean(right)
        );
    }

    return (
        String(
            left === undefined ||
            left === null
                ? ""
                : left
        ) ===
        String(
            right === undefined ||
            right === null
                ? ""
                : right
        )
    );
}

/* ==========================================================
   NORMALIZERS
========================================================== */

function normalizeFeatureFlagKey(
    value
) {
    const normalized =
        String(
            value || ""
        )
            .trim()
            .toLowerCase()
            .replace(
                /[^a-z0-9._:-]/g,
                "-"
            );

    if (!normalized) {
        throw new ServiceError(
            "invalid-argument",
            "The feature flag key is invalid.",
            {
                status:
                    400,

                expose:
                    true
            }
        );
    }

    if (
        normalized.includes("/")
    ) {
        throw new ServiceError(
            "invalid-argument",
            "The feature flag key cannot contain a slash.",
            {
                status:
                    400,

                expose:
                    true
            }
        );
    }

    return normalized;
}

function normalizeNamespace(
    value
) {
    const normalized =
        String(
            value ||
            "default"
        )
            .trim()
            .toLowerCase()
            .replace(
                /[^a-z0-9._:-]/g,
                "-"
            );

    return normalized ||
        "default";
}

function normalizeRolloutPercentage(
    value
) {
    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {
        return DEFAULT_ROLLOUT_PERCENTAGE;
    }

    const normalized =
        Number(value);

    if (
        !Number.isFinite(
            normalized
        )
    ) {
        throw new TypeError(
            "Feature flag rollout percentage must be a number."
        );
    }

    return Math.min(
        100,
        Math.max(
            0,
            normalized
        )
    );
}

function normalizeVariant(
    value
) {
    const normalized =
        String(
            value ||
            DEFAULT_VARIANT
        ).trim();

    return normalized ||
        DEFAULT_VARIANT;
}

function normalizeOptionalString(
    value
) {
    if (
        value === undefined ||
        value === null
    ) {
        return null;
    }

    const normalized =
        String(value)
            .trim();

    return normalized ||
        null;
}

function normalizePositiveInteger(
    value,
    fallback,
    label
) {
    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {
        return fallback;
    }

    const normalized =
        Number(value);

    if (
        !Number.isInteger(
            normalized
        ) ||
        normalized <= 0
    ) {
        throw new TypeError(
            label +
            " must be a positive integer."
        );
    }

    return normalized;
}

/* ==========================================================
   OPTIONS
========================================================== */

function normalizeFeatureFlagOptions(
    options
) {
    const settings =
        options || {};

    return {
        runtime:
            settings.runtime,

        collection:
            normalizeCollection(
                settings.collection ||
                FEATURE_FLAG_COLLECTION
            ),

        namespace:
            normalizeNamespace(
                settings.namespace
            ),

        defaultValue:
            Boolean(
                settings.defaultValue
            ),

        defaultVariant:
            normalizeVariant(
                settings.defaultVariant ||
                DEFAULT_VARIANT
            ),

        cache:
            settings.cache !==
            false,

        cacheTtlMs:
            normalizePositiveInteger(
                settings.cacheTtlMs,
                DEFAULT_CACHE_TTL_MS,
                "Feature flag cache TTL"
            ),

        maxCacheEntries:
            normalizePositiveInteger(
                settings.maxCacheEntries,
                DEFAULT_MAX_CACHE_ENTRIES,
                "Maximum feature flag cache entries"
            ),

        disabled:
            Boolean(
                settings.disabled
            ),

        throwOnError:
            Boolean(
                settings.throwOnError
            ),

        identityResolver:
            settings.identityResolver,

        log:
            settings.log !==
            false,

        now:
            settings.now
    };
}

function normalizeCollection(
    value
) {
    const collection =
        String(
            value || ""
        ).trim();

    if (
        !collection ||
        collection.includes("/")
    ) {
        throw new TypeError(
            "Feature flag collection must be a Firestore collection name."
        );
    }

    return collection;
}

/* ==========================================================
   RUNTIME
========================================================== */

function assertFeatureFlagRuntime(
    runtime
) {
    if (
        !runtime ||
        !runtime.db ||
        typeof runtime.db
            .collection !==
            "function"
    ) {
        throw new ServiceError(
            "configuration-error",
            "The feature flag datastore is unavailable.",
            {
                status:
                    500,

                expose:
                    false
            }
        );
    }
}

function resolveNow(
    runtime,
    options
) {
    const settings =
        options || {};

    if (
        typeof settings.now ===
        "function"
    ) {
        return Number(
            settings.now()
        );
    }

    if (
        runtime &&
        typeof runtime.now ===
            "function"
    ) {
        return Number(
            runtime.now()
        );
    }

    return Date.now();
}

/* ==========================================================
   TIME AND DATA
========================================================== */

function toMilliseconds(
    value
) {
    if (
        value === undefined ||
        value === null
    ) {
        return 0;
    }

    if (
        value instanceof Date
    ) {
        return value.getTime();
    }

    if (
        value &&
        typeof value.toMillis ===
            "function"
    ) {
        return value.toMillis();
    }

    if (
        typeof value ===
        "string"
    ) {
        const parsed =
            Date.parse(value);

        return Number.isNaN(
            parsed
        )
            ? 0
            : parsed;
    }

    const normalized =
        Number(value);

    return Number.isFinite(
        normalized
    )
        ? normalized
        : 0;
}

function serializeTimestamp(
    value
) {
    const milliseconds =
        toMilliseconds(
            value
        );

    return milliseconds
        ? new Date(
              milliseconds
          ).toISOString()
        : null;
}

function cloneValue(
    value
) {
    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    if (
        value instanceof Date
    ) {
        return new Date(
            value.getTime()
        );
    }

    if (
        Buffer.isBuffer(value)
    ) {
        return Buffer.from(
            value
        );
    }

    if (
        Array.isArray(value)
    ) {
        return value.map(
            cloneValue
        );
    }

    if (
        typeof value ===
        "object"
    ) {
        if (
            typeof value.toMillis ===
            "function"
        ) {
            return value;
        }

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

/* ==========================================================
   LOGGING
========================================================== */

function logFeatureFlagError(
    runtime,
    key,
    error,
    options
) {
    const settings =
        options || {};

    if (
        !settings.log ||
        !runtime ||
        !runtime.logger ||
        typeof runtime.logger.warn !==
            "function"
    ) {
        return;
    }

    runtime.logger.warn(
        "Feature flag evaluation failed.",
        {
            key:
                key,

            code:
                error &&
                error.code,

            message:
                error &&
                error.message
        }
    );
}

function serializeFeatureFlagError(
    error
) {
    if (!error) {
        return null;
    }

    return {
        name:
            error.name ||
            "Error",

        code:
            error.code ||
            "internal",

        message:
            error.publicMessage ||
            error.message ||
            "Feature flag evaluation failed."
    };
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    createFeatureFlagService,
    evaluateFeatureFlag,
    evaluateFeatureFlagRecord,
    evaluateTargetingRules,
    evaluateTargetingRule,
    evaluateCondition,
    evaluatePercentageRollout,
    resolveRolloutIdentity,
    calculateRolloutBucket,
    getFeatureFlag,
    normalizeFeatureFlagRecord,
    normalizeTargetingRules,
    createFeatureFlagResult,
    createCacheKey,
    readFeatureFlagCache,
    writeFeatureFlagCache,
    clearFeatureFlagCache,
    normalizeEvaluationContext,
    getNestedValue,
    valuesEqual,
    normalizeFeatureFlagKey,
    normalizeNamespace,
    normalizeRolloutPercentage,
    normalizeVariant,
    normalizeOptionalString,
    normalizePositiveInteger,
    normalizeFeatureFlagOptions,
    normalizeCollection,
    assertFeatureFlagRuntime,
    resolveNow,
    toMilliseconds,
    serializeTimestamp,
    logFeatureFlagError,
    serializeFeatureFlagError,
    constants: {
        FEATURE_FLAG_COLLECTION,
        DEFAULT_CACHE_TTL_MS,
        DEFAULT_ROLLOUT_PERCENTAGE,
        DEFAULT_VARIANT,
        DEFAULT_MAX_CACHE_ENTRIES,
        FEATURE_FLAG_STATUSES
    }
};