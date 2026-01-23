/* eslint-disable max-len */

import { loadCSS } from '../../scripts/aem.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';

/**
 * Parses a publication date string (MM.DD.YYYY) into a Date object.
 * @param {string} dateString - Date in MM.DD.YYYY format
 * @returns {Date|null} Parsed date or null if invalid
 */
function parsePublicationDate(dateString) {
  if (!dateString || !dateString.trim()) return null;

  const parts = dateString.split('.');
  if (parts.length !== 3) return null;

  const month = parseInt(parts[0], 10) - 1; // months are 0-indexed
  const day = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);

  const date = new Date(year, month, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Formats a publication date for display.
 * @param {string} dateString - Date in MM.DD.YYYY format
 * @returns {string} Formatted date string
 */
function formatPublicationDate(dateString) {
  if (!dateString || !dateString.trim()) return '';
  return dateString; // Keep original format for display
}

/**
 * Parses tags from a comma-separated string into an array.
 * @param {string} tagsString - Comma-separated tags
 * @returns {Array<string>} Array of trimmed tag strings
 */
function parseTags(tagsString) {
  if (!tagsString || !tagsString.trim()) return [];
  return tagsString.split(',').map((tag) => tag.trim()).filter((tag) => tag);
}

/**
 * Fetches and filters articles from the article index.
 * @param {Object} config - Object with filter criteria
 * @returns {Promise<Array<Object>>} Array of filtered article objects with match info
 */
async function lookupArticles(config = {}) {
  const { locale, language } = getLocaleAndLanguage();

  if (!window.articleIndex) {
    const resp = await fetch(`/${locale}/${language}/articles/query-index.json`);
    const { data } = await resp.json();

    window.articleIndex = {
      data: data.map((article) => ({
        path: article.path || '',
        title: article.title || '',
        image: article.image || '',
        description: article.description || '',
        author: article.author || '',
        'publication-date': article['publication-date'] || '',
        tags: parseTags(article.tags || ''),
      })),
    };
  }

  // Filter by fulltext search if provided
  let results = window.articleIndex.data.map((article) => ({ ...article }));

  if (config.fulltext && config.fulltext.trim()) {
    const searchTerm = config.fulltext.toLowerCase().trim();
    results = results.filter((article) => {
      const titleMatch = article.title.toLowerCase().includes(searchTerm);
      const descMatch = article.description.toLowerCase().includes(searchTerm);
      const authorMatch = article.author.toLowerCase().includes(searchTerm);

      // Check which tags match
      const matchedTags = article.tags.filter((tag) => tag.toLowerCase().includes(searchTerm));
      const tagsMatch = matchedTags.length > 0;

      // Store match info on the article for highlighting
      article.matchedAuthor = authorMatch;
      article.matchedTags = matchedTags;
      article.searchTerm = searchTerm;

      return titleMatch || descMatch || authorMatch || tagsMatch;
    });
  } else {
    // No search term - clear match info
    results.forEach((article) => {
      article.matchedAuthor = false;
      article.matchedTags = [];
      article.searchTerm = '';
    });
  }

  return results;
}

/**
 * Highlights matching substring within text.
 * @param {string} text - The full text
 * @param {string} searchTerm - The term to highlight
 * @returns {string} HTML string with highlighted match
 */
function highlightMatch(text, searchTerm) {
  if (!text || !searchTerm) return text;

  const lowerText = text.toLowerCase();
  const lowerSearch = searchTerm.toLowerCase();
  const index = lowerText.indexOf(lowerSearch);

  if (index === -1) return text;

  const before = text.substring(0, index);
  const match = text.substring(index, index + searchTerm.length);
  const after = text.substring(index + searchTerm.length);

  return `${before}<span class="highlight">${match}</span>${after}`;
}

/**
 * Converts an absolute image URL to a relative path.
 * @param {string} imageUrl - Absolute or relative image URL
 * @returns {string} Relative image path
 */
function getRelativeImagePath(imageUrl) {
  if (!imageUrl) return '';

  try {
    const url = new URL(imageUrl, window.location.origin);
    // Return pathname with query string (for image optimization params)
    return url.pathname + url.search;
  } catch {
    // If URL parsing fails, return the original
    return imageUrl;
  }
}

/**
 * Creates an article card DOM element for display in the article listing.
 * @param {Object} article - Article data object with title, image, description, etc.
 * @returns {HTMLElement} Article card element
 */
function createArticleCard(article) {
  const li = document.createElement('li');
  li.className = 'card';

  const link = document.createElement('a');
  link.href = article.path || '#';

  // Image - convert to relative path
  let imageElement;
  if (article.image) {
    const imagePath = getRelativeImagePath(article.image);
    const isDefaultImage = imagePath.includes('default-meta-image');

    if (isDefaultImage || !imagePath) {
      imageElement = document.createElement('div');
      imageElement.className = 'img placeholder';
    } else {
      imageElement = document.createElement('img');
      imageElement.src = imagePath;
      imageElement.alt = '';
      imageElement.loading = 'lazy';
    }
  } else {
    imageElement = document.createElement('div');
    imageElement.className = 'img placeholder';
  }

  const content = document.createElement('div');
  content.className = 'content';

  const title = document.createElement('h3');
  title.textContent = article.title || '';

  const meta = document.createElement('p');
  meta.className = 'meta';

  const metaParts = [];
  if (article['publication-date']) {
    metaParts.push(formatPublicationDate(article['publication-date']));
  }
  if (article.author) {
    // Highlight matching portion of author if it matched the search
    const authorDisplay = article.matchedAuthor && article.searchTerm
      ? highlightMatch(article.author, article.searchTerm)
      : article.author;
    metaParts.push(`By: <a href="#">${authorDisplay}</a>`);
  }
  meta.innerHTML = metaParts.join(' | ');

  const description = document.createElement('p');
  description.className = 'description';
  description.textContent = article.description || '';

  content.append(title, meta, description);

  // Display matched tags if any, with matching portion highlighted
  if (article.matchedTags && article.matchedTags.length > 0) {
    const tagsContainer = document.createElement('div');
    tagsContainer.className = 'matched-tags';
    article.matchedTags.forEach((tag) => {
      const tagSpan = document.createElement('span');
      tagSpan.className = 'tag';
      tagSpan.innerHTML = article.searchTerm ? highlightMatch(tag, article.searchTerm) : tag;
      tagsContainer.appendChild(tagSpan);
    });
    content.appendChild(tagsContainer);
  }

  link.append(imageElement, content);
  li.appendChild(link);

  return li;
}

/**
 * Reads query parameters from URL and returns as config object.
 * @returns {Object} Configuration object from URL params
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
 * Updates URL query parameters to reflect current filter state.
 * @param {Object} filterConfig - Current filter configuration
 */
function updateURL(filterConfig) {
  const params = new URLSearchParams();

  Object.keys(filterConfig).forEach((key) => {
    // Skip page if it's 1 (default)
    if (key === 'page' && filterConfig[key] === 1) {
      return;
    }

    if (filterConfig[key] && filterConfig[key].trim && filterConfig[key].trim()) {
      params.set(key, filterConfig[key]);
    } else if (filterConfig[key] && !filterConfig[key].trim) {
      if (key !== 'page' || filterConfig[key] !== 1) {
        params.set(key, filterConfig[key]);
      }
    }
  });

  const newURL = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname;
  window.history.pushState({ filterConfig }, '', newURL);
}

/**
 * Builds complete article listing with search and sorting functionality.
 * @param {HTMLElement} container - Container element to transform into an article listing
 * @param {Object} config - Initial filter configuration
 */
function buildArticleFiltering(container, config = {}) {
  const ITEMS_PER_PAGE = 12;
  let currentPage = 1;

  const resultsElement = container.querySelector('.results');

  // Sort dropdown
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

  // Highlights search terms in article titles
  const highlightResults = (res) => {
    const fulltext = document.getElementById('fulltext').value;
    if (fulltext) {
      res.querySelectorAll('h3').forEach((title) => {
        const content = title.textContent;
        const offset = content.toLowerCase().indexOf(fulltext.toLowerCase());
        if (offset >= 0) {
          title.innerHTML = `${content.substring(0, offset)}<span class="highlight">${content.substring(offset, offset + fulltext.length)}</span>${content.substring(offset + fulltext.length)}`;
        }
      });
    }
  };

  // Renders article cards to the results area
  const displayResults = async (results, page = 1) => {
    resultsElement.innerHTML = '';

    const startIndex = (page - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const paginatedResults = results.slice(startIndex, endIndex);

    paginatedResults.forEach((article) => {
      resultsElement.append(createArticleCard(article));
    });
    highlightResults(resultsElement);

    if (page > 1) {
      container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Renders pagination controls
  const displayPagination = (totalResults, page = 1) => {
    const paginationElement = container.querySelector('.pagination');
    if (!paginationElement) return;

    const totalPages = Math.ceil(totalResults / ITEMS_PER_PAGE);
    paginationElement.innerHTML = '';

    if (totalPages <= 1) return;

    const prevBtn = document.createElement('button');
    prevBtn.textContent = 'Previous';
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

    // First page
    if (page > 3) {
      const btn = document.createElement('button');
      btn.textContent = '1';
      btn.dataset.page = '1';
      pages.appendChild(btn);
      if (page > 4) pages.appendChild(ellipsis());
    }

    // Pages around current
    for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i += 1) {
      const btn = document.createElement('button');
      btn.textContent = i;
      btn.dataset.page = i;
      if (i === page) btn.setAttribute('aria-current', 'page');
      pages.appendChild(btn);
    }

    // Last page
    if (page < totalPages - 2) {
      if (page < totalPages - 3) pages.appendChild(ellipsis());
      const btn = document.createElement('button');
      btn.textContent = totalPages;
      btn.dataset.page = totalPages;
      pages.appendChild(btn);
    }

    paginationElement.appendChild(pages);

    const nextBtn = document.createElement('button');
    nextBtn.textContent = 'Next';
    nextBtn.disabled = page >= totalPages;
    if (page < totalPages) nextBtn.dataset.page = page + 1;
    paginationElement.appendChild(nextBtn);

    // Add event listeners
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

  // Creates a filter configuration object from search input
  const createFilterConfig = (resetPage = false) => {
    const filterConfig = { ...config };

    filterConfig.fulltext = document.getElementById('fulltext').value;

    if (resetPage) {
      currentPage = 1;
      filterConfig.page = 1;
    } else {
      filterConfig.page = currentPage;
    }

    return filterConfig;
  };

  // Main search function that filters, sorts, and displays articles
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

    let results = await lookupArticles(filterConfig);

    // Check for sort in filterConfig first, then fall back to UI element
    let sortBy = filterConfig.sort || 'newest';
    if (!filterConfig.sort && sortLabel) {
      sortBy = sortLabel.dataset.sort;
    }
    results.sort(sorts[sortBy] || sorts.newest);

    // Get page number from filterConfig or default to 1
    const page = parseInt(filterConfig.page, 10) || 1;
    currentPage = page;

    // Update results count and pagination info
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

  const fulltextElement = container.querySelector('#fulltext');
  fulltextElement.addEventListener('input', () => {
    runSearch(createFilterConfig(true));
  });

  // Search button click (form submit)
  const form = container.querySelector('form.controls');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      runSearch(createFilterConfig(true));
    });
  }

  // Also trigger search on Enter key
  fulltextElement.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      runSearch(createFilterConfig(true));
    }
  });

  // Read initial config from URL params
  const urlConfig = getConfigFromURL();
  const initialConfig = { ...config, ...urlConfig };

  // Set initial page from URL
  if (urlConfig.page) {
    currentPage = parseInt(urlConfig.page, 10);
  }

  // Apply URL params to UI elements
  if (urlConfig.fulltext) {
    fulltextElement.value = urlConfig.fulltext;
  }

  if (urlConfig.sort) {
    if (sortLabel) {
      sortLabel.dataset.sort = urlConfig.sort;
      const sortBtn = sortMenu.querySelector(`button[data-sort="${urlConfig.sort}"]`);
      if (sortBtn) {
        sortLabel.textContent = sortBtn.textContent;
        sortMenu.querySelectorAll('button').forEach((b) => b.removeAttribute('aria-pressed'));
        sortBtn.setAttribute('aria-pressed', 'true');
      }
    }
  }

  runSearch(initialConfig);

  // Handle browser back/forward buttons
  window.addEventListener('popstate', (event) => {
    if (event.state && event.state.filterConfig) {
      const savedConfig = event.state.filterConfig;

      // Update search input
      if (savedConfig.fulltext) {
        fulltextElement.value = savedConfig.fulltext;
      } else {
        fulltextElement.value = '';
      }

      // Update sort
      if (savedConfig.sort) {
        if (sortLabel) {
          sortLabel.dataset.sort = savedConfig.sort;
          const sortBtn = sortMenu.querySelector(`button[data-sort="${savedConfig.sort}"]`);
          if (sortBtn) {
            sortLabel.textContent = sortBtn.textContent;
          }
        }
      }

      // Restore page number
      if (savedConfig.page) {
        currentPage = parseInt(savedConfig.page, 10);
      } else {
        currentPage = 1;
      }

      runSearch(savedConfig, false);
    }
  });
}

// Initialize the article center
function init() {
  const articleCenter = document.querySelector('.article-center');
  if (articleCenter) {
    buildArticleFiltering(articleCenter);
  }
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  loadCSS('/widgets/article-center/article-center.css');
  init();
}

export default { lookupArticles };
