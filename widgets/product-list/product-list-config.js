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

/** Reads highlights from the config page URL only. */
function readHighlightsFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return (params.get('highlights') || params.get('highlight') || '').trim();
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

function syncHighlightsToWidget(widget, highlights) {
  if (highlights) widget.dataset.highlights = highlights;
  else delete widget.dataset.highlights;
  delete widget.dataset.highlight;
}

function syncPreviewLink() {
  const link = document.querySelector('main[data-widget-config-preview] a[href^="/widgets"]');
  if (!link) return;
  link.href = `${window.location.pathname}${window.location.search}`;
  link.textContent = `${window.location.origin}${link.href}`;
}

function buildWidgetHref() {
  const base = `${window.location.origin}${window.hlx?.codeBasePath || ''}/widgets/product-list/product-list.html`;
  return `${base}${window.location.search}`;
}

function buildConfigPanel(widget) {
  const initial = readHighlightsFromUrl();
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

  const update = async () => {
    const highlights = input.value.trim();
    syncHighlightsToUrl(highlights);
    syncHighlightsToWidget(widget, highlights);
    syncPreviewLink();
    await updateHighlightsSection(widget, highlights);
  };

  input.addEventListener('input', () => { update(); });

  copyButton.addEventListener('click', async () => {
    const widgetHref = buildWidgetHref();
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

  let highlights = readHighlightsFromUrl();
  if (!highlights && widget.dataset.highlights) {
    highlights = widget.dataset.highlights.trim();
    syncHighlightsToUrl(highlights);
  }
  syncHighlightsToWidget(widget, highlights);
  syncPreviewLink();

  const { panel, input } = buildConfigPanel(widget);
  document.body.prepend(panel);

  if (highlights && !input.value.trim()) {
    input.value = highlights;
  }

  await updateHighlightsSection(widget, highlights);
}
