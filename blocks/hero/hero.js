import { createOptimizedPicture } from '../../scripts/aem.js';
import { buildVideo, applyImgColor } from '../../scripts/scripts.js';

/**
 * Detects layout from column count.
 * @param {Element} block
 */
function detectLayout(block) {
  const row = block.firstElementChild;
  if (!row) return;
  const cells = [...row.children];

  if (cells.length >= 2) {
    block.classList.add('split');
    cells.forEach((cell) => {
      if (cell.querySelector('picture') || cell.querySelector('a[href*=".mp4"]')) {
        cell.className = 'img-wrapper';
      } else cell.classList.add('text-wrapper');
    });
    const imgIndex = cells.findIndex((c) => c.classList.contains('img-wrapper'));
    block.classList.add(imgIndex === 0 ? 'left-text' : 'right-text');
  }
}

/** @param {Element} block */
export default function decorate(block) {
  detectLayout(block);
  buildVideo(block);

  const override = [...block.classList].filter((c) => c === 'dark' || c === 'light')[0];
  if (override) {
    block.style.setProperty('--image-color', override === 'dark' ? 'black' : 'white');
    block.classList.add(`image-${override}est`);
  }

  const img = block.querySelector('picture img');
  if (img) {
    const picture = createOptimizedPicture(img.src, img.alt, false, [{ width: '2000' }]);
    img.closest('picture').replaceWith(picture);
    if (!override) {
      const newImg = picture.querySelector('img');
      if (newImg.complete) applyImgColor(block);
      else newImg.addEventListener('load', () => applyImgColor(block));
    }
  }

  const disclaimer = block.querySelector('.disclaimer');
  if (disclaimer) {
    block.dataset.disclaimer = disclaimer.textContent;
  }
}
