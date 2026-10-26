import { useEffect, useRef, type MutableRefObject } from "react";
import { BONES, BODY_JOINTS, type MotionData } from "../motion/types";
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
        const point = (i: number) => [
          ox + frame.image![i].x * vw,
          oy + frame.image![i].y * vh,
        ];
        ctx.lineWidth = 2;
        for (const [a, b] of BONES) {
          const pa = frame.image[a],
            pb = frame.image[b];
          if (Math.min(pa.visibility, pb.visibility) < 0.2) continue;
          ctx.setLineDash(
            Math.min(pa.visibility, pb.visibility) < 0.55 ? [4, 4] : [],
          );
          ctx.strokeStyle =
            Math.min(pa.visibility, pb.visibility) < 0.55
              ? "#d4a46a"
              : a % 2 === 1
                ? "#c5dca1"
                : "#f1f1e8";
          ctx.beginPath();
          ctx.moveTo(...(point(a) as [number, number]));
          ctx.lineTo(...(point(b) as [number, number]));
          ctx.stroke();
        }
        ctx.setLineDash([]);
        for (const i of BODY_JOINTS) {
          if (frame.image[i].visibility < 0.2) continue;
          ctx.fillStyle =
            i === selected ? "#f2c574" : i % 2 === 1 ? "#c5dca1" : "#f1f1e8";
          ctx.beginPath();
          ctx.arc(
            ...(point(i) as [number, number]),
            i === selected ? 5 : 3,
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
