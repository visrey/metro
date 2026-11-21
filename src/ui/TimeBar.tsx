import { useEffect, useRef, useState } from 'react';
import { DAY_END, DAY_START, hhmm, type ServiceSpec } from '../sim/timetable';
import { useShallow } from 'zustand/react/shallow';
import { SPEEDS, formatClock, useClock } from '../sim/clock';

interface Props {
  service: ServiceSpec;
}

export function TimeBar({ service }: Props) {
  // Re-render on whole simulated minutes only, not every frame.
  const minute = useClock((s) => Math.floor(s.t / 60));
  const { speed, playing, live, runningTrains, setSpeed, togglePlay, seek, goLive } = useClock(
    useShallow((s) => ({
      speed: s.speed, playing: s.playing, live: s.live, runningTrains: s.runningTrains,
      setSpeed: s.setSpeed, togglePlay: s.togglePlay, seek: s.seek, goLive: s.goLive,
    })),
  );

  const t = minute * 60;
  const first = hhmm(service.firstDeparture);
  const closed = runningTrains === 0 && (t < first || t > hhmm(service.lastDeparture));

  return (
    <div className="panel timebar">
      <button className="play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? (
          <svg viewBox="0 0 16 16" aria-hidden><rect x="3.5" y="2.5" width="3" height="11" rx="1" /><rect x="9.5" y="2.5" width="3" height="11" rx="1" /></svg>
        ) : (
          <svg viewBox="0 0 16 16" aria-hidden><path d="M4.5 2.8v10.4a.6.6 0 0 0 .9.5l8.3-5.2a.6.6 0 0 0 0-1L5.4 2.3a.6.6 0 0 0-.9.5Z" /></svg>
        )}
      </button>

      <div className="clock">
        <div className="clock-time">
          {formatClock(t)}
          <span className="tz">IST</span>
        </div>
        <div className={`clock-sub ${closed ? 'closed' : ''}`}>
          {closed ? (
            <>
              No service ·{' '}
              <button className="link" onClick={() => seek(hhmm('08:30'))}>
                jump to 08:30
              </button>
            </>
          ) : (
            <>
              <span className="pulse" aria-hidden />
              {runningTrains} trains running
            </>
          )}
        </div>
      </div>

      <input
        className="scrub"
        type="range"
        min={DAY_START}
        max={DAY_END - 60}
        step={60}
        value={Math.min(DAY_END - 60, t)}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label="Time of day"
        style={{ ['--p' as string]: `${((t - DAY_START) / (DAY_END - 60 - DAY_START)) * 100}%` }}
      />

      <div className="speeds" role="radiogroup" aria-label="Simulation speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={!live && speed === s}
            className={!live && speed === s ? 'active' : ''}
            onClick={() => setSpeed(s)}
          >
            {s}×
          </button>
        ))}
        <button className={`live ${live ? 'active' : ''}`} onClick={goLive} aria-pressed={live} title="Follow the real clock">
          <span className="dot" aria-hidden />
          Now
        </button>
      </div>

      <p className="sim-note">Simulated from typical service patterns, not live train positions.</p>
    </div>
  );
}

/* ------------------------------------------------------------ network growth */

interface TimelineProps {
  range: [number, number];
  year: number;
  asOfYear: number;
  newKm: number;
  onYear: (y: number) => void;
  onExit: () => void;
}

const STEP_MS = 1400;

/** Year scrubber that replaces the time bar while the network-growth view is on. */
export function TimelineBar({ range, year, asOfYear, newKm, onYear, onExit }: TimelineProps) {
  const [playing, setPlaying] = useState(true);
  const yearRef = useRef(year);
  yearRef.current = year;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const next = yearRef.current + 1;
      if (next > range[1]) setPlaying(false);
      else onYear(next);
    }, STEP_MS);
    return () => clearInterval(id);
  }, [playing, range, onYear]);

  const future = year > asOfYear;
  return (
    <div className="panel timebar timeline-bar">
      <button
        className="play"
        onClick={() => {
          if (!playing && year >= range[1]) onYear(range[0]);
          setPlaying(!playing);
        }}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? (
          <svg viewBox="0 0 16 16" aria-hidden><rect x="3.5" y="2.5" width="3" height="11" rx="1" /><rect x="9.5" y="2.5" width="3" height="11" rx="1" /></svg>
        ) : (
          <svg viewBox="0 0 16 16" aria-hidden><path d="M4.5 2.8v10.4a.6.6 0 0 0 .9.5l8.3-5.2a.6.6 0 0 0 0-1L5.4 2.3a.6.6 0 0 0-.9.5Z" /></svg>
        )}
      </button>

      <div className="clock">
        <div className="clock-time year" key={year}>{year}</div>
        <div className="clock-sub">
          {future ? <span className="future-tag">target</span> : null}
          {newKm > 0 ? `+${newKm >= 10 ? Math.round(newKm) : newKm.toFixed(1)} km this year` : 'no new sections'}
        </div>
      </div>

      <div className="years">
        <input
          className="scrub"
          type="range"
          min={range[0]}
          max={range[1]}
          step={1}
          value={year}
          onChange={(e) => {
            setPlaying(false);
            onYear(Number(e.target.value));
          }}
          aria-label="Year"
          style={{ ['--p' as string]: `${((year - range[0]) / (range[1] - range[0])) * 100}%` }}
        />
        <div className="year-ticks" aria-hidden>
          <span>{range[0]}</span>
          <span className="today-tick" style={{ left: `${((asOfYear - range[0]) / (range[1] - range[0])) * 100}%` }}>today</span>
          <span>{range[1]}</span>
        </div>
      </div>

      <button className="exit-btn" onClick={onExit}>
        Back to today
      </button>
    </div>
  );
}
