import { useMemo } from "react";
import { ChevronLeft, ChevronRight, Repeat2 } from "lucide-react";
import type { MotionData } from "../motion/types";
import {
  countMarkers,
  eightCount,
  timecode,
  type LoopRange,
} from "../player/timing";
interface Props {
  time: number;
  duration: number;
  motion: MotionData | null;
  bpm: number;
  offset: number;
  loop: LoopRange;
  seek: (time: number) => void;
  onLoop: (loop: LoopRange) => void;
}
export function Timeline({
  time,
  duration,
  motion,
  bpm,
  offset,
  loop,
  seek,
  onLoop,
}: Props) {
  const markers = useMemo(
    () => countMarkers(duration, bpm, offset),
    [duration, bpm, offset],
  );
  const current = eightCount(time, bpm, offset, duration);
  const quality = useMemo(() => {
    if (!motion) return [];
    const n = Math.min(240, motion.frames.length);
    return Array.from({ length: n }, (_, i) => {
      const frames = motion.frames.slice(
        Math.floor((i * motion.frames.length) / n),
        Math.floor(((i + 1) * motion.frames.length) / n),
      );
      return (
        frames.filter((f) => f.joints[23] && f.joints[24]).length /
        frames.length
      );
    });
  }, [motion]);
  const percent = (value: number) =>
    duration > 0
      ? `${Math.max(0, Math.min(100, (value / duration) * 100))}%`
      : "0%";
  return (
    <section className="timeline-section" aria-label="연습 타임라인">
      <div className="timeline-heading">
        <div>
          <span className="eyebrow">PRACTICE TIMELINE</span>
          <span className="timeline-hint">
            {motion
              ? "추적된 프레임을 따라 동작을 살펴보세요."
              : "영상을 가져오면 타임라인이 열립니다."}
          </span>
        </div>
        <span className="mono">
          {timecode(time)} <span className="muted">/ {timecode(duration)}</span>
        </span>
      </div>
      <div className={`timeline ${!duration ? "is-empty" : ""}`}>
        <div className="time-ruler">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} style={{ left: `${(i / 6) * 100}%` }}>
              {timecode((duration * i) / 6).slice(0, 5)}
            </span>
          ))}
        </div>
        <div className="timeline-lanes">
          {duration > 0 && loop.end > loop.start && (
            <div
              className={`loop-region ${loop.enabled ? "enabled" : ""}`}
              style={{
                left: percent(loop.start),
                width: percent(loop.end - loop.start),
              }}
            >
              <b>A</b>
              <b>B</b>
            </div>
          )}
          <div className="count-lane">
            {markers
              .filter((m) => duration < 35 || m.count === 1)
              .map((m, i) => (
                <span
                  key={i}
                  className={m.count === 1 ? "downbeat" : ""}
                  style={{ left: percent(m.time) }}
                >
                  {m.count === 1 ? `${m.group + 1} · 1` : m.count}
                </span>
              ))}
            {!duration && (
              <span className="empty-lane-label">EIGHT COUNTS</span>
            )}
          </div>
          <div className="tracking-lane">
            {quality.map((q, i) => (
              <span
                key={i}
                className={
                  q < 0.5 ? "missing" : q < 0.9 ? "partial" : "tracked"
                }
                style={{ width: `${100 / quality.length}%` }}
              />
            ))}
            {!motion && <span className="empty-lane-label">POSE TRACKING</span>}
          </div>
          {duration > 0 && (
            <div className="playhead" style={{ left: percent(time) }}>
              <span />
            </div>
          )}
          <input
            aria-label="재생 위치"
            className="timeline-scrubber"
            type="range"
            min={0}
            max={duration || 1}
            step={0.001}
            value={time}
            disabled={!duration}
            onChange={(e) => seek(Number(e.target.value))}
          />
        </div>
      </div>
      <div className="count-controls">
        <div className="count-group">
          <span className="muted">8 COUNT</span>
          <button
            aria-label="이전 8카운트"
            disabled={!duration}
            onClick={() => seek(Math.max(offset, current.start - 480 / bpm))}
          >
            <ChevronLeft size={15} />
          </button>
          <span className="mono">
            {String(current.group + 1).padStart(2, "0")}
          </span>
          <button
            aria-label="다음 8카운트"
            disabled={!duration}
            onClick={() => seek(current.end)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
        <div className="eight-counts">
          {Array.from({ length: 8 }, (_, i) => (
            <button
              key={i}
              className={duration && current.count === i + 1 ? "active" : ""}
              disabled={!duration || current.start + (i * 60) / bpm > duration}
              onClick={() => seek(current.start + (i * 60) / bpm)}
              aria-label={`${i + 1}카운트로 이동`}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <button
          className="text-button"
          disabled={!duration || current.end - current.start < 0.05}
          onClick={() => {
            onLoop({ start: current.start, end: current.end, enabled: true });
            seek(current.start);
          }}
        >
          <Repeat2 size={14} /> 이 8카운트 반복
        </button>
      </div>
    </section>
  );
}
