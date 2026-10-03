import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_ZONES, INITIAL_ALARMS } from './parking-data';
import { CAMPUS_TOUR, SseFramer, parseAgentAction, parseAgentReport, snapshot, wakeCommand } from './parking-agent';

test('agent snapshot is bounded, detached and clearly demo data', () => {
  const input = structuredClone(INITIAL_ZONES);
  const state = snapshot(input, [], INITIAL_ALARMS, true, 'A', 'done');
  input[0].occupied = 0;
  assert.equal(state.source, 'browser-demo'); assert.equal(state.zones[0].occupied, 86);
  assert.equal(state.zones.length, 3); assert.ok(Number.isFinite(Date.parse(state.observedAt)));
});
test('actions permit catalog targets only, never code or unknown points', () => {
  assert.deepEqual(parseAgentAction({ id: 'a', type: 'scene.focus', target: 'A' }), { id: 'a', type: 'scene.focus', target: 'A' });
  for (const type of ['eval', '__proto__', 'gate.open']) assert.equal(parseAgentAction({ id: 'a', type, target: 'A' }), null);
  assert.equal(parseAgentAction({ id: 'a', type: 'scene.focus', target: [1, 2, 3] }), null);
  assert.equal(parseAgentAction({ id: 'a', type: 'scene.focus', target: 'D' }), null);
});
test('SSE frame parser tolerates arbitrary chunks, unicode, CRLF and comments', () => {
  const text = ': keepalive\r\n\r\nevent: answer\r\ndata: {"text":"你好"}\r\n\r\nevent: done\ndata: [DONE]\n\n';
  for (let size = 1; size < 40; size++) {
    const parser = new SseFramer(); let frames: {event:string;data:string}[] = [];
    for (let i = 0; i < text.length; i += size) frames.push(...parser.push(text.slice(i, i + size)));
    frames.push(...parser.push('', true));
    assert.deepEqual(frames, [{ event: 'answer', data: '{"text":"你好"}' }, { event: 'done', data: '[DONE]' }]);
  }
});
test('SSE joins multiline data, flushes final frame, bounds memory', () => {
  const parser = new SseFramer();
  assert.deepEqual(parser.push('event: test\ndata: one\ndata: two', true), [{ event: 'test', data: 'one\ntwo' }]);
  assert.throws(() => parser.push('x'.repeat(2_000_001)), /长度/);
});
test('voice wake words distinguish incidental speech from explicit activation', () => {
  assert.deepEqual(wakeCommand('你好，停车助手，查看停车报表'), { woke: true, command: '查看停车报表' });
  assert.deepEqual(wakeCommand('停车助手'), { woke: true, command: '' });
  assert.equal(wakeCommand('旁边有一个停车助手').woke, false);
});
test('tour uses existing finite scene locations and returns to overview', () => {
  assert.deepEqual(CAMPUS_TOUR.map(s => s.target), ['overview', 'A', 'B', 'C', 'overview']);
  assert.equal(CAMPUS_TOUR.length, 5);
  assert.ok(CAMPUS_TOUR.every(step => !!parseAgentAction({ id: 'tour', type: 'scene.focus', target: step.target })));
});
test('report parser rejects fabricated source, malformed arithmetic and unknown zones', () => {
  const zone = { id: 'A', name: '门诊停车区', capacity: 120, occupied: 86, free: 34, rate: 72 };
  const report = { source: 'browser-demo', observedAt: new Date().toISOString(), kind: 'recommendation', data: zone };
  assert.ok(parseAgentReport(report));
  assert.equal(parseAgentReport({ ...report, source: 'production' }), null);
  assert.equal(parseAgentReport({ ...report, data: { ...zone, free: 100 } }), null);
  assert.equal(parseAgentReport({ ...report, data: { ...zone, id: 'D' } }), null);
  assert.equal(parseAgentReport({ ...report, observedAt: 'bad' }), null);
});
