import { buildSlide, buildThumbnails } from './gallery.js';
import { rebuildIndices, checkOutOfStock } from '../../scripts/scripts.js';
import { toClassName, getMetadata } from '../../scripts/aem.js';
import renderPricing from './pricing.js';
import renderAddToCart from './add-to-cart.js';

/**
 * Handles the change of an option.
 * @param {Element} block - The PDP block element
 * @param {Array} variants - The variants of the product
 * @param {string} color - The color of the selected option
 */
export function onOptionChange(block, variants, color) {
  if (variants[0].options.color.replace(/\s+/g, '-').toLowerCase() !== color) {
    // eslint-disable-next-line no-restricted-globals
    history.replaceState(null, '', `?color=${color}`);
  } else {
    // eslint-disable-next-line no-restricted-globals
    history.replaceState(null, '', window.location.pathname);
  }

  const selectedOptionLabel = block.querySelector('.selected-option-label');
  const variant = variants.find((colorVariant) => colorVariant.options.color.replace(/\s+/g, '-').toLowerCase() === color);

  const { sku } = variant;
  const oos = checkOutOfStock(sku);
  const buyBox = block.querySelector('.pdp-buy-box');
  buyBox.dataset.oos = oos;
  buyBox.dataset.sku = sku;

  // update pricing
  const pricingContainer = renderPricing(block, variant);
  if (pricingContainer) {
    block.querySelector('.pricing').replaceWith(pricingContainer);
  }

  const variantColor = variant.options.color;
  selectedOptionLabel.textContent = `Color: ${variantColor}`;

  // check if bundle (should skip variant images)
  const bundle = getMetadata('type') === 'bundle';
  let variantImages = bundle ? [] : variant.images || [];
  variantImages = [...variantImages].map((v, i) => {
    const clone = v.cloneNode(true);
    clone.dataset.source = i ? 'variant' : 'lcp';
    return clone;
  });

  const gallery = block.querySelector('.gallery');
  const slides = gallery.querySelector('ul');
  const nav = gallery.querySelector('[role="radiogroup"]');

  // update LCP image(s)
  const lcpSlide = slides.querySelector('[data-source="lcp"]');
  const lcpButton = nav.querySelector('[data-source="lcp"]');
  if (lcpSlide && lcpButton) {
    // measure current <picture> size
    const oldPic = lcpSlide.querySelector('picture');
    const { offsetHeight, offsetWidth } = oldPic;
    const newPic = variantImages[0];
    if (newPic) {
      // temporarily set fixed dimensions to prevent layout shifts
      newPic.style.height = `${offsetHeight}px`;
      newPic.style.width = `${offsetWidth}px`;
      lcpSlide.replaceChildren(newPic);
      const newImg = newPic.querySelector('img');
      // clear temporary inline styles once image loads
      newImg.addEventListener('load', () => newPic.removeAttribute('style'));
    }
  }

  // reset scroll position to the first slide
  slides.scrollTo({ left: 0, behavior: 'smooth' });

  // remove old variant slides and indices
  [slides, nav].forEach((wrapper) => {
    wrapper.querySelectorAll('[data-source="variant"]').forEach((v) => v.remove());
  });

  // rebuild variant slides and insert after LCP
  const lcpSibling = lcpSlide.nextElementSibling;
  variantImages.slice(1).forEach((pic) => { // ignore first (LCP) image, handled previously
    const slide = buildSlide(pic, 'variant');
    if (slide) slides.insertBefore(slide, lcpSibling);
  });

  // rebuild all indices
  rebuildIndices(gallery);
  buildThumbnails(gallery);

  window.selectedVariant = variant;

  // update add to cart
  const addToCartContainer = renderAddToCart(block, window.jsonLdData);
  if (addToCartContainer) {
    block.querySelector('.add-to-cart').replaceWith(addToCartContainer);
  }
}

/**
 * Renders the options section of the PDP block.
 * @param {Element} block - The PDP block element
 * @param {any[]} variants - The variants of the product
 * @param {Record<string, any>} custom - The custom data for the product
 * @returns {Element} The options container element
 */
export function renderOptions(block, variants, custom) {
  const { options } = custom;
  // if there are no variants, don't render anything
  if (!variants || variants.length === 0) {
    return;
  }

  const optionsContainer = document.createElement('div');
  optionsContainer.classList.add('options');

  const selectionContainer = document.createElement('div');
  selectionContainer.classList.add('selection');

  const selectedOptionLabel = document.createElement('div');
  selectedOptionLabel.classList.add('selected-option-label');
  selectedOptionLabel.textContent = `Color: ${variants[0].options.color}`;
  selectionContainer.append(selectedOptionLabel);

  const colors = variants.map((variant) => toClassName(variant.options.color));

  const colorOptions = colors.map((color, index) => {
    const { sku } = variants[index];
    const colorOption = document.createElement('div');
    colorOption.classList.add('pdp-color-swatch');

    const colorSwatch = document.createElement('div');
    colorSwatch.classList.add('pdp-color-inner');
    colorSwatch.style.backgroundColor = `var(--color-${color})`;
    if (checkOutOfStock(sku)) {
      colorSwatch.classList.add('pdp-color-swatch-oos');
    }
    colorOption.append(colorSwatch);

    colorOption.addEventListener('click', () => {
      onOptionChange(block, variants, color);
    });

    return colorOption;
  });

  const colorOptionsContainer = document.createElement('div');
  colorOptionsContainer.classList.add('pdp-color-options');
  colorOptionsContainer.append(...colorOptions);
  selectionContainer.append(colorOptionsContainer);

  optionsContainer.append(selectionContainer);
  const oosMessage = document.createElement('div');
  oosMessage.classList.add('pdp-oos-message');
  oosMessage.textContent = 'This color is temporarily out of stock.';
  optionsContainer.append(oosMessage);

  if (options && options.length > 0) {
    const warrantyContainer = document.createElement('div');
    warrantyContainer.classList.add('warranty');

    const warrantyHeading = document.createElement('div');
    warrantyHeading.textContent = 'Warranty:';
    warrantyContainer.append(warrantyHeading);

    options.forEach((option, i) => {
      const formatPrice = (price) => {
        if (price) {
          return `$${price.toFixed(2)}`;
        }
        return 'Free';
      };
      const warrantyValue = document.createElement('div');
      warrantyValue.classList.add('pdp-warranty-option');
      warrantyValue.textContent = `${option.name} (${formatPrice(+option.finalPrice)})`;
      if (options.length > 1) {
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'warranty';
        radio.value = option.name;
        if (i === 0) {
          radio.checked = true;
        }
        warrantyValue.prepend(radio);

        radio.addEventListener('change', () => {
          window.selectedWarranty = option;
        });
      }
      warrantyContainer.append(warrantyValue);
    });
    // set default warranty
    [window.selectedWarranty] = options;

    optionsContainer.append(warrantyContainer);
  }

  // eslint-disable-next-line consistent-return
  return optionsContainer;
}
