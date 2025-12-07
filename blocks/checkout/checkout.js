import {
  buildBlock,
  decorateBlock,
  loadBlock,
  loadScript,
} from '../../scripts/aem.js';
import { ORDERS_API_ORIGIN } from '../../scripts/scripts.js';

const ADDRESS_FORM = 'https://main--vitamix--aemsites.aem.page/drafts/maxed/checkout/address-form.json';

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
  const formContent = [[`<a href="${ADDRESS_FORM}"></a>`]];
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

  const sameShipBillCheckbox = formColumn.querySelector('fieldset[data-name="billingEqualsShipping"] input[type="checkbox"]');

  // duplicate the shipping address form section to create billing address form
  // will be hidden by default, only show when sameShipBill is unchecked
  const shippingAddressSection = formColumn.querySelector('fieldset.form-section.section-shipping');
  const billingAddressSection = shippingAddressSection.cloneNode(true);
  billingAddressSection.classList.add('form-section', 'section-billing');
  billingAddressSection.querySelector('h3').textContent = 'Billing Address';
  billingAddressSection.dataset.name = 'billingAddress';

  // add shipping- and billing- prefix to all input id, names, and labels
  shippingAddressSection.querySelectorAll('input, select').forEach((input) => {
    input.id = `shipping-${input.id}`;
    input.name = `shipping-${input.name}`;
    if (input.previousElementSibling.tagName === 'LABEL') {
      input.previousElementSibling.setAttribute('for', input.id);
    }
  });
  billingAddressSection.querySelectorAll('input, select').forEach((input) => {
    input.id = `billing-${input.id}`;
    input.name = `billing-${input.name}`;
    if (input.previousElementSibling.tagName === 'LABEL') {
      input.previousElementSibling.setAttribute('for', input.id);
    }
  });

  // insert below sameShipBill checkbox's section
  sameShipBillCheckbox.closest('fieldset.form-section').after(billingAddressSection);

  // hide billing address section by default
  billingAddressSection.setAttribute('aria-hidden', true);
  billingAddressSection.setAttribute('disabled', true);

  // show billing address section when sameShipBill is unchecked
  sameShipBillCheckbox.addEventListener('change', () => {
    billingAddressSection.setAttribute('aria-hidden', sameShipBillCheckbox.checked);
    billingAddressSection.setAttribute('disabled', sameShipBillCheckbox.checked);
  });

  // initialize pay buttons
  const submitButtons = [...formColumn.querySelectorAll('form .button-wrapper button[type="submit"]')];
  submitButtons.forEach((button) => {
    let paymentMethod = 'Credit Card';
    if (button.textContent.toLowerCase().includes('paypal')) {
      paymentMethod = 'PayPal';
      // replace with icon svg
      button.textContent = button.textContent.replace('PayPal', '');
      const icon = document.createElement('img');
      icon.src = `${window.hlx.codeBasePath}/icons/paypal.svg`;
      icon.classList.add('icon');
      icon.classList.add('icon-paypal');
      button.appendChild(icon);
    } else if (button.textContent.toLowerCase().includes('apple')) {
      paymentMethod = 'Apple Pay';
    }

    // update button styling, wrap each in a span
    const span = document.createElement('span');
    span.classList.add('payment-button');
    span.dataset.paymentMethod = paymentMethod;
    button.replaceWith(span);

    if (paymentMethod === 'PayPal') {
      // TODO: add paypal's script & styles
      span.classList.add('paypal');
      span.appendChild(button);
    } else if (paymentMethod === 'Apple Pay') {
      // TODO: conditionally disable this payment type if apple pay is not supported
      span.classList.add('apple-pay');
      loadScript('https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js');
      span.innerHTML = '<apple-pay-button buttonstyle="black" type="buy" locale="en-US"></apple-pay-button>';
    } else {
      span.classList.add('credit-card');
      span.appendChild(button);
      button.addEventListener('click', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        // validate form(s)
        /** @type {HTMLFormElement} */
        const form = button.closest('form');
        const isValid = form.checkValidity();
        if (!isValid) {
          form.reportValidity();
          return;
        }

        // set loading state, create order, simulate payment processing, redirect to complete page
        button.classList.add('loading');
        button.textContent = 'Processing...';
        button.disabled = true;

        const reenableButton = () => {
          button.classList.remove('loading');
          button.textContent = 'Pay Now';
          button.disabled = false;
        };

        // get form data
        const formData = Object.fromEntries(new FormData(form).entries());
        const {
          email,
          'shipping-firstname': firstName,
          'shipping-lastname': lastName,
          'shipping-telephone': phone,
        } = formData;
        // use state text instead of index value
        const state = form.querySelector(`select#shipping-state option[value="${formData['shipping-state']}"]`).textContent;
        const shipping = {
          name: `${firstName} ${lastName}`,
          company: formData['shipping-company'],
          address1: formData['shipping-street-0'],
          address2: formData['shipping-street-1'],
          city: formData['shipping-city'],
          state,
          zip: formData['shipping-zip'],
          country: 'US',
          phone,
          email,
        };

        const { default: cart } = await import('../../scripts/cart.js');
        const order = cart.getOrderJSON(email, firstName, lastName, phone, shipping);
        console.debug('order', order);

        // create the order
        const resp = await fetch(`${ORDERS_API_ORIGIN}/orders`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(order),
        });
        if (!resp.ok) {
          console.error('Failed to create order', resp);
          // TODO: show validation errors etc.
          reenableButton();
          return;
        }
        const data = await resp.json();
        console.debug('completed order', data);

        // simulate payment processing for a bit..
        await new Promise((resolve) => {
          setTimeout(resolve, 2000);
        });

        // clear cart on successful payment
        cart.clear();

        // redirect to complete page
        window.location.href = `/drafts/maxed/checkout/complete?id=${data.order.id}&email=${email}`;

        // just in case
        reenableButton();
      });
    }

    // default to credit card
    if (paymentMethod !== 'Credit Card') {
      span.setAttribute('aria-hidden', true);
    }
  });

  // handle payment method change
  const paymentMethodGroup = formColumn.querySelector('fieldset[data-name="paymentMethod"]');
  const payButtons = [...formColumn.querySelectorAll('form .button-wrapper span.payment-button')];
  paymentMethodGroup.addEventListener('change', () => {
    const paymentMethod = paymentMethodGroup.querySelector('input:checked').value;

    // only show billing address section if payment method is credit card
    if (sameShipBillCheckbox.checked || paymentMethod !== 'Credit Card') {
      billingAddressSection.setAttribute('aria-hidden', true);
    } else {
      billingAddressSection.removeAttribute('aria-hidden');
    }

    // toggle which submit button is visible
    payButtons.forEach((button) => {
      if (paymentMethod !== button.dataset.paymentMethod) {
        button.setAttribute('aria-hidden', true);
      } else {
        button.removeAttribute('aria-hidden');
        // NOTE: temp force apply pay button to show up, even on insecure hosts
        if (paymentMethod === 'Apple Pay') {
          const applePayButton = button.querySelector('apple-pay-button');
          applePayButton.removeAttribute('hidden');
          applePayButton.removeAttribute('aria-hidden');
        }
      }
    });
  });
}
