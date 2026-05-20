/**
 * Unit tests for blocks/checkout/link-integrity.js.
 *
 * Pure function — no DOM, no mocks needed beyond what setup.mjs already
 * installs. Run with `npm run test:unit`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLinkIntegrity } from '../../blocks/checkout/link-integrity.js';

// --- happy paths -----------------------------------------------------------

test('valid when items array is empty', () => {
  assert.deepEqual(validateLinkIntegrity([]), { valid: true });
});

test('valid when no line items have custom.linkedTo', () => {
  const items = [
    { sku: 'foo', quantity: 2, price: { final: '10.00' } },
    { sku: 'bar', quantity: 1, price: { final: '5.00' } },
  ];
  assert.deepEqual(validateLinkIntegrity(items), { valid: true });
});

test('valid when a warranty correctly links to its product (qty match)', () => {
  const items = [
    { sku: 'vx1', quantity: 1, price: { final: '449.95' } },
    {
      sku: 'warranty-3yr',
      quantity: 1,
      price: { final: '75.00' },
      custom: { linkedTo: 'vx1', showInCart: false },
    },
  ];
  assert.deepEqual(validateLinkIntegrity(items), { valid: true });
});

test('valid when parent quantity exceeds warranty quantity (more products than warranties)', () => {
  // 3 products, 1 warranty — every warranty unit has a product unit to pair with;
  // the 2 extra product units are simply unwarrantied.
  const items = [
    { sku: 'vx1', quantity: 3, price: { final: '449.95' } },
    {
      sku: 'warranty-3yr',
      quantity: 1,
      price: { final: '75.00' },
      custom: { linkedTo: 'vx1' },
    },
  ];
  assert.deepEqual(validateLinkIntegrity(items), { valid: true });
});

test('valid with multiple linked warranties to different parents', () => {
  const items = [
    { sku: 'vx1', quantity: 2, price: { final: '449.95' } },
    { sku: 'a3500', quantity: 1, price: { final: '649.95' } },
    {
      sku: 'warranty-3yr',
      quantity: 2,
      price: { final: '75.00' },
      custom: { linkedTo: 'vx1' },
    },
    {
      sku: 'warranty-5yr',
      quantity: 1,
      price: { final: '125.00' },
      custom: { linkedTo: 'a3500' },
    },
  ];
  assert.deepEqual(validateLinkIntegrity(items), { valid: true });
});

// --- invalid: missing parent ----------------------------------------------

test('invalid when warranty references a parent that is not in the order', () => {
  const items = [
    {
      sku: 'warranty-3yr',
      quantity: 1,
      price: { final: '75.00' },
      custom: { linkedTo: 'vx1' },
    },
  ];
  const result = validateLinkIntegrity(items);
  assert.equal(result.valid, false);
  assert.match(result.error, /warranty-3yr/);
  assert.match(result.error, /vx1/);
  assert.match(result.error, /not in the order/);
});

test('invalid when the parent SKU is in the order but does not match the linkedTo value exactly', () => {
  // Defensive: case mismatch / typo should not silently pair
  const items = [
    { sku: 'VX1', quantity: 1, price: { final: '449.95' } },
    {
      sku: 'warranty-3yr',
      quantity: 1,
      price: { final: '75.00' },
      custom: { linkedTo: 'vx1' }, // lowercase, no match
    },
  ];
  const result = validateLinkIntegrity(items);
  assert.equal(result.valid, false);
  assert.match(result.error, /not in the order/);
});

// --- invalid: insufficient parent quantity --------------------------------

test('invalid when warranty quantity exceeds parent quantity', () => {
  // 1 product, 2 warranties — there are more warranty units than products
  // to pair them with.
  const items = [
    { sku: 'vx1', quantity: 1, price: { final: '449.95' } },
    {
      sku: 'warranty-3yr',
      quantity: 2,
      price: { final: '75.00' },
      custom: { linkedTo: 'vx1' },
    },
  ];
  const result = validateLinkIntegrity(items);
  assert.equal(result.valid, false);
  assert.match(result.error, /warranty-3yr/);
  assert.match(result.error, /qty 2/);
  assert.match(result.error, /vx1/);
  assert.match(result.error, /qty 1/);
});

// --- invalid: mixed valid + invalid ---------------------------------------

test('invalid when one of multiple linked items is broken (catches first failure)', () => {
  const items = [
    { sku: 'vx1', quantity: 2, price: { final: '449.95' } },
    { sku: 'a3500', quantity: 1, price: { final: '649.95' } },
    {
      sku: 'warranty-3yr',
      quantity: 2,
      price: { final: '75.00' },
      custom: { linkedTo: 'vx1' }, // valid: 2 <= 2
    },
    {
      sku: 'warranty-5yr',
      quantity: 1,
      price: { final: '125.00' },
      custom: { linkedTo: 'ghost-sku' }, // invalid: missing parent
    },
  ];
  const result = validateLinkIntegrity(items);
  assert.equal(result.valid, false);
  assert.match(result.error, /warranty-5yr/);
  assert.match(result.error, /ghost-sku/);
});
