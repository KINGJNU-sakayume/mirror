import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
import crypto from "node:crypto";
const videoPath = process.env.FORM_TEST_VIDEO;
if (!videoPath)
  throw new Error(
    "Set FORM_TEST_VIDEO to an authorized moving single-person video, at least 4 seconds long.",
  );
fs.mkdirSync("work", { recursive: true });
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
(async () => {
  const browser = await chromium.launch({
    ...(process.env.FORM_BROWSER_PATH
      ? { executablePath: process.env.FORM_BROWSER_PATH }
      : {}),
    headless: true,
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.stack));
  page.on("console", (m) => {
    if (m.type() === "info" && m.text().includes("Worker unavailable"))
      console.log("FALLBACK", m.text());
  });
  await page.goto(process.env.FORM_TEST_URL || "http://127.0.0.1:5173/");
  await page
    .getByLabel("로컬 영상 파일", { exact: true })
    .setInputFiles(videoPath);
  if (process.env.FORM_TEST_MOTION) {
    await page.getByRole("button", { name: "연습 설정", exact: true }).click();
    await page
      .getByLabel("모션 JSON 파일", { exact: true })
      .setInputFiles(process.env.FORM_TEST_MOTION);
    await page.getByRole("button", { name: "설정 닫기" }).click();
  } else {
    await page.getByRole("button", { name: "동작 분석 시작" }).click();
  }
  await page.waitForFunction(
    () => !document.querySelector(".analysis-progress"),
    {},
    { timeout: 120000 },
  );
  assert.equal(
    await page.locator(".error-message").count(),
    0,
    await page.locator(".error-message").allTextContents(),
  );
  await page.getByRole("button", { name: "연습 설정", exact: true }).click();
  const report = await page.locator(".analysis-report").textContent();
  assert(report.includes("Web Worker"), report);
  console.log("REPORT", report);
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "모션 JSON 내보내기", exact: true })
    .click();
  const download = await downloadPromise;
  await download.saveAs("work/analyzed-motion.json");
  const motion = JSON.parse(
    fs.readFileSync("work/analyzed-motion.json", "utf8"),
  );
  assert.equal(motion.schema, "form.motion");
  assert(motion.source.duration >= 4);
  assert.equal(
    motion.frames.length,
    Math.ceil(motion.source.duration * motion.processing.fps),
  );
  assert(motion.statistics.detected > motion.frames.length * 0.5);
  assert(motion.frames[0].image.length === 33);
  assert(motion.frames[0].world.length === 33);
  const ys = motion.frames
    .filter((f) => f.joints[15])
    .map((f) => f.joints[15].position[1]);
  assert(Math.max(...ys) - Math.min(...ys) > 0.1, "real movement must vary");
  console.log("REAL_MOTION", {
    frames: motion.frames.length,
    detected: motion.statistics.detected,
    wristTravel: Math.max(...ys) - Math.min(...ys),
    engine: motion.processing.engine,
  });
  await page.getByRole("button", { name: "설정 닫기" }).click();
  const seek = async (time) => {
    await page.getByLabel("재생 위치", { exact: true }).fill(String(time));
    await page.waitForFunction(
      (t) => Math.abs(document.querySelector("video").currentTime - t) < 0.02,
      time,
    );
    await page.waitForTimeout(150);
  };
  await seek(3);
  assert(await page.locator("video").evaluate((v) => v.paused));

  await page.getByRole("button", { name: "정면", exact: true }).click();
  await page.waitForTimeout(500);
  const front = await page.locator(".stage-canvas canvas").screenshot();
  await page.getByRole("button", { name: "후면", exact: true }).click();
  await page.waitForTimeout(500);
  const back = await page.locator(".stage-canvas canvas").screenshot();
  assert.notEqual(hash(front), hash(back));
  await page.getByRole("button", { name: "마네킹", exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "work/mannequin-desktop.png", fullPage: true });
  const avatar = await page.locator(".stage-canvas canvas").screenshot();
  assert.notEqual(hash(avatar), hash(back));
  await page.getByRole("button", { name: "스켈레톤", exact: true }).click();
  await page.getByRole("button", { name: "미러", exact: true }).click();
  assert(
    await page
      .locator(".video-layer")
      .evaluate((e) => e.classList.contains("mirrored")),
  );
  assert.equal(
    await page
      .getByRole("button", { name: "후면", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.getByRole("button", { name: "미러", exact: true }).click();
  await page.getByRole("button", { name: "다음 프레임", exact: true }).click();
  assert(
    Math.abs(
      (await page.locator("video").evaluate((v) => v.currentTime)) -
        (3 + 1 / 30),
    ) < 0.01,
  );
  await page.getByLabel("재생 속도").selectOption("0.5");
  await page.getByRole("button", { name: "재생", exact: true }).click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "일시정지", exact: true }).click();
  const t = await page.locator("video").evaluate((v) => v.currentTime);
  assert(t > 3.1 && t < 3.7, `speed clock ${t}`);
  const paused = await page.locator(".stage-canvas canvas").screenshot();
  await page.waitForTimeout(250);
  const paused2 = await page.locator(".stage-canvas canvas").screenshot();
  assert.equal(hash(paused), hash(paused2), "paused stage must not animate");
  await page.getByLabel("반복 시작 A (초)", { exact: true }).fill("1");
  await page.getByLabel("반복 끝 B (초)", { exact: true }).fill("2");
  await page.getByLabel("연습 구간 이름", { exact: true }).fill("무릎 연습");
  await page.getByRole("button", { name: "구간 저장", exact: true }).click();
  assert.equal(await page.locator(".saved-segments>div").count(), 1);
  await page
    .getByRole("button", { name: "A-B 구간 반복", exact: true })
    .click();
  await page.getByLabel("재생 속도").selectOption("1.5");
  await seek(1.8);
  await page.getByRole("button", { name: "재생", exact: true }).click();
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "일시정지", exact: true }).click();
  const loopTime = await page.locator("video").evaluate((v) => v.currentTime);
  assert(loopTime >= 1 && loopTime < 2, `loop ${loopTime}`);
  await page
    .getByRole("button", { name: "A-B 구간 반복", exact: true })
    .click();
  await page
    .getByRole("button", { name: "이 8카운트 반복", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "A-B 구간 반복", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.getByRole("button", { name: "연습 설정", exact: true }).click();
  await page.getByRole("checkbox", { name: "원근 왜곡 없는 정사영" }).check();
  await page.getByRole("button", { name: "설정 닫기" }).click();
  await page.waitForTimeout(500);
  assert.equal(errors.length, 0, errors.join("\n"));
  await page.getByRole("button", { name: "영상", exact: true }).click();
  assert(await page.locator(".stage-viewer").isHidden());
  assert(await page.locator("video").isVisible());
  await page.getByRole("button", { name: "3D", exact: true }).click();
  assert(await page.locator(".video-viewer").isHidden());
  assert(await page.locator(".stage-viewer").isVisible());
  await page.getByRole("button", { name: "나란히", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: "work/analyzed-mobile.png", fullPage: true });
  assert(
    await page.locator("body").evaluate((e) => e.scrollWidth <= innerWidth),
    "mobile overflow",
  );
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await page.screenshot({ path: "work/focus-mobile.png", fullPage: true });
  console.log(
    "BROWSER_CHECKS",
    "seek, camera front/back, rig, mirror, frame-step, speed, pause, A-B, save segment, eight-count loop, orthographic, layouts, mobile all passed",
  );
  console.log("PAGE_ERRORS", errors);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
