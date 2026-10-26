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
export interface RawFrame {
  time: number;
  image: Landmark[] | null;
  world: Landmark[] | null;
  people: number;
}
export interface MotionFrame extends RawFrame {
  joints: (Joint | null)[];
  root: Vec3;
  contacts?: { left: boolean; right: boolean };
}
export interface SourceOrigin {
  kind: "direct-url" | "tab-capture";
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
  };
  practice: Practice;
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
];
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
  [7, 8],
];
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
export const DEFAULT_PRACTICE: Practice = { bpm: 120, offset: 0, segments: [] };
