import { Injectable, signal, computed } from '@angular/core';
import { INITIAL_ZONES, INITIAL_ALARMS, advanceSimulation, totals, ParkingEvent } from './parking-data';
@Injectable({ providedIn: 'root' })
export class ParkingStore {
  readonly zones = signal(structuredClone(INITIAL_ZONES));
  readonly alarms = signal(structuredClone(INITIAL_ALARMS));
  readonly events = signal<ParkingEvent[]>([]);
  readonly summary = computed(() => totals(this.zones()));
  private tick = 0;
  advance() {
    const next = advanceSimulation(this.zones(), ++this.tick);
    this.zones.set(next.zones);
    this.events.update(items => [next.event, ...items].slice(0, 30));
  }
  acknowledge(id: number) { this.alarms.update(items => items.map(a => a.id === id ? { ...a, acknowledged: true } : a)); }
}
