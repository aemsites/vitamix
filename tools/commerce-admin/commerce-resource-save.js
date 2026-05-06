/* eslint-disable import/prefer-default-export -- single helper; named import at callsites */
/**
 * ProductBus update helper: PUT then PATCH on 405.
 */
import { apiFetch } from './commerce-otp-api.js';
import { PB_ORG, PB_SITE } from './commerce-pbus-config.js';

async function readErr(resp) {
  return resp.headers.get('x-error')
    || (await resp.text().catch(() => '')).trim()
    || `HTTP ${resp.status}`;
}

/**
 * @param {string} path - e.g. `orders/id` or `customers/email%40x`
 * @param {object} body
 */
export async function putOrPatchResource(path, body) {
  const json = JSON.stringify(body);
  let resp = await apiFetch(PB_ORG, PB_SITE, path, {
    method: 'PUT',
    body: json,
  });
  if (resp.status === 405) {
    resp = await apiFetch(PB_ORG, PB_SITE, path, {
      method: 'PATCH',
      body: json,
    });
  }
  if (!resp.ok) {
    throw new Error(await readErr(resp));
  }
}
