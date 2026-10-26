import { add, clamp, length, lerp, median, mul, OneEuro, sub } from "./math";
import type { MotionFrame, RefinementReport, Vec3, VideoSource } from "./types";
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3, fallback: Vec3 = [0, 0, 1]): Vec3 =>
  length(a) > 1e-7 ? mul(a, 1 / length(a)) : fallback;
const percentile = (values: number[], p: number) => {
  const a = [...values].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor((a.length - 1) * p))] ?? 0;
};
export function jointAngle(a: Vec3, b: Vec3, c: Vec3) {
  return Math.acos(clamp(dot(unit(sub(a, b)), unit(sub(c, b))), -1, 1));
}

// Closed-form two-bone IK, preserving segment lengths and the observed bend plane.
export function solveTwoBone(
  root: Vec3,
  bend: Vec3,
  end: Vec3,
  target: Vec3,
  l1: number,
  l2: number,
  minAngle = (15 * Math.PI) / 180,
  poleHint?: Vec3,
) {
  if (l1 < 1e-5 || l2 < 1e-5)
    return { bend: [...bend] as Vec3, end: [...end] as Vec3 };
  const direction = unit(sub(target, root), unit(sub(end, root), [0, -1, 0]));
  const minReach = Math.sqrt(
    Math.max(0, l1 * l1 + l2 * l2 - 2 * l1 * l2 * Math.cos(minAngle)),
  );
  const d = clamp(
    length(sub(target, root)),
    Math.max(1e-5, minReach),
    l1 + l2 - 1e-7,
  );
  const axial = (l1 * l1 - l2 * l2 + d * d) / (2 * d),
    height = Math.sqrt(Math.max(0, l1 * l1 - axial * axial));
  let pole = sub(
    sub(bend, root),
    mul(direction, dot(sub(bend, root), direction)),
  );
  const hint = poleHint ?? [0, 0, 1];
  if (length(pole) < 0.015)
    pole = sub(hint, mul(direction, dot(hint, direction)));
  if (length(pole) < 1e-6) {
    const fallback: Vec3 = Math.abs(direction[0]) < 0.8 ? [1, 0, 0] : [0, 0, 1];
    pole = sub(fallback, mul(direction, dot(fallback, direction)));
  }
  return {
    bend: add(add(root, mul(direction, axial)), mul(unit(pole), height)),
    end: add(root, mul(direction, d)),
  };
}

function contactMask(
  frames: MotionFrame[],
  index: number,
  other: number,
  source: VideoSource,
) {
  const aspect = source.width / source.height;
  const candidates = frames.map((f, i) => {
    const p = f.image?.[index],
      q = f.image?.[other],
      joint = f.joints[index];
    if (
      !p ||
      !q ||
      !joint ||
      joint.interpolated ||
      Math.min(p.visibility, p.presence, q.visibility) < 0.65
    )
      return false;
    const neighbors = frames
      .slice(Math.max(0, i - 2), Math.min(frames.length, i + 3))
      .filter(
        (x) =>
          Math.abs(x.time - f.time) <= 0.16 &&
          x.image?.[index]?.visibility! > 0.65,
      );
    if (neighbors.length < 2) return false;
    const a = neighbors[0],
      b = neighbors.at(-1)!,
      dt = b.time - a.time;
    if (dt <= 0 || dt > 0.32) return false;
    const pa = a.image![index],
      pb = b.image![index];
    const speed = Math.hypot((pb.x - pa.x) * aspect, pb.y - pa.y) / dt;
    const local = frames
      .slice(Math.max(0, i - 6), Math.min(frames.length, i + 7))
      .filter(
        (x) =>
          Math.abs(x.time - f.time) < 0.45 &&
          x.image?.[index]?.visibility! > 0.65,
      );
    const floor = percentile(
      local.map((x) => x.image![index].y),
      0.85,
    );
    // A held, raised foot or a jump apex is not treated as planted just because it is momentarily still.
    return speed < 0.09 && p.y >= q.y - 0.035 && p.y >= floor - 0.025;
  });
  const result = candidates.map(() => false);
  for (let i = 0; i < candidates.length;) {
    if (!candidates[i]) {
      i++;
      continue;
    }
    let j = i;
    while (
      j + 1 < candidates.length &&
      candidates[j + 1] &&
      frames[j + 1].time - frames[j].time <= 0.12
    )
      j++;
    if (frames[j].time - frames[i].time >= 0.12)
      for (let k = i; k <= j; k++) result[k] = true;
    i = j + 1;
  }
  return result;
}

export function refineMotion(
  frames: MotionFrame[],
  source: VideoSource,
  boneLengths: Record<string, number>,
): RefinementReport {
  const report: RefinementReport = {
    version: 1,
    groundY: 0,
    contactFrames: 0,
    ikAdjustments: 0,
    angleConstraints: 0,
    maxFootAdjustment: 0,
    assumption: "fixed-camera",
  };
  const floorSamples = frames.flatMap((f) =>
    [27, 28].flatMap((j) =>
      f.joints[j] && f.joints[j]!.confidence > 0.65
        ? [f.joints[j]!.position[1]]
        : [],
    ),
  );
  if (!floorSamples.length) return report;
  report.groundY = percentile(floorSamples, 0.08);
  const left = contactMask(frames, 27, 28, source),
    right = contactMask(frames, 28, 27, source);
  const rootFilter = new OneEuro(2, 0.5);
  let previousRoot = 0,
    previousTime = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    f.contacts = { left: left[i], right: right[i] };
    const support = [
      left[i] ? f.joints[27] : null,
      right[i] ? f.joints[28] : null,
    ].filter((j) => j !== null);
    const raw = support.length
      ? median(support.map((j) => report.groundY - j!.position[1]))
      : previousRoot * Math.exp(-Math.max(0, f.time - previousTime) / 0.12);
    f.root[1] = rootFilter.filter(clamp(raw, -0.65, 0.35), f.time);
    previousRoot = f.root[1];
    previousTime = f.time;
    if (support.length) report.contactFrames++;
  }
  // Conservative anatomical limits only: permit full extension, limit extreme folding.
  const chains = [
    { a: 11, b: 13, c: 15, min: 12 },
    { a: 12, b: 14, c: 16, min: 12 },
    { a: 23, b: 25, c: 27, min: 15 },
    { a: 24, b: 26, c: 28, min: 15 },
  ];
  for (const f of frames)
    for (const { a, b, c, min } of chains) {
      const ja = f.joints[a],
        jb = f.joints[b],
        jc = f.joints[c];
      if (!ja || !jb || !jc) continue;
      if (
        jointAngle(ja.position, jb.position, jc.position) >=
        (min * Math.PI) / 180
      )
        continue;
      const before = jc.position,
        l1 = boneLengths[`${a}-${b}`] || length(sub(jb.position, ja.position)),
        l2 = boneLengths[`${b}-${c}`] || length(sub(jc.position, jb.position));
      const solved = solveTwoBone(
        ja.position,
        jb.position,
        jc.position,
        jc.position,
        l1,
        l2,
        (min * Math.PI) / 180,
      );
      jb.position = solved.bend;
      jc.position = solved.end;
      const delta = sub(jc.position, before);
      for (const d of c === 15
        ? [17, 19, 21]
        : c === 16
          ? [18, 20, 22]
          : c === 27
            ? [29, 31]
            : [30, 32])
        if (f.joints[d])
          f.joints[d]!.position = add(f.joints[d]!.position, delta);
      report.angleConstraints++;
    }
  for (const side of [
    { mask: left, hip: 23, knee: 25, ankle: 27, foot: [29, 31] },
    { mask: right, hip: 24, knee: 26, ankle: 28, foot: [30, 32] },
  ]) {
    let anchor: Vec3 | null = null,
      start = 0,
      pole: Vec3 | undefined;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i],
        h = f.joints[side.hip],
        k = f.joints[side.knee],
        a = f.joints[side.ankle];
      if (!side.mask[i] || !h || !k || !a) {
        anchor = null;
        pole = undefined;
        continue;
      }
      if (!anchor || f.time - start > 1.5) {
        start = f.time;
        const samples = frames
          .slice(i, i + 3)
          .filter((_, j) => side.mask[i + j]);
        anchor = [
          median(
            samples.map((x) => x.joints[side.ankle]!.position[0] + x.root[0]),
          ),
          report.groundY,
          median(
            samples.map((x) => x.joints[side.ankle]!.position[2] + x.root[2]),
          ),
        ];
      }
      const desired = sub(anchor, f.root),
        delta = sub(desired, a.position);
      // Large changes are evidence against this contact hypothesis. Release instead of dragging the dancer.
      if (length(delta) > 0.16) {
        anchor = null;
        f.contacts![side.ankle === 27 ? "left" : "right"] = false;
        continue;
      }
      const weight = 0.85 * clamp((f.time - start + 0.04) / 0.12, 0, 1),
        target = lerp(a.position, desired, weight);
      const l1 =
          boneLengths[`${side.hip}-${side.knee}`] ||
          length(sub(k.position, h.position)),
        l2 =
          boneLengths[`${side.knee}-${side.ankle}`] ||
          length(sub(a.position, k.position));
      const solved = solveTwoBone(
        h.position,
        k.position,
        a.position,
        target,
        l1,
        l2,
        (15 * Math.PI) / 180,
        pole,
      );
      pole = sub(solved.bend, h.position);
      const shift = sub(solved.end, a.position);
      k.position = solved.bend;
      a.position = solved.end;
      for (const j of side.foot)
        if (f.joints[j])
          f.joints[j]!.position = add(f.joints[j]!.position, shift);
      if (length(shift) > 1e-5) {
        report.ikAdjustments++;
        report.maxFootAdjustment = Math.max(
          report.maxFootAdjustment,
          length(shift),
        );
      }
    }
  }
  report.contactFrames = frames.filter(
    (f) => f.contacts?.left || f.contacts?.right,
  ).length;
  return report;
}
