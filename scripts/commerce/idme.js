import { getMetadata } from '../aem.js';

const isProd = window.location.hostname === 'www.vitamix.com';
const IDME_CLIENT_ID = isProd ? '566879020d6a5533db11a112e307aed3' : 'f05216080667a3fb48ef1aed700d7b5f';
const IDME_SCOPES = 'military,medical,nurse,responder,teacher';
// ID.me Groups product — single hostname for both sandbox and production.
// The environment is determined by the client_id, not the URL.
const IDME_GROUPS_BASE = 'https://groups.id.me';

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
  sessionStorage.setItem('checkout_coupon_code', coupon);
  sessionStorage.setItem('checkout_coupon_source', 'auto');
  document.dispatchEvent(new CustomEvent('checkout:coupon-apply'));
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
      window.location.href = buildIDMeAuthUrl(callbackUrl);
    });

    const script = document.createElement('script');
    script.src = 'https://s3.amazonaws.com/idme/developer/idme-buttons/assets/js/idme-wallet-button.js';
    script.async = true;
    outer.querySelector('.idme-wrapper').appendChild(script);
  }

  insertAfterEl.insertAdjacentElement('afterend', outer);
  return handleIDMeReturn();
}
