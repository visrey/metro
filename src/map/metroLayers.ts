import type { ExpressionSpecification, LayerSpecification, SourceSpecification } from 'maplibre-gl';
import type { CityData, LineStatus } from '../data/types';
import type { MapPalette } from '../theme/themes';
import { FONT_BOLD, FONT_REGULAR } from './basemap';

export const LINES_SOURCE = 'metro-lines';
export const STATIONS_SOURCE = 'metro-stations';
export const TIMELINE_SOURCE = 'metro-timeline';
export const STATION_LAYERS = ['metro-stations', 'metro-interchanges'];

export interface MetroFilter {
  statuses: LineStatus[];
  hiddenLines: string[];
  selectedStationId: string | null;
  /** Trains are drawn on top: soften the running lines so moving trains stand out. */
  trainsVisible?: boolean;
  /** Dim every line except this one. */
  focusLine?: string | null;
  /** Show the network as it was (or will be) in this year instead of today. */
  timelineYear?: number | null;
}

type Expr = ExpressionSpecification;
// Explicit expression: ['==', 1, 0] would parse as a legacy filter and fail validation.
const NONE: Expr = ['boolean', false];
const zoomed = (pairs: [number, number][]) =>
  ['interpolate', ['exponential', 1.4], ['zoom'], ...pairs.flat()] as unknown as Expr;

export function metroSources(data: CityData): Record<string, SourceSpecification> {
  return {
    [LINES_SOURCE]: { type: 'geojson', data: data.lines as never, lineMetrics: true },
    [STATIONS_SOURCE]: { type: 'geojson', data: data.stations as never, promoteId: 'id' },
    [TIMELINE_SOURCE]: { type: 'geojson', data: data.timeline as never },
  };
}

export function metroLayers(c: MapPalette, f: MetroFilter): LayerSpecification[] {
  const year = f.timelineYear ?? null;
  const today = year === null;
  const notHidden: Expr = ['!', ['in', ['get', 'lineId'], ['literal', f.hiddenLines]]];

  // Focus: the chosen line at full strength, the rest faded right back.
  const lineFade = (o: number): Expr | number =>
    f.focusLine ? ['case', ['==', ['get', 'lineId'], f.focusLine], o, o * 0.12] : o;
  const onFocus: Expr = f.focusLine
    ? ['any', ['in', f.focusLine, ['get', 'lineIds']], ['in', f.focusLine, ['get', 'futureLineIds']]]
    : ['literal', true];
  const stationFade = (o: number): Expr | number => (f.focusLine ? ['case', onFocus, o, o * 0.15] : o);

  const lineVisible = (status: LineStatus): Expr =>
    today && f.statuses.includes(status) ? ['all', ['==', ['get', 'status'], status], notHidden] : NONE;

  const stationVisible: Expr = today
    ? ['all', ['in', ['get', 'status'], ['literal', f.statuses]], ['!', ['in', ['get', 'primaryLine'], ['literal', f.hiddenLines]]]]
    : ['<=', ['get', 'year'], year];
  // In timeline mode everything shown is "open" as of that year.
  const isOpen: Expr = today ? ['==', ['get', 'status'], 'operational'] : ['literal', true];
  const isSelected: Expr = ['==', ['get', 'id'], f.selectedStationId ?? ''];
  const dimRunning = f.trainsVisible && today;

  const tlVisible: Expr = today ? NONE : ['all', ['<=', ['get', 'year'], year], notHidden];
  const tlNew: Expr = today ? NONE : ['all', ['==', ['get', 'year'], year], notHidden];

  return [
    // Planned: faint dotted path.
    {
      id: 'metro-planned', type: 'line', source: LINES_SOURCE, filter: lineVisible('planned'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': zoomed([[9, 1.6], [13, 3], [16, 5]]),
        'line-dasharray': [0.1, 2.2],
        'line-opacity': lineFade(c.dark ? 0.7 : 0.65),
      },
    },
    // Under construction: dashed, with a faint glow in dark mode.
    {
      id: 'metro-construction-glow', type: 'line', source: LINES_SOURCE, filter: lineVisible('construction'),
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': zoomed([[9, 5], [13, 10], [16, 18]]),
        'line-blur': zoomed([[9, 4], [16, 10]]),
        'line-opacity': lineFade(c.glowOpacity * 0.35),
      },
    },
    {
      id: 'metro-construction', type: 'line', source: LINES_SOURCE, filter: lineVisible('construction'),
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': zoomed([[9, 2], [13, 3.6], [16, 6]]),
        'line-dasharray': [2.2, 1.4],
        'line-opacity': lineFade(0.8),
      },
    },
    // Operational: glow + solid core + bright inner filament (dark theme).
    {
      id: 'metro-glow', type: 'line', source: LINES_SOURCE, filter: lineVisible('operational'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': zoomed([[9, 9], [13, 18], [16, 34]]),
        'line-blur': zoomed([[9, 6], [13, 10], [16, 18]]),
        'line-opacity': lineFade(c.glowOpacity * (dimRunning ? 0.6 : 1)),
      },
    },
    {
      id: 'metro-core', type: 'line', source: LINES_SOURCE, filter: lineVisible('operational'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': zoomed([[9, 2.6], [13, 4.6], [16, 9]]),
        'line-opacity': lineFade(dimRunning ? (c.dark ? 0.55 : 0.6) : 1),
      },
    },
    {
      id: 'metro-filament', type: 'line', source: LINES_SOURCE, filter: lineVisible('operational'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': c.coreHighlight,
        'line-width': zoomed([[9, 0.6], [13, 1.2], [16, 2.4]]),
        'line-blur': 0.6,
        'line-opacity': lineFade(1),
      },
    },

    // Timeline mode: every section open by `year`, with that year's openings lit up.
    {
      id: 'metro-tl-new', type: 'line', source: TIMELINE_SOURCE, filter: tlNew,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': c.dark ? '#ffffff' : ['get', 'color'],
        'line-width': zoomed([[9, 16], [13, 28], [16, 44]]),
        'line-blur': zoomed([[9, 10], [16, 22]]),
        'line-opacity': c.dark ? 0.35 : 0.3,
      },
    },
    {
      id: 'metro-tl-glow', type: 'line', source: TIMELINE_SOURCE, filter: tlVisible,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': zoomed([[9, 9], [13, 18], [16, 34]]),
        'line-blur': zoomed([[9, 6], [13, 10], [16, 18]]),
        'line-opacity': lineFade(c.glowOpacity),
      },
    },
    {
      id: 'metro-tl-core', type: 'line', source: TIMELINE_SOURCE, filter: tlVisible,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': zoomed([[9, 2.6], [13, 4.6], [16, 9]]),
        'line-opacity': lineFade(1),
      },
    },

    // Stations.
    {
      id: 'metro-station-halo', type: 'circle', source: STATIONS_SOURCE,
      filter: ['all', stationVisible, isSelected],
      paint: {
        'circle-radius': zoomed([[10, 10], [14, 16], [16, 22]]),
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.25,
        'circle-blur': 0.6,
        'circle-pitch-alignment': 'map',
      },
    },
    {
      id: 'metro-stations', type: 'circle', source: STATIONS_SOURCE,
      filter: ['all', stationVisible, ['!', ['get', 'interchange']]],
      paint: {
        'circle-radius': [
          'interpolate', ['exponential', 1.4], ['zoom'],
          9, ['case', isOpen, 1.8, 1.4],
          12, ['case', isOpen, 3.2, 2.6],
          14, ['case', isOpen, 5, 4],
          16, ['case', isOpen, 7, 5.6],
        ],
        'circle-color': c.stationFill,
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-width': zoomed([[9, 1], [13, 2], [16, 3]]),
        'circle-stroke-opacity': stationFade(1) as never,
        'circle-opacity': stationFade(1) as never,
        'circle-pitch-alignment': 'map',
      },
    },
    {
      id: 'metro-interchanges', type: 'circle', source: STATIONS_SOURCE,
      filter: ['all', stationVisible, ['get', 'interchange']],
      paint: {
        'circle-radius': zoomed([[9, 3.4], [12, 5.2], [14, 7.5], [16, 10]]),
        'circle-color': c.stationFill,
        'circle-stroke-color': c.stationLabel,
        'circle-stroke-width': zoomed([[9, 1.4], [13, 2.4], [16, 3.4]]),
        'circle-stroke-opacity': stationFade(1) as never,
        'circle-opacity': stationFade(1) as never,
        'circle-pitch-alignment': 'map',
      },
    },
    {
      id: 'metro-station-labels', type: 'symbol', source: STATIONS_SOURCE,
      filter: f.focusLine ? ['all', stationVisible, onFocus] : stationVisible,
      minzoom: f.focusLine ? 10.5 : 11.5,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['case', ['get', 'interchange'], ['literal', FONT_BOLD], ['literal', FONT_REGULAR]] as never,
        'text-size': zoomed([[10.5, 9.5], [14, 12.5], [16, 14]]),
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
        'text-radial-offset': 0.9,
        'text-justify': 'auto',
        'text-max-width': 9,
        'symbol-sort-key': ['case', ['get', 'interchange'], 0, isOpen, 1, 2] as never,
        'text-padding': 3,
      },
      paint: {
        'text-color': c.stationLabel,
        'text-halo-color': c.background,
        'text-halo-width': 1.6,
        'text-opacity': ['case', isOpen, 1, 0.7],
      },
    },
  ];
}
