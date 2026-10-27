# Architecture

## Data flow

```text
Direct URL → bounded CORS fetch → File
Social URL → native tab share → crop → MediaRecorder → duration repair → File
Social URL → local helper (127.0.0.1, yt-dlp) → job poll → mp4 → File
Local File → object URL → inspectVideo / fingerprint
                        ↘ visible HTMLVideoElement → playback clock
                        ↘ separate muted decoder → chronological seeks
                            → max 1280px 2D canvas → transferable ImageBitmap
                            → classic Web Worker → PoseLandmarker.detectForVideo (≤3 people)
                            → DancerTracker picks one identity
                            → per-side wrist crop 256² → HandLandmarker.detectForVideo
                            → RawFrame[] → preprocess → MotionData → IndexedDB
                                                             ↘ JSON export/import
Visible video.currentTime → sampleMotion(timestamp)
                          → image landmarks → 2D overlay
                          → canonical 3D joints → skeleton / mannequin rig
```

`analysis/video.ts` inspects metadata, creates a sampled-content identity and waits for decoded seek frames. The decoder never changes the playback element. Inference timestamps are the requested source-frame times in milliseconds, strictly increasing within a fresh VIDEO landmarker instance. Repeated source frames (e.g. 5fps source, 15fps sampling) remain repeated observations, not extra real temporal detail.

`analysis/estimator.ts` pins CPU inference and asks for up to three poses. `DancerTracker` starts with the largest visible person and then keeps the candidate nearest the previous hip center; if nobody is within 0.2 normalized units for 0.5 seconds' memory it reports a miss instead of switching identities. It preserves that person's raw normalized image landmarks, hip-relative world estimates and confidence.

Finger detail: at full-frame analysis resolution a hand is only a few dozen pixels wide, so `handRegion` builds a square crop per anatomical side from the pose wrist / pinky / index / thumb (size ≥ 3.4× wrist-to-knuckle reach and ≥ 0.6× shoulder width), resamples it to 256×256 and runs one VIDEO-mode `HandLandmarker` per side. `uncropHand` maps results back to full-frame normalized coordinates and rejects a detection whose wrist does not start at that side's pose wrist (the other hand inside the crop). Side assignment comes from the pose, not MediaPipe's handedness label. No network requests send video, pixels or landmarks. App / model / runtime assets are served from the app origin. MediaPipe upstream behavior is governed by its license / upstream privacy terms; FORM itself contains no analytics or upload endpoint.

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

Estimated root X follows image hip movement; estimated depth follows apparent body size. These are labeled approximate. Stationary presentation discards these translations. The optional refinement stage adds contact-aware pelvis-height compensation, anatomical folding limits and closed-form two-bone foot IK. See [refinement](refinement.md). Original observations remain unchanged.

`sampleMotion` binary-searches actual timestamps and interpolates valid pairs. It refuses long intervals or unavailable joints. Neither speed nor a wall-clock animation phase is used.

## Rendering and retargeting

`scene/Stage.tsx` owns one Three.js renderer, scene, perspective and orthographic cameras, orbit controls, primitives and ray picking. It reads the current visible video's clock every render. Camera state is independent of dancer motion. Presets show actual 3D points. All camera / geometry / material / skeleton resources are disposed on unmount or replacement.

`scene/mannequin.ts` authors an original 47-bone T-pose humanoid (hips, spine, chest, neck, head; per side upper arm, forearm, hand, 5×3 finger bones, thigh, shin, foot). One indexed mesh is lofted from elliptical cross-sections — torso, limbs with muscle profiles, palm, fingers, shoe — plus head ellipsoids (skull, jaw, nose, ears, eyes, hair coloring) so facing direction is readable. Joint zones blend parent/child skin weights smoothly; vertex colors separate skin, shirt, pants and shoes, with a left wristband / left shoe accent. The rig's left/right arm and leg lengths are calibrated from clip medians. Its torso length, shoulder width and pelvis width are also calibrated from clip medians.

Pelvis (hip axis) and thorax (shoulder axis) bases are solved separately; the spine takes half of the difference, reproducing waist twist and side bend. Ears and nose orient the head (clamped to ~80° from the chest), the neck takes 40%. Limbs use a full aim + secondary basis: the elbow / knee bend plane fixes upper-arm / thigh twist, the back-of-hand normal (hand knuckles, else pose index / pinky) fixes forearm and hand roll, heel→toe fixes shin and foot. Finger bones swing from their parent toward observed segment directions; without finger evidence the hand keeps a relaxed curl. Multiplying by the inverse parent-world rotation yields the bone-local rotation. Source-frame quaternions are spherically interpolated by source timestamp. Seeks are deterministic and never accumulate per-render smoothing delay. Missing required torso data hides the rig; missing limb data hides its corresponding branch. Twist is inferred from bend planes and the hand plane, so it is ambiguous on fully straight limbs without hand evidence; gaze and facial expression are not modeled. Upstream broad angle constraints and approximate contact IK do not establish ground-truth contact or physical articulation. Skeleton mode is always available for inspecting the underlying evidence.

## Playback and practice

`player/usePlayback.ts` is the only transport controller. The visible video is the clock authority. `requestVideoFrameCallback`, RAF and media seek / play / pause events keep the shared clock current without another animation time. A–B enforcement happens before rendering; the video is sought to A, then all views evaluate A. Media seek precision and refresh scheduling bound loop accuracy.

Frame-step is explicitly 1/30 second because HTML video metadata does not reveal reliable source FPS. Browser video decoders choose the actual presentation frame. Eight-count markers are manual BPM plus downbeat offset; `player/timing.ts` contains all calculations.

Mirroring reflects video presentation and the parent 3D group once around X. Landmark indices and joint labels remain anatomical. It is independent of camera selection and playback state.

## Persistence and boundaries

IndexedDB keys include source sampled-content SHA-256, analysis FPS, model, smoothing flag and refinement setting / revision. Fingerprints hash the first / last 1MiB plus file size: useful accidental mismatch detection, **not** a full-file cryptographic guarantee. No original video is cached. Tab captures are bounded, retained only in session memory, and all capture tracks are stopped on completion or cancellation. Practice changes persist separately in localStorage by source fingerprint and are merged into JSON exports. Cache deletion leaves the current session and saved practice intact.

`motion/storage.ts` validates schema, coordinate convention, finite coordinates, confidence, frame ordering, source limits, joint counts and practice bounds before imported data enters the renderer. It checks source fingerprint, dimensions and duration. Browser storage denial or quota exhaustion does not discard a successful analysis; JSON export remains available.

Future Python / GPU backends can output the same documented canonical schema. Replace only the producer; the player, loop tools, cache and views remain reusable.
