// Station-to-station motion: accelerate at `a` up to `v`, cruise, brake at `a`.
// If the hop is too short to reach `v`, the profile is triangular.

export interface MotionParams {
  /** Top speed, m/s */
  v: number;
  /** Acceleration = braking, m/s² */
  a: number;
}

/** Seconds to travel a hop of `d` metres from standstill to standstill. */
export function hopTime(d: number, { v, a }: MotionParams): number {
  if (d <= 0) return 0;
  return d >= (v * v) / a ? d / v + v / a : 2 * Math.sqrt(d / a);
}

/** Seconds after departure at which the train has covered `x` of a `d`-metre hop. */
export function timeAtDistance(x: number, d: number, p: MotionParams): number {
  const { a } = p;
  if (x <= 0) return 0;
  const total = hopTime(d, p);
  if (x >= d) return total;
  const peak = Math.min(p.v, Math.sqrt(a * d)); // speed actually reached
  const accelDist = (peak * peak) / (2 * a);
  if (x <= accelDist) return Math.sqrt((2 * x) / a);
  if (x <= d - accelDist) return peak / a + (x - accelDist) / peak;
  return total - Math.sqrt((2 * (d - x)) / a);
}
