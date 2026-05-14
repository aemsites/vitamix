/**
 * Google Pay provider stub.
 *
 * Implementation requires:
 * - Load: https://pay.google.com/gp/p/js/pay.js
 * - isAvailable: new google.payments.api.PaymentsClient({environment:'PRODUCTION'})
 *     .isReadyToPay({apiVersion:2, apiVersionMinor:0, allowedPaymentMethods:[...]})
 * - renderExpressButton: client.createButton({onClick, buttonType:'buy'})
 * - renderCheckoutButton: same
 * - Payment token: passed to initiatePayment as provider='google-pay', paymentMethod='google-pay'
 * - Merchant config (merchantId, merchantName) must come from CommerceConfig
 *   or the initiatePayment response
 *
 * @type {import('./types').PaymentProvider}
 */
export default {
  id: 'google-pay',
  label: 'Google Pay',
  supportsExpress: true,
  hidesBilling: true,
  load: async () => { throw new Error('Google Pay is not implemented'); },
  isAvailable: () => false,
  renderExpressButton: () => {},
  renderCheckoutButton: () => {},
};
