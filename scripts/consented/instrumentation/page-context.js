// eslint-disable-next-line import/no-cycle -- scripts.js loads consented dynamically
import { getLocaleAndLanguage } from '../../scripts.js';
import {
  debugLog,
  hasMarketingConsent,
  getStoreLocaleKey,
  isPdpPage,
  isCheckoutPage,
  isCartPage,
  isOrderSuccessPage,
  isErrorPage,
} from './shared.js';

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
function isHomePage() {
  const segments = window.location.pathname.split('/').filter(Boolean);
  return segments.length <= 2;
}

/**
 * @returns {boolean}
 */
function isContactUsPage() {
  return /\/contact-us\/?$/.test(window.location.pathname);
}

/**
 * @returns {boolean}
 */
function isAccountPage() {
  return /\/account\/?/.test(window.location.pathname);
}

/**
 * @returns {boolean}
 */
function isAccountLoginPage() {
  return /\/account\/login\/?$/.test(window.location.pathname)
    || /\/login\/?$/.test(window.location.pathname);
}

/**
 * @returns {boolean}
 */
function isAccountCreatePage() {
  return /\/create-account\/?$/.test(window.location.pathname);
}

/**
 * @returns {boolean}
 */
function isRegistrationThankYouPage() {
  return /\/create-account-thankyou\/?$/.test(window.location.pathname);
}

/**
 * Category/PLP pages use `/shop/{slug}` on Edge (may not mount the plp block).
 * @returns {boolean}
 */
function isShopCategoryPage() {
  const { pathname } = window.location;
  return /\/shop\/[^/]+\/?$/.test(pathname) && !pathname.includes('/commercial/');
}

/**
 * PDP pages live under `/products/{slug}` (excludes modals and tooling paths).
 * @returns {boolean}
 */
function isProductsPathPage() {
  const { pathname } = window.location;
  if (!/\/products\/[^/]+\/?$/.test(pathname)) return false;
  const slug = pathname.split('/').filter(Boolean).pop() || '';
  return !['modals', 'operations-log'].includes(slug) && !slug.startsWith('media_');
}

/**
 * @returns {boolean}
 */
function isSearchResultsPage() {
  return /\/search-result\/?$/.test(window.location.pathname);
}

/**
 * @returns {boolean}
 */
function isPlpPage() {
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

let pageTypeGuardIntervalId = 0;

/**
 * Re-apply pageType briefly after Launch loads (Launch may overwrite asynchronously).
 */
export function guardDigitalDataPageType() {
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
