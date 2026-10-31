# -*- coding: utf-8 -*-
from unittest import skipIf

from odoo.tests import TransactionCase, tagged

try:
    import phonenumbers  # noqa: F401
except ImportError:
    phonenumbers = None


@tagged('post_install', '-at_install')
@skipIf(phonenumbers is None, "The 'phonenumbers' library is required to format numbers")
class TestPosPhoneE164(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.sa = cls.env.ref('base.sa')
        # the company that owns the POS is in Saudi Arabia
        cls.company = cls.env.company
        cls.company.country_id = cls.sa
        cls.config = cls.env['pos.config'].create({'name': 'CCA Riyadh POS'})
        cls.Partner = cls.env['res.partner']

    def _save(self, config=None, **vals):
        """Same payload as the POS customer form."""
        vals.setdefault('name', 'CCA Customer')
        vals['pos_config_id'] = (config or self.config).id
        return self.Partner.browse(self.Partner.create_from_ui(dict(vals)))

    def test_default_on_new_pos(self):
        self.assertTrue(self.config.phone_e164_enabled)

    def test_saudi_national_number(self):
        partner = self._save(phone='0500477818', country_id=self.sa.id)
        self.assertEqual(partner.phone, '+966500477818')

    def test_company_country_when_customer_has_none(self):
        partner = self._save(phone='0500477818', country_id=False)
        self.assertEqual(partner.phone, '+966500477818')
        self.assertFalse(partner.country_id, "The customer country is not changed")

    def test_other_ways_of_typing_the_same_number(self):
        for typed in ('00966500477818', '+966 50 047 7818', '050 047 7818', '٠٥٠٠٤٧٧٨١٨'):
            with self.subTest(typed=typed):
                self.assertEqual(self._save(phone=typed).phone, '+966500477818')

    def test_mobile_field(self):
        partner = self._save(phone='0112345678', mobile='0551112233')
        self.assertEqual(partner.phone, '+966112345678')
        self.assertEqual(partner.mobile, '+966551112233')

    def test_customer_country_wins_over_company(self):
        cases = [
            ('base.eg', '01001234567', '+201001234567'),
            ('base.ae', '0501234567', '+971501234567'),
            ('base.fr', '06 12 34 56 78', '+33612345678'),
            ('base.uk', '07911 123456', '+447911123456'),
            ('base.us', '(202) 555-0143', '+12025550143'),
        ]
        for xmlid, typed, expected in cases:
            with self.subTest(country=xmlid):
                partner = self._save(phone=typed, country_id=self.env.ref(xmlid).id)
                self.assertEqual(partner.phone, expected)

    def test_invalid_number_kept_as_typed(self):
        self.assertEqual(self._save(phone='12345').phone, '12345')
        self.assertEqual(self._save(phone='ext. 12').phone, 'ext. 12')

    def test_option_disabled(self):
        self.config.phone_e164_enabled = False
        self.assertEqual(self._save(phone='0500477818').phone, '0500477818')

    def test_not_from_pos(self):
        """Without a POS configuration (other callers), values are untouched."""
        partner_id = self.Partner.create_from_ui({'name': 'CCA API', 'phone': '0500477818'})
        self.assertEqual(self.Partner.browse(partner_id).phone, '0500477818')

    def test_edit_only_changed_numbers(self):
        partner = self.Partner.create({'name': 'CCA Existing', 'phone': '0500477818', 'mobile': '0551112233'})
        # the POS sends every field; the cashier only changed the mobile
        self._save(id=partner.id, name='CCA Existing', phone='0500477818', mobile='0559998877')
        self.assertEqual(partner.phone, '0500477818', "Untouched number is left as stored")
        self.assertEqual(partner.mobile, '+966559998877')

    def test_search_digits_after_formatting(self):
        partner = self._save(phone='0500477818')
        self.assertEqual(partner.pos_phone_digits, '966500477818')
        # what the POS sends for "0500477818": leading zeros removed
        found = self.env['res.partner'].search([('pos_phone_digits', 'ilike', '500477818')])
        self.assertIn(partner, found)
