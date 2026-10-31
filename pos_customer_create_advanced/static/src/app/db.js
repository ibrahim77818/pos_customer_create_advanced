/** @odoo-module */

import { PosDB } from "@point_of_sale/app/store/db";
import { patch } from "@web/core/utils/patch";
import { toRaw } from "@odoo/owl";
import { digitsOnly, isPhoneLike, phoneSearchDigits } from "./phone_utils";

/*
 * `env.pos.db` is reached through the reactive POS store, and
 * `search_partner` runs while the customer list renders: anything written on
 * the db object during a search would schedule a new render (endless loop).
 * `patch()` uses native `super` and writes nothing on the instance; the
 * result cache below lives outside the object, keyed on the raw db.
 */
const CACHE_SIZE = 20;
const searchCache = new WeakMap();

function cacheFor(db) {
    const raw = toRaw(db);
    let cache = searchCache.get(raw);
    if (!cache) {
        cache = new Map();
        searchCache.set(raw, cache);
    }
    return cache;
}

patch(PosDB.prototype, {
    /**
     * The standard search string only strips spaces from phone numbers, so
     * "+1 (555) 014-4567" is indexed as "+1(555)014-4567" and "0144567"
     * cannot match. Append a digits-only token for phone and mobile so a
     * digit sequence matches anywhere in the number, whatever its format.
     */
    _partner_search_string(partner) {
        const str = super._partner_search_string(...arguments);
        const tokens = [partner.phone, partner.mobile].map(digitsOnly).filter(Boolean);
        if (!tokens.length) {
            return str;
        }
        return str.replace(/\n$/, "") + "|" + tokens.join("|") + "\n";
    },

    add_partners() {
        const result = super.add_partners(...arguments);
        cacheFor(this).clear();
        return result;
    },

    /**
     * A phone-like query ("050 123", "+966-50", "(555) 01") is reduced to
     * its digits, without leading zeros, so it matches the digits-only tokens
     * above whether the number was saved nationally or with its country
     * code. Other queries keep the standard behaviour. Results are cached
     * until customers are added or updated; callers get a copy because they
     * sort it in place.
     */
    search_partner(query) {
        if (isPhoneLike(query, 1)) {
            query = phoneSearchDigits(query);
        }
        const cache = cacheFor(this);
        let results = cache.get(query);
        if (!results) {
            results = super.search_partner(query);
            if (cache.size >= CACHE_SIZE) {
                cache.delete(cache.keys().next().value);
            }
            cache.set(query, results);
        }
        return results.slice();
    },
});
