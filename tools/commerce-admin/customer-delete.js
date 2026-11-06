/* eslint-disable import/prefer-default-export -- single helper; named import at callsites */
/**
 * Delete a ProductBus customer (privacy / right-to-erasure requests).
 *
 * `DELETE customers/{email}` removes the profile, saved addresses and the
 * customer-to-order links. It does NOT delete or anonymise the order records
 * themselves, and it does not touch other systems (ERP, CRM, email marketing).
 * The dialog says so explicitly so nobody assumes the request is fully complete.
 */
import { apiFetch, getApiBase } from './commerce-otp-api.js';
import { PB_ORG, PB_SITE } from './commerce-pbus-config.js';
import { escapeHtml, showToast } from './commerce-otp-ui.js';
import { wireDialogEscapeDismiss } from './commerce-dialog-dismiss.js';

async function readRespError(resp) {
  return resp.headers.get('x-error')
    || (await resp.text().catch(() => '')).trim()
    || `HTTP ${resp.status}`;
}

function sameEmail(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

/**
 * Open the confirmation dialog. The customer is deleted only after the admin
 * types the account email; `onDeleted(email)` runs once the API confirms.
 *
 * @param {string} rawEmail account email (the storage key)
 * @param {{ onDeleted?: (email: string) => void }} [options]
 */
export function openDeleteCustomerDialog(rawEmail, { onDeleted } = {}) {
  const email = String(rawEmail || '').trim();
  if (!email) return;
  const requestPath = `customers/${encodeURIComponent(email)}`;
  const requestUrl = `${getApiBase()}/${PB_ORG}/sites/${PB_SITE}/${requestPath}`;

  const dialog = document.createElement('dialog');
  dialog.className = 'pim-delete-dialog customers-delete-dialog';
  dialog.innerHTML = `
    <form method="dialog" class="pim-delete-dialog-inner">
      <h2 class="pim-delete-dialog-title">Delete customer?</h2>
      <p class="pim-delete-dialog-copy">This permanently deletes the profile, saved addresses and order history links for <strong>${escapeHtml(email)}</strong>.</p>
      <p class="pim-delete-dialog-copy customers-delete-note"><strong>Orders are not deleted.</strong> The name and address stored on past orders remain, and data in other systems (ERP, CRM, email marketing) is not affected.</p>
      <div class="pim-delete-dialog-call">
        <span>API call</span>
        <code>DELETE ${escapeHtml(requestUrl)}</code>
      </div>
      <label class="pim-delete-dialog-label" for="customers-delete-email">Enter the customer email to confirm</label>
      <input id="customers-delete-email" class="pim-delete-dialog-input" type="text" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(email)}" />
      <p class="pim-delete-dialog-status" data-customers-delete-status aria-live="polite"></p>
      <div class="pim-delete-dialog-actions">
        <button type="button" class="pim-delete-dialog-cancel">Cancel</button>
        <button type="submit" class="pim-delete-dialog-confirm" disabled>Delete customer</button>
      </div>
    </form>`;
  document.body.appendChild(dialog);

  const form = dialog.querySelector('form');
  const input = dialog.querySelector('#customers-delete-email');
  const cancelBtn = dialog.querySelector('.pim-delete-dialog-cancel');
  const confirmBtn = dialog.querySelector('.pim-delete-dialog-confirm');
  const statusEl = dialog.querySelector('[data-customers-delete-status]');
  const dismiss = () => {
    dialog.close();
    dialog.remove();
  };

  input.addEventListener('input', () => {
    confirmBtn.disabled = !sameEmail(input.value, email);
  });
  cancelBtn.addEventListener('click', dismiss);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dismiss();
  });
  wireDialogEscapeDismiss(dialog, dismiss);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!sameEmail(input.value, email)) return;
    input.disabled = true;
    cancelBtn.disabled = true;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Deleting…';
    statusEl.textContent = '';
    try {
      const resp = await apiFetch(PB_ORG, PB_SITE, requestPath, { method: 'DELETE' });
      if (!resp.ok) throw new Error(await readRespError(resp));
      showToast(`Deleted ${email}`);
      dismiss();
      if (typeof onDeleted === 'function') onDeleted(email);
    } catch (err) {
      statusEl.textContent = err.message || 'Failed to delete customer';
      input.disabled = false;
      cancelBtn.disabled = false;
      confirmBtn.disabled = !sameEmail(input.value, email);
      confirmBtn.textContent = 'Delete customer';
      showToast(err.message || 'Failed to delete customer', 'error');
    }
  });

  dialog.showModal();
  input.focus();
}
