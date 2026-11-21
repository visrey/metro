// "Next trains" boards: every simulated departure, indexed by station name.

import type { Trip } from './timetable';

export interface Departure {
  lineId: string;
  towards: string;
  dep: number;
}

export interface Board {
  lineId: string;
  towards: string;
  /** Seconds until each of the next departures. */
  inSec: number[];
}

export function departureIndex(trips: Trip[]): Map<string, Departure[]> {
  const index = new Map<string, Departure[]>();
  for (const trip of trips) {
    for (const st of trip.stops) {
      if (st.name === trip.towards) continue; // terminating here, not departing
      let list = index.get(st.name);
      if (!list) index.set(st.name, (list = []));
      list.push({ lineId: trip.lineId, towards: trip.towards, dep: st.dep });
    }
  }
  for (const list of index.values()) list.sort((a, b) => a.dep - b.dep);
  return index;
}

/** Next `perDirection` departures for each line + direction at a station after time t. */
export function nextDepartures(index: Map<string, Departure[]>, station: string, t: number, perDirection = 2): Board[] {
  const list = index.get(station);
  if (!list) return [];
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].dep < t) lo = mid + 1;
    else hi = mid;
  }
  const boards = new Map<string, Board>();
  for (let i = lo; i < list.length; i++) {
    const d = list[i];
    const key = `${d.lineId}|${d.towards}`;
    let b = boards.get(key);
    if (!b) boards.set(key, (b = { lineId: d.lineId, towards: d.towards, inSec: [] }));
    if (b.inSec.length < perDirection) b.inSec.push(d.dep - t);
    if (boards.size >= 8 && [...boards.values()].every((x) => x.inSec.length >= perDirection)) break;
  }
  return [...boards.values()];
}
