import { getMetadata } from '../../scripts/aem.js';
import { checkVariantOutOfStock, getLocaleAndLanguage } from '../../scripts/scripts.js';
import { getConfig } from '../../scripts/commerce-config.js';

/**
 * Renders "Find Locally" button container.
 * @param {Object} ph - Placeholders object
 * @param {HTMLElement} block - PDP block element
 * @returns {HTMLElement} Container div with the "Find Locally" button
 */
function renderFindLocally(ph, block) {
  const { locale, language } = getLocaleAndLanguage();
  const findLocallyContainer = document.createElement('div');
  findLocallyContainer.classList.add('add-to-cart');
  findLocallyContainer.innerHTML = `<a
    class="button emphasis pdp-find-locally-button"
    href="https://www.vitamix.com/${locale}/${language}/where-to-buy?productFamily=&productType=HH">${ph.findLocally || 'Find Locally'}</a>`;
  block.classList.add('pdp-find-locally');
  return findLocallyContainer;
}

/**
 * Renders a "Find Dealer" button container.
 * @param {Object} ph - Placeholders object
 * @param {HTMLElement} block - PDP block element
 * @returns {HTMLElement} Container div with "Find Dealer" button and expert consultation link
 */
function renderFindDealer(ph, block) {
  const { locale, language } = getLocaleAndLanguage();
  const findDealerContainer = document.createElement('div');
  findDealerContainer.classList.add('add-to-cart');
  findDealerContainer.innerHTML = `<a
    class="button emphasis pdp-find-locally-button"
    href="https://www.vitamix.com/${locale}/${language}/where-to-buy?productFamily=2205202&productType=COMM">${ph.findDealer || 'Find Dealer'}</a>
  <p>
    <a
      href="https://www.vitamix.com/${locale}/${language}/commercial/resources/consult-an-expert">${ph.consultAnExpert || 'Have a question? Consult an expert.'}</a>
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

      if (offset > 0) {
        container.style.top = `${offset}px`;
      } else {
        container.style.removeProperty('top');
      }
    } else {
      container.classList.remove('fixed');
      container.removeAttribute('style');
    }
  });
}

/**
 * Returns how many units may be added given what is already in the cart.
 * @param {number} requested - Quantity the user selected
 * @param {number} existing - Quantity already in the cart for this SKU
 * @param {number} max - Per-product maximum allowed quantity
 * @returns {number}
 */
export function computeAllowedQty(requested, existing, max) {
  return Math.max(0, Math.min(requested, max - existing));
}

/**
 * Normalize a price into a number for the edge cart line item.
 * Offers expose a flat numeric price (string or number); simple products
 * without offers expose the Product Bus shape `{ currency, regular, final }`.
 * Returns `NaN` if no usable value can be extracted.
 * @param {string|number|{final?: string|number, regular?: string|number}} value
 * @returns {number}
 */
export function normalizeCartPrice(value) {
  if (value && typeof value === 'object') {
    return String(value.final ?? value.regular);
  }
  return String(value);
}

/**
 * Extract shippingDimensions from a JSON-LD Offer's `shippingDetails`, converting
 * each schema.org `QuantitativeValue` back to the Product Bus `{ value, unit }` shape
 * the Commerce API expects on cart items. Returns `undefined` when the offer has no
 * shipping data, so callers can spread it conditionally onto the cart item.
 *
 * The pipeline preserves the original unit on `unitText` (e.g. `"lb"`) for this
 * round-trip, distinct from the UN/CEFACT `unitCode` (e.g. `"LBR"`).
 *
 * @param {Object} offer - A schema.org Offer object from the page JSON-LD
 * @returns {{weight: {value: number, unit: string}} | undefined}
 */
export function shippingDimensionsFromOffer(offer) {
  const w = offer?.shippingDetails?.weight;
  if (!w || typeof w.value !== 'number' || !w.unitText) return undefined;
  return { weight: { value: w.value, unit: w.unitText } };
}

function getCartCompatibility(parent) {
  const { type, compatibleWith, compatibilityGroup } = parent.custom || {};
  if (!compatibleWith && !compatibilityGroup) return null;
  return {
    ...(type ? { type } : {}),
    ...(compatibleWith ? { compatibleWith } : {}),
    ...(compatibilityGroup ? { compatibilityGroup } : {}),
  };
}

/**
 * Checks if a variant is available for sale.
 * @param {Object} variant - The variant object
 * @returns {boolean} True if the variant is available for sale, false otherwise
 */
export function isVariantAvailableForSale(variant) {
  if (getMetadata('addToCart') === 'No') {
    return false;
  }

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
export default function renderAddToCart(ph, block, parent) {
  // Default selectedVariant to parent product, if simple product, selectedVariant will be undefined
  // TODO: this should be fixed with https://github.com/aemsites/vitamix/issues/185
  let selectedVariant = parent.offers?.[0]?.custom ? parent.offers[0] : parent;
  if (window.selectedVariant) {
    // If we actually have a selected variant, use it instead of the parent product
    const { sku: selectedSku } = window.selectedVariant;
    selectedVariant = parent.offers.find((variant) => variant.sku === selectedSku);
  }

  // Only look at findLocally and findDealer from parent product
  const { findLocally, findDealer } = parent.custom;
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
    return renderFindLocally(ph, block);
  }

  //  check if product should show "Find Locally" instead of add to cart if:
  // findLocally is enabled, findDealer is enabled but not commercial, OR product is out of stock
  if (findLocally === 'Yes' && !isAvailableForSale) {
    return renderFindLocally(ph, block);
  }

  // check if product should show "Find Dealer" instead of add to cart
  if (findDealer === 'Yes' && !isAvailableForSale) {
    return renderFindDealer(ph, block);
  }

  // create main add to cart container
  const addToCartContainer = document.createElement('div');
  addToCartContainer.classList.add('add-to-cart');

  toggleFixedAddToCart(addToCartContainer);

  // create and configure quantity label
  const quantityLabel = document.createElement('label');
  quantityLabel.textContent = `${ph.quantity || 'Quantity'}:`;
  quantityLabel.classList.add('pdp-quantity-label');
  quantityLabel.htmlFor = 'pdp-quantity-select';
  addToCartContainer.appendChild(quantityLabel);

  // create quantity selection container and dropdown
  const quantityContainer = document.createElement('div');
  quantityContainer.classList.add('quantity-container');
  const quantitySelect = document.createElement('select');
  quantitySelect.id = 'pdp-quantity-select';

  // per-product override (custom.maxCartQty) wins, otherwise use the global
  // commerce-config default
  const maxQuantity = custom.maxCartQty ? +custom.maxCartQty : (getConfig().maxCartQty || 3);

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
  addToCartButton.textContent = ph.addToCart || 'Add to Cart';

  // add click event handler for add to cart functionality
  addToCartButton.addEventListener('click', async () => {
    // update button state to show loading
    addToCartButton.textContent = ph.adding || 'Adding...';
    addToCartButton.setAttribute('aria-disabled', 'true');

    // get selected quantity and product SKU
    const quantity = quantitySelect.value || 1;
    const sku = getMetadata('sku');

    // Magento-format selectedOptions (base64 UIDs). Used only by the Magento
    // branch below. The edge branch builds semantic {id, value} options inline.
    const selectedOptions = [];
    if (window.selectedVariant?.options?.uid) {
      selectedOptions.push(window.selectedVariant.options.uid);
    }
    if (window.selectedWarranty?.uid) {
      selectedOptions.push(window.selectedWarranty.uid);
    }
    if (parent.custom && parent.custom.requiredBundleOptions) {
      selectedOptions.push(...parent.custom.requiredBundleOptions);
    }

    try {
      if (window.useEdgeCheckout) {
        const cartApi = (await import('../../scripts/cart.js')).default;

        const { sku: variantSku } = selectedVariant;
        const targetSku = variantSku ?? sku;

        // Clamp requested quantity so the cart line never exceeds maxQuantity.
        const requestedQty = parseInt(quantity, 10);
        const existingQty = cartApi.items.find((i) => i.sku === targetSku)?.quantity ?? 0;
        const allowedQty = computeAllowedQty(requestedQty, existingQty, maxQuantity);
        if (allowedQty <= 0) {
          window.cartQtyLimitAlerts ||= new Set();
          window.cartQtyLimitAlerts.add(targetSku);
          document.dispatchEvent(new CustomEvent('cart:limit', {
            detail: { sku: targetSku },
          }));
          document.dispatchEvent(new CustomEvent('pdp:add-to-cart', {
            detail: {
              item: { sku: targetSku },
              overLimit: true,
            },
          }));
          addToCartButton.textContent = ph.addToCart || 'Add to Cart';
          addToCartButton.removeAttribute('aria-disabled');
          return;
        }

        // Prefer the selected variant's price so variant-specific pricing
        // wins; fall back to offers[0] for simple products, where
        // selectedVariant is the parent and has no top-level price.
        const rawPrice = selectedVariant.price ?? parent.offers?.[0]?.price;
        const price = normalizeCartPrice(rawPrice);

        // Semantic {id, value} options for the edge cart. The edge cart
        // carries no Magento-specific data — UIDs stay on the Magento side.
        const semanticOptions = window.selectedVariant?.options
          ? Object.entries(window.selectedVariant.options)
            .filter(([k]) => k !== 'uid' && k !== 'name')
            .map(([id, value]) => ({ id, value }))
          : [];

        // Normalize warranty options from Product Bus into the cart convention.
        // Stashed whenever the product has any warranty options — the cart-page
        // selector renders the default tier as a read-only "(included)" line
        // for transparency even when there are no paid upgrades. Paid tiers
        // carry `path` referencing the published warranty product so the
        // Commerce API can validate the line's price.
        const warrantyOptions = (parent.custom?.options ?? []).map((opt) => ({
          sku: opt.sku,
          name: opt.name,
          price: opt.finalPrice ?? opt.price,
          ...(opt.path ? { path: opt.path } : {}),
          ...(opt.coverageYears ? { coverageYears: opt.coverageYears } : {}),
          ...(parseFloat(opt.finalPrice ?? opt.price) === 0 ? { isDefault: true } : {}),
        }));
        const availableWarranties = warrantyOptions.length > 0 ? warrantyOptions : null;
        const compatibility = getCartCompatibility(parent);

        // For simple products, `selectedVariant === parent` and shippingDetails
        // lives on the auto-generated single Offer; for variants it lives on
        // the variant offer itself. Read from the variant first, fall back to
        // the parent's first Offer for the simple-product case.
        const shippingDimensions = shippingDimensionsFromOffer(selectedVariant)
          ?? shippingDimensionsFromOffer(parent.offers?.[0]);

        const item = {
          sku: targetSku,
          parentSku: variantSku ? sku : undefined,
          quantity: allowedQty,
          price,
          name: parent.name,
          url: selectedVariant.url,
          path: new URL(selectedVariant.url).pathname,
          // Variant may not declare its own image (e.g. a bundle's first color
          // variant whose source `images` array is empty); fall back to the
          // parent product's first image.
          image: selectedVariant.image?.[0] ?? parent.image?.[0],
          variant: window.selectedVariant?.options?.color || '',
          selectedOptions: semanticOptions,
          ...(parent.bundleItems ? { bundleItems: parent.bundleItems } : {}),
          ...((availableWarranties || compatibility) ? {
            local: {
              ...(availableWarranties ? { availableWarranties } : {}),
              ...(compatibility ? { compatibility } : {}),
            },
          } : {}),
          ...(shippingDimensions ? { shippingDimensions } : {}),
        };
        await cartApi.addItem(item);

        // If the PDP warranty selector has a paid tier selected, commit it
        // as a paired line item. The cart-page selector reads this state.
        const selectedTier = warrantyOptions
          .find((o) => o.sku === window.selectedWarranty?.sku);
        if (selectedTier && !selectedTier.isDefault) {
          await cartApi.addItem({
            sku: selectedTier.sku,
            path: selectedTier.path,
            quantity: allowedQty,
            price: selectedTier.price,
            name: selectedTier.name,
            custom: {
              linkedTo: targetSku,
              ...(selectedTier.coverageYears
                ? { coverageYears: selectedTier.coverageYears }
                : {}),
            },
            local: { showInCart: false },
          });
        }

        // reenable button
        addToCartButton.textContent = 'Add to Cart';
        addToCartButton.removeAttribute('aria-disabled');
        document.dispatchEvent(new CustomEvent('pdp:add-to-cart', { detail: { item } }));
        return;
      }

      // import required modules for cart functionality
      const { cartApi } = await import('../../scripts/minicart/api.js');
      const { updateMagentoCacheSections, getMagentoCache } = await import('../../scripts/storage/util.js');

      // cCheck and update customer cache if needed
      const currentCache = getMagentoCache();
      if (!currentCache?.customer) {
        await updateMagentoCacheSections(['customer']);
      }

      // add product to cart with selected options and quantity
      await cartApi.addToCart(sku, selectedOptions, quantity);

      // redirect to cart page after successful addition
      const { locale, language } = getLocaleAndLanguage();
      window.location.href = `/${locale}/${language}/checkout/cart/`;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to add item to cart', error);
    } finally {
      // update button state to show ATC
      addToCartButton.textContent = ph.addToCart || 'Add to Cart';
      addToCartButton.removeAttribute('aria-disabled');
    }
  });

  // assemble the quantity container with select and button
  quantityContainer.appendChild(addToCartButton);

  // add quantity container to main add to cart container
  addToCartContainer.appendChild(quantityContainer);

  return addToCartContainer;
}
