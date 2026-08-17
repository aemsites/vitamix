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

/**
 * Resolves the catalog context represented by a product page path.
 * @param {string} pathname - Product page pathname
 * @returns {{storeCode: string, storeViewCode: string, urlKey: string, category?: string}}
 *   Catalog context
 */
export function resolveSyncContext(pathname) {
  const pathParts = pathname.split('/').filter(Boolean);
  const storeCode = pathParts[0] || '';
  let storeViewCode = pathParts[1] || '';
  const category = pathParts[2] === 'products' && pathParts[3] === 'commercial'
    ? 'commercial'
    : undefined;
  const urlKey = pathParts[category ? 4 : 3] || '';

  if (storeCode === 'ca' && storeViewCode === 'en_us') {
    storeViewCode = 'en_ca';
  }

  if (storeCode === 'mx' && storeViewCode === 'en_us') {
    storeViewCode = 'en_mx';
  }

  return {
    storeCode,
    storeViewCode,
    urlKey,
    ...(category && { category }),
  };
}

/**
 * Adds an optional catalog category to a sync request.
 * @param {object} data - Base sync request payload
 * @param {string} [category] - Product catalog category
 * @returns {object} sync request payload
 */
export function withCategory(data, category) {
  return category ? { ...data, category } : data;
}
