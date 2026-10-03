import { Injectable, signal, computed } from '@angular/core';
import { INITIAL_ZONES, INITIAL_ALARMS, advanceSimulation, totals, ParkingEvent } from './parking-data';
import type { ParkingDatabaseSnapshot } from './parking-operations';
@Injectable({ providedIn: 'root' })
export class ParkingStore {
  readonly zones = signal(structuredClone(INITIAL_ZONES));
  readonly alarms = signal(structuredClone(INITIAL_ALARMS));
  readonly events = signal<ParkingEvent[]>([]);
  readonly summary = computed(() => totals(this.zones()));
  readonly source = signal<'browser-demo'|'database-synthetic'>('browser-demo');
  readonly sampledAt = signal('');
  private tick = 0;
  advance() {
    if(this.source()==='database-synthetic')return;
    const next = advanceSimulation(this.zones(), ++this.tick);
    this.zones.set(next.zones);
    this.events.update(items => [next.event, ...items].slice(0, 30));
  }
  applyDatabaseSnapshot(value:ParkingDatabaseSnapshot){
    if(value?.source!=='database-synthetic'||!Number.isFinite(Date.parse(value.sampledAt))||!Array.isArray(value.zones)||value.zones.length!==3||new Set(value.zones.map(z=>z.id)).size!==3||!value.zones.every(z=>['A','B','C'].includes(z.id)&&Number.isInteger(z.capacity)&&Number.isInteger(z.occupied)&&z.capacity>0&&z.occupied>=0&&z.occupied<=z.capacity))throw new Error('停车数据库快照格式无效');
    this.zones.update(items=>items.map(z=>({...z,...value.zones.find(row=>row.id===z.id)})));
    this.events.set((value.events??[]).slice(0,30).map((e,i)=>({...e,id:i+1})));
    this.alarms.set((value.alerts??[]).slice(0,10).map(a=>({id:a.id,zone:a.zone,title:a.title,level:a.level,acknowledged:a.status!=='open'})));
    this.source.set('database-synthetic');this.sampledAt.set(value.sampledAt);
  }
  acknowledge(id: number) {if(this.source()==='database-synthetic')return; this.alarms.update(items => items.map(a => a.id === id ? { ...a, acknowledged: true } : a)); }
}
