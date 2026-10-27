import {
  DEFAULT_PRACTICE,
  HAND_BASES,
  HAND_COUNT,
  JOINT_COUNT,
  POSE_COUNT,
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
  refinement = false,
  hands = false,
) =>
  `${source.fingerprint}:${fps}:${quality}:${smoothing}:refine1-${refinement}:hands2-${hands}`;
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
const landmarks = (arr: unknown, count: number) =>
  Array.isArray(arr) &&
  arr.length === count &&
  arr.every(
    (l) =>
      record(l) &&
      num(l.x, -100, 100) &&
      num(l.y, -100, 100) &&
      num(l.z, -100, 100) &&
      num(l.visibility, 0, 1) &&
      num(l.presence, 0, 1),
  );
export const MAX_MOTION_BYTES = 300_000_000;
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
  if (text.length > MAX_MOTION_BYTES)
    throw new Error("모션 JSON이 너무 큽니다. 최대 300MB를 지원합니다.");
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
  if (s.origin !== undefined) {
    if (
      !record(s.origin) ||
      !["direct-url", "tab-capture", "local-helper"].includes(
        String(s.origin.kind),
      ) ||
      typeof s.origin.url !== "string" ||
      s.origin.url.length > 4096
    )
      return fail();
    try {
      const u = new URL(s.origin.url);
      if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
        return fail();
    } catch {
      return fail();
    }
    if (
      s.origin.capturedAt !== undefined &&
      typeof s.origin.capturedAt !== "string"
    )
      return fail();
  }
  if (p.refinement !== undefined && typeof p.refinement !== "boolean")
    return fail();
  if (p.hands !== undefined && typeof p.hands !== "boolean") return fail();
  if (p.refinementReport !== undefined) {
    const r = p.refinementReport;
    if (
      !record(r) ||
      p.refinement !== true ||
      r.version !== 1 ||
      r.assumption !== "fixed-camera" ||
      !num(r.groundY, -5, 2) ||
      !num(r.contactFrames, 0, 18000) ||
      !num(r.ikAdjustments, 0, 36000) ||
      !num(r.angleConstraints, 0, 72000) ||
      !num(r.maxFootAdjustment, 0, 1)
    )
      return fail();
  }
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
      (f.joints.length !== POSE_COUNT && f.joints.length !== JOINT_COUNT)
    )
      return fail();
    // Body-only files from before finger analysis gain explicit missing hand joints.
    while (f.joints.length < JOINT_COUNT) f.joints.push(null);
    if (
      f.contacts !== undefined &&
      (!record(f.contacts) ||
        typeof f.contacts.left !== "boolean" ||
        typeof f.contacts.right !== "boolean")
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
    for (const field of ["image", "world"])
      if (f[field] !== null && !landmarks(f[field], POSE_COUNT)) return fail();
    if (f.hands !== undefined) {
      if (!Array.isArray(f.hands) || f.hands.length !== HAND_BASES.length)
        return fail();
      for (const h of f.hands)
        if (
          h !== null &&
          (!record(h) ||
            !num(h.score, 0, 1) ||
            !landmarks(h.image, HAND_COUNT) ||
            !landmarks(h.world, HAND_COUNT))
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
    hands: frames.filter((f) => HAND_BASES.some((b) => f.joints[b])).length,
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
    // 5 decimals (~10µm in normalized meters) roughly halves files with finger data.
    new Blob(
      [
        JSON.stringify(data, (_, v) =>
          typeof v === "number" && !Number.isInteger(v)
            ? Math.round(v * 1e5) / 1e5
            : v,
        ),
      ],
      { type: "application/json" },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${data.source.name.replace(/\.[^.]+$/, "")}.form-motion.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
