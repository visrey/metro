// Route planner: pick two stations, get the fastest journey on the simulated
// timetable from the current clock time, with the legs drawn on the map.

import type { FeatureCollection } from 'geojson';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../app/store';
import { searchStations } from '../data/search';
import type { CityData, StationProps } from '../data/types';
import { formatClock, useClock } from '../sim/clock';
import type { LngLat } from '../sim/geo';
import { planJourney, type Journey, type Network } from '../sim/planner';
import { hhmm } from '../sim/timetable';

const mins = (sec: number) => Math.max(1, Math.round(sec / 60));

/** Map features for a journey: ride legs in line colour, walks dashed, and the stations where you board/change/alight. */
export function journeyShape(j: Journey, data: CityData): FeatureCollection {
  const colorOf = new Map(data.meta.lines.map((l) => [l.id, l.color]));
  const at = new Map(data.stations.features.map((s) => [s.properties.name, s.geometry.coordinates as LngLat]));
  const features: FeatureCollection['features'] = [];
  const stops = new Map<string, { role: string; color: string }>(); // one marker per station
  j.legs.forEach((leg, i) => {
    const color = leg.kind === 'ride' ? (colorOf.get(leg.lineId) ?? '#888') : '#888';
    if (leg.path.length >= 2)
      features.push({
        type: 'Feature',
        properties: { kind: leg.kind, color, lineId: leg.kind === 'ride' ? leg.lineId : null },
        geometry: { type: 'LineString', coordinates: leg.path },
      });
    if (leg.kind !== 'ride') return;
    if (!stops.has(leg.from)) stops.set(leg.from, { role: i === 0 ? 'start' : 'change', color });
    stops.set(leg.to, { role: i === j.legs.length - 1 ? 'end' : 'change', color });
  });
  for (const [name, { role, color }] of stops) {
    const p = at.get(name);
    if (p) features.push({ type: 'Feature', properties: { kind: 'stop', role, color, name }, geometry: { type: 'Point', coordinates: p } });
  }
  return { type: 'FeatureCollection', features };
}

export function RoutePanel({ data, network, onShape }: { data: CityData; network: Network | null; onShape: (s: FeatureCollection | null) => void }) {
  const { route, planRoute, swapRoute, closeRoute } = useApp();
  const minute = useClock((s) => Math.floor(s.t / 60));
  const byId = useMemo(() => new Map(data.stations.features.map((s) => [s.properties.id, s.properties])), [data]);
  const from = route?.from ? byId.get(route.from) : undefined;
  const to = route?.to ? byId.get(route.to) : undefined;

  const result = useMemo(() => {
    if (!network || !from || !to || from.name === to.name) return null;
    const now = minute * 60;
    const j = planJourney(network, from.name, to.name, now);
    if (j || !data.service) return { j, tomorrow: false };
    // After the last train: plan from the first one.
    return { j: planJourney(network, from.name, to.name, hhmm(data.service.firstDeparture)), tomorrow: true };
  }, [network, from, to, minute, data.service]);
  const j = result?.j ?? null;

  // Only push a new shape to the map when the path itself changes, not every minute.
  const key = j ? j.legs.map((l) => `${l.kind}:${l.kind === 'ride' ? l.lineId : ''}:${l.from}>${l.to}`).join('|') : '';
  const shapeRef = useRef('');
  useEffect(() => {
    if (key === shapeRef.current) return;
    shapeRef.current = key;
    onShape(j ? journeyShape(j, data) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => () => onShape(null), [onShape]);

  if (!route) return null;
  const lineById = new Map(data.meta.lines.map((l) => [l.id, l]));
  const notOpen = [from, to].find((s) => s && s.status !== 'operational');

  return (
    <section className="panel route-panel" aria-label="Plan a route">
      <button className="close" onClick={closeRoute} aria-label="Close route planner">
        ×
      </button>
      <p className="route-title">Plan a route</p>
      <div className="route-ends">
        <div className="route-fields">
          <StationPicker data={data} value={from} placeholder="From station" onPick={(s) => planRoute({ from: s.id })} autoFocus={!from} />
          <StationPicker data={data} value={to} placeholder="To station" onPick={(s) => planRoute({ to: s.id })} autoFocus={!!from && !to} />
        </div>
        <button className="route-swap" onClick={swapRoute} aria-label="Swap from and to" title="Swap">
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M5 2v11M5 13l-2.5-2.5M5 13l2.5-2.5M11 14V3M11 3 8.5 5.5M11 3l2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {!from || !to ? (
        <p className="route-hint">Pick two stations, or tap them on the map.</p>
      ) : from.name === to.name ? (
        <p className="route-hint">Those are the same station.</p>
      ) : notOpen ? (
        <p className="route-hint">{notOpen.name} isn’t open yet, so there’s no route to plan.</p>
      ) : !network ? (
        <p className="route-hint">Loading timetable…</p>
      ) : !j ? (
        <p className="route-hint">No route found between these stations.</p>
      ) : (
        <>
          <div className="route-summary">
            <span className="route-total">{mins(j.arr - (result?.tomorrow ? j.dep : minute * 60))} min</span>
            <span className="route-meta">
              {j.changes === 0 ? 'Direct' : `${j.changes} change${j.changes > 1 ? 's' : ''}`} · {j.stops} stops
            </span>
          </div>
          <p className="route-when">
            {result?.tomorrow ? 'No more trains tonight. First train ' : 'Leave '}
            {formatClock(j.dep)} → arrive {formatClock(j.arr)} <span className="sim-tag">simulated</span>
          </p>
          <ol className="legs">
            {j.legs.map((leg, i) =>
              leg.kind === 'walk' ? (
                <li key={i} className="leg leg-walk">
                  Walk {mins(leg.arr - leg.dep)} min to <b>{leg.to}</b>
                </li>
              ) : (
                <li key={i} className="leg" style={{ ['--line' as string]: lineById.get(leg.lineId)?.color }}>
                  {i > 0 && j.legs[i - 1].kind === 'ride' && (
                    <p className="leg-change">Change · {mins(leg.dep - j.legs[i - 1].arr)} min</p>
                  )}
                  <p className="leg-line">
                    <span className="leg-dot" />
                    {lineById.get(leg.lineId)?.name ?? leg.lineId}
                    <span className="leg-towards">towards {leg.towards}</span>
                  </p>
                  <p className="leg-stop">
                    <span className="leg-time">{formatClock(leg.dep)}</span>
                    {leg.from}
                  </p>
                  <details className="leg-via">
                    <summary>
                      {leg.stops} stop{leg.stops > 1 ? 's' : ''} · {mins(leg.arr - leg.dep)} min
                    </summary>
                    <ol>
                      {leg.via.slice(0, -1).map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ol>
                  </details>
                  <p className="leg-stop">
                    <span className="leg-time">{formatClock(leg.arr)}</span>
                    {leg.to}
                  </p>
                </li>
              ),
            )}
          </ol>
          <p className="route-note">Times come from the simulated service, not the operator’s timetable.</p>
        </>
      )}
    </section>
  );
}

function StationPicker({
  data,
  value,
  placeholder,
  onPick,
  autoFocus,
}: {
  data: CityData;
  value?: StationProps;
  placeholder: string;
  onPick: (s: StationProps) => void;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState<string | null>(null); // null = showing the chosen value
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const colorOf = useMemo(() => new Map(data.meta.lines.map((l) => [l.id, l.color])), [data]);
  const results = useMemo(() => (q ? searchStations(data, q, 6) : []), [q, data]);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  const choose = (s: StationProps) => {
    onPick(s);
    setQ(null);
    input.current?.blur();
  };

  return (
    <div className="search route-picker">
      <span className="route-pin" style={{ ['--line' as string]: value ? colorOf.get(value.lineIds[0]) : undefined }} aria-hidden />
      <input
        ref={input}
        value={q ?? value?.name ?? ''}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => setQ(null)}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          else if (e.key === 'Enter' && results[active]) choose(results[active]);
          else if (e.key === 'Escape') {
            setQ(null);
            input.current?.blur();
          } else return;
          e.preventDefault();
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        role="combobox"
        aria-expanded={results.length > 0}
      />
      {results.length > 0 && (
        <ul className="search-results" role="listbox">
          {results.map((s, i) => (
            <li
              key={s.id}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s);
              }}
            >
              <span className="sr-dots">
                {s.lineIds.map((id) => (
                  <span key={id} className={`sr-dot ${s.status}`} style={{ ['--line' as string]: colorOf.get(id) }} />
                ))}
              </span>
              <span className="sr-name">{s.name}</span>
              {s.status !== 'operational' && <span className="sr-status">Not open</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
