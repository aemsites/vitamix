import { loadFragment } from '../fragment/fragment.js';
import {
  buildBlock, decorateBlock, loadBlock, loadCSS, toClassName,
} from '../../scripts/aem.js';

/*
  This is not a traditional block, so there is no decorate function.
  Instead, links to a /modals/ path are automatically transformed into a modal.
  Other blocks can also use the createModal() and openModal() functions.
*/

/**
 * @param {Node[]} contentNodes - Fragment child nodes for the modal body
 * @param {string} path - Modal path (for title and config)
 * @param {{ root?: ShadowRoot|DocumentFragment|Element }} [options] - Optional root to append modal to (e.g. embed shadow root)
 */
export async function createModal(contentNodes, path, options = {}) {
  const root = options.root;
  const container = root || document.querySelector('main') || document.body;
  const modalOpenTarget = root?.host || document.body;

  if (root instanceof ShadowRoot) {
    const modalCssHref = new URL('modal.css', import.meta.url).href;
    if (!root.querySelector(`link[href="${modalCssHref}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = modalCssHref;
      root.appendChild(link);
      await new Promise((resolve, reject) => {
        link.onload = resolve;
        link.onerror = reject;
      });
    }
  } else {
    await loadCSS(`${window.hlx.codeBasePath}/blocks/modal/modal.css`);
  }

  const title = toClassName(path.split('/modals/')[1] || 'modal');

  const dialog = document.createElement('dialog');
  const dialogContent = document.createElement('div');
  dialogContent.classList.add('modal-content');
  dialogContent.append(...contentNodes);
  dialog.append(dialogContent);

  const closeButton = document.createElement('button');
  closeButton.classList.add('close-button');
  closeButton.setAttribute('aria-label', 'Close');
  closeButton.setAttribute('data-label', 'Close');
  closeButton.type = 'button';
  closeButton.innerHTML = '<span class="icon icon-close"></span>';
  closeButton.addEventListener('click', () => dialog.close());
  dialog.prepend(closeButton);

  const block = buildBlock('modal', '');
  if (root instanceof ShadowRoot) {
    const wrapper = document.createElement('div');
    wrapper.append(block);
    container.append(wrapper);
  } else {
    container.append(block);
  }
  decorateBlock(block);
  try {
    await loadBlock(block);
  } catch (err) {
    if (root instanceof ShadowRoot) {
      // loadBlock uses document.head + relative URL; modal CSS already in shadow root
    } else {
      throw err;
    }
  }

  // close on click outside the dialog
  dialog.addEventListener('click', (e) => {
    const {
      left, right, top, bottom,
    } = dialog.getBoundingClientRect();
    const { clientX, clientY } = e;
    if (clientX < left || clientX > right || clientY < top || clientY > bottom) {
      dialog.close();
    }
  });

  dialog.addEventListener('close', () => {
    modalOpenTarget.classList.remove('modal-open');
    const wrapper = root instanceof ShadowRoot ? block.parentElement : null;
    block.remove();
    if (wrapper) wrapper.remove();
  });

  block.innerHTML = '';
  block.id = title;
  block.append(dialog);

  if (title.includes('atc')) {
    block.id = 'atc-error';
  }

  return {
    block,
    showModal: () => {
      dialog.showModal();
      modalOpenTarget.classList.add('modal-open');
    },
  };
}

/**
 * @param {string} fragmentUrl - URL or path of the modal fragment
 * @param {{ root?: ShadowRoot|DocumentFragment|Element }} [options] - Optional root (e.g. embed shadow root) to append modal to
 */
export async function openModal(fragmentUrl, options = {}) {
  const path = fragmentUrl.startsWith('http')
    ? new URL(fragmentUrl, window.location).pathname
    : fragmentUrl;

  const fragment = await loadFragment(path);
  const { block, showModal } = await createModal(fragment.childNodes, path, options);
  block.dataset.modalPath = path;
  showModal();
  return block;
}
