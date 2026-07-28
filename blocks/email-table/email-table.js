/**
 * Email-only block. helix-to-email fetches `.plain.html` (pre-decoration) and
 * inlines the matching CSS, so this decorator does not run during email
 * rendering. Kept as a no-op to satisfy the EDS block convention and to avoid
 * a 404 when the page is previewed in a browser.
 *
 * @param {HTMLElement} block
 */
// eslint-disable-next-line no-unused-vars
export default function decorate(block) {}
