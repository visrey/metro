import type { CityData, StationProps } from './types';

/** Stations matching a typed query: name prefix first, then word prefix, then anywhere (incl. local script). */
export function searchStations(data: CityData, q: string, limit = 7): StationProps[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const score = (s: StationProps) => {
    const n = s.name.toLowerCase();
    if (n.startsWith(needle)) return 0;
    if (n.split(/[\s,()-]+/).some((w) => w.startsWith(needle))) return 1;
    if (n.includes(needle) || s.nameLocal?.includes(q.trim())) return 2;
    return 9;
  };
  return data.stations.features
    .map((f) => f.properties)
    .map((s) => ({ s, k: score(s) + (s.status === 'operational' ? 0 : 0.5) }))
    .filter((x) => x.k < 9)
    .sort((a, b) => a.k - b.k || a.s.name.localeCompare(b.s.name))
    .slice(0, limit)
    .map((x) => x.s);
}
