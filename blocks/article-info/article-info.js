import { getMetadata, fetchPlaceholders } from '../../scripts/aem.js';
import { getLocaleAndLanguage, buildIcon, swapIcons } from '../../scripts/scripts.js';

/**
 * Creates link to articles search page with search parame.
 * @param {string} locale - Locale (e.g., 'us')
 * @param {string} language - Language (e.g., 'en_us')
 * @param {string} param - Search term
 * @returns {HTMLAnchorElement} Anchor element
 */
function buildSearchLink(locale, language, param) {
  const a = document.createElement('a');
  a.href = `/${locale}/${language}/articles?search=${encodeURIComponent(param)}`;
  a.textContent = param;
  return a;
}

/**
 * Builds social share buttons.
 * @param {Object} ph - Placeholders object containing localized labels
 * @returns {HTMLUListElement} List of share buttons
 */
function buildShare(ph) {
  const ul = document.createElement('ul');
  ul.className = 'share';

  const platforms = [
    { name: 'facebook', icon: 'social-facebook', label: ph.shareOnFacebook || 'Share on Facebook' },
    { name: 'linkedin', icon: 'social-linkedin', label: ph.shareOnLinkedin || 'Share on LinkedIn' },
    { name: 'twitter', icon: 'x', label: ph.shareOnTwitter || 'Share on X' },
    { name: 'pinterest', icon: 'social-pinterest', label: ph.shareOnPinterest || 'Share on Pinterest' },
    { name: 'email', icon: 'email', label: ph.shareViaEmail || 'Share via Email' },
  ];

  platforms.forEach(({ name, icon, label }) => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `share-${name}`;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.append(buildIcon(icon));
    li.append(button);
    ul.append(li);
  });

  const getShareData = () => {
    const url = window.location.href;
    const { title } = document;
    const articleTitle = document.querySelector('h1').textContent.trim() || title;
    const image = document.querySelector('img').src || '';
    return {
      url, title, articleTitle, image,
    };
  };

  const shareHandlers = {
    facebook: () => {
      const { url } = getShareData();
      window.open(
        `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
        '_blank',
        'width=600,height=400',
      );
    },
    linkedin: () => {
      const { url, title } = getShareData();
      window.open(
        `https://www.linkedin.com/shareArticle?mini=true&url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`,
        '_blank',
        'width=600,height=400',
      );
    },
    twitter: () => {
      const { url, title } = getShareData();
      window.open(
        `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`,
        '_blank',
        'width=600,height=400',
      );
    },
    pinterest: () => {
      const { url, title, image } = getShareData();
      window.open(
        `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(url)}&media=${encodeURIComponent(image)}&description=${encodeURIComponent(title)}`,
        '_blank',
        'width=600,height=400',
      );
    },
    email: () => {
      const { url, articleTitle } = getShareData();
      const subject = encodeURIComponent(articleTitle);
      const body = encodeURIComponent(url);
      window.location.href = `mailto:?subject=${subject}&body=${body}`;
    },
  };

  Object.entries(shareHandlers).forEach(([platform, handler]) => {
    ul.querySelector(`.share-${platform}`).addEventListener('click', handler);
  });

  return ul;
}

export default async function decorate(block) {
  const { locale, language } = getLocaleAndLanguage();
  const ph = await fetchPlaceholders(`/${locale}/${language}`);
  const tags = getMetadata('article:tag');
  const author = getMetadata('author');
  const publicationDate = getMetadata('publication-date');

  if (tags) {
    const tagsWrapper = document.createElement('p');
    tagsWrapper.className = 'tags';
    block.append(tagsWrapper);
    tags.split(',').map((tag) => tag.trim()).forEach((tag, i) => {
      if (i) tagsWrapper.append(', ');
      tagsWrapper.append(buildSearchLink(locale, language, tag));
    });
  }

  if (author || publicationDate) {
    const byline = document.createElement('p');
    byline.className = 'byline';
    block.append(byline);
    if (author) {
      const authorSpan = document.createElement('span');
      authorSpan.append(`${(ph.by || 'Par').toUpperCase()}: `);
      authorSpan.append(buildSearchLink(locale, language, author.trim()));
      byline.append(authorSpan);
    }
    if (publicationDate) {
      const date = document.createElement('span');
      date.textContent = publicationDate.trim();
      byline.append(date);
    }
  }

  block.append(buildShare(ph));
  swapIcons();
}
