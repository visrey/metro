import type { LineString } from 'geojson';
import type { CityData } from '../data/types';
import type { LngLat } from './geo';
import { buildServiceDay, type LineInput, type Trip } from './timetable';

/** All simulated trips for a city's operational lines. */
export function cityTrips(data: CityData): Trip[] {
  if (!data.service) return [];
  const colorOf = new Map(data.meta.lines.map((l) => [l.id, l.color]));
  const inputs: LineInput[] = data.lines.features
    .filter((f) => f.properties.status === 'operational' && f.geometry.type === 'LineString')
    .map((f) => {
      const lineId = f.properties.lineId;
      return {
        lineId,
        branch: f.properties.branch,
        color: colorOf.get(lineId) ?? '#888888',
        coords: (f.geometry as LineString).coordinates as LngLat[],
        stations: data.stations.features
          .filter((s) => s.properties.status === 'operational' && s.properties.lineIds.includes(lineId))
          .map((s) => ({
            id: s.properties.id,
            name: s.properties.name,
            coords: s.geometry.coordinates as LngLat,
            interchange: s.properties.interchange,
          })),
      };
    });
  return buildServiceDay(inputs, data.service);
}
