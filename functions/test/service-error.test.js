"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   SERVICE ERROR TEST SUITE
========================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    ServiceError,
    createServiceError,
    normalizeServiceError,
    resolveErrorCode,
    normalizeErrorCode,
    normalizeHttpStatus,
    getErrorDefinition,
    createPublicErrorPayload,
    createHttpErrorResponse,
    toCallableError,
    sendServiceError,
    applyContextToError,
    sanitizeErrorDetails,
    isSensitiveKey,
    isRetryableCode,
    isServiceError,
    hasErrorCode,
    invalidArgument,
    unauthenticated,
    permissionDenied,
    notFound,
    alreadyExists,
    failedPrecondition,
    conflict,
    paymentFailed,
    inventoryUnavailable,
    internalError,
    constants
} = require(
    "../src/shared/service-error"
);

/* ==========================================================
   TEST HELPERS
========================================================== */

function createResponseStub() {
    const state = {
        statusCode:
            null,

        body:
            null,

        ended:
            false
    };

    const response = {
        status:
            function (statusCode) {
                state.statusCode =
                    statusCode;

                return response;
            },

        json:
            function (body) {
                state.body =
                    body;

                state.ended =
                    true;

                return response;
            },

        send:
            function (body) {
                state.body =
                    body;

                state.ended =
                    true;

                return response;
            },

        end:
            function (body) {
                state.body =
                    body;

                state.ended =
                    true;

                return response;
            }
    };

    return {
        response:
            response,

        state:
            state
    };
}

class TestHttpsError extends Error {
    constructor(
        code,
        message,
        details
    ) {
        super(message);

        this.name =
            "HttpsError";

        this.code =
            code;

        this.details =
            details;
    }
}

/* ==========================================================
   SERVICE ERROR CLASS
========================================================== */

test(
    "ServiceError creates normalized structured errors",
    function () {
        const error =
            new ServiceError(
                "INVALID_ARGUMENT",
                "The email address is invalid.",
                {
                    details: {
                        field:
                            "email"
                    },

                    requestId:
                        "req_123",

                    correlationId:
                        "corr_123",

                    timestamp:
                        "2026-07-20T09:00:00.000Z"
                }
            );

        assert.equal(
            error.name,
            "ServiceError"
        );

        assert.equal(
            error.code,
            "invalid-argument"
        );

        assert.equal(
            error.status,
            400
        );

        assert.equal(
            error.publicMessage,
            "The email address is invalid."
        );

        assert.equal(
            error.message,
            "The email address is invalid."
        );

        assert.deepEqual(
            error.details,
            {
                field:
                    "email"
            }
        );

        assert.equal(
            error.expose,
            true
        );

        assert.equal(
            error.retryable,
            false
        );

        assert.equal(
            error.requestId,
            "req_123"
        );

        assert.equal(
            error.correlationId,
            "corr_123"
        );

        assert.equal(
            error.timestamp,
            "2026-07-20T09:00:00.000Z"
        );
    }
);

test(
    "ServiceError uses definition defaults",
    function () {
        const error =
            new ServiceError(
                "not-found"
            );

        assert.equal(
            error.status,
            404
        );

        assert.equal(
            error.publicMessage,
            "The requested resource was not found."
        );

        assert.equal(
            error.expose,
            true
        );
    }
);

test(
    "ServiceError hides server errors by default",
    function () {
        const error =
            new ServiceError(
                "internal"
            );

        assert.equal(
            error.status,
            500
        );

        assert.equal(
            error.expose,
            false
        );

        assert.equal(
            error.publicMessage,
            constants.DEFAULT_ERROR_MESSAGE
        );
    }
);

test(
    "ServiceError supports separate internal and public messages",
    function () {
        const error =
            new ServiceError(
                "provider-error",
                "Payment provider unavailable.",
                {
                    internalMessage:
                        "Paystack returned HTTP 503.",

                    expose:
                        false
                }
            );

        assert.equal(
            error.message,
            "Paystack returned HTTP 503."
        );

        assert.equal(
            error.publicMessage,
            "Payment provider unavailable."
        );
    }
);

test(
    "ServiceError preserves a cause",
    function () {
        const cause =
            new Error(
                "Network unavailable."
            );

        const error =
            new ServiceError(
                "provider-error",
                "Payment provider unavailable.",
                {
                    cause:
                        cause
                }
            );

        assert.equal(
            error.cause,
            cause
        );
    }
);

test(
    "ServiceError toJSON returns structured data",
    function () {
        const error =
            new ServiceError(
                "conflict",
                "The order has already changed.",
                {
                    details: {
                        orderId:
                            "order-1"
                    },

                    requestId:
                        "req_123",

                    correlationId:
                        "corr_123",

                    timestamp:
                        "2026-07-20T09:00:00.000Z"
                }
            );

        assert.deepEqual(
            error.toJSON(),
            {
                name:
                    "ServiceError",

                code:
                    "conflict",

                status:
                    409,

                message:
                    "The order has already changed.",

                details: {
                    orderId:
                        "order-1"
                },

                retryable:
                    false,

                requestId:
                    "req_123",

                correlationId:
                    "corr_123",

                timestamp:
                    "2026-07-20T09:00:00.000Z"
            }
        );
    }
);

test(
    "ServiceError toPublicJSON creates safe public payload",
    function () {
        const error =
            new ServiceError(
                "invalid-argument",
                "Invalid quantity.",
                {
                    details: {
                        field:
                            "quantity"
                    }
                }
            );

        assert.deepEqual(
            error.toPublicJSON(),
            {
                code:
                    "invalid-argument",

                message:
                    "Invalid quantity.",

                retryable:
                    false,

                details: {
                    field:
                        "quantity"
                }
            }
        );
    }
);

/* ==========================================================
   FACTORIES
========================================================== */

test(
    "createServiceError creates a ServiceError",
    function () {
        const error =
            createServiceError(
                "not-found",
                "Order not found.",
                {
                    details: {
                        orderId:
                            "order-1"
                    }
                }
            );

        assert.equal(
            error instanceof ServiceError,
            true
        );

        assert.equal(
            error.code,
            "not-found"
        );
    }
);

test(
    "createServiceError returns an existing ServiceError",
    function () {
        const original =
            new ServiceError(
                "conflict",
                "Conflict."
            );

        assert.equal(
            createServiceError(
                original
            ),
            original
        );
    }
);

test(
    "createServiceError normalizes ordinary Error objects",
    function () {
        const original =
            new Error(
                "Resource missing."
            );

        original.status =
            404;

        const normalized =
            createServiceError(
                original,
                {
                    requestId:
                        "req_123"
                }
            );

        assert.equal(
            normalized instanceof ServiceError,
            true
        );

        assert.equal(
            normalized.code,
            "not-found"
        );

        assert.equal(
            normalized.requestId,
            "req_123"
        );
    }
);

/* ==========================================================
   CONVENIENCE FACTORIES
========================================================== */

test(
    "invalidArgument creates an invalid-argument error",
    function () {
        const error =
            invalidArgument(
                "Invalid email.",
                {
                    field:
                        "email"
                }
            );

        assert.equal(
            error.code,
            "invalid-argument"
        );

        assert.equal(
            error.status,
            400
        );

        assert.deepEqual(
            error.details,
            {
                field:
                    "email"
            }
        );
    }
);

test(
    "unauthenticated creates an authentication error",
    function () {
        const error =
            unauthenticated(
                "Please sign in."
            );

        assert.equal(
            error.code,
            "unauthenticated"
        );

        assert.equal(
            error.status,
            401
        );
    }
);

test(
    "permissionDenied creates a permission error",
    function () {
        const error =
            permissionDenied(
                "Admin access required."
            );

        assert.equal(
            error.code,
            "permission-denied"
        );

        assert.equal(
            error.status,
            403
        );
    }
);

test(
    "notFound creates a not-found error",
    function () {
        const error =
            notFound(
                "Order not found."
            );

        assert.equal(
            error.code,
            "not-found"
        );

        assert.equal(
            error.status,
            404
        );
    }
);

test(
    "alreadyExists creates an already-exists error",
    function () {
        const error =
            alreadyExists(
                "Account already exists."
            );

        assert.equal(
            error.code,
            "already-exists"
        );

        assert.equal(
            error.status,
            409
        );
    }
);

test(
    "failedPrecondition creates a precondition error",
    function () {
        const error =
            failedPrecondition(
                "Email verification required."
            );

        assert.equal(
            error.code,
            "failed-precondition"
        );

        assert.equal(
            error.status,
            400
        );
    }
);

test(
    "conflict creates a conflict error",
    function () {
        const error =
            conflict(
                "Order has already changed."
            );

        assert.equal(
            error.code,
            "conflict"
        );

        assert.equal(
            error.status,
            409
        );
    }
);

test(
    "paymentFailed creates a payment error",
    function () {
        const error =
            paymentFailed(
                "Payment was declined."
            );

        assert.equal(
            error.code,
            "payment-failed"
        );

        assert.equal(
            error.status,
            402
        );
    }
);

test(
    "inventoryUnavailable creates an inventory error",
    function () {
        const error =
            inventoryUnavailable(
                "Insufficient stock.",
                {
                    productId:
                        "product-1"
                }
            );

        assert.equal(
            error.code,
            "inventory-unavailable"
        );

        assert.equal(
            error.status,
            409
        );

        assert.equal(
            error.details.productId,
            "product-1"
        );
    }
);

test(
    "internalError hides internal failures",
    function () {
        const cause =
            new Error(
                "Database connection failed."
            );

        const error =
            internalError(
                "Unable to complete the operation.",
                cause
            );

        assert.equal(
            error.code,
            "internal"
        );

        assert.equal(
            error.expose,
            false
        );

        assert.equal(
            error.cause,
            cause
        );
    }
);

/* ==========================================================
   CODE NORMALIZATION
========================================================== */

test(
    "normalizeErrorCode normalizes case, spaces, and underscores",
    function () {
        assert.equal(
            normalizeErrorCode(
                "INVALID_ARGUMENT"
            ),
            "invalid-argument"
        );

        assert.equal(
            normalizeErrorCode(
                "Permission Denied"
            ),
            "permission-denied"
        );
    }
);

test(
    "normalizeErrorCode returns internal for missing values",
    function () {
        assert.equal(
            normalizeErrorCode(),
            "internal"
        );

        assert.equal(
            normalizeErrorCode(
                ""
            ),
            "internal"
        );
    }
);

test(
    "normalizeHttpStatus accepts valid HTTP status codes",
    function () {
        assert.equal(
            normalizeHttpStatus(
                422,
                500
            ),
            422
        );

        assert.equal(
            normalizeHttpStatus(
                "404",
                500
            ),
            404
        );
    }
);

test(
    "normalizeHttpStatus uses fallback for invalid values",
    function () {
        assert.equal(
            normalizeHttpStatus(
                "invalid",
                409
            ),
            409
        );

        assert.equal(
            normalizeHttpStatus(
                99,
                400
            ),
            400
        );
    }
);

test(
    "getErrorDefinition returns matching definition",
    function () {
        const definition =
            getErrorDefinition(
                "not-found"
            );

        assert.equal(
            definition.status,
            404
        );

        assert.equal(
            definition.callableCode,
            "not-found"
        );
    }
);

test(
    "getErrorDefinition falls back to internal",
    function () {
        assert.equal(
            getErrorDefinition(
                "unknown-code"
            ),
            constants
                .ERROR_DEFINITIONS
                .internal
        );
    }
);

/* ==========================================================
   ERROR CODE RESOLUTION
========================================================== */

test(
    "resolveErrorCode honors explicit option code",
    function () {
        assert.equal(
            resolveErrorCode(
                new Error(
                    "Failure."
                ),
                {
                    code:
                        "conflict"
                }
            ),
            "conflict"
        );
    }
);

test(
    "resolveErrorCode maps Firebase Auth codes",
    function () {
        const error =
            new Error(
                "Token expired."
            );

        error.code =
            "auth/id-token-expired";

        assert.equal(
            resolveErrorCode(
                error
            ),
            "unauthenticated"
        );
    }
);

test(
    "resolveErrorCode maps Firestore codes",
    function () {
        const error =
            new Error(
                "Document missing."
            );

        error.code =
            "firestore/not-found";

        assert.equal(
            resolveErrorCode(
                error
            ),
            "not-found"
        );
    }
);

test(
    "resolveErrorCode maps Storage codes",
    function () {
        const error =
            new Error(
                "Storage object missing."
            );

        error.code =
            "storage/object-not-found";

        assert.equal(
            resolveErrorCode(
                error
            ),
            "not-found"
        );
    }
);

test(
    "resolveErrorCode recognizes direct service codes",
    function () {
        const error =
            new Error(
                "Stock unavailable."
            );

        error.code =
            "inventory-unavailable";

        assert.equal(
            resolveErrorCode(
                error
            ),
            "inventory-unavailable"
        );
    }
);

test(
    "resolveErrorCode recognizes final code segment",
    function () {
        const error =
            new Error(
                "Order missing."
            );

        error.code =
            "orders/not-found";

        assert.equal(
            resolveErrorCode(
                error
            ),
            "not-found"
        );
    }
);

test(
    "resolveErrorCode maps HTTP status values",
    function () {
        const error =
            new Error(
                "Provider unavailable."
            );

        error.statusCode =
            503;

        assert.equal(
            resolveErrorCode(
                error
            ),
            "unavailable"
        );
    }
);

test(
    "resolveErrorCode maps AbortError",
    function () {
        const error =
            new Error(
                "Request aborted."
            );

        error.name =
            "AbortError";

        assert.equal(
            resolveErrorCode(
                error
            ),
            "deadline-exceeded"
        );
    }
);

test(
    "resolveErrorCode falls back to internal",
    function () {
        assert.equal(
            resolveErrorCode(
                new Error(
                    "Unknown failure."
                )
            ),
            "internal"
        );
    }
);

/* ==========================================================
   NORMALIZATION
========================================================== */

test(
    "normalizeServiceError returns ServiceError unchanged",
    function () {
        const original =
            new ServiceError(
                "not-found",
                "Order missing."
            );

        assert.equal(
            normalizeServiceError(
                original
            ),
            original
        );
    }
);

test(
    "normalizeServiceError applies request context",
    function () {
        const original =
            new ServiceError(
                "not-found",
                "Order missing."
            );

        const normalized =
            normalizeServiceError(
                original,
                {
                    requestId:
                        "req_123",

                    correlationId:
                        "corr_123"
                }
            );

        assert.equal(
            normalized.requestId,
            "req_123"
        );

        assert.equal(
            normalized.correlationId,
            "corr_123"
        );
    }
);

test(
    "normalizeServiceError exposes client errors",
    function () {
        const original =
            new Error(
                "Order not found."
            );

        original.status =
            404;

        const normalized =
            normalizeServiceError(
                original
            );

        assert.equal(
            normalized.code,
            "not-found"
        );

        assert.equal(
            normalized.status,
            404
        );

        assert.equal(
            normalized.publicMessage,
            "Order not found."
        );

        assert.equal(
            normalized.expose,
            true
        );
    }
);

test(
    "normalizeServiceError hides server error messages",
    function () {
        const original =
            new Error(
                "Database password rejected."
            );

        original.status =
            500;

        const normalized =
            normalizeServiceError(
                original
            );

        assert.equal(
            normalized.code,
            "internal"
        );

        assert.equal(
            normalized.expose,
            false
        );

        assert.equal(
            normalized.publicMessage,
            constants.DEFAULT_ERROR_MESSAGE
        );

        assert.equal(
            normalized.message,
            "Database password rejected."
        );
    }
);

test(
    "normalizeServiceError honors explicit public options",
    function () {
        const original =
            new Error(
                "Provider HTTP 500."
            );

        const normalized =
            normalizeServiceError(
                original,
                {
                    code:
                        "provider-error",

                    publicMessage:
                        "Payment service unavailable.",

                    expose:
                        true,

                    status:
                        502,

                    details: {
                        provider:
                            "paystack"
                    }
                }
            );

        assert.equal(
            normalized.code,
            "provider-error"
        );

        assert.equal(
            normalized.publicMessage,
            "Payment service unavailable."
        );

        assert.equal(
            normalized.expose,
            true
        );

        assert.deepEqual(
            normalized.details,
            {
                provider:
                    "paystack"
            }
        );
    }
);

/* ==========================================================
   PUBLIC PAYLOADS
========================================================== */

test(
    "createPublicErrorPayload exposes safe client details",
    function () {
        const error =
            invalidArgument(
                "Invalid quantity.",
                {
                    field:
                        "quantity",

                    minimum:
                        1
                },
                {
                    requestId:
                        "req_123"
                }
            );

        assert.deepEqual(
            createPublicErrorPayload(
                error
            ),
            {
                code:
                    "invalid-argument",

                message:
                    "Invalid quantity.",

                retryable:
                    false,

                details: {
                    field:
                        "quantity",

                    minimum:
                        1
                },

                requestId:
                    "req_123"
            }
        );
    }
);

test(
    "createPublicErrorPayload hides internal details",
    function () {
        const error =
            new ServiceError(
                "internal",
                "Database password rejected.",
                {
                    details: {
                        database:
                            "orders"
                    },

                    expose:
                        false
                }
            );

        assert.deepEqual(
            createPublicErrorPayload(
                error
            ),
            {
                code:
                    "internal",

                message:
                    constants.DEFAULT_ERROR_MESSAGE,

                retryable:
                    false
            }
        );
    }
);

test(
    "createPublicErrorPayload can include hidden details explicitly",
    function () {
        const error =
            new ServiceError(
                "internal",
                "Database failure.",
                {
                    details: {
                        operation:
                            "createOrder"
                    },

                    expose:
                        false
                }
            );

        const payload =
            createPublicErrorPayload(
                error,
                {
                    includeDetails:
                        true
                }
            );

        assert.deepEqual(
            payload.details,
            {
                operation:
                    "createOrder"
            }
        );
    }
);

test(
    "createHttpErrorResponse returns standard response shape",
    function () {
        const response =
            createHttpErrorResponse(
                notFound(
                    "Order not found.",
                    {
                        orderId:
                            "order-1"
                    }
                )
            );

        assert.deepEqual(
            response,
            {
                status:
                    404,

                body: {
                    success:
                        false,

                    error: {
                        code:
                            "not-found",

                        message:
                            "Order not found.",

                        retryable:
                            false,

                        details: {
                            orderId:
                                "order-1"
                        }
                    }
                }
            }
        );
    }
);

/* ==========================================================
   CALLABLE ERRORS
========================================================== */

test(
    "toCallableError creates an injected HttpsError",
    function () {
        const error =
            toCallableError(
                invalidArgument(
                    "Invalid quantity.",
                    {
                        field:
                            "quantity"
                    }
                ),
                {
                    HttpsError:
                        TestHttpsError
                }
            );

        assert.equal(
            error instanceof TestHttpsError,
            true
        );

        assert.equal(
            error.code,
            "invalid-argument"
        );

        assert.equal(
            error.message,
            "Invalid quantity."
        );

        assert.deepEqual(
            error.details,
            {
                code:
                    "invalid-argument",

                message:
                    "Invalid quantity.",

                retryable:
                    false,

                details: {
                    field:
                        "quantity"
                }
            }
        );
    }
);

test(
    "toCallableError maps conflict to aborted",
    function () {
        const error =
            toCallableError(
                conflict(
                    "Order changed."
                ),
                {
                    HttpsError:
                        TestHttpsError
                }
            );

        assert.equal(
            error.code,
            "aborted"
        );
    }
);

test(
    "toCallableError maps provider errors to unavailable",
    function () {
        const error =
            toCallableError(
                new ServiceError(
                    "provider-error",
                    "Provider failed.",
                    {
                        expose:
                            false
                    }
                ),
                {
                    HttpsError:
                        TestHttpsError
                }
            );

        assert.equal(
            error.code,
            "unavailable"
        );

        assert.equal(
            error.message,
            "An external service could not complete the request."
        );
    }
);

test(
    "toCallableError supports an explicit callable code",
    function () {
        const error =
            toCallableError(
                conflict(
                    "Order changed."
                ),
                {
                    HttpsError:
                        TestHttpsError,

                    callableCode:
                        "failed-precondition"
                }
            );

        assert.equal(
            error.code,
            "failed-precondition"
        );
    }
);

/* ==========================================================
   RESPONSE WRITING
========================================================== */

test(
    "sendServiceError writes JSON responses",
    function () {
        const harness =
            createResponseStub();

        const returned =
            sendServiceError(
                harness.response,
                notFound(
                    "Order not found."
                )
            );

        assert.equal(
            returned,
            harness.response
        );

        assert.equal(
            harness.state.statusCode,
            404
        );

        assert.deepEqual(
            harness.state.body,
            {
                success:
                    false,

                error: {
                    code:
                        "not-found",

                    message:
                        "Order not found.",

                    retryable:
                        false
                }
            }
        );

        assert.equal(
            harness.state.ended,
            true
        );
    }
);

test(
    "sendServiceError returns response data without response object",
    function () {
        const result =
            sendServiceError(
                null,
                permissionDenied(
                    "Admin access required."
                )
            );

        assert.equal(
            result.status,
            403
        );

        assert.equal(
            result.body
                .error
                .code,
            "permission-denied"
        );
    }
);

test(
    "sendServiceError supports statusCode and send",
    function () {
        const state = {
            body:
                null
        };

        const response = {
            statusCode:
                200,

            send:
                function (body) {
                    state.body =
                        body;
                }
        };

        sendServiceError(
            response,
            unauthenticated(
                "Please sign in."
            )
        );

        assert.equal(
            response.statusCode,
            401
        );

        assert.equal(
            state.body
                .error
                .code,
            "unauthenticated"
        );
    }
);

test(
    "sendServiceError supports response.end",
    function () {
        const state = {
            body:
                null
        };

        const response = {
            statusCode:
                200,

            end:
                function (body) {
                    state.body =
                        body;
                }
        };

        sendServiceError(
            response,
            notFound(
                "Order not found."
            )
        );

        assert.equal(
            response.statusCode,
            404
        );

        assert.deepEqual(
            JSON.parse(
                state.body
            ),
            {
                success:
                    false,

                error: {
                    code:
                        "not-found",

                    message:
                        "Order not found.",

                    retryable:
                        false
                }
            }
        );
    }
);

/* ==========================================================
   CONTEXT
========================================================== */

test(
    "applyContextToError adds missing request identifiers",
    function () {
        const error =
            notFound(
                "Order missing."
            );

        applyContextToError(
            error,
            {
                requestId:
                    "req_123",

                correlationId:
                    "corr_123"
            }
        );

        assert.equal(
            error.requestId,
            "req_123"
        );

        assert.equal(
            error.correlationId,
            "corr_123"
        );
    }
);

test(
    "applyContextToError preserves existing identifiers",
    function () {
        const error =
            new ServiceError(
                "not-found",
                "Order missing.",
                {
                    requestId:
                        "req_existing",

                    correlationId:
                        "corr_existing"
                }
            );

        applyContextToError(
            error,
            {
                requestId:
                    "req_new",

                correlationId:
                    "corr_new"
            }
        );

        assert.equal(
            error.requestId,
            "req_existing"
        );

        assert.equal(
            error.correlationId,
            "corr_existing"
        );
    }
);

test(
    "applyContextToError ignores non-ServiceError values",
    function () {
        const error =
            new Error(
                "Failure."
            );

        assert.equal(
            applyContextToError(
                error,
                {
                    requestId:
                        "req_123"
                }
            ),
            error
        );
    }
);

/* ==========================================================
   DETAIL SANITIZATION
========================================================== */

test(
    "sanitizeErrorDetails preserves safe values",
    function () {
        assert.deepEqual(
            sanitizeErrorDetails({
                orderId:
                    "order-1",

                quantity:
                    2,

                available:
                    false
            }),
            {
                orderId:
                    "order-1",

                quantity:
                    2,

                available:
                    false
            }
        );
    }
);

test(
    "sanitizeErrorDetails redacts sensitive keys",
    function () {
        const sanitized =
            sanitizeErrorDetails({
                authorization:
                    "Bearer private",

                password:
                    "Password123!",

                secretKey:
                    "secret",

                nested: {
                    refreshToken:
                        "private-token"
                },

                safe:
                    "visible"
            });

        assert.deepEqual(
            sanitized,
            {
                authorization:
                    "[REDACTED]",

                password:
                    "[REDACTED]",

                secretKey:
                    "[REDACTED]",

                nested: {
                    refreshToken:
                        "[REDACTED]"
                },

                safe:
                    "visible"
            }
        );
    }
);

test(
    "sanitizeErrorDetails serializes dates",
    function () {
        const sanitized =
            sanitizeErrorDetails({
                createdAt:
                    new Date(
                        "2026-07-20T09:00:00.000Z"
                    )
            });

        assert.equal(
            sanitized.createdAt,
            "2026-07-20T09:00:00.000Z"
        );
    }
);

test(
    "sanitizeErrorDetails summarizes buffers",
    function () {
        const sanitized =
            sanitizeErrorDetails({
                body:
                    Buffer.from(
                        "hello"
                    )
            });

        assert.equal(
            sanitized.body,
            "[Buffer 5 bytes]"
        );
    }
);

test(
    "sanitizeErrorDetails serializes Error values",
    function () {
        const error =
            new Error(
                "Nested failure."
            );

        error.code =
            "nested/failure";

        const sanitized =
            sanitizeErrorDetails({
                cause:
                    error
            });

        assert.deepEqual(
            sanitized.cause,
            {
                name:
                    "Error",

                code:
                    "nested/failure",

                message:
                    "Nested failure."
            }
        );
    }
);

test(
    "sanitizeErrorDetails handles circular references",
    function () {
        const details = {
            orderId:
                "order-1"
        };

        details.self =
            details;

        const sanitized =
            sanitizeErrorDetails(
                details
            );

        assert.equal(
            sanitized.self,
            "[Circular]"
        );
    }
);

test(
    "sanitizeErrorDetails limits nested depth",
    function () {
        const sanitized =
            sanitizeErrorDetails(
                {
                    level1: {
                        level2: {
                            level3: {
                                value:
                                    true
                            }
                        }
                    }
                },
                {
                    maxDepth:
                        2
                }
            );

        assert.equal(
            sanitized
                .level1
                .level2,
            "[Maximum depth reached]"
        );
    }
);

test(
    "isSensitiveKey recognizes protected fields",
    function () {
        assert.equal(
            isSensitiveKey(
                "password"
            ),
            true
        );

        assert.equal(
            isSensitiveKey(
                "refresh_token"
            ),
            true
        );

        assert.equal(
            isSensitiveKey(
                "card-number"
            ),
            true
        );

        assert.equal(
            isSensitiveKey(
                "orderId"
            ),
            false
        );
    }
);

/* ==========================================================
   RETRYABILITY
========================================================== */

test(
    "isRetryableCode recognizes temporary failures",
    function () {
        [
            "aborted",
            "deadline-exceeded",
            "resource-exhausted",
            "too-many-requests",
            "unavailable",
            "provider-error"
        ].forEach(
            function (code) {
                assert.equal(
                    isRetryableCode(
                        code
                    ),
                    true
                );
            }
        );
    }
);

test(
    "isRetryableCode rejects permanent failures",
    function () {
        [
            "invalid-argument",
            "unauthenticated",
            "permission-denied",
            "not-found",
            "payment-failed"
        ].forEach(
            function (code) {
                assert.equal(
                    isRetryableCode(
                        code
                    ),
                    false
                );
            }
        );
    }
);

test(
    "ServiceError derives retryability from its code",
    function () {
        assert.equal(
            new ServiceError(
                "unavailable"
            ).retryable,
            true
        );

        assert.equal(
            new ServiceError(
                "not-found"
            ).retryable,
            false
        );
    }
);

test(
    "ServiceError allows retryability overrides",
    function () {
        const error =
            new ServiceError(
                "not-found",
                "Order missing.",
                {
                    retryable:
                        true
                }
            );

        assert.equal(
            error.retryable,
            true
        );
    }
);

/* ==========================================================
   TYPE GUARDS
========================================================== */

test(
    "isServiceError identifies ServiceError instances",
    function () {
        assert.equal(
            isServiceError(
                new ServiceError(
                    "internal"
                )
            ),
            true
        );

        assert.equal(
            isServiceError(
                new Error(
                    "Failure."
                )
            ),
            false
        );
    }
);

test(
    "hasErrorCode compares normalized codes",
    function () {
        const error =
            new ServiceError(
                "permission-denied"
            );

        assert.equal(
            hasErrorCode(
                error,
                "PERMISSION_DENIED"
            ),
            true
        );

        assert.equal(
            hasErrorCode(
                error,
                "not-found"
            ),
            false
        );

        assert.equal(
            hasErrorCode(
                null,
                "not-found"
            ),
            false
        );
    }
);

/* ==========================================================
   CONSTANTS
========================================================== */

test(
    "service-error constants expose standard defaults",
    function () {
        assert.equal(
            constants
                .DEFAULT_ERROR_CODE,
            "internal"
        );

        assert.equal(
            constants
                .DEFAULT_HTTP_STATUS,
            500
        );

        assert.equal(
            constants
                .ERROR_DEFINITIONS
                ["payment-failed"]
                .status,
            402
        );

        assert.equal(
            constants
                .HTTP_STATUS_TO_CODE
                [404],
            "not-found"
        );

        assert.equal(
            constants
                .FIREBASE_CODE_ALIASES
                ["auth/id-token-expired"],
            "unauthenticated"
        );
    }
);