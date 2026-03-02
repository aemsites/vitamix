/**
 * Compatible-container alias and display normalization for recipe index and recipe block.
 * Used by recipe-center (facets) and recipe block (container size section) for French locale.
 */

/** Maps translated/variant values to canonical US English. Keys lowercase for lookup. */
export const CONTAINER_ALIASES = {
  '2 speed immersion blender': '2 speed immersion blender',
  '20 ounce legacy machine': '20 ounce legacy machine',
  '20-ounce': '20-ounce',
  '32-ounce': '32-ounce',
  '48-ounce': '48-ounce',
  '5 speed immersion blender': '5 speed immersion blender',
  '64-ounce classic': '64-ounce classic',
  '64-ounce low profile': '64-ounce low profile',
  '8-ounce': '8-ounce',
  'aer disc': 'Aer disc',
  'commercial 48 ounce advanced': 'Commercial 48 ounce advanced',
  'dry grains': 'Dry grains',
  'food processor attachment': 'Food processor attachment',
  '9 litre': '9 litre',
  '9 l': '9 litre',
  '8 onces': '8-ounce',
  '20 onces': '20-ounce',
  '32 onces': '32-ounce',
  '32 oz': '32-ounce',
  'classique 32 oz': '32-ounce',
  '48 onces': '48-ounce',
  '48 once': '48-ounce',
  '48 oz': '48-ounce',
  '48ounce': '48-ounce',
  '48 ounces': '48-ounce',
  'classique 48 onces': '48-ounce',
  'commercial 48 onces avancé': 'Commercial 48 ounce advanced',
  'disque aérodynamique de 48 onces': '48-ounce',
  '64 onces': '64-ounce classic',
  '64 onces classic': '64-ounce classic',
  '64 onces classique': '64-ounce classic',
  '64 oz': '64-ounce classic',
  '64 oz classique': '64-ounce classic',
  'classique de 64 onces': '64-ounce classic',
  'classique de 1': '64-ounce classic',
  '64 onces low profile': '64-ounce low profile',
  '64 onces profil bas': '64-ounce low profile',
  '64 oz profil bas': '64-ounce low profile',
  'profil bas de 64 onces': '64-ounce low profile',
  'profil bas': '64-ounce low profile',
  'profil bas de 1': '64-ounce low profile',
  'mixeur plongeant à 2 vitesses': '2 speed immersion blender',
  'mixeur plongeant à 5 vitesses': '5 speed immersion blender',
  'disque aer': 'Aer disc',
  // eslint-disable-next-line quote-props
  'aer': 'Aer disc',
  'céréales sèches': 'Dry grains',
  'accessoire pour robot culinaire': 'Food processor attachment',
};

/** English display names (title case); keys are canonical from CONTAINER_ALIASES. */
const CONTAINER_DISPLAY_EN = {
  '2 speed immersion blender': '2 Speed Immersion Blender',
  '20 ounce legacy machine': '20 Ounce Legacy Machine',
  '20-ounce': '20-Ounce',
  '32-ounce': '32-Ounce',
  '48-ounce': '48-Ounce',
  '5 speed immersion blender': '5 Speed Immersion Blender',
  '64-ounce classic': '64-Ounce Classic',
  '64-ounce low profile': '64-Ounce Low Profile',
  '8-ounce': '8-Ounce',
  'Aer disc': 'Aer Disc',
  'Commercial 48 ounce advanced': 'Commercial 48 Ounce Advanced',
  'Dry grains': 'Dry Grains',
  'Food processor attachment': 'Food Processor Attachment',
  '9 litre': '9 Litre',
};

/** French display names; keys are canonical English from CONTAINER_ALIASES. */
export const CONTAINER_DISPLAY_FR = {
  '2 speed immersion blender': 'Mixeur plongeant à 2 vitesses',
  '20 ounce legacy machine': 'Machine legacy 20 onces',
  '20-ounce': '20 onces',
  '32-ounce': '32 onces',
  '48-ounce': '48 onces',
  '5 speed immersion blender': 'Mixeur plongeant à 5 vitesses',
  '64-ounce classic': '64 onces classique',
  '64-ounce low profile': '64 onces profil bas',
  '8-ounce': '8 onces',
  'Aer disc': 'Disque aer',
  'Commercial 48 ounce advanced': 'Commercial 48 onces avancé',
  'Dry grains': 'Céréales sèches',
  'Food processor attachment': 'Accessoire pour robot culinaire',
  '9 litre': '9 litre',
};

// Match whitespace and zero-width/invisible chars (ZWNJ+ZWJ trigger joined-sequence rule)
// eslint-disable-next-line no-misleading-character-class -- intentional: ZW/invisible chars
const CONTAINER_KEY_NORMALIZE = /[\s\u200B\u200C\u200D\u2060\uFEFF]+/g;

function containerLookupKey(raw) {
  const trimmed = (raw && raw.trim()) || '';
  return trimmed
    .toLowerCase()
    .replace(CONTAINER_KEY_NORMALIZE, ' ')
    .trim();
}

/** Capitalize first letter of each word and after hyphens for unknown English values. */
function titleCaseForDisplay(str) {
  return str
    .split(/([\s-]+)/)
    .map((part) => (
      part.length > 0 ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : part
    ))
    .join('');
}

/**
 * Normalizes compatible-container values (alias → canonical, optional French display).
 * @param {string[]} containers - Raw container names
 * @param {boolean} [useFrenchDisplay=false] - If true, return French display names
 * @returns {string[]} Normalized, deduplicated names
 */
export function normalizeCompatibleContainers(containers, useFrenchDisplay = false) {
  if (!Array.isArray(containers) || containers.length === 0) return containers;
  const seen = new Set();
  return containers
    .map((c) => {
      const trimmed = (c && c.trim()) || '';
      if (!trimmed) return null;
      const key = containerLookupKey(trimmed);
      const canonical = CONTAINER_ALIASES[key];
      const resolved = canonical !== undefined ? canonical : trimmed;
      let display = resolved;
      if (useFrenchDisplay && CONTAINER_DISPLAY_FR[resolved] !== undefined) {
        display = CONTAINER_DISPLAY_FR[resolved];
      } else if (!useFrenchDisplay) {
        display = CONTAINER_DISPLAY_EN[resolved] !== undefined
          ? CONTAINER_DISPLAY_EN[resolved]
          : titleCaseForDisplay(resolved);
      }
      return display;
    })
    .filter((c) => c && !seen.has(c) && (seen.add(c), true));
}

/** True when locale is French (fr or ca/fr_ca). */
export function isFrenchContainerLocale(locale, language) {
  return locale === 'fr' || (locale === 'ca' && language === 'fr_ca');
}
