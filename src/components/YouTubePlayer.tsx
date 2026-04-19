import { useEffect, useMemo, useRef } from "react";
import { X } from "lucide-react";

/**
 * Persistent YouTube player for the Capture view. Single iframe,
 * mounted once per video ID, repositioned via CSS for each of the
 * three presentation modes:
 *
 *   • `floating`   — 240×135 mini window pinned to the bottom-right.
 *   • `thumbnail`  — hidden off-screen until the footer thumbnail is
 *                    hovered; hover reveals the player above it.
 *   • `background` — permanently off-screen (audio only); the caller
 *                    paints a low-opacity thumbnail into the backdrop.
 *
 * The key invariant: the iframe's DOM parent NEVER changes between
 * modes. Moving an iframe via DOM append/insert forces the browser
 * to reload it; mutating its parent's `style.*` does not. That's how
 * we preserve the playback position when the user flips modes, and
 * why play/pause is driven through the IFrame Player API rather than
 * by re-rendering the component.
 */

export type MusicMode = "thumbnail" | "floating" | "background";

// Minimal YT IFrame API typing — just what we call into.
type YTPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  setVolume(v: number): void;
  loadVideoById(id: string): void;
  getCurrentTime(): number;
  getDuration(): number;
  getIframe(): HTMLIFrameElement | null;
  destroy(): void;
};

// YT.PlayerState values we care about (per the IFrame API docs).
const YT_STATE_ENDED = 0;
const YT_STATE_PLAYING = 1;
const YT_STATE_PAUSED = 2;

type YTNamespace = {
  Player: new (
    el: HTMLElement | string,
    opts: {
      /**
       * Iframe origin. `https://www.youtube-nocookie.com` has looser
       * third-party-cookie / storage requirements than the regular
       * `youtube.com` host, which matters inside WKWebView-backed
       * Tauri builds where the parent page lives on a custom scheme.
       */
      host?: string;
      height: string | number;
      width: string | number;
      videoId: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onStateChange?: (e: { target: YTPlayer; data: number }) => void;
        onError?: (e: { target: YTPlayer; data: number }) => void;
      };
    },
  ) => YTPlayer;
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;
function loadYTApi(): Promise<void> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    if (typeof window === "undefined") return;
    if (window.YT?.Player) {
      resolve();
      return;
    }
    const existing = document.querySelector(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    if (!existing) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
  });
  return apiPromise;
}

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
  volume,
  mode,
  thumbnailRect,
  thumbnailHovered,
  onSetThumbnailHovered,
  onClose,
  startSeconds,
  onProgress,
}: {
  url: string | null;
  playing: boolean;
  volume: number;
  mode: MusicMode;
  /** Viewport rect of the footer thumbnail button, used to place the
   *  hover popup. `null` until it has been measured by the parent. */
  thumbnailRect: DOMRect | null;
  /** Whether the thumbnail hover region (button or popup) is currently
   *  hovered. Drives visibility of the thumbnail-mode popup. */
  thumbnailHovered: boolean;
  onSetThumbnailHovered: (hovered: boolean) => void;
  /** When provided, shows a × close button on the mini window.
   *  Parent should only pass this in floating mode. */
  onClose?: () => void;
  /**
   * Where to resume playback (in seconds) when the iframe is first
   * created for this video. Ignored on subsequent re-renders — we don't
   * want to seek while the user is watching.
   */
  startSeconds?: number;
  /**
   * Notification sink for position updates. Called every few seconds
   * while playing, plus on pause, on end, and on teardown. The first
   * argument is the video ID so the parent can update the right entry
   * even after it has switched to a different video.
   */
  onProgress?: (videoId: string, seconds: number, ended: boolean) => void;
}) {
  const videoId = useMemo(() => parseYouTubeId(url), [url]);
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  // Hide-delay timer so the user can move the mouse from the
  // thumbnail button up to the popup without losing hover.
  const hideTimerRef = useRef<number | null>(null);
  // Stable ref to the onProgress callback so our internal interval
  // always calls the parent's latest handler (closure refresh) without
  // having to put it in the mount-effect's deps.
  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);
  // startSeconds changes whenever the parent saves a position, but we
  // only care about its value at iframe-creation time. A ref keeps the
  // mount effect from depending on it and re-running.
  const startSecondsRef = useRef(startSeconds);
  useEffect(() => {
    startSecondsRef.current = startSeconds;
  }, [startSeconds]);

  // Mount the iframe once per video ID. The container div is kept at
  // a constant position in the React tree, so mode changes trigger
  // style updates only — not an unmount/remount.
  useEffect(() => {
    if (!videoId || !hostRef.current) return;
    const capturedVideoId = videoId;
    const initialStart = Math.floor(startSecondsRef.current ?? 0);
    let cancelled = false;
    let progressInterval: number | null = null;
    let hasEnded = false;
    readyRef.current = false;

    const stopProgressInterval = () => {
      if (progressInterval != null) {
        clearInterval(progressInterval);
        progressInterval = null;
      }
    };
    const startProgressInterval = () => {
      if (progressInterval != null) return;
      progressInterval = window.setInterval(() => {
        const p = playerRef.current;
        if (!p) return;
        try {
          const t = p.getCurrentTime();
          if (Number.isFinite(t) && t > 0) {
            onProgressRef.current?.(capturedVideoId, t, false);
          }
        } catch {
          // getCurrentTime can throw if the player's being torn down.
        }
      }, 5000);
    };

    // YT.Player REPLACES the passed element with an iframe, so we
    // hand it a fresh inner div each time and keep the wrapper intact.
    const mount = document.createElement("div");
    hostRef.current.innerHTML = "";
    hostRef.current.appendChild(mount);

    loadYTApi().then(() => {
      if (cancelled || !window.YT) return;
      new window.YT.Player(mount, {
        // Use the privacy-enhanced host — WKWebView inside a packaged
        // Tauri app ships on a custom URL scheme, which the regular
        // `youtube.com` embed treats as an unknown origin and rejects
        // with error 153 ("player configuration error"). The nocookie
        // host doesn't rely on the same third-party-cookie guarantees,
        // so it accepts cross-origin postMessage from non-http origins.
        host: "https://www.youtube-nocookie.com",
        height: "135",
        width: "240",
        videoId,
        playerVars: {
          autoplay: playing ? 1 : 0,
          controls: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          // Intentionally NOT passing `origin`. In a packaged Tauri
          // app the document origin is `tauri://localhost`, which
          // YouTube rejects as invalid when it tries to validate the
          // postMessage target — surfaces as "Error 153" in the player
          // UI. Omitting origin lets YouTube fall back to `*`, which
          // browsers accept.
          // Only seek if the saved position is meaningful — a
          // low-single-digit `start` is often worse than 0 because
          // the intro/pre-roll hasn't loaded yet.
          ...(initialStart >= 3 ? { start: initialStart } : {}),
        },
        events: {
          onReady: ({ target }) => {
            if (cancelled) {
              try {
                target.destroy();
              } catch {
                // Destroy race — player may be mid-setup.
              }
              return;
            }
            playerRef.current = target;
            readyRef.current = true;
            // Ensure the generated iframe has the permissions YouTube's
            // player expects. Without `encrypted-media` some YouTube
            // content paths fail with "configuration error" even for
            // non-DRM'd streams, because the player checks for EME
            // availability during init.
            try {
              const iframe = target.getIframe?.();
              if (iframe) {
                iframe.allow =
                  "autoplay; encrypted-media; fullscreen; picture-in-picture";
              }
            } catch {
              // Ignore — best-effort.
            }
            try {
              target.setVolume(clamp01(volume) * 100);
              if (playing) target.playVideo();
              else target.pauseVideo();
            } catch {
              // API may be temporarily unavailable during init.
            }
          },
          onStateChange: ({ target, data }) => {
            if (cancelled) return;
            if (data === YT_STATE_PLAYING) {
              hasEnded = false;
              startProgressInterval();
            } else if (data === YT_STATE_PAUSED) {
              stopProgressInterval();
              try {
                const t = target.getCurrentTime();
                if (Number.isFinite(t) && t > 0) {
                  onProgressRef.current?.(capturedVideoId, t, false);
                }
              } catch {
                // Ignore read failures during transitions.
              }
            } else if (data === YT_STATE_ENDED) {
              hasEnded = true;
              stopProgressInterval();
              // Reset to 0 so next session replays from the start
              // rather than instantly re-ending.
              onProgressRef.current?.(capturedVideoId, 0, true);
            }
          },
          onError: ({ data }) => {
            // Surfaces 2 (bad param), 5 (HTML5 can't play), 100
            // (not found), 101/150 (embed-disabled by uploader), and
            // any internal codes like 153 (configuration). Logging
            // is best-effort; we don't retry from here.
            console.warn(
              `[YouTubePlayer] video ${capturedVideoId} error ${data}`,
            );
          },
        },
      });
    });

    return () => {
      cancelled = true;
      readyRef.current = false;
      stopProgressInterval();
      const p = playerRef.current;
      playerRef.current = null;
      if (p) {
        // Flush the final position for THIS video before we destroy
        // it — the onProgress handler uses the captured videoId so
        // it lands on the right entry even if the user already moved
        // on to a different video.
        if (!hasEnded) {
          try {
            const t = p.getCurrentTime();
            if (Number.isFinite(t) && t > 0) {
              onProgressRef.current?.(capturedVideoId, t, false);
            }
          } catch {
            // Ignore — we're tearing down anyway.
          }
        }
        try {
          p.destroy();
        } catch {
          // Best-effort teardown.
        }
      }
    };
    // `playing`, `volume`, and `startSeconds` are intentionally
    // omitted. They are applied via their own effects (or read via a
    // ref at mount time). Putting them here would re-mount the iframe
    // on every toggle and lose the video position — the exact bug
    // this whole shape exists to avoid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  useEffect(() => {
    if (!readyRef.current) return;
    const p = playerRef.current;
    if (!p) return;
    try {
      if (playing) p.playVideo();
      else p.pauseVideo();
    } catch {
      // Playback API may reject briefly during state transitions.
    }
  }, [playing]);

  useEffect(() => {
    if (!readyRef.current) return;
    const p = playerRef.current;
    if (!p) return;
    try {
      p.setVolume(clamp01(volume) * 100);
    } catch {
      // Volume API may reject briefly during state transitions.
    }
  }, [volume]);

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
      return { style: offscreen, showClose: false, hoverHandlers: {} };
    }

    if (mode === "floating") {
      // When the user closes the floating window, they expect the
      // audio to go quiet and the window to disappear — not just a
      // paused-but-visible player. `playing: false` hides the window
      // while keeping the iframe mounted, so resuming via the footer
      // Music2 button picks up from the same buffered position.
      if (!playing) {
        return { style: offscreen, showClose: false, hoverHandlers: {} };
      }
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
      // Place the popup so its bottom edge touches the top of the
      // thumbnail button (no visual gap means hover is continuous).
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
  }, [mode, playing, thumbnailHovered, thumbnailRect, onClose, onSetThumbnailHovered]);

  if (!videoId) return null;

  return (
    <div
      style={style}
      onMouseEnter={hoverHandlers.onMouseEnter}
      onMouseLeave={hoverHandlers.onMouseLeave}
      className="w-[240px] shadow-[0_10px_40px_-10px_rgba(0,0,0,0.45)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)]"
    >
      <div className="relative">
        <div ref={hostRef} className="w-[240px] h-[135px] bg-black" />
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

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

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
