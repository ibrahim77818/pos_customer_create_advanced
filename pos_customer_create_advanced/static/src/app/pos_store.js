import { PosStore } from "@point_of_sale/app/store/pos_store";
import { patch } from "@web/core/utils/patch";

/*
 * Odoo 18 creates and edits customers in the standard contact form, opened by
 * `PosStore.editPartner()` with the context from `editPartnerContext()`.
 * The customer list hands over the searched phone through `setPendingPartnerPhone`
 * just before opening the form; the server reads these context keys in
 * `res.partner.default_get / create / write`.
 */
let pendingPhone = null;
let editingNewPartner = false;

export function setPendingPartnerPhone(phone) {
    pendingPhone = phone || null;
}

patch(PosStore.prototype, {
    async editPartner(partner) {
        // `editPartnerContext()` is evaluated synchronously by the call below
        editingNewPartner = !partner;
        try {
            return await super.editPartner(...arguments);
        } finally {
            editingNewPartner = false;
            pendingPhone = null;
        }
    },

    editPartnerContext() {
        const context = { ...super.editPartnerContext(...arguments), pos_cca_config_id: this.config.id };
        if (editingNewPartner) {
            const defaultName = this.config.default_customer_name_enabled
                ? (this.config.default_customer_name || "").trim()
                : "";
            if (defaultName) {
                context.pos_cca_default_name = defaultName;
            }
            if (pendingPhone) {
                context.pos_cca_phone = pendingPhone;
            }
        }
        pendingPhone = null;
        return context;
    },
});
