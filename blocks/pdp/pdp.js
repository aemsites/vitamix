import { loadScript, toClassName, getMetadata } from '../../scripts/aem.js';
import renderAddToCart from './add-to-cart.js';
import renderGallery from './gallery.js';
import renderSpecs from './specification-tabs.js';
import renderPricing, { extractPricing } from './pricing.js';
// eslint-disable-next-line import/no-cycle
import { renderOptions, onOptionChange, updateFreeGiftVisibility } from './options.js';
import { loadFragment } from '../fragment/fragment.js';
import {
  checkVariantOutOfStock,
  isProductOutOfStock,
  isNextPipeline,
  parseEasternDateTime,
} from '../../scripts/scripts.js';
import { openModal } from '../modal/modal.js';

/**
 * Renders the title section of the PDP block.
 * @param {Element} block - The PDP block element
 * @returns {Element} The title container element
 */
function renderTitle(block, custom, reviewsId) {
  const titleContainer = document.createElement('div');
  titleContainer.classList.add('title');

  const reviewsPlaceholder = document.createElement('div');
  reviewsPlaceholder.classList.add('pdp-reviews-summary-placeholder');
  reviewsPlaceholder.innerHTML = `<div data-bv-show="rating_summary" data-bv-product-id="${reviewsId}">`;

  const { collection } = custom;
  const collectionContainer = document.createElement('p');
  collectionContainer.classList.add('pdp-collection-placeholder', 'eyebrow');
  collectionContainer.textContent = `${collection || ''}`;

  titleContainer.append(
    collectionContainer,
    block.querySelector('h1:first-of-type'),
    reviewsPlaceholder,
  );

  return titleContainer;
}

/**
 * Renders the details section of the PDP block.
 * @param {Element} features - The features element from the fragment
 * @returns {Element} The details container element
 */
function renderDetails(features) {
  const detailsContainer = document.createElement('div');
  detailsContainer.classList.add('details');
  detailsContainer.append(...features.children);
  const h2 = document.createElement('h2');
  h2.textContent = 'About';
  detailsContainer.prepend(h2);
  return detailsContainer;
}

/**
 * Renders the reviews section of the PDP block.
 * @param {Element} block - The PDP block element
 */
// eslint-disable-next-line no-unused-vars
async function renderReviews(block, reviewsId) {
  // TODO: Add Bazaarvoice reviews
  const bazaarvoiceContainer = document.createElement('div');
  bazaarvoiceContainer.classList.add('pdp-reviews-container');
  bazaarvoiceContainer.innerHTML = `<div data-bv-show="reviews" data-bv-product-id="${reviewsId}"></div>`;

  setTimeout(async () => {
    await loadScript('https://apps.bazaarvoice.com/deployments/vitamix/main_site/production/en_US/bv.js');
  }, 500);

  window.bvCallback = () => { };

  block.parentElement.append(bazaarvoiceContainer);
}

function renderFAQ() {
  const faqContainer = document.createElement('div');
  faqContainer.classList.add('faq-container');
  faqContainer.innerHTML = `
  <h4>Have a question?</h4>
  <ul>
    <li><a href="https://www.vitamix.com/us/en_us/owners-resources/product-support/faqs/">Frequently Asked Questions</a></li>
    <li><a href="https://www.vitamix.com/us/en_us/customer-service/contact-us/">Contact Us</a></li>
  </ul>`;
  return faqContainer;
}

function renderCompare(custom) {
  const { entityId } = custom;
  const compareContainer = document.createElement('div');
  compareContainer.classList.add('pdp-compare-container');
  compareContainer.innerHTML = `
    <div>
      <button class="pdp-compare-button">Compare</button>
      <a href="/us/en_us/catalog/product_compare/index/" title="View Comparison" class="comparelistlink">View Comparison List.</a>
    </div>`;

  const compareButton = compareContainer.querySelector('.pdp-compare-button');
  compareButton.addEventListener('click', () => {
    fetch('/us/en_us/catalog/product_compare/add/', {
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
      },
      body: `product=${entityId}&uenc=${encodeURIComponent(window.location.href)}`,
      method: 'POST',
      credentials: 'include',
    }).then((resp) => {
      if (resp.ok) {
        openModal('/us/en_us/products/modals/compare').then((modal) => {
          if (modal) {
            const content = modal.querySelector('.default-content-wrapper');
            const product = document.createElement('p');
            product.className = 'product';
            product.textContent = document.querySelector('h1').textContent;
            content.prepend(product);
          }
        });
      }
    });
  });

  return compareContainer;
}

function renderContent(block) {
  const { jsonLdData } = window;
  const { custom } = jsonLdData;

  block.querySelectorAll(':scope > div')?.forEach((div) => {
    // Temporary fix to remove divs that don't have a class
    // or the specifications block in initial html
    if (div.classList.length === 0 || div.classList.contains('specifications')) {
      div.remove();
    }
  });

  const { features } = window;
  if (features) {
    const detailsContainer = renderDetails(features);
    block.append(detailsContainer);
  }

  const { specifications } = window;
  if (specifications) {
    const specsContainer = renderSpecs(specifications, custom, jsonLdData.name);
    block.append(specsContainer);
  }
}

async function fetchFragment(block) {
  const fragmentPath = window.location.pathname.replace('/products/', '/products/fragments/');
  const fragment = await loadFragment(fragmentPath);
  if (fragment) {
    const sections = [...fragment.querySelectorAll('main > div.section')];
    while (sections.length > 0) {
      const section = sections.shift();
      const h3 = section.querySelector('h3')?.textContent.toLowerCase();
      if (h3) {
        // Only include features for now, ignore all other sections with an h3
        if (h3.includes('features')) {
          window.features = section;
        } else if (h3.includes('specifications')) {
          window.specifications = section;
        } else if (h3.includes('warranty')) {
          window.warranty = section;
        }
      }
    }
  }

  renderContent(block);
}

function renderFreeShipping(offers) {
  if (!offers[0] || offers[0].price < 150) return null;
  const freeShippingContainer = document.createElement('div');
  freeShippingContainer.classList.add('pdp-free-shipping-container');
  freeShippingContainer.innerHTML = `
      <img src="/icons/delivery.svg" alt="Free Shipping" />
      <span>Eligible for FREE shipping</span>
  `;
  return freeShippingContainer;
}

function renderAlert(block, custom) {
  const alertContainer = document.createElement('div');
  alertContainer.classList.add('pdp-alert');

  /* retired and coming soon */
  if (custom && custom.retired === 'Yes') {
    alertContainer.innerText = 'Retired Product';
    block.classList.add('pdp-retired');
    return alertContainer;
  }
  /* promos */
  const { promoButton } = custom;
  if (promoButton) {
    alertContainer.classList.add('pdp-promo-alert');
    alertContainer.innerText = promoButton;
    return alertContainer;
  }

  /* save now */
  const pricingElement = block.querySelector('p:nth-of-type(1)');
  const pricing = extractPricing(pricingElement);
  if (pricing.regular && pricing.regular > pricing.final) {
    alertContainer.classList.add('pdp-promo-alert');
    alertContainer.innerText = 'Save Now!';
    return alertContainer;
  }

  block.dataset.alert = false;
  return null;
}

function renderRelatedProducts(custom) {
  const { relatedSkus } = custom;
  const relatedProducts = relatedSkus || [];
  if (relatedProducts.length > 0) {
    const relatedProductsContainer = document.createElement('div');
    relatedProductsContainer.classList.add('pdp-related-products-container');
    const fillProducts = async () => {
      const products = await Promise.all(relatedProducts.map(async (url) => {
        const resp = await fetch(`${url}.json`);
        if (!resp.ok) return null;
        const json = await resp.json();
        json.url = url;
        return json;
      }));
      const currentRelatedProducts = products.filter((product) => product && product.custom.retired === 'No');
      if (currentRelatedProducts.length > 0) {
        relatedProductsContainer.innerHTML = `
          <h2>Related Products</h2>
        `;
        const ul = document.createElement('ul');
        currentRelatedProducts.forEach((product) => {
          const li = document.createElement('li');
          const title = product.name;
          const image = new URL(product.images[0].url, window.location.href);
          const price = +product.price.final;
          li.innerHTML = `<a href="${product.url}"><img src="${image}?width=750&#x26;format=webply&#x26;optimize=medium" alt="${title}" /><div><p>${title}</p><strong>$${price.toFixed(2)}</strong></div></a>`;
          ul.appendChild(li);
        });
        relatedProductsContainer.appendChild(ul);
      }
    };
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          fillProducts();
          io.disconnect();
        }
      });
    });
    io.observe(relatedProductsContainer);
    return relatedProductsContainer;
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
    <a rel="noopener noreferrer nofollow" href="https://www.twitter.com/share?url=${url}"><img src="/icons/x.svg" alt="X" /></a>
    <a rel="noopener noreferrer nofollow" href="https://www.pinterest.com/pin/create/button/?url=${url}"><img src="/icons/pinterest.svg" alt="Pinterest" /></a>
    <a rel="noopener noreferrer nofollow" class="pdp-share-email" href="mailto:?subject=Check this out on Vitamix.com&body=${url}"><img src="/icons/email.svg" alt="Email" /></a>
  `;
  return shareContainer;
}

async function renderFreeGift() {
  try {
    /**
     * Parses a datetime string, returning null for empty values (open-ended).
     * @param {string} dateStr - The datetime string to parse
     * @returns {Date|null} The parsed Date or null if empty
     */
    const parseDateOrNull = (dateStr) => {
      const trimmed = dateStr?.trim();
      if (!trimmed) {
        return null; // Empty = open-ended
      }
      return parseEasternDateTime(trimmed);
    };

    const fetchGifts = async () => {
      const resp = await fetch('/us/en_us/products/config/free-gifts.plain.html');
      if (!resp.ok) return null;
      const text = await resp.text();
      const doc = new DOMParser().parseFromString(text, 'text/html');
      const gifts = doc.querySelector('.free-gifts');
      return [...gifts.children].map((gift) => {
        const [startDateEl, endDateEl, minPrice, label, body] = gift.children;
        try {
          const minPriceText = minPrice.textContent.startsWith('$')
            ? minPrice.textContent.slice(1)
            : minPrice.textContent;
          const labelText = label.textContent;
          const bodyText = body.innerHTML.replaceAll('./media_', './config/media_');
          return {
            valid: true,
            startDate: parseDateOrNull(startDateEl.textContent),
            endDate: parseDateOrNull(endDateEl.textContent),
            minPrice: minPriceText,
            label: labelText,
            body: bodyText,
          };
        } catch {
          // Skip rows with malformed dates
          return { valid: false };
        }
      }).filter((gift) => gift.valid);
    };

    const gifts = await fetchGifts();

    const findGift = (giftList) => giftList.find((gift) => {
      const today = new Date();
      // Null start = open-ended past, null end = open-ended future
      const afterStart = !gift.startDate || today >= gift.startDate;
      const beforeEnd = !gift.endDate || today <= gift.endDate;
      return afterStart && beforeEnd;
    });
    const gift = findGift(gifts);
    if (gift) {
      const freeGiftContainer = document.createElement('div');
      freeGiftContainer.classList.add('pdp-free-gift-container');
      freeGiftContainer.innerHTML = `
        <div class="pdp-free-gift-heading"><span>${gift.label}</span></div>
        <div class="pdp-free-gift-body">
          ${gift.body}
        </div>
      `;
      return freeGiftContainer;
    }
    return null;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error fetching free gifts:', error);
    return null;
  }
}

/**
 * Decorates the PDP block.
 * @param {Element} block - The PDP block element
 */
export default async function decorate(block) {
  const { jsonLdData, variants } = window;
  const { custom, offers } = jsonLdData;

  const reviewsId = custom.reviewsId || toClassName(getMetadata('sku')).replace(/-/g, '');
  const galleryContainer = renderGallery(block, variants);
  const titleContainer = renderTitle(block, custom, reviewsId);
  const alertContainer = renderAlert(block, custom);
  const relatedProductsContainer = renderRelatedProducts(custom);

  const buyBox = document.createElement('div');
  buyBox.classList.add('pdp-buy-box');

  // Check if parent product is out of stock (all variants are out of stock)
  const isParentOutOfStock = isProductOutOfStock();

  const pricingContainer = renderPricing(block);
  const optionsContainer = renderOptions(block, variants, custom, isParentOutOfStock);
  const addToCartContainer = renderAddToCart(block, jsonLdData);
  const compareContainer = renderCompare(custom);
  const freeGiftContainer = await renderFreeGift();
  const freeShippingContainer = renderFreeShipping(offers);
  const shareContainer = renderShare();

  // Hide free gift container if parent is out of stock
  updateFreeGiftVisibility(freeGiftContainer, isParentOutOfStock, false);

  buyBox.append(
    pricingContainer,
    optionsContainer || '',
    freeGiftContainer || '',
    addToCartContainer,
    compareContainer,
    freeShippingContainer || '',
    shareContainer,
  );

  const faqContainer = renderFAQ(block);

  if (isNextPipeline()) {
    // Content is already in the initial HTML
    renderContent(block);
  } else {
    // Fetch and render the fragment for legacy pipeline
    fetchFragment(block);
  }

  renderReviews(block, reviewsId);

  block.append(
    alertContainer || '',
    titleContainer,
    galleryContainer,
    buyBox,
    faqContainer,
    relatedProductsContainer || '',
  );

  const queryParams = new URLSearchParams(window.location.search);
  const color = queryParams.get('color');

  if (color) {
    onOptionChange(block, variants, color, isParentOutOfStock);
  } else if (variants.length > 0) {
    [window.selectedVariant] = variants;
  }

  buyBox.dataset.sku = window.selectedVariant?.sku || offers[0].sku;
  const variantOos = checkVariantOutOfStock(
    window.selectedVariant
      ? offers.find((offer) => offer.sku === window.selectedVariant.sku).sku
      : offers[0].sku,
  );
  // Set OOS to true if either parent or variant is out of stock
  buyBox.dataset.oos = isParentOutOfStock || variantOos;

  // Hide free gift container if variant is also out of stock
  updateFreeGiftVisibility(freeGiftContainer, isParentOutOfStock, variantOos);
}
