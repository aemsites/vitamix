/**
 * Free-shipping benefit modes shared by cart rules and coupons (helix-commerce-api).
 * Maps UI `none` | `standard` | `standard-priority` to `freeShipping` + `includedShippingTypes`.
 */

/** @typedef {'none' | 'standard' | 'standard-priority'} ShippingBenefitMode */

/** @type {ReadonlyArray<{ value: ShippingBenefitMode, label: string }>} */
export const SHIPPING_BENEFIT_OPTIONS = [
  { value: 'none', label: 'No Free Shipping' },
  { value: 'standard', label: 'Free Standard Shipping' },
  { value: 'standard-priority', label: 'Free Priority and Standard Shipping' },
];

/**
 * @param {unknown} raw
 * @returns {ShippingBenefitMode}
 */
export function normalizeShippingBenefitMode(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'standard-priority' || s === 'standard_priority') return 'standard-priority';
  if (s === 'standard' || s === 'yes') return 'standard';
  return 'none';
}

/**
 * @param {{ freeShipping?: boolean, includedShippingTypes?: string[] }} [fields]
 * @returns {ShippingBenefitMode}
 */
export function shippingBenefitModeFromFields(fields) {
  if (!fields || fields.freeShipping !== true) return 'none';
  const types = Array.isArray(fields.includedShippingTypes)
    ? fields.includedShippingTypes.map((t) => String(t).trim().toLowerCase()).filter(Boolean)
    : [];
  const hasPriority = types.includes('priority');
  const hasStandard = types.includes('standard') || types.length === 0;
  if (hasStandard && hasPriority) return 'standard-priority';
  if (hasStandard) return 'standard';
  return 'standard';
}

/**
 * @param {ShippingBenefitMode} mode
 * @returns {{ freeShipping: boolean, includedShippingTypes?: string[] }}
 */
export function shippingBenefitFieldsFromMode(mode) {
  if (mode === 'standard') {
    return { freeShipping: true, includedShippingTypes: ['standard'] };
  }
  if (mode === 'standard-priority') {
    return { freeShipping: true, includedShippingTypes: ['standard', 'priority'] };
  }
  return { freeShipping: false };
}

/**
 * @param {ShippingBenefitMode | string} mode
 * @returns {string}
 */
export function shippingBenefitModeLabel(mode) {
  const m = normalizeShippingBenefitMode(mode);
  const hit = SHIPPING_BENEFIT_OPTIONS.find((o) => o.value === m);
  return hit ? hit.label : SHIPPING_BENEFIT_OPTIONS[0].label;
}

/**
 * @param {string} selected
 * @param {(s: string) => string} escape
 * @returns {string}
 */
export function shippingBenefitSelectOptionsHtml(selected, escape) {
  const sel = normalizeShippingBenefitMode(selected);
  return SHIPPING_BENEFIT_OPTIONS.map((o) => {
    const picked = o.value === sel ? ' selected' : '';
    return `<option value="${escape(o.value)}"${picked}>${escape(o.label)}</option>`;
  }).join('');
}

/**
 * @param {ShippingBenefitMode | string} mode
 * @returns {number}
 */
export function shippingBenefitModeSortRank(mode) {
  const m = normalizeShippingBenefitMode(mode);
  if (m === 'standard-priority') return 2;
  if (m === 'standard') return 1;
  return 0;
}

/**
 * @param {object} row coupon or list row
 * @returns {ShippingBenefitMode}
 */
export function couponShippingModeFromRow(row) {
  return shippingBenefitModeFromFields({
    freeShipping: row?.freeShipping,
    includedShippingTypes: row?.includedShippingTypes ?? row?.included_shipping_types,
  });
}
