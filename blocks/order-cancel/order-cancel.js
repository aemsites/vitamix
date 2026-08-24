import { getConfig } from '../../scripts/commerce-config.js';
import { getOrder } from '../../scripts/commerce-api.js';
import { logOperation, getCheckoutId } from '../../scripts/operations-log.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';
import resolvePaymentFailureMessage, { resolveCheckoutFailure } from '../../scripts/payment-failure.js';

/**
 * Order cancellation page block.
 *
 * Rendered when a payment processor redirects back to /{locale}/{language}/order/cancel
 * after a buyer cancellation or a payment failure.
 *
 * URL parameters:
 *   orderId – the cancelled / failed order id
 *   reason  – only `customer_cancelled` is ever present (a genuine buyer cancel).
 *             Payment failures carry no reason; the neutral failure bucket
 *             (`contact_support` | `retry`) is read from order.payment.checkoutFailure
 *             via the customer order lookup (email held in sessionStorage).
 */
export default async function decorate(block) {
  const config = getConfig();
  const strings = config.getStrings();
  const { locale, language } = getLocaleAndLanguage();
  const storeRootPath = `/${locale}/${language}/`;
  const params = Object.fromEntries(new URLSearchParams(window.location.search).entries());

  const reason = params.reason || '';
  const orderId = params.orderId || '';

  // Buyer cancellations arrive with reason=customer_cancelled in the URL. Every
  // other failure arrives with only orderId; the neutral failure bucket lives on
  // the order (order.payment.checkoutFailure) and is read via the customer order
  // lookup using the email captured at checkout.
  const checkoutFailure = await resolveCheckoutFailure({
    reason,
    orderId,
    email: sessionStorage.getItem('checkout_email') || '',
    getOrder,
  });

  // This page is only reached when a processor redirects back after a cancel or
  // failure — log the redirect return and the failure (keep the checkoutId so a
  // retry stays correlated; don't clear it).
  logOperation('checkout-redirect-return', {
    checkoutId: getCheckoutId(),
    orderId,
    ...(reason ? { reason } : {}),
  });
  logOperation('checkout-failed', {
    checkoutId: getCheckoutId(),
    orderId,
    ...(reason ? { reason } : {}),
    ...(checkoutFailure ? { checkoutFailure } : {}),
  });

  const bodyText = resolvePaymentFailureMessage({ reason, checkoutFailure }, {
    customerCancelled: strings.cancelCustomerCancelled,
    contactSupport: strings.cancelContactSupport,
    retry: strings.cancelRetry,
  });

  const container = document.createElement('div');
  container.className = 'order-cancel-result';

  const icon = document.createElement('div');
  icon.className = 'order-cancel-icon';
  icon.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>';
  container.appendChild(icon);

  const heading = document.createElement('h2');
  heading.textContent = strings.cancelHeading;
  container.appendChild(heading);

  const msg = document.createElement('p');
  msg.className = 'order-cancel-reason';
  msg.textContent = bodyText;
  container.appendChild(msg);

  const actions = document.createElement('div');
  actions.className = 'order-cancel-actions';

  const returnLink = document.createElement('a');
  returnLink.href = config.getOrderPath('checkout');
  returnLink.className = 'button emphasis';
  returnLink.textContent = strings.cancelReturnToCheckout;
  actions.appendChild(returnLink);

  const shopLink = document.createElement('a');
  shopLink.href = storeRootPath;
  shopLink.className = 'button secondary';
  shopLink.textContent = strings.continueShopping;
  actions.appendChild(shopLink);

  container.appendChild(actions);

  block.replaceChildren(container);
}
