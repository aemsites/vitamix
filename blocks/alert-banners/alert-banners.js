import {
  parseAlertBanners,
  findCurrentScheduledItem,
  currentPastFuture,
  formatShortDateTime,
  formatDuration,
  createTimeline,
} from '../../scripts/scripts.js';

/**
 * Creates a structured list of parsed banner elements with appropriate CSS classes and content.
 * @param {Array<Object>} banners - Array of banner objects
 * @param {Object|null} [bestBanner=null] - The optimal banner to highlight with special styling
 * @param {Date} [date=new Date()] - Reference date for determining banner status
 * @returns {HTMLUListElement} Unordered list element containing all banner items
 */
function createParsedBanners(banners, bestBanner = null, date = new Date()) {
  const list = document.createElement('ul');
  banners.forEach((banner) => {
    const row = document.createElement('li');
    if (bestBanner === banner) {
      row.classList.add('alert-banners-selected');
    }

    // Calculate duration and check if it's negative
    const duration = banner.end - banner.start;
    const isNegativeDuration = duration < 0;

    if (banner.valid && !isNegativeDuration) {
      row.classList.add('alert-banners-valid');
    } else {
      row.classList.add('alert-banners-invalid');
    }
    row.classList.add(`alert-banners-${currentPastFuture(banner.start, banner.end, date)}`);

    list.appendChild(row);
    row.innerHTML = `
      <div class="alert-banners-date">${formatShortDateTime(banner.start)} - ${formatShortDateTime(banner.end)} [${formatDuration(duration)}]</div>
      <div class="alert-banners-content">${banner.content.innerHTML}</div>
      <div class="alert-banners-color">${banner.color}</div>
      `;
  });
  return list;
}

/**
 * Parses banner data, finds best banner, and replaces block with formatted list of all banners.
 * @param {HTMLElement} block - The DOM element containing the alert banners block to be decorated
 * @returns {Promise<void>} Promise that resolves when the block decoration is complete
 */
export default async function decorateAlertBanners(block) {
  const banners = parseAlertBanners(block);
  block.innerHTML = '';

  // Preview banner element (reused, updated by timeline during drag)
  const preview = document.createElement('aside');
  preview.classList.add('nav-banner', 'alert-banners-preview');

  // Timeline view
  const timelineContainer = document.createElement('div');
  timelineContainer.classList.add('alert-banners-timeline-container');

  // List view
  const bannersContainer = document.createElement('div');

  // Date/time simulator
  const div = document.createElement('div');
  div.classList.add('alert-banners-datetime');
  div.textContent = 'Simulate Date/Time (local)';
  const dtl = document.createElement('input');
  dtl.type = 'datetime-local';
  dtl.value = new Date().toISOString().slice(0, 16);
  dtl.id = 'alert-banners-party-time';
  div.append(dtl);

  // Track current preview banner to avoid unnecessary DOM updates
  let currentPreviewBanner = null;

  // Helper to update preview (skips if banner hasn't changed)
  const setPreview = (selectedBanner) => {
    if (selectedBanner === currentPreviewBanner) return;
    currentPreviewBanner = selectedBanner;

    preview.className = 'nav-banner alert-banners-preview';
    preview.style.backgroundColor = '';
    preview.textContent = '';

    if (selectedBanner && selectedBanner.content) {
      const p = document.createElement('p');
      const contentClone = selectedBanner.content.cloneNode(true);
      p.append(...contentClone.childNodes);
      preview.append(p);

      if (selectedBanner.color) {
        preview.style.backgroundColor = `var(--color-${selectedBanner.color})`;
        const darkColors = ['charcoal', 'black', 'dark', 'red', 'blue', 'green', 'xanadu', 'moss'];
        const textClass = darkColors.some((c) => selectedBanner.color.includes(c)) ? 'light' : 'dark';
        preview.classList.add(`nav-banner-${textClass}`);
      }
    } else {
      preview.classList.add('alert-banners-preview-empty');
      preview.textContent = 'No banner selected for this date';
    }
  };

  // Cache list items for fast updates during drag
  let listItems = [];

  // Update list item classes during drag
  const updateListColors = (newDate, newBestBanner) => {
    listItems.forEach((item, index) => {
      const banner = banners[index];
      if (!banner) return;

      const state = currentPastFuture(banner.start, banner.end, newDate);
      item.classList.toggle('alert-banners-past', state === 'past');
      item.classList.toggle('alert-banners-current', state === 'current');
      item.classList.toggle('alert-banners-future', state === 'future');
      item.classList.toggle('alert-banners-selected', banner === newBestBanner);
    });
  };

  // Callback for drag - updates input and list
  const onDrag = (newDate, newBestBanner) => {
    dtl.value = newDate.toISOString().slice(0, 16);
    updateListColors(newDate, newBestBanner);
  };

  // Full update function (used on initial load and when input changes)
  const updateViews = (simDate) => {
    const simBestBanner = findCurrentScheduledItem(banners, simDate);

    // Update datetime input
    dtl.value = simDate.toISOString().slice(0, 16);

    // Update preview
    setPreview(simBestBanner);

    // Update timeline
    timelineContainer.textContent = '';
    timelineContainer.append(createTimeline(banners, simBestBanner, simDate, onDrag, setPreview));

    // Update list and cache items
    bannersContainer.textContent = '';
    bannersContainer.append(createParsedBanners(banners, simBestBanner, simDate));
    listItems = [...bannersContainer.querySelectorAll('li')];
  };

  // Initial render
  updateViews(new Date());

  // Listen for manual input changes - just call updateViews
  dtl.addEventListener('input', (e) => {
    updateViews(new Date(e.target.value));
  });

  block.append(preview);
  block.append(timelineContainer);
  block.append(bannersContainer);
  block.append(div);
}
