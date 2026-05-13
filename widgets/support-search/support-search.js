import { getLocaleAndLanguage } from '../../scripts/scripts.js';

/**
 * Load widget copy from local JSON (same basename as this script).
 * @param {string} lang - Language key (en, fr, es)
 * @returns {Promise<Object>}
 */
async function loadWidgetCopy(lang) {
  const scriptPath = new URL(import.meta.url).pathname;
  const jsonPath = scriptPath.replace(/\.js$/, '.json');
  const url = `${window.hlx?.codeBasePath || ''}${jsonPath}`;
  const resp = await fetch(url);
  const data = await resp.json();
  const key = data[lang] ? lang : 'en';
  return data[key] || {};
}

function useFcors() {
  const { hostname } = window.location;
  return hostname === 'localhost' || hostname.includes('.aem.page') || hostname.includes('.aem.live');
}

/** @param {string} url - Path on aem.network (e.g. /us/en_us/products/index.json?include=all) */
function corsProxyFetch(url) {
  const corsProxy = 'https://fcors.org/?url=';
  const corsKey = '&key=Mg23N96GgR8O3NjU';
  const fullUrl = `https://main--vitamix--aemsites.aem.network${url}`;
  return fetch(`${corsProxy}${encodeURIComponent(fullUrl)}${corsKey}`);
}

/** @param {string} absoluteUrl - Full https URL (manuals JSON on aem.page) */
function corsProxyFetchAny(absoluteUrl) {
  const corsProxy = 'https://fcors.org/?url=';
  const corsKey = '&key=Mg23N96GgR8O3NjU';
  return fetch(`${corsProxy}${encodeURIComponent(absoluteUrl)}${corsKey}`);
}

/**
 * @param {Object} row
 * @param {string} locale
 * @param {string} language
 */
function normalizeProduct(row, locale, language) {
  const urlKey = (row.urlKey || '').trim();
  const path = urlKey ? `/${locale}/${language}/products/${urlKey}` : '';
  const title = (row.title || row.name || '').trim();
  const description = (row.description || row.shortDescription || '').trim();
  let image = row.image || '';
  if (image && image.startsWith('./')) {
    image = `/${locale}/${language}/products/${image.substring(2)}`;
  }
  return {
    type: 'product',
    path,
    title,
    description,
    image,
  };
}

/**
 * Owner's manuals sheet (same shape as AEM asset JSON).
 * @param {Object} row
 * @param {string} locale
 */
function normalizeManual(row, locale) {
  const loc = ['us', 'ca', 'mx', 'vr'].includes(locale) ? locale : 'us';
  const filename = (row.filename || '').trim();
  const base = `https://main--vitamix--aemsites.aem.page/assets/manuals/${loc}`;
  const path = filename ? `${base}/${encodeURIComponent(filename)}` : '';
  return {
    type: 'manual',
    path,
    title: (row.title || '').trim(),
    description: (row.summary || '').trim(),
    image: '',
  };
}

/** Max length for Scroll To Text Fragment match string (browser limits vary). */
const FAQ_TEXT_FRAGMENT_MAX_LEN = 280;

/**
 * FAQ page URL with Scroll To Text Fragment so the browser jumps to the question.
 * @see https://wicg.github.io/scroll-to-text-fragment/
 * @param {string} faqPagePath - Path without hash
 * @param {string} questionTitle - Plain question text (must match page text)
 * @returns {string}
 */
function faqUrlWithTextFragment(faqPagePath, questionTitle) {
  const text = questionTitle.trim().slice(0, FAQ_TEXT_FRAGMENT_MAX_LEN);
  if (!text) return faqPagePath;
  return `${faqPagePath}#:~:text=${encodeURIComponent(text)}`;
}

/**
 * Parse FAQ Q&A from authored FAQ page HTML (same-origin fetch only).
 * Expects Franklin markup: main .accordion > div rows with question / answer cells.
 * @param {string} html
 * @param {string} faqPagePath - Canonical path for result links
 * @returns {Array<Object>}
 */
function parseFaqItemsFromHtml(html, faqPagePath) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const items = [];
  const seen = new Set();

  doc.querySelectorAll('main .accordion').forEach((accordion) => {
    accordion.querySelectorAll(':scope > div').forEach((row) => {
      const qCell = row.children[0];
      const aCell = row.children[1];
      if (!qCell || !aCell) return;
      const title = qCell.textContent?.replace(/\s+/g, ' ').trim();
      if (!title || title.length < 4) return;
      const dedupeKey = title.toLowerCase();
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      const description = aCell.textContent?.replace(/\s+/g, ' ').trim().slice(0, 450);
      items.push({
        type: 'faq',
        path: faqUrlWithTextFragment(faqPagePath, title),
        title,
        description,
        image: '',
      });
    });
  });

  return items;
}

/**
 * Load FAQ entries from the live FAQ page on this origin (no CORS proxy).
 * @param {string} locale
 * @param {string} language
 * @returns {Promise<Array<Object>>}
 */
async function fetchFaqItems(locale, language) {
  const faqPagePath = `/${locale}/${language}/owners-resources/product-support/faqs`;
  const res = await fetch(faqPagePath);
  if (!res.ok) return [];
  const html = await res.text();
  return parseFaqItemsFromHtml(html, faqPagePath);
}

async function fetchManualRows(locale) {
  const loc = ['us', 'ca', 'mx', 'vr'].includes(locale) ? locale : 'us';
  const url = `https://main--vitamix--aemsites.aem.page/assets/manuals/${loc}/manuals.json`;
  const res = useFcors() ? await corsProxyFetchAny(url) : await fetch(url);
  if (!res.ok) return [];
  const json = await res.json();
  return Array.isArray(json.data) ? json.data : [];
}

async function loadProductsOnly(locale, language) {
  const productsUrl = `/${locale}/${language}/products/index.json?include=all`;
  const fetchJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : { data: [] }));
  const productsFetch = useFcors()
    ? () => corsProxyFetch(productsUrl).then((r) => (r.ok ? r.json() : { data: [] }))
    : () => fetchJson(productsUrl);
  const res = await productsFetch();
  const parents = (res.data || []).filter((row) => !(row.parentSku || '').trim());
  return parents.map((row) => normalizeProduct(row, locale, language));
}

async function loadSupportSearchIndex() {
  if (window.supportSearchIndex) {
    return window.supportSearchIndex;
  }

  const { locale, language } = getLocaleAndLanguage();
  const [products, manualRows, faqItems] = await Promise.all([
    loadProductsOnly(locale, language),
    fetchManualRows(locale),
    fetchFaqItems(locale, language),
  ]);

  const manuals = manualRows.map((row) => normalizeManual(row, locale));
  const combined = [...products, ...manuals, ...faqItems];
  window.supportSearchIndex = combined;
  return combined;
}

function removeAccents(str) {
  if (!str) return '';
  return str.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function normalizeForSearch(str) {
  return removeAccents((str || '').toLowerCase());
}

function filterBySearch(index, searchTerm) {
  if (!searchTerm || !searchTerm.trim()) {
    return index.map((item) => ({ ...item, searchTerm: '' }));
  }

  const term = searchTerm.toLowerCase().trim();
  const termNorm = normalizeForSearch(term);
  return index
    .filter((item) => {
      const titleMatch = normalizeForSearch(item.title || '').includes(termNorm);
      const descMatch = normalizeForSearch(item.description || '').includes(termNorm);
      const tags = item.tags || [];
      const tagsMatch = tags.some((tag) => normalizeForSearch(String(tag)).includes(termNorm));
      return titleMatch || descMatch || tagsMatch;
    })
    .map((item) => ({ ...item, searchTerm: term }));
}

const TYPE_ORDER = {
  product: 0,
  manual: 1,
  faq: 2,
};

function sortByRelevance(results, searchTerm) {
  if (!searchTerm || !searchTerm.trim()) {
    results.sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9));
    return;
  }

  const term = searchTerm.toLowerCase().trim();
  const termNorm = normalizeForSearch(term);

  function getSortKey(item) {
    const titleNorm = normalizeForSearch(item.title || '');
    const descNorm = normalizeForSearch(item.description || '');
    const titleIdx = titleNorm.indexOf(termNorm);
    const descIdx = descNorm.indexOf(termNorm);
    const inTitle = titleIdx !== -1;
    const inDesc = descIdx !== -1;
    const typeOrder = TYPE_ORDER[item.type] ?? 9;
    if (inTitle) return [0, titleIdx, typeOrder];
    if (inDesc) return [1, descIdx, typeOrder];
    return [2, Number.MAX_SAFE_INTEGER, typeOrder];
  }

  results.sort((a, b) => {
    const [rankA, offsetA, typeA] = getSortKey(a);
    const [rankB, offsetB, typeB] = getSortKey(b);
    if (rankA !== rankB) return rankA - rankB;
    if (offsetA !== offsetB) return offsetA - offsetB;
    return typeA - typeB;
  });
}

const AEM_NETWORK_ORIGIN = 'https://main--vitamix--aemsites.aem.network';
const IMAGE_QUERY_PARAMS = 'width=750&format=webply&optimize=medium';

function addImageParams(url) {
  if (!url) return '';
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${IMAGE_QUERY_PARAMS}`;
}

function getRelativeImagePath(imageUrl) {
  if (!imageUrl) return '';
  try {
    const url = new URL(imageUrl, window.location.origin);
    return url.pathname + url.search;
  } catch {
    return imageUrl;
  }
}

function isUsableImageUrl(url) {
  if (!url || typeof url !== 'string' || !url.trim()) return false;
  const s = url.trim().toLowerCase();
  if (s.startsWith('data:')) return false;
  try {
    const parsed = new URL(url, window.location.origin);
    return Boolean(parsed);
  } catch {
    return false;
  }
}

function getResultImageSrc(item) {
  if (!item?.image || !isUsableImageUrl(item.image)) return '';
  if (item.type === 'product' && useFcors()) {
    const path = item.image.startsWith('http')
      ? new URL(item.image).pathname
      : item.image;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return addImageParams(`${AEM_NETWORK_ORIGIN}${normalizedPath}`);
  }
  return addImageParams(getRelativeImagePath(item.image));
}

function getNormalizedToOriginalMap(original) {
  const map = [];
  for (let i = 0; i < original.length; i += 1) {
    const norm = removeAccents(original[i]);
    for (let j = 0; j < norm.length; j += 1) map.push(i);
  }
  return map;
}

function highlightMatch(text, searchTerm) {
  if (!text || !searchTerm) return text;
  const textNorm = normalizeForSearch(text);
  const termNorm = normalizeForSearch(searchTerm);
  const normStart = textNorm.indexOf(termNorm);
  if (normStart === -1) return text;
  const normEnd = normStart + termNorm.length;
  const map = getNormalizedToOriginalMap(text);
  const origStart = map[normStart];
  const origEnd = normEnd > 0 && normEnd <= map.length ? map[normEnd - 1] + 1 : text.length;
  const before = text.substring(0, origStart);
  const match = text.substring(origStart, origEnd);
  const after = text.substring(origEnd);
  return `${before}<span class="highlight">${match}</span>${after}`;
}

function createResultCard(item, copy = {}) {
  const li = document.createElement('li');
  li.className = 'card';

  const link = document.createElement('a');
  link.href = item.path || '#';
  if (item.type === 'manual') {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }

  const content = document.createElement('div');
  content.className = 'content';

  const typeLabels = {
    product: copy.typeProduct || 'Product',
    manual: copy.typeManual || 'Manual',
    faq: copy.typeFaq || 'FAQ',
  };
  const typeBadge = document.createElement('span');
  typeBadge.className = 'type-badge';
  typeBadge.textContent = typeLabels[item.type] || item.type;

  const title = document.createElement('h3');
  const titleText = item.title || '';
  title.innerHTML = item.searchTerm ? highlightMatch(titleText, item.searchTerm) : titleText;

  const description = document.createElement('p');
  description.className = 'description';
  const descText = item.description || '';
  description.innerHTML = item.searchTerm ? highlightMatch(descText, item.searchTerm) : descText;

  content.append(typeBadge, title, description);

  if (item.type === 'product') {
    const imageSrc = getResultImageSrc(item);
    if (imageSrc && !imageSrc.includes('default-meta-image')) {
      const imageEl = document.createElement('img');
      imageEl.src = imageSrc;
      imageEl.alt = '';
      imageEl.loading = 'lazy';
      link.append(imageEl, content);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'img placeholder';
      link.append(placeholder, content);
    }
  } else {
    link.append(content);
  }

  li.appendChild(link);
  return li;
}

const FILTER_TYPES = [
  { value: '', labelKey: 'filterAll', defaultLabel: 'All' },
  { value: 'product', labelKey: 'typeProduct', defaultLabel: 'Product' },
  { value: 'manual', labelKey: 'typeManual', defaultLabel: 'Manual' },
  { value: 'faq', labelKey: 'typeFaq', defaultLabel: 'FAQ' },
];

const ITEMS_PER_PAGE = 12;
const INPUT_DEBOUNCE_MS = 200;

/**
 * @param {HTMLElement} root - .support-search-root
 * @param {Object} copy
 */
function buildSupportSearchUi(root, copy) {
  let currentPage = 1;
  let currentTypeFilter = '';
  let debounceTimer;

  const resultsElement = root.querySelector('.support-search-results');
  const typeFiltersEl = root.querySelector('.support-search-type-filters');
  const paginationEl = root.querySelector('.support-search-pagination');
  const searchInput = root.querySelector('#support-search-input');

  const createFilterConfig = (resetPage = true) => ({
    search: searchInput?.value || '',
    type: currentTypeFilter || '',
    page: resetPage ? 1 : currentPage,
  });

  const displayResults = (results, page = 1) => {
    if (!resultsElement) return;
    resultsElement.innerHTML = '';
    const start = (page - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    results.slice(start, end).forEach((item) => {
      resultsElement.append(createResultCard(item, copy));
    });
    if (page > 1) root.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const displayPagination = (totalResults, page, onPageChange) => {
    if (!paginationEl) return;
    const pageNum = parseInt(page, 10) || 1;
    const totalPages = Math.ceil(totalResults / ITEMS_PER_PAGE);
    paginationEl.innerHTML = '';
    if (totalPages <= 1) return;

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.textContent = copy.previous || 'Previous';
    prevBtn.disabled = pageNum <= 1;
    if (pageNum > 1) prevBtn.dataset.page = String(pageNum - 1);
    paginationEl.appendChild(prevBtn);

    const pages = document.createElement('span');
    pages.className = 'pages';
    const ellipsis = () => {
      const span = document.createElement('span');
      span.textContent = '…';
      span.setAttribute('aria-hidden', 'true');
      return span;
    };
    if (pageNum > 3) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '1';
      btn.dataset.page = '1';
      pages.appendChild(btn);
      if (pageNum > 4) pages.appendChild(ellipsis());
    }
    for (let i = Math.max(1, pageNum - 2); i <= Math.min(totalPages, pageNum + 2); i += 1) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = String(i);
      btn.dataset.page = String(i);
      if (i === pageNum) btn.setAttribute('aria-current', 'page');
      pages.appendChild(btn);
    }
    if (pageNum < totalPages - 2) {
      if (pageNum < totalPages - 3) pages.appendChild(ellipsis());
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = String(totalPages);
      btn.dataset.page = String(totalPages);
      pages.appendChild(btn);
    }
    paginationEl.appendChild(pages);

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.textContent = copy.next || 'Next';
    nextBtn.disabled = pageNum >= totalPages;
    if (pageNum < totalPages) nextBtn.dataset.page = String(pageNum + 1);
    paginationEl.appendChild(nextBtn);

    paginationEl.querySelectorAll('button[data-page]').forEach((btn) => {
      btn.addEventListener('click', () => onPageChange(parseInt(btn.dataset.page, 10)));
    });
  };

  const updateTypeFilterButtons = (typeCounts = {}) => {
    if (!typeFiltersEl) return;
    typeFiltersEl.querySelectorAll('.support-search-type-filter').forEach((btn) => {
      const typeVal = btn.dataset.type;
      btn.disabled = typeVal !== '' && (typeCounts[typeVal] || 0) === 0;
    });
  };

  const runSearch = async (filterConfig) => {
    const query = (filterConfig.search || '').trim();
    root.classList.toggle('support-search-has-query', Boolean(query));

    if (!query) {
      currentPage = 1;
      if (resultsElement) resultsElement.innerHTML = '';
      if (paginationEl) paginationEl.innerHTML = '';
      return;
    }

    const index = await loadSupportSearchIndex();
    let results = filterBySearch(index, filterConfig.search || '');
    const typeCounts = {};
    results.forEach((item) => {
      typeCounts[item.type] = (typeCounts[item.type] || 0) + 1;
    });
    if (filterConfig.type) {
      results = results.filter((item) => item.type === filterConfig.type);
    }
    sortByRelevance(results, filterConfig.search || '');
    updateTypeFilterButtons(typeCounts);

    const page = parseInt(filterConfig.page, 10) || 1;
    currentPage = page;

    const totalResults = results.length;
    const startNum = totalResults > 0 ? (page - 1) * ITEMS_PER_PAGE + 1 : 0;
    const endNum = Math.min(page * ITEMS_PER_PAGE, totalResults);

    const countEl = root.querySelector('#support-search-results-count');
    const startEl = root.querySelector('#support-search-results-start');
    const endEl = root.querySelector('#support-search-results-end');
    if (countEl) countEl.textContent = String(totalResults);
    if (startEl) startEl.textContent = String(startNum);
    if (endEl) endEl.textContent = String(endNum);

    displayResults(results, page);
    displayPagination(totalResults, page, (pageNum) => {
      currentPage = pageNum;
      runSearch({ ...filterConfig, page: pageNum });
    });
  };

  const renderTypeFilters = () => {
    if (!typeFiltersEl) return;
    typeFiltersEl.innerHTML = '';
    FILTER_TYPES.forEach(({ value, labelKey, defaultLabel }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'support-search-type-filter';
      btn.dataset.type = value;
      btn.textContent = copy[labelKey] || defaultLabel;
      btn.setAttribute('aria-pressed', currentTypeFilter === value ? 'true' : 'false');
      if (currentTypeFilter === value) btn.classList.add('active');
      btn.addEventListener('click', () => {
        currentTypeFilter = value;
        typeFiltersEl.querySelectorAll('.support-search-type-filter').forEach((b) => {
          b.setAttribute('aria-pressed', b.dataset.type === value ? 'true' : 'false');
          b.classList.toggle('active', b.dataset.type === value);
        });
        runSearch(createFilterConfig(true));
      });
      typeFiltersEl.appendChild(btn);
    });
  };

  const scheduleSearch = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      runSearch(createFilterConfig(true));
    }, INPUT_DEBOUNCE_MS);
  };

  searchInput?.addEventListener('input', scheduleSearch);
  searchInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(debounceTimer);
      runSearch(createFilterConfig(true));
    }
  });

  const form = root.querySelector('.support-search-form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(debounceTimer);
    runSearch(createFilterConfig(true));
  });

  renderTypeFilters();
  runSearch(createFilterConfig(true));
}

/**
 * @param {HTMLElement} widget - Widget root from Franklin (class .support-search)
 */
export default async function decorate(widget) {
  const root = widget.querySelector('.support-search-root');
  const input = widget.querySelector('#support-search-input');
  const submitBtn = widget.querySelector('button[type="submit"]');
  const label = widget.querySelector('label[for="support-search-input"]');

  if (!root || !input) return;

  const { language } = getLocaleAndLanguage();
  const lang = (language || 'en_us').split('_')[0];
  const copy = await loadWidgetCopy(lang);

  const searchHint = copy.search || 'Search';
  const goLabel = copy.go || 'Go';

  input.placeholder = searchHint;
  input.setAttribute('aria-label', searchHint);
  if (submitBtn) submitBtn.textContent = goLabel;
  if (label) label.textContent = searchHint;

  const showingLabel = root.querySelector('.support-search-showing-label');
  const ofLabel = root.querySelector('.support-search-of-label');
  if (showingLabel) showingLabel.textContent = copy.showing || 'Showing';
  if (ofLabel) ofLabel.textContent = copy.of || 'of';

  buildSupportSearchUi(root, copy);
}
