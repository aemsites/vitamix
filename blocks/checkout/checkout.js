import { buildBlock, decorateBlock, loadBlock } from '../../scripts/aem.js';

/**
 * Creates and decorates the checkout page with form and cart summary
 * @param {HTMLElement} block
 */
export default async function decorate(block) {
  // Create the checkout layout
  const checkoutContainer = document.createElement('div');
  checkoutContainer.className = 'checkout-container';

  // Create left column (form)
  const formColumn = document.createElement('div');
  formColumn.className = 'checkout-form-column';

  // Create right column (cart summary)
  const summaryColumn = document.createElement('div');
  summaryColumn.className = 'checkout-summary-column';

  // Build the form block
  const formContent = [['<a href="https://main--vitamix--aemsites.aem.page/drafts/maxed/checkout/address-form.json"></a>']];
  const formBlock = buildBlock('form', formContent);
  formColumn.appendChild(formBlock);
  decorateBlock(formBlock);

  // Build the cart summary block
  const summaryBlock = buildBlock('cart-summary', []);
  summaryColumn.appendChild(summaryBlock);
  decorateBlock(summaryBlock);

  // Add columns to container
  checkoutContainer.appendChild(formColumn);
  checkoutContainer.appendChild(summaryColumn);

  // Replace block content
  block.replaceChildren(checkoutContainer);

  // Load both blocks
  await Promise.all([
    loadBlock(formBlock),
    loadBlock(summaryBlock),
  ]);

  // insert title into form column
  const firstAddrField = formColumn.querySelector('form .form-field[data-name="firstname"]');
  if (firstAddrField) {
    const title = document.createElement('h3');
    title.textContent = 'Shipping Address';
    firstAddrField.parentElement.insertBefore(title, firstAddrField);
  }
}
