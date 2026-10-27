import { describe, expect, it } from "vitest";
import type { HandLandmarkerResult } from "@mediapipe/tasks-vision";
import { DancerTracker, handRegion, uncropHand } from "./estimator";
import type { Landmark } from "../motion/types";
const person = (cx: number, scale = 1): Landmark[] =>
  Array.from({ length: 33 }, (_, i) => ({
    x: cx + ((i % 5) - 2) * 0.02 * scale,
    y: 0.5 + (i / 33 - 0.5) * 0.6 * scale,
    z: 0,
    visibility: 0.9,
    presence: 0.9,
  }));
describe("dancer identity tracking", () => {
  it("starts with the largest person and keeps them when others appear", () => {
    const tracker = new DancerTracker();
    expect(tracker.pick([person(0.2, 0.5), person(0.6)], 0)).toBe(1);
    // Order changes and a bigger stranger enters; the tracked dancer stays selected.
    expect(tracker.pick([person(0.61), person(0.2, 1.4)].reverse(), 0.033)).toBe(1);
  });
  it("reports a miss instead of jumping to a distant person", () => {
    const tracker = new DancerTracker();
    tracker.pick([person(0.3)], 0);
    expect(tracker.pick([person(0.8)], 0.1)).toBe(-1);
    // After the dancer has been gone longer than the memory, re-acquire.
    expect(tracker.pick([person(0.8)], 0.8)).toBe(0);
  });
});
describe("hand crop refinement", () => {
  const pose = person(0.5);
  Object.assign(pose[15], { x: 0.6, y: 0.4 });
  Object.assign(pose[17], { x: 0.62, y: 0.37 });
  Object.assign(pose[19], { x: 0.63, y: 0.38 });
  Object.assign(pose[21], { x: 0.61, y: 0.39 });
  Object.assign(pose[11], { x: 0.55, y: 0.3 });
  Object.assign(pose[12], { x: 0.45, y: 0.3 });
  const region = handRegion(pose, 0, 1000, 500)!;
  const result = (wristU: number, wristV: number) =>
    ({
      landmarks: [
        Array.from({ length: 21 }, (_, i) => ({
          x: i ? 0.6 : wristU,
          y: i ? 0.4 : wristV,
          z: 0.01,
          visibility: 0,
        })),
      ],
      worldLandmarks: [
        Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 })),
      ],
      handedness: [[{ score: 0.93, index: 0, categoryName: "Left", displayName: "" }]],
      handednesses: [],
    }) as unknown as HandLandmarkerResult;
  it("builds a square region that contains the pose wrist and knuckles", () => {
    expect(region.size).toBeGreaterThanOrEqual(48);
    for (const p of [pose[15], pose[19]]) {
      expect(p.x * 1000).toBeGreaterThan(region.sx);
      expect(p.x * 1000).toBeLessThan(region.sx + region.size);
      expect(p.y * 500).toBeGreaterThan(region.sy);
      expect(p.y * 500).toBeLessThan(region.sy + region.size);
    }
  });
  it("maps crop landmarks back to full-frame coordinates", () => {
    const u = (600 - region.sx) / region.size,
      v = (200 - region.sy) / region.size;
    const hand = uncropHand(result(u, v), region, 1000, 500)!;
    expect(hand.image[0].x).toBeCloseTo(0.6, 5);
    expect(hand.image[0].y).toBeCloseTo(0.4, 5);
    expect(hand.score).toBeCloseTo(0.93);
    expect(hand.image[0].visibility).toBeCloseTo(0.93);
  });
  it("rejects the other hand when it does not start at this wrist", () => {
    expect(uncropHand(result(0.98, 0.98), region, 1000, 500)).toBeNull();
  });
  it("skips hands whose pose wrist is not visible", () => {
    const hidden = pose.map((p) => ({ ...p }));
    hidden[16].visibility = 0.1;
    expect(handRegion(hidden, 1, 1000, 500)).toBeNull();
  });
});
