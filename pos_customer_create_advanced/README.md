# POS Customer Search & Quick Create Advanced (`pos_customer_create_advanced`)

Odoo 19 (Community & Enterprise). Depends on `point_of_sale` and `phone_validation` (both Community;
`phone_validation` is auto-installed with Discuss).

Odoo 19 removed the `mobile` field of contacts: `phone` is the only number, and everything below
applies to it.

## Features

1. **Substring phone search, formatting-insensitive**
   * Local search (loaded customers): the phone is also matched as digits only, and a phone-like
     query (`+966 50`, `(555) 014`, `014-45`, `٠٥٥ ١١١`) is reduced to ASCII digits, so any digit
     sequence matches anywhere in the number: `0144567` finds `+1 (555) 014-4567`.
   * Leading zeros of the query are ignored, so the local way of typing a number (`0500477818`)
     finds it when it is saved with its country code (`+966500477818`).
   * Server search (Enter, scrolling and the automatic lookup): the module keeps Odoo 19's search
     fields (`_getSearchFields`: for a numeric query `phone_mobile_search`, barcode, VAT, ZIP) and
     only changes the value sent to `phone_mobile_search`: normalised digits instead of the raw
     text. Odoo 19 indexes that field (trigram GIN on its `regexp_replace` expression).
   * Automatic server lookup: a phone query (3+ digits) with no local match is sent to the server
     once the search settles (Odoo 19's search box debounces 300 ms), once per query.
     Offline/timeouts are silent.
2. **Phone pre-filled on creation**: a phone search with no result shows
   "Create customer with phone ..." in place of Odoo's "No customers found, press enter to load
   more". That button and the standard **Create** button both open the contact form
   (`base.view_partner_form`) with `phone` = the searched number. Odoo's phone onchange then
   displays it in international format. Cashiers with the `minimal` role do not get the button,
   like the standard Create button.
3. **Default customer name per POS**: *Point of Sale > Configuration > Settings > Customer
   Onboarding*. When enabled, a new customer saved from that POS with a phone and no name gets the
   configured name. A typed name always wins; existing customers, child contacts and addresses are
   never renamed; with the option off the contact form keeps its required name. The form shows
   "If left empty, saved as <name>" under the name field.
4. **International phone format (E.164) per POS**, on by default (*Customer Onboarding >
   International Phone Format*). When a cashier saves a customer, `phone` is stored as
   `+<country code><number>`:
   * `0500477818`, `050 047 7818`, `00966500477818`, `٠٥٠٠٤٧٧٨١٨` → `+966500477818` (Saudi Arabia);
     works for every country through Odoo's `phone_validation` (Google libphonenumber metadata).
   * Odoo 19 already keeps an E.164 copy in the hidden `phone_sanitized` field; this option makes
     the visible, stored `phone` itself E.164, which is what exports, the API and third-party SMS
     or WhatsApp integrations read.
   * Country used: the one selected in the contact form, else the customer's existing country, else
     the POS company's country. The contact form formats a number as soon as it is typed, so the
     cashier should choose a foreign country before typing the number.
   * A number that is not valid for that country is saved as typed: the cashier is never blocked.
   * Editing a customer from the POS only reformats the number if the cashier changed it.
   * Applies only to the contact form opened from the POS (context key `pos_cca_config_id`); the
     same form opened from Contacts, imports and API calls are not changed. With the option off,
     Odoo still applies its own phone onchange (spaced international format).
   * Needs the `phonenumbers` Python library (`pip install phonenumbers`); the settings page shows
     a warning when it is missing, and numbers are then saved as typed.

## Performance (measured, 1,000,000 partners, PostgreSQL 16)

Server query per lookup, ordered like Odoo (`complete_name, id DESC`). Both columns use the SQL
Odoo 19 generates for `phone_mobile_search` plus barcode, VAT and ZIP.

| Query | Matches | Odoo 19 standard | This module |
|---|---|---|---|
| `0551112233` (new customer) | 0 | 233 ms | 225 ms |
| `757 4187` | 34 | 229 ms | 234 ms |
| `4187` | 852 | 198 ms | 202 ms |
| `456` | 6,752 | 61 ms | 57 ms |

Same speed as standard: Odoo 19 indexes phone search itself, so the 16.0–18.0 `pos_phone_digits`
column (and its 1.5–6 ms lookups) was dropped in favour of the standard index. Most of the remaining
~0.2 s comes from the barcode/VAT/ZIP conditions that standard Odoo 19 adds to numeric searches;
the module keeps them so that no standard search result is lost.

### Deployment notes

* Odoo 19 loads the **100 most frequent customers** into the POS by default (system parameter
  `point_of_sale.limited_customer_count`); every other customer is found through the server. The
  automatic server lookup does this as the cashier types.
* Odoo 19 creates the trigram indexes on the phone search expression only when `pg_trgm` is
  available. The module enables `pg_trgm` (a trusted extension, PostgreSQL 13+, when the Odoo
  database user owns the database) and creates the missing index
  (`res_partner_phone_partial_gin_idx`). Otherwise run `CREATE EXTENSION pg_trgm;` as a superuser,
  then upgrade the module; a warning is logged until then.
* Cashiers need **Extra Rights > Contact Creation** to create customers (standard Odoo; every new
  user gets it from the default user template).
* Upgrading from 18.0: the settings are kept; the `pos_phone_digits` column and its index
  (16.0 and 17.0/18.0 names) are dropped in `init()`.

## Tests

Verified on Odoo 19.0 (Community): 33 tests, 0 failures (28 unit tests + 5 Chrome tours).

```bash
odoo-bin -d test_db -i pos_customer_create_advanced --test-tags /pos_customer_create_advanced --stop-after-init
```

(Use `-u` instead of `-i` if the module is already installed in that database.)

* `test_phone_search.py`: `phone_mobile_search` across separators and dots, leading-zero
  normalisation, trigram indexes present, `init()` idempotent, legacy column and indexes dropped.
* `test_default_customer_name.py`: constraint, trimming, per-terminal values, settings, POS loading,
  contact form from the POS (phone pre-fill, hint, default name, typed name wins, children untouched,
  option off, form outside the POS unchanged).
* `test_phone_e164.py`: Saudi numbers typed several ways, company vs customer country,
  EG/AE/FR/GB/US, invalid numbers kept, option off, non-POS callers untouched, edits, search after
  formatting.
* `test_frontend.py`: 5 web tours (`HttpCase`): substring search incl. a server-only customer,
  phone pre-fill from the empty state, default-name injection (and typed name priority), feature
  disabled keeps the standard check, and `0500477818` saved as `+966500477818` then found again by
  typing `0500477818`.

## Technical notes

* POS JS: ES modules in `static/src/app/`, extending `PartnerList` (the customer dialog),
  `ResPartner.searchString` and `PosStore.editPartner/editPartnerContext` (now in
  `@point_of_sale/app/services/pos_store`) with `patch()`. Nothing is written on reactive records
  during render; per-customer digits are cached in a `WeakMap`.
* `PartnerList.getNewPartners` is replaced (core builds its domain inline); the call is the same
  `pos.data.callRelated("res.partner", "get_new_partner", ...)` with Odoo's per-query offsets, and
  the domain is exposed through `_ccaGetPartnerSearchDomain(query)`.
* Customers are saved by the contact form. The POS passes `pos_cca_config_id`, `pos_cca_phone` and
  `pos_cca_default_name` in the form context; the server applies them in `default_get`, `create`
  and `write`. The form view extension relaxes the required name (both name fields: the company
  and individual variants have no `id` in Odoo 19) only when `pos_cca_default_name` is in the
  context.
* The hint field is also provided by `default_get`: the first onchange of a new record fills every
  field without a value from `default_get`, before computed fields run.
* Digit normalisation for local search: `digitsOnly()` and `phoneSearchDigits()`
  (`static/src/app/phone_utils.js`). Server-side normalisation is Odoo's own
  (`PHONE_REGEX_PATTERN`, reused by the index creation in `models/res_partner.py`).
