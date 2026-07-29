import {
  parseNavPromos,
  findCurrentScheduledItem,
  currentPastFuture,
  formatShortDateTime,
  formatDuration,
  createTimeline,
} from '../../scripts/scripts.js';
import { buildPromoCard } from '../header/header.js';

/**
 * Creates a structured list of parsed promo elements with appropriate CSS classes and content.
 * @param {Array<Object>} promos - Array of promo objects
 * @param {Object|null} [bestPromo=null] - The optimal promo to highlight with special styling
 * @param {Date} [date=new Date()] - Reference date for determining promo status
 * @returns {HTMLUListElement} Unordered list element containing all promo items
 */
function createParsedPromos(promos, bestPromo = null, date = new Date()) {
  const list = document.createElement('ul');
  promos.forEach((promo) => {
    const row = document.createElement('li');
    if (bestPromo === promo) {
      row.classList.add('alert-banners-selected');
    }

    const duration = promo.end - promo.start;
    const isNegativeDuration = duration < 0;

    if (promo.valid && !isNegativeDuration) {
      row.classList.add('alert-banners-valid');
    } else {
      row.classList.add('alert-banners-invalid');
    }
    row.classList.add(`alert-banners-${currentPastFuture(promo.start, promo.end, date)}`);

    list.appendChild(row);
    row.innerHTML = `
      <div class="alert-banners-date">${formatShortDateTime(promo.start)} - ${formatShortDateTime(promo.end)} [${formatDuration(duration)}]</div>
      <div class="alert-banners-content">${promo.content.innerHTML}</div>
      `;
  });
  return list;
}

/**
 * Renders the author-facing preview: timeline, date simulator, list, and a live preview card
 * built from the same buildPromoCard used in production, so authors see the actual markup.
 * @param {HTMLElement} block - The nav-promos block element
 * @param {Array<Object>} promos - Parsed promo rows
 */
function renderPreview(block, promos) {
  const previewWrapper = document.createElement('div');
  previewWrapper.className = 'nav-promos-preview';

  const timelineContainer = document.createElement('div');
  timelineContainer.classList.add('alert-banners-timeline-container');

  const promosContainer = document.createElement('div');

  const div = document.createElement('div');
  div.classList.add('alert-banners-datetime');
  div.textContent = 'Simulate Date/Time (local)';
  const dtl = document.createElement('input');
  dtl.type = 'datetime-local';
  dtl.value = new Date().toISOString().slice(0, 16);
  dtl.id = 'nav-promos-party-time';
  div.append(dtl);

  // Track current preview promo to avoid unnecessary DOM updates
  let currentPreviewPromo = null;

  // Helper to update the preview card (skips if the promo hasn't changed)
  const setPreview = (selectedPromo) => {
    if (selectedPromo === currentPreviewPromo) return;
    currentPreviewPromo = selectedPromo;

    previewWrapper.textContent = '';

    if (selectedPromo && selectedPromo.content) {
      previewWrapper.append(buildPromoCard(selectedPromo.content.cloneNode(true)));
    } else {
      const empty = document.createElement('div');
      empty.className = 'alert-banners-preview-empty';
      empty.textContent = 'No promo selected for this date';
      previewWrapper.append(empty);
    }
  };

  // Cache list items for fast updates during drag
  let listItems = [];

  const updateListColors = (newDate, newBestPromo) => {
    listItems.forEach((item, index) => {
      const promo = promos[index];
      if (!promo) return;

      const state = currentPastFuture(promo.start, promo.end, newDate);
      item.classList.toggle('alert-banners-past', state === 'past');
      item.classList.toggle('alert-banners-current', state === 'current');
      item.classList.toggle('alert-banners-future', state === 'future');
      item.classList.toggle('alert-banners-selected', promo === newBestPromo);
    });
  };

  const onDrag = (newDate, newBestPromo) => {
    dtl.value = newDate.toISOString().slice(0, 16);
    updateListColors(newDate, newBestPromo);
  };

  // Full update function (used on initial load and when input changes)
  const updateViews = (simDate) => {
    const simBestPromo = findCurrentScheduledItem(promos, simDate);

    dtl.value = simDate.toISOString().slice(0, 16);

    setPreview(simBestPromo);

    timelineContainer.textContent = '';
    timelineContainer.append(createTimeline(promos, simBestPromo, simDate, onDrag, setPreview));

    promosContainer.textContent = '';
    promosContainer.append(createParsedPromos(promos, simBestPromo, simDate));
    listItems = [...promosContainer.querySelectorAll('li')];
  };

  updateViews(new Date());

  dtl.addEventListener('input', (e) => {
    updateViews(new Date(e.target.value));
  });

  block.append(previewWrapper);
  block.append(timelineContainer);
  block.append(promosContainer);
  block.append(div);
}

/**
 * Decorates the nav-promos block: parses schedule rows and either replaces the block with
 * just the currently-active promo's content (when fetched programmatically by the header's
 * Products mega-menu, which happens inside a detached document) or renders the full
 * author-preview UI (when viewed directly as a page).
 * @param {Element} block The nav-promos block element
 */
export default function decorate(block) {
  const promos = parseNavPromos(block);

  if (!document.contains(block)) {
    const best = findCurrentScheduledItem(promos);
    block.replaceChildren(...(best ? best.content.childNodes : []));
    return;
  }

  block.innerHTML = '';
  renderPreview(block, promos);
}
