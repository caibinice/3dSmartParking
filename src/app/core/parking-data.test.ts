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
  assert.equal(resolutionScale('high', false, 3), 1 / 2.5);
  assert.equal(resolutionScale('auto', true, 3), .5);
  assert.equal(resolutionScale('balanced', true, 3), 1 / 1.5);
  assert.equal(resolutionScale('low', true, 3), 1);
});
test('pixel budgets retain at least native resolution on large screens', () => {
  for (const mobile of [true, false]) {
    for (const quality of ['auto', 'high', 'balanced', 'low'] as const) {
      const scale = resolutionScale(quality, mobile, 4, 1920, 1080);
      assert.ok(scale <= 1 && scale >= .4);
      assert.ok(1920 * 1080 / scale ** 2 <= (mobile ? 4_000_000 : 8_000_000) + 1);
      assert.equal(resolutionScale(quality, mobile, 4, 3840, 2160), 1);
    }
  }
});
