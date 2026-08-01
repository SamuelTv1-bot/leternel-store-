"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   TEST HELPERS BARREL EXPORT
========================================================== */

const firestore =
    require(
        "./firestore-test-harness"
    );

const auth =
    require(
        "./auth-test-harness"
    );

const http =
    require(
        "./http-test-harness"
    );

const providers =
    require(
        "./provider-fetch-harness"
    );

const serviceContext =
    require(
        "./service-test-context"
    );

const assertions =
    require(
        "./assertions"
    );

const fixtures =
    require(
        "./fixtures"
    );

/* ==========================================================
   GROUPED EXPORTS
========================================================== */

module.exports = {
    firestore,
    auth,
    http,
    providers,
    serviceContext,
    assertions,
    fixtures,

    /* ======================================================
       FIRESTORE HARNESS
    ====================================================== */

    createFirestoreHarness:
        firestore
            .createFirestoreHarness,

    TestTimestamp:
        firestore
            .TestTimestamp,

    FieldValue:
        firestore
            .FieldValue,

    FieldOperation:
        firestore
            .FieldOperation,

    getNestedField:
        firestore
            .getNestedField,

    setNestedField:
        firestore
            .setNestedField,

    deleteNestedField:
        firestore
            .deleteNestedField,

    compareValues:
        firestore
            .compareValues,

    /* ======================================================
       AUTH HARNESS
    ====================================================== */

    createAuthHarness:
        auth
            .createAuthHarness,

    createDefaultUser:
        auth
            .createDefaultUser,

    createAuthError:
        auth
            .createAuthError,

    normalizeEmail:
        auth
            .normalizeEmail,

    encodeTestToken:
        auth
            .encodeTestToken,

    decodeTestToken:
        auth
            .decodeTestToken,

    /* ======================================================
       HTTP HARNESS
    ====================================================== */

    createRequest:
        http
            .createRequest,

    createResponse:
        http
            .createResponse,

    createNext:
        http
            .createNext,

    executeHandler:
        http
            .executeHandler,

    createCorsPreflightRequest:
        http
            .createCorsPreflightRequest,

    createCallableRequest:
        http
            .createCallableRequest,

    normalizeHeaderName:
        http
            .normalizeHeaderName,

    normalizeHeaders:
        http
            .normalizeHeaders,

    parseCookieHeader:
        http
            .parseCookieHeader,

    serializeCookie:
        http
            .serializeCookie,

    resolveContentType:
        http
            .resolveContentType,

    /* ======================================================
       PROVIDER FETCH HARNESS
    ====================================================== */

    createProviderFetchHarness:
        providers
            .createProviderFetchHarness,

    createFetchResponse:
        providers
            .createFetchResponse,

    createHeaders:
        providers
            .createHeaders,

    normalizeRequest:
        providers
            .normalizeRequest,

    parseRequestBody:
        providers
            .parseRequestBody,

    bodyToBuffer:
        providers
            .bodyToBuffer,

    matchesRoute:
        providers
            .matchesRoute,

    matchValue:
        providers
            .matchValue,

    matchHeaders:
        providers
            .matchHeaders,

    createAbortError:
        providers
            .createAbortError,

    /* ======================================================
       SERVICE TEST CONTEXT
    ====================================================== */

    createServiceTestContext:
        serviceContext
            .createServiceTestContext,

    createServiceDependencies:
        serviceContext
            .createServiceDependencies,

    createAdministratorIdentity:
        serviceContext
            .createAdministratorIdentity,

    createAuthContext:
        serviceContext
            .createAuthContext,

    seedDefaultFixtures:
        serviceContext
            .seedDefaultFixtures,

    registerPaystackRoutes:
        serviceContext
            .registerPaystackRoutes,

    registerFlutterwaveRoutes:
        serviceContext
            .registerFlutterwaveRoutes,

    registerResendRoute:
        serviceContext
            .registerResendRoute,

    DEFAULT_CONFIGURATION:
        serviceContext
            .DEFAULT_CONFIGURATION,

    DEFAULT_NOW:
        serviceContext
            .DEFAULT_NOW,

    /* ======================================================
       ASSERTIONS
    ====================================================== */

    assertRejectsWithCode:
        assertions
            .assertRejectsWithCode,

    assertRejectsMatching:
        assertions
            .assertRejectsMatching,

    assertSafeError:
        assertions
            .assertSafeError,

    assertDocumentExists:
        assertions
            .assertDocumentExists,

    assertDocumentMissing:
        assertions
            .assertDocumentMissing,

    assertDocumentField:
        assertions
            .assertDocumentField,

    assertCollectionSize:
        assertions
            .assertCollectionSize,

    assertFirestoreWrite:
        assertions
            .assertFirestoreWrite,

    assertNoFirestoreWrite:
        assertions
            .assertNoFirestoreWrite,

    assertFirestoreWriteCount:
        assertions
            .assertFirestoreWriteCount,

    assertAuthUser:
        assertions
            .assertAuthUser,

    assertAuthUserMissing:
        assertions
            .assertAuthUserMissing,

    assertAuthClaims:
        assertions
            .assertAuthClaims,

    assertAuthWrite:
        assertions
            .assertAuthWrite,

    assertNoAuthWrite:
        assertions
            .assertNoAuthWrite,

    assertProviderCall:
        assertions
            .assertProviderCall,

    assertProviderCallCount:
        assertions
            .assertProviderCallCount,

    assertNoProviderCall:
        assertions
            .assertNoProviderCall,

    assertHttpResponse:
        assertions
            .assertHttpResponse,

    assertSuccessResponse:
        assertions
            .assertSuccessResponse,

    assertErrorResponse:
        assertions
            .assertErrorResponse,

    assertOrderState:
        assertions
            .assertOrderState,

    assertOrderTotals:
        assertions
            .assertOrderTotals,

    assertInventory:
        assertions
            .assertInventory,

    assertAuditEntry:
        assertions
            .assertAuditEntry,

    assertDoesNotContainKeys:
        assertions
            .assertDoesNotContainKeys,

    assertDoesNotContainValues:
        assertions
            .assertDoesNotContainValues,

    assertPaymentSanitized:
        assertions
            .assertPaymentSanitized,

    assertValidTimestamp:
        assertions
            .assertValidTimestamp,

    assertObjectContains:
        assertions
            .assertObjectContains,

    /* ======================================================
       FIXTURE CONSTANTS
    ====================================================== */

    FIXED_DATE:
        fixtures
            .FIXED_DATE,

    FIXED_DATE_MS:
        fixtures
            .FIXED_DATE_MS,

    DEFAULT_PASSWORD:
        fixtures
            .DEFAULT_PASSWORD,

    DEFAULT_CURRENCY:
        fixtures
            .DEFAULT_CURRENCY,

    CUSTOMER_ID:
        fixtures
            .CUSTOMER_ID,

    SECOND_CUSTOMER_ID:
        fixtures
            .SECOND_CUSTOMER_ID,

    ADMIN_ID:
        fixtures
            .ADMIN_ID,

    SUPERADMIN_ID:
        fixtures
            .SUPERADMIN_ID,

    PRODUCT_ID:
        fixtures
            .PRODUCT_ID,

    SECOND_PRODUCT_ID:
        fixtures
            .SECOND_PRODUCT_ID,

    ORDER_ID:
        fixtures
            .ORDER_ID,

    COUPON_ID:
        fixtures
            .COUPON_ID,

    /* ======================================================
       FIXTURE BUILDERS
    ====================================================== */

    createTimestamp:
        fixtures
            .createTimestamp,

    createCustomerUser:
        fixtures
            .createCustomerUser,

    createSecondCustomerUser:
        fixtures
            .createSecondCustomerUser,

    createAdministratorUser:
        fixtures
            .createAdministratorUser,

    createSuperAdministratorUser:
        fixtures
            .createSuperAdministratorUser,

    createUserProfile:
        fixtures
            .createUserProfile,

    createAddress:
        fixtures
            .createAddress,

    createProductVariant:
        fixtures
            .createProductVariant,

    createProduct:
        fixtures
            .createProduct,

    createSecondProduct:
        fixtures
            .createSecondProduct,

    createDraftProduct:
        fixtures
            .createDraftProduct,

    createOutOfStockProduct:
        fixtures
            .createOutOfStockProduct,

    createCategory:
        fixtures
            .createCategory,

    createCollection:
        fixtures
            .createCollection,

    createCoupon:
        fixtures
            .createCoupon,

    createExpiredCoupon:
        fixtures
            .createExpiredCoupon,

    createFixedCoupon:
        fixtures
            .createFixedCoupon,

    createOrderItem:
        fixtures
            .createOrderItem,

    createSecondOrderItem:
        fixtures
            .createSecondOrderItem,

    createCustomerDetails:
        fixtures
            .createCustomerDetails,

    createShippingAddress:
        fixtures
            .createShippingAddress,

    createPaymentDetails:
        fixtures
            .createPaymentDetails,

    createOrder:
        fixtures
            .createOrder,

    createPaidOrder:
        fixtures
            .createPaidOrder,

    createShippedOrder:
        fixtures
            .createShippedOrder,

    createCheckoutPayload:
        fixtures
            .createCheckoutPayload,

    createMultiItemCheckoutPayload:
        fixtures
            .createMultiItemCheckoutPayload,

    createPaystackInitializationResponse:
        fixtures
            .createPaystackInitializationResponse,

    createPaystackVerificationResponse:
        fixtures
            .createPaystackVerificationResponse,

    createFlutterwaveInitializationResponse:
        fixtures
            .createFlutterwaveInitializationResponse,

    createFlutterwaveVerificationResponse:
        fixtures
            .createFlutterwaveVerificationResponse,

    createPaystackWebhook:
        fixtures
            .createPaystackWebhook,

    createPaystackFailureWebhook:
        fixtures
            .createPaystackFailureWebhook,

    createPaystackRefundWebhook:
        fixtures
            .createPaystackRefundWebhook,

    createFlutterwaveWebhook:
        fixtures
            .createFlutterwaveWebhook,

    createEmailConfiguration:
        fixtures
            .createEmailConfiguration,

    createResendResponse:
        fixtures
            .createResendResponse,

    createAuditLog:
        fixtures
            .createAuditLog,

    createCatalogDocuments:
        fixtures
            .createCatalogDocuments,

    createAccountDocuments:
        fixtures
            .createAccountDocuments,

    createCommerceDocuments:
        fixtures
            .createCommerceDocuments,

    createInitialDocuments:
        fixtures
            .createInitialDocuments,

    createInitialUsers:
        fixtures
            .createInitialUsers,

    createFixtureSet:
        fixtures
            .createFixtureSet,

    /* ======================================================
       SHARED VALUE HELPERS
    ====================================================== */

    cloneValue:
        fixtures
            .cloneValue,

    mergeValue:
        fixtures
            .mergeValue,

    omitIdentifier:
        fixtures
            .omitIdentifier
};