// Self-host a pinned WASM runtime and Google's Apache-2.0 model assets.
import { cp, mkdir, access, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import { createHash } from "node:crypto";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(path.join(root, "public/wasm"), { recursive: true });
await mkdir(path.join(root, "public/models"), { recursive: true });
await cp(
  path.join(root, "node_modules/@mediapipe/tasks-vision/wasm"),
  path.join(root, "public/wasm"),
  { recursive: true },
);
// MediaPipe's WASM loader calls importScripts; use a bundled CLASSIC worker.
await build({
  entryPoints: [path.join(root, "src/analysis/pose.worker.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile: path.join(root, "public/pose-worker.js"),
  minify: true,
});
const models = {
  lite: {
    file: "pose_landmarker_lite.task",
    url: "pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
    hash: "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a",
  },
  full: {
    file: "pose_landmarker_full.task",
    url: "pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
    hash: "4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad",
  },
  hand: {
    file: "hand_landmarker.task",
    url: "hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    hash: "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1",
  },
};
const verify = (bytes, quality) => {
  if (createHash("sha256").update(bytes).digest("hex") !== models[quality].hash)
    throw new Error(`Invalid ${quality} model checksum`);
};
if (!process.argv.includes("--wasm-only")) {
  for (const quality of Object.keys(models)) {
    const target = path.join(root, "public/models", models[quality].file);
    try {
      await access(target);
      verify(await readFile(target), quality);
      console.log(`${quality} model verified`);
      continue;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const url = `https://storage.googleapis.com/mediapipe-models/${models[quality].url}`;
    // Node 24's fetch honors the environment proxy with NODE_USE_ENV_PROXY=1.
    // Actions has ordinary outbound access; managed sessions can supply local models.
    console.log(`Downloading Google MediaPipe ${quality} model`);
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok)
      throw new Error(`Model download failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    verify(bytes, quality);
    await writeFile(target, bytes);
  }
}
console.log("MediaPipe assets ready");
