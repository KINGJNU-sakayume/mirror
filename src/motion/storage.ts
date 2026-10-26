import {
  DEFAULT_PRACTICE,
  type MotionData,
  type Practice,
  type VideoSource,
} from "./types";
const DB = "form-motion-v1";
const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore("motion", { keyPath: "key" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
export const cacheKey = (
  source: VideoSource,
  fps: number,
  quality: string,
  smoothing: boolean,
) => `${source.fingerprint}:${fps}:${quality}:${smoothing}`;
export async function readCache(key: string): Promise<MotionData | null> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("motion", "readonly");
      const r = tx.objectStore("motion").get(key);
      r.onsuccess = () => resolve(r.result?.data ?? null);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
export async function writeCache(key: string, data: MotionData) {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("motion", "readwrite");
      tx.objectStore("motion").put({ key, data });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function clearCache() {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("motion", "readwrite");
      tx.objectStore("motion").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export function savePractice(fingerprint: string, practice: Practice) {
  try {
    localStorage.setItem(
      `form-practice:${fingerprint}`,
      JSON.stringify(practice),
    );
  } catch {
    /* Private browsing may disallow persistence. */
  }
}
export function loadPractice(fingerprint: string, duration: number): Practice {
  try {
    return validatePractice(
      JSON.parse(
        localStorage.getItem(`form-practice:${fingerprint}`) || "null",
      ),
      duration,
    );
  } catch {
    return structuredClone(DEFAULT_PRACTICE);
  }
}
function record(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function num(v: unknown, min = -1e6, max = 1e6): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}
const tuple = (v: unknown) =>
  Array.isArray(v) && v.length === 3 && v.every((x) => num(x, -100, 100));
export function validatePractice(v: unknown, duration: number): Practice {
  if (
    !record(v) ||
    !num(v.bpm, 30, 300) ||
    !num(v.offset, 0, duration) ||
    !Array.isArray(v.segments) ||
    v.segments.length > 200
  )
    throw new Error("카운트 또는 연습 구간 데이터가 올바르지 않습니다.");
  for (const s of v.segments)
    if (
      !record(s) ||
      typeof s.id !== "string" ||
      typeof s.name !== "string" ||
      s.name.length > 100 ||
      !num(s.start, 0, duration) ||
      !num(s.end, 0, duration) ||
      s.end - s.start < 0.05
    )
      throw new Error("연습 구간의 시작과 끝을 확인해 주세요.");
  return v as unknown as Practice;
}
export function parseMotion(text: string): MotionData {
  if (text.length > 180_000_000)
    throw new Error("모션 JSON이 너무 큽니다. 최대 180MB를 지원합니다.");
  const d: unknown = JSON.parse(text);
  const fail = () => {
    throw new Error("FORM v1 모션 형식 또는 좌표계가 올바르지 않습니다.");
  };
  if (
    !record(d) ||
    d.schema !== "form.motion" ||
    d.version !== 1 ||
    !record(d.source) ||
    !record(d.processing) ||
    !record(d.coordinates)
  )
    return fail();
  const s = d.source,
    p = d.processing,
    c = d.coordinates;
  if (
    typeof s.name !== "string" ||
    typeof s.fingerprint !== "string" ||
    !num(s.size, 0, 1e12) ||
    !num(s.width, 1, 32768) ||
    !num(s.height, 1, 32768) ||
    !num(s.duration, 0.001, 600)
  )
    return fail();
  if (
    c.axes !== "x-right_y-up_z-toward-camera" ||
    c.units !== "normalized-meters" ||
    c.root !== "hip-relative" ||
    c.leftRight !== "anatomical"
  )
    return fail();
  if (
    !num(p.fps, 1, 60) ||
    !["lite", "full"].includes(String(p.quality)) ||
    typeof p.smoothing !== "boolean" ||
    !num(p.scale, 0.01, 100) ||
    !num(p.minConfidence, 0, 1) ||
    !num(p.maxGap, 0, 0.2) ||
    !record(p.boneLengths) ||
    Object.values(p.boneLengths).some((v) => !num(v, 0, 5))
  )
    return fail();
  if (
    !["worker", "main-thread"].includes(String(p.engine)) ||
    typeof p.model !== "string" ||
    typeof d.createdAt !== "string"
  )
    return fail();
  if (
    !Array.isArray(d.frames) ||
    d.frames.length < 1 ||
    d.frames.length > 18000
  )
    return fail();
  let last = -1;
  for (const f of d.frames) {
    if (
      !record(f) ||
      !num(f.time, 0, s.duration) ||
      f.time <= last ||
      !tuple(f.root) ||
      !num(f.people, 0, 100) ||
      !Array.isArray(f.joints) ||
      f.joints.length !== 33
    )
      return fail();
    last = f.time;
    for (const j of f.joints)
      if (
        j !== null &&
        (!record(j) ||
          !tuple(j.position) ||
          !num(j.confidence, 0, 1) ||
          typeof j.interpolated !== "boolean")
      )
        return fail();
    for (const field of ["image", "world"]) {
      const arr = f[field];
      if (arr === null) continue;
      if (!Array.isArray(arr) || arr.length !== 33) return fail();
      for (const l of arr)
        if (
          !record(l) ||
          !num(l.x, -100, 100) ||
          !num(l.y, -100, 100) ||
          !num(l.z, -100, 100) ||
          !num(l.visibility, 0, 1) ||
          !num(l.presence, 0, 1)
        )
          return fail();
    }
  }
  d.practice = validatePractice(d.practice, s.duration);
  // Recompute informational counts rather than trusting an imported report.
  const frames = d.frames as unknown as MotionData["frames"];
  d.statistics = {
    total: frames.length,
    detected: frames.filter((f) => f.joints[23] && f.joints[24]).length,
    partial: frames.filter(
      (f) => f.world && f.joints.filter(Boolean).length < 16,
    ).length,
    multiple: frames.filter((f) => f.people > 1).length,
  };
  return d as unknown as MotionData;
}
export function verifySource(data: MotionData, source: VideoSource) {
  if (
    data.source.fingerprint !== source.fingerprint ||
    Math.abs(data.source.duration - source.duration) > 0.1 ||
    data.source.width !== source.width ||
    data.source.height !== source.height
  )
    throw new Error(
      "이 모션은 다른 영상에서 분석되었습니다. 원본 영상을 가져온 다음 다시 시도해 주세요.",
    );
}
export function exportMotion(data: MotionData) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${data.source.name.replace(/\.[^.]+$/, "")}.form-motion.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
