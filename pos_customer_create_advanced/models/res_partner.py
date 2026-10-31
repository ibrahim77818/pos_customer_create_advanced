# -*- coding: utf-8 -*-
import logging
import re

import psycopg2

from odoo import api, fields, models
from odoo.tools import sql

_logger = logging.getLogger(__name__)

_NON_DIGIT = re.compile(r'[^0-9]')
# Arabic-Indic and Extended Arabic-Indic (Persian/Urdu) digits -> ASCII digits.
_EASTERN_DIGITS = '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669' \
                  '\u06f0\u06f1\u06f2\u06f3\u06f4\u06f5\u06f6\u06f7\u06f8\u06f9'
_ASCII_DIGITS = '0123456789' * 2
_TO_ASCII_DIGITS = str.maketrans(_EASTERN_DIGITS, _ASCII_DIGITS)

POS_PHONE_FIELDS = ('phone', 'mobile')

PHONE_DIGITS_COLUMN = 'pos_phone_digits'
PHONE_DIGITS_INDEX = 'res_partner_pos_phone_digits_index'  # same name Odoo gives field indexes

# SQL equivalent of `_compute_pos_phone_digits`, used to backfill the column on
# install without loading every partner in the ORM (seconds instead of minutes
# on large databases). Both must produce identical values (see tests).
_DIGITS_SQL = "NULLIF(regexp_replace(translate(COALESCE({col}, ''), '%s', '%s'), '[^0-9]', '', 'g'), '')" % (
    _EASTERN_DIGITS, _ASCII_DIGITS)
PHONE_DIGITS_SQL = "NULLIF(concat_ws(' ', %s, %s), '')" % (
    _DIGITS_SQL.format(col='phone'), _DIGITS_SQL.format(col='mobile'))


def phone_digits(value):
    return _NON_DIGIT.sub('', str(value or '').translate(_TO_ASCII_DIGITS))


class ResPartner(models.Model):
    _inherit = 'res.partner'

    pos_phone_digits = fields.Char(
        string='Phone/Mobile Digits (POS search)',
        compute='_compute_pos_phone_digits',
        store=True,
        index='trigram',
        unaccent=False,
        help="Technical field: digits of the phone and mobile numbers, used by the "
             "Point of Sale to find customers by any part of their number, whatever "
             "the formatting (spaces, dashes, brackets, '+').",
    )

    #--------------------------------------------------------------------------
    # POS customer save: international (E.164) phone format
    #--------------------------------------------------------------------------

    @api.model
    def create_from_ui(self, partner):
        """The POS sends the id of its configuration with the customer values
        (key `pos_config_id`, not a partner field). When that POS has the
        option enabled, phone and mobile are saved in E.164 format."""
        config_id = partner.pop('pos_config_id', False)
        config = self.env['pos.config'].browse(config_id).exists() if config_id else False
        if config and config.phone_e164_enabled:
            existing = self.browse(partner.get('id') or []).exists()
            self._pos_format_phone_values(partner, existing, config)
        return super().create_from_ui(partner)

    @api.model
    def _pos_phone_country(self, vals, existing, config):
        """Country used to read a national number: the one chosen in the POS
        form, else the customer's, else the POS company's."""
        if vals.get('country_id'):
            country = self.env['res.country'].browse(int(vals['country_id'])).exists()
            if country:
                return country
        if 'country_id' not in vals and existing.country_id:
            return existing.country_id
        return config.company_id.country_id or self.env.company.country_id

    @api.model
    def _pos_format_phone_values(self, vals, existing, config):
        """Rewrite `phone` / `mobile` in `vals` to E.164 (+966500477818).

        Uses `phone_validation` (Google's libphonenumber metadata, every
        country). A number that is not valid for the country, or a server
        without the `phonenumbers` library, keeps the typed value: the
        cashier is never blocked. On an existing customer, only numbers the
        cashier changed are rewritten.
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
            formatted = self._phone_format(number, country=country, force_format='E164')
            vals[fname] = formatted or number
        return vals

    #--------------------------------------------------------------------------
    # Search helper field
    #--------------------------------------------------------------------------

    @api.depends('phone', 'mobile')
    def _compute_pos_phone_digits(self):
        for partner in self:
            partner.pos_phone_digits = ' '.join(
                filter(None, (phone_digits(partner.phone), phone_digits(partner.mobile)))
            ) or False

    #--------------------------------------------------------------------------
    # Schema
    #--------------------------------------------------------------------------

    def _auto_init(self):
        cr = self.env.cr
        if not sql.column_exists(cr, self._table, PHONE_DIGITS_COLUMN):
            # Creating the column first means the ORM sees it as existing and
            # does not recompute the field record by record.
            sql.create_column(cr, self._table, PHONE_DIGITS_COLUMN, 'varchar')
            cr.execute(f"""
                UPDATE "{self._table}"
                   SET "{PHONE_DIGITS_COLUMN}" = {PHONE_DIGITS_SQL}
                 WHERE phone IS NOT NULL OR mobile IS NOT NULL
            """)
            _logger.info("pos_customer_create_advanced: %s phone/mobile digits backfilled", cr.rowcount)
        res = super()._auto_init()
        self._pos_ensure_phone_digits_index()
        return res

    @api.model
    def _pos_ensure_phone_digits_index(self):
        """Trigram (GIN) index so `pos_phone_digits ilike '%123%'` does not scan
        the whole table. Needs the `pg_trgm` extension, which is a trusted
        extension (PostgreSQL 13+): the database owner can enable it. Odoo
        only builds `index='trigram'` indexes when the extension is already
        there when the registry loads, so it is handled here on install.
        Without the extension the search still works, with a sequential scan
        of this single short column."""
        cr = self.env.cr
        if sql.index_exists(cr, PHONE_DIGITS_INDEX):
            return
        try:
            with cr.savepoint(flush=False):
                cr.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
            with cr.savepoint(flush=False):
                cr.execute(f"""
                    CREATE INDEX IF NOT EXISTS "{PHONE_DIGITS_INDEX}"
                        ON "{self._table}" USING gin ("{PHONE_DIGITS_COLUMN}" gin_trgm_ops)
                """)
        except psycopg2.Error as error:
            _logger.warning(
                "pos_customer_create_advanced: could not create the trigram index on "
                "res_partner.%s (%s). POS phone search keeps working but scans the "
                "table; ask the database administrator to run "
                "'CREATE EXTENSION pg_trgm;' then upgrade the module.",
                PHONE_DIGITS_COLUMN, str(error).strip(),
            )
