export interface TrafficRoute { id: string; duration: number; keyframes: number[][]; }
export interface TrafficDefinition { route: string; offset: number; speed: number; }
export interface TrafficRoutes { version: number; routes: TrafficRoute[]; vehicles: TrafficDefinition[]; }
export interface VehicleRig { scale: number; wheels: { id: number; pivot: number[]; radius: number; front: boolean; }[]; }

interface CurvePoint { time: number; x: number; z: number; vx: number; vz: number; }
const curves = new WeakMap<TrafficRoute, CurvePoint[]>();

// Shape-preserving Hermite tangents: continuous velocity without cutting across
// the sampled road's bounding rectangles or rounding away its authored stops.
function tangent(previous: number, next: number, before: number, after: number) {
  if (previous * next <= 0) return 0;
  const a = 2 * after + before, b = after + 2 * before;
  return (a + b) / (a / previous + b / next);
}
function compileCurve(route: TrafficRoute) {
  const cached = curves.get(route);
  if (cached) return cached;
  const frames = route.keyframes;
  const first = frames[0], last = frames[frames.length - 1];
  const closed = frames.length > 2 && Math.hypot(first[1] - last[1], first[2] - last[2]) < .02;
  const points: CurvePoint[] = frames.map((frame, i) => ({
    time: closed && i === 0 ? 0 : frame[0],
    x: closed && i === frames.length - 1 ? first[1] : frame[1],
    z: closed && i === frames.length - 1 ? first[2] : frame[2], vx: 0, vz: 0,
  }));
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const previous = i ? points[i - 1] : closed ? { ...points[points.length - 2], time: points[points.length - 2].time - route.duration } : undefined;
    const next = i + 1 < points.length ? points[i + 1] : closed ? { ...points[1], time: points[1].time + route.duration } : undefined;
    if (previous && next) {
      const before = Math.max(1e-8, p.time - previous.time), after = Math.max(1e-8, next.time - p.time);
      p.vx = tangent((p.x - previous.x) / before, (next.x - p.x) / after, before, after);
      p.vz = tangent((p.z - previous.z) / before, (next.z - p.z) / after, before, after);
    } else {
      const a = previous ?? p, b = next ?? p, duration = Math.max(1e-8, b.time - a.time);
      p.vx = (b.x - a.x) / duration; p.vz = (b.z - a.z) / duration;
    }
  }
  curves.set(route, points);
  return points;
}

export function sampleRoute(route: TrafficRoute, elapsed: number, previousYaw = 0) {
  const time = ((elapsed % route.duration) + route.duration) % route.duration;
  const frames = compileCurve(route);
  let low = 0, high = frames.length - 1;
  while (low + 1 < high) { const middle = (low + high) >> 1; if (frames[middle].time <= time) low = middle; else high = middle; }
  const a = frames[low], b = frames[Math.min(low + 1, frames.length - 1)];
  const duration = Math.max(1e-8, b.time - a.time), t = Math.max(0, Math.min(1, (time - a.time) / duration));
  const t2 = t * t, t3 = t2 * t;
  const h0 = 2 * t3 - 3 * t2 + 1, h1 = t3 - 2 * t2 + t, h2 = -2 * t3 + 3 * t2, h3 = t3 - t2;
  const d0 = (6 * t2 - 6 * t) / duration, d1 = 3 * t2 - 4 * t + 1, d2 = -d0, d3 = 3 * t2 - 2 * t;
  const vx = d0 * a.x + d1 * a.vx + d2 * b.x + d3 * b.vx;
  const vz = d0 * a.z + d1 * a.vz + d2 * b.z + d3 * b.vz;
  return {
    time, x: h0 * a.x + h1 * duration * a.vx + h2 * b.x + h3 * duration * b.vx,
    z: h0 * a.z + h1 * duration * a.vz + h2 * b.z + h3 * duration * b.vz,
    yaw: Math.hypot(vx, vz) > 1e-7 ? Math.atan2(vx, vz) : previousYaw,
  };
}

export const FOLLOW_DISTANCE = .65;
export const FOLLOW_HEIGHT = .25;
export const FOLLOW_LOOK_HEIGHT = .06;
export interface TailCameraPose { eye: number[]; target: number[]; alpha: number; beta: number; radius: number; }
export function tailCameraPose(x: number, y: number, z: number, yaw: number, result?: TailCameraPose) {
  const vertical = FOLLOW_HEIGHT - FOLLOW_LOOK_HEIGHT;
  const pose = result ?? { eye: [0, 0, 0], target: [0, 0, 0], alpha: 0, beta: 0, radius: 0 };
  pose.eye[0] = x - Math.sin(yaw) * FOLLOW_DISTANCE; pose.eye[1] = y + FOLLOW_HEIGHT; pose.eye[2] = z - Math.cos(yaw) * FOLLOW_DISTANCE;
  pose.target[0] = x; pose.target[1] = y + FOLLOW_LOOK_HEIGHT; pose.target[2] = z;
  pose.alpha = -Math.PI / 2 - yaw; pose.beta = Math.atan2(FOLLOW_DISTANCE, vertical); pose.radius = Math.hypot(FOLLOW_DISTANCE, vertical);
  return pose;
}

export function nearestAngle(from: number, to: number) {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from));
}
export function rollWheel(angle: number, distance: number, radius: number) {
  return (angle + Math.max(0, distance) / radius) % (Math.PI * 2);
}
