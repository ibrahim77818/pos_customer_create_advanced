# -*- coding: utf-8 -*-
from odoo.tests import TransactionCase, tagged
from odoo.tools import sql

from odoo.addons.pos_customer_create_advanced.models.res_partner import (
    PHONE_DIGITS_INDEX,
    PHONE_DIGITS_SQL,
)


@tagged('post_install', '-at_install')
class TestPosPhoneDigits(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        Partner = cls.env['res.partner']
        cls.alpha = Partner.create({'name': 'CCA Alpha Customer', 'phone': '+1 (555) 014-4567'})
        cls.beta = Partner.create({'name': 'CCA Beta Customer', 'mobile': '+966 50 999 8877'})
        cls.gamma = Partner.create({'name': 'CCA Gamma Customer', 'phone': '050.123.9999', 'mobile': '0777 000 111'})
        cls.delta = Partner.create({'name': 'CCA Delta Customer', 'phone': '+٩٦٦ ٥٥ ۱۲۳ ٤٥٦٧'})
        cls.empty = Partner.create({'name': 'CCA No Phone Customer'})
        cls.all = cls.alpha | cls.beta | cls.gamma | cls.delta | cls.empty

    def _search(self, digits):
        """Exactly the domain the POS sends for a phone-like query."""
        return self.env['res.partner'].search([
            ('pos_phone_digits', 'ilike', digits),
            ('id', 'in', self.all.ids),
        ])

    def test_compute_value(self):
        self.assertEqual(self.alpha.pos_phone_digits, '15550144567')
        self.assertEqual(self.beta.pos_phone_digits, '966509998877')
        self.assertEqual(self.gamma.pos_phone_digits, '0501239999 0777000111')
        self.assertEqual(self.delta.pos_phone_digits, '966551234567', "Eastern Arabic digits become 0-9")
        self.assertFalse(self.empty.pos_phone_digits)

    def test_recomputed_on_write(self):
        self.beta.mobile = '+33 6 12 34 56 78'
        self.assertEqual(self._search('612345678'), self.beta)
        self.assertFalse(self._search('9998877'))
        self.beta.mobile = False
        self.assertFalse(self.beta.pos_phone_digits)

    def test_substring_anywhere_in_number(self):
        self.assertEqual(self._search('456'), self.alpha | self.delta)
        self.assertEqual(self._search('0144567'), self.alpha, "Digits across separators must match")
        self.assertEqual(self._search('1555'), self.alpha)
        self.assertEqual(self._search('9998877'), self.beta)
        self.assertEqual(self._search('000111'), self.gamma, "Mobile of a partner that also has a phone")
        self.assertFalse(self._search('31337'))

    def test_sql_backfill_matches_compute(self):
        """The install backfill (SQL) and the ORM compute must agree."""
        self.env.flush_all()
        self.env.cr.execute(
            f"SELECT id, {PHONE_DIGITS_SQL} FROM res_partner WHERE id IN %s",
            [tuple(self.all.ids)],
        )
        from_sql = dict(self.env.cr.fetchall())
        for partner in self.all:
            self.assertEqual(from_sql[partner.id] or False, partner.pos_phone_digits, partner.name)

    def test_trigram_index(self):
        """Created when pg_trgm is available (it is a trusted extension)."""
        self.env.cr.execute("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'")
        if not self.env.cr.fetchone():
            self.skipTest("pg_trgm extension not available in this database")
        self.assertTrue(sql.index_exists(self.env.cr, PHONE_DIGITS_INDEX))
        self.env.cr.execute(
            "SELECT indexdef FROM pg_indexes WHERE indexname = %s", [PHONE_DIGITS_INDEX])
        self.assertIn('gin_trgm_ops', self.env.cr.fetchone()[0])
