import { getMetadata } from '../../scripts/aem.js';
import { swapIcons } from '../../scripts/scripts.js';
import { loadFragment } from '../fragment/fragment.js';

/**
 * loads and decorates the footer
 * @param {Element} block The footer block element
 */
export default async function decorate(block) {
  // load footer as fragment
  const footerMeta = getMetadata('footer');
  const footerPath = footerMeta ? new URL(footerMeta, window.location).pathname : '/footer';
  const fragment = await loadFragment(footerPath);

  // decorate footer DOM
  block.textContent = '';
  const footer = document.createElement('section');
  footer.id = 'footer';
  while (fragment.firstElementChild) footer.append(fragment.firstElementChild);

  const classes = ['form', 'social', 'links', 'copyright'];
  classes.forEach((c, i) => {
    const section = footer.children[i];
    if (section) {
      section.id = `footer-${c}`;
      section.classList.add(`footer-${c}`);
    }
  });

  // decorate social
  const social = footer.querySelector('.footer-social');
  if (social) {
    social.querySelectorAll('a[href]').forEach((a) => {
      const list = a.closest('li');
      if (list) {
        a.classList.add('button');
        list.classList.add('button-wrapper');
      } else {
        a.removeAttribute('class');
        a.parentElement.removeAttribute('class');
      }
    });
  }

  // decorate links
  const links = footer.querySelector('.footer-links');
  if (links) {
    links.querySelectorAll('ul > li ul').forEach((ul) => {
      const nested = ul.closest('li');
      if (nested) {
        nested.classList.add('subsection');
      }
    });
    links.querySelectorAll('a[href]').forEach((a) => {
      a.removeAttribute('class');
      a.parentElement.removeAttribute('class');
    });
  }

  block.append(footer);
  swapIcons(block);
}
