/* global Pixlee */

const DEFAULT_WIDGET_ID = 6665206;

export default function decorate(block) {
  const widgetId = parseInt(block.textContent.trim(), 10) || DEFAULT_WIDGET_ID;
  const container = document.createElement('div');
  container.id = 'pixlee_container';
  block.textContent = '';
  block.appendChild(container);

  window.PixleeAsyncInit = function initPixlee() {
    Pixlee.init({ apiKey: '21Zd2RSf2TKMzGbhr0rr' });
    Pixlee.addSimpleWidget({ widgetId });
  };

  const script = document.createElement('script');
  script.src = 'https://assets.pxlecdn.com/assets/pixlee_widget_1_0_0.js';
  script.async = true;
  document.head.appendChild(script);
}
