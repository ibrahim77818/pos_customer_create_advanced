# -*- coding: utf-8 -*-
from unittest import skipIf

from odoo.tests import tagged

try:
    import phonenumbers  # noqa: F401
except ImportError:
    phonenumbers = None

from odoo.addons.point_of_sale.tests.test_frontend import TestPointOfSaleHttpCommon


@tagged('post_install', '-at_install')
class TestPosCustomerCreateAdvancedTours(TestPointOfSaleHttpCommon):

    @classmethod
    def setUpClass(cls, chart_template_ref=None):
        super().setUpClass(chart_template_ref=chart_template_ref)
        Partner = cls.env['res.partner']
        cls.partner_alpha = Partner.create({'name': 'CCA Alpha Customer', 'phone': '+1 (555) 014-4567'})
        cls.partner_beta = Partner.create({'name': 'CCA Beta Customer', 'mobile': '+966 50 999 8877'})
        cls.default_name = 'CCA Walk-in Customer'
        # Odoo 17's test cashier is created without "Contact Creation"; real
        # users get it from the default user template. The tours create
        # customers, as a cashier does at the counter.
        cls.pos_user.groups_id += cls.env.ref('base.group_partner_manager')
        # Tours 1-4 check numbers exactly as typed; tour 5 enables the format.
        cls.main_pos_config.phone_e164_enabled = False

    def _run_pos_tour(self, tour_name):
        # Odoo 17 runs POS tours as the cashier (point_of_sale.group_pos_user)
        self.main_pos_config.with_user(self.pos_user).open_ui()
        # Tests run before the modules are flagged installed; the POS only
        # loads the QWeb templates of installed modules.
        self.env['ir.module.module'].search([
            ('name', 'in', ('point_of_sale', 'pos_customer_create_advanced')),
        ]).write({'state': 'installed'})
        self.start_tour('/pos/ui?config_id=%d' % self.main_pos_config.id, tour_name, login='pos_user')

    def _partners_with_phone(self, phone):
        return self.env['res.partner'].search([('phone', '=', phone)])

    def test_01_substring_phone_search(self):
        self._run_pos_tour('PosCcaSubstringSearchTour')
        remote = self.env['res.partner'].search([('name', '=', 'CCA Remote Customer')])
        self.assertEqual(len(remote), 1, "The tour creates the server-only customer it searches for")

    def test_02_prefill_phone_on_create(self):
        self._run_pos_tour('PosCcaPrefillTour')
        self.assertFalse(self._partners_with_phone('0598765432'), "Opening the form must not create a customer")

    def test_03_default_name_on_save(self):
        self.main_pos_config.write({
            'default_customer_name_enabled': True,
            'default_customer_name': self.default_name,
        })
        self._run_pos_tour('PosCcaDefaultNameTour')

        defaulted = self._partners_with_phone('0551112233')
        self.assertEqual(len(defaulted), 1)
        self.assertEqual(defaulted.name, self.default_name)

        named = self._partners_with_phone('0552223344')
        self.assertEqual(len(named), 1)
        self.assertEqual(named.name, 'CCA Named Customer', "A typed name must win over the default name")

    def test_04_default_name_disabled_keeps_standard_check(self):
        self.main_pos_config.write({
            'default_customer_name_enabled': False,
            'default_customer_name': self.default_name,
        })
        self._run_pos_tour('PosCcaDefaultNameDisabledTour')
        self.assertFalse(self._partners_with_phone('0553334455'))

    @skipIf(phonenumbers is None, "The 'phonenumbers' library is required to format numbers")
    def test_05_phone_saved_with_country_code(self):
        self.main_pos_config.company_id.country_id = self.env.ref('base.sa')
        self.main_pos_config.phone_e164_enabled = True
        self._run_pos_tour('PosCcaPhoneE164Tour')

        partner = self.env['res.partner'].search([('name', '=', 'CCA Saudi Customer')])
        self.assertEqual(len(partner), 1)
        self.assertEqual(partner.phone, '+966500477818')
