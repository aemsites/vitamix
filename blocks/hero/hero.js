import { createOptimizedPicture } from '../../scripts/aem.js';
import { buildVideo, applyImgColor } from '../../scripts/scripts.js';

/**
 * Returns `true` if a cell contains only pictures and/or video links, with no text content.
 * @param {Element} cell - Direct child div of a block row
 * @returns {boolean}
 */
function isMediaCell(cell) {
  if (!cell.querySelector('picture') && !cell.querySelector('a[href*=".mp4"]')) return false;
  return [...cell.children].every((child) => {
    if (child.tagName === 'PICTURE') return true;
    if (child.tagName !== 'P') return false;
    const children = [...child.children];
    if (children.length === 1 && children[0].tagName === 'PICTURE') return true;
    return !!child.querySelector('a[href*=".mp4"]');
  });
}

/**
 * Parses `data-focal:x,y` percentages from an image's data-title value.
 * @param {string} [title]
 * @returns {{ x: number, y: number } | null}
 */
function parseFocalPoint(title) {
  if (!title) return null;
  const match = title.match(/data-focal:([\d.]+),([\d.]+)/);
  if (!match) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/**
 * object-position % that places `focalPct` of the rendered image as close to
 * the container center as possible without exposing empty edges.
 * @param {number} focalPct - Focal point along this axis (0–100)
 * @param {number} container - Container size in px
 * @param {number} rendered - Scaled image size in px (object-fit: cover)
 * @returns {number}
 */
function focalObjectPosition(focalPct, container, rendered) {
  const overflow = container - rendered;
  if (Math.abs(overflow) < 0.5) return 50;
  const pos = (((container / 2) - (rendered * (focalPct / 100))) / overflow) * 100;
  return Math.max(0, Math.min(100, pos));
}

/**
 * Intrinsic media size (image natural size or video frame size).
 * @param {HTMLImageElement | HTMLVideoElement} media
 * @returns {{ width: number, height: number }}
 */
function mediaIntrinsicSize(media) {
  if (media instanceof HTMLVideoElement) {
    return { width: media.videoWidth, height: media.videoHeight };
  }
  return { width: media.naturalWidth, height: media.naturalHeight };
}

/**
 * Keeps the media focal point centered under object-fit: cover as the box resizes.
 * Uses rAF so ResizeObserver style writes don't trip Safari's
 * "undelivered notifications" loop warning.
 * @param {HTMLImageElement | HTMLVideoElement} media
 * @param {{ x: number, y: number }} focal
 */
function applyFocalPoint(media, focal) {
  media.dataset.focal = '';
  let raf = 0;

  const update = () => {
    if (window.innerWidth < 900 || !media.closest('.block').classList.contains('center')) {
      const { width: nw, height: nh } = mediaIntrinsicSize(media);
      if (!nw || !nh) return;
      const { width: cw, height: ch } = media.getBoundingClientRect();
      if (!cw || !ch) return;

      const scale = Math.max(cw / nw, ch / nh);
      const x = focalObjectPosition(focal.x, cw, nw * scale);
      const y = focalObjectPosition(focal.y, ch, nh * scale);
      media.style.objectPosition = `${x}% ${y}%`;
    } else {
      media.style.objectPosition = '';
    }
  };

  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      update();
    });
  };

  if (media instanceof HTMLVideoElement) {
    if (media.readyState >= HTMLMediaElement.HAVE_METADATA) schedule();
    else media.addEventListener('loadedmetadata', schedule, { once: true });
  } else if (media.complete) schedule();
  else media.addEventListener('load', schedule, { once: true });
  new ResizeObserver(schedule).observe(media);
}

/**
 * Detects layout from column count and marks background images with data-bg.
 * @param {Element} block - Hero block element
 */
function detectLayout(block) {
  const row = block.firstElementChild;
  if (!row) return;
  const cells = [...row.children];

  if (cells.length >= 2) {
    block.classList.add('split');
    cells.forEach((cell) => {
      if (isMediaCell(cell)) {
        cell.className = 'img-wrapper';
        const bgPicture = cell.querySelector('picture');
        if (bgPicture) bgPicture.dataset.bg = '';
      } else cell.classList.add('text-wrapper');
    });
    const imgIndex = cells.findIndex((c) => c.classList.contains('img-wrapper'));
    block.classList.add(imgIndex === 0 ? 'left-text' : 'right-text');
  } else {
    block.classList.add('center');
    const cell = row.firstElementChild;
    if (!cell) return;
    const [picture] = [...cell.querySelectorAll('picture')];
    if (picture) picture.dataset.bg = '';
  }
}

/** @param {Element} block */
export default function decorate(block) {
  block.querySelectorAll('a.button').forEach((button) => button.classList.toggle('emphasis'));
  detectLayout(block);

  // buildVideo replaces the mp4 link's parent <p>; hoist a sibling poster picture out first
  const mp4Link = block.querySelector('a[href*=".mp4"]');
  const poster = block.querySelector('picture[data-bg]');
  if (mp4Link && poster && mp4Link.parentElement?.contains(poster)) {
    mp4Link.parentElement.before(poster);
  }

  const video = buildVideo(block);

  if (!block.querySelector('h1')) {
    block.classList.add('sub');
    const wrapper = block.closest('.hero-wrapper');
    if (wrapper) wrapper.classList.add('sub');
  }

  const colorOverride = [...block.classList].find(
    (c) => getComputedStyle(document.documentElement).getPropertyValue(`--color-${c}`).trim(),
  );
  if (colorOverride) {
    block.style.setProperty('--image-color', `var(--color-${colorOverride})`);
    block.classList.add('image-tint');
  }

  const bgPicture = block.querySelector('picture[data-bg]');
  let focal = null;
  if (bgPicture) {
    const bgImg = bgPicture.querySelector('img');
    focal = parseFocalPoint(bgImg.dataset.title);
    const optimizedBg = createOptimizedPicture(bgImg.src, bgImg.alt, false, [{ width: '2000' }]);
    optimizedBg.dataset.bg = '';
    const newImg = optimizedBg.querySelector('img');
    if (focal && newImg) applyFocalPoint(newImg, focal);
    bgPicture.replaceWith(optimizedBg);
    if (!colorOverride && newImg) {
      if (newImg.complete) applyImgColor(block);
      else newImg.addEventListener('load', () => applyImgColor(block));
    }
  }

  if (focal && video) applyFocalPoint(video, focal);

  const disclaimer = block.querySelector('.disclaimer');
  if (disclaimer) {
    block.dataset.disclaimer = disclaimer.textContent;
  }
}
