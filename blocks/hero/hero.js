import { createOptimizedPicture } from '../../scripts/aem.js';
import { buildVideo, applyImgColor } from '../../scripts/scripts.js';

export default function decorate(block) {
  const isAligned = block.classList.contains('left') || block.classList.contains('right');

  if (isAligned) {
    const picture = block.querySelector('picture');
    if (picture) {
      const img = picture.querySelector('img');
      const optimized = createOptimizedPicture(img.src, img.alt, false, [{ width: '2000' }]);

      // find the direct-child row of block that contains the picture
      let imageRow = picture;
      while (imageRow.parentElement !== block) imageRow = imageRow.parentElement;

      // append optimized picture to block as background before removing the row
      block.appendChild(optimized);
      imageRow.remove();

      const newImg = optimized.querySelector('img');
      if (newImg.complete) applyImgColor(block);
      else newImg.addEventListener('load', () => applyImgColor(block));
    }

    block.classList.add(block.classList.contains('right') ? 'right-text' : 'left-text');
  } else {
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
