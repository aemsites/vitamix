import { test, expect } from '@playwright/test';

/**
 * Unit tests for mintRecaptchaToken (from scripts/recaptcha.js).
 *
 * The function is inlined here because scripts/recaptcha.js imports
 * loadScript from aem.js, and aem.js cannot be imported in the Node
 * test runner — it sets `window.hlx = ...` at module load. This mirrors
 * the existing pattern in pricing.spec.js for the same reason.
 *
 * Keep this copy in sync with the real module's behavior. The contract:
 * returns '' on any failure (missing site key, missing SDK, execute()
 * rejection, falsy token); otherwise returns the token from
 * grecaptcha.enterprise.execute(siteKey, { action }).
 */

async function mintRecaptchaToken(action, siteKey, grecaptcha) {
  if (!siteKey) return '';
  if (!grecaptcha?.enterprise?.execute) return '';
  try {
    await new Promise((resolve) => { grecaptcha.enterprise.ready(resolve); });
    const token = await grecaptcha.enterprise.execute(siteKey, { action });
    return token || '';
  } catch {
    return '';
  }
}

function makeFakeGrecaptcha({ token = 'fake-token', execute, ready } = {}) {
  return {
    enterprise: {
      ready: ready || ((cb) => cb()),
      execute: execute || (async () => token),
    },
  };
}

test.describe('mintRecaptchaToken', () => {
  test('returns empty string when site key is empty (graceful degradation)', async () => {
    const grecaptcha = makeFakeGrecaptcha();
    const result = await mintRecaptchaToken('auth_login', '', grecaptcha);
    expect(result).toBe('');
  });

  test('returns empty string when grecaptcha is undefined', async () => {
    const result = await mintRecaptchaToken('auth_login', 'site-key', undefined);
    expect(result).toBe('');
  });

  test('returns empty string when grecaptcha.enterprise is missing', async () => {
    const result = await mintRecaptchaToken('auth_login', 'site-key', {});
    expect(result).toBe('');
  });

  test('returns the token from grecaptcha.enterprise.execute on happy path', async () => {
    const grecaptcha = makeFakeGrecaptcha({ token: 'real-token-123' });
    const result = await mintRecaptchaToken('auth_login', 'site-key', grecaptcha);
    expect(result).toBe('real-token-123');
  });

  test('passes the action and site key to grecaptcha.enterprise.execute', async () => {
    let observedSiteKey;
    let observedAction;
    const grecaptcha = makeFakeGrecaptcha({
      execute: async (siteKey, opts) => {
        observedSiteKey = siteKey;
        observedAction = opts.action;
        return 'token';
      },
    });
    await mintRecaptchaToken('orders_create', 'site-key-abc', grecaptcha);
    expect(observedSiteKey).toBe('site-key-abc');
    expect(observedAction).toBe('orders_create');
  });

  test('waits for grecaptcha.enterprise.ready before executing', async () => {
    const callOrder = [];
    const grecaptcha = makeFakeGrecaptcha({
      ready: (cb) => {
        callOrder.push('ready');
        setTimeout(cb, 10);
      },
      execute: async () => {
        callOrder.push('execute');
        return 'token';
      },
    });
    await mintRecaptchaToken('auth_login', 'site-key', grecaptcha);
    expect(callOrder).toEqual(['ready', 'execute']);
  });

  test('returns empty string when execute throws (fail-open)', async () => {
    const grecaptcha = makeFakeGrecaptcha({
      execute: async () => { throw new Error('execute failed'); },
    });
    const result = await mintRecaptchaToken('auth_login', 'site-key', grecaptcha);
    expect(result).toBe('');
  });

  test('returns empty string when execute returns falsy', async () => {
    const grecaptcha = makeFakeGrecaptcha({ execute: async () => '' });
    const result = await mintRecaptchaToken('auth_login', 'site-key', grecaptcha);
    expect(result).toBe('');
  });
});
