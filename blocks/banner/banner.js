import { buildVideo } from '../../scripts/scripts.js';

export default function decorate(block) {
  [...block.querySelectorAll('div img, div svg')].forEach((img) => {
    const closestBlock = img.closest('.block');
    if (closestBlock !== block) return; // skip nested blocks
    const wrapper = img.closest('div');
    if (wrapper.children.length === 1) wrapper.className = 'img-wrapper';
  });

  const video = buildVideo(block);
  if (video) {
    const wrapper = video.closest('div');
    wrapper.classList.add('vid-wrapper', 'img-wrapper');
  }

  const variants = [...block.classList].filter((c) => c !== 'block' && c !== 'banner');
  if (variants.includes('narrow-media')) {
    block.classList.add('split');
    variants.push('split');
  }
  if (variants.includes('split')) {
    block.parentElement.classList.add('split');
  }
}