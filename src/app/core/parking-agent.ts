import type { Alarm, ParkingEvent, Zone, ZoneId } from './parking-data';

export type AgentActionType = 'scene.focus' | 'scene.poi' | 'route.show' | 'route.clear' | 'workorder.prepare' | 'report.show' | 'tour.start' | 'tour.pause' | 'tour.resume' | 'tour.stop';
export interface AgentAction { id: string; type: AgentActionType; target: string; }
export interface AgentSnapshot {
  source: 'browser-demo'; observedAt: string; sceneReady: boolean;
  zones: { id: ZoneId; capacity: number; occupied: number }[];
  events: Omit<ParkingEvent, 'id'>[]; alerts: Alarm[]; selected: string; lastActionResult: string;
}
export interface ReportZone { id: ZoneId; name: string; capacity: number; occupied: number; free: number; rate: number; }
export interface AgentReport {
  kind: 'occupancy' | 'recommendation' | 'events' | 'alerts' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'workorders' | 'audit';
  source: 'browser-demo' | 'database-synthetic'; observedAt: string;
  data: { zones?: ReportZone[]; capacity?: number; occupied?: number; free?: number; rate?: number }
    | ReportZone | Omit<ParkingEvent, 'id'>[] | Alarm[] | Record<string,any> | Record<string,any>[];
}
export const TOOL_TARGETS: Record<AgentActionType, readonly string[]> = {
  'scene.focus': ['A', 'B', 'C', 'overview', 'top', 'vehicle'],
  'scene.poi': ['entrance','exit','parking-a','parking-b','parking-c','parking-c-side','outpatient','inpatient','emergency','charging','accessible','security'],
  'route.show': ['entrance','exit','parking-a','parking-b','parking-c','parking-c-side','outpatient','inpatient','emergency','charging','accessible','security'],
  'route.clear': ['campus'], 'workorder.prepare': ['latest','A','B','C'],
  'report.show': ['occupancy', 'events', 'alerts', 'recommendation','daily','weekly','monthly','yearly','workorders','audit'],
  'tour.start': ['campus','visitor','operations','night'], 'tour.pause': ['campus'], 'tour.resume': ['campus'], 'tour.stop': ['campus']
};
export function configureAgentTargets(tools:Record<string,string[]>) { for(const key of ['scene.poi','route.show'] as const) if(Array.isArray(tools[key])&&tools[key].length<=40&&tools[key].every(id=>/^[a-z][a-z0-9-]{1,39}$/.test(id)))TOOL_TARGETS[key]=[...tools[key]]; }
export function parseAgentAction(input: unknown): AgentAction | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  if (typeof value['id'] !== 'string' || value['id'].length > 64 || typeof value['type'] !== 'string' || typeof value['target'] !== 'string') return null;
  const type = value['type'] as AgentActionType;
  if (!Object.hasOwn(TOOL_TARGETS, type) || !TOOL_TARGETS[type].includes(value['target'])) return null;
  return { id: value['id'], type, target: value['target'] };
}
export function parseAgentReport(input: unknown): AgentReport | null {
  if (!input || typeof input !== 'object') return null;
  const v = input as Record<string, unknown>;
  if (!['browser-demo','database-synthetic'].includes(String(v['source'])) || typeof v['observedAt'] !== 'string' || !Number.isFinite(Date.parse(v['observedAt']))) return null;
  const integer = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 30000;
  const zone = (r: unknown) => {
    if (!r || typeof r !== 'object') return false;
    const z = r as Record<string, unknown>;
    return ['A', 'B', 'C'].includes(String(z['id'])) && typeof z['name'] === 'string' && z['name'].length < 100
      && ['capacity', 'occupied', 'free', 'rate'].every(k => integer(z[k]))
      && Number(z['occupied']) <= Number(z['capacity']) && Number(z['free']) === Number(z['capacity']) - Number(z['occupied']) && Number(z['rate']) <= 100;
  };
  const data = v['data'];
  if(v['source']==='database-synthetic'){
    if(v['kind']==='recommendation'&&data&&typeof data==='object'){
      const d=data as Record<string,any>;if(Array.isArray(d['candidates'])&&d['candidates'].length<=40&&d['candidates'].every((c:any)=>c&&['A','B','C'].includes(c.zone)&&integer(c.free)&&Number.isFinite(c.meters)&&typeof c.reason==='string'&&c.reason.length<=1000))return input as AgentReport;
    }
    if(['daily','weekly','monthly','yearly'].includes(String(v['kind']))&&data&&typeof data==='object'){
      const d=data as Record<string,any>;if(Array.isArray(d['occupancy'])&&d['occupancy'].length<=1100&&d['occupancy'].every((r:any)=>r&&['A','B','C'].includes(r.zone_id)&&Number.isFinite(r.average_occupied)&&Number(r.average_occupied)>=0&&Number.isFinite(r.capacity))&&d['ledger']&&Number.isFinite(Number(d['ledger'].paid_cents))&&Number(d['ledger'].paid_cents)>=0)return input as AgentReport;
    }
    if(['workorders','audit'].includes(String(v['kind']))&&Array.isArray(data)&&data.length<=100&&data.every(r=>r&&typeof r==='object'))return input as AgentReport;
  }
  if (v['kind'] === 'recommendation' && zone(data)) return input as AgentReport;
  if (v['kind'] === 'occupancy' && data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d['zones']) && d['zones'].length === 3 && d['zones'].every(zone)
      && ['capacity', 'occupied', 'free', 'rate'].every(k => integer(d[k])) && Number(d['rate']) <= 100
      && Number(d['free']) === Number(d['capacity']) - Number(d['occupied'])) return input as AgentReport;
  }
  if ((v['kind'] === 'events' || v['kind'] === 'alerts') && Array.isArray(data) && data.length <= 30
    && data.every(r => r && typeof r === 'object' && ['A', 'B', 'C'].includes(r.zone)
      && (v['kind'] === 'events' ? typeof r.plate === 'string' && r.plate.length <= 30 && typeof r.time === 'string'
        && ['入场', '离场'].includes(r.action) : typeof r.title === 'string' && r.title.length <= 100
        && integer(r.id) && ['高', '中', '低'].includes(r.level) && typeof r.acknowledged === 'boolean'))) return input as AgentReport;
  return null;
}
export function snapshot(zones: Zone[], events: ParkingEvent[], alerts: Alarm[], sceneReady: boolean, selected: string, lastActionResult: string): AgentSnapshot {
  return { source: 'browser-demo', observedAt: new Date().toISOString(), sceneReady,
    zones: zones.map(({ id, capacity, occupied }) => ({ id, capacity, occupied })),
    events: events.slice(0, 30).map(({ time, plate, zone, action }) => ({ time, plate, zone, action })),
    alerts: alerts.slice(0, 10).map(a => ({ ...a })), selected: selected.slice(0, 100), lastActionResult: lastActionResult.slice(0, 500) };
}
export interface SseFrame { event: string; data: string; }
/** Handles chunk boundaries, CRLF, multiline data and SSE comments without lossy token splitting. */
export class SseFramer {
  private buffer = '';
  push(chunk: string, final = false): SseFrame[] {
    this.buffer += chunk;
    if (this.buffer.length > 2_000_000) throw new Error('助手响应超出长度限制');
    const frames = this.buffer.split(/\r?\n\r?\n/);
    this.buffer = frames.pop() ?? '';
    if (final && this.buffer.trim()) { frames.push(this.buffer); this.buffer = ''; }
    return frames.flatMap(frame => {
      let event = 'message'; const data: string[] = [];
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      return data.length ? [{ event, data: data.join('\n') }] : [];
    });
  }
}
export function wakeCommand(text: string): { woke: boolean; command: string } {
  const match = text.trim().match(/^(?:你好[，,\s]*)?(?:停车助手|停车助理)[，,。\s]*(.*)$/);
  return match ? { woke: true, command: match[1].trim() } : { woke: false, command: '' };
}
export const CAMPUS_TOUR: { target: string; title: string; narration: string }[] = [
  { target: 'overview', title: '园区全景', narration: '欢迎来到某某中医院三维停车演示。园区分为门诊、住院和急诊三个停车区。你可以随时暂停或结束导览。' },
  { target: 'A', title: '门诊停车区', narration: '这里是A区，门诊停车区。演示容量120个泊位。当前空位请以助手报表的采样快照为准。' },
  { target: 'B', title: '住院停车区', narration: '这里是B区，住院停车区，演示容量100个泊位。可以查看出入记录，或者点击巡行车辆体验固定尾随视角。' },
  { target: 'C', title: '急诊停车区', narration: '这里是C区，急诊停车区，演示容量80个泊位。急诊通道停留提醒可在运行告警中查看。本演示未接入医院实际通行政策。' },
  { target: 'overview', title: '导览结束', narration: '我们已回到园区全景。你可以问还有多少空位、推荐停车区，或者查看停车报表。所有数据均为模拟演示。' }
];
