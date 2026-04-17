import { formatPrice, getOfferPricing } from '../../scripts/scripts.js';

/**
 * Renders the pricing section of the PDP block.
 * @param {Element} block - The PDP block element
 * @returns {Element} The pricing container element
 */
export default function renderPricing(ph, block, variant) {
  const pricingContainer = document.createElement('div');
  pricingContainer.classList.add('pricing');

  // Don't render pricing if addToCart is set to No
  if (window.jsonLdData?.custom?.addToCart === 'No') {
    return pricingContainer;
  }

  const pricing = variant
    ? variant.price
    : getOfferPricing(window.jsonLdData?.offers?.[0]);
  if (!pricing) {
    return null;
  }

  // remove the pipeline-rendered pricing text from the DOM
  if (!variant) {
    const pricingElement = block.querySelector('p:nth-of-type(1)');
    if (pricingElement) pricingElement.remove();
  }

  // Check if the product is reconditioned
  // If the variant is not null, check if the item condition is refurbished
  // If the variant is null, check if the location href includes 'reconditioned'
  // If both are false, item is not reconditioned
  const isReconditioned = variant && variant.itemCondition ? variant.itemCondition.includes('RefurbishedCondition') : window.location.href.includes('reconditioned') || false;

  if (pricing.regular && pricing.regular > pricing.final) {
    const nowLabel = document.createElement('div');
    nowLabel.className = 'pricing-now';
    nowLabel.textContent = isReconditioned ? (ph.reconPrice || 'Recon Price') : (ph.now || 'Now');
    pricingContainer.appendChild(nowLabel);
  }

  const finalPrice = document.createElement('div');
  finalPrice.className = 'pricing-final';
  finalPrice.textContent = formatPrice(pricing.final, ph);
  pricingContainer.appendChild(finalPrice);

  if (pricing.regular && pricing.regular > pricing.final) {
    const savingsContainer = document.createElement('div');
    savingsContainer.className = 'pricing-savings';

    const savingsAmount = pricing.regular - pricing.final;
    const saveText = document.createElement('span');
    saveText.className = 'pricing-save';
    saveText.textContent = isReconditioned
      ? `${ph.save || 'Save'} ${formatPrice(savingsAmount, ph)} | ${ph.new || 'New'} `
      : `${ph.save || 'Save'} ${formatPrice(savingsAmount, ph)} | ${ph.was || 'Was'} `;

    const regularPrice = document.createElement('del');
    regularPrice.className = 'pricing-regular';
    regularPrice.textContent = formatPrice(pricing.regular, ph);

    savingsContainer.appendChild(saveText);
    savingsContainer.appendChild(regularPrice);
    pricingContainer.appendChild(savingsContainer);
  }

  const paymentsPlaceholder = document.createElement('div');
  paymentsPlaceholder.classList.add('pdp-payments-placeholder');
  const affirmContainer = document.createElement('div');
  affirmContainer.classList.add('affirm-as-low-as');
  affirmContainer.id = 'als_pdp';
  affirmContainer.dataset.amount = pricing.final * 100;
  affirmContainer.dataset.pageType = 'category';
  affirmContainer.dataset.affirmColor = 'blue';
  affirmContainer.dataset.learnmoreShow = 'true';

  paymentsPlaceholder.appendChild(affirmContainer);
  pricingContainer.append(paymentsPlaceholder);

  if (+pricing.final > 50) {
    setTimeout(() => {
      // eslint-disable-next-line camelcase, no-underscore-dangle
      window._affirm_config = {
        public_api_key: '6PJNMXGC9XLXNFHX',
        script: 'https://cdn1.affirm.com/js/v2/affirm.js',
        locale: ph.languageCode || 'en_US',
        country_code: ph.countryCode || 'USA',
        logo: 'blue',
        min_order_total: '50.00',
        max_order_total: '50000',
        selector: '#als_pdp',
        currency_rate: null,
        backorders_options: [],
        element_id: 'als_pdp',
      };

      /* eslint-disable */
    (function(m,g,n,d,a,e,h,c){var b=m[n]||{},k=document.createElement(e),p=document.getElementsByTagName(e)[0],l=function(a,b,c){return function(){a[b]._.push([c,arguments])}};b[d]=l(b,d,"set");var f=b[d];b[a]={};b[a]._=[];f._=[];b._=[];b[a][h]=l(b,a,h);b[c]=function(){b._.push([h,arguments])};a=0;for(c="set add save post open empty reset on off trigger ready setProduct".split(" ");a<c.length;a++)f[c[a]]=l(b,d,c[a]);a=0;for(c=["get","token","url","items"];a<c.length;a++)f[c[a]]=function(){};k.async=
        !0;k.src=g[e];p.parentNode.insertBefore(k,p);delete g[e];f(g);m[n]=b})(window,_affirm_config,"affirm","checkout","ui","script","ready","jsReady");
    }, 500);      
  }
  /* eslint-enable */

  return pricingContainer;
}
