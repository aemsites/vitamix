import {
  parseAlertBanners,
  findCurrentAlertBanners,
  renderAlertBanners,
  currentPastFuture,
  formatShortDateTime,
  formatDuration,
  createTimeline,
} from '../../scripts/scripts.js';

/**
 * Creates a structured list of parsed banner elements with appropriate CSS classes and content.
 * @param {Array<Object>} banners - Array of banner objects
 * @param {Array<Object>} [selectedBanners=[]] - The active banners to highlight
 * @param {Date} [date=new Date()] - Reference date for determining banner status
 * @returns {HTMLUListElement} Unordered list element containing all banner items
 */
function createParsedBanners(banners, selectedBanners = [], date = new Date()) {
  const list = document.createElement('ul');
  banners.forEach((banner) => {
    const row = document.createElement('li');
    if (selectedBanners.includes(banner)) {
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
    const priority = document.createElement('div');
    priority.className = 'alert-banners-priority';
    priority.textContent = `Priority: ${banner.priority ?? 'Not set'}`;
    row.append(priority);
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
  let currentPreviewBanners = [];

  // Helper to update preview (skips if banner hasn't changed)
  const setPreview = (selectedBanners) => {
    if (preview.childNodes.length && selectedBanners.length === currentPreviewBanners.length
      && selectedBanners.every((banner, index) => banner === currentPreviewBanners[index])) return;
    currentPreviewBanners = selectedBanners;

    preview.className = 'nav-banner alert-banners-preview';
    renderAlertBanners(preview, selectedBanners);

    if (!selectedBanners.length) {
      preview.classList.add('alert-banners-preview-empty');
      preview.textContent = 'No banner selected for this date';
    }
  };

  // Cache list items for fast updates during drag
  let listItems = [];

  // Update list item classes during drag
  const updateListColors = (newDate, selectedBanners) => {
    listItems.forEach((item, index) => {
      const banner = banners[index];
      if (!banner) return;

      const state = currentPastFuture(banner.start, banner.end, newDate);
      item.classList.toggle('alert-banners-past', state === 'past');
      item.classList.toggle('alert-banners-current', state === 'current');
      item.classList.toggle('alert-banners-future', state === 'future');
      item.classList.toggle('alert-banners-selected', selectedBanners.includes(banner));
    });
  };

  // Callback for drag - updates input and list
  const onDrag = (newDate) => {
    dtl.value = newDate.toISOString().slice(0, 16);
    const selectedBanners = findCurrentAlertBanners(banners, newDate);
    updateListColors(newDate, selectedBanners);
    setPreview(selectedBanners);
  };

  // Full update function (used on initial load and when input changes)
  const updateViews = (simDate) => {
    const selectedBanners = findCurrentAlertBanners(banners, simDate);
    const simBestBanner = selectedBanners[0] || null;

    // Update datetime input
    dtl.value = simDate.toISOString().slice(0, 16);

    // Update preview
    setPreview(selectedBanners);

    // Update timeline
    timelineContainer.textContent = '';
    timelineContainer.append(createTimeline(
      banners,
      simBestBanner,
      simDate,
      onDrag,
      null,
      (items, date) => findCurrentAlertBanners(items, date)[0] || null,
    ));

    // Update list and cache items
    bannersContainer.textContent = '';
    bannersContainer.append(createParsedBanners(banners, selectedBanners, simDate));
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
