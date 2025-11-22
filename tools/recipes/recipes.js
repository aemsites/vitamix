// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';

// Parse query parameters
export function getQueryParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    user: params.get('user') || '',
    pw: params.get('pw') || '',
    date: params.get('date') || '',
    recipe: params.get('recipe') || '',
    status: params.get('status') || '',
    dateCreated: params.get('dateCreated') || '',
    dateUpdated: params.get('dateUpdated') || '',
  };
}

// Format date for API request (mm/dd/yyyy)
export function formatDate(dateString) {
  if (!dateString) return '';
  // Convert from YYYY-MM-DD (date input format) to mm/dd/yyyy
  const [year, month, day] = dateString.split('-');
  return `${month}/${day}/${year}`;
}

// Make GET request with query params
export async function fetchRecipes(userId, password, dateUpdated) {
  // Create query parameters
  const queryParams = new URLSearchParams({
    ID: userId,
    PSWD: password,
    Kiosk: 'Website',
    CodeTranslation: '1',
    DateUpdated: formatDate(dateUpdated),
  });

  // Use CORS proxy
  const apiUrl = `https://vitamix.calcmenuweb.com/ws/service.asmx/GetUpdatedRecipes?${queryParams.toString()}`;
  const corsProxy = 'https://little-forest-58aa.david8603.workers.dev/?url=';

  const response = await fetch(corsProxy + encodeURIComponent(apiUrl), {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const xmlText = await response.text();
  return xmlText;
}

// Fetch recipe details
export async function fetchRecipeDetails(userId, password, recipeNumber) {
  // Create query parameters
  const queryParams = new URLSearchParams({
    ID: userId,
    PSWD: password,
    Kiosk: 'Website',
    RecipeNumber: recipeNumber,
    CodeTranslation: '1',
    CodeNutrientSet: '0',
  });

  // Use CORS proxy
  const apiUrl = `https://vitamix.calcmenuweb.com/ws/service.asmx/GetRecipeDetails?${queryParams.toString()}`;
  const corsProxy = 'https://little-forest-58aa.david8603.workers.dev/?url=';

  const response = await fetch(corsProxy + encodeURIComponent(apiUrl), {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const xmlText = await response.text();
  return xmlText;
}

// Initialize form with query params
export function initializeForm() {
  const params = getQueryParams();
  const userIdInput = document.getElementById('userId');
  const passwordInput = document.getElementById('password');
  const dateUpdatedInput = document.getElementById('dateUpdated');
  const credentialsNotice = document.getElementById('credentialsNotice');

  if (params.user) {
    userIdInput.value = params.user;
  }

  if (params.pw) {
    passwordInput.value = params.pw;
  }

  if (params.date) {
    dateUpdatedInput.value = params.date;
  }

  if (params.user && params.pw) {
    credentialsNotice.style.display = 'none';
  }
}

// Show error
export function showError(message) {
  const errorDiv = document.getElementById('error');
  errorDiv.textContent = message;
  errorDiv.classList.add('active');
  setTimeout(() => {
    errorDiv.classList.remove('active');
  }, 5000);
}

// Sync recipe with DA
export async function syncWithDA(recipeName, recipeNumber) {
  const kebabName = recipeName
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .trim();

  const lowercaseNumber = recipeNumber.toLowerCase();
  const filename = `${kebabName}-${lowercaseNumber}.html`;

  // Get the recipe content
  const recipeElement = document.querySelector('.recipe');
  if (!recipeElement) {
    throw new Error('Recipe content not found');
  }

  // Create the HTML document
  const htmlContent = `<html>
<body>
<main>
${recipeElement.innerHTML}
</main>
</body>
</html>`;

  // Get DA token
  // eslint-disable-next-line no-undef
  const { token } = await DA_SDK;

  // Create blob and form data
  const blob = new Blob([htmlContent], { type: 'text/html' });
  const body = new FormData();
  body.append('data', blob);

  const opts = {
    headers: { Authorization: `Bearer ${token}` },
    method: 'POST',
    body,
  };

  const fullpath = `https://admin.da.live/source/aemsites/vitamix/us/en_us/recipes/data/${filename}`;

  const resp = await fetch(fullpath, opts);

  if (!resp.ok) {
    throw new Error(`Failed to sync: ${resp.status} ${resp.statusText}`);
  }

  return { filename, url: fullpath };
}

// Display recipe details on page
export async function displayRecipeDetails(recipeNumber) {
  const params = getQueryParams();

  if (!params.user || !params.pw) {
    showError('User credentials are required to view details');
    return;
  }

  // Hide form and show detail view
  const formSection = document.querySelector('.form-section');
  const resultsDiv = document.getElementById('results');
  const detailView = document.getElementById('detailView');
  const detailContent = document.getElementById('detailContent');
  const detailLoading = document.getElementById('detailLoading');

  formSection.style.display = 'none';
  resultsDiv.style.display = 'none';
  detailView.style.display = 'block';
  detailLoading.classList.add('active');
  detailContent.innerHTML = '';

  try {
    const xmlResponse = await fetchRecipeDetails(params.user, params.pw, recipeNumber);

    // Parse XML to extract name and description
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlResponse, 'text/xml');

    // Try to find recipe name and description
    const recipeName = xmlDoc.querySelector('RecipeName, Name, recipeName, name')?.textContent.trim() || 'Recipe Details';
    const recipeDescription = xmlDoc.querySelector('RecipeDescription, Description, recipeDescription, description')?.textContent.trim() || '';

    // Convert recipe name to kebab-case
    const kebabName = recipeName
      .toLowerCase()
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
      .trim();

    // Add "View on Vitamix.com" button to detail header
    const detailHeader = detailView.querySelector('.detail-header');
    let viewOnVitamixBtn = detailHeader.querySelector('.btn-view-on-vitamix');
    if (!viewOnVitamixBtn) {
      viewOnVitamixBtn = document.createElement('a');
      viewOnVitamixBtn.className = 'btn-view-on-vitamix';
      viewOnVitamixBtn.target = '_blank';
      viewOnVitamixBtn.rel = 'noopener noreferrer';
      viewOnVitamixBtn.textContent = 'View on Vitamix.com';
      detailHeader.appendChild(viewOnVitamixBtn);
    }
    const recipePageUrl = `https://www.vitamix.com/us/en_us/recipes/${kebabName}`;
    viewOnVitamixBtn.href = recipePageUrl;

    // Add "Sync with DA" button to detail header
    let syncWithDABtn = detailHeader.querySelector('.btn-sync-with-da');
    if (!syncWithDABtn) {
      syncWithDABtn = document.createElement('button');
      syncWithDABtn.className = 'btn-sync-with-da';
      syncWithDABtn.textContent = 'Sync with DA';
      detailHeader.appendChild(syncWithDABtn);

      syncWithDABtn.addEventListener('click', async () => {
        const originalText = syncWithDABtn.textContent;
        try {
          syncWithDABtn.disabled = true;
          syncWithDABtn.textContent = 'Syncing...';

          const result = await syncWithDA(recipeName, recipeNumber);

          syncWithDABtn.textContent = '✓ Synced!';
          syncWithDABtn.style.backgroundColor = '#28a745';

          // eslint-disable-next-line no-console
          console.log('Successfully synced recipe:', result);

          // Reset button after 3 seconds
          setTimeout(() => {
            syncWithDABtn.textContent = originalText;
            syncWithDABtn.style.backgroundColor = '';
            syncWithDABtn.disabled = false;
          }, 3000);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error('Error syncing with DA:', error);
          syncWithDABtn.textContent = '✗ Failed';
          syncWithDABtn.style.backgroundColor = '#dc3545';

          showError(`Failed to sync with DA: ${error.message}`);

          // Reset button after 3 seconds
          setTimeout(() => {
            syncWithDABtn.textContent = originalText;
            syncWithDABtn.style.backgroundColor = '';
            syncWithDABtn.disabled = false;
          }, 3000);
        }
      });
    }

    // Fetch recipe image from Vitamix website
    let recipeImageSrc = '';
    try {
      // Fetch the recipe page through CORS proxy
      const corsProxy = 'https://little-forest-58aa.david8603.workers.dev/?url=';
      const pageResponse = await fetch(corsProxy + encodeURIComponent(recipePageUrl));

      if (pageResponse.ok) {
        const htmlText = await pageResponse.text();
        const htmlParser = new DOMParser();
        const htmlDoc = htmlParser.parseFromString(htmlText, 'text/html');

        // Find the image with the specific class
        const imageElement = htmlDoc.querySelector('.ognm-header-recipe__image-carousel__img');
        if (imageElement) {
          let src = imageElement.getAttribute('src') || '';
          // Prefix with origin if it's a relative path
          if (src && !src.startsWith('http')) {
            const slash = src.startsWith('/') ? '' : '/';
            src = `https://www.vitamix.com${slash}${src}`;
          }
          recipeImageSrc = src;
        }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error fetching recipe image:', error);
    }

    // Extract metadata
    // Extract Total Time from Time element with Name "Total Time"
    let totalTime = '';
    const timeElements = xmlDoc.querySelectorAll('Time');
    Array.from(timeElements).forEach((timeElement) => {
      const nameElement = timeElement.querySelector('Name');
      if (nameElement && nameElement.textContent.trim() === 'Total Time') {
        const hoursElement = timeElement.querySelector('RecipeTimeHH');
        const minutesElement = timeElement.querySelector('RecipeTimeMM');
        const secondsElement = timeElement.querySelector('RecipeTimeSS');

        if (hoursElement || minutesElement || secondsElement) {
          const hours = hoursElement?.textContent.trim() || '0';
          const minutes = minutesElement?.textContent.trim() || '0';
          const seconds = secondsElement?.textContent.trim() || '0';

          // Format as HH:MM:SS
          totalTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }
      }
    });

    // Extract Yield from Main > Yield1 and Yield1_Unit
    const mainElement = xmlDoc.querySelector('Main');
    let recipeYield = '';
    if (mainElement) {
      const yield1 = mainElement.querySelector('Yield1')?.textContent.trim() || '';
      const yield1Unit = mainElement.querySelector('Yield1_Unit')?.textContent.trim() || '';
      if (yield1 && yield1Unit) {
        recipeYield = `${yield1} ${yield1Unit}`;
      } else if (yield1) {
        recipeYield = yield1;
      }
    }

    const difficulty = xmlDoc.querySelector('Difficulty, difficulty, Level, level')?.textContent.trim() || '';

    // Extract Keywords from Keywords section
    const dietaryInterests = [];
    const courses = [];
    const recipeTypes = [];
    const keywords = xmlDoc.querySelectorAll('Key');
    Array.from(keywords).forEach((key) => {
      const nameParent = key.querySelector('NameParent');
      const name = key.querySelector('Name');
      if (nameParent && name) {
        const parentText = nameParent.textContent.trim();
        const nameText = name.textContent.trim();
        if (parentText === 'Dietary Interest') {
          dietaryInterests.push(nameText);
        } else if (parentText === 'Course') {
          courses.push(nameText);
        } else if (parentText === 'Recipe type') {
          recipeTypes.push(nameText);
        }
      }
    });
    const dietaryInterestsStr = dietaryInterests.join(', ');
    const coursesStr = courses.join(', ');
    const recipeTypesStr = recipeTypes.join(', ');

    // Extract Compatible Containers from Brands section
    const compatibleContainers = [];
    const brands = xmlDoc.querySelectorAll('Brands > Brand');
    Array.from(brands).forEach((brand) => {
      const brandName = brand.querySelector('BrandName');
      if (brandName) {
        compatibleContainers.push(brandName.textContent.trim());
      }
    });
    const compatibleContainersStr = compatibleContainers.join(', ');

    // Extract Allergens
    const allergens = [];
    const allergenElements = xmlDoc.querySelectorAll('Allergens > Allergen, allergens > allergen');
    Array.from(allergenElements).forEach((allergen) => {
      const name = allergen.querySelector('Name, name');
      if (name) {
        allergens.push(name.textContent.trim());
      }
    });
    const allergensStr = allergens.join(', ');

    // Get status and dates from query params
    const recipeStatus = params.status || '';
    const recipeCreatedDate = params.dateCreated ? new Date(params.dateCreated).toISOString() : '';
    const recipeUpdatedDate = params.dateUpdated ? new Date(params.dateUpdated).toISOString() : '';

    // Build metadata table rows
    const metadataRows = [
      { name: 'Total Time', value: totalTime },
      { name: 'Yield', value: recipeYield },
      { name: 'Difficulty', value: difficulty },
      { name: 'Compatible Containers', value: compatibleContainersStr },
      { name: 'Course', value: coursesStr },
      { name: 'Recipe Type', value: recipeTypesStr },
      { name: 'Allergens', value: allergensStr },
      { name: 'Status', value: recipeStatus },
      { name: 'Date Created', value: recipeCreatedDate },
      { name: 'Date Updated', value: recipeUpdatedDate },
      { name: 'Dietary Interests', value: dietaryInterestsStr },
    ].filter((row) => row.value).map((row) => `
      <tr>
        <td>${row.name}</td>
        <td>${row.value}</td>
      </tr>
    `).join('');

    // Extract Ingredients
    const ingredients = [];
    const ingredientElements = xmlDoc.querySelectorAll('Ingredients > Ingredient');
    Array.from(ingredientElements).forEach((ingredient) => {
      const quantityImperial = ingredient.querySelector('Quantity_Imperial')?.textContent.trim() || '';
      const unitImperial = ingredient.querySelector('Unit_Imperial')?.textContent.trim() || '';
      const quantityMetric = ingredient.querySelector('Quantity_Metric')?.textContent.trim() || '';
      const unitMetric = ingredient.querySelector('Unit_Metric')?.textContent.trim() || '';
      const name = ingredient.querySelector('Name')?.textContent.trim() || '';
      const preparation = ingredient.querySelector('Preparation')?.textContent.trim() || '';

      // Format: Quantity_Imperial Unit_Imperial (Quantity_Metric Unit_Metric) Name, Preparation
      let ingredientStr = '';
      if (quantityImperial && unitImperial) {
        ingredientStr += `${quantityImperial} ${unitImperial}`;
      }
      if (quantityMetric && unitMetric) {
        ingredientStr += ` (${quantityMetric} ${unitMetric})`;
      }
      if (name) {
        ingredientStr += ` ${name}`;
      }
      if (preparation) {
        ingredientStr += `, ${preparation}`;
      }

      if (ingredientStr.trim()) {
        ingredients.push(ingredientStr.trim());
      }
    });

    const ingredientsHtml = ingredients.length > 0 ? `
      <h2>Ingredients</h2>
      <ul class="ingredients-list">
        ${ingredients.map((ing) => `<li>${ing}</li>`).join('')}
      </ul>
    ` : '';

    // Extract Directions/Procedure Steps
    const procedureElement = xmlDoc.querySelector('Procedure');
    const procedureNotes = procedureElement?.querySelector('Notes')?.textContent.trim() || '';

    const directions = [];
    const stepElements = xmlDoc.querySelectorAll('Procedure > Step');
    Array.from(stepElements).forEach((step) => {
      const note = step.querySelector('Note')?.textContent.trim() || '';
      if (note) {
        directions.push(note);
      }
    });

    const directionsHtml = directions.length > 0 ? `
      <h2>Directions</h2>
      <ol class="directions-list">
        ${directions.map((dir) => `<li>${dir}</li>`).join('')}
      </ol>
    ` : '';

    // Create Notes section if procedure notes exist
    const notesHtml = procedureNotes ? `
      <h2>Notes</h2>
      <p>${procedureNotes}</p>
    ` : '';

    // Extract Nutrition Information
    let nutritionHtml = '';
    const nutritionElement = xmlDoc.querySelector('Nutrition');
    if (nutritionElement) {
      const portionSize = nutritionElement.querySelector('PortionSize')?.textContent.trim() || '';
      const nutrients = nutritionElement.querySelectorAll('Nutrient');

      // Helper function to find nutrient by key
      const findNutrient = (key) => {
        const nutrientEl = Array.from(nutrients).find((n) => {
          const nutKey = n.querySelector('NutKey')?.textContent.trim();
          const displayName = n.querySelector('DisplayName')?.textContent.trim();
          return nutKey === key || displayName === key;
        });
        if (nutrientEl) {
          const valueImposed = nutrientEl.querySelector('ValueImposed')?.textContent.trim() || '0';
          const unit = nutrientEl.querySelector('Unit')?.textContent.trim() || '';
          return { value: Math.round(parseFloat(valueImposed)), unit };
        }
        return null;
      };

      const calories = findNutrient('Calories');
      const totalFat = findNutrient('Total Fat');
      const totalCarbs = findNutrient('Carbohydrates');
      const dietaryFiber = findNutrient('Dietary Fiber');
      const sugars = findNutrient('Sugar');
      const protein = findNutrient('Protein');
      const cholesterol = findNutrient('Cholesterol');
      const sodium = findNutrient('Sodium');

      if (portionSize) {
        const nutritionItems = [];
        if (calories) nutritionItems.push(`<li>Calories: ${calories.value}</li>`);
        if (totalFat) nutritionItems.push(`<li>Total Fat: ${totalFat.value}${totalFat.unit}</li>`);
        if (totalCarbs) {
          nutritionItems.push(`<li>Total Carbohydrate: ${totalCarbs.value}${totalCarbs.unit}`);
          const subItems = [];
          if (dietaryFiber) subItems.push(`<li>Dietary Fiber: ${dietaryFiber.value}${dietaryFiber.unit}</li>`);
          if (sugars) subItems.push(`<li>Sugars: ${sugars.value}${sugars.unit}</li>`);
          if (subItems.length > 0) {
            nutritionItems.push(`<ul>${subItems.join('')}</ul>`);
          }
          nutritionItems.push('</li>');
        }
        if (protein) nutritionItems.push(`<li>Protein: ${protein.value}${protein.unit}</li>`);
        if (cholesterol) nutritionItems.push(`<li>Cholesterol: ${cholesterol.value}${cholesterol.unit}</li>`);
        if (sodium) nutritionItems.push(`<li>Sodium: ${sodium.value}${sodium.unit}</li>`);

        if (nutritionItems.length > 0) {
          nutritionHtml = `
            <h2>Nutrition</h2>
            <p>${portionSize}</p>
            <ul>
              ${nutritionItems.join('')}
            </ul>
          `;
        }
      }
    }

    // Display recipe info and raw XML in textarea
    detailContent.innerHTML = `
      <div class="recipe">
        ${recipeImageSrc ? `<img src="${recipeImageSrc}" alt="${recipeName}" />` : ''}
        <h1>${recipeName}</h1>
        ${recipeDescription ? `<p>${recipeDescription}</p>` : ''}
        ${ingredientsHtml}
        ${directionsHtml}
        ${notesHtml}
        ${nutritionHtml}
        ${metadataRows ? `
          <table>
            <thead>
              <tr>
                <th colspan="2">Metadata</th>
              </tr>
            </thead>
            <tbody>
              ${metadataRows}
            </tbody>
          </table>
        ` : ''}
      </div>
      <textarea id="recipe-xml" readonly>${xmlResponse}</textarea>
    `;

    detailLoading.classList.remove('active');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error fetching recipe details:', error);
    detailContent.innerHTML = `<p class="error">Failed to load recipe details: ${error.message}</p>`;
    detailLoading.classList.remove('active');
  }
}

// Display results
export function displayResults(data, rawXml) {
  const resultsDiv = document.getElementById('results');
  const responseDataPre = document.getElementById('responseData');
  const recipeCount = document.getElementById('recipeCount');
  const recipeList = document.getElementById('recipeList');
  const params = getQueryParams();

  // Parse XML and display recipes
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(rawXml, 'text/xml');
    const recipes = xmlDoc.querySelectorAll('Recipes');

    recipeCount.textContent = `Recipes found: ${recipes.length}`;

    // Clear previous results
    recipeList.innerHTML = '';

    // Create list items for each recipe
    recipes.forEach((recipe) => {
      const code = recipe.getAttribute('Code');
      const number = recipe.getAttribute('Number');
      const name = recipe.getAttribute('Name');
      const status = recipe.getAttribute('Status');
      const dateCreated = recipe.getAttribute('DateCreated');
      const dateUpdated = recipe.getAttribute('DateUpdated');

      // Get brands
      const brands = recipe.querySelectorAll('Brand');

      // Create recipe item
      const recipeItem = document.createElement('div');
      recipeItem.className = 'recipe-item';

      // Status class
      const statusClass = status.toLowerCase();

      recipeItem.innerHTML = `
        <div class="recipe-header">
          <h3 class="recipe-title">${name}</h3>
          <span class="recipe-status ${statusClass}">${status}</span>
        </div>
        <div class="recipe-meta">
          <span><strong>Code:</strong> ${code}</span>
          <span><strong>Number:</strong> ${number}</span>
          <span><strong>Created:</strong> ${new Date(dateCreated).toISOString()}</span>
          <span><strong>Updated:</strong> ${new Date(dateUpdated).toISOString()}</span>
        </div>
        ${brands.length > 0 ? `
          <div class="recipe-brands">
            <div class="recipe-brands-title">Brands:</div>
            <div class="brand-list">
              ${Array.from(brands).map((brand) => {
    const brandName = brand.querySelector('BrandName')?.textContent || 'Unknown';
    const classification = brand.querySelector('Classification')?.textContent || '';
    const isPrimary = classification.toLowerCase() === 'primary';
    return `<span class="brand-tag ${isPrimary ? 'primary' : ''}">${brandName}</span>`;
  }).join('')}
            </div>
          </div>
        ` : ''}
        <div class="recipe-actions">
          <a href="?user=${encodeURIComponent(params.user)}&pw=${encodeURIComponent(params.pw)}&date=${encodeURIComponent(params.date)}&recipe=${encodeURIComponent(number)}&status=${encodeURIComponent(status)}&dateCreated=${encodeURIComponent(dateCreated)}&dateUpdated=${encodeURIComponent(dateUpdated)}" class="btn-view-details">View Details</a>
        </div>
      `;

      recipeList.appendChild(recipeItem);
    });

    // Store raw XML
    responseDataPre.textContent = rawXml;
    resultsDiv.classList.add('active');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Error parsing recipes:', e);
    showError(`Error parsing response: ${e.message}`);
  }
}

// Toggle raw XML display
export function toggleRawXML() {
  const responseDataPre = document.getElementById('responseData');
  const toggleBtn = document.getElementById('toggleBtn');

  if (responseDataPre.style.display === 'none') {
    responseDataPre.style.display = 'block';
    toggleBtn.textContent = 'Hide Raw XML';
  } else {
    responseDataPre.style.display = 'none';
    toggleBtn.textContent = 'Show Raw XML';
  }
}

// Copy to clipboard
export function copyToClipboard() {
  const responseData = document.getElementById('responseData').textContent;
  navigator.clipboard.writeText(responseData).then(() => {
    // eslint-disable-next-line no-alert
    alert('Copied to clipboard!');
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to copy:', err);
    // eslint-disable-next-line no-alert
    alert('Failed to copy to clipboard');
  });
}

// Download XML
export function downloadXML() {
  const responseData = document.getElementById('responseData').textContent;
  const blob = new Blob([responseData], { type: 'text/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vitamix-recipes-${new Date().toISOString().split('T')[0]}.xml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Make API call if query params are present
export async function makeApiCallFromParams() {
  const params = getQueryParams();

  // Only make API call if user and password are present
  if (!params.user || !params.pw) {
    return;
  }

  const loadingDiv = document.getElementById('loading');
  const submitBtn = document.getElementById('submitBtn');
  const resultsDiv = document.getElementById('results');

  // Reset state
  resultsDiv.classList.remove('active');
  document.getElementById('error').classList.remove('active');

  // Show loading
  loadingDiv.classList.add('active');
  submitBtn.disabled = true;

  try {
    const xmlResponse = await fetchRecipes(params.user, params.pw, params.date);
    displayResults(null, xmlResponse);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error:', error);
    showError(`Error: ${error.message}`);
  } finally {
    loadingDiv.classList.remove('active');
    submitBtn.disabled = false;
  }
}

// Initialize on page load
export async function init() {
  const params = getQueryParams();

  // Attach event listeners
  document.getElementById('toggleBtn').addEventListener('click', toggleRawXML);
  document.getElementById('copyBtn').addEventListener('click', copyToClipboard);
  document.getElementById('downloadBtn').addEventListener('click', downloadXML);

  // Add back button listener
  const backBtn = document.getElementById('backToList');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      const url = `?user=${encodeURIComponent(params.user)}&pw=${encodeURIComponent(params.pw)}`;
      const dateParam = params.date ? `&date=${encodeURIComponent(params.date)}` : '';
      window.location.href = url + dateParam;
    });
  }

  initializeForm();

  // Check if we should display recipe details or list
  if (params.recipe) {
    await displayRecipeDetails(params.recipe);
  } else {
    await makeApiCallFromParams();
  }

  // eslint-disable-next-line no-unused-vars, no-undef
  const { context, token, actions } = await DA_SDK;
  // eslint-disable-next-line no-console
  console.log('DA SDK loaded', context, token, actions);
}

init();
