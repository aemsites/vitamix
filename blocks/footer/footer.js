import { getMetadata } from '../../scripts/aem.js';
import { swapIcons } from '../../scripts/scripts.js';
import { loadFragment } from '../fragment/fragment.js';

/**
 * loads and decorates the footer
 * @param {Element} block The footer block element
 */
export default async function decorate(block) {
  let footer = block.querySelector('#footer');
  const innerNav = block.querySelector('nav');
  const hasExistingContent = block.children.length > 0 && (block.querySelector('ul') || block.querySelector('a'));

  if (!footer && innerNav && innerNav.children.length >= 4) {
    // aem-embed: block > row > cell > nav (with sections) – use that nav
    footer = document.createElement('section');
    footer.id = 'footer';
    while (innerNav.firstElementChild) footer.append(innerNav.firstElementChild);
    innerNav.replaceWith(footer);
  } else if (!footer && hasExistingContent) {
    // content already in DOM (e.g. from aem-embed)
    footer = document.createElement('section');
    footer.id = 'footer';
    while (block.firstElementChild) footer.append(block.firstElementChild);
  }

  if (!footer) {
    // load footer as fragment
    const footerMeta = getMetadata('footer');
    const footerPath = footerMeta ? new URL(footerMeta, window.location).pathname : '/footer';
    const fragment = await loadFragment(footerPath);

    block.textContent = '';
    footer = document.createElement('section');
    footer.id = 'footer';
    while (fragment.firstElementChild) footer.append(fragment.firstElementChild);
  }

  const classes = ['ribbon', 'form', 'social', 'links', 'copyright'];
  const children = footer.children.length;
  // legacy footer
  if (children < 5) classes.splice(0, 1); // remove ribbon
  else footer.classList.add('ribbon');
  classes.forEach((c, i) => {
    const section = footer.children[i];
    if (section) {
      section.id = `footer-${c}`;
      section.classList.add(`footer-${c}`);
    }
  });

  // decorate ribbon
  const ribbon = footer.querySelector('.footer-ribbon');
  if (ribbon) {
    ribbon.querySelectorAll('ul > li').forEach((li) => {
      const icon = li.querySelector('.icon');
      if (icon) {
        const content = document.createElement('div');
        [...li.childNodes].forEach((node) => {
          if (node !== icon) content.append(node);
        });
        li.append(content);
      }
    });
  }

  // decorate social section
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

  if (!block.contains(footer)) {
    block.append(footer);
  }
  swapIcons(block);

  const cookieDeclaration = block.querySelector('a[href$="cookie-declaration"]');
  if (cookieDeclaration) {
    cookieDeclaration.addEventListener('click', (e) => {
      e.preventDefault();
      window.Cookiebot.forceDialog = true;
      window.Cookiebot.renew();
    });
  }
}
