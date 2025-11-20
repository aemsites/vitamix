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

    // Extract Dietary Interests from Keywords section
    const dietaryInterests = [];
    const keywords = xmlDoc.querySelectorAll('Key');
    Array.from(keywords).forEach((key) => {
      const nameParent = key.querySelector('NameParent');
      if (nameParent && nameParent.textContent.trim() === 'Dietary Interest') {
        const name = key.querySelector('Name');
        if (name) {
          dietaryInterests.push(name.textContent.trim());
        }
      }
    });
    const dietaryInterestsStr = dietaryInterests.join(', ');

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

    // Build metadata table rows
    const metadataRows = [
      { name: 'Total Time', value: totalTime },
      { name: 'Yield', value: recipeYield },
      { name: 'Difficulty', value: difficulty },
      { name: 'Compatible Containers', value: compatibleContainersStr },
      { name: 'Dietary Interests', value: dietaryInterestsStr },
    ].filter((row) => row.value).map((row) => `
      <tr>
        <td>${row.name}</td>
        <td>${row.value}</td>
      </tr>
    `).join('');

    // Display recipe info and raw XML in textarea
    detailContent.innerHTML = `
      <div class="recipe">
        <h1>${recipeName}</h1>
        ${recipeDescription ? `<p>${recipeDescription}</p>` : ''}
        ${metadataRows ? `
          <h2>Metadata</h2>
          <table class="metadata-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              ${metadataRows}
            </tbody>
          </table>
        ` : ''}
      </div>
      <textarea id="recipeXML" readonly>${xmlResponse}</textarea>
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
          <span><strong>Created:</strong> ${new Date(dateCreated).toLocaleDateString()}</span>
          <span><strong>Updated:</strong> ${new Date(dateUpdated).toLocaleDateString()}</span>
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
          <a href="?user=${encodeURIComponent(params.user)}&pw=${encodeURIComponent(params.pw)}&recipe=${encodeURIComponent(number)}" class="btn-view-details">View Details</a>
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
      window.location.href = `?user=${encodeURIComponent(params.user)}&pw=${encodeURIComponent(params.pw)}`;
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
