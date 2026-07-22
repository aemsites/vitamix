// eslint-disable-next-line import/no-cycle -- scripts.js loads consented dynamically
import { getLocaleAndLanguage } from '../scripts.js';

export function isDebugMode() {
  return window.location.hostname === 'localhost'
    || window.location.search.includes('instrumentation=debug');
}

export function debugLog(...args) {
  // eslint-disable-next-line no-console
  if (isDebugMode()) console.log(...args);
}
export function debugWarn(...args) {
  // eslint-disable-next-line no-console
  if (isDebugMode()) console.warn(...args);
}

/**
 * Whether marketing/analytics scripts may run (Cookiebot consent or martech=on).
 * Mirrors scripts/scripts.js loadDelayed consent gating for consented.js.
 * @returns {boolean}
 */
export function hasMarketingConsent() {
  if (document.body.classList.contains('consented')) {
    return true;
  }
  return window.Cookiebot?.consented === true;
}

const PROD_HOSTS = new Set(['vitamix.com', 'www.vitamix.com']);

/** Max wait for Launch/AppMeasurement to finish sending a beacon before navigation. */
const BEACON_COMPLETE_TIMEOUT_MS = 2000;

/** @type {Array<() => void>} */
const pendingBeaconWaits = [];

/**
 * Adobe Analytics report suite suffix (vitamix{env}).
 * EDS preview/local hosts use dev; vitamix.com uses prod.
 * @returns {'dev' | 'prod'}
 */
export function getDeploymentEnv() {
  return PROD_HOSTS.has(window.location.hostname) ? 'prod' : 'dev';
}

/**
 * PDP detection via product SKU meta tag.
 * @returns {boolean}
 */
export function isPdpPage() {
  return !!document.querySelector('meta[name="sku"]');
}

/** Analytics server identifier in digitalData (EDS uses aem; Magento used Magento). */
const ANALYTICS_SERVER_ID = 'AEM';

/** Launch-recognized pageType values (generic defaultpage is not acceptable). */
const PAGE_TYPE = {
  PRODUCT_DETAIL: 'Product Detail',
  CATEGORY: 'Category',
  CART: 'Cart',
  CHECKOUT: 'Checkout',
  HOME: 'Home',
  FORM: 'Form',
  ACCOUNT: 'Account',
  CONTENT: 'Content',
  COMMERCIAL: 'Commercial',
  SEARCH: 'Search Results',
  ERROR: 'Error Page',
};

/**
 * Suffix paths under /{locale}/{lang} → pageType (locale resolved at lookup).
 * Keys ending in `/` match as prefix (longest wins).
 * @type {Record<string, string>}
 */
const PAGE_TYPE_URL_MAP = {
  '/recipes': 'recipeoverviewpage',
  '/recipes/': 'recipepage',
};

/** First path segment after a prefix key that should not match (e.g. /recipes/data). */
const PAGE_TYPE_URL_PREFIX_EXCLUSIONS = {
  '/recipes/': ['data'],
};

/**
 * @returns {string}
 */
function getStoreLocaleKey() {
  return getLocaleAndLanguage().locale;
}

/**
 * Active language locale from URL (`/{locale}/{language}/...`).
 * @returns {string}
 */
export function getActiveLanguageLocale() {
  return getLocaleAndLanguage().language;
}

/**
 * @returns {string}
 */
function getLocalePathPrefix() {
  const { locale, language } = getLocaleAndLanguage();
  return `/${locale}/${language}`;
}

/**
 * @param {string} pathname
 * @returns {string}
 */
function normalizePathForPageTypeMap(pathname) {
  if (!pathname || pathname === '/') return pathname;
  return pathname.replace(/\/+$/, '');
}

/**
 * @param {string} suffixKey
 * @param {string} normalizedPath
 * @param {string} prefixBase
 * @returns {boolean}
 */
function isExcludedPrefixMatch(suffixKey, normalizedPath, prefixBase) {
  const exclusions = PAGE_TYPE_URL_PREFIX_EXCLUSIONS[suffixKey];
  if (!exclusions?.length) return false;
  const remainder = normalizedPath.slice(prefixBase.length + 1);
  const firstSegment = remainder.split('/')[0];
  return exclusions.includes(firstSegment);
}

/**
 * Resolve pageType from PAGE_TYPE_URL_MAP (exact match, then longest prefix).
 * @param {string} [pathname]
 * @returns {string}
 */
function getPageTypeFromUrlMap(pathname = window.location.pathname) {
  const normalizedPath = normalizePathForPageTypeMap(pathname);
  const localePrefix = getLocalePathPrefix();

  const exactEntry = Object.entries(PAGE_TYPE_URL_MAP).find(([suffix]) => {
    if (suffix.endsWith('/')) return false;
    const fullKey = normalizePathForPageTypeMap(`${localePrefix}${suffix}`);
    return normalizedPath === fullKey;
  });
  if (exactEntry) return exactEntry[1];

  let bestPrefix = '';
  let pageType = '';
  Object.entries(PAGE_TYPE_URL_MAP).forEach(([suffix, value]) => {
    if (!suffix.endsWith('/')) return;
    const prefixBase = normalizePathForPageTypeMap(`${localePrefix}${suffix.replace(/\/+$/, '')}`);
    if (!normalizedPath.startsWith(`${prefixBase}/`)) return;
    if (isExcludedPrefixMatch(suffix, normalizedPath, prefixBase)) return;
    if (prefixBase.length > bestPrefix.length) {
      bestPrefix = prefixBase;
      pageType = value;
    }
  });
  return pageType;
}

/**
 * @returns {boolean}
 */
function isCommercialPath() {
  return /\/commercial(?:\/|$)/.test(window.location.pathname);
}

/**
 * Magento parity: eVar19 time-parting (`Friday|12:30pm`).
 * @returns {string}
 */
export function getTimeParting() {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const now = new Date();
  const minutes = now.getMinutes() < 30 ? '00' : '30';
  let hours = now.getHours() > 12 ? now.getHours() - 12 : now.getHours();
  if (hours === 0) hours = 12;
  const suffix = now.getHours() < 12 ? 'am' : 'pm';
  return `${days[now.getDay()]}|${hours}:${minutes}${suffix}`;
}

/**
 * Display page name from the URL path (Magento adobeLaunch.js parity).
 * @param {string} [pathname]
 * @returns {string}
 */
export function buildDisplayPageNameFromPath(pathname = window.location.pathname) {
  const segments = pathname.split('/');
  let pageName = (segments[segments.length - 1] || '').replace(/-/g, ' ');
  if (segments.length === 3 || (segments.length === 4 && segments[3] === '')) {
    pageName = 'Home';
  }
  return pageName.toLowerCase().split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.substring(1))
    .join(' ');
}

/**
 * @returns {boolean}
 */
export function isHomePage() {
  const segments = window.location.pathname.split('/').filter(Boolean);
  return segments.length <= 2;
}

/**
 * @returns {boolean}
 */
export function isErrorPage() {
  return Boolean(window.isErrorPage || window.errorCode === '404');
}

/**
 * @returns {boolean}
 */
export function isContactUsPage() {
  return /\/contact-us\/?$/.test(window.location.pathname);
}

/**
 * @returns {boolean}
 */
export function isAccountPage() {
  return /\/account\/?/.test(window.location.pathname);
}

/**
 * @returns {boolean}
 */
export function isAccountLoginPage() {
  return /\/account\/login\/?$/.test(window.location.pathname)
    || /\/login\/?$/.test(window.location.pathname);
}

/**
 * @returns {boolean}
 */
export function isAccountCreatePage() {
  return /\/create-account\/?$/.test(window.location.pathname);
}

/**
 * @returns {boolean}
 */
export function isRegistrationThankYouPage() {
  return /\/create-account-thankyou\/?$/.test(window.location.pathname);
}

/**
 * EDS checkout page detection (`/order/checkout`).
 * @returns {boolean}
 */
export function isCheckoutPage() {
  return /\/order\/checkout\/?$/.test(window.location.pathname);
}

/**
 * Shopping cart page detection via URL path.
 * @returns {boolean}
 */
export function isCartPage() {
  return /\/(?:order|checkout)\/cart\/?$/.test(window.location.pathname);
}

/**
 * EDS order success page detection (`/order/complete`).
 * @returns {boolean}
 */
export function isOrderSuccessPage() {
  const { pathname, search } = window.location;
  const params = new URLSearchParams(search);
  if (params.get('reason')) return false;
  const orderId = params.get('orderId') || params.get('id');
  if (!orderId) return false;
  return /\/order\/complete\/?$/.test(pathname);
}

/**
 * Category/PLP pages use `/shop/{slug}` on Edge (may not mount the plp block).
 * @returns {boolean}
 */
export function isShopCategoryPage() {
  const { pathname } = window.location;
  return /\/shop\/[^/]+\/?$/.test(pathname) && !pathname.includes('/commercial/');
}

/**
 * PDP pages live under `/products/{slug}` (excludes modals and tooling paths).
 * @returns {boolean}
 */
export function isProductsPathPage() {
  const { pathname } = window.location;
  if (!/\/products\/[^/]+\/?$/.test(pathname)) return false;
  const slug = pathname.split('/').filter(Boolean).pop() || '';
  return !['modals', 'operations-log'].includes(slug) && !slug.startsWith('media_');
}

/**
 * @returns {boolean}
 */
export function isSearchResultsPage() {
  return /\/search-result\/?$/.test(window.location.pathname);
}

/**
 * @returns {boolean}
 */
export function isPlpPage() {
  return isShopCategoryPage() || Boolean(
    document.querySelector('.plp-container, .plp-wrapper, [data-block-name="plp"]'),
  );
}

/**
 * @returns {string}
 */
function getProductUrlKey() {
  const segments = window.location.pathname.split('/').filter(Boolean);
  return segments[segments.length - 1] || '';
}

/**
 * @returns {string}
 */
function detectEdsPageKind() {
  if (isErrorPage()) return 'error404';
  if (isOrderSuccessPage()) return 'orderComplete';
  if (isCheckoutPage()) return 'checkout';
  if (isCartPage()) return 'cart';
  if (isPdpPage() || isProductsPathPage()) return 'pdp';
  if (isHomePage()) return 'home';
  if (isSearchResultsPage()) return 'search';
  if (isAccountLoginPage()) return 'accountLogin';
  if (isAccountCreatePage() || isRegistrationThankYouPage()) return 'accountCreate';
  if (isAccountPage()) return 'account';
  if (isContactUsPage()) return 'contactUs';
  if (isPlpPage()) return 'plp';
  return 'cms';
}

/**
 * Build Magento-equivalent pageID / category hierarchy for digitalData.page.
 * @param {string} pageKind
 * @returns {{
 *   pageType: string,
 *   pageID: string,
 *   primaryCat: string,
 *   subCat1: string,
 *   subCat2: string,
 *   homeVsComm: string,
 *   pageTypeSource: 'url-map' | 'detected',
 * }}
 */
export function buildPageAnalyticsContext(pageKind = detectEdsPageKind()) {
  const websiteCode = getStoreLocaleKey();
  const isCommercial = isCommercialPath();
  let pageType = '';
  let primaryCat = '';
  let subCat1 = '';
  let subCat2 = '';
  let pageID = '';
  let homeVsComm = '';
  let pageTypeSource = 'detected';

  if (pageKind === 'error404') {
    homeVsComm = 'br';
    pageType = PAGE_TYPE.ERROR;
    primaryCat = `vitamix:${websiteCode}`;
    subCat1 = `vitamix:${websiteCode}:br`;
    subCat2 = `vitamix:${websiteCode}:br:toplevel`;
    pageID = `${subCat2}:404`;
  } else if (
    !isCommercial
    && (pageKind === 'plp' || pageKind === 'cart' || pageKind === 'checkout')
  ) {
    homeVsComm = 'hh';
    primaryCat = `vitamix:${websiteCode}`;
    subCat1 = `vitamix:${websiteCode}:sh`;
    subCat2 = `vitamix:${websiteCode}:sh:toplevel`;
    let pageIdLast = 'Shopping Cart';
    if (pageKind === 'plp') {
      pageIdLast = getProductUrlKey();
      pageType = PAGE_TYPE.CATEGORY;
    } else if (pageKind === 'checkout') {
      subCat2 = `vitamix:${websiteCode}:sh:checkout`;
      pageIdLast = 'shippingaddress';
      pageType = PAGE_TYPE.CHECKOUT;
    } else {
      pageType = PAGE_TYPE.CART;
    }
    pageID = `${subCat2}:${pageIdLast.toLowerCase()}`;
  } else if (!isCommercial && pageKind === 'pdp') {
    homeVsComm = 'sh';
    pageType = PAGE_TYPE.PRODUCT_DETAIL;
    primaryCat = `vitamix:${websiteCode}`;
    subCat1 = `vitamix:${websiteCode}:sh`;
    subCat2 = `vitamix:${websiteCode}:sh:productdetail`;
    pageID = `${subCat2}:${getProductUrlKey()}`;
  } else if (pageKind === 'home') {
    homeVsComm = 'br';
    pageType = PAGE_TYPE.HOME;
    primaryCat = `vitamix:${websiteCode}`;
    subCat1 = `vitamix:${websiteCode}:br`;
    subCat2 = `vitamix:${websiteCode}:br:toplevel`;
    pageID = `${subCat2}:homepage`;
  } else if (pageKind === 'accountLogin' || pageKind === 'accountCreate' || pageKind === 'account') {
    homeVsComm = 'br';
    pageType = pageKind === 'accountCreate' ? PAGE_TYPE.FORM : PAGE_TYPE.ACCOUNT;
    primaryCat = `vitamix:${websiteCode}`;
    subCat1 = `vitamix:${websiteCode}:ma`;
    subCat2 = `vitamix:${websiteCode}:ma:myaccount`;
    let pageIdLast = 'my-account-home';
    if (pageKind === 'accountLogin') pageIdLast = 'login';
    if (pageKind === 'accountCreate') pageIdLast = 'create-account';
    pageID = `${subCat2}:${pageIdLast}`;
  } else if (pageKind === 'contactUs') {
    pageType = PAGE_TYPE.FORM;
    homeVsComm = 'br';
    primaryCat = `vitamix:${websiteCode}`;
    subCat1 = `vitamix:${websiteCode}:br`;
    subCat2 = `vitamix:${websiteCode}:br:customer-service`;
    pageID = `${subCat2}:contact-us`;
  } else if (pageKind === 'orderComplete') {
    homeVsComm = 'hh';
    pageType = PAGE_TYPE.CHECKOUT;
    primaryCat = `vitamix:${websiteCode}`;
    subCat1 = `vitamix:${websiteCode}:hh`;
    subCat2 = `vitamix:${websiteCode}:hh:checkout`;
    pageID = `${subCat2}:complete`;
  } else if (pageKind === 'search') {
    homeVsComm = 'hh';
    pageType = PAGE_TYPE.SEARCH;
    primaryCat = `vitamix:${websiteCode}`;
    subCat1 = `vitamix:${websiteCode}:hh`;
    subCat2 = `vitamix:${websiteCode}:hh:search`;
    pageID = `${subCat2}:results`;
  } else if (!isCommercial) {
    homeVsComm = 'hh';
    pageType = PAGE_TYPE.CONTENT;
  } else {
    homeVsComm = 'hh';
    pageType = PAGE_TYPE.COMMERCIAL;
  }

  const mappedPageType = pageKind === 'cms' ? getPageTypeFromUrlMap() : '';
  if (mappedPageType) {
    pageType = mappedPageType;
    pageTypeSource = 'url-map';
  }

  return {
    pageType,
    pageID,
    primaryCat,
    subCat1,
    subCat2,
    homeVsComm,
    pageTypeSource,
  };
}

/**
 * State/zip for digitalData.user — checkout form state when available.
 * @returns {{ state: string, zip: string }}
 */
function getUserProfileGeo() {
  try {
    const raw = sessionStorage.getItem(`checkout_form_state_${getStoreLocaleKey()}`);
    if (!raw) return { state: '', zip: '' };
    const data = JSON.parse(raw);
    return {
      state: String(data['shipping-state'] || ''),
      zip: String(data['shipping-zip'] || ''),
    };
  } catch {
    return { state: '', zip: '' };
  }
}

/**
 * Apply page context to digitalData.page (merge-safe for post-Launch sync).
 * @param {ReturnType<typeof buildPageAnalyticsContext>} categories
 */
function applyDigitalDataPageContext(categories) {
  const geo = getUserProfileGeo();

  window.digitalData = window.digitalData || {};
  window.digitalData.page = {
    ...(window.digitalData.page || {}),
    pageInfo: {
      ...(window.digitalData.page?.pageInfo || {}),
      pageID: categories.pageID || window.digitalData.page?.pageInfo?.pageID || '',
      pageName: window.digitalData.page?.pageInfo?.pageName || buildDisplayPageNameFromPath(),
    },
    attributes: {
      ...(window.digitalData.page?.attributes || {}),
      server: ANALYTICS_SERVER_ID,
      activeLanguageLocale: getActiveLanguageLocale(),
      site: getStoreLocaleKey(),
      timeParting: getTimeParting(),
    },
    category: {
      ...(window.digitalData.page?.category || {}),
      pageType: categories.pageType || window.digitalData.page?.category?.pageType || '',
      primaryCategory: categories.primaryCat || window.digitalData.page?.category?.primaryCategory || '',
      subCategory1: categories.subCat1 || window.digitalData.page?.category?.subCategory1 || '',
      subCategory2: categories.subCat2 || window.digitalData.page?.category?.subCategory2 || '',
    },
  };
  window.digitalData.user = {
    ...(window.digitalData.user || {}),
    profile: {
      ...(window.digitalData.user?.profile || {}),
      profileInfo: {
        ...(window.digitalData.user?.profile?.profileInfo || {}),
        homeVsBusiness: categories.homeVsComm.toUpperCase(),
        state: geo.state,
        zip: geo.zip,
      },
    },
  };
}

/**
 * Detect and apply digitalData.page context for the current URL.
 * @param {string} logLabel
 * @returns {ReturnType<typeof buildPageAnalyticsContext> | null}
 */
function refreshDigitalDataPageContext(logLabel) {
  if (!hasMarketingConsent()) return null;

  const pageKind = detectEdsPageKind();
  const categories = buildPageAnalyticsContext(pageKind);
  applyDigitalDataPageContext(categories);

  debugLog(logLabel, {
    pageKind,
    pageType: categories.pageType,
    pageID: categories.pageID,
    pageTypeSource: categories.pageTypeSource,
  });
  return categories;
}

/**
 * Populate global digitalData.page and digitalData.user before Launch loads.
 * Mirrors Magento adobeLaunch.js page context (pageType is a data-layer field, not track()).
 */
export function initDigitalDataPage() {
  refreshDigitalDataPageContext('Adobe Analytics digitalData.page initialized');
}

/**
 * Re-apply pageType after Launch loads (Launch defaults unknown types to defaultpage).
 */
export function syncDigitalDataPageContext() {
  refreshDigitalDataPageContext('Adobe Analytics digitalData.page synced');
}

/**
 * Product display name for Adobe Analytics productID (Magento parity: ;{name};;;;).
 * @returns {string}
 */
export function getProductName() {
  if (window.jsonLdData?.name) {
    return window.jsonLdData.name;
  }
  const jsonLd = document.head.querySelector('script[type="application/ld+json"]');
  if (jsonLd?.textContent) {
    try {
      const data = JSON.parse(jsonLd.textContent);
      if (data?.name) return data.name;
    } catch {
      // ignore error parsing JSON-LD.
    }
  }
  return document.querySelector('.pdp h1')?.textContent?.trim() || '';
}

/**
 * @param {string} productName
 * @returns {string}
 */
export function buildProductId(productName) {
  return `;${productName};;;;`;
}

export function getSatellite() {
  // eslint-disable-next-line no-underscore-dangle
  return window._satellite;
}

const ANALYTICS_TRACKING_SERVER = 'metrics.vitamix.com';
const ANALYTICS_TRACKING_SERVER_SECURE = 'smetrics.vitamix.com';

function applyTrackingConfig(tracker) {
  if (!tracker || typeof tracker !== 'object') {
    return;
  }
  // Always use smetrics — AppMeasurement picks trackingServerSecure only when ssl=true.
  // Page protocol (http://localhost) must not downgrade beacons to http://metrics.
  tracker.trackingServer = ANALYTICS_TRACKING_SERVER;
  tracker.trackingServerSecure = ANALYTICS_TRACKING_SERVER_SECURE;
  tracker.ssl = true;
}

/**
 * Register s.doPlugins so tracking servers and ssl are set before each Launch beacon.
 * Chains with any existing doPlugins from Launch (set doPlugins only once per tracker).
 * @see https://experienceleague.adobe.com/en/docs/analytics/implementation/vars/functions/doplugins
 * @param {object} tracker
 */
function ensureDoPlugins(tracker) {
  if (!tracker || typeof tracker !== 'object') {
    return;
  }
  if (tracker.doPlugins?.vitamixEds === true) {
    return;
  }

  const previousDoPlugins = typeof tracker.doPlugins === 'function'
    ? tracker.doPlugins
    : null;

  function vitamixEdsDoPlugins() {
    if (typeof previousDoPlugins === 'function') {
      previousDoPlugins.call(this);
    }
    applyTrackingConfig(this);
  }
  vitamixEdsDoPlugins.vitamixEds = true;
  tracker.doPlugins = vitamixEdsDoPlugins;
}

function flushPendingBeaconWaits() {
  while (pendingBeaconWaits.length > 0) {
    const resolve = pendingBeaconWaits.shift();
    resolve();
  }
}

/**
 * Resolve when AppMeasurement finishes the in-flight beacon, or after timeout.
 * Launch rules may also call window.vitamixEdsAnalytics.notifyBeaconComplete().
 * @returns {Promise<void>}
 */
function waitForBeaconComplete() {
  return new Promise((resolve) => {
    pendingBeaconWaits.push(resolve);
    setTimeout(() => {
      const index = pendingBeaconWaits.indexOf(resolve);
      if (index >= 0) {
        pendingBeaconWaits.splice(index, 1);
        resolve();
      }
    }, BEACON_COMPLETE_TIMEOUT_MS);
  });
}

/**
 * Chain AppMeasurement post-send callbacks so navigation can wait for the beacon.
 * @param {object} tracker
 */
function ensureBeaconCallbackHooks(tracker) {
  if (!tracker || typeof tracker !== 'object' || tracker.vitamixBeaconHooks === true) {
    return;
  }

  const wrapCallback = (prop) => {
    const previous = tracker[prop];
    tracker[prop] = function wrappedBeaconCallback(...args) {
      if (typeof previous === 'function') {
        previous.apply(this, args);
      }
      flushPendingBeaconWaits();
    };
  };

  wrapCallback('callback');
  wrapCallback('linkTrackCallback');
  tracker.vitamixBeaconHooks = true;
}

function configureAnalyticsTracker(tracker = window.s) {
  if (!tracker || typeof tracker !== 'object') {
    return;
  }
  applyTrackingConfig(tracker);
  ensureDoPlugins(tracker);
  ensureBeaconCallbackHooks(tracker);
}

window.vitamixEdsAnalytics = window.vitamixEdsAnalytics || {};
window.vitamixEdsAnalytics.notifyBeaconComplete = flushPendingBeaconWaits;

/**
 * Wrap s_gi so Launch-created trackers get smetrics config before their first beacon.
 */
function patchAppMeasurementFactory() {
  if (typeof window.s_gi !== 'function' || window.s_gi.vitamixEdsPatched === true) {
    return;
  }
  const originalSgi = window.s_gi;
  function patchedSgi(account) {
    const tracker = originalSgi(account);
    configureAnalyticsTracker(tracker);
    return tracker;
  }
  patchedSgi.vitamixEdsPatched = true;
  window.s_gi = patchedSgi;
}

/**
 * Launch keeps its tracker in AppMeasurement's s_c_il registry, not always window.s.
 */
export function configureAnalyticsTrackingServers() {
  patchAppMeasurementFactory();
  configureAnalyticsTracker(window.s);
  if (!Array.isArray(window.s_c_il)) {
    return;
  }
  window.s_c_il.forEach((instance) => {
    if (instance && (instance.account || typeof instance.t === 'function')) {
      configureAnalyticsTracker(instance);
    }
  });
}

/**
 * Launch loads AppMeasurement async after its container script resolves.
 * Poll until s_gi exists, then register doPlugins on late tracker instances.
 * @returns {Promise<void>}
 */
export function ensureAnalyticsTrackingConfigured() {
  return new Promise((resolve) => {
    let attempts = 0;
    const tick = () => {
      configureAnalyticsTrackingServers();
      attempts += 1;
      if (typeof window.s_gi === 'function' && attempts >= 3) {
        resolve();
        return;
      }
      if (attempts >= 100) {
        resolve();
        return;
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

/**
 * @param {() => void} callback
 * @param {string} [eventLabel]
 * @param {number} [maxAttempts]
 * @param {number} [intervalMs]
 */
export function whenSatelliteReady(
  callback,
  eventLabel = 'event',
  maxAttempts = 50,
  intervalMs = 100,
) {
  let attempts = 0;
  const check = () => {
    const satellite = getSatellite();
    if (satellite && typeof satellite.track === 'function') {
      callback();
      return;
    }
    attempts += 1;
    if (attempts < maxAttempts) {
      setTimeout(check, intervalMs);
    } else {
      debugWarn(`Adobe Analytics ${eventLabel} skipped: Adobe Launch (_satellite) not available`);
    }
  };
  check();
}

let pageTypeGuardIntervalId = 0;

/**
 * Re-apply pageType briefly after Launch loads (Launch may overwrite asynchronously).
 */
function guardDigitalDataPageType() {
  if (pageTypeGuardIntervalId) {
    clearInterval(pageTypeGuardIntervalId);
  }
  let attempts = 0;
  pageTypeGuardIntervalId = window.setInterval(() => {
    syncDigitalDataPageContext();
    attempts += 1;
    if (attempts >= 30) {
      clearInterval(pageTypeGuardIntervalId);
      pageTypeGuardIntervalId = 0;
    }
  }, 100);
}

/**
 * Push product context to digitalData and trigger a Launch direct-call rule.
 * Launch owns variable mapping and beacon send (Adobe-recommended pattern).
 * @param {string} eventName Launch direct-call identifier (e.g. prodView)
 * @param {string} productID Adobe Analytics products string
 * @param {{ waitForBeacon?: boolean }} [options]
 * @returns {Promise<boolean>} Whether the Launch rule was triggered
 */
async function pushProductEvent(eventName, productID, { waitForBeacon = false } = {}) {
  window.digitalData = window.digitalData || {};
  window.digitalData.product = [{
    productInfo: { productID },
  }];

  const satellite = getSatellite();
  if (!satellite?.track) {
    return false;
  }

  // Re-apply smetrics on all tracker instances right before Launch sends the beacon.
  configureAnalyticsTrackingServers();
  const beaconComplete = waitForBeacon ? waitForBeaconComplete() : null;
  satellite.track(eventName);

  if (beaconComplete) {
    await beaconComplete;
  }
  debugLog(`Adobe Analytics ${eventName} fired`, window.digitalData.product);
  return true;
}

/**
 * Fire the prodView event after the product name is found on the PDP.
 * @returns {Promise<void>}
 */
export async function fireProdView() {
  const productName = `${getProductName()}`;
  if (!productName) {
    debugWarn('Adobe Analytics prodView skipped: product name not found on PDP');
    return;
  }

  if (!(await pushProductEvent('prodView', buildProductId(productName)))) {
    debugWarn('Adobe Analytics prodView skipped: Adobe Launch (_satellite) not available');
  }
}

/**
 * Retry briefly so jsonLdData / PDP DOM are ready after consent scripts load.
 * @param {number} [attempt]
 */
export function trackProdView(attempt = 0) {
  whenSatelliteReady(() => {
    const productName = `${getProductName()}`;
    if (!productName && attempt < 10) {
      setTimeout(() => trackProdView(attempt + 1), 100);
      return;
    }
    fireProdView();
  }, 'prodView');
}

/**
 * Initialize Adobe Analytics instrumentation (digitalData.page pageType + prodView on PDP).
 * @returns {void}
 */
export function initInstrumentation() {
  debugLog('Adobe Analytics instrumentation loaded');
  guardDigitalDataPageType();
  if (isPdpPage() || isProductsPathPage()) {
    trackProdView();
  }
}
