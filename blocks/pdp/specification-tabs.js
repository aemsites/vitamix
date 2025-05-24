import { createOptimizedPicture } from '../../scripts/aem.js';

/*
 * Creates the tab buttons for the specifications section.
 * @param {Array<{id: string, label: string}>} tabs - Array of tab objects with id and label.
 * @returns {HTMLDivElement} The container with tab buttons.
 */
function createTabButtons(tabs) {
  const tabButtons = document.createElement('div');
  tabButtons.classList.add('tabs');

  tabs.forEach((tab) => {
    const button = document.createElement('button');
    button.classList.add('tab');
    button.setAttribute('data-target', tab.id);
    button.textContent = tab.label;
    tabButtons.appendChild(button);
  });

  return tabButtons;
}

/**
 * Creates the content for the Specifications tab.
 * @param {HTMLElement} specifications - The specifications content to clone.
 * @returns {HTMLDivElement} The specifications content container.
 */
function createSpecificationsContent(specifications) {
  const container = document.createElement('div');
  container.classList.add('specifications-container');

  const heading = document.createElement('h3');
  heading.textContent = 'Product Specifications';
  container.append(heading, specifications.cloneNode(true));
  return container;
}

/**
 * Creates the content for the Warranty tab.
 * @returns {HTMLDivElement} The warranty content container.
 */
/**
 * Creates the content for the Warranty tab using the provided warranty text.
 * @param {string} warrantyText - The warranty text to display.
 * @returns {HTMLDivElement} The warranty content container.
 */
// eslint-disable-next-line no-unused-vars
function createWarrantyContent(warrantyText) {
  // TOOO: Assumes 10-year warranty
  const container = document.createElement('div');
  container.classList.add('warranty-container');

  const warrantyImage = createOptimizedPicture('/blocks/pdp/10-year-warranty.png', '10-Year Warranty', false);
  warrantyImage.classList.add('warranty-icon');

  const details = document.createElement('div');
  details.classList.add('warranty-details');

  const title = document.createElement('h3');
  title.classList.add('warranty-title');
  title.textContent = '10-Year Full Warranty';

  const paragraph = document.createElement('p');
  paragraph.classList.add('warranty-text');
  paragraph.textContent = 'We stand behind the quality of our machines with full warranties, covering parts, performance, labor, and two-way shipping at no cost to you.';

  const link = document.createElement('a');
  link.href = '#';
  link.textContent = 'Read the Warranty.';
  link.classList.add('warranty-link');

  details.append(title, paragraph, link);
  container.append(warrantyImage, details);
  return container;
}

/**
 * Creates the content for the Resources tab.
 * @returns {HTMLDivElement} The resources content container.
 */
/**
 * Creates the content for the Resources tab using the provided resources data.
 * @param {Array<Object>} resources - The resources array containing name, content-type, and URL.
 * @returns {HTMLDivElement} The resources content container.
 */
function createResourcesContent(resources) {
  const container = document.createElement('div');
  container.classList.add('resources-container');

  const resourceTitle = document.createElement('h3');
  resourceTitle.textContent = 'Ascent® X2 Resources';

  resources.forEach((resource) => {
    if (resource['content-type'] === 'youtube') return;

    const resourceItem = document.createElement('div');
    resourceItem.classList.add('resource-item');

    const resourceIcon = document.createElement('span');
    resourceIcon.textContent = resource['content-type'] === 'application/pdf' ? '📄' : '🔗';

    const resourceLink = document.createElement('a');
    resourceLink.href = resource.url;
    resourceLink.textContent = resource.name;

    const resourceDetails = document.createElement('p');
    resourceDetails.textContent = resource['content-type'] === 'application/pdf' ? 'PDF' : '';

    resourceItem.append(resourceIcon, resourceLink, resourceDetails);
    container.appendChild(resourceItem);
  });

  const questions = document.createElement('div');
  questions.classList.add('questions-container');
  questions.innerHTML = `
    <h3>Have a question?</h3>
    <p>Contact customer service!</p>
    <a href="mailto:service@vitamix.com">service@vitamix.com</a>
    <p>1.800.848.2649</p>
  `;

  container.append(questions);

  return container;
}

/**
 * Creates the tab content based on the provided tab object and JSON-LD data.
 * @param {Object} tab - The tab object with id and label.
 * @param {HTMLElement} specifications - The specifications content to clone.
 * @param {Object} data - The JSON-LD object containing custom data.
 * @returns {HTMLDivElement} The content container for the tab.
 */
function createTabContent(tab, specifications, data) {
  const content = document.createElement('div');
  content.classList.add('tab-content');
  content.id = tab.id;

  const { custom } = data;
  switch (tab.id) {
    case 'specifications':
      if (specifications) {
        content.appendChild(createSpecificationsContent(specifications));
      }
      break;
    case 'warranty':
      if (custom.warranty) {
        content.appendChild(createWarrantyContent(custom.warranty));
      }
      break;
    case 'resources':
      if (custom.resources) {
        content.appendChild(createResourcesContent(custom.resources));
      }
      break;
    default:
      break;
  }

  return content;
}

/**
 * Attaches click event listeners to the tabs for switching content.
 * @param {HTMLElement} container - The container with tab buttons and content.
 */
function attachTabListeners(container) {
  const tabs = container.querySelectorAll('.tab');
  const contents = container.querySelectorAll('.tab-content');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      contents.forEach((c) => c.classList.remove('active'));

      tab.classList.add('active');
      const target = tab.getAttribute('data-target');
      const targetContent = container.querySelector(`#${target}`);
      if (targetContent) {
        targetContent.classList.add('active');
      }
    });
  });
}

/**
 * Initializes the first tab as active upon rendering.
 * @param {HTMLElement} container - The container with tab buttons and content.
 */
function initializeTabs(container) {
  const tabs = container.querySelectorAll('.tab');
  const contents = container.querySelectorAll('.tab-content');

  if (tabs.length > 0) {
    tabs[0].classList.add('active');
    contents[0].classList.add('active');
  }
}

/**
 * Renders the specifications section of the PDP block.
 * @param {Element} specifications - The specifications content to clone.
 * @param {Element} parent - The parent element to append the specifications to.
 * @param {Object} data - The JSON-LD object containing custom data.
 * @returns {Element} The specifications container element
 */
export default function renderSpecs(specifications, parent, data) {
  const tabs = [
    { id: 'specifications', label: 'Specifications', show: !!specifications },
    { id: 'warranty', label: 'Warranty', show: !!data.custom.warranty },
    { id: 'resources', label: 'Resources', show: !!data.custom.resources },
  ].filter((tab) => tab.show);

  // if there are no tabs, don't render anything
  if (tabs.length === 0) {
    return;
  }

  const specsContainer = document.createElement('div');
  specsContainer.classList.add('tabs-container');

  const tabButtons = createTabButtons(tabs);
  specsContainer.appendChild(tabButtons);

  const contents = document.createElement('div');
  contents.classList.add('tab-contents');

  tabs.forEach((tab) => {
    const content = createTabContent(tab, specifications, data);
    contents.appendChild(content);
  });

  specsContainer.appendChild(contents);
  parent.append(specsContainer);

  attachTabListeners(specsContainer);
  initializeTabs(specsContainer);
}
