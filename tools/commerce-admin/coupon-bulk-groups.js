/**
 * Bulk group edits for coupon types: pure helpers for the coupons page "Edit all" dialog.
 */
import { couponGroupsOf, normalizeCouponGroups } from './coupon-groups-field.js';

/**
 * Groups typed as text: separated by commas or new lines, normalized like the API.
 * @param {unknown} text
 * @returns {string[]}
 */
export function parseCouponGroupList(text) {
  return normalizeCouponGroups(String(text ?? '').split(/[,\n\r]+/));
}

/**
 * Same set of groups; order and duplicates ignored.
 * @param {unknown} a
 * @param {unknown} b
 */
export function sameCouponGroupSet(a, b) {
  const sa = new Set(normalizeCouponGroups(a));
  const sb = new Set(normalizeCouponGroups(b));
  if (sa.size !== sb.size) return false;
  return [...sa].every((g) => sb.has(g));
}

/**
 * Groups shared by every row when all rows have the same set, else null.
 * @param {unknown[]} rows coupon types
 * @returns {string[] | null}
 */
export function sharedCouponGroupSet(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return [];
  const first = couponGroupsOf(list[0]);
  return list.every((row) => sameCouponGroupSet(couponGroupsOf(row), first)) ? first : null;
}

/**
 * Group usage across rows, most used first.
 * @param {unknown[]} rows coupon types
 * @returns {{ group: string; count: number }[]}
 */
export function couponGroupCounts(rows) {
  const counts = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    couponGroupsOf(row).forEach((g) => counts.set(g, (counts.get(g) || 0) + 1));
  });
  return [...counts.entries()]
    .map(([group, count]) => ({ group, count }))
    .sort((a, b) => b.count - a.count || a.group.localeCompare(b.group));
}

/**
 * @typedef {object} CouponBulkGroupEdit
 * @property {string[] | null} [replace] new list for every coupon, or null to keep
 * @property {string[]} [add]
 * @property {string[]} [remove]
 */

/**
 * Normalized edit plus a validation error ('' when valid).
 * @param {CouponBulkGroupEdit} edit
 * @returns {{ edit: Required<CouponBulkGroupEdit>; error: string }}
 */
export function normalizeCouponBulkGroupEdit(edit = {}) {
  const replace = Array.isArray(edit.replace) ? normalizeCouponGroups(edit.replace) : null;
  const add = normalizeCouponGroups(edit.add);
  const remove = normalizeCouponGroups(edit.remove);
  const both = add.filter((g) => remove.includes(g));
  const error = both.length
    ? `Both added and removed: ${both.join(', ')}`
    : '';
  return { edit: { replace, add, remove }, error };
}

/**
 * Groups after the edit: replace, then add (appended), then remove.
 * @param {unknown} current
 * @param {CouponBulkGroupEdit} edit
 * @returns {string[]}
 */
export function applyCouponBulkGroupEdit(current, edit = {}) {
  let next = Array.isArray(edit.replace)
    ? normalizeCouponGroups(edit.replace)
    : normalizeCouponGroups(current);
  next = normalizeCouponGroups([...next, ...normalizeCouponGroups(edit.add)]);
  const remove = new Set(normalizeCouponGroups(edit.remove));
  return next.filter((g) => !remove.has(g));
}

/**
 * Per-coupon before/after; rows whose set of groups would not change are only counted.
 * @param {{ id: string; row: unknown }[]} items
 * @param {CouponBulkGroupEdit} edit
 */
export function planCouponBulkGroupEdit(items, edit) {
  /** @type {{ id: string; before: string[]; after: string[] }[]} */
  const changes = [];
  /** @type {string[]} */
  const unchanged = [];
  (Array.isArray(items) ? items : []).forEach(({ id, row }) => {
    const before = couponGroupsOf(row);
    const after = applyCouponBulkGroupEdit(before, edit);
    if (sameCouponGroupSet(before, after)) unchanged.push(id);
    else changes.push({ id, before, after });
  });
  return { changes, unchanged };
}

/**
 * Header checkbox state for the visible rows.
 * @param {string[]} visibleIds
 * @param {Set<string>} selected
 * @returns {'checked' | 'indeterminate' | 'unchecked'}
 */
export function couponSelectAllState(visibleIds, selected) {
  const n = visibleIds.filter((id) => selected.has(id)).length;
  if (!n) return 'unchecked';
  return n === visibleIds.length ? 'checked' : 'indeterminate';
}

/**
 * Runs `fn` over `items` with at most `limit` calls in flight; never rejects.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} fn
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<({ item: T; ok: true; value: R } | { item: T; ok: false; error: unknown })[]>}
 */
export async function mapWithConcurrency(items, limit, fn, onProgress) {
  const results = new Array(items.length);
  let index = 0;
  let done = 0;
  const worker = async () => {
    while (index < items.length) {
      const i = index;
      index += 1;
      const item = items[i];
      try {
        // eslint-disable-next-line no-await-in-loop -- bounded worker pool
        results[i] = { item, ok: true, value: await fn(item) };
      } catch (error) {
        results[i] = { item, ok: false, error };
      }
      done += 1;
      onProgress?.(done, items.length);
    }
  };
  const size = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: size }, () => worker()));
  return results;
}
