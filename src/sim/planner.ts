// Journey planner over the simulated timetable (Connection Scan Algorithm).
//
// Every hop of every trip is a "connection" (station → next station, dep → arr).
// Scanning them in departure order gives the earliest arrival from a start time.
// Changing trains costs a transfer allowance; stations a short walk apart with
// different names (e.g. two operators' stations) are linked by footpaths.
// Works the same on a published timetable, once trips come from one.

import { haversine, type LngLat } from './geo';
import type { Trip } from './timetable';

export interface Network {
  names: string[];
  index: Map<string, number>;
  trips: Trip[];
  /** Sorted by departure. */
  conns: { from: number; to: number; dep: number; arr: number; trip: number; seq: number }[];
  /** Footpaths per station: walk to another station in `sec`. */
  foot: { to: number; sec: number }[][];
  coords: (LngLat | undefined)[];
}

export interface RideLeg {
  kind: 'ride';
  lineId: string;
  towards: string;
  from: string;
  to: string;
  dep: number;
  arr: number;
  /** Stops travelled (not counting the boarding station). */
  stops: number;
  /** Intermediate + end station names, in order. */
  via: string[];
  path: LngLat[];
}

export interface WalkLeg {
  kind: 'walk';
  from: string;
  to: string;
  dep: number;
  arr: number;
  path: LngLat[];
}

export type Leg = RideLeg | WalkLeg;

export interface Journey {
  legs: Leg[];
  dep: number;
  arr: number;
  /** Changes of train. */
  changes: number;
  stops: number;
}

/** Time to change trains at the same station (walk between platforms + slack). */
export const TRANSFER_SEC = 180;
const WALK_MAX_M = 400;
const WALK_SPEED = 1.2; // m/s, with route factor below
const WALK_DETOUR = 1.3;

const cache = new WeakMap<Trip[], Network>();

export function buildNetwork(trips: Trip[], stations: { name: string; coords: LngLat }[]): Network {
  const hit = cache.get(trips);
  if (hit) return hit;
  const names: string[] = [];
  const index = new Map<string, number>();
  const id = (name: string) => {
    let i = index.get(name);
    if (i === undefined) index.set(name, (i = names.push(name) - 1));
    return i;
  };
  const conns: Network['conns'] = [];
  trips.forEach((trip, t) => {
    for (let k = 0; k < trip.stops.length - 1; k++) {
      const a = trip.stops[k];
      const b = trip.stops[k + 1];
      conns.push({ from: id(a.name), to: id(b.name), dep: a.dep, arr: b.arr, trip: t, seq: k });
    }
  });
  conns.sort((a, b) => a.dep - b.dep || a.arr - b.arr);

  const coords: Network['coords'] = names.map(() => undefined);
  for (const s of stations) {
    const i = index.get(s.name);
    if (i !== undefined) coords[i] = s.coords;
  }
  const foot: Network['foot'] = names.map(() => []);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = coords[i];
      const b = coords[j];
      if (!a || !b) continue;
      const d = haversine(a, b);
      if (d > WALK_MAX_M) continue;
      const sec = Math.round((d * WALK_DETOUR) / WALK_SPEED + 60);
      foot[i].push({ to: j, sec });
      foot[j].push({ to: i, sec });
    }
  }
  const net = { names, index, trips, conns, foot, coords };
  cache.set(trips, net);
  return net;
}

type Via = { kind: 'ride'; enter: number; exit: number } | { kind: 'walk'; from: number; dep: number } | null;

/** Earliest-arrival journey leaving `from` at or after `t` (service-day seconds). */
export function planJourney(net: Network, from: string, to: string, t: number, transferSec = TRANSFER_SEC): Journey | null {
  const src = net.index.get(from);
  const dst = net.index.get(to);
  if (src === undefined || dst === undefined || src === dst) return null;
  const n = net.names.length;
  const arrival = new Float64Array(n).fill(Infinity);
  const via: Via[] = new Array(n).fill(null);
  const enter = new Int32Array(net.trips.length).fill(-1);

  arrival[src] = t;
  for (const f of net.foot[src]) {
    arrival[f.to] = t + f.sec;
    via[f.to] = { kind: 'walk', from: src, dep: t };
  }
  // Board straight away at the start; anywhere else, allow time to change.
  const ready = (s: number) => arrival[s] + (s === src ? 0 : transferSec);

  const { conns } = net;
  let lo = 0;
  let hi = conns.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (conns[mid].dep < t) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < conns.length; i++) {
    const c = conns[i];
    if (c.dep >= arrival[dst]) break;
    if (enter[c.trip] < 0) {
      if (ready(c.from) > c.dep) continue;
      enter[c.trip] = i;
    }
    if (c.arr < arrival[c.to]) {
      arrival[c.to] = c.arr;
      via[c.to] = { kind: 'ride', enter: enter[c.trip], exit: i };
      for (const f of net.foot[c.to]) {
        if (c.arr + f.sec < arrival[f.to]) {
          arrival[f.to] = c.arr + f.sec;
          via[f.to] = { kind: 'walk', from: c.to, dep: c.arr };
        }
      }
    }
  }
  if (!Number.isFinite(arrival[dst])) return null;

  // Walk back from the destination.
  const legs: Leg[] = [];
  for (let s = dst, guard = 0; s !== src && guard < 200; guard++) {
    const v = via[s];
    if (!v) return null;
    if (v.kind === 'walk') {
      legs.push({
        kind: 'walk',
        from: net.names[v.from],
        to: net.names[s],
        dep: v.dep,
        arr: arrival[s],
        path: [net.coords[v.from], net.coords[s]].filter(Boolean) as LngLat[],
      });
      s = v.from;
    } else {
      const a = conns[v.enter];
      const b = conns[v.exit];
      const trip = net.trips[b.trip];
      legs.push({
        kind: 'ride',
        lineId: trip.lineId,
        towards: trip.towards,
        from: net.names[a.from],
        to: net.names[b.to],
        dep: a.dep,
        arr: b.arr,
        stops: b.seq - a.seq + 1,
        via: trip.stops.slice(a.seq + 1, b.seq + 2).map((x) => x.name),
        path: slicePath(trip, a.dep, b.arr),
      });
      s = a.from;
    }
  }
  legs.reverse();
  const rides = legs.filter((l): l is RideLeg => l.kind === 'ride');
  if (!rides.length) return null;
  return {
    legs,
    dep: legs[0].dep,
    arr: legs.at(-1)!.arr,
    changes: rides.length - 1,
    stops: rides.reduce((s, l) => s + l.stops, 0),
  };
}

/** The part of a trip's path between two of its times. */
function slicePath(trip: Trip, t0: number, t1: number): LngLat[] {
  const ts = trip.timestamps;
  const out: LngLat[] = [];
  for (let i = 0; i < ts.length; i++) if (ts[i] >= t0 && ts[i] <= t1) out.push(trip.path[i]);
  return out;
}
