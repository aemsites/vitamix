import { loadCSS, getMetadata } from '../../scripts/aem.js';

loadCSS('/tools/linkchecker/linkchecker.css');

function checkLinks() {
  if (window.location.pathname.startsWith('/drafts/')) return;
  const locale = window.location.pathname.split('/').slice(0, 3).join('/');
  const links = document.querySelectorAll('a[href]');
  links.forEach((link) => {
    const url = new URL(link.href);
    if (url.pathname.startsWith('/assets/')) return;
    if (link.href.startsWith('https://www.vitamix.com/content/dam/')) return;
    if (url.origin.includes('vitamix.com')
        || url.origin.includes('.aem.')
        || url.origin.includes('localhost')) {
      if (!url.pathname.startsWith(locale)) {
        link.classList.add('linkchecker-invalid-link');
      }
    }
  });
}

function addScheduleLink() {
  const schedule = getMetadata('schedule');
  const badge = document.createElement('div');
  badge.className = 'linkchecker-schedule-badge';

  const link = document.createElement('a');
  link.href = `/tools/date-simulator/index.html?page=${encodeURIComponent(window.location.pathname)}`;
  link.textContent = `Schedule: ${schedule}`;
  link.target = '_blank';
  link.classList.add('linkchecker-schedule-link');

  badge.append(link);
  document.body.append(badge);
}

setTimeout(checkLinks, 2000);

if (getMetadata('schedule')) {
  setTimeout(addScheduleLink, 2000);
}
