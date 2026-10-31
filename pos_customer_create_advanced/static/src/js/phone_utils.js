odoo.define('pos_customer_create_advanced.phone_utils', function (require) {
    'use strict';

    /**
     * A query is treated as a phone number when it only contains digits
     * (ASCII, Arabic-Indic or Persian) and the usual phone separators
     * ("+", spaces, dashes, dots, brackets, "/").
     */
    const PHONE_CHARS = /^\+?[\d٠-٩۰-۹\s\-().\/]+$/;
    const EASTERN_DIGITS = /[٠-٩۰-۹]/g;

    /** Minimum digits before a query triggers phone-specific behaviour. */
    const MIN_PHONE_DIGITS = 3;

    function asText(value) {
        return value === undefined || value === null || value === false ? '' : String(value);
    }

    /**
     * Digits only, Eastern Arabic digits converted to 0-9. Must stay in line
     * with `phone_digits()` / `PHONE_DIGITS_SQL` in models/res_partner.py.
     */
    function digitsOnly(value) {
        return asText(value)
            .replace(EASTERN_DIGITS, (d) => String(d.charCodeAt(0) & 0xf))
            .replace(/[^0-9]/g, '');
    }

    /**
     * Digits to look for when searching by phone. Leading zeros (national
     * trunk prefix "0", international prefix "00") are dropped, so a number
     * typed the local way ("0500477818") also finds the number saved in
     * international format ("+966500477818" -> digits "966500477818").
     */
    function phoneSearchDigits(value) {
        const digits = digitsOnly(value);
        return digits.replace(/^0+/, '') || digits;
    }

    function isPhoneLike(value, minDigits) {
        const min = minDigits === undefined ? MIN_PHONE_DIGITS : minDigits;
        const text = asText(value).trim();
        return Boolean(text) && PHONE_CHARS.test(text) && digitsOnly(text).length >= Math.max(min, 1);
    }

    return { digitsOnly, phoneSearchDigits, isPhoneLike, MIN_PHONE_DIGITS };
});
