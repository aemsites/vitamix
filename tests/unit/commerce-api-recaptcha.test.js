/**
 * Unit tests for the reCAPTCHA handling in scripts/commerce-api.js post():
 * the single retry with a fresh token, mint diagnostics on the operations log,
 * and isRecaptchaError().
 *
 * Run with `npm run test:unit`.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { previewOrder, createOrder, isRecaptchaError } from '../../scripts/commerce-api.js';
import { __resetScripts } from './mocks/scripts.mjs';

const RECAPTCHA_FAILED = 'ADOBE_COMMERCE_RECAPTCHA_FAILED';

/** Build a JWT-shaped token whose payload carries the given `exp` (Unix secs). */
function makeJwt(expSec) {
  const payload = Buffer.from(JSON.stringify({ exp: expSec })).toString('base64url');
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`;
}

/** Commerce API requests (excluding operations-log beacons), in order. */
let apiCalls;
/** Parsed operations-log payloads, in order. */
let opsLogs;

/**
 * Route fetch: operations-log beacons are captured, API calls get the next
 * queued response.
 * @param {Array<{status: number, body: Object}>} responses
 */
function mockApi(responses) {
  const queue = [...responses];
  apiCalls = [];
  opsLogs = [];
  globalThis.__setFetchMock(async (url, init) => {
    if (String(url).includes('/operations-log')) {
      opsLogs.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({}) };
    }
    apiCalls.push({ url, headers: { ...init.headers } });
    const { status, body } = queue.shift() ?? { status: 500, body: {} };
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      headers: { get: (name) => (name === 'x-error-code' && body?.code) || null },
    };
  });
}

const rejection = (reason) => ({
  status: 403,
  body: { code: RECAPTCHA_FAILED, message: 'recaptcha token required', details: { reason } },
});

/**
 * Install a ready fake SDK. `results` are consumed in order by execute();
 * Error instances reject.
 */
function installGrecaptcha(results) {
  const queue = [...results];
  let executeCalls = 0;
  globalThis.window.grecaptcha = {
    enterprise: {
      ready: (cb) => cb(),
      execute: async () => {
        executeCalls += 1;
        const next = queue.shift();
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
  return { get executeCalls() { return executeCalls; } };
}

beforeEach(() => {
  globalThis.__resetTestState();
  __resetScripts();
  delete globalThis.window.grecaptcha;
  delete globalThis.window.IS_TEST_MODE;
});

test('post: sends the minted token and does not retry a successful request', async () => {
  installGrecaptcha(['tok-1']);
  mockApi([{ status: 200, body: { total: '10.00' } }]);

  const result = await previewOrder({ items: [] });

  assert.deepEqual(result, { total: '10.00' });
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].headers['X-Recaptcha-Token'], 'tok-1');
  assert.equal(opsLogs.length, 0);
});

test('post: retries once with a fresh token after a token_required rejection', async () => {
  installGrecaptcha(['tok-1', 'tok-2']);
  mockApi([rejection('token_required'), { status: 200, body: { total: '10.00' } }]);

  const result = await previewOrder({ items: [] });

  assert.deepEqual(result, { total: '10.00' });
  assert.equal(apiCalls.length, 2);
  assert.equal(apiCalls[0].headers['X-Recaptcha-Token'], 'tok-1');
  assert.equal(apiCalls[1].headers['X-Recaptcha-Token'], 'tok-2');
  assert.equal(opsLogs.length, 0, 'a recovered request must not raise an error alert');
});

test('post: retries once after an invalid (e.g. BROWSER_ERROR) rejection on order create', async () => {
  installGrecaptcha(['tok-1', 'tok-2']);
  mockApi([rejection('invalid'), { status: 200, body: { order: { id: 'o-1' } } }]);

  const result = await createOrder({ items: [] });

  assert.deepEqual(result, { order: { id: 'o-1' } });
  assert.equal(apiCalls.length, 2);
});

test('post: retries when the first mint failed and the request went out without a token', async () => {
  const sdk = installGrecaptcha([new Error('x'), new Error('x'), new Error('x'), 'tok-late']);
  mockApi([rejection('token_required'), { status: 200, body: { ok: true } }]);

  await previewOrder({ items: [] });

  assert.equal(apiCalls[0].headers['X-Recaptcha-Token'], undefined);
  assert.equal(apiCalls[1].headers['X-Recaptcha-Token'], 'tok-late');
  assert.equal(sdk.executeCalls, 4);
});

['low_score', 'action_mismatch', 'hostname_mismatch'].forEach((reason) => {
  test(`post: does not retry a ${reason} rejection`, async () => {
    const sdk = installGrecaptcha(['tok-1', 'tok-2']);
    mockApi([rejection(reason)]);

    await assert.rejects(previewOrder({ items: [] }), (err) => err.status === 403);

    assert.equal(apiCalls.length, 1);
    assert.equal(sdk.executeCalls, 1);
  });
});

test('post: does not retry a non-reCAPTCHA 403', async () => {
  installGrecaptcha(['tok-1', 'tok-2']);
  mockApi([{ status: 403, body: { code: 'ADOBE_COMMERCE_FORBIDDEN', details: { reason: 'invalid' } } }]);

  await assert.rejects(previewOrder({ items: [] }));

  assert.equal(apiCalls.length, 1);
});

test('post: retries only once and logs both mint attempts when the retry is rejected too', async () => {
  installGrecaptcha(['tok-1', 'tok-2']);
  mockApi([rejection('invalid'), rejection('invalid')]);

  await assert.rejects(previewOrder({ items: [] }), (err) => err.status === 403);

  assert.equal(apiCalls.length, 2);
  assert.equal(opsLogs.length, 1, 'one error alert per failed call, not per attempt');
  const { recaptcha } = opsLogs[0];
  assert.equal(recaptcha.minted, true);
  assert.equal(recaptcha.failure, null);
  assert.equal(recaptcha.rejectedReason, 'invalid');
  assert.equal(recaptcha.retry.minted, true);
  assert.equal(typeof recaptcha.elapsedMs, 'number');
  const logged = JSON.stringify(opsLogs[0]);
  assert.ok(!logged.includes('tok-1') && !logged.includes('tok-2'), 'tokens must never be logged');
});

test('post: does not resend when the retry cannot mint a token', async () => {
  installGrecaptcha(['tok-1', new Error('x'), new Error('x'), new Error('x')]);
  mockApi([rejection('invalid')]);

  await assert.rejects(previewOrder({ items: [] }), (err) => err.status === 403);

  assert.equal(apiCalls.length, 1);
  assert.equal(opsLogs[0].recaptcha.retry.minted, false);
  assert.equal(opsLogs[0].recaptcha.retry.failure, 'execute-error');
});

test('post: logs the mint failure reason when no token could be minted', async () => {
  // No SDK and no DOM in the test runtime: the load fails immediately.
  mockApi([rejection('low_score')]);

  await assert.rejects(previewOrder({ items: [] }));

  assert.equal(opsLogs[0].recaptcha.minted, false);
  assert.equal(opsLogs[0].recaptcha.failure, 'load-error');
  assert.equal(opsLogs[0].recaptcha.sdkWarm, false);
});

test('post: signed-in shoppers skip reCAPTCHA and never retry', async () => {
  globalThis.localStorage.setItem('auth_token', makeJwt(Math.floor(Date.now() / 1000) + 3600));
  const sdk = installGrecaptcha(['tok-1']);
  mockApi([rejection('token_required')]);

  await assert.rejects(previewOrder({ items: [] }));

  assert.equal(sdk.executeCalls, 0);
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].headers['X-Recaptcha-Token'], undefined);
  assert.ok(apiCalls[0].headers.Authorization.startsWith('Bearer '));
  assert.equal(opsLogs[0].recaptcha, undefined);
});

test('isRecaptchaError: matches the reCAPTCHA error code', () => {
  assert.equal(isRecaptchaError({ code: RECAPTCHA_FAILED }), true);
});

test('isRecaptchaError: matches a reCAPTCHA x-error header', () => {
  assert.equal(isRecaptchaError({ errorHeader: 'recaptcha token required' }), true);
});

test('isRecaptchaError: ignores other errors', () => {
  assert.equal(isRecaptchaError({ code: 'ADOBE_COMMERCE_FORBIDDEN', errorHeader: 'forbidden' }), false);
  assert.equal(isRecaptchaError(new Error('network')), false);
  assert.equal(isRecaptchaError(undefined), false);
});
