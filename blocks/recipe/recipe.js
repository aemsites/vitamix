import { getMetadata } from '../../scripts/aem.js';

export default async function decorate(block) {
  const totalTime = getMetadata('total-time');
  const yields = getMetadata('yield');
  const difficulty = getMetadata('difficulty');
  const compatibleContainers = getMetadata('compatible-containers');
  const course = getMetadata('course');
  const recipeType = getMetadata('recipe-type');
  const status = getMetadata('status');
  const dateCreated = getMetadata('date-created');
  const dateUpdated = getMetadata('date-updated');
  const dietaryInterests = getMetadata('dietary-interests');
  const h1 = block.querySelector('h1');
  const description = block.querySelector('h1 + p');
  const picture = block.querySelector('picture');

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
      <span class="recipe-stat-value">${totalTime}</span>
     </div>
     <div class="recipe-stat recipe-stat-yields">
      <span class="recipe-stat-label">Yields</span>
      <span class="recipe-stat-value">${yields}</span>
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

  console.log('totalTime', totalTime);
  console.log('yields', yields);
  console.log('difficulty', difficulty);
  console.log('compatibleContainers', compatibleContainers);
  console.log('course', course);
  console.log('recipeType', recipeType);
  console.log('status', status);
  console.log('dateCreated', dateCreated);
  console.log('dateUpdated', dateUpdated);
  console.log('dietaryInterests', dietaryInterests);
}
