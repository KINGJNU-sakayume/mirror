import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  Check,
  ChevronDown,
  CircleHelp,
  FileVideo2,
  Focus,
  FolderOpen,
  Maximize2,
  PanelRightClose,
  Pause,
  Play,
  Plus,
  Repeat2,
  RotateCcw,
  ScanLine,
  Settings2,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Square,
  Upload,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { analyzeVideo, type AnalysisProgress } from "./analysis/analyze";
import { inspectVideo } from "./analysis/video";
import { sampleMotion } from "./motion/preprocess";
import {
  cacheKey,
  clearCache,
  exportMotion,
  loadPractice,
  parseMotion,
  readCache,
  savePractice,
  verifySource,
  writeCache,
} from "./motion/storage";
import {
  DEFAULT_PRACTICE,
  JOINT_NAMES,
  type AnalysisOptions,
  type MotionData,
  type Practice,
  type VideoSource,
} from "./motion/types";
import { Stage, type CameraPreset } from "./scene/Stage";
import { usePlayback } from "./player/usePlayback";
import { timecode, validLoop, type LoopRange } from "./player/timing";
import { VideoOverlay } from "./components/VideoOverlay";
import { Timeline } from "./components/Timeline";
import { Inspector } from "./components/Inspector";
const CAMERAS: { id: CameraPreset; label: string }[] = [
  { id: "front", label: "정면" },
  { id: "back", label: "후면" },
  { id: "left", label: "왼쪽" },
  { id: "right", label: "오른쪽" },
  { id: "quarter", label: "¾" },
  { id: "free", label: "자유" },
];
export default function App() {
  const [source, setSource] = useState<VideoSource | null>(null),
    [url, setUrl] = useState(""),
    [video, setVideo] = useState<HTMLVideoElement | null>(null),
    [motion, setMotion] = useState<MotionData | null>(null);
  const [options, setOptions] = useState<AnalysisOptions>({
      fps: 15,
      quality: "lite",
      smoothing: true,
    }),
    [progress, setProgress] = useState<AnalysisProgress | null>(null),
    [importing, setImporting] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [dragging, setDragging] = useState(false),
    [help, setHelp] = useState(false),
    [inspector, setInspector] = useState(false);
  const [mirror, setMirror] = useState(false),
    [overlay, setOverlay] = useState(true),
    [markers, setMarkers] = useState(true),
    [rootMotion, setRootMotion] = useState(false),
    [orthographic, setOrthographic] = useState(false);
  const [mode, setMode] = useState<"skeleton" | "avatar">("skeleton"),
    [layout, setLayout] = useState<"split" | "video" | "stage">("split"),
    [preset, setPreset] = useState<CameraPreset>("quarter"),
    [reset, setReset] = useState(0),
    [selected, setSelected] = useState<number | null>(null);
  const [loop, setLoop] = useState<LoopRange>({
      start: 0,
      end: 0,
      enabled: false,
    }),
    [practice, setPractice] = useState<Practice>(
      structuredClone(DEFAULT_PRACTICE),
    ),
    [segmentName, setSegmentName] = useState("");
  const input = useRef<HTMLInputElement>(null),
    jsonInput = useRef<HTMLInputElement>(null),
    abort = useRef<AbortController | null>(null),
    currentUrl = useRef(""),
    loadId = useRef(0),
    workspace = useRef<HTMLDivElement>(null);
  const duration = source?.duration ?? 0,
    busy = Boolean(progress);
  const playback = usePlayback(video, duration, loop);
  const frame = useMemo(
    () => (motion ? sampleMotion(motion, playback.time) : null),
    [motion, playback.time],
  );
  const changeOptions = (o: AnalysisOptions) => {
    setOptions(o);
    if (motion)
      setNotice(
        "분석 설정이 변경되었습니다. 다시 분석하면 새 설정이 적용됩니다.",
      );
  };
  const loadVideo = useCallback(
    async (file: File) => {
      const id = ++loadId.current;
      abort.current?.abort();
      video?.pause();
      setProgress(null);
      setImporting(true);
      setError("");
      setNotice("");
      const next = URL.createObjectURL(file);
      try {
        const metadata = await inspectVideo(file, next);
        if (id !== loadId.current) {
          URL.revokeObjectURL(next);
          return;
        }
        if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
        currentUrl.current = next;
        setSource(metadata);
        setUrl(next);
        setMotion(null);
        setSelected(null);
        setLoop({ start: 0, end: metadata.duration, enabled: false });
        setPractice(loadPractice(metadata.fingerprint, metadata.duration));
        setSegmentName("");
        setNotice("영상이 준비되었습니다. 동작 분석을 시작해 주세요.");
      } catch (e) {
        URL.revokeObjectURL(next);
        if (id === loadId.current) setError(message(e));
      } finally {
        if (id === loadId.current) setImporting(false);
      }
    },
    [video],
  );
  useEffect(
    () => () => {
      abort.current?.abort();
      loadId.current++;
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    },
    [],
  );
  useEffect(() => {
    if (source) savePractice(source.fingerprint, practice);
  }, [source, practice]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 7000);
    return () => clearTimeout(timer);
  }, [notice]);
  const analyze = async () => {
    if (!source || busy) return;
    video?.pause();
    setError("");
    setNotice("");
    const controller = new AbortController();
    abort.current = controller;
    const id = loadId.current;
    setProgress({
      completed: 0,
      total: Math.ceil(duration * options.fps),
      message: "저장된 분석을 확인하는 중",
      engine: "worker",
    });
    try {
      const key = cacheKey(
        source,
        options.fps,
        options.quality,
        options.smoothing,
      );
      const cached = await readCache(key).catch(() => null);
      if (controller.signal.aborted) return;
      const result =
        cached ??
        (await analyzeVideo(url, source, options, controller.signal, (p) => {
          if (!controller.signal.aborted) setProgress(p);
        }));
      if (controller.signal.aborted || id !== loadId.current) return;
      setMotion(result);
      playback.seek(0);
      setNotice(
        cached
          ? "이 브라우저에 저장된 분석을 불러왔습니다."
          : `실제 영상의 ${result.statistics.total.toLocaleString()}개 프레임을 분석했습니다.${result.statistics.multiple ? " 여러 인물 프레임은 제외했습니다." : ""}`,
      );
      if (!cached)
        await writeCache(key, result).catch(() =>
          setNotice(
            "분석은 완료되었습니다. 저장 공간이 부족해 캐시를 보관하지 못했습니다. 모션 JSON으로 내보낼 수 있습니다.",
          ),
        );
    } catch (e) {
      if (!controller.signal.aborted && id === loadId.current)
        setError(message(e));
    } finally {
      if (abort.current === controller) {
        setProgress(null);
        abort.current = null;
      }
    }
  };
  const cancel = () => {
    abort.current?.abort();
    abort.current = null;
    setProgress(null);
    setNotice("분석을 취소했습니다. 원본 영상은 계속 사용할 수 있습니다.");
  };
  const importMotion = async (file: File) => {
    if (!source) return;
    try {
      if (file.size > 180_000_000)
        throw new Error("모션 파일은 180MB 이하로 가져와 주세요.");
      const data = parseMotion(await file.text());
      verifySource(data, source);
      setMotion(data);
      setPractice(data.practice);
      setOptions({
        fps: data.processing.fps,
        quality: data.processing.quality,
        smoothing: data.processing.smoothing,
      });
      playback.seek(0);
      setError("");
      setNotice("원본 영상과 일치하는 모션 데이터를 불러왔습니다.");
    } catch (e) {
      setError(message(e));
    }
  };
  const changeLoop = (next: LoopRange) => {
    setLoop(next);
  };
  const toggleLoop = useCallback(() => {
    if (!duration) return;
    if (!validLoop(loop, duration)) {
      setError("A와 B 사이를 0.05초 이상으로 지정해 주세요.");
      return;
    }
    setLoop({ ...loop, enabled: !loop.enabled });
  }, [loop, duration]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setHelp(false);
        setInspector(false);
        return;
      }
      if (
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        help ||
        /INPUT|TEXTAREA|SELECT|BUTTON/.test((e.target as HTMLElement).tagName)
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        if (!busy) void playback.toggle();
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (!busy) {
          if (e.shiftKey) playback.seek(playback.time + 1);
          else playback.step(1);
        }
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (!busy) {
          if (e.shiftKey) playback.seek(playback.time - 1);
          else playback.step(-1);
        }
      }
      if (e.key.toLowerCase() === "m") setMirror((v) => !v);
      if (e.key.toLowerCase() === "l") toggleLoop();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [playback, busy, help, toggleLoop]);
  const saveSegment = () => {
    if (!validLoop(loop, duration)) return;
    if (practice.segments.length >= 200) {
      setError("연습 구간은 최대 200개까지 저장할 수 있습니다.");
      return;
    }
    setPractice({
      ...practice,
      segments: [
        ...practice.segments,
        {
          id: crypto.randomUUID(),
          name:
            segmentName.trim() || `연습 구간 ${practice.segments.length + 1}`,
          start: loop.start,
          end: loop.end,
        },
      ],
    });
    setSegmentName("");
    setNotice("이 영상의 연습 구간을 저장했습니다.");
  };
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await workspace.current?.requestFullscreen();
    } catch {
      setError(
        "이 브라우저에서는 전체화면을 사용할 수 없습니다. 영상 또는 3D 집중 보기를 사용해 주세요.",
      );
    }
  };
  const noPlayback = !source || busy || importing;
  return (
    <div className="app-shell" ref={workspace}>
      <input
        className="sr-only"
        ref={input}
        type="file"
        accept="video/*,.mp4,.webm,.mov"
        aria-label="로컬 영상 파일"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void loadVideo(f);
          e.target.value = "";
        }}
      />
      <input
        className="sr-only"
        ref={jsonInput}
        type="file"
        accept=".json,application/json"
        aria-label="모션 JSON 파일"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importMotion(f);
          e.target.value = "";
        }}
      />
      <header className="app-header">
        <a className="brand" href="." aria-label="FORM 스튜디오">
          FORM
          <span className="brand-dot" />
        </a>
        <span className="header-divider" />
        <span className="header-label">DANCE LEARNING STUDIO</span>
        <div className="header-right">
          <span className="local-status">
            <ShieldCheck size={14} />
            <span>기기 안에서만 분석</span>
          </span>
          <button
            className="icon-button"
            aria-label="사용 방법"
            title="사용 방법"
            onClick={() => setHelp(true)}
          >
            <CircleHelp size={18} />
          </button>
          <button
            className={`icon-button ${inspector ? "active" : ""}`}
            aria-label="연습 설정"
            title="연습 설정"
            aria-expanded={inspector}
            onClick={() => setInspector((v) => !v)}
          >
            <Settings2 size={18} />
          </button>
        </div>
      </header>
      <main>
        <div className="workspace-title">
          <div>
            <div className="eyebrow">YOUR PRACTICE, IN PERSPECTIVE</div>
            <h1>동작을 보고, 이해하고, 내 것으로.</h1>
          </div>
          <button
            className="primary-button import-top"
            disabled={importing || busy}
            onClick={() => input.current?.click()}
          >
            <Plus size={16} />
            {importing
              ? "영상을 읽는 중…"
              : source
                ? "영상 바꾸기"
                : "영상 가져오기"}
          </button>
        </div>
        <div className="session-bar">
          <div className="session-file">
            <FileVideo2 size={15} />
            <span>{source ? source.name : "새 연습 세션"}</span>
            {source && (
              <span className="file-meta mono">
                {source.width} × {source.height} <span>·</span>{" "}
                {timecode(duration).slice(0, 5)}
              </span>
            )}
          </div>
          <div className="segmented layout-switch" aria-label="보기 구성">
            {(
              [
                { id: "split", label: "나란히" },
                { id: "video", label: "영상" },
                { id: "stage", label: "3D" },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                className={layout === item.id ? "active" : ""}
                onClick={() => setLayout(item.id)}
                aria-pressed={layout === item.id}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button
            className="icon-button fullscreen-button"
            aria-label="전체화면"
            onClick={() => void fullscreen()}
          >
            <Maximize2 size={16} />
          </button>
        </div>
        {(error || playback.error) && (
          <div className="message error-message" role="alert">
            <span>{error || playback.error}</span>
            <button aria-label="오류 닫기" onClick={() => {setError(""); playback.clearError();}}>
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="message notice-message" role="status">
            <Check size={15} />
            <span>{notice}</span>
            <button aria-label="알림 닫기" onClick={() => setNotice("")}>
              <X size={15} />
            </button>
          </div>
        )}
        <div className={`viewers layout-${layout}`}>
          <section
            className={`viewer video-viewer ${dragging ? "dragging" : ""}`}
            aria-label="원본 영상"
            onDragOver={(e) => {
              e.preventDefault();
              if (!busy) setDragging(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node))
                setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files[0];
              if (f && !busy) void loadVideo(f);
            }}
          >
            <div className="viewer-heading">
              <div>
                <span className="panel-number">01</span>
                <h2>원본 영상</h2>
              </div>
              <div className="viewer-heading-tools">
                <span className="tiny-label">SOURCE</span>
                <button
                  className={overlay ? "active" : ""}
                  disabled={!motion}
                  onClick={() => setOverlay((v) => !v)}
                  title="감지된 2D 포즈 표시"
                  aria-label="2D 스켈레톤 오버레이"
                  aria-pressed={overlay}
                >
                  <ScanLine size={15} />
                  <span>포즈</span>
                </button>
              </div>
            </div>
            <div className="viewer-content source-content">
              {source ? (
                <>
                  <div className={`video-layer ${mirror ? "mirrored" : ""}`}>
                    <video
                      key={url}
                      ref={setVideo}
                      src={url}
                      playsInline
                      preload="auto"
                      onClick={() => {
                        if (!busy) void playback.toggle();
                      }}
                      onError={() =>
                        setError(
                          "이 브라우저에서 영상을 재생할 수 없습니다. H.264 MP4 또는 WebM을 사용해 주세요.",
                        )
                      }
                      aria-label="로컬 원본 영상"
                    />
                    <VideoOverlay
                      video={video}
                      motion={motion}
                      clock={playback.clock}
                      enabled={overlay}
                      selected={selected}
                    />
                  </div>
                  <div className="viewer-corner-label">
                    <span className="status-dot" />
                    {mirror ? "MIRRORED SOURCE" : "LOCAL SOURCE"}
                  </div>
                  {!motion && !busy && (
                    <div className="analyze-invite">
                      <button
                        className="primary-button"
                        onClick={() => void analyze()}
                      >
                        <ScanLine size={16} />
                        동작 분석 시작
                      </button>
                      <span>원본 프레임에서 실제 포즈를 추출합니다.</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="upload-empty">
                  <div className="frame-corner top-left" />
                  <div className="frame-corner top-right" />
                  <div className="frame-corner bottom-left" />
                  <div className="frame-corner bottom-right" />
                  <div className="upload-symbol">
                    <ArrowDownToLine size={32} strokeWidth={1.2} />
                  </div>
                  <h3>연습할 영상을 놓아 주세요.</h3>
                  <p>한 명의 전신이 보이는 댄스 영상으로 시작하세요.</p>
                  <button
                    className="outline-button"
                    disabled={importing}
                    onClick={() => input.current?.click()}
                  >
                    <FolderOpen size={16} />
                    {importing ? "영상 확인 중…" : "내 기기에서 선택"}
                  </button>
                  <span className="file-types mono">
                    MP4 · WEBM · 브라우저가 지원하는 영상
                  </span>
                  <div className="empty-privacy">
                    <ShieldCheck size={13} />
                    영상은 기기 밖으로 전송되지 않습니다.
                  </div>
                </div>
              )}
              {dragging && (
                <div className="drop-overlay">
                  <Upload size={30} />
                  놓아서 영상 가져오기
                </div>
              )}
              {busy && progress && (
                <div className="analysis-progress" role="status">
                  <div className="analysis-progress-top">
                    <span>{progress.message}</span>
                    <button onClick={cancel}>
                      <Square size={12} />
                      취소
                    </button>
                  </div>
                  <progress value={progress.completed} max={progress.total} />
                  <div className="analysis-progress-bottom">
                    <span className="mono">
                      {progress.completed.toLocaleString()} /{" "}
                      {progress.total.toLocaleString()} 프레임
                    </span>
                    <span>
                      {Math.floor((progress.completed / progress.total) * 100)}%
                    </span>
                  </div>
                </div>
              )}
            </div>
            <div className="viewer-footer">
              <span>
                {source
                  ? "클릭하여 재생 / 일시정지"
                  : "로컬 영상으로 시작하는 나만의 연습실"}
              </span>
              {source && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void analyze()}
                >
                  <ScanLine size={13} />
                  {motion ? "다시 분석" : "분석"}
                </button>
              )}
            </div>
          </section>
          <section className="viewer stage-viewer" aria-label="3D 재구성">
            <div className="viewer-heading">
              <div>
                <span className="panel-number">02</span>
                <h2>움직임의 다른 시선</h2>
              </div>
              <div className="segmented representation-switch">
                <button
                  className={mode === "skeleton" ? "active" : ""}
                  onClick={() => setMode("skeleton")}
                  aria-pressed={mode === "skeleton"}
                >
                  스켈레톤
                </button>
                <button
                  className={mode === "avatar" ? "active" : ""}
                  onClick={() => setMode("avatar")}
                  aria-pressed={mode === "avatar"}
                >
                  마네킹
                </button>
              </div>
            </div>
            <div className="viewer-content stage-content">
              <Stage
                motion={motion}
                clock={playback.clock}
                mirror={mirror}
                mode={mode}
                markers={markers}
                rootMotion={rootMotion}
                orthographic={orthographic}
                preset={preset}
                reset={reset}
                selected={selected}
                onSelect={(j) => {
                  if (!playback.playing) setSelected(j);
                }}
                onOrbit={() => setPreset("free")}
              />
              <div className="stage-top-label">
                <span className="tiny-label">ESTIMATED 3D</span>
                {motion && (
                  <span className="mono">{motion.processing.fps} fps</span>
                )}
              </div>
              {!motion && (
                <div className="stage-empty">
                  <div className="axis-mark">
                    <span>Y</span>
                    <span>X</span>
                    <span>Z</span>
                  </div>
                  <h3>평면 너머의 동작을 보다.</h3>
                  <p>
                    영상을 분석하면 실제 동작에서 추정한
                    <br />
                    3D 포즈가 이 무대에 나타납니다.
                  </p>
                </div>
              )}
              {motion && !frame?.joints[23] && (
                <div className="missing-pose">
                  이 프레임은 추적이 불확실합니다.
                  <br />
                  <small>동작을 임의로 생성하지 않습니다.</small>
                </div>
              )}
              {selected !== null && frame?.joints[selected] && (
                <div className="selected-joint">
                  <span>{JOINT_NAMES[selected]}</span>
                  <small>
                    {frame.joints[selected]!.interpolated
                      ? "보간된 위치"
                      : "추정 3D 위치"}
                  </small>
                  <button
                    aria-label="관절 선택 해제"
                    onClick={() => setSelected(null)}
                  >
                    <X size={13} />
                  </button>
                </div>
              )}
              <div className="camera-toolbar" aria-label="카메라 방향">
                {CAMERAS.map((c) => (
                  <button
                    key={c.id}
                    className={preset === c.id ? "active" : ""}
                    onClick={() => setPreset(c.id)}
                    aria-pressed={preset === c.id}
                    title={
                      c.id === "left"
                        ? "댄서의 왼쪽에서 보기"
                        : c.id === "right"
                          ? "댄서의 오른쪽에서 보기"
                          : c.label
                    }
                  >
                    {c.label}
                  </button>
                ))}
                <span />
                <button
                  aria-label="카메라 초기화 및 중심 맞추기"
                  title="카메라 초기화 및 중심 맞추기"
                  onClick={() => {
                    setPreset("quarter");
                    setReset((n) => n + 1);
                  }}
                >
                  <Focus size={15} />
                </button>
              </div>
            </div>
            <div className="viewer-footer">
              <div className="limb-legend">
                <span>
                  <i />
                  해부학적 왼쪽
                </span>
                <span>
                  <i />
                  오른쪽
                </span>
              </div>
              <span className="stage-hint">드래그 회전 · 스크롤 확대</span>
            </div>
          </section>
        </div>
        <section className="transport" aria-label="재생 도구">
          <div className="transport-left">
            <button
              className={`mirror-button ${mirror ? "active" : ""}`}
              onClick={() => setMirror((v) => !v)}
              aria-pressed={mirror}
              title="영상과 3D 함께 반전 (M)"
            >
              <ArrowLeftRight size={16} />
              <span>미러</span>
              <span className="toggle-indicator" />
            </button>
            <span className="tool-divider" />
            <label className="speed-control">
              <select
                aria-label="재생 속도"
                value={playback.speed}
                onChange={(e) => playback.setSpeed(Number(e.target.value))}
              >
                {[0.25, 0.5, 0.75, 1, 1.25, 1.5].map((s) => (
                  <option key={s} value={s}>
                    {s.toFixed(2).replace(/0$/, "").replace(/\.0$/, "")}×
                  </option>
                ))}
              </select>
              <ChevronDown size={13} />
            </label>
          </div>
          <div className="transport-center">
            <button
              className="icon-button"
              disabled={noPlayback}
              onClick={() => playback.seek(loop.enabled ? loop.start : 0)}
              aria-label="처음으로"
              title="처음으로"
            >
              <RotateCcw size={16} />
            </button>
            <button
              className="icon-button"
              disabled={noPlayback}
              onClick={() => playback.step(-1)}
              aria-label="이전 프레임"
              title="이전 프레임 (←, 1/30초)"
            >
              <SkipBack size={18} />
            </button>
            <button
              className="play-button"
              disabled={noPlayback}
              onClick={() => void playback.toggle()}
              aria-label={playback.playing ? "일시정지" : "재생"}
              title="재생 / 일시정지 (Space)"
            >
              {playback.playing ? (
                <Pause size={20} fill="currentColor" />
              ) : (
                <Play size={20} fill="currentColor" />
              )}
            </button>
            <button
              className="icon-button"
              disabled={noPlayback}
              onClick={() => playback.step(1)}
              aria-label="다음 프레임"
              title="다음 프레임 (→, 1/30초)"
            >
              <SkipForward size={18} />
            </button>
            <button
              className={`icon-button ${loop.enabled ? "active" : ""}`}
              disabled={noPlayback}
              onClick={toggleLoop}
              aria-label="A-B 구간 반복"
              aria-pressed={loop.enabled}
              title="구간 반복 (L)"
            >
              <Repeat2 size={18} />
            </button>
          </div>
          <div className="transport-right">
            <button
              className="icon-button"
              aria-label={playback.volume ? "음소거" : "음소거 해제"}
              onClick={() => playback.setVolume(playback.volume ? 0 : 0.8)}
            >
              {playback.volume ? <Volume2 size={17} /> : <VolumeX size={17} />}
            </button>
            <input
              type="range"
              aria-label="음량"
              min={0}
              max={1}
              step={0.05}
              value={playback.volume}
              onChange={(e) => playback.setVolume(Number(e.target.value))}
            />
            <button
              className="icon-button"
              aria-label="집중 보기 전환"
              title="3D 집중 보기"
              onClick={() => setLayout(layout === "stage" ? "split" : "stage")}
            >
              <PanelRightClose size={17} />
            </button>
          </div>
        </section>
        <Timeline
          time={playback.time}
          duration={duration}
          motion={motion}
          bpm={practice.bpm}
          offset={practice.offset}
          loop={loop}
          seek={playback.seek}
          onLoop={changeLoop}
        />
        <section className="practice-bar" aria-label="구간 반복 설정">
          <div className="practice-heading">
            <Repeat2 size={15} />
            <span>한 구간씩, 확실하게.</span>
          </div>
          <div className="loop-field">
            <button
              disabled={noPlayback}
              title="현재 위치를 A로 지정"
              onClick={() =>
                setLoop({
                  ...loop,
                  start: Math.min(playback.time, loop.end - 0.05),
                })
              }
            >
              A
            </button>
            <input
              type="number"
              aria-label="반복 시작 A (초)"
              min={0}
              max={Math.max(0, loop.end - 0.05)}
              step={0.01}
              value={Number(loop.start.toFixed(2))}
              disabled={noPlayback}
              onChange={(e) =>
                setLoop({
                  ...loop,
                  start: Math.max(
                    0,
                    Math.min(loop.end - 0.05, Number(e.target.value) || 0),
                  ),
                })
              }
            />
          </div>
          <span className="range-dash">—</span>
          <div className="loop-field">
            <button
              disabled={noPlayback}
              title="현재 위치를 B로 지정"
              onClick={() =>
                setLoop({
                  ...loop,
                  end: Math.max(playback.time, loop.start + 0.05),
                })
              }
            >
              B
            </button>
            <input
              type="number"
              aria-label="반복 끝 B (초)"
              min={loop.start + 0.05}
              max={duration}
              step={0.01}
              value={Number(loop.end.toFixed(2))}
              disabled={noPlayback}
              onChange={(e) =>
                setLoop({
                  ...loop,
                  end: Math.min(
                    duration,
                    Math.max(loop.start + 0.05, Number(e.target.value) || 0),
                  ),
                })
              }
            />
          </div>
          <span className="seconds-label">초</span>
          <span className="tool-divider" />
          <input
            className="segment-name"
            aria-label="연습 구간 이름"
            maxLength={100}
            placeholder="구간 이름"
            value={segmentName}
            disabled={noPlayback}
            onChange={(e) => setSegmentName(e.target.value)}
          />
          <button
            className="text-button save-segment"
            disabled={noPlayback || !validLoop(loop, duration)}
            onClick={saveSegment}
          >
            <Plus size={14} />
            구간 저장
          </button>
          <button
            className="text-button count-settings"
            onClick={() => setInspector(true)}
          >
            <Settings2 size={14} />
            {practice.bpm} BPM
          </button>
        </section>
        {practice.segments.length > 0 && (
          <div className="saved-segments">
            {practice.segments.map((s) => (
              <div key={s.id}>
                <button
                  onClick={() => {
                    setLoop({ start: s.start, end: s.end, enabled: true });
                    playback.seek(s.start);
                  }}
                >
                  {s.name}
                  <span className="mono">
                    {timecode(s.start).slice(0, 5)}–
                    {timecode(s.end).slice(0, 5)}
                  </span>
                </button>
                <button
                  aria-label={`${s.name} 구간 삭제`}
                  onClick={() =>
                    setPractice({
                      ...practice,
                      segments: practice.segments.filter((v) => v.id !== s.id),
                    })
                  }
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <footer className="app-footer">
          <span>
            한 명의 전신 영상에 맞춘 스튜디오 <span>·</span> 단일 카메라 3D는
            추정치입니다.
          </span>
          <div>
            {motion && (
              <button
                className="text-button"
                onClick={() => exportMotion({ ...motion, practice })}
              >
                <ArrowDownToLine size={13} />
                모션 내보내기
              </button>
            )}
            <span className="footer-shortcuts">
              <kbd>SPACE</kbd> 재생 <kbd>M</kbd> 미러 <kbd>← →</kbd> 프레임
            </span>
          </div>
        </footer>
      </main>
      {inspector && (
        <>
          <div
            className="drawer-backdrop"
            onClick={() => setInspector(false)}
          />
          <Inspector
            close={() => setInspector(false)}
            options={options}
            setOptions={changeOptions}
            busy={busy}
            motion={motion}
            frame={frame}
            practice={practice}
            setPractice={setPractice}
            duration={duration}
            selected={selected}
            setSelected={setSelected}
            markers={markers}
            setMarkers={setMarkers}
            rootMotion={rootMotion}
            setRootMotion={setRootMotion}
            orthographic={orthographic}
            setOrthographic={setOrthographic}
            onExport={() => {
              if (motion) exportMotion({ ...motion, practice });
            }}
            onImport={() => jsonInput.current?.click()}
            onClear={() => {
              void clearCache()
                .then(() =>
                  setNotice(
                    "이 브라우저의 분석 캐시를 삭제했습니다. 현재 세션과 연습 구간은 유지됩니다.",
                  ),
                )
                .catch(() => setError("브라우저 저장소에 접근할 수 없습니다."));
            }}
          />
        </>
      )}
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <div
            className="help-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="FORM 사용 방법"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="dialog-close"
              aria-label="도움말 닫기"
              onClick={() => setHelp(false)}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">
              A LITTLE PRACTICE, A NEW PERSPECTIVE
            </span>
            <h2>나만의 속도로 익히세요.</h2>
            <ol>
              <li>
                <b>전신 영상 가져오기</b>
                <p>
                  처리 권한이 있는 로컬 영상을 선택하세요. 한 명의 머리부터
                  발끝까지 보이는 밝은 영상이 좋습니다.
                </p>
              </li>
              <li>
                <b>실제 동작 분석하기</b>
                <p>
                  동작 분석을 누르면 프레임을 차례로 읽습니다. 회색 구간은 추적
                  실패, 황갈색 관절은 가림이나 보간을 뜻합니다.
                </p>
              </li>
              <li>
                <b>시선을 바꾸며 연습하기</b>
                <p>
                  후면·측면으로 관절을 보고, 미러와 느린 재생을 함께 사용하세요.
                  A와 B로 어려운 구간을 반복할 수 있습니다.
                </p>
              </li>
              <li>
                <b>음악에 카운트 맞추기</b>
                <p>
                  설정에서 BPM과 첫 박자 위치를 직접 지정하세요. 숫자를 누르면
                  해당 카운트로 이동합니다.
                </p>
              </li>
            </ol>
            <p className="help-limit">
              3D 깊이와 공간 이동은 추정치입니다. 0.2초를 넘는 관절 누락은
              복원하지 않습니다. 프레임 이동은 원본 프레임률을 알 수 없어 1/30초
              간격을 사용합니다.
            </p>
            <button className="primary-button" onClick={() => setHelp(false)}>
              연습실로 돌아가기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "처리 중 문제가 발생했습니다. 다시 시도해 주세요.";
}
