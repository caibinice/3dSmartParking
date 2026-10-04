// Self-host the pinned Babylon decoder and WASM binaries. No runtime CDN.
import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const version = '9.29.0', source = resolve('node_modules/@babylonjs/ktx2decoder');
const output = resolve(`public/vendor/ktx2/${version}`);
await mkdir(output, { recursive: true });
await build({ entryPoints: [join(source, 'index.js')], outfile: join(output, 'decoder.js'), bundle: true, format: 'iife', globalName: 'KTX2DECODER', minify: true, target: 'es2020', legalComments: 'eof' });
const files = ['msc_basis_transcoder.js', 'msc_basis_transcoder.wasm', 'uastc_astc.wasm', 'uastc_bc7.wasm', 'uastc_r8_unorm.wasm', 'uastc_rg8_unorm.wasm', 'uastc_rgba8_srgb_v2.wasm', 'uastc_rgba8_unorm_v2.wasm', 'zstddec.wasm'];
for (const file of files) await copyFile(join(source, 'wasm', file), join(output, file));
await copyFile(join(source, 'license.md'), join(output, 'license.md'));
await copyFile(join(source, 'NOTICE.md'), join(output, 'NOTICE.md'));
await copyFile(join(source, 'wasm/license.md'), join(output, 'wasm-license.md'));
const manifest = [];
for (const file of ['decoder.js', ...files]) {
  const data = await readFile(join(output, file));
  manifest.push({ file, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
}
await writeFile(join(output, 'manifest.json'), JSON.stringify({ version, source: '@babylonjs/ktx2decoder', files: manifest }, null, 2) + '\n');
console.log(`Self-hosted KTX2 decoder ${version}: ${manifest.length} files.`);
