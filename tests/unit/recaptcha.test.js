/**
 * Unit tests for scripts/recaptcha.js — SDK loading, token minting with
 * diagnostics, and the first-interaction warm-up.
 *
 * The module keeps the in-flight SDK load in module state, so each test
 * imports a fresh module instance (cache-busting query string) to stay
 * isolated. The DOM is faked with just enough surface for script injection.
 *
 * Run with `npm run test:unit`.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const SITE_KEY = 'test-site-key';

let instance = 0;
/** Import a fresh copy of scripts/recaptcha.js with clean module state. */
async function freshRecaptcha() {
  instance += 1;
  return import(`../../scripts/recaptcha.js?case=${instance}`);
}

/** Script elements injected via document.createElement, in order. */
let scripts;

function installFakeDom() {
  scripts = [];
  globalThis.document.createElement = (tag) => {
    const listeners = {};
    const el = {
      tag,
      src: '',
      async: false,
      removed: false,
      addEventListener(type, fn) { listeners[type] = fn; },
      remove() { this.removed = true; },
      fire(type) { listeners[type]?.(); },
    };
    scripts.push(el);
    return el;
  };
  globalThis.document.head = { appendChild() {} };
}

/**
 * Install a fake grecaptcha.enterprise. `execute` may be a function or a list
 * of results consumed in order (Error instances reject).
 */
function installGrecaptcha({ execute = async () => 'token-1', readyDelayMs = 0 } = {}) {
  const calls = [];
  let run = execute;
  if (Array.isArray(execute)) {
    const queue = [...execute];
    run = async () => {
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next;
    };
  }
  globalThis.window.grecaptcha = {
    enterprise: {
      ready: (cb) => { if (readyDelayMs) setTimeout(cb, readyDelayMs); else cb(); },
      execute: (siteKey, opts) => {
        calls.push({ siteKey, action: opts?.action });
        return run(siteKey, opts);
      },
    },
  };
  return calls;
}

/** Let pending promise callbacks run. */
const flush = () => new Promise((resolve) => { setImmediate(resolve); });

beforeEach(() => {
  globalThis.__resetTestState();
  delete globalThis.window.grecaptcha;
  installFakeDom();
});

// --- mintRecaptchaTokenDetailed: warm SDK ----------------------------------

test('mint: returns the token with success diagnostics when the SDK is ready', async () => {
  const { mintRecaptchaTokenDetailed } = await freshRecaptcha();
  const calls = installGrecaptcha({ execute: async () => 'tok-abc' });

  const { token, diagnostics } = await mintRecaptchaTokenDetailed('orders_preview', { siteKey: SITE_KEY });

  assert.equal(token, 'tok-abc');
  assert.equal(diagnostics.minted, true);
  assert.equal(diagnostics.failure, null);
  assert.equal(diagnostics.sdkWarm, true);
  assert.equal(diagnostics.executeAttempts, 1);
  assert.equal(typeof diagnostics.elapsedMs, 'number');
  assert.deepEqual(calls, [{ siteKey: SITE_KEY, action: 'orders_preview' }]);
  assert.equal(scripts.length, 0, 'a ready SDK must not inject another script');
});

test('mint: reports "disabled" without loading anything when there is no site key', async () => {
  const { mintRecaptchaTokenDetailed } = await freshRecaptcha();

  const { token, diagnostics } = await mintRecaptchaTokenDetailed('orders_preview', { siteKey: '' });

  assert.equal(token, '');
  assert.equal(diagnostics.failure, 'disabled');
  assert.equal(scripts.length, 0);
});

test('mint: diagnostics never include the token', async () => {
  const { mintRecaptchaTokenDetailed } = await freshRecaptcha();
  installGrecaptcha({ execute: async () => 'secret-token' });

  const { diagnostics } = await mintRecaptchaTokenDetailed('orders_preview', { siteKey: SITE_KEY });

  assert.ok(!JSON.stringify(diagnostics).includes('secret-token'));
});

// --- mintRecaptchaTokenDetailed: cold SDK load ------------------------------

test('mint: injects the SDK once and mints after load + ready', async () => {
  const { mintRecaptchaTokenDetailed } = await freshRecaptcha();

  const pending = mintRecaptchaTokenDetailed('orders_create', { siteKey: SITE_KEY, timeoutMs: 1000 });
  await flush();
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, `https://www.google.com/recaptcha/enterprise.js?render=${SITE_KEY}`);
  assert.equal(scripts[0].async, true);

  installGrecaptcha({ execute: async () => 'cold-token' });
  scripts[0].fire('load');
  const { token, diagnostics } = await pending;

  assert.equal(token, 'cold-token');
  assert.equal(diagnostics.sdkWarm, false);
  assert.equal(diagnostics.failure, null);
});

test('mint: concurrent mints share one SDK load', async () => {
  const { mintRecaptchaTokenDetailed } = await freshRecaptcha();

  const first = mintRecaptchaTokenDetailed('orders_preview', { siteKey: SITE_KEY, timeoutMs: 1000 });
  const second = mintRecaptchaTokenDetailed('orders_create', { siteKey: SITE_KEY, timeoutMs: 1000 });
  await flush();
  assert.equal(scripts.length, 1);

  installGrecaptcha({ execute: ['a', 'b'] });
  scripts[0].fire('load');
  const results = await Promise.all([first, second]);

  assert.deepEqual(results.map((r) => r.token).sort(), ['a', 'b']);
});

test('mint: a load timeout keeps the slow script so a later mint can adopt it', async () => {
  const { mintRecaptchaTokenDetailed } = await freshRecaptcha();

  const timedOut = await mintRecaptchaTokenDetailed('orders_preview', { siteKey: SITE_KEY, timeoutMs: 30 });
  assert.equal(timedOut.token, '');
  assert.equal(timedOut.diagnostics.failure, 'load-timeout');
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].removed, false, 'a slow download must be left running');

  const retry = mintRecaptchaTokenDetailed('orders_preview', { siteKey: SITE_KEY, timeoutMs: 1000 });
  await flush();
  installGrecaptcha({ execute: async () => 'late-token' });
  scripts[0].fire('load');
  const { token } = await retry;

  assert.equal(token, 'late-token');
  assert.equal(scripts.length, 1, 'the retry must adopt the in-flight load, not inject a second script');
});

test('mint: a load error removes the script and the next mint starts a fresh download', async () => {
  const { mintRecaptchaTokenDetailed } = await freshRecaptcha();

  const pending = mintRecaptchaTokenDetailed('orders_preview', { siteKey: SITE_KEY, timeoutMs: 1000 });
  await flush();
  scripts[0].fire('error');
  const failed = await pending;

  assert.equal(failed.diagnostics.failure, 'load-error');
  assert.equal(scripts[0].removed, true);

  const next = mintRecaptchaTokenDetailed('orders_preview', { siteKey: SITE_KEY, timeoutMs: 1000 });
  await flush();
  assert.equal(scripts.length, 2, 'a failed load must not be cached');
  installGrecaptcha({ execute: async () => 'second-try' });
  scripts[1].fire('load');
  assert.equal((await next).token, 'second-try');
});

test('mint: reports "ready-unavailable" when the script loads without grecaptcha', async () => {
  const { mintRecaptchaTokenDetailed } = await freshRecaptcha();

  const pending = mintRecaptchaTokenDetailed('orders_preview', { siteKey: SITE_KEY, timeoutMs: 1000 });
  await flush();
  scripts[0].fire('load');
  const { token, diagnostics } = await pending;

  assert.equal(token, '');
  assert.equal(diagnostics.failure, 'ready-unavailable');
  assert.equal(scripts[0].removed, true);
});

test('mint: a synchronous injection failure is reported and not cached', async () => {
  const { mintRecaptchaTokenDetailed } = await freshRecaptcha();
  const { createElement } = globalThis.document;
  globalThis.document.createElement = () => { throw new Error('no DOM'); };

  const failed = await mintRecaptchaTokenDetailed('orders_preview', { siteKey: SITE_KEY, timeoutMs: 1000 });
  assert.equal(failed.diagnostics.failure, 'load-error');

  globalThis.document.createElement = createElement;
  const next = mintRecaptchaTokenDetailed('orders_preview', { siteKey: SITE_KEY, timeoutMs: 1000 });
  await flush();
  assert.equal(scripts.length, 1, 'the next mint must try to load again');
  installGrecaptcha({ execute: async () => 'recovered' });
  scripts[0].fire('load');
  assert.equal((await next).token, 'recovered');
});

test('mint: reports "load-timeout" when ready() never fires within the budget', async () => {
  const { mintRecaptchaTokenDetailed } = await freshRecaptcha();
  installGrecaptcha({ readyDelayMs: 500 });
  // Simulate a partially bootstrapped SDK: ready exists, execute does not.
  delete globalThis.window.grecaptcha.enterprise.execute;

  const pending = mintRecaptchaTokenDetailed('orders_preview', { siteKey: SITE_KEY, timeoutMs: 30 });
  await flush();
  scripts[0].fire('load');
  const { diagnostics } = await pending;

  assert.equal(diagnostics.failure, 'load-timeout');
});

// --- mintRecaptchaTokenDetailed: execute() ----------------------------------

test('mint: retries execute() and succeeds on a later attempt', async () => {
  const { mintRecaptchaTokenDetailed } = await freshRecaptcha();
  installGrecaptcha({ execute: [new Error('network'), new Error('network'), 'third-time'] });

  const { token, diagnostics } = await mintRecaptchaTokenDetailed('orders_preview', { siteKey: SITE_KEY, timeoutMs: 5000 });

  assert.equal(token, 'third-time');
  assert.equal(diagnostics.executeAttempts, 3);
});

test('mint: gives up after three failed execute() attempts', async () => {
  const { mintRecaptchaTokenDetailed } = await freshRecaptcha();
  const calls = installGrecaptcha({ execute: async () => { throw new Error('boom'); } });

  const { token, diagnostics } = await mintRecaptchaTokenDetailed('orders_preview', { siteKey: SITE_KEY, timeoutMs: 5000 });

  assert.equal(token, '');
  assert.equal(diagnostics.failure, 'execute-error');
  assert.equal(diagnostics.executeAttempts, 3);
  assert.equal(calls.length, 3);
});

test('mint: reports "execute-timeout" when execute() hangs past the budget', async () => {
  const { mintRecaptchaTokenDetailed } = await freshRecaptcha();
  installGrecaptcha({ execute: () => new Promise(() => {}) });

  const { token, diagnostics } = await mintRecaptchaTokenDetailed('orders_preview', { siteKey: SITE_KEY, timeoutMs: 40 });

  assert.equal(token, '');
  assert.equal(diagnostics.failure, 'execute-timeout');
  assert.equal(diagnostics.executeAttempts, 1);
});

test('mint: reports "empty-token" when execute() resolves without a token', async () => {
  const { mintRecaptchaTokenDetailed } = await freshRecaptcha();
  installGrecaptcha({ execute: async () => '' });

  const { token, diagnostics } = await mintRecaptchaTokenDetailed('orders_preview', { siteKey: SITE_KEY, timeoutMs: 100 });

  assert.equal(token, '');
  assert.equal(diagnostics.failure, 'empty-token');
});

test('mint: an execute() that throws synchronously is retried like a rejection', async () => {
  const { mintRecaptchaTokenDetailed } = await freshRecaptcha();
  let attempts = 0;
  installGrecaptcha({
    execute: () => {
      attempts += 1;
      if (attempts === 1) throw new Error('sync throw');
      return Promise.resolve('ok');
    },
  });

  const { token } = await mintRecaptchaTokenDetailed('orders_preview', { siteKey: SITE_KEY, timeoutMs: 5000 });

  assert.equal(token, 'ok');
});

// --- mintRecaptchaToken ------------------------------------------------------

test('mintRecaptchaToken: returns just the token string', async () => {
  const { mintRecaptchaToken } = await freshRecaptcha();
  installGrecaptcha({ execute: async () => 'plain' });

  assert.equal(await mintRecaptchaToken('auth_login', { siteKey: SITE_KEY }), 'plain');
});

test('mintRecaptchaToken: returns an empty string on failure', async () => {
  const { mintRecaptchaToken } = await freshRecaptcha();

  assert.equal(await mintRecaptchaToken('auth_login', { siteKey: '' }), '');
});

// --- warmRecaptchaOnInteraction -----------------------------------------------

function installFakeWindowEvents() {
  const listeners = new Map();
  const removed = [];
  globalThis.window.addEventListener = (type, fn, opts) => { listeners.set(type, { fn, opts }); };
  globalThis.window.removeEventListener = (type, fn, opts) => {
    removed.push({ type, opts });
    if (listeners.get(type)?.fn === fn) listeners.delete(type);
  };
  return { listeners, removed };
}

test('warm: waits for the first interaction before loading the SDK', async () => {
  const { warmRecaptchaOnInteraction } = await freshRecaptcha();
  const { listeners } = installFakeWindowEvents();

  warmRecaptchaOnInteraction(SITE_KEY);

  assert.deepEqual([...listeners.keys()].sort(), ['keydown', 'pointerdown', 'scroll']);
  listeners.forEach(({ opts }) => {
    assert.equal(opts.capture, true);
    assert.equal(opts.passive, true);
  });
  assert.equal(scripts.length, 0, 'nothing may load before the visitor interacts');
});

test('warm: the first interaction loads the SDK once and removes every listener', async () => {
  const { warmRecaptchaOnInteraction } = await freshRecaptcha();
  const { listeners, removed } = installFakeWindowEvents();

  warmRecaptchaOnInteraction(SITE_KEY);
  listeners.get('scroll').fn();

  assert.equal(scripts.length, 1);
  assert.equal(listeners.size, 0);
  assert.deepEqual(removed.map((r) => r.type).sort(), ['keydown', 'pointerdown', 'scroll']);
  removed.forEach(({ opts }) => assert.equal(opts.capture, true));
});

test('warm: a warm-up load lets the next mint reuse it', async () => {
  const { warmRecaptchaOnInteraction, mintRecaptchaTokenDetailed } = await freshRecaptcha();
  const { listeners } = installFakeWindowEvents();

  warmRecaptchaOnInteraction(SITE_KEY);
  listeners.get('pointerdown').fn();
  const pending = mintRecaptchaTokenDetailed('orders_preview', { siteKey: SITE_KEY, timeoutMs: 1000 });
  await flush();
  installGrecaptcha({ execute: async () => 'warm-token' });
  scripts[0].fire('load');

  assert.equal((await pending).token, 'warm-token');
  assert.equal(scripts.length, 1);
});

test('warm: a failed warm-up load does not throw', async () => {
  const { warmRecaptchaOnInteraction } = await freshRecaptcha();
  const { listeners } = installFakeWindowEvents();

  warmRecaptchaOnInteraction(SITE_KEY);
  listeners.get('keydown').fn();
  scripts[0].fire('error');
  await flush();

  assert.equal(scripts[0].removed, true);
});

test('warm: is idempotent', async () => {
  const { warmRecaptchaOnInteraction } = await freshRecaptcha();
  let added = 0;
  installFakeWindowEvents();
  const original = globalThis.window.addEventListener;
  globalThis.window.addEventListener = (...args) => { added += 1; original(...args); };

  warmRecaptchaOnInteraction(SITE_KEY);
  warmRecaptchaOnInteraction(SITE_KEY);

  assert.equal(added, 3);
});

test('warm: does nothing without a site key or when the SDK is already ready', async () => {
  const { warmRecaptchaOnInteraction } = await freshRecaptcha();
  const { listeners } = installFakeWindowEvents();

  warmRecaptchaOnInteraction('');
  assert.equal(listeners.size, 0);

  installGrecaptcha();
  warmRecaptchaOnInteraction(SITE_KEY);
  assert.equal(listeners.size, 0);
});
