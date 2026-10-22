"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   TRANSACTIONAL EMAIL SERVICE
========================================================== */

const {
    createServiceError,
    normalizeEmail,
    normalizeString
} = require("../shared/validation");

/* ==========================================================
   CONSTANTS
========================================================== */

const DEFAULT_REQUEST_TIMEOUT =
    15000;

const DEFAULT_PROVIDER =
    "resend";

const PROVIDER_ENDPOINTS = {
    resend:
        "https://api.resend.com/emails",

    sendgrid:
        "https://api.sendgrid.com/v3/mail/send"
};

/* ==========================================================
   ORDER CONFIRMATION
========================================================== */

async function sendOrderConfirmation(options) {
    const settings =
        options || {};

    const order =
        settings.order || {};

    const configuration =
        settings.configuration || {};

    const recipient =
        normalizeEmail(
            order.customerEmail ||
            (
                order.customer &&
                order.customer.email
            ),
            true
        );

    const storeName =
        normalizeString(
            configuration.storeName ||
            "L'ÉTERNEL",
            {
                fieldName:
                    "Store name",
                required: true,
                maximumLength: 200
            }
        );

    const from =
        normalizeSender(
            configuration.from,
            storeName
        );

    const provider =
        normalizeProvider(
            configuration.provider ||
            process.env.EMAIL_PROVIDER ||
            DEFAULT_PROVIDER
        );

    const apiKey =
        requireEmailApiKey(
            configuration.apiKey
        );

    const subject =
        buildOrderConfirmationSubject({
            storeName:
                storeName,
            order:
                order
        });

    const template =
        buildOrderConfirmationTemplate({
            order:
                order,
            storeName:
                storeName,
            appOrigin:
                configuration.appOrigin ||
                ""
        });

    return sendEmail({
        provider:
            provider,
        apiKey:
            apiKey,
        from:
            from,
        to:
            recipient,
        subject:
            subject,
        html:
            template.html,
        text:
            template.text,
        metadata: {
            type:
                "order-confirmation",
            orderId:
                order.id ||
                null,
            orderNumber:
                order.orderNumber ||
                null
        }
    });
}

/* ==========================================================
   ORDER STATUS EMAIL
========================================================== */

async function sendOrderStatusUpdate(options) {
    const settings =
        options || {};

    const order =
        settings.order || {};

    const configuration =
        settings.configuration || {};

    const recipient =
        normalizeEmail(
            order.customerEmail ||
            (
                order.customer &&
                order.customer.email
            ),
            true
        );

    const storeName =
        normalizeString(
            configuration.storeName ||
            "L'ÉTERNEL",
            {
                fieldName:
                    "Store name",
                required: true,
                maximumLength: 200
            }
        );

    const provider =
        normalizeProvider(
            configuration.provider ||
            process.env.EMAIL_PROVIDER ||
            DEFAULT_PROVIDER
        );

    const from =
        normalizeSender(
            configuration.from,
            storeName
        );

    const apiKey =
        requireEmailApiKey(
            configuration.apiKey
        );

    const template =
        buildOrderStatusTemplate({
            order:
                order,
            storeName:
                storeName,
            appOrigin:
                configuration.appOrigin ||
                ""
        });

    return sendEmail({
        provider:
            provider,
        apiKey:
            apiKey,
        from:
            from,
        to:
            recipient,
        subject:
            template.subject,
        html:
            template.html,
        text:
            template.text,
        metadata: {
            type:
                "order-status-update",
            orderId:
                order.id ||
                null,
            orderNumber:
                order.orderNumber ||
                null,
            status:
                order.status ||
                null
        }
    });
}

/* ==========================================================
   PAYMENT RECEIPT
========================================================== */

async function sendPaymentReceipt(options) {
    const settings =
        options || {};

    const order =
        settings.order || {};

    const configuration =
        settings.configuration || {};

    const recipient =
        normalizeEmail(
            order.customerEmail ||
            (
                order.customer &&
                order.customer.email
            ),
            true
        );

    const storeName =
        normalizeString(
            configuration.storeName ||
            "L'ÉTERNEL",
            {
                fieldName:
                    "Store name",
                required: true,
                maximumLength: 200
            }
        );

    const provider =
        normalizeProvider(
            configuration.provider ||
            process.env.EMAIL_PROVIDER ||
            DEFAULT_PROVIDER
        );

    const from =
        normalizeSender(
            configuration.from,
            storeName
        );

    const apiKey =
        requireEmailApiKey(
            configuration.apiKey
        );

    const template =
        buildPaymentReceiptTemplate({
            order:
                order,
            storeName:
                storeName,
            appOrigin:
                configuration.appOrigin ||
                ""
        });

    return sendEmail({
        provider:
            provider,
        apiKey:
            apiKey,
        from:
            from,
        to:
            recipient,
        subject:
            template.subject,
        html:
            template.html,
        text:
            template.text,
        metadata: {
            type:
                "payment-receipt",
            orderId:
                order.id ||
                null,
            orderNumber:
                order.orderNumber ||
                null
        }
    });
}

/* ==========================================================
   GENERIC EMAIL SENDER
========================================================== */

async function sendEmail(options) {
    const settings =
        options || {};

    const provider =
        normalizeProvider(
            settings.provider
        );

    if (provider === "resend") {
        return sendWithResend(
            settings
        );
    }

    if (provider === "sendgrid") {
        return sendWithSendGrid(
            settings
        );
    }

    throw createServiceError(
        "failed-precondition",
        "The configured email provider is unsupported.",
        {
            status: 503,
            details: {
                provider:
                    provider
            }
        }
    );
}

/* ==========================================================
   RESEND
========================================================== */

async function sendWithResend(options) {
    const payload = {
        from:
            options.from,
        to: [
            options.to
        ],
        subject:
            options.subject,
        html:
            options.html,
        text:
            options.text,

        headers: {
            "X-Entity-Ref-ID":
                buildEntityReference(
                    options.metadata
                )
        },

        tags:
            buildResendTags(
                options.metadata
            )
    };

    const result =
        await emailProviderRequest({
            url:
                PROVIDER_ENDPOINTS
                    .resend,

            method:
                "POST",

            headers: {
                Authorization:
                    "Bearer " +
                    options.apiKey
            },

            body:
                payload,

            provider:
                "Resend"
        });

    if (
        !result ||
        !result.id
    ) {
        throw createServiceError(
            "unavailable",
            "The email provider did not confirm delivery.",
            {
                status: 502
            }
        );
    }

    return {
        success: true,
        provider:
            "resend",
        messageId:
            result.id,
        recipient:
            options.to
    };
}

/* ==========================================================
   SENDGRID
========================================================== */

async function sendWithSendGrid(options) {
    const payload = {
        personalizations: [
            {
                to: [
                    {
                        email:
                            options.to
                    }
                ],

                subject:
                    options.subject,

                custom_args:
                    sanitizeMetadata(
                        options.metadata
                    )
            }
        ],

        from:
            parseSender(
                options.from
            ),

        content: [
            {
                type:
                    "text/plain",
                value:
                    options.text
            },
            {
                type:
                    "text/html",
                value:
                    options.html
            }
        ]
    };

    const result =
        await emailProviderRequest({
            url:
                PROVIDER_ENDPOINTS
                    .sendgrid,

            method:
                "POST",

            headers: {
                Authorization:
                    "Bearer " +
                    options.apiKey
            },

            body:
                payload,

            provider:
                "SendGrid",

            allowEmptyResponse:
                true
        });

    return {
        success: true,
        provider:
            "sendgrid",
        messageId:
            result &&
            result.messageId
                ? result.messageId
                : null,
        recipient:
            options.to
    };
}

/* ==========================================================
   EMAIL PROVIDER REQUEST
========================================================== */

async function emailProviderRequest(options) {
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

    try {
        const response =
            await fetch(
                options.url,
                {
                    method:
                        options.method ||
                        "POST",

                    headers:
                        Object.assign(
                            {
                                Accept:
                                    "application/json",
                                "Content-Type":
                                    "application/json"
                            },
                            options.headers ||
                            {}
                        ),

                    body:
                        JSON.stringify(
                            options.body ||
                            {}
                        ),

                    signal:
                        controller.signal
                }
            );

        const responseText =
            await response.text();

        let responseData =
            null;

        if (responseText) {
            try {
                responseData =
                    JSON.parse(
                        responseText
                    );
            } catch (error) {
                responseData = {
                    raw:
                        responseText
                };
            }
        }

        if (!response.ok) {
            throw createServiceError(
                mapProviderStatusToCode(
                    response.status
                ),
                extractProviderMessage(
                    responseData,
                    options.provider
                ),
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

        if (
            !responseData &&
            options.allowEmptyResponse
        ) {
            return {
                messageId:
                    response.headers.get(
                        "x-message-id"
                    ) ||
                    null
            };
        }

        return responseData || {};
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
                    cause:
                        error
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
            "unavailable",
            options.provider +
                " could not be reached.",
            {
                status: 502,
                cause:
                    error
            }
        );
    } finally {
        clearTimeout(timeout);
    }
}

/* ==========================================================
   ORDER CONFIRMATION TEMPLATE
========================================================== */

function buildOrderConfirmationTemplate(options) {
    const order =
        options.order || {};

    const storeName =
        options.storeName;

    const customerName =
        resolveCustomerName(
            order
        );

    const orderNumber =
        order.orderNumber ||
        order.id ||
        "Order";

    const currency =
        order.currency ||
        "NGN";

    const items =
        Array.isArray(
            order.items
        )
            ? order.items
            : [];

    const orderUrl =
        buildOrderUrl(
            options.appOrigin,
            order.id
        );

    const itemRows =
        items.map(
            function (item) {
                return buildItemRow({
                    item:
                        item,
                    currency:
                        currency
                });
            }
        ).join("");

    const textItems =
        items.map(
            function (item) {
                return [
                    item.name ||
                        "Product",
                    "× " +
                        Number(
                            item.quantity ||
                            0
                        ),
                    formatCurrency(
                        item.lineTotal ||
                        (
                            Number(
                                item.price ||
                                0
                            ) *
                            Number(
                                item.quantity ||
                                0
                            )
                        ),
                        currency
                    )
                ].join(" — ");
            }
        ).join("\n");

    const html =
        wrapEmailLayout({
            storeName:
                storeName,

            preheader:
                "Your order has been received.",

            body: [
                '<h1 style="' +
                    headingStyle() +
                    '">Thank you for your order.</h1>',

                '<p style="' +
                    paragraphStyle() +
                    '">Dear ' +
                    escapeHTML(
                        customerName
                    ) +
                    ",</p>",

                '<p style="' +
                    paragraphStyle() +
                    '">' +
                    escapeHTML(
                        storeName
                    ) +
                    " has received your order <strong>" +
                    escapeHTML(
                        orderNumber
                    ) +
                    "</strong>.</p>",

                buildStatusPanel(
                    order
                ),

                '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:30px 0;border-collapse:collapse;">' +
                    itemRows +
                    "</table>",

                buildTotalsTable(
                    order,
                    currency
                ),

                buildAddressSection(
                    order
                ),

                orderUrl
                    ? buildButton(
                          "View your order",
                          orderUrl
                      )
                    : "",

                '<p style="' +
                    mutedParagraphStyle() +
                    '">We will send another message when your order status changes.</p>'
            ].join("")
        });

    const text = [
        storeName,
        "",
        "Thank you for your order.",
        "",
        "Dear " +
            customerName +
            ",",
        "",
        "We have received order " +
            orderNumber +
            ".",
        "",
        textItems,
        "",
        "Subtotal: " +
            formatCurrency(
                order.subtotal,
                currency
            ),
        "Discount: " +
            formatCurrency(
                order.discount,
                currency
            ),
        "Delivery: " +
            formatCurrency(
                order.deliveryFee,
                currency
            ),
        "Tax: " +
            formatCurrency(
                order.tax,
                currency
            ),
        "Total: " +
            formatCurrency(
                order.total,
                currency
            ),
        "",
        orderUrl
            ? "View your order: " +
              orderUrl
            : "",
        "",
        "Thank you for choosing " +
            storeName +
            "."
    ]
        .filter(
            function (line) {
                return line !== "";
            }
        )
        .join("\n");

    return {
        html:
            html,
        text:
            text
    };
}

/* ==========================================================
   ORDER STATUS TEMPLATE
========================================================== */

function buildOrderStatusTemplate(options) {
    const order =
        options.order || {};

    const storeName =
        options.storeName;

    const statusLabel =
        formatStatus(
            order.status
        );

    const orderNumber =
        order.orderNumber ||
        order.id ||
        "Order";

    const orderUrl =
        buildOrderUrl(
            options.appOrigin,
            order.id
        );

    const subject =
        orderNumber +
        " — " +
        statusLabel;

    const html =
        wrapEmailLayout({
            storeName:
                storeName,

            preheader:
                "Your order status has changed.",

            body: [
                '<h1 style="' +
                    headingStyle() +
                    '">Your order is now ' +
                    escapeHTML(
                        statusLabel.toLowerCase()
                    ) +
                    ".</h1>",

                '<p style="' +
                    paragraphStyle() +
                    '">Order <strong>' +
                    escapeHTML(
                        orderNumber
                    ) +
                    "</strong> has been updated.</p>",

                buildStatusPanel(
                    order
                ),

                orderUrl
                    ? buildButton(
                          "View order details",
                          orderUrl
                      )
                    : "",

                '<p style="' +
                    mutedParagraphStyle() +
                    '">Thank you for choosing ' +
                    escapeHTML(
                        storeName
                    ) +
                    ".</p>"
            ].join("")
        });

    const text = [
        storeName,
        "",
        "Order update",
        "",
        "Order: " +
            orderNumber,
        "Status: " +
            statusLabel,
        "Payment: " +
            formatStatus(
                order.paymentStatus
            ),
        "",
        orderUrl
            ? "View order: " +
              orderUrl
            : ""
    ]
        .filter(Boolean)
        .join("\n");

    return {
        subject:
            subject,
        html:
            html,
        text:
            text
    };
}

/* ==========================================================
   PAYMENT RECEIPT TEMPLATE
========================================================== */

function buildPaymentReceiptTemplate(options) {
    const order =
        options.order || {};

    const storeName =
        options.storeName;

    const currency =
        order.currency ||
        "NGN";

    const orderNumber =
        order.orderNumber ||
        order.id ||
        "Order";

    const orderUrl =
        buildOrderUrl(
            options.appOrigin,
            order.id
        );

    const reference =
        order.paymentReference ||
        (
            order.payment &&
            order.payment
                .providerReference
        ) ||
        "";

    const subject =
        "Payment received — " +
        orderNumber;

    const html =
        wrapEmailLayout({
            storeName:
                storeName,

            preheader:
                "Your payment has been received.",

            body: [
                '<h1 style="' +
                    headingStyle() +
                    '">Payment received.</h1>',

                '<p style="' +
                    paragraphStyle() +
                    '">We have received your payment for order <strong>' +
                    escapeHTML(
                        orderNumber
                    ) +
                    "</strong>.</p>",

                '<div style="margin:28px 0;padding:24px;border:1px solid #e4e1dc;background:#faf9f7;">',

                '<p style="' +
                    labelStyle() +
                    '">AMOUNT</p>',

                '<p style="margin:4px 0 18px;font-family:Georgia,serif;font-size:30px;line-height:1.2;color:#191714;">' +
                    escapeHTML(
                        formatCurrency(
                            order.total,
                            currency
                        )
                    ) +
                    "</p>",

                reference
                    ? '<p style="' +
                      labelStyle() +
                      '">REFERENCE</p><p style="' +
                      paragraphStyle() +
                      '">' +
                      escapeHTML(
                          reference
                      ) +
                      "</p>"
                    : "",

                "</div>",

                orderUrl
                    ? buildButton(
                          "View order",
                          orderUrl
                      )
                    : ""
            ].join("")
        });

    const text = [
        storeName,
        "",
        "Payment received",
        "",
        "Order: " +
            orderNumber,
        "Amount: " +
            formatCurrency(
                order.total,
                currency
            ),
        reference
            ? "Reference: " +
              reference
            : "",
        "",
        orderUrl
            ? "View order: " +
              orderUrl
            : ""
    ]
        .filter(Boolean)
        .join("\n");

    return {
        subject:
            subject,
        html:
            html,
        text:
            text
    };
}

/* ==========================================================
   EMAIL COMPONENTS
========================================================== */

function wrapEmailLayout(options) {
    return [
        "<!doctype html>",
        '<html lang="en">',
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        "<title>",
        escapeHTML(
            options.storeName
        ),
        "</title>",
        "</head>",

        '<body style="margin:0;padding:0;background:#f4f2ee;color:#191714;">',

        '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">',
        escapeHTML(
            options.preheader ||
            ""
        ),
        "</div>",

        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee;padding:32px 12px;">',
        "<tr>",
        '<td align="center">',

        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border:1px solid #e4e1dc;">',

        "<tr>",
        '<td style="padding:30px 40px;border-bottom:1px solid #e4e1dc;text-align:center;">',
        '<p style="margin:0;font-family:Georgia,serif;font-size:26px;letter-spacing:5px;color:#191714;">',
        escapeHTML(
            options.storeName
        ),
        "</p>",
        "</td>",
        "</tr>",

        "<tr>",
        '<td style="padding:46px 40px;">',
        options.body,
        "</td>",
        "</tr>",

        "<tr>",
        '<td style="padding:24px 40px;background:#191714;text-align:center;">',
        '<p style="margin:0;font-family:Arial,sans-serif;font-size:12px;line-height:1.7;color:#c7c1b8;">',
        "© ",
        String(
            new Date().getUTCFullYear()
        ),
        " ",
        escapeHTML(
            options.storeName
        ),
        ". All rights reserved.",
        "</p>",
        "</td>",
        "</tr>",

        "</table>",
        "</td>",
        "</tr>",
        "</table>",
        "</body>",
        "</html>"
    ].join("");
}

function buildItemRow(options) {
    const item =
        options.item || {};

    const currency =
        options.currency;

    const image =
        item.image
            ? '<img src="' +
              escapeAttribute(
                  item.image
              ) +
              '" alt="" width="72" height="90" style="display:block;width:72px;height:90px;object-fit:cover;background:#f1efeb;">'
            : '<div style="width:72px;height:90px;background:#f1efeb;"></div>';

    const variant =
        [
            item.variantName,
            item.color,
            item.size
        ]
            .filter(Boolean)
            .filter(
                function (
                    value,
                    index,
                    values
                ) {
                    return (
                        values.indexOf(
                            value
                        ) === index
                    );
                }
            )
            .join(" · ");

    return [
        "<tr>",
        '<td width="88" valign="top" style="padding:14px 0;border-bottom:1px solid #ece9e4;">',
        image,
        "</td>",

        '<td valign="top" style="padding:14px 10px;border-bottom:1px solid #ece9e4;">',
        '<p style="margin:0 0 6px;font-family:Georgia,serif;font-size:17px;line-height:1.4;color:#191714;">',
        escapeHTML(
            item.name ||
            "Product"
        ),
        "</p>",

        variant
            ? '<p style="' +
              mutedParagraphStyle() +
              '">' +
              escapeHTML(
                  variant
              ) +
              "</p>"
            : "",

        '<p style="' +
            mutedParagraphStyle() +
            '">Quantity: ' +
            escapeHTML(
                item.quantity ||
                0
            ) +
            "</p>",
        "</td>",

        '<td width="120" align="right" valign="top" style="padding:14px 0;border-bottom:1px solid #ece9e4;">',
        '<p style="' +
            paragraphStyle() +
            '">',
        escapeHTML(
            formatCurrency(
                item.lineTotal ||
                (
                    Number(
                        item.price ||
                        0
                    ) *
                    Number(
                        item.quantity ||
                        0
                    )
                ),
                currency
            )
        ),
        "</p>",
        "</td>",
        "</tr>"
    ].join("");
}

function buildTotalsTable(
    order,
    currency
) {
    const rows = [
        [
            "Subtotal",
            order.subtotal
        ],
        [
            "Discount",
            -Math.abs(
                Number(
                    order.discount ||
                    0
                )
            )
        ],
        [
            "Delivery",
            order.deliveryFee
        ],
        [
            "Tax",
            order.tax
        ]
    ];

    const body =
        rows.map(
            function (row) {
                return [
                    "<tr>",
                    '<td style="padding:6px 0;font-family:Arial,sans-serif;font-size:14px;color:#6f6961;">',
                    escapeHTML(
                        row[0]
                    ),
                    "</td>",
                    '<td align="right" style="padding:6px 0;font-family:Arial,sans-serif;font-size:14px;color:#191714;">',
                    escapeHTML(
                        formatCurrency(
                            row[1],
                            currency
                        )
                    ),
                    "</td>",
                    "</tr>"
                ].join("");
            }
        ).join("");

    return [
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 32px;">',
        body,
        "<tr>",
        '<td style="padding:16px 0 0;border-top:1px solid #191714;font-family:Georgia,serif;font-size:19px;color:#191714;">Total</td>',
        '<td align="right" style="padding:16px 0 0;border-top:1px solid #191714;font-family:Georgia,serif;font-size:19px;color:#191714;">',
        escapeHTML(
            formatCurrency(
                order.total,
                currency
            )
        ),
        "</td>",
        "</tr>",
        "</table>"
    ].join("");
}

function buildStatusPanel(order) {
    return [
        '<div style="margin:26px 0;padding:20px;background:#faf9f7;border-left:3px solid #9a7d4f;">',

        '<p style="' +
            labelStyle() +
            '">ORDER STATUS</p>',

        '<p style="margin:5px 0 16px;font-family:Georgia,serif;font-size:20px;color:#191714;">',
        escapeHTML(
            formatStatus(
                order.status
            )
        ),
        "</p>",

        '<p style="' +
            labelStyle() +
            '">PAYMENT</p>',

        '<p style="margin:5px 0 0;font-family:Arial,sans-serif;font-size:15px;color:#191714;">',
        escapeHTML(
            formatStatus(
                order.paymentStatus
            )
        ),
        "</p>",

        "</div>"
    ].join("");
}

function buildAddressSection(order) {
    const address =
        order.shippingAddress;

    if (!address) {
        return "";
    }

    const lines = [
        [
            address.firstName,
            address.lastName
        ]
            .filter(Boolean)
            .join(" "),

        address.company,
        address.addressLine1,
        address.addressLine2,

        [
            address.city,
            address.state,
            address.postalCode
        ]
            .filter(Boolean)
            .join(", "),

        address.country,
        address.phone
    ].filter(Boolean);

    return [
        '<div style="margin:32px 0;">',

        '<p style="' +
            labelStyle() +
            '">DELIVERY ADDRESS</p>',

        '<p style="' +
            paragraphStyle() +
            '">',
        lines
            .map(
                function (line) {
                    return escapeHTML(
                        line
                    );
                }
            )
            .join("<br>"),
        "</p>",

        "</div>"
    ].join("");
}

function buildButton(
    label,
    url
) {
    return [
        '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:32px 0;">',
        "<tr>",
        '<td style="background:#191714;">',
        '<a href="' +
            escapeAttribute(
                url
            ) +
            '" style="display:inline-block;padding:15px 26px;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;letter-spacing:1.5px;text-decoration:none;text-transform:uppercase;color:#ffffff;">',
        escapeHTML(
            label
        ),
        "</a>",
        "</td>",
        "</tr>",
        "</table>"
    ].join("");
}

/* ==========================================================
   FORMATTING
========================================================== */

function buildOrderConfirmationSubject(
    options
) {
    return (
        "Order received — " +
        (
            options.order
                .orderNumber ||
            options.order.id ||
            options.storeName
        )
    );
}

function resolveCustomerName(order) {
    const customer =
        order.customer || {};

    return (
        customer.displayName ||
        [
            customer.firstName,
            customer.lastName
        ]
            .filter(Boolean)
            .join(" ") ||
        "Customer"
    );
}

function formatCurrency(
    value,
    currency
) {
    const amount =
        Number(value || 0);

    try {
        return new Intl.NumberFormat(
            "en-NG",
            {
                style:
                    "currency",
                currency:
                    String(
                        currency ||
                        "NGN"
                    ).toUpperCase(),
                maximumFractionDigits:
                    2
            }
        ).format(amount);
    } catch (error) {
        return (
            String(
                currency ||
                "NGN"
            ).toUpperCase() +
            " " +
            amount.toFixed(2)
        );
    }
}

function formatStatus(value) {
    return String(value || "Pending")
        .replace(/[-_]+/g, " ")
        .replace(
            /\b\w/g,
            function (character) {
                return character
                    .toUpperCase();
            }
        );
}

function buildOrderUrl(
    origin,
    orderId
) {
    const base =
        String(origin || "")
            .trim()
            .replace(/\/+$/, "");

    if (
        !base ||
        !orderId
    ) {
        return "";
    }

    return (
        base +
        "/account/orders/" +
        encodeURIComponent(
            orderId
        )
    );
}

/* ==========================================================
   PROVIDER HELPERS
========================================================== */

function normalizeProvider(value) {
    return String(value || "")
        .trim()
        .toLowerCase();
}

function requireEmailApiKey(value) {
    const apiKey =
        String(value || "")
            .trim();

    if (!apiKey) {
        throw createServiceError(
            "failed-precondition",
            "The transactional email service is not configured.",
            {
                status: 503
            }
        );
    }

    return apiKey;
}

function normalizeSender(
    value,
    storeName
) {
    const sender =
        String(value || "")
            .trim();

    if (!sender) {
        throw createServiceError(
            "failed-precondition",
            "The transactional email sender is not configured.",
            {
                status: 503
            }
        );
    }

    if (
        sender.includes("<") &&
        sender.includes(">")
    ) {
        return sender;
    }

    normalizeEmail(
        sender,
        true
    );

    return (
        storeName +
        " <" +
        sender +
        ">"
    );
}

function parseSender(value) {
    const sender =
        String(value || "")
            .trim();

    const match =
        sender.match(
            /^(.*?)\s*<([^>]+)>$/
        );

    if (!match) {
        return {
            email:
                sender
        };
    }

    return {
        name:
            match[1].trim(),
        email:
            match[2].trim()
    };
}

function buildResendTags(metadata) {
    const safe =
        sanitizeMetadata(
            metadata
        );

    return Object.keys(safe)
        .slice(0, 10)
        .map(function (key) {
            return {
                name:
                    String(key)
                        .replace(
                            /[^A-Za-z0-9_-]/g,
                            "-"
                        )
                        .slice(0, 256),

                value:
                    String(
                        safe[key]
                    )
                        .replace(
                            /[^A-Za-z0-9_-]/g,
                            "-"
                        )
                        .slice(0, 256)
            };
        });
}

function sanitizeMetadata(value) {
    const source =
        value &&
        typeof value ===
            "object"
            ? value
            : {};

    return Object.keys(source)
        .reduce(
            function (
                output,
                key
            ) {
                const item =
                    source[key];

                if (
                    item !== undefined &&
                    item !== null &&
                    (
                        typeof item ===
                            "string" ||
                        typeof item ===
                            "number" ||
                        typeof item ===
                            "boolean"
                    )
                ) {
                    output[key] =
                        String(item)
                            .slice(
                                0,
                                500
                            );
                }

                return output;
            },
            {}
        );
}

function buildEntityReference(
    metadata
) {
    const safe =
        sanitizeMetadata(
            metadata
        );

    return [
        safe.type ||
            "email",
        safe.orderId ||
            safe.orderNumber ||
            Date.now()
    ].join("-");
}

function extractProviderMessage(
    response,
    provider
) {
    if (!response) {
        return (
            provider +
            " rejected the email request."
        );
    }

    if (
        typeof response.message ===
        "string"
    ) {
        return response.message;
    }

    if (
        response.error &&
        typeof response.error
            .message ===
            "string"
    ) {
        return response.error
            .message;
    }

    if (
        Array.isArray(
            response.errors
        ) &&
        response.errors[0] &&
        response.errors[0].message
    ) {
        return response.errors[0]
            .message;
    }

    return (
        provider +
        " rejected the email request."
    );
}

function mapProviderStatusToCode(
    status
) {
    if (status === 400) {
        return "invalid-argument";
    }

    if (
        status === 401 ||
        status === 403
    ) {
        return "permission-denied";
    }

    if (status === 429) {
        return "resource-exhausted";
    }

    if (status >= 500) {
        return "unavailable";
    }

    return "internal";
}

function normalizeProviderStatus(
    status
) {
    if (
        status === 401 ||
        status === 403
    ) {
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

/* ==========================================================
   HTML SAFETY
========================================================== */

function escapeHTML(value) {
    return String(
        value === undefined ||
        value === null
            ? ""
            : value
    )
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
    return escapeHTML(
        value
    );
}

/* ==========================================================
   INLINE STYLES
========================================================== */

function headingStyle() {
    return [
        "margin:0 0 20px",
        "font-family:Georgia,serif",
        "font-size:34px",
        "font-weight:normal",
        "line-height:1.25",
        "color:#191714"
    ].join(";");
}

function paragraphStyle() {
    return [
        "margin:0 0 14px",
        "font-family:Arial,sans-serif",
        "font-size:15px",
        "line-height:1.7",
        "color:#36322d"
    ].join(";");
}

function mutedParagraphStyle() {
    return [
        "margin:0 0 6px",
        "font-family:Arial,sans-serif",
        "font-size:13px",
        "line-height:1.6",
        "color:#777068"
    ].join(";");
}

function labelStyle() {
    return [
        "margin:0",
        "font-family:Arial,sans-serif",
        "font-size:11px",
        "font-weight:bold",
        "letter-spacing:1.5px",
        "color:#8a8177"
    ].join(";");
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    sendEmail:
        sendEmail,

    sendOrderConfirmation:
        sendOrderConfirmation,

    sendOrderStatusUpdate:
        sendOrderStatusUpdate,

    sendPaymentReceipt:
        sendPaymentReceipt,

    buildOrderConfirmationTemplate:
        buildOrderConfirmationTemplate,

    buildOrderStatusTemplate:
        buildOrderStatusTemplate,

    buildPaymentReceiptTemplate:
        buildPaymentReceiptTemplate,

    constants: {
        DEFAULT_PROVIDER:
            DEFAULT_PROVIDER,

        PROVIDER_ENDPOINTS:
            PROVIDER_ENDPOINTS
    },

    _internal: {
        sendWithResend:
            sendWithResend,

        sendWithSendGrid:
            sendWithSendGrid,

        emailProviderRequest:
            emailProviderRequest,

        normalizeSender:
            normalizeSender,

        parseSender:
            parseSender,

        formatCurrency:
            formatCurrency,

        formatStatus:
            formatStatus,

        escapeHTML:
            escapeHTML
    }
};