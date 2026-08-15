"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ADMINISTRATORS CONTROLLER TESTS

   Run with:
   node --test public/js/admin/administrators-controller.test.js
========================================================== */

const test =
    require(
        "node:test"
    );

const assert =
    require(
        "node:assert/strict"
    );

/* ==========================================================
   LOAD MODULE
========================================================== */

const controllerModule =
    require(
        "./administrators-controller"
    );

const {
    createAdministratorsController,
    AdministratorsControllerError,

    normalizeAdministrators,
    normalizeAdministrator,

    matchesSearch,
    sortAdministrators,
    compareDates,
    toTimestamp,

    getAdministratorRoles,
    getPrimaryRole,
    formatRole,

    normalizeOptions,
    normalizePositiveInteger,
    normalizeRequiredString,
    normalizeOptionalString,
    normalizeStringList,
    normalizeSearch,

    formatDate,
    getInitials,

    normalizeControllerError,
    cloneValue,

    constants
} =
    controllerModule;

/* ==========================================================
   MINIMAL DOM MOCKS
========================================================== */

class MockClassList {
    constructor() {
        this.values =
            new Set();
    }

    add(
        value
    ) {
        this.values.add(
            value
        );
    }

    remove(
        value
    ) {
        this.values.delete(
            value
        );
    }

    contains(
        value
    ) {
        return this.values.has(
            value
        );
    }

    toggle(
        value,
        force
    ) {
        if (
            force ===
            true
        ) {
            this.add(
                value
            );

            return true;
        }

        if (
            force ===
            false
        ) {
            this.remove(
                value
            );

            return false;
        }

        if (
            this.contains(
                value
            )
        ) {
            this.remove(
                value
            );

            return false;
        }

        this.add(
            value
        );

        return true;
    }
}

class MockElement {
    constructor(
        tagName
    ) {
        this.tagName =
            String(
                tagName ||
                "div"
            ).toUpperCase();

        this.children =
            [];

        this.parentNode =
            null;

        this.dataset =
            {};

        this.attributes =
            {};

        this.className =
            "";

        this.classList =
            new MockClassList();

        this.textContent =
            "";

        this.innerHTML =
            "";

        this.value =
            "";

        this.checked =
            false;

        this.disabled =
            false;

        this.hidden =
            false;

        this.colSpan =
            1;

        this.type =
            "";

        this.listeners =
            new Map();

        this._selectors =
            new Map();

        this._selectorLists =
            new Map();
    }

    appendChild(
        child
    ) {
        this.children.push(
            child
        );

        child.parentNode =
            this;

        return child;
    }

    querySelector(
        selector
    ) {
        if (
            this._selectors.has(
                selector
            )
        ) {
            return this._selectors.get(
                selector
            );
        }

        if (
            selector ===
                "tbody"
        ) {
            return this.children.find(
                function (
                    child
                ) {
                    return child.tagName ===
                        "TBODY";
                }
            ) || null;
        }

        return null;
    }

    querySelectorAll(
        selector
    ) {
        if (
            this._selectorLists.has(
                selector
            )
        ) {
            return this._selectorLists.get(
                selector
            );
        }

        return [];
    }

    registerSelector(
        selector,
        element
    ) {
        this._selectors.set(
            selector,
            element
        );

        return element;
    }

    registerSelectorAll(
        selector,
        elements
    ) {
        this._selectorLists.set(
            selector,
            elements
        );

        return elements;
    }

    addEventListener(
        event,
        handler
    ) {
        if (
            !this.listeners.has(
                event
            )
        ) {
            this.listeners.set(
                event,
                []
            );
        }

        this.listeners.get(
            event
        ).push(
            handler
        );
    }

    removeEventListener(
        event,
        handler
    ) {
        const handlers =
            this.listeners.get(
                event
            ) ||
            [];

        this.listeners.set(
            event,
            handlers.filter(
                function (
                    candidate
                ) {
                    return candidate !==
                        handler;
                }
            )
        );
    }

    dispatch(
        event,
        payload
    ) {
        const handlers =
            this.listeners.get(
                event
            ) ||
            [];

        for (
            const handler of
            handlers
        ) {
            handler(
                payload ||
                {
                    target:
                        this
                }
            );
        }
    }

    setAttribute(
        name,
        value
    ) {
        this.attributes[
            name
        ] =
            String(
                value
            );
    }

    getAttribute(
        name
    ) {
        return this.attributes[
            name
        ];
    }

    removeAttribute(
        name
    ) {
        delete this.attributes[
            name
        ];
    }

    focus() {
        this.focused =
            true;
    }

    closest(
        selector
    ) {
        if (
            selector ===
                "[data-administrator-manage]" &&
            this.dataset &&
            this.dataset.administratorManage
        ) {
            return this;
        }

        return null;
    }
}

function createDocumentMock() {
    return {
        createElement(
            tagName
        ) {
            return new MockElement(
                tagName
            );
        },

        createDocumentFragment() {
            return new MockElement(
                "fragment"
            );
        },

        querySelector() {
            return null;
        },

        addEventListener() {},

        removeEventListener() {}
    };
}

/* ==========================================================
   FIXTURE
========================================================== */

function createRootFixture() {
    const root =
        new MockElement(
            "div"
        );

    const elements =
        {};

    for (
        const [
            key,
            selector
        ] of
        Object.entries(
            constants.SELECTORS
        )
    ) {
        if (
            key ===
            "root"
        ) {
            continue;
        }

        if (
            key ===
                "addCancel" ||
            key ===
                "confirmCancel"
        ) {
            continue;
        }

        const element =
            new MockElement(
                key ===
                    "table"
                    ? "div"
                    : "div"
            );

        elements[
            key
        ] =
            element;

        root.registerSelector(
            selector,
            element
        );
    }

    const table =
        elements.table;

    const tbody =
        new MockElement(
            "tbody"
        );

    table.appendChild(
        tbody
    );

    const addCancel1 =
        new MockElement(
            "button"
        );

    const addCancel2 =
        new MockElement(
            "button"
        );

    root.registerSelectorAll(
        constants.SELECTORS
            .addCancel,
        [
            addCancel1,
            addCancel2
        ]
    );

    const confirmCancel1 =
        new MockElement(
            "button"
        );

    const confirmCancel2 =
        new MockElement(
            "button"
        );

    root.registerSelectorAll(
        constants.SELECTORS
            .confirmCancel,
        [
            confirmCancel1,
            confirmCancel2
        ]
    );

    elements.addCancel = [
        addCancel1,
        addCancel2
    ];

    elements.confirmCancel = [
        confirmCancel1,
        confirmCancel2
    ];

    elements.addModal.hidden =
        true;

    elements.confirmModal.hidden =
        true;

    elements.loading.hidden =
        true;

    return {
        root,
        elements,
        tbody
    };
}

function createServiceMock(
    overrides
) {
    const calls = {
        listAdministrators:
            [],

        getAdministrator:
            [],

        setAdministratorRole:
            [],

        removeAdministratorRole:
            [],

        grantAdministratorPermissions:
            [],

        revokeAdministratorPermissions:
            []
    };

    const administrators = [
        {
            uid:
                "owner-1",

            email:
                "owner@example.com",

            displayName:
                "Store Owner",

            disabled:
                false,

            emailVerified:
                true,

            primaryRole:
                "owner",

            roles: [
                "owner"
            ],

            permissions: [
                "*"
            ],

            creationTime:
                "2026-01-01T00:00:00.000Z",

            lastSignInTime:
                "2026-08-09T20:00:00.000Z"
        },

        {
            uid:
                "admin-1",

            email:
                "admin@example.com",

            displayName:
                "Operations Admin",

            disabled:
                false,

            emailVerified:
                true,

            primaryRole:
                "administrator",

            roles: [
                "administrator"
            ],

            permissions: [
                "admins.read",
                "admins.write"
            ],

            creationTime:
                "2026-02-01T00:00:00.000Z",

            lastSignInTime:
                "2026-08-08T20:00:00.000Z"
        },

        {
            uid:
                "support-1",

            email:
                "support@example.com",

            displayName:
                "Support User",

            disabled:
                true,

            emailVerified:
                false,

            primaryRole:
                "support",

            roles: [
                "support"
            ],

            permissions: [
                "orders.read",
                "customers.read"
            ],

            creationTime:
                "2026-03-01T00:00:00.000Z",

            lastSignInTime:
                null
        }
    ];

    const service = {
        async listAdministrators(
            input
        ) {
            calls.listAdministrators.push(
                cloneValue(
                    input
                )
            );

            return {
                success:
                    true,

                administrators:
                    cloneValue(
                        administrators
                    ),

                count:
                    administrators.length
            };
        },

        async getAdministrator(
            uid
        ) {
            calls.getAdministrator.push(
                uid
            );

            const found =
                administrators.find(
                    function (
                        administrator
                    ) {
                        return administrator.uid ===
                            uid;
                    }
                );

            if (
                !found
            ) {
                const error =
                    new Error(
                        "User not found."
                    );

                error.code =
                    "admin-auth/user-not-found";

                throw error;
            }

            return {
                success:
                    true,

                administrator:
                    cloneValue(
                        found
                    )
            };
        },

        async setAdministratorRole(
            input
        ) {
            calls.setAdministratorRole.push(
                cloneValue(
                    input
                )
            );

            return {
                success:
                    true,

                administrator: {
                    uid:
                        input.uid,

                    email:
                        input.uid +
                        "@example.com",

                    displayName:
                        "Updated Admin",

                    primaryRole:
                        input.role,

                    roles: [
                        input.role
                    ],

                    permissions:
                        []
                }
            };
        },

        async removeAdministratorRole(
            input
        ) {
            calls.removeAdministratorRole.push(
                cloneValue(
                    input
                )
            );

            return {
                success:
                    true
            };
        },

        async grantAdministratorPermissions(
            input
        ) {
            calls.grantAdministratorPermissions.push(
                cloneValue(
                    input
                )
            );

            return {
                success:
                    true,

                administrator: {
                    uid:
                        input.uid,

                    email:
                        input.uid +
                        "@example.com",

                    primaryRole:
                        "administrator",

                    roles: [
                        "administrator"
                    ],

                    permissions:
                        cloneValue(
                            input.permissions
                        )
                }
            };
        },

        async revokeAdministratorPermissions(
            input
        ) {
            calls.revokeAdministratorPermissions.push(
                cloneValue(
                    input
                )
            );

            return {
                success:
                    true,

                administrator: {
                    uid:
                        input.uid,

                    email:
                        input.uid +
                        "@example.com",

                    primaryRole:
                        "administrator",

                    roles: [
                        "administrator"
                    ],

                    permissions:
                        []
                }
            };
        }
    };

    Object.assign(
        service,
        overrides ||
        {}
    );

    return {
        service,
        calls,
        administrators
    };
}

/* ==========================================================
   CONSTANTS
========================================================== */

test(
    "exports expected administrator controller constants",
    function () {
        assert.equal(
            constants.DEFAULT_PAGE_SIZE,
            20
        );

        assert.ok(
            constants.ADMIN_ROLES
                .includes(
                    "owner"
                )
        );

        assert.ok(
            constants.ADMIN_ROLES
                .includes(
                    "support"
                )
        );

        assert.equal(
            constants.SELECTORS.root,
            "[data-admin-administrators]"
        );
    }
);

/* ==========================================================
   ADMINISTRATOR NORMALIZATION
========================================================== */

test(
    "normalizes administrator record",
    function () {
        const administrator =
            normalizeAdministrator({
                uid:
                    " admin-1 ",

                email:
                    " admin@example.com ",

                displayName:
                    " Admin User ",

                disabled:
                    true,

                emailVerified:
                    true,

                role:
                    "support",

                permissions: [
                    "orders.read",
                    " orders.read ",
                    "customers.read"
                ],

                metadata: {
                    creationTime:
                        "2026-01-01T00:00:00.000Z",

                    lastSignInTime:
                        "2026-02-01T00:00:00.000Z"
                }
            });

        assert.equal(
            administrator.uid,
            "admin-1"
        );

        assert.equal(
            administrator.email,
            "admin@example.com"
        );

        assert.equal(
            administrator.displayName,
            "Admin User"
        );

        assert.equal(
            administrator.disabled,
            true
        );

        assert.equal(
            administrator.emailVerified,
            true
        );

        assert.equal(
            administrator.primaryRole,
            "support"
        );

        assert.deepEqual(
            administrator.roles,
            [
                "support"
            ]
        );

        assert.deepEqual(
            administrator.permissions,
            [
                "orders.read",
                "customers.read"
            ]
        );
    }
);

test(
    "normalizes administrator arrays and drops missing UIDs",
    function () {
        const rows =
            normalizeAdministrators([
                {
                    uid:
                        "owner-1",

                    role:
                        "owner"
                },

                {
                    email:
                        "missing@example.com"
                }
            ]);

        assert.equal(
            rows.length,
            1
        );

        assert.equal(
            rows[0].uid,
            "owner-1"
        );
    }
);

/* ==========================================================
   ROLE HELPERS
========================================================== */

test(
    "gets administrator roles and primary role",
    function () {
        const administrator = {
            roles: [
                "administrator",
                "support"
            ],

            primaryRole:
                "administrator"
        };

        assert.deepEqual(
            getAdministratorRoles(
                administrator
            ),
            [
                "administrator",
                "support"
            ]
        );

        assert.equal(
            getPrimaryRole(
                administrator
            ),
            "administrator"
        );
    }
);

test(
    "formats administrator role names",
    function () {
        assert.equal(
            formatRole(
                "super-admin"
            ),
            "Super Admin"
        );

        assert.equal(
            formatRole(
                "catalogue"
            ),
            "Catalogue"
        );
    }
);

/* ==========================================================
   SEARCH
========================================================== */

test(
    "matches search across identity role and permissions",
    function () {
        const administrator =
            normalizeAdministrator({
                uid:
                    "support-1",

                email:
                    "support@example.com",

                displayName:
                    "Customer Support",

                role:
                    "support",

                permissions: [
                    "orders.read",
                    "customers.write"
                ]
            });

        assert.equal(
            matchesSearch(
                administrator,
                "customer support"
            ),
            true
        );

        assert.equal(
            matchesSearch(
                administrator,
                "support@example.com"
            ),
            true
        );

        assert.equal(
            matchesSearch(
                administrator,
                "customers.write"
            ),
            true
        );

        assert.equal(
            matchesSearch(
                administrator,
                "inventory.write"
            ),
            false
        );
    }
);

/* ==========================================================
   SORTING
========================================================== */

test(
    "sorts administrators by email ascending",
    function () {
        const rows = [
            normalizeAdministrator({
                uid:
                    "2",

                email:
                    "z@example.com"
            }),

            normalizeAdministrator({
                uid:
                    "1",

                email:
                    "a@example.com"
            })
        ];

        const sorted =
            sortAdministrators(
                rows,
                "email-asc"
            );

        assert.equal(
            sorted[0].email,
            "a@example.com"
        );

        assert.equal(
            sorted[1].email,
            "z@example.com"
        );
    }
);

test(
    "sorts administrators by role descending",
    function () {
        const rows = [
            normalizeAdministrator({
                uid:
                    "1",

                role:
                    "analyst"
            }),

            normalizeAdministrator({
                uid:
                    "2",

                role:
                    "support"
            })
        ];

        const sorted =
            sortAdministrators(
                rows,
                "role-desc"
            );

        assert.equal(
            sorted[0].primaryRole,
            "support"
        );
    }
);

test(
    "sorts administrators by creation date",
    function () {
        const rows = [
            normalizeAdministrator({
                uid:
                    "old",

                creationTime:
                    "2026-01-01T00:00:00.000Z"
            }),

            normalizeAdministrator({
                uid:
                    "new",

                creationTime:
                    "2026-07-01T00:00:00.000Z"
            })
        ];

        const sorted =
            sortAdministrators(
                rows,
                "creationTime-desc"
            );

        assert.equal(
            sorted[0].uid,
            "new"
        );
    }
);

/* ==========================================================
   DATE HELPERS
========================================================== */

test(
    "converts valid timestamps",
    function () {
        assert.equal(
            toTimestamp(
                null
            ),
            0
        );

        assert.equal(
            toTimestamp(
                "invalid"
            ),
            0
        );

        assert.ok(
            toTimestamp(
                "2026-01-01T00:00:00.000Z"
            ) >
            0
        );
    }
);

test(
    "compares dates",
    function () {
        assert.equal(
            compareDates(
                "2026-01-01T00:00:00.000Z",
                "2026-02-01T00:00:00.000Z"
            ),
            -1
        );

        assert.equal(
            compareDates(
                "2026-02-01T00:00:00.000Z",
                "2026-01-01T00:00:00.000Z"
            ),
            1
        );

        assert.equal(
            compareDates(
                null,
                null
            ),
            0
        );
    }
);

/* ==========================================================
   NORMALIZERS
========================================================== */

test(
    "normalizes controller options",
    function () {
        const root =
            new MockElement(
                "div"
            );

        const service =
            {};

        const options =
            normalizeOptions({
                root,
                service,
                pageSize:
                    15
            });

        assert.equal(
            options.root,
            root
        );

        assert.equal(
            options.service,
            service
        );

        assert.equal(
            options.pageSize,
            15
        );

        assert.equal(
            Object.isFrozen(
                options
            ),
            true
        );
    }
);

test(
    "normalizes positive integers",
    function () {
        assert.equal(
            normalizePositiveInteger(
                10,
                20
            ),
            10
        );

        assert.equal(
            normalizePositiveInteger(
                0,
                20
            ),
            20
        );

        assert.equal(
            normalizePositiveInteger(
                "invalid",
                20
            ),
            20
        );
    }
);

test(
    "normalizes required strings",
    function () {
        assert.equal(
            normalizeRequiredString(
                " admin-1 ",
                "UID"
            ),
            "admin-1"
        );

        assert.throws(
            function () {
                normalizeRequiredString(
                    "",
                    "UID"
                );
            },
            function (
                error
            ) {
                assert.ok(
                    error instanceof
                    AdministratorsControllerError
                );

                assert.equal(
                    error.code,
                    "administrators-controller/invalid-argument"
                );

                return true;
            }
        );
    }
);

test(
    "normalizes optional strings",
    function () {
        assert.equal(
            normalizeOptionalString(
                " value "
            ),
            "value"
        );

        assert.equal(
            normalizeOptionalString(
                ""
            ),
            null
        );
    }
);

test(
    "normalizes string lists",
    function () {
        assert.deepEqual(
            normalizeStringList(
                "orders.read,orders.write customers.read"
            ),
            [
                "orders.read",
                "orders.write",
                "customers.read"
            ]
        );

        assert.deepEqual(
            normalizeStringList([
                "orders.read",
                " orders.read ",
                "customers.read"
            ]),
            [
                "orders.read",
                "customers.read"
            ]
        );
    }
);

test(
    "normalizes search values",
    function () {
        assert.equal(
            normalizeSearch(
                " Support User "
            ),
            "support user"
        );
    }
);

/* ==========================================================
   FORMATTERS
========================================================== */

test(
    "formats initials",
    function () {
        assert.equal(
            getInitials(
                "Samuel Udom"
            ),
            "SU"
        );

        assert.equal(
            getInitials(
                "Administrator"
            ),
            "AD"
        );

        assert.equal(
            getInitials(
                ""
            ),
            "A"
        );
    }
);

test(
    "formatDate handles missing and invalid values",
    function () {
        assert.equal(
            formatDate(
                null
            ),
            "Never"
        );

        assert.equal(
            formatDate(
                "not-a-date"
            ),
            "—"
        );
    }
);

/* ==========================================================
   CREATE CONTROLLER
========================================================== */

test(
    "creates administrators controller",
    function () {
        const previousDocument =
            global.document;

        global.document =
            createDocumentMock();

        try {
            const fixture =
                createRootFixture();

            const serviceMock =
                createServiceMock();

            const controller =
                createAdministratorsController({
                    root:
                        fixture.root,

                    service:
                        serviceMock.service,

                    pageSize:
                        2
                });

            assert.equal(
                typeof controller.initialize,
                "function"
            );

            assert.equal(
                typeof controller.refresh,
                "function"
            );

            assert.equal(
                typeof controller.openAdministrator,
                "function"
            );

            assert.equal(
                typeof controller.saveRole,
                "function"
            );

            assert.equal(
                typeof controller.grantPermissions,
                "function"
            );

            assert.equal(
                typeof controller.revokePermissions,
                "function"
            );

            assert.equal(
                typeof controller.removeAdministrator,
                "function"
            );

            assert.equal(
                Object.isFrozen(
                    controller
                ),
                true
            );
        } finally {
            global.document =
                previousDocument;
        }
    }
);

test(
    "rejects controller creation without root",
    function () {
        const previousDocument =
            global.document;

        global.document = {
            querySelector() {
                return null;
            }
        };

        try {
            assert.throws(
                function () {
                    createAdministratorsController({
                        service:
                            createServiceMock()
                                .service
                    });
                },
                function (
                    error
                ) {
                    assert.equal(
                        error.code,
                        "administrators-controller/root-not-found"
                    );

                    return true;
                }
            );
        } finally {
            global.document =
                previousDocument;
        }
    }
);

/* ==========================================================
   INITIALIZE / REFRESH
========================================================== */

test(
    "initialization loads administrators",
    async function () {
        const previousDocument =
            global.document;

        global.document =
            createDocumentMock();

        try {
            const fixture =
                createRootFixture();

            const serviceMock =
                createServiceMock();

            const controller =
                createAdministratorsController({
                    root:
                        fixture.root,

                    service:
                        serviceMock.service,

                    pageSize:
                        2
                });

            await controller.initialize();

            assert.equal(
                serviceMock.calls
                    .listAdministrators
                    .length,
                1
            );

            assert.deepEqual(
                serviceMock.calls
                    .listAdministrators[0],
                {
                    fetchAll:
                        true,

                    pageSize:
                        1000
                }
            );

            assert.equal(
                controller.state
                    .administrators
                    .length,
                3
            );

            assert.equal(
                controller.state
                    .filtered
                    .length,
                3
            );

            assert.equal(
                fixture.elements
                    .total
                    .textContent,
                "3"
            );

            assert.equal(
                fixture.elements
                    .owners
                    .textContent,
                "1"
            );

            assert.equal(
                fixture.elements
                    .active
                    .textContent,
                "2"
            );

            assert.equal(
                fixture.elements
                    .disabled
                    .textContent,
                "1"
            );
        } finally {
            global.document =
                previousDocument;
        }
    }
);

/* ==========================================================
   FILTERS
========================================================== */

test(
    "search filter narrows administrators",
    async function () {
        const previousDocument =
            global.document;

        global.document =
            createDocumentMock();

        try {
            const fixture =
                createRootFixture();

            const serviceMock =
                createServiceMock();

            const controller =
                createAdministratorsController({
                    root:
                        fixture.root,

                    service:
                        serviceMock.service
                });

            await controller.initialize();

            controller.state.search =
                "support@example.com";

            controller.applyFilters();

            assert.equal(
                controller.state
                    .filtered
                    .length,
                1
            );

            assert.equal(
                controller.state
                    .filtered[0]
                    .uid,
                "support-1"
            );
        } finally {
            global.document =
                previousDocument;
        }
    }
);

test(
    "role filter narrows administrators",
    async function () {
        const previousDocument =
            global.document;

        global.document =
            createDocumentMock();

        try {
            const fixture =
                createRootFixture();

            const serviceMock =
                createServiceMock();

            const controller =
                createAdministratorsController({
                    root:
                        fixture.root,

                    service:
                        serviceMock.service
                });

            await controller.initialize();

            controller.state.role =
                "owner";

            controller.applyFilters();

            assert.equal(
                controller.state
                    .filtered
                    .length,
                1
            );

            assert.equal(
                controller.state
                    .filtered[0]
                    .uid,
                "owner-1"
            );
        } finally {
            global.document =
                previousDocument;
        }
    }
);

test(
    "status filter supports disabled administrators",
    async function () {
        const previousDocument =
            global.document;

        global.document =
            createDocumentMock();

        try {
            const fixture =
                createRootFixture();

            const serviceMock =
                createServiceMock();

            const controller =
                createAdministratorsController({
                    root:
                        fixture.root,

                    service:
                        serviceMock.service
                });

            await controller.initialize();

            controller.state.status =
                "disabled";

            controller.applyFilters();

            assert.equal(
                controller.state
                    .filtered
                    .length,
                1
            );

            assert.equal(
                controller.state
                    .filtered[0]
                    .uid,
                "support-1"
            );
        } finally {
            global.document =
                previousDocument;
        }
    }
);

/* ==========================================================
   CLEAR FILTERS
========================================================== */

test(
    "clearFilters restores default state",
    async function () {
        const previousDocument =
            global.document;

        global.document =
            createDocumentMock();

        try {
            const fixture =
                createRootFixture();

            const serviceMock =
                createServiceMock();

            const controller =
                createAdministratorsController({
                    root:
                        fixture.root,

                    service:
                        serviceMock.service
                });

            await controller.initialize();

            controller.state.search =
                "support";

            controller.state.role =
                "support";

            controller.state.status =
                "disabled";

            controller.state.sort =
                "email-desc";

            controller.clearFilters();

            assert.equal(
                controller.state.search,
                ""
            );

            assert.equal(
                controller.state.role,
                ""
            );

            assert.equal(
                controller.state.status,
                ""
            );

            assert.equal(
                controller.state.sort,
                "email-asc"
            );

            assert.equal(
                controller.state.filtered.length,
                3
            );
        } finally {
            global.document =
                previousDocument;
        }
    }
);

/* ==========================================================
   OPEN ADMINISTRATOR
========================================================== */

test(
    "openAdministrator loads and selects administrator",
    async function () {
        const previousDocument =
            global.document;

        global.document =
            createDocumentMock();

        try {
            const fixture =
                createRootFixture();

            const serviceMock =
                createServiceMock();

            const controller =
                createAdministratorsController({
                    root:
                        fixture.root,

                    service:
                        serviceMock.service
                });

            await controller.initialize();

            const administrator =
                await controller
                    .openAdministrator(
                        "admin-1"
                    );

            assert.equal(
                administrator.uid,
                "admin-1"
            );

            assert.equal(
                controller.state
                    .selectedUid,
                "admin-1"
            );

            assert.equal(
                fixture.elements
                    .administratorEmail
                    .textContent,
                "admin@example.com"
            );

            assert.equal(
                fixture.elements
                    .role
                    .value,
                "administrator"
            );

            assert.equal(
                fixture.elements
                    .drawer
                    .classList
                    .contains(
                        "is-open"
                    ),
                true
            );
        } finally {
            global.document =
                previousDocument;
        }
    }
);

/* ==========================================================
   ADD MODAL
========================================================== */

test(
    "opens and closes add administrator modal",
    function () {
        const previousDocument =
            global.document;

        global.document =
            createDocumentMock();

        try {
            const fixture =
                createRootFixture();

            const serviceMock =
                createServiceMock();

            const controller =
                createAdministratorsController({
                    root:
                        fixture.root,

                    service:
                        serviceMock.service
                });

            controller.openAddModal();

            assert.equal(
                fixture.elements
                    .addModal
                    .hidden,
                false
            );

            assert.equal(
                fixture.elements
                    .addUid
                    .focused,
                true
            );

            controller.closeAddModal();

            assert.equal(
                fixture.elements
                    .addModal
                    .hidden,
                true
            );
        } finally {
            global.document =
                previousDocument;
        }
    }
);

/* ==========================================================
   CONFIRMATION
========================================================== */

test(
    "confirmation modal resolves cancelled action without running mutation",
    async function () {
        const previousDocument =
            global.document;

        global.document =
            createDocumentMock();

        try {
            const fixture =
                createRootFixture();

            const serviceMock =
                createServiceMock();

            const controller =
                createAdministratorsController({
                    root:
                        fixture.root,

                    service:
                        serviceMock.service
                });

            let executed =
                false;

            const pending =
                controller.confirm({
                    title:
                        "Confirm",

                    message:
                        "Confirm action?",

                    action:
                        async function () {
                            executed =
                                true;
                        }
                });

            assert.equal(
                fixture.elements
                    .confirmModal
                    .hidden,
                false
            );

            controller.cancelConfirmation();

            const result =
                await pending;

            assert.equal(
                result,
                null
            );

            assert.equal(
                executed,
                false
            );
        } finally {
            global.document =
                previousDocument;
        }
    }
);

/* ==========================================================
   ROLE MUTATION
========================================================== */

test(
    "saveRole forwards selected role after confirmation",
    async function () {
        const previousDocument =
            global.document;

        global.document =
            createDocumentMock();

        try {
            const fixture =
                createRootFixture();

            const serviceMock =
                createServiceMock();

            const controller =
                createAdministratorsController({
                    root:
                        fixture.root,

                    service:
                        serviceMock.service
                });

            await controller.initialize();

            await controller
                .openAdministrator(
                    "admin-1"
                );

            fixture.elements.role.value =
                "support";

            fixture.elements.roleReason.value =
                "Moved to support";

            const pending =
                controller.saveRole();

            await controller
                .submitConfirmation();

            await pending;

            assert.equal(
                serviceMock.calls
                    .setAdministratorRole
                    .length,
                1
            );

            assert.deepEqual(
                serviceMock.calls
                    .setAdministratorRole[0],
                {
                    uid:
                        "admin-1",

                    role:
                        "support",

                    replacePermissions:
                        false,

                    reason:
                        "Moved to support"
                }
            );
        } finally {
            global.document =
                previousDocument;
        }
    }
);

/* ==========================================================
   GRANT PERMISSIONS
========================================================== */

test(
    "grantPermissions forwards normalized permissions",
    async function () {
        const previousDocument =
            global.document;

        global.document =
            createDocumentMock();

        try {
            const fixture =
                createRootFixture();

            const serviceMock =
                createServiceMock();

            const controller =
                createAdministratorsController({
                    root:
                        fixture.root,

                    service:
                        serviceMock.service
                });

            await controller.initialize();

            await controller
                .openAdministrator(
                    "admin-1"
                );

            fixture.elements
                .grantPermissions
                .value =
                "orders.refund, customers.delete";

            fixture.elements
                .grantReason
                .value =
                "Senior access";

            const pending =
                controller
                    .grantPermissions();

            await controller
                .submitConfirmation();

            await pending;

            assert.deepEqual(
                serviceMock.calls
                    .grantAdministratorPermissions[0],
                {
                    uid:
                        "admin-1",

                    permissions: [
                        "orders.refund",
                        "customers.delete"
                    ],

                    reason:
                        "Senior access"
                }
            );
        } finally {
            global.document =
                previousDocument;
        }
    }
);

/* ==========================================================
   REVOKE PERMISSIONS
========================================================== */

test(
    "revokePermissions forwards normalized permissions",
    async function () {
        const previousDocument =
            global.document;

        global.document =
            createDocumentMock();

        try {
            const fixture =
                createRootFixture();

            const serviceMock =
                createServiceMock();

            const controller =
                createAdministratorsController({
                    root:
                        fixture.root,

                    service:
                        serviceMock.service
                });

            await controller.initialize();

            await controller
                .openAdministrator(
                    "admin-1"
                );

            fixture.elements
                .revokePermissions
                .value =
                "orders.refund";

            fixture.elements
                .revokeReason
                .value =
                "Refund access removed";

            const pending =
                controller
                    .revokePermissions();

            await controller
                .submitConfirmation();

            await pending;

            assert.deepEqual(
                serviceMock.calls
                    .revokeAdministratorPermissions[0],
                {
                    uid:
                        "admin-1",

                    permissions: [
                        "orders.refund"
                    ],

                    reason:
                        "Refund access removed"
                }
            );
        } finally {
            global.document =
                previousDocument;
        }
    }
);

/* ==========================================================
   REMOVE ADMINISTRATOR
========================================================== */

test(
    "removeAdministrator removes administrator from local directory",
    async function () {
        const previousDocument =
            global.document;

        global.document =
            createDocumentMock();

        try {
            const fixture =
                createRootFixture();

            const serviceMock =
                createServiceMock();

            const controller =
                createAdministratorsController({
                    root:
                        fixture.root,

                    service:
                        serviceMock.service
                });

            await controller.initialize();

            await controller
                .openAdministrator(
                    "support-1"
                );

            fixture.elements
                .removeReason
                .value =
                "Access ended";

            fixture.elements
                .preservePermissions
                .checked =
                true;

            const pending =
                controller
                    .removeAdministrator();

            await controller
                .submitConfirmation();

            await pending;

            assert.deepEqual(
                serviceMock.calls
                    .removeAdministratorRole[0],
                {
                    uid:
                        "support-1",

                    preservePermissions:
                        true,

                    reason:
                        "Access ended"
                }
            );

            assert.equal(
                controller.state
                    .administrators
                    .some(
                        function (
                            administrator
                        ) {
                            return administrator.uid ===
                                "support-1";
                        }
                    ),
                false
            );
        } finally {
            global.document =
                previousDocument;
        }
    }
);

/* ==========================================================
   ERROR NORMALIZATION
========================================================== */

test(
    "normalizes permission denied error",
    function () {
        const source =
            new Error(
                "Denied"
            );

        source.code =
            "admin-auth/permission-denied";

        const normalized =
            normalizeControllerError(
                source
            );

        assert.ok(
            normalized instanceof
            AdministratorsControllerError
        );

        assert.equal(
            normalized.code,
            "admin-auth/permission-denied"
        );

        assert.match(
            normalized.message,
            /do not have permission/i
        );
    }
);

test(
    "normalizes final owner protection error",
    function () {
        const source =
            new Error(
                "Cannot remove"
            );

        source.code =
            "admin-auth/final-owner";

        const normalized =
            normalizeControllerError(
                source
            );

        assert.match(
            normalized.message,
            /final owner/i
        );
    }
);

test(
    "normalizes user-not-found error",
    function () {
        const source =
            new Error(
                "Missing"
            );

        source.code =
            "auth/user-not-found";

        const normalized =
            normalizeControllerError(
                source
            );

        assert.match(
            normalized.message,
            /could not be found/i
        );
    }
);

/* ==========================================================
   CLONE
========================================================== */

test(
    "cloneValue deep clones administrator data",
    function () {
        const source = {
            roles: [
                "owner"
            ],

            nested: {
                permissions: [
                    "*"
                ]
            }
        };

        const cloned =
            cloneValue(
                source
            );

        assert.deepEqual(
            cloned,
            source
        );

        cloned.roles.push(
            "admin"
        );

        assert.deepEqual(
            source.roles,
            [
                "owner"
            ]
        );
    }
);

/* ==========================================================
   MODULE IMMUTABILITY
========================================================== */

test(
    "administrators controller module is frozen",
    function () {
        assert.equal(
            Object.isFrozen(
                controllerModule
            ),
            true
        );

        assert.equal(
            Object.isFrozen(
                controllerModule.constants
            ),
            true
        );

        assert.equal(
            Object.isFrozen(
                controllerModule.constants
                    .ADMIN_ROLES
            ),
            true
        );

        assert.equal(
            Object.isFrozen(
                controllerModule.constants
                    .SELECTORS
            ),
            true
        );
    }
);