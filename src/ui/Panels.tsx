import { useEffect, useMemo, useRef, useState } from 'react';
import { CITIES, lineSummaries, networkStats } from '../data/cities';
import { lineStopGroups } from '../data/lineStops';
import { searchStations } from '../data/search';
import { kmByYear, timelineRange } from '../data/timeline';
import { STATUSES, type CityData, type LineStatus, type StationProps } from '../data/types';
import { THEMES, THEME_ORDER, type ThemeId } from '../theme/themes';
import { useApp } from '../app/store';
import { useClock } from '../sim/clock';
import { nextDepartures, type Departure } from '../sim/departures';

const STATUS_LABEL: Record<LineStatus | 'partial', string> = {
  operational: 'Running',
  construction: 'Under construction',
  planned: 'Planned',
  partial: 'Partly open',
};

const fmtKm = (n: number) => (n >= 10 ? Math.round(n) : n.toFixed(1));
const asOfDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/* ------------------------------------------------------------ header */

export function CityHeader({ data, onAbout }: { data: CityData; onAbout: () => void }) {
  const { cityId, setCity, timelineYear, planRoute } = useApp();
  const { km, stations } = networkStats(data);
  const inYear = timelineYear !== null;
  const yearKm = inYear ? kmByYear(data.timeline, timelineYear) : 0;
  const yearStations = inYear ? data.stations.features.filter((s) => s.properties.year <= timelineYear).length : 0;

  return (
    <header className="panel header">
      <div className="brand">
        <span className="brand-mark" aria-hidden />
        METRO VISUALIZER
        <button className="icon-btn about-btn" onClick={onAbout} aria-label="About this map" title="About & sources">
          i
        </button>
      </div>
      <h1>
        {data.meta.name}
        {data.meta.nameLocal && <span className="local">{data.meta.nameLocal}</span>}
      </h1>
      <p className="system">{data.meta.system}</p>

      <div className="stats">
        {inYear ? (
          <>
            <Stat value={timelineYear} label="network in" />
            <Stat value={fmtKm(yearKm)} unit="km" label="open" />
            <Stat value={yearStations} label="stations" />
          </>
        ) : (
          <>
            <Stat value={fmtKm(km.operational)} unit="km" label="running" />
            <Stat value={fmtKm(km.construction + km.planned)} unit="km" label="coming" />
            <Stat value={stations.operational} label="stations open" />
          </>
        )}
      </div>

      <StationSearch key={data.meta.id} data={data} />
      {data.service && (
        <button className="route-btn" onClick={() => planRoute()}>
          <svg viewBox="0 0 16 16" aria-hidden>
            <circle cx="4" cy="3.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="12" cy="12.5" r="2" fill="currentColor" />
            <path d="M4 5.5v3a2 2 0 0 0 2 2h4a2 2 0 0 1 2 2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          Plan a route
        </button>
      )}

      <nav className="cities" aria-label="City">
        {CITIES.map((c) => (
          <button
            key={c.id}
            className={`chip ${c.id === cityId ? 'active' : ''}`}
            disabled={!c.enabled}
            onClick={() => setCity(c.id)}
            title={c.enabled ? c.system : 'Coming soon'}
          >
            {c.name}
            {!c.enabled && <small>soon</small>}
          </button>
        ))}
      </nav>
    </header>
  );
}

function Stat({ value, unit, label }: { value: string | number; unit?: string; label: string }) {
  return (
    <div className="stat">
      <div className="stat-value">
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

/* ------------------------------------------------------------ search */

function StationSearch({ data }: { data: CityData }) {
  const selectStation = useApp((s) => s.selectStation);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const colorOf = useMemo(() => new Map(data.meta.lines.map((l) => [l.id, l.color])), [data]);

  const results = useMemo(() => searchStations(data, q), [q, data]);

  // "/" focuses search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const choose = (s: StationProps) => {
    selectStation(s.id);
    setQ('');
    input.current?.blur();
  };

  return (
    <div className="search">
      <svg className="search-icon" viewBox="0 0 16 16" aria-hidden>
        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input
        ref={input}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          else if (e.key === 'Enter' && results[active]) choose(results[active]);
          else if (e.key === 'Escape') {
            setQ('');
            input.current?.blur();
          } else return;
          e.preventDefault();
        }}
        placeholder="Search stations"
        aria-label="Search stations"
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls="search-results"
        aria-activedescendant={results[active] ? `sr-${results[active].id}` : undefined}
      />
      <kbd className="search-kbd" aria-hidden>/</kbd>
      {results.length > 0 && (
        <ul className="search-results" id="search-results" role="listbox">
          {results.map((s, i) => (
            <li
              key={s.id}
              id={`sr-${s.id}`}
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
              {s.status !== 'operational' && <span className="sr-status">{STATUS_LABEL[s.status]}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ theme */

export function ThemeSwitch() {
  const { theme, setTheme } = useApp();
  return (
    <div className="panel theme-switch" role="radiogroup" aria-label="Map theme">
      {THEME_ORDER.map((id: ThemeId) => (
        <button
          key={id}
          role="radio"
          aria-checked={theme === id}
          className={theme === id ? 'active' : ''}
          onClick={() => setTheme(id)}
        >
          <span className="swatch" style={{ background: THEMES[id].map.background }} />
          {THEMES[id].label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ legend */

export function NetworkLegend({ data }: { data: CityData }) {
  const { statuses, hiddenLines, toggleStatus, toggleLine, focusLine, setFocusLine, timelineYear, setTimelineYear } = useApp();
  const lines = lineSummaries(data);
  const startOpen = typeof window === 'undefined' || !window.matchMedia('(max-width: 720px)').matches;
  const [first] = timelineRange(data.timeline);
  const focused = lines.find((l) => l.id === focusLine);

  return (
    <details className="panel legend" open={startOpen}>
      <summary>
        <span>{focused ? focused.name : 'Network'}</span>
        <span className="summary-meta">{focused ? `${focused.stationCount} stations` : `${lines.length} lines`}</span>
      </summary>

      {focused ? (
        <LineDetail data={data} line={focused} onBack={() => setFocusLine(null)} />
      ) : (
        <>
          {timelineYear === null && (
            <button className="grow-btn" onClick={() => setTimelineYear(first)}>
              <span className="grow-icon" aria-hidden>
                <svg viewBox="0 0 16 16"><path d="M4.5 2.8v10.4a.6.6 0 0 0 .9.5l8.3-5.2a.6.6 0 0 0 0-1L5.4 2.3a.6.6 0 0 0-.9.5Z" /></svg>
              </span>
              <span>
                <b>Watch the network grow</b>
                <small>{first} → {timelineRange(data.timeline)[1]}</small>
              </span>
            </button>
          )}

          {timelineYear === null && (
            <div className="legend-section">
              <h2>Status</h2>
              <div className="status-row">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    className={`status-toggle ${statuses.includes(s) ? 'on' : ''}`}
                    onClick={() => toggleStatus(s)}
                    aria-pressed={statuses.includes(s)}
                  >
                    <svg width="26" height="8" aria-hidden>
                      <line x1="2" y1="4" x2="24" y2="4" className={`sample sample-${s}`} />
                    </svg>
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="legend-section">
            <h2>
              Lines <span className="hint">select for stations</span>
            </h2>
            <ul className="line-list">
              {lines.map((l) => {
                const hidden = hiddenLines.includes(l.id);
                const total = l.km.operational + l.km.construction + l.km.planned;
                return (
                  <li key={l.id} className={`line-row ${hidden ? 'off' : ''}`} style={{ ['--line' as string]: l.color }}>
                    <button className="line-main" onClick={() => setFocusLine(l.id)}>
                      <span className={`line-chip chip-${l.status}`} />
                      <span className="line-text">
                        <span className="line-name">{l.name}</span>
                        <span className="line-termini">{l.termini.join(' ↔ ')}</span>
                      </span>
                      <span className="line-meta">
                        <span className={`pill pill-${l.status}`}>{STATUS_LABEL[l.status]}</span>
                        <span className="line-km">
                          {fmtKm(total)} km{l.stationCount ? ` · ${l.stationCount} stn` : ''}
                        </span>
                      </span>
                    </button>
                    <button
                      className="icon-btn eye"
                      onClick={() => toggleLine(l.id)}
                      aria-pressed={!hidden}
                      aria-label={`${hidden ? 'Show' : 'Hide'} ${l.name}`}
                      title={hidden ? 'Show line' : 'Hide line'}
                    >
                      <EyeIcon off={hidden} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <footer className="legend-foot">
            Status as of {asOfDate(data.meta.asOf)}. Unopened alignments are approximate.
          </footer>
        </>
      )}
    </details>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
      {off && <path d="m2.5 13.5 11-11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />}
    </svg>
  );
}

/* ------------------------------------------------------------ line detail */

type LineSummary = ReturnType<typeof lineSummaries>[number];

function LineDetail({ data, line, onBack }: { data: CityData; line: LineSummary; onBack: () => void }) {
  const { selectedStationId, selectStation } = useApp();
  const groups = useMemo(() => lineStopGroups(data, line.id), [data, line.id]);
  const colorOf = new Map(data.meta.lines.map((l) => [l.id, l.color]));
  const nameOf = new Map(data.meta.lines.map((l) => [l.id, l.name.replace(' Line', '')]));

  return (
    <div className="line-detail" style={{ ['--line' as string]: line.color }}>
      <button className="back" onClick={onBack}>
        ← All lines
      </button>
      <div className="ld-head">
        <span className={`line-chip chip-${line.status}`} />
        <div>
          <div className="ld-termini">{line.termini.join(' ↔ ')}</div>
          {line.note && <div className="ld-note">{line.note}</div>}
        </div>
      </div>
      <div className="ld-km">
        {STATUSES.filter((s) => line.km[s] > 0).map((s) => (
          <span key={s} className={`ld-km-item km-${s}`}>
            <b>{fmtKm(line.km[s])}</b> km {STATUS_LABEL[s].toLowerCase()}
          </span>
        ))}
      </div>

      {groups.length ? (
        groups.map((g) => (
          <div key={g.branchFrom ?? 'main'}>
            {g.branchFrom && <p className="strip-branch">Branch from {g.branchFrom}</p>}
            <ol className="strip">
              {g.stops.map((s) => {
                const others = s.lineIds.filter((id) => id !== line.id);
                return (
                  <li key={s.id} className={`stop ${s.status} ${s.id === selectedStationId ? 'selected' : ''}`}>
                    <button onClick={() => selectStation(s.id)}>
                      <span className={`stop-dot ${s.interchange ? 'ix' : ''}`} />
                      <span className="stop-name">{s.name}</span>
                      <span className="stop-tags">
                        {[...others, ...s.futureLineIds].map((id) => (
                          <span
                            key={id}
                            className={`stop-tag ${s.futureLineIds.includes(id) ? 'future' : ''}`}
                            style={{ ['--tag' as string]: colorOf.get(id) }}
                            title={`${s.futureLineIds.includes(id) ? 'Future interchange: ' : 'Change for '}${nameOf.get(id)}`}
                          >
                            {nameOf.get(id)}
                          </span>
                        ))}
                        {s.status !== 'operational' && s.year < 9999 && <span className="stop-year">{s.year}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        ))
      ) : (
        <p className="muted-note">No stations mapped yet for this corridor.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ station card */

export function StationCard({ data, departures }: { data: CityData; departures: Map<string, Departure[]> }) {
  const { selectedStationId, selectStation, timelineYear, planRoute } = useApp();
  const minute = useClock((s) => Math.floor(s.t / 60));
  const station = data.stations.features.find((f) => f.properties.id === selectedStationId)?.properties;
  if (!station) return null;
  const lineById = new Map(data.meta.lines.map((l) => [l.id, l]));
  const boards = station.status === 'operational' && timelineYear === null ? nextDepartures(departures, station.name, minute * 60) : [];
  const opened = station.year < 9999 ? station.year : null;

  return (
    <section className="panel station-card" aria-live="polite">
      <button className="close" onClick={() => selectStation(null)} aria-label="Close">
        ×
      </button>
      <div className="card-pills">
        <span className={`pill pill-${station.status}`}>{STATUS_LABEL[station.status]}</span>
        {opened && (
          <span className="pill">{station.status === 'operational' ? `Since ${opened}` : `Expected ${opened}`}</span>
        )}
      </div>
      <h3>{station.name}</h3>
      {station.nameLocal && <p className="local">{station.nameLocal}</p>}

      <div className="station-lines">
        {station.lineIds.map((id) => (
          <LineTag key={id} name={lineById.get(id)?.name ?? id} color={lineById.get(id)?.color} />
        ))}
      </div>
      {station.futureLineIds.length > 0 && (
        <>
          <p className="muted">Future interchange</p>
          <div className="station-lines">
            {station.futureLineIds.map((id) => (
              <LineTag key={id} name={lineById.get(id)?.name ?? id} color={lineById.get(id)?.color} future />
            ))}
          </div>
        </>
      )}

      {station.status === 'operational' && timelineYear === null && (
        <div className="board">
          <p className="muted">Next trains <span className="sim-tag">simulated</span></p>
          {boards.length ? (
            <ul>
              {boards.map((b) => (
                <li key={`${b.lineId}-${b.towards}`} style={{ ['--line' as string]: lineById.get(b.lineId)?.color }}>
                  <span className="board-dir">
                    <span className="board-dot" />
                    {b.towards}
                  </span>
                  <span className="board-times">
                    {b.inSec.map((s, i) => (
                      <span key={i} className={i === 0 ? 'soon' : ''}>
                        {s < 60 ? 'now' : `${Math.round(s / 60)} min`}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="board-empty">No more trains today.</p>
          )}
        </div>
      )}
      {station.status === 'operational' && timelineYear === null && data.service && (
        <div className="card-actions">
          <button onClick={() => planRoute({ from: station.id })}>Route from here</button>
          <button onClick={() => planRoute({ to: station.id })}>Route to here</button>
        </div>
      )}
    </section>
  );
}

function LineTag({ name, color, future }: { name: string; color?: string; future?: boolean }) {
  return (
    <span className={`line-tag ${future ? 'future' : ''}`} style={{ ['--line' as string]: color }}>
      {name}
    </span>
  );
}

/* ------------------------------------------------------------ about */

export function AboutPanel({ data, onClose }: { data: CityData; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="panel about" onClose={onClose} onClick={(e) => e.target === ref.current && ref.current?.close()}>
      <button className="close" onClick={() => ref.current?.close()} aria-label="Close">
        ×
      </button>
      <h3>About this map</h3>
      <p>
        An unofficial visual atlas of {data.meta.system}, {data.meta.name}. It is not affiliated with {data.meta.operator}.
      </p>
      <h4>What's real and what's not</h4>
      <ul>
        <li><b>Lines and stations</b> come from OpenStreetMap, as of {asOfDate(data.osmTimestamp ?? data.meta.asOf)}.</li>
        <li><b>Unopened routes</b> are approximate. Where track isn't mapped yet, it's drawn by joining station positions.</li>
        <li><b>Trains are simulated</b> from typical frequencies and speeds. They are not live positions or an official timetable.</li>
        <li><b>Opening years</b> were compiled by hand and are approximate. Future years are targets, not promises.</li>
      </ul>
      <h4>Sources</h4>
      <ul>
        {data.meta.sources.map((s) => (
          <li key={s}>{s}</li>
        ))}
        <li>
          Basemap: <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> ·{' '}
          <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> ·{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
        </li>
      </ul>
      <h4>Shortcuts</h4>
      <p className="keys">
        <kbd>/</kbd> search · <kbd>Space</kbd> play / pause · <kbd>Esc</kbd> close
      </p>
    </dialog>
  );
}
