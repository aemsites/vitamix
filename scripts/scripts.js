import {
  loadHeader,
  loadFooter,
  decorateIcon,
  decorateIcons,
  decorateSections,
  decorateBlocks,
  decorateTemplateAndTheme,
  waitForFirstImage,
  loadSection,
  loadSections,
  loadCSS,
  createOptimizedPicture,
  sampleRUM,
  loadScript,
} from './aem.js';

/**
 * Load fonts.css and set a session storage flag.
 */
async function loadFonts() {
  await loadCSS(`${window.hlx.codeBasePath}/styles/fonts.css`);
  try {
    if (!window.location.hostname.includes('localhost')) sessionStorage.setItem('fonts-loaded', 'true');
  } catch (e) {
    // do nothing
  }
}

function swapIcon(icon) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(async (entry) => {
      if (entry.isIntersecting) {
        const resp = await fetch(icon.src);
        const temp = document.createElement('div');
        temp.innerHTML = await resp.text();
        const svg = temp.querySelector('svg');
        temp.remove();
        // check if svg has inline styles
        let style = svg.querySelector('style');
        if (style) style = style.textContent.toLowerCase().includes('currentcolor');
        const fill = [...svg.querySelectorAll('[fill]')].some(
          (el) => el.getAttribute('fill').toLowerCase().includes('currentcolor'),
        );
        // replace image with SVG, ensuring color inheritance
        if ((style || fill) || (!style && !fill)) {
          icon.replaceWith(svg);
        }
        observer.disconnect();
      }
    });
  }, { threshold: 0 });
  observer.observe(icon);
}

/**
 * Replaces image icons with inline SVGs when they enter the viewport.
 */
export function swapIcons() {
  document.querySelectorAll('span.icon > img[src]').forEach((icon) => {
    swapIcon(icon);
  });
}

export function buildIcon(name, modifier) {
  const icon = document.createElement('span');
  icon.className = `icon icon-${name}`;
  if (modifier) icon.classList.add(modifier);
  decorateIcon(icon);
  return icon;
}

function buildCarouselIndices(carousel, indices, visibleSlides = 1) {
  indices.innerHTML = '';
  const slides = [...carousel.children];
  slides.forEach((s, i) => {
    const index = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', `Go to slide ${i + 1}`);
    button.setAttribute('aria-selected', !i);
    button.addEventListener('click', () => {
      indices.querySelectorAll('button').forEach((b) => {
        b.setAttribute('aria-selected', b === button);
      });
      carousel.scrollTo({
        left: i * (carousel.clientWidth / visibleSlides),
        behavior: 'smooth',
      });
    });
    index.append(button);
    indices.append(index);
  });
}

/**
 * Initializes and builds a scrollable carousel with navigation controls.
 * @param {HTMLElement} container - Container element that wraps the carousel `<ul>`.
 * @param {number} [visibleSlides=1] - Number of slides visible at a time.
 * @param {boolean} [pagination=true] - Whether to display pagination indicators.
 * @returns {HTMLElement} Carousel container.
 */
export function buildCarousel(container, visibleSlides = 1, pagination = true) {
  const carousel = container.querySelector('ul');
  if (!carousel) return null;
  const slides = [...carousel.children];
  if (!slides || slides.length <= 0) return null;
  container.classList.add('carousel');

  // build navigation
  const navEl = document.createElement('nav');
  navEl.setAttribute('aria-label', 'Carousel navigation');
  container.append(navEl);

  // build arrows
  ['Previous', 'Next'].forEach((label, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', `${label} frame`);
    button.className = `nav-arrow nav-arrow-${label.toLowerCase()}`;
    // button.innerHTML = label === 'Previous' ? '&#xE959;' : '&#xe958;';
    button.addEventListener('click', () => {
      const slideWidth = carousel.scrollWidth / slides.length;
      carousel.scrollBy({
        left: !i ? -slideWidth * visibleSlides : slideWidth * visibleSlides,
        behavior: 'smooth',
      });
    });
    navEl.append(button);
  });

  if (pagination) {
    // build indices
    const indices = document.createElement('ul');
    navEl.append(indices);
    buildCarouselIndices(carousel, indices, visibleSlides);

    carousel.addEventListener('scroll', () => {
      const { scrollLeft, clientWidth } = carousel;
      const current = Math.round(scrollLeft / (clientWidth * visibleSlides));
      [...indices.querySelectorAll('button')].forEach((btn, i) => {
        btn.setAttribute('aria-selected', i === current);
      });
    });
  }

  // enable scroll
  carousel.addEventListener('scroll', () => {
    const { scrollLeft } = carousel;
    const slideWidth = carousel.scrollWidth / slides.length;
    const prev = container.querySelector('.nav-arrow-previous');
    const next = container.querySelector('.nav-arrow-next');
    [prev, next].forEach((b) => {
      b.disabled = false;
    });
    const current = Math.round(scrollLeft / slideWidth);
    if (current < 1) prev.disabled = true;
    else if (current >= (slides.length - visibleSlides)) next.disabled = true;
  });

  // if only one frame, hide navigation
  if (slides.length <= visibleSlides) navEl.style.visibility = 'hidden';
  return container;
}

/**
 * Builds all synthetic blocks in a container element.
 * @param {Element} main The container element
 */
function buildAutoBlocks() {
  try {
    // build auto blocks
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Auto Blocking failed', error);
  }
}

/**
 * Decorates links with appropriate classes to style them as buttons
 * @param {HTMLElement} main The main container element
 */
function decorateButtons(main) {
  main.querySelectorAll('p a[href]').forEach((a) => {
    a.title = a.title || a.textContent;
    const p = a.closest('p');
    const text = a.textContent.trim();
    // identify standalone links
    if (a.href !== text && p.textContent.trim() === text) {
      a.className = 'button';
      const strong = a.closest('strong');
      const em = a.closest('em');
      if (strong && em) {
        a.classList.add('accent');
        const outer = strong.contains(em) ? strong : em;
        outer.replaceWith(a);
      } else if (strong) {
        a.classList.add('emphasis');
        strong.replaceWith(a);
      } else if (em) {
        a.classList.add('link');
        em.replaceWith(a);
      }
      p.className = 'button-wrapper';
    }
  });
  // collapse adjacent button wrappers
  const wrappers = main.querySelectorAll('p.button-wrapper');
  let previousWrapper = null;
  wrappers.forEach((wrapper) => {
    if (previousWrapper && previousWrapper.nextElementSibling === wrapper) {
      // move all buttons from the current wrapper to the previous wrapper
      previousWrapper.append(...wrapper.childNodes);
      // remove the empty wrapper
      wrapper.remove();
    } else previousWrapper = wrapper; // now set the current wrapper as the previous wrapper
  });
}

function decorateImages(main) {
  main.querySelectorAll('p img').forEach((img) => {
    const p = img.closest('p');
    p.className = 'img-wrapper';
  });
}

function decorateEyebrows(main) {
  main.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
    const prev = h.previousElementSibling;
    if (prev && prev.tagName === 'P') {
      const disqualifiers = prev.querySelector('img, a[href]');
      if (disqualifiers) return;
      prev.classList.add('eyebrow');
      h.dataset.eyebrow = prev.textContent;
    }
  });
}

function decorateDisclaimers(main) {
  main.querySelectorAll('sub').forEach((sub) => {
    const p = sub.closest('p');
    if (p) p.classList.add('disclaimer');
  });
}

function decorateSectionBackgrounds(main) {
  main.querySelectorAll('.section.banner[data-background]').forEach((section) => {
    const { background } = section.dataset;
    const backgroundPicture = createOptimizedPicture(background, '', false, [
      { media: '(min-width: 800px)', width: '2880' },
      { width: '1600' },
    ]);
    backgroundPicture.classList.add('section-background-image');
    section.prepend(backgroundPicture);
    const text = section.textContent.trim();
    if (text) section.classList.add('overlay');
  });

  main.querySelectorAll('.section.light, .section.dark').forEach((section) => {
    const setCollapse = (el, position) => {
      const existing = el.dataset.collapse;
      if (existing === (position === 'top' ? 'bottom' : 'top')) {
        el.dataset.collapse = 'both';
      } else if (!existing) el.dataset.collapse = position;
    };

    setCollapse(section.previousElementSibling, 'bottom');
    setCollapse(section.nextElementSibling, 'top');
  });
}

function decorateSectionAnchors(main) {
  main.querySelectorAll('.section[data-anchor]').forEach((section) => {
    const { anchor } = section.dataset;
    section.id = anchor;
  });
}

function autolinkModals(doc) {
  doc.addEventListener('click', async (e) => {
    const origin = e.target.closest('a');
    if (origin && origin.href && origin.href.includes('/modals/')) {
      e.preventDefault();
      const { openModal } = await import(`${window.hlx.codeBasePath}/blocks/modal/modal.js`);
      openModal(origin.href);
    }
  });
}

/**
 * Decorates the main element.
 * @param {Element} main The main element
 */
// eslint-disable-next-line import/prefer-default-export
export function decorateMain(main) {
  decorateIcons(main);
  decorateImages(main);
  buildAutoBlocks(main);
  decorateSections(main);
  decorateSectionAnchors(main);
  decorateSectionBackgrounds(main);
  decorateBlocks(main);
  decorateButtons(main);
  decorateEyebrows(main);
  decorateDisclaimers(main);
}

/**
 * Loads everything needed to get to LCP.
 * @param {Element} doc The container element
 */
async function loadEager(doc) {
  document.documentElement.lang = 'en';
  decorateTemplateAndTheme();
  const main = doc.querySelector('main');
  if (main) {
    decorateMain(main);
    document.body.classList.add('appear');
    await loadSection(main.querySelector('.section'), waitForFirstImage);
  }

  sampleRUM.enhance();

  try {
    /* if desktop (proxy for fast connection) or fonts already loaded, load fonts.css */
    if (window.innerWidth >= 900 || sessionStorage.getItem('fonts-loaded')) {
      loadFonts();
    }
  } catch (e) {
    // do nothing
  }
}

/**
 * Loads everything that doesn't need to be delayed.
 * @param {Element} doc The container element
 */
async function loadLazy(doc) {
  const main = doc.querySelector('main');
  loadHeader(doc.querySelector('header'));
  await loadSections(main);

  const { hash } = window.location;
  const element = hash ? doc.getElementById(hash.substring(1)) : false;
  if (hash && element) element.scrollIntoView();

  loadFooter(doc.querySelector('footer'));

  loadCSS(`${window.hlx.codeBasePath}/styles/lazy-styles.css`);
  loadFonts();
  swapIcons(main);
  autolinkModals(document);
}

/**
 * Loads everything that happens a lot later,
 * without impacting the user experience.
 */
function loadDelayed() {
  // eslint-disable-next-line import/no-cycle
  const params = new URLSearchParams(window.location.search);
  if (params.get('martech') !== 'off') {
    window.setTimeout(() => import('./delayed.js'), 4000);
  }
  // load anything that can be postponed to the latest here
}

async function loadPage() {
  await loadEager(document);
  await loadLazy(document);
  loadDelayed();
}

// UE Editor support
if (window.location.hostname.includes('ue.da.live')) {
  // eslint-disable-next-line import/no-unresolved
  import(`${window.hlx.codeBasePath}/ue/scripts/ue.js`).then(({ default: ue }) => ue());
}

loadPage();

// DA Live Preview
(async function loadDa() {
  if (!new URL(window.location.href).searchParams.get('dapreview')) return;
  // eslint-disable-next-line import/no-unresolved
  import('https://da.live/scripts/dapreview.js').then(({ default: daPreview }) => daPreview(loadPage));
}());
