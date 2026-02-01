/**
 * Creates and displays a navigation popover for mobile view.
 * @param {HTMLElement} block - Navigation block
 * @param {HTMLUListElement} ul - Navigation list
 * @param {HTMLDivElement} popover - Popover container
 */
function buildPopover(block, ul, popover) {
  const clone = ul.cloneNode(true);
  clone.querySelectorAll('li').forEach((l) => l.removeAttribute('aria-current'));
  popover.append(clone);
  block.append(popover);
  popover.hidden = window.matchMedia('(width >= 800px)').matches;
  clone.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (link) popover.hidden = true;
  });
}

export default function decorate(block) {
  const variants = [...block.classList].filter((c) => c !== 'block' && c !== 'navigation');
  const row = block.firstElementChild;
  const ul = row.querySelector('ul');

  if (ul) {
    const wrapper = document.createElement('div');
    wrapper.className = 'navigation-list-wrapper';

    const nav = document.createElement('nav');
    if (variants.includes('jump')) nav.setAttribute('aria-label', 'Jump navigation');

    const popover = document.createElement('div');
    popover.className = 'navigation-popover';
    popover.hidden = true;
    popover.setAttribute('role', 'region');
    popover.setAttribute('aria-label', 'Navigation menu');

    block.addEventListener('click', () => buildPopover(block, ul, popover), { once: true });

    ul.addEventListener('click', (e) => {
      const li = e.target.closest('li');
      if (li) {
        const link = li.querySelector('a[href]');
        const mobile = !window.matchMedia('(width >= 800px)').matches;
        if (mobile) { // enable mobile popover
          e.preventDefault();
          const expanded = li.hasAttribute('aria-expanded');
          block.querySelectorAll('[aria-expanded]').forEach((el) => el.removeAttribute('aria-expanded'));
          popover.hidden = true;
          if (!expanded) {
            li.setAttribute('aria-expanded', true);
            popover.hidden = false;
          }
        } else { // desktop scroll into view
          link.scrollIntoView({ behavior: 'smooth', inline: 'center' });
        }
      }
    });

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

    // set scroll state
    ul.dispatchEvent(new Event('scroll'));

    // handle switch from mobile to desktop
    const mediaQuery = window.matchMedia('(width >= 800px)');
    const handleResize = (e) => {
      if (e.matches) {
        popover.hidden = true;
        block.querySelectorAll('[aria-expanded]').forEach((el) => el.removeAttribute('aria-expanded'));
        ul.dispatchEvent(new Event('scroll'));
      }
    };
    mediaQuery.addEventListener('change', handleResize);

    const sectionsToObserve = [];

    const links = ul.querySelectorAll('a[href*="#"]');
    links.forEach((link) => {
      const hash = link.getAttribute('href').split('#')[1];
      const section = document.getElementById(hash);
      if (section) sectionsToObserve.push(section);
    });

    // observe all sections
    if (sectionsToObserve.length > 0) {
      const sectionObserver = new IntersectionObserver(() => {
        // check ALL sections every time (not just entries that changed)
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
            links.forEach((l) => l.closest('li').removeAttribute('aria-current'));
            link.closest('li').setAttribute('aria-current', true);

            // scroll nav into view if sticky on desktop
            const mobile = !window.matchMedia('(width >= 800px)').matches;
            const sticky = Math.abs(block.getBoundingClientRect().top) < 1;
            if (!mobile && sticky) link.scrollIntoView({ behavior: 'smooth', inline: 'center' });
          }
        }
      }, { threshold: [0, 0.25, 0.5, 0.75, 1.0] });

      sectionsToObserve.forEach((section) => sectionObserver.observe(section));
    }

    wrapper.appendChild(ul);
    const firstLi = ul.querySelector('li');
    if (firstLi) firstLi.setAttribute('aria-current', true);
    nav.appendChild(wrapper);
    row.prepend(nav);
  }
}
