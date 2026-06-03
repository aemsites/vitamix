export default function formatDiscountLabel(label) {
  const value = String(label || '').trim();
  return value.replace(/^#\d+\s+(ID\.me\b.*)$/i, '$1');
}
