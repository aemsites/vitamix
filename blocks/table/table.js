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
    thead.appendChild(buildRow(rows[0], 'th'));
  }

  const tbody = document.createElement('tbody');
  rows.slice(1).forEach((row) => {
    const tr = document.createElement('tr');
    [...row.children].forEach((col, index) => {
      const cell = document.createElement(index === 0 ? 'th' : 'td');
      if (index === 0) {
        cell.setAttribute('scope', 'row');
        const wrap = document.createElement('div');
        wrap.className = 'table-comparison-cell-content';
        wrap.innerHTML = col.innerHTML;
        cell.appendChild(wrap);
      } else {
        cell.innerHTML = col.innerHTML;
      }
      tr.appendChild(cell);
    });
    tbody.appendChild(tr);
  });

  table.append(thead, tbody);
  return table;
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
