import { getLocaleAndLanguage } from '../../scripts/scripts.js';
import getStatesProvincesOptions from './states-provinces.js';

/**
 * Loads widget copy from the widget's local JSON (same name as the script).
 * @param {string} lang - Language key (en, fr, es)
 * @returns {Promise<Object>} Copy for that language
 */
async function loadFormCopy(lang) {
  const scriptPath = new URL(import.meta.url).pathname;
  const jsonPath = scriptPath.replace(/\.js$/, '.json');
  const url = `${window.hlx?.codeBasePath || ''}${jsonPath}`;
  const resp = await fetch(url);
  const data = await resp.json();
  const key = data[lang] ? lang : 'en';
  return data[key] || {};
}

/**
 * Returns true if the service area CSV includes the given two-letter state code.
 * @param {string} serviceArea - Comma-separated state codes (e.g. "UT, CO, CA")
 * @param {string} stateCode - Selected state (e.g. "UT")
 * @returns {boolean}
 */
function matchesServiceArea(serviceArea, stateCode) {
  if (!serviceArea || !stateCode) return false;
  const want = stateCode.trim().toUpperCase();
  return serviceArea
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .includes(want);
}

/**
 * Builds tel: href from a display phone string.
 * @param {string} phone - Raw phone text
 * @returns {string}
 */
function telHref(phone) {
  if (!phone) return '#';
  const digits = phone.replace(/\D/g, '');
  return digits ? `tel:${digits}` : '#';
}

/**
 * Renders service center rows into the results container.
 * @param {HTMLElement} container
 * @param {Array<Object>} rows - Sheet rows
 */
function renderResults(container, rows) {
  container.classList.remove('is-muted');
  container.innerHTML = '';
  rows.forEach((row) => {
    const company = row.Company ?? '';
    const line1 = row.Address ?? '';
    const line2 = row.Address2 ?? '';
    const phone = row['Phone Number'] ?? '';

    const card = document.createElement('article');
    card.className = 'service-center-card';

    const h = document.createElement('h3');
    h.className = 'service-center-company';
    h.textContent = company;
    card.appendChild(h);

    if (line1) {
      const p1 = document.createElement('p');
      p1.className = 'service-center-line';
      p1.textContent = line1;
      card.appendChild(p1);
    }
    if (line2) {
      const p2 = document.createElement('p');
      p2.className = 'service-center-line';
      p2.textContent = line2;
      card.appendChild(p2);
    }
    if (phone) {
      const a = document.createElement('a');
      a.className = 'service-center-phone';
      a.href = telHref(phone);
      a.textContent = phone;
      card.appendChild(a);
    }

    container.appendChild(card);
  });
}

/**
 * Decorates the service-center widget: US state dropdown and filtered service centers.
 * @param {HTMLElement} widget - The widget root element
 */
export default async function decorate(widget) {
  const root = widget.querySelector('.service-center');
  const select = widget.querySelector('#service-center-state');
  const results = widget.querySelector('#service-center-results');
  const titleEl = widget.querySelector('.service-center-title');
  const labelEl = widget.querySelector('[for="service-center-state"] .label-text');

  if (!root || !select || !results) return;

  const { locale, language } = getLocaleAndLanguage();
  const lang = (language || 'en_us').split('_')[0];
  const copy = await loadFormCopy(lang).catch(() => ({}));
  const labels = copy.labels || {};

  if (titleEl) titleEl.textContent = labels.title ?? 'Locate a Commercial Service Center';
  if (labelEl) labelEl.textContent = labels.stateLabel ?? 'U.S. Service Centers';

  const stateOptions = await getStatesProvincesOptions('US', lang).catch(() => []);
  const placeholder = labels.placeholder ?? 'Please select';

  while (select.options.length > 1) select.remove(1);
  if (select.options[0]) select.options[0].textContent = placeholder;

  stateOptions.forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    select.appendChild(option);
  });

  const centersUrl = `/${locale}/${language}/customer-service/service-centers.json`;
  results.classList.add('is-muted');
  results.textContent = labels.loading ?? 'Loading service centers…';

  let allRows = [];
  try {
    const resp = await fetch(centersUrl);
    if (!resp.ok) throw new Error(String(resp.status));
    const json = await resp.json();
    allRows = Array.isArray(json.data) ? json.data : [];
  } catch {
    results.classList.add('is-muted');
    results.textContent = labels.error ?? 'Unable to load service centers. Please try again later.';
    return;
  }

  function applyFilter() {
    const stateCode = select.value;
    if (!stateCode) {
      results.classList.add('is-muted');
      results.innerHTML = '';
      results.textContent = labels.empty ?? 'Select a state to see commercial service centers in that area.';
      return;
    }

    const filtered = allRows.filter((row) => matchesServiceArea(row['Service Area'], stateCode));

    if (filtered.length === 0) {
      results.classList.add('is-muted');
      results.innerHTML = '';
      results.textContent = labels.noResults ?? 'No commercial service centers were found for this state.';
      return;
    }

    renderResults(results, filtered);
  }

  applyFilter();
  select.addEventListener('change', applyFilter);
}
