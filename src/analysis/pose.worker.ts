import {
  createEstimators,
  DancerTracker,
  detectFrame,
  HAND_CROP,
  type CropSurface,
  type Estimators,
} from "./estimator";
import type { Quality } from "../motion/types";
let estimators: Estimators | null = null;
let crop: CropSurface | null = null;
const tracker = new DancerTracker();
self.onmessage = async ({ data }: MessageEvent) => {
  try {
    if (data.type === "init") {
      estimators?.close();
      tracker.reset();
      estimators = await createEstimators(
        data.base,
        data.quality as Quality,
        Boolean(data.hands),
        () => new OffscreenCanvas(1, 1),
      );
      const canvas = new OffscreenCanvas(HAND_CROP, HAND_CROP);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      crop = ctx ? { canvas, ctx } : null;
      self.postMessage({ type: "ready" });
    } else if (data.type === "frame") {
      const bitmap = data.bitmap as ImageBitmap;
      try {
        if (!estimators) throw new Error("Estimator is not ready");
        self.postMessage({
          type: "result",
          frame: detectFrame(estimators, tracker, bitmap, data.time, crop),
        });
      } finally {
        bitmap.close();
      }
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
