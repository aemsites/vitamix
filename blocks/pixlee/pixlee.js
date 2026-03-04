/* global Pixlee */

export default function decorate(block) {
  const container = document.createElement('div');
  container.id = 'pixlee_container';
  block.textContent = '';
  block.appendChild(container);

  window.PixleeAsyncInit = function initPixlee() {
    Pixlee.init({ apiKey: '21Zd2RSf2TKMzGbhr0rr' });
    Pixlee.addSimpleWidget({ widgetId: 6665206 });
  };

  const script = document.createElement('script');
  script.src = 'https://assets.pxlecdn.com/assets/pixlee_widget_1_0_0.js';
  script.async = true;
  document.head.appendChild(script);
}
