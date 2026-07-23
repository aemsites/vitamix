/**
 * Entry point for Adobe Analytics / Adobe Target instrumentation.
 *
 * Two responsibilities, split by *timing* not just page type:
 *  1. Early cross-page listeners registered before Adobe Launch loads
 *     (bootstrapEarlyTracking, trackCartChange, trackCheckoutShipping, trackLogin).
 *     These must be live immediately so a user action during the async script load
 *     (add-to-cart redirect, login, checkout address save) is never missed.
 *  2. initInstrumentation(): a page router that fires the page-view / conversion
 *     beacons for the current page only, after Launch is available.
 *
 * Page-specific modules (page-events, order-success, checkout) are loaded with
 * dynamic import() so they are only fetched on the pages that use them. cart.js
 * and auth.js stay eagerly imported because add-to-cart and auth can happen on
 * any page and their beacons run on redirect-sensitive paths.
 */
import {
  debugLog,
  isCartPage,
  isCheckoutPage,
  isErrorPage,
  isOrderSuccessPage,
  isPdpPage,
} from './shared.js';
import { trackScView } from './cart.js';

export {
  configureAnalyticsTrackingServers,
  ensureAnalyticsTrackingConfigured,
} from './adobe-runtime.js';
export { getDeploymentEnv } from './shared.js';
export { trackCartChange } from './cart.js';
export { trackLogin } from './auth.js';

/**
 * Load order-success tracking early on confirmation pages (before Launch loads).
 * Called from consented.js at module load time.
 * @returns {void}
 */
export function bootstrapEarlyTracking() {
  if (typeof window !== 'undefined' && isOrderSuccessPage()) {
    import('./order-success.js');
  }
}

let checkoutShippingTrackingRequested = false;

/**
 * Register checkout address-validation and Place Order click listeners.
 * @returns {void}
 */
export function trackCheckoutShipping() {
  if (checkoutShippingTrackingRequested || typeof window === 'undefined' || !isCheckoutPage()) {
    return;
  }
  checkoutShippingTrackingRequested = true;
  import('./checkout.js').then((m) => {
    m.trackCheckoutShipping();
    m.trackPlaceOrderClick();
  });
}

let instrumentationInitialized = false;

/**
 * Initialize page-level Adobe Analytics (prodView on PDP, scView on cart, scCheckout,
 * pageError on 404, purchase on order success) and Adobe Target
 * orderConfirmPage on order success. Cart mutation listeners are registered early via
 * trackCartChange() in consented.js.
 * @returns {void}
 */
export async function initInstrumentation() {
  if (instrumentationInitialized || window.vitamixEdsAnalytics.instrumentationInitialized) {
    return;
  }
  instrumentationInitialized = true;
  window.vitamixEdsAnalytics.instrumentationInitialized = true;

  debugLog('Adobe Analytics instrumentation loaded');

  if (isPdpPage()) {
    const { trackProdView } = await import('./page-events.js');
    trackProdView();
  }
  if (isCartPage()) {
    trackScView();
  }
  if (isCheckoutPage()) {
    const { trackScCheckout } = await import('./checkout.js');
    trackScCheckout();
  }
  if (isErrorPage()) {
    const { trackPageError } = await import('./page-events.js');
    trackPageError();
  }
  if (isOrderSuccessPage()) {
    const {
      registerOrderPurchaseTracking,
      trackOrderConfirmTarget,
    } = await import('./order-success.js');
    registerOrderPurchaseTracking();
    trackOrderConfirmTarget();
  }
}
