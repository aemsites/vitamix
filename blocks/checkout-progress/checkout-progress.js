import { loadCSS } from '../../scripts/aem.js';
import { getConfig } from '../../scripts/commerce-config.js';

loadCSS('/styles/commerce-tokens.css');

const STEP_KEYS = ['cart-new', 'checkout', 'complete'];

export default function decorate(block) {
  const config = getConfig();
  const s = config.getStrings();
  const currentPath = window.location.pathname;

  const steps = [
    { key: 'cart-new', label: s.stepCart },
    { key: 'checkout', label: s.stepCheckout },
    { key: 'complete', label: s.stepConfirmation },
  ];

  const stepPaths = STEP_KEYS.map((key) => config.getOrderPath(key));
  const activeIndex = stepPaths.findIndex((path) => currentPath.includes(path));

  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', s.checkoutStepsLabel);

  const ol = document.createElement('ol');

  steps.forEach(({ key, label }, i) => {
    const li = document.createElement('li');
    li.className = 'step';
    li.classList.add(`step-${key}`);

    if (i < activeIndex) {
      li.classList.add('step-complete');
      const a = document.createElement('a');
      a.href = stepPaths[i];
      a.textContent = label;
      li.appendChild(a);
    } else if (i === activeIndex) {
      li.classList.add('step-active');
      li.setAttribute('aria-current', 'step');
      const span = document.createElement('span');
      span.textContent = label;
      li.appendChild(span);
    } else {
      const span = document.createElement('span');
      span.textContent = label;
      li.appendChild(span);
    }

    ol.appendChild(li);
  });

  nav.appendChild(ol);
  block.replaceChildren(nav);
}
