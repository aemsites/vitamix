const GEOCODE_BASE = 'https://helix-geocode.adobeaem.workers.dev/';

const ADDRESS_FIELDS = [
  'NAME',
  'ADDRESS_1',
  'ADDRESS_2',
  'CITY',
  'STATE_PROVINCE',
  'POSTAL_CODE',
  'COUNTY',
  'COUNTRY',
];

/**
 * Split TSV string into row strings. Newlines inside double-quoted fields are not row separators.
 * Handles \n, \r\n, and \r line endings. Strips BOM from first row.
 * @param {string} tsv
 * @returns {string[]}
 */
function splitTSVRows(tsv) {
  const rows = [];
  let current = '';
  let inQuotes = false;
  const s = tsv.trimEnd();
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      current += c;
    } else if (!inQuotes && (c === '\n' || c === '\r')) {
      if (c === '\r' && s[i + 1] === '\n') i += 1;
      rows.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  if (current.length > 0) rows.push(current);
  if (rows.length > 0 && rows[0].charCodeAt(0) === 0xFEFF) {
    rows[0] = rows[0].slice(1);
  }
  return rows;
}

/**
 * Split a single TSV row string into fields. Tabs inside double-quoted fields are not separators.
 * Handles "" as escaped quote within quoted field.
 * @param {string} row
 * @returns {string[]}
 */
function splitTSVRow(row) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i += 1) {
    const c = row[i];
    if (c === '"') {
      if (inQuotes && row[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === '\t' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Unquote a TSV field value: remove surrounding quotes and unescape "" to ".
 * Trims whitespace and trailing \r from unquoted values.
 * @param {string} field
 * @returns {string}
 */
function unquoteField(field) {
  const trimmed = field.trim().replace(/\r+$/, '');
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  return trimmed;
}

/**
 * Parse TSV into { header, columnIndex, rows }.
 * Handles quoted fields that contain newlines, tabs, and double-quote escapes.
 * @param {string} tsv
 * @returns {{ header: string[], columnIndex: Record<string, number>, rows: string[][] }}
 */
export function parseTSV(tsv) {
  const rowStrings = splitTSVRows(tsv);
  if (rowStrings.length < 2) {
    throw new Error('TSV must have a header row and at least one data row.');
  }
  const header = splitTSVRow(rowStrings[0]).map((col) => unquoteField(col).trim());
  const columnIndex = {};
  header.forEach((col, i) => {
    columnIndex[col] = i;
  });

  const required = ['NAME', 'ADDRESS_1', 'LAT', 'LONG'];
  for (const col of required) {
    if (columnIndex[col] === undefined) {
      throw new Error(`Missing required column: ${col}. Header: ${header.join(', ')}`);
    }
  }

  const numCols = header.length;
  const rows = rowStrings.slice(1).map((line) => {
    const raw = splitTSVRow(line);
    const cells = raw.map((cell) => unquoteField(cell));
    while (cells.length < numCols) cells.push('');
    return cells.slice(0, numCols);
  });
  return { header, columnIndex, rows };
}

/**
 * Normalize whitespace (including newlines) to single spaces.
 * @param {string} s
 * @returns {string}
 */
function normalizeWhitespace(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Build address string for geocode from row and column index.
 * Normalizes newlines and other whitespace to single spaces.
 * @param {string[]} row
 * @param {Record<string, number>} columnIndex
 * @returns {string}
 */
export function buildAddress(row, columnIndex) {
  const parts = ADDRESS_FIELDS.map((field) => {
    const i = columnIndex[field];
    if (i === undefined) return '';
    return normalizeWhitespace(row[i] || '');
  }).filter(Boolean);
  return parts.join(' ');
}

/**
 * Call geocode API and return { lat, lng } or null.
 * @param {string} address
 * @returns {Promise<{ lat: number, lng: number } | null>}
 */
export async function geocodeAddress(address) {
  if (!address || !address.trim()) return null;
  const url = `${GEOCODE_BASE}?address=${encodeURIComponent(address)}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const data = await response.json();

  // Google Geocoding API (via proxy): results[0].geometry.location.{ lat, lng }
  if (data.results && Array.isArray(data.results) && data.results.length > 0) {
    const location = data.results[0].geometry?.location;
    if (location && location.lat != null && location.lng != null) {
      return { lat: Number(location.lat), lng: Number(location.lng) };
    }
  }

  return null;
}

/**
 * Quote a field for TSV if it contains newline, tab, or double-quote.
 * @param {string} field
 * @returns {string}
 */
function quoteField(field) {
  const s = String(field);
  if (/[\r\n\t"]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Serialize parsed TSV back to string.
 * Fields that contain newlines, tabs, or quotes are quoted and escaped.
 * @param {{ header: string[], rows: string[][] }} parsed
 * @returns {string}
 */
export function serializeTSV(parsed) {
  const headerLine = parsed.header.map(quoteField).join('\t');
  const dataLines = parsed.rows.map((row) => row.map(quoteField).join('\t'));
  return [headerLine, ...dataLines].join('\n');
}

/**
 * Show error message.
 * @param {string} message
 */
export function showError(message) {
  const errorDiv = document.getElementById('error');
  errorDiv.textContent = message;
  errorDiv.classList.add('active');
  setTimeout(() => {
    errorDiv.classList.remove('active');
  }, 8000);
}

/**
 * Update progress bar and text.
 * @param {number} current
 * @param {number} total
 * @param {string} [text]
 */
export function updateProgress(current, total, text) {
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  progressBar.style.width = `${pct}%`;
  progressText.textContent = text ?? `Looking up coordinates... ${current} of ${total}`;
}

/**
 * Run geocode lookup on TSV and fill LAT/LONG.
 */
export async function runLookup() {
  const tsvInput = document.getElementById('tsvInput');
  const tsv = tsvInput.value.trim();
  if (!tsv) {
    showError('Please paste TSV data first.');
    return;
  }

  let parsed;
  try {
    parsed = parseTSV(tsv);
  } catch (e) {
    showError(e.message);
    return;
  }

  const { header, columnIndex, rows } = parsed;
  const latIdx = columnIndex.LAT;
  const lngIdx = columnIndex.LONG;
  const total = rows.length;
  const loadingDiv = document.getElementById('loading');
  const lookupBtn = document.getElementById('lookupBtn');
  const resultsDiv = document.getElementById('results');
  const tsvOutput = document.getElementById('tsvOutput');

  document.getElementById('error').classList.remove('active');
  resultsDiv.classList.remove('active');
  loadingDiv.classList.add('active');
  lookupBtn.disabled = true;
  updateProgress(0, total);

  const address1Idx = columnIndex.ADDRESS_1;
  let done = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const address1 = (row[address1Idx] || '').trim();
    if (!address1) {
      done += 1;
      updateProgress(done, total);
      continue;
    }
    const lat = (row[latIdx] || '').trim();
    const lng = (row[lngIdx] || '').trim();
    if (lat && lng) {
      done += 1;
      updateProgress(done, total);
      continue;
    }
    const address = buildAddress(row, columnIndex);
    try {
      const result = await geocodeAddress(address);
      if (result) {
        row[latIdx] = String(result.lat);
        row[lngIdx] = String(result.lng);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`Geocode failed for row ${i + 2}:`, err);
    }
    done += 1;
    updateProgress(done, total);
  }

  loadingDiv.classList.remove('active');
  lookupBtn.disabled = false;
  tsvOutput.value = serializeTSV(parsed);
  renderResultsTable(parsed);
  resultsDiv.classList.add('active');
}

const GOOGLE_MAPS_SEARCH = 'https://www.google.com/maps/search/?api=1&query=';

/**
 * Render results table: numbered rows, address (with Maps link), lat/long (with Maps link).
 * @param {{ header: string[], columnIndex: Record<string, number>, rows: string[][] }} parsed
 */
export function renderResultsTable(parsed) {
  const tbody = document.getElementById('resultsTableBody');
  tbody.innerHTML = '';
  const { columnIndex, rows } = parsed;
  const latIdx = columnIndex.LAT;
  const lngIdx = columnIndex.LONG;

  rows.forEach((row, i) => {
    const address = buildAddress(row, columnIndex);
    const lat = (row[latIdx] || '').trim();
    const lng = (row[lngIdx] || '').trim();
    const hasCoords = lat && lng;

    const addressUrl = GOOGLE_MAPS_SEARCH + encodeURIComponent(address);
    const coordsQuery = hasCoords ? `${lat},${lng}` : '';
    const coordsUrl = hasCoords ? GOOGLE_MAPS_SEARCH + encodeURIComponent(coordsQuery) : '';

    const tr = document.createElement('tr');
    const addressDisplay = address ? `<a href="${addressUrl}" target="_blank" rel="noopener noreferrer" class="maps-link">${escapeHtml(address)}</a>` : '—';
    const coordsDisplay = hasCoords ? `<a href="${coordsUrl}" target="_blank" rel="noopener noreferrer" class="maps-link">${escapeHtml(lat)}, ${escapeHtml(lng)}</a>` : '—';
    tr.innerHTML = `
      <td class="row-num">${i + 1}</td>
      <td class="address-cell">${addressDisplay}</td>
      <td class="coords-cell">${coordsDisplay}</td>
    `;
    tbody.appendChild(tr);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Copy output TSV to clipboard.
 */
export function copyToClipboard() {
  const tsvOutput = document.getElementById('tsvOutput');
  navigator.clipboard.writeText(tsvOutput.value).then(() => {
    // eslint-disable-next-line no-alert
    alert('Copied to clipboard!');
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to copy:', err);
    // eslint-disable-next-line no-alert
    alert('Failed to copy to clipboard');
  });
}

/**
 * Initialize on page load.
 */
export async function init() {
  document.getElementById('geocodeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    runLookup();
  });
  document.getElementById('copyBtn').addEventListener('click', copyToClipboard);
}

init();
