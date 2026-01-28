import { getLocaleAndLanguage } from '../../scripts/scripts.js';

function formatTime(timeString) {
  if (!timeString) return '';
  const parts = timeString.split(':');
  if (parts.length !== 3) return timeString;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10) + (parseInt(parts[2], 10) > 0 ? 1 : 0);
  const h = Math.floor((hours * 60 + minutes) / 60);
  const m = (hours * 60 + minutes) % 60;
  if (h > 0 && m > 0) return `${h} hours ${m} minutes`;
  if (h > 0) return `${h} hours`;
  return `${m} minutes`;
}

function formatYield(yieldString) {
  if (!yieldString) return '';
  const match = yieldString.match(/^([\d.]+)/);
  if (!match) return yieldString;
  const num = parseFloat(match[1]);
  return num % 1 === 0 ? `${Math.floor(num)} servings` : `${num} servings`;
}

export default async function decorate(block) {
  const { locale, language } = getLocaleAndLanguage();
  
  // Try primary path first, then fallback to /data/ path
  let resp = await fetch(`/${locale}/${language}/recipes/query-index.json`);
  if (!resp.ok) {
    resp = await fetch(`/${locale}/${language}/recipes/data/query-index.json`);
    if (!resp.ok) {
      block.remove();
      return;
    }
  }
  
  const { data } = await resp.json();
  if (!data || data.length === 0) {
    block.remove();
    return;
  }
  
  const recipes = data.filter((r) => r.status !== 'Deleted' && r.image && !r.image.includes('default-meta-image'));

  let recipe;
  const a = block.querySelector('a[href]');
  if (a) {
    const url = new URL(a.href, window.location);
    recipe = recipes.find((r) => r.path === url.pathname);
  }

  // fall back to most recent recipe
  if (!recipe) {
    const sorted = recipes
      .filter((r) => r['date-created'])
      .sort((x, y) => new Date(y['date-created']) - new Date(x['date-created']));
    [recipe] = sorted;
  }

  // If no recipe found after filtering and fallback, remove the block
  if (!recipe) {
    block.remove();
    return;
  }

  const image = recipe.image.replace('/recipes/data/media_', '/media_');

  block.innerHTML = `
    <img src="${image}" alt="" loading="lazy">
    <div class="featured-recipe-content">
      <p class="eyebrow">New Featured Recipe</p>
      <h2>${recipe.title}</h2>
      <p>${recipe.description || ''}</p>
      <dl>
        <dt><img src="/blocks/recipe/time.svg" alt="Time"></dt>
        <dd class="eyebrow">${formatTime(recipe['total-time'])}</dd>
        <dt><img src="/blocks/recipe/yield.svg" alt="Servings"></dt>
        <dd class="eyebrow">${formatYield(recipe.yield)}</dd>
      </dl>
      <p class="button-wrapper">
        <a class="button" href="${recipe.path}">Get the Recipe</a>
      </p>
    </div>
  `;
}
