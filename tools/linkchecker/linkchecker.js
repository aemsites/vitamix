import { loadCSS } from '../../scripts/aem.js';

loadCSS('/tools/linkchecker/linkchecker.css');

function checkLinks() {
  if (window.location.pathname.startsWith('/drafts/')) return;
  const locale = window.location.pathname.split('/').slice(0, 3).join('/');
  const links = document.querySelectorAll('a[href]');
  links.forEach((link) => {
    const url = new URL(link.href);
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

setTimeout(checkLinks, 2000);
