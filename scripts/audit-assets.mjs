import { readFile, readdir, stat } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const assets = [];
const gpu = JSON.parse(await readFile('public/models/asset-gpu-report.json', 'utf8'));
for (const name of ['campus-desktop-v2', 'campus-mobile-v2', 'vehicle-desktop-v3', 'vehicle-mobile-v3']) {
  const file = await readFile(`public/models/${name}.glb`);
  assert.equal(file.readUInt32LE(0), 0x46546c67, `${name}: invalid GLB header`);
  assert.equal(file.readUInt32LE(8), file.length, `${name}: truncated GLB`);
  const json = file.subarray(20, 20 + file.readUInt32LE(12)).toString();
  const model = JSON.parse(json);
  assert.ok((model.images?.length ?? 0) >= (name.startsWith('campus') ? 18 : 7), `${name}: detailed textures were discarded`);
  assert.ok(!/武进|常州|yanglin|taobao|license_plates|files-17/i.test(json), `${name}: legacy identity metadata`);
  assert.ok(file.length < 25 * 1024 * 1024, `${name}: exceeds asset budget`);
  assert.ok(!model.animations?.length, `${name}: static LOD should not contain source animation channels`);
  const reordered = gpu.assets.find(asset => asset.name === name);
  assert.equal(createHash('sha256').update(file).digest('hex'), reordered?.sha256, `${name}: GPU asset hash mismatch`);
  assert.ok(reordered.geometryAndWindingVerified && reordered.textureBytesVerified, `${name}: lossless proof missing`);
  assert.ok(reordered.cacheMissesAfter <= reordered.cacheMissesBefore, `${name}: cache regression`);
  if (name.startsWith('vehicle')) {
    assert.equal(model.meshes.length, 5, `${name}: body and four rolling wheels must remain separate`);
    assert.equal(model.nodes.filter(node => /vehicle-wheel-\d+$/.test(node.name)).length, 4, `${name}: wheel pivots are missing`);
  }
  assets.push({ name, bytes: file.length, textures: model.images.length, meshes: model.meshes.length });
}
for (const prefix of ['campus', 'vehicle']) {
  const version = prefix === 'campus' ? 'v2' : 'v3';
  const desktop = assets.find(a => a.name === `${prefix}-desktop-${version}`);
  const mobile = assets.find(a => a.name === `${prefix}-mobile-${version}`);
  assert.equal(desktop.textures, mobile.textures, `${prefix}: mobile must preserve the material layers`);
  assert.ok(mobile.bytes <= desktop.bytes, `${prefix}: mobile LOD exceeds desktop size`);
}
const placements = JSON.parse(await readFile('public/models/vehicle-placements-v3.json', 'utf8'));
const report = JSON.parse(await readFile('public/models/asset-report-v2.json', 'utf8'));
assert.ok(report.embeddedTextTrianglesRemoved > 100, 'Baked building text removal is missing');
assert.equal(placements.matrices.length, 126, 'Original parked-vehicle layout should be retained');
assert.ok(placements.matrices.every(m => m.length === 16 && m.every(Number.isFinite)), 'Invalid instance matrix');
const rig = JSON.parse(await readFile('public/models/vehicle-rig-v3.json', 'utf8'));
assert.equal(rig.forwardAxis, '+Z'); assert.equal(rig.upAxis, '+Y');
assert.equal(rig.wheels.length, 4); assert.equal(rig.trianglesPreserved, 27360);
assert.ok(rig.wheels.every(w => w.radius > 0 && w.pivot.length === 3 && w.pivot.every(Number.isFinite)));
const traffic = JSON.parse(await readFile('public/models/traffic-routes-v3.json', 'utf8'));
assert.equal(traffic.routes.length, 3); assert.equal(traffic.vehicles.length, 3);
for (const route of traffic.routes) {
  assert.ok(route.duration > 120 && route.keyframes.length > 600, 'Driving route is missing');
  assert.ok(route.keyframes.every((frame, i) => frame.length === 3 && frame.every(Number.isFinite) && (!i || frame[0] > route.keyframes[i - 1][0])), 'Invalid route keyframes');
}
assert.ok(traffic.vehicles.every(v => traffic.routes.some(r => r.id === v.route) && Number.isFinite(v.offset) && v.speed > 0));
const opening = await stat('public/media/opening-v3.mp4');
assert.ok(opening.size > 1_000_000 && opening.size < 5_000_000, 'Opening video is missing or exceeds its budget');
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
console.log('Asset/privacy audit passed: both LODs retain textures, 126 parked vehicles, four wheel pivots, three traffic routes and the opening video.');
