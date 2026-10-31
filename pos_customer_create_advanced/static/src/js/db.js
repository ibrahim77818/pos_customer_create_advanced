odoo.define('pos_customer_create_advanced.db', function (require) {
    'use strict';

    const PosDB = require('point_of_sale.DB');
    const { digitsOnly, phoneSearchDigits, isPhoneLike } = require('pos_customer_create_advanced.phone_utils');

    const { toRaw } = owl;

    /*
     * IMPORTANT: do not use `PosDB.include()` and never write on `this` in
     * `search_partner`.
     *
     * In Odoo 16 `env.pos.db` is reached through an Owl reactive proxy.
     * `search_partner` runs while the customer list renders; any write on the
     * db object during that render schedules another render, which searches
     * again: an endless loop that freezes the browser. Legacy `include()`
     * writes `this._super` on every call, so plain prototype wrappers are used,
     * and the cache below lives outside the object (WeakMap on the raw db).
     */
    const proto = PosDB.prototype;
    const _partnerSearchString = proto._partner_search_string;
    const _searchPartner = proto.search_partner;
    const _addPartners = proto.add_partners;

    /**
     * Last results per query, per db. A render of the customer list asks for
     * the same query several times (list, empty state, lookup decision); a
     * query with no local match scans every loaded customer, so it is done
     * once per keystroke instead of once per caller.
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

    /**
     * The standard search string only strips spaces from phone numbers, so
     * "+1 (555) 014-4567" is indexed as "+1(555)014-4567" and "0144567"
     * cannot match. Append a digits-only token for phone and mobile so a
     * digit sequence matches anywhere in the number, whatever its format.
     */
    proto._partner_search_string = function (partner) {
        const str = _partnerSearchString.apply(this, arguments);
        const tokens = [partner.phone, partner.mobile].map(digitsOnly).filter(Boolean);
        if (!tokens.length) {
            return str;
        }
        return str.replace(/\n$/, '') + '|' + tokens.join('|') + '\n';
    };

    proto.add_partners = function () {
        const result = _addPartners.apply(this, arguments);
        cacheFor(this).clear();
        return result;
    };

    /**
     * A phone-like query ("050 123", "+966-50", "(555) 01") is reduced to
     * its digits, without leading zeros, so it matches the digits-only tokens
     * above whether the number was saved nationally or with its country
     * code. Any other
     * query keeps the standard behaviour. Results are cached until customers
     * are added or updated; callers get a copy because they sort it in place.
     */
    proto.search_partner = function (query) {
        if (isPhoneLike(query, 1)) {
            query = phoneSearchDigits(query);
        }
        const cache = cacheFor(this);
        let results = cache.get(query);
        if (!results) {
            results = _searchPartner.call(this, query);
            if (cache.size >= CACHE_SIZE) {
                cache.delete(cache.keys().next().value);
            }
            cache.set(query, results);
        }
        return results.slice();
    };

    return PosDB;
});
