import type { FeatureCollection, LineString, MultiLineString, Point } from 'geojson';
import type { ServiceSpec } from '../sim/timetable';

export type LineStatus = 'operational' | 'construction' | 'planned';
export const STATUSES: LineStatus[] = ['operational', 'construction', 'planned'];

export interface LineMeta {
  id: string;
  name: string;
  color: string;
  termini: [string, string];
  note?: string;
  /** Target opening year for sections not yet open, by status. */
  expectedYear?: Partial<Record<'construction' | 'planned', number>>;
}

export interface Opening {
  line: string;
  /** Station names, or "<start>" / "<end>" for the end of the track the other station is on. */
  from: string;
  to: string;
  year: number;
}

export interface CityMeta {
  id: string;
  name: string;
  nameLocal?: string;
  system: string;
  operator: string;
  asOf: string;
  camera: { center: [number, number]; zoom: number; pitch: number; bearing: number };
  bounds: [[number, number], [number, number]];
  lines: LineMeta[];
  openings?: Opening[];
  sources: string[];
}

export interface LineProps {
  lineId: string;
  status: LineStatus;
  /** Second and later running tracks of a line (`blue:4`). */
  branch?: string;
  source: 'osm' | 'derived' | 'manual';
  lengthKm: number;
  approximate?: boolean;
  /** Added at load time from city.json */
  color: string;
}

export interface StationProps {
  id: string;
  name: string;
  nameLocal: string | null;
  status: LineStatus;
  lineIds: string[];
  futureLineIds: string[];
  interchange: boolean;
  /** Added at load time */
  color: string;
  primaryLine: string;
  futureInterchange: boolean;
  /** Year the station (first) opened or is expected to open; 9999 if unknown. */
  year: number;
}

export interface TimelineProps {
  lineId: string;
  color: string;
  year: number;
  /** opened = historical; expected = target year for unopened sections */
  kind: 'opened' | 'expected';
  lengthKm: number;
}

export interface CityData {
  meta: CityMeta;
  lines: FeatureCollection<LineString | MultiLineString, LineProps>;
  stations: FeatureCollection<Point, StationProps>;
  /** Service pattern for the train simulation; absent → no trains. */
  service: ServiceSpec | null;
  /** Line sections tagged with opening year, for the network-growth timeline. */
  timeline: FeatureCollection<LineString | MultiLineString, TimelineProps>;
  osmTimestamp?: string;
}
