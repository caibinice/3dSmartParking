import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const hash = data => createHash('sha256').update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)).digest('hex');
const attributes = doc => doc.getRoot().listMeshes().map(m => [m.getName(), ...m.listPrimitives().map(p => [p.getMaterial()?.getName(), ...p.listSemantics().map(s => [s, hash(p.getAttribute(s).getArray())])])]);
const layout = doc => ({ nodes: doc.getRoot().listNodes().map(n => [n.getName(), n.getTranslation(), n.getRotation(), n.getScale()]), materials: doc.getRoot().listMaterials().map(m => [m.getName(), m.getBaseColorFactor(), m.getAlphaMode(), m.getMetallicFactor(), m.getRoughnessFactor()]) });
const report = JSON.parse(await readFile('public/models/asset-variants.json', 'utf8'));
assert.equal(report.runtimeDefault, 'original-textures-and-near-geometry');
for (const asset of report.assets) {
  assert.equal(asset.default, false);
  const bytes = await readFile(`public/models/${asset.file}`);
  assert.equal(hash(bytes), asset.sha256); assert.equal(bytes.length, asset.bytes);
  const [original, variant] = await Promise.all([io.read(`public/models/${asset.base}`), io.readBinary(bytes)]);
  assert.deepEqual(attributes(variant), attributes(original), `${asset.file}: vertex attributes changed`);
  assert.deepEqual(layout(variant), layout(original), `${asset.file}: node/material appearance changed`);
  if (asset.kind === 'ktx2') {
    assert.deepEqual(variant.getRoot().listMeshes().map(m => m.listPrimitives().map(p => hash(p.getIndices().getArray()))), original.getRoot().listMeshes().map(m => m.listPrimitives().map(p => hash(p.getIndices().getArray()))));
    assert.ok(variant.getRoot().listTextures().some(t => t.getMimeType() === 'image/ktx2'));
  } else {
    const originalPrimitives = original.getRoot().listMeshes().flatMap(m => m.listPrimitives());
    variant.getRoot().listMeshes().flatMap(m => m.listPrimitives()).forEach((p, i) => {
      if (p.getMaterial()?.getAlphaMode() !== 'OPAQUE' || /glass|lamp|light/i.test(p.getMaterial()?.getName() ?? '')) assert.equal(hash(p.getIndices().getArray()), hash(originalPrimitives[i].getIndices().getArray()), 'Protected glass/emissive topology changed');
    });
  }
}
for (const check of report.textureChecks) if (check.accepted) {
  assert.ok(check.psnr >= (check.slots.some(s => /normal/i.test(s)) ? 48 : 43)); assert.equal(check.maxAlphaError, 0);
}
for (const check of report.lodChecks) { assert.ok(check.facesAfter <= check.facesBefore); assert.ok(check.maxWorldError < .0002); assert.equal(check.physicalPixelThreshold, 32); }
const root = 'public/vendor/ktx2/9.29.0', decoder = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'));
for (const file of decoder.files) { const bytes = await readFile(`${root}/${file.file}`); assert.equal(hash(bytes), file.sha256); }
console.log(`Render-variant audit passed: ${report.assets.length} staged opt-in assets, unchanged vertices/materials, protected glass, local decoder hashes.`);
