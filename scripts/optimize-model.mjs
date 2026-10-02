// npm run optimize:model -- ORIGINAL_CAMPUS.glb ORIGINAL_CAR.glb
// Original assets remain outside the repository. Both LODs retain the same campus.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, textureCompress, cloneDocument, flatten, join as joinMeshes } from '@gltf-transform/functions';
import sharp from 'sharp';
import { MeshoptSimplifier } from 'meshoptimizer';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const [input, carInput] = process.argv.slice(2);
if (!input || !carInput) throw new Error('Provide original campus and detailed car GLB paths');
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const output = 'public/models';
await mkdir(output, { recursive: true });
const campus = await io.read(input);
const vehicle = await io.read(carInput);
const templateNode = vehicle.getRoot().listNodes()[0];
const plate = templateNode.getMesh().listPrimitives().find(p => p.getMaterial().getName() === 'material0004').getAttribute('POSITION');
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm = a => { const n = Math.hypot(...a); return a.map(v => v/n); };
const point = (attribute, i) => attribute.getElement(i, []);
const ref = Array.from({ length: plate.getCount() }, (_, i) => point(plate, i));
const first = ref[0];
const i1 = ref.reduce((best,p,i) => dot(sub(p,first),sub(p,first)) > dot(sub(ref[best],first),sub(ref[best],first)) ? i : best, 1);
const i2 = ref.reduce((best,p,i) => Math.hypot(...cross(sub(ref[i1],first),sub(p,first))) > Math.hypot(...cross(sub(ref[i1],first),sub(ref[best],first))) ? i : best, 2);
function basis(points) {
  const x = norm(sub(points[i1], points[0]));
  const z = norm(cross(x, sub(points[i2], points[0])));
  return [x, cross(z,x), z];
}
function multiply(a,b) {
  return Array.from({length:16},(_,i) => {const row=i%4,col=Math.floor(i/4); return [0,1,2,3].reduce((s,k)=>s+a[k*4+row]*b[col*4+k],0);});
}
function transform(m,p) { return [0,1,2].map(row=>m[row]*p[0]+m[4+row]*p[1]+m[8+row]*p[2]+m[12+row]); }
const referenceBasis = basis(ref);
const placements = [];
// Sample the original authored route, rather than crossing buildings with a box path.
const routeChannel=campus.getRoot().listAnimations().find(a=>a.getName()==='动车1').listChannels().find(c=>c.getTargetPath()==='translation');
const routeNode=routeChannel.getTargetNode(),routeSampler=routeChannel.getSampler(),routeInput=routeSampler.getInput(),routeOutput=routeSampler.getOutput();
const savedTranslation=routeNode.getTranslation();
const route=[];
for(let i=0;i<routeInput.getCount();i+=15){routeNode.setTranslation(point(routeOutput,i));const position=routeNode.getWorldTranslation();route.push([+routeInput.getScalar(i).toFixed(4),+position[0].toFixed(5),+position[2].toFixed(5)]);}
const last=routeInput.getCount()-1;routeNode.setTranslation(point(routeOutput,last));const end=routeNode.getWorldTranslation();route.push([+routeInput.getScalar(last).toFixed(4),+end[0].toFixed(5),+end[2].toFixed(5)]);
routeNode.setTranslation(savedTranslation);
await writeFile(join(output,'demo-route-v2.json'),JSON.stringify({duration:route.at(-1)[0],keyframes:route}));
// Recover the original parked-car layout from the repeated plate mesh.
// Shared detailed geometry then replaces millions of duplicated vertices.
for (const node of campus.getRoot().listNodes().filter(n => /^汽车/.test(n.getName()))) {
  const attribute = node.getMesh().listPrimitives().find(p => p.getMaterial().getName() === 'material0004').getAttribute('POSITION');
  assert.equal(attribute.getCount()%plate.getCount(),0,'Unexpected vehicle template');
  for (let offset=0;offset<attribute.getCount();offset+=plate.getCount()) {
    const points = ref.map((_,i) => point(attribute,offset+i));
    const targetBasis = basis(points);
    const scale = Math.hypot(...sub(points[i1],points[0]))/Math.hypot(...sub(ref[i1],ref[0]));
    const matrix = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1];
    for(let col=0;col<3;col++) for(let row=0;row<3;row++) matrix[col*4+row]=scale*[0,1,2].reduce((s,k)=>s+targetBasis[k][row]*referenceBasis[k][col],0);
    const translated = sub(points[0],transform(matrix,ref[0]));
    translated.forEach((v,i)=>matrix[12+i]=v);
    const error = Math.max(...ref.map((p,i)=>Math.hypot(...sub(transform(matrix,p),points[i]))));
    assert.ok(error<6,`Vehicle placement residual ${error}`);
    placements.push(multiply(node.getWorldMatrix(),matrix).map(v=>+v.toFixed(8)));
  }
}
assert.ok(placements.length>=100,'Detailed car placement extraction failed');
// Templates have slightly different chassis offsets. Keep tyres on the road,
// without discarding the original horizontal placement and orientation.
const vehiclePositions=templateNode.getMesh().listPrimitives().flatMap(p=>Array.from({length:p.getAttribute('POSITION').getCount()},(_,i)=>point(p.getAttribute('POSITION'),i)));
for(const matrix of placements){const minY=vehiclePositions.reduce((min,p)=>Math.min(min,transform(matrix,p)[1]),Infinity);matrix[13]=+(.008+matrix[13]-minY).toFixed(8);}
await writeFile(join(output,'vehicle-placements-v2.json'),JSON.stringify({version:2,matrices:placements}));

function role(name) {
  if (/^楼/.test(name) && !/底/.test(name)) return 'building';
  if (/^窗户荧光/.test(name)) return 'window-glow';
  if (/^窗|LED/.test(name)) return 'window';
  if (/^车位荧光/.test(name)) return 'parking-glow';
  if (/空车位|放车车位|救护车车位/.test(name)) return 'parking-base';
  if (/路灯/.test(name)) return 'lamp';
  if (/抬杆/.test(name)) return 'gate';
  if (/^地面/.test(name)) return 'ground';
  if (/箭头|线条/.test(name)) return 'road-marking';
  if (/草坪/.test(name)) return 'landscape';
  if (/楼.*底/.test(name)) return 'foundation';
  if (/material0002/.test(name)) return 'car-body';
  if (/material0012/.test(name)) return 'car-glass';
  if (/^车灯/.test(name)) return 'signal';
  return 'detail';
}
function sanitize(doc,prefix) {
  const root=doc.getRoot();
  for(const animation of root.listAnimations()) animation.dispose();
  for(const texture of root.listTextures()) {
    // Remove vendor watermark and game-branded licence plates, not all textures.
    if (/files-17|license_plates/i.test(texture.getName())) texture.dispose();
  }
  for(const [i,node] of root.listNodes().entries()) {
    const kind=/楼/.test(node.getName())?'building':/窗/.test(node.getName())?'window':/绿地/.test(node.getName())?'landscape':/道闸/.test(node.getName())?'gate':'detail';
    node.setName(`${prefix}-${kind}-${i}`).setExtras({});
  }
  for(const [i,mesh] of root.listMeshes().entries()) mesh.setName(`${prefix}-mesh-${i}`).setExtras({});
  for(const [i,material] of root.listMaterials().entries()) material.setName(`${prefix}-${role(material.getName())}-${i}`).setExtras({});
  for(const [i,texture] of root.listTextures().entries()) texture.setName(`${prefix}-texture-${i}`).setExtras({});
  for(const [i,scene] of root.listScenes().entries()) scene.setName(`${prefix}-scene-${i}`).setExtras({});
  for(const [i,accessor] of root.listAccessors().entries()) accessor.setName(`${prefix}-attribute-${i}`).setExtras({});
}
for(const node of campus.getRoot().listNodes()) {
  if(node.getName()==='字.001' || node.getName()==='平面' || /^汽车/.test(node.getName()) || node.getExtension('KHR_lights_punctual')) node.dispose();
}
// Two small text clusters are baked into the building primitive, not the sign node.
// Remove only triangles fully inside their measured world-space bounds.
let embeddedTextTriangles=0;
const textBounds=[
  [[-7.05,.235,-3.38],[-6.50,.295,-3.35]],
  [[-8.45,1.17,7.865],[-7.90,1.32,7.905]]
];
for(const node of campus.getRoot().listNodes().filter(n=>n.getName()==='楼')){
  for(const primitive of node.getMesh().listPrimitives()){
    const positions=primitive.getAttribute('POSITION'),indices=primitive.getIndices(),source=indices.getArray(),matrix=node.getWorldMatrix();
    const inside=Array.from({length:positions.getCount()},(_,i)=>{
      const p=transform(matrix,point(positions,i));
      return textBounds.some(([min,max])=>p.every((v,k)=>v>=min[k]&&v<=max[k]));
    });
    const kept=[];
    for(let i=0;i<source.length;i+=3){
      if(inside[source[i]]&&inside[source[i+1]]&&inside[source[i+2]])embeddedTextTriangles++;
      else kept.push(source[i],source[i+1],source[i+2]);
    }
    indices.setArray(new source.constructor(kept));
  }
}
assert.ok(embeddedTextTriangles>100&&embeddedTextTriangles<5000,'Embedded text bounds need review');
sanitize(campus,'campus');
// One master vehicle, seven detailed material parts, shared for all 126 placements.
for(const node of vehicle.getRoot().listNodes().slice(1)) node.dispose();
templateNode.setTranslation([0,0,0]).setRotation([0,0,0,1]).setScale([1,1,1]);
sanitize(vehicle,'vehicle');
const report={sourceBytes:(await stat(input)).size,parkedVehicleInstances:placements.length,embeddedTextTrianglesRemoved:embeddedTextTriangles,assets:[]};
for(const [name,source,ratio,textureSize] of [
  ['campus-desktop-v2',campus,.88,4096],
  ['campus-mobile-v2',campus,.65,2048],
  ['vehicle-desktop-v2',vehicle,.85,1024],
  ['vehicle-mobile-v2',vehicle,.6,1024]
]) {
  const doc=cloneDocument(source);
  if(source===campus) await doc.transform(flatten({cleanup:false}),joinMeshes({cleanup:false}));
  await doc.transform(dedup({keepUniqueNames:true}),weld(),simplify({simplifier:MeshoptSimplifier,ratio,error:.00015}),textureCompress({encoder:sharp,resize:[textureSize,textureSize]}),prune());
  const path=join(output,`${name}.glb`);
  await io.write(path,doc);
  const root=doc.getRoot();
  const vertices=root.listMeshes().reduce((n,m)=>n+m.listPrimitives().reduce((s,p)=>s+p.getAttribute('POSITION').getCount(),0),0);
  report.assets.push({name,bytes:(await stat(path)).size,vertices,textures:root.listTextures().length});
}
await writeFile(join(output,'asset-report-v2.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
