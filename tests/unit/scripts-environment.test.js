import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';

// scripts/scripts.js bootstraps the page at import time, so it cannot be imported in
// the Node test runner (the loader swaps it for a mock). Run the real environment
// block (isProdHost → window.CommerceConfig) from the source instead of keeping a copy
// that can drift.
const source = readFileSync(new URL('../../scripts/scripts.js', import.meta.url), 'utf8');
const block = source.match(
  /^export const isProdHost[\s\S]*?\nwindow\.CommerceConfig = \{[\s\S]*?\n\};\n/m,
);

/**
 * Evaluates the environment block for a given host and URL path.
 *
 * @param {string} hostname
 * @param {string} [pathname]
 * @returns {{ isProdHost: boolean, ids: object, clientId: string }}
 */
function evaluate(hostname, pathname = '/us/en_us/') {
  const window = { location: { pathname } };
  const code = `${block[0].replace(/^export const/gm, 'const')}
    ({ isProdHost, ids: PAYPAL_CLIENT_IDS, clientId: window.CommerceConfig.paypal.clientId });`;
  return runInNewContext(code, { hostname, window });
}

describe('scripts.js environment block', () => {
  it('is found in scripts.js', () => {
    assert.ok(block, 'expected isProdHost … window.CommerceConfig block in scripts/scripts.js');
  });
});

describe('isProdHost', () => {
  it('is true only for the canonical www and apex hosts', () => {
    assert.equal(evaluate('www.vitamix.com').isProdHost, true);
    assert.equal(evaluate('vitamix.com').isProdHost, true);
  });

  it('is false for environment subdomains', () => {
    ['uat.vitamix.com', 'test.vitamix.com', 'stage.vitamix.com', 'integration.vitamix.com']
      .forEach((host) => assert.equal(evaluate(host).isProdHost, false, host));
  });

  it('is false for preview, branch and local hosts', () => {
    [
      'main--vitamix--aemsites.aem.network',
      'main--vitamix--aemsites.aem.page',
      'main--vitamix--aemsites.aem.live',
      'localhost',
      '127.0.0.1',
    ].forEach((host) => assert.equal(evaluate(host).isProdHost, false, host));
  });

  it('is false for look-alike hosts that merely contain the production host', () => {
    ['www.vitamix.com.example.com', 'notvitamix.com', 'evilvitamix.com', 'vitamix.com.evil.io']
      .forEach((host) => assert.equal(evaluate(host).isProdHost, false, host));
  });
});

describe('PayPal client ID', () => {
  it('uses the production ID for the locale on the production host', () => {
    const us = evaluate('www.vitamix.com', '/us/en_us/cart');
    const ca = evaluate('www.vitamix.com', '/ca/en_us/cart');
    assert.equal(us.clientId, us.ids.production.us);
    assert.equal(ca.clientId, ca.ids.production.ca);
  });

  it('uses the sandbox ID for the locale on every non-production host', () => {
    [
      'uat.vitamix.com',
      'test.vitamix.com',
      'main--vitamix--aemsites.aem.network',
      'localhost',
    ].forEach((host) => {
      const ca = evaluate(host, '/ca/en_us/cart');
      assert.equal(ca.clientId, ca.ids.sandbox.ca, host);
      const us = evaluate(host, '/us/en_us/cart');
      assert.equal(us.clientId, us.ids.sandbox.us, host);
    });
  });

  it('falls back to the us ID for locales without their own PayPal app', () => {
    const prod = evaluate('www.vitamix.com', '/mx/en_us/cart');
    assert.equal(prod.clientId, prod.ids.production.us);
    const stage = evaluate('uat.vitamix.com', '/mx/en_us/cart');
    assert.equal(stage.clientId, stage.ids.sandbox.us);
  });

  it('falls back to the us ID when the URL has no locale segment', () => {
    const { clientId, ids } = evaluate('uat.vitamix.com', '/');
    assert.equal(clientId, ids.sandbox.us);
  });

  it('defines the same locales for every environment', () => {
    const { ids } = evaluate('www.vitamix.com');
    assert.deepEqual(Object.keys(ids.production).sort(), Object.keys(ids.sandbox).sort());
  });

  it('has a production client ID for every locale', () => {
    const { ids } = evaluate('www.vitamix.com');
    Object.entries(ids.production).forEach(([locale, id]) => {
      assert.ok(id, `production client ID for "${locale}" must be set`);
    });
  });

  it('never reuses a sandbox client ID in production', () => {
    // A sandbox ID in production makes the express popup open www.sandbox.paypal.com
    // for orders the (live) Commerce API created on www.paypal.com.
    const { ids } = evaluate('www.vitamix.com');
    const sandboxIds = new Set(Object.values(ids.sandbox));
    Object.entries(ids.production).forEach(([locale, id]) => {
      assert.ok(!sandboxIds.has(id), `production client ID for "${locale}" is a sandbox ID`);
    });
  });
});
