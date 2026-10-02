// npm run prepare:traffic -- ORIGINAL_CAMPUS.glb ORIGINAL_CAR.glb
// Keep campus LODs intact; prepare a shared, canonical car rig and authored routes.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { cloneDocument, compactPrimitive, dedup, prune, simplify, textureCompress, transformMesh, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';

const [campusPath, carPath] = process.argv.slice(2);
assert.ok(campusPath && carPath, 'Provide source campus and car paths');
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(carPath), root = doc.getRoot(), template = root.listNodes()[0];
for (const node of root.listNodes().slice(1)) node.dispose();
template.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
const mesh = template.getMesh();
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const subtract = (a, b) => a.map((x, i) => x - b[i]);
const normalize = a => { const length = Math.hypot(...a); return a.map(x => x / length); };
const multiply = (a, b) => Array.from({ length: 16 }, (_, i) => {
  const row = i % 4, col = Math.floor(i / 4);
  return [0, 1, 2, 3].reduce((s, k) => s + a[k * 4 + row] * b[col * 4 + k], 0);
});
function components(primitive) {
  const positions = primitive.getAttribute('POSITION'), indices = primitive.getIndices().getArray();
  const parents = Array.from({ length: positions.getCount() }, (_, i) => i), keys = new Map();
  const find = i => { while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; } return i; };
  const union = (a, b) => { parents[find(a)] = find(b); };
  for (let i = 0; i < positions.getCount(); i++) {
    const key = positions.getElement(i, []).map(x => x.toFixed(4)).join(',');
    if (keys.has(key)) union(i, keys.get(key)); else keys.set(key, i);
  }
  for (let i = 0; i < indices.length; i += 3) { union(indices[i], indices[i + 1]); union(indices[i], indices[i + 2]); }
  const groups = new Map();
  for (let i = 0; i < positions.getCount(); i++) {
    const key = find(i), group = groups.get(key) ?? { vertices: [], indices: [] };
    group.vertices.push(i); groups.set(key, group);
  }
  for (let i = 0; i < indices.length; i += 3) groups.get(find(indices[i])).indices.push(indices[i], indices[i + 1], indices[i + 2]);
  return [...groups.values()].filter(g => g.indices.length);
}
function bounds(points) {
  return { min: [0, 1, 2].map(k => Math.min(...points.map(p => p[k]))), max: [0, 1, 2].map(k => Math.max(...points.map(p => p[k]))) };
}
const tyres = mesh.listPrimitives().find(p => p.getMaterial().getName() === 'material0017');
const tyrePositions = tyres.getAttribute('POSITION');
const rawWheels = components(tyres).map(g => {
  const { min, max } = bounds(g.vertices.map(i => tyrePositions.getElement(i, [])));
  return min.map((x, i) => (x + max[i]) / 2);
});
assert.equal(rawWheels.length, 4, 'The detailed model must contain four tyres');
const front = rawWheels.filter(p => p[1] < 0), rear = rawWheels.filter(p => p[1] > 0);
const average = points => [0, 1, 2].map(i => points.reduce((s, p) => s + p[i], 0) / points.length);
// The source mesh is tilted in XY, faces -Y, and has -Z up. Normalize once offline.
const forward = normalize(subtract(average(front), average(rear))), up = [0, 0, -1];
const right = [forward[1], -forward[0], 0];
const origin = average(rawWheels);
origin[2] = Math.max(...Array.from(tyrePositions.getArray()).filter((_, i) => i % 3 === 2));
const canonical = [right[0], up[0], forward[0], 0, right[1], up[1], forward[1], 0, right[2], up[2], forward[2], 0, -dot(right, origin), -dot(up, origin), -dot(forward, origin), 1];
const inverse = [...right, 0, ...up, 0, ...forward, 0, ...origin, 1];
transformMesh(mesh, canonical);
const wheelPoints = components(tyres).map(g => {
  const { min, max } = bounds(g.vertices.map(i => tyres.getAttribute('POSITION').getElement(i, [])));
  return { pivot: min.map((x, i) => (x + max[i]) / 2), radius: (max[1] - min[1]) / 2 };
}).sort((a, b) => b.pivot[2] - a.pivot[2] || a.pivot[0] - b.pivot[0]);
const body = doc.createMesh('vehicle-body');
const wheels = wheelPoints.map((wheel, id) => {
  const wheelMesh = doc.createMesh(`vehicle-wheel-${id}`);
  const node = doc.createNode(`vehicle-wheel-${id}`).setMesh(wheelMesh).setTranslation(wheel.pivot);
  template.addChild(node);
  return { ...wheel, id, front: wheel.pivot[2] > 0, mesh: wheelMesh };
});
let sourceTriangles = 0, rigTriangles = 0;
function subset(primitive, indices) {
  const copy = primitive.clone();
  for (const semantic of primitive.listSemantics()) {
    const attribute = primitive.getAttribute(semantic), array = attribute.getArray();
    copy.setAttribute(semantic, attribute.clone().setArray(new array.constructor(array)));
  }
  copy.setIndices(doc.createAccessor().setType('SCALAR').setBuffer(root.listBuffers()[0]).setArray(new Uint32Array(indices)));
  compactPrimitive(copy);
  return copy;
}
for (const primitive of mesh.listPrimitives()) {
  sourceTriangles += primitive.getIndices().getCount() / 3;
  const positions = primitive.getAttribute('POSITION'), groups = [[], [], [], [], []];
  const wheelMaterial = ['material0000', 'material0017'].includes(primitive.getMaterial().getName());
  for (const group of components(primitive)) {
    const wheel = wheelMaterial ? wheels.find(w => group.vertices.every(i => {
      const p = positions.getElement(i, []);
      return Math.abs(p[0] - w.pivot[0]) < 1.5 && Math.hypot(p[1] - w.pivot[1], p[2] - w.pivot[2]) < w.radius + .18;
    })) : undefined;
    groups[wheel ? wheel.id + 1 : 0].push(...group.indices);
  }
  for (let i = 0; i < groups.length; i++) {
    if (!groups[i].length) continue;
    const part = subset(primitive, groups[i]);
    if (i === 0) body.addPrimitive(part);
    else {
      const wheel = wheels[i - 1], partMesh = doc.createMesh().addPrimitive(part);
      const translation = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...wheel.pivot.map(x => -x), 1];
      transformMesh(partMesh, translation); wheel.mesh.addPrimitive(partMesh.listPrimitives()[0]); partMesh.dispose();
    }
    rigTriangles += groups[i].length / 3;
  }
}
assert.equal(rigTriangles, sourceTriangles, 'Wheel extraction must preserve all detailed geometry');
assert.ok(wheels.every(w => w.mesh.listPrimitives().length >= 2), 'Preserve both rubber and detailed rims');
template.setMesh(body).setName('vehicle-root');
for (const texture of root.listTextures()) if (/license_plates/i.test(texture.getName())) texture.dispose();
for (const [i, material] of root.listMaterials().entries()) {
  const name = material.getName(), role = name === 'material0002' ? 'car-body' : name === 'material0012' ? 'car-glass' : 'detail';
  material.setName(`vehicle-${role}-${i}`).setExtras({});
}
for (const [i, texture] of root.listTextures().entries()) texture.setName(`vehicle-texture-${i}`).setExtras({});
for (const [i, accessor] of root.listAccessors().entries()) accessor.setName(`vehicle-attribute-${i}`).setExtras({});
for (const scene of root.listScenes()) scene.setName('vehicle-scene').setExtras({});
for (const node of root.listNodes()) node.setExtras({});
const oldPlacements = JSON.parse(await readFile('public/models/vehicle-placements-v2.json', 'utf8'));
await writeFile('public/models/vehicle-placements-v3.json', JSON.stringify({ version: 3, matrices: oldPlacements.matrices.map(m => multiply(m, inverse).map(x => +x.toFixed(8))) }));
const report = { version: 3, forwardAxis: '+Z', upAxis: '+Y', trianglesPreserved: sourceTriangles, scale: .01, wheels: wheels.map(({ id, pivot, radius, front }) => ({ id, pivot, radius, front })), assets: [] };
for (const [name, ratio] of [['vehicle-desktop-v3', .85], ['vehicle-mobile-v3', .6]]) {
  const lod = cloneDocument(doc);
  await lod.transform(dedup({ keepUniqueNames: true }), weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: .00015 }), textureCompress({ encoder: sharp, resize: [1024, 1024] }), prune());
  const path = `public/models/${name}.glb`; await io.write(path, lod);
  report.assets.push({ name, bytes: (await stat(path)).size, textures: lod.getRoot().listTextures().length, meshes: lod.getRoot().listMeshes().length });
}
await writeFile('public/models/vehicle-rig-v3.json', JSON.stringify(report, null, 2) + '\n');
const campus = await io.read(campusPath), routes = [];
for (const [i, name] of ['动车1', '动车3', '动车-救护车'].entries()) {
  const channel = campus.getRoot().listAnimations().find(a => a.getName() === name).listChannels().find(c => c.getTargetPath() === 'translation');
  const node = channel.getTargetNode(), saved = node.getTranslation(), sampler = channel.getSampler(), input = sampler.getInput(), output = sampler.getOutput(), keyframes = [];
  const sample = index => { node.setTranslation(output.getElement(index, [])); const p = node.getWorldTranslation(); keyframes.push([+input.getScalar(index).toFixed(5), +p[0].toFixed(6), +p[2].toFixed(6)]); };
  for (let index = 0; index < input.getCount() - 1; index += 6) sample(index);
  sample(input.getCount() - 1); node.setTranslation(saved);
  routes.push({ id: `route-${i}`, duration: keyframes.at(-1)[0], keyframes });
}
await writeFile('public/models/traffic-routes-v3.json', JSON.stringify({ version: 3, routes, vehicles: routes.map((route, i) => ({ route: route.id, offset: [0, 35, 65][i], speed: [1, .92, 1.08][i] })) }));
console.log(JSON.stringify(report, null, 2));
