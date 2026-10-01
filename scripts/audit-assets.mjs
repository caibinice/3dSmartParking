import { readFile, readdir, stat } from 'node:fs/promises';
import assert from 'node:assert/strict';
const file = await readFile('public/models/campus-v1.glb');
const length = file.readUInt32LE(12);
const json = file.subarray(20, 20 + length).toString();
const model = JSON.parse(json);
assert.equal(model.images?.length ?? 0, 0, 'Anonymized model must have no image textures');
assert.ok(!/武进|常州|医院|公司|yanglin|taobao|字/.test(json), 'Model metadata must be anonymized');
assert.ok(file.length < 40 * 1024 * 1024, 'Model exceeds budget');
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
console.log(`Asset/privacy audit passed: ${(file.length / 1048576).toFixed(2)} MiB, no embedded images.`);
