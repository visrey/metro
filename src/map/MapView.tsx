import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { MapMouseEvent, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// maplibre-gl 6 builds its worker URL at runtime, which bundlers can't see.
// Ship the (self-contained) worker as an asset and point MapLibre at it.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { CityData } from '../data/types';
import { THEMES, type ThemeId } from '../theme/themes';
import type { Trip } from '../sim/timetable';
import { GLYPHS, basemapLayers, basemapSources } from './basemap';
import { STATION_LAYERS, metroLayers, metroSources, type MetroFilter } from './metroLayers';
import type { TrainsOverlay } from './TrainsOverlay';

interface Props {
  data: CityData;
  theme: ThemeId;
  filter: MetroFilter;
  trips: Trip[];
  onSelectStation: (id: string | null) => void;
}

maplibregl.setWorkerUrl(workerUrl);

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Keep the left panel from covering what we fly to. */
const padding = () =>
  window.matchMedia('(max-width: 720px)').matches
    ? { top: 260, bottom: 140, left: 30, right: 30 }
    : { top: 80, bottom: 120, left: 400, right: 80 };

/**
 * The city's camera, re-centred on its running network and zoomed out if
 * needed so the whole of it fits the visible (unpadded) part of the map.
 */
function cityCamera(map: maplibregl.Map, data: CityData, zoomOffset = 0) {
  const { camera } = data.meta;
  const bounds = new maplibregl.LngLatBounds();
  for (const f of data.lines.features) {
    if (f.properties.status !== 'operational') continue;
    const parts = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const l of parts) for (const c of l) bounds.extend(c as [number, number]);
  }
  const fit = bounds.isEmpty() ? undefined : map.cameraForBounds(bounds, { padding: 12, bearing: camera.bearing });
  // The fit is for a flat map; tilted, the network foreshortens, so it can come in a little.
  const fitZoom = fit?.zoom === undefined ? camera.zoom : fit.zoom + (camera.pitch > 30 ? 0.4 : 0);
  return {
    center: fit?.center ?? camera.center,
    zoom: Math.min(camera.zoom, fitZoom) + zoomOffset,
    pitch: camera.pitch,
    bearing: camera.bearing,
  };
}

function buildStyle(data: CityData, theme: ThemeId, filter: MetroFilter): StyleSpecification {
  const palette = THEMES[theme].map;
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: { ...basemapSources, ...metroSources(data, filter.route) },
    layers: [...basemapLayers(palette), ...metroLayers(palette, filter)],
    sky: {
      'sky-color': palette.background,
      'horizon-color': palette.background,
      'fog-color': palette.background,
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.8,
      'fog-ground-blend': 0.85,
    },
  };
}

export function MapView({ data, theme, filter, trips, onSelectStation }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const trainsRef = useRef<TrainsOverlay | null>(null);
  const latest = useRef({ data, theme, trips, onSelectStation });
  latest.current = { data, theme, trips, onSelectStation };
  const cityRef = useRef<string | null>(null);

  // Create once.
  useEffect(() => {
    const { camera } = data.meta;
    const map = new maplibregl.Map({
      container: container.current!,
      style: buildStyle(data, theme, filter),
      center: camera.center,
      zoom: camera.zoom - 1.6,
      pitch: 0,
      bearing: 0,
      maxPitch: 75,
      attributionControl: { compact: true },
      fadeDuration: 150,
    });
    mapRef.current = map;
    cityRef.current = data.meta.id;
    if (import.meta.env.DEV) (window as unknown as { __map: unknown }).__map = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    // The panels cover part of the map: offset the camera's centre once, for every move.
    // (Passing padding per move would persist it and stack with fitBounds' own padding.)
    map.setPadding(padding());
    const onResize = () => map.setPadding(padding());
    window.addEventListener('resize', onResize);

    // Intro: swoop from flat overview into the tilted city view.
    map.once('load', () => {
      const target = cityCamera(map, latest.current.data);
      if (!reducedMotion()) map.flyTo({ ...target, duration: 3200, curve: 1.2, essential: false });
      else map.jumpTo(target);
    });

    for (const layer of STATION_LAYERS) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
    }
    map.on('click', (e: MapMouseEvent) => {
      const hit = map.queryRenderedFeatures(e.point, { layers: STATION_LAYERS.filter((l) => map.getLayer(l)) })[0];
      latest.current.onSelectStation((hit?.properties?.id as string) ?? null);
    });

    // Trains (deck.gl) load after the map so the first paint isn't waiting on them.
    let disposed = false;
    // Attach only once the map has loaded, or deck's first frames can use a stale viewport.
    const mapReady = new Promise<void>((resolve) => (map.loaded() ? resolve() : map.once('load', () => resolve())));
    Promise.all([import('./TrainsOverlay'), mapReady]).then(([{ TrainsOverlay }]) => {
      if (disposed) return;
      const lineName = (id: string) => latest.current.data.meta.lines.find((l) => l.id === id)?.name ?? id;
      const overlay = new TrainsOverlay(map, lineName);
      overlay.setDark(THEMES[latest.current.theme].map.dark);
      overlay.setTrips(latest.current.trips);
      trainsRef.current = overlay;
    });

    return () => {
      window.removeEventListener('resize', onResize);
      disposed = true;
      trainsRef.current?.destroy();
      trainsRef.current = null;
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme / filter / data changes → diff the style in place (no flicker, no re-load).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(buildStyle(data, theme, filter), { diff: true });
    if (cityRef.current !== data.meta.id) {
      cityRef.current = data.meta.id;
      map.flyTo({ ...cityCamera(map, data), duration: reducedMotion() ? 0 : 2500 });
    }
  }, [data, theme, filter]);

  // Fly to a station when one is selected (from the map, search or a line strip).
  useEffect(() => {
    const map = mapRef.current;
    const st = data.stations.features.find((s) => s.properties.id === filter.selectedStationId);
    if (!map || !st) return;
    map.flyTo({
      center: st.geometry.coordinates as [number, number],
      zoom: Math.max(map.getZoom(), 14),
      duration: reducedMotion() ? 0 : 1200,
      essential: true,
    });
  }, [filter.selectedStationId, data]);

  // Frame a focused line.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !filter.focusLine) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const f of data.lines.features) {
      if (f.properties.lineId !== filter.focusLine) continue;
      const parts = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const l of parts) for (const c of l) bounds.extend(c as [number, number]);
    }
    if (bounds.isEmpty()) return;
    map.fitBounds(bounds, { padding: 40, pitch: 40, bearing: map.getBearing(), duration: reducedMotion() ? 0 : 1400, maxZoom: 13.5 });
  }, [filter.focusLine, data]);

  // Frame a planned journey whenever its path changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const narrow = window.matchMedia('(max-width: 720px)').matches;
    if (!filter.route?.features.length) {
      map.setPadding(padding());
      return;
    }
    // On phones the planner replaces the header and sits at the bottom: fit the route above it.
    if (narrow) {
      const top = document.querySelector('.route-panel')?.getBoundingClientRect().top;
      map.setPadding({ top: 70, left: 10, right: 10, bottom: top ? window.innerHeight - top + 10 : 300 });
    }
    const bounds = new maplibregl.LngLatBounds();
    for (const f of filter.route.features) {
      const g = f.geometry;
      if (g.type === 'LineString') for (const c of g.coordinates) bounds.extend(c as [number, number]);
      else if (g.type === 'Point') bounds.extend(g.coordinates as [number, number]);
    }
    // This adds to the map's own panel padding (left panel / phone header), so
    // only make room for the planner on the right when the window is wide enough.
    const roomRight = window.innerWidth > 1100 ? 280 : 30;
    const cam = map.cameraForBounds(bounds, {
      padding: narrow ? 24 : { top: 30, bottom: 30, left: 30, right: roomRight },
      bearing: map.getBearing(),
      maxZoom: 14,
    });
    if (!cam) return;
    // The fit is for a flat map: tilted, the far end recedes, so pull back a touch.
    map.flyTo({ ...cam, zoom: (cam.zoom ?? 12) - (narrow ? 0.45 : 0.2), pitch: narrow ? 25 : 35, duration: reducedMotion() ? 0 : 1400 });
  }, [filter.route]);

  // Entering the growth timeline: pull back to the whole city so every opening is in view.
  const inTimeline = filter.timelineYear != null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !inTimeline) return;
    map.flyTo({ ...cityCamera(map, data, -0.3), duration: reducedMotion() ? 0 : 1600 });
  }, [inTimeline, data]);

  useEffect(() => {
    trainsRef.current?.setDark(THEMES[theme].map.dark);
  }, [theme]);

  useEffect(() => {
    trainsRef.current?.setTrips(trips);
  }, [trips]);

  return <div ref={container} className="map" />;
}
