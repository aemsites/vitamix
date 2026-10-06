import { createOptimizedPicture } from '../../scripts/aem.js';

/**
 * Extracts feature content and percentage coordinates from block rows.
 * @param {Array<HTMLElement>} rows - Array of row elements
 * @returns {Array<Object>} Array of feature config objects
 */
function configureHotspots(rows) {
  const config = [];
  rows.forEach((row) => {
    const [coords, content] = row.children;
    const title = content && content.querySelector('p strong');
    if (!coords || !title || !title.textContent.trim()) return;

    const values = coords.textContent.trim().split(',');
    const [x, y] = values.map((value) => Number(value.trim()));
    const positioned = values.length === 2 && values.every((value) => value.trim())
      && [x, y].every((value) => Number.isFinite(value) && value >= 0 && value <= 100);
    config.push({ title, content, ...(positioned ? { x, y } : {}) });
  });
  return config;
}

/**
 * Highlights a feature and its corresponding hotspot.
 * @param {HTMLElement} block - Block element
 * @param {string} id - Feature ID
 */
function selectHotspot(block, id) {
  block.querySelectorAll('.features > li').forEach((feature) => {
    feature.setAttribute('aria-current', feature.id === id);
  });
  block.querySelectorAll('button.hs').forEach((button) => {
    button.setAttribute('aria-pressed', button.getAttribute('aria-controls') === id);
  });
}

/**
 * Creates a numbered hotspot button for a positioned feature.
 * @param {HTMLElement} block - Block element
 * @param {Object} feature - Feature config
 * @param {number} index - Feature index
 * @param {string} id - Feature ID
 * @returns {HTMLButtonElement} Hotspot button
 */
function buildHotspot(block, feature, index, id) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hs';
  button.dataset.x = feature.x;
  button.dataset.y = feature.y;
  button.style.left = `${feature.x}%`;
  button.style.top = `${feature.y}%`;
  button.setAttribute('aria-controls', id);
  button.setAttribute('aria-label', feature.title.textContent.trim());
  button.setAttribute('aria-pressed', false);

  const number = document.createElement('span');
  number.textContent = index + 1;
  number.setAttribute('aria-hidden', true);
  button.append(number);

  const select = () => {
    if (block.dataset.editing !== 'true') selectHotspot(block, id);
  };
  button.addEventListener('mouseenter', () => {
    if (window.matchMedia('(hover: hover)').matches) select();
  });
  button.addEventListener('focus', select);
  button.addEventListener('click', select);
  return button;
}

/**
 * Copies percentage coordinates to the clipboard.
 * @param {HTMLButtonElement} tooltip - Coordinate copy button
 */
async function copyCoords(tooltip) {
  try {
    await navigator.clipboard.writeText(tooltip.dataset.coords);
    tooltip.dataset.copied = true;
    tooltip.textContent = `Copied ${tooltip.dataset.coords}`;
  } catch {
    tooltip.dataset.copied = false;
  }
}

/**
 * Checks whether hotspot editing mode should be enabled.
 * @returns {boolean} `true` if editing enabled, `false` otherwise
 */
function editingEnabled() {
  const editable = ['.page', '.live', '.network'];
  const { hostname, searchParams } = new URL(window.location.href);
  if (hostname === 'localhost') return true;
  return editable.some((domain) => hostname.endsWith(domain)) && searchParams.get('edit') === 'hotspot';
}

/**
 * Enables drag positioning and copying percentage coordinates in preview.
 * @param {HTMLElement} block - Block element
 */
function enableEditing(block) {
  const wrapper = block.querySelector('.img-wrapper');
  const hotspots = wrapper.querySelector('.hotspots');
  const tooltip = document.createElement('button');
  tooltip.type = 'button';
  tooltip.className = 'tooltip';
  tooltip.hidden = true;
  tooltip.setAttribute('aria-label', 'Copy hotspot coordinates');
  tooltip.addEventListener('click', () => copyCoords(tooltip));

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'button edit';
  toggle.textContent = 'Edit Hotspots';
  toggle.setAttribute('aria-pressed', false);
  toggle.addEventListener('click', () => {
    const editing = toggle.getAttribute('aria-pressed') !== 'true';
    toggle.setAttribute('aria-pressed', editing);
    block.dataset.editing = editing;
    tooltip.hidden = true;
    toggle.textContent = editing ? 'Editing Hotspots' : 'Edit Hotspots';
  });
  wrapper.append(toggle, tooltip);

  let dragging = null;
  const move = (event) => {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    const { button } = dragging;
    const rect = wrapper.getBoundingClientRect();
    const imageRect = hotspots.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const halfWidth = Math.min(button.offsetWidth / 2, rect.width / 2);
    const halfHeight = Math.min(button.offsetHeight / 2, rect.height / 2);
    const x = Math.max(halfWidth, Math.min(rect.width - halfWidth, event.clientX - rect.left));
    const y = Math.max(halfHeight, Math.min(rect.height - halfHeight, event.clientY - rect.top));
    button.dataset.x = Math.round(((rect.left + x - imageRect.left) / imageRect.width) * 1000) / 10;
    button.dataset.y = Math.round(((rect.top + y - imageRect.top) / imageRect.height) * 1000) / 10;
    button.style.left = `${button.dataset.x}%`;
    button.style.top = `${button.dataset.y}%`;
    tooltip.dataset.coords = `${button.dataset.x},${button.dataset.y}`;
    tooltip.textContent = tooltip.dataset.coords;
    tooltip.dataset.copied = false;
    tooltip.hidden = false;
  };

  const finish = (event, cancelled = false) => {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    const { button, x, y } = dragging;
    if (cancelled) {
      button.dataset.x = x;
      button.dataset.y = y;
      button.style.left = `${x}%`;
      button.style.top = `${y}%`;
      tooltip.hidden = true;
    } else {
      move(event);
      copyCoords(tooltip);
    }
    dragging = null;
    delete button.dataset.dragging;
    if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
  };

  wrapper.addEventListener('pointerdown', (event) => {
    if (block.dataset.editing !== 'true' || dragging || event.button !== 0) return;
    const button = event.target.closest('button.hs');
    if (!button) return;
    event.preventDefault();
    dragging = {
      button, pointerId: event.pointerId, x: button.dataset.x, y: button.dataset.y,
    };
    button.dataset.dragging = true;
    button.setPointerCapture(event.pointerId);
    move(event);
  });
  wrapper.addEventListener('pointermove', move);
  wrapper.addEventListener('pointerup', (event) => finish(event));
  wrapper.addEventListener('pointercancel', (event) => finish(event, true));
  wrapper.addEventListener('lostpointercapture', (event) => finish(event, true));
}

/**
 * Builds the image wrapper and its crop-aware hotspot layer.
 * @param {HTMLImageElement} img - Authored image
 * @returns {HTMLElement} Image wrapper
 */
function decorateImage(img) {
  const wrapper = document.createElement('div');
  wrapper.className = 'img-wrapper';
  const picture = createOptimizedPicture(img.src, img.alt, img.loading === 'eager');
  const optimizedImg = picture.querySelector('img');
  ['width', 'height'].forEach((attribute) => {
    if (img.hasAttribute(attribute)) {
      optimizedImg.setAttribute(attribute, img.getAttribute(attribute));
    }
  });
  wrapper.append(picture);
  const hotspots = document.createElement('div');
  hotspots.className = 'hotspots';
  wrapper.append(hotspots);
  const setImageRatio = () => {
    const width = optimizedImg.naturalWidth || Number(img.getAttribute('width'));
    const height = optimizedImg.naturalHeight || Number(img.getAttribute('height'));
    if (width && height) wrapper.style.setProperty('--image-ratio', width / height);
  };
  setImageRatio();
  optimizedImg.addEventListener('load', setImageRatio);
  const resize = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    if (width && height) wrapper.style.setProperty('--frame-ratio', width / height);
  });
  resize.observe(wrapper);
  return wrapper;
}

/**
 * Moves introduction content into a caption and decorates its eyebrow.
 * @param {HTMLElement} introCell - Authored introduction cell
 * @returns {HTMLElement} Caption element
 */
function decorateCaption(cell) {
  const caption = document.createElement('div');
  caption.className = 'caption';
  if (cell) caption.append(...cell.childNodes);
  const heading = caption.querySelector('h1, h2, h3, h4, h5, h6');
  const eyebrow = heading && heading.previousElementSibling;
  if (eyebrow && eyebrow.tagName === 'P' && !eyebrow.querySelector('img, a[href]')) {
    eyebrow.classList.add('eyebrow');
    heading.dataset.eyebrow = eyebrow.textContent.trim();
  }
  return caption;
}

/**
 * Builds the feature list and its corresponding hotspot buttons.
 * @param {HTMLElement} block - Block element
 * @param {Array<HTMLElement>} rows - Authored feature rows
 * @param {HTMLElement} hotspots - Hotspot positioning layer
 * @param {boolean} editable - Whether position editing is available
 * @param {HTMLElement} caption - Decorated caption
 * @returns {HTMLOListElement} Feature list
 */
function decorateFeatures(block, rows, hotspots, editable, caption) {
  const config = configureHotspots(rows);
  const heading = caption.querySelector('h1, h2, h3, h4, h5, h6');
  const headingLevel = heading ? Number(heading.tagName.slice(1)) + 1 : 7;
  const features = document.createElement('ol');
  features.className = 'features';
  const instance = [...document.querySelectorAll('.hotspot')].indexOf(block) + 1;
  config.forEach((feature, i) => {
    const item = document.createElement('li');
    item.id = `hotspot-${instance}-feature-${i + 1}`;
    const select = () => {
      if (block.dataset.editing !== 'true') selectHotspot(block, item.id);
    };
    item.addEventListener('mouseenter', () => {
      if (window.matchMedia('(hover: hover)').matches) select();
    });
    item.addEventListener('click', select);
    if (editable && feature.x === undefined) {
      feature.x = 50;
      feature.y = ((i + 1) / (config.length + 1)) * 100;
    }
    if (feature.x !== undefined) hotspots.append(buildHotspot(block, feature, i, item.id));

    const title = document.createElement(headingLevel <= 6 ? `h${headingLevel}` : 'p');
    title.className = 'feature-title';
    if (headingLevel > 6) {
      title.setAttribute('role', 'heading');
      title.setAttribute('aria-level', headingLevel);
    }
    title.append(...feature.title.childNodes);
    feature.title.closest('p').remove();
    const content = document.createElement('div');
    content.append(title, ...feature.content.childNodes);
    item.append(content);
    features.append(item);
  });
  return features;
}

export default function decorate(block) {
  const [background, ...rows] = block.children;
  const [imageCell, introCell] = background ? background.children : [];
  const img = imageCell && imageCell.querySelector('img');
  if (!img) return;

  const editable = editingEnabled();
  const wrapper = decorateImage(img);
  const caption = decorateCaption(introCell);
  const features = decorateFeatures(block, rows, wrapper.querySelector('.hotspots'), editable, caption);

  block.replaceChildren(wrapper, features);
  if (caption.textContent.trim()) block.prepend(caption);
  if (features.firstElementChild) selectHotspot(block, features.firstElementChild.id);
  if (editable && wrapper.querySelector('button.hs')) enableEditing(block);
}
