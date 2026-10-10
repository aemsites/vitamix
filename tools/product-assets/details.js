// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import loadColorSwatches from '../../scripts/color-swatches.js';
import {
  MARKETS, PRODUCTS_PATH, buildMarkets, buildSwatch, colorLabel, createClient, el,
  findProductLocales, groupByColor, isAbsolute, plural, productAdminUrl, rowColor, rowField,
  rowMarkets, rowPath, setRowField, toSlug,
} from './shared.js';
import { cleanFileName, readDrop } from './files.js';

const SWATCH_CONFIG = '/us/en_us/products/config/color-swatches.json';
const COLUMNS = ['Path', 'Video', 'Label', 'Category', 'Subcategory', 'Market'];
const UPLOAD_CONCURRENCY = 4;

/** Returns the 11-char video id for youtube.com/watch, youtu.be, /shorts, /embed and /live URLs. */
function youtubeId(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.replace(/^(www|m)\./, '');
  let id = null;
  if (host === 'youtu.be') {
    [id] = url.pathname.slice(1).split('/');
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.pathname === '/watch'
      ? url.searchParams.get('v')
      : url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/)?.[1];
  }
  return /^[\w-]{11}$/.test(id || '') ? id : null;
}

function sameSet(a, b) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function toast(message, type = 'success') {
  let stack = document.querySelector('.details-toasts');
  if (!stack) {
    stack = el('div', 'details-toasts');
    document.body.append(stack);
  }
  const node = el('div', `details-toast ${type}`, message);
  node.setAttribute('role', type === 'error' ? 'alert' : 'status');
  stack.append(node);
  setTimeout(() => node.remove(), type === 'error' ? 8000 : 3000);
}

(async function init() {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('product') || '';
  const query = params.get('q');

  const back = document.querySelector('.details-back');
  const daLink = document.querySelector('.details-da');
  const title = document.querySelector('.details-title');
  const meta = document.querySelector('.details-meta');
  const errorEl = document.querySelector('.details-error');
  const hint = document.querySelector('.details-hint');
  const groupsEl = document.querySelector('.details-groups');
  const savebar = document.querySelector('.details-savebar');
  const savebarText = document.querySelector('.details-savebar-text');
  const saveBtn = document.querySelector('.details-save');
  const discardBtn = document.querySelector('.details-discard');

  const addVariantBtn = document.querySelector('.details-add-variant');
  const variantDialog = document.querySelector('.details-variant-dialog');
  const variantSearch = variantDialog.querySelector('input');
  const variantList = variantDialog.querySelector('.details-variant-list');
  const variantCount = variantDialog.querySelector('.details-variant-count');
  const dialog = document.querySelector('.details-dialog:not(.details-variant-dialog)');
  const form = dialog.querySelector('form');
  const preview = dialog.querySelector('.details-dialog-preview');
  const pathEl = dialog.querySelector('.details-dialog-path');
  const labelInput = form.elements.label;
  const videoInput = form.elements.video;
  const videoError = dialog.querySelector('.details-field-error');
  const videoPreview = dialog.querySelector('.details-video-preview');
  const marketOptions = dialog.querySelector('.details-market-options');

  if (query) back.href = `app.html?q=${encodeURIComponent(query)}`;
  title.textContent = slug || 'No product selected';
  document.title = slug ? `${slug} · Product assets` : 'Product assets';

  const showError = (message) => {
    meta.textContent = '';
    errorEl.textContent = message;
    errorEl.hidden = false;
  };

  if (!slug) {
    showError('Missing ?product= parameter.');
    return;
  }

  const client = createClient(await DA_SDK);
  loadColorSwatches();

  daLink.href = `https://da.live/#/${client.org}/${client.repo}${PRODUCTS_PATH}/${slug}`;
  daLink.hidden = false;

  const localesEl = document.querySelector('.details-locales');
  findProductLocales(slug).then((locales) => {
    if (!locales.length) return;
    localesEl.replaceChildren(el('span', 'details-locales-label', 'Product admin'), ...locales.map((locale) => {
      const link = el('a', 'details-locale');
      link.href = productAdminUrl(locale.path, slug);
      link.target = '_blank';
      link.rel = 'noopener';
      link.title = `Open ${slug} in product admin (${locale.label})`;
      link.append(buildMarkets([locale.market]), el('span', null, locale.path.split('/')[1]));
      return link;
    }));
    localesEl.hidden = false;
  });

  const loaded = await client.loadImagesSheet(slug);
  if (loaded.error && !loaded.missing) {
    showError(loaded.error);
    return;
  }

  /** Swatch config (color slug -> hex), for the variant picker and routing dropped folders. */
  const swatches = new Map();
  const swatchesLoaded = fetch(SWATCH_CONFIG)
    .then((resp) => (resp.ok ? resp.json() : { data: [] }))
    .then((json) => (json.data || []).forEach((r) => {
      if (r.Color) swatches.set(toSlug(r.Color), r.Value);
    }))
    .catch(() => {});

  /** Last saved DA document (null if images.json doesn't exist yet); rows are written into it. */
  let doc = loaded.doc || null;
  /** All sheet rows in saved order, including rows without a Path. */
  let allRows = [];
  let savedJson = '';
  /** Live per-color order of image rows; drag and drop reorders these. */
  let groups = new Map();
  let order = [];
  let original = new WeakMap();
  /** Path each saved row has in DA; differs from its current Path when moved to another group. */
  let savedPath = new WeakMap();
  /** Color of each sheet slot at load time (null for rows without a Path). */
  let slotColors = [];
  const itemRow = new WeakMap();
  /** Added images that only exist in memory until saved: row -> { file, url } */
  let pending = new Map();
  /** Saved rows removed from the sheet: row -> path of its file in DA (deleted on save). */
  let deleted = new Map();
  let saving = false;

  /**
   * Merges the per-color order back into sheet order: each color keeps the slots it occupied,
   * and anything beyond those slots (added or moved-in images) is appended per color.
   */
  function currentRows() {
    const queues = new Map([...groups].map(([color, rows]) => [color, [...rows]]));
    const rows = [];
    allRows.forEach((row, i) => {
      if (slotColors[i] === null) rows.push(row);
      else {
        const next = queues.get(slotColors[i])?.shift();
        if (next) rows.push(next);
      }
    });
    order.forEach((color) => rows.push(...(queues.get(color) || [])));
    return rows;
  }

  function isMoved(row) {
    return !pending.has(row) && savedPath.has(row) && rowPath(row) !== savedPath.get(row);
  }

  /** Field edits other than Path (moves are tracked separately). */
  function isEdited(row) {
    if (pending.has(row) || !original.has(row)) return false;
    const before = JSON.parse(original.get(row));
    return Object.keys({ ...before, ...row })
      .some((k) => k.toLowerCase() !== 'path' && String(before[k] ?? '') !== String(row[k] ?? ''));
  }

  function updateDirty() {
    const rows = currentRows();
    const dirty = JSON.stringify(rows) !== savedJson || pending.size > 0 || deleted.size > 0;
    savebar.hidden = !dirty;
    if (!dirty) return;
    const edited = rows.filter(isEdited).length;
    const moved = rows.filter(isMoved).length;
    const stayed = (row) => !pending.has(row) && !isMoved(row);
    const before = allRows.filter(stayed);
    const reordered = rows.filter(stayed).some((row, i) => row !== before[i]);
    const parts = [];
    if (pending.size) parts.push(`${plural(pending.size, 'image')} added`);
    if (deleted.size) parts.push(`${plural(deleted.size, 'image')} deleted`);
    if (moved) parts.push(`${plural(moved, 'image')} moved`);
    if (edited) parts.push(`${plural(edited, 'image')} edited`);
    if (reordered) parts.push('order changed');
    savebarText.textContent = `Unsaved changes: ${parts.join(', ')}`;
  }

  function uniquePath(path, taken) {
    if (!taken.has(path.toLowerCase())) return path;
    const dot = path.lastIndexOf('.');
    const [base, ext] = dot > path.lastIndexOf('/') ? [path.slice(0, dot), path.slice(dot)] : [path, ''];
    let n = 2;
    while (taken.has(`${base}-${n}${ext}`.toLowerCase())) n += 1;
    return `${base}-${n}${ext}`;
  }

  /** Points a row at another group's folder; moving back restores its saved path. */
  function relocate(row, color) {
    const saved = savedPath.get(row);
    const name = rowPath(row).split('/').pop();
    let wanted = color ? `${color}/${name}` : name;
    if (saved && rowColor({ Path: saved }) === color) wanted = saved;
    const others = currentRows().filter((r) => r !== row);
    const taken = new Set([...others.map(rowPath), ...deleted.values()]
      .map((p) => p.toLowerCase()));
    setRowField(row, 'Path', uniquePath(wanted, taken));
  }

  function syncGroup(grid) {
    const items = grid.querySelectorAll(':scope > .details-item');
    groups.set(grid.dataset.color, [...items].map((f) => itemRow.get(f)));
    updateDirty();
  }

  let openEditor;
  let render;
  let dragging = null;
  /** Other selected items carried along with `dragging`, in document order. */
  let dragSet = [];

  /* ---------- selection ---------- */

  let selected = new Set();
  let lastSelected = null;
  const selectionBar = el('div', 'details-selection');
  selectionBar.hidden = true;
  selectionBar.setAttribute('role', 'status');
  const selectionCount = el('span');
  const selectionClear = el('button', 'secondary', 'Clear');
  selectionClear.type = 'button';
  selectionBar.append(selectionCount, selectionClear);
  document.body.append(selectionBar);

  function updateSelection() {
    groupsEl.querySelectorAll('.details-item').forEach((figure) => {
      const on = selected.has(itemRow.get(figure));
      figure.classList.toggle('selected', on);
      figure.querySelector('.details-item-btn')?.setAttribute('aria-pressed', String(on));
    });
    selectionBar.hidden = !selected.size;
    selectionCount.textContent = `${plural(selected.size, 'image')} selected · drag one to move them all`;
  }

  function clearSelection() {
    selected = new Set();
    lastSelected = null;
    updateSelection();
  }

  /** Toggles an image; with Shift, selects everything between it and the last pick in its group. */
  function toggleSelect(figure, range) {
    const row = itemRow.get(figure);
    const items = [...figure.parentElement.querySelectorAll(':scope > .details-item')];
    const anchor = items.findIndex((f) => itemRow.get(f) === lastSelected);
    if (range && anchor !== -1) {
      const index = items.indexOf(figure);
      items.slice(Math.min(anchor, index), Math.max(anchor, index) + 1)
        .forEach((f) => selected.add(itemRow.get(f)));
    } else if (selected.has(row)) {
      selected.delete(row);
    } else {
      selected.add(row);
    }
    lastSelected = row;
    updateSelection();
  }

  selectionClear.addEventListener('click', clearSelection);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !selected.size || dragging) return;
    if (document.querySelector('dialog[open]')) return;
    clearSelection();
  });

  /** Reads the order of every grid back into state, re-pathing images that changed group. */
  function syncAll() {
    const grids = [...groupsEl.querySelectorAll('.details-grid')];
    grids.forEach((grid) => {
      const items = grid.querySelectorAll(':scope > .details-item');
      groups.set(grid.dataset.color, [...items].map((f) => itemRow.get(f)));
    });
    let changed = false;
    grids.forEach((grid) => {
      groups.get(grid.dataset.color).forEach((row) => {
        if (rowColor(row) === grid.dataset.color) return;
        relocate(row, grid.dataset.color);
        changed = true;
      });
    });
    if (changed) render();
    updateDirty();
  }

  function removePending(row) {
    selected.delete(row);
    const color = rowColor(row);
    URL.revokeObjectURL(pending.get(row).url);
    pending.delete(row);
    groups.set(color, groups.get(color).filter((r) => r !== row));
    render();
    updateDirty();
  }

  /** Removes an image: new ones are dropped, saved ones are deleted from DA on save. */
  function deleteImage(row) {
    selected.delete(row);
    if (pending.has(row)) {
      removePending(row);
      return;
    }
    const color = rowColor(row);
    const path = savedPath.get(row);
    if (path && !isAbsolute(path)) deleted.set(row, path);
    else deleted.set(row, '');
    groups.set(color, groups.get(color).filter((r) => r !== row));
    render();
    updateDirty();
  }

  function moveBy(figure, delta) {
    const sibling = delta < 0 ? figure.previousElementSibling : figure.nextElementSibling;
    if (!sibling?.classList.contains('details-item')) return;
    if (delta < 0) sibling.before(figure);
    else sibling.after(figure);
    figure.querySelector('button').focus();
    syncGroup(figure.parentElement);
  }

  function buildItem(row) {
    const figure = el('figure', 'details-item');
    const media = el('div', 'details-item-media');
    figure.draggable = true;
    figure.classList.toggle('selected', selected.has(row));
    figure.classList.toggle('changed', isEdited(row) || isMoved(row));
    if (isMoved(row)) figure.title = `Moved from ${savedPath.get(row)}`;
    itemRow.set(figure, row);
    const added = pending.get(row);

    const label = rowField(row, 'Label') || rowPath(row);
    const button = el('button', 'details-item-btn');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(selected.has(row)));
    button.setAttribute('aria-label', `Select ${label}${added ? ' (new, not saved)' : ''}. Shift+click selects a range, E edits, Alt+Arrow keys reorder.`);
    const thumb = client.buildThumb(slug, row, { src: added?.url });
    thumb.querySelectorAll('img').forEach((img) => { img.draggable = false; });
    button.append(thumb);
    button.addEventListener('click', (e) => toggleSelect(figure, e.shiftKey));
    button.addEventListener('keydown', (e) => {
      if (e.key === 'e' && !e.altKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        openEditor(figure);
        return;
      }
      if (added && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        removePending(row);
        return;
      }
      if (!e.altKey) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') moveBy(figure, -1);
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') moveBy(figure, 1);
      else return;
      e.preventDefault();
    });

    figure.addEventListener('dragstart', (e) => {
      dragging = figure;
      // dragging a selected image carries the whole selection along
      dragSet = selected.has(row)
        ? [...groupsEl.querySelectorAll('.details-item')]
          .filter((f) => f !== figure && selected.has(itemRow.get(f)))
        : [];
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', rowPath(row));
      if (dragSet.length) {
        // the drag image is captured right after dragstart, so badge it now
        figure.dataset.count = dragSet.length + 1;
        figure.classList.add('drag-multi');
      }
      requestAnimationFrame(() => {
        figure.classList.remove('drag-multi');
        figure.classList.add('dragging');
        dragSet.forEach((f) => f.classList.add('drag-hidden'));
      });
    });
    figure.addEventListener('dragend', (e) => {
      figure.classList.remove('dragging', 'drag-multi');
      dragSet.forEach((f) => f.classList.remove('drag-hidden'));
      dragSet = [];
      dragging = null;
      // cancelled (e.g. Esc): restore the order from state
      if (e.dataTransfer.dropEffect === 'none') render();
      else syncAll();
    });

    const edit = el('button', 'details-edit secondary', 'Edit');
    edit.type = 'button';
    edit.tabIndex = -1;
    edit.setAttribute('aria-label', `Edit ${label}`);
    edit.addEventListener('click', () => openEditor(figure));

    media.append(button, edit);
    figure.append(media);
    if (added) {
      figure.classList.add('added');
      media.append(el('span', 'details-new', 'New'));
      const remove = el('button', 'details-remove', '×');
      remove.type = 'button';
      remove.title = 'Remove (not saved yet)';
      remove.setAttribute('aria-label', `Remove ${label}`);
      remove.addEventListener('click', () => removePending(row));
      media.append(remove);
    }
    const caption = [rowField(row, 'Category'), rowField(row, 'Subcategory')].filter(Boolean).join(' · ');
    if (caption) figure.append(el('figcaption', null, caption));
    return figure;
  }

  /* ---------- adding images ---------- */

  function newRow(path) {
    const keys = allRows.length ? Object.keys(allRows[0]) : COLUMNS;
    const row = Object.fromEntries(keys.map((key) => [key, '']));
    setRowField(row, 'Path', path);
    return row;
  }

  /** Picks the variant from the deepest folder named like a color (`…/white/x.jpg`), else ''. */
  function routeColor(path) {
    const folders = path.split('/').slice(0, -1).map(toSlug);
    return folders.reverse().find((f) => f && (groups.has(f) || swatches.has(f))) || '';
  }

  /** @param {string} [target] color to add everything to; routes by folder name when undefined */
  function addImages(images, target) {
    const taken = new Set([...currentRows().map(rowPath), ...deleted.values()]
      .map((p) => p.toLowerCase()));
    const counts = new Map();
    let renamed = 0;
    images.forEach(({ path, file }) => {
      const color = target ?? routeColor(path);
      const name = cleanFileName(file.name);
      const wanted = color ? `${color}/${name}` : name;
      const unique = uniquePath(wanted, taken);
      if (unique !== wanted) renamed += 1;
      taken.add(unique.toLowerCase());
      const row = newRow(unique);
      pending.set(row, { file, url: URL.createObjectURL(file) });
      if (!groups.has(color)) {
        groups.set(color, []);
        order.push(color);
      }
      groups.get(color).push(row);
      counts.set(color, (counts.get(color) || 0) + 1);
    });
    render();
    updateDirty();

    const name = (color) => (color ? colorLabel(color) : 'All variants');
    let message = counts.size === 1
      ? `Added ${plural(images.length, 'image')} to ${name([...counts.keys()][0])}`
      : `Added ${plural(images.length, 'image')}: ${[...counts].map(([c, n]) => `${n} → ${name(c)}`).join(', ')}`;
    if (renamed) message += ` (${renamed} renamed to avoid duplicates)`;
    toast(message);
    groupsEl.querySelector('.details-item.added')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  async function handleFiles(promise, target) {
    let result;
    try {
      result = await promise;
    } catch (error) {
      toast(`Could not read files: ${error.message}`, 'error');
      return;
    }
    const { images, skipped } = result;
    if (skipped.length) {
      // eslint-disable-next-line no-console
      console.warn('product-assets: skipped files', skipped);
    }
    if (!images.length) {
      toast(`No images found${skipped.length ? ` (${plural(skipped.length, 'file')} skipped)` : ''}`, 'error');
      return;
    }
    images.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    addImages(images, target);
  }

  /* Files dropped on a group go to that group; elsewhere they're routed by folder name. */
  const hasFiles = (e) => !dragging && [...(e.dataTransfer?.types || [])].includes('Files');
  let dropTimer;

  function clearDrop() {
    document.body.classList.remove('details-dropping');
    groupsEl.querySelectorAll('.drop-target').forEach((s) => s.classList.remove('drop-target'));
  }

  document.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const blocked = saving || dialog.open || variantDialog.open;
    e.dataTransfer.dropEffect = blocked ? 'none' : 'copy';
    if (blocked) return;
    const section = e.target.closest?.('.details-group');
    document.body.classList.add('details-dropping');
    groupsEl.querySelectorAll('.drop-target').forEach((s) => s !== section && s.classList.remove('drop-target'));
    section?.classList.add('drop-target');
    // dragover repeats while hovering, so a short timer doubles as dragleave
    clearTimeout(dropTimer);
    dropTimer = setTimeout(clearDrop, 150);
  });

  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    clearDrop();
    if (saving || dialog.open || variantDialog.open) return;
    const section = e.target.closest?.('.details-group');
    handleFiles(readDrop(e.dataTransfer), section ? section.dataset.color : undefined);
  });

  /** The whole group (header included) accepts images dragged from any group. */
  function enableReorder(section, grid, color) {
    section.addEventListener('dragover', (e) => {
      if (!dragging) return;
      // external URLs have no file to move into a color folder
      if (color && [dragging, ...dragSet].some((f) => isAbsolute(rowPath(itemRow.get(f))))) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const target = e.target.closest('.details-item');
      if (target && target !== dragging && !dragSet.includes(target)) {
        const rect = target.getBoundingClientRect();
        if (e.clientX > rect.left + rect.width / 2) target.after(dragging);
        else target.before(dragging);
      } else if (!target && dragging.parentElement !== grid) {
        grid.append(dragging);
      }
      // keep the carried images right behind the dragged one
      if (dragSet.length) dragging.after(...dragSet);
    });
    section.addEventListener('drop', (e) => {
      if (dragging) e.preventDefault();
    });
  }

  render = () => {
    groupsEl.replaceChildren();
    hint.hidden = false;
    const imageCount = order.reduce((n, color) => n + groups.get(color).length, 0);
    const colorCount = order.filter(Boolean).length;
    meta.textContent = doc || imageCount
      ? `${plural(imageCount, 'image')} · ${plural(colorCount, 'variant')}`
      : 'No images.json yet. Drop images to create it.';

    order.forEach((color) => {
      const items = groups.get(color);
      const section = el('section', 'details-group');
      section.dataset.color = color;
      if (color) {
        // .color-swatch scope exposes the --color-* variables from the swatch config
        section.classList.add('color-swatch', 'variant');
        section.style.setProperty('--swatch', `var(--color-${color})`);
      }
      const head = el('header', 'details-group-head');
      if (color) head.append(buildSwatch(color));
      head.append(
        el('h2', 'details-group-title', color ? colorLabel(color) : 'All variants'),
        el('span', 'details-group-count', plural(items.length, 'image')),
      );
      const grid = el('div', 'details-grid');
      grid.dataset.color = color;
      grid.append(...items.map(buildItem));
      enableReorder(section, grid, color);
      section.append(head, grid);
      groupsEl.append(section);
    });
    addVariantBtn.hidden = false;
  };

  function setup(rows) {
    pending.forEach(({ url }) => URL.revokeObjectURL(url));
    pending = new Map();
    deleted = new Map();
    selected = new Set();
    lastSelected = null;
    selectionBar.hidden = true;
    allRows = rows;
    savedJson = JSON.stringify(rows);
    original = new WeakMap();
    savedPath = new WeakMap();
    rows.forEach((row) => {
      original.set(row, JSON.stringify(row));
      if (rowPath(row)) savedPath.set(row, rowPath(row));
    });
    slotColors = rows.map((row) => (rowPath(row) ? rowColor(row) : null));
    groups = groupByColor(rows.filter((row) => rowPath(row)));
    // Shared (non-variant) images first (always shown, as a drop target), then each color.
    if (!groups.has('')) groups.set('', []);
    order = ['', ...[...groups.keys()].filter(Boolean)];
    render();
    updateDirty();
  }

  /* ---------- add variant ---------- */

  /** Variants added while the picker is open; clicking them again removes them while empty. */
  const addedVariants = new Set();

  function isRemovable(color) {
    return addedVariants.has(color) && !groups.get(color)?.length;
  }

  function revealGroup(color) {
    const section = groupsEl.querySelector(`.details-group[data-color="${color}"]`);
    if (!section) return;
    section.scrollIntoView({ block: 'center', behavior: 'smooth' });
    section.classList.remove('flash');
    // restart the highlight animation when the same group is revealed again
    requestAnimationFrame(() => section.classList.add('flash'));
  }

  function toggleVariant(color) {
    if (isRemovable(color)) {
      groups.delete(color);
      order = order.filter((c) => c !== color);
      addedVariants.delete(color);
      render();
    } else if (!groups.has(color)) {
      groups.set(color, []);
      order.push(color);
      addedVariants.add(color);
      render();
      revealGroup(color);
    }
    // eslint-disable-next-line no-use-before-define
    renderVariantList(color);
  }

  /** @param {string} [focusColor] keeps focus on this option after re-rendering */
  function renderVariantList(focusColor) {
    const q = toSlug(variantSearch.value);
    const options = [...swatches].filter(([color]) => !q || color.includes(q));
    variantList.replaceChildren(...options.map(([color, value]) => {
      const button = el('button', 'details-variant-option');
      button.type = 'button';
      button.dataset.color = color;
      const swatch = el('span', 'pa-swatch');
      swatch.style.setProperty('--swatch', value);
      button.append(swatch, el('span', null, colorLabel(color)));
      if (isRemovable(color)) {
        button.setAttribute('aria-pressed', 'true');
        button.title = 'Added. Click to remove';
      } else if (groups.has(color)) {
        button.disabled = true;
        button.title = 'Already a variant';
      }
      button.addEventListener('click', () => toggleVariant(color));
      return button;
    }));
    if (!options.length) {
      variantList.append(el('p', 'details-empty', swatches.size ? 'No matching colors.' : 'No swatches found.'));
    }
    variantCount.textContent = addedVariants.size ? `${plural(addedVariants.size, 'variant')} added` : '';
    if (focusColor) variantList.querySelector(`[data-color="${focusColor}"]`)?.focus();
  }

  addVariantBtn.addEventListener('click', async () => {
    await swatchesLoaded;
    addedVariants.clear();
    variantSearch.value = '';
    renderVariantList();
    variantDialog.showModal();
    variantSearch.focus();
  });
  variantSearch.addEventListener('input', renderVariantList);
  variantSearch.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const next = variantList.querySelector('button:not(:disabled):not([aria-pressed="true"])');
    if (!next) return;
    toggleVariant(next.dataset.color);
    // stay in the search box so the next color can be typed right away
    variantSearch.focus();
    variantSearch.select();
  });
  variantDialog.querySelectorAll('.details-dialog-close, .details-variant-done')
    .forEach((btn) => btn.addEventListener('click', () => variantDialog.close()));
  variantDialog.addEventListener('click', (e) => {
    if (e.target === variantDialog) variantDialog.close();
  });

  setup(JSON.parse(JSON.stringify(client.sheetRows(doc))));

  /* ---------- edit dialog ---------- */

  let editing = null;
  let originalVideo = '';

  function validateVideo() {
    const value = videoInput.value.trim();
    const id = youtubeId(value);
    // leave untouched legacy values alone, only validate what the user enters
    const invalid = value && !id && value !== originalVideo;
    const message = invalid ? 'Enter a YouTube URL, e.g. https://www.youtube.com/watch?v=… or https://youtu.be/…' : '';
    videoInput.setCustomValidity(message);
    videoError.textContent = message;
    videoPreview.hidden = !id;
    if (id) videoPreview.src = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
  }

  function buildMarketToggle(market, pressed) {
    const toggle = el('button', 'details-market');
    toggle.type = 'button';
    toggle.dataset.market = market;
    toggle.setAttribute('aria-pressed', String(pressed));
    toggle.append(buildMarkets([market]), el('span', null, market.toUpperCase()));
    toggle.addEventListener('click', () => {
      toggle.setAttribute('aria-pressed', String(toggle.getAttribute('aria-pressed') !== 'true'));
    });
    return toggle;
  }

  openEditor = (figure) => {
    editing = figure;
    const row = itemRow.get(figure);
    const img = figure.querySelector('.pa-thumb > img');
    preview.href = img.currentSrc || img.src;
    preview.querySelector('img').src = img.currentSrc || img.src;
    pathEl.textContent = rowPath(row);
    labelInput.value = rowField(row, 'Label');
    originalVideo = rowField(row, 'Video');
    videoInput.value = originalVideo;
    validateVideo();

    const rowMarketList = rowMarkets(row);
    const options = [...MARKETS, ...rowMarketList.filter((m) => !MARKETS.includes(m))];
    const toggles = options.map((m) => buildMarketToggle(m, rowMarketList.includes(m)));
    marketOptions.replaceChildren(...toggles);

    dialog.showModal();
    labelInput.focus();
  };

  function updateField(row, key, value) {
    if (rowField(row, key) !== value) setRowField(row, key, value);
  }

  form.addEventListener('submit', (e) => {
    if (!form.checkValidity()) {
      e.preventDefault();
      return;
    }
    const row = itemRow.get(editing);
    updateField(row, 'Label', labelInput.value.trim());
    updateField(row, 'Video', videoInput.value.trim());
    const markets = [...marketOptions.querySelectorAll('[aria-pressed="true"]')].map((b) => b.dataset.market);
    if (!sameSet(markets, rowMarkets(row))) {
      setRowField(row, 'Market', markets.map((m) => m.toUpperCase()).join(','));
    }
    const next = buildItem(row);
    editing.replaceWith(next);
    editing = next;
    updateDirty();
  });

  videoInput.addEventListener('input', validateVideo);
  dialog.querySelector('.details-dialog-close').addEventListener('click', () => dialog.close());
  dialog.querySelector('.details-dialog-cancel').addEventListener('click', () => dialog.close());
  dialog.querySelector('.details-dialog-delete').addEventListener('click', () => {
    const row = itemRow.get(editing);
    const color = rowColor(row);
    const index = groups.get(color).indexOf(row);
    const isNew = pending.has(row);
    editing = null;
    dialog.close();
    deleteImage(row);
    // keep keyboard focus nearby: the next image in the group, else the previous one
    const items = groupsEl.querySelectorAll(`.details-grid[data-color="${color}"] > .details-item`);
    (items[index] || items[index - 1])?.querySelector('button')?.focus();
    toast(isNew ? 'Image removed' : 'Image deleted. Save to apply, or Discard to undo');
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    editing?.querySelector('button')?.focus();
    editing = null;
  });

  /* ---------- save / discard ---------- */

  async function save() {
    if (saving || savebar.hidden) return;
    saving = true;
    saveBtn.disabled = true;
    discardBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const rows = currentRows();
      const latest = await client.fetchImagesDoc(slug);
      // eslint-disable-next-line no-alert
      if (JSON.stringify(latest) !== JSON.stringify(doc) && !window.confirm(
        'images.json was changed in DA since this page was loaded. Overwrite those changes?',
      )) return;

      // move files first so new uploads can reuse freed names, then upload, then write the sheet
      const moves = rows.filter(isMoved).map((row) => ({ row, from: savedPath.get(row) }));
      const movedFrom = moves.map((m) => m.from);
      const movedTo = moves.map((m) => rowPath(m.row));
      let moved = 0;
      while (moves.length) {
        saveBtn.textContent = `Moving ${moved + 1}/${moved + moves.length}…`;
        const sources = new Set(moves.map((m) => m.from.toLowerCase()));
        let i = moves.findIndex((m) => !sources.has(rowPath(m.row).toLowerCase()));
        if (i < 0) {
          // cycle (e.g. two images swapped names): park one under a temporary name first
          i = 0;
          const tmp = moves[0].from.replace(/[^/]+$/, (name) => `tmp-${Date.now()}-${name}`);
          // eslint-disable-next-line no-await-in-loop
          await client.moveAsset(slug, moves[0].from, tmp);
          moves[0].from = tmp;
          savedPath.set(moves[0].row, tmp);
        }
        const [{ row, from }] = moves.splice(i, 1);
        // eslint-disable-next-line no-await-in-loop
        await client.moveAsset(slug, from, rowPath(row));
        savedPath.set(row, rowPath(row));
        moved += 1;
      }

      const uploads = rows.filter((row) => pending.has(row));
      let done = 0;
      const progress = () => { saveBtn.textContent = `Uploading ${done}/${uploads.length}…`; };
      if (uploads.length) progress();
      const queue = [...uploads];
      const workers = Math.min(UPLOAD_CONCURRENCY, queue.length);
      await Promise.all(Array.from({ length: workers }, async () => {
        while (queue.length) {
          const row = queue.shift();
          const entry = pending.get(row);
          if (!entry.uploaded) {
            // eslint-disable-next-line no-await-in-loop
            await client.uploadAsset(slug, rowPath(row), entry.file);
            entry.uploaded = true;
          }
          done += 1;
          progress();
        }
      }));

      saveBtn.textContent = 'Saving…';
      doc = await client.saveImagesSheet(slug, latest, rows);
      // delete files only once the sheet no longer references them
      const removals = [...deleted.values()].filter(Boolean);
      setup(JSON.parse(JSON.stringify(rows)));
      saveBtn.textContent = 'Deleting…';
      const results = await Promise.allSettled(removals.map((p) => client.deleteAsset(slug, p)));
      const failed = results.filter((r) => r.status === 'rejected');
      // publish new/moved files before images.json so the live sheet never points at
      // unpublished images, then take moved/deleted files off preview and live
      const toPublish = [...uploads.map(rowPath), ...movedTo];
      const stepProgress = (label) => (n, total) => { saveBtn.textContent = `${label} ${n}/${total}…`; };
      saveBtn.textContent = 'Publishing…';
      const publishErrors = [
        ...await client.publishAssets(slug, toPublish, stepProgress('Publishing')),
      ];
      saveBtn.textContent = 'Publishing images.json…';
      publishErrors.push(...await client.publishAssets(slug, ['images.json']));
      publishErrors.push(...await client.unpublishAssets(slug, [...movedFrom, ...removals], stepProgress('Unpublishing')));

      const finished = [
        uploads.length && `uploaded ${plural(uploads.length, 'image')}`,
        moved && `moved ${plural(moved, 'image')}`,
        removals.length && `deleted ${plural(removals.length - failed.length, 'image')}`,
      ].filter(Boolean);
      const published = publishErrors.length ? 'Saved' : 'Saved and published';
      toast(finished.length ? `${published} images.json (${finished.join(', ')})` : `${published} images.json`);
      if (failed.length) {
        toast(`Saved, but ${plural(failed.length, 'file')} could not be deleted from DA: ${failed[0].reason.message}`, 'error');
      }
      if (publishErrors.length) {
        // eslint-disable-next-line no-console
        console.error('product-assets: publish errors', publishErrors);
        toast(`Saved to DA, but ${plural(publishErrors.length, 'preview/publish step')} failed: ${publishErrors[0]}`, 'error');
      }
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      saving = false;
      saveBtn.disabled = false;
      discardBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  }

  saveBtn.addEventListener('click', save);
  discardBtn.addEventListener('click', () => setup(JSON.parse(savedJson)));
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      save();
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (savebar.hidden) return;
    e.preventDefault();
    e.returnValue = '';
  });
}());
