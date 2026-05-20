/**
 * Node ESM loader hook for the unit-test runner.
 *
 * Intercepts any import that resolves to `commerce-config.js` and redirects it
 * to tests/unit/mocks/commerce-config.mjs. This lets cart.js (and any other
 * module under test) be imported without pulling in the real config — which
 * depends on browser globals and Helix-specific bootstrapping.
 *
 * Registered from tests/unit/setup.mjs via `module.register`.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const mockUrl = pathToFileURL(resolvePath(here, 'mocks/commerce-config.mjs')).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === './commerce-config.js' || specifier.endsWith('/commerce-config.js')) {
    return { url: mockUrl, shortCircuit: true, format: 'module' };
  }
  return nextResolve(specifier, context);
}
