import { clamp } from "../motion/math";
export interface LoopRange {
  start: number;
  end: number;
  enabled: boolean;
}
export const validLoop = (loop: LoopRange, duration: number) =>
  loop.start >= 0 &&
  loop.end <= duration + 0.001 &&
  loop.end - loop.start >= 0.05;
export function loopTarget(
  time: number,
  loop: LoopRange,
  duration: number,
): number | null {
  if (!loop.enabled || !validLoop(loop, duration)) return null;
  return time >= loop.end - 0.002 || time < loop.start - 0.002
    ? loop.start
    : null;
}
export function eightCount(
  time: number,
  bpm: number,
  offset: number,
  duration: number,
) {
  const beat = 60 / bpm,
    group = Math.max(0, Math.floor((time - offset + 1e-7) / (8 * beat)));
  return {
    group,
    start: clamp(offset + group * 8 * beat, 0, duration),
    end: clamp(offset + (group + 1) * 8 * beat, 0, duration),
    count:
      time < offset ? 0 : (Math.floor((time - offset + 1e-7) / beat) % 8) + 1,
  };
}
export function countMarkers(duration: number, bpm: number, offset: number) {
  const beat = 60 / bpm;
  return Array.from(
    {
      length: Math.max(
        0,
        Math.min(3001, Math.ceil((duration - offset) / beat)),
      ),
    },
    (_, i) => ({
      time: offset + i * beat,
      count: (i % 8) + 1,
      group: Math.floor(i / 8),
    }),
  );
}
export function timecode(time: number) {
  const ms = Math.floor(Math.max(0, time) * 100);
  return `${String(Math.floor(ms / 6000)).padStart(2, "0")}:${String(Math.floor(ms / 100) % 60).padStart(2, "0")}.${String(ms % 100).padStart(2, "0")}`;
}
