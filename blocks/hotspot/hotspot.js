import { toClassName, createOptimizedPicture, fetchPlaceholders } from '../../scripts/aem.js';
import { applyImgColor, getLocaleAndLanguage } from '../../scripts/scripts.js';

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
    if (coords && popover) {
      let title = '';
      if (popover.querySelector('strong')) {
        title = popover.querySelector('strong').textContent.trim();
      } else {
        title = popover.textContent.trim().split(' ').slice(0, 3).join(' ')
          .trim();
      }
      const thisConfig = {
        title,
        id: toClassName(title),
        popover: popover.innerHTML.trim(),
      };
      const [x, y] = coords.textContent.split(',').map((c) => parseInt(c, 10));
      if (x && y) {
        // include coordinates for positioned hotspots
        config.push({ ...thisConfig, x, y });
      } else config.push(thisConfig);
    }
  });
  return config;
}

/**
 * Positions hotspot buttons based on the current size of the SVG.
 * @param {HTMLElement} block - Block element
 */
function positionHotspots(block) {
  const wrapper = block.querySelector('.svg-wrapper');
  const svg = wrapper.querySelector('svg');
  const svgWidth = parseInt(svg.getAttribute('width'), 10);
  const svgHeight = parseInt(svg.getAttribute('height'), 10);

  // get current rendered size
  const rect = svg.getBoundingClientRect();
  const wrapperW = wrapper.clientWidth; // visible width
  const isScaled = window.matchMedia('(min-width: 700px)').matches;
  const offsetX = isScaled ? Math.max(0, (rect.width - wrapperW) / 2) : 0;

  // calculate scale based on rendered vs. original size
  const scaleX = rect.width / svgWidth;
  const scaleY = rect.height / svgHeight;
  const buttons = block.querySelectorAll('button[data-x][data-y]');
  buttons.forEach((b) => {
    const [x, y] = [b.dataset.x, b.dataset.y].map((coord) => parseInt(coord, 10));

    // convert to current rendered pixels
    const left = Math.round(x * scaleX - offsetX); // subtract crop
    const top = Math.round(y * scaleY); // no vertical crop
    b.style.top = `${top}px`;
    b.style.left = `${left}px`;
  });
}

/**
 * Arranges hotspots without coordinates into a staging grid for editing.
 * @param {HTMLElement} block - Block element
 */
function stageInvalidHotspots(block) {
  const svg = block.querySelector('svg');
  const svgWidth = parseInt(svg.getAttribute('width'), 10);
  const svgHeight = parseInt(svg.getAttribute('height'), 10);
  const rect = svg.getBoundingClientRect();
  const scaleX = rect.width / svgWidth;
  const scaleY = rect.height / svgHeight;

  // define safe frame boundaries to keep hotspots visible and accessible (in rendered pixels)
  const SAFE = {
    left: 96,
    right: rect.width - 96,
    top: 32,
    bottom: rect.height - 32,
  };

  const BTN = 64; // touch target size (rendered px)
  const GAP = 16; // spacing between buttons
  const PAD = 4; // inner padding inside the safe frame
  const STEP = BTN + GAP; // total space needed per button
  const SHIFT = Math.round(STEP / 2); // stagger offset for odd columns

  // rows that fit in a given column; odd columns lose space due to SHIFT
  const usableHeight = Math.max(0, rect.height - (SAFE.top * 2));
  const rowsForCol = (col) => {
    const loss = (col % 2 === 1) ? SHIFT : 0;
    return Math.max(1, Math.floor((usableHeight - loss) / STEP));
  };

  let col = 0;
  let row = 0;

  // wrap if needed based on this column's capacity
  const nextPos = () => {
    const capacity = rowsForCol(col);
    if (row >= capacity) { row = 0; col += 1; }

    const isOdd = col % 2 === 1;
    const top = Math.round(SAFE.top + PAD + (isOdd ? SHIFT : 0) + row * STEP);
    const left = Math.round(SAFE.left + PAD + col * STEP);

    row += 1; // advance for next button
    return { top, left };
  };

  block.querySelectorAll('button[data-x][data-y]').forEach((btn) => {
    const [x, y] = [btn.dataset.x, btn.dataset.y].map((coord) => parseInt(coord, 10));

    if (!x || !y) {
      // stage buttons that don't have valid coordinates
      const { top, left } = nextPos();
      btn.style.top = `${top}px`;
      btn.style.left = `${left}px`;
      btn.setAttribute('data-unplaced', true);
      btn.title = btn.getAttribute('aria-controls').split('-').join(' ').trim();
    } else {
      const pxX = x * scaleX;
      const pxY = y * scaleY;
      // mark buttons that are outside the safe frame
      if (pxX < SAFE.left || pxX > SAFE.right || pxY < SAFE.top || pxY > SAFE.bottom) {
        btn.setAttribute('data-unplaced', 'true');
        btn.title = `${(btn.getAttribute('aria-controls').split('-').join(' ')).trim()} hotspot`;
      }
    }
  });
}

/**
 * Creates hotspot button elements and adds them to block.
 * @param {HTMLElement} block - Block element
 * @param {Array<Object>} config - Array of hotspot config objects
 */
function buildHotspots(block, config) {
  const svgWrapper = block.querySelector('.svg-wrapper');
  config.forEach((c) => {
    const button = document.createElement('button');
    setAttributes(button, {
      type: 'button',
      class: 'button hs',
      'data-x': c.x,
      'data-y': c.y,
      popovertarget: c.id,
      'aria-controls': c.id,
      'aria-label': `Toggle ${c.title} hotspot`,
    });
    button.innerHTML = '<i class="glyph glyph-plus"></i>';
    svgWrapper.append(button);
  });
}

/**
 * Positions a popover element relative to its associated button.
 * @param {HTMLElement} popover - Popover element
 * @param {HTMLElement} button - Associated button element
 */
function positionPopover(popover, button) {
  const rect = button.getBoundingClientRect();

  // calculate horizontal center of the button
  const cx = rect.left + (rect.width / 2);
  // position at button's top edge (accounting for scroll)
  const top = Math.round(rect.top + window.scrollY);
  // center horizontally on button (accounting for scroll)
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
  const svgWrapper = block.querySelector('.svg-wrapper');
  config.forEach((c) => {
    const popover = document.createElement('div');
    setAttributes(popover, {
      id: c.id,
      popover: 'auto',
    });
    svgWrapper.append(popover);
    // populate content dynamically on first toggle
    popover.addEventListener('toggle', () => {
      popover.innerHTML = c.popover;
    }, { once: true });
    const button = block.querySelector(`[popovertarget="${c.id}"]`);
    popover.addEventListener('toggle', (e) => {
      button.setAttribute('aria-expanded', e.newState === 'open');
      // position popover relative to its button when opened
      if (e.newState === 'open') positionPopover(popover, button);
    });
  });
}

/**
 * Copies coordinates to clipboard.
 * @param {HTMLElement} tooltip - Tooltip element
 */
function copyCoords(tooltip) {
  navigator.clipboard.writeText(tooltip.dataset.coords).catch(() => {});
  tooltip.classList.add('copied');
  setTimeout(() => tooltip.classList.remove('copied'), 3000);
}

/**
 * Checks whether hotspot editing mode should be enabled.
 * @returns {boolean} `true` if editing enabled, `false` otherwise
 */
function editingEnabled() {
  // only enable editing on non-production domains
  const editable = ['.page', '.live', '.network'];
  const { hostname, searchParams } = new URL(window.location.href);
  if (hostname === 'localhost') return true;
  return editable.some((e) => hostname.endsWith(e)) && searchParams.get('edit') === 'hotspot';
}

/**
 * Enables editing mode for hotspot positioning.
 * @param {HTMLElement} block - Block element
 */
function enableEditing(block) {
  const svgWrapper = block.querySelector('.svg-wrapper');
  stageInvalidHotspots(block);

  // create live coordinates tooltip
  const tooltip = document.createElement('div');
  setAttributes(tooltip, {
    class: 'tooltip',
    role: 'button',
    tabIndex: -1,
    'aria-hidden': true,
  });
  svgWrapper.prepend(tooltip);
  tooltip.addEventListener('click', () => {
    copyCoords(tooltip);
  });

  // create editing mode toggle button
  const toggle = document.createElement('button');
  setAttributes(toggle, {
    type: 'button',
    class: 'button edit',
    'aria-label': 'Toggle editing mode',
    'aria-pressed': false,
  });
  toggle.textContent = 'Edit Hotspots';
  block.prepend(toggle);
  toggle.addEventListener('click', () => {
    const pressed = toggle.getAttribute('aria-pressed') === 'true';
    toggle.setAttribute('aria-pressed', !pressed);
    block.dataset.editing = !pressed;
    tooltip.setAttribute('aria-hidden', true);
    toggle.textContent = pressed ? 'Edit Hotspots' : 'Editing Hotspots';
  });

  const svg = block.querySelector('svg');
  const svgWidth = parseInt(svg.getAttribute('width'), 10);
  const svgHeight = parseInt(svg.getAttribute('height'), 10);

  let dragging = null; // the button being dragged

  // start dragging when pointer is pressed on a hotspot button
  block.addEventListener('pointerdown', (e) => {
    const editing = block.dataset.editing === 'true';
    if (!editing) return;

    const clicked = e.target.closest('[popovertarget]');
    if (!clicked) return;

    // capture all pointer events to this button during drag
    clicked.setPointerCapture(e.pointerId);
    clicked.setAttribute('aria-dragging', true);
    dragging = clicked;
    tooltip.setAttribute('aria-hidden', true);
  });

  // update position as pointer moves
  block.addEventListener('pointermove', (e) => {
    if (!dragging) return;

    const open = block.querySelector('[popover]:popover-open');
    if (open) open.hidePopover();

    const rect = svg.getBoundingClientRect();
    // define safe frame to keep hotspots visible and accessible
    const SAFE = {
      left: 96,
      right: rect.width - 96,
      top: 32,
      bottom: rect.height - 32,
    };
    // utility to constrain value within min/max bounds
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

    // calculate pointer position relative to SVG element
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const xClamped = clamp(Math.round(x), SAFE.left, SAFE.right);
    const yClamped = clamp(Math.round(y), SAFE.top, SAFE.bottom);

    // position button under pointer, clamped to safe frame boundaries
    dragging.style.top = `${yClamped}px`;
    dragging.style.left = `${xClamped}px`;

    // update coordinates tooltip display
    const ttx = Math.round((xClamped / rect.width) * svgWidth);
    const tty = Math.round((yClamped / rect.height) * svgHeight);
    tooltip.setAttribute('aria-hidden', false);
    tooltip.textContent = `${ttx},${tty}`;
    tooltip.style.left = `${xClamped + 32}px`; // offset tooltip slightly
    tooltip.style.top = `${yClamped - 12}px`;
  });

  // finalize position when pointer is released
  block.addEventListener('pointerup', (e) => {
    if (!dragging) return;

    // get current rendered position (in screen pixels)
    const renderedX = parseInt(dragging.style.left, 10);
    const renderedY = parseInt(dragging.style.top, 10);

    // convert rendered position back to SVG coordinate space
    const rect = svg.getBoundingClientRect();
    const svgX = Math.round((renderedX / rect.width) * svgWidth);
    const svgY = Math.round((renderedY / rect.height) * svgHeight);
    dragging.dataset.x = svgX;
    dragging.dataset.y = svgY;
    tooltip.dataset.coords = `${svgX},${svgY}`;

    copyCoords(tooltip);

    // clean up drag state
    dragging.releasePointerCapture?.(e.pointerId);
    dragging.removeAttribute('aria-dragging');
    dragging.setAttribute('data-unplaced', 'false');
    dragging = null;
  });
}

/**
 * Activates the hotspot "explore" mode.
 * @param {HTMLElement} block - Block element
 * @param {HTMLButtonElement} button - Expand button
 * @param {Object} ph - Placeholders object
 */
function toggleExplore(block, button, ph) {
  block.dataset.explore = true;
  button.disabled = true;
  button.textContent = ph.swipeToExplore || 'Swipe to Explore';
  const svgWrapper = block.querySelector('.svg-wrapper');
  svgWrapper.scrollTo({
    left: (svgWrapper.scrollWidth / 2) - (svgWrapper.clientWidth / 2),
    behavior: 'smooth',
  });
  svgWrapper.addEventListener('scroll', () => {
    button.style.left = `calc(1ch + ${svgWrapper.scrollLeft}px)`;
  });
}

/**
 * Builds and prepends the "Click to Explore" button for mobile
 * @param {HTMLElement} block - Block element
 */
async function buildExpand(block) {
  const { locale, language } = await getLocaleAndLanguage();
  const ph = await fetchPlaceholders(`/${locale}/${language}`);

  const svgWrapper = block.querySelector('.svg-wrapper');
  const button = document.createElement('button');
  setAttributes(button, {
    type: 'button',
    class: 'button expand',
  });
  button.textContent = ph.clickToExplore || 'Click to Explore';
  button.addEventListener('click', () => {
    toggleExplore(block, button, ph);
  });
  svgWrapper.prepend(button);
}

export default function decorate(block) {
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const hotspots = [...block.children];
  const bg = hotspots.shift();
  const [imgWrapper, caption] = bg.children;

  const config = configureHotspots(hotspots);

  // wrap image in svg to enable absolute positioning of hotspots
  if (imgWrapper) {
    const img = imgWrapper.querySelector('img[src]');
    const { width, height } = img;
    const svg = document.createElementNS(SVG_NS, 'svg');
    setAttributes(svg, {
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
    });
    const svgWrapper = document.createElement('div');
    svgWrapper.className = 'svg-wrapper';
    svgWrapper.append(svg);

    // create optimized image element within SVG
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

    if (caption && caption.textContent.trim()) {
      applyImgColor(block);
      caption.classList.add('caption');
      block.replaceChildren(caption, svgWrapper);
    } else {
      block.replaceChildren(svgWrapper);
    }
  }

  // build and position hotspots
  if (imgWrapper && config.length > 0) {
    const resize = new ResizeObserver(() => {
      const rect = block.getBoundingClientRect();

      // only initialize and position when block is visible
      if (rect.width > 0) {
        if (!block.dataset.hotspots) {
          buildHotspots(block, config);
          block.dataset.hotspots = true;
          buildPopovers(block, config);
          buildExpand(block);
          if (editingEnabled()) enableEditing(block);
        }

        // update hotspot positions on every resize
        positionHotspots(block);

        if (block.dataset.explore === 'true' && window.matchMedia('(min-width: 700px)').matches) {
          const wrapper = block.querySelector('.svg-wrapper');
          wrapper.scrollTo({ left: 0, behavior: 'smooth' });
        }

        // reposition any open popover to stay aligned with its button
        const openPopover = block.querySelector('[popover]:popover-open');
        if (openPopover) {
          const button = block.querySelector(`[popovertarget="${openPopover.id}"]`);
          positionPopover(openPopover, button);
        }
      }
    });
    resize.observe(block);
  }
}
