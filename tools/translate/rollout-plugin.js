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
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */

// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import {
  localeKey, parsePath, sourceStatus, bulkStatus, getRedirects,
  hasChangedSinceLastRollout, rolloutToLocale,
} from './shared.js';
import {
  EDIT_ICON_SVG, formatDate, buildPendingStatusIcons,
  buildRedirectIcon, buildWarningIcon, buildStatusIcons, redirectDestinationUrl,
} from './rollout-ui.js';
import { ADMIN_URL, LOCALES } from './config.js';

function rowSelector(prefix) {
  return `.rollout-lang-row[data-prefix="${localeKey(prefix)}"]`;
}

function updateStatus(prefix, status, text) {
  const row = document.querySelector(rowSelector(prefix));
  if (!row) return;
  let statusEl = row.querySelector('.rollout-status');
  if (!statusEl) {
    statusEl = document.createElement('span');
    statusEl.className = 'rollout-status';
    row.appendChild(statusEl);
  }
  statusEl.className = `rollout-status ${status}`;
  statusEl.innerHTML = text;
}

const languagesContainer = document.querySelector('.rollout-languages');
const rolloutBtn = document.querySelector('button[name="rollout"]');
const rolloutOptions = document.querySelector('.rollout-options');
const previewCheckbox = document.querySelector('input[name="preview"]');
const publishCheckbox = document.querySelector('input[name="publish"]');
const errorMessage = document.querySelector('.rollout-error');

publishCheckbox.addEventListener('change', () => {
  if (publishCheckbox.checked) {
    previewCheckbox.checked = true;
    previewCheckbox.disabled = true;
  } else {
    previewCheckbox.disabled = false;
  }
});

(async function init() {
  const { context, actions } = await DA_SDK;
  const { daFetch } = actions;

  const currentPath = context.path;
  const parsed = parsePath(currentPath);

  if (!parsed) {
    errorMessage.textContent = 'This page is not under a configured locale path. Rollout is not available here.';
    errorMessage.style.display = 'block';
    return;
  }

  const targetLocales = LOCALES.filter(({ prefix }) => prefix !== parsed.prefix);

  // Each locale's own existence/local-changes checks run in parallel — this is a
  // single page, not a batch, so there's no need for rollout-app's batching.
  const rows = await Promise.all(targetLocales.map(async (locale) => {
    const { prefix, country, label } = locale;
    const targetPagePath = `${prefix}${parsed.pagePath}`;
    const status = await sourceStatus(targetPagePath, context, daFetch);
    const lastModified = formatDate(status.lastModified);
    const hasLocalChanges = status.exists
      && await hasChangedSinceLastRollout(targetPagePath, context, daFetch);

    const row = document.createElement('div');
    row.className = 'rollout-lang-row';
    row.dataset.prefix = localeKey(prefix);

    const labelEl = document.createElement('label');
    labelEl.className = 'rollout-checkbox';
    if (lastModified) labelEl.title = `Last modified ${lastModified}`;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !status.exists;

    const box = document.createElement('span');
    box.className = 'rollout-checkbox-box';

    labelEl.appendChild(checkbox);
    labelEl.appendChild(box);
    row.appendChild(labelEl);

    const nameEl = document.createElement('span');
    nameEl.className = 'rollout-lang-name';
    nameEl.textContent = [country, label].filter(Boolean).join(' — ');
    row.appendChild(nameEl);

    if (hasLocalChanges) row.appendChild(buildWarningIcon());
    row.appendChild(buildPendingStatusIcons());

    languagesContainer.appendChild(row);

    return {
      prefix, translateCode: locale.translateCode, checkbox, targetPagePath, row,
    };
  }));

  rolloutOptions.hidden = false;
  rolloutBtn.hidden = false;

  // Preview/publish status and redirects: one bulk-status job for every
  // target and one redirects.json fetch, same as rollout-app, instead of a
  // separate request per locale.
  const [statusMap, redirects] = await Promise.all([
    bulkStatus(rows.map((r) => r.targetPagePath), context, daFetch).catch((err) => {
      // Non-fatal: rows stay usable, just without preview/publish icons.
      // eslint-disable-next-line no-console
      console.error('Bulk status failed', err);
      return {};
    }),
    getRedirects(context, daFetch),
  ]);

  rows.forEach(({ targetPagePath, row }) => {
    row.querySelector('.rollout-status-icons-pending')?.remove();
    const container = buildStatusIcons(statusMap[targetPagePath], targetPagePath, context);
    row.appendChild(container);

    const destination = redirects.get(targetPagePath);
    if (destination) {
      container.appendChild(buildRedirectIcon(redirectDestinationUrl(destination, context)));
    }
  });

  rolloutBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    errorMessage.textContent = '';
    errorMessage.style.display = 'none';
    document.querySelectorAll('.rollout-status').forEach((el) => el.remove());

    const selectedRows = rows.filter(({ checkbox }) => checkbox.checked);

    if (selectedRows.length === 0) {
      errorMessage.textContent = 'Please select at least one target locale.';
      errorMessage.style.display = 'block';
      return;
    }

    rolloutBtn.disabled = true;

    const sourceLocale = LOCALES.find(({ prefix }) => prefix === parsed.prefix);
    const sourceTranslateCode = sourceLocale?.translateCode;

    let sourcePath = parsed.repoPath;
    if (!sourcePath.endsWith('.html')) sourcePath += '.html';
    const sourceUrl = `${ADMIN_URL}/source/${context.org}/${context.repo}${sourcePath}`;

    let sourceHtml;
    try {
      const resp = await daFetch(sourceUrl);
      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
      sourceHtml = await resp.text();
    } catch (err) {
      errorMessage.textContent = `Failed to load page content: ${err.message}`;
      errorMessage.style.display = 'block';
      rolloutBtn.disabled = false;
      return;
    }

    for (const { prefix, translateCode } of selectedRows) {
      try {
        const targetPagePath = await rolloutToLocale({
          sourceHtml,
          sourceTranslateCode,
          targetPrefix: prefix,
          targetTranslateCode: translateCode,
          pagePath: parsed.pagePath,
          context,
          daFetch,
          preview: previewCheckbox.checked,
          publish: publishCheckbox.checked,
          onStatus: (status, text) => updateStatus(prefix, status, text),
        });

        const daHref = `https://da.live/edit#/${context.org}/${context.repo}${targetPagePath}`;
        updateStatus(prefix, 'done', `Done! <a href="${daHref}" target="_blank">${EDIT_ICON_SVG}</a>`);
      } catch (err) {
        updateStatus(prefix, 'error', err.message || 'Rollout failed.');
      }
    }

    rolloutBtn.disabled = false;
  });
}());
