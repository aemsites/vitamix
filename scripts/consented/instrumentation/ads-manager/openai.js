import {
  hasMarketingConsent,
  isOrderSuccessPage,
  parseStorageJson,
  debugLog,
  debugWarn,
} from '../shared.js';

const OPENAI_PIXEL_ID = 'LEcZwKFjd4d3hhUqz2tJaf';
const OPENAI_SDK_URL = 'https://bzrcdn.openai.com/sdk/oaiq.min.js';

/** Install the OpenAI queue before loading its asynchronous SDK. */
function installOpenAiPixel() {
  if (window.oaiq) return;

  const queue = function queueOpenAiCall(...args) {
    queue.q.push(args);
  };
  queue.q = [];
  window.oaiq = queue;

  const script = document.createElement('script');
  script.async = true;
  script.src = OPENAI_SDK_URL;
  document.head.appendChild(script);
}

/**
 * Build the dynamic order-created event from the authoritative order context.
 * @param {object|null} context
 * @returns {object|null}
 */
function buildOrderCreatedEvent(context) {
  if (!context?.orderId) return null;

  const order = context.order || {};
  const preview = context.preview || {};
  let items = context.displayItems;
  if (!items?.length) {
    items = context.cartItems?.length ? context.cartItems : order.items;
  }
  if (!items?.length) return null;

  const contents = items.map((item) => {
    const rawPrice = item?.price?.final ?? item?.price ?? item?.unitPrice ?? 0;
    const price = Number.parseFloat(rawPrice);
    const quantity = Number(item?.quantity ?? item?.qty ?? 0);
    return {
      id: String(item?.sku || '').trim(),
      name: String(item?.name || item?.productName || item?.sku || '').trim(),
      content_type: 'product',
      quantity: Number.isFinite(quantity) ? Math.floor(quantity) : 0,
      // The OpenAI SDK validates amount fields as integers.
      //amount: Number.isFinite(price) ? Math.round(price) : 0,
    };
  }).filter((item) => item.id && item.quantity > 0);

  if (!contents.length) return null;

  const amount = preview?.total ? Number(preview.total) : 0; //Math.round(Math.max(0, subtotal - discountAmount + shippingRate + tax));
  const currency = String(
    order.currencyCode || preview.currencyCode || order.currency || preview.currency || 'USD',
  ).toUpperCase();
  const orderId = String(order.friendlyId || order.number || order.orderNumber || context.orderId);

  return {
    orderId,
    eventProps: {
      type: 'contents',
      //amount,
      currency,
      contents: contents,
    },
  };
}

/**
 * Queue one order-created measurement for the confirmed order.
 * @param {object|null} context
 */
function trackOrder(context) {
  if (!hasMarketingConsent() || !isOrderSuccessPage()) return;

  const payload = buildOrderCreatedEvent(context);
  if (!payload) {
    debugWarn('OpenAI conversion skipped: confirmed order data unavailable');
    return;
  }

  const storageKey = `openai_order_created_${payload.orderId}`;
  if (sessionStorage.getItem(storageKey)) {
    debugLog('OpenAI conversion skipped: order already measured', payload.orderId);
    return;
  }

  window.oaiq('measure', 'order_created', payload.eventProps, {
    event_id: payload.orderId,
  });
  sessionStorage.setItem(storageKey, 'true');
  debugLog('OpenAI order_created measurement queued', payload);
}

function readStoredOrderContext() {
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('orderId') || params.get('id');
  if (!orderId || params.get('reason')) return null;

  const order = parseStorageJson(sessionStorage.getItem('checkout_order'));
  const preview = parseStorageJson(sessionStorage.getItem('checkout_preview'));
  const matches = String(order?.id || '') === orderId;
  return {
    orderId,
    order: matches ? order : null,
    preview: matches ? preview : null,
    cartItems: matches ? parseStorageJson(sessionStorage.getItem('checkout_cart_items')) : null,
  };
}

if (isOrderSuccessPage()) {
  installOpenAiPixel();
  window.oaiq('init', { pixelId: OPENAI_PIXEL_ID });
  window.oaiq('consent', hasMarketingConsent());

  document.addEventListener('order:confirmed', (event) => {
    trackOrder(event.detail);
  }, { once: true });

  // The order block can finish before this dynamically imported module executes.
  const confirmedContext = window.vitamixEdsAnalytics?.orderConfirmedContext;
  trackOrder(confirmedContext || readStoredOrderContext());
}
