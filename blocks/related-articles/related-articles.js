import { createOptimizedPicture } from '../../scripts/aem.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';

/**
 * Returns the largest factor of given n among between 1 and 4.
 * @param {number} n - Number to find largest factor for
 * @returns {number} Largest factor
 */
function getLargestFactor(n) {
  const factor = [4, 3, 2].find((f) => n % f === 0);
  if (factor) return factor;
  if (n > 4) return n % 2 === 0 ? 4 : 3;
  return 1;
}

/**
 * Builds an article card element.
 * @param {Object} article - Article data
 * @returns {HTMLLIElement} Card list item
 */
function buildArticleCard(article) {
  const {
    path, title, description, image,
  } = article;

  const li = document.createElement('li');
  li.className = 'article-click';

  const cardImage = document.createElement('div');
  cardImage.className = 'article-image';
  const imagePath = new URL(image, window.location.origin).pathname;
  cardImage.append(createOptimizedPicture(imagePath, '', false, [{ width: '900' }]));

  const cardBody = document.createElement('div');
  cardBody.className = 'article-body';

  const h3 = document.createElement('h3');
  const titleLink = document.createElement('a');
  titleLink.href = path;
  titleLink.textContent = title.split('|')[0].trim();
  h3.append(titleLink);

  const desc = document.createElement('p');
  desc.textContent = description;

  cardBody.append(h3, desc);
  li.append(cardImage, cardBody);

  return li;
}

export default async function decorate(block) {
  const { locale, language } = getLocaleAndLanguage();
  const path = `/${locale}/${language}/articles/query-index.json`;
  const resp = await fetch(path);
  if (!resp.ok) {
    block.remove();
    return;
  }

  const { data } = await resp.json();
  if (!data || data.length === 0) {
    block.remove();
    return;
  }

  // Get links from block and find matching articles in data
  const links = [...block.querySelectorAll('a[href]')];
  const hrefs = links.map((a) => new URL(a.href).pathname);
  const matchingArticles = hrefs
    .map((href) => data.find((article) => article.path === href))
    .filter((a) => a);

  if (matchingArticles.length === 0) {
    block.remove();
    return;
  }

  const ul = document.createElement('ul');
  const articlesPerRow = getLargestFactor(matchingArticles.length);
  block.classList.add(`rows-${articlesPerRow}`);
  matchingArticles.forEach((article) => {
    ul.append(buildArticleCard(article));
  });

  block.replaceChildren(ul);
}
