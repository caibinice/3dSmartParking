import layout from './campus-layout.json';
import type { ZoneId } from './parking-data';

export const CAMPUS_LAYOUT = layout;
export const C_SIDE_POSITION = layout.nodes.find(n => n.id === 'parking-c-side')!;
export function zonePosition(id: ZoneId): [number, number] {
  const node = layout.nodes.find(n => n.id === `parking-${id.toLowerCase()}`)!;
  return [node.x, node.z];
}
// Camera framing includes the two separate C parking areas, while its pin stays
// in the upper-left parking lot instead of being placed on an intervening roof.
export function zoneView(id: ZoneId) {
  const [x, z] = zonePosition(id);
  return id === 'C' ? { x: 10.6, z: 2.4, radius: 15.5, beta: .42 } : { x, z, radius: 9, beta: .65 };
}
