export type ZoneId = 'A' | 'B' | 'C';
export interface Zone { id: ZoneId; name: string; capacity: number; occupied: number; color: string; position: [number, number]; }
export interface ParkingEvent { id: number; plate: string; zone: ZoneId; action: '入场' | '离场'; time: string; }
export interface Alarm { id: number; zone: ZoneId; title: string; level: '高' | '中' | '低'; acknowledged: boolean; }
export const INITIAL_ZONES: Zone[] = [
  { id: 'A', name: '门诊停车区', capacity: 120, occupied: 86, color: '#43dfc4', position: [-25, 18] },
  { id: 'B', name: '住院停车区', capacity: 100, occupied: 62, color: '#64a7ff', position: [8, 22] },
  { id: 'C', name: '急诊停车区', capacity: 80, occupied: 41, color: '#ad8aff', position: [32, 2] }
];
export const INITIAL_ALARMS: Alarm[] = [
  { id: 1, zone: 'A', title: '入口排队超过预设阈值', level: '中', acknowledged: false },
  { id: 2, zone: 'C', title: '急诊通道车辆停留提醒', level: '高', acknowledged: false },
  { id: 3, zone: 'B', title: '摄像头信号巡检提醒', level: '低', acknowledged: false }
];
export function totals(zones: Zone[]) {
  const capacity = zones.reduce((n, z) => n + z.capacity, 0);
  const occupied = zones.reduce((n, z) => n + z.occupied, 0);
  return { capacity, occupied, free: capacity - occupied, rate: capacity ? Math.round(occupied / capacity * 100) : 0 };
}
export function advanceSimulation(zones: Zone[], tick: number): { zones: Zone[]; event: ParkingEvent } {
  const index = tick % zones.length;
  const entering = tick % 5 !== 0;
  const target = zones[index];
  const change = entering ? (target.occupied < target.capacity ? 1 : -1) : (target.occupied > 0 ? -1 : 1);
  return {
    zones: zones.map((z, i) => i === index ? { ...z, occupied: Math.max(0, Math.min(z.capacity, z.occupied + change)) } : z),
    event: { id: tick, plate: `演示·${String(1000 + tick % 9000)}`, zone: target.id, action: change > 0 ? '入场' : '离场', time: new Date().toLocaleTimeString('zh-CN', { hour12: false }) }
  };
}
export type Quality = 'auto' | 'high' | 'balanced' | 'low';
export function resolutionScale(quality: Quality, mobile: boolean, dpr: number) {
  const max = quality === 'high' ? 1.5 : quality === 'low' ? .75 : mobile ? 1 : 1.25;
  return 1 / Math.min(Math.max(dpr, 1), max);
}
