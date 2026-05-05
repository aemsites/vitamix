import { fetchPlaceholders } from '../../scripts/aem.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';

/**
 * Creates a CSS chevron icon element.
 * @returns {HTMLElement}
 */
function createChevron() {
  const chevron = document.createElement('i');
  chevron.className = 'symbol symbol-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  return chevron;
}

/**
 * Creates a radio input wrapped in a label.
 * @param {string} name - Input name attribute
 * @param {string} value - Input value attribute
 * @param {string} text - Label text
 * @param {boolean} checked - Whether the input is checked by default
 * @returns {HTMLLabelElement}
 */
function createRadioLabel(name, value, text, checked) {
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = name;
  input.value = value;
  if (checked) input.checked = true;
  const span = document.createElement('span');
  span.textContent = text;
  label.append(input, span);
  return label;
}

/**
 * Wires the mobile toolbar panel toggle, Escape key close, and breakpoint reset.
 * @param {HTMLElement} toolbar - The toolbar element
 * @param {HTMLElement} block - The block root (owns data-panel-open)
 */
function wireToolbarPanel(toolbar, block) {
  const toolbarHeader = toolbar.querySelector('.toolbar-header');
  const toolbarToggle = toolbar.querySelector('.toolbar-toggle');

  if (toolbarHeader) {
    toolbarHeader.addEventListener('click', () => {
      const expanded = toolbarToggle.getAttribute('aria-expanded') === 'true';
      toolbarToggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      if (expanded) {
        block.removeAttribute('data-panel-open');
      } else {
        block.setAttribute('data-panel-open', '');
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && block.hasAttribute('data-panel-open')) {
      block.removeAttribute('data-panel-open');
      toolbarToggle.setAttribute('aria-expanded', 'false');
      toolbarToggle.focus();
    }
  });

  window.matchMedia('(min-width: 800px)').addEventListener('change', (e) => {
    if (e.matches) {
      block.removeAttribute('data-panel-open');
      toolbarToggle.setAttribute('aria-expanded', 'false');
    }
  });
}

/**
 * Wires the desktop sort dropdown open/close and outside-click dismiss.
 * @param {HTMLElement} toolbar - The toolbar element
 */
function wireSortDropdown(toolbar) {
  const sortGroup = toolbar.querySelector('[data-group="sort"]');
  const sortTrigger = toolbar.querySelector('.sort-trigger');

  if (!sortTrigger) return;

  function close() {
    sortGroup.removeAttribute('data-sort-open');
    sortTrigger.setAttribute('aria-expanded', 'false');
  }

  sortTrigger.addEventListener('click', () => {
    const open = sortGroup.hasAttribute('data-sort-open');
    if (open) {
      close();
    } else {
      sortGroup.setAttribute('data-sort-open', '');
      sortTrigger.setAttribute('aria-expanded', 'true');
      const firstOption = sortGroup.querySelector('.sort-options input[type="radio"]');
      if (firstOption) firstOption.focus();
    }
  });

  document.addEventListener('click', (e) => {
    if (!sortGroup.contains(e.target)) close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sortGroup.hasAttribute('data-sort-open')) {
      close();
      sortTrigger.focus();
    }
  });
}

/**
 * Builds the filter/sort toolbar and prepends it to the block.
 * @param {HTMLElement} block - The block root element
 * @param {Object} placeholders - Localized string map
 */
function buildToolbar(block, placeholders) {
  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';

  const filterAndSort = placeholders.filterAndSort || 'Filter & Sort';

  const header = document.createElement('div');
  header.className = 'toolbar-header';
  const headerLabel = document.createElement('p');
  headerLabel.textContent = filterAndSort;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'toolbar-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'grantees-toolbar-panel');
  toggle.setAttribute('aria-label', filterAndSort);
  toggle.appendChild(createChevron());
  header.append(headerLabel, toggle);

  const panel = document.createElement('div');
  panel.id = 'grantees-toolbar-panel';
  panel.className = 'toolbar-panel';

  const filterGroup = document.createElement('div');
  filterGroup.className = 'toolbar-group';
  filterGroup.dataset.group = 'filter';
  filterGroup.setAttribute('role', 'radiogroup');
  filterGroup.setAttribute('aria-labelledby', 'grantees-filter-label');
  const filterLabel = document.createElement('p');
  filterLabel.className = 'group-label';
  filterLabel.id = 'grantees-filter-label';
  filterLabel.textContent = placeholders.filterBy || 'Filter By:';
  filterGroup.append(
    filterLabel,
    createRadioLabel('grantee-filter', 'current', placeholders.current || 'Current', true),
    createRadioLabel('grantee-filter', 'past', placeholders.past || 'Past', false),
  );

  const sortGroup = document.createElement('div');
  sortGroup.className = 'toolbar-group';
  sortGroup.dataset.group = 'sort';
  sortGroup.setAttribute('role', 'radiogroup');
  sortGroup.setAttribute('aria-labelledby', 'grantees-sort-label');
  const sortLabel = document.createElement('p');
  sortLabel.className = 'group-label';
  sortLabel.id = 'grantees-sort-label';
  sortLabel.textContent = placeholders.sortBy || 'Sort By';
  const sortTrigger = document.createElement('button');
  sortTrigger.type = 'button';
  sortTrigger.className = 'sort-trigger';
  sortTrigger.setAttribute('aria-expanded', 'false');
  sortTrigger.setAttribute('aria-haspopup', 'listbox');
  const sortOptions = document.createElement('div');
  sortOptions.className = 'sort-options';
  sortOptions.append(
    createRadioLabel('grantee-sort', 'newest', placeholders.mostRecent || 'Most Recent', true),
    createRadioLabel('grantee-sort', 'oldest', placeholders.oldest || 'Oldest', false),
    createRadioLabel('grantee-sort', 'name-asc', placeholders.nameAZ || 'Name A-Z', false),
    createRadioLabel('grantee-sort', 'name-desc', placeholders.nameZA || 'Name Z-A', false),
  );
  const checkedSort = sortOptions.querySelector('input:checked');
  if (checkedSort) sortTrigger.textContent = checkedSort.nextElementSibling.textContent;
  sortGroup.append(sortLabel, sortTrigger, sortOptions);

  panel.append(filterGroup, sortGroup);
  toolbar.append(header, panel);

  wireToolbarPanel(toolbar, block);
  wireSortDropdown(toolbar);

  block.prepend(toolbar);
}

/**
 * Appends a "Back to Top" button that scrolls to the top of the page.
 * @param {HTMLElement} block
 * @param {Object} placeholders - Localized string map
 */
function buildBackToTop(block, placeholders) {
  const backToTop = document.createElement('button');
  backToTop.type = 'button';
  backToTop.className = 'back-to-top eyebrow';
  backToTop.textContent = placeholders.backToTop || 'Back to Top';
  const icon = document.createElement('span');
  icon.appendChild(createChevron());
  backToTop.append(icon);
  backToTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  block.appendChild(backToTop);
}

/**
 * Parses award date, duration, and name from a grantee li; sets data-sort-date,
 * data-sort-name, and data-status attributes.
 * @param {HTMLElement} li
 * @param {Object} placeholders - Localized string map
 */
function parseGranteeData(li, placeholders) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const dateAwardedLabel = placeholders.dateAwarded || 'Date Awarded';
  const durationLabel = placeholders.duration || 'Duration';
  let awardDate = null;
  let durationYears = null;

  [...li.querySelectorAll('.grantee-meta dt')].forEach((dt) => {
    const dd = dt.nextElementSibling;
    if (!dd) return;
    const label = dt.textContent.trim();
    const value = dd.textContent.trim();

    if (label === dateAwardedLabel) {
      const [monthName, year] = value.split(' ');
      const m = months.indexOf(monthName);
      if (m !== -1 && year) {
        const y = parseInt(year, 10);
        awardDate = new Date(y, m, 1);
        li.dataset.sortDate = String(y * 100 + (m + 1));
      }
    } else if (label === durationLabel) {
      const match = value.match(/^(\d+)/);
      if (match) durationYears = parseInt(match[1], 10);
    }
  });

  if (awardDate && durationYears !== null) {
    const endDate = new Date(awardDate.getFullYear() + durationYears, awardDate.getMonth(), 1);
    li.dataset.status = endDate > new Date() ? 'current' : 'past';
  } else {
    li.dataset.status = 'current';
  }

  const h3 = li.querySelector('.grantee-content h3');
  if (h3) li.dataset.sortName = h3.textContent.trim();
}

/**
 * Filters and sorts the grantee list based on current toolbar selections.
 * @param {HTMLElement} block
 */
function applyFilterSort(block) {
  const ul = block.querySelector('ul');
  const filterInput = block.querySelector('input[name="grantee-filter"]:checked');
  const sortInput = block.querySelector('input[name="grantee-sort"]:checked');
  const filterVal = filterInput ? filterInput.value : 'current';
  const sortVal = sortInput ? sortInput.value : 'newest';

  const items = [...ul.querySelectorAll('li')];

  items.sort((a, b) => {
    if (sortVal === 'newest') return (Number(b.dataset.sortDate) || 0) - (Number(a.dataset.sortDate) || 0);
    if (sortVal === 'oldest') return (Number(a.dataset.sortDate) || 0) - (Number(b.dataset.sortDate) || 0);
    if (sortVal === 'name-asc') return (a.dataset.sortName || '').localeCompare(b.dataset.sortName || '');
    if (sortVal === 'name-desc') return (b.dataset.sortName || '').localeCompare(a.dataset.sortName || '');
    return 0;
  });

  items.forEach((li) => {
    li.hidden = li.dataset.status !== filterVal;
    ul.append(li);
  });
}

/** @param {Element} block */
export default async function decorate(block) {
  const { locale, language } = getLocaleAndLanguage();
  const placeholders = await fetchPlaceholders(`/${locale}/${language}`);

  const rows = [...block.querySelectorAll(':scope > div')];
  buildToolbar(block, placeholders);

  const list = document.createElement('ul');
  list.setAttribute('aria-label', placeholders.grantees || 'Grantees');
  rows.forEach((row) => {
    const li = document.createElement('li');
    const sections = ['logo', 'content', 'meta'];
    [...row.children].forEach((child, i) => {
      const section = sections[i];
      child.className = `grantee-${section}`;

      if (section === 'meta') {
        const ps = [...child.querySelectorAll('p')];
        const dl = document.createElement('dl');
        for (let j = 0; j < ps.length - 1; j += 2) {
          const dt = document.createElement('dt');
          dt.className = 'eyebrow';
          dt.textContent = ps[j].textContent;
          const dd = document.createElement('dd');
          dd.className = 'eyebrow';
          dd.textContent = ps[j + 1].textContent;
          dl.append(dt, dd);
        }
        child.replaceChildren(dl);
      }
      li.append(child);
    });
    list.append(li);
    row.remove();
  });
  block.append(list);

  [...list.querySelectorAll('li')].forEach((li) => parseGranteeData(li, placeholders));

  block.querySelectorAll('input[name="grantee-filter"]').forEach((input) => {
    input.addEventListener('change', () => applyFilterSort(block));
  });

  const sortTrigger = block.querySelector('.sort-trigger');
  const sortGroup = block.querySelector('[data-group="sort"]');
  block.querySelectorAll('input[name="grantee-sort"]').forEach((input) => {
    input.addEventListener('change', () => {
      const span = input.nextElementSibling;
      if (sortTrigger && span) sortTrigger.textContent = span.textContent;
      if (sortGroup) sortGroup.removeAttribute('data-sort-open');
      if (sortTrigger) sortTrigger.setAttribute('aria-expanded', 'false');
      applyFilterSort(block);
    });
  });

  applyFilterSort(block);

  buildBackToTop(block, placeholders);
}
