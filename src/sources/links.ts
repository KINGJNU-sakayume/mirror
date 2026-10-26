export type VideoLink = {
  kind: "youtube" | "instagram" | "direct";
  url: string;
  id?: string;
  embed?: string;
  label: string;
};
export function parseVideoLink(value: string): VideoLink {
  let u: URL;
  try {
    u = new URL(value.trim());
  } catch {
    throw new Error(
      "전체 영상 주소를 입력해 주세요. https://로 시작하는 링크를 사용하세요.",
    );
  }
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
    throw new Error("HTTP(S) 영상 링크만 사용할 수 있습니다.");
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (
    [
      "youtube.com",
      "m.youtube.com",
      "youtube-nocookie.com",
      "youtu.be",
    ].includes(host)
  ) {
    const parts = u.pathname.split("/").filter(Boolean);
    const id =
      host === "youtu.be"
        ? parts[0]
        : ["shorts", "embed", "live"].includes(parts[0])
          ? parts[1]
          : u.searchParams.get("v");
    if (!id || !/^[\w-]{11}$/.test(id))
      throw new Error(
        "유튜브 영상 또는 숏츠 주소를 확인해 주세요. 채널·재생목록 주소는 지원하지 않습니다.",
      );
    const timing =
      u.searchParams.get("start") || u.searchParams.get("t") || "0";
    const partsTime = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(timing);
    const start = Math.min(
      86400,
      Math.max(
        0,
        Number(timing) ||
          (partsTime
            ? Number(partsTime[1] || 0) * 3600 +
              Number(partsTime[2] || 0) * 60 +
              Number(partsTime[3] || 0)
            : 0),
      ),
    );
    const canonical =
      parts[0] === "shorts"
        ? `https://www.youtube.com/shorts/${id}`
        : `https://www.youtube.com/watch?v=${id}`;
    return {
      kind: "youtube",
      id,
      url:
        canonical +
        (start > 0
          ? `${canonical.includes("?") ? "&" : "?"}t=${Math.floor(start)}`
          : ""),
      embed: `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0${start > 0 ? `&start=${Math.floor(start)}` : ""}`,
      label: parts[0] === "shorts" ? "YouTube Shorts" : "YouTube",
    };
  }
  if (["instagram.com", "m.instagram.com"].includes(host)) {
    const parts = u.pathname.split("/").filter(Boolean),
      id = parts[1];
    if (
      parts[0] === "share" &&
      parts[1] === "reel" &&
      parts[2] &&
      /^[\w-]{5,64}$/.test(parts[2])
    )
      return {
        kind: "instagram",
        url: `https://www.instagram.com/share/reel/${parts[2]}/`,
        label: "Instagram Reels · 공유 링크",
      };
    if (
      !["reel", "reels", "p", "tv"].includes(parts[0]) ||
      !id ||
      !/^[\w-]{5,64}$/.test(id)
    )
      throw new Error("인스타그램 릴스 또는 게시물 주소를 확인해 주세요.");
    return {
      kind: "instagram",
      id,
      url: `https://www.instagram.com/${parts[0] === "reels" ? "reel" : parts[0]}/${id}/`,
      embed: `https://www.instagram.com/${parts[0] === "reels" ? "reel" : parts[0]}/${id}/embed/`,
      label: "Instagram Reels",
    };
  }
  // Other URLs are fetched as media, never parsed/scraped as arbitrary web pages.
  u.hash = "";
  return { kind: "direct", url: u.href, label: "직접 영상 링크" };
}
export const MAX_REMOTE_BYTES = 200 * 1024 * 1024;
export async function fetchVideoLink(
  link: VideoLink,
  signal: AbortSignal,
  onProgress: (bytes: number, total: number | null) => void,
): Promise<File> {
  if (link.kind !== "direct")
    throw new Error("이 플랫폼 링크는 영상 탭 공유로 분석해 주세요.");
  const response = await fetch(link.url, {
    mode: "cors",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal,
  });
  if (!response.ok)
    throw new Error(
      `영상을 불러오지 못했습니다 (HTTP ${response.status}). 만료되지 않은 직접 영상 주소인지 확인해 주세요.`,
    );
  const mime = response.headers.get("content-type")?.split(";")[0] || "";
  if (
    mime &&
    !mime.startsWith("video/") &&
    !["application/octet-stream", "binary/octet-stream"].includes(mime)
  ) {
    await response.body?.cancel();
    throw new Error(
      "영상 파일이 아닌 웹페이지 주소입니다. 유튜브·릴스 링크는 영상 탭 공유를 사용해 주세요.",
    );
  }
  const total = Number(response.headers.get("content-length")) || null;
  if (total && total > MAX_REMOTE_BYTES) {
    await response.body?.cancel();
    throw new Error("직접 링크 영상은 200MB 이하로 가져와 주세요.");
  }
  const chunks: Uint8Array<ArrayBuffer>[] = [],
    reader = response.body?.getReader();
  let bytes = 0;
  if (!reader) throw new Error("이 브라우저에서 영상 응답을 읽을 수 없습니다.");
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_REMOTE_BYTES)
        throw new Error("영상이 200MB를 넘어 가져오기를 중단했습니다.");
      chunks.push(new Uint8Array(value));
      onProgress(bytes, total);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (!bytes)
    throw new Error("비어 있는 영상입니다. 다른 주소를 사용해 주세요.");
  const path = new URL(link.url).pathname,
    name = decodeURIComponent(
      path.split("/").pop() || "linked-video.mp4",
    ).replace(/[^\p{L}\p{N}._-]/gu, "_");
  const inferred = mime.startsWith("video/")
    ? mime
    : /\.webm$/i.test(path)
      ? "video/webm"
      : "video/mp4";
  return new File(chunks, name, { type: inferred });
}
