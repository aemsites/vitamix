import { createOptimizedPicture } from '../../scripts/aem.js';
import { buildVideo, applyImgColor } from '../../scripts/scripts.js';

export default function decorate(block) {
  const isAligned = block.classList.contains('left') || block.classList.contains('right');

  if (isAligned) {
    // Hoist the picture out of its table cell and append directly to the block
    // so it can be positioned as a full-bleed background via CSS.
    // Block DOM is: block > div (row) > div (cell) > picture
    const picture = block.querySelector('picture');
    if (picture) {
      const img = picture.querySelector('img');
      const optimized = createOptimizedPicture(img.src, img.alt, false, [{ width: '2000' }]);
      block.appendChild(optimized);

      // remove only the row that contained the image, not any other rows
      const imgRow = picture.closest(':scope > div', block) || picture.closest('div');
      // walk up until we find a direct child of block
      let el = picture;
      while (el.parentElement !== block) el = el.parentElement;
      el.remove();

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
