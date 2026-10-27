import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
  type HandLandmarkerResult,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import type {
  HandObservation,
  Landmark,
  Quality,
  RawFrame,
} from "../motion/types";
type Point = {
  x: number;
  y: number;
  z: number;
  visibility?: number;
  presence?: number;
};
export interface Estimators {
  pose: PoseLandmarker;
  // One tracker per anatomical side: [left, right].
  hands: [HandLandmarker, HandLandmarker] | null;
  close(): void;
}
export type CropSurface = {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
};
export const HAND_CROP = 256;
export async function createEstimators(
  base: string,
  quality: Quality,
  withHands: boolean,
  canvas?: () => OffscreenCanvas,
): Promise<Estimators> {
  const fileset = await FilesetResolver.forVisionTasks(`${base}wasm`);
  const pose = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: `${base}models/pose_landmarker_${quality}.task`,
      delegate: "CPU",
    },
    runningMode: "VIDEO",
    // Several candidates so a background person can be skipped instead of dropping the frame.
    numPoses: 3,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
    ...(canvas ? { canvas: canvas() } : {}),
  });
  let hands: [HandLandmarker, HandLandmarker] | null = null;
  if (withHands) {
    // VIDEO mode per side: each crop is re-centered on its pose wrist, so the previous
    // frame's hand box stays valid in crop space and palm re-detection is usually skipped.
    const create = () =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: `${base}models/hand_landmarker.task`,
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numHands: 1,
        minHandDetectionConfidence: 0.4,
        minHandPresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
        ...(canvas ? { canvas: canvas() } : {}),
      });
    try {
      hands = [await create(), await create()];
    } catch (error) {
      // Finger detail is optional; body analysis continues and statistics report zero hands.
      console.warn("Hand landmarker unavailable; analyzing body only.", error);
    }
  }
  return {
    pose,
    hands,
    close() {
      pose.close();
      hands?.forEach((h) => h.close());
    },
  };
}
const copy = (values: Point[], score?: number): Landmark[] =>
  values.map((p) => ({
    x: p.x,
    y: p.y,
    z: p.z,
    visibility: score ?? p.visibility ?? 1,
    presence: score ?? p.presence ?? 1,
  }));

// Keeps one dancer's identity across frames when several people are visible.
export class DancerTracker {
  private last: { x: number; y: number; time: number } | null = null;
  constructor(
    private maxJump = 0.2,
    private memory = 0.5,
  ) {}
  reset() {
    this.last = null;
  }
  pick(poses: Point[][], time: number): number {
    if (!poses.length) return -1;
    const describe = (pose: Point[]) => {
      const seen = pose.filter((p) => (p.visibility ?? 1) > 0.3);
      const hips = [pose[23], pose[24]].filter(
        (p) => p && (p.visibility ?? 1) > 0.3,
      );
      const center = hips.length === 2 ? hips : seen.length ? seen : pose;
      const xs = seen.map((p) => p.x),
        ys = seen.map((p) => p.y);
      return {
        x: center.reduce((s, p) => s + p.x, 0) / center.length,
        y: center.reduce((s, p) => s + p.y, 0) / center.length,
        area: seen.length
          ? (Math.max(...xs) - Math.min(...xs)) *
            (Math.max(...ys) - Math.min(...ys))
          : 0,
      };
    };
    const candidates = poses.map(describe);
    let index = -1;
    if (this.last && time - this.last.time <= this.memory) {
      let best = Infinity;
      candidates.forEach((c, i) => {
        const d = Math.hypot(c.x - this.last!.x, c.y - this.last!.y);
        if (d < best) {
          best = d;
          index = i;
        }
      });
      // Nobody near the tracked dancer: report a miss rather than switch identities.
      if (best > this.maxJump) return -1;
    } else {
      let largest = -1;
      candidates.forEach((c, i) => {
        if (c.area > largest) {
          largest = c.area;
          index = i;
        }
      });
    }
    this.last = { x: candidates[index].x, y: candidates[index].y, time };
    return index;
  }
}
export function serializeResult(
  result: PoseLandmarkerResult,
  time: number,
  tracker: DancerTracker,
): RawFrame {
  const index =
    result.landmarks.length === result.worldLandmarks.length
      ? tracker.pick(result.landmarks, time)
      : -1;
  return {
    time,
    people: result.landmarks.length,
    image: index >= 0 ? copy(result.landmarks[index]) : null,
    world: index >= 0 ? copy(result.worldLandmarks[index]) : null,
  };
}

export interface HandRegion {
  sx: number;
  sy: number;
  size: number;
  wrist: [number, number];
}
// Square pixel region around one pose hand (wrist, pinky, index, thumb).
export function handRegion(
  pose: Landmark[],
  side: 0 | 1,
  width: number,
  height: number,
): HandRegion | null {
  const [w, pinky, index, thumb] = (side === 0
    ? [15, 17, 19, 21]
    : [16, 18, 20, 22]
  ).map((i) => pose[i]);
  if (!w || w.visibility < 0.3) return null;
  const px = (p: Landmark): [number, number] => [p.x * width, p.y * height];
  const wrist = px(w),
    knuckles = [pinky, index].filter((p) => p && p.visibility > 0.2).map(px);
  const tip: [number, number] = knuckles.length
    ? [
        knuckles.reduce((s, p) => s + p[0], 0) / knuckles.length,
        knuckles.reduce((s, p) => s + p[1], 0) / knuckles.length,
      ]
    : wrist;
  const reach = Math.hypot(tip[0] - wrist[0], tip[1] - wrist[1]);
  const shoulders = Math.hypot(
    (pose[11].x - pose[12].x) * width,
    (pose[11].y - pose[12].y) * height,
  );
  const size = Math.max(reach * 3.4, shoulders * 0.6, 48);
  // Pose knuckles sit near the palm; fingers extend further along the same direction.
  const center: [number, number] = [
    wrist[0] + (tip[0] - wrist[0]) * 1.1,
    wrist[1] + (tip[1] - wrist[1]) * 1.1,
  ];
  if (thumb && thumb.visibility > 0.2) {
    const t = px(thumb);
    center[0] += (t[0] - center[0]) * 0.15;
    center[1] += (t[1] - center[1]) * 0.15;
  }
  return {
    sx: center[0] - size / 2,
    sy: center[1] - size / 2,
    size,
    wrist,
  };
}
// Maps crop-normalized hand landmarks back to full-frame normalized coordinates.
export function uncropHand(
  result: HandLandmarkerResult,
  region: HandRegion,
  width: number,
  height: number,
): HandObservation | null {
  if (!result.landmarks.length || !result.worldLandmarks.length) return null;
  const points = result.landmarks[0],
    scale = region.size;
  const image = points.map((p) => ({
    x: (region.sx + p.x * scale) / width,
    y: (region.sy + p.y * scale) / height,
    z: (p.z * scale) / width,
  }));
  const wx = image[0].x * width - region.wrist[0],
    wy = image[0].y * height - region.wrist[1];
  // The crop can contain the other hand; it must start at this side's pose wrist.
  if (Math.hypot(wx, wy) > region.size * 0.3) return null;
  const score = Math.min(1, Math.max(0, result.handedness[0]?.[0]?.score ?? 0.8));
  return {
    image: copy(image, score),
    world: copy(result.worldLandmarks[0], score),
    score,
  };
}
export function detectFrame(
  estimators: Estimators,
  tracker: DancerTracker,
  image: ImageBitmap | HTMLCanvasElement,
  time: number,
  crop: CropSurface | null,
): RawFrame {
  const frame = serializeResult(
    estimators.pose.detectForVideo(image, time * 1000),
    time,
    tracker,
  );
  if (!estimators.hands || !crop || !frame.image) return frame;
  const { width, height } = image;
  const hands = ([0, 1] as const).map((side) => {
    const region = handRegion(frame.image!, side, width, height);
    if (!region) return null;
    crop.ctx.clearRect(0, 0, HAND_CROP, HAND_CROP);
    crop.ctx.drawImage(
      image,
      region.sx,
      region.sy,
      region.size,
      region.size,
      0,
      0,
      HAND_CROP,
      HAND_CROP,
    );
    return uncropHand(
      estimators.hands![side].detectForVideo(crop.canvas, time * 1000),
      region,
      width,
      height,
    );
  });
  frame.hands = [hands[0], hands[1]];
  return frame;
}
