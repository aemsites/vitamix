/**
 * Gift-with-purchase (GWP) reconciliation.
 *
 * Keeps free-gift cart lines in sync with the active catalog promotions whose
 * `conditions.minimumSubtotal` is satisfied by the current cart. Lines are
 * marked with `custom.giftWithPurchase: true` and `custom.promotionId`, which
 * also disambiguates removal so a paid copy of the same SKU is never touched.
 *
 * Triggers (wired by `initGWP` and by the cart/checkout blocks):
 *   - `loadLazy` if the cart already has items (restored from localStorage)
 *   - Every `cart:change` event (refetches only on `add`)
 *   - Decoration of the cart and checkout blocks
 *
 * Non-prod overrides (ignored on prod hosts):
 *   - `localStorage['vitamix.priceRulesUrl']` — override endpoint
 *   - `localStorage['vitamix.priceRules.stub']` — JSON payload, bypasses fetch
 *   - `localStorage['vitamix.now']`            — ISO datetime for time-travel
 */

import cart from './cart.js';
import { getConfig } from './commerce-config.js';

// Inlined to avoid an import cycle (auth-api -> recaptcha -> scripts -> here).
const AUTH_TOKEN_SESSION_KEY = 'auth_token';

const CACHE_KEY = 'vitamix.priceRules.v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const STUB_KEY = 'vitamix.priceRules.stub';
const NOW_KEY = 'vitamix.now';
const ENDPOINT_OVERRIDE_KEY = 'vitamix.priceRulesUrl';

/** Mirrors the prod-host check in commerce-config.js. */
function isNonProdHost() {
  const { hostname } = window.location;
  return hostname.endsWith('.aem.page')
    || hostname.endsWith('.aem.live')
    || hostname.endsWith('.aem.network')
    || hostname === 'localhost'
    || hostname.startsWith('127.')
    || hostname.startsWith('integration.')
    || hostname.startsWith('uat.');
}

function readLocalStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** Effective "now" — honours the non-prod time-travel override. */
function getNow() {
  if (isNonProdHost()) {
    const raw = readLocalStorage(NOW_KEY);
    if (raw) {
      const d = new Date(raw);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return new Date();
}

function getEndpoint() {
  if (isNonProdHost()) {
    const override = readLocalStorage(ENDPOINT_OVERRIDE_KEY);
    if (override) return override;
  }
  return `${getConfig().apiOrigin}/price-rules/catalog?active=true`;
}

function getStub() {
  if (!isNonProdHost()) return null;
  const raw = readLocalStorage(STUB_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function readSessionCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.fetchedAt !== 'number' || !parsed.payload) return null;
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSessionCache(entry) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // sessionStorage may be unavailable in private modes — caching is best-effort.
  }
}

let inMemoryCache = null;
let inflight = null;

/**
 * Load the catalog-rules payload, memoised in-memory and persisted to
 * sessionStorage for up to 24h. Returns `null` on failure — callers must
 * tolerate a missing payload (no GWP, cart remains usable).
 *
 * @returns {Promise<{ payload: object, productsByPath: object } | null>}
 */
export async function ensurePriceRulesLoaded() {
  const stub = getStub();
  if (stub) {
    inMemoryCache = {
      payload: stub,
      productsByPath: inMemoryCache?.productsByPath || {},
    };
    return inMemoryCache;
  }
  if (inMemoryCache) return inMemoryCache;

  const cached = readSessionCache();
  if (cached) {
    inMemoryCache = { payload: cached.payload, productsByPath: cached.productsByPath || {} };
    return inMemoryCache;
  }

  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const headers = { Accept: 'application/json' };
      let token = null;
      try { token = sessionStorage.getItem(AUTH_TOKEN_SESSION_KEY); } catch { /* noop */ }
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(getEndpoint(), { method: 'GET', headers });
      if (!res.ok) throw new Error(`price-rules ${res.status}`);
      const payload = await res.json();
      const entry = { fetchedAt: Date.now(), payload, productsByPath: {} };
      writeSessionCache(entry);
      inMemoryCache = { payload, productsByPath: entry.productsByPath };
      return inMemoryCache;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[GWP] price-rules load failed', e);
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function promotionAppliesToLocale(promotion, locale) {
  if (Array.isArray(promotion.countries)) {
    return promotion.countries.map((c) => String(c).toLowerCase()).includes(locale);
  }
  if (typeof promotion.country === 'string') {
    return promotion.country.toLowerCase() === locale;
  }
  return false;
}

function ruleIsActive(rule, now) {
  const t = now.getTime();
  const startOk = !rule.start || new Date(rule.start).getTime() <= t;
  const endOk = !rule.end || new Date(rule.end).getTime() > t;
  return startOk && endOk;
}

/**
 * Returns the set of GWP rules that should currently be applied, keyed by
 * `${promotionId}::${rule.path}`. Each value is `{ promotion, rule }`.
 */
function computeApplicableRules(payload, currentCart) {
  const locale = getConfig().getLocale();
  const now = getNow();

  // Subtract any existing GWP value from the comparison subtotal. Defensive —
  // GWP prices are usually "0" so this is normally a no-op, but the rule
  // contract doesn't strictly require it.
  const subtotalSansGifts = currentCart.items.reduce((acc, item) => {
    if (item.custom?.giftWithPurchase) return acc;
    return acc + (item.quantity * parseFloat(item.price || 0));
  }, 0);

  const applicable = new Map();
  const promotions = Array.isArray(payload?.promotions) ? payload.promotions : [];
  promotions.forEach((promotion) => {
    if (!promotion.conditions || promotion.conditions.minimumSubtotal == null) return;
    if (!promotionAppliesToLocale(promotion, locale)) return;
    if (subtotalSansGifts < parseFloat(promotion.conditions.minimumSubtotal)) return;
    const rules = Array.isArray(promotion.rules) ? promotion.rules : [];
    rules.forEach((rule) => {
      if (!ruleIsActive(rule, now)) return;
      if (!rule.path) return;
      applicable.set(`${promotion.id}::${rule.path}`, { promotion, rule });
    });
  });
  return applicable;
}

function extractProductFromJsonLd(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const ldScripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
  let product = null;
  ldScripts.some((s) => {
    let parsed;
    try { parsed = JSON.parse(s.textContent); } catch { return false; }
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    const flattened = candidates.flatMap(
      (c) => (Array.isArray(c?.['@graph']) ? c['@graph'] : [c]),
    );
    product = flattened.find((n) => n && (n['@type'] === 'Product'
      || (Array.isArray(n['@type']) && n['@type'].includes('Product'))));
    return !!product;
  });
  return product;
}

/**
 * Fetches a product page and extracts the fields we need from its JSON-LD
 * Product node. Memoised inside `inMemoryCache.productsByPath` and persisted
 * to sessionStorage alongside the rules payload.
 *
 * @param {string} path
 * @returns {Promise<{ sku, name, image, url } | null>}
 */
async function resolveProductByPath(path) {
  if (!inMemoryCache) return null;
  if (inMemoryCache.productsByPath[path]) return inMemoryCache.productsByPath[path];
  try {
    const res = await fetch(path, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`product page ${res.status}`);
    const html = await res.text();
    const product = extractProductFromJsonLd(html);
    if (!product || !product.sku) throw new Error('no Product JSON-LD');
    const image = Array.isArray(product.image) ? product.image[0] : product.image;
    const resolved = {
      sku: String(product.sku),
      name: product.name || '',
      image: image || '',
      url: path,
    };
    inMemoryCache.productsByPath[path] = resolved;
    // Persist the enriched map so revisits don't re-fetch.
    const sessionEntry = readSessionCache();
    if (sessionEntry) {
      sessionEntry.productsByPath = inMemoryCache.productsByPath;
      writeSessionCache(sessionEntry);
    }
    return resolved;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[GWP] resolveProductByPath(${path}) failed`, e);
    return null;
  }
}

let isApplyingGWP = false;

function removeStaleGifts(applicable) {
  const stale = cart.items.filter((item) => {
    if (!item.custom?.giftWithPurchase) return false;
    const key = `${item.custom?.promotionId}::${item.path}`;
    return !applicable.has(key);
  });
  stale.forEach((item) => {
    const { promotionId } = item.custom;
    cart.removeItem(
      item.sku,
      (candidate) => candidate.custom?.giftWithPurchase
        && candidate.custom?.promotionId === promotionId
        && candidate.path === item.path,
    );
  });
}

async function addOneGift(promotion, rule) {
  const product = await resolveProductByPath(rule.path);
  if (!product) return;
  cart.addItem(
    {
      sku: product.sku,
      name: product.name,
      image: product.image,
      url: product.url,
      path: rule.path,
      price: String(rule.price ?? '0'),
      quantity: 1,
      custom: {
        giftWithPurchase: true,
        promotionId: promotion.id,
        ...(rule.custom?.regularPrice ? { regularPrice: rule.custom.regularPrice } : {}),
      },
    },
    { allowSeparateEntry: true },
  );
}

function addMissingGifts(applicable) {
  // Sequential chain — addItem is sync but resolveProductByPath is async; a
  // parallel Promise.all would race on inMemoryCache.productsByPath.
  return Array.from(applicable.entries()).reduce(
    (prev, [key, { promotion, rule }]) => prev.then(() => {
      const alreadyPresent = cart.items.some((item) => item.custom?.giftWithPurchase
        && `${item.custom?.promotionId}::${item.path}` === key);
      if (alreadyPresent) return undefined;
      return addOneGift(promotion, rule);
    }),
    Promise.resolve(),
  );
}

/**
 * Reconcile the cart against the currently-cached rules. Adds gift lines that
 * should be present and removes ones that no longer qualify. Safe to call
 * without rules loaded — does nothing in that case.
 *
 * @returns {Promise<void>}
 */
export async function evaluateGWP() {
  if (isApplyingGWP) return;
  if (!inMemoryCache?.payload) return;
  const applicable = computeApplicableRules(inMemoryCache.payload, cart);

  isApplyingGWP = true;
  try {
    removeStaleGifts(applicable);
    await addMissingGifts(applicable);
  } finally {
    isApplyingGWP = false;
  }
}

let initialised = false;

/**
 * Wire GWP triggers. Idempotent — safe to call from multiple entry points.
 */
export function initGWP() {
  if (initialised) return;
  initialised = true;

  // Trigger on every cart mutation. Only `add` and `restore` refresh the
  // rules cache (the rule set itself doesn't change as items get edited);
  // every action re-evaluates so qty changes can apply/unapply gifts.
  document.addEventListener('cart:change', async (event) => {
    if (isApplyingGWP) return;
    const action = event.detail?.action;
    if (action === 'add' || action === 'restore') {
      await ensurePriceRulesLoaded();
    }
    if (!inMemoryCache?.payload) return;
    evaluateGWP();
  });

  // Initial pass if the cart was restored with items already in it.
  if (cart.itemCount > 0) {
    ensurePriceRulesLoaded().then(() => evaluateGWP());
  }
}
