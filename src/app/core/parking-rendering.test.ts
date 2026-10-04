import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ParkingScene } from './parking-scene';

test('traffic reuses car and wheel quaternions, freezes on pause and resumes without a jump', () => {
  const node = { position: new Vector3(), rotationQuaternion: Quaternion.Identity() };
  const wheels = Array.from({ length: 4 }, () => ({ rotationQuaternion: Quaternion.Identity() }));
  const moving = { node, wheels, route: { id: 'test', duration: 10, keyframes: [[0, 0, 0], [10, 0, 1]] }, offset: 0, speed: 1, yaw: 0, wheelAngle: 0 };
  const noop = () => {};
  const scene = new ParkingScene({} as HTMLCanvasElement, false, noop, noop, noop);
  const runtime = scene as unknown as { fleet: typeof moving[]; rig: unknown; vehicleTime: number; updateVehicle: (delta: number) => void };
  runtime.fleet = [moving]; runtime.rig = { scale: 1, wheels: Array.from({ length: 4 }, () => ({ radius: .1 })) };
  runtime.updateVehicle(0);
  const body = node.rotationQuaternion, rolling = wheels.map(w => w.rotationQuaternion);
  for (let i = 0; i < 100; i++) runtime.updateVehicle(.01);
  assert.equal(node.rotationQuaternion, body);
  wheels.forEach((wheel, i) => assert.equal(wheel.rotationQuaternion, rolling[i]));
  const position = node.position.clone(), rotation = wheels[0].rotationQuaternion.clone(), time = runtime.vehicleTime;
  scene.setPaused(true);
  for (let i = 0; i < 100; i++) runtime.updateVehicle(.02);
  assert.equal(runtime.vehicleTime, time); assert.ok(node.position.equals(position)); assert.ok(wheels[0].rotationQuaternion.equals(rotation));
  scene.setPaused(false); runtime.updateVehicle(.01);
  assert.ok(node.position.z > position.z && node.position.z - position.z < .002);
  assert.ok(!wheels[0].rotationQuaternion.equals(rotation));
});
