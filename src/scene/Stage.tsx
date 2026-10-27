import { useEffect, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  BONES,
  JOINT_COUNT,
  VISIBLE_JOINTS,
  isFaceJoint,
  isHandJoint,
  isLeftJoint,
  type MotionData,
} from "../motion/types";
import { sampleMotion } from "../motion/preprocess";
import { median } from "../motion/math";
import { Mannequin } from "./mannequin";
export type CameraPreset =
  "front" | "back" | "left" | "right" | "quarter" | "free";
export type StageMode = "skeleton" | "avatar" | "overlay";
const VISIBLE = new Set(VISIBLE_JOINTS);
interface Props {
  motion: MotionData | null;
  clock: MutableRefObject<number>;
  mirror: boolean;
  mode: StageMode;
  markers: boolean;
  rootMotion: boolean;
  orthographic: boolean;
  preset: CameraPreset;
  reset: number;
  selected: number | null;
  onSelect: (j: number | null) => void;
  onOrbit: () => void;
}
export function Stage(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    latest = useRef(props);
  latest.current = props;
  const [error, setError] = useState("");
  const api = useRef<{
    setView: (preset: CameraPreset) => void;
    setProjection: (ortho: boolean) => void;
  } | null>(null);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "low-power",
      });
    } catch {
      setError(
        "WebGL을 시작할 수 없습니다. 하드웨어 가속을 켜거나 최신 Chrome·Edge에서 열어 주세요.",
      );
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor("#222622");
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog("#222622", 9, 20);
    scene.add(new THREE.HemisphereLight("#ffffff", "#4b5044", 2.3));
    const light = new THREE.DirectionalLight("#fff4df", 2.6);
    light.position.set(3, 6, 4);
    // A contact shadow grounds the body and makes depth readable from the front camera.
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    Object.assign(light.shadow.camera, {
      left: -3.5,
      right: 3.5,
      top: 3.5,
      bottom: -3.5,
      near: 0.5,
      far: 16,
    });
    light.shadow.bias = -0.0005;
    light.shadow.normalBias = 0.02;
    scene.add(light);
    const fill = new THREE.DirectionalLight("#d5e2db", 1.5);
    fill.position.set(-4, 2, -3);
    scene.add(fill);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshStandardMaterial({ color: "#252a24", roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    floor.receiveShadow = true;
    scene.add(floor);
    const grid = new THREE.GridHelper(20, 40, "#6c7562", "#3b4439");
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.38;
    scene.add(grid);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.625, 80),
      new THREE.MeshBasicMaterial({
        color: "#899777",
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.38,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.001;
    scene.add(ring);
    const perspective = new THREE.PerspectiveCamera(37, 1, 0.01, 50),
      ortho = new THREE.OrthographicCamera(-1, 1, 1.55, -1.55, 0.01, 50);
    let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera =
      perspective;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.85, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.minDistance = 1.2;
    controls.maxDistance = 12;
    controls.maxPolarAngle = Math.PI * 0.94;
    controls.minZoom = 0.5;
    controls.maxZoom = 4;
    controls.addEventListener("start", () => latest.current.onOrbit());
    const resize = () => {
      const w = container.clientWidth,
        h = container.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      perspective.aspect = w / h;
      perspective.updateProjectionMatrix();
      ortho.left = (-1.55 * w) / h;
      ortho.right = (1.55 * w) / h;
      ortho.updateProjectionMatrix();
    };
    const setView = (preset: CameraPreset) => {
      if (preset === "free") return;
      const views: Record<Exclude<CameraPreset, "free">, number[]> = {
        front: [0, 1, 4.2],
        back: [0, 1, -4.2],
        left: [4.2, 1, 0],
        right: [-4.2, 1, 0],
        quarter: [2.8, 1.65, 3.3],
      };
      camera.position.fromArray(views[preset]);
      controls.target.set(0, 0.85, 0);
      camera.zoom = 1;
      camera.updateProjectionMatrix();
      controls.update();
    };
    api.current = {
      setView,
      setProjection: (enabled) => {
        const pos = camera.position.clone();
        camera = enabled ? ortho : perspective;
        camera.position.copy(pos);
        camera.lookAt(controls.target);
        controls.object = camera;
        resize();
        controls.update();
      },
    };
    setView(
      latest.current.preset === "free" ? "quarter" : latest.current.preset,
    );
    api.current.setProjection(latest.current.orthographic);
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    const body = new THREE.Group();
    scene.add(body);
    const skeleton = new THREE.Group();
    body.add(skeleton);
    const sphereGeometry = new THREE.SphereGeometry(0.023, 10, 8),
      boneGeometry = new THREE.CylinderGeometry(0.013, 0.013, 1, 8);
    // Fingers and face points are dense; smaller markers keep them separable.
    const markerScale = (i: number) =>
      isHandJoint(i) ? 0.38 : isFaceJoint(i) ? 0.6 : 1;
    const jointMeshes = Array.from({ length: JOINT_COUNT }, (_, i) => {
      const m = new THREE.Mesh(
        sphereGeometry,
        new THREE.MeshStandardMaterial({
          color: isLeftJoint(i) ? "#c5dca1" : "#d1d4c8",
          roughness: 0.7,
        }),
      );
      m.userData.joint = i;
      m.visible = false;
      skeleton.add(m);
      return m;
    });
    const boneMeshes = BONES.map(([a, b]) => {
      const m = new THREE.Mesh(
        boneGeometry,
        new THREE.MeshStandardMaterial({
          color: isLeftJoint(a) ? "#b9cf94" : "#d4d6cc",
          roughness: 0.9,
        }),
      );
      m.visible = false;
      m.userData.thickness = isHandJoint(a) || isHandJoint(b) ? 0.4 : 1;
      skeleton.add(m);
      return m;
    });
    let mannequin: Mannequin | null = null,
      loaded: MotionData | null = null,
      rootHeight = 1;
    const raycaster = new THREE.Raycaster(),
      mouse = new THREE.Vector2();
    let pointer: [number, number] = [0, 0];
    const pointerDown = (e: PointerEvent) => {
      pointer = [e.clientX, e.clientY];
    };
    const select = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - pointer[0], e.clientY - pointer[1]) > 5)
        return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(
        jointMeshes.filter((m) => m.visible),
      );
      latest.current.onSelect(
        hits.length ? hits[0].object.userData.joint : null,
      );
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", select);
    const contextLost = (e: Event) => {
      e.preventDefault();
      setError(
        "3D 그래픽 연결이 중단되었습니다. 페이지를 새로고침해 주세요. 영상과 분석 파일은 별도로 보관할 수 있습니다.",
      );
    };
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    const up = new THREE.Vector3(0, 1, 0);
    let raf = 0;
    const draw = () => {
      const current = latest.current;
      if (current.motion !== loaded) {
        if (mannequin) {
          body.remove(mannequin.mesh);
          mannequin.dispose();
          mannequin = null;
        }
        loaded = current.motion;
        if (loaded) {
          mannequin = new Mannequin(loaded.processing.boneLengths);
          body.add(mannequin.mesh);
          rootHeight = loaded.processing.refinementReport
            ? -loaded.processing.refinementReport.groundY
            : median(
                loaded.frames.flatMap((f) =>
                  [27, 28, 31, 32].flatMap((j) =>
                    f.joints[j] && f.joints[j]!.confidence > 0.6
                      ? [-f.joints[j]!.position[1]]
                      : [],
                  ),
                ),
              ) || 1;
        }
      }
      const frame = loaded ? sampleMotion(loaded, current.clock.current) : null;
      body.visible = Boolean(frame);
      body.scale.x = current.mirror ? -1 : 1;
      if (frame) {
        const translation = current.rootMotion ? frame.root : [0, 0, 0];
        body.position.set(
          translation[0],
          rootHeight + (frame.root[1] || 0) + 0.055,
          translation[2],
        );
        skeleton.visible = true;
        jointMeshes.forEach((m, i) => {
          const j = frame.joints[i];
          m.visible =
            Boolean(j) &&
            VISIBLE.has(i) &&
            (current.mode !== "avatar"
              ? current.markers || current.selected === i
              : current.selected === i);
          if (j) {
            m.position.fromArray(j.position);
            m.scale.setScalar(markerScale(i) * (current.selected === i ? 1.8 : 1));
            m.material.color.set(
              current.selected === i
                ? "#f2c574"
                : j.confidence < 0.55 || j.interpolated
                  ? "#d4a46a"
                  : isLeftJoint(i)
                    ? "#c5dca1"
                    : "#d1d4c8",
            );
          }
        });
        boneMeshes.forEach((m, i) => {
          const [a, b] = BONES[i],
            ja = frame.joints[a],
            jb = frame.joints[b];
          m.visible = current.mode !== "avatar" && Boolean(ja && jb);
          if (ja && jb) {
            const from = new THREE.Vector3(...ja.position),
              to = new THREE.Vector3(...jb.position),
              delta = to.clone().sub(from);
            m.position.copy(from.add(to).multiplyScalar(0.5));
            m.scale.set(
              m.userData.thickness,
              delta.length(),
              m.userData.thickness,
            );
            m.quaternion.setFromUnitVectors(up, delta.normalize());
            m.material.color.set(
              Math.min(ja.confidence, jb.confidence) < 0.55 ||
                ja.interpolated ||
                jb.interpolated
                ? "#b18c60"
                : isLeftJoint(a)
                  ? "#b9cf94"
                  : "#d4d6cc",
            );
          }
        });
        if (mannequin) {
          const showBody = current.mode !== "skeleton";
          mannequin.mesh.visible = showBody;
          mannequin.setGhost(current.mode === "overlay");
          if (showBody) mannequin.updateAtTime(loaded!, current.clock.current);
        }
      }
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      api.current = null;
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointerup", select);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      mannequin?.dispose();
      sphereGeometry.dispose();
      boneGeometry.dispose();
      jointMeshes.forEach((m) => m.material.dispose());
      boneMeshes.forEach((m) => m.material.dispose());
      floor.geometry.dispose();
      floor.material.dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      ring.geometry.dispose();
      ring.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  useEffect(() => {
    api.current?.setView(props.preset);
  }, [props.preset, props.reset]);
  useEffect(() => {
    api.current?.setProjection(props.orthographic);
  }, [props.orthographic]);
  return (
    <div
      className="stage-canvas"
      ref={host}
      aria-label="상호작용 가능한 3D 포즈 뷰어"
    >
      {error && (
        <div className="stage-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
