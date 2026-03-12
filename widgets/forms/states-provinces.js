/**
 * Shared states/provinces data loader for form widgets.
 * Uses states-provinces.json with English as fallback for unsupported languages.
 *
 * @param {string} countryCode - ISO country code: 'US' | 'CA' | 'MX'
 * @param {string} lang - Language code: 'en' | 'fr' | 'es'
 * @returns {Promise<{ value: string, label: string }[]>} Options for select elements
 */
export default async function getStatesProvincesOptions(countryCode, lang) {
  const scriptPath = new URL(import.meta.url).pathname;
  const jsonPath = scriptPath.replace(/states-provinces\.js$/, 'states-provinces.json');
  const url = `${window.hlx?.codeBasePath || ''}${jsonPath}`;
  const resp = await fetch(url);
  const data = await resp.json();
  const country = data[countryCode];
  if (!country) return [];
  const options = country[lang] ?? country.en ?? [];
  return Array.isArray(options) ? options : [];
}
