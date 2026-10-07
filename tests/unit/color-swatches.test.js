import assert from 'node:assert/strict';
import test from 'node:test';
import loadColorSwatches from '../../scripts/color-swatches.js';

test('loads shared color swatches and adds their CSS variables once', async () => {
  const originalHead = document.head;
  const originalGetElementById = document.getElementById;
  const originalCreateElement = document.createElement;
  const styles = [];
  const requests = [];
  let config = { data: [{ Color: 'black', Value: 'red; } body { color: red' }] };

  document.head = { append: (style) => styles.push(style) };
  document.getElementById = () => null;
  document.createElement = (tagName) => ({ tagName });
  globalThis.__setFetchMock(async (url) => {
    requests.push(url);
    return {
      ok: true,
      json: async () => config,
    };
  });

  try {
    await assert.rejects(loadColorSwatches(), /invalid row/);
    assert.equal(styles.length, 0);

    config = {
      data: [
        { Color: 'black', Value: '#000' },
        { Color: '1100001', Value: '#100' },
      ],
    };
    await Promise.all([loadColorSwatches(), loadColorSwatches()]);
    assert.deepEqual(requests, [
      '/us/en_us/products/config/color-swatches.json',
      '/us/en_us/products/config/color-swatches.json',
    ]);
    assert.equal(styles.length, 1);
    assert.equal(styles[0].id, 'color-swatches');
    assert.equal(styles[0].textContent, '.color-swatch {\n  --color-black: #000;\n  --color-1100001: #100;\n}');
  } finally {
    document.head = originalHead;
    document.getElementById = originalGetElementById;
    document.createElement = originalCreateElement;
    globalThis.__resetTestState();
  }
});
