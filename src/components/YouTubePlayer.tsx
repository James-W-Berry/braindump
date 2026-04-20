import { useEffect, useMemo, useRef } from "react";
import { X } from "lucide-react";

/**
 * YouTube embed for the Capture view — plain `<iframe>` form.
 *
 * Earlier revisions used YouTube's IFrame Player API for fine-grained
 * JS control (play/pause, volume, position). That path surfaces as
 * "Error 153" inside the player when the parent document's origin is
 * anything other than an http(s) URL, and packaged Tauri apps serve
 * their frontend from `tauri://localhost`, which YouTube's embed
 * rejects during its postMessage handshake. Neither `host`, `origin`,
 * nor iframe `allow` tweaks persuade it otherwise. Safari UA alone
 * isn't enough.
 *
 * The plain embed has no handshake — it just loads the video and
 * plays it. Tradeoffs vs. the API:
 *   • External play/pause toggle works by mounting / unmounting the
 *     iframe. Toggling pause does NOT preserve position — when it
 *     remounts, the video starts fresh (optionally seeking to a
 *     `start` param passed on the URL).
 *   • Programmatic volume is gone. Users adjust via YouTube's own
 *     controls inside the iframe, or the OS volume.
 *   • Mid-session position tracking is gone, so per-video "resume"
 *     only fires on the FIRST mount of a video after app launch —
 *     once the user pauses, the saved position stays frozen.
 *
 * The three presentation modes and the hover popup for thumbnail mode
 * all still work — the CSS-only positioning strategy is unchanged.
 * Switching modes while playing preserves position because the same
 * iframe DOM node survives the style changes.
 */

export type MusicMode = "thumbnail" | "floating" | "background";

const VIDEO_ID_PATTERNS: RegExp[] = [
  /[?&]v=([a-zA-Z0-9_-]{11})/,
  /youtu\.be\/([a-zA-Z0-9_-]{11})/,
  /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
  /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
];

export function parseYouTubeId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  for (const p of VIDEO_ID_PATTERNS) {
    const m = s.match(p);
    if (m) return m[1];
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  return null;
}

export function YouTubePlayer({
  url,
  playing,
  mode,
  thumbnailRect,
  thumbnailHovered,
  onSetThumbnailHovered,
  onClose,
  startSeconds,
}: {
  url: string | null;
  playing: boolean;
  mode: MusicMode;
  thumbnailRect: DOMRect | null;
  thumbnailHovered: boolean;
  onSetThumbnailHovered: (hovered: boolean) => void;
  onClose?: () => void;
  /** Seek offset on the FIRST mount for this video (seconds). */
  startSeconds?: number;
}) {
  const videoId = useMemo(() => parseYouTubeId(url), [url]);
  const hideTimerRef = useRef<number | null>(null);

  // Build the embed URL. Only depends on the video ID + the saved
  // seek position — never on `playing`, because toggling play is a
  // mount/unmount at the parent level rather than a URL change, so
  // the iframe doesn't reload mid-session when the user adjusts
  // other state.
  const src = useMemo(() => {
    if (!videoId) return null;
    const p = new URLSearchParams({
      autoplay: "1",
      controls: "1",
      modestbranding: "1",
      rel: "0",
      playsinline: "1",
    });
    if (startSeconds && startSeconds >= 3) {
      p.set("start", String(Math.floor(startSeconds)));
    }
    return `https://www.youtube-nocookie.com/embed/${videoId}?${p.toString()}`;
  }, [videoId, startSeconds]);

  // Compute the wrapper's style + whether the close button and
  // hover-intercept handlers are active for the current mode.
  const {
    style,
    showClose,
    hoverHandlers,
  }: {
    style: React.CSSProperties;
    showClose: boolean;
    hoverHandlers: {
      onMouseEnter?: React.MouseEventHandler;
      onMouseLeave?: React.MouseEventHandler;
    };
  } = useMemo(() => {
    const offscreen: React.CSSProperties = {
      position: "fixed",
      top: -9999,
      left: 0,
      pointerEvents: "none",
      opacity: 0,
    };

    if (mode === "background") {
      // Audio-only — the bg thumbnail image handles the visual.
      return { style: offscreen, showClose: false, hoverHandlers: {} };
    }

    if (mode === "floating") {
      return {
        style: {
          position: "absolute",
          bottom: 64,
          right: 16,
          zIndex: 20,
        },
        showClose: !!onClose,
        hoverHandlers: {},
      };
    }

    // thumbnail mode — popup above the footer thumbnail button.
    if (thumbnailHovered && thumbnailRect) {
      const bottom = Math.max(
        8,
        window.innerHeight - thumbnailRect.top + 4,
      );
      const left = Math.max(8, thumbnailRect.left);
      return {
        style: {
          position: "fixed",
          bottom,
          left,
          zIndex: 30,
          transition: "opacity 120ms ease",
          opacity: 1,
        },
        showClose: false,
        hoverHandlers: {
          onMouseEnter: () => {
            if (hideTimerRef.current) {
              clearTimeout(hideTimerRef.current);
              hideTimerRef.current = null;
            }
            onSetThumbnailHovered(true);
          },
          onMouseLeave: () => {
            if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
            hideTimerRef.current = window.setTimeout(() => {
              onSetThumbnailHovered(false);
              hideTimerRef.current = null;
            }, 180);
          },
        },
      };
    }
    return { style: offscreen, showClose: false, hoverHandlers: {} };
  }, [mode, thumbnailHovered, thumbnailRect, onClose, onSetThumbnailHovered]);

  // Clean up hide timer on unmount.
  useEffect(() => {
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, []);

  // Nothing to render until we have a valid video AND the user wants
  // it playing. Unmounting on `!playing` is the fastest way to stop
  // the audio without an API — the iframe is gone.
  if (!videoId || !playing || !src) return null;

  return (
    <div
      style={style}
      onMouseEnter={hoverHandlers.onMouseEnter}
      onMouseLeave={hoverHandlers.onMouseLeave}
      className="w-[240px] shadow-[0_10px_40px_-10px_rgba(0,0,0,0.45)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)]"
    >
      <div className="relative">
        <iframe
          // Keying on videoId means changing video unmounts the old
          // iframe and mounts a fresh one, which is what we want so
          // `start` is re-read from the URL. Mode changes don't
          // change the key, so mode switches preserve position.
          key={videoId}
          src={src}
          width={240}
          height={135}
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          title="YouTube music"
          style={{ border: 0 }}
          className="w-[240px] h-[135px] bg-black"
        />
        {showClose && (
          <button
            onClick={onClose}
            title="stop"
            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-[color:var(--color-surface)] border border-[color:var(--color-border)] flex items-center justify-center text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)] transition-colors"
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * YouTube thumbnail URL for a given video ID and quality tier.
 *   • `default`      — 120×90, always available, fast.
 *   • `hq`           — 480×360, always available, a good balance.
 *   • `maxres`       — 1280×720, may 404 for some videos; caller should
 *     fall back to hq via an onError handler.
 */
export function youtubeThumbnailUrl(
  videoId: string,
  quality: "default" | "hq" | "maxres" = "hq",
): string {
  const suffix =
    quality === "maxres"
      ? "maxresdefault"
      : quality === "hq"
        ? "hqdefault"
        : "default";
  return `https://img.youtube.com/vi/${videoId}/${suffix}.jpg`;
}

/**
 * Resolve the title of a YouTube video via its public oEmbed endpoint.
 * Returns null on any failure (network, unembeddable video, CORS, etc.)
 * so callers can fall back to the URL without a throw path.
 */
export async function fetchYouTubeTitle(
  urlOrId: string,
): Promise<string | null> {
  try {
    const id = parseYouTubeId(urlOrId) ?? urlOrId;
    const canonical = `https://www.youtube.com/watch?v=${id}`;
    const resp = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(canonical)}&format=json`,
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as { title?: unknown };
    return typeof data.title === "string" ? data.title : null;
  } catch {
    return null;
  }
}
