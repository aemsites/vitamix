export default function decorate(block) {
  const cards = [...block.querySelectorAll(':scope > div')].map((row) => {
    const [titleCell, bodyCell] = row.querySelectorAll(':scope > div');
    const card = document.createElement('div');
    card.className = 'feature-card';

    const header = document.createElement('div');
    header.className = 'feature-card-header';

    const icon = titleCell.querySelector('img, svg, picture');
    if (icon) {
      const iconWrap = document.createElement('span');
      iconWrap.className = 'feature-card-icon';
      iconWrap.appendChild(icon.closest('picture') || icon);
      header.appendChild(iconWrap);
    }

    const title = document.createElement('span');
    title.className = 'feature-card-title';
    title.innerHTML = titleCell.textContent.trim();
    header.appendChild(title);

    const body = document.createElement('div');
    body.className = 'feature-card-body';
    body.innerHTML = bodyCell.innerHTML;

    card.append(header, body);
    return card;
  });

  block.innerHTML = '';
  block.append(...cards);
}
