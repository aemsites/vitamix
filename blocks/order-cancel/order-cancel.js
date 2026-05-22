import { getConfig } from '../../scripts/commerce-config.js';

/**
 * Order cancellation page block.
 *
 * Rendered when a payment processor redirects back to /{locale}/{language}/order/cancel
 * after a user-initiated cancellation or a payment failure.
 *
 * Expected URL parameters:
 *   reason  – one of: customer_cancelled | payment_failed | declined
 *   message – optional human-readable message from the payment processor
 *   orderId – optional, for display / future use
 *
 * Payment processors and what they send on cancel:
 *   Chase (card)  → reason=declined | payment_failed
 *   PayPal        → reason=customer_cancelled (user dismissed sheet)
 *                   reason=payment_failed     (processor error)
 *   Apple Pay     → reason=customer_cancelled (user cancelled sheet)
 *   Affirm        → reason=customer_cancelled | payment_failed
 */
export default async function decorate(block) {
  const config = getConfig();
  const strings = config.getStrings();
  const params = Object.fromEntries(new URLSearchParams(window.location.search).entries());

  const reason = params.reason || '';
  const processorMessage = params.message || '';

  let bodyText;
  if (reason === 'customer_cancelled') {
    bodyText = strings.cancelCustomerCancelled;
  } else if (reason === 'declined') {
    bodyText = strings.cancelDeclined;
  } else {
    bodyText = strings.cancelPaymentFailed;
  }

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

  // Show the processor's own message when present and different from our mapped text.
  if (processorMessage && processorMessage !== bodyText) {
    const detail = document.createElement('p');
    detail.className = 'order-cancel-detail';
    detail.textContent = processorMessage;
    container.appendChild(detail);
  }

  const actions = document.createElement('div');
  actions.className = 'order-cancel-actions';

  const returnLink = document.createElement('a');
  returnLink.href = config.getOrderPath('checkout');
  returnLink.className = 'button emphasis';
  returnLink.textContent = strings.cancelReturnToCheckout;
  actions.appendChild(returnLink);

  const shopLink = document.createElement('a');
  shopLink.href = `/${config.getLocale()}/${config.getLanguage()}`;
  shopLink.className = 'button secondary';
  shopLink.textContent = strings.continueShopping;
  actions.appendChild(shopLink);

  container.appendChild(actions);

  block.replaceChildren(container);
}
