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

    // parse and store all recipes
    const recipes = data.map((d) => parseRecipeData(d));

    window.recipeIndex = {
      data: recipes,
    };
  }

  // extract all facet keys from the facets object for dynamic filter UI
  const facetKeys = Object.keys(facets);

  // extract all filter criteria keys from the config object
  const filterKeys = Object.keys(config);

  // parse comma-separated filter values into trimmed token arrays for matching
  const tokens = {};
  filterKeys.forEach((key) => {
    if (config[key]) {
      tokens[key] = config[key].split(',').map((t) => t.trim());
    }
  });

  // filter recipes based on all configured criteria (must match ALL filters)
  const results = window.recipeIndex.data.filter((recipe) => {
    // track which individual filters matched for this recipe
    const filterMatches = {};

    // check if this recipe matches ALL the filter criteria
    const matchedAll = filterKeys.every((filterKey) => {
      let matched = false;

      // array-based filter matching (dietary-interests, compatible-containers, etc.)
      if (recipe[filterKey]) {
        if (Array.isArray(recipe[filterKey])) {
          // recipe matches if ANY of its values match ANY of the filter tokens
          matched = tokens[filterKey].some((t) => recipe[filterKey].includes(t));
        } else {
          // for non-array fields, check if the value matches any token
          matched = tokens[filterKey].some((t) => recipe[filterKey] === t);
        }
      }

      // special case: full-text search on recipe title
      if (filterKey === 'fulltext') {
        const fulltext = recipe.title.toLowerCase();
        matched = fulltext.includes(config.fulltext.toLowerCase());
      }

      // store whether this specific filter matched for facet counting
      filterMatches[filterKey] = matched;

      return matched || !config[filterKey]; // if no filter set for this key, consider it matched
    });

    // calculate facet counts for the filter UI (e.g., "Easy (5)", "Medium (3)")
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
              if (facets[facetKey][val]) {
                // increment existing count
                facets[facetKey][val] += 1;
              } else {
                // initialize count for a new facet value
                facets[facetKey][val] = 1;
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

  const meta = document.createElement('div');
  meta.className = 'recipe-center-card-meta';

  if (recipe['total-time']) {
    const time = document.createElement('span');
    time.className = 'recipe-center-card-time';
    time.textContent = formatTime(recipe['total-time']);
    meta.appendChild(time);
  }

  if (recipe.difficulty) {
    const difficulty = document.createElement('span');
    difficulty.className = 'recipe-center-card-difficulty';
    difficulty.textContent = recipe.difficulty;
    meta.appendChild(difficulty);
  }

  if (recipe.yield) {
    const yieldSpan = document.createElement('span');
    yieldSpan.className = 'recipe-center-card-yield';
    yieldSpan.textContent = formatYield(recipe.yield);
    meta.appendChild(yieldSpan);
  }

  content.append(title, meta);
  link.append(image, content);
  card.appendChild(link);

  return card;
}

/**
 * Builds complete recipe listing with filtering, sorting, and search functionality.
 * @param {HTMLElement} container - Container element to transform into a recipe listing
 * @param {Object} config - Initial filter configuration
 * @returns {void}
 */
function buildRecipeFiltering(container, config = {}) {
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
      <input id="fulltext" placeholder="${placeholders.typeToSearch}">
      <p class="recipe-center-results-count"><span id="recipe-center-results-count"></span> ${placeholders.results}</p>
      <button class="recipe-center-filter-button secondary">${placeholders.filter}</button>
      <button class="recipe-center-sort-button secondary">${placeholders.sort}</button>
    </div>
    <div class="recipe-center-facets"></div>
    <div class="recipe-center-sortby">
      <p>${placeholders.sortBy} <span data-sort="featured" id="recipe-center-sortby">${placeholders.featured}</span></p>
      <ul>
        <li data-sort="featured">${placeholders.featured}</li>
        <li data-sort="name-asc">${placeholders.nameAsc}</li>
        <li data-sort="name-desc">${placeholders.nameDesc}</li>
        <li data-sort="time-asc">${placeholders.timeAsc}</li>
        <li data-sort="time-desc">${placeholders.timeDesc}</li>
      </ul>
    </div>
    <div class="recipe-center-results"></div>`;

  const resultsElement = container.querySelector('.recipe-center-results');
  const facetsElement = container.querySelector('.recipe-center-facets');
  container.querySelector('.recipe-center-filter-button').addEventListener('click', () => {
    container.querySelector('.recipe-center-facets').classList.toggle('visible');
  });

  // utility function to add the same event listener to multiple elements
  const addEventListeners = (elements, event, callback) => {
    elements.forEach((e) => {
      e.addEventListener(event, callback);
    });
  };

  addEventListeners([
    container.querySelector('.recipe-center-sort-button'),
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
    runSearch(createFilterConfig());
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
  const displayResults = async (results) => {
    resultsElement.innerHTML = '';
    results.forEach((recipe) => {
      resultsElement.append(createRecipeCard(recipe));
    });
    highlightResults(resultsElement);
  };

  // gets all currently selected filter checkboxes
  const getSelectedFilters = () => [...container.querySelectorAll('input[type="checkbox"]:checked')];

  // creates a filter configuration object from selected filters and search input
  const createFilterConfig = () => {
    const filterConfig = { ...config };
    getSelectedFilters().forEach((checked) => {
      const facetKey = checked.name;
      const facetValue = checked.value;
      if (filterConfig[facetKey]) filterConfig[facetKey] += `, ${facetValue}`;
      else filterConfig[facetKey] = facetValue;
    });
    filterConfig.fulltext = document.getElementById('fulltext').value;
    return filterConfig;
  };

  // renders the filter facets UI with checkboxes, selected filter tags, and counts
  const displayFacets = (facets, filters) => {
    const selected = getSelectedFilters().map((check) => check.value);
    facetsElement.innerHTML = `<div>
        <div class="recipe-center-filters">
          <h2>${placeholders.filters}</h2>
          <div class="recipe-center-filters-selected"></div>
          <p><button class="recipe-center-filters-clear secondary">${placeholders.clearAll}</button></p>
          <div class="recipe-center-filters-facetlist"></div>
        </div>
        <div class="recipe-center-apply-filters">
          <button>See Results</button>
        </div>
      </div>`;

    addEventListeners([
      facetsElement.querySelector('.recipe-center-apply-filters button'),
      facetsElement.querySelector(':scope > div'),
      facetsElement,
    ], 'click', (event) => {
      if (event.currentTarget === event.target) container.querySelector('.recipe-center-facets').classList.remove('visible');
    });

    const selectedFilters = container.querySelector('.recipe-center-filters-selected');
    selected.forEach((tag) => {
      const span = document.createElement('span');
      span.className = 'recipe-center-filters-tag';
      span.textContent = tag;
      span.addEventListener('click', () => {
        document.getElementById(`recipe-center-filter-${tag}`).checked = false;
        const filterConfig = createFilterConfig();
        // eslint-disable-next-line no-use-before-define
        runSearch(filterConfig);
      });
      selectedFilters.append(span);
    });

    facetsElement.querySelector('.recipe-center-filters-clear').addEventListener('click', () => {
      selected.forEach((tag) => {
        document.getElementById(`recipe-center-filter-${tag}`).checked = false;
      });
      const filterConfig = createFilterConfig();
      // eslint-disable-next-line no-use-before-define
      runSearch(filterConfig);
    });

    // build facet filter lists
    const facetsList = container.querySelector('.recipe-center-filters-facetlist');
    const facetKeys = Object.keys(facets);
    facetKeys.forEach((facetKey) => {
      const filter = filters[facetKey];
      const filterValues = filter ? filter.split(',').map((t) => t.trim()) : [];
      const div = document.createElement('div');
      div.className = 'recipe-center-facet';
      const h3 = document.createElement('h3');
      h3.textContent = placeholders[facetKey] || facetKey;
      div.append(h3);
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
        div.append(input, label);
        input.addEventListener('change', () => {
          const filterConfig = createFilterConfig();
          // eslint-disable-next-line no-use-before-define
          runSearch(filterConfig);
        });
      });
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

  // main search function that filters, sorts, and displays recipes
  const runSearch = async (filterConfig = config) => {
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
      featured: (a, b) => a.title.localeCompare(b.title),
    };

    const results = await lookupRecipes(filterConfig, facets);
    const sortBy = document.getElementById('recipe-center-sortby') ? document.getElementById('recipe-center-sortby').dataset.sort : 'featured';
    results.sort(sorts[sortBy]);
    container.querySelector('#recipe-center-results-count').textContent = results.length;
    displayResults(results);
    displayFacets(facets, filterConfig);
  };

  const fulltextElement = container.querySelector('#fulltext');
  fulltextElement.addEventListener('input', () => {
    runSearch(createFilterConfig());
  });

  runSearch(config);
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
