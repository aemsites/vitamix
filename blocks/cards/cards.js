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

const clockIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
const servesIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';

/**
 * Expected authoring columns in the DA table (grids variant):
 *   Col 1 – image
 *   Col 2 – grid data as paragraphs (order-independent, detected by content):
 *     - Grid item title (heading element, or first paragraph)
 *     - Difficulty keyword: Simple | Intermediate | Advanced (standalone word)
 *     - Time: starts with ~ or contains "min"/"hr"/"hour"
 *     - Serves (optional): contains "serves" or "servings"
 *     - CTA link (optional): anchor element
 */
function decorateGrids(ul) {
  ul.querySelectorAll('li').forEach((li) => {
    const body = li.querySelector('.card-body');
    if (!body) return;

    const paragraphs = [...body.querySelectorAll('p, h1, h2, h3, h4')];
    if (!paragraphs.length) return;

    const difficulties = ['simple', 'intermediate', 'advanced'];

    let title = '';
    let difficulty = 'intermediate';
    let timeText = '';
    let servesText = '';
    let ctaHref = '';

    paragraphs.forEach((p) => {
      const text = p.textContent.trim();
      const lowerText = text.toLowerCase();
      const isHeading = /^h[1-4]$/i.test(p.tagName);

      // Headings are always the title
      if (isHeading) {
        title = text;
        return;
      }

      // CTA link
      const a = p.querySelector('a[href]');
      if (a) { ctaHref = a.href; return; }

      // Difficulty keyword
      if (difficulties.includes(lowerText)) {
        difficulty = lowerText;
        return;
      }

      // Serves: contains "serves" or "servings"
      if (/serves|servings/i.test(text)) {
        servesText = text;
        return;
      }

      // Time: starts with ~ or contains min/hr/hour/minute
      if (/^~|min|hr\b|hour|minute/i.test(text)) {
        timeText = text;
        return;
      }

      // First unmatched paragraph becomes the title if no heading found yet
      if (!title) title = text;
    });

    // Build the badge
    const badge = document.createElement('span');
    badge.className = 'grids-badge';
    badge.dataset.difficulty = difficulty;
    badge.textContent = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);

    const image = li.querySelector('.card-image');
    if (image) image.append(badge);

    const timeItem = timeText
      ? `<span class="grids-meta-item">${clockIcon} <span>${timeText}</span></span>`
      : '';
    const servesItem = servesText
      ? `<span class="grids-meta-item">${servesIcon} <span>${servesText}</span></span>`
      : '';
    const ctaItem = ctaHref
      ? `<a class="grids-cta" href="${ctaHref}">View →</a>`
      : '';

    const metaRow = (timeItem || servesItem || ctaItem)
      ? `<div class="grids-meta">
           <div class="grids-meta-left">${timeItem}${servesItem}</div>
           ${ctaItem}
         </div>`
      : '';

    body.innerHTML = `
      <h2>${title}</h2>
      ${metaRow}
    `;
  });
}

/*
 * Decorates the gift variant cards.
 * Expected authoring columns in the DA table (gift variant):
 *   Col 1 – image
 *   Col 2 – content paragraphs (order-independent, detected by content):
 *     - Badge text (optional): any paragraph starting with "badge:" e.g. "badge: Most Popular"
 *     - Eyebrow (optional): any paragraph starting with "eyebrow:" e.g. "eyebrow: Ascent X5"
 *     - Title: heading element, or first unmatched paragraph
 *     - Description: second unmatched paragraph
 *     - CTA link: any paragraph containing an <a href>
 */

function decorateGift(ul) {
  ul.querySelectorAll('li').forEach((li) => {
    const body = li.querySelector('.card-body');
    if (!body) return;

    const paragraphs = [...body.querySelectorAll('p, h1, h2, h3, h4')];
    if (!paragraphs.length) return;

    let badgeText = '';
    let eyebrowText = '';
    let title = '';
    let description = '';
    let ctaHref = '';
    let ctaLabel = 'Shop Now';

    paragraphs.forEach((p) => {
      const text = p.textContent.trim();
      const lower = text.toLowerCase();
      const isHeading = /^h[1-4]$/i.test(p.tagName);

      // Badge prefix: "badge: Most Popular"
      if (lower.startsWith('badge:')) {
        badgeText = text.slice(text.indexOf(':') + 1).trim();
        return;
      }

      // Eyebrow prefix: "eyebrow: Ascent X5 with Stainless Steel"
      if (lower.startsWith('eyebrow:')) {
        eyebrowText = text.slice(text.indexOf(':') + 1).trim();
        return;
      }

      // CTA link
      const a = p.querySelector('a[href]');
      if (a) {
        ctaHref = a.href;
        ctaLabel = a.textContent.trim() || ctaLabel;
        return;
      }

      // Headings are always the title
      if (isHeading) {
        title = text;
        return;
      }

      // First unmatched paragraph = title, second = description
      if (!title) { title = text; return; }
      if (!description) { description = text; }
    });

    // Badge on image
    if (badgeText) {
      const badge = document.createElement('span');
      badge.className = 'gift-badge';
      badge.textContent = badgeText;
      const image = li.querySelector('.card-image');
      if (image) image.append(badge);
    }

    const eyebrowHTML = eyebrowText
      ? `<p class="gift-eyebrow">${eyebrowText}</p>`
      : '';
    const descriptionHTML = description
      ? `<p class="gift-description">${description}</p>`
      : '';
    const ctaHTML = ctaHref
      ? `<a class="gift-cta" href="${ctaHref}">${ctaLabel}</a>`
      : '';

    body.innerHTML = `
      ${eyebrowHTML}
      <h2>${title}</h2>
      ${descriptionHTML}
      ${ctaHTML}
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

  const clickable = ['knockout', 'articles', 'linked', 'overlay', 'grids', 'gift'];
  if (variants.some((v) => clickable.includes(v))) {
    enableClick(ul);
  }

  if (variants.includes('grids')) {
    decorateGrids(ul);
  }

  if (variants.includes('gift')) {
    decorateGift(ul);
  }

  // replace content with new list structure
  block.replaceChildren(ul);
}
