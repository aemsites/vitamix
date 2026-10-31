import { loadScript } from '../../aem.js';
import {
  configureAnalyticsTrackingServers,
  getDeploymentEnv,
} from '../instrumentation/index.js';

/**
 * Load AEM-hosted client libraries that remain external to this codebase.
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
    loadScript('https://www.vitamix.com/etc.clientlibs/vitamix/clientlibs/clientlib-chatbot.lc-dd65664b07118365206104c205ccc20e-lc.min.js');
  } else {
    loadScript('https://uat.vitamix.com/etc.clientlibs/vitamix/clientlibs/clientlib-chatbot.lc-0714245cb61f874967f99f575877978f-lc.min.js');
  }
  loadScript('https://www.vitamix.com/etc.clientlibs/core/wcm/components/commons/site/clientlibs/container.lc-0a6aff292f5cc42142779cde92054524-lc.min.js');

  await loadScript('https://www.vitamix.com/etc.clientlibs/vitamix/clientlibs/clientlib-library.lc-259cf15444c5fe1f89e5c54df7b6e1e9-lc.min.js');
  await loadScript('https://www.vitamix.com/etc.clientlibs/vitamix/clientlibs/clientlib-analytics.lc-26814920488a848ff91c1f425646d010-lc.min.js');
  configureAnalyticsTrackingServers();
  loadScript('https://www.vitamix.com/etc.clientlibs/vitamix/clientlibs/clientlib-base.lc-daf5b8dac79e9cf7cb1c0b30d8372e7a-lc.min.js');

  return currentEnvironment;
}
