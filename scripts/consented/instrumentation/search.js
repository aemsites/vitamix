import {
  debugLog,
  debugWarn,
  hasMarketingConsent,
} from './shared.js';
import {
  assignDigitalDataPageInfo,
  flushLaunchTrackers,
  triggerLaunchEvent,
  whenSatelliteReady,
} from './adobe-runtime.js';

/** Debounce delay (ms) for the results-count observer — prevents rapid live-search
 *  prefixes from each firing a separate nullSearch event before the user finishes typing.
 */
const SEARCH_DEBOUNCE_MS = 800;

let searchTrackingInstalled = false;

/**
 * Derive onsiteSearchToolType from the current URL ?type= param.
 * Matches AEM logic: recipe → browseRecipe, article → browseArticle, else siteSearch.
 * @returns {string}
 */
function getSearchToolTypeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const type = (params.get('type') || '').toLowerCase();
  if (type === 'recipe') return 'browseRecipe';
  if (type === 'article') return 'browseArticle';
  return 'siteSearch';
}

/**
 * digitalData.page.pageInfo payload for a search run (Adobe Commerce
 * setDigitalDataForSearch parity).
 * @param {string} searchTerm
 * @param {string} toolType
 * @param {number} resultCount
 * @returns {{
 *   onsiteSearchTerm: string,
 *   onsiteSearchToolType: string,
 *   onsiteSearchResults: number,
 * }}
 */
export function buildSearchPageInfo(searchTerm, toolType, resultCount) {
  return {
    onsiteSearchTerm: searchTerm || '',
    onsiteSearchToolType: toolType,
    onsiteSearchResults: resultCount,
  };
}

/**
 * Set digitalData search properties and fire the matching Launch direct-call rule
 * (nullSearch for zero results, successfulSearch otherwise). Mirrors Adobe Commerce
 * setDigitalDataForSearch(). Called after every search run in the search-results widget
 * so onsiteSearchTerm/Results/ToolType are always populated.
 * @param {string} searchTerm - The search string entered by the user
 * @param {string} toolType - 'siteSearch' | 'browseRecipe' | 'browseArticle'
 * @param {number} resultCount - Total number of results returned
 * @returns {Promise<void>}
 */
export async function fireSearchEvent(searchTerm, toolType, resultCount) {
  if (!hasMarketingConsent()) {
    return;
  }

  const pageInfo = buildSearchPageInfo(searchTerm, toolType, resultCount);
  assignDigitalDataPageInfo(pageInfo);
  flushLaunchTrackers();

  const eventName = resultCount === 0 ? 'nullSearch' : 'successfulSearch';
  if (!(await triggerLaunchEvent(eventName, pageInfo))) {
    debugWarn(`Adobe Analytics ${eventName} skipped: Adobe Launch (_satellite) not available`);
    return;
  }

  debugLog(`Adobe Analytics ${eventName} fired`, pageInfo);
}

/**
 * Wait for Launch, then push search context and fire the tracking event.
 * @param {Element} resultsCountEl
 * @param {string} searchTerm
 */
function trackSearchResult(resultsCountEl, searchTerm) {
  const toolType = getSearchToolTypeFromUrl();
  const resultCount = parseInt(resultsCountEl.textContent, 10) || 0;
  whenSatelliteReady(() => {
    fireSearchEvent(searchTerm, toolType, resultCount);
  }, resultCount === 0 ? 'nullSearch' : 'successfulSearch');
}

/**
 * Attach a MutationObserver to #results-count so digitalData is updated
 * automatically every time the search widget finishes a runSearch cycle.
 * The callback is debounced so that rapid live-search mutations coalesce
 * into a single tracking call once the query has settled.
 * @param {Element} container - .search-results container (reads dataset.searchState)
 * @param {Element} resultsCountEl
 */
function attachSearchResultsObserver(container, resultsCountEl) {
  let lastSearchTerm = null;
  let debounceTimer = null;

  const params = new URLSearchParams(window.location.search);
  const initialSearchTerm = params.get('search') || '';

  // Process the already-rendered result immediately so the initial URL-driven
  // search is not missed (MutationObserver does not replay past mutations).
  // The widget sets container.dataset.searchState = 'complete' once runSearch has
  // written real results (including a genuine zero-result count), so this is an
  // unambiguous signal that the count is final rather than a not-yet-rendered default.
  if (initialSearchTerm && container.dataset.searchState === 'complete') {
    lastSearchTerm = initialSearchTerm;
    trackSearchResult(resultsCountEl, initialSearchTerm);
  }

  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const currentParams = new URLSearchParams(window.location.search);
      const searchTerm = currentParams.get('search') || '';
      // Only fire on an actual new search term, not pagination/filter changes.
      if (searchTerm === lastSearchTerm) return;
      lastSearchTerm = searchTerm;
      trackSearchResult(resultsCountEl, searchTerm);
    }, SEARCH_DEBOUNCE_MS);
  });
  observer.observe(resultsCountEl, { childList: true, characterData: true, subtree: true });
}

/**
 * Initialize search analytics tracking on search-result pages (register once per page).
 * Observes #results-count — written by the search widget after every runSearch.
 * Falls back to a MutationObserver on the container if the widget hasn't rendered yet.
 * @returns {void}
 */
export function trackSearchResults() {
  if (searchTrackingInstalled) {
    return;
  }
  searchTrackingInstalled = true;

  const container = document.querySelector('.search-results');
  if (!container) return;

  const resultsCountEl = container.querySelector('#results-count');
  if (resultsCountEl) {
    attachSearchResultsObserver(container, resultsCountEl);
    return;
  }

  // #results-count is injected dynamically by buildSearchFiltering — wait for it.
  // Once found, disconnect immediately and attach the debounced search observer
  // which will also process the current (already-completed) result.
  const containerObserver = new MutationObserver((_, obs) => {
    const el = container.querySelector('#results-count');
    if (el) {
      obs.disconnect();
      attachSearchResultsObserver(container, el);
    }
  });
  containerObserver.observe(container, { childList: true, subtree: true });
}
