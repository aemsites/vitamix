import { createOptimizedPicture } from '../../scripts/aem.js';
import { buildVideo } from '../../scripts/scripts.js';

/**
 * Returns the largest factor of given n among between 1 and 4.
 * @param {number} n - Number to find largest factor for
 * @returns {number} Largest factor
 */
function getLargestFactor(n) {
  // try to find a factor of 4, 3, or 2
  const factor = [4, 3, 2].find((f) => n % f === 0);
  if (factor) return factor;
  // otherwise, set default factor
  if (n > 4) return n % 2 === 0 ? 4 : 3;
  return 1;
}

function stripButtonClasses(container) {
  container.querySelectorAll('.button').forEach((button) => {
    button.classList.remove('button');
    button.parentElement.classList.remove('button-wrapper');
  });
}

function enableClick(container) {
  container.querySelectorAll('li').forEach((card) => {
    const links = card.querySelectorAll('a[href]');
    if (!links.length) return;

    const sameLink = links.length === 1 || [...links].every((a) => a.href === links[0].href);
    if (sameLink) {
      card.classList.add('card-click');
      card.addEventListener('click', () => links[0].click());
    }
  });
}

function setCardDefaults(block, ul, variants) {
  // default card styling + "linked"
  ul.querySelectorAll('li').forEach((li) => {
    const image = li.querySelector('.card-image');
    const body = li.querySelector('.card-body');
    const captioned = li.querySelector('.card-captioned');

    if (body && !captioned && !image) {
      li.classList.add('filled');
    } else if (captioned && !body && !image) {
      li.classList.add('captioned');
    }

    if (body) {
      const link = body.querySelector('a[href]');
      if (link) {
        const content = body.textContent.trim();

        // link is the only content
        if (content === link.textContent.trim()) {
          stripButtonClasses(body);

          if (!variants.includes('linked')) variants.push('linked');
          block.classList.add('linked');
        }
      }
    }
  });

  // icon-list detection
  const cards = ul.querySelectorAll('li').length;
  const icons = ul.querySelectorAll('li img[src*=".svg"]').length;
  if (cards && cards === icons) {
    if (!variants.includes('icon-list')) variants.push('icon-list');
    block.classList.add('icon-list');
  }

  return variants;
}

/**
 * Renders star icons (filled, half, empty) for a given rating out of 5.
 * @param {number} rating - Numeric rating value (e.g. 4.7)
 * @returns {string} HTML string of star SVG icons
 */
function renderStars(rating) {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    if (rating >= i) {
      // full star
      stars.push('<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>');
    } else if (rating >= i - 0.5) {
      // half star
      stars.push('<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="half"><stop offset="50%" stop-color="currentColor"/><stop offset="50%" stop-color="transparent"/></linearGradient></defs><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="url(#half)" stroke="currentColor" stroke-width="1"/></svg>');
    } else {
      // empty star
      stars.push('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>');
    }
  }
  return stars.join('');
}

const clockIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
const servesIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';

/**
 * Reads structured recipe data from card-body and re-renders it with
 * the Vitamix recipe card UI (badge, stars, meta row, optional CTA).
 *
 * Expected authoring columns in the DA table (recipes variant):
 *   Col 1 – image
 *   Col 2 – recipe data as paragraphs in this order:
 *     1. Recipe title (heading or bold paragraph)
 *     2. Difficulty level keyword: Simple | Intermediate | Advanced
 *     3. Rating: "4.7 · 98 reviews" (or just "4.7")
 *     4. Time:  "~12 min" or "~1 hr"
 *     5. Serves (optional): "Serves 2"
 *     6. CTA link (optional): anchor element
 *
 * @param {HTMLUListElement} ul - The decorated card list element
 */
function decorateRecipes(ul) {
  ul.querySelectorAll('li').forEach((li) => {
    const body = li.querySelector('.card-body');
    if (!body) return;

    const paragraphs = [...body.querySelectorAll('p, h1, h2, h3, h4')];
    if (!paragraphs.length) return;

    // Extract each data field from authored paragraphs by position
    const titleEl = paragraphs[0];
    const title = titleEl ? titleEl.textContent.trim() : '';

    const difficultyEl = paragraphs[1];
    const difficulty = difficultyEl ? difficultyEl.textContent.trim().toLowerCase() : 'intermediate';

    const ratingEl = paragraphs[2];
    const ratingText = ratingEl ? ratingEl.textContent.trim() : '';
    const ratingMatch = ratingText.match(/([\d.]+)\s*[·•]\s*(\d+)\s*reviews?/i);
    const score = ratingMatch ? parseFloat(ratingMatch[1]) : null;
    const reviewCount = ratingMatch ? ratingMatch[2] : null;

    const timeEl = paragraphs[3];
    const timeText = timeEl ? timeEl.textContent.trim() : '';

    const servesEl = paragraphs[4];
    const servesText = servesEl ? servesEl.textContent.trim() : '';

    // CTA – look for a link in any remaining paragraph
    let ctaHref = '';
    let ctaLabel = 'View Recipe';
    for (let i = 5; i < paragraphs.length; i++) {
      const a = paragraphs[i].querySelector('a[href]');
      if (a) { ctaHref = a.href; ctaLabel = a.textContent.trim() || ctaLabel; break; }
    }

    // Build the badge
    const badge = document.createElement('span');
    badge.className = 'recipe-badge';
    badge.dataset.difficulty = difficulty;
    badge.textContent = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);

    // Inject badge into card-image
    const image = li.querySelector('.card-image');
    if (image) image.append(badge);

    // Build rating HTML
    const ratingHTML = score !== null
      ? `<p class="recipe-rating">
          <span class="recipe-stars" aria-label="${score} out of 5 stars">${renderStars(score)}</span>
          <span class="recipe-score">${score}</span>
          <span>· ${reviewCount} reviews</span>
         </p>`
      : '';

    // Build meta row
    const timeItem = timeText
      ? `<span class="recipe-meta-item">${clockIcon} <span>${timeText}</span></span>`
      : '';
    const servesItem = servesText
      ? `<span class="recipe-meta-item">${servesIcon} <span>${servesText}</span></span>`
      : '';
    const ctaItem = ctaHref
      ? `<a class="recipe-cta" href="${ctaHref}">View Recipe →</a>`
      : '';

    const metaRow = (timeItem || servesItem || ctaItem)
      ? `<div class="recipe-meta">
           <div class="recipe-meta-left">${timeItem}${servesItem}</div>
           ${ctaItem}
         </div>`
      : '';

    // Replace card body content
    body.innerHTML = `
      <h2>${title}</h2>
      ${ratingHTML}
      ${metaRow}
    `;
  });
}

export default function decorate(block) {
  // replace default div structure with ordered list
  const ul = document.createElement('ul');
  const definedRows = [...block.classList].find((c) => c.startsWith('rows-'));
  if (!definedRows) {
    const cardsPerRow = getLargestFactor(block.children.length);
    ul.classList.add(`rows-${cardsPerRow}`);
  } else {
    const rows = definedRows.split('-')[1];
    ul.classList.add(`rows-${rows}`);
    block.classList.remove(definedRows);
  }

  // build list structure
  [...block.children].forEach((row) => {
    // move all children from row into list item
    const li = document.createElement('li');
    while (row.firstElementChild) li.append(row.firstElementChild);

    // replace images with optimized versions
    li.querySelectorAll('picture > img').forEach((img) => img.closest('picture').replaceWith(
      createOptimizedPicture(img.src, img.alt, false, [{ width: '900' }]),
    ));
    ul.append(li);
    buildVideo(li);

    // assign classes based on content
    [...li.children].forEach((child) => {
      const picture = child.querySelector('picture');
      const video = child.querySelector('video');
      const hasMedia = picture || video;

      if (hasMedia) {
        const textContent = child.textContent.trim();
        if (textContent) {
          child.className = 'card-captioned';
          stripButtonClasses(child);
        } else {
          child.className = 'card-image';
        }
        if (video) child.classList.add('vid-wrapper');
      } else {
        child.className = 'card-body';
      }
    });
  });

  // decorate variant specifics
  let variants = [...block.classList].filter((c) => c !== 'block' && c !== 'cards');
  if (variants.length === 0) {
    variants = setCardDefaults(block, ul, variants);
  }

  const clickable = ['knockout', 'articles', 'linked', 'overlay', 'recipes'];
  if (variants.some((v) => clickable.includes(v))) {
    enableClick(ul);
  }

  if (variants.includes('recipes')) {
    decorateRecipes(ul);
  }

  // replace content with new list structure
  block.replaceChildren(ul);
}
