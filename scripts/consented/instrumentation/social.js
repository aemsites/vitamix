import { hasMarketingConsent, debugLog } from './shared.js';
import { whenSatelliteReady, triggerLaunchEvent } from './adobe-runtime.js';

/**
 * Register social media analytics event listeners using event delegation.
 *
 * EDS blocks (footer, recipe, article-info) are decorated asynchronously,
 * so we delegate from document rather than querying elements at load time.
 *
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
let socialEventsRegistered = false;

/** Reset social events registration state (for unit tests). */
export function resetSocialEventsState() {
  socialEventsRegistered = false;
}

export function trackSocialEvents() {
  if (socialEventsRegistered) return;
  socialEventsRegistered = true;

  whenSatelliteReady(() => {
    document.addEventListener('click', async (e) => {
      if (!hasMarketingConsent()) return;

      // 1. socialMediaFollow — footer "Follow Us" social icon links
      //    AEM: .omni-socialmedia-link a
      //    EDS: .footer-social li.button-wrapper > a.button
      if (e.target.closest('.footer-social a.button')) {
        await triggerLaunchEvent('socialMediaFollow', { element: e.target });
        debugLog('Adobe Analytics socialMediaFollow fired');
        return;
      }

      // 2. productSocialShare — recipe block social share popup buttons
      //    AEM: .omni-socialmedia-share a
      //    EDS: .recipe-share-popup button
      if (e.target.closest('.recipe-share-popup button')) {
        await triggerLaunchEvent('productSocialShare', { element: e.target });
        debugLog('Adobe Analytics productSocialShare fired');
        return;
      }

      // 3. articleSocialShare — article-info block share buttons
      //    AEM: #SocialMediaButtons li
      //    EDS: .article-info ul.share li button
      if (e.target.closest('.article-info ul.share button')) {
        await triggerLaunchEvent('articleSocialShare', { element: e.target });
        debugLog('Adobe Analytics articleSocialShare fired');
      }
    });

    debugLog('Adobe Analytics social event tracking registered');
  }, 'socialEvents');
}
