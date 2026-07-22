import { loadFragment } from '../../blocks/fragment/fragment.js';
import {
  getWidgetLocaleAndLanguage,
  loadAllProductTypes,
} from './products.js';

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

function readHighlightsFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return (params.get('highlights') || params.get('highlight') || '').trim();
}

function readProductTypeFromUrl() {
  return new URLSearchParams(window.location.search).get('productType') || '';
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

function syncProductTypeToUrl(productType) {
  const params = new URLSearchParams(window.location.search);
  if (productType) params.set('productType', productType);
  else params.delete('productType');
  const qs = params.toString();
  const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash || ''}`;
  window.history.replaceState(null, '', nextUrl);
}

function syncHighlightsToWidget(widget, highlights) {
  if (highlights) widget.dataset.highlights = highlights;
  else delete widget.dataset.highlights;
  delete widget.dataset.highlight;
}

function syncProductTypeToWidget(widget, productType) {
  if (productType) widget.dataset.productType = productType;
  else delete widget.dataset.productType;
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

function buildSelectControl(label, name, options, value) {
  const item = document.createElement('label');
  item.className = 'product-list-config-item';
  const text = document.createElement('span');
  text.textContent = label;
  const select = document.createElement('select');
  select.name = name;
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = 'All';
  select.append(empty);
  options.forEach((optionValue) => {
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = optionValue;
    option.selected = optionValue === value;
    select.append(option);
  });
  if (value && !options.includes(value)) {
    const custom = document.createElement('option');
    custom.value = value;
    custom.textContent = value;
    custom.selected = true;
    select.append(custom);
  }
  item.append(text, select);
  return { item, select };
}

function buildConfigPanel(widget, productTypes, initialHighlights, initialProductType) {
  const panel = document.createElement('div');
  panel.className = 'product-list-config';

  const controls = document.createElement('div');
  controls.className = 'product-list-config-controls';

  const highlightsItem = document.createElement('label');
  highlightsItem.className = 'product-list-config-item';
  const highlightsLabel = document.createElement('span');
  highlightsLabel.textContent = 'Highlights fragment';
  const highlightsInput = document.createElement('input');
  highlightsInput.type = 'text';
  highlightsInput.name = 'highlights';
  highlightsInput.placeholder = 'plp-fragment or /drafts/.../fragment';
  highlightsInput.value = initialHighlights;
  highlightsItem.append(highlightsLabel, highlightsInput);

  const { item: productTypeItem, select: productTypeSelect } = buildSelectControl(
    'Product type',
    'productType',
    productTypes,
    initialProductType,
  );

  controls.append(highlightsItem, productTypeItem);

  const actions = document.createElement('div');
  actions.className = 'product-list-config-actions';

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.textContent = 'Copy link';

  actions.append(copyButton);
  panel.append(controls, actions);

  const update = async () => {
    const highlights = highlightsInput.value.trim();
    const productType = productTypeSelect.value;
    syncHighlightsToUrl(highlights);
    syncProductTypeToUrl(productType);
    syncHighlightsToWidget(widget, highlights);
    syncProductTypeToWidget(widget, productType);
    syncPreviewLink();
    await updateHighlightsSection(widget, highlights);
    await widget.productListApplyDatasetDefaults?.();
  };

  highlightsInput.addEventListener('input', () => { update(); });
  productTypeSelect.addEventListener('change', () => { update(); });

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

  return {
    panel, highlightsInput, productTypeSelect, update,
  };
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

  let productType = readProductTypeFromUrl();
  if (!productType && widget.dataset.productType) {
    productType = widget.dataset.productType.trim();
    syncProductTypeToUrl(productType);
  }

  syncHighlightsToWidget(widget, highlights);
  syncProductTypeToWidget(widget, productType);
  syncPreviewLink();

  const productTypes = await loadAllProductTypes();
  const { panel, highlightsInput, productTypeSelect, update } = buildConfigPanel(
    widget,
    productTypes,
    highlights,
    productType,
  );
  document.body.prepend(panel);

  if (highlights && !highlightsInput.value.trim()) {
    highlightsInput.value = highlights;
  }
  if (productType && productTypeSelect.value !== productType) {
    productTypeSelect.value = productType;
  }

  await update();
}
