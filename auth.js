```javascript
"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   FIREBASE AUTHENTICATION MODULE — V8 NAMESPACED SDK
========================================================== */

(function initializeAuthenticationModule() {
    const app = window.LEternelApp;
    const router = window.LEternelRouter;
    const services = window.FirebaseServices;

    if (!app) {
        throw new Error(
            "LEternelApp was not found. Load app.js before auth.js."
        );
    }

    if (!services || !services.auth || !services.db) {
        throw new Error(
            "Firebase services were not found. Load firebase.js before auth.js."
        );
    }

    const auth = services.auth;
    const db = services.db;
    const serverTimestamp = services.helpers.serverTimestamp;
    const normalizeFirebaseError =
        services.helpers.normalizeFirebaseError;

    const Auth = {
        initialized: false,
        currentUser: null,
        currentProfile: null,
        authStateResolved: false,
        unsubscribeAuth: null,

        elements: {},

        config: {
            usersCollection: "users",
            defaultRole: "customer",
            minimumPasswordLength: 8,
            verificationResendDelay: 60000
        },

        state: {
            activePanel: "login",
            submitting: false,
            lastVerificationSentAt: 0
        }
    };

    /* ======================================================
       DOM HELPERS
    ====================================================== */

    function query(selector, parent) {
        return (parent || document).querySelector(selector);
    }

    function queryAll(selector, parent) {
        return Array.prototype.slice.call(
            (parent || document).querySelectorAll(selector)
        );
    }

    function getById(id) {
        return document.getElementById(id);
    }

    function escapeHTML(value) {
        if (
            app.utils &&
            typeof app.utils.escapeHTML === "function"
        ) {
            return app.utils.escapeHTML(value);
        }

        const element = document.createElement("div");
        element.textContent = String(value || "");

        return element.innerHTML;
    }

    function getFormValue(form, names) {
        const fieldNames = Array.isArray(names)
            ? names
            : [names];

        for (
            let index = 0;
            index < fieldNames.length;
            index += 1
        ) {
            const field = form.elements[fieldNames[index]];

            if (field) {
                return String(field.value || "").trim();
            }
        }

        return "";
    }

    /* ======================================================
       ELEMENT CACHE
    ====================================================== */

    function cacheElements() {
        const authModal =
            getById("auth-modal") ||
            query(".auth-modal");

        Auth.elements = {
            authModal: authModal,

            authPanels: authModal
                ? queryAll("[data-auth-panel]", authModal)
                : [],

            authTabs: authModal
                ? queryAll("[data-auth-tab]", authModal)
                : [],

            loginForm:
                getById("login-form") ||
                query('[data-auth-form="login"]'),

            registerForm:
                getById("register-form") ||
                query('[data-auth-form="register"]'),

            resetForm:
                getById("reset-password-form") ||
                query('[data-auth-form="reset"]'),

            verificationForm:
                getById("verification-form") ||
                query('[data-auth-form="verification"]'),

            googleButtons: queryAll(
                "[data-google-signin], .google-signin-btn"
            ),

            logoutButtons: queryAll(
                "[data-logout], .logout-button"
            ),

            resendVerificationButtons: queryAll(
                "[data-resend-verification]"
            ),

            passwordToggleButtons: queryAll(
                "[data-password-toggle]"
            ),

            passwordInputs: queryAll(
                'input[type="password"][data-password-strength]'
            ),

            verificationBanners: queryAll(
                "[data-verification-banner], .verify-banner"
            ),

            userNameElements: queryAll("[data-user-name]"),
            userEmailElements: queryAll("[data-user-email]"),
            userAvatarElements: queryAll("[data-user-avatar]"),

            authOnlyElements: queryAll("[data-auth-only]"),
            guestOnlyElements: queryAll("[data-guest-only]"),
            adminOnlyElements: queryAll("[data-admin-only]")
        };
    }

    /* ======================================================
       VALIDATION
    ====================================================== */

    function isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
            String(email || "")
        );
    }

    function validatePassword(password) {
        const value = String(password || "");

        return {
            length:
                value.length >=
                Auth.config.minimumPasswordLength,

            uppercase: /[A-Z]/.test(value),
            lowercase: /[a-z]/.test(value),
            number: /\d/.test(value),
            special: /[^A-Za-z0-9]/.test(value)
        };
    }

    function isStrongPassword(password) {
        const rules = validatePassword(password);

        return (
            rules.length &&
            rules.uppercase &&
            rules.lowercase &&
            rules.number
        );
    }

    function calculatePasswordStrength(password) {
        const value = String(password || "");

        if (!value) {
            return {
                score: 0,
                label: "",
                percentage: 0
            };
        }

        const rules = validatePassword(value);
        let score = 0;

        if (rules.length) {
            score += 1;
        }

        if (rules.uppercase) {
            score += 1;
        }

        if (rules.lowercase) {
            score += 1;
        }

        if (rules.number) {
            score += 1;
        }

        if (rules.special) {
            score += 1;
        }

        const labels = [
            "Very weak",
            "Weak",
            "Fair",
            "Strong",
            "Very strong"
        ];

        return {
            score: score,
            label: labels[Math.max(0, score - 1)] || "",
            percentage: score * 20
        };
    }

    function clearFieldErrors(form) {
        if (!form) {
            return;
        }

        queryAll(
            ".has-error, .invalid, [aria-invalid='true']",
            form
        ).forEach(function (element) {
            element.classList.remove(
                "has-error",
                "invalid"
            );

            element.removeAttribute("aria-invalid");
        });

        queryAll(
            ".field-error, .auth-field-error",
            form
        ).forEach(function (element) {
            element.textContent = "";
            element.hidden = true;
        });
    }

    function showFieldError(field, message) {
        if (!field) {
            return;
        }

        const wrapper =
            field.closest(
                ".form-group, .auth-form-group, .input-group"
            ) || field.parentElement;

        field.setAttribute("aria-invalid", "true");

        if (wrapper) {
            wrapper.classList.add("has-error");
        }

        let errorElement = wrapper
            ? query(
                  ".field-error, .auth-field-error",
                  wrapper
              )
            : null;

        if (!errorElement && wrapper) {
            errorElement = document.createElement("small");
            errorElement.className = "auth-field-error";
            wrapper.appendChild(errorElement);
        }

        if (errorElement) {
            errorElement.textContent = message;
            errorElement.hidden = false;
        }
    }

    function validateLoginForm(form) {
        clearFieldErrors(form);

        const emailField =
            form.elements.email ||
            form.elements.loginEmail;

        const passwordField =
            form.elements.password ||
            form.elements.loginPassword;

        let valid = true;

        if (!emailField || !isValidEmail(emailField.value)) {
            showFieldError(
                emailField,
                "Enter a valid email address."
            );

            valid = false;
        }

        if (!passwordField || !passwordField.value) {
            showFieldError(
                passwordField,
                "Enter your password."
            );

            valid = false;
        }

        return valid;
    }

    function validateRegisterForm(form) {
        clearFieldErrors(form);

        const nameField =
            form.elements.name ||
            form.elements.fullName ||
            form.elements.displayName;

        const emailField =
            form.elements.email ||
            form.elements.registerEmail;

        const passwordField =
            form.elements.password ||
            form.elements.registerPassword;

        const confirmField =
            form.elements.confirmPassword ||
            form.elements.passwordConfirmation;

        const termsField =
            form.elements.terms ||
            form.elements.acceptTerms;

        let valid = true;

        if (
            !nameField ||
            String(nameField.value || "").trim().length < 2
        ) {
            showFieldError(
                nameField,
                "Enter your full name."
            );

            valid = false;
        }

        if (!emailField || !isValidEmail(emailField.value)) {
            showFieldError(
                emailField,
                "Enter a valid email address."
            );

            valid = false;
        }

        if (
            !passwordField ||
            !isStrongPassword(passwordField.value)
        ) {
            showFieldError(
                passwordField,
                "Use at least 8 characters with uppercase, lowercase, and a number."
            );

            valid = false;
        }

        if (
            confirmField &&
            confirmField.value !== passwordField.value
        ) {
            showFieldError(
                confirmField,
                "The passwords do not match."
            );

            valid = false;
        }

        if (termsField && !termsField.checked) {
            showFieldError(
                termsField,
                "Accept the terms to create your account."
            );

            valid = false;
        }

        return valid;
    }

    /* ======================================================
       BUTTON STATES
    ====================================================== */

    function setButtonLoading(button, loading, loadingText) {
        if (!button) {
            return;
        }

        if (loading) {
            if (!button.dataset.originalText) {
                button.dataset.originalText =
                    button.textContent.trim();
            }

            button.disabled = true;
            button.classList.add("loading");
            button.setAttribute("aria-busy", "true");

            const label =
                query("[data-button-label]", button);

            if (label && loadingText) {
                label.textContent = loadingText;
            }
        } else {
            button.disabled = false;
            button.classList.remove("loading");
            button.removeAttribute("aria-busy");

            const label =
                query("[data-button-label]", button);

            if (
                label &&
                button.dataset.originalText
            ) {
                label.textContent =
                    button.dataset.originalText;
            }
        }
    }

    function setFormSubmitting(form, submitting, message) {
        Auth.state.submitting = submitting;

        if (!form) {
            return;
        }

        const submitButton = query(
            'button[type="submit"]',
            form
        );

        setButtonLoading(
            submitButton,
            submitting,
            message
        );

        queryAll("input, select, textarea", form).forEach(
            function (field) {
                field.disabled = submitting;
            }
        );
    }

    /* ======================================================
       FIREBASE ERROR MESSAGES
    ====================================================== */

    function getFriendlyAuthError(error) {
        const normalized = normalizeFirebaseError(error);

        const messages = {
            "auth/email-already-in-use":
                "An account already exists with this email address.",

            "auth/invalid-email":
                "Enter a valid email address.",

            "auth/user-disabled":
                "This account has been disabled. Contact client services.",

            "auth/user-not-found":
                "No account was found with these details.",

            "auth/wrong-password":
                "The password you entered is incorrect.",

            "auth/invalid-login-credentials":
                "The email address or password is incorrect.",

            "auth/weak-password":
                "Choose a stronger password with at least 8 characters.",

            "auth/too-many-requests":
                "Too many attempts were made. Please try again later.",

            "auth/network-request-failed":
                "A network error occurred. Check your connection and try again.",

            "auth/popup-closed-by-user":
                "The Google sign-in window was closed before authentication finished.",

            "auth/popup-blocked":
                "Your browser blocked the sign-in window. Allow pop-ups and try again.",

            "auth/account-exists-with-different-credential":
                "An account already exists with this email using another sign-in method.",

            "auth/requires-recent-login":
                "For security, sign in again before making this change.",

            "auth/credential-already-in-use":
                "This sign-in credential is already connected to another account.",

            "auth/operation-not-allowed":
                "This sign-in method has not been enabled.",

            "auth/expired-action-code":
                "This authentication link has expired.",

            "auth/invalid-action-code":
                "This authentication link is invalid or has already been used."
        };

        return {
            code: normalized.code,
            message:
                messages[normalized.code] ||
                normalized.message ||
                "Authentication could not be completed."
        };
    }

    function handleAuthError(error, form) {
        const friendlyError = getFriendlyAuthError(error);

        console.error(
            "[Auth]",
            friendlyError.code,
            error
        );

        if (
            form &&
            (
                friendlyError.code === "auth/wrong-password" ||
                friendlyError.code ===
                    "auth/invalid-login-credentials"
            )
        ) {
            const card =
                form.closest(".auth-card") ||
                form.closest(".auth-modal-content");

            if (card) {
                card.classList.remove("shake");

                void card.offsetWidth;

                card.classList.add("shake");

                window.setTimeout(function () {
                    card.classList.remove("shake");
                }, 500);
            }
        }

        app.showToast({
            type: "error",
            title: "Authentication failed",
            message: friendlyError.message
        });

        return friendlyError;
    }

    /* ======================================================
       USER PROFILE
    ====================================================== */

    function getUserDocumentReference(uid) {
        return db
            .collection(Auth.config.usersCollection)
            .doc(uid);
    }

    async function getUserProfile(userOrUid) {
        const uid =
            typeof userOrUid === "string"
                ? userOrUid
                : userOrUid && userOrUid.uid;

        if (!uid) {
            return null;
        }

        const snapshot =
            await getUserDocumentReference(uid).get();

        if (!snapshot.exists) {
            return null;
        }

        return Object.assign(
            {
                id: snapshot.id
            },
            snapshot.data()
        );
    }

    async function createUserProfile(user, profileData) {
        if (!user) {
            throw new Error(
                "A Firebase user is required to create a profile."
            );
        }

        const data = profileData || {};

        const profile = {
            uid: user.uid,
            email: user.email || data.email || "",
            displayName:
                user.displayName ||
                data.displayName ||
                "Customer",

            photoURL:
                user.photoURL ||
                data.photoURL ||
                "",

            phoneNumber:
                user.phoneNumber ||
                data.phoneNumber ||
                "",

            role:
                data.role ||
                Auth.config.defaultRole,

            status: "active",
            emailVerified:
                Boolean(user.emailVerified),

            provider:
                user.providerData &&
                user.providerData.length
                    ? user.providerData[0].providerId
                    : "password",

            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            lastLoginAt: serverTimestamp(),

            preferences: {
                marketingEmails:
                    data.marketingEmails !== false,

                orderUpdates: true,
                productRecommendations: true
            }
        };

        await getUserDocumentReference(user.uid).set(
            profile,
            {
                merge: true
            }
        );

        return profile;
    }

    async function ensureUserProfile(user, additionalData) {
        if (!user) {
            return null;
        }

        const reference =
            getUserDocumentReference(user.uid);

        const snapshot = await reference.get();

        if (!snapshot.exists) {
            await createUserProfile(
                user,
                additionalData
            );
        } else {
            await reference.set(
                {
                    email:
                        user.email ||
                        snapshot.data().email ||
                        "",

                    displayName:
                        user.displayName ||
                        snapshot.data().displayName ||
                        "Customer",

                    photoURL:
                        user.photoURL ||
                        snapshot.data().photoURL ||
                        "",

                    emailVerified:
                        Boolean(user.emailVerified),

                    lastLoginAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                },
                {
                    merge: true
                }
            );
        }

        return getUserProfile(user.uid);
    }

    async function getUserRole(user) {
        const targetUser =
            user || auth.currentUser;

        if (!targetUser) {
            return null;
        }

        try {
            const tokenResult =
                await targetUser.getIdTokenResult();

            if (
                tokenResult.claims &&
                tokenResult.claims.admin === true
            ) {
                return "admin";
            }

            if (
                tokenResult.claims &&
                tokenResult.claims.role
            ) {
                return tokenResult.claims.role;
            }
        } catch (error) {
            console.warn(
                "[Auth] Unable to read custom claims:",
                error
            );
        }

        const profile = await getUserProfile(
            targetUser.uid
        );

        return profile
            ? profile.role || Auth.config.defaultRole
            : null;
    }

    async function isCurrentUserAdmin() {
        const role = await getUserRole(
            auth.currentUser
        );

        return (
            role === "admin" ||
            role === "superadmin"
        );
    }

    /* ======================================================
       REGISTRATION
    ====================================================== */

    async function register(options) {
        const settings = options || {};

        const email = String(
            settings.email || ""
        )
            .trim()
            .toLowerCase();

        const password = String(
            settings.password || ""
        );

        const displayName = String(
            settings.displayName || ""
        ).trim();

        if (!displayName || displayName.length < 2) {
            throw {
                code: "auth/invalid-display-name",
                message: "Enter your full name."
            };
        }

        if (!isValidEmail(email)) {
            throw {
                code: "auth/invalid-email",
                message: "Enter a valid email address."
            };
        }

        if (!isStrongPassword(password)) {
            throw {
                code: "auth/weak-password",
                message:
                    "Use at least 8 characters with uppercase, lowercase, and a number."
            };
        }

        const credential =
            await auth.createUserWithEmailAndPassword(
                email,
                password
            );

        const user = credential.user;

        await user.updateProfile({
            displayName: displayName
        });

        await createUserProfile(user, {
            displayName: displayName,
            email: email,
            marketingEmails:
                settings.marketingEmails !== false
        });

        try {
            await sendVerificationEmail(user);
        } catch (verificationError) {
            console.warn(
                "[Auth] Verification email could not be sent:",
                verificationError
            );
        }

        await user.reload();

        return auth.currentUser;
    }

    async function handleRegisterSubmit(event) {
        event.preventDefault();

        const form = event.currentTarget;

        if (!validateRegisterForm(form)) {
            return;
        }

        const displayName = getFormValue(form, [
            "name",
            "fullName",
            "displayName"
        ]);

        const email = getFormValue(form, [
            "email",
            "registerEmail"
        ]);

        const password = getFormValue(form, [
            "password",
            "registerPassword"
        ]);

        const marketingField =
            form.elements.marketingEmails ||
            form.elements.newsletter;

        setFormSubmitting(
            form,
            true,
            "Creating account…"
        );

        try {
            const user = await register({
                displayName: displayName,
                email: email,
                password: password,
                marketingEmails:
                    !marketingField ||
                    marketingField.checked
            });

            form.reset();

            app.showToast({
                type: "success",
                title: "Welcome to L'ÉTERNEL",
                message:
                    "Your account has been created. Check your inbox to verify your email."
            });

            updateVerificationUI(user);

            if (
                app.activateAuthPanel &&
                !user.emailVerified
            ) {
                app.activateAuthPanel(
                    "verification"
                );
            }
        } catch (error) {
            handleAuthError(error, form);
        } finally {
            setFormSubmitting(form, false);
        }
    }

    /* ======================================================
       EMAIL AND PASSWORD LOGIN
    ====================================================== */

    async function signIn(email, password, remember) {
        const normalizedEmail = String(
            email || ""
        )
            .trim()
            .toLowerCase();

        if (!isValidEmail(normalizedEmail)) {
            throw {
                code: "auth/invalid-email",
                message: "Enter a valid email address."
            };
        }

        const persistence = remember === false
            ? firebase.auth.Auth.Persistence.SESSION
            : firebase.auth.Auth.Persistence.LOCAL;

        await auth.setPersistence(persistence);

        const credential =
            await auth.signInWithEmailAndPassword(
                normalizedEmail,
                String(password || "")
            );

        await ensureUserProfile(
            credential.user
        );

        return credential.user;
    }

    async function handleLoginSubmit(event) {
        event.preventDefault();

        const form = event.currentTarget;

        if (!validateLoginForm(form)) {
            return;
        }

        const email = getFormValue(form, [
            "email",
            "loginEmail"
        ]);

        const password = getFormValue(form, [
            "password",
            "loginPassword"
        ]);

        const rememberField =
            form.elements.remember ||
            form.elements.rememberMe;

        setFormSubmitting(
            form,
            true,
            "Signing in…"
        );

        try {
            const user = await signIn(
                email,
                password,
                !rememberField ||
                    rememberField.checked
            );

            form.reset();

            app.showToast({
                type: "success",
                title: "Welcome back",
                message:
                    "You are now signed in to your account."
            });

            if (
                typeof app.closeAuth === "function"
            ) {
                app.closeAuth();
            }

            if (
                router &&
                router.pendingRoute
            ) {
                const pendingRoute =
                    router.pendingRoute;

                router.pendingRoute = null;

                router.navigate(
                    pendingRoute,
                    {
                        replace: true
                    }
                );
            }

            return user;
        } catch (error) {
            handleAuthError(error, form);
        } finally {
            setFormSubmitting(form, false);
        }
    }

    /* ======================================================
       GOOGLE SIGN-IN
    ====================================================== */

    async function signInWithGoogle() {
        const provider =
            new firebase.auth.GoogleAuthProvider();

        provider.setCustomParameters({
            prompt: "select_account"
        });

        const result =
            await auth.signInWithPopup(provider);

        await ensureUserProfile(
            result.user,
            {
                displayName:
                    result.user.displayName ||
                    "Customer",

                photoURL:
                    result.user.photoURL ||
                    ""
            }
        );

        return result.user;
    }

    async function handleGoogleSignIn(event) {
        event.preventDefault();

        const button = event.currentTarget;

        setButtonLoading(
            button,
            true,
            "Connecting…"
        );

        try {
            await signInWithGoogle();

            app.showToast({
                type: "success",
                title: "Welcome",
                message:
                    "You are now signed in with Google."
            });

            if (
                typeof app.closeAuth === "function"
            ) {
                app.closeAuth();
            }
        } catch (error) {
            handleAuthError(error);
        } finally {
            setButtonLoading(button, false);
        }
    }

    /* ======================================================
       PASSWORD RESET
    ====================================================== */

    async function sendPasswordReset(email) {
        const normalizedEmail = String(
            email || ""
        )
            .trim()
            .toLowerCase();

        if (!isValidEmail(normalizedEmail)) {
            throw {
                code: "auth/invalid-email",
                message: "Enter a valid email address."
            };
        }

        await auth.sendPasswordResetEmail(
            normalizedEmail
        );

        return true;
    }

    async function handleResetSubmit(event) {
        event.preventDefault();

        const form = event.currentTarget;
        const emailField =
            form.elements.email ||
            form.elements.resetEmail;

        clearFieldErrors(form);

        if (
            !emailField ||
            !isValidEmail(emailField.value)
        ) {
            showFieldError(
                emailField,
                "Enter the email address linked to your account."
            );

            return;
        }

        setFormSubmitting(
            form,
            true,
            "Sending link…"
        );

        try {
            await sendPasswordReset(
                emailField.value
            );

            form.reset();

            app.showToast({
                type: "success",
                title: "Reset link sent",
                message:
                    "Check your inbox for instructions to reset your password."
            });

            if (
                app.activateAuthPanel
            ) {
                app.activateAuthPanel("login");
            }
        } catch (error) {
            handleAuthError(error, form);
        } finally {
            setFormSubmitting(form, false);
        }
    }

    /* ======================================================
       EMAIL VERIFICATION
    ====================================================== */

    async function sendVerificationEmail(user) {
        const targetUser =
            user || auth.currentUser;

        if (!targetUser) {
            throw {
                code: "auth/user-not-found",
                message:
                    "Sign in before requesting a verification email."
            };
        }

        if (targetUser.emailVerified) {
            return false;
        }

        const now = Date.now();
        const elapsed =
            now -
            Auth.state.lastVerificationSentAt;

        if (
            elapsed <
            Auth.config.verificationResendDelay
        ) {
            const remainingSeconds = Math.ceil(
                (
                    Auth.config.verificationResendDelay -
                    elapsed
                ) / 1000
            );

            throw {
                code: "auth/verification-throttled",
                message:
                    "Please wait " +
                    remainingSeconds +
                    " seconds before requesting another email."
            };
        }

        await targetUser.sendEmailVerification();

        Auth.state.lastVerificationSentAt = now;

        return true;
    }

    async function handleResendVerification(event) {
        event.preventDefault();

        const button = event.currentTarget;

        setButtonLoading(
            button,
            true,
            "Sending…"
        );

        try {
            const sent =
                await sendVerificationEmail();

            app.showToast({
                type: sent ? "success" : "info",
                title: sent
                    ? "Verification sent"
                    : "Already verified",

                message: sent
                    ? "Check your inbox for the verification link."
                    : "Your email address is already verified."
            });
        } catch (error) {
            handleAuthError(error);
        } finally {
            setButtonLoading(button, false);
        }
    }

    async function refreshEmailVerification() {
        const user = auth.currentUser;

        if (!user) {
            return false;
        }

        await user.reload();

        const refreshedUser =
            auth.currentUser;

        updateVerificationUI(
            refreshedUser
        );

        if (refreshedUser.emailVerified) {
            await getUserDocumentReference(
                refreshedUser.uid
            ).set(
                {
                    emailVerified: true,
                    updatedAt: serverTimestamp()
                },
                {
                    merge: true
                }
            );

            app.showToast({
                type: "success",
                title: "Email verified",
                message:
                    "Your email address has been successfully verified."
            });

            return true;
        }

        app.showToast({
            type: "info",
            title: "Verification pending",
            message:
                "Your email has not been verified yet."
        });

        return false;
    }

    function updateVerificationUI(user) {
        const requiresVerification =
            Boolean(
                user &&
                user.email &&
                !user.emailVerified
            );

        Auth.elements.verificationBanners.forEach(
            function (banner) {
                banner.hidden =
                    !requiresVerification;

                banner.classList.toggle(
                    "active",
                    requiresVerification
                );
            }
        );

        document.body.classList.toggle(
            "email-unverified",
            requiresVerification
        );

        document.body.classList.toggle(
            "email-verified",
            Boolean(
                user &&
                user.emailVerified
            )
        );
    }

    /* ======================================================
       PASSWORD UPDATE
    ====================================================== */

    async function reauthenticateWithPassword(password) {
        const user = auth.currentUser;

        if (!user || !user.email) {
            throw {
                code: "auth/user-not-found",
                message:
                    "No signed-in user is available."
            };
        }

        const credential =
            firebase.auth.EmailAuthProvider.credential(
                user.email,
                String(password || "")
            );

        await user.reauthenticateWithCredential(
            credential
        );

        return user;
    }

    async function updatePassword(
        currentPassword,
        newPassword
    ) {
        if (!isStrongPassword(newPassword)) {
            throw {
                code: "auth/weak-password",
                message:
                    "Use at least 8 characters with uppercase, lowercase, and a number."
            };
        }

        const user = await reauthenticateWithPassword(
            currentPassword
        );

        await user.updatePassword(newPassword);

        await getUserDocumentReference(user.uid).set(
            {
                passwordUpdatedAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            },
            {
                merge: true
            }
        );

        return true;
    }

    /* ======================================================
       PROFILE UPDATE
    ====================================================== */

    async function updateProfile(data) {
        const user = auth.currentUser;

        if (!user) {
            throw {
                code: "auth/user-not-found",
                message:
                    "Sign in before updating your profile."
            };
        }

        const values = data || {};
        const authUpdates = {};
        const firestoreUpdates = {
            updatedAt: serverTimestamp()
        };

        if (
            Object.prototype.hasOwnProperty.call(
                values,
                "displayName"
            )
        ) {
            const displayName = String(
                values.displayName || ""
            ).trim();

            if (displayName.length < 2) {
                throw {
                    code: "auth/invalid-display-name",
                    message:
                        "Enter a valid display name."
                };
            }

            authUpdates.displayName =
                displayName;

            firestoreUpdates.displayName =
                displayName;
        }

        if (
            Object.prototype.hasOwnProperty.call(
                values,
                "photoURL"
            )
        ) {
            authUpdates.photoURL =
                values.photoURL || "";

            firestoreUpdates.photoURL =
                values.photoURL || "";
        }

        if (
            Object.keys(authUpdates).length
        ) {
            await user.updateProfile(
                authUpdates
            );
        }

        [
            "phoneNumber",
            "dateOfBirth",
            "gender",
            "country",
            "preferredCurrency"
        ].forEach(function (field) {
            if (
                Object.prototype.hasOwnProperty.call(
                    values,
                    field
                )
            ) {
                firestoreUpdates[field] =
                    values[field] || "";
            }
        });

        if (values.preferences) {
            firestoreUpdates.preferences =
                Object.assign(
                    {},
                    Auth.currentProfile &&
                    Auth.currentProfile.preferences
                        ? Auth.currentProfile.preferences
                        : {},
                    values.preferences
                );
        }

        await getUserDocumentReference(user.uid).set(
            firestoreUpdates,
            {
                merge: true
            }
        );

        await user.reload();

        Auth.currentUser = auth.currentUser;
        Auth.currentProfile =
            await getUserProfile(user.uid);

        renderAuthenticatedUser(
            Auth.currentUser,
            Auth.currentProfile
        );

        return Auth.currentProfile;
    }

    /* ======================================================
       LOGOUT
    ====================================================== */

    async function logout(options) {
        const settings = options || {};

        await auth.signOut();

        Auth.currentUser = null;
        Auth.currentProfile = null;

        if (!settings.silent) {
            app.showToast({
                type: "success",
                title: "Signed out",
                message:
                    "You have been securely signed out."
            });
        }

        if (
            settings.redirect !== false &&
            router
        ) {
            await router.navigate("/", {
                replace: true
            });
        }

        return true;
    }

    async function handleLogout(event) {
        event.preventDefault();

        const button = event.currentTarget;

        setButtonLoading(
            button,
            true,
            "Signing out…"
        );

        try {
            await logout();
        } catch (error) {
            handleAuthError(error);
        } finally {
            setButtonLoading(button, false);
        }
    }

    /* ======================================================
       ACCOUNT DELETION
    ====================================================== */

    async function deleteAccount(password) {
        const user = auth.currentUser;

        if (!user) {
            throw {
                code: "auth/user-not-found",
                message:
                    "No signed-in account was found."
            };
        }

        const providers =
            user.providerData.map(function (provider) {
                return provider.providerId;
            });

        if (
            providers.indexOf("password") !== -1
        ) {
            await reauthenticateWithPassword(password);
        }

        const uid = user.uid;

        await getUserDocumentReference(uid).set(
            {
                status: "deleted",
                deletedAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            },
            {
                merge: true
            }
        );

        await user.delete();

        Auth.currentUser = null;
        Auth.currentProfile = null;

        return true;
    }

    /* ======================================================
       PASSWORD VISIBILITY
    ====================================================== */

    function togglePasswordVisibility(button) {
        const targetId =
            button.dataset.passwordToggle;

        const input = targetId
            ? getById(targetId)
            : query(
                  "input",
                  button.closest(
                      ".password-input, .auth-input-wrapper, .password-change-input"
                  )
              );

        if (!input) {
            return;
        }

        const visible =
            input.type === "text";

        input.type = visible
            ? "password"
            : "text";

        button.setAttribute(
            "aria-label",
            visible
                ? "Show password"
                : "Hide password"
        );

        const icon = query("i", button);

        if (icon) {
            icon.classList.toggle(
                "fa-eye",
                visible
            );

            icon.classList.toggle(
                "fa-eye-slash",
                !visible
            );
        }
    }

    /* ======================================================
       PASSWORD STRENGTH UI
    ====================================================== */

    function updatePasswordStrength(input) {
        const strength =
            calculatePasswordStrength(
                input.value
            );

        const form =
            input.closest("form");

        const meter =
            form &&
            (
                query(
                    "[data-password-strength-meter]",
                    form
                ) ||
                query(
                    ".password-strength-fill",
                    form
                )
            );

        const label =
            form &&
            (
                query(
                    "[data-password-strength-label]",
                    form
                ) ||
                query(
                    ".password-strength-label",
                    form
                )
            );

        if (meter) {
            meter.style.width =
                strength.percentage + "%";

            meter.dataset.score =
                String(strength.score);
        }

        if (label) {
            label.textContent =
                strength.label;
        }

        const rules =
            validatePassword(input.value);

        Object.keys(rules).forEach(
            function (ruleName) {
                const ruleElement =
                    form &&
                    query(
                        '[data-password-rule="' +
                            ruleName +
                            '"]',
                        form
                    );

                if (ruleElement) {
                    ruleElement.classList.toggle(
                        "valid",
                        rules[ruleName]
                    );

                    const icon =
                        query("i", ruleElement);

                    if (icon) {
                        icon.className =
                            rules[ruleName]
                                ? "fa-solid fa-check"
                                : "fa-solid fa-circle";
                    }
                }
            }
        );
    }

    /* ======================================================
       AUTHENTICATED USER UI
    ====================================================== */

    function renderAuthenticatedUser(user, profile) {
        const authenticated = Boolean(user);

        document.body.classList.toggle(
            "is-authenticated",
            authenticated
        );

        document.body.classList.toggle(
            "is-guest",
            !authenticated
        );

        const displayName =
            authenticated
                ? user.displayName ||
                  (
                      profile &&
                      profile.displayName
                  ) ||
                  user.email ||
                  "Customer"
                : "Guest";

        const email =
            authenticated
                ? user.email || ""
                : "";

        const photoURL =
            authenticated
                ? user.photoURL ||
                  (
                      profile &&
                      profile.photoURL
                  ) ||
                  ""
                : "";

        Auth.elements.userNameElements.forEach(
            function (element) {
                element.textContent = displayName;
            }
        );

        Auth.elements.userEmailElements.forEach(
            function (element) {
                element.textContent = email;
            }
        );

        Auth.elements.userAvatarElements.forEach(
            function (element) {
                if (
                    element.tagName === "IMG"
                ) {
                    if (photoURL) {
                        element.src = photoURL;
                    }

                    element.alt =
                        displayName + " profile";
                } else {
                    element.style.backgroundImage =
                        photoURL
                            ? 'url("' +
                              photoURL.replace(
                                  /"/g,
                                  '\\"'
                              ) +
                              '")'
                            : "";
                }
            }
        );

        Auth.elements.authOnlyElements.forEach(
            function (element) {
                element.hidden = !authenticated;
            }
        );

        Auth.elements.guestOnlyElements.forEach(
            function (element) {
                element.hidden = authenticated;
            }
        );

        updateVerificationUI(user);

        if (
            typeof app.setCurrentUser === "function"
        ) {
            app.setCurrentUser(user);
        }
    }

    async function updateAdminVisibility(user) {
        let admin = false;

        if (user) {
            try {
                admin =
                    await isCurrentUserAdmin();
            } catch (error) {
                console.warn(
                    "[Auth] Unable to determine administrator status:",
                    error
                );
            }
        }

        Auth.elements.adminOnlyElements.forEach(
            function (element) {
                element.hidden = !admin;
            }
        );

        document.body.classList.toggle(
            "is-admin",
            admin
        );

        return admin;
    }

    /* ======================================================
       AUTH STATE OBSERVER
    ====================================================== */

    async function handleAuthStateChanged(user) {
        Auth.currentUser = user || null;
        Auth.currentProfile = null;

        if (user) {
            try {
                Auth.currentProfile =
                    await ensureUserProfile(user);
            } catch (error) {
                console.error(
                    "[Auth] Unable to synchronize user profile:",
                    error
                );
            }
        }

        renderAuthenticatedUser(
            user,
            Auth.currentProfile
        );

        await updateAdminVisibility(user);

        Auth.authStateResolved = true;

        document.documentElement.classList.add(
            "auth-ready"
        );

        document.dispatchEvent(
            new CustomEvent("auth:statechange", {
                detail: {
                    user: user || null,
                    profile:
                        Auth.currentProfile || null
                }
            })
        );
    }

    function observeAuthState() {
        if (Auth.unsubscribeAuth) {
            Auth.unsubscribeAuth();
        }

        Auth.unsubscribeAuth =
            auth.onAuthStateChanged(
                handleAuthStateChanged,
                function (error) {
                    Auth.authStateResolved = true;

                    console.error(
                        "[Auth] Authentication observer failed:",
                        error
                    );

                    handleAuthError(error);
                }
            );
    }

    /* ======================================================
       EVENT BINDING
    ====================================================== */

    function bindFormEvents() {
        if (Auth.elements.loginForm) {
            Auth.elements.loginForm.addEventListener(
                "submit",
                handleLoginSubmit
            );
        }

        if (Auth.elements.registerForm) {
            Auth.elements.registerForm.addEventListener(
                "submit",
                handleRegisterSubmit
            );
        }

        if (Auth.elements.resetForm) {
            Auth.elements.resetForm.addEventListener(
                "submit",
                handleResetSubmit
            );
        }
    }

    function bindButtonEvents() {
        Auth.elements.googleButtons.forEach(
            function (button) {
                button.addEventListener(
                    "click",
                    handleGoogleSignIn
                );
            }
        );

        Auth.elements.logoutButtons.forEach(
            function (button) {
                button.addEventListener(
                    "click",
                    handleLogout
                );
            }
        );

        Auth.elements.resendVerificationButtons.forEach(
            function (button) {
                button.addEventListener(
                    "click",
                    handleResendVerification
                );
            }
        );

        Auth.elements.passwordToggleButtons.forEach(
            function (button) {
                button.addEventListener(
                    "click",
                    function (event) {
                        event.preventDefault();

                        togglePasswordVisibility(
                            button
                        );
                    }
                );
            }
        );
    }

    function bindPasswordStrengthEvents() {
        Auth.elements.passwordInputs.forEach(
            function (input) {
                input.addEventListener(
                    "input",
                    function () {
                        updatePasswordStrength(
                            input
                        );
                    }
                );
            }
        );
    }

    function bindDelegatedEvents() {
        document.addEventListener(
            "click",
            function (event) {
                const refreshButton =
                    event.target.closest(
                        "[data-refresh-verification]"
                    );

                if (refreshButton) {
                    event.preventDefault();

                    setButtonLoading(
                        refreshButton,
                        true,
                        "Checking…"
                    );

                    refreshEmailVerification()
                        .catch(function (error) {
                            handleAuthError(error);
                        })
                        .finally(function () {
                            setButtonLoading(
                                refreshButton,
                                false
                            );
                        });
                }
            }
        );
    }

    /* ======================================================
       INITIALIZATION
    ====================================================== */

    function initialize() {
        if (Auth.initialized) {
            return;
        }

        cacheElements();
        bindFormEvents();
        bindButtonEvents();
        bindPasswordStrengthEvents();
        bindDelegatedEvents();
        observeAuthState();

        Auth.initialized = true;

        document.dispatchEvent(
            new CustomEvent("auth:ready", {
                detail: {
                    auth: Auth
                }
            })
        );

        console.info(
            "[Auth] L'ÉTERNEL authentication initialized."
        );
    }

    /* ======================================================
       PUBLIC API
    ====================================================== */

    Auth.init = initialize;

    Auth.register = register;
    Auth.signIn = signIn;
    Auth.signInWithGoogle = signInWithGoogle;
    Auth.logout = logout;

    Auth.sendPasswordReset =
        sendPasswordReset;

    Auth.sendVerificationEmail =
        sendVerificationEmail;

    Auth.refreshEmailVerification =
        refreshEmailVerification;

    Auth.reauthenticateWithPassword =
        reauthenticateWithPassword;

    Auth.updatePassword = updatePassword;
    Auth.updateProfile = updateProfile;
    Auth.deleteAccount = deleteAccount;

    Auth.getUserProfile = getUserProfile;
    Auth.ensureUserProfile = ensureUserProfile;
    Auth.getUserRole = getUserRole;
    Auth.isAdmin = isCurrentUserAdmin;

    Auth.validatePassword =
        validatePassword;

    Auth.calculatePasswordStrength =
        calculatePasswordStrength;

    Auth.getFriendlyError =
        getFriendlyAuthError;

    window.LEternelAuth = Auth;

    if (document.readyState === "loading") {
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
```
