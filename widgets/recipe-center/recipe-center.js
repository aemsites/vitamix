/* eslint-disable max-len */

import { loadCSS } from '../../scripts/aem.js';

/**
 * Parses raw recipe data from index and transforms values.
 * @param {Object} data - Raw recipe data object from the recipe index
 * @returns {Object} Parsed recipe object with transformed values
 */
function parseRecipeData(data) {
  const parsed = {};
  Object.entries(data).forEach(([key, value]) => {
    switch (key) {
      case 'compatible-containers':
      case 'dietary-interests':
      case 'course':
      case 'recipe-type':
        // split comma-separated values into trimmed arrays
        parsed[key] = value ? value.split(',').map((s) => s.trim()) : [];
        break;
      default:
        parsed[key] = typeof value === 'string' ? value.trim() : value;
        break;
    }
  });
  return parsed;
}

/**
 * Fetches and filters recipes from the recipe index.
 * @param {Object} config - Object with filter criteria
 * @param {Object} facets - Optional object to populate with facet counts for UI filters.
 * @returns {Promise<Array<Object>>} Array of filtered recipe objects
 */
async function lookupRecipes(config = {}, facets = {}) {
  if (!window.recipeIndex) {
    // fetch the main recipe index
    const resp = await fetch('/us/en_us/recipes/data/query-index.json');
    const { data } = await resp.json();

    // parse and filter recipes - only include Updated or New status, exclude Deleted
    const recipes = data
      .map((d) => parseRecipeData(d))
      .filter((recipe) => {
        const status = recipe.status ? recipe.status.toLowerCase() : '';
        return status === 'updated' || status === 'new';
      });

    window.recipeIndex = {
      data: recipes,
    };
  }

  // extract all facet keys from the facets object for dynamic filter UI
  const facetKeys = Object.keys(facets);

  // extract all filter criteria keys from the config object
  // exclude fulltext if it's empty or just whitespace, and exclude 'page' and 'sort'
  const filterKeys = Object.keys(config).filter((key) => {
    // Exclude pagination and sorting keys from filtering
    if (key === 'page' || key === 'sort') {
      return false;
    }
    if (key === 'fulltext') {
      return config[key] && config[key].trim().length > 0;
    }
    return config[key]; // exclude any other empty values
  });

  // Track which recipe titles have been counted for each facet value to avoid duplicates
  const facetTitleTracking = {};
  facetKeys.forEach((facetKey) => {
    facetTitleTracking[facetKey] = {};
  });

  // parse comma-separated filter values into trimmed token arrays for matching
  const tokens = {};
  filterKeys.forEach((key) => {
    if (config[key]) {
      if (key === 'fulltext') {
        // fulltext is a single search term, not comma-separated
        tokens[key] = config[key].trim();
      } else {
        tokens[key] = config[key].split(',').map((t) => t.trim());
      }
    }
  });

  // filter recipes based on all configured criteria (must match ALL filters)
  const results = window.recipeIndex.data.filter((recipe) => {
    // Exclude recipes without a difficulty rating
    if (!recipe.difficulty || recipe.difficulty.trim() === '') {
      return false;
    }

    // track which individual filters matched for this recipe
    const filterMatches = {};

    // check if this recipe matches ALL the filter criteria
    // IMPORTANT: Use forEach instead of every() to avoid short-circuiting
    // We need to evaluate ALL filters and store them in filterMatches for facet counting
    filterKeys.forEach((filterKey) => {
      let matched = false;

      // special case: full-text search on recipe title
      if (filterKey === 'fulltext') {
        // Only apply fulltext filter if it has actual content
        if (config.fulltext && config.fulltext.trim().length > 0) {
          const titleLower = recipe.title.toLowerCase();
          const searchTerm = config.fulltext.toLowerCase().trim();
          matched = titleLower.includes(searchTerm);
        } else {
          // Empty fulltext matches everything
          matched = true;
        }
      } else if (recipe[filterKey]) {
        // array-based filter matching (dietary-interests, compatible-containers, etc.)
        if (Array.isArray(recipe[filterKey])) {
          // recipe matches if ANY of its values match ANY of the filter tokens
          matched = tokens[filterKey].some((t) => recipe[filterKey].includes(t));
        } else {
          // for non-array fields, check if the value matches any token
          matched = tokens[filterKey].some((t) => recipe[filterKey] === t);
        }
      }

      // ALWAYS store whether this filter matched (for facet counting)
      filterMatches[filterKey] = matched;
    });

    // Now check if ALL filters matched
    const matchedAll = filterKeys.every((filterKey) => filterMatches[filterKey] || !config[filterKey]);

    // NOW calculate facet counts AFTER all filterMatches have been collected
    // This ensures we have the complete picture of which filters matched
    facetKeys.forEach((facetKey) => {
      // intelligent facet counting: include recipes that match ALL OTHER filters
      let includeInFacet = true;
      Object.keys(filterMatches).forEach((filterKey) => {
        // exclude this recipe from facet count if any OTHER filter didn't match
        if (filterKey !== facetKey && !filterMatches[filterKey]) includeInFacet = false;
      });

      // if this recipe qualifies for inclusion in the facet counts
      if (includeInFacet) {
        // check if the recipe has any values for this facet field
        if (recipe[facetKey]) {
          const values = Array.isArray(recipe[facetKey]) ? recipe[facetKey] : [recipe[facetKey]];
          values.forEach((val) => {
            if (val) {
              // Track by recipe title to avoid counting duplicate recipes with same name
              if (!facetTitleTracking[facetKey][val]) {
                facetTitleTracking[facetKey][val] = new Set();
              }

              // Only count this recipe if we haven't seen this title for this facet value yet
              if (!facetTitleTracking[facetKey][val].has(recipe.title)) {
                facetTitleTracking[facetKey][val].add(recipe.title);

                if (facets[facetKey][val]) {
                  // increment existing count
                  facets[facetKey][val] += 1;
                } else {
                  // initialize count for a new facet value
                  facets[facetKey][val] = 1;
                }
              }
            }
          });
        }
      }
    });

    return matchedAll;
  });

  return results;
}

/**
 * Formats time string from HH:MM:SS to readable format.
 * @param {string} timeString - Time in HH:MM:SS format
 * @returns {string} Formatted time string
 */
function formatTime(timeString) {
  if (!timeString) return '';

  // Parse HH:MM:SS format
  const parts = timeString.split(':');
  if (parts.length !== 3) return timeString;

  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseInt(parts[2], 10);

  // Round seconds up to next minute if > 0
  let totalMinutes = hours * 60 + minutes;
  if (seconds > 0) {
    totalMinutes += 1;
  }

  // Convert back to hours and minutes
  const finalHours = Math.floor(totalMinutes / 60);
  const finalMinutes = totalMinutes % 60;

  // Build readable string
  const parts2 = [];
  if (finalHours > 0) {
    parts2.push(`${finalHours}h`);
  }
  if (finalMinutes > 0) {
    parts2.push(`${finalMinutes}m`);
  }

  return parts2.length > 0 ? parts2.join(' ') : '0m';
}

/**
 * Formats servings/yield string to be human-readable without decimals.
 * @param {string} yieldString - Yield string like "8.00 servings" or "2.5 cups"
 * @returns {string} Formatted yield string
 */
function formatYield(yieldString) {
  if (!yieldString) return '';

  // Extract number from string like "8.00 servings"
  const match = yieldString.match(/^([\d.]+)\s*(.*)$/);
  if (!match) return yieldString;

  const number = parseFloat(match[1]);
  const unit = match[2];

  // Round to nearest whole number
  const roundedNumber = Math.round(number);

  return unit ? `${roundedNumber} ${unit}` : `${roundedNumber}`;
}

/**
 * Extracts the numeric value from a yield string.
 * @param {string} yieldString - Yield string like "8.00 servings"
 * @returns {number} Numeric yield value
 */
function parseYieldNumber(yieldString) {
  if (!yieldString) return 0;
  const match = yieldString.match(/^([\d.]+)/);
  return match ? parseFloat(match[1]) : 0;
}

/**
 * Collapses recipes with the same title, aggregating yields and compatible-containers.
 * @param {Array<Object>} recipes - Array of recipe objects
 * @returns {Array<Object>} Array of collapsed recipe objects
 */
function collapseRecipesByTitle(recipes) {
  const recipesByTitle = {};

  recipes.forEach((recipe) => {
    const { title } = recipe;
    if (!title) return;

    if (!recipesByTitle[title]) {
      // First occurrence - create the base recipe
      recipesByTitle[title] = {
        ...recipe,
        yields: [recipe.yield],
        allContainers: recipe['compatible-containers'] ? [...recipe['compatible-containers']] : [],
      };
    } else {
      // Duplicate - aggregate data
      const existing = recipesByTitle[title];

      // Add yield to the list
      if (recipe.yield) {
        existing.yields.push(recipe.yield);
      }

      // Add compatible containers
      if (recipe['compatible-containers']) {
        recipe['compatible-containers'].forEach((container) => {
          if (!existing.allContainers.includes(container)) {
            existing.allContainers.push(container);
          }
        });
      }
    }
  });

  // Process the collapsed recipes to create yield ranges
  return Object.values(recipesByTitle).map((recipe) => {
    if (recipe.yields && recipe.yields.length > 1) {
      // Find min and max yields
      const yieldNumbers = recipe.yields
        .map(parseYieldNumber)
        .filter((n) => n > 0);

      if (yieldNumbers.length > 0) {
        const minYield = Math.min(...yieldNumbers);
        const maxYield = Math.max(...yieldNumbers);

        // Extract unit from first yield (same pattern as formatYield)
        const match = recipe.yields[0].match(/^([\d.]+)\s*(.*)$/);
        const unit = match ? match[2].trim() : '';

        // Create range string
        recipe.yieldRange = minYield !== maxYield
          ? `${Math.round(minYield)} - ${Math.round(maxYield)} ${unit}`
          : formatYield(recipe.yields[0]);
      }
    } else {
      recipe.yieldRange = recipe.yield ? formatYield(recipe.yield) : '';
    }

    // Update compatible-containers with aggregated list
    recipe['compatible-containers'] = recipe.allContainers;

    return recipe;
  });
}

/**
 * Creates a recipe card DOM element for display in the recipe listing.
 * @param {Object} recipe - Recipe data object with title, image, time, etc.
 * @returns {HTMLElement} Recipe card element
 */
function createRecipeCard(recipe) {
  const card = document.createElement('div');
  card.className = 'recipe-center-card';

  const link = document.createElement('a');
  link.href = recipe.path || '#';
  link.className = 'recipe-center-card-link';

  // Check if image is the default-meta-image and use placeholder instead
  const imagePath = new URL(recipe.image).pathname || '';
  const isDefaultImage = imagePath.includes('default-meta-image');

  let image;
  if (isDefaultImage) {
    image = document.createElement('div');
    image.className = 'recipe-center-card-image recipe-center-card-image-placeholder';
  } else {
    image = document.createElement('img');
    image.src = imagePath;
    image.alt = recipe.title || '';
    image.loading = 'lazy';
    image.className = 'recipe-center-card-image';
  }

  const content = document.createElement('div');
  content.className = 'recipe-center-card-content';

  const title = document.createElement('h3');
  title.className = 'recipe-center-card-title';
  title.textContent = recipe.title || '';

  // Add star rating
  const rating = document.createElement('div');
  rating.className = 'recipe-center-card-rating';
  for (let i = 0; i < 5; i += 1) {
    const star = document.createElement('span');
    star.className = 'recipe-center-card-rating-star';
    star.textContent = '☆';
    rating.appendChild(star);
  }

  const meta = document.createElement('div');
  meta.className = 'recipe-center-card-meta';

  const metaParts = [];

  if (recipe['total-time']) {
    metaParts.push(formatTime(recipe['total-time']));
  }

  if (recipe.difficulty) {
    metaParts.push(recipe.difficulty);
  }

  if (recipe.yieldRange || recipe.yield) {
    metaParts.push(recipe.yieldRange || formatYield(recipe.yield));
  }

  // Join meta parts with separators
  metaParts.forEach((part, index) => {
    if (index > 0) {
      const separator = document.createElement('span');
      separator.className = 'recipe-center-card-meta-separator';
      separator.textContent = '•';
      meta.appendChild(separator);
    }
    const span = document.createElement('span');
    span.textContent = part;
    meta.appendChild(span);
  });

  content.append(title, rating, meta);
  link.append(image, content);
  card.appendChild(link);

  return card;
}

/**
 * Reads query parameters from URL and returns as config object.
 * @returns {Object} Configuration object from URL params
 */
function getConfigFromURL() {
  const params = new URLSearchParams(window.location.search);
  const config = {};

  // Read all URL parameters into config
  params.forEach((value, key) => {
    config[key] = value;
  });

  return config;
}

/**
 * Updates URL query parameters to reflect current filter state.
 * @param {Object} filterConfig - Current filter configuration
 * @returns {void}
 */
function updateURL(filterConfig) {
  const params = new URLSearchParams();

  // Add all non-empty config values to URL params
  Object.keys(filterConfig).forEach((key) => {
    // Skip page if it's 1 (default)
    if (key === 'page' && filterConfig[key] === 1) {
      return;
    }

    if (filterConfig[key] && filterConfig[key].trim && filterConfig[key].trim()) {
      params.set(key, filterConfig[key]);
    } else if (filterConfig[key] && !filterConfig[key].trim) {
      // Handle non-string values (but still skip page=1)
      if (key !== 'page' || filterConfig[key] !== 1) {
        params.set(key, filterConfig[key]);
      }
    }
  });

  // Update URL without reloading page
  const newURL = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname;
  window.history.pushState({ filterConfig }, '', newURL);
}

/**
 * Builds complete recipe listing with filtering, sorting, and search functionality.
 * @param {HTMLElement} container - Container element to transform into a recipe listing
 * @param {Object} config - Initial filter configuration
 * @returns {void}
 */
function buildRecipeFiltering(container, config = {}) {
  const ITEMS_PER_PAGE = 12;
  let currentPage = 1;

  const placeholders = {
    typeToSearch: 'Type to search recipes',
    results: 'Results',
    filter: 'Filter',
    sort: 'Sort',
    sortBy: 'Sort By',
    featured: 'Featured',
    nameAsc: 'Name (A-Z)',
    nameDesc: 'Name (Z-A)',
    timeAsc: 'Time (Low to High)',
    timeDesc: 'Time (High to Low)',
    filters: 'Filters',
    clearAll: 'Clear All',
    difficulty: 'Difficulty',
    'compatible-containers': 'Compatible Containers',
    'dietary-interests': 'Dietary Interests',
    course: 'Course',
    'recipe-type': 'Recipe Type',
  };

  container.innerHTML = `<div class="recipe-center-controls">
      <div class="recipe-center-controls-top">
        <span class="recipe-center-refine-label">Refine Your Search</span>
        <select id="dietary-interests-select" class="recipe-center-dropdown">
          <option value="">Dietary</option>
        </select>
        <select id="course-select" class="recipe-center-dropdown">
          <option value="">Course</option>
        </select>
        <select id="recipe-type-select" class="recipe-center-dropdown">
          <option value="">Recipe Type</option>
        </select>
        <button id="recipe-center-go-button" class="recipe-center-go-button">GO</button>
      </div>
      <div class="recipe-center-controls-bottom">
        <input id="fulltext" placeholder="${placeholders.typeToSearch}">
        <button class="recipe-center-search-button">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="recipe-center-results-info">
      <div class="recipe-center-results-info-left">
        Items <span id="recipe-center-results-start">1</span> - <span id="recipe-center-results-end">12</span> of <span id="recipe-center-results-count">0</span>
      </div>
      <div class="recipe-center-sortby">
        <p>Sort By: <span data-sort="featured" id="recipe-center-sortby">${placeholders.featured}</span></p>
        <ul>
          <li data-sort="featured">${placeholders.featured}</li>
          <li data-sort="name-asc">${placeholders.nameAsc}</li>
          <li data-sort="name-desc">${placeholders.nameDesc}</li>
          <li data-sort="time-asc">${placeholders.timeAsc}</li>
          <li data-sort="time-desc">${placeholders.timeDesc}</li>
        </ul>
      </div>
    </div>
    <div class="recipe-center-facets"></div>
    <div class="recipe-center-results"></div>
    <div class="recipe-center-pagination"></div>`;

  const resultsElement = container.querySelector('.recipe-center-results');
  const facetsElement = container.querySelector('.recipe-center-facets');

  // Get dropdown elements
  const dietarySelect = container.querySelector('#dietary-interests-select');
  const courseSelect = container.querySelector('#course-select');
  const recipeTypeSelect = container.querySelector('#recipe-type-select');
  const goButton = container.querySelector('#recipe-center-go-button');

  // utility function to add the same event listener to multiple elements
  const addEventListeners = (elements, event, callback) => {
    elements.forEach((e) => {
      e.addEventListener(event, callback);
    });
  };

  addEventListeners([
    container.querySelector('.recipe-center-sortby p'),
  ], 'click', () => {
    container.querySelector('.recipe-center-sortby ul').classList.toggle('visible');
  });

  const sortList = container.querySelector('.recipe-center-sortby ul');
  const selectSort = (selected) => {
    [...sortList.children].forEach((li) => li.classList.remove('selected'));
    selected.classList.add('selected');
    const sortBy = document.getElementById('recipe-center-sortby');
    sortBy.textContent = selected.textContent;
    sortBy.dataset.sort = selected.dataset.sort;
    container.querySelector('.recipe-center-sortby ul').classList.remove('visible');
    // eslint-disable-next-line no-use-before-define
    const filterConfig = createFilterConfig();
    filterConfig.sort = selected.dataset.sort;
    // eslint-disable-next-line no-use-before-define
    runSearch(filterConfig);
  };

  sortList.addEventListener('click', (event) => {
    selectSort(event.target);
  });

  // highlights search terms in recipe titles by wrapping matches in a span.
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

  // renders recipe cards to the results area and highlights search terms
  const displayResults = async (results, page = 1) => {
    resultsElement.innerHTML = '';

    // Calculate pagination
    const startIndex = (page - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const paginatedResults = results.slice(startIndex, endIndex);

    paginatedResults.forEach((recipe) => {
      resultsElement.append(createRecipeCard(recipe));
    });
    highlightResults(resultsElement);

    // Scroll to top of results
    if (page > 1) {
      container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // renders pagination controls
  const displayPagination = (totalResults, page = 1) => {
    const paginationElement = container.querySelector('.recipe-center-pagination');
    if (!paginationElement) return;

    const totalPages = Math.ceil(totalResults / ITEMS_PER_PAGE);

    if (totalPages <= 1) {
      paginationElement.innerHTML = '';
      return;
    }

    let paginationHTML = '<div class="recipe-center-pagination-controls">';

    // Previous button
    if (page > 1) {
      paginationHTML += `<button class="recipe-center-pagination-btn recipe-center-pagination-prev" data-page="${page - 1}">Previous</button>`;
    } else {
      paginationHTML += '<button class="recipe-center-pagination-btn recipe-center-pagination-prev" disabled>Previous</button>';
    }

    // Page numbers
    paginationHTML += '<div class="recipe-center-pagination-numbers">';

    // Always show first page
    if (page > 3) {
      paginationHTML += '<button class="recipe-center-pagination-btn recipe-center-pagination-page" data-page="1">1</button>';
      if (page > 4) {
        paginationHTML += '<span class="recipe-center-pagination-ellipsis">...</span>';
      }
    }

    // Show pages around current page
    for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i += 1) {
      if (i === page) {
        paginationHTML += `<button class="recipe-center-pagination-btn recipe-center-pagination-page active" data-page="${i}">${i}</button>`;
      } else {
        paginationHTML += `<button class="recipe-center-pagination-btn recipe-center-pagination-page" data-page="${i}">${i}</button>`;
      }
    }

    // Always show last page
    if (page < totalPages - 2) {
      if (page < totalPages - 3) {
        paginationHTML += '<span class="recipe-center-pagination-ellipsis">...</span>';
      }
      paginationHTML += `<button class="recipe-center-pagination-btn recipe-center-pagination-page" data-page="${totalPages}">${totalPages}</button>`;
    }

    paginationHTML += '</div>';

    // Next button
    if (page < totalPages) {
      paginationHTML += `<button class="recipe-center-pagination-btn recipe-center-pagination-next" data-page="${page + 1}">Next</button>`;
    } else {
      paginationHTML += '<button class="recipe-center-pagination-btn recipe-center-pagination-next" disabled>Next</button>';
    }

    paginationHTML += '</div>';
    paginationElement.innerHTML = paginationHTML;

    // Add event listeners to pagination buttons
    paginationElement.querySelectorAll('.recipe-center-pagination-btn[data-page]').forEach((btn) => {
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

  // gets all currently selected filter checkboxes
  const getSelectedFilters = () => [...container.querySelectorAll('input[type="checkbox"]:checked')];

  // creates a filter configuration object from selected filters and search input
  const createFilterConfig = (resetPage = false) => {
    const filterConfig = { ...config };

    // Add dropdown selections
    if (dietarySelect.value) {
      filterConfig['dietary-interests'] = dietarySelect.value;
    }
    if (courseSelect.value) {
      filterConfig.course = courseSelect.value;
    }
    if (recipeTypeSelect.value) {
      filterConfig['recipe-type'] = recipeTypeSelect.value;
    }

    // Add sidebar checkbox filters
    getSelectedFilters().forEach((checked) => {
      const facetKey = checked.name;
      const facetValue = checked.value;
      if (filterConfig[facetKey]) filterConfig[facetKey] += `, ${facetValue}`;
      else filterConfig[facetKey] = facetValue;
    });

    filterConfig.fulltext = document.getElementById('fulltext').value;

    // Reset to page 1 when filters change, unless explicitly maintaining page
    if (resetPage) {
      currentPage = 1;
      filterConfig.page = 1;
    } else {
      filterConfig.page = currentPage;
    }

    return filterConfig;
  };

  // renders the filter facets UI with checkboxes, selected filter tags, and counts
  const displayFacets = (facets, filters) => {
    const selected = getSelectedFilters().map((check) => check.value);
    facetsElement.innerHTML = `<div>
        <div class="recipe-center-filters">
          <h2>Refine Your Recipe</h2>
          <div class="recipe-center-filters-selected"></div>
          <div class="recipe-center-filters-clear-wrapper"></div>
          <div class="recipe-center-filters-facetlist"></div>
        </div>
        <div class="recipe-center-apply-filters">
          <button>See Results</button>
        </div>
      </div>`;

    // Mobile "See Results" button
    const applyButton = facetsElement.querySelector('.recipe-center-apply-filters button');
    if (applyButton) {
      applyButton.addEventListener('click', () => {
        container.querySelector('.recipe-center-facets').classList.remove('visible');
      });
    }

    // Mobile overlay close
    const facetOverlay = facetsElement.querySelector(':scope > div');
    if (facetOverlay) {
      facetOverlay.addEventListener('click', (event) => {
        if (event.currentTarget === event.target) {
          container.querySelector('.recipe-center-facets').classList.remove('visible');
        }
      });
    }

    facetsElement.addEventListener('click', (event) => {
      if (event.currentTarget === event.target) {
        container.querySelector('.recipe-center-facets').classList.remove('visible');
      }
    });

    const selectedFilters = container.querySelector('.recipe-center-filters-selected');
    selected.forEach((tag) => {
      const span = document.createElement('span');
      span.className = 'recipe-center-filters-tag';
      span.textContent = tag;
      span.addEventListener('click', () => {
        document.getElementById(`recipe-center-filter-${tag}`).checked = false;
        const filterConfig = createFilterConfig(true);
        // eslint-disable-next-line no-use-before-define
        runSearch(filterConfig);
      });
      selectedFilters.append(span);
    });

    const clearWrapper = container.querySelector('.recipe-center-filters-clear-wrapper');
    if (selected.length > 0) {
      const clearButton = document.createElement('button');
      clearButton.className = 'recipe-center-filters-clear';
      clearButton.textContent = 'Clear All';
      clearButton.addEventListener('click', () => {
        selected.forEach((tag) => {
          document.getElementById(`recipe-center-filter-${tag}`).checked = false;
        });
        const filterConfig = createFilterConfig(true);
        // eslint-disable-next-line no-use-before-define
        runSearch(filterConfig);
      });
      clearWrapper.appendChild(clearButton);
    }

    // build facet filter lists with accordion (excluding the top dropdown facets)
    const facetsList = container.querySelector('.recipe-center-filters-facetlist');
    const excludedFacets = ['dietary-interests', 'course', 'recipe-type'];
    const facetKeys = Object.keys(facets).filter((key) => !excludedFacets.includes(key));
    facetKeys.forEach((facetKey, index) => {
      const filter = filters[facetKey];
      const filterValues = filter ? filter.split(',').map((t) => t.trim()) : [];
      const div = document.createElement('div');
      div.className = 'recipe-center-facet';
      // First facet (dietary-interests) is expanded by default
      if (index === 0 || filterValues.length > 0) {
        div.classList.add('expanded');
      }

      const h3 = document.createElement('h3');
      h3.textContent = placeholders[facetKey] || facetKey;
      h3.addEventListener('click', () => {
        div.classList.toggle('expanded');
      });
      div.append(h3);

      const content = document.createElement('div');
      content.className = 'recipe-center-facet-content';

      const facetValues = Object.keys(facets[facetKey]).sort((a, b) => a.localeCompare(b));
      facetValues.forEach((facetValue) => {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = facetValue;
        input.checked = filterValues.includes(facetValue);
        input.id = `recipe-center-filter-${facetValue}`;
        input.name = facetKey;
        const label = document.createElement('label');
        label.setAttribute('for', input.id);
        label.textContent = `${facetValue} (${facets[facetKey][facetValue]})`;
        content.append(input, label);
        input.addEventListener('change', () => {
          const filterConfig = createFilterConfig(true);
          // eslint-disable-next-line no-use-before-define
          runSearch(filterConfig);
        });
      });
      div.append(content);
      facetsList.append(div);
    });
  };

  // converts a time string to minutes for sorting
  const getTimeInMinutes = (timeString) => {
    if (!timeString) return 0;
    const parts = timeString.split(':');
    if (parts.length !== 3) return 0;
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    return hours * 60 + minutes;
  };

  // Populate dropdown options with counts
  const populateDropdown = (select, facetData, facetKey, filterConfig) => {
    const currentValue = select.value;
    const filterValues = filterConfig[facetKey] ? filterConfig[facetKey].split(',').map((t) => t.trim()) : [];

    // Keep the first option (placeholder)
    const firstOption = select.options[0];
    select.innerHTML = '';
    select.appendChild(firstOption);

    // Add options sorted alphabetically
    const sortedValues = Object.keys(facetData).sort((a, b) => a.localeCompare(b));
    sortedValues.forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = `${value} (${facetData[value]})`;
      if (filterValues.includes(value)) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    // Restore previous selection if it still exists
    if (currentValue && sortedValues.includes(currentValue)) {
      select.value = currentValue;
    }
  };

  // main search function that filters, sorts, and displays recipes
  const runSearch = async (filterConfig = config, updateURLState = true) => {
    const facets = {
      difficulty: {},
      'compatible-containers': {},
      'dietary-interests': {},
      course: {},
      'recipe-type': {},
    };

    const sorts = {
      'name-asc': (a, b) => a.title.localeCompare(b.title),
      'name-desc': (a, b) => b.title.localeCompare(a.title),
      'time-asc': (a, b) => getTimeInMinutes(a['total-time']) - getTimeInMinutes(b['total-time']),
      'time-desc': (a, b) => getTimeInMinutes(b['total-time']) - getTimeInMinutes(a['total-time']),
      featured: (a, b) => {
        // Check if recipes have default images
        const aImagePath = new URL(a.image).pathname || '';
        const bImagePath = new URL(b.image).pathname || '';
        const aIsDefault = aImagePath.includes('default-meta-image');
        const bIsDefault = bImagePath.includes('default-meta-image');

        // If both have or don't have default images, sort alphabetically
        if (aIsDefault === bIsDefault) {
          return a.title.localeCompare(b.title);
        }

        // Push recipes with default images to the end
        return aIsDefault ? 1 : -1;
      },
    };

    let results = await lookupRecipes(filterConfig, facets);

    // Collapse recipes with the same title
    results = collapseRecipesByTitle(results);

    // Check for sort in filterConfig first, then fall back to UI element
    let sortBy = filterConfig.sort || 'featured';
    if (!filterConfig.sort && document.getElementById('recipe-center-sortby')) {
      sortBy = document.getElementById('recipe-center-sortby').dataset.sort;
    }
    results.sort(sorts[sortBy]);

    // Get page number from filterConfig or default to 1
    const page = parseInt(filterConfig.page, 10) || 1;
    currentPage = page;

    // Update results count and pagination info
    const totalResults = results.length;
    const startNum = totalResults > 0 ? ((page - 1) * ITEMS_PER_PAGE) + 1 : 0;
    const endNum = Math.min(page * ITEMS_PER_PAGE, totalResults);

    container.querySelector('#recipe-center-results-count').textContent = totalResults;
    container.querySelector('#recipe-center-results-start').textContent = startNum;
    container.querySelector('#recipe-center-results-end').textContent = endNum;

    // Populate top dropdowns
    populateDropdown(dietarySelect, facets['dietary-interests'], 'dietary-interests', filterConfig);
    populateDropdown(courseSelect, facets.course, 'course', filterConfig);
    populateDropdown(recipeTypeSelect, facets['recipe-type'], 'recipe-type', filterConfig);

    displayResults(results, page);
    displayPagination(totalResults, page);
    displayFacets(facets, filterConfig);

    // Update URL with current filter state
    if (updateURLState) {
      updateURL(filterConfig);
    }
  };

  const fulltextElement = container.querySelector('#fulltext');
  fulltextElement.addEventListener('input', () => {
    runSearch(createFilterConfig(true)); // Reset to page 1 on search
  });

  // Add event listeners for dropdowns
  goButton.addEventListener('click', () => {
    runSearch(createFilterConfig(true)); // Reset to page 1 on filter change
  });

  dietarySelect.addEventListener('change', () => {
    runSearch(createFilterConfig(true)); // Reset to page 1 on filter change
  });

  courseSelect.addEventListener('change', () => {
    runSearch(createFilterConfig(true)); // Reset to page 1 on filter change
  });

  recipeTypeSelect.addEventListener('change', () => {
    runSearch(createFilterConfig(true)); // Reset to page 1 on filter change
  });

  // Search button click
  const searchButton = container.querySelector('.recipe-center-search-button');
  if (searchButton) {
    searchButton.addEventListener('click', () => {
      runSearch(createFilterConfig(true)); // Reset to page 1 on search
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
    const sortByElement = document.getElementById('recipe-center-sortby');
    if (sortByElement) {
      sortByElement.dataset.sort = urlConfig.sort;
    }
  }

  runSearch(initialConfig);

  // Handle browser back/forward buttons (after runSearch is defined)
  window.addEventListener('popstate', (event) => {
    if (event.state && event.state.filterConfig) {
      // Restore filter state from history
      const savedConfig = event.state.filterConfig;

      // Update dropdowns
      if (savedConfig['dietary-interests']) {
        dietarySelect.value = savedConfig['dietary-interests'];
      } else {
        dietarySelect.selectedIndex = 0;
      }

      if (savedConfig.course) {
        courseSelect.value = savedConfig.course;
      } else {
        courseSelect.selectedIndex = 0;
      }

      if (savedConfig['recipe-type']) {
        recipeTypeSelect.value = savedConfig['recipe-type'];
      } else {
        recipeTypeSelect.selectedIndex = 0;
      }

      // Update search input
      if (savedConfig.fulltext) {
        fulltextElement.value = savedConfig.fulltext;
      } else {
        fulltextElement.value = '';
      }

      // Update sort
      if (savedConfig.sort) {
        const sortByElement = document.getElementById('recipe-center-sortby');
        if (sortByElement) {
          sortByElement.dataset.sort = savedConfig.sort;
          const sortOption = sortList.querySelector(`[data-sort="${savedConfig.sort}"]`);
          if (sortOption) {
            sortByElement.textContent = sortOption.textContent;
          }
        }
      }

      // Restore page number
      if (savedConfig.page) {
        currentPage = parseInt(savedConfig.page, 10);
      } else {
        currentPage = 1;
      }

      // Run search without updating URL (to avoid duplicate history entries)
      runSearch(savedConfig, false);
    }
  });
}

// Initialize the recipe center
function init() {
  const recipeCenter = document.querySelector('.recipe-center');
  if (recipeCenter) {
    buildRecipeFiltering(recipeCenter);
  }
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  loadCSS('/widgets/recipe-center/recipe-center.css');
  init();
}

export default { lookupRecipes };
