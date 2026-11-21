import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cumulative, haversine, pointAt, project, simplify, type LngLat } from './geo';
import { hopTime, timeAtDistance } from './motion';
import {
  buildRoute,
  buildServiceDay,
  buildTrip,
  departures,
  hhmm,
  localSeconds,
  reverseRoute,
  trainsAt,
  type LineInput,
  type ServiceSpec,
} from './timetable';

const P = { v: 20, a: 1 };

describe('motion', () => {
  it('trapezoid hop: accel + cruise + brake', () => {
    // 1000 m, v=20, a=1 → accel 20 s / 200 m each side, 600 m cruise = 30 s
    expect(hopTime(1000, P)).toBeCloseTo(70);
  });
  it('triangular hop when too short to reach top speed', () => {
    // 100 m: peak = sqrt(100) = 10 m/s, 10 s up + 10 s down
    expect(hopTime(100, P)).toBeCloseTo(20);
  });
  it('timeAtDistance is monotonic and hits both ends', () => {
    let prev = -1;
    for (let x = 0; x <= 1000; x += 25) {
      const t = timeAtDistance(x, 1000, P);
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
    expect(timeAtDistance(0, 1000, P)).toBe(0);
    expect(timeAtDistance(1000, 1000, P)).toBeCloseTo(70);
    expect(timeAtDistance(200, 1000, P)).toBeCloseTo(20); // end of accel phase
    expect(timeAtDistance(500, 1000, P)).toBeCloseTo(35); // symmetric midpoint
  });
});

describe('geo', () => {
  const line: LngLat[] = [
    [77.5, 12.9],
    [77.51, 12.9],
    [77.52, 12.9],
  ];
  const cum = cumulative(line);
  it('measures and interpolates along a path', () => {
    expect(cum[2]).toBeCloseTo(haversine(line[0], line[2]), 0);
    const mid = pointAt(line, cum, cum[2] / 2);
    expect(mid[0]).toBeCloseTo(77.51, 4);
  });
  it('projects a point onto the path', () => {
    const { s, offset } = project(line, cum, [77.515, 12.9005]);
    expect(s / cum[2]).toBeCloseTo(0.75, 2);
    expect(offset).toBeGreaterThan(40);
    expect(offset).toBeLessThan(70);
  });
  it('simplify drops collinear points', () => {
    expect(simplify(line, 1)).toHaveLength(2);
  });
});

describe('timetable', () => {
  const coords: LngLat[] = [
    [77.5, 12.9],
    [77.55, 12.9],
  ];
  const stations = [0, 0.25, 0.5, 1].map((f, i) => ({
    id: `s${i}`,
    name: `S${i}`,
    coords: [77.5 + 0.05 * f, 12.9] as LngLat,
    interchange: i === 2,
  }));
  const motion = { ...P, dwell: 30, interchangeDwell: 45 };

  it('orders stops and reverses them', () => {
    const r = buildRoute('x', coords, [...stations].reverse())!;
    expect(r.stops.map((s) => s.name)).toEqual(['S0', 'S1', 'S2', 'S3']);
    const back = reverseRoute(r);
    expect(back.stops.map((s) => s.name)).toEqual(['S3', 'S2', 'S1', 'S0']);
    expect(back.stops[0].s).toBeCloseTo(0, 3);
  });

  it('builds a trip with dwells and monotonic timestamps', () => {
    const r = buildRoute('x', coords, stations)!;
    const trip = buildTrip(r, 1000, motion, 't', [0, 0, 0]);
    for (let i = 1; i < trip.timestamps.length; i++) expect(trip.timestamps[i]).toBeGreaterThanOrEqual(trip.timestamps[i - 1]);
    expect(trip.timestamps).toHaveLength(trip.path.length);
    const S2 = trip.stops[2];
    expect(S2.dep - S2.arr).toBe(45); // interchange dwell
    expect(trip.stops[1].dep - trip.stops[1].arr).toBe(30);
    expect(trip.towards).toBe('S3');
  });

  it('places trains correctly mid-trip and at stations', () => {
    const r = buildRoute('x', coords, stations)!;
    const trip = buildTrip(r, 0, motion, 't', [0, 0, 0]);
    const atS1 = trainsAt([trip], trip.stops[1].arr + 5)[0];
    expect(atS1.atStation).toBe(true);
    expect(atS1.station).toBe('S1');
    expect(atS1.position[0]).toBeCloseTo(77.5125, 3);
    const moving = trainsAt([trip], trip.stops[1].dep + 10)[0];
    expect(moving.atStation).toBe(false);
    expect(moving.station).toBe('S2');
    expect(trainsAt([trip], trip.end + 1)).toHaveLength(0);
  });

  it('generates departures from headway bands', () => {
    const spec = {
      firstDeparture: '06:00',
      lastDeparture: '07:00',
      headways: [
        { from: '06:00', to: '06:30', minutes: 10 },
        { from: '06:30', to: '07:00', minutes: 15 },
      ],
    } as ServiceSpec;
    expect(departures(spec).map((t) => (t - hhmm('06:00')) / 60)).toEqual([0, 10, 20, 30, 45, 60]);
    // Doubled headways: 0, +20, +20 → 40 (now in the 15→30 min band) → 70 > 60, stop.
    expect(departures(spec, 2).map((t) => (t - hhmm('06:00')) / 60)).toEqual([0, 20, 40]);
  });

  it('converts a Date to IST seconds of day', () => {
    // 2026-11-21T00:00Z = 05:30 IST
    expect(localSeconds(new Date('2026-11-21T00:00:00Z'), 330)).toBe(hhmm('05:30'));
    // 20:00Z = 01:30 IST next day (wraps)
    expect(localSeconds(new Date('2026-11-21T20:00:00Z'), 330)).toBe(hhmm('01:30'));
  });
});

describe('Bengaluru data (sanity)', () => {
  const dir = new URL('../../public/data/cities/bengaluru/', import.meta.url);
  const read = (f: string) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  const city = read('city.json');
  const lines = read('lines.geojson');
  const stations = read('stations.geojson');
  const spec: ServiceSpec = read('service.json');

  const inputs: LineInput[] = lines.features
    .filter((f: any) => f.properties.status === 'operational')
    .map((f: any) => ({
      lineId: f.properties.lineId,
      color: city.lines.find((l: any) => l.id === f.properties.lineId).color,
      coords: f.geometry.coordinates,
      stations: stations.features
        .filter((s: any) => s.properties.status === 'operational' && s.properties.lineIds.includes(f.properties.lineId))
        .map((s: any) => ({ id: s.properties.id, name: s.properties.name, coords: s.geometry.coordinates, interchange: s.properties.interchange })),
    }));
  const trips = buildServiceDay(inputs, spec);

  it('every operational line gets trips in both directions', () => {
    for (const id of ['purple', 'green', 'yellow', 'pink']) {
      expect(trips.some((t) => t.id.startsWith(`${id}-0-`))).toBe(true);
      expect(trips.some((t) => t.id.startsWith(`${id}-1-`))).toBe(true);
    }
  });

  it('end-to-end journey times are realistic (avg 30–42 km/h)', () => {
    for (const id of ['purple', 'green', 'yellow']) {
      const trip = trips.find((t) => t.id === `${id}-0-0`)!;
      const km = cumulative(trip.path).at(-1)! / 1000;
      const kmh = km / ((trip.end - trip.start) / 3600);
      expect(kmh).toBeGreaterThan(30);
      expect(kmh).toBeLessThan(42);
    }
  });

  it('peak hour has a sensible number of trains running', () => {
    const n = trainsAt(trips, hhmm('09:00')).length;
    expect(n).toBeGreaterThan(40);
    expect(n).toBeLessThan(160);
    expect(trainsAt(trips, hhmm('03:00'))).toHaveLength(0);
  });
});

describe('departures', async () => {
  const { departureIndex, nextDepartures } = await import('./departures');
  const coords: LngLat[] = [
    [77.5, 12.9],
    [77.55, 12.9],
  ];
  const stations = [0, 0.5, 1].map((f, i) => ({ id: `s${i}`, name: `S${i}`, coords: [77.5 + 0.05 * f, 12.9] as LngLat, interchange: false }));
  const spec = {
    utcOffsetMinutes: 330,
    firstDeparture: '06:00',
    lastDeparture: '07:00',
    motion: { maxSpeedKmh: 72, accel: 1, dwellSec: 30, interchangeDwellSec: 45 },
    headways: [{ from: '06:00', to: '07:00', minutes: 10 }],
    lines: {},
  } as ServiceSpec;
  const trips = buildServiceDay([{ lineId: 'x', color: '#000000', coords, stations }], spec);
  const index = departureIndex(trips);

  it('lists both directions at a middle station, soonest first', () => {
    const boards = nextDepartures(index, 'S1', hhmm('06:00'));
    expect(boards.map((b) => b.towards).sort()).toEqual(['S0', 'S2']);
    for (const b of boards) {
      expect(b.inSec).toHaveLength(2);
      expect(b.inSec[0]).toBeGreaterThanOrEqual(0);
      expect(b.inSec[1]).toBeGreaterThan(b.inSec[0]);
    }
  });

  it('a terminus only shows trains leaving it', () => {
    const boards = nextDepartures(index, 'S2', hhmm('06:00'));
    expect(boards.map((b) => b.towards)).toEqual(['S0']);
  });

  it('nothing after the last train', () => {
    expect(nextDepartures(index, 'S1', hhmm('09:00'))).toEqual([]);
  });
});
