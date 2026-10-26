import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  ArrowUpRight,
  Check,
  Link2,
  MonitorPlay,
  ScanLine,
  Square,
  X,
} from "lucide-react";
import {
  fetchVideoLink,
  parseVideoLink,
  type VideoLink,
} from "../sources/links";
import { TabCapture, type CaptureRect } from "../sources/capture";
import { fetchViaHelper, probeHelper, type HelperStatus } from "../sources/helper";
import type { SourceOrigin } from "../motion/types";
interface Props {
  onClose: () => void;
  onImport: (
    file: File,
    origin: SourceOrigin,
    signal?: AbortSignal,
  ) => Promise<void>;
}
export function LinkImport({ onClose, onImport }: Props) {
  const [value, setValue] = useState(""),
    [link, setLink] = useState<VideoLink | null>(null),
    [error, setError] = useState("");
  const [phase, setPhase] = useState<
    | "input"
    | "loading"
    | "helper"
    | "opening"
    | "region"
    | "recording"
    | "finishing"
  >("input");
  const [helper, setHelper] = useState<HelperStatus | null | undefined>(
      undefined,
    ),
    [helperProgress, setHelperProgress] = useState({ percent: 0, label: "" });
  const [received, setReceived] = useState({
      bytes: 0,
      total: null as number | null,
    }),
    [seconds, setSeconds] = useState(0),
    [snapshot, setSnapshot] = useState("");
  const [rect, setRect] = useState<CaptureRect>({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    }),
    [portrait, setPortrait] = useState(false);
  const session = useRef<TabCapture | null>(null),
    abort = useRef<AbortController | null>(null),
    mounted = useRef(true),
    start = useRef<{ x: number; y: number } | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
      session.current?.dispose();
    };
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose]);
  const inspect = () => {
    setError("");
    try {
      session.current?.dispose();
      session.current = null;
      const parsed = parseVideoLink(value);
      setLink(parsed);
      setPhase("input");
      setSnapshot("");
      setHelper(undefined);
      if (parsed.kind !== "direct")
        void probeHelper().then((status) => {
          if (mounted.current) setHelper(status);
        });
    } catch (e) {
      setError(errorText(e));
    }
  };
  const download = async () => {
    if (!link) return;
    const controller = new AbortController();
    abort.current = controller;
    setPhase("loading");
    setError("");
    setReceived({ bytes: 0, total: null });
    try {
      const file = await fetchVideoLink(
        link,
        controller.signal,
        (bytes, total) => setReceived({ bytes, total }),
      );
      if (!mounted.current || controller.signal.aborted) return;
      setPhase("finishing");
      const provenance = new URL(link.url);
      provenance.search = "";
      await onImport(
        file,
        { kind: "direct-url", url: provenance.href },
        controller.signal,
      );
      if (mounted.current) onClose();
    } catch (e) {
      if (mounted.current) {
        setPhase("input");
        setError(
          controller.signal.aborted
            ? "영상 가져오기를 취소했습니다."
            : e instanceof TypeError
              ? "이 주소에서 영상 읽기를 허용하지 않거나 연결할 수 없습니다. 영상 탭 공유를 사용하거나 CORS를 허용한 MP4·WebM 주소를 입력해 주세요."
              : errorText(e),
        );
      }
    }
  };
  const autoAnalyze = async () => {
    if (!link) return;
    const controller = new AbortController();
    abort.current = controller;
    setPhase("helper");
    setError("");
    setHelperProgress({ percent: 0, label: "시작하는 중" });
    try {
      const file = await fetchViaHelper(
        link.url,
        controller.signal,
        (percent, label) => {
          if (mounted.current) setHelperProgress({ percent, label });
        },
      );
      if (!mounted.current || controller.signal.aborted) return;
      setPhase("finishing");
      const provenance = new URL(link.url);
      provenance.search = "";
      await onImport(
        file,
        { kind: "local-helper", url: provenance.href },
        controller.signal,
      );
      if (mounted.current) onClose();
    } catch (e) {
      if (mounted.current) {
        setPhase("input");
        setError(
          controller.signal.aborted
            ? "영상 가져오기를 취소했습니다."
            : e instanceof TypeError
              ? "헬퍼와 연결이 끊겼습니다. 터미널에서 npm run helper 가 실행 중인지 확인해 주세요."
              : errorText(e),
        );
        void probeHelper().then((status) => {
          if (mounted.current) setHelper(status);
        });
      }
    }
  };
  const share = async () => {
    session.current?.dispose();
    setError("");
    setPhase("opening");
    try {
      const capture = await TabCapture.open(() => {
        if (
          mounted.current &&
          phaseRef.current !== "recording" &&
          phaseRef.current !== "finishing"
        ) {
          setPhase("input");
          setError("탭 공유가 종료되었습니다. 다시 공유해 주세요.");
        }
      });
      if (!mounted.current) {
        capture.dispose();
        return;
      }
      session.current = capture;
      setPortrait(capture.height > capture.width);
      setSnapshot(capture.snapshot());
      setRect({ x: 0, y: 0, width: 1, height: 1 });
      setPhase("region");
    } catch (e) {
      if (mounted.current) {
        setPhase("input");
        setError(
          e instanceof DOMException && e.name === "NotAllowedError"
            ? "탭 공유가 허용되지 않았습니다. 다시 눌러 영상이 재생되는 탭을 선택해 주세요."
            : errorText(e),
        );
      }
    }
  };
  const record = async () => {
    if (!session.current || !link) return;
    setError("");
    setSeconds(0);
    const controller = new AbortController();
    abort.current = controller;
    setPhase("recording");
    try {
      const file = await session.current.record(rect, (s) => {
        if (mounted.current) setSeconds(s);
      });
      if (!mounted.current) return;
      setPhase("finishing");
      const provenance = new URL(link.url);
      if (link.kind === "direct") provenance.search = "";
      await onImport(
        file,
        {
          kind: "tab-capture",
          url: provenance.href,
          capturedAt: new Date().toISOString(),
        },
        controller.signal,
      );
      if (mounted.current) onClose();
    } catch (e) {
      if (mounted.current) {
        setPhase("input");
        setError(errorText(e));
        session.current?.dispose();
        session.current = null;
      }
    }
  };
  const point = (e: PointerEvent<HTMLDivElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)),
      y: Math.max(0, Math.min(1, (e.clientY - b.top) / b.height)),
    };
  };
  const active = [
    "loading",
    "helper",
    "opening",
    "recording",
    "finishing",
  ].includes(phase);
  return (
    <div className="modal-backdrop link-backdrop">
      <div
        className="link-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="링크에서 3D 분석"
      >
        <button
          className="dialog-close"
          aria-label="링크 분석 닫기"
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <span className="eyebrow">FROM A LINK TO MOVEMENT</span>
        <h2>보고 있는 영상을 연습으로.</h2>
        <p className="link-intro">
          직접 영상 주소는 바로 가져옵니다. 유튜브·숏츠·릴스는 내 PC 헬퍼가
          켜져 있으면 자동으로 받아 분석하고, 없으면 재생 탭을 공유해 분석합니다.
        </p>
        <form
          className="link-form"
          onSubmit={(e) => {
            e.preventDefault();
            inspect();
          }}
        >
          <label className="sr-only" htmlFor="video-url">
            영상 링크
          </label>
          <input
            id="video-url"
            type="url"
            placeholder="유튜브, 숏츠, 릴스 또는 MP4·WebM 주소"
            value={value}
            disabled={active}
            onChange={(e) => {
              setValue(e.target.value);
              setLink(null);
              setError("");
            }}
            autoFocus
          />
          <button
            className="outline-button"
            disabled={active || !value.trim()}
            type="submit"
          >
            <Link2 size={15} />
            연결
          </button>
        </form>
        {error && (
          <div className="message error-message" role="alert">
            {error}
          </div>
        )}
        {link && (
          <>
            <div className="link-source-label">
              <Check size={13} />
              {link.label}
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                원본 영상 탭 열기
                <ArrowUpRight size={13} />
              </a>
            </div>
            {phase === "input" && link.embed && (
              <div
                className={`link-embed ${link.kind === "instagram" ? "reel-embed" : ""}`}
              >
                <iframe
                  title={`${link.label} 참고 재생`}
                  src={link.embed}
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
                <p>
                  재생이 제한되면 원본 영상 탭을 열어 로그인·재생한 뒤 그 탭을
                  공유하세요.
                </p>
              </div>
            )}
            {phase === "input" && link.kind !== "direct" && helper === null && (
              <p className="capture-note" role="status">
                자동 다운로드를 쓰려면 내 PC 터미널에서{" "}
                <code>npm run helper</code>를 실행한 뒤 다시 연결하세요. 실행
                전에는 아래 영상 탭 공유로 분석할 수 있습니다.
              </p>
            )}
            {phase === "input" &&
              link.kind !== "direct" &&
              helper &&
              (!helper.ytdlp || !helper.ffmpeg) && (
                <p className="capture-note" role="alert">
                  {!helper.ytdlp
                    ? "헬퍼에서 yt-dlp 를 찾지 못했습니다. pip install -U yt-dlp 후 헬퍼를 다시 실행하세요."
                    : "헬퍼에서 ffmpeg 를 찾지 못했습니다. ffmpeg 를 설치한 뒤 헬퍼를 다시 실행하세요."}
                </p>
              )}
            {phase === "input" && (
              <div className="link-actions">
                {link.kind !== "direct" && helper?.ytdlp && helper.ffmpeg && (
                  <button
                    className="primary-button"
                    onClick={() => void autoAnalyze()}
                  >
                    <ScanLine size={15} />
                    링크로 자동 분석
                  </button>
                )}
                {link.kind === "direct" && (
                  <button
                    className="primary-button"
                    onClick={() => void download()}
                  >
                    <ScanLine size={15} />
                    주소에서 바로 분석
                  </button>
                )}
                <button
                  className={
                    link.kind === "direct" || (helper?.ytdlp && helper.ffmpeg)
                      ? "outline-button"
                      : "primary-button"
                  }
                  onClick={() => void share()}
                >
                  <MonitorPlay size={16} />
                  영상 탭 공유
                </button>
              </div>
            )}
            {phase === "loading" && (
              <div className="link-loading" role="status">
                <span>영상 파일을 가져오는 중</span>
                <strong>
                  {(received.bytes / 1024 / 1024).toFixed(1)} MB
                  {received.total
                    ? ` / ${(received.total / 1024 / 1024).toFixed(1)} MB`
                    : ""}
                </strong>
                {received.total && (
                  <progress value={received.bytes} max={received.total} />
                )}
                <button
                  className="text-button"
                  onClick={() => abort.current?.abort()}
                >
                  가져오기 취소
                </button>
              </div>
            )}
            {phase === "helper" && (
              <div className="link-loading" role="status">
                <span>{helperProgress.label}</span>
                <strong>{Math.round(helperProgress.percent)}%</strong>
                <progress value={helperProgress.percent} max={100} />
                <button
                  className="text-button"
                  onClick={() => abort.current?.abort()}
                >
                  가져오기 취소
                </button>
              </div>
            )}
            {phase === "opening" && (
              <p className="capture-note" role="status">
                브라우저 공유 창에서 원본 영상이 재생되는 다른 탭을 선택해
                주세요. 탭 오디오는 선택 사항입니다.
              </p>
            )}
            {phase === "region" && (
              <>
                <div className="capture-step">
                  <b>분석할 영상 영역을 드래그하세요.</b>
                  <span>머리부터 발끝까지, 한 명이 보이도록 선택하세요.</span>
                  <button
                    className="text-button"
                    onClick={() => setRect({ x: 0, y: 0, width: 1, height: 1 })}
                  >
                    전체 영역
                  </button>
                </div>
                <div
                  className={`capture-region ${portrait ? "portrait" : ""}`}
                  role="group"
                  aria-label="분석 영역 선택"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    start.current = point(e);
                    setRect({ ...start.current, width: 0, height: 0 });
                  }}
                  onPointerMove={(e) => {
                    if (!start.current) return;
                    const p = point(e);
                    setRect({
                      x: Math.min(start.current.x, p.x),
                      y: Math.min(start.current.y, p.y),
                      width: Math.abs(start.current.x - p.x),
                      height: Math.abs(start.current.y - p.y),
                    });
                  }}
                  onPointerUp={() => {
                    start.current = null;
                  }}
                  onPointerCancel={() => {
                    start.current = null;
                  }}
                >
                  <img
                    src={snapshot}
                    alt="공유된 영상 탭. 드래그로 분석 영역 선택"
                    draggable={false}
                  />
                  <div
                    className="capture-rect"
                    style={{
                      left: `${rect.x * 100}%`,
                      top: `${rect.y * 100}%`,
                      width: `${rect.width * 100}%`,
                      height: `${rect.height * 100}%`,
                    }}
                  />
                </div>
                <div className="capture-coordinates" aria-label="영역 좌표">
                  <span>드래그 또는 숫자로 선택 (%)</span>
                  {(["x", "y", "width", "height"] as const).map((key, i) => (
                    <label key={key}>
                      {["X", "Y", "너비", "높이"][i]}
                      <input
                        type="number"
                        aria-label={`분석 영역 ${["X", "Y", "너비", "높이"][i]}`}
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round(rect[key] * 100)}
                        onChange={(e) =>
                          setRect({
                            ...rect,
                            [key]: Math.max(
                              0,
                              Math.min(1, Number(e.target.value) / 100),
                            ),
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                <p className="capture-note">
                  원본 탭의 원하는 부분을 재생한 뒤 시작하세요. 녹화 중에는 원본
                  탭의 스크롤·크기를 유지해 주세요. 최대 2분을 가져온 뒤
                  자동으로 3D 분석합니다.
                </p>
                <button
                  className="primary-button"
                  disabled={rect.width < 0.02 || rect.height < 0.02}
                  onClick={() => void record()}
                >
                  <ScanLine size={16} />이 영역 녹화 후 3D 분석
                </button>
                <button className="text-button" onClick={() => void share()}>
                  다른 탭 선택
                </button>
              </>
            )}
            {phase === "recording" && (
              <div className="recording-state" role="status">
                <i />
                <span>영상 영역을 가져오는 중</span>
                <strong className="mono">
                  {Math.floor(seconds / 60)
                    .toString()
                    .padStart(2, "0")}
                  :
                  {Math.floor(seconds % 60)
                    .toString()
                    .padStart(2, "0")}
                </strong>
                <p>
                  기기 안에서 녹화합니다. 마치면 포즈 추출과 보정을 시작합니다.
                </p>
                <button
                  className="primary-button"
                  onClick={() => {
                    setPhase("finishing");
                    session.current?.stop();
                  }}
                >
                  <Square size={13} />
                  녹화 마치고 분석
                </button>
              </div>
            )}
            {phase === "finishing" && (
              <p className="capture-note" role="status">
                분석할 클립을 준비하고 있습니다…
              </p>
            )}
          </>
        )}
        {!link && (
          <div className="link-paths">
            <div>
              <b>01 · MP4 / WEBM</b>
              <p>읽기가 허용된 직접 영상 주소 → 다운로드 → 자동 분석</p>
            </div>
            <div>
              <b>02 · YOUTUBE / SHORTS / REELS</b>
              <p>
                헬퍼 실행 중: 링크 → 자동 다운로드 → 분석 (재생 없이)
                <br />
                헬퍼 없이: 원본 탭 열기 → 탭 공유 허용 → 영역 선택 → 녹화·분석
              </p>
            </div>
          </div>
        )}
        <p className="link-footnote">
          탭 공유는 데스크톱 Chrome·Edge를 권장합니다. 분석 재생 시간은 가져온
          클립 기준입니다. 영상 파일이나 공유 화면을 서버로 보내지 않습니다.
        </p>
      </div>
    </div>
  );
}
const errorText = (e: unknown) =>
  e instanceof Error
    ? e.message
    : "영상을 가져오지 못했습니다. 다시 시도해 주세요.";
