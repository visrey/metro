// Stations of one line in travel order, for the line strip.
//
// Running stations are ordered along the line's actual track(s): the main track
// first, then each branch as its own group. Stations not on a running track
// (under construction / planned) are chained outward from whichever end of the
// main track they're nearest to.

import type { LineString } from 'geojson';
import { cumulative, haversine, project, type LngLat } from '../sim/geo';
import type { CityData, StationProps } from './types';

type Pt = { p: LngLat; props: StationProps };

export interface StopGroup {
  /** Undefined for the main line; for a branch, the station it leaves from. */
  branchFrom?: string;
  stops: StationProps[];
}

const ON_TRACK_M = 250;

/** Greedy nearest-neighbour chain starting next to `from`. */
function chainFrom(from: LngLat, pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  const left = new Set(pts);
  let cur = from;
  while (left.size) {
    let best: Pt | null = null;
    for (const x of left) if (!best || haversine(cur, x.p) < haversine(cur, best.p)) best = x;
    left.delete(best!);
    out.push(best!);
    cur = best!.p;
  }
  return out;
}

/** Fallback for lines with no running track: start from an end, then nearest-neighbour. */
function chainAll(pts: Pt[], firstTerminus: string): Pt[] {
  if (pts.length < 3) return pts;
  const farthest = (from: LngLat) => pts.reduce((b, x) => (haversine(from, x.p) > haversine(from, b.p) ? x : b));
  let start = farthest(farthest(pts[0].p).p);
  const other = farthest(start.p);
  if (firstTerminus && other.props.name.toLowerCase() === firstTerminus) start = other;
  return [start, ...chainFrom(start.p, pts.filter((x) => x !== start))];
}

export function lineStopGroups(data: CityData, lineId: string): StopGroup[] {
  const pts: Pt[] = data.stations.features
    .filter((s) => s.properties.lineIds.includes(lineId))
    .map((s) => ({ p: s.geometry.coordinates as LngLat, props: s.properties }));
  const firstTerminus = data.meta.lines.find((l) => l.id === lineId)?.termini[0]?.toLowerCase() ?? '';

  const tracks = data.lines.features
    .filter((f) => f.properties.lineId === lineId && f.properties.status === 'operational' && f.geometry.type === 'LineString')
    .sort((a, b) => (a.properties.branch ? 1 : 0) - (b.properties.branch ? 1 : 0))
    .map((f) => {
      const path = (f.geometry as LineString).coordinates as LngLat[];
      return { path, cum: cumulative(path) };
    });
  if (!tracks.length) return pts.length ? [{ stops: chainAll(pts, firstTerminus).map((x) => x.props) }] : [];

  const used = new Set<Pt>();
  const along = (t: (typeof tracks)[number]) =>
    pts
      .filter((x) => !used.has(x) && x.props.status === 'operational')
      .map((x) => ({ x, ...project(t.path, t.cum, x.p) }))
      .filter((m) => m.offset < ON_TRACK_M)
      .sort((a, b) => a.s - b.s)
      .map((m) => m.x);

  // Main track, oriented so the line's first terminus leads.
  let main = along(tracks[0]);
  const names = main.map((x) => x.props.name.toLowerCase());
  if (firstTerminus && names.lastIndexOf(firstTerminus) > names.length / 2) main.reverse();
  main.forEach((x) => used.add(x));

  // Branches: their own stations, starting at the end nearest the main line.
  const branches: StopGroup[] = [];
  const branchPts: Pt[][] = [];
  for (const t of tracks.slice(1)) {
    const own = along(t);
    if (!own.length) continue;
    const listed = [...used];
    const gap = (x: Pt) => Math.min(...listed.map((y) => haversine(x.p, y.p)));
    if (gap(own.at(-1)!) < gap(own[0])) own.reverse();
    const junction = listed.reduce((b, y) => (haversine(own[0].p, y.p) < haversine(own[0].p, b.p) ? y : b));
    own.forEach((x) => used.add(x));
    branchPts.push(own);
    branches.push({ branchFrom: junction.props.name, stops: own.map((x) => x.props) });
  }

  // Future sections: extend from the nearest open end (either end of the main
  // line, or the far end of a branch).
  const rest = pts.filter((x) => !used.has(x));
  if (rest.length && main.length) {
    const ends = [
      { p: main[0].p, add: (xs: Pt[]) => (main = [...chainFrom(main[0].p, xs).reverse(), ...main]) },
      { p: main.at(-1)!.p, add: (xs: Pt[]) => (main = [...main, ...chainFrom(main.at(-1)!.p, xs)]) },
      ...branchPts.map((bp, i) => ({
        p: bp.at(-1)!.p,
        add: (xs: Pt[]) => branches[i].stops.push(...chainFrom(bp.at(-1)!.p, xs).map((x) => x.props)),
      })),
    ];
    const byEnd = ends.map(() => [] as Pt[]);
    for (const x of rest) {
      let k = 0;
      ends.forEach((e, i) => haversine(x.p, e.p) < haversine(x.p, ends[k].p) && (k = i));
      byEnd[k].push(x);
    }
    ends.forEach((e, i) => byEnd[i].length && e.add(byEnd[i]));
  } else if (rest.length) {
    main = chainAll(rest, firstTerminus);
  }

  return [{ stops: main.map((x) => x.props) }, ...branches];
}

/** All of a line's stations, main line first then branches. */
export function lineStops(data: CityData, lineId: string): StationProps[] {
  return lineStopGroups(data, lineId).flatMap((g) => g.stops);
}
