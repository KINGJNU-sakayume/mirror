// Chromium capture auto-selection flags below apply only to this isolated QA browser. The app always uses the native permission prompt.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
const videoPath = process.env.FORM_TEST_VIDEO;
if (!videoPath)
  throw new Error("Set FORM_TEST_VIDEO to an authorized single-person video.");
fs.mkdirSync("work", { recursive: true });
fs.copyFileSync(videoPath, "work/linked-browser-fixture.mp4");
fs.copyFileSync(
  process.env.FORM_CAPTURE_VIDEO || videoPath,
  "work/capture-browser-fixture.mp4",
);
const testBase = process.env.FORM_TEST_URL || "http://127.0.0.1:5173/";
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
      "--auto-select-tab-capture-source-by-title=FORM capture test source",
      "--allow-http-screen-capture",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("XNNPACK"))
      console.log("BROWSER", m.text().slice(0, 200));
  });
  await page.goto(testBase);
  await page.getByRole("button", { name: "링크로 분석", exact: true }).click();
  await page
    .getByLabel("영상 링크", { exact: true })
    .fill(new URL("work/linked-browser-fixture.mp4", testBase).href);
  await page.getByRole("button", { name: "연결", exact: true }).click();
  await page
    .getByRole("button", { name: "주소에서 바로 분석", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(
    () =>
      !document.querySelector(".analysis-progress") &&
      !!document.querySelector(".tracking-lane .tracked"),
    {},
    { timeout: 120000 },
  );
  assert.equal(
    await page.locator(".error-message").count(),
    0,
    await page.locator(".error-message").allTextContents(),
  );
  await page.getByRole("button", { name: "연습 설정", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "모션 JSON 내보내기", exact: true })
    .click();
  await (await downloadPromise).saveAs("work/linked-motion.json");
  const data = JSON.parse(fs.readFileSync("work/linked-motion.json", "utf8"));
  assert.equal(data.source.origin.kind, "direct-url");
  assert.equal(
    data.frames.length,
    Math.ceil(data.source.duration * data.processing.fps),
  );
  assert(data.statistics.detected > data.frames.length * 0.5);
  assert.equal(data.processing.refinement, true);
  assert(data.processing.refinementReport);
  console.log("DIRECT_URL_REAL_ANALYSIS", {
    frames: data.frames.length,
    detected: data.statistics.detected,
    refinement: data.processing.refinementReport,
  });
  const toggle = page.getByRole("checkbox", {
    name: "발 접지 추정 · IK · 관절각 제약",
  });
  await toggle.uncheck();
  assert.equal(
    await page
      .locator(".analysis-report")
      .filter({ hasText: "최대 발 조정량" })
      .count(),
    0,
  );
  await toggle.check();
  await page.getByRole("button", { name: "설정 닫기" }).click();
  await page.getByRole("button", { name: "링크로 분석", exact: true }).click();
  await page
    .getByLabel("영상 링크", { exact: true })
    .fill("https://www.youtube.com/shorts/M7lc1UVf-VE");
  await page.getByRole("button", { name: "연결", exact: true }).click();
  assert(
    (await page.locator(".link-embed iframe").getAttribute("src")).includes(
      "/embed/M7lc1UVf-VE",
    ),
  );
  await page.screenshot({ path: "work/link-social.png", fullPage: true });
  await page.getByRole("button", { name: "링크 분석 닫기" }).click();
  const capturePage = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  await capturePage.setContent(
    '<html><head><title>FORM capture test source</title></head><body style="margin:0;background:black"><video src="' +
      new URL("work/capture-browser-fixture.mp4", testBase).href +
      '" autoplay muted loop playsinline style="width:100vw;height:100vh;object-fit:contain"></video></body></html>',
  );
  await capturePage.waitForFunction(
    () => document.querySelector("video").readyState >= 2,
  );
  await page.bringToFront();
  await page.getByRole("button", { name: "링크로 분석", exact: true }).click();
  await page
    .getByLabel("영상 링크", { exact: true })
    .fill(new URL("work/capture-browser-fixture.mp4", testBase).href);
  await page.getByRole("button", { name: "연결", exact: true }).click();
  await page.getByRole("button", { name: "영상 탭 공유", exact: true }).click();
  await page.locator(".capture-region").waitFor({ timeout: 15000 });
  console.log("NATIVE_TAB_CAPTURE_OPENED");
  const crop = await capturePage.locator("video").evaluate((v) => {
    const scale = Math.min(1280 / v.videoWidth, 720 / v.videoHeight);
    const width = v.videoWidth * scale,
      height = v.videoHeight * scale;
    return {
      x: ((1280 - width) / 1280) * 50,
      y: ((720 - height) / 720) * 50,
      width: (width / 1280) * 100,
      height: (height / 720) * 100,
    };
  });
  for (const [key, label] of [
    ["x", "X"],
    ["y", "Y"],
    ["width", "너비"],
    ["height", "높이"],
  ])
    await page
      .getByLabel("분석 영역 " + label, { exact: true })
      .fill(String(crop[key]));
  await page
    .getByRole("button", { name: "이 영역 녹화 후 3D 분석", exact: true })
    .click();
  await page.waitForTimeout(3300);
  await page
    .getByRole("button", { name: "녹화 마치고 분석", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 20000 });
  await page.waitForFunction(
    () =>
      !document.querySelector(".analysis-progress") &&
      !!document.querySelector(".tracking-lane .tracked"),
    {},
    { timeout: 120000 },
  );
  assert.equal(
    await page.locator(".error-message").count(),
    0,
    await page.locator(".error-message").allTextContents(),
  );
  await page.getByRole("button", { name: "연습 설정", exact: true }).click();
  const dp = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "모션 JSON 내보내기", exact: true })
    .click();
  await (await dp).saveAs("work/captured-motion.json");
  const captured = JSON.parse(
    fs.readFileSync("work/captured-motion.json", "utf8"),
  );
  assert.equal(captured.source.origin.kind, "tab-capture");
  assert(captured.statistics.detected > 10);
  assert(captured.source.duration > 2);
  console.log("NATIVE_CAPTURE_REAL_ANALYSIS", {
    source: captured.source,
    frames: captured.frames.length,
    detected: captured.statistics.detected,
  });
  assert.equal(errors.length, 0, errors.join());
  await page.getByRole("button", { name: "설정 닫기" }).click();
  await page.screenshot({ path: "work/captured-studio.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "링크로 분석", exact: true }).click();
  await page.screenshot({ path: "work/link-mobile.png", fullPage: true });
  assert(
    await page.locator("body").evaluate((e) => e.scrollWidth <= innerWidth),
  );
  console.log("LINK_BROWSER_CHECKS_PASS", errors);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
