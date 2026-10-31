/** @odoo-module */

import * as ProductScreen from "@point_of_sale/../tests/tours/helpers/ProductScreenTourMethods";
import { registry } from "@web/core/registry";

const SEARCH_INPUT = ".partnerlist-screen .pos-search-bar input";
const PARTNER_LINES = ".partnerlist-screen .partner-list-contents";
const DETAILS = ".partnerlist-screen .partner-details";
const EMPTY_STATE = ".partnerlist-screen .o_cca_empty_state";
// Odoo 17 names the customer form inputs after their label ("Phone", "Mobile")
const PHONE_INPUT = `${DETAILS} input[name="Phone"]`;
const NAME_INPUT = `${DETAILS} input[name="name"]`;

//------------------------------------------------------------------------------
// Step builders
//------------------------------------------------------------------------------

function openCustomerList() {
    return [
        ProductScreen.clickPartnerButton(),
        { content: "customer list is shown", trigger: ".partnerlist-screen .partner-list", run() {} },
    ].flat();
}

/**
 * The search input listens to native `keyup` (Owl handler); the generic tour
 * "text" action only fires jQuery events, so dispatch a real one.
 */
function search(query) {
    return [
        {
            content: `search customers for "${query}"`,
            trigger: SEARCH_INPUT,
            run() {
                const input = document.querySelector(SEARCH_INPUT);
                input.value = query;
                input.dispatchEvent(new KeyboardEvent("keyup", { key: query.slice(-1), bubbles: true }));
            },
        },
    ];
}

function partnerListed(name) {
    return [
        {
            content: `"${name}" is listed`,
            trigger: `${PARTNER_LINES} .partner-line:contains("${name}")`,
            run() {},
        },
    ];
}

/** Use right after a partnerListed() step of the same search (same render). */
function partnerNotListed(name) {
    return [
        {
            content: `"${name}" is not listed`,
            trigger: `${PARTNER_LINES}:not(:has(.partner-line:contains("${name}")))`,
            run() {},
        },
    ];
}

function emptyStateShown(phone) {
    return [
        {
            content: `empty state offers to create a customer with phone ${phone}`,
            trigger: `${EMPTY_STATE} .o_cca_create_from_search .o_cca_phone:contains("${phone}")`,
            run() {},
        },
    ];
}

function inputValueIs(selector, expected) {
    return [
        {
            content: `customer form field ${selector} is "${expected}"`,
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
    return [{ content: `type customer name "${value}"`, trigger: NAME_INPUT, run: `text ${value}` }];
}

function clickTopCreate() {
    return [{ content: "click Create", trigger: ".partnerlist-screen .top-content .button.new-customer" }];
}

function clickSave() {
    return [
        {
            content: "click Save",
            trigger: '.partnerlist-screen .top-content .button.highlight:contains("Save")',
        },
    ];
}

function customerSetOnOrder(name) {
    return [
        {
            content: `"${name}" is the order customer`,
            trigger: `.product-screen .set-partner:contains("${name}")`,
            run() {},
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
            trigger: ".partnerlist-screen",
            run() {
                fetch("/web/dataset/call_kw/res.partner/create", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        jsonrpc: "2.0",
                        method: "call",
                        params: { model: "res.partner", method: "create", args: [values], kwargs: {} },
                    }),
                })
                    .then((response) => response.json())
                    .then((payload) => {
                        if (payload.error) {
                            throw new Error(JSON.stringify(payload.error));
                        }
                        document.body.classList.add("o_cca_tour_remote_ready");
                    })
                    .catch((error) => console.error("pos_customer_create_advanced tour:", error));
            },
        },
        {
            content: "server-only customer created",
            trigger: "body.o_cca_tour_remote_ready .partnerlist-screen",
            run() {},
        },
    ];
}

function registerTour(name, steps) {
    registry.category("web_tour.tours").add(name, {
        test: true,
        url: "/pos/ui",
        steps: () => [ProductScreen.confirmOpeningPopup(), ...steps()].flat(),
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
    // mobile field: "+966 50 999 8877"
    search("9998877"),
    partnerListed("CCA Beta Customer"),
    partnerNotListed("CCA Alpha Customer"),
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
    { content: "create from the empty state", trigger: `${EMPTY_STATE} .o_cca_create_from_search` },
    inputValueIs(PHONE_INPUT, "0598765432"),
    inputValueIs(NAME_INPUT, ""),
]);

//------------------------------------------------------------------------------
// 3. Default name injected on save (feature enabled on the POS)
//------------------------------------------------------------------------------

registerTour("PosCcaDefaultNameTour", () => [
    // No name typed: the configured default name is used
    openCustomerList(),
    search("0551112233"),
    emptyStateShown("0551112233"),
    clickTopCreate(),
    inputValueIs(PHONE_INPUT, "0551112233"),
    inputValueIs(NAME_INPUT, ""),
    {
        content: "hint shows the default name",
        trigger: `${DETAILS} .o_cca_name_hint:contains("CCA Walk-in Customer")`,
        run() {},
    },
    clickSave(),
    customerSetOnOrder("CCA Walk-in Customer"),
    // A typed name always wins over the default name
    openCustomerList(),
    search("0552223344"),
    emptyStateShown("0552223344"),
    clickTopCreate(),
    inputValueIs(PHONE_INPUT, "0552223344"),
    typeName("CCA Named Customer"),
    clickSave(),
    customerSetOnOrder("CCA Named Customer"),
]);

//------------------------------------------------------------------------------
// 4. Feature disabled: standard "name required" behaviour is kept
//------------------------------------------------------------------------------

registerTour("PosCcaDefaultNameDisabledTour", () => [
    openCustomerList(),
    search("0553334455"),
    emptyStateShown("0553334455"),
    clickTopCreate(),
    inputValueIs(PHONE_INPUT, "0553334455"),
    { content: "no default name hint", trigger: `${DETAILS}:not(:has(.o_cca_name_hint))`, run() {} },
    clickSave(),
    {
        content: "name required error is shown",
        trigger: '.popup-error:contains("A Customer Name Is Required")',
        run() {},
    },
    { content: "close the error", trigger: ".popup-error .button.cancel" },
    { content: "still on the customer form", trigger: PHONE_INPUT, run() {} },
]);

//------------------------------------------------------------------------------
// 5. Saudi company: 0500477818 is saved as +966500477818 and is still found
//    when the cashier types it the local way
//------------------------------------------------------------------------------

registerTour("PosCcaPhoneE164Tour", () => [
    openCustomerList(),
    search("0500477818"),
    emptyStateShown("0500477818"),
    clickTopCreate(),
    inputValueIs(PHONE_INPUT, "0500477818"),
    typeName("CCA Saudi Customer"),
    clickSave(),
    customerSetOnOrder("CCA Saudi Customer"),
    openCustomerList(),
    search("0500477818"),
    partnerListed("CCA Saudi Customer"),
    {
        content: "phone shown in international format",
        trigger: `${PARTNER_LINES} .partner-line:contains("CCA Saudi Customer") .partner-line-email:contains("+966500477818")`,
        run() {},
    },
]);
