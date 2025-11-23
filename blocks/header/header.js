import { getMetadata, toClassName } from '../../scripts/aem.js';
import { swapIcons, getCookies } from '../../scripts/scripts.js';
import { loadFragment } from '../fragment/fragment.js';

// media query match that indicates desktop width
const isDesktop = window.matchMedia('(width >= 1000px)');

/**
 * Rewrites links to use the current hostname.
 * @param {HTMLElement} element - Element within which to rewrite links
 */
function rewriteLinks(element) {
  if (window.location.hostname.endsWith('.vitamix.com')) {
    const links = element.querySelectorAll('a[href^="https://www.vitamix.com"]');
    links.forEach((link) => {
      if (link.href.includes('vitamix.com')) {
        link.href = link.href.replace('https://www.vitamix.com', window.location.origin);
      }
    });
  }
}

/**
 * Toggles header state based on screen size.
 * @param {boolean} desktop - Whether current layout is desktop
 * @param {HTMLElement} nav - Navigation container∂
 * @param {HTMLElement} hamburger - Hamburger toggle button
 */
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

/**
 * Toggles expanded/collapsed state of hamburger menu.
 * @param {HTMLElement} hamburger - Hamburger toggle button
 * @param {HTMLElement} nav - Navigation container
 */
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

/**
 * Builds language selector block.
 * @param {HTMLElement} tool - Language selector.
 */
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
    if (!window.location.pathname.includes('/products/')) { // if not on a product page
      const targetPathSegments = new URL(optionLink.href).pathname.split('/');
      const currentPathSegments = window.location.pathname.split('/');
      const optionLinkHref = `${targetPathSegments.slice(0, 3).join('/')}/${currentPathSegments.slice(3).join('/')}`;
      optionLink.href = optionLinkHref;
    }
  });

  label.replaceWith(button);

  button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', !expanded);
  });
}

/**
 * Sanitizes navigation list.
 * @param {HTMLElement} ul - Navigation list element
 */
function sanitizeNavList(ul) {
  [...ul.children].forEach((li) => {
    // unwrap nested <as>
    li.querySelectorAll('p').forEach((p) => {
      const onlyChild = p.children.length === 1 && p.querySelector('a');
      const noOtherContent = p.childNodes.length === 1;
      if (onlyChild && noOtherContent) p.replaceWith(p.firstElementChild);
    });

    // de-button
    li.querySelectorAll('a').forEach((a) => a.removeAttribute('class'));

    const a = li.querySelector('a');
    const submenu = li.querySelector('ul');

    if (a && submenu && !li.querySelector('button.submenu-toggle')) {
      const text = a.textContent.trim();

      // generate unique id from link text
      const id = `submenu-${toClassName(text)}`;
      submenu.id = id;
      submenu.setAttribute('aria-hidden', true);

      // add toggle button
      const toggle = document.createElement('button');
      toggle.setAttribute('aria-expanded', false);
      toggle.setAttribute('aria-controls', id);
      toggle.setAttribute('aria-label', `Toggle ${text} submenu`);
      toggle.className = 'submenu-toggle';
      const chevron = document.createElement('i');
      chevron.className = 'symbol symbol-chevron';
      toggle.prepend(chevron);

      li.insertBefore(toggle, submenu);
      li.classList.add('submenu-wrapper');

      toggle.addEventListener('click', () => {
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', !expanded);
        submenu.setAttribute('aria-hidden', expanded);
      });

      // handled nested submenus
      sanitizeNavList(submenu);
    }
  });
}

/**
 * Enforces the open/closed state of the "Products" submenu.
 * @param {HTMLElement} nav - Navigation container element
 */
function enforceSubmenuState(nav) {
  const submenuProducts = nav.querySelector('#submenu-products') || nav.querySelector('#submenu-produits');
  const toggleProducts = nav.querySelector('[aria-controls="submenu-products"]') || nav.querySelector('[aria-controls="submenu-produits"]');

  if (!submenuProducts || !toggleProducts) return;

  if (isDesktop.matches) { // on desktop, collapse parent and open children
    submenuProducts.setAttribute('aria-hidden', true);
    toggleProducts.setAttribute('aria-expanded', false);

    submenuProducts.querySelectorAll('ul').forEach((ul) => {
      ul.setAttribute('aria-hidden', false);
      const li = ul.closest('li');
      const toggle = li.querySelector('.submenu-toggle');
      if (toggle) toggle.setAttribute('aria-expanded', true);
    });
  } else { // on mobile, open parent and allow children to toggle
    submenuProducts.setAttribute('aria-hidden', false);
    toggleProducts.setAttribute('aria-expanded', true);
  }
}

/**
 * Fetches navigation fragments from given link.
 * @param {string} a - Anchor href pointing to a nav fragment
 * @returns {Promise} NodeList of <ul> elements (or null on error)
 */
async function fetchNavFragments(a) {
  try {
    const { pathname } = new URL(a, window.location);
    const fragment = await loadFragment(pathname);
    const uls = fragment.querySelectorAll('div > ul');
    return [...uls];
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error fetching nav fragment:', error);
  }
  return null;
}

/**
 * Replaces <li> element with new list items fetched from navigation fragment.
 * @param {HTMLLIElement} li - Original list item element
 * @param {string} a - URL to fetch the fragment from
 */
async function populateNavFragments(li, a) {
  const ul = li.closest('ul');
  if (!ul) return;

  // remove the original <li> (to be replaced with fragment content)
  li.remove();

  const fragments = await fetchNavFragments(a);
  if (!fragments) return;

  // insert all <li> children from fetched fragment into current <ul>
  fragments.forEach((fragmentUl) => {
    [...fragmentUl.children].forEach((childLi) => {
      ul.appendChild(childLi);
    });
  });

  const header = ul.closest('header');
  const trigger = ul.closest('[data-source]');
  const button = trigger.querySelector('button');

  trigger.addEventListener('mouseenter', () => {
    if (!isDesktop.matches) return; // only on desktop
    if (button.getAttribute('aria-expanded') === 'false') button.click();
  });

  header.addEventListener('mouseleave', (e) => {
    if (!isDesktop.matches) return; // only on desktop
    const to = e.relatedTarget;
    if (to && !header.contains(to)) {
      if (button.getAttribute('aria-expanded') === 'true') button.click();
    }
  });

  rewriteLinks(ul);
  sanitizeNavList(ul);
}

/**
 * Attaches one-time listeners to load navigation fragments.
 * @param {HTMLElement} nav - Nav container
 * @param {HTMLElement} ul - List element whose link will trigger fragment loading
 * @param {HTMLElement} li - List item whose link will trigger fragment loading
 * @param {string} a - URL to fetch the fragment from
 */
function setupFragmentLoader(nav, ul, li, a) {
  const hamburgerButton = nav.querySelector('.nav-hamburger button');
  const fragment = li.closest('ul');
  fragment.style.visibility = 'hidden';
  fragment.parentElement.dataset.source = 'fragment';
  let loaded = false;

  // loads the fragment only once, triggered by either event type
  const load = async (e) => {
    if (loaded) return;
    e.preventDefault();
    ul.removeEventListener('mouseover', load);
    hamburgerButton.removeEventListener('click', load);
    loaded = true;

    await populateNavFragments(li, a);
    fragment.removeAttribute('style');
    enforceSubmenuState(nav);
  };

  ul.addEventListener('mouseover', load);
  hamburgerButton.addEventListener('click', load);
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
  if (fragment.querySelector('.icon-logo-commercial')) {
    block.closest('header').classList.add('header-commercial');
  }
  rewriteLinks(fragment);

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
  hamburgerButton.addEventListener('click', () => {
    toggleHamburger(hamburgerButton, nav);
  });

  hamburgerButton.addEventListener('click', () => {
    nav.querySelectorAll('[data-listener="mouseover"]').forEach((li) => {
      const { a } = li.dataset;
      li.removeEventListener('mouseover', populateNavFragments);
      populateNavFragments(new Event('click'), a);
    });
  }, { once: true });

  hamburgerWrapper.append(hamburgerButton);
  nav.prepend(hamburgerWrapper);

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

    sanitizeNavList(ul);

    // set up fragment loading for all "/nav" links
    ul.querySelectorAll('li a[href*="/nav"]').forEach((a) => {
      const li = a.closest('li');
      setupFragmentLoader(nav, ul, li, a);
    });

    wrapper.append(ul);
    sections.replaceChildren(wrapper);
    enforceSubmenuState(sections);

    isDesktop.addEventListener('change', () => {
      enforceSubmenuState(sections);
    });
  }

  // decorate tools
  const tools = nav.querySelector('.nav-tools');
  if (tools) {
    tools.querySelectorAll('div > ul > li').forEach((t) => {
      const tool = t.querySelector('.icon');
      const type = [...tool.classList].filter((c) => c !== 'icon')[0].replace('icon-', '');
      if (type.includes('flag')) {
        // enable language selector
        t.classList.add('nav-tools-language');
        buildLanguageSelector(t);
      } else if (type.includes('compare')) {
        t.classList.add('nav-tools-compare');
      }
    });
  }

  toggleHeader(isDesktop.matches, nav, hamburgerButton);

  // enable viewport responsive nav
  isDesktop.addEventListener('change', (e) => {
    toggleHeader(e.matches, nav, hamburgerButton);
  });

  const navWrapper = document.createElement('div');
  navWrapper.className = 'nav-wrapper';
  navWrapper.append(nav);
  block.append(navWrapper);

  swapIcons(block);

  /* cookie logic */
  const cookies = getCookies();

  const compareProducts = cookies.compare_products_count;
  if (!compareProducts || compareProducts === '0') {
    const compare = block.querySelector('li .icon-compare');
    if (compare) {
      const li = compare.closest('li');
      li.setAttribute('aria-hidden', true);
      li.replaceChildren();
    }
  }

  const customer = cookies.vitamix_customer;
  if (customer) {
    const account = block.querySelector('.icon-account').parentElement;
    account.lastChild.textContent = `${customer}'s Account`;
  }

  const cartItems = cookies.cart_items_count;
  if (cartItems && +cartItems > 0) {
    const cart = block.querySelector('.icon-cart').parentElement;
    cart.dataset.cartItems = cartItems;
    cart.lastChild.textContent = `Cart (${cartItems})`;
  }
}
