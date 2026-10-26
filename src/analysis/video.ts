import type { VideoSource } from "../motion/types";
export const abortError = () =>
  new DOMException("분석을 취소했습니다.", "AbortError");
export function waitForVideo(
  video: HTMLVideoElement,
  event: "loadeddata" | "seeked",
  signal?: AbortSignal,
  timeout = 20000,
) {
  return new Promise<void>((resolve, reject) => {
    const clean = () => {
      clearTimeout(timer);
      video.removeEventListener(event, done);
      video.removeEventListener("error", failed);
      signal?.removeEventListener("abort", cancel);
    };
    const done = () => {
      clean();
      resolve();
    };
    const failed = () => {
      clean();
      reject(
        new Error(
          "영상을 읽을 수 없습니다. MP4(H.264) 또는 WebM으로 다시 저장해 주세요.",
        ),
      );
    };
    const cancel = () => {
      clean();
      reject(abortError());
    };
    const timer = setTimeout(() => {
      clean();
      reject(
        new Error(
          "영상 프레임 디코딩 시간이 초과되었습니다. 더 짧은 클립이나 다른 코덱을 사용해 주세요.",
        ),
      );
    }, timeout);
    video.addEventListener(event, done, { once: true });
    video.addEventListener("error", failed, { once: true });
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}
export async function seekFrame(
  video: HTMLVideoElement,
  time: number,
  signal: AbortSignal,
) {
  if (signal.aborted) throw abortError();
  if (Math.abs(video.currentTime - time) < 0.00001 && video.readyState >= 2)
    return;
  const ready = waitForVideo(video, "seeked", signal);
  video.currentTime = time;
  await ready;
}
export async function fingerprint(file: File) {
  const size = 1024 * 1024;
  const content = await new Blob([
    file.slice(0, size),
    file.slice(Math.max(size, file.size - size)),
    `${file.size}`,
  ]).arrayBuffer();
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", content)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function inspectVideo(
  file: File,
  url: string,
): Promise<VideoSource> {
  if (file.type && !file.type.startsWith("video/"))
    throw new Error(
      "지원하는 영상 파일을 선택해 주세요. MP4, WebM을 권장합니다.",
    );
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  try {
    const loaded = waitForVideo(video, "loadeddata");
    video.src = url;
    await loaded;
    if (!Number.isFinite(video.duration) || video.duration <= 0)
      throw new Error(
        "영상 길이를 읽을 수 없습니다. 일반 MP4 또는 WebM 파일로 변환해 주세요.",
      );
    if (video.duration > 600)
      throw new Error(
        "브라우저 메모리를 위해 10분 이하의 연습 클립을 사용해 주세요.",
      );
    return {
      name: file.name,
      size: file.size,
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
      fingerprint: await fingerprint(file),
    };
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
