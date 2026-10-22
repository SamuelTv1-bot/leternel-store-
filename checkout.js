```javascript
"use strict";

/* ==========================================================
   L'ÉTERNEL STORE
   CHECKOUT & ORDER CREATION MODULE — FIREBASE V8
========================================================== */

(function initializeCheckoutModule() {
    const app = window.LEternelApp;
    const router = window.LEternelRouter;
    const authModule = window.LEternelAuth;
    const cart = window.LEternelCart;
    const services = window.FirebaseServices;

    if (!app) {
        throw new Error(
            "LEternelApp was not found. Load app.js before checkout.js."
        );
    }

    if (!cart) {
        throw new Error(
            "LEternelCart was not found. Load cart.js before checkout.js."
        );
    }

    if (!services || !services.auth || !services.db) {
        throw new Error(
            "Firebase services were not found. Load firebase.js before checkout.js."
        );
    }

    const auth = services.auth;
    const db = services.db;
    const serverTimestamp = services.helpers.serverTimestamp;

    const Checkout = {
        initialized: false,

        config: {
            ordersCollection: "orders",
            productsCollection: "products",
            customersCollection: "users",
            checkoutSessionKey: "leternel_checkout_session",
            defaultCurrency: "NGN",
            defaultCountry: "Nigeria",
            orderPrefix: "LET",
            standardDeliveryFee: 15000,
            expressDeliveryFee: 30000,
            internationalDeliveryFee: 65000,
            freeDeliveryThreshold: 250000,
            taxRate: 0,
            reservationMinutes: 15
        },

        state: {
            user: null,
            step: 1,
            submitting: false,
            completedOrder: null,

            customer: {
                firstName: "",
                lastName: "",
                email: "",
                phone: ""
            },

            shippingAddress: {
                addressLine1: "",
                addressLine2: "",
                city: "",
                state: "",
                postalCode: "",
                country: "Nigeria"
            },

            deliveryMethod: "standard",
            paymentMethod: "card",
            billingSameAsShipping: true,

            billingAddress: {
                addressLine1: "",
                addressLine2: "",
                city: "",
                state: "",
                postalCode: "",
                country: "Nigeria"
            },

            notes: "",
            termsAccepted: false,
            paymentReference: "",
            paymentStatus: "pending"
        },

        elements: {}
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
        return app.utils.escapeHTML(value);
    }

    function toNumber(value, fallback) {
        const number = Number(value);

        return Number.isFinite(number)
            ? number
            : Number(fallback) || 0;
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
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

    function formatPrice(value, currency) {
        if (
            window.LEternelProducts &&
            typeof window.LEternelProducts.formatPrice === "function"
        ) {
            return window.LEternelProducts.formatPrice(
                value,
                currency || Checkout.config.defaultCurrency
            );
        }

        try {
            return new Intl.NumberFormat("en-NG", {
                style: "currency",
                currency:
                    currency ||
                    Checkout.config.defaultCurrency,
                maximumFractionDigits: 0
            }).format(toNumber(value, 0));
        } catch (error) {
            return (
                (currency || Checkout.config.defaultCurrency) +
                " " +
                toNumber(value, 0).toLocaleString()
            );
        }
    }

    function isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
            String(email || "")
        );
    }

    function normalizePhone(phone) {
        return String(phone || "")
            .replace(/[^\d+]/g, "")
            .trim();
    }

    /* ======================================================
       ELEMENT CACHE
    ====================================================== */

    function cacheElements() {
        Checkout.elements = {
            page:
                getById("checkout-page") ||
                query('[data-page="checkout"]'),

            form:
                getById("checkout-form") ||
                query("[data-checkout-form]"),

            steps: queryAll("[data-checkout-step]"),
            stepIndicators: queryAll(
                "[data-checkout-step-indicator]"
            ),

            nextButtons: queryAll(
                "[data-checkout-next]"
            ),

            previousButtons: queryAll(
                "[data-checkout-previous]"
            ),

            submitButton:
                getById("place-order-button") ||
                query("[data-place-order]"),

            orderItems:
                getById("checkout-order-items") ||
                query("[data-checkout-items]"),

            subtotalElements: queryAll(
                "[data-checkout-subtotal]"
            ),

            shippingElements: queryAll(
                "[data-checkout-shipping]"
            ),

            discountElements: queryAll(
                "[data-checkout-discount]"
            ),

            taxElements: queryAll(
                "[data-checkout-tax]"
            ),

            totalElements: queryAll(
                "[data-checkout-total]"
            ),

            deliveryOptions: queryAll(
                "[data-delivery-method]"
            ),

            paymentOptions: queryAll(
                "[data-payment-method]"
            ),

            billingToggle:
                getById("billing-same-as-shipping") ||
                query("[data-billing-same]"),

            billingSection:
                getById("billing-address-section") ||
                query("[data-billing-address]"),

            termsCheckbox:
                getById("checkout-terms") ||
                query("[data-checkout-terms]"),

            orderNotes:
                getById("checkout-notes") ||
                query("[data-checkout-notes]"),

            loading:
                getById("checkout-loading") ||
                query("[data-checkout-loading]"),

            confirmation:
                getById("order-confirmation") ||
                query("[data-order-confirmation]"),

            confirmationNumber:
                getById("confirmation-order-number") ||
                query("[data-confirmation-order-number]"),

            confirmationEmail:
                getById("confirmation-email") ||
                query("[data-confirmation-email]"),

            confirmationTotal:
                getById("confirmation-total") ||
                query("[data-confirmation-total]"),

            errorSummary:
                getById("checkout-error-summary") ||
                query("[data-checkout-errors]"),

            savedAddressSelect:
                getById("saved-address-select") ||
                query("[data-saved-address-select]")
        };
    }

    /* ======================================================
       CHECKOUT SESSION STORAGE
    ====================================================== */

    function saveSession() {
        try {
            const session = {
                customer: Checkout.state.customer,
                shippingAddress:
                    Checkout.state.shippingAddress,
                deliveryMethod:
                    Checkout.state.deliveryMethod,
                paymentMethod:
                    Checkout.state.paymentMethod,
                billingSameAsShipping:
                    Checkout.state.billingSameAsShipping,
                billingAddress:
                    Checkout.state.billingAddress,
                notes: Checkout.state.notes,
                step: Checkout.state.step
            };

            window.sessionStorage.setItem(
                Checkout.config.checkoutSessionKey,
                JSON.stringify(session)
            );
        } catch (error) {
            console.warn(
                "[Checkout] Session could not be saved:",
                error
            );
        }
    }

    function restoreSession() {
        try {
            const stored =
                window.sessionStorage.getItem(
                    Checkout.config.checkoutSessionKey
                );

            if (!stored) {
                return;
            }

            const session = JSON.parse(stored);

            Checkout.state.customer = Object.assign(
                {},
                Checkout.state.customer,
                session.customer || {}
            );

            Checkout.state.shippingAddress = Object.assign(
                {},
                Checkout.state.shippingAddress,
                session.shippingAddress || {}
            );

            Checkout.state.billingAddress = Object.assign(
                {},
                Checkout.state.billingAddress,
                session.billingAddress || {}
            );

            Checkout.state.deliveryMethod =
                session.deliveryMethod ||
                Checkout.state.deliveryMethod;

            Checkout.state.paymentMethod =
                session.paymentMethod ||
                Checkout.state.paymentMethod;

            Checkout.state.billingSameAsShipping =
                session.billingSameAsShipping !== false;

            Checkout.state.notes =
                session.notes || "";

            Checkout.state.step =
                Math.max(
                    1,
                    Math.min(
                        3,
                        toNumber(session.step, 1)
                    )
                );
        } catch (error) {
            console.warn(
                "[Checkout] Saved session could not be restored:",
                error
            );
        }
    }

    function clearSession() {
        try {
            window.sessionStorage.removeItem(
                Checkout.config.checkoutSessionKey
            );
        } catch (error) {
            console.warn(
                "[Checkout] Session could not be cleared:",
                error
            );
        }
    }

    /* ======================================================
       FORM STATE
    ====================================================== */

    function populateForm() {
        const form = Checkout.elements.form;

        if (!form) {
            return;
        }

        const values = Object.assign(
            {},
            Checkout.state.customer,
            Checkout.state.shippingAddress
        );

        Object.keys(values).forEach(function (name) {
            const field = form.elements[name];

            if (field && values[name] !== undefined) {
                field.value = values[name];
            }
        });

        Object.keys(
            Checkout.state.billingAddress
        ).forEach(function (name) {
            const field =
                form.elements["billing" + capitalize(name)];

            if (field) {
                field.value =
                    Checkout.state.billingAddress[name];
            }
        });

        if (Checkout.elements.billingToggle) {
            Checkout.elements.billingToggle.checked =
                Checkout.state.billingSameAsShipping;
        }

        if (Checkout.elements.orderNotes) {
            Checkout.elements.orderNotes.value =
                Checkout.state.notes;
        }

        if (Checkout.elements.termsCheckbox) {
            Checkout.elements.termsCheckbox.checked =
                Checkout.state.termsAccepted;
        }

        syncDeliveryOptions();
        syncPaymentOptions();
        updateBillingVisibility();
        showStep(Checkout.state.step);
    }

    function capitalize(value) {
        const text = String(value || "");

        return text.charAt(0).toUpperCase() +
            text.slice(1);
    }

    function collectFormState() {
        const form = Checkout.elements.form;

        if (!form) {
            return;
        }

        Checkout.state.customer = {
            firstName: getFormValue(form, "firstName"),
            lastName: getFormValue(form, "lastName"),
            email: getFormValue(form, "email"),
            phone: normalizePhone(
                getFormValue(form, "phone")
            )
        };

        Checkout.state.shippingAddress = {
            addressLine1: getFormValue(
                form,
                "addressLine1"
            ),

            addressLine2: getFormValue(
                form,
                "addressLine2"
            ),

            city: getFormValue(form, "city"),
            state: getFormValue(form, "state"),

            postalCode: getFormValue(
                form,
                "postalCode"
            ),

            country:
                getFormValue(form, "country") ||
                Checkout.config.defaultCountry
        };

        Checkout.state.billingAddress = {
            addressLine1: getFormValue(
                form,
                "billingAddressLine1"
            ),

            addressLine2: getFormValue(
                form,
                "billingAddressLine2"
            ),

            city: getFormValue(
                form,
                "billingCity"
            ),

            state: getFormValue(
                form,
                "billingState"
            ),

            postalCode: getFormValue(
                form,
                "billingPostalCode"
            ),

            country:
                getFormValue(
                    form,
                    "billingCountry"
                ) ||
                Checkout.config.defaultCountry
        };

        Checkout.state.notes =
            Checkout.elements.orderNotes
                ? Checkout.elements.orderNotes.value.trim()
                : "";

        Checkout.state.termsAccepted =
            Checkout.elements.termsCheckbox
                ? Checkout.elements.termsCheckbox.checked
                : false;

        saveSession();
    }

    /* ======================================================
       CUSTOMER PREFILL
    ====================================================== */

    async function prefillCustomer(user, profile) {
        if (!user) {
            populateForm();
            return;
        }

        const displayName =
            user.displayName ||
            (
                profile &&
                profile.displayName
            ) ||
            "";

        const nameParts =
            displayName.trim().split(/\s+/);

        if (!Checkout.state.customer.firstName) {
            Checkout.state.customer.firstName =
                nameParts.shift() || "";
        }

        if (!Checkout.state.customer.lastName) {
            Checkout.state.customer.lastName =
                nameParts.join(" ");
        }

        if (!Checkout.state.customer.email) {
            Checkout.state.customer.email =
                user.email || "";
        }

        if (!Checkout.state.customer.phone) {
            Checkout.state.customer.phone =
                user.phoneNumber ||
                (
                    profile &&
                    profile.phoneNumber
                ) ||
                "";
        }

        if (
            profile &&
            Array.isArray(profile.addresses) &&
            profile.addresses.length &&
            !Checkout.state.shippingAddress.addressLine1
        ) {
            const defaultAddress =
                profile.addresses.find(function (address) {
                    return address.default === true;
                }) ||
                profile.addresses[0];

            Checkout.state.shippingAddress =
                Object.assign(
                    {},
                    Checkout.state.shippingAddress,
                    defaultAddress
                );
        }

        populateForm();
    }

    /* ======================================================
       DELIVERY
    ====================================================== */

    function getDeliveryMethod(methodId) {
        const methods = {
            standard: {
                id: "standard",
                label: "Standard delivery",
                fee:
                    cart.state.subtotal >=
                    Checkout.config.freeDeliveryThreshold
                        ? 0
                        : Checkout.config.standardDeliveryFee,

                estimate: "3–5 business days"
            },

            express: {
                id: "express",
                label: "Express delivery",
                fee:
                    Checkout.config.expressDeliveryFee,
                estimate: "1–2 business days"
            },

            international: {
                id: "international",
                label: "International delivery",
                fee:
                    Checkout.config.internationalDeliveryFee,
                estimate: "5–10 business days"
            }
        };

        return (
            methods[methodId] ||
            methods.standard
        );
    }

    function syncDeliveryOptions() {
        Checkout.elements.deliveryOptions.forEach(
            function (control) {
                const method =
                    control.dataset.deliveryMethod ||
                    control.value;

                const active =
                    method ===
                    Checkout.state.deliveryMethod;

                control.classList.toggle(
                    "active",
                    active
                );

                if (
                    control.type === "radio" ||
                    control.type === "checkbox"
                ) {
                    control.checked = active;
                }
            }
        );
    }

    function setDeliveryMethod(method) {
        Checkout.state.deliveryMethod =
            method || "standard";

        syncDeliveryOptions();
        renderTotals();
        saveSession();
    }

    /* ======================================================
       PAYMENT METHOD
    ====================================================== */

    function syncPaymentOptions() {
        Checkout.elements.paymentOptions.forEach(
            function (control) {
                const method =
                    control.dataset.paymentMethod ||
                    control.value;

                const active =
                    method ===
                    Checkout.state.paymentMethod;

                control.classList.toggle(
                    "active",
                    active
                );

                if (
                    control.type === "radio" ||
                    control.type === "checkbox"
                ) {
                    control.checked = active;
                }
            }
        );

        queryAll("[data-payment-panel]").forEach(
            function (panel) {
                panel.hidden =
                    panel.dataset.paymentPanel !==
                    Checkout.state.paymentMethod;

                panel.classList.toggle(
                    "active",
                    panel.dataset.paymentPanel ===
                        Checkout.state.paymentMethod
                );
            }
        );
    }

    function setPaymentMethod(method) {
        Checkout.state.paymentMethod =
            method || "card";

        syncPaymentOptions();
        saveSession();
    }

    /* ======================================================
       BILLING ADDRESS
    ====================================================== */

    function updateBillingVisibility() {
        const sameAsShipping =
            Checkout.state.billingSameAsShipping;

        if (Checkout.elements.billingSection) {
            Checkout.elements.billingSection.hidden =
                sameAsShipping;

            Checkout.elements.billingSection.classList.toggle(
                "active",
                !sameAsShipping
            );
        }

        if (Checkout.elements.form) {
            queryAll(
                "[data-billing-required]",
                Checkout.elements.form
            ).forEach(function (field) {
                field.required =
                    !sameAsShipping;
            });
        }
    }

    function getBillingAddress() {
        return Checkout.state.billingSameAsShipping
            ? clone(
                  Checkout.state.shippingAddress
              )
            : clone(
                  Checkout.state.billingAddress
              );
    }

    /* ======================================================
       TOTALS
    ====================================================== */

    function calculateTotals() {
        const cartTotals = cart.getTotals();
        const deliveryMethod =
            getDeliveryMethod(
                Checkout.state.deliveryMethod
            );

        const subtotal =
            toNumber(cartTotals.subtotal, 0);

        const discount =
            toNumber(cartTotals.discount, 0);

        const shipping =
            subtotal > 0
                ? deliveryMethod.fee
                : 0;

        const taxableAmount = Math.max(
            0,
            subtotal - discount
        );

        const tax =
            taxableAmount *
            Checkout.config.taxRate;

        const total = Math.max(
            0,
            subtotal +
                shipping +
                tax -
                discount
        );

        return {
            subtotal: subtotal,
            shipping: shipping,
            discount: discount,
            tax: tax,
            total: total,
            itemCount:
                cartTotals.itemCount,

            deliveryMethod:
                deliveryMethod
        };
    }

    function setElementsText(elements, value) {
        elements.forEach(function (element) {
            element.textContent = value;
        });
    }

    function renderTotals() {
        const totals = calculateTotals();

        setElementsText(
            Checkout.elements.subtotalElements,
            formatPrice(totals.subtotal)
        );

        setElementsText(
            Checkout.elements.shippingElements,
            totals.shipping === 0
                ? "Complimentary"
                : formatPrice(totals.shipping)
        );

        setElementsText(
            Checkout.elements.discountElements,
            totals.discount
                ? "-" +
                  formatPrice(totals.discount)
                : formatPrice(0)
        );

        setElementsText(
            Checkout.elements.taxElements,
            formatPrice(totals.tax)
        );

        setElementsText(
            Checkout.elements.totalElements,
            formatPrice(totals.total)
        );

        queryAll("[data-delivery-fee]").forEach(
            function (element) {
                const method =
                    getDeliveryMethod(
                        element.dataset.deliveryFee
                    );

                element.textContent =
                    method.fee === 0
                        ? "Complimentary"
                        : formatPrice(method.fee);
            }
        );
    }

    /* ======================================================
       ORDER SUMMARY
    ====================================================== */

    function createSummaryItem(item) {
        const article =
            document.createElement("article");

        article.className =
            "checkout-summary-item";

        const details = [
            item.size
                ? "Size " + item.size
                : "",

            item.color || "",

            item.quantity > 1
                ? "Qty " + item.quantity
                : ""
        ].filter(Boolean);

        article.innerHTML = [
            '<div class="checkout-summary-image">',
            '<img src="' +
                escapeHTML(
                    item.image ||
                    "https://placehold.co/300x380?text=L%27ÉTERNEL"
                ) +
                '" alt="' +
                escapeHTML(item.name) +
                '">',

            '<span class="checkout-item-quantity">' +
                escapeHTML(item.quantity) +
                "</span>",
            "</div>",

            '<div class="checkout-summary-copy">',
            "<h4>" +
                escapeHTML(item.name) +
                "</h4>",

            details.length
                ? "<p>" +
                  escapeHTML(
                      details.join(" · ")
                  ) +
                  "</p>"
                : "",

            "</div>",

            '<strong class="checkout-summary-price">' +
                escapeHTML(
                    formatPrice(
                        item.price *
                            item.quantity,
                        item.currency
                    )
                ) +
                "</strong>"
        ].join("");

        return article;
    }

    function renderOrderItems() {
        const container =
            Checkout.elements.orderItems;

        if (!container) {
            return;
        }

        container.innerHTML = "";

        const fragment =
            document.createDocumentFragment();

        cart.getItems().forEach(function (item) {
            fragment.appendChild(
                createSummaryItem(item)
            );
        });

        container.appendChild(fragment);
    }

    function renderSummary() {
        renderOrderItems();
        renderTotals();
    }

    /* ======================================================
       VALIDATION
    ====================================================== */

    function clearErrors() {
        if (!Checkout.elements.form) {
            return;
        }

        queryAll(
            ".has-error, [aria-invalid='true']",
            Checkout.elements.form
        ).forEach(function (element) {
            element.classList.remove("has-error");
            element.removeAttribute("aria-invalid");
        });

        queryAll(
            ".checkout-field-error",
            Checkout.elements.form
        ).forEach(function (element) {
            element.remove();
        });

        if (Checkout.elements.errorSummary) {
            Checkout.elements.errorSummary.hidden = true;
            Checkout.elements.errorSummary.innerHTML = "";
        }
    }

    function showFieldError(field, message) {
        if (!field) {
            return;
        }

        field.setAttribute("aria-invalid", "true");

        const group =
            field.closest(
                ".checkout-form-group, .form-group, .input-group"
            ) || field.parentElement;

        if (group) {
            group.classList.add("has-error");

            const error =
                document.createElement("small");

            error.className =
                "checkout-field-error";

            error.textContent = message;

            group.appendChild(error);
        }
    }

    function showValidationSummary(messages) {
        if (
            !Checkout.elements.errorSummary ||
            !messages.length
        ) {
            return;
        }

        Checkout.elements.errorSummary.hidden =
            false;

        Checkout.elements.errorSummary.innerHTML =
            "<strong>Please review the following:</strong>" +
            "<ul>" +
            messages
                .map(function (message) {
                    return (
                        "<li>" +
                        escapeHTML(message) +
                        "</li>"
                    );
                })
                .join("") +
            "</ul>";

        Checkout.elements.errorSummary.scrollIntoView({
            behavior: "smooth",
            block: "center"
        });
    }

    function validateStep(step) {
        collectFormState();
        clearErrors();

        const form = Checkout.elements.form;
        const errors = [];

        if (!form) {
            return true;
        }

        if (step === 1) {
            const requiredFields = [
                {
                    name: "firstName",
                    message:
                        "Enter your first name."
                },
                {
                    name: "lastName",
                    message:
                        "Enter your last name."
                },
                {
                    name: "email",
                    message:
                        "Enter a valid email address.",
                    validate: isValidEmail
                },
                {
                    name: "phone",
                    message:
                        "Enter your phone number."
                },
                {
                    name: "addressLine1",
                    message:
                        "Enter your delivery address."
                },
                {
                    name: "city",
                    message:
                        "Enter your city."
                },
                {
                    name: "state",
                    message:
                        "Enter your state or region."
                },
                {
                    name: "country",
                    message:
                        "Select your country."
                }
            ];

            requiredFields.forEach(function (rule) {
                const field =
                    form.elements[rule.name];

                const value =
                    field
                        ? String(field.value || "").trim()
                        : "";

                const valid =
                    value &&
                    (
                        !rule.validate ||
                        rule.validate(value)
                    );

                if (!valid) {
                    showFieldError(
                        field,
                        rule.message
                    );

                    errors.push(rule.message);
                }
            });
        }

        if (step === 2) {
            if (!Checkout.state.deliveryMethod) {
                errors.push(
                    "Select a delivery method."
                );
            }

            if (
                !Checkout.state.billingSameAsShipping
            ) {
                [
                    "billingAddressLine1",
                    "billingCity",
                    "billingState",
                    "billingCountry"
                ].forEach(function (name) {
                    const field =
                        form.elements[name];

                    if (
                        !field ||
                        !String(field.value || "").trim()
                    ) {
                        const message =
                            "Complete the billing address.";

                        showFieldError(
                            field,
                            message
                        );

                        if (
                            errors.indexOf(message) === -1
                        ) {
                            errors.push(message);
                        }
                    }
                });
            }
        }

        if (step === 3) {
            if (!Checkout.state.paymentMethod) {
                errors.push(
                    "Select a payment method."
                );
            }

            if (!Checkout.state.termsAccepted) {
                showFieldError(
                    Checkout.elements.termsCheckbox,
                    "Accept the terms before placing your order."
                );

                errors.push(
                    "Accept the terms and conditions."
                );
            }
        }

        showValidationSummary(errors);

        return errors.length === 0;
    }

    /* ======================================================
       STEPS
    ====================================================== */

    function showStep(step) {
        const normalizedStep = Math.max(
            1,
            Math.min(3, Number(step) || 1)
        );

        Checkout.state.step =
            normalizedStep;

        Checkout.elements.steps.forEach(
            function (section) {
                const sectionStep =
                    Number(
                        section.dataset.checkoutStep
                    );

                const active =
                    sectionStep === normalizedStep;

                section.hidden = !active;
                section.classList.toggle(
                    "active",
                    active
                );
            }
        );

        Checkout.elements.stepIndicators.forEach(
            function (indicator) {
                const indicatorStep =
                    Number(
                        indicator.dataset
                            .checkoutStepIndicator
                    );

                indicator.classList.toggle(
                    "active",
                    indicatorStep ===
                        normalizedStep
                );

                indicator.classList.toggle(
                    "complete",
                    indicatorStep <
                        normalizedStep
                );

                indicator.setAttribute(
                    "aria-current",
                    indicatorStep ===
                        normalizedStep
                        ? "step"
                        : "false"
                );
            }
        );

        saveSession();

        const pageTop =
            Checkout.elements.page;

        if (pageTop) {
            pageTop.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        }
    }

    function nextStep() {
        if (
            !validateStep(
                Checkout.state.step
            )
        ) {
            return;
        }

        showStep(
            Checkout.state.step + 1
        );
    }

    function previousStep() {
        showStep(
            Checkout.state.step - 1
        );
    }

    /* ======================================================
       ORDER NUMBERS
    ====================================================== */

    function createOrderNumber() {
        const date = new Date();

        const dateCode = [
            date.getFullYear(),
            String(
                date.getMonth() + 1
            ).padStart(2, "0"),
            String(
                date.getDate()
            ).padStart(2, "0")
        ].join("");

        const randomCode =
            Math.random()
                .toString(36)
                .slice(2, 8)
                .toUpperCase();

        return [
            Checkout.config.orderPrefix,
            dateCode,
            randomCode
        ].join("-");
    }

    /* ======================================================
       PAYMENT ADAPTER
    ====================================================== */

    async function initiatePayment(orderDraft) {
        /*
         * Card data must never be collected or stored directly in this
         * front-end module. Connect a PCI-compliant payment provider through
         * a secure backend or Firebase Cloud Function.
         */

        if (
            Checkout.state.paymentMethod ===
            "bank-transfer"
        ) {
            return {
                status: "awaiting-payment",
                reference:
                    "BANK-" + orderDraft.orderNumber
            };
        }

        if (
            Checkout.state.paymentMethod ===
            "cash-on-delivery"
        ) {
            return {
                status: "pending",
                reference:
                    "COD-" + orderDraft.orderNumber
            };
        }

        if (
            window.LEternelPayment &&
            typeof window.LEternelPayment.initialize ===
                "function"
        ) {
            return window.LEternelPayment.initialize({
                orderNumber:
                    orderDraft.orderNumber,
                amount: orderDraft.total,
                currency:
                    orderDraft.currency,
                email:
                    orderDraft.customer.email,
                customer:
                    orderDraft.customer,
                metadata: {
                    userId:
                        orderDraft.userId ||
                        "",
                    itemCount:
                        orderDraft.itemCount
                }
            });
        }

        document.dispatchEvent(
            new CustomEvent(
                "checkout:paymentrequired",
                {
                    detail: {
                        order: clone(orderDraft)
                    }
                }
            )
        );

        throw new Error(
            "Secure card payment has not been configured. Connect a supported payment provider before accepting card orders."
        );
    }

    /* ======================================================
       ORDER DRAFT
    ====================================================== */

    function createOrderDraft() {
        collectFormState();

        const totals = calculateTotals();
        const items = cart.getItems();
        const user = auth.currentUser;

        return {
            orderNumber: createOrderNumber(),

            userId:
                user ? user.uid : null,

            customer: clone(
                Checkout.state.customer
            ),

            shippingAddress: clone(
                Checkout.state.shippingAddress
            ),

            billingAddress:
                getBillingAddress(),

            delivery: {
                method:
                    totals.deliveryMethod.id,
                label:
                    totals.deliveryMethod.label,
                estimate:
                    totals.deliveryMethod.estimate,
                fee: totals.shipping
            },

            payment: {
                method:
                    Checkout.state.paymentMethod,
                status: "pending",
                reference: ""
            },

            items: items.map(function (item) {
                return {
                    key: item.key,
                    productId:
                        item.productId,
                    variantId:
                        item.variantId || "",
                    name: item.name,
                    image: item.image,
                    sku: item.sku || "",
                    size: item.size || "",
                    color: item.color || "",
                    price: item.price,
                    quantity: item.quantity,
                    lineTotal:
                        item.price *
                        item.quantity,
                    currency:
                        item.currency ||
                        Checkout.config
                            .defaultCurrency
                };
            }),

            itemCount: totals.itemCount,
            subtotal: totals.subtotal,
            shipping: totals.shipping,
            discount: totals.discount,
            tax: totals.tax,
            total: totals.total,

            currency:
                Checkout.config.defaultCurrency,

            coupon:
                cart.state.coupon
                    ? clone(cart.state.coupon)
                    : null,

            notes:
                Checkout.state.notes,

            status: "pending",
            fulfillmentStatus:
                "unfulfilled",

            source: "web",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };
    }

    /* ======================================================
       INVENTORY TRANSACTION
    ====================================================== */

    async function createOrderTransaction(
        orderDraft,
        paymentResult
    ) {
        const orderReference =
            db.collection(
                Checkout.config.ordersCollection
            ).doc();

        await db.runTransaction(
            async function (transaction) {
                const productSnapshots =
                    await Promise.all(
                        orderDraft.items.map(
                            function (item) {
                                const reference =
                                    db.collection(
                                        Checkout.config
                                            .productsCollection
                                    ).doc(
                                        item.productId
                                    );

                                return transaction
                                    .get(reference)
                                    .then(function (snapshot) {
                                        return {
                                            reference:
                                                reference,
                                            snapshot:
                                                snapshot,
                                            item: item
                                        };
                                    });
                            }
                        )
                    );

                const productUpdates = [];

                productSnapshots.forEach(
                    function (entry) {
                        if (!entry.snapshot.exists) {
                            throw new Error(
                                entry.item.name +
                                    " is no longer available."
                            );
                        }

                        const product =
                            entry.snapshot.data() || {};

                        if (
                            product.active === false ||
                            product.published === false
                        ) {
                            throw new Error(
                                entry.item.name +
                                    " is no longer available."
                            );
                        }

                        const variants =
                            Array.isArray(
                                product.variants
                            )
                                ? product.variants.slice()
                                : [];

                        if (
                            entry.item.variantId &&
                            variants.length
                        ) {
                            const variantIndex =
                                variants.findIndex(
                                    function (variant) {
                                        return (
                                            variant.id ===
                                            entry.item
                                                .variantId
                                        );
                                    }
                                );

                            if (
                                variantIndex === -1
                            ) {
                                throw new Error(
                                    "The selected variation of " +
                                        entry.item.name +
                                        " is unavailable."
                                );
                            }

                            const variant =
                                Object.assign(
                                    {},
                                    variants[
                                        variantIndex
                                    ]
                                );

                            const stock =
                                Math.max(
                                    0,
                                    toNumber(
                                        variant.stock,
                                        0
                                    )
                                );

                            if (
                                stock <
                                entry.item.quantity
                            ) {
                                throw new Error(
                                    "Only " +
                                        stock +
                                        " unit" +
                                        (
                                            stock === 1
                                                ? ""
                                                : "s"
                                        ) +
                                        " of " +
                                        entry.item.name +
                                        " remain."
                                );
                            }

                            variant.stock =
                                stock -
                                entry.item.quantity;

                            variants[
                                variantIndex
                            ] = variant;

                            const inventory =
                                variants.reduce(
                                    function (
                                        total,
                                        item
                                    ) {
                                        return (
                                            total +
                                            Math.max(
                                                0,
                                                toNumber(
                                                    item.stock,
                                                    0
                                                )
                                            )
                                        );
                                    },
                                    0
                                );

                            productUpdates.push({
                                reference:
                                    entry.reference,

                                data: {
                                    variants:
                                        variants,
                                    inventory:
                                        inventory,
                                    inStock:
                                        inventory > 0,
                                    salesCount:
                                        firebase.firestore.FieldValue.increment(
                                            entry.item
                                                .quantity
                                        ),
                                    updatedAt:
                                        serverTimestamp()
                                }
                            });

                            return;
                        }

                        const stock =
                            Math.max(
                                0,
                                toNumber(
                                    product.inventory,
                                    product.stock
                                )
                            );

                        if (
                            stock <
                            entry.item.quantity
                        ) {
                            throw new Error(
                                "Only " +
                                    stock +
                                    " unit" +
                                    (
                                        stock === 1
                                            ? ""
                                            : "s"
                                    ) +
                                    " of " +
                                    entry.item.name +
                                    " remain."
                            );
                        }

                        const remainingStock =
                            stock -
                            entry.item.quantity;

                        productUpdates.push({
                            reference:
                                entry.reference,

                            data: {
                                inventory:
                                    remainingStock,
                                inStock:
                                    remainingStock > 0,
                                salesCount:
                                    firebase.firestore.FieldValue.increment(
                                        entry.item
                                            .quantity
                                    ),
                                updatedAt:
                                    serverTimestamp()
                            }
                        });
                    }
                );

                productUpdates.forEach(
                    function (update) {
                        transaction.update(
                            update.reference,
                            update.data
                        );
                    }
                );

                transaction.set(
                    orderReference,
                    Object.assign(
                        {},
                        orderDraft,
                        {
                            id:
                                orderReference.id,

                            payment: {
                                method:
                                    Checkout.state
                                        .paymentMethod,

                                status:
                                    paymentResult.status ||
                                    "pending",

                                reference:
                                    paymentResult.reference ||
                                    ""
                            },

                            paymentStatus:
                                paymentResult.status ||
                                "pending"
                        }
                    )
                );

                if (orderDraft.userId) {
                    const customerReference =
                        db.collection(
                            Checkout.config
                                .customersCollection
                        ).doc(
                            orderDraft.userId
                        );

                    transaction.set(
                        customerReference,
                        {
                            lastOrderAt:
                                serverTimestamp(),

                            orderCount:
                                firebase.firestore.FieldValue.increment(
                                    1
                                ),

                            lifetimeValue:
                                firebase.firestore.FieldValue.increment(
                                    orderDraft.total
                                ),

                            updatedAt:
                                serverTimestamp()
                        },
                        {
                            merge: true
                        }
                    );
                }
            }
        );

        return Object.assign(
            {},
            orderDraft,
            {
                id: orderReference.id,

                payment: {
                    method:
                        Checkout.state.paymentMethod,

                    status:
                        paymentResult.status ||
                        "pending",

                    reference:
                        paymentResult.reference ||
                        ""
                },

                paymentStatus:
                    paymentResult.status ||
                    "pending"
            }
        );
    }

    /* ======================================================
       PLACE ORDER
    ====================================================== */

    function setSubmitting(submitting) {
        Checkout.state.submitting =
            Boolean(submitting);

        const button =
            Checkout.elements.submitButton;

        if (button) {
            if (
                submitting &&
                !button.dataset.originalLabel
            ) {
                button.dataset.originalLabel =
                    button.textContent.trim();
            }

            button.disabled = submitting;
            button.classList.toggle(
                "loading",
                submitting
            );

            button.setAttribute(
                "aria-busy",
                String(submitting)
            );

            const label =
                query(
                    "[data-button-label]",
                    button
                );

            if (label) {
                label.textContent = submitting
                    ? "Processing order…"
                    : button.dataset.originalLabel ||
                      "Place order";
            }
        }

        if (Checkout.elements.form) {
            queryAll(
                "input, select, textarea, button",
                Checkout.elements.form
            ).forEach(function (field) {
                if (
                    field !==
                    Checkout.elements.submitButton
                ) {
                    field.disabled = submitting;
                }
            });
        }
    }

    async function placeOrder() {
        if (Checkout.state.submitting) {
            return null;
        }

        if (!validateStep(3)) {
            return null;
        }

        if (!cart.getItemCount()) {
            app.showToast({
                type: "warning",
                title: "Your bag is empty",
                message:
                    "Add at least one item before placing your order."
            });

            if (router) {
                await router.navigate("/shop");
            }

            return null;
        }

        setSubmitting(true);
        app.showLoader(
            "Securing your order…"
        );

        try {
            const validation =
                await cart.validate();

            if (!validation.items.length) {
                throw new Error(
                    "No available items remain in your shopping bag."
                );
            }

            validation.issues.forEach(
                function (issue) {
                    app.showToast({
                        type: "warning",
                        title: "Bag updated",
                        message: issue.message
                    });
                }
            );

            const orderDraft =
                createOrderDraft();

            const paymentResult =
                await initiatePayment(
                    orderDraft
                );

            if (
                !paymentResult ||
                paymentResult.cancelled
            ) {
                throw new Error(
                    "Payment was cancelled."
                );
            }

            if (
                paymentResult.status ===
                    "failed" ||
                paymentResult.status ===
                    "declined"
            ) {
                throw new Error(
                    paymentResult.message ||
                    "Payment could not be completed."
                );
            }

            const order =
                await createOrderTransaction(
                    orderDraft,
                    paymentResult
                );

            Checkout.state.completedOrder =
                order;

            Checkout.state.paymentReference =
                order.payment.reference;

            Checkout.state.paymentStatus =
                order.payment.status;

            await cart.clear({
                silent: true
            });

            clearSession();
            renderConfirmation(order);

            document.dispatchEvent(
                new CustomEvent(
                    "checkout:complete",
                    {
                        detail: {
                            order: clone(order)
                        }
                    }
                )
            );

            app.showToast({
                type: "success",
                title: "Order confirmed",
                message:
                    "Your order " +
                    order.orderNumber +
                    " has been received."
            });

            return order;
        } catch (error) {
            console.error(
                "[Checkout] Order creation failed:",
                error
            );

            app.showToast({
                type: "error",
                title: "Order not completed",
                message:
                    error.message ||
                    "Your order could not be completed. No order was created."
            });

            document.dispatchEvent(
                new CustomEvent(
                    "checkout:error",
                    {
                        detail: {
                            error: error
                        }
                    }
                )
            );

            return null;
        } finally {
            setSubmitting(false);
            app.hideLoader();
        }
    }

    /* ======================================================
       CONFIRMATION
    ====================================================== */

    function renderConfirmation(order) {
        if (!order) {
            return;
        }

        if (Checkout.elements.form) {
            Checkout.elements.form.hidden = true;
        }

        if (Checkout.elements.confirmation) {
            Checkout.elements.confirmation.hidden =
                false;

            Checkout.elements.confirmation.classList.add(
                "active"
            );
        }

        if (
            Checkout.elements.confirmationNumber
        ) {
            Checkout.elements.confirmationNumber.textContent =
                order.orderNumber;
        }

        if (
            Checkout.elements.confirmationEmail
        ) {
            Checkout.elements.confirmationEmail.textContent =
                order.customer.email;
        }

        if (
            Checkout.elements.confirmationTotal
        ) {
            Checkout.elements.confirmationTotal.textContent =
                formatPrice(
                    order.total,
                    order.currency
                );
        }

        queryAll(
            "[data-confirmation-payment-status]"
        ).forEach(function (element) {
            element.textContent =
                formatPaymentStatus(
                    order.paymentStatus
                );
        });

        queryAll(
            "[data-confirmation-delivery]"
        ).forEach(function (element) {
            element.textContent =
                order.delivery.label +
                " · " +
                order.delivery.estimate;
        });

        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });
    }

    function formatPaymentStatus(status) {
        const labels = {
            paid: "Paid",
            successful: "Paid",
            pending: "Payment pending",
            "awaiting-payment":
                "Awaiting bank transfer",
            failed: "Payment failed",
            declined: "Payment declined"
        };

        return (
            labels[status] ||
            String(status || "Pending")
        );
    }

    /* ======================================================
       SAVED ADDRESSES
    ====================================================== */

    function populateSavedAddresses(profile) {
        const select =
            Checkout.elements.savedAddressSelect;

        if (!select) {
            return;
        }

        select.innerHTML =
            '<option value="">Choose a saved address</option>';

        const addresses =
            profile &&
            Array.isArray(profile.addresses)
                ? profile.addresses
                : [];

        addresses.forEach(
            function (address, index) {
                const option =
                    document.createElement("option");

                option.value = String(index);

                option.textContent = [
                    address.label ||
                        "Address " +
                            (index + 1),
                    address.addressLine1,
                    address.city
                ]
                    .filter(Boolean)
                    .join(" — ");

                select.appendChild(option);
            }
        );

        select.hidden =
            addresses.length === 0;

        select.dataset.addresses =
            JSON.stringify(addresses);
    }

    function applySavedAddress(index) {
        const select =
            Checkout.elements.savedAddressSelect;

        if (!select || index === "") {
            return;
        }

        try {
            const addresses =
                JSON.parse(
                    select.dataset.addresses ||
                    "[]"
                );

            const address =
                addresses[Number(index)];

            if (!address) {
                return;
            }

            Checkout.state.shippingAddress =
                Object.assign(
                    {},
                    Checkout.state.shippingAddress,
                    address
                );

            populateForm();
            saveSession();
        } catch (error) {
            console.warn(
                "[Checkout] Saved address could not be applied:",
                error
            );
        }
    }

    /* ======================================================
       ROUTE HANDLING
    ====================================================== */

    async function prepareCheckout() {
        if (!cart.getItemCount()) {
            app.showToast({
                type: "warning",
                title: "Your bag is empty",
                message:
                    "Add at least one piece before checking out."
            });

            if (router) {
                await router.navigate(
                    "/shop",
                    {
                        replace: true
                    }
                );
            }

            return false;
        }

        const validation =
            await cart.validate();

        if (!validation.items.length) {
            if (router) {
                await router.navigate(
                    "/shop",
                    {
                        replace: true
                    }
                );
            }

            return false;
        }

        renderSummary();

        if (
            auth.currentUser &&
            authModule &&
            typeof authModule.getUserProfile ===
                "function"
        ) {
            try {
                const profile =
                    await authModule.getUserProfile(
                        auth.currentUser.uid
                    );

                await prefillCustomer(
                    auth.currentUser,
                    profile
                );

                populateSavedAddresses(
                    profile
                );
            } catch (error) {
                console.warn(
                    "[Checkout] Customer profile could not be loaded:",
                    error
                );

                await prefillCustomer(
                    auth.currentUser,
                    null
                );
            }
        } else {
            populateForm();
        }

        return true;
    }

    /* ======================================================
       EVENTS
    ====================================================== */

    function bindStepEvents() {
        Checkout.elements.nextButtons.forEach(
            function (button) {
                button.addEventListener(
                    "click",
                    function (event) {
                        event.preventDefault();
                        nextStep();
                    }
                );
            }
        );

        Checkout.elements.previousButtons.forEach(
            function (button) {
                button.addEventListener(
                    "click",
                    function (event) {
                        event.preventDefault();
                        previousStep();
                    }
                );
            }
        );
    }

    function bindDeliveryEvents() {
        Checkout.elements.deliveryOptions.forEach(
            function (control) {
                control.addEventListener(
                    "click",
                    function () {
                        setDeliveryMethod(
                            control.dataset
                                .deliveryMethod ||
                            control.value
                        );
                    }
                );

                control.addEventListener(
                    "change",
                    function () {
                        if (
                            !control.type ||
                            control.checked
                        ) {
                            setDeliveryMethod(
                                control.dataset
                                    .deliveryMethod ||
                                control.value
                            );
                        }
                    }
                );
            }
        );
    }

    function bindPaymentEvents() {
        Checkout.elements.paymentOptions.forEach(
            function (control) {
                control.addEventListener(
                    "click",
                    function () {
                        setPaymentMethod(
                            control.dataset
                                .paymentMethod ||
                            control.value
                        );
                    }
                );

                control.addEventListener(
                    "change",
                    function () {
                        if (
                            !control.type ||
                            control.checked
                        ) {
                            setPaymentMethod(
                                control.dataset
                                    .paymentMethod ||
                                control.value
                            );
                        }
                    }
                );
            }
        );
    }

    function bindFormEvents() {
        if (Checkout.elements.form) {
            Checkout.elements.form.addEventListener(
                "input",
                function () {
                    collectFormState();
                }
            );

            Checkout.elements.form.addEventListener(
                "submit",
                function (event) {
                    event.preventDefault();
                    placeOrder();
                }
            );
        }

        if (Checkout.elements.billingToggle) {
            Checkout.elements.billingToggle.addEventListener(
                "change",
                function () {
                    Checkout.state.billingSameAsShipping =
                        Checkout.elements.billingToggle.checked;

                    updateBillingVisibility();
                    saveSession();
                }
            );
        }

        if (Checkout.elements.savedAddressSelect) {
            Checkout.elements.savedAddressSelect.addEventListener(
                "change",
                function () {
                    applySavedAddress(
                        Checkout.elements
                            .savedAddressSelect
                            .value
                    );
                }
            );
        }
    }

    function bindApplicationEvents() {
        document.addEventListener(
            "cart:change",
            function () {
                if (
                    router &&
                    router.currentRoute &&
                    router.currentRoute.route.name ===
                        "checkout"
                ) {
                    renderSummary();
                }
            }
        );

        document.addEventListener(
            "router:change",
            function (event) {
                const detail =
                    event.detail || {};

                if (
                    detail.name ===
                    "checkout"
                ) {
                    prepareCheckout().catch(
                        function (error) {
                            console.error(
                                "[Checkout] Preparation failed:",
                                error
                            );

                            app.showToast({
                                type: "error",
                                title:
                                    "Checkout unavailable",
                                message:
                                    "Checkout could not be prepared."
                            });
                        }
                    );
                }
            }
        );

        document.addEventListener(
            "auth:statechange",
            function (event) {
                const detail =
                    event.detail || {};

                Checkout.state.user =
                    detail.user || null;

                if (
                    detail.user &&
                    router &&
                    router.currentRoute &&
                    router.currentRoute.route.name ===
                        "checkout"
                ) {
                    prefillCustomer(
                        detail.user,
                        detail.profile || null
                    );

                    populateSavedAddresses(
                        detail.profile || null
                    );
                }
            }
        );
    }

    /* ======================================================
       INITIALIZATION
    ====================================================== */

    async function initialize() {
        if (Checkout.initialized) {
            return;
        }

        cacheElements();
        restoreSession();

        bindStepEvents();
        bindDeliveryEvents();
        bindPaymentEvents();
        bindFormEvents();
        bindApplicationEvents();

        Checkout.state.user =
            auth.currentUser;

        populateForm();
        renderSummary();

        Checkout.initialized = true;

        if (
            router &&
            router.currentRoute &&
            router.currentRoute.route.name ===
                "checkout"
        ) {
            await prepareCheckout();
        }

        document.dispatchEvent(
            new CustomEvent(
                "checkout:ready",
                {
                    detail: {
                        checkout: Checkout
                    }
                }
            )
        );

        console.info(
            "[Checkout] L'ÉTERNEL checkout initialized."
        );
    }

    /* ======================================================
       PUBLIC API
    ====================================================== */

    Checkout.init = initialize;

    Checkout.prepare = prepareCheckout;
    Checkout.placeOrder = placeOrder;

    Checkout.showStep = showStep;
    Checkout.nextStep = nextStep;
    Checkout.previousStep = previousStep;

    Checkout.setDeliveryMethod =
        setDeliveryMethod;

    Checkout.setPaymentMethod =
        setPaymentMethod;

    Checkout.calculateTotals =
        calculateTotals;

    Checkout.createOrderDraft =
        createOrderDraft;

    Checkout.renderSummary =
        renderSummary;

    Checkout.renderConfirmation =
        renderConfirmation;

    Checkout.initiatePayment =
        initiatePayment;

    Checkout.saveSession = saveSession;
    Checkout.clearSession = clearSession;

    window.LEternelCheckout =
        Checkout;

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
