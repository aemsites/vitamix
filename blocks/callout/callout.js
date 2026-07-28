/**
 * Returns true if the column contains only image content (pictures/imgs).
 * @param {Element} col
 * @returns {boolean}
 */
function isImageCol(col) {
  const images = col.querySelectorAll('picture, img');
  if (images.length === 0) return false;
  const textContent = col.textContent.trim();
  return textContent === '';
}

/** @param {Element} block */
export default function decorate(block) {
  const [variant] = [...block.classList].filter((c) => c !== 'block' && c !== 'callout');
  const rows = [...block.children];

  rows.forEach((row) => {
    const cols = [...row.children];
    cols.forEach((col) => {
      if (isImageCol(col)) {
        col.className = 'img-col';
        if (variant) col.style.setProperty('background', `var(--color-${variant})`);
      } else col.className = 'text-col';
    });

    const imageIndex = cols.findIndex((col) => col.className === 'img-col');
    if (imageIndex === 0) row.dataset.img = 'left';
    else if (imageIndex > 0) row.dataset.img = 'right';
  });
}
