import { getMetadata, toClassName } from '../../scripts/aem.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';

function wrapInDiv(element, className) {
  if (!element) return;
  const { previousSibling, parentElement } = element;
  const tag = element.tagName;
  const wrapper = document.createElement('div');
  wrapper.classList.add(className);
  while (element.nextElementSibling && element.nextElementSibling.tagName !== tag) {
    wrapper.append(element.nextElementSibling);
  }
  wrapper.prepend(element);
  parentElement.insertBefore(
    wrapper,
    previousSibling ? previousSibling.nextSibling : parentElement.firstElementChild,
  );
}

function formatTime(timeString) {
  if (!timeString) return '';

  // Parse HH:MM:SS format
  const parts = timeString.split(':');
  if (parts.length !== 3) return timeString;

  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseInt(parts[2], 10);

  // Round seconds up to next minute if > 0
  let totalMinutes = hours * 60 + minutes;
  if (seconds > 0) {
    totalMinutes += 1;
  }

  // Convert back to hours and minutes
  const finalHours = Math.floor(totalMinutes / 60);
  const finalMinutes = totalMinutes % 60;

  // Build readable string
  const parts2 = [];
  if (finalHours > 0) {
    parts2.push(`${finalHours} Hour${finalHours !== 1 ? 's' : ''}`);
  }
  if (finalMinutes > 0) {
    parts2.push(`${finalMinutes} Minute${finalMinutes !== 1 ? 's' : ''}`);
  }

  return parts2.length > 0 ? parts2.join(' ') : '0 Minutes';
}

function formatServings(servingsString) {
  if (!servingsString) return '';

  // Extract number from string like "8.00 servings"
  const match = servingsString.match(/^([\d.]+)\s*(.*)$/);
  if (!match) return servingsString;

  const number = parseFloat(match[1]);
  const unit = match[2];

  // Remove decimals if not needed (e.g., 8.00 → 8, but 8.5 stays 8.5)
  const formattedNumber = number % 1 === 0 ? Math.floor(number) : number;

  return unit ? `${formattedNumber} ${unit}` : `${formattedNumber}`;
}

function writeDietaryInterests(data, locale, language) {
  const dietaryInterests = data.split(',').map((i) => i.trim());
  return dietaryInterests.map((interest) => {
    const a = document.createElement('a');
    a.href = `/${locale}/${language}/search?refineby=${toClassName(interest)}`;
    a.textContent = interest;
    return a;
  });
}

export default async function decorate(block) {
  const { locale, language } = getLocaleAndLanguage();

  const totalTime = getMetadata('total-time');
  const yields = getMetadata('yield');
  const difficulty = getMetadata('difficulty');

  const dietaryInterests = writeDietaryInterests(getMetadata('dietary-interests'), locale, language);
  const h1 = block.querySelector('h1');
  const description = block.querySelector('h1 + p');
  const picture = block.querySelector('picture');

  // Format total time to be human readable
  const formattedTime = formatTime(totalTime);
  const formattedYields = formatServings(yields);

  const recipeHeader = document.createElement('div');
  recipeHeader.classList.add('recipe-header');
  if (!picture) {
    recipeHeader.classList.add('no-image');
  }

  recipeHeader.innerHTML = `<div class="recipe-details">
    <h1>${h1 ? h1.textContent : ''}</h1>
    <div class="recipe-rating"></div>
    <p>${description ? description.textContent : ''}</p>
    <div class="recipe-stats">
     <div class="recipe-stat recipe-stat-total-time">
      <p class="eyebrow">Total Time</p>
      <p>${formattedTime}</p>
     </div>
     <div class="recipe-stat recipe-stat-yields">
      <p class="eyebrow">Yields</p>
      <p>${formattedYields}</p>
     </div>
     <div class="recipe-stat recipe-stat-difficulty">
      <p class="eyebrow">Difficulty</p>
      <p>${difficulty}</p>
     </div>
    </div>
  </div>
  ${picture ? `<div class="recipe-image">${picture.outerHTML}</div>` : ''}
  <div class="recipe-additional-info">
    <div class="recipe-additional-info-item recipe-dietary-interests">
      <p class="eyebrow">Dietary Interests</p>
      <p>${dietaryInterests.map((i) => i.outerHTML).join(', ')}</p>
    </div>
    <div class="recipe-additional-info-item recipe-submitted-by">
      <p class="eyebrow">Submitted By</p>
      <p>Vitamix</p>
    </div>
    <div class="recipe-additional-info-item recipe-manage-preferences">
      <p>
        <a href="/${locale}/${language}/customer/account/login">Manage Preferences</a>
      </p>
    </div>
  </div>`;

  if (h1) h1.remove();
  if (description) description.remove();
  if (picture) {
    const wrapper = picture.closest('.img-wrapper');
    if (wrapper) wrapper.remove();
    else picture.remove();
  }

  // Create recipe toolbar
  const recipeToolbar = document.createElement('div');
  recipeToolbar.classList.add('recipe-toolbar');
  recipeToolbar.innerHTML = `
    <button type="button"><img src="/blocks/recipe/save.svg" alt=""> Save</button>
    <button type="button"><img src="/blocks/recipe/print.svg" alt=""> Print</button>
    <button type="button"><img src="/blocks/recipe/share.svg" alt=""> Share</button>
  `;

  const recipeContainer = document.createElement('div');
  recipeContainer.classList.add('recipe-body');
  recipeContainer.append(...block.children);
  block.prepend(recipeHeader);
  block.append(recipeContainer);
  recipeContainer.prepend(recipeToolbar);

  // Wrap content sections
  ['ingredients', 'directions', 'notes', 'nutrition'].forEach((id) => {
    wrapInDiv(block.querySelector(`#${id}`), `recipe-${id}`);
  });

  // Group ingredients + directions in shared container
  const ingredients = block.querySelector('.recipe-ingredients');
  const directions = block.querySelector('.recipe-directions');
  if (ingredients && directions) {
    const instructions = document.createElement('div');
    instructions.className = 'recipe-instructions';
    ingredients.before(instructions);
    instructions.append(ingredients, directions);
  }

  // Move notes to end of recipe-body
  const notes = block.querySelector('.recipe-notes');
  if (notes) recipeContainer.append(notes);

  // Convert nutrition ul to table
  const nutritionSection = block.querySelector('.recipe-nutrition');
  if (nutritionSection) {
    const ul = nutritionSection.querySelector('ul');
    if (ul) {
      const table = document.createElement('table');
      const tbody = document.createElement('tbody');

      ul.querySelectorAll(':scope > li').forEach((li) => {
        const p = li.querySelector(':scope > p');
        const nestedUl = li.querySelector(':scope > ul');
        const text = p ? p.textContent : '';

        if (text && text.includes(':')) {
          const [label, value] = text.split(':').map((s) => s.trim());
          const tr = document.createElement('tr');
          tr.innerHTML = `<td>${label}</td><td>${value}</td>`;
          tbody.append(tr);
        }

        if (nestedUl) {
          nestedUl.querySelectorAll('li').forEach((nestedLi) => {
            const nestedText = nestedLi.textContent;
            if (nestedText && nestedText.includes(':')) {
              const [label, value] = nestedText.split(':').map((s) => s.trim());
              const tr = document.createElement('tr');
              tr.classList.add('nested');
              tr.innerHTML = `<td>${label}</td><td>${value}</td>`;
              tbody.append(tr);
            }
          });
        }
      });

      table.append(tbody);
      ul.replaceWith(table);
    }
  }

  // Add compatible containers section above ingredients
  const recipeTitle = h1 ? h1.textContent.trim() : '';
  const ingredientsSection = block.querySelector('.recipe-ingredients');
  if (recipeTitle && ingredientsSection) {
    try {
      const response = await fetch(`/${locale}/${language}/recipes/data/query-index.json`);
      const data = await response.json();

      // Find all recipes with the same title
      const sameRecipes = data.data.filter((recipe) => recipe.title === recipeTitle);

      // Create a map of containers to recipe paths
      const containerMap = new Map();
      sameRecipes.forEach((recipe) => {
        if (recipe['compatible-containers']) {
          const containers = recipe['compatible-containers'].split(',').map((c) => c.trim());
          containers.forEach((container) => {
            if (!containerMap.has(container)) {
              containerMap.set(container, recipe.path);
            }
          });
        }
      });

      // Only create the section if we have containers
      if (containerMap.size > 0) {
        const currentPath = window.location.pathname;
        const sortedContainers = Array.from(containerMap.entries())
          .sort((a, b) => b[0].localeCompare(a[0]));

        const containerSection = document.createElement('div');
        containerSection.className = 'recipe-refine';

        const heading = document.createElement('h2');
        heading.textContent = 'Refine Your Recipe';

        const details = document.createElement('details');
        details.open = true;

        const summary = document.createElement('summary');
        summary.textContent = 'Container Size';

        const ul = document.createElement('ul');
        sortedContainers.forEach(([container, path]) => {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.href = path;
          a.textContent = container;
          if (path === currentPath) {
            a.setAttribute('aria-current', 'page');
          }
          li.append(a);
          ul.append(li);
        });

        details.append(summary, ul);
        containerSection.append(heading, details);

        if (nutritionSection) {
          nutritionSection.parentElement.insertBefore(containerSection, nutritionSection);
        }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error loading recipe containers:', error);
    }
  }
}
