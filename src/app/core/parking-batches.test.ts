import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Plane } from '@babylonjs/core/Maths/math.plane';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { ParkingVehicleBatches, partitionInstances, cellVisible } from './parking-batches';
import { ParkingRenderProfiler, SampleWindow } from './parking-profiler';

test('spatial batches preserve every parked matrix and global picking index', () => {
  const matrices = JSON.parse(readFileSync('public/models/vehicle-placements-v3.json', 'utf8')).matrices as number[][];
  const cells = partitionInstances(matrices);
  assert.equal(matrices.length, 126); assert.ok(cells.length > 1);
  assert.deepEqual(cells.flatMap(c => c.indices).sort((a, b) => a - b), matrices.map((_, i) => i));
  for (const cell of cells) cell.indices.forEach((index, i) => assert.deepEqual(cell.matrices[i], matrices[index]));
  assert.ok(cellVisible(cells[0], [new Plane(0, 1, 0, 100)]));
  assert.ok(!cellVisible(cells[0], [new Plane(0, 1, 0, -100)]));
});
test('profiling samples are bounded and invalid GPU-like values are not converted to zero', () => {
  const samples = new SampleWindow(2); samples.add(1); samples.add(3); assert.equal(samples.mean, 2);
  samples.add(5); assert.equal(samples.mean, 4); assert.equal(samples.count, 2);
  samples.add(NaN); samples.add(-1); assert.equal(samples.mean, 4);
});

test('frozen thin-instance meshes keep geometry, bounds and global picking IDs when compacted', () => {
  const engine = new NullEngine(); engine.getCaps().instancedArrays = true;
  const scene = new Scene(engine), camera = new ArcRotateCamera('camera', -Math.PI / 2, .65, 2, Vector3.Zero(), scene);
  camera.fov = .82;
  const matrices = [-40, 0, 40].map(x => Array.from(Matrix.Translation(x, 0, 0).asArray()));
  const source = CreateBox('body', { size: .2 }, scene);
  source.thinInstanceSetBuffer('matrix', new Float32Array(matrices.flat()), 16, true);
  source.freezeWorldMatrix(); source.doNotSyncBoundingInfo = true; source.alwaysSelectAsActiveMesh = true;
  const geometry = source.geometry, bounds = source.getBoundingInfo().boundingBox;
  const batches = new ParkingVehicleBatches(matrices); batches.add(source, Matrix.Identity());
  batches.update(camera, 900);
  assert.equal(source.geometry, geometry); assert.equal(scene.meshes.length, 1);
  assert.equal(source.thinInstanceCount, 1); assert.deepEqual(source.metadata.parkedIndices, [1]);
  assert.equal(source.thinInstanceGetWorldMatrices()[0].getTranslation().x, 0);
  assert.equal(source.getBoundingInfo().boundingBox, bounds); assert.ok(bounds.maximum.x > 39);
  camera.radius = 150; camera.getViewMatrix(true); batches.update(camera, 900);
  assert.equal(source.thinInstanceCount, 3); assert.deepEqual(source.metadata.parkedIndices, [0, 1, 2]);
  assert.deepEqual(source.thinInstanceGetWorldMatrices().map(m => Math.round(m.getTranslation().x)), [-40, 0, 40]);
  batches.dispose(); scene.dispose(); engine.dispose();
});

test('profiling without GPU timer support reports unavailable and releases observers', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const before = scene.onBeforeRenderObservable.observers.length;
  const profiler = new ParkingRenderProfiler(scene, engine);
  assert.equal(profiler.snapshot().gpuFrameMs, null);
  assert.ok(scene.onBeforeRenderObservable.observers.length > before);
  profiler.dispose();
  // Observable removal is deferred by Babylon until its cleanup microtask.
  assert.ok(scene.onBeforeRenderObservable.observers.every(observer => observer._willBeUnregistered));
  scene.dispose(); engine.dispose();
});

test('far LOD is opt-in and close parked cars return to their original geometry', () => {
  const engine = new NullEngine(); engine.getCaps().instancedArrays = true;
  const scene = new Scene(engine), camera = new ArcRotateCamera('camera', -Math.PI / 2, .65, 150, Vector3.Zero(), scene);
  const matrices = [-40, 0, 40].map(x => Array.from(Matrix.Translation(x, 0, 0).asArray()));
  const high = CreateBox('high', { size: .2 }, scene), low = CreateBox('low', { size: .2 }, scene);
  high.thinInstanceSetBuffer('matrix', new Float32Array(matrices.flat()), 16, true);
  high.freezeWorldMatrix(); high.doNotSyncBoundingInfo = true; high.alwaysSelectAsActiveMesh = true;
  const geometry = high.geometry, batches = new ParkingVehicleBatches(matrices); batches.add(high, Matrix.Identity(), low);
  batches.update(camera, 390); assert.ok(high.isEnabled()); assert.ok(!low.isEnabled());
  batches.setLod(true); batches.update(camera, 390); assert.ok(!high.isEnabled()); assert.ok(low.isEnabled()); assert.equal(batches.selectedLod, 3);
  camera.radius = 2; camera.getViewMatrix(true); batches.update(camera, 390);
  assert.ok(high.isEnabled()); assert.ok(!low.isEnabled()); assert.equal(high.geometry, geometry); assert.deepEqual(high.metadata.parkedIndices, [1]);
  batches.dispose(); scene.dispose(); engine.dispose();
});
