import { getMetadata } from '../aem.js';

const isProd = window.location.hostname === 'www.vitamix.com';
const IDME_CLIENT_ID = isProd ? '566879020d6a5533db11a112e307aed3' : 'f05216080667a3fb48ef1aed700d7b5f';
const IDME_SCOPES = 'military,medical,nurse,responder,teacher';
// ID.me Groups product — single hostname for both sandbox and production.
// The environment is determined by the client_id, not the URL.
const IDME_GROUPS_BASE = 'https://groups.id.me';
const IDME_COUPON_SOURCE = 'auto';

function buildIDMeAuthUrl(callbackUrl) {
  const clientId = (!isProd && localStorage.getItem('idme-client-id')?.trim()) || IDME_CLIENT_ID;
  const groupsBase = (!isProd && localStorage.getItem('idme-api-base')?.trim()) || IDME_GROUPS_BASE;
  const returnUrl = `${window.location.origin}${window.location.pathname}`;
  const state = btoa(JSON.stringify({ returnUrl }));
  // Groups endpoint uses 'scopes' (plural), not the standard OAuth 'scope'
  return `${groupsBase}/?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: 'code',
    scopes: getMetadata('idme-scope') || IDME_SCOPES,
    state,
    type: 'button',
  })}`;
}

function hasIDMeCoupon() {
  return sessionStorage.getItem('checkout_coupon_source') === IDME_COUPON_SOURCE
    && !!sessionStorage.getItem('checkout_coupon_code');
}

export function syncIDMeVisibility() {
  const hidden = hasIDMeCoupon();
  document.querySelectorAll('.idme-verify').forEach((el) => {
    el.hidden = hidden;
  });
}

function applyIDMeCoupon(coupon) {
  sessionStorage.setItem('checkout_coupon_code', coupon);
  sessionStorage.setItem('checkout_coupon_source', IDME_COUPON_SOURCE);
  syncIDMeVisibility();
  document.dispatchEvent(new CustomEvent('checkout:coupon-apply'));
}

function notifyOpenerIDMeCoupon(coupon) {
  if (!window.opener || window.opener.closed) return false;
  window.opener.postMessage({ type: 'idme:coupon', coupon }, window.location.origin);
  return true;
}

function openIDMePopup(url) {
  const width = 775;
  const height = 850;
  const screenLeft = window.screenLeft ?? window.screenX ?? 0;
  const screenTop = window.screenTop ?? window.screenY ?? 0;
  const left = Math.round(((window.innerWidth - width) / 2) + screenLeft);
  const top = Math.round(((window.innerHeight - height) / 2) + screenTop);

  return window.open(
    url,
    'ID.me',
    `scrollbars=yes,width=${width},height=${height},top=${top},left=${left}`,
  );
}

function watchIDMePopup(popupWindow) {
  let intervalId;
  let handleMessage;

  function finish(coupon) {
    window.clearInterval(intervalId);
    window.removeEventListener('message', handleMessage);
    if (coupon) applyIDMeCoupon(coupon);
    popupWindow.close();
  }

  handleMessage = (event) => {
    if (event.origin !== window.location.origin || event.source !== popupWindow) return;
    if (event.data?.type !== 'idme:coupon') return;
    finish(event.data.coupon);
  };

  window.addEventListener('message', handleMessage);
  intervalId = window.setInterval(() => {
    if (popupWindow.closed) {
      window.clearInterval(intervalId);
      window.removeEventListener('message', handleMessage);
      return;
    }

    let popupUrl;
    try {
      popupUrl = new URL(popupWindow.location.href);
    } catch {
      // The popup is still on ID.me, so its location is cross-origin.
      return;
    }

    if (popupUrl.origin !== window.location.origin) return;

    const coupon = popupUrl.searchParams.get('idme_coupon');
    const error = popupUrl.searchParams.get('idme_error');
    if (!coupon && !error) return;

    finish(coupon);
  }, 100);
}

/**
 * Reads ?idme_coupon= from the current URL, stores it as an auto-applied
 * coupon, fires checkout:coupon-apply, and cleans the param from the address
 * bar. Returns the coupon code if found, otherwise null.
 * @returns {string|null}
 */
export function handleIDMeReturn() {
  const params = new URLSearchParams(window.location.search);
  const coupon = params.get('idme_coupon');
  if (!coupon) return null;
  params.delete('idme_coupon');
  params.delete('idme_error');
  const qs = params.size ? `?${params}` : '';
  window.history.replaceState(null, '', window.location.pathname + qs);
  if (notifyOpenerIDMeCoupon(coupon)) {
    window.close();
    return coupon;
  }
  applyIDMeCoupon(coupon);
  return coupon;
}

/**
 * Renders the ID.me button matching the live widget DOM structure, attaches
 * the OAuth redirect click handler, and handles a return from the callback.
 * Only one instance per page — subsequent calls skip the button render.
 * Returns the coupon code if the page was loaded after an ID.me redirect,
 * otherwise null.
 * @param {HTMLElement} insertAfterEl
 * @returns {string|null}
 */
export function initIDMe(insertAfterEl) {
  const returnedCoupon = handleIDMeReturn();

  // only allow overrides via localStorage on non-prod hosts
  let redirectOrigin = window.location.origin;
  if (!isProd) {
    const override = localStorage.getItem('idme-redirect-origin')?.trim();
    if (override) {
      redirectOrigin = override;
    }
  }
  const callbackUrl = `${redirectOrigin}/us/en_us/idme/callback`;

  const outer = document.createElement('div');
  outer.className = 'idme-verify';

  // id="idme-verification" matches the live widget DOM — one instance per page
  if (!document.getElementById('idme-verification')) {
    outer.innerHTML = `
      <div class="idme-wrapper">
        <style>.idme-unify-button:focus{outline:none}@media(max-width:768px){.idme-wrapper{padding:0 15px 15px}}.idme-unify-button > img{height:unset;}</style>
        <span id="idme-verification">
          <div class="idme-trigger">
            <span class="idme-text">${getMetadata('idme-promotion-text') || 'Exclusive discounts are available for Military, Nurses, Medical Professionals, First Responders, and Teachers through ID.me.'}</span>
            <a class="idme-trigger-link idme-unify-button" href="javascript:void(0);">
              <img src="https://s3.amazonaws.com/idme/developer/idme-buttons/assets/img/verify.svg" alt="ID.me Logo">
            </a>
          </div>
        </span>
      </div>`;

    outer.querySelector('.idme-trigger-link').addEventListener('click', () => {
      const authUrl = buildIDMeAuthUrl(callbackUrl);
      const popupWindow = openIDMePopup(authUrl);

      if (!popupWindow || popupWindow.closed) {
        window.location.href = authUrl;
        return;
      }

      popupWindow.focus();
      watchIDMePopup(popupWindow);
    });

    const style = document.createElement('link');
    style.href = 'https://s3.amazonaws.com/idme/developer/idme-buttons/assets/css/unified/button.css';
    style.rel = 'stylesheet';
    outer.querySelector('.idme-wrapper').appendChild(style);
  }

  insertAfterEl.insertAdjacentElement('afterend', outer);
  syncIDMeVisibility();
  return returnedCoupon;
}
