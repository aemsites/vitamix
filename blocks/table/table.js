import { toClassName } from '../../scripts/aem.js';

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

function buildComparisonTable(rows) {
  const table = document.createElement('table');
  const colCount = rows[0]?.children?.length || 0;

  // colgroup: first column 2x width of others (2/(n+1) vs 1/(n+1))
  if (colCount > 0) {
    const colgroup = document.createElement('colgroup');
    const firstPct = (200 / (1 + colCount)).toFixed(2);
    const otherPct = (100 / (1 + colCount)).toFixed(2);
    const firstCol = document.createElement('col');
    firstCol.style.width = `${firstPct}%`;
    colgroup.appendChild(firstCol);
    for (let i = 1; i < colCount; i += 1) {
      const col = document.createElement('col');
      col.style.width = `${otherPct}%`;
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

  const tbody = document.createElement('tbody');
  rows.slice(1).forEach((row) => {
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

  table.append(thead, tbody);
  return table;
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
 * --color-* variables defined in styles/color-swatches.css (imported via table.css).
 * @param {HTMLTableElement} table
 */
function replaceColorsRowWithSwatches(table) {
  const tbody = table.querySelector('tbody');
  if (!tbody) return;

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

  tbody.querySelectorAll('tr').forEach((tr) => {
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
    const comparisonTable = buildComparisonTable(rows);
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
