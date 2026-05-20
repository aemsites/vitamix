import { loadCSS } from '../../scripts/aem.js';
import { formatPrice } from '../../scripts/commerce-config.js';

loadCSS('/blocks/cart/warranty-selector.css');

/**
 * Builds the warranty-tier radio group for a product row in the cart.
 *
 * @param {Object} item              The product cart entry (must carry `local.availableWarranties`)
 * @param {Object|null} linkedWarranty The current linked warranty cart entry, or null
 * @param {Function} onSelect        Called with the selected tier when the user picks one
 * @param {string} currencyCode      Currency code for the price-delta label
 * @param {{ heading?: string, included?: string }} [strings]
 * @returns {HTMLElement|null}       The selector element, or null if there are no tiers
 */
export default function buildWarrantySelector(
  item,
  linkedWarranty,
  onSelect,
  currencyCode = 'USD',
  strings = {},
) {
  const tiers = item.local?.availableWarranties;
  if (!Array.isArray(tiers) || tiers.length === 0) return null;

  const { heading: headingText = 'Warranty', included = 'included' } = strings;

  const el = document.createElement('div');
  el.className = 'cart-item-warranty';

  const heading = document.createElement('div');
  heading.className = 'cart-item-warranty-heading';
  heading.textContent = headingText;
  el.appendChild(heading);

  const groupName = `warranty-${item.sku}`;
  tiers.forEach((tier) => {
    const label = document.createElement('label');
    label.className = 'cart-item-warranty-option';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = groupName;
    radio.value = tier.sku;
    radio.checked = linkedWarranty
      ? linkedWarranty.sku === tier.sku
      : Boolean(tier.isDefault);
    radio.addEventListener('change', () => {
      if (radio.checked) onSelect(tier);
    });

    const text = document.createElement('span');
    const tierPrice = parseFloat(tier.price);
    if (tier.isDefault || tierPrice === 0) {
      text.textContent = `${tier.name} (${included})`;
    } else if (tier.coverageYears > 0) {
      const perYear = tierPrice / tier.coverageYears;
      text.textContent = `${tier.name} +${formatPrice(perYear, currencyCode)}/yr`;
    } else {
      text.textContent = `${tier.name} +${formatPrice(tierPrice, currencyCode)}`;
    }

    label.append(radio, text);
    el.appendChild(label);
  });

  return el;
}
