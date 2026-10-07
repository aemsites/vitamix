import { isIndexProductOutOfStock } from '../../scripts/plp-data.js';

/**
 * Uses a details CTA only when every SKU is explicitly unavailable.
 * Missing availability data does not mark a product as out of stock.
 */
export default function createProductCta(product, copy) {
  const outOfStock = isIndexProductOutOfStock(product);
  const wrap = document.createElement('p');
  wrap.className = 'product-list-widget-cta button-container';
  const link = document.createElement('a');
  link.href = product.url || '#';
  link.className = 'button link';
  link.textContent = outOfStock ? copy.viewDetails : copy.shopNow;
  wrap.appendChild(link);
  return wrap;
}
