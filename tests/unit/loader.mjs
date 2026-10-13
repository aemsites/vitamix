/**
 * Node ESM loader hook for the unit-test runner.
 *
 * Intercepts imports that pull in browser-only bootstrap code and redirects
 * them to lightweight mocks under tests/unit/mocks. This lets modules under
 * test be imported without depending on browser globals or Helix-specific
 * bootstrapping.
 *
 * Registered from tests/unit/setup.mjs via `module.register`.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const mockUrl = (file) => pathToFileURL(resolvePath(here, 'mocks', file)).href;

const redirects = [
  { match: (s) => s === './commerce-config.js' || s.endsWith('/commerce-config.js'), file: 'commerce-config.mjs' },
  { match: (s) => s === './aem.js' || s === '../aem.js' || s.endsWith('/scripts/aem.js'), file: 'aem.mjs' },
  { match: (s) => s === './scripts.js' || s === '../scripts.js' || s.endsWith('/scripts/scripts.js'), file: 'scripts.mjs' },
];

export async function resolve(specifier, context, nextResolve) {
  for (const { match, file } of redirects) {
    if (match(specifier)) {
      return { url: mockUrl(file), shortCircuit: true, format: 'module' };
    }
  }
  return nextResolve(specifier, context);
}
