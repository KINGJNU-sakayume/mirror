import * as THREE from "three";
import { motionInterval } from "../motion/preprocess";
import {
  FINGER_CHAINS,
  HAND_BASES,
  type MotionData,
  type MotionFrame,
} from "../motion/types";
// Original, procedurally authored humanoid. No external character asset or license dependency.
// Rest pose: T-pose facing +Z, anatomical left on +X, palms down, hips at the origin.
const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
const smooth = THREE.MathUtils.smoothstep;
const X = v(1, 0),
  Y = v(0, 1),
  Z = v(0, 0, 1);
type Influence = [bone: number, weight: number][];
interface LoftSpec {
  a: THREE.Vector3;
  b: THREE.Vector3;
  side: THREE.Vector3;
  rings?: number;
  radial?: number;
  // Half extents of the elliptical cross-section along (side, dir × side).
  shape: (t: number) => [number, number];
  shift?: (t: number) => THREE.Vector3;
  // Rounded end depth as a fraction of the end radius; 0 leaves the end open.
  caps?: [number, number];
  skin: (p: THREE.Vector3, axial: number, length: number) => Influence;
  color: (p: THREE.Vector3, t: number) => THREE.Color;
}
const PALETTE = {
  skin: new THREE.Color("#d8b69a"),
  hair: new THREE.Color("#2b2522"),
  eye: new THREE.Color("#1c1b1a"),
  shirt: new THREE.Color("#7d9874"),
  pants: new THREE.Color("#3e4756"),
  shoe: new THREE.Color("#e6e3d8"),
  sole: new THREE.Color("#4a4740"),
  // Matches the left-side accent used by markers and the video overlay.
  left: new THREE.Color("#c5dca1"),
};
class MeshBuilder {
  private positions: number[] = [];
  private colors: number[] = [];
  private skinIndex: number[] = [];
  private skinWeight: number[] = [];
  private index: number[] = [];
  loft(spec: LoftSpec) {
    const rings = spec.rings ?? 10,
      radial = spec.radial ?? 16,
      capRings = 4;
    const axis = spec.b.clone().sub(spec.a),
      length = axis.length(),
      dir = axis.normalize();
    const u = spec.side
      .clone()
      .addScaledVector(dir, -spec.side.dot(dir))
      .normalize();
    const w = dir.clone().cross(u);
    const rows: { t: number; scale: number; axial: number }[] = [];
    const [c0, c1] = spec.caps ?? [0, 0];
    const depth = (t: number, f: number) => Math.min(...spec.shape(t)) * f;
    if (c0 > 0)
      for (let k = capRings; k >= 1; k--) {
        const phi = (k / capRings) * (Math.PI / 2);
        rows.push({ t: 0, scale: Math.cos(phi), axial: -Math.sin(phi) * depth(0, c0) });
      }
    for (let i = 0; i <= rings; i++)
      rows.push({ t: i / rings, scale: 1, axial: (i / rings) * length });
    if (c1 > 0)
      for (let k = 1; k <= capRings; k++) {
        const phi = (k / capRings) * (Math.PI / 2);
        rows.push({
          t: 1,
          scale: Math.cos(phi),
          axial: length + Math.sin(phi) * depth(1, c1),
        });
      }
    const start = this.positions.length / 3;
    const p = new THREE.Vector3();
    for (const row of rows) {
      const [ru, rw] = spec.shape(row.t);
      const center = spec.a.clone().addScaledVector(dir, row.axial);
      if (spec.shift) center.add(spec.shift(row.t));
      for (let j = 0; j < radial; j++) {
        const theta = (j / radial) * Math.PI * 2;
        p.copy(center)
          .addScaledVector(u, ru * row.scale * Math.cos(theta))
          .addScaledVector(w, rw * row.scale * Math.sin(theta));
        this.vertex(p, spec.skin(p, row.axial, length), spec.color(p, row.t));
      }
    }
    for (let i = 0; i + 1 < rows.length; i++)
      for (let j = 0; j < radial; j++) {
        const j1 = (j + 1) % radial;
        const a = start + i * radial + j,
          b = start + i * radial + j1,
          c = start + (i + 1) * radial + j,
          d = start + (i + 1) * radial + j1;
        this.index.push(a, b, c, b, d, c);
      }
  }
  ellipsoid(
    center: THREE.Vector3,
    radii: THREE.Vector3,
    skin: Influence,
    color: (p: THREE.Vector3) => THREE.Color,
  ) {
    this.loft({
      a: center.clone().add(v(0, -radii.y)),
      b: center.clone().add(v(0, radii.y)),
      side: X,
      rings: 14,
      radial: 18,
      shape: (t) => {
        const k = Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
        return [radii.x * k, radii.z * k];
      },
      skin: () => skin,
      color,
    });
  }
  private vertex(p: THREE.Vector3, skin: Influence, color: THREE.Color) {
    const top = skin
      .filter(([, w]) => w > 1e-4)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
    const total = top.reduce((s, [, w]) => s + w, 0) || 1;
    this.positions.push(p.x, p.y, p.z);
    this.colors.push(color.r, color.g, color.b);
    for (let k = 0; k < 4; k++) {
      this.skinIndex.push(top[k]?.[0] ?? 0);
      this.skinWeight.push((top[k]?.[1] ?? 0) / total);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(this.skinIndex, 4));
    g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(this.skinWeight, 4));
    g.setIndex(this.index);
    g.computeVertexNormals();
    return g;
  }
}
// Smoothly blends a segment's skin into its parent at the start joint and its child at the end.
const segmentSkin =
  (self: number, parent: number | null, child: number | null, zone: number) =>
  (_p: THREE.Vector3, axial: number, length: number): Influence => {
    const z = Math.max(1e-4, Math.min(zone, length * 0.45));
    const wp = parent === null ? 0 : 1 - smooth(axial, -z, z);
    const wc = child === null ? 0 : smooth(axial - length, -z, z);
    const out: Influence = [[self, Math.max(0, 1 - wp - wc)]];
    if (parent !== null) out.push([parent, wp]);
    if (child !== null) out.push([child, wc]);
    return out;
  };
// Cosine interpolation over [t, ...values] keys.
const profile =
  (keys: number[][]) =>
  (t: number): number[] => {
    if (t <= keys[0][0]) return keys[0].slice(1);
    for (let i = 1; i < keys.length; i++)
      if (t <= keys[i][0]) {
        const a = keys[i - 1],
          b = keys[i],
          k = (1 - Math.cos((Math.PI * (t - a[0])) / (b[0] - a[0]))) / 2;
        return a.slice(1).map((x, j) => x + (b[j + 1] - x) * k);
      }
    return keys.at(-1)!.slice(1);
  };
// Rotation taking a rest frame (aim, secondary) to an observed frame; null if degenerate.
function orient(
  aimRest: THREE.Vector3,
  aim: THREE.Vector3,
  secondaryRest: THREE.Vector3,
  secondary: THREE.Vector3 | null,
) {
  if (!secondary) return null;
  const basis = (a: THREE.Vector3, s: THREE.Vector3) => {
    const x = a.clone().normalize();
    const y = s.clone().addScaledVector(x, -s.dot(x));
    if (a.lengthSq() < 1e-10 || y.lengthSq() < 1e-8) return null;
    y.normalize();
    return new THREE.Matrix4().makeBasis(x, y, x.clone().cross(y));
  };
  const rest = basis(aimRest, secondaryRest),
    observed = basis(aim, secondary);
  if (!rest || !observed) return null;
  return new THREE.Quaternion().setFromRotationMatrix(
    observed.multiply(rest.transpose()),
  );
}
// Minimal rotation from the parent's carried rest direction: no invented twist.
function swing(parent: THREE.Quaternion, restDir: THREE.Vector3, aim: THREE.Vector3) {
  const current = restDir.clone().applyQuaternion(parent).normalize();
  return new THREE.Quaternion()
    .setFromUnitVectors(current, aim.clone().normalize())
    .multiply(parent);
}
const perpendicular = (s: THREE.Vector3, axis: THREE.Vector3) => {
  const a = axis.clone().normalize();
  return s.clone().addScaledVector(a, -s.dot(a));
};
const DEFAULT_FINGERS = [
  // knuckle offset (left hand), segment lengths, radius
  { knuckle: v(0.024, -0.012, 0.022), lengths: [0.042, 0.032, 0.027], radius: 0.0118 },
  { knuckle: v(0.088, 0.001, 0.026), lengths: [0.042, 0.025, 0.021], radius: 0.0096 },
  { knuckle: v(0.092, 0.002, 0.007), lengths: [0.046, 0.029, 0.023], radius: 0.0099 },
  { knuckle: v(0.086, 0.001, -0.012), lengths: [0.043, 0.027, 0.022], radius: 0.0092 },
  { knuckle: v(0.076, -0.001, -0.03), lengths: [0.034, 0.02, 0.019], radius: 0.0083 },
];
const THUMB_REST = v(0.55, -0.18, 0.82).normalize();
// Relaxed curl (radians) used when no finger observation exists, per finger segment.
const RELAXED = [
  [0.1, 0.12, 0.1],
  [0.22, 0.3, 0.22],
  [0.26, 0.34, 0.24],
  [0.3, 0.36, 0.26],
  [0.34, 0.38, 0.28],
];
interface Side {
  sign: 1 | -1;
  shoulder: number;
  elbow: number;
  wrist: number;
  pinky: number;
  index: number;
  hip: number;
  knee: number;
  ankle: number;
  heel: number;
  toe: number;
  hand: number;
  bones: {
    upper: number;
    fore: number;
    hand: number;
    fingers: number[][];
    thigh: number;
    shin: number;
    foot: number;
  };
  fingerRest: THREE.Vector3[];
  tips: number[];
}
export class Mannequin {
  readonly mesh: THREE.SkinnedMesh;
  readonly bones: THREE.Bone[] = [];
  private parents: number[] = [];
  private names = new Map<string, number>();
  private sides: Side[] = [];
  private footRest = v(0, -0.01, 1).normalize();
  constructor(lengths: Record<string, number> = {}) {
    const size = (key: string, standard: number) =>
      lengths[key] > 0 ? lengths[key] : standard;
    const T = size("torso", 0.48),
      S = size("shoulders", 0.36),
      P = size("pelvis", 0.22);
    const rest: THREE.Vector3[] = [];
    const add = (name: string, parent: number, offset: THREE.Vector3) => {
      const bone = new THREE.Bone();
      bone.name = name;
      bone.position.copy(offset);
      const i = this.bones.push(bone) - 1;
      this.parents.push(parent);
      this.names.set(name, i);
      rest.push(parent < 0 ? offset.clone() : rest[parent].clone().add(offset));
      if (parent >= 0) this.bones[parent].add(bone);
      return i;
    };
    const hips = add("Hips", -1, v(0, 0)),
      spine = add("Spine", hips, v(0, T * 0.3)),
      chest = add("Chest", spine, v(0, T * 0.35)),
      neck = add("Neck", chest, v(0, T * 0.35 + 0.02)),
      head = add("Head", neck, v(0, 0.1));
    for (const sign of [1, -1] as const) {
      const L = sign === 1 ? "Left" : "Right",
        base = HAND_BASES[sign === 1 ? 0 : 1];
      const [s, e, w, hp, k, a] =
        sign === 1 ? [11, 13, 15, 23, 25, 27] : [12, 14, 16, 24, 26, 28];
      const upperLen = size(`${s}-${e}`, 0.29),
        foreLen = size(`${e}-${w}`, 0.26);
      const upper = add(`${L}UpperArm`, chest, v((sign * S) / 2, T * 0.35)),
        fore = add(`${L}Forearm`, upper, v(sign * upperLen, 0)),
        hand = add(`${L}Hand`, fore, v(sign * foreLen, 0));
      const palm = THREE.MathUtils.clamp(size(`${base}-${base + 9}`, 0.092) / 0.092, 0.6, 1.6);
      const fingerRest: THREE.Vector3[] = [];
      const fingers = DEFAULT_FINGERS.map((finger, f) => {
        const dir = f === 0 ? THUMB_REST.clone() : X.clone();
        dir.x *= sign;
        fingerRest.push(dir);
        const knuckle = finger.knuckle.clone().multiplyScalar(palm);
        knuckle.x *= sign;
        const chain = FINGER_CHAINS[f];
        const seg = finger.lengths.map((l, j) =>
          size(`${base + chain[j + 1]}-${base + chain[j + 2]}`, l * palm),
        );
        const names = ["Thumb", "Index", "Middle", "Ring", "Little"];
        const b0 = add(`${L}${names[f]}1`, hand, knuckle),
          b1 = add(`${L}${names[f]}2`, b0, dir.clone().multiplyScalar(seg[0])),
          b2 = add(`${L}${names[f]}3`, b1, dir.clone().multiplyScalar(seg[1]));
        return [b0, b1, b2, seg[2]];
      });
      const thigh = add(`${L}Thigh`, hips, v((sign * P) / 2, 0)),
        shin = add(`${L}Shin`, thigh, v(0, -size(`${hp}-${k}`, 0.44))),
        foot = add(`${L}Foot`, shin, v(0, -size(`${k}-${a}`, 0.42)));
      this.sides.push({
        sign,
        shoulder: s,
        elbow: e,
        wrist: w,
        pinky: sign === 1 ? 17 : 18,
        index: sign === 1 ? 19 : 20,
        hip: hp,
        knee: k,
        ankle: a,
        heel: sign === 1 ? 29 : 30,
        toe: sign === 1 ? 31 : 32,
        hand: base,
        bones: {
          upper,
          fore,
          hand,
          fingers: fingers.map((f) => f.slice(0, 3)),
          thigh,
          shin,
          foot,
        },
        fingerRest,
        tips: fingers.map((f) => f[3]),
      });
    }
    const m = new MeshBuilder();
    const skinColor = () => PALETTE.skin;
    // Torso: one lofted body from crotch to shoulder line, blended across hips/spine/chest.
    const y0 = -0.075,
      y1 = T + 0.035;
    // Narrow seat: the thighs carry the hip volume so the crotch does not hang in squats.
    const torso = profile([
      [-0.16, P / 2 - 0.005, 0.078, -0.008],
      [-0.08, P / 2 + 0.055, 0.098, -0.012],
      [0, P / 2 + 0.08, 0.105, -0.012],
      [0.18, P / 2 + 0.06, 0.095, -0.006],
      [0.38, Math.max(P / 2 + 0.025, S * 0.33), 0.088, 0],
      [0.62, S / 2 - 0.022, 0.104, 0.012],
      [0.86, S / 2 - 0.004, 0.098, 0.002],
      [1.0, S / 2 - 0.03, 0.075, -0.01],
      [y1 / T, 0.07, 0.058, -0.012],
    ]);
    const atH = (t: number) => torso((y0 + (y1 - y0) * t) / T);
    const leftOf = (x: number, l: number, r: number) => (x >= 0 ? l : r);
    const [ls, rs] = this.sides;
    m.loft({
      a: v(0, y0),
      b: v(0, y1),
      side: X,
      rings: 26,
      radial: 28,
      caps: [0.7, 0.35],
      shape: (t) => {
        const [hx, hz] = atH(t);
        return [hx, hz];
      },
      shift: (t) => v(0, 0, atH(t)[2]),
      skin: (p) => {
        const sp = smooth(p.y, T * 0.3 - 0.08, T * 0.3 + 0.08),
          ch = smooth(p.y, T * 0.65 - 0.08, T * 0.65 + 0.08);
        let out: Influence = [
          [hips, 1 - sp],
          [spine, sp - ch],
          [chest, ch],
        ];
        const ax = Math.abs(p.x);
        const leg =
          (1 - smooth(p.y, -0.1, 0.06)) * 0.75 * smooth(ax, 0, P / 2);
        const arm =
          smooth(p.y, T * 0.8, T) * smooth(ax, S / 2 - 0.08, S / 2) * 0.45;
        const extra = leg > 0 ? leg : arm;
        const target =
          leg > 0
            ? leftOf(p.x, ls.bones.thigh, rs.bones.thigh)
            : leftOf(p.x, ls.bones.upper, rs.bones.upper);
        if (extra > 0) {
          out = out.map(([b, w]) => [b, w * (1 - extra)]);
          out.push([target, extra]);
        }
        return out;
      },
      color: (p) => (p.y > T * 0.36 ? PALETTE.shirt : PALETTE.pants),
    });
    // Neck and head. Nose, eyes, ears and hair make the facing direction legible.
    const neckBase = rest[neck],
      headBase = rest[head];
    m.loft({
      a: neckBase.clone().add(v(0, -0.04)),
      b: headBase.clone().add(v(0, 0.035)),
      side: X,
      rings: 6,
      radial: 16,
      shape: () => [0.048, 0.046],
      shift: () => v(0, 0, -0.004),
      skin: (p) => {
        const w = smooth(p.y, neckBase.y - 0.03, neckBase.y + 0.03),
          h = smooth(p.y, headBase.y - 0.02, headBase.y + 0.03);
        return [
          [chest, 1 - w],
          [neck, w - h],
          [head, h],
        ];
      },
      color: skinColor,
    });
    const skull = headBase.clone().add(v(0, 0.088, 0.004));
    m.ellipsoid(skull, v(0.079, 0.1, 0.095), [[head, 1]], (p) => {
      const r = p.clone().sub(skull);
      const face = r.z > 0.045 && r.y < 0.05;
      const hair = (r.y > 0.032 && !face) || (r.z < -0.025 && r.y > -0.045);
      return hair ? PALETTE.hair : PALETTE.skin;
    });
    m.ellipsoid(headBase.clone().add(v(0, 0.036, 0.03)), v(0.058, 0.052, 0.06), [[head, 1]], skinColor);
    m.ellipsoid(headBase.clone().add(v(0, 0.07, 0.097)), v(0.013, 0.022, 0.019), [[head, 1]], skinColor);
    for (const s of [1, -1]) {
      m.ellipsoid(headBase.clone().add(v(0.078 * s, 0.082, 0)), v(0.012, 0.024, 0.017), [[head, 1]], skinColor);
      m.ellipsoid(headBase.clone().add(v(0.03 * s, 0.094, 0.084)), v(0.011, 0.008, 0.007), [[head, 1]], () => PALETTE.eye);
    }
    for (const side of this.sides) {
      const { sign, bones, tips } = side,
        accent = sign === 1;
      const limb = (
        bone: number,
        parent: number,
        child: number | null,
        end: THREE.Vector3,
        side3: THREE.Vector3,
        radius: (t: number) => [number, number],
        color: (p: THREE.Vector3, t: number) => THREE.Color,
        zone: number,
        shift?: (t: number) => THREE.Vector3,
        caps: [number, number] = [0.9, 0.9],
      ) =>
        m.loft({
          a: rest[bone],
          b: end,
          side: side3,
          rings: 12,
          radial: 18,
          caps,
          shape: radius,
          shift,
          skin: segmentSkin(bone, parent, child, zone),
          color,
        });
      const upperR = profile([[0, 0.05], [0.3, 0.047], [0.65, 0.041], [1, 0.036]]);
      limb(bones.upper, chest, bones.fore, rest[bones.fore], Y,
        (t) => [upperR(t)[0] * 0.95, upperR(t)[0]],
        (_p, t) => (t < 0.42 ? PALETTE.shirt : PALETTE.skin), 0.04);
      const foreR = profile([[0, 0.037], [0.25, 0.04], [1, 0.027]]);
      limb(bones.fore, bones.upper, bones.hand, rest[bones.hand], Y,
        (t) => [foreR(t)[0] * 0.78, foreR(t)[0]],
        (_p, t) => (accent && t > 0.8 && t < 0.93 ? PALETTE.left : PALETTE.skin), 0.035);
      // Palm: flat loft from wrist to the knuckle line; fingers are separate segments.
      const knuckles = bones.fingers.slice(1).map((f) => rest[f[0]]);
      const reach = Math.max(...knuckles.map((k) => Math.abs(k.x - rest[bones.hand].x)));
      const palmR = profile([[0, 0.017, 0.028], [0.45, 0.02, 0.041], [1, 0.015, 0.043]]);
      m.loft({
        a: rest[bones.hand].clone().add(v(-0.008 * sign, 0)),
        b: rest[bones.hand].clone().add(v((reach + 0.004) * sign, 0)),
        side: Y,
        rings: 8,
        radial: 16,
        caps: [0.6, 0.7],
        shape: (t) => palmR(t) as [number, number],
        skin: segmentSkin(bones.hand, bones.fore, null, 0.02),
        color: skinColor,
      });
      bones.fingers.forEach((chain, f) => {
        const r0 = DEFAULT_FINGERS[f].radius;
        chain.forEach((bone, j) => {
          const end =
            j < 2
              ? rest[chain[j + 1]]
              : rest[bone].clone().addScaledVector(side.fingerRest[f], tips[f]);
          const r = r0 * (1 - j * 0.12);
          m.loft({
            a: rest[bone],
            b: end,
            side: Y,
            rings: 3,
            radial: 10,
            caps: [0.9, 1],
            shape: (t) => [r * (1 - t * 0.1) * 0.9, r * (1 - t * 0.1)],
            skin: segmentSkin(bone, j === 0 ? bones.hand : chain[j - 1], j < 2 ? chain[j + 1] : null, r),
            color: skinColor,
          });
        });
      });
      const thighR = profile([[0, 0.078], [0.22, 0.079], [0.7, 0.06], [1, 0.05]]);
      limb(bones.thigh, hips, bones.shin, rest[bones.shin], X,
        (t) => [thighR(t)[0], thighR(t)[0] * 1.05], () => PALETTE.pants, 0.06,
        undefined, [0.35, 0.9]);
      const shinR = profile([[0, 0.051], [0.28, 0.055], [0.75, 0.04], [1, 0.033]]);
      limb(bones.shin, bones.thigh, bones.foot, rest[bones.foot], X,
        (t) => [shinR(t)[0], shinR(t)[0] * 1.05], () => PALETTE.pants, 0.05,
        (t) => v(0, 0, -0.01 * Math.sin(Math.PI * Math.min(1, t * 1.6))));
      // Shoe with a flat sole below the ankle; left shoe carries the left-side accent.
      const ankle = rest[bones.foot],
        sole = ankle.y - 0.075;
      const shoe = profile([[0, 0.04, 0.05], [0.3, 0.043, 0.048], [0.7, 0.05, 0.034], [1, 0.036, 0.021]]);
      m.loft({
        a: ankle.clone().add(v(0, -0.03, -0.065)),
        b: ankle.clone().add(v(0, -0.045, 0.18)),
        side: X,
        rings: 12,
        radial: 18,
        caps: [0.7, 0.6],
        shape: (t) => shoe(t).slice(0, 2) as [number, number],
        shift: (t) => {
          const axisY = ankle.y - 0.03 - 0.015 * t;
          return v(0, sole + shoe(t)[1] - axisY);
        },
        skin: (p) => {
          const w = smooth(p.y, ankle.y - 0.045, ankle.y + 0.01) * 0.5;
          return [
            [bones.foot, 1 - w],
            [bones.shin, w],
          ];
        },
        color: (p) =>
          p.y < sole + 0.013 ? PALETTE.sole : accent ? PALETTE.left : PALETTE.shoe,
      });
    }
    this.mesh = new THREE.SkinnedMesh(
      m.build(),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.72,
        metalness: 0.02,
      }),
    );
    this.mesh.add(this.bones[0]);
    this.bones[0].updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.name = "FORM original procedural humanoid";
  }
  bone(name: string) {
    const i = this.names.get(name);
    return i === undefined ? undefined : this.bones[i];
  }
  setGhost(ghost: boolean) {
    const material = this.mesh.material as THREE.MeshStandardMaterial;
    if (material.transparent === ghost) return;
    material.transparent = ghost;
    material.opacity = ghost ? 0.38 : 1;
    material.depthWrite = !ghost;
    material.needsUpdate = true;
    this.mesh.castShadow = !ghost;
  }
  update(frame: MotionFrame) {
    // Every evaluation starts from rest so missing / degenerate data cannot retain an old pose.
    this.bones.forEach((bone) => {
      bone.quaternion.identity();
      bone.scale.setScalar(1);
    });
    const j = frame.joints;
    const p = (index: number) =>
      j[index] ? new THREE.Vector3(...j[index]!.position) : null;
    const ls = p(11),
      rs = p(12),
      lh = p(23),
      rh = p(24);
    if (!ls || !rs || !lh || !rh) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    const world: THREE.Quaternion[] = this.bones.map(() => new THREE.Quaternion());
    const set = (i: number, q: THREE.Quaternion) => {
      world[i] = q.clone().normalize();
      const parent = this.parents[i];
      this.bones[i].quaternion
        .copy(parent < 0 ? world[i] : world[parent].clone().invert().multiply(world[i]))
        .normalize();
    };
    const inherit = (i: number) => set(i, world[this.parents[i]]);
    const hide = (i: number) => {
      inherit(i);
      this.bones[i].scale.setScalar(0);
    };
    const name = (n: string) => this.names.get(n)!;
    // Calibrate anatomical right/left against the T-pose shoulder and pelvis axes.
    const up = ls.clone().add(rs).sub(lh).sub(rh);
    const pelvis = orient(X, lh.clone().sub(rh), Y, up) ?? new THREE.Quaternion();
    const thorax = orient(X, ls.clone().sub(rs), Y, up) ?? pelvis;
    set(name("Hips"), pelvis);
    // Splitting pelvis-to-shoulder rotation across the spine reproduces waist twists and side bends.
    set(name("Spine"), pelvis.clone().slerp(thorax, 0.5));
    set(name("Chest"), thorax);
    const le = p(7) ?? p(2),
      re = p(8) ?? p(5),
      nose = p(0);
    let skull = thorax.clone();
    if (le && re && nose) {
      const mid = le.clone().add(re).multiplyScalar(0.5);
      const q = orient(X, le.clone().sub(re), v(0, -0.25, 1), nose.clone().sub(mid));
      if (q) {
        // Limit implausible head turns from mislabeled ears to ~80 degrees from the chest.
        const relative = thorax.clone().invert().multiply(q);
        const angle = 2 * Math.acos(Math.min(1, Math.abs(relative.w)));
        if (angle > 1.4) relative.slerp(new THREE.Quaternion(), 1 - 1.4 / angle);
        skull = thorax.clone().multiply(relative);
      }
    }
    set(name("Neck"), thorax.clone().slerp(skull, 0.4));
    set(name("Head"), skull);
    for (const side of this.sides) this.retargetSide(side, p, world, set, inherit, hide);
    this.mesh.updateMatrixWorld(true);
  }
  private retargetSide(
    side: Side,
    p: (i: number) => THREE.Vector3 | null,
    world: THREE.Quaternion[],
    set: (i: number, q: THREE.Quaternion) => void,
    inherit: (i: number) => void,
    hide: (i: number) => void,
  ) {
    const { sign, bones } = side,
      aimRest = v(sign, 0);
    const shoulder = p(side.shoulder),
      elbow = p(side.elbow),
      wrist = p(side.wrist);
    // Back-of-hand direction: rest +Y. Hand-model knuckles first, pose hand points as a fallback.
    const hb = side.hand;
    const handWrist = p(hb),
      indexMcp = p(hb + 5),
      middleMcp = p(hb + 9),
      pinkyMcp = p(hb + 17);
    const fingersSeen = Boolean(handWrist && indexMcp && pinkyMcp && middleMcp);
    let dorsal: THREE.Vector3 | null = null,
      handAim: THREE.Vector3 | null = null;
    if (fingersSeen) {
      const a = indexMcp!.clone().sub(handWrist!),
        b = pinkyMcp!.clone().sub(handWrist!);
      dorsal = sign === 1 ? a.cross(b) : b.cross(a);
      handAim = middleMcp!.clone().sub(handWrist!);
    } else if (wrist) {
      const index = p(side.index),
        pinky = p(side.pinky);
      if (index && pinky) {
        const a = index.clone().sub(wrist),
          b = pinky.clone().sub(wrist);
        dorsal = sign === 1 ? a.clone().cross(b) : b.clone().cross(a);
        handAim = a.add(b).multiplyScalar(0.5);
      }
    }
    if (dorsal && dorsal.lengthSq() < 1e-10) dorsal = null;
    if (!shoulder || !elbow) {
      hide(bones.upper);
    } else {
      const aim = elbow.clone().sub(shoulder);
      let secondary: THREE.Vector3 | null = null;
      // Elbow bend plane fixes upper-arm twist; when straight, fall back to the palm orientation.
      if (wrist) {
        const fore = wrist.clone().sub(elbow);
        const bend = perpendicular(fore, aim);
        const weight = smooth(bend.length() / Math.max(1e-5, fore.length()), 0.1, 0.35);
        secondary = bend.normalize().multiplyScalar(weight);
        if (dorsal) {
          const fromPalm = sign === 1 ? aim.clone().cross(dorsal) : dorsal.clone().cross(aim);
          secondary.addScaledVector(perpendicular(fromPalm, aim).normalize(), 1 - weight);
        }
        if (secondary.lengthSq() < 1e-6) secondary = null;
      }
      set(bones.upper, orient(aimRest, aim, Z, secondary) ?? swing(world[this.parents[bones.upper]], aimRest, aim));
    }
    if (!elbow || !wrist || this.bones[bones.upper].scale.x === 0) {
      hide(bones.fore);
    } else {
      const aim = wrist.clone().sub(elbow);
      set(bones.fore, orient(aimRest, aim, Y, dorsal) ?? swing(world[bones.upper], aimRest, aim));
    }
    if (this.bones[bones.fore].scale.x === 0) hide(bones.hand);
    else if (handAim)
      set(bones.hand, orient(aimRest, handAim, Y, dorsal) ?? swing(world[bones.fore], aimRest, handAim));
    else inherit(bones.hand);
    bones.fingers.forEach((chain, f) => {
      const landmarks = FINGER_CHAINS[f];
      chain.forEach((bone, k) => {
        const from = fingersSeen ? p(hb + landmarks[k + 1]) : null,
          to = fingersSeen ? p(hb + landmarks[k + 2]) : null;
        const parent = world[this.parents[bone]];
        if (from && to && to.distanceToSquared(from) > 1e-10)
          set(bone, swing(parent, side.fingerRest[f], to.sub(from)));
        else {
          // No finger evidence: a neutral relaxed hand instead of rigid sticks or a hidden hand.
          const curl = new THREE.Quaternion().setFromAxisAngle(Z, -sign * RELAXED[f][k]);
          set(bone, parent.clone().multiply(curl));
        }
      });
    });
    const hip = p(side.hip),
      knee = p(side.knee),
      ankle = p(side.ankle),
      heel = p(side.heel),
      toe = p(side.toe);
    const footForward = heel && toe ? toe.clone().sub(heel) : null;
    const legRest = v(0, -1);
    if (!hip || !knee) hide(bones.thigh);
    else {
      const aim = knee.clone().sub(hip);
      let secondary: THREE.Vector3 | null = null;
      if (ankle) {
        const shin = ankle.clone().sub(knee);
        const bend = perpendicular(shin, aim);
        const weight = smooth(bend.length() / Math.max(1e-5, shin.length()), 0.1, 0.35);
        // The knee folds backward, so the forward axis is opposite the shin offset.
        secondary = bend.normalize().multiplyScalar(-weight);
        if (footForward)
          secondary.addScaledVector(perpendicular(footForward, aim).normalize(), 1 - weight);
        if (secondary.lengthSq() < 1e-6) secondary = null;
      }
      set(bones.thigh, orient(legRest, aim, Z, secondary) ?? swing(world[this.parents[bones.thigh]], legRest, aim));
    }
    if (!knee || !ankle || this.bones[bones.thigh].scale.x === 0) hide(bones.shin);
    else {
      const aim = ankle.clone().sub(knee);
      set(bones.shin, orient(legRest, aim, Z, footForward) ?? swing(world[bones.thigh], legRest, aim));
    }
    if (this.bones[bones.shin].scale.x === 0) hide(bones.foot);
    else if (footForward && ankle) {
      const lift = ankle.clone().sub(heel!.clone().add(toe!).multiplyScalar(0.5));
      set(bones.foot, orient(this.footRest, footForward, Y, lift) ?? swing(world[bones.shin], this.footRest, footForward));
    } else inherit(bones.foot);
  }
  updateAtTime(data: MotionData, time: number) {
    const interval = motionInterval(data, time);
    if (!interval) {
      this.mesh.visible = false;
      return;
    }
    const { a, b, t } = interval;
    this.update(a);
    if (a === b || !this.mesh.visible) return;
    const rotations = this.bones.map((bone) => bone.quaternion.clone());
    const scales = this.bones.map((bone) => bone.scale.x);
    this.update(b);
    if (!this.mesh.visible) return;
    this.bones.forEach((bone, i) => {
      bone.quaternion.slerpQuaternions(rotations[i], bone.quaternion.clone(), t);
      // A missing endpoint remains missing rather than stretching a limb through it.
      bone.scale.setScalar(scales[i] === 0 || bone.scale.x === 0 ? 0 : 1);
    });
    this.mesh.updateMatrixWorld(true);
  }
  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.skeleton.dispose();
  }
}
