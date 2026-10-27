# Verification record

## 2026-10-27 · finger analysis, dancer tracking and procedural humanoid

Managed Linux, Node 22, headless Chromium (Playwright 1243 build) with SwiftShader WebGL.

- **103 Vitest tests pass**, including new checks: dancer identity kept when a larger person enters and no jump to a distant person; hand crop region contains the pose hand and crop landmarks map back to full-frame coordinates; the other hand in a crop is rejected; 75-joint frames with hands attached at the body wrist; hand axis conversion; low-confidence hands ignored; short finger gaps filled and labeled; body-only (33-joint) JSON padded on import; malformed hand data rejected; separate cache keys for finger analysis; 47-bone humanoid with normalized skin weights; T-pose observation reproduces the rest pose; waist twist splits over spine / chest; head turns toward the nose; forearm roll follows the palm; finger bends from hand landmarks and relaxed fingers without them.
- `pose_squats.mp4` (13 s) analyzed end-to-end at the new defaults (Full, 30 fps, fingers): **390 frames, 390 tracked, 390 with finger landmarks**, Web Worker path. `npm run test:browser` then passed with the exported JSON reimported (including humanoid, overlay and skeleton mode screenshots).
- Throughput in this single-core sandbox: 2.70 frames/s body-only vs 1.57 frames/s with fingers (Full model). Desktop browsers are substantially faster; the ratio is the useful number.


Verified on 2026-10-26 in managed Linux, Node 24 and headless Chromium 154.0.8037.57 with software WebGL. These are test observations, not motion-reconstruction accuracy scores.

## Automated checks

- **82 Vitest tests pass**: image/world axis conversion; anatomical mirror reflection and asymmetric left-hand movement; time-based interpolation and backward seeks; missing joints and long gaps; clip bone lengths; rotation and footwork preservation; motion-aware filtering; import validation and source matching; A–B boundaries; manual eight-count offsets; real SkinnedMesh binding; anatomical bone mapping; canonical retargeting independent of a mirrored parent; quaternion slerp; missing root handling; link normalization and bounded CORS imports; two-bone IK, conservative foot contacts, squat root height, evidence preservation, and optional-schema validation.
- `npm run build` passes TypeScript and creates a Vite production bundle.
- Both redistributed model bundles match the SHA-256 values in `THIRD_PARTY.md`.

## Actual inference in a browser

Development-only media came from TensorFlow's `tfjs-models/pose-detection/test_data` repository. No inference was mocked or replaced by its reference JSON files.

1. `pose.jpg` encoded into a 2-second local MP4: **30 actual frame inferences**, 30 single-person tracked frames, all 33 original image/world landmarks retained, rendered 2D overlay and 3D skeleton. This is a static-person pipeline check, not a dance-motion validation.
2. `pose_squats.mp4`, 13 seconds, 720×1280: **195 actual frame inferences at 15 sampled fps**, 195 single-person tracked frames, Web Worker path. Canonical wrist position varied over the clip; exported motion came from the newly analyzed video. The input is only 5fps, so sampling at 15fps repeats decoded source frames; it does not create extra observed motion detail.
3. The initial ESM-worker/importScripts incompatibility was reproduced, then corrected by using a bundled classic worker. The same static-person analysis also completed on the cooperative main-thread fallback before that fix. Classic-worker operation was subsequently verified on both videos.

## Browser interactions exercised

- File input and decoded metadata; local original playback.
- Analysis completion, full motion export and matching-source JSON reimport.
- Real 3D front/back views produce different rendered geometry.
- The skinned mannequin renders the estimated pose; skeleton/avatar switching works.
- Seek updates original time immediately; backward and forward 1/30-second steps work.
- 0.5× playback follows the source clock; a paused stage remains identical across screenshots.
- Mirror reflects the video and leaves camera preset state independent.
- Loop [1s,2s] returns inside its boundaries during 1.5× playback.
- Named segment save, eight-count loop, orthographic projection.
- Split / video / 3D layouts.
- 390px mobile viewport has no horizontal overflow; camera and playback controls remain usable.
- Invalid MIME input, error dismissal, analysis cancellation, malformed JSON import, mismatched-source JSON, help-dialog Escape handling.
- No uncaught browser page errors during these checks.

The production build at the GitHub Pages `/mirror/` base path also loaded successfully and performed 30 fresh inferences through the classic Web Worker with no uncaught page errors.

The browser checks were repeated against exported analysis after the final retargeting changes. This tests rendering/interaction independently from re-running expensive inference.

## Reproduce browser checks

Start `npm run dev` in one terminal. The script intentionally requires an authorized moving single-person video rather than bundling copyrighted media or a canned animation. Use a clip of at least four seconds with visible arm motion.

```sh
npx playwright install chromium
FORM_TEST_VIDEO=/absolute/path/to/video.mp4 npm run test:browser
```

Optional environment variables:

- `FORM_BROWSER_PATH`: installed Chromium executable instead of Playwright's downloaded browser.
- `FORM_TEST_URL`: served app URL (default `http://127.0.0.1:5173/`).
- `FORM_TEST_MOTION`: matching exported FORM JSON. This reuses real analysis for playback/retargeting regression checks and **skips inference**, which is stated here explicitly.

The test saves its export and screenshots in ignored `work/`. It does not upload input videos. A full CPU-inference run can take several minutes on software-only machines.

## Remaining validation and functionality limits

- No user-supplied K-POP clip was available. Fast choreography, full spins, loose clothing and prolonged real occlusion need a representative authorized video set. Unit fixtures cover asymmetry, rotation, stepping, abrupt changes and occlusion but do not prove real-video accuracy on those cases.
- Chromium desktop and emulated mobile viewport were tested. Real mobile touch devices, Safari and Firefox remain unverified. Browser fallback compatibility is implemented; this is not a claim that every platform works.
- Full-model assets are checked and available; the recorded end-to-end extraction used Lite. Full-model inference, very long videos, storage exhaustion and WebGL context loss need additional device tests.
- Closed-form IK, approximate foot-contact stabilization, pelvis-height compensation and broad folding limits are implemented. Exact axial twist, camera-calibrated global movement and physical dynamics remain unimplemented. See [refinement](refinement.md).
- Actual GitHub Pages publication depends on repository Pages configuration. CI preserves successful build/test status and documents the one-time setting when Pages is not enabled; a generated bundle alone is not called a live deployment.

## Link acquisition and refinement update

The direct-link path fetched a real local HTTP MP4 without file input, then automatically performed **30 real frame inferences / 30 detections**. The resulting JSON recorded direct-URL provenance and a refinement report. Toggle-off/on rebuilt motion from original observations without another inference pass.

A separate, visible test-media tab was opened in an isolated Chromium browser. The test used Chromium's native tab-capture auto-selection flag in that **QA process only**; it did **not** replace `getDisplayMedia`, MediaRecorder, canvas cropping, the decoder or MediaPipe. The app's normal permission prompt remains mandatory for users. A 3.589-second cropped **408×720 WebM** was recorded, repaired, imported and automatically analyzed: **54 real frame inferences / 54 single-person detections**, with no uncaught page errors. A repeat with an automatically fitted crop recorded 3.600 seconds at 404×720 and completed 55 / 55 detections. The final production build at `/mirror/` also fetched a real video from a different localhost origin using CORS and completed 30 / 30 worker inferences with refinement enabled.

The captured tab played the authorized development-only TensorFlow squats fixture. This verifies native browser tab pixels → recording → actual inference. It is not a claim that an arbitrary external YouTube / Reels video was downloaded or that every provider permits capture. YouTube Shorts URL normalization and official embed construction were exercised; Instagram URL variants are unit-tested. Actual provider login, geo restrictions, DRM and real mobile screen-capture remain outside the verified set.

The contact-aware reconstruction comparison and its limitations are recorded in [refinement](refinement.md). Full playback / camera / mirror / loop / mobile regressions passed again with that refined motion imported.

To reproduce both actual URL ingestion and native tab capture against the dev server:

```sh
FORM_TEST_VIDEO=/path/to/authorized-person-video.mp4 FORM_BROWSER_PATH=/path/to/chromium npm run test:links
```

Use a full-body single-person video. The script copies QA media to ignored `work/` and serves it from Vite, then opens an isolated capture-source tab. `FORM_CAPTURE_VIDEO` optionally supplies a separate moving capture fixture. Auto-selection flags are confined to the test browser; production app code never supplies them.
