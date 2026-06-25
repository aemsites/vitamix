import {
  parseEasternDateTime,
  currentPastFuture,
} from '../../scripts/scripts.js';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getEasternParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parseInt(parts.find((p) => p.type === type)?.value || '0', 10);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function addMonths(year, month, delta) {
  let m = month + delta;
  let y = year;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  return { year: y, month: m };
}

function formatEasternDateTime(date) {
  const {
    year, month, day, hour, minute,
  } = getEasternParts(date);
  const hour24 = hour === 24 ? 0 : hour;
  const h12 = hour24 % 12 || 12;
  const ampm = hour24 < 12 ? 'am' : 'pm';
  const minStr = minute ? `:${String(minute).padStart(2, '0')}` : '';
  return `${month}/${day}/${year} ${h12}${minStr}${ampm}`;
}

function formatShortDateTime(date) {
  if (date === null) return 'Open';
  if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) return 'Invalid Date';
  return formatEasternDateTime(date);
}

function parseDateOrNull(dateStr) {
  const trimmed = dateStr?.trim();
  if (!trimmed) return null;
  return parseEasternDateTime(trimmed);
}

function parseScheduleItems(data) {
  return data.map((item) => {
    const promotion = item.Promotion?.trim() || '';
    try {
      return {
        valid: true,
        start: parseDateOrNull(item.Start),
        end: parseDateOrNull(item.End),
        promotion,
        label: promotion,
      };
    } catch (e) {
      return {
        valid: false,
        error: e.message,
        start: null,
        end: null,
        promotion,
        label: promotion,
      };
    }
  });
}

function findBestPromotion(items, date = new Date()) {
  let best = null;
  items.forEach((item) => {
    if (item.valid && currentPastFuture(item.start, item.end, date) === 'current') {
      best = item;
    }
  });
  return best;
}

function formatMarkerLabel(date, activeItem) {
  const { month, day } = getEasternParts(date);
  const dateStr = `${month}/${day}`;
  if (activeItem?.promotion) return `${dateStr} ${activeItem.promotion}`;
  return dateStr;
}

function createTimeline(items, bestItem = null, date = new Date(), onDateChange = null) {
  const container = document.createElement('div');
  container.classList.add('alert-banners-timeline');

  const { year: currentYear, month: currentMonth } = getEasternParts(date);
  const rangeStartInfo = addMonths(currentYear, currentMonth, -3);
  const rangeEndInfo = addMonths(currentYear, currentMonth, 3);
  const rangeStart = parseEasternDateTime(`${rangeStartInfo.month}/1/${rangeStartInfo.year} 12am`);
  const rangeEnd = parseEasternDateTime(
    `${rangeEndInfo.month}/${daysInMonth(rangeEndInfo.year, rangeEndInfo.month)}/${rangeEndInfo.year} 11:59pm`,
  );
  const rangeDuration = rangeEnd.getTime() - rangeStart.getTime();

  const displayMonths = [];
  let m = rangeStartInfo.month;
  let y = rangeStartInfo.year;
  for (let i = 0; i < 7; i += 1) {
    displayMonths.push({ month: m, year: y, name: MONTH_NAMES[m - 1] });
    ({ year: y, month: m } = addMonths(y, m, 1));
  }

  const header = document.createElement('div');
  header.classList.add('timeline-header');

  const yearLabel = document.createElement('div');
  yearLabel.classList.add('timeline-year');
  yearLabel.textContent = rangeStartInfo.year === rangeEndInfo.year
    ? String(rangeStartInfo.year)
    : `${rangeStartInfo.year}–${rangeEndInfo.year}`;
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

  const rowsContainer = document.createElement('div');
  rowsContainer.classList.add('timeline-rows');
  const visibleItems = [];

  items.forEach((item) => {
    if (!item.valid) return;
    if (item.start && item.end && item.end < item.start) return;

    const startTime = item.start ? item.start.getTime() : rangeStart.getTime();
    const endTime = item.end ? item.end.getTime() : rangeEnd.getTime();
    const visibleStart = Math.max(startTime, rangeStart.getTime());
    const visibleEnd = Math.min(endTime, rangeEnd.getTime());
    if (visibleEnd < rangeStart.getTime() || visibleStart > rangeEnd.getTime()) return;

    const row = document.createElement('div');
    row.classList.add('timeline-row');

    const track = document.createElement('div');
    track.classList.add('timeline-track');
    track.title = item.label;

    const leftPercent = ((visibleStart - rangeStart.getTime()) / rangeDuration) * 100;
    const widthPercent = ((visibleEnd - visibleStart) / rangeDuration) * 100;

    const bar = document.createElement('div');
    bar.classList.add('timeline-bar');
    bar.classList.add(`timeline-bar-${currentPastFuture(item.start, item.end, date)}`);
    if (bestItem === item) bar.classList.add('timeline-bar-selected');

    if (!item.start || item.start.getTime() < rangeStart.getTime()) {
      bar.classList.add('timeline-bar-open-start');
    }
    if (!item.end || item.end.getTime() > rangeEnd.getTime()) {
      bar.classList.add('timeline-bar-open-end');
    }

    bar.style.left = `${Math.max(0, leftPercent)}%`;
    bar.style.width = `${Math.min(100, widthPercent)}%`;

    const startStr = item.start ? formatShortDateTime(item.start) : '∞';
    const endStr = item.end ? formatShortDateTime(item.end) : '∞';
    bar.title = `${item.label}: ${startStr} → ${endStr}`;

    track.appendChild(bar);
    visibleItems.push(item);
    row.appendChild(track);
    rowsContainer.appendChild(row);
  });

  container.appendChild(rowsContainer);

  const nowTime = date.getTime();
  if (nowTime >= rangeStart.getTime() && nowTime <= rangeEnd.getTime()) {
    const nowPercent = ((nowTime - rangeStart.getTime()) / rangeDuration) * 100;
    const nowMarker = document.createElement('div');
    nowMarker.classList.add('timeline-now');
    nowMarker.title = 'Drag to change date';

    const dateLabel = document.createElement('div');
    dateLabel.classList.add('timeline-now-label');
    dateLabel.textContent = formatMarkerLabel(date, bestItem);
    nowMarker.appendChild(dateLabel);

    const handle = document.createElement('div');
    handle.classList.add('timeline-now-handle');
    nowMarker.appendChild(handle);

    if (onDateChange) {
      let isDragging = false;
      let trackBoundsCache = null;
      let barsCache = null;
      let lastBestIdx = -1;

      const cacheTrackBounds = () => {
        const track = container.querySelector('.timeline-track');
        if (track) {
          trackBoundsCache = track.getBoundingClientRect();
        } else {
          const months = container.querySelector('.timeline-months');
          trackBoundsCache = months ? months.getBoundingClientRect() : null;
        }
        barsCache = [...container.querySelectorAll('.timeline-bar')];
      };

      const updateBarColors = (newDate) => {
        if (!barsCache) return null;

        let newBestIdx = -1;
        for (let i = 0; i < barsCache.length; i += 1) {
          const bar = barsCache[i];
          const scheduleItem = visibleItems[i];
          if (!scheduleItem) continue; // eslint-disable-line no-continue

          const state = currentPastFuture(scheduleItem.start, scheduleItem.end, newDate);
          bar.classList.toggle('timeline-bar-past', state === 'past');
          bar.classList.toggle('timeline-bar-current', state === 'current');
          bar.classList.toggle('timeline-bar-future', state === 'future');

          if (state === 'current') newBestIdx = i;
        }

        if (newBestIdx !== lastBestIdx) {
          if (lastBestIdx >= 0 && barsCache[lastBestIdx]) {
            barsCache[lastBestIdx].classList.remove('timeline-bar-selected');
          }
          if (newBestIdx >= 0 && barsCache[newBestIdx]) {
            barsCache[newBestIdx].classList.add('timeline-bar-selected');
          }
          lastBestIdx = newBestIdx;
        }

        return newBestIdx >= 0 ? visibleItems[newBestIdx] : null;
      };

      const updateMarkerFromX = (clientX) => {
        if (!trackBoundsCache || trackBoundsCache.width === 0) return null;

        const relativeX = clientX - trackBoundsCache.left;
        const percent = Math.max(0, Math.min(relativeX / trackBoundsCache.width, 1));
        const containerRect = container.getBoundingClientRect();
        const leftOffset = trackBoundsCache.left - containerRect.left;
        nowMarker.style.left = `${leftOffset + (percent * trackBoundsCache.width)}px`;

        const newTime = rangeStart.getTime() + (percent * rangeDuration);
        const newDate = new Date(newTime);
        const currentBest = updateBarColors(newDate);
        dateLabel.textContent = formatMarkerLabel(newDate, currentBest);
        return { newDate, bestItem: currentBest };
      };

      const onMouseMove = (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const result = updateMarkerFromX(e.clientX);
        if (result) onDateChange(result.newDate, result.bestItem);
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
        cacheTrackBounds();
        nowMarker.classList.add('timeline-now-dragging');
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });

      const onTouchMove = (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const touch = e.touches[0];
        const result = updateMarkerFromX(touch.clientX);
        if (result) onDateChange(result.newDate, result.bestItem);
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

      requestAnimationFrame(() => {
        const track = container.querySelector('.timeline-track');
        if (track) {
          const trackRect = track.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          const leftOffset = trackRect.left - containerRect.left;
          nowMarker.style.left = `${leftOffset + (nowPercent / 100) * trackRect.width}px`;
        }
      });
    } else {
      nowMarker.style.left = `${nowPercent}%`;
    }

    container.appendChild(nowMarker);
  }

  return container;
}

const AEM_LIVE_HOST = 'main--vitamix--aemsites.aem.live';

const LOCALE_FLAGS = {
  us: '🇺🇸',
  ca: '🇨🇦',
  mx: '🇲🇽',
};

function parseScheduleMeta(schedulePath) {
  const segments = schedulePath.split('/').filter(Boolean);
  const locale = segments[0]?.toLowerCase() || '';
  const filename = segments[segments.length - 1] || '';
  const name = filename.replace(/\.json$/i, '');
  return {
    name,
    flag: LOCALE_FLAGS[locale] || '',
  };
}

function isPreviewEnv() {
  const { hostname } = window.location;
  return hostname.endsWith('.aem.page')
    || hostname === 'localhost'
    || hostname === '127.0.0.1';
}

function getPreviewEnvUrl() {
  const url = new URL(window.location.href);
  const { hostname } = window.location;
  if (hostname.endsWith('.aem.live')) {
    url.hostname = hostname.replace('.aem.live', '.aem.page');
  }
  return url.href;
}

function getLiveEnvUrl() {
  const url = new URL(window.location.href);
  const { hostname } = window.location;
  if (hostname.endsWith('.aem.page')) {
    url.hostname = hostname.replace('.aem.page', '.aem.live');
    return url.href;
  }
  if (hostname.endsWith('.aem.live')) {
    return url.href;
  }
  url.protocol = 'https:';
  url.port = '';
  url.hostname = AEM_LIVE_HOST;
  return url.href;
}

function setupEnvToggle() {
  const previewLink = document.getElementById('env-preview');
  const liveLink = document.getElementById('env-live');
  const isPreview = isPreviewEnv();

  previewLink.href = getPreviewEnvUrl();
  liveLink.href = getLiveEnvUrl();
  previewLink.classList.toggle('is-active', isPreview);
  liveLink.classList.toggle('is-active', !isPreview);
  previewLink.setAttribute('aria-current', isPreview ? 'true' : 'false');
  liveLink.setAttribute('aria-current', !isPreview ? 'true' : 'false');
}

function buildPageUrl(pagePath, date) {
  const url = new URL(pagePath, window.location.origin);
  url.searchParams.set('simulateDate', formatEasternDateTime(date));
  return url.href;
}

function showError(message) {
  const errorEl = document.getElementById('error');
  errorEl.textContent = message;
  errorEl.hidden = !message;
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const schedulePath = params.get('schedule') || '';
  const pagePath = params.get('page') || '';

  if (!schedulePath || !pagePath) {
    showError('Missing schedule or page query parameter');
    return;
  }

  const panel = document.getElementById('simulator-panel');
  const timeline = document.getElementById('timeline');
  const frame = document.getElementById('page-frame');
  const { name: scheduleName, flag: scheduleFlag } = parseScheduleMeta(schedulePath);

  document.getElementById('schedule-name').textContent = scheduleName;
  document.getElementById('schedule-flag').textContent = scheduleFlag;

  panel.hidden = false;
  frame.hidden = false;
  showError('');

  setupEnvToggle();

  let currentPromotion;
  let items = [];
  try {
    const resp = await fetch(schedulePath);
    if (!resp.ok) throw new Error(`Failed to load schedule (${resp.status})`);
    const schedule = await resp.json();
    if (!schedule?.data?.length) throw new Error('Schedule has no rows');
    items = parseScheduleItems(schedule.data);
  } catch (e) {
    showError(e.message || 'Failed to load schedule');
    panel.hidden = true;
    frame.hidden = true;
    return;
  }

  const updateIframeIfPromotionChanged = (date, activeItem) => {
    const promotion = activeItem?.promotion ?? null;
    if (promotion === currentPromotion) return;
    currentPromotion = promotion;
    frame.src = buildPageUrl(pagePath, date);
  };

  const onDrag = (newDate, bestItem) => {
    updateIframeIfPromotionChanged(newDate, bestItem);
  };

  const updateViews = (simDate) => {
    const bestItem = findBestPromotion(items, simDate);
    timeline.textContent = '';
    timeline.append(createTimeline(items, bestItem, simDate, onDrag));
    updateIframeIfPromotionChanged(simDate, bestItem);
  };

  updateViews(new Date());
}

init();
