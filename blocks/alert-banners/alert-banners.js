import { parseAlertBanners, findBestAlertBanner, currentPastFuture } from '../../scripts/scripts.js';

/**
 * Formats a Date object into a short date-time string format (M/D HHam/pm).
 * @param {Date} date - The date to format
 * @returns {string} Formatted date string, or "Invalid Date"
 */
function formatShortDateTime(date) {
  if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) {
    return 'Invalid Date';
  }

  const month = date.getMonth() + 1; // getMonth() returns 0-11
  const day = date.getDate();
  let hours = date.getHours();
  const minutes = date.getMinutes();

  // Convert to 12-hour format
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours %= 12;
  if (hours === 0) hours = 12; // 12am/12pm instead of 0am/0pm

  // Format time - only show minutes if not :00
  let timeStr = `${hours}${ampm}`;
  if (minutes !== 0) {
    const paddedMinutes = minutes.toString().padStart(2, '0');
    timeStr = `${hours}:${paddedMinutes}${ampm}`;
  }

  return `${month}/${day} ${timeStr}`;
}

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
    if (banner.valid) {
      row.classList.add('alert-banners-valid');
    } else {
      row.classList.add('alert-banners-invalid');
    }
    row.classList.add(`alert-banners-${currentPastFuture(banner.start, banner.end, date)}`);

    list.appendChild(row);
    row.innerHTML = `
      <div class="alert-banners-date">${formatShortDateTime(banner.start)} - ${formatShortDateTime(banner.end)}</div>
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
  const bestBanner = findBestAlertBanner(banners);
  const bannersContainer = document.createElement('div');
  bannersContainer.append(createParsedBanners(banners, bestBanner));
  block.append(bannersContainer);

  const div = document.createElement('div');
  div.classList.add('alert-banners-datetime');
  div.textContent = 'Simulate Date/Time (local)';
  const dtl = document.createElement('input');
  dtl.type = 'datetime-local';
  dtl.value = new Date().toISOString();
  dtl.id = 'alert-banners-party-time';
  div.append(dtl);
  dtl.addEventListener('input', (e) => {
    const simDate = new Date(e.target.value);
    bannersContainer.textContent = '';
    const simBestBanner = findBestAlertBanner(banners, simDate);
    bannersContainer.append(createParsedBanners(banners, simBestBanner, simDate));
  });
  block.append(div);
}
