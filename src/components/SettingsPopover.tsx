import { useEffect, useRef, useState } from "react";
import {
  Settings as SettingsIcon,
  Minus,
  Plus,
  Download,
  Check,
  Camera,
} from "lucide-react";
import {
  type FontFamily,
  FONT_LABELS,
  FONT_SIZES,
  AVAILABLE_MODELS,
  LOCAL_MODELS,
  findLocalModel,
  type Settings,
} from "@/lib/settings";
import type { UseUpdater } from "@/lib/updater";

export function SettingsPopover({
  settings,
  onUpdate,
  onOpenProviderWizard,
  onOpenScreenshot,
  updater,
}: {
  settings: Settings;
  onUpdate: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  onOpenProviderWizard: () => void;
  onOpenScreenshot: () => void;
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
  const activeLocalModel = findLocalModel(settings.localModel);

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
            <div className="flex items-center gap-3 flex-wrap">
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
              <span className="text-[color:var(--color-fg-dim)] text-xs">/</span>
              <ThemeLink
                active={settings.theme === "gilt"}
                onClick={() => onUpdate("theme", "gilt")}
                label="gilt"
              />
              <span className="text-[color:var(--color-fg-dim)] text-xs">/</span>
              <ThemeLink
                active={settings.theme === "vapor"}
                onClick={() => onUpdate("theme", "vapor")}
                label="vapor"
              />
            </div>
          </Section>

          <Section label="provider">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-[color:var(--color-fg)]">
                {settings.provider === "ollama" ? "Local · Ollama" : "Cloud · Claude"}
              </span>
              <button
                onClick={() => {
                  onOpenProviderWizard();
                  setOpen(false);
                }}
                className="label text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-accent)] transition-colors"
              >
                switch
              </button>
            </div>
            <p className="text-xs text-[color:var(--color-fg-muted)] mt-2 leading-relaxed">
              {settings.provider === "ollama"
                ? `Runs ${activeLocalModel?.label ?? settings.localModel} locally. Nothing leaves your device.`
                : "Sent to Anthropic's API for processing."}
            </p>
          </Section>

          {settings.provider === "ollama" && (
            <Section label="local model">
              <select
                value={settings.localModel}
                onChange={(e) => onUpdate("localModel", e.target.value)}
                className="w-full bg-transparent border-b border-[color:var(--color-border)] px-0 h-8 text-sm focus:outline-none focus:border-[color:var(--color-accent)]"
              >
                {LOCAL_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} · {m.paramSize} · ~{m.diskGB} GB
                  </option>
                ))}
              </select>
              {activeLocalModel && (
                <p className="text-xs text-[color:var(--color-fg-muted)] mt-2 leading-relaxed">
                  {activeLocalModel.description}
                </p>
              )}
              <p className="text-xs text-[color:var(--color-fg-dim)] mt-2 leading-relaxed">
                Switching doesn't auto-download. Re-run setup (Provider → switch)
                to pull a new model.
              </p>
            </Section>
          )}

          {settings.provider === "claude" && (
            <>
              <Section label="claude model">
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
              <Section label="claude cli path">
                <ClaudeCliPathInput
                  value={settings.claudeCliPath}
                  onSave={(p) => onUpdate("claudeCliPath", p)}
                />
                <p className="text-xs text-[color:var(--color-fg-dim)] mt-2 leading-relaxed">
                  Leave blank to auto-detect. Set only if Braindump can't find
                  your CLI. Run <span className="font-mono">which claude</span>{" "}
                  in a terminal to get the path.
                </p>
              </Section>
            </>
          )}

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

          <Section label="screenshot">
            <button
              onClick={() => {
                onOpenScreenshot();
                setOpen(false);
              }}
              className="label label-row text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-accent)] transition-colors"
            >
              <Camera size={13} />
              <span>open studio</span>
            </button>
            <p className="text-xs text-[color:var(--color-fg-dim)] mt-2 leading-relaxed">
              Capture a matted, shareable snapshot of Braindump.
            </p>
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
  const { status, currentVersion, checkForUpdate, installUpdate } = updater;

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
      <div className="flex items-center justify-between gap-3">
        <span className="label text-[color:var(--color-fg-dim)]">installed</span>
        <span className="font-mono text-xs text-[color:var(--color-fg-muted)] tabular-nums">
          {currentVersion ? `v${currentVersion}` : "—"}
        </span>
      </div>
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

function ClaudeCliPathInput({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (path: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  function commit() {
    const trimmed = draft.trim();
    onSave(trimmed || null);
  }

  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        }
      }}
      placeholder="auto-detect"
      spellCheck={false}
      className="w-full bg-transparent border-b border-[color:var(--color-border)] px-0 h-8 text-xs font-mono focus:outline-none focus:border-[color:var(--color-accent)] placeholder:text-[color:var(--color-fg-dim)]"
    />
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
