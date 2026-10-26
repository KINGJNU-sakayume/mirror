# Verification record

Verified on 2026-10-26 in managed Linux, Node 24 and headless Chromium 154.0.8037.57 with software WebGL. These are test observations, not motion-reconstruction accuracy scores.

## Automated checks

- **46 Vitest tests pass**: image/world axis conversion; anatomical mirror reflection and asymmetric left-hand movement; time-based interpolation and backward seeks; missing joints and long gaps; clip bone lengths; rotation and footwork preservation; motion-aware filtering; import validation and source matching; A–B boundaries; manual eight-count offsets; real SkinnedMesh binding; anatomical bone mapping; canonical retargeting independent of a mirrored parent; quaternion slerp; missing root handling.
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
- No dedicated inverse kinematics, foot-contact locking, axial twist recovery, physical joint constraints or calibrated global movement reconstruction. See README / architecture for retargeting limits.
- Actual GitHub Pages publication depends on repository Pages configuration. CI preserves successful build/test status and documents the one-time setting when Pages is not enabled; a generated bundle alone is not called a live deployment.
