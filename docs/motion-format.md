# FORM motion schema v1

A JSON object with `schema: "form.motion"`, `version: 1`. All frame times and practice positions use **source-video seconds**. Inference converts them to milliseconds only at the MediaPipe API boundary. No playback-rate-adjusted times are stored.

```ts
interface MotionData {
  schema: 'form.motion';
  version: 1;
  createdAt: string; // ISO date
  source: {
    name: string; size: number; width: number; height: number;
    duration: number; fingerprint: string;
  };
  coordinates: {
    axes: 'x-right_y-up_z-toward-camera';
    units: 'normalized-meters'; root: 'hip-relative';
    leftRight: 'anatomical';
  };
  processing: {
    fps: number; quality: 'lite' | 'full'; smoothing: boolean;
    model: string; engine: 'worker' | 'main-thread';
    minConfidence: number; maxGap: number; scale: number;
    boneLengths: Record<string, number>;
  };
  frames: {
    time: number;
    people: number; // detections capped at two, not a crowd count
    image: Landmark[] | null;
    world: Landmark[] | null;
    joints: (Joint | null)[];
    root: [number, number, number];
  }[];
  statistics: { total: number; detected: number; partial: number; multiple: number };
  practice: {
    bpm: number; offset: number;
    segments: { id: string; name: string; start: number; end: number }[];
  };
}
interface Landmark {
  x: number; y: number; z: number;
  visibility: number; presence: number;
}
interface Joint {
  position: [number, number, number];
  confidence: number;
  interpolated: boolean;
}
```

33 entries in every landmark / joint array use MediaPipe's original anatomical indices. World / image arrays are null for missed or ambiguous multi-person frames. Canonical joint arrays always contain 33 entries with individual nulls for unavailable joints. They may contain explicitly marked short-gap estimates even when the observation arrays are null. No sample motion is generated in the product.

## Five coordinate spaces

| Space | Origin and orientation | Meaning |
| --- | --- | --- |
| Raw `image` | Top-left; X right, Y down; X / Y relative to source dimensions | 2D observed evidence; Z is MediaPipe's normalized depth estimate, not camera calibration |
| Raw `world` | Approximate hip center; X image-right, Y down, Z away | MediaPipe metric-like monocular 3D estimate, **not global stage location** |
| Canonical `joints` | Average hips; X image-right, Y up, Z toward camera | Centered, scaled, filtered, bone-normalized 3D estimate |
| Avatar local | Original T-pose hierarchy and bind matrices | Parent-relative rotations derived from canonical limb directions |
| View | Three.js camera and optional parent X reflection | Presentation only; does not alter observations or anatomical labels |

Axis conversion is `[(x-hipX)*scale, -(y-hipY)*scale, -(z-hipZ)*scale]`. Scale is the clip median shoulder-to-same-side-hip distance normalized to approximately 0.5. Thus `normalized-meters` denotes a readable standard body scale, not a recovered person's exact physical size.

A front-facing T-pose has anatomical left shoulder at positive canonical X, right shoulder at negative X, head at positive Y. The front camera is at +Z, back at -Z; the dancer's left-side camera is +X, right-side camera -X. Arbitrary observed body rotations remain in the joint positions. No per-frame front-facing alignment erases turns.

Stationary playback uses hip-relative articulation with a fixed ground display offset. Estimated root translation is stored separately and is **approximate**: image hip displacement and apparent stature changes. Root Y optionally contains support-foot height compensation. With refinement enabled, the ground reference also drives conservative contact-aware foot IK; contact remains a monocular estimate.

Mirror mode applies `[-x,y,z]` to the rendered parent only. It never swaps indices 11/12, 13/14, 15/16, etc. Original video presentation is reflected once with CSS. Selected limb labels always refer to the original dancer's anatomical side, including in back views.

## Versioning and validation

Import rejects unknown schemas / versions, incompatible coordinates, non-finite values, non-increasing timestamps, missing / malformed arrays, out-of-range source / practice values and mismatched source video. Limits are 600 seconds, 18,000 frames and 180MB JSON. Informational statistics are recomputed during import.

`maxGap` is 0.2 seconds. Positions only interpolate if both bracketing joints exist and the timestamp interval is short enough. Long missing stretches remain absent. Observed and inferred data stay separate.

Exports include the current user's practice changes. Original video bytes and rendered camera / mirror settings are intentionally not serialized as body measurements. Future backends must convert their own coordinate conventions to this schema before import. Optional precomputed humanoid rotations can be added by a future schema revision; v1 derives them from canonical joint directions at playback.

## Backward-compatible link / refinement extensions

Optional `source.origin`, `processing.refinement`, `processing.refinementReport`, and `frame.contacts` are documented in [link analysis](link-analysis.md) and [refinement](refinement.md). Older v1 files remain importable. Raw image/world arrays keep their original conventions.
