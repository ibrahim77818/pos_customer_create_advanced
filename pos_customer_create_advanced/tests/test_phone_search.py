# -*- coding: utf-8 -*-
from odoo.tests import TransactionCase, tagged
from odoo.tools import index_exists, sql

from odoo.addons.pos_customer_create_advanced.models.res_partner import (
    LEGACY_PHONE_DIGITS_COLUMN,
    LEGACY_PHONE_DIGITS_INDEXES,
    drop_legacy_phone_digits,
)


@tagged('post_install', '-at_install')
class TestPosPhoneSearch(TransactionCase):
    """Odoo 19: the POS searches phone numbers through `phone_mobile_search`
    (phone_validation), with digits normalised by the module (static/src/app):
    Arabic-Indic digits converted, separators and leading zeros removed."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        Partner = cls.env['res.partner']
        cls.alpha = Partner.create({'name': 'CCA Alpha Customer', 'phone': '+1 (555) 014-4567'})
        cls.beta = Partner.create({'name': 'CCA Beta Customer', 'phone': '+966 50 999 8877'})
        cls.gamma = Partner.create({'name': 'CCA Gamma Customer', 'phone': '050.123.9999'})
        cls.saudi = Partner.create({'name': 'CCA Saudi Customer', 'phone': '+966500477818'})
        cls.all = cls.alpha | cls.beta | cls.gamma | cls.saudi

    def _search(self, digits):
        """The phone leaf the POS sends for a phone-like query."""
        return self.env['res.partner'].search([
            ('phone_mobile_search', 'ilike', digits),
            ('id', 'in', self.all.ids),
        ])

    def test_substring_anywhere_in_number(self):
        self.assertEqual(self._search('456'), self.alpha)
        self.assertEqual(self._search('0144567'), self.alpha, "Digits across separators must match")
        self.assertEqual(self._search('9998877'), self.beta)
        self.assertEqual(self._search('0501239999'), self.gamma, "Dots are separators")
        self.assertFalse(self._search('31337'))

    def test_local_number_finds_international(self):
        # "0500477818" typed by the cashier is sent as "500477818"
        self.assertEqual(self._search('500477818'), self.saudi)
        self.assertFalse(self._search('0500477818'), "Odoo alone does not match the leading zero")

    def test_trigram_indexes(self):
        """The module enables pg_trgm and makes sure Odoo's GIN indexes exist."""
        cr = self.env.cr
        cr.execute("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'")
        if not cr.fetchone():
            self.skipTest("pg_trgm extension not available in this database")
        for fname in self.env['res.partner']._phone_get_phone_mobile_search_fields():
            self.assertTrue(index_exists(cr, f'res_partner_{fname}_partial_gin_idx'), fname)

    def test_init_is_idempotent(self):
        self.env['res.partner'].init()
        self.env['res.partner'].init()

    def test_legacy_digits_column_dropped(self):
        """Databases upgraded from the 16.0 - 18.0 versions lose the old column."""
        cr = self.env.cr
        cr.execute(f'ALTER TABLE res_partner ADD COLUMN "{LEGACY_PHONE_DIGITS_COLUMN}" varchar')
        cr.execute(f'CREATE INDEX "{LEGACY_PHONE_DIGITS_INDEXES[0]}" ON res_partner ("{LEGACY_PHONE_DIGITS_COLUMN}")')
        drop_legacy_phone_digits(cr)
        self.assertFalse(sql.column_exists(cr, 'res_partner', LEGACY_PHONE_DIGITS_COLUMN))
        self.assertFalse(index_exists(cr, LEGACY_PHONE_DIGITS_INDEXES[0]))
