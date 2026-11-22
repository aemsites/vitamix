/**
 * Coupon type groups: free-form labels on a coupon type (`groups: string[]`).
 * Pure helpers plus group pickers shared by the coupons and promotions pages.
 */
import { commerceGroupBadgeHtml, escapeHtml, showToast } from './commerce-otp-ui.js';
import { wireDialogEscapeDismiss } from './commerce-dialog-dismiss.js';

const SUGGESTION_LIMIT = 40;

/**
 * Trimmed, de-duplicated (case-sensitive, first wins), non-blank strings.
 * @param {unknown} list
 * @returns {string[]}
 */
export function normalizeCouponGroups(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  list.forEach((item) => {
    if (typeof item !== 'string') return;
    const g = item.trim();
    if (!g || seen.has(g)) return;
    seen.add(g);
    out.push(g);
  });
  return out;
}

/** @param {unknown} row coupon type */
export function couponGroupsOf(row) {
  if (!row || typeof row !== 'object') return [];
  return normalizeCouponGroups(/** @type {Record<string, unknown>} */ (row).groups);
}

/** @param {string} a @param {string} b */
function compareGroups(a, b) {
  const cmp = a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
  if (cmp !== 0) return cmp;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Distinct groups across coupon types, sorted.
 * @param {unknown} types
 * @returns {string[]}
 */
export function collectCouponGroups(types) {
  const all = new Set();
  (Array.isArray(types) ? types : []).forEach((row) => {
    couponGroupsOf(row).forEach((g) => all.add(g));
  });
  return [...all].sort(compareGroups);
}

/**
 * @param {string[]} groups
 * @param {string} [emptyHtml]
 */
export function couponGroupBadgesHtml(groups, emptyHtml = '') {
  const list = normalizeCouponGroups(groups);
  if (!list.length) return emptyHtml;
  return `<span class="cgf-badges">${list.map((g) => commerceGroupBadgeHtml(g)).join('')}</span>`;
}

export function couponGroupIconHtml() {
  return `<svg class="cgf-group-icon" viewBox="0 0 50 50" fill="none" aria-hidden="true" focusable="false">
    <g transform="translate(6 6) scale(.76)">
    <path d="M17 7h20a3 3 0 0 1 3 3v26a3 3 0 0 1-3 3H17a3 3 0 0 1-3-3V10a3 3 0 0 1 3-3Z" fill="#fff" stroke="currentColor" stroke-width="1.5" />
    <path d="M21 13h12M21 18h12M21 23h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    <path d="M10 12h20a3 3 0 0 1 3 3v26a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3V15a3 3 0 0 1 3-3Z" fill="#f3f0ff" stroke="currentColor" stroke-width="1.5" />
    <path d="M14 19h12M14 24h12M14 29h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    <path d="M5 19h20a3 3 0 0 1 3 3v19a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V22a3 3 0 0 1 3-3Z" fill="#e7defc" stroke="currentColor" stroke-width="1.5" />
    <path d="M10 26h10M10 31h10M10 36h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </g>
  </svg>`;
}

/**
 * @param {string} group
 * @param {number} count
 * @param {{ selected?: boolean; remove?: boolean }} [options]
 */
function couponGroupPillHtml(group, count, options = {}) {
  const selected = options.selected === true;
  const remove = options.remove === true;
  const action = remove ? 'data-cgf-remove' : 'data-cgf-toggle';
  return `<button type="button" class="ps-pill ps-pill-category ps-picker-pill cgf-group-pill${selected ? ' ps-pill-is-selected' : ''}" ${action}="${escapeHtml(group)}" aria-pressed="${selected ? 'true' : 'false'}" aria-label="${escapeHtml(`${selected ? 'Remove' : 'Select'} group ${group}, ${count} coupons`)}">
    ${couponGroupIconHtml()}
    <span class="ps-pill-text">
      <span class="ps-pill-label">${escapeHtml(group)}</span>
      <span class="ps-pill-meta">${count} ${count === 1 ? 'coupon' : 'coupons'}</span>
    </span>
    ${remove ? '<span class="ps-pill-remove" aria-hidden="true">&times;</span>' : ''}
  </button>`;
}

/**
 * @param {{
 *   title: string;
 *   groups: string[];
 *   selected: string[];
 *   counts: Map<string, number>;
 * }} options
 * @returns {Promise<string[] | null>}
 */
function openCouponGroupSelectorModal(options) {
  const selected = new Set(normalizeCouponGroups(options.selected));
  const groups = normalizeCouponGroups([...options.groups, ...selected]).sort(compareGroups);

  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'ps-modal-dialog cgf-selector-dialog';
    dialog.innerHTML = `
      <div class="ps-modal-inner">
        <h2 class="ps-modal-title"></h2>
        <div class="ps-modal-body">
          <div class="ps-root cgf-browser">
            <div class="ps-layout">
              <div class="ps-toolbar-row">
                <span class="ps-status" data-cgf-status aria-live="polite"></span>
                <button type="button" class="ps-clear-btn" data-cgf-clear>Clear all</button>
              </div>
              <section class="ps-panel ps-panel-selection" aria-label="Selected coupon groups">
                <div class="ps-pills" data-cgf-selection></div>
              </section>
              <section class="ps-panel ps-panel-picker" aria-label="Browse coupon groups">
                <input type="search" class="ps-search" data-cgf-search placeholder="Filter groups…" autocomplete="off" aria-label="Filter coupon groups" />
                <div class="ps-pills ps-picker-list" data-cgf-picker role="listbox" aria-label="Matching coupon groups"></div>
                <div class="cgf-create-row">
                  <input type="text" data-cgf-new-input placeholder="Add a new group…" aria-label="New coupon group" />
                  <button type="button" class="ps-modal-btn" data-cgf-add-new>Add group</button>
                </div>
              </section>
            </div>
          </div>
        </div>
        <div class="ps-modal-actions">
          <button type="button" class="ps-modal-btn" data-cgf-cancel>Cancel</button>
          <button type="button" class="ps-modal-btn ps-modal-btn-primary" data-cgf-apply>Apply</button>
        </div>
      </div>`;

    const titleEl = dialog.querySelector('.ps-modal-title');
    const searchEl = /** @type {HTMLInputElement | null} */ (dialog.querySelector('[data-cgf-search]'));
    const newInput = /** @type {HTMLInputElement | null} */ (dialog.querySelector('[data-cgf-new-input]'));
    const selectionEl = dialog.querySelector('[data-cgf-selection]');
    const pickerEl = dialog.querySelector('[data-cgf-picker]');
    const statusEl = dialog.querySelector('[data-cgf-status]');
    const clearBtn = dialog.querySelector('[data-cgf-clear]');
    if (titleEl) titleEl.textContent = options.title;

    let searchQuery = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(result);
    };
    const orderedSelection = () => [...selected].sort(compareGroups);
    const matchesSearch = (group) => !searchQuery
      || group.toLowerCase().includes(searchQuery.trim().toLowerCase());
    const countFor = (group) => options.counts.get(group) || 0;

    const renderAll = () => {
      if (selectionEl) {
        selectionEl.innerHTML = selected.size
          ? orderedSelection()
            .map((group) => couponGroupPillHtml(
              group,
              countFor(group),
              { selected: true, remove: true },
            ))
            .join('')
          : '<span class="ps-pills-empty">No groups selected.</span>';
      }
      if (pickerEl) {
        const available = groups.filter((group) => matchesSearch(group));
        pickerEl.innerHTML = available.length
          ? available.map((group) => couponGroupPillHtml(
            group,
            countFor(group),
            { selected: selected.has(group) },
          )).join('')
          : '<span class="ps-picker-empty">No groups match this search.</span>';
      }
      if (statusEl) statusEl.textContent = `${selected.size} selected / ${groups.length} available`;
      if (clearBtn instanceof HTMLButtonElement) clearBtn.disabled = selected.size === 0;
    };

    const toggle = (group) => {
      if (!group) return;
      if (selected.has(group)) selected.delete(group);
      else selected.add(group);
      renderAll();
    };

    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) {
        finish(null);
        return;
      }
      const target = event.target instanceof HTMLElement
        ? event.target.closest('[data-cgf-toggle], [data-cgf-remove]')
        : null;
      if (!target) return;
      toggle(target.getAttribute('data-cgf-toggle') || target.getAttribute('data-cgf-remove') || '');
    });
    searchEl?.addEventListener('input', () => {
      searchQuery = searchEl.value;
      renderAll();
    });
    dialog.querySelector('[data-cgf-add-new]')?.addEventListener('click', () => {
      const group = newInput?.value.trim() || '';
      if (!group) return;
      if (!groups.includes(group)) groups.push(group);
      selected.add(group);
      if (newInput) newInput.value = '';
      renderAll();
      newInput?.focus();
    });
    newInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      dialog.querySelector('[data-cgf-add-new]')?.dispatchEvent(new Event('click'));
    });
    clearBtn?.addEventListener('click', () => {
      selected.clear();
      renderAll();
    });
    dialog.querySelector('[data-cgf-cancel]')?.addEventListener('click', () => finish(null));
    dialog.querySelector('[data-cgf-apply]')?.addEventListener('click', () => finish(orderedSelection()));
    wireDialogEscapeDismiss(dialog, () => finish(null));

    renderAll();
    document.body.appendChild(dialog);
    dialog.showModal();
    searchEl?.focus();
  });
}

/**
 * Coupon group field. Keeps `input.value` as a JSON array so dialogs can track changes.
 * @param {Element | null} container
 * @param {HTMLInputElement | null} input
 * @param {{
 *   suggestions?: string[];
 *   label?: string;
 *   couponRows?: unknown[];
 *   browser?: boolean;
 * }} [options]
 */
export function mountCouponGroupsField(container, input, options = {}) {
  if (!(container instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return null;
  const label = options.label || 'groups';
  const suggestions = normalizeCouponGroups(options.suggestions || []).sort(compareGroups);
  const couponCounts = new Map();
  (Array.isArray(options.couponRows) ? options.couponRows : []).forEach((row) => {
    couponGroupsOf(row).forEach((group) => {
      couponCounts.set(group, (couponCounts.get(group) || 0) + 1);
    });
  });
  input.classList.add('psf-value-input');
  input.readOnly = true;
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');

  const read = () => {
    try {
      return normalizeCouponGroups(JSON.parse(input.value || '[]'));
    } catch {
      return [];
    }
  };
  let selected = read();
  const write = () => {
    input.value = selected.length ? JSON.stringify(selected) : '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const root = document.createElement('div');
  root.className = options.browser ? 'cgf-root cgf-browser-field' : 'cgf-root';
  root.innerHTML = options.browser ? `
    <div class="psf-display psf-display-editable" role="button" tabindex="0">
      <div class="ps-pills psf-pills" aria-live="polite"></div>
      <span class="psf-empty"></span>
    </div>` : `
    <div class="cgf-chips" aria-live="polite"></div>
    <input type="text" class="cgf-input" autocomplete="off" placeholder="Type to find or add a group…" aria-label="${escapeHtml(`Find or add ${label}`)}" />
    <div class="cgf-suggestions" role="group" aria-label="${escapeHtml(`Existing ${label}`)}"></div>`;
  if (options.browser) {
    const displayEl = root.querySelector('.psf-display');
    const pillsEl = root.querySelector('.psf-pills');
    const emptyEl = root.querySelector('.psf-empty');
    if (emptyEl) emptyEl.textContent = 'No groups — click to select groups.';
    container.replaceChildren(root);

    const renderBrowserDisplay = () => {
      const groups = read();
      if (!displayEl || !pillsEl || !emptyEl) return;
      if (!groups.length) {
        emptyEl.hidden = false;
        displayEl.classList.add('psf-display-empty');
        pillsEl.replaceChildren();
        return;
      }
      emptyEl.hidden = true;
      displayEl.classList.remove('psf-display-empty');
      pillsEl.innerHTML = groups.map((group) => {
        const count = couponCounts.get(group) || 0;
        return `<span class="ps-pill ps-pill-category cgf-group-pill">
          ${couponGroupIconHtml()}
          <span class="ps-pill-text">
            <span class="ps-pill-label">${escapeHtml(group)}</span>
            <span class="ps-pill-meta">${count} ${count === 1 ? 'coupon' : 'coupons'}</span>
          </span>
        </span>`;
      }).join('');
    };
    const openBrowser = async () => {
      const result = await openCouponGroupSelectorModal({
        title: label,
        groups: suggestions,
        selected: read(),
        counts: couponCounts,
      });
      if (!result) return;
      selected = normalizeCouponGroups(result);
      write();
      renderBrowserDisplay();
    };
    const showBrowserError = (error) => {
      showToast(error?.message || 'Could not open coupon group selection.', 'error');
    };
    const onKeydown = (/** @type {KeyboardEvent} */ event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openBrowser().catch(showBrowserError);
    };
    displayEl?.addEventListener('click', () => { openBrowser().catch(showBrowserError); });
    displayEl?.addEventListener('keydown', onKeydown);
    const onInput = () => {
      selected = read();
      renderBrowserDisplay();
    };
    input.addEventListener('input', onInput);
    renderBrowserDisplay();
    return {
      getValue: () => [...selected],
      setValue(list) {
        selected = normalizeCouponGroups(list);
        write();
        renderBrowserDisplay();
      },
      destroy() {
        input.removeEventListener('input', onInput);
      },
    };
  }
  const chipsEl = /** @type {HTMLElement} */ (root.querySelector('.cgf-chips'));
  const textEl = /** @type {HTMLInputElement} */ (root.querySelector('.cgf-input'));
  const suggestEl = /** @type {HTMLElement} */ (root.querySelector('.cgf-suggestions'));
  container.replaceChildren(root);

  const renderChips = () => {
    chipsEl.innerHTML = selected.length
      ? selected.map((g) => `<span class="cgf-chip">
          <span class="cgf-chip-label">${escapeHtml(g)}</span>
          <button type="button" class="cgf-chip-remove" data-cgf-remove="${escapeHtml(g)}" aria-label="${escapeHtml(`Remove group ${g}`)}">&times;</button>
        </span>`).join('')
      : '<span class="cgf-empty">No groups</span>';
  };

  const renderSuggestions = () => {
    const text = textEl.value.trim();
    const q = text.toLowerCase();
    const matches = suggestions
      .filter((g) => !selected.includes(g) && (!q || g.toLowerCase().includes(q)))
      .slice(0, SUGGESTION_LIMIT);
    const parts = matches.map((g) => `<button type="button" class="cgf-suggestion" data-cgf-add="${escapeHtml(g)}" aria-label="${escapeHtml(`Add group ${g}`)}">${escapeHtml(g)}</button>`);
    if (text && !suggestions.includes(text) && !selected.includes(text)) {
      parts.push(`<button type="button" class="cgf-suggestion cgf-add-new" data-cgf-add-new>Add “${escapeHtml(text)}”</button>`);
    }
    suggestEl.innerHTML = parts.join('');
    suggestEl.hidden = !parts.length;
  };

  const renderAll = () => {
    renderChips();
    renderSuggestions();
  };

  const add = (/** @type {string} */ raw) => {
    const g = String(raw || '').trim();
    if (!g) return;
    if (!selected.includes(g)) {
      selected = [...selected, g];
      write();
    }
    textEl.value = '';
    renderAll();
    textEl.focus();
  };

  root.addEventListener('click', (e) => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    const removeBtn = target?.closest('[data-cgf-remove]');
    if (removeBtn) {
      const g = removeBtn.getAttribute('data-cgf-remove') || '';
      selected = selected.filter((x) => x !== g);
      write();
      renderAll();
      textEl.focus();
      return;
    }
    const addBtn = target?.closest('[data-cgf-add]');
    if (addBtn) {
      add(addBtn.getAttribute('data-cgf-add') || '');
      return;
    }
    if (target?.closest('[data-cgf-add-new]')) add(textEl.value);
  });
  textEl.addEventListener('input', renderSuggestions);
  textEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const text = textEl.value.trim();
    if (suggestions.includes(text)) add(text);
  });
  const onExternalInput = () => {
    selected = read();
    renderAll();
  };
  input.addEventListener('change', onExternalInput);
  renderAll();

  return {
    getValue: () => [...selected],
    /** @param {string[]} list */
    setValue(list) {
      selected = normalizeCouponGroups(list);
      write();
      renderAll();
    },
    destroy() {
      input.removeEventListener('change', onExternalInput);
    },
  };
}
