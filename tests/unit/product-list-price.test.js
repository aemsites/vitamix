import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

// Evaluate the real price renderer without the widget's browser bootstrap imports.
const widgetSource = readFileSync(new URL('../../widgets/product-list/product-list.js', import.meta.url), 'utf8');
const scriptsSource = readFileSync(new URL('../../scripts/scripts.js', import.meta.url), 'utf8');
const plpSource = readFileSync(new URL('../../scripts/plp-data.js', import.meta.url), 'utf8');

function functionSource(source, name) {
  const match = source.match(new RegExp(`^(?:export )?function ${name}\\([\\s\\S]*?\\n\\}`, 'm'));
  assert.ok(match, `expected ${name} in source`);
  return match[0].replace(/^export /, '');
}

function createElement(tagName) {
  return {
    tagName,
    children: [],
    append(...children) { this.children.push(...children); },
    textContent: '',
  };
}

const createProductPrice = runInNewContext(`
  ${functionSource(widgetSource, 'hasVariants')}
  ${functionSource(widgetSource, 'getVariantPrices')}
  ${functionSource(widgetSource, 'hasVaryingPrice')}
  ${functionSource(widgetSource, 'createProductPrice')}
  ${functionSource(scriptsSource, 'formatPrice')}
  ${functionSource(plpSource, 'hasVisiblePrice')}
  createProductPrice;
`, { document: { createElement } });

const placeholders = { languageCode: 'en_US', currencyCode: 'USD' };
const copy = { startingAt: 'Starting At' };

function render(product, ph = placeholders) {
  return createProductPrice(product, ph, copy);
}

function find(node, predicate) {
  if (typeof node !== 'object') return undefined;
  if (predicate(node)) return node;
  return node.children.map((child) => find(child, predicate)).find(Boolean);
}

function savingsBadge(price) {
  return find(price, (node) => node.className === 'product-badge product-badge-tier-alert save');
}

test('discounted PLP cards show savings beside the struck-through regular price', () => {
  const price = render({ price: 249.95, regularPrice: 399.95 });
  const amount = price.children[0];
  assert.equal(amount.textContent, '$249.95');
  assert.equal(amount.children[1].tagName, 'del');
  assert.equal(amount.children[1].textContent, '$399.95');
  assert.equal(amount.children[3], savingsBadge(price));
  assert.equal(savingsBadge(price).textContent, 'Save $150.00');
});

test('savings use originalPrice before regularPrice, matching the displayed strike-through', () => {
  const price = render({ price: '249.95', regularPrice: '299.95', originalPrice: '399.95' });
  assert.equal(find(price, (node) => node.tagName === 'del').textContent, '$399.95');
  assert.equal(savingsBadge(price).textContent, 'Save $150.00');
});

test('savings use localized placeholder copy and currency formatting', () => {
  const price = render({ price: 249.95, regularPrice: 399.95 }, {
    save: 'Économisez', languageCode: 'fr_CA', currencyCode: 'CAD',
  });
  const formatted = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(150);
  assert.equal(savingsBadge(price).textContent, `Économisez ${formatted}`);
});

[
  { name: 'full-price', product: { price: 399.95, regularPrice: 399.95 } },
  { name: 'no regular price', product: { price: 399.95 } },
  { name: 'lower regular price', product: { price: 399.95, regularPrice: 299.95 } },
  { name: 'no current price', product: { regularPrice: 399.95 } },
  { name: 'hidden price', product: { price: 249.95, regularPrice: 399.95, addToCart: 'No' } },
].forEach(({ name, product }) => {
  test(`${name}: no savings badge or struck-through price`, () => {
    const price = render(product);
    assert.equal(savingsBadge(price), undefined);
    assert.equal(find(price, (node) => node.tagName === 'del'), undefined);
  });
});

test('varying variant prices retain Starting At and the existing price comparison', () => {
  const price = render({
    price: 249.95,
    regularPrice: 399.95,
    variants: [{ price: 249.95 }, { price: 299.95 }],
  });
  assert.equal(price.children[0].textContent, 'Starting At');
  assert.equal(price.children[1].textContent, '$249.95');
  assert.equal(savingsBadge(price).textContent, 'Save $150.00');
});

test('savings round decimal differences to currency precision', () => {
  assert.equal(savingsBadge(render({ price: 0.1, regularPrice: 0.3 })).textContent, 'Save $0.20');
});
