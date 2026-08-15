"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   ADMINISTRATORS CONTROLLER

   Responsibilities:
   - Load administrator accounts
   - Search / filter / sort / paginate
   - Render metrics and directory
   - Open administrator detail drawer
   - Assign administrator roles
   - Grant / revoke permissions
   - Remove administrator access
   - Add existing Firebase users as administrators
========================================================== */

(function (global) {
    /* ======================================================
       CONSTANTS
    ====================================================== */

    const DEFAULT_PAGE_SIZE =
        20;

    const ADMIN_ROLES =
        Object.freeze([
            "owner",
            "super-admin",
            "administrator",
            "admin",
            "catalogue",
            "fulfilment",
            "support",
            "analyst"
        ]);

    const SELECTORS =
        Object.freeze({
            root:
                "[data-admin-administrators]",

            status:
                "[data-administrators-status]",

            refresh:
                "[data-administrators-refresh]",

            add:
                "[data-administrators-add]",

            search:
                "[data-administrators-search]",

            roleFilter:
                "[data-administrators-role-filter]",

            statusFilter:
                "[data-administrators-status-filter]",

            sort:
                "[data-administrators-sort]",

            clearFilters:
                "[data-administrators-clear-filters]",

            table:
                "[data-administrators-table]",

            total:
                "[data-administrators-total]",

            owners:
                "[data-administrators-owners]",

            active:
                "[data-administrators-active]",

            disabled:
                "[data-administrators-disabled]",

            visibleCount:
                "[data-administrators-visible-count]",

            previous:
                "[data-administrators-previous]",

            next:
                "[data-administrators-next]",

            pageLabel:
                "[data-administrators-page-label]",

            drawer:
                "[data-administrators-drawer]",

            drawerClose:
                "[data-administrators-drawer-close]",

            drawerName:
                "[data-administrator-drawer-name]",

            administratorId:
                "[data-administrator-id]",

            administratorAvatar:
                "[data-administrator-avatar]",

            administratorName:
                "[data-administrator-name]",

            administratorEmail:
                "[data-administrator-email]",

            administratorUid:
                "[data-administrator-uid]",

            administratorStatus:
                "[data-administrator-status]",

            administratorEmailVerified:
                "[data-administrator-email-verified]",

            administratorCreated:
                "[data-administrator-created]",

            administratorLastSignin:
                "[data-administrator-last-signin]",

            role:
                "[data-administrator-role]",

            roleReason:
                "[data-administrator-role-reason]",

            replacePermissions:
                "[data-administrator-replace-permissions]",

            saveRole:
                "[data-administrator-save-role]",

            permissions:
                "[data-administrator-permissions]",

            grantPermissions:
                "[data-administrator-grant-permissions]",

            grantReason:
                "[data-administrator-grant-reason]",

            grant:
                "[data-administrator-grant]",

            revokePermissions:
                "[data-administrator-revoke-permissions]",

            revokeReason:
                "[data-administrator-revoke-reason]",

            revoke:
                "[data-administrator-revoke]",

            removeReason:
                "[data-administrator-remove-reason]",

            preservePermissions:
                "[data-administrator-preserve-permissions]",

            remove:
                "[data-administrator-remove]",

            addModal:
                "[data-administrators-add-modal]",

            addUid:
                "[data-administrators-add-uid]",

            addRole:
                "[data-administrators-add-role]",

            addPermissions:
                "[data-administrators-add-permissions]",

            addReason:
                "[data-administrators-add-reason]",

            addReplacePermissions:
                "[data-administrators-add-replace-permissions]",

            addConfirm:
                "[data-administrators-add-confirm]",

            addCancel:
                "[data-administrators-add-cancel]",

            confirmModal:
                "[data-administrators-confirm-modal]",

            confirmTitle:
                "[data-administrators-confirm-title]",

            confirmMessage:
                "[data-administrators-confirm-message]",

            confirmSubmit:
                "[data-administrators-confirm-submit]",

            confirmCancel:
                "[data-administrators-confirm-cancel]",

            loading:
                "[data-administrators-loading]",

            loadingMessage:
                "[data-administrators-loading-message]"
        });

    /* ======================================================
       ERROR
    ====================================================== */

    class AdministratorsControllerError extends Error {
        constructor(
            code,
            message,
            options
        ) {
            super(
                message ||
                "Administrator management failed."
            );

            this.name =
                "AdministratorsControllerError";

            this.code =
                code ||
                "administrators-controller/unknown";

            const settings =
                options ||
                {};

            this.details =
                settings.details ||
                null;

            this.originalError =
                settings.originalError ||
                null;
        }
    }

    /* ======================================================
       FACTORY
    ====================================================== */

    function createAdministratorsController(
        options
    ) {
        const settings =
            normalizeOptions(
                options
            );

        const root =
            settings.root ||
            (
                global.document
                    ? global.document.querySelector(
                          settings.selectors.root
                      )
                    : null
            );

        if (
            !root
        ) {
            throw new AdministratorsControllerError(
                "administrators-controller/root-not-found",
                "Administrator management root element was not found."
            );
        }

        const service =
            settings.service ||
            resolveAdminAuthService();

        if (
            !service
        ) {
            throw new AdministratorsControllerError(
                "administrators-controller/service-unavailable",
                "Administrator authorization frontend service is unavailable."
            );
        }

        const elements =
            collectElements(
                root,
                settings.selectors
            );

        const state = {
            initialized:
                false,

            destroyed:
                false,

            loading:
                false,

            administrators:
                [],

            filtered:
                [],

            selectedUid:
                null,

            selectedAdministrator:
                null,

            page:
                1,

            pageSize:
                settings.pageSize,

            search:
                "",

            role:
                "",

            status:
                "",

            sort:
                "email-asc",

            confirmAction:
                null,

            listeners:
                []
        };

        /* ==================================================
           INITIALIZATION
        ================================================== */

        async function initialize() {
            if (
                state.initialized
            ) {
                return api;
            }

            bindEvents();

            state.initialized =
                true;

            await refresh();

            return api;
        }

        function destroy() {
            for (
                const listener of
                state.listeners
            ) {
                listener.element
                    .removeEventListener(
                        listener.event,
                        listener.handler
                    );
            }

            state.listeners =
                [];

            state.destroyed =
                true;

            closeDrawer();
            closeAddModal();
            closeConfirmModal();
        }

        /* ==================================================
           LOAD
        ================================================== */

        async function refresh() {
            setLoading(
                true,
                "Loading administrators…"
            );

            clearStatus();

            try {
                const result =
                    await service
                        .listAdministrators({
                            fetchAll:
                                true,

                            pageSize:
                                1000
                        });

                state.administrators =
                    normalizeAdministrators(
                        result &&
                        result.administrators
                    );

                state.page =
                    1;

                applyFilters();

                if (
                    state.selectedUid
                ) {
                    const selected =
                        findAdministrator(
                            state.selectedUid
                        );

                    if (
                        selected
                    ) {
                        state.selectedAdministrator =
                            selected;

                        renderDrawer(
                            selected
                        );
                    } else {
                        closeDrawer();
                    }
                }

                return state.administrators;
            } catch (
                error
            ) {
                const normalized =
                    normalizeControllerError(
                        error
                    );

                setStatus(
                    normalized.message,
                    "error"
                );

                throw normalized;
            } finally {
                setLoading(
                    false
                );
            }
        }

        /* ==================================================
           FILTER / SORT
        ================================================== */

        function applyFilters() {
            const search =
                normalizeSearch(
                    state.search
                );

            let rows =
                state.administrators
                    .filter(
                        function (
                            administrator
                        ) {
                            if (
                                search &&
                                !matchesSearch(
                                    administrator,
                                    search
                                )
                            ) {
                                return false;
                            }

                            if (
                                state.role &&
                                !getAdministratorRoles(
                                    administrator
                                ).includes(
                                    state.role
                                )
                            ) {
                                return false;
                            }

                            if (
                                state.status ===
                                    "active" &&
                                administrator.disabled
                            ) {
                                return false;
                            }

                            if (
                                state.status ===
                                    "disabled" &&
                                !administrator.disabled
                            ) {
                                return false;
                            }

                            return true;
                        }
                    );

            rows =
                sortAdministrators(
                    rows,
                    state.sort
                );

            state.filtered =
                rows;

            const pages =
                getPageCount();

            if (
                state.page >
                pages
            ) {
                state.page =
                    pages;
            }

            if (
                state.page <
                1
            ) {
                state.page =
                    1;
            }

            render();
        }

        function clearFilters() {
            state.search =
                "";

            state.role =
                "";

            state.status =
                "";

            state.sort =
                "email-asc";

            state.page =
                1;

            if (
                elements.search
            ) {
                elements.search.value =
                    "";
            }

            if (
                elements.roleFilter
            ) {
                elements.roleFilter.value =
                    "";
            }

            if (
                elements.statusFilter
            ) {
                elements.statusFilter.value =
                    "";
            }

            if (
                elements.sort
            ) {
                elements.sort.value =
                    "email-asc";
            }

            applyFilters();
        }

        /* ==================================================
           RENDER
        ================================================== */

        function render() {
            renderMetrics();
            renderTable();
            renderPagination();
        }

        function renderMetrics() {
            const administrators =
                state.administrators;

            setText(
                elements.total,
                administrators.length
            );

            setText(
                elements.owners,
                administrators.filter(
                    function (
                        administrator
                    ) {
                        const roles =
                            getAdministratorRoles(
                                administrator
                            );

                        return (
                            roles.includes(
                                "owner"
                            ) ||
                            roles.includes(
                                "super-admin"
                            )
                        );
                    }
                ).length
            );

            setText(
                elements.active,
                administrators.filter(
                    function (
                        administrator
                    ) {
                        return !administrator.disabled;
                    }
                ).length
            );

            setText(
                elements.disabled,
                administrators.filter(
                    function (
                        administrator
                    ) {
                        return administrator.disabled;
                    }
                ).length
            );

            setText(
                elements.visibleCount,
                state.filtered.length
            );
        }

        function renderTable() {
            if (
                !elements.table
            ) {
                return;
            }

            const tbody =
                elements.table.querySelector(
                    "tbody"
                );

            if (
                !tbody
            ) {
                return;
            }

            const rows =
                getCurrentPageRows();

            tbody.innerHTML =
                "";

            if (
                !rows.length
            ) {
                const tr =
                    global.document.createElement(
                        "tr"
                    );

                const td =
                    global.document.createElement(
                        "td"
                    );

                td.colSpan =
                    7;

                td.textContent =
                    "No administrator accounts match the current filters.";

                tr.appendChild(
                    td
                );

                tbody.appendChild(
                    tr
                );

                return;
            }

            const fragment =
                global.document.createDocumentFragment();

            for (
                const administrator of
                rows
            ) {
                fragment.appendChild(
                    createAdministratorRow(
                        administrator
                    )
                );
            }

            tbody.appendChild(
                fragment
            );
        }

        function createAdministratorRow(
            administrator
        ) {
            const tr =
                global.document.createElement(
                    "tr"
                );

            tr.dataset.uid =
                administrator.uid;

            /* ----------------------------------------------
               IDENTITY
            ---------------------------------------------- */

            const identityCell =
                global.document.createElement(
                    "td"
                );

            const identity =
                global.document.createElement(
                    "div"
                );

            identity.className =
                "admin-table-identity";

            const avatar =
                global.document.createElement(
                    "span"
                );

            avatar.className =
                "admin-user-avatar";

            avatar.textContent =
                getInitials(
                    administrator.displayName ||
                    administrator.email ||
                    administrator.uid
                );

            const copy =
                global.document.createElement(
                    "span"
                );

            const name =
                global.document.createElement(
                    "strong"
                );

            name.textContent =
                administrator.displayName ||
                administrator.email ||
                "Administrator";

            const email =
                global.document.createElement(
                    "small"
                );

            email.textContent =
                administrator.email ||
                administrator.uid;

            copy.appendChild(
                name
            );

            copy.appendChild(
                email
            );

            identity.appendChild(
                avatar
            );

            identity.appendChild(
                copy
            );

            identityCell.appendChild(
                identity
            );

            /* ----------------------------------------------
               ROLE
            ---------------------------------------------- */

            const roleCell =
                global.document.createElement(
                    "td"
                );

            const roleBadge =
                global.document.createElement(
                    "span"
                );

            roleBadge.className =
                "admin-status-badge";

            roleBadge.textContent =
                formatRole(
                    getPrimaryRole(
                        administrator
                    )
                );

            roleCell.appendChild(
                roleBadge
            );

            /* ----------------------------------------------
               PERMISSIONS
            ---------------------------------------------- */

            const permissionCell =
                global.document.createElement(
                    "td"
                );

            const permissions =
                normalizeStringList(
                    administrator.permissions
                );

            if (
                permissions.includes(
                    "*"
                )
            ) {
                permissionCell.textContent =
                    "Full access";
            } else {
                permissionCell.textContent =
                    permissions.length
                        ? String(
                              permissions.length
                          )
                        : "Role defaults";
            }

            /* ----------------------------------------------
               STATUS
            ---------------------------------------------- */

            const statusCell =
                global.document.createElement(
                    "td"
                );

            const statusBadge =
                global.document.createElement(
                    "span"
                );

            statusBadge.className =
                "admin-status-badge " +
                (
                    administrator.disabled
                        ? "is-disabled"
                        : "is-active"
                );

            statusBadge.textContent =
                administrator.disabled
                    ? "Disabled"
                    : "Active";

            statusCell.appendChild(
                statusBadge
            );

            /* ----------------------------------------------
               LAST SIGN-IN
            ---------------------------------------------- */

            const signInCell =
                global.document.createElement(
                    "td"
                );

            signInCell.textContent =
                formatDate(
                    administrator.lastSignInTime ||
                    administrator.metadata &&
                    administrator.metadata.lastSignInTime
                );

            /* ----------------------------------------------
               CREATED
            ---------------------------------------------- */

            const createdCell =
                global.document.createElement(
                    "td"
                );

            createdCell.textContent =
                formatDate(
                    administrator.creationTime ||
                    administrator.metadata &&
                    administrator.metadata.creationTime
                );

            /* ----------------------------------------------
               ACTIONS
            ---------------------------------------------- */

            const actionCell =
                global.document.createElement(
                    "td"
                );

            const manage =
                global.document.createElement(
                    "button"
                );

            manage.type =
                "button";

            manage.className =
                "admin-text-button";

            manage.dataset.administratorManage =
                administrator.uid;

            manage.textContent =
                "Manage";

            actionCell.appendChild(
                manage
            );

            tr.appendChild(
                identityCell
            );

            tr.appendChild(
                roleCell
            );

            tr.appendChild(
                permissionCell
            );

            tr.appendChild(
                statusCell
            );

            tr.appendChild(
                signInCell
            );

            tr.appendChild(
                createdCell
            );

            tr.appendChild(
                actionCell
            );

            return tr;
        }

        function renderPagination() {
            const pageCount =
                getPageCount();

            setText(
                elements.pageLabel,
                "Page " +
                state.page +
                " of " +
                pageCount
            );

            if (
                elements.previous
            ) {
                elements.previous.disabled =
                    state.page <=
                    1;
            }

            if (
                elements.next
            ) {
                elements.next.disabled =
                    state.page >=
                    pageCount;
            }
        }

        /* ==================================================
           DRAWER
        ================================================== */

        async function openAdministrator(
            uid
        ) {
            const normalizedUid =
                normalizeRequiredString(
                    uid,
                    "Administrator UID"
                );

            setLoading(
                true,
                "Loading administrator…"
            );

            try {
                let administrator =
                    findAdministrator(
                        normalizedUid
                    );

                try {
                    const result =
                        await service
                            .getAdministrator(
                                normalizedUid
                            );

                    if (
                        result &&
                        result.administrator
                    ) {
                        administrator =
                            normalizeAdministrator(
                                result.administrator
                            );

                        upsertAdministrator(
                            administrator
                        );
                    }
                } catch (
                    error
                ) {
                    if (
                        !administrator
                    ) {
                        throw error;
                    }
                }

                if (
                    !administrator
                ) {
                    throw new AdministratorsControllerError(
                        "administrators-controller/not-found",
                        "Administrator account could not be found."
                    );
                }

                state.selectedUid =
                    administrator.uid;

                state.selectedAdministrator =
                    administrator;

                renderDrawer(
                    administrator
                );

                showDrawer();

                return administrator;
            } catch (
                error
            ) {
                const normalized =
                    normalizeControllerError(
                        error
                    );

                setStatus(
                    normalized.message,
                    "error"
                );

                throw normalized;
            } finally {
                setLoading(
                    false
                );
            }
        }

        function renderDrawer(
            administrator
        ) {
            setValue(
                elements.administratorId,
                administrator.uid
            );

            setText(
                elements.drawerName,
                administrator.displayName ||
                administrator.email ||
                "Manage Access"
            );

            setText(
                elements.administratorAvatar,
                getInitials(
                    administrator.displayName ||
                    administrator.email ||
                    administrator.uid
                )
            );

            setText(
                elements.administratorName,
                administrator.displayName ||
                "Administrator"
            );

            setText(
                elements.administratorEmail,
                administrator.email ||
                "—"
            );

            setText(
                elements.administratorUid,
                administrator.uid
            );

            setText(
                elements.administratorStatus,
                administrator.disabled
                    ? "Disabled"
                    : "Active"
            );

            setText(
                elements.administratorEmailVerified,
                administrator.emailVerified
                    ? "Yes"
                    : "No"
            );

            setText(
                elements.administratorCreated,
                formatDate(
                    administrator.creationTime ||
                    administrator.metadata &&
                    administrator.metadata.creationTime
                )
            );

            setText(
                elements.administratorLastSignin,
                formatDate(
                    administrator.lastSignInTime ||
                    administrator.metadata &&
                    administrator.metadata.lastSignInTime
                )
            );

            setValue(
                elements.role,
                getPrimaryRole(
                    administrator
                ) ||
                "admin"
            );

            setValue(
                elements.roleReason,
                ""
            );

            setChecked(
                elements.replacePermissions,
                false
            );

            setValue(
                elements.grantPermissions,
                ""
            );

            setValue(
                elements.grantReason,
                ""
            );

            setValue(
                elements.revokePermissions,
                ""
            );

            setValue(
                elements.revokeReason,
                ""
            );

            setValue(
                elements.removeReason,
                ""
            );

            setChecked(
                elements.preservePermissions,
                false
            );

            renderPermissions(
                administrator.permissions
            );
        }

        function renderPermissions(
            permissions
        ) {
            if (
                !elements.permissions
            ) {
                return;
            }

            elements.permissions.innerHTML =
                "";

            const values =
                normalizeStringList(
                    permissions
                );

            if (
                !values.length
            ) {
                const empty =
                    global.document.createElement(
                        "span"
                    );

                empty.className =
                    "admin-tag";

                empty.textContent =
                    "Role defaults";

                elements.permissions.appendChild(
                    empty
                );

                return;
            }

            for (
                const permission of
                values
            ) {
                const tag =
                    global.document.createElement(
                        "span"
                    );

                tag.className =
                    "admin-tag";

                tag.textContent =
                    permission ===
                    "*"
                        ? "Full access"
                        : permission;

                elements.permissions.appendChild(
                    tag
                );
            }
        }

        function showDrawer() {
            if (
                !elements.drawer
            ) {
                return;
            }

            elements.drawer.classList.add(
                "is-open"
            );

            elements.drawer.setAttribute(
                "aria-hidden",
                "false"
            );
        }

        function closeDrawer() {
            state.selectedUid =
                null;

            state.selectedAdministrator =
                null;

            if (
                elements.drawer
            ) {
                elements.drawer.classList.remove(
                    "is-open"
                );

                elements.drawer.setAttribute(
                    "aria-hidden",
                    "true"
                );
            }
        }

        /* ==================================================
           ROLE MUTATION
        ================================================== */

        async function saveRole() {
            const uid =
                getSelectedUid();

            const role =
                normalizeRequiredString(
                    getValue(
                        elements.role
                    ),
                    "Administrator role"
                );

            if (
                !ADMIN_ROLES.includes(
                    role
                )
            ) {
                throw new AdministratorsControllerError(
                    "administrators-controller/invalid-role",
                    "Selected administrator role is invalid."
                );
            }

            return confirm(
                {
                    title:
                        "Change Administrator Role",

                    message:
                        "Change this administrator's role to " +
                        formatRole(
                            role
                        ) +
                        "?",

                    action:
                        async function () {
                            return performMutation(
                                "Saving administrator role…",
                                async function () {
                                    const result =
                                        await service
                                            .setAdministratorRole({
                                                uid,

                                                role,

                                                replacePermissions:
                                                    getChecked(
                                                        elements.replacePermissions
                                                    ),

                                                reason:
                                                    normalizeOptionalString(
                                                        getValue(
                                                            elements.roleReason
                                                        )
                                                    )
                                            });

                                    await handleMutationResult(
                                        result,
                                        uid
                                    );

                                    setStatus(
                                        "Administrator role updated.",
                                        "success"
                                    );

                                    return result;
                                }
                            );
                        }
                }
            );
        }

        /* ==================================================
           PERMISSION MUTATIONS
        ================================================== */

        async function grantPermissions() {
            const uid =
                getSelectedUid();

            const permissions =
                normalizeStringList(
                    getValue(
                        elements.grantPermissions
                    )
                );

            if (
                !permissions.length
            ) {
                throw new AdministratorsControllerError(
                    "administrators-controller/permissions-required",
                    "Enter at least one permission to grant."
                );
            }

            return confirm(
                {
                    title:
                        "Grant Permissions",

                    message:
                        "Grant " +
                        permissions.length +
                        " permission" +
                        (
                            permissions.length ===
                            1
                                ? ""
                                : "s"
                        ) +
                        " to this administrator?",

                    action:
                        async function () {
                            return performMutation(
                                "Granting permissions…",
                                async function () {
                                    const result =
                                        await service
                                            .grantAdministratorPermissions({
                                                uid,

                                                permissions,

                                                reason:
                                                    normalizeOptionalString(
                                                        getValue(
                                                            elements.grantReason
                                                        )
                                                    )
                                            });

                                    await handleMutationResult(
                                        result,
                                        uid
                                    );

                                    setValue(
                                        elements.grantPermissions,
                                        ""
                                    );

                                    setValue(
                                        elements.grantReason,
                                        ""
                                    );

                                    setStatus(
                                        "Permissions granted.",
                                        "success"
                                    );

                                    return result;
                                }
                            );
                        }
                }
            );
        }

        async function revokePermissions() {
            const uid =
                getSelectedUid();

            const permissions =
                normalizeStringList(
                    getValue(
                        elements.revokePermissions
                    )
                );

            if (
                !permissions.length
            ) {
                throw new AdministratorsControllerError(
                    "administrators-controller/permissions-required",
                    "Enter at least one permission to revoke."
                );
            }

            return confirm(
                {
                    title:
                        "Revoke Permissions",

                    message:
                        "Revoke " +
                        permissions.length +
                        " permission" +
                        (
                            permissions.length ===
                            1
                                ? ""
                                : "s"
                        ) +
                        " from this administrator?",

                    action:
                        async function () {
                            return performMutation(
                                "Revoking permissions…",
                                async function () {
                                    const result =
                                        await service
                                            .revokeAdministratorPermissions({
                                                uid,

                                                permissions,

                                                reason:
                                                    normalizeOptionalString(
                                                        getValue(
                                                            elements.revokeReason
                                                        )
                                                    )
                                            });

                                    await handleMutationResult(
                                        result,
                                        uid
                                    );

                                    setValue(
                                        elements.revokePermissions,
                                        ""
                                    );

                                    setValue(
                                        elements.revokeReason,
                                        ""
                                    );

                                    setStatus(
                                        "Permissions revoked.",
                                        "success"
                                    );

                                    return result;
                                }
                            );
                        }
                }
            );
        }

        /* ==================================================
           REMOVE ADMINISTRATOR
        ================================================== */

        async function removeAdministrator() {
            const uid =
                getSelectedUid();

            const administrator =
                state.selectedAdministrator;

            const label =
                administrator &&
                (
                    administrator.displayName ||
                    administrator.email
                )
                    ? administrator.displayName ||
                      administrator.email
                    : uid;

            return confirm(
                {
                    title:
                        "Remove Administrator Access",

                    message:
                        "Remove administrator access from " +
                        label +
                        "? This action changes the user's authorization claims.",

                    action:
                        async function () {
                            return performMutation(
                                "Removing administrator access…",
                                async function () {
                                    const result =
                                        await service
                                            .removeAdministratorRole({
                                                uid,

                                                preservePermissions:
                                                    getChecked(
                                                        elements.preservePermissions
                                                    ),

                                                reason:
                                                    normalizeOptionalString(
                                                        getValue(
                                                            elements.removeReason
                                                        )
                                                    )
                                            });

                                    state.administrators =
                                        state.administrators.filter(
                                            function (
                                                item
                                            ) {
                                                return item.uid !==
                                                    uid;
                                            }
                                        );

                                    closeDrawer();

                                    applyFilters();

                                    setStatus(
                                        "Administrator access removed.",
                                        "success"
                                    );

                                    return result;
                                }
                            );
                        }
                }
            );
        }

        /* ==================================================
           ADD ADMINISTRATOR
        ================================================== */

        function openAddModal() {
            if (
                !elements.addModal
            ) {
                return;
            }

            setValue(
                elements.addUid,
                ""
            );

            setValue(
                elements.addRole,
                "admin"
            );

            setValue(
                elements.addPermissions,
                ""
            );

            setValue(
                elements.addReason,
                ""
            );

            setChecked(
                elements.addReplacePermissions,
                false
            );

            elements.addModal.hidden =
                false;

            elements.addModal.setAttribute(
                "aria-hidden",
                "false"
            );

            if (
                elements.addUid &&
                typeof elements.addUid.focus ===
                    "function"
            ) {
                elements.addUid.focus();
            }
        }

        function closeAddModal() {
            if (
                !elements.addModal
            ) {
                return;
            }

            elements.addModal.hidden =
                true;

            elements.addModal.setAttribute(
                "aria-hidden",
                "true"
            );
        }

        async function addAdministrator() {
            const uid =
                normalizeRequiredString(
                    getValue(
                        elements.addUid
                    ),
                    "User UID"
                );

            const role =
                normalizeRequiredString(
                    getValue(
                        elements.addRole
                    ),
                    "Administrator role"
                );

            const permissions =
                normalizeStringList(
                    getValue(
                        elements.addPermissions
                    )
                );

            if (
                !ADMIN_ROLES.includes(
                    role
                )
            ) {
                throw new AdministratorsControllerError(
                    "administrators-controller/invalid-role",
                    "Selected administrator role is invalid."
                );
            }

            closeAddModal();

            return confirm(
                {
                    title:
                        "Add Administrator",

                    message:
                        "Grant " +
                        formatRole(
                            role
                        ) +
                        " access to user " +
                        uid +
                        "?",

                    action:
                        async function () {
                            return performMutation(
                                "Adding administrator…",
                                async function () {
                                    const result =
                                        await service
                                            .setAdministratorRole({
                                                uid,

                                                role,

                                                permissions,

                                                replacePermissions:
                                                    getChecked(
                                                        elements.addReplacePermissions
                                                    ),

                                                reason:
                                                    normalizeOptionalString(
                                                        getValue(
                                                            elements.addReason
                                                        )
                                                    )
                                            });

                                    await refresh();

                                    setStatus(
                                        "Administrator access granted.",
                                        "success"
                                    );

                                    return result;
                                }
                            );
                        }
                }
            );
        }

        /* ==================================================
           MUTATION RESULT
        ================================================== */

        async function handleMutationResult(
            result,
            uid
        ) {
            if (
                result &&
                result.administrator
            ) {
                const administrator =
                    normalizeAdministrator(
                        result.administrator
                    );

                upsertAdministrator(
                    administrator
                );

                state.selectedAdministrator =
                    administrator;

                state.selectedUid =
                    administrator.uid;

                applyFilters();

                renderDrawer(
                    administrator
                );

                return administrator;
            }

            const refreshed =
                await service
                    .getAdministrator(
                        uid
                    );

            if (
                refreshed &&
                refreshed.administrator
            ) {
                const administrator =
                    normalizeAdministrator(
                        refreshed.administrator
                    );

                upsertAdministrator(
                    administrator
                );

                state.selectedAdministrator =
                    administrator;

                state.selectedUid =
                    administrator.uid;

                applyFilters();

                renderDrawer(
                    administrator
                );

                return administrator;
            }

            await refresh();

            return findAdministrator(
                uid
            );
        }

        async function performMutation(
            message,
            operation
        ) {
            setLoading(
                true,
                message
            );

            clearStatus();

            try {
                return await operation();
            } catch (
                error
            ) {
                const normalized =
                    normalizeControllerError(
                        error
                    );

                setStatus(
                    normalized.message,
                    "error"
                );

                throw normalized;
            } finally {
                setLoading(
                    false
                );
            }
        }

        /* ==================================================
           CONFIRMATION
        ================================================== */

        function confirm(
            input
        ) {
            const source =
                input ||
                {};

            if (
                !elements.confirmModal ||
                !elements.confirmSubmit
            ) {
                return Promise.resolve()
                    .then(
                        source.action
                    );
            }

            return new Promise(
                function (
                    resolve,
                    reject
                ) {
                    state.confirmAction =
                        {
                            action:
                                source.action,

                            resolve,

                            reject
                        };

                    setText(
                        elements.confirmTitle,
                        source.title ||
                        "Confirm Action"
                    );

                    setText(
                        elements.confirmMessage,
                        source.message ||
                        "Are you sure?"
                    );

                    elements.confirmModal.hidden =
                        false;

                    elements.confirmModal.setAttribute(
                        "aria-hidden",
                        "false"
                    );
                }
            );
        }

        async function submitConfirmation() {
            const pending =
                state.confirmAction;

            if (
                !pending
            ) {
                closeConfirmModal();

                return;
            }

            state.confirmAction =
                null;

            closeConfirmModal();

            try {
                const result =
                    await pending.action();

                pending.resolve(
                    result
                );
            } catch (
                error
            ) {
                pending.reject(
                    error
                );
            }
        }

        function cancelConfirmation() {
            const pending =
                state.confirmAction;

            state.confirmAction =
                null;

            closeConfirmModal();

            if (
                pending
            ) {
                pending.resolve(
                    null
                );
            }
        }

        function closeConfirmModal() {
            if (
                !elements.confirmModal
            ) {
                return;
            }

            elements.confirmModal.hidden =
                true;

            elements.confirmModal.setAttribute(
                "aria-hidden",
                "true"
            );
        }

        /* ==================================================
           EVENTS
        ================================================== */

        function bindEvents() {
            bind(
                elements.refresh,
                "click",
                function () {
                    refresh()
                        .catch(
                            reportError
                        );
                }
            );

            bind(
                elements.add,
                "click",
                openAddModal
            );

            bind(
                elements.clearFilters,
                "click",
                clearFilters
            );

            bind(
                elements.search,
                "input",
                function (
                    event
                ) {
                    state.search =
                        event.target.value ||
                        "";

                    state.page =
                        1;

                    applyFilters();
                }
            );

            bind(
                elements.roleFilter,
                "change",
                function (
                    event
                ) {
                    state.role =
                        event.target.value ||
                        "";

                    state.page =
                        1;

                    applyFilters();
                }
            );

            bind(
                elements.statusFilter,
                "change",
                function (
                    event
                ) {
                    state.status =
                        event.target.value ||
                        "";

                    state.page =
                        1;

                    applyFilters();
                }
            );

            bind(
                elements.sort,
                "change",
                function (
                    event
                ) {
                    state.sort =
                        event.target.value ||
                        "email-asc";

                    state.page =
                        1;

                    applyFilters();
                }
            );

            bind(
                elements.previous,
                "click",
                function () {
                    if (
                        state.page >
                        1
                    ) {
                        state.page -=
                            1;

                        renderTable();
                        renderPagination();
                    }
                }
            );

            bind(
                elements.next,
                "click",
                function () {
                    if (
                        state.page <
                        getPageCount()
                    ) {
                        state.page +=
                            1;

                        renderTable();
                        renderPagination();
                    }
                }
            );

            bind(
                elements.table,
                "click",
                function (
                    event
                ) {
                    const button =
                        event.target.closest(
                            "[data-administrator-manage]"
                        );

                    if (
                        !button
                    ) {
                        return;
                    }

                    openAdministrator(
                        button.dataset
                            .administratorManage
                    ).catch(
                        reportError
                    );
                }
            );

            bind(
                elements.drawerClose,
                "click",
                closeDrawer
            );

            bind(
                elements.saveRole,
                "click",
                function () {
                    saveRole()
                        .catch(
                            reportError
                        );
                }
            );

            bind(
                elements.grant,
                "click",
                function () {
                    grantPermissions()
                        .catch(
                            reportError
                        );
                }
            );

            bind(
                elements.revoke,
                "click",
                function () {
                    revokePermissions()
                        .catch(
                            reportError
                        );
                }
            );

            bind(
                elements.remove,
                "click",
                function () {
                    removeAdministrator()
                        .catch(
                            reportError
                        );
                }
            );

            bindAll(
                root,
                settings.selectors.addCancel,
                "click",
                closeAddModal
            );

            bind(
                elements.addConfirm,
                "click",
                function () {
                    addAdministrator()
                        .catch(
                            function (
                                error
                            ) {
                                setStatus(
                                    normalizeControllerError(
                                        error
                                    ).message,
                                    "error"
                                );

                                reportError(
                                    error
                                );
                            }
                        );
                }
            );

            bindAll(
                root,
                settings.selectors.confirmCancel,
                "click",
                cancelConfirmation
            );

            bind(
                elements.confirmSubmit,
                "click",
                function () {
                    submitConfirmation()
                        .catch(
                            reportError
                        );
                }
            );

            if (
                global.document
            ) {
                bind(
                    global.document,
                    "keydown",
                    function (
                        event
                    ) {
                        if (
                            event.key !==
                            "Escape"
                        ) {
                            return;
                        }

                        if (
                            elements.confirmModal &&
                            !elements.confirmModal.hidden
                        ) {
                            cancelConfirmation();

                            return;
                        }

                        if (
                            elements.addModal &&
                            !elements.addModal.hidden
                        ) {
                            closeAddModal();

                            return;
                        }

                        closeDrawer();
                    }
                );
            }
        }

        function bind(
            element,
            event,
            handler
        ) {
            if (
                !element ||
                typeof element.addEventListener !==
                    "function"
            ) {
                return;
            }

            element.addEventListener(
                event,
                handler
            );

            state.listeners.push({
                element,
                event,
                handler
            });
        }

        function bindAll(
            context,
            selector,
            event,
            handler
        ) {
            if (
                !context ||
                typeof context.querySelectorAll !==
                    "function"
            ) {
                return;
            }

            const nodes =
                context.querySelectorAll(
                    selector
                );

            for (
                const node of
                nodes
            ) {
                bind(
                    node,
                    event,
                    handler
                );
            }
        }

        /* ==================================================
           STATE HELPERS
        ================================================== */

        function getSelectedUid() {
            return normalizeRequiredString(
                state.selectedUid ||
                getValue(
                    elements.administratorId
                ),
                "Administrator UID"
            );
        }

        function findAdministrator(
            uid
        ) {
            return state.administrators.find(
                function (
                    administrator
                ) {
                    return administrator.uid ===
                        uid;
                }
            ) || null;
        }

        function upsertAdministrator(
            administrator
        ) {
            const index =
                state.administrators.findIndex(
                    function (
                        item
                    ) {
                        return item.uid ===
                            administrator.uid;
                    }
                );

            if (
                index >=
                0
            ) {
                state.administrators[
                    index
                ] =
                    administrator;
            } else {
                state.administrators.push(
                    administrator
                );
            }
        }

        function getCurrentPageRows() {
            const start =
                (
                    state.page -
                    1
                ) *
                state.pageSize;

            return state.filtered.slice(
                start,
                start +
                state.pageSize
            );
        }

        function getPageCount() {
            return Math.max(
                1,
                Math.ceil(
                    state.filtered.length /
                    state.pageSize
                )
            );
        }

        /* ==================================================
           STATUS / LOADING
        ================================================== */

        function setStatus(
            message,
            type
        ) {
            if (
                !elements.status
            ) {
                return;
            }

            elements.status.textContent =
                message ||
                "";

            elements.status.dataset.status =
                type ||
                "info";

            elements.status.hidden =
                !message;
        }

        function clearStatus() {
            setStatus(
                "",
                "info"
            );
        }

        function setLoading(
            active,
            message
        ) {
            state.loading =
                Boolean(
                    active
                );

            if (
                elements.loading
            ) {
                elements.loading.hidden =
                    !state.loading;

                elements.loading.setAttribute(
                    "aria-hidden",
                    state.loading
                        ? "false"
                        : "true"
                );
            }

            if (
                elements.loadingMessage &&
                message
            ) {
                elements.loadingMessage.textContent =
                    message;
            }
        }

        /* ==================================================
           API
        ================================================== */

        const api =
            Object.freeze({
                initialize,
                destroy,
                refresh,

                applyFilters,
                clearFilters,

                render,
                renderMetrics,
                renderTable,
                renderPagination,

                openAdministrator,
                closeDrawer,

                saveRole,
                grantPermissions,
                revokePermissions,
                removeAdministrator,

                openAddModal,
                closeAddModal,
                addAdministrator,

                confirm,
                submitConfirmation,
                cancelConfirmation,

                getState() {
                    return cloneValue(
                        state
                    );
                },

                state,
                elements,
                service,
                options:
                    settings
            });

        return api;
    }

    /* ======================================================
       NORMALIZE ADMINISTRATORS
    ====================================================== */

    function normalizeAdministrators(
        input
    ) {
        if (
            !Array.isArray(
                input
            )
        ) {
            return [];
        }

        return input
            .map(
                normalizeAdministrator
            )
            .filter(
                function (
                    administrator
                ) {
                    return Boolean(
                        administrator.uid
                    );
                }
            );
    }

    function normalizeAdministrator(
        input
    ) {
        const source =
            input &&
            typeof input ===
                "object"
                ? input
                : {};

        const metadata =
            source.metadata &&
            typeof source.metadata ===
                "object"
                ? cloneValue(
                      source.metadata
                  )
                : {};

        return {
            uid:
                normalizeOptionalString(
                    source.uid
                ),

            email:
                normalizeOptionalString(
                    source.email
                ),

            displayName:
                normalizeOptionalString(
                    source.displayName
                ),

            disabled:
                source.disabled ===
                true,

            emailVerified:
                source.emailVerified ===
                true,

            isAdministrator:
                source.isAdministrator !==
                false,

            primaryRole:
                normalizeOptionalString(
                    source.primaryRole ||
                    source.role
                ) ||
                "admin",

            roles:
                normalizeStringList(
                    source.roles ||
                    source.role ||
                    source.primaryRole
                ),

            permissions:
                normalizeStringList(
                    source.permissions
                ),

            creationTime:
                normalizeOptionalString(
                    source.creationTime ||
                    metadata.creationTime
                ),

            lastSignInTime:
                normalizeOptionalString(
                    source.lastSignInTime ||
                    metadata.lastSignInTime
                ),

            metadata
        };
    }

    /* ======================================================
       SEARCH / SORT HELPERS
    ====================================================== */

    function matchesSearch(
        administrator,
        search
    ) {
        const haystack =
            [
                administrator.uid,
                administrator.email,
                administrator.displayName,
                getPrimaryRole(
                    administrator
                ),
                getAdministratorRoles(
                    administrator
                ).join(
                    " "
                ),
                normalizeStringList(
                    administrator.permissions
                ).join(
                    " "
                )
            ]
                .filter(
                    Boolean
                )
                .join(
                    " "
                )
                .toLowerCase();

        return haystack.includes(
            search
        );
    }

    function sortAdministrators(
        administrators,
        sort
    ) {
        const rows =
            administrators.slice();

        const [
            key,
            direction
        ] =
            String(
                sort ||
                "email-asc"
            ).split(
                "-"
            );

        const multiplier =
            direction ===
            "desc"
                ? -1
                : 1;

        rows.sort(
            function (
                first,
                second
            ) {
                let a;
                let b;

                switch (
                    key
                ) {
                    case "displayName":
                        a =
                            first.displayName ||
                            first.email ||
                            "";

                        b =
                            second.displayName ||
                            second.email ||
                            "";

                        break;

                    case "role":
                        a =
                            getPrimaryRole(
                                first
                            );

                        b =
                            getPrimaryRole(
                                second
                            );

                        break;

                    case "lastSignInTime":
                        return (
                            compareDates(
                                first.lastSignInTime,
                                second.lastSignInTime
                            ) *
                            multiplier
                        );

                    case "creationTime":
                        return (
                            compareDates(
                                first.creationTime,
                                second.creationTime
                            ) *
                            multiplier
                        );

                    case "email":
                    default:
                        a =
                            first.email ||
                            first.displayName ||
                            first.uid ||
                            "";

                        b =
                            second.email ||
                            second.displayName ||
                            second.uid ||
                            "";

                        break;
                }

                return (
                    String(
                        a
                    ).localeCompare(
                        String(
                            b
                        ),
                        undefined,
                        {
                            sensitivity:
                                "base"
                        }
                    ) *
                    multiplier
                );
            }
        );

        return rows;
    }

    function compareDates(
        first,
        second
    ) {
        const a =
            toTimestamp(
                first
            );

        const b =
            toTimestamp(
                second
            );

        if (
            a ===
            b
        ) {
            return 0;
        }

        return a <
            b
            ? -1
            : 1;
    }

    function toTimestamp(
        value
    ) {
        if (
            !value
        ) {
            return 0;
        }

        const timestamp =
            new Date(
                value
            ).getTime();

        return Number.isFinite(
            timestamp
        )
            ? timestamp
            : 0;
    }

    /* ======================================================
       ROLE HELPERS
    ====================================================== */

    function getAdministratorRoles(
        administrator
    ) {
        return normalizeStringList(
            administrator.roles ||
            administrator.primaryRole ||
            administrator.role
        );
    }

    function getPrimaryRole(
        administrator
    ) {
        return (
            normalizeOptionalString(
                administrator.primaryRole ||
                administrator.role
            ) ||
            getAdministratorRoles(
                administrator
            )[0] ||
            "admin"
        );
    }

    function formatRole(
        role
    ) {
        return String(
            role ||
            "admin"
        )
            .split(
                "-"
            )
            .map(
                function (
                    part
                ) {
                    return part.charAt(
                        0
                    ).toUpperCase() +
                    part.slice(
                        1
                    );
                }
            )
            .join(
                " "
            );
    }

    /* ======================================================
       ELEMENTS
    ====================================================== */

    function collectElements(
        root,
        selectors
    ) {
        const find =
            function (
                key
            ) {
                return root.querySelector(
                    selectors[
                        key
                    ]
                );
            };

        return {
            status:
                find(
                    "status"
                ),

            refresh:
                find(
                    "refresh"
                ),

            add:
                find(
                    "add"
                ),

            search:
                find(
                    "search"
                ),

            roleFilter:
                find(
                    "roleFilter"
                ),

            statusFilter:
                find(
                    "statusFilter"
                ),

            sort:
                find(
                    "sort"
                ),

            clearFilters:
                find(
                    "clearFilters"
                ),

            table:
                find(
                    "table"
                ),

            total:
                find(
                    "total"
                ),

            owners:
                find(
                    "owners"
                ),

            active:
                find(
                    "active"
                ),

            disabled:
                find(
                    "disabled"
                ),

            visibleCount:
                find(
                    "visibleCount"
                ),

            previous:
                find(
                    "previous"
                ),

            next:
                find(
                    "next"
                ),

            pageLabel:
                find(
                    "pageLabel"
                ),

            drawer:
                find(
                    "drawer"
                ),

            drawerClose:
                find(
                    "drawerClose"
                ),

            drawerName:
                find(
                    "drawerName"
                ),

            administratorId:
                find(
                    "administratorId"
                ),

            administratorAvatar:
                find(
                    "administratorAvatar"
                ),

            administratorName:
                find(
                    "administratorName"
                ),

            administratorEmail:
                find(
                    "administratorEmail"
                ),

            administratorUid:
                find(
                    "administratorUid"
                ),

            administratorStatus:
                find(
                    "administratorStatus"
                ),

            administratorEmailVerified:
                find(
                    "administratorEmailVerified"
                ),

            administratorCreated:
                find(
                    "administratorCreated"
                ),

            administratorLastSignin:
                find(
                    "administratorLastSignin"
                ),

            role:
                find(
                    "role"
                ),

            roleReason:
                find(
                    "roleReason"
                ),

            replacePermissions:
                find(
                    "replacePermissions"
                ),

            saveRole:
                find(
                    "saveRole"
                ),

            permissions:
                find(
                    "permissions"
                ),

            grantPermissions:
                find(
                    "grantPermissions"
                ),

            grantReason:
                find(
                    "grantReason"
                ),

            grant:
                find(
                    "grant"
                ),

            revokePermissions:
                find(
                    "revokePermissions"
                ),

            revokeReason:
                find(
                    "revokeReason"
                ),

            revoke:
                find(
                    "revoke"
                ),

            removeReason:
                find(
                    "removeReason"
                ),

            preservePermissions:
                find(
                    "preservePermissions"
                ),

            remove:
                find(
                    "remove"
                ),

            addModal:
                find(
                    "addModal"
                ),

            addUid:
                find(
                    "addUid"
                ),

            addRole:
                find(
                    "addRole"
                ),

            addPermissions:
                find(
                    "addPermissions"
                ),

            addReason:
                find(
                    "addReason"
                ),

            addReplacePermissions:
                find(
                    "addReplacePermissions"
                ),

            addConfirm:
                find(
                    "addConfirm"
                ),

            confirmModal:
                find(
                    "confirmModal"
                ),

            confirmTitle:
                find(
                    "confirmTitle"
                ),

            confirmMessage:
                find(
                    "confirmMessage"
                ),

            confirmSubmit:
                find(
                    "confirmSubmit"
                ),

            loading:
                find(
                    "loading"
                ),

            loadingMessage:
                find(
                    "loadingMessage"
                )
        };
    }

    /* ======================================================
       DOM HELPERS
    ====================================================== */

    function setText(
        element,
        value
    ) {
        if (
            element
        ) {
            element.textContent =
                value ===
                    undefined ||
                value ===
                    null
                    ? ""
                    : String(
                          value
                      );
        }
    }

    function setValue(
        element,
        value
    ) {
        if (
            element
        ) {
            element.value =
                value ===
                    undefined ||
                value ===
                    null
                    ? ""
                    : String(
                          value
                      );
        }
    }

    function getValue(
        element
    ) {
        return element
            ? element.value
            : "";
    }

    function setChecked(
        element,
        value
    ) {
        if (
            element
        ) {
            element.checked =
                Boolean(
                    value
                );
        }
    }

    function getChecked(
        element
    ) {
        return Boolean(
            element &&
            element.checked
        );
    }

    /* ======================================================
       NORMALIZERS
    ====================================================== */

    function normalizeOptions(
        options
    ) {
        const source =
            options ||
            {};

        return Object.freeze({
            root:
                source.root ||
                null,

            service:
                source.service ||
                null,

            pageSize:
                normalizePositiveInteger(
                    source.pageSize,
                    DEFAULT_PAGE_SIZE
                ),

            selectors:
                Object.freeze(
                    Object.assign(
                        {},
                        SELECTORS,
                        source.selectors ||
                        {}
                    )
                )
        });
    }

    function normalizePositiveInteger(
        value,
        fallback
    ) {
        const normalized =
            Number(
                value
            );

        return Number.isInteger(
            normalized
        ) &&
        normalized >
            0
            ? normalized
            : fallback;
    }

    function normalizeRequiredString(
        value,
        label
    ) {
        const normalized =
            String(
                value ||
                ""
            ).trim();

        if (
            !normalized
        ) {
            throw new AdministratorsControllerError(
                "administrators-controller/invalid-argument",
                (
                    label ||
                    "Value"
                ) +
                " is required."
            );
        }

        return normalized;
    }

    function normalizeOptionalString(
        value
    ) {
        if (
            value ===
                undefined ||
            value ===
                null
        ) {
            return null;
        }

        const normalized =
            String(
                value
            ).trim();

        return normalized ||
            null;
    }

    function normalizeStringList(
        value
    ) {
        if (
            value ===
                undefined ||
            value ===
                null ||
            value ===
                ""
        ) {
            return [];
        }

        const values =
            Array.isArray(
                value
            )
                ? value
                : typeof value ===
                  "string"
                    ? value.split(
                          /[\s,]+/
                      )
                    : [
                          value
                      ];

        return Array.from(
            new Set(
                values
                    .map(
                        function (
                            item
                        ) {
                            return String(
                                item ||
                                ""
                            ).trim();
                        }
                    )
                    .filter(
                        Boolean
                    )
            )
        );
    }

    function normalizeSearch(
        value
    ) {
        return String(
            value ||
            ""
        )
            .trim()
            .toLowerCase();
    }

    /* ======================================================
       FORMATTERS
    ====================================================== */

    function formatDate(
        value
    ) {
        if (
            !value
        ) {
            return "Never";
        }

        const date =
            new Date(
                value
            );

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {
            return "—";
        }

        try {
            return new Intl.DateTimeFormat(
                undefined,
                {
                    year:
                        "numeric",

                    month:
                        "short",

                    day:
                        "numeric",

                    hour:
                        "2-digit",

                    minute:
                        "2-digit"
                }
            ).format(
                date
            );
        } catch (
            error
        ) {
            return date.toLocaleString();
        }
    }

    function getInitials(
        value
    ) {
        const parts =
            String(
                value ||
                "A"
            )
                .trim()
                .split(
                    /\s+/
                )
                .filter(
                    Boolean
                );

        if (
            !parts.length
        ) {
            return "A";
        }

        if (
            parts.length ===
            1
        ) {
            return parts[0]
                .slice(
                    0,
                    2
                )
                .toUpperCase();
        }

        return (
            parts[0].charAt(
                0
            ) +
            parts[
                parts.length -
                1
            ].charAt(
                0
            )
        ).toUpperCase();
    }

    /* ======================================================
       SERVICE
    ====================================================== */

    function resolveAdminAuthService() {
        if (
            !global.LEternelAdminAuthService ||
            typeof global
                .LEternelAdminAuthService
                .getAdminAuthService !==
                "function"
        ) {
            return null;
        }

        return global
            .LEternelAdminAuthService
            .getAdminAuthService();
    }

    /* ======================================================
       ERRORS
    ====================================================== */

    function normalizeControllerError(
        error
    ) {
        if (
            error instanceof
            AdministratorsControllerError
        ) {
            return error;
        }

        const code =
            error &&
            error.code
                ? String(
                      error.code
                  )
                : "administrators-controller/request-failed";

        let message =
            error &&
            error.message
                ? String(
                      error.message
                  )
                : "Administrator request failed.";

        if (
            code.includes(
                "unauthenticated"
            )
        ) {
            message =
                "Your administrator session has expired. Sign in again.";
        } else if (
            code.includes(
                "permission-denied"
            ) ||
            code.includes(
                "admin-required"
            )
        ) {
            message =
                "You do not have permission to perform this administrator action.";
        } else if (
            code.includes(
                "privileged-role-required"
            )
        ) {
            message =
                "Only an owner or super-admin can assign this privileged role.";
        } else if (
            code.includes(
                "final-owner"
            )
        ) {
            message =
                "The final owner or super-admin cannot be removed.";
        } else if (
            code.includes(
                "user-not-found"
            ) ||
            code.includes(
                "not-found"
            )
        ) {
            message =
                "The requested user account could not be found.";
        }

        return new AdministratorsControllerError(
            code,
            message,
            {
                details:
                    error &&
                    error.details
                        ? cloneValue(
                              error.details
                          )
                        : null,

                originalError:
                    error
            }
        );
    }

    function reportError(
        error
    ) {
        if (
            global.console &&
            typeof global.console.error ===
                "function"
        ) {
            global.console.error(
                "Administrators controller error.",
                error
            );
        }
    }

    /* ======================================================
       CLONE
    ====================================================== */

    function cloneValue(
        value,
        seen
    ) {
        if (
            value ===
                undefined ||
            value ===
                null
        ) {
            return value;
        }

        if (
            typeof value ===
            "function"
        ) {
            return value;
        }

        if (
            value instanceof Date
        ) {
            return value.toISOString();
        }

        if (
            typeof value !==
            "object"
        ) {
            return value;
        }

        const references =
            seen ||
            new WeakMap();

        if (
            references.has(
                value
            )
        ) {
            return references.get(
                value
            );
        }

        if (
            Array.isArray(
                value
            )
        ) {
            const output =
                [];

            references.set(
                value,
                output
            );

            for (
                const item of
                value
            ) {
                output.push(
                    cloneValue(
                        item,
                        references
                    )
                );
            }

            return output;
        }

        const output =
            {};

        references.set(
            value,
            output
        );

        for (
            const key of
            Object.keys(
                value
            )
        ) {
            output[
                key
            ] =
                cloneValue(
                    value[
                        key
                    ],
                    references
                );
        }

        return output;
    }

    /* ======================================================
       DEFAULT INSTANCE
    ====================================================== */

    let defaultController =
        null;

    function getAdministratorsController(
        options
    ) {
        if (
            options
        ) {
            return createAdministratorsController(
                options
            );
        }

        if (
            !defaultController
        ) {
            defaultController =
                createAdministratorsController();
        }

        return defaultController;
    }

    function resetAdministratorsController() {
        if (
            defaultController &&
            typeof defaultController.destroy ===
                "function"
        ) {
            defaultController.destroy();
        }

        defaultController =
            null;
    }

    async function bootstrap(
        options
    ) {
        const controller =
            getAdministratorsController(
                options
            );

        await controller.initialize();

        return controller;
    }

    /* ======================================================
       EXPORT
    ====================================================== */

    const api =
        Object.freeze({
            createAdministratorsController,
            getAdministratorsController,
            resetAdministratorsController,
            bootstrap,

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

            constants:
                Object.freeze({
                    DEFAULT_PAGE_SIZE,
                    ADMIN_ROLES,
                    SELECTORS
                })
        });

    global.LEternelAdministratorsController =
        api;

    if (
        typeof module !==
            "undefined" &&
        module.exports
    ) {
        module.exports =
            api;
    }
})(
    typeof window !==
        "undefined"
        ? window
        : globalThis
);