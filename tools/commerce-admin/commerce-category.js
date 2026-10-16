/* eslint-disable import/prefer-default-export -- shared category palette */
export function categoryColorClass(name) {
  const key = String(name).trim().normalize('NFKC').toLowerCase();
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) % 4294967296;
  }
  return `pim-cat-tag-i${hash % 12}`;
}
