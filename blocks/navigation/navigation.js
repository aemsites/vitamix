/**
 * Creates and displays a navigation popover for mobile view.
 * @param {HTMLElement} block - Navigation block
 * @param {HTMLUListElement} ul - Navigation list (may include nested sub-lists)
 * @param {HTMLDivElement} popover - Popover container
 */
function buildPopover(block, ul, popover) {
  const clone = ul.cloneNode(true);
  clone.querySelectorAll('li').forEach((l) => {
    l.removeAttribute('aria-current');
    l.removeAttribute('aria-expanded');
  });
  clone.querySelectorAll('a').forEach((a) => a.removeAttribute('aria-current'));
  const currentLink = ul.querySelector('a[aria-current]');
  if (currentLink) {
    const cloneLink = clone.querySelector(`a[href="${currentLink.getAttribute('href')}"]`);
    if (cloneLink) cloneLink.setAttribute('aria-current', 'location');
  }
  popover.append(clone);
  block.append(popover);
  popover.hidden = window.matchMedia('(width >= 800px)').matches;
  clone.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (link) popover.hidden = true;
  });
}

/**
 * Tracks horizontal scroll position on a list and updates data-scroll on the wrapper.
 * @param {HTMLUListElement} ul - The scrollable list element
 * @param {HTMLDivElement} wrapper - Wrapper element that receives the data-scroll attribute
 */
function attachScrollTracking(ul, wrapper) {
  ul.addEventListener('scroll', () => {
    const { scrollLeft, scrollWidth, clientWidth } = ul;
    const scrollRight = scrollWidth - clientWidth - scrollLeft;
    if (scrollLeft === 0) {
      wrapper.dataset.scroll = 'start';
    } else if (scrollRight <= 1) {
      wrapper.dataset.scroll = 'end';
    } else {
      wrapper.removeAttribute('data-scroll');
    }
  });
  ul.dispatchEvent(new Event('scroll'));
}

/**
 * Replaces a <p> label inside a popover/nav li with a <button>, transferring text content.
 * @param {HTMLLIElement} li
 * @returns {HTMLButtonElement|null}
 */
function convertLabelToButton(li) {
  const p = li.querySelector(':scope > p');
  if (!p) return null;
  const btn = document.createElement('button');
  btn.textContent = p.textContent;
  p.replaceWith(btn);
  return btn;
}

/**
 * Decorates the jump variant: highlights the most-visible on-page section via IntersectionObserver.
 * @param {HTMLElement} block - Navigation block element
 * @param {HTMLUListElement} ul - Navigation list containing anchor links to page sections
 * @param {HTMLElement} row - First row of the block, used to prepend the nav element
 */
function decorateJump(block, ul, row) {
  const wrapper = document.createElement('div');
  wrapper.className = 'list-wrapper';

  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', 'Jump navigation');

  const popover = document.createElement('div');
  popover.className = 'popover';
  popover.hidden = true;
  popover.setAttribute('role', 'region');
  popover.setAttribute('aria-label', 'Navigation menu');

  block.addEventListener('click', () => buildPopover(block, ul, popover), { once: true });

  ul.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (li) {
      const link = li.querySelector('a[href]');
      const mobile = !window.matchMedia('(width >= 800px)').matches;
      if (mobile) {
        e.preventDefault();
        const expanded = li.hasAttribute('aria-expanded');
        block.querySelectorAll('[aria-expanded]').forEach((el) => el.removeAttribute('aria-expanded'));
        popover.hidden = true;
        if (!expanded) {
          li.setAttribute('aria-expanded', true);
          popover.hidden = false;
        }
      } else {
        link.scrollIntoView({ behavior: 'smooth', inline: 'center' });
      }
    }
  });

  attachScrollTracking(ul, wrapper);

  const mediaQuery = window.matchMedia('(width >= 800px)');
  mediaQuery.addEventListener('change', (e) => {
    if (e.matches) {
      popover.hidden = true;
      block.querySelectorAll('[aria-expanded]').forEach((el) => el.removeAttribute('aria-expanded'));
      ul.dispatchEvent(new Event('scroll'));
    }
  });

  const links = ul.querySelectorAll('a[href*="#"]');
  const sectionsToObserve = [];
  links.forEach((link) => {
    const hash = link.getAttribute('href').split('#')[1];
    const section = document.getElementById(hash);
    if (section) sectionsToObserve.push(section);
  });

  if (sectionsToObserve.length > 0) {
    const sectionObserver = new IntersectionObserver(() => {
      const visibleSections = sectionsToObserve
        .map((section) => {
          const rect = section.getBoundingClientRect();
          const viewportHeight = window.innerHeight;
          const visibleHeight = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
          const visiblePixels = visibleHeight > 0 ? visibleHeight * rect.width : 0;
          return { section, visiblePixels };
        })
        .filter((item) => item.visiblePixels > 0)
        .sort((a, b) => b.visiblePixels - a.visiblePixels);

      if (visibleSections.length > 0) {
        const mostVisible = visibleSections[0];
        const link = [...links].find((l) => l.getAttribute('href').endsWith(`#${mostVisible.section.id}`));

        if (link) {
          links.forEach((l) => l.removeAttribute('aria-current'));
          link.setAttribute('aria-current', 'location');

          const popoverLinks = popover.querySelectorAll('a[href*="#"]');
          if (popoverLinks.length) {
            popoverLinks.forEach((l) => l.removeAttribute('aria-current'));
            const popoverLink = [...popoverLinks].find((l) => l.getAttribute('href') === link.getAttribute('href'));
            if (popoverLink) popoverLink.setAttribute('aria-current', 'location');
          }

          const mobile = !window.matchMedia('(width >= 800px)').matches;
          const sticky = Math.abs(block.getBoundingClientRect().top) < 1;
          if (!mobile && sticky) link.scrollIntoView({ behavior: 'smooth', inline: 'center' });
        }
      }
    }, { threshold: [0, 0.25, 0.5, 0.75, 1.0] });

    sectionsToObserve.forEach((section) => sectionObserver.observe(section));
  }

  const cell = ul.parentElement;
  const cellChildren = [...cell.children];
  wrapper.appendChild(ul);
  const firstLink = ul.querySelector('a');
  if (firstLink) firstLink.setAttribute('aria-current', 'location');
  nav.appendChild(wrapper);
  cell.remove();
  cellChildren.forEach((child) => row.append(child === ul ? nav : child));
}

/**
 * Decorates the default variant: top-level links with expandable sub-rows on desktop.
 * @param {HTMLElement} block - Navigation block element
 * @param {HTMLUListElement} ul - Navigation list; nested sub-lists become sub-row content
 * @param {HTMLElement} row - First row of the block, used to prepend the nav element
 */
function decorateDefault(block, ul, row) {
  const currentPath = window.location.pathname;

  // Clone full ul (with nested sub-lists) before modifying, for use in mobile popover
  const fullUl = ul.cloneNode(true);

  const topItems = [...ul.querySelectorAll(':scope > li')];
  const subLists = topItems.map((li) => {
    const subUl = li.querySelector(':scope > ul');
    return subUl ? subUl.cloneNode(true) : null;
  });
  ul.querySelectorAll(':scope > li > ul').forEach((subUl) => subUl.remove());

  topItems.forEach((li, i) => {
    if (subLists[i]) convertLabelToButton(li);
  });

  topItems.forEach((li, i) => {
    const link = li.querySelector('a');
    if (link && link.pathname === currentPath) {
      li.setAttribute('data-current', '');
      return;
    }
    const subUl = subLists[i];
    if (subUl) {
      const subMatch = [...subUl.querySelectorAll('a')].find((a) => a.pathname === currentPath);
      if (subMatch) {
        li.setAttribute('data-current', '');
        const btn = li.querySelector(':scope > button');
        if (btn) btn.setAttribute('data-current', 'section');
      }
    }
  });

  row.querySelectorAll('.pre-nav a').forEach((a) => {
    if (a.pathname === currentPath) a.setAttribute('aria-current', 'page');
  });

  const subRow = document.createElement('div');
  subRow.className = 'submenu';
  subRow.hidden = true;

  const popover = document.createElement('div');
  popover.className = 'popover';
  popover.hidden = true;
  popover.setAttribute('role', 'region');
  popover.setAttribute('aria-label', 'Navigation menu');

  let popoverBuilt = false;

  function closePopover() {
    popover.hidden = true;
    popover.querySelectorAll('[aria-expanded]').forEach((el) => el.removeAttribute('aria-expanded'));
    const toggle = block.querySelector('.toggle');
    if (toggle) {
      toggle.removeAttribute('aria-expanded');
      toggle.setAttribute('aria-label', 'Open navigation menu');
    }
  }

  function openPopover() {
    if (!popoverBuilt) {
      const clone = fullUl.cloneNode(true);
      clone.querySelectorAll('li').forEach((l) => {
        l.removeAttribute('aria-current');
        l.removeAttribute('aria-expanded');
      });
      clone.querySelectorAll('a').forEach((a) => {
        if (a.pathname === currentPath) a.setAttribute('aria-current', 'page');
      });
      [...clone.querySelectorAll(':scope > li')].forEach((li) => {
        if (!li.querySelector(':scope > ul')) return;
        const btn = convertLabelToButton(li);
        if (!btn) return;
        btn.addEventListener('click', () => {
          const expanded = btn.hasAttribute('aria-expanded');
          clone.querySelectorAll(':scope > li > button[aria-expanded]').forEach((el) => el.removeAttribute('aria-expanded'));
          if (!expanded) btn.setAttribute('aria-expanded', true);
        });
      });
      clone.addEventListener('click', (e) => {
        if (e.target.closest('a[href]')) closePopover();
      });
      popover.append(clone);
      block.append(popover);
      popoverBuilt = true;
    }
    popover.hidden = false;
    const toggle = block.querySelector('.toggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', true);
      toggle.setAttribute('aria-label', 'Close navigation menu');
    }
  }

  const toggle = document.createElement('button');
  toggle.className = 'button toggle';
  toggle.setAttribute('aria-label', 'Open navigation menu');
  const icon = document.createElement('i');
  icon.className = 'symbol symbol-hamburger';
  toggle.append(icon);
  toggle.addEventListener('click', () => {
    if (popover.hidden) {
      openPopover();
    } else {
      closePopover();
    }
  });

  ul.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    if (!window.matchMedia('(width >= 1000px)').matches) return;
    const index = topItems.indexOf(li);
    const subUl = subLists[index];
    if (subUl) {
      const btn = li.querySelector(':scope > button');
      const expanded = btn && btn.hasAttribute('aria-expanded');
      topItems.forEach((el) => {
        const b = el.querySelector(':scope > button');
        if (b) b.removeAttribute('aria-expanded');
      });
      subRow.hidden = true;
      if (!expanded) {
        if (btn) btn.setAttribute('aria-expanded', true);
        const subUlClone = subUl.cloneNode(true);
        subUlClone.querySelectorAll('a').forEach((a) => {
          if (a.pathname === currentPath) a.setAttribute('aria-current', 'page');
        });
        subRow.replaceChildren(subUlClone);
        subRow.hidden = false;
      }
    }
  });

  const wrapper = document.createElement('div');
  wrapper.className = 'list-wrapper';

  const mediaQuery = window.matchMedia('(width >= 1000px)');
  mediaQuery.addEventListener('change', (e) => {
    if (e.matches) {
      closePopover();
    } else {
      subRow.hidden = true;
      topItems.forEach((el) => {
        const btn = el.querySelector(':scope > button');
        if (btn) btn.removeAttribute('aria-expanded');
      });
    }
  });

  const cell = ul.parentElement;
  const cellChildren = [...cell.children];
  wrapper.appendChild(ul);
  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', 'Section navigation');
  nav.appendChild(wrapper);
  cell.remove();
  cellChildren.forEach((child) => row.append(child === ul ? nav : child));
  row.append(toggle);
  block.append(subRow);
}

/**
 * Decorates the navigation block, routing to jump or default behavior based on block variant.
 * @param {HTMLElement} block - Navigation block element
 */
export default function decorate(block) {
  const variants = [...block.classList].filter((c) => c !== 'block' && c !== 'navigation');
  const row = block.firstElementChild;
  row.classList.add('menu');
  const ul = row.querySelector('ul');

  if (ul) {
    const siblings = [...ul.parentElement.children];
    const ulIndex = siblings.indexOf(ul);
    siblings.forEach((el, i) => {
      if (el.classList.contains('button-wrapper')) {
        el.classList.add(i < ulIndex ? 'pre-nav' : 'post-nav');
      }
    });

    const navParts = [];
    if (siblings.some((el, i) => i < ulIndex && el.classList.contains('button-wrapper'))) navParts.push('pre');
    if (siblings.some((el, i) => i > ulIndex && el.classList.contains('button-wrapper'))) navParts.push('post');
    if (navParts.length) block.dataset.nav = navParts.join(',');

    if (variants.includes('jump')) {
      decorateJump(block, ul, row);
    } else {
      decorateDefault(block, ul, row);
    }
  }
}
