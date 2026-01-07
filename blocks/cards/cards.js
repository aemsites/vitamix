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
    [...li.children].forEach((child, i) => {
      if (child.children.length === 1 && child.querySelector('picture')) { // picture only
        child.className = 'card-image';
      } else if (i === 0 && !!child.querySelector('picture')) { // first child with picture
        const textContent = child.textContent.trim();
        child.className = textContent ? 'card-captioned' : 'card-image';
        stripButtonClasses(child);
      } else child.className = 'card-body';
    });
  });

  // decorate variant specifics
  let variants = [...block.classList].filter((c) => c !== 'block' && c !== 'cards');
  if (variants.length === 0) {
    variants = setCardDefaults(block, ul, variants);
  }

  const clickable = ['knockout', 'articles', 'linked', 'overlay'];
  if (variants.some((v) => clickable.includes(v))) {
    enableClick(ul);
  }

  // replace content with new list structure
  block.replaceChildren(ul);
}
