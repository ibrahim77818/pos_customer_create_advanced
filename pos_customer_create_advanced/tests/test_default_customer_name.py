# -*- coding: utf-8 -*-
from odoo.exceptions import ValidationError
from odoo.tests import Form, TransactionCase, tagged


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
        """The POS loads the fields of pos.config (data loader)."""
        fields = self.config._load_pos_data_fields(self.config)
        for fname in ('default_customer_name_enabled', 'default_customer_name', 'phone_e164_enabled'):
            self.assertTrue(not fields or fname in fields, fname)

    # ------------------------------------------------------------------
    # Contact form opened from the POS (Odoo 18)
    # ------------------------------------------------------------------

    def _pos_context(self, **extra):
        ctx = {'pos_cca_config_id': self.config.id}
        if self.config.default_customer_name_enabled:
            ctx['pos_cca_default_name'] = self.config.default_customer_name
        ctx.update(extra)
        return ctx

    def test_form_default_name_applied(self):
        self.config.write({'default_customer_name_enabled': True, 'default_customer_name': 'Walk-in Customer',
                           'phone_e164_enabled': False})
        Partner = self.env['res.partner'].with_context(**self._pos_context(pos_cca_phone='0500477818'))
        with Form(Partner, view='base.view_partner_form') as form:
            self.assertEqual(form.phone, '0500477818', "Phone pre-filled from the POS search")
            self.assertEqual(form.pos_cca_default_name_hint, 'Walk-in Customer')
            # name left empty: allowed by the form in this context
        self.assertEqual(form.record.name, 'Walk-in Customer')
        self.assertEqual(form.record.phone, '0500477818')

    def test_form_typed_name_wins(self):
        self.config.write({'default_customer_name_enabled': True, 'default_customer_name': 'Walk-in Customer'})
        Partner = self.env['res.partner'].with_context(**self._pos_context(pos_cca_phone='0500477818'))
        with Form(Partner, view='base.view_partner_form') as form:
            form.name = 'Typed Name'
        self.assertEqual(form.record.name, 'Typed Name')

    def test_no_phone_no_default_name(self):
        """The default name is for customers identified by a phone number."""
        self.config.write({'default_customer_name_enabled': True, 'default_customer_name': 'Walk-in Customer'})
        Partner = self.env['res.partner'].with_context(**self._pos_context())
        vals = Partner._pos_cca_apply_default_name({'email': 'x@example.com'}, self.config)
        self.assertNotIn('name', vals)

    def test_child_contacts_untouched(self):
        self.config.write({'default_customer_name_enabled': True, 'default_customer_name': 'Walk-in Customer'})
        parent = self.env['res.partner'].create({'name': 'CCA Parent', 'is_company': True})
        vals = self.env['res.partner']._pos_cca_apply_default_name(
            {'parent_id': parent.id, 'type': 'delivery', 'phone': '0500477818'}, self.config)
        self.assertNotIn('name', vals)

    def test_option_disabled_name_still_required(self):
        """Option off: the POS sends no default name, the form keeps the standard check."""
        self.config.write({'default_customer_name_enabled': False})
        Partner = self.env['res.partner'].with_context(**self._pos_context(pos_cca_phone='0500477818'))
        form = Form(Partner, view='base.view_partner_form')
        self.assertFalse(form.pos_cca_default_name_hint)
        with self.assertRaises(AssertionError):
            form.save()  # "name" is a required field

    def test_outside_pos_unchanged(self):
        self.config.write({'default_customer_name_enabled': True, 'default_customer_name': 'Walk-in Customer'})
        form = Form(self.env['res.partner'], view='base.view_partner_form')
        self.assertFalse(form.phone)
        self.assertFalse(form.pos_cca_default_name_hint)
        form.phone = '0500477818'
        with self.assertRaises(AssertionError):
            form.save()
