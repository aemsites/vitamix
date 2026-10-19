import { fetchPlaceholders, loadCSS } from './aem.js';

/**
 * Prompts for a masked password while the undecorated page remains hidden.
 * @param {string} message
 * @returns {Promise<string>}
 */
async function promptEmbargoPassword(message) {
  const dialog = document.createElement('dialog');
  dialog.className = 'embargo-gate';
  dialog.setAttribute('aria-labelledby', 'embargo-gate-title');
  dialog.innerHTML = `
    <form>
      <h2 id="embargo-gate-title">Invitation only</h2>
      <p id="embargo-gate-message"></p>
      <label for="embargo-gate-password">Password</label>
      <input id="embargo-gate-password" name="password" type="password"
        autocomplete="current-password" aria-describedby="embargo-gate-message">
      <button type="submit">Continue</button>
    </form>
  `;
  dialog.querySelector('p').textContent = message;
  const input = dialog.querySelector('input');
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    input.focus();
  });
  document.body.classList.add('embargo-gated');
  document.body.append(dialog);
  try {
    return await new Promise((resolve) => {
      dialog.querySelector('form').addEventListener('submit', (event) => {
        event.preventDefault();
        const password = input.value;
        input.value = '';
        resolve(password);
      });
      dialog.showModal();
      input.focus();
    });
  } finally {
    dialog.remove();
    document.body.classList.remove('embargo-gated');
  }
}

/**
 * Checks the client-side embargo gate before any page decoration.
 * @param {string} localePrefix
 */
export default async function checkEmbargoGate(localePrefix) {
  const placeholders = await fetchPlaceholders(localePrefix);
  const expectedHash = placeholders.embargoGate?.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedHash || '')) {
    throw new Error('Embargo Gate placeholder must contain a SHA-256 hex digest.');
  }

  const storageKey = 'embargo-gate';
  let hash;
  try {
    hash = sessionStorage.getItem(storageKey);
    if (hash === expectedHash) return;
    sessionStorage.removeItem(storageKey);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Unable to read the embargo gate session.', error);
  }

  await loadCSS(new URL('../styles/embargo-gate.css', import.meta.url).href);
  let message = 'This page is currently visible by invitation only.';
  while (hash !== expectedHash) {
    // eslint-disable-next-line no-await-in-loop
    const password = await promptEmbargoPassword(message);
    if (password) {
      // eslint-disable-next-line no-await-in-loop
      const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
      hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    }
    if (hash !== expectedHash) {
      message = 'A valid password is required. Please try again:';
    }
  }

  try {
    sessionStorage.setItem(storageKey, hash);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Unable to save the embargo gate session.', error);
  }
}
