/**
 * Shared address-field validation. Consumed by the checkout validation flow,
 * the auth/profile widget, and the account address forms so the accepted
 * formats stay in a single place. Currently covers postal/ZIP codes; other
 * address-field validators (e.g. phone numbers) will move here over time.
 */

// US ZIP: 5 digits, optional +4 extension
export const ZIP_US_RE = /^\d{5}(-\d{4})?$/;
// Canadian postal code (e.g. A1B 2C3); excludes letters Canada Post never uses
export const ZIP_CA_RE = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d$/i;

/**
 * Validates a US ZIP or Canadian postal code. US ZIPs additionally reject the
 * all-zeros placeholder (00000).
 *
 * @param {string} value - The raw postal/ZIP code to validate
 * @param {boolean} [isCanada] - Validate as a Canadian postal code instead of a US ZIP
 * @returns {boolean} Whether the value is valid for the selected country
 */
export function isValidPostalCode(value, isCanada = false) {
  const trimmed = String(value ?? '').trim();
  if (isCanada) return ZIP_CA_RE.test(trimmed);
  return ZIP_US_RE.test(trimmed) && trimmed.replace(/\D/g, '') !== '00000';
}
