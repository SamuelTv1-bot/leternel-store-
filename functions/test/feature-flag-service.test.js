"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   FEATURE FLAG SERVICE TEST SUITE
========================================================== */

const test =
    require("node:test");

const assert =
    require("node:assert/strict");

const {
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
    constants
} = require(
    "../src/shared/feature-flag-service"
);

const {
    ServiceError
} = require(
    "../src/shared/service-error"
);

/* ==========================================================
   TEST HELPERS
========================================================== */

class TestTimestamp {
    constructor(milliseconds) {
        this.milliseconds =
            milliseconds;
    }

    toMillis() {
        return this.milliseconds;
    }

    toDate() {
        return new Date(
            this.milliseconds
        );
    }

    static fromMillis(
        milliseconds
    ) {
        return new TestTimestamp(
            milliseconds
        );
    }
}

function clone(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    if (
        value instanceof
        TestTimestamp
    ) {
        return TestTimestamp
            .fromMillis(
                value.toMillis()
            );
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
            clone
        );
    }

    if (
        typeof value ===
        "object"
    ) {
        return Object.keys(value)
            .reduce(
                function (
                    output,
                    key
                ) {
                    output[key] =
                        clone(
                            value[key]
                        );

                    return output;
                },
                {}
            );
    }

    return value;
}

function createFirestoreStub(
    initialDocuments
) {
    const documents =
        new Map();

    const reads =
        [];

    Object.entries(
        initialDocuments || {}
    ).forEach(
        function ([
            path,
            value
        ]) {
            documents.set(
                path,
                clone(value)
            );
        }
    );

    function createReference(
        collectionName,
        documentId
    ) {
        const path =
            collectionName +
            "/" +
            documentId;

        return {
            id:
                documentId,

            path:
                path,

            get:
                async function () {
                    reads.push(
                        path
                    );

                    return {
                        exists:
                            documents.has(path),

                        data:
                            function () {
                                return documents.has(
                                    path
                                )
                                    ? clone(
                                          documents.get(
                                              path
                                          )
                                      )
                                    : undefined;
                            }
                    };
                },

            set:
                async function (
                    value
                ) {
                    documents.set(
                        path,
                        clone(value)
                    );
                },

            delete:
                async function () {
                    documents.delete(
                        path
                    );
                }
        };
    }

    return {
        db: {
            collection:
                function (
                    collectionName
                ) {
                    return {
                        doc:
                            function (
                                documentId
                            ) {
                                return createReference(
                                    collectionName,
                                    documentId
                                );
                            }
                    };
                }
        },

        reads:
            reads,

        getDocument:
            function (path) {
                return documents.has(path)
                    ? clone(
                          documents.get(
                              path
                          )
                      )
                    : undefined;
            }
    };
}

function createLoggerStub() {
    const entries = [];

    return {
        entries:
            entries,

        warn:
            function (
                message,
                metadata
            ) {
                entries.push({
                    level:
                        "warn",

                    message:
                        message,

                    metadata:
                        metadata
                });
            }
    };
}

function createRuntime(
    options
) {
    const settings =
        options || {};

    const firestore =
        settings.firestore ||
        createFirestoreStub();

    return {
        db:
            firestore.db,

        now:
            settings.now ||
            function () {
                return 1000;
            },

        logger:
            settings.logger ||
            createLoggerStub()
    };
}

function featurePath(
    key
) {
    return (
        constants
            .FEATURE_FLAG_COLLECTION +
        "/" +
        key
    );
}

/* ==========================================================
   CACHE RESET
========================================================== */

test.beforeEach(
    function () {
        clearFeatureFlagCache();
    }
);

/* ==========================================================
   SERVICE FACTORY
========================================================== */

test(
    "createFeatureFlagService creates a frozen service",
    function () {
        const runtime =
            createRuntime();

        const service =
            createFeatureFlagService({
                runtime:
                    runtime,

                namespace:
                    "storefront",

                defaultValue:
                    true
            });

        assert.equal(
            service.runtime,
            runtime
        );

        assert.equal(
            service.options.namespace,
            "storefront"
        );

        assert.equal(
            service.options.defaultValue,
            true
        );

        assert.equal(
            typeof service.evaluate,
            "function"
        );

        assert.equal(
            typeof service.isEnabled,
            "function"
        );

        assert.equal(
            typeof service.get,
            "function"
        );

        assert.equal(
            typeof service.clearCache,
            "function"
        );

        assert.equal(
            Object.isFrozen(
                service
            ),
            true
        );
    }
);

test(
    "service isEnabled returns boolean evaluation",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    featurePath(
                        "new-checkout"
                    )
                ]: {
                    enabled:
                        true,

                    rolloutPercentage:
                        100
                }
            });

        const service =
            createFeatureFlagService({
                runtime:
                    createRuntime({
                        firestore:
                            firestore
                    }),

                cache:
                    false
            });

        assert.equal(
            await service.isEnabled(
                "new-checkout",
                {
                    userId:
                        "customer-1"
                }
            ),
            true
        );
    }
);

/* ==========================================================
   OPTIONS
========================================================== */

test(
    "normalizeFeatureFlagOptions applies defaults",
    function () {
        const options =
            normalizeFeatureFlagOptions(
                {}
            );

        assert.equal(
            options.collection,
            constants
                .FEATURE_FLAG_COLLECTION
        );

        assert.equal(
            options.namespace,
            "default"
        );

        assert.equal(
            options.defaultValue,
            false
        );

        assert.equal(
            options.defaultVariant,
            constants.DEFAULT_VARIANT
        );

        assert.equal(
            options.cache,
            true
        );

        assert.equal(
            options.cacheTtlMs,
            constants
                .DEFAULT_CACHE_TTL_MS
        );

        assert.equal(
            options.maxCacheEntries,
            constants
                .DEFAULT_MAX_CACHE_ENTRIES
        );

        assert.equal(
            options.disabled,
            false
        );

        assert.equal(
            options.throwOnError,
            false
        );

        assert.equal(
            options.log,
            true
        );
    }
);

test(
    "normalizeFeatureFlagOptions respects overrides",
    function () {
        const resolver =
            function () {
                return "identity";
            };

        const options =
            normalizeFeatureFlagOptions({
                collection:
                    "featureFlags",

                namespace:
                    "checkout",

                defaultValue:
                    true,

                defaultVariant:
                    "control",

                cache:
                    false,

                cacheTtlMs:
                    1000,

                maxCacheEntries:
                    10,

                disabled:
                    true,

                throwOnError:
                    true,

                identityResolver:
                    resolver,

                log:
                    false
            });

        assert.equal(
            options.collection,
            "featureFlags"
        );

        assert.equal(
            options.namespace,
            "checkout"
        );

        assert.equal(
            options.defaultValue,
            true
        );

        assert.equal(
            options.defaultVariant,
            "control"
        );

        assert.equal(
            options.cache,
            false
        );

        assert.equal(
            options.cacheTtlMs,
            1000
        );

        assert.equal(
            options.maxCacheEntries,
            10
        );

        assert.equal(
            options.disabled,
            true
        );

        assert.equal(
            options.throwOnError,
            true
        );

        assert.equal(
            options.identityResolver,
            resolver
        );

        assert.equal(
            options.log,
            false
        );
    }
);

test(
    "normalizeCollection validates Firestore collection names",
    function () {
        assert.equal(
            normalizeCollection(
                "_featureFlags"
            ),
            "_featureFlags"
        );

        assert.throws(
            function () {
                normalizeCollection(
                    ""
                );
            },
            /Firestore collection name/
        );

        assert.throws(
            function () {
                normalizeCollection(
                    "internal/flags"
                );
            },
            /Firestore collection name/
        );
    }
);

test(
    "normalizePositiveInteger validates values",
    function () {
        assert.equal(
            normalizePositiveInteger(
                "5",
                1,
                "Value"
            ),
            5
        );

        assert.equal(
            normalizePositiveInteger(
                undefined,
                10,
                "Value"
            ),
            10
        );

        assert.throws(
            function () {
                normalizePositiveInteger(
                    0,
                    1,
                    "Value"
                );
            },
            /positive integer/
        );
    }
);

/* ==========================================================
   KEY NORMALIZATION
========================================================== */

test(
    "normalizeFeatureFlagKey sanitizes values",
    function () {
        assert.equal(
            normalizeFeatureFlagKey(
                " New Checkout "
            ),
            "new-checkout"
        );

        assert.equal(
            normalizeFeatureFlagKey(
                "catalog.search_v2"
            ),
            "catalog.search_v2"
        );
    }
);

test(
    "normalizeFeatureFlagKey rejects invalid values",
    function () {
        assert.throws(
            function () {
                normalizeFeatureFlagKey(
                    ""
                );
            },
            function (error) {
                assert.equal(
                    error instanceof
                        ServiceError,
                    true
                );

                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

test(
    "normalizeNamespace sanitizes values",
    function () {
        assert.equal(
            normalizeNamespace(
                " Store Front "
            ),
            "store-front"
        );

        assert.equal(
            normalizeNamespace(
                ""
            ),
            "default"
        );
    }
);

test(
    "normalizeRolloutPercentage applies defaults and clamps",
    function () {
        assert.equal(
            normalizeRolloutPercentage(
                undefined
            ),
            100
        );

        assert.equal(
            normalizeRolloutPercentage(
                50
            ),
            50
        );

        assert.equal(
            normalizeRolloutPercentage(
                -10
            ),
            0
        );

        assert.equal(
            normalizeRolloutPercentage(
                150
            ),
            100
        );

        assert.throws(
            function () {
                normalizeRolloutPercentage(
                    "invalid"
                );
            },
            /must be a number/
        );
    }
);

test(
    "variant and optional string normalizers apply defaults",
    function () {
        assert.equal(
            normalizeVariant(
                " treatment "
            ),
            "treatment"
        );

        assert.equal(
            normalizeVariant(
                ""
            ),
            "default"
        );

        assert.equal(
            normalizeOptionalString(
                " value "
            ),
            "value"
        );

        assert.equal(
            normalizeOptionalString(
                ""
            ),
            null
        );
    }
);

/* ==========================================================
   CONTEXT NORMALIZATION
========================================================== */

test(
    "normalizeEvaluationContext extracts callable identity",
    function () {
        const context =
            normalizeEvaluationContext({
                auth: {
                    uid:
                        "customer-1",

                    token: {
                        email:
                            "customer@example.com",

                        role:
                            "customer"
                    }
                },

                rawRequest: {
                    ip:
                        "127.0.0.1",

                    headers: {
                        "x-country":
                            "NG"
                    }
                }
            });

        assert.equal(
            context.userId,
            "customer-1"
        );

        assert.equal(
            context.email,
            "customer@example.com"
        );

        assert.equal(
            context.role,
            "customer"
        );

        assert.equal(
            context.ip,
            "127.0.0.1"
        );

        assert.equal(
            context.country,
            "NG"
        );
    }
);

test(
    "normalizeEvaluationContext preserves custom attributes",
    function () {
        const context =
            normalizeEvaluationContext({
                userId:
                    "customer-1",

                plan:
                    "premium",

                profile: {
                    age:
                        30
                }
            });

        assert.equal(
            context.plan,
            "premium"
        );

        assert.equal(
            context.profile.age,
            30
        );
    }
);

test(
    "getNestedValue reads nested attributes safely",
    function () {
        assert.equal(
            getNestedValue(
                {
                    profile: {
                        country:
                            "NG"
                    }
                },
                "profile.country"
            ),
            "NG"
        );

        assert.equal(
            getNestedValue(
                {},
                "profile.country"
            ),
            undefined
        );
    }
);

/* ==========================================================
   VALUE COMPARISON
========================================================== */

test(
    "valuesEqual compares numbers and strings",
    function () {
        assert.equal(
            valuesEqual(
                10,
                "10"
            ),
            true
        );

        assert.equal(
            valuesEqual(
                "premium",
                "premium"
            ),
            true
        );

        assert.equal(
            valuesEqual(
                "premium",
                "basic"
            ),
            false
        );
    }
);

test(
    "valuesEqual compares booleans",
    function () {
        assert.equal(
            valuesEqual(
                true,
                1
            ),
            true
        );

        assert.equal(
            valuesEqual(
                false,
                ""
            ),
            true
        );
    }
);

/* ==========================================================
   CONDITION EVALUATION
========================================================== */

test(
    "evaluateCondition supports equality operators",
    function () {
        const context = {
            role:
                "admin"
        };

        assert.equal(
            evaluateCondition(
                {
                    attribute:
                        "role",

                    operator:
                        "equals",

                    value:
                        "admin"
                },
                context
            ),
            true
        );

        assert.equal(
            evaluateCondition(
                {
                    attribute:
                        "role",

                    operator:
                        "not-equals",

                    value:
                        "customer"
                },
                context
            ),
            true
        );
    }
);

test(
    "evaluateCondition supports membership operators",
    function () {
        const context = {
            country:
                "NG"
        };

        assert.equal(
            evaluateCondition(
                {
                    attribute:
                        "country",

                    operator:
                        "in",

                    value: [
                        "NG",
                        "GH"
                    ]
                },
                context
            ),
            true
        );

        assert.equal(
            evaluateCondition(
                {
                    attribute:
                        "country",

                    operator:
                        "not-in",

                    value: [
                        "US",
                        "GB"
                    ]
                },
                context
            ),
            true
        );
    }
);

test(
    "evaluateCondition supports contains operations",
    function () {
        assert.equal(
            evaluateCondition(
                {
                    attribute:
                        "tags",

                    operator:
                        "contains",

                    value:
                        "vip"
                },
                {
                    tags: [
                        "vip",
                        "premium"
                    ]
                }
            ),
            true
        );

        assert.equal(
            evaluateCondition(
                {
                    attribute:
                        "email",

                    operator:
                        "contains",

                    value:
                        "@example.com"
                },
                {
                    email:
                        "customer@example.com"
                }
            ),
            true
        );
    }
);

test(
    "evaluateCondition supports string prefix and suffix",
    function () {
        const context = {
            email:
                "admin@leternel.com"
        };

        assert.equal(
            evaluateCondition(
                {
                    attribute:
                        "email",

                    operator:
                        "starts-with",

                    value:
                        "admin"
                },
                context
            ),
            true
        );

        assert.equal(
            evaluateCondition(
                {
                    attribute:
                        "email",

                    operator:
                        "ends-with",

                    value:
                        "@leternel.com"
                },
                context
            ),
            true
        );
    }
);

test(
    "evaluateCondition supports numeric comparisons",
    function () {
        const context = {
            orderCount:
                10
        };

        assert.equal(
            evaluateCondition(
                {
                    attribute:
                        "orderCount",

                    operator:
                        "greater-than",

                    value:
                        5
                },
                context
            ),
            true
        );

        assert.equal(
            evaluateCondition(
                {
                    attribute:
                        "orderCount",

                    operator:
                        "greater-than-or-equal",

                    value:
                        10
                },
                context
            ),
            true
        );

        assert.equal(
            evaluateCondition(
                {
                    attribute:
                        "orderCount",

                    operator:
                        "less-than",

                    value:
                        20
                },
                context
            ),
            true
        );

        assert.equal(
            evaluateCondition(
                {
                    attribute:
                        "orderCount",

                    operator:
                        "less-than-or-equal",

                    value:
                        10
                },
                context
            ),
            true
        );
    }
);

test(
    "evaluateCondition supports existence checks",
    function () {
        const context = {
            plan:
                "premium"
        };

        assert.equal(
            evaluateCondition(
                {
                    attribute:
                        "plan",

                    operator:
                        "exists"
                },
                context
            ),
            true
        );

        assert.equal(
            evaluateCondition(
                {
                    attribute:
                        "missing",

                    operator:
                        "not-exists"
                },
                context
            ),
            true
        );
    }
);

test(
    "evaluateCondition returns false for invalid conditions",
    function () {
        assert.equal(
            evaluateCondition(
                null,
                {}
            ),
            false
        );

        assert.equal(
            evaluateCondition(
                {},
                {}
            ),
            false
        );

        assert.equal(
            evaluateCondition(
                {
                    attribute:
                        "role",

                    operator:
                        "unsupported",

                    value:
                        "admin"
                },
                {
                    role:
                        "admin"
                }
            ),
            false
        );
    }
);

/* ==========================================================
   TARGETING RULES
========================================================== */

test(
    "evaluateTargetingRule supports all conditions",
    function () {
        const result =
            evaluateTargetingRule(
                {
                    operator:
                        "all",

                    conditions: [
                        {
                            attribute:
                                "role",

                            value:
                                "admin"
                        },
                        {
                            attribute:
                                "country",

                            value:
                                "NG"
                        }
                    ]
                },
                {
                    role:
                        "admin",

                    country:
                        "NG"
                }
            );

        assert.equal(
            result,
            true
        );
    }
);

test(
    "evaluateTargetingRule supports any conditions",
    function () {
        const result =
            evaluateTargetingRule(
                {
                    operator:
                        "any",

                    conditions: [
                        {
                            attribute:
                                "role",

                            value:
                                "admin"
                        },
                        {
                            attribute:
                                "country",

                            value:
                                "NG"
                        }
                    ]
                },
                {
                    role:
                        "customer",

                    country:
                        "NG"
                }
            );

        assert.equal(
            result,
            true
        );
    }
);

test(
    "evaluateTargetingRule rejects empty conditions",
    function () {
        assert.equal(
            evaluateTargetingRule(
                {
                    conditions:
                        []
                },
                {}
            ),
            false
        );
    }
);

test(
    "evaluateTargetingRules returns first matching rule",
    function () {
        const result =
            evaluateTargetingRules(
                {
                    enabledVariant:
                        "enabled",

                    disabledVariant:
                        "disabled",

                    rules: [
                        {
                            id:
                                "admin-rule",

                            enabled:
                                true,

                            variant:
                                "admin",

                            conditions: [
                                {
                                    attribute:
                                        "role",

                                    value:
                                        "admin"
                                }
                            ]
                        },
                        {
                            id:
                                "country-rule",

                            enabled:
                                true,

                            variant:
                                "nigeria",

                            conditions: [
                                {
                                    attribute:
                                        "country",

                                    value:
                                        "NG"
                                }
                            ]
                        }
                    ]
                },
                {
                    role:
                        "admin",

                    country:
                        "NG"
                }
            );

        assert.deepEqual(
            result,
            {
                matched:
                    true,

                enabled:
                    true,

                variant:
                    "admin",

                reason:
                    "targeting-rule",

                ruleId:
                    "admin-rule"
            }
        );
    }
);

test(
    "evaluateTargetingRules returns unmatched result",
    function () {
        assert.deepEqual(
            evaluateTargetingRules(
                {
                    rules: [
                        {
                            conditions: [
                                {
                                    attribute:
                                        "role",

                                    value:
                                        "admin"
                                }
                            ]
                        }
                    ]
                },
                {
                    role:
                        "customer"
                }
            ),
            {
                matched:
                    false
            }
        );
    }
);

/* ==========================================================
   ROLLOUT
========================================================== */

test(
    "calculateRolloutBucket is deterministic",
    function () {
        const first =
            calculateRolloutBucket(
                "new-checkout",
                "customer-1"
            );

        const second =
            calculateRolloutBucket(
                "new-checkout",
                "customer-1"
            );

        assert.equal(
            first,
            second
        );

        assert.ok(
            first >= 0
        );

        assert.ok(
            first < 100
        );
    }
);

test(
    "resolveRolloutIdentity follows default precedence",
    function () {
        assert.equal(
            resolveRolloutIdentity(
                {
                    userId:
                        "customer-1",

                    sessionId:
                        "session-1"
                },
                {}
            ),
            "customer-1"
        );

        assert.equal(
            resolveRolloutIdentity(
                {
                    sessionId:
                        "session-1"
                },
                {}
            ),
            "session-1"
        );
    }
);

test(
    "resolveRolloutIdentity supports custom resolver",
    function () {
        assert.equal(
            resolveRolloutIdentity(
                {
                    userId:
                        "customer-1"
                },
                {
                    identityResolver:
                        function () {
                            return "custom-identity";
                        }
                }
            ),
            "custom-identity"
        );
    }
);

test(
    "evaluatePercentageRollout handles zero and full rollout",
    function () {
        const disabled =
            evaluatePercentageRollout(
                {
                    key:
                        "feature",

                    rolloutPercentage:
                        0,

                    enabledVariant:
                        "enabled",

                    disabledVariant:
                        "disabled"
                },
                {
                    userId:
                        "customer-1"
                },
                {}
            );

        const enabled =
            evaluatePercentageRollout(
                {
                    key:
                        "feature",

                    rolloutPercentage:
                        100,

                    enabledVariant:
                        "enabled",

                    disabledVariant:
                        "disabled"
                },
                {
                    userId:
                        "customer-1"
                },
                {}
            );

        assert.equal(
            disabled.enabled,
            false
        );

        assert.equal(
            disabled.reason,
            "rollout-excluded"
        );

        assert.equal(
            enabled.enabled,
            true
        );

        assert.equal(
            enabled.reason,
            "rollout-full"
        );
    }
);

test(
    "evaluatePercentageRollout uses default when identity is missing",
    function () {
        const result =
            evaluatePercentageRollout(
                {
                    key:
                        "feature",

                    rolloutPercentage:
                        50,

                    enabledVariant:
                        "enabled",

                    disabledVariant:
                        "disabled"
                },
                {},
                {
                    defaultValue:
                        true
                }
            );

        assert.equal(
            result.enabled,
            true
        );

        assert.equal(
            result.reason,
            "rollout-identity-missing"
        );

        assert.equal(
            result.source,
            "default"
        );
    }
);

test(
    "evaluatePercentageRollout uses deterministic bucket",
    function () {
        const flag = {
            key:
                "new-checkout",

            rolloutPercentage:
                50,

            enabledVariant:
                "treatment",

            disabledVariant:
                "control"
        };

        const context = {
            userId:
                "customer-1"
        };

        const result =
            evaluatePercentageRollout(
                flag,
                context,
                {}
            );

        const bucket =
            calculateRolloutBucket(
                "new-checkout",
                "customer-1"
            );

        assert.equal(
            result.bucket,
            bucket
        );

        assert.equal(
            result.enabled,
            bucket < 50
        );
    }
);

/* ==========================================================
   RECORD NORMALIZATION
========================================================== */

test(
    "normalizeFeatureFlagRecord applies defaults",
    function () {
        const result =
            normalizeFeatureFlagRecord({
                key:
                    "new-checkout"
            });

        assert.equal(
            result.key,
            "new-checkout"
        );

        assert.equal(
            result.enabled,
            true
        );

        assert.equal(
            result.archived,
            false
        );

        assert.equal(
            result.rolloutPercentage,
            100
        );

        assert.equal(
            result.enabledVariant,
            "default"
        );

        assert.equal(
            result.disabledVariant,
            "disabled"
        );

        assert.deepEqual(
            result.rules,
            []
        );
    }
);

test(
    "normalizeFeatureFlagRecord serializes timestamps",
    function () {
        const result =
            normalizeFeatureFlagRecord({
                key:
                    "new-checkout",

                createdAt:
                    TestTimestamp
                        .fromMillis(
                            1000
                        ),

                updatedAt:
                    TestTimestamp
                        .fromMillis(
                            2000
                        )
            });

        assert.equal(
            result.createdAt,
            new Date(
                1000
            ).toISOString()
        );

        assert.equal(
            result.updatedAt,
            new Date(
                2000
            ).toISOString()
        );
    }
);

test(
    "normalizeTargetingRules sanitizes rules",
    function () {
        const result =
            normalizeTargetingRules([
                {
                    id:
                        " premium-rule ",

                    enabled:
                        true,

                    variant:
                        "premium",

                    operator:
                        "ANY",

                    conditions: [
                        {
                            field:
                                "plan",

                            operator:
                                "equals",

                            value:
                                "premium"
                        }
                    ]
                },

                null
            ]);

        assert.deepEqual(
            result,
            [
                {
                    id:
                        "premium-rule",

                    enabled:
                        true,

                    variant:
                        "premium",

                    operator:
                        "any",

                    conditions: [
                        {
                            attribute:
                                "plan",

                            operator:
                                "equals",

                            value:
                                "premium"
                        }
                    ]
                }
            ]
        );
    }
);

/* ==========================================================
   RECORD EVALUATION
========================================================== */

test(
    "evaluateFeatureFlagRecord disables archived flags",
    function () {
        const result =
            evaluateFeatureFlagRecord(
                {
                    key:
                        "new-checkout",

                    enabled:
                        true,

                    archived:
                        true
                },
                {},
                {}
            );

        assert.equal(
            result.enabled,
            false
        );

        assert.equal(
            result.reason,
            "flag-archived"
        );
    }
);

test(
    "evaluateFeatureFlagRecord disables inactive flags",
    function () {
        const result =
            evaluateFeatureFlagRecord(
                {
                    key:
                        "new-checkout",

                    enabled:
                        false
                },
                {},
                {}
            );

        assert.equal(
            result.enabled,
            false
        );

        assert.equal(
            result.reason,
            "flag-disabled"
        );
    }
);

test(
    "evaluateFeatureFlagRecord applies targeting rule",
    function () {
        const result =
            evaluateFeatureFlagRecord(
                {
                    key:
                        "admin-dashboard",

                    enabled:
                        true,

                    rolloutPercentage:
                        0,

                    rules: [
                        {
                            id:
                                "admins",

                            enabled:
                                true,

                            variant:
                                "admin",

                            conditions: [
                                {
                                    attribute:
                                        "role",

                                    value:
                                        "admin"
                                }
                            ]
                        }
                    ]
                },
                {
                    role:
                        "admin"
                },
                {}
            );

        assert.equal(
            result.enabled,
            true
        );

        assert.equal(
            result.reason,
            "targeting-rule"
        );

        assert.equal(
            result.ruleId,
            "admins"
        );

        assert.equal(
            result.variant,
            "admin"
        );
    }
);

test(
    "evaluateFeatureFlagRecord falls back to rollout",
    function () {
        const result =
            evaluateFeatureFlagRecord(
                {
                    key:
                        "new-checkout",

                    enabled:
                        true,

                    rolloutPercentage:
                        100,

                    enabledVariant:
                        "new",

                    disabledVariant:
                        "old",

                    rules:
                        []
                },
                {
                    userId:
                        "customer-1"
                },
                {}
            );

        assert.equal(
            result.enabled,
            true
        );

        assert.equal(
            result.reason,
            "rollout-full"
        );

        assert.equal(
            result.variant,
            "new"
        );
    }
);

/* ==========================================================
   RESULT CREATION
========================================================== */

test(
    "createFeatureFlagResult normalizes output",
    function () {
        const result =
            createFeatureFlagResult(
                " New Checkout ",
                {
                    enabled:
                        true,

                    variant:
                        "treatment",

                    reason:
                        "targeting-rule",

                    source:
                        "targeting",

                    ruleId:
                        "rule-1",

                    bucket:
                        12.5
                }
            );

        assert.deepEqual(
            result,
            {
                key:
                    "new-checkout",

                enabled:
                    true,

                status:
                    "enabled",

                reason:
                    "targeting-rule",

                variant:
                    "treatment",

                source:
                    "targeting",

                ruleId:
                    "rule-1",

                bucket:
                    12.5,

                error:
                    null,

                flag:
                    null
            }
        );
    }
);

/* ==========================================================
   FIRESTORE READ
========================================================== */

test(
    "getFeatureFlag reads and normalizes Firestore record",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    featurePath(
                        "new-checkout"
                    )
                ]: {
                    enabled:
                        true,

                    rolloutPercentage:
                        50,

                    enabledVariant:
                        "new",

                    disabledVariant:
                        "old",

                    updatedAt:
                        TestTimestamp
                            .fromMillis(
                                1000
                            )
                }
            });

        const result =
            await getFeatureFlag(
                createRuntime({
                    firestore:
                        firestore
                }),
                "new-checkout",
                {
                    cache:
                        false
                }
            );

        assert.equal(
            result.key,
            "new-checkout"
        );

        assert.equal(
            result.enabled,
            true
        );

        assert.equal(
            result.rolloutPercentage,
            50
        );

        assert.equal(
            result.enabledVariant,
            "new"
        );

        assert.equal(
            result.updatedAt,
            new Date(
                1000
            ).toISOString()
        );
    }
);

test(
    "getFeatureFlag returns null for missing flag",
    async function () {
        const result =
            await getFeatureFlag(
                createRuntime(),
                "missing-flag",
                {
                    cache:
                        false
                }
            );

        assert.equal(
            result,
            null
        );
    }
);

test(
    "getFeatureFlag returns null when service is disabled",
    async function () {
        assert.equal(
            await getFeatureFlag(
                null,
                "feature",
                {
                    disabled:
                        true
                }
            ),
            null
        );
    }
);

/* ==========================================================
   CACHE
========================================================== */

test(
    "createCacheKey combines namespace and flag key",
    function () {
        assert.equal(
            createCacheKey(
                " Store Front ",
                " New Checkout "
            ),
            "store-front:new-checkout"
        );
    }
);

test(
    "writeFeatureFlagCache and readFeatureFlagCache store values",
    function () {
        writeFeatureFlagCache(
            "default:feature",
            {
                enabled:
                    true
            },
            2000,
            10
        );

        assert.deepEqual(
            readFeatureFlagCache(
                "default:feature",
                1000
            ),
            {
                hit:
                    true,

                value: {
                    enabled:
                        true
                }
            }
        );
    }
);

test(
    "readFeatureFlagCache expires stale entries",
    function () {
        writeFeatureFlagCache(
            "default:feature",
            {
                enabled:
                    true
            },
            1000,
            10
        );

        assert.deepEqual(
            readFeatureFlagCache(
                "default:feature",
                1000
            ),
            {
                hit:
                    false,

                value:
                    null
            }
        );
    }
);

test(
    "writeFeatureFlagCache evicts oldest entry",
    function () {
        writeFeatureFlagCache(
            "default:first",
            {
                key:
                    "first"
            },
            5000,
            1
        );

        writeFeatureFlagCache(
            "default:second",
            {
                key:
                    "second"
            },
            5000,
            1
        );

        assert.equal(
            readFeatureFlagCache(
                "default:first",
                1000
            ).hit,
            false
        );

        assert.equal(
            readFeatureFlagCache(
                "default:second",
                1000
            ).hit,
            true
        );
    }
);

test(
    "clearFeatureFlagCache clears one or all entries",
    function () {
        writeFeatureFlagCache(
            "storefront:first",
            {},
            5000,
            10
        );

        writeFeatureFlagCache(
            "storefront:second",
            {},
            5000,
            10
        );

        assert.equal(
            clearFeatureFlagCache(
                "first",
                "storefront"
            ),
            1
        );

        assert.equal(
            readFeatureFlagCache(
                "storefront:first",
                1000
            ).hit,
            false
        );

        assert.equal(
            clearFeatureFlagCache(),
            1
        );
    }
);

test(
    "getFeatureFlag reuses cached Firestore result",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    featurePath(
                        "new-checkout"
                    )
                ]: {
                    enabled:
                        true
                }
            });

        const runtime =
            createRuntime({
                firestore:
                    firestore
            });

        const options = {
            cache:
                true,

            cacheTtlMs:
                5000,

            now:
                function () {
                    return 1000;
                }
        };

        await getFeatureFlag(
            runtime,
            "new-checkout",
            options
        );

        await getFeatureFlag(
            runtime,
            "new-checkout",
            options
        );

        assert.equal(
            firestore.reads.length,
            1
        );
    }
);

/* ==========================================================
   FULL EVALUATION
========================================================== */

test(
    "evaluateFeatureFlag returns default when disabled",
    async function () {
        const result =
            await evaluateFeatureFlag(
                null,
                "new-checkout",
                {},
                {
                    disabled:
                        true,

                    defaultValue:
                        true,

                    defaultVariant:
                        "fallback"
                }
            );

        assert.equal(
            result.enabled,
            true
        );

        assert.equal(
            result.reason,
            "service-disabled"
        );

        assert.equal(
            result.variant,
            "fallback"
        );

        assert.equal(
            result.source,
            "default"
        );
    }
);

test(
    "evaluateFeatureFlag returns missing fallback",
    async function () {
        const result =
            await evaluateFeatureFlag(
                createRuntime(),
                "missing-feature",
                {},
                {
                    cache:
                        false,

                    defaultValue:
                        true,

                    defaultVariant:
                        "fallback"
                }
            );

        assert.equal(
            result.enabled,
            true
        );

        assert.equal(
            result.status,
            "missing"
        );

        assert.equal(
            result.reason,
            "flag-missing"
        );
    }
);

test(
    "evaluateFeatureFlag evaluates stored flag",
    async function () {
        const firestore =
            createFirestoreStub({
                [
                    featurePath(
                        "premium-shipping"
                    )
                ]: {
                    enabled:
                        true,

                    rolloutPercentage:
                        0,

                    rules: [
                        {
                            id:
                                "premium-customers",

                            enabled:
                                true,

                            variant:
                                "express",

                            conditions: [
                                {
                                    attribute:
                                        "plan",

                                    value:
                                        "premium"
                                }
                            ]
                        }
                    ]
                }
            });

        const result =
            await evaluateFeatureFlag(
                createRuntime({
                    firestore:
                        firestore
                }),
                "premium-shipping",
                {
                    userId:
                        "customer-1",

                    plan:
                        "premium"
                },
                {
                    cache:
                        false
                }
            );

        assert.equal(
            result.enabled,
            true
        );

        assert.equal(
            result.variant,
            "express"
        );

        assert.equal(
            result.ruleId,
            "premium-customers"
        );
    }
);

test(
    "evaluateFeatureFlag returns safe default on datastore error",
    async function () {
        const logger =
            createLoggerStub();

        const runtime = {
            db: {
                collection:
                    function () {
                        return {
                            doc:
                                function () {
                                    return {
                                        get:
                                            async function () {
                                                const error =
                                                    new Error(
                                                        "Firestore unavailable."
                                                    );

                                                error.code =
                                                    "firestore/unavailable";

                                                throw error;
                                            }
                                    };
                                }
                        };
                    }
            },

            logger:
                logger,

            now:
                function () {
                    return 1000;
                }
        };

        const result =
            await evaluateFeatureFlag(
                runtime,
                "new-checkout",
                {},
                {
                    cache:
                        false,

                    defaultValue:
                        false
                }
            );

        assert.equal(
            result.enabled,
            false
        );

        assert.equal(
            result.status,
            "error"
        );

        assert.equal(
            result.reason,
            "evaluation-error"
        );

        assert.equal(
            result.error.code,
            "firestore/unavailable"
        );

        assert.equal(
            logger.entries.length,
            1
        );
    }
);

test(
    "evaluateFeatureFlag rethrows when configured",
    async function () {
        const expected =
            new Error(
                "Firestore unavailable."
            );

        const runtime = {
            db: {
                collection:
                    function () {
                        return {
                            doc:
                                function () {
                                    return {
                                        get:
                                            async function () {
                                                throw expected;
                                            }
                                    };
                                }
                        };
                    }
            }
        };

        await assert.rejects(
            async function () {
                await evaluateFeatureFlag(
                    runtime,
                    "new-checkout",
                    {},
                    {
                        cache:
                            false,

                        throwOnError:
                            true
                    }
                );
            },
            expected
        );
    }
);

/* ==========================================================
   RUNTIME
========================================================== */

test(
    "assertFeatureFlagRuntime validates datastore",
    function () {
        assert.doesNotThrow(
            function () {
                assertFeatureFlagRuntime(
                    createRuntime()
                );
            }
        );

        assert.throws(
            function () {
                assertFeatureFlagRuntime(
                    null
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "configuration-error"
                );

                return true;
            }
        );
    }
);

test(
    "resolveNow prefers option clock",
    function () {
        assert.equal(
            resolveNow(
                {
                    now:
                        function () {
                            return 1000;
                        }
                },
                {
                    now:
                        function () {
                            return 2000;
                        }
                }
            ),
            2000
        );
    }
);

test(
    "resolveNow falls back to runtime clock",
    function () {
        assert.equal(
            resolveNow(
                {
                    now:
                        function () {
                            return 1000;
                        }
                },
                {}
            ),
            1000
        );
    }
);

/* ==========================================================
   TIME HELPERS
========================================================== */

test(
    "toMilliseconds supports common timestamp forms",
    function () {
        assert.equal(
            toMilliseconds(
                new Date(
                    1000
                )
            ),
            1000
        );

        assert.equal(
            toMilliseconds(
                TestTimestamp
                    .fromMillis(
                        2000
                    )
            ),
            2000
        );

        assert.equal(
            toMilliseconds(
                "1970-01-01T00:00:03.000Z"
            ),
            3000
        );

        assert.equal(
            toMilliseconds(
                4000
            ),
            4000
        );

        assert.equal(
            toMilliseconds(
                null
            ),
            0
        );
    }
);

test(
    "serializeTimestamp returns ISO values",
    function () {
        assert.equal(
            serializeTimestamp(
                TestTimestamp
                    .fromMillis(
                        1000
                    )
            ),
            new Date(
                1000
            ).toISOString()
        );

        assert.equal(
            serializeTimestamp(
                null
            ),
            null
        );
    }
);

/* ==========================================================
   LOGGING AND ERRORS
========================================================== */

test(
    "serializeFeatureFlagError returns safe metadata",
    function () {
        const error =
            new ServiceError(
                "configuration-error",
                "Datastore unavailable.",
                {
                    status:
                        500
                }
            );

        assert.deepEqual(
            serializeFeatureFlagError(
                error
            ),
            {
                name:
                    "ServiceError",

                code:
                    "configuration-error",

                message:
                    "Datastore unavailable."
            }
        );
    }
);

test(
    "logFeatureFlagError writes warning",
    function () {
        const logger =
            createLoggerStub();

        logFeatureFlagError(
            {
                logger:
                    logger
            },
            "new-checkout",
            {
                code:
                    "firestore/unavailable",

                message:
                    "Firestore unavailable."
            },
            {
                log:
                    true
            }
        );

        assert.equal(
            logger.entries.length,
            1
        );

        assert.equal(
            logger.entries[0].message,
            "Feature flag evaluation failed."
        );

        assert.equal(
            logger.entries[0]
                .metadata
                .key,
            "new-checkout"
        );
    }
);

test(
    "logFeatureFlagError can be disabled",
    function () {
        const logger =
            createLoggerStub();

        logFeatureFlagError(
            {
                logger:
                    logger
            },
            "feature",
            new Error(
                "Failure."
            ),
            {
                log:
                    false
            }
        );

        assert.equal(
            logger.entries.length,
            0
        );
    }
);

/* ==========================================================
   CONSTANTS
========================================================== */

test(
    "feature flag constants expose expected defaults",
    function () {
        assert.equal(
            constants
                .FEATURE_FLAG_COLLECTION,
            "_featureFlags"
        );

        assert.equal(
            constants
                .DEFAULT_CACHE_TTL_MS,
            30000
        );

        assert.equal(
            constants
                .DEFAULT_ROLLOUT_PERCENTAGE,
            100
        );

        assert.equal(
            constants.DEFAULT_VARIANT,
            "default"
        );

        assert.equal(
            constants
                .DEFAULT_MAX_CACHE_ENTRIES,
            1000
        );

        assert.deepEqual(
            constants
                .FEATURE_FLAG_STATUSES,
            {
                enabled:
                    "enabled",

                disabled:
                    "disabled",

                missing:
                    "missing",

                error:
                    "error"
            }
        );
    }
);