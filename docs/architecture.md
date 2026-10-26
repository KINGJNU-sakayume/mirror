# Architecture

## Data flow

```text
Local File → object URL → inspectVideo / fingerprint
                        ↘ visible HTMLVideoElement → playback clock
                        ↘ separate muted decoder → chronological seeks
                            → max 960px 2D canvas → transferable ImageBitmap
                            → classic Web Worker → PoseLandmarker.detectForVideo
                            → RawFrame[] → preprocess → MotionData → IndexedDB
                                                             ↘ JSON export/import
Visible video.currentTime → sampleMotion(timestamp)
                          → image landmarks → 2D overlay
                          → canonical 3D joints → skeleton / mannequin rig
```

`analysis/video.ts` inspects metadata, creates a sampled-content identity and waits for decoded seek frames. The decoder never changes the playback element. Inference timestamps are the requested source-frame times in milliseconds, strictly increasing within a fresh VIDEO landmarker instance. Repeated source frames (e.g. 5fps source, 15fps sampling) remain repeated observations, not extra real temporal detail.

`analysis/estimator.ts` pins CPU inference and asks for two poses to reject ambiguous multi-person frames. It preserves one person's raw normalized image landmarks, hip-relative world estimates and confidence. No network requests send video, pixels or landmarks. App / model / runtime assets are served from the app origin. MediaPipe upstream behavior is governed by its license / upstream privacy terms; FORM itself contains no analytics or upload endpoint.

## Worker and fallback

MediaPipe 0.10.21's WASM loader internally uses `importScripts`. A module worker cannot execute that API. `scripts/prepare-assets.mjs` bundles the TypeScript worker and its imports as an **IIFE classic worker**, with esbuild. This happens in postinstall / predev / prebuild. The app loads it from `BASE_URL/pose-worker.js` and passes absolute local asset URLs. No blob workaround or third-party CDN is needed.

Each frame is transferred and released before the next is decoded. One in-flight frame caps bitmap memory. A request timeout and AbortSignal release listeners, then terminate the worker. Failed worker initialization uses the same estimator on the main thread, with `setTimeout(0)` between frames. This is a documented cooperative fallback, not nonblocking per-frame inference. Source-video decoding and inference occur outside React rendering.

## Reconstruction

`motion/preprocess.ts` separates observations from estimates:

- Preserve image / world arrays unchanged.
- Center at average hips; convert `(x,y,z)` to `(x,-y,-z)`.
- Normalize torso scale once per clip from a robust median.
- Reject low-confidence roots / joints and implausibly large short-time joint jumps. Generous speed envelopes retain fast distal gestures.
- Use independent adaptive One Euro filters per axis, with reset after long gaps.
- Fill only bounded interior gaps up to 0.2 seconds. Mark interpolated joints and reduce confidence. Never fill raw observation arrays.
- Constrain arm / leg chain segment lengths to robust clip medians.
- Preserve absent joints; skeleton segments disappear instead of inventing motion.

Estimated root X follows image hip movement; estimated depth follows apparent body size. These are labeled approximate. Stationary presentation discards these translations. The stage adds a fixed ground reference from observed feet; it is not contact-aware IK.

`sampleMotion` binary-searches actual timestamps and interpolates valid pairs. It refuses long intervals or unavailable joints. Neither speed nor a wall-clock animation phase is used.

## Rendering and retargeting

`scene/Stage.tsx` owns one Three.js renderer, scene, perspective and orthographic cameras, orbit controls, primitives and ray picking. It reads the current visible video's clock every render. Camera state is independent of dancer motion. Presets show actual 3D points. All camera / geometry / material / skeleton resources are disposed on unmount or replacement.

`scene/mannequin.ts` authors an original 21-bone T-pose hierarchy. A merged mesh contains body cylinders and joint spheres with actual skin indices / blended weights, bound to `THREE.Skeleton`. It is a rigged neutral mannequin, not relabeled skeleton lines. The rig's left/right arm and leg lengths are calibrated from clip medians. Its torso / shoulder offsets remain neutral.

Shoulder / hip axes establish the body basis. Each limb's measured world direction defines a rest-direction quaternion. Multiplying by the inverse parent-world rotation yields the bone-local rotation. Source-frame quaternions are spherically interpolated by source timestamp. Seeks are deterministic and never accumulate per-render smoothing delay. Missing required torso data hides the rig; missing limb data hides its corresponding branch. Exact axial twist, head gaze, joint-angle limits and foot locking remain limitations. Skeleton mode is always available for inspecting the underlying evidence.

## Playback and practice

`player/usePlayback.ts` is the only transport controller. The visible video is the clock authority. `requestVideoFrameCallback`, RAF and media seek / play / pause events keep the shared clock current without another animation time. A–B enforcement happens before rendering; the video is sought to A, then all views evaluate A. Media seek precision and refresh scheduling bound loop accuracy.

Frame-step is explicitly 1/30 second because HTML video metadata does not reveal reliable source FPS. Browser video decoders choose the actual presentation frame. Eight-count markers are manual BPM plus downbeat offset; `player/timing.ts` contains all calculations.

Mirroring reflects video presentation and the parent 3D group once around X. Landmark indices and joint labels remain anatomical. It is independent of camera selection and playback state.

## Persistence and boundaries

IndexedDB keys include source sampled-content SHA-256, analysis FPS, model and smoothing flag. Fingerprints hash the first / last 1MiB plus file size: useful accidental mismatch detection, **not** a full-file cryptographic guarantee. No original video is cached. Practice changes persist separately in localStorage by source fingerprint and are merged into JSON exports. Cache deletion leaves the current session and saved practice intact.

`motion/storage.ts` validates schema, coordinate convention, finite coordinates, confidence, frame ordering, source limits, joint counts and practice bounds before imported data enters the renderer. It checks source fingerprint, dimensions and duration. Browser storage denial or quota exhaustion does not discard a successful analysis; JSON export remains available.

Future Python / GPU backends can output the same documented canonical schema. Replace only the producer; the player, loop tools, cache and views remain reusable.
