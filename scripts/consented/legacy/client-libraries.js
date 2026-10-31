import loadAnalyticsClientLibrary from './analytics.js';
import loadBaseClientLibrary from './base.js';
import loadChatbotClientLibrary from './chatbot.js';
import loadContainerClientLibrary from './container.js';
import loadLibraryClientLibrary from './library.js';
import { getDeploymentEnv } from '../instrumentation/index.js';

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

  loadChatbotClientLibrary();
  loadContainerClientLibrary();
  await loadLibraryClientLibrary();
  await loadAnalyticsClientLibrary();
  loadBaseClientLibrary();

  return currentEnvironment;
}
