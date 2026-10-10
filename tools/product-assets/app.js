/* eslint-disable no-await-in-loop */

// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import loadColorSwatches from '../../scripts/color-swatches.js';
import {
  PRODUCTS_PATH, buildSwatch, colorLabel, createClient, el, groupByColor, plural, toSlug,
} from './shared.js';

const MAX_IMAGES = 5;
const CONCURRENCY = 6;

/** Renders `text` into `node`, wrapping case-insensitive matches of `query` in <mark>. */
function highlight(node, text, query) {
  node.replaceChildren();
  if (!query) {
    node.textContent = text;
    return;
  }
  const lower = text.toLowerCase();
  let from = 0;
  let at = lower.indexOf(query, from);
  while (at !== -1) {
    if (at > from) node.append(text.slice(from, at));
    node.append(el('mark', null, text.slice(at, at + query.length)));
    from = at + query.length;
    at = lower.indexOf(query, from);
  }
  if (from < text.length) node.append(text.slice(from));
}

(async function init() {
  const search = document.querySelector('.app-search input');
  const summary = document.querySelector('.app-summary');
  const errorEl = document.querySelector('.app-error');
  const table = document.querySelector('.app-table');
  const empty = document.querySelector('.app-no-results');

  const params = new URLSearchParams(window.location.search);
  search.value = params.get('q') || '';

  const client = createClient(await DA_SDK);
  loadColorSwatches();

  const entries = [];
  let total = 0;
  let loading = true;

  const getQuery = () => search.value.trim().toLowerCase();

  function applyFilter(entry, query) {
    const slugMatch = !query || entry.slug.toLowerCase().includes(query);
    let colorMatch = false;
    entry.swatches.forEach((swatch, color) => {
      const hit = !!query && color.replaceAll('-', ' ').includes(query.replaceAll('-', ' '));
      swatch.classList.toggle('match', hit);
      colorMatch ||= hit;
    });
    highlight(entry.name, entry.slug, slugMatch ? query : '');
    entry.row.hidden = !(slugMatch || colorMatch);
    // carry the search into the details view so its back link can restore it
    const href = new URL('details.html', window.location.href);
    href.searchParams.set('product', entry.slug);
    if (query) href.searchParams.set('q', search.value.trim());
    entry.row.href = href.pathname + href.search;
    return !entry.row.hidden;
  }

  function updateSummary() {
    const query = getQuery();
    const visible = entries.filter((e) => !e.row.hidden).length;
    const failures = entries.filter((e) => e.error).length;
    const progress = loading ? `Loading ${entries.length} of ${total}…` : plural(total, 'product');
    const parts = [query ? `${visible} of ${entries.length} match` : progress];
    if (query && loading) parts.push(progress);
    if (!loading && failures) parts.push(`${failures} without images.json`);
    summary.textContent = parts.join(' · ');
    empty.hidden = !(query && !visible && entries.length);
  }

  function filterAll() {
    const query = getQuery();
    entries.forEach((entry) => applyFilter(entry, query));
    const url = new URL(window.location.href);
    if (query) url.searchParams.set('q', search.value.trim());
    else url.searchParams.delete('q');
    window.history.replaceState(null, '', url);
    updateSummary();
  }

  search.addEventListener('input', filterAll);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && search.value) {
      search.value = '';
      filterAll();
    }
  });

  function buildRow(slug, { rows, error }) {
    const row = el('a', 'app-row enter');
    row.addEventListener('animationend', () => row.classList.remove('enter'), { once: true });

    const product = el('div', 'app-product');
    const name = el('span', 'app-slug', slug);
    product.append(name);

    const variants = el('div', 'app-swatches');
    const images = el('div', 'app-images');
    const swatches = new Map();

    if (error) {
      row.classList.add('error');
      product.append(el('span', 'status error', error));
    } else {
      const groups = groupByColor(rows);
      const colors = [...groups.keys()].filter(Boolean);
      product.append(el('span', 'app-meta', `${plural(rows.length, 'image')} · ${plural(colors.length, 'variant')}`));

      colors.forEach((color) => {
        const swatch = buildSwatch(color, `${colorLabel(color)} (${plural(groups.get(color).length, 'image')})`);
        swatches.set(color, swatch);
        variants.append(swatch);
      });
      if (!colors.length) variants.append(el('span', 'app-empty', '—'));

      rows.slice(0, MAX_IMAGES).forEach((r) => images.append(client.buildThumb(slug, r)));
      if (rows.length > MAX_IMAGES) images.append(el('span', 'app-more', `+${rows.length - MAX_IMAGES}`));
      if (!rows.length) images.append(el('span', 'app-empty', 'No images'));
    }

    row.append(product, variants, images);
    return {
      slug, row, name, swatches, error,
    };
  }

  let slugs;
  try {
    slugs = await client.listProductFolders();
  } catch (error) {
    summary.textContent = '';
    errorEl.textContent = error.message;
    errorEl.hidden = false;
    return;
  }
  total = slugs.length;
  updateSummary();

  /* ---------- add product ---------- */

  const addBtn = document.querySelector('.app-add');
  const dialog = document.querySelector('.app-dialog');
  const form = dialog.querySelector('form');
  const slugInput = form.elements.slug;
  const note = dialog.querySelector('.app-field-note');
  const createBtn = dialog.querySelector('.app-dialog-create');
  const existing = new Set(slugs);

  function setNote(text, type = '') {
    note.className = `app-field-note ${type}`;
    note.textContent = text;
  }

  function checkSlug() {
    const raw = slugInput.value.trim();
    const slug = toSlug(raw);
    createBtn.disabled = !slug || existing.has(slug);
    if (!slug) {
      setNote('Lowercase letters, numbers and dashes.');
    } else if (existing.has(slug)) {
      setNote(`${slug} already exists.`, 'error');
    } else {
      setNote(`Will be created as ${PRODUCTS_PATH}/${slug}/`);
    }
  }

  addBtn.addEventListener('click', () => {
    slugInput.value = toSlug(search.value);
    dialog.showModal();
    slugInput.focus();
    slugInput.select();
    checkSlug();
  });
  slugInput.addEventListener('input', checkSlug);
  dialog.querySelector('.app-dialog-close').addEventListener('click', () => dialog.close());
  dialog.querySelector('.app-dialog-cancel').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const slug = toSlug(slugInput.value);
    if (!slug || existing.has(slug)) return;
    createBtn.disabled = true;
    slugInput.disabled = true;
    createBtn.textContent = 'Creating…';
    try {
      // an empty images.json creates the folder, so the product shows up in this list
      await client.saveImagesSheet(slug, null, []);
      existing.add(slug);
      const href = new URL('details.html', window.location.href);
      href.searchParams.set('product', slug);
      window.location.href = href.pathname + href.search;
    } catch (error) {
      setNote(error.message, 'error');
      createBtn.disabled = false;
    } finally {
      slugInput.disabled = false;
      createBtn.textContent = 'Create';
    }
  });
  addBtn.disabled = false;

  // Fetch ahead with limited concurrency, but render strictly in list order.
  const pending = [];
  const prefetch = (i) => {
    if (i < slugs.length && !pending[i]) pending[i] = client.loadImagesSheet(slugs[i]);
  };
  for (let i = 0; i < CONCURRENCY; i += 1) prefetch(i);

  for (let i = 0; i < slugs.length; i += 1) {
    prefetch(i + CONCURRENCY);
    const entry = buildRow(slugs[i], await pending[i]);
    entries.push(entry);
    applyFilter(entry, getQuery());
    table.append(entry.row);
    updateSummary();
  }

  loading = false;
  updateSummary();
}());
