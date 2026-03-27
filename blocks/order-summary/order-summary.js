/**
 * Order confirmation / cancellation page.
 *
 * Success: Chase → API → redirect here with ?orderId=...
 * Cancel:  Chase → API → redirect here with ?orderId=...&reason=...
 *
 * Order display data comes from sessionStorage (saved before Chase redirect).
 */
export default async function decorate(block) {
  const params = Object.fromEntries(new URLSearchParams(window.location.search).entries());

  // cancelled or failed payment
  if (params.reason) {
    block.innerHTML = `
      <div class="order-result order-cancelled">
        <h2>Payment not completed</h2>
        <p>${params.reason === 'customer_cancelled' ? 'You cancelled the payment.' : `Payment could not be processed (${params.reason}).`}</p>
        <p><a href="/drafts/maxed/checkout/start" class="button emphasis">Return to checkout</a></p>
      </div>
    `;
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

  // build confirmation display
  const container = document.createElement('div');
  container.className = 'order-result order-confirmed';

  const heading = document.createElement('h2');
  heading.textContent = 'Thank you for your order!';
  container.appendChild(heading);

  const orderIdEl = document.createElement('p');
  orderIdEl.className = 'order-id';
  orderIdEl.innerHTML = `Order ID: <strong>${orderId}</strong>`;
  container.appendChild(orderIdEl);

  if (email) {
    const emailEl = document.createElement('p');
    emailEl.textContent = `A confirmation will be sent to ${email}.`;
    container.appendChild(emailEl);
  }

  // show order items — prefer cart items (has variant/image) over order items
  const displayItems = cartItems || order?.items;
  if (displayItems?.length) {
    const itemsSection = document.createElement('div');
    itemsSection.className = 'order-items';

    const itemsHeading = document.createElement('h3');
    itemsHeading.textContent = 'Items ordered';
    itemsSection.appendChild(itemsHeading);

    displayItems.forEach((item) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'order-item';

      if (item.image) {
        const img = document.createElement('img');
        img.src = item.image;
        img.alt = item.name || '';
        img.className = 'order-item-image';
        itemEl.appendChild(img);
      }

      const details = document.createElement('div');
      details.className = 'order-item-details';

      const name = document.createElement('p');
      name.className = 'order-item-name';
      name.textContent = item.name || item.sku;
      details.appendChild(name);

      if (item.variant) {
        const variant = document.createElement('p');
        variant.className = 'order-item-variant';
        variant.textContent = `Color: ${item.variant}`;
        details.appendChild(variant);
      }

      const qty = document.createElement('p');
      qty.className = 'order-item-qty';
      const price = item.price?.final || item.price;
      qty.textContent = `Qty: ${item.quantity} — $${price}`;
      details.appendChild(qty);

      itemEl.appendChild(details);
      itemsSection.appendChild(itemEl);
    });
    container.appendChild(itemsSection);
  }

  // show totals from preview if available
  if (preview) {
    const totalsSection = document.createElement('div');
    totalsSection.className = 'order-totals';

    const rows = [
      ['Subtotal', `$${parseFloat(preview.subtotal).toFixed(2)}`],
      ['Shipping', preview.shippingMethod?.rate === 0 ? 'Free' : `$${parseFloat(preview.shippingMethod?.rate || 0).toFixed(2)}`],
      ['Tax', `$${parseFloat(preview.taxAmount).toFixed(2)}`],
      ['Total', `$${parseFloat(preview.total).toFixed(2)}`],
    ];

    rows.forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = `order-totals-row${label === 'Total' ? ' order-totals-total' : ''}`;
      row.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
      totalsSection.appendChild(row);
    });

    container.appendChild(totalsSection);
  }

  // shipping address
  if (order?.shipping) {
    const addrSection = document.createElement('div');
    addrSection.className = 'order-shipping-address';
    const addrHeading = document.createElement('h3');
    addrHeading.textContent = 'Shipping address';
    addrSection.appendChild(addrHeading);

    const addr = order.shipping;
    const addrLines = [addr.name, addr.address1, addr.address2, `${addr.city}, ${addr.state} ${addr.zip}`, addr.country].filter(Boolean);
    const addrEl = document.createElement('p');
    addrEl.innerHTML = addrLines.join('<br>');
    addrSection.appendChild(addrEl);
    container.appendChild(addrSection);
  }

  const continueLink = document.createElement('p');
  continueLink.innerHTML = '<a href="/" class="button emphasis">Continue shopping</a>';
  container.appendChild(continueLink);

  block.replaceChildren(container);
}
