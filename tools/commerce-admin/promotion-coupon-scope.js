/**
 * Coupon scope on catalog promotions: `includedCouponTypes`, `excludedCouponTypes`,
 * `includedCouponGroups`, `excludedCouponGroups`. Pure helpers plus an inline coupon type picker.
 */
import { escapeHtml, showToast } from './commerce-otp-ui.js';
import {
  collectCouponGroups,
  couponGroupsOf,
  couponGroupIconHtml,
  normalizeCouponGroups,
} from './coupon-groups-field.js';
import { wireDialogEscapeDismiss } from './commerce-dialog-dismiss.js';

export const COUPON_SCOPE_FIELDS = /** @type {const} */ ([
  'includedCouponTypes',
  'excludedCouponTypes',
  'includedCouponGroups',
  'excludedCouponGroups',
]);

/** @typedef {Record<(typeof COUPON_SCOPE_FIELDS)[number], string[]>} CouponScope */
/** @typedef {'all' | 'block' | 'allow' | 'advanced'} CouponScopeMode */

const FIELD_LABELS = {
  includedCouponTypes: 'allowed coupon types',
  excludedCouponTypes: 'blocked coupon types',
  includedCouponGroups: 'allowed coupon groups',
  excludedCouponGroups: 'blocked coupon groups',
};

/** @returns {CouponScope} */
export function emptyCouponScope() {
  return {
    includedCouponTypes: [],
    excludedCouponTypes: [],
    includedCouponGroups: [],
    excludedCouponGroups: [],
  };
}

/**
 * @param {unknown} raw promotion or partial scope
 * @returns {CouponScope}
 */
export function couponScopeOf(raw) {
  const src = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  const out = emptyCouponScope();
  COUPON_SCOPE_FIELDS.forEach((f) => { out[f] = normalizeCouponGroups(src[f]); });
  return out;
}

/** @param {unknown} raw */
export function hasCouponScope(raw) {
  const s = couponScopeOf(raw);
  return COUPON_SCOPE_FIELDS.some((f) => s[f].length > 0);
}

/**
 * Simple mode for the form, or `advanced` when allow and block lists are both set.
 * @param {unknown} raw
 * @returns {CouponScopeMode}
 */
export function couponScopeMode(raw) {
  const s = couponScopeOf(raw);
  const allow = s.includedCouponTypes.length + s.includedCouponGroups.length > 0;
  const block = s.excludedCouponTypes.length + s.excludedCouponGroups.length > 0;
  if (allow && block) return 'advanced';
  if (allow) return 'allow';
  if (block) return 'block';
  return 'all';
}

/**
 * Keep only the lists the mode saves.
 * @param {CouponScopeMode} mode
 * @param {unknown} raw
 * @returns {CouponScope}
 */
export function couponScopeForMode(mode, raw) {
  const s = couponScopeOf(raw);
  const out = emptyCouponScope();
  if (mode === 'block' || mode === 'advanced') {
    out.excludedCouponTypes = s.excludedCouponTypes;
    out.excludedCouponGroups = s.excludedCouponGroups;
  }
  if (mode === 'allow' || mode === 'advanced') {
    out.includedCouponTypes = s.includedCouponTypes;
    out.includedCouponGroups = s.includedCouponGroups;
  }
  return out;
}

/**
 * Set non-empty lists and remove empty ones; every other key is kept.
 * @template {Record<string, unknown>} T
 * @param {T} promo
 * @param {unknown} scope
 * @returns {T}
 */
export function applyCouponScope(promo, scope) {
  const s = couponScopeOf(scope);
  const out = { ...promo };
  COUPON_SCOPE_FIELDS.forEach((f) => {
    if (s[f].length) out[f] = s[f];
    else delete out[f];
  });
  return out;
}

/** @param {string[]} groups @param {string[]} types */
function listText(groups, types) {
  return [...groups, ...types].join(', ');
}

/**
 * One-line policy, e.g. `Coupons: blocks affiliate`. Empty when every coupon is allowed.
 * @param {unknown} raw
 */
export function couponScopeSummary(raw) {
  const s = couponScopeOf(raw);
  const blocked = listText(s.excludedCouponGroups, s.excludedCouponTypes);
  const allowed = listText(s.includedCouponGroups, s.includedCouponTypes);
  const mode = couponScopeMode(s);
  if (mode === 'block') return `Coupons: blocks ${blocked}`;
  if (mode === 'allow') return `Coupons: only ${allowed}`;
  if (mode === 'advanced') return `Coupons: blocks ${blocked}; allows ${allowed}`;
  return '';
}

/** @param {unknown} raw promotion */
export function couponScopeTypeIds(raw) {
  const s = couponScopeOf(raw);
  return normalizeCouponGroups([...s.excludedCouponTypes, ...s.includedCouponTypes]);
}

/**
 * Type ids the API would reject on save: not in `knownIds` and not already stored on
 * `storedPromo` (the API tolerates ids a promotion already had).
 * @param {unknown} promo
 * @param {Iterable<string>} knownIds
 * @param {unknown} [storedPromo]
 */
export function missingCouponTypeIds(promo, knownIds, storedPromo) {
  const known = new Set(knownIds);
  const stored = new Set(couponScopeTypeIds(storedPromo));
  return couponScopeTypeIds(promo).filter((id) => !known.has(id) && !stored.has(id));
}

/**
 * @param {unknown} data `GET coupons/types` body
 * @returns {Record<string, unknown>[]}
 */
export function couponTypeRowsFromResponse(data) {
  if (Array.isArray(data)) return /** @type {Record<string, unknown>[]} */ (data);
  if (!data || typeof data !== 'object') return [];
  const obj = /** @type {Record<string, unknown>} */ (data);
  const key = ['types', 'items', 'data', 'results', 'coupons'].find((k) => Array.isArray(obj[k]));
  return key ? /** @type {Record<string, unknown>[]} */ (obj[key]) : [];
}

/** @param {unknown} row */
export function couponTypeIdOf(row) {
  const r = row && typeof row === 'object' ? /** @type {Record<string, unknown>} */ (row) : {};
  return String(r.id ?? r.typeId ?? '').trim();
}

/** @param {unknown} row */
export function couponTypeMarkets(row) {
  const r = row && typeof row === 'object' ? /** @type {Record<string, unknown>} */ (row) : {};
  const list = Array.isArray(r.countries) ? r.countries : [r.country];
  return list
    .map((c) => String(c ?? '').trim().toLowerCase())
    .filter(Boolean);
}

/**
 * A type with no `country` / `countries` is valid in every market.
 * @param {unknown} row
 * @param {string} market
 */
export function couponTypeInMarket(row, market) {
  const markets = couponTypeMarkets(row);
  return !markets.length || markets.includes(String(market || '').toLowerCase());
}

/**
 * One browser for coupon types and coupon groups in a promotion's allowed/blocked policy.
 * The two hidden inputs remain separate to match the catalog API.
 *
 * @param {Element | null} container
 * @param {HTMLInputElement | null} typesInput
 * @param {HTMLInputElement | null} groupsInput
 * @param {{
 *   types?: Record<string, unknown>[];
 *   couponRows?: unknown[];
 *   label?: string;
 * }} [options]
 */
export function mountCouponScopeBrowserField(container, typesInput, groupsInput, options = {}) {
  if (
    !(container instanceof HTMLElement)
    || !(typesInput instanceof HTMLInputElement)
    || !(groupsInput instanceof HTMLInputElement)
  ) return null;

  const label = options.label || 'Coupons';
  const types = options.types || [];
  const groups = collectCouponGroups(options.couponRows);
  const typeById = new Map(types.map((row) => [couponTypeIdOf(row), row]));
  const groupCounts = new Map();
  (Array.isArray(options.couponRows) ? options.couponRows : []).forEach((row) => {
    couponGroupsOf(row).forEach((group) => {
      groupCounts.set(group, (groupCounts.get(group) || 0) + 1);
    });
  });
  [typesInput, groupsInput].forEach((input) => {
    input.classList.add('psf-value-input');
    input.readOnly = true;
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
  });

  let selectedTypes = readCouponList(typesInput);
  let selectedGroups = readCouponList(groupsInput);
  const root = document.createElement('div');
  root.className = 'psf-root pcs-scope-root';
  root.innerHTML = `
    <div class="psf-display psf-display-editable" role="button" tabindex="0">
      <div class="ps-pills psf-pills" aria-live="polite"></div>
      <span class="psf-empty"></span>
    </div>`;
  const display = root.querySelector('.psf-display');
  const pills = root.querySelector('.ps-pills');
  const empty = root.querySelector('.psf-empty');
  if (empty) empty.textContent = `None — click to select ${label.toLowerCase()}.`;
  container.replaceChildren(root);

  const write = () => {
    typesInput.value = selectedTypes.length ? JSON.stringify(selectedTypes) : '';
    groupsInput.value = selectedGroups.length ? JSON.stringify(selectedGroups) : '';
    typesInput.dispatchEvent(new Event('input', { bubbles: true }));
    groupsInput.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const render = () => {
    if (!display || !pills || !empty) return;
    if (!selectedTypes.length && !selectedGroups.length) {
      empty.hidden = false;
      display.classList.add('psf-display-empty');
      pills.replaceChildren();
      return;
    }
    empty.hidden = true;
    display.classList.remove('psf-display-empty');
    pills.innerHTML = [
      ...selectedTypes.map((id) => couponTypePillHtml(id, typeById.get(id))),
      ...selectedGroups.map((group) => couponGroupPillHtml(group, groupCounts.get(group) || 0)),
    ].join('');
  };
  const openBrowser = async () => {
    const result = await openCouponScopeBrowser({
      label,
      types,
      groups,
      groupCounts,
      selectedTypes,
      selectedGroups,
    });
    if (!result) return;
    selectedTypes = result.types;
    selectedGroups = result.groups;
    write();
    render();
  };
  const handleOpenError = (error) => {
    showToast(error?.message || `Could not open ${label.toLowerCase()} selection.`, 'error');
  };
  const onKeydown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openBrowser().catch(handleOpenError);
  };
  display?.addEventListener('click', () => { openBrowser().catch(handleOpenError); });
  display?.addEventListener('keydown', onKeydown);
  render();
  return {
    destroy() {
      display?.removeEventListener('keydown', onKeydown);
      container.replaceChildren();
    },
  };
}

/** @param {HTMLInputElement} input */
function readCouponList(input) {
  try {
    return normalizeCouponGroups(JSON.parse(input.value || '[]'));
  } catch {
    return [];
  }
}

/** @param {string} id @param {Record<string, unknown> | undefined} row */
function couponTypePillHtml(id, row) {
  const name = String(row?.name ?? '').trim() || id;
  return `<span class="ps-pill ps-pill-category pcs-type-pill">
    ${couponIconHtml()}
    <span class="ps-pill-text">
      <span class="ps-pill-label">${escapeHtml(name)}</span>
      <span class="ps-pill-meta">${escapeHtml(id)}</span>
    </span>
  </span>`;
}

/** @param {string} group @param {number} count */
function couponGroupPillHtml(group, count) {
  return `<span class="ps-pill ps-pill-category cgf-group-pill pcs-group-pill">
    ${couponGroupIconHtml()}
    <span class="ps-pill-text">
      <span class="ps-pill-label">${escapeHtml(group)}</span>
      <span class="ps-pill-meta">${count} ${count === 1 ? 'coupon' : 'coupons'}</span>
    </span>
  </span>`;
}

function couponIconHtml() {
  return `<svg class="pcs-coupon-icon" viewBox="0 0 50 50" fill="none" aria-hidden="true" focusable="false">
    <circle cx="25" cy="25" r="24" fill="#e8f0fe" stroke="#c5d7f7" />
    <path d="M13 18a3 3 0 0 1 3-3h18a3 3 0 0 1 3 3v3a4 4 0 0 0 0 8v3a3 3 0 0 1-3 3H16a3 3 0 0 1-3-3v-3a4 4 0 0 0 0-8v-3Z" fill="#fff" stroke="#5879b5" stroke-width="1.5" />
    <path d="M25 17v2m0 3v2m0 3v2m0 3v2" stroke="#5879b5" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="1 1" />
    <path d="M18 22h3m-3 6h3m7-6h3m-3 6h3" stroke="#5879b5" stroke-width="1.5" stroke-linecap="round" />
  </svg>`;
}

/**
 * @param {{
 *   label: string;
 *   types: Record<string, unknown>[];
 *   groups: string[];
 *   groupCounts: Map<string, number>;
 *   selectedTypes: string[];
 *   selectedGroups: string[];
 * }} options
 * @returns {Promise<{ types: string[]; groups: string[] } | null>}
 */
function openCouponScopeBrowser(options) {
  const typeById = new Map(options.types.map((row) => [couponTypeIdOf(row), row]));
  const selectedTypes = new Set(options.selectedTypes);
  const selectedGroups = new Set(options.selectedGroups);
  const allItems = [
    ...[...typeById.keys()].filter(Boolean).map((id) => ({ kind: 'type', id })),
    ...options.groups.map((id) => ({ kind: 'group', id })),
  ];
  const known = new Set(allItems.map((item) => `${item.kind}:${item.id}`));
  [...selectedTypes].forEach((id) => {
    if (!known.has(`type:${id}`)) allItems.push({ kind: 'type', id });
  });
  [...selectedGroups].forEach((id) => {
    if (!known.has(`group:${id}`)) allItems.push({ kind: 'group', id });
  });

  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'ps-modal-dialog pcs-scope-selector-dialog';
    dialog.innerHTML = `
      <div class="ps-modal-inner">
        <h2 class="ps-modal-title"></h2>
        <div class="ps-modal-body">
          <div class="ps-root pcs-scope-browser">
            <div class="ps-layout">
              <div class="ps-toolbar-row">
                <span class="ps-status" data-pcs-scope-status aria-live="polite"></span>
                <button type="button" class="ps-clear-btn" data-pcs-scope-clear>Clear all</button>
              </div>
              <section class="ps-panel ps-panel-selection" aria-label="Selected coupons and groups">
                <div class="ps-pills" data-pcs-scope-selection></div>
              </section>
              <section class="ps-panel ps-panel-picker" aria-label="Browse coupons and groups">
                <div class="pcs-scope-filters" role="group" aria-label="Filter by item type">
                  <button type="button" data-pcs-scope-filter="all" aria-pressed="true">All</button>
                  <button type="button" data-pcs-scope-filter="type" aria-pressed="false">Coupons</button>
                  <button type="button" data-pcs-scope-filter="group" aria-pressed="false">Groups</button>
                </div>
                <input type="search" class="ps-search" data-pcs-scope-search placeholder="Filter coupons and groups…" autocomplete="off" aria-label="Filter coupons and groups" />
                <div class="ps-pills ps-picker-list" data-pcs-scope-picker role="listbox" aria-label="Matching coupons and groups"></div>
              </section>
            </div>
          </div>
        </div>
        <div class="ps-modal-actions">
          <button type="button" class="ps-modal-btn" data-pcs-scope-cancel>Cancel</button>
          <button type="button" class="ps-modal-btn ps-modal-btn-primary" data-pcs-scope-apply>Apply</button>
        </div>
      </div>`;
    const title = dialog.querySelector('.ps-modal-title');
    const status = dialog.querySelector('[data-pcs-scope-status]');
    const clear = dialog.querySelector('[data-pcs-scope-clear]');
    const search = /** @type {HTMLInputElement | null} */ (dialog.querySelector('[data-pcs-scope-search]'));
    const selection = dialog.querySelector('[data-pcs-scope-selection]');
    const picker = dialog.querySelector('[data-pcs-scope-picker]');
    if (title) title.textContent = options.label;
    let activeFilter = 'all';
    let query = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(result);
    };
    const isSelected = (item) => {
      if (item.kind === 'type') return selectedTypes.has(item.id);
      return selectedGroups.has(item.id);
    };
    const nameOf = (item) => {
      if (item.kind !== 'type') return item.id;
      return String(typeById.get(item.id)?.name ?? '').trim() || item.id;
    };
    const sortItems = (items) => items.slice().sort((a, b) => compareText(
      `${nameOf(a)} ${a.id}`,
      `${nameOf(b)} ${b.id}`,
    ));
    const matches = (item) => (activeFilter === 'all' || activeFilter === item.kind)
      && `${nameOf(item)} ${item.id}`.toLowerCase().includes(query.trim().toLowerCase());
    const itemMarkup = (item, removable = false) => {
      const selected = isSelected(item);
      const action = removable ? 'data-pcs-scope-remove' : 'data-pcs-scope-toggle';
      const icon = item.kind === 'type' ? couponIconHtml() : couponGroupIconHtml();
      const meta = item.kind === 'type'
        ? item.id
        : `${options.groupCounts.get(item.id) || 0} ${options.groupCounts.get(item.id) === 1 ? 'coupon' : 'coupons'}`;
      return `<button type="button" class="ps-pill ps-picker-pill pcs-scope-item${item.kind === 'type' ? ' pcs-scope-coupon' : ' pcs-scope-group'}${selected ? ' ps-pill-is-selected' : ''}" ${action}="${escapeHtml(item.kind)}" data-value="${escapeHtml(item.id)}" aria-pressed="${selected}">
        ${icon}<span class="ps-pill-text"><span class="ps-pill-label">${escapeHtml(nameOf(item))}</span><span class="ps-pill-meta">${escapeHtml(meta)}</span></span>
        ${removable ? '<span class="ps-pill-remove" aria-hidden="true">&times;</span>' : ''}
      </button>`;
    };
    const render = () => {
      const selectedItems = allItems.filter(isSelected);
      if (selection) {
        selection.innerHTML = selectedItems.length
          ? sortItems(selectedItems).map((item) => itemMarkup(item, true)).join('')
          : '<span class="ps-pills-empty">Nothing selected yet — pick coupons or groups below.</span>';
      }
      if (picker) {
        const visibleItems = sortItems(allItems.filter(matches));
        picker.innerHTML = visibleItems.length
          ? visibleItems.map((item) => itemMarkup(item)).join('')
          : '<span class="ps-picker-empty">No coupons or groups match this search.</span>';
      }
      if (status) status.textContent = `${selectedItems.length} selected / ${allItems.length} available`;
      if (clear instanceof HTMLButtonElement) clear.disabled = selectedItems.length === 0;
    };
    dialog.addEventListener('click', (event) => {
      const target = event.target instanceof Element
        ? event.target.closest('[data-pcs-scope-toggle], [data-pcs-scope-remove]')
        : null;
      if (target) {
        const kind = target.getAttribute('data-pcs-scope-toggle')
          || target.getAttribute('data-pcs-scope-remove');
        const id = target.getAttribute('data-value') || '';
        const set = kind === 'type' ? selectedTypes : selectedGroups;
        if (set.has(id)) set.delete(id);
        else set.add(id);
        render();
        return;
      }
      const filter = event.target instanceof Element
        ? event.target.closest('[data-pcs-scope-filter]')
        : null;
      if (filter) {
        activeFilter = filter.getAttribute('data-pcs-scope-filter') || 'all';
        dialog.querySelectorAll('[data-pcs-scope-filter]').forEach((button) => {
          button.setAttribute('aria-pressed', String(button === filter));
        });
        render();
        return;
      }
      if (event.target === dialog) finish(null);
    });
    search?.addEventListener('input', () => {
      query = search.value;
      render();
    });
    clear?.addEventListener('click', () => {
      selectedTypes.clear();
      selectedGroups.clear();
      render();
    });
    dialog.querySelector('[data-pcs-scope-cancel]')?.addEventListener('click', () => finish(null));
    dialog.querySelector('[data-pcs-scope-apply]')?.addEventListener('click', () => finish({
      types: sortItems([...selectedTypes].map((id) => ({ kind: 'type', id }))).map((item) => item.id),
      groups: sortItems([...selectedGroups].map((id) => ({ kind: 'group', id }))).map((item) => item.id),
    }));
    wireDialogEscapeDismiss(dialog, () => finish(null));
    render();
    document.body.appendChild(dialog);
    dialog.showModal();
    search?.focus();
  });
}

/**
 * Turn helix validation errors (`$.promotions[i].field`) into readable lines.
 * @param {Array<{ path?: string, message?: string }>} errors
 * @param {Array<{ id?: string, name?: string }>} promotions the submitted document
 */
export function describeCatalogSaveErrors(errors, promotions) {
  return (Array.isArray(errors) ? errors : []).map((e) => {
    const path = String(e?.path || '');
    const message = String(e?.message || '').trim();
    const m = path.match(/^\$\.promotions\[(\d+)\](?:\.(\w+))?/);
    if (!m) return [path, message].filter(Boolean).join(': ');
    const promo = promotions?.[Number(m[1])];
    const who = promo ? `"${promo.name || promo.id}"` : `promotion ${Number(m[1]) + 1}`;
    const field = m[2] && FIELD_LABELS[m[2]];
    if (field && /conditional/.test(message)) {
      return `${who}: ${field} aren't allowed on a promotion with conditions`;
    }
    return `${who}: ${field || m[2] || 'promotion'}: ${message}`;
  });
}

/** @param {string} a @param {string} b */
function compareText(a, b) {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

/**
 * Inline coupon type picker. Keeps `input.value` as a JSON array of type ids.
 * Ids not in `types` stay as chips marked unknown (when the list loaded).
 * @param {Element | null} container
 * @param {HTMLInputElement | null} input
 * @param {{
 *   types?: Record<string, unknown>[],
 *   typesLoaded?: boolean,
 *   getMarket?: () => string,
 *   label?: string,
 * }} [options]
 */
export function mountCouponTypesField(container, input, options = {}) {
  if (!(container instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return null;
  const label = options.label || 'coupon types';
  const typesLoaded = options.typesLoaded !== false;
  const getMarket = options.getMarket || (() => '');
  /** @type {Map<string, Record<string, unknown>>} */
  const byId = new Map();
  (options.types || []).forEach((row) => {
    const id = couponTypeIdOf(row);
    if (id && !byId.has(id)) byId.set(id, row);
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
  root.className = 'cgf-root pcs-types-root';
  root.innerHTML = `
    <div class="cgf-chips" aria-live="polite"></div>
    <input type="text" class="cgf-input" autocomplete="off" placeholder="Type to find a coupon type…" aria-label="${escapeHtml(`Find ${label}`)}" />
    <div class="cgf-suggestions" role="group" aria-label="${escapeHtml(`Available ${label}`)}"></div>`;
  const chipsEl = /** @type {HTMLElement} */ (root.querySelector('.cgf-chips'));
  const textEl = /** @type {HTMLInputElement} */ (root.querySelector('.cgf-input'));
  const suggestEl = /** @type {HTMLElement} */ (root.querySelector('.cgf-suggestions'));
  container.replaceChildren(root);

  const nameOf = (id) => String(byId.get(id)?.name ?? '').trim();

  const renderChips = () => {
    chipsEl.innerHTML = selected.length
      ? selected.map((id) => {
        const unknown = typesLoaded && !byId.has(id);
        const name = nameOf(id);
        return `<span class="cgf-chip${unknown ? ' pcs-chip-unknown' : ''}" data-pcs-type="${escapeHtml(id)}"${name ? ` title="${escapeHtml(name)}"` : ''}>
          <span class="cgf-chip-label">${escapeHtml(id)}</span>${unknown ? ' <span class="pcs-unknown-tag">unknown</span>' : ''}
          <button type="button" class="cgf-chip-remove" data-pcs-remove="${escapeHtml(id)}" aria-label="${escapeHtml(`Remove coupon type ${id}`)}">&times;</button>
        </span>`;
      }).join('')
      : '<span class="cgf-empty">No coupon types</span>';
  };

  const renderSuggestions = () => {
    const q = textEl.value.trim().toLowerCase();
    const market = getMarket();
    const rows = [...byId.entries()]
      .filter(([id]) => !selected.includes(id))
      .filter(([id, row]) => !q || id.toLowerCase().includes(q)
        || String(row.name ?? '').toLowerCase().includes(q))
      .map(([id, row]) => ({ id, row, inMarket: couponTypeInMarket(row, market) }))
      .sort((a, b) => Number(b.inMarket) - Number(a.inMarket) || compareText(a.id, b.id))
      .slice(0, 40);
    suggestEl.innerHTML = rows.map(({ id, row, inMarket }) => {
      const name = String(row.name ?? '').trim();
      return `<button type="button" class="cgf-suggestion${inMarket ? '' : ' pcs-other-market'}" data-pcs-add="${escapeHtml(id)}" aria-label="${escapeHtml(`Add coupon type ${id}`)}"${name ? ` title="${escapeHtml(name)}"` : ''}>${escapeHtml(id)}</button>`;
    }).join('');
    suggestEl.hidden = !rows.length;
  };

  const renderAll = () => {
    renderChips();
    renderSuggestions();
  };

  root.addEventListener('click', (e) => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    const removeBtn = target?.closest('[data-pcs-remove]');
    if (removeBtn) {
      const id = removeBtn.getAttribute('data-pcs-remove') || '';
      selected = selected.filter((x) => x !== id);
      write();
      renderAll();
      textEl.focus();
      return;
    }
    const addBtn = target?.closest('[data-pcs-add]');
    if (addBtn) {
      const id = addBtn.getAttribute('data-pcs-add') || '';
      if (id && !selected.includes(id)) {
        selected = [...selected, id];
        write();
      }
      textEl.value = '';
      renderAll();
      textEl.focus();
    }
  });
  textEl.addEventListener('input', renderSuggestions);
  textEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const text = textEl.value.trim();
    if (byId.has(text) && !selected.includes(text)) {
      selected = [...selected, text];
      write();
      textEl.value = '';
      renderAll();
    }
  });
  renderAll();

  return {
    getValue: () => [...selected],
    refresh: renderSuggestions,
  };
}
