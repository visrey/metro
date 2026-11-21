import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadCity } from '../data/cities';
import { timelineRange } from '../data/timeline';
import type { CityData } from '../data/types';
import { MapView } from '../map/MapView';
import { startClock, useClock } from '../sim/clock';
import { cityTrips } from '../sim/cityTrips';
import { departureIndex } from '../sim/departures';
import { AboutPanel, CityHeader, NetworkLegend, StationCard, ThemeSwitch } from '../ui/Panels';
import { TimeBar, TimelineBar } from '../ui/TimeBar';
import { cityFromPath, pathFor } from './route';
import { useApp } from './store';

export function App() {
  const {
    cityId, theme, statuses, hiddenLines, selectedStationId, selectStation,
    focusLine, timelineYear, setTimelineYear,
  } = useApp();
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
    if (data) document.title = `${data.meta.name} · ${data.meta.system} — Metro Atlas`;
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
        else if (app.timelineYear !== null) app.setTimelineYear(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const allTrips = useMemo(() => (data ? cityTrips(data) : []), [data]);
  const departures = useMemo(() => departureIndex(allTrips), [allTrips]);
  const trips = useMemo(
    () =>
      timelineYear === null && statuses.includes('operational')
        ? allTrips.filter((t) => !hiddenLines.includes(t.lineId) && (!focusLine || t.lineId === focusLine))
        : [],
    [allTrips, statuses, hiddenLines, focusLine, timelineYear],
  );
  const runningTrains = useClock((s) => s.runningTrains);

  const filter = useMemo(
    () => ({ statuses, hiddenLines, selectedStationId, trainsVisible: runningTrains > 0, focusLine, timelineYear }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statuses, hiddenLines, selectedStationId, runningTrains > 0, focusLine, timelineYear],
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
    <div className="app">
      <MapView data={data} theme={theme} filter={filter} trips={trips} onSelectStation={selectStation} />
      <div className="overlay">
        <div className="col-left">
          <CityHeader data={data} onAbout={() => setAbout(true)} />
          <NetworkLegend data={data} />
        </div>
        <div className="col-right">
          <ThemeSwitch />
          <StationCard data={data} departures={departures} />
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
