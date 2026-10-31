# -*- coding: utf-8 -*-
{
    'name': 'POS Customer Search & Quick Create Advanced',
    'version': '17.0.1.2.0',
    'category': 'Sales/Point of Sale',
    'summary': 'Substring phone search, phone pre-filled customer creation and a '
               'per-terminal default customer name for the Point of Sale.',
    'description': """
POS Customer Search & Quick Create Advanced
===========================================

* Substring phone / mobile search in the POS customer list, insensitive to
  formatting (spaces, dashes, brackets, "+"): typing ``456`` or ``0144567``
  finds ``+1 (555) 014-4567``; Arabic-Indic digits are understood. Works on
  the locally loaded customers and on the server ("Search more" and an
  automatic server lookup when nothing matches locally: Odoo 17 only loads
  the 100 most frequent customers in the POS). The server search uses a stored digits column
  with a trigram index: milliseconds on a million customers.
* When a phone search returns no customer, a "Create customer with phone ..."
  action is shown; the new customer form opens with the phone pre-filled.
  The standard "Create" button pre-fills the phone the same way.
* International phone format: numbers typed in the POS are saved in E.164
  (0500477818 -> +966500477818) for the customer's (or company's) country,
  ready for SMS / WhatsApp. Every country, via Odoo's phone_validation.
* Per POS configuration toggle + default customer name: a customer created
  from the POS with a phone but no name is saved under that default name
  instead of being blocked.

Compatible with Odoo 17 Community and Enterprise.
    """,
    'author': 'Ibrahim Yahia',
    'website': 'https://www.linkedin.com/in/ibrahim-yahia',
    'license': 'LGPL-3',
    'depends': ['point_of_sale', 'phone_validation'],
    'data': [
        'views/res_config_settings_views.xml',
    ],
    'assets': {
        'point_of_sale._assets_pos': [
            'pos_customer_create_advanced/static/src/**/*',
        ],
        'web.assets_tests': [
            'pos_customer_create_advanced/static/tests/tours/**/*',
        ],
    },
    'images': ['static/description/banner.png'],
    'installable': True,
    'application': False,
    'auto_install': False,
}
