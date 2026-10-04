// Staged variants only. Original high-detail GLBs are never overwritten.
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { getTextureColorSpace, listTextureSlots, prune } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const argument = name => { const i = process.argv.indexOf(name); return i < 0 ? '' : process.argv[i + 1]; };
const outputArg = argument('--output-dir'), encoder = argument('--encoder');
assert.ok(outputArg && encoder, 'Use --output-dir STAGING --encoder FULL_PATH_TO_TOKTX');
const source = resolve('public/models'), output = resolve(outputArg), work = join(output, '_encoding');
assert.notEqual(source, output, 'Stage and review the output before publishing');
await mkdir(work, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS), hash = data => createHash('sha256').update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)).digest('hex');
const textures = new Map();
const report = { revision: 'render-2', runtimeDefault: 'original-textures-and-near-geometry', assets: [], textureChecks: [], lodChecks: [] };
const run = (command, args) => { const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true }); assert.equal(result.status, 0, result.stderr || result.stdout); };
function geometry(doc) { return doc.getRoot().listMeshes().map(m => m.listPrimitives().map(p => [p.getMode(),p.getMaterial()?.getName(),hash(p.getIndices().getArray()),...p.listSemantics().map(s=>[s,hash(p.getAttribute(s).getArray())])])); }
function appearance(doc) { return { nodes:doc.getRoot().listNodes().map(n=>[n.getName(),n.getTranslation(),n.getRotation(),n.getScale()]),materials:doc.getRoot().listMaterials().map(m=>[m.getName(),m.getBaseColorFactor(),m.getAlphaMode(),m.getMetallicFactor(),m.getRoughnessFactor()]) }; }
function imageMetrics(original, converted) {
  assert.equal(original.length, converted.length); let error = 0, maxAlpha = 0;
  for (let i = 0; i < original.length; i++) { const d = original[i] - converted[i]; error += d * d; if (i % 4 === 3) maxAlpha = Math.max(maxAlpha, Math.abs(d)); }
  return { psnr: error ? 10 * Math.log10(255 * 255 * original.length / error) : 99, maxAlphaError: maxAlpha };
}
for (const name of ['campus-desktop-v2','campus-mobile-v2','vehicle-desktop-v3','vehicle-mobile-v3']) {
  const original = await readFile(join(source, name + '.glb')), doc = await io.readBinary(original), before = geometry(doc), layout = appearance(doc);
  let converted = 0;
  for (const texture of doc.getRoot().listTextures()) {
    const image = texture.getImage(), space = getTextureColorSpace(texture), key = hash(image) + ':' + space;
    let cached = textures.get(key);
    if (!cached) {
      const stem = join(work, key.replace(':', '-'));
      const metadata = await sharp(image).metadata(), slots = listTextureSlots(texture);
      // Keep NPOT/small labels and all alpha-bearing artwork on original lossless
      // image bytes. UASTC is deliberately not called a lossless transformation.
      const eligible = space && metadata.width % 4 === 0 && metadata.height % 4 === 0 && metadata.width >= 128 && metadata.height >= 128;
      if (!eligible) cached = { data: null, reason: 'Original: small/unsupported/mixed-color-space texture' };
      else {
        const raw = await sharp(image).ensureAlpha().raw().toBuffer();
        const hasAlpha = raw.some((value, i) => i % 4 === 3 && value !== 255);
        if (hasAlpha) cached = { data: null, reason: 'Original: alpha artwork preserved' };
        else {
          await sharp(image).ensureAlpha().png().toFile(stem + '.png');
          run(encoder, ['--t2','--genmipmap','--encode','uastc','--uastc_quality','3','--zcmp','18','--threads','4','--assign_oetf',space==='srgb'?'srgb':'linear','--assign_primaries','bt709','--upper_left_maps_to_s0t0',stem+'.ktx2',stem+'.png']);
          const ktx = join(dirname(encoder), 'ktx.exe');
          run(ktx, ['extract','--transcode','rgba8','--level','0',stem+'.ktx2',stem+'-decoded.png']);
          const decoded = await sharp(stem+'-decoded.png').ensureAlpha().raw().toBuffer(), metrics = imageMetrics(raw, decoded);
          // Normal maps need a stricter quality gate than color artwork.
          const normal = slots.some(slot => /normal/i.test(slot)), accepted = metrics.psnr >= (normal ? 48 : 43) && metrics.maxAlphaError === 0;
          cached = { data: accepted ? await readFile(stem+'.ktx2') : null, reason: accepted?'High-quality UASTC (no RDO)':'Original: quality gate retained source', metrics, sourceBytes:image.length, width:metadata.width,height:metadata.height, slots };
          report.textureChecks.push({ name:texture.getName(), sourceHash:hash(image), colorSpace:space, accepted, ...metrics, width:metadata.width,height:metadata.height, bytes:accepted?cached.data.length:image.length, originalBytes:image.length, slots });
        }
      }
      textures.set(key, cached);
    }
    if (cached.data) { texture.setImage(cached.data).setMimeType('image/ktx2'); converted++; }
  }
  if (converted) doc.createExtension(KHRTextureBasisu).setRequired(true);
  const binary = await io.writeBinary(doc), reread = await io.readBinary(binary);
  assert.deepEqual(geometry(reread), before, 'Texture variant changed geometry');
  assert.deepEqual(appearance(reread), layout, 'Texture variant changed layout or materials');
  const file = name + '-ktx2.glb'; await writeFile(join(output,file),binary);
  report.assets.push({file,kind:'ktx2',base:name+'.glb',sha256:hash(binary),bytes:binary.length,convertedTextures:converted,geometryUnchanged:true,default:false});
  console.log(`${file}: ${converted} approved textures, ${binary.length} bytes`);
}
await MeshoptSimplifier.ready;
for (const name of ['vehicle-desktop-v3','vehicle-mobile-v3']) {
  const original = await readFile(join(source,name+'.glb')), doc = await io.readBinary(original), before = appearance(doc);
  let facesBefore=0, facesAfter=0, maxWorldError=0;
  for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const indices = Uint32Array.from(primitive.getIndices().getArray()), positions = primitive.getAttribute('POSITION').getArray();
    facesBefore += indices.length / 3;
    // Glass and emissive details never change topology/draw order. Near/following
    // vehicles always use the original high-detail mesh, independent of this LOD.
    if (primitive.getMaterial()?.getAlphaMode() !== 'OPAQUE' || /glass|lamp|light/i.test(primitive.getMaterial()?.getName()??'')) { facesAfter += indices.length / 3;continue; }
    const target = Math.floor(indices.length * .55 / 3) * 3;
    const [simplified,error] = MeshoptSimplifier.simplify(indices,positions,3,target,.0001,['LockBorder']);
    const scale = MeshoptSimplifier.getScale(positions,3), worldError = error * scale * .01;
    assert.ok(worldError < .0002, 'Far-LOD error budget exceeded');
    maxWorldError = Math.max(maxWorldError,worldError);facesAfter += simplified.length / 3;
    primitive.setIndices(primitive.getIndices().clone().setArray(new Uint16Array(simplified)));
  }
  await doc.transform(prune({propertyTypes:[PropertyType.ACCESSOR],keepAttributes:true,keepIndices:true}));
  const binary = await io.writeBinary(doc);assert.deepEqual(appearance(await io.readBinary(binary)),before);
  const file=name+'-far.glb';await writeFile(join(output,file),binary);
  report.assets.push({file,kind:'far-lod',base:name+'.glb',sha256:hash(binary),bytes:binary.length,triangles:facesAfter,default:false});
  report.lodChecks.push({file,facesBefore,facesAfter,maxWorldError,physicalPixelThreshold:32,glassTopologyPreserved:true,nearGeometryPreserved:true});
  console.log(`${file}: ${facesBefore} -> ${facesAfter} triangles; world error ${maxWorldError}`);
}
await writeFile(join(output,'asset-variants.json'),JSON.stringify(report,null,2)+'\n');
