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

import {
  ADMIN_URL, AEM_ADMIN_URL, TRANSLATION_SERVICE_URL, CONFIG_PATH,
  METADATA_FIELDS_TO_TRANSLATE, LOCALES,
} from './config.js';

const CONFIG_CONTENT_DNT_SHEET = 'dnt-content-rules';
const CONFIG_METADATA_FIELDS_SHEET = 'dt-metadata-fields';

const EDITOR_FORMAT = 'table';
const ADMIN_FORMAT = 'div';

const HELPERS = {
  [EDITOR_FORMAT]: {
    getMetadataTable: (html) => {
      const tables = [...html.querySelectorAll('table')];
      for (let i = 0; i < tables.length; i += 1) {
        const table = tables[i];
        const rows = table.querySelectorAll('tr');
        if (rows.length > 0) {
          const metadataTable = rows[0].textContent.toLowerCase().trim() === 'metadata';
          if (metadataTable) {
            return table;
          }
        }
      }
      return null;
    },
  },
  [ADMIN_FORMAT]: {
    getMetadataTable: (html) => html.querySelector('div[class=metadata]'),
  },
};

const ICONS_RULE = {
  description: 'Icon names should be not translated',
  apply: (html) => {
    const text = html.body.textContent;
    const regex = /:([a-zA-Z0-9-_]+):/g;
    const matches = text.match(regex);

    if (matches) {
      matches.forEach((match) => {
        // ignore if only digits (could be a timestamp)
        if (/^:[\d:]+:$/i.test(match)) {
          return;
        }
        html.body.innerHTML = html.body.innerHTML.replace(match, `<span translate="no">${match}</span>`);
      });
    }
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

/** Rules applied once in all cases (editor and admin format). */
const GENERIC_RULES = [ICONS_RULE, CONTENT_DNT_RULE];

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

      const table = HELPERS[EDITOR_FORMAT].getMetadataTable(html);
      if (table) {
        table.setAttribute('translate', 'no');
        const rows = table.querySelectorAll('tr');
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
  }],
  [ADMIN_FORMAT]: [{
    description: 'First column of all rows in "metadata" block should be not translated',
    apply: (html, config) => {
      const keys = (() => {
        const data = config[CONFIG_METADATA_FIELDS_SHEET]?.data || [];
        const ks = data.filter((f) => f.metadata).map((f) => f.metadata.toLowerCase().trim());
        ks.push(...METADATA_FIELDS_TO_TRANSLATE.map((f) => f.toLowerCase().trim()));
        return [...new Set(ks)];
      })();

      const table = HELPERS[ADMIN_FORMAT].getMetadataTable(html);
      if (table) {
        table.setAttribute('translate', 'no');
        table.querySelectorAll('& > div').forEach((row) => {
          const keyEl = row.querySelector('div:first-child');
          const valueEl = row.querySelector('div:last-child');
          const key = keyEl?.textContent.toLowerCase().trim();
          const value = valueEl?.textContent.toLowerCase().trim();
          if (key && value && keys.includes(key)) {
            valueEl.setAttribute('translate', 'yes');
          }
        });
      }
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
  }],
};

const FORMAT_RULES = {
  [EDITOR_FORMAT]: [
    {
      description: 'Metadata property: convert commat separated list to ul list',
      preProcess: (html) => {
        const table = HELPERS[EDITOR_FORMAT].getMetadataTable(html);
        if (table) {
          const rows = table.querySelectorAll('tr');
          rows.forEach((row) => {
            const keyEl = row.querySelector('td:first-child');
            const valueEl = row.querySelector('td:last-child');
            const key = keyEl?.textContent.toLowerCase().trim();
            const value = valueEl?.textContent.toLowerCase().trim();
            if (key && value && key !== 'title' && key !== 'description') {
              const list = value.split(',').map((item) => item.trim());
              if (list.length > 1) {
                valueEl.innerHTML = `<ul>${list.map((item) => `<li>${item}</li>`).join('')}</ul>`;
              }
            }
          });
        }
        return html;
      },
      postProcess: (html) => {
        // revert operation of preProcess
        const table = HELPERS[EDITOR_FORMAT].getMetadataTable(html);
        if (table) {
          const uls = table.querySelectorAll('ul');
          uls.forEach((ul) => {
            const list = [];
            const lis = ul.querySelectorAll('li');
            lis.forEach((li) => {
              list.push(li.textContent.trim());
            });
            ul.parentElement.textContent = list.join(', ');
          });
        }
        return html;
      },
    },
  ],
  [ADMIN_FORMAT]: [{
    description: 'Metadata property: convert commat separated list to ul list',
    preProcess: (html) => {
      const table = HELPERS[ADMIN_FORMAT].getMetadataTable(html);
      if (table) {
        const rows = table.querySelectorAll('& > div');
        rows.forEach((row) => {
          const keyEl = row.querySelector('div:first-child');
          const key = keyEl?.textContent.toLowerCase().trim();
          const valueEl = row.querySelector('div:last-child');
          const value = valueEl?.textContent.toLowerCase().trim();
          if (key && value && key !== 'title' && key !== 'description') {
            const list = value.split(',').map((item) => item.trim());
            if (list.length > 1) {
              valueEl.innerHTML = `<ul>${list.map((item) => `<li>${item}</li>`).join('')}</ul>`;
            }
          }
        });
      }
      return html;
    },
    postProcess: (html) => {
      // revert operation of preProcess
      const table = HELPERS[ADMIN_FORMAT].getMetadataTable(html);
      if (table) {
        const uls = table.querySelectorAll('ul');
        uls.forEach((ul) => {
          const list = [];
          const lis = ul.querySelectorAll('li');
          lis.forEach((li) => {
            list.push(li.textContent.trim());
          });
          ul.parentElement.textContent = list.join(', ');
        });
      }
      return html;
    },
  }],
};

const getConfig = async (context, daFetch) => {
  const resp = await daFetch(`${ADMIN_URL}/source/${context.org}/${context.repo}${CONFIG_PATH}`);
  if (!resp.ok) {
    return {};
  }
  const config = await resp.json();
  return config || {};
};

const addDnt = async (html, format, context, daFetch) => {
  let result = html;
  const config = await getConfig(context, daFetch);

  // Generic rules: applied once in all cases
  GENERIC_RULES.forEach((rule) => {
    result = rule.apply(result, config);
  });

  // Format-specific rules
  let rules;
  if (format) {
    rules = RULES[format];
  } else {
    rules = [...RULES[ADMIN_FORMAT], ...RULES[EDITOR_FORMAT]];
  }
  if (rules) {
    rules.forEach((rule) => {
      result = rule.apply(result, config);
    });
  }
  return result;
};

const reformat = (html, format) => {
  let result = html;
  let rules;
  if (format) {
    rules = FORMAT_RULES[format];
  } else {
    rules = [...FORMAT_RULES[ADMIN_FORMAT], ...FORMAT_RULES[EDITOR_FORMAT]];
  }
  if (rules) {
    rules.forEach((rule) => {
      result = rule.preProcess(html);
    });
  }
  return result;
};

const unformat = (html, format) => {
  let result = html;
  let rules;
  if (format) {
    rules = FORMAT_RULES[format];
  } else {
    rules = [...FORMAT_RULES[ADMIN_FORMAT], ...FORMAT_RULES[EDITOR_FORMAT]];
  }
  if (rules) {
    rules.forEach((rule) => {
      result = rule.postProcess(html);
    });
  }
  return result;
};

const preprocess = async (text, format, context, daFetch) => {
  let html = new DOMParser().parseFromString(text, 'text/html');

  // if body has one single table, with one single row and one single cell, unwrap the cell
  // most likely a cell content selection (read as a single cell table)
  const { body } = html;
  const table = body.querySelector('table');
  if (table && table.rows.length === 1 && table.rows[0].cells.length === 1) {
    const cell = table.rows[0].cells[0];
    body.innerHTML = cell.innerHTML;
  }

  html = await addDnt(html, format, context, daFetch);
  html = reformat(html, format);
  return html.documentElement.outerHTML;
};

const removeDnt = (html) => {
  html.querySelectorAll('[translate]').forEach((element) => {
    element.removeAttribute('translate');

    if (element.tagName === 'SPAN') {
      element.replaceWith(element.textContent);
    }
  });
  return html;
};

const adjustURLs = (html, context) => {
  const { sourcePath } = context;
  const prefixes = LOCALES.map(({ prefix }) => prefix);
  const matchPrefix = (path) => prefixes.find((p) => path === p || path.startsWith(`${p}/`));

  const targetPrefix = matchPrefix(sourcePath);
  if (!targetPrefix) return html;

  html.querySelectorAll('a[href]').forEach((element) => {
    if (!element.href) return;
    const url = new URL(element.href);
    const { pathname } = url;

    const linkedPrefix = matchPrefix(pathname);
    if (!linkedPrefix || linkedPrefix === targetPrefix) return;

    const newPathname = targetPrefix + pathname.slice(linkedPrefix.length);
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (isLocalhost) {
      element.setAttribute('href', newPathname);
    } else {
      const newHref = element.href.replace(pathname, newPathname);
      if (element.textContent === element.href) {
        element.textContent = newHref;
      }
      element.href = newHref;
    }
  });

  return html;
};

const postProcess = (text, context, format) => {
  let html = new DOMParser().parseFromString(text, 'text/html');
  html = removeDnt(html);
  html = unformat(html, format);
  html = adjustURLs(html, context);
  // remove start tag <html><head></head><body> and end tag </body></html>
  return html.documentElement.outerHTML.replace(/^<html><head><\/head><body>/, '').replace(/<\/body><\/html>$/, '');
};

const CANONICALIZE_BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, td, th, div';

// Only these get entity-encoded on save (matches da-collab's da-parser tohtml());
// every other attribute (href, src, srcset, ...) is emitted completely raw.
const CANONICALIZE_TEXT_ATTRS = new Set(['alt', 'title']);

/** Trims whitespace at the start/end of a block element's inline content. */
function trimBlockEdges(root) {
  root.querySelectorAll(CANONICALIZE_BLOCK_SELECTOR).forEach((block) => {
    let first = block.firstChild;
    while (first && first.nodeType !== Node.TEXT_NODE) first = first.firstChild;
    if (first) first.nodeValue = first.nodeValue.replace(/^\s+/, '');

    let last = block.lastChild;
    while (last && last.nodeType !== Node.TEXT_NODE) last = last.lastChild;
    if (last) last.nodeValue = last.nodeValue.replace(/\s+$/, '');
  });
}

/** Collapses nbsp (entity or literal U+00A0) down to a plain space. */
const NBSP = String.fromCharCode(160);
function normalizeNbsp(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue.includes(NBSP)) {
      node.nodeValue = node.nodeValue.split(NBSP).join(' ');
    }
  }
}

/**
 * DOMParser/outerHTML always entity-encodes `&` in every attribute value; the
 * editor's own serializer only does that (plus `'`/`"`) for alt/title, and
 * leaves every other attribute (href, src, srcset, ...) completely raw.
 */
function reencodeAttributes(html) {
  return html.replace(/(\s)([a-zA-Z0-9:-]+)="([^"]*)"/g, (match, ws, name, value) => {
    if (CANONICALIZE_TEXT_ATTRS.has(name)) {
      const encoded = value
        .replace(/&amp;/g, '&#x26;')
        .replace(/&quot;/g, '&#x22;')
        .replace(/'/g, '&#x27;');
      return `${ws}${name}="${encoded}"`;
    }
    return `${ws}${name}="${value.replace(/&amp;/g, '&')}"`;
  });
}

/**
 * Matches the formatting the DA Live editor's own save produces — verified
 * byte-for-byte against a real editor open+save round-trip — via plain
 * DOM/string handling. Without this, saving HTML built here differs just
 * enough from the editor's own output that simply opening the page
 * afterward re-saves it and registers as a spurious modification.
 *
 * The stored file is always `<body>\n  <header>...</header>\n  <main>...</main>\n
 * <footer>...</footer>\n</body>` (2-space indent, no leading/trailing newline
 * outside the tag) — not just the flattened header/main/footer postProcess
 * returns, so the body wrapper is rebuilt explicitly here rather than stripped.
 */
const canonicalizeHtml = (html) => {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  trimBlockEdges(doc.body);
  normalizeNbsp(doc.body);

  if (!doc.body.querySelector('main')) {
    // Not a full page (e.g. a plugin.js text/table selection) — nothing to
    // rebuild a body/header/main/footer wrapper around.
    return reencodeAttributes(doc.body.innerHTML);
  }

  const sectionHtml = (tag) => reencodeAttributes(doc.body.querySelector(tag)?.innerHTML || '');
  return `\n<body>\n  <header>${sectionHtml('header')}</header>\n  <main>${sectionHtml('main')}</main>\n  <footer>${sectionHtml('footer')}</footer>\n</body>\n`;
};

const translate = async (
  htmlInput,
  language,
  context,
  format,
  daFetch,
  skipPreprocess = false,
) => {
  let html = htmlInput;
  if (!skipPreprocess) {
    html = await preprocess(html, format, context, daFetch);
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
  return canonicalizeHtml(postProcess(combined, context, format));
};

function localeKey(prefix) {
  return prefix.replace(/^\//, '').replace(/\//g, '-');
}

function parsePath(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const matched = LOCALES.find(({ prefix }) => normalized === prefix || normalized.startsWith(`${prefix}/`));
  if (!matched) return null;
  const { prefix } = matched;
  const pagePath = normalized.slice(prefix.length) || '';
  return { prefix, pagePath, repoPath: `${prefix}${pagePath}` };
}

const withHtmlExt = (path) => (path.endsWith('.html') ? path : `${path}.html`);

/** Existence + last-modified (from the HEAD response) of a page's DA source. */
const sourceStatus = async (targetPagePath, context, daFetch) => {
  const url = `${ADMIN_URL}/source/${context.org}/${context.repo}${withHtmlExt(targetPagePath)}`;
  const resp = await daFetch(url, { method: 'HEAD' });
  return {
    exists: resp.ok,
    lastModified: resp.headers.get('last-modified'),
  };
};

const REDIRECTS_PATH = '/redirects.json';

/**
 * The project's redirects.json (a DA sheet with Source/Destination columns),
 * fetched once via daFetch — same-origin admin call, no CORS issue, unlike
 * probing the live site directly. AEM Edge Delivery applies every listed
 * Source as a 301 redirect at the CDN, so a path's presence here (regardless
 * of its publish state) means the live URL will redirect.
 * Returns a Map keyed by Source path, empty if the project has none.
 */
const getRedirects = async (context, daFetch) => {
  try {
    const resp = await daFetch(`${ADMIN_URL}/source/${context.org}/${context.repo}${REDIRECTS_PATH}`);
    if (!resp.ok) return new Map();
    const json = await resp.json();
    const rows = json?.data || [];
    const map = new Map();
    rows.forEach((row) => {
      const source = row.Source;
      if (!source) return;
      map.set(source.startsWith('/') ? source : `/${source}`, row.Destination || '');
    });
    return map;
  } catch {
    return new Map();
  }
};

const JOB_POLL_INTERVAL_MS = 1000;
const JOB_POLL_MAX_ATTEMPTS = 30;

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Fetches preview/publish status for many paths in a single AEM Admin bulk-status
 * job. `forceAsync` keeps the response shape identical regardless of path count
 * (always a pollable job, never an inlined result), so there's one code path:
 * poll job.links.self until state is 'stopped', then fetch job.links.details for
 * the per-path results. Returns a map keyed by path, each value holding
 * previewLastModified / publishLastModified.
 */
const bulkStatus = async (paths, context, daFetch) => {
  if (paths.length === 0) return {};

  const url = `${AEM_ADMIN_URL}/status/${context.org}/${context.repo}/main/*`;
  const resp = await daFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths, select: ['preview', 'live'], forceAsync: true }),
  });
  if (!resp.ok) throw new Error(`Bulk status failed: ${resp.status}`);
  let job = await resp.json();

  let attempts = 0;
  while (job.state !== 'stopped' && job.links?.self && attempts < JOB_POLL_MAX_ATTEMPTS) {
    // eslint-disable-next-line no-await-in-loop
    await wait(JOB_POLL_INTERVAL_MS);
    // eslint-disable-next-line no-await-in-loop
    const pollResp = await daFetch(job.links.self);
    if (!pollResp.ok) throw new Error(`Bulk status poll failed: ${pollResp.status}`);
    // eslint-disable-next-line no-await-in-loop
    job = await pollResp.json();
    attempts += 1;
  }

  const detailsUrl = job.links?.details;
  if (!detailsUrl) return {};

  const detailsResp = await daFetch(detailsUrl);
  if (!detailsResp.ok) throw new Error(`Bulk status details failed: ${detailsResp.status}`);
  const details = await detailsResp.json();

  const result = {};
  (details.data?.resources || []).forEach((entry) => {
    if (entry?.path) result[entry.path] = entry;
  });
  return result;
};

/**
 * Rolls out a source page's HTML to a single target locale: translates (or just
 * adjusts URLs if same language), saves to DA, then optionally previews/publishes.
 * Shared between the rollout plugin (single page) and the rollout app (batch).
 */
const rolloutToLocale = async ({
  sourceHtml, sourceTranslateCode, targetPrefix, targetTranslateCode, pagePath,
  context, daFetch, preview, publish, onStatus,
}) => {
  const targetPagePath = `${targetPrefix}${pagePath}`;
  const targetContext = { ...context, sourcePath: targetPagePath };

  onStatus?.('loading', 'Translating...');
  let translatedHtml;
  if (targetTranslateCode === sourceTranslateCode) {
    const doc = new DOMParser().parseFromString(sourceHtml, 'text/html');
    const adjusted = adjustURLs(doc, targetContext);
    const adjustedHtml = adjusted.documentElement.outerHTML
      .replace(/^<html><head><\/head><body>/, '')
      .replace(/<\/body><\/html>$/, '');
    translatedHtml = canonicalizeHtml(adjustedHtml);
  } else {
    translatedHtml = await translate(
      sourceHtml,
      targetTranslateCode,
      targetContext,
      undefined,
      daFetch,
      false,
    );
  }

  onStatus?.('saving', 'Saving...');
  const blob = new Blob([translatedHtml], { type: 'text/html' });
  const formData = new FormData();
  formData.append('data', blob);
  const p = withHtmlExt(targetPagePath);
  const targetUrl = `${ADMIN_URL}/source/${context.org}/${context.repo}${p}`;
  const saveResp = await daFetch(targetUrl, { method: 'PUT', body: formData });
  if (!saveResp.ok) throw new Error(`Save failed: ${saveResp.status}`);

  const base = `${AEM_ADMIN_URL}/%s/${context.org}/${context.repo}/main${targetPagePath}`;
  const versionUrl = `${ADMIN_URL}/versionsource/${context.org}/${context.repo}${p}`;
  const versionOpts = (versionLabel) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: versionLabel }),
  });

  if (preview) {
    onStatus?.('previewing', 'Previewing...');
    const previewResp = await daFetch(base.replace('%s', 'preview'), { method: 'POST' });
    if (!previewResp.ok) throw new Error(`Preview failed: ${previewResp.status}`);
    daFetch(versionUrl, versionOpts('Previewed'));
  }

  if (publish) {
    onStatus?.('publishing', 'Publishing...');
    const publishResp = await daFetch(base.replace('%s', 'live'), { method: 'POST' });
    if (!publishResp.ok) throw new Error(`Publish failed: ${publishResp.status}`);
    daFetch(versionUrl, versionOpts('Published'));
  }

  return targetPagePath;
};

export {
  preprocess, translate, adjustURLs, EDITOR_FORMAT, ADMIN_FORMAT,
  localeKey, parsePath, sourceStatus, bulkStatus, getRedirects, rolloutToLocale,
};
