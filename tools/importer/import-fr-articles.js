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
  const container = main.querySelector('.article-category-tags')?.nextElementSibling;
  if (!container) {
    console.log('No author and date container found');
    return;
  };

  const author = container.querySelector('a');
  const txt = container.textContent.trim();
  const date = txt.split('|')[1];

  const newRow = document.createElement('tr');
  const newCell = document.createElement('td');
  newCell.textContent = 'Author';
  newRow.appendChild(newCell);
  const newCell2 = document.createElement('td');
  newCell2.innerHTML = `<a href="${author.href.replace(src, dst)}">${author.textContent.trim()}</a>`;
  newRow.appendChild(newCell2);
  metadataTable.appendChild(newRow);

  const newRow2 = document.createElement('tr');
  const newCell3 = document.createElement('td');
  newCell3.textContent = 'Publication Date';
  newRow2.appendChild(newCell3);
  const newCell4 = document.createElement('td');
  newCell4.textContent = date.trim();
  newRow2.appendChild(newCell4);
  metadataTable.appendChild(newRow2);
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
  transformDOM: ({
    // eslint-disable-next-line no-unused-vars
    document, url, html, params,
  }) => {
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
    ]);

    WebImporter.rules.createMetadata(main, document);
    
    const u = new URL(url);
    const src = u.origin;
    const dst = 'https://www.vitamix.com';
    const metadataTable = [...document.querySelectorAll('table')].find((table) => table.querySelector('tr th[colspan="2"]')?.textContent.trim() === 'Metadata');
    if (metadataTable) {
      addAuthorAndDateToMetadata(main, metadataTable, src, dst, document);
      addTagsToMetadata(main, metadataTable, src, dst, document);
    }
    
    WebImporter.rules.transformBackgroundImages(main, document);
    WebImporter.rules.adjustImageUrls(main, url, params.originalURL);
    WebImporter.rules.convertIcons(main, document);

    // final clean up
    document.querySelector('.article-category-tags')?.parentElement?.remove();

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