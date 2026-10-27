import { describe, expect, it } from "vitest";
import { length, mirrorPoint, OneEuro, sub, toCanonical } from "./math";
import { preprocess, sampleMotion } from "./preprocess";
import { cacheKey, parseMotion, verifySource } from "./storage";
import {
  JOINT_COUNT,
  JOINT_NAMES,
  LEFT_HAND,
  RIGHT_HAND,
  type HandObservation,
  type Landmark,
  type RawFrame,
  type VideoSource,
} from "./types";
const source: VideoSource = {
  name: "test.mp4",
  width: 640,
  height: 480,
  size: 100,
  duration: 2,
  fingerprint: "test",
};
export function body(time = 0, leftY = -0.5): RawFrame {
  const world: Landmark[] = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    z: 0,
    visibility: 0.99,
    presence: 0.99,
  }));
  const coords: Record<number, number[]> = {
    0: [0, -0.75, -0.05],
    7: [0.07, -0.7, 0],
    8: [-0.07, -0.7, 0],
    11: [0.2, -0.5, 0],
    12: [-0.2, -0.5, 0],
    13: [0.5, leftY, 0],
    14: [-0.5, -0.5, 0],
    15: [0.75, leftY, 0.05],
    16: [-0.75, -0.5, 0.05],
    19: [0.85, leftY, 0.05],
    20: [-0.85, -0.5, 0.05],
    23: [0.1, 0, 0],
    24: [-0.1, 0, 0],
    25: [0.1, 0.4, 0],
    26: [-0.1, 0.4, 0],
    27: [0.1, 0.8, 0],
    28: [-0.1, 0.8, 0],
    29: [0.1, 0.82, -0.05],
    30: [-0.1, 0.82, -0.05],
    31: [0.1, 0.82, -0.15],
    32: [-0.1, 0.82, -0.15],
  };
  for (const [i, c] of Object.entries(coords))
    Object.assign(world[Number(i)], { x: c[0], y: c[1], z: c[2] });
  return {
    time,
    world,
    image: world.map((p) => ({ ...p, x: p.x * 0.4 + 0.5, y: p.y * 0.5 + 0.5 })),
    people: 1,
  };
}
const missing = (time: number): RawFrame => ({
  time,
  image: null,
  world: null,
  people: 0,
});
const data = (frames: RawFrame[]) =>
  preprocess(
    frames,
    source,
    { fps: 15, quality: "lite", smoothing: false },
    "worker",
  );
describe("coordinate and mirror conventions", () => {
  it("converts down and away axes and removes the hip origin", () => {
    expect(toCanonical([2, 3, 4], [1, 1, 1], 2)).toEqual([2, -4, -6]);
  });
  it("reflects once without changing height or depth", () => {
    expect(mirrorPoint([0.3, 0.8, -0.2])).toEqual([-0.3, 0.8, -0.2]);
  });
  it("is reversible without mutating measured data", () => {
    const p: [number, number, number] = [0.3, 0.8, -0.2];
    expect(mirrorPoint(mirrorPoint(p))).toEqual(p);
    expect(p[0]).toBe(0.3);
  });
  it("preserves anatomical left labels for asymmetric raised arms", () => {
    const d = data([body(0, -0.9)]),
      f = d.frames[0];
    expect(f.joints[15]!.position[1]).toBeGreaterThan(
      f.joints[16]!.position[1],
    );
    expect(JOINT_NAMES[15]).toBe("왼쪽 손목");
    expect(mirrorPoint(f.joints[15]!.position)[0]).toBeLessThan(0);
    expect(f.world![15].x).toBe(0.75);
  });
});
describe("timestamp sampling", () => {
  it("interpolates at the source-video time", () => {
    const d = data([body(0), body(0.1, -0.7)]);
    const a = d.frames[0].joints[15]!.position,
      b = d.frames[1].joints[15]!.position;
    expect(sampleMotion(d, 0.05)!.joints[15]!.position[1]).toBeCloseTo(
      (a[1] + b[1]) / 2,
    );
  });
  it("supports immediate backward seeks without stateful drift", () => {
    const d = data([body(0), body(0.1, -0.7)]);
    sampleMotion(d, 0.09);
    expect(sampleMotion(d, 0)).toEqual(d.frames[0]);
  });
  it("uses timestamps and is independent of playback speed", () => {
    const d = data([body(0), body(0.1, -0.7)]);
    expect(sampleMotion(d, 0.04)).toEqual(sampleMotion(d, 0.04));
    expect(sampleMotion(d, 0.08)!.time).toBe(0.08);
  });
  it("does not bridge a long unsampled interval", () => {
    expect(sampleMotion(data([body(0), body(0.8)]), 0.4)).toBeNull();
  });
  it("returns missing for times outside motion coverage", () => {
    const d = data([body(0), body(0.1)]);
    expect(sampleMotion(d, 1)).toBeNull();
  });
  it("does not fill missing joints merely to make playback smooth", () => {
    const d = data([
      body(0),
      missing(0.1),
      missing(0.2),
      missing(0.3),
      body(0.4),
    ]);
    expect(sampleMotion(d, 0.15)!.joints[15]).toBeNull();
  });
});
describe("temporal reconstruction", () => {
  it("fills a short bounded interior gap and labels it", () => {
    const d = data([body(0), missing(0.05), body(0.1)]);
    expect(d.frames[1].joints[15]?.interpolated).toBe(true);
    expect(d.frames[1].world).toBeNull();
    expect(d.frames[1].joints[15]!.confidence).toBeLessThan(0.99);
  });
  it("leaves long occlusions missing", () => {
    const d = data([
      body(0),
      missing(0.1),
      missing(0.2),
      missing(0.3),
      body(0.4),
    ]);
    expect(d.frames[2].joints[15]).toBeNull();
  });
  it("does not fabricate leading or trailing gaps", () => {
    const d = data([missing(0), body(0.1), missing(0.2)]);
    expect(d.frames[0].joints.every((j) => j === null)).toBe(true);
    expect(d.frames[2].joints.every((j) => j === null)).toBe(true);
  });
  it("keeps median limb length constant across changing poses", () => {
    const d = data([body(0), body(0.1, -0.7), body(0.2, -0.9)]);
    const distances = d.frames.map((f) =>
      length(sub(f.joints[13]!.position, f.joints[11]!.position)),
    );
    expect(Math.max(...distances) - Math.min(...distances)).toBeLessThan(1e-7);
  });
  it("does not trust low-confidence hip roots", () => {
    const f = body(0);
    f.world![23].visibility = 0.1;
    expect(data([f]).frames[0].joints.every((j) => j === null)).toBe(true);
  });
  it("preserves an observed body turn instead of re-facing every frame", () => {
    const f = body(0);
    for (const p of f.world!) {
      const x = p.x;
      p.x = p.z;
      p.z = -x;
    }
    const d = data([f]);
    expect(d.frames[0].joints[11]!.position[2]).toBeGreaterThan(
      d.frames[0].joints[12]!.position[2],
    );
  });
  it("keeps footwork as a 3D articulated step", () => {
    const f = body(0.1);
    f.world![25].z = -0.2;
    f.world![27].z = -0.35;
    const d = data([body(0), f]);
    expect(d.frames[1].joints[27]!.position[2]).toBeGreaterThan(
      d.frames[0].joints[27]!.position[2],
    );
  });
  it("handles an occluded wrist without discarding the visible other arm", () => {
    const f = body(0);
    f.world![15].visibility = 0.1;
    const d = data([f]);
    expect(d.frames[0].joints[15]).toBeNull();
    expect(d.frames[0].joints[16]).not.toBeNull();
  });
  it("rejects a wildly displaced single joint", () => {
    const f = body(0.05);
    f.world![15].x = 20;
    expect(data([body(0), f]).frames[1].joints[15]).toBeNull();
  });
  it("uses an adaptive cutoff to retain fast gestures", () => {
    const adaptive = new OneEuro(1, 0.8),
      fixed = new OneEuro(1, 0);
    adaptive.filter(0, 0);
    fixed.filter(0, 0);
    expect(adaptive.filter(1, 0.05)).toBeGreaterThan(fixed.filter(1, 0.05));
  });
  it("resets smoothing after a long occlusion", () => {
    const filter = new OneEuro();
    filter.filter(0, 0);
    expect(filter.filter(1, 1)).toBe(1);
  });
});
describe("versioned import boundary", () => {
  it("round-trips original landmarks, canonical joints and practice", () => {
    const d = data([body(0), body(0.1)]);
    expect(JSON.stringify(parseMotion(JSON.stringify(d)))).toBe(
      JSON.stringify(d),
    );
  });
  it("round-trips refinement reports, contacts, and source provenance", () => {
    const d = preprocess(
      [body(0), body(0.1), body(0.2)],
      {
        ...source,
        origin: {
          kind: "tab-capture",
          url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
        },
      },
      { fps: 15, quality: "lite", smoothing: false, refinement: true },
      "worker",
    );
    expect(JSON.stringify(parseMotion(JSON.stringify(d)))).toBe(
      JSON.stringify(d),
    );
  });
  it("rejects invalid refinement metadata", () => {
    const d = data([body(0)]);
    d.processing.refinementReport = {
      version: 1,
      assumption: "fixed-camera",
      groundY: NaN,
      contactFrames: 1,
      ikAdjustments: 1,
      angleConstraints: 0,
      maxFootAdjustment: 0,
    };
    expect(() => parseMotion(JSON.stringify(d))).toThrow();
  });
  it("rejects unsafe imported provenance", () => {
    const d = data([body(0)]);
    d.source = {
      ...d.source,
      origin: { kind: "direct-url", url: "javascript:alert(1)" },
    };
    expect(() => parseMotion(JSON.stringify(d))).toThrow();
  });
  it("separates corrected and baseline cache entries", () =>
    expect(cacheKey(source, 15, "lite", true, true)).not.toBe(
      cacheKey(source, 15, "lite", true, false),
    ));
  it("rejects other coordinate conventions", () => {
    const d = data([body(0)]);
    d.coordinates.axes = "y-down" as never;
    expect(() => parseMotion(JSON.stringify(d))).toThrow();
  });
  it("rejects non-chronological timestamps", () => {
    const d = data([body(0), body(0.1)]);
    d.frames[1].time = 0;
    expect(() => parseMotion(JSON.stringify(d))).toThrow();
  });
  it("rejects malformed or missing landmark arrays", () => {
    const d = data([body(0)]);
    d.frames[0].image = [];
    expect(() => parseMotion(JSON.stringify(d))).toThrow();
  });
  it("rejects non-finite / null joint coordinates", () => {
    const d = data([body(0)]);
    d.frames[0].joints[15]!.position[0] = NaN;
    expect(() => parseMotion(JSON.stringify(d))).toThrow();
  });
  it("rejects practice segments outside source duration", () => {
    const d = data([body(0)]);
    d.practice.segments = [{ id: "x", name: "bad", start: 0, end: 3 }];
    expect(() => parseMotion(JSON.stringify(d))).toThrow();
  });
  it("rejects mismatched original media", () => {
    expect(() =>
      verifySource(data([body(0)]), { ...source, fingerprint: "different" }),
    ).toThrow();
  });
});

// MediaPipe hand world axes: x right, y down, z away; fingers point image-right.
function hand(spread = 0.02, score = 0.9): HandObservation {
  const world: Landmark[] = Array.from({ length: 21 }, (_, i) => ({
    x: i === 0 ? 0 : 0.03 + (((i - 1) % 4) + 1) * 0.02,
    y: i === 0 ? 0 : (Math.floor((i - 1) / 4) - 2) * spread,
    z: 0,
    visibility: score,
    presence: score,
  }));
  return { image: world.map((p) => ({ ...p, x: p.x + 0.7 })), world, score };
}
const withHands = (f: RawFrame, left = hand(), right: HandObservation | null = null) => ({
  ...f,
  hands: [left, right] as RawFrame["hands"],
});
describe("finger analysis", () => {
  it("adds 21 joints per hand attached at the body wrist", () => {
    const d = data([withHands(body(0))]);
    const f = d.frames[0];
    expect(f.joints).toHaveLength(JOINT_COUNT);
    expect(JOINT_NAMES).toHaveLength(JOINT_COUNT);
    expect(f.joints[LEFT_HAND]!.position).toEqual(f.joints[15]!.position);
    expect(f.joints[LEFT_HAND + 8]!.position[0]).toBeGreaterThan(
      f.joints[15]!.position[0],
    );
    expect(f.joints[RIGHT_HAND]).toBeNull();
    expect(d.statistics.hands).toBe(1);
  });
  it("converts hand axes like the body (image down becomes canonical up)", () => {
    const f = data([withHands(body(0))]).frames[0];
    // Thumb chain sits at negative MediaPipe y (up in the image) => positive canonical y.
    expect(f.joints[LEFT_HAND + 4]!.position[1]).toBeGreaterThan(
      f.joints[LEFT_HAND + 20]!.position[1],
    );
  });
  it("ignores low-confidence hands", () => {
    const f = data([withHands(body(0), hand(0.02, 0.2))]).frames[0];
    expect(f.joints[LEFT_HAND]).toBeNull();
  });
  it("fills a short finger gap and labels it", () => {
    const d = data([withHands(body(0)), body(0.1), withHands(body(0.2))]);
    expect(d.frames[1].joints[LEFT_HAND + 8]?.interpolated).toBe(true);
  });
  it("follows the wrist when the arm moves", () => {
    const d = data([withHands(body(0)), withHands(body(0.1, -0.7))]);
    const delta = (k: number) =>
      sub(d.frames[k].joints[LEFT_HAND + 8]!.position, d.frames[k].joints[15]!.position);
    expect(length(sub(delta(0), delta(1)))).toBeLessThan(1e-6);
  });
  it("round-trips hand observations and pads body-only files", () => {
    const d = data([withHands(body(0))]);
    const parsed = parseMotion(JSON.stringify(d));
    expect(parsed.frames[0].hands?.[0]?.image).toHaveLength(21);
    const old = data([body(0)]);
    old.frames.forEach((f) => (f.joints.length = 33));
    const upgraded = parseMotion(JSON.stringify(old));
    expect(upgraded.frames[0].joints).toHaveLength(JOINT_COUNT);
    expect(upgraded.frames[0].joints[LEFT_HAND]).toBeNull();
  });
  it("rejects malformed hand observations", () => {
    const d = data([withHands(body(0))]);
    d.frames[0].hands![0]!.world = [];
    expect(() => parseMotion(JSON.stringify(d))).toThrow();
  });
  it("separates finger and body-only cache entries", () =>
    expect(cacheKey(source, 30, "full", true, true, true)).not.toBe(
      cacheKey(source, 30, "full", true, true, false),
    ));
});
