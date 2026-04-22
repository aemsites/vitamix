import { toClassName } from '../../scripts/aem.js';
import { buildCarousel, buildIcon, buildVideo } from '../../scripts/scripts.js';

/**
 * Calculates max height needed to display any slide in expanded state.
 * @param {HTMLElement} wrapper - Carousel wrapper
 * @returns {number} - Max height (in px)
 */
function getMaxHeight(wrapper) {
  const slides = [...wrapper.children];
  const expanded = slides.find((s) => s.dataset.countdown);
  let max = 0;
  // collapse all slides
  slides.forEach((s) => s.removeAttribute('data-countdown'));
  // simulate slides being expanded one at a time
  slides.forEach((slide) => {
    slide.setAttribute('data-countdown', true);
    const height = wrapper.scrollHeight;
    if (height > max) max = height;
    slide.removeAttribute('data-countdown');
  });
  // restore expanded state
  if (expanded) expanded.setAttribute('data-countdown', true);
  return max;
}

/**
 * Sets min height of carousel wrapper to accommodate tallest slide.
 * @param {HTMLElement} wrapper - Carousel wrapper
 */
function setMinHeight(wrapper) {
  const max = getMaxHeight(wrapper);
  wrapper.style.minHeight = `${max}px`;
}

/**
 * Advances carousel to next slide.
 * @param {HTMLElement} carousel - Carousel element
 */
function nextSlide(carousel) {
  const slides = [...carousel.children];
  const current = slides.findIndex((s) => s.dataset.countdown);
  const next = slides[(current + 1) % slides.length];
  const desktop = window.matchMedia('(width >= 800px)').matches;
  // scroll to next slide on mobile
  if (!desktop) carousel.scrollTo({ left: next.offsetLeft, behavior: 'smooth' });
  // show/hide "tabs" on desktop
  slides.forEach((s) => s.removeAttribute('data-countdown'));
  // set countdown on next slide
  next.dataset.countdown = true;
}

/**
 * Enable automatic carousel rotation.
 * @param {HTMLElement} carousel - Carousel element
 * @param {number} interval - Time (in ms) between slide transitions
 * @returns {number} - Interval ID
 */
function autoRotate(carousel, interval = 6000) {
  const slides = [...carousel.children];
  if (slides.length <= 1) return;

  // eslint-disable-next-line consistent-return
  return setInterval(() => {
    nextSlide(carousel);
  }, interval);
}

// ── Videos variant ──────────────────────────────────────────────────────

function wirePlayBtn(btn, vid, block) {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    block.querySelectorAll('video').forEach((v) => {
      if (v !== vid) {
        v.pause();
        const b = v.closest('li')?.querySelector('button');
        if (b) b.setAttribute('aria-pressed', false);
      }
    });
    if (vid.paused) {
      vid.play();
      btn.setAttribute('aria-pressed', true);
      btn.setAttribute('aria-label', 'Pause');
    } else {
      vid.pause();
      btn.setAttribute('aria-pressed', false);
      btn.setAttribute('aria-label', 'Play');
    }
  });
  ['ended', 'pause'].forEach((ev) => vid.addEventListener(ev, () => {
    btn.setAttribute('aria-pressed', false);
    btn.setAttribute('aria-label', 'Play');
  }));
}

function decorateVideos(block) {
  const rows = [...block.children];
  block.innerHTML = '';
  const track = document.createElement('ul');

  rows.forEach((row) => {
    const [mediaCell, bodyCell] = [...row.children];
    const li = document.createElement('li');

    // Media
    const mediaWrap = document.createElement('div');
    mediaWrap.className = 'slide-media';
    if (mediaCell) buildVideo(mediaCell);
    const vid = mediaCell?.querySelector('video');
    const img = mediaCell?.querySelector('img, picture');
    if (vid) {
      vid.removeAttribute('controls');
      vid.setAttribute('playsinline', '');
      vid.setAttribute('preload', 'metadata');
      vid.loop = false;
      mediaWrap.append(vid);
    } else if (img) {
      mediaWrap.append(img);
    }

    // Play button
    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.setAttribute('aria-label', 'Play');
    playBtn.setAttribute('aria-pressed', false);
    playBtn.append(buildIcon('play'), buildIcon('pause'));
    mediaWrap.append(playBtn);
    if (vid) {
      wirePlayBtn(playBtn, vid, block);
    } else {
      requestAnimationFrame(() => {
        const lazyVid = li.querySelector('video');
        if (lazyVid) wirePlayBtn(playBtn, lazyVid, block);
        else playBtn.style.display = 'none';
      });
    }

    if (bodyCell) {
      bodyCell.className = 'slide-body';
      bodyCell.querySelectorAll('.button').forEach((b) => {
        b.removeAttribute('class');
        b.parentElement.classList.remove('button-wrapper');
      });
    }

    li.append(mediaWrap, ...(bodyCell ? [bodyCell] : []));
    track.append(li);
  });

  block.append(track);
  buildCarousel(block, true);

  // Trim dots to page count and sync arrow disabled state
  requestAnimationFrame(() => {
    const ul = block.querySelector('ul');
    const radioGroup = block.querySelector('[role="radiogroup"]');
    if (!ul || !radioGroup) return;

    const spv = 3.5;
    const pageCount = Math.ceil(ul.children.length / spv);
    [...radioGroup.querySelectorAll('button')].forEach((d, i) => { if (i >= pageCount) d.remove(); });

    const dots = [...radioGroup.querySelectorAll('button')];
    const prev = block.querySelector('.nav-arrow-previous');
    const next = block.querySelector('.nav-arrow-next');

    const getSlideW = () => (ul.children[0]?.offsetWidth || 0) + parseFloat(getComputedStyle(ul).gap || '0');

    const sync = () => {
      const sw = getSlideW() || 1;
      const page = Math.min(Math.round(ul.scrollLeft / (sw * spv)), dots.length - 1);
      dots.forEach((d, i) => d.setAttribute('aria-checked', i === page ? 'true' : 'false'));
      if (prev) prev.disabled = ul.scrollLeft <= 0;
      if (next) next.disabled = ul.scrollLeft + ul.clientWidth >= ul.scrollWidth - 1;
    };

    dots.forEach((d, i) => {
      d.addEventListener('click', () => {
        ul.scrollTo({ left: Math.round(i * spv) * getSlideW(), behavior: 'smooth' });
      });
    });

    ul.addEventListener('scroll', sync);
    sync();
  });
}

export default function decorate(block) {
  const variants = [...block.classList].filter((c) => c !== 'block' && c !== 'carousel');

  // Handle videos variant separately
  if (variants.includes('videos')) {
    decorateVideos(block);
    return;
  }

  const indicatedSlides = variants.find((v) => v.startsWith('slides-'));
  if (indicatedSlides) {
    block.parentElement.classList.add('items');
    block.classList.add('items');
    variants.push('items');
  }

  const rows = [...block.children];
  block.innerHTML = '';

  // build wrapper
  const wrapper = document.createElement('ul');
  block.append(wrapper);

  // extract slides
  const slides = rows.map((s) => s.children);
  let staticContent;

  // decorate carousels with static content
  if (variants.includes('expansion') || variants.includes('testimonial')) {
    variants.forEach((v) => block.parentElement.classList.add(`${v}-wrapper`));

    [staticContent] = slides.shift();
    staticContent.classList.add('carousel-static');
  }

  // decorate expansion variant
  if (variants.includes('expansion')) {
    // add logo icon
    const logo = document.createElement('img');
    logo.className = 'expansion-logo';
    logo.src = '/icons/mark.svg';
    logo.alt = '';
    block.parentElement.prepend(logo);
  }

  if (indicatedSlides) {
    const actualSlides = slides.length;
    if (actualSlides > parseInt(indicatedSlides.replace('slides-', ''), 10)) {
      block.dataset.slides = actualSlides;
    }
  }

  let qs = 0;
  slides.forEach((s) => {
    const slide = document.createElement('li');
    slide.className = 'carousel-slide';
    [...s].forEach((cell) => {
      buildVideo(cell);
      if (cell.children.length === 1 && cell.querySelector('picture')) { // single picture element
        cell.className = 'slide-image';
      } else { // default, all other cells
        cell.className = 'slide-body';
        const link = cell.querySelector('a[href]');
        if (link) {
          const content = cell.textContent.trim();
          // link is the only content
          if (link.textContent.trim() === content) {
            link.removeAttribute('class');
            link.parentElement.classList.remove('button-wrapper');
            if (!variants.includes('linked')) variants.push('linked');
            if (!block.classList.contains('linked')) block.classList.add('linked');
          }
        }
        const quote = cell.querySelector('blockquote');
        if (quote) {
          qs += 1;
          slide.classList.add('slide-quote');
          const color = cell.querySelector('code');
          if (color) {
            slide.classList.add(`color-${toClassName(color.textContent.trim())}`);
            color.remove();
          } else {
            slide.dataset.q = (qs % 3) + 1;
          }
          const children = [...cell.children];
          const firstQuoteIndex = children.findIndex((c) => c.tagName === 'BLOCKQUOTE');
          const lastQuoteIndex = children.findLastIndex((c) => c.tagName === 'BLOCKQUOTE');

          const beforeQuotes = children.slice(0, firstQuoteIndex);
          const quotes = children.slice(firstQuoteIndex, lastQuoteIndex + 1);
          const afterQuotes = children.slice(lastQuoteIndex + 1);

          const cite = document.createElement('cite');
          cite.append(...afterQuotes);

          cell.replaceChildren(...beforeQuotes, ...quotes, cite);
        }
        [...cell.querySelectorAll('p')].forEach((p) => {
          if (p.textContent.startsWith('$')) p.classList.add('slide-body-price');
        });
      }
      slide.append(cell);
    });

    // check for linked content
    const as = slide.querySelectorAll('a[href]');
    if (variants.includes('linked') || (as && as.length === 1)) {
      const a = as[0];
      // if only link is not a button
      if (variants.includes('linked') || !a.className) {
        a.removeAttribute('class');
        a.parentElement.classList.remove('button-wrapper');
        slide.classList.add('linked');
        slide.addEventListener('click', () => a.click());
      }
    }

    // add expansion autotimer
    if (variants.includes('expansion')) {
      const timer = document.createElement('div');
      timer.classList.add('expansion-timer');
      const heading = slide.querySelector('h2, h3, h4, h5, h6');
      if (heading) heading.prepend(timer);
      else slide.prepend(timer);
    }

    wrapper.append(slide);
  });

  const carousel = buildCarousel(block, false);
  if (staticContent) carousel.parentElement.prepend(staticContent);

  if (carousel) block.replaceWith(carousel);
  else block.parentElement.remove();

  // start autorotation
  if (variants.includes('expansion')) {
    if (window.matchMedia('(width >= 800px)').matches) {
      requestAnimationFrame(() => {
        setMinHeight(wrapper);
      });
    }

    window.addEventListener('resize', (() => {
      let timeout;
      return () => {
        wrapper.removeAttribute('style');
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          const desktop = window.matchMedia('(width >= 800px)').matches;
          if (desktop) setMinHeight(wrapper);
        }, 100);
      };
    })());

    const firstSlide = wrapper.firstElementChild;
    firstSlide.dataset.countdown = true;

    let autoRotateTimer = autoRotate(wrapper);
    let interactionTimeout;
    let visible = false;

    const resetAutoRotate = () => {
      if (visible) {
        clearInterval(autoRotateTimer);
        clearTimeout(interactionTimeout);
        interactionTimeout = setTimeout(() => {
          autoRotateTimer = autoRotate(wrapper);
        }, 100); // match scroll debounce
      }
    };

    wrapper.addEventListener('scroll', () => resetAutoRotate());

    [...wrapper.children].forEach((slide) => {
      slide.addEventListener('click', () => {
        wrapper.querySelectorAll('li').forEach((s) => s.removeAttribute('data-countdown'));
        slide.setAttribute('data-countdown', true);
        resetAutoRotate();
      });
    });

    const visibilityObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.intersectionRatio < 0.5 && visible) {
          // carousel is less than 50% visible
          clearInterval(autoRotateTimer);
          autoRotateTimer = null;
          visible = false;
        } else if (entry.intersectionRatio >= 0.5 && !visible) {
          // carousel is at least 50% visible
          if (!autoRotateTimer) autoRotateTimer = autoRotate(wrapper);
          visible = true;
        }
      });
    }, { threshold: 0.5 });

    visibilityObserver.observe(block.closest('.carousel-wrapper') || block);

    // track visible slide
    wrapper.addEventListener('scroll', () => {
      const { scrollLeft, clientWidth } = wrapper;
      const current = Math.round(scrollLeft / clientWidth);
      const { children } = wrapper;
      [...children].forEach((slide, i) => {
        if (i === current) slide.setAttribute('data-countdown', true);
        else slide.removeAttribute('data-countdown');
      });
    });
  }
}
