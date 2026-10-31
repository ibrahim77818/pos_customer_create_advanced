# -*- coding: utf-8 -*-
from unittest.mock import patch

from odoo.modules.registry import _unaccent
from odoo.tests import TransactionCase, tagged
from odoo.tools import sql

from odoo.addons.pos_customer_create_advanced.models.res_partner import (
    LEGACY_PHONE_DIGITS_INDEX,
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
            ('pos_phone_digits', 'like', digits),
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

    def test_search_not_wrapped_in_unaccent(self):
        """Odoo 18 wraps every `ilike` in unaccent() when the database has that
        extension, and an index on the plain column is then unusable. The POS
        searches with `like` (same result on digits), which is never wrapped
        and is served by the trigram index."""
        Partner = self.env['res.partner']
        registry = self.env.registry
        with patch.object(registry, 'unaccent', _unaccent):
            query = Partner._search([('pos_phone_digits', 'like', '0144')])
            code = query.select().code
            # the same domain with `ilike` would be wrapped: the patch works
            ilike_code = Partner._search([('pos_phone_digits', 'ilike', '0144')]).select().code
        self.assertNotIn('unaccent', code)
        self.assertIn('unaccent', ilike_code)
        self.assertEqual(self._search('0144'), self.alpha)

        self.env.cr.execute("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'")
        if not self.env.cr.fetchone():
            return
        sql_query = query.select()
        self.env.cr.execute("SET LOCAL enable_seqscan = off")
        self.env.cr.execute(f"EXPLAIN {sql_query.code}", sql_query.params)
        plan = '\n'.join(row[0] for row in self.env.cr.fetchall())
        self.env.cr.execute("SET LOCAL enable_seqscan = on")
        self.assertIn(PHONE_DIGITS_INDEX, plan)

    def test_legacy_v16_index_replaced(self):
        """A database upgraded from the 16.0 module keeps one index only."""
        self.env.cr.execute("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'")
        if not self.env.cr.fetchone():
            self.skipTest("pg_trgm extension not available in this database")
        cr = self.env.cr
        cr.execute(f'CREATE INDEX "{LEGACY_PHONE_DIGITS_INDEX}" ON res_partner USING gin (pos_phone_digits gin_trgm_ops)')
        self.env['res.partner']._pos_ensure_phone_digits_index()
        self.assertFalse(sql.index_exists(cr, LEGACY_PHONE_DIGITS_INDEX))
        self.assertTrue(sql.index_exists(cr, PHONE_DIGITS_INDEX))
