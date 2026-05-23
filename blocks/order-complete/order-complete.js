import { getConfig, formatPrice } from '../../scripts/commerce-config.js';

/**
 * Order confirmation / cancellation page.
 *
 * Success: Chase / PayPal → API → redirect here with ?orderId=...
 * Cancel:  Chase / PayPal → API → redirect here with ?orderId=...&reason=...
 *   reason values: customer_cancelled | payment_failed | declined
 *
 * Order display data comes from sessionStorage (saved before the payment redirect).
 */
export default async function decorate(block) {
  const config = getConfig();
  const s = config.getStrings();
  const currencyCode = typeof config.currency === 'function' ? config.currency(config.getLocale()) : config.currency;
  const params = Object.fromEntries(new URLSearchParams(window.location.search).entries());

  // cancelled or failed payment
  if (params.reason) {
    const container = document.createElement('div');
    container.className = 'order-result order-cancelled';

    const heading = document.createElement('h2');
    heading.textContent = s.orderPaymentNotCompleted;
    container.appendChild(heading);

    const msg = document.createElement('p');
    msg.textContent = params.reason === 'customer_cancelled'
      ? s.orderPaymentCancelled
      : s.orderPaymentFailed;
    container.appendChild(msg);

    const link = document.createElement('p');
    const returnLink = document.createElement('a');
    returnLink.href = getConfig().getOrderPath('checkout');
    returnLink.className = 'button emphasis';
    returnLink.textContent = s.orderReturnToCheckout;
    link.appendChild(returnLink);
    container.appendChild(link);

    block.replaceChildren(container);
    return;
  }

  // success flow — read from sessionStorage
  const orderId = params.orderId || params.id;
  const email = params.email || sessionStorage.getItem('checkout_email');
  const orderData = sessionStorage.getItem('checkout_order');
  const previewData = sessionStorage.getItem('checkout_preview');
  const cartItemsData = sessionStorage.getItem('checkout_cart_items');

  if (!orderId) {
    window.location.href = '/';
    return;
  }

  let order;
  let preview;
  let cartItems;
  try {
    order = orderData ? JSON.parse(orderData) : null;
    preview = previewData ? JSON.parse(previewData) : null;
    cartItems = cartItemsData ? JSON.parse(cartItemsData) : null;
  } catch {
    order = null;
    preview = null;
    cartItems = null;
  }

  // clear checkout session data
  sessionStorage.removeItem('checkout_email');
  sessionStorage.removeItem('checkout_order');
  sessionStorage.removeItem('checkout_preview');
  sessionStorage.removeItem('checkout_cart_items');

  // clear the cart
  try {
    const { default: cart } = await import('../../scripts/cart.js');
    cart.clear();
  } catch {
    // cart may not be available
  }

  // build confirmation page
  const container = document.createElement('div');
  container.className = 'order-result order-confirmed';

  // header section
  const headerSection = document.createElement('div');
  headerSection.className = 'order-header';

  const checkmark = document.createElement('div');
  checkmark.className = 'order-checkmark';
  checkmark.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#2e7d32" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-5"/></svg>';
  headerSection.appendChild(checkmark);

  const heading = document.createElement('h2');
  heading.textContent = s.orderThankYou;
  headerSection.appendChild(heading);

  const orderIdEl = document.createElement('p');
  orderIdEl.className = 'order-id';
  const orderIdLabel = document.createElement('span');
  orderIdLabel.textContent = `${s.orderIdLabel} `;
  const orderIdValue = document.createElement('strong');
  const friendlyOrderNumber = order?.number || order?.orderNumber
    || `#${orderId.replace(/-/g, '').slice(-8).toUpperCase()}`;
  orderIdValue.textContent = friendlyOrderNumber;
  orderIdEl.append(orderIdLabel, orderIdValue);
  headerSection.appendChild(orderIdEl);

  if (email) {
    const emailEl = document.createElement('p');
    emailEl.className = 'order-email';
    emailEl.textContent = s.orderConfirmationEmail.replace('{email}', email);
    headerSection.appendChild(emailEl);
  }

  container.appendChild(headerSection);

  // two-column layout: items + totals on left, shipping on right
  const detailsGrid = document.createElement('div');
  detailsGrid.className = 'order-details';

  // left column: items + totals
  const leftCol = document.createElement('div');
  leftCol.className = 'order-details-left';

  // items
  const displayItems = cartItems || order?.items;
  if (displayItems?.length) {
    const itemsSection = document.createElement('div');
    itemsSection.className = 'order-items';

    const itemsHeading = document.createElement('h3');
    itemsHeading.textContent = s.orderItemsOrdered;
    itemsSection.appendChild(itemsHeading);

    displayItems.forEach((item) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'order-item';

      const imgWrapper = document.createElement('div');
      imgWrapper.className = 'order-item-image';
      const imageSrc = item.image || (item.custom?.linkedTo ? '/icons/full-warranty.svg' : null);
      if (imageSrc) {
        const img = document.createElement('img');
        img.src = imageSrc;
        img.alt = item.name || '';
        imgWrapper.appendChild(img);
      }
      itemEl.appendChild(imgWrapper);

      const details = document.createElement('div');
      details.className = 'order-item-details';

      const name = document.createElement('p');
      name.className = 'order-item-name';
      name.textContent = item.name || item.sku;
      details.appendChild(name);

      if (item.variant) {
        const variant = document.createElement('p');
        variant.className = 'order-item-variant';
        variant.textContent = item.variant;
        details.appendChild(variant);
      }

      const qty = document.createElement('p');
      qty.className = 'order-item-qty';
      qty.textContent = `${s.orderQtyLabel} ${item.quantity}`;
      details.appendChild(qty);

      itemEl.appendChild(details);

      const price = document.createElement('div');
      price.className = 'order-item-price';
      const unitPrice = parseFloat(item.price?.final || item.price) || 0;
      price.textContent = formatPrice(unitPrice * item.quantity, currencyCode);
      itemEl.appendChild(price);

      itemsSection.appendChild(itemEl);
    });
    leftCol.appendChild(itemsSection);
  }

  // totals
  if (preview) {
    const totalsSection = document.createElement('div');
    totalsSection.className = 'order-totals';

    const shippingRate = preview.shippingMethod?.rate;
    const shippingDisplay = shippingRate === 0
      ? s.free
      : formatPrice(parseFloat(shippingRate || 0), currencyCode);

    const rows = [
      [s.subtotal, formatPrice(parseFloat(preview.subtotal), currencyCode)],
      [s.shipping, shippingDisplay],
    ];

    if (preview.discounts?.length) {
      preview.discounts.forEach((discount) => {
        const label = discount.name || s.discount;
        const amount = discount.freeShipping
          ? parseFloat(shippingRate || 0)
          : Math.abs(parseFloat(discount.amount));
        const value = formatPrice(-amount, currencyCode);
        rows.push([label, value, 'order-totals-discount']);
      });
    }

    rows.push([s.orderTax, formatPrice(parseFloat(preview.taxAmount), currencyCode)]);

    rows.forEach(([label, value, extraClass]) => {
      const row = document.createElement('div');
      row.className = extraClass ? `order-totals-row ${extraClass}` : 'order-totals-row';
      const labelEl = document.createElement('span');
      labelEl.textContent = label;
      const valueEl = document.createElement('span');
      valueEl.textContent = value;
      row.append(labelEl, valueEl);
      totalsSection.appendChild(row);
    });

    const totalRow = document.createElement('div');
    totalRow.className = 'order-totals-row order-totals-total';
    const totalLabel = document.createElement('strong');
    totalLabel.textContent = s.total;
    const totalValue = document.createElement('strong');
    totalValue.textContent = formatPrice(parseFloat(preview.total), currencyCode);
    totalRow.append(totalLabel, totalValue);
    totalsSection.appendChild(totalRow);

    leftCol.appendChild(totalsSection);
  }

  detailsGrid.appendChild(leftCol);

  // right column: shipping address
  const rightCol = document.createElement('div');
  rightCol.className = 'order-details-right';

  if (order?.shipping) {
    const addrSection = document.createElement('div');
    addrSection.className = 'order-shipping-address';

    const addrHeading = document.createElement('h3');
    addrHeading.textContent = s.orderShippingAddress;
    addrSection.appendChild(addrHeading);

    const addr = order.shipping;
    const lines = [
      addr.name,
      addr.company,
      addr.address1,
      addr.address2,
      `${addr.city}, ${addr.state} ${addr.zip}`,
      addr.country?.toUpperCase(),
    ].filter(Boolean);

    lines.forEach((line) => {
      const p = document.createElement('p');
      p.textContent = line;
      addrSection.appendChild(p);
    });

    rightCol.appendChild(addrSection);
  }

  if (order?.customer) {
    const contactSection = document.createElement('div');
    contactSection.className = 'order-contact';

    const contactHeading = document.createElement('h3');
    contactHeading.textContent = s.orderContact;
    contactSection.appendChild(contactHeading);

    const contactEmail = document.createElement('p');
    contactEmail.textContent = order.customer.email;
    contactSection.appendChild(contactEmail);

    if (order.customer.phone) {
      const contactPhone = document.createElement('p');
      contactPhone.textContent = order.customer.phone;
      contactSection.appendChild(contactPhone);
    }

    rightCol.appendChild(contactSection);
  }

  detailsGrid.appendChild(rightCol);
  container.appendChild(detailsGrid);

  // continue shopping
  const actions = document.createElement('div');
  actions.className = 'order-actions';
  const continueLink = document.createElement('a');
  continueLink.href = '/';
  continueLink.className = 'button emphasis';
  continueLink.textContent = s.continueShopping;
  actions.appendChild(continueLink);
  container.appendChild(actions);

  block.replaceChildren(container);
}
