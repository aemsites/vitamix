/**
 * Recipe Reviews - Fetches and displays recipe titles and images
 * from the Vitamix query-index.json
 */

import { createOptimizedPicture } from '../../scripts/aem.js';

const RECIPES_ENDPOINT = '/us/en_us/recipes/query-index.json';
const AEM_ORIGIN = 'https://main--vitamix--aemsites.aem.live';

/**
 * Extracts the pathname from a URL string
 * @param {string} urlString - Full URL or path
 * @returns {string} Just the pathname, relative to origin
 */
function getImagePathname(urlString) {
  if (!urlString) return '';

  try {
    // If it's already a relative path, return as-is
    if (urlString.startsWith('/')) {
      return urlString;
    }

    // Parse the full URL and extract just the pathname
    const url = new URL(urlString);
    return url.pathname;
  } catch {
    // If URL parsing fails, return the original string
    return urlString;
  }
}

/**
 * Fetches the recipe index and extracts titles and images, grouped by unique title
 * @returns {Promise<Array<{title: string, image: string, paths: string[]}>>}
 */
export default async function fetchRecipes() {
  const response = await fetch(RECIPES_ENDPOINT);

  if (!response.ok) {
    throw new Error(`Failed to fetch recipes: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  // Handle both array format and object with data property
  const recipes = Array.isArray(data) ? data : (data.data || []);

  // Group recipes by unique title
  const recipesByTitle = new Map();

  recipes.forEach((recipe) => {
    const title = recipe.title || recipe.name || 'Untitled Recipe';
    const image = getImagePathname(recipe.image || '');
    const path = recipe.path || '';

    if (recipesByTitle.has(title)) {
      // Add path to existing entry
      const existing = recipesByTitle.get(title);
      if (path && !existing.paths.includes(path)) {
        existing.paths.push(path);
      }
      // Use first available image
      if (!existing.image && image) {
        existing.image = image;
      }
    } else {
      // Create new entry
      recipesByTitle.set(title, {
        title,
        image,
        paths: path ? [path] : [],
      });
    }
  });

  // Convert map to array and sort by title
  return Array.from(recipesByTitle.values()).sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Generates a reviewsId from a title
 * @param {string} title - Recipe title
 * @returns {string} reviewsId (rcp + lowercase title with non-alphanumeric chars removed)
 */
function generateReviewsId(title) {
  return `rcp${title.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

/**
 * Creates a placeholder element for missing images
 * @returns {HTMLElement}
 */
function createPlaceholder() {
  const placeholder = document.createElement('div');
  placeholder.className = 'recipe-image placeholder';
  placeholder.textContent = '🍽️';
  return placeholder;
}

/**
 * Creates a recipe card element
 * @param {Object} recipe - Recipe data with paths array
 * @param {number} index - Index for animation delay
 * @returns {HTMLElement}
 */
function createRecipeCard(recipe, index) {
  const card = document.createElement('div');
  card.className = 'recipe-card';
  // Only animate first 20 cards for a nice entrance effect
  if (index < 20) {
    card.style.animationDelay = `${index * 0.03}s`;
  } else {
    // Skip animation for later cards - show immediately
    card.style.animation = 'none';
  }
  card.dataset.title = recipe.title.toLowerCase();

  const reviewsId = generateReviewsId(recipe.title);

  // Create image container with loading placeholder
  const imageContainer = document.createElement('div');
  imageContainer.className = 'recipe-image-container';

  if (recipe.image) {
    // Build full URL using AEM origin + pathname
    const imageUrl = `${AEM_ORIGIN}${recipe.image}`;

    // Create optimized picture element
    const picture = createOptimizedPicture(imageUrl, recipe.title, false);
    picture.classList.add('recipe-image');

    // Handle image load/error states
    const img = picture.querySelector('img');
    if (img) {
      img.onload = () => {
        imageContainer.classList.add('loaded');
      };
      img.onerror = () => {
        picture.replaceWith(createPlaceholder());
        imageContainer.classList.add('loaded');
      };
    }

    imageContainer.appendChild(picture);
  } else {
    imageContainer.appendChild(createPlaceholder());
    imageContainer.classList.add('loaded');
  }

  card.appendChild(imageContainer);

  const info = document.createElement('div');
  info.className = 'recipe-info';

  const title = document.createElement('h3');
  title.className = 'recipe-title';
  title.textContent = recipe.title;
  info.appendChild(title);

  const reviewsIdEl = document.createElement('div');
  reviewsIdEl.className = 'recipe-reviews-id';
  reviewsIdEl.textContent = reviewsId;
  info.appendChild(reviewsIdEl);

  // Bazaarvoice rating summary
  const bvRating = document.createElement('div');
  bvRating.className = 'recipe-bv-rating';
  bvRating.setAttribute('data-bv-show', 'rating_summary');
  bvRating.setAttribute('data-bv-product-id', reviewsId);
  info.appendChild(bvRating);

  // Show multiple links if there are multiple paths
  if (recipe.paths && recipe.paths.length > 0) {
    const linksContainer = document.createElement('div');
    linksContainer.className = 'recipe-links';

    recipe.paths.forEach((path) => {
      const link = document.createElement('a');
      link.className = 'recipe-link';
      link.href = path;
      link.target = '_blank';
      link.rel = 'noopener';
      // Show a shortened version of the path
      const shortPath = path.split('/').pop() || path;
      link.textContent = shortPath;
      link.title = path;
      linksContainer.appendChild(link);
    });

    info.appendChild(linksContainer);
  }

  card.appendChild(info);
  return card;
}

/**
 * Updates the visible count display
 */
function updateVisibleCount() {
  const cards = document.querySelectorAll('.recipe-card');
  const visible = Array.from(cards).filter((card) => !card.classList.contains('hidden')).length;
  document.getElementById('visible-count').textContent = visible;

  const noResults = document.getElementById('no-results');
  noResults.style.display = visible === 0 ? 'block' : 'none';
}

/**
 * Extracts Bazaarvoice rating data from a recipe card
 * @param {HTMLElement} card - Recipe card element
 * @returns {{reviewCount: number, avgRating: number}}
 */
function getBvDataFromCard(card) {
  const bvContainer = card.querySelector('.recipe-bv-rating');
  let reviewCount = 0;
  let avgRating = 0;

  if (bvContainer && bvContainer.getAttribute('data-bv-ready') === 'true') {
    // Extract review count from meta tag
    const reviewCountMeta = bvContainer.querySelector('meta[itemprop="reviewCount"]');
    if (reviewCountMeta) {
      reviewCount = parseInt(reviewCountMeta.getAttribute('content'), 10) || 0;
    }

    // Extract average rating from the rating value div
    const ratingValueDiv = bvContainer.querySelector('[itemprop="ratingValue"]');
    if (ratingValueDiv) {
      avgRating = parseFloat(ratingValueDiv.textContent) || 0;
    }
  }

  return { reviewCount, avgRating };
}

/**
 * Extracts detailed review data from a card for export
 * @param {HTMLElement} card - Recipe card element
 * @returns {Object} Detailed review data
 */
function getDetailedBvDataFromCard(card) {
  const bvContainer = card.querySelector('.recipe-bv-rating');
  const title = card.querySelector('.recipe-title')?.textContent || '';
  const reviewsId = card.querySelector('.recipe-reviews-id')?.textContent || '';

  const data = {
    title,
    reviewsId,
    reviewCount: 0,
    avgRating: 0,
  };

  if (bvContainer && bvContainer.getAttribute('data-bv-ready') === 'true') {
    // Extract review count
    const reviewCountMeta = bvContainer.querySelector('meta[itemprop="reviewCount"]');
    if (reviewCountMeta) {
      data.reviewCount = parseInt(reviewCountMeta.getAttribute('content'), 10) || 0;
    }

    // Extract average rating
    const ratingValueDiv = bvContainer.querySelector('[itemprop="ratingValue"]');
    if (ratingValueDiv) {
      data.avgRating = parseFloat(ratingValueDiv.textContent) || 0;
    }
  }

  return data;
}

/**
 * Exports filtered recipes to TSV and copies to clipboard
 */
async function exportToTSV() {
  const visibleCards = document.querySelectorAll('.recipe-card:not(.hidden)');

  if (visibleCards.length === 0) {
    // eslint-disable-next-line no-alert
    alert('No recipes to export. Adjust your filters to show some recipes.');
    return;
  }

  // Header row
  const headers = [
    'Title',
    'Reviews ID',
    'Number of Reviews',
    'Average Rating',
  ];

  const rows = [headers.join('\t')];

  // Data rows
  visibleCards.forEach((card) => {
    const data = getDetailedBvDataFromCard(card);
    const row = [
      data.title,
      data.reviewsId,
      data.reviewCount,
      data.avgRating,
    ];
    rows.push(row.join('\t'));
  });

  const tsv = rows.join('\n');

  try {
    await navigator.clipboard.writeText(tsv);
    // eslint-disable-next-line no-alert
    alert(`Copied ${visibleCards.length} recipes to clipboard!\n\nPaste into a spreadsheet.`);
  } catch {
    // Fallback: create a download
    const blob = new Blob([tsv], { type: 'text/tab-separated-values' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recipe-reviews.tsv';
    a.click();
    URL.revokeObjectURL(url);
  }
}

/**
 * Filters recipes based on search term and rating filters
 */
function applyFilters() {
  const searchTerm = (document.getElementById('search-input')?.value || '').toLowerCase().trim();
  const minReviews = parseInt(document.getElementById('min-reviews')?.value, 10) || 0;
  const minRating = parseFloat(document.getElementById('min-rating')?.value) || 0;

  const cards = document.querySelectorAll('.recipe-card');

  cards.forEach((card) => {
    // Check search term
    const matchesSearch = searchTerm === '' || card.dataset.title.includes(searchTerm);

    // Check rating filters
    const { reviewCount, avgRating } = getBvDataFromCard(card);
    const matchesReviews = reviewCount >= minReviews;
    const matchesRating = minRating === 0 || avgRating >= minRating;

    const isVisible = matchesSearch && matchesReviews && matchesRating;
    card.classList.toggle('hidden', !isVisible);
  });

  updateVisibleCount();
}

/**
 * Renders all recipes to the grid
 * @param {Array} recipes
 */
function renderRecipes(recipes) {
  const grid = document.getElementById('recipe-grid');
  grid.innerHTML = '';

  recipes.forEach((recipe, index) => {
    const card = createRecipeCard(recipe, index);
    grid.appendChild(card);
  });

  document.getElementById('total-count').textContent = recipes.length;
  updateVisibleCount();
}

/**
 * Shows an error message
 * @param {string} message
 */
function showError(message) {
  document.getElementById('loading').style.display = 'none';
  const errorEl = document.getElementById('error');
  errorEl.textContent = message;
  errorEl.style.display = 'block';
}

/**
 * Shows the content section
 */
function showContent() {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('content').style.display = 'block';
}

/**
 * Watches for Bazaarvoice data to be loaded and updates status
 */
function watchForBvReady() {
  const filterStatus = document.getElementById('filter-status');
  let checkCount = 0;
  const maxChecks = 60; // Check for up to 30 seconds

  const checkBvReady = () => {
    const bvContainers = document.querySelectorAll('.recipe-bv-rating[data-bv-ready="true"]');
    const totalContainers = document.querySelectorAll('.recipe-bv-rating').length;

    if (bvContainers.length > 0) {
      filterStatus.innerHTML = `<span class="bv-ready">✓ ${bvContainers.length}/${totalContainers} ratings loaded</span>`;

      // If all loaded or we've waited long enough, stop checking
      if (bvContainers.length === totalContainers || checkCount >= maxChecks) {
        return;
      }
    }

    checkCount += 1;
    if (checkCount < maxChecks) {
      setTimeout(checkBvReady, 500);
    } else {
      filterStatus.innerHTML = `<span class="bv-ready">✓ ${bvContainers.length}/${totalContainers} ratings loaded</span>`;
    }
  };

  // Start checking after a delay to allow BV script to load
  setTimeout(checkBvReady, 2000);
}

/**
 * Initializes the reviews page
 */
async function init() {
  try {
    const recipes = await fetchRecipes();
    renderRecipes(recipes);
    showContent();

    // Set up search functionality with debounce
    const searchInput = document.getElementById('search-input');
    const minReviewsInput = document.getElementById('min-reviews');
    const minRatingInput = document.getElementById('min-rating');
    let debounceTimer;

    const debouncedFilter = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        applyFilters();
      }, 200);
    };

    searchInput.addEventListener('input', debouncedFilter);
    minReviewsInput.addEventListener('input', debouncedFilter);
    minRatingInput.addEventListener('input', debouncedFilter);

    // Set up export button
    const exportBtn = document.getElementById('export-btn');
    exportBtn.addEventListener('click', exportToTSV);

    // Watch for Bazaarvoice data to load
    watchForBvReady();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load recipes:', error);
    showError(`Failed to load recipes: ${error.message}`);
  }
}

// Start the app
init();
