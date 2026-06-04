/**
 * Password gate for recipe review tools (client-side access control).
 */

const STORAGE_KEY = 'vitamix-recipe-tools-auth';
const PASSWORD_HASH = 'd3ac0b4e5fc503353ed0ef3d32cbac7c078478a5b9a71cb146f8b515a829de64';

/**
 * @param {string} text
 * @returns {Promise<string>}
 */
async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * @returns {boolean}
 */
function isAuthenticated() {
  try {
    return localStorage.getItem(STORAGE_KEY) === PASSWORD_HASH;
  } catch {
    return false;
  }
}

function saveAuth() {
  try {
    localStorage.setItem(STORAGE_KEY, PASSWORD_HASH);
  } catch {
    // Storage unavailable; user can re-enter on next visit.
  }
}

/**
 * @returns {HTMLElement}
 */
function createAuthModal() {
  const overlay = document.createElement('div');
  overlay.className = 'auth-overlay';
  overlay.innerHTML = `
    <div class="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <h2 id="auth-title">Password required</h2>
      <p class="auth-lead">Enter the tool password to continue.</p>
      <form class="auth-form">
        <label for="auth-password">Password</label>
        <input id="auth-password" type="password" autocomplete="current-password" required />
        <p class="auth-error" hidden></p>
        <button type="submit" class="auth-submit">Continue</button>
      </form>
    </div>
  `;
  return overlay;
}

/**
 * Blocks page interaction until the correct password is entered.
 * Persists successful auth in localStorage so it is only required once.
 * @returns {Promise<void>}
 */
export default function requireAuth() {
  if (isAuthenticated()) return Promise.resolve();

  return new Promise((resolve) => {
    document.body.classList.add('auth-locked');

    const overlay = createAuthModal();
    document.body.appendChild(overlay);

    const form = overlay.querySelector('.auth-form');
    const input = overlay.querySelector('#auth-password');
    const errorEl = overlay.querySelector('.auth-error');

    const unlock = () => {
      saveAuth();
      overlay.remove();
      document.body.classList.remove('auth-locked');
      resolve();
    };

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorEl.hidden = true;

      const entered = input.value;
      const hash = await sha256(entered);

      if (hash === PASSWORD_HASH) {
        unlock();
        return;
      }

      errorEl.textContent = 'Incorrect password. Try again.';
      errorEl.hidden = false;
      input.value = '';
      input.focus();
    });

    input.focus();
  });
}
