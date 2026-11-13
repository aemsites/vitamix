import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';

// scripts/scripts.js can't be imported in Node (see scripts-environment.test.js), so the
// helper is evaluated from the source.
const source = readFileSync(new URL('../../scripts/scripts.js', import.meta.url), 'utf8');
const fn = source.match(/^export function hasSimulatedDate\(\) \{[\s\S]*?\n\}\n/m);

function evaluate({ isProdHost = false, search = '', stored = null, storage } = {}) {
  const window = {
    location: { search },
    localStorage: storage || { getItem: (key) => (key === 'vitamix.now' ? stored : null) },
  };
  return runInNewContext(`${fn[0].replace(/^export /, '')}; hasSimulatedDate();`, {
    window, isProdHost, URLSearchParams, SIMULATED_DATE_KEY: 'vitamix.now',
  });
}

describe('hasSimulatedDate', () => {
  it('is found in scripts.js', () => assert.ok(fn));

  it('is true on non-prod hosts with the parameter or a stored date', () => {
    assert.equal(evaluate({ search: '?simulateDate=2030-01-01' }), true);
    assert.equal(evaluate({ search: '?simulateDate=' }), false, 'nothing to clear');
    assert.equal(evaluate({ search: '?simulateDate=', stored: '2030-01-01T00:00:00.000Z' }), true);
    assert.equal(evaluate({ stored: '2030-01-01T00:00:00.000Z' }), true);
    assert.equal(evaluate(), false);
  });

  it('is always false on production', () => {
    assert.equal(evaluate({
      isProdHost: true, search: '?simulateDate=2030-01-01', stored: '2030-01-01T00:00:00.000Z',
    }), false);
  });

  it('is false when storage throws', () => {
    const storage = { getItem() { throw new Error('SecurityError'); } };
    assert.equal(evaluate({ storage }), false);
  });
});

describe('scripts.js', () => {
  it('loads the simulated date code only on demand', () => {
    assert.doesNotMatch(source, /^import[^;]*from '\.\/simulate-date\.js';/m);
    assert.match(source, /import\('\.\/simulate-date\.js'\)/);
  });
});
