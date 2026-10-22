"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   CLOUD FUNCTIONS CONFIGURATION

   Responsibilities:
   - Read environment variables
   - Normalize booleans, numbers, lists, URLs, and emails
   - Validate required configuration
   - Expose service-specific configuration
   - Prevent accidental secret exposure
========================================================== */

/* ==========================================================
   CONSTANTS
========================================================== */

const SUPPORTED_PAYMENT_PROVIDERS =
    new Set([
        "paystack",
        "flutterwave"
    ]);

const SUPPORTED_EMAIL_PROVIDERS =
    new Set([
        "resend",
        "sendgrid"
    ]);

const SUPPORTED_LOG_LEVELS =
    new Set([
        "debug",
        "info",
        "warn",
        "error"
    ]);

const DEFAULTS = Object.freeze({
    nodeEnvironment:
        "development",

    projectId:
        "leternel-store",

    region:
        "europe-west1",

    appOrigin:
        "http://localhost:5000",

    storeName:
        "L'ÉTERNEL",

    currency:
        "NGN",

    locale:
        "en-NG",

    supportEmail:
        "support@example.com",

    orderEmail:
        "orders@example.com",

    paymentProvider:
        "paystack",

    emailProvider:
        "resend",

    freeStandardDeliveryThreshold:
        500000,

    standardDeliveryFee:
        10000,

    expressDeliveryFee:
        25000,

    taxRate:
        0,

    requestTimeoutMs:
        15000,

    orderNumberPrefix:
        "LET",

    orderIdempotencyWindowMinutes:
        60,

    orderPaymentExpiryMinutes:
        30,

    maximumOrderItems:
        25,

    maximumItemQuantity:
        10,

    defaultUserRole:
        "customer",

    defaultUserStatus:
        "active",

    anonymizedEmailDomain:
        "deleted.leternel.invalid",

    webhookMaximumBodyBytes:
        1048576,

    emulatorTestTimeout:
        30000,

    logLevel:
        "info"
});

/* ==========================================================
   ENVIRONMENT ACCESS
========================================================== */

function readEnvironment(
    environment
) {
    return environment ||
        process.env;
}

function readString(
    environment,
    name,
    fallback
) {
    const value =
        environment[name];

    if (
        value === undefined ||
        value === null
    ) {
        return fallback;
    }

    const normalized =
        String(value).trim();

    return normalized ||
        fallback;
}

function readRequiredString(
    environment,
    name
) {
    const value =
        readString(
            environment,
            name
        );

    if (!value) {
        throw createConfigurationError(
            name,
            "A value is required."
        );
    }

    return value;
}

function readNumber(
    environment,
    name,
    fallback,
    options
) {
    const settings =
        options || {};

    const rawValue =
        environment[name];

    if (
        rawValue === undefined ||
        rawValue === null ||
        String(rawValue).trim() ===
            ""
    ) {
        return fallback;
    }

    const value =
        Number(rawValue);

    if (
        !Number.isFinite(value)
    ) {
        throw createConfigurationError(
            name,
            "Expected a finite number."
        );
    }

    if (
        settings.integer &&
        !Number.isInteger(value)
    ) {
        throw createConfigurationError(
            name,
            "Expected an integer."
        );
    }

    if (
        settings.minimum !==
            undefined &&
        value <
            settings.minimum
    ) {
        throw createConfigurationError(
            name,
            "Expected a value greater than or equal to " +
            settings.minimum +
            "."
        );
    }

    if (
        settings.maximum !==
            undefined &&
        value >
            settings.maximum
    ) {
        throw createConfigurationError(
            name,
            "Expected a value less than or equal to " +
            settings.maximum +
            "."
        );
    }

    return value;
}

function readBoolean(
    environment,
    name,
    fallback
) {
    const rawValue =
        environment[name];

    if (
        rawValue === undefined ||
        rawValue === null ||
        String(rawValue).trim() ===
            ""
    ) {
        return fallback;
    }

    const value =
        String(rawValue)
            .trim()
            .toLowerCase();

    if (
        [
            "true",
            "1",
            "yes",
            "on"
        ].includes(value)
    ) {
        return true;
    }

    if (
        [
            "false",
            "0",
            "no",
            "off"
        ].includes(value)
    ) {
        return false;
    }

    throw createConfigurationError(
        name,
        "Expected a boolean value."
    );
}

function readList(
    environment,
    name,
    fallback
) {
    const rawValue =
        environment[name];

    if (
        rawValue === undefined ||
        rawValue === null ||
        String(rawValue).trim() ===
            ""
    ) {
        return Array.isArray(fallback)
            ? fallback.slice()
            : [];
    }

    return String(rawValue)
        .split(",")
        .map(
            function (value) {
                return value.trim();
            }
        )
        .filter(Boolean);
}

function readEnum(
    environment,
    name,
    allowedValues,
    fallback
) {
    const value =
        readString(
            environment,
            name,
            fallback
        );

    const normalized =
        String(value)
            .trim()
            .toLowerCase();

    if (
        !allowedValues.has(
            normalized
        )
    ) {
        throw createConfigurationError(
            name,
            "Unsupported value: " +
            normalized +
            "."
        );
    }

    return normalized;
}

/* ==========================================================
   NORMALIZATION
========================================================== */

function normalizeOrigin(
    value,
    name
) {
    const source =
        String(value || "")
            .trim();

    if (!source) {
        throw createConfigurationError(
            name,
            "An origin is required."
        );
    }

    let parsed;

    try {
        parsed =
            new URL(source);
    } catch {
        throw createConfigurationError(
            name,
            "Expected a valid absolute URL."
        );
    }

    if (
        ![
            "http:",
            "https:"
        ].includes(
            parsed.protocol
        )
    ) {
        throw createConfigurationError(
            name,
            "Only HTTP and HTTPS origins are supported."
        );
    }

    return parsed.origin;
}

function normalizeUrl(
    value,
    name,
    options
) {
    const settings =
        options || {};

    if (!value) {
        if (settings.required) {
            throw createConfigurationError(
                name,
                "A URL is required."
            );
        }

        return "";
    }

    let parsed;

    try {
        parsed =
            new URL(
                String(value)
                    .trim()
            );
    } catch {
        throw createConfigurationError(
            name,
            "Expected a valid absolute URL."
        );
    }

    if (
        ![
            "http:",
            "https:"
        ].includes(
            parsed.protocol
        )
    ) {
        throw createConfigurationError(
            name,
            "Only HTTP and HTTPS URLs are supported."
        );
    }

    return parsed.toString();
}

function normalizeEmail(
    value,
    name
) {
    const email =
        String(value || "")
            .trim()
            .toLowerCase();

    if (
        !email ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
            .test(email)
    ) {
        throw createConfigurationError(
            name,
            "Expected a valid email address."
        );
    }

    return email;
}

function normalizeCurrency(
    value,
    name
) {
    const currency =
        String(value || "")
            .trim()
            .toUpperCase();

    if (
        !/^[A-Z]{3}$/.test(
            currency
        )
    ) {
        throw createConfigurationError(
            name,
            "Expected a three-letter currency code."
        );
    }

    return currency;
}

function normalizeLocale(
    value,
    name
) {
    const locale =
        String(value || "")
            .trim();

    if (
        !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/
            .test(locale)
    ) {
        throw createConfigurationError(
            name,
            "Expected a valid locale."
        );
    }

    return locale;
}

function normalizePrefix(
    value,
    name
) {
    const prefix =
        String(value || "")
            .trim()
            .toUpperCase();

    if (
        !/^[A-Z0-9-]{2,12}$/
            .test(prefix)
    ) {
        throw createConfigurationError(
            name,
            "Expected 2 to 12 uppercase letters, numbers, or hyphens."
        );
    }

    return prefix;
}

/* ==========================================================
   CONFIGURATION BUILDERS
========================================================== */

function loadConfiguration(
    environment
) {
    const env =
        readEnvironment(
            environment
        );

    const nodeEnvironment =
        readString(
            env,
            "NODE_ENV",
            DEFAULTS.nodeEnvironment
        );

    const projectId =
        readString(
            env,
            "FIREBASE_PROJECT_ID",
            env.GCLOUD_PROJECT ||
            env.GCP_PROJECT ||
            DEFAULTS.projectId
        );

    const appOrigin =
        normalizeOrigin(
            readString(
                env,
                "APP_ORIGIN",
                DEFAULTS.appOrigin
            ),
            "APP_ORIGIN"
        );

    const allowedOrigins =
        normalizeAllowedOrigins(
            readList(
                env,
                "ALLOWED_ORIGINS",
                [
                    appOrigin
                ]
            )
        );

    const paymentProvider =
        readEnum(
            env,
            "PAYMENT_PROVIDER",
            SUPPORTED_PAYMENT_PROVIDERS,
            DEFAULTS.paymentProvider
        );

    const emailProvider =
        readEnum(
            env,
            "EMAIL_PROVIDER",
            SUPPORTED_EMAIL_PROVIDERS,
            DEFAULTS.emailProvider
        );

    const configuration = {
        nodeEnvironment:
            nodeEnvironment,

        isProduction:
            nodeEnvironment ===
            "production",

        isDevelopment:
            nodeEnvironment ===
            "development",

        isTest:
            nodeEnvironment ===
            "test",

        projectId:
            projectId,

        region:
            readString(
                env,
                "FUNCTIONS_REGION",
                DEFAULTS.region
            ),

        appOrigin:
            appOrigin,

        allowedOrigins:
            allowedOrigins,

        storeName:
            readString(
                env,
                "STORE_NAME",
                DEFAULTS.storeName
            ),

        currency:
            normalizeCurrency(
                readString(
                    env,
                    "DEFAULT_CURRENCY",
                    DEFAULTS.currency
                ),
                "DEFAULT_CURRENCY"
            ),

        locale:
            normalizeLocale(
                readString(
                    env,
                    "DEFAULT_LOCALE",
                    DEFAULTS.locale
                ),
                "DEFAULT_LOCALE"
            ),

        supportEmail:
            normalizeEmail(
                readString(
                    env,
                    "SUPPORT_EMAIL",
                    DEFAULTS.supportEmail
                ),
                "SUPPORT_EMAIL"
            ),

        orderEmail:
            normalizeEmail(
                readString(
                    env,
                    "ORDER_EMAIL",
                    DEFAULTS.orderEmail
                ),
                "ORDER_EMAIL"
            ),

        delivery:
            loadDeliveryConfiguration(
                env
            ),

        payments:
            loadPaymentConfiguration(
                env,
                paymentProvider
            ),

        email:
            loadEmailConfiguration(
                env,
                emailProvider
            ),

        orders:
            loadOrderConfiguration(
                env
            ),

        accounts:
            loadAccountConfiguration(
                env
            ),

        security:
            loadSecurityConfiguration(
                env
            ),

        logging:
            loadLoggingConfiguration(
                env
            ),

        emulators:
            loadEmulatorConfiguration(
                env
            ),

        tests:
            loadTestConfiguration(
                env
            )
    };

    configuration.paymentProvider =
        configuration
            .payments
            .provider;

    configuration.emailProvider =
        configuration
            .email
            .provider;

    configuration.freeStandardDeliveryThreshold =
        configuration
            .delivery
            .freeStandardDeliveryThreshold;

    configuration.standardDeliveryFee =
        configuration
            .delivery
            .standardDeliveryFee;

    configuration.expressDeliveryFee =
        configuration
            .delivery
            .expressDeliveryFee;

    configuration.taxRate =
        configuration
            .delivery
            .taxRate;

    return deepFreeze(
        configuration
    );
}

function loadDeliveryConfiguration(
    environment
) {
    return {
        freeStandardDeliveryThreshold:
            readNumber(
                environment,
                "FREE_STANDARD_DELIVERY_THRESHOLD",
                DEFAULTS
                    .freeStandardDeliveryThreshold,
                {
                    minimum:
                        0
                }
            ),

        standardDeliveryFee:
            readNumber(
                environment,
                "STANDARD_DELIVERY_FEE",
                DEFAULTS
                    .standardDeliveryFee,
                {
                    minimum:
                        0
                }
            ),

        expressDeliveryFee:
            readNumber(
                environment,
                "EXPRESS_DELIVERY_FEE",
                DEFAULTS
                    .expressDeliveryFee,
                {
                    minimum:
                        0
                }
            ),

        taxRate:
            readNumber(
                environment,
                "TAX_RATE",
                DEFAULTS.taxRate,
                {
                    minimum:
                        0,

                    maximum:
                        1
                }
            )
    };
}

function loadPaymentConfiguration(
    environment,
    provider
) {
    return {
        provider:
            provider,

        paystack: {
            publicKey:
                readString(
                    environment,
                    "PAYSTACK_PUBLIC_KEY",
                    ""
                ),

            secretKey:
                readString(
                    environment,
                    "PAYSTACK_SECRET_KEY",
                    ""
                ),

            webhookSecret:
                readString(
                    environment,
                    "PAYSTACK_WEBHOOK_SECRET",
                    readString(
                        environment,
                        "PAYSTACK_SECRET_KEY",
                        ""
                    )
                ),

            callbackUrl:
                normalizeUrl(
                    readString(
                        environment,
                        "PAYSTACK_CALLBACK_URL",
                        ""
                    ),
                    "PAYSTACK_CALLBACK_URL"
                ),

            requestTimeoutMs:
                readNumber(
                    environment,
                    "PAYSTACK_REQUEST_TIMEOUT_MS",
                    DEFAULTS
                        .requestTimeoutMs,
                    {
                        integer:
                            true,

                        minimum:
                            1000
                    }
                )
        },

        flutterwave: {
            publicKey:
                readString(
                    environment,
                    "FLUTTERWAVE_PUBLIC_KEY",
                    ""
                ),

            secretKey:
                readString(
                    environment,
                    "FLUTTERWAVE_SECRET_KEY",
                    ""
                ),

            encryptionKey:
                readString(
                    environment,
                    "FLUTTERWAVE_ENCRYPTION_KEY",
                    ""
                ),

            webhookHash:
                readString(
                    environment,
                    "FLUTTERWAVE_WEBHOOK_HASH",
                    ""
                ),

            callbackUrl:
                normalizeUrl(
                    readString(
                        environment,
                        "FLUTTERWAVE_CALLBACK_URL",
                        ""
                    ),
                    "FLUTTERWAVE_CALLBACK_URL"
                ),

            requestTimeoutMs:
                readNumber(
                    environment,
                    "FLUTTERWAVE_REQUEST_TIMEOUT_MS",
                    DEFAULTS
                        .requestTimeoutMs,
                    {
                        integer:
                            true,

                        minimum:
                            1000
                    }
                )
        }
    };
}

function loadEmailConfiguration(
    environment,
    provider
) {
    return {
        provider:
            provider,

        from:
            normalizeEmail(
                readString(
                    environment,
                    "EMAIL_FROM",
                    DEFAULTS.orderEmail
                ),
                "EMAIL_FROM"
            ),

        fromName:
            readString(
                environment,
                "EMAIL_FROM_NAME",
                DEFAULTS.storeName
            ),

        replyTo:
            normalizeEmail(
                readString(
                    environment,
                    "EMAIL_REPLY_TO",
                    DEFAULTS.supportEmail
                ),
                "EMAIL_REPLY_TO"
            ),

        requestTimeoutMs:
            readNumber(
                environment,
                "EMAIL_REQUEST_TIMEOUT_MS",
                DEFAULTS
                    .requestTimeoutMs,
                {
                    integer:
                        true,

                    minimum:
                        1000
                }
            ),

        resend: {
            apiKey:
                readString(
                    environment,
                    "RESEND_API_KEY",
                    ""
                )
        },

        sendgrid: {
            apiKey:
                readString(
                    environment,
                    "SENDGRID_API_KEY",
                    ""
                )
        }
    };
}

function loadOrderConfiguration(
    environment
) {
    return {
        numberPrefix:
            normalizePrefix(
                readString(
                    environment,
                    "ORDER_NUMBER_PREFIX",
                    DEFAULTS
                        .orderNumberPrefix
                ),
                "ORDER_NUMBER_PREFIX"
            ),

        idempotencyWindowMinutes:
            readNumber(
                environment,
                "ORDER_IDEMPOTENCY_WINDOW_MINUTES",
                DEFAULTS
                    .orderIdempotencyWindowMinutes,
                {
                    integer:
                        true,

                    minimum:
                        1
                }
            ),

        paymentExpiryMinutes:
            readNumber(
                environment,
                "ORDER_PAYMENT_EXPIRY_MINUTES",
                DEFAULTS
                    .orderPaymentExpiryMinutes,
                {
                    integer:
                        true,

                    minimum:
                        1
                }
            ),

        maximumItems:
            readNumber(
                environment,
                "MAX_ORDER_ITEMS",
                DEFAULTS
                    .maximumOrderItems,
                {
                    integer:
                        true,

                    minimum:
                        1,

                    maximum:
                        100
                }
            ),

        maximumItemQuantity:
            readNumber(
                environment,
                "MAX_ITEM_QUANTITY",
                DEFAULTS
                    .maximumItemQuantity,
                {
                    integer:
                        true,

                    minimum:
                        1,

                    maximum:
                        100
                }
            ),

        sendConfirmationEmails:
            readBoolean(
                environment,
                "ENABLE_ORDER_CONFIRMATION_EMAILS",
                true
            ),

        sendPaymentReceiptEmails:
            readBoolean(
                environment,
                "ENABLE_PAYMENT_RECEIPT_EMAILS",
                true
            ),

        sendStatusEmails:
            readBoolean(
                environment,
                "ENABLE_ORDER_STATUS_EMAILS",
                true
            )
    };
}

function loadAccountConfiguration(
    environment
) {
    return {
        defaultRole:
            readString(
                environment,
                "DEFAULT_USER_ROLE",
                DEFAULTS
                    .defaultUserRole
            ),

        defaultStatus:
            readString(
                environment,
                "DEFAULT_USER_STATUS",
                DEFAULTS
                    .defaultUserStatus
            ),

        anonymizedEmailDomain:
            readString(
                environment,
                "ANONYMIZED_EMAIL_DOMAIN",
                DEFAULTS
                    .anonymizedEmailDomain
            )
    };
}

function loadSecurityConfiguration(
    environment
) {
    return {
        trustProxy:
            readBoolean(
                environment,
                "TRUST_PROXY",
                false
            ),

        requireAppCheck:
            readBoolean(
                environment,
                "REQUIRE_APP_CHECK",
                false
            ),

        requireVerifiedEmailForCheckout:
            readBoolean(
                environment,
                "REQUIRE_VERIFIED_EMAIL_FOR_CHECKOUT",
                true
            ),

        webhookMaximumBodyBytes:
            readNumber(
                environment,
                "WEBHOOK_MAX_BODY_BYTES",
                DEFAULTS
                    .webhookMaximumBodyBytes,
                {
                    integer:
                        true,

                    minimum:
                        1024
                }
            ),

        auditLoggingEnabled:
            readBoolean(
                environment,
                "ADMIN_AUDIT_LOGGING_ENABLED",
                true
            )
    };
}

function loadLoggingConfiguration(
    environment
) {
    return {
        level:
            readEnum(
                environment,
                "LOG_LEVEL",
                SUPPORTED_LOG_LEVELS,
                DEFAULTS.logLevel
            ),

        providerResponses:
            readBoolean(
                environment,
                "LOG_PROVIDER_RESPONSES",
                false
            ),

        webhookPayloads:
            readBoolean(
                environment,
                "LOG_WEBHOOK_PAYLOADS",
                false
            )
    };
}

function loadEmulatorConfiguration(
    environment
) {
    return {
        firestoreHost:
            readString(
                environment,
                "FIRESTORE_EMULATOR_HOST",
                ""
            ),

        authHost:
            readString(
                environment,
                "FIREBASE_AUTH_EMULATOR_HOST",
                ""
            ),

        storageHost:
            readString(
                environment,
                "FIREBASE_STORAGE_EMULATOR_HOST",
                ""
            ),

        functionsHost:
            readString(
                environment,
                "FUNCTIONS_EMULATOR_HOST",
                ""
            )
    };
}

function loadTestConfiguration(
    environment
) {
    return {
        emulatorTimeout:
            readNumber(
                environment,
                "EMULATOR_TEST_TIMEOUT",
                DEFAULTS
                    .emulatorTestTimeout,
                {
                    integer:
                        true,

                    minimum:
                        1000
                }
            ),

        paymentProviderAvailable:
            readBoolean(
                environment,
                "EMULATOR_PAYMENT_PROVIDER_AVAILABLE",
                false
            )
    };
}

/* ==========================================================
   VALIDATION
========================================================== */

function validateConfiguration(
    configuration,
    options
) {
    const settings =
        options || {};

    const errors = [];

    if (
        !configuration ||
        typeof configuration !==
            "object"
    ) {
        throw new TypeError(
            "A configuration object is required."
        );
    }

    const requireProviderSecrets =
        settings.requireProviderSecrets !==
        false;

    if (
        requireProviderSecrets
    ) {
        validatePaymentSecrets(
            configuration,
            errors
        );

        validateEmailSecrets(
            configuration,
            errors
        );
    }

    if (
        configuration
            .delivery
            .expressDeliveryFee <
        configuration
            .delivery
            .standardDeliveryFee
    ) {
        errors.push(
            "EXPRESS_DELIVERY_FEE should not be lower than STANDARD_DELIVERY_FEE."
        );
    }

    if (
        !configuration
            .allowedOrigins
            .includes(
                configuration
                    .appOrigin
            )
    ) {
        errors.push(
            "APP_ORIGIN must be included in ALLOWED_ORIGINS."
        );
    }

    if (errors.length) {
        const error =
            new Error(
                "Invalid application configuration:\n- " +
                errors.join("\n- ")
            );

        error.code =
            "configuration/invalid";

        error.details =
            errors.slice();

        throw error;
    }

    return configuration;
}

function validatePaymentSecrets(
    configuration,
    errors
) {
    const payments =
        configuration.payments;

    if (
        payments.provider ===
        "paystack"
    ) {
        if (
            !payments
                .paystack
                .secretKey
        ) {
            errors.push(
                "PAYSTACK_SECRET_KEY is required when PAYMENT_PROVIDER=paystack."
            );
        }

        if (
            !payments
                .paystack
                .webhookSecret
        ) {
            errors.push(
                "PAYSTACK_WEBHOOK_SECRET is required when PAYMENT_PROVIDER=paystack."
            );
        }
    }

    if (
        payments.provider ===
        "flutterwave"
    ) {
        if (
            !payments
                .flutterwave
                .secretKey
        ) {
            errors.push(
                "FLUTTERWAVE_SECRET_KEY is required when PAYMENT_PROVIDER=flutterwave."
            );
        }

        if (
            !payments
                .flutterwave
                .webhookHash
        ) {
            errors.push(
                "FLUTTERWAVE_WEBHOOK_HASH is required when PAYMENT_PROVIDER=flutterwave."
            );
        }
    }
}

function validateEmailSecrets(
    configuration,
    errors
) {
    const email =
        configuration.email;

    if (
        email.provider ===
            "resend" &&
        !email.resend.apiKey
    ) {
        errors.push(
            "RESEND_API_KEY is required when EMAIL_PROVIDER=resend."
        );
    }

    if (
        email.provider ===
            "sendgrid" &&
        !email.sendgrid.apiKey
    ) {
        errors.push(
            "SENDGRID_API_KEY is required when EMAIL_PROVIDER=sendgrid."
        );
    }
}

/* ==========================================================
   SAFE CONFIGURATION
========================================================== */

function sanitizeConfiguration(
    configuration
) {
    return {
        nodeEnvironment:
            configuration
                .nodeEnvironment,

        projectId:
            configuration
                .projectId,

        region:
            configuration
                .region,

        appOrigin:
            configuration
                .appOrigin,

        allowedOrigins:
            configuration
                .allowedOrigins
                .slice(),

        storeName:
            configuration
                .storeName,

        currency:
            configuration
                .currency,

        locale:
            configuration
                .locale,

        supportEmail:
            configuration
                .supportEmail,

        orderEmail:
            configuration
                .orderEmail,

        delivery:
            Object.assign(
                {},
                configuration
                    .delivery
            ),

        payments: {
            provider:
                configuration
                    .payments
                    .provider,

            paystack: {
                publicKey:
                    configuration
                        .payments
                        .paystack
                        .publicKey,

                callbackUrl:
                    configuration
                        .payments
                        .paystack
                        .callbackUrl,

                requestTimeoutMs:
                    configuration
                        .payments
                        .paystack
                        .requestTimeoutMs
            },

            flutterwave: {
                publicKey:
                    configuration
                        .payments
                        .flutterwave
                        .publicKey,

                callbackUrl:
                    configuration
                        .payments
                        .flutterwave
                        .callbackUrl,

                requestTimeoutMs:
                    configuration
                        .payments
                        .flutterwave
                        .requestTimeoutMs
            }
        },

        email: {
            provider:
                configuration
                    .email
                    .provider,

            from:
                configuration
                    .email
                    .from,

            fromName:
                configuration
                    .email
                    .fromName,

            replyTo:
                configuration
                    .email
                    .replyTo,

            requestTimeoutMs:
                configuration
                    .email
                    .requestTimeoutMs
        },

        orders:
            Object.assign(
                {},
                configuration
                    .orders
            ),

        accounts:
            Object.assign(
                {},
                configuration
                    .accounts
            ),

        security:
            Object.assign(
                {},
                configuration
                    .security
            ),

        logging:
            Object.assign(
                {},
                configuration
                    .logging
            )
    };
}

/* ==========================================================
   INTERNAL HELPERS
========================================================== */

function normalizeAllowedOrigins(
    origins
) {
    const normalized =
        origins.map(
            function (origin) {
                return normalizeOrigin(
                    origin,
                    "ALLOWED_ORIGINS"
                );
            }
        );

    return Array.from(
        new Set(normalized)
    );
}

function createConfigurationError(
    name,
    message
) {
    const error =
        new Error(
            name +
            ": " +
            message
        );

    error.code =
        "configuration/invalid-value";

    error.variable =
        name;

    return error;
}

function deepFreeze(value) {
    if (
        !value ||
        typeof value !==
            "object" ||
        Object.isFrozen(value)
    ) {
        return value;
    }

    Object.freeze(value);

    Object.keys(value)
        .forEach(
            function (key) {
                deepFreeze(
                    value[key]
                );
            }
        );

    return value;
}

/* ==========================================================
   LAZY DEFAULT CONFIGURATION
========================================================== */

let cachedConfiguration;

function getConfiguration(
    options
) {
    const settings =
        options || {};

    if (
        !cachedConfiguration ||
        settings.reload
    ) {
        cachedConfiguration =
            loadConfiguration(
                settings.environment
            );

        if (
            settings.validate
        ) {
            validateConfiguration(
                cachedConfiguration,
                settings.validation
            );
        }
    }

    return cachedConfiguration;
}

function resetConfigurationCache() {
    cachedConfiguration =
        undefined;
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
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
    DEFAULTS,
    SUPPORTED_PAYMENT_PROVIDERS:
        Array.from(
            SUPPORTED_PAYMENT_PROVIDERS
        ),
    SUPPORTED_EMAIL_PROVIDERS:
        Array.from(
            SUPPORTED_EMAIL_PROVIDERS
        ),
    SUPPORTED_LOG_LEVELS:
        Array.from(
            SUPPORTED_LOG_LEVELS
        )
};