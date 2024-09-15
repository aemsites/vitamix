function getVideoElement(source) {
  const videoContainer = document.createElement('div');
  videoContainer.classList.add('video-container');

  const video = document.createElement('video');
  video.setAttribute('controls', '');
  video.setAttribute('autoplay', '');
  video.setAttribute('loop', '');
  video.setAttribute('playsinline', '');
  video.removeAttribute('controls');
  video.addEventListener('canplay', () => {
    video.muted = true;
    video.play();
  });

  const sourceEl = document.createElement('source');
  sourceEl.setAttribute('src', source);
  sourceEl.setAttribute('type', `video/${source.split('.').pop()}`);
  video.append(sourceEl);
  videoContainer.append(video);

  return videoContainer;
}

export default async function decorate(block) {
  if (block.classList.contains('explore')) {
    const icon = document.createElement('div');
    icon.classList.add('explore-icon');
    icon.innerHTML = `
        <svg aria-hidden="true" class="elmt-docked-cta__svg" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="264" height="133">
          <defs>
            <linearGradient id="b" x1="85.424%" x2="0%" y1="-33.833%" y2="50%">
              <stop offset="0%" stop-color="#D9C9A8" />
              <stop offset="100%" stop-color="#A3957A" />
            </linearGradient>
            <path id="a" d="M0 0h264v133H0z" />
          </defs>
          <g fill="none" fill-rule="evenodd">
            <mask id="c" fill="#fff">
              <use xlink:href="#a" />
            </mask>
            <circle cx="131" cy="118" r="86" fill="url(#b)" mask="url(#c)" />
            <circle cx="131" cy="118" r="67.135" fill="#333F48" mask="url(#c)" />
            <g mask="url(#c)">
              <path fill="#333F48" fill-rule="nonzero" d="M124.448 78.683a.552.552 0 0 1-.165-.4.566.566 0 0 1 .966-.4l7.034 7.034 7.034-7.034a.566.566 0 0 1 .8.8l-7.434 7.434c-.22.22-.58.22-.8 0l-7.435-7.434Z" />
              <path class="elmt-docked-cta__pulse" id="pulse" fill="#A2AAAD" d="m140.824 77.176-.118-.108a1.566 1.566 0 0 0-2.096.108l-6.327 6.326-6.328-6.326a1.566 1.566 0 0 0-2.214 2.214l7.435 7.434a1.566 1.566 0 0 0 2.214 0l7.434-7.434a1.566 1.566 0 0 0 0-2.214Z" />
            </g>
          </g>
        </svg>`;
    block.append(icon);
  }
  if (!block.classList.contains('video')) return;
  const link = block.querySelector('a')?.getAttribute('href');
  if (!link) return;

  const video = getVideoElement(link);
  const a = block.querySelector('a');
  (a.parentElement.tagName === 'P' ? a.parentElement : a).replaceWith(video);
}
