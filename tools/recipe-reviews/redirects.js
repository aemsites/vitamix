/**
 * Recipe Redirect Generator — maps 404 recipe paths to index matches.
 */

import {
  filterRecipeIndexRows,
  resolveRecipeRedirect,
} from './recipe-redirect.js';
import requireAuth from './auth.js';

/** @type {Array<{ source: string, destination: string, count: number, score: number }>} */
let lastResults = [];

const indexCache = new Map();

/**
 * @param {string} locale
 * @param {string} language
 * @returns {Promise<Object[]>}
 */
async function fetchRecipeIndex(locale, language) {
  const key = `${locale}/${language}`;
  if (indexCache.has(key)) return indexCache.get(key);

  const indexUrl = `/${locale}/${language}/recipes/query-index.json`;
  let resp;
  try {
    resp = await fetch(indexUrl);
  } catch {
    indexCache.set(key, []);
    return [];
  }

  if (!resp.ok) {
    indexCache.set(key, []);
    return [];
  }

  let payload;
  try {
    payload = await resp.json();
  } catch {
    indexCache.set(key, []);
    return [];
  }

  const recipes = filterRecipeIndexRows(payload);
  indexCache.set(key, recipes);
  return recipes;
}

/**
 * @param {string} line
 * @returns {{ path: string, count: number } | null}
 */
function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (/^value(\t|\s)/i.test(trimmed) && /count/i.test(trimmed)) return null;

  const cols = trimmed.split('\t');
  let path = (cols[0] || '').trim();
  if (!path.startsWith('/')) return null;

  [path] = path.split('?');
  [path] = path.split('#');
  if (!/\/recipes\//i.test(path)) return null;

  const count = cols[1] ? parseInt(cols[1], 10) : 0;
  return { path, count: Number.isNaN(count) ? 0 : count };
}

/**
 * @param {string} text
 * @returns {Map<string, number>}
 */
function parsePathsFromPaste(text) {
  const byPath = new Map();

  text.split('\n').forEach((line) => {
    const parsed = parseLine(line);
    if (!parsed) return;
    const existing = byPath.get(parsed.path) || 0;
    byPath.set(parsed.path, existing + (parsed.count || 1));
  });

  return byPath;
}

/**
 * @param {string} pathname
 * @returns {{ locale: string, language: string }}
 */
function parseLocaleFromPath(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  return {
    locale: parts[0] || 'us',
    language: parts[1] || 'en_us',
  };
}

/**
 * @param {string} pathname
 * @returns {boolean}
 */
function shouldSkipPath(pathname) {
  const last = pathname.split('/').filter(Boolean).pop() || '';
  const lower = last.toLowerCase();
  if (!lower || lower === 'recipes' || lower === 'null') return true;
  if (lower.endsWith('.json') || lower.endsWith('.data.json')) return true;
  return false;
}

/**
 * @param {number} score
 * @returns {string}
 */
function matchLabel(score) {
  if (score === 3) return 'exact';
  if (score === 2) return 'base';
  return 'prefix';
}

/**
 * @param {Map<string, number>} pathCounts
 * @returns {Promise<{ redirects: typeof lastResults, unmatched: string[], skipped: number }>}
 */
async function buildRedirects(pathCounts) {
  const redirects = [];
  const unmatched = [];
  let skipped = 0;

  const localeGroups = new Map();
  pathCounts.forEach((count, path) => {
    if (shouldSkipPath(path)) {
      skipped += 1;
      return;
    }
    const { locale, language } = parseLocaleFromPath(path);
    const key = `${locale}/${language}`;
    if (!localeGroups.has(key)) localeGroups.set(key, []);
    localeGroups.get(key).push({ path, count });
  });

  await Promise.all([...localeGroups.entries()].map(async ([key, entries]) => {
    const [locale, language] = key.split('/');
    const recipes = await fetchRecipeIndex(locale, language);

    entries.forEach(({ path, count }) => {
      const match = resolveRecipeRedirect(path, recipes);
      if (match) {
        redirects.push({
          source: path,
          destination: match.destination,
          count,
          score: match.score,
        });
      } else {
        unmatched.push(path);
      }
    });
  }));

  redirects.sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
  unmatched.sort((a, b) => (pathCounts.get(b) || 0) - (pathCounts.get(a) || 0));

  return { redirects, unmatched, skipped };
}

/**
 * @param {typeof lastResults} rows
 */
function renderTable(rows) {
  const tbody = document.getElementById('results-body');
  tbody.innerHTML = '';

  rows.forEach((row) => {
    const tr = document.createElement('tr');

    const sourceTd = document.createElement('td');
    sourceTd.className = 'path-cell';
    sourceTd.textContent = row.source;

    const destTd = document.createElement('td');
    destTd.className = 'path-cell';
    destTd.textContent = row.destination;

    const countTd = document.createElement('td');
    countTd.textContent = String(row.count);

    const matchTd = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `match-badge ${matchLabel(row.score)}`;
    badge.textContent = matchLabel(row.score);
    matchTd.appendChild(badge);

    tr.append(sourceTd, destTd, countTd, matchTd);
    tbody.appendChild(tr);
  });
}

/**
 * @param {string} message
 * @param {'loading' | 'error'} type
 */
function showStatus(message, type) {
  const el = document.getElementById('status');
  el.hidden = false;
  el.className = `status ${type}`;
  el.textContent = message;
}

function hideStatus() {
  const el = document.getElementById('status');
  el.hidden = true;
  el.textContent = '';
}

/**
 * @param {string} text
 */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    // eslint-disable-next-line no-alert
    alert('Copied to clipboard.');
  } catch {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recipe-redirects.tsv';
    a.click();
    URL.revokeObjectURL(url);
  }
}

async function handleGenerate() {
  const input = document.getElementById('path-input');
  const generateBtn = document.getElementById('generate-btn');
  const text = input.value.trim();

  if (!text) {
    // eslint-disable-next-line no-alert
    alert('Paste at least one path.');
    return;
  }

  generateBtn.disabled = true;
  showStatus('Loading recipe indexes and matching paths…', 'loading');

  try {
    indexCache.clear();
    const pathCounts = parsePathsFromPaste(text);
    const recipePathCount = pathCounts.size;

    if (recipePathCount === 0) {
      hideStatus();
      // eslint-disable-next-line no-alert
      alert('No /recipes/ paths found in the pasted text.');
      return;
    }

    const { redirects, unmatched, skipped } = await buildRedirects(pathCounts);
    lastResults = redirects;

    document.getElementById('stat-paths').textContent = String(recipePathCount);
    document.getElementById('stat-redirects').textContent = String(redirects.length);
    document.getElementById('stat-unmatched').textContent = String(unmatched.length);
    document.getElementById('stat-skipped').textContent = String(skipped);
    document.getElementById('stats').hidden = false;

    renderTable(redirects);
    document.getElementById('results-section').hidden = redirects.length === 0;

    const unmatchedNote = document.getElementById('unmatched-note');
    if (unmatched.length > 0) {
      unmatchedNote.hidden = false;
      unmatchedNote.textContent = `${unmatched.length} path(s) had no index match (null, .json, and same-path rows are skipped).`;
    } else {
      unmatchedNote.hidden = true;
    }

    hideStatus();
  } catch (error) {
    showStatus(`Failed to generate redirects: ${error.message}`, 'error');
  } finally {
    generateBtn.disabled = false;
  }
}

function handleClear() {
  document.getElementById('path-input').value = '';
  document.getElementById('stats').hidden = true;
  document.getElementById('results-section').hidden = true;
  document.getElementById('unmatched-note').hidden = true;
  document.getElementById('results-body').innerHTML = '';
  hideStatus();
  lastResults = [];
}

async function init() {
  await requireAuth();

  document.getElementById('generate-btn').addEventListener('click', handleGenerate);
  document.getElementById('clear-btn').addEventListener('click', handleClear);

  document.getElementById('copy-tsv-btn').addEventListener('click', () => {
    if (lastResults.length === 0) return;
    const lines = ['Source\tDestination', ...lastResults.map((r) => `${r.source}\t${r.destination}`)];
    copyText(lines.join('\n'));
  });

  document.getElementById('copy-sources-btn').addEventListener('click', () => {
    if (lastResults.length === 0) return;
    copyText(lastResults.map((r) => r.source).join('\n'));
  });

  document.getElementById('copy-destinations-btn').addEventListener('click', () => {
    if (lastResults.length === 0) return;
    copyText(lastResults.map((r) => r.destination).join('\n'));
  });
}

init();
