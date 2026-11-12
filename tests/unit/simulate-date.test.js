/**
 * Unit tests for scripts/simulate-date.js.
 */
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  getSimulatedDate, withSimulatedDate, noteSimulatedAt, getSimulationStatus,
  showSimulationBadge, parseSimulatedDate, isSimulationHost,
} from '../../scripts/simulate-date.js';

function setLocation(hostname, search = '') {
  globalThis.location = {
    hostname,
    search,
    href: `https://${hostname}/us/en_us/products/x${search}`,
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
      setAttribute(name, value) { this.attributes[name] = value; },
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
    const [, value, , status, , clear] = badge.children;
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

test('indicator: follows a date set or cleared in another tab', () => {
  const body = installDom();
  setLocation('localhost', '?page=1');
  showSimulationBadge();
  assert.equal(body.children.length, 0);
  assert.equal(storageListeners.length, 1);

  otherTabSets('2030-02-03T15:00:00.000Z');
  assert.equal(body.children.length, 1);
  const [badge] = body.children;
  assert.match(badge.children[1].textContent, /Feb 3, 2030/);
  assert.equal(badge.isConnected, true);

  otherTabSets('2030-04-05T15:00:00.000Z');
  assert.match(badge.children[1].textContent, /Apr 5, 2030/);

  otherTabSets(null);
  assert.equal(badge.isConnected, false);

  otherTabSets('2030-06-07T15:00:00.000Z');
  assert.equal(body.children.length, 2);
  assert.equal(body.children[1].isConnected, true);
  showSimulationBadge();
  assert.equal(storageListeners.length, 1, 'one listener per page');
});

test('indicator: a new date resets the "not applied" state', () => {
  const body = installDom();
  setLocation('localhost', '?simulateDate=2030-01-02T15:00:00Z');
  showSimulationBadge();
  const badge = body.children.at(-1);
  const status = badge.children[3];
  noteSimulatedAt({ subtotal: 1 });
  assert.equal(status.hidden, false);
  otherTabSets('2030-01-09T15:00:00.000Z');
  assert.equal(status.hidden, true);
  assert.equal(getSimulationStatus(), null);
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
