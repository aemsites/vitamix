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
  buildBlock,
  loadScript,
  getMetadata,
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

/**
 * Replaces image icon with its SVG equivalent.
 * @param {HTMLImageElement} icon - Icon image element
 */
function swapIcon(icon) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(async (entry) => {
      if (entry.isIntersecting) {
        try {
          const resp = await fetch(icon.src);
          const temp = document.createElement('div');
          temp.innerHTML = await resp.text();
          const svg = temp.querySelector('svg');
          if (!svg) throw new Error('Icon does not contain an SVG');
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
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(`Unable to swap icon at ${icon.src}`, error);
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

/**
 * Builds and decorates an icon element.
 * @param {string} name - Icon name
 * @param {string} [modifier] - Optional icon modifier
 * @returns {HTMLElement} Decorated icon element
 */
export function buildIcon(name, modifier) {
  const icon = document.createElement('span');
  icon.className = `icon icon-${name}`;
  if (modifier) icon.classList.add(modifier);
  decorateIcon(icon);
  return icon;
}

/**
 * Builds and appends carousel index buttons for navigation.
 * @param {HTMLElement} carousel - Carousel element
 * @param {HTMLElement} indices - Container element where index buttons will be appended
 * @param {number} [visibleSlides=1] - Number of slides visible at a time
 */
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

function parseVariants(sections) {
  return sections.map((div) => {
    const name = div.querySelector('h2')?.textContent.trim();

    const metadata = {};
    const options = {};
    const metadataDiv = div.querySelector('.section-metadata');

    if (metadataDiv) {
      metadataDiv.querySelectorAll('div').forEach((meta) => {
        const key = meta.children[0]?.textContent.trim();
        const value = meta.children[1]?.textContent.trim();
        if (key && value) {
          if (key === 'sku') {
            metadata[key] = value;
          } else {
            options[key] = value;
          }
        }
      });
    }

    const imagesHTML = div.querySelectorAll('picture');

    return {
      ...metadata,
      name,
      options,
      images: imagesHTML,
    };
  });
}

/**
 * Builds hero block and prepends to main in a new section.
 * @param {Element} main The container element
 */
function buildPDPBlock(main) {
  const section = document.createElement('div');
  const type = document.head.querySelector('meta[name="type"]')?.content;

  const isValidType = ['simple', 'configurable', 'bundle'].includes(type);
  if (isValidType) {
    const lcpPictureSelector = type === 'simple'
      ? 'picture:first-of-type'
      : 'div:nth-child(2) picture';

    const lcpPicture = main.querySelector(lcpPictureSelector);
    const lcpImage = lcpPicture?.querySelector('img');
    if (lcpImage) {
      lcpImage.loading = 'eager';
    }

    const selectedImage = document.createElement('div');
    selectedImage.classList.add('lcp-image');
    selectedImage.append(lcpPicture.cloneNode(true));

    const lcp = main.querySelector('div:first-child');
    lcp.append(selectedImage);
    lcp.remove();

    if (type === 'simple') {
      lcpPicture.remove();
    }

    section.append(buildBlock('pdp', { elems: [...lcp.children] }));
  }

  const variantSections = Array.from(main.querySelectorAll(':scope > div'));
  window.variants = parseVariants(variantSections);

  const navMeta = document.head.querySelector('meta[name="nav"]');
  if (!navMeta) {
    [
      ['nav', '/us/en_us/nav/nav'],
      ['footer', '/us/en_us/footer/footer'],
    ].forEach(([name, content]) => {
      const meta = document.createElement('meta');
      meta.name = name;
      meta.content = content;
      document.head.appendChild(meta);
    });
  }

  main.textContent = '';
  main.prepend(section);
}

/**
 * Builds all synthetic blocks in a container element.
 * @param {Element} main The container element
 */
function buildAutoBlocks(main) {
  try {
    // build auto blocks
    const metaSku = document.querySelector('meta[name="sku"]');
    const pdpBlock = document.querySelector('.pdp');
    if (metaSku && !pdpBlock) {
      buildPDPBlock(main);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Auto Blocking failed', error);
  }
}

/**
 * Replaces an MP4 anchor element with a <video> element.
 * @param {HTMLElement} el - Container element
 * @returns {HTMLVideoElement|null} Created <video> element (or `null` if no video link found)
 */
export function buildVideo(el) {
  const vid = el.querySelector('a[href*=".mp4"]');
  if (vid) {
    const imgWrapper = vid.closest('.img-wrapper');
    if (imgWrapper) imgWrapper.classList.add('vid-wrapper');
    // create video element
    const video = document.createElement('video');
    video.loop = true;
    video.muted = true; // must be set BEFORE play()
    video.setAttribute('playsinline', '');
    video.setAttribute('preload', 'none');
    // create source element
    const source = document.createElement('source');
    source.type = 'video/mp4';
    source.dataset.src = vid.href;
    video.append(source);
    // load and play video on observation
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !source.dataset.loaded) {
          source.src = source.dataset.src;
          video.autoplay = true;
          video.load();
          video.addEventListener('canplay', () => video.play());
          source.dataset.loaded = true;
          observer.disconnect();
        }
      });
    }, { threshold: 0 });
    observer.observe(video);

    vid.parentElement.replaceWith(video);
    return video;
  }
  return null;
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

/**
 * Wraps all <img> elements inside <p> tags with a class for styling.
 * @param {HTMLElement} main - Main container element
 */
function decorateImages(main) {
  main.querySelectorAll('p img').forEach((img) => {
    const p = img.closest('p');
    p.className = 'img-wrapper';
  });
}

/**
 * Identifies and decorates "eyebrow" text above headings.
 * @param {HTMLElement} main - Main container element
 */
function decorateEyebrows(main) {
  main.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
    const prev = h.previousElementSibling;
    if (prev && prev.tagName === 'P') {
      // ignore p tags sandwiched between h tags
      const next = prev.nextElementSibling;
      if (next && next.tagName.startsWith('H')) return;
      // ignore p tags with images or links
      const disqualifiers = prev.querySelector('img, a[href]');
      if (disqualifiers) return;

      prev.classList.add('eyebrow');
      h.dataset.eyebrow = prev.textContent;
    }
  });
}

/**
 * Adds `disclaimer` class to paragraphs containing <sub> elements.
 * @param {HTMLElement} main - Main container element
 */
function decorateDisclaimers(main) {
  main.querySelectorAll('sub').forEach((sub) => {
    const p = sub.closest('p');
    if (p) p.classList.add('disclaimer');
  });
}

/**
 * Decorates section backgrounds for banner sections and sets overlay/collapse classes.
 * @param {HTMLElement} main - Main container element
 */
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
    /**
     * Sets the collapse data attribute on a section element.
     * @param {Element} el - The section element to set collapse on.
     * @param {string} position - 'top' or 'bottom'.
     */
    const setCollapse = (el, position) => {
      const existing = el?.dataset?.collapse;
      if (existing === (position === 'top' ? 'bottom' : 'top')) {
        el.dataset.collapse = 'both';
      } else if (!existing) el.dataset.collapse = position;
    };

    setCollapse(section.previousElementSibling, 'bottom');
    setCollapse(section.nextElementSibling, 'top');
  });
}

/**
 * Sets the id of sections based on their data-anchor attribute.
 * @param {HTMLElement} main - Main container element
 */
function decorateSectionAnchors(main) {
  main.querySelectorAll('.section[data-anchor]').forEach((section) => {
    const { anchor } = section.dataset;
    section.id = anchor;
  });
}

/**
 * Automatically loads and opens modal dialogs.
 * @param {Document|HTMLElement} doc - Document or container to attach the event listener to.
 */
function autolinkModals(doc) {
  doc.addEventListener('click', async (e) => {
    const origin = e.target.closest('a[href]');
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
 * Determines what text color to use against provided color background.
 * @param {string} hex - Hex color string
 * @returns {string} 'dark' if the background is light, 'light' if the background is dark.
 */
function getTextColor(hex) {
  let cleanHex = hex.replace('#', '');
  // expand 3-digit hex to 6-digit
  if (cleanHex.length === 3) cleanHex = cleanHex.split('').map((h) => h + h).join('');

  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  const luminance = (r * 299 + g * 587 + b * 114) / 1000;
  return luminance > 128 ? 'dark' : 'light';
}

/**
 * Loads and prepends nav banner.
 * @param {HTMLElement} main - Main element
 */
async function loadNavBanner(main) {
  const meta = getMetadata('nav-banner');
  if (!meta) return;

  const path = new URL(meta, window.location).pathname;
  // eslint-disable-next-line import/no-cycle
  const { loadFragment } = await import('../blocks/fragment/fragment.js');
  const fragment = await loadFragment(path);
  const content = fragment.querySelectorAll('main > div > div');
  if (content.length < 1) return;

  const banner = document.createElement('aside');
  banner.className = 'nav-banner';
  banner.append(...content);

  // apply custom color
  const section = fragment.querySelector('div[data-background]');
  if (section) {
    const { background } = section.dataset;
    const styles = getComputedStyle(document.documentElement);
    const value = styles.getPropertyValue(`--color-${background}`).trim();
    if (value) {
      banner.style.backgroundColor = `var(--color-${background})`;
      banner.classList.add(`nav-banner-${getTextColor(value)}`);
    }
  }
  main.prepend(banner);
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
    await loadNavBanner(main);
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
async function loadDelayed() {
  // eslint-disable-next-line import/no-cycle
  const params = new URLSearchParams(window.location.search);
  if (params.get('martech') !== 'off') {
    await loadScript('https://consent.cookiebot.com/uc.js', { 'data-cbid': '1d1d4c74-9c10-49e5-9577-f8eb4ba520fb' });
    if (params.get('martech') === 'on') {
      import('./consented.js');
    } else {
      window.addEventListener('CookiebotOnConsentReady', () => {
        if (window.Cookiebot.consented) {
          import('./consented.js');
        }
      });
    }
  }
}

/**
 * Loads the page in eager, lazy, and delayed phases.
 */
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
