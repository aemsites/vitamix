/**
 * Generative Search Block
 * Integrates with Cloudflare Worker API to generate dynamic content based on user queries
 */

// API Configuration
// TODO: Update this URL with your deployed Cloudflare Worker URL
const API_BASE_URL = process.env.GEN_API_URL || 'https://vitamix-gen-service.workers.dev';

/**
 * Creates the search interface
 * @param {HTMLElement} block - The block element
 */
function createSearchInterface(block) {
  const searchContainer = document.createElement('div');
  searchContainer.className = 'search-container';

  searchContainer.innerHTML = `
    <form class="search-form">
      <input
        type="text"
        class="search-input"
        placeholder="Ask me anything about Vitamix products..."
        aria-label="Search query"
        required
      />
      <button type="submit" class="search-button">
        Generate
      </button>
    </form>
  `;

  return searchContainer;
}

/**
 * Creates the results container
 * @returns {HTMLElement} Results container element
 */
function createResultsContainer() {
  const resultsContainer = document.createElement('div');
  resultsContainer.className = 'results-container hidden';

  resultsContainer.innerHTML = `
    <div class="status-message hidden"></div>
    <div class="generation-events hidden"></div>
    <div class="content-preview hidden"></div>
  `;

  return resultsContainer;
}

/**
 * Shows a status message
 * @param {HTMLElement} container - Results container
 * @param {string} message - Status message
 * @param {string} type - Message type (loading, error, success)
 */
function showStatus(container, message, type = 'loading') {
  const statusEl = container.querySelector('.status-message');
  statusEl.className = `status-message ${type}`;

  if (type === 'loading') {
    statusEl.innerHTML = `<span class="spinner"></span>${message}`;
  } else {
    statusEl.textContent = message;
  }

  statusEl.classList.remove('hidden');
}

/**
 * Hides the status message
 * @param {HTMLElement} container - Results container
 */
function hideStatus(container) {
  const statusEl = container.querySelector('.status-message');
  statusEl.classList.add('hidden');
}

/**
 * Adds a generation event to the events log
 * @param {HTMLElement} container - Results container
 * @param {string} eventType - Type of event
 * @param {object} eventData - Event data
 */
function addGenerationEvent(container, eventType, eventData) {
  const eventsEl = container.querySelector('.generation-events');
  eventsEl.classList.remove('hidden');

  const eventItem = document.createElement('div');
  eventItem.className = 'event-item';

  // Format event data based on type
  let eventText = '';
  switch (eventType) {
    case 'intent':
      eventText = `<strong>Intent detected:</strong> ${eventData.intent || 'Processing...'}`;
      break;
    case 'classification':
      eventText = `<strong>Category:</strong> ${eventData.category || 'Classifying...'}`;
      break;
    case 'blocks':
      eventText = `<strong>Blocks selected:</strong> ${eventData.blocks?.join(', ') || 'Selecting...'}`;
      break;
    case 'content':
      eventText = `<strong>Content generated:</strong> ${eventData.blockType || 'Generating...'}`;
      break;
    case 'complete':
      eventText = `<strong>Generation complete</strong> - Page ready`;
      break;
    default:
      eventText = `<strong>${eventType}:</strong> ${JSON.stringify(eventData)}`;
  }

  eventItem.innerHTML = eventText;
  eventsEl.appendChild(eventItem);

  // Auto-scroll to latest event
  eventItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Displays the generated content preview
 * @param {HTMLElement} container - Results container
 * @param {object} data - Generated content data
 */
function displayGeneratedContent(container, data) {
  const previewEl = container.querySelector('.content-preview');
  previewEl.classList.remove('hidden');

  const { slug, html, url } = data;

  previewEl.innerHTML = `
    <h3>Generated Page Preview</h3>
    <div class="preview-meta">
      <p><strong>URL:</strong> <code>${slug || 'N/A'}</code></p>
      ${url ? `<p><strong>Published:</strong> <a href="${url}" target="_blank">${url}</a></p>` : ''}
    </div>
    <div class="preview-content">
      ${html ? `<div class="html-preview">${html.substring(0, 500)}...</div>` : '<p>Content generated successfully</p>'}
    </div>
    <div class="preview-actions">
      ${url ? `<button class="button-primary" onclick="window.open('${url}', '_blank')">View Page</button>` : ''}
      <button class="button-secondary" onclick="location.reload()">New Search</button>
    </div>
  `;
}

/**
 * Handles Server-Sent Events (SSE) from the generation API
 * @param {string} query - User query
 * @param {HTMLElement} resultsContainer - Results container element
 */
async function handleGeneration(query, resultsContainer) {
  resultsContainer.classList.remove('hidden');

  // Clear previous results
  resultsContainer.querySelector('.generation-events').innerHTML = '';
  resultsContainer.querySelector('.content-preview').classList.add('hidden');

  showStatus(resultsContainer, 'Starting generation...', 'loading');

  try {
    // Build API URL with query parameter
    const apiUrl = new URL('/generate', API_BASE_URL);
    apiUrl.searchParams.set('q', query);

    // Create EventSource for SSE
    const eventSource = new EventSource(apiUrl.toString());

    eventSource.addEventListener('intent', (event) => {
      const data = JSON.parse(event.data);
      addGenerationEvent(resultsContainer, 'intent', data);
      showStatus(resultsContainer, 'Analyzing your request...', 'loading');
    });

    eventSource.addEventListener('classification', (event) => {
      const data = JSON.parse(event.data);
      addGenerationEvent(resultsContainer, 'classification', data);
      showStatus(resultsContainer, 'Determining content type...', 'loading');
    });

    eventSource.addEventListener('blocks', (event) => {
      const data = JSON.parse(event.data);
      addGenerationEvent(resultsContainer, 'blocks', data);
      showStatus(resultsContainer, 'Selecting page components...', 'loading');
    });

    eventSource.addEventListener('content', (event) => {
      const data = JSON.parse(event.data);
      addGenerationEvent(resultsContainer, 'content', data);
      showStatus(resultsContainer, `Generating ${data.blockType || 'content'}...`, 'loading');
    });

    eventSource.addEventListener('complete', (event) => {
      const data = JSON.parse(event.data);
      addGenerationEvent(resultsContainer, 'complete', data);
      hideStatus(resultsContainer);
      displayGeneratedContent(resultsContainer, data);
      eventSource.close();
    });

    eventSource.addEventListener('error', (event) => {
      let errorMsg = 'Generation failed';
      try {
        const data = JSON.parse(event.data);
        errorMsg = data.message || errorMsg;
      } catch (e) {
        // Error parsing error message
      }

      showStatus(resultsContainer, errorMsg, 'error');
      eventSource.close();
    });

    eventSource.onerror = () => {
      showStatus(resultsContainer, 'Connection error. Please try again.', 'error');
      eventSource.close();
    };

  } catch (error) {
    showStatus(resultsContainer, `Error: ${error.message}`, 'error');
  }
}

/**
 * Decorates the generative search block
 * @param {HTMLElement} block - The block element
 */
export default async function decorate(block) {
  // Get optional title from block content BEFORE clearing
  const title = block.textContent.trim() || 'AI-Powered Content Generator';

  // Clear existing content
  block.innerHTML = '';

  // Create title
  const titleEl = document.createElement('h2');
  titleEl.textContent = title;

  // Create search interface
  const searchContainer = createSearchInterface(block);

  // Create results container
  const resultsContainer = createResultsContainer();

  // Assemble block
  block.appendChild(titleEl);
  block.appendChild(searchContainer);
  block.appendChild(resultsContainer);

  // Handle form submission
  const form = searchContainer.querySelector('.search-form');
  const input = searchContainer.querySelector('.search-input');
  const button = searchContainer.querySelector('.search-button');

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const query = input.value.trim();
    if (!query) return;

    // Disable form during generation
    button.disabled = true;
    input.disabled = true;

    // Start generation
    handleGeneration(query, resultsContainer).finally(() => {
      // Re-enable form
      button.disabled = false;
      input.disabled = false;
    });
  });
}
