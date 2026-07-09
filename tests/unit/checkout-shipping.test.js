import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findShippingMethodRadio } from '../../blocks/checkout/checkout-shipping.js';

function radio(value, type, label) {
  return {
    value,
    dataset: {
      ...(type ? { shippingType: type } : {}),
      ...(label ? { shippingLabel: label } : {}),
    },
  };
}

function container(radios) {
  return {
    querySelectorAll(selector) {
      assert.equal(selector, 'input[type="radio"]');
      return radios;
    },
  };
}

test('findShippingMethodRadio prefers exact shipping method id', () => {
  const standard = radio('219', 'standard', 'Standard Shipping');
  const priority = radio('2275', 'priority', 'Priority Shipping');

  const selected = findShippingMethodRadio(container([standard, priority]), {
    id: '2275',
    type: 'standard',
    label: 'Standard Shipping',
  });

  assert.equal(selected, priority);
});

test('findShippingMethodRadio preserves selection by method type when provider id changes', () => {
  const standard = radio('220', 'standard', 'Standard Shipping');
  const priority = radio('2276', 'priority', 'Priority Shipping');

  const selected = findShippingMethodRadio(container([standard, priority]), {
    id: '2275',
    type: 'priority',
    label: 'Priority Shipping',
  });

  assert.equal(selected, priority);
});

test('findShippingMethodRadio falls back to label, then first method', () => {
  const standard = radio('220', null, 'Standard Shipping');
  const priority = radio('2276', null, 'Priority Shipping');

  assert.equal(
    findShippingMethodRadio(container([standard, priority]), { id: '218', label: 'Priority Shipping' }),
    priority,
  );
  assert.equal(
    findShippingMethodRadio(container([standard, priority]), { id: '218', label: 'Missing' }),
    standard,
  );
  assert.equal(findShippingMethodRadio(container([]), { id: '218' }), null);
});
