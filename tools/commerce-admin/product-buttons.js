export const BUTTON_SETTINGS = ['addToCart', 'comingSoon', 'findDealer', 'findLocally', 'retired'];

export function renderProductButtons(custom) {
  return BUTTON_SETTINGS.map((setting) => `<label class="product-create-button-toggle">
    <input type="checkbox" name="${setting}"${custom[setting] === 'Yes' ? ' checked' : ''}>
    <span>${setting}</span>
  </label>`).join('');
}
