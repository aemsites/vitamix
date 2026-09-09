import buildWarrantySelector from './warranty-selector.js';

/**
 * Builds the site-specific warranty selector extension for a cart row.
 *
 * The generic cart block invokes this through CommerceConfig.cartItemExtensionModules;
 * this module owns Vitamix warranty behavior, including hidden linked warranty
 * line items.
 *
 * @param {{
 *   item: Object,
 *   items: Object[],
 *   cart: Object,
 *   isMinicart: boolean,
 *   strings: Object,
 *   currencyCode: string,
 * }} context
 * @returns {HTMLElement|null}
 */
export default function buildWarrantySelectorExtension({
  item,
  items,
  cart,
  isMinicart,
  strings,
  currencyCode,
}) {
  // The minicart keeps the row compact — the warranty selector renders only in
  // the full cart view.
  if (isMinicart) return null;

  const linkedWarranty = items.find((i) => i.custom?.linkedTo === item.sku) || null;

  return buildWarrantySelector(
    item,
    linkedWarranty,
    (tier) => {
      if (linkedWarranty) {
        cart.removeItem(linkedWarranty.sku, linkedWarranty.custom?.linkedTo);
      }
      if (tier && !tier.isDefault && parseFloat(tier.price) > 0) {
        cart.addItem({
          sku: tier.sku,
          path: tier.path,
          quantity: item.quantity,
          price: tier.price,
          name: tier.name,
          custom: {
            linkedTo: item.sku,
            ...(tier.coverageYears ? { coverageYears: tier.coverageYears } : {}),
          },
          local: { showInCart: false },
        }, { allowSeparateEntry: true });
      }
    },
    currencyCode,
    { heading: strings.warranty, included: strings.included },
  );
}
