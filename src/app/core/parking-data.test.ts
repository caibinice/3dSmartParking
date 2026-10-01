import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_ZONES, advanceSimulation, totals, resolutionScale } from './parking-data';
test('zone totals use one data source', () => assert.deepEqual(totals(INITIAL_ZONES), { capacity: 300, occupied: 189, free: 111, rate: 63 }));
test('simulation preserves capacity bounds and one-car conservation', () => {
  let zones = structuredClone(INITIAL_ZONES);
  for (let tick = 0; tick < 3000; tick++) {
    const before = totals(zones).occupied;
    const next = advanceSimulation(zones, tick);
    zones = next.zones;
    assert.equal(Math.abs(totals(zones).occupied - before), 1);
    assert.ok(zones.every(z => z.occupied >= 0 && z.occupied <= z.capacity));
    assert.equal(totals(zones).free + totals(zones).occupied, 300);
  }
});
test('empty metrics and bounded resolution', () => {
  assert.equal(totals([]).rate, 0);
  assert.equal(resolutionScale('high', false, 3), 1 / 1.5);
  assert.equal(resolutionScale('auto', true, 3), 1);
  assert.ok(resolutionScale('low', true, 3) > 1);
});
