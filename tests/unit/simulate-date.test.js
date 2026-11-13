/**
 * Unit tests for scripts/simulate-date.js.
 */
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  getSimulatedDate, withSimulatedDate, noteSimulatedAt, getSimulationStatus,
  showSimulationBadge, parseSimulatedDate, isSimulationHost,
} from '../../scripts/simulate-date.js';

/** URLs passed to `location.replace` (page reloads). */
const reloads = [];

function setLocation(hostname, search = '') {
  globalThis.location = {
    hostname,
    search,
    href: `https://${hostname}/us/en_us/products/x${search}`,
    replace(url) { reloads.push(url); },
  };
}

/** `storage` listeners registered on the window. */
const storageListeners = [];
globalThis.addEventListener = (type, fn) => {
  if (type === 'storage') storageListeners.push(fn);
};

/** Another tab writes the simulated date (or clears it with `null`). */
function otherTabSets(iso) {
  if (iso) localStorage.setItem('vitamix.now', iso);
  else localStorage.removeItem('vitamix.now');
  storageListeners.forEach((fn) => fn({ key: 'vitamix.now' }));
}

beforeEach(() => {
  globalThis.__resetTestState();
  setLocation('main--site--org.aem.page');
});

test('null without a parameter or stored date', () => {
  assert.equal(getSimulatedDate(), null);
});

test('the URL parameter sets the date and persists it for every tab', () => {
  setLocation('main--site--org.aem.page', '?simulateDate=2030-01-02T03:04:05.000Z');
  assert.equal(getSimulatedDate().toISOString(), '2030-01-02T03:04:05.000Z');
  assert.equal(localStorage.getItem('vitamix.now'), '2030-01-02T03:04:05.000Z');
  setLocation('main--site--org.aem.page', '?other=1');
  assert.equal(getSimulatedDate().toISOString(), '2030-01-02T03:04:05.000Z');
});

test('the parameter applies once per page, so a newer date from another tab wins', () => {
  setLocation('localhost', '?simulateDate=2030-01-02T00:00:00Z');
  assert.equal(getSimulatedDate().toISOString(), '2030-01-02T00:00:00.000Z');
  localStorage.setItem('vitamix.now', '2030-03-04T00:00:00.000Z');
  assert.equal(getSimulatedDate().toISOString(), '2030-03-04T00:00:00.000Z');
  localStorage.removeItem('vitamix.now');
  assert.equal(getSimulatedDate(), null, 'Clear in another tab applies here too');
});

test('parses Eastern date times (EST and EDT)', () => {
  setLocation('localhost', `?simulateDate=${encodeURIComponent('12/1/2030 9am')}`);
  assert.equal(getSimulatedDate().toISOString(), '2030-12-01T14:00:00.000Z');
  setLocation('localhost', `?simulateDate=${encodeURIComponent('7/4/2030 9:30pm')}`);
  assert.equal(getSimulatedDate().toISOString(), '2030-07-05T01:30:00.000Z');
});

test('parses ISO dates, including an unencoded + offset', () => {
  assert.equal(parseSimulatedDate('2030-01-02T03:04:05Z').toISOString(), '2030-01-02T03:04:05.000Z');
  assert.equal(parseSimulatedDate('2030-01-02T03:04:05 02:00').toISOString(), '2030-01-02T01:04:05.000Z');
  assert.equal(parseSimulatedDate('not a date'), null);
  assert.equal(parseSimulatedDate(''), null);
});

test('an empty parameter clears the stored date', () => {
  setLocation('localhost', '?simulateDate=2030-01-02T00:00:00Z');
  getSimulatedDate();
  localStorage.setItem('vitamix.now', '2031-01-01T00:00:00Z');
  setLocation('localhost', '?simulateDate=');
  assert.equal(getSimulatedDate(), null);
  setLocation('localhost');
  assert.equal(getSimulatedDate(), null);
  assert.equal(localStorage.getItem('vitamix.now'), null);
});

test('an invalid parameter is ignored and keeps the stored date', () => {
  setLocation('localhost', '?simulateDate=2030-01-02T00:00:00Z');
  getSimulatedDate();
  setLocation('localhost', '?simulateDate=garbage');
  assert.equal(getSimulatedDate().toISOString(), '2030-01-02T00:00:00.000Z');
  localStorage.clear();
  assert.equal(getSimulatedDate(), null);
});

test('a framed page uses its parameter without changing the tab\'s date', () => {
  setLocation('localhost', '?simulateDate=2030-01-02T00:00:00Z');
  getSimulatedDate();
  globalThis.top = {};
  try {
    setLocation('localhost', '?simulateDate=2031-03-04T00:00:00Z');
    assert.equal(getSimulatedDate().toISOString(), '2031-03-04T00:00:00.000Z');
    setLocation('localhost', '?simulateDate=');
    assert.equal(getSimulatedDate(), null);
    assert.equal(localStorage.getItem('vitamix.now'), '2030-01-02T00:00:00.000Z');
  } finally {
    delete globalThis.top;
  }
});

test('falls back to localStorage vitamix.now', () => {
  localStorage.setItem('vitamix.now', '2030-05-01T00:00:00Z');
  assert.equal(getSimulatedDate().toISOString(), '2030-05-01T00:00:00.000Z');
  localStorage.setItem('vitamix.now', 'nope');
  assert.equal(getSimulatedDate(), null);
});

test('the parameter replaces a vitamix.now set by hand', () => {
  localStorage.setItem('vitamix.now', '2030-05-01T00:00:00Z');
  setLocation('localhost', '?simulateDate=2030-06-01T00:00:00Z');
  getSimulatedDate();
  setLocation('localhost');
  assert.equal(getSimulatedDate().toISOString(), '2030-06-01T00:00:00.000Z');
});

/** Replaces `globalThis[name]` with a getter that throws, as when site data is blocked. */
function blockStorage(name) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() { throw new Error('SecurityError'); },
  });
  return () => Object.defineProperty(globalThis, name, original);
}

test('blocked storage: throwing storage accessors never escape', () => {
  const restore = [blockStorage('localStorage'), blockStorage('sessionStorage')];
  try {
    setLocation('localhost');
    assert.equal(getSimulatedDate(), null);
    assert.equal(withSimulatedDate('https://api.example.com/x'), 'https://api.example.com/x');
    setLocation('localhost', '?simulateDate=2030-01-02T00:00:00Z');
    assert.equal(getSimulatedDate().toISOString(), '2030-01-02T00:00:00.000Z', 'the page keeps its date');
    setLocation('localhost', '?simulateDate=');
    assert.equal(getSimulatedDate(), null);
  } finally {
    restore.forEach((fn) => fn());
  }
});

test('blocked storage: a throwing setItem keeps the page\'s date', () => {
  const { setItem } = localStorage;
  localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  try {
    setLocation('localhost', '?simulateDate=2030-01-02T00:00:00Z');
    assert.equal(getSimulatedDate().toISOString(), '2030-01-02T00:00:00.000Z');
  } finally {
    localStorage.setItem = setItem;
  }
});

test('always null on production hosts, and stores nothing', () => {
  ['www.vitamix.com', 'vitamix.com'].forEach((host) => {
    localStorage.setItem('vitamix.now', '2030-01-01T00:00:00Z');
    setLocation(host, '?simulateDate=2031-01-01T00:00:00Z');
    assert.equal(isSimulationHost(), false);
    assert.equal(getSimulatedDate(), null, host);
    assert.equal(withSimulatedDate('https://api.example.com/x'), 'https://api.example.com/x');
    localStorage.clear();
    getSimulatedDate();
    assert.equal(localStorage.getItem('vitamix.now'), null);
  });
  ['uat.vitamix.com', 'main--site--org.aem.live', 'localhost'].forEach((host) => {
    setLocation(host);
    assert.equal(isSimulationHost(), true, host);
  });
});

test('withSimulatedDate appends the ISO (UTC) date', () => {
  assert.equal(withSimulatedDate('https://api.example.com/x'), 'https://api.example.com/x');
  setLocation('localhost', `?simulateDate=${encodeURIComponent('12/1/2030 9am')}`);
  assert.equal(
    withSimulatedDate('https://api.example.com/x'),
    'https://api.example.com/x?simulateDate=2030-12-01T14%3A00%3A00.000Z',
  );
  assert.equal(
    withSimulatedDate('https://api.example.com/x?active=true'),
    'https://api.example.com/x?active=true&simulateDate=2030-12-01T14%3A00%3A00.000Z',
  );
});

// --- indicator --------------------------------------------------------------------

let previousBody = null;

/** A fresh page body; the previous page's badge is gone. */
function installDom() {
  previousBody?.children.forEach((node) => { node.isConnected = false; });
  const body = { children: [] };
  previousBody = body;
  const createElement = (tag) => {
    const el = {
      tag,
      style: {},
      dataset: {},
      attributes: {},
      children: [],
      listeners: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      click() { this.listeners.click?.(); },
      append(...nodes) { this.children.push(...nodes); },
      remove() { this.isConnected = false; },
    };
    return el;
  };
  globalThis.document.createElement = createElement;
  globalThis.document.body = {
    ...body,
    append(...nodes) {
      nodes.forEach((node) => { node.isConnected = true; });
      body.children.push(...nodes);
    },
  };
  return body;
}

test('indicator: shown with the date and a clear link; flags a response without simulatedAt', () => {
  const body = installDom();
  showSimulationBadge();
  assert.equal(body.children.length, 0, 'no badge without a simulated date');

  setLocation('localhost', '?simulateDate=2030-01-02T15:00:00Z');
  const warn = mock.method(console, 'warn', () => {});
  try {
    showSimulationBadge();
    showSimulationBadge();
    assert.equal(body.children.length, 1);
    const [badge] = body.children;
    const [line, notice] = badge.children;
    const [, value, , status, , clear] = line.children;
    assert.equal(notice.hidden, true);
    assert.equal(badge.id, 'simulate-date-badge');
    assert.match(value.textContent, /2030/);
    assert.equal(status.hidden, true);
    assert.match(clear.href, /[?&]simulateDate=(&|$)/);

    noteSimulatedAt({ simulatedAt: '2030-01-02T15:00:00.000Z' });
    assert.equal(getSimulationStatus(), true);
    assert.equal(status.hidden, true);

    noteSimulatedAt({ subtotal: 1 });
    noteSimulatedAt({ subtotal: 2 });
    assert.equal(getSimulationStatus(), false);
    assert.equal(status.hidden, false);
    assert.equal(badge.dataset.applied, 'false');
    const warnings = warn.mock.calls.map((c) => String(c.arguments[0]));
    assert.equal(warnings.filter((w) => w.includes('not applied')).length, 1);
  } finally {
    warn.mock.restore();
  }
});

test('noteSimulatedAt is a no-op without a simulated date', () => {
  const before = getSimulationStatus();
  noteSimulatedAt({ simulatedAt: '2030-01-02T15:00:00.000Z' });
  setLocation('www.vitamix.com', '?simulateDate=2030-01-02T15:00:00Z');
  noteSimulatedAt({ simulatedAt: '2030-01-02T15:00:00.000Z' });
  assert.equal(getSimulationStatus(), before);
});

/** The badge's parts: date line, notice, and the notice's message and buttons. */
function badgeParts(body) {
  const root = body.children.at(-1);
  const [line, notice] = root.children;
  const [message, reload, stay] = notice.children;
  return {
    root, line, value: line.children[1], notice, message, reload, stay,
  };
}

test('another tab changing or clearing the date offers a reload instead of reloading', () => {
  installDom();
  setLocation('localhost', '?simulateDate=2030-01-02T15:00:00Z&color=red');
  showSimulationBadge();
  // Brings the listener's last seen date up to this page.
  storageListeners.forEach((fn) => fn({ key: 'vitamix.now' }));
  const body = installDom();
  showSimulationBadge();
  reloads.length = 0;
  assert.equal(storageListeners.length, 1);
  let badge = badgeParts(body);
  assert.equal(badge.notice.hidden, true);

  storageListeners.forEach((fn) => fn({ key: 'vitamix.now' }));
  storageListeners.forEach((fn) => fn({ key: 'cart:us' }));
  assert.equal(badge.notice.hidden, true, 'no notice without a date change');

  otherTabSets('2030-04-05T15:00:00.000Z');
  assert.equal(badge.notice.hidden, false);
  assert.match(badge.message.textContent, /changed in another tab/);
  assert.match(badge.value.textContent, /Apr 5, 2030/);
  badge.stay.click();
  assert.match(badge.message.textContent, /previous date/);
  assert.equal(badge.stay.hidden, true);
  assert.deepEqual(reloads, [], 'nothing reloads by itself');

  badge.reload.click();
  assert.deepEqual(reloads, ['https://localhost/us/en_us/products/x?color=red']);

  otherTabSets(null);
  assert.match(badge.message.textContent, /cleared in another tab/);
  assert.equal(badge.line.hidden, true);
  assert.equal(badge.stay.hidden, false);
  assert.equal(badge.root.isConnected, true, 'the notice stays until the tester acts');

  const fresh = installDom();
  setLocation('localhost', '?page=2');
  showSimulationBadge();
  assert.equal(fresh.children.length, 0);
  otherTabSets('2030-06-07T15:00:00.000Z');
  badge = badgeParts(fresh);
  assert.match(badge.message.textContent, /changed in another tab/);
  assert.equal(badge.line.hidden, false);
  showSimulationBadge();
  assert.equal(storageListeners.length, 1, 'one listener per page');
  assert.equal(reloads.length, 1);
});

test('admin branch hosts update the badge in place, without a notice', () => {
  ['page', 'live', 'network'].forEach((tld) => {
    const body = installDom();
    setLocation(`product-admin--vitamix--aemsites.aem.${tld}`);
    otherTabSets(null);
    showSimulationBadge();
    reloads.length = 0;
    otherTabSets('2030-02-03T15:00:00.000Z');
    const badge = badgeParts(body);
    assert.equal(badge.notice.hidden, true, tld);
    assert.match(badge.value.textContent, /Feb 3, 2030/);
    otherTabSets('2030-03-04T15:00:00.000Z');
    assert.match(badge.value.textContent, /Mar 4, 2030/);
    otherTabSets(null);
    assert.equal(badge.root.isConnected, false);
    assert.deepEqual(reloads, []);
  });
});

test('the parameter applies once per page, even when other query parameters change', () => {
  setLocation('localhost', '?simulateDate=2030-01-02T00:00:00Z');
  assert.equal(getSimulatedDate().toISOString(), '2030-01-02T00:00:00.000Z');
  otherTabSets('2030-05-06T00:00:00.000Z');
  globalThis.location.search = '?simulateDate=2030-01-02T00:00:00Z&color=red';
  assert.equal(getSimulatedDate().toISOString(), '2030-05-06T00:00:00.000Z');
  otherTabSets(null);
  globalThis.location.search = '?simulateDate=2030-01-02T00:00:00Z&color=blue';
  assert.equal(getSimulatedDate(), null);
  assert.equal(localStorage.getItem('vitamix.now'), null);
});

test('indicator: nothing on production hosts, even with a stored date', () => {
  const body = installDom();
  setLocation('www.vitamix.com', '?simulateDate=2030-01-02T15:00:00Z');
  localStorage.setItem('vitamix.now', '2030-01-02T15:00:00.000Z');
  const listeners = storageListeners.length;
  showSimulationBadge();
  assert.equal(body.children.length, 0);
  assert.equal(storageListeners.length, listeners);
});

test('loaded after another tab set a date: the badge offers a reload', async () => {
  const fresh = await import('../../scripts/simulate-date.js?loaded-later');
  const body = installDom();
  setLocation('localhost');
  localStorage.setItem('vitamix.now', '2030-08-09T15:00:00.000Z');
  fresh.showSimulationBadge({ loadedWith: null });
  const badge = badgeParts(body);
  assert.equal(badge.notice.hidden, false);
  assert.match(badge.message.textContent, /changed in another tab/);
  assert.match(badge.value.textContent, /Aug 9, 2030/);
});
