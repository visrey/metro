// deck.gl overlay that draws simulated trains: a fading light trail (TripsLayer,
// animated on the GPU via `currentTime`) plus a glowing head per running train.

import { MapboxOverlay } from '@deck.gl/mapbox';
import { TripsLayer } from '@deck.gl/geo-layers';
import { ScatterplotLayer } from '@deck.gl/layers';
import type { PickingInfo } from '@deck.gl/core';
import type { IControl, Map as MlMap } from 'maplibre-gl';
import { useClock } from '../sim/clock';
import { trainsAt, type TrainState, type Trip } from '../sim/timetable';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

type RGB = [number, number, number];
const mix = (c: RGB, to: number, f: number): RGB => [c[0] + (to - c[0]) * f, c[1] + (to - c[1]) * f, c[2] + (to - c[2]) * f] as RGB;

/** Trail length in simulated seconds (~600 m at cruise). Peak trains are ~1.7 km apart, so longer trails merge into one lit line. */
const TRAIL_SEC = 75;

export class TrainsOverlay {
  private overlay: MapboxOverlay;
  private trips: Trip[] = [];
  private dark = true;
  private unsubscribe: () => void;

  constructor(
    private map: MlMap,
    private lineName: (id: string) => string,
  ) {
    this.overlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
      getTooltip: (info: PickingInfo<TrainState>) => this.tooltip(info),
    });
    map.addControl(this.overlay as unknown as IControl);
    this.unsubscribe = useClock.subscribe((s, prev) => {
      if (s.t !== prev.t) this.render(s.t);
    });
  }

  setTrips(trips: Trip[]) {
    this.trips = trips;
    this.render(useClock.getState().t);
  }

  setDark(dark: boolean) {
    this.dark = dark;
    this.render(useClock.getState().t);
  }

  destroy() {
    this.unsubscribe();
    this.map.removeControl(this.overlay as unknown as IControl);
  }

  private render(t: number) {
    const heads = trainsAt(this.trips, t);
    useClock.getState().setRunning(heads.length);
    const dark = this.dark;

    // The trail sits on top of its own line, so it must out-shine it: a brighter
    // tone on dark maps, a deeper one on light maps (the static lines are dimmed too).
    const trailColor = (d: Trip) => (dark ? mix(d.color, 255, 0.35) : mix(d.color, 0, 0.2));
    const trail = (id: string, width: number, opacity: number, length: number) =>
      new TripsLayer<Trip>({
        id,
        data: this.trips,
        getPath: (d) => d.path,
        getTimestamps: (d) => d.timestamps,
        getColor: id.includes('glow') ? (d) => d.color : trailColor,
        updateTriggers: { getColor: dark },
        widthUnits: 'pixels',
        getWidth: width,
        widthMinPixels: width,
        capRounded: true,
        jointRounded: true,
        fadeTrail: true,
        trailLength: length,
        currentTime: t,
        opacity,
      });

    this.overlay.setProps({
      layers: [
        trail('train-trail-glow', 16, dark ? 0.55 : 0.35, TRAIL_SEC * 0.8),
        trail('train-trail', 5, 1, TRAIL_SEC),
        new ScatterplotLayer<TrainState>({
          id: 'train-halo',
          data: heads,
          getPosition: (d) => d.position,
          getFillColor: (d) => [...mix(d.trip.color, 255, dark ? 0.5 : 0), dark ? 120 : 90],
          radiusUnits: 'pixels',
          getRadius: 9,
          updateTriggers: { getFillColor: dark },
        }),
        new ScatterplotLayer<TrainState>({
          id: 'train-core',
          data: heads,
          getPosition: (d) => d.position,
          getFillColor: (d) => (dark ? [255, 255, 255, 255] : [...d.trip.color, 255]),
          getLineColor: (d) => (dark ? [...d.trip.color, 255] : [255, 255, 255, 255]),
          stroked: true,
          lineWidthUnits: 'pixels',
          getLineWidth: 1.6,
          radiusUnits: 'pixels',
          getRadius: 4.5,
          pickable: true,
          autoHighlight: true,
          highlightColor: [255, 255, 255, 200],
          updateTriggers: { getFillColor: dark, getLineColor: dark },
        }),
      ],
    });
  }

  private tooltip({ object, layer }: PickingInfo<TrainState>) {
    if (!object || layer?.id !== 'train-core') return null;
    const [r, g, b] = object.trip.color;
    return {
      html: `<div class="tip-line" style="--line: rgb(${r},${g},${b})">${esc(this.lineName(object.trip.lineId))}</div>
             <div class="tip-to">→ ${esc(object.trip.towards)}</div>
             <div class="tip-at">${object.atStation ? 'At' : 'Next'}: <b>${esc(object.station)}</b></div>`,
      className: 'train-tip',
      style: { background: 'none', padding: '0', color: 'inherit' },
    };
  }
}
