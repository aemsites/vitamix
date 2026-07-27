import { loadCSS } from '../../scripts/aem.js';
import { getConfig, formatPrice } from '../../scripts/commerce-config.js';
import { getOrder, confirmPayment, cancelPayment } from '../../scripts/commerce-api.js';
import { logOperation, getCheckoutId } from '../../scripts/operations-log.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';
import {
  parseJson,
  cachedOrderMatches,
  resolveConfirmationOrder,
  calculateConfirmationTotal,
  normalizeTotalsDiscounts,
} from '../order-complete/order-complete.js';

/**
 * Generates a fresh idempotency key for a confirm / cancel attempt.
 * A new key is minted per attempt so a retry after a transient failure is a
 * distinct request, while the server treats repeats of the *same* key as safe.
 *
 * @returns {string}
 */
export function newIdempotencyKey() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

/**
 * Maps a payments/confirm response status to the storefront routing action.
 *
 *  - `completed` → the charge captured; route to the order-complete page.
 *  - `pending`   → captured asynchronously; route to order-complete (processing).
 *  - anything else (`failed` / unknown) → stay on the review page and surface
 *    the error; do not route away.
 *
 * @param {{ status?: string }} [result]
 * @returns {{ action: 'complete'|'processing'|'failed' }}
 */
export function resolveConfirmResult(result = {}) {
  if (result.status === 'completed') return { action: 'complete' };
  if (result.status === 'pending') return { action: 'processing' };
  return { action: 'failed' };
}

/**
 * Builds the "Complete order" click handler. Calls the injected confirm
 * function with a fresh idempotency key, then routes on the resolved action
 * or surfaces the failure without navigating away.
 *
 * State handling is intentionally decoupled from order-complete: this block
 * owns the confirm/cancel lifecycle, order-complete owns the post-payment
 * display. Only the pure rendering/resolution helpers are shared.
 *
 * @param {Object} deps
 * @param {string} deps.orderId
 * @param {(orderId: string, key: string) => Promise<Object>} deps.confirm
 * @param {(action: 'complete'|'processing') => void} deps.routeTo
 * @param {(message: string) => void} deps.onError
 * @param {(busy: boolean) => void} [deps.setBusy]
 * @param {string} deps.errorMessage
 * @param {() => string} [deps.newKey]
 * @returns {() => Promise<void>}
 */
export function createConfirmHandler({
  orderId, confirm, routeTo, onError, setBusy, errorMessage, newKey = newIdempotencyKey,
}) {
  return async () => {
    setBusy?.(true);
    const idempotencyKey = newKey();
    try {
      const result = await confirm(orderId, idempotencyKey);
      const { action } = resolveConfirmResult(result);
      if (action === 'failed') {
        onError(result?.reason || errorMessage);
        setBusy?.(false);
        return;
      }
      routeTo(action);
    } catch {
      onError(errorMessage);
      setBusy?.(false);
    }
  };
}

/**
 * Builds the "Cancel and return to cart" handler. Best-effort cancels the
 * pending payment (releasing the PayPal authorization), then returns the buyer
 * to the cart regardless of the cancel outcome — the endpoint is idempotent, so
 * a background abandonment cancel can safely race with this one.
 *
 * @param {Object} deps
 * @param {string} deps.orderId
 * @param {(orderId: string, key: string) => Promise<Object>} deps.cancel
 * @param {() => void} deps.routeToCart
 * @param {() => string} [deps.newKey]
 * @returns {() => Promise<void>}
 */
export function createCancelHandler({
  orderId, cancel, routeToCart, newKey = newIdempotencyKey,
}) {
  return async () => {
    const idempotencyKey = newKey();
    try {
      await cancel(orderId, idempotencyKey);
    } catch {
      // Best-effort: navigate back to the cart even if the cancel call fails.
    }
    routeToCart();
  };
}

/**
 * Resolves the display totals for the review page from the order's API
 * estimates, falling back to the sessionStorage preview when estimates are
 * absent. Mirrors the order-complete totals derivation.
 *
 * @param {Object} order - API order (may carry `estimates`)
 * @param {Object|null} preview - sessionStorage preview fallback
 * @returns {{ subtotal: number, shippingMethod: Object, discounts: Array,
 *   tax: number, total: number }}
 */
export function resolveReviewTotals(order, preview) {
  const est = order?.estimates;
  const subtotal = est
    ? (order.items?.reduce(
      (acc, i) => acc + parseFloat(i.price?.final || 0) * i.quantity,
      0,
    ) ?? 0)
    : parseFloat(preview?.subtotal) || 0;
  const shippingMethod = est ? (est.shippingMethod || {}) : (preview?.shippingMethod || {});
  const discounts = est ? (est.discounts || []) : (preview?.discounts || []);
  const tax = parseFloat(est ? (est.tax?.amount || 0) : (preview?.taxAmount || 0));
  const total = calculateConfirmationTotal({
    subtotal, tax, shippingRate: shippingMethod.rate, discounts,
  });
  return {
    subtotal, shippingMethod, discounts, tax, total,
  };
}

/**
 * Builds the best-effort abandonment handler. When the buyer leaves the review
 * page without completing or explicitly cancelling, it fires a cancel so the
 * pending PayPal authorization is released. No-ops once the page has been
 * finalized (completed or explicitly cancelled) so it never races a successful
 * confirm; the cancel endpoint is idempotent regardless.
 *
 * @param {{ isFinalized: () => boolean, sendCancel: () => void }} deps
 * @returns {() => void}
 */
export function createAbandonmentHandler({ isFinalized, sendCancel }) {
  return () => {
    if (isFinalized()) return;
    sendCancel();
  };
}

/**
 * Fires a best-effort cancel that survives page unload. Uses `sendBeacon` when
 * available (guaranteed to flush on unload), falling back to a keepalive fetch.
 * Fire-and-forget: never throws.
 *
 * @param {Object} config - resolved commerce config (provides apiOrigin)
 * @param {string} orderId
 */
function sendCancelBeacon(config, orderId) {
  try {
    const url = `${config.apiOrigin}/orders/${encodeURIComponent(orderId)}/payments/cancel`;
    const body = JSON.stringify({ idempotencyKey: newIdempotencyKey() });
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    } else {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      });
    }
  } catch {
    // best-effort only
  }
}

/** Small helper to build an element with a class and optional text. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * Order-review page block (display-only).
 *
 * Reached after PayPal authorization when the order is in state
 * `payment_requires_confirmation`. Shipping / payment / address were chosen
 * earlier (in the express popup or on the checkout page), so this page renders
 * them as static, non-editable information — there are intentionally no edit,
 * change, or shipping-method-selection affordances (editable review is deferred;
 * see helix-commerce-api#490). The buyer either completes the order (captures
 * the authorization via the confirm endpoint) or cancels back to the cart.
 *
 * Order resolution reuses the order-complete pattern: the API lookup (orderId +
 * email proof) is the authoritative gate; a not-found / forbidden response
 * redirects rather than rendering a forged order. The orderId-scoped
 * sessionStorage cache provides first paint and a transient fallback.
 */
export default async function decorate(block) {
  const config = getConfig();
  const s = config.getStrings();
  const { locale, language } = getLocaleAndLanguage();
  const storeRootPath = `/${locale}/${language}/`;
  const currencyCode = typeof config.currency === 'function'
    ? config.currency(config.getLocale())
    : config.currency;
  const params = Object.fromEntries(new URLSearchParams(window.location.search).entries());

  const orderId = params.orderId || params.id;
  const email = params.email || sessionStorage.getItem('checkout_email');

  // Landing on the review page is a return point of the checkout journey.
  logOperation('checkout-redirect-return', {
    checkoutId: getCheckoutId(),
    orderId,
  });

  if (!orderId) {
    window.location.href = storeRootPath;
    return;
  }

  // orderId-scoped cache: written before the redirect, survives a refresh, and
  // is only trusted when it belongs to the orderId in the URL.
  const cachedOrder = parseJson(sessionStorage.getItem('checkout_order'));
  let preview = parseJson(sessionStorage.getItem('checkout_preview'));
  let cartItems = parseJson(sessionStorage.getItem('checkout_cart_items'));
  const cacheMatches = cachedOrderMatches(cachedOrder, orderId);
  if (!cacheMatches) {
    preview = null;
    cartItems = null;
  }

  // API is the source of truth and the validation gate.
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

  // The review layout relies on the shared commerce design tokens
  // (--commerce-*). Load them before building the DOM so card borders,
  // spacing, and the two-column grid resolve (mirrors checkout/cart-summary).
  await loadCSS('/styles/commerce-tokens.css');

  const totals = resolveReviewTotals(order, preview);
  const displayItems = cartItems?.length ? cartItems : order?.items;
  const paymentEmail = order?.customer?.email || email || '';

  // ── Build the page ────────────────────────────────────────────────
  const container = el('div', 'order-review-page');

  // Reassurance banner: authorized, nothing charged yet.
  const banner = el('div', 'order-review-banner');
  banner.setAttribute('role', 'status');
  banner.innerHTML = '<svg class="order-review-banner-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-5"/></svg>';
  banner.append(
    el('strong', 'order-review-banner-title', s.reviewBannerTitle),
    el('span', 'order-review-banner-body', s.reviewBannerBody),
  );
  container.appendChild(banner);

  // Heading row: title + subtitle + "Secured by PayPal" cue.
  const head = el('div', 'order-review-head');
  const headText = el('div', 'order-review-head-text');
  headText.append(
    el('h1', 'order-review-title', s.reviewHeading),
    el('p', 'order-review-subtitle', s.reviewSubtitle),
  );
  const secured = el('span', 'order-review-secured');
  secured.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';
  secured.appendChild(el('span', null, s.reviewSecuredByPaypal));
  head.append(headText, secured);
  container.appendChild(head);

  // Two-column grid: details left, order-total summary right.
  const grid = el('div', 'order-review-grid');
  const main = el('div', 'order-review-main');
  const aside = el('aside', 'order-review-aside');

  // — Shipping method (chosen, static) —
  const shipMethodCard = el('section', 'order-review-card order-review-shipping-method');
  const smHeader = el('div', 'order-review-card-header');
  smHeader.appendChild(el('h2', null, s.reviewShippingMethod));
  const addr = order?.shipping || {};
  const locationParts = [addr.city, [addr.state, addr.zip].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');
  if (locationParts) {
    smHeader.appendChild(el(
      'p',
      'order-review-card-sub',
      s.reviewDeliveringTo.replace('{location}', locationParts),
    ));
  }
  shipMethodCard.appendChild(smHeader);

  const method = totals.shippingMethod || {};
  const hasFreeShipping = totals.discounts.some((d) => d?.freeShipping);
  const methodRate = hasFreeShipping || method.rate === 0 || method.rate == null
    ? null
    : parseFloat(method.rate);
  const chosen = el('div', 'order-review-method');
  const methodLabel = method.label || method.name || method.title || s.shipping;
  chosen.appendChild(el('span', 'order-review-method-label', methodLabel));
  chosen.appendChild(el(
    'span',
    'order-review-method-price',
    methodRate ? formatPrice(methodRate, currencyCode) : (s.free || 'Free'),
  ));
  const eta = method.eta || method.deliveryEstimate || method.estimatedDelivery || method.arrival;
  if (eta) chosen.appendChild(el('span', 'order-review-method-eta', eta));
  shipMethodCard.appendChild(chosen);
  main.appendChild(shipMethodCard);

  // — Shipping address + Payment method (side by side, both static) —
  const infoRow = el('div', 'order-review-info-row');

  const addrCard = el('section', 'order-review-card order-review-address');
  addrCard.appendChild(el('h2', null, s.orderShippingAddress));
  const addrLines = [
    addr.name,
    addr.company,
    addr.address1,
    addr.address2,
    [addr.city, [addr.state, addr.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    addr.country?.toUpperCase(),
  ].filter(Boolean);
  const addrBody = el('div', 'order-review-address-body');
  addrLines.forEach((line) => addrBody.appendChild(el('p', null, line)));
  addrCard.appendChild(addrBody);
  const verified = el('p', 'order-review-verified');
  verified.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
  verified.appendChild(el('span', null, s.reviewVerifiedByPaypal));
  addrCard.appendChild(verified);
  infoRow.appendChild(addrCard);

  const payCard = el('section', 'order-review-card order-review-payment');
  payCard.appendChild(el('h2', null, s.reviewPaymentMethod));
  const payMethod = el('div', 'order-review-payment-method');
  payMethod.append(
    el('span', 'order-review-payment-name', s.reviewPaypalExpress),
    el('span', 'order-review-payment-email', paymentEmail),
  );
  payCard.appendChild(payMethod);
  const authNote = el('p', 'order-review-authorized');
  authNote.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';
  authNote.appendChild(el('span', null, s.reviewAuthorizedNotCharged));
  payCard.appendChild(authNote);
  infoRow.appendChild(payCard);
  main.appendChild(infoRow);

  // — Items (static line items) —
  if (displayItems?.length) {
    const itemsCard = el('section', 'order-review-card order-review-items');
    const itemCount = displayItems.reduce((acc, i) => acc + (i.quantity || 0), 0);
    const itemsHeader = el('div', 'order-review-card-header');
    itemsHeader.appendChild(el('h2', null, `${s.reviewItemsInOrder} · ${itemCount}`));
    itemsCard.appendChild(itemsHeader);

    const colHead = el('div', 'order-review-item order-review-item-head');
    colHead.append(
      el('span', 'order-review-col-item', s.reviewColItem),
      el('span', 'order-review-col-price', s.reviewColPrice),
      el('span', 'order-review-col-qty', s.reviewColQty),
      el('span', 'order-review-col-subtotal', s.reviewColSubtotal),
    );
    itemsCard.appendChild(colHead);

    displayItems.forEach((item) => {
      const row = el('div', 'order-review-item');

      const imgWrap = el('div', 'order-review-item-image');
      const imageSrc = item.image || (item.custom?.linkedTo ? '/icons/full-warranty.svg' : null);
      if (imageSrc) {
        const img = document.createElement('img');
        img.src = imageSrc;
        img.alt = item.name || '';
        img.loading = 'lazy';
        imgWrap.appendChild(img);
      }
      const details = el('div', 'order-review-item-details');
      details.appendChild(el('p', 'order-review-item-name', item.name || item.sku));
      const variantLabel = item.variant
        || item.selectedOptions?.map((o) => o.value).join(' · ')
        || null;
      if (variantLabel) details.appendChild(el('p', 'order-review-item-variant', variantLabel));
      const isFreeGift = !!item.custom?.linkedTo;
      if (isFreeGift) {
        details.appendChild(el('p', 'order-review-item-gift', s.freeGift || 'Free gift'));
      }
      const itemLead = el('div', 'order-review-item-lead');
      itemLead.append(imgWrap, details);

      const unitPrice = parseFloat(item.price?.final ?? item.price) || 0;
      const lineSubtotal = unitPrice * (item.quantity || 0);
      const priceText = isFreeGift || unitPrice === 0
        ? (s.free || 'Free')
        : formatPrice(unitPrice, currencyCode);
      const subtotalText = isFreeGift || lineSubtotal === 0
        ? (s.free || 'Free')
        : formatPrice(lineSubtotal, currencyCode);

      const priceEl = el('span', 'order-review-col-price', priceText);
      const qtyEl = el('span', 'order-review-col-qty', String(item.quantity ?? ''));
      const subtotalEl = el('span', 'order-review-col-subtotal', subtotalText);
      if (isFreeGift || lineSubtotal === 0) {
        priceEl.classList.add('order-review-free');
        subtotalEl.classList.add('order-review-free');
      }
      row.append(itemLead, priceEl, qtyEl, subtotalEl);
      itemsCard.appendChild(row);
    });
    main.appendChild(itemsCard);
  }

  // — Order total summary (right column) —
  const summary = el('section', 'order-review-card order-review-summary');
  summary.appendChild(el('h2', null, s.reviewOrderTotal));

  const totalsBody = el('div', 'order-review-totals');
  const rows = [[s.subtotal, formatPrice(totals.subtotal, currencyCode)]];
  normalizeTotalsDiscounts(totals.discounts).forEach((discount) => {
    const promoName = discount.name || discount.code;
    const label = promoName ? `${s.reviewPromo} · ${promoName}` : s.reviewPromo;
    rows.push([
      label,
      formatPrice(-Math.abs(parseFloat(discount.amount)), currencyCode),
      'order-review-totals-discount',
    ]);
  });
  const methodLabelForRow = method.label || method.name || method.title;
  rows.push([
    methodLabelForRow ? `${s.shipping} · ${methodLabelForRow}` : s.shipping,
    methodRate ? formatPrice(methodRate, currencyCode) : (s.free || 'Free'),
  ]);
  rows.push([s.estimatedTaxes || s.orderTax, formatPrice(totals.tax, currencyCode)]);
  rows.forEach(([label, value, extra]) => {
    const row = el('div', extra ? `order-review-totals-row ${extra}` : 'order-review-totals-row');
    row.append(el('span', null, label), el('span', null, value));
    totalsBody.appendChild(row);
  });
  summary.appendChild(totalsBody);

  const grand = el('div', 'order-review-grand');
  grand.append(
    el('span', 'order-review-grand-label', s.reviewGrandTotal),
    el('span', 'order-review-grand-value', formatPrice(totals.total, currencyCode)),
  );
  summary.appendChild(grand);

  // Complete order button + error region.
  const errorEl = el('p', 'order-review-error');
  errorEl.setAttribute('role', 'alert');
  errorEl.hidden = true;

  const completeBtn = document.createElement('button');
  completeBtn.type = 'button';
  completeBtn.className = 'button emphasis order-review-complete';
  const completeIcon = el('span', 'order-review-complete-icon');
  completeIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';
  completeBtn.append(completeIcon, el('span', 'order-review-complete-label', s.reviewCompleteOrder));
  summary.appendChild(completeBtn);
  summary.appendChild(errorEl);

  // Terms & conditions.
  const terms = el('p', 'order-review-terms');
  terms.appendChild(document.createTextNode(s.reviewTermsPrefix));
  const termsLink = document.createElement('a');
  // Locale-aware legal-notice page (e.g. /us/en_us/legal-notice); the region and
  // language segments come from the current store view.
  termsLink.href = `${storeRootPath}legal-notice`;
  termsLink.textContent = s.reviewTermsLink;
  terms.appendChild(termsLink);
  terms.appendChild(document.createTextNode(s.reviewTermsSuffix));
  summary.appendChild(terms);

  // Cancel and return to cart.
  const cancelWrap = el('p', 'order-review-cancel-wrap');
  const cancelLink = document.createElement('button');
  cancelLink.type = 'button';
  cancelLink.className = 'order-review-cancel';
  cancelLink.textContent = s.reviewCancelReturnToCart;
  cancelWrap.appendChild(cancelLink);
  summary.appendChild(cancelWrap);

  aside.appendChild(summary);

  grid.append(main, aside);
  container.appendChild(grid);
  block.replaceChildren(container);

  // ── Wire the actions ──────────────────────────────────────────────
  const showError = (message) => {
    errorEl.textContent = message;
    errorEl.hidden = false;
  };
  const setBusy = (busy) => {
    completeBtn.disabled = busy;
    completeBtn.classList.toggle('order-review-busy', busy);
  };
  // Guards the abandonment cancel: once the buyer completes or explicitly
  // cancels, leaving the page is intentional and must not trigger a cancel.
  let finalized = false;
  const routeToComplete = () => {
    finalized = true;
    // The completion is logged by the order-complete page on arrival
    // (`checkout-complete`), which also clears the checkoutId — don't clear it
    // here or the correlation to that final event would be lost.
    window.location.href = `${config.getOrderPath('complete')}?orderId=${encodeURIComponent(orderId)}`;
  };
  const routeToCart = () => {
    finalized = true;
    logOperation('checkout-failed', {
      checkoutId: getCheckoutId(), orderId, reason: 'customer_cancelled',
    });
    window.location.href = config.getOrderPath('cart');
  };

  completeBtn.addEventListener('click', createConfirmHandler({
    orderId,
    confirm: confirmPayment,
    routeTo: routeToComplete,
    onError: showError,
    setBusy,
    errorMessage: s.reviewCompleteError,
  }));

  cancelLink.addEventListener('click', createCancelHandler({
    orderId,
    cancel: cancelPayment,
    routeToCart,
  }));

  // Best-effort: abandoning the review page (tab close, back nav) cancels the
  // order so the PayPal authorization is released. Idempotent, and guarded so it
  // never fires after an explicit complete/cancel.
  window.addEventListener('pagehide', createAbandonmentHandler({
    isFinalized: () => finalized,
    sendCancel: () => sendCancelBeacon(config, orderId),
  }));
}
