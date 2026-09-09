/**
 * Minimum remaining lifetime (in ms) before an estimate token is considered
 * "expiring soon" and should be proactively refreshed. 5 minutes gives enough
 * headroom to complete the order-create + payment-initiate round-trips.
 */
const ESTIMATE_TOKEN_BUFFER_MS = 5 * 60 * 1000;

/**
 * Decode a JWT's `exp` claim and return whether the token is expired or will
 * expire within the buffer window. Returns `true` (needs refresh) when the
 * token cannot be decoded.
 *
 * @param {string|null|undefined} token - JWT estimate token
 * @param {number} [bufferMs] - refresh when fewer than this many ms remain
 * @returns {boolean}
 */
// eslint-disable-next-line import/prefer-default-export
export function isEstimateExpiringSoon(token, bufferMs = ESTIMATE_TOKEN_BUFFER_MS) {
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return (payload.exp * 1000) - Date.now() < bufferMs;
  } catch {
    return true;
  }
}
