# -*- coding: utf-8 -*-
from unittest import skipIf

from odoo.tests import Form, TransactionCase, tagged

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

    def _pos_env(self, config=None):
        """Context the Odoo 18 POS passes to the contact form (pos_store.js)."""
        return self.Partner.with_context(pos_cca_config_id=(config or self.config).id)

    def _save(self, config=None, **vals):
        """Fill and save the contact form exactly as the cashier does."""
        vals.setdefault('name', 'CCA Customer')
        # Country first, as in the form layout: Odoo 18's own phone onchange
        # formats a number as soon as it is typed, using the current country.
        ordered = sorted(vals.items(), key=lambda item: item[0] != 'country_id')
        with Form(self._pos_env(config), view='base.view_partner_form') as form:
            for fname, value in ordered:
                if fname == 'country_id':
                    form.country_id = self.env['res.country'].browse(value) if value else self.env['res.country']
                else:
                    setattr(form, fname, value)
        return form.record

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

    def test_landline_number(self):
        self.assertEqual(self._save(phone='0112345678').phone, '+966112345678')

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
        """Option off: no E.164. Odoo 18's contact form still applies its own
        phone onchange (international format with spaces): standard behaviour."""
        self.config.phone_e164_enabled = False
        self.assertEqual(self._save(phone='0500477818').phone, '+966 50 047 7818')

    def test_not_from_pos(self):
        """Without the POS context (backend, imports, API), values are untouched."""
        partner = self.Partner.create({'name': 'CCA API', 'phone': '0500477818'})
        self.assertEqual(partner.phone, '0500477818')

    def test_edit_only_when_changed(self):
        partner = self.Partner.create({'name': 'CCA Existing', 'phone': '0500477818', 'email': 'a@example.com'})
        # the form only sends changed fields: the cashier only changed the email
        with Form(partner.with_context(pos_cca_config_id=self.config.id), view='base.view_partner_form') as form:
            form.email = 'b@example.com'
        self.assertEqual(partner.phone, '0500477818', "Untouched number is left as stored")
        with Form(partner.with_context(pos_cca_config_id=self.config.id), view='base.view_partner_form') as form:
            form.phone = '0559998877'
        self.assertEqual(partner.phone, '+966559998877')

    def test_search_after_formatting(self):
        partner = self._save(phone='0500477818')
        self.assertEqual(partner.phone, '+966500477818')
        # what the POS sends for "0500477818": digits without leading zeros
        found = self.env['res.partner'].search([('phone_mobile_search', 'ilike', '500477818')])
        self.assertIn(partner, found)
