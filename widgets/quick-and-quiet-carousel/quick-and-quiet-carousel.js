import { getLocaleAndLanguage } from '../../scripts/scripts.js';

/**
 * Loads widget copy from the co-located JSON file for the given language.
 * @param {string} lang - Language key (e.g. "en", "fr")
 * @returns {Promise<Object>} Copy object for that language
 */
async function loadWidgetCopy(lang) {
  const scriptPath = new URL(import.meta.url).pathname;
  const jsonPath = scriptPath.replace(/\.js$/, '.json');
  const base = window.hlx && window.hlx.codeBasePath ? window.hlx.codeBasePath : '';
  const resp = await fetch(`${base}${jsonPath}`);
  const data = await resp.json();
  return data[lang] || data.en || {};
}

/**
 * Applies the loaded copy to the static slide markup and nav controls.
 * @param {HTMLElement} qqc - .qqc element
 * @param {Object} copy - Flat copy object with a `slides` array
 */
function applyWidgetCopy(qqc, copy) {
  const slideEls = [...qqc.querySelectorAll('.qqc-slide')];
  slideEls.forEach((slideEl, index) => {
    const slide = (copy.slides || [])[index] || {};
    slideEl.querySelector('.qqc-slide-title').textContent = slide.title || '';
    slideEl.querySelector('.qqc-slide-body').textContent = slide.body || '';
    slideEl.querySelector('.qqc-toggle').setAttribute('aria-label', copy.toggleAriaLabel || '');
  });

  qqc.querySelector('.qqc-prev').setAttribute('aria-label', copy.previous || '');
  qqc.querySelector('.qqc-next').setAttribute('aria-label', copy.next || '');
  qqc.querySelector('.qqc-more').textContent = copy.productDetails || '';
}

/**
 * Prefixes the "Product Details" link with the current locale/language
 * path segments, e.g. "/us/en_us/commercial/products/quick-and-quiet".
 * @param {HTMLElement} qqc - .qqc element
 */
function localizeMoreLink(qqc) {
  const { locale, language } = getLocaleAndLanguage();
  const link = qqc.querySelector('.qqc-more');
  link.href = `/${locale}/${language}${link.getAttribute('href')}`;
}

/**
 * Decorates the Quick & Quiet product-focus carousel: loads locale copy,
 * then wires the diagram pan/zoom, slide navigation, and description
 * accordions.
 * @param {HTMLElement} widget - The .quick-and-quiet-carousel element
 */
export default async function decorate(widget) {
  const { language } = getLocaleAndLanguage();
  const lang = (language || 'en_us').split('_')[0];
  const copy = await loadWidgetCopy(lang);

  const qqc = widget.querySelector('.qqc');
  applyWidgetCopy(qqc, copy);
  localizeMoreLink(qqc);

  const toggles = [...qqc.querySelectorAll('.qqc-toggle')];
  const setToggleText = (toggle) => {
    const label = toggle.getAttribute('aria-expanded') === 'true' ? copy.lessLabel : copy.moreLabel;
    toggle.querySelector('.qqc-toggle-text').textContent = `${label || ''} ${copy.detailsLabel || ''}`.trim();
  };

  const positioner = qqc.querySelector('.qqc-diagram-positioner');
  const container = qqc.querySelector('.qqc-container');
  const slides = [...qqc.querySelectorAll('.qqc-slide')];
  const alignment = qqc.querySelector('.qqc-diagram-alignment-aspect');
  const currentEl = qqc.querySelector('.qqc-slide-current');
  const totalEl = qqc.querySelector('.qqc-slide-total');
  const productImg = qqc.querySelector('.qqc-knockout-img');

  let index = 0;

  const pad = (n) => (n > 9 ? String(n) : `0${n}`);

  totalEl.textContent = pad(slides.length);

  function applyZoom() {
    const [x, y, scale] = (slides[index].dataset.zoom || '0,0,1').split(',').map(Number);
    const height = alignment.offsetHeight || qqc.offsetHeight;
    positioner.style.transform = `translate(${x * (height / 1080)}%, ${y * (height / 1000)}%) scale(${scale * (height / 1080)})`;
    currentEl.textContent = pad(index + 1);
  }

  function showSlide(nextIndex) {
    index = Math.max(0, Math.min(slides.length - 1, nextIndex));
    slides.forEach((slide, i) => slide.classList.toggle('is-active', i === index));
    applyZoom();
    container.classList.toggle('is-at-first-slide', index === 0);
    container.classList.toggle('is-at-last-slide', index === slides.length - 1);
  }

  function start() {
    qqc.classList.add('is-ready');
    requestAnimationFrame(() => {
      qqc.classList.add('is-initialized');
      showSlide(0);
    });
  }

  qqc.querySelector('.qqc-prev').addEventListener('click', (event) => {
    event.preventDefault();
    if (index > 0) showSlide(index - 1);
  });
  qqc.querySelector('.qqc-next').addEventListener('click', (event) => {
    event.preventDefault();
    if (index < slides.length - 1) showSlide(index + 1);
  });

  toggles.forEach((toggle) => {
    setToggleText(toggle);
    toggle.addEventListener('click', () => {
      const id = toggle.getAttribute('data-accordion-id');
      const drawer = qqc.querySelector(`.qqc-drawer[data-accordion-id="${id}"]`);
      const open = !drawer.classList.contains('is-active');
      drawer.classList.add('is-transitioning');
      drawer.classList.toggle('is-active', open);
      toggle.classList.toggle('is-active', open);
      toggle.setAttribute('aria-expanded', String(open));
      drawer.style.maxHeight = open ? `${drawer.scrollHeight}px` : '0px';
      setToggleText(toggle);
      setTimeout(() => drawer.classList.remove('is-transitioning'), 500);
    });
  });

  window.addEventListener('resize', applyZoom);

  if (productImg.complete) start();
  else productImg.addEventListener('load', start);
  productImg.addEventListener('error', start);
}
