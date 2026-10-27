import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { Mannequin } from "./mannequin";
import {
  JOINT_COUNT,
  LEFT_HAND,
  type MotionData,
  type MotionFrame,
  type Vec3,
} from "../motion/types";
const frame = (): MotionFrame => ({
  time: 0,
  image: null,
  world: null,
  people: 1,
  root: [0, 0, 0],
  joints: Array.from({ length: 33 }, (_, i) => ({
    position: ([11, 13, 15, 19].includes(i)
      ? [0.3, 0.6, 0]
      : [12, 14, 16, 20].includes(i)
        ? [-0.3, 0.5, 0]
        : i === 23
          ? [0.1, 0, 0]
          : i === 24
            ? [-0.1, 0, 0]
            : [i % 2 ? 0.1 : -0.1, -0.5, 0]) as [number, number, number],
    confidence: 1,
    interpolated: false,
  })),
});
// Canonical T-pose matching the rig's rest proportions: palms down, facing +Z.
function tpose(): MotionFrame {
  const points: Record<number, Vec3> = {
    0: [0, 0.66, 0.1],
    2: [0.03, 0.69, 0.085],
    5: [-0.03, 0.69, 0.085],
    7: [0.078, 0.68, 0],
    8: [-0.078, 0.68, 0],
    9: [0.02, 0.63, 0.09],
    10: [-0.02, 0.63, 0.09],
  };
  for (const s of [1, -1]) {
    const l = s === 1;
    points[l ? 11 : 12] = [0.18 * s, 0.48, 0];
    points[l ? 13 : 14] = [0.47 * s, 0.48, 0];
    points[l ? 15 : 16] = [0.73 * s, 0.48, 0];
    points[l ? 17 : 18] = [0.8 * s, 0.48, -0.03];
    points[l ? 19 : 20] = [0.82 * s, 0.48, 0.02];
    points[l ? 21 : 22] = [0.76 * s, 0.47, 0.04];
    points[l ? 23 : 24] = [0.11 * s, 0, 0];
    points[l ? 25 : 26] = [0.11 * s, -0.44, 0];
    points[l ? 27 : 28] = [0.11 * s, -0.86, 0];
    points[l ? 29 : 30] = [0.11 * s, -0.92, -0.06];
    points[l ? 31 : 32] = [0.11 * s, -0.93, 0.17];
  }
  return {
    time: 0,
    image: null,
    world: null,
    people: 1,
    root: [0, 0, 0],
    joints: Array.from({ length: JOINT_COUNT }, (_, i) =>
      points[i]
        ? { position: points[i], confidence: 1, interpolated: false }
        : null,
    ),
  };
}
// Straight left-hand fingers along +X from the wrist at the T-pose wrist.
function withLeftHand(f: MotionFrame, curlIndex = false) {
  const wrist: Vec3 = [0.73, 0.48, 0];
  const knuckles: Vec3[] = [
    [0.024, -0.012, 0.022],
    [0.088, 0, 0.026],
    [0.092, 0, 0.007],
    [0.086, 0, -0.012],
    [0.076, 0, -0.03],
  ];
  const set = (i: number, p: Vec3) =>
    (f.joints[LEFT_HAND + i] = {
      position: [wrist[0] + p[0], wrist[1] + p[1], wrist[2] + p[2]],
      confidence: 0.9,
      interpolated: false,
    });
  set(0, [0, 0, 0]);
  knuckles.forEach((k, finger) => {
    const dir: Vec3 =
      finger === 0 ? [0.55, -0.18, 0.82] : [1, 0, 0];
    for (let s = 0; s < 4; s++) {
      let p: Vec3 = [
        k[0] + dir[0] * 0.03 * s,
        k[1] + dir[1] * 0.03 * s,
        k[2] + dir[2] * 0.03 * s,
      ];
      // Index PIP onward bends straight down toward the palm.
      if (curlIndex && finger === 1 && s >= 2)
        p = [k[0] + 0.03, k[1] - 0.03 * (s - 1), k[2]];
      set(1 + finger * 4 + s, p);
    }
  });
  return f;
}
const worldDir = (rig: Mannequin, name: string, local: THREE.Vector3) =>
  local
    .clone()
    .applyQuaternion(rig.bone(name)!.getWorldQuaternion(new THREE.Quaternion()));
describe("original procedural humanoid", () => {
  it("contains a real bound skeleton with normalized vertex skin weights", () => {
    const rig = new Mannequin();
    expect(rig.mesh.isSkinnedMesh).toBe(true);
    expect(rig.mesh.skeleton.bones).toHaveLength(47);
    const weights = rig.mesh.geometry.attributes.skinWeight;
    expect(weights.count).toBeGreaterThan(3000);
    for (let i = 0; i < weights.count; i += 7) {
      const sum =
        weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i);
      expect(sum).toBeCloseTo(1, 4);
    }
    expect(rig.mesh.geometry.attributes.color).toBeDefined();
    rig.dispose();
  });
  it("has a head, hands with five fingers and feet", () => {
    const rig = new Mannequin();
    for (const name of [
      "Head",
      "Neck",
      "LeftHand",
      "RightHand",
      "LeftThumb3",
      "LeftLittle3",
      "RightIndex1",
      "LeftFoot",
      "RightFoot",
    ])
      expect(rig.bone(name), name).toBeDefined();
    rig.dispose();
  });
  it("maps anatomical left and right to separate bones", () => {
    const rig = new Mannequin();
    expect(rig.bones[5].name).toBe("LeftUpperArm");
    expect(rig.bone("LeftUpperArm")!.position.x).toBeGreaterThan(0);
    expect(rig.bone("RightUpperArm")!.position.x).toBeLessThan(0);
    rig.dispose();
  });
  it("reproduces the rest pose from a matching T-pose observation", () => {
    const rig = new Mannequin();
    rig.update(withLeftHand(tpose()));
    // The right hand has no finger observation and keeps its relaxed curl.
    const relaxed = /^Right(Thumb|Index|Middle|Ring|Little)/;
    for (const bone of rig.bones.filter((b) => !relaxed.test(b.name)))
      expect(
        bone.quaternion.angleTo(new THREE.Quaternion()),
        bone.name,
      ).toBeLessThan(0.25);
    rig.dispose();
  });
  it("twists the waist when shoulders turn against the hips", () => {
    const rig = new Mannequin();
    const f = tpose(),
      turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.6);
    for (const i of [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) {
      const p = new THREE.Vector3(...f.joints[i]!.position).applyQuaternion(turn);
      f.joints[i]!.position = p.toArray() as Vec3;
    }
    rig.update(f);
    expect(rig.bone("Spine")!.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.2);
    expect(rig.bone("Chest")!.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.2);
    const chestX = worldDir(rig, "Chest", new THREE.Vector3(1, 0, 0));
    expect(chestX.z).toBeCloseTo(-Math.sin(0.6), 2);
    rig.dispose();
  });
  it("turns the head toward the observed nose direction", () => {
    const rig = new Mannequin();
    const f = tpose();
    f.joints[0]!.position = [0.1, 0.66, 0.02];
    f.joints[7]!.position = [0.02, 0.68, -0.078];
    f.joints[8]!.position = [-0.02, 0.68, 0.078];
    rig.update(f);
    const forward = worldDir(rig, "Head", new THREE.Vector3(0, 0, 1));
    expect(forward.x).toBeGreaterThan(0.6);
    rig.dispose();
  });
  it("rolls the forearm with the observed palm orientation", () => {
    const rig = new Mannequin();
    const f = tpose();
    // Back of the hand faces the camera: knuckles above / below the wrist instead of front / back.
    f.joints[19]!.position = [0.82, 0.46, 0];
    f.joints[17]!.position = [0.8, 0.51, 0];
    rig.update(f);
    const dorsal = worldDir(rig, "LeftForearm", new THREE.Vector3(0, 1, 0));
    expect(Math.abs(dorsal.z)).toBeGreaterThan(0.9);
    rig.dispose();
  });
  it("bends fingers from hand landmarks and relaxes them without evidence", () => {
    const rig = new Mannequin();
    rig.update(withLeftHand(tpose(), true));
    const middle = worldDir(rig, "LeftIndex2", new THREE.Vector3(1, 0, 0));
    expect(middle.y).toBeLessThan(-0.9);
    rig.update(tpose());
    const relaxed = rig.bone("LeftIndex2")!;
    expect(relaxed.scale.x).toBe(1);
    expect(relaxed.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.1);
    rig.dispose();
  });
  it("produces finite rotations for asymmetric motion and backward seeks", () => {
    const rig = new Mannequin();
    const f = frame();
    f.joints[13]!.position = [0.3, 0.8, 0];
    f.joints[15]!.position = [0.3, 1, 0];
    rig.update(f);
    const q = rig.bones[5].quaternion.clone();
    rig.update(frame());
    rig.update(f);
    expect(rig.bones[5].quaternion.angleTo(q)).toBeLessThan(1e-6);
    for (const b of rig.bones)
      expect(b.quaternion.toArray().every(Number.isFinite)).toBe(true);
    rig.dispose();
  });
  it("points the left upper arm toward its observed elbow", () => {
    const rig = new Mannequin();
    const f = frame();
    f.joints[13]!.position = [0.3, 0.9, 0];
    rig.update(f);
    expect(worldDir(rig, "LeftUpperArm", new THREE.Vector3(1, 0, 0)).y).toBeCloseTo(1);
    rig.dispose();
  });
  it("retargets in canonical space even under a mirrored parent", () => {
    const rig = new Mannequin(),
      parent = new THREE.Group();
    parent.add(rig.mesh);
    const f = frame();
    f.joints[13]!.position = [0.3, 0.9, 0.1];
    rig.update(f);
    const q = rig.bones[5].quaternion.clone();
    parent.scale.x = -1;
    parent.updateMatrixWorld(true);
    rig.update(f);
    expect(rig.bones[5].quaternion.angleTo(q)).toBeLessThan(1e-6);
    rig.dispose();
  });
  it("spherically interpolates source-frame rotations at the video timestamp", () => {
    const rig = new Mannequin(),
      a = frame(),
      b = frame();
    a.joints[13]!.position = [0.6, 0.6, 0];
    a.joints[15]!.position = [0.9, 0.6, 0];
    b.time = 0.1;
    b.joints[13]!.position = [0.5, 0.7, 0.1];
    b.joints[15]!.position = [0.7, 0.9, 0.2];
    rig.update(a);
    const qa = rig.bones[5].quaternion.clone();
    rig.update(b);
    const qb = rig.bones[5].quaternion.clone();
    const data = { frames: [a, b], processing: { fps: 15 } } as MotionData;
    rig.updateAtTime(data, 0.05);
    expect(rig.bones[5].quaternion.angleTo(qa.slerp(qb, 0.5))).toBeLessThan(
      1e-6,
    );
    rig.dispose();
  });
  it("hides a limb branch whose observation is missing", () => {
    const rig = new Mannequin();
    const f = tpose();
    f.joints[25] = null;
    rig.update(f);
    expect(rig.bone("LeftThigh")!.scale.x).toBe(0);
    expect(rig.bone("RightThigh")!.scale.x).toBe(1);
    rig.dispose();
  });
  it("hides the rig when the body root is missing", () => {
    const rig = new Mannequin();
    const f = frame();
    f.joints[23] = null;
    rig.update(f);
    expect(rig.mesh.visible).toBe(false);
    rig.dispose();
  });
});
