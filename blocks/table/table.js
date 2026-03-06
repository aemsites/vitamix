import { toClassName } from '../../scripts/aem.js';

const COLOR_SWATCHES_CSS_PATH = '/blocks/pdp/color-swatches.css';

/**
 * Fetch color-swatches.css, parse --color-* names and the rule body, inject a scoped
 * <style> so .table.comparison .table-comparison-color-swatch gets the same variables,
 * and return the set of color names for matching.
 * @returns {Promise<Set<string>>}
 */
async function loadColorSwatchesForTable() {
  const base = typeof window.hlx?.codeBasePath === 'string' ? window.hlx.codeBasePath : '';
  const url = `${base}${COLOR_SWATCHES_CSS_PATH}`;
  const res = await fetch(url);
  if (!res.ok) return new Set();
  const css = await res.text();

  const names = new Set([...css.matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1]));

  const open = css.indexOf('{');
  if (open === -1) return names;
  let depth = 1;
  let pos = open + 1;
  while (depth && pos < css.length) {
    if (css[pos] === '{') depth += 1;
    else if (css[pos] === '}') depth -= 1;
    pos += 1;
  }
  const body = css.slice(open + 1, pos - 1);

  const style = document.createElement('style');
  style.textContent = `.table.comparison .table-comparison-color-swatch { ${body} }`;
  document.head.appendChild(style);

  return names;
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
  swatch.className = 'table-comparison-color-swatch';
  swatch.title = label || slug;
  const inner = document.createElement('div');
  inner.className = 'table-comparison-color-inner';
  inner.style.backgroundColor = `var(--color-${slug})`;
  swatch.appendChild(inner);
  return swatch;
}

function replaceColorsRowWithSwatches(table, colorNames) {
  if (!colorNames?.size) return;
  const tbody = table.querySelector('tbody');
  if (!tbody) return;
  tbody.querySelectorAll('tr').forEach((tr) => {
    tr.querySelectorAll('td').forEach((td) => {
      const text = td.textContent.trim();
      const tokens = text.split(',').map((t) => t.trim()).filter(Boolean);
      if (tokens.length === 0) return;
      const hasMatchingColor = tokens.some((t) => colorNames.has(toClassName(t)));
      if (!hasMatchingColor) return;
      const swatchContainer = document.createElement('div');
      swatchContainer.className = 'table-comparison-color-swatches';
      tokens.forEach((token) => {
        const slug = toClassName(token);
        if (colorNames.has(slug)) {
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
}

export default function decorate(block) {
  const table = document.createElement('table');
  const rows = [...block.children];
  const hasRowHeaders = block.classList.contains('row-headers');
  const isComparison = block.classList.contains('comparison');

  if (isComparison) {
    const comparisonTable = buildComparisonTable(rows);
    loadColorSwatchesForTable().then((colorNames) => {
      replaceColorsRowWithSwatches(comparisonTable, colorNames);
    });
    const scrollWrapper = document.createElement('div');
    scrollWrapper.className = 'table-comparison-scroll';
    scrollWrapper.appendChild(comparisonTable);
    block.replaceChildren(scrollWrapper);
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
