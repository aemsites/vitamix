/*
 * Video Block
 * Show a video referenced by a link
 * https://www.hlx.live/developer/block-collection/video
 */

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/**
 * Builds a YouTube embed wrapper from a URL.
 * @param {URL} url - YouTube video URL
 * @param {boolean} autoplay - Whether to autoplay the video
 * @param {boolean} background - Whether the video is decorative
 * @param {string} [ariaLabel=''] - Accessible title for the iframe
 * @returns {HTMLDivElement} Wrapper div containing the iframe
 */
export function embedYoutube(url, autoplay, background, ariaLabel = '') {
  const usp = new URLSearchParams(url.search);
  let suffix = '';
  if (background || autoplay) {
    const suffixParams = {
      autoplay: autoplay ? '1' : '0',
      mute: background ? '1' : '0',
      controls: background ? '0' : '1',
      disablekb: background ? '1' : '0',
      loop: background ? '1' : '0',
      playsinline: background ? '1' : '0',
    };
    suffix = `&${Object.entries(suffixParams).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
  }
  let vid = usp.get('v') ? encodeURIComponent(usp.get('v')) : '';
  const embed = url.pathname;
  if (url.origin.includes('youtu.be')) {
    [, vid] = url.pathname.split('/');
  }

  const temp = document.createElement('div');
  temp.innerHTML = `<div style="left: 0; width: 100%; height: 0; position: relative; padding-bottom: 56.25%;"${background ? ' aria-hidden="true"' : ''}>
      <iframe src="https://www.youtube.com${vid ? `/embed/${vid}?rel=0&v=${vid}${suffix}` : embed}" style="border: 0; top: 0; left: 0; width: 100%; height: 100%; position: absolute;"
      allow="autoplay; fullscreen; picture-in-picture; encrypted-media; accelerometer; gyroscope; picture-in-picture" allowfullscreen="" scrolling="no" loading="lazy"></iframe>
    </div>`;
  temp.querySelector('iframe').setAttribute('title', ariaLabel || 'Content from Youtube');
  return temp.children.item(0);
}

/**
 * Builds a Vimeo embed wrapper from a URL.
 * @param {URL} url - Vimeo video URL
 * @param {boolean} autoplay - Whether to autoplay the video
 * @param {boolean} background - Whether the video is decorative
 * @param {string} [ariaLabel=''] - Accessible title for the iframe
 * @returns {HTMLDivElement} Wrapper div containing the iframe
 */
function embedVimeo(url, autoplay, background, ariaLabel = '') {
  const [, video] = url.pathname.split('/');
  let suffix = '';
  if (background || autoplay) {
    const suffixParams = {
      autoplay: autoplay ? '1' : '0',
      background: background ? '1' : '0',
    };
    suffix = `?${Object.entries(suffixParams).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
  }
  const temp = document.createElement('div');
  temp.innerHTML = `<div style="left: 0; width: 100%; height: 0; position: relative; padding-bottom: 56.25%;"${background ? ' aria-hidden="true"' : ''}>
      <iframe src="https://player.vimeo.com/video/${video}${suffix}"
      style="border: 0; top: 0; left: 0; width: 100%; height: 100%; position: absolute;"
      frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen
      loading="lazy"></iframe>
    </div>`;
  temp.querySelector('iframe').setAttribute('title', ariaLabel || 'Content from Vimeo');
  return temp.children.item(0);
}

/**
 * Creates a native <video> element for an MP4 source.
 * @param {string} source - MP4 URL
 * @param {boolean} autoplay - Whether to autoplay the video
 * @param {boolean} background - Whether the video is decorative
 * @param {string} [ariaLabel=''] - Accessible label for non-background videos
 * @returns {HTMLVideoElement}
 */
function getVideoElement(source, autoplay, background, ariaLabel = '') {
  const video = document.createElement('video');
  video.setAttribute('controls', '');
  if (autoplay) video.setAttribute('autoplay', '');
  if (background) {
    video.setAttribute('loop', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-hidden', 'true');
    video.removeAttribute('controls');
    video.addEventListener('canplay', () => {
      video.muted = true;
      if (autoplay) video.play();
    });
  } else if (ariaLabel) {
    video.setAttribute('aria-label', ariaLabel);
  }

  const sourceEl = document.createElement('source');
  sourceEl.setAttribute('src', source);
  sourceEl.setAttribute('type', `video/${source.split('.').pop()}`);
  video.append(sourceEl);

  return video;
}

/**
 * Detects video type and appends the appropriate embed to the block.
 * @param {HTMLElement} block - Block element to append the embed to
 * @param {string} link - Video URL string
 * @param {boolean} autoplay - Whether to autoplay on load
 * @param {boolean} background - Whether the video is decorative
 * @param {string} [ariaLabel=''] - Accessible label or title passed through to the embed
 */
const loadVideoEmbed = (block, link, autoplay, background, ariaLabel = '') => {
  if (block.dataset.embedLoaded === 'true') {
    return;
  }
  const url = new URL(link);

  const isYoutube = link.includes('youtube') || link.includes('youtu.be');
  const isVimeo = link.includes('vimeo');

  if (isYoutube) {
    const embedWrapper = embedYoutube(url, autoplay, background, ariaLabel);
    block.append(embedWrapper);
    embedWrapper.querySelector('iframe').addEventListener('load', () => {
      block.dataset.embedLoaded = true;
    });
  } else if (isVimeo) {
    const embedWrapper = embedVimeo(url, autoplay, background, ariaLabel);
    block.append(embedWrapper);
    embedWrapper.querySelector('iframe').addEventListener('load', () => {
      block.dataset.embedLoaded = true;
    });
  } else {
    const videoEl = getVideoElement(link, autoplay, background, ariaLabel);
    block.append(videoEl);
    videoEl.addEventListener('canplay', () => {
      block.dataset.embedLoaded = true;
    });
  }
};

export default async function decorate(block) {
  const placeholder = block.querySelector('picture');
  const link = block.querySelector('a[href]');
  const label = block.textContent.replace(link.textContent, '').trim();
  block.textContent = '';
  block.dataset.embedLoaded = false;

  const autoplay = block.classList.contains('autoplay');
  if (placeholder) {
    block.classList.add('placeholder');
    const wrapper = document.createElement('div');
    wrapper.className = 'video-placeholder';
    wrapper.append(placeholder);

    if (!autoplay) {
      wrapper.insertAdjacentHTML(
        'beforeend',
        '<div class="video-placeholder-play"><button type="button" title="Play"></button></div>',
      );
      wrapper.addEventListener('click', () => {
        wrapper.remove();
        loadVideoEmbed(block, link.href, true, false, label);
      });
    }
    block.append(wrapper);
  }

  if (!placeholder || autoplay) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer.disconnect();
        const playOnLoad = autoplay && !prefersReducedMotion.matches;
        loadVideoEmbed(block, link.href, playOnLoad, autoplay, label);
      }
    });
    observer.observe(block);
  }
}
