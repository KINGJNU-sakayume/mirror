import fixWebmDuration from "fix-webm-duration";
export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function clampRect(rect: CaptureRect): CaptureRect {
  const x = Math.max(0, Math.min(1, rect.x)),
    y = Math.max(0, Math.min(1, rect.y));
  return {
    x,
    y,
    width: Math.max(0, Math.min(1 - x, rect.width)),
    height: Math.max(0, Math.min(1 - y, rect.height)),
  };
}
export class TabCapture {
  readonly stream: MediaStream;
  readonly video: HTMLVideoElement;
  private recorder: MediaRecorder | null = null;
  private raf = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private constructor(stream: MediaStream, video: HTMLVideoElement) {
    this.stream = stream;
    this.video = video;
  }
  static async open(onEnded: () => void) {
    if (
      !window.isSecureContext ||
      !navigator.mediaDevices?.getDisplayMedia ||
      typeof MediaRecorder === "undefined"
    )
      throw new Error(
        "탭 분석은 HTTPS의 데스크톱 Chrome·Edge에서 지원됩니다. 이 기기에서는 직접 영상 URL이나 파일 가져오기를 사용해 주세요.",
      );
    // A native permission prompt is mandatory. Never auto-select or persist capture permission.
    const constraints = {
      video: { displaySurface: "browser", frameRate: { ideal: 30, max: 30 } },
      audio: true,
      selfBrowserSurface: "exclude",
      monitorTypeSurfaces: "exclude",
      surfaceSwitching: "exclude",
    } as DisplayMediaStreamOptions;
    const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("공유된 영상 탭을 찾지 못했습니다.");
    }
    if (
      track.getSettings().displaySurface &&
      track.getSettings().displaySurface !== "browser"
    ) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error(
        "전체 화면 대신 영상이 재생되는 브라우저 탭을 선택해 주세요.",
      );
    }
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    try {
      await video.play();
      if (!video.videoWidth)
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("공유 탭의 영상을 읽지 못했습니다.")),
            15000,
          );
          video.addEventListener(
            "loadeddata",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
    } catch (error) {
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      throw error;
    }
    const session = new TabCapture(stream, video);
    track.addEventListener(
      "ended",
      () => {
        session.stop();
        onEnded();
      },
      { once: true },
    );
    return session;
  }
  get width() {
    return this.video.videoWidth;
  }
  get height() {
    return this.video.videoHeight;
  }
  snapshot() {
    const c = document.createElement("canvas");
    c.width = Math.min(1280, this.width);
    c.height = Math.round((c.width * this.height) / this.width);
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("공유 탭의 이미지를 만들지 못했습니다.");
    ctx.drawImage(this.video, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  }
  record(
    rect: CaptureRect,
    onProgress: (seconds: number, bytes: number) => void,
  ): Promise<File> {
    if (this.disposed || this.recorder)
      throw new Error("탭 공유를 다시 시작해 주세요.");
    rect = clampRect(rect);
    if (rect.width * this.width < 80 || rect.height * this.height < 80)
      throw new Error("댄서의 전신이 포함되도록 더 넓은 영역을 선택해 주세요.");
    const canvas = document.createElement("canvas");
    const max = Math.max(rect.width * this.width, rect.height * this.height),
      scale = Math.min(1, 960 / max);
    canvas.width = Math.max(
      2,
      Math.floor((rect.width * this.width * scale) / 2) * 2,
    );
    canvas.height = Math.max(
      2,
      Math.floor((rect.height * this.height * scale) / 2) * 2,
    );
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("영상 영역을 읽을 수 없습니다.");
    const draw = () =>
      ctx.drawImage(
        this.video,
        rect.x * this.width,
        rect.y * this.height,
        rect.width * this.width,
        rect.height * this.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    draw();
    const output = canvas.captureStream(30);
    for (const audio of this.stream.getAudioTracks())
      output.addTrack(audio.clone());
    const mime = [
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp8",
      "video/webm",
      "video/mp4",
    ].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mime) {
      output.getTracks().forEach((t) => t.stop());
      throw new Error(
        "이 브라우저에서 탭 영상을 저장할 수 없습니다. 최신 Chrome·Edge를 사용해 주세요.",
      );
    }
    const recorder = new MediaRecorder(output, {
      mimeType: mime,
      videoBitsPerSecond: 2_500_000,
    });
    this.recorder = recorder;
    const chunks: Blob[] = [],
      start = performance.now();
    let bytes = 0,
      lastProgress = 0;
    return new Promise((resolve, reject) => {
      const clean = () => {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        if (this.raf && "cancelVideoFrameCallback" in this.video)
          this.video.cancelVideoFrameCallback(this.raf);
        output.getTracks().forEach((t) => t.stop());
      };
      const frame = () => {
        if (recorder.state !== "recording") return;
        draw();
        this.raf = this.video.requestVideoFrameCallback(frame);
      };
      recorder.ondataavailable = (e) => {
        if (e.data.size) {
          chunks.push(e.data);
          bytes += e.data.size;
          if (bytes > 150 * 1024 * 1024) this.stop();
        }
      };
      recorder.onerror = () => {
        clean();
        reject(
          new Error("공유 영상 녹화를 마치지 못했습니다. 다시 시도해 주세요."),
        );
      };
      recorder.onstop = async () => {
        clean();
        const ms = performance.now() - start;
        try {
          if (this.disposed)
            throw new DOMException("탭 분석을 취소했습니다.", "AbortError");
          if (ms < 500 || !bytes)
            throw new Error("0.5초 이상 영상을 재생한 다음 분석해 주세요.");
          let blob = new Blob(chunks, { type: mime });
          if (mime.includes("webm"))
            blob = await fixWebmDuration(blob, ms, { logger: false });
          resolve(
            new File(
              [blob],
              `linked-tab-${Date.now()}.${mime.includes("webm") ? "webm" : "mp4"}`,
              { type: mime.split(";")[0] },
            ),
          );
        } catch (error) {
          reject(error);
        } finally {
          this.stream.getTracks().forEach((t) => t.stop());
          this.video.srcObject = null;
        }
      };
      recorder.start(1000);
      if ("requestVideoFrameCallback" in this.video)
        this.raf = this.video.requestVideoFrameCallback(frame);
      this.timer = setInterval(() => {
        if (recorder.state !== "recording") return;
        if (!this.raf) draw();
        const elapsed = (performance.now() - start) / 1000;
        if (elapsed - lastProgress >= 0.2) {
          onProgress(elapsed, bytes);
          lastProgress = elapsed;
        }
        if (elapsed >= 120) this.stop();
      }, 50);
    });
  }
  stop() {
    if (this.recorder?.state === "recording") this.recorder.stop();
  }
  dispose() {
    this.disposed = true;
    this.stop();
    if (this.timer) clearInterval(this.timer);
    if (this.raf && "cancelVideoFrameCallback" in this.video)
      this.video.cancelVideoFrameCallback(this.raf);
    this.stream.getTracks().forEach((t) => t.stop());
    this.video.pause();
    this.video.srcObject = null;
  }
}
