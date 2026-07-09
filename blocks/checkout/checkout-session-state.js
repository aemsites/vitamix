export const formStateKey = (locale) => `checkout_form_state_${locale}`;

export function saveFormState(form, locale) {
  try {
    const data = {};
    [...form.elements].forEach((el) => {
      if (!el.name) return;
      if (el.type === 'radio') {
        if (el.checked) data[el.name] = el.value;
      } else if (el.type === 'checkbox') {
        data[el.name] = el.checked;
      } else {
        data[el.name] = el.value;
      }
    });
    const shippingSection = form.querySelector('.shipping-address-section');
    if (shippingSection) {
      data.shippingCollapsed = shippingSection.classList.contains('is-collapsed');
    }
    const billingSection = form.querySelector('.billing-section');
    if (billingSection) {
      data.billingCollapsed = billingSection.classList.contains('is-collapsed');
    }
    sessionStorage.setItem(formStateKey(locale), JSON.stringify(data));
  } catch { /* ignore quota / private-mode errors */ }
}

export function restoreFormState(form, locale) {
  try {
    const raw = sessionStorage.getItem(formStateKey(locale));
    if (!raw) return;
    const data = JSON.parse(raw);
    [...form.elements].forEach((el) => {
      if (!el.name || !(el.name in data)) return;
      const saved = data[el.name];
      if (el.type === 'radio') {
        el.checked = el.value === saved;
      } else if (el.type === 'checkbox') {
        el.checked = !!saved;
      } else {
        el.value = saved;
        if (el.tagName === 'SELECT') el.classList.toggle('has-value', !!saved);
      }
    });
    // Re-trigger UI that depends on restored values
    const billingChoice = form.querySelector('[name="billing-choice"]:checked');
    if (billingChoice) billingChoice.dispatchEvent(new Event('change', { bubbles: true }));
    const giftCheckbox = form.querySelector('[name="is-gift"]');
    if (giftCheckbox?.checked) giftCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
  } catch { /* ignore */ }
}
