/**
 * Derives the customer-facing status from an EBS order-status response.
 *
 * @param {Record<string, any>|null} result - Parsed API response
 * @returns {string} Status key matching a key in the localized copy
 */
export default function deriveOrderStatusKey(result) {
  if (!result?.succeeded) return 'unavailable';

  // The forms action is the source of truth for EBS line-item status. It
  // calculates the Magento-compatible result before removing line items from
  // the public response.
  const normalizedStatus = result.order?.status;
  if (['received', 'processed', 'partiallyShipped', 'shipped', 'cancelled', 'unavailable'].includes(normalizedStatus)) {
    return normalizedStatus;
  }

  if (result.outcome === 'Cancelled') return 'cancelled';
  if (result.outcome === 'Partially Cancelled') return 'partiallyShipped';

  // Prefer EBS line-item states when they are present. The EBS response uses
  // these states to distinguish an entered order from one that has been
  // booked/processed, even when no delivery has been created yet.
  const lineItems = [].concat(result.order?.lineItem ?? []);
  if (lineItems.length > 0) {
    const activeItems = lineItems.filter((item) => !(
      String(item.status ?? '').toUpperCase() === 'CLOSED'
      && String(item.quantity ?? '') === '0'
    ));
    if (activeItems.length === 0) return 'cancelled';

    const statuses = activeItems.map((item) => String(item.status ?? '').toUpperCase());
    const shipped = statuses.filter((status) => status === 'SHIPPED' || status === 'CLOSED').length;
    const processed = statuses.filter((status) => ['BOOKED', 'AWAITINGSHIPPING', 'PICKED'].includes(status)).length;
    const received = statuses.filter((status) => status === 'ENTERED').length;

    if (shipped === activeItems.length) return 'shipped';
    if (shipped > 0) return 'partiallyShipped';
    if (processed === activeItems.length) return 'processed';
    if (processed + received === activeItems.length) return 'received';
    return 'unavailable';
  }

  // Some response transforms expose the aggregate EBS order state instead of
  // line items. Keep the same Magento-compatible mapping for those responses.
  const orderState = String(result.order?.state ?? result.order?.status ?? '').toUpperCase();
  if (['BOOKED', 'AWAITINGSHIPPING', 'PICKED'].includes(orderState)) return 'processed';
  if (orderState === 'ENTERED') return 'received';
  if (orderState === 'SHIPPED' || orderState === 'CLOSED') return 'shipped';

  // Delivery remains the fallback for the privacy-filtered response currently
  // returned by the forms action.
  const deliveries = [].concat(result.order?.delivery ?? []);
  const shippedCount = deliveries.filter((d) => d.shipped).length;
  if (shippedCount === 0) return deliveries.length ? 'processed' : 'received';
  if (shippedCount < deliveries.length) return 'partiallyShipped';
  return 'shipped';
}
