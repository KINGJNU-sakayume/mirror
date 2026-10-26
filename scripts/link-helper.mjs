#!/usr/bin/env node
/**
 * FORM link helper — 내 PC에서만 실행하는 작은 로컬 서버.
 *
 * 앱이 유튜브 / 숏츠 / 릴스 링크를 넘기면 yt-dlp 로 영상을 임시 폴더에 받아
 * http://127.0.0.1 로 앱에 돌려줍니다. 받은 파일은 15분 뒤 또는 종료 시 삭제됩니다.
 * 앱 호스팅 서버(GitHub Pages 등)로는 아무것도 전송되지 않습니다.
 *
 * 사전 준비:  pip install -U yt-dlp   그리고   ffmpeg 설치
 * 실행:       npm run helper
 *
 * 환경 변수
 *   FORM_HELPER_PORT          기본 8765
 *   FORM_HELPER_COOKIES_FROM  chrome | firefox | edge | safari  (로그인이 필요한 영상용)
 *   FORM_HELPER_ORIGINS       허용할 앱 주소를 쉼표로 추가 (예: https://myname.github.io)
 *   YTDLP_PATH                yt-dlp 실행 파일 경로
 *
 * 처리 권한이 있는 영상에만 사용하세요. 플랫폼 약관과 저작권 준수 책임은 사용자에게 있습니다.
 */
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, rmSync } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = Number(process.env.FORM_HELPER_PORT || 8765);
const HOST = "127.0.0.1";
const MAX_BYTES = 200 * 1024 * 1024; // 앱의 직접 URL 한도와 동일
const MAX_SECONDS = 600; // 앱의 분석 한도(10분)와 동일
const JOB_TTL_MS = 15 * 60 * 1000;
const YTDLP = process.env.YTDLP_PATH || "yt-dlp";
const COOKIES_FROM = (process.env.FORM_HELPER_COOKIES_FROM || "").trim();
const ALLOWED_BROWSERS = ["chrome", "chromium", "edge", "firefox", "safari", "brave", "opera"];

const extraOrigins = (process.env.FORM_HELPER_ORIGINS || "")
  .split(",")
  .map((s) => s.trim().replace(/\/$/, ""))
  .filter(Boolean);
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d{2,5}$/;
const originAllowed = (origin) =>
  LOCAL_ORIGIN.test(origin) || extraOrigins.includes(origin);

const VIDEO_HOSTS = new Set([
  "youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "youtu.be",
  "instagram.com", "m.instagram.com",
]);

/** 앱이 정규화한 유튜브 / 인스타그램 주소만 받습니다. 임의 URL 은 거부합니다. */
export function validateVideoUrl(value) {
  let u;
  try {
    u = new URL(String(value).trim());
  } catch {
    throw new Error("올바른 주소가 아닙니다.");
  }
  if (u.protocol !== "https:" || u.username || u.password)
    throw new Error("https 영상 링크만 사용할 수 있습니다.");
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (!VIDEO_HOSTS.has(host))
    throw new Error("유튜브 / 숏츠 / 인스타그램 링크만 지원합니다.");
  if (u.href.length > 2048) throw new Error("주소가 너무 깁니다.");
  u.hash = "";
  return u.href;
}

const jobs = new Map();
let activeJob = null;

function tail(text, n = 600) {
  return text.length > n ? text.slice(-n) : text;
}

function explain(stderr) {
  const t = stderr.toLowerCase();
  if (t.includes("sign in to confirm") || t.includes("not a bot"))
    return "유튜브가 로그인을 요구합니다. FORM_HELPER_COOKIES_FROM=chrome 처럼 브라우저 쿠키를 지정해 헬퍼를 다시 실행하세요.";
  if (t.includes("login required") || t.includes("rate-limit reached") || t.includes("instagram"))
    return "인스타그램은 로그인이 필요할 수 있습니다. FORM_HELPER_COOKIES_FROM=chrome 으로 헬퍼를 다시 실행하세요.";
  if (t.includes("private video") || t.includes("members-only"))
    return "비공개 또는 멤버 전용 영상입니다.";
  if (t.includes("does not pass filter") || t.includes("duration"))
    return `영상이 ${MAX_SECONDS / 60}분을 넘습니다. 짧은 구간 영상을 사용하세요.`;
  if (t.includes("larger than max-filesize") || t.includes("max-filesize"))
    return "영상이 200MB를 넘습니다.";
  if (t.includes("ffmpeg") && (t.includes("not found") || t.includes("not installed")))
    return "ffmpeg 가 필요합니다. ffmpeg 를 설치한 뒤 다시 시도하세요.";
  return "영상을 받지 못했습니다. yt-dlp 를 최신 버전으로 업데이트(pip install -U yt-dlp)한 뒤 다시 시도하세요.";
}

async function runJob(job, url) {
  job.dir = await mkdtemp(path.join(tmpdir(), "form-helper-"));
  job.state = "downloading";
  const args = [
    "--no-playlist",
    "--no-warnings",
    "--newline",
    "--max-filesize", String(MAX_BYTES),
    "--match-filter", `duration <=? ${MAX_SECONDS}`,
    // 분석은 최대 960px 로 줄여 쓰므로 720p 로 제한해 용량과 시간을 아낍니다.
    "-f", "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/b[height<=720]/b",
    "--merge-output-format", "mp4",
    "-o", path.join(job.dir, "video.%(ext)s"),
  ];
  if (ALLOWED_BROWSERS.includes(COOKIES_FROM)) args.push("--cookies-from-browser", COOKIES_FROM);
  args.push("--", url);

  let stderr = "";
  const child = spawn(YTDLP, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
  job.child = child;

  const onLine = (line) => {
    const m = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(line);
    if (m) job.percent = Math.min(99, Number(m[1]));
    if (line.includes("[Merger]") || line.includes("[ExtractAudio]")) job.message = "영상과 음성을 합치는 중";
  };
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    lines.forEach(onLine);
  });
  child.stderr.on("data", (d) => {
    stderr = tail(stderr + d.toString(), 4000);
  });

  await new Promise((resolve) => {
    child.on("error", (err) => {
      stderr += `\n${err.code === "ENOENT" ? "yt-dlp not found" : err.message}`;
      resolve();
    });
    child.on("close", (code) => {
      job.exitCode = code;
      resolve();
    });
  });
  job.child = null;
  if (job.state === "cancelled") return;

  if (job.exitCode !== 0) {
    job.state = "error";
    job.error = stderr.includes("yt-dlp not found")
      ? "yt-dlp 를 찾을 수 없습니다. pip install -U yt-dlp 로 설치하세요."
      : explain(stderr);
    return;
  }
  const files = (await readdir(job.dir)).filter((f) => /\.(mp4|webm|mkv)$/i.test(f));
  if (!files.length) {
    job.state = "error";
    job.error = "받은 영상 파일을 찾지 못했습니다.";
    return;
  }
  const file = path.join(job.dir, files[0]);
  const info = await stat(file);
  if (info.size > MAX_BYTES) {
    job.state = "error";
    job.error = "영상이 200MB를 넘습니다.";
    return;
  }
  job.file = file;
  job.size = info.size;
  job.type = file.endsWith(".webm") ? "video/webm" : file.endsWith(".mkv") ? "video/x-matroska" : "video/mp4";
  job.percent = 100;
  job.state = "done";
}

async function destroyJob(job) {
  job.state = job.state === "done" ? "expired" : "cancelled";
  job.child?.kill("SIGKILL");
  if (job.dir) await rm(job.dir, { recursive: true, force: true }).catch(() => {});
  jobs.delete(job.id);
  if (activeJob === job) activeJob = null;
}

setInterval(() => {
  const now = Date.now();
  for (const job of jobs.values()) if (now - job.created > JOB_TTL_MS) void destroyJob(job);
}, 60_000).unref();

function cleanupAllSync() {
  for (const job of jobs.values()) {
    try { job.child?.kill("SIGKILL"); } catch {}
    if (job.dir) try { rmSync(job.dir, { recursive: true, force: true }); } catch {}
  }
}
process.on("exit", cleanupAllSync);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(0));

// ------------------------------------------------------------------ HTTP
function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && originAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    // https 앱 페이지가 localhost 로 요청할 때 Chrome 의 사설망 접근 사전 확인에 응답
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    res.setHeader("Access-Control-Max-Age", "600");
  }
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function readJson(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("요청이 너무 큽니다.")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || "{}")); }
      catch { reject(new Error("JSON 형식이 아닙니다.")); }
    });
    req.on("error", reject);
  });
}

let ytdlpVersion = null;
function probeTools() {
  const y = spawnSync(YTDLP, ["--version"], { encoding: "utf8" });
  ytdlpVersion = y.status === 0 ? y.stdout.trim() : null;
  const f = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  return { ytdlp: ytdlpVersion, ffmpeg: f.status === 0 };
}

const server = http.createServer(async (req, res) => {
  try {
    // DNS rebinding 방지: Host 가 로컬 주소가 아니면 거부
    const hostHeader = String(req.headers.host || "");
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(hostHeader)) return send(res, 403, { error: "forbidden host" });
    const origin = req.headers.origin;
    if (origin && !originAllowed(origin)) return send(res, 403, { error: "이 앱 주소는 허용되지 않았습니다. FORM_HELPER_ORIGINS 로 추가하세요." });
    cors(req, res);
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

    const url = new URL(req.url || "/", `http://${HOST}`);
    const parts = url.pathname.split("/").filter(Boolean);

    if (req.method === "GET" && url.pathname === "/health") {
      const tools = probeTools();
      return send(res, 200, { ok: true, name: "form-helper", version: 1, ...tools, cookies: ALLOWED_BROWSERS.includes(COOKIES_FROM) ? COOKIES_FROM : null });
    }

    if (req.method === "POST" && url.pathname === "/jobs") {
      if (activeJob && (activeJob.state === "queued" || activeJob.state === "downloading"))
        return send(res, 429, { error: "이미 다른 영상을 받는 중입니다." });
      const body = await readJson(req);
      let target;
      try { target = validateVideoUrl(body.url); }
      catch (e) { return send(res, 400, { error: e.message }); }
      const job = { id: randomUUID(), state: "queued", percent: 0, message: "", created: Date.now(), dir: null, file: null, size: 0, child: null };
      jobs.set(job.id, job);
      activeJob = job;
      runJob(job, target).catch((e) => { job.state = "error"; job.error = e.message; });
      return send(res, 202, { id: job.id });
    }

    if (parts[0] === "jobs" && parts[1]) {
      const job = jobs.get(parts[1]);
      if (!job) return send(res, 404, { error: "작업을 찾을 수 없습니다." });

      if (req.method === "GET" && parts.length === 2)
        return send(res, 200, { state: job.state, percent: job.percent, message: job.message, size: job.size, error: job.error });

      if (req.method === "GET" && parts[2] === "file") {
        if (job.state !== "done" || !job.file) return send(res, 409, { error: "아직 준비되지 않았습니다." });
        res.writeHead(200, { "Content-Type": job.type, "Content-Length": job.size, "Cache-Control": "no-store" });
        createReadStream(job.file).pipe(res);
        return;
      }

      if (req.method === "DELETE" && parts.length === 2) {
        await destroyJob(job);
        return send(res, 200, { ok: true });
      }
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    if (!res.headersSent) send(res, 500, { error: e instanceof Error ? e.message : "server error" });
    else res.end();
  }
});

// 테스트에서 import 할 때는 서버를 시작하지 않습니다.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("link-helper.mjs")) {
  const tools = probeTools();
  server.listen(PORT, HOST, () => {
    console.log(`FORM link helper  →  http://${HOST}:${PORT}`);
    console.log(`  yt-dlp : ${tools.ytdlp ?? "없음  (pip install -U yt-dlp)"}`);
    console.log(`  ffmpeg : ${tools.ffmpeg ? "있음" : "없음  (영상+음성 합치기에 필요)"}`);
    console.log(`  쿠키   : ${ALLOWED_BROWSERS.includes(COOKIES_FROM) ? COOKIES_FROM : "사용 안 함 (FORM_HELPER_COOKIES_FROM=chrome)"}`);
    console.log("앱의 '링크로 분석'에서 유튜브/릴스 링크를 넣으면 자동으로 받아 분석합니다. 종료: Ctrl+C");
  });
  server.on("error", (e) => {
    console.error(e.code === "EADDRINUSE" ? `포트 ${PORT} 가 이미 사용 중입니다. 헬퍼가 이미 실행 중일 수 있습니다.` : e.message);
    process.exit(1);
  });
}
