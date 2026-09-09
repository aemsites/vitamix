/** @type {import('./types').PaymentProvider} */
export default {
  id: 'chase',
  supportsExpress: false,
  load: async () => {},
  isAvailable: () => true,
  renderExpressButton: () => {},
  renderCheckoutButton: () => {},
};
