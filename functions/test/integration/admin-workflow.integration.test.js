"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ADMINISTRATOR WORKFLOW INTEGRATION TESTS
========================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");

const adminService = require(
    "../../src/admin/admin-service"
);

const accountService = require(
    "../../src/accounts/account-service"
);

const orderService = require(
    "../../src/orders/order-service"
);

/* ==========================================================
   VALUE HELPERS
========================================================== */

function cloneValue(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map(cloneValue);
    }

    if (
        value instanceof Date ||
        typeof value.toDate === "function"
    ) {
        return value;
    }

    if (
        typeof value === "object"
    ) {
        return Object.keys(value).reduce(
            function (output, key) {
                output[key] =
                    cloneValue(value[key]);

                return output;
            },
            {}
        );
    }

    return value;
}

function mergeValue(current, update) {
    const output =
        cloneValue(current || {});

    Object.keys(update || {}).forEach(
        function (key) {
            const incoming =
                update[key];

            if (
                incoming &&
                typeof incoming === "object" &&
                !Array.isArray(incoming) &&
                !(incoming instanceof Date) &&
                typeof incoming.toDate !==
                    "function" &&
                output[key] &&
                typeof output[key] === "object" &&
                !Array.isArray(output[key])
            ) {
                output[key] =
                    mergeValue(
                        output[key],
                        incoming
                    );
            } else {
                output[key] =
                    cloneValue(incoming);
            }
        }
    );

    return output;
}

function resolveNestedField(value, path) {
    return String(path)
        .split(".")
        .reduce(
            function (current, key) {
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

function compareValues(first, second) {
    const left =
        comparableValue(first);

    const right =
        comparableValue(second);

    if (left === right) {
        return 0;
    }

    return left < right
        ? -1
        : 1;
}

/* ==========================================================
   FIRESTORE TEST DATABASE
========================================================== */

function createSnapshot(reference, data) {
    return {
        id:
            reference.id,

        ref:
            reference,

        exists:
            data !== undefined,

        data:
            function () {
                return cloneValue(data);
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

function createDatabase(initialDocuments) {
    const documents =
        new Map();

    const writes = [];

    let generatedDocumentId =
        0;

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
        const id =
            documentId ||
            "generated-" +
                String(
                    ++generatedDocumentId
                );

        const path =
            collectionName +
            "/" +
            id;

        const reference = {
            id:
                id,

            path:
                path,

            get:
                async function () {
                    return createSnapshot(
                        reference,
                        documents.get(path)
                    );
                },

            create:
                async function (data) {
                    if (
                        documents.has(path)
                    ) {
                        const error =
                            new Error(
                                "Document already exists"
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
                            cloneValue(data)
                    });
                },

            set:
                async function (
                    data,
                    options
                ) {
                    const existing =
                        documents.get(path);

                    documents.set(
                        path,
                        options &&
                        options.merge
                            ? mergeValue(
                                  existing,
                                  data
                              )
                            : cloneValue(data)
                    );

                    writes.push({
                        operation:
                            "set",

                        path:
                            path,

                        data:
                            cloneValue(data),

                        options:
                            options || null
                    });
                },

            update:
                async function (data) {
                    const existing =
                        documents.get(path);

                    if (!existing) {
                        const error =
                            new Error(
                                "Document does not exist"
                            );

                        error.code =
                            "not-found";

                        throw error;
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
                            cloneValue(data)
                    });
                },

            delete:
                async function () {
                    documents.delete(path);

                    writes.push({
                        operation:
                            "delete",

                        path:
                            path
                    });
                }
        };

        return reference;
    }

    function createCollection(
        collectionName
    ) {
        return {
            doc:
                function (documentId) {
                    return createDocumentReference(
                        collectionName,
                        documentId
                    );
                },

            get:
                async function () {
                    return createQuerySnapshot(
                        listCollectionDocuments(
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
    }

    function listCollectionDocuments(
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
                    if (
                        !entry[0].startsWith(
                            prefix
                        )
                    ) {
                        return false;
                    }

                    return !entry[0]
                        .slice(prefix.length)
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

                        data:
                            cloneValue(
                                entry[1]
                            ),

                        ref:
                            createDocumentReference(
                                collectionName,
                                id
                            )
                    };
                }
            );
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
                    return query;
                },

            get:
                async function () {
                    let matching =
                        listCollectionDocuments(
                            options.collectionName
                        );

                    matching =
                        matching.filter(
                            function (document) {
                                return filters.every(
                                    function (filter) {
                                        const actual =
                                            resolveNestedField(
                                                document.data,
                                                filter.field
                                            );

                                        switch (
                                            filter.operator
                                        ) {
                                            case "==":
                                                return (
                                                    actual ===
                                                    filter.value
                                                );

                                            case "!=":
                                                return (
                                                    actual !==
                                                    filter.value
                                                );

                                            case "in":
                                                return (
                                                    Array.isArray(
                                                        filter.value
                                                    ) &&
                                                    filter.value
                                                        .includes(
                                                            actual
                                                        )
                                                );

                                            case ">=":
                                                return (
                                                    compareValues(
                                                        actual,
                                                        filter.value
                                                    ) >= 0
                                                );

                                            case "<=":
                                                return (
                                                    compareValues(
                                                        actual,
                                                        filter.value
                                                    ) <= 0
                                                );

                                            case ">":
                                                return (
                                                    compareValues(
                                                        actual,
                                                        filter.value
                                                    ) > 0
                                                );

                                            case "<":
                                                return (
                                                    compareValues(
                                                        actual,
                                                        filter.value
                                                    ) < 0
                                                );

                                            case "array-contains":
                                                return (
                                                    Array.isArray(
                                                        actual
                                                    ) &&
                                                    actual.includes(
                                                        filter.value
                                                    )
                                                );

                                            default:
                                                throw new Error(
                                                    "Unsupported query operator: " +
                                                    filter.operator
                                                );
                                        }
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

    function createQuerySnapshot(
        sourceDocuments
    ) {
        const snapshots =
            sourceDocuments.map(
                function (document) {
                    return createSnapshot(
                        document.ref,
                        document.data
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
                snapshots,

            forEach:
                function (callback) {
                    snapshots.forEach(
                        callback
                    );
                }
        };
    }

    return {
        documents:
            documents,

        writes:
            writes,

        collection:
            createCollection,

        runTransaction:
            async function (callback) {
                const transaction = {
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
                                const error =
                                    new Error(
                                        "Document already exists"
                                    );

                                error.code =
                                    "already-exists";

                                throw error;
                            }

                            documents.set(
                                reference.path,
                                cloneValue(data)
                            );

                            writes.push({
                                operation:
                                    "transaction-create",

                                path:
                                    reference.path,

                                data:
                                    cloneValue(data)
                            });
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
                                );

                            documents.set(
                                reference.path,
                                options &&
                                options.merge
                                    ? mergeValue(
                                          existing,
                                          data
                                      )
                                    : cloneValue(
                                          data
                                      )
                            );

                            writes.push({
                                operation:
                                    "transaction-set",

                                path:
                                    reference.path,

                                data:
                                    cloneValue(data),

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
                                );

                            if (!existing) {
                                const error =
                                    new Error(
                                        "Document does not exist"
                                    );

                                error.code =
                                    "not-found";

                                throw error;
                            }

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
                                    cloneValue(data)
                            });
                        },

                    delete:
                        function (
                            reference
                        ) {
                            documents.delete(
                                reference.path
                            );

                            writes.push({
                                operation:
                                    "transaction-delete",

                                path:
                                    reference.path
                            });
                        }
                };

                return callback(transaction);
            }
    };
}

/* ==========================================================
   FIREBASE AUTH TEST SERVICE
========================================================== */

function createAuthUser(overrides) {
    return Object.assign(
        {
            uid:
                "customer-1",

            email:
                "customer@example.com",

            emailVerified:
                true,

            displayName:
                "Test Customer",

            disabled:
                false,

            customClaims: {
                role:
                    "customer",

                admin:
                    false,

                superadmin:
                    false
            }
        },
        overrides || {}
    );
}

function createAuthService(initialUsers) {
    const users =
        new Map();

    const writes = [];

    Object.keys(
        initialUsers || {}
    ).forEach(function (userId) {
        users.set(
            userId,
            createAuthUser(
                initialUsers[userId]
            )
        );
    });

    return {
        users:
            users,

        writes:
            writes,

        getUser:
            async function (userId) {
                const user =
                    users.get(userId);

                if (!user) {
                    const error =
                        new Error(
                            "User not found"
                        );

                    error.code =
                        "auth/user-not-found";

                    throw error;
                }

                return user;
            },

        updateUser:
            async function (
                userId,
                changes
            ) {
                const user =
                    users.get(userId);

                if (!user) {
                    const error =
                        new Error(
                            "User not found"
                        );

                    error.code =
                        "auth/user-not-found";

                    throw error;
                }

                Object.assign(
                    user,
                    cloneValue(changes)
                );

                writes.push({
                    operation:
                        "updateUser",

                    userId:
                        userId,

                    changes:
                        cloneValue(changes)
                });

                return user;
            },

        setCustomUserClaims:
            async function (
                userId,
                claims
            ) {
                const user =
                    users.get(userId);

                if (!user) {
                    const error =
                        new Error(
                            "User not found"
                        );

                    error.code =
                        "auth/user-not-found";

                    throw error;
                }

                user.customClaims =
                    cloneValue(claims);

                writes.push({
                    operation:
                        "setCustomUserClaims",

                    userId:
                        userId,

                    claims:
                        cloneValue(claims)
                });
            },

        revokeRefreshTokens:
            async function (userId) {
                writes.push({
                    operation:
                        "revokeRefreshTokens",

                    userId:
                        userId
                });
            },

        deleteUser:
            async function (userId) {
                if (!users.has(userId)) {
                    const error =
                        new Error(
                            "User not found"
                        );

                    error.code =
                        "auth/user-not-found";

                    throw error;
                }

                users.delete(userId);

                writes.push({
                    operation:
                        "deleteUser",

                    userId:
                        userId
                });
            }
    };
}

/* ==========================================================
   FIXTURE HELPERS
========================================================== */

function createAdministrator(
    overrides
) {
    return Object.assign(
        {
            uid:
                "admin-1",

            email:
                "admin@example.com",

            role:
                "admin",

            authorized:
                true,

            active:
                true
        },
        overrides || {}
    );
}

function createSuperAdministrator() {
    return createAdministrator({
        uid:
            "superadmin-1",

        email:
            "owner@example.com",

        role:
            "superadmin"
    });
}

function getDocument(database, path) {
    return database.documents
        .get(path);
}

function findDocuments(
    database,
    collectionName
) {
    const prefix =
        collectionName +
        "/";

    return Array.from(
        database.documents.entries()
    ).filter(
        function (entry) {
            return entry[0]
                .startsWith(prefix);
        }
    );
}

function findAuditActions(database) {
    return findDocuments(
        database,
        "auditLogs"
    ).map(
        function (entry) {
            return entry[1].action;
        }
    );
}

/* ==========================================================
   PRODUCT LIFECYCLE
========================================================== */

test(
    "administrator can create, publish, update, and archive a product",
    async function () {
        const db =
            createDatabase();

        const administrator =
            createAdministrator();

        const created =
            await adminService
                .createProduct({
                    db:
                        db,

                    administrator:
                        administrator,

                    payload: {
                        name:
                            "Signature Coat",

                        slug:
                            "signature-coat",

                        sku:
                            "COAT-001",

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

                        published:
                            false,

                        featured:
                            false,

                        variants: [
                            {
                                id:
                                    "black-medium",

                                sku:
                                    "COAT-BLK-M",

                                color:
                                    "Black",

                                size:
                                    "M",

                                price:
                                    250000,

                                inventory:
                                    4
                            },
                            {
                                id:
                                    "black-large",

                                sku:
                                    "COAT-BLK-L",

                                color:
                                    "Black",

                                size:
                                    "L",

                                price:
                                    250000,

                                inventory:
                                    3
                            }
                        ],

                        images: [
                            {
                                url:
                                    "https://example.com/coat.jpg",

                                alt:
                                    "Signature coat"
                            }
                        ]
                    }
                });

        assert.ok(created.id);

        assert.equal(
            created.inventory,
            7
        );

        assert.equal(
            created.inStock,
            true
        );

        assert.equal(
            created.published,
            false
        );

        assert.equal(
            created.createdBy,
            "admin-1"
        );

        const published =
            await adminService
                .updateProduct({
                    db:
                        db,

                    administrator:
                        administrator,

                    productId:
                        created.id,

                    replace:
                        false,

                    payload: {
                        published:
                            true,

                        featured:
                            true,

                        price:
                            260000
                    }
                });

        assert.equal(
            published.published,
            true
        );

        assert.equal(
            published.featured,
            true
        );

        assert.equal(
            published.price,
            260000
        );

        assert.equal(
            published.inventory,
            7
        );

        const retrieved =
            await adminService
                .getProduct({
                    db:
                        db,

                    productId:
                        created.id
                });

        assert.equal(
            retrieved.id,
            created.id
        );

        assert.equal(
            retrieved.name,
            "Signature Coat"
        );

        assert.equal(
            retrieved.published,
            true
        );

        const archived =
            await adminService
                .deleteProduct({
                    db:
                        db,

                    administrator:
                        administrator,

                    productId:
                        created.id
                });

        assert.equal(
            archived.success,
            true
        );

        assert.equal(
            archived.archived,
            true
        );

        const stored =
            getDocument(
                db,
                "products/" +
                    created.id
            );

        assert.equal(
            stored.archived,
            true
        );

        assert.equal(
            stored.active,
            false
        );

        assert.equal(
            stored.published,
            false
        );

        assert.equal(
            stored.archivedBy,
            "admin-1"
        );

        const actions =
            findAuditActions(db);

        assert.ok(
            actions.some(
                function (action) {
                    return /product.*created/i
                        .test(action);
                }
            )
        );

        assert.ok(
            actions.some(
                function (action) {
                    return /product.*updated/i
                        .test(action);
                }
            )
        );

        assert.ok(
            actions.some(
                function (action) {
                    return /product.*archiv/i
                        .test(action);
                }
            )
        );
    }
);

/* ==========================================================
   PRODUCT INVENTORY
========================================================== */

test(
    "product variant update recalculates aggregate inventory",
    async function () {
        const db =
            createDatabase({
                "products/product-1": {
                    name:
                        "Signature Coat",

                    slug:
                        "signature-coat",

                    price:
                        250000,

                    active:
                        true,

                    published:
                        true,

                    inventory:
                        7,

                    stock:
                        7,

                    inStock:
                        true,

                    variants: [
                        {
                            id:
                                "medium",

                            inventory:
                                4,

                            stock:
                                4,

                            active:
                                true,

                            available:
                                true
                        },
                        {
                            id:
                                "large",

                            inventory:
                                3,

                            stock:
                                3,

                            active:
                                true,

                            available:
                                true
                        }
                    ]
                }
            });

        const result =
            await adminService
                .updateProduct({
                    db:
                        db,

                    administrator:
                        createAdministrator(),

                    productId:
                        "product-1",

                    replace:
                        false,

                    payload: {
                        variants: [
                            {
                                id:
                                    "medium",

                                inventory:
                                    0,

                                active:
                                    true
                            },
                            {
                                id:
                                    "large",

                                inventory:
                                    2,

                                active:
                                    true
                            }
                        ]
                    }
                });

        assert.equal(
            result.inventory,
            2
        );

        assert.equal(
            result.stock,
            2
        );

        assert.equal(
            result.inStock,
            true
        );

        assert.equal(
            result.variants[0]
                .available,
            false
        );

        assert.equal(
            result.variants[1]
                .available,
            true
        );
    }
);

test(
    "zero inventory update marks a product out of stock",
    async function () {
        const db =
            createDatabase({
                "products/product-1": {
                    name:
                        "Silk Dress",

                    slug:
                        "silk-dress",

                    price:
                        180000,

                    inventory:
                        5,

                    stock:
                        5,

                    inStock:
                        true,

                    active:
                        true,

                    published:
                        true,

                    variants: []
                }
            });

        const result =
            await adminService
                .updateProduct({
                    db:
                        db,

                    administrator:
                        createAdministrator(),

                    productId:
                        "product-1",

                    replace:
                        false,

                    payload: {
                        inventory:
                            0
                    }
                });

        assert.equal(
            result.inventory,
            0
        );

        assert.equal(
            result.inStock,
            false
        );
    }
);

/* ==========================================================
   CATEGORY WORKFLOW
========================================================== */

test(
    "administrator can create, update, list, and archive a category",
    async function () {
        const db =
            createDatabase();

        const administrator =
            createAdministrator();

        const category =
            await adminService
                .createCategory({
                    db:
                        db,

                    administrator:
                        administrator,

                    payload: {
                        name:
                            "Evening Wear",

                        slug:
                            "evening-wear",

                        description:
                            "Formal evening styles.",

                        sortOrder:
                            2
                    }
                });

        assert.ok(category.id);

        assert.equal(
            category.active,
            true
        );

        assert.equal(
            category.createdBy,
            "admin-1"
        );

        const updated =
            await adminService
                .updateCategory({
                    db:
                        db,

                    administrator:
                        administrator,

                    categoryId:
                        category.id,

                    payload: {
                        description:
                            "Luxury formal evening styles.",

                        sortOrder:
                            1
                    }
                });

        assert.equal(
            updated.description,
            "Luxury formal evening styles."
        );

        assert.equal(
            updated.sortOrder,
            1
        );

        const listed =
            await adminService
                .listCategories({
                    db:
                        db,

                    query: {}
                });

        const categories =
            listed.categories ||
            listed.items ||
            listed;

        assert.equal(
            categories.length,
            1
        );

        assert.equal(
            categories[0].id,
            category.id
        );

        const archived =
            await adminService
                .archiveCategory({
                    db:
                        db,

                    administrator:
                        administrator,

                    categoryId:
                        category.id
                });

        assert.equal(
            archived.archived,
            true
        );

        const stored =
            getDocument(
                db,
                "categories/" +
                    category.id
            );

        assert.equal(
            stored.active,
            false
        );

        assert.equal(
            stored.archived,
            true
        );
    }
);

/* ==========================================================
   ORDER STATUS WORKFLOW
========================================================== */

test(
    "administrator advances an order through fulfillment states",
    async function () {
        const db =
            createDatabase({
                "orders/order-1": {
                    userId:
                        "customer-1",

                    orderNumber:
                        "LET-ORDER-1",

                    status:
                        "confirmed",

                    paymentStatus:
                        "paid",

                    total:
                        250000,

                    currency:
                        "NGN",

                    customer: {
                        email:
                            "customer@example.com"
                    },

                    items: [
                        {
                            productId:
                                "product-1",

                            quantity:
                                1,

                            unitPrice:
                                250000,

                            lineTotal:
                                250000
                        }
                    ],

                    statusHistory: []
                }
            });

        const administrator =
            createAdministrator();

        const processing =
            await orderService
                .updateOrderStatus({
                    db:
                        db,

                    orderId:
                        "order-1",

                    status:
                        "processing",

                    administrator:
                        administrator,

                    note:
                        "Order is being prepared."
                });

        assert.equal(
            processing.status,
            "processing"
        );

        const shipped =
            await orderService
                .updateOrderStatus({
                    db:
                        db,

                    orderId:
                        "order-1",

                    status:
                        "shipped",

                    administrator:
                        administrator,

                    note:
                        "Dispatched with courier.",

                    tracking: {
                        carrier:
                            "DHL",

                        trackingNumber:
                            "DHL-123456",

                        trackingUrl:
                            "https://example.com/track/DHL-123456"
                    }
                });

        assert.equal(
            shipped.status,
            "shipped"
        );

        const delivered =
            await orderService
                .updateOrderStatus({
                    db:
                        db,

                    orderId:
                        "order-1",

                    status:
                        "delivered",

                    administrator:
                        administrator,

                    note:
                        "Delivered to the customer."
                });

        assert.equal(
            delivered.status,
            "delivered"
        );

        const stored =
            getDocument(
                db,
                "orders/order-1"
            );

        assert.equal(
            stored.status,
            "delivered"
        );

        assert.equal(
            stored.tracking.carrier,
            "DHL"
        );

        assert.equal(
            stored.tracking.trackingNumber,
            "DHL-123456"
        );

        assert.ok(
            stored.statusHistory.length >=
            3
        );

        assert.deepEqual(
            stored.statusHistory
                .slice(-3)
                .map(
                    function (entry) {
                        return entry.status;
                    }
                ),
            [
                "processing",
                "shipped",
                "delivered"
            ]
        );
    }
);

test(
    "administrator cannot move a delivered order back to pending",
    async function () {
        const db =
            createDatabase({
                "orders/order-1": {
                    userId:
                        "customer-1",

                    status:
                        "delivered",

                    paymentStatus:
                        "paid",

                    total:
                        250000,

                    currency:
                        "NGN",

                    statusHistory: []
                }
            });

        await assert.rejects(
            orderService
                .updateOrderStatus({
                    db:
                        db,

                    orderId:
                        "order-1",

                    status:
                        "pending",

                    administrator:
                        createAdministrator()
                }),
            function (error) {
                assert.match(
                    error.code,
                    /failed-precondition|invalid-argument/
                );

                return true;
            }
        );

        assert.equal(
            getDocument(
                db,
                "orders/order-1"
            ).status,
            "delivered"
        );
    }
);

/* ==========================================================
   CUSTOMER ACCOUNT STATUS
========================================================== */

test(
    "administrator disables and reactivates a customer account",
    async function () {
        const db =
            createDatabase({
                "users/customer-1": {
                    uid:
                        "customer-1",

                    email:
                        "customer@example.com",

                    displayName:
                        "Test Customer",

                    role:
                        "customer",

                    status:
                        "active"
                }
            });

        const auth =
            createAuthService({
                "customer-1": {
                    uid:
                        "customer-1",

                    email:
                        "customer@example.com",

                    disabled:
                        false,

                    customClaims: {
                        role:
                            "customer",

                        admin:
                            false,

                        superadmin:
                            false
                    }
                }
            });

        const administrator =
            createAdministrator();

        const disabled =
            await accountService
                .setUserStatus({
                    db:
                        db,

                    auth:
                        auth,

                    userId:
                        "customer-1",

                    status:
                        "disabled",

                    reason:
                        "Manual fraud review",

                    administrator:
                        administrator
                });

        assert.equal(
            disabled.status,
            "disabled"
        );

        assert.equal(
            auth.users.get(
                "customer-1"
            ).disabled,
            true
        );

        let profile =
            getDocument(
                db,
                "users/customer-1"
            );

        assert.equal(
            profile.status,
            "disabled"
        );

        assert.equal(
            profile.statusReason,
            "Manual fraud review"
        );

        assert.ok(
            auth.writes.some(
                function (write) {
                    return (
                        write.operation ===
                            "revokeRefreshTokens" &&
                        write.userId ===
                            "customer-1"
                    );
                }
            )
        );

        const reactivated =
            await accountService
                .setUserStatus({
                    db:
                        db,

                    auth:
                        auth,

                    userId:
                        "customer-1",

                    status:
                        "active",

                    reason:
                        "Review completed",

                    administrator:
                        administrator
                });

        assert.equal(
            reactivated.status,
            "active"
        );

        assert.equal(
            auth.users.get(
                "customer-1"
            ).disabled,
            false
        );

        profile =
            getDocument(
                db,
                "users/customer-1"
            );

        assert.equal(
            profile.status,
            "active"
        );
    }
);

/* ==========================================================
   ROLE MANAGEMENT
========================================================== */

test(
    "super-administrator promotes and demotes an administrator",
    async function () {
        const db =
            createDatabase({
                "users/customer-1": {
                    uid:
                        "customer-1",

                    email:
                        "customer@example.com",

                    role:
                        "customer",

                    status:
                        "active"
                },

                "users/superadmin-1": {
                    uid:
                        "superadmin-1",

                    email:
                        "owner@example.com",

                    role:
                        "superadmin",

                    status:
                        "active"
                }
            });

        const auth =
            createAuthService({
                "customer-1": {
                    uid:
                        "customer-1",

                    email:
                        "customer@example.com",

                    customClaims: {
                        marketing:
                            true,

                        role:
                            "customer",

                        admin:
                            false,

                        superadmin:
                            false
                    }
                },

                "superadmin-1": {
                    uid:
                        "superadmin-1",

                    email:
                        "owner@example.com",

                    customClaims: {
                        role:
                            "superadmin",

                        admin:
                            true,

                        superadmin:
                            true
                    }
                }
            });

        const superAdministrator =
            createSuperAdministrator();

        const promoted =
            await accountService
                .setUserRole({
                    db:
                        db,

                    auth:
                        auth,

                    userId:
                        "customer-1",

                    role:
                        "admin",

                    administrator:
                        superAdministrator
                });

        assert.equal(
            promoted.role,
            "admin"
        );

        assert.equal(
            getDocument(
                db,
                "users/customer-1"
            ).role,
            "admin"
        );

        assert.deepEqual(
            auth.users.get(
                "customer-1"
            ).customClaims,
            {
                marketing:
                    true,

                role:
                    "admin",

                admin:
                    true,

                superadmin:
                    false
            }
        );

        const demoted =
            await accountService
                .setUserRole({
                    db:
                        db,

                    auth:
                        auth,

                    userId:
                        "customer-1",

                    role:
                        "customer",

                    administrator:
                        superAdministrator
                });

        assert.equal(
            demoted.role,
            "customer"
        );

        assert.equal(
            getDocument(
                db,
                "users/customer-1"
            ).role,
            "customer"
        );

        assert.equal(
            auth.users.get(
                "customer-1"
            ).customClaims.admin,
            false
        );
    }
);

test(
    "super-administrator cannot remove the final active super-admin",
    async function () {
        const db =
            createDatabase({
                "users/superadmin-1": {
                    uid:
                        "superadmin-1",

                    role:
                        "superadmin",

                    status:
                        "active"
                }
            });

        const auth =
            createAuthService({
                "superadmin-1": {
                    uid:
                        "superadmin-1",

                    customClaims: {
                        role:
                            "superadmin",

                        admin:
                            true,

                        superadmin:
                            true
                    }
                }
            });

        await assert.rejects(
            accountService
                .setUserRole({
                    db:
                        db,

                    auth:
                        auth,

                    userId:
                        "superadmin-1",

                    role:
                        "admin",

                    administrator:
                        createSuperAdministrator()
                }),
            function (error) {
                assert.equal(
                    error.code,
                    "failed-precondition"
                );

                return true;
            }
        );

        assert.equal(
            getDocument(
                db,
                "users/superadmin-1"
            ).role,
            "superadmin"
        );
    }
);

/* ==========================================================
   CUSTOMER DELETION
========================================================== */

test(
    "administrator deletion anonymizes profile and removes Auth account",
    async function () {
        const db =
            createDatabase({
                "users/customer-1": {
                    uid:
                        "customer-1",

                    email:
                        "customer@example.com",

                    displayName:
                        "Test Customer",

                    phoneNumber:
                        "+2348000000000",

                    photoURL:
                        "https://example.com/avatar.jpg",

                    addresses: [
                        {
                            city:
                                "Lagos"
                        }
                    ],

                    role:
                        "customer",

                    status:
                        "active"
                },

                "orders/order-1": {
                    userId:
                        "customer-1",

                    customer: {
                        email:
                            "customer@example.com",

                        displayName:
                            "Test Customer"
                    },

                    status:
                        "delivered",

                    paymentStatus:
                        "paid",

                    total:
                        250000
                }
            });

        const auth =
            createAuthService({
                "customer-1": {
                    uid:
                        "customer-1",

                    email:
                        "customer@example.com"
                }
            });

        const result =
            await accountService
                .deleteUserAccount({
                    db:
                        db,

                    auth:
                        auth,

                    userId:
                        "customer-1",

                    administrator:
                        createAdministrator()
                });

        assert.equal(
            result.success,
            true
        );

        assert.equal(
            auth.users.has(
                "customer-1"
            ),
            false
        );

        const profile =
            getDocument(
                db,
                "users/customer-1"
            );

        assert.equal(
            profile.status,
            "deleted"
        );

        assert.equal(
            profile.displayName,
            "Deleted customer"
        );

        assert.deepEqual(
            profile.addresses,
            []
        );

        assert.match(
            profile.email,
            /^deleted\+customer1@/
        );

        /*
         * Historical orders remain intact for accounting and
         * fulfillment records.
         */
        assert.ok(
            getDocument(
                db,
                "orders/order-1"
            )
        );
    }
);

/* ==========================================================
   CUSTOMER LISTING
========================================================== */

test(
    "administrator lists and searches customer accounts",
    async function () {
        const db =
            createDatabase({
                "users/customer-1": {
                    uid:
                        "customer-1",

                    role:
                        "customer",

                    status:
                        "active",

                    displayName:
                        "Samuel Udom",

                    email:
                        "samuel@example.com",

                    createdAt:
                        new Date(
                            "2026-07-20T08:00:00Z"
                        )
                },

                "users/customer-2": {
                    uid:
                        "customer-2",

                    role:
                        "customer",

                    status:
                        "disabled",

                    displayName:
                        "Ada Customer",

                    email:
                        "ada@example.com",

                    createdAt:
                        new Date(
                            "2026-07-19T08:00:00Z"
                        )
                },

                "users/admin-1": {
                    uid:
                        "admin-1",

                    role:
                        "admin",

                    status:
                        "active",

                    email:
                        "admin@example.com",

                    createdAt:
                        new Date(
                            "2026-07-18T08:00:00Z"
                        )
                }
            });

        const active =
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
            active.customers.length,
            1
        );

        assert.equal(
            active.customers[0].id,
            "customer-1"
        );

        assert.equal(
            active.customers[0]
                .email,
            "samuel@example.com"
        );

        const allCustomers =
            await adminService
                .listCustomers({
                    db:
                        db,

                    query: {}
                });

        assert.equal(
            allCustomers.customers.length,
            2
        );

        assert.equal(
            allCustomers.customers.some(
                function (customer) {
                    return customer.id ===
                        "admin-1";
                }
            ),
            false
        );
    }
);

/* ==========================================================
   DASHBOARD METRICS
========================================================== */

test(
    "dashboard metrics reflect administrative workflow data",
    async function () {
        const now =
            new Date();

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
                        false,

                    inventory:
                        2,

                    createdAt:
                        now
                },

                "products/product-2": {
                    name:
                        "Silk Dress",

                    active:
                        true,

                    published:
                        false,

                    archived:
                        false,

                    inventory:
                        20,

                    createdAt:
                        now
                },

                "products/product-3": {
                    name:
                        "Archived Bag",

                    active:
                        false,

                    published:
                        false,

                    archived:
                        true,

                    inventory:
                        0,

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

                "users/admin-1": {
                    role:
                        "admin",

                    status:
                        "active",

                    createdAt:
                        now
                },

                "orders/order-1": {
                    status:
                        "confirmed",

                    paymentStatus:
                        "paid",

                    total:
                        250000,

                    createdAt:
                        now
                },

                "orders/order-2": {
                    status:
                        "pending",

                    paymentStatus:
                        "pending",

                    total:
                        180000,

                    createdAt:
                        now
                },

                "orders/order-3": {
                    status:
                        "cancelled",

                    paymentStatus:
                        "failed",

                    total:
                        100000,

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
            3
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
            metrics.totals.lowStockProducts,
            1
        );

        assert.equal(
            metrics.today.orderCount,
            3
        );

        assert.equal(
            metrics.today.paidOrders,
            1
        );

        assert.equal(
            metrics.today.revenue,
            250000
        );
    }
);

/* ==========================================================
   AUDIT LOGGING
========================================================== */

test(
    "administrative actions produce attributable audit records",
    async function () {
        const db =
            createDatabase({
                "users/customer-1": {
                    uid:
                        "customer-1",

                    role:
                        "customer",

                    status:
                        "active",

                    email:
                        "customer@example.com"
                }
            });

        const auth =
            createAuthService({
                "customer-1": {
                    uid:
                        "customer-1",

                    email:
                        "customer@example.com"
                }
            });

        const administrator =
            createAdministrator();

        await adminService
            .createProduct({
                db:
                    db,

                administrator:
                    administrator,

                payload: {
                    name:
                        "Leather Bag",

                    slug:
                        "leather-bag",

                    price:
                        125000,

                    inventory:
                        5
                }
            });

        await accountService
            .setUserStatus({
                db:
                    db,

                auth:
                    auth,

                userId:
                    "customer-1",

                status:
                    "disabled",

                reason:
                    "Integration test",

                administrator:
                    administrator
            });

        const auditEntries =
            findDocuments(
                db,
                "auditLogs"
            );

        assert.ok(
            auditEntries.length >= 2
        );

        auditEntries.forEach(
            function (entry) {
                const audit =
                    entry[1];

                const actor =
                    audit.actor || {};

                assert.equal(
                    actor.userId ||
                        audit.actorId ||
                        audit.performedBy,
                    "admin-1"
                );

                assert.ok(
                    audit.action
                );

                assert.ok(
                    audit.createdAt
                );
            }
        );
    }
);

/* ==========================================================
   ADMIN API WORKFLOW
========================================================== */

test(
    "admin API creates and retrieves a product",
    async function () {
        const db =
            createDatabase();

        const administrator =
            createAdministrator();

        const creation =
            await adminService
                .handleAdminApi({
                    db:
                        db,

                    auth:
                        createAuthService(),

                    identity:
                        administrator,

                    request: {
                        method:
                            "POST",

                        path:
                            "/api/admin/products",

                        url:
                            "/api/admin/products",

                        query: {},

                        headers: {},

                        body: {
                            name:
                                "Cashmere Scarf",

                            slug:
                                "cashmere-scarf",

                            price:
                                75000,

                            inventory:
                                8
                        }
                    }
                });

        assert.equal(
            creation.status,
            201
        );

        assert.equal(
            creation.body.success,
            true
        );

        const productId =
            creation.body.data.id;

        const retrieval =
            await adminService
                .handleAdminApi({
                    db:
                        db,

                    auth:
                        createAuthService(),

                    identity:
                        administrator,

                    request: {
                        method:
                            "GET",

                        path:
                            "/api/admin/products/" +
                            productId,

                        url:
                            "/api/admin/products/" +
                            productId,

                        query: {},

                        headers: {}
                    }
                });

        assert.equal(
            retrieval.status,
            200
        );

        assert.equal(
            retrieval.body.data.id,
            productId
        );

        assert.equal(
            retrieval.body.data.name,
            "Cashmere Scarf"
        );
    }
);

test(
    "admin API rejects an unauthorised identity",
    async function () {
        const db =
            createDatabase();

        await assert.rejects(
            adminService
                .handleAdminApi({
                    db:
                        db,

                    auth:
                        createAuthService(),

                    identity: {
                        uid:
                            "customer-1",

                        role:
                            "customer",

                        authorized:
                            false
                    },

                    request: {
                        method:
                            "GET",

                        path:
                            "/api/admin/metrics",

                        url:
                            "/api/admin/metrics",

                        query: {},

                        headers: {}
                    }
                }),
            function (error) {
                assert.equal(
                    error.code,
                    "permission-denied"
                );

                return true;
            }
        );
    }
);