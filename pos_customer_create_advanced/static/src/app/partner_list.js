/** @odoo-module */

import { PartnerListScreen } from "@point_of_sale/app/screens/partner_list/partner_list";
import { patch } from "@web/core/utils/patch";
import { debounce } from "@web/core/utils/timing";
import { onWillUnmount } from "@odoo/owl";
import { isPhoneLike, phoneSearchDigits } from "./phone_utils";

/** Stored, trigram-indexed digits of phone and mobile on res.partner. */
const PHONE_DIGITS_FIELD = "pos_phone_digits";
const SERVER_SEARCH_LIMIT = 30;
/** Wait for the cashier to pause typing before asking the server. */
const REMOTE_LOOKUP_DELAY = 300;

patch(PartnerListScreen.prototype, {
    setup() {
        super.setup(...arguments);
        this.state.ccaSearching = false;
        // Phone queries already answered by the server.
        this._ccaRemoteQueries = new Set();
        this._ccaLookupSeq = 0;
        this._ccaScheduleLookup = debounce(this._ccaRemoteLookup.bind(this), REMOTE_LOOKUP_DELAY);
        onWillUnmount(() => this._ccaScheduleLookup.cancel());
    },

    //--------------------------------------------------------------------------
    // Getters
    //--------------------------------------------------------------------------

    get ccaQuery() {
        return (this.state.query || "").trim();
    },
    /** The typed query when it looks like a phone number, else false. */
    get ccaPhoneFromQuery() {
        const query = this.ccaQuery;
        return isPhoneLike(query) ? query : false;
    },
    get ccaHasLocalMatch() {
        const query = this.ccaQuery;
        // search_partner is cached: no extra scan for the same query.
        return !query || this.pos.db.search_partner(query).length > 0;
    },
    get ccaShowEmptyState() {
        return !this.state.detailIsShown && Boolean(this.ccaQuery) && !this.ccaHasLocalMatch;
    },

    //--------------------------------------------------------------------------
    // Search
    //--------------------------------------------------------------------------

    /**
     * Debounced by the base `setup` (70 ms). A phone query without a local
     * match is then looked up on the server once the cashier pauses typing:
     * Odoo 17 only loads the 100 most frequent customers in the POS, so most
     * customers are only found this way (without pressing "Search more").
     */
    async updatePartnerList(event) {
        await super.updatePartnerList(...arguments);
        const query = this.ccaQuery;
        if (!isPhoneLike(query) || this._ccaRemoteQueries.has(query) || this.ccaHasLocalMatch) {
            this._ccaScheduleLookup.cancel();
            this.state.ccaSearching = false;
            return;
        }
        this.state.ccaSearching = true;
        this._ccaScheduleLookup(query);
    },

    /**
     * One request per pause in typing. Responses for an older query are still
     * added to the local customers but no longer drive the screen.
     * Independent of the "Search more" paging state.
     */
    async _ccaRemoteLookup(query) {
        if (query !== this.ccaQuery) {
            return;
        }
        const seq = ++this._ccaLookupSeq;
        try {
            const partners = await this._ccaFetchPartners(query, 0);
            this.pos.addPartners(partners);
            this._ccaRemoteQueries.add(query);
        } catch (error) {
            // Best effort: offline or timeout must not interrupt the cashier;
            // the query can be retried by typing or "Search more".
            console.warn("pos_customer_create_advanced: server customer lookup failed", error);
        } finally {
            if (seq === this._ccaLookupSeq) {
                this.state.ccaSearching = false;
            }
        }
    },

    /**
     * Server domain. A phone-like query only searches the indexed digits
     * field: one indexed condition, answered in milliseconds on large
     * customer tables (an OR with `ilike` on other fields would force a scan
     * of the whole table). Other queries keep the standard Odoo 17 fields,
     * matched anywhere in the value instead of only as a prefix.
     */
    _ccaGetPartnerSearchDomain(query) {
        if (!query) {
            return [];
        }
        if (isPhoneLike(query, 1)) {
            return [[PHONE_DIGITS_FIELD, "ilike", phoneSearchDigits(query)]];
        }
        const searchFields = [
            "name",
            "parent_name",
            ...this.pos.getPhoneSearchFields(),
            "email",
            "barcode",
            "street",
            "zip",
            "city",
            "state_id",
            "country_id",
            "vat",
        ];
        return [
            ...Array(searchFields.length - 1).fill("|"),
            ...searchFields.map((field) => [field, "ilike", query]),
        ];
    },

    _ccaFetchPartners(query, offset) {
        return this.orm.silent.call("pos.session", "get_pos_ui_res_partner_by_params", [
            [odoo.pos_session_id],
            {
                domain: this._ccaGetPartnerSearchDomain(query),
                limit: SERVER_SEARCH_LIMIT,
                offset: offset,
            },
        ]);
    },

    /**
     * Standard "Search more" / Enter: same RPC as core, only the domain
     * differs (core builds a prefix pattern inline, with no hook).
     */
    async getNewPartners() {
        return this._ccaFetchPartners(this.ccaQuery, this.state.currentOffset);
    },

    //--------------------------------------------------------------------------
    // Creation
    //--------------------------------------------------------------------------

    /** Open the standard creation form with the searched phone filled in. */
    createPartner() {
        const phone = this.ccaPhoneFromQuery;
        super.createPartner(...arguments);
        const partner = this.state.editModeProps.partner;
        if (phone && partner && !partner.id) {
            partner.phone = phone;
        }
    },

    /**
     * Tell the server which POS saves the customer, so its options
     * (international phone format) apply. `res.partner.create_from_ui`
     * removes this key before writing the customer.
     */
    async saveChanges(processedChanges) {
        if (processedChanges) {
            processedChanges.pos_config_id = this.pos.config.id;
        }
        return super.saveChanges(...arguments);
    },
});
