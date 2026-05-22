const MESSAGES = {
  en: {
    required: 'This field is required.',
    name: 'Please use only letters, spaces, hyphens, or apostrophes.',
    street: 'Please use only letters, numbers, and standard address characters (. , -).',
    city: 'Please use only letters, spaces, hyphens, or periods.',
    zip: 'Please enter a valid 5-digit ZIP code.',
    postalCode: 'Please enter a valid postal code (e.g. A1B 2C3).',
    phone: 'Please enter a valid 10-digit phone number.',
    email: 'Please enter a valid email address.',
  },
  fr: {
    required: 'Ce champ est requis.',
    name: 'Veuillez utiliser uniquement des lettres, espaces, tirets ou apostrophes.',
    street: "Veuillez utiliser uniquement des lettres, chiffres et caractères d'adresse standard (. , -).",
    city: 'Veuillez utiliser uniquement des lettres, espaces, tirets ou points.',
    zip: 'Veuillez entrer un code postal à 5 chiffres valide.',
    postalCode: 'Veuillez entrer un code postal valide (ex. A1B 2C3).',
    phone: 'Veuillez entrer un numéro de téléphone à 10 chiffres valide.',
    email: 'Veuillez entrer une adresse courriel valide.',
  },
};

// Letters (including accented), spaces, hyphens, apostrophes
const NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ''\- ]+$/;
// Letters, numbers, spaces, and common address punctuation (., ,, -, /)
const STREET_RE = /^[A-Za-z0-9 .,\-/]+$/;
// Letters (including accented), spaces, hyphens, periods, apostrophes
const CITY_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ''\-. ]+$/;
// US ZIP: 5 digits, optional +4, not all zeros
const ZIP_US_RE = /^\d{5}(-\d{4})?$/;
// Canadian postal code
const ZIP_CA_RE = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d$/i;
// Basic email
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getMessages(form) {
  const lang = form?.dataset.lang || 'en';
  return MESSAGES[lang] || MESSAGES.en;
}

function showFieldError(input, message) {
  const wrapper = input.closest('.form-field');
  if (!wrapper) return;
  wrapper.classList.add('has-error');
  let errorEl = wrapper.querySelector('.field-error');
  if (!errorEl) {
    errorEl = document.createElement('span');
    errorEl.className = 'field-error';
    // Insert after the label so it appears below the input/label stack
    const label = wrapper.querySelector('label');
    if (label) label.after(errorEl);
    else wrapper.appendChild(errorEl);
  }
  errorEl.textContent = message;
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', `${input.id}-error`);
  errorEl.id = `${input.id}-error`;
}

export function clearFieldError(input) {
  const wrapper = input.closest('.form-field');
  if (!wrapper) return;
  wrapper.classList.remove('has-error');
  wrapper.querySelector('.field-error')?.remove();
  input.removeAttribute('aria-invalid');
  input.removeAttribute('aria-describedby');
}

/**
 * Validates a single form input. Returns an error message string, or null if valid.
 * Reads locale/language from the ancestor form's dataset.
 */
export function validateField(input) {
  const { name, value, required } = input;
  const trimmed = value.trim();
  const isCanada = input.form?.dataset.locale === 'ca';
  const msgs = getMessages(input.form);

  if (required && !trimmed) return msgs.required;
  if (!trimmed) return null;

  const baseName = name.replace(/^(shipping-|billing-)/, '');

  switch (baseName) {
    case 'firstname':
    case 'lastname':
      return NAME_RE.test(trimmed) ? null : msgs.name;

    case 'street-0':
      return STREET_RE.test(trimmed) ? null : msgs.street;

    case 'city':
      return CITY_RE.test(trimmed) ? null : msgs.city;

    case 'zip': {
      if (isCanada) return ZIP_CA_RE.test(trimmed) ? null : msgs.postalCode;
      return ZIP_US_RE.test(trimmed) && trimmed.replace(/\D/g, '') !== '00000' ? null : msgs.zip;
    }

    case 'telephone': {
      const digits = trimmed.replace(/\D/g, '');
      const nanp = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
      return nanp.length === 10 ? null : msgs.phone;
    }

    case 'email':
      return EMAIL_RE.test(trimmed) ? null : msgs.email;

    default:
      return null;
  }
}

/**
 * Attaches blur/input/change validation handlers to a form input or select.
 */
export function attachFieldValidation(input) {
  const isSelect = input.tagName === 'SELECT';

  // Validate on blur (text) or change (select)
  input.addEventListener(isSelect ? 'change' : 'blur', () => {
    const error = validateField(input);
    if (error) showFieldError(input, error);
    else clearFieldError(input);
  });

  // Clear error on typing so feedback is immediate
  if (!isSelect) {
    input.addEventListener('input', () => {
      if (input.closest('.form-field')?.classList.contains('has-error')) {
        clearFieldError(input);
      }
    });
  }
}

/**
 * Validates the entire form. Shows inline errors for all invalid fields,
 * clears errors for valid fields, focuses the first invalid field.
 * Returns true if the form is valid.
 */
export function validateForm(form) {
  let firstInvalid = null;

  form.querySelectorAll('input, select, textarea').forEach((input) => {
    if (input.disabled || input.type === 'hidden' || input.type === 'radio' || input.type === 'checkbox') return;

    const error = validateField(input);
    if (error) {
      showFieldError(input, error);
      if (!firstInvalid) firstInvalid = input;
    } else {
      clearFieldError(input);
    }
  });

  if (firstInvalid) {
    firstInvalid.focus();
    firstInvalid.closest('.form-section')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  return !firstInvalid;
}
