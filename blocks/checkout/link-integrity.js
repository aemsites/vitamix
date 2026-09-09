/**
 * Verifies that every line item with `custom.linkedTo` references another
 * line item by SKU with at least as much quantity. Defensive guard against
 * UI bugs that could produce orphan or underprovisioned warranty lines;
 * should never fire in normal use.
 *
 * @param {Array<Object>} items - `cart.getItemsForAPI()` output
 * @returns {{valid: boolean, error?: string}}
 */
// eslint-disable-next-line import/prefer-default-export
export function validateLinkIntegrity(items) {
  const linked = items.filter((i) => i.custom?.linkedTo);
  for (let i = 0; i < linked.length; i += 1) {
    const item = linked[i];
    const { linkedTo } = item.custom;
    const parent = items.find((p) => p.sku === linkedTo);
    if (!parent) {
      return {
        valid: false,
        error: `Cart integrity error: ${item.sku} links to ${linkedTo} which is not in the order.`,
      };
    }
    if (parent.quantity < item.quantity) {
      return {
        valid: false,
        error: `Cart integrity error: ${item.sku} (qty ${item.quantity}) exceeds parent ${linkedTo} (qty ${parent.quantity}).`,
      };
    }
  }
  return { valid: true };
}
