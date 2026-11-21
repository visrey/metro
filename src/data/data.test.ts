import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lineStops } from './lineStops';
import { buildTimeline, kmByYear } from './timeline';
import type { CityData } from './types';
import { cityTrips } from '../sim/cityTrips';
import { trainsAt, hhmm } from '../sim/timetable';

const dir = new URL('../../public/data/cities/bengaluru/', import.meta.url);
const read = (f: string) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
const base = { meta: read('city.json'), lines: read('lines.geojson'), stations: read('stations.geojson'), service: null };
const timeline = buildTimeline(base);
const data = { ...base, timeline } as CityData;

describe('timeline (Bengaluru)', () => {
  it('every opening resolves to a section', () => {
    const opened = timeline.features.filter((f) => f.properties.kind === 'opened');
    expect(opened).toHaveLength(base.meta.openings.length);
  });

  it('opened sections cover the running network', () => {
    const runningKm = base.lines.features
      .filter((f: any) => f.properties.status === 'operational')
      .reduce((s: number, f: any) => s + f.properties.lengthKm, 0);
    const openedKm = timeline.features
      .filter((f) => f.properties.kind === 'opened')
      .reduce((s, f) => s + f.properties.lengthKm, 0);
    // Track runs a little past the terminus stations, so allow a small gap.
    expect(openedKm).toBeGreaterThan(runningKm * 0.95);
    expect(openedKm).toBeLessThan(runningKm * 1.02);
  });

  it('grows over time', () => {
    expect(kmByYear(timeline, 2010)).toBe(0);
    expect(kmByYear(timeline, 2011)).toBeGreaterThan(5);
    expect(kmByYear(timeline, 2011)).toBeLessThan(8);
    expect(kmByYear(timeline, 2020)).toBeLessThan(kmByYear(timeline, 2024));
  });

  it('dates stations', () => {
    const year = (name: string) => base.stations.features.find((s: any) => s.properties.name === name).properties.year;
    expect(year('Indiranagar')).toBe(2011);
    expect(year('Nadaprabhu Kempegowda Station, Majestic')).toBe(2015);
    expect(year('Jayadeva Hospital')).toBe(2025);
    expect(year('Shivajinagar')).toBe(2027);
  });
});

describe('lineStops', () => {
  it('orders the Purple Line end to end', () => {
    const names = lineStops(data, 'purple').map((s) => s.name);
    expect(names[0]).toBe('Whitefield (Kadugodi)');
    expect(names.at(-1)).toBe('Challaghatta');
    expect(names.indexOf('Indiranagar')).toBeLessThan(names.indexOf('Cubbon Park'));
  });
  it('joins Pink running + underground sections', () => {
    const names = lineStops(data, 'pink').map((s) => s.name);
    expect(names[0]).toBe('Kalena Agrahara');
    expect(names.at(-1)).toBe('Nagawara');
  });
});

describe.each(['bengaluru', 'delhi', 'mumbai'])('%s data', (id) => {
  const d = new URL(`../../public/data/cities/${id}/`, import.meta.url);
  const r = (f: string) => JSON.parse(readFileSync(new URL(f, d), 'utf8'));
  const b = { meta: r('city.json'), lines: r('lines.geojson'), stations: r('stations.geojson'), service: r('service.json') };
  const tl = buildTimeline(b);
  const city = { ...b, timeline: tl } as CityData;

  it('every opening resolves to a section', () => {
    const opened = tl.features.filter((f) => f.properties.kind === 'opened');
    expect(opened).toHaveLength(b.meta.openings.length);
  });

  it('opened sections cover the running network once', () => {
    const runningKm = b.lines.features
      .filter((f: any) => f.properties.status === 'operational')
      .reduce((s: number, f: any) => s + f.properties.lengthKm, 0);
    const openedKm = tl.features.filter((f) => f.properties.kind === 'opened').reduce((s, f) => s + f.properties.lengthKm, 0);
    expect(openedKm / runningKm).toBeGreaterThan(0.93);
    expect(openedKm / runningKm).toBeLessThan(1.03);
  });

  it('every line and station refers to a known line', () => {
    const known = new Set(b.meta.lines.map((l: any) => l.id));
    for (const f of b.lines.features) expect(known).toContain(f.properties.lineId);
    for (const s of b.stations.features) for (const l of [...s.properties.lineIds, ...s.properties.futureLineIds]) expect(known).toContain(l);
  });

  it('runs trains on every open line at 09:00, with unique trip ids', () => {
    const trips = cityTrips(city);
    expect(new Set(trips.map((t) => t.id)).size).toBe(trips.length);
    const running = new Set(trainsAt(trips, hhmm('09:00')).map((s) => s.trip.lineId));
    const open = new Set(b.lines.features.filter((f: any) => f.properties.status === 'operational').map((f: any) => f.properties.lineId));
    expect([...running].sort()).toEqual([...open].sort());
  });
});

describe('lineStops with branches (Delhi)', () => {
  const d = new URL('../../public/data/cities/delhi/', import.meta.url);
  const r = (f: string) => JSON.parse(readFileSync(new URL(f, d), 'utf8'));
  const b = { meta: r('city.json'), lines: r('lines.geojson'), stations: r('stations.geojson'), service: null };
  const city = { ...b, timeline: buildTimeline(b) } as CityData;

  it('lists the Blue main line end to end, then the Vaishali branch', async () => {
    const { lineStopGroups } = await import('./lineStops');
    const [main, branch] = lineStopGroups(city, 'blue');
    expect(main.stops[0].name).toBe('Dwarka Sector 21');
    expect(main.stops.findLast((s) => s.status === 'operational')!.name).toBe('Noida Electronic City');
    expect(branch.branchFrom).toBe('Yamuna Bank');
    expect(branch.stops.map((s) => s.name)).toContain('Vaishali');
    expect(branch.stops[0].name).toBe('Laxmi Nagar');
  });
});
