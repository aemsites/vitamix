/* eslint-disable import/no-unresolved */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { crawl } from 'https://da.live/nx/public/utils/tree.js';

/* utilities */

/**
 * Formats elapsed time since a start timestamp as a seconds string.
 * @param {number} startTime - Timestamp from Date.now() at the start of the operation
 * @returns {string} Elapsed seconds with two decimal places, e.g. "1.23s"
 */
function elapsed(startTime) {
  return `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
}

/**
 * Returns the path without the .html extension, or null if the path is not an HTML file.
 * @param {string} path - File path to check
 * @returns {string|null} Path without .html, or null
 */
function stripHtml(path) {
  return path.endsWith('.html') ? path.slice(0, -5) : null;
}

/**
 * Sanitizes a single name segment for use in a URL path.
 * @param {string} name - Raw name to sanitize
 * @param {boolean} preserveDots - Whether to preserve dots (e.g. for file extensions)
 * @param {boolean} allowUnderscores - Whether to allow underscores in the output
 * @returns {string|null} Sanitized segment, or `null` if the input is falsy
 */
function sanitizeName(name, preserveDots = true, allowUnderscores = false) {
  if (!name) return null;

  if (preserveDots && name.indexOf('.') !== -1) {
    return name
      .split('.')
      .map((part) => sanitizeName(part, true, allowUnderscores))
      .join('.');
  }

  const pattern = allowUnderscores ? /[^a-z0-9_]+/g : /[^a-z0-9]+/g;

  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(pattern, '-')
    .replace(/-$/g, '');
}

/**
 * Sanitizes every segment of a URL path, removing path traversal parts.
 * @param {string} path - Raw path to sanitize (must start with '/')
 * @returns {string} Sanitized path, without the leading slash
 */
function sanitizePathParts(path) {
  const parts = path.slice(1).toLowerCase().split('/');
  return parts
    .map((name, i) => (name ? sanitizeName(name, true, i < parts.length - 1) : ''))
    // Remove path traversal segments (./ and ../); keep trailing empty string.
    .filter((name, i, arr) => !/^[.]{1,2}$/.test(name) && (name !== '' || i === arr.length - 1))
    .join('/');
}

/**
 * Computes the DA path for an image by sanitizing its pathname and replacing the path prefix.
 * @param {string} src - Full image URL
 * @param {string} pathPrefix - Pathname segment to replace, e.g. '/content/dam/vitamix'
 * @param {string} destPath - DA path that replaces pathPrefix, e.g. '/media'
 * @returns {string} The computed DA path, e.g. '/media/hero.jpg'
 */
function buildDaImagePath(src, pathPrefix, destPath) {
  const { pathname } = new URL(src);
  return `/${sanitizePathParts(pathname)}`.replace(pathPrefix, destPath);
}

/* dom utilities */

/**
 * Creates an anchor element that opens in a new tab.
 * @param {string} href - URL for the link
 * @param {string} text - Text content for the link
 * @returns {HTMLAnchorElement} Anchor element with target="_blank" and rel="noopener noreferrer"
 */
function createLink(href, text) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

/**
 * Sets the disabled state on all form action buttons.
 * @param {boolean} disabled - Whether to disable the buttons
 */
function setButtonsDisabled(disabled) {
  document.querySelectorAll('.button-wrapper sl-button').forEach((btn) => {
    btn.disabled = disabled;
  });
}

/**
 * Shows one result panel and hides the others.
 * @param {string} active - Class name of the panel to show: 'scan', 'preview', or 'run'
 */
function showResults(active) {
  document.querySelectorAll('.result').forEach((el) => {
    el.setAttribute('aria-hidden', !el.classList.contains(active));
  });
}

/* form state */

/**
 * Reads the current form values and returns the tool configuration.
 * @returns {{ crawlPath: string, srcFilter: string, pathPrefix: string,
 *   destPath: string, draftMode: boolean, draftFolder: string }}
 */
function getConfig() {
  return {
    crawlPath: document.getElementById('crawl-path').value,
    srcFilter: document.getElementById('url-filter').value,
    pathPrefix: document.getElementById('path-prefix').value,
    destPath: document.getElementById('dest-path').value,
    draftMode: document.querySelector('input[name="output-mode"]:checked').value === 'draft',
    draftFolder: document.getElementById('draft-folder').value,
  };
}

/**
 * Loads entry history for a form field from localStorage.
 * @param {string} fieldId - The form field's element ID
 * @returns {string[]} Previously entered values, newest first
 */
function loadHistory(fieldId) {
  try {
    return JSON.parse(localStorage.getItem(`image-migration:${fieldId}`)) || [];
  } catch (e) {
    return [];
  }
}

/**
 * Prepends a value to the stored history for a form field, deduplicating and capping at 3.
 * @param {string} fieldId - The form field's element ID
 * @param {string} value - The value to record
 */
function saveToHistory(fieldId, value) {
  if (!value) return;
  const history = loadHistory(fieldId).filter((v) => v !== value);
  history.unshift(value);
  localStorage.setItem(`image-migration:${fieldId}`, JSON.stringify(history.slice(0, 3)));
}

/**
 * Persists the current form state to localStorage.
 */
function saveFormState() {
  ['crawl-path', 'url-filter', 'path-prefix', 'dest-path', 'draft-folder'].forEach((id) => {
    saveToHistory(id, document.getElementById(id).value);
  });
  const checkedMode = document.querySelector('input[name="output-mode"]:checked');
  if (checkedMode) {
    localStorage.setItem('image-migration:output-mode', checkedMode.value);
  }
}

/* da */

/**
 * Resolves the DA SDK token and derives repo context for API calls.
 * @returns {Promise<{ org: string, repo: string, repoPath: string, authOpts: object }>}
 */
async function getAuth() {
  const { context, token } = await DA_SDK;
  const { org, repo } = context;
  return {
    org,
    repo,
    repoPath: `/${org}/${repo}`,
    authOpts: { headers: { Authorization: `Bearer ${token}` } },
  };
}

/**
 * Fetches a DA document and returns the src of any images matching srcFilter.
 * @param {object} item - Crawl result item; must have a `path` string property
 * @param {string} srcFilter - Substring to match against img src
 * @param {object} authOpts - Fetch options containing the Authorization header
 * @returns {Promise<string[]|null>} Matching image src values, or null if none found or fetch fails
 */
async function scanDocument(item, srcFilter, authOpts) {
  if (!stripHtml(item.path)) return null;

  const docResp = await fetch(`https://admin.da.live/source${item.path}`, authOpts);
  if (!docResp.ok) return null;

  const dom = new DOMParser().parseFromString(await docResp.text(), 'text/html');
  try {
    const images = [...dom.querySelectorAll(`img[src*="${srcFilter}"]`)].map((img) => img.src);
    return images.length ? images : null;
  } catch (e) {
    return null;
  }
}

/**
 * Fetches an image from its current URL, uploads it to DA, and updates img.src.
 * @param {HTMLImageElement} img - The img element to migrate
 * @param {string} repoPath - DA repo path, e.g. '/org/repo'
 * @param {string} pathPrefix - Pathname segment to replace
 * @param {string} destPath - DA path that replaces pathPrefix
 * @param {object} authOpts - Fetch options containing the Authorization header
 */
async function migrateImage(img, repoPath, pathPrefix, destPath, authOpts) {
  const imageResp = await fetch(img.src);
  if (!imageResp.ok) throw new Error('Could not fetch image');

  const daPath = buildDaImagePath(img.src, pathPrefix, destPath);

  const imageBlob = await imageResp.blob();
  const imageForm = new FormData();
  imageForm.append('data', imageBlob);

  const uploadResp = await fetch(`https://admin.da.live/source${repoPath}${daPath}`, {
    ...authOpts,
    method: 'POST',
    body: imageForm,
  });
  if (!uploadResp.ok) throw new Error('Could not upload image');

  img.src = `https://content.da.live${repoPath}${daPath}`;
}

/**
 * Fetches a DA document, migrates matching images, and saves the result.
 * In draft mode, saves to the draft folder; in overwrite mode, versions the original first.
 * @param {object} item - Crawl result item; must have a `path` string property
 * @param {string} repoPath - DA repo path, e.g. '/org/repo'
 * @param {string} srcFilter - Substring to match against img src
 * @param {string} pathPrefix - Pathname segment to replace when building the DA path
 * @param {string} destPath - DA path that replaces pathPrefix, e.g. '/media'
 * @param {boolean} draftMode - When true, saves to draftFolder instead of the original path
 * @param {string} draftFolder - Draft folder path segment, e.g. '/drafts/fkakatie'
 * @param {object} authOpts - Fetch options containing the Authorization header
 * @returns {Promise<object|null>} Structured result per document, or null if skipped.
 *   Shape: `{ path, saveStatus, images: [{ src, daPath, ok, message }] }`
 */
async function processDocument(
  item,
  repoPath,
  srcFilter,
  pathPrefix,
  destPath,
  draftMode,
  draftFolder,
  authOpts,
) {
  if (!stripHtml(item.path)) return null;

  const docResp = await fetch(`https://admin.da.live/source${item.path}`, authOpts);
  if (!docResp.ok) return { path: item.path, fetchFailed: true, images: [] };

  const dom = new DOMParser().parseFromString(await docResp.text(), 'text/html');
  let images;
  try {
    images = dom.querySelectorAll(`img[src*="${srcFilter}"]`);
  } catch (e) {
    return null;
  }
  if (!images.length) return null;

  if (!draftMode) {
    const versionResp = await fetch(`https://admin.da.live/versionsource${item.path}`, {
      method: 'POST',
      headers: { ...authOpts.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Before asset migration' }),
    });
    if (!versionResp.ok) throw new Error('Could not create version');
  }

  const imageResults = await Promise.all([...images].map(async (img) => {
    const { src } = img;
    const daPath = buildDaImagePath(src, pathPrefix, destPath);
    try {
      await migrateImage(img, repoPath, pathPrefix, destPath, authOpts);
      return {
        src, daPath, ok: true, message: '',
      };
    } catch (error) {
      return {
        src, daPath, ok: false, message: error.message,
      };
    }
  }));

  const savePath = draftMode
    ? item.path.replace(repoPath, `${repoPath}${draftFolder}`)
    : item.path;

  const docBlob = new Blob([dom.body.outerHTML], { type: 'text/html' });
  const docForm = new FormData();
  docForm.append('data', docBlob);

  const saveResp = await fetch(`https://admin.da.live/source${savePath}`, {
    ...authOpts,
    method: 'POST',
    body: docForm,
  });

  return {
    path: savePath,
    saveStatus: saveResp.status,
    images: imageResults,
  };
}

/* results */

/**
 * Builds a run result page group element for a processed document.
 * @param {object} result - processDocument result: path, saveStatus, fetchFailed, images
 * @param {string} repoPath - DA repo path, e.g. '/org/repo'
 * @param {string} itemPath - Page path without .html extension
 * @returns {HTMLElement} The page group details element
 */
function buildRunPageGroup(result, repoPath, itemPath) {
  const details = document.createElement('details');
  details.className = 'group';
  details.open = true;

  const statuses = new Set();
  if (result.fetchFailed) {
    statuses.add('error');
  } else {
    if (result.saveStatus < 200 || result.saveStatus >= 300) statuses.add('error');
    if (result.images.some((img) => img.ok)) statuses.add('success');
    if (result.images.some((img) => !img.ok)) statuses.add('error');
  }
  details.dataset.status = [...statuses].join(' ');

  const summary = document.createElement('summary');

  const pathSpan = document.createElement('span');
  pathSpan.textContent = itemPath;

  const statusSpan = document.createElement('span');
  statusSpan.className = 'status';
  statusSpan.textContent = result.fetchFailed ? 'fetch error' : String(result.saveStatus);

  summary.append(pathSpan, statusSpan);
  details.append(summary);

  if (!result.fetchFailed) {
    const list = document.createElement('ul');

    result.images.forEach(({
      daPath, ok, message, src,
    }) => {
      const li = document.createElement('li');
      li.className = 'row';
      li.dataset.status = ok ? 'success' : 'error';

      const imgStatusSpan = document.createElement('span');
      imgStatusSpan.className = 'status';
      imgStatusSpan.textContent = ok ? 'ok' : 'error';

      if (ok) {
        li.append(createLink(`https://content.da.live${repoPath}${daPath}`, daPath), imgStatusSpan);
      } else {
        const msgSpan = document.createElement('span');
        msgSpan.textContent = message;
        const srcSpan = document.createElement('span');
        srcSpan.className = 'src';
        srcSpan.textContent = src;
        li.append(imgStatusSpan, msgSpan, srcSpan);
      }

      list.append(li);
    });

    details.append(list);
  }

  return details;
}

/**
 * Runs the scan phase: crawls the site and lists pages with matching images.
 */
async function runScan() {
  saveFormState();
  const config = getConfig();

  showResults('scan');
  setButtonsDisabled(true);

  const scanEl = document.querySelector('.result.scan');
  const rowsEl = scanEl.querySelector('.rows');
  const countEl = document.getElementById('scan-count');
  const timeEl = document.getElementById('scan-time');
  const emptyEl = scanEl.querySelector('.empty');

  rowsEl.innerHTML = '';
  countEl.textContent = '0';
  timeEl.textContent = '0.00s';
  emptyEl.setAttribute('aria-hidden', true);

  const startTime = Date.now();
  let docCount = 0;
  let totalImageCount = 0;

  try {
    const { repoPath, authOpts } = await getAuth();

    const { results } = crawl({
      path: `${repoPath}${config.crawlPath}`,
      callback: async (item) => {
        const images = await scanDocument(item, config.srcFilter, authOpts);
        if (!images) return;

        docCount += 1;
        totalImageCount += images.length;
        countEl.textContent = docCount;
        timeEl.textContent = elapsed(startTime);

        const itemPath = stripHtml(item.path);

        const details = document.createElement('details');
        details.className = 'group';

        const summary = document.createElement('summary');

        const pathSpan = document.createElement('span');
        pathSpan.textContent = itemPath;

        summary.append(pathSpan, createLink(`https://da.live/edit#${itemPath}`, 'Edit'));

        const list = document.createElement('ul');
        images.forEach((src) => {
          const li = document.createElement('li');
          li.append(createLink(src, src));
          list.append(li);
        });

        details.append(summary, list);
        rowsEl.append(details);
      },
      concurrent: 50,
    });
    await results;

    scanEl.dataset.totalImages = totalImageCount;

    if (!docCount) emptyEl.setAttribute('aria-hidden', false);
  } catch (error) {
    const pre = document.createElement('pre');
    pre.textContent = `Error: ${error.message}`;
    rowsEl.append(pre);
  } finally {
    setButtonsDisabled(false);
  }
}

/**
 * Runs the preview phase: crawls the site and shows path mappings without migrating.
 */
async function runPreview() {
  saveFormState();
  const config = getConfig();

  showResults('preview');
  setButtonsDisabled(true);

  const previewEl = document.querySelector('.result.preview');
  const rowsEl = previewEl.querySelector('.rows');
  const countEl = document.getElementById('preview-count');
  const timeEl = document.getElementById('preview-time');
  const emptyEl = previewEl.querySelector('.empty');

  rowsEl.innerHTML = '';
  countEl.textContent = '0';
  timeEl.textContent = '0.00s';
  emptyEl.setAttribute('aria-hidden', true);
  previewEl.removeAttribute('data-show');

  const startTime = Date.now();
  let imageCount = 0;

  try {
    const {
      org, repo, repoPath, authOpts,
    } = await getAuth();

    const { results } = crawl({
      path: `${repoPath}${config.crawlPath}`,
      callback: async (item) => {
        const images = await scanDocument(item, config.srcFilter, authOpts);
        if (!images) return;

        imageCount += images.length;
        countEl.textContent = imageCount;
        timeEl.textContent = elapsed(startTime);

        images.forEach((src) => {
          const daPath = buildDaImagePath(src, config.pathPrefix, config.destPath);

          const group = document.createElement('div');
          group.className = 'group';

          const { origin, pathname } = new URL(src);
          const fromEl = createLink(src, pathname);
          fromEl.className = 'from';
          const originSpan = document.createElement('span');
          originSpan.className = 'origin';
          originSpan.textContent = origin;
          fromEl.prepend(originSpan);

          const toEl = document.createElement('div');
          toEl.className = 'to';
          const toOriginSpan = document.createElement('span');
          toOriginSpan.className = 'origin';
          toOriginSpan.textContent = `https://main--${repo}--${org}.aem.page`;
          toEl.append(toOriginSpan, daPath);

          group.append(fromEl, toEl);
          rowsEl.append(group);
        });
      },
      concurrent: 50,
    });
    await results;

    if (!imageCount) emptyEl.setAttribute('aria-hidden', false);
  } catch (error) {
    const pre = document.createElement('pre');
    pre.textContent = `Error: ${error.message}`;
    rowsEl.append(pre);
  } finally {
    setButtonsDisabled(false);
  }
}

/**
 * Runs the migration phase: processes all matched pages and reports results.
 */
async function runMigration() {
  saveFormState();
  const config = getConfig();

  showResults('run');
  setButtonsDisabled(true);

  const remainingEl = document.getElementById('run-remaining');
  const errorsEl = document.getElementById('run-errors');
  const successEl = document.getElementById('run-success');
  const totalEl = document.getElementById('run-total');
  const rowsEl = document.querySelector('.result.run .rows');

  rowsEl.innerHTML = '';
  rowsEl.removeAttribute('data-filter');
  document.querySelectorAll('.stat').forEach((s) => s.removeAttribute('data-active'));

  // Pre-populate pending rows from scan results
  const pendingMap = new Map();
  document.querySelectorAll('.result.scan .rows .group').forEach((scanItem) => {
    const pathEl = scanItem.querySelector('summary span');
    if (!pathEl) return;
    const path = pathEl.textContent;
    const imageCount = scanItem.querySelectorAll('ul li').length;
    const el = document.createElement('div');
    el.className = 'group';
    el.dataset.status = 'remaining';
    const p = document.createElement('p');
    p.textContent = path;
    el.append(p);
    pendingMap.set(path, { el, imageCount });
    rowsEl.append(el);
  });

  let total = 0;
  pendingMap.forEach(({ imageCount }) => { total += imageCount; });
  if (!total) total = Number(document.querySelector('.result.scan').dataset.totalImages) || 0;
  let remaining = total;
  let errorCount = 0;
  let successCount = 0;

  remainingEl.textContent = remaining;
  errorsEl.textContent = errorCount;
  successEl.textContent = successCount;
  totalEl.textContent = total;

  try {
    const { repoPath, authOpts } = await getAuth();

    const { results } = crawl({
      path: `${repoPath}${config.crawlPath}`,
      callback: async (item) => {
        const itemPath = stripHtml(item.path);
        if (!itemPath) return;

        const pending = pendingMap.get(itemPath);
        let result;
        try {
          result = await processDocument(
            item,
            repoPath,
            config.srcFilter,
            config.pathPrefix,
            config.destPath,
            config.draftMode,
            config.draftFolder,
            authOpts,
          );
        } catch (error) {
          const pageErrorCount = pending ? pending.imageCount : 1;
          errorCount += pageErrorCount;
          remaining = Math.max(0, total - successCount - errorCount);
          remainingEl.textContent = remaining;
          errorsEl.textContent = errorCount;
          totalEl.textContent = successCount + errorCount + remaining;
          const errGroup = document.createElement('div');
          errGroup.className = 'group';
          errGroup.dataset.status = 'error';
          const p = document.createElement('p');
          p.textContent = `${error.message}: ${itemPath}`;
          errGroup.append(p);
          if (pending) {
            pending.el.replaceWith(errGroup);
            pendingMap.delete(itemPath);
          } else {
            rowsEl.append(errGroup);
          }
          return;
        }

        if (!result) {
          if (pending) {
            pending.el.remove();
            total -= pending.imageCount;
            remaining = Math.max(0, total - successCount - errorCount);
            remainingEl.textContent = remaining;
            totalEl.textContent = successCount + errorCount + remaining;
            pendingMap.delete(itemPath);
          }
          return;
        }

        const processedCount = result.fetchFailed ? 0 : result.images.length;
        const pageSuccessCount = result.fetchFailed
          ? 0
          : result.images.filter((img) => img.ok).length;
        let pageErrorCount;
        if (result.fetchFailed) {
          pageErrorCount = pending ? pending.imageCount : 0;
        } else {
          pageErrorCount = processedCount - pageSuccessCount;
        }

        successCount += pageSuccessCount;
        errorCount += pageErrorCount;
        remaining = Math.max(0, total - successCount - errorCount);

        remainingEl.textContent = remaining;
        successEl.textContent = successCount;
        errorsEl.textContent = errorCount;
        totalEl.textContent = successCount + errorCount + remaining;

        const pageGroup = buildRunPageGroup(result, repoPath, itemPath);

        if (pending) {
          pending.el.replaceWith(pageGroup);
          pendingMap.delete(itemPath);
        } else {
          rowsEl.append(pageGroup);
        }
      },
      concurrent: 50,
    });
    await results;
  } catch (error) {
    const div = document.createElement('div');
    div.className = 'group';
    div.dataset.status = 'error';
    const p = document.createElement('p');
    p.textContent = error.message;
    div.append(p);
    rowsEl.append(div);
    errorCount += 1;
    errorsEl.textContent = errorCount;
  } finally {
    setButtonsDisabled(false);
  }
}

/* init */

/**
 * Updates the help text below the output mode toggle.
 * @param {string} mode - The selected mode: 'draft' or 'overwrite'
 */
function updateModeDescription(mode) {
  const text = mode === 'draft'
    ? 'Save updated pages as copies in a draft folder.'
    : 'Overwrite image srcs in the original pages directly.';
  document.getElementById('mode-description').textContent = text;
}

/**
 * Restores form field values and autocomplete history from localStorage.
 */
function initFields(doc) {
  ['crawl-path', 'url-filter', 'path-prefix', 'dest-path', 'draft-folder'].forEach((id) => {
    const history = loadHistory(id);
    if (!history.length) return;

    const [latest] = history;
    doc.getElementById(id).value = latest;

    const datalist = doc.getElementById(`${id}-list`);
    history.forEach((val) => {
      const option = doc.createElement('option');
      option.value = val;
      datalist.append(option);
    });
  });

  const savedMode = localStorage.getItem('image-migration:output-mode');
  if (savedMode) {
    const radio = doc.querySelector(`input[name="output-mode"][value="${savedMode}"]`);
    if (radio) {
      radio.checked = true;
      doc.getElementById('draft-folder-row').toggleAttribute('data-hidden', savedMode !== 'draft');
    }
  }

  const activeMode = doc.querySelector('input[name="output-mode"]:checked');
  if (activeMode) updateModeDescription(activeMode.value);
}

/**
 * Initializes click handlers on the run stats bar for filtering result rows.
 * Clicking an active stat deactivates the filter; clicking Total shows all rows.
 */
function initRunFilter(doc) {
  doc.querySelectorAll('.stat').forEach((stat) => {
    stat.addEventListener('click', () => {
      const rowsEl = doc.querySelector('.result.run .rows');
      const statFilter = stat.dataset.filter;
      const isAlreadyActive = stat.hasAttribute('data-active');

      let nextFilter;
      if (isAlreadyActive) {
        nextFilter = 'off';
      } else if (statFilter === 'total') {
        nextFilter = null;
      } else {
        nextFilter = statFilter;
      }

      if (nextFilter) {
        rowsEl.dataset.filter = nextFilter;
      } else {
        delete rowsEl.dataset.filter;
      }

      const activeFilter = nextFilter === null ? 'total' : nextFilter;
      doc.querySelectorAll('.stat').forEach((s) => {
        s.toggleAttribute('data-active', activeFilter !== 'off' && s.dataset.filter === activeFilter);
      });
    });
  });
}

function initListeners(doc) {
  doc.querySelector('.mode-toggle').addEventListener('change', (e) => {
    doc.getElementById('draft-folder-row').toggleAttribute('data-hidden', e.target.value !== 'draft');
    updateModeDescription(e.target.value);
  });

  doc.getElementById('toggle-origin').addEventListener('click', () => {
    const previewEl = doc.querySelector('.result.preview');
    if (previewEl.getAttribute('data-show') === 'origins') {
      previewEl.removeAttribute('data-show');
    } else {
      previewEl.setAttribute('data-show', 'origins');
    }
  });

  doc.getElementById('scan').addEventListener('click', runScan);
  doc.getElementById('preview').addEventListener('click', runPreview);
  doc.getElementById('run').addEventListener('click', runMigration);
}

initFields(document);
initRunFilter(document);
initListeners(document);
