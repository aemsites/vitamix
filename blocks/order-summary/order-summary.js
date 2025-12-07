import { ORDERS_API_ORIGIN } from '../../scripts/scripts.js';

/**
 * @param {HTMLDivElement} block
 * @returns {Promise<void>}
 */
export default async function decorate(block) {
  // get orderId, email from url params
  const params = Object.fromEntries(new URLSearchParams(window.location.search).entries());

  if (!params.id || !params.email) {
    // redirect to home page
    window.location.href = '/us/en_us/';
  }

  // fetch order info
  const resp = await fetch(`${ORDERS_API_ORIGIN}/customers/${params.email}/orders/${params.id}`);
  if (!resp.ok) {
    console.error(`Failed to fetch order info: ${resp.status} ${resp.statusText}`);
    if (resp.status !== 404) {
      // redirect after 10 seconds
      setTimeout(() => {
        window.location.href = '/us/en_us/';
      }, 10000);
    } else {
      // redirect to home page
      window.location.href = '/us/en_us/';
    }
    return;
  }

  const data = await resp.json();
  // just dump it into a code block for now
  block.innerHTML = '<pre><code></code></pre>';
  block.querySelector('code').innerText = JSON.stringify(data, null, 2);
}
