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
import { addDnt, translate, EDITOR_FORMAT } from './shared.js';

(async function init() {
  // eslint-disable-next-line no-unused-vars
  const { context, token, actions } = await DA_SDK;

  const isLightVersion = window.innerWidth < 500;

  let selection = 'No text selected.';
  try {
    selection = await actions.getSelection();
    selection = addDnt(selection, EDITOR_FORMAT);
  } catch (error) {
    // ignore
  }

  const inputTextarea = document.querySelector('textarea[name="input"]');
  inputTextarea.value = selection;

  const outputTextarea = document.querySelector('textarea[name="output"]');
  outputTextarea.value = '';

  const languageSelector = document.querySelector('select[name="language"]');
  languageSelector.value = 'fr';

  const translateBtn = document.querySelector('button[name="translate"]');
  const errorMessage = document.querySelector('.translate-error');

  translateBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (errorMessage) {
      errorMessage.textContent = '';
      errorMessage.style.display = 'none';
    }
    let translation = '';
    try {
      translation = await translate(
        inputTextarea.value,
        languageSelector.value,
        context,
        EDITOR_FORMAT,
        true,
      );
    } catch (error) {
      if (errorMessage) {
        errorMessage.textContent = error?.message || 'Translation failed.';
        errorMessage.style.display = 'block';
      }
      return;
    }

    if (isLightVersion) {
      actions.sendHTML(translation);
      actions.closeLibrary();
    } else {
      outputTextarea.value = translation;
    }
  });

  const replaceBtn = document.querySelector('button[name="replace"]');
  replaceBtn.textContent = 'Replace';
  replaceBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    actions.sendHTML(outputTextarea.value);
    actions.closeLibrary();
  });
}());
