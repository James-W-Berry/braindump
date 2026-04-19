import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type Theme = "light" | "dark";
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

export const LOCAL_MODEL_ID = "qwen2.5:7b";
export const LOCAL_MODEL_LABEL = "Qwen 2.5 7B";

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
}

const DEFAULTS: Settings = {
  theme: "light",
  font: "sans",
  fontSize: 18,
  groupBy: "priority",
  hideDone: false,
  model: DEFAULT_MODEL_ID,
  localModel: LOCAL_MODEL_ID,
  provider: null,
  activeProjectId: null,
  view: "capture",
};

const STORAGE_KEY = "braindump.settings";

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
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
    // Tell the OS window chrome (titlebar, traffic lights) to match our theme.
    getCurrentWindow()
      .setTheme(settings.theme)
      .catch(() => {});
  }, [settings]);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
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
