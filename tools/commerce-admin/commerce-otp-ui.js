/**
 * Minimal UI helpers for Commerce OTP (from productbus-admin/ui.js).
 */

function getRoot() {
  const auth = document.getElementById('commerce-admin-auth-root');
  if (auth && auth.style.display !== 'none') return auth;
  return document.body;
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Colored pill for catalog group / coupon year in overview tables and modals.
 * @param {unknown} raw
 * @returns {string}
 */
export function commerceGroupBadgeHtml(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s === '—') {
    return '<span class="commerce-admin-group-badge commerce-admin-group-badge-muted">—</span>';
  }
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h += s.charCodeAt(i) * (i + 1);
  }
  const n = h % 8;
  return `<span class="commerce-admin-group-badge commerce-admin-group-badge-hue-${n}">${escapeHtml(s)}</span>`;
}

export function showToast(message, type = 'success') {
  const existing = document.querySelector('.commerce-admin-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.classList.add('commerce-admin-toast', type === 'error' ? 'error' : 'success');
  toast.textContent = message;
  getRoot().appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}
