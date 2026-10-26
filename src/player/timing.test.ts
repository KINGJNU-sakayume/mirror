import { describe, expect, it } from "vitest";
import {
  countMarkers,
  eightCount,
  loopTarget,
  timecode,
  validLoop,
} from "./timing";
describe("A–B loop boundaries", () => {
  const loop = { start: 1, end: 2, enabled: true };
  it("restarts at B", () => expect(loopTarget(2, loop, 4)).toBe(1));
  it("continues inside the range", () =>
    expect(loopTarget(1.5, loop, 4)).toBeNull());
  it("reenters A when playback starts outside the range", () =>
    expect(loopTarget(0.5, loop, 4)).toBe(1));
  it("does not change time when looping is off", () =>
    expect(loopTarget(3, { ...loop, enabled: false }, 4)).toBeNull());
  it("rejects reversed, too short and out-of-bounds loops", () => {
    expect(validLoop({ ...loop, start: 2, end: 1 }, 4)).toBe(false);
    expect(validLoop({ ...loop, start: 1, end: 1.01 }, 4)).toBe(false);
    expect(validLoop({ ...loop, end: 5 }, 4)).toBe(false);
  });
  it("does not seek an invalid loop", () =>
    expect(loopTarget(1, { start: 2, end: 1, enabled: true }, 4)).toBeNull());
});
describe("manual eight-count timing", () => {
  it("starts group 2 on beat 9 at 120 BPM", () =>
    expect(eightCount(4, 120, 0, 10)).toEqual({
      group: 1,
      start: 4,
      end: 8,
      count: 1,
    }));
  it("applies the first-downbeat offset", () => {
    expect(eightCount(1, 120, 0.5, 10).count).toBe(2);
    expect(eightCount(0.2, 120, 0.5, 10).count).toBe(0);
  });
  it("bounds the final loop to the source duration", () =>
    expect(eightCount(9, 120, 0, 10).end).toBe(10));
  it("generates count divisions from manual BPM", () =>
    expect(countMarkers(2, 120, 0).map((m) => m.time)).toEqual([
      0, 0.5, 1, 1.5,
    ]));
  it("formats video timestamps consistently", () =>
    expect(timecode(65.25)).toBe("01:05.25"));
});
