/**
 * @param {unknown} raw
 * @returns {number}
 */
function parseOrderTimestamp(raw) {
  if (raw == null || raw === '') return 0;
  const value = String(raw);
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) return parsed;
  const safeOrderIdMatch = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2}\.\d{3}Z)/);
  if (!safeOrderIdMatch) return 0;
  const safeParsed = Date.parse(`${safeOrderIdMatch[1]}:${safeOrderIdMatch[2]}:${safeOrderIdMatch[3]}`);
  return Number.isNaN(safeParsed) ? 0 : safeParsed;
}

/**
 * Sorts customer orders newest first using the best available timestamp.
 *
 * @param {unknown[]} orders
 * @returns {unknown[]}
 */
export default function sortAccountOrdersNewestFirst(orders) {
  return [...orders].sort((a, b) => {
    const orderA = a && typeof a === 'object' ? /** @type {Record<string, unknown>} */ (a) : {};
    const orderB = b && typeof b === 'object' ? /** @type {Record<string, unknown>} */ (b) : {};
    const dateA = parseOrderTimestamp(
      orderA.createdAt || orderA.created_at || orderA.date || orderA.placedAt
        || orderA.updatedAt || orderA.updated_at || orderA.id || orderA.orderId,
    );
    const dateB = parseOrderTimestamp(
      orderB.createdAt || orderB.created_at || orderB.date || orderB.placedAt
        || orderB.updatedAt || orderB.updated_at || orderB.id || orderB.orderId,
    );
    return dateB - dateA;
  });
}
