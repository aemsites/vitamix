/**
 * US Eastern civil time for commerce-admin date pickers and display.
 * Stored API values stay UTC; timezone-less user input is always America/New_York.
 */

export const ET_TIMEZONE = 'America/New_York';

/**
 * Convert Eastern civil time components → UTC `Date`.
 * Tries both EST (−05:00) and EDT (−04:00) offsets and picks the one whose round-trip
 * through `America/New_York` matches the original components (handles DST transitions).
 *
 * @param {number} year
 * @param {number} mo 1-based month
 * @param {number} day
 * @param {number} h
 * @param {number} mi
 * @param {number} sec
 * @returns {Date}
 */
export function easternCivilToUtc(year, mo, day, h, mi, sec) {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const base = `${pad(year, 4)}-${pad(mo)}-${pad(day)}T${pad(h)}:${pad(mi)}:${pad(sec)}`;
  const etFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: ET_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const get = (parts, type) => parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
  const match = ['-04:00', '-05:00'].map((offset) => {
    const candidate = new Date(`${base}${offset}`);
    if (Number.isNaN(candidate.getTime())) return null;
    const parts = etFmt.formatToParts(candidate);
    if (
      get(parts, 'year') === year && get(parts, 'month') === mo && get(parts, 'day') === day
      && get(parts, 'hour') === h && get(parts, 'minute') === mi && get(parts, 'second') === sec
    ) return candidate;
    return null;
  }).find(Boolean);
  if (match) return match;
  return new Date(`${base}-05:00`);
}

/** @param {Date} d */
function toApiUtcIso(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  return d.toISOString().replace(/\.\d+Z$/, 'Z');
}

/**
 * UTC ISO instant → `YYYY-MM-DDTHH:mm` for `<input type="datetime-local">` in Eastern time.
 *
 * @param {string} iso
 * @returns {string}
 */
export function isoToEasternDatetimeLocal(iso) {
  const s = String(iso || '').trim();
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ET_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}

/**
 * `<input type="datetime-local">` value as Eastern civil time → UTC ISO for the API.
 * Does not use the browser timezone.
 *
 * @param {string} localValue
 * @returns {string}
 */
export function easternDatetimeLocalToIso(localValue) {
  const v = String(localValue || '').trim();
  if (!v) return '';
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return '';
  const dt = easternCivilToUtc(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    m[6] !== undefined ? Number(m[6]) : 0,
  );
  if (Number.isNaN(dt.getTime())) return '';
  return toApiUtcIso(dt);
}

/**
 * Display a UTC ISO instant in US Eastern time.
 *
 * @param {string} iso
 * @returns {string}
 */
export function formatInstantInEastern(iso) {
  const s = String(iso || '').trim();
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString('en-US', {
    timeZone: ET_TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}
