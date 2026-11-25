import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadCity } from '../data/cities';
import { timelineRange } from '../data/timeline';
import type { CityData } from '../data/types';
import { MapView } from '../map/MapView';
import { startClock, useClock } from '../sim/clock';
import { cityTrips } from '../sim/cityTrips';
import type { FeatureCollection } from 'geojson';
import type { LngLat } from '../sim/geo';
import { buildNetwork } from '../sim/planner';
import { RoutePanel } from '../ui/RoutePanel';
import { departureIndex } from '../sim/departures';
import { AboutPanel, CityHeader, NetworkLegend, StationCard, ThemeSwitch } from '../ui/Panels';
import { TimeBar, TimelineBar } from '../ui/TimeBar';
import { cityFromPath, pathFor } from './route';
import { useApp } from './store';

export function App() {
  const {
    cityId, theme, statuses, hiddenLines, selectedStationId, selectStation,
    focusLine, timelineYear, setTimelineYear, route, planRoute,
  } = useApp();
  const [routeShape, setRouteShape] = useState<FeatureCollection | null>(null);
  const [data, setData] = useState<CityData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [about, setAbout] = useState(false);

  useEffect(() => {
    let live = true;
    loadCity(cityId).then(
      (d) => {
        if (!live) return;
        if (d.service) useClock.getState().setOffset(d.service.utcOffsetMinutes);
        setData(d);
      },
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [cityId]);

  useEffect(() => startClock(), []);

  // Keep the URL (/delhi, /mumbai…) in step with the city, and follow back/forward.
  useEffect(() => {
    const path = pathFor(cityId);
    if (window.location.pathname !== path) {
      const first = !window.history.state?.city;
      window.history[first ? 'replaceState' : 'pushState']({ city: cityId }, '', path + window.location.search);
    }
  }, [cityId]);
  useEffect(() => {
    const onPop = () => {
      const id = cityFromPath();
      if (id !== useApp.getState().cityId) useApp.getState().setCity(id);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (data) document.title = `${data.meta.seoTitle ?? `${data.meta.system} map — ${data.meta.name}`} | Metro Visualizer by Visrey`;
  }, [data]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Keyboard: Space = play/pause, Esc = close card / leave focus / leave timeline.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('dialog[open]')) return; // the dialog handles its own Esc
      const app = useApp.getState();
      if (e.key === ' ' && app.timelineYear === null && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        useClock.getState().togglePlay();
      } else if (e.key === 'Escape') {
        if (app.selectedStationId) app.selectStation(null);
        else if (app.focusLine) app.setFocusLine(null);
        else if (app.route) app.closeRoute();
        else if (app.timelineYear !== null) app.setTimelineYear(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const allTrips = useMemo(() => (data ? cityTrips(data) : []), [data]);
  const departures = useMemo(() => departureIndex(allTrips), [allTrips]);
  // Built on first use of the planner (cached per city).
  const network = useMemo(
    () =>
      route && data
        ? buildNetwork(
            allTrips,
            data.stations.features.map((s) => ({ name: s.properties.name, coords: s.geometry.coordinates as LngLat })),
          )
        : null,
    [route !== null, allTrips, data], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // With the planner open, tapping a station fills the next empty end.
  const onSelectStation = useCallback(
    (id: string | null) => {
      const r = useApp.getState().route;
      const st = id && data?.stations.features.find((s) => s.properties.id === id)?.properties;
      if (r && st && st.status === 'operational') {
        if (!r.from) return planRoute({ from: id });
        if (!r.to) return planRoute({ to: id });
      }
      if (!r) selectStation(id);
    },
    [data, planRoute, selectStation],
  );
  // While a journey is shown, only its lines' trains run on the map.
  const routeLines = useMemo(
    () => (route && routeShape ? new Set(routeShape.features.map((f) => f.properties?.lineId).filter(Boolean) as string[]) : null),
    [route, routeShape],
  );
  const trips = useMemo(
    () =>
      timelineYear === null && statuses.includes('operational')
        ? allTrips.filter(
            (t) =>
              !hiddenLines.includes(t.lineId) &&
              (!focusLine || t.lineId === focusLine) &&
              (!routeLines || routeLines.has(t.lineId)),
          )
        : [],
    [allTrips, statuses, hiddenLines, focusLine, timelineYear, routeLines],
  );
  const runningTrains = useClock((s) => s.runningTrains);

  const filter = useMemo(
    () => ({
      statuses, hiddenLines, selectedStationId, trainsVisible: runningTrains > 0, focusLine, timelineYear,
      route: route ? routeShape : null,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statuses, hiddenLines, selectedStationId, runningTrains > 0, focusLine, timelineYear, route !== null, routeShape],
  );

  const onYear = useCallback((y: number) => setTimelineYear(y), [setTimelineYear]);
  const range = useMemo(() => (data ? timelineRange(data.timeline) : ([0, 0] as [number, number])), [data]);

  if (error) return <div className="splash">Couldn’t load the network: {error}</div>;
  if (!data) return <div className="splash"><span className="loader" />Loading network…</div>;

  const newKm =
    timelineYear === null
      ? 0
      : data.timeline.features.reduce((s, f) => s + (f.properties.year === timelineYear ? f.properties.lengthKm : 0), 0);

  return (
    <div className={`app ${route ? 'routing' : ''}`}>
      <MapView data={data} theme={theme} filter={filter} trips={trips} onSelectStation={onSelectStation} />
      <div className="overlay">
        <div className="col-left">
          <CityHeader data={data} onAbout={() => setAbout(true)} />
          <NetworkLegend data={data} />
          <footer className="credit">
            Made with Claude and Beer by{' '}
            <a href="https://visrey.me" target="_blank" rel="noopener">
              visrey.me
            </a>
          </footer>
        </div>
        <div className="col-right">
          <ThemeSwitch />
          {route && <RoutePanel data={data} network={network} onShape={setRouteShape} />}
          {!route && <StationCard data={data} departures={departures} />}
        </div>
      </div>
      {timelineYear !== null ? (
        <TimelineBar
          range={range}
          year={timelineYear}
          asOfYear={new Date(data.meta.asOf).getFullYear()}
          newKm={newKm}
          onYear={onYear}
          onExit={() => setTimelineYear(null)}
        />
      ) : (
        data.service && <TimeBar service={data.service} />
      )}
      {about && <AboutPanel data={data} onClose={() => setAbout(false)} />}
    </div>
  );
}
