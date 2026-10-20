const PREFIX = 'commerce-admin:pending-catalog:';

export function pendingCatalogKey(base, org, site) {
  return `${PREFIX}${base}/${org}/${site}`;
}

export function readPendingCatalog(key) {
  return JSON.parse(sessionStorage.getItem(key) || '{}');
}

export function trackCatalogWrite(base, org, site, requestPath) {
  const path = requestPath.split('?')[0];
  if (!path.startsWith('catalog/') || !path.endsWith('.json')) return;
  const key = pendingCatalogKey(base, org, site);
  const pending = readPendingCatalog(key);
  const productPath = path.slice('catalog'.length, -5);
  pending[productPath] = Date.now();
  sessionStorage.setItem(key, JSON.stringify(pending));
}
