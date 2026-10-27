import { refineMotion } from "./refine";
import {
  add,
  clamp,
  length,
  lerp,
  median,
  mul,
  OneEuro,
  sub,
  toCanonical,
} from "./math";
import {
  BODY_JOINTS,
  DEFAULT_PRACTICE,
  FINGER_CHAINS,
  HAND_BASES,
  HAND_COUNT,
  JOINT_COUNT,
  LIMB_CHAINS,
  POSE_COUNT,
  type AnalysisOptions,
  type Joint,
  type MotionData,
  type MotionFrame,
  type RawFrame,
  type Vec3,
  type VideoSource,
} from "./types";
export const MIN_CONFIDENCE = 0.35;
export const MAX_GAP = 0.2;
export const MIN_HAND_SCORE = 0.5;
const xyz = (p: { x: number; y: number; z: number }): Vec3 => [p.x, p.y, p.z];

export function preprocess(
  raw: RawFrame[],
  source: VideoSource,
  options: AnalysisOptions,
  engine: "worker" | "main-thread",
): MotionData {
  const torsos = raw
    .flatMap((f) =>
      f.world && f.world[11]?.visibility > 0.6 && f.world[23]?.visibility > 0.6
        ? [length(sub(xyz(f.world[11]), xyz(f.world[23])))]
        : [],
    )
    .filter((n) => n > 0.15 && n < 1);
  const scale = clamp(0.5 / (median(torsos) || 0.5), 0.5, 2);
  const firstHip = raw.find(
    (f) =>
      f.image && f.image[23]?.visibility > 0.5 && f.image[24]?.visibility > 0.5,
  )?.image;
  const initialX = firstHip ? (firstHip[23].x + firstHip[24].x) / 2 : 0.5;
  const initialHeight = firstHip
    ? Math.abs((firstHip[27]?.y ?? 0.9) - firstHip[11].y)
    : 0.6;
  const filters = Array.from({ length: POSE_COUNT }, () => [
    new OneEuro(),
    new OneEuro(),
    new OneEuro(),
  ]);
  const previous: ({ position: Vec3; time: number } | null)[] =
    Array(POSE_COUNT).fill(null);
  const rootFilters = [new OneEuro(0.7, 0.1), new OneEuro(0.7, 0.1)];
  const frames: MotionFrame[] = raw.map((f) => {
    const w = f.world;
    const hip = w ? mul(add(xyz(w[23]), xyz(w[24])), 0.5) : ([0, 0, 0] as Vec3);
    const hipsVisible =
      w && Math.min(w[23].visibility, w[24].visibility) >= MIN_CONFIDENCE;
    const joints: (Joint | null)[] = Array.from({ length: JOINT_COUNT }, (_, i) => {
      const p = i < POSE_COUNT ? w?.[i] : undefined;
      const confidence = p ? Math.min(p.visibility, p.presence) : 0;
      if (!p || !hipsVisible || confidence < MIN_CONFIDENCE) return null;
      let pos = toCanonical(xyz(p), hip, scale);
      const prev = previous[i];
      // Reject single-frame jumps, with a generous envelope for fast hands/feet.
      const speedLimit = [15, 16, 19, 20, 27, 28, 31, 32].includes(i) ? 24 : 14;
      if (
        prev &&
        f.time - prev.time < 0.15 &&
        length(sub(pos, prev.position)) >
          speedLimit * (f.time - prev.time) + 0.25
      )
        return null;
      previous[i] = { position: pos, time: f.time };
      if (options.smoothing)
        pos = pos.map((v, j) => filters[i][j].filter(v, f.time)) as Vec3;
      return { position: pos, confidence, interpolated: false };
    });
    let root: Vec3 = [0, 0, 0];
    if (f.image && hipsVisible) {
      const x = (f.image[23].x + f.image[24].x) / 2;
      const height = Math.abs(f.image[27].y - f.image[11].y);
      root = [
        rootFilters[0].filter(clamp((x - initialX) * 2.8, -2.5, 2.5), f.time),
        0,
        rootFilters[1].filter(
          clamp((height / Math.max(0.1, initialHeight) - 1) * 1.5, -1, 1),
          f.time,
        ),
      ];
    }
    return { ...f, joints, root };
  });
  // Fill bounded interior gaps per joint, leaving long occlusions explicitly missing.
  for (let j = 0; j < POSE_COUNT; j++) {
    let left = -1;
    for (let i = 0; i < frames.length; i++) {
      if (!frames[i].joints[j]) continue;
      if (
        left >= 0 &&
        i - left > 1 &&
        frames[i].time - frames[left].time <= MAX_GAP + 1e-6
      ) {
        const a = frames[left].joints[j]!,
          b = frames[i].joints[j]!;
        for (let k = left + 1; k < i; k++)
          frames[k].joints[j] = {
            position: lerp(
              a.position,
              b.position,
              (frames[k].time - frames[left].time) /
                (frames[i].time - frames[left].time),
            ),
            confidence: Math.min(a.confidence, b.confidence) * 0.75,
            interpolated: true,
          };
      }
      left = i;
    }
  }
  const boneLengths: Record<string, number> = {};
  for (const chain of LIMB_CHAINS)
    for (let k = 1; k < chain.length; k++) {
      const a = chain[k - 1],
        b = chain[k];
      const distances = frames.flatMap((f) =>
        f.joints[a] &&
        f.joints[b] &&
        f.joints[a]!.confidence > 0.6 &&
        f.joints[b]!.confidence > 0.6
          ? [length(sub(f.joints[b]!.position, f.joints[a]!.position))]
          : [],
      );
      const target = median(distances);
      if (target <= 0) continue;
      boneLengths[`${a}-${b}`] = target;
      for (const f of frames) {
        const parent = f.joints[a],
          child = f.joints[b];
        if (!parent || !child) continue;
        const delta = sub(child.position, parent.position),
          len = length(delta);
        if (len > 1e-5)
          child.position = add(parent.position, mul(delta, target / len));
      }
    }
  for (const [key, a, b] of [
    ["shoulders", 11, 12],
    ["pelvis", 23, 24],
  ] as const) {
    const measured = median(
      frames.flatMap((f) =>
        f.joints[a] &&
        f.joints[b] &&
        Math.min(f.joints[a]!.confidence, f.joints[b]!.confidence) > 0.6
          ? [length(sub(f.joints[a]!.position, f.joints[b]!.position))]
          : [],
      ),
    );
    if (measured > 0.05) boneLengths[key] = measured;
  }
  const torso = median(
    frames.flatMap((f) =>
      f.joints[11] && f.joints[12] && f.joints[23] && f.joints[24]
        ? [
            length(
              sub(
                mul(add(f.joints[11]!.position, f.joints[12]!.position), 0.5),
                mul(add(f.joints[23]!.position, f.joints[24]!.position), 0.5),
              ),
            ),
          ]
        : [],
    ),
  );
  if (torso > 0.1) boneLengths.torso = torso;
  const hands = attachHands(raw, frames, scale, options.smoothing, boneLengths);
  const refinementReport = options.refinement
    ? refineMotion(frames, source, boneLengths)
    : undefined;
  return {
    schema: "form.motion",
    version: 1,
    createdAt: new Date().toISOString(),
    source,
    coordinates: {
      axes: "x-right_y-up_z-toward-camera",
      units: "normalized-meters",
      root: "hip-relative",
      leftRight: "anatomical",
    },
    processing: {
      ...options,
      model: `MediaPipe Pose Landmarker ${options.quality} float16 v1`,
      minConfidence: MIN_CONFIDENCE,
      maxGap: MAX_GAP,
      scale,
      engine,
      boneLengths,
      ...(refinementReport ? { refinementReport } : {}),
    },
    frames,
    statistics: {
      total: frames.length,
      detected: frames.filter((f) => f.world && f.joints[23] && f.joints[24])
        .length,
      partial: frames.filter(
        (f) => f.world && BODY_JOINTS.filter((j) => f.joints[j]).length < 16,
      ).length,
      multiple: raw.filter((f) => f.people > 1).length,
      hands,
    },
    practice: structuredClone(DEFAULT_PRACTICE),
  };
}

interface HandTrack {
  rel: Vec3[];
  score: number;
  interpolated: boolean;
}
// Finger articulation comes from the crop-refined hand model, expressed relative to its
// wrist and then attached to the body's (filtered, length-normalized) wrist joint.
function attachHands(
  raw: RawFrame[],
  frames: MotionFrame[],
  scale: number,
  smoothing: boolean,
  boneLengths: Record<string, number>,
) {
  let detected = 0;
  const tracks = HAND_BASES.map((_, side) => {
    const filters = Array.from({ length: HAND_COUNT }, () => [
      new OneEuro(2.4, 0.8),
      new OneEuro(2.4, 0.8),
      new OneEuro(2.4, 0.8),
    ]);
    const track: (HandTrack | null)[] = raw.map((f) => {
      const obs = f.hands?.[side];
      if (!obs || obs.score < MIN_HAND_SCORE || obs.world.length !== HAND_COUNT)
        return null;
      const origin = xyz(obs.world[0]);
      const rel = obs.world.map((p, i) => {
        const v = toCanonical(xyz(p), origin, scale);
        return smoothing
          ? (v.map((c, k) => filters[i][k].filter(c, f.time)) as Vec3)
          : v;
      });
      return { rel, score: obs.score, interpolated: false };
    });
    let left = -1;
    for (let i = 0; i < track.length; i++) {
      if (!track[i]) continue;
      if (
        left >= 0 &&
        i - left > 1 &&
        frames[i].time - frames[left].time <= MAX_GAP + 1e-6
      ) {
        const a = track[left]!,
          b = track[i]!;
        for (let k = left + 1; k < i; k++) {
          const t =
            (frames[k].time - frames[left].time) /
            (frames[i].time - frames[left].time);
          track[k] = {
            rel: a.rel.map((p, j) => lerp(p, b.rel[j], t)),
            score: Math.min(a.score, b.score) * 0.75,
            interpolated: true,
          };
        }
      }
      left = i;
    }
    const base = HAND_BASES[side];
    for (const chain of FINGER_CHAINS)
      for (let k = 1; k < chain.length; k++) {
        const a = chain[k - 1],
          b = chain[k];
        const target = median(
          track.flatMap((h) =>
            h && !h.interpolated && h.score > 0.6
              ? [length(sub(h.rel[b], h.rel[a]))]
              : [],
          ),
        );
        if (target <= 0) continue;
        boneLengths[`${base + a}-${base + b}`] = target;
        for (const h of track) {
          if (!h) continue;
          const delta = sub(h.rel[b], h.rel[a]),
            len = length(delta);
          if (len > 1e-5) h.rel[b] = add(h.rel[a], mul(delta, target / len));
        }
      }
    return track;
  });
  frames.forEach((f, i) => {
    let any = false;
    HAND_BASES.forEach((base, side) => {
      const wrist = f.joints[side === 0 ? 15 : 16],
        h = tracks[side][i];
      if (!wrist || !h) return;
      any = true;
      h.rel.forEach((rel, j) => {
        f.joints[base + j] = {
          position: add(wrist.position, rel),
          confidence: Math.min(wrist.confidence, h.score),
          interpolated: wrist.interpolated || h.interpolated,
        };
      });
    });
    if (any) detected++;
  });
  return detected;
}

export function motionInterval(
  data: MotionData,
  time: number,
): { a: MotionFrame; b: MotionFrame; t: number } | null {
  const frames = data.frames;
  if (
    !frames.length ||
    time < frames[0].time - 0.1 ||
    time > frames.at(-1)!.time + Math.max(0.1, 1 / data.processing.fps)
  )
    return null;
  let lo = 0,
    hi = frames.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (frames[mid].time <= time) lo = mid;
    else hi = mid - 1;
  }
  const a = frames[lo],
    b = frames[Math.min(lo + 1, frames.length - 1)];
  if (a === b || time <= a.time + 1e-6) return { a, b: a, t: 0 };
  const t = clamp((time - a.time) / (b.time - a.time), 0, 1);
  if (b.time - a.time > MAX_GAP + 1e-6)
    return time - a.time < 0.04 ? { a, b: a, t: 0 } : null;
  return { a, b, t };
}
export function sampleMotion(
  data: MotionData,
  time: number,
): MotionFrame | null {
  const pair = motionInterval(data, time);
  if (!pair) return null;
  const { a, b, t } = pair;
  if (a === b) return a;
  return {
    ...a,
    time,
    root: lerp(a.root, b.root, t),
    image: interpolateLandmarks(a.image, b.image, t),
    world: interpolateLandmarks(a.world, b.world, t),
    ...(a.hands || b.hands
      ? {
          hands: [0, 1].map((side) => {
            const ha = a.hands?.[side],
              hb = b.hands?.[side];
            return ha && hb
              ? {
                  image: interpolateLandmarks(ha.image, hb.image, t)!,
                  world: interpolateLandmarks(ha.world, hb.world, t)!,
                  score: Math.min(ha.score, hb.score),
                }
              : null;
          }) as RawFrame["hands"],
        }
      : {}),
    joints: a.joints.map((v, i) => {
      const next = b.joints[i];
      return v && next
        ? {
            position: lerp(v.position, next.position, t),
            confidence: Math.min(v.confidence, next.confidence),
            interpolated: v.interpolated || next.interpolated,
          }
        : null;
    }),
  };
}
function interpolateLandmarks(
  a: RawFrame["image"],
  b: RawFrame["image"],
  t: number,
): RawFrame["image"] {
  if (!a || !b) return null;
  return a.map((p, i) => ({
    x: p.x + (b[i].x - p.x) * t,
    y: p.y + (b[i].y - p.y) * t,
    z: p.z + (b[i].z - p.z) * t,
    visibility: Math.min(p.visibility, b[i].visibility),
    presence: Math.min(p.presence, b[i].presence),
  }));
}
