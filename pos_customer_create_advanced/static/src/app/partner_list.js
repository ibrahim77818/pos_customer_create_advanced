import { PartnerList } from "@point_of_sale/app/screens/partner_list/partner_list";
import { patch } from "@web/core/utils/patch";
import { useEffect } from "@odoo/owl";
import { isPhoneLike, phoneSearchDigits } from "./phone_utils";
import { ccaPartnerPhoneDigits } from "./res_partner";
import { setPendingPartnerPhone } from "./pos_store";

/** Stored, trigram-indexed digits of phone and mobile on res.partner. */
const PHONE_DIGITS_FIELD = "pos_phone_digits";
/**
 * `like`, not `ilike`: digits have no case, and Odoo 18 wraps every `ilike` in
 * `unaccent()` when the database has that extension, which the trigram index
 * cannot serve.
 */
const PHONE_DIGITS_OPERATOR = "like";
const SERVER_SEARCH_LIMIT = 30;
const LOCAL_RESULT_LIMIT = 200;

patch(PartnerList.prototype, {
    setup() {
        super.setup(...arguments);
        this.state.ccaSearching = false;
        // Phone queries already answered by the server.
        this._ccaRemoteQueries = new Set();
        this._ccaLookupSeq = 0;
        // The search input already debounces `state.query` (500 ms): react to
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
    get ccaShowEmptyState() {
        return Boolean(this.ccaQuery) && this.getPartners().length === 0;
    },

    //--------------------------------------------------------------------------
    // Local search
    //--------------------------------------------------------------------------

    /**
     * Standard results plus customers whose phone or mobile digits contain the
     * typed digits. Leading zeros are ignored, so "0500477818" also finds a
     * number saved as "+966500477818"; Arabic-Indic digits are converted.
     */
    getPartners() {
        const standard = super.getPartners(...arguments);
        const query = this.ccaQuery;
        if (!isPhoneLike(query, 1)) {
            return standard;
        }
        const digits = phoneSearchDigits(query);
        const seen = new Set(standard.map((partner) => partner.id));
        const extra = this.pos.models["res.partner"]
            .getAll()
            .filter(
                (partner) =>
                    !seen.has(partner.id) &&
                    ccaPartnerPhoneDigits(partner).some((token) => token.includes(digits))
            );
        return [...standard, ...extra].slice(0, LOCAL_RESULT_LIMIT);
    },

    //--------------------------------------------------------------------------
    // Server search
    //--------------------------------------------------------------------------

    /**
     * A phone query with no local match is looked up on the server once: by
     * default Odoo 18 only loads the 100 most frequent customers in the POS,
     * so most customers are only found this way (without "Search more").
     */
    _ccaOnQueryChange(query) {
        query = (query || "").trim();
        if (!isPhoneLike(query) || this._ccaRemoteQueries.has(query) || this.getPartners().length) {
            this.state.ccaSearching = false;
            return;
        }
        this._ccaRemoteLookup(query);
    },

    async _ccaRemoteLookup(query) {
        const seq = ++this._ccaLookupSeq;
        this.state.ccaSearching = true;
        try {
            // records are added to the POS models, which re-renders the list
            await this._ccaFetchPartners(query, 0);
            this._ccaRemoteQueries.add(query);
        } catch (error) {
            // Best effort: offline or timeout must not interrupt the cashier.
            console.warn("pos_customer_create_advanced: server customer lookup failed", error);
        } finally {
            if (seq === this._ccaLookupSeq) {
                this.state.ccaSearching = false;
            }
        }
    },

    /**
     * Server domain. A phone-like query only searches the indexed digits field
     * (one indexed condition, milliseconds on large customer tables). Other
     * queries keep the standard Odoo 18 fields, matched anywhere in the value.
     */
    _ccaGetPartnerSearchDomain(query) {
        if (!query) {
            return [];
        }
        if (isPhoneLike(query, 1)) {
            return [[PHONE_DIGITS_FIELD, PHONE_DIGITS_OPERATOR, phoneSearchDigits(query)]];
        }
        const searchFields = [
            "name",
            "parent_name",
            ...this.getPhoneSearchTerms(),
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
        return this.pos.data.searchRead("res.partner", this._ccaGetPartnerSearchDomain(query), [], {
            limit: SERVER_SEARCH_LIMIT,
            offset,
        });
    },

    /** Standard "Search more" / Enter: same call as core, only the domain differs. */
    async getNewPartners() {
        return this._ccaFetchPartners(this.ccaQuery, this.state.currentOffset);
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
