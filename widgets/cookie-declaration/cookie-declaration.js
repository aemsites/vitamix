import { loadScript } from '../../scripts/aem.js';

export default async function decorate() {
  await loadScript('https://consent.cookiebot.com/1d1d4c74-9c10-49e5-9577-f8eb4ba520fb/cd.js');
}