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
import { translate, ADMIN_FORMAT } from './shared.js';

const ADMIN_URL = 'https://admin.da.live';
// const ADMIN_URL = 'https://stage-admin.da.live';
// const ADMIN_URL = 'http://localhost:8787';

(async function init() {
  // eslint-disable-next-line no-unused-vars
  const { context, token, actions } = await DA_SDK;
  const { daFetch } = actions;

  const urlsTextarea = document.querySelector('textarea[name="urls"]');
  const languageSelect = document.querySelector('select[name="language"]');
  languageSelect.value = 'fr';
  const translateButton = document.querySelector('button[name="translate"]');
  const outputList = document.querySelector('.app-output-list');
  const errorMessage = document.querySelector('.app-error');

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
      const listItem = document.createElement('li');
      listItem.textContent = urls[i];
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
            ADMIN_FORMAT,
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
          updateStatus(listItem, 'saved', `Translated page saved! View page: <a href="${daHref}" target="_blank">${daHref}</a>`);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error('Error retrieving page content', error);
          updateStatus(listItem, 'error', `Page content cannot be retrieved: (${error.message || 'Check console for details'})`);
        }
      }
    }
  });
}());
