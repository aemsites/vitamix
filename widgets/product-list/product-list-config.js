import { loadFragment } from '../../blocks/fragment/fragment.js';
import { getWidgetLocaleAndLanguage } from './products.js';
import decorate from './product-list.js';

async function updateHighlightsCarousel(widget, highlights) {
  const lifestyleSection = widget.querySelector('.product-list-lifestyle');
  const lifestyleCarousel = widget.querySelector('.product-list-lifestyle-carousel');
  if (!lifestyleCarousel) return;

  if (!highlights) {
    if (lifestyleSection) lifestyleSection.hidden = true;
    return;
  }

  const { locale, language } = getWidgetLocaleAndLanguage();
  const fragment = await loadFragment(`/${locale}/${language}/${highlights}`);
  if (fragment) {
    lifestyleCarousel.replaceChildren(...fragment.childNodes);
    if (lifestyleSection) lifestyleSection.hidden = false;
  } else if (lifestyleSection) {
    lifestyleSection.hidden = true;
  }
}

function buildWidgetHref(highlights) {
  const base = `${window.location.origin}${window.hlx?.codeBasePath || ''}/widgets/product-list/product-list.html`;
  if (!highlights) return base;
  const params = new URLSearchParams();
  params.set('highlights', highlights);
  return `${base}?${params.toString()}`;
}

function readConfigFromSearch() {
  const params = new URLSearchParams(window.location.search);
  return params.get('highlights') || '';
}

function buildConfigPanel(widget) {
  const initial = readConfigFromSearch();
  const panel = document.createElement('div');
  panel.className = 'product-list-config';

  const controls = document.createElement('div');
  controls.className = 'product-list-config-controls';

  const item = document.createElement('label');
  item.className = 'product-list-config-item';
  const text = document.createElement('span');
  text.textContent = 'Highlights fragment';
  const input = document.createElement('input');
  input.type = 'text';
  input.name = 'highlights';
  input.placeholder = 'product-list-fragment';
  input.value = initial;
  item.append(text, input);
  controls.append(item);

  const actions = document.createElement('div');
  actions.className = 'product-list-config-actions';

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.textContent = 'Copy link';

  actions.append(copyButton);
  panel.append(controls, actions);

  let widgetHref = '';

  const update = async () => {
    const highlights = input.value.trim();
    widgetHref = buildWidgetHref(highlights);

    const search = new URLSearchParams(window.location.search);
    if (highlights) search.set('highlights', highlights);
    else search.delete('highlights');
    const qs = search.toString();
    const nextUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', nextUrl);

    widget.dataset.highlights = highlights;
    await updateHighlightsCarousel(widget, highlights);
  };

  input.addEventListener('input', () => { update(); });

  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(widgetHref);
      copyButton.textContent = 'Copied';
      setTimeout(() => { copyButton.textContent = 'Copy link'; }, 1500);
    } catch {
      copyButton.textContent = 'Copy failed';
      setTimeout(() => { copyButton.textContent = 'Copy link'; }, 1500);
    }
  });

  return { panel, update };
}

/**
 * Decorates the product-list widget config UI: runs the real widget decoration
 * (filters, product grid, highlights carousel — everything), then overlays
 * a config bar letting an author pick which fragment renders in the
 * "Shop by lifestyle" highlights carousel, with a live preview.
 * The config bar is attached directly to `document.body`, outside the
 * widget subtree, so it survives regardless of what the widget does to
 * its own DOM.
 * @param {HTMLElement} widget
 */
export default async function decorateConfig(widget) {
  widget.classList.add('product-list-config-mode');
  await decorate(widget);

  const { panel, update } = buildConfigPanel(widget);
  document.body.prepend(panel);
  await update();
}
