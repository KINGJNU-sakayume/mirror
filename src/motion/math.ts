import type { Vec3 } from "./types";
export const add = (a: Vec3, b: Vec3): Vec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
export const sub = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
export const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const length = (a: Vec3) => Math.hypot(...a);
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 =>
  add(a, mul(sub(b, a), t));
export const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
export const median = (values: number[]) => {
  const v = [...values].sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
};
// MediaPipe: x image-right, y down, z away. Canonical: x image-right, y up, z toward camera.
export const toCanonical = (point: Vec3, hip: Vec3, scale: number): Vec3 => [
  (point[0] - hip[0]) * scale,
  -(point[1] - hip[1]) * scale,
  -(point[2] - hip[2]) * scale,
];
// Presentation reflection only. Never relabel or mutate anatomical observations.
export const mirrorPoint = (point: Vec3): Vec3 => [
  -point[0],
  point[1],
  point[2],
];

export class OneEuro {
  private value = 0;
  private derivative = 0;
  private previousRaw = 0;
  private time = -1;
  constructor(
    private minCutoff = 1.8,
    private beta = 0.6,
  ) {}
  filter(value: number, time: number) {
    if (this.time < 0 || time - this.time > 0.25) {
      this.value = value;
      this.previousRaw = value;
      this.derivative = 0;
      this.time = time;
      return value;
    }
    const dt = Math.max(1e-4, time - this.time);
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    this.derivative +=
      alpha(1) * ((value - this.previousRaw) / dt - this.derivative);
    this.value +=
      alpha(this.minCutoff + this.beta * Math.abs(this.derivative)) *
      (value - this.value);
    this.previousRaw = value;
    this.time = time;
    return this.value;
  }
}
