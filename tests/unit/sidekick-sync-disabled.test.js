import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';

// scripts/scripts.js bootstraps the page at import time and loadLazy is not exported,
// so extract the real syncSku handler from the source and run it in a sandbox.
const source = readFileSync(new URL('../../scripts/scripts.js', import.meta.url), 'utf8');
const handler = source.match(/^ {2}const syncSku = async \(\) => \{[\s\S]*?\n {2}\};\n/m);

describe('sidekick sync button (temporarily disabled)', () => {
  it('finds the syncSku handler in scripts.js', () => {
    assert.ok(handler, 'expected const syncSku handler in scripts/scripts.js');
  });

  it('shows an alert pointing authors to Slack', async () => {
    const alerts = [];
    const window = { alert: (message) => alerts.push(message) };
    const syncSku = runInNewContext(
      `${handler[0].replace(/^\s*const syncSku =/, '(')
        .replace(/;\s*$/, ')')}`,
      { window },
    );
    await syncSku();
    assert.deepEqual(alerts, ['Please reach out in slack to update a product']);
  });

  it('does not load the sync modal', () => {
    assert.ok(!handler[0].includes('import('), 'syncSku must not import the sync modal');
    assert.ok(!handler[0].includes('openSyncModal'), 'syncSku must not open the sync modal');
  });

  it('still wires the handler to the custom:sync sidekick event', () => {
    assert.match(source, /sk\.addEventListener\('custom:sync', syncSku\);/);
  });
});
