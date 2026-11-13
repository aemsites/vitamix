import { getConfig } from './commerce-config.js';
import { getSimulatedDate, noteSimulatedAt, withSimulatedDate } from './simulate-date.js';

/**
 * Catalog promotion prices at a simulated date, applied the way product pages and the
 * product index render them. Only used while a date is simulated on non-prod hosts.
 */

const TIMEOUT_MS = 8000;

/**
 * @param {{ enabled?: boolean, start?: string, end?: string }} rule
 * @param {number} now epoch ms
 * @returns {boolean}
 */
export function isRuleActive(rule, now) {
  if (rule.enabled === false) return false;
  if (rule.start && new Date(rule.start).getTime() > now) return false;
  if (rule.end && new Date(rule.end).getTime() < now) return false;
  return true;
}

/**
 * Promotions without conditions: the ones that change catalog prices.
 * @param {Object} payload `GET /price-rules/catalog` response
 * @returns {Array<Object>}
 */
export function catalogPromotions(payload) {
  if (!Array.isArray(payload?.promotions)) return [];
  return payload.promotions.filter((promotion) => promotion && !promotion.conditions
    && Array.isArray(promotion.rules));
}

function variantList(product) {
  if (Array.isArray(product.variants)) return product.variants;
  return product.variants ? Object.values(product.variants) : [];
}

/** Product mode writes `price.final`; index mode writes the flat `price`. */
function applyRuleToProduct(product, rule, now, isIndex) {
  if (rule.price != null) {
    if (isIndex) {
      product.price = rule.price;
    } else if (product.price && parseFloat(rule.price) < parseFloat(product.price.final)) {
      product.price.final = rule.price;
    }
  }
  variantList(product).forEach((variant) => {
    const current = isIndex ? variant.price : variant.price?.final;
    const variantRule = rule.variants?.[variant.sku];
    let next = null;
    if (variantRule && isRuleActive(variantRule, now)) {
      if (variantRule.price != null && parseFloat(variantRule.price) < parseFloat(current)) {
        next = variantRule.price;
      }
    } else if (rule.price != null && parseFloat(rule.price) < parseFloat(current)) {
      next = rule.price;
    }
    if (next == null) return;
    if (isIndex) variant.price = next;
    else if (variant.price) variant.price.final = next;
  });
}

/** Lowest product-level price among the rules that lower the product or one of its variants. */
function findBestRule(promotions, path, now, product) {
  const currentPrice = parseFloat(product.price?.final ?? 'Infinity');
  const variantPrices = new Map();
  variantList(product).forEach((v) => {
    if (v.sku && v.price?.final != null) variantPrices.set(v.sku, parseFloat(v.price.final));
  });

  let best = null;
  let bestPrice = Infinity;
  promotions.forEach((promotion) => {
    promotion.rules.forEach((rule) => {
      if (rule.path !== path || !isRuleActive(rule, now)) return;
      const p = parseFloat(rule.price);
      const lowersProduct = !Number.isNaN(p) && p < currentPrice;
      const lowersVariant = Object.entries(rule.variants ?? {}).some(([sku, vr]) => {
        if (!isRuleActive(vr, now) || vr.price == null) return false;
        const current = variantPrices.get(sku);
        return current !== undefined && parseFloat(vr.price) < current;
      });
      if (!lowersProduct && !lowersVariant) return;
      const rulePrice = Number.isNaN(p) ? Infinity : p;
      if (!best || rulePrice < bestPrice) {
        bestPrice = rulePrice;
        best = rule;
      }
    });
  });
  return best;
}

function toNumber(value) {
  if (value == null || value === '') return NaN;
  return parseFloat(value);
}

function pathOf(url) {
  if (!url) return null;
  try {
    return new URL(url, 'https://example.com').pathname;
  } catch {
    return null;
  }
}

/**
 * Product index rows (parents and variants, flat) priced at `now`: each row starts from
 * `regularPrice`, then the lowest active rule for its product path applies.
 *
 * @param {Array<Object>} rows raw product index rows
 * @param {Array<Object>} promotions catalog promotions
 * @param {number} now epoch ms
 * @param {{ locale?: string, language?: string }} [options] builds paths from `urlKey`
 * @returns {Array<Object>} new rows; `price` changes, everything else is kept
 */
export function repriceIndexRows(rows, promotions, now, { locale, language } = {}) {
  if (!Array.isArray(rows)) return rows;
  const rules = catalogPromotions({ promotions });

  const bestRuleByPath = new Map();
  rules.forEach((promotion) => {
    promotion.rules.forEach((rule) => {
      if (!isRuleActive(rule, now)) return;
      const price = parseFloat(rule.price);
      if (Number.isNaN(price)) return;
      const current = bestRuleByPath.get(rule.path);
      if (!current || price < parseFloat(current.price)) bestRuleByPath.set(rule.path, rule);
    });
  });

  const out = rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const copy = { ...row };
    const regular = toNumber(row.regularPrice);
    if (!Number.isNaN(regular)) copy.price = row.regularPrice;
    return copy;
  });

  const parentBySku = new Map();
  const variantsByParent = new Map();
  out.forEach((row) => {
    if (!row?.sku) return;
    if (!row.parentSku) {
      parentBySku.set(row.sku, row);
    } else {
      if (!variantsByParent.has(row.parentSku)) variantsByParent.set(row.parentSku, []);
      variantsByParent.get(row.parentSku).push(row);
    }
  });

  const rowPath = (row) => {
    if (row.url) return pathOf(row.url);
    if (row.urlKey && locale && language) return `/${locale}/${language}/products/${row.urlKey}`;
    return null;
  };

  parentBySku.forEach((parent) => {
    const rule = bestRuleByPath.get(rowPath(parent));
    if (!rule) return;
    const productPrice = toNumber(parent.price);
    if (Number.isNaN(productPrice) || !(parseFloat(rule.price) < productPrice)) return;
    const variants = variantsByParent.get(parent.sku) || [];
    applyRuleToProduct({ price: parent.price, variants }, rule, now, true);
    parent.price = rule.price;
  });

  return out;
}

/**
 * A JSON-LD Product with its offers priced at `now`: each offer starts from its list
 * price (`priceSpecification.price`, else `price`), then the best active rule applies.
 * `priceSpecification` is only kept when the final price is below the list price.
 *
 * @param {Object} jsonLd schema.org Product
 * @param {Array<Object>} promotions catalog promotions
 * @param {number} now epoch ms
 * @param {string} [fallbackPath] product path when the JSON-LD has no `url`
 * @returns {Object} a new Product with new offers
 */
export function repriceJsonLd(jsonLd, promotions, now, fallbackPath) {
  if (!jsonLd || typeof jsonLd !== 'object' || !jsonLd.offers) return jsonLd;
  const single = !Array.isArray(jsonLd.offers);
  const offers = single ? [jsonLd.offers] : jsonLd.offers;
  const path = pathOf(jsonLd.url || jsonLd['@id']) || fallbackPath;
  if (!path) return jsonLd;

  const raws = offers.map((offer) => offer?.priceSpecification?.price ?? offer?.price);
  const bases = raws.map(toNumber);
  const priced = offers.map((offer, i) => (offer && !Number.isNaN(bases[i])
    ? { sku: offer.sku, price: { final: raws[i] } } : null));
  const variants = priced.filter(Boolean);
  const isSimple = offers.length === 1 && offers[0]?.sku === jsonLd.sku;
  // Configurable products don't expose the parent price; their lowest offer stands in.
  const product = isSimple
    ? { price: priced[0] ? priced[0].price : undefined, variants: [] }
    : {
      price: variants.length
        ? { final: Math.min(...variants.map((v) => parseFloat(v.price.final))) } : undefined,
      variants,
    };

  const rule = findBestRule(catalogPromotions({ promotions }), path, now, product);
  if (rule) applyRuleToProduct(product, rule, now, false);

  const newOffers = offers.map((offer, i) => {
    if (!priced[i]) return offer;
    const regular = bases[i];
    const final = parseFloat(priced[i].price.final);
    const next = { ...offer, price: String(priced[i].price.final) };
    delete next.priceSpecification;
    if (offer.priceCurrency && regular && final && final < regular) {
      next.priceSpecification = {
        '@type': 'UnitPriceSpecification',
        priceType: 'https://schema.org/ListPrice',
        price: regular,
        priceCurrency: offer.priceCurrency,
      };
    }
    return next;
  });

  return { ...jsonLd, offers: single ? newOffers[0] : newOffers };
}

let loaded = null;

/**
 * Catalog promotions active at the simulated date, once per page and date.
 * `null` when not simulating, on failure, or when the API didn't apply the date.
 *
 * @returns {Promise<{ promotions: Array<Object>, now: number }|null>}
 */
export async function loadSimulatedPromotions() {
  const date = getSimulatedDate();
  if (!date) return null;
  const key = date.toISOString();
  if (loaded?.key === key) return loaded.promise;
  const entry = { key };
  entry.promise = (async () => {
    try {
      const url = withSimulatedDate(`${getConfig().apiOrigin}/price-rules/catalog?active=true`);
      const signal = AbortSignal.timeout?.(TIMEOUT_MS);
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal });
      if (!res.ok) throw new Error(`price-rules ${res.status}`);
      const payload = await res.json();
      noteSimulatedAt(payload);
      if (typeof payload?.simulatedAt !== 'string') return null;
      const now = new Date(payload.simulatedAt).getTime();
      if (Number.isNaN(now)) return null;
      return { promotions: catalogPromotions(payload), now };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Simulated prices unavailable', e);
      if (loaded === entry) loaded = null;
      return null;
    }
  })();
  loaded = entry;
  return entry.promise;
}

/**
 * Product index rows priced at the simulated date; the same array when not simulating.
 * @param {Array<Object>} rows
 * @param {string} locale
 * @param {string} language
 * @returns {Promise<Array<Object>>}
 */
export async function simulatedIndexRows(rows, locale, language) {
  if (!getSimulatedDate()) return rows;
  const rules = await loadSimulatedPromotions();
  if (!rules) return rows;
  try {
    return repriceIndexRows(rows, rules.promotions, rules.now, { locale, language });
  } catch {
    return rows;
  }
}

/**
 * A JSON-LD Product priced at the simulated date; the same object when not simulating.
 * @param {Object} jsonLd
 * @param {string} [fallbackPath]
 * @returns {Promise<Object>}
 */
export async function simulatedJsonLd(jsonLd, fallbackPath) {
  if (!jsonLd || !getSimulatedDate()) return jsonLd;
  const rules = await loadSimulatedPromotions();
  if (!rules) return jsonLd;
  try {
    return repriceJsonLd(jsonLd, rules.promotions, rules.now, fallbackPath);
  } catch {
    return jsonLd;
  }
}

/**
 * Rewrites the page's Product JSON-LD with simulated prices, before the PDP reads it.
 * @param {Document} doc
 */
export async function repriceJsonLdScript(doc = document) {
  if (!getSimulatedDate()) return;
  const script = doc.head?.querySelector('script[type="application/ld+json"]');
  if (!script) return;
  let jsonLd;
  try {
    jsonLd = JSON.parse(script.textContent);
  } catch {
    return;
  }
  const next = await simulatedJsonLd(jsonLd, window.location?.pathname);
  if (next !== jsonLd) script.textContent = JSON.stringify(next);
}
