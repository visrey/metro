// Small geometry helpers on [lon, lat] polylines, distances in metres.

export type LngLat = [number, number];

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversine(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cumulative distance at each vertex. */
export function cumulative(path: LngLat[]): number[] {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + haversine(path[i - 1], path[i]));
  return cum;
}

/** Index i such that cum[i] <= s < cum[i+1] (clamped). */
function segmentIndex(cum: number[], s: number): number {
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Point at distance s along the path. */
export function pointAt(path: LngLat[], cum: number[], s: number): LngLat {
  if (s <= 0) return path[0];
  if (s >= cum[cum.length - 1]) return path[path.length - 1];
  const i = segmentIndex(cum, s);
  const span = cum[i + 1] - cum[i] || 1;
  const t = (s - cum[i]) / span;
  return [path[i][0] + (path[i + 1][0] - path[i][0]) * t, path[i][1] + (path[i + 1][1] - path[i][1]) * t];
}

/** Distance along the path of the closest point to p, and how far p is from the path. */
export function project(path: LngLat[], cum: number[], p: LngLat): { s: number; offset: number } {
  const k = Math.cos(rad(p[1]));
  let best = { s: 0, offset: Infinity };
  for (let i = 0; i < path.length - 1; i++) {
    const ax = path[i][0] * k, ay = path[i][1];
    const bx = path[i + 1][0] * k, by = path[i + 1][1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-18;
    const t = Math.max(0, Math.min(1, ((p[0] * k - ax) * dx + (p[1] - ay) * dy) / len2));
    const offset = rad(Math.hypot(p[0] * k - (ax + t * dx), p[1] - (ay + t * dy))) * R;
    if (offset < best.offset) best = { s: cum[i] + t * (cum[i + 1] - cum[i]), offset };
  }
  return best;
}

/** Ramer–Douglas–Peucker simplification with a tolerance in metres. */
export function simplify(path: LngLat[], toleranceM: number): LngLat[] {
  if (path.length < 3) return path;
  const k = Math.cos(rad(path[0][1]));
  const m = (p: LngLat) => [rad(p[0] * k) * R, rad(p[1]) * R];
  const pts = path.map(m);
  const keep = new Uint8Array(path.length);
  keep[0] = keep[path.length - 1] = 1;
  const stack: [number, number][] = [[0, path.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-9;
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > toleranceM && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return path.filter((_, i) => keep[i]);
}

/** The part of a path between distances s0 and s1 (in either order). */
export function slice(path: LngLat[], cum: number[], s0: number, s1: number): LngLat[] {
  const [a, b] = s0 <= s1 ? [s0, s1] : [s1, s0];
  const out: LngLat[] = [pointAt(path, cum, a)];
  for (let i = 0; i < path.length; i++) if (cum[i] > a && cum[i] < b) out.push(path[i]);
  out.push(pointAt(path, cum, b));
  return out;
}
