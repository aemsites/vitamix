/**
 * Coupon scope on catalog promotions: `includedCouponTypes`, `excludedCouponTypes`,
 * `includedCouponGroups`, `excludedCouponGroups`. Pure helpers plus an inline coupon type picker.
 */
import { escapeHtml } from './commerce-otp-ui.js';
import { normalizeCouponGroups } from './coupon-groups-field.js';

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

  const write = () => {
    input.value = selected.length ? JSON.stringify(selected) : '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

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
