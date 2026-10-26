import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { Mannequin } from "./mannequin";
import type { MotionData, MotionFrame } from "../motion/types";
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
describe("original skinned mannequin", () => {
  it("contains a real bound skeleton and vertex skin weights", () => {
    const rig = new Mannequin();
    expect(rig.mesh.isSkinnedMesh).toBe(true);
    expect(rig.mesh.skeleton.bones).toHaveLength(21);
    expect(rig.mesh.geometry.attributes.skinWeight.count).toBeGreaterThan(100);
    rig.dispose();
  });
  it("maps anatomical left and right to separate bones", () => {
    const rig = new Mannequin();
    expect(rig.bones[5].name).toBe("LeftUpperArm");
    expect(rig.bones[9].name).toBe("RightUpperArm");
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
    const dir = new THREE.Vector3(1, 0, 0).applyQuaternion(
      rig.bones[5].getWorldQuaternion(new THREE.Quaternion()),
    );
    expect(dir.y).toBeCloseTo(1);
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
  it("hides the rig when the body root is missing", () => {
    const rig = new Mannequin();
    const f = frame();
    f.joints[23] = null;
    rig.update(f);
    expect(rig.mesh.visible).toBe(false);
    rig.dispose();
  });
});
