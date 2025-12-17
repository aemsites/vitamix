/* eslint-disable max-len */

import { loadCSS } from '../../scripts/aem.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';

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
  const { locale, language } = getLocaleAndLanguage();
  if (!window.recipeIndex) {
    // fetch the main recipe index
    const resp = await fetch(`/${locale}/${language}/recipes/data/query-index.json`);
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
  const li = document.createElement('li');
  li.className = 'card';

  const link = document.createElement('a');
  link.href = recipe.path || '#';

  // Check if image is the default-meta-image and use placeholder instead
  const imagePath = new URL(recipe.image).pathname || '';
  const isDefaultImage = imagePath.includes('default-meta-image');

  let image;
  if (isDefaultImage) {
    image = document.createElement('div');
    image.className = 'img placeholder';
  } else {
    image = document.createElement('img');
    image.src = imagePath;
    image.alt = '';
    image.loading = 'lazy';
  }

  const title = document.createElement('h3');
  title.textContent = recipe.title || '';

  // Star rating
  const rating = document.createElement('div');
  rating.className = 'rating';
  rating.setAttribute('aria-label', '0 of 5 stars');
  for (let i = 0; i < 5; i += 1) {
    const star = document.createElement('span');
    star.textContent = '☆';
    rating.appendChild(star);
  }

  const meta = document.createElement('p');
  meta.className = 'meta';

  const metaParts = [];
  if (recipe['total-time']) metaParts.push(formatTime(recipe['total-time']));
  if (recipe.difficulty) metaParts.push(recipe.difficulty);
  if (recipe.yieldRange || recipe.yield) metaParts.push(recipe.yieldRange || formatYield(recipe.yield));

  meta.textContent = metaParts.join(' • ');

  link.append(image, title, rating, meta);
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
    difficulty: 'Difficulty',
    'compatible-containers': 'Compatible Containers',
    'dietary-interests': 'Dietary Interests',
    course: 'Course',
    'recipe-type': 'Recipe Type',
  };

  // Reference existing DOM elements from static HTML
  const resultsElement = container.querySelector('.results');
  const facetsElement = container.querySelector('.facets');

  // Set up facet panel event listeners
  const applyButton = facetsElement.querySelector('.apply');
  if (applyButton) {
    applyButton.addEventListener('click', () => {
      facetsElement.classList.remove('visible');
    });
  }

  facetsElement.addEventListener('click', (event) => {
    if (event.currentTarget === event.target) {
      facetsElement.classList.remove('visible');
    }
  });

  // Get dropdown elements
  const dietarySelect = container.querySelector('#dietary-interests');
  const courseSelect = container.querySelector('#course');
  const recipeTypeSelect = container.querySelector('#recipe-type');
  const goButton = container.querySelector('.go');

  // Sort dropdown uses native <details> element
  const sortDetails = container.querySelector('.sort');
  const sortMenu = container.querySelector('.sort menu');
  const sortLabel = container.querySelector('#sortby');

  const selectSort = (btn) => {
    sortMenu.querySelectorAll('button').forEach((b) => b.removeAttribute('aria-pressed'));
    btn.setAttribute('aria-pressed', true);
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

    // Clear dynamic content areas
    const selectedFilters = container.querySelector('.selected');
    const facetsList = container.querySelector('.list');

    selectedFilters.innerHTML = '';
    facetsList.innerHTML = '';

    selected.forEach((tag) => {
      const span = document.createElement('span');
      span.className = 'tag';
      span.textContent = tag;
      span.addEventListener('click', () => {
        document.getElementById(`filter-${tag}`).checked = false;
        const filterConfig = createFilterConfig(true);
        // eslint-disable-next-line no-use-before-define
        runSearch(filterConfig);
      });
      selectedFilters.append(span);
    });

    if (selected.length > 0) {
      const clearButton = document.createElement('button');
      clearButton.className = 'clear';
      clearButton.textContent = 'Clear All';
      clearButton.addEventListener('click', () => {
        selected.forEach((tag) => {
          document.getElementById(`filter-${tag}`).checked = false;
        });
        const filterConfig = createFilterConfig(true);
        // eslint-disable-next-line no-use-before-define
        runSearch(filterConfig);
      });
      selectedFilters.appendChild(clearButton);
    }

    // build facet filter lists with accordion (excluding the top dropdown facets)
    const excludedFacets = ['dietary-interests', 'course', 'recipe-type'];
    const facetKeys = Object.keys(facets).filter((key) => !excludedFacets.includes(key));
    facetKeys.forEach((facetKey, index) => {
      const filter = filters[facetKey];
      const filterValues = filter ? filter.split(',').map((t) => t.trim()) : [];

      const details = document.createElement('details');
      details.className = 'facet';
      // First facet is expanded by default
      if (index === 0 || filterValues.length > 0) {
        details.open = true;
      }

      const summary = document.createElement('summary');
      summary.textContent = placeholders[facetKey] || facetKey;
      details.append(summary);

      const facetValues = Object.keys(facets[facetKey]).sort((a, b) => a.localeCompare(b));
      facetValues.forEach((facetValue) => {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = facetValue;
        input.checked = filterValues.includes(facetValue);
        input.id = `filter-${facetValue}`;
        input.name = facetKey;
        const label = document.createElement('label');
        label.setAttribute('for', input.id);
        label.textContent = `${facetValue} (${facets[facetKey][facetValue]})`;
        details.append(input, label);
        input.addEventListener('change', () => {
          const filterConfig = createFilterConfig(true);
          // eslint-disable-next-line no-use-before-define
          runSearch(filterConfig);
        });
      });
      facetsList.append(details);
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
    if (!filterConfig.sort && sortLabel) {
      sortBy = sortLabel.dataset.sort;
    }
    results.sort(sorts[sortBy]);

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
