/**
 * Tiny dependency-free JSON diff for the "Promote to Production" confirm dialog. Renders the
 * staging→production change as a line diff over stable (key-sorted) pretty JSON.
 */

import { escapeHtml } from './commerce-otp-ui.js';

/**
 * Deep clone with **sorted object keys** and optional key omission, so two logically-equal objects
 * always stringify identically (the diff shows only real changes, not key-order noise).
 *
 * @param {unknown} value
 * @param {Set<string>|string[]} [omitKeys] keys to drop at any depth (e.g. volatile metadata)
 * @returns {unknown}
 */
function sortedClone(value, omitKeys) {
  const omit = omitKeys instanceof Set ? omitKeys : new Set(omitKeys || []);
  if (Array.isArray(value)) return value.map((v) => sortedClone(v, omit));
  if (value && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    Object.keys(value).sort().forEach((k) => {
      if (omit.has(k)) return;
      out[k] = sortedClone(/** @type {Record<string, unknown>} */ (value)[k], omit);
    });
    return out;
  }
  return value;
}

/**
 * Pretty JSON with sorted keys and omitted keys removed.
 *
 * @param {unknown} value
 * @param {Set<string>|string[]} [omitKeys]
 * @returns {string}
 */
export function stableStringify(value, omitKeys) {
  if (value === null || value === undefined) return '';
  return JSON.stringify(sortedClone(value, omitKeys), null, 2);
}

/**
 * @typedef {{ type: 'add'|'del'|'same', text: string }} JsonDiffLine
 */

/**
 * Line diff between two objects (each stable-stringified first). Classic LCS over lines.
 *
 * @param {unknown} before
 * @param {unknown} after
 * @param {Set<string>|string[]} [omitKeys]
 * @returns {JsonDiffLine[]}
 */
export function jsonDiffLines(before, after, omitKeys) {
  const a = stableStringify(before, omitKeys).split('\n');
  const b = stableStringify(after, omitKeys).split('\n');
  // Trim trailing empty line from empty inputs so an absent side yields no phantom row.
  const aLines = a.length === 1 && a[0] === '' ? [] : a;
  const bLines = b.length === 1 && b[0] === '' ? [] : b;

  const n = aLines.length;
  const m = bLines.length;
  // lcs[i][j] = length of LCS of aLines[i..] and bLines[j..]
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = aLines[i] === bLines[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  /** @type {JsonDiffLine[]} */
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      out.push({ type: 'same', text: aLines[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: 'del', text: aLines[i] });
      i += 1;
    } else {
      out.push({ type: 'add', text: bLines[j] });
      j += 1;
    }
  }
  while (i < n) { out.push({ type: 'del', text: aLines[i] }); i += 1; }
  while (j < m) { out.push({ type: 'add', text: bLines[j] }); j += 1; }
  return out;
}

/** @param {JsonDiffLine['type']} type */
function diffSign(type) {
  if (type === 'add') return '+';
  if (type === 'del') return '-';
  return ' ';
}

/**
 * Render diff lines as HTML (add = green, del = red, same = muted context).
 *
 * @param {JsonDiffLine[]} lines
 * @returns {string}
 */
export function renderJsonDiffHtml(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return '<pre class="cjd-diff cjd-empty">No differences.</pre>';
  }
  const body = lines.map((l) => (
    `<div class="cjd-line cjd-${l.type}"><span class="cjd-sign" aria-hidden="true">${diffSign(l.type)}</span><span class="cjd-text">${escapeHtml(l.text)}</span></div>`
  )).join('');
  return `<div class="cjd-diff" role="group" aria-label="JSON differences">${body}</div>`;
}

/**
 * True when two values are equal after stable-stringify + key omission (i.e. no meaningful diff).
 *
 * @param {unknown} before
 * @param {unknown} after
 * @param {Set<string>|string[]} [omitKeys]
 * @returns {boolean}
 */
export function jsonEqual(before, after, omitKeys) {
  return stableStringify(before, omitKeys) === stableStringify(after, omitKeys);
}
