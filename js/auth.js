"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   CUSTOMER AUTHENTICATION MODULE
   Firebase v8 Namespaced SDK
========================================================== */

(function initializeAuthModule() {
    const app = window.LEternelApp;
    const services = window.FirebaseServices;

    if (!app) {
        throw new Error(
            "LEternelApp was not found. Load app.js before auth.js."
        );
    }

    if (!services || !services.auth || !services.db) {
        throw new Error(
            "FirebaseServices was not found. Load firebase.js before auth.js."
        );
    }

    const auth = services.auth;
    const db = services.db;

    const Auth = {
        initialized: false,

        state: {
            user: null,
            userData: null,
            mode: "signin",
            loading: false,
            authReady: false
        },

        elements: {}
    };

    /* ======================================================
       DOM HELPERS
    ====================================================== */

    function getById(id) {
        return document.getElementById(id);
    }

    function cacheElements() {
        Auth.elements = {
            authModal:
                getById("authModal"),

            closeAuthButton:
                getById("closeAuthBtn"),

            authTitle:
                getById("auth-title"),

            authForm:
                getById("auth-form"),

            authEmail:
                getById("auth-email"),

            authPassword:
                getById("auth-password"),

            authSubmit:
                getById("auth-submit"),

            authToggleText:
                getById("auth-toggle-text"),

            authToggle:
                getById("toggle-auth-mode"),

            openProfile:
                getById("openProfile"),

            profileModal:
                getById("profileModal"),

            closeProfileButton:
                getById("closeProfileBtn"),

            logoutButton:
                getById("logoutBtn")
        };
    }

    /* ======================================================
       MODAL HELPERS
    ====================================================== */

    function openElement(element) {
        if (!element) {
            return;
        }

        element.classList.add(
            "active",
            "open"
        );

        element.setAttribute(
            "aria-hidden",
            "false"
        );

        document.body.classList.add(
            "no-scroll"
        );
    }

    function closeElement(element) {
        if (!element) {
            return;
        }

        element.classList.remove(
            "active",
            "open"
        );

        element.setAttribute(
            "aria-hidden",
            "true"
        );

        if (
            !document.querySelector(
                ".modal.active, .modal.open, .drawer.active, .drawer.open"
            )
        ) {
            document.body.classList.remove(
                "no-scroll"
            );
        }
    }

    function openAuth(mode) {
        setMode(mode || "signin");

        if (
            window.LEternelUI &&
            typeof window.LEternelUI.openModal ===
                "function"
        ) {
            window.LEternelUI.openModal(
                Auth.elements.authModal
            );
        } else {
            openElement(
                Auth.elements.authModal
            );
        }

        window.setTimeout(function () {
            if (Auth.elements.authEmail) {
                Auth.elements.authEmail.focus();
            }
        }, 80);
    }

    function closeAuth() {
        if (
            window.LEternelUI &&
            typeof window.LEternelUI.closeModal ===
                "function"
        ) {
            window.LEternelUI.closeModal(
                Auth.elements.authModal
            );
        } else {
            closeElement(
                Auth.elements.authModal
            );
        }

        clearForm();
    }

    function openProfile() {
        if (!Auth.state.user) {
            openAuth("signin");
            return;
        }

        if (
            window.LEternelUI &&
            typeof window.LEternelUI.openModal ===
                "function"
        ) {
            window.LEternelUI.openModal(
                Auth.elements.profileModal
            );
        } else {
            openElement(
                Auth.elements.profileModal
            );
        }
    }

    function closeProfile() {
        if (
            window.LEternelUI &&
            typeof window.LEternelUI.closeModal ===
                "function"
        ) {
            window.LEternelUI.closeModal(
                Auth.elements.profileModal
            );
        } else {
            closeElement(
                Auth.elements.profileModal
            );
        }
    }

    /* ======================================================
       AUTH MODE
    ====================================================== */

    function setMode(mode) {
        const normalizedMode =
            mode === "signup"
                ? "signup"
                : "signin";

        Auth.state.mode =
            normalizedMode;

        if (normalizedMode === "signup") {
            if (Auth.elements.authTitle) {
                Auth.elements.authTitle.textContent =
                    "Create Your Account";
            }

            if (Auth.elements.authSubmit) {
                Auth.elements.authSubmit.textContent =
                    "Create Account";
            }

            if (Auth.elements.authToggleText) {
                Auth.elements.authToggleText.textContent =
                    "Already have an account?";
            }

            if (Auth.elements.authToggle) {
                Auth.elements.authToggle.textContent =
                    "Sign In";
            }

            if (Auth.elements.authPassword) {
                Auth.elements.authPassword.setAttribute(
                    "autocomplete",
                    "new-password"
                );
            }
        } else {
            if (Auth.elements.authTitle) {
                Auth.elements.authTitle.textContent =
                    "Welcome Back";
            }

            if (Auth.elements.authSubmit) {
                Auth.elements.authSubmit.textContent =
                    "Sign In";
            }

            if (Auth.elements.authToggleText) {
                Auth.elements.authToggleText.textContent =
                    "Don't have an account?";
            }

            if (Auth.elements.authToggle) {
                Auth.elements.authToggle.textContent =
                    "Create One";
            }

            if (Auth.elements.authPassword) {
                Auth.elements.authPassword.setAttribute(
                    "autocomplete",
                    "current-password"
                );
            }
        }

        document.dispatchEvent(
            new CustomEvent(
                "auth:modechange",
                {
                    detail: {
                        mode:
                            normalizedMode
                    }
                }
            )
        );
    }

    function toggleMode() {
        setMode(
            Auth.state.mode === "signin"
                ? "signup"
                : "signin"
        );
    }

    /* ======================================================
       FORM STATE
    ====================================================== */

    function setLoading(loading) {
        Auth.state.loading =
            Boolean(loading);

        if (Auth.elements.authSubmit) {
            Auth.elements.authSubmit.disabled =
                Auth.state.loading;

            Auth.elements.authSubmit.classList.toggle(
                "loading",
                Auth.state.loading
            );

            if (Auth.state.loading) {
                Auth.elements.authSubmit.dataset
                    .previousText =
                    Auth.elements.authSubmit
                        .textContent;

                Auth.elements.authSubmit.textContent =
                    Auth.state.mode === "signup"
                        ? "Creating Account..."
                        : "Signing In...";
            } else {
                Auth.elements.authSubmit.textContent =
                    Auth.state.mode === "signup"
                        ? "Create Account"
                        : "Sign In";
            }
        }

        if (Auth.elements.authEmail) {
            Auth.elements.authEmail.disabled =
                Auth.state.loading;
        }

        if (Auth.elements.authPassword) {
            Auth.elements.authPassword.disabled =
                Auth.state.loading;
        }
    }

    function clearForm() {
        if (Auth.elements.authForm) {
            Auth.elements.authForm.reset();
        }

        clearFieldErrors();
        setLoading(false);
    }

    function clearFieldErrors() {
        [
            Auth.elements.authEmail,
            Auth.elements.authPassword
        ].forEach(function (element) {
            if (!element) {
                return;
            }

            element.classList.remove(
                "error",
                "invalid"
            );

            element.removeAttribute(
                "aria-invalid"
            );
        });
    }

    function markInvalid(element) {
        if (!element) {
            return;
        }

        element.classList.add(
            "error",
            "invalid"
        );

        element.setAttribute(
            "aria-invalid",
            "true"
        );

        element.focus();
    }

    /* ======================================================
       VALIDATION
    ====================================================== */

    function validateEmail(email) {
        if (
            app.utils &&
            typeof app.utils.isValidEmail ===
                "function"
        ) {
            return app.utils.isValidEmail(
                email
            );
        }

        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
            String(email || "").trim()
        );
    }

    function validateCredentials(
        email,
        password
    ) {
        clearFieldErrors();

        if (!email) {
            markInvalid(
                Auth.elements.authEmail
            );

            showToast(
                "error",
                "Email required",
                "Enter your email address."
            );

            return false;
        }

        if (!validateEmail(email)) {
            markInvalid(
                Auth.elements.authEmail
            );

            showToast(
                "error",
                "Invalid email",
                "Enter a valid email address."
            );

            return false;
        }

        if (!password) {
            markInvalid(
                Auth.elements.authPassword
            );

            showToast(
                "error",
                "Password required",
                "Enter your password."
            );

            return false;
        }

        if (
            Auth.state.mode === "signup" &&
            password.length < 8
        ) {
            markInvalid(
                Auth.elements.authPassword
            );

            showToast(
                "error",
                "Password too short",
                "Use at least 8 characters for your password."
            );

            return false;
        }

        return true;
    }

    /* ======================================================
       SIGN IN
    ====================================================== */

    async function signIn(
        email,
        password
    ) {
        const normalizedEmail =
            String(email || "")
                .trim()
                .toLowerCase();

        if (
            !validateCredentials(
                normalizedEmail,
                password
            )
        ) {
            return null;
        }

        setLoading(true);

        try {
            const credential =
                await auth.signInWithEmailAndPassword(
                    normalizedEmail,
                    password
                );

            showToast(
                "success",
                "Welcome back",
                "You have signed in successfully."
            );

            closeAuth();

            return credential.user;
        } catch (error) {
            handleAuthError(error);

            return null;
        } finally {
            setLoading(false);
        }
    }

    /* ======================================================
       SIGN UP
    ====================================================== */

    async function signUp(
        email,
        password
    ) {
        const normalizedEmail =
            String(email || "")
                .trim()
                .toLowerCase();

        if (
            !validateCredentials(
                normalizedEmail,
                password
            )
        ) {
            return null;
        }

        setLoading(true);

        try {
            const credential =
                await auth
                    .createUserWithEmailAndPassword(
                        normalizedEmail,
                        password
                    );

            const user =
                credential.user;

            await createUserDocument(
                user
            );

            try {
                await user.sendEmailVerification();
            } catch (verificationError) {
                console.warn(
                    "[Auth] Unable to send verification email:",
                    verificationError
                );
            }

            showToast(
                "success",
                "Account created",
                "Welcome to L'ÉTERNEL."
            );

            closeAuth();

            return user;
        } catch (error) {
            handleAuthError(error);

            return null;
        } finally {
            setLoading(false);
        }
    }

    /* ======================================================
       USER DOCUMENT
    ====================================================== */

    async function createUserDocument(user) {
        if (!user) {
            return null;
        }

        const userReference =
            db.collection("users")
                .doc(user.uid);

        const snapshot =
            await userReference.get();

        if (snapshot.exists) {
            return snapshot.data();
        }

        const userData = {
            uid:
                user.uid,

            email:
                user.email || "",

            displayName:
                user.displayName || "",

            photoURL:
                user.photoURL || "",

            phoneNumber:
                user.phoneNumber || "",

            role:
                "customer",

            status:
                "active",

            emailVerified:
                Boolean(
                    user.emailVerified
                ),

            createdAt:
                firebase.firestore
                    .FieldValue.serverTimestamp(),

            updatedAt:
                firebase.firestore
                    .FieldValue.serverTimestamp(),

            lastLoginAt:
                firebase.firestore
                    .FieldValue.serverTimestamp()
        };

        await userReference.set(
            userData,
            {
                merge: true
            }
        );

        return userData;
    }

    async function getUserData(user) {
        if (!user) {
            return null;
        }

        try {
            const snapshot =
                await db
                    .collection("users")
                    .doc(user.uid)
                    .get();

            if (!snapshot.exists) {
                return await createUserDocument(
                    user
                );
            }

            return Object.assign(
                {
                    uid:
                        user.uid
                },
                snapshot.data() || {}
            );
        } catch (error) {
            console.error(
                "[Auth] Unable to load user profile:",
                error
            );

            return null;
        }
    }

    async function updateLoginMetadata(
        user
    ) {
        if (!user) {
            return;
        }

        try {
            await db
                .collection("users")
                .doc(user.uid)
                .set(
                    {
                        email:
                            user.email || "",

                        emailVerified:
                            Boolean(
                                user.emailVerified
                            ),

                        lastLoginAt:
                            firebase.firestore
                                .FieldValue.serverTimestamp(),

                        updatedAt:
                            firebase.firestore
                                .FieldValue.serverTimestamp()
                    },
                    {
                        merge: true
                    }
                );
        } catch (error) {
            console.warn(
                "[Auth] Unable to update login metadata:",
                error
            );
        }
    }

    /* ======================================================
       AUTH STATE
    ====================================================== */

    async function handleAuthStateChanged(
        user
    ) {
        Auth.state.user =
            user || null;

        Auth.state.userData =
            user
                ? await getUserData(user)
                : null;

        Auth.state.authReady =
            true;

        /*
         * Keep both state names populated because some older
         * project modules use user while the router also checks
         * currentUser.
         */
        app.state.user =
            user || null;

        app.state.currentUser =
            user || null;

        app.state.userData =
            Auth.state.userData;

        if (user) {
            await updateLoginMetadata(
                user
            );
        }

        updateProfileButton(
            user
        );

        dispatchAuthState(
            user,
            Auth.state.userData
        );
    }

    function dispatchAuthState(
        user,
        userData
    ) {
        const detail = {
            user:
                user || null,

            userData:
                userData || null,

            authenticated:
                Boolean(user)
        };

        /*
         * Compatibility events used by different modules
         * during the build.
         */
        document.dispatchEvent(
            new CustomEvent(
                "auth:statechange",
                {
                    detail: detail
                }
            )
        );

        document.dispatchEvent(
            new CustomEvent(
                "app:authchange",
                {
                    detail: detail
                }
            )
        );

        document.dispatchEvent(
            new CustomEvent(
                "auth:change",
                {
                    detail: detail
                }
            )
        );
    }

    /* ======================================================
       PROFILE BUTTON
    ====================================================== */

    function updateProfileButton(user) {
        const button =
            Auth.elements.openProfile;

        if (!button) {
            return;
        }

        button.classList.toggle(
            "authenticated",
            Boolean(user)
        );

        button.setAttribute(
            "aria-label",
            user
                ? "Open account"
                : "Sign in"
        );

        button.title =
            user
                ? "My Account"
                : "Sign In";
    }

    /* ======================================================
       LOGOUT
    ====================================================== */

    async function signOut() {
        try {
            closeProfile();

            await auth.signOut();

            showToast(
                "success",
                "Signed out",
                "You have been signed out."
            );

            if (
                window.LEternelRouter &&
                typeof window.LEternelRouter.navigate ===
                    "function"
            ) {
                window.LEternelRouter.navigate(
                    "/"
                );
            }

            return true;
        } catch (error) {
            handleAuthError(error);

            return false;
        }
    }

    /* ======================================================
       RESET PASSWORD
    ====================================================== */

    async function sendPasswordReset(
        email
    ) {
        const normalizedEmail =
            String(email || "")
                .trim()
                .toLowerCase();

        if (
            !validateEmail(
                normalizedEmail
            )
        ) {
            showToast(
                "error",
                "Invalid email",
                "Enter a valid email address."
            );

            return false;
        }

        try {
            await auth.sendPasswordResetEmail(
                normalizedEmail
            );

            showToast(
                "success",
                "Reset email sent",
                "Check your inbox for password reset instructions."
            );

            return true;
        } catch (error) {
            handleAuthError(error);

            return false;
        }
    }

    /* ======================================================
       USER ROLE
    ====================================================== */

    async function getUserRole(user) {
        const targetUser =
            user ||
            Auth.state.user ||
            auth.currentUser;

        if (!targetUser) {
            return null;
        }

        try {
            const tokenResult =
                await targetUser
                    .getIdTokenResult();

            if (
                tokenResult &&
                tokenResult.claims
            ) {
                if (
                    tokenResult.claims.role
                ) {
                    return tokenResult
                        .claims.role;
                }

                if (
                    tokenResult.claims.admin ===
                    true
                ) {
                    return "admin";
                }
            }
        } catch (error) {
            console.warn(
                "[Auth] Unable to inspect custom claims:",
                error
            );
        }

        try {
            const snapshot =
                await db
                    .collection("users")
                    .doc(targetUser.uid)
                    .get();

            if (!snapshot.exists) {
                return "customer";
            }

            return (
                snapshot.data().role ||
                "customer"
            );
        } catch (error) {
            console.error(
                "[Auth] Unable to retrieve user role:",
                error
            );

            return null;
        }
    }

    async function isAdmin(user) {
        const role =
            await getUserRole(user);

        return (
            role === "admin" ||
            role === "superadmin"
        );
    }

    /* ======================================================
       AUTH ERROR MESSAGES
    ====================================================== */

    function getFriendlyAuthError(error) {
        const code =
            error && error.code
                ? error.code
                : "";

        const messages = {
            "auth/invalid-email":
                "Enter a valid email address.",

            "auth/user-disabled":
                "This account has been disabled.",

            "auth/user-not-found":
                "No account was found with that email address.",

            "auth/wrong-password":
                "The email or password is incorrect.",

            "auth/invalid-login-credentials":
                "The email or password is incorrect.",

            "auth/invalid-credential":
                "The email or password is incorrect.",

            "auth/email-already-in-use":
                "An account already exists with that email address.",

            "auth/weak-password":
                "Choose a stronger password with at least 8 characters.",

            "auth/network-request-failed":
                "Check your internet connection and try again.",

            "auth/too-many-requests":
                "Too many attempts were made. Please wait and try again.",

            "auth/requires-recent-login":
                "Please sign in again before completing this action.",

            "auth/popup-closed-by-user":
                "The sign-in window was closed before authentication finished."
        };

        return (
            messages[code] ||
            (
                error &&
                error.message
                    ? error.message
                    : "Authentication failed. Please try again."
            )
        );
    }

    function handleAuthError(error) {
        console.error(
            "[Auth] Authentication error:",
            error
        );

        showToast(
            "error",
            "Authentication",
            getFriendlyAuthError(
                error
            )
        );

        document.dispatchEvent(
            new CustomEvent(
                "auth:error",
                {
                    detail: {
                        error:
                            error,

                        message:
                            getFriendlyAuthError(
                                error
                            )
                    }
                }
            )
        );
    }

    /* ======================================================
       TOAST WRAPPER
    ====================================================== */

    function showToast(
        type,
        title,
        message
    ) {
        if (
            app &&
            typeof app.showToast ===
                "function"
        ) {
            app.showToast({
                type:
                    type,

                title:
                    title,

                message:
                    message
            });

            return;
        }

        console.log(
            "[" +
                String(type).toUpperCase() +
                "]",
            title,
            message
        );
    }

    /* ======================================================
       FORM SUBMISSION
    ====================================================== */

    async function handleFormSubmit(event) {
        event.preventDefault();

        if (Auth.state.loading) {
            return;
        }

        const email =
            Auth.elements.authEmail
                ? Auth.elements.authEmail.value
                : "";

        const password =
            Auth.elements.authPassword
                ? Auth.elements.authPassword.value
                : "";

        if (
            Auth.state.mode ===
            "signup"
        ) {
            await signUp(
                email,
                password
            );
        } else {
            await signIn(
                email,
                password
            );
        }
    }

    /* ======================================================
       EVENT BINDINGS
    ====================================================== */

    function bindEvents() {
        if (Auth.elements.openProfile) {
            Auth.elements.openProfile
                .addEventListener(
                    "click",
                    function (event) {
                        event.preventDefault();
                        event.stopPropagation();

                        if (
                            Auth.state.user ||
                            auth.currentUser
                        ) {
                            openProfile();
                        } else {
                            openAuth(
                                "signin"
                            );
                        }
                    }
                );
        }

        if (Auth.elements.closeAuthButton) {
            Auth.elements.closeAuthButton
                .addEventListener(
                    "click",
                    function (event) {
                        event.preventDefault();

                        closeAuth();
                    }
                );
        }

        if (
            Auth.elements.closeProfileButton
        ) {
            Auth.elements.closeProfileButton
                .addEventListener(
                    "click",
                    function (event) {
                        event.preventDefault();

                        closeProfile();
                    }
                );
        }

        if (Auth.elements.authToggle) {
            Auth.elements.authToggle
                .addEventListener(
                    "click",
                    function (event) {
                        event.preventDefault();

                        toggleMode();
                    }
                );
        }

        if (Auth.elements.authForm) {
            Auth.elements.authForm
                .addEventListener(
                    "submit",
                    handleFormSubmit
                );
        }

        if (Auth.elements.logoutButton) {
            Auth.elements.logoutButton
                .addEventListener(
                    "click",
                    function (event) {
                        event.preventDefault();

                        signOut();
                    }
                );
        }

        if (Auth.elements.authEmail) {
            Auth.elements.authEmail
                .addEventListener(
                    "input",
                    function () {
                        Auth.elements.authEmail
                            .classList.remove(
                                "error",
                                "invalid"
                            );

                        Auth.elements.authEmail
                            .removeAttribute(
                                "aria-invalid"
                            );
                    }
                );
        }

        if (Auth.elements.authPassword) {
            Auth.elements.authPassword
                .addEventListener(
                    "input",
                    function () {
                        Auth.elements.authPassword
                            .classList.remove(
                                "error",
                                "invalid"
                            );

                        Auth.elements.authPassword
                            .removeAttribute(
                                "aria-invalid"
                            );
                    }
                );
        }

        /*
         * Clicking directly on modal backdrop closes it.
         */
        if (Auth.elements.authModal) {
            Auth.elements.authModal
                .addEventListener(
                    "click",
                    function (event) {
                        if (
                            event.target ===
                            Auth.elements.authModal
                        ) {
                            closeAuth();
                        }
                    }
                );
        }

        if (Auth.elements.profileModal) {
            Auth.elements.profileModal
                .addEventListener(
                    "click",
                    function (event) {
                        if (
                            event.target ===
                            Auth.elements.profileModal
                        ) {
                            closeProfile();
                        }
                    }
                );
        }

        /*
         * Escape key closes the customer modals.
         */
        document.addEventListener(
            "keydown",
            function (event) {
                if (
                    event.key !== "Escape"
                ) {
                    return;
                }

                if (
                    Auth.elements.authModal &&
                    (
                        Auth.elements.authModal
                            .classList.contains(
                                "active"
                            ) ||
                        Auth.elements.authModal
                            .classList.contains(
                                "open"
                            )
                    )
                ) {
                    closeAuth();
                    return;
                }

                if (
                    Auth.elements.profileModal &&
                    (
                        Auth.elements.profileModal
                            .classList.contains(
                                "active"
                            ) ||
                        Auth.elements.profileModal
                            .classList.contains(
                                "open"
                            )
                    )
                ) {
                    closeProfile();
                }
            }
        );
    }

    /* ======================================================
       INITIAL VISIBILITY
    ====================================================== */

    function forceInitialModalState() {
        /*
         * These elements should NEVER appear as normal page content
         * when the site first loads.
         */
        [
            Auth.elements.authModal,
            Auth.elements.profileModal
        ].forEach(function (modal) {
            if (!modal) {
                return;
            }

            modal.classList.remove(
                "active",
                "open"
            );

            modal.setAttribute(
                "aria-hidden",
                "true"
            );
        });
    }

    /* ======================================================
       INITIALIZATION
    ====================================================== */

    function initialize() {
        if (Auth.initialized) {
            return Auth;
        }

        cacheElements();

        forceInitialModalState();

        setMode("signin");

        bindEvents();

        auth.onAuthStateChanged(
            function (user) {
                handleAuthStateChanged(
                    user
                ).catch(function (error) {
                    console.error(
                        "[Auth] Auth state handler failed:",
                        error
                    );
                });
            },
            function (error) {
                console.error(
                    "[Auth] Auth observer failed:",
                    error
                );
            }
        );

        Auth.initialized =
            true;

        if (
            typeof app.registerModule ===
            "function"
        ) {
            app.registerModule(
                "auth",
                Auth
            );
        }

        document.dispatchEvent(
            new CustomEvent(
                "auth:ready",
                {
                    detail: {
                        auth:
                            Auth
                    }
                }
            )
        );

        console.info(
            "[Auth] L'ÉTERNEL authentication initialized."
        );

        return Auth;
    }

    /* ======================================================
       PUBLIC API
    ====================================================== */

    Object.assign(
        Auth,
        {
            init:
                initialize,

            open:
                openAuth,

            openAuth:
                openAuth,

            close:
                closeAuth,

            closeAuth:
                closeAuth,

            openProfile:
                openProfile,

            closeProfile:
                closeProfile,

            setMode:
                setMode,

            toggleMode:
                toggleMode,

            signIn:
                signIn,

            signUp:
                signUp,

            signOut:
                signOut,

            logout:
                signOut,

            sendPasswordReset:
                sendPasswordReset,

            getUserData:
                getUserData,

            getUserRole:
                getUserRole,

            isAdmin:
                isAdmin,

            getCurrentUser:
                function () {
                    return (
                        Auth.state.user ||
                        auth.currentUser ||
                        null
                    );
                },

            isAuthenticated:
                function () {
                    return Boolean(
                        Auth.state.user ||
                        auth.currentUser
                    );
                }
        }
    );

    window.LEternelAuth =
        Auth;

    /*
     * Compatibility with modules that call app.openAuth().
     */
    app.openAuth =
        openAuth;

    if (
        document.readyState ===
        "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            initialize,
            {
                once: true
            }
        );
    } else {
        initialize();
    }
})();