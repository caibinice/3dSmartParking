// Lossless cache/fetch reordering; no simplify, quantize, retexture or model export.
// npm run optimize:gpu -- --output-dir E:/Documents/AI/codex/tmp/parking-gpu/models
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const outputIndex = process.argv.indexOf('--output-dir');
assert.ok(outputIndex >= 0 && process.argv[outputIndex + 1], 'Supply an explicit --output-dir; source files are never overwritten');
const source = resolve('public/models'), output = resolve(process.argv[outputIndex + 1]);
assert.notEqual(source, output, 'Generate and verify in a staging directory first');
await mkdir(output, { recursive: true });
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function appearance(bytes) {
  const file = Buffer.from(bytes), json = JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString());
  return { nodes: json.nodes, scenes: json.scenes, materials: json.materials, textures: json.textures, samplers: json.samplers };
}
const canonicalTriangle = (a, b, c) => a <= b && a <= c ? `${a},${b},${c}` : b <= c ? `${b},${c},${a}` : `${c},${a},${b}`;
function triangles(indices) {
  const result = [];
  for (let i = 0; i < indices.length; i += 3) result.push(canonicalTriangle(indices[i], indices[i + 1], indices[i + 2]));
  return result.sort();
}
function cacheMisses(indices) {
  const cache = []; let misses = 0;
  for (const index of indices) {
    const hit = cache.indexOf(index);
    if (hit < 0) { misses++; if (cache.length === 32) cache.pop(); }
    else cache.splice(hit, 1);
    cache.unshift(index);
  }
  return misses;
}
function transparent(primitive) {
  const material = primitive.getMaterial();
  // These names become transparent in parking-scene.ts even when the source
  // glTF says OPAQUE. Keep their exact triangle draw order to preserve blending.
  return material?.getAlphaMode() !== 'OPAQUE' || /building|window|landscape|foundation|car-glass/.test(material?.getName() ?? '');
}
function structure(doc) {
  const root = doc.getRoot();
  return {
    nodes: root.listNodes().map(n => [n.getName(), n.getMesh()?.getName(), n.getTranslation(), n.getRotation(), n.getScale(), n.listChildren().map(c => c.getName())]),
    meshes: root.listMeshes().map(m => [m.getName(), m.listPrimitives().map(p => [p.getMode(), p.getMaterial()?.getName(), p.listSemantics(), p.getIndices()?.getCount()])]),
    materials: root.listMaterials().map(m => m.getName()),
    textures: root.listTextures().map(t => [t.getName(), t.getMimeType(), hash(t.getImage())]),
  };
}
const report = { revision: 'gpu-cache-1', method: 'lossless-vertex-cache-and-fetch', cacheModel: '32-entry LRU; proxy metric, not an FPS promise', assets: [] };
for (const name of ['campus-desktop-v2', 'campus-mobile-v2', 'vehicle-desktop-v3', 'vehicle-mobile-v3']) {
  const original = await readFile(join(source, `${name}.glb`)), doc = await io.readBinary(original);
  const before = structure(doc);
  let faces = 0, reordered = 0, blended = 0, missesBefore = 0, missesAfter = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const accessor = primitive.getIndices();
    if (!accessor || primitive.getMode() !== 4 || primitive.listTargets().length) continue;
    const old = Uint32Array.from(accessor.getArray()), indices = old.slice(), preserveOrder = transparent(primitive);
    const [remap, unique] = MeshoptEncoder.reorderMesh(indices, !preserveOrder, false);
    const oldMisses = cacheMisses(old), newMisses = cacheMisses(indices);
    // Do not publish a cache regression. Blended primitives retain order and
    // only get a vertex-fetch remap, with unchanged cache locality.
    if (newMisses > oldMisses) { faces += old.length / 3; missesBefore += oldMisses; missesAfter += oldMisses; continue; }
    const mappedOld = old.map(index => remap[index]);
    if (preserveOrder) assert.deepEqual(indices, mappedOld, 'Transparent triangle order changed');
    else assert.deepEqual(triangles(indices), triangles(mappedOld), 'Triangle geometry or winding changed');
    for (const semantic of primitive.listSemantics()) {
      const attribute = primitive.getAttribute(semantic), values = attribute.getArray(), width = attribute.getElementSize();
      const reorderedValues = new values.constructor(unique * width);
      for (let index = 0; index < attribute.getCount(); index++) {
        if (remap[index] === undefined || remap[index] >= unique) continue;
        for (let component = 0; component < width; component++) reorderedValues[remap[index] * width + component] = values[index * width + component];
      }
      // Assert every used attribute component exactly, including normal/UV/
      // tangent/color values. No quantization or Float32 conversion is added.
      for (const index of new Set(old)) for (let component = 0; component < width; component++) {
        assert.equal(reorderedValues[remap[index] * width + component], values[index * width + component], 'Vertex attribute changed');
      }
      primitive.setAttribute(semantic, attribute.clone().setArray(reorderedValues));
    }
    primitive.setIndices(accessor.clone().setArray(unique <= 65534 ? new Uint16Array(indices) : indices));
    faces += old.length / 3; reordered++; blended += preserveOrder ? 1 : 0;
    missesBefore += oldMisses; missesAfter += newMisses;
  }
  await doc.transform(prune({ propertyTypes: [PropertyType.ACCESSOR], keepAttributes: true, keepIndices: true }));
  const binary = await io.writeBinary(doc), reread = await io.readBinary(binary);
  assert.deepEqual(structure(reread), before, 'Scene layout, material bindings or texture bytes changed');
  assert.deepEqual(appearance(binary), appearance(original), 'Material parameters, samplers or node transforms changed');
  await writeFile(join(output, `${name}.glb`), binary);
  report.assets.push({ name, originalBytes: original.length, bytes: binary.length, triangles: faces, primitives: reordered, transparentOrderPreserved: blended,
    cacheMissesBefore: missesBefore, cacheMissesAfter: missesAfter, cacheMissReductionPercent: +(100 * (missesBefore - missesAfter) / missesBefore).toFixed(2),
    sourceSha256: hash(original), sha256: hash(binary), geometryAndWindingVerified: true, textureBytesVerified: true });
}
await writeFile(join(output, 'asset-gpu-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
