import { loadCSS } from '../../scripts/aem.js';

/**
 * Constructs URL for widget resources.
 * @param {string} widget - Widget name
 * @param {string} extension - File extension
 * @returns {string} Complete URL path to widget resource
 */
function writeUrl(widget, extension) {
  return `${window.hlx.codeBasePath}/widgets/${widget}/${widget}.${extension}`;
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
  const widgetName = pathSegments[1]; // extract widget name (after '/widgets/')

  try {
    // load and populate html
    const resp = await fetch(writeUrl(widgetName, 'html'));
    widget.innerHTML = await resp.text();

    // load css asynchronously
    const cssLoaded = loadCSS(writeUrl(widgetName, 'css'));

    // load and execute js
    const decorationComplete = (async () => {
      const mod = await import(writeUrl(widgetName, 'js'));
      if (mod.default) await mod.default(widget);
    })();
    await Promise.all([cssLoaded, decorationComplete]);

    // apply widget styling and metadata
    const wrapper = widget.closest('.widget-wrapper');
    wrapper.classList.add(`${widgetName}-wrapper`);
    const container = wrapper.closest('.widget-container');
    container.classList.add(`${widgetName}-container`);
    widget.classList.add(widgetName);
    widget.dataset.source = source.href;
    const params = new URLSearchParams(searchParams);
    params.forEach((value, key) => {
      widget.dataset[key] = value;
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`Failed to load ${widgetName} widget:`, error);
  }
}
