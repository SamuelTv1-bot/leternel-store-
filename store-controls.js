"use strict";

/* ==========================================================
   L'ÉTERNEL STORE — HEADER / DRAWER / MODAL CONTROLS
   Connects the existing HTML IDs to the existing app modules.
   Firebase v8 compatible. Load this file after all app modules.
========================================================== */

(function initializeStoreControls(global) {
    var app = global.LEternelApp;

    if (!app) {
        console.error("[L'ÉTERNEL] store-controls.js requires app.js first.");
        return;
    }

    var documentRef = global.document;

    function byId(id) {
        return documentRef.getElementById(id);
    }

    function currentUser() {
        var services = global.FirebaseServices;

        return services && services.auth
            ? services.auth.currentUser || null
            : null;
    }

    function syncBodyScroll() {
        var anyOpen = documentRef.querySelector(
            ".modal.active, .modal.open, .drawer.active, .drawer.open"
        );

        documentRef.body.classList.toggle(
            "no-scroll",
            Boolean(anyOpen)
        );
    }

    /* ======================================================
       CLOSE ALL PANELS
    ====================================================== */

    function closeAllPanels() {
        if (typeof app.closeAllOverlays === "function") {
            app.closeAllOverlays();
        } else {
            documentRef.querySelectorAll(
                ".modal.active, .modal.open, .drawer.active, .drawer.open"
            ).forEach(function (element) {
                element.classList.remove("active", "open");
                element.setAttribute("aria-hidden", "true");
            });
        }

        var overlay = byId("drawerOverlay");

        if (overlay) {
            overlay.classList.remove("active", "open");
            overlay.setAttribute("aria-hidden", "true");
        }

        syncBodyScroll();
    }

    /* ======================================================
       DRAWER CONTROLS
    ====================================================== */

    function openDrawer(id) {
        var drawer = byId(id);

        if (!drawer) {
            console.error("[L'ÉTERNEL] Drawer not found:", id);
            return false;
        }

        closeAllPanels();

        drawer.classList.add("active", "open");

        drawer.setAttribute(
            "aria-hidden",
            "false"
        );

        var overlay = byId("drawerOverlay");

        if (overlay) {
            overlay.classList.add("active");

            overlay.setAttribute(
                "aria-hidden",
                "false"
            );
        }

        documentRef.body.classList.add("no-scroll");

        return true;
    }

    function closeDrawer(id) {
        var drawer = byId(id);

        if (drawer) {
            drawer.classList.remove("active", "open");

            drawer.setAttribute(
                "aria-hidden",
                "true"
            );
        }

        var overlay = byId("drawerOverlay");

        if (overlay) {
            overlay.classList.remove("active", "open");

            overlay.setAttribute(
                "aria-hidden",
                "true"
            );
        }

        syncBodyScroll();

        return Boolean(drawer);
    }

    /* ======================================================
       MODAL CONTROLS
    ====================================================== */

    function openModal(id) {
        var modal = byId(id);

        if (!modal) {
            console.error("[L'ÉTERNEL] Modal not found:", id);
            return false;
        }

        closeAllPanels();

        if (typeof app.openModal === "function") {
            app.openModal(modal);
        } else {
            modal.classList.add("active", "open");

            modal.setAttribute(
                "aria-hidden",
                "false"
            );
        }

        documentRef.body.classList.add("no-scroll");

        return true;
    }

    function closeModal(id) {
        var modal = byId(id);

        if (!modal) {
            return false;
        }

        if (typeof app.closeModal === "function") {
            app.closeModal(modal);
        } else {
            modal.classList.remove("active", "open");

            modal.setAttribute(
                "aria-hidden",
                "true"
            );
        }

        syncBodyScroll();

        return true;
    }

    /* ======================================================
       AUTHENTICATION MODE
    ====================================================== */

    function setAuthMode(mode) {
        var register =
            mode === "register" ||
            mode === "signup" ||
            mode === "create";

        var title = byId("auth-title");
        var submit = byId("auth-submit");
        var toggleText = byId("auth-toggle-text");
        var toggleLink = byId("toggle-auth-mode");
        var modal = byId("authModal");

        if (modal) {
            modal.setAttribute(
                "data-auth-mode",
                register ? "register" : "login"
            );
        }

        if (title) {
            title.textContent = register
                ? "Create Your Account"
                : "Welcome Back";
        }

        if (submit) {
            submit.textContent = register
                ? "Create Account"
                : "Sign In";
        }

        if (toggleText) {
            toggleText.textContent = register
                ? "Already have an account? "
                : "Don't have an account? ";
        }

        if (toggleLink) {
            toggleLink.textContent = register
                ? "Sign In"
                : "Create One";

            toggleLink.setAttribute(
                "data-auth-toggle",
                "true"
            );
        }
    }

    function openAuth(mode) {
        setAuthMode(mode || "login");

        return openModal("authModal");
    }

    /* ======================================================
       PROFILE
    ====================================================== */

    function fillProfile(user) {
        var nameInput = byId("profile-name");
        var emailInput = byId("profile-email");
        var avatar = byId("profileAvatar");
        var memberSince = byId("memberSince");

        if (nameInput) {
            nameInput.value =
                user.displayName || "";
        }

        if (emailInput) {
            emailInput.value =
                user.email || "";
        }

        if (avatar && user.photoURL) {
            avatar.src = user.photoURL;
        }

        if (memberSince) {
            var createdAt =
                user.metadata &&
                user.metadata.creationTime;

            if (createdAt) {
                var date = new Date(createdAt);

                memberSince.textContent =
                    Number.isNaN(date.getTime())
                        ? ""
                        : new Intl.DateTimeFormat(
                            "en-NG",
                            {
                                day: "2-digit",
                                month: "short",
                                year: "numeric"
                            }
                        ).format(date);
            } else {
                memberSince.textContent = "";
            }
        }
    }

    function openProfile() {
        var user = currentUser();

        if (!user) {
            return openAuth("login");
        }

        fillProfile(user);

        return openModal("profileModal");
    }

    /* ======================================================
       CART
    ====================================================== */

    function openCart() {
        var cart = global.LEternelCart;

        if (
            cart &&
            typeof cart.render === "function"
        ) {
            cart.render();
        }

        return openDrawer("cartDrawer");
    }

    /* ======================================================
       WISHLIST
    ====================================================== */

    function openWishlist() {
        var wishlist = global.LEternelWishlist;

        if (
            wishlist &&
            typeof wishlist.render === "function"
        ) {
            wishlist.render();
        }

        return openDrawer("wishlistDrawer");
    }

    /* ======================================================
       COUNTERS
    ====================================================== */

    function updateCounter(elementId, count, label) {
        var element = byId(elementId);

        var normalized = Math.max(
            0,
            Number(count) || 0
        );

        if (!element) {
            return normalized;
        }

        element.textContent =
            String(normalized);

        element.hidden =
            normalized <= 0;

        element.setAttribute(
            "aria-label",
            normalized + " " + label
        );

        return normalized;
    }

    /* ======================================================
       CONNECT TO MAIN APP API
    ====================================================== */

    app.openCart = openCart;
    app.openWishlist = openWishlist;
    app.openAuth = openAuth;
    app.openProfile = openProfile;

    var originalSetCartCount =
        app.setCartCount;

    app.setCartCount = function (count) {
        var normalized =
            typeof originalSetCartCount === "function"
                ? originalSetCartCount(count)
                : Math.max(
                    0,
                    Number(count) || 0
                );

        updateCounter(
            "cart-badge",
            normalized,
            normalized === 1
                ? "item in bag"
                : "items in bag"
        );

        return normalized;
    };

    var originalSetWishlistCount =
        app.setWishlistCount;

    app.setWishlistCount = function (count) {
        var normalized =
            typeof originalSetWishlistCount === "function"
                ? originalSetWishlistCount(count)
                : Math.max(
                    0,
                    Number(count) || 0
                );

        updateCounter(
            "wishlist-count",
            normalized,
            normalized === 1
                ? "item in wishlist"
                : "items in wishlist"
        );

        return normalized;
    };

    /* ======================================================
       MATCH CART ELEMENTS TO HTML
    ====================================================== */

    function patchCartElements() {
        var cart = global.LEternelCart;

        if (!cart || !cart.elements) {
            return;
        }

        cart.elements.drawer =
            byId("cartDrawer");

        cart.elements.drawerBody =
            byId("cart-items");

        cart.elements.emptyState =
            byId("empty-cart");

        cart.elements.totalElements =
            [byId("cart-total")].filter(Boolean);

        cart.elements.checkoutButtons =
            [byId("goToCheckout")].filter(Boolean);

        if (typeof cart.render === "function") {
            cart.render();
        }

        if (typeof cart.getItemCount === "function") {
            app.setCartCount(
                cart.getItemCount()
            );
        }
    }

    /* ======================================================
       MATCH WISHLIST ELEMENTS TO HTML
    ====================================================== */

    function patchWishlistElements() {
        var wishlist = global.LEternelWishlist;

        if (!wishlist || !wishlist.elements) {
            return;
        }

        wishlist.elements.drawer =
            byId("wishlistDrawer");

        wishlist.elements.drawerItems =
            byId("wishlist-items");

        wishlist.elements.drawerEmpty =
            byId("wishlist-empty");

        if (typeof wishlist.render === "function") {
            wishlist.render();
        }

        if (typeof wishlist.getItemCount === "function") {
            app.setWishlistCount(
                wishlist.getItemCount()
            );
        }
    }

    function patchModuleElements() {
        patchCartElements();
        patchWishlistElements();
    }

    /* ======================================================
       HEADER BUTTONS AND CLOSE CONTROLS
    ====================================================== */

    documentRef.addEventListener(
        "click",
        function (event) {
            var target =
                event.target &&
                event.target.closest
                    ? event.target.closest(
                        [
                            "#wishlistBtn",
                            "#openProfile",
                            "#openCart",
                            "#closeWishlist",
                            "#closeCart",
                            "#closeProfileBtn",
                            "#closeAuthBtn",
                            "#goToCheckout",
                            "#logoutBtn",
                            "#saveProfileBtn"
                        ].join(",")
                    )
                    : null;

            if (!target) {
                return;
            }

            /* WISHLIST BUTTON */

            if (target.id === "wishlistBtn") {
                event.preventDefault();
                openWishlist();
                return;
            }

            /* PROFILE BUTTON */

            if (target.id === "openProfile") {
                event.preventDefault();
                openProfile();
                return;
            }

            /* CART BUTTON */

            if (target.id === "openCart") {
                event.preventDefault();
                openCart();
                return;
            }

            /* CLOSE WISHLIST */

            if (target.id === "closeWishlist") {
                event.preventDefault();

                closeDrawer("wishlistDrawer");
                return;
            }

            /* CLOSE CART */

            if (target.id === "closeCart") {
                event.preventDefault();

                closeDrawer("cartDrawer");
                return;
            }

            /* CLOSE PROFILE */

            if (target.id === "closeProfileBtn") {
                event.preventDefault();

                closeModal("profileModal");
                return;
            }

            /* CLOSE AUTH */

            if (target.id === "closeAuthBtn") {
                event.preventDefault();

                closeModal("authModal");
                return;
            }

            /* CHECKOUT */

            if (target.id === "goToCheckout") {
                event.preventDefault();

                var cart = global.LEternelCart;

                if (
                    cart &&
                    typeof cart.proceedToCheckout === "function"
                ) {
                    cart.proceedToCheckout();
                } else {
                    app.navigate("checkout-page");
                }

                return;
            }

            /* LOGOUT */

            if (target.id === "logoutBtn") {
                event.preventDefault();

                var services = global.FirebaseServices;

                if (services && services.auth) {
                    services.auth.signOut()
                        .then(function () {
                            closeModal("profileModal");

                            app.showToast({
                                type: "success",
                                title: "Signed out",
                                message:
                                    "You have been signed out."
                            });
                        })
                        .catch(function (error) {
                            app.showToast({
                                type: "error",
                                title: "Unable to sign out",
                                message:
                                    error.message ||
                                    "Please try again."
                            });
                        });
                }

                return;
            }

            /* SAVE PROFILE */

            if (target.id === "saveProfileBtn") {
                event.preventDefault();

                var user = currentUser();
                var name = byId("profile-name");

                if (
                    !user ||
                    typeof user.updateProfile !== "function"
                ) {
                    app.showToast({
                        type: "warning",
                        title: "Profile unavailable",
                        message:
                            "Please sign in again before updating your profile."
                    });

                    return;
                }

                user.updateProfile({
                    displayName: name
                        ? name.value.trim()
                        : ""
                })
                    .then(function () {
                        fillProfile(user);

                        app.showToast({
                            type: "success",
                            title: "Profile updated",
                            message:
                                "Your display name has been saved."
                        });
                    })
                    .catch(function (error) {
                        app.showToast({
                            type: "error",
                            title: "Unable to save profile",
                            message:
                                error.message ||
                                "Please try again."
                        });
                    });
            }
        }
    );

    /* ======================================================
       DRAWER OVERLAY
    ====================================================== */

    var overlay = byId("drawerOverlay");

    if (overlay) {
        overlay.addEventListener(
            "click",
            function () {
                closeDrawer("wishlistDrawer");
                closeDrawer("cartDrawer");
            }
        );
    }

    /* ======================================================
       CLOSE MODALS WHEN CLICKING OUTSIDE
    ====================================================== */

    ["profileModal", "authModal"].forEach(
        function (id) {
            var modal = byId(id);

            if (modal) {
                modal.addEventListener(
                    "click",
                    function (event) {
                        if (event.target === modal) {
                            closeModal(id);
                        }
                    }
                );
            }
        }
    );

    /* ======================================================
       ESCAPE KEY
    ====================================================== */

    documentRef.addEventListener(
        "keydown",
        function (event) {
            if (event.key === "Escape") {
                closeAllPanels();
            }
        }
    );

    /* ======================================================
       COUNTER SYNCHRONIZATION
    ====================================================== */

    documentRef.addEventListener(
        "cart:change",
        function (event) {
            var detail = event.detail || {};

            app.setCartCount(
                detail.itemCount
            );
        }
    );

    documentRef.addEventListener(
        "wishlist:change",
        function (event) {
            var detail = event.detail || {};

            app.setWishlistCount(
                detail.itemCount
            );
        }
    );

    /* ======================================================
       WAIT FOR MODULES TO BE READY
    ====================================================== */

    documentRef.addEventListener(
        "cart:ready",
        patchCartElements
    );

    documentRef.addEventListener(
        "wishlist:ready",
        patchWishlistElements
    );

    if (documentRef.readyState === "loading") {
        documentRef.addEventListener(
            "DOMContentLoaded",
            patchModuleElements,
            {
                once: true
            }
        );
    } else {
        patchModuleElements();
    }

    console.info(
        "[L'ÉTERNEL] Header, cart, wishlist and modal controls connected."
    );

})(window);