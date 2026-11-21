import { create } from 'zustand';
import { STATUSES, type LineStatus } from '../data/types';
import { systemTheme, type ThemeId } from '../theme/themes';
import { cityFromPath } from './route';

const THEME_KEY = 'metro-atlas:theme';

function readTheme(): ThemeId | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'ivory' || v === 'mist' || v === 'slate' ? v : null;
  } catch {
    return null;
  }
}

interface AppState {
  cityId: string;
  theme: ThemeId;
  statuses: LineStatus[];
  hiddenLines: string[];
  selectedStationId: string | null;
  /** Line opened in the detail panel; others are dimmed on the map. */
  focusLine: string | null;
  /** Network-growth mode: show the network as of this year (null = today). */
  timelineYear: number | null;
  setCity: (id: string) => void;
  setTheme: (t: ThemeId) => void;
  toggleStatus: (s: LineStatus) => void;
  toggleLine: (id: string) => void;
  selectStation: (id: string | null) => void;
  setFocusLine: (id: string | null) => void;
  setTimelineYear: (y: number | null) => void;
}

export const useApp = create<AppState>((set) => ({
  cityId: cityFromPath(),
  theme: readTheme() ?? systemTheme(),
  statuses: [...STATUSES],
  hiddenLines: [],
  selectedStationId: null,
  focusLine: null,
  timelineYear: null,

  setCity: (cityId) => set({ cityId, hiddenLines: [], selectedStationId: null, focusLine: null, timelineYear: null }),
  setTheme: (theme) => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* private mode — theme just won't persist */
    }
    set({ theme });
  },
  toggleStatus: (s) =>
    set((st) => ({
      statuses: st.statuses.includes(s) ? st.statuses.filter((x) => x !== s) : [...st.statuses, s],
    })),
  toggleLine: (id) =>
    set((st) => ({
      hiddenLines: st.hiddenLines.includes(id) ? st.hiddenLines.filter((x) => x !== id) : [...st.hiddenLines, id],
    })),
  selectStation: (selectedStationId) => set({ selectedStationId }),
  setFocusLine: (focusLine) =>
    set((st) => ({ focusLine, hiddenLines: focusLine ? st.hiddenLines.filter((x) => x !== focusLine) : st.hiddenLines })),
  setTimelineYear: (timelineYear) => set({ timelineYear }),
}));
