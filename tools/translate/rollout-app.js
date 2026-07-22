/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
/* eslint-disable no-continue */
/* eslint-disable no-await-in-loop */

// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import {
  localeKey, parsePath, sourceStatus, bulkStatus, getRedirects, rolloutToLocale,
} from './shared.js';
import { ADMIN_URL, LOCALES } from './config.js';

const EDIT_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
const PREVIEW_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const PUBLISH_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';

// Number of URLs prepared (and HEAD-checked against every locale) concurrently per batch.
// Keeps large folders (thousands of pages) from firing thousands of requests at once.
// (Preview/publish status is fetched separately, in a single bulk-status job for
// every row, since that endpoint is designed for exactly that.)
const PREPARE_BATCH_SIZE = 20;

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return dateFormatter.format(date);
}

function resolveResourcePath(urlStr, context) {
  let url;
  try {
    url = new URL(urlStr);
  } catch (error) {
    return null;
  }

  const isDaLiveEditUrl = url.toString().startsWith(`https://da.live/edit#/${context.org}/${context.repo}/`);
  const isPreviewUrl = url.hostname.includes(`${context.repo}--${context.org}`);
  if (!isDaLiveEditUrl && !isPreviewUrl) return null;

  return isDaLiveEditUrl
    ? url.hash.replace(/^#/, '').replace(`/${context.org}/${context.repo}`, '')
    : url.pathname;
}

(async function init() {
  const { context, actions } = await DA_SDK;
  const { daFetch } = actions;

  const urlsTextarea = document.querySelector('textarea[name="urls"]');
  const prepareButton = document.querySelector('button[name="prepare"]');
  const rolloutButton = document.querySelector('button[name="rollout"]');
  const optionsRow = document.querySelector('.rollout-app-options');
  const previewCheckbox = document.querySelector('input[name="preview"]');
  const publishCheckbox = document.querySelector('input[name="publish"]');
  const tableHead = document.querySelector('.rollout-app-table thead');
  const tableBody = document.querySelector('.rollout-app-table tbody');
  const tableFoot = document.querySelector('.rollout-app-table tfoot');
  const errorMessage = document.querySelector('.app-error');
  const loadFromFolderLink = document.querySelector('#load-from-folder');
  const loaderRow = document.querySelector('.app-input-loader');
  const folderInput = document.querySelector('input[name="folder"]');
  const loadFromFolderButton = document.querySelector('button[name="load-from-folder"]');
  const folderLoaderErrorMessage = document.querySelector('.app-folder-loader-error');

  publishCheckbox.addEventListener('change', () => {
    if (publishCheckbox.checked) {
      previewCheckbox.checked = true;
      previewCheckbox.disabled = true;
    } else {
      previewCheckbox.disabled = false;
    }
  });

  loadFromFolderLink.addEventListener('click', (e) => {
    e.preventDefault();
    folderInput.value = `https://da.live/#/${context.org}/${context.repo}/us/en_us`;

    loaderRow.classList.toggle('open');
  });

  loadFromFolderButton.addEventListener('click', async (e) => {
    e.preventDefault();
    folderLoaderErrorMessage.textContent = '';
    folderLoaderErrorMessage.style.display = 'none';

    const folder = folderInput.value;
    let url;
    try {
      url = new URL(folder);
    } catch (error) {
      folderLoaderErrorMessage.textContent = `Invalid folder URL: ${error.message}`;
      folderLoaderErrorMessage.style.display = 'block';
      return;
    }

    if (!folder.startsWith(`https://da.live/#/${context.org}/${context.repo}`)) {
      folderLoaderErrorMessage.textContent = `Folder URL must be a valid da.live folder URL - example: https://da.live/#/${context.org}/${context.repo}/...`;
      folderLoaderErrorMessage.style.display = 'block';
      return;
    }

    const pathname = url.hash.replace(`#/${context.org}/${context.repo}`, '');
    const listUrl = `${ADMIN_URL}/list/${context.org}/${context.repo}${pathname}`;
    const resp = await daFetch(listUrl);
    if (!resp.ok) {
      folderLoaderErrorMessage.textContent = `Failed to load folder list: ${resp.statusText}`;
      folderLoaderErrorMessage.style.display = 'block';
      return;
    }

    const list = await resp.json();
    urlsTextarea.value = list.filter((item) => item.ext === 'html')
      .map((item) => `https://da.live/edit#${item.path.replace(/\.html$/, '')}`).join('\n');
    loaderRow.classList.toggle('open');
  });

  let rows = [];

  const cellSelector = (rowIndex, prefix) => `td[data-row="${rowIndex}"][data-prefix="${localeKey(prefix)}"]`;

  const updateRowLangStatus = (rowIndex, prefix, status, text) => {
    const cell = document.querySelector(cellSelector(rowIndex, prefix));
    if (!cell) return;
    let statusEl = cell.querySelector('.rollout-status');
    if (!statusEl) {
      statusEl = document.createElement('span');
      statusEl.className = 'rollout-status';
      cell.appendChild(statusEl);
    }
    statusEl.className = `rollout-status ${status}`;
    statusEl.innerHTML = text;
  };

  const renderTableHead = () => {
    tableHead.innerHTML = '';
    const tr = document.createElement('tr');

    const pathTh = document.createElement('th');
    pathTh.className = 'rollout-app-path-col';
    pathTh.textContent = 'Page';
    tr.appendChild(pathTh);

    LOCALES.forEach((locale) => {
      const th = document.createElement('th');
      th.className = 'rollout-app-locale-col';
      th.textContent = [locale.country, locale.label].filter(Boolean).join(' — ');
      tr.appendChild(th);
    });

    tableHead.appendChild(tr);
  };

  const renderTableFoot = () => {
    tableFoot.innerHTML = '';
    if (rows.length === 0) return;

    const tr = document.createElement('tr');

    const labelTd = document.createElement('td');
    labelTd.className = 'rollout-app-path-cell rollout-app-select-all-label';
    labelTd.textContent = 'Select all';
    tr.appendChild(labelTd);

    LOCALES.forEach((locale) => {
      const { prefix } = locale;
      const td = document.createElement('td');
      td.className = 'rollout-app-cell';

      const checkboxes = rows.flatMap(
        (row) => row.locales.filter((l) => l.prefix === prefix).map((l) => l.checkbox),
      );

      if (checkboxes.length > 0) {
        const labelEl = document.createElement('label');
        labelEl.className = 'rollout-checkbox';
        const localeName = [locale.country, locale.label].filter(Boolean).join(' — ');
        labelEl.title = `Select all — ${localeName}`;

        const selectAllCheckbox = document.createElement('input');
        selectAllCheckbox.type = 'checkbox';
        selectAllCheckbox.checked = checkboxes.every((cb) => cb.checked);
        selectAllCheckbox.addEventListener('change', () => {
          checkboxes.forEach((cb) => { cb.checked = selectAllCheckbox.checked; });
        });

        const box = document.createElement('span');
        box.className = 'rollout-checkbox-box';

        labelEl.appendChild(selectAllCheckbox);
        labelEl.appendChild(box);
        td.appendChild(labelEl);
      }

      tr.appendChild(td);
    });

    tableFoot.appendChild(tr);
  };

  const buildPathCell = (index, urlStr, text) => {
    const pathTd = document.createElement('td');
    pathTd.className = 'rollout-app-path-cell';
    const badge = document.createElement('span');
    badge.className = 'app-li-number';
    badge.textContent = `${index + 1}.`;
    const a = document.createElement('a');
    a.href = urlStr;
    a.textContent = text;
    a.target = '_blank';
    pathTd.appendChild(badge);
    pathTd.appendChild(a);
    return pathTd;
  };

  const buildErrorRow = (index, urlStr, message) => {
    const tr = document.createElement('tr');
    tr.appendChild(buildPathCell(index, urlStr, urlStr));

    const errorTd = document.createElement('td');
    errorTd.colSpan = LOCALES.length;
    const status = document.createElement('span');
    status.className = 'rollout-status error';
    status.textContent = message;
    errorTd.appendChild(status);
    tr.appendChild(errorTd);

    return { tr, row: null };
  };

  const buildStatusIcon = (svg, active, title, href) => {
    const a = document.createElement('a');
    a.className = `rollout-status-icon${active ? ' active' : ''}`;
    a.innerHTML = svg;
    a.title = title;
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  };

  const buildPendingStatusIcons = () => {
    const container = document.createElement('span');
    container.className = 'rollout-status-icons rollout-status-icons-pending';
    const spinner = document.createElement('span');
    spinner.className = 'rollout-status-spinner';
    spinner.title = 'Checking preview/publish status…';
    container.appendChild(spinner);
    return container;
  };

  const buildRedirectIcon = (href) => {
    const a = document.createElement('a');
    a.className = 'rollout-status-icon rollout-status-icon-redirect';
    a.textContent = '301';
    a.title = 'Redirects (301) — open destination';
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  };

  const buildStatusIcons = (entry, targetPagePath) => {
    const container = document.createElement('span');
    container.className = 'rollout-status-icons';

    const previewDate = formatDate(entry?.previewLastModified);
    const publishDate = formatDate(entry?.publishLastModified);

    const previewTitle = previewDate ? `Previewed ${previewDate}` : 'Not previewed';
    const publishTitle = publishDate ? `Published ${publishDate}` : 'Not published';
    const previewUrl = `https://main--${context.repo}--${context.org}.aem.page${targetPagePath}`;
    const liveUrl = `https://main--${context.repo}--${context.org}.aem.live${targetPagePath}`;
    container.appendChild(
      buildStatusIcon(PREVIEW_ICON_SVG, !!previewDate, previewTitle, previewUrl),
    );
    container.appendChild(buildStatusIcon(PUBLISH_ICON_SVG, !!publishDate, publishTitle, liveUrl));

    return container;
  };

  const buildDataRow = async (i, urlStr, parsed) => {
    const sourceLocale = LOCALES.find(({ prefix }) => prefix === parsed.prefix);

    const tr = document.createElement('tr');
    tr.appendChild(buildPathCell(i, urlStr, parsed.repoPath));

    const cells = await Promise.all(LOCALES.map(async (locale) => {
      const { prefix } = locale;
      const td = document.createElement('td');
      td.className = 'rollout-app-cell';
      td.dataset.row = i;
      td.dataset.prefix = localeKey(prefix);

      const isSource = prefix === parsed.prefix;
      const targetPagePath = isSource ? parsed.repoPath : `${prefix}${parsed.pagePath}`;
      const status = await sourceStatus(targetPagePath, context, daFetch);
      const lastModified = formatDate(status.lastModified);

      if (isSource) td.classList.add('rollout-app-cell-source');

      const labelEl = document.createElement('label');
      labelEl.className = 'rollout-checkbox';
      const titleParts = [isSource ? 'Source' : null, lastModified ? `Last modified ${lastModified}` : null];
      const title = titleParts.filter(Boolean).join(' — ');
      if (title) labelEl.title = title;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      if (isSource) {
        checkbox.checked = false;
        checkbox.disabled = true;
      } else {
        checkbox.checked = !status.exists;
      }

      const box = document.createElement('span');
      box.className = 'rollout-checkbox-box';

      labelEl.appendChild(checkbox);
      labelEl.appendChild(box);

      const content = document.createElement('div');
      content.className = 'rollout-app-cell-content';
      content.appendChild(labelEl);
      content.appendChild(buildPendingStatusIcons());
      td.appendChild(content);

      return {
        td,
        locale: isSource ? null : { ...locale, checkbox },
        targetInfo: { targetPagePath, content },
      };
    }));

    const rowLocales = [];
    const targetInfos = [];
    cells.forEach(({ td, locale, targetInfo }) => {
      tr.appendChild(td);
      if (locale) rowLocales.push(locale);
      if (targetInfo) targetInfos.push(targetInfo);
    });

    return {
      tr,
      targetInfos,
      row: {
        index: i, urlStr, parsed, sourceLocale, locales: rowLocales,
      },
    };
  };

  prepareButton.addEventListener('click', async (e) => {
    e.preventDefault();
    errorMessage.textContent = '';
    errorMessage.style.display = 'none';
    tableBody.innerHTML = '';
    tableFoot.innerHTML = '';
    renderTableHead();
    optionsRow.hidden = true;
    rolloutButton.hidden = true;
    rows = [];

    const urls = urlsTextarea.value.split('\n').map((u) => u.trim()).filter(Boolean);
    if (urls.length === 0) {
      errorMessage.textContent = 'Please enter a list of URLs to rollout';
      errorMessage.style.display = 'block';
      return;
    }

    prepareButton.disabled = true;

    // Parse every URL up front (cheap, synchronous) so every target path is known
    // before any network call runs. This lets the bulk-status job — slow, and
    // covering every row's target paths in one shot — start immediately, in
    // parallel with the per-row existence checks below, instead of waiting for
    // rows to finish rendering first.
    const parsedEntries = urls.map((urlStr, i) => {
      const resourcePath = resolveResourcePath(urlStr, context);
      if (!resourcePath) {
        return { i, urlStr, error: 'Must be a valid URL from this organization and repository' };
      }
      const parsed = parsePath(resourcePath);
      if (!parsed) {
        return { i, urlStr, error: 'Not under a configured locale path' };
      }
      return { i, urlStr, parsed };
    });

    const allTargetPaths = [];
    parsedEntries.forEach(({ parsed }) => {
      if (!parsed) return;
      LOCALES.forEach(({ prefix }) => {
        const targetPagePath = prefix === parsed.prefix ? parsed.repoPath : `${prefix}${parsed.pagePath}`;
        allTargetPaths.push(targetPagePath);
      });
    });

    const statusMapPromise = bulkStatus(allTargetPaths, context, daFetch).catch((err) => {
      // Non-fatal: rows stay usable, just without preview/publish icons.
      // eslint-disable-next-line no-console
      console.error('Bulk status failed', err);
      return {};
    });
    const redirectsPromise = getRedirects(context, daFetch);

    // Rows are built in fixed-size batches (each row's own locale checks run in
    // parallel within a batch) so folders with thousands of pages don't fire
    // thousands of concurrent HEAD requests at once. Rows render batch by batch.
    const allTargetInfos = [];
    for (let start = 0; start < parsedEntries.length; start += PREPARE_BATCH_SIZE) {
      const batch = parsedEntries.slice(start, start + PREPARE_BATCH_SIZE);

      // eslint-disable-next-line no-await-in-loop
      const built = await Promise.all(batch.map(({
        i, urlStr, parsed, error,
      }) => (error ? buildErrorRow(i, urlStr, error) : buildDataRow(i, urlStr, parsed))));

      // eslint-disable-next-line no-restricted-syntax
      for (const { tr, row, targetInfos } of built) {
        tableBody.appendChild(tr);
        if (row) rows.push(row);
        allTargetInfos.push(...(targetInfos || []));
      }
    }

    renderTableFoot();

    const [statusMap, redirects] = await Promise.all([statusMapPromise, redirectsPromise]);
    allTargetInfos.forEach(({ targetPagePath, content }) => {
      content.querySelector('.rollout-status-icons-pending')?.remove();
      const container = buildStatusIcons(statusMap[targetPagePath], targetPagePath);
      content.appendChild(container);

      const destination = redirects.get(targetPagePath);
      if (destination) {
        const destinationUrl = destination.startsWith('http')
          ? destination
          : `https://main--${context.repo}--${context.org}.aem.live${destination}`;
        container.appendChild(buildRedirectIcon(destinationUrl));
      }
    });

    prepareButton.disabled = false;

    if (rows.length > 0) {
      optionsRow.hidden = false;
      rolloutButton.hidden = false;
    }
  });

  rolloutButton.addEventListener('click', async (e) => {
    e.preventDefault();
    rolloutButton.disabled = true;

    // eslint-disable-next-line no-restricted-syntax
    for (const row of rows) {
      const {
        index, parsed, sourceLocale, locales,
      } = row;
      const selected = locales.filter(({ checkbox }) => checkbox.checked);
      if (selected.length === 0) continue;

      let sourcePath = parsed.repoPath;
      if (!sourcePath.endsWith('.html')) sourcePath += '.html';
      const sourceUrl = `${ADMIN_URL}/source/${context.org}/${context.repo}${sourcePath}`;

      let sourceHtml;
      try {
        const resp = await daFetch(sourceUrl);
        if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
        sourceHtml = await resp.text();
      } catch (err) {
        selected.forEach(({ prefix }) => {
          updateRowLangStatus(index, prefix, 'error', `Failed to load source page: ${err.message}`);
        });
        continue;
      }

      // eslint-disable-next-line no-restricted-syntax
      for (const { prefix, translateCode } of selected) {
        try {
          const targetPagePath = await rolloutToLocale({
            sourceHtml,
            sourceTranslateCode: sourceLocale?.translateCode,
            targetPrefix: prefix,
            targetTranslateCode: translateCode,
            pagePath: parsed.pagePath,
            context,
            daFetch,
            preview: previewCheckbox.checked,
            publish: publishCheckbox.checked,
            onStatus: (status, text) => updateRowLangStatus(index, prefix, status, text),
          });

          const daHref = `https://da.live/edit#/${context.org}/${context.repo}${targetPagePath}`;
          updateRowLangStatus(index, prefix, 'done', `Done! <a href="${daHref}" target="_blank">${EDIT_ICON_SVG}</a>`);
        } catch (err) {
          updateRowLangStatus(index, prefix, 'error', err.message || 'Rollout failed.');
        }
      }
    }

    rolloutButton.disabled = false;
  });
}());
