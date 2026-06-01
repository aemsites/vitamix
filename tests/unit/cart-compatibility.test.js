import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import buildCartCompatibilityWarning from '../../scripts/cart-compatibility.js';

beforeEach(() => {
  globalThis.__resetTestState();
  globalThis.HTMLElement = class HTMLElement {};
  globalThis.document.createElement = (tagName) => ({
    tagName,
    className: '',
    textContent: '',
  });
});

test('buildCartCompatibilityWarning returns null when item is compatible with blender group', () => {
  const accessory = {
    name: 'Accessory',
    local: {
      compatibility: {
        type: 'simple',
        compatibleWith: [{ id: '453', label: 'Ascent & Venturist Series' }],
      },
    },
  };
  const blender = {
    name: 'Ascent X2',
    local: {
      compatibility: {
        type: 'configurable',
        compatibilityGroup: 'Ascent & Venturist Series',
      },
    },
  };

  assert.equal(
    buildCartCompatibilityWarning({ item: accessory, items: [accessory, blender] }),
    null,
  );
});

test('buildCartCompatibilityWarning renders incompatible blender names', () => {
  const accessory = {
    name: 'Accessory',
    local: {
      compatibility: {
        type: 'simple',
        compatibleWith: [{ id: '453', label: 'Ascent & Venturist Series' }],
      },
    },
  };
  const blender = {
    name: 'Explorian Blender',
    local: {
      compatibility: {
        type: 'configurable',
        compatibilityGroup: 'Explorian Series',
      },
    },
  };

  const warning = buildCartCompatibilityWarning({ item: accessory, items: [accessory, blender] });

  assert.ok(warning);
  assert.equal(warning.className, 'cart-item-compatibility-warning');
  assert.equal(warning.textContent, 'This item is not compatible with the Explorian Blender');
});

test('buildCartCompatibilityWarning does not render on configurable items', () => {
  const blender = {
    name: 'Ascent X2',
    local: {
      compatibility: {
        type: 'configurable',
        compatibleWith: [{ id: '453', label: 'Ascent & Venturist Series' }],
        compatibilityGroup: 'Ascent & Venturist Series',
      },
    },
  };
  const otherBlender = {
    name: 'Explorian Blender',
    local: {
      compatibility: {
        type: 'configurable',
        compatibilityGroup: 'Explorian Series',
      },
    },
  };

  assert.equal(
    buildCartCompatibilityWarning({ item: blender, items: [blender, otherBlender] }),
    null,
  );
});
