"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   SHARED BACKEND VALIDATION
========================================================== */

const EMAIL_PATTERN =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PHONE_PATTERN =
    /^\+?[0-9]{7,15}$/;

const POSTAL_CODE_PATTERN =
    /^[A-Za-z0-9][A-Za-z0-9\s-]{1,19}$/;

const COUNTRY_CODE_PATTERN =
    /^[A-Z]{2}$/;

const PRODUCT_ID_PATTERN =
    /^[A-Za-z0-9_-]{1,200}$/;

const VARIANT_ID_PATTERN =
    /^[A-Za-z0-9_.:-]{0,200}$/;

const COUPON_CODE_PATTERN =
    /^[A-Za-z0-9_-]{2,50}$/;

const ORDER_ID_PATTERN =
    /^[A-Za-z0-9_-]{1,200}$/;

const ALLOWED_DELIVERY_METHODS =
    new Set([
        "standard",
        "express",
        "international"
    ]);

const ALLOWED_PAYMENT_METHODS =
    new Set([
        "card",
        "bank-transfer",
        "cash-on-delivery",
        "paystack",
        "flutterwave"
    ]);

const ALLOWED_ORDER_STATUSES =
    new Set([
        "pending",
        "confirmed",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
        "refunded"
    ]);

const ALLOWED_PAYMENT_STATUSES =
    new Set([
        "pending",
        "paid",
        "successful",
        "failed",
        "declined",
        "refunded",
        "awaiting-payment"
    ]);

const MAXIMUM_ORDER_ITEMS = 50;
const MAXIMUM_ITEM_QUANTITY = 10;
const MAXIMUM_NOTE_LENGTH = 1500;
const MAXIMUM_ADDRESS_LENGTH = 300;
const MAXIMUM_NAME_LENGTH = 120;
const MAXIMUM_EMAIL_LENGTH = 320;
const MAXIMUM_PHONE_LENGTH = 30;

/* ==========================================================
   SERVICE ERROR
========================================================== */

class ServiceError extends Error {
    constructor(
        code,
        message,
        options
    ) {
        super(message);

        const settings =
            options || {};

        this.name = "ServiceError";
        this.code =
            code || "internal";
        this.publicMessage =
            settings.publicMessage ||
            message;
        this.status =
            settings.status || 400;
        this.details =
            settings.details || null;
        this.cause =
            settings.cause || null;

        Error.captureStackTrace(
            this,
            ServiceError
        );
    }
}

function createServiceError(
    code,
    message,
    options
) {
    return new ServiceError(
        code,
        message,
        options
    );
}

/* ==========================================================
   BASIC NORMALIZATION
========================================================== */

function normalizeCallableData(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return {};
    }

    if (!isPlainObject(value)) {
        throw createServiceError(
            "invalid-argument",
            "The request payload must be an object.",
            {
                status: 400
            }
        );
    }

    return value;
}

function normalizeString(
    value,
    options
) {
    const settings =
        Object.assign(
            {
                fieldName: "Value",
                required: false,
                minimumLength: 0,
                maximumLength: Infinity,
                trim: true,
                lowercase: false,
                uppercase: false,
                pattern: null,
                allowEmpty: true
            },
            options || {}
        );

    if (
        value === null ||
        value === undefined
    ) {
        if (settings.required) {
            throw createServiceError(
                "invalid-argument",
                settings.fieldName +
                    " is required.",
                {
                    status: 400,
                    details: {
                        field:
                            settings.fieldName
                    }
                }
            );
        }

        return "";
    }

    if (
        typeof value !== "string" &&
        typeof value !== "number"
    ) {
        throw createServiceError(
            "invalid-argument",
            settings.fieldName +
                " must be text.",
            {
                status: 400,
                details: {
                    field:
                        settings.fieldName
                }
            }
        );
    }

    let normalized =
        String(value);

    if (settings.trim) {
        normalized =
            normalized.trim();
    }

    if (settings.lowercase) {
        normalized =
            normalized.toLowerCase();
    }

    if (settings.uppercase) {
        normalized =
            normalized.toUpperCase();
    }

    if (
        settings.required &&
        !normalized
    ) {
        throw createServiceError(
            "invalid-argument",
            settings.fieldName +
                " is required.",
            {
                status: 400,
                details: {
                    field:
                        settings.fieldName
                }
            }
        );
    }

    if (
        !settings.allowEmpty &&
        !normalized
    ) {
        throw createServiceError(
            "invalid-argument",
            settings.fieldName +
                " cannot be empty.",
            {
                status: 400,
                details: {
                    field:
                        settings.fieldName
                }
            }
        );
    }

    if (
        normalized.length <
        settings.minimumLength
    ) {
        throw createServiceError(
            "invalid-argument",
            settings.fieldName +
                " must contain at least " +
                settings.minimumLength +
                " characters.",
            {
                status: 400,
                details: {
                    field:
                        settings.fieldName
                }
            }
        );
    }

    if (
        normalized.length >
        settings.maximumLength
    ) {
        throw createServiceError(
            "invalid-argument",
            settings.fieldName +
                " must not exceed " +
                settings.maximumLength +
                " characters.",
            {
                status: 400,
                details: {
                    field:
                        settings.fieldName
                }
            }
        );
    }

    if (
        settings.pattern &&
        normalized &&
        !settings.pattern.test(
            normalized
        )
    ) {
        throw createServiceError(
            "invalid-argument",
            settings.fieldName +
                " is invalid.",
            {
                status: 400,
                details: {
                    field:
                        settings.fieldName
                }
            }
        );
    }

    return normalized;
}

function normalizeBoolean(
    value,
    fallback
) {
    if (
        value === undefined ||
        value === null
    ) {
        return Boolean(fallback);
    }

    if (
        typeof value === "boolean"
    ) {
        return value;
    }

    if (
        value === "true" ||
        value === 1 ||
        value === "1"
    ) {
        return true;
    }

    if (
        value === "false" ||
        value === 0 ||
        value === "0"
    ) {
        return false;
    }

    return Boolean(fallback);
}

function normalizeNumber(
    value,
    options
) {
    const settings =
        Object.assign(
            {
                fieldName: "Value",
                required: false,
                minimum: -Infinity,
                maximum: Infinity,
                integer: false,
                fallback: null
            },
            options || {}
        );

    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {
        if (settings.required) {
            throw createServiceError(
                "invalid-argument",
                settings.fieldName +
                    " is required.",
                {
                    status: 400
                }
            );
        }

        return settings.fallback;
    }

    const normalized =
        Number(value);

    if (
        !Number.isFinite(
            normalized
        )
    ) {
        throw createServiceError(
            "invalid-argument",
            settings.fieldName +
                " must be a valid number.",
            {
                status: 400
            }
        );
    }

    if (
        settings.integer &&
        !Number.isInteger(
            normalized
        )
    ) {
        throw createServiceError(
            "invalid-argument",
            settings.fieldName +
                " must be a whole number.",
            {
                status: 400
            }
        );
    }

    if (
        normalized <
        settings.minimum
    ) {
        throw createServiceError(
            "invalid-argument",
            settings.fieldName +
                " must be at least " +
                settings.minimum +
                ".",
            {
                status: 400
            }
        );
    }

    if (
        normalized >
        settings.maximum
    ) {
        throw createServiceError(
            "invalid-argument",
            settings.fieldName +
                " must not exceed " +
                settings.maximum +
                ".",
            {
                status: 400
            }
        );
    }

    return normalized;
}

function normalizeArray(
    value,
    options
) {
    const settings =
        Object.assign(
            {
                fieldName: "Value",
                required: false,
                minimumLength: 0,
                maximumLength: Infinity
            },
            options || {}
        );

    if (
        value === null ||
        value === undefined
    ) {
        if (settings.required) {
            throw createServiceError(
                "invalid-argument",
                settings.fieldName +
                    " is required.",
                {
                    status: 400
                }
            );
        }

        return [];
    }

    if (!Array.isArray(value)) {
        throw createServiceError(
            "invalid-argument",
            settings.fieldName +
                " must be a list.",
            {
                status: 400
            }
        );
    }

    if (
        value.length <
        settings.minimumLength
    ) {
        throw createServiceError(
            "invalid-argument",
            settings.fieldName +
                " must contain at least " +
                settings.minimumLength +
                " item(s).",
            {
                status: 400
            }
        );
    }

    if (
        value.length >
        settings.maximumLength
    ) {
        throw createServiceError(
            "invalid-argument",
            settings.fieldName +
                " cannot contain more than " +
                settings.maximumLength +
                " item(s).",
            {
                status: 400
            }
        );
    }

    return value;
}

/* ==========================================================
   CUSTOMER VALIDATION
========================================================== */

function normalizeCustomer(value) {
    if (!isPlainObject(value)) {
        throw createServiceError(
            "invalid-argument",
            "Customer information is required.",
            {
                status: 400
            }
        );
    }

    const firstName =
        normalizeString(
            value.firstName,
            {
                fieldName:
                    "First name",
                required: true,
                minimumLength: 1,
                maximumLength:
                    MAXIMUM_NAME_LENGTH
            }
        );

    const lastName =
        normalizeString(
            value.lastName,
            {
                fieldName:
                    "Last name",
                required: true,
                minimumLength: 1,
                maximumLength:
                    MAXIMUM_NAME_LENGTH
            }
        );

    const email =
        normalizeEmail(
            value.email,
            true
        );

    const phone =
        normalizePhone(
            value.phone,
            true
        );

    return {
        firstName: firstName,
        lastName: lastName,
        displayName:
            firstName + " " + lastName,
        email: email,
        phone: phone
    };
}

function normalizeEmail(
    value,
    required
) {
    const email =
        normalizeString(
            value,
            {
                fieldName: "Email",
                required:
                    Boolean(required),
                maximumLength:
                    MAXIMUM_EMAIL_LENGTH,
                lowercase: true
            }
        );

    if (
        email &&
        !EMAIL_PATTERN.test(email)
    ) {
        throw createServiceError(
            "invalid-argument",
            "Enter a valid email address.",
            {
                status: 400,
                details: {
                    field: "email"
                }
            }
        );
    }

    return email;
}

function normalizePhone(
    value,
    required
) {
    const rawPhone =
        normalizeString(
            value,
            {
                fieldName:
                    "Phone number",
                required:
                    Boolean(required),
                maximumLength:
                    MAXIMUM_PHONE_LENGTH
            }
        );

    const phone =
        rawPhone.replace(
            /[^\d+]/g,
            ""
        );

    if (
        phone &&
        !PHONE_PATTERN.test(phone)
    ) {
        throw createServiceError(
            "invalid-argument",
            "Enter a valid phone number.",
            {
                status: 400,
                details: {
                    field: "phone"
                }
            }
        );
    }

    return phone;
}

/* ==========================================================
   ADDRESS VALIDATION
========================================================== */

function normalizeAddress(
    value,
    options
) {
    const settings =
        Object.assign(
            {
                fieldName:
                    "Delivery address",
                required: true,
                defaultCountry:
                    "Nigeria"
            },
            options || {}
        );

    if (!isPlainObject(value)) {
        if (settings.required) {
            throw createServiceError(
                "invalid-argument",
                settings.fieldName +
                    " is required.",
                {
                    status: 400
                }
            );
        }

        return null;
    }

    const addressLine1 =
        normalizeString(
            value.addressLine1,
            {
                fieldName:
                    settings.fieldName +
                    " line 1",
                required: true,
                maximumLength:
                    MAXIMUM_ADDRESS_LENGTH
            }
        );

    const addressLine2 =
        normalizeString(
            value.addressLine2,
            {
                fieldName:
                    settings.fieldName +
                    " line 2",
                required: false,
                maximumLength:
                    MAXIMUM_ADDRESS_LENGTH
            }
        );

    const city =
        normalizeString(
            value.city,
            {
                fieldName: "City",
                required: true,
                maximumLength: 120
            }
        );

    const state =
        normalizeString(
            value.state,
            {
                fieldName:
                    "State or region",
                required: true,
                maximumLength: 120
            }
        );

    const postalCode =
        normalizeString(
            value.postalCode,
            {
                fieldName:
                    "Postal code",
                required: false,
                maximumLength: 20
            }
        );

    if (
        postalCode &&
        !POSTAL_CODE_PATTERN.test(
            postalCode
        )
    ) {
        throw createServiceError(
            "invalid-argument",
            "The postal code is invalid.",
            {
                status: 400,
                details: {
                    field:
                        "postalCode"
                }
            }
        );
    }

    const country =
        normalizeString(
            value.country ||
                settings.defaultCountry,
            {
                fieldName: "Country",
                required: true,
                maximumLength: 120
            }
        );

    const countryCode =
        normalizeCountryCode(
            value.countryCode
        );

    return {
        firstName:
            normalizeString(
                value.firstName,
                {
                    fieldName:
                        "Address first name",
                    maximumLength:
                        MAXIMUM_NAME_LENGTH
                }
            ),

        lastName:
            normalizeString(
                value.lastName,
                {
                    fieldName:
                        "Address last name",
                    maximumLength:
                        MAXIMUM_NAME_LENGTH
                }
            ),

        phone:
            normalizePhone(
                value.phone,
                false
            ),

        company:
            normalizeString(
                value.company,
                {
                    fieldName:
                        "Company",
                    maximumLength: 200
                }
            ),

        addressLine1:
            addressLine1,

        addressLine2:
            addressLine2,

        city: city,
        state: state,
        postalCode: postalCode,
        country: country,
        countryCode:
            countryCode
    };
}

function normalizeCountryCode(value) {
    if (!value) {
        return "";
    }

    return normalizeString(
        value,
        {
            fieldName:
                "Country code",
            maximumLength: 2,
            uppercase: true,
            pattern:
                COUNTRY_CODE_PATTERN
        }
    );
}

/* ==========================================================
   ORDER ITEM VALIDATION
========================================================== */

function normalizeOrderItems(value) {
    const items =
        normalizeArray(
            value,
            {
                fieldName:
                    "Order items",
                required: true,
                minimumLength: 1,
                maximumLength:
                    MAXIMUM_ORDER_ITEMS
            }
        );

    const normalizedItems =
        items.map(function (
            item,
            index
        ) {
            return normalizeOrderItem(
                item,
                index
            );
        });

    const mergedItems =
        mergeDuplicateOrderItems(
            normalizedItems
        );

    mergedItems.forEach(
        function (item) {
            if (
                item.quantity >
                MAXIMUM_ITEM_QUANTITY
            ) {
                throw createServiceError(
                    "invalid-argument",
                    "A product quantity cannot exceed " +
                        MAXIMUM_ITEM_QUANTITY +
                        ".",
                    {
                        status: 400,
                        details: {
                            productId:
                                item.productId
                        }
                    }
                );
            }
        }
    );

    return mergedItems;
}

function normalizeOrderItem(
    value,
    index
) {
    if (!isPlainObject(value)) {
        throw createServiceError(
            "invalid-argument",
            "Order item " +
                (index + 1) +
                " is invalid.",
            {
                status: 400
            }
        );
    }

    const productId =
        normalizeString(
            value.productId,
            {
                fieldName:
                    "Product ID",
                required: true,
                maximumLength: 200,
                pattern:
                    PRODUCT_ID_PATTERN
            }
        );

    const variantId =
        normalizeString(
            value.variantId,
            {
                fieldName:
                    "Variant ID",
                required: false,
                maximumLength: 200,
                pattern:
                    VARIANT_ID_PATTERN
            }
        );

    const quantity =
        normalizeNumber(
            value.quantity,
            {
                fieldName:
                    "Quantity",
                required: true,
                integer: true,
                minimum: 1,
                maximum:
                    MAXIMUM_ITEM_QUANTITY
            }
        );

    return {
        productId: productId,
        variantId: variantId,
        quantity: quantity
    };
}

function mergeDuplicateOrderItems(
    items
) {
    const map = new Map();

    items.forEach(function (item) {
        const key =
            item.productId +
            "::" +
            item.variantId;

        const existing =
            map.get(key);

        if (existing) {
            existing.quantity +=
                item.quantity;
        } else {
            map.set(
                key,
                Object.assign({}, item)
            );
        }
    });

    return Array.from(
        map.values()
    );
}

/* ==========================================================
   CHECKOUT PAYLOAD VALIDATION
========================================================== */

function normalizeCreateOrderPayload(
    value,
    options
) {
    const settings =
        Object.assign(
            {
                defaultCountry:
                    "Nigeria"
            },
            options || {}
        );

    const data =
        normalizeCallableData(value);

    const customer =
        normalizeCustomer(
            data.customer
        );

    const shippingAddress =
        normalizeAddress(
            data.shippingAddress,
            {
                fieldName:
                    "Delivery address",
                required: true,
                defaultCountry:
                    settings.defaultCountry
            }
        );

    const billingSameAsShipping =
        normalizeBoolean(
            data.billingSameAsShipping,
            true
        );

    const billingAddress =
        billingSameAsShipping
            ? Object.assign(
                  {},
                  shippingAddress
              )
            : normalizeAddress(
                  data.billingAddress,
                  {
                      fieldName:
                          "Billing address",
                      required: true,
                      defaultCountry:
                          settings.defaultCountry
                  }
              );

    const deliveryMethod =
        normalizeDeliveryMethod(
            data.deliveryMethod
        );

    const paymentMethod =
        normalizePaymentMethod(
            data.paymentMethod
        );

    const couponCode =
        normalizeCouponCode(
            data.couponCode
        );

    const notes =
        normalizeString(
            data.notes,
            {
                fieldName:
                    "Order notes",
                maximumLength:
                    MAXIMUM_NOTE_LENGTH
            }
        );

    const items =
        normalizeOrderItems(
            data.items
        );

    return {
        customer: customer,
        shippingAddress:
            shippingAddress,
        billingAddress:
            billingAddress,
        billingSameAsShipping:
            billingSameAsShipping,
        deliveryMethod:
            deliveryMethod,
        paymentMethod:
            paymentMethod,
        couponCode:
            couponCode,
        notes: notes,
        items: items,

        paymentReference:
            normalizeString(
                data.paymentReference,
                {
                    fieldName:
                        "Payment reference",
                    maximumLength: 300
                }
            ),

        paymentAuthorization:
            normalizeString(
                data.paymentAuthorization,
                {
                    fieldName:
                        "Payment authorization",
                    maximumLength: 1000
                }
            ),

        idempotencyKey:
            normalizeIdempotencyKey(
                data.idempotencyKey
            )
    };
}

function normalizeDeliveryMethod(
    value
) {
    const method =
        normalizeString(
            value || "standard",
            {
                fieldName:
                    "Delivery method",
                required: true,
                lowercase: true,
                maximumLength: 50
            }
        );

    if (
        !ALLOWED_DELIVERY_METHODS.has(
            method
        )
    ) {
        throw createServiceError(
            "invalid-argument",
            "The selected delivery method is not supported.",
            {
                status: 400,
                details: {
                    field:
                        "deliveryMethod"
                }
            }
        );
    }

    return method;
}

function normalizePaymentMethod(
    value
) {
    const method =
        normalizeString(
            value || "card",
            {
                fieldName:
                    "Payment method",
                required: true,
                lowercase: true,
                maximumLength: 50
            }
        );

    if (
        !ALLOWED_PAYMENT_METHODS.has(
            method
        )
    ) {
        throw createServiceError(
            "invalid-argument",
            "The selected payment method is not supported.",
            {
                status: 400,
                details: {
                    field:
                        "paymentMethod"
                }
            }
        );
    }

    return method;
}

function normalizeCouponCode(value) {
    if (!value) {
        return "";
    }

    return normalizeString(
        value,
        {
            fieldName:
                "Coupon code",
            uppercase: true,
            maximumLength: 50,
            pattern:
                COUPON_CODE_PATTERN
        }
    );
}

function normalizeIdempotencyKey(
    value
) {
    if (!value) {
        return "";
    }

    return normalizeString(
        value,
        {
            fieldName:
                "Idempotency key",
            maximumLength: 200,
            pattern:
                /^[A-Za-z0-9_.:-]+$/
        }
    );
}

/* ==========================================================
   ORDER ACTION VALIDATION
========================================================== */

function normalizeOrderId(value) {
    return normalizeString(
        value,
        {
            fieldName: "Order ID",
            required: true,
            maximumLength: 200,
            pattern:
                ORDER_ID_PATTERN
        }
    );
}

function normalizeOrderStatus(value) {
    const status =
        normalizeString(
            value,
            {
                fieldName:
                    "Order status",
                required: true,
                lowercase: true,
                maximumLength: 50
            }
        );

    if (
        !ALLOWED_ORDER_STATUSES.has(
            status
        )
    ) {
        throw createServiceError(
            "invalid-argument",
            "The order status is invalid.",
            {
                status: 400
            }
        );
    }

    return status;
}

function normalizePaymentStatus(value) {
    const status =
        normalizeString(
            value,
            {
                fieldName:
                    "Payment status",
                required: true,
                lowercase: true,
                maximumLength: 50
            }
        );

    if (
        !ALLOWED_PAYMENT_STATUSES.has(
            status
        )
    ) {
        throw createServiceError(
            "invalid-argument",
            "The payment status is invalid.",
            {
                status: 400
            }
        );
    }

    return status;
}

function normalizeCancellationReason(
    value
) {
    return normalizeString(
        value,
        {
            fieldName:
                "Cancellation reason",
            maximumLength: 500
        }
    );
}

/* ==========================================================
   ADMIN PAYLOAD VALIDATION
========================================================== */

function normalizeUserId(value) {
    return normalizeString(
        value,
        {
            fieldName: "User ID",
            required: true,
            maximumLength: 200,
            pattern:
                /^[A-Za-z0-9_-]+$/
        }
    );
}

function normalizeUserRole(value) {
    const role =
        normalizeString(
            value,
            {
                fieldName:
                    "User role",
                required: true,
                lowercase: true,
                maximumLength: 30
            }
        );

    if (
        role !== "customer" &&
        role !== "admin" &&
        role !== "superadmin"
    ) {
        throw createServiceError(
            "invalid-argument",
            "The user role is invalid.",
            {
                status: 400
            }
        );
    }

    return role;
}

function normalizeUserStatus(value) {
    const status =
        normalizeString(
            value,
            {
                fieldName:
                    "User status",
                required: true,
                lowercase: true,
                maximumLength: 30
            }
        );

    if (
        status !== "active" &&
        status !== "disabled"
    ) {
        throw createServiceError(
            "invalid-argument",
            "The user status is invalid.",
            {
                status: 400
            }
        );
    }

    return status;
}

/* ==========================================================
   PRODUCT VALIDATION
========================================================== */

function normalizeProductIdentifier(
    value
) {
    return normalizeString(
        value,
        {
            fieldName:
                "Product ID",
            required: true,
            maximumLength: 200,
            pattern:
                PRODUCT_ID_PATTERN
        }
    );
}

function normalizeVariantIdentifier(
    value
) {
    return normalizeString(
        value,
        {
            fieldName:
                "Variant ID",
            required: false,
            maximumLength: 200,
            pattern:
                VARIANT_ID_PATTERN
        }
    );
}

/* ==========================================================
   HTTP QUERY VALIDATION
========================================================== */

function normalizePagination(value) {
    const source =
        isPlainObject(value)
            ? value
            : {};

    return {
        limit:
            normalizeNumber(
                source.limit,
                {
                    fieldName: "Limit",
                    integer: true,
                    minimum: 1,
                    maximum: 100,
                    fallback: 20
                }
            ),

        cursor:
            normalizeString(
                source.cursor,
                {
                    fieldName:
                        "Cursor",
                    maximumLength: 2000
                }
            )
    };
}

function normalizeSearchTerm(
    value,
    maximumLength
) {
    return normalizeString(
        value,
        {
            fieldName:
                "Search term",
            maximumLength:
                maximumLength || 200
        }
    );
}

/* ==========================================================
   OBJECT SAFETY
========================================================== */

function isPlainObject(value) {
    if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value)
    ) {
        return false;
    }

    const prototype =
        Object.getPrototypeOf(
            value
        );

    return (
        prototype ===
            Object.prototype ||
        prototype === null
    );
}

function removeUndefined(value) {
    if (Array.isArray(value)) {
        return value
            .map(removeUndefined)
            .filter(function (item) {
                return item !== undefined;
            });
    }

    if (isPlainObject(value)) {
        return Object.keys(value).reduce(
            function (output, key) {
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

function assertAllowedFields(
    value,
    allowedFields,
    fieldName
) {
    if (!isPlainObject(value)) {
        throw createServiceError(
            "invalid-argument",
            (
                fieldName ||
                "Payload"
            ) +
                " must be an object.",
            {
                status: 400
            }
        );
    }

    const allowed =
        new Set(
            allowedFields || []
        );

    const invalidFields =
        Object.keys(value).filter(
            function (key) {
                return !allowed.has(key);
            }
        );

    if (invalidFields.length) {
        throw createServiceError(
            "invalid-argument",
            "Unsupported fields were provided.",
            {
                status: 400,
                details: {
                    fields:
                        invalidFields
                }
            }
        );
    }

    return true;
}

function requireFields(
    value,
    requiredFields,
    fieldName
) {
    if (!isPlainObject(value)) {
        throw createServiceError(
            "invalid-argument",
            (
                fieldName ||
                "Payload"
            ) +
                " must be an object.",
            {
                status: 400
            }
        );
    }

    const missing =
        requiredFields.filter(
            function (key) {
                return (
                    value[key] ===
                        undefined ||
                    value[key] ===
                        null ||
                    value[key] === ""
                );
            }
        );

    if (missing.length) {
        throw createServiceError(
            "invalid-argument",
            "Required fields are missing.",
            {
                status: 400,
                details: {
                    fields: missing
                }
            }
        );
    }

    return true;
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    ServiceError:
        ServiceError,

    createServiceError:
        createServiceError,

    normalizeCallableData:
        normalizeCallableData,

    normalizeString:
        normalizeString,

    normalizeBoolean:
        normalizeBoolean,

    normalizeNumber:
        normalizeNumber,

    normalizeArray:
        normalizeArray,

    normalizeCustomer:
        normalizeCustomer,

    normalizeEmail:
        normalizeEmail,

    normalizePhone:
        normalizePhone,

    normalizeAddress:
        normalizeAddress,

    normalizeCountryCode:
        normalizeCountryCode,

    normalizeOrderItem:
        normalizeOrderItem,

    normalizeOrderItems:
        normalizeOrderItems,

    normalizeCreateOrderPayload:
        normalizeCreateOrderPayload,

    normalizeDeliveryMethod:
        normalizeDeliveryMethod,

    normalizePaymentMethod:
        normalizePaymentMethod,

    normalizeCouponCode:
        normalizeCouponCode,

    normalizeIdempotencyKey:
        normalizeIdempotencyKey,

    normalizeOrderId:
        normalizeOrderId,

    normalizeOrderStatus:
        normalizeOrderStatus,

    normalizePaymentStatus:
        normalizePaymentStatus,

    normalizeCancellationReason:
        normalizeCancellationReason,

    normalizeUserId:
        normalizeUserId,

    normalizeUserRole:
        normalizeUserRole,

    normalizeUserStatus:
        normalizeUserStatus,

    normalizeProductIdentifier:
        normalizeProductIdentifier,

    normalizeVariantIdentifier:
        normalizeVariantIdentifier,

    normalizePagination:
        normalizePagination,

    normalizeSearchTerm:
        normalizeSearchTerm,

    isPlainObject:
        isPlainObject,

    removeUndefined:
        removeUndefined,

    assertAllowedFields:
        assertAllowedFields,

    requireFields:
        requireFields,

    constants: {
        MAXIMUM_ORDER_ITEMS:
            MAXIMUM_ORDER_ITEMS,

        MAXIMUM_ITEM_QUANTITY:
            MAXIMUM_ITEM_QUANTITY,

        ALLOWED_DELIVERY_METHODS:
            Array.from(
                ALLOWED_DELIVERY_METHODS
            ),

        ALLOWED_PAYMENT_METHODS:
            Array.from(
                ALLOWED_PAYMENT_METHODS
            ),

        ALLOWED_ORDER_STATUSES:
            Array.from(
                ALLOWED_ORDER_STATUSES
            ),

        ALLOWED_PAYMENT_STATUSES:
            Array.from(
                ALLOWED_PAYMENT_STATUSES
            )
    }
};