import { buildVideo } from '../../scripts/scripts.js';

/**
 * Returns `true` if a cell contains only media with no text.
 * @param {Element} cell - Direct child div of the block row
 * @returns {boolean}
 */
function isMediaCell(cell) {
  if (!cell.querySelector('picture') && !cell.querySelector('svg') && !cell.querySelector('a[href*=".mp4"]')) return false;
  return [...cell.children].every((child) => {
    if (child.tagName === 'PICTURE' || child.tagName === 'SVG') return true;
    if (child.tagName !== 'P') return false;
    const children = [...child.children];
    if (children.length === 1 && (children[0].tagName === 'PICTURE' || children[0].tagName === 'SVG')) return true;
    return !!child.querySelector('a[href*=".mp4"]');
  });
}

/**
 * Returns the perceived luminance (0–255) of an element's computed background color.
 * @param {Element} el - Element with a resolved background-color
 * @returns {number}
 */
function getLuminance(el) {
  const [r, g, b] = getComputedStyle(el).backgroundColor.match(/\d+/g).map(Number);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

export default function decorate(block) {
  const variants = [...block.classList].filter((c) => c !== 'block' && c !== 'banner');
  const rows = [...block.children];
  rows.forEach((row) => {
    const cells = [...row.children];
    cells.forEach((cell) => {
      cell.className = isMediaCell(cell) ? 'img-wrapper' : 'text-wrapper';
    });
  });

  const firstRow = block.firstElementChild;
  if (firstRow) {
    const imgIndex = [...firstRow.children].findIndex((c) => c.classList.contains('img-wrapper'));
    if (imgIndex !== -1) block.classList.add(imgIndex === 0 ? 'left-text' : 'right-text');
  }

  const video = buildVideo(block);
  if (video) {
    const wrapper = video.closest('div');
    wrapper.classList.add('vid-wrapper');
    const picture = wrapper.querySelector('picture');
    if (picture) {
      const img = picture.querySelector('img');
      if (img) video.poster = img.src;
      (picture.closest('p') || picture).remove();
    }
  }

  if (!variants.includes('inset') && !variants.includes('image')) {
    block.parentElement.classList.add('fill');
  }

  const colorOverride = variants.find(
    (c) => getComputedStyle(document.documentElement).getPropertyValue(`--color-${c}`).trim(),
  );
  if (colorOverride) {
    block.style.setProperty('--banner-color', `var(--color-${colorOverride})`);
    const luminance = getLuminance(block.firstElementChild);
    block.classList.add(luminance > 128 ? 'light' : 'dark');
    block.parentElement.classList.add('fill');
  }
}
