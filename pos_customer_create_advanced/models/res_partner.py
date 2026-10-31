# -*- coding: utf-8 -*-
import logging

import psycopg2

from odoo import api, fields, models
from odoo.tools import create_index, index_exists, make_identifier, sql

from odoo.addons.phone_validation.models.mail_thread_phone import PHONE_REGEX_PATTERN

_logger = logging.getLogger(__name__)

# Odoo 19 removed `mobile` from contacts: `phone` is the only number field.
POS_PHONE_FIELDS = ('phone',)

# Column and index names used by the 16.0 - 18.0 versions of this module. In
# Odoo 19 the POS searches through `phone_mobile_search`, which Odoo indexes
# itself, so they are removed (see migrations/ and `_pos_cca_drop_legacy_digits`).
LEGACY_PHONE_DIGITS_COLUMN = 'pos_phone_digits'
LEGACY_PHONE_DIGITS_INDEXES = ('res_partner__pos_phone_digits_index', 'res_partner_pos_phone_digits_index')


def drop_legacy_phone_digits(cr):
    """Remove the stored digits column of the 16.0 - 18.0 versions."""
    for indexname in LEGACY_PHONE_DIGITS_INDEXES:
        cr.execute(f'DROP INDEX IF EXISTS "{indexname}"')
    if sql.column_exists(cr, 'res_partner', LEGACY_PHONE_DIGITS_COLUMN):
        cr.execute(f'ALTER TABLE res_partner DROP COLUMN "{LEGACY_PHONE_DIGITS_COLUMN}"')
        _logger.info("pos_customer_create_advanced: dropped the res_partner.%s column of earlier versions",
                     LEGACY_PHONE_DIGITS_COLUMN)


class ResPartner(models.Model):
    _inherit = 'res.partner'

    pos_cca_default_name_hint = fields.Char(
        string='POS Default Customer Name',
        compute='_compute_pos_cca_default_name_hint',
        help="Technical field: name given to a customer created from the Point of Sale "
             "without a name (shown as a hint in the customer form opened from the POS).",
    )

    #--------------------------------------------------------------------------
    # Customers created or edited from the POS
    #
    # In Odoo 18 the POS opens the standard contact form
    # (action point_of_sale.res_partner_action_edit_pos) and saves it through
    # the ORM. The POS adds these context keys (see static/src/app/pos_store.js):
    #   pos_cca_config_id     id of the POS configuration
    #   pos_cca_phone         phone searched by the cashier (new customer only)
    #   pos_cca_default_name  default name, when the option is enabled
    #--------------------------------------------------------------------------

    @api.model
    def _pos_cca_config(self):
        config_id = self.env.context.get('pos_cca_config_id')
        if not config_id or not isinstance(config_id, int):
            return self.env['pos.config']
        return self.env['pos.config'].browse(config_id).exists()

    @api.depends_context('pos_cca_config_id')
    def _compute_pos_cca_default_name_hint(self):
        config = self._pos_cca_config()
        name = config.default_customer_name if config and config.default_customer_name_enabled else False
        for partner in self:
            partner.pos_cca_default_name_hint = name

    @api.model
    def default_get(self, fields_list):
        res = super().default_get(fields_list)
        # Odoo 18's first onchange of a new record takes every field it has no
        # value for from default_get (False otherwise), so the computed hint
        # must also be provided here to show in the form.
        if 'pos_cca_default_name_hint' in fields_list:
            config = self._pos_cca_config()
            if config and config.default_customer_name_enabled:
                res['pos_cca_default_name_hint'] = config.default_customer_name or False
        phone = self.env.context.get('pos_cca_phone')
        if phone and isinstance(phone, str) and 'phone' in fields_list and not res.get('phone'):
            res['phone'] = phone
        return res

    @api.model_create_multi
    def create(self, vals_list):
        config = self._pos_cca_config()
        if config:
            for vals in vals_list:
                self._pos_cca_apply_default_name(vals, config)
                if config.phone_e164_enabled:
                    self._pos_format_phone_values(vals, self.browse(), config)
        return super().create(vals_list)

    def write(self, vals):
        config = self._pos_cca_config()
        if config and config.phone_e164_enabled and len(self) == 1 and any(f in vals for f in POS_PHONE_FIELDS):
            vals = dict(vals)
            self._pos_format_phone_values(vals, self, config)
        return super().write(vals)

    @api.model
    def _pos_cca_apply_default_name(self, vals, config):
        """New top-level customer with a phone but no name: use the
        default name of the POS. Child contacts and addresses are left alone."""
        if not config.default_customer_name_enabled or not (config.default_customer_name or '').strip():
            return vals
        if vals.get('parent_id') or (vals.get('name') or '').strip():
            return vals
        if (vals.get('phone') or '').strip():
            vals['name'] = config.default_customer_name.strip()
        return vals

    @api.model
    def _pos_phone_country(self, vals, existing, config):
        """Country used to read a national number: the one chosen in the form,
        else the customer's, else the POS company's."""
        if vals.get('country_id'):
            country = self.env['res.country'].browse(int(vals['country_id'])).exists()
            if country:
                return country
        if 'country_id' not in vals and existing.country_id:
            return existing.country_id
        return config.company_id.country_id or self.env.company.country_id

    @api.model
    def _pos_format_phone_values(self, vals, existing, config):
        """Rewrite `phone` in `vals` to E.164 (+966500477818).

        Uses `phone_validation` (Google's libphonenumber metadata, every
        country). A number that is not valid for the country, or a server
        without the `phonenumbers` library, keeps the typed value: the
        cashier is never blocked. The form only sends changed fields, so on
        an existing customer only numbers the cashier changed are rewritten.
        """
        country = self._pos_phone_country(vals, existing, config)
        if not country:
            return vals
        for fname in POS_PHONE_FIELDS:
            number = vals.get(fname)
            if not number or not isinstance(number, str):
                continue
            if existing and existing[fname] == number:
                continue
            number = number.strip()
            formatted = self._phone_format(number=number, country=country, force_format='E164')
            vals[fname] = formatted or number
        return vals

    #--------------------------------------------------------------------------
    # Phone search indexes
    #--------------------------------------------------------------------------

    def init(self):
        """Odoo 19 searches phone numbers through `phone_mobile_search`, with
        trigram (GIN) indexes created by `phone_validation`, but only when the
        `pg_trgm` extension already exists. This module enables the extension
        (a trusted extension: the database owner can create it) and creates
        the missing indexes with the exact names and expressions Odoo uses, so
        they are never duplicated."""
        super().init()
        cr = self.env.cr
        drop_legacy_phone_digits(cr)
        try:
            with cr.savepoint(flush=False):
                cr.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        except psycopg2.Error as error:
            _logger.warning(
                "pos_customer_create_advanced: the pg_trgm extension could not be created (%s). "
                "Phone search keeps working but scans the contacts table; ask the database "
                "administrator to run 'CREATE EXTENSION pg_trgm;' then upgrade the module.",
                str(error).strip(),
            )
            return
        for fname in self._phone_get_phone_mobile_search_fields():
            indexname = make_identifier(f'{self._table}_{fname}_partial_gin_idx')
            if index_exists(cr, indexname):
                continue
            regex_expression = rf"regexp_replace(({fname}::text), '{PHONE_REGEX_PATTERN}'::text, ''::text, 'g'::text)"
            with cr.savepoint(flush=False):
                create_index(cr, indexname=indexname, tablename=self._table, method='gin',
                             expressions=[regex_expression + ' gin_trgm_ops'],
                             where=f'{fname} IS NOT NULL')
            _logger.info("pos_customer_create_advanced: created phone search index %s", indexname)
