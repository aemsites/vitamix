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
import { translate, ADMIN_URL, AEM_ADMIN_URL } from './shared.js';

const LOCALES = [
  {
    locale: 'us', language: 'en_us', translateCode: 'en', label: 'English',
  },
  {
    locale: 'ca', language: 'fr_ca', translateCode: 'fr-CA', label: 'French',
  },
  {
    locale: 'mx', language: 'es_mx', translateCode: 'es-MX', label: 'Spanish',
  },
];

const EDIT_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';

function parsePath(path) {
  // path = /<locale>/<language>/... (org/repo already stripped)
  const parts = path.replace(/^\/+/, '').split('/');
  if (parts.length < 2) return null;
  const [locale, language] = parts;
  if (!/^[a-z]{2}$/i.test(locale) || !/^[a-z]{2}[_-][a-z]{2}$/i.test(language)) return null;
  const pagePath = parts.length > 2 ? `/${parts.slice(2).join('/')}` : '';
  return {
    locale,
    language,
    pagePath,
    repoPath: `/${locale}/${language}${pagePath}`,
  };
}

function updateStatus(language, status, text) {
  const labelEl = document.querySelector(`label[for="lang-${language}"]`);
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
const errorMessage = document.querySelector('.rollout-error');

(async function init() {
  const { context, actions } = await DA_SDK;
  const { daFetch } = actions;

  const currentPath = context.path;
  const parsed = parsePath(currentPath);

  if (!parsed) {
    errorMessage.textContent = 'This page is not under a locale path (e.g. /us/en_us/…). Rollout is not available here.';
    errorMessage.style.display = 'block';
    return;
  }

  LOCALES.forEach(({ locale, language, label }) => {
    if (language.toLowerCase() === parsed.language.toLowerCase()) return;

    const id = `lang-${language}`;
    const labelEl = document.createElement('label');
    labelEl.className = 'rollout-lang';
    labelEl.setAttribute('for', id);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = id;
    checkbox.dataset.locale = locale;
    checkbox.dataset.language = language;
    checkbox.checked = true;

    const span = document.createElement('span');
    span.textContent = label;

    labelEl.appendChild(checkbox);
    labelEl.appendChild(span);
    languagesContainer.appendChild(labelEl);
  });

  rolloutBtn.hidden = false;

  rolloutBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    errorMessage.textContent = '';
    errorMessage.style.display = 'none';
    document.querySelectorAll('.rollout-status').forEach((el) => el.remove());

    const selectedLocales = LOCALES.filter(({ language }) => {
      const checkbox = document.getElementById(`lang-${language}`);
      return checkbox?.checked;
    });

    if (selectedLocales.length === 0) {
      errorMessage.textContent = 'Please select at least one language.';
      errorMessage.style.display = 'block';
      return;
    }

    rolloutBtn.disabled = true;

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
    for (const {
      locale, language, translateCode,
    } of selectedLocales) {
      updateStatus(language, 'loading', 'Translating...');

      const targetPagePath = `/${locale}/${language}${parsed.pagePath}`;

      // eslint-disable-next-line no-await-in-loop
      try {
        context.sourcePath = parsed.repoPath;

        // eslint-disable-next-line no-await-in-loop
        const translatedHtml = await translate(
          sourceHtml,
          translateCode,
          context,
          undefined, // format: handle both editor and admin format
          daFetch,
        );

        updateStatus(language, 'saving', 'Saving...');

        const blob = new Blob([translatedHtml], { type: 'text/html' });
        const formData = new FormData();
        formData.append('data', blob);

        const p = targetPagePath.endsWith('.html') ? targetPagePath : `${targetPagePath}.html`;
        const targetUrl = `${ADMIN_URL}/source/${context.org}/${context.repo}${p}`;
        // eslint-disable-next-line no-await-in-loop
        const saveResp = await daFetch(targetUrl, { method: 'PUT', body: formData });
        if (!saveResp.ok) throw new Error(`Save failed: ${saveResp.status}`);

        updateStatus(language, 'previewing', 'Previewing...');
        const base = `${AEM_ADMIN_URL}/%s/${context.org}/${context.repo}/main${targetPagePath}`;
        // eslint-disable-next-line no-await-in-loop
        const previewResp = await daFetch(base.replace('%s', 'preview'), { method: 'POST' });
        if (!previewResp.ok) throw new Error(`Preview failed: ${previewResp.status}`);

        updateStatus(language, 'publishing', 'Publishing...');
        // eslint-disable-next-line no-await-in-loop
        const publishResp = await daFetch(base.replace('%s', 'live'), { method: 'POST' });
        if (!publishResp.ok) throw new Error(`Publish failed: ${publishResp.status}`);

        const daHref = `https://da.live/edit#/${context.org}/${context.repo}${targetPagePath}`;
        updateStatus(language, 'done', `Done! <a href="${daHref}" target="_blank">${EDIT_ICON_SVG}</a>`);
      } catch (err) {
        updateStatus(language, 'error', err.message || 'Translation failed.');
      }
    }

    rolloutBtn.disabled = false;
  });
}());
