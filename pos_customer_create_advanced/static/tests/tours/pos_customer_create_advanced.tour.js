odoo.define('pos_customer_create_advanced.tour', function (require) {
    'use strict';

    const { ProductScreen } = require('point_of_sale.tour.ProductScreenTourMethods');
    const { getSteps, startSteps } = require('point_of_sale.tour.utils');
    const Tour = require('web_tour.tour');

    const SEARCH_INPUT = '.partnerlist-screen .pos-search-bar input';
    const PARTNER_LINES = '.partnerlist-screen .partner-list-contents';
    const DETAILS = '.partnerlist-screen .partner-details-contents';
    const EMPTY_STATE = '.partnerlist-screen .o_cca_empty_state';

    //--------------------------------------------------------------------------
    // Step builders
    //--------------------------------------------------------------------------

    function openCustomerList() {
        return [
            { content: 'open the customer list', trigger: '.actionpad .set-partner' },
            { content: 'customer list is shown', trigger: '.partnerlist-screen .partner-list', run() {} },
        ];
    }

    /**
     * The search input listens to native `keyup` (Owl handler); the generic
     * tour "text" action only fires jQuery events, so dispatch a real one.
     */
    function search(query) {
        return [
            {
                content: `search customers for "${query}"`,
                trigger: SEARCH_INPUT,
                run() {
                    const input = document.querySelector(SEARCH_INPUT);
                    input.value = query;
                    input.dispatchEvent(new KeyboardEvent('keyup', { key: query.slice(-1), bubbles: true }));
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

    function inputValueIs(name, expected) {
        return [
            {
                content: `customer form field "${name}" is "${expected}"`,
                trigger: `${DETAILS} input[name="${name}"]`,
                run() {
                    const value = document.querySelector(`${DETAILS} input[name="${name}"]`).value;
                    if (value !== expected) {
                        throw new Error(`Field "${name}": expected "${expected}", got "${value}"`);
                    }
                },
            },
        ];
    }

    function typeInForm(name, value) {
        return [
            {
                content: `type "${value}" in customer field "${name}"`,
                trigger: `${DETAILS} input[name="${name}"]`,
                run: `text ${value}`,
            },
        ];
    }

    function clickTopCreate() {
        return [{ content: 'click Create', trigger: '.partnerlist-screen .top-content .button.new-customer' }];
    }

    function clickSave() {
        return [
            {
                content: 'click Save',
                trigger: '.partnerlist-screen .top-content .button.highlight:contains("Save")',
            },
        ];
    }

    function customerSetOnOrder(name) {
        return [
            {
                content: `"${name}" is the order customer`,
                trigger: `.actionpad .set-partner:contains("${name}")`,
                run() {},
            },
        ];
    }

    /**
     * Create a customer through JSON-RPC *after* the POS has loaded its
     * customers: it exists only on the server, so finding it proves the
     * automatic server lookup.
     */
    function createServerOnlyPartner(values) {
        return [
            {
                content: `create server-only customer "${values.name}"`,
                trigger: '.partnerlist-screen',
                run() {
                    fetch('/web/dataset/call_kw/res.partner/create', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            jsonrpc: '2.0',
                            method: 'call',
                            params: { model: 'res.partner', method: 'create', args: [values], kwargs: {} },
                        }),
                    })
                        .then((response) => response.json())
                        .then((payload) => {
                            if (payload.error) {
                                throw new Error(JSON.stringify(payload.error));
                            }
                            document.body.classList.add('o_cca_tour_remote_ready');
                        })
                        .catch((error) => console.error('pos_customer_create_advanced tour:', error));
                },
            },
            {
                content: 'server-only customer created',
                trigger: 'body.o_cca_tour_remote_ready .partnerlist-screen',
                run() {},
            },
        ];
    }

    function add(...stepLists) {
        // getSteps() returns the live array filled by startSteps/tour methods.
        getSteps().push(...stepLists.flat());
    }

    //--------------------------------------------------------------------------
    // 1. Substring phone search: local (formatting-insensitive) and server
    //--------------------------------------------------------------------------

    startSteps();
    ProductScreen.do.confirmOpeningPopup();
    add(
        openCustomerList(),
        // "+1 (555) 014-4567": the digits run across the dash
        search('0144567'),
        partnerListed('CCA Alpha Customer'),
        partnerNotListed('CCA Beta Customer'),
        // typed with separators
        search('014 45'),
        partnerListed('CCA Alpha Customer'),
        // sequence in the middle of the number, not the prefix
        search('456'),
        partnerListed('CCA Alpha Customer'),
        partnerNotListed('CCA Beta Customer'),
        // mobile field: "+966 50 999 8877"
        search('9998877'),
        partnerListed('CCA Beta Customer'),
        partnerNotListed('CCA Alpha Customer'),
        // not loaded in the POS: found by the automatic server lookup
        createServerOnlyPartner({ name: 'CCA Remote Customer', phone: '+44 7700 776-655' }),
        search('776655'),
        partnerListed('CCA Remote Customer')
    );
    Tour.register('PosCcaSubstringSearchTour', { test: true, url: '/pos/ui' }, getSteps());

    //--------------------------------------------------------------------------
    // 2. No result -> create from the empty state, phone pre-filled
    //--------------------------------------------------------------------------

    startSteps();
    ProductScreen.do.confirmOpeningPopup();
    add(
        openCustomerList(),
        search('0598765432'),
        emptyStateShown('0598765432'),
        [{ content: 'create from the empty state', trigger: `${EMPTY_STATE} .o_cca_create_from_search` }],
        inputValueIs('phone', '0598765432'),
        inputValueIs('name', '')
    );
    Tour.register('PosCcaPrefillTour', { test: true, url: '/pos/ui' }, getSteps());

    //--------------------------------------------------------------------------
    // 3. Default name injected on save (feature enabled on the POS)
    //--------------------------------------------------------------------------

    startSteps();
    ProductScreen.do.confirmOpeningPopup();
    add(
        // No name typed: the configured default name is used
        openCustomerList(),
        search('0551112233'),
        emptyStateShown('0551112233'),
        clickTopCreate(),
        inputValueIs('phone', '0551112233'),
        inputValueIs('name', ''),
        clickSave(),
        customerSetOnOrder('CCA Walk-in Customer'),
        // A typed name always wins over the default name
        openCustomerList(),
        search('0552223344'),
        emptyStateShown('0552223344'),
        clickTopCreate(),
        inputValueIs('phone', '0552223344'),
        typeInForm('name', 'CCA Named Customer'),
        clickSave(),
        customerSetOnOrder('CCA Named Customer')
    );
    Tour.register('PosCcaDefaultNameTour', { test: true, url: '/pos/ui' }, getSteps());

    //--------------------------------------------------------------------------
    // 4. Feature disabled: standard "name required" behaviour is kept
    //--------------------------------------------------------------------------

    startSteps();
    ProductScreen.do.confirmOpeningPopup();
    add(
        openCustomerList(),
        search('0553334455'),
        emptyStateShown('0553334455'),
        clickTopCreate(),
        inputValueIs('phone', '0553334455'),
        clickSave(),
        [
            {
                content: 'name required error is shown',
                trigger: '.popup-error:contains("A Customer Name Is Required")',
                run() {},
            },
            { content: 'close the error', trigger: '.popup-error .button.cancel' },
            { content: 'still on the customer form', trigger: `${DETAILS} input[name="phone"]`, run() {} },
        ]
    );
    Tour.register('PosCcaDefaultNameDisabledTour', { test: true, url: '/pos/ui' }, getSteps());

    //--------------------------------------------------------------------------
    // 5. Saudi company: 0500477818 is saved as +966500477818 and is still
    //    found when the cashier types it the local way
    //--------------------------------------------------------------------------

    startSteps();
    ProductScreen.do.confirmOpeningPopup();
    add(
        openCustomerList(),
        search('0500477818'),
        emptyStateShown('0500477818'),
        clickTopCreate(),
        inputValueIs('phone', '0500477818'),
        typeInForm('name', 'CCA Saudi Customer'),
        clickSave(),
        customerSetOnOrder('CCA Saudi Customer'),
        openCustomerList(),
        search('0500477818'),
        partnerListed('CCA Saudi Customer'),
        [
            {
                content: 'phone shown in international format',
                trigger: `${PARTNER_LINES} .partner-line:contains("CCA Saudi Customer") .partner-line-email:contains("+966500477818")`,
                run() {},
            },
        ]
    );
    Tour.register('PosCcaPhoneE164Tour', { test: true, url: '/pos/ui' }, getSteps());
});
