import { getMetadata } from '../../scripts/aem.js';
import { swapIcons } from '../../scripts/scripts.js';
import { loadFragment } from '../fragment/fragment.js';

// media query match that indicates desktop width
const isDesktop = window.matchMedia('(width >= 1000px)');

function getCookies() {
  const cookies = document.cookie.split(';');
  const cookieMap = {};
  cookies.forEach((cookie) => {
    const [key, value] = cookie.split('=');
    cookieMap[key.trim()] = value.trim();
  });
  return cookieMap;
}

function toggleHeader(desktop, nav, hamburger) {
  const hamburgerWrapper = hamburger.closest('div');
  const controls = hamburger.getAttribute('aria-controls').split(' ');
  const toggleControls = (ids, status) => {
    ids.forEach((id) => {
      const control = nav.querySelector(`#${id}`);
      if (control) control.setAttribute('aria-hidden', status);
    });
  };

  if (desktop) {
    nav.dataset.expanded = true;
    hamburgerWrapper.setAttribute('aria-hidden', true);
    toggleControls(controls, false);
  } else {
    nav.dataset.expanded = false;
    hamburgerWrapper.setAttribute('aria-hidden', false);
    toggleControls(controls, true);
  }
}

function toggleHamburger(hamburger, nav) {
  const expanded = hamburger.getAttribute('aria-expanded') === 'true';
  hamburger.setAttribute('aria-expanded', !expanded);
  const controls = hamburger.getAttribute('aria-controls').split(' ');
  controls.forEach((id) => {
    const control = document.getElementById(id);
    if (control) {
      control.setAttribute('aria-hidden', expanded);
    }
  });
  nav.dataset.expanded = !expanded;
  if (!expanded) document.body.dataset.scroll = 'disabled';
  else document.body.removeAttribute('data-scroll');
}

function buildLanguageSelector(tool) {
  const label = tool.querySelector('p');
  const options = tool.querySelector('ul');

  const selected = [...options.children].find((option) => option.querySelector('strong'));
  const selectedIcon = selected.querySelector('.icon');
  const selectedText = [...selected.querySelectorAll('strong')].pop().textContent;

  const button = document.createElement('button');
  button.className = 'icon-wrapper';
  button.setAttribute('aria-haspopup', true);
  button.setAttribute('aria-expanded', false);
  button.setAttribute('aria-controls', 'language-menu');
  button.setAttribute('aria-label', label.textContent);
  button.append(selectedIcon.cloneNode(true), selectedText);

  options.setAttribute('role', 'menu');
  options.id = 'language-menu';
  [...options.children].forEach((option) => {
    const optionLink = option.querySelector('a');
    const optionIcon = option.querySelector('.icon');
    const optionLabels = [...option.querySelectorAll('a')].map((a) => {
      const span = document.createElement('span');
      span.textContent = a.textContent;
      return span;
    });
    const optionText = document.createElement('p');
    optionText.append(...optionLabels);
    option.innerHTML = '';
    optionLink.replaceChildren(optionIcon.cloneNode(true), optionText);
    option.append(optionLink);
  });

  label.replaceWith(button);

  button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', !expanded);
  });
}

async function fetchNavFragments(a) {
  try {
    const { pathname } = new URL(a, window.location);
    const resp = await fetch(pathname);
    const temp = document.createElement('div');
    temp.innerHTML = await resp.text();
    const sections = temp.querySelectorAll('div > ul');
    temp.remove();
    return sections;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error fetching nav fragment:', error);
  }
  return null;
}

/**
 * loads and decorates the header
 * @param {Element} block The header block element
 */
export default async function decorate(block) {
  // load nav as fragment
  const navMeta = getMetadata('nav');
  const navPath = navMeta ? new URL(navMeta, window.location).pathname : '/nav';
  const fragment = await loadFragment(navPath);

  // decorate nav DOM
  block.textContent = '';
  const nav = document.createElement('section');
  nav.id = 'nav';
  while (fragment.firstElementChild) nav.append(fragment.firstElementChild);

  const classes = ['title', 'sections', 'tools', 'cart'];
  classes.forEach((c, i) => {
    const section = nav.children[i];
    if (section) {
      section.id = `nav-${c}`;
      section.classList.add(`nav-${c}`);
    }
  });

  // decorate icons
  const icons = nav.querySelectorAll('li .icon');
  icons.forEach((i) => {
    const parent = i.parentElement;
    parent.className = 'icon-wrapper';
  });

  // decorate title
  const title = nav.querySelector('.nav-title');
  if (title) {
    const a = title.querySelector('a[href]');
    if (!a) {
      const content = title.querySelector('h1, h2, h3, h4, h5, h6, p');
      content.className = 'title-content';
      if (content && content.textContent) {
        const link = document.createElement('a');
        link.href = '/';
        link.innerHTML = content.innerHTML;
        content.innerHTML = link.outerHTML;
      }
    } else {
      a.classList.remove('button');
      a.parentElement.classList.remove('button-wrapper');
    }
  }

  // decorate sections
  const sections = nav.querySelector('.nav-sections');
  if (sections) {
    const wrapper = document.createElement('nav');
    const ul = sections.querySelector('ul');
    const clone = ul.cloneNode(true);
    wrapper.append(clone);
    [...clone.children].forEach((li, i) => {
      // clear buttons
      const as = li.querySelectorAll('a[href]');
      as.forEach((a) => {
        a.classList.remove('button');
        a.parentElement.classList.remove('button-wrapper');
      });

      const subsection = li.querySelector('ul');
      if (subsection) {
        li.className = 'subsection';
        subsection.id = `subsection-${i + 1}`;
        subsection.setAttribute('role', 'menu');

        // populate nav fragments
        const navA = li.querySelector('a[href*="/nav"]');
        if (navA) {
          const populateNavFragments = async (e) => {
            e.preventDefault();
            const navFragmentSections = await fetchNavFragments(navA);
            const menu = navA.parentElement.parentElement;
            menu.innerHTML = '';
            navFragmentSections.forEach((s) => {
              const menuItem = document.createElement('li');
              menuItem.setAttribute('role', 'menuitem');
              menuItem.append(s);
              menu.append(menuItem);
            });
          };
          li.addEventListener('mouseover', populateNavFragments, { once: true });
        }

        [...subsection.children].forEach((subli) => subli.setAttribute('role', 'menuitem'));
        const label = li.textContent.replace(subsection.textContent, '').trim();
        const button = document.createElement('button');
        button.setAttribute('aria-haspopup', true);
        button.setAttribute('aria-expanded', false);
        button.setAttribute('aria-controls', `subsection-${i + 1}`);
        button.textContent = label;
        button.addEventListener('click', () => {
          const expanded = button.getAttribute('aria-expanded') === 'true';
          if (isDesktop.matches) {
            wrapper.querySelectorAll('[aria-expanded="true"]').forEach((ex) => ex.setAttribute('aria-expanded', false));
          }
          button.setAttribute('aria-expanded', !expanded);
        });
        const chevron = document.createElement('i');
        chevron.className = 'symbol symbol-chevron';
        button.prepend(chevron);
        li.innerHTML = '';
        li.prepend(button, subsection);
      }
    });
    ul.replaceWith(wrapper);
  }

  // decorate tools
  const tools = nav.querySelector('.nav-tools');
  if (tools) {
    // const configured = ['search', 'flag', 'email', 'account'];
    tools.querySelectorAll('div > ul > li').forEach((t) => {
      const tool = t.querySelector('.icon');
      const type = [...tool.classList].filter((c) => c !== 'icon')[0].replace('icon-', '');
      if (type === 'search') {
        t.classList.add(`nav-tools-${type}`);
        // enable search slider
      } else if (type === 'email') {
        t.classList.add(`nav-tools-${type}`);
        // enable sign up modal
      } else if (type === 'account') {
        t.classList.add(`nav-tools-${type}`);
        // this is just a link
      } else if (type.includes('flag')) {
        t.classList.add('nav-tools-language');
        // enable language selector
        buildLanguageSelector(t);
      }
    });
  }

  // temp banner
  const banner = document.createElement('div');
  banner.className = 'nav-banner';
  banner.innerHTML = '<p>Free Standard Shipping on Orders $99 or More.</p>';
  nav.prepend(banner);

  // build mobile hamburger
  const hamburgerWrapper = document.createElement('div');
  hamburgerWrapper.className = 'nav-hamburger';
  const hamburgerButton = document.createElement('button');
  hamburgerButton.setAttribute('type', 'button');
  hamburgerButton.setAttribute('aria-controls', 'nav-sections nav-tools');
  hamburgerButton.setAttribute('aria-expanded', false);
  hamburgerButton.setAttribute('aria-label', 'Open navigation');
  const hamburger = document.createElement('i');
  hamburger.className = 'symbol symbol-hamburger';
  hamburgerButton.append(hamburger);
  hamburgerButton.addEventListener('click', () => toggleHamburger(hamburgerButton, nav));
  hamburgerWrapper.append(hamburgerButton);
  nav.prepend(hamburgerWrapper);

  toggleHeader(isDesktop.matches, nav, hamburgerButton);
  isDesktop.addEventListener('change', (e) => toggleHeader(e.matches, nav, hamburgerButton));

  const navWrapper = document.createElement('div');
  navWrapper.className = 'nav-wrapper';
  navWrapper.append(nav);
  block.append(navWrapper);

  swapIcons(block);

  const cookies = getCookies();
  const customer = cookies.vitamix_customer;
  const cartItems = cookies.cart_items_count;
  if (customer) {
    const account = block.querySelector('.icon-account').parentElement;
    account.lastChild.textContent = `${customer}'s Account`;
  }
  if (cartItems) {
    const cart = block.querySelector('.icon-cart').parentElement;
    cart.dataset.cartItems = cartItems;
    cart.lastChild.textContent = `Cart (${cartItems})`;
  }
}
