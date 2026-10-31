# -*- coding: utf-8 -*-
from odoo import _, api, fields, models
from odoo.exceptions import ValidationError


class PosConfig(models.Model):
    _inherit = 'pos.config'

    default_customer_name_enabled = fields.Boolean(
        string='Default Customer Name',
        help="When a cashier creates a customer from this Point of Sale with a "
             "phone (or mobile) number but leaves the name empty, the customer "
             "is saved under the default name below instead of being rejected.",
    )
    default_customer_name = fields.Char(
        string='Default Customer Name Value',
        help="Name given to customers created from this Point of Sale without "
             "a name (e.g. 'Walk-in Customer').",
    )
    phone_e164_enabled = fields.Boolean(
        string='International Phone Format',
        default=True,
        help="Phone and mobile numbers typed in this Point of Sale are saved in "
             "international E.164 format (e.g. 0500477818 -> +966500477818), "
             "as required by SMS and WhatsApp integrations. The country is the "
             "customer's country, or the company's country when it is not set. "
             "Numbers that are not valid for that country are kept as typed.",
    )

    @api.constrains('default_customer_name_enabled', 'default_customer_name')
    def _check_default_customer_name(self):
        for config in self:
            if config.default_customer_name_enabled and not (config.default_customer_name or '').strip():
                raise ValidationError(_(
                    'Point of Sale "%s": set a default customer name or disable the option.',
                    config.name,
                ))

    def write(self, vals):
        if 'default_customer_name' in vals and isinstance(vals['default_customer_name'], str):
            vals['default_customer_name'] = vals['default_customer_name'].strip()
        return super().write(vals)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if isinstance(vals.get('default_customer_name'), str):
                vals['default_customer_name'] = vals['default_customer_name'].strip()
        return super().create(vals_list)
