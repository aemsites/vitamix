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
  await Promise.all(assets.map(async (asset) => {
    const { src } = asset;
    const contentType = getContentType(src);
    if (!contentType) {
      console.error('Unsupported asset type for upload', src);
      return;
    }
    if (src.startsWith(localhost) || src.startsWith(origin) || src.startsWith('/')) {
      const url = new URL(src.replace(localhost, origin), origin).toString();
      console.log('Asset to upload', url);
      const response = await fetch(`https://admin.hlx.page/media/${org}/${repo}/main`, {
        method: 'POST',
        body: JSON.stringify({ url }),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `token ${token}`,
        },
      });
      if (!response.ok) {
        if (response.status === 415) {
          console.error(`Error uploading asset - unsupported content type: ${contentType}`, response.statusText);
        } else {
          console.error('Error uploading asset', response.statusText);
        }
        // Keep the original image URL instead of removing it
        console.log('Keeping original image URL:', asset.src);
      } else {
        const data = await response.json();
        console.log('Asset uploaded', data);
        asset.src = data.uri;
      }
    }
  }));
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

    // Create a container for the main content
    const main = document.createElement('div');

    // Find all title components (h1 headings) in the main content area
    const titleContainers = document.querySelectorAll('.aem-Grid .title');
    titleContainers.forEach((titleComponent) => {
      // Skip if this is inside the vertical navigation
      if (titleComponent.closest('.vertical-navigation')) {
        return;
      }

      // Find the actual title content div
      const titleDiv = titleComponent.querySelector('.cmp-title');
      if (titleDiv) {
        // Clone and append to main
        const clonedContent = titleDiv.cloneNode(true);
        main.appendChild(clonedContent);
      }
    });

    // Find all text components in the main content area (not in the side navigation)
    // The side nav is in .vertical-navigation, we want to skip that
    const contentContainers = document.querySelectorAll('.aem-Grid .text');

    contentContainers.forEach((textComponent) => {
      // Skip if this is inside the vertical navigation
      if (textComponent.closest('.vertical-navigation')) {
        return;
      }

      // Find the actual text content div
      const textDiv = textComponent.querySelector('.cmp-text');
      if (textDiv) {
        // Clone and append to main
        const clonedContent = textDiv.cloneNode(true);
        main.appendChild(clonedContent);
      }
    });

    // Also check for image components (not in side nav)
    const imageContainers = document.querySelectorAll('.aem-Grid .image');
    imageContainers.forEach((imageComponent) => {
      // Skip if this is inside the vertical navigation
      if (imageComponent.closest('.vertical-navigation')) {
        return;
      }

      const imageDiv = imageComponent.querySelector('.cmp-image');
      if (imageDiv) {
        const clonedImage = imageDiv.cloneNode(true);
        main.appendChild(clonedImage);
      }
    });

    // Remove any unwanted elements
    WebImporter.DOMUtils.remove(main, [
      'header',
      '.header',
      'nav',
      '.nav',
      'footer',
      '.footer',
      'iframe',
      'noscript',
    ]);

    // Create metadata
    WebImporter.rules.createMetadata(main, document);

    // Transform background images if any
    WebImporter.rules.transformBackgroundImages(main, document);
    WebImporter.rules.convertIcons(main, document);

    // Upload assets
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
