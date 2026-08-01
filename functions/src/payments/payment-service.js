"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   PAYMENT SERVICE
========================================================== */

const crypto = require("crypto");

const {
    FieldValue,
    Timestamp
} = require("firebase-admin/firestore");

const {
    createServiceError,
    normalizeString
} = require("../shared/validation");

/* ==========================================================
   CONSTANTS
========================================================== */

const PAYSTACK_API_BASE =
    "https://api.paystack.co";

const FLUTTERWAVE_API_BASE =
    "https://api.flutterwave.com/v3";

const ORDER_COLLECTION =
    "orders";

const WEBHOOK_EVENT_COLLECTION =
    "paymentWebhookEvents";

const PAYMENT_STATUSES = {
    PENDING: "pending",
    PAID: "paid",
    SUCCESSFUL: "successful",
    FAILED: "failed",
    DECLINED: "declined",
    REFUNDED: "refunded",
    AWAITING_PAYMENT:
        "awaiting-payment"
};

const ORDER_STATUSES = {
    PENDING: "pending",
    CONFIRMED: "confirmed",
    PROCESSING: "processing",
    SHIPPED: "shipped",
    DELIVERED: "delivered",
    CANCELLED: "cancelled",
    REFUNDED: "refunded"
};

const SUCCESSFUL_PROVIDER_STATUSES =
    new Set([
        "success",
        "successful",
        "completed"
    ]);

const FAILED_PROVIDER_STATUSES =
    new Set([
        "failed",
        "declined",
        "cancelled",
        "canceled",
        "abandoned",
        "reversed"
    ]);

const DEFAULT_REQUEST_TIMEOUT =
    20000;

/* ==========================================================
   PAYMENT INITIALIZATION
========================================================== */

async function initializePayment(options) {
    const settings =
        options || {};

    const provider =
        normalizeProvider(
            settings.provider
        );

    if (provider === "paystack") {
        return initializePaystackPayment(
            settings
        );
    }

    if (provider === "flutterwave") {
        return initializeFlutterwavePayment(
            settings
        );
    }

    throw createServiceError(
        "payment-failed",
        "The selected payment provider is unavailable.",
        {
            status: 503,
            details: {
                provider: provider
            }
        }
    );
}

/* ==========================================================
   PAYSTACK INITIALIZATION
========================================================== */

async function initializePaystackPayment(
    options
) {
    const configuration =
        options.configuration || {};

    const secretKey =
        requireProviderSecret(
            configuration.paystackSecretKey,
            "Paystack"
        );

    const order =
        options.order || {};

    const customer =
        options.customer ||
        order.customer ||
        {};

    const amount =
        toMinorUnits(
            order.total,
            order.currency
        );

    const reference =
        createPaymentReference(
            "LET-PS",
            order.id
        );

    const callbackUrl =
        buildCallbackUrl(
            configuration.appOrigin,
            "/checkout/payment-complete"
        );

    const payload = {
        email:
            normalizeString(
                customer.email,
                {
                    fieldName:
                        "Customer email",
                    required: true,
                    maximumLength: 320,
                    lowercase: true
                }
            ),

        amount:
            String(amount),

        currency:
            normalizeCurrency(
                order.currency
            ),

        reference:
            reference,

        metadata: {
            orderId:
                order.id,

            orderNumber:
                order.orderNumber,

            userId:
                order.userId ||
                null,

            customerName:
                customer.displayName ||
                [
                    customer.firstName,
                    customer.lastName
                ]
                    .filter(Boolean)
                    .join(" "),

            source:
                "leternel-store"
        }
    };

    if (callbackUrl) {
        payload.callback_url =
            callbackUrl;
    }

    const result =
        await providerRequest({
            url:
                PAYSTACK_API_BASE +
                "/transaction/initialize",

            method: "POST",

            headers: {
                Authorization:
                    "Bearer " +
                    secretKey
            },

            body: payload,

            timeout:
                DEFAULT_REQUEST_TIMEOUT,

            provider:
                "Paystack"
        });

    if (
        !result ||
        result.status !== true ||
        !result.data
    ) {
        throw createServiceError(
            "payment-failed",
            result &&
            result.message
                ? result.message
                : "Paystack could not initialize the payment.",
            {
                status: 502
            }
        );
    }

    return {
        provider:
            "paystack",

        reference:
            result.data.reference ||
            reference,

        providerReference:
            result.data.reference ||
            reference,

        authorizationUrl:
            result.data.authorization_url ||
            null,

        accessCode:
            result.data.access_code ||
            null,

        rawStatus:
            "initialized"
    };
}

/* ==========================================================
   FLUTTERWAVE INITIALIZATION
========================================================== */

async function initializeFlutterwavePayment(
    options
) {
    const configuration =
        options.configuration || {};

    const secretKey =
        requireProviderSecret(
            configuration
                .flutterwaveSecretKey,
            "Flutterwave"
        );

    const order =
        options.order || {};

    const customer =
        options.customer ||
        order.customer ||
        {};

    const reference =
        createPaymentReference(
            "LET-FW",
            order.id
        );

    const redirectUrl =
        buildCallbackUrl(
            configuration.appOrigin,
            "/checkout/payment-complete"
        );

    const payload = {
        tx_ref:
            reference,

        amount:
            normalizeMoney(
                order.total
            ),

        currency:
            normalizeCurrency(
                order.currency
            ),

        redirect_url:
            redirectUrl ||
            undefined,

        customer: {
            email:
                normalizeString(
                    customer.email,
                    {
                        fieldName:
                            "Customer email",
                        required: true,
                        maximumLength:
                            320,
                        lowercase: true
                    }
                ),

            name:
                customer.displayName ||
                [
                    customer.firstName,
                    customer.lastName
                ]
                    .filter(Boolean)
                    .join(" "),

            phonenumber:
                customer.phone ||
                ""
        },

        customizations: {
            title:
                configuration.storeName ||
                "L'ÉTERNEL",

            description:
                "Payment for order " +
                (
                    order.orderNumber ||
                    order.id
                )
        },

        meta: {
            orderId:
                order.id,

            orderNumber:
                order.orderNumber,

            userId:
                order.userId ||
                null,

            source:
                "leternel-store"
        }
    };

    const result =
        await providerRequest({
            url:
                FLUTTERWAVE_API_BASE +
                "/payments",

            method: "POST",

            headers: {
                Authorization:
                    "Bearer " +
                    secretKey
            },

            body:
                removeUndefined(
                    payload
                ),

            timeout:
                DEFAULT_REQUEST_TIMEOUT,

            provider:
                "Flutterwave"
        });

    if (
        !result ||
        String(
            result.status || ""
        ).toLowerCase() !==
            "success" ||
        !result.data
    ) {
        throw createServiceError(
            "payment-failed",
            result &&
            result.message
                ? result.message
                : "Flutterwave could not initialize the payment.",
            {
                status: 502
            }
        );
    }

    return {
        provider:
            "flutterwave",

        reference:
            reference,

        providerReference:
            reference,

        authorizationUrl:
            result.data.link ||
            null,

        accessCode:
            null,

        rawStatus:
            result.status
    };
}

/* ==========================================================
   WEBHOOK PROVIDER RESOLUTION
========================================================== */

function resolveWebhookProvider(request) {
    const paystackSignature =
        getHeader(
            request,
            "x-paystack-signature"
        );

    if (paystackSignature) {
        return "paystack";
    }

    const flutterwaveSignature =
        getHeader(
            request,
            "flutterwave-signature"
        );

    const flutterwaveVerificationHash =
        getHeader(
            request,
            "verif-hash"
        );

    if (
        flutterwaveSignature ||
        flutterwaveVerificationHash
    ) {
        return "flutterwave";
    }

    const body =
        request &&
        request.body &&
        typeof request.body === "object"
            ? request.body
            : {};

    const eventName =
        String(
            body.event ||
            body.event_type ||
            ""
        ).toLowerCase();

    if (
        eventName.startsWith(
            "charge."
        )
    ) {
        return "paystack";
    }

    if (
        body.data &&
        (
            body.data.tx_ref ||
            body.data.flw_ref
        )
    ) {
        return "flutterwave";
    }

    throw createServiceError(
        "invalid-signature",
        "The payment provider could not be identified.",
        {
            status: 401
        }
    );
}

/* ==========================================================
   WEBHOOK PROCESSING
========================================================== */

async function processWebhook(options) {
    const settings =
        options || {};

    if (!settings.db) {
        throw createServiceError(
            "internal",
            "The database service is unavailable.",
            {
                status: 500
            }
        );
    }

    const provider =
        normalizeProvider(
            settings.provider
        );

    if (provider === "paystack") {
        return processPaystackWebhook(
            settings
        );
    }

    if (provider === "flutterwave") {
        return processFlutterwaveWebhook(
            settings
        );
    }

    throw createServiceError(
        "invalid-argument",
        "The webhook provider is unsupported.",
        {
            status: 400
        }
    );
}

/* ==========================================================
   PAYSTACK WEBHOOK
========================================================== */

async function processPaystackWebhook(
    options
) {
    const configuration =
        options.configuration || {};

    /*
     * Paystack signs webhook bodies with the integration secret key.
     * The separately named webhook secret is retained as a fallback
     * for deployments that previously configured one.
     */
    const signatureSecret =
        configuration.paystackSecretKey ||
        configuration
            .paystackWebhookSecret;

    requireProviderSecret(
        signatureSecret,
        "Paystack webhook"
    );

    verifyPaystackWebhookSignature({
        request:
            options.request,
        secret:
            signatureSecret
    });

    const event =
        normalizeWebhookBody(
            options.request
        );

    const eventType =
        String(
            event.event || ""
        ).toLowerCase();

    const eventData =
        event.data || {};

    const reference =
        String(
            eventData.reference ||
            ""
        ).trim();

    const eventId =
        createWebhookEventId({
            provider:
                "paystack",
            eventType:
                eventType,
            reference:
                reference,
            providerId:
                eventData.id
        });

    const eventReference =
        options.db
            .collection(
                WEBHOOK_EVENT_COLLECTION
            )
            .doc(eventId);

    const existing =
        await eventReference.get();

    if (
        existing.exists &&
        existing.get("processed") ===
            true
    ) {
        return {
            eventId: eventId,
            orderId:
                existing.get(
                    "orderId"
                ) || null,
            duplicate: true
        };
    }

    await registerWebhookEvent({
        reference:
            eventReference,
        provider:
            "paystack",
        eventType:
            eventType,
        paymentReference:
            reference,
        payload:
            event
    });

    let result = {
        orderId: null,
        ignored: true
    };

    try {
        if (
            eventType ===
            "charge.success"
        ) {
            result =
                await handleSuccessfulPayment({
                    db:
                        options.db,
                    provider:
                        "paystack",
                    reference:
                        reference,
                    webhookData:
                        eventData,
                    configuration:
                        configuration
                });
        } else if (
            eventType.includes(
                "refund"
            )
        ) {
            result =
                await handleRefundEvent({
                    db:
                        options.db,
                    provider:
                        "paystack",
                    reference:
                        reference,
                    webhookData:
                        eventData
                });
        } else if (
            eventType.includes(
                "charge.failed"
            ) ||
            eventType.includes(
                "failed"
            )
        ) {
            result =
                await handleFailedPayment({
                    db:
                        options.db,
                    provider:
                        "paystack",
                    reference:
                        reference,
                    webhookData:
                        eventData
                });
        }

        await completeWebhookEvent({
            reference:
                eventReference,
            orderId:
                result.orderId,
            ignored:
                Boolean(
                    result.ignored
                )
        });

        return {
            eventId:
                eventId,
            orderId:
                result.orderId ||
                null,
            duplicate:
                false,
            ignored:
                Boolean(
                    result.ignored
                )
        };
    } catch (error) {
        await failWebhookEvent({
            reference:
                eventReference,
            error:
                error
        });

        throw error;
    }
}

/* ==========================================================
   FLUTTERWAVE WEBHOOK
========================================================== */

async function processFlutterwaveWebhook(
    options
) {
    const configuration =
        options.configuration || {};

    const webhookSecret =
        requireProviderSecret(
            configuration
                .flutterwaveWebhookSecret,
            "Flutterwave webhook"
        );

    verifyFlutterwaveWebhookSignature({
        request:
            options.request,
        secret:
            webhookSecret
    });

    const event =
        normalizeWebhookBody(
            options.request
        );

    const eventType =
        String(
            event.event ||
            event.event_type ||
            ""
        ).toLowerCase();

    const eventData =
        event.data || {};

    const reference =
        String(
            eventData.tx_ref ||
            eventData.reference ||
            ""
        ).trim();

    const eventId =
        createWebhookEventId({
            provider:
                "flutterwave",
            eventType:
                eventType,
            reference:
                reference,
            providerId:
                eventData.id ||
                event.id
        });

    const eventReference =
        options.db
            .collection(
                WEBHOOK_EVENT_COLLECTION
            )
            .doc(eventId);

    const existing =
        await eventReference.get();

    if (
        existing.exists &&
        existing.get("processed") ===
            true
    ) {
        return {
            eventId:
                eventId,
            orderId:
                existing.get(
                    "orderId"
                ) || null,
            duplicate: true
        };
    }

    await registerWebhookEvent({
        reference:
            eventReference,
        provider:
            "flutterwave",
        eventType:
            eventType,
        paymentReference:
            reference,
        payload:
            event
    });

    let result = {
        orderId: null,
        ignored: true
    };

    try {
        const status =
            String(
                eventData.status ||
                ""
            ).toLowerCase();

        if (
            SUCCESSFUL_PROVIDER_STATUSES.has(
                status
            ) ||
            eventType.includes(
                "charge.completed"
            ) ||
            eventType.includes(
                "charge.success"
            )
        ) {
            result =
                await handleSuccessfulPayment({
                    db:
                        options.db,
                    provider:
                        "flutterwave",
                    reference:
                        reference,
                    transactionId:
                        eventData.id,
                    webhookData:
                        eventData,
                    configuration:
                        configuration
                });
        } else if (
            eventType.includes(
                "refund"
            ) ||
            status === "refunded"
        ) {
            result =
                await handleRefundEvent({
                    db:
                        options.db,
                    provider:
                        "flutterwave",
                    reference:
                        reference,
                    webhookData:
                        eventData
                });
        } else if (
            FAILED_PROVIDER_STATUSES.has(
                status
            )
        ) {
            result =
                await handleFailedPayment({
                    db:
                        options.db,
                    provider:
                        "flutterwave",
                    reference:
                        reference,
                    webhookData:
                        eventData
                });
        }

        await completeWebhookEvent({
            reference:
                eventReference,
            orderId:
                result.orderId,
            ignored:
                Boolean(
                    result.ignored
                )
        });

        return {
            eventId:
                eventId,
            orderId:
                result.orderId ||
                null,
            duplicate:
                false,
            ignored:
                Boolean(
                    result.ignored
                )
        };
    } catch (error) {
        await failWebhookEvent({
            reference:
                eventReference,
            error:
                error
        });

        throw error;
    }
}

/* ==========================================================
   SIGNATURE VERIFICATION
========================================================== */

function verifyPaystackWebhookSignature(
    options
) {
    const signature =
        getHeader(
            options.request,
            "x-paystack-signature"
        );

    if (!signature) {
        throw createServiceError(
            "invalid-signature",
            "The Paystack webhook signature is missing.",
            {
                status: 401
            }
        );
    }

    const body =
        getRawRequestBody(
            options.request
        );

    const expected =
        crypto
            .createHmac(
                "sha512",
                options.secret
            )
            .update(body)
            .digest("hex");

    if (
        !safeCompare(
            expected,
            signature
        )
    ) {
        throw createServiceError(
            "invalid-signature",
            "The Paystack webhook signature is invalid.",
            {
                status: 401
            }
        );
    }

    return true;
}

function verifyFlutterwaveWebhookSignature(
    options
) {
    const request =
        options.request;

    const secret =
        options.secret;

    const hmacSignature =
        getHeader(
            request,
            "flutterwave-signature"
        );

    const legacyHash =
        getHeader(
            request,
            "verif-hash"
        );

    if (hmacSignature) {
        const body =
            getRawRequestBody(
                request
            );

        const expectedBase64 =
            crypto
                .createHmac(
                    "sha256",
                    secret
                )
                .update(body)
                .digest("base64");

        const expectedHex =
            crypto
                .createHmac(
                    "sha256",
                    secret
                )
                .update(body)
                .digest("hex");

        if (
            !safeCompare(
                expectedBase64,
                hmacSignature
            ) &&
            !safeCompare(
                expectedHex,
                hmacSignature
            )
        ) {
            throw createServiceError(
                "invalid-signature",
                "The Flutterwave webhook signature is invalid.",
                {
                    status: 401
                }
            );
        }

        return true;
    }

    /*
     * Some Flutterwave integrations send the dashboard verification
     * hash directly in the verif-hash header.
     */
    if (
        legacyHash &&
        safeCompare(
            secret,
            legacyHash
        )
    ) {
        return true;
    }

    throw createServiceError(
        "invalid-signature",
        "The Flutterwave webhook signature is invalid.",
        {
            status: 401
        }
    );
}

/* ==========================================================
   PAYMENT VERIFICATION
========================================================== */

async function verifyPayment(options) {
    const provider =
        normalizeProvider(
            options.provider
        );

    if (provider === "paystack") {
        return verifyPaystackPayment(
            options
        );
    }

    if (provider === "flutterwave") {
        return verifyFlutterwavePayment(
            options
        );
    }

    throw createServiceError(
        "payment-failed",
        "The payment provider is unsupported.",
        {
            status: 400
        }
    );
}

async function verifyPaystackPayment(
    options
) {
    const secretKey =
        requireProviderSecret(
            options.configuration &&
            options.configuration
                .paystackSecretKey,
            "Paystack"
        );

    const reference =
        normalizeString(
            options.reference,
            {
                fieldName:
                    "Payment reference",
                required: true,
                maximumLength: 300
            }
        );

    const result =
        await providerRequest({
            url:
                PAYSTACK_API_BASE +
                "/transaction/verify/" +
                encodeURIComponent(
                    reference
                ),

            method: "GET",

            headers: {
                Authorization:
                    "Bearer " +
                    secretKey
            },

            timeout:
                DEFAULT_REQUEST_TIMEOUT,

            provider:
                "Paystack"
        });

    if (
        !result ||
        result.status !== true ||
        !result.data
    ) {
        throw createServiceError(
            "payment-failed",
            result &&
            result.message
                ? result.message
                : "Paystack could not verify the payment.",
            {
                status: 502
            }
        );
    }

    return {
        provider:
            "paystack",

        providerTransactionId:
            result.data.id
                ? String(
                      result.data.id
                  )
                : null,

        reference:
            result.data.reference,

        status:
            String(
                result.data.status ||
                ""
            ).toLowerCase(),

        successful:
            String(
                result.data.status ||
                ""
            ).toLowerCase() ===
            "success",

        amount:
            fromMinorUnits(
                result.data.amount,
                result.data.currency
            ),

        currency:
            normalizeCurrency(
                result.data.currency
            ),

        customerEmail:
            result.data.customer &&
            result.data.customer.email
                ? String(
                      result.data.customer
                          .email
                  ).toLowerCase()
                : null,

        paidAt:
            result.data.paid_at ||
            result.data.paidAt ||
            null,

        authorization:
            sanitizeAuthorization(
                result.data.authorization
            ),

        gatewayResponse:
            result.data.gateway_response ||
            null,

        raw:
            result.data
    };
}

async function verifyFlutterwavePayment(
    options
) {
    const secretKey =
        requireProviderSecret(
            options.configuration &&
            options.configuration
                .flutterwaveSecretKey,
            "Flutterwave"
        );

    const transactionId =
        normalizeString(
            options.transactionId,
            {
                fieldName:
                    "Transaction ID",
                required: true,
                maximumLength: 200
            }
        );

    const result =
        await providerRequest({
            url:
                FLUTTERWAVE_API_BASE +
                "/transactions/" +
                encodeURIComponent(
                    transactionId
                ) +
                "/verify",

            method: "GET",

            headers: {
                Authorization:
                    "Bearer " +
                    secretKey
            },

            timeout:
                DEFAULT_REQUEST_TIMEOUT,

            provider:
                "Flutterwave"
        });

    if (
        !result ||
        String(
            result.status || ""
        ).toLowerCase() !==
            "success" ||
        !result.data
    ) {
        throw createServiceError(
            "payment-failed",
            result &&
            result.message
                ? result.message
                : "Flutterwave could not verify the payment.",
            {
                status: 502
            }
        );
    }

    const status =
        String(
            result.data.status ||
            ""
        ).toLowerCase();

    return {
        provider:
            "flutterwave",

        providerTransactionId:
            result.data.id
                ? String(
                      result.data.id
                  )
                : transactionId,

        reference:
            result.data.tx_ref ||
            options.reference ||
            null,

        status:
            status,

        successful:
            SUCCESSFUL_PROVIDER_STATUSES.has(
                status
            ),

        amount:
            normalizeMoney(
                firstDefined(
                    result.data
                        .charged_amount,
                    result.data.amount,
                    0
                )
            ),

        currency:
            normalizeCurrency(
                result.data.currency
            ),

        customerEmail:
            result.data.customer &&
            result.data.customer.email
                ? String(
                      result.data.customer
                          .email
                  ).toLowerCase()
                : null,

        paidAt:
            result.data.created_at ||
            null,

        authorization:
            sanitizeFlutterwavePaymentInstrument(
                result.data
            ),

        gatewayResponse:
            result.data
                .processor_response ||
            null,

        raw:
            result.data
    };
}

/* ==========================================================
   SUCCESSFUL PAYMENT
========================================================== */

async function handleSuccessfulPayment(
    options
) {
    const verification =
        await verifyPayment({
            provider:
                options.provider,

            reference:
                options.reference,

            transactionId:
                options.transactionId ||
                (
                    options.webhookData &&
                    options.webhookData.id
                ),

            configuration:
                options.configuration
        });

    if (!verification.successful) {
        throw createServiceError(
            "payment-failed",
            "The payment provider did not confirm a successful payment.",
            {
                status: 412,
                details: {
                    providerStatus:
                        verification.status
                }
            }
        );
    }

    const orderSnapshot =
        await findOrderForPayment({
            db:
                options.db,
            reference:
                verification.reference ||
                options.reference,
            webhookData:
                options.webhookData
        });

    if (!orderSnapshot) {
        throw createServiceError(
            "order-not-found",
            "No order matches this payment.",
            {
                status: 404
            }
        );
    }

    const order =
        orderSnapshot.data() || {};

    validateVerifiedPayment({
        order:
            order,
        verification:
            verification
    });

    const result =
        await options.db.runTransaction(
            async function (
                transaction
            ) {
                const latestSnapshot =
                    await transaction.get(
                        orderSnapshot.ref
                    );

                if (
                    !latestSnapshot.exists
                ) {
                    throw createServiceError(
                        "order-not-found",
                        "The order could not be found.",
                        {
                            status: 404
                        }
                    );
                }

                const latest =
                    latestSnapshot.data() ||
                    {};

                if (
                    latest.paymentStatus ===
                        PAYMENT_STATUSES.PAID ||
                    latest.paymentStatus ===
                        PAYMENT_STATUSES
                            .SUCCESSFUL
                ) {
                    return {
                        duplicate:
                            true,
                        orderId:
                            latestSnapshot.id
                    };
                }

                if (
                    latest.status ===
                    ORDER_STATUSES.CANCELLED
                ) {
                    throw createServiceError(
                        "failed-precondition",
                        "The payment belongs to a cancelled order.",
                        {
                            status: 412
                        }
                    );
                }

                const now =
                    Timestamp.now();

                const paymentUpdate = {
                    providerReference:
                        verification.reference ||
                        options.reference,

                    transactionId:
                        verification
                            .providerTransactionId,

                    status:
                        verification.status,

                    amount:
                        verification.amount,

                    currency:
                        verification.currency,

                    gatewayResponse:
                        verification
                            .gatewayResponse,

                    authorization:
                        verification
                            .authorization,

                    paidAt:
                        verification.paidAt
                            ? toTimestamp(
                                  verification
                                      .paidAt
                              )
                            : now,

                    verifiedAt:
                        now,

                    failedAt:
                        null
                };

                transaction.set(
                    latestSnapshot.ref,
                    {
                        paymentStatus:
                            PAYMENT_STATUSES
                                .PAID,

                        status:
                            latest.status ===
                            ORDER_STATUSES.PENDING
                                ? ORDER_STATUSES
                                      .CONFIRMED
                                : latest.status,

                        paymentReference:
                            verification.reference ||
                            options.reference,

                        payment:
                            paymentUpdate,

                        confirmedAt:
                            latest.confirmedAt ||
                            now,

                        updatedAt:
                            now,

                        statusHistory:
                            FieldValue.arrayUnion({
                                status:
                                    latest.status ===
                                    ORDER_STATUSES.PENDING
                                        ? ORDER_STATUSES
                                              .CONFIRMED
                                        : latest.status,

                                paymentStatus:
                                    PAYMENT_STATUSES
                                        .PAID,

                                note:
                                    "Payment verified successfully.",

                                source:
                                    options.provider,

                                userId:
                                    null,

                                createdAt:
                                    now
                            })
                    },
                    {
                        merge: true
                    }
                );

                return {
                    duplicate:
                        false,
                    orderId:
                        latestSnapshot.id
                };
            }
        );

    return {
        orderId:
            result.orderId,
        duplicate:
            result.duplicate,
        ignored:
            false
    };
}

/* ==========================================================
   FAILED PAYMENT
========================================================== */

async function handleFailedPayment(
    options
) {
    const orderSnapshot =
        await findOrderForPayment({
            db:
                options.db,
            reference:
                options.reference,
            webhookData:
                options.webhookData
        });

    if (!orderSnapshot) {
        return {
            orderId: null,
            ignored: true
        };
    }

    const order =
        orderSnapshot.data() || {};

    if (
        order.paymentStatus ===
            PAYMENT_STATUSES.PAID ||
        order.paymentStatus ===
            PAYMENT_STATUSES
                .SUCCESSFUL
    ) {
        return {
            orderId:
                orderSnapshot.id,
            ignored: true
        };
    }

    const now =
        Timestamp.now();

    await orderSnapshot.ref.set(
        {
            paymentStatus:
                PAYMENT_STATUSES.FAILED,

            payment: {
                providerReference:
                    options.reference ||
                    null,

                status:
                    String(
                        options.webhookData &&
                        options.webhookData
                            .status
                            ? options.webhookData
                                  .status
                            : "failed"
                    ).toLowerCase(),

                gatewayResponse:
                    options.webhookData &&
                    (
                        options.webhookData
                            .gateway_response ||
                        options.webhookData
                            .processor_response
                    )
                        ? String(
                              options.webhookData
                                  .gateway_response ||
                              options.webhookData
                                  .processor_response
                          )
                        : null,

                failedAt:
                    now
            },

            updatedAt:
                now,

            statusHistory:
                FieldValue.arrayUnion({
                    status:
                        order.status ||
                        ORDER_STATUSES.PENDING,

                    paymentStatus:
                        PAYMENT_STATUSES
                            .FAILED,

                    note:
                        "Payment failed or was declined.",

                    source:
                        options.provider,

                    userId:
                        null,

                    createdAt:
                        now
                })
        },
        {
            merge: true
        }
    );

    return {
        orderId:
            orderSnapshot.id,
        ignored: false
    };
}

/* ==========================================================
   REFUNDS
========================================================== */

async function handleRefundEvent(
    options
) {
    const orderSnapshot =
        await findOrderForPayment({
            db:
                options.db,
            reference:
                options.reference,
            webhookData:
                options.webhookData
        });

    if (!orderSnapshot) {
        return {
            orderId:
                null,
            ignored:
                true
        };
    }

    const order =
        orderSnapshot.data() || {};

    if (
        order.paymentStatus ===
            PAYMENT_STATUSES.REFUNDED
    ) {
        return {
            orderId:
                orderSnapshot.id,
            ignored:
                true
        };
    }

    const now =
        Timestamp.now();

    await orderSnapshot.ref.set(
        {
            paymentStatus:
                PAYMENT_STATUSES
                    .REFUNDED,

            status:
                ORDER_STATUSES.REFUNDED,

            refundedAt:
                now,

            payment: {
                refund: {
                    provider:
                        options.provider,

                    reference:
                        options.reference ||
                        null,

                    providerRefundId:
                        options.webhookData &&
                        options.webhookData.id
                            ? String(
                                  options
                                      .webhookData.id
                              )
                            : null,

                    processedAt:
                        now
                }
            },

            updatedAt:
                now,

            statusHistory:
                FieldValue.arrayUnion({
                    status:
                        ORDER_STATUSES
                            .REFUNDED,

                    paymentStatus:
                        PAYMENT_STATUSES
                            .REFUNDED,

                    note:
                        "Payment refund confirmed.",

                    source:
                        options.provider,

                    userId:
                        null,

                    createdAt:
                        now
                })
        },
        {
            merge: true
        }
    );

    return {
        orderId:
            orderSnapshot.id,
        ignored:
            false
    };
}

/* ==========================================================
   PAYMENT VALIDATION
========================================================== */

function validateVerifiedPayment(
    options
) {
    const order =
        options.order || {};

    const verification =
        options.verification ||
        {};

    const expectedAmount =
        normalizeMoney(
            order.total
        );

    const receivedAmount =
        normalizeMoney(
            verification.amount
        );

    if (
        Math.abs(
            expectedAmount -
            receivedAmount
        ) > 0.01
    ) {
        throw createServiceError(
            "failed-precondition",
            "The verified payment amount does not match the order total.",
            {
                status: 412,
                details: {
                    expectedAmount:
                        expectedAmount,
                    receivedAmount:
                        receivedAmount
                }
            }
        );
    }

    const expectedCurrency =
        normalizeCurrency(
            order.currency
        );

    const receivedCurrency =
        normalizeCurrency(
            verification.currency
        );

    if (
        expectedCurrency !==
        receivedCurrency
    ) {
        throw createServiceError(
            "failed-precondition",
            "The verified payment currency does not match the order currency.",
            {
                status: 412,
                details: {
                    expectedCurrency:
                        expectedCurrency,
                    receivedCurrency:
                        receivedCurrency
                }
            }
        );
    }

    const expectedReference =
        String(
            order.paymentReference ||
            (
                order.payment &&
                order.payment
                    .providerReference
            ) ||
            ""
        ).trim();

    const receivedReference =
        String(
            verification.reference ||
            ""
        ).trim();

    if (
        expectedReference &&
        receivedReference &&
        expectedReference !==
            receivedReference
    ) {
        throw createServiceError(
            "failed-precondition",
            "The verified payment reference does not match the order.",
            {
                status: 412
            }
        );
    }

    const customerEmail =
        order.customer &&
        order.customer.email
            ? String(
                  order.customer.email
              ).toLowerCase()
            : "";

    if (
        customerEmail &&
        verification.customerEmail &&
        customerEmail !==
            verification.customerEmail
    ) {
        throw createServiceError(
            "failed-precondition",
            "The verified payment customer does not match the order.",
            {
                status: 412
            }
        );
    }

    return true;
}

/* ==========================================================
   ORDER LOOKUP
========================================================== */

async function findOrderForPayment(
    options
) {
    const db =
        options.db;

    const reference =
        String(
            options.reference || ""
        ).trim();

    const metadata =
        options.webhookData &&
        options.webhookData.metadata
            ? options.webhookData
                  .metadata
            : {};

    const meta =
        options.webhookData &&
        options.webhookData.meta
            ? options.webhookData.meta
            : {};

    const orderId =
        String(
            metadata.orderId ||
            meta.orderId ||
            ""
        ).trim();

    if (orderId) {
        const snapshot =
            await db
                .collection(
                    ORDER_COLLECTION
                )
                .doc(orderId)
                .get();

        if (snapshot.exists) {
            return snapshot;
        }
    }

    if (!reference) {
        return null;
    }

    const directReferenceQuery =
        await db
            .collection(
                ORDER_COLLECTION
            )
            .where(
                "paymentReference",
                "==",
                reference
            )
            .limit(1)
            .get();

    if (!directReferenceQuery.empty) {
        return directReferenceQuery
            .docs[0];
    }

    const nestedReferenceQuery =
        await db
            .collection(
                ORDER_COLLECTION
            )
            .where(
                "payment.providerReference",
                "==",
                reference
            )
            .limit(1)
            .get();

    if (!nestedReferenceQuery.empty) {
        return nestedReferenceQuery
            .docs[0];
    }

    return null;
}

/* ==========================================================
   WEBHOOK EVENT STORAGE
========================================================== */

async function registerWebhookEvent(
    options
) {
    await options.reference.set(
        {
            provider:
                options.provider,

            eventType:
                options.eventType ||
                "",

            paymentReference:
                options.paymentReference ||
                null,

            processed:
                false,

            processing:
                true,

            attempts:
                FieldValue.increment(1),

            payload:
                sanitizeWebhookPayload(
                    options.payload
                ),

            receivedAt:
                Timestamp.now(),

            updatedAt:
                Timestamp.now()
        },
        {
            merge: true
        }
    );
}

async function completeWebhookEvent(
    options
) {
    await options.reference.set(
        {
            processed:
                true,

            processing:
                false,

            ignored:
                Boolean(
                    options.ignored
                ),

            orderId:
                options.orderId ||
                null,

            processedAt:
                Timestamp.now(),

            updatedAt:
                Timestamp.now(),

            error:
                FieldValue.delete()
        },
        {
            merge: true
        }
    );
}

async function failWebhookEvent(
    options
) {
    await options.reference.set(
        {
            processed:
                false,

            processing:
                false,

            failedAt:
                Timestamp.now(),

            updatedAt:
                Timestamp.now(),

            error: {
                code:
                    String(
                        options.error &&
                        options.error.code
                            ? options.error
                                  .code
                            : "internal"
                    ).slice(
                        0,
                        100
                    ),

                message:
                    String(
                        options.error &&
                        options.error.message
                            ? options.error
                                  .message
                            : "Webhook processing failed."
                    ).slice(
                        0,
                        500
                    )
            }
        },
        {
            merge: true
        }
    );
}

/* ==========================================================
   HTTP PROVIDER CLIENT
========================================================== */

async function providerRequest(options) {
    const controller =
        new AbortController();

    const timeout =
        setTimeout(
            function () {
                controller.abort();
            },
            Number(
                options.timeout
            ) ||
            DEFAULT_REQUEST_TIMEOUT
        );

    const headers =
        Object.assign(
            {
                Accept:
                    "application/json"
            },
            options.headers || {}
        );

    const requestOptions = {
        method:
            options.method ||
            "GET",

        headers:
            headers,

        signal:
            controller.signal
    };

    if (
        options.body !== undefined
    ) {
        requestOptions.body =
            JSON.stringify(
                options.body
            );

        requestOptions.headers[
            "Content-Type"
        ] = "application/json";
    }

    try {
        const response =
            await fetch(
                options.url,
                requestOptions
            );

        const text =
            await response.text();

        let data = null;

        if (text) {
            try {
                data =
                    JSON.parse(text);
            } catch (error) {
                throw createServiceError(
                    "payment-failed",
                    options.provider +
                        " returned an invalid response.",
                    {
                        status: 502,
                        cause: error
                    }
                );
            }
        }

        if (!response.ok) {
            throw createServiceError(
                mapProviderHttpError(
                    response.status
                ),
                data &&
                data.message
                    ? data.message
                    : options.provider +
                      " rejected the payment request.",
                {
                    status:
                        normalizeProviderStatus(
                            response.status
                        ),

                    details: {
                        provider:
                            options.provider,

                        providerStatus:
                            response.status
                    }
                }
            );
        }

        return data;
    } catch (error) {
        if (
            error &&
            error.name ===
                "AbortError"
        ) {
            throw createServiceError(
                "deadline-exceeded",
                options.provider +
                    " did not respond in time.",
                {
                    status: 504,
                    cause: error
                }
            );
        }

        if (
            error &&
            error.code
        ) {
            throw error;
        }

        throw createServiceError(
            "payment-failed",
            options.provider +
                " could not be reached.",
            {
                status: 502,
                cause: error
            }
        );
    } finally {
        clearTimeout(timeout);
    }
}

/* ==========================================================
   PAYMENT INSTRUMENT SANITIZATION
========================================================== */

function sanitizeAuthorization(
    value
) {
    if (
        !value ||
        typeof value !== "object"
    ) {
        return null;
    }

    return removeUndefined({
        authorizationCode:
            value.authorization_code ||
            null,

        reusable:
            Boolean(value.reusable),

        channel:
            value.channel ||
            null,

        cardType:
            value.card_type ||
            null,

        bank:
            value.bank ||
            null,

        brand:
            value.brand ||
            null,

        countryCode:
            value.country_code ||
            null,

        last4:
            value.last4 ||
            null,

        expiryMonth:
            value.exp_month ||
            null,

        expiryYear:
            value.exp_year ||
            null,

        signature:
            value.signature ||
            null
    });
}

function sanitizeFlutterwavePaymentInstrument(
    value
) {
    if (
        !value ||
        typeof value !== "object"
    ) {
        return null;
    }

    const card =
        value.card &&
        typeof value.card ===
            "object"
            ? value.card
            : {};

    return removeUndefined({
        channel:
            value.payment_type ||
            null,

        cardType:
            card.type ||
            null,

        first6:
            card.first_6digits ||
            null,

        last4:
            card.last_4digits ||
            null,

        issuer:
            card.issuer ||
            null,

        country:
            card.country ||
            null,

        expiry:
            card.expiry ||
            null
    });
}

/* ==========================================================
   WEBHOOK PAYLOAD SANITIZATION
========================================================== */

function sanitizeWebhookPayload(
    value
) {
    const cloned =
        cloneJson(value);

    removeSensitiveFields(
        cloned
    );

    const serialized =
        JSON.stringify(
            cloned
        );

    if (
        serialized.length <=
        200000
    ) {
        return cloned;
    }

    return {
        truncated: true,

        event:
            cloned &&
            cloned.event
                ? cloned.event
                : null,

        data:
            cloned &&
            cloned.data
                ? {
                      id:
                          cloned.data.id ||
                          null,

                      reference:
                          cloned.data
                              .reference ||
                          cloned.data
                              .tx_ref ||
                          null,

                      status:
                          cloned.data.status ||
                          null
                  }
                : null
    };
}

function removeSensitiveFields(
    value
) {
    if (
        !value ||
        typeof value !== "object"
    ) {
        return;
    }

    const sensitiveKeys =
        new Set([
            "authorization_code",
            "authorization",
            "card",
            "card_number",
            "cvv",
            "pin",
            "otp",
            "token",
            "access_token",
            "secret",
            "secret_key"
        ]);

    Object.keys(value).forEach(
        function (key) {
            if (
                sensitiveKeys.has(
                    key.toLowerCase()
                )
            ) {
                delete value[key];

                return;
            }

            removeSensitiveFields(
                value[key]
            );
        }
    );
}

/* ==========================================================
   GENERAL HELPERS
========================================================== */

function normalizeProvider(value) {
    const provider =
        String(value || "")
            .trim()
            .toLowerCase();

    if (
        provider === "paystack" ||
        provider === "flutterwave"
    ) {
        return provider;
    }

    return provider;
}

function requireProviderSecret(
    value,
    providerName
) {
    const secret =
        String(value || "")
            .trim();

    if (!secret) {
        throw createServiceError(
            "failed-precondition",
            providerName +
                " credentials are not configured.",
            {
                status: 503
            }
        );
    }

    return secret;
}

function createPaymentReference(
    prefix,
    orderId
) {
    const safeOrderId =
        String(orderId || "")
            .replace(
                /[^A-Za-z0-9]/g,
                ""
            )
            .slice(-16)
            .toUpperCase();

    const timestamp =
        Date.now()
            .toString(36)
            .toUpperCase();

    const random =
        crypto
            .randomBytes(4)
            .toString("hex")
            .toUpperCase();

    return [
        prefix,
        safeOrderId,
        timestamp,
        random
    ]
        .filter(Boolean)
        .join("-");
}

function createWebhookEventId(
    options
) {
    const source = [
        options.provider,
        options.eventType,
        options.reference,
        options.providerId
    ].join(":");

    return crypto
        .createHash("sha256")
        .update(source)
        .digest("hex");
}

function normalizeWebhookBody(
    request
) {
    if (
        request &&
        request.body &&
        typeof request.body ===
            "object" &&
        !Buffer.isBuffer(
            request.body
        )
    ) {
        return request.body;
    }

    const rawBody =
        getRawRequestBody(
            request
        );

    try {
        return JSON.parse(
            rawBody.toString(
                "utf8"
            )
        );
    } catch (error) {
        throw createServiceError(
            "invalid-argument",
            "The webhook body contains invalid JSON.",
            {
                status: 400,
                cause: error
            }
        );
    }
}

function getRawRequestBody(
    request
) {
    if (
        request &&
        Buffer.isBuffer(
            request.rawBody
        )
    ) {
        return request.rawBody;
    }

    if (
        request &&
        Buffer.isBuffer(
            request.body
        )
    ) {
        return request.body;
    }

    if (
        request &&
        typeof request.body ===
            "string"
    ) {
        return Buffer.from(
            request.body,
            "utf8"
        );
    }

    return Buffer.from(
        JSON.stringify(
            request &&
            request.body
                ? request.body
                : {}
        ),
        "utf8"
    );
}

function getHeader(
    request,
    name
) {
    if (
        !request ||
        !request.headers
    ) {
        return "";
    }

    const value =
        request.headers[
            String(name)
                .toLowerCase()
        ];

    if (Array.isArray(value)) {
        return value.join(", ");
    }

    return value === undefined
        ? ""
        : String(value).trim();
}

function safeCompare(
    first,
    second
) {
    const firstBuffer =
        Buffer.from(
            String(first || ""),
            "utf8"
        );

    const secondBuffer =
        Buffer.from(
            String(second || ""),
            "utf8"
        );

    if (
        firstBuffer.length !==
        secondBuffer.length
    ) {
        return false;
    }

    return crypto.timingSafeEqual(
        firstBuffer,
        secondBuffer
    );
}

function toMinorUnits(
    amount,
    currency
) {
    const value =
        normalizeMoney(
            amount
        );

    const zeroDecimalCurrencies =
        new Set([
            "BIF",
            "CLP",
            "DJF",
            "GNF",
            "JPY",
            "KMF",
            "KRW",
            "MGA",
            "PYG",
            "RWF",
            "UGX",
            "VND",
            "VUV",
            "XAF",
            "XOF",
            "XPF"
        ]);

    const multiplier =
        zeroDecimalCurrencies.has(
            normalizeCurrency(
                currency
            )
        )
            ? 1
            : 100;

    return Math.round(
        value * multiplier
    );
}

function fromMinorUnits(
    amount,
    currency
) {
    const number =
        Number(amount);

    if (
        !Number.isFinite(number)
    ) {
        return 0;
    }

    const zeroDecimalCurrencies =
        new Set([
            "BIF",
            "CLP",
            "DJF",
            "GNF",
            "JPY",
            "KMF",
            "KRW",
            "MGA",
            "PYG",
            "RWF",
            "UGX",
            "VND",
            "VUV",
            "XAF",
            "XOF",
            "XPF"
        ]);

    const divisor =
        zeroDecimalCurrencies.has(
            normalizeCurrency(
                currency
            )
        )
            ? 1
            : 100;

    return normalizeMoney(
        number / divisor
    );
}

function normalizeMoney(value) {
    const number =
        Number(value);

    if (
        !Number.isFinite(number) ||
        number < 0
    ) {
        throw createServiceError(
            "failed-precondition",
            "The payment amount is invalid.",
            {
                status: 412
            }
        );
    }

    return Math.round(
        (
            number +
            Number.EPSILON
        ) * 100
    ) / 100;
}

function normalizeCurrency(value) {
    const currency =
        String(value || "")
            .trim()
            .toUpperCase();

    if (
        !/^[A-Z]{3}$/.test(
            currency
        )
    ) {
        throw createServiceError(
            "failed-precondition",
            "The payment currency is invalid.",
            {
                status: 412
            }
        );
    }

    return currency;
}

function buildCallbackUrl(
    origin,
    path
) {
    const base =
        String(origin || "")
            .trim()
            .replace(/\/+$/, "");

    if (!base) {
        return "";
    }

    return (
        base +
        "/" +
        String(path || "")
            .replace(/^\/+/, "")
    );
}

function mapProviderHttpError(
    status
) {
    if (status === 401) {
        return "permission-denied";
    }

    if (status === 404) {
        return "not-found";
    }

    if (status === 409) {
        return "aborted";
    }

    if (status === 429) {
        return "resource-exhausted";
    }

    if (status >= 500) {
        return "unavailable";
    }

    return "payment-failed";
}

function normalizeProviderStatus(
    status
) {
    if (status === 401) {
        return 502;
    }

    if (
        Number.isInteger(status) &&
        status >= 400 &&
        status <= 599
    ) {
        return status;
    }

    return 502;
}

function toTimestamp(value) {
    if (
        value instanceof Timestamp
    ) {
        return value;
    }

    if (
        value instanceof Date
    ) {
        return Timestamp.fromDate(
            value
        );
    }

    const date =
        new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        return Timestamp.now();
    }

    return Timestamp.fromDate(
        date
    );
}

function firstDefined() {
    for (
        let index = 0;
        index < arguments.length;
        index += 1
    ) {
        if (
            arguments[index] !==
                undefined &&
            arguments[index] !==
                null
        ) {
            return arguments[index];
        }
    }

    return undefined;
}

function removeUndefined(value) {
    if (Array.isArray(value)) {
        return value
            .map(removeUndefined)
            .filter(function (item) {
                return item !==
                    undefined;
            });
    }

    if (
        value &&
        typeof value === "object"
    ) {
        return Object.keys(value)
            .reduce(
                function (
                    output,
                    key
                ) {
                    const normalized =
                        removeUndefined(
                            value[key]
                        );

                    if (
                        normalized !==
                        undefined
                    ) {
                        output[key] =
                            normalized;
                    }

                    return output;
                },
                {}
            );
    }

    return value === undefined
        ? undefined
        : value;
}

function cloneJson(value) {
    try {
        return JSON.parse(
            JSON.stringify(
                value || {}
            )
        );
    } catch (error) {
        return {};
    }
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    initializePayment:
        initializePayment,

    initializePaystackPayment:
        initializePaystackPayment,

    initializeFlutterwavePayment:
        initializeFlutterwavePayment,

    resolveWebhookProvider:
        resolveWebhookProvider,

    processWebhook:
        processWebhook,

    processPaystackWebhook:
        processPaystackWebhook,

    processFlutterwaveWebhook:
        processFlutterwaveWebhook,

    verifyPayment:
        verifyPayment,

    verifyPaystackPayment:
        verifyPaystackPayment,

    verifyFlutterwavePayment:
        verifyFlutterwavePayment,

    verifyPaystackWebhookSignature:
        verifyPaystackWebhookSignature,

    verifyFlutterwaveWebhookSignature:
        verifyFlutterwaveWebhookSignature,

    handleSuccessfulPayment:
        handleSuccessfulPayment,

    handleFailedPayment:
        handleFailedPayment,

    handleRefundEvent:
        handleRefundEvent,

    validateVerifiedPayment:
        validateVerifiedPayment,

    findOrderForPayment:
        findOrderForPayment,

    constants: {
        PAYSTACK_API_BASE:
            PAYSTACK_API_BASE,

        FLUTTERWAVE_API_BASE:
            FLUTTERWAVE_API_BASE,

        PAYMENT_STATUSES:
            PAYMENT_STATUSES,

        ORDER_STATUSES:
            ORDER_STATUSES
    },

    _internal: {
        providerRequest:
            providerRequest,

        getRawRequestBody:
            getRawRequestBody,

        normalizeWebhookBody:
            normalizeWebhookBody,

        createPaymentReference:
            createPaymentReference,

        createWebhookEventId:
            createWebhookEventId,

        sanitizeAuthorization:
            sanitizeAuthorization,

        sanitizeWebhookPayload:
            sanitizeWebhookPayload,

        toMinorUnits:
            toMinorUnits,

        fromMinorUnits:
            fromMinorUnits,

        safeCompare:
            safeCompare
    }
};