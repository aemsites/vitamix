import { buildCarousel } from '../../scripts/scripts.js';
import { getMetadata } from '../../scripts/aem.js';
import { embedYoutube } from '../video/video.js';
import { createModal } from '../modal/modal.js';

/**
 * Checks if a link is a YouTube video.
 * @param {HTMLElement} el - Link element
 * @returns {boolean}
 */
function isVideo(el) {
  return el.href.startsWith('https://www.youtube.com/watch?v=') || el.href.startsWith('https://youtu.be/');
}

/**
 * Accepts an element and returns clean <li> > <picture> structure.
 * @param {HTMLElement} el - Wrapper element
 * @param {string} source - Source of slide
 * @returns {HTMLLIElement|null}
 */
export function buildSlide(el, source) {
  const picture = el.tagName === 'PICTURE' ? el : el.querySelector('picture');
  if (!picture) return null;

  const a = el.querySelector('a');
  if (a && isVideo(a)) {
    a.className = 'video-wrapper';
    a.textContent = '';
    if (picture) a.append(picture);
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const video = embedYoutube(new URL(a.href), true, false);
      a.replaceWith(video);
    });
  }

  const li = document.createElement('li');
  if (source) li.dataset.source = source;
  li.append(a || picture);
  return li;
}

/**
 * Builds thumbnail images for the carousel nav buttons.
 * @param {Element} carousel - Carousel container element.
 */
export function buildThumbnails(carousel) {
  const imgs = carousel.querySelectorAll('li img');
  const indices = carousel.querySelectorAll('nav [role="radiogroup"] button');

  // scroll selected thumbnail into view on selection
  const observer = new MutationObserver(() => {
    const selected = carousel.querySelector('nav [role="radiogroup"] button[aria-checked="true"]');
    if (selected) selected.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  });

  indices.forEach((btn, i) => {
    const img = imgs[i];
    if (!img) return;

    const imgLi = img.closest('li');
    const { source } = imgLi.dataset;

    const thumb = img.cloneNode(true);
    if (source) btn.dataset.source = source;
    if (img.closest('a.video-wrapper')) {
      btn.classList.add('video-thumbnail');
    }
    btn.replaceChildren(thumb);

    // track aria-checked updates
    observer.observe(btn, { attributes: true, attributeFilter: ['aria-checked'] });
  });
}

/**
 * Renders the gallery section of the PDP block.
 * @param {Element} block - The PDP block element
 * @returns {Element} The gallery container element
 */
export default function renderGallery(block, variants) {
  const gallery = document.createElement('div');
  gallery.className = 'gallery';
  const wrapper = document.createElement('ul');
  gallery.append(wrapper);

  // prioritize LCP image in gallery
  const lcp = block.querySelector('.lcp-image');
  let lcpSrc;
  if (lcp) {
    const lcpSlide = buildSlide(lcp, 'lcp');
    if (lcpSlide) {
      wrapper.prepend(lcpSlide);
      lcpSrc = new URL(lcpSlide.querySelector('img').src).pathname;
    }
  }

  [...block.querySelectorAll('.button-wrapper a')].forEach((el) => {
    if (isVideo(el)) {
      const parent = el.parentElement;
      const div = document.createElement('div');
      div.className = 'video-wrapper';
      div.append(el.previousElementSibling);
      div.append(el);
      parent.append(div);
    }
  });

  if (variants && variants.length === 0) {
    const fallbackImages = block.querySelectorAll('.img-wrapper, .video-wrapper');
    [...fallbackImages].forEach((el) => {
      const slide = buildSlide(el, 'lcp');
      if (slide) wrapper.append(slide);
    });
  }

  if (variants && variants.length > 0) {
    const defaultVariant = variants[0];

    // check if bundle (should skip variant images)
    const bundle = getMetadata('type') === 'bundle';
    let variantImages = bundle ? [] : defaultVariant.images || [];
    variantImages = [...variantImages].map((v, i) => {
      const clone = v.cloneNode(true);
      clone.dataset.source = i ? 'variant' : 'lcp';
      return clone;
    });

    // grab fallback images
    const fallbackImages = block.querySelectorAll('.img-wrapper');
    const fallbackVideos = block.querySelectorAll('.video-wrapper');

    // store clones for reset functionality
    window.defaultProductImages = Array.from(fallbackImages).map((img) => img.cloneNode(true));

    // append slides from images
    [...variantImages, ...fallbackImages, ...fallbackVideos].forEach((el) => {
      const { source } = el.dataset;
      const slide = buildSlide(el, source);
      if (slide) {
        const src = new URL(slide.querySelector('img').src).pathname;
        // don't duplicate LCP image
        if (src !== lcpSrc) wrapper.append(slide);
      }
    });
  }

  const carousel = buildCarousel(gallery);
  buildThumbnails(carousel);

  // Add click-to-zoom on non-video slides (desktop only)
  const desktopQuery = window.matchMedia('(min-width: 900px)');
  carousel.querySelectorAll(':scope > ul > li').forEach((li) => {
    const pic = li.querySelector('picture');
    if (!pic || li.querySelector('a.video-wrapper')) return;
    li.classList.add('zoomable');
    li.addEventListener('click', async () => {
      if (!desktopQuery.matches) return;
      const img = pic.querySelector('img');
      if (!img) return;
      const modalPicture = pic.cloneNode(true);
      const modalImg = modalPicture.querySelector('img');
      modalImg.removeAttribute('width');
      modalImg.removeAttribute('height');
      modalImg.removeAttribute('loading');
      const { showModal } = await createModal(
        [modalPicture],
        '/modals/gallery-image',
      );
      showModal();
    });
  });

  return carousel;
}
