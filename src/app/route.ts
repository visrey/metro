// City routes: /bengaluru, /delhi, /mumbai (under Vite's BASE_URL).
import { CITIES } from '../data/cities';

export const DEFAULT_CITY = 'bengaluru';
const base = import.meta.env.BASE_URL.replace(/\/$/, '');

export function cityFromPath(pathname = window.location.pathname): string {
  const slug = pathname.slice(base.length).replace(/^\/+|\/+$/g, '').split('/')[0].toLowerCase();
  return CITIES.find((c) => c.enabled && c.id === slug)?.id ?? DEFAULT_CITY;
}

export const pathFor = (id: string) => `${base}/${id}`;
