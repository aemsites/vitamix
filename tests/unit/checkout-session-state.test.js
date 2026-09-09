/**
 * Unit tests for blocks/checkout/checkout-session-state.js.
 *
 * Tests save/restore of checkout form data in sessionStorage.
 * Run with `npm run test:unit`.
 */
import { test, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { saveFormState, restoreFormState, formStateKey } from '../../blocks/checkout/checkout-session-state.js';

const LOCALE = 'us';
const FORM_STATE_KEY = formStateKey(LOCALE);

if (!globalThis.CSS) {
  globalThis.CSS = {
    escape: (s) => String(s).replace(/([^\w-])/g, '\\$1'),
  };
}

beforeEach(() => {
  globalThis.__resetTestState();
});

// ---------------------------------------------------------------------------
// Fake form builder
// ---------------------------------------------------------------------------

function makeEl(opts) {
  const el = {
    name: opts.name,
    type: opts.type || 'text',
    value: opts.value ?? '',
    checked: opts.checked ?? false,
    tagName: opts.type === 'select' ? 'SELECT' : 'INPUT',
    disabled: false,
    _dispatched: [],
    classList: {
      _set: new Set(opts.classes || []),
      toggle(cls, force) {
        if (force === undefined) {
          if (this._set.has(cls)) this._set.delete(cls); else this._set.add(cls);
        } else if (force) { this._set.add(cls); } else { this._set.delete(cls); }
      },
      contains(cls) { return this._set.has(cls); },
    },
    dispatchEvent(event) { this._dispatched.push(event); },
  };
  if (opts.type === 'textarea') el.tagName = 'TEXTAREA';
  return el;
}

function makeSection(collapsed = false) {
  return {
    classList: {
      _set: new Set(collapsed ? ['is-collapsed'] : []),
      contains(cls) { return this._set.has(cls); },
    },
  };
}

function buildForm(fieldDefs, opts = {}) {
  const elements = fieldDefs.map(makeEl);
  const shippingSection = opts.shippingSection ? makeSection(opts.shippingCollapsed) : null;
  const billingSection = opts.billingSection ? makeSection(opts.billingCollapsed) : null;

  function querySelector(selector) {
    if (selector === '.shipping-address-section') return shippingSection;
    if (selector === '.billing-section') return billingSection;
    const checkedMatch = selector.match(/\[name="([^"]+)"\]:checked/);
    if (checkedMatch) {
      const n = checkedMatch[1].replace(/\\/g, '');
      return elements.find((el) => el.name === n && el.checked) ?? null;
    }
    const nameMatch = selector.match(/\[name="([^"]+)"\]/);
    if (nameMatch) {
      const n = nameMatch[1].replace(/\\/g, '');
      return elements.find((el) => el.name === n) ?? null;
    }
    return null;
  }

  return { elements, querySelector };
}

// ---------------------------------------------------------------------------
// saveFormState
// ---------------------------------------------------------------------------

describe('saveFormState', () => {
  test('saves text and email field values', () => {
    const form = buildForm([
      { name: 'email', type: 'email', value: 'test@example.com' },
      { name: 'shipping-firstname', type: 'text', value: 'Jane' },
    ]);
    saveFormState(form, LOCALE);
    const saved = JSON.parse(sessionStorage.getItem(FORM_STATE_KEY));
    assert.equal(saved.email, 'test@example.com');
    assert.equal(saved['shipping-firstname'], 'Jane');
  });

  test('saves checkbox checked state', () => {
    const form = buildForm([
      { name: 'newsletter', type: 'checkbox', checked: true },
      { name: 'is-gift', type: 'checkbox', checked: false },
    ]);
    saveFormState(form, LOCALE);
    const saved = JSON.parse(sessionStorage.getItem(FORM_STATE_KEY));
    assert.equal(saved.newsletter, true);
    assert.equal(saved['is-gift'], false);
  });

  test('saves the checked radio value for a group', () => {
    const form = buildForm([
      { name: 'billing-choice', type: 'radio', value: 'same', checked: false },
      { name: 'billing-choice', type: 'radio', value: 'different', checked: true },
    ]);
    saveFormState(form, LOCALE);
    const saved = JSON.parse(sessionStorage.getItem(FORM_STATE_KEY));
    assert.equal(saved['billing-choice'], 'different');
  });

  test('omits radio group from saved data when nothing is checked', () => {
    const form = buildForm([
      { name: 'billing-choice', type: 'radio', value: 'same', checked: false },
      { name: 'billing-choice', type: 'radio', value: 'different', checked: false },
    ]);
    saveFormState(form, LOCALE);
    const saved = JSON.parse(sessionStorage.getItem(FORM_STATE_KEY));
    assert.equal('billing-choice' in saved, false);
  });

  test('saves select value', () => {
    const form = buildForm([
      { name: 'shipping-state', type: 'select', value: 'CA' },
    ]);
    saveFormState(form, LOCALE);
    const saved = JSON.parse(sessionStorage.getItem(FORM_STATE_KEY));
    assert.equal(saved['shipping-state'], 'CA');
  });

  test('skips elements with no name', () => {
    const form = buildForm([
      { name: '', type: 'text', value: 'ignored' },
      { name: 'email', type: 'email', value: 'kept@example.com' },
    ]);
    saveFormState(form, LOCALE);
    const saved = JSON.parse(sessionStorage.getItem(FORM_STATE_KEY));
    assert.equal(Object.keys(saved).length, 1);
    assert.equal(saved.email, 'kept@example.com');
  });

  test('saves shipping and billing collapsed state', () => {
    const form = buildForm(
      [{ name: 'email', type: 'email', value: 'test@example.com' }],
      {
        shippingSection: true,
        shippingCollapsed: true,
        billingSection: true,
        billingCollapsed: true,
      },
    );
    saveFormState(form, LOCALE);
    const saved = JSON.parse(sessionStorage.getItem(FORM_STATE_KEY));
    assert.equal(saved.shippingCollapsed, true);
    assert.equal(saved.billingCollapsed, true);
  });
});

// ---------------------------------------------------------------------------
// restoreFormState
// ---------------------------------------------------------------------------

describe('restoreFormState', () => {
  test('restores text field values', () => {
    sessionStorage.setItem(FORM_STATE_KEY, JSON.stringify({
      email: 'restored@example.com',
      'shipping-firstname': 'John',
    }));
    const form = buildForm([
      { name: 'email', type: 'email', value: '' },
      { name: 'shipping-firstname', type: 'text', value: '' },
    ]);
    restoreFormState(form, LOCALE);
    assert.equal(form.elements[0].value, 'restored@example.com');
    assert.equal(form.elements[1].value, 'John');
  });

  test('restores checkbox checked state', () => {
    sessionStorage.setItem(FORM_STATE_KEY, JSON.stringify({
      newsletter: true,
      'is-gift': false,
    }));
    const form = buildForm([
      { name: 'newsletter', type: 'checkbox', checked: false },
      { name: 'is-gift', type: 'checkbox', checked: true },
    ]);
    restoreFormState(form, LOCALE);
    assert.equal(form.elements[0].checked, true);
    assert.equal(form.elements[1].checked, false);
  });

  test('restores radio group by setting checked on the matching value', () => {
    sessionStorage.setItem(FORM_STATE_KEY, JSON.stringify({
      'billing-choice': 'different',
    }));
    const form = buildForm([
      { name: 'billing-choice', type: 'radio', value: 'same', checked: true },
      { name: 'billing-choice', type: 'radio', value: 'different', checked: false },
    ]);
    restoreFormState(form, LOCALE);
    assert.equal(form.elements[0].checked, false);
    assert.equal(form.elements[1].checked, true);
  });

  test('restores select value and adds has-value class when non-empty', () => {
    sessionStorage.setItem(FORM_STATE_KEY, JSON.stringify({ 'shipping-state': 'TX' }));
    const form = buildForm([
      { name: 'shipping-state', type: 'select', value: '' },
    ]);
    restoreFormState(form, LOCALE);
    assert.equal(form.elements[0].value, 'TX');
    assert.equal(form.elements[0].classList.contains('has-value'), true);
  });

  test('removes has-value class from select when restored value is empty', () => {
    sessionStorage.setItem(FORM_STATE_KEY, JSON.stringify({ 'shipping-state': '' }));
    const form = buildForm([
      { name: 'shipping-state', type: 'select', value: 'CA', classes: ['has-value'] },
    ]);
    restoreFormState(form, LOCALE);
    assert.equal(form.elements[0].value, '');
    assert.equal(form.elements[0].classList.contains('has-value'), false);
  });

  test('dispatches change event on checked billing-choice radio after restore', () => {
    sessionStorage.setItem(FORM_STATE_KEY, JSON.stringify({ 'billing-choice': 'different' }));
    const form = buildForm([
      { name: 'billing-choice', type: 'radio', value: 'same', checked: false },
      { name: 'billing-choice', type: 'radio', value: 'different', checked: false },
    ]);
    restoreFormState(form, LOCALE);
    const differentEl = form.elements[1];
    assert.equal(differentEl.checked, true);
    assert.equal(differentEl._dispatched.length, 1);
    assert.equal(differentEl._dispatched[0].type, 'change');
  });

  test('dispatches change event on gift checkbox when restored as checked', () => {
    sessionStorage.setItem(FORM_STATE_KEY, JSON.stringify({ 'is-gift': true }));
    const form = buildForm([
      { name: 'is-gift', type: 'checkbox', checked: false },
    ]);
    restoreFormState(form, LOCALE);
    assert.equal(form.elements[0].checked, true);
    assert.equal(form.elements[0]._dispatched.length, 1);
    assert.equal(form.elements[0]._dispatched[0].type, 'change');
  });

  test('does not dispatch change on gift checkbox when restored as unchecked', () => {
    sessionStorage.setItem(FORM_STATE_KEY, JSON.stringify({ 'is-gift': false }));
    const form = buildForm([
      { name: 'is-gift', type: 'checkbox', checked: true },
    ]);
    restoreFormState(form, LOCALE);
    assert.equal(form.elements[0].checked, false);
    assert.equal(form.elements[0]._dispatched.length, 0);
  });

  test('does nothing when sessionStorage has no saved state', () => {
    const form = buildForm([
      { name: 'email', type: 'email', value: 'original@example.com' },
    ]);
    restoreFormState(form, LOCALE);
    assert.equal(form.elements[0].value, 'original@example.com');
  });

  test('does nothing when sessionStorage contains invalid JSON', () => {
    sessionStorage.setItem(FORM_STATE_KEY, 'not-json{{{');
    const form = buildForm([
      { name: 'email', type: 'email', value: 'safe@example.com' },
    ]);
    restoreFormState(form, LOCALE);
    assert.equal(form.elements[0].value, 'safe@example.com');
  });
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe('round-trip', () => {
  test('us and ca use separate storage keys', () => {
    const usForm = buildForm([{ name: 'email', type: 'email', value: 'us@example.com' }]);
    const caForm = buildForm([{ name: 'email', type: 'email', value: 'ca@example.com' }]);
    saveFormState(usForm, 'us');
    saveFormState(caForm, 'ca');
    assert.notEqual(sessionStorage.getItem(formStateKey('us')), sessionStorage.getItem(formStateKey('ca')));
    const restoredUs = buildForm([{ name: 'email', type: 'email', value: '' }]);
    restoreFormState(restoredUs, 'us');
    assert.equal(restoredUs.elements[0].value, 'us@example.com');
    const restoredCa = buildForm([{ name: 'email', type: 'email', value: '' }]);
    restoreFormState(restoredCa, 'ca');
    assert.equal(restoredCa.elements[0].value, 'ca@example.com');
  });

  test('save then restore recovers all field types', () => {
    const form = buildForm([
      { name: 'email', type: 'email', value: 'rt@example.com' },
      { name: 'shipping-firstname', type: 'text', value: 'Ada' },
      { name: 'shipping-state', type: 'select', value: 'NY' },
      { name: 'newsletter', type: 'checkbox', checked: true },
      { name: 'billing-choice', type: 'radio', value: 'same', checked: true },
      { name: 'billing-choice', type: 'radio', value: 'different', checked: false },
    ]);

    saveFormState(form, LOCALE);

    // Wipe field values to simulate a fresh page load
    form.elements.forEach((el) => {
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = false;
      else el.value = '';
    });

    restoreFormState(form, LOCALE);

    assert.equal(form.elements[0].value, 'rt@example.com');
    assert.equal(form.elements[1].value, 'Ada');
    assert.equal(form.elements[2].value, 'NY');
    assert.equal(form.elements[3].checked, true);
    assert.equal(form.elements[4].checked, true); // 'same' radio
    assert.equal(form.elements[5].checked, false); // 'different' radio
  });
});
