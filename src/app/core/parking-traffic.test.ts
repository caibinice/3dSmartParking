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

test('authored turns have continuous heading and stay within the sampled road envelope', () => {
  const data = JSON.parse(readFileSync('public/models/traffic-routes-v3.json', 'utf8')) as TrafficRoutes;
  for (const route of data.routes) {
    let previous = sampleRoute(route, 0);
    for (let t = 1 / 60; t < route.duration; t += 1 / 60) {
      const pose = sampleRoute(route, t, previous.yaw);
      assert.ok(Math.abs(nearestAngle(previous.yaw, pose.yaw) - previous.yaw) < .09, `${route.id}: snapped heading at ${t}`);
      previous = pose;
    }
    for (let i = 1; i < route.keyframes.length - 1; i++) {
      const frame = route.keyframes[i], before = sampleRoute(route, frame[0] - 1e-6), after = sampleRoute(route, frame[0] + 1e-6);
      assert.ok(Math.abs(nearestAngle(before.yaw, after.yaw) - before.yaw) < .0001, `${route.id}: discontinuous tangent at ${i}`);
      close(sampleRoute(route, frame[0]).x, frame[1]); close(sampleRoute(route, frame[0]).z, frame[2]);
      const next = route.keyframes[i + 1];
      for (let j = 1; j < 10; j++) {
        const pose = sampleRoute(route, frame[0] + (next[0] - frame[0]) * j / 10);
        const end = i === route.keyframes.length - 2 ? route.keyframes[0] : next;
        assert.ok(pose.x >= Math.min(frame[1], end[1]) - 1e-8 && pose.x <= Math.max(frame[1], end[1]) + 1e-8);
        assert.ok(pose.z >= Math.min(frame[2], end[2]) - 1e-8 && pose.z <= Math.max(frame[2], end[2]) + 1e-8);
      }
    }
  }
});

test('closed routes join with continuous position and heading including the imperfect source seam', () => {
  const data = JSON.parse(readFileSync('public/models/traffic-routes-v3.json', 'utf8')) as TrafficRoutes;
  for (const route of data.routes) {
    const before = sampleRoute(route, route.duration - 1e-6), after = sampleRoute(route, 1e-6);
    assert.ok(Math.hypot(before.x - after.x, before.z - after.z) < 2e-6);
    assert.ok(Math.abs(nearestAngle(before.yaw, after.yaw) - before.yaw) < .0001);
    const reverseTime = sampleRoute(route, -1e-6);
    close(reverseTime.x, before.x); close(reverseTime.z, before.z);
  }
});

test('tail camera can reuse its output object without changing fixed-distance geometry', () => {
  const result = tailCameraPose(0, 0, 0, 0), eye = result.eye, target = result.target;
  assert.equal(tailCameraPose(1, .008, 3, .8, result), result);
  assert.equal(result.eye, eye); assert.equal(result.target, target);
  close(Math.hypot(result.eye[0] - 1, result.eye[2] - 3), FOLLOW_DISTANCE);
  close(result.eye[1] - .008, FOLLOW_HEIGHT);
});
