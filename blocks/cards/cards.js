import { createOptimizedPicture } from '../../scripts/aem.js';

export default function decorate(block) {
  // replace default div structure with ordered list
  const ul = document.createElement('ul');
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
    createOptimizedPicture(img.src, img.alt, false, [{ width: '750' }]),
  ));

  // decorate variant specifics
  const variants = [...block.classList].filter((c) => c !== 'block' && c !== 'cards');
  if (variants.includes('knockout') || variants.includes('articles')) {
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
