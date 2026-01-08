import { extractPricing } from '../blocks/pdp/pricing.js';
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
 * Parses `document.cookie` into key-value map.
 * @returns {Object} Object representing all cookies as key-value pairs
 */
export function getCookies() {
  const cookies = document.cookie.split(';');
  const cookieMap = {};
  cookies.forEach((cookie) => {
    const [key, value] = cookie.split('=');
    if (key && value) cookieMap[key.trim()] = value.trim();
  });
  return cookieMap;
}

function setAffiliateCoupon() {
  const urlParams = new URLSearchParams(window.location.search);
  const { cjdata, cjevent, COUPON } = Object.fromEntries(urlParams);

  if (!cjdata || !cjevent || !COUPON) return;

  const loginUrl = new URL('https://www.vitamix.com/us/en_us/checkout/cart');
  Object.entries({ cjdata, cjevent, COUPON }).forEach(([key, value]) => {
    loginUrl.searchParams.set(key, value);
  });

  fetch(loginUrl.toString());
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
 * Get horizontal gap between carousel items.
 * @param {HTMLElement} carousel - Carousel element
 * @returns {number} Gap size in pixels
 */
function getGapSize(carousel) {
  const styles = getComputedStyle(carousel);
  const gap = styles.gap || styles.columnGap;
  return parseFloat(gap) || 0;
}

/**
 * Calculates total width of single slide (including gap to next slide).
 * @param {HTMLElement} carousel - Carousel element
 * @returns {number} Slide width, including the gap, in pixels
 */
function getSlideWidth(carousel) {
  const slide = carousel.querySelector('li');
  return slide ? slide.offsetWidth + getGapSize(carousel) : 0;
}

/**
 * Determines how many slides are currently visible in carousel viewport.
 * @param {HTMLElement} container - Container element
 * @returns {number} Number of fully visible slides
 */
function getVisibleSlides(container) {
  const carousel = container.querySelector('ul');
  const slide = carousel.querySelector('li');
  if (!carousel || !slide) return 1;

  const slideWidthWithGap = slide.offsetWidth + getGapSize(carousel);
  return Math.max(1, Math.round(carousel.clientWidth / slideWidthWithGap));
}

/**
 * Builds a single index element for carousel navigation.
 * @param {number} i - Index of the slide
 * @param {HTMLElement} carousel - Carousel element
 * @param {HTMLElement} indices - Container element for index buttons
 * @returns {HTMLLIElement} Constructed carousel index
 */
function buildCarouselIndex(i, carousel, indices) {
  const index = document.createElement('button');
  index.type = 'button';
  index.setAttribute('aria-label', `Go to slide ${i + 1}`);
  index.setAttribute('aria-checked', !i);
  index.setAttribute('role', 'radio');
  index.addEventListener('click', () => {
    indices.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-checked', b === index);
    });
    carousel.scrollTo({
      left: i * getSlideWidth(carousel),
      behavior: 'smooth',
    });
  });
  return index;
}

/**
 * Builds and appends carousel index buttons for navigation.
 * @param {HTMLElement} carousel - Carousel element
 * @param {HTMLElement} indices - Container element where index buttons will be appended
 */
function buildCarouselIndices(carousel, indices) {
  indices.innerHTML = '';
  const slides = [...carousel.children];
  slides.forEach((s, i) => {
    const index = buildCarouselIndex(i, carousel, indices);
    indices.append(index);
  });
}

/**
 * Rebuilds carousel index buttons.
 * @param {HTMLElement} carousel - Carousel element
 */
export function rebuildIndices(carousel) {
  const slides = carousel.querySelector('ul');
  const indices = carousel.querySelector('nav [role="radiogroup"]');
  if (!slides || !indices) return;

  buildCarouselIndices(slides, indices);
}

/**
 * Initializes and builds a scrollable carousel with navigation controls.
 * @param {HTMLElement} container - Container element that wraps the carousel `<ul>`.
 * @param {boolean} [pagination=true] - Whether to display pagination indicators.
 * @returns {HTMLElement} Carousel container.
 */
export function buildCarousel(container, pagination = true) {
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
    button.className = `nav-arrow nav-arrow-${label.toLowerCase()}`;
    button.setAttribute('aria-label', `${label} frame`);
    button.addEventListener('click', () => {
      const slideWidth = getSlideWidth(carousel);
      const visible = getVisibleSlides(container);
      const { scrollLeft } = carousel;
      const current = Math.round(scrollLeft / slideWidth);

      if (!i) { // Previous button
        if (current <= 0) {
          // Loop to the end
          carousel.scrollTo({
            left: (slides.length - visible) * slideWidth,
            behavior: 'smooth',
          });
        } else {
          carousel.scrollBy({
            left: -slideWidth * visible,
            behavior: 'smooth',
          });
        }
      } else if (current >= slides.length - visible) {
        // Loop to the beginning
        carousel.scrollTo({
          left: 0,
          behavior: 'smooth',
        });
      } else {
        carousel.scrollBy({
          left: slideWidth * visible,
          behavior: 'smooth',
        });
      }
    });
    navEl.append(button);
  });

  if (pagination) {
    // build indices
    const indices = document.createElement('div');
    indices.setAttribute('role', 'radiogroup');
    navEl.append(indices);
    buildCarouselIndices(carousel, indices);

    carousel.addEventListener('scroll', () => {
      const { scrollLeft } = carousel;
      const current = Math.round(scrollLeft / getSlideWidth(carousel));
      [...indices.querySelectorAll('button')].forEach((btn, i) => {
        btn.setAttribute('aria-checked', i === current);
      });
    });
  }

  // hide nav if all slides are visible
  const observer = new ResizeObserver(() => {
    const visible = getVisibleSlides(container);
    if (slides.length <= visible) navEl.style.visibility = 'hidden';
    else navEl.removeAttribute('style');
  });
  observer.observe(carousel);

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
        const [keyNode, valueNode, uidNode] = meta.children;
        const key = keyNode?.textContent.trim();
        const value = valueNode?.textContent.trim();
        const uid = uidNode?.textContent.trim();

        if (key && value) {
          (key === 'sku' ? metadata : options)[key] = value;
        }

        if (uid) {
          options.uid = uid;
        }
      });
    }

    const imagesHTML = div.querySelectorAll('picture');

    const priceHTML = div.querySelector('p:nth-of-type(1)');
    const price = extractPricing(priceHTML);

    return {
      ...metadata,
      name,
      options,
      price,
      images: imagesHTML,
    };
  });
}

function parseVariantsNext(sections) {
  return sections.map((div) => {
    const name = div.querySelector('h2')?.textContent.trim();

    const metadata = {};
    const options = {};

    options.uid = div.dataset.uid;
    options.color = div.dataset.color;
    metadata.sku = div.dataset.sku;

    const imagesHTML = div.querySelectorAll('picture');

    const priceHTML = div.querySelector('p:nth-of-type(1)');
    const price = extractPricing(priceHTML);

    const ldVariant = window.jsonLdData.offers.find((offer) => offer.sku === metadata.sku);
    if (ldVariant) {
      metadata.itemCondition = ldVariant.itemCondition;
      metadata.availability = ldVariant.availability;
      metadata.custom = ldVariant.custom;
    }

    return {
      ...metadata,
      name,
      options,
      price,
      images: imagesHTML,
    };
  });
}

// eslint-disable-next-line no-unused-vars
export function checkVariantOutOfStock(sku) {
  const { availability } = window.jsonLdData.offers.find((offer) => offer.sku === sku);
  return availability === 'https://schema.org/OutOfStock';
}

export function isProductOutOfStock() {
  // Check if all variants are out of stock, if any are in stock, return false
  const { offers, custom } = window.jsonLdData;

  // If the product is a bundle and parent is out of stock, return true
  if (custom.type === 'bundle' && custom.parentAvailability === 'OutOfStock') {
    return true;
  }

  // If the product is not a bundle and no offers are available, return true
  if (!offers || offers.length === 0) return true;

  // If the product is not a bundle and any offers are in stock, return false
  return !offers.some((offer) => offer.availability === 'https://schema.org/InStock');
}

/**
 * Checks if the current pipeline is the Next pipeline.
 * @returns {boolean} True if the current pipeline is the Next pipeline, false otherwise.
 */
export function isNextPipeline() {
  const pipelineMeta = document.head.querySelector('meta[name="pipeline"]')?.content;
  return pipelineMeta === 'next';
}

/**
 * Parses the PDP content sections from the initial HTML and stores them in the window object.
 * @param {Array<Element>} sections - The sections to parse.
 */
function parsePDPContentSections(sections) {
  sections.forEach((section) => {
    const h3 = section.querySelector('h3')?.textContent.toLowerCase();
    if (h3) {
      if (h3.includes('features')) {
        window.features = section;
      } else if (h3.includes('specifications')) {
        window.specifications = section;
      } else if (h3.includes('warranty')) {
        window.warranty = section;
      }
    }
  });
}

/**
 * Builds hero block and prepends to main in a new section.
 * @param {Element} main The container element
 */
function buildPDPBlock(main) {
  const section = document.createElement('div');
  const type = document.head.querySelector('meta[name="type"]')?.content;

  const nextPipeline = isNextPipeline();
  const isValidType = ['simple', 'configurable', 'bundle'].includes(type);
  if (isValidType) {
    // Find LCP picture element based on pipeline structure
    // In both cases we try and pull the first picture from the first image in a variant section
    // If it's a simple product, we pull the first picture on the page
    let lcpPicture;
    if (nextPipeline) {
      lcpPicture = main.querySelector('div.section picture') || main.querySelector('picture:first-of-type');
    } else {
      lcpPicture = main.querySelector('div:nth-child(2) picture') || main.querySelector('picture:first-of-type');
    }
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

    if (!main.querySelector('h2')) {
      lcpPicture.remove();
    }

    section.append(buildBlock('pdp', { elems: [...lcp.children] }));
  }

  // Get the json-ld from the head and parse it
  const jsonLd = document.head.querySelector('script[type="application/ld+json"]');
  window.jsonLdData = jsonLd ? JSON.parse(jsonLd.textContent) : null;

  // Select variant sections based on pipeline type
  const selector = nextPipeline
    ? ':scope > div.section'
    : ':scope > div';
  const variantSections = Array.from(main.querySelectorAll(selector));

  // Parse variants using the appropriate parser
  window.variants = nextPipeline
    ? parseVariantsNext(variantSections)
    : parseVariants(variantSections);

  if (nextPipeline) {
    parsePDPContentSections(Array.from(main.querySelectorAll(':scope > div')));
  }

  const navMeta = document.head.querySelector('meta[name="nav"]');
  if (!navMeta) {
    [
      ['nav', '/us/en_us/nav/nav'],
      ['footer', '/us/en_us/footer/footer'],
      ['nav-banners', '/us/en_us/nav/nav-banners'],
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
    // autoreplace fragment references
    const fragments = main.querySelectorAll('a[href*="/fragments/"]');
    if (fragments.length > 0) {
      // eslint-disable-next-line import/no-cycle
      import('../blocks/fragment/fragment.js').then(({ loadFragment }) => {
        fragments.forEach(async (fragment) => {
          try {
            const { pathname } = new URL(fragment.href);
            const frag = await loadFragment(pathname);
            fragment.parentElement.replaceWith(frag.firstElementChild);
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error('Fragment loading failed', error);
          }
        });
      });
    }

    // setup pdp
    const metaSku = document.querySelector('meta[name="sku"]');
    const pdpBlock = document.querySelector('.pdp');
    if (metaSku && !pdpBlock) {
      buildPDPBlock(main);
    }
    if (metaSku || pdpBlock) {
      document.body.classList.add('pdp-template');
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
    video.muted = true;
    video.setAttribute('muted', '');
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

function decorateFullWidthBlocks(main) {
  const fullWidth = main.querySelectorAll('div.full-width');
  fullWidth.forEach((block) => block.parentElement.classList.add('full-width'));
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
  // Disable auto eyebrows if the page is a PDP
  const metaSku = document.querySelector('meta[name="sku"]');
  if (metaSku) return;

  main.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
    const beforeH = h.previousElementSibling;
    if (beforeH && beforeH.tagName === 'P') {
      const beforeP = beforeH.previousElementSibling;
      // ignore p tags sandwiched between headings
      if (beforeP && beforeP.tagName.startsWith('H')) return;
      // ignore p tags with images or links
      const disqualifiers = beforeH.querySelector('img, a[href]');
      if (disqualifiers) return;
      beforeH.classList.add('eyebrow');
      h.dataset.eyebrow = beforeH.textContent.trim();
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
    try {
      const { href, pathname } = new URL(background);
      if (pathname.endsWith('.mp4')) {
        const wrapper = document.createElement('p');
        const videoLink = document.createElement('a');
        videoLink.href = href;
        wrapper.prepend(videoLink);
        section.prepend(wrapper);
        const video = buildVideo(section);
        video.classList.add('section-background-video');
      } else {
        const backgroundPicture = createOptimizedPicture(href, '', false, [
          { media: '(min-width: 800px)', width: '2880' },
          { width: '1600' },
        ]);
        backgroundPicture.classList.add('section-background-image');
        section.prepend(backgroundPicture);
      }
      const text = section.textContent.trim();
      if (text) section.classList.add('overlay');
    } catch (e) {
      // do nothing
    }
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
 * Opens a modal dialog.
 * @param {string} href - The href of the modal to open.
 */
export async function openModal(href) {
  const { openModal: openModalFn } = await import(`${window.hlx.codeBasePath}/blocks/modal/modal.js`);
  openModalFn(href);
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
      await openModal(origin.href);
    }
  });
}

async function decorateFragmentPreviews() {
  const params = new URLSearchParams(window.location.search);
  const fragmentPath = params.get('reloadFragment');
  if (fragmentPath && fragmentPath.length < 200) {
    const isValid = /^[a-zA-Z0-9-_/]+$/.test(fragmentPath);
    if (!isValid) return;
    const url = new URL(fragmentPath, window.location);
    const { pathname } = url;
    const resp = await fetch(`${pathname}.plain.html`, {
      cache: 'reload',
    });
    await resp.text();
  }
  const path = window.location.pathname;
  if (path.includes('/nav/') || path.includes('/footer/')) {
    if (window.location.search.includes('dapreview=on')) {
      document.body.classList.add('fragment-preview');
    } else {
      window.location.href = `/us/en_us/why-vitamix?reloadFragment=${path}`;
    }
  }
}

/**
 * Decorates the main element.
 * @param {Element} main The main element
 */
// eslint-disable-next-line import/prefer-default-export
export function decorateMain(main) {
  decorateFragmentPreviews();
  decorateIcons(main);
  decorateImages(main);
  buildAutoBlocks(main);
  decorateSections(main);
  decorateSectionAnchors(main);
  decorateSectionBackgrounds(main);
  decorateBlocks(main);
  decorateFullWidthBlocks(main);
  decorateButtons(main);
  decorateEyebrows(main);
  decorateDisclaimers(main);
  setAffiliateCoupon();
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

export function applyImgColor(block) {
  const img = block.querySelector('img[src]');
  if (img) {
    import('./colorthief.js').then(({ default: ColorThief }) => {
      const colorThief = new ColorThief();
      const thumbnail = createOptimizedPicture(img.src, '', '', [{ width: 200 }]).querySelector('source').srcset;
      const thumbnailImg = new Image();
      thumbnailImg.src = thumbnail;
      thumbnailImg.onload = () => {
        const color = colorThief.getColor(thumbnailImg, 5, 10);
        const [r, g, b] = color;
        const y = Math.floor(r * 0.2126 + g * 0.7152 + b * 0.0722);
        const brightness = {
          darkest: 80,
          dark: 160,
          light: 200,
          lightest: 256,
        };
        const brightnessKey = Object.keys(brightness).find((key) => y <= brightness[key]);
        block.classList.add(`image-${brightnessKey}`);
        block.style.setProperty('--image-color', `#${r.toString(16)}${g.toString(16)}${b.toString(16)}`);
      };
    });
  }
}

/**
 * Determines if a given date falls within US Eastern Daylight Saving Time.
 * DST starts: 2nd Sunday of March at 2:00 AM
 * DST ends: 1st Sunday of November at 2:00 AM
 * @param {number} year - The year
 * @param {number} month - The month (1-12)
 * @param {number} day - The day of month
 * @returns {boolean} True if the date is in DST (EDT), false if in standard time (EST)
 */
function isEasternDST(year, month, day) {
  // DST doesn't apply in Jan, Feb, or Dec
  if (month < 3 || month > 11) return false;
  // DST always applies Apr-Oct
  if (month > 3 && month < 11) return true;

  // For March: DST starts 2nd Sunday at 2am
  if (month === 3) {
    // Find the 2nd Sunday of March
    const firstOfMonth = new Date(year, 2, 1); // March 1st (month is 0-indexed)
    const firstSunday = 1 + ((7 - firstOfMonth.getDay()) % 7);
    const secondSunday = firstSunday + 7;
    // On or after the second Sunday means DST
    return day >= secondSunday;
  }

  // For November: DST ends 1st Sunday at 2am
  if (month === 11) {
    // Find the 1st Sunday of November
    const firstOfMonth = new Date(year, 10, 1); // November 1st (month is 0-indexed)
    const firstSunday = 1 + ((7 - firstOfMonth.getDay()) % 7);
    // Before the first Sunday means still in DST
    return day < firstSunday;
  }

  return false;
}

/**
 * Parses a datetime string and returns a Date object.
 * Supports formats like "9/12/2025 9am", "9/19/2025 3pm", or "9/12/2025 9:30am"
 * Defaults to Eastern time (EST/EDT based on daylight savings) when no timezone specified.
 * @param {string} dateStr - The datetime string to parse (e.g., "6/23/2025 9am")
 * @returns {Date} The parsed Date object
 * @throws {Error} If the datetime format is invalid
 */
export function parseEasternDateTime(dateStr) {
  if (!dateStr) {
    throw new Error('DateTime string is required');
  }

  // Handle formats like "9/12/2025 9am" or "9/12/2025 9:30am"
  // Timezone is optional, defaults to Eastern (EST/EDT)
  const regex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})(?::(\d{2}))?(am|pm)(?:\s+([A-Z]{3,4}))?$/i;
  const match = dateStr.trim().match(regex);

  if (!match) {
    throw new Error(`Invalid datetime format: ${dateStr}. Expected format: M/D/YYYY HHam/pm`);
  }

  const month = parseInt(match[1], 10);
  const day = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);
  let hours = parseInt(match[4], 10);
  const minutesValue = match[5] ? parseInt(match[5], 10) : 0;
  const ampm = match[6].toLowerCase();
  const timezone = match[7];

  // Convert 12-hour to 24-hour format
  if (ampm === 'am' && hours === 12) {
    hours = 0; // 12am = 00:00
  } else if (ampm === 'pm' && hours !== 12) {
    hours += 12; // 1pm-11pm = 13:00-23:00, 12pm stays 12:00
  }

  // Timezone offsets from UTC
  const timezoneOffsets = {
    EDT: -4,
    EST: -5,
    CDT: -5,
    CST: -6,
    MDT: -6,
    MST: -7,
    PDT: -7,
    PST: -8,
  };

  let offsetHours;
  if (timezone) {
    // Use explicitly specified timezone
    offsetHours = timezoneOffsets[timezone.toUpperCase()];
    if (offsetHours === undefined) {
      throw new Error(`Unsupported timezone: ${timezone}`);
    }
  } else {
    // Default to Eastern time - auto-detect EST/EDT based on date
    const isDST = isEasternDST(year, month, day);
    offsetHours = isDST ? -4 : -5; // EDT = -4, EST = -5
  }

  // Convert the local time to UTC by subtracting the offset
  // If EDT is UTC-4, then 9am EDT = 1pm UTC (9 - (-4) = 13)
  const utcHour = hours - offsetHours;

  // Create UTC date object
  return new Date(Date.UTC(year, month - 1, day, utcHour, minutesValue, 0));
}

/**
 * Parses alert banner rows from a block element and returns an array of banner objects.
 * Expected row format:
 *   Column 1: Start datetime (e.g., "6/23/2025 9am")
 *   Column 2: End datetime (e.g., "12/31/2025 11:59pm")
 *   Column 3: Content
 *   Column 4: Color
 * Defaults to Eastern time (EST/EDT based on whether DST is in effect for that date).
 * @param {HTMLElement} block - The DOM element containing alert banner rows as children.
 * @returns {Array<Object>} Array of parsed banner objects with properties:
 */
export function parseAlertBanners(block) {
  /**
   * Parses a datetime string, returning null for empty values (open-ended).
   * @param {string} dateStr - The datetime string to parse
   * @returns {Date|null} The parsed Date or null if empty
   */
  const parseDateOrNull = (dateStr) => {
    const trimmed = dateStr?.trim();
    if (!trimmed) {
      return null; // Empty = open-ended
    }
    return parseEasternDateTime(trimmed);
  };

  const rows = [...block.children];
  const banners = rows.map((row) => {
    const [startEl, endEl, content, colorEl] = [...row.children];
    const color = colorEl.textContent.trim();
    try {
      return ({
        valid: true,
        start: parseDateOrNull(startEl.textContent),
        end: parseDateOrNull(endEl.textContent),
        content,
        color,
      });
    } catch (e) {
      return {
        valid: false,
        error: e.message,
        start: null,
        end: null,
        content,
        color,
      };
    }
  });
  return banners;
}

/**
 * Determines whether the current date is before, during, or after the given start/end range.
 * Null start means open-ended in the past (always started).
 * Null end means open-ended in the future (never expires).
 * @param {Date|null} start - The start date/time of the range (null = open-ended past).
 * @param {Date|null} end - The end date/time of the range (null = open-ended future).
 * @param {Date} [date=new Date()] - The reference date/time to compare (defaults to now).
 * @returns {string} String indicating the status relative to the range.
 */
export function currentPastFuture(start, end, date = new Date()) {
  const afterStart = !start || start <= date;
  const beforeEnd = !end || end >= date;

  if (afterStart && beforeEnd) {
    return 'current';
  }
  if (start && start > date) {
    return 'future';
  }
  return 'past';
}

/**
 * Finds the "best" alert banner from an array of banners, based on the current date.
 * @param {Array<Object>} banners - Array of banner objects as returned by parseAlertBanners.
 * @param {Date} [date=new Date()] - The reference date/time to use (defaults to now).
 * @returns {Object|null} The best banner object, or null if none are current.
 */
export function findBestAlertBanner(banners, date = new Date()) {
  let bestBanner = null;
  banners.forEach((banner) => {
    if (banner.valid) {
      if (currentPastFuture(banner.start, banner.end, date) === 'current') {
        bestBanner = banner;
      }
    }
  });
  return bestBanner;
}

/**
 * Gets the locale and language from the window.location.pathname.
 * @returns {Object} Object with locale and language.
 */
export async function getLocaleAndLanguage() {
  const pathSegments = window.location.pathname.split('/').filter(Boolean);
  const locale = pathSegments[0] || 'us'; // fallback to 'us' if not found
  const language = pathSegments[1] || 'en_us'; // fallback to 'en_us' if not found
  return { locale, language };
}

/**
 * Loads and prepends nav banner.
 * @param {HTMLElement} main - Main element
 */
async function loadNavBanner(main) {
  const meta = getMetadata('nav-banners');
  if (!meta) return;
  try {
    const path = new URL(meta, window.location).pathname;
    // eslint-disable-next-line import/no-cycle
    const resp = await fetch(path);
    const text = await resp.text();

    const dom = new DOMParser().parseFromString(text, 'text/html');
    const block = dom.querySelector('.alert-banners');

    const banners = parseAlertBanners(block);
    const selectedBanner = findBestAlertBanner(banners);

    if (selectedBanner && selectedBanner.content) {
      const banner = document.createElement('aside');
      banner.className = 'nav-banner';
      const p = document.createElement('p');
      p.append(...selectedBanner.content.childNodes);
      banner.append(p);
      // apply custom color
      if (selectedBanner.color) {
        const styles = getComputedStyle(document.documentElement);
        const value = styles.getPropertyValue(`--color-${selectedBanner.color}`).trim();
        if (value) {
          banner.style.backgroundColor = `var(--color-${selectedBanner.color})`;
          banner.classList.add(`nav-banner-${getTextColor(value)}`);
        }
      }
      main.prepend(banner);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('Error loading nav banner', e);
  }
}

/**
 * Loads everything needed to get to LCP.
 * @param {Element} doc The container element
 */
async function loadEager(doc) {
  const locale = window.location.pathname.split('/')[2];
  const language = locale ? locale.split('_')[0] : 'en';
  document.documentElement.lang = language;

  const params = new URLSearchParams(window.location.search);
  if (params.get('simulateDate')) {
    window.simulateDate = params.get('simulateDate');
  }

  if (window.location.pathname.includes('/shop/')) {
    const images = doc.querySelectorAll('img[src^="./media_"]');
    images.forEach((img) => {
      img.setAttribute('src', img.getAttribute('src').replace('./media_', '/us/en_us/media_'));
    });
    const sources = doc.querySelectorAll('source[srcset^="./media_"]');
    sources.forEach((source) => {
      source.setAttribute('srcset', source.getAttribute('srcset').replace('./media_', '/us/en_us/media_'));
    });
  }

  decorateTemplateAndTheme();

  const main = doc.querySelector('main');
  if (main) {
    decorateMain(main);
    await loadNavBanner(main);
    document.body.classList.add('appear');
    await loadSection(main.querySelector('.section'), (section) => {
      if (document.body.classList.contains('quick-edit')) return Promise.resolve();
      return waitForFirstImage(section);
    });
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

  const syncSku = async () => {
    // eslint-disable-next-line import/no-unresolved
    const { openSyncModal } = await import('https://main--vitamix--aemsites.aem.page/tools/sidekick/sync/sync.js');
    await openSyncModal();
  };

  const loadQuickEdit = async (...args) => {
    // eslint-disable-next-line import/no-cycle
    const { default: initQuickEdit } = await import('../tools/quick-edit/quick-edit.js');
    initQuickEdit(...args);
  };

  const addSidekickListeners = (sk) => {
    sk.addEventListener('custom:sync', syncSku);
    sk.addEventListener('custom:quick-edit', loadQuickEdit);
  };

  const sk = document.querySelector('aem-sidekick');
  if (sk) {
    addSidekickListeners(sk);
  } else {
    // wait for sidekick to be loaded
    document.addEventListener('sidekick-ready', () => {
    // sidekick now loaded
      addSidekickListeners(document.querySelector('aem-sidekick'));
    }, { once: true });
  }
}

function decorateExternalLinks() {
  const externalLinks = document.querySelectorAll('a[href^="https://"]');
  externalLinks.forEach((link) => {
    const { hostname } = new URL(link.href);
    if (!link.href.includes('vitamix') || hostname === 'localhost') {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener');
    }
  });
}
/**
 * Loads everything that happens a lot later,
 * without impacting the user experience.
 */
async function loadDelayed() {
  // eslint-disable-next-line import/no-cycle
  const params = new URLSearchParams(window.location.search);
  if (params.get('martech') !== 'off') {
    await loadScript('https://consent.cookiebot.com/uc.js', {
      'data-cbid': '1d1d4c74-9c10-49e5-9577-f8eb4ba520fb',
      'data-blockingmode': 'auto',
      'data-georegions': '{"region":"US","cbid":"e9652803-d7e7-491b-a318-632a8f288b5b"}',
    });
    window.addEventListener('CookiebotOnDialogDisplay', () => {
      const { userCountry } = window.Cookiebot;
      if (userCountry && userCountry.startsWith('US-')) {
        if (!window.Cookiebot.forceDialog) {
          document.body.classList.add('hide-consent-banner-for-us');
        } else {
          document.body.classList.remove('hide-consent-banner-for-us');
        }
      }
    });
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
  setTimeout(decorateExternalLinks, 1000);
}

/**
 * Loads the page in eager, lazy, and delayed phases.
 */
export async function loadPage() {
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
