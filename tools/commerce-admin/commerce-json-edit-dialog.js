/* eslint-disable import/prefer-default-export -- single dialog API; named import at callsites */
/**
 * Modal JSON editor for ProductBus PUT/PATCH flows (orders, customers).
 */
import { wireDialogEscapeDismiss } from './commerce-dialog-dismiss.js';
import { showToast } from './commerce-otp-ui.js';

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {object} opts.initialObject
 * @param {(parsed: object) => Promise<void>} opts.onSave
 * @returns {Promise<boolean>} true if user saved successfully
 */
export function openJsonEditDialog({ title, initialObject, onSave }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'commerce-json-edit-dialog';

    let saved = false;

    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(saved);
    }, { once: true });

    const h = document.createElement('h2');
    h.className = 'commerce-json-edit-title';
    h.textContent = title;

    const ta = document.createElement('textarea');
    ta.className = 'commerce-json-edit-textarea';
    ta.value = JSON.stringify(initialObject, null, 2);
    ta.setAttribute('spellcheck', 'false');
    ta.setAttribute('aria-label', 'JSON body');

    const errEl = document.createElement('p');
    errEl.className = 'commerce-json-edit-error';
    errEl.hidden = true;

    const footer = document.createElement('div');
    footer.className = 'commerce-json-edit-footer';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'ca-btn ca-btn-secondary';
    cancel.textContent = 'Cancel';

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'ca-btn ca-btn-primary';
    save.textContent = 'Save';

    footer.append(cancel, save);
    dialog.append(h, ta, errEl, footer);

    cancel.addEventListener('click', () => {
      dialog.close();
    });

    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });

    save.addEventListener('click', async () => {
      errEl.hidden = true;
      let parsed;
      try {
        parsed = JSON.parse(ta.value);
      } catch (e) {
        errEl.textContent = `Invalid JSON: ${e.message}`;
        errEl.hidden = false;
        return;
      }
      save.disabled = true;
      try {
        await onSave(parsed);
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
    wireDialogEscapeDismiss(dialog, () => {
      dialog.close();
    });
    dialog.showModal();
    ta.focus();
  });
}
