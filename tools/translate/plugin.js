// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';

const addDnt = (text) => {
  // parse text into html
  const html = new DOMParser().parseFromString(text, 'text/html');

  // 1. first row of any table should be not translated
  const tables = html.querySelectorAll('table');
  tables.forEach((table) => {
    const rows = table.querySelectorAll('tr');
    if (rows.length > 0) {
      rows[0].setAttribute('translate', 'no');

      // 2. first column of all rows in "metadata" table should be not translated
      const metadataTable = rows[0].textContent.trim() === 'metadata';
      if (metadataTable) {
        rows.forEach((row) => {
          row.querySelector('td:first-child').setAttribute('translate', 'no');
        });
      }
    }
  });

  return html.documentElement.outerHTML;
};

const removeDnt = (html) => {
  html.querySelectorAll('[translate="no"]').forEach((element) => {
    element.removeAttribute('translate');
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

const translate = async (html, language, context) => {
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
    const resp = await fetch('https://translate.da.live/google', opts);
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

(async function init() {
  // eslint-disable-next-line no-unused-vars
  const { context, token, actions } = await DA_SDK;

  const isLightVersion = window.innerWidth < 500;

  let selection = 'No text selected.';
  try {
    selection = await actions.getSelection();
    selection = addDnt(selection);
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
      translation = await translate(inputTextarea.value, languageSelector.value, context);
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
