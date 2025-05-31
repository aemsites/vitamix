import { loadScript, toClassName, getMetadata } from '../../scripts/aem.js';
import renderGallery from './gallery.js';
import renderSpecs from './specification-tabs.js';
import renderPricing from './pricing.js';
import renderOptions from './options.js';
import { loadFragment } from '../fragment/fragment.js';

const BV_PRODUCT_ID = getMetadata('reviewsId') || toClassName(getMetadata('sku')).replace(/-/g, '');

/**
 * Renders the title section of the PDP block.
 * @param {Element} block - The PDP block element
 * @returns {Element} The title container element
 */
function renderTitle(block) {
  const titleContainer = document.createElement('div');
  titleContainer.classList.add('title');

  const reviewsPlaceholder = document.createElement('div');
  reviewsPlaceholder.classList.add('pdp-reviews-summary-placeholder');
  reviewsPlaceholder.innerHTML = `<div data-bv-show="rating_summary" data-bv-product-id="${BV_PRODUCT_ID}">`;

  titleContainer.append(
    block.querySelector('h1:first-of-type'),
    reviewsPlaceholder,
  );

  return titleContainer;
}

/**
 * Renders the details section of the PDP block.
 * @param {Element} block - The PDP block element
 * @returns {Element} The details container element
 */
function renderDetails(block) {
  const detailsContainer = document.createElement('div');
  detailsContainer.classList.add('details');

  detailsContainer.append(...block.children);

  return detailsContainer;
}

/**
 * Renders the add to cart section of the PDP block.
 * @returns {Element} The add to cart container element
 */
function renderAddToCart() {
  const addToCartContainer = document.createElement('div');
  addToCartContainer.classList.add('add-to-cart');

  // Quantity Label
  const quantityLabel = document.createElement('label');
  quantityLabel.textContent = 'Quantity:';
  addToCartContainer.appendChild(quantityLabel);

  const quantityContainer = document.createElement('div');
  quantityContainer.classList.add('quantity-container');
  const quantitySelect = document.createElement('select');

  // eslint-disable-next-line no-plusplus
  for (let i = 1; i <= 3; i++) {
    const option = document.createElement('option');
    option.value = i;
    option.textContent = i;
    quantitySelect.appendChild(option);
  }
  quantityContainer.appendChild(quantitySelect);

  // Add to Cart Button
  const addToCartButton = document.createElement('button');
  addToCartButton.textContent = 'Add to Cart';
  quantityContainer.appendChild(addToCartButton);

  addToCartContainer.appendChild(quantityContainer);

  return addToCartContainer;
}

/**
 * Renders the reviews section of the PDP block.
 * @param {Element} block - The PDP block element
 */
// eslint-disable-next-line no-unused-vars
async function renderReviews(block) {
  // TODO: Add Bazaarvoice reviews
  const bazaarvoiceContainer = document.createElement('div');
  bazaarvoiceContainer.classList.add('pdp-reviews-container');
  bazaarvoiceContainer.innerHTML = `<div data-bv-show="reviews" data-bv-product-id="${BV_PRODUCT_ID}"></div>`;

  setTimeout(async () => {
    await loadScript('https://apps.bazaarvoice.com/deployments/vitamix/main_site/production/en_US/bv.js');
  }, 5000);

  window.bvCallback = () => { };

  block.parentElement.append(bazaarvoiceContainer);
}

function renderFAQ(block) {
  const faqContainer = document.createElement('div');
  faqContainer.classList.add('faq-container');
  faqContainer.innerHTML = `
  <h4>Have a question?</h4>
  <ul>
    <li><a href="https://www.vitamix.com/us/en_us/owners-resources/product-support/faqs/">Frequently Asked Questions</a></li>
    <li><a href="https://www.vitamix.com/us/en_us/customer-service/contact-us/">Contact Us</a></li>
  </ul>`;
  block.parentElement.append(faqContainer);
}

function renderCompare() {
  const compareContainer = document.createElement('div');
  compareContainer.classList.add('pdp-compare-container');
  compareContainer.innerHTML = `
    <div>
      <button class="pdp-compare-button">Compare</button>
      <a href="https://www.vitamix.com/us/en_us/catalog/product_compare/index/" title="View Comparison" class="comparelistlink">View Comparison List.</a>
    </div>`;
  return compareContainer;
}

function renderContent() {
  const contentContainer = document.createElement('div');
  contentContainer.classList.add('pdp-content-fragment');
  const fragmentPath = window.location.pathname.replace('/products/', '/products/fragments/');
  const insertFragment = async () => {
    const fragment = await loadFragment(fragmentPath);
    while (fragment.firstChild) {
      contentContainer.append(fragment.firstChild);
    }
  };
  insertFragment();
  return contentContainer;
}

function renderFreeShipping(offers) {
  if (!offers[0] || offers[0].price < 99) return null;
  const freeShippingContainer = document.createElement('div');
  freeShippingContainer.classList.add('pdp-free-shipping-container');
  freeShippingContainer.innerHTML = `
      <img src="/icons/delivery.svg" alt="Free Shipping" />
      <span>Eligible for FREE shipping</span>
  `;
  return freeShippingContainer;
}

function renderAlert(offers) {
  if (offers[0] && (offers[0].availability === 'https://schema.org/Discontinued' || offers[0].availability === 'https://schema.org/PreOrder')) {
    const alertContainer = document.createElement('div');
    const text = offers[0].availability === 'https://schema.org/Discontinued' ? 'Retired Product' : 'Coming Soon';
    alertContainer.classList.add('pdp-alert');
    alertContainer.innerHTML = `
      <p>${text}</p>
    `;
    return alertContainer;
  }
  return null;
}

function renderShare() {
  const shareContainer = document.createElement('div');
  shareContainer.classList.add('pdp-share-container');
  const url = decodeURIComponent(window.location.href);
  shareContainer.innerHTML = `
    Share: 
    <a rel="noopener noreferrer nofollow" href="https://www.facebook.com/sharer/sharer.php?u=${url}&quote=${url}"><img src="/icons/facebook.svg" alt="Facebook" /></a>
    <a rel="noopener noreferrer nofollow" href="https://www.twitter.com/share?url=${url}"><img src="/icons/twitter.svg" alt="Twitter" /></a>
    <a rel="noopener noreferrer nofollow" href="https://www.pinterest.com/pin/create/button/?url=${url}"><img src="/icons/pinterest.svg" alt="Pinterest" /></a>
    <a rel="noopener noreferrer nofollow" class="pdp-share-email"href="mailto: ?subject=Check this out on Vitamix.com&body=${url}"><img src="/icons/email.svg" alt="Email" /></a>
  `;
  return shareContainer;
}

/**
 * Decorates the PDP block.
 * @param {Element} block - The PDP block element
 */
export default function decorate(block) {
  // remove eyebrow classes from all but the first eyebrow
  [...block.querySelectorAll('p.eyebrow')].forEach((element) => {
    element.classList.remove('eyebrow');
  });

  // Get the json-ld from the head and parse it
  const jsonLd = document.head.querySelector('script[type="application/ld+json"]');
  const jsonLdData = jsonLd ? JSON.parse(jsonLd.textContent) : null;

  const { variants } = window;
  const galleryContainer = renderGallery(block, variants);
  const titleContainer = renderTitle(block);
  const alertContainer = renderAlert(jsonLdData.offers);

  const buyBox = document.createElement('div');
  buyBox.classList.add('pdp-buy-box');

  const pricingContainer = renderPricing(block);
  const optionsContainer = renderOptions(block, variants, jsonLdData.custom.options);
  const addToCartContainer = renderAddToCart(block);
  const compareContainer = renderCompare();
  const freeShippingContainer = renderFreeShipping(jsonLdData.offers);
  const shareContainer = renderShare();
  buyBox.append(
    pricingContainer,
    optionsContainer || '',
    addToCartContainer,
    compareContainer,
    freeShippingContainer || '',
    shareContainer,
  );

  const detailsContainer = renderDetails(block);
  const specifications = detailsContainer.querySelector('.specifications');
  const specsContainer = renderSpecs(specifications, jsonLdData);
  specifications.remove();

  const contentContainer = renderContent();
  renderFAQ(block);
  renderReviews(block);

  block.append(
    alertContainer || '',
    titleContainer,
    galleryContainer,
    buyBox,
    contentContainer,
    detailsContainer,
    specsContainer,
  );
}
