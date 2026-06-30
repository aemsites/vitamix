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
// Each entry maps a locale+language combination to a Google Translate language code.
// The page path structure expected: /<locale>/<language>/...
export const LOCALES = [
  {
    locale: 'us', language: 'en_us', translateCode: 'en', country: 'United States', label: 'English',
  },
  {
    locale: 'ca', language: 'en_us', translateCode: 'en', country: 'Canada', label: 'English',
  },
  {
    locale: 'ca', language: 'fr_ca', translateCode: 'fr-CA', country: 'Canada', label: 'French',
  },
  {
    locale: 'mx', language: 'en_us', translateCode: 'en', country: 'Mexico', label: 'English',
  },
  {
    locale: 'mx', language: 'es_mx', translateCode: 'es-MX', country: 'Mexico', label: 'Spanish',
  },
  {
    locale: 'vr', language: 'en_us', translateCode: 'en', country: 'VR', label: 'English',
  },
];
