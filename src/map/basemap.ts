// Minimal, hand-built basemap over OpenFreeMap's OpenMapTiles vector tiles.
// Owning the style (instead of restyling a stock one) keeps every colour in
// our theme tokens and leaves the metro as the only saturated thing on screen.

import type { LayerSpecification, SourceSpecification } from 'maplibre-gl';
import type { MapPalette } from '../theme/themes';

export const BASEMAP_SOURCE = 'omt';
export const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
export const FONT_REGULAR = ['Noto Sans Regular'];
export const FONT_BOLD = ['Noto Sans Bold'];

export const basemapSources: Record<string, SourceSpecification> = {
  [BASEMAP_SOURCE]: {
    type: 'vector',
    url: 'https://tiles.openfreemap.org/planet',
    attribution:
      '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/" target="_blank">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>',
  },
};

const s = BASEMAP_SOURCE;
const zoomed = (pairs: [number, number][]) => ['interpolate', ['exponential', 1.5], ['zoom'], ...pairs.flat()] as never;

export function basemapLayers(c: MapPalette): LayerSpecification[] {
  return [
    { id: 'background', type: 'background', paint: { 'background-color': c.background } },
    {
      id: 'landcover', type: 'fill', source: s, 'source-layer': 'landcover',
      filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass', 'farmland', 'scrub']]],
      paint: { 'fill-color': c.landcover, 'fill-opacity': 0.7 },
    },
    {
      id: 'park', type: 'fill', source: s, 'source-layer': 'park',
      paint: { 'fill-color': c.park, 'fill-opacity': 0.9 },
    },
    {
      id: 'landuse-green', type: 'fill', source: s, 'source-layer': 'landuse',
      filter: ['in', ['get', 'class'], ['literal', ['cemetery', 'stadium', 'pitch', 'park']]],
      paint: { 'fill-color': c.park, 'fill-opacity': 0.7 },
    },
    {
      id: 'aeroway', type: 'fill', source: s, 'source-layer': 'aeroway',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': c.aeroway },
    },
    {
      id: 'waterway', type: 'line', source: s, 'source-layer': 'waterway',
      paint: { 'line-color': c.waterway, 'line-width': zoomed([[10, 0.5], [16, 3]]) },
    },
    { id: 'water', type: 'fill', source: s, 'source-layer': 'water', paint: { 'fill-color': c.water } },

    // Roads: casing then fill, minor → major.
    {
      id: 'road-major-casing', type: 'line', source: s, 'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c.roadCasing, 'line-width': zoomed([[8, 0.6], [12, 2.5], [16, 14]]) },
    },
    {
      id: 'road-minor', type: 'line', source: s, 'source-layer': 'transportation', minzoom: 12,
      filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'tertiary', 'secondary']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c.roadMinor, 'line-width': zoomed([[12, 0.4], [16, 6]]) },
    },
    {
      id: 'road-major', type: 'line', source: s, 'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', ['trunk', 'primary']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c.roadMajor, 'line-width': zoomed([[8, 0.4], [12, 1.6], [16, 11]]) },
    },
    {
      id: 'road-motorway', type: 'line', source: s, 'source-layer': 'transportation',
      filter: ['==', ['get', 'class'], 'motorway'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c.roadMotorway, 'line-width': zoomed([[8, 0.6], [12, 2], [16, 12]]) },
    },
    {
      id: 'rail', type: 'line', source: s, 'source-layer': 'transportation',
      filter: ['all', ['==', ['get', 'class'], 'rail'], ['!=', ['get', 'brunnel'], 'tunnel']],
      paint: { 'line-color': c.rail, 'line-width': zoomed([[10, 0.6], [16, 2]]), 'line-dasharray': [3, 2] },
    },
    {
      id: 'boundary', type: 'line', source: s, 'source-layer': 'boundary',
      filter: ['<=', ['get', 'admin_level'], 4],
      paint: { 'line-color': c.boundary, 'line-width': 1, 'line-dasharray': [2, 2] },
    },

    // 3D buildings fade in as you zoom.
    {
      id: 'building-3d', type: 'fill-extrusion', source: s, 'source-layer': 'building', minzoom: 14,
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 5], 0, c.building, 40, c.buildingTop],
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 5],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, c.dark ? 0.85 : 0.7] as never,
      },
    },

    // Labels — quiet, so metro labels win.
    {
      id: 'water-name', type: 'symbol', source: s, 'source-layer': 'water_name', minzoom: 12,
      layout: { 'text-field': ['get', 'name:latin'], 'text-font': FONT_REGULAR, 'text-size': 11 },
      paint: { 'text-color': c.label, 'text-halo-color': c.labelHalo, 'text-halo-width': 1.2 },
    },
    {
      id: 'road-name', type: 'symbol', source: s, 'source-layer': 'transportation_name', minzoom: 14,
      filter: ['in', ['get', 'class'], ['literal', ['trunk', 'primary', 'secondary']]],
      layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name:latin'], 'text-font': FONT_REGULAR, 'text-size': 10.5 },
      paint: { 'text-color': c.label, 'text-halo-color': c.labelHalo, 'text-halo-width': 1.4 },
    },
    {
      id: 'place-minor', type: 'symbol', source: s, 'source-layer': 'place', minzoom: 11,
      filter: ['in', ['get', 'class'], ['literal', ['suburb', 'neighbourhood', 'quarter']]],
      layout: {
        'text-field': ['get', 'name:latin'], 'text-font': FONT_REGULAR,
        'text-size': zoomed([[11, 10], [15, 13]]), 'text-transform': 'uppercase', 'text-letter-spacing': 0.12,
        'text-max-width': 8,
      },
      paint: { 'text-color': c.label, 'text-halo-color': c.labelHalo, 'text-halo-width': 1.4, 'text-opacity': 0.8 },
    },
    {
      id: 'place-major', type: 'symbol', source: s, 'source-layer': 'place', maxzoom: 12,
      filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]],
      layout: {
        'text-field': ['get', 'name:latin'], 'text-font': FONT_BOLD,
        'text-size': ['match', ['get', 'class'], 'city', 15, 11] as never, 'text-letter-spacing': 0.2, 'text-transform': 'uppercase',
      },
      paint: { 'text-color': c.labelMajor, 'text-halo-color': c.labelHalo, 'text-halo-width': 1.6 },
    },
  ];
}
