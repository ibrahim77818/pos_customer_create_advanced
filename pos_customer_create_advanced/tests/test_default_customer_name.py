# -*- coding: utf-8 -*-
from odoo.exceptions import ValidationError
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestPosDefaultCustomerName(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.config = cls.env['pos.config'].create({'name': 'CCA Test Shop'})

    def test_disabled_by_default(self):
        self.assertFalse(self.config.default_customer_name_enabled)

    def test_enable_requires_a_name(self):
        with self.assertRaises(ValidationError):
            self.config.write({'default_customer_name_enabled': True, 'default_customer_name': '   '})
        with self.assertRaises(ValidationError):
            self.config.write({'default_customer_name_enabled': True, 'default_customer_name': False})

    def test_name_is_trimmed(self):
        self.config.write({'default_customer_name_enabled': True, 'default_customer_name': '  admin  '})
        self.assertEqual(self.config.default_customer_name, 'admin')

    def test_per_terminal_values(self):
        other = self.env['pos.config'].create({
            'name': 'CCA Other Shop',
            'default_customer_name_enabled': True,
            'default_customer_name': 'Walk-in',
        })
        self.config.write({'default_customer_name_enabled': True, 'default_customer_name': 'admin'})
        self.assertEqual(self.config.default_customer_name, 'admin')
        self.assertEqual(other.default_customer_name, 'Walk-in')

    def test_settings_related_fields(self):
        # same as the settings page: all values saved together
        settings = self.env['res.config.settings'].create({
            'pos_config_id': self.config.id,
            'pos_default_customer_name_enabled': True,
            'pos_default_customer_name': 'Counter Customer',
        })
        settings.execute()
        self.assertTrue(self.config.default_customer_name_enabled)
        self.assertEqual(self.config.default_customer_name, 'Counter Customer')

    def test_fields_loaded_in_pos(self):
        """pos.config is loaded with all fields; make sure ours are part of it."""
        self.config.write({'default_customer_name_enabled': True, 'default_customer_name': 'admin'})
        session = self.env['pos.session'].new({'config_id': self.config.id})
        params = session._loader_params_pos_config()
        data = session._get_pos_ui_pos_config(params)
        self.assertTrue(data['default_customer_name_enabled'])
        self.assertEqual(data['default_customer_name'], 'admin')
