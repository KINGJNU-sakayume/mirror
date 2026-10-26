import { useCallback, useEffect, useRef, useState } from "react";
import { clamp } from "../motion/math";
import { loopTarget, type LoopRange } from "./timing";
export function usePlayback(
  video: HTMLVideoElement | null,
  duration: number,
  loop: LoopRange,
) {
  const [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1),
    [volume, setVolume] = useState(0.8),
    [error, setError] = useState("");
  const clock = useRef(0),
    loopRef = useRef(loop);
  loopRef.current = loop;
  const seek = useCallback(
    (value: number) => {
      if (video) {
        const target = clamp(value, 0, duration);
        video.currentTime = target;
        clock.current = target;
        setTime(target);
      }
    },
    [video, duration],
  );
  const toggle = useCallback(async () => {
    if (!video) return;
    if (video.paused) {
      if (video.ended)
        video.currentTime = loopRef.current.enabled ? loopRef.current.start : 0;
      try {
        await video.play();
      } catch {
        setError("영상을 재생할 수 없습니다. 지원하는 코덱인지 확인해 주세요.");
      }
    } else video.pause();
  }, [video]);
  useEffect(() => {
    if (!video) return;
    let raf = 0,
      frame = 0,
      disposed = false,
      lastUi = 0;
    const update = (now = performance.now()) => {
      const target = loopTarget(video.currentTime, loopRef.current, duration);
      if (target !== null && !video.seeking) video.currentTime = target;
      clock.current = video.currentTime;
      if (now - lastUi > 32 || video.paused) {
        setTime(video.currentTime);
        lastUi = now;
      }
    };
    const tick = (now: number) => {
      if (disposed) return;
      update(now);
      raf = requestAnimationFrame(tick);
    };
    const videoFrame = () => {
      if (disposed) return;
      update();
      frame = video.requestVideoFrameCallback(videoFrame);
    };
    const changed = () => {
      update();
      setPlaying(!video.paused && !video.ended);
    };
    const ended = () => {
      const l = loopRef.current;
      if (l.enabled && l.end - l.start >= 0.05) {
        video.currentTime = l.start;
        void video
          .play()
          .catch(() => setError("구간 반복 재생을 다시 시작해 주세요."));
      } else setPlaying(false);
    };
    ["play", "pause", "seeked", "timeupdate"].forEach((e) =>
      video.addEventListener(e, changed),
    );
    video.addEventListener("ended", ended);
    raf = requestAnimationFrame(tick);
    if ("requestVideoFrameCallback" in video)
      frame = video.requestVideoFrameCallback(videoFrame);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (frame) video.cancelVideoFrameCallback(frame);
      ["play", "pause", "seeked", "timeupdate"].forEach((e) =>
        video.removeEventListener(e, changed),
      );
      video.removeEventListener("ended", ended);
    };
  }, [video, duration]);
  useEffect(() => {
    if (video) video.playbackRate = speed;
  }, [video, speed]);
  useEffect(() => {
    if (video) {
      video.volume = volume;
      video.muted = volume === 0;
    }
  }, [video, volume]);
  useEffect(() => {
    clock.current = 0;
    setTime(0);
    setPlaying(false);
    setError("");
  }, [video, duration]);
  const step = (direction: number) => {
    video?.pause();
    seek((video?.currentTime ?? 0) + direction / 30);
  };
  return {
    time,
    clock,
    playing,
    speed,
    setSpeed,
    volume,
    setVolume,
    seek,
    toggle,
    step,
    error,
    clearError: () => setError(""),
  };
}
