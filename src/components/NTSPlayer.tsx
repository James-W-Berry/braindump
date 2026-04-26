import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { fetch } from "@tauri-apps/plugin-http";
import type { OtakuEpisode } from "@/lib/settings";

/**
 * NTS Radio player for the Capture view. Two modes under the hood:
 *
 *   • **Live** — plain `<audio>` element pointed at NTS 1's stream URL.
 *     Works in dev + prod Tauri builds because there's no iframe to
 *     hit the `tauri://localhost` origin problem that broke YouTube.
 *
 *   • **Archive** — a specific past Otaku episode. Audio lives on
 *     Mixcloud, not NTS's CDN, so playback goes through Mixcloud's
 *     embed widget iframe. Verified to work from the packaged `.app`.
 *
 * The caller chooses between the two by passing `activeEpisode` —
 * null means live, a set value means play that archive episode.
 */

export type MusicMode = "thumbnail" | "floating" | "background";

const NTS_STREAM_URL = "https://stream-relay-geo.ntslive.net/stream";
const NTS_LIVE_API = "https://www.nts.live/api/v2/live";
const NTS_OTAKU_EPISODES_API =
  "https://www.nts.live/api/v2/shows/otaku/episodes";
const NOW_PLAYING_POLL_MS = 60_000;

export interface NowPlaying {
  showName: string;
  broadcastTitle: string;
  coverUrl: string | null;
}

/**
 * Poll the NTS "now live" endpoint for channel 1 metadata. Returns
 * null while loading and on any failure — callers fall back to a
 * static "NTS 1" label.
 */
export function useNowPlaying(enabled: boolean): NowPlaying | null {
  const [data, setData] = useState<NowPlaying | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const fetchOnce = async () => {
      try {
        const resp = await fetch(NTS_LIVE_API);
        if (!resp.ok) return;
        const json = (await resp.json()) as unknown;
        const next = pickChannelOne(json);
        if (!cancelled && next) setData(next);
      } catch {
        // Network hiccups are fine — we keep the last good value.
      }
    };

    fetchOnce();
    const id = window.setInterval(fetchOnce, NOW_PLAYING_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled]);

  return data;
}

function pickChannelOne(json: unknown): NowPlaying | null {
  if (!json || typeof json !== "object") return null;
  const results = (json as { results?: unknown }).results;
  if (!Array.isArray(results)) return null;
  const ch1 = results.find(
    (r) => r && typeof r === "object" && (r as { channel_name?: unknown }).channel_name === "1",
  ) as { now?: Record<string, unknown> } | undefined;
  const now = ch1?.now;
  if (!now) return null;
  const broadcastTitle =
    typeof now.broadcast_title === "string" ? now.broadcast_title : "";
  const embeds = now.embeds as { details?: Record<string, unknown> } | undefined;
  const details = embeds?.details;
  const showName =
    typeof details?.name === "string" && details.name.trim()
      ? (details.name as string)
      : broadcastTitle;
  const media = details?.media as { picture_large?: unknown } | undefined;
  const coverUrl =
    typeof media?.picture_large === "string" ? media.picture_large : null;
  if (!showName && !broadcastTitle) return null;
  return { showName, broadcastTitle, coverUrl };
}

export type EpisodesState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; episodes: OtakuEpisode[] };

/**
 * Fetch + paginate the full Otaku archive episode list on demand.
 *
 * The endpoint defaults to 12 results per page; the `metadata.count`
 * tells us the total. We kick off a second fetch with `limit=count`
 * once we know the total, to get everything in one shot.
 *
 * Caller controls when to start fetching by flipping `enabled` —
 * typically the first time the picker opens. Once loaded, the list
 * stays in state for the rest of the session.
 */
export function useOtakuEpisodes(enabled: boolean): EpisodesState {
  const [state, setState] = useState<EpisodesState>({ status: "idle" });

  useEffect(() => {
    if (!enabled || state.status !== "idle") return;
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      try {
        const probe = await fetch(`${NTS_OTAKU_EPISODES_API}?limit=100`);
        if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
        const json = (await probe.json()) as unknown;
        const total = readCount(json);
        let raw = readResults(json);
        if (total > raw.length) {
          // Second pass for the full run. Belt-and-braces — the first
          // call is usually enough.
          const full = await fetch(`${NTS_OTAKU_EPISODES_API}?limit=${total}`);
          if (full.ok) {
            const fullJson = (await full.json()) as unknown;
            const fullResults = readResults(fullJson);
            if (fullResults.length > raw.length) raw = fullResults;
          }
        }
        const episodes = raw
          .map(parseEpisode)
          .filter((e): e is OtakuEpisode => e !== null);
        if (!cancelled) setState({ status: "ready", episodes });
      } catch (e: unknown) {
        if (!cancelled) {
          const message = e instanceof Error ? e.message : String(e);
          setState({ status: "error", message });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // We deliberately only fire once on the enabled→true transition;
    // state.status self-guards re-runs via the early return above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return state;
}

function readCount(json: unknown): number {
  if (!json || typeof json !== "object") return 0;
  const meta = (json as { metadata?: { resultset?: { count?: unknown } } }).metadata;
  const n = meta?.resultset?.count;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function readResults(json: unknown): unknown[] {
  if (!json || typeof json !== "object") return [];
  const r = (json as { results?: unknown }).results;
  return Array.isArray(r) ? r : [];
}

function parseEpisode(raw: unknown): OtakuEpisode | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const slug = typeof r.episode_alias === "string" ? r.episode_alias : null;
  const title = typeof r.name === "string" ? r.name : null;
  const broadcast = typeof r.broadcast === "string" ? r.broadcast : null;
  if (!slug || !title || !broadcast) return null;
  const media = r.media as { picture_large?: unknown } | undefined;
  const coverUrl =
    typeof media?.picture_large === "string" ? media.picture_large : null;
  const mixcloudUrl = typeof r.mixcloud === "string" ? r.mixcloud : null;
  const mixcloudFeed = mixcloudUrl ? extractMixcloudFeed(mixcloudUrl) : null;
  if (!mixcloudFeed) return null;
  return { slug, title, broadcast, coverUrl, mixcloudFeed };
}

function extractMixcloudFeed(url: string): string | null {
  // "https://www.mixcloud.com/NTSRadio/otaku-foo-bar/" → "/NTSRadio/otaku-foo-bar/"
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith("mixcloud.com")) return null;
    return u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
  } catch {
    return null;
  }
}

function mixcloudWidgetUrl(feed: string): string {
  const encoded = encodeURIComponent(feed);
  // autoplay=1 — picking an episode implies playback should start
  // immediately. If the user's app state was paused, we correct that
  // via the Widget API (widget.pause()) once the widget is ready.
  return `https://www.mixcloud.com/widget/iframe/?feed=${encoded}&hide_cover=1&mini=1&light=1&autoplay=1`;
}

/**
 * Mixcloud's Widget API loader. Loads their script once per session
 * and memoizes the resulting `window.Mixcloud` namespace.
 *
 * We need this because Mixcloud doesn't expose direct MP3 URLs for
 * archive episodes (their audio hosting is Mixcloud-only for
 * DRM/royalty reasons). Playback has to go through their iframe widget;
 * the Widget API is the only way to control play/pause from outside
 * the iframe without losing playback position.
 *
 * Volume is *not* exposed by the API — that's a Mixcloud product
 * choice, probably tied to their royalty model. We can't work around
 * it; archive-mode users rely on system volume or the widget's own
 * controls (visible only in floating mode).
 */
let mixcloudApiPromise: Promise<MixcloudApi> | null = null;
interface MixcloudApi {
  PlayerWidget: (iframe: HTMLIFrameElement) => MixcloudWidget;
}
interface MixcloudWidget {
  ready: Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
}
function loadMixcloudApi(): Promise<MixcloudApi> {
  if (mixcloudApiPromise) return mixcloudApiPromise;
  const existing = (window as unknown as { Mixcloud?: MixcloudApi }).Mixcloud;
  if (existing) {
    mixcloudApiPromise = Promise.resolve(existing);
    return mixcloudApiPromise;
  }
  mixcloudApiPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://widget.mixcloud.com/media/js/widgetApi.js";
    script.async = true;
    script.onload = () => {
      const api = (window as unknown as { Mixcloud?: MixcloudApi }).Mixcloud;
      if (api) resolve(api);
      else reject(new Error("Mixcloud API loaded but window.Mixcloud missing"));
    };
    script.onerror = () => reject(new Error("Failed to load Mixcloud Widget API"));
    document.head.appendChild(script);
  });
  return mixcloudApiPromise;
}

/**
 * Bind a Mixcloud widget to an iframe and keep its play/pause state in
 * sync with the `playing` prop. Initialization is async — while we're
 * waiting for the API script + `widget.ready`, play/pause events are
 * queued via a ref so the freshest state wins if the user toggles
 * several times before the widget is ready.
 */
function useMixcloudSync(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  episodeSlug: string,
  playing: boolean,
) {
  const widgetRef = useRef<MixcloudWidget | null>(null);
  const playingRef = useRef(playing);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  // Initialize a new widget every time the episode changes — the
  // iframe remounts (keyed by slug) so the old widget handle is
  // useless. `playingRef` is read after the widget is ready so the
  // initial state reflects the user's latest toggle, not whatever was
  // current when this effect first fired.
  useEffect(() => {
    widgetRef.current = null;
    const iframe = iframeRef.current;
    if (!iframe) return;
    let cancelled = false;
    (async () => {
      try {
        const api = await loadMixcloudApi();
        if (cancelled) return;
        const widget = api.PlayerWidget(iframe);
        await widget.ready;
        if (cancelled) return;
        widgetRef.current = widget;
        if (playingRef.current) await widget.play();
        else await widget.pause();
      } catch {
        // Widget API unavailable (network, blocked script, etc.) —
        // playback still works via the widget's own inline controls
        // when the floating card is visible. Silent failure keeps the
        // app functional.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeSlug]);

  // Forward subsequent play/pause toggles to the widget.
  useEffect(() => {
    const w = widgetRef.current;
    if (!w) return;
    if (playing) w.play().catch(() => {});
    else w.pause().catch(() => {});
  }, [playing]);
}

/**
 * Dispatcher: live stream uses a plain `<audio>` that mounts on play
 * and unmounts on pause (nothing to preserve — the stream is always
 * "now"). Archive uses a Mixcloud iframe that must stay mounted across
 * pause and mode changes so playback position survives; that logic
 * lives in `ArchivePlayer`.
 */
export function NTSPlayer({
  playing,
  volume,
  mode,
  nowPlaying,
  activeEpisode,
  onClose,
}: {
  playing: boolean;
  /** 0..1 — only meaningful in live mode. Mixcloud doesn't expose
   * programmatic volume control via the Widget API. */
  volume: number;
  mode: MusicMode;
  /** Live metadata. Ignored when activeEpisode is set. */
  nowPlaying: NowPlaying | null;
  /** When set, play this archive episode via Mixcloud. */
  activeEpisode: OtakuEpisode | null;
  /** Dismiss the floating card. */
  onClose?: () => void;
}) {
  if (activeEpisode) {
    return (
      <ArchivePlayer
        playing={playing}
        mode={mode}
        episode={activeEpisode}
        onClose={onClose}
      />
    );
  }
  if (!playing) return null;
  return (
    <LivePlayer
      volume={volume}
      mode={mode}
      nowPlaying={nowPlaying}
      onClose={onClose}
    />
  );
}

function LivePlayer({
  volume,
  mode,
  nowPlaying,
  onClose,
}: {
  volume: number;
  mode: MusicMode;
  nowPlaying: NowPlaying | null;
  onClose?: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = audioRef.current;
    if (el) el.volume = clamp01(volume);
  }, [volume]);

  const audio = (
    <audio ref={audioRef} src={NTS_STREAM_URL} autoPlay preload="none" />
  );

  if (mode === "floating") {
    return (
      <div
        style={{ position: "absolute", bottom: 64, right: 16, zIndex: 20 }}
        className="w-[300px] shadow-[0_10px_40px_-10px_rgba(0,0,0,0.45)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)]"
      >
        <div className="relative">
          {nowPlaying?.coverUrl ? (
            <img
              src={nowPlaying.coverUrl}
              alt=""
              aria-hidden="true"
              className="w-[300px] h-[170px] object-cover"
            />
          ) : (
            <div className="w-[300px] h-[170px] bg-[color:var(--color-surface-hi)] flex items-center justify-center text-[10px] font-mono uppercase tracking-[0.18em] text-[color:var(--color-fg-muted)]">
              NTS 1
            </div>
          )}
          <div className="px-2.5 py-2 border-t border-[color:var(--color-border)]">
            <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-[color:var(--color-accent)] mb-1">
              NTS 1 · live
            </div>
            <div className="text-[13px] leading-tight text-[color:var(--color-fg)] truncate">
              {nowPlaying?.showName ?? "…"}
            </div>
          </div>
          <div style={{ display: "none" }}>{audio}</div>
          {onClose && (
            <button
              onClick={onClose}
              title="minimize to thumbnail"
              className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-[color:var(--color-surface)] border border-[color:var(--color-border)] flex items-center justify-center text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)] transition-colors"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>
    );
  }

  // thumbnail + background — `<audio>` is invisible natively, just
  // render it directly. Footer chip / backdrop are drawn in App.tsx.
  return audio;
}

/**
 * Mixcloud iframe for archive playback. Stays mounted across pause and
 * mode switches so position is preserved — the Widget API is used to
 * forward play/pause instead of unmounting.
 *
 * Mode switches don't remount the iframe because the tree shape is
 * stable: the card chrome is toggled via `display: none`, not
 * conditional JSX, so the iframe keeps its position in the children
 * array across re-renders.
 */
function ArchivePlayer({
  playing,
  mode,
  episode,
  onClose,
}: {
  playing: boolean;
  mode: MusicMode;
  episode: OtakuEpisode;
  onClose?: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  useMixcloudSync(iframeRef, episode.slug, playing);

  const isFloating = mode === "floating";

  return (
    <div
      style={
        isFloating
          ? { position: "absolute", bottom: 64, right: 16, zIndex: 20 }
          : {
              position: "fixed",
              top: -9999,
              left: 0,
              width: 300,
              pointerEvents: "none",
              opacity: 0,
            }
      }
      className={
        isFloating
          ? "w-[300px] shadow-[0_10px_40px_-10px_rgba(0,0,0,0.45)] border border-[color:var(--color-border)] bg-[color:var(--color-surface)]"
          : ""
      }
    >
      <div className="relative">
        <div style={{ display: isFloating ? "block" : "none" }}>
          {episode.coverUrl ? (
            <img
              src={episode.coverUrl}
              alt=""
              aria-hidden="true"
              className="w-[300px] h-[170px] object-cover"
            />
          ) : (
            <div className="w-[300px] h-[170px] bg-[color:var(--color-surface-hi)] flex items-center justify-center text-[10px] font-mono uppercase tracking-[0.18em] text-[color:var(--color-fg-muted)]">
              NTS
            </div>
          )}
          <div className="px-2.5 py-2 border-t border-[color:var(--color-border)]">
            <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-[color:var(--color-accent)] mb-1">
              NTS · archive
            </div>
            <div className="text-[13px] leading-tight text-[color:var(--color-fg)] truncate">
              {episode.title}
            </div>
            <div className="mt-1 text-[10px] font-mono text-[color:var(--color-fg-dim)]">
              {formatBroadcastDate(episode.broadcast)}
            </div>
          </div>
        </div>
        <div
          className={
            isFloating ? "border-t border-[color:var(--color-border)]" : ""
          }
        >
          <iframe
            key={episode.slug}
            ref={iframeRef}
            src={mixcloudWidgetUrl(episode.mixcloudFeed)}
            allow="autoplay; encrypted-media"
            title={`NTS · ${episode.title}`}
            style={{ border: 0, display: "block" }}
            className="w-full h-[60px] bg-black"
          />
        </div>
        {isFloating && onClose && (
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

/** Format "2026-03-17T11:00:00+00:00" → "17 Mar 2026". */
export function formatBroadcastDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
