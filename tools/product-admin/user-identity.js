/**
 * User identity for PIM (e.g. first name for review status).
 * Tries: DA SDK context (user info), then token/JWT only if name-like, then getUsername/getUser, then localStorage, then prompt.
 * Context is the preferred source; the JWT usually only has user_id like "opaqueId@adobe.com", which we do not use as a name.
 * See: https://docs.da.live/developers/guides/developing-apps-and-plugins
 */

const STORAGE_KEY = 'pim_userFirstName';

/**
 * Extract first name from a string (full name or "First Last").
 * @param {string} s
 * @returns {string|null}
 */
function toFirstName(s) {
  if (!s || typeof s !== 'string') return null;
  const first = s.trim().split(/\s+/)[0];
  return first && first.length >= 2 ? first : null;
}

/**
 * Try to get first name from the DA SDK context object.
 * Context contains "user and environment information" (docs.da.live); keys may vary.
 * @param {object} context
 * @returns {string|null}
 */
function firstNameFromContext(context) {
  if (!context || typeof context !== 'object') return null;
  const candidates = [
    context.firstName,
    context.first_name,
    context.name && toFirstName(context.name),
    context.userName && toFirstName(context.userName),
    context.user && (context.user.firstName || context.user.first_name || toFirstName(context.user.name)),
  ];
  for (const c of candidates) {
    if (c && typeof c === 'string' && c.length >= 2 && c.length <= 40 && !c.includes('@')) {
      return c.trim();
    }
  }
  // Fallback: any context value that looks like a single name (e.g. "Jane")
  for (const value of Object.values(context)) {
    if (typeof value === 'string' && value.length >= 2 && value.length <= 40 && /^[A-Za-z]/.test(value) && !value.includes('@')) {
      return value.trim();
    }
  }
  return null;
}

/**
 * Decode JWT payload without verification (client-side display only).
 * @param {string} jwt
 * @returns {object|null}
 */
function decodeJwtPayload(jwt) {
  if (!jwt || typeof jwt !== 'string') return null;
  const parts = jwt.trim().split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
    const json = decodeURIComponent(atob(padded).split('').map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Derive a first-name-like string from JWT user_id only when it looks like an email local part (e.g. "john.doe").
 * Opaque IDs (e.g. "7AEAC7035488B8500A4C98A1@adobe.com") are not used.
 * @param {string} userId
 * @returns {string|null}
 */
function firstNameFromUserId(userId) {
  if (!userId || typeof userId !== 'string') return null;
  const local = userId.split('@')[0].trim();
  if (!local) return null;
  if (local.length > 24 && /^[A-Za-z0-9]+$/.test(local)) return null;
  const segment = local.split(/[._]/)[0];
  if (!segment || segment.length < 2) return null;
  return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase();
}

/** Timeout (ms) for loading DA SDK – when not in DA the SDK promise may never resolve */
const SDK_LOAD_TIMEOUT_MS = 2500;

/**
 * Resolve first name from signed-in user (DA SDK context, then token, then getUsername/getUser).
 * If the SDK cannot load (e.g. not running in DA), we timeout and return null so "anonymous" is used.
 * @returns {Promise<string|null>} First name or null if not available
 */
async function getSignedInUserFirstName() {
  try {
    const sdkPromise = import('https://da.live/nx/utils/sdk.js').then((m) => m.default).catch(() => null);
    const sdk = await Promise.race([
      sdkPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), SDK_LOAD_TIMEOUT_MS)),
    ]);
    if (!sdk) return null;
    const resolvedPromise = typeof sdk.then === 'function' ? sdk : Promise.resolve(sdk);
    const resolved = await Promise.race([
      resolvedPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), SDK_LOAD_TIMEOUT_MS)),
    ]);
    if (!resolved || typeof resolved !== 'object') return null;
    const fromContext = firstNameFromContext(resolved.context);
    if (fromContext) return fromContext;
    const token = resolved.token;
    if (token && typeof token === 'string') {
      const payload = decodeJwtPayload(token);
      if (payload && payload.user_id) {
        const fromJwt = firstNameFromUserId(payload.user_id);
        if (fromJwt) return fromJwt;
      }
    }
    if (resolved && typeof resolved.getUsername === 'function') {
      const name = resolved.getUsername();
      if (name && typeof name === 'string') {
        const first = toFirstName(name);
        if (first) return first;
      }
    }
    if (resolved && typeof resolved.getUser === 'function') {
      const user = await Promise.resolve(resolved.getUser()).catch(() => null);
      if (user && user.name) {
        const first = toFirstName(user.name);
        if (first) return first;
      }
      if (user && user.firstName) return String(user.firstName).trim();
      if (user && user.email) return firstNameFromUserId(user.email) || null;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Get first name for the current user. Uses: signed-in user → localStorage → one-time prompt.
 * @returns {Promise<string>} Never empty; may be "Unknown" if user dismisses prompt
 */
export async function getFirstName() {
  const fromAuth = await getSignedInUserFirstName();
  if (fromAuth) {
    try {
      localStorage.setItem(STORAGE_KEY, fromAuth);
    } catch {
      // ignore
    }
    // eslint-disable-next-line no-console
    console.log('[PIM user identity] Will be sent to sheet-logger as "user":', fromAuth);
    return fromAuth;
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored.trim()) {
      // eslint-disable-next-line no-console
      console.log('[PIM user identity] Will be sent to sheet-logger as "user":', stored.trim(), '(from localStorage)');
      return stored.trim();
    }
  } catch {
    // ignore
  }
  // eslint-disable-next-line no-console
  console.log('[PIM user identity] Will be sent to sheet-logger as "user":', 'anonymous', '(no user info)');
  return 'anonymous';
}

/**
 * Set stored first name (e.g. after profile load or admin override).
 * @param {string} firstName
 */
export function setStoredFirstName(firstName) {
  try {
    if (firstName != null && String(firstName).trim()) {
      localStorage.setItem(STORAGE_KEY, String(firstName).trim());
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}
