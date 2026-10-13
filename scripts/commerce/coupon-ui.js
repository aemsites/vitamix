/**
 * Shared DOM helpers for the multi-coupon entry UI, used by the cart-summary and
 * order-summary blocks: pills for auto/verified (ID.me / affiliate)
 * coupons, and per-code rejection messages from the response `couponStatus[]`.
 */
import { getStatusMessage, isAffiliateCode, isAffiliateIneligible } from './coupon-state.js';

/**
 * Renders one pill per auto/verified coupon into `container` (hidden when there
 * are none). Auto coupons are removed here rather than from the text input,
 * which only ever holds the manual coupon. The affiliate coupon cannot be
 * removed, and is shown with a notice when it does not apply to the cart.
 * @param {HTMLElement} container
 * @param {Array<{code: string}>} autoCoupons
 * @param {(code: string) => void} onRemove
 * @param {{removeCoupon?: string, affiliateNotEligible?: string}} [strings]
 */
export function renderCouponPills(container, autoCoupons, onRemove, strings = {}) {
  if (!container) return;
  container.innerHTML = '';
  container.hidden = autoCoupons.length === 0;
  let notice = null;
  autoCoupons.forEach(({ code }) => {
    const affiliate = isAffiliateCode(code);
    const ineligible = affiliate && isAffiliateIneligible();
    const pill = document.createElement('span');
    pill.className = ineligible ? 'coupon-pill coupon-pill-ineligible' : 'coupon-pill';

    const label = document.createElement('span');
    label.className = 'coupon-pill-label';
    label.textContent = code;
    pill.append(label);

    if (!affiliate) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'coupon-pill-remove';
      remove.setAttribute('aria-label', `${strings.removeCoupon || 'Remove coupon'} ${code}`);
      remove.textContent = '×';
      remove.addEventListener('click', () => onRemove(code));
      pill.append(remove);
    }
    container.appendChild(pill);

    if (ineligible && strings.affiliateNotEligible) {
      notice = document.createElement('p');
      notice.className = 'coupon-notice';
      notice.textContent = strings.affiliateNotEligible;
    }
  });
  if (notice) container.appendChild(notice);
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
    // A rejected affiliate code is shown with its own notice (renderCouponPills).
    .filter((entry) => !(entry.status === 'rejected_invalid' && isAffiliateCode(entry.code)))
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
