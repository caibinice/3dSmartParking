export interface TrafficRoute { id: string; duration: number; keyframes: number[][]; }
export interface TrafficDefinition { route: string; offset: number; speed: number; }
export interface TrafficRoutes { version: number; routes: TrafficRoute[]; vehicles: TrafficDefinition[]; }
export interface VehicleRig { scale: number; wheels: { id: number; pivot: number[]; radius: number; front: boolean; }[]; }

export function sampleRoute(route: TrafficRoute, elapsed: number, previousYaw = 0) {
  const time = ((elapsed % route.duration) + route.duration) % route.duration;
  const frames = route.keyframes;
  let low = 0, high = frames.length - 1;
  while (low + 1 < high) { const middle = (low + high) >> 1; if (frames[middle][0] <= time) low = middle; else high = middle; }
  const a = frames[low], b = frames[Math.min(low + 1, frames.length - 1)];
  const fraction = Math.max(0, Math.min(1, (time - a[0]) / Math.max(1e-8, b[0] - a[0])));
  const dx = b[1] - a[1], dz = b[2] - a[2];
  return { time, x: a[1] + dx * fraction, z: a[2] + dz * fraction, yaw: Math.hypot(dx, dz) > 1e-7 ? Math.atan2(dx, dz) : previousYaw };
}

export const FOLLOW_DISTANCE = .65;
export const FOLLOW_HEIGHT = .25;
export const FOLLOW_LOOK_HEIGHT = .06;
export function tailCameraPose(x: number, y: number, z: number, yaw: number) {
  const vertical = FOLLOW_HEIGHT - FOLLOW_LOOK_HEIGHT;
  return {
    eye: [x - Math.sin(yaw) * FOLLOW_DISTANCE, y + FOLLOW_HEIGHT, z - Math.cos(yaw) * FOLLOW_DISTANCE],
    target: [x, y + FOLLOW_LOOK_HEIGHT, z],
    alpha: -Math.PI / 2 - yaw,
    beta: Math.atan2(FOLLOW_DISTANCE, vertical),
    radius: Math.hypot(FOLLOW_DISTANCE, vertical),
  };
}

export function nearestAngle(from: number, to: number) {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from));
}
export function rollWheel(angle: number, distance: number, radius: number) {
  return (angle + Math.max(0, distance) / radius) % (Math.PI * 2);
}
