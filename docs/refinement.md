# Contact-aware motion refinement

The optional **발 접지 추정 · IK · 관절각 제약** setting is enabled for new analyses. It can also be toggled immediately after analysis: FORM reconstructs again from preserved image/world observations without rerunning the pose model. This supports comparison and lets users disable a bad contact hypothesis.

This is an estimate under a **fixed-camera assumption**, not a calibrated motion-capture solver or a numerical accuracy guarantee.

## Pipeline

The existing confidence cutoff, bounded 0.2s gap interpolation, adaptive One Euro filters, outlier checks and robust bone-length normalization run first. The new stage:

1. Calibrates shoulder width, pelvis width and torso length from clip medians, in addition to limb lengths. The mannequin's T-pose uses these measurements.
2. Estimates a ground reference from a low percentile of confidently observed canonical ankle heights.
3. Finds candidate foot contacts from source-image ankle speed, visibility, local projected floor height and the other foot. A still raised foot and brief contact candidates are rejected. Consecutive contact must last at least 0.12 seconds. Missing observations are never relabeled as planted.
4. Estimates pelvis-height changes from support ankles relative to the ground reference, with an adaptive filter. This allows the pelvis to descend during a squat instead of leaving support feet floating. Vertical compensation affects both root presentation modes; horizontal / depth translation stays optional.
5. Applies broad anatomical folding limits (minimum interior angle: elbows 12°, knees 15°) only when a detected configuration violates them. Full extension is permitted. End-dependent hand / foot points move consistently with their corrected wrist / ankle.
6. Creates a robust support-foot anchor in approximate root space. Contact influence fades in, anchors refresh after 1.5 seconds, and corrections over 0.16 normalized meters release contact instead of dragging the dancer.
7. Solves the hip–knee–ankle chain with **closed-form two-bone IK**, preserving clip bone lengths and the observed bend plane. Near straight configurations use a stable pole hint. Targets outside limb reach are clamped rather than stretching bones. Heel / toe points follow ankle corrections.

Only inferred canonical joints and the separate root translation change. Original image/world landmarks, timestamps, confidence and anatomical indices remain intact. Rendering still follows source time and uses deterministic quaternion interpolation. Long missing stretches stay missing.

## Data

Backward-compatible optional v1 fields:

```ts
processing.refinement?: boolean;
processing.refinementReport?: {
  version: 1;
  groundY: number;
  contactFrames: number;
  ikAdjustments: number;
  angleConstraints: number;
  maxFootAdjustment: number;
  assumption: 'fixed-camera';
};
frame.contacts?: { left: boolean; right: boolean };
```

Reports contain counts and measured adjustment magnitudes, not accuracy scores. Distances use the standard normalized body scale, not a calibrated dancer's true centimeters. Imports validate the extensions. Cache keys include the refinement setting and algorithm revision.

## Verification

Unit tests cover feasible / unreachable / collinear IK, angle limits, planted-foot drift reduction, preservation of leg lengths and image evidence, moving / raised / low-confidence feet, long occlusion, and squat pelvis lowering.

On the development-only actual 13-second TensorFlow squats clip, the same extracted observations were reconstructed with refinement off/on. Across 358 adjacent support-foot observations, cumulative foot travel in approximate root space changed from **5.9525 to 1.7137 normalized units**, about **71.2% less**. There were 194 contact frames and 372 IK adjustments. This is a support-foot drift diagnostic on one clip, **not 71.2% better pose accuracy**. The pipeline had no ground-truth motion-capture comparison and this does not prove improvement on fast K-POP choreography.

## Remaining limitations

Camera panning / zoom, a moving floor, sliding choreography, jumps, perspective and occlusion can produce incorrect contact hypotheses. Contact is conservative but not infallible; the toggle exists for this reason. Recorded tab frames can add compression and timing noise. Root X/Z is still a heuristic. The unsigned angle limits do not recover hidden anatomy, knee bend sign or accurate axial twist. There is no SMPL fitting, camera-calibrated reprojection optimization, physical dynamics, global position ground truth or temporal learned reconstruction backend.
