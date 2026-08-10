/**
 * Pure helpers for editing the customer profile — shared by the post-login
 * profile step (auth panel) and the account Information editor. Kept free of DOM
 * and side-effecting imports so they can be unit-tested without loading a block
 * and its `scripts.js` bootstrap.
 */

/**
 * Whether the customer still needs the profile step. Completeness is gated on
 * first and last name only — ZIP lives on the address, and the survey fields
 * (plannedUse, ownsVitamix, terms) are optional extras that never block.
 *
 * @param {Record<string, unknown> | null | undefined} customer
 * @returns {boolean}
 */
export function isProfileIncomplete(customer) {
  return !customer || !customer.firstName || !customer.lastName;
}

/**
 * Builds the PATCH body for a profile-step save from the raw form field values.
 *
 * Flow:
 *   1. Trim the name fields.
 *   2. Collect the site-specific survey answers into a `custom` bag, including
 *      only the keys the customer actually provided.
 *   3. Stamp `termsAcceptedAt` with the supplied ISO time when terms were agreed.
 *   4. Omit `firstName`/`lastName`/`custom` when empty so a partial PATCH never
 *      clears an existing value.
 *
 * @param {{ firstName?: string, lastName?: string, phone?: string, plannedUse?: string,
 *   ownsVitamix?: string, termsAccepted?: boolean }} fields
 * @param {string} [nowIso] - ISO timestamp recorded when terms are accepted
 * @returns {{ firstName?: string, lastName?: string, phone?: string,
 *   custom?: Record<string, string> }}
 */
export function buildProfileUpdate(fields, nowIso = new Date().toISOString()) {
  const firstName = (fields.firstName || '').trim();
  const lastName = (fields.lastName || '').trim();
  const phone = fields.phone === undefined ? undefined : (fields.phone || '').trim();

  /** @type {Record<string, string>} */
  const custom = {};
  if (fields.plannedUse) custom.plannedUse = fields.plannedUse;
  if (fields.ownsVitamix) custom.ownsVitamix = fields.ownsVitamix;
  if (fields.termsAccepted) custom.termsAcceptedAt = nowIso;

  /** @type {{ firstName?: string, lastName?: string, phone?: string,
   *   custom?: Record<string, string> }} */
  const body = {};
  if (firstName) body.firstName = firstName;
  if (lastName) body.lastName = lastName;
  // phone is only included when the caller passed the field at all, so the
  // profile step (which omits it) never touches phone, while the account editor
  // can set or clear it.
  if (phone !== undefined) body.phone = phone;
  if (Object.keys(custom).length) body.custom = custom;
  return body;
}
