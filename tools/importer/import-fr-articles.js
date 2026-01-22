/*
 * Copyright 2023 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
/* global WebImporter */
/* eslint-disable no-console, class-methods-use-this */

const addTagsToMetadata = (main, metadataTable, src, dst, document) => {
  const tagElements = main.querySelectorAll('.article-category-tags a');
  const tags = [];
  tagElements.forEach((element) => {
    const tag = element.textContent.trim();
    // make href relative
    const href = element.href.replace(src, dst);
    tags.push(`<a href="${href}">${tag}</a>`);
  });
  // add a new row to the metadata table
  const newRow = document.createElement('tr');
  const newCell = document.createElement('td');
  newCell.textContent = 'Tags';
  newRow.appendChild(newCell);
  const newCell2 = document.createElement('td');
  newCell2.innerHTML = tags.join(', ');
  newRow.appendChild(newCell2);
  metadataTable.appendChild(newRow);
};

const addAuthorAndDateToMetadata = (main, metadataTable, src, dst, document) => {
  // next sibling is the author
  let container = main.querySelector('.article-category-tags')?.nextElementSibling;
  if (!container) {
    container = main.querySelector('section[itemprop="articleBody"]')?.firstElementChild;
    if (!container) {
      console.log('No author and date container found');
      return false;
    }
  };

  const author = container.querySelector('a');
  const txt = container.textContent.trim();
  let date = txt?.split('|')[1];

  if (!author && !date && txt) {
    try {
      // might be a data like 25.02.2026
      Date.parse(txt);
      date = txt;
    } catch (error) {}
  }

  const newRow = document.createElement('tr');
  const newCell = document.createElement('td');
  newCell.textContent = 'Author';
  newRow.appendChild(newCell);
  const newCell2 = document.createElement('td');
  if (author) {
    newCell2.innerHTML = `<a href="${author.href.replace(src, dst)}">${author.textContent.trim()}</a>`;
  }
  newRow.appendChild(newCell2);
  metadataTable.appendChild(newRow);

  const newRow2 = document.createElement('tr');
  const newCell3 = document.createElement('td');
  newCell3.textContent = 'Publication Date';
  newRow2.appendChild(newCell3);
  const newCell4 = document.createElement('td');
  newCell4.textContent = date?.trim() || '';
  newRow2.appendChild(newCell4);
  metadataTable.appendChild(newRow2);

  return true;
};

const getContentType = (src) => {
  const ext = src.split('.').pop();
  switch (ext) {
    case 'jpg':
      return 'image/jpeg';
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'mp4':
      return 'video/mp4';
    default:
      return null;
  }
};

const uploadAssets = async (main, localhost, origin, org, repo) => {
  const token = localStorage.getItem('AEM_ADMIN_MEDIA_API_KEY');
  if (!token) {
    console.error('No API key found in localStorage (AEM_ADMIN_MEDIA_API_KEY)');
    return;
  }

  const assets = [...main.querySelectorAll('img')];
  for (const asset of assets) {
    const src = asset.src;
    const contentType = getContentType(src);
    if (!contentType) {
      console.error('Unsupported asset type for upload', src);
      continue;
    }
    if (src.startsWith(localhost) || src.startsWith(origin) || src.startsWith('/')) {
      const url = new URL(src.replace(localhost, origin), origin).toString();
      console.log('Asset to upload', url);
      const response = await fetch(`https://admin.hlx.page/media/${org}/${repo}/main`, {
        method: 'POST',
        body: JSON.stringify({ url }),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `token ${token}`,
        },
      });
      if (!response.ok) {
        if (response.status === 415) {
          console.error(`Error uploading asset - unsupported content type: ${contentType}`, response.statusText);
        } else {
          console.error('Error uploading asset', response.statusText);
        }
        asset.remove();
      } else {
        const data = await response.json();
        console.log('Asset uploaded', data);
        asset.src = data.uri;
      }
    }
  }
};

const createRelatedArticles = (main, origin, document) => {
  const relatedArticles = new Set([...document.querySelectorAll('.related-recipes-section a')].map(a => a.href));
  if (relatedArticles.size === 0) {
    return;
  }
  const block = WebImporter.Blocks.createBlock(document, {
    name: 'Related Articles',
    cells: [...relatedArticles].map(href => {
      const a = document.createElement('a');

      const u = new URL(href);
      a.href = new URL(u.pathname, origin).toString();
      a.textContent = a.href;
      return [a];
    }),
  });
  main.appendChild(block);
};

export default {
  /**
   * Apply DOM operations to the provided document and return
   * the root element to be then transformed to Markdown.
   * @param {HTMLDocument} document The document
   * @param {string} url The url of the page imported
   * @param {string} html The raw html (the document is cleaned up during preprocessing)
   * @param {object} params Object containing some parameters given by the import process.
   * @returns {HTMLElement} The root element to be transformed
   */
  transformDOM: async ({
    // eslint-disable-next-line no-unused-vars
    document, url, html, params,
  }) => {

    const CONFIG = {
      org: 'aemsites',
      repo: 'vitamix',
      domain: 'vitamix.com',
      source: new URL(url).origin, // localhost:3001
      origin: 'https://www.vitamix.com',
    };

    // define the main element: the one that will be transformed to Markdown
    const main = document.querySelector('article');

    // attempt to remove non-content elements
    WebImporter.DOMUtils.remove(main, [
      'header',
      '.header',
      'nav',
      '.nav',
      'footer',
      '.footer',
      'iframe',
      'noscript',
      '#SocialMediaButtons',
      '.ognm-cardlist-recipe-programs__caption', // search in related receipts
    ]);

    createRelatedArticles(main, CONFIG.origin, document);

    WebImporter.DOMUtils.remove(main, [
      '.related-recipes-section',
      '.list-component-item',
    ]);

    WebImporter.rules.createMetadata(main, document);
    
    const metadataTable = [...document.querySelectorAll('table')].find((table) => table.querySelector('tr th[colspan="2"]')?.textContent.trim() === 'Metadata');
    if (metadataTable) {
      const hasAuthorAndDate = addAuthorAndDateToMetadata(main, metadataTable, CONFIG.source, CONFIG.origin, document);
      addTagsToMetadata(main, metadataTable, CONFIG.source, CONFIG.origin, document);

      if (hasAuthorAndDate) {
        document.querySelector('section[itemprop="articleBody"]')?.firstElementChild?.remove();
      }
    }
    
    WebImporter.rules.transformBackgroundImages(main, document);
    WebImporter.rules.convertIcons(main, document);

    await uploadAssets(main, CONFIG.source, CONFIG.origin, CONFIG.org, CONFIG.repo);

    return main;
  },

  /**
   * Return a path that describes the document being transformed (file name, nesting...).
   * The path is then used to create the corresponding Word document.
   * @param {HTMLDocument} document The document
   * @param {string} url The url of the page imported
   * @param {string} html The raw html (the document is cleaned up during preprocessing)
   * @param {object} params Object containing some parameters given by the import process.
   * @return {string} The path
   */
  generateDocumentPath: ({
    // eslint-disable-next-line no-unused-vars
    document, url, html, params,
  }) => {
    let p = new URL(url).pathname;
    if (p.endsWith('/')) {
      p = `${p}index`;
    }
    return decodeURIComponent(p)
      .toLowerCase()
      .replace(/\.html$/, '')
      .replace(/[^a-z0-9/]/gm, '-');
  },
};