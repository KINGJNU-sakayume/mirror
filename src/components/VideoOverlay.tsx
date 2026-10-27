import { useEffect, useRef, type MutableRefObject } from "react";
import {
  BONES,
  HAND_BASES,
  POSE_COUNT,
  VISIBLE_JOINTS,
  isHandJoint,
  isLeftJoint,
  type Landmark,
  type MotionData,
  type MotionFrame,
} from "../motion/types";
// Pose landmarks plus crop-refined hand landmarks, in full-frame normalized coordinates.
function landmark(frame: MotionFrame, i: number): Landmark | null {
  if (i < POSE_COUNT) return frame.image?.[i] ?? null;
  const side = i >= HAND_BASES[1] ? 1 : 0;
  return frame.hands?.[side]?.image[i - HAND_BASES[side]] ?? null;
}
import { sampleMotion } from "../motion/preprocess";
export function VideoOverlay({
  video,
  motion,
  clock,
  enabled,
  selected,
}: {
  video: HTMLVideoElement | null;
  motion: MotionData | null;
  clock: MutableRefObject<number>;
  enabled: boolean;
  selected: number | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const draw = () => {
      const w = canvas.clientWidth,
        h = canvas.clientHeight,
        dpr = Math.min(devicePixelRatio, 2);
      if (
        canvas.width !== Math.round(w * dpr) ||
        canvas.height !== Math.round(h * dpr)
      ) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const frame =
        enabled && motion ? sampleMotion(motion, clock.current) : null;
      if (frame?.image) {
        const scale = Math.min(w / video.videoWidth, h / video.videoHeight),
          vw = video.videoWidth * scale,
          vh = video.videoHeight * scale,
          ox = (w - vw) / 2,
          oy = (h - vh) / 2;
        const point = (p: Landmark) => [ox + p.x * vw, oy + p.y * vh];
        for (const [a, b] of BONES) {
          const pa = landmark(frame, a),
            pb = landmark(frame, b);
          if (!pa || !pb || Math.min(pa.visibility, pb.visibility) < 0.2)
            continue;
          ctx.lineWidth = isHandJoint(a) ? 1.25 : 2;
          ctx.setLineDash(
            Math.min(pa.visibility, pb.visibility) < 0.55 ? [4, 4] : [],
          );
          ctx.strokeStyle =
            Math.min(pa.visibility, pb.visibility) < 0.55
              ? "#d4a46a"
              : isLeftJoint(a)
                ? "#c5dca1"
                : "#f1f1e8";
          ctx.beginPath();
          ctx.moveTo(...(point(pa) as [number, number]));
          ctx.lineTo(...(point(pb) as [number, number]));
          ctx.stroke();
        }
        ctx.setLineDash([]);
        for (const i of VISIBLE_JOINTS) {
          const p = landmark(frame, i);
          if (!p || p.visibility < 0.2) continue;
          ctx.fillStyle =
            i === selected ? "#f2c574" : isLeftJoint(i) ? "#c5dca1" : "#f1f1e8";
          ctx.beginPath();
          ctx.arc(
            ...(point(p) as [number, number]),
            i === selected ? 5 : isHandJoint(i) ? 1.8 : 3,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [video, motion, clock, enabled, selected]);
  return <canvas ref={ref} className="video-overlay" aria-hidden="true" />;
}
