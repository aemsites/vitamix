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

/**
 * Derives `window.hlx.codeBasePath` from the widget URL.
 * @param {string} widgetPath
 * @param {string} widgetName
 */
function setupCodeBasePath(widgetPath, widgetName) {
  window.hlx = window.hlx || {};
  if (window.hlx.codeBasePath !== undefined) return;
  window.hlx.codeBasePath = window.location.pathname
    .replace(new RegExp(`/widgets/${widgetPath}/${widgetName}(?:\\.html)?$`), '')
    .replace(/\/$/, '');
}

/**
 * Wraps widget markup in a simulated page shell (`header`, `main`, `footer`).
 * @param {string} widgetName
 * @returns {HTMLElement} Widget root element
 */
function setupPageShell(widgetName) {
  const existing = document.querySelector(`.${widgetName}.widget, .${widgetName}`);
  if (existing) return existing;

  const { body } = document;
  const markup = [...body.children].filter((el) => el.tagName !== 'SCRIPT');

  const header = document.createElement('header');
  const main = document.createElement('main');
  const footer = document.createElement('footer');
  const section = document.createElement('div');
  section.className = 'section';
  const container = document.createElement('div');
  container.className = `${widgetName}-container`;
  const wrapper = document.createElement('div');
  wrapper.className = `${widgetName}-wrapper`;
  const widget = document.createElement('div');
  widget.className = `${widgetName} widget`;

  markup.forEach((node) => widget.append(node));
  wrapper.append(widget);
  container.append(wrapper);
  section.append(container);
  main.append(section);
  body.replaceChildren(header, main, footer);

  if (!document.querySelector('meta[name="viewport"]')) {
    const viewport = document.createElement('meta');
    viewport.name = 'viewport';
    viewport.content = 'width=device-width, initial-scale=1';
    document.head.append(viewport);
  }

  return widget;
}

/**
 * Applies URL search params to the widget dataset.
 * @param {HTMLElement} widget
 */
function applySearchParams(widget) {
  new URLSearchParams(window.location.search).forEach((value, key) => {
    widget.dataset[key] = value;
  });
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
    loadCSS(`${widgetBase}/${widgetName}.css`),
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
  const widget = setupPageShell(widgetName);
  applySearchParams(widget);
  await loadConfigStyles(widgetPath, widgetName);

  const base = window.hlx.codeBasePath;
  const mod = await import(`${base}/widgets/${widgetPath}/${widgetName}-config.js`);
  if (mod.default) await mod.default(widget);
}

initWidgetConfig();
