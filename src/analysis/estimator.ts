import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import type { Landmark, Quality, RawFrame } from "../motion/types";
export async function createEstimator(
  base: string,
  quality: Quality,
  canvas?: OffscreenCanvas,
) {
  const fileset = await FilesetResolver.forVisionTasks(`${base}wasm`);
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: `${base}models/pose_landmarker_${quality}.task`,
      delegate: "CPU",
    },
    runningMode: "VIDEO",
    numPoses: 2,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
    ...(canvas ? { canvas } : {}),
  });
}
export function serializeResult(
  result: PoseLandmarkerResult,
  time: number,
): RawFrame {
  const copy = (
    values: {
      x: number;
      y: number;
      z: number;
      visibility?: number;
      presence?: number;
    }[],
  ): Landmark[] =>
    values.map((p) => ({
      x: p.x,
      y: p.y,
      z: p.z,
      visibility: p.visibility ?? 1,
      presence: p.presence ?? 1,
    }));
  // Reject ambiguous multi-person frames instead of switching dancer identities.
  return {
    time,
    people: result.landmarks.length,
    image: result.landmarks.length === 1 ? copy(result.landmarks[0]) : null,
    world:
      result.worldLandmarks.length === 1
        ? copy(result.worldLandmarks[0])
        : null,
  };
}
