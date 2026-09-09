/**
 * Compatibility entry point for browser-cached pre-refactor consent bundles.
 *
 * Keep this module at its original URL while cached versions of consented.js
 * may still import it. New code imports instrumentation/index.js directly.
 */
export {
  configureAnalyticsTrackingServers,
  ensureAnalyticsTrackingConfigured,
  getDeploymentEnv,
  initDigitalDataPage,
  initInstrumentation,
  syncDigitalDataPageContext,
} from './instrumentation/index.js';
