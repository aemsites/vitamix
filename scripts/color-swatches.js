const COLOR_SWATCHES_URL = '/us/en_us/products/config/color-swatches.json';
const COLOR_SWATCH_STYLE_ID = 'color-swatches';

let colorSwatchesPromise;

function buildColorSwatchesCSS(data) {
  if (!Array.isArray(data?.data) || data.data.length === 0) {
    throw new Error('Color swatches configuration has no data rows');
  }

  const variables = data.data.map((row) => {
    if (!row || typeof row !== 'object') {
      throw new Error('Color swatches configuration contains an invalid row');
    }
    const { Color, Value } = row;
    if (
      typeof Color !== 'string'
      || !/^[a-z0-9-]+$/i.test(Color)
      || typeof Value !== 'string'
      || !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(Value)
    ) {
      throw new Error('Color swatches configuration contains an invalid row');
    }
    return `  --color-${Color}: ${Value};`;
  });

  return `.color-swatch {\n${variables.join('\n')}\n}`;
}

/**
 * Load color swatches from the shared configuration and expose them as CSS variables.
 * @returns {Promise<void>} Resolves when loading is complete; failures are logged and non-fatal
 */
export default function loadColorSwatches() {
  if (!colorSwatchesPromise) {
    colorSwatchesPromise = (async () => {
      const response = await fetch(COLOR_SWATCHES_URL);
      if (!response.ok) {
        throw new Error(`Failed to load color swatches (${response.status})`);
      }

      const css = buildColorSwatchesCSS(await response.json());
      let style = document.getElementById(COLOR_SWATCH_STYLE_ID);
      if (!style) {
        style = document.createElement('style');
        style.id = COLOR_SWATCH_STYLE_ID;
        document.head.append(style);
      }
      style.textContent = css;
    })().catch((error) => {
      colorSwatchesPromise = undefined;
      // Swatch colors are cosmetic; a missing config must not block page rendering.
      // eslint-disable-next-line no-console
      console.warn('color-swatches: failed to load configuration', error);
    });
  }

  return colorSwatchesPromise;
}
