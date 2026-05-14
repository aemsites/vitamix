/* eslint-disable max-len */

import { loadCSS } from '../../scripts/aem.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';

/**
 * Loads widget copy from the widget's local JSON file.
 * @param {string} lang - Language key (e.g. en, fr)
 * @returns {Promise<Object>} Copy for that language (flat key-value pairs)
 */
async function loadWidgetCopy(lang) {
  const scriptPath = new URL(import.meta.url).pathname;
  const jsonPath = scriptPath.replace(/\.js$/, '.json');
  const base = window.hlx && window.hlx.codeBasePath ? window.hlx.codeBasePath : '';
  const url = `${base}${jsonPath}`;
  const resp = await fetch(url);
  const data = await resp.json();
  const key = data[lang] ? lang : 'en';
  return data[key] || {};
}

/**
 * Parses a publication date string (MM.DD.YYYY) into a Date object.
 * @param {string} dateString - Date in MM.DD.YYYY format
 * @returns {Date|null} Parsed date, or null if the string is absent or malformed
 */
function parsePublicationDate(dateString) {
  if (!dateString || !dateString.trim()) return null;

  const parts = dateString.split('.');
  if (parts.length !== 3) return null;

  const month = parseInt(parts[0], 10) - 1;
  const day = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);

  const date = new Date(year, month, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Formats a publication date for display.
 * @param {string} dateString - Date in MM.DD.YYYY format
 * @returns {string} Formatted date string, or empty string if absent
 */
function formatPublicationDate(dateString) {
  if (!dateString || !dateString.trim()) return '';
  return dateString;
}

/**
 * Fetches and filters press releases from the locale-specific query index.
 * @param {Object} config - Filter criteria; supports a `search` key
 * @returns {Promise<Array<Object>>} Filtered array of press release objects
 */
async function lookupPressReleases(config = {}) {
  const { locale, language } = getLocaleAndLanguage();

  if (!window.pressReleaseIndex) {
    const resp = await fetch(`/${locale}/${language}/corporate-information/media-center/press-releases/query-index.json`);
    const { data } = await resp.json();

    window.pressReleaseIndex = {
      data: data.map((release) => ({
        path: release.path || '',
        title: release.title || '',
        description: release.description || '',
        'publication-date': release['publication-date'] || '',
      })),
    };
  }

  let results = window.pressReleaseIndex.data.map((release) => ({ ...release }));

  if (config.search && config.search.trim()) {
    const searchTerm = config.search.toLowerCase().trim();
    results = results.filter((release) => {
      const titleMatch = release.title.toLowerCase().includes(searchTerm);
      const descMatch = release.description.toLowerCase().includes(searchTerm);
      const dateMatch = release['publication-date'].toLowerCase().includes(searchTerm);
      return titleMatch || descMatch || dateMatch;
    });
  }

  return results;
}

/**
 * Highlights a matching search term within an element using DOM nodes (no innerHTML).
 * @param {HTMLElement} el - Element whose text content should be highlighted
 * @param {string} text - Full plain-text content of the element
 * @param {string} searchTerm - Term to highlight
 */
function applyHighlight(el, text, searchTerm) {
  if (!text || !searchTerm) return;

  const lowerText = text.toLowerCase();
  const lowerSearch = searchTerm.toLowerCase();
  const index = lowerText.indexOf(lowerSearch);

  if (index === -1) return;

  const before = document.createTextNode(text.substring(0, index));
  const mark = document.createElement('span');
  mark.className = 'highlight';
  mark.textContent = text.substring(index, index + searchTerm.length);
  const after = document.createTextNode(text.substring(index + searchTerm.length));

  el.textContent = '';
  el.appendChild(before);
  el.appendChild(mark);
  el.appendChild(after);
}

/**
 * Creates a press release card DOM element.
 * @param {Object} release - Press release data object with title, description, publication-date
 * @returns {HTMLElement} List item element representing the press release card
 */
function createPressCard(release) {
  const li = document.createElement('li');
  li.className = 'card';

  const link = document.createElement('a');
  link.href = release.path || '#';

  const content = document.createElement('div');
  content.className = 'content';

  const title = document.createElement('h3');
  title.textContent = release.title || '';

  const meta = document.createElement('p');
  meta.className = 'meta';
  meta.textContent = formatPublicationDate(release['publication-date']);

  const description = document.createElement('p');
  description.className = 'description';
  description.textContent = release.description || '';

  content.append(title, meta, description);
  link.appendChild(content);
  li.appendChild(link);

  return li;
}

/**
 * Reads query parameters from the current URL and returns them as a config object.
 * @returns {Object} Key-value pairs from URL search params
 */
function getConfigFromURL() {
  const params = new URLSearchParams(window.location.search);
  const config = {};
  params.forEach((value, key) => {
    config[key] = value;
  });
  return config;
}

/**
 * Updates the URL query string to reflect current filter state without reloading the page.
 * @param {Object} filterConfig - Current filter configuration to encode into the URL
 */
function updateURL(filterConfig) {
  const params = new URLSearchParams();

  Object.keys(filterConfig).forEach((key) => {
    if (key === 'page' && filterConfig[key] === 1) return;

    if (filterConfig[key] && filterConfig[key].trim && filterConfig[key].trim()) {
      params.set(key, filterConfig[key]);
    } else if (filterConfig[key] && !filterConfig[key].trim) {
      if (key !== 'page' || filterConfig[key] !== 1) {
        params.set(key, filterConfig[key]);
      }
    }
  });

  const newURL = params.toString()
    ? `${window.location.pathname}?${params.toString()}`
    : window.location.pathname;
  window.history.pushState({ filterConfig }, '', newURL);
}

/**
 * Wires up search, sort, and pagination for the press release listing.
 * @param {HTMLElement} container - The `.press-center` element to initialize
 * @param {Object} config - Initial filter configuration (typically empty)
 * @param {Object} copy - i18n labels for the widget
 */
function buildPressFiltering(container, config = {}, copy = {}) {
  const ITEMS_PER_PAGE = 12;
  let currentPage = 1;

  const resultsElement = container.querySelector('.results');
  const sortDetails = container.querySelector('.sort');
  const sortMenu = container.querySelector('.sort menu');
  const sortLabel = container.querySelector('#sortby');

  const selectSort = (btn) => {
    sortMenu.querySelectorAll('button').forEach((b) => b.removeAttribute('aria-pressed'));
    btn.setAttribute('aria-pressed', 'true');
    sortLabel.textContent = btn.textContent;
    sortLabel.dataset.sort = btn.dataset.sort;
    sortDetails.open = false;
    // eslint-disable-next-line no-use-before-define
    const filterConfig = createFilterConfig();
    filterConfig.sort = btn.dataset.sort;
    // eslint-disable-next-line no-use-before-define
    runSearch(filterConfig);
  };

  sortMenu.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-sort]');
    if (btn) selectSort(btn);
  });

  const highlightResults = (res) => {
    const search = document.getElementById('fulltext').value;
    if (!search) return;
    res.querySelectorAll('h3').forEach((title) => {
      applyHighlight(title, title.textContent, search);
    });
  };

  const displayResults = (results, page = 1) => {
    resultsElement.innerHTML = '';

    const startIndex = (page - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    results.slice(startIndex, endIndex).forEach((release) => {
      resultsElement.append(createPressCard(release));
    });
    highlightResults(resultsElement);

    if (page > 1) {
      container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const displayPagination = (totalResults, page = 1) => {
    const paginationElement = container.querySelector('.pagination');
    if (!paginationElement) return;

    const totalPages = Math.ceil(totalResults / ITEMS_PER_PAGE);
    paginationElement.innerHTML = '';
    if (totalPages <= 1) return;

    const prevBtn = document.createElement('button');
    prevBtn.textContent = copy.previous || 'Previous';
    prevBtn.disabled = page <= 1;
    if (page > 1) prevBtn.dataset.page = page - 1;
    paginationElement.appendChild(prevBtn);

    const pages = document.createElement('span');
    pages.className = 'pages';

    const ellipsis = () => {
      const span = document.createElement('span');
      span.textContent = '…';
      span.setAttribute('aria-hidden', 'true');
      return span;
    };

    if (page > 3) {
      const btn = document.createElement('button');
      btn.textContent = '1';
      btn.dataset.page = '1';
      pages.appendChild(btn);
      if (page > 4) pages.appendChild(ellipsis());
    }

    for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i += 1) {
      const btn = document.createElement('button');
      btn.textContent = i;
      btn.dataset.page = i;
      if (i === page) btn.setAttribute('aria-current', 'page');
      pages.appendChild(btn);
    }

    if (page < totalPages - 2) {
      if (page < totalPages - 3) pages.appendChild(ellipsis());
      const btn = document.createElement('button');
      btn.textContent = totalPages;
      btn.dataset.page = totalPages;
      pages.appendChild(btn);
    }

    paginationElement.appendChild(pages);

    const nextBtn = document.createElement('button');
    nextBtn.textContent = copy.next || 'Next';
    nextBtn.disabled = page >= totalPages;
    if (page < totalPages) nextBtn.dataset.page = page + 1;
    paginationElement.appendChild(nextBtn);

    paginationElement.querySelectorAll('button[data-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const newPage = parseInt(btn.dataset.page, 10);
        currentPage = newPage;
        // eslint-disable-next-line no-use-before-define
        const filterConfig = createFilterConfig(false);
        filterConfig.page = newPage;
        // eslint-disable-next-line no-use-before-define
        runSearch(filterConfig);
      });
    });
  };

  const createFilterConfig = (resetPage = false) => {
    const filterConfig = { ...config };
    filterConfig.search = document.getElementById('fulltext').value;

    if (resetPage) {
      currentPage = 1;
      filterConfig.page = 1;
    } else {
      filterConfig.page = currentPage;
    }

    return filterConfig;
  };

  const runSearch = async (filterConfig = config, updateURLState = true) => {
    const sorts = {
      default: (a, b) => a.title.localeCompare(b.title),
      newest: (a, b) => {
        const dateA = parsePublicationDate(a['publication-date']);
        const dateB = parsePublicationDate(b['publication-date']);
        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;
        return dateB.getTime() - dateA.getTime();
      },
      oldest: (a, b) => {
        const dateA = parsePublicationDate(a['publication-date']);
        const dateB = parsePublicationDate(b['publication-date']);
        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;
        return dateA.getTime() - dateB.getTime();
      },
      'name-asc': (a, b) => a.title.localeCompare(b.title),
      'name-desc': (a, b) => b.title.localeCompare(a.title),
    };

    const results = await lookupPressReleases(filterConfig);

    let sortBy = filterConfig.sort || 'newest';
    if (!filterConfig.sort && sortLabel) {
      sortBy = sortLabel.dataset.sort;
    }
    results.sort(sorts[sortBy] || sorts.newest);

    const page = parseInt(filterConfig.page, 10) || 1;
    currentPage = page;

    const totalResults = results.length;
    const startNum = totalResults > 0 ? ((page - 1) * ITEMS_PER_PAGE) + 1 : 0;
    const endNum = Math.min(page * ITEMS_PER_PAGE, totalResults);

    container.querySelector('#results-count').textContent = totalResults;
    container.querySelector('#results-start').textContent = startNum;
    container.querySelector('#results-end').textContent = endNum;

    displayResults(results, page);
    displayPagination(totalResults, page);

    if (updateURLState) {
      updateURL(filterConfig);
    }
  };

  const searchElement = container.querySelector('#fulltext');

  searchElement.addEventListener('input', () => {
    runSearch(createFilterConfig(true));
  });

  const form = container.querySelector('form.controls');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      runSearch(createFilterConfig(true));
    });
  }

  searchElement.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      runSearch(createFilterConfig(true));
    }
  });

  const urlConfig = getConfigFromURL();
  const initialConfig = { ...config, ...urlConfig };

  if (urlConfig.page) {
    currentPage = parseInt(urlConfig.page, 10);
  }

  if (urlConfig.search) {
    searchElement.value = urlConfig.search;
  }

  if (urlConfig.sort && sortLabel) {
    sortLabel.dataset.sort = urlConfig.sort;
    const sortBtn = sortMenu.querySelector(`button[data-sort="${urlConfig.sort}"]`);
    if (sortBtn) {
      sortLabel.textContent = sortBtn.textContent;
      sortMenu.querySelectorAll('button').forEach((b) => b.removeAttribute('aria-pressed'));
      sortBtn.setAttribute('aria-pressed', 'true');
    }
  }

  runSearch(initialConfig);

  window.addEventListener('popstate', (event) => {
    if (!event.state || !event.state.filterConfig) return;

    const savedConfig = event.state.filterConfig;

    searchElement.value = savedConfig.search || '';

    if (savedConfig.sort && sortLabel) {
      sortLabel.dataset.sort = savedConfig.sort;
      const sortBtn = sortMenu.querySelector(`button[data-sort="${savedConfig.sort}"]`);
      if (sortBtn) {
        sortLabel.textContent = sortBtn.textContent;
      }
    }

    currentPage = savedConfig.page ? parseInt(savedConfig.page, 10) : 1;

    runSearch(savedConfig, false);
  });
}

/**
 * Initializes the press center: loads copy, applies labels, and starts filtering.
 */
async function init() {
  const pressCenter = document.querySelector('.press-center');
  if (!pressCenter) return;

  const { language } = getLocaleAndLanguage();
  const lang = (language || 'en_us').split('_')[0];
  const copy = await loadWidgetCopy(lang);

  const existingH1 = document.querySelector('main h1');
  if (existingH1 && !pressCenter.contains(existingH1)) {
    existingH1.classList.add('title');
    pressCenter.insertBefore(existingH1, pressCenter.firstChild);
  }

  const searchInput = pressCenter.querySelector('#fulltext');
  if (searchInput) {
    searchInput.placeholder = copy.search || 'Search';
  }

  const showingLabel = pressCenter.querySelector('.showing-label');
  if (showingLabel) {
    showingLabel.textContent = copy.showing || 'Showing';
  }

  const ofLabel = pressCenter.querySelector('.of-label');
  if (ofLabel) {
    ofLabel.textContent = copy.of || 'of';
  }

  const paginationNav = pressCenter.querySelector('.pagination');
  if (paginationNav) {
    paginationNav.setAttribute('aria-label', copy.pagination || 'Pagination');
  }

  const sortByLabel = pressCenter.querySelector('.sort-by-label');
  if (sortByLabel) {
    sortByLabel.textContent = `${copy.sortBy || 'Sort by'}:`;
  }

  const sortLabel = pressCenter.querySelector('#sortby');
  if (sortLabel) {
    sortLabel.textContent = copy.newest || 'Newest';
  }

  pressCenter.querySelectorAll('.sort menu button').forEach((btn) => {
    const sortType = btn.dataset.sort;
    if (sortType === 'default') {
      btn.textContent = copy.default || 'Default';
    } else if (sortType === 'newest') {
      btn.textContent = copy.newest || 'Newest';
    } else if (sortType === 'oldest') {
      btn.textContent = copy.oldest || 'Oldest';
    } else if (sortType === 'name-asc') {
      btn.textContent = copy.nameAZ || 'Name A-Z';
    } else if (sortType === 'name-desc') {
      btn.textContent = copy.nameZA || 'Name Z-A';
    }
  });

  buildPressFiltering(pressCenter, {}, copy);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  loadCSS('/widgets/press-center/press-center.css');
  init();
}

export default { lookupPressReleases };
