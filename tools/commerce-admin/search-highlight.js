/* eslint-disable import/prefer-default-export -- single helper export */
/**
 * Search hit highlighting — same behavior as pim.js highlightMatch + .pim-highlight (pim.css).
 */

function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} text
 * @param {string} [query] - empty = no marks, only escaped text
 * @returns {string} safe HTML with optional <mark class="pim-highlight">
 */
export function highlightMatch(text, query) {
  const safe = escapeHtml(text);
  if (!query || !String(query).trim()) return safe;
  const re = new RegExp(escapeRegex(String(query).trim()), 'gi');
  return safe.replace(re, (match) => `<mark class="pim-highlight">${match}</mark>`);
}
