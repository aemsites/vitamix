import { loadCSS } from '../../scripts/aem.js';

/**
 * Constructs URL for widget resources.
 * @param {string} widget - Widget name
 * @param {string} extension - File extension
 * @returns {string} Complete URL path to widget resource
 */
function writeUrl(widgetPath, widgetName, extension) {
  return `${window.hlx.codeBasePath}/widgets/${widgetPath}/${widgetName}.${extension}`;
}

/**
 * Decorates widget element by loading HTML, CSS, and JS resources.
 * @param {HTMLElement} widget - Widget container element
 * @returns {Promise<void>} Promise that resolves when widget decoration is complete
 * @throws {Error} Logs errors to console if widget loading fails
 */
export default async function decorate(widget) {
  const source = widget.querySelector('a[href]');
  const { pathname, searchParams } = new URL(source.href);
  const pathSegments = pathname.split('/').filter((p) => p);
  const widgetPath = pathSegments[1]; // extract widget name (after '/widgets/')
  const widgetName = pathSegments[2].split('.')[0]; // extract widget name (after '/widgets/')

  try {
    let cssPrefix = widgetName;
    if (widgetPath !== widgetName) {
      cssPrefix = `${widgetPath}-${widgetName}`;
    }

    const wrapper = widget.closest('.widget-wrapper');
    wrapper.classList.add(`${cssPrefix}-wrapper`);
    const container = wrapper.closest('.widget-container');
    container.classList.add(`${cssPrefix}-container`);
    widget.classList.add(cssPrefix);

    widget.dataset.source = source.href;
    const params = new URLSearchParams(searchParams);
    params.forEach((value, key) => {
      widget.dataset[key] = value;
    });

    const resp = await fetch(writeUrl(widgetPath, widgetName, 'html'));
    widget.innerHTML = await resp.text();

    const cssLoaded = loadCSS(writeUrl(widgetPath, widgetName, 'css'));
    const decorationComplete = (async () => {
      const mod = await import(writeUrl(widgetPath, widgetName, 'js'));
      if (mod.default) await mod.default(widget);
    })();
    await Promise.all([cssLoaded, decorationComplete]);
  } catch (error) {
    // fail gracefully
  }
}
