/**
 * Builds the leadSource identifier sent with marketing subscription forms submitted
 * through the new (edge) AEM Forms endpoint. CA sites don't offer SMS enrollment, so
 * CA always resolves to the email-only variant. US resolves to email-only, email+SMS,
 * or SMS-only depending on the channels opted into.
 *
 * Only use this for submissions going to the new AEM Forms endpoint. Locales still on
 * legacy Magento must use `getLegacyLeadSource` instead — see its doc comment for why.
 * @param {string} page - form identifier, e.g. 'acc', 'reg', 'footer', 'modal'
 * @param {string} country - 'us' | 'ca'
 * @param {{ emailOptIn?: boolean, smsOptIn?: boolean }} [channels] - opted-in channels
 * @returns {string} lead source, e.g. 'sub-emsms-acc-us'
 */
export function getLeadSource(page, country, { emailOptIn = true, smsOptIn = false } = {}) {
  if (country !== 'us') return `sub-em-${page}-${country}`;
  if (smsOptIn && emailOptIn) return `sub-emsms-${page}-us`;
  if (smsOptIn && !emailOptIn) return `sub-sms-${page}-us`;
  return `sub-em-${page}-us`;
}

/**
 * Builds the leadSource identifier for submissions still going through legacy Magento.
 * Never varies by channel — encoding SMS opt-in into leadSource there previously caused
 * duplicate SMS subscriptions (fixed in commit f6c0267, "changing the leadsource to omit
 * sms"). SMS consent must still be sent as its own field in the payload; it just can't be
 * folded into this string for Magento-backed submissions.
 * @param {string} page - form identifier, e.g. 'footer', 'modal'
 * @param {string} country - 'us' | 'ca'
 * @returns {string} lead source, e.g. 'sub-em-footer-us'
 */
export function getLegacyLeadSource(page, country) {
  return `sub-em-${page}-${country}`;
}
