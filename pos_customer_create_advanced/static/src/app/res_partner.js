import { ResPartner } from "@point_of_sale/app/models/res_partner";
import { patch } from "@web/core/utils/patch";
import { toRaw } from "@odoo/owl";
import { digitsOnly } from "./phone_utils";

/*
 * Digits of the phone, cached per customer record. POS records are
 * reactive and read while the customer list renders: nothing is written on
 * the record itself (a write during render schedules another render).
 */
const digitsCache = new WeakMap();

export function ccaPartnerPhoneDigits(partner) {
    const raw = toRaw(partner);
    const key = raw.phone || "";
    let entry = digitsCache.get(raw);
    if (!entry || entry.key !== key) {
        // Odoo 19 removed `mobile` from contacts: `phone` is the only number
        entry = { key, tokens: [raw.phone].map(digitsOnly).filter(Boolean) };
        digitsCache.set(raw, entry);
    }
    return entry.tokens;
}

patch(ResPartner.prototype, {
    /**
     * Odoo 19 strips "+", spaces, brackets and dashes from the phone in the
     * search string, but not dots, slashes or Arabic-Indic digits. Append the
     * plain ASCII digits of the phone so any digit sequence matches, whatever
     * the stored format.
     */
    get searchString() {
        const tokens = ccaPartnerPhoneDigits(this);
        const base = super.searchString;
        return tokens.length ? `${base} ${tokens.join(" ")}` : base;
    },
});
