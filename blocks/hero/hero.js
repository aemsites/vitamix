import { createOptimizedPicture } from '../../scripts/aem.js';
import { buildVideo, applyImgColor } from '../../scripts/scripts.js';

export default function decorate(block) {
  // set background
  buildVideo(block);
  const img = block.querySelector('picture img');
  if (img) {
    img.closest('picture').replaceWith(createOptimizedPicture(img.src, img.alt, false, [{ width: '2000' }]));
    if (img.complete) applyImgColor(block);
    else if (img.tagName === 'IMG') {
      img.addEventListener('load', () => {
        applyImgColor(block);
      });
    }
  }

  const disclaimer = block.querySelector('.disclaimer');
  if (disclaimer) {
    block.dataset.disclaimer = disclaimer.textContent;
  }
}
