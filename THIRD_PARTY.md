# Third-party assets and notices

## MediaPipe Pose Landmarker

Google / The MediaPipe Authors, **Apache License 2.0**. Model card / model distribution references:

- https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker
- https://github.com/google-ai-edge/mediapipe
- https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf

Models are Google's version 1 float16 Tasks bundles, redistributed unchanged under `public/models/`. The source URLs used by the reproducible setup script are:

- https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
- https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task

| Asset | Size | SHA-256 |
| --- | ---: | --- |
| `pose_landmarker_lite.task` | 5,777,746 bytes | `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` |
| `pose_landmarker_full.task` | 9,398,198 bytes | `4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad` |

The managed development network allowed GitHub and restricted Google storage. The initial copies were obtained from existing GitHub redistributions and pinned by the checksums above:

- https://github.com/i-hmzakhan/PoseEstimationModule/blob/main/pose_landmarker_lite.task
- https://github.com/preyashyadav/toddle-ai/blob/main/app/src/main/assets/pose_landmarker_full.task

No code from those repositories is included. Model attribution remains with Google. The original license text is included at `public/models/LICENSE`. The model loader verifies the checksums and fails on modifications. `@mediapipe/tasks-vision` is fixed to 0.10.21, including generated matching WASM / loader and bundled classic worker; generated files are copied from that exact installed package during setup. They are deployed with the app, not fetched from a third-party CDN at analysis time.

## Other dependencies

Dependency licenses remain with their authors: React (MIT), Vite (MIT), TypeScript (Apache-2.0), Three.js (MIT), Tailwind CSS (MIT), esbuild (MIT), Vitest (MIT), Lucide icons (ISC), fix-webm-duration 1.0.6 (MIT, https://github.com/yusitnikov/fix-webm-duration) for local recorded-clip duration metadata. See their npm package license files and `package-lock.json` for exact versions. No font binaries are bundled; the UI uses installed system fonts.

## Original character and media

The neutral 21-bone skinned mannequin and favicon are original programmatic assets authored for this project. There are no external humanoid / Mixamo / VRM models, K-POP recordings, commercial music or sample choreography assets in the shipped application.

Development-only inference verification used `pose.jpg` and `pose_squats.mp4` from TensorFlow's Apache-2.0 `tfjs-models/pose-detection/test_data`. These are kept outside version control and are not included in application builds or the repository.

The complete fix-webm-duration MIT notice is redistributed at `public/THIRD_PARTY_NOTICES.txt`.
