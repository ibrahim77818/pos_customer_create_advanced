import * as Chrome from "@point_of_sale/../tests/pos/tours/utils/chrome_util";
import * as Dialog from "@point_of_sale/../tests/generic_helpers/dialog_util";
import { registry } from "@web/core/registry";

// Odoo 19: the customer list is a dialog; customers are created in the
// standard contact form, opened in a second dialog.
const LIST = ".modal .partner-list";
const SEARCH_INPUT = ".modal-header .input-group input";
const EMPTY_STATE = ".modal .o_cca_empty_state";
const FORM = ".modal .o_form_view";
const PHONE_INPUT = `${FORM} .o_field_widget[name="phone"] input`;
// Odoo 19: partner_autocomplete (a POS dependency) renders the name as an <input>
const NAME_INPUT = `${FORM} .o_field_widget[name="name"] input, ${FORM} .o_field_widget[name="name"] textarea`;

//------------------------------------------------------------------------------
// Step builders
//------------------------------------------------------------------------------

function openCustomerList() {
    return [
        {
            content: "open the customer list",
            trigger: ".product-screen .set-partner",
            run: "click",
        },
        { content: "customer list is shown", trigger: LIST },
    ];
}

/** The search input debounces `state.query` by 500 ms; later steps wait for the result. */
function search(query) {
    return [{ content: `search customers for "${query}"`, trigger: SEARCH_INPUT, run: `edit ${query}` }];
}

function partnerListed(name) {
    return [{ content: `"${name}" is listed`, trigger: `${LIST} .partner-info:contains("${name}")` }];
}

/** Use right after a partnerListed() step of the same search (same render). */
function partnerNotListed(name) {
    return [
        {
            content: `"${name}" is not listed`,
            trigger: `${LIST}:not(:has(.partner-info:contains("${name}")))`,
        },
    ];
}

function emptyStateShown(phone) {
    return [
        {
            content: `empty state offers to create a customer with phone ${phone}`,
            trigger: `${EMPTY_STATE} .o_cca_create_from_search .o_cca_phone:contains("${phone}")`,
        },
    ];
}

function clickCreateFromEmptyState() {
    return [{ content: "create from the empty state", trigger: `${EMPTY_STATE} .o_cca_create_from_search`, run: "click" }];
}

function clickHeaderCreate() {
    return [
        {
            content: "click Create in the customer list",
            trigger: '.modal-header button:contains("Create")',
            run: "click",
        },
    ];
}

function inputValueIs(selector, expected) {
    return [
        {
            content: `${selector} is "${expected}"`,
            trigger: selector,
            run() {
                const value = document.querySelector(selector).value;
                if (value !== expected) {
                    throw new Error(`${selector}: expected "${expected}", got "${value}"`);
                }
            },
        },
    ];
}

function typeName(value) {
    return [{ content: `type customer name "${value}"`, trigger: NAME_INPUT, run: `edit ${value}` }];
}

function clickFormSave() {
    return [{ content: "save the customer", trigger: ".modal .o_form_button_save", run: "click" }];
}

function customerSetOnOrder(name) {
    return [
        { content: "dialogs are closed", trigger: "body:not(:has(.modal))" },
        {
            content: `"${name}" is the order customer`,
            trigger: `.product-screen .set-partner:contains("${name}")`,
        },
    ];
}

/**
 * Create a customer through JSON-RPC *after* the POS has loaded its customers:
 * it exists only on the server, so finding it proves the automatic server
 * lookup. Runs as the tour user (the cashier).
 */
function createServerOnlyPartner(values) {
    return [
        {
            content: `create server-only customer "${values.name}"`,
            trigger: LIST,
            async run() {
                const response = await fetch("/web/dataset/call_kw/res.partner/create", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        jsonrpc: "2.0",
                        method: "call",
                        params: { model: "res.partner", method: "create", args: [values], kwargs: {} },
                    }),
                });
                const payload = await response.json();
                if (payload.error) {
                    throw new Error(JSON.stringify(payload.error));
                }
            },
        },
    ];
}

function registerTour(name, steps) {
    registry.category("web_tour.tours").add(name, {
        steps: () => [Chrome.startPoS(), Dialog.confirm("Open Register"), ...steps()].flat(),
    });
}

//------------------------------------------------------------------------------
// 1. Substring phone search: local (formatting-insensitive) and server
//------------------------------------------------------------------------------

registerTour("PosCcaSubstringSearchTour", () => [
    openCustomerList(),
    // "+1 (555) 014-4567": the digits run across the dash
    search("0144567"),
    partnerListed("CCA Alpha Customer"),
    partnerNotListed("CCA Beta Customer"),
    // typed with separators
    search("014 45"),
    partnerListed("CCA Alpha Customer"),
    // sequence in the middle of the number, not the prefix
    search("456"),
    partnerListed("CCA Alpha Customer"),
    partnerNotListed("CCA Beta Customer"),
    // "+966 50 999 8877"
    search("9998877"),
    partnerListed("CCA Beta Customer"),
    partnerNotListed("CCA Alpha Customer"),
    // dots are not stripped by the POS itself: "050.123.9999"
    search("0501239999"),
    partnerListed("CCA Gamma Customer"),
    // not loaded in the POS: found by the automatic server lookup
    createServerOnlyPartner({ name: "CCA Remote Customer", phone: "+44 7700 776-655" }),
    search("776655"),
    partnerListed("CCA Remote Customer"),
]);

//------------------------------------------------------------------------------
// 2. No result -> create from the empty state, phone pre-filled
//------------------------------------------------------------------------------

registerTour("PosCcaPrefillTour", () => [
    openCustomerList(),
    search("0598765432"),
    emptyStateShown("0598765432"),
    clickCreateFromEmptyState(),
    inputValueIs(PHONE_INPUT, "0598765432"),
    inputValueIs(NAME_INPUT, ""),
    { content: "discard the form", trigger: ".modal .o_form_button_cancel", run: "click" },
]);

//------------------------------------------------------------------------------
// 3. Default name injected on save (feature enabled on the POS)
//------------------------------------------------------------------------------

registerTour("PosCcaDefaultNameTour", () => [
    // No name typed: the configured default name is used
    openCustomerList(),
    search("0551112233"),
    emptyStateShown("0551112233"),
    clickHeaderCreate(),
    inputValueIs(PHONE_INPUT, "0551112233"),
    {
        content: "hint shows the default name",
        trigger: `${FORM} .o_cca_name_hint:contains("CCA Walk-in Customer")`,
    },
    clickFormSave(),
    customerSetOnOrder("CCA Walk-in Customer"),
    // A typed name always wins over the default name
    openCustomerList(),
    search("0552223344"),
    emptyStateShown("0552223344"),
    clickHeaderCreate(),
    inputValueIs(PHONE_INPUT, "0552223344"),
    typeName("CCA Named Customer"),
    clickFormSave(),
    customerSetOnOrder("CCA Named Customer"),
]);

//------------------------------------------------------------------------------
// 4. Feature disabled: standard "name required" behaviour is kept
//------------------------------------------------------------------------------

registerTour("PosCcaDefaultNameDisabledTour", () => [
    openCustomerList(),
    search("0553334455"),
    emptyStateShown("0553334455"),
    clickHeaderCreate(),
    inputValueIs(PHONE_INPUT, "0553334455"),
    { content: "no default name hint", trigger: `${FORM}:not(:has(.o_cca_name_hint:visible))` },
    clickFormSave(),
    {
        content: "the name is required",
        trigger: `${FORM} .o_field_widget[name="name"].o_field_invalid`,
    },
    { content: "discard the form", trigger: ".modal .o_form_button_cancel", run: "click" },
]);

//------------------------------------------------------------------------------
// 5. Saudi company: 0500477818 is saved as +966500477818 and is still found
//    when the cashier types it the local way
//------------------------------------------------------------------------------

registerTour("PosCcaPhoneE164Tour", () => [
    openCustomerList(),
    search("0500477818"),
    emptyStateShown("0500477818"),
    clickHeaderCreate(),
    typeName("CCA Saudi Customer"),
    clickFormSave(),
    customerSetOnOrder("CCA Saudi Customer"),
    openCustomerList(),
    search("0500477818"),
    partnerListed("CCA Saudi Customer"),
    {
        content: "phone shown in international format",
        trigger: `${LIST} .partner-info:contains("CCA Saudi Customer") .partner-line-email:contains("+966500477818")`,
    },
]);
