odoo.define('pos_customer_create_advanced.PartnerDetailsEdit', function (require) {
    'use strict';

    const PartnerDetailsEdit = require('point_of_sale.PartnerDetailsEdit');
    const Registries = require('point_of_sale.Registries');

    function hasText(value) {
        return Boolean(value) && String(value).trim() !== '';
    }

    const PosCcaPartnerDetailsEdit = (PartnerDetailsEdit) =>
        class extends PartnerDetailsEdit {
            /** Default name configured on this POS terminal, or false. */
            get ccaDefaultCustomerName() {
                const config = this.env.pos.config;
                if (!config.default_customer_name_enabled) {
                    return false;
                }
                const name = (config.default_customer_name || '').trim();
                return name || false;
            }

            /** Hint next to the name of a new customer: what an empty name becomes. */
            get ccaShowDefaultNameHint() {
                return Boolean(this.ccaDefaultCustomerName) && !this.props.partner.id && !hasText(this.changes.name);
            }

            /**
             * The fallback only applies to a new customer that has a phone or
             * mobile number and no name. Existing customers are never renamed.
             */
            _ccaShouldApplyDefaultName() {
                return (
                    !this.props.partner.id &&
                    !hasText(this.changes.name) &&
                    (hasText(this.changes.phone) || hasText(this.changes.mobile)) &&
                    Boolean(this.ccaDefaultCustomerName)
                );
            }

            saveChanges() {
                if (this._ccaShouldApplyDefaultName()) {
                    this.changes.name = this.ccaDefaultCustomerName;
                }
                return super.saveChanges(...arguments);
            }
        };

    Registries.Component.extend(PartnerDetailsEdit, PosCcaPartnerDetailsEdit);

    return PartnerDetailsEdit;
});
