import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateField, validateForm } from '../../blocks/checkout/checkout-validation.js';

// ---------------------------------------------------------------------------
// validateField — zip code
// ---------------------------------------------------------------------------

function makeInput(name, value, { required = false, locale = null } = {}) {
  return {
    name,
    value,
    required,
    form: locale ? { dataset: { lang: 'en', locale } } : { dataset: { lang: 'en' } },
  };
}

test('validateField: 3-digit US ZIP is invalid', () => {
  const input = makeInput('shipping-zip', '941', { required: true });
  assert.notEqual(validateField(input), null);
});

test('validateField: 5-digit US ZIP is valid', () => {
  const input = makeInput('shipping-zip', '94102', { required: true });
  assert.equal(validateField(input), null);
});

test('validateField: 9-digit US ZIP with hyphen is valid', () => {
  const input = makeInput('zip', '94102-1234', { required: true });
  assert.equal(validateField(input), null);
});

test('validateField: all-zeros US ZIP is invalid', () => {
  const input = makeInput('zip', '00000', { required: true });
  assert.notEqual(validateField(input), null);
});

test('validateField: 4-digit US ZIP is invalid', () => {
  const input = makeInput('zip', '9410', { required: true });
  assert.notEqual(validateField(input), null);
});

test('validateField: 6-digit US ZIP is invalid', () => {
  const input = makeInput('zip', '941021', { required: true });
  assert.notEqual(validateField(input), null);
});

test('validateField: valid CA postal code (with space) is valid', () => {
  const input = makeInput('shipping-zip', 'K1A 0A9', { required: true, locale: 'ca' });
  assert.equal(validateField(input), null);
});

test('validateField: invalid CA postal code is invalid', () => {
  const input = makeInput('shipping-zip', '94102', { required: true, locale: 'ca' });
  assert.notEqual(validateField(input), null);
});

test('validateField: empty required zip returns required error', () => {
  const input = makeInput('zip', '', { required: true });
  assert.notEqual(validateField(input), null);
});

test('validateField: empty non-required zip returns null', () => {
  const input = makeInput('zip', '', { required: false });
  assert.equal(validateField(input), null);
});

// ---------------------------------------------------------------------------
// validateForm — collapsed section expansion
// ---------------------------------------------------------------------------

function makeFormWithCollapsedInvalidZip() {
  let clicked = false;
  let focused = false;

  const editBtn = { click() { clicked = true; } };

  const section = {
    classList: { contains: (cls) => cls === 'is-collapsed' },
    querySelector: (sel) => (sel === '.section-edit-btn' ? editBtn : null),
    scrollIntoView() {},
  };

  // Return a pre-existing error span so showFieldError never calls document.createElement.
  const errorSpan = { textContent: '', id: '' };
  const wrapper = {
    classList: {
      contains: () => false,
      add() {},
      remove() {},
    },
    querySelector: (sel) => (sel === '.field-error' ? errorSpan : null),
    appendChild() {},
  };

  const zipInput = {
    name: 'shipping-zip',
    value: '941',
    required: true,
    disabled: false,
    type: 'text',
    id: 'shipping-zip',
    form: { dataset: { lang: 'en' } },
    closest(sel) {
      if (sel === '.form-field') return wrapper;
      if (sel === '.form-section') return section;
      return null;
    },
    setAttribute() {},
    removeAttribute() {},
    focus() { focused = true; },
  };

  const form = {
    querySelectorAll: () => ({ forEach: (fn) => fn(zipInput) }),
    dataset: { lang: 'en' },
  };

  return {
    form,
    getClicked: () => clicked,
    getFocused: () => focused,
  };
}

test('validateForm: returns false for invalid zip in collapsed section', () => {
  const { form } = makeFormWithCollapsedInvalidZip();
  assert.equal(validateForm(form), false);
});

test('validateForm: clicks edit button to expand collapsed section with invalid field', () => {
  const { form, getClicked } = makeFormWithCollapsedInvalidZip();
  validateForm(form);
  assert.equal(getClicked(), true);
});

test('validateForm: focuses the invalid field after expanding', () => {
  const { form, getFocused } = makeFormWithCollapsedInvalidZip();
  validateForm(form);
  assert.equal(getFocused(), true);
});

test('validateForm: does not click edit button when section is not collapsed', () => {
  let clicked = false;
  const editBtn = { click() { clicked = true; } };

  const section = {
    classList: { contains: () => false },
    querySelector: (sel) => (sel === '.section-edit-btn' ? editBtn : null),
    scrollIntoView() {},
  };

  const errorSpan2 = { textContent: '', id: '' };
  const wrapper = {
    classList: { contains: () => false, add() {}, remove() {} },
    querySelector: (sel) => (sel === '.field-error' ? errorSpan2 : null),
    appendChild() {},
  };

  const zipInput = {
    name: 'shipping-zip',
    value: '941',
    required: true,
    disabled: false,
    type: 'text',
    id: 'shipping-zip',
    form: { dataset: { lang: 'en' } },
    closest(sel) {
      if (sel === '.form-field') return wrapper;
      if (sel === '.form-section') return section;
      return null;
    },
    setAttribute() {},
    removeAttribute() {},
    focus() {},
  };

  const form = {
    querySelectorAll: () => ({ forEach: (fn) => fn(zipInput) }),
    dataset: { lang: 'en' },
  };

  validateForm(form);
  assert.equal(clicked, false);
});

test('validateForm: returns true when all fields are valid', () => {
  const form = {
    querySelectorAll: () => ({ forEach: () => {} }),
    dataset: { lang: 'en' },
  };
  assert.equal(validateForm(form), true);
});
