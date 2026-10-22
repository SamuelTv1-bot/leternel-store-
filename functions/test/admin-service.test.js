"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ADMINISTRATOR SERVICE TESTS
========================================================== */

const test = require("node:test");

const assert = require(
    "node:assert/strict"
);

const {
    Timestamp
} = require(
    "firebase-admin/firestore"
);

const adminService = require(
    "../src/admin/admin-service"
);

/* ==========================================================
   TEST HELPERS
========================================================== */

function createSnapshot(
    id,
    data,
    reference
) {
    return {
        id: id,

        exists:
            data !== undefined &&
            data !== null,

        ref:
            reference || {
                id: id,
                path:
                    "documents/" +
                    id
            },

        data:
            function () {
                return data;
            },

        get:
            function (field) {
                return resolveNestedField(
                    data,
                    field
                );
            }
    };
}

function resolveNestedField(
    value,
    path
) {
    return String(path)
        .split(".")
        .reduce(
            function (
                current,
                key
            ) {
                if (
                    current === null ||
                    current === undefined
                ) {
                    return undefined;
                }

                return current[key];
            },
            value
        );
}

function createDatabase(
    initialDocuments
) {
    const documents =
        new Map();

    const writes = [];

    Object.keys(
        initialDocuments || {}
    ).forEach(function (path) {
        documents.set(
            path,
            cloneValue(
                initialDocuments[path]
            )
        );
    });

    function createDocumentReference(
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
                    return createSnapshot(
                        documentId,
                        documents.get(
                            path
                        ),
                        this
                    );
                },

            create:
                async function (data) {
                    if (
                        documents.has(path)
                    ) {
                        const error =
                            new Error(
                                "Document exists"
                            );

                        error.code =
                            "already-exists";

                        throw error;
                    }

                    documents.set(
                        path,
                        cloneValue(data)
                    );

                    writes.push({
                        operation:
                            "create",

                        path:
                            path,

                        data:
                            data
                    });
                },

            set:
                async function (
                    data,
                    options
                ) {
                    const existing =
                        documents.get(
                            path
                        ) || {};

                    const next =
                        options &&
                        options.merge
                            ? mergeValue(
                                  existing,
                                  data
                              )
                            : cloneValue(
                                  data
                              );

                    documents.set(
                        path,
                        next
                    );

                    writes.push({
                        operation:
                            "set",

                        path:
                            path,

                        data:
                            data,

                        options:
                            options || null
                    });
                },

            update:
                async function (data) {
                    const existing =
                        documents.get(
                            path
                        );

                    if (!existing) {
                        throw new Error(
                            "Document missing"
                        );
                    }

                    documents.set(
                        path,
                        mergeValue(
                            existing,
                            data
                        )
                    );

                    writes.push({
                        operation:
                            "update",

                        path:
                            path,

                        data:
                            data
                    });
                }
        };
    }

    return {
        documents:
            documents,

        writes:
            writes,

        collection:
            function (
                collectionName
            ) {
                return createCollection({
                    collectionName:
                        collectionName,

                    documents:
                        documents,

                    createDocumentReference:
                        createDocumentReference
                });
            },

        runTransaction:
            async function (
                callback
            ) {
                const transaction = {
                    get:
                        async function (
                            reference
                        ) {
                            return reference.get();
                        },

                    set:
                        function (
                            reference,
                            data,
                            options
                        ) {
                            const existing =
                                documents.get(
                                    reference.path
                                ) || {};

                            const next =
                                options &&
                                options.merge
                                    ? mergeValue(
                                          existing,
                                          data
                                      )
                                    : cloneValue(
                                          data
                                      );

                            documents.set(
                                reference.path,
                                next
                            );

                            writes.push({
                                operation:
                                    "transaction-set",

                                path:
                                    reference.path,

                                data:
                                    data,

                                options:
                                    options || null
                            });
                        },

                    update:
                        function (
                            reference,
                            data
                        ) {
                            const existing =
                                documents.get(
                                    reference.path
                                ) || {};

                            documents.set(
                                reference.path,
                                mergeValue(
                                    existing,
                                    data
                                )
                            );

                            writes.push({
                                operation:
                                    "transaction-update",

                                path:
                                    reference.path,

                                data:
                                    data
                            });
                        }
                };

                return callback(
                    transaction
                );
            }
    };
}

function createCollection(options) {
    const collectionName =
        options.collectionName;

    const documents =
        options.documents;

    let generatedCount = 0;

    const collection = {
        doc:
            function (documentId) {
                const id =
                    documentId ||
                    "generated-" +
                        String(
                            ++generatedCount
                        );

                return options
                    .createDocumentReference(
                        collectionName,
                        id
                    );
            },

        get:
            async function () {
                return createQuerySnapshot(
                    listCollectionDocuments(
                        documents,
                        collectionName
                    )
                );
            },

        where:
            function (
                field,
                operator,
                value
            ) {
                return createQuery({
                    collectionName:
                        collectionName,

                    documents:
                        documents,

                    filters: [
                        {
                            field:
                                field,

                            operator:
                                operator,

                            value:
                                value
                        }
                    ]
                });
            },

        orderBy:
            function (
                field,
                direction
            ) {
                return createQuery({
                    collectionName:
                        collectionName,

                    documents:
                        documents,

                    ordering: [
                        {
                            field:
                                field,

                            direction:
                                direction ||
                                "asc"
                        }
                    ]
                });
            }
    };

    return collection;
}

function createQuery(options) {
    const filters =
        options.filters || [];

    const ordering =
        options.ordering || [];

    let maximum = null;

    const query = {
        where:
            function (
                field,
                operator,
                value
            ) {
                filters.push({
                    field:
                        field,

                    operator:
                        operator,

                    value:
                        value
                });

                return query;
            },

        orderBy:
            function (
                field,
                direction
            ) {
                ordering.push({
                    field:
                        field,

                    direction:
                        direction ||
                        "asc"
                });

                return query;
            },

        limit:
            function (value) {
                maximum =
                    Number(value);

                return query;
            },

        startAfter:
            function () {
                /*
                 * Cursor behavior is intentionally omitted from the
                 * unit database. Cursor encoding is tested elsewhere.
                 */
                return query;
            },

        get:
            async function () {
                let matching =
                    listCollectionDocuments(
                        options.documents,
                        options.collectionName
                    );

                matching =
                    matching.filter(
                        function (document) {
                            return filters.every(
                                function (
                                    filter
                                ) {
                                    const actual =
                                        resolveNestedField(
                                            document.data,
                                            filter.field
                                        );

                                    if (
                                        filter.operator ===
                                        "=="
                                    ) {
                                        return (
                                            actual ===
                                            filter.value
                                        );
                                    }

                                    if (
                                        filter.operator ===
                                        ">="
                                    ) {
                                        return (
                                            compareValues(
                                                actual,
                                                filter.value
                                            ) >= 0
                                        );
                                    }

                                    if (
                                        filter.operator ===
                                        "<"
                                    ) {
                                        return (
                                            compareValues(
                                                actual,
                                                filter.value
                                            ) < 0
                                        );
                                    }

                                    if (
                                        filter.operator ===
                                        "<="
                                    ) {
                                        return (
                                            compareValues(
                                                actual,
                                                filter.value
                                            ) <= 0
                                        );
                                    }

                                    if (
                                        filter.operator ===
                                        "in"
                                    ) {
                                        return (
                                            Array.isArray(
                                                filter.value
                                            ) &&
                                            filter.value
                                                .includes(
                                                    actual
                                                )
                                        );
                                    }

                                    if (
                                        filter.operator ===
                                        "array-contains"
                                    ) {
                                        return (
                                            Array.isArray(
                                                actual
                                            ) &&
                                            actual.some(
                                                function (
                                                    item
                                                ) {
                                                    return deepEqual(
                                                        item,
                                                        filter.value
                                                    );
                                                }
                                            )
                                        );
                                    }

                                    throw new Error(
                                        "Unsupported operator: " +
                                        filter.operator
                                    );
                                }
                            );
                        }
                    );

                ordering
                    .slice()
                    .reverse()
                    .forEach(
                        function (order) {
                            matching.sort(
                                function (
                                    first,
                                    second
                                ) {
                                    const comparison =
                                        compareValues(
                                            resolveNestedField(
                                                first.data,
                                                order.field
                                            ),
                                            resolveNestedField(
                                                second.data,
                                                order.field
                                            )
                                        );

                                    return order.direction ===
                                        "desc"
                                        ? -comparison
                                        : comparison;
                                }
                            );
                        }
                    );

                if (
                    maximum !== null
                ) {
                    matching =
                        matching.slice(
                            0,
                            maximum
                        );
                }

                return createQuerySnapshot(
                    matching
                );
            }
    };

    return query;
}

function listCollectionDocuments(
    documents,
    collectionName
) {
    const prefix =
        collectionName +
        "/";

    return Array.from(
        documents.entries()
    )
        .filter(
            function (entry) {
                const remainder =
                    entry[0].slice(
                        prefix.length
                    );

                return (
                    entry[0].startsWith(
                        prefix
                    ) &&
                    remainder &&
                    !remainder.includes("/")
                );
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
                        entry[1],

                    ref: {
                        id:
                            id,

                        path:
                            entry[0],

                        get:
                            async function () {
                                return createSnapshot(
                                    id,
                                    documents.get(
                                        entry[0]
                                    ),
                                    this
                                );
                            },

                        set:
                            async function (
                                value,
                                options
                            ) {
                                const existing =
                                    documents.get(
                                        entry[0]
                                    ) || {};

                                documents.set(
                                    entry[0],
                                    options &&
                                    options.merge
                                        ? mergeValue(
                                              existing,
                                              value
                                          )
                                        : cloneValue(
                                              value
                                          )
                                );
                            }
                    }
                };
            }
        );
}

function createQuerySnapshot(
    documents
) {
    const snapshots =
        documents.map(
            function (document) {
                return createSnapshot(
                    document.id,
                    document.data,
                    document.ref
                );
            }
        );

    return {
        size:
            snapshots.length,

        empty:
            snapshots.length ===
            0,

        docs:
            snapshots
    };
}

function compareValues(
    first,
    second
) {
    const left =
        comparableValue(
            first
        );

    const right =
        comparableValue(
            second
        );

    if (left < right) {
        return -1;
    }

    if (left > right) {
        return 1;
    }

    return 0;
}

function comparableValue(value) {
    if (
        value &&
        typeof value.toMillis ===
        "function"
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

function deepEqual(
    first,
    second
) {
    try {
        assert.deepEqual(
            first,
            second
        );

        return true;
    } catch (error) {
        return false;
    }
}

function cloneValue(value) {
    if (
        value instanceof Timestamp
    ) {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map(
            cloneValue
        );
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

function mergeValue(
    current,
    update
) {
    const output =
        cloneValue(
            current
        );

    Object.keys(
        update || {}
    ).forEach(function (key) {
        const value =
            update[key];

        if (
            value &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            !(value instanceof Timestamp) &&
            output[key] &&
            typeof output[key] ===
                "object" &&
            !Array.isArray(
                output[key]
            )
        ) {
            output[key] =
                mergeValue(
                    output[key],
                    value
                );
        } else {
            output[key] =
                cloneValue(value);
        }
    });

    return output;
}

function createRequest(options) {
    const settings =
        options || {};

    return {
        method:
            settings.method ||
            "GET",

        path:
            settings.path ||
            "/api/admin",

        url:
            settings.url ||
            settings.path ||
            "/api/admin",

        query:
            settings.query ||
            {},

        body:
            settings.body,

        headers:
            settings.headers ||
            {}
    };
}

function createIdentity() {
    return {
        uid:
            "admin-1",

        email:
            "admin@example.com",

        role:
            "admin"
    };
}

function getDocument(
    database,
    path
) {
    return database
        .documents
        .get(path);
}

/* ==========================================================
   PRODUCT PAYLOAD VALIDATION
========================================================== */

test(
    "normalizeProductPayload accepts a complete product",
    function () {
        const product =
            adminService
                ._internal
                .normalizeProductPayload(
                    {
                        name:
                            "Signature Coat",

                        slug:
                            "signature-coat",

                        sku:
                            "SC-001",

                        description:
                            "A tailored luxury coat.",

                        price:
                            250000,

                        compareAtPrice:
                            275000,

                        category:
                            "Outerwear",

                        categorySlug:
                            "outerwear",

                        active:
                            true,

                        published:
                            true,

                        featured:
                            true,

                        inventory:
                            12,

                        images: [
                            {
                                url:
                                    "https://example.com/coat.jpg",

                                alt:
                                    "Signature coat"
                            }
                        ],

                        tags: [
                            "coat",
                            "luxury"
                        ]
                    },
                    {
                        create:
                            true
                    }
                );

        assert.equal(
            product.name,
            "Signature Coat"
        );

        assert.equal(
            product.slug,
            "signature-coat"
        );

        assert.equal(
            product.price,
            250000
        );

        assert.equal(
            product.active,
            true
        );

        assert.equal(
            product.published,
            true
        );

        assert.equal(
            product.images[0].alt,
            "Signature coat"
        );
    }
);

test(
    "new products default to active and unpublished",
    function () {
        const product =
            adminService
                ._internal
                .normalizeProductPayload(
                    {
                        name:
                            "Silk Dress",

                        slug:
                            "silk-dress",

                        price:
                            175000
                    },
                    {
                        create:
                            true
                    }
                );

        assert.equal(
            product.active,
            true
        );

        assert.equal(
            product.published,
            false
        );
    }
);

test(
    "product creation requires name, slug, and price",
    function () {
        assert.throws(
            function () {
                adminService
                    ._internal
                    .normalizeProductPayload(
                        {
                            name:
                                "Incomplete product"
                        },
                        {
                            create:
                                true
                        }
                    );
            },
            function (error) {
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
    "product payload rejects protected analytics fields",
    function () {
        assert.throws(
            function () {
                adminService
                    ._internal
                    .normalizeProductPayload(
                        {
                            name:
                                "Signature Coat",

                            slug:
                                "signature-coat",

                            price:
                                250000,

                            salesCount:
                                5000
                        },
                        {
                            create:
                                true
                        }
                    );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                assert.match(
                    error.message,
                    /salesCount/
                );

                return true;
            }
        );
    }
);

test(
    "product slug must be URL safe",
    function () {
        assert.throws(
            function () {
                adminService
                    ._internal
                    .normalizeProductPayload(
                        {
                            name:
                                "Signature Coat",

                            slug:
                                "Signature Coat",

                            price:
                                250000
                        },
                        {
                            create:
                                true
                        }
                    );
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   VARIANT VALIDATION
========================================================== */

test(
    "normalizeVariants normalizes inventory and availability",
    function () {
        const variants =
            adminService
                ._internal
                .normalizeVariants([
                    {
                        id:
                            "black-medium",

                        sku:
                            "SC-BLK-M",

                        size:
                            "M",

                        color:
                            "Black",

                        price:
                            250000,

                        inventory:
                            4
                    }
                ]);

        assert.deepEqual(
            variants[0],
            {
                id:
                    "black-medium",

                sku:
                    "SC-BLK-M",

                name:
                    "",

                size:
                    "M",

                color:
                    "Black",

                price:
                    250000,

                inventory:
                    4,

                stock:
                    4,

                active:
                    true,

                available:
                    true,

                image:
                    null
            }
        );
    }
);

test(
    "variant stock alias is normalized as inventory",
    function () {
        const variants =
            adminService
                ._internal
                .normalizeVariants([
                    {
                        id:
                            "large",

                        stock:
                            3
                    }
                ]);

        assert.equal(
            variants[0].inventory,
            3
        );

        assert.equal(
            variants[0].stock,
            3
        );

        assert.equal(
            variants[0].available,
            true
        );
    }
);

test(
    "zero-stock variant is unavailable",
    function () {
        const variants =
            adminService
                ._internal
                .normalizeVariants([
                    {
                        id:
                            "sold-out",

                        inventory:
                            0
                    }
                ]);

        assert.equal(
            variants[0].available,
            false
        );
    }
);

test(
    "variant requires a safe identifier",
    function () {
        assert.throws(
            function () {
                adminService
                    ._internal
                    .normalizeVariants([
                        {
                            id:
                                "invalid variant"
                        }
                    ]);
            },
            function (error) {
                assert.equal(
                    error.code,
                    "invalid-argument"
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   IMAGES & INVENTORY
========================================================== */

test(
    "normalizeImages supports URL strings",
    function () {
        const images =
            adminService
                ._internal
                .normalizeImages([
                    "https://example.com/image.jpg"
                ]);

        assert.deepEqual(
            images,
            [
                {
                    url:
                        "https://example.com/image.jpg",

                    alt:
                        ""
                }
            ]
        );
    }
);

test(
    "calculateProductInventory sums variant inventory",
    function () {
        assert.equal(
            adminService
                ._internal
                .calculateProductInventory({
                    inventory:
                        100,

                    variants: [
                        {
                            inventory:
                                3
                        },
                        {
                            stock:
                                5
                        },
                        {
                            inventory:
                                0
                        }
                    ]
                }),
            8
        );
    }
);

test(
    "calculateProductInventory uses product inventory without variants",
    function () {
        assert.equal(
            adminService
                ._internal
                .calculateProductInventory({
                    inventory:
                        14
                }),
            14
        );
    }
);

test(
    "calculateProductInventory never returns a negative value",
    function () {
        assert.equal(
            adminService
                ._internal
                .calculateProductInventory({
                    inventory:
                        -10
                }),
            0
        );
    }
);

/* ==========================================================
   PRODUCT CREATION
========================================================== */

test(
    "createProduct stores inventory, analytics defaults, and audit data",
    async function () {
        const db =
            createDatabase();

        const product =
            await adminService
                .createProduct({
                    db:
                        db,

                    administrator:
                        createIdentity(),

                    payload: {
                        name:
                            "Signature Coat",

                        slug:
                            "signature-coat",

                        price:
                            250000,

                        variants: [
                            {
                                id:
                                    "medium",

                                inventory:
                                    4
                            },
                            {
                                id:
                                    "large",

                                inventory:
                                    2
                            }
                        ]
                    }
                });

        assert.match(
            product.id,
            /^generated-/
        );

        assert.equal(
            product.inventory,
            6
        );

        assert.equal(
            product.inStock,
            true
        );

        assert.equal(
            product.salesCount,
            0
        );

        assert.equal(
            product.rating,
            0
        );

        assert.equal(
            product.createdBy,
            "admin-1"
        );

        assert.ok(
            product.createdAt
        );

        const auditWrite =
            db.writes.find(
                function (write) {
                    return write.path
                        .startsWith(
                            "auditLogs/"
                        );
                }
            );

        assert.ok(
            auditWrite
        );
    }
);

/* ==========================================================
   PRODUCT RETRIEVAL
========================================================== */

test(
    "getProduct returns an existing product",
    async function () {
        const db =
            createDatabase({
                "products/product-1": {
                    name:
                        "Signature Coat",

                    slug:
                        "signature-coat",

                    price:
                        250000
                }
            });

        const product =
            await adminService
                .getProduct({
                    db:
                        db,

                    productId:
                        "product-1"
                });

        assert.equal(
            product.id,
            "product-1"
        );

        assert.equal(
            product.name,
            "Signature Coat"
        );
    }
);

test(
    "getProduct rejects a missing product",
    async function () {
        const db =
            createDatabase();

        await assert.rejects(
            adminService.getProduct({
                db:
                    db,

                productId:
                    "missing-product"
            }),
            function (error) {
                assert.equal(
                    error.code,
                    "product-not-found"
                );

                assert.equal(
                    error.status,
                    404
                );

                return true;
            }
        );
    }
);

/* ==========================================================
   PRODUCT UPDATE
========================================================== */

test(
    "updateProduct recalculates inventory and keeps existing data",
    async function () {
        const db =
            createDatabase({
                "products/product-1": {
                    name:
                        "Signature Coat",

                    slug:
                        "signature-coat",

                    description:
                        "Original description",

                    price:
                        250000,

                    inventory:
                        10,

                    active:
                        true,

                    published:
                        false,

                    createdBy:
                        "admin-original",

                    createdAt:
                        Timestamp.now()
                }
            });

        const product =
            await adminService
                .updateProduct({
                    db:
                        db,

                    administrator:
                        createIdentity(),

                    productId:
                        "product-1",

                    replace:
                        false,

                    payload: {
                        price:
                            275000,

                        inventory:
                            0
                    }
                });

        assert.equal(
            product.price,
            275000
        );

        assert.equal(
            product.description,
            "Original description"
        );

        assert.equal(
            product.inventory,
            0
        );

        assert.equal(
            product.inStock,
            false
        );

        assert.equal(
            product.updatedBy,
            "admin-1"
        );
    }
);

/* ==========================================================
   PRODUCT ARCHIVE
========================================================== */

test(
    "deleteProduct archives instead of hard deleting",
    async function () {
        const db =
            createDatabase({
                "products/product-1": {
                    name:
                        "Signature Coat",

                    active:
                        true,

                    published:
                        true,

                    archived:
                        false
                }
            });

        const result =
            await adminService
                .deleteProduct({
                    db:
                        db,

                    administrator:
                        createIdentity(),

                    productId:
                        "product-1"
                });

        assert.equal(
            result.success,
            true
        );

        assert.equal(
            result.archived,
            true
        );

        const product =
            getDocument(
                db,
                "products/product-1"
            );

        assert.equal(
            product.active,
            false
        );

        assert.equal(
            product.published,
            false
        );

        assert.equal(
            product.archived,
            true
        );

        assert.equal(
            product.archivedBy,
            "admin-1"
        );

        assert.ok(
            product.archivedAt instanceof
            Timestamp
        );
    }
);

/* ==========================================================
   PRODUCT LISTING
========================================================== */

test(
    "listProducts returns newest products first",
    async function () {
        const db =
            createDatabase({
                "products/product-old": {
                    name:
                        "Old Product",

                    slug:
                        "old-product",

                    createdAt:
                        Timestamp.fromMillis(
                            1000
                        ),

                    active:
                        true
                },

                "products/product-new": {
                    name:
                        "New Product",

                    slug:
                        "new-product",

                    createdAt:
                        Timestamp.fromMillis(
                            2000
                        ),

                    active:
                        true
                }
            });

        const result =
            await adminService
                .listProducts({
                    db:
                        db,

                    query: {
                        limit:
                            "20"
                    }
                });

        assert.equal(
            result.products.length,
            2
        );

        assert.equal(
            result.products[0].id,
            "product-new"
        );

        assert.equal(
            result.pagination.hasMore,
            false
        );
    }
);

test(
    "listProducts filters search results",
    async function () {
        const db =
            createDatabase({
                "products/coat": {
                    name:
                        "Signature Coat",

                    sku:
                        "COAT-001",

                    slug:
                        "signature-coat",

                    createdAt:
                        Timestamp.fromMillis(
                            2000
                        )
                },

                "products/dress": {
                    name:
                        "Silk Dress",

                    sku:
                        "DRESS-001",

                    slug:
                        "silk-dress",

                    createdAt:
                        Timestamp.fromMillis(
                            1000
                        )
                }
            });

        const result =
            await adminService
                .listProducts({
                    db:
                        db,

                    query: {
                        search:
                            "coat"
                    }
                });

        assert.equal(
            result.products.length,
            1
        );

        assert.equal(
            result.products[0].id,
            "coat"
        );
    }
);

/* ==========================================================
   CATEGORY VALIDATION
========================================================== */

test(
    "normalizeCategoryPayload returns normalized category data",
    function () {
        const category =
            adminService
                ._internal
                .normalizeCategoryPayload({
                    name:
                        "Evening Wear",

                    slug:
                        "evening-wear",

                    description:
                        "Formal evening styles.",

                    active:
                        true,

                    sortOrder:
                        "3"
                });

        assert.deepEqual(
            category,
            {
                name:
                    "Evening Wear",

                slug:
                    "evening-wear",

                description:
                    "Formal evening styles.",

                active:
                    true,

                sortOrder:
                    3
            }
        );
    }
);

test(
    "new categories default to active with zero sort order",
    function () {
        const category =
            adminService
                ._internal
                .normalizeCategoryPayload({
                    name:
                        "Accessories",

                    slug:
                        "accessories"
                });

        assert.equal(
            category.active,
            true
        );

        assert.equal(
            category.sortOrder,
            0
        );
    }
);

test(
    "partial category updates do not require name or slug",
    function () {
        const category =
            adminService
                ._internal
                .normalizeCategoryPayload(
                    {
                        active:
                            false
                    },
                    {
                        partial:
                            true
                    }
                );

        assert.deepEqual(
            category,
            {
                active:
                    false
            }
        );
    }
);

/* ==========================================================
   CATEGORY MANAGEMENT
========================================================== */

test(
    "createCategory stores audit metadata",
    async function () {
        const db =
            createDatabase();

        const category =
            await adminService
                .createCategory({
                    db:
                        db,

                    administrator:
                        createIdentity(),

                    payload: {
                        name:
                            "Accessories",

                        slug:
                            "accessories"
                    }
                });

        assert.match(
            category.id,
            /^generated-/
        );

        assert.equal(
            category.createdBy,
            "admin-1"
        );

        assert.equal(
            category.active,
            true
        );
    }
);

test(
    "updateCategory merges supplied fields",
    async function () {
        const db =
            createDatabase({
                "categories/category-1": {
                    name:
                        "Accessories",

                    slug:
                        "accessories",

                    description:
                        "Original",

                    active:
                        true,

                    sortOrder:
                        1
                }
            });

        const category =
            await adminService
                .updateCategory({
                    db:
                        db,

                    administrator:
                        createIdentity(),

                    categoryId:
                        "category-1",

                    payload: {
                        description:
                            "Updated",

                        sortOrder:
                            2
                    }
                });

        assert.equal(
            category.description,
            "Updated"
        );

        assert.equal(
            category.sortOrder,
            2
        );

        assert.equal(
            category.name,
            "Accessories"
        );

        assert.equal(
            category.updatedBy,
            "admin-1"
        );
    }
);

test(
    "archiveCategory marks category inactive",
    async function () {
        const db =
            createDatabase({
                "categories/category-1": {
                    name:
                        "Accessories",

                    active:
                        true,

                    archived:
                        false
                }
            });

        const result =
            await adminService
                .archiveCategory({
                    db:
                        db,

                    administrator:
                        createIdentity(),

                    categoryId:
                        "category-1"
                });

        assert.equal(
            result.archived,
            true
        );

        const category =
            getDocument(
                db,
                "categories/category-1"
            );

        assert.equal(
            category.active,
            false
        );

        assert.equal(
            category.archived,
            true
        );
    }
);

/* ==========================================================
   ORDER SANITIZATION
========================================================== */

test(
    "sanitizeAdminOrder removes sensitive payment fields",
    function () {
        const order =
            adminService
                ._internal
                .sanitizeAdminOrder({
                    id:
                        "order-1",

                    paymentAuthorization:
                        "sensitive",

                    idempotencyKeyHash:
                        "secret-hash",

                    payment: {
                        authorization: {
                            authorizationCode:
                                "AUTH_SECRET",

                            reusable:
                                true,

                            channel:
                                "card",

                            last4:
                                "4081"
                        }
                    }
                });

        assert.equal(
            order.paymentAuthorization,
            undefined
        );

        assert.equal(
            order.idempotencyKeyHash,
            undefined
        );

        assert.equal(
            order.payment
                .authorization
                .authorizationCode,
            undefined
        );

        assert.equal(
            order.payment
                .authorization
                .last4,
            "4081"
        );
    }
);

/* ==========================================================
   CUSTOMER SANITIZATION
========================================================== */

test(
    "sanitizeCustomer removes restricted account fields",
    function () {
        const customer =
            adminService
                ._internal
                .sanitizeCustomer({
                    id:
                        "user-1",

                    email:
                        "customer@example.com",

                    passwordHash:
                        "hash",

                    passwordSalt:
                        "salt",

                    customClaims: {
                        admin:
                            false
                    },

                    paymentAuthorization:
                        "secret"
                });

        assert.equal(
            customer.passwordHash,
            undefined
        );

        assert.equal(
            customer.passwordSalt,
            undefined
        );

        assert.equal(
            customer.customClaims,
            undefined
        );

        assert.equal(
            customer.paymentAuthorization,
            undefined
        );

        assert.equal(
            customer.email,
            "customer@example.com"
        );
    }
);

/* ==========================================================
   CUSTOMER LISTING
========================================================== */

test(
    "listCustomers returns only customer profiles",
    async function () {
        const db =
            createDatabase({
                "users/customer-1": {
                    role:
                        "customer",

                    status:
                        "active",

                    email:
                        "one@example.com",

                    createdAt:
                        Timestamp.fromMillis(
                            2000
                        )
                },

                "users/admin-1": {
                    role:
                        "admin",

                    status:
                        "active",

                    email:
                        "admin@example.com",

                    createdAt:
                        Timestamp.fromMillis(
                            3000
                        )
                },

                "users/customer-2": {
                    role:
                        "customer",

                    status:
                        "disabled",

                    email:
                        "two@example.com",

                    createdAt:
                        Timestamp.fromMillis(
                            1000
                        )
                }
            });

        const result =
            await adminService
                .listCustomers({
                    db:
                        db,

                    query: {}
                });

        assert.equal(
            result.customers.length,
            2
        );

        assert.equal(
            result.customers[0].id,
            "customer-1"
        );

        assert.equal(
            result.customers[1].id,
            "customer-2"
        );
    }
);

test(
    "listCustomers supports status and search filtering",
    async function () {
        const db =
            createDatabase({
                "users/customer-1": {
                    role:
                        "customer",

                    status:
                        "active",

                    displayName:
                        "Samuel Udom",

                    email:
                        "samuel@example.com",

                    createdAt:
                        Timestamp.fromMillis(
                            2000
                        )
                },

                "users/customer-2": {
                    role:
                        "customer",

                    status:
                        "disabled",

                    displayName:
                        "Other Customer",

                    email:
                        "other@example.com",

                    createdAt:
                        Timestamp.fromMillis(
                            1000
                        )
                }
            });

        const result =
            await adminService
                .listCustomers({
                    db:
                        db,

                    query: {
                        status:
                            "active",

                        search:
                            "samuel"
                    }
                });

        assert.equal(
            result.customers.length,
            1
        );

        assert.equal(
            result.customers[0].id,
            "customer-1"
        );
    }
);

/* ==========================================================
   DASHBOARD HELPERS
========================================================== */

test(
    "calculateChangePercentage calculates positive growth",
    function () {
        assert.equal(
            adminService
                ._internal
                .calculateChangePercentage(
                    150,
                    100
                ),
            50
        );
    }
);

test(
    "calculateChangePercentage calculates decline",
    function () {
        assert.equal(
            adminService
                ._internal
                .calculateChangePercentage(
                    75,
                    100
                ),
            -25
        );
    }
);

test(
    "calculateChangePercentage handles a zero baseline",
    function () {
        assert.equal(
            adminService
                ._internal
                .calculateChangePercentage(
                    50,
                    0
                ),
            100
        );

        assert.equal(
            adminService
                ._internal
                .calculateChangePercentage(
                    0,
                    0
                ),
            0
        );
    }
);

/* ==========================================================
   DASHBOARD METRICS
========================================================== */

test(
    "getDashboardMetrics summarizes products, customers, and orders",
    async function () {
        const now =
            Timestamp.now();

        const db =
            createDatabase({
                "products/product-1": {
                    name:
                        "Active Product",

                    active:
                        true,

                    published:
                        true,

                    inventory:
                        3,

                    createdAt:
                        now
                },

                "products/product-2": {
                    name:
                        "Draft Product",

                    active:
                        true,

                    published:
                        false,

                    inventory:
                        20,

                    createdAt:
                        now
                },

                "users/customer-1": {
                    role:
                        "customer",

                    status:
                        "active",

                    createdAt:
                        now
                },

                "users/customer-2": {
                    role:
                        "customer",

                    status:
                        "disabled",

                    createdAt:
                        now
                },

                "orders/order-1": {
                    status:
                        "confirmed",

                    paymentStatus:
                        "paid",

                    total:
                        120000,

                    createdAt:
                        now
                },

                "orders/order-2": {
                    status:
                        "cancelled",

                    paymentStatus:
                        "failed",

                    total:
                        50000,

                    createdAt:
                        now
                }
            });

        const metrics =
            await adminService
                .getDashboardMetrics({
                    db:
                        db
                });

        assert.equal(
            metrics.totals.products,
            2
        );

        assert.equal(
            metrics.totals.activeProducts,
            1
        );

        assert.equal(
            metrics.totals.customers,
            2
        );

        assert.equal(
            metrics.totals.activeCustomers,
            1
        );

        assert.equal(
            metrics.totals.disabledCustomers,
            1
        );

        assert.equal(
            metrics.totals.pendingOrders,
            1
        );

        assert.equal(
            metrics.totals.lowStockProducts,
            1
        );

        assert.equal(
            metrics.today.orderCount,
            2
        );

        assert.equal(
            metrics.today.paidOrders,
            1
        );

        assert.equal(
            metrics.today.revenue,
            120000
        );

        assert.equal(
            metrics.recentOrders.length,
            2
        );
    }
);

/* ==========================================================
   ADMIN API ROUTING
========================================================== */

test(
    "handleAdminApi dispatches dashboard metrics",
    async function () {
        const db =
            createDatabase();

        const result =
            await adminService
                .handleAdminApi({
                    db:
                        db,

                    auth: {},

                    identity:
                        createIdentity(),

                    request:
                        createRequest({
                            method:
                                "GET",

                            path:
                                "/api/admin/metrics"
                        })
                });

        assert.equal(
            result.status,
            200
        );

        assert.equal(
            result.body.success,
            true
        );

        assert.ok(
            result.body.data
                .generatedAt
        );
    }
);

test(
    "handleAdminApi dispatches product creation",
    async function () {
        const db =
            createDatabase();

        const result =
            await adminService
                .handleAdminApi({
                    db:
                        db,

                    auth: {},

                    identity:
                        createIdentity(),

                    request:
                        createRequest({
                            method:
                                "POST",

                            path:
                                "/api/admin/products",

                            body: {
                                name:
                                    "Signature Coat",

                                slug:
                                    "signature-coat",

                                price:
                                    250000
                            }
                        })
                });

        assert.equal(
            result.status,
            201
        );

        assert.equal(
            result.body.success,
            true
        );

        assert.equal(
            result.body.data.name,
            "Signature Coat"
        );
    }
);

test(
    "handleAdminApi rejects unknown endpoints",
    async function () {
        const db =
            createDatabase();

        await assert.rejects(
            adminService
                .handleAdminApi({
                    db:
                        db,

                    auth: {},

                    identity:
                        createIdentity(),

                    request:
                        createRequest({
                            method:
                                "GET",

                            path:
                                "/api/admin/unknown"
                        })
                }),
            function (error) {
                assert.equal(
                    error.code,
                    "not-found"
                );

                assert.equal(
                    error.status,
                    404
                );

                return true;
            }
        );
    }
);

test(
    "handleAdminApi requires administrator identity",
    async function () {
        const db =
            createDatabase();

        await assert.rejects(
            adminService
                .handleAdminApi({
                    db:
                        db,

                    auth: {},

                    identity:
                        null,

                    request:
                        createRequest({
                            method:
                                "GET",

                            path:
                                "/api/admin/metrics"
                        })
                }),
            function (error) {
                assert.equal(
                    error.code,
                    "permission-denied"
                );

                assert.equal(
                    error.status,
                    403
                );

                return true;
            }
        );
    }
);