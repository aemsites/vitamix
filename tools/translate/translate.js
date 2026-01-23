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
  const split = path.split('/');
  html.querySelectorAll('a[href]').forEach((element) => {
    if (!element.href) return;
    const { pathname } = new URL(element.href);
    const splitPathname = pathname.split('/');

    if (splitPathname.length === split.length
      && splitPathname[split.length - 1] === split[split.length - 1]) {
      // same path length and last segment is the same,
      // maybe we can adjust the locale and language (first 2 segments)
      if (split.length > 1 && splitPathname[1] !== split[1]
        && (split[1].length === 2 || split[1].length === 5)) {
        // eslint-disable-next-line prefer-destructuring
        splitPathname[1] = split[1];
      }

      if (split.length > 2 && splitPathname[2] !== split[2]
        && (split[2].length === 2 || split[2].length === 5)) {
        // eslint-disable-next-line prefer-destructuring
        splitPathname[2] = split[2];
      }

      const newPathname = splitPathname.join('/');
      const newHref = element.href.replace(pathname, newPathname);
      if (element.textContent === element.href) {
        element.textContent = newHref;
      }
      element.href = newHref;
    }
  });
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
  const body = new FormData();
  body.append('data', html);
  body.append('fromlang', 'en');
  body.append('tolang', language);

  const opts = { method: 'POST', body };

  const resp = await fetch('https://translate.da.live/google', opts);
  if (!resp.ok) return null;

  const json = await resp.json();

  const translated = postProcess(json.translated, context);
  return translated;
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
  translateBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    const translation = await translate(inputTextarea.value, languageSelector.value, context);
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
