/** @odoo-module */

import { PartnerDetailsEdit } from "@point_of_sale/app/screens/partner_list/partner_editor/partner_editor";
import { patch } from "@web/core/utils/patch";

function hasText(value) {
    return Boolean(value) && String(value).trim() !== "";
}

patch(PartnerDetailsEdit.prototype, {
    /** Default name configured on this POS terminal, or false. */
    get ccaDefaultCustomerName() {
        const config = this.pos.config;
        if (!config.default_customer_name_enabled) {
            return false;
        }
        const name = (config.default_customer_name || "").trim();
        return name || false;
    },

    /** Hint next to the name of a new customer: what an empty name becomes. */
    get ccaShowDefaultNameHint() {
        return (
            Boolean(this.ccaDefaultCustomerName) &&
            !this.props.partner.id &&
            !hasText(this.changes.name)
        );
    },

    /**
     * The fallback only applies to a new customer that has a phone or mobile
     * number and no name. Existing customers are never renamed.
     */
    _ccaShouldApplyDefaultName() {
        return (
            !this.props.partner.id &&
            !hasText(this.changes.name) &&
            (hasText(this.changes.phone) || hasText(this.changes.mobile)) &&
            Boolean(this.ccaDefaultCustomerName)
        );
    },

    saveChanges() {
        if (this._ccaShouldApplyDefaultName()) {
            this.changes.name = this.ccaDefaultCustomerName;
        }
        return super.saveChanges(...arguments);
    },
});
