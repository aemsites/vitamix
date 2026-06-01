import { loadCSS } from './aem.js';
import { getConfig } from './commerce-config.js';

loadCSS('/scripts/cart-compatibility.css');

const STRINGS = {
  'en-us': {
    notCompatibleWith: 'This item is not compatible with the {products}',
  },
  'fr-ca': {
    notCompatibleWith: 'Cet article n’est pas compatible avec {products}',
  },
};

function getStrings() {
  const config = getConfig();
  const key = config.getLanguage().toLowerCase().replace('_', '-');
  return STRINGS[key] || STRINGS['en-us'];
}

function getCompatibilityData(item) {
  return item.local?.compatibility || item.custom || {};
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function getAllowedLabels(compatibleWith) {
  if (!Array.isArray(compatibleWith)) return new Set();
  return new Set(
    compatibleWith
      .map((entry) => normalize(entry?.label ?? entry))
      .filter(Boolean),
  );
}

function getVisibleCartItems(items) {
  return items.filter((item) => item.local?.showInCart !== false && !item.custom?.giftWithPurchase);
}

/**
 * Builds an optional compatibility warning for a cart line item.
 *
 * This module is site-specific, but the cart consumes it through the generic
 * CommerceConfig.cartItemExtensions hook. The generic cart/cart-item components
 * do not know about Vitamix compatibility rules or Product Bus custom fields.
 *
 * @param {{ item: Object, items: Object[] }} context
 * @returns {HTMLElement|null}
 */
export default function buildCartCompatibilityWarning({ item, items }) {
  const compatibility = getCompatibilityData(item);

  // Match Magento cart behavior: warnings render on non-configurable products
  // that declare allowed compatibility groups.
  if (compatibility.type === 'configurable') return null;

  const allowedLabels = getAllowedLabels(compatibility.compatibleWith);
  if (!allowedLabels.size) return null;

  const incompatibleProducts = getVisibleCartItems(items)
    .filter((other) => other !== item)
    .filter((other) => getCompatibilityData(other).type === 'configurable')
    .filter((other) => {
      const group = normalize(getCompatibilityData(other).compatibilityGroup);
      return group && !allowedLabels.has(group);
    })
    .map((other) => other.name)
    .filter(Boolean);

  if (!incompatibleProducts.length) return null;

  const warning = document.createElement('p');
  warning.className = 'cart-item-compatibility-warning';
  warning.textContent = getStrings().notCompatibleWith.replace(
    '{products}',
    incompatibleProducts.join(', '),
  );
  return warning;
}
