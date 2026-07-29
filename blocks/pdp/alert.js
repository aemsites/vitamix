import { getOfferPricing } from '../../scripts/scripts.js';

/**
 * Renders the PDP status or promotional alert.
 * @param {Object} ph - Placeholders object
 * @param {HTMLElement} block - PDP block element
 * @param {Object} custom - Parent product custom data
 * @param {Object} variantCustom - Selected variant custom data
 * @returns {HTMLElement|null} Alert element, or null when no alert applies
 */
export function renderAlert(ph, block, custom, variantCustom) {
  const alertContainer = document.createElement('div');
  alertContainer.classList.add('pdp-alert');
  block.classList.remove('pdp-coming-soon');

  if (custom && custom.retired === 'Yes') {
    alertContainer.innerText = ph.retiredProduct || 'Retired Product';
    block.classList.add('pdp-retired');
    block.dataset.alert = true;
    return alertContainer;
  }

  if (custom?.comingSoon === 'Yes' || variantCustom?.comingSoon === 'Yes') {
    alertContainer.innerText = ph.comingSoon || 'Coming Soon';
    block.classList.add('pdp-coming-soon');
    block.dataset.alert = true;
    return alertContainer;
  }

  const { promoButton } = custom;
  if (promoButton) {
    alertContainer.classList.add('pdp-promo-alert');
    alertContainer.innerText = promoButton;
    block.dataset.alert = true;
    return alertContainer;
  }

  const pricing = getOfferPricing(window.jsonLdData?.offers?.[0]);
  if (pricing && pricing.regular && pricing.regular > pricing.final) {
    alertContainer.classList.add('pdp-promo-alert');
    alertContainer.innerText = ph.saveNow || 'Save Now!';
    block.dataset.alert = true;
    return alertContainer;
  }

  block.dataset.alert = false;
  return null;
}

/**
 * Refreshes the PDP alert after a variant selection changes.
 * @param {Object} ph - Placeholders object
 * @param {HTMLElement} block - PDP block element
 * @param {Object} custom - Parent product custom data
 * @param {Object} variantCustom - Selected variant custom data
 */
export function updateAlert(ph, block, custom, variantCustom) {
  const currentAlert = block.querySelector('.pdp-alert');
  const alertContainer = renderAlert(ph, block, custom, variantCustom);

  if (currentAlert && alertContainer) {
    currentAlert.replaceWith(alertContainer);
  } else if (currentAlert) {
    currentAlert.remove();
  } else if (alertContainer) {
    block.prepend(alertContainer);
  }
}
