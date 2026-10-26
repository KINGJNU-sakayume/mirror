import { describe, it, expect } from "vitest";
import { refineMotion, solveTwoBone, jointAngle } from "./refine";
import { add, length, sub } from "./math";
import type { MotionFrame, VideoSource, Vec3 } from "./types";
const source: VideoSource = {
  name: "fixture",
  width: 1280,
  height: 720,
  duration: 2,
  size: 100,
  fingerprint: "fixture",
};
function sequence(): MotionFrame[] {
  return Array.from({ length: 30 }, (_, i) => {
    const frame: MotionFrame = {
      time: i / 15,
      people: 1,
      world: null,
      root: [0.008 * Math.sin(i * 1.2), 0, 0],
      image: Array.from({ length: 33 }, () => ({
        x: 0.5,
        y: 0.5,
        z: 0,
        visibility: 0.99,
        presence: 0.99,
      })),
      joints: Array(33).fill(null),
    };
    const noise = 0.018 * Math.sin(i * 1.7);
    for (const [a, b, c, sign] of [
      [23, 25, 27, 1],
      [24, 26, 28, -1],
    ]) {
      frame.joints[a] = {
        position: [sign * 0.12, 0, 0],
        confidence: 0.99,
        interpolated: false,
      };
      frame.joints[b] = {
        position: [sign * 0.12, -0.4, 0.13],
        confidence: 0.99,
        interpolated: false,
      };
      frame.joints[c] = {
        position: [sign * 0.12 + noise, -0.8 + noise * 0.4, 0],
        confidence: 0.99,
        interpolated: false,
      };
      frame.image![c].x = 0.5 + sign * 0.07;
      frame.image![c].y = 0.85;
    }
    return frame;
  });
}
const lengths = { "23-25": 0.42, "25-27": 0.42, "24-26": 0.42, "26-28": 0.42 };
const travel = (positions: Vec3[]) =>
  positions.slice(1).reduce((n, p, i) => n + length(sub(p, positions[i])), 0);
describe("analytic two-bone IK", () => {
  it("reaches a feasible target with exact segment lengths", () => {
    const root: Vec3 = [0, 0, 0],
      s = solveTwoBone(
        root,
        [0, -0.4, 0.1],
        [0, -0.8, 0],
        [0.1, -0.7, 0.05],
        0.45,
        0.45,
      );
    expect(length(sub(s.bend, root))).toBeCloseTo(0.45, 6);
    expect(length(sub(s.end, s.bend))).toBeCloseTo(0.45, 6);
    expect(length(sub(s.end, [0.1, -0.7, 0.05]))).toBeLessThan(1e-6);
  });
  it("clamps an unreachable target without scaling bones", () => {
    const s = solveTwoBone(
      [0, 0, 0],
      [0, -0.4, 0.1],
      [0, -0.8, 0],
      [5, -5, 0],
      0.4,
      0.4,
    );
    expect(length(s.end)).toBeLessThanOrEqual(0.8);
    expect(length(sub(s.bend, [0, 0, 0]))).toBeCloseTo(0.4, 6);
  });
  it("limits extreme folding while retaining the observed bend plane", () => {
    const s = solveTwoBone(
      [0, 0, 0],
      [0, -0.4, 0.1],
      [0, -0.01, 0],
      [0, -0.001, 0],
      0.4,
      0.4,
      (15 * Math.PI) / 180,
    );
    expect(jointAngle([0, 0, 0], s.bend, s.end)).toBeGreaterThanOrEqual(
      (15 * Math.PI) / 180 - 1e-6,
    );
    expect(s.bend[2]).toBeGreaterThan(0);
  });
  it("stays finite on a collinear fully extended observation", () => {
    const s = solveTwoBone(
      [0, 0, 0],
      [0, -0.4, 0],
      [0, -0.8, 0],
      [0, -0.8, 0],
      0.4,
      0.4,
    );
    expect([...s.bend, ...s.end].every(Number.isFinite)).toBe(true);
  });
});
describe("conservative foot-contact refinement", () => {
  it("reduces planted-foot drift on a noisy synthetic fixture", () => {
    const frames = sequence();
    const before = travel(
      frames.map((f) => add(f.joints[27]!.position, f.root)),
    );
    const r = refineMotion(frames, source, lengths);
    const after = travel(
      frames.map((f) => add(f.joints[27]!.position, f.root)),
    );
    expect(r.contactFrames).toBe(30);
    expect(r.ikAdjustments).toBeGreaterThan(20);
    expect(after).toBeLessThan(before * 0.6);
  });
  it("does not mark a stationary raised foot as planted", () => {
    const frames = sequence();
    for (const f of frames) {
      f.image![27].y = 0.5;
      f.joints[27]!.position[1] = -0.3;
    }
    refineMotion(frames, source, lengths);
    expect(frames.every((f) => f.contacts?.left === false)).toBe(true);
  });
  it("does not lock moving feet during fast steps", () => {
    const frames = sequence();
    for (const f of frames) {
      f.image![27].x += f.time * 0.3;
      f.image![28].x += f.time * 0.3;
    }
    const r = refineMotion(frames, source, lengths);
    expect(r.contactFrames).toBe(0);
    expect(r.ikAdjustments).toBe(0);
  });
  it("preserves a long gap with missing joints", () => {
    const frames = sequence();
    for (let i = 8; i < 18; i++) {
      frames[i].joints = Array(33).fill(null);
      frames[i].image = null;
    }
    refineMotion(frames, source, lengths);
    expect(frames[12].joints.every((j) => j === null)).toBe(true);
    expect(frames[12].contacts).toEqual({ left: false, right: false });
  });
  it("does not rewrite image evidence", () => {
    const frames = sequence(),
      before = JSON.stringify(frames.map((f) => f.image));
    refineMotion(frames, source, lengths);
    expect(JSON.stringify(frames.map((f) => f.image))).toBe(before);
  });
  it("keeps both leg segment lengths constant after IK", () => {
    const frames = sequence();
    refineMotion(frames, source, lengths);
    for (const f of frames) {
      expect(
        length(sub(f.joints[25]!.position, f.joints[23]!.position)),
      ).toBeCloseTo(0.42, 6);
      expect(
        length(sub(f.joints[27]!.position, f.joints[25]!.position)),
      ).toBeCloseTo(0.42, 6);
    }
  });
  it("lowers the pelvis for a squat with stationary source feet", () => {
    const frames = sequence();
    for (const f of frames) {
      const rise = 0.2 * Math.sin((f.time / 2) * Math.PI);
      f.joints[27]!.position[1] += rise;
      f.joints[28]!.position[1] += rise;
    }
    refineMotion(frames, source, lengths);
    expect(frames[15].root[1]).toBeLessThan(-0.1);
  });
  it("does not infer contact from low visibility", () => {
    const frames = sequence();
    for (const f of frames) {
      f.image![27].visibility = 0.2;
      f.image![28].visibility = 0.2;
    }
    expect(refineMotion(frames, source, lengths).contactFrames).toBe(0);
  });
});
