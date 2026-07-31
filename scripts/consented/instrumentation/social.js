import { hasMarketingConsent, debugLog } from './shared.js';
import { whenSatelliteReady, triggerLaunchEvent } from './adobe-runtime.js';

/**
 * Mirrors the AEM jQuery listeners:
 *   - $(".omni-socialmedia-link a").click → _satellite.track('socialMediaFollow')
 *   - $(".omni-socialmedia-share a").click → _satellite.track('productSocialShare')
 *   - $("#SocialMediaButtons li").click    → _satellite.track('articleSocialShare')
 *
 * EDS DOM equivalents:
 *   - socialMediaFollow  : .footer-social a.button  (footer social follow links)
 *   - productSocialShare : .recipe-share-popup button (recipe share popup buttons)
 *   - articleSocialShare : .article-info ul.share button (article-info share buttons)
 */
const SOCIAL_TARGETS = [
  { selector: '.footer-social a.button', eventName: 'socialMediaFollow' },
  { selector: '.recipe-share-popup button', eventName: 'productSocialShare' },
  { selector: '.article-info ul.share button', eventName: 'articleSocialShare' },
];

let socialEventsRegistered = false;

/** Reset social events registration state (for unit tests). */
export function resetSocialEventsState() {
  socialEventsRegistered = false;
}

/**
 * Attach a click listener directly to a social button/link and fire its Launch event.
 * Guarded by a dataset flag so a button already wired up is never attached twice.
 * @param {Element} element
 * @param {string} eventName
 */
function attachSocialClickTracking(element, eventName) {
  if (element.dataset.socialAnalyticsAttached) return;
  element.dataset.socialAnalyticsAttached = 'true';

  element.addEventListener('click', () => {
    if (!hasMarketingConsent()) return;

    whenSatelliteReady(async () => {
      await triggerLaunchEvent(eventName, { element });
      debugLog(`Adobe Analytics ${eventName} fired`);
    }, eventName);
  });
}

/** Scan the page for social targets and wire up any that aren't attached yet. */
function attachSocialTargets() {
  SOCIAL_TARGETS.forEach(({ selector, eventName }) => {
    document.querySelectorAll(selector).forEach((el) => attachSocialClickTracking(el, eventName));
  });
}

/**
 * Register direct click listeners on social buttons/links (no document-wide delegation).
 *
 * recipe/article-info are already decorated by the time this runs — loadLazy() awaits
 * loadSections(main) before consented.js loads — but the footer is not, since
 * loadFooter() is fire-and-forget. So after the initial scan, a MutationObserver watches
 * <footer> for its data-block-status="loaded" flip (the same "block decorated" signal
 * scripts/consented/adobe-target.js uses) and re-scans once the footer's social links exist.
 */
export function trackSocialEvents() {
  if (socialEventsRegistered) return;
  socialEventsRegistered = true;

  attachSocialTargets();

  const footer = document.querySelector('footer');
  if (footer) {
    const observer = new MutationObserver(() => attachSocialTargets());
    observer.observe(footer, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-block-status'],
    });
  }

  debugLog('Adobe Analytics social event tracking registered');
}
