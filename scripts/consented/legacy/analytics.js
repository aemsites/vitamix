import { loadScript } from '../../aem.js';
import { configureAnalyticsTrackingServers } from '../instrumentation/index.js';

export default async function loadAnalyticsClientLibrary() {
  await loadScript('https://www.vitamix.com/etc.clientlibs/vitamix/clientlibs/clientlib-analytics.lc-26814920488a848ff91c1f425646d010-lc.min.js');
  configureAnalyticsTrackingServers();
}
