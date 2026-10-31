# -*- coding: utf-8 -*-
from odoo import fields, models

try:
    import phonenumbers  # noqa: F401
    PHONENUMBERS_AVAILABLE = True
except ImportError:
    PHONENUMBERS_AVAILABLE = False


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    pos_default_customer_name_enabled = fields.Boolean(
        related='pos_config_id.default_customer_name_enabled', readonly=False)
    pos_default_customer_name = fields.Char(
        related='pos_config_id.default_customer_name', readonly=False)
    pos_phone_e164_enabled = fields.Boolean(
        related='pos_config_id.phone_e164_enabled', readonly=False)
    pos_phonenumbers_missing = fields.Boolean(
        compute='_compute_pos_phonenumbers_missing',
        help="Technical: the 'phonenumbers' Python library is not installed on the server.")

    def _compute_pos_phonenumbers_missing(self):
        self.pos_phonenumbers_missing = not PHONENUMBERS_AVAILABLE
