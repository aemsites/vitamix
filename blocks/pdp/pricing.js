/**
 * Extracts pricing information from a given element.
 * @param {Element} element - The element containing the pricing information.
 * @returns {Object} An object containing the final price and regular price.
 */
export function extractPricing(element) {
  if (!element) return null;

  const pricingText = element.textContent.trim();

  // Matches price values in the format $XXX.XX (e.g. $399.95, $1,299.99)
  // \$ - matches literal dollar sign
  // ([\d,]+) - matches one or more digits or commas (for thousands)
  // \.\d{2} - matches decimal point followed by exactly 2 digits
  const priceMatch = pricingText.match(/\$([\d,]+\.\d{2})/g);

  if (!priceMatch) return null;

  const finalPrice = parseFloat(priceMatch[0].replace(/[$,]/g, ''));
  const regularPrice = priceMatch[1] ? parseFloat(priceMatch[1].replace(/[$,]/g, '')) : null;

  return {
    final: finalPrice,
    regular: regularPrice,
  };
}

/**
 * Renders the pricing section of the PDP block.
 * @param {Element} block - The PDP block element
 * @returns {Element} The pricing container element
 */
export default function renderPricing(block, variant) {
  const pricingContainer = document.createElement('div');
  pricingContainer.classList.add('pricing');

  const pricingElement = block.querySelector('p:nth-of-type(1)');
  const pricing = variant ? variant.price : extractPricing(pricingElement);
  if (!pricing) {
    return null;
  }

  if (!variant) pricingElement.remove();

  // Check if the product is reconditioned
  // If the variant is not null, check if the item condition is refurbished
  // If the variant is null, check if the location href includes 'reconditioned'
  // If both are false, item is not reconditioned
  const isReconditioned = variant && variant.itemCondition ? variant.itemCondition.includes('RefurbishedCondition') : window.location.href.includes('reconditioned') || false;

  if (pricing.regular && pricing.regular > pricing.final) {
    const nowLabel = document.createElement('div');
    nowLabel.className = 'pricing-now';
    nowLabel.textContent = isReconditioned ? 'Recon Price' : 'Now';
    pricingContainer.appendChild(nowLabel);
  }

  const finalPrice = document.createElement('div');
  finalPrice.className = 'pricing-final';
  finalPrice.textContent = `$${pricing.final.toFixed(2)}`;
  pricingContainer.appendChild(finalPrice);

  if (pricing.regular && pricing.regular > pricing.final) {
    const savingsContainer = document.createElement('div');
    savingsContainer.className = 'pricing-savings';

    const savingsAmount = pricing.regular - pricing.final;
    const saveText = document.createElement('span');
    saveText.className = 'pricing-save';
    saveText.textContent = isReconditioned ? `Save $${savingsAmount.toFixed(2)} | New ` : `Save $${savingsAmount.toFixed(2)} | Was `;

    const regularPrice = document.createElement('del');
    regularPrice.className = 'pricing-regular';
    regularPrice.textContent = `$${pricing.regular.toFixed(2)}`;

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
        locale: 'en_US',
        country_code: 'USA',
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
