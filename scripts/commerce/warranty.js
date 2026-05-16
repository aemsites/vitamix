/**
 * Warranty helpers for PDP and edge-checkout cart line items.
 */

/**
 * @param {{ finalPrice?: string|number, price?: string }} [warranty]
 * @returns {number}
 */
export function getWarrantyPrice(warranty) {
  if (!warranty) return 0;
  const raw = warranty.finalPrice ?? warranty.price ?? 0;
  const value = typeof raw === 'string' ? parseFloat(raw) : raw;
  return Number.isFinite(value) ? value : 0;
}

/**
 * @param {{ name?: string, finalPrice?: string|number, price?: string }} warranty
 * @param {string} [freeLabel='Free']
 * @param {string} [currencyCode='USD']
 * @returns {string}
 */
export function formatWarrantyOptionLabel(warranty, freeLabel = 'Free', currencyCode = 'USD') {
  if (!warranty?.name) return '';
  const price = getWarrantyPrice(warranty);
  const priceLabel = price > 0
    ? new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode }).format(price)
    : freeLabel;
  return `${warranty.name} (${priceLabel})`;
}

/**
 * Stable cart line key — same SKU with different warranty stays separate.
 * @param {{ sku: string, selectedWarranty?: { uid?: string } }} item
 * @returns {string}
 */
export function getCartItemKey(item) {
  const warrantyUid = item.selectedWarranty?.uid;
  return warrantyUid ? `${item.sku}::${warrantyUid}` : item.sku;
}

/**
 * @param {string} key
 * @returns {string}
 */
export function cartItemDomId(key) {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * @param {{ basePrice?: number, price?: number|string|{ final?: number },
 *   selectedWarranty?: object }} item
 * @returns {number}
 */
export function getItemUnitPrice(item) {
  if (typeof item.unitPrice === 'number' && Number.isFinite(item.unitPrice)) {
    return item.unitPrice;
  }
  let base = item.basePrice;
  if (base == null) {
    if (typeof item.price === 'object' && item.price?.final != null) {
      base = item.price.final;
    } else {
      base = parseFloat(item.price);
    }
  }
  return (Number.isFinite(base) ? base : 0) + getWarrantyPrice(item.selectedWarranty);
}

/**
 * Rebuild selected_options after a warranty change.
 * @param {string[]} [selectedOptions]
 * @param {{ uid: string }[]} [warrantyOptions]
 * @param {{ uid?: string }} [selectedWarranty]
 * @returns {string[]}
 */
export function selectedOptionsWithWarranty(selectedOptions, warrantyOptions, selectedWarranty) {
  const warrantyUids = new Set((warrantyOptions || []).map((o) => o.uid).filter(Boolean));
  const next = (selectedOptions || []).filter((uid) => !warrantyUids.has(uid));
  if (selectedWarranty?.uid) next.push(selectedWarranty.uid);
  return next;
}
