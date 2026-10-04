import {test} from 'node:test';import assert from 'node:assert/strict';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';import {Scene} from '@babylonjs/core/scene';
import {CampusPolyline,FlowingCampusRoute,navigationCameraFrame} from './parking-navigation';
test('navigation camera reserves visible room around desktop and mobile scene controls',()=>{
 const path:[number,number][]=[[0,-9],[0,4]];
 const desktop=navigationCameraFrame(path,1036,711),mobile=navigationCameraFrame(path,852,393,true);
 assert.equal(desktop.x,0);assert.ok(desktop.z>-2.5);assert.ok(desktop.radius>21.45);
 assert.ok(mobile.radius>desktop.radius&&mobile.radius<=65);
 const wide=navigationCameraFrame([[-10,0],[10,0]],1600,900);
 const narrow=navigationCameraFrame([[-10,0],[10,0]],700,900);
 assert.ok(narrow.radius>wide.radius);
});
test('flow uses arc length, avoids duplicates, respects road bends and rejects invalid paths',()=>{
 const path=new CampusPolyline([[0,0],[0,0],[0,3],[4,3]]),out={x:0,z:0,dx:0,dz:0,remaining:0};
 assert.equal(path.length,7);assert.equal(path.points.length,3);assert.deepEqual(path.sample(4,out),{x:1,z:3,dx:1,dz:0,remaining:3});
 assert.throws(()=>new CampusPolyline([[0,0],[Infinity,1]]));assert.throws(()=>new CampusPolyline([[0,0],[0,0]]));
});
test('navigation flows independently from patrol and disposal releases every route resource',()=>{
 const engine=new NullEngine(),scene=new Scene(engine);void scene.defaultMaterial;const before={meshes:scene.meshes.length,materials:scene.materials.length};
 const route=new FlowingCampusRoute(scene,[[0,-9],[0,-4],[0,4]],true);
 assert.equal(scene.meshes.length,before.meshes+3);assert.ok(scene.meshes.every(m=>!m.isPickable&&m.renderingGroupId===1));
 const first=(route as unknown as {matrices:Float32Array}).matrices.slice();
 route.update(1);assert.notDeepEqual((route as unknown as {matrices:Float32Array}).matrices,first);
 route.dispose();assert.equal(scene.meshes.length,before.meshes);assert.equal(scene.materials.length,before.materials);scene.dispose();engine.dispose();
});
