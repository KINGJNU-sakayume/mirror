import type { AnalysisOptions, RawFrame, VideoSource } from "../motion/types";
import { preprocess } from "../motion/preprocess";
import { abortError, seekFrame, waitForVideo } from "./video";
import { createEstimator, serializeResult } from "./estimator";
export interface AnalysisProgress {
  completed: number;
  total: number;
  message: string;
  engine: "worker" | "main-thread";
}

class WorkerEstimator {
  private worker: Worker;
  constructor(base: string) {
    this.worker = new Worker(`${base}pose-worker.js`);
  }
  request(
    message: object,
    signal: AbortSignal,
    transfer: Transferable[] = [],
    timeout = 90000,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const clean = () => {
        clearTimeout(timer);
        this.worker.removeEventListener("message", done);
        this.worker.removeEventListener("error", failed);
        signal.removeEventListener("abort", cancel);
      };
      const done = (e: MessageEvent) => {
        clean();
        if (e.data.type === "error") reject(new Error(e.data.message));
        else resolve(e.data);
      };
      const failed = (e: ErrorEvent) => {
        clean();
        reject(new Error(e.message || "Web Worker initialization failed"));
      };
      const cancel = () => {
        clean();
        reject(abortError());
      };
      const timer = setTimeout(() => {
        clean();
        reject(
          new Error("포즈 분석 엔진이 응답하지 않습니다. 다시 시도해 주세요."),
        );
      }, timeout);
      this.worker.addEventListener("message", done);
      this.worker.addEventListener("error", failed);
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) {
        cancel();
        return;
      }
      this.worker.postMessage(message, transfer);
    });
  }
  dispose() {
    this.worker.terminate();
  }
}

export async function analyzeVideo(
  url: string,
  source: VideoSource,
  options: AnalysisOptions,
  signal: AbortSignal,
  onProgress: (p: AnalysisProgress) => void,
) {
  const base = new URL(import.meta.env.BASE_URL, document.baseURI).href;
  const total = Math.ceil(source.duration * options.fps);
  if (total > 18000)
    throw new Error(
      "분석 프레임이 너무 많습니다. 샘플링 빈도를 낮추거나 클립을 줄여 주세요.",
    );
  let worker: WorkerEstimator | null = null;
  let fallback: Awaited<ReturnType<typeof createEstimator>> | null = null;
  let engine: "worker" | "main-thread" = "worker";
  const progress = (completed: number, message: string) =>
    onProgress({ completed, total, message, engine });
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  const cancelWorker = () => worker?.dispose();
  signal.addEventListener("abort", cancelWorker, { once: true });
  try {
    progress(0, "분석 엔진을 불러오는 중");
    try {
      if (
        typeof OffscreenCanvas === "undefined" ||
        typeof createImageBitmap === "undefined"
      )
        throw new Error("OffscreenCanvas unavailable");
      worker = new WorkerEstimator(base);
      await worker.request(
        { type: "init", base, quality: options.quality },
        signal,
      );
    } catch (error) {
      worker?.dispose();
      worker = null;
      if (signal.aborted) throw abortError();
      console.info(
        "Worker unavailable; using cooperative main-thread analysis.",
        error,
      );
      engine = "main-thread";
      progress(0, "호환 모드 · 프레임 사이에 화면을 갱신합니다");
      try {
        fallback = await createEstimator(base, options.quality);
      } catch {
        throw new Error(
          "분석 모델을 불러오지 못했습니다. 연결을 확인한 후 페이지를 새로고침하고 다시 시도해 주세요.",
        );
      }
    }
    if (signal.aborted) throw abortError();
    const ready = waitForVideo(video, "loadeddata", signal);
    video.src = url;
    await ready;
    const canvas = document.createElement("canvas");
    const ratio = Math.min(1, 960 / source.width, 960 / source.height);
    canvas.width = Math.round(source.width * ratio);
    canvas.height = Math.round(source.height * ratio);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx)
      throw new Error("이 브라우저에서 영상 프레임을 읽을 수 없습니다.");
    const raw: RawFrame[] = [];
    for (let i = 0; i < total; i++) {
      if (signal.aborted) throw abortError();
      const time = Math.min(i / options.fps, source.duration - 0.001);
      await seekFrame(video, time, signal);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      if (worker) {
        const bitmap = await createImageBitmap(canvas);
        const result = await worker.request(
          { type: "frame", time, bitmap },
          signal,
          [bitmap],
          30000,
        );
        raw.push(result.frame as RawFrame);
      } else {
        // Explicit cooperative fallback: synchronous inference outside React, one frame per task.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (signal.aborted) throw abortError();
        raw.push(
          serializeResult(fallback!.detectForVideo(canvas, time * 1000), time),
        );
      }
      if (i % 3 === 0 || i === total - 1)
        progress(
          i + 1,
          engine === "worker"
            ? "영상 프레임에서 포즈를 추출하는 중"
            : "호환 모드 · 프레임에서 포즈를 추출하는 중",
        );
    }
    if (signal.aborted) throw abortError();
    progress(total, "짧은 누락 구간과 관절 흔들림을 정리하는 중");
    await new Promise<void>((r) => setTimeout(r, 0));
    const motion = preprocess(raw, source, options, engine);
    if (motion.statistics.detected < Math.max(1, total * 0.03))
      throw new Error(
        "한 명의 전신 동작을 충분히 찾지 못했습니다. 영상 영역과 조명을 확인해 주세요. 탭 영상이 검게 보이면 해당 영상은 화면 공유를 제한할 수 있습니다.",
      );
    return motion;
  } finally {
    signal.removeEventListener("abort", cancelWorker);
    worker?.dispose();
    fallback?.close();
    video.removeAttribute("src");
    video.load();
  }
}
