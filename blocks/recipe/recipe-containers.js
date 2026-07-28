/**
 * Parses hidden compatible-container names from placeholders ("Hidden Containers").
 * @param {Object} placeholders - Placeholders from fetchPlaceholders
 * @returns {Set<string>} Lowercase container names to exclude from UI and search
 */
export function getHiddenContainers(placeholders = {}) {
  const raw = placeholders.hiddenContainers || '';
  if (!raw || typeof raw !== 'string') return new Set();
  return new Set(
    raw.split(',').map((name) => name.trim().toLowerCase()).filter(Boolean),
  );
}

/**
 * Whether a compatible-container name is listed as hidden in placeholders.
 * @param {string} name - Container name
 * @param {Set<string>} hiddenContainers - From getHiddenContainers
 * @returns {boolean}
 */
export function isHiddenContainer(name, hiddenContainers) {
  if (!name || !hiddenContainers?.size) return false;
  return hiddenContainers.has(String(name).trim().toLowerCase());
}

/**
 * Returns container names with hidden entries removed (preserves visible order).
 * @param {string[]} containers - Container names
 * @param {Set<string>} hiddenContainers - From getHiddenContainers
 * @returns {string[]}
 */
export function filterVisibleContainers(containers, hiddenContainers) {
  if (!Array.isArray(containers) || !hiddenContainers?.size) return containers || [];
  return containers.filter((name) => !isHiddenContainer(name, hiddenContainers));
}
