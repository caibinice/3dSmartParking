// Read-only model review; never writes to public/models or rewrites UV/normals.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import assert from 'node:assert/strict';
const i = process.argv.indexOf('--output'), output = i < 0 ? '' : resolve(process.argv[i + 1]);
assert.ok(output, 'Use --output FULL_PATH_TO_REPORT.json');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS), assets = [];
for (const name of ['campus-desktop-v2', 'campus-mobile-v2', 'vehicle-desktop-v3', 'vehicle-mobile-v3']) {
  const binary = await readFile(`public/models/${name}.glb`), doc = await io.readBinary(binary);
  const meshes = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    let triangles = 0, degenerate = 0, transparent = 0;
    for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute('POSITION').getArray(), indices = primitive.getIndices().getArray();
      assert.ok(positions.every(Number.isFinite)); assert.ok(indices.every(index => index >= 0 && index < positions.length / 3));
      triangles += indices.length / 3;
      if (primitive.getMaterial()?.getAlphaMode() !== 'OPAQUE') transparent += indices.length / 3;
      for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
        const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
        const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
        if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-10) degenerate++;
      }
    }
    meshes.push({ name: mesh.getName(), triangles, transparentTriangles: transparent, degenerateTriangles: degenerate });
  }
  const textures = [];
  for (const texture of doc.getRoot().listTextures()) {
    const metadata = await sharp(texture.getImage()).metadata();
    textures.push({ name: texture.getName(), width: metadata.width, height: metadata.height, baseLevelRgbaBytes: metadata.width * metadata.height * 4 });
  }
  assets.push({ name, sha256: createHash('sha256').update(binary).digest('hex'), triangles: meshes.reduce((n, m) => n + m.triangles, 0), transparentTriangles: meshes.reduce((n, m) => n + m.transparentTriangles, 0), degenerateTriangles: meshes.reduce((n, m) => n + m.degenerateTriangles, 0), estimatedUniqueBaseLevelRgbaBytes: textures.reduce((n, t) => n + t.baseLevelRgbaBytes, 0), meshes, textures });
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ schemaVersion: 1, method: 'Read-only glTF topology and unique image dimensions; GPU bytes are estimates, not driver measurements.', assets }, null, 2) + '\n');
console.table(assets.map(({ name, triangles, transparentTriangles, degenerateTriangles, estimatedUniqueBaseLevelRgbaBytes }) => ({ name, triangles, transparentTriangles, degenerateTriangles, estimatedUniqueBaseLevelRgbaMiB: (estimatedUniqueBaseLevelRgbaBytes / 1048576).toFixed(2) })));
