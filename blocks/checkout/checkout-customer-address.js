import {
  authFetch,
  getUser,
  isLoggedIn,
} from '../../scripts/auth-api.js';
import { getConfig } from '../../scripts/commerce-config.js';

/** @param {unknown} payload */
function unwrapPayload(payload) {
  if (payload && typeof payload === 'object' && 'data' in payload) return payload.data;
  return payload;
}

/** @param {Response} response */
async function readResponse(response) {
  if (!response.ok) throw new Error(`customer address request failed: ${response.status}`);
  return response.json();
}

/** @param {unknown} payload */
export function normalizeAddresses(payload) {
  const value = unwrapPayload(payload);
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    if (Array.isArray(value.addresses)) return value.addresses;
    if (Array.isArray(value.items)) return value.items;
  }
  return [];
}

/**
 * Loads the signed-in customer's default address, hydrating list stubs when necessary.
 * @returns {Promise<Record<string, unknown>|null>}
 */
export async function getDefaultCustomerAddress() {
  if (!isLoggedIn()) return null;
  const email = getUser()?.email;
  if (!email) return null;

  const base = `${getConfig().apiOrigin}/customers/${encodeURIComponent(email)}/addresses`;
  const addresses = normalizeAddresses(await readResponse(await authFetch(base)));
  const defaultAddress = addresses.find((address) => address?.isDefault === true);
  if (!defaultAddress) return null;

  const hasPostalFields = defaultAddress.address1 || defaultAddress.city || defaultAddress.zip;
  if (hasPostalFields) return { ...defaultAddress, email: defaultAddress.email || email };

  const id = defaultAddress.id || defaultAddress.addressId;
  if (!id) return null;
  const payload = unwrapPayload(await readResponse(
    await authFetch(`${base}/${encodeURIComponent(String(id))}`),
  ));
  const detail = payload && typeof payload === 'object' && 'address' in payload
    ? payload.address
    : payload;
  if (!detail || typeof detail !== 'object') return null;
  return { ...defaultAddress, ...detail, email: detail.email || email };
}

/**
 * Copies a customer address into an empty checkout shipping form.
 * @param {HTMLFormElement} form
 * @param {Record<string, unknown>} address
 * @param {string} locale
 * @returns {boolean} whether the form was populated
 */
export function populateDefaultShippingAddress(form, address, locale) {
  if (!address || form.elements['shipping-street-0']?.value?.trim()) return false;
  const country = String(address.country || '').toLowerCase();
  if (!country || country !== String(locale).toLowerCase()) return false;

  const fullName = String(address.name || '').trim().split(/\s+/);
  const values = {
    email: address.email,
    'shipping-firstname': address.firstName || fullName.shift(),
    'shipping-lastname': address.lastName || fullName.join(' '),
    'shipping-street-0': address.address1,
    'shipping-street-1': address.address2,
    'shipping-city': address.city,
    'shipping-state': address.state,
    'shipping-zip': address.zip,
    'shipping-telephone': address.phone,
  };

  Object.entries(values).forEach(([name, value]) => {
    const field = form.elements[name];
    if (field && value != null) field.value = String(value);
  });
  form.elements['shipping-state']?.classList.toggle(
    'has-value',
    !!form.elements['shipping-state'].value,
  );
  return true;
}

/**
 * Loads, populates, validates, and activates a signed-in customer's default address.
 * Dependencies are injectable so the checkout lifecycle can be tested without rendering the block.
 * @param {Object} options
 * @param {HTMLFormElement} options.form
 * @param {string} options.locale
 * @param {() => Promise<Record<string, unknown>|null>} [options.loadAddress]
 * @param {(form: HTMLFormElement, locale: string) => void} options.save
 * @param {() => Promise<boolean>} options.validate
 * @param {() => void} options.refresh
 * @returns {Promise<boolean>} whether a validated default address was activated
 */
export async function prefillDefaultShippingAddress({
  form,
  locale,
  loadAddress = getDefaultCustomerAddress,
  save,
  validate,
  refresh,
}) {
  const address = await loadAddress();
  if (!populateDefaultShippingAddress(form, address, locale)) return false;
  save(form, locale);
  if (!await validate()) return false;
  refresh();
  return true;
}
