export type Vec3 = [number, number, number];
export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
  presence: number;
}
export interface Joint {
  position: Vec3;
  confidence: number;
  interpolated: boolean;
}
// One hand from the crop-refined HandLandmarker pass. 21 MediaPipe hand indices.
export interface HandObservation {
  image: Landmark[]; // normalized to the full source frame, not the crop
  world: Landmark[]; // metric hand-centered estimate, MediaPipe axes
  score: number;
}
export interface RawFrame {
  time: number;
  image: Landmark[] | null;
  world: Landmark[] | null;
  people: number;
  // Anatomical [left, right], assigned from the pose wrist that seeded the crop.
  hands?: [HandObservation | null, HandObservation | null];
}
export interface MotionFrame extends RawFrame {
  joints: (Joint | null)[];
  root: Vec3;
  contacts?: { left: boolean; right: boolean };
}
export interface SourceOrigin {
  kind: "direct-url" | "tab-capture" | "local-helper";
  url: string;
  capturedAt?: string;
}
export interface RefinementReport {
  version: 1;
  groundY: number;
  contactFrames: number;
  ikAdjustments: number;
  angleConstraints: number;
  maxFootAdjustment: number;
  assumption: "fixed-camera";
}
export interface VideoSource {
  name: string;
  size: number;
  width: number;
  height: number;
  duration: number;
  fingerprint: string;
  origin?: SourceOrigin;
}
export interface PracticeSegment {
  id: string;
  name: string;
  start: number;
  end: number;
}
export interface Practice {
  bpm: number;
  offset: number;
  segments: PracticeSegment[];
}
export type Quality = "lite" | "full";
export interface AnalysisOptions {
  fps: number;
  quality: Quality;
  smoothing: boolean;
  refinement?: boolean;
  hands?: boolean;
}
export interface MotionData {
  schema: "form.motion";
  version: 1;
  createdAt: string;
  source: VideoSource;
  coordinates: {
    axes: "x-right_y-up_z-toward-camera";
    units: "normalized-meters";
    root: "hip-relative";
    leftRight: "anatomical";
  };
  processing: AnalysisOptions & {
    model: string;
    minConfidence: number;
    maxGap: number;
    scale: number;
    engine: "worker" | "main-thread";
    boneLengths: Record<string, number>;
    refinementReport?: RefinementReport;
  };
  frames: MotionFrame[];
  statistics: {
    total: number;
    detected: number;
    partial: number;
    multiple: number;
    hands?: number;
  };
  practice: Practice;
}
export const POSE_COUNT = 33;
export const HAND_COUNT = 21;
export const LEFT_HAND = 33;
export const RIGHT_HAND = LEFT_HAND + HAND_COUNT;
export const JOINT_COUNT = RIGHT_HAND + HAND_COUNT;
export const HAND_BASES = [LEFT_HAND, RIGHT_HAND] as const;
function handNames(side: string) {
  const names = [`${side} 손목`];
  for (const finger of ["엄지", "검지", "중지", "약지", "새끼"])
    names.push(
      ...["뿌리", "1마디", "2마디", "끝"].map((k) => `${side} ${finger} ${k}`),
    );
  return names;
}
export const JOINT_NAMES = [
  "코",
  "왼쪽 눈 안쪽",
  "왼쪽 눈",
  "왼쪽 눈 바깥쪽",
  "오른쪽 눈 안쪽",
  "오른쪽 눈",
  "오른쪽 눈 바깥쪽",
  "왼쪽 귀",
  "오른쪽 귀",
  "왼쪽 입",
  "오른쪽 입",
  "왼쪽 어깨",
  "오른쪽 어깨",
  "왼쪽 팔꿈치",
  "오른쪽 팔꿈치",
  "왼쪽 손목",
  "오른쪽 손목",
  "왼쪽 새끼손가락",
  "오른쪽 새끼손가락",
  "왼쪽 검지",
  "오른쪽 검지",
  "왼쪽 엄지",
  "오른쪽 엄지",
  "왼쪽 골반",
  "오른쪽 골반",
  "왼쪽 무릎",
  "오른쪽 무릎",
  "왼쪽 발목",
  "오른쪽 발목",
  "왼쪽 뒤꿈치",
  "오른쪽 뒤꿈치",
  "왼쪽 발끝",
  "오른쪽 발끝",
  ...handNames("왼손"),
  ...handNames("오른손"),
];
// Hand-local finger chains from the wrist (0), MediaPipe hand indices.
export const FINGER_CHAINS: number[][] = [0, 1, 2, 3, 4].map((f) => [
  0,
  1 + f * 4,
  2 + f * 4,
  3 + f * 4,
  4 + f * 4,
]);
export const BONES: [number, number][] = [
  [11, 12],
  [11, 23],
  [12, 24],
  [23, 24],
  [11, 13],
  [13, 15],
  [15, 19],
  [12, 14],
  [14, 16],
  [16, 20],
  [23, 25],
  [25, 27],
  [27, 29],
  [29, 31],
  [27, 31],
  [24, 26],
  [26, 28],
  [28, 30],
  [30, 32],
  [28, 32],
  [7, 2],
  [2, 0],
  [0, 5],
  [5, 8],
  [9, 10],
  ...HAND_BASES.flatMap((base) => handBones(base)),
];
function handBones(base: number): [number, number][] {
  const bones: [number, number][] = [];
  for (const chain of FINGER_CHAINS)
    for (let k = 1; k < chain.length; k++)
      bones.push([base + chain[k - 1], base + chain[k]]);
  for (const [a, b] of [
    [5, 9],
    [9, 13],
    [13, 17],
  ])
    bones.push([base + a, base + b]);
  return bones;
}
export const LIMB_CHAINS: number[][] = [
  [11, 13, 15, 19],
  [12, 14, 16, 20],
  [23, 25, 27, 31],
  [24, 26, 28, 32],
];
export const BODY_JOINTS = [
  0, 7, 8, 11, 12, 13, 14, 15, 16, 19, 20, 23, 24, 25, 26, 27, 28, 29, 30, 31,
  32,
];
// Everything drawn as an evidence marker: head orientation points, body, both hands.
export const VISIBLE_JOINTS = [
  0, 2, 5, 9, 10, ...BODY_JOINTS.slice(1),
  ...Array.from({ length: HAND_COUNT * 2 }, (_, i) => LEFT_HAND + i),
];
export const isHandJoint = (i: number) => i >= LEFT_HAND;
export const isFaceJoint = (i: number) => i <= 10;
// MediaPipe pose uses odd indices for anatomical left; hands follow their block.
export const isLeftJoint = (i: number) =>
  i < POSE_COUNT ? i % 2 === 1 : i < RIGHT_HAND;
export const DEFAULT_PRACTICE: Practice = { bpm: 120, offset: 0, segments: [] };
