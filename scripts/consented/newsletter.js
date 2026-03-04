import { loadCSS, fetchPlaceholders } from '../aem.js';

await loadCSS(new URL('./newsletter.css', import.meta.url).href);

function showMinimizedTeaser(text, newsletterLink) {
  const teaser = document.createElement('div');
  teaser.className = 'newsletter-minimized-teaser';
  teaser.innerHTML = `<span class="newsletter-minimized-teaser-text">${text}</span>`;
  document.body.appendChild(teaser);

  const textEl = teaser.querySelector('.newsletter-minimized-teaser-text');

  const markSignedUp = () => {
    localStorage.setItem('newsletter-popped-up', 'true');
    teaser.remove();
  };

  const attachFormSubmitListener = () => {
    const form = document.querySelector('form.footer-sign-up');
    if (form && !form.dataset.newsletterTeaserListener) {
      form.dataset.newsletterTeaserListener = 'true';
      form.addEventListener('submit', () => markSignedUp(), { once: true });
      return true;
    }
    return false;
  };

  textEl.addEventListener('click', (e) => {
    e.stopPropagation();
    window.leadSourceOverride = 'minimizedmodal';
    newsletterLink.click();
    attachFormSubmitListener();
    setTimeout(() => attachFormSubmitListener(), 1000);
  });
}

async function initNewsletterPrompt() {
  if (localStorage.getItem('newsletter-popped-up') === 'true') return;

  const pathSegments = window.location.pathname.split('/').filter(Boolean);
  const locale = pathSegments[0] || 'us';
  const language = pathSegments[1] || 'en_us';
  const placeholders = await fetchPlaceholders(`/${locale}/${language}`);
  const minimizedText = placeholders.newsletterMinimized?.trim?.();

  const newsletterLink = document.querySelector('a[href*="/modals/sign-up"]');

  if (minimizedText && newsletterLink) {
    showMinimizedTeaser(minimizedText, newsletterLink);
    return;
  }

  if (newsletterLink) {
    localStorage.setItem('newsletter-popped-up', 'true');
    setTimeout(() => newsletterLink.click(), 5000);
  }
}

initNewsletterPrompt();
