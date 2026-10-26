import { Download, FileJson, Trash2, X } from "lucide-react";
import {
  JOINT_NAMES,
  type AnalysisOptions,
  type MotionData,
  type MotionFrame,
  type Practice,
} from "../motion/types";
interface Props {
  close: () => void;
  options: AnalysisOptions;
  setOptions: (o: AnalysisOptions) => void;
  busy: boolean;
  motion: MotionData | null;
  frame: MotionFrame | null;
  practice: Practice;
  setPractice: (p: Practice) => void;
  duration: number;
  selected: number | null;
  setSelected: (i: number | null) => void;
  markers: boolean;
  setMarkers: (v: boolean) => void;
  rootMotion: boolean;
  setRootMotion: (v: boolean) => void;
  orthographic: boolean;
  setOrthographic: (v: boolean) => void;
  onExport: () => void;
  onImport: () => void;
  onClear: () => void;
}
export function Inspector(p: Props) {
  const selected = p.selected === null ? null : p.frame?.joints[p.selected];
  return (
    <aside className="inspector" aria-label="분석 및 표시 설정">
      <div className="inspector-title">
        <div>
          <span className="eyebrow">INSPECTOR</span>
          <h2>연습 설정</h2>
        </div>
        <button aria-label="설정 닫기" onClick={p.close}>
          <X size={18} />
        </button>
      </div>
      <section>
        <h3>영상 분석</h3>
        <label>
          포즈 모델
          <select
            disabled={p.busy}
            value={p.options.quality}
            onChange={(e) =>
              p.setOptions({
                ...p.options,
                quality: e.target.value as AnalysisOptions["quality"],
              })
            }
          >
            <option value="lite">Lite · 빠른 분석</option>
            <option value="full">Full · 정밀 분석</option>
          </select>
        </label>
        <label>
          샘플링
          <select
            disabled={p.busy}
            value={p.options.fps}
            onChange={(e) =>
              p.setOptions({ ...p.options, fps: Number(e.target.value) })
            }
          >
            <option value={15}>15 fps · 기본</option>
            <option value={24}>24 fps</option>
            <option value={30}>30 fps</option>
          </select>
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            disabled={p.busy}
            checked={p.options.smoothing}
            onChange={(e) =>
              p.setOptions({ ...p.options, smoothing: e.target.checked })
            }
          />
          동작 적응형 흔들림 보정
        </label>
        <p>
          설정을 바꾸면 다시 분석해 주세요. 빠른 동작을 보존하면서 작은 흔들림을
          줄입니다.
        </p>
      </section>
      <section>
        <h3>3D 표시</h3>
        <label className="check-label">
          <input
            type="checkbox"
            checked={p.markers}
            onChange={(e) => p.setMarkers(e.target.checked)}
          />
          스켈레톤 관절 표시
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={p.orthographic}
            onChange={(e) => p.setOrthographic(e.target.checked)}
          />
          원근 왜곡 없는 정사영
        </label>
        <label>
          루트 이동
          <select
            value={p.rootMotion ? "estimated" : "stationary"}
            onChange={(e) => p.setRootMotion(e.target.value === "estimated")}
          >
            <option value="stationary">제자리 · 골반 안정화</option>
            <option value="estimated">추정 이동 · 근사치</option>
          </select>
        </label>
        <p>
          깊이·회전·이동은 단일 영상에서 추정됩니다. 가려진 관절과 몸의 비틀림은
          정확히 복원되지 않을 수 있습니다.
        </p>
      </section>
      <section>
        <h3>수동 8카운트</h3>
        <div className="field-pair">
          <label>
            BPM
            <input
              type="number"
              min={30}
              max={300}
              value={p.practice.bpm}
              onChange={(e) =>
                p.setPractice({
                  ...p.practice,
                  bpm: Math.max(
                    30,
                    Math.min(300, Number(e.target.value) || 120),
                  ),
                })
              }
            />
          </label>
          <label>
            첫 박자 (초)
            <input
              type="number"
              min={0}
              max={p.duration || 0}
              step={0.05}
              value={p.practice.offset}
              onChange={(e) =>
                p.setPractice({
                  ...p.practice,
                  offset: Math.max(
                    0,
                    Math.min(p.duration, Number(e.target.value) || 0),
                  ),
                })
              }
            />
          </label>
        </div>
        <p>
          음악에 맞춰 BPM과 첫 박자를 직접 지정합니다. 자동 비트 감지는 제공하지
          않습니다.
        </p>
      </section>
      <section>
        <h3>관절 살펴보기</h3>
        <label>
          해부학적 관절
          <select
            value={p.selected ?? ""}
            onChange={(e) =>
              p.setSelected(
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
          >
            <option value="">관절 선택</option>
            {JOINT_NAMES.map((name, i) => (
              <option key={i} value={i}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {p.selected !== null && (
          <div className="joint-readout">
            {selected ? (
              <>
                <span className="mono">
                  X {selected.position[0].toFixed(3)}
                  <br />Y {selected.position[1].toFixed(3)}
                  <br />Z {selected.position[2].toFixed(3)}
                </span>
                <small>
                  {selected.interpolated
                    ? "짧은 누락을 보간한 관절"
                    : selected.confidence < 0.55
                      ? "낮은 가시성 · 가림 가능"
                      : "감지된 관절 · 추정 3D"}
                </small>
              </>
            ) : (
              <p>이 시점에는 관절이 감지되지 않았습니다.</p>
            )}
          </div>
        )}
        <p>일시정지 후 스켈레톤의 관절을 눌러 비교할 수 있습니다.</p>
      </section>
      <section>
        <h3>모션 파일과 저장</h3>
        <button
          className="inspector-action"
          disabled={!p.motion}
          onClick={p.onExport}
        >
          <Download size={15} /> 모션 JSON 내보내기
        </button>
        <button
          className="inspector-action"
          disabled={!p.duration || p.busy}
          onClick={p.onImport}
        >
          <FileJson size={15} /> 모션 JSON 가져오기
        </button>
        <button
          className="inspector-action"
          disabled={p.busy}
          onClick={p.onClear}
        >
          <Trash2 size={15} /> 이 브라우저의 분석 캐시 삭제
        </button>
        <p>
          영상은 저장하거나 전송하지 않습니다. 분석 결과는 이 브라우저의
          IndexedDB에 보관합니다.
        </p>
      </section>
      {p.motion && (
        <section>
          <h3>분석 기록</h3>
          <dl className="analysis-report">
            <dt>분석 프레임</dt>
            <dd>{p.motion.statistics.total.toLocaleString()}</dd>
            <dt>단일 인물 추적</dt>
            <dd>{p.motion.statistics.detected.toLocaleString()} 프레임</dd>
            <dt>부분 가림</dt>
            <dd>{p.motion.statistics.partial.toLocaleString()} 프레임</dd>
            <dt>여러 인물 · 제외</dt>
            <dd>{p.motion.statistics.multiple.toLocaleString()} 프레임</dd>
            <dt>처리 경로</dt>
            <dd>
              {p.motion.processing.engine === "worker"
                ? "Web Worker"
                : "호환 모드"}
            </dd>
          </dl>
        </section>
      )}
    </aside>
  );
}
