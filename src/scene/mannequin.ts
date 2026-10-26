import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { motionInterval } from "../motion/preprocess";
import type { MotionData, MotionFrame } from "../motion/types";
// Original, procedurally authored T-pose rig. No external character asset or license dependency.
interface RigEntry {
  name: string;
  parent: number;
  offset: THREE.Vector3;
  child?: number;
  from?: number;
  to?: number;
  radius: number;
}
const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
export class Mannequin {
  readonly mesh: THREE.SkinnedMesh;
  readonly bones: THREE.Bone[];
  private entries: RigEntry[];
  constructor(lengths: Record<string, number> = {}) {
    const size = (key: string, standard: number) => lengths[key] || standard;
    this.entries = [
      { name: "Hips", parent: -1, offset: v(0, 0), child: 1, radius: 0.12 },
      { name: "Spine", parent: 0, offset: v(0, 0.24), child: 2, radius: 0.13 },
      { name: "Chest", parent: 1, offset: v(0, 0.24), child: 3, radius: 0.16 },
      { name: "Neck", parent: 2, offset: v(0, 0.12), child: 4, radius: 0.055 },
      { name: "Head", parent: 3, offset: v(0, 0.16), radius: 0.105 },
      {
        name: "LeftUpperArm",
        parent: 2,
        offset: v(0.21, 0),
        child: 6,
        from: 11,
        to: 13,
        radius: 0.06,
      },
      {
        name: "LeftForearm",
        parent: 5,
        offset: v(size("11-13", 0.29), 0),
        child: 7,
        from: 13,
        to: 15,
        radius: 0.045,
      },
      {
        name: "LeftHand",
        parent: 6,
        offset: v(size("13-15", 0.27), 0),
        child: 8,
        from: 15,
        to: 19,
        radius: 0.035,
      },
      { name: "LeftFingers", parent: 7, offset: v(0.11, 0), radius: 0.025 },
      {
        name: "RightUpperArm",
        parent: 2,
        offset: v(-0.21, 0),
        child: 10,
        from: 12,
        to: 14,
        radius: 0.06,
      },
      {
        name: "RightForearm",
        parent: 9,
        offset: v(-size("12-14", 0.29), 0),
        child: 11,
        from: 14,
        to: 16,
        radius: 0.045,
      },
      {
        name: "RightHand",
        parent: 10,
        offset: v(-size("14-16", 0.27), 0),
        child: 12,
        from: 16,
        to: 20,
        radius: 0.035,
      },
      { name: "RightFingers", parent: 11, offset: v(-0.11, 0), radius: 0.025 },
      {
        name: "LeftThigh",
        parent: 0,
        offset: v(0.11, 0),
        child: 14,
        from: 23,
        to: 25,
        radius: 0.085,
      },
      {
        name: "LeftShin",
        parent: 13,
        offset: v(0, -size("23-25", 0.44)),
        child: 15,
        from: 25,
        to: 27,
        radius: 0.06,
      },
      {
        name: "LeftFoot",
        parent: 14,
        offset: v(0, -size("25-27", 0.44)),
        child: 16,
        from: 27,
        to: 31,
        radius: 0.045,
      },
      {
        name: "LeftToes",
        parent: 15,
        offset: v(0, -0.04, 0.18),
        radius: 0.035,
      },
      {
        name: "RightThigh",
        parent: 0,
        offset: v(-0.11, 0),
        child: 18,
        from: 24,
        to: 26,
        radius: 0.085,
      },
      {
        name: "RightShin",
        parent: 17,
        offset: v(0, -size("24-26", 0.44)),
        child: 19,
        from: 26,
        to: 28,
        radius: 0.06,
      },
      {
        name: "RightFoot",
        parent: 18,
        offset: v(0, -size("26-28", 0.44)),
        child: 20,
        from: 28,
        to: 32,
        radius: 0.045,
      },
      {
        name: "RightToes",
        parent: 19,
        offset: v(0, -0.04, 0.18),
        radius: 0.035,
      },
    ];
    this.bones = this.entries.map((e) => {
      const b = new THREE.Bone();
      b.name = e.name;
      b.position.copy(e.offset);
      return b;
    });
    this.entries.forEach((e, i) => {
      if (e.parent >= 0) this.bones[e.parent].add(this.bones[i]);
    });
    this.bones[0].updateMatrixWorld(true);
    const geometries: THREE.BufferGeometry[] = [];
    this.entries.forEach((entry, i) => {
      const start = this.bones[i].getWorldPosition(new THREE.Vector3());
      const append = (
        geometry: THREE.BufferGeometry,
        distal: number,
        weight: (p: THREE.Vector3) => number,
      ) => {
        const count = geometry.attributes.position.count;
        const indices: number[] = [],
          weights: number[] = [];
        for (let j = 0; j < count; j++) {
          const p = new THREE.Vector3().fromBufferAttribute(
              geometry.attributes.position,
              j,
            ),
            w = weight(p);
          indices.push(i, distal, 0, 0);
          weights.push(1 - w, w, 0, 0);
        }
        geometry.setAttribute(
          "skinIndex",
          new THREE.Uint16BufferAttribute(indices, 4),
        );
        geometry.setAttribute(
          "skinWeight",
          new THREE.Float32BufferAttribute(weights, 4),
        );
        geometries.push(geometry);
      };
      const sphere = new THREE.SphereGeometry(entry.radius, 12, 8);
      sphere.translate(...start.toArray());
      append(sphere, i, () => 0);
      if (entry.child !== undefined) {
        const end = this.bones[entry.child].getWorldPosition(
            new THREE.Vector3(),
          ),
          delta = end.clone().sub(start),
          len = delta.length();
        const shape = new THREE.CylinderGeometry(
          entry.radius * 0.82,
          entry.radius,
          len,
          12,
          6,
        );
        shape.applyQuaternion(
          new THREE.Quaternion().setFromUnitVectors(
            v(0, 1),
            delta.clone().normalize(),
          ),
        );
        shape.translate(
          ...start.clone().add(end).multiplyScalar(0.5).toArray(),
        );
        append(shape, entry.child, (p) =>
          THREE.MathUtils.smoothstep(
            p.clone().sub(start).dot(delta) / (len * len),
            0.72,
            1,
          ),
        );
      }
    });
    const geometry = mergeGeometries(geometries);
    geometries.forEach((g) => g.dispose());
    this.mesh = new THREE.SkinnedMesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: "#d4d3c6",
        roughness: 0.83,
        metalness: 0.05,
      }),
    );
    this.mesh.add(this.bones[0]);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.name = "FORM original rigged mannequin";
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
    // Calibrate anatomical right/left against the original T-pose shoulder axis.
    const x = ls.clone().sub(rs).normalize(),
      y = ls
        .clone()
        .add(rs)
        .multiplyScalar(0.5)
        .sub(lh.clone().add(rh).multiplyScalar(0.5))
        .normalize();
    const z = x.clone().cross(y).normalize();
    y.copy(z.clone().cross(x).normalize());
    const body = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(x, y, z),
    );
    this.bones[0].quaternion.copy(body);
    this.bones[1].quaternion.identity();
    this.bones[2].quaternion.identity();
    // Compute rotations in canonical rig space, independent of presentation mirroring.
    const worldRotations: THREE.Quaternion[] = [];
    this.entries.forEach((e, i) => {
      worldRotations[i] =
        e.parent < 0
          ? this.bones[i].quaternion.clone()
          : worldRotations[e.parent].clone().multiply(this.bones[i].quaternion);
      if (e.from === undefined || e.to === undefined || e.child === undefined)
        return;
      const a = p(e.from),
        b = p(e.to);
      if (!a || !b) {
        this.bones[i].scale.setScalar(0);
        return;
      }
      this.bones[i].scale.setScalar(1);
      const rest = this.entries[e.child].offset.clone().normalize(),
        direction = b.sub(a).normalize();
      if (direction.lengthSq() < 0.5) {
        this.bones[i].scale.setScalar(0);
        return;
      }
      const desired = new THREE.Quaternion().setFromUnitVectors(
        rest,
        direction,
      );
      const parentWorld = worldRotations[e.parent].clone();
      this.bones[i].quaternion
        .copy(parentWorld.invert().multiply(desired))
        .normalize();
      worldRotations[i] = desired;
    });
    this.mesh.updateMatrixWorld(true);
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
      bone.quaternion.slerpQuaternions(
        rotations[i],
        bone.quaternion.clone(),
        t,
      );
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
