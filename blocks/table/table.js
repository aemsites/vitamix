import { toClassName } from '../../scripts/aem.js';
import loadColorSwatches from '../../scripts/color-swatches.js';

/**
 * Comparison tables with this many compared columns or fewer use the stacked
 * layout (label above values on mobile, sticky header). Wider tables keep the
 * horizontal-scroll layout. Authors can force scrolling with the `scroll` variant.
 */
const STACK_MAX_COLUMNS = 3;

function hasContent(el) {
  return !!(el.querySelector('img, picture, svg') || el.textContent.trim());
}

function buildRow(row, cellType = 'td') {
  const tr = document.createElement('tr');
  [...row.children].forEach((col) => {
    const cell = document.createElement(cellType);
    cell.innerHTML = col.innerHTML;
    if (cellType === 'th') cell.setAttribute('scope', 'col');
    tr.appendChild(cell);
  });
  return tr;
}

function buildRowWithRowHeaders(row) {
  const tr = document.createElement('tr');
  [...row.children].forEach((col, index) => {
    const cell = document.createElement(index === 0 ? 'th' : 'td');
    cell.innerHTML = col.innerHTML;
    if (index === 0) cell.setAttribute('scope', 'row');
    tr.appendChild(cell);
  });
  return tr;
}

function buildComparisonTable(rows, { stacked = false } = {}) {
  const table = document.createElement('table');
  const colCount = rows[0]?.children?.length || 0;

  // colgroup: first column 2x width of others (2/(n+1) vs 1/(n+1)).
  // Stacked tables size the label column in CSS instead.
  if (colCount > 0) {
    const colgroup = document.createElement('colgroup');
    const firstPct = (200 / (1 + colCount)).toFixed(2);
    const otherPct = (100 / (1 + colCount)).toFixed(2);
    const firstCol = document.createElement('col');
    if (!stacked) firstCol.style.width = `${firstPct}%`;
    colgroup.appendChild(firstCol);
    for (let i = 1; i < colCount; i += 1) {
      const col = document.createElement('col');
      if (!stacked) col.style.width = `${otherPct}%`;
      colgroup.appendChild(col);
    }
    table.appendChild(colgroup);
  }

  const thead = document.createElement('thead');
  if (rows.length > 0) {
    const headerRow = buildRow(rows[0], 'th');
    const firstHeaderCell = headerRow.querySelector('th');
    if (firstHeaderCell && !firstHeaderCell.querySelector('img') && !firstHeaderCell.textContent.trim()) {
      headerRow.classList.add('table-comparison-row-header-empty');
    }
    thead.appendChild(headerRow);
  }

  let tbody = document.createElement('tbody');
  const tbodies = [tbody];
  rows.slice(1).forEach((row) => {
    const cols = [...row.children];

    // Section heading row (e.g. "Specs", "Pricing"): label in the first cell,
    // every other cell empty. Starts a new <tbody> group.
    const isSection = stacked
      && cols.length > 1
      && hasContent(cols[0])
      && cols.slice(1).every((col) => !hasContent(col));
    if (isSection) {
      if (tbody.children.length) {
        tbody = document.createElement('tbody');
        tbodies.push(tbody);
      }
      const tr = document.createElement('tr');
      tr.className = 'table-comparison-section';
      const th = document.createElement('th');
      th.setAttribute('scope', 'rowgroup');
      th.colSpan = colCount;
      th.setAttribute('aria-colspan', colCount);
      th.innerHTML = cols[0].innerHTML;
      tr.appendChild(th);
      tbody.appendChild(tr);
      return;
    }

    const tr = document.createElement('tr');
    let rowHeaderEmpty = false;
    [...row.children].forEach((col, index) => {
      const cell = document.createElement(index === 0 ? 'th' : 'td');
      if (index === 0) {
        cell.setAttribute('scope', 'row');
        const wrap = document.createElement('div');
        wrap.className = 'table-comparison-cell-content';
        wrap.innerHTML = col.innerHTML;
        cell.appendChild(wrap);
        rowHeaderEmpty = !wrap.querySelector('img') && !wrap.textContent.trim();
      } else {
        cell.innerHTML = col.innerHTML;
      }
      tr.appendChild(cell);
    });
    if (rowHeaderEmpty) tr.classList.add('table-comparison-row-header-empty');
    tbody.appendChild(tr);
  });

  table.append(thead, ...tbodies);
  return table;
}

/**
 * The stacked layout changes `display` on table elements, which drops native
 * table semantics in Safari/VoiceOver. Explicit roles restore them.
 * @param {HTMLTableElement} table
 */
function addTableRoles(table) {
  table.setAttribute('role', 'table');
  table.querySelectorAll('thead, tbody').forEach((el) => el.setAttribute('role', 'rowgroup'));
  table.querySelectorAll('tr').forEach((el) => el.setAttribute('role', 'row'));
  table.querySelectorAll('th').forEach((th) => {
    th.setAttribute('role', th.getAttribute('scope') === 'col' ? 'columnheader' : 'rowheader');
  });
  table.querySelectorAll('td').forEach((el) => el.setAttribute('role', 'cell'));
}

function createColorSwatch(slug, label) {
  const swatch = document.createElement('div');
  swatch.className = 'table-comparison-color-swatch color-swatch';
  swatch.title = label || slug;
  swatch.style.backgroundColor = `var(--color-${slug})`;
  return swatch;
}

/**
 * Replace color name text in comparison table cells with visual swatches.
 * Uses a hidden .color-swatch probe element so getComputedStyle can resolve
 * --color-* variables loaded from the shared color swatches configuration.
 * @param {HTMLTableElement} table
 */
function replaceColorsRowWithSwatches(table) {
  const bodyRows = table.querySelectorAll('tbody tr');
  if (!bodyRows.length) return;

  const probe = document.createElement('div');
  probe.className = 'color-swatch';
  probe.style.display = 'none';
  document.body.appendChild(probe);

  const colorCache = {};
  const isKnownColor = (slug) => {
    if (slug in colorCache) return colorCache[slug];
    const el = document.createElement('div');
    el.style.backgroundColor = `var(--color-${slug})`;
    probe.appendChild(el);
    const bg = getComputedStyle(el).backgroundColor;
    probe.removeChild(el);
    colorCache[slug] = bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
    return colorCache[slug];
  };

  bodyRows.forEach((tr) => {
    tr.querySelectorAll('td').forEach((td) => {
      const tokens = td.textContent.trim().split(',').map((t) => t.trim()).filter(Boolean);
      if (!tokens.length) return;
      if (!tokens.some((t) => isKnownColor(toClassName(t)))) return;
      const swatchContainer = document.createElement('div');
      swatchContainer.className = 'table-comparison-color-swatches';
      tokens.forEach((token) => {
        const slug = toClassName(token);
        if (isKnownColor(slug)) {
          swatchContainer.appendChild(createColorSwatch(slug, token));
        } else {
          const span = document.createElement('span');
          span.className = 'table-comparison-color-text';
          span.textContent = token;
          swatchContainer.appendChild(span);
        }
      });
      td.textContent = '';
      td.appendChild(swatchContainer);
    });
  });

  probe.remove();
}

export default function decorate(block) {
  const table = document.createElement('table');
  const rows = [...block.children];
  const hasRowHeaders = block.classList.contains('row-headers');
  const isComparison = block.classList.contains('comparison');

  if (isComparison) {
    loadColorSwatches();
    const comparedCount = (rows[0]?.children?.length || 1) - 1;
    const stacked = comparedCount > 0
      && comparedCount <= STACK_MAX_COLUMNS
      && !block.classList.contains('scroll');
    const comparisonTable = buildComparisonTable(rows, { stacked });
    if (stacked) {
      block.classList.add('comparison-stacked');
      comparisonTable.style.setProperty('--compare-cols', comparedCount);
      addTableRoles(comparisonTable);
    }
    const scrollWrapper = document.createElement('div');
    scrollWrapper.className = 'table-comparison-scroll';
    scrollWrapper.appendChild(comparisonTable);
    block.replaceChildren(scrollWrapper);
    replaceColorsRowWithSwatches(comparisonTable);
  } else if (hasRowHeaders) {
    // build table with row headers (first column is header)
    const tbody = document.createElement('tbody');
    rows.forEach((row) => {
      tbody.appendChild(buildRowWithRowHeaders(row));
    });
    table.appendChild(tbody);
    block.replaceChildren(table);
  } else {
    // build table head
    const thead = document.createElement('thead');
    if (rows.length > 0) {
      thead.appendChild(buildRow(rows[0], 'th'));
    }

    // build table body
    const tbody = document.createElement('tbody');
    rows.slice(1).forEach((row) => {
      tbody.appendChild(buildRow(row, 'td'));
    });

    table.append(thead, tbody);
    block.replaceChildren(table);
  }
}
