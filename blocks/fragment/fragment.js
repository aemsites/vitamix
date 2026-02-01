/*
 * Fragment Block
 * Include content on a page as a fragment.
 * https://www.aem.live/developer/block-collection/fragment
 */

// eslint-disable-next-line import/no-cycle
import { decorateMain, parseEasternDateTime } from '../../scripts/scripts.js';
import { loadSections } from '../../scripts/aem.js';

/**
 * Selects path from schedule.json based on the current date and time.
 * @param {string} path The path to the fragment
 * @returns {string} The resolved path
 */
async function pickFromSchedule(path) {
  /**
   * Parses a datetime string safely, returning null for empty/invalid values.
   * @param {string} dateStr - The datetime string to parse
   * @returns {Date|null} The parsed Date object or null if empty/malformed
   */
  const parseDateSafe = (dateStr) => {
    if (!dateStr) {
      return null;
    }
    try {
      return parseEasternDateTime(dateStr);
    } catch {
      // Fallback to simple date parsing for formats without time
      const fallbackDate = new Date(dateStr);
      // Return null if the fallback also fails (Invalid Date)
      if (Number.isNaN(fallbackDate.getTime())) {
        return null;
      }
      return fallbackDate;
    }
  };

  const resp = await fetch(path);
  const schedule = await resp.json();
  const now = window.simulateDate ? new Date(window.simulateDate) : new Date();
  let pickedItem = null;
  schedule.data.forEach((item) => {
    const startDate = parseDateSafe(item.Start);
    const endDate = parseDateSafe(item.End);
    if ((now >= startDate || !startDate) && (now <= endDate || !endDate)) {
      pickedItem = item;
    }
  });
  const { pathname } = new URL(pickedItem.Fragment, window.location);
  return pathname;
}

/**
 * Loads a fragment.
 * @param {string} path The path to the fragment
 * @returns {HTMLElement} The root element of the fragment
 */
export async function loadFragment(path) {
  if (path && path.startsWith('/')) {
    const resolvedPath = path.endsWith('.json') ? await pickFromSchedule(path) : path;
    const resp = await fetch(`${resolvedPath}.plain.html`);
    if (resp.ok) {
      const main = document.createElement('main');
      main.innerHTML = await resp.text();

      // reset base path for media to fragment base
      const resetAttributeBase = (tag, attr) => {
        main.querySelectorAll(`${tag}[${attr}^="./media_"]`).forEach((elem) => {
          elem[attr] = new URL(elem.getAttribute(attr), new URL(path, window.location)).href;
        });
      };
      resetAttributeBase('img', 'src');
      resetAttributeBase('source', 'srcset');

      decorateMain(main);
      await loadSections(main);
      return main;
    }
  }
  return null;
}

export default async function decorate(block) {
  const link = block.querySelector('a');
  const path = link ? link.getAttribute('href') : block.textContent.trim();
  const fragment = await loadFragment(path);
  if (fragment) {
    const fragmentSection = fragment.querySelector(':scope .section');
    if (fragmentSection) {
      block.closest('.section').classList.add(...fragmentSection.classList);
      block.closest('.fragment').replaceWith(...fragment.childNodes);
    }
  }
}
