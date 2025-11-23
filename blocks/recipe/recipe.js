import { getMetadata } from '../../scripts/aem.js';

function wrapInDiv(element, className) {
  const { previousSibling, parentElement } = element;
  const tag = element.tagName;
  const wrapper = document.createElement('div');
  wrapper.classList.add(className);
  while (element.nextElementSibling && element.nextElementSibling.tagName !== tag) {
    wrapper.append(element.nextElementSibling);
  }
  wrapper.prepend(element);
  parentElement.insertBefore(wrapper, previousSibling.nextSibling);
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

export default async function decorate(block) {
  const totalTime = getMetadata('total-time');
  const yields = getMetadata('yield');
  const difficulty = getMetadata('difficulty');
  /*
  const compatibleContainers = getMetadata('compatible-containers');
  const course = getMetadata('course');
  const recipeType = getMetadata('recipe-type');
  const status = getMetadata('status');
  const dateCreated = getMetadata('date-created');
  const dateUpdated = getMetadata('date-updated');
  */
  const dietaryInterests = getMetadata('dietary-interests');
  const h1 = block.querySelector('h1');
  const description = block.querySelector('h1 + p');
  const picture = block.querySelector('picture');

  // Format total time to be human readable
  const formattedTime = formatTime(totalTime);
  const formattedYields = formatServings(yields);

  const recipeHeader = document.createElement('div');
  recipeHeader.classList.add('recipe-header');
  recipeHeader.innerHTML = `<div class="recipe-details">
    <h1>${h1.textContent}</h1>
    <div class="recipe-rating">
      <div class="recipe-stars">
        <span class="star">★</span>
        <span class="star">★</span>
        <span class="star">★</span>
        <span class="star">★</span> 
        <span class="star">★</span>
      </div>
      <span class="review-count">100 reviews</span>
      <a href="#" class="write-review">Write a review</a>
    </div>
    <p>${description.textContent}</p>
    <div class="recipe-stats">
     <div class="recipe-stat recipe-stat-total-time">
      <span class="recipe-stat-label">Total Time</span>
      <span class="recipe-stat-value">${formattedTime}</span>
     </div>
     <div class="recipe-stat recipe-stat-yields">
      <span class="recipe-stat-label">Yields</span>
      <span class="recipe-stat-value">${formattedYields}</span>
     </div>
     <div class="recipe-stat recipe-stat-difficulty">
      <span class="recipe-stat-label">Difficulty</span>
      <span class="recipe-stat-value">${difficulty}</span>
     </div>
    </div>
  </div>
  <div class="recipe-image">
    ${picture.outerHTML}
  </div>
  <div class="recipe-additional-info">
    <div class="recipe-additional-info-item">
      <span class="recipe-dietary-interests">
        <span class="recipe-dietary-interest-label">Dietary Interests</span>
        <span class="recipe-dietary-interest-value">${dietaryInterests}</span>
      </span>
    </div>
    <div class="recipe-additional-info-item">
      <span class="recipe-submitted-by">
        <span class="recipe-submitted-by-label">Submitted By</span>
        <span class="recipe-submitted-by-value">Vitamix</span>
      </span>        
    </div>
    <div class="recipe-additional-info-item">
      <span class="recipe-manage-preferences">
        <span class="recipe-manage-preferences-label">Manage Preferences</span>
      </span>
    </div>
  </div>`;

  h1.remove();
  description.remove();
  picture.remove();

  const recipeContainer = document.createElement('div');
  recipeContainer.classList.add('recipe-body');
  recipeContainer.append(...block.children);
  block.prepend(recipeHeader);
  block.append(recipeContainer);

  wrapInDiv(block.querySelector('#ingredients'), 'recipe-ingredients');
  wrapInDiv(block.querySelector('#directions'), 'recipe-directions');
  wrapInDiv(block.querySelector('#notes'), 'recipe-notes');
  wrapInDiv(block.querySelector('#nutrition'), 'recipe-nutrition');

  // Process nutrition items to split label and value
  const nutritionSection = block.querySelector('.recipe-nutrition');
  if (nutritionSection) {
    const nutritionItems = nutritionSection.querySelectorAll('ul > li');
    nutritionItems.forEach((item) => {
      const paragraph = item.querySelector('p');
      if (paragraph) {
        const text = paragraph.textContent.trim();
        const colonIndex = text.indexOf(':');
        if (colonIndex > -1) {
          const label = text.substring(0, colonIndex).trim();
          const value = text.substring(colonIndex + 1).trim();
          paragraph.innerHTML = `<span class="nutrition-label">${label}</span><span class="nutrition-value">${value}</span>`;
        }
      }
      // Process nested items (like Dietary Fiber, Sugars)
      const nestedItems = item.querySelectorAll('ul > li');
      nestedItems.forEach((nestedItem) => {
        const text = nestedItem.textContent.trim();
        const colonIndex = text.indexOf(':');
        if (colonIndex > -1) {
          const label = text.substring(0, colonIndex).trim();
          const value = text.substring(colonIndex + 1).trim();
          nestedItem.innerHTML = `<span class="nutrition-label">${label}</span><span class="nutrition-value">${value}</span>`;
        }
      });
    });
  }
}
