/**
 * Product review status – sheet-logger client
 * Base path: /vitamix.com/product-review-status
 * Events: status_change (status), comment (text). Each has urlKey, user (first name), ts.
 */

const API_BASE = 'https://sheet-logger.david8603.workers.dev/vitamix.com/product-review-status';

function normalizeEvents(data) {
  return (data || []).map((ev) => ({
    ...ev,
    ts: ev.timeStamp || ev.ts,
  }));
}

/**
 * @returns {Promise<Array<{ op: string, urlKey: string, user: string, ts: string, status?: string, text?: string }>>}
 */
export async function fetchReviewLog() {
  const response = await fetch(API_BASE);
  if (!response.ok) {
    throw new Error(`Review log: HTTP ${response.status}`);
  }
  const data = await response.json();
  return normalizeEvents(data);
}

/**
 * Append one event to the log. Caller should pass user (first name) from user-identity.
 * @param {object} event - { op: 'status_change'|'comment', urlKey, user, status?, text? }
 */
export async function appendReviewEvent(event) {
  const payload = {
    ...event,
    ts: event.ts || new Date().toISOString(),
  };
  const params = new URLSearchParams();
  Object.entries(payload).forEach(([key, value]) => {
    params.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  });
  const response = await fetch(`${API_BASE}?${params.toString()}`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`Review log: HTTP ${response.status}`);
  }
}

/**
 * From full event log, compute latest review status per urlKey.
 * @param {Array<{ op: string, urlKey: string, status?: string }>} events
 * @returns {Record<string, string>} urlKey -> latest status (empty string if none)
 */
export function getLatestStatusByUrlKey(events) {
  const byProduct = {};
  const sorted = [...events].filter((e) => e.urlKey).sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
  sorted.forEach((e) => {
    if (e.op === 'status_change' && e.status != null) {
      byProduct[e.urlKey] = String(e.status);
    }
  });
  return byProduct;
}

/**
 * From full event log, compute last status-change timestamp per urlKey (ISO string).
 * @param {Array<{ op: string, urlKey: string, ts?: string }>} events
 * @returns {Record<string, string>} urlKey -> ts of last status_change (or '' if none)
 */
export function getLastStatusUpdateByUrlKey(events) {
  const byProduct = {};
  const sorted = [...events].filter((e) => e.urlKey && e.op === 'status_change').sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
  sorted.forEach((e) => {
    if (e.ts) byProduct[e.urlKey] = e.ts;
  });
  return byProduct;
}

/**
 * Full review history for one product (status changes + comments), oldest first.
 * @param {Array<object>} events
 * @param {string} urlKey
 * @returns {Array<{ op: string, user: string, ts: string, status?: string, text?: string }>}
 */
export function getReviewHistoryForProduct(events, urlKey) {
  return [...events]
    .filter((e) => e.urlKey === urlKey && (e.op === 'status_change' || e.op === 'comment'))
    .sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
}

export const REVIEW_STATUS_OPTIONS = [
  'Not started',
  'Reviewed with comments',
  'Comments addressed',
  'Completed',
];
