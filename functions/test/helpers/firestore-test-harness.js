"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   IN-MEMORY FIRESTORE TEST HARNESS

   Supports:
   - Collections and document references
   - Document snapshots
   - Query snapshots
   - where, orderBy, limit, startAfter
   - Transactions
   - Write batches
   - FieldValue operations
   - Timestamp-compatible values
   - Nested field paths
   - Test inspection helpers
========================================================== */

/* ==========================================================
   SPECIAL VALUE TYPES
========================================================== */

const DELETE_FIELD =
    Symbol("delete-field");

class TestTimestamp {
    constructor(milliseconds) {
        this._milliseconds =
            Number(milliseconds);
    }

    static now() {
        return new TestTimestamp(
            Date.now()
        );
    }

    static fromDate(date) {
        if (
            !(date instanceof Date) ||
            Number.isNaN(
                date.getTime()
            )
        ) {
            throw new TypeError(
                "TestTimestamp.fromDate requires a valid Date."
            );
        }

        return new TestTimestamp(
            date.getTime()
        );
    }

    static fromMillis(milliseconds) {
        return new TestTimestamp(
            milliseconds
        );
    }

    toDate() {
        return new Date(
            this._milliseconds
        );
    }

    toMillis() {
        return this._milliseconds;
    }

    isEqual(other) {
        return (
            other instanceof
                TestTimestamp &&
            other.toMillis() ===
                this.toMillis()
        );
    }

    valueOf() {
        return this._milliseconds;
    }

    toJSON() {
        return this.toDate()
            .toISOString();
    }
}

class FieldOperation {
    constructor(type, value) {
        this.type =
            type;

        this.value =
            value;
    }
}

const FieldValue = {
    serverTimestamp:
        function () {
            return new FieldOperation(
                "serverTimestamp"
            );
        },

    increment:
        function (amount) {
            return new FieldOperation(
                "increment",
                Number(amount)
            );
        },

    arrayUnion:
        function (...values) {
            return new FieldOperation(
                "arrayUnion",
                values
            );
        },

    arrayRemove:
        function (...values) {
            return new FieldOperation(
                "arrayRemove",
                values
            );
        },

    delete:
        function () {
            return new FieldOperation(
                "delete"
            );
        }
};

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

function isTimestampLike(value) {
    return Boolean(
        value &&
        typeof value.toDate ===
            "function" &&
        typeof value.toMillis ===
            "function"
    );
}

function cloneValue(value) {
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
        value instanceof
            FieldOperation
    ) {
        return new FieldOperation(
            value.type,
            cloneValue(value.value)
        );
    }

    if (
        Buffer.isBuffer(value)
    ) {
        return Buffer.from(value);
    }

    if (
        Array.isArray(value)
    ) {
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

function deepEqual(first, second) {
    if (
        first === second
    ) {
        return true;
    }

    if (
        first instanceof Date &&
        second instanceof Date
    ) {
        return (
            first.getTime() ===
            second.getTime()
        );
    }

    if (
        isTimestampLike(first) &&
        isTimestampLike(second)
    ) {
        return (
            first.toMillis() ===
            second.toMillis()
        );
    }

    if (
        Array.isArray(first) &&
        Array.isArray(second)
    ) {
        return (
            first.length ===
                second.length &&
            first.every(
                function (
                    value,
                    index
                ) {
                    return deepEqual(
                        value,
                        second[index]
                    );
                }
            )
        );
    }

    if (
        isPlainObject(first) &&
        isPlainObject(second)
    ) {
        const firstKeys =
            Object.keys(first);

        const secondKeys =
            Object.keys(second);

        return (
            firstKeys.length ===
                secondKeys.length &&
            firstKeys.every(
                function (key) {
                    return (
                        Object.prototype
                            .hasOwnProperty
                            .call(
                                second,
                                key
                            ) &&
                        deepEqual(
                            first[key],
                            second[key]
                        )
                    );
                }
            )
        );
    }

    return false;
}

function comparableValue(value) {
    if (
        isTimestampLike(value)
    ) {
        return value.toMillis();
    }

    if (
        value instanceof Date
    ) {
        return value.getTime();
    }

    return value;
}

function compareValues(
    first,
    second
) {
    const left =
        comparableValue(first);

    const right =
        comparableValue(second);

    if (left === right) {
        return 0;
    }

    if (
        left === undefined ||
        left === null
    ) {
        return -1;
    }

    if (
        right === undefined ||
        right === null
    ) {
        return 1;
    }

    return left < right
        ? -1
        : 1;
}

/* ==========================================================
   FIELD PATH HELPERS
========================================================== */

function normalizeFieldPath(path) {
    if (
        Array.isArray(path)
    ) {
        return path.map(String);
    }

    return String(path)
        .split(".")
        .filter(Boolean);
}

function getNestedField(
    source,
    path
) {
    return normalizeFieldPath(path)
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

                return current[segment];
            },
            source
        );
}

function setNestedField(
    target,
    path,
    value
) {
    const segments =
        normalizeFieldPath(path);

    if (!segments.length) {
        return;
    }

    let current =
        target;

    segments
        .slice(0, -1)
        .forEach(
            function (segment) {
                if (
                    !isPlainObject(
                        current[segment]
                    )
                ) {
                    current[segment] =
                        {};
                }

                current =
                    current[segment];
            }
        );

    current[
        segments[
            segments.length - 1
        ]
    ] =
        value;
}

function deleteNestedField(
    target,
    path
) {
    const segments =
        normalizeFieldPath(path);

    if (!segments.length) {
        return;
    }

    let current =
        target;

    for (
        let index = 0;
        index <
        segments.length - 1;
        index += 1
    ) {
        current =
            current[
                segments[index]
            ];

        if (
            !current ||
            typeof current !==
                "object"
        ) {
            return;
        }
    }

    delete current[
        segments[
            segments.length - 1
        ]
    ];
}

/* ==========================================================
   WRITE TRANSFORMATION
========================================================== */

function resolveFieldOperation(
    operation,
    currentValue,
    clock
) {
    switch (operation.type) {
        case "serverTimestamp":
            return TestTimestamp
                .fromMillis(
                    clock()
                );

        case "increment":
            return (
                Number(
                    currentValue || 0
                ) +
                Number(
                    operation.value || 0
                )
            );

        case "arrayUnion": {
            const current =
                Array.isArray(
                    currentValue
                )
                    ? cloneValue(
                          currentValue
                      )
                    : [];

            operation.value
                .forEach(
                    function (value) {
                        if (
                            !current.some(
                                function (
                                    existing
                                ) {
                                    return deepEqual(
                                        existing,
                                        value
                                    );
                                }
                            )
                        ) {
                            current.push(
                                cloneValue(value)
                            );
                        }
                    }
                );

            return current;
        }

        case "arrayRemove": {
            const current =
                Array.isArray(
                    currentValue
                )
                    ? currentValue
                    : [];

            return current.filter(
                function (existing) {
                    return !operation.value
                        .some(
                            function (
                                value
                            ) {
                                return deepEqual(
                                    existing,
                                    value
                                );
                            }
                        );
                }
            );
        }

        case "delete":
            return DELETE_FIELD;

        default:
            throw new Error(
                "Unsupported FieldValue operation: " +
                operation.type
            );
    }
}

function transformWriteValue(
    incoming,
    existing,
    clock
) {
    if (
        incoming instanceof
            FieldOperation
    ) {
        return resolveFieldOperation(
            incoming,
            existing,
            clock
        );
    }

    if (Array.isArray(incoming)) {
        return incoming.map(
            function (value) {
                return transformWriteValue(
                    value,
                    undefined,
                    clock
                );
            }
        );
    }

    if (isPlainObject(incoming)) {
        const output = {};

        Object.keys(incoming)
            .forEach(
                function (key) {
                    const transformed =
                        transformWriteValue(
                            incoming[key],
                            existing &&
                            typeof existing ===
                                "object"
                                ? existing[key]
                                : undefined,
                            clock
                        );

                    if (
                        transformed !==
                        DELETE_FIELD
                    ) {
                        output[key] =
                            transformed;
                    }
                }
            );

        return output;
    }

    return cloneValue(incoming);
}

function applyUpdate(
    existing,
    update,
    clock
) {
    const output =
        cloneValue(
            existing || {}
        );

    Object.keys(update || {})
        .forEach(
            function (fieldPath) {
                const currentValue =
                    getNestedField(
                        output,
                        fieldPath
                    );

                const transformed =
                    transformWriteValue(
                        update[fieldPath],
                        currentValue,
                        clock
                    );

                if (
                    transformed ===
                    DELETE_FIELD
                ) {
                    deleteNestedField(
                        output,
                        fieldPath
                    );

                    return;
                }

                setNestedField(
                    output,
                    fieldPath,
                    transformed
                );
            }
        );

    return output;
}

function applyMerge(
    existing,
    incoming,
    clock
) {
    const output =
        cloneValue(
            existing || {}
        );

    Object.keys(incoming || {})
        .forEach(
            function (key) {
                const currentValue =
                    output[key];

                const incomingValue =
                    incoming[key];

                if (
                    incomingValue instanceof
                        FieldOperation
                ) {
                    const transformed =
                        resolveFieldOperation(
                            incomingValue,
                            currentValue,
                            clock
                        );

                    if (
                        transformed ===
                        DELETE_FIELD
                    ) {
                        delete output[key];
                    } else {
                        output[key] =
                            transformed;
                    }

                    return;
                }

                if (
                    isPlainObject(
                        incomingValue
                    ) &&
                    isPlainObject(
                        currentValue
                    )
                ) {
                    output[key] =
                        applyMerge(
                            currentValue,
                            incomingValue,
                            clock
                        );

                    return;
                }

                output[key] =
                    transformWriteValue(
                        incomingValue,
                        currentValue,
                        clock
                    );
            }
        );

    return output;
}

/* ==========================================================
   SNAPSHOTS
========================================================== */

function createDocumentSnapshot(
    reference,
    storedValue
) {
    const exists =
        storedValue !==
        undefined;

    return {
        id:
            reference.id,

        ref:
            reference,

        exists:
            exists,

        data:
            function () {
                return exists
                    ? cloneValue(
                          storedValue
                      )
                    : undefined;
            },

        get:
            function (fieldPath) {
                if (!exists) {
                    return undefined;
                }

                return cloneValue(
                    getNestedField(
                        storedValue,
                        fieldPath
                    )
                );
            }
    };
}

function createQuerySnapshot(
    snapshots
) {
    return {
        size:
            snapshots.length,

        empty:
            snapshots.length ===
            0,

        docs:
            snapshots,

        forEach:
            function (callback) {
                snapshots.forEach(
                    callback
                );
            }
    };
}

/* ==========================================================
   ERROR HELPERS
========================================================== */

function createFirestoreError(
    code,
    message
) {
    const error =
        new Error(message);

    error.code =
        code;

    return error;
}

/* ==========================================================
   HARNESS
========================================================== */

function createFirestoreHarness(options) {
    const settings =
        options || {};

    const documents =
        new Map();

    const writes = [];

    let generatedId =
        Number(
            settings.startingId ||
            0
        );

    const clock =
        typeof settings.clock ===
            "function"
            ? settings.clock
            : Date.now;

    Object.keys(
        settings.documents ||
        settings.initialDocuments ||
        {}
    ).forEach(
        function (path) {
            documents.set(
                normalizeDocumentPath(
                    path
                ),
                cloneValue(
                    (
                        settings.documents ||
                        settings.initialDocuments
                    )[path]
                )
            );
        }
    );

    function recordWrite(
        operation,
        reference,
        data,
        writeOptions
    ) {
        writes.push({
            operation:
                operation,

            path:
                reference.path,

            collection:
                reference.parent.id,

            documentId:
                reference.id,

            data:
                data === undefined
                    ? undefined
                    : cloneValue(data),

            options:
                writeOptions
                    ? cloneValue(
                          writeOptions
                      )
                    : null,

            timestamp:
                TestTimestamp
                    .fromMillis(
                        clock()
                    )
        });
    }

    function createDocumentReference(
        documentPath
    ) {
        const normalizedPath =
            normalizeDocumentPath(
                documentPath
            );

        const segments =
            normalizedPath.split("/");

        if (
            segments.length % 2 !==
            0
        ) {
            throw new Error(
                "Document paths must contain an even number of segments: " +
                normalizedPath
            );
        }

        const documentId =
            segments[
                segments.length - 1
            ];

        const collectionPath =
            segments
                .slice(0, -1)
                .join("/");

        const reference = {
            id:
                documentId,

            path:
                normalizedPath,

            parent:
                createCollectionReference(
                    collectionPath
                ),

            get:
                async function () {
                    return createDocumentSnapshot(
                        reference,
                        documents.get(
                            normalizedPath
                        )
                    );
                },

            create:
                async function (data) {
                    if (
                        documents.has(
                            normalizedPath
                        )
                    ) {
                        throw createFirestoreError(
                            "already-exists",
                            "Document already exists: " +
                            normalizedPath
                        );
                    }

                    const transformed =
                        transformWriteValue(
                            data,
                            undefined,
                            clock
                        );

                    documents.set(
                        normalizedPath,
                        transformed
                    );

                    recordWrite(
                        "create",
                        reference,
                        data
                    );

                    return {
                        writeTime:
                            TestTimestamp
                                .fromMillis(
                                    clock()
                                )
                    };
                },

            set:
                async function (
                    data,
                    writeOptions
                ) {
                    const existing =
                        documents.get(
                            normalizedPath
                        );

                    const transformed =
                        writeOptions &&
                        writeOptions.merge
                            ? applyMerge(
                                  existing,
                                  data,
                                  clock
                              )
                            : transformWriteValue(
                                  data,
                                  existing,
                                  clock
                              );

                    documents.set(
                        normalizedPath,
                        transformed
                    );

                    recordWrite(
                        "set",
                        reference,
                        data,
                        writeOptions
                    );

                    return {
                        writeTime:
                            TestTimestamp
                                .fromMillis(
                                    clock()
                                )
                    };
                },

            update:
                async function (data) {
                    if (
                        !documents.has(
                            normalizedPath
                        )
                    ) {
                        throw createFirestoreError(
                            "not-found",
                            "Document does not exist: " +
                            normalizedPath
                        );
                    }

                    const existing =
                        documents.get(
                            normalizedPath
                        );

                    documents.set(
                        normalizedPath,
                        applyUpdate(
                            existing,
                            data,
                            clock
                        )
                    );

                    recordWrite(
                        "update",
                        reference,
                        data
                    );

                    return {
                        writeTime:
                            TestTimestamp
                                .fromMillis(
                                    clock()
                                )
                    };
                },

            delete:
                async function () {
                    documents.delete(
                        normalizedPath
                    );

                    recordWrite(
                        "delete",
                        reference
                    );

                    return {
                        writeTime:
                            TestTimestamp
                                .fromMillis(
                                    clock()
                                )
                    };
                },

            collection:
                function (
                    childCollectionPath
                ) {
                    return createCollectionReference(
                        normalizedPath +
                        "/" +
                        normalizePath(
                            childCollectionPath
                        )
                    );
                },

            isEqual:
                function (other) {
                    return Boolean(
                        other &&
                        other.path ===
                            normalizedPath
                    );
                }
        };

        return reference;
    }

    function createCollectionReference(
        collectionPath
    ) {
        const normalizedPath =
            normalizePath(
                collectionPath
            );

        const segments =
            normalizedPath.split("/");

        if (
            segments.length % 2 !==
            1
        ) {
            throw new Error(
                "Collection paths must contain an odd number of segments: " +
                normalizedPath
            );
        }

        const collectionId =
            segments[
                segments.length - 1
            ];

        const reference = {
            id:
                collectionId,

            path:
                normalizedPath,

            parent:
                segments.length > 1
                    ? createDocumentReference(
                          segments
                              .slice(0, -1)
                              .join("/")
                      )
                    : null,

            doc:
                function (documentId) {
                    const id =
                        documentId ||
                        generateDocumentId();

                    return createDocumentReference(
                        normalizedPath +
                        "/" +
                        id
                    );
                },

            add:
                async function (data) {
                    const documentReference =
                        reference.doc();

                    await documentReference
                        .set(data);

                    return documentReference;
                },

            get:
                async function () {
                    return executeQuery({
                        collectionPath:
                            normalizedPath,

                        filters:
                            [],

                        ordering:
                            [],

                        limit:
                            null,

                        startAfter:
                            null
                    });
                },

            where:
                function (
                    field,
                    operator,
                    value
                ) {
                    return createQuery({
                        collectionPath:
                            normalizedPath,

                        filters: [
                            {
                                field:
                                    field,

                                operator:
                                    operator,

                                value:
                                    cloneValue(value)
                            }
                        ],

                        ordering:
                            [],

                        limit:
                            null,

                        startAfter:
                            null
                    });
                },

            orderBy:
                function (
                    field,
                    direction
                ) {
                    return createQuery({
                        collectionPath:
                            normalizedPath,

                        filters:
                            [],

                        ordering: [
                            {
                                field:
                                    field,

                                direction:
                                    direction ||
                                    "asc"
                            }
                        ],

                        limit:
                            null,

                        startAfter:
                            null
                    });
                },

            limit:
                function (count) {
                    return createQuery({
                        collectionPath:
                            normalizedPath,

                        filters:
                            [],

                        ordering:
                            [],

                        limit:
                            Number(count),

                        startAfter:
                            null
                    });
                },

            isEqual:
                function (other) {
                    return Boolean(
                        other &&
                        other.path ===
                            normalizedPath
                    );
                }
        };

        return reference;
    }

    function createQuery(queryState) {
        const state = {
            collectionPath:
                queryState
                    .collectionPath,

            filters:
                queryState.filters
                    .slice(),

            ordering:
                queryState.ordering
                    .slice(),

            limit:
                queryState.limit,

            startAfter:
                queryState
                    .startAfter
        };

        const query = {
            where:
                function (
                    field,
                    operator,
                    value
                ) {
                    return createQuery({
                        collectionPath:
                            state.collectionPath,

                        filters:
                            state.filters.concat({
                                field:
                                    field,

                                operator:
                                    operator,

                                value:
                                    cloneValue(value)
                            }),

                        ordering:
                            state.ordering,

                        limit:
                            state.limit,

                        startAfter:
                            state.startAfter
                    });
                },

            orderBy:
                function (
                    field,
                    direction
                ) {
                    return createQuery({
                        collectionPath:
                            state.collectionPath,

                        filters:
                            state.filters,

                        ordering:
                            state.ordering.concat({
                                field:
                                    field,

                                direction:
                                    direction ||
                                    "asc"
                            }),

                        limit:
                            state.limit,

                        startAfter:
                            state.startAfter
                    });
                },

            limit:
                function (count) {
                    return createQuery({
                        collectionPath:
                            state.collectionPath,

                        filters:
                            state.filters,

                        ordering:
                            state.ordering,

                        limit:
                            Number(count),

                        startAfter:
                            state.startAfter
                    });
                },

            startAfter:
                function (...values) {
                    return createQuery({
                        collectionPath:
                            state.collectionPath,

                        filters:
                            state.filters,

                        ordering:
                            state.ordering,

                        limit:
                            state.limit,

                        startAfter:
                            values
                    });
                },

            get:
                async function () {
                    return executeQuery(
                        state
                    );
                }
        };

        return query;
    }

    function executeQuery(state) {
        let matching =
            listDirectDocuments(
                state.collectionPath
            );

        matching =
            matching.filter(
                function (entry) {
                    return state.filters
                        .every(
                            function (
                                filter
                            ) {
                                return matchesFilter(
                                    entry.data,
                                    filter
                                );
                            }
                        );
                }
            );

        if (
            state.ordering.length
        ) {
            matching.sort(
                function (
                    first,
                    second
                ) {
                    for (
                        const order of
                        state.ordering
                    ) {
                        const comparison =
                            compareValues(
                                getNestedField(
                                    first.data,
                                    order.field
                                ),
                                getNestedField(
                                    second.data,
                                    order.field
                                )
                            );

                        if (
                            comparison !==
                            0
                        ) {
                            return order.direction ===
                                "desc"
                                ? -comparison
                                : comparison;
                        }
                    }

                    return first.id
                        .localeCompare(
                            second.id
                        );
                }
            );
        }

        if (
            state.startAfter &&
            state.startAfter.length
        ) {
            matching =
                applyStartAfter(
                    matching,
                    state
                );
        }

        if (
            Number.isFinite(
                state.limit
            )
        ) {
            matching =
                matching.slice(
                    0,
                    Math.max(
                        0,
                        state.limit
                    )
                );
        }

        return createQuerySnapshot(
            matching.map(
                function (entry) {
                    return createDocumentSnapshot(
                        entry.ref,
                        entry.data
                    );
                }
            )
        );
    }

    function applyStartAfter(
        entries,
        state
    ) {
        const firstValue =
            state.startAfter[0];

        if (
            firstValue &&
            firstValue.ref &&
            firstValue.id
        ) {
            const index =
                entries.findIndex(
                    function (entry) {
                        return entry.id ===
                            firstValue.id;
                    }
                );

            return index >= 0
                ? entries.slice(
                      index + 1
                  )
                : entries;
        }

        if (
            !state.ordering.length
        ) {
            return entries;
        }

        return entries.filter(
            function (entry) {
                for (
                    let index = 0;
                    index <
                    state.ordering.length;
                    index += 1
                ) {
                    const ordering =
                        state.ordering[index];

                    const comparison =
                        compareValues(
                            getNestedField(
                                entry.data,
                                ordering.field
                            ),
                            state.startAfter[
                                index
                            ]
                        );

                    if (
                        comparison === 0
                    ) {
                        continue;
                    }

                    return ordering.direction ===
                        "desc"
                        ? comparison < 0
                        : comparison > 0;
                }

                return false;
            }
        );
    }

    function matchesFilter(
        data,
        filter
    ) {
        const actual =
            getNestedField(
                data,
                filter.field
            );

        const expected =
            filter.value;

        switch (
            filter.operator
        ) {
            case "==":
                return deepEqual(
                    actual,
                    expected
                );

            case "!=":
                return !deepEqual(
                    actual,
                    expected
                );

            case "<":
                return (
                    compareValues(
                        actual,
                        expected
                    ) < 0
                );

            case "<=":
                return (
                    compareValues(
                        actual,
                        expected
                    ) <= 0
                );

            case ">":
                return (
                    compareValues(
                        actual,
                        expected
                    ) > 0
                );

            case ">=":
                return (
                    compareValues(
                        actual,
                        expected
                    ) >= 0
                );

            case "in":
                return (
                    Array.isArray(
                        expected
                    ) &&
                    expected.some(
                        function (value) {
                            return deepEqual(
                                actual,
                                value
                            );
                        }
                    )
                );

            case "not-in":
                return (
                    Array.isArray(
                        expected
                    ) &&
                    !expected.some(
                        function (value) {
                            return deepEqual(
                                actual,
                                value
                            );
                        }
                    )
                );

            case "array-contains":
                return (
                    Array.isArray(
                        actual
                    ) &&
                    actual.some(
                        function (value) {
                            return deepEqual(
                                value,
                                expected
                            );
                        }
                    )
                );

            case "array-contains-any":
                return (
                    Array.isArray(
                        actual
                    ) &&
                    Array.isArray(
                        expected
                    ) &&
                    expected.some(
                        function (
                            expectedValue
                        ) {
                            return actual.some(
                                function (
                                    actualValue
                                ) {
                                    return deepEqual(
                                        actualValue,
                                        expectedValue
                                    );
                                }
                            );
                        }
                    )
                );

            default:
                throw new Error(
                    "Unsupported query operator: " +
                    filter.operator
                );
        }
    }

    function listDirectDocuments(
        collectionPath
    ) {
        const prefix =
            normalizePath(
                collectionPath
            ) +
            "/";

        return Array.from(
            documents.entries()
        )
            .filter(
                function (entry) {
                    if (
                        !entry[0]
                            .startsWith(
                                prefix
                            )
                    ) {
                        return false;
                    }

                    return !entry[0]
                        .slice(
                            prefix.length
                        )
                        .includes("/");
                }
            )
            .map(
                function (entry) {
                    const id =
                        entry[0].slice(
                            prefix.length
                        );

                    return {
                        id:
                            id,

                        path:
                            entry[0],

                        data:
                            cloneValue(
                                entry[1]
                            ),

                        ref:
                            createDocumentReference(
                                entry[0]
                            )
                    };
                }
            );
    }

    function generateDocumentId() {
        generatedId += 1;

        return (
            "generated-" +
            String(
                generatedId
            ).padStart(
                6,
                "0"
            )
        );
    }

    function createTransaction() {
        return {
            get:
                async function (
                    reference
                ) {
                    return reference.get();
                },

            create:
                function (
                    reference,
                    data
                ) {
                    if (
                        documents.has(
                            reference.path
                        )
                    ) {
                        throw createFirestoreError(
                            "already-exists",
                            "Document already exists: " +
                            reference.path
                        );
                    }

                    documents.set(
                        reference.path,
                        transformWriteValue(
                            data,
                            undefined,
                            clock
                        )
                    );

                    recordWrite(
                        "transaction-create",
                        reference,
                        data
                    );

                    return this;
                },

            set:
                function (
                    reference,
                    data,
                    writeOptions
                ) {
                    const existing =
                        documents.get(
                            reference.path
                        );

                    documents.set(
                        reference.path,
                        writeOptions &&
                        writeOptions.merge
                            ? applyMerge(
                                  existing,
                                  data,
                                  clock
                              )
                            : transformWriteValue(
                                  data,
                                  existing,
                                  clock
                              )
                    );

                    recordWrite(
                        "transaction-set",
                        reference,
                        data,
                        writeOptions
                    );

                    return this;
                },

            update:
                function (
                    reference,
                    data
                ) {
                    if (
                        !documents.has(
                            reference.path
                        )
                    ) {
                        throw createFirestoreError(
                            "not-found",
                            "Document does not exist: " +
                            reference.path
                        );
                    }

                    documents.set(
                        reference.path,
                        applyUpdate(
                            documents.get(
                                reference.path
                            ),
                            data,
                            clock
                        )
                    );

                    recordWrite(
                        "transaction-update",
                        reference,
                        data
                    );

                    return this;
                },

            delete:
                function (reference) {
                    documents.delete(
                        reference.path
                    );

                    recordWrite(
                        "transaction-delete",
                        reference
                    );

                    return this;
                }
        };
    }

    function createBatch() {
        const operations = [];

        return {
            create:
                function (
                    reference,
                    data
                ) {
                    operations.push({
                        type:
                            "create",

                        reference:
                            reference,

                        data:
                            data
                    });

                    return this;
                },

            set:
                function (
                    reference,
                    data,
                    writeOptions
                ) {
                    operations.push({
                        type:
                            "set",

                        reference:
                            reference,

                        data:
                            data,

                        options:
                            writeOptions
                    });

                    return this;
                },

            update:
                function (
                    reference,
                    data
                ) {
                    operations.push({
                        type:
                            "update",

                        reference:
                            reference,

                        data:
                            data
                    });

                    return this;
                },

            delete:
                function (reference) {
                    operations.push({
                        type:
                            "delete",

                        reference:
                            reference
                    });

                    return this;
                },

            commit:
                async function () {
                    for (
                        const operation of
                        operations
                    ) {
                        if (
                            operation.type ===
                            "create"
                        ) {
                            await operation
                                .reference
                                .create(
                                    operation.data
                                );
                        } else if (
                            operation.type ===
                            "set"
                        ) {
                            await operation
                                .reference
                                .set(
                                    operation.data,
                                    operation.options
                                );
                        } else if (
                            operation.type ===
                            "update"
                        ) {
                            await operation
                                .reference
                                .update(
                                    operation.data
                                );
                        } else {
                            await operation
                                .reference
                                .delete();
                        }
                    }

                    return operations.map(
                        function () {
                            return {
                                writeTime:
                                    TestTimestamp
                                        .fromMillis(
                                            clock()
                                        )
                            };
                        }
                    );
                }
        };
    }

    const firestore = {
        collection:
            function (collectionPath) {
                return createCollectionReference(
                    collectionPath
                );
            },

        doc:
            function (documentPath) {
                return createDocumentReference(
                    documentPath
                );
            },

        runTransaction:
            async function (callback) {
                return callback(
                    createTransaction()
                );
            },

        batch:
            function () {
                return createBatch();
            },

        getAll:
            async function (
                ...references
            ) {
                return Promise.all(
                    references.map(
                        function (
                            reference
                        ) {
                            return reference.get();
                        }
                    )
                );
            }
    };

    return {
        firestore:
            firestore,

        db:
            firestore,

        documents:
            documents,

        writes:
            writes,

        FieldValue:
            FieldValue,

        Timestamp:
            TestTimestamp,

        seed:
            function (
                path,
                data
            ) {
                documents.set(
                    normalizeDocumentPath(
                        path
                    ),
                    cloneValue(data)
                );

                return this;
            },

        seedMany:
            function (
                source
            ) {
                Object.keys(
                    source || {}
                ).forEach(
                    function (path) {
                        documents.set(
                            normalizeDocumentPath(
                                path
                            ),
                            cloneValue(
                                source[path]
                            )
                        );
                    }
                );

                return this;
            },

        clear:
            function () {
                documents.clear();
                writes.length = 0;
            },

        resetWrites:
            function () {
                writes.length = 0;
            },

        hasDocument:
            function (path) {
                return documents.has(
                    normalizeDocumentPath(
                        path
                    )
                );
            },

        getDocument:
            function (path) {
                return cloneValue(
                    documents.get(
                        normalizeDocumentPath(
                            path
                        )
                    )
                );
            },

        setDocument:
            function (
                path,
                data
            ) {
                documents.set(
                    normalizeDocumentPath(
                        path
                    ),
                    cloneValue(data)
                );
            },

        deleteDocument:
            function (path) {
                documents.delete(
                    normalizeDocumentPath(
                        path
                    )
                );
            },

        listDocuments:
            function (
                collectionPath
            ) {
                return listDirectDocuments(
                    collectionPath
                ).map(
                    function (entry) {
                        return {
                            id:
                                entry.id,

                            path:
                                entry.path,

                            data:
                                cloneValue(
                                    entry.data
                                )
                        };
                    }
                );
            },

        findDocuments:
            function (
                collectionPath,
                predicate
            ) {
                return this
                    .listDocuments(
                        collectionPath
                    )
                    .filter(
                        predicate ||
                        function () {
                            return true;
                        }
                    );
            },

        findWrites:
            function (predicate) {
                return writes.filter(
                    predicate ||
                    function () {
                        return true;
                    }
                );
            },

        lastWrite:
            function () {
                return writes.length
                    ? writes[
                          writes.length -
                          1
                      ]
                    : undefined;
            },

        snapshot:
            function () {
                return Object.fromEntries(
                    Array.from(
                        documents.entries()
                    ).map(
                        function (entry) {
                            return [
                                entry[0],
                                cloneValue(
                                    entry[1]
                                )
                            ];
                        }
                    )
                );
            }
    };
}

/* ==========================================================
   PATH HELPERS
========================================================== */

function normalizePath(path) {
    const normalized =
        String(path || "")
            .trim()
            .replace(
                /^\/+|\/+$/g,
                ""
            )
            .replace(
                /\/{2,}/g,
                "/"
            );

    if (!normalized) {
        throw new Error(
            "Firestore path cannot be empty."
        );
    }

    return normalized;
}

function normalizeDocumentPath(path) {
    const normalized =
        normalizePath(path);

    if (
        normalized
            .split("/")
            .length %
        2 !==
        0
    ) {
        throw new Error(
            "Invalid document path: " +
            normalized
        );
    }

    return normalized;
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
    createFirestoreHarness,
    cloneValue,
    deepEqual,
    getNestedField,
    setNestedField,
    deleteNestedField,
    compareValues,
    TestTimestamp,
    FieldValue,
    FieldOperation
};