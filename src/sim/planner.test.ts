import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CityData } from '../data/types';
import type { LngLat } from './geo';
import { cityTrips } from './cityTrips';
import { buildNetwork, planJourney, TRANSFER_SEC } from './planner';
import { hhmm } from './timetable';

function network(city: string) {
  const dir = new URL(`../../public/data/cities/${city}/`, import.meta.url);
  const read = (f: string) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  const data = { meta: read('city.json'), lines: read('lines.geojson'), stations: read('stations.geojson'), service: read('service.json') } as CityData;
  const stations = data.stations.features.map((s) => ({ name: s.properties.name, coords: s.geometry.coordinates as LngLat }));
  return buildNetwork(cityTrips(data), stations);
}

const nine = hhmm('09:00');

describe('planner (Bengaluru)', () => {
  const net = network('bengaluru');

  it('stays on one line when it can', () => {
    const j = planJourney(net, 'Indiranagar', 'Cubbon Park', nine)!;
    expect(j.changes).toBe(0);
    expect(j.legs).toHaveLength(1);
    expect(j.legs[0]).toMatchObject({ kind: 'ride', lineId: 'purple', from: 'Indiranagar', to: 'Cubbon Park' });
    expect(j.dep).toBeGreaterThanOrEqual(nine);
    expect(j.arr - j.dep).toBeLessThan(15 * 60);
  });

  it('changes at Majestic between Purple and Green', () => {
    const j = planJourney(net, 'Indiranagar', 'Yeshwantpur', nine)!;
    expect(j.changes).toBe(1);
    const [a, b] = j.legs.filter((l) => l.kind === 'ride');
    expect(a.to).toBe('Nadaprabhu Kempegowda Station, Majestic');
    expect(b.from).toBe(a.to);
    expect(b.dep - a.arr).toBeGreaterThanOrEqual(TRANSFER_SEC);
    expect(b).toMatchObject({ lineId: 'green' });
  });

  it('leg paths and stop lists line up', () => {
    const j = planJourney(net, 'Whitefield (Kadugodi)', 'Challaghatta', nine)!;
    const ride = j.legs[0];
    expect(ride.kind).toBe('ride');
    if (ride.kind !== 'ride') return;
    expect(ride.via.at(-1)).toBe('Challaghatta');
    expect(ride.via).toHaveLength(ride.stops);
    expect(ride.path.length).toBeGreaterThan(20);
  });

  it('returns nothing for unknown or identical stations, and after the last train', () => {
    expect(planJourney(net, 'Indiranagar', 'Nowhere', nine)).toBeNull();
    expect(planJourney(net, 'Indiranagar', 'Indiranagar', nine)).toBeNull();
    expect(planJourney(net, 'Indiranagar', 'Cubbon Park', hhmm('23:59'))).toBeNull();
  });
});

describe('planner (Delhi)', () => {
  const net = network('delhi');

  it('crosses the network with few changes', () => {
    const j = planJourney(net, 'Rithala', 'Hauz Khas', nine)!;
    expect(j).not.toBeNull();
    expect(j.changes).toBeLessThanOrEqual(2);
    expect(j.arr - j.dep).toBeLessThan(90 * 60);
    // Legs chain: each starts where the last ended, and never before it arrived.
    for (let i = 1; i < j.legs.length; i++) {
      expect(j.legs[i].from).toBe(j.legs[i - 1].to);
      expect(j.legs[i].dep).toBeGreaterThanOrEqual(j.legs[i - 1].arr);
    }
  });

  it('plans quickly', () => {
    const t0 = performance.now();
    for (let k = 0; k < 20; k++) planJourney(net, 'Dwarka Sector 21', 'Noida Electronic City', nine + k * 60);
    expect((performance.now() - t0) / 20).toBeLessThan(40);
  });
});
