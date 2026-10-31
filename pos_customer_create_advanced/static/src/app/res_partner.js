import { ResPartner } from "@point_of_sale/app/models/res_partner";
import { patch } from "@web/core/utils/patch";
import { toRaw } from "@odoo/owl";
import { digitsOnly } from "./phone_utils";

/*
 * Digits of phone and mobile, cached per customer record. Odoo 18 records are
 * reactive and read while the customer list renders: nothing is written on
 * the record itself (a write during render schedules another render).
 */
const digitsCache = new WeakMap();

export function ccaPartnerPhoneDigits(partner) {
    const raw = toRaw(partner);
    const key = `${raw.phone || ""}\u0001${raw.mobile || ""}`;
    let entry = digitsCache.get(raw);
    if (!entry || entry.key !== key) {
        entry = { key, tokens: [raw.phone, raw.mobile].map(digitsOnly).filter(Boolean) };
        digitsCache.set(raw, entry);
    }
    return entry.tokens;
}

patch(ResPartner.prototype, {
    /**
     * Odoo 18 strips "+", spaces, brackets and dashes from phone numbers in
     * the search string, but not dots, slashes or Arabic-Indic digits.
     * Append the plain ASCII digits of phone and mobile so any digit sequence
     * matches, whatever the stored format.
     */
    get searchString() {
        const tokens = ccaPartnerPhoneDigits(this);
        const base = super.searchString;
        return tokens.length ? `${base} ${tokens.join(" ")}` : base;
    },
});
