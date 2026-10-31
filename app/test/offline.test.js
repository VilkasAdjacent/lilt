import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publishedFiles } from '../scripts/offline-list.js';

// A file missing from the list breaks offline use only when someone is offline, so nobody would notice.
test('offline precache lists exactly the published files (fix: npm run offline-list)', () => {
  const listed = JSON.parse(readFileSync(new URL('../src/offline.json', import.meta.url), 'utf8'));
  assert.deepEqual([...listed].sort(), [...publishedFiles()].sort());
});
