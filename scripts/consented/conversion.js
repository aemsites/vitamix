/**
 * Third-party marketing conversion tags for the order confirmation page.
 * Loaded on-demand from consented.js (see the /order/complete pathname
 * check there) once per confirmation view. Every vendor below already has
 * its base library/pixel bootstrapped in consented.js (Amazon DSP, Meta,
 * Pinterest, Tune/PerkSpot, Microsoft UET, gtag/Floodlight); this module
 * only adds the purchase/conversion event on top of that, plus the two
 * vendors (TikTok, Reddit) that have no page-view pixel elsewhere.
 *
 * Order data is read straight from the checkout sessionStorage snapshot
 * (deliberately not shared with instrumentation/order-success.js — kept
 * standalone so this module has no dependency on the Adobe instrumentation
 * internals).
 */
import { debugLog, debugWarn, parseStorageJson } from './instrumentation/shared.js';

// consented.js keeps its own gtag() module-scoped (never assigns window.gtag),
// so this module pushes to the shared window.dataLayer the same way.
window.dataLayer = window.dataLayer || [];
function gtag(...args) { window.dataLayer.push(args); }

/**
 * Reads the checkout confirmation snapshot written before the payment
 * redirect (mirrors readOrderSuccessContext in instrumentation/order-success.js).
 * @returns {object|null}
 */
function readOrderContext() {
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('orderId') || params.get('id');
  if (!orderId || params.get('reason')) return null;

  const order = parseStorageJson(sessionStorage.getItem('checkout_order'));
  const cacheMatches = !!order?.id && order.id === orderId;

  return {
    orderId,
    order: cacheMatches ? order : null,
    preview: cacheMatches ? parseStorageJson(sessionStorage.getItem('checkout_preview')) : null,
    cartItems: cacheMatches ? parseStorageJson(sessionStorage.getItem('checkout_cart_items')) : null,
  };
}

/**
 * Order total, line items and currency from the checkout session snapshot
 * (mirrors getOrderSuccessOrderSummary in instrumentation/order-success.js).
 * @param {ReturnType<typeof readOrderContext>} context
 * @returns {{
 *   orderId: string,
 *   items: { sku: string, quantity: number, price: number }[],
 *   orderTotal: number,
 *   pretaxTotal: number,
 *   currency: string,
 * }|null}
 */
function getOrderSummary(context) {
  if (!context?.orderId) return null;

  const {
    orderId, order, preview, cartItems,
  } = context;
  const displayItems = cartItems?.length ? cartItems : order?.items;
  if (!displayItems?.length) return null;

  const items = displayItems
    .map((item) => {
      const rawPrice = item?.price?.final || item?.price || item?.unitPrice || 0;
      const price = Number(parseFloat(rawPrice).toFixed(2)) || 0;
      return {
        sku: String(item?.sku || '').trim(),
        productName: String(item?.name || '').trim(),
        quantity: Number(item?.quantity || item?.qty || 0) || 0,
        price,
      };
    })
    .filter((item) => item.sku && item.quantity > 0);
  if (!items.length) return null;

  const est = order?.estimates;
  const discounts = est ? (est.discounts || []) : (preview?.discounts || []);
  const shippingMethod = est ? (est.shippingMethod || {}) : (preview?.shippingMethod || {});
  const tax = parseFloat(est ? (est.tax?.amount || 0) : (preview?.taxAmount || 0));
  const hasFreeShipping = discounts.some((discount) => discount?.freeShipping);
  const shippingRate = hasFreeShipping ? 0 : (parseFloat(shippingMethod.rate || 0) || 0);
  const discountAmount = discounts
    .filter((discount) => Math.abs(parseFloat(discount?.amount)) > 0)
    .reduce((sum, discount) => sum + (Math.abs(parseFloat(discount.amount)) || 0), 0);
  const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  const grandTotal = Math.max(0, subtotal - discountAmount + shippingRate + tax);
  const orderTotal = Math.round(grandTotal * 100) / 100;
  // Pretax, preshipping, postdiscount total (tvScientific wants this, not orderTotal).
  const pretaxTotal = Math.round(Math.max(0, subtotal - discountAmount) * 100) / 100;

  const currency = String(
    order?.currencyCode || preview?.currencyCode || order?.currency || preview?.currency || 'USD',
  );

  return {
    orderId: String(order?.friendlyId || order?.number || order?.orderNumber || orderId),
    items,
    orderTotal,
    pretaxTotal,
    currency,
  };
}

const context = readOrderContext();
const summary = context && getOrderSummary(context);

if (!summary) {
  debugWarn('Conversion tags skipped: order data not available');
} else {
  const {
    orderId, items, currency,
  } = summary;
  const orderTotal = summary.orderTotal.toFixed(2);
  const pretaxTotal = summary.pretaxTotal.toFixed(2);
  const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const email = context.order?.customer?.email || sessionStorage.getItem('checkout_email') || '';

  debugLog('Conversion tags firing', {
    orderId, orderTotal, currency, quantity,
  });

  // TikTok Pixel
  /* eslint-disable */
  (function (w, d, t) {
    w.TiktokAnalyticsObject = t;
    var ttq = w[t] = w[t] || [];
    ttq.methods = [
      'page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once',
      'ready', 'alias', 'group', 'enableCookie', 'disableCookie', 'holdConsent',
      'revokeConsent', 'grantConsent',
    ];
    ttq.setAndDefer = function (target, method) {
      target[method] = function () {
        target.push([method].concat(Array.prototype.slice.call(arguments, 0)));
      };
    };
    for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
    ttq.instance = function (id) {
      var inst = ttq._i[id] || [];
      for (var j = 0; j < ttq.methods.length; j++) ttq.setAndDefer(inst, ttq.methods[j]);
      return inst;
    };
    ttq.load = function (id, config) {
      var url = 'https://analytics.tiktok.com/i18n/pixel/events.js';
      ttq._i = ttq._i || {};
      ttq._i[id] = [];
      ttq._i[id]._u = url;
      ttq._t = ttq._t || {};
      ttq._t[id] = +new Date();
      ttq._o = ttq._o || {};
      ttq._o[id] = config || {};
      var scriptTag = d.createElement('script');
      scriptTag.type = 'text/javascript';
      scriptTag.async = true;
      scriptTag.src = `${url}?sdkid=${id}&lib=${t}`;
      var firstScript = d.getElementsByTagName('script')[0];
      firstScript.parentNode.insertBefore(scriptTag, firstScript);
    };
    ttq.load('D7A0N0RC77U88C4A8VKG');
    ttq.page();
  })(window, document, 'ttq');
  window.ttq.track('CompletePayment', { value: orderTotal, order_id: orderId });
  /* eslint-enable */
  // End TikTok Pixel

  // Amazon DSP (base pixel already loaded in consented.js)
  window.amzn?.('trackEvent', 'Checkout');
  // End Amazon DSP

  // Floodlight (gtag) purchase conversion — DC-15266370 config already loaded in consented.js
  gtag('event', 'purchase', {
    allow_custom_scripts: true,
    value: orderTotal,
    transaction_id: orderId,
    send_to: 'DC-15266370/fy26z0/vitam0+transactions',
  });
  // End Floodlight purchase conversion

  // Pandora
  const pandoraPixel = document.createElement('img');
  pandoraPixel.width = 1;
  pandoraPixel.height = 1;
  pandoraPixel.src = `https://arttrk.com/pixel/?ad_log=referer&action=purchase&value=${encodeURIComponent(orderTotal)}&order_id=${encodeURIComponent(orderId)}&pixid=82dc3545-14a0-41d8-9870-2156059087d9`;
  document.body.appendChild(pandoraPixel);
  // End Pandora

  // Microsoft Ads UET purchase event (bat.js already loaded in consented.js)
  window.uetq = window.uetq || [];
  window.uetq.push('event', 'purchase', {
    revenue_value: orderTotal,
    currency,
  });
  // End Microsoft Ads UET

  // Google Campaign Manager purchase conversion — DC-10418690 config already loaded in consented.js
  gtag('event', 'purchase', {
    allow_custom_scripts: true,
    value: orderTotal,
    transaction_id: orderId,
    send_to: 'DC-10418690/reven0/vitam0+transactions',
  });
  // End Google Campaign Manager

  // Reddit Pixel
  /* eslint-disable */
  (function (e) {
    if (!window.rdt) {
      var p = window.rdt = function () {
        p.sendEvent ? p.sendEvent.apply(p, arguments) : p.callQueue.push(arguments);
      };
      p.callQueue = [];
      var t = document.createElement('script');
      t.src = 'https://www.redditstatic.com/ads/pixel.js';
      t.async = true;
      var s = document.getElementsByTagName('script')[0];
      s.parentNode.insertBefore(t, s);
    }
  })();
  window.rdt('init', 'a2_fjkte7fuaklj');
  /* eslint-enable */
  window.rdt('track', 'Purchase', {
    orderId,
    value: orderTotal,
    email,
    currency,
  });
  // End Reddit Pixel

  // Pinterest checkout event (base pixel already loaded in consented.js)
  window.pintrk?.('track', 'checkout', {
    value: orderTotal,
    order_quantity: quantity,
    currency,
    order_id: orderId,
    line_items: items.map((item) => ({
      product_name: item.productName,
      product_id: item.sku,
      product_price: item.price,
      product_quantity: item.quantity,
    })),
  });
  // End Pinterest checkout event

  // PerkSpot conversion (tdl already initialized in consented.js)
  window.tdl?.convert({ amount: orderTotal, adv_sub: orderId });
  // End PerkSpot conversion

  // tvScientific purchase pixel
  setTimeout(() => {
    const { protocol } = window.location;
    const src = `${protocol}//tvspix.com/t.png?t=${Date.now()}&l=tvscientific-pix-o-4b66e973-23f2-45e9-91e5-aa5f89462df5&u3=${encodeURIComponent(window.location.href)}&u1=complete_purchase&u2=${encodeURIComponent(pretaxTotal)}&u4=${encodeURIComponent(orderId)}&u5=`;
    const pixel = document.createElement('img');
    pixel.setAttribute('src', src);
    pixel.setAttribute('height', '0');
    pixel.setAttribute('width', '0');
    pixel.setAttribute('alt', '');
    pixel.style.display = 'none';
    pixel.style.position = 'fixed';
    document.body.appendChild(pixel);
  }, 500);
  // End tvScientific purchase pixel

  debugLog('Conversion tags fired');
}
