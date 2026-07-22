import { loadFragment } from '../../blocks/fragment/fragment.js';
import { getWidgetLocaleAndLanguage } from './products.js';

function resolveHighlightsFragmentPath(highlights) {
  const value = (highlights || '').trim();
  if (!value) return null;
  if (value.startsWith('/')) return value;
  const { locale, language } = getWidgetLocaleAndLanguage();
  return `/${locale}/${language}/${value}`;
}

async function updateHighlightsSection(widget, highlights) {
  const lifestyleSection = widget.querySelector('.product-list-lifestyle');
  if (!lifestyleSection) return;

  if (!highlights) {
    lifestyleSection.hidden = true;
    return;
  }

  const fragmentPath = resolveHighlightsFragmentPath(highlights);
  const fragment = fragmentPath ? await loadFragment(fragmentPath) : null;
  if (fragment) {
    lifestyleSection.replaceChildren(...fragment.childNodes);
    lifestyleSection.hidden = false;
  } else {
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

function readHighlightsValue(widget) {
  const params = new URLSearchParams(window.location.search);
  return (
    params.get('highlights')
    || params.get('highlight')
    || widget?.dataset?.highlights
    || ''
  ).trim();
}

function syncHighlightsToUrl(highlights) {
  const params = new URLSearchParams(window.location.search);
  params.delete('highlight');
  if (highlights) params.set('highlights', highlights);
  else params.delete('highlights');
  const qs = params.toString();
  const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash || ''}`;
  window.history.replaceState(null, '', nextUrl);
}

function buildConfigPanel(widget) {
  const initial = readHighlightsValue(widget);
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
  input.placeholder = 'plp-fragment or /drafts/.../fragment';
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

  let widgetHref = buildWidgetHref(initial);

  const update = async () => {
    const highlights = input.value.trim();
    widgetHref = buildWidgetHref(highlights);
    syncHighlightsToUrl(highlights);
    if (highlights) widget.dataset.highlights = highlights;
    else delete widget.dataset.highlights;
    await updateHighlightsSection(widget, highlights);
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

  return { panel, input, update };
}

/**
 * Overlays the product-list config bar on an already-decorated widget
 * (loaded via the widget block during loadPage).
 * @param {HTMLElement} widget
 */
export default async function decorateConfig(widget) {
  widget.classList.add('product-list-config-mode');

  const highlights = readHighlightsValue(widget);
  if (highlights) {
    widget.dataset.highlights = highlights;
  }

  const { panel, input } = buildConfigPanel(widget);
  document.body.prepend(panel);
  if (!input.value.trim() && highlights) {
    input.value = highlights;
  }

  await updateHighlightsSection(widget, highlights || input.value.trim());
}
