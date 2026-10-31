import { PartnerList } from "@point_of_sale/app/screens/partner_list/partner_list";
import { patch } from "@web/core/utils/patch";
import { useEffect } from "@odoo/owl";
import { digitsOnly, isPhoneLike, phoneSearchDigits } from "./phone_utils";
import { ccaPartnerPhoneDigits } from "./res_partner";
import { setPendingPartnerPhone } from "./pos_store";

/** Odoo 19's searchable phone field (indexed, separators removed). */
const PHONE_SEARCH_FIELD = "phone_mobile_search";
/** `phone_mobile_search` refuses shorter values (phone_validation). */
const PHONE_SEARCH_MIN_LENGTH = 3;
/** Same cap as Odoo 19's own local search. */
const LOCAL_RESULT_LIMIT = 50;

patch(PartnerList.prototype, {
    setup() {
        super.setup(...arguments);
        this.state.ccaSearching = false;
        // Phone queries already answered by the server.
        this._ccaRemoteQueries = new Set();
        // The search input already debounces `state.query` (300 ms): react to
        // each settled query.
        useEffect(
            (query) => {
                this._ccaOnQueryChange(query);
            },
            () => [this.state.query]
        );
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
    /** Replaces Odoo's "No customers found" message while a query is typed. */
    get ccaShowEmptyState() {
        return Boolean(this.ccaQuery);
    },
    get ccaCanCreate() {
        return this.pos.cashier?._role !== "minimal";
    },

    //--------------------------------------------------------------------------
    // Local search
    //--------------------------------------------------------------------------

    /**
     * Standard results plus customers whose phone digits contain the typed
     * digits. Leading zeros are ignored, so "0500477818" also finds a number
     * saved as "+966500477818"; Arabic-Indic digits are converted.
     */
    getPartners(partners) {
        const standard = super.getPartners(...arguments);
        const query = this.ccaQuery;
        if (!isPhoneLike(query, 1)) {
            return standard;
        }
        const digits = phoneSearchDigits(query);
        const seen = new Set(standard.map((partner) => partner.id));
        const extra = partners.filter(
            (partner) =>
                !seen.has(partner.id) &&
                ccaPartnerPhoneDigits(partner).some((token) => token.includes(digits))
        );
        return [...standard, ...extra].slice(0, LOCAL_RESULT_LIMIT);
    },

    _ccaHasLocalMatch() {
        return (
            this.getPartners(this.state.initialPartners).length +
                this.getPartners(this.state.loadedPartners).length >
            0
        );
    },

    //--------------------------------------------------------------------------
    // Server search
    //--------------------------------------------------------------------------

    /**
     * A phone query with no local match is looked up on the server once: the
     * POS only loads the 100 most frequent customers by default, so most
     * customers are only found this way (without pressing Enter or scrolling).
     */
    async _ccaOnQueryChange(query) {
        query = (query || "").trim();
        if (!isPhoneLike(query) || this._ccaRemoteQueries.has(query) || this._ccaHasLocalMatch()) {
            return;
        }
        this._ccaRemoteQueries.add(query);
        this.state.ccaSearching = true;
        try {
            await this.getNewPartners();
        } finally {
            if (this.ccaQuery === query) {
                this.state.ccaSearching = false;
            }
        }
    },

    /**
     * Odoo 19 searches the fields of `_getSearchFields(query)` with the typed
     * text. For a phone-like query the phone field receives normalised digits
     * instead (Arabic-Indic digits converted, leading zeros removed), so a
     * number typed the local way finds the number stored internationally.
     * The other fields (barcode, VAT, ZIP...) keep the typed text.
     */
    _ccaGetPartnerSearchDomain(query) {
        if (!query) {
            return [];
        }
        const phoneLike = isPhoneLike(query, 1);
        // Arabic-Indic digits become 0-9 so Odoo recognises a numeric query
        const fields = this._getSearchFields(phoneLike ? digitsOnly(query) : query);
        const leaves = [];
        for (const field of fields) {
            if (field === PHONE_SEARCH_FIELD && phoneLike) {
                let digits = phoneSearchDigits(query);
                if (digits.length < PHONE_SEARCH_MIN_LENGTH) {
                    digits = digitsOnly(query);
                }
                if (digits.length >= PHONE_SEARCH_MIN_LENGTH) {
                    leaves.push([field, "ilike", digits]);
                }
            } else {
                leaves.push([field, "ilike", query]);
            }
        }
        if (!leaves.length) {
            return [];
        }
        return [...Array(leaves.length - 1).fill("|"), ...leaves];
    },

    /**
     * Same as Odoo 19 (offset per query, results added to the loaded customers),
     * with the domain of `_ccaGetPartnerSearchDomain`.
     */
    async getNewPartners() {
        const query = this.state.query;
        const offset = this.globalState.offsetBySearch[query] || 0;
        if (offset > this.loadedPartnerIds.size) {
            return [];
        }
        const domain = this._ccaGetPartnerSearchDomain((query || "").trim());
        try {
            this.state.loading = true;
            const result = await this.pos.data.callRelated("res.partner", "get_new_partner", [
                this.pos.config.id,
                domain,
                offset,
            ]);
            this.globalState.offsetBySearch[query] = offset + (result["res.partner"].length || 100);
            for (const partner of result["res.partner"]) {
                if (!this.loadedPartnerIds.has(partner.id)) {
                    this.loadedPartnerIds.add(partner.id);
                    this.state.loadedPartners.push(partner);
                }
            }
            return result["res.partner"];
        } catch (error) {
            // Best effort: offline or timeout must not interrupt the cashier.
            console.warn("pos_customer_create_advanced: customer search failed", error);
            return [];
        } finally {
            this.state.loading = false;
        }
    },

    //--------------------------------------------------------------------------
    // Creation
    //--------------------------------------------------------------------------

    /** New customer from a phone search: the contact form opens with that phone. */
    async editPartner(partner = false) {
        if (!partner) {
            setPendingPartnerPhone(this.ccaPhoneFromQuery);
        }
        return super.editPartner(...arguments);
    },
});
