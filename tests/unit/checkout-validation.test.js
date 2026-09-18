import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateField, validateForm, isValidPhone } from '../../blocks/checkout/checkout-validation.js';

function makeInput(name, value, { required = false, locale = null, lang = 'en' } = {}) {
  return {
    name,
    value,
    required,
    form: { dataset: { lang, ...(locale ? { locale } : {}) } },
  };
}

// ---------------------------------------------------------------------------
// validateField — Magento-compatible names and address text
// ---------------------------------------------------------------------------

['', 'shipping-', 'billing-'].forEach((prefix) => {
  [['us', 'en'], ['ca', 'fr']].forEach(([locale, lang]) => {
    const options = { required: true, locale, lang };
    const context = `${prefix || 'unprefixed'} ${locale}/${lang}`;

    test(`validateField: ${context} accepts ASCII names with spaces, hyphens and apostrophes`, () => {
      // Kept deliberately broader than Magento's validate-alpha (/^[a-zA-Z]+$/),
      // which rejects all of these. Common Québécois and anglophone names must
      // still go through. Each was confirmed against Chase in UAT, or is the
      // same character class as a confirmed case.
      const names = [
        'Caroline', 'Depass', 'Jean-Luc', 'Marie-Claude', 'Anne Marie',
        "O'Neill", "Dufour-L'Arrivee", 'Mary Jane', 'St John',
        // Curly apostrophe (U+2019) — what iOS/macOS autocorrect produces, and
        // confirmed accepted by Chase, so it must not be rejected here.
        'D’Arcy', 'O’Neill',
      ];
      ['firstname', 'lastname'].forEach((fieldName) => {
        names.forEach((value) => {
          const input = makeInput(`${prefix}${fieldName}`, value, options);
          assert.equal(validateField(input), null, `${fieldName}: ${value}`);
          assert.equal(input.value, value);
        });
      });
    });

    test(`validateField: ${context} rejects accented names that Chase declines`, () => {
      // These reach Chase as AVS fields and cause a hard decline on the hosted
      // payment page rather than a field error, so they must be caught here.
      // "Dufour-L'Arrivèe" declined while "Dufour-L'Arrivee" was accepted — the
      // accented letter was the only difference.
      const rejected = [
        'Élodie', 'E\u0301lodie', "Dufour-L'Arriv\u00e9e", "Dufour-L'Arriv\u00e8e",
        'T\u00eate', 'St\u00e9phane', 'Łukasz', '李',
      ];
      ['firstname', 'lastname'].forEach((fieldName) => {
        rejected.forEach((value) => {
          assert.notEqual(
            validateField(makeInput(`${prefix}${fieldName}`, value, options)),
            null,
            `${fieldName}: ${value}`,
          );
        });
      });
    });

    test(`validateField: ${context} still rejects digits, symbols and markup in names`, () => {
      ['firstname', 'lastname'].forEach((fieldName) => {
        ['Jane@Doe', 'Jane#Doe', 'Jane/Doe', '<b>Jane</b>', 'Jane😀', 'Doe, Jr. 2', 'Anne_Marie', 'Jane2'].forEach((value) => {
          assert.notEqual(validateField(makeInput(`${prefix}${fieldName}`, value, options)), null, value);
        });
      });
    });

    test(`validateField: ${context} requires a name to start with a letter`, () => {
      // Note: values are trimmed before validation, so a leading space is not an
      // error — only leading punctuation is.
      ['firstname', 'lastname'].forEach((fieldName) => {
        ['-Smith', "'Brien", '’Brien', '-', "'"].forEach((value) => {
          assert.notEqual(
            validateField(makeInput(`${prefix}${fieldName}`, value, options)),
            null,
            `${fieldName}: ${value}`,
          );
        });
      });
    });

    test(`validateField: ${context} accepts free-text street and city values unchanged`, () => {
      const values = {
        'street-0': [
          '2900 boulevard Édouard-Montpetit', '2900 boulevard E\u0301douard-Montpetit',
          "12 rue de l'Église #4", '10 King’s Rd (A&B)', '東京都新宿区西新宿2-8-1',
        ],
        'street-1': ['Appartement n° 4', 'Bâtiment « Érable »', '#4 (A&B)'],
        city: [
          'Montréal', 'Montre\u0301al', 'L’Assomption', "L'Île-Perrot", 'Saint-Louis-du-Ha! Ha!',
          'Łódź', 'Québec (Sainte-Foy)', '25 de Mayo', '東京都',
        ],
      };
      Object.entries(values).forEach(([fieldName, examples]) => {
        examples.forEach((value) => {
          const input = makeInput(`${prefix}${fieldName}`, value, options);
          assert.equal(validateField(input), null, `${fieldName}: ${value}`);
          assert.equal(input.value, value);
        });
      });
    });

    test(`validateField: ${context} preserves required and optional text validation`, () => {
      ['firstname', 'lastname', 'street-0', 'street-1', 'city'].forEach((fieldName) => {
        ['', '   '].forEach((value) => {
          assert.equal(
            validateField(makeInput(`${prefix}${fieldName}`, value, options)),
            lang === 'fr' ? 'Ce champ est requis.' : 'This field is required.',
          );
          assert.equal(
            validateField(makeInput(`${prefix}${fieldName}`, value, { ...options, required: false })),
            null,
          );
        });
      });
    });
  });
});

test('validateField: Canadian French address retains postal-code and email checks', () => {
  const options = { required: true, locale: 'ca', lang: 'fr' };
  assert.equal(validateField(makeInput('shipping-zip', 'H3T 1J4', options)), null);
  assert.notEqual(validateField(makeInput('shipping-zip', 'H3T ÉJ4', options)), null);
  assert.equal(validateField(makeInput('email', 'test@example.com', options)), null);
  assert.notEqual(validateField(makeInput('email', 'not-an-email', options)), null);
});

// ---------------------------------------------------------------------------
// validateField — zip code
// ---------------------------------------------------------------------------

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
// validateField — telephone
// ---------------------------------------------------------------------------

test('validateField: valid 10-digit telephone returns null', () => {
  const input = makeInput('shipping-telephone', '(555) 123-4567', { required: true });
  assert.equal(validateField(input), null);
});

test('validateField: +1 prefixed telephone returns null', () => {
  const input = makeInput('telephone', '1 (555) 123-4567', { required: true });
  assert.equal(validateField(input), null);
});

test('validateField: short telephone returns phone error', () => {
  const input = makeInput('telephone', '(555) 123', { required: true });
  assert.notEqual(validateField(input), null);
});

test('validateField: empty required telephone returns required error', () => {
  const input = makeInput('telephone', '', { required: true });
  assert.notEqual(validateField(input), null);
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

// ---------------------------------------------------------------------------
// validateForm — hidden section skip (billing hidden for wallet providers)
// ---------------------------------------------------------------------------

// An invalid field inside a `[hidden]` section (e.g. billing after selecting
// Apple Pay, which collects billing from the wallet) must not block submit or
// steal focus — otherwise the submit button silently does nothing with an
// error the user cannot see.
function makeInvalidField(name, { hidden, onFocus, onError } = {}) {
  const hiddenAncestor = {};
  const wrapper = {
    classList: { contains: () => false, add() { onError?.(); }, remove() {} },
    querySelector: (sel) => (sel === '.field-error' ? { textContent: '', id: '' } : null),
    appendChild() {},
  };
  const section = {
    classList: { contains: () => false },
    querySelector: () => null,
    scrollIntoView() {},
  };
  return {
    name,
    value: '941', // invalid US zip
    required: true,
    disabled: false,
    type: 'text',
    id: name,
    form: { dataset: { lang: 'en' } },
    closest(sel) {
      if (sel === '[hidden]') return hidden ? hiddenAncestor : null;
      if (sel === '.form-field') return wrapper;
      if (sel === '.form-section') return section;
      return null;
    },
    setAttribute() {},
    removeAttribute() {},
    focus() { onFocus?.(); },
  };
}

function makeFormWith(fields) {
  return {
    querySelectorAll: () => ({ forEach: (fn) => fields.forEach(fn) }),
    dataset: { lang: 'en' },
  };
}

test('validateForm: returns true when the only invalid field is in a hidden section', () => {
  const form = makeFormWith([makeInvalidField('billing-zip', { hidden: true })]);
  assert.equal(validateForm(form), true);
});

test('validateForm: does not focus an invalid field in a hidden section', () => {
  let focused = false;
  const form = makeFormWith([
    makeInvalidField('billing-zip', { hidden: true, onFocus: () => { focused = true; } }),
  ]);
  validateForm(form);
  assert.equal(focused, false);
});

test('validateForm: does not show an error on an invalid field in a hidden section', () => {
  let errored = false;
  const form = makeFormWith([
    makeInvalidField('billing-zip', { hidden: true, onError: () => { errored = true; } }),
  ]);
  validateForm(form);
  assert.equal(errored, false);
});

test('validateForm: still fails on a visible invalid field alongside a hidden one', () => {
  let visibleFocused = false;
  const form = makeFormWith([
    makeInvalidField('billing-zip', { hidden: true }),
    makeInvalidField('shipping-zip', { hidden: false, onFocus: () => { visibleFocused = true; } }),
  ]);
  assert.equal(validateForm(form), false);
  assert.equal(visibleFocused, true);
});

// isValidPhone — shared NANP phone check
test('isValidPhone: 10 digits is valid', () => {
  assert.equal(isValidPhone('2165550142'), true);
});

test('isValidPhone: formatted 10 digits is valid', () => {
  assert.equal(isValidPhone('(216) 555-0142'), true);
});

test('isValidPhone: 11 digits with leading 1 is valid', () => {
  assert.equal(isValidPhone('1 216 555 0142'), true);
});

test('isValidPhone: 9 digits is invalid', () => {
  assert.equal(isValidPhone('216555014'), false);
});

test('isValidPhone: 11 digits not starting with 1 is invalid', () => {
  assert.equal(isValidPhone('22165550142'), false);
});

test('isValidPhone: letters are invalid', () => {
  assert.equal(isValidPhone('phone number'), false);
});

test('isValidPhone: empty is invalid', () => {
  assert.equal(isValidPhone(''), false);
});
