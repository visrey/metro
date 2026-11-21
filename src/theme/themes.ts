export type ThemeId = 'ivory' | 'mist' | 'slate';

export interface MapPalette {
  dark: boolean;
  background: string;
  landcover: string;
  park: string;
  water: string;
  waterway: string;
  roadMinor: string;
  roadMajor: string;
  roadMotorway: string;
  roadCasing: string;
  rail: string;
  building: string;
  buildingTop: string;
  aeroway: string;
  boundary: string;
  label: string;
  labelMajor: string;
  labelHalo: string;
  /** Metro styling */
  stationFill: string;
  stationLabel: string;
  glowOpacity: number;
  coreHighlight: string;
}

export const THEMES: Record<ThemeId, { label: string; map: MapPalette }> = {
  ivory: {
    label: 'Ivory',
    map: {
      dark: false,
      background: '#F4F1EA',
      landcover: '#EEEADF',
      park: '#E4E7D8',
      water: '#CCDAE0',
      waterway: '#BFD0D8',
      roadMinor: '#FFFFFF',
      roadMajor: '#FBF8F1',
      roadMotorway: '#F1E7D3',
      roadCasing: '#E2DACB',
      rail: '#D3CCBE',
      building: '#E9E4DA',
      buildingTop: '#E3DDD1',
      aeroway: '#E6E1D6',
      boundary: '#CFC6B5',
      label: '#8A857B',
      labelMajor: '#4E4A44',
      labelHalo: '#F4F1EA',
      stationFill: '#FFFFFF',
      stationLabel: '#2D2A26',
      glowOpacity: 0.22,
      coreHighlight: 'rgba(255,255,255,0.0)',
    },
  },
  mist: {
    label: 'Mist',
    map: {
      dark: false,
      background: '#E2E5E9',
      landcover: '#DCE0E4',
      park: '#D5DDD8',
      water: '#BCCAD6',
      waterway: '#AFC0CF',
      roadMinor: '#EEF0F3',
      roadMajor: '#F4F6F8',
      roadMotorway: '#F7F8FA',
      roadCasing: '#CDD2D9',
      rail: '#C3C9D1',
      building: '#D6DAE0',
      buildingTop: '#CFD4DB',
      aeroway: '#D8DCE1',
      boundary: '#B9C0C9',
      label: '#7A828D',
      labelMajor: '#3F4650',
      labelHalo: '#E2E5E9',
      stationFill: '#F7F8FA',
      stationLabel: '#232830',
      glowOpacity: 0.28,
      coreHighlight: 'rgba(255,255,255,0.0)',
    },
  },
  slate: {
    label: 'Slate',
    map: {
      dark: true,
      background: '#121821',
      landcover: '#141B25',
      park: '#152120',
      water: '#0B121B',
      waterway: '#0E1823',
      roadMinor: '#1A222D',
      roadMajor: '#222C38',
      roadMotorway: '#2A3542',
      roadCasing: '#121821',
      rail: '#26303C',
      building: '#18202B',
      buildingTop: '#1F2935',
      aeroway: '#18202A',
      boundary: '#2C3744',
      label: '#5F6B7A',
      labelMajor: '#93A0B0',
      labelHalo: '#121821',
      stationFill: '#0E141C',
      stationLabel: '#DCE3EC',
      glowOpacity: 0.32,
      coreHighlight: 'rgba(255,255,255,0.22)',
    },
  },
};

export const THEME_ORDER: ThemeId[] = ['ivory', 'mist', 'slate'];

export function systemTheme(): ThemeId {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'slate' : 'ivory';
}
