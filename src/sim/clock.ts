// Simulation clock. Lives outside React state so the 60 fps tick doesn't
// re-render the app; components subscribe to just the slice they show.

import { create } from 'zustand';
import { DAY_END, DAY_START, localSeconds, toServiceTime } from './timetable';

export const SPEEDS = [1, 10, 60, 300] as const;
export type Speed = (typeof SPEEDS)[number];

interface ClockState {
  /** Service-day seconds (DAY_START..DAY_END). */
  t: number;
  speed: Speed;
  playing: boolean;
  /** Following real local time (speed 1). */
  live: boolean;
  utcOffsetMinutes: number;
  runningTrains: number;
  setSpeed: (s: Speed) => void;
  togglePlay: () => void;
  seek: (t: number) => void;
  goLive: () => void;
  setOffset: (m: number) => void;
  tick: (dtSec: number) => void;
  setRunning: (n: number) => void;
}

const nowLocal = (offset: number) => toServiceTime(localSeconds(new Date(), offset));

export const useClock = create<ClockState>((set, get) => ({
  t: nowLocal(330),
  speed: 10,
  playing: true,
  live: false,
  utcOffsetMinutes: 330,
  runningTrains: 0,

  setSpeed: (speed) => set({ speed, live: false, playing: true }),
  togglePlay: () => set((s) => ({ playing: !s.playing, live: false })),
  seek: (t) => set({ t: Math.min(DAY_END - 1, Math.max(DAY_START, t)), live: false }),
  goLive: () => set({ live: true, playing: true, speed: 1, t: nowLocal(get().utcOffsetMinutes) }),
  setOffset: (utcOffsetMinutes) => set({ utcOffsetMinutes, t: nowLocal(utcOffsetMinutes) }),
  setRunning: (runningTrains) => {
    if (get().runningTrains !== runningTrains) set({ runningTrains });
  },
  tick: (dt) => {
    const s = get();
    if (!s.playing) return;
    if (s.live) return set({ t: nowLocal(s.utcOffsetMinutes) });
    let t = s.t + dt * s.speed;
    if (t >= DAY_END) t = DAY_START + (t - DAY_END); // loop the service day
    set({ t });
  },
}));

/** Drive the clock from requestAnimationFrame. Call once. */
export function startClock(): () => void {
  let raf = 0;
  let last = performance.now();
  const loop = (now: number) => {
    // Clamp big gaps (tab in background) so trains don't teleport hours ahead.
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    useClock.getState().tick(dt);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
}

export function formatClock(t: number): string {
  const s = Math.floor(t) % 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
