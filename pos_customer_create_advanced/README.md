# POS Customer Search & Quick Create Advanced (`pos_customer_create_advanced`)

Odoo 16 (Community & Enterprise). Depends on `point_of_sale` and `phone_validation` (both Community;
`phone_validation` is auto-installed with Discuss).

## Features

1. **Substring phone search, formatting-insensitive**
   * Local search (loaded customers): phone and mobile are also indexed as digits only, and a
     phone-like query (`+966 50`, `(555) 014`, `014-45`, `٠٥٥ ١١١`) is reduced to ASCII digits,
     so any digit sequence matches anywhere in the number: `0144567` finds `+1 (555) 014-4567`.
   * Leading zeros of the query are ignored, so the local way of typing a number (`0500477818`)
     finds it when it is saved with its country code (`+966500477818`).
   * Server search ("Search more" and the automatic lookup): a phone-like query searches only
     `res.partner.pos_phone_digits`, a stored field holding the digits of phone and mobile, with a
     trigram (GIN) index. Text queries keep the standard fields (name, company, phone, mobile,
     email, VAT), matched anywhere in the value.
   * Automatic server lookup: a phone query (3+ digits) with no local match is sent to the server
     once the cashier pauses typing (300 ms), once per query; out-of-date answers do not drive the
     screen. Offline/timeouts are silent.
2. **Phone pre-filled on creation**: a phone search with no result shows
   "Create customer with phone ...". That button and the standard **Create** button both open the
   form with `phone` = the searched number.
3. **Default customer name per POS**: *Point of Sale > Configuration > Settings > Customer
   Onboarding*. When enabled, a new customer saved from that POS with a phone/mobile and no name
   gets the configured name. A typed name always wins; existing customers are never renamed; with
   the option off, Odoo's standard "A Customer Name Is Required" check applies. The form shows
   "If left empty, saved as <name>" next to the name field.
4. **International phone format (E.164) per POS**, on by default (*Customer Onboarding >
   International Phone Format*). When a cashier saves a customer, `phone` and `mobile` are stored as
   `+<country code><number>`, as SMS and WhatsApp gateways expect:
   * `0500477818`, `050 047 7818`, `00966500477818`, `٠٥٠٠٤٧٧٨١٨` → `+966500477818` (Saudi Arabia);
     works for every country through Odoo's `phone_validation` (Google libphonenumber metadata).
   * Country used: the one selected on the POS customer form (pre-filled with the company's), else
     the customer's existing country, else the POS company's country.
   * A number that is not valid for that country is saved as typed: the cashier is never blocked.
   * Editing a customer from the POS only reformats the numbers the cashier changed.
   * Applies to customers saved from the POS (`create_from_ui` with the POS id); backend forms,
     imports and API calls are not changed.
   * Needs the `phonenumbers` Python library (`pip install phonenumbers`); the settings page shows
     a warning when it is missing, and numbers are then saved as typed.

## Performance (measured, 1,000,000 partners, PostgreSQL 16)

Server query per lookup, `LIMIT 30`, ordered like Odoo (`complete_name, id DESC`):

| Query | Matches | Odoo 16 standard | 16.0.1.0.1 | 16.0.1.1.0 |
|---|---|---|---|---|
| `0551112233` (new customer) | 0 | 3.2 s | 4.3 s | **1.9 ms** |
| `757 4187` | 34 | 3.3 s | 4.1 s | **1.3 ms** |
| `4187` | 916 | 0.37 s | 1.1 s | **3.0 ms** |
| `456` | 8,732 | 0.29 s | 1.1 s | **6.4 ms** |

Install on 1M partners: column backfill in SQL ~22 s, index build ~3 s (index ~36 MB).
Without `pg_trgm` the same query is a scan of one short column: ~0.24 s.

POS browser, cost of one keystroke for a number not found locally:
10k loaded customers 6 ms, 50k 25 ms, 200k 108 ms (16.0.1.0.1: 15 / 73 / 311 ms).

### Deployment notes for large databases

* `pg_trgm` is a trusted extension (PostgreSQL 13+): the module enables it when the Odoo database
  user owns the database. Otherwise run `CREATE EXTENSION pg_trgm;` as a superuser, then upgrade
  the module; a warning is logged until then.
* Enable **Limited Partners Loading** on POS configurations (and keep "Load all remaining partners
  in the background" off): loading hundreds of thousands of customers into a browser is slow on
  any version; the server lookup finds the others as the cashier types.
* Trade-off: on the server, a query made of digits only (e.g. `2023`) searches phone numbers, not
  names. Loaded customers are still matched on name locally.

## Tests

Verified on Odoo 16.0 (Community): 27 tests, 0 failures (22 unit tests + 5 Chrome tours).

```bash
odoo-bin -d test_db -i pos_customer_create_advanced --test-tags /pos_customer_create_advanced --stop-after-init
```

* `test_phone_search.py`: stored digits (compute, recompute on write, Arabic-Indic digits),
  substring search, SQL backfill = ORM compute, trigram index present.
* `test_default_customer_name.py`: constraint, trimming, per-terminal values, settings, POS loading.
* `test_phone_e164.py`: Saudi numbers typed 5 ways, company vs customer country, EG/AE/FR/GB/US,
  invalid numbers kept, option off, non-POS callers untouched, edits, search after formatting.
* `test_frontend.py`: 4 web tours (`HttpCase`): substring search incl. a server-only customer,
  phone pre-fill from the empty state, default-name injection (and typed name priority),
  feature disabled keeps the standard check, and `0500477818` saved as `+966500477818` then found
  again by typing `0500477818`.

## Technical notes

* POS JS: `PartnerListScreen` and `PartnerDetailsEdit` extended with `Registries.Component.extend`.
  `PosDB` is patched with plain prototype wrappers, **not** `include()`: `env.pos.db` is behind an
  Owl reactive proxy and `include()` writes `this._super` during render, causing an endless render
  loop. The local search cache lives in a `WeakMap` keyed on the raw db for the same reason.
* `PartnerListScreen.getNewPartners` is replaced (core builds its domain inline); the RPC is the
  same and the domain is exposed through `_ccaGetPartnerSearchDomain(query)`.
* The POS adds `pos_config_id` to the values sent to `res.partner.create_from_ui`; the override
  removes it before calling the standard method (only `point_of_sale` overrides this method in 16.0).
* Digit normalisation exists in three places that must agree: `phone_digits()` and
  `PHONE_DIGITS_SQL` (`models/res_partner.py`) and `digitsOnly()` (`static/src/js/phone_utils.js`).
