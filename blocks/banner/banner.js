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

/**
 * Promo Bar block
 * A short, full-width promotional strip.
 *
 * Authoring (DA table):
 *   | Promo Bar                                                  |
 *   | (optional) background image — single cell, image only       |
 *   | product image | title (+ optional paragraph) | CTA link      |
 *
 * The product image and paragraph are optional.
 * Variants: light, or any color token name (e.g. "red" -> var(--color-red)).
 */

/**
 * Returns `true` if a cell contains only media (picture/img/svg) and no text.
 * @param {Element} cell
 * @returns {boolean}
 */
function isMediaCell(cell) {
  if (!cell.querySelector('picture, img, svg')) return false;
  return !cell.textContent.trim();
}

/**
 * Returns `true` if a cell contains only links (the CTA cell).
 * @param {Element} cell
 * @returns {boolean}
 */
function isCtaCell(cell) {
  const links = [...cell.querySelectorAll('a[href]')];
  if (!links.length) return false;
  const linkText = links.map((a) => a.textContent.trim()).join('');
  return cell.textContent.replace(/\s/g, '') === linkText.replace(/\s/g, '');
}

/**
 * Returns the perceived luminance (0–255) of an element's background color.
 * @param {Element} el
 * @returns {number}
 */
function getLuminance(el) {
  const [r, g, b] = getComputedStyle(el).backgroundColor.match(/\d+/g).map(Number);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

export default function decorate(block) {
  const variants = [...block.classList].filter((c) => c !== 'block' && c !== 'promo-bar');
  const rows = [...block.children];

  // optional background row: a single cell containing only an image
  const bgRow = rows.find((row) => row.children.length === 1 && isMediaCell(row.firstElementChild));
  const contentRow = rows.find((row) => row !== bgRow) || rows[0];

  const inner = document.createElement('div');
  inner.className = 'promo-bar-inner';

  [...contentRow.children].forEach((cell) => {
    if (isMediaCell(cell)) {
      cell.className = 'promo-bar-image';
    } else if (isCtaCell(cell)) {
      cell.className = 'promo-bar-cta';
    } else {
      cell.className = 'promo-bar-content';
      // treat the first heading (or first paragraph if no heading) as the title
      const title = cell.querySelector('h1, h2, h3, h4, h5, h6') || cell.querySelector('p');
      if (title) title.classList.add('promo-bar-title');
    }
    inner.append(cell);
  });

  if (!inner.querySelector('.promo-bar-image')) block.classList.add('no-image');

  const children = [inner];
  if (bgRow) {
    const bg = bgRow.firstElementChild;
    bg.className = 'promo-bar-bg';
    children.unshift(bg);
    block.classList.add('has-bg');
  }

  block.replaceChildren(...children);

  // optional color token override, e.g. "Promo Bar (red)"
  const colorOverride = variants.find(
    (c) => getComputedStyle(document.documentElement).getPropertyValue(`--color-${c}`).trim(),
  );
  if (colorOverride) {
    block.style.setProperty('--promo-bar-color', `var(--color-${colorOverride})`);
    if (!bgRow && !variants.includes('light')) {
      block.classList.add(getLuminance(block) > 128 ? 'light' : 'dark');
    }
  }
}
