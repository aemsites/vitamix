/**
 * User label for Commerce Admin (e.g. first name on review / sheet-logger events).
 * Uses browser localStorage only. Call setStoredFirstName() from a future settings flow,
 * or set key `pim_userFirstName` manually for development.
 */

const STORAGE_KEY = 'pim_userFirstName';

/**
 * Same source as {@link getFirstName} but synchronous (for first paint / header).
 * @returns {string} trimmed first name or empty string if unset
 */
export function getStoredFirstNameSync() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored.trim()) {
      return stored.trim();
    }
  } catch {
    // ignore
  }
  return '';
}

/**
 * @returns {Promise<string>} Stored first name, or "anonymous" if unset
 */
export async function getFirstName() {
  const sync = getStoredFirstNameSync();
  if (sync) return sync;
  return 'anonymous';
}

/**
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
