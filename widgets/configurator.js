import { loadCSS } from '../scripts/aem.js';

const WIDGET_PATH = /\/widgets\/(.+)\/([^/]+?)(?:\.html)?$/;

/**
 * Parses the widget folder and name from the current URL.
 * @returns {{ widgetPath: string, widgetName: string }|null}
 */
function parseWidgetLocation() {
  const path = window.location.pathname.replace(/\/$/, '');
  const match = path.match(WIDGET_PATH);
  if (!match) return null;
  return { widgetPath: match[1], widgetName: match[2] };
}

function setupCodeBasePath(widgetPath, widgetName) {
  window.hlx = window.hlx || {};
  if (window.hlx.codeBasePath !== undefined) return;
  window.hlx.codeBasePath = window.location.pathname
    .replace(new RegExp(`/widgets/${widgetPath}/${widgetName}(?:\\.html)?$`), '')
    .replace(/\/$/, '');
}

function ensurePreviewShell() {
  if (document.querySelector('main[data-widget-config-preview]')) return;

  const widgetHref = `${window.location.pathname}${window.location.search}`;
  const main = document.createElement('main');
  main.dataset.widgetConfigPreview = '';
  const section = document.createElement('div');
  section.className = 'section';
  const div = document.createElement('div');
  const link = document.createElement('a');
  link.href = widgetHref;
  link.textContent = `${window.location.origin}${widgetHref}`;
  div.append(link);
  section.append(div);
  main.append(section);

  document.body.prepend(main);
  document.body.classList.add('appear');
}

/**
 * Waits for the widget block to finish loading and decorating.
 * @returns {Promise<HTMLElement|null>}
 */
async function waitForWidgetBlock() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const widget = document.querySelector('.widget.block, .widget');
    const named = document.querySelector('.product-list.block, .product-list.widget, .product-list');
    const target = named || widget;
    const hasSource = !!target?.dataset?.source;
    const hasMarkup = !!target?.querySelector('.product-list-widget, .product-list-results');
    if (target && (hasSource || hasMarkup)) return target;
    await new Promise((resolve) => { requestAnimationFrame(resolve); });
  }
  return null;
}

/**
 * Loads styles needed for widget config pages.
 * @param {string} widgetPath
 * @param {string} widgetName
 */
async function loadConfigStyles(widgetPath, widgetName) {
  const base = window.hlx.codeBasePath;
  const widgetBase = `${base}/widgets/${widgetPath}`;
  await Promise.all([
    loadCSS(`${base}/styles/styles.css`),
    loadCSS(`${widgetBase}/${widgetName}-config.css`),
  ]);
}

/**
 * Bootstraps a widget config page opened directly at its HTML URL.
 */
async function initWidgetConfig() {
  const location = parseWidgetLocation();
  if (!location) return;

  const { widgetPath, widgetName } = location;
  setupCodeBasePath(widgetPath, widgetName);

  document.querySelectorAll('body > .product-list-widget').forEach((el) => {
    el.remove();
  });

  ensurePreviewShell();

  try {
    const { loadPage } = await import('../scripts/scripts.js');
    await loadPage();

    await loadConfigStyles(widgetPath, widgetName);

    const widget = await waitForWidgetBlock();
    if (!widget) return;

    const base = window.hlx.codeBasePath;
    const mod = await import(`${base}/widgets/${widgetPath}/${widgetName}-config.js`);
    if (mod.default) await mod.default(widget);
  } catch {
    // fail gracefully
  }
}

initWidgetConfig();
