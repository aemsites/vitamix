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
import { translate, ADMIN_URL } from './shared.js';

const EDIT_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-edit"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';

(async function init() {
  const { context, actions } = await DA_SDK;
  const { daFetch } = actions;

  const urlsTextarea = document.querySelector('textarea[name="urls"]');
  const languageSelect = document.querySelector('select[name="language"]');
  const translateButton = document.querySelector('button[name="translate"]');
  const outputList = document.querySelector('.app-output-list');
  const errorMessage = document.querySelector('.app-error');
  const loadFromFolderLink = document.querySelector('#load-from-folder');
  const loaderRow = document.querySelector('.app-input-loader');
  const folderInput = document.querySelector('input[name="folder"]');
  const loadFromFolderButton = document.querySelector('button[name="load-from-folder"]');
  const folderLoaderErrorMessage = document.querySelector('.app-folder-loader-error');

  loadFromFolderLink.addEventListener('click', (e) => {
    e.preventDefault();
    folderInput.value = `https://da.live/#/${context.org}/${context.repo}/drafts`;
    loaderRow.classList.toggle('open');
  });

  loadFromFolderButton.addEventListener('click', async (e) => {
    folderLoaderErrorMessage.textContent = '';
    folderLoaderErrorMessage.style.display = 'none';

    e.preventDefault();
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
    urlsTextarea.value = list.filter((item) => item.ext === 'html').map((item) => `https://da.live/edit#${item.path.replace(/\.html$/, '')}`).join('\n');
    loaderRow.classList.toggle('open');
  });

  const updateStatus = (listItem, status, text) => {
    let statusEl = listItem.querySelector('.status');
    if (!statusEl) {
      statusEl = document.createElement('span');
      statusEl.className = 'status';
      listItem.appendChild(statusEl);
    }
    statusEl.className = `status ${status}`;
    statusEl.innerHTML = text;
  };

  translateButton.addEventListener('click', async (e) => {
    e.preventDefault();
    if (errorMessage) {
      errorMessage.textContent = '';
      errorMessage.style.display = 'none';
    }
    const urls = urlsTextarea.value.split('\n').filter((url) => url.trim() !== '');
    if (urls.length === 0) {
      errorMessage.textContent = 'Please enter a list of URLs to translate';
      errorMessage.style.display = 'block';
      return;
    }

    outputList.innerHTML = '';

    // eslint-disable-next-line no-restricted-syntax
    for (let i = 0; i < urls.length; i += 1) {
      // Add a numbered badge to the left of the list item
      const badge = document.createElement('span');
      badge.className = 'app-li-number';
      badge.textContent = `${i + 1}.`;
      badge.style.fontWeight = 'bold';
      badge.style.marginRight = '8px';

      const listItem = document.createElement('li');
      const a = document.createElement('a');
      a.href = urls[i];
      a.textContent = urls[i];
      listItem.appendChild(a);
      listItem.insertBefore(badge, listItem.firstChild);
      outputList.appendChild(listItem);

      let url;
      try {
        url = new URL(urls[i]);
      } catch (error) {
        updateStatus(listItem, 'error', 'Invalid URL format');
        continue;
      }

      // Validate URL format
      // Expected: https://<branch>--<repo>--<org>.<host><path> or https://da.live/edit#/<org>/<repo><path>
      const isDaLiveEditUrl = url.toString().startsWith(`https://da.live/edit#/${context.org}/${context.repo}/`);
      const isPreviewUrl = url.hostname.includes(`${context.repo}--${context.org}`);
      if (!isPreviewUrl && !isDaLiveEditUrl) {
        updateStatus(listItem, 'error', 'Must be a URL from this organization and repository');
      } else {
        updateStatus(listItem, 'loading', 'Loading');

        try {
          const resourcePath = isDaLiveEditUrl ? url.hash.replace(/^#/, '').replace(`/${context.org}/${context.repo}`, '') : url.pathname;
          let sourceUrl = `${ADMIN_URL}/source/${context.org}/${context.repo}${resourcePath}`;

          // if needed, append .html
          if (!sourceUrl.endsWith('.html')) {
            sourceUrl += '.html';
          }

          let resp = await daFetch(sourceUrl);
          if (!resp.ok) {
            updateStatus(listItem, 'error', `Page content cannot be retrieved: (${resp.statusText})`);
            continue;
          }
          const html = await resp.text();

          updateStatus(listItem, 'translating', 'Translating');

          const translatedHtml = await translate(
            html,
            languageSelect.value,
            context,
            undefined, // could be both
            daFetch,
          );

          updateStatus(listItem, 'translated', 'Translated');

          const blob = new Blob([translatedHtml], { type: 'text/html' });
          const formData = new FormData();
          formData.append('data', blob);
          const opts = { method: 'PUT', body: formData };
          resp = await daFetch(sourceUrl, opts);
          if (!resp.ok) {
            updateStatus(listItem, 'error', `Failed to save translated HTML: (${resp.statusText})`);
          }
          const daHref = `https://da.live/edit#/${context.org}/${context.repo}${resourcePath}`;
          updateStatus(listItem, 'saved', `Translated page saved! <a href="${daHref}" target="_blank">${EDIT_ICON_SVG}</a>`);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error('Error retrieving page content', error);
          updateStatus(listItem, 'error', `Page content cannot be retrieved: (${error.message || 'Check console for details'})`);
        }
      }
    }
  });
}());
