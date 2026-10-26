import { createEstimator, serializeResult } from "./estimator";
import type { Quality } from "../motion/types";
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
let estimator: PoseLandmarker | null = null;
self.onmessage = async ({ data }: MessageEvent) => {
  try {
    if (data.type === "init") {
      estimator = await createEstimator(
        data.base,
        data.quality as Quality,
        new OffscreenCanvas(1, 1),
      );
      self.postMessage({ type: "ready" });
    } else if (data.type === "frame") {
      const bitmap = data.bitmap as ImageBitmap;
      try {
        if (!estimator) throw new Error("Estimator is not ready");
        self.postMessage({
          type: "result",
          frame: serializeResult(
            estimator.detectForVideo(bitmap, data.time * 1000),
            data.time,
          ),
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
