import { createOptimizedPicture } from '../../scripts/aem.js';

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

export default function decorate(block) {
  // replace default div structure with ordered list
  const ul = document.createElement('ul');
  const cardsPerRow = getLargestFactor(block.children.length);
  ul.classList.add(`rows-${cardsPerRow}`);

  [...block.children].forEach((row) => {
    // move all children from row into list item
    const li = document.createElement('li');
    while (row.firstElementChild) li.append(row.firstElementChild);

    // assign classes based on content
    [...li.children].forEach((div, i) => {
      if (div.children.length === 1 && div.querySelector('picture')) { // single picture element
        div.className = 'card-image';
      } else if (!i && div.querySelector('picture')) { // first div with picture
        div.className = 'card-captioned';
        div.querySelectorAll('.button').forEach((button) => {
          button.classList.remove('button');
          button.parentElement.classList.remove('button-wrapper');
        });
      } else { // default, all other divs
        div.className = 'card-body';
      }
    });
    ul.append(li);
  });

  // replace images with optimized versions
  ul.querySelectorAll('picture > img').forEach((img) => img.closest('picture').replaceWith(
    createOptimizedPicture(img.src, img.alt, false, [{ width: '900' }]),
  ));

  // decorate variant specifics
  const clickable = ['knockout', 'articles', 'linked', 'overlay'];
  const variants = [...block.classList].filter((c) => c !== 'block' && c !== 'cards');
  if (!variants.length) {
    // default card styling
    ul.querySelectorAll('li .card-body').forEach((body) => {
      const link = body.querySelector('a[href]');
      if (link) {
        const content = body.textContent.trim();
        // link is the only content
        if (link.textContent.trim() === content) {
          link.removeAttribute('class');
          link.parentElement.classList.remove('button-wrapper');
          if (!variants.includes('linked')) variants.push('linked');
          if (!block.classList.contains('linked')) block.classList.add('linked');
        }
      }
    });
    // check for icon list
    const cards = ul.querySelectorAll('li').length;
    const icons = ul.querySelectorAll('li img[src*=".svg"]').length;
    if (cards === icons) {
      variants.push('icon-list');
      block.classList.add('icon-list');
    }
  }

  if (clickable.some((v) => variants.includes(v))) {
    ul.querySelectorAll('li').forEach((li) => {
      const as = li.querySelectorAll('a');
      // setup full card click if there's one link or all links have same href
      if (as.length === 1 || (as.length > 1 && [...as].every((a) => a.href === as[0].href))) {
        li.classList.add('card-click');
        li.addEventListener('click', () => as[0].click());
      }
    });
  }

  // replace contentwith new list structure
  block.replaceChildren(ul);
}
