/**
 * Minimal mock of scripts/aem.js for unit tests.
 *
 * The real module performs RUM bootstrapping and DOM queries at import time,
 * which crashes outside a browser. add-to-cart.js only needs `getMetadata`
 * from this module; tests can override its return value per-case.
 */

let metadata = {};

export function __setMetadata(values) {
  metadata = { ...values };
}

export function __resetMetadata() {
  metadata = {};
}

export function getMetadata(name) {
  return metadata[name] ?? '';
}

// eslint-disable-next-line no-empty-function
export async function loadScript() {}
// eslint-disable-next-line no-empty-function
export async function loadCSS() {}
