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

export default function decorate(block) {
  const table = document.createElement('table');
  const rows = [...block.children];
  const hasRowHeaders = block.classList.contains('row-headers');

  if (hasRowHeaders) {
    // build table with row headers (first column is header)
    const tbody = document.createElement('tbody');
    rows.forEach((row) => {
      tbody.appendChild(buildRowWithRowHeaders(row));
    });
    table.appendChild(tbody);
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
  }

  block.replaceChildren(table);
}
