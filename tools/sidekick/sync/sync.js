import {
  buildBlock, decorateBlock, loadBlock, loadCSS,
} from '../../../scripts/aem.js';

const SYNC_WORKER_URL = 'https://vitamix-catalog-sync.adobeaem.workers.dev/';

/**
 * Creates a product sync modal dialog
 *
 * @returns {Promise<{dialog: HTMLDialogElement, showModal: () => Promise<void>}>}
 */
export async function createSyncModal() {
  await loadCSS(`${window.hlx.codeBasePath}/blocks/modal/modal.css`);
  await loadCSS('https://main--vitamix--aemsites.aem.page/tools/sidekick/sync/sync.css');

  const dialog = document.createElement('dialog');
  const dialogContent = document.createElement('div');
  dialogContent.classList.add('modal-content');

  const urlPath = window.location.pathname;
  const pathParts = urlPath.split('/').filter((part) => part); // Remove empty strings

  // Expected format: /ca/en_us/products/ascent-x5
  const defaultStoreCode = pathParts[0] || '';
  const defaultStoreViewCode = pathParts[1] || '';
  const defaultUrlKey = pathParts[3] || '';

  // pull the sku from the sku meta tag
  const skuMeta = document.querySelector('meta[name="sku"]');
  const defaultSku = skuMeta ? skuMeta.content : '';

  const h3 = document.createElement('h3');
  h3.textContent = 'Product Sync';
  dialogContent.append(h3);

  // Create mode selector (tabs)
  const modeSelector = document.createElement('div');
  modeSelector.classList.add('sync-mode-selector');
  modeSelector.innerHTML = `
    <button type="button" class="mode-tab active" data-mode="sync-sku">Sync SKU</button>
    <button type="button" class="mode-tab" data-mode="sync-all">Sync All</button>
  `;
  dialogContent.append(modeSelector);

  // Create Sync SKU form
  const syncSkuForm = document.createElement('form');
  syncSkuForm.classList.add('sync-form', 'sync-sku-form', 'active');
  syncSkuForm.innerHTML = `
    <div class="form-group">
      <label for="sync-store-code">Store Code:</label>
      <input type="text" id="sync-store-code" name="storeCode" value="${defaultStoreCode}" required>
    </div>
    <div class="form-group">
      <label for="sync-store-view-code">Store View Code:</label>
      <input type="text" id="sync-store-view-code" name="storeViewCode" value="${defaultStoreViewCode}" required>
    </div>
    <div class="form-group">
      <label for="sync-sku">SKU:</label>
      <input type="text" id="sync-sku" name="sku" value="${defaultSku}" placeholder="Leave empty if using URL Key">
    </div>
    <div class="form-group">
      <label for="sync-url-key">URL Key:</label>
      <input type="text" id="sync-url-key" name="urlKey" value="${!defaultSku ? defaultUrlKey : ''}" placeholder="Leave empty if using SKU">
    </div>
    <button type="submit" class="sync-submit-button">Sync Product</button>
  `;
  dialogContent.append(syncSkuForm);

  // Create Sync All form
  const syncAllForm = document.createElement('form');
  syncAllForm.classList.add('sync-form', 'sync-all-form');
  syncAllForm.innerHTML = `
    <div class="form-group">
      <label>
        <input type="radio" name="syncAllMode" value="all-stores" checked>
        Sync All Stores
      </label>
    </div>
    <div class="form-group">
      <label>
        <input type="radio" name="syncAllMode" value="single-store">
        Sync Single Store
      </label>
    </div>
    <div class="single-store-inputs" style="display: none;">
      <div class="form-group">
        <label for="sync-all-store-code">Store Code:</label>
        <input type="text" id="sync-all-store-code" name="storeCode" value="${defaultStoreCode}">
      </div>
      <div class="form-group">
        <label for="sync-all-store-view-code">Store View Code:</label>
        <input type="text" id="sync-all-store-view-code" name="storeViewCode" value="${defaultStoreViewCode}">
      </div>
    </div>
    <button type="submit" class="sync-submit-button">Start Sync</button>
  `;
  dialogContent.append(syncAllForm);

  // Create status container
  const statusContainer = document.createElement('div');
  statusContainer.classList.add('sync-status');
  dialogContent.append(statusContainer);

  dialog.append(dialogContent);

  const closeButton = document.createElement('button');
  closeButton.classList.add('close-button');
  closeButton.setAttribute('aria-label', 'Close');
  closeButton.setAttribute('data-label', 'Close');
  closeButton.type = 'button';
  closeButton.innerHTML = '<span class="icon icon-close"></span>';
  closeButton.addEventListener('click', () => dialog.close());
  dialog.prepend(closeButton);

  const block = buildBlock('modal', '');
  document.querySelector('main').append(block);
  decorateBlock(block);
  await loadBlock(block);

  dialog.addEventListener('close', () => {
    document.body.classList.remove('modal-open');
  });

  block.innerHTML = '';
  block.id = 'sync';
  block.append(dialog);

  // Mode tab switching
  const modeTabs = modeSelector.querySelectorAll('.mode-tab');
  modeTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      // Update active tab
      modeTabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      // Show/hide forms
      const { mode } = tab.dataset;
      syncSkuForm.classList.toggle('active', mode === 'sync-sku');
      syncAllForm.classList.toggle('active', mode === 'sync-all');

      // Clear status
      statusContainer.innerHTML = '';
    });
  });

  // Toggle single store inputs in Sync All form
  const syncAllModeRadios = syncAllForm.querySelectorAll('input[name="syncAllMode"]');
  const singleStoreInputs = syncAllForm.querySelector('.single-store-inputs');
  syncAllModeRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      singleStoreInputs.style.display = radio.value === 'single-store' ? 'block' : 'none';
    });
  });

  // Function to call the worker
  async function performSync(data, syncType) {
    // Show spinner
    const syncingMessage = syncType === 'sync-all' ? 'Syncing stores...' : 'Syncing product...';
    statusContainer.innerHTML = `
      <div class="spinner-container">
        <div class="spinner"></div>
        <p>${syncingMessage}</p>
      </div>
    `;

    try {
      // Call the worker endpoint
      const response = await fetch(SYNC_WORKER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if ((response.ok && result.success) || response.status === 201) {
        // Success
        const reloadButtonHtml = syncType === 'sync-sku'
          ? '<button type="button" class="reload-button">Reload Page</button>'
          : '';

        statusContainer.innerHTML = `
          <div>
            <h3 class="sync-success">Success!</h3>
            <p>${result.message}</p>
            ${reloadButtonHtml}
          </div>
        `;

        if (syncType === 'sync-sku') {
          const reloadButton = statusContainer.querySelector('.reload-button');
          reloadButton.addEventListener('click', () => {
            window.location.reload(true); // true forces a hard reload from server
          });
        }
      } else {
        // Failure
        statusContainer.innerHTML = `
          <div class="sync-error">
            <h3>Sync Failed</h3>
            <p><strong>Error:</strong> ${result.error || 'Unknown error'}</p>
            ${result.message ? `<p><strong>Details:</strong> ${result.message}</p>` : ''}
          </div>
        `;
      }
    } catch (error) {
      // Network or other error
      statusContainer.innerHTML = `
        <div class="sync-error">
          <h3>Sync Failed</h3>
          <p><strong>Error:</strong> Network error</p>
          <p><strong>Details:</strong> ${error.message}</p>
        </div>
      `;
    }
  }

  // Handle Sync SKU form submission
  syncSkuForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(syncSkuForm);
    const data = {
      storeCode: formData.get('storeCode'),
      storeViewCode: formData.get('storeViewCode'),
      sku: formData.get('sku') || undefined,
      urlKey: formData.get('urlKey') || undefined,
    };

    // Validate that at least sku or urlKey is provided
    if (!data.sku && !data.urlKey) {
      statusContainer.innerHTML = `
        <div class="sync-error">
          <h3>Validation Error</h3>
          <p>Please provide either a SKU or URL Key.</p>
        </div>
      `;
      return;
    }

    // Remove undefined values
    Object.keys(data).forEach((key) => data[key] === undefined && delete data[key]);

    await performSync(data, 'sync-sku');
  });

  // Handle Sync All form submission
  syncAllForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(syncAllForm);
    const syncAllMode = formData.get('syncAllMode');

    let data;
    if (syncAllMode === 'all-stores') {
      data = { syncAll: true };
    } else {
      const storeCode = formData.get('storeCode');
      const storeViewCode = formData.get('storeViewCode');

      if (!storeCode || !storeViewCode) {
        statusContainer.innerHTML = `
          <div class="sync-error">
            <h3>Validation Error</h3>
            <p>Please provide both Store Code and Store View Code for single store sync.</p>
          </div>
        `;
        return;
      }

      data = {
        syncAll: true,
        storeCode,
        storeViewCode,
      };
    }

    await performSync(data, 'sync-all');
  });

  return {
    dialog,
    showModal: async () => {
      dialog.showModal();
      document.body.classList.add('modal-open');
    },
  };
}

export async function openSyncModal() {
  const { dialog, showModal } = await createSyncModal();
  showModal();
  return dialog;
}
