import { parseAlertBanners, findBestAlertBanner, currentPastFuture } from '../../scripts/scripts.js';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Formats a Date object into a short date-time string format (M/D HHam/pm).
 * @param {Date} date - The date to format
 * @returns {string} Formatted date string, or "Invalid Date" or "Open"
 */
function formatShortDateTime(date) {
  if (date === null) {
    return 'Open';
  }
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
 * Formats a duration in milliseconds into a human-readable string.
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration string (e.g., "3d 2h 15m" or "-1d 5h 30m")
 */
function formatDuration(ms) {
  const negative = ms < 0;
  const absMs = Math.abs(ms);

  const totalMinutes = Math.floor(absMs / (1000 * 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

  const result = parts.join(' ');
  return negative ? `-${result}` : result;
}

/**
 * Creates a timeline visualization showing banners across 6 months.
 * Shows 3 months before and 3 months after the current date.
 * @param {Array<Object>} banners - Array of banner objects
 * @param {Object|null} [bestBanner=null] - The optimal banner to highlight
 * @param {Date} [date=new Date()] - Reference date for the "now" marker
 * @param {Function} [onDateChange=null] - Callback when date is changed via drag
 * @returns {HTMLElement} Timeline container element
 */
function createTimeline(banners, bestBanner = null, date = new Date(), onDateChange = null) {
  const container = document.createElement('div');
  container.classList.add('alert-banners-timeline');

  // Calculate 6-month window: 3 months before and 3 months after current date
  const currentMonth = date.getMonth();
  const currentYear = date.getFullYear();

  // Start 3 months before (beginning of that month)
  let startMonth = currentMonth - 3;
  let startYear = currentYear;
  if (startMonth < 0) {
    startMonth += 12;
    startYear -= 1;
  }
  const rangeStart = new Date(startYear, startMonth, 1);

  // End 3 months after (end of that month)
  let endMonth = currentMonth + 3;
  let endYear = currentYear;
  if (endMonth > 11) {
    endMonth -= 12;
    endYear += 1;
  }
  // Get last day of the end month
  const rangeEnd = new Date(endYear, endMonth + 1, 0, 23, 59, 59);

  const rangeDuration = rangeEnd.getTime() - rangeStart.getTime();

  // Build array of months to display
  const displayMonths = [];
  let m = startMonth;
  let y = startYear;
  for (let i = 0; i < 7; i += 1) {
    displayMonths.push({ month: m, year: y, name: MONTH_NAMES[m] });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }

  // Create header with months
  const header = document.createElement('div');
  header.classList.add('timeline-header');

  // Show year range or single year
  const yearLabel = document.createElement('div');
  yearLabel.classList.add('timeline-year');
  if (startYear === endYear) {
    yearLabel.textContent = startYear;
  } else {
    yearLabel.textContent = `${startYear}–${endYear}`;
  }
  header.appendChild(yearLabel);

  const monthsRow = document.createElement('div');
  monthsRow.classList.add('timeline-months');
  displayMonths.forEach(({ name }) => {
    const monthDiv = document.createElement('div');
    monthDiv.classList.add('timeline-month');
    monthDiv.textContent = name;
    monthsRow.appendChild(monthDiv);
  });
  header.appendChild(monthsRow);
  container.appendChild(header);

  // Create banner rows
  const rowsContainer = document.createElement('div');
  rowsContainer.classList.add('timeline-rows');

  const visibleBanners = []; // Track which banners have visible bars

  banners.forEach((banner) => {
    if (!banner.valid) return;

    // Skip banners with negative duration (end before start)
    if (banner.start && banner.end && banner.end < banner.start) return;

    const row = document.createElement('div');
    row.classList.add('timeline-row');

    // Track for the bar
    const track = document.createElement('div');
    track.classList.add('timeline-track');
    track.title = banner.content?.textContent?.trim() || '';

    // Calculate bar position
    const startTime = banner.start ? banner.start.getTime() : rangeStart.getTime();
    const endTime = banner.end ? banner.end.getTime() : rangeEnd.getTime();

    // Clamp to visible range
    const visibleStart = Math.max(startTime, rangeStart.getTime());
    const visibleEnd = Math.min(endTime, rangeEnd.getTime());

    // Only show bar if it overlaps with the visible range
    if (visibleEnd >= rangeStart.getTime() && visibleStart <= rangeEnd.getTime()) {
      const leftPercent = ((visibleStart - rangeStart.getTime()) / rangeDuration) * 100;
      const widthPercent = ((visibleEnd - visibleStart) / rangeDuration) * 100;

      const bar = document.createElement('div');
      bar.classList.add('timeline-bar');
      bar.classList.add(`timeline-bar-${currentPastFuture(banner.start, banner.end, date)}`);

      if (bestBanner === banner) {
        bar.classList.add('timeline-bar-selected');
      }

      // Show arrows for open-ended dates
      if (!banner.start || banner.start.getTime() < rangeStart.getTime()) {
        bar.classList.add('timeline-bar-open-start');
      }
      if (!banner.end || banner.end.getTime() > rangeEnd.getTime()) {
        bar.classList.add('timeline-bar-open-end');
      }

      bar.style.left = `${Math.max(0, leftPercent)}%`;
      bar.style.width = `${Math.min(100, widthPercent)}%`;

      // Tooltip
      const startStr = banner.start ? formatShortDateTime(banner.start) : '∞';
      const endStr = banner.end ? formatShortDateTime(banner.end) : '∞';
      bar.title = `${startStr} → ${endStr}`;

      track.appendChild(bar);
      visibleBanners.push(banner); // Track this banner has a visible bar
    }

    row.appendChild(track);
    rowsContainer.appendChild(row);
  });

  container.appendChild(rowsContainer);

  // Add draggable "now" marker
  const nowTime = date.getTime();
  if (nowTime >= rangeStart.getTime() && nowTime <= rangeEnd.getTime()) {
    const nowPercent = ((nowTime - rangeStart.getTime()) / rangeDuration) * 100;
    const nowMarker = document.createElement('div');
    nowMarker.classList.add('timeline-now');
    nowMarker.title = 'Drag to change date';

    // Add date label (M/D format)
    const dateLabel = document.createElement('div');
    dateLabel.classList.add('timeline-now-label');
    dateLabel.textContent = `${date.getMonth() + 1}/${date.getDate()}`;
    nowMarker.appendChild(dateLabel);

    // Add drag handle
    const handle = document.createElement('div');
    handle.classList.add('timeline-now-handle');
    nowMarker.appendChild(handle);

    // Position marker after container is in DOM
    nowMarker.dataset.percent = nowPercent;

    // Drag functionality
    if (onDateChange) {
      let isDragging = false;
      let trackBoundsCache = null;

      const cacheTrackBounds = () => {
        const track = container.querySelector('.timeline-track');
        if (track) {
          trackBoundsCache = track.getBoundingClientRect();
        } else {
          const months = container.querySelector('.timeline-months');
          trackBoundsCache = months ? months.getBoundingClientRect() : null;
        }
      };

      // Update banner bar colors and selection based on the new date
      const updateBarColors = (newDate) => {
        const bars = container.querySelectorAll('.timeline-bar');
        const newBestBanner = findBestAlertBanner(banners, newDate);

        bars.forEach((bar, index) => {
          const banner = visibleBanners[index];
          if (!banner) return;

          // Remove old state classes
          bar.classList.remove(
            'timeline-bar-past',
            'timeline-bar-current',
            'timeline-bar-future',
            'timeline-bar-selected',
          );

          // Add new state class
          const state = currentPastFuture(banner.start, banner.end, newDate);
          bar.classList.add(`timeline-bar-${state}`);

          // Add selected class if this is the best banner
          if (banner === newBestBanner) {
            bar.classList.add('timeline-bar-selected');
          }
        });
      };

      const updateMarkerFromX = (clientX) => {
        if (!trackBoundsCache || trackBoundsCache.width === 0) return null;

        const relativeX = clientX - trackBoundsCache.left;
        const percent = Math.max(0, Math.min(relativeX / trackBoundsCache.width, 1));

        // Update marker position directly (don't re-render timeline)
        const containerRect = container.getBoundingClientRect();
        const leftOffset = trackBoundsCache.left - containerRect.left;
        const newLeft = leftOffset + (percent * trackBoundsCache.width);
        nowMarker.style.left = `${newLeft}px`;

        // Calculate the new date
        const newTime = rangeStart.getTime() + (percent * rangeDuration);
        const newDate = new Date(newTime);

        // Update the date label
        dateLabel.textContent = `${newDate.getMonth() + 1}/${newDate.getDate()}`;

        // Update bar colors
        updateBarColors(newDate);

        return newDate;
      };

      const onMouseMove = (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const newDate = updateMarkerFromX(e.clientX);
        if (newDate) {
          // Only update the input and list, not the timeline
          onDateChange(newDate, true); // true = dragging
        }
      };

      const onMouseUp = () => {
        isDragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        nowMarker.classList.remove('timeline-now-dragging');
        trackBoundsCache = null;
      };

      nowMarker.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        isDragging = true;
        cacheTrackBounds(); // Cache bounds at start of drag
        nowMarker.classList.add('timeline-now-dragging');
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });

      // Touch support
      const onTouchMove = (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const touch = e.touches[0];
        const newDate = updateMarkerFromX(touch.clientX);
        if (newDate) {
          onDateChange(newDate, true);
        }
      };

      const onTouchEnd = () => {
        isDragging = false;
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
        nowMarker.classList.remove('timeline-now-dragging');
        trackBoundsCache = null;
      };

      nowMarker.addEventListener('touchstart', (e) => {
        e.preventDefault();
        isDragging = true;
        cacheTrackBounds();
        nowMarker.classList.add('timeline-now-dragging');
        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('touchend', onTouchEnd);
      });

      // Position marker after a frame so DOM is ready
      requestAnimationFrame(() => {
        const track = container.querySelector('.timeline-track');
        if (track) {
          const trackRect = track.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          const leftOffset = trackRect.left - containerRect.left;
          const newLeft = leftOffset + (nowPercent / 100) * trackRect.width;
          nowMarker.style.left = `${newLeft}px`;
        }
      });
    } else {
      // Non-interactive: use CSS calc
      nowMarker.style.left = `${nowPercent}%`;
    }

    container.appendChild(nowMarker);
  }

  return container;
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

  // Shared update function
  // When dragging=true, only update input and list (not timeline)
  const updateViews = (simDate, dragging = false) => {
    const simBestBanner = findBestAlertBanner(banners, simDate);

    // Update datetime input
    dtl.value = simDate.toISOString().slice(0, 16);

    // Update timeline (skip during drag to avoid destroying the element being dragged)
    if (!dragging) {
      timelineContainer.textContent = '';
      const onDrag = (newDate, isDragging) => updateViews(newDate, isDragging);
      timelineContainer.append(createTimeline(banners, simBestBanner, simDate, onDrag));
    }

    // Update list
    bannersContainer.textContent = '';
    bannersContainer.append(createParsedBanners(banners, simBestBanner, simDate));
  };

  // Initial render
  updateViews(new Date());

  // Listen for manual input changes
  dtl.addEventListener('input', (e) => {
    const newDate = new Date(e.target.value);
    const simBestBanner = findBestAlertBanner(banners, newDate);

    // Full re-render when manually changing input
    timelineContainer.textContent = '';
    const onDrag = (dragDate, isDragging) => updateViews(dragDate, isDragging);
    timelineContainer.append(createTimeline(banners, simBestBanner, newDate, onDrag));

    bannersContainer.textContent = '';
    bannersContainer.append(createParsedBanners(banners, simBestBanner, newDate));
  });

  block.append(timelineContainer);
  block.append(bannersContainer);
  block.append(div);
}
