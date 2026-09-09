import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

function setLocation(url) {
  const next = new URL(url);
  globalThis.location = next;
  globalThis.window.location = next;
}

function installHistory() {
  globalThis.window.history = {
    replaced: null,
    replaceState(_state, _title, url) {
      this.replaced = url;
    },
  };
}

function installIDMeDom() {
  const anchor = {
    handler: null,
    addEventListener(type, handler) {
      if (type === 'click') this.handler = handler;
    },
    click() {
      this.handler?.();
    },
  };
  const wrapper = { appendChild() {} };
  const outer = {
    className: '',
    set innerHTML(value) {
      this.html = value;
    },
    querySelector(selector) {
      if (selector === '.idme-trigger-link') return anchor;
      if (selector === '.idme-wrapper') return wrapper;
      return null;
    },
  };
  const inserted = [];
  const insertAfterEl = {
    insertAdjacentElement(position, element) {
      inserted.push({ position, element });
    },
  };

  globalThis.document.createElement = (tagName) => (
    tagName === 'div' ? outer : { tagName, async: false, href: '', rel: '', src: '' }
  );
  globalThis.document.getElementById = () => null;
  globalThis.document.querySelectorAll = (selector) => (
    selector === '.idme-verify' ? inserted.map(({ element }) => element) : []
  );

  return {
    anchor, inserted, insertAfterEl, outer,
  };
}

async function importIDMe() {
  return import('../../scripts/commerce/idme.js');
}

describe('ID.me checkout integration', () => {
  beforeEach(() => {
    globalThis.__resetTestState();
    setLocation('https://www.vitamix.com/us/en_us/checkout/cart');
    installHistory();
    globalThis.innerWidth = 1440;
    globalThis.innerHeight = 900;
    globalThis.screenLeft = 0;
    globalThis.screenTop = 0;
    globalThis.opener = null;
    globalThis.close = () => {};
    globalThis.document.querySelectorAll = () => [];
    globalThis.addEventListener = () => {};
    globalThis.removeEventListener = () => {};
  });

  afterEach(() => {
    globalThis.__resetTestState();
  });

  it('applies an ID.me coupon returned on the current page URL', async () => {
    setLocation('https://www.vitamix.com/us/en_us/checkout/cart?idme_coupon=IDME10&idme_error=ignored');
    const { handleIDMeReturn } = await importIDMe();

    assert.equal(handleIDMeReturn(), 'IDME10');
    assert.equal(sessionStorage.getItem('checkout_coupon_code'), 'IDME10');
    assert.equal(sessionStorage.getItem('checkout_coupon_source'), 'auto');
    assert.equal(globalThis.__events.at(-1).type, 'checkout:coupon-apply');
    assert.equal(globalThis.window.history.replaced, '/us/en_us/checkout/cart');
  });

  it('posts a returned coupon to the opener and closes the popup return page', async () => {
    setLocation('https://www.vitamix.com/us/en_us/checkout/cart?idme_coupon=IDME10');
    let postedMessage;
    let closeCalled = false;
    globalThis.opener = {
      closed: false,
      postMessage(message, origin) {
        postedMessage = { message, origin };
      },
    };
    globalThis.close = () => {
      closeCalled = true;
    };
    const { handleIDMeReturn } = await importIDMe();

    assert.equal(handleIDMeReturn(), 'IDME10');
    assert.deepEqual(postedMessage, {
      message: { type: 'idme:coupon', coupon: 'IDME10' },
      origin: 'https://www.vitamix.com',
    });
    assert.equal(closeCalled, true);
    assert.equal(sessionStorage.getItem('checkout_coupon_code'), null);
    assert.equal(globalThis.__events.length, 0);
  });

  it('renders ID.me hidden when an ID.me coupon is already applied and shows it again when removed', async () => {
    sessionStorage.setItem('checkout_coupon_code', 'IDME10');
    sessionStorage.setItem('checkout_coupon_source', 'auto');
    const { inserted, insertAfterEl } = installIDMeDom();
    const { initIDMe, syncIDMeVisibility } = await importIDMe();

    assert.equal(initIDMe(insertAfterEl), null);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].element.hidden, true);

    sessionStorage.removeItem('checkout_coupon_code');
    sessionStorage.removeItem('checkout_coupon_source');
    syncIDMeVisibility();

    assert.equal(inserted[0].element.hidden, false);
  });

  it('opens ID.me in a popup and applies the returned coupon in the opener', async () => {
    const { anchor, inserted, insertAfterEl } = installIDMeDom();
    const popupWindow = {
      closed: false,
      location: { href: 'https://groups.id.me/' },
      closeCalled: false,
      focusCalled: false,
      close() {
        this.closeCalled = true;
        this.closed = true;
      },
      focus() {
        this.focusCalled = true;
      },
    };
    let openedUrl;
    globalThis.open = (url) => {
      openedUrl = url;
      return popupWindow;
    };

    const { initIDMe } = await importIDMe();
    initIDMe(insertAfterEl);
    anchor.click();

    assert.match(openedUrl, /^https:\/\/groups\.id\.me\//);
    assert.equal(popupWindow.focusCalled, true);

    popupWindow.location.href = 'https://www.vitamix.com/us/en_us/checkout/cart?idme_coupon=IDME10';
    await new Promise((resolve) => {
      setTimeout(resolve, 650);
    });

    assert.equal(sessionStorage.getItem('checkout_coupon_code'), 'IDME10');
    assert.equal(sessionStorage.getItem('checkout_coupon_source'), 'auto');
    assert.equal(globalThis.__events.at(-1).type, 'checkout:coupon-apply');
    assert.equal(inserted[0].element.hidden, true);
    assert.equal(popupWindow.closeCalled, true);
  });

  it('applies the ID.me coupon from a popup postMessage', async () => {
    const { anchor, inserted, insertAfterEl } = installIDMeDom();
    const popupWindow = {
      closed: false,
      location: { href: 'https://groups.id.me/' },
      closeCalled: false,
      close() {
        this.closeCalled = true;
        this.closed = true;
      },
      focus() {},
    };
    let messageHandler;
    let removedHandler;
    globalThis.addEventListener = (type, handler) => {
      if (type === 'message') messageHandler = handler;
    };
    globalThis.removeEventListener = (type, handler) => {
      if (type === 'message') removedHandler = handler;
    };
    globalThis.open = () => popupWindow;

    const { initIDMe } = await importIDMe();
    initIDMe(insertAfterEl);
    anchor.click();
    messageHandler({
      origin: 'https://www.vitamix.com',
      source: popupWindow,
      data: { type: 'idme:coupon', coupon: 'IDME10' },
    });

    assert.equal(sessionStorage.getItem('checkout_coupon_code'), 'IDME10');
    assert.equal(sessionStorage.getItem('checkout_coupon_source'), 'auto');
    assert.equal(globalThis.__events.at(-1).type, 'checkout:coupon-apply');
    assert.equal(inserted[0].element.hidden, true);
    assert.equal(popupWindow.closeCalled, true);
    assert.equal(removedHandler, messageHandler);
  });

  it('falls back to full-page redirect when the popup is blocked', async () => {
    const { anchor, insertAfterEl } = installIDMeDom();
    globalThis.open = () => null;

    const { initIDMe } = await importIDMe();
    initIDMe(insertAfterEl);
    anchor.click();

    assert.match(globalThis.window.location.href, /^https:\/\/groups\.id\.me\//);
  });

  it('returns the idme_error value and cleans the URL', async () => {
    setLocation(
      'https://www.vitamix.com/us/en_us/order/checkout?idme_error=token_exchange_failed',
    );
    const { handleIDMeError } = await importIDMe();

    assert.equal(handleIDMeError(), 'token_exchange_failed');
    assert.equal(
      globalThis.window.history.replaced,
      '/us/en_us/order/checkout',
    );
  });

  it('returns null when no idme_error param is present', async () => {
    setLocation('https://www.vitamix.com/us/en_us/order/checkout');
    const { handleIDMeError } = await importIDMe();

    assert.equal(handleIDMeError(), null);
    assert.equal(globalThis.window.history.replaced, null);
  });

  it('preserves other query params when cleaning idme_error', async () => {
    setLocation(
      'https://www.vitamix.com/us/en_us/order/checkout?foo=bar&idme_error=fail',
    );
    const { handleIDMeError } = await importIDMe();

    assert.equal(handleIDMeError(), 'fail');
    assert.equal(
      globalThis.window.history.replaced,
      '/us/en_us/order/checkout?foo=bar',
    );
  });
});
