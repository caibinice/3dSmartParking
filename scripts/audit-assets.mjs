import { readFile, readdir, stat } from 'node:fs/promises';
import assert from 'node:assert/strict';

const assets = [];
for (const name of ['campus-desktop-v2', 'campus-mobile-v2', 'vehicle-desktop-v2', 'vehicle-mobile-v2']) {
  const file = await readFile(`public/models/${name}.glb`);
  assert.equal(file.readUInt32LE(0), 0x46546c67, `${name}: invalid GLB header`);
  assert.equal(file.readUInt32LE(8), file.length, `${name}: truncated GLB`);
  const json = file.subarray(20, 20 + file.readUInt32LE(12)).toString();
  const model = JSON.parse(json);
  assert.ok((model.images?.length ?? 0) >= (name.startsWith('campus') ? 18 : 7), `${name}: detailed textures were discarded`);
  assert.ok(!/武进|常州|yanglin|taobao|license_plates|files-17/i.test(json), `${name}: legacy identity metadata`);
  assert.ok(file.length < 25 * 1024 * 1024, `${name}: exceeds asset budget`);
  assert.ok(!model.animations?.length, `${name}: static LOD should not contain source animation channels`);
  assets.push({ name, bytes: file.length, textures: model.images.length, meshes: model.meshes.length });
}
for (const prefix of ['campus', 'vehicle']) {
  const desktop = assets.find(a => a.name === `${prefix}-desktop-v2`);
  const mobile = assets.find(a => a.name === `${prefix}-mobile-v2`);
  assert.equal(desktop.textures, mobile.textures, `${prefix}: mobile must preserve the material layers`);
  assert.ok(mobile.bytes <= desktop.bytes, `${prefix}: mobile LOD exceeds desktop size`);
}
const placements = JSON.parse(await readFile('public/models/vehicle-placements-v2.json', 'utf8'));
const report = JSON.parse(await readFile('public/models/asset-report-v2.json', 'utf8'));
assert.ok(report.embeddedTextTrianglesRemoved > 100, 'Baked building text removal is missing');
assert.equal(placements.matrices.length, 126, 'Original parked-vehicle layout should be retained');
assert.ok(placements.matrices.every(m => m.length === 16 && m.every(Number.isFinite)), 'Invalid instance matrix');
const route = JSON.parse(await readFile('public/models/demo-route-v2.json', 'utf8'));
assert.ok(route.duration > 120 && route.keyframes.length > 200, 'Driving route is missing');
assert.ok(route.keyframes.every((frame, i) => frame.length === 3 && frame.every(Number.isFinite) && (!i || frame[0] > route.keyframes[i - 1][0])), 'Invalid route keyframes');
async function audit(dir) {
  for (const name of await readdir(dir)) {
    const path = `${dir}/${name}`;
    if ((await stat(path)).isDirectory()) await audit(path);
    else if (/\.(ts|html|scss|json)$/.test(path) && !path.endsWith('.test.ts')) {
      assert.ok(!/武进|常州|121\.224|180\.106|192\.168|ws:\/\//.test(await readFile(path, 'utf8')), `Legacy identity/address in ${path}`);
    }
  }
}
await audit('src');
console.table(assets.map(a => ({ ...a, MiB: (a.bytes / 1048576).toFixed(2) })));
console.log('Asset/privacy audit passed: both LODs retain textures, 126 vehicles and the authored road route.');
