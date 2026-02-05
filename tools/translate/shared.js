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

const ADMIN_URL = 'https://admin.da.live';
// const ADMIN_URL = 'https://stage-admin.da.live';
// const ADMIN_URL = 'http://localhost:8787';

const TRANSLATION_SERVICE_URL = 'https://translate.da.live/google';

const CONFIG_PATH = '/.da/translate.json';
const CONFIG_CONTENT_DNT_SHEET = 'dnt-content-rules';
const CONFIG_METADATA_FIELDS_SHEET = 'dt-metadata-fields';
const METADATA_FIELDS_TO_TRANSLATE = ['title', 'description'];

const EDITOR_FORMAT = 'table';
const ADMIN_FORMAT = 'div';

const ICONS_RULE = {
  description: 'Icon names should be not translated',
  apply: (html) => {
    const ps = html.querySelectorAll('p');
    ps.forEach((p) => {
      // ignore p if one parent has a translate="no" attribute
      if (p.closest('[translate="no"]')) {
        return;
      }
      const text = p.textContent;
      const regex = /:([a-zA-Z0-9-_]+):/g;
      const matches = text.match(regex);

      if (matches) {
        matches.forEach((match) => {
          // ignore if only digits (could be a timestamp)
          if (/^:[\d:]+:$/i.test(match)) {
            return;
          }
          p.innerHTML = p.innerHTML.replace(match, `<span translate="no">${match}</span>`);
        });
      }
    });
    return html;
  },
};

const CONTENT_DNT_RULE = {
  description: 'Specific content fragments should be not translated',
  apply: (html, config) => {
    const fragments = config[CONFIG_CONTENT_DNT_SHEET]?.data || [];
    if (fragments.length === 0) {
      return html;
    }
    const elements = html.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, a');
    elements.forEach((element) => {
      const text = element.textContent;
      fragments.forEach((fragment) => {
        const { content } = fragment;
        if (content && text.includes(content)) {
          element.innerHTML = element.innerHTML.replace(content, `<span translate="no">${content}</span>`);
        }
      });
    });
    return html;
  },
};

const RULES = {
  [EDITOR_FORMAT]: [{
    description: 'First row of any table should be not translated',
    apply: (html) => {
      const tables = html.querySelectorAll('table');
      tables.forEach((table) => {
        const rows = table.querySelectorAll('tr');
        if (rows.length > 0) {
          rows[0].setAttribute('translate', 'no');
        }
      });
      return html;
    },
  }, {
    description: 'Property names of the "metadata" table should be not translated (except Title and Description or the ones in the config)',
    apply: (html, config) => {
      const keys = (() => {
        const data = config[CONFIG_METADATA_FIELDS_SHEET]?.data || [];
        const ks = data.filter((f) => f.metadata).map((f) => f.metadata.toLowerCase().trim());
        ks.push(...METADATA_FIELDS_TO_TRANSLATE.map((f) => f.toLowerCase().trim()));
        return [...new Set(ks)];
      })();

      const tables = html.querySelectorAll('table');
      tables.forEach((table) => {
        const rows = table.querySelectorAll('tr');
        if (rows.length > 0) {
          const metadataTable = rows[0].textContent.toLowerCase().trim() === 'metadata';
          if (metadataTable) {
            table.setAttribute('translate', 'no');
            rows.forEach((row) => {
              const keyEl = row.querySelector('td:first-child');
              const valueEl = row.querySelector('td:last-child');
              const key = keyEl?.textContent.toLowerCase().trim();
              const value = valueEl?.textContent.toLowerCase().trim();
              if (key && value && keys.includes(key)) {
                valueEl.setAttribute('translate', 'yes');
              }
            });
          }
        }
      });
      return html;
    },
  }, {
    description: 'section metadata table should be not translated',
    apply: (html) => {
      const tables = html.querySelectorAll('table');
      tables.forEach((table) => {
        const rows = table.querySelectorAll('tr');
        if (rows.length > 0) {
          const name = rows[0].textContent.toLowerCase().trim();
          const sectionMetadata = name === 'section metadata' || name === 'section-metadata';
          if (sectionMetadata) {
            table.setAttribute('translate', 'no');
          }
        }
      });
      return html;
    },
  }, ICONS_RULE, CONTENT_DNT_RULE],
  [ADMIN_FORMAT]: [{
    description: 'First column of all rows in "metadata" block should be not translated',
    apply: (html, config) => {
      const keys = (() => {
        const data = config[CONFIG_METADATA_FIELDS_SHEET]?.data || [];
        const ks = data.filter((f) => f.metadata).map((f) => f.metadata.toLowerCase().trim());
        ks.push(...METADATA_FIELDS_TO_TRANSLATE.map((f) => f.toLowerCase().trim()));
        return [...new Set(ks)];
      })();

      const divs = html.querySelectorAll('div[class=metadata]');
      divs.forEach((block) => {
        block.setAttribute('translate', 'no');
        block.querySelectorAll('& > div').forEach((row) => {
          const keyEl = row.querySelector('div:first-child');
          const valueEl = row.querySelector('div:last-child');
          const key = keyEl?.textContent.toLowerCase().trim();
          const value = valueEl?.textContent.toLowerCase().trim();
          if (key && value && keys.includes(key)) {
            valueEl.setAttribute('translate', 'yes');
          }
        });
      });
      return html;
    },
  }, {
    description: 'section metadata block should be not translated',
    apply: (html) => {
      const divs = html.querySelectorAll('div[class=section-metadata]');
      divs.forEach((div) => {
        div.setAttribute('translate', 'no');
      });
      return html;
    },
  }, ICONS_RULE, CONTENT_DNT_RULE],
};

const getConfig = async (context, daFetch) => {
  const resp = await daFetch(`${ADMIN_URL}/source/${context.org}/${context.repo}${CONFIG_PATH}`);
  if (!resp.ok) {
    return {};
  }
  const config = await resp.json();
  return config || {};
};

const addDnt = async (text, format, context, daFetch) => {
  const config = await getConfig(context, daFetch);
  let html = new DOMParser().parseFromString(text, 'text/html');
  let rules;
  if (format) {
    rules = RULES[format];
  } else {
    rules = [...RULES[ADMIN_FORMAT], ...RULES[EDITOR_FORMAT]];
  }
  if (rules) {
    rules.forEach((rule) => {
      html = rule.apply(html, config);
    });
  }
  return html.documentElement.outerHTML;
};

const removeDnt = (html) => {
  html.querySelectorAll('[translate]').forEach((element) => {
    element.removeAttribute('translate');

    if (element.tagName === 'SPAN') {
      element.replaceWith(element.textContent);
    }
  });
  return html.documentElement.outerHTML;
};

const adjustURLs = (html, context) => {
  const { path } = context;
  // test if path starts with /<lang>/<locale>.
  const pathPrefixRegex = /^\/?[a-z]{2}\/[a-z]{2}[-_][a-z]{2}(?=\/|$)/;
  const isLocalPath = pathPrefixRegex.test(path);
  const pathSegments = path.replace(/^\/+/, '').split('/');
  const basePrefix = pathSegments.length >= 2 ? `/${pathSegments[0]}/${pathSegments[1]}` : '';
  if (isLocalPath && basePrefix) {
    html.querySelectorAll('a[href]').forEach((element) => {
      if (!element.href) return;
      const { pathname } = new URL(element.href);

      if (pathPrefixRegex.test(pathname)) {
        // replace the first 2 segments of the pathname with the first 2 segments of the path
        const newPathname = pathname.replace(pathPrefixRegex, basePrefix);
        const newHref = element.href.replace(pathname, newPathname);
        if (element.textContent === element.href) {
          element.textContent = newHref;
        }
        element.href = newHref;
      }
    });
  }
  return html.documentElement.outerHTML;
};

const postProcess = (text, context) => {
  const html = new DOMParser().parseFromString(text, 'text/html');
  let result = removeDnt(html);
  // remove start tag <html><head></head><body> and end tag </body></html>
  result = adjustURLs(html, context);
  result = result.replace(/^<html><head><\/head><body>/, '').replace(/<\/body><\/html>$/, '');
  return result;
};

const translate = async (htmlInput, language, context, format, daFetch, skipDnt = false) => {
  let html = htmlInput;
  if (!skipDnt) {
    html = await addDnt(html, format, context, daFetch);
  }
  const splits = [];
  const maxChunk = 30000;
  let start = 0;
  while (start < html.length) {
    const target = Math.min(start + maxChunk, html.length);
    let splitIndex = target;
    if (target < html.length) {
      // find the last closing tag before the target
      const chunk = html.slice(start, target);
      const matches = [...chunk.matchAll(/<\/[a-zA-Z][^>]*>/g)];
      if (matches.length > 0) {
        const last = matches[matches.length - 1];
        splitIndex = start + last.index + last[0].length;
      }
    }
    splits.push(html.slice(start, splitIndex));
    start = splitIndex;
  }

  const translateSplit = async (split) => {
    const body = new FormData();
    body.append('data', split);
    body.append('fromlang', 'en');
    body.append('tolang', language);

    const opts = { method: 'POST', body };
    const resp = await fetch(TRANSLATION_SERVICE_URL, opts);
    if (!resp.ok) {
      throw new Error(`Translation failed: ${resp.status}`);
    }

    const json = await resp.json();
    if (!json.translated) {
      throw new Error(json.error || 'Failed to translate');
    }
    return json.translated;
  };

  const translatedParts = await Promise.all(splits.map((split) => translateSplit(split)));
  const combined = translatedParts.join('');
  return postProcess(combined, context);
};

export {
  addDnt, removeDnt, adjustURLs, postProcess, translate, EDITOR_FORMAT, ADMIN_FORMAT, ADMIN_URL,
};
