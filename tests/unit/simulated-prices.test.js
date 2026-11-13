/**
 * Unit tests for scripts/simulated-prices.js: catalog promotion prices at a simulated date.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  isRuleActive, repriceIndexRows, repriceJsonLd, repriceProduct, simulatedIndexRows,
  simulatedJsonLd, simulatedProduct, loadSimulatedPromotions, repriceJsonLdScript,
  resetSimulatedPromotions,
} from '../../scripts/simulated-prices.js';
import { fetchProductIndex } from '../../scripts/plp-data.js';
import { lookupProducts } from '../../blocks/plp/plp.js';

const T = Date.parse('2030-06-15T12:00:00.000Z');
const PATH = '/us/en_us/products/blender';
const URL_ = `https://www.example.com${PATH}`;

const promo = (rules, extra = {}) => ({ id: `p${Math.random()}`, name: 'promo', rules, ...extra });

/** The real getOfferPricing from scripts.js (which can't be imported in Node). */
const getOfferPricing = (() => {
  const source = readFileSync(new URL('../../scripts/scripts.js', import.meta.url), 'utf8');
  const fn = source.match(/^export function getOfferPricing[\s\S]*?\n}\n/m)[0];
  return runInNewContext(`(${fn.replace(/^export /, '')})`);
})();

function simpleLd(price, { regular, sku = 'S1', custom } = {}) {
  const offer = {
    '@type': 'Offer', sku, priceCurrency: 'USD', price: String(price), url: URL_,
  };
  if (regular) {
    offer.priceSpecification = {
      '@type': 'UnitPriceSpecification',
      priceType: 'https://schema.org/ListPrice',
      price: regular,
      priceCurrency: 'USD',
    };
  }
  if (custom) offer.custom = custom;
  return {
    '@type': 'Product', sku, url: URL_, offers: [offer],
  };
}

function configurableLd(prices) {
  return {
    '@type': 'Product',
    sku: 'PARENT',
    url: URL_,
    offers: Object.entries(prices).map(([sku, price]) => ({
      '@type': 'Offer', sku, priceCurrency: 'USD', price: String(price), url: URL_,
    })),
  };
}

const offerPrices = (ld) => Object.fromEntries(ld.offers.map((o) => [o.sku, o.price]));

describe('isRuleActive', () => {
  test('start inclusive, end inclusive, disabled off', () => {
    const rule = { start: '2030-06-15T12:00:00.000Z', end: '2030-06-15T12:00:00.000Z' };
    assert.equal(isRuleActive(rule, T), true);
    assert.equal(isRuleActive(rule, T - 1), false);
    assert.equal(isRuleActive(rule, T + 1), false);
    assert.equal(isRuleActive({ enabled: false }, T), false);
    assert.equal(isRuleActive({}, T), true);
  });
});

describe('repriceJsonLd (product mode)', () => {
  test('parent only: simple product gets the rule price and a list price', () => {
    const ld = simpleLd(100);
    const out = repriceJsonLd(ld, [promo([{ path: PATH, price: '80.00' }])], T);
    assert.equal(out.offers[0].price, '80.00');
    assert.deepEqual(out.offers[0].priceSpecification, {
      '@type': 'UnitPriceSpecification',
      priceType: 'https://schema.org/ListPrice',
      price: 100,
      priceCurrency: 'USD',
    });
    assert.equal(ld.offers[0].price, '100', 'input not mutated');
    assert.notEqual(out, ld);
  });

  test('parent price applies to variants without an override', () => {
    const out = repriceJsonLd(configurableLd({ A: 100, B: 100 }), [promo([{ path: PATH, price: '80' }])], T);
    assert.deepEqual(offerPrices(out), { A: '80', B: '80' });
  });

  test('variant override lower than the parent wins for that SKU', () => {
    const rules = [promo([{ path: PATH, price: '80', variants: { A: { price: '70' } } }])];
    assert.deepEqual(offerPrices(repriceJsonLd(configurableLd({ A: 100, B: 100 }), rules, T)), { A: '70', B: '80' });
  });

  test('variant override higher than the parent rule beats it (regular price kept)', () => {
    const rules = [promo([{ path: PATH, price: '80', variants: { A: { price: '90' } } }])];
    assert.deepEqual(offerPrices(repriceJsonLd(configurableLd({ A: 100, B: 100 }), rules, T)), { A: '90', B: '80' });
  });

  test('variant override above the regular price leaves the regular price', () => {
    const rules = [promo([{ path: PATH, price: '80', variants: { A: { price: '120' } } }])];
    const out = repriceJsonLd(configurableLd({ A: 100, B: 100 }), rules, T);
    assert.deepEqual(offerPrices(out), { A: '100', B: '80' });
    assert.equal(out.offers[0].priceSpecification, undefined);
  });

  test('inactive variant override: the parent price applies', () => {
    const rules = [promo([{
      path: PATH, price: '80', variants: { A: { price: '70', start: '2030-07-01T00:00:00Z' } },
    }])];
    assert.deepEqual(offerPrices(repriceJsonLd(configurableLd({ A: 100, B: 100 }), rules, T)), { A: '80', B: '80' });
  });

  test('configurable: the lowest offer stands in for the parent price', () => {
    const rules = [promo([{ path: PATH, price: '150' }])];
    const out = repriceJsonLd(configurableLd({ A: 100, B: 200 }), rules, T);
    assert.deepEqual(offerPrices(out), { A: '100', B: '200' }, '150 is not below the lowest offer (100)');
    const lower = repriceJsonLd(configurableLd({ A: 100, B: 200 }), [promo([{ path: PATH, price: '90' }])], T);
    assert.deepEqual(offerPrices(lower), { A: '90', B: '90' });
  });

  test('variant-only rule qualifies', () => {
    const rules = [promo([{ path: PATH, price: '150', variants: { B: { price: '60' } } }])];
    assert.deepEqual(offerPrices(repriceJsonLd(configurableLd({ A: 100, B: 100 }), rules, T)), { A: '100', B: '60' });
  });

  test('overlapping promotions: the lowest wins', () => {
    const rules = [
      promo([{ path: PATH, price: '90' }]),
      promo([{ path: PATH, price: '75' }]),
      promo([{ path: PATH, price: '85' }]),
    ];
    assert.equal(repriceJsonLd(simpleLd(100), rules, T).offers[0].price, '75');
  });

  test('a rule above the base price changes nothing', () => {
    const out = repriceJsonLd(simpleLd(100), [promo([{ path: PATH, price: '120' }])], T);
    assert.equal(out.offers[0].price, '100');
    assert.equal(out.offers[0].priceSpecification, undefined);
  });

  test('start and end boundaries (end inclusive)', () => {
    const at = (start, end) => repriceJsonLd(simpleLd(100), [promo([{
      path: PATH, price: '80', start, end,
    }])], T).offers[0].price;
    assert.equal(at('2030-06-15T12:00:00.000Z', undefined), '80');
    assert.equal(at('2030-06-15T12:00:00.001Z', undefined), '100');
    assert.equal(at(undefined, '2030-06-15T12:00:00.000Z'), '80');
    assert.equal(at(undefined, '2030-06-15T11:59:59.999Z'), '100');
  });

  test('a disabled rule is ignored', () => {
    const out = repriceJsonLd(simpleLd(100), [promo([{ path: PATH, price: '80', enabled: false }])], T);
    assert.equal(out.offers[0].price, '100');
  });

  test('a conditional promotion is ignored', () => {
    const rules = [promo([{ path: PATH, price: '1' }], { conditions: { minSubtotal: '10' } })];
    assert.equal(repriceJsonLd(simpleLd(100), rules, T).offers[0].price, '100');
  });

  test('another product\'s rule is ignored', () => {
    const rules = [promo([{ path: `${PATH}-2`, price: '1' }])];
    assert.equal(repriceJsonLd(simpleLd(100), rules, T).offers[0].price, '100');
  });

  test('a promotion live today but not at T: back to the list price', () => {
    const out = repriceJsonLd(simpleLd(80, { regular: 100 }), [], T);
    assert.equal(out.offers[0].price, '100');
    assert.equal(out.offers[0].priceSpecification, undefined);
  });

  test('a promotion live today, another at T: priced from the list price', () => {
    const out = repriceJsonLd(simpleLd(80, { regular: 100 }), [promo([{ path: PATH, price: '90' }])], T);
    assert.equal(out.offers[0].price, '90');
    assert.equal(out.offers[0].priceSpecification.price, 100);
  });

  test('recon: originalPrice unchanged and still the "was" price', () => {
    const ld = simpleLd(300, { custom: { originalPrice: '500' } });
    const out = repriceJsonLd(ld, [promo([{ path: PATH, price: '250' }])], T);
    assert.equal(out.offers[0].price, '250');
    assert.deepEqual(out.offers[0].custom, { originalPrice: '500' });
    assert.deepEqual({ ...getOfferPricing(out.offers[0]) }, { final: 250, regular: 500 });
  });

  test('a single offer object stays an object', () => {
    const ld = simpleLd(100);
    [ld.offers] = ld.offers;
    const out = repriceJsonLd(ld, [promo([{ path: PATH, price: '80' }])], T);
    assert.equal(out.offers.price, '80');
  });

  test('uses the fallback path when the JSON-LD has no url', () => {
    const ld = simpleLd(100);
    delete ld.url;
    const out = repriceJsonLd(ld, [promo([{ path: PATH, price: '80' }])], T, PATH);
    assert.equal(out.offers[0].price, '80');
  });
});

describe('repriceProduct (product JSON)', () => {
  const product = (final = '100.00') => ({
    sku: 'P',
    path: PATH,
    price: { currency: 'USD', regular: '100.00', final },
    variants: [
      { sku: 'A', price: { currency: 'USD', regular: '100.00', final } },
      { sku: 'B', price: { currency: 'USD', regular: '100.00', final } },
    ],
  });
  const finals = (p) => [p.price.final, ...p.variants.map((v) => v.price.final)];

  test('parent rule and variant override', () => {
    const rules = [promo([{ path: PATH, price: '80', variants: { A: { price: '70' } } }])];
    const input = product();
    assert.deepEqual(finals(repriceProduct(input, rules, T)), ['80', '70', '80']);
    assert.deepEqual(finals(input), ['100.00', '100.00', '100.00'], 'input not mutated');
  });

  test('a promotion live today but not at T: back to the regular price', () => {
    const out = repriceProduct(product('80.00'), [promo([{ path: `${PATH}-2`, price: '1' }])], T);
    assert.deepEqual(finals(out), ['100.00', '100.00', '100.00']);
    assert.equal(out.price.regular, '100.00');
  });

  test('uses the fallback path when the product has no path', () => {
    const input = product();
    delete input.path;
    const out = repriceProduct(input, [promo([{ path: PATH, price: '80' }])], T, PATH);
    assert.equal(out.price.final, '80');
  });
});

describe('repriceIndexRows (index mode)', () => {
  const rows = () => [
    {
      sku: 'P', url: URL_, price: '100.00', regularPrice: '100.00', currency: 'USD',
    },
    {
      sku: 'A', parentSku: 'P', url: URL_, price: '100.00', regularPrice: '100.00',
    },
    {
      sku: 'B', parentSku: 'P', url: URL_, price: '100.00', regularPrice: '100.00',
    },
    {
      sku: 'O', urlKey: 'other', price: '50.00', regularPrice: '50.00',
    },
  ];
  const prices = (out) => Object.fromEntries(out.map((r) => [r.sku, r.price]));

  test('parent rule applies to parent and variants; override per SKU', () => {
    const rules = [promo([{ path: PATH, price: '80', variants: { A: { price: '70' } } }])];
    const input = rows();
    const out = repriceIndexRows(input, rules, T);
    assert.deepEqual(prices(out), {
      P: '80', A: '70', B: '80', O: '50.00',
    });
    assert.equal(out[0].regularPrice, '100.00');
    assert.equal(input[0].price, '100.00', 'input not mutated');
  });

  test('variant override higher than the parent beats it', () => {
    const rules = [promo([{ path: PATH, price: '80', variants: { A: { price: '90' } } }])];
    assert.deepEqual(prices(repriceIndexRows(rows(), rules, T)), {
      P: '80', A: '90', B: '80', O: '50.00',
    });
  });

  test('overlapping promotions: the lowest wins; urlKey paths match', () => {
    const rules = [
      promo([{ path: PATH, price: '90' }, { path: '/us/en_us/products/other', price: '40' }]),
      promo([{ path: PATH, price: '85' }]),
    ];
    const out = repriceIndexRows(rows(), rules, T, { locale: 'us', language: 'en_us' });
    assert.deepEqual(prices(out), {
      P: '85', A: '85', B: '85', O: '40',
    });
  });

  test('rules above base, inactive, disabled or conditional: regular prices', () => {
    const input = rows();
    input[0].price = '60.00';
    input[1].price = '60.00';
    const rules = [
      promo([{ path: PATH, price: '120' }]),
      promo([{ path: PATH, price: '10', end: '2030-06-15T11:00:00Z' }]),
      promo([{ path: PATH, price: '10', enabled: false }]),
      promo([{ path: PATH, price: '10' }], { conditions: {} }),
    ];
    assert.deepEqual(prices(repriceIndexRows(input, rules, T)), {
      P: '100.00', A: '100.00', B: '100.00', O: '50.00',
    });
  });

  test('recon row: originalPrice unchanged, price follows the rule', () => {
    const input = [{
      sku: 'R', url: URL_, price: '300', regularPrice: '300', originalPrice: '500',
    }];
    const [out] = repriceIndexRows(input, [promo([{ path: PATH, price: '250' }])], T);
    assert.equal(out.price, '250');
    assert.equal(out.originalPrice, '500');
    assert.equal(out.regularPrice, '300');
  });

  test('variant-only rule: not applied in index mode, as the pipeline renders it', () => {
    const rules = [promo([{ path: PATH, price: '150', variants: { A: { price: '60' } } }])];
    assert.deepEqual(prices(repriceIndexRows(rows(), rules, T)), {
      P: '100.00', A: '100.00', B: '100.00', O: '50.00',
    });
  });

  test('rows without regularPrice keep their price', () => {
    const [out] = repriceIndexRows([{ sku: 'X', url: URL_, price: '10' }], [], T);
    assert.equal(out.price, '10');
  });
});

function setLocation(hostname, pathname = PATH) {
  globalThis.location = {
    hostname, search: '', pathname, origin: `https://${hostname}`, href: `https://${hostname}${pathname}`,
  };
}

describe('loading at the simulated date', () => {
  let calls;
  let response;
  let failure;
  beforeEach(() => {
    globalThis.__resetTestState();
    resetSimulatedPromotions();
    delete window.productIndex;
    setLocation('main--site--org.aem.page');
    calls = [];
    response = null;
    failure = null;
    globalThis.__setFetchMock(async (url) => {
      calls.push(url);
      if (url.startsWith('https://api.test.com/')) {
        if (failure === 'reject') throw new Error('network');
        if (failure) return { ok: false, status: failure, json: async () => ({}) };
        return { ok: true, json: async () => response };
      }
      if (url.includes('index.json')) {
        return {
          ok: true,
          json: async () => ({
            data: [{
              sku: 'P', url: URL_, price: '100.00', regularPrice: '100.00',
            }],
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
  });

  test('not simulating: no fetch, same objects', async () => {
    const rows = [{ sku: 'P', url: URL_, price: '1' }];
    const ld = simpleLd(100);
    assert.equal(await simulatedIndexRows(rows, 'us', 'en_us'), rows);
    assert.equal(await simulatedJsonLd(ld), ld);
    assert.equal(await loadSimulatedPromotions(), null);
    assert.deepEqual(calls, []);
  });

  test('production host: no fetch even with a stored date', async () => {
    setLocation('www.vitamix.com');
    localStorage.setItem('vitamix.now', '2030-06-15T12:00:00.000Z');
    const ld = simpleLd(100);
    assert.equal(await simulatedJsonLd(ld), ld);
    await fetchProductIndex('us', 'en_us');
    assert.deepEqual(calls, ['/us/en_us/products/index.json?include=all']);
  });

  test('fetches active rules at the date once and reprices', async () => {
    localStorage.setItem('vitamix.now', '2030-06-15T12:00:00.000Z');
    response = {
      simulatedAt: '2030-06-15T12:00:00.000Z',
      promotions: [promo([{ path: PATH, price: '80' }])],
    };
    const out = await simulatedJsonLd(simpleLd(100));
    assert.equal(out.offers[0].price, '80');
    const rows = await simulatedIndexRows([{
      sku: 'P', url: URL_, price: '100', regularPrice: '100',
    }]);
    assert.equal(rows[0].price, '80');
    assert.deepEqual(calls, [
      'https://api.test.com/test-org/sites/test-site/price-rules/catalog?active=true&simulateDate=2030-06-15T12%3A00%3A00.000Z',
    ]);
  });

  test('a response without simulatedAt rewrites nothing', async () => {
    localStorage.setItem('vitamix.now', '2030-06-16T12:00:00.000Z');
    response = { promotions: [promo([{ path: PATH, price: '80' }])] };
    const ld = simpleLd(80, { regular: 100 });
    assert.equal(await simulatedJsonLd(ld), ld);
    const rows = [{ sku: 'P', url: URL_, price: '1' }];
    assert.equal(await simulatedIndexRows(rows), rows);
  });

  test('fetchProductIndex reprices product index rows while simulating', async () => {
    localStorage.setItem('vitamix.now', '2030-06-17T12:00:00.000Z');
    response = {
      simulatedAt: '2030-06-17T12:00:00.000Z',
      promotions: [promo([{ path: PATH, price: '70' }])],
    };
    const data = await fetchProductIndex('us', 'en_us');
    assert.equal(data[0].price, '70');
    assert.equal(data[0].regularPrice, '100.00');
  });

  test('simulatedProduct reprices related products\' JSON', async () => {
    const plain = { path: PATH, price: { regular: '100', final: '100' } };
    assert.equal(await simulatedProduct(plain), plain, 'not simulating: same object');
    localStorage.setItem('vitamix.now', '2030-06-19T12:00:00.000Z');
    response = {
      simulatedAt: '2030-06-19T12:00:00.000Z',
      promotions: [promo([{ path: PATH, price: '55' }])],
    };
    assert.equal((await simulatedProduct(plain)).price.final, '55');
  });

  test('a failed request rewrites nothing and is retried on the next call', async () => {
    localStorage.setItem('vitamix.now', '2030-06-15T12:00:00.000Z');
    const ld = simpleLd(100);
    const check = async (kind) => {
      calls.length = 0;
      failure = kind;
      assert.equal(await simulatedJsonLd(ld), ld, `${kind}: input unchanged`);
      failure = null;
      response = {
        simulatedAt: '2030-06-15T12:00:00.000Z',
        promotions: [promo([{ path: PATH, price: '80' }])],
      };
      assert.equal((await simulatedJsonLd(ld)).offers[0].price, '80', `${kind}: retried`);
      assert.equal(calls.length, 2);
      resetSimulatedPromotions();
    };
    await check(503);
    await check('reject');
  });

  test('blocks/plp lookupProducts reprices the index while simulating', async () => {
    localStorage.setItem('vitamix.now', '2030-06-15T12:00:00.000Z');
    response = {
      simulatedAt: '2030-06-15T12:00:00.000Z',
      promotions: [promo([{ path: PATH, price: '65' }])],
    };
    const [product] = await lookupProducts([PATH]);
    assert.equal(product.price, 65);
    assert.equal(product.regularPrice, 100);
    delete window.productIndex;
  });

  test('repriceJsonLdScript rewrites the head JSON-LD', async () => {
    localStorage.setItem('vitamix.now', '2030-06-18T12:00:00.000Z');
    response = {
      simulatedAt: '2030-06-18T12:00:00.000Z',
      promotions: [promo([{ path: PATH, price: '60' }])],
    };
    const script = { textContent: JSON.stringify(simpleLd(100)) };
    await repriceJsonLdScript({ head: { querySelector: () => script } });
    assert.equal(JSON.parse(script.textContent).offers[0].price, '60');
  });
});
