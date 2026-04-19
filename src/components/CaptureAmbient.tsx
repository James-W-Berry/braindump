import { useEffect, useRef } from "react";

/**
 * Theme-tinted motion backdrop behind the Capture textarea. All layers
 * are pure CSS — palette swaps happen via --ambient-* custom properties
 * in index.css. Motion pauses when the window loses focus to save
 * battery and respects prefers-reduced-motion via a CSS media query.
 */
export function CaptureAmbient({ enabled }: { enabled: boolean }) {
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;
    const el = layerRef.current;
    if (!el) return;
    // Pause on blur, resume on focus. document.hasFocus covers the
    // initial state (mounting while the app isn't frontmost).
    const setPaused = (paused: boolean) => {
      el.dataset.paused = paused ? "true" : "false";
    };
    setPaused(!document.hasFocus());
    const onFocus = () => setPaused(false);
    const onBlur = () => setPaused(true);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div ref={layerRef} className="ambient-layer" aria-hidden="true">
      <div className="ambient-grid" />
      <div className="ambient-sun" />
      <div className="ambient-band band-1" />
      <div className="ambient-band band-2" />
      <div className="ambient-band band-3" />
      <Waveform className="ambient-wave wave-1" amplitude={22} />
      <Waveform className="ambient-wave wave-2" amplitude={14} frequency={2.2} />
      <div className="ambient-scanlines" />
    </div>
  );
}

/**
 * A seamless horizontal sine wave rendered as a 300%-wide SVG path.
 * The path contains three full cycles; CSS slides it by -33.333% on
 * loop, so frame-end aligns with frame-start with no visible jump.
 */
function Waveform({
  className,
  amplitude = 20,
  frequency = 1.4,
}: {
  className: string;
  amplitude?: number;
  frequency?: number;
}) {
  // Path is built in a 0..300 x 0..100 viewBox — each 100 units = one
  // repeat. Three repeats means translateX(-33.333%) is the loop seam.
  const path = buildSinePath(amplitude, frequency);
  return (
    <svg
      className={className}
      viewBox="0 0 300 100"
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.3}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function buildSinePath(amp: number, freq: number): string {
  const segments: string[] = [];
  const step = 2;
  for (let x = 0; x <= 300; x += step) {
    const y = 50 + Math.sin((x / 100) * Math.PI * 2 * freq) * amp;
    segments.push(`${x === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(2)}`);
  }
  return segments.join(" ");
}
