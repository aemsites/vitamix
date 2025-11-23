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
  container.append(specifications);
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
function createWarrantyContent(warranty, customWarranty) {
  const div = document.createElement('div');
  div.innerHTML = customWarranty.innerHTML;
  const p = div.querySelector('p');
  const lines = p.innerHTML.split('<br>');

  const titleText = div.querySelector('h3')?.textContent;

  const text = lines.join('<br>').trim();

  const titleElement = document.createElement('h3');
  titleElement.classList.add('warranty-title');

  // TOOO: Assumes 10-year warranty
  const container = document.createElement('div');
  container.classList.add('warranty-container');

  if (warranty && warranty.sku) {
    const warrantyImage = createOptimizedPicture(`/blocks/pdp/${warranty.sku}.png`, warranty.name, false);
    warrantyImage.classList.add('warranty-icon');
    container.append(warrantyImage);
  }

  const details = document.createElement('div');
  details.classList.add('warranty-details');

  const title = document.createElement('h3');
  title.classList.add('warranty-title');
  title.textContent = titleText;

  const paragraph = document.createElement('p');
  paragraph.classList.add('warranty-text');
  paragraph.innerHTML = text;

  details.append(title, paragraph);
  container.append(details);
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
function createResourcesContent(resources, productName) {
  const container = document.createElement('div');
  container.classList.add('resources-container');

  if (resources && resources.length > 0) {
    const resourceTitle = document.createElement('h3');
    resourceTitle.textContent = `${productName} Resources`;
    container.append(resourceTitle);

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
  }

  const questions = document.createElement('div');
  questions.classList.add('pdp-questions-container');
  questions.innerHTML = `
    <h3>Have a question?</h3>
    <p>Contact customer service!</p>
    <a href="mailto:service@vitamix.com"><img class="icon" src="/icons/email.svg" alt="Email">service@vitamix.com</a>
    <a href="tel:18008482649"><img class="icon" src="/icons/phone.svg" alt="Phone">1.800.848.2649</a>
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
function createTabContent(tab, specifications, standardWarranty, custom, productName) {
  const { warranty } = window;
  const content = document.createElement('div');
  content.classList.add('tab-content');
  content.id = tab.id;

  switch (tab.id) {
    case 'specifications':
      if (specifications) {
        content.appendChild(createSpecificationsContent(specifications));
      }
      break;
    case 'warranty':
      if (warranty) {
        content.appendChild(createWarrantyContent(standardWarranty, warranty));
      }
      break;
    case 'resources':
      content.appendChild(createResourcesContent(custom.resources, productName));
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
export default function renderSpecs(specifications, custom, productName) {
  const { options } = custom;
  const { warranty } = window;
  const standardWarranty = options?.find((option) => option.name.includes('Standard Warranty'));
  const tabs = [
    { id: 'specifications', label: 'Specifications', show: !!specifications },
    { id: 'warranty', label: 'Warranty', show: warranty },
    { id: 'resources', label: 'Resources', show: true },
  ].filter((tab) => tab.show);

  // if there are no tabs, don't render anything
  if (tabs.length === 0) {
    return null;
  }

  const specsContainer = document.createElement('div');
  specsContainer.classList.add('tabs-container');

  const tabButtons = createTabButtons(tabs);
  specsContainer.appendChild(tabButtons);

  const contents = document.createElement('div');
  contents.classList.add('tab-contents');

  tabs.forEach((tab) => {
    const content = createTabContent(tab, specifications, standardWarranty, custom, productName);
    contents.appendChild(content);
  });

  specsContainer.appendChild(contents);

  attachTabListeners(specsContainer);
  initializeTabs(specsContainer);

  return specsContainer;
}
