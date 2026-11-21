// Network-growth timeline: cut each running line into the sections that opened
// in different years (from city.json `openings`), and give every unopened
// section its target year. Stations inherit the earliest year that reaches them.

import type { Feature, LineString, MultiLineString } from 'geojson';
import { cumulative, haversine, project, slice, type LngLat } from '../sim/geo';
import type { CityData, TimelineProps } from './types';

type TFeature = Feature<LineString | MultiLineString, TimelineProps>;

const lengthKm = (lines: LngLat[][]) =>
  lines.reduce((s, l) => s + l.reduce((a, c, i) => (i ? a + haversine(l[i - 1], c) : 0), 0), 0) / 1000;

export function buildTimeline(data: Omit<CityData, 'timeline'>): CityData['timeline'] {
  const { meta, lines, stations } = data;
  const colorOf = new Map(meta.lines.map((l) => [l.id, l.color]));
  const asOfYear = new Date(meta.asOf).getFullYear();
  const features: TFeature[] = [];

  // 1. Opened sections, sliced from each running line between named stations.
  // A line can have branches (several running LineStrings): use the one both ends sit on.
  const tracks = lines.features
    .filter((f) => f.properties.status === 'operational' && f.geometry.type === 'LineString')
    .map((f) => {
      const path = (f.geometry as LineString).coordinates as LngLat[];
      return { lineId: f.properties.lineId, path, cum: cumulative(path) };
    });
  const END = /^<(start|end)>$/;
  const stationAt = (lineId: string, name: string) => {
    if (END.test(name)) return 'end' as const;
    const st = stations.features.find((s) => s.properties.name === name && s.properties.lineIds.includes(lineId));
    if (!st && import.meta.env?.DEV) console.warn(`[timeline] no ${lineId} station named "${name}"`);
    return st?.geometry.coordinates as LngLat | undefined;
  };
  for (const o of meta.openings ?? []) {
    const a = stationAt(o.line, o.from);
    const b = stationAt(o.line, o.to);
    if (!a || !b) continue;
    let best: { path: LngLat[]; cum: number[]; s0: number; s1: number; off: number } | null = null;
    for (const t of tracks) {
      if (t.lineId !== o.line) continue;
      const total = t.cum.at(-1)!;
      const on = (p: LngLat | 'end', name: string) =>
        p === 'end' ? { s: name === '<start>' ? 0 : total, offset: 0 } : project(t.path, t.cum, p);
      const pa = on(a, o.from);
      const pb = on(b, o.to);
      const off = Math.max(pa.offset, pb.offset);
      if (!best || off < best.off) best = { path: t.path, cum: t.cum, s0: pa.s, s1: pb.s, off };
    }
    if (!best || best.off > 400) {
      if (import.meta.env?.DEV) console.warn(`[timeline] ${o.line} ${o.from} – ${o.to} isn't on one track`);
      continue;
    }
    const coords = slice(best.path, best.cum, best.s0, best.s1);
    features.push({
      type: 'Feature',
      properties: { lineId: o.line, color: colorOf.get(o.line) ?? '#888', year: o.year, kind: 'opened', lengthKm: lengthKm([coords]) },
      geometry: { type: 'LineString', coordinates: coords },
    });
  }

  // 2. Unopened sections at their target year.
  for (const f of lines.features) {
    const { lineId, status } = f.properties;
    if (status === 'operational') continue;
    const meta_ = meta.lines.find((l) => l.id === lineId);
    const year = meta_?.expectedYear?.[status] ?? asOfYear + (status === 'construction' ? 1 : 5);
    const parts = (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates) as LngLat[][];
    features.push({
      type: 'Feature',
      properties: { lineId, color: colorOf.get(lineId) ?? '#888', year, kind: 'expected', lengthKm: lengthKm(parts) },
      geometry: f.geometry,
    });
  }

  // 3. Station year = earliest section of one of its lines that passes within 150 m.
  for (const st of stations.features) {
    const p = st.geometry.coordinates as LngLat;
    const ids = new Set([...st.properties.lineIds, ...st.properties.futureLineIds]);
    let year = 9999;
    for (const f of features) {
      if (!ids.has(f.properties.lineId) || f.properties.year >= year) continue;
      const parts = (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates) as LngLat[][];
      if (parts.some((l) => project(l, cumulative(l), p).offset < 150)) year = f.properties.year;
    }
    st.properties.year = year;
  }

  // Oldest first, so newer sections draw on top.
  features.sort((a, b) => a.properties.year - b.properties.year);
  return { type: 'FeatureCollection', features };
}

/** Km open (or opening) by the end of `year`. */
export function kmByYear(timeline: CityData['timeline'], year: number): number {
  return timeline.features.reduce((s, f) => s + (f.properties.year <= year ? f.properties.lengthKm : 0), 0);
}

export function timelineRange(timeline: CityData['timeline']): [number, number] {
  const ys = timeline.features.map((f) => f.properties.year);
  return [Math.min(...ys), Math.max(...ys)];
}
