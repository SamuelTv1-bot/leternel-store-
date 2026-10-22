"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   CONFIGURATION TEST SUITE
========================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    loadConfiguration,
    getConfiguration,
    resetConfigurationCache,
    validateConfiguration,
    sanitizeConfiguration,
    normalizeOrigin,
    normalizeUrl,
    normalizeEmail,
    normalizeCurrency,
    normalizeLocale,
    normalizePrefix,
    readString,
    readRequiredString,
    readNumber,
    readBoolean,
    readList,
    readEnum,
    createConfigurationError,
    deepFreeze,
    DEFAULTS
} = require(
    "../src/shared/configuration"
);

/* ==========================================================
   TEST ENVIRONMENT
========================================================== */

function createValidEnvironment(
    overrides
) {
    return Object.assign(
        {
            NODE_ENV:
                "test",

            FIREBASE_PROJECT_ID:
                "leternel-store-test",

            FUNCTIONS_REGION:
                "europe-west1",

            APP_ORIGIN:
                "https://shop.example.com",

            ALLOWED_ORIGINS:
                "https://shop.example.com,https://admin.example.com",

            STORE_NAME:
                "L'ÉTERNEL",

            DEFAULT_CURRENCY:
                "NGN",

            DEFAULT_LOCALE:
                "en-NG",

            SUPPORT_EMAIL:
                "support@example.com",

            ORDER_EMAIL:
                "orders@example.com",

            FREE_STANDARD_DELIVERY_THRESHOLD:
                "500000",

            STANDARD_DELIVERY_FEE:
                "10000",

            EXPRESS_DELIVERY_FEE:
                "25000",

            TAX_RATE:
                "0",

            PAYMENT_PROVIDER:
                "paystack",

            PAYSTACK_PUBLIC_KEY:
                "pk_test_example",

            PAYSTACK_SECRET_KEY:
                "sk_test_example",

            PAYSTACK_WEBHOOK_SECRET:
                "paystack-webhook-secret",

            PAYSTACK_CALLBACK_URL:
                "https://shop.example.com/payment/callback",

            PAYSTACK_REQUEST_TIMEOUT_MS:
                "15000",

            FLUTTERWAVE_PUBLIC_KEY:
                "FLWPUBK_TEST-example-X",

            FLUTTERWAVE_SECRET_KEY:
                "FLWSECK_TEST-example-X",

            FLUTTERWAVE_ENCRYPTION_KEY:
                "FLWSECK_TEST-example",

            FLUTTERWAVE_WEBHOOK_HASH:
                "flutterwave-webhook-hash",

            FLUTTERWAVE_CALLBACK_URL:
                "https://shop.example.com/payment/callback",

            FLUTTERWAVE_REQUEST_TIMEOUT_MS:
                "15000",

            EMAIL_PROVIDER:
                "resend",

            EMAIL_FROM:
                "orders@example.com",

            EMAIL_FROM_NAME:
                "L'ÉTERNEL",

            EMAIL_REPLY_TO:
                "support@example.com",

            EMAIL_REQUEST_TIMEOUT_MS:
                "15000",

            RESEND_API_KEY:
                "re_test_example",

            SENDGRID_API_KEY:
                "SG.test-example",

            ORDER_NUMBER_PREFIX:
                "LET",

            ORDER_IDEMPOTENCY_WINDOW_MINUTES:
                "60",

            ORDER_PAYMENT_EXPIRY_MINUTES:
                "30",

            MAX_ORDER_ITEMS:
                "25",

            MAX_ITEM_QUANTITY:
                "10",

            ENABLE_ORDER_CONFIRMATION_EMAILS:
                "true",

            ENABLE_PAYMENT_RECEIPT_EMAILS:
                "true",

            ENABLE_ORDER_STATUS_EMAILS:
                "true",

            DEFAULT_USER_ROLE:
                "customer",

            DEFAULT_USER_STATUS:
                "active",

            ANONYMIZED_EMAIL_DOMAIN:
                "deleted.leternel.invalid",

            TRUST_PROXY:
                "false",

            REQUIRE_APP_CHECK:
                "false",

            REQUIRE_VERIFIED_EMAIL_FOR_CHECKOUT:
                "true",

            WEBHOOK_MAX_BODY_BYTES:
                "1048576",

            ADMIN_AUDIT_LOGGING_ENABLED:
                "true",

            LOG_LEVEL:
                "debug",

            LOG_PROVIDER_RESPONSES:
                "false",

            LOG_WEBHOOK_PAYLOADS:
                "false",

            FIRESTORE_EMULATOR_HOST:
                "127.0.0.1:8080",

            FIREBASE_AUTH_EMULATOR_HOST:
                "127.0.0.1:9099",

            FIREBASE_STORAGE_EMULATOR_HOST:
                "127.0.0.1:9199",

            FUNCTIONS_EMULATOR_HOST:
                "127.0.0.1:5001",

            EMULATOR_TEST_TIMEOUT:
                "30000",

            EMULATOR_PAYMENT_PROVIDER_AVAILABLE:
                "false"
        },
        overrides || {}
    );
}

/* ==========================================================
   BASIC ENVIRONMENT READERS
========================================================== */

test(
    "readString returns a trimmed environment value",
    function () {
        const value =
            readString(
                {
                    STORE_NAME:
                        "  L'ÉTERNEL  "
                },
                "STORE_NAME",
                "Fallback"
            );

        assert.equal(
            value,
            "L'ÉTERNEL"
        );
    }
);

test(
    "readString returns fallback for missing and empty values",
    function () {
        assert.equal(
            readString(
                {},
                "STORE_NAME",
                "Fallback"
            ),
            "Fallback"
        );

        assert.equal(
            readString(
                {
                    STORE_NAME:
                        "   "
                },
                "STORE_NAME",
                "Fallback"
            ),
            "Fallback"
        );
    }
);

test(
    "readRequiredString returns a present value",
    function () {
        assert.equal(
            readRequiredString(
                {
                    API_KEY:
                        "secret"
                },
                "API_KEY"
            ),
            "secret"
        );
    }
);

test(
    "readRequiredString rejects missing values",
    function () {
        assert.throws(
            function () {
                readRequiredString(
                    {},
                    "API_KEY"
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "configuration/invalid-value"
                );

                assert.equal(
                    error.variable,
                    "API_KEY"
                );

                return true;
            }
        );
    }
);

test(
    "readNumber parses valid values",
    function () {
        assert.equal(
            readNumber(
                {
                    VALUE:
                        "25"
                },
                "VALUE",
                10
            ),
            25
        );
    }
);

test(
    "readNumber uses fallback for missing values",
    function () {
        assert.equal(
            readNumber(
                {},
                "VALUE",
                10
            ),
            10
        );
    }
);

test(
    "readNumber enforces finite values",
    function () {
        assert.throws(
            function () {
                readNumber(
                    {
                        VALUE:
                            "not-a-number"
                    },
                    "VALUE",
                    0
                );
            },
            /Expected a finite number/
        );
    }
);

test(
    "readNumber enforces integer constraints",
    function () {
        assert.throws(
            function () {
                readNumber(
                    {
                        VALUE:
                            "2.5"
                    },
                    "VALUE",
                    0,
                    {
                        integer:
                            true
                    }
                );
            },
            /Expected an integer/
        );
    }
);

test(
    "readNumber enforces minimum constraints",
    function () {
        assert.throws(
            function () {
                readNumber(
                    {
                        VALUE:
                            "-1"
                    },
                    "VALUE",
                    0,
                    {
                        minimum:
                            0
                    }
                );
            },
            /greater than or equal/
        );
    }
);

test(
    "readNumber enforces maximum constraints",
    function () {
        assert.throws(
            function () {
                readNumber(
                    {
                        VALUE:
                            "11"
                    },
                    "VALUE",
                    0,
                    {
                        maximum:
                            10
                    }
                );
            },
            /less than or equal/
        );
    }
);

test(
    "readBoolean recognizes enabled values",
    function () {
        [
            "true",
            "1",
            "yes",
            "on",
            "TRUE"
        ].forEach(
            function (value) {
                assert.equal(
                    readBoolean(
                        {
                            FLAG:
                                value
                        },
                        "FLAG",
                        false
                    ),
                    true
                );
            }
        );
    }
);

test(
    "readBoolean recognizes disabled values",
    function () {
        [
            "false",
            "0",
            "no",
            "off",
            "FALSE"
        ].forEach(
            function (value) {
                assert.equal(
                    readBoolean(
                        {
                            FLAG:
                                value
                        },
                        "FLAG",
                        true
                    ),
                    false
                );
            }
        );
    }
);

test(
    "readBoolean rejects unknown values",
    function () {
        assert.throws(
            function () {
                readBoolean(
                    {
                        FLAG:
                            "perhaps"
                    },
                    "FLAG",
                    false
                );
            },
            /Expected a boolean value/
        );
    }
);

test(
    "readList parses comma-separated values",
    function () {
        assert.deepEqual(
            readList(
                {
                    ORIGINS:
                        "https://one.example.com, https://two.example.com,,"
                },
                "ORIGINS",
                []
            ),
            [
                "https://one.example.com",
                "https://two.example.com"
            ]
        );
    }
);

test(
    "readList clones fallback values",
    function () {
        const fallback = [
            "first"
        ];

        const result =
            readList(
                {},
                "VALUES",
                fallback
            );

        result.push(
            "second"
        );

        assert.deepEqual(
            fallback,
            [
                "first"
            ]
        );
    }
);

test(
    "readEnum normalizes supported values",
    function () {
        assert.equal(
            readEnum(
                {
                    PROVIDER:
                        " PAYSTACK "
                },
                "PROVIDER",
                new Set([
                    "paystack",
                    "flutterwave"
                ]),
                "flutterwave"
            ),
            "paystack"
        );
    }
);

test(
    "readEnum rejects unsupported values",
    function () {
        assert.throws(
            function () {
                readEnum(
                    {
                        PROVIDER:
                            "unknown"
                    },
                    "PROVIDER",
                    new Set([
                        "paystack",
                        "flutterwave"
                    ]),
                    "paystack"
                );
            },
            /Unsupported value/
        );
    }
);

/* ==========================================================
   NORMALIZERS
========================================================== */

test(
    "normalizeOrigin returns only the URL origin",
    function () {
        assert.equal(
            normalizeOrigin(
                "https://shop.example.com/path?value=1",
                "APP_ORIGIN"
            ),
            "https://shop.example.com"
        );
    }
);

test(
    "normalizeOrigin supports HTTP local origins",
    function () {
        assert.equal(
            normalizeOrigin(
                "http://localhost:5000/shop",
                "APP_ORIGIN"
            ),
            "http://localhost:5000"
        );
    }
);

test(
    "normalizeOrigin rejects invalid URLs",
    function () {
        assert.throws(
            function () {
                normalizeOrigin(
                    "not-a-url",
                    "APP_ORIGIN"
                );
            },
            /valid absolute URL/
        );
    }
);

test(
    "normalizeOrigin rejects unsupported protocols",
    function () {
        assert.throws(
            function () {
                normalizeOrigin(
                    "ftp://example.com",
                    "APP_ORIGIN"
                );
            },
            /Only HTTP and HTTPS/
        );
    }
);

test(
    "normalizeUrl preserves a valid absolute URL",
    function () {
        assert.equal(
            normalizeUrl(
                "https://shop.example.com/callback",
                "CALLBACK_URL"
            ),
            "https://shop.example.com/callback"
        );
    }
);

test(
    "normalizeUrl allows an empty optional value",
    function () {
        assert.equal(
            normalizeUrl(
                "",
                "CALLBACK_URL"
            ),
            ""
        );
    }
);

test(
    "normalizeUrl rejects a missing required URL",
    function () {
        assert.throws(
            function () {
                normalizeUrl(
                    "",
                    "CALLBACK_URL",
                    {
                        required:
                            true
                    }
                );
            },
            /A URL is required/
        );
    }
);

test(
    "normalizeEmail normalizes valid email addresses",
    function () {
        assert.equal(
            normalizeEmail(
                " Support@Example.COM ",
                "SUPPORT_EMAIL"
            ),
            "support@example.com"
        );
    }
);

test(
    "normalizeEmail rejects invalid addresses",
    function () {
        assert.throws(
            function () {
                normalizeEmail(
                    "invalid-email",
                    "SUPPORT_EMAIL"
                );
            },
            /valid email address/
        );
    }
);

test(
    "normalizeCurrency uppercases three-letter codes",
    function () {
        assert.equal(
            normalizeCurrency(
                "ngn",
                "DEFAULT_CURRENCY"
            ),
            "NGN"
        );
    }
);

test(
    "normalizeCurrency rejects malformed codes",
    function () {
        assert.throws(
            function () {
                normalizeCurrency(
                    "NAIRA",
                    "DEFAULT_CURRENCY"
                );
            },
            /three-letter currency code/
        );
    }
);

test(
    "normalizeLocale accepts common locale formats",
    function () {
        assert.equal(
            normalizeLocale(
                "en-NG",
                "DEFAULT_LOCALE"
            ),
            "en-NG"
        );

        assert.equal(
            normalizeLocale(
                "fr",
                "DEFAULT_LOCALE"
            ),
            "fr"
        );
    }
);

test(
    "normalizeLocale rejects malformed values",
    function () {
        assert.throws(
            function () {
                normalizeLocale(
                    "english_Nigeria",
                    "DEFAULT_LOCALE"
                );
            },
            /valid locale/
        );
    }
);

test(
    "normalizePrefix normalizes valid order prefixes",
    function () {
        assert.equal(
            normalizePrefix(
                " let-ng ",
                "ORDER_NUMBER_PREFIX"
            ),
            "LET-NG"
        );
    }
);

test(
    "normalizePrefix rejects invalid prefixes",
    function () {
        assert.throws(
            function () {
                normalizePrefix(
                    "!",
                    "ORDER_NUMBER_PREFIX"
                );
            },
            /2 to 12 uppercase/
        );
    }
);

/* ==========================================================
   CONFIGURATION LOADING
========================================================== */

test(
    "loadConfiguration builds a complete configuration",
    function () {
        const configuration =
            loadConfiguration(
                createValidEnvironment()
            );

        assert.equal(
            configuration.nodeEnvironment,
            "test"
        );

        assert.equal(
            configuration.isTest,
            true
        );

        assert.equal(
            configuration.isProduction,
            false
        );

        assert.equal(
            configuration.projectId,
            "leternel-store-test"
        );

        assert.equal(
            configuration.region,
            "europe-west1"
        );

        assert.equal(
            configuration.appOrigin,
            "https://shop.example.com"
        );

        assert.deepEqual(
            configuration.allowedOrigins,
            [
                "https://shop.example.com",
                "https://admin.example.com"
            ]
        );

        assert.equal(
            configuration.currency,
            "NGN"
        );

        assert.equal(
            configuration.locale,
            "en-NG"
        );
    }
);

test(
    "loadConfiguration loads delivery settings",
    function () {
        const configuration =
            loadConfiguration(
                createValidEnvironment()
            );

        assert.deepEqual(
            configuration.delivery,
            {
                freeStandardDeliveryThreshold:
                    500000,

                standardDeliveryFee:
                    10000,

                expressDeliveryFee:
                    25000,

                taxRate:
                    0
            }
        );

        assert.equal(
            configuration.standardDeliveryFee,
            10000
        );

        assert.equal(
            configuration.expressDeliveryFee,
            25000
        );
    }
);

test(
    "loadConfiguration loads Paystack configuration",
    function () {
        const configuration =
            loadConfiguration(
                createValidEnvironment()
            );

        assert.equal(
            configuration.paymentProvider,
            "paystack"
        );

        assert.equal(
            configuration.payments
                .paystack
                .secretKey,
            "sk_test_example"
        );

        assert.equal(
            configuration.payments
                .paystack
                .webhookSecret,
            "paystack-webhook-secret"
        );

        assert.equal(
            configuration.payments
                .paystack
                .requestTimeoutMs,
            15000
        );
    }
);

test(
    "Paystack webhook secret falls back to its secret key",
    function () {
        const environment =
            createValidEnvironment();

        delete environment
            .PAYSTACK_WEBHOOK_SECRET;

        const configuration =
            loadConfiguration(
                environment
            );

        assert.equal(
            configuration.payments
                .paystack
                .webhookSecret,
            environment
                .PAYSTACK_SECRET_KEY
        );
    }
);

test(
    "loadConfiguration loads Flutterwave configuration",
    function () {
        const configuration =
            loadConfiguration(
                createValidEnvironment({
                    PAYMENT_PROVIDER:
                        "flutterwave"
                })
            );

        assert.equal(
            configuration.paymentProvider,
            "flutterwave"
        );

        assert.equal(
            configuration.payments
                .flutterwave
                .secretKey,
            "FLWSECK_TEST-example-X"
        );

        assert.equal(
            configuration.payments
                .flutterwave
                .webhookHash,
            "flutterwave-webhook-hash"
        );
    }
);

test(
    "loadConfiguration loads email settings",
    function () {
        const configuration =
            loadConfiguration(
                createValidEnvironment()
            );

        assert.equal(
            configuration.emailProvider,
            "resend"
        );

        assert.equal(
            configuration.email.from,
            "orders@example.com"
        );

        assert.equal(
            configuration.email.replyTo,
            "support@example.com"
        );

        assert.equal(
            configuration.email
                .resend
                .apiKey,
            "re_test_example"
        );
    }
);

test(
    "loadConfiguration supports SendGrid",
    function () {
        const configuration =
            loadConfiguration(
                createValidEnvironment({
                    EMAIL_PROVIDER:
                        "sendgrid"
                })
            );

        assert.equal(
            configuration.email.provider,
            "sendgrid"
        );

        assert.equal(
            configuration.email
                .sendgrid
                .apiKey,
            "SG.test-example"
        );
    }
);

test(
    "loadConfiguration loads order settings",
    function () {
        const configuration =
            loadConfiguration(
                createValidEnvironment()
            );

        assert.deepEqual(
            configuration.orders,
            {
                numberPrefix:
                    "LET",

                idempotencyWindowMinutes:
                    60,

                paymentExpiryMinutes:
                    30,

                maximumItems:
                    25,

                maximumItemQuantity:
                    10,

                sendConfirmationEmails:
                    true,

                sendPaymentReceiptEmails:
                    true,

                sendStatusEmails:
                    true
            }
        );
    }
);

test(
    "loadConfiguration loads account and security settings",
    function () {
        const configuration =
            loadConfiguration(
                createValidEnvironment()
            );

        assert.equal(
            configuration.accounts
                .defaultRole,
            "customer"
        );

        assert.equal(
            configuration.accounts
                .defaultStatus,
            "active"
        );

        assert.equal(
            configuration.security
                .requireVerifiedEmailForCheckout,
            true
        );

        assert.equal(
            configuration.security
                .webhookMaximumBodyBytes,
            1048576
        );

        assert.equal(
            configuration.security
                .auditLoggingEnabled,
            true
        );
    }
);

test(
    "loadConfiguration loads logging and emulator settings",
    function () {
        const configuration =
            loadConfiguration(
                createValidEnvironment()
            );

        assert.equal(
            configuration.logging.level,
            "debug"
        );

        assert.equal(
            configuration.logging
                .providerResponses,
            false
        );

        assert.equal(
            configuration.emulators
                .firestoreHost,
            "127.0.0.1:8080"
        );

        assert.equal(
            configuration.tests
                .emulatorTimeout,
            30000
        );
    }
);

test(
    "loadConfiguration removes duplicate allowed origins",
    function () {
        const configuration =
            loadConfiguration(
                createValidEnvironment({
                    ALLOWED_ORIGINS:
                        "https://shop.example.com,https://shop.example.com"
                })
            );

        assert.deepEqual(
            configuration.allowedOrigins,
            [
                "https://shop.example.com"
            ]
        );
    }
);

test(
    "loadConfiguration uses GCLOUD_PROJECT as project fallback",
    function () {
        const environment =
            createValidEnvironment({
                GCLOUD_PROJECT:
                    "fallback-project"
            });

        delete environment
            .FIREBASE_PROJECT_ID;

        const configuration =
            loadConfiguration(
                environment
            );

        assert.equal(
            configuration.projectId,
            "fallback-project"
        );
    }
);

test(
    "loadConfiguration falls back to documented defaults",
    function () {
        const configuration =
            loadConfiguration({});

        assert.equal(
            configuration.nodeEnvironment,
            DEFAULTS.nodeEnvironment
        );

        assert.equal(
            configuration.projectId,
            DEFAULTS.projectId
        );

        assert.equal(
            configuration.region,
            DEFAULTS.region
        );

        assert.equal(
            configuration.currency,
            DEFAULTS.currency
        );

        assert.equal(
            configuration.payments.provider,
            DEFAULTS.paymentProvider
        );

        assert.equal(
            configuration.email.provider,
            DEFAULTS.emailProvider
        );
    }
);

test(
    "loadConfiguration rejects unsupported payment providers",
    function () {
        assert.throws(
            function () {
                loadConfiguration(
                    createValidEnvironment({
                        PAYMENT_PROVIDER:
                            "stripe"
                    })
                );
            },
            /Unsupported value/
        );
    }
);

test(
    "loadConfiguration rejects unsupported email providers",
    function () {
        assert.throws(
            function () {
                loadConfiguration(
                    createValidEnvironment({
                        EMAIL_PROVIDER:
                            "mailgun"
                    })
                );
            },
            /Unsupported value/
        );
    }
);

test(
    "loadConfiguration rejects unsupported logging levels",
    function () {
        assert.throws(
            function () {
                loadConfiguration(
                    createValidEnvironment({
                        LOG_LEVEL:
                            "trace"
                    })
                );
            },
            /Unsupported value/
        );
    }
);

test(
    "loadConfiguration rejects malformed tax rates",
    function () {
        assert.throws(
            function () {
                loadConfiguration(
                    createValidEnvironment({
                        TAX_RATE:
                            "1.5"
                    })
                );
            },
            /less than or equal to 1/
        );
    }
);

test(
    "loadConfiguration rejects excessive order item limits",
    function () {
        assert.throws(
            function () {
                loadConfiguration(
                    createValidEnvironment({
                        MAX_ORDER_ITEMS:
                            "101"
                    })
                );
            },
            /less than or equal to 100/
        );
    }
);

/* ==========================================================
   CONFIGURATION VALIDATION
========================================================== */

test(
    "validateConfiguration accepts complete configuration",
    function () {
        const configuration =
            loadConfiguration(
                createValidEnvironment()
            );

        assert.equal(
            validateConfiguration(
                configuration
            ),
            configuration
        );
    }
);

test(
    "validateConfiguration can skip provider secret checks",
    function () {
        const environment =
            createValidEnvironment();

        delete environment
            .PAYSTACK_SECRET_KEY;

        delete environment
            .PAYSTACK_WEBHOOK_SECRET;

        delete environment
            .RESEND_API_KEY;

        const configuration =
            loadConfiguration(
                environment
            );

        assert.equal(
            validateConfiguration(
                configuration,
                {
                    requireProviderSecrets:
                        false
                }
            ),
            configuration
        );
    }
);

test(
    "validateConfiguration requires Paystack secrets",
    function () {
        const environment =
            createValidEnvironment();

        delete environment
            .PAYSTACK_SECRET_KEY;

        delete environment
            .PAYSTACK_WEBHOOK_SECRET;

        const configuration =
            loadConfiguration(
                environment
            );

        assert.throws(
            function () {
                validateConfiguration(
                    configuration
                );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "configuration/invalid"
                );

                assert.match(
                    error.message,
                    /PAYSTACK_SECRET_KEY/
                );

                assert.match(
                    error.message,
                    /PAYSTACK_WEBHOOK_SECRET/
                );

                return true;
            }
        );
    }
);

test(
    "validateConfiguration requires Flutterwave secrets",
    function () {
        const environment =
            createValidEnvironment({
                PAYMENT_PROVIDER:
                    "flutterwave"
            });

        delete environment
            .FLUTTERWAVE_SECRET_KEY;

        delete environment
            .FLUTTERWAVE_WEBHOOK_HASH;

        const configuration =
            loadConfiguration(
                environment
            );

        assert.throws(
            function () {
                validateConfiguration(
                    configuration
                );
            },
            function (error) {
                assert.match(
                    error.message,
                    /FLUTTERWAVE_SECRET_KEY/
                );

                assert.match(
                    error.message,
                    /FLUTTERWAVE_WEBHOOK_HASH/
                );

                return true;
            }
        );
    }
);

test(
    "validateConfiguration requires Resend API key",
    function () {
        const environment =
            createValidEnvironment();

        delete environment
            .RESEND_API_KEY;

        const configuration =
            loadConfiguration(
                environment
            );

        assert.throws(
            function () {
                validateConfiguration(
                    configuration
                );
            },
            /RESEND_API_KEY/
        );
    }
);

test(
    "validateConfiguration requires SendGrid API key",
    function () {
        const environment =
            createValidEnvironment({
                EMAIL_PROVIDER:
                    "sendgrid"
            });

        delete environment
            .SENDGRID_API_KEY;

        const configuration =
            loadConfiguration(
                environment
            );

        assert.throws(
            function () {
                validateConfiguration(
                    configuration
                );
            },
            /SENDGRID_API_KEY/
        );
    }
);

test(
    "validateConfiguration rejects lower express delivery fees",
    function () {
        const configuration =
            loadConfiguration(
                createValidEnvironment({
                    STANDARD_DELIVERY_FEE:
                        "25000",

                    EXPRESS_DELIVERY_FEE:
                        "10000"
                })
            );

        assert.throws(
            function () {
                validateConfiguration(
                    configuration
                );
            },
            /EXPRESS_DELIVERY_FEE/
        );
    }
);

test(
    "validateConfiguration requires app origin in allowed origins",
    function () {
        const configuration =
            loadConfiguration(
                createValidEnvironment({
                    ALLOWED_ORIGINS:
                        "https://admin.example.com"
                })
            );

        assert.throws(
            function () {
                validateConfiguration(
                    configuration
                );
            },
            /APP_ORIGIN must be included/
        );
    }
);

test(
    "validateConfiguration rejects non-object input",
    function () {
        assert.throws(
            function () {
                validateConfiguration(
                    null
                );
            },
            /configuration object is required/
        );
    }
);

/* ==========================================================
   SAFE CONFIGURATION
========================================================== */

test(
    "sanitizeConfiguration excludes payment secrets",
    function () {
        const configuration =
            loadConfiguration(
                createValidEnvironment()
            );

        const sanitized =
            sanitizeConfiguration(
                configuration
            );

        assert.equal(
            Object.prototype
                .hasOwnProperty
                .call(
                    sanitized
                        .payments
                        .paystack,
                    "secretKey"
                ),
            false
        );

        assert.equal(
            Object.prototype
                .hasOwnProperty
                .call(
                    sanitized
                        .payments
                        .paystack,
                    "webhookSecret"
                ),
            false
        );

        assert.equal(
            Object.prototype
                .hasOwnProperty
                .call(
                    sanitized
                        .payments
                        .flutterwave,
                    "secretKey"
                ),
            false
        );
    }
);

test(
    "sanitizeConfiguration excludes email API keys",
    function () {
        const configuration =
            loadConfiguration(
                createValidEnvironment()
            );

        const sanitized =
            sanitizeConfiguration(
                configuration
            );

        assert.equal(
            Object.prototype
                .hasOwnProperty
                .call(
                    sanitized.email,
                    "resend"
                ),
            false
        );

        assert.equal(
            Object.prototype
                .hasOwnProperty
                .call(
                    sanitized.email,
                    "sendgrid"
                ),
            false
        );
    }
);

test(
    "sanitizeConfiguration retains public provider values",
    function () {
        const configuration =
            loadConfiguration(
                createValidEnvironment()
            );

        const sanitized =
            sanitizeConfiguration(
                configuration
            );

        assert.equal(
            sanitized.payments
                .provider,
            "paystack"
        );

        assert.equal(
            sanitized.payments
                .paystack
                .publicKey,
            "pk_test_example"
        );

        assert.equal(
            sanitized.email.from,
            "orders@example.com"
        );
    }
);

/* ==========================================================
   CACHE
========================================================== */

test(
    "getConfiguration caches configuration",
    function () {
        resetConfigurationCache();

        const first =
            getConfiguration({
                environment:
                    createValidEnvironment({
                        STORE_NAME:
                            "First Store"
                    })
            });

        const second =
            getConfiguration({
                environment:
                    createValidEnvironment({
                        STORE_NAME:
                            "Second Store"
                    })
            });

        assert.equal(
            first,
            second
        );

        assert.equal(
            second.storeName,
            "First Store"
        );

        resetConfigurationCache();
    }
);

test(
    "getConfiguration reloads configuration when requested",
    function () {
        resetConfigurationCache();

        const first =
            getConfiguration({
                environment:
                    createValidEnvironment({
                        STORE_NAME:
                            "First Store"
                    })
            });

        const second =
            getConfiguration({
                reload:
                    true,

                environment:
                    createValidEnvironment({
                        STORE_NAME:
                            "Second Store"
                    })
            });

        assert.notEqual(
            first,
            second
        );

        assert.equal(
            second.storeName,
            "Second Store"
        );

        resetConfigurationCache();
    }
);

test(
    "getConfiguration optionally validates configuration",
    function () {
        resetConfigurationCache();

        const environment =
            createValidEnvironment();

        delete environment
            .RESEND_API_KEY;

        assert.throws(
            function () {
                getConfiguration({
                    reload:
                        true,

                    validate:
                        true,

                    environment:
                        environment
                });
            },
            /RESEND_API_KEY/
        );

        resetConfigurationCache();
    }
);

/* ==========================================================
   IMMUTABILITY AND ERRORS
========================================================== */

test(
    "loaded configuration is deeply frozen",
    function () {
        const configuration =
            loadConfiguration(
                createValidEnvironment()
            );

        assert.equal(
            Object.isFrozen(
                configuration
            ),
            true
        );

        assert.equal(
            Object.isFrozen(
                configuration.delivery
            ),
            true
        );

        assert.equal(
            Object.isFrozen(
                configuration
                    .payments
                    .paystack
            ),
            true
        );

        assert.throws(
            function () {
                configuration.currency =
                    "USD";
            },
            TypeError
        );

        assert.equal(
            configuration.currency,
            "NGN"
        );
    }
);

test(
    "deepFreeze recursively freezes nested values",
    function () {
        const source = {
            nested: {
                value:
                    1
            },

            list: [
                {
                    value:
                        2
                }
            ]
        };

        deepFreeze(source);

        assert.equal(
            Object.isFrozen(source),
            true
        );

        assert.equal(
            Object.isFrozen(
                source.nested
            ),
            true
        );

        assert.equal(
            Object.isFrozen(
                source.list
            ),
            true
        );

        assert.equal(
            Object.isFrozen(
                source.list[0]
            ),
            true
        );
    }
);

test(
    "createConfigurationError includes code and variable",
    function () {
        const error =
            createConfigurationError(
                "TEST_VARIABLE",
                "Invalid value."
            );

        assert.equal(
            error.code,
            "configuration/invalid-value"
        );

        assert.equal(
            error.variable,
            "TEST_VARIABLE"
        );

        assert.equal(
            error.message,
            "TEST_VARIABLE: Invalid value."
        );
    }
);