import {
  debugLog,
  debugWarn,
  getProductName,
  buildProductId,
  hasMarketingConsent,
  isErrorPage,
} from './shared.js';
import {
  assignDigitalDataPageInfo,
  flushLaunchTrackers,
  pushProductColorEvent,
  pushProductEvent,
  setDigitalDataProductColor,
  triggerLaunchEvent,
  whenSatelliteReady,
} from './adobe-runtime.js';

let prodViewTrackScheduled = false;

/**
 * Fire the prodView event after the product name is found on the PDP.
 * @returns {Promise<void>}
 */
export async function fireProdView() {
  if (window.vitamixEdsAnalytics.prodViewFired) {
    return;
  }

  if (!hasMarketingConsent()) {
    return;
  }

  const productName = `${getProductName()}`;
  if (!productName) {
    debugWarn('Adobe Analytics prodView skipped: product name not found on PDP');
    return;
  }

  // window.selectedVariant is set synchronously during PDP decoration (default
  // variant, or the ?color= deep-linked one) — read it now since prodView fires
  // later, after Launch is ready, well after that assignment has happened.
  setDigitalDataProductColor(window.selectedVariant?.options?.color);

  if (!(await pushProductEvent('prodView', buildProductId(productName)))) {
    debugWarn('Adobe Analytics prodView skipped: Adobe Launch (_satellite) not available');
    return;
  }

  window.vitamixEdsAnalytics.prodViewFired = true;
}

/**
 * Retry briefly so jsonLdData / PDP DOM are ready after consent scripts load.
 * Uses a single Launch readiness wait; only product-name polling retries.
 * @param {number} [attempt]
 */
export function trackProdView(attempt = 0) {
  const tryTrack = () => {
    const productName = `${getProductName()}`;
    if (!productName && attempt < 10) {
      setTimeout(() => trackProdView(attempt + 1), 100);
      return;
    }
    fireProdView();
  };

  if (attempt > 0) {
    tryTrack();
    return;
  }

  if (prodViewTrackScheduled || window.vitamixEdsAnalytics.prodViewFired) {
    return;
  }
  prodViewTrackScheduled = true;
  whenSatelliteReady(tryTrack, 'prodView');
}

let variantChangeTrackingInstalled = false;

/**
 * Listen for PDP color swatch clicks and fire a variantSelect beacon with the
 * chosen color merged into digitalData.product[0].productInfo.color (Adobe
 * Launch eVar15 data source). The page-load default/deep-linked color is
 * covered separately by fireProdView() reading window.selectedVariant.
 * @returns {void}
 */
export function trackVariantChange() {
  if (variantChangeTrackingInstalled) {
    return;
  }
  variantChangeTrackingInstalled = true;

  document.addEventListener('variant:change', (ev) => {
    if (!hasMarketingConsent()) {
      return;
    }
    pushProductColorEvent('variantSelect', ev.detail?.color);
  });
}

/**
 * digitalData.page.pageInfo payload for a 404/no-route page (Adobe Commerce parity).
 * Mirrors Commerce: { errorCode, errorPage, technicalErrors }. Reads the code
 * the 404 template exposed on window.errorCode, falling back to '404'.
 * @returns {{ errorCode: string, errorPage: string, technicalErrors: string }}
 */
export function buildErrorPageInfo() {
  const errorCode = `${window.errorCode || '404'}`;
  return { errorCode, errorPage: 'errorPage', technicalErrors: errorCode };
}

let pageErrorFired = false;

/**
 * Fire Adobe Analytics pageError on a 404/no-route page (Adobe Commerce parity).
 * Sets digitalData.page.pageInfo (errorCode, errorPage, technicalErrors) and
 * triggers the Launch pageError direct-call rule. Deduped per page view.
 * @returns {Promise<void>}
 */
export async function firePageError() {
  if (pageErrorFired) return;

  if (!hasMarketingConsent()) {
    return;
  }

  if (!isErrorPage()) {
    return;
  }

  const pageInfo = buildErrorPageInfo();
  assignDigitalDataPageInfo(pageInfo);
  flushLaunchTrackers();

  if (!(await triggerLaunchEvent('pageError', window.digitalData.page.pageInfo))) {
    debugWarn('Adobe Analytics pageError skipped: Adobe Launch (_satellite) not available');
    return;
  }

  pageErrorFired = true;
  debugLog('Adobe Analytics pageError fired', window.digitalData.page.pageInfo);
}

/**
 * Wait for Launch, then fire pageError on a 404/no-route page.
 * @returns {void}
 */
export function trackPageError() {
  whenSatelliteReady(() => {
    firePageError();
  }, 'pageError');
}

/** Reset pageError state (for unit tests). */
export function resetPageErrorState() {
  pageErrorFired = false;
}
