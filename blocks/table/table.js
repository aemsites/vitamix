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

export default function decorate(block) {
  const table = document.createElement('table');
  const rows = [...block.children];

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
