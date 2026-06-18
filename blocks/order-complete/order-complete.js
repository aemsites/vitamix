import { getConfig, formatPrice } from '../../scripts/commerce-config.js';
import { getOrder } from '../../scripts/commerce-api.js';
import { logOperation, getCheckoutId, clearCheckoutId } from '../../scripts/operations-log.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';

export function normalizeTotalsDiscounts(discounts = []) {
  return discounts.filter((discount) => Math.abs(parseFloat(discount?.amount)) > 0);
}

/**
 * Parses a JSON string, returning null on absent or malformed input.
 */
export function parseJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Returns true when cached confirmation data belongs to the order currently
 * being displayed. Cached display data (cart items, preview totals) is scoped
 * to the matching order so a stale cache from a previous order in the same tab
 * is never rendered against a different orderId.
 */
export function cachedOrderMatches(cachedOrder, orderId) {
  return !!cachedOrder && !!orderId && cachedOrder.id === orderId;
}

/**
 * Decides which order to render on the confirmation page, gating the success
 * UI on a successful API lookup:
 *
 *  - API order present                  → render it (authoritative).
 *  - API 404 / 403 (not found / not yours) → redirect; never fall back.
 *  - API transient error / not called   → fall back to the cached order, but
 *    only when it matches the orderId in the URL.
 *  - Otherwise                          → redirect.
 *
 * @returns {{ order: Object|null, redirect: boolean }}
 */
export function resolveConfirmationOrder({
  apiOrder, apiError, cachedOrder, cacheMatches,
} = {}) {
  if (apiOrder) return { order: apiOrder, redirect: false };
  if (apiError && (apiError.status === 404 || apiError.status === 403)) {
    return { order: null, redirect: true };
  }
  if (cacheMatches && cachedOrder) return { order: cachedOrder, redirect: false };
  return { order: null, redirect: true };
}

export function calculateConfirmationTotal({
  subtotal = 0,
  tax = 0,
  shippingRate = 0,
  discounts = [],
} = {}) {
  const hasFreeShipping = discounts.some((discount) => discount?.freeShipping);
  const shippingAmount = hasFreeShipping ? 0 : (parseFloat(shippingRate) || 0);
  const discountAmount = normalizeTotalsDiscounts(discounts).reduce(
    (sum, discount) => sum + (Math.abs(parseFloat(discount.amount)) || 0),
    0,
  );

  return Math.round(Math.max(0, subtotal - discountAmount + shippingAmount + tax) * 100) / 100;
}

/**
 * Order confirmation / cancellation page.
 *
 * Success: Chase / PayPal → API → redirect here with ?orderId=...
 * Cancel:  Chase / PayPal → API → redirect here with ?orderId=...&reason=...
 *   reason values: customer_cancelled | payment_failed | declined
 *
 * Order display data is fetched from the API using the orderId (URL) and the
 * email proof held in sessionStorage. A successful lookup gates the success UI:
 * a not-found / forbidden response redirects rather than rendering a forged
 * confirmation. The tab-scoped sessionStorage cache survives a refresh and is
 * used for first paint and as a transient fallback — but only when it belongs
 * to the orderId being displayed (totals/preview and enriched cartItems are not
 * stored on the order itself).
 */
export default async function decorate(block) {
  const config = getConfig();
  const s = config.getStrings();
  const { locale, language } = getLocaleAndLanguage();
  const storeRootPath = `/${locale}/${language}/`;
  const currencyCode = typeof config.currency === 'function' ? config.currency(config.getLocale()) : config.currency;
  const params = Object.fromEntries(new URLSearchParams(window.location.search).entries());

  // Landing on the confirmation page is the return point of the checkout
  // journey (whether or not a payment redirect was involved).
  logOperation('checkout-redirect-return', {
    checkoutId: getCheckoutId(),
    orderId: params.orderId || params.id,
    ...(params.reason ? { reason: params.reason } : {}),
  });

  // cancelled or failed payment
  if (params.reason) {
    logOperation('checkout-failed', {
      checkoutId: getCheckoutId(),
      orderId: params.orderId || params.id,
      reason: params.reason,
    });

    const container = document.createElement('div');
    container.className = 'order-result order-cancelled';

    const heading = document.createElement('h2');
    heading.textContent = s.orderPaymentNotCompleted;
    container.appendChild(heading);

    const msg = document.createElement('p');
    msg.textContent = params.reason === 'customer_cancelled'
      ? s.orderPaymentCancelled
      : s.orderPaymentFailed;
    container.appendChild(msg);

    const link = document.createElement('p');
    const returnLink = document.createElement('a');
    returnLink.href = getConfig().getOrderPath('checkout');
    returnLink.className = 'button emphasis';
    returnLink.textContent = s.orderReturnToCheckout;
    link.appendChild(returnLink);
    container.appendChild(link);

    block.replaceChildren(container);
    return;
  }

  // success flow
  const orderId = params.orderId || params.id;
  const email = params.email || sessionStorage.getItem('checkout_email');

  if (!orderId) {
    window.location.href = storeRootPath;
    return;
  }

  // First-paint cache written before the payment redirect. It is tab-scoped:
  // it survives a refresh, is overwritten by the next order, and is cleared
  // when the tab closes — so it is intentionally not removed here.
  const cachedOrder = parseJson(sessionStorage.getItem('checkout_order'));
  let preview = parseJson(sessionStorage.getItem('checkout_preview'));
  let cartItems = parseJson(sessionStorage.getItem('checkout_cart_items'));

  // Only trust cached display data when it belongs to the order in the URL,
  // so a stale cache from a previous order in the same tab is never rendered
  // against a different orderId.
  const cacheMatches = cachedOrderMatches(cachedOrder, orderId);
  if (!cacheMatches) {
    preview = null;
    cartItems = null;
  }

  // clear the cart (the shopping cart, not the confirmation cache)
  try {
    const { default: cart } = await import('../../scripts/cart.js');
    cart.clear();
  } catch {
    // cart may not be available
  }

  // The API is the source of truth and the validation gate. Fetch the order
  // using the email proof held in sessionStorage. A definitive not-found /
  // forbidden response means the orderId is bogus or not ours — redirect
  // rather than render a forged confirmation. A transient failure (or no
  // email available) falls back to the cached order only when it matches.
  let apiOrder = null;
  let apiError = null;
  if (email) {
    try {
      const result = await getOrder(email, orderId);
      apiOrder = result.order;
    } catch (err) {
      apiError = err;
    }
  }

  const { order, redirect } = resolveConfirmationOrder({
    apiOrder, apiError, cachedOrder, cacheMatches,
  });
  if (redirect || !order) {
    window.location.href = storeRootPath;
    return;
  }

  // build confirmation page
  const container = document.createElement('div');
  container.className = 'order-result order-confirmed';

  // header section
  const headerSection = document.createElement('div');
  headerSection.className = 'order-header';

  const checkmark = document.createElement('div');
  checkmark.className = 'order-checkmark';
  checkmark.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#2e7d32" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-5"/></svg>';
  headerSection.appendChild(checkmark);

  const heading = document.createElement('h2');
  heading.textContent = s.orderThankYou;
  headerSection.appendChild(heading);

  const orderIdEl = document.createElement('p');
  orderIdEl.className = 'order-id';
  const orderIdLabel = document.createElement('span');
  orderIdLabel.textContent = `${s.orderIdLabel} `;
  const orderIdValue = document.createElement('strong');
  const friendlyOrderNumber = order?.friendlyId || order?.number || order?.orderNumber
    || `#${orderId.replace(/-/g, '').slice(-8).toUpperCase()}`;
  orderIdValue.textContent = friendlyOrderNumber;
  orderIdEl.append(orderIdLabel, orderIdValue);
  headerSection.appendChild(orderIdEl);

  if (email) {
    const emailEl = document.createElement('p');
    emailEl.className = 'order-email';
    emailEl.textContent = s.orderConfirmationEmail.replace('{email}', email);
    headerSection.appendChild(emailEl);
  }

  container.appendChild(headerSection);

  // two-column layout: items + totals on left, shipping on right
  const detailsGrid = document.createElement('div');
  detailsGrid.className = 'order-details';

  // left column: items + totals
  const leftCol = document.createElement('div');
  leftCol.className = 'order-details-left';

  // items
  const displayItems = cartItems?.length ? cartItems : order?.items;
  if (displayItems?.length) {
    const itemsSection = document.createElement('div');
    itemsSection.className = 'order-items';

    const itemsHeading = document.createElement('h3');
    itemsHeading.textContent = s.orderItemsOrdered;
    itemsSection.appendChild(itemsHeading);

    displayItems.forEach((item) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'order-item';

      const imgWrapper = document.createElement('div');
      imgWrapper.className = 'order-item-image';
      const imageSrc = item.image || (item.custom?.linkedTo ? '/icons/full-warranty.svg' : null);
      if (imageSrc) {
        const img = document.createElement('img');
        img.src = imageSrc;
        img.alt = item.name || '';
        imgWrapper.appendChild(img);
      }
      itemEl.appendChild(imgWrapper);

      const details = document.createElement('div');
      details.className = 'order-item-details';

      const name = document.createElement('p');
      name.className = 'order-item-name';
      name.textContent = item.name || item.sku;
      details.appendChild(name);

      const variantLabel = item.variant
        || item.selectedOptions?.map((o) => o.value).join(' / ')
        || null;
      if (variantLabel) {
        const variant = document.createElement('p');
        variant.className = 'order-item-variant';
        variant.textContent = variantLabel;
        details.appendChild(variant);
      }

      const qty = document.createElement('p');
      qty.className = 'order-item-qty';
      qty.textContent = `${s.orderQtyLabel} ${item.quantity}`;
      details.appendChild(qty);

      itemEl.appendChild(details);

      const price = document.createElement('div');
      price.className = 'order-item-price';
      const unitPrice = parseFloat(item.price?.final || item.price) || 0;
      price.textContent = formatPrice(unitPrice * item.quantity, currencyCode);
      itemEl.appendChild(price);

      itemsSection.appendChild(itemEl);
    });
    leftCol.appendChild(itemsSection);
  }

  // totals — read from order.estimates (API); fall back to sessionStorage preview
  const est = order?.estimates;
  const totalsSubtotal = est
    ? order.items?.reduce((acc, i) => acc + parseFloat(i.price?.final || 0) * i.quantity, 0) ?? 0
    : parseFloat(preview?.subtotal);
  const totalsShippingMethod = est ? (est.shippingMethod || {}) : (preview?.shippingMethod || {});
  const totalsDiscounts = est ? (est.discounts || []) : (preview?.discounts || []);
  const totalsTax = parseFloat(est ? (est.tax?.amount || 0) : (preview?.taxAmount || 0));
  const totalsTotal = calculateConfirmationTotal({
    subtotal: totalsSubtotal,
    tax: totalsTax,
    shippingRate: totalsShippingMethod.rate,
    discounts: totalsDiscounts,
  });

  if (est || preview) {
    const totalsSection = document.createElement('div');
    totalsSection.className = 'order-totals';

    const shippingRate = totalsShippingMethod.rate;
    const hasFreeShipping = totalsDiscounts.some((discount) => discount?.freeShipping);
    const shippingDisplay = hasFreeShipping || shippingRate === 0
      ? (s.free || 'Free')
      : formatPrice(parseFloat(shippingRate || 0), currencyCode);

    const rows = [
      [s.subtotal, formatPrice(totalsSubtotal, currencyCode)],
      [s.shipping, shippingDisplay],
    ];

    normalizeTotalsDiscounts(totalsDiscounts).forEach((discount) => {
      const label = discount.name || s.discount;
      const amount = Math.abs(parseFloat(discount.amount));
      const value = formatPrice(-amount, currencyCode);
      rows.push([label, value, 'order-totals-discount']);
    });

    rows.push([s.orderTax, formatPrice(totalsTax, currencyCode)]);

    rows.forEach(([label, value, extraClass]) => {
      const row = document.createElement('div');
      row.className = extraClass ? `order-totals-row ${extraClass}` : 'order-totals-row';
      const labelEl = document.createElement('span');
      labelEl.textContent = label;
      const valueEl = document.createElement('span');
      valueEl.textContent = value;
      row.append(labelEl, valueEl);
      totalsSection.appendChild(row);
    });

    const totalRow = document.createElement('div');
    totalRow.className = 'order-totals-row order-totals-total';
    const totalLabel = document.createElement('strong');
    totalLabel.textContent = s.total;
    const totalValue = document.createElement('strong');
    totalValue.textContent = formatPrice(totalsTotal, currencyCode);
    totalRow.append(totalLabel, totalValue);
    totalsSection.appendChild(totalRow);

    leftCol.appendChild(totalsSection);
  }

  detailsGrid.appendChild(leftCol);

  // right column: shipping address
  const rightCol = document.createElement('div');
  rightCol.className = 'order-details-right';

  if (order?.shipping) {
    const addrSection = document.createElement('div');
    addrSection.className = 'order-shipping-address';

    const addrHeading = document.createElement('h3');
    addrHeading.textContent = s.orderShippingAddress;
    addrSection.appendChild(addrHeading);

    const addr = order.shipping;
    const lines = [
      addr.name,
      addr.company,
      addr.address1,
      addr.address2,
      `${addr.city}, ${addr.state} ${addr.zip}`,
      addr.country?.toUpperCase(),
    ].filter(Boolean);

    lines.forEach((line) => {
      const p = document.createElement('p');
      p.textContent = line;
      addrSection.appendChild(p);
    });

    rightCol.appendChild(addrSection);
  }

  if (order?.customer) {
    const contactSection = document.createElement('div');
    contactSection.className = 'order-contact';

    const contactHeading = document.createElement('h3');
    contactHeading.textContent = s.orderContact;
    contactSection.appendChild(contactHeading);

    const contactEmail = document.createElement('p');
    contactEmail.textContent = order.customer.email;
    contactSection.appendChild(contactEmail);

    if (order.customer.phone) {
      const contactPhone = document.createElement('p');
      contactPhone.textContent = order.customer.phone;
      contactSection.appendChild(contactPhone);
    }

    rightCol.appendChild(contactSection);
  }

  if (order?.giftMessage) {
    const giftSection = document.createElement('div');
    giftSection.className = 'order-gift-message';

    const giftHeading = document.createElement('h3');
    giftHeading.textContent = s.orderGiftMessage;
    giftSection.appendChild(giftHeading);

    const giftText = document.createElement('p');
    giftText.textContent = order.giftMessage;
    giftSection.appendChild(giftText);

    rightCol.appendChild(giftSection);
  }

  detailsGrid.appendChild(rightCol);
  container.appendChild(detailsGrid);

  // continue shopping
  const actions = document.createElement('div');
  actions.className = 'order-actions';
  const continueLink = document.createElement('a');
  continueLink.href = storeRootPath;
  continueLink.className = 'button emphasis';
  continueLink.textContent = s.continueShopping;
  actions.appendChild(continueLink);
  container.appendChild(actions);

  block.replaceChildren(container);

  logOperation('checkout-complete', {
    checkoutId: getCheckoutId(),
    orderId,
    total: totalsTotal,
    itemCount: displayItems?.reduce((acc, i) => acc + (i.quantity || 0), 0),
  });
  clearCheckoutId();
}
