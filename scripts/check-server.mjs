/** Verify emitted Node ESM imports and the deployed entry-point contract. */
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const data = JSON.parse(await readFile('src/meteor_station/data/orbits.json', 'utf8'));
let calls = 0;
globalThis.fetch = async () => {
  calls++;
  return new Response(JSON.stringify(data.records));
};
const { default: endpoint } = await import('../build/server/api/orbits.js');
for (let index = 0; index < 2; index++) {
  const response = await endpoint.fetch(new Request('https://station.test/api/orbits'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).records.length, 2);
}
assert.equal(calls, 1);
console.log('Emitted Node ESM endpoint loads, responds, and caches successfully.');
