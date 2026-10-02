import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FOLLOW_DISTANCE, FOLLOW_HEIGHT, nearestAngle, rollWheel, sampleRoute, tailCameraPose, type TrafficRoutes } from './parking-traffic';
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
test('canonical +Z front aligns with all four driving directions', () => {
  for (const [x, z] of [[0, 10], [10, 0], [0, -10], [-10, 0]]) {
    const pose = sampleRoute({ id: 'test', duration: 10, keyframes: [[0, 0, 0], [10, x, z]] }, 5);
    close(Math.sin(pose.yaw), x / 10); close(Math.cos(pose.yaw), z / 10);
  }
});
test('tail camera stays behind at fixed height and distance over 10000 poses', () => {
  for (let i = 0; i < 10000; i++) {
    const x = i * .012, z = Math.sin(i * .2), yaw = i * .017, y = .008;
    const pose = tailCameraPose(x, y, z, yaw), dx = pose.eye[0] - x, dz = pose.eye[2] - z;
    close(Math.hypot(dx, dz), FOLLOW_DISTANCE); close(pose.eye[1] - y, FOLLOW_HEIGHT);
    close(dx * Math.sin(yaw) + dz * Math.cos(yaw), -FOLLOW_DISTANCE);
    close(Math.cos(pose.alpha) * Math.sin(pose.beta) * pose.radius, dx);
    close(Math.sin(pose.alpha) * Math.sin(pose.beta) * pose.radius, dz);
  }
});
test('wheels rotate by travelled distance and stay still while paused', () => {
  close(rollWheel(0, Math.PI * .023, .023), Math.PI);
  close(rollWheel(1, 0, .023), 1);
  close(rollWheel(0, 2 * Math.PI * .023, .023), 0);
});
test('three authored routes loop safely and retain the heading while stopped', () => {
  const data = JSON.parse(readFileSync('public/models/traffic-routes-v3.json', 'utf8')) as TrafficRoutes;
  assert.equal(data.vehicles.length, 3); assert.equal(data.routes.length, 3);
  for (const route of data.routes) {
    assert.ok(route.keyframes.length > 600 && route.duration > 120);
    const start = sampleRoute(route, 0), loop = sampleRoute(route, route.duration);
    close(start.x, loop.x); close(start.z, loop.z);
    for (let t = 0; t < route.duration; t += .25) assert.ok(Object.values(sampleRoute(route, t)).every(Number.isFinite));
  }
  const stationary = sampleRoute({ id: 'stop', duration: 5, keyframes: [[0, 1, 2], [5, 1, 2]] }, 2, .75);
  close(stationary.yaw, .75); close(nearestAngle(Math.PI - .01, -Math.PI + .01), Math.PI + .01);
});
