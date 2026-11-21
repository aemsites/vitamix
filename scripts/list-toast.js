import { loadCSS } from './aem.js';
import { logError } from './operations-log.js';

let hideTimer;

/**
 * Shared list-action toast using the comparison toast's presentation.
 * @param {string} message
 * @param {{ items?: { image: string, title?: string }[], href?: string, label?: string }} options
 */
export default function showListToast(message, options = {}) {
  loadCSS(`${window.hlx?.codeBasePath || ''}/styles/add-to-compare.css`)
    .catch((error) => logError('list-toast', error));
  let toast = document.querySelector('.add-to-compare-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'add-to-compare-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.append(toast);
  }
  toast.replaceChildren();
  const text = document.createElement('p');
  text.className = 'add-to-compare-toast-message';
  text.textContent = message;
  toast.append(text);

  const items = (options.items || []).filter((item) => item.image);
  if (items.length) {
    const thumbs = document.createElement('div');
    thumbs.className = 'add-to-compare-toast-thumbs';
    items.forEach((item) => {
      const image = document.createElement('img');
      image.className = 'add-to-compare-toast-thumb';
      image.src = item.image;
      image.alt = item.title || '';
      image.loading = 'lazy';
      thumbs.append(image);
    });
    toast.append(thumbs);
  }

  const hide = () => {
    toast.classList.remove('add-to-compare-toast-visible');
    toast.querySelector('a')?.setAttribute('tabindex', '-1');
  };
  if (options.href) {
    const link = document.createElement('a');
    link.className = 'add-to-compare-toast-link';
    link.href = options.href;
    link.textContent = options.label || '';
    link.addEventListener('click', hide);
    toast.append(link);
  }
  toast.classList.remove('add-to-compare-toast-visible');
  // eslint-disable-next-line no-void
  void toast.offsetWidth;
  toast.classList.add('add-to-compare-toast-visible');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hide, 15000);
}
