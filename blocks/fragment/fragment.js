/*
 * Fragment Block
 * Include content on a page as a fragment.
 * https://www.aem.live/developer/block-collection/fragment
 */

// eslint-disable-next-line import/no-cycle
import { decorateMain } from '../../scripts/scripts.js';
import { loadSections } from '../../scripts/aem.js';

/**
 * Selects path from schedule.json based on the current date and time.
 * @param {string} path The path to the fragment
 * @returns {string} The resolved path
 */
async function pickFromSchedule(path) {
  const parseDateWithTime = (dateStr) => {
    if (!dateStr) {
      return null;
    }

    // Handle formats like "9/12/2025 9am EDT", "9/19/2025 3pm EDT", or "9/12/2025 9:30am EDT"
    const timeMatch = dateStr.match(/^(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2})(?::(\d{2}))?(am|pm)\s+([A-Z]{3,4})$/);

    if (timeMatch) {
      const [, datePart, hour, minutes, ampm, timezone] = timeMatch;

      // Parse the date part (M/D/YYYY)
      const [month, day, year] = datePart.split('/').map((num) => parseInt(num, 10));

      // Convert hour to 24-hour format
      let hour24 = parseInt(hour, 10);
      if (ampm.toLowerCase() === 'pm' && hour24 !== 12) {
        hour24 += 12;
      } else if (ampm.toLowerCase() === 'am' && hour24 === 12) {
        hour24 = 0;
      }

      // Parse minutes (default to 0 if not provided)
      const minutesValue = minutes ? parseInt(minutes, 10) : 0;

      // Handle timezone offset (simplified - you might want to use a proper timezone library)
      // For now, we'll assume EDT is UTC-4 (Eastern Daylight Time)
      const timezoneOffsets = {
        EDT: -4, // UTC-4 hours
        EST: -5, // UTC-5 hours
        CDT: -5, // UTC-5 hours
        CST: -6, // UTC-6 hours
        MDT: -6, // UTC-6 hours
        MST: -7, // UTC-7 hours
        PDT: -7, // UTC-7 hours
        PST: -8, // UTC-8 hours
      };

      const offsetHours = timezoneOffsets[timezone] || 0;

      // Convert the local time to UTC by adding the offset
      // If EDT is UTC-4, then 9am EDT = 1pm UTC (9 + 4 = 13)
      const utcHour = hour24 - offsetHours;

      // Create UTC date object directly with minutes
      const utcDate = new Date(Date.UTC(year, month - 1, day, utcHour, minutesValue, 0));

      return utcDate;
    }

    // Fallback to simple date parsing for formats without time/timezone
    return new Date(dateStr);
  };

  const resp = await fetch(path);
  const schedule = await resp.json();
  const now = window.simulateDate ? new Date(window.simulateDate) : new Date();
  let pickedItem = null;
  schedule.data.forEach((item) => {
    const startDate = parseDateWithTime(item.Start);
    const endDate = parseDateWithTime(item.End);
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
