"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   SHARED TEST ASSERTIONS

   Supports:
   - Service error assertions
   - Firestore document assertions
   - Firestore write assertions
   - Auth user and write assertions
   - Provider call assertions
   - HTTP response assertions
   - Order state assertions
   - Audit log assertions
   - Sensitive-data assertions
========================================================== */

const assert = require(
    "node:assert/strict"
);

/* ==========================================================
   GENERAL VALUE HELPERS
========================================================== */

function isPlainObject(value) {
    if (
        value === null ||
        typeof value !== "object"
    ) {
        return false;
    }

    const prototype =
        Object.getPrototypeOf(value);

    return (
        prototype ===
            Object.prototype ||
        prototype === null
    );
}

function cloneValue(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    if (Buffer.isBuffer(value)) {
        return Buffer.from(value);
    }

    if (value instanceof Date) {
        return new Date(
            value.getTime()
        );
    }

    if (Array.isArray(value)) {
        return value.map(
            cloneValue
        );
    }

    if (isPlainObject(value)) {
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

function getNestedField(
    source,
    path
) {
    return String(path)
        .split(".")
        .filter(Boolean)
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
            source
        );
}

function serializeValue(value) {
    try {
        return JSON.stringify(
            value,
            function (
                key,
                current
            ) {
                if (
                    Buffer.isBuffer(
                        current
                    )
                ) {
                    return current.toString(
                        "base64"
                    );
                }

                if (
                    current &&
                    typeof current.toDate ===
                        "function"
                ) {
                    return current
                        .toDate()
                        .toISOString();
                }

                return current;
            }
        );
    } catch {
        return String(value);
    }
}

function normalizeExpectedCode(code) {
    return String(
        code || ""
    )
        .trim()
        .toLowerCase()
        .replace(
            /_/g,
            "-"
        );
}

/* ==========================================================
   ERROR ASSERTIONS
========================================================== */

async function assertRejectsWithCode(
    promise,
    expectedCode,
    options
) {
    const settings =
        options || {};

    return assert.rejects(
        promise,
        function (error) {
            const actualCode =
                normalizeExpectedCode(
                    error &&
                    error.code
                );

            const normalizedExpected =
                normalizeExpectedCode(
                    expectedCode
                );

            assert.equal(
                actualCode,
                normalizedExpected,
                settings.message ||
                (
                    "Expected error code " +
                    normalizedExpected +
                    " but received " +
                    actualCode
                )
            );

            if (
                settings.status !==
                undefined
            ) {
                assert.equal(
                    error.status,
                    settings.status,
                    "Unexpected error status."
                );
            }

            if (
                settings.messageIncludes
            ) {
                assert.match(
                    String(
                        error.publicMessage ||
                        error.message ||
                        ""
                    ),
                    toRegExp(
                        settings
                            .messageIncludes
                    )
                );
            }

            if (
                settings.details !==
                undefined
            ) {
                assert.deepEqual(
                    error.details,
                    settings.details
                );
            }

            if (
                typeof settings.validate ===
                "function"
            ) {
                settings.validate(
                    error
                );
            }

            return true;
        }
    );
}

async function assertRejectsMatching(
    promise,
    expected,
    message
) {
    return assert.rejects(
        promise,
        function (error) {
            const serialized =
                [
                    error &&
                    error.code,
                    error &&
                    error.message,
                    error &&
                    error.publicMessage,
                    serializeValue(
                        error &&
                        error.details
                    )
                ].join(" ");

            assert.match(
                serialized,
                toRegExp(expected),
                message
            );

            return true;
        }
    );
}

function assertSafeError(
    error,
    forbiddenValues
) {
    const serialized =
        serializeValue({
            code:
                error &&
                error.code,

            message:
                error &&
                error.message,

            publicMessage:
                error &&
                error.publicMessage,

            details:
                error &&
                error.details
        });

    (
        forbiddenValues || []
    ).forEach(
        function (value) {
            assert.doesNotMatch(
                serialized,
                toRegExp(
                    escapeRegExp(
                        String(value)
                    )
                ),
                "Error exposed a sensitive value."
            );
        }
    );
}

/* ==========================================================
   FIRESTORE DOCUMENT ASSERTIONS
========================================================== */

function assertDocumentExists(
    harness,
    path,
    expectedFields
) {
    assert.ok(
        harness,
        "A Firestore harness is required."
    );

    assert.equal(
        harness.hasDocument(path),
        true,
        "Expected document to exist: " +
        path
    );

    const document =
        harness.getDocument(path);

    if (
        expectedFields !==
        undefined
    ) {
        assertObjectContains(
            document,
            expectedFields,
            "Document mismatch at " +
            path
        );
    }

    return document;
}

function assertDocumentMissing(
    harness,
    path
) {
    assert.equal(
        harness.hasDocument(path),
        false,
        "Expected document to be missing: " +
        path
    );
}

function assertDocumentField(
    harness,
    path,
    fieldPath,
    expected
) {
    const document =
        assertDocumentExists(
            harness,
            path
        );

    assert.deepEqual(
        getNestedField(
            document,
            fieldPath
        ),
        expected,
        "Unexpected field value at " +
        path +
        "." +
        fieldPath
    );
}

function assertCollectionSize(
    harness,
    collectionPath,
    expectedSize
) {
    const documents =
        harness.listDocuments(
            collectionPath
        );

    assert.equal(
        documents.length,
        expectedSize,
        "Unexpected document count in " +
        collectionPath
    );

    return documents;
}

/* ==========================================================
   FIRESTORE WRITE ASSERTIONS
========================================================== */

function assertFirestoreWrite(
    harness,
    expected
) {
    const match =
        findMatchingWrite(
            harness.writes ||
            [],
            expected
        );

    assert.ok(
        match,
        "Expected Firestore write was not found:\n" +
        serializeValue(expected) +
        "\nActual writes:\n" +
        serializeValue(
            harness.writes ||
            []
        )
    );

    return match;
}

function assertNoFirestoreWrite(
    harness,
    expected
) {
    const match =
        findMatchingWrite(
            harness.writes ||
            [],
            expected
        );

    assert.equal(
        match,
        undefined,
        "Unexpected Firestore write found:\n" +
        serializeValue(match)
    );
}

function assertFirestoreWriteCount(
    harness,
    expectedCount,
    predicate
) {
    const writes =
        predicate
            ? (
                  harness.writes ||
                  []
              ).filter(predicate)
            : (
                  harness.writes ||
                  []
              );

    assert.equal(
        writes.length,
        expectedCount,
        "Unexpected Firestore write count."
    );

    return writes;
}

function findMatchingWrite(
    writes,
    expected
) {
    return writes.find(
        function (write) {
            if (
                expected.operation &&
                write.operation !==
                    expected.operation
            ) {
                return false;
            }

            if (
                expected.path &&
                write.path !==
                    expected.path
            ) {
                return false;
            }

            if (
                expected.collection &&
                write.collection !==
                    expected.collection
            ) {
                return false;
            }

            if (
                expected.documentId &&
                write.documentId !==
                    expected.documentId
            ) {
                return false;
            }

            if (
                expected.data !==
                    undefined
            ) {
                try {
                    assertObjectContains(
                        write.data,
                        expected.data
                    );
                } catch {
                    return false;
                }
            }

            if (
                typeof expected.predicate ===
                "function" &&
                !expected.predicate(
                    write
                )
            ) {
                return false;
            }

            return true;
        }
    );
}

/* ==========================================================
   AUTH ASSERTIONS
========================================================== */

function assertAuthUser(
    harness,
    userId,
    expected
) {
    const user =
        harness.getUser(
            userId
        );

    assert.ok(
        user,
        "Expected Auth user to exist: " +
        userId
    );

    if (expected) {
        assertObjectContains(
            user,
            expected,
            "Auth user mismatch: " +
            userId
        );
    }

    return user;
}

function assertAuthUserMissing(
    harness,
    userId
) {
    assert.equal(
        harness.hasUser(userId),
        false,
        "Expected Auth user to be missing: " +
        userId
    );
}

function assertAuthClaims(
    harness,
    userId,
    expectedClaims
) {
    const user =
        assertAuthUser(
            harness,
            userId
        );

    assertObjectContains(
        user.customClaims ||
        {},
        expectedClaims,
        "Unexpected custom claims for " +
        userId
    );

    return user.customClaims;
}

function assertAuthWrite(
    harness,
    expected
) {
    const writes =
        harness.writes ||
        [];

    const match =
        writes.find(
            function (write) {
                if (
                    expected.operation &&
                    write.operation !==
                        expected.operation
                ) {
                    return false;
                }

                if (
                    expected.userId &&
                    write.userId !==
                        expected.userId
                ) {
                    return false;
                }

                if (
                    expected.claims !==
                    undefined
                ) {
                    try {
                        assertObjectContains(
                            write.claims,
                            expected.claims
                        );
                    } catch {
                        return false;
                    }
                }

                if (
                    expected.changes !==
                    undefined
                ) {
                    try {
                        assertObjectContains(
                            write.changes,
                            expected.changes
                        );
                    } catch {
                        return false;
                    }
                }

                if (
                    typeof expected.predicate ===
                    "function" &&
                    !expected.predicate(
                        write
                    )
                ) {
                    return false;
                }

                return true;
            }
        );

    assert.ok(
        match,
        "Expected Auth write was not found:\n" +
        serializeValue(expected) +
        "\nActual writes:\n" +
        serializeValue(writes)
    );

    return match;
}

function assertNoAuthWrite(
    harness,
    predicate
) {
    const writes =
        (
            harness.writes ||
            []
        ).filter(
            predicate ||
            function () {
                return true;
            }
        );

    assert.equal(
        writes.length,
        0,
        "Unexpected Auth writes:\n" +
        serializeValue(writes)
    );
}

/* ==========================================================
   PROVIDER ASSERTIONS
========================================================== */

function assertProviderCall(
    harness,
    expected
) {
    const calls =
        harness.calls ||
        [];

    const match =
        calls.find(
            function (call) {
                if (
                    expected.method &&
                    call.method !==
                    String(
                        expected.method
                    ).toUpperCase()
                ) {
                    return false;
                }

                if (
                    expected.url &&
                    !matchesExpected(
                        call.url,
                        expected.url
                    )
                ) {
                    return false;
                }

                if (
                    expected.headers
                ) {
                    const headers =
                        Object.keys(
                            expected.headers
                        );

                    const valid =
                        headers.every(
                            function (name) {
                                return matchesExpected(
                                    call.headers[
                                        String(name)
                                            .toLowerCase()
                                    ],
                                    expected.headers[
                                        name
                                    ]
                                );
                            }
                        );

                    if (!valid) {
                        return false;
                    }
                }

                if (
                    expected.body !==
                    undefined
                ) {
                    if (
                        typeof expected.body ===
                        "function"
                    ) {
                        if (
                            !expected.body(
                                call.body
                            )
                        ) {
                            return false;
                        }
                    } else {
                        try {
                            assertObjectContains(
                                call.body,
                                expected.body
                            );
                        } catch {
                            return false;
                        }
                    }
                }

                if (
                    typeof expected.predicate ===
                    "function" &&
                    !expected.predicate(
                        call
                    )
                ) {
                    return false;
                }

                return true;
            }
        );

    assert.ok(
        match,
        "Expected provider call was not found:\n" +
        serializeValue(expected) +
        "\nActual calls:\n" +
        serializeValue(calls)
    );

    return cloneValue(match);
}

function assertProviderCallCount(
    harness,
    expectedCount,
    predicate
) {
    const calls =
        predicate
            ? (
                  harness.calls ||
                  []
              ).filter(predicate)
            : (
                  harness.calls ||
                  []
              );

    assert.equal(
        calls.length,
        expectedCount,
        "Unexpected provider call count."
    );

    return calls;
}

function assertNoProviderCall(
    harness,
    predicate
) {
    const calls =
        (
            harness.calls ||
            []
        ).filter(
            predicate ||
            function () {
                return true;
            }
        );

    assert.equal(
        calls.length,
        0,
        "Unexpected provider calls:\n" +
        serializeValue(calls)
    );
}

/* ==========================================================
   HTTP ASSERTIONS
========================================================== */

function assertHttpResponse(
    result,
    expected
) {
    const settings =
        expected || {};

    if (
        settings.status !==
        undefined
    ) {
        assert.equal(
            result.statusCode,
            settings.status,
            "Unexpected HTTP status."
        );
    }

    if (
        settings.sent !==
        undefined
    ) {
        assert.equal(
            result.sent,
            settings.sent,
            "Unexpected response sent state."
        );
    }

    if (
        settings.json !==
        undefined
    ) {
        assertObjectContains(
            result.json,
            settings.json,
            "Unexpected JSON response."
        );
    }

    if (
        settings.body !==
        undefined
    ) {
        assertObjectContains(
            result.body,
            settings.body,
            "Unexpected response body."
        );
    }

    if (
        settings.textMatches
    ) {
        assert.match(
            String(
                result.text ||
                ""
            ),
            toRegExp(
                settings.textMatches
            )
        );
    }

    if (
        settings.headers
    ) {
        Object.keys(
            settings.headers
        ).forEach(
            function (name) {
                const actual =
                    result.headers[
                        String(name)
                            .toLowerCase()
                    ];

                assert.ok(
                    matchesExpected(
                        actual,
                        settings.headers[
                            name
                        ]
                    ),
                    "Unexpected response header: " +
                    name
                );
            }
        );
    }

    return result;
}

function assertSuccessResponse(
    result,
    expectedData
) {
    assert.equal(
        result.statusCode,
        200
    );

    assert.equal(
        result.json.success,
        true
    );

    if (
        expectedData !==
        undefined
    ) {
        assertObjectContains(
            result.json.data,
            expectedData
        );
    }

    return result.json;
}

function assertErrorResponse(
    result,
    expected
) {
    const settings =
        expected || {};

    assert.equal(
        result.json.success,
        false
    );

    if (
        settings.status !==
        undefined
    ) {
        assert.equal(
            result.statusCode,
            settings.status
        );
    }

    if (settings.code) {
        assert.equal(
            normalizeExpectedCode(
                result.json.error.code
            ),
            normalizeExpectedCode(
                settings.code
            )
        );
    }

    if (
        settings.messageMatches
    ) {
        assert.match(
            String(
                result.json.error
                    .message ||
                ""
            ),
            toRegExp(
                settings.messageMatches
            )
        );
    }

    return result.json.error;
}

/* ==========================================================
   ORDER ASSERTIONS
========================================================== */

function assertOrderState(
    order,
    expected
) {
    assert.ok(
        order,
        "An order is required."
    );

    const settings =
        expected || {};

    [
        "id",
        "userId",
        "status",
        "paymentStatus",
        "currency",
        "subtotal",
        "discount",
        "deliveryFee",
        "tax",
        "total",
        "inventoryRestored"
    ].forEach(
        function (field) {
            if (
                Object.prototype
                    .hasOwnProperty
                    .call(
                        settings,
                        field
                    )
            ) {
                assert.deepEqual(
                    order[field],
                    settings[field],
                    "Unexpected order field: " +
                    field
                );
            }
        }
    );

    if (
        settings.itemCount !==
        undefined
    ) {
        assert.equal(
            Array.isArray(
                order.items
            )
                ? order.items.length
                : 0,
            settings.itemCount,
            "Unexpected order item count."
        );
    }

    if (
        settings.statusHistory
    ) {
        const statuses =
            (
                order.statusHistory ||
                []
            ).map(
                function (entry) {
                    return entry.status;
                }
            );

        assert.deepEqual(
            statuses,
            settings.statusHistory
        );
    }

    if (
        settings.tracking
    ) {
        assertObjectContains(
            order.tracking,
            settings.tracking
        );
    }

    if (
        settings.payment
    ) {
        assertObjectContains(
            order.payment,
            settings.payment
        );
    }

    return order;
}

function assertOrderTotals(
    order,
    expected
) {
    const fields = [
        "subtotal",
        "discount",
        "deliveryFee",
        "tax",
        "total"
    ];

    fields.forEach(
        function (field) {
            if (
                Object.prototype
                    .hasOwnProperty
                    .call(
                        expected,
                        field
                    )
            ) {
                assert.equal(
                    order[field],
                    expected[field],
                    "Unexpected order total field: " +
                    field
                );
            }
        }
    );

    const calculated =
        Number(
            order.subtotal ||
            0
        ) -
        Number(
            order.discount ||
            0
        ) +
        Number(
            order.deliveryFee ||
            0
        ) +
        Number(
            order.tax ||
            0
        );

    assert.equal(
        order.total,
        calculated,
        "Order total does not equal its component totals."
    );
}

function assertInventory(
    harness,
    productId,
    expected
) {
    const product =
        assertDocumentExists(
            harness,
            "products/" +
            productId
        );

    if (
        expected.inventory !==
        undefined
    ) {
        assert.equal(
            product.inventory,
            expected.inventory
        );
    }

    if (
        expected.stock !==
        undefined
    ) {
        assert.equal(
            product.stock,
            expected.stock
        );
    }

    if (
        expected.variantId
    ) {
        const variant =
            (
                product.variants ||
                []
            ).find(
                function (item) {
                    return item.id ===
                        expected.variantId;
                }
            );

        assert.ok(
            variant,
            "Expected product variant was not found: " +
            expected.variantId
        );

        if (
            expected.variantInventory !==
            undefined
        ) {
            assert.equal(
                variant.inventory,
                expected.variantInventory
            );
        }

        if (
            expected.variantStock !==
            undefined
        ) {
            assert.equal(
                variant.stock,
                expected.variantStock
            );
        }
    }

    return product;
}

/* ==========================================================
   AUDIT ASSERTIONS
========================================================== */

function assertAuditEntry(
    harness,
    expected
) {
    const entries =
        harness.listDocuments(
            "auditLogs"
        );

    const match =
        entries.find(
            function (entry) {
                const data =
                    entry.data;

                if (
                    expected.action &&
                    !matchesExpected(
                        data.action,
                        expected.action
                    )
                ) {
                    return false;
                }

                if (
                    expected.targetId &&
                    data.targetId !==
                        expected.targetId
                ) {
                    return false;
                }

                if (
                    expected.actorId
                ) {
                    const actorId =
                        data.actorId ||
                        data.performedBy ||
                        (
                            data.actor &&
                            data.actor.userId
                        );

                    if (
                        actorId !==
                        expected.actorId
                    ) {
                        return false;
                    }
                }

                if (
                    expected.metadata
                ) {
                    try {
                        assertObjectContains(
                            data.metadata,
                            expected.metadata
                        );
                    } catch {
                        return false;
                    }
                }

                if (
                    typeof expected.predicate ===
                    "function" &&
                    !expected.predicate(
                        data,
                        entry
                    )
                ) {
                    return false;
                }

                return true;
            }
        );

    assert.ok(
        match,
        "Expected audit entry was not found:\n" +
        serializeValue(expected) +
        "\nActual audit entries:\n" +
        serializeValue(entries)
    );

    return match.data;
}

/* ==========================================================
   DATA SAFETY ASSERTIONS
========================================================== */

function assertDoesNotContainKeys(
    value,
    forbiddenKeys
) {
    const normalizedKeys =
        new Set(
            (
                forbiddenKeys ||
                []
            ).map(
                function (key) {
                    return String(key)
                        .toLowerCase();
                }
            )
        );

    walkValue(
        value,
        function (
            current,
            path
        ) {
            if (
                !isPlainObject(
                    current
                )
            ) {
                return;
            }

            Object.keys(current)
                .forEach(
                    function (key) {
                        assert.equal(
                            normalizedKeys.has(
                                key.toLowerCase()
                            ),
                            false,
                            "Forbidden key found at " +
                            path.concat(key)
                                .join(".")
                        );
                    }
                );
        }
    );
}

function assertDoesNotContainValues(
    value,
    forbiddenValues
) {
    const serialized =
        serializeValue(value);

    (
        forbiddenValues ||
        []
    ).forEach(
        function (forbidden) {
            assert.doesNotMatch(
                serialized,
                toRegExp(
                    escapeRegExp(
                        String(
                            forbidden
                        )
                    )
                ),
                "Sensitive value was exposed."
            );
        }
    );
}

function assertPaymentSanitized(
    value
) {
    assertDoesNotContainKeys(
        value,
        [
            "authorizationCode",
            "authorization_code",
            "secretKey",
            "secret_key",
            "apiKey",
            "api_key",
            "cardNumber",
            "card_number",
            "cvv",
            "pin"
        ]
    );
}

function assertValidTimestamp(
    value,
    message
) {
    const valid =
        value instanceof Date ||
        (
            value &&
            typeof value.toDate ===
                "function"
        ) ||
        (
            typeof value ===
                "string" &&
            !Number.isNaN(
                Date.parse(value)
            )
        );

    assert.equal(
        valid,
        true,
        message ||
        "Expected a valid timestamp."
    );
}

/* ==========================================================
   PARTIAL OBJECT ASSERTIONS
========================================================== */

function assertObjectContains(
    actual,
    expected,
    message
) {
    if (
        expected === null ||
        typeof expected !==
            "object"
    ) {
        assert.deepEqual(
            actual,
            expected,
            message
        );

        return;
    }

    assert.ok(
        actual !== null &&
        typeof actual ===
            "object",
        message ||
        "Expected an object."
    );

    if (
        Array.isArray(expected)
    ) {
        assert.ok(
            Array.isArray(actual),
            message ||
            "Expected an array."
        );

        assert.equal(
            actual.length,
            expected.length,
            message ||
            "Unexpected array length."
        );

        expected.forEach(
            function (
                value,
                index
            ) {
                assertObjectContains(
                    actual[index],
                    value,
                    message
                );
            }
        );

        return;
    }

    Object.keys(expected)
        .forEach(
            function (key) {
                assert.ok(
                    Object.prototype
                        .hasOwnProperty
                        .call(
                            actual,
                            key
                        ),
                    (
                        message
                            ? message +
                              ": "
                            : ""
                    ) +
                    "Missing property " +
                    key
                );

                assertObjectContains(
                    actual[key],
                    expected[key],
                    message
                );
            }
        );
}

/* ==========================================================
   INTERNAL HELPERS
========================================================== */

function matchesExpected(
    actual,
    expected
) {
    if (
        expected instanceof
        RegExp
    ) {
        return expected.test(
            String(actual)
        );
    }

    if (
        typeof expected ===
        "function"
    ) {
        return Boolean(
            expected(actual)
        );
    }

    try {
        assertObjectContains(
            actual,
            expected
        );

        return true;
    } catch {
        return false;
    }
}

function walkValue(
    value,
    callback,
    path
) {
    const currentPath =
        path || [];

    callback(
        value,
        currentPath
    );

    if (Array.isArray(value)) {
        value.forEach(
            function (
                item,
                index
            ) {
                walkValue(
                    item,
                    callback,
                    currentPath.concat(
                        String(index)
                    )
                );
            }
        );

        return;
    }

    if (isPlainObject(value)) {
        Object.keys(value)
            .forEach(
                function (key) {
                    walkValue(
                        value[key],
                        callback,
                        currentPath.concat(
                            key
                        )
                    );
                }
            );
    }
}

function toRegExp(value) {
    return value instanceof
        RegExp
        ? value
        : new RegExp(
              String(value),
              "i"
          );
}

function escapeRegExp(value) {
    return String(value)
        .replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
        );
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    assertRejectsWithCode,
    assertRejectsMatching,
    assertSafeError,
    assertDocumentExists,
    assertDocumentMissing,
    assertDocumentField,
    assertCollectionSize,
    assertFirestoreWrite,
    assertNoFirestoreWrite,
    assertFirestoreWriteCount,
    assertAuthUser,
    assertAuthUserMissing,
    assertAuthClaims,
    assertAuthWrite,
    assertNoAuthWrite,
    assertProviderCall,
    assertProviderCallCount,
    assertNoProviderCall,
    assertHttpResponse,
    assertSuccessResponse,
    assertErrorResponse,
    assertOrderState,
    assertOrderTotals,
    assertInventory,
    assertAuditEntry,
    assertDoesNotContainKeys,
    assertDoesNotContainValues,
    assertPaymentSanitized,
    assertValidTimestamp,
    assertObjectContains,
    getNestedField,
    cloneValue
};