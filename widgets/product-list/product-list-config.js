import { loadFragment } from '../../blocks/fragment/fragment.js';
import {
  getWidgetLocaleAndLanguage,
  loadAllProductTypes,
  PLP_DATASETS,
} from './products.js';

const DATASET_LABELS = {
  blenders: 'Blenders',
  accessories: 'Accessories',
  commercial: 'Commercial',
};

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

function readDatasetFromUrl() {
  return new URLSearchParams(window.location.search).get('dataset') || '';
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

function syncDatasetToUrl(dataset) {
  const params = new URLSearchParams(window.location.search);
  if (dataset) params.set('dataset', dataset);
  else params.delete('dataset');
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

function syncDatasetToWidget(widget, dataset) {
  if (dataset) widget.dataset.dataset = dataset;
  else delete widget.dataset.dataset;
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

function setSelectOptions(select, options, value) {
  select.innerHTML = '';
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
}

function buildSelectControl(label, name, options, value) {
  const item = document.createElement('label');
  item.className = 'product-list-config-item';
  const text = document.createElement('span');
  text.textContent = label;
  const select = document.createElement('select');
  select.name = name;
  setSelectOptions(select, options, value);
  item.append(text, select);
  return { item, select };
}

function buildDatasetSelectControl(value) {
  const item = document.createElement('label');
  item.className = 'product-list-config-item';
  const text = document.createElement('span');
  text.textContent = 'Dataset';
  const select = document.createElement('select');
  select.name = 'dataset';
  const selected = PLP_DATASETS.includes(value) ? value : PLP_DATASETS[0];
  PLP_DATASETS.forEach((dataset) => {
    const option = document.createElement('option');
    option.value = dataset;
    option.textContent = DATASET_LABELS[dataset] || dataset;
    option.selected = dataset === selected;
    select.append(option);
  });
  item.append(text, select);
  return { item, select };
}

function buildConfigPanel(widget, {
  productTypes,
  initialHighlights,
  initialProductType,
  initialDataset,
}) {
  const panel = document.createElement('div');
  panel.className = 'product-list-config';

  const controls = document.createElement('div');
  controls.className = 'product-list-config-controls';

  const { item: datasetItem, select: datasetSelect } = buildDatasetSelectControl(initialDataset);

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

  controls.append(datasetItem, highlightsItem, productTypeItem);

  const actions = document.createElement('div');
  actions.className = 'product-list-config-actions';

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.textContent = 'Copy link';

  actions.append(copyButton);
  panel.append(controls, actions);

  const update = async () => {
    const dataset = datasetSelect.value;
    const highlights = highlightsInput.value.trim();
    const productType = productTypeSelect.value;
    syncDatasetToUrl(dataset);
    syncHighlightsToUrl(highlights);
    syncProductTypeToUrl(productType);
    syncDatasetToWidget(widget, dataset);
    syncHighlightsToWidget(widget, highlights);
    syncProductTypeToWidget(widget, productType);
    syncPreviewLink();
    await updateHighlightsSection(widget, highlights);
    await widget.productListApplyDatasetDefaults?.();
  };

  datasetSelect.addEventListener('change', async () => {
    const productTypesForDataset = await loadAllProductTypes(datasetSelect.value);
    setSelectOptions(productTypeSelect, productTypesForDataset, '');
    await update();
  });
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
    panel, highlightsInput, productTypeSelect, datasetSelect, update,
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

  const [defaultDataset] = PLP_DATASETS;
  let dataset = readDatasetFromUrl();
  if (!dataset && widget.dataset.dataset) {
    dataset = widget.dataset.dataset.trim();
  }
  if (!PLP_DATASETS.includes(dataset)) dataset = defaultDataset;
  syncDatasetToUrl(dataset);

  syncHighlightsToWidget(widget, highlights);
  syncProductTypeToWidget(widget, productType);
  syncDatasetToWidget(widget, dataset);
  syncPreviewLink();

  const productTypes = await loadAllProductTypes(dataset);

  const {
    panel, highlightsInput, productTypeSelect, datasetSelect, update,
  } = buildConfigPanel(widget, {
    productTypes,
    initialHighlights: highlights,
    initialProductType: productType,
    initialDataset: dataset,
  });
  document.body.prepend(panel);

  if (highlights && !highlightsInput.value.trim()) {
    highlightsInput.value = highlights;
  }
  if (productType && productTypeSelect.value !== productType) {
    productTypeSelect.value = productType;
  }
  if (dataset && datasetSelect.value !== dataset) {
    datasetSelect.value = dataset;
  }

  await update();
}
