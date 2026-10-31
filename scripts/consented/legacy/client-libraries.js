import { loadScript } from '../../aem.js';
import {
  configureAnalyticsTrackingServers,
  getDeploymentEnv,
} from '../instrumentation/index.js';

/**
 * Load legacy AEM client libraries vendored in this directory.
 * @returns {Promise<HTMLElement>}
 */
export default async function loadLegacyClientLibraries() {
  window.config = {
    POOLID: 'us-east-1:d54ecd7d-db6e-456d-bf35-d26346122a63',
    REGION: 'us-east-1',
    BOTID: 'JBPXLTC0LW',
    BOTALIASID: 'HUKYDI5LGI',
  };

  window.adobeDataLayer = window.adobeDataLayer || [];

  const currentEnvironment = document.createElement('div');
  currentEnvironment.classList.add('currentEnvironment');
  currentEnvironment.dataset.deploymentEnv = getDeploymentEnv();
  currentEnvironment.dataset.templatePath = '/conf/vitamix/settings/wcm/templates/default-page';
  document.body.appendChild(currentEnvironment);

  const chatbot = document.createElement('div');
  chatbot.id = 'chatbot-container';
  document.body.appendChild(chatbot);

  if (window.location.hostname !== 'uat.vitamix.com') {
    loadScript(new URL('./chatbot.min.js', import.meta.url).href);
  } else {
    loadScript(new URL('./chatbot-uat.min.js', import.meta.url).href);
  }
  loadScript(new URL('./container.min.js', import.meta.url).href);

  await loadScript(new URL('./library.min.js', import.meta.url).href);
  await loadScript(new URL('./analytics.min.js', import.meta.url).href);
  configureAnalyticsTrackingServers();
  loadScript(new URL('./base.min.js', import.meta.url).href);

  return currentEnvironment;
}
