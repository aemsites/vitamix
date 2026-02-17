import { loadCSS, fetchPlaceholders } from '../../scripts/aem.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';

/**
 * Normalize a single article from the articles query index.
 * @param {Object} row - Raw row from index
 * @returns {Object} Normalized item with type, path, title, description, image
 */
function normalizeArticle(row) {
  return {
    type: 'article',
    path: row.path || '',
    title: (row.title || '').trim(),
    description: (row.description || '').trim(),
    image: row.image || '',
    'publication-date': row['publication-date'] || '',
    author: row.author || '',
    tags: typeof row.tags === 'string' ? row.tags.split(',').map((t) => t.trim()).filter(Boolean) : (row.tags || []),
  };
}

/**
 * Normalize a single recipe from the recipes query index.
 * @param {Object} row - Raw row from index
 * @param {string} locale - Locale (e.g. us)
 * @param {string} language - Language (e.g. en_us)
 * @returns {Object} Normalized item with type, path, title, description, image
 */
function normalizeRecipe(row, locale, language) {
  const path = row.path || (row.title ? `/${locale}/${language}/recipes/${encodeURIComponent(String(row.title).trim().toLowerCase().replace(/\s+/g, '-'))}` : '');
  return {
    type: 'recipe',
    path,
    title: (row.title || '').trim(),
    description: (row.description || '').trim(),
    image: row.image || '',
  };
}

/**
 * Normalize a single item from the locale query index.
 * @param {Object} row - Raw row from index
 * @returns {Object} Normalized item with type, path, title, description, image
 */
function normalizeQueryItem(row) {
  return {
    type: 'query',
    path: row.path || row.url || '',
    title: (row.title || '').trim(),
    description: (row.description || '').trim(),
    image: row.image || '',
  };
}

/**
 * Whether to use fcors proxy for product index (localhost, .aem.page, .aem.live).
 * @returns {boolean}
 */
function useFcors() {
  const { hostname } = window.location;
  return hostname === 'localhost' || hostname.includes('.aem.page') || hostname.includes('.aem.live');
}

/**
 * Fetch URL via fcors proxy for non-prod origins.
 * @param {string} url - Path (e.g. /us/en_us/products/index.json)
 * @returns {Promise<Response>}
 */
function corsProxyFetch(url) {
  const corsProxy = 'https://fcors.org/?url=';
  const corsKey = '&key=Mg23N96GgR8O3NjU';
  const fullUrl = `https://main--vitamix--aemsites.aem.network${url}`;
  return fetch(`${corsProxy}${encodeURIComponent(fullUrl)}${corsKey}`);
}

/**
 * Normalize a parent product from the products index for search.
 * @param {Object} row - Raw product row (parent only: no parentSku)
 * @param {string} locale - Locale (e.g. us)
 * @param {string} language - Language (e.g. en_us)
 * @returns {Object} Normalized item with type, path, title, description, image
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
 * Fetch and merge all search indices (articles, recipes, locale query-index, products).
 * Uses fcors for products on localhost, .aem.page, .aem.live.
 * @returns {Promise<Array<Object>>} Combined normalized items
 */
async function loadSearchIndex() {
  if (window.searchResultsIndex) {
    return window.searchResultsIndex;
  }

  const { locale, language } = getLocaleAndLanguage();

  const articlesUrl = `/${locale}/${language}/articles/query-index.json`;
  const recipesUrl = `/${locale}/${language}/recipes/query-index.json`;
  const queryUrl = `/${locale}/${language}/query-index.json`;
  const productsUrl = `/${locale}/${language}/products/index.json?include=all`;

  const fetchJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : { data: [] }));
  const productsFetch = useFcors()
    ? () => corsProxyFetch(productsUrl).then((r) => (r.ok ? r.json() : { data: [] }))
    : () => fetchJson(productsUrl);

  const [articlesRes, recipesRes, queryRes, productsRes] = await Promise.allSettled([
    fetchJson(articlesUrl),
    fetchJson(recipesUrl),
    fetchJson(queryUrl),
    productsFetch(),
  ]);

  const combined = [];

  if (articlesRes.status === 'fulfilled' && Array.isArray(articlesRes.value?.data)) {
    articlesRes.value.data.forEach((row) => combined.push(normalizeArticle(row)));
  }

  if (recipesRes.status === 'fulfilled' && Array.isArray(recipesRes.value?.data)) {
    const recipes = recipesRes.value.data.filter((r) => {
      const status = (r.status || '').toLowerCase();
      return status === 'updated' || status === 'new';
    });
    const seenRecipeTitles = new Set();
    recipes.forEach((row) => {
      const key = (row.title || '').trim().toLowerCase();
      if (key && seenRecipeTitles.has(key)) return;
      if (key) seenRecipeTitles.add(key);
      combined.push(normalizeRecipe(row, locale, language));
    });
  }

  if (queryRes.status === 'fulfilled' && Array.isArray(queryRes.value?.data)) {
    queryRes.value.data.forEach((row) => combined.push(normalizeQueryItem(row)));
  }

  if (productsRes.status === 'fulfilled' && Array.isArray(productsRes.value?.data)) {
    const parents = productsRes.value.data.filter((row) => !(row.parentSku || '').trim());
    parents.forEach((row) => combined.push(normalizeProduct(row, locale, language)));
  }

  window.searchResultsIndex = combined;
  return combined;
}

/**
 * Remove diacritical marks for accent-insensitive matching (e.g. "mélangeur" → "melangeur").
 * @param {string} str
 * @returns {string}
 */
function removeAccents(str) {
  if (!str) return '';
  return str.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

/**
 * Normalize string for search: lowercase and remove accents.
 * @param {string} str
 * @returns {string}
 */
function normalizeForSearch(str) {
  return removeAccents((str || '').toLowerCase());
}

/**
 * Filter combined index by search term (accent-insensitive).
 * @param {Array<Object>} index - Normalized items
 * @param {string} searchTerm - Search string
 * @returns {Array<Object>} Filtered items with match info
 */
function filterBySearch(index, searchTerm) {
  if (!searchTerm || !searchTerm.trim()) {
    return index.map((item) => ({ ...item, searchTerm: '' }));
  }

  const term = searchTerm.toLowerCase().trim();
  const termNorm = normalizeForSearch(term);
  return index.filter((item) => {
    const titleMatch = normalizeForSearch(item.title || '').includes(termNorm);
    const descMatch = normalizeForSearch(item.description || '').includes(termNorm);
    const authorMatch = normalizeForSearch(item.author || '').includes(termNorm);
    const tags = item.tags || [];
    const tagsMatch = tags.some((tag) => normalizeForSearch(String(tag)).includes(termNorm));
    return titleMatch || descMatch || authorMatch || tagsMatch;
  }).map((item) => ({ ...item, searchTerm: term }));
}

/** Type order for tie-break: product > recipe > article > query (lower = higher priority). */
const TYPE_ORDER = {
  product: 0,
  recipe: 1,
  article: 2,
  query: 3,
};

/**
 * Sort by relevance: first occurrence of term in title then description; then by type.
 * @param {Array<Object>} results - Filtered results (with searchTerm set)
 * @param {string} searchTerm - Normalized search term (lowercase)
 * @returns {void} Sorts in place
 */
function sortByRelevance(results, searchTerm) {
  if (!searchTerm || !searchTerm.trim()) {
    results.sort((a, b) => (TYPE_ORDER[a.type] ?? 4) - (TYPE_ORDER[b.type] ?? 4));
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

    // Rank 0 = title match (earlier offset = better), 1 = description only, 2 = other (author/tags)
    const typeOrder = TYPE_ORDER[item.type] ?? 4;
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

/**
 * Append image optimization query params to a URL.
 * @param {string} url - Image URL (path or full URL)
 * @returns {string}
 */
function addImageParams(url) {
  if (!url) return '';
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${IMAGE_QUERY_PARAMS}`;
}

/**
 * Get relative image path from URL.
 * @param {string} imageUrl - Absolute or relative URL
 * @returns {string}
 */
function getRelativeImagePath(imageUrl) {
  if (!imageUrl) return '';
  try {
    const url = new URL(imageUrl, window.location.origin);
    return url.pathname + url.search;
  } catch {
    return imageUrl;
  }
}

/**
 * Get image src for a result card. Product images use .aem.network on preview origins.
 * @param {Object} item - Normalized search item
 * @returns {string}
 */
function getResultImageSrc(item) {
  if (!item?.image) return '';
  if (item.type === 'product' && useFcors()) {
    const path = item.image.startsWith('http')
      ? new URL(item.image).pathname
      : item.image;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return addImageParams(`${AEM_NETWORK_ORIGIN}${normalizedPath}`);
  }
  return addImageParams(getRelativeImagePath(item.image));
}

/**
 * Build a map from normalized (accent-stripped) index to original string index.
 * @param {string} original
 * @returns {number[]} normalizedIndex → originalIndex
 */
function getNormalizedToOriginalMap(original) {
  const map = [];
  for (let i = 0; i < original.length; i += 1) {
    const norm = removeAccents(original[i]);
    for (let j = 0; j < norm.length; j += 1) map.push(i);
  }
  return map;
}

/**
 * Highlight matching substring in text (accent-insensitive).
 * @param {string} text - Full text
 * @param {string} searchTerm - Term to highlight
 * @returns {string} HTML with highlight span
 */
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

/**
 * Create a result card DOM element.
 * @param {Object} item - Normalized search item
 * @param {Object} placeholders - i18n placeholders
 * @returns {HTMLElement}
 */
function createResultCard(item, placeholders = {}) {
  const li = document.createElement('li');
  li.className = 'card';

  const link = document.createElement('a');
  link.href = item.path || '#';

  let imageEl;
  if (item.image) {
    const imageSrc = getResultImageSrc(item);
    if (!imageSrc || imageSrc.includes('default-meta-image')) {
      imageEl = document.createElement('div');
      imageEl.className = 'img placeholder';
    } else {
      imageEl = document.createElement('img');
      imageEl.src = imageSrc;
      imageEl.alt = '';
      imageEl.loading = 'lazy';
    }
  } else {
    imageEl = document.createElement('div');
    imageEl.className = 'img placeholder';
  }

  const content = document.createElement('div');
  content.className = 'content';

  // Type badges: use sheet keys Item, Recipe, Page, Product (e.g. Product => Produit for FR).
  const typeLabels = {
    article: placeholders.typeArticle || placeholders.item || 'Article',
    recipe: placeholders.typeRecipe || placeholders.recipe || 'Recipe',
    query: placeholders.typeQuery || placeholders.page || 'Page',
    product: placeholders.typeProduct || placeholders.product || 'Product',
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
  link.append(imageEl, content);
  li.appendChild(link);
  return li;
}

/**
 * Read filter config from URL query params.
 * @returns {Object}
 */
function getConfigFromURL() {
  const params = new URLSearchParams(window.location.search);
  const config = {};
  params.forEach((value, key) => { config[key] = value; });
  return config;
}

/**
 * Update URL with current filter state.
 * @param {Object} filterConfig
 */
function updateURL(filterConfig) {
  const params = new URLSearchParams();
  Object.keys(filterConfig).forEach((key) => {
    if (key === 'page' && filterConfig[key] === 1) return;
    const val = filterConfig[key];
    if (val && (typeof val !== 'string' || val.trim())) {
      if (key !== 'page' || val !== 1) params.set(key, val);
    }
  });
  const newURL = params.toString()
    ? `${window.location.pathname}?${params.toString()}`
    : window.location.pathname;
  window.history.pushState({ filterConfig }, '', newURL);
}

/** Type filter options (value '' = all). Uses same placeholder keys as card badges. */
const FILTER_TYPES = [
  {
    value: '', labelKey: 'filterAll', fallbackKey: null, defaultLabel: 'All',
  },
  {
    value: 'product', labelKey: 'typeProduct', fallbackKey: 'product', defaultLabel: 'Product',
  },
  {
    value: 'recipe', labelKey: 'typeRecipe', fallbackKey: 'recipe', defaultLabel: 'Recipe',
  },
  {
    value: 'article', labelKey: 'typeArticle', fallbackKey: 'item', defaultLabel: 'Article',
  },
  {
    value: 'query', labelKey: 'typeQuery', fallbackKey: 'page', defaultLabel: 'Page',
  },
];

/**
 * Build search UI and wire search/pagination.
 * @param {HTMLElement} container - .search-results root
 * @param {Object} config - Initial config
 * @param {Object} placeholders - i18n placeholders
 */
function buildSearchFiltering(container, config = {}, placeholders = {}) {
  const ITEMS_PER_PAGE = 12;
  let currentPage = 1;
  let currentTypeFilter = '';

  const resultsElement = container.querySelector('.results');
  const typeFiltersEl = container.querySelector('.type-filters');

  const createFilterConfig = (resetPage = true) => {
    const filterConfig = { ...config };
    filterConfig.search = document.getElementById('fulltext').value;
    filterConfig.type = currentTypeFilter || '';
    filterConfig.page = resetPage ? 1 : currentPage;
    if (resetPage) currentPage = 1;
    return filterConfig;
  };

  const displayResults = (results, page = 1) => {
    resultsElement.innerHTML = '';
    const start = (page - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const pageResults = results.slice(start, end);
    pageResults.forEach((item) => resultsElement.append(createResultCard(item, placeholders)));
    if (page > 1) container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const displayPagination = (totalResults, page, onPageChange) => {
    const pageNum = parseInt(page, 10) || 1;
    const paginationElement = container.querySelector('.pagination');
    if (!paginationElement) return;
    const totalPages = Math.ceil(totalResults / ITEMS_PER_PAGE);
    paginationElement.innerHTML = '';
    if (totalPages <= 1) return;

    const prevBtn = document.createElement('button');
    prevBtn.textContent = placeholders.previous || 'Previous';
    prevBtn.disabled = pageNum <= 1;
    if (pageNum > 1) prevBtn.dataset.page = pageNum - 1;
    paginationElement.appendChild(prevBtn);

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
      btn.textContent = '1';
      btn.dataset.page = '1';
      pages.appendChild(btn);
      if (pageNum > 4) pages.appendChild(ellipsis());
    }
    for (let i = Math.max(1, pageNum - 2); i <= Math.min(totalPages, pageNum + 2); i += 1) {
      const btn = document.createElement('button');
      btn.textContent = i;
      btn.dataset.page = i;
      if (i === pageNum) btn.setAttribute('aria-current', 'page');
      pages.appendChild(btn);
    }
    if (pageNum < totalPages - 2) {
      if (pageNum < totalPages - 3) pages.appendChild(ellipsis());
      const btn = document.createElement('button');
      btn.textContent = totalPages;
      btn.dataset.page = totalPages;
      pages.appendChild(btn);
    }
    paginationElement.appendChild(pages);

    const nextBtn = document.createElement('button');
    nextBtn.textContent = placeholders.next || 'Next';
    nextBtn.disabled = pageNum >= totalPages;
    if (pageNum < totalPages) nextBtn.dataset.page = pageNum + 1;
    paginationElement.appendChild(nextBtn);

    if (onPageChange) {
      paginationElement.querySelectorAll('button[data-page]').forEach((btn) => {
        btn.addEventListener('click', () => onPageChange(parseInt(btn.dataset.page, 10)));
      });
    }
  };

  const updateTypeFilterButtons = (typeCounts = {}) => {
    if (!typeFiltersEl) return;
    typeFiltersEl.querySelectorAll('.type-filter').forEach((btn) => {
      const typeVal = btn.dataset.type;
      btn.disabled = typeVal !== '' && (typeCounts[typeVal] || 0) === 0;
    });
  };

  const runSearch = async (filterConfig = config, updateURLState = true) => {
    const index = await loadSearchIndex();
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

    container.querySelector('#results-count').textContent = totalResults;
    container.querySelector('#results-start').textContent = startNum;
    container.querySelector('#results-end').textContent = endNum;

    displayResults(results, page);
    displayPagination(totalResults, page, (pageNum) => {
      currentPage = pageNum;
      runSearch(createFilterConfig(false));
    });

    if (updateURLState) updateURL(filterConfig);
  };

  const renderTypeFilters = () => {
    if (!typeFiltersEl) return;
    typeFiltersEl.innerHTML = '';
    FILTER_TYPES.forEach(({
      value, labelKey, fallbackKey, defaultLabel,
    }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'type-filter';
      btn.dataset.type = value;
      const label = placeholders[labelKey]
        || (fallbackKey ? placeholders[fallbackKey] : null)
        || defaultLabel;
      btn.textContent = label;
      btn.setAttribute('aria-pressed', currentTypeFilter === value ? 'true' : 'false');
      if (currentTypeFilter === value) btn.classList.add('active');
      btn.addEventListener('click', () => {
        currentTypeFilter = value;
        typeFiltersEl.querySelectorAll('.type-filter').forEach((b) => {
          b.setAttribute('aria-pressed', b.dataset.type === value ? 'true' : 'false');
          b.classList.toggle('active', b.dataset.type === value);
        });
        runSearch(createFilterConfig(true));
      });
      typeFiltersEl.appendChild(btn);
    });
  };

  const searchElement = container.querySelector('#fulltext');
  searchElement.addEventListener('input', () => runSearch(createFilterConfig(true)));
  searchElement.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') runSearch(createFilterConfig(true));
  });

  const form = container.querySelector('form.controls');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      runSearch(createFilterConfig(true));
    });
  }

  const urlConfig = getConfigFromURL();
  const initialConfig = { ...config, ...urlConfig };
  if (urlConfig.page) currentPage = parseInt(urlConfig.page, 10);
  if (urlConfig.search) searchElement.value = urlConfig.search;
  if (urlConfig.type && FILTER_TYPES.some((t) => t.value === urlConfig.type)) {
    currentTypeFilter = urlConfig.type;
  }

  renderTypeFilters();
  runSearch(initialConfig);

  window.addEventListener('popstate', (event) => {
    if (event.state?.filterConfig) {
      const saved = event.state.filterConfig;
      if (saved.search !== undefined) searchElement.value = saved.search || '';
      if (saved.page) currentPage = parseInt(saved.page, 10);
      if (saved.type !== undefined) {
        currentTypeFilter = saved.type || '';
        renderTypeFilters();
      }
      runSearch(saved, false);
    }
  });
}

async function init() {
  const container = document.querySelector('.search-results');
  if (!container) return;

  const { locale, language } = getLocaleAndLanguage();
  const placeholders = await fetchPlaceholders(`/${locale}/${language}`);

  const existingH1 = document.querySelector('main h1');
  if (existingH1 && !container.contains(existingH1)) {
    existingH1.classList.add('title');
    container.insertBefore(existingH1, container.firstChild);
  }

  const searchInput = container.querySelector('#fulltext');
  if (searchInput) searchInput.placeholder = placeholders.search || 'Search';
  const showingLabel = container.querySelector('.showing-label');
  if (showingLabel) showingLabel.textContent = placeholders.showing || 'Showing';
  const ofLabel = container.querySelector('.of-label');
  if (ofLabel) ofLabel.textContent = placeholders.of || 'of';

  buildSearchFiltering(container, {}, placeholders);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  loadCSS('/widgets/search-results/search-results.css');
  init();
}

export default { loadSearchIndex, filterBySearch };
