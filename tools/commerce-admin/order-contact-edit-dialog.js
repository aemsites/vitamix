/**
 * Edit only customer + shipping + billing on an order (ProductBus order JSON shape).
 */
import { showToast } from './commerce-otp-ui.js';

const CUSTOMER_KEYS = ['firstName', 'lastName', 'email', 'phone'];
const ADDRESS_KEYS = ['name', 'address1', 'city', 'state', 'zip', 'country', 'phone', 'email'];

const LABELS = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Phone',
  name: 'Name',
  address1: 'Address line 1',
  city: 'City',
  state: 'State / province',
  zip: 'ZIP / postal',
  country: 'Country',
};

function clonePayload(p) {
  return JSON.parse(JSON.stringify(p));
}

/** Inner order object (payload.order or payload itself). */
function getOrderNode(payload) {
  if (payload && typeof payload === 'object' && payload.order && typeof payload.order === 'object') {
    return payload.order;
  }
  return payload;
}

function mergeContactIntoPayload(fullPayload, customer, shipping, billing) {
  const next = clonePayload(fullPayload);
  const node = getOrderNode(next);
  if (!node || typeof node !== 'object') {
    throw new Error('Invalid order payload: missing order object');
  }
  node.customer = { ...(node.customer || {}), ...customer };
  node.shipping = { ...(node.shipping || {}), ...shipping };
  node.billing = { ...(node.billing || {}), ...billing };
  return next;
}

function createFieldGroup(legendText, prefix, keys, values) {
  const fs = document.createElement('fieldset');
  fs.className = 'order-edit-fieldset';
  const lg = document.createElement('legend');
  lg.textContent = legendText;
  fs.appendChild(lg);

  keys.forEach((key) => {
    const id = `order-edit-${prefix}-${key}`;
    const row = document.createElement('div');
    row.className = 'order-edit-field';
    const label = document.createElement('label');
    label.setAttribute('for', id);
    label.textContent = LABELS[key] || key;
    const input = document.createElement('input');
    input.className = 'order-edit-input';
    input.id = id;
    input.name = id;
    input.type = key === 'email' ? 'email' : 'text';
    input.autocomplete = 'off';
    const v = values && values[key] != null ? String(values[key]) : '';
    input.value = v;
    row.append(label, input);
    fs.appendChild(row);
  });

  return fs;
}

function readGroup(dialog, prefix, keys) {
  const out = {};
  keys.forEach((key) => {
    const el = dialog.querySelector(`#order-edit-${prefix}-${key}`);
    if (el) out[key] = String(el.value).trim();
  });
  return out;
}

/* eslint-disable import/prefer-default-export -- single dialog API */
/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {object} opts.orderPayload - full GET body; includes `order` with customer, shipping,
 *   billing, etc.
 * @param {(merged: object) => Promise<void>} opts.onSave
 */
export function openOrderContactEditDialog({ title, orderPayload, onSave }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'order-edit-dialog';

    let saved = false;
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(saved);
    }, { once: true });

    const h = document.createElement('h2');
    h.className = 'order-edit-title';
    h.textContent = title;

    const lead = document.createElement('p');
    lead.className = 'order-edit-lead';
    lead.textContent = 'Update customer contact and shipping / billing addresses. Line items, payment, and other order fields are not editable here.';

    const node = getOrderNode(orderPayload);
    const body = document.createElement('div');
    body.className = 'order-edit-body';
    body.append(
      createFieldGroup('Customer', 'customer', CUSTOMER_KEYS, node?.customer || {}),
      createFieldGroup('Shipping address', 'shipping', ADDRESS_KEYS, node?.shipping || {}),
      createFieldGroup('Billing address', 'billing', ADDRESS_KEYS, node?.billing || {}),
    );

    const errEl = document.createElement('p');
    errEl.className = 'order-edit-error';
    errEl.hidden = true;

    const footer = document.createElement('div');
    footer.className = 'order-edit-footer';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'ca-btn ca-btn-secondary';
    cancel.textContent = 'Cancel';

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'ca-btn ca-btn-primary';
    save.textContent = 'Save';

    footer.append(cancel, save);
    dialog.append(h, lead, body, errEl, footer);

    cancel.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });

    save.addEventListener('click', async () => {
      errEl.hidden = true;
      const customer = readGroup(dialog, 'customer', CUSTOMER_KEYS);
      const shipping = readGroup(dialog, 'shipping', ADDRESS_KEYS);
      const billing = readGroup(dialog, 'billing', ADDRESS_KEYS);

      if (!customer.email) {
        errEl.textContent = 'Customer email is required.';
        errEl.hidden = false;
        return;
      }

      save.disabled = true;
      try {
        const merged = mergeContactIntoPayload(orderPayload, customer, shipping, billing);
        await onSave(merged);
        showToast('Saved');
        saved = true;
        dialog.close();
      } catch (e) {
        showToast(e.message || 'Save failed', 'error');
        errEl.textContent = e.message || 'Save failed';
        errEl.hidden = false;
      } finally {
        save.disabled = false;
      }
    });

    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.querySelector('.order-edit-input')?.focus();
  });
}
