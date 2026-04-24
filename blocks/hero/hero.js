import { createOptimizedPicture } from '../../scripts/aem.js';
import { buildVideo, applyImgColor } from '../../scripts/scripts.js';

/**
 * Returns `true` if a cell contains only pictures and/or video links, with no text content.
 * @param {Element} cell - Direct child div of a block row
 * @returns {boolean}
 */
function isMediaCell(cell) {
  if (!cell.querySelector('picture') && !cell.querySelector('a[href*=".mp4"]')) return false;
  return [...cell.children].every((child) => {
    if (child.tagName === 'PICTURE') return true;
    if (child.tagName !== 'P') return false;
    const children = [...child.children];
    if (children.length === 1 && children[0].tagName === 'PICTURE') return true;
    return !!child.querySelector('a[href*=".mp4"]');
  });
}

/**
 * Detects layout from column count and marks background images with data-bg.
 * @param {Element} block - Hero block element
 */
function detectLayout(block) {
  const row = block.firstElementChild;
  if (!row) return;
  const cells = [...row.children];

  if (cells.length >= 2) {
    block.classList.add('split');
    cells.forEach((cell) => {
      if (isMediaCell(cell)) {
        cell.className = 'img-wrapper';
        const bgPicture = cell.querySelector('picture');
        if (bgPicture) bgPicture.dataset.bg = '';
      } else cell.classList.add('text-wrapper');
    });
    const imgIndex = cells.findIndex((c) => c.classList.contains('img-wrapper'));
    block.classList.add(imgIndex === 0 ? 'left-text' : 'right-text');
  } else {
    const cell = row.firstElementChild;
    if (!cell) return;
    const [picture] = [...cell.querySelectorAll('picture')];
    if (picture) picture.dataset.bg = '';
  }
}

/** @param {Element} block */
export default function decorate(block) {
  detectLayout(block);
  buildVideo(block);

  const colorOverride = [...block.classList].find(
    (c) => getComputedStyle(document.documentElement).getPropertyValue(`--color-${c}`).trim(),
  );
  if (colorOverride) {
    block.style.setProperty('--image-color', `var(--color-${colorOverride})`);
    block.classList.add('image-tint');
  }

  const bgPicture = block.querySelector('picture[data-bg]');
  if (bgPicture) {
    const bgImg = bgPicture.querySelector('img');
    const optimizedBg = createOptimizedPicture(bgImg.src, bgImg.alt, false, [{ width: '2000' }]);
    optimizedBg.dataset.bg = '';
    bgPicture.replaceWith(optimizedBg);
    if (!colorOverride) {
      const newImg = optimizedBg.querySelector('img');
      if (newImg.complete) applyImgColor(block);
      else newImg.addEventListener('load', () => applyImgColor(block));
    }
  }

  const disclaimer = block.querySelector('.disclaimer');
  if (disclaimer) {
    block.dataset.disclaimer = disclaimer.textContent;
  }
}
