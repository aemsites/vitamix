/**
 * Shared DOM helpers for the multi-coupon entry UI, used by the cart-summary and
 * order-summary blocks: removable pills for auto/verified (ID.me / affiliate)
 * coupons, and per-code rejection messages from the response `couponStatus[]`.
 */
import { getStatusMessage } from './coupon-state.js';

/**
 * Renders one removable pill per auto/verified coupon into `container` (hidden
 * when there are none). Auto coupons are removed here rather than from the text
 * input, which only ever holds the manual coupon.
 * @param {HTMLElement} container
 * @param {Array<{code: string}>} autoCoupons
 * @param {(code: string) => void} onRemove
 * @param {{removeCoupon?: string}} [strings]
 */
export function renderCouponPills(container, autoCoupons, onRemove, strings = {}) {
  if (!container) return;
  container.innerHTML = '';
  container.hidden = autoCoupons.length === 0;
  autoCoupons.forEach(({ code }) => {
    const pill = document.createElement('span');
    pill.className = 'coupon-pill';

    const label = document.createElement('span');
    label.className = 'coupon-pill-label';
    label.textContent = code;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'coupon-pill-remove';
    remove.setAttribute('aria-label', `${strings.removeCoupon || 'Remove coupon'} ${code}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => onRemove(code));

    pill.append(label, remove);
    container.appendChild(pill);
  });
}

/**
 * Renders per-code rejection messages from a response `couponStatus[]` into
 * `container` (hidden when every code applied). Applied codes produce no message
 * — they show up as discount rows / pills instead. The API withholds the reason
 * for `rejected_invalid`, so the copy is generic per status.
 * @param {HTMLElement} container
 * @param {Array<{code: string, status: string}>} couponStatus
 * @param {{couponRejectedInvalid?: string, couponRejectedNotCombinable?: string}} strings
 * @returns {boolean} whether any message was rendered
 */
export function renderCouponStatus(container, couponStatus, strings = {}) {
  if (!container) return false;
  container.innerHTML = '';
  (couponStatus || [])
    .filter((entry) => entry?.status && entry.status !== 'applied')
    .forEach(({ code, status }) => {
      const message = getStatusMessage(status, strings);
      if (!message) return;
      const line = document.createElement('p');
      line.className = 'coupon-status-message';
      line.textContent = `${code}: ${message}`;
      container.appendChild(line);
    });
  const shown = container.childElementCount > 0;
  container.hidden = !shown;
  return shown;
}

/**
 * Extracts the coupon code from a `discounts[]` descriptor whose id is
 * `coupon:CODE`, or null for non-coupon discounts.
 * @param {{id?: string, source?: string}} discount
 * @returns {string|null}
 */
export function couponCodeFromDiscount(discount) {
  if (discount?.source !== 'coupon') return null;
  const id = discount.id || '';
  return id.startsWith('coupon:') ? id.slice('coupon:'.length) : null;
}
