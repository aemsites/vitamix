const PARAM = 'simulateDate';
// Shared by all tabs, like the cart, so every tab prices gifts on the same clock.
const STORAGE_KEY = 'vitamix.now';
const BADGE_ID = 'simulate-date-badge';

/**
 * Determines if a given date falls within US Eastern Daylight Saving Time.
 * DST starts: 2nd Sunday of March at 2:00 AM
 * DST ends: 1st Sunday of November at 2:00 AM
 * @param {number} year - The year
 * @param {number} month - The month (1-12)
 * @param {number} day - The day of month
 * @returns {boolean} True if the date is in DST (EDT), false if in standard time (EST)
 */
function isEasternDST(year, month, day) {
  // DST doesn't apply in Jan, Feb, or Dec
  if (month < 3 || month > 11) return false;
  // DST always applies Apr-Oct
  if (month > 3 && month < 11) return true;

  // For March: DST starts 2nd Sunday at 2am
  if (month === 3) {
    // Find the 2nd Sunday of March
    const firstOfMonth = new Date(year, 2, 1); // March 1st (month is 0-indexed)
    const firstSunday = 1 + ((7 - firstOfMonth.getDay()) % 7);
    const secondSunday = firstSunday + 7;
    // On or after the second Sunday means DST
    return day >= secondSunday;
  }

  // For November: DST ends 1st Sunday at 2am
  if (month === 11) {
    // Find the 1st Sunday of November
    const firstOfMonth = new Date(year, 10, 1); // November 1st (month is 0-indexed)
    const firstSunday = 1 + ((7 - firstOfMonth.getDay()) % 7);
    // Before the first Sunday means still in DST
    return day < firstSunday;
  }

  return false;
}

/**
 * Parses a datetime string and returns a Date object.
 * Supports formats like "9/12/2025 9am", "9/19/2025 3pm", or "9/12/2025 9:30am"
 * Defaults to Eastern time (EST/EDT based on daylight savings) when no timezone specified.
 * @param {string} dateStr - The datetime string to parse (e.g., "6/23/2025 9am")
 * @returns {Date} The parsed Date object
 * @throws {Error} If the datetime format is invalid
 */
export function parseEasternDateTime(dateStr) {
  if (!dateStr) {
    throw new Error('DateTime string is required');
  }

  // Handle formats like "9/12/2025 9am" or "9/12/2025 9:30am"
  // Timezone is optional, defaults to Eastern (EST/EDT)
  const regex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})(?::(\d{2}))?(am|pm)(?:\s+([A-Z]{3,4}))?$/i;
  const match = dateStr.trim().match(regex);

  if (!match) {
    throw new Error(`Invalid datetime format: ${dateStr}. Expected format: M/D/YYYY HHam/pm`);
  }

  const month = parseInt(match[1], 10);
  const day = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);
  let hours = parseInt(match[4], 10);
  const minutesValue = match[5] ? parseInt(match[5], 10) : 0;
  const ampm = match[6].toLowerCase();
  const timezone = match[7];

  // Convert 12-hour to 24-hour format
  if (ampm === 'am' && hours === 12) {
    hours = 0; // 12am = 00:00
  } else if (ampm === 'pm' && hours !== 12) {
    hours += 12; // 1pm-11pm = 13:00-23:00, 12pm stays 12:00
  }

  // Timezone offsets from UTC
  const timezoneOffsets = {
    EDT: -4,
    EST: -5,
    CDT: -5,
    CST: -6,
    MDT: -6,
    MST: -7,
    PDT: -7,
    PST: -8,
  };

  let offsetHours;
  if (timezone) {
    // Use explicitly specified timezone
    offsetHours = timezoneOffsets[timezone.toUpperCase()];
    if (offsetHours === undefined) {
      throw new Error(`Unsupported timezone: ${timezone}`);
    }
  } else {
    // Default to Eastern time - auto-detect EST/EDT based on date
    const isDST = isEasternDST(year, month, day);
    offsetHours = isDST ? -4 : -5; // EDT = -4, EST = -5
  }

  // Convert the local time to UTC by subtracting the offset
  // If EDT is UTC-4, then 9am EDT = 1pm UTC (9 - (-4) = 13)
  const utcHour = hours - offsetHours;

  // Create UTC date object
  return new Date(Date.UTC(year, month - 1, day, utcHour, minutesValue, 0));
}

/** Whether the current host may simulate a date: everywhere but production. */
export function isSimulationHost() {
  const hostname = window.location?.hostname;
  return hostname !== 'www.vitamix.com' && hostname !== 'vitamix.com';
}

/**
 * Parses a simulated date: Eastern `M/D/YYYY h:mmam` first, then any `Date` input.
 *
 * @param {string} value
 * @returns {Date|null}
 */
export function parseSimulatedDate(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return parseEasternDateTime(value);
  } catch {
    // A `+` offset arrives as a space when the query value isn't encoded.
    return [value.trim(), value.trim().replace(/ (\d{2}:?\d{2})$/, '+$1')]
      .map((v) => new Date(v))
      .find((date) => !Number.isNaN(date.getTime())) || null;
  }
}

/** The stored ISO date, `null` when absent, `undefined` when storage is unavailable. */
function readStored() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return undefined;
  }
}

let writeFailed = false;

function writeStored(value) {
  try {
    if (value === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, value);
    writeFailed = false;
  } catch {
    writeFailed = true;
  }
}

let warnedParam = null;
let appliedLocation = null;
// This page's date when storage is unavailable.
let pageDate = null;

/** Framed pages (date simulator previews) don't change the tab's date. */
function isFramed() {
  try {
    return !!window.top && window.top !== window.self;
  } catch {
    return true;
  }
}

function readParam() {
  try {
    return new URLSearchParams(window.location?.search || '').get(PARAM);
  } catch {
    return null;
  }
}

function parseParam(param) {
  const date = parseSimulatedDate(param);
  if (!date && param.trim() && warnedParam !== param) {
    warnedParam = param;
    // eslint-disable-next-line no-console
    console.warn(`Invalid simulateDate: ${param}`);
  }
  return date;
}

/** Stores `?simulateDate=` once per page load, so a newer date from another tab wins. */
function applyParam() {
  const { location } = window;
  if (appliedLocation === location) return;
  appliedLocation = location;
  pageDate = null;
  writeFailed = false;
  const param = readParam();
  if (param === null) return;
  if (!param.trim()) {
    writeStored(null);
    return;
  }
  const date = parseParam(param);
  if (!date) return;
  pageDate = date;
  writeStored(date.toISOString());
}

/**
 * The simulated "now", or `null` (always on production hosts). `?simulateDate=` sets it
 * for every tab of the site, an empty value clears it.
 *
 * @returns {Date|null}
 */
export function getSimulatedDate() {
  if (!isSimulationHost()) return null;
  if (isFramed()) {
    const param = readParam();
    if (param !== null) return param.trim() ? parseParam(param) : null;
  } else {
    applyParam();
  }
  const stored = readStored();
  if (stored === undefined || writeFailed) return pageDate ? new Date(pageDate) : null;
  if (!stored) return null;
  const date = new Date(stored);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Appends `simulateDate` to an API URL while a date is simulated.
 *
 * @param {string} url
 * @returns {string}
 */
export function withSimulatedDate(url) {
  const date = getSimulatedDate();
  if (!date) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${PARAM}=${encodeURIComponent(date.toISOString())}`;
}

let apiApplied = null;
let warnedIgnored = false;

function formatBadgeDate(date) {
  try {
    return date.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return date.toISOString();
  }
}

function clearHref() {
  const url = new URL(window.location.href);
  url.searchParams.set(PARAM, '');
  return url.href;
}

let badge = null;

function updateBadge() {
  if (!badge) return;
  const date = getSimulatedDate();
  if (!date) {
    badge.root.remove();
    badge = null;
    return;
  }
  badge.root.dataset.applied = String(apiApplied);
  badge.value.textContent = formatBadgeDate(date);
  badge.status.hidden = apiApplied !== false;
}

function element(tag, text, style) {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  if (style) el.style.cssText = style;
  return el;
}

let watching = false;

/** Reloads without `?simulateDate`, so the reload doesn't write this page's date back. */
function reloadWithoutParam() {
  const url = new URL(window.location.href);
  url.searchParams.delete(PARAM);
  window.location.replace(url.href);
}

/** Reloads the page when another tab sets, changes or clears the date. */
function watchOtherTabs() {
  if (watching) return;
  watching = true;
  let current = getSimulatedDate()?.getTime() ?? null;
  window.addEventListener?.('storage', (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    const next = getSimulatedDate()?.getTime() ?? null;
    if (next === current) return;
    current = next;
    reloadWithoutParam();
  });
}

/**
 * Shows a fixed badge with the simulated date and a link that clears it. Pages reload
 * when another tab changes the date. Does nothing on production hosts.
 */
export function showSimulationBadge() {
  if (!isSimulationHost() || isFramed()) return;
  watchOtherTabs();
  if (badge?.root.isConnected || !getSimulatedDate()) return;
  const root = element('div', '', 'position:fixed;left:8px;bottom:8px;z-index:2147483000;'
    + 'padding:6px 10px;border-radius:4px;background:#5c2d91;color:#fff;'
    + 'font:12px/1.4 sans-serif;box-shadow:0 1px 4px rgb(0 0 0 / 30%)');
  root.id = BADGE_ID;
  root.setAttribute('role', 'status');
  const value = element('strong');
  const status = element('span', 'Not applied by the API', 'color:#ffd54f');
  const clear = element('a', 'Clear', 'color:#fff');
  clear.href = clearHref();
  root.append('Simulated date: ', value, ' ', status, ' ', clear);
  badge = { root, value, status };
  document.body.append(root);
  updateBadge();
}

/**
 * Records whether the API applied the simulated date to a pricing response.
 *
 * @param {Object} response estimate or preview response body
 */
export function noteSimulatedAt(response) {
  if (!response || typeof response !== 'object' || !getSimulatedDate()) return;
  apiApplied = typeof response.simulatedAt === 'string';
  if (!apiApplied && !warnedIgnored) {
    warnedIgnored = true;
    // eslint-disable-next-line no-console
    console.warn('simulateDate was not applied by the API');
  }
  updateBadge();
}

/** @returns {boolean|null} whether the last pricing response applied the date */
export function getSimulationStatus() {
  return apiApplied;
}
