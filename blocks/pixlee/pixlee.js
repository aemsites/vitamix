export default function decorate(block) {
  // Clear block and insert the Pixlee container
  const container = document.createElement('div');
  container.id = 'pixlee_container';
  block.textContent = '';
  block.appendChild(container);

  // Set up the async init before the script loads
  window.PixleeAsyncInit = function () {
    Pixlee.init({ apiKey: '21Zd2RSf2TKMzGbhr0rr' });
    Pixlee.addSimpleWidget({ widgetId: 6665206 });
  };

  // Dynamically load the Pixlee script
  const script = document.createElement('script');
  script.src = 'https://assets.pxlecdn.com/assets/pixlee_widget_1_0_0.js';
  script.async = true;
  document.head.appendChild(script);
}
