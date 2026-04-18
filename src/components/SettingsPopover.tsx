import { useEffect, useRef, useState } from "react";
import { Settings as SettingsIcon, Minus, Plus, Download, Check } from "lucide-react";
import {
  type FontFamily,
  FONT_LABELS,
  FONT_SIZES,
  AVAILABLE_MODELS,
  type Settings,
} from "@/lib/settings";
import type { UseUpdater } from "@/lib/updater";

export function SettingsPopover({
  settings,
  onUpdate,
  updater,
}: {
  settings: Settings;
  onUpdate: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  updater: UseUpdater;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const fontIdx = FONT_SIZES.indexOf(settings.fontSize);
  const activeModel = AVAILABLE_MODELS.find((m) => m.id === settings.model);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Settings"
        className="relative text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-accent)] transition-colors"
      >
        <SettingsIcon size={14} />
        {updater.hasPendingUpdate && (
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-[color:var(--color-accent)]" />
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-9 w-80 z-40 bg-[color:var(--color-background)] border border-[color:var(--color-border)] shadow-2xl max-h-[80vh] overflow-auto scroll-soft">
          <Section label="theme">
            <div className="flex items-center gap-3">
              <ThemeLink
                active={settings.theme === "light"}
                onClick={() => onUpdate("theme", "light")}
                label="light"
              />
              <span className="text-[color:var(--color-fg-dim)] text-xs">/</span>
              <ThemeLink
                active={settings.theme === "dark"}
                onClick={() => onUpdate("theme", "dark")}
                label="dark"
              />
            </div>
          </Section>

          <Section label="model">
            <select
              value={settings.model}
              onChange={(e) => onUpdate("model", e.target.value)}
              className="w-full bg-transparent border-b border-[color:var(--color-border)] px-0 h-8 text-sm focus:outline-none focus:border-[color:var(--color-accent)]"
            >
              {AVAILABLE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            {activeModel && (
              <p className="text-xs text-[color:var(--color-fg-muted)] mt-2 leading-relaxed">
                {activeModel.description}
              </p>
            )}
          </Section>

          <Section label="writing font">
            <div className="space-y-0.5">
              {(Object.keys(FONT_LABELS) as FontFamily[]).map((f) => (
                <button
                  key={f}
                  onClick={() => onUpdate("font", f)}
                  className={`w-full text-left px-0 h-7 text-sm transition-colors ${
                    settings.font === f
                      ? "text-[color:var(--color-accent)]"
                      : "text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)]"
                  }`}
                >
                  <span className="inline-block w-3 font-mono text-xs text-[color:var(--color-fg-dim)]">
                    {settings.font === f ? "●" : "·"}
                  </span>{" "}
                  {FONT_LABELS[f]}
                </button>
              ))}
            </div>
          </Section>

          <Section label="font size">
            <div className="flex items-center gap-4">
              <button
                onClick={() => onUpdate("fontSize", FONT_SIZES[Math.max(0, fontIdx - 1)])}
                disabled={fontIdx <= 0}
                className="text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-accent)] disabled:opacity-30 transition-colors"
              >
                <Minus size={14} />
              </button>
              <div className="flex-1 text-center font-mono text-sm tabular-nums">
                {settings.fontSize.toString().padStart(2, "0")}px
              </div>
              <button
                onClick={() =>
                  onUpdate("fontSize", FONT_SIZES[Math.min(FONT_SIZES.length - 1, fontIdx + 1)])
                }
                disabled={fontIdx >= FONT_SIZES.length - 1}
                className="text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-accent)] disabled:opacity-30 transition-colors"
              >
                <Plus size={14} />
              </button>
            </div>
          </Section>

          <Section label="updates" last>
            <UpdatesBlock updater={updater} />
          </Section>
        </div>
      )}
    </div>
  );
}

function UpdatesBlock({ updater }: { updater: UseUpdater }) {
  const { status, checkForUpdate, installUpdate } = updater;

  let line: React.ReactNode;
  let action: React.ReactNode = null;

  switch (status.kind) {
    case "idle":
      line = (
        <span className="text-[color:var(--color-fg-muted)]">
          ready to check
        </span>
      );
      break;
    case "checking":
      line = (
        <span className="text-[color:var(--color-fg-muted)]">
          checking for updates…
        </span>
      );
      break;
    case "up-to-date":
      line = (
        <span className="text-[color:var(--color-fg-muted)] inline-flex items-center gap-1.5">
          <Check size={12} className="text-[color:var(--color-success)]" />
          you're on the latest
        </span>
      );
      break;
    case "available":
      line = (
        <span className="text-[color:var(--color-fg)]">
          version <span className="text-[color:var(--color-accent)]">{status.version}</span> is available
        </span>
      );
      action = (
        <button
          onClick={() => installUpdate()}
          className="label label-row text-[color:var(--color-accent)] hover:text-[color:var(--color-accent-hi)] transition-colors"
        >
          <Download size={13} />
          <span>install update</span>
        </button>
      );
      break;
    case "downloading": {
      const pct =
        status.total && status.total > 0
          ? Math.min(100, Math.round((status.downloaded / status.total) * 100))
          : null;
      line = (
        <span className="text-[color:var(--color-fg-muted)]">
          downloading {status.version}
          {pct != null ? ` · ${pct}%` : ""}
        </span>
      );
      break;
    }
    case "ready":
      line = (
        <span className="text-[color:var(--color-fg)]">
          {status.version} ready — restarting…
        </span>
      );
      break;
    case "error":
      line = (
        <span className="text-[color:var(--color-danger)] break-words">
          {status.message}
        </span>
      );
      action = (
        <button
          onClick={() => checkForUpdate()}
          className="label text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)] transition-colors"
        >
          retry
        </button>
      );
      break;
  }

  const canCheck =
    status.kind === "idle" ||
    status.kind === "up-to-date" ||
    status.kind === "error";

  return (
    <div className="space-y-3">
      <div className="text-xs leading-relaxed">{line}</div>
      <div className="flex items-center justify-between">
        {action ?? <span />}
        {canCheck && (
          <button
            onClick={() => checkForUpdate()}
            className="label text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)] transition-colors"
          >
            check for updates
          </button>
        )}
      </div>
    </div>
  );
}

function Section({
  label,
  last,
  children,
}: {
  label: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`px-5 py-4 ${last ? "" : "border-b border-[color:var(--color-border)]"}`}>
      <div className="label text-[color:var(--color-fg-muted)] mb-3">{label}</div>
      {children}
    </div>
  );
}

function ThemeLink({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`label transition-colors ${
        active
          ? "text-[color:var(--color-accent)]"
          : "text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)]"
      }`}
    >
      {label}
    </button>
  );
}
