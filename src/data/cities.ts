import type { ServiceSpec } from '../sim/timetable';
import { buildTimeline } from './timeline';
import type { CityData, CityMeta, LineStatus } from './types';

export interface CityEntry {
  id: string;
  name: string;
  system: string;
  enabled: boolean;
}

/** Add a city here + a folder under public/data/cities/<id>/ — no other code changes. */
export const CITIES: CityEntry[] = [
  { id: 'bengaluru', name: 'Bengaluru', system: 'Namma Metro', enabled: true },
  { id: 'delhi', name: 'Delhi', system: 'Delhi Metro', enabled: true },
  { id: 'mumbai', name: 'Mumbai', system: 'Mumbai Metro', enabled: true },
];

const cache = new Map<string, Promise<CityData>>();

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
  return res.json() as Promise<T>;
}

export function loadCity(id: string): Promise<CityData> {
  if (!cache.has(id)) cache.set(id, fetchCity(id));
  return cache.get(id)!;
}

async function fetchCity(id: string): Promise<CityData> {
  const base = `${import.meta.env.BASE_URL}data/cities/${id}`;
  const [meta, lines, stations, service] = await Promise.all([
    getJson<CityMeta>(`${base}/city.json`),
    getJson<CityData['lines'] & { meta?: { osmTimestamp?: string } }>(`${base}/lines.geojson`),
    getJson<CityData['stations']>(`${base}/stations.geojson`),
    getJson<ServiceSpec>(`${base}/service.json`).catch(() => null),
  ]);
  const colorOf = new Map(meta.lines.map((l) => [l.id, l.color]));
  const order = new Map(meta.lines.map((l, i) => [l.id, i]));

  for (const f of lines.features) f.properties.color = colorOf.get(f.properties.lineId) ?? '#888';
  // Draw planned under construction under operational.
  const rank: Record<LineStatus, number> = { planned: 0, construction: 1, operational: 2 };
  lines.features.sort((a, b) => rank[a.properties.status] - rank[b.properties.status]);

  for (const f of stations.features) {
    const p = f.properties;
    p.lineIds.sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
    p.primaryLine = p.lineIds[0];
    p.color = colorOf.get(p.primaryLine) ?? '#888';
    p.futureInterchange = p.futureLineIds.length > 0;
  }
  const base_ = { meta, lines, stations, service, osmTimestamp: lines.meta?.osmTimestamp };
  return { ...base_, timeline: buildTimeline(base_) };
}

/** Network totals per status, from the line geometry. */
export function networkStats(data: CityData) {
  const km: Record<LineStatus, number> = { operational: 0, construction: 0, planned: 0 };
  for (const f of data.lines.features) km[f.properties.status] += f.properties.lengthKm;
  const stations: Record<LineStatus, number> = { operational: 0, construction: 0, planned: 0 };
  for (const f of data.stations.features) stations[f.properties.status]++;
  return { km, stations };
}

/** Per-line summary: status mix, km, station count. */
export function lineSummaries(data: CityData) {
  return data.meta.lines.map((line) => {
    const segs = data.lines.features.filter((f) => f.properties.lineId === line.id);
    const km = { operational: 0, construction: 0, planned: 0 } as Record<LineStatus, number>;
    for (const s of segs) km[s.properties.status] += s.properties.lengthKm;
    const stationCount = data.stations.features.filter((s) => s.properties.lineIds.includes(line.id)).length;
    const status: LineStatus | 'partial' =
      km.operational && (km.construction || km.planned) ? 'partial'
      : km.operational ? 'operational'
      : km.construction ? 'construction'
      : 'planned';
    return { ...line, km, stationCount, status };
  });
}
