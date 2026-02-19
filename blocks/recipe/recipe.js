import { getMetadata, toClassName, fetchPlaceholders } from '../../scripts/aem.js';
import { getLocaleAndLanguage } from '../../scripts/scripts.js';
import { normalizeCompatibleContainers, isFrenchContainerLocale } from './recipe-containers.js';

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

function formatTime(timeString, placeholders = {}) {
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
    const hourLabel = finalHours !== 1 ? (placeholders.hours || 'Hours') : (placeholders.hour || 'Hour');
    parts2.push(`${finalHours} ${hourLabel}`);
  }
  if (finalMinutes > 0) {
    const minuteLabel = finalMinutes !== 1 ? (placeholders.minutes || 'Minutes') : (placeholders.minute || 'Minute');
    parts2.push(`${finalMinutes} ${minuteLabel}`);
  }

  return parts2.length > 0 ? parts2.join(' ') : `0 ${placeholders.minutes || 'Minutes'}`;
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

function buildToolbar(placeholders = {}) {
  const toolbar = document.createElement('div');
  toolbar.classList.add('recipe-toolbar');

  const saveLabel = placeholders.save || 'Save';
  const printLabel = placeholders.print || 'Print';
  const shareLabel = placeholders.share || 'Share';
  const shareFacebookLabel = placeholders.shareOnFacebook || 'Share on Facebook';
  const shareTwitterLabel = placeholders.shareOnTwitter || 'Share on X';
  const sharePinterestLabel = placeholders.shareOnPinterest || 'Share on Pinterest';
  const shareEmailLabel = placeholders.shareViaEmail || 'Share via Email';

  toolbar.innerHTML = `
    <button type="button" class="recipe-save"><img src="/blocks/recipe/save.svg" alt=""> ${saveLabel}</button>
    <button type="button" class="recipe-print"><img src="/blocks/recipe/print.svg" alt=""> ${printLabel}</button>
    <div class="recipe-share-wrapper">
      <button type="button" class="recipe-share"><img src="/blocks/recipe/share.svg" alt=""> ${shareLabel}</button>
      <div class="recipe-share-popup" hidden>
        <button type="button" class="share-facebook" aria-label="${shareFacebookLabel}" title="${shareFacebookLabel}">
          <img src="/icons/social-facebook.svg" alt="">
        </button>
        <button type="button" class="share-twitter" aria-label="${shareTwitterLabel}" title="${shareTwitterLabel}">
          <img src="/icons/x.svg" alt="">
        </button>
        <button type="button" class="share-pinterest" aria-label="${sharePinterestLabel}" title="${sharePinterestLabel}">
          <img src="/icons/social-pinterest.svg" alt="">
        </button>
        <button type="button" class="share-email" aria-label="${shareEmailLabel}" title="${shareEmailLabel}">
          <img src="/icons/email.svg" alt="">
        </button>
      </div>
    </div>
  `;

  // Save button
  const saveButton = toolbar.querySelector('.recipe-save');
  saveButton.addEventListener('click', () => {
    const { locale, language } = getLocaleAndLanguage();
    const title = document.querySelector('h1').textContent.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const recipeId = `rcp${title}recipe`;
    const returnUrl = `https://www.vitamix.com/${locale}/${language}/recipebook?recipe_id=${recipeId}`;
    const encodedReturn = btoa(returnUrl);
    window.location.href = `https://www.vitamix.com/${locale}/${language}/customer/account/login/referer/${encodeURIComponent(encodedReturn)}/`;
  });

  // Print button
  const printButton = toolbar.querySelector('.recipe-print');
  printButton.addEventListener('click', () => {
    printButton.setAttribute('aria-pressed', true);
    window.print();
  });

  // Share popup toggle
  const shareButton = toolbar.querySelector('.recipe-share');
  const sharePopup = toolbar.querySelector('.recipe-share-popup');
  shareButton.addEventListener('click', () => {
    sharePopup.toggleAttribute('hidden');
  });

  // Close share popup when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.recipe-share-wrapper')) {
      sharePopup.setAttribute('hidden', '');
    }
  });

  // Share button handlers
  const getShareData = () => {
    const url = window.location.href;
    const { title } = document;
    const recipeTitle = document.querySelector('h1').textContent.trim();
    const image = document.querySelector('.recipe-image img')?.src || '';
    return {
      url, title, recipeTitle, image,
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
      const { url, recipeTitle } = getShareData();
      const recipeLabel = placeholders.recipe || 'Recipe';
      const subject = encodeURIComponent(`${recipeTitle} ${recipeLabel}`);
      const body = encodeURIComponent(`${recipeTitle} ${recipeLabel}: ${url}`);
      window.location.href = `mailto:?subject=${subject}&body=${body}`;
    },
  };

  Object.entries(shareHandlers).forEach(([platform, handler]) => {
    toolbar.querySelector(`.share-${platform}`).addEventListener('click', handler);
  });

  return toolbar;
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
  const placeholders = await fetchPlaceholders(`/${locale}/${language}`);

  const totalTime = getMetadata('total-time');
  const yields = getMetadata('yield');
  const difficulty = getMetadata('difficulty');

  const dietaryInterests = writeDietaryInterests(getMetadata('dietary-interests'), locale, language);
  const h1 = block.querySelector('h1');
  const description = block.querySelector('h1 + p');
  const picture = block.querySelector('picture');

  // Format total time to be human readable
  const formattedTime = formatTime(totalTime, placeholders);
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
      <p class="eyebrow">${placeholders.totalTime || 'Total Time'}</p>
      <p>${formattedTime}</p>
     </div>
     <div class="recipe-stat recipe-stat-yields">
      <p class="eyebrow">${placeholders.yields || 'Yields'}</p>
      <p>${formattedYields}</p>
     </div>
     <div class="recipe-stat recipe-stat-difficulty">
      <p class="eyebrow">${placeholders.difficulty || 'Difficulty'}</p>
      <p>${difficulty}</p>
     </div>
    </div>
  </div>
  ${picture ? `<div class="recipe-image">${picture.outerHTML}</div>` : ''}
  <div class="recipe-additional-info">
    <div class="recipe-additional-info-item recipe-dietary-interests">
      <p class="eyebrow">${placeholders.dietaryInterests || 'Dietary Interests'}</p>
      <p>${dietaryInterests.map((i) => i.outerHTML).join(', ')}</p>
    </div>
    <div class="recipe-additional-info-item recipe-submitted-by">
      <p class="eyebrow">${placeholders.submittedBy || 'Submitted By'}</p>
      <p>Vitamix</p>
    </div>
    <div class="recipe-additional-info-item recipe-manage-preferences">
      <p>
        <a href="/${locale}/${language}/customer/account/login">${placeholders.managePreferences || 'Manage Preferences'}</a>
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

  const recipeContainer = document.createElement('div');
  recipeContainer.classList.add('recipe-body');
  recipeContainer.id = 'recipe';
  const recipeToolbar = buildToolbar(placeholders);
  recipeContainer.prepend(recipeToolbar);
  recipeContainer.append(...block.children);
  block.prepend(recipeHeader);
  block.append(recipeContainer);

  // Get section names from placeholders
  const sectionNames = {
    ingredients: placeholders.ingredients || 'Ingredients',
    directions: placeholders.directions || 'Directions',
    notes: placeholders.notes || 'Notes',
    nutrition: placeholders.nutrition || 'Nutrition',
  };

  // Find H2 elements by text content and wrap them
  Object.keys(sectionNames).forEach((key) => {
    const sectionText = sectionNames[key];
    // Find H2 with matching text content (case-insensitive, trimmed)
    const h2Elements = [...block.querySelectorAll('h2')];
    const h2 = h2Elements.find(
      (heading) => heading.textContent.trim().toLowerCase() === sectionText.toLowerCase(),
    );

    if (h2) {
      wrapInDiv(h2, `recipe-${key}`);
    }
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
      const response = await fetch(`/${locale}/${language}/recipes/query-index.json`);
      const data = await response.json();

      // Find all recipes with the same title
      const sameRecipes = data.data.filter((recipe) => recipe.title === recipeTitle);

      // Build container display names (alias + French if needed) and map to a recipe path
      const useFrenchDisplay = isFrenchContainerLocale(locale, language);
      const containerMap = new Map();
      sameRecipes.forEach((recipe) => {
        if (recipe['compatible-containers']) {
          const raw = recipe['compatible-containers'].split(',').map((c) => c.trim()).filter(Boolean);
          const displayNames = normalizeCompatibleContainers(raw, useFrenchDisplay);
          displayNames.forEach((displayName) => {
            if (!containerMap.has(displayName)) {
              containerMap.set(displayName, recipe.path);
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
        heading.textContent = placeholders.refineYourRecipe || 'Refine Your Recipe';

        const details = document.createElement('details');
        details.open = true;

        const summary = document.createElement('summary');
        summary.textContent = placeholders.containerSize || 'Container Size';

        const ul = document.createElement('ul');
        sortedContainers.forEach(([container, path]) => {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.href = `${path}#recipe`;
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
