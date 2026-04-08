import { createOptimizedPicture } from '../../scripts/aem.js';
import { buildVideo, applyImgColor } from '../../scripts/scripts.js';

export default function decorate(block) {
  const isAligned = block.classList.contains('left') || block.classList.contains('right');

  if (isAligned) {
    // Hoist the picture out of its table cell and append directly to the block
    // so it can be positioned as a full-bleed background via CSS
    const picture = block.querySelector('picture');
    if (picture) {
      const img = picture.querySelector('img');
      const optimized = createOptimizedPicture(img.src, img.alt, false, [{ width: '2000' }]);
      block.appendChild(optimized);

      // clean up the now-empty cell/row
      const imgCell = picture.closest('div');
      if (imgCell) imgCell.remove();

      const newImg = optimized.querySelector('img');
      if (newImg.complete) applyImgColor(block);
      else newImg.addEventListener('load', () => applyImgColor(block));
    }

    block.classList.add(block.classList.contains('right') ? 'right-text' : 'left-text');
  } else {
    // default hero behaviour
    buildVideo(block);
    const img = block.querySelector('picture img');
    if (img) {
      img.closest('picture').replaceWith(createOptimizedPicture(img.src, img.alt, false, [{ width: '2000' }]));
      if (img.complete) applyImgColor(block);
      else if (img.tagName === 'IMG') {
        img.addEventListener('load', () => applyImgColor(block));
      }
    }
  }

  const disclaimer = block.querySelector('.disclaimer');
  if (disclaimer) {
    block.dataset.disclaimer = disclaimer.textContent;
  }
}
