import { MAX_REMOTE_BYTES } from "./links";

/**
 * 내 PC에서 실행하는 로컬 헬퍼(scripts/link-helper.mjs)와 통신합니다.
 * 헬퍼가 yt-dlp 로 영상을 받아 http://127.0.0.1 로 돌려주면, 이후는 직접 URL 과
 * 같은 경로(검사 → 자동 분석)를 탑니다. 영상은 앱 서버로 전송되지 않습니다.
 */
export const HELPER_URL = "http://127.0.0.1:8765";

export interface HelperStatus {
  ytdlp: string | null;
  ffmpeg: boolean;
}

export async function probeHelper(timeoutMs = 1500): Promise<HelperStatus | null> {
  try {
    const response = await fetch(`${HELPER_URL}/health`, {
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data?.name !== "form-helper") return null;
    return { ytdlp: data.ytdlp ?? null, ffmpeg: Boolean(data.ffmpeg) };
  } catch {
    return null;
  }
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });

async function json(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      typeof data?.error === "string" ? data.error : `헬퍼 오류 (HTTP ${response.status})`,
    );
  return data;
}

export async function fetchViaHelper(
  url: string,
  signal: AbortSignal,
  onProgress: (percent: number, label: string) => void,
): Promise<File> {
  onProgress(0, "헬퍼에 요청하는 중");
  const created = await json(
    await fetch(`${HELPER_URL}/jobs`, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal,
    }),
  );
  const id = String(created.id);
  const cancel = () =>
    void fetch(`${HELPER_URL}/jobs/${id}`, { method: "DELETE", mode: "cors", credentials: "omit" }).catch(
      () => {},
    );
  try {
    while (true) {
      await sleep(600, signal);
      const status = await json(
        await fetch(`${HELPER_URL}/jobs/${id}`, { mode: "cors", credentials: "omit", cache: "no-store", signal }),
      );
      if (status.state === "error") throw new Error(String(status.error || "영상을 받지 못했습니다."));
      if (status.state === "cancelled" || status.state === "expired")
        throw new Error("헬퍼 작업이 종료되었습니다. 다시 시도해 주세요.");
      if (status.state === "done") break;
      onProgress(Number(status.percent) || 0, status.message || "영상을 받는 중");
    }
    onProgress(100, "분석 앱으로 가져오는 중");
    const response = await fetch(`${HELPER_URL}/jobs/${id}/file`, {
      mode: "cors",
      credentials: "omit",
      signal,
    });
    if (!response.ok) await json(response);
    const total = Number(response.headers.get("content-length")) || 0;
    if (total > MAX_REMOTE_BYTES) throw new Error("영상이 200MB를 넘습니다.");
    const blob = await response.blob();
    if (!blob.size) throw new Error("비어 있는 영상입니다.");
    const type = response.headers.get("content-type")?.split(";")[0] || "video/mp4";
    const ext = type === "video/webm" ? "webm" : "mp4";
    const file = new File([blob], `link-${id.slice(0, 8)}.${ext}`, { type });
    cancel(); // 앱에 옮겼으니 헬퍼의 임시 파일을 바로 지웁니다.
    return file;
  } catch (e) {
    cancel();
    throw e;
  }
}
