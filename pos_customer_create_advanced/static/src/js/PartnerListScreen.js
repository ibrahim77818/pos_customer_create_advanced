odoo.define('pos_customer_create_advanced.PartnerListScreen', function (require) {
    'use strict';

    const PartnerListScreen = require('point_of_sale.PartnerListScreen');
    const Registries = require('point_of_sale.Registries');
    const { debounce } = require('@web/core/utils/timing');
    const { phoneSearchDigits, isPhoneLike } = require('pos_customer_create_advanced.phone_utils');

    const { onWillUnmount } = owl;

    /** Stored, trigram-indexed digits of phone and mobile on res.partner. */
    const PHONE_DIGITS_FIELD = 'pos_phone_digits';
    const TEXT_SEARCH_FIELDS = ['name', 'parent_name', 'phone', 'mobile', 'email', 'vat'];
    const SERVER_SEARCH_LIMIT = 30;
    /** Wait for the cashier to pause typing before asking the server. */
    const REMOTE_LOOKUP_DELAY = 300;

    const PosCcaPartnerListScreen = (PartnerListScreen) =>
        class extends PartnerListScreen {
            setup() {
                super.setup();
                this.state.ccaSearching = false;
                // Phone queries already answered by the server.
                this._ccaRemoteQueries = new Set();
                this._ccaLookupSeq = 0;
                this._ccaScheduleLookup = debounce(this._ccaRemoteLookup, REMOTE_LOOKUP_DELAY);
                onWillUnmount(() => this._ccaScheduleLookup.cancel());
            }

            //------------------------------------------------------------------
            // Getters
            //------------------------------------------------------------------

            get ccaQuery() {
                return (this.state.query || '').trim();
            }
            /** The typed query when it looks like a phone number, else false. */
            get ccaPhoneFromQuery() {
                const query = this.ccaQuery;
                return isPhoneLike(query) ? query : false;
            }
            get ccaHasLocalMatch() {
                const query = this.ccaQuery;
                // search_partner is cached: no extra scan for the same query.
                return !query || this.env.pos.db.search_partner(query).length > 0;
            }
            get ccaShowEmptyState() {
                return !this.state.detailIsShown && Boolean(this.ccaQuery) && !this.ccaHasLocalMatch;
            }

            //------------------------------------------------------------------
            // Search
            //------------------------------------------------------------------

            /**
             * Debounced by the base `setup` (70 ms). A phone query without a
             * local match is then looked up on the server once the cashier
             * pauses typing, so customers not loaded in the POS ("Limited
             * Partners Loading") are found without pressing "Search more".
             */
            async updatePartnerList(event) {
                await super.updatePartnerList(event);
                const query = this.ccaQuery;
                if (!isPhoneLike(query) || this._ccaRemoteQueries.has(query) || this.ccaHasLocalMatch) {
                    this._ccaScheduleLookup.cancel();
                    if (this.state.ccaSearching) {
                        this.state.ccaSearching = false;
                        this.render(true);
                    }
                    return;
                }
                if (!this.state.ccaSearching) {
                    this.state.ccaSearching = true;
                    this.render(true);
                }
                this._ccaScheduleLookup(query);
            }

            /**
             * One request per pause in typing. Responses for an older query
             * are still added to the local customers but no longer drive the
             * screen. Independent of the "Search more" paging state.
             */
            async _ccaRemoteLookup(query) {
                if (query !== this.ccaQuery) {
                    return;
                }
                const seq = ++this._ccaLookupSeq;
                try {
                    const partners = await this._ccaFetchPartners(query, 0);
                    this.env.pos.addPartners(partners);
                    this._ccaRemoteQueries.add(query);
                } catch (error) {
                    // Best effort: offline or timeout must not interrupt the
                    // cashier; the query can be retried by typing or "Search more".
                    console.warn('pos_customer_create_advanced: server customer lookup failed', error);
                } finally {
                    if (seq === this._ccaLookupSeq) {
                        this.state.ccaSearching = false;
                        this.render(true);
                    }
                }
            }

            /**
             * Server domain. A phone-like query only searches the indexed
             * digits field: one indexed condition, answered in milliseconds on
             * large customer tables. Mixing it with `ilike` on name, email...
             * would force PostgreSQL to scan the whole table (OR of conditions
             * that cannot all use an index). Other queries keep the standard
             * fields, with `ilike` matching anywhere in the value.
             */
            _ccaGetPartnerSearchDomain(query) {
                if (!query) {
                    return [];
                }
                if (isPhoneLike(query, 1)) {
                    return [[PHONE_DIGITS_FIELD, 'ilike', phoneSearchDigits(query)]];
                }
                const leaves = TEXT_SEARCH_FIELDS.map((field) => [field, 'ilike', query]);
                return [...Array(leaves.length - 1).fill('|'), ...leaves];
            }

            _ccaFetchPartners(query, offset) {
                return this.env.services.rpc(
                    {
                        model: 'pos.session',
                        method: 'get_pos_ui_res_partner_by_params',
                        args: [
                            [odoo.pos_session_id],
                            {
                                domain: this._ccaGetPartnerSearchDomain(query),
                                limit: SERVER_SEARCH_LIMIT,
                                offset: offset,
                            },
                        ],
                        context: this.env.session.user_context,
                    },
                    {
                        timeout: 3000,
                        shadow: true,
                    }
                );
            }

            /**
             * Standard "Search more" / Enter: same RPC as core, only the domain
             * differs (core builds a prefix pattern inline, with no hook).
             */
            async getNewPartners() {
                return this._ccaFetchPartners(this.ccaQuery, this.state.currentOffset);
            }

            //------------------------------------------------------------------
            // Creation
            //------------------------------------------------------------------

            /**
             * Tell the server which POS saves the customer, so its options
             * (international phone format) apply. `res.partner.create_from_ui`
             * removes this key before writing the customer.
             */
            async saveChanges(event) {
                const changes = event && event.detail && event.detail.processedChanges;
                if (changes) {
                    changes.pos_config_id = this.env.pos.config.id;
                }
                return super.saveChanges(...arguments);
            }

            /** Open the standard creation form with the searched phone filled in. */
            createPartner() {
                const phone = this.ccaPhoneFromQuery;
                super.createPartner(...arguments);
                const partner = this.state.editModeProps.partner;
                if (phone && partner && !partner.id) {
                    partner.phone = phone;
                }
            }
        };

    Registries.Component.extend(PartnerListScreen, PosCcaPartnerListScreen);

    return PartnerListScreen;
});
