/**
 * Coupon type groups: free-form labels on a coupon type (`groups: string[]`).
 * Pure helpers plus an inline chip picker shared by the coupons and promotions pages.
 */
import { commerceGroupBadgeHtml, escapeHtml } from './commerce-otp-ui.js';

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

/**
 * Inline groups picker. Keeps `input.value` as a JSON array so dialogs can track changes.
 * @param {Element | null} container
 * @param {HTMLInputElement | null} input
 * @param {{ suggestions?: string[]; label?: string }} [options]
 */
export function mountCouponGroupsField(container, input, options = {}) {
  if (!(container instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return null;
  const label = options.label || 'groups';
  const suggestions = normalizeCouponGroups(options.suggestions || []).sort(compareGroups);
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

  const root = document.createElement('div');
  root.className = 'cgf-root';
  root.innerHTML = `
    <div class="cgf-chips" aria-live="polite"></div>
    <input type="text" class="cgf-input" autocomplete="off" placeholder="Type to find or add a group…" aria-label="${escapeHtml(`Find or add ${label}`)}" />
    <div class="cgf-suggestions" role="group" aria-label="${escapeHtml(`Existing ${label}`)}"></div>`;
  const chipsEl = /** @type {HTMLElement} */ (root.querySelector('.cgf-chips'));
  const textEl = /** @type {HTMLInputElement} */ (root.querySelector('.cgf-input'));
  const suggestEl = /** @type {HTMLElement} */ (root.querySelector('.cgf-suggestions'));
  container.replaceChildren(root);

  const write = () => {
    input.value = selected.length ? JSON.stringify(selected) : '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

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
