import { getMetadata } from '../../scripts/aem.js';
import { checkVariantOutOfStock } from '../../scripts/scripts.js';

/**
 * Renders "Find Locally" button container.
 * @param {HTMLElement} block - PDP block element
 * @returns {HTMLElement} Container div with the "Find Locally" button
 */
function renderFindLocally(block) {
  const findLocallyContainer = document.createElement('div');
  findLocallyContainer.classList.add('add-to-cart');
  findLocallyContainer.innerHTML = `<a
    class="button emphasis pdp-find-locally-button"
    href="https://www.vitamix.com/us/en_us/where-to-buy?productFamily=&productType=HH">Find Locally</a>`;
  block.classList.add('pdp-find-locally');
  return findLocallyContainer;
}

/**
 * Renders a "Find Dealer" button container.
 * @param {HTMLElement} block - PDP block element
 * @returns {HTMLElement} Container div with "Find Dealer" button and expert consultation link
 */
function renderFindDealer(block) {
  const findDealerContainer = document.createElement('div');
  findDealerContainer.classList.add('add-to-cart');
  findDealerContainer.innerHTML = `<a
    class="button emphasis pdp-find-locally-button"
    href="https://www.vitamix.com/us/en_us/where-to-buy?productFamily=2205202&productType=COMM">Find Dealer</a>
  <p>
    <a
      href="https://www.vitamix.com/us/en_us/commercial/resources/consult-an-expert">Have a question? Consult an expert.</a>
  </p>`;
  block.classList.add('pdp-find-dealer');
  return findDealerContainer;
}

/**
 * Toggles "fixed" class on "Add to Cart" container when the user scrolls.
 * @param {HTMLElement} container - "Add to Cart" container
 */
function toggleFixedAddToCart(container) {
  const rootStyles = getComputedStyle(document.documentElement);
  const headerHeight = parseInt(rootStyles.getPropertyValue('--header-height'), 10) || 0;

  window.addEventListener('scroll', () => {
    // disable fixed behavior on desktop
    if (window.innerWidth >= 900) {
      container.classList.remove('fixed');
      container.removeAttribute('style');
      return;
    }

    const { scrollY } = window;
    const offset = Math.max(headerHeight - scrollY, 0);

    // apply or remove "fixed" class and dynamic top offset
    if (scrollY > 0) {
      container.classList.add('fixed');
      container.style.top = `${offset}px`;
    } else {
      container.classList.remove('fixed');
      container.removeAttribute('style');
    }
  });
}

/**
 * Checks if a variant is available for sale.
 * @param {Object} variant - The variant object
 * @returns {boolean} True if the variant is available for sale, false otherwise
 */
export function isVariantAvailableForSale(variant) {
  const { managedStock, addToCart } = variant.custom;
  if (!variant || addToCart === 'No') {
    return false;
  }

  if (managedStock === '0') {
    return true;
  }

  return !checkVariantOutOfStock(variant.sku);
}

/**
 * Renders the main add to cart functionality with quantity selector and add to cart button.
 * Handles product variants, warranties, bundles, and cart integration with Magento.
 * Falls back to "Find Locally" or "Find Dealer" buttons based on product configuration.
 * @param {HTMLElement} block - PDP block element
 * @param {Object} parent - Parent product object
 * @returns {HTMLElement} Container div with either add to cart functionality or alternative buttons
 */
export default function renderAddToCart(block, parent) {
  // Default selectedVariant to parent product, if simple product, selectedVariant will be undefined
  // TODO: this should be fixed with https://github.com/aemsites/vitamix/issues/185
  let selectedVariant = parent.offers?.[0]?.custom ? parent.offers[0] : parent;
  if (window.selectedVariant) {
    // If we actually have a selected variant, use it instead of the parent product
    const { sku: selectedSku } = window.selectedVariant;
    selectedVariant = parent.offers.find((variant) => variant.sku === selectedSku);
  }

  // Only look at findLocally and findDealer from parent product
  const { findLocally, findDealer } = parent;
  block.classList.remove('pdp-find-locally');
  block.classList.remove('pdp-find-dealer');

  // Figure out if the selected variant is available for sale
  const isAvailableForSale = isVariantAvailableForSale(selectedVariant);

  // If the parent product is a bundle and is out of stock, return an empty string
  if (parent.custom.type === 'bundle' && parent.custom.parentAvailability === 'OutOfStock') {
    return '';
  }

  // If we have a selected variant, use it's custom object,
  // otherwise use the parent product's custom object
  const { custom } = selectedVariant || parent;
  const { managedStock } = custom;

  // When Manage Stock = 1 (for the variant) and the product is marked Out of Stock,
  // we always show the "Find Locally" button,
  // regardless of whether findLocally or findDealer is set to true or false.
  if (managedStock === '1' && !isAvailableForSale) {
    return renderFindLocally(block);
  }

  //  check if product should show "Find Locally" instead of add to cart if:
  // findLocally is enabled, findDealer is enabled but not commercial, OR product is out of stock
  if (findLocally === 'Yes' && !isAvailableForSale) {
    return renderFindLocally(block);
  }

  // check if product should show "Find Dealer" instead of add to cart
  if (findDealer === 'Yes' && !isAvailableForSale) {
    return renderFindDealer(block);
  }

  // create main add to cart container
  const addToCartContainer = document.createElement('div');
  addToCartContainer.classList.add('add-to-cart');

  toggleFixedAddToCart(addToCartContainer);

  // create and configure quantity label
  const quantityLabel = document.createElement('label');
  quantityLabel.textContent = 'Quantity:';
  quantityLabel.classList.add('pdp-quantity-label');
  quantityLabel.htmlFor = 'pdp-quantity-select';
  addToCartContainer.appendChild(quantityLabel);

  // create quantity selection container and dropdown
  const quantityContainer = document.createElement('div');
  quantityContainer.classList.add('quantity-container');
  const quantitySelect = document.createElement('select');
  quantitySelect.id = 'pdp-quantity-select';

  // set maximum quantity (default to 3 if not specified)
  const maxQuantity = custom.maxCartQty ? +custom.maxCartQty : 3;

  // populate quantity dropdown with options from 1 to maxQuantity
  for (let i = 1; i <= maxQuantity; i += 1) {
    const option = document.createElement('option');
    option.value = i;
    option.textContent = i;
    quantitySelect.appendChild(option);
  }
  quantityContainer.appendChild(quantitySelect);

  // create and configure add to cart button
  const addToCartButton = document.createElement('button');
  addToCartButton.textContent = 'Add to Cart';

  // add click event handler for add to cart functionality
  addToCartButton.addEventListener('click', async () => {
    // update button state to show loading
    addToCartButton.textContent = 'Adding...';
    addToCartButton.setAttribute('aria-disabled', 'true');

    // import required modules for cart functionality
    const { cartApi } = await import('../../scripts/minicart/api.js');
    const { updateMagentoCacheSections, getMagentoCache } = await import('../../scripts/storage/util.js');

    // cCheck and update customer cache if needed
    const currentCache = getMagentoCache();
    if (!currentCache?.customer) {
      await updateMagentoCacheSections(['customer']);
    }

    // get selected quantity and product SKU
    const quantity = document.querySelector('.quantity-container select')?.value || 1;
    const sku = getMetadata('sku');

    // build array of selected options (variants, warranties, required bundles)
    const selectedOptions = [];

    // add selected variant option if available
    if (window.selectedVariant?.options?.uid) {
      selectedOptions.push(window.selectedVariant.options.uid);
    }

    // add selected warranty if available
    if (window.selectedWarranty?.uid) {
      selectedOptions.push(window.selectedWarranty.uid);
    }

    // add any required bundle options
    if (parent.custom && parent.custom.requiredBundleOptions) {
      selectedOptions.push(...parent.custom.requiredBundleOptions);
    }

    try {
      // add product to cart with selected options and quantity
      await cartApi.addToCart(sku, selectedOptions, quantity);

      // redirect to cart page after successful addition
      window.location.href = '/us/en_us/checkout/cart/';
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to add item to cart', error);
    } finally {
      // update button state to show ATC
      addToCartButton.textContent = 'Add to Cart';
      addToCartButton.removeAttribute('aria-disabled');
    }
  });

  // assemble the quantity container with select and button
  quantityContainer.appendChild(addToCartButton);

  // add quantity container to main add to cart container
  addToCartContainer.appendChild(quantityContainer);

  return addToCartContainer;
}
