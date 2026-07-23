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

// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { localeKey, parsePath, rolloutToLocale } from './shared.js';
import { ADMIN_URL, LOCALES } from './config.js';

const EDIT_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';

function updateStatus(prefix, status, text) {
  const labelEl = document.querySelector(`label[for="lang-${localeKey(prefix)}"]`);
  if (!labelEl) return;
  let statusEl = labelEl.querySelector('.rollout-status');
  if (!statusEl) {
    statusEl = document.createElement('span');
    statusEl.className = 'rollout-status';
    labelEl.appendChild(statusEl);
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

  LOCALES.forEach(({ prefix, country, label }) => {
    if (prefix === parsed.prefix) return;

    const id = `lang-${localeKey(prefix)}`;
    const labelEl = document.createElement('label');
    labelEl.className = 'rollout-lang';
    labelEl.setAttribute('for', id);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = id;
    checkbox.dataset.prefix = prefix;
    checkbox.checked = true;

    const span = document.createElement('span');
    span.textContent = [country, label].filter(Boolean).join(' — ');

    labelEl.appendChild(checkbox);
    labelEl.appendChild(span);
    languagesContainer.appendChild(labelEl);
  });

  rolloutOptions.hidden = false;
  rolloutBtn.hidden = false;

  rolloutBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    errorMessage.textContent = '';
    errorMessage.style.display = 'none';
    document.querySelectorAll('.rollout-status').forEach((el) => el.remove());

    const selectedLocales = LOCALES.filter(({ prefix }) => {
      const checkbox = document.getElementById(`lang-${localeKey(prefix)}`);
      return checkbox?.checked;
    });

    if (selectedLocales.length === 0) {
      errorMessage.textContent = 'Please select at least one target locale.';
      errorMessage.style.display = 'block';
      return;
    }

    rolloutBtn.disabled = true;

    const sourceLocale = LOCALES.find(({ prefix }) => prefix === parsed.prefix);
    const sourceTranslateCode = sourceLocale?.translateCode;

    // Fetch the source page HTML (repoPath is already relative to org/repo)
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

    // eslint-disable-next-line no-restricted-syntax
    for (const { prefix, translateCode } of selectedLocales) {
      try {
        // eslint-disable-next-line no-await-in-loop
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
        updateStatus(prefix, 'error', err.message || 'Translation failed.');
      }
    }

    rolloutBtn.disabled = false;
  });
}());
