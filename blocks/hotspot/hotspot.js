import { toClassName, createOptimizedPicture } from '../../scripts/aem.js';

/**
 * Sets multiple attributes on an element.
 * @param {HTMLElement} el - Element
 * @param {Object} attrs - Key-value pairs of attributes
 */
function setAttributes(el, attrs) {
  Object.entries(attrs).forEach(([attr, value]) => {
    el.setAttribute(attr, value);
  });
}

/**
 * Extracts hotspot configuration from block rows.
 * @param {Array<HTMLElement>} rows - Array of row elements
 * @returns {Array<Object>} Array of hotspot config objects
 */
function configureHotspots(rows) {
  const config = [];
  rows.forEach((row) => {
    const [coords, popover] = row.children;
    let title = '';
    if (popover.querySelector('strong')) {
      title = popover.querySelector('strong').textContent.trim();
    } else {
      title = popover.textContent.trim().split(' ').slice(0, 3).join(' ')
        .trim();
    }
    const [x, y] = coords.textContent.split(',').map((c) => parseInt(c, 10));
    if (x && y && popover) {
      config.push({
        x,
        y,
        title,
        id: toClassName(title),
        popover: popover.innerHTML.trim(),
      });
    }
  });
  return config;
}

/**
 * Positions hotspot buttons based on the current size of the SVG.
 * @param {HTMLElement} block - Block element
 */
function positionHotspots(block) {
  const svg = block.querySelector('svg');
  const svgWidth = parseInt(svg.getAttribute('width'), 10);
  const svgHeight = parseInt(svg.getAttribute('height'), 10);
  const rect = svg.getBoundingClientRect();
  // calculate scale based on rendered vs. original size
  const scaleX = rect.width / svgWidth;
  const scaleY = rect.height / svgHeight;
  const buttons = block.querySelectorAll('button[data-x][data-y]');
  buttons.forEach((b) => {
    const [x, y] = [b.dataset.x, b.dataset.y].map((coord) => parseInt(coord, 10));
    const top = parseInt(y * scaleY, 10);
    const left = parseInt(x * scaleX, 10);
    b.style.top = `${top}px`;
    b.style.left = `${left}px`;
  });
}

/**
 * Creates hotspot button elements and adds them to block.
 * @param {HTMLElement} block - Block element
 * @param {Array<Object>} config - Array of hotspot config objects
 */
function buildHotspots(block, config) {
  config.forEach((c) => {
    const button = document.createElement('button');
    setAttributes(button, {
      type: 'button',
      class: 'button',
      'data-x': c.x,
      'data-y': c.y,
      popovertarget: c.id,
      'aria-controls': c.id,
      'aria-label': `Toggle ${c.title} hotspot`,
    });
    button.innerHTML = '<i class="glyph glyph-plus"></i>';
    block.append(button);
  });
}

/**
 * Positions a popover element relative to its associated button.
 * @param {HTMLElement} popover - Popover element
 * @param {HTMLElement} button - Button element
 */
function positionPopover(popover, button) {
  const rect = button.getBoundingClientRect();
  const cx = rect.left + (rect.width / 2);
  const top = Math.round(rect.top + window.scrollY);
  const left = Math.round(cx + window.scrollX);
  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;
}

/**
 * Creates popover elements for each hotspot and adds them to block.
 * @param {HTMLElement} block - Block element
 * @param {Array<Object>} config - Array of hotspot config objects
 */
function buildPopovers(block, config) {
  config.forEach((c) => {
    const popover = document.createElement('div');
    setAttributes(popover, {
      id: c.id,
      popover: 'auto',
    });
    block.append(popover);
    // populate content dynamically on first toggle
    popover.addEventListener('toggle', () => {
      popover.innerHTML = c.popover;
    }, { once: true });
    const button = block.querySelector(`[popovertarget="${c.id}"]`);
    popover.addEventListener('toggle', (e) => {
      button.setAttribute('aria-expanded', e.newState === 'open');
      if (e.newState === 'open') positionPopover(popover, button);
    });
  });
}

export default function decorate(block) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const config = configureHotspots([...block.children]);
  const img = block.querySelector('img[src]');

  // wrap image in svg to enable absolute positioning of hotspots
  if (img) {
    const { width, height } = img;
    const svg = document.createElementNS(SVG_NS, 'svg');
    setAttributes(svg, {
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
    });
    const image = document.createElementNS(SVG_NS, 'image');
    const picture = createOptimizedPicture(img.src, '', false, [{ width: '2000' }]);
    setAttributes(image, {
      href: picture.querySelector('img').src,
      x: 0,
      y: 0,
      width,
      height,
    });
    svg.appendChild(image);
    block.replaceChildren(svg);
  }

  // build and position hotspots
  if (config.length > 0) {
    const resize = new ResizeObserver(() => {
      const rect = block.getBoundingClientRect();
      // hotspot positioning is dependent on block visibility
      if (rect.width > 0) {
        if (!block.dataset.hotspots) {
          buildHotspots(block, config);
          block.dataset.hotspots = true;
          buildPopovers(block, config);
        }
        positionHotspots(block);
        const openPopover = block.querySelector('[popover]:not([hidden])');
        if (openPopover) {
          const button = block.querySelector(`[popovertarget="${openPopover.id}"]`);
          positionPopover(openPopover, button);
        }
      }
    });
    resize.observe(block);
  }
}
