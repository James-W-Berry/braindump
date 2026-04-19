import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type Theme = "light" | "dark" | "vapor" | "gilt";

/**
 * A YouTube video the user has played before. Tracked in a capped LRU
 * list so the URL input can double as an autocomplete showing the
 * user's own favorites / most-used streams.
 */
export interface MusicRecent {
  /** 11-character YouTube video ID — the unique key. */
  id: string;
  /** Original URL the user pasted (or derived from the ID). */
  url: string;
  /** Fetched title via oEmbed. Null when we couldn't resolve it. */
  title: string | null;
  /** When this entry last became the active video, ms since epoch. */
  lastUsed: number;
  /**
   * Last known playback position in seconds. When the user returns to
   * this video the player is told to seek here so sessions resume
   * where they left off. Cleared to 0 on end-of-video.
   */
  lastPosition?: number;
}

export const MAX_MUSIC_RECENTS = 20;
export type FontFamily = "sans" | "mono" | "serif" | "system";
export type GroupBy = "priority" | "topic" | "category";

export interface ModelOption {
  id: string;
  label: string;
  description: string;
}

export const AVAILABLE_MODELS: ModelOption[] = [
  {
    id: "claude-sonnet-4-6",
    label: "Sonnet 4.6",
    description: "Default. Balanced reasoning + speed. Good judgment on correlations.",
  },
  {
    id: "claude-opus-4-7",
    label: "Opus 4.7",
    description: "Most capable. Slower + more expensive. Overkill for most dumps.",
  },
  {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    description: "Fastest + cheapest. Good for simple extraction; may miss subtle links.",
  },
  {
    id: "claude-sonnet-4-5",
    label: "Sonnet 4.5",
    description: "Previous Sonnet. Use if you prefer its style or cost profile.",
  },
];

export const DEFAULT_MODEL_ID = "claude-sonnet-4-6";

export type Provider = "claude" | "ollama";

export type LocalTier = "baseline" | "capable" | "reasoning" | "premium";

export interface LocalModelOption {
  id: string;
  label: string;
  paramSize: string;
  diskGB: number;
  minRamGB: number;
  tier: LocalTier;
  description: string;
}

export const LOCAL_MODELS: LocalModelOption[] = [
  {
    id: "qwen2.5:7b",
    label: "Qwen 2.5 7B",
    paramSize: "7B",
    diskGB: 4.7,
    minRamGB: 8,
    tier: "baseline",
    description:
      "Fastest, lightest. Good enough for capture + organize on any laptop.",
  },
  {
    id: "gemma3:12b",
    label: "Gemma 3 12B",
    paramSize: "12B",
    diskGB: 8.1,
    minRamGB: 16,
    tier: "baseline",
    description:
      "Google-tuned. Stronger safety calibration than Qwen — better refusal behavior in sensitive contexts.",
  },
  {
    id: "gemma3:27b",
    label: "Gemma 3 27B",
    paramSize: "27B",
    diskGB: 17,
    minRamGB: 32,
    tier: "capable",
    description:
      "Sweet spot for 32 GB machines. Best out-of-box safety behavior among runnable-locally options.",
  },
  {
    id: "qwen2.5:32b",
    label: "Qwen 2.5 32B",
    paramSize: "32B",
    diskGB: 19,
    minRamGB: 32,
    tier: "capable",
    description:
      "Best instruction-following in class. Dense — suits long-form reflection and multi-item extraction.",
  },
  {
    id: "deepseek-r1:32b",
    label: "DeepSeek R1 32B",
    paramSize: "32B",
    diskGB: 20,
    minRamGB: 32,
    tier: "reasoning",
    description:
      "Deep chain-of-thought. Slower per capture but better at cross-item pattern recognition.",
  },
  {
    id: "qwen2.5:72b",
    label: "Qwen 2.5 72B",
    paramSize: "72B",
    diskGB: 42,
    minRamGB: 64,
    tier: "premium",
    description:
      "Flagship. Premium quality, slow even on 64 GB. Pick only if you have a Pro/Max machine.",
  },
];

export const DEFAULT_LOCAL_MODEL_ID = "qwen2.5:7b";

export function findLocalModel(id: string): LocalModelOption | undefined {
  return LOCAL_MODELS.find((m) => m.id === id);
}

/** Pick the strongest catalog model that fits the detected RAM. */
export function recommendLocalModel(ramGB: number): LocalModelOption {
  const fits = LOCAL_MODELS.filter((m) => ramGB === 0 || ramGB >= m.minRamGB);
  // Prefer a "capable" tier if we have the RAM for it.
  const capable = fits.find((m) => m.tier === "capable");
  if (capable) return capable;
  const last = fits[fits.length - 1];
  return last ?? LOCAL_MODELS[0];
}

export type PersistedView = "capture" | "items";

export interface Settings {
  theme: Theme;
  font: FontFamily;
  fontSize: number;
  groupBy: GroupBy;
  hideDone: boolean;
  model: string;
  localModel: string;
  provider: Provider | null;
  activeProjectId: number | null;
  view: PersistedView;
  /**
   * Optional absolute path to the `claude` CLI. Set by the user when the
   * bundled app's auto-detection can't find their install (e.g. an nvm node
   * version that isn't on the hardcoded candidate list).
   */
  claudeCliPath: string | null;
  /**
   * Animated, theme-tinted background layer behind the capture textarea.
   * On by default; users on very low-end machines can disable.
   */
  ambientBackground: boolean;
  /**
   * YouTube URL to play as ambient music on the Capture view. Supports
   * standard watch/short/embed/live URL forms and raw 11-char video IDs.
   * Null when the user hasn't set one yet.
   */
  musicUrl: string | null;
  /** Whether the music is currently playing. */
  musicPlaying: boolean;
  /** Music volume 0..1. */
  musicVolume: number;
  /**
   * How the YouTube player presents itself on the Capture view:
   *   • `thumbnail` — tiny video thumbnail in the footer; hover reveals
   *     a small player popup for controls.
   *   • `floating`  — a fixed 240×135 mini player pinned to the
   *     bottom-right of the writing area.
   *   • `background` — the video's thumbnail tiles behind the textarea
   *     at low opacity, replacing the animated backdrop. Audio only.
   */
  musicMode: "thumbnail" | "floating" | "background";
  /**
   * Recent YouTube videos the user has played. Most recent first,
   * capped at {@link MAX_MUSIC_RECENTS}. Surfaced by the URL input as
   * an autocomplete menu.
   */
  musicRecents: MusicRecent[];
}

const DEFAULTS: Settings = {
  theme: "light",
  font: "sans",
  fontSize: 18,
  groupBy: "priority",
  hideDone: false,
  model: DEFAULT_MODEL_ID,
  localModel: DEFAULT_LOCAL_MODEL_ID,
  provider: null,
  activeProjectId: null,
  view: "capture",
  claudeCliPath: null,
  ambientBackground: true,
  musicUrl: null,
  musicPlaying: false,
  musicVolume: 0.5,
  musicMode: "floating",
  musicRecents: [],
};

const STORAGE_KEY = "braindump.settings";

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const merged = { ...DEFAULTS, ...JSON.parse(raw) } as Settings;
    // JSON.stringify coerces NaN → null, so a bad persisted value lands here
    // as null and would override the sane default from the spread above.
    // Re-apply defaults for numeric fields that failed the round-trip.
    if (
      typeof merged.musicVolume !== "number" ||
      !Number.isFinite(merged.musicVolume)
    ) {
      merged.musicVolume = DEFAULTS.musicVolume;
    }
    if (
      typeof merged.fontSize !== "number" ||
      !Number.isFinite(merged.fontSize)
    ) {
      merged.fontSize = DEFAULTS.fontSize;
    }
    if (!Array.isArray(merged.musicRecents)) {
      merged.musicRecents = DEFAULTS.musicRecents;
    }
    return merged;
  } catch {
    return DEFAULTS;
  }
}

function save(s: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(() => load());

  useEffect(() => {
    save(settings);
    document.documentElement.dataset.theme = settings.theme;
    // Tell the OS window chrome (titlebar, traffic lights) to match. Tauri
    // only understands "light" | "dark"; vapor is dark-derived so we fall
    // through to "dark" there.
    const osTheme = settings.theme === "light" ? "light" : "dark";
    getCurrentWindow()
      .setTheme(osTheme)
      .catch(() => {});
  }, [settings]);

  function update<K extends keyof Settings>(
    key: K,
    value: Settings[K] | ((prev: Settings[K]) => Settings[K]),
  ) {
    setSettings((prev) => ({
      ...prev,
      [key]:
        typeof value === "function"
          ? (value as (p: Settings[K]) => Settings[K])(prev[key])
          : value,
    }));
  }

  return { settings, update };
}

export const FONT_STACKS: Record<FontFamily, string> = {
  sans: '"Inter", ui-sans-serif, system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
  serif: '"Merriweather", ui-serif, Georgia, serif',
  system: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
};

export const FONT_LABELS: Record<FontFamily, string> = {
  sans: "Sans (Inter)",
  mono: "Mono (JetBrains)",
  serif: "Serif (Merriweather)",
  system: "System default",
};

export const FONT_SIZES = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32];
