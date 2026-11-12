/**
 * Gift-with-purchase (GWP) reconciliation.
 *
 * Keeps free-gift cart lines in sync with the active conditional catalog
 * promotions whose `conditions` the current cart meets. The cart is evaluated
 * here first; the server's answer for the same paid lines then wins. Lines are
 * marked with `custom.giftWithPurchase: true`, `custom.promotionId` and
 * `custom.promotionName`. The promotion id also disambiguates removal so a paid
 * copy of the same SKU is never touched.
 *
 * Gifts never apply to commercial orders: a cart with any line flagged
 * `custom.isCommercial` (the same signal the EBS sync uses to set the
 * "Commercial" order type) gets no gifts, and any gift already in it is removed.
 *
 * Triggers (wired by `initGWP` and by the cart/checkout blocks):
 *   - `loadLazy` if the cart already has items (restored from localStorage)
 *   - Every `cart:change` event (refetches only on `add`)
 *   - Decoration of the cart and checkout blocks
 *   - Order previews (`ensureGWPReconciled`)
 *
 * Non-prod overrides (ignored on prod hosts):
 *   - `localStorage['vitamix.priceRulesUrl']` — override endpoint
 *   - `localStorage['vitamix.priceRules.stub']` — JSON payload, bypasses fetch
 *     and the server check (unless the payload sets `serverCheck: true`)
 *   - a simulated date (`simulate-date.js`) — time travel, also sent to the API
 */

import cart from './cart.js';
import { getConfig } from './commerce-config.js';
import { getSimulatedDate, noteSimulatedAt, withSimulatedDate } from './simulate-date.js';

// Inlined to avoid an import cycle (auth-api -> recaptcha -> scripts -> here).
const AUTH_TOKEN_SESSION_KEY = 'auth_token';

const CACHE_KEY = 'vitamix.priceRules.v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const STUB_KEY = 'vitamix.priceRules.stub';
const ENDPOINT_OVERRIDE_KEY = 'vitamix.priceRulesUrl';
const FETCH_TIMEOUT_MS = 5000;
const PREVIEW_SYNC_TIMEOUT_MS = 6000;

/** `fetch` options that abort after FETCH_TIMEOUT_MS where supported. */
function withTimeout(init = {}) {
  return typeof AbortSignal?.timeout === 'function'
    ? { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    : init;
}

/** Mirrors the prod-host check in commerce-config.js. */
function isNonProdHost() {
  const { hostname } = window.location;
  return hostname !== 'www.vitamix.com' && hostname !== 'vitamix.com';
}

function readLocalStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** Effective "now" — honours the non-prod simulated date. */
function getNow() {
  return getSimulatedDate() || new Date();
}

/** Identifies the clock that rules and server answers were loaded for. */
function clockKey() {
  return getSimulatedDate()?.toISOString() || null;
}

function getEndpoint() {
  if (isNonProdHost()) {
    const override = readLocalStorage(ENDPOINT_OVERRIDE_KEY);
    if (override) return override;
  }
  return withSimulatedDate(`${getConfig().apiOrigin}/price-rules/catalog?active=true`);
}

let lastStub = null;

function getStub() {
  if (!isNonProdHost()) return null;
  const raw = readLocalStorage(STUB_KEY);
  if (!raw) return null;
  if (lastStub?.raw === raw) return lastStub.payload;
  try {
    lastStub = { raw, payload: JSON.parse(raw) };
    return lastStub.payload;
  } catch { return null; }
}

function readSessionCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.fetchedAt !== 'number' || !parsed.payload) return null;
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    if ((parsed.clock || null) !== clockKey()) return null;
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
  const clock = clockKey();
  if (inMemoryCache && inMemoryCache.clock === clock) return inMemoryCache;

  const cached = readSessionCache();
  if (cached) {
    inMemoryCache = {
      payload: cached.payload, productsByPath: cached.productsByPath || {}, clock,
    };
    return inMemoryCache;
  }

  if (inflight?.clock === clock) return inflight.promise;
  const entry = { clock };
  entry.promise = (async () => {
    try {
      const headers = { Accept: 'application/json' };
      let token = null;
      try { token = sessionStorage.getItem(AUTH_TOKEN_SESSION_KEY); } catch { /* noop */ }
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(getEndpoint(), withTimeout({ method: 'GET', headers }));
      if (!res.ok) throw new Error(`price-rules ${res.status}`);
      const payload = await res.json();
      noteSimulatedAt(payload);
      const loaded = {
        fetchedAt: Date.now(), payload, productsByPath: {}, ...(clock ? { clock } : {}),
      };
      writeSessionCache(loaded);
      inMemoryCache = { payload, productsByPath: loaded.productsByPath, clock };
      return inMemoryCache;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[GWP] price-rules load failed', e);
      return null;
    } finally {
      if (inflight === entry) inflight = null;
    }
  })();
  inflight = entry;
  return entry.promise;
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
  if (rule.enabled === false) return false;
  const t = now.getTime();
  const startOk = !rule.start || new Date(rule.start).getTime() <= t;
  // The end is inclusive.
  const endOk = !rule.end || new Date(rule.end).getTime() >= t;
  return startOk && endOk;
}

const asList = (value) => (Array.isArray(value) ? value : []);

function itemPath(item) {
  if (item.path) return item.path;
  try { return new URL(item.url, window.location.origin).pathname; } catch { return ''; }
}

function isPaidLine(item) {
  return !item.custom?.giftWithPurchase && parseFloat(item.price) > 0 && item.quantity > 0;
}

function matchesProduct(item, entries) {
  const path = itemPath(item);
  return asList(entries).some((entry) => {
    const condition = typeof entry === 'string' ? { path: entry } : entry;
    return condition?.path === path && (condition.sku == null || condition.sku === item.sku);
  });
}

/** Category url_keys of a product, or `null` without `categories` or `custom`. */
function getCategoryKeys(product) {
  const hasCustom = !!product?.custom && typeof product.custom === 'object';
  if (!Array.isArray(product?.categories) && !hasCustom) return null;
  const keys = new Set();
  [...asList(product?.categories), ...asList(product?.custom?.categories)].forEach((entry) => {
    const key = typeof entry === 'string' ? entry : entry?.url_key;
    if (typeof key === 'string' && key) keys.add(key);
  });
  return [...keys];
}

/** Known category url_keys of a cart line, or `null` when unknown. */
function lineCategories(item) {
  if (Array.isArray(item.local?.categories)) return item.local.categories;
  const cached = inMemoryCache?.productsByPath?.[itemPath(item)]?.categories;
  return Array.isArray(cached) ? cached : null;
}

function isLineInScope(conditions, item, categories) {
  if (matchesProduct(item, conditions.excludedProducts)) return false;
  if (matchesProduct(item, conditions.includedProducts)) return true;
  const included = asList(conditions.includedCategories);
  const excluded = asList(conditions.excludedCategories);
  if (included.length || excluded.length) {
    if (!categories) return false;
    if (excluded.some((c) => categories.includes(c))) return false;
    if (included.some((c) => categories.includes(c))) return true;
  }
  return !(asList(conditions.includedProducts).length || included.length);
}

function isDisqualified(conditions, paidLines, getCategories) {
  const categories = asList(conditions.disqualifyingCategories);
  return paidLines.some((item) => {
    if (matchesProduct(item, conditions.disqualifyingProducts)) return true;
    if (!categories.length) return false;
    const keys = getCategories(item);
    return !keys || categories.some((c) => keys.includes(c));
  });
}

const KNOWN_CONDITIONS = new Set([
  'minimumSubtotal',
  'includedProducts',
  'excludedProducts',
  'includedCategories',
  'excludedCategories',
  'disqualifyingProducts',
  'disqualifyingCategories',
]);
const CATEGORY_CONDITIONS = ['includedCategories', 'excludedCategories', 'disqualifyingCategories'];

/**
 * Whether a promotion's `conditions` are met by the cart lines.
 *
 * @param {Object} conditions
 * @param {Object[]} items cart items
 * @param {(item: Object) => string[]|null} [getCategories]
 * @returns {boolean}
 */
export function conditionsMet(conditions, items, getCategories = lineCategories) {
  if (!conditions || typeof conditions !== 'object') return false;
  if (Object.keys(conditions).some((key) => !KNOWN_CONDITIONS.has(key))) return false;
  const paidLines = items.filter(isPaidLine);
  if (isDisqualified(conditions, paidLines, getCategories)) return false;
  const inScope = paidLines.filter((item) => isLineInScope(conditions, item, getCategories(item)));
  if (!inScope.length) return false;
  const subtotal = inScope.reduce((acc, item) => acc + item.quantity * parseFloat(item.price), 0);
  const minimum = parseFloat(conditions.minimumSubtotal);
  return Math.round(subtotal * 100) / 100 >= (Number.isFinite(minimum) ? minimum : 0);
}

/** Conditional promotions for this locale with at least one active rule. */
function getActivePromotions(payload, now) {
  const locale = getConfig().getLocale();
  return asList(payload?.promotions).filter((promotion) => promotion?.conditions
    && promotionAppliesToLocale(promotion, locale)
    && asList(promotion.rules).some((rule) => rule?.path && ruleIsActive(rule, now)));
}

/**
 * Whether the cart is a commercial order. Mirrors the EBS sync, which sets the
 * "Commercial" order type when any item carries `custom.isCommercial === true`.
 *
 * @param {{ items: Array }} currentCart
 * @returns {boolean}
 */
function isCommercialCart(currentCart) {
  return currentCart.items.some((item) => item.custom?.isCommercial === true);
}

/**
 * Returns the set of GWP rules that should currently be applied, keyed by
 * `${promotionId}::${rule.path}`. Each value is `{ promotion, rule }`.
 */
function computeApplicableRules(promotions, items, now) {
  const applicable = new Map();
  promotions.forEach((promotion) => {
    if (!conditionsMet(promotion.conditions, items)) return;
    promotion.rules.forEach((rule) => {
      if (!rule?.path || !ruleIsActive(rule, now)) return;
      applicable.set(`${promotion.id}::${rule.path}`, { promotion, rule });
    });
  });
  return applicable;
}

/** Same shape as computeApplicableRules, from the server's `freeItems`. */
function applicableFromGrants(promotions, grants, now) {
  const applicable = new Map();
  grants.forEach(({ ruleId, path }) => {
    const promotion = promotions.find((p) => p.id === ruleId);
    const rule = asList(promotion?.rules).find((r) => r?.path === path && ruleIsActive(r, now));
    if (rule) applicable.set(`${ruleId}::${path}`, { promotion, rule });
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

function persistProducts() {
  const sessionEntry = readSessionCache();
  if (!sessionEntry || !inMemoryCache) return;
  sessionEntry.productsByPath = inMemoryCache.productsByPath;
  writeSessionCache(sessionEntry);
}

function cacheProduct(path, data) {
  if (!inMemoryCache) return;
  inMemoryCache.productsByPath[path] = { ...inMemoryCache.productsByPath[path], ...data };
  persistProducts();
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
  const cached = inMemoryCache.productsByPath[path];
  if (cached?.sku) return cached;
  try {
    const res = await fetch(path, withTimeout({ credentials: 'same-origin' }));
    if (!res.ok) throw new Error(`product page ${res.status}`);
    const html = await res.text();
    const product = extractProductFromJsonLd(html);
    if (!product || !product.sku) throw new Error('no Product JSON-LD');
    const image = Array.isArray(product.image) ? product.image[0] : product.image;
    cacheProduct(path, {
      sku: String(product.sku),
      name: product.name || '',
      image: image || '',
      url: path,
    });
    return inMemoryCache.productsByPath[path];
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[GWP] resolveProductByPath(${path}) failed`, e);
    return null;
  }
}

async function fetchCategoryKeys(path) {
  try {
    const res = await fetch(`${path}.json`, withTimeout({ credentials: 'same-origin' }));
    if (res.ok) {
      const product = await res.json();
      if (product?.sku || product?.path) return getCategoryKeys(product);
    }
  } catch { /* fall back to the product page */ }
  try {
    const res = await fetch(path, withTimeout({ credentials: 'same-origin' }));
    if (!res.ok) return null;
    const product = extractProductFromJsonLd(await res.text());
    return product ? getCategoryKeys(product) : null;
  } catch {
    return null;
  }
}

const categoryLookups = new Map();

function resolveCategories(path) {
  if (!categoryLookups.has(path)) {
    categoryLookups.set(path, fetchCategoryKeys(path).then((categories) => {
      if (categories) cacheProduct(path, { categories });
      return categories;
    }));
  }
  return categoryLookups.get(path);
}

/** Loads categories for paid lines that don't carry them. */
async function ensureLineCategories(items) {
  const paths = new Set(items
    .filter((item) => isPaidLine(item) && !lineCategories(item))
    .map(itemPath)
    .filter(Boolean));
  await Promise.all([...paths].map(resolveCategories));
}

let isApplyingGWP = false;
// `cart:change` source for gift changes made while settling a preview.
let previewSyncs = 0;
const changeOptions = () => (previewSyncs ? { source: 'gwp-preview' } : {});

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
      changeOptions(),
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
        ...(promotion.name ? { promotionName: promotion.name } : {}),
        ...(rule.custom?.regularPrice ? { regularPrice: rule.custom.regularPrice } : {}),
      },
    },
    { allowSeparateEntry: true, ...changeOptions() },
  );
}

/** Keeps `custom.promotionName` current on gift lines already in the cart. */
function updateGiftPromotionNames(applicable) {
  cart.items.filter((item) => item.custom?.giftWithPurchase).forEach((item) => {
    const { promotionId } = item.custom;
    const name = applicable.get(`${promotionId}::${item.path}`)?.promotion.name;
    if (!name || item.custom.promotionName === name) return;
    cart.updateItemCustom(
      item.sku,
      (candidate) => candidate.custom?.giftWithPurchase
        && candidate.custom?.promotionId === promotionId
        && candidate.path === item.path,
      { promotionName: name },
      changeOptions(),
    );
  });
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

const RECONCILE_DELAY_MS = 500;

// Last server answer: `{ payload, signature, grants, at }`.
let serverResult = null;
let failedCheck = null;
let reconcileTimer = null;
let reconcileInflight = null;

/** Identifies the paid lines and the active promotion rules a server answer was for. */
function checkSignature(promotions, items, now) {
  return JSON.stringify([
    clockKey(),
    promotions.map((p) => [p.id, asList(p.rules)
      .filter((r) => r?.path && ruleIsActive(r, now)).map((r) => r.path)]),
    items.filter(isPaidLine)
      .map((item) => [itemPath(item), item.sku, item.quantity, String(item.price)]),
  ]);
}

function currentSignature(payload) {
  const now = getNow();
  return checkSignature(getActivePromotions(payload, now), cart.items, now);
}

function checkFailed(payload, signature) {
  return failedCheck?.payload === payload && failedCheck.signature === signature;
}

const SERVER_CACHE_KEY = 'vitamix.gwp.serverCheck';
const SERVER_CACHE_TTL_MS = 15 * 60 * 1000;
const payloadKeys = new WeakMap();

/** Short hash identifying a rules payload across page views. */
function payloadKey(payload) {
  if (!payloadKeys.has(payload)) {
    const text = JSON.stringify(payload);
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 2147483647;
    payloadKeys.set(payload, `${text.length}:${hash}`);
  }
  return payloadKeys.get(payload);
}

function storeServerResult(result) {
  serverResult = { ...result, at: Date.now() };
  try {
    sessionStorage.setItem(SERVER_CACHE_KEY, JSON.stringify({
      key: payloadKey(result.payload),
      signature: result.signature,
      grants: result.grants,
      at: serverResult.at,
    }));
  } catch { /* best-effort */ }
}

const isFresh = (at) => Date.now() - at < SERVER_CACHE_TTL_MS;

function serverResultFor(payload, signature) {
  if (serverResult?.payload === payload && serverResult.signature === signature
    && isFresh(serverResult.at)) {
    return serverResult;
  }
  try {
    const stored = JSON.parse(sessionStorage.getItem(SERVER_CACHE_KEY));
    if (stored?.signature === signature && stored.key === payloadKey(payload)
      && isFresh(stored.at) && Array.isArray(stored.grants)) {
      serverResult = {
        payload, signature, grants: stored.grants, at: stored.at,
      };
      return serverResult;
    }
  } catch { /* ignore */ }
  return null;
}

function needsServer(payload, promotions) {
  // The server doesn't know stub rules; a stub opts in with `serverCheck: true`.
  if (lastStub?.payload === payload && payload.serverCheck !== true) return false;
  return promotions.length > 0 && cart.items.some(isPaidLine) && !isCommercialCart(cart);
}

let evaluation = null;
let rerunEvaluation = false;

async function applyGifts(applicable) {
  isApplyingGWP = true;
  try {
    removeStaleGifts(applicable);
    updateGiftPromotionNames(applicable);
    await addMissingGifts(applicable);
  } finally {
    isApplyingGWP = false;
  }
}

async function applyOnce() {
  // Gifts never apply to commercial orders, with or without rules.
  if (isCommercialCart(cart)) {
    await applyGifts(new Map());
    return;
  }
  const payload = inMemoryCache?.payload;
  if (!payload) return;
  const now = getNow();
  const promotions = getActivePromotions(payload, now);
  if (promotions.some((p) => CATEGORY_CONDITIONS.some((k) => asList(p.conditions[k]).length))) {
    await ensureLineCategories(cart.items);
  }
  const signature = checkSignature(promotions, cart.items, now);
  const server = serverResultFor(payload, signature);
  const applicable = server
    ? applicableFromGrants(promotions, server.grants, now)
    : computeApplicableRules(promotions, cart.items, now);
  await applyGifts(applicable);

  if (!server && !checkFailed(payload, signature) && needsServer(payload, promotions)) {
    clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(() => {
      reconcileTimer = null;
      // eslint-disable-next-line no-use-before-define
      reconcileWithServer();
    }, RECONCILE_DELAY_MS);
  }
}

/**
 * Reconcile the cart against the currently-cached rules. Adds gift lines that
 * should be present and removes ones that no longer qualify. A server result
 * for the current paid lines wins over the client evaluation. Safe to call
 * without rules loaded — does nothing in that case, except that gifts are still
 * removed from a commercial cart, since that needs no rules.
 *
 * @returns {Promise<void>}
 */
export function evaluateGWP() {
  if (evaluation) {
    rerunEvaluation = true;
    return evaluation;
  }
  evaluation = (async () => {
    try {
      do {
        rerunEvaluation = false;
        // eslint-disable-next-line no-await-in-loop
        await applyOnce();
      } while (rerunEvaluation);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[GWP] evaluation failed', e);
    } finally {
      evaluation = null;
    }
  })();
  return evaluation;
}

/**
 * Asks the server which gifts the current paid lines qualify for and applies
 * the answer.
 *
 * @param {{ force?: boolean }} [opts] `force` ignores a cached answer
 * @returns {Promise<void>}
 */
export function reconcileWithServer({ force = false } = {}) {
  const payload = inMemoryCache?.payload;
  if (!payload || !needsServer(payload, getActivePromotions(payload, getNow()))) {
    return Promise.resolve();
  }
  const signature = currentSignature(payload);
  if (reconcileInflight?.payload === payload && reconcileInflight.signature === signature) {
    return reconcileInflight.promise;
  }
  if (!force && (serverResultFor(payload, signature) || checkFailed(payload, signature))) {
    return Promise.resolve();
  }
  const items = cart.getItemsForAPI().filter((_, i) => isPaidLine(cart.items[i]));
  const entry = { payload, signature };
  entry.promise = (async () => {
    try {
      // Direct fetch: importing commerce-api.js here would close an import cycle.
      const res = await fetch(withSimulatedDate(`${getConfig().apiOrigin}/estimate/price`), withTimeout({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ country: getConfig().getLocale(), items }),
      }));
      if (!res.ok) throw new Error(`estimate ${res.status}`);
      const result = await res.json();
      // The API omits `freeItems` when nothing is granted.
      if (!result || typeof result !== 'object'
        || (result.freeItems !== undefined && !Array.isArray(result.freeItems))) {
        throw new Error('unexpected estimate response');
      }
      noteSimulatedAt(result);
      const grants = asList(result.freeItems).filter((f) => f?.ruleId && f?.path);
      storeServerResult({ payload, signature, grants });
      failedCheck = null;
    } catch (e) {
      failedCheck = { payload, signature };
      // eslint-disable-next-line no-console
      console.warn('[GWP] server check failed', e);
      return;
    } finally {
      if (reconcileInflight === entry) reconcileInflight = null;
    }
    if (currentSignature(payload) === signature) await evaluateGWP();
  })();
  reconcileInflight = entry;
  return entry.promise;
}

async function settleGifts(force) {
  const loaded = await ensurePriceRulesLoaded();
  await evaluateGWP();
  if (!loaded?.payload) return;
  clearTimeout(reconcileTimer);
  reconcileTimer = null;
  if (!needsServer(loaded.payload, getActivePromotions(loaded.payload, getNow()))) return;
  // A check that failed earlier gets one more try before each preview.
  failedCheck = null;
  await reconcileWithServer({ force });
  await evaluateGWP();
}

/**
 * Settles gift lines for the current cart with the server before an order
 * preview. Never throws, and gives up after PREVIEW_SYNC_TIMEOUT_MS.
 *
 * @param {{ force?: boolean, timeoutMs?: number }} [opts] `force` re-asks the server
 * @returns {Promise<void>}
 */
export async function ensureGWPReconciled({
  force = false,
  timeoutMs = PREVIEW_SYNC_TIMEOUT_MS,
} = {}) {
  previewSyncs += 1;
  let timer;
  try {
    await Promise.race([
      settleGifts(force),
      new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
    ]);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[GWP] reconcile failed', e);
  } finally {
    clearTimeout(timer);
    previewSyncs -= 1;
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
    const action = event.detail?.action;
    // The tab that changed the cart already settled its gifts.
    if (isApplyingGWP || action === 'sync') return;
    if (action === 'add' || action === 'restore') {
      await ensurePriceRulesLoaded();
    }
    // evaluateGWP() is a no-op without rules, unless the cart is commercial.
    evaluateGWP();
  });

  // Initial pass if the cart was restored with items already in it.
  if (cart.itemCount > 0) {
    ensurePriceRulesLoaded().then(() => evaluateGWP());
  }
}
