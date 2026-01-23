import DA_SDK from './sdk.js';

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

const removeDnt = (text) => {
  const html = new DOMParser().parseFromString(text, 'text/html');
  html.querySelectorAll('[translate="no"]').forEach((element) => {
    element.removeAttribute('translate');
  });
  return html.documentElement.outerHTML;
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

  const translated = removeDnt(json.translated, context);
  // remove start tag <html><head></head><body> and end tag </body></html>
  return translated.replace(/^<html><head><\/head><body>/, '').replace(/<\/body><\/html>$/, '');
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
