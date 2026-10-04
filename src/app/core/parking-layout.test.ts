import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMPUS_LAYOUT, zonePosition, zoneView } from './parking-layout';
import { INITIAL_ZONES } from './parking-data';

test('top-view zone anchors put B below the building/right of A and C in the upper left', () => {
  const a = zonePosition('A'), b = zonePosition('B'), c = zonePosition('C');
  // Right-handed top camera looks from -Z: screen-right is -X, screen-up is +Z.
  assert.ok(b[0] < a[0] && b[1] < a[1]);
  assert.ok(c[0] > a[0] && c[1] > a[1]);
  INITIAL_ZONES.forEach(z => assert.deepEqual(z.position, zonePosition(z.id)));
  const side = CAMPUS_LAYOUT.nodes.find(n => n.id === 'parking-c-side')!;
  assert.equal(side.zone, 'C'); assert.ok(side.x > 9 && side.z < 0);
  assert.ok(zoneView('C').radius >= 12);
});

test('all campus points retain stable ids and connected, finite routes', () => {
  const ids = new Set(CAMPUS_LAYOUT.nodes.map(n => n.id));
  assert.equal(ids.size, CAMPUS_LAYOUT.nodes.length);
  assert.ok(CAMPUS_LAYOUT.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.z) && Math.abs(n.x) <= 40 && Math.abs(n.z) <= 40));
  const visited = new Set(['entrance']);
  for (let i = 0; i < ids.size; i++) for (const edge of CAMPUS_LAYOUT.edges) {
    assert.ok(ids.has(edge.from) && ids.has(edge.to));
    if (visited.has(edge.from)) visited.add(edge.to);
    if (visited.has(edge.to)) visited.add(edge.from);
  }
  assert.equal(visited.size, ids.size);
});
