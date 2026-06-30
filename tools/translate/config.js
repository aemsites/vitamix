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

// DA Admin API endpoint
export const ADMIN_URL = 'https://admin.da.live';
// export const ADMIN_URL = 'https://stage-admin.da.live';
// export const ADMIN_URL = 'http://localhost:8787';

// AEM Admin API endpoint (used for preview/publish)
export const AEM_ADMIN_URL = 'https://admin.hlx.page';

// Translation service endpoint
export const TRANSLATION_SERVICE_URL = 'https://translate.da.live/google';

// Path to the translation config spreadsheet within the repository
export const CONFIG_PATH = '/.da/translate.json';

// Metadata fields that should be translated by default.
// Additional fields can be added via the dt-metadata-fields sheet in CONFIG_PATH.
export const METADATA_FIELDS_TO_TRANSLATE = ['title', 'description'];

// Languages available in the translation plugin and app.
// The first entry is selected by default.
export const LANGUAGES = [
  { code: 'fr-CA', label: 'French (Canada)' },
  { code: 'es-MX', label: 'Spanish (Mexico)' },
  { code: 'en', label: 'English' },
];

// Locales for the rollout plugin.
// Each entry maps a path prefix to a Google Translate language code.
// `prefix` is the path segment(s) before the page path, e.g. '/us/en_us' or '/en'.
// `translateCode` is the language code sent to the translation service.
// `country` is optional and used for display only.
// The first matching prefix for the current page is treated as the source locale.
export const LOCALES = [
  {
    prefix: '/us/en_us', translateCode: 'en', country: 'United States', label: 'English',
  },
  {
    prefix: '/ca/en_us', translateCode: 'en', country: 'Canada', label: 'English',
  },
  {
    prefix: '/ca/fr_ca', translateCode: 'fr-CA', country: 'Canada', label: 'French',
  },
  {
    prefix: '/mx/en_us', translateCode: 'en', country: 'Mexico', label: 'English',
  },
  {
    prefix: '/mx/es_mx', translateCode: 'es-MX', country: 'Mexico', label: 'Spanish',
  },
  {
    prefix: '/vr/en_us', translateCode: 'en', country: 'VR', label: 'English',
  },
];
