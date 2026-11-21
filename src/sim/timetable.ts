// Builds a full simulated service day: every trip, with a position + timestamp
// per vertex. Pure functions — no DOM, no map — so it's easy to test.

import { cumulative, pointAt, project, simplify, type LngLat } from './geo';
import { hopTime, timeAtDistance, type MotionParams } from './motion';

export interface ServiceSpec {
  utcOffsetMinutes: number;
  firstDeparture: string;
  lastDeparture: string;
  motion: { maxSpeedKmh: number; accel: number; dwellSec: number; interchangeDwellSec: number };
  headways: { from: string; to: string; minutes: number }[];
  /** Per line id, or per branch (`blue:4`), which falls back to its line. */
  lines: Record<string, { headwayScale?: number; maxSpeedKmh?: number } | undefined>;
}

export interface Stop {
  id: string;
  name: string;
  s: number;
  interchange: boolean;
}

export interface Route {
  lineId: string;
  path: LngLat[];
  cum: number[];
  stops: Stop[];
}

export interface StopTime {
  name: string;
  arr: number;
  dep: number;
}

export interface Trip {
  id: string;
  lineId: string;
  color: [number, number, number];
  towards: string;
  path: LngLat[];
  /** Seconds since local midnight of the service day, one per path vertex. */
  timestamps: number[];
  start: number;
  end: number;
  stops: StopTime[];
}

export interface StationInput {
  id: string;
  name: string;
  coords: LngLat;
  interchange: boolean;
}

export const hhmm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 3600 + m * 60;
};

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Snap a line's stations onto its track and order them along it. */
export function buildRoute(lineId: string, coords: LngLat[], stations: StationInput[], maxOffsetM = 250): Route | null {
  const path = simplify(coords, 3);
  const cum = cumulative(path);
  const stops: Stop[] = [];
  for (const st of stations) {
    const { s, offset } = project(path, cum, st.coords);
    if (offset <= maxOffsetM) stops.push({ id: st.id, name: st.name, s, interchange: st.interchange });
  }
  stops.sort((a, b) => a.s - b.s);
  const unique = stops.filter((st, i) => i === 0 || st.s - stops[i - 1].s > 60);
  return unique.length >= 2 ? { lineId, path, cum, stops: unique } : null;
}

export function reverseRoute(r: Route): Route {
  const path = [...r.path].reverse();
  const len = r.cum[r.cum.length - 1];
  return {
    lineId: r.lineId,
    path,
    cum: cumulative(path),
    stops: [...r.stops].reverse().map((st) => ({ ...st, s: len - st.s })),
  };
}

const SAMPLE_M = 120;

/** One run from the first stop to the last, departing at `departAt`. */
export function buildTrip(
  route: Route,
  departAt: number,
  motion: MotionParams & { dwell: number; interchangeDwell: number },
  id: string,
  color: [number, number, number],
): Trip {
  const { path, cum, stops } = route;
  const pts: LngLat[] = [];
  const ts: number[] = [];
  const stopTimes: StopTime[] = [];
  const push = (s: number, t: number) => {
    pts.push(pointAt(path, cum, s));
    ts.push(t);
  };

  let t = departAt;
  let v = 0; // vertex cursor
  push(stops[0].s, t);
  stopTimes.push({ name: stops[0].name, arr: t, dep: t });

  for (let i = 0; i < stops.length - 1; i++) {
    const s0 = stops[i].s;
    const s1 = stops[i + 1].s;
    const d = s1 - s0;

    // Sample at every track vertex in the hop + regularly, so accel/brake read smoothly.
    const xs: number[] = [];
    while (v < cum.length && cum[v] <= s0) v++;
    for (let k = v; k < cum.length && cum[k] < s1; k++) xs.push(cum[k] - s0);
    for (let x = SAMPLE_M; x < d - 1; x += SAMPLE_M) xs.push(x);
    xs.sort((a, b) => a - b);
    for (const x of xs) push(s0 + x, t + timeAtDistance(x, d, motion));

    t += hopTime(d, motion);
    push(s1, t);
    const next = stops[i + 1];
    const arr = t;
    if (i + 1 < stops.length - 1) {
      t += next.interchange ? motion.interchangeDwell : motion.dwell;
      push(s1, t);
    }
    stopTimes.push({ name: next.name, arr, dep: t });
  }

  return {
    id,
    lineId: route.lineId,
    color,
    towards: stops[stops.length - 1].name,
    path: pts,
    timestamps: ts,
    start: ts[0],
    end: ts[ts.length - 1],
    stops: stopTimes,
  };
}

/** Departure times for one direction across the service day. */
export function departures(spec: ServiceSpec, headwayScale = 1): number[] {
  const bands = spec.headways.map((b) => ({ from: hhmm(b.from), to: hhmm(b.to), sec: b.minutes * 60 * headwayScale }));
  const last = hhmm(spec.lastDeparture);
  const out: number[] = [];
  for (let t = hhmm(spec.firstDeparture); t <= last; ) {
    out.push(t);
    const band = bands.find((b) => t >= b.from && t < b.to) ?? bands[bands.length - 1];
    t += band.sec;
  }
  return out;
}

export interface LineInput {
  lineId: string;
  color: string;
  coords: LngLat[];
  stations: StationInput[];
  /** Set on a line's second and later tracks (`blue:4`). */
  branch?: string;
}

/** Every trip of the day for every operational line, both directions. */
export function buildServiceDay(lines: LineInput[], spec: ServiceSpec): Trip[] {
  const motion = {
    v: spec.motion.maxSpeedKmh / 3.6,
    a: spec.motion.accel,
    dwell: spec.motion.dwellSec,
    interchangeDwell: spec.motion.interchangeDwellSec,
  };
  const trips: Trip[] = [];
  for (const line of lines) {
    const fwd = buildRoute(line.lineId, line.coords, line.stations);
    if (!fwd) continue;
    const rgb = hexToRgb(line.color);
    const key = line.branch ?? line.lineId;
    const cfg = { ...spec.lines[line.lineId], ...(line.branch ? spec.lines[line.branch] : undefined) };
    const deps = departures(spec, cfg.headwayScale ?? 1);
    const lineMotion = cfg.maxSpeedKmh ? { ...motion, v: cfg.maxSpeedKmh / 3.6 } : motion;
    [fwd, reverseRoute(fwd)].forEach((route, dir) => {
      // Offset the return direction by half a headway so trains don't pair up.
      const shift = dir ? ((deps[1] ?? deps[0]) - deps[0]) / 2 : 0;
      // Every run on a route is the same shape shifted in time: build once, share the path.
      const base = buildTrip(route, 0, lineMotion, '', rgb);
      deps.forEach((dep, n) => {
        const o = dep + shift;
        trips.push({
          ...base,
          id: `${key}-${dir}-${n}`,
          timestamps: base.timestamps.map((x) => x + o),
          start: base.start + o,
          end: base.end + o,
          stops: base.stops.map((st) => ({ name: st.name, arr: st.arr + o, dep: st.dep + o })),
        });
      });
    });
  }
  return trips.sort((a, b) => a.start - b.start);
}

export interface TrainState {
  trip: Trip;
  position: LngLat;
  /** Name of the station the train is at, or heading to next */
  station: string;
  atStation: boolean;
}

/** Where every running train is at time t (seconds since local midnight). */
export function trainsAt(trips: Trip[], t: number): TrainState[] {
  const out: TrainState[] = [];
  for (const trip of trips) {
    if (trip.start > t) break; // sorted by start
    if (trip.end < t) continue;
    const ts = trip.timestamps;
    let lo = 0;
    let hi = ts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ts[mid] <= t) lo = mid;
      else hi = mid;
    }
    const span = ts[hi] - ts[lo];
    const f = span > 0 ? (t - ts[lo]) / span : 0;
    const a = trip.path[lo];
    const b = trip.path[hi];
    const position: LngLat = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    const stop = trip.stops.find((st) => st.dep >= t)!;
    out.push({ trip, position, station: stop.name, atStation: stop.arr <= t });
  }
  return out;
}

/** Local seconds since midnight for a Date, in the city's fixed UTC offset. */
export function localSeconds(date: Date, utcOffsetMinutes: number): number {
  const utc = date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds() + date.getUTCMilliseconds() / 1000;
  return (((utc + utcOffsetMinutes * 60) % 86400) + 86400) % 86400;
}

/**
 * A service day runs 04:00 → 04:00 next morning, so late trains that cross
 * midnight stay on the same clock. Times are seconds since the day's midnight
 * (04:00..28:00 → 14400..100800).
 */
export const DAY_START = 4 * 3600;
export const DAY_END = DAY_START + 86400;
export const toServiceTime = (localSec: number) => (localSec < DAY_START ? localSec + 86400 : localSec);
