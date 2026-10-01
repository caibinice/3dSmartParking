// Usage: node scripts/optimize-model.mjs ORIGINAL.glb public/models/campus-v1.glb
// Keep the original model in an external backup, outside this repository.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Provide input and output GLB paths');
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(input);
const root = document.getRoot();
for (const node of root.listNodes()) {
  if (node.getName() === '平面' || /字|医院|公司|text|sign|汽车|救护车|动车|车轮|车 动|yanglin|tire|chassis|car|wheel/i.test(node.getName())) node.dispose();
}
// Remove all image textures, including marks baked into ambulance/building images.
for (const texture of root.listTextures()) texture.dispose();
for (const material of root.listMaterials()) {
  material.setMetallicFactor(0).setRoughnessFactor(0.85).setAlphaMode('OPAQUE').setAlpha(1);
}
for (const [index, node] of root.listNodes().entries()) {
  const kind = /地面|平面|楼底/.test(node.getName()) ? 'ground' : /窗/.test(node.getName()) ? 'window' : /楼/.test(node.getName()) ? 'building' : 'node';
  node.setName(`campus-${kind}-${index}`);
}
for (const [index, mesh] of root.listMeshes().entries()) mesh.setName(`campus-mesh-${index}`);
for (const [index, material] of root.listMaterials().entries()) material.setName(`campus-material-${index}`);
for (const animation of root.listAnimations()) animation.dispose();
await document.transform(dedup(), weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.15, error: 0.001 }), prune());
await mkdir(dirname(output), { recursive: true });
await io.write(output, document);
console.log(JSON.stringify({ sourceBytes: (await stat(input)).size, outputBytes: (await stat(output)).size, meshes: root.listMeshes().length, textures: root.listTextures().length }));
