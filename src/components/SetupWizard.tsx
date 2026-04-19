import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  X,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import {
  checkClaude,
  checkOllama,
  installOllama,
  launchOllama,
  pullOllamaModel,
  verifyOllamaSetup,
  openExternalUrl,
  onSetupProgress,
  formatBytes,
  systemRamGB,
  type ClaudeStatus,
  type OllamaStatus,
  type SetupProgress,
} from "@/lib/setup";
import {
  LOCAL_MODELS,
  DEFAULT_LOCAL_MODEL_ID,
  findLocalModel,
  recommendLocalModel,
  type LocalModelOption,
  type LocalTier,
  type Provider,
} from "@/lib/settings";

type Screen = "choose" | "local-pick" | "local-install";

type StepState =
  | { kind: "pending" }
  | { kind: "active"; message?: string; bytesDone?: number; bytesTotal?: number }
  | { kind: "done"; message?: string }
  | { kind: "error"; message: string };

interface InstallState {
  install: StepState;
  launch: StepState;
  pull: StepState;
  verify: StepState;
}

const INITIAL_INSTALL: InstallState = {
  install: { kind: "pending" },
  launch: { kind: "pending" },
  pull: { kind: "pending" },
  verify: { kind: "pending" },
};

export function SetupWizard({
  onComplete,
  onPickLocalModel,
  currentLocalModel,
  claudeCliPath,
  onUpdateClaudeCliPath,
  onCancel,
}: {
  onComplete: (provider: Provider) => void;
  onPickLocalModel: (id: string) => void;
  currentLocalModel: string;
  claudeCliPath: string | null;
  onUpdateClaudeCliPath: (path: string | null) => void;
  onCancel?: () => void;
}) {
  const [screen, setScreen] = useState<Screen>("choose");
  const [claude, setClaude] = useState<ClaudeStatus | null>(null);
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [ramGB, setRamGB] = useState<number>(0);
  const [selectedModelId, setSelectedModelId] =
    useState<string>(currentLocalModel || DEFAULT_LOCAL_MODEL_ID);

  async function refreshClaude(overridePath: string | null) {
    const status = await checkClaude(overridePath);
    setClaude(status);
    return status;
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      checkClaude(claudeCliPath),
      checkOllama(),
      systemRamGB(),
    ])
      .then(([c, o, ram]) => {
        if (cancelled) return;
        setClaude(c);
        setOllama(o);
        setRamGB(ram);
        // Upgrade the default selection once we know the hardware.
        setSelectedModelId((prev) => {
          const prevOption = findLocalModel(prev);
          if (prevOption && (ram === 0 || ram >= prevOption.minRamGB)) {
            return prev;
          }
          return recommendLocalModel(ram).id;
        });
        setChecking(false);
      })
      .catch(() => {
        if (cancelled) return;
        setChecking(false);
      });
    return () => {
      cancelled = true;
    };
    // Re-probe whenever the user edits the override path.
  }, [claudeCliPath]);

  return (
    <div className="h-full flex flex-col bg-[color:var(--color-background)]">
      <header
        data-tauri-drag-region
        className="flex items-center gap-3 pl-[100px] pr-4 h-12 border-b border-[color:var(--color-border)]"
      >
        <span
          data-tauri-drag-region
          className="flex items-center gap-2.5 text-[color:var(--color-fg)] pointer-events-none"
        >
          <span className="font-semibold uppercase tracking-[0.18em] text-[13px]">
            BRAINDUMP
          </span>
          <Logo size={22} className="text-[color:var(--color-accent)]" />
        </span>
        <span data-tauri-drag-region className="w-px h-4 hairline" />
        <span
          data-tauri-drag-region
          className="label text-[color:var(--color-fg-muted)] pointer-events-none"
        >
          {screen === "choose"
            ? "setup · provider"
            : screen === "local-pick"
              ? "setup · local · model"
              : "setup · local · install"}
        </span>
        {onCancel && (
          <>
            <div className="flex-1" data-tauri-drag-region />
            <button
              onClick={onCancel}
              title="close without changing provider"
              className="text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)] transition-colors"
            >
              <X size={16} />
            </button>
          </>
        )}
      </header>

      <main className="flex-1 overflow-auto scroll-soft">
        {screen === "choose" ? (
          <ChooseScreen
            checking={checking}
            claude={claude}
            ollama={ollama}
            claudeCliPath={claudeCliPath}
            onUpdateClaudeCliPath={onUpdateClaudeCliPath}
            onRefreshClaude={refreshClaude}
            onPickClaude={() => onComplete("claude")}
            onPickLocal={() => setScreen("local-pick")}
          />
        ) : screen === "local-pick" ? (
          <LocalPickScreen
            ramGB={ramGB}
            selectedId={selectedModelId}
            onSelect={setSelectedModelId}
            onContinue={() => {
              onPickLocalModel(selectedModelId);
              setScreen("local-install");
            }}
            onBack={() => setScreen("choose")}
          />
        ) : (
          <LocalInstallScreen
            initialOllama={ollama}
            modelId={selectedModelId}
            onDone={() => onComplete("ollama")}
            onBack={() => setScreen("local-pick")}
          />
        )}
      </main>
    </div>
  );
}

function ChooseScreen({
  checking,
  claude,
  ollama,
  claudeCliPath,
  onUpdateClaudeCliPath,
  onRefreshClaude,
  onPickClaude,
  onPickLocal,
}: {
  checking: boolean;
  claude: ClaudeStatus | null;
  ollama: OllamaStatus | null;
  claudeCliPath: string | null;
  onUpdateClaudeCliPath: (path: string | null) => void;
  onRefreshClaude: (path: string | null) => Promise<ClaudeStatus>;
  onPickClaude: () => void;
  onPickLocal: () => void;
}) {
  const ollamaReady =
    !!ollama?.binary_present &&
    !!ollama?.service_running &&
    !!ollama?.has_required_model;

  return (
    <div className="max-w-4xl mx-auto px-10 py-12">
      <h1 className="text-2xl font-semibold text-[color:var(--color-fg)] mb-2">
        How should Braindump process your captures?
      </h1>
      <p className="text-sm text-[color:var(--color-fg-muted)] mb-10 max-w-2xl leading-relaxed">
        You can change this anytime in settings. Captures stay on your device in
        both cases — the choice is where the AI that organizes them runs.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <ProviderCard
          title="Cloud"
          subtitle="Claude"
          pitch="Fastest, most accurate. Captures are sent to Anthropic's API for processing."
          status={
            checking
              ? { tone: "muted", label: "checking…" }
              : claude?.installed
                ? {
                    tone: "ready",
                    label: claude.version
                      ? `detected · ${claude.version.split(" ")[0]}`
                      : "detected",
                  }
                : {
                    tone: "warn",
                    label: "Claude CLI not found",
                  }
          }
          hint={
            !checking && !claude?.installed
              ? "Install from claude.com/claude-code, or point Braindump at an existing binary below."
              : claude?.installed && claude.resolved_path
                ? claude.resolved_path
                : undefined
          }
          extra={
            !checking && !claude?.installed ? (
              <ManualClaudePath
                value={claudeCliPath}
                onSave={(p) => onUpdateClaudeCliPath(p)}
                onRefresh={onRefreshClaude}
              />
            ) : null
          }
          cta="Use Claude"
          disabled={checking || !claude?.installed}
          onClick={onPickClaude}
        />

        <ProviderCard
          title="Local"
          subtitle="Ollama + Qwen 2.5 7B"
          pitch="Runs entirely on your machine. Nothing leaves your device."
          status={
            checking
              ? { tone: "muted", label: "checking…" }
              : ollamaReady
                ? { tone: "ready", label: "ready" }
                : {
                    tone: "muted",
                    label: ollama?.binary_present
                      ? "needs model download"
                      : "needs install",
                  }
          }
          hint={
            !ollamaReady
              ? "First-run setup: ~5 GB download, 2–4 min on a fast connection. Needs ~6 GB free disk and 8 GB RAM recommended."
              : undefined
          }
          cta={ollamaReady ? "Use Local" : "Set up Local"}
          disabled={checking}
          onClick={onPickLocal}
        />
      </div>
    </div>
  );
}

type StatusTone = "ready" | "muted" | "warn";

function ProviderCard({
  title,
  subtitle,
  pitch,
  status,
  hint,
  extra,
  cta,
  disabled,
  onClick,
}: {
  title: string;
  subtitle: string;
  pitch: string;
  status: { tone: StatusTone; label: string };
  hint?: string;
  extra?: React.ReactNode;
  cta: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const dotColor =
    status.tone === "ready"
      ? "bg-[color:var(--color-accent)]"
      : status.tone === "warn"
        ? "bg-[color:var(--color-danger)]"
        : "bg-[color:var(--color-fg-dim)]";
  const statusText =
    status.tone === "ready"
      ? "text-[color:var(--color-fg)]"
      : status.tone === "warn"
        ? "text-[color:var(--color-danger)]"
        : "text-[color:var(--color-fg-muted)]";

  return (
    <div className="flex flex-col border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6 min-h-[260px]">
      <div className="label text-[color:var(--color-fg-muted)] mb-1">{title}</div>
      <div className="text-lg font-semibold text-[color:var(--color-fg)] mb-3">
        {subtitle}
      </div>
      <p className="text-sm text-[color:var(--color-fg-muted)] leading-relaxed mb-5">
        {pitch}
      </p>
      {hint && (
        <p className="text-xs text-[color:var(--color-fg-dim)] leading-relaxed mb-5 break-all">
          {hint}
        </p>
      )}
      {extra}
      <div className="flex-1" />
      <div className="flex items-center gap-2 mb-4">
        <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
        <span className={`label ${statusText}`}>{status.label}</span>
      </div>
      <Button
        onClick={onClick}
        disabled={disabled}
        className="w-full justify-between"
      >
        <span>{cta}</span>
        <ArrowRight size={14} />
      </Button>
    </div>
  );
}

function ManualClaudePath({
  value,
  onSave,
  onRefresh,
}: {
  value: string | null;
  onSave: (path: string | null) => void;
  onRefresh: (path: string | null) => Promise<ClaudeStatus>;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  async function attempt() {
    const normalized = draft.trim();
    if (!normalized) {
      onSave(null);
      setError(null);
      return;
    }
    setProbing(true);
    setError(null);
    try {
      onSave(normalized);
      const status = await onRefresh(normalized);
      if (!status.installed) {
        setError("Couldn't run that binary. Check the path and try again.");
      }
    } finally {
      setProbing(false);
    }
  }

  return (
    <div className="mb-5">
      <label className="label text-[color:var(--color-fg-muted)] block mb-2">
        locate manually
      </label>
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="/path/to/claude"
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              attempt();
            }
          }}
          className="flex-1 bg-transparent border-b border-[color:var(--color-border)] px-0 h-8 text-xs font-mono focus:outline-none focus:border-[color:var(--color-accent)] placeholder:text-[color:var(--color-fg-dim)]"
        />
        <button
          onClick={attempt}
          disabled={probing}
          className="label text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-accent)] transition-colors disabled:opacity-50"
        >
          {probing ? "checking…" : "check"}
        </button>
      </div>
      <p className="text-xs text-[color:var(--color-fg-dim)] mt-2 leading-relaxed">
        Run <span className="font-mono">which claude</span> in your terminal to find it.
      </p>
      {error && (
        <p className="text-xs text-[color:var(--color-danger)] mt-2 leading-relaxed">
          {error}
        </p>
      )}
    </div>
  );
}

function LocalPickScreen({
  ramGB,
  selectedId,
  onSelect,
  onContinue,
  onBack,
}: {
  ramGB: number;
  selectedId: string;
  onSelect: (id: string) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const grouped = useMemo(() => {
    const byTier: Record<LocalTier, LocalModelOption[]> = {
      baseline: [],
      capable: [],
      reasoning: [],
      premium: [],
    };
    for (const m of LOCAL_MODELS) byTier[m.tier].push(m);
    return byTier;
  }, []);

  const tierOrder: Array<{ key: LocalTier; label: string; hint: string }> = [
    {
      key: "baseline",
      label: "baseline",
      hint: "runs on any laptop · good for capture + organize",
    },
    {
      key: "capable",
      label: "capable",
      hint: "32 GB sweet spot · dense models for long-form reflection",
    },
    {
      key: "reasoning",
      label: "reasoning",
      hint: "chain-of-thought · slower per capture, better at cross-item patterns",
    },
    {
      key: "premium",
      label: "premium",
      hint: "flagship · only if you have a Pro/Max machine",
    },
  ];

  return (
    <div className="max-w-3xl mx-auto px-10 py-12">
      <h1 className="text-2xl font-semibold text-[color:var(--color-fg)] mb-2">
        Pick your local model
      </h1>
      <p className="text-sm text-[color:var(--color-fg-muted)] mb-1 leading-relaxed">
        Larger models understand more nuance but need more RAM and disk.
        You can change this later in settings.
      </p>
      <p className="text-xs text-[color:var(--color-fg-dim)] mb-8">
        {ramGB > 0
          ? `detected · ${ramGB} GB RAM`
          : "couldn't detect RAM — warnings are disabled"}
      </p>

      <div className="space-y-8 mb-10">
        {tierOrder.map((t) =>
          grouped[t.key].length === 0 ? null : (
            <section key={t.key}>
              <header className="flex items-baseline gap-3 mb-3">
                <h3 className="label text-[color:var(--color-fg)]">{t.label}</h3>
                <div className="flex-1 h-px bg-[color:var(--color-border)]" />
                <span className="label text-[color:var(--color-fg-dim)]">{t.hint}</span>
              </header>
              <div className="space-y-2">
                {grouped[t.key].map((m) => (
                  <ModelCard
                    key={m.id}
                    model={m}
                    selected={selectedId === m.id}
                    ramGB={ramGB}
                    onSelect={() => onSelect(m.id)}
                  />
                ))}
              </div>
            </section>
          ),
        )}
      </div>

      <div className="pt-6 border-t border-[color:var(--color-border)] flex items-center justify-between">
        <button
          onClick={onBack}
          className="label text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)] transition-colors"
        >
          back
        </button>
        <Button onClick={onContinue}>
          <span>Start setup</span>
          <ArrowRight size={14} />
        </Button>
      </div>
    </div>
  );
}

function ModelCard({
  model,
  selected,
  ramGB,
  onSelect,
}: {
  model: LocalModelOption;
  selected: boolean;
  ramGB: number;
  onSelect: () => void;
}) {
  const ramKnown = ramGB > 0;
  const insufficient = ramKnown && ramGB < model.minRamGB;
  const tight = ramKnown && !insufficient && ramGB < model.minRamGB + 8;

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left border px-4 py-3.5 transition-colors flex items-start gap-4 ${
        selected
          ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/5"
          : "border-[color:var(--color-border)] hover:border-[color:var(--color-fg-muted)]"
      }`}
    >
      <div className="pt-0.5">
        <span
          className={`w-3 h-3 rounded-full border block ${
            selected
              ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)]"
              : "border-[color:var(--color-border)]"
          }`}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-[color:var(--color-fg)]">
            {model.label}
          </span>
          <span className="label text-[color:var(--color-fg-dim)]">
            {model.paramSize} · ~{model.diskGB} GB · {model.minRamGB} GB RAM
          </span>
          {insufficient && (
            <span
              className="label label-row text-[color:var(--color-danger)]"
              title={`Needs ~${model.minRamGB} GB RAM — you have ${ramGB} GB. The model may fail to load or run extremely slowly.`}
            >
              <AlertTriangle size={12} />
              <span>likely won't run</span>
            </span>
          )}
          {tight && (
            <span
              className="label label-row text-amber-700 dark:text-amber-400"
              title={`Fits in ${ramGB} GB but leaves little headroom. Expect slowness and memory pressure.`}
            >
              <AlertTriangle size={12} />
              <span>tight fit</span>
            </span>
          )}
        </div>
        <p className="text-xs text-[color:var(--color-fg-muted)] mt-1.5 leading-relaxed">
          {model.description}
        </p>
      </div>
    </button>
  );
}

function LocalInstallScreen({
  initialOllama,
  modelId,
  onDone,
  onBack,
}: {
  initialOllama: OllamaStatus | null;
  modelId: string;
  onDone: () => void;
  onBack: () => void;
}) {
  const model = findLocalModel(modelId);
  const [state, setState] = useState<InstallState>(INITIAL_INSTALL);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const startedRef = useRef(false);
  // Tracks which stage the backend is currently reporting progress for, so we
  // route incoming setup-progress events to the right step in the UI.
  const activeStageRef = useRef<
    "install" | "launch" | "pull" | "verify" | null
  >(null);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let unlisten: (() => void) | null = null;

    (async () => {
      unlisten = await onSetupProgress((p) => {
        const key = activeStageRef.current;
        if (!key) return;
        setState((prev) => {
          // A late "active" event can arrive after we've already marked the
          // step done — don't resurrect a completed step.
          if (prev[key].kind === "done") return prev;
          return { ...prev, [key]: progressToStep(p) };
        });
      });

      try {
        await runInstallFlow(initialOllama, modelId, setState, (next) => {
          activeStageRef.current = next;
        });
        setFinished(true);
      } catch (e: any) {
        setError(String(e?.message ?? e));
        const key = activeStageRef.current;
        if (key) {
          setState((prev) => ({
            ...prev,
            [key]: { kind: "error", message: String(e?.message ?? e) },
          }));
        }
      }
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, [initialOllama, modelId]);

  const modelLabel = model?.label ?? modelId;
  const diskLabel = model ? `~${model.diskGB} GB` : "download";

  const steps: Array<{
    key: keyof InstallState;
    label: string;
    sub: string;
  }> = [
    { key: "install", label: "install ollama", sub: "~180 MB" },
    { key: "launch", label: "start service", sub: "localhost:11434" },
    { key: "pull", label: `download ${modelLabel}`, sub: diskLabel },
    { key: "verify", label: "verify", sub: "test capture" },
  ];

  return (
    <div className="max-w-2xl mx-auto px-10 py-12">
      <h1 className="text-2xl font-semibold text-[color:var(--color-fg)] mb-2">
        Setting up local processing
      </h1>
      <p className="text-sm text-[color:var(--color-fg-muted)] mb-10 leading-relaxed">
        This runs once. After setup, captures are processed on your device with
        no internet needed.
      </p>

      <ol className="space-y-5 mb-10">
        {steps.map((s, i) => (
          <StepRow
            key={s.key}
            index={i + 1}
            label={s.label}
            sub={s.sub}
            step={state[s.key]}
          />
        ))}
      </ol>

      {finished && (
        <div className="mb-8 flex flex-col items-start gap-4">
          <p className="text-sm text-[color:var(--color-fg)]">
            All set. Local processing is ready.
          </p>
          <Button onClick={onDone}>
            <span>Start capturing</span>
            <ArrowRight size={14} />
          </Button>
        </div>
      )}

      {error && (
        <div className="mb-8 p-4 border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/5 text-sm">
          <div className="flex items-start gap-2 text-[color:var(--color-danger)] mb-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span className="font-medium">Setup failed</span>
          </div>
          <p className="text-[color:var(--color-fg-muted)] leading-relaxed mb-3">
            {error}
          </p>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => window.location.reload()}>
              Retry
            </Button>
            <Button variant="ghost" onClick={onBack}>
              Back
            </Button>
          </div>
        </div>
      )}

      <div className="pt-6 border-t border-[color:var(--color-border)] flex items-center justify-between">
        <button
          onClick={() =>
            openExternalUrl("https://ollama.com/download").catch(() => {})
          }
          className="label label-row text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)] transition-colors"
        >
          <span>having trouble? install manually</span>
          <ExternalLink size={12} />
        </button>
        {!finished && !error && (
          <button
            onClick={onBack}
            className="label text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)] transition-colors"
          >
            back
          </button>
        )}
      </div>
    </div>
  );
}

function StepRow({
  index,
  label,
  sub,
  step,
}: {
  index: number;
  label: string;
  sub: string;
  step: StepState;
}) {
  const numberStr = index.toString().padStart(2, "0");
  return (
    <li className="flex items-start gap-4">
      <div className="w-8 pt-0.5 shrink-0">
        <StepIcon step={step} fallback={numberStr} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <span
            className={`text-sm ${
              step.kind === "done" || step.kind === "active"
                ? "text-[color:var(--color-fg)]"
                : step.kind === "error"
                  ? "text-[color:var(--color-danger)]"
                  : "text-[color:var(--color-fg-muted)]"
            }`}
          >
            {label}
          </span>
          <span className="label text-[color:var(--color-fg-dim)] shrink-0">
            {sub}
          </span>
        </div>
        {step.kind === "active" && (
          <ActiveDetail message={step.message} done={step.bytesDone} total={step.bytesTotal} />
        )}
        {step.kind === "done" && step.message && (
          <p className="text-xs text-[color:var(--color-fg-muted)] mt-1">
            {step.message}
          </p>
        )}
        {step.kind === "error" && (
          <p className="text-xs text-[color:var(--color-danger)] mt-1 leading-relaxed">
            {step.message}
          </p>
        )}
      </div>
    </li>
  );
}

function StepIcon({ step, fallback }: { step: StepState; fallback: string }) {
  if (step.kind === "done") {
    return <Check size={14} className="text-[color:var(--color-accent)] mt-0.5" />;
  }
  if (step.kind === "error") {
    return (
      <AlertCircle size={14} className="text-[color:var(--color-danger)] mt-0.5" />
    );
  }
  if (step.kind === "active") {
    return (
      <span className="inline-block w-2 h-2 rounded-full bg-[color:var(--color-accent)] animate-pulse mt-1.5" />
    );
  }
  return (
    <span className="font-mono text-xs text-[color:var(--color-fg-dim)] tabular-nums">
      {fallback}
    </span>
  );
}

function ActiveDetail({
  message,
  done,
  total,
}: {
  message?: string;
  done?: number;
  total?: number;
}) {
  const pct = total && total > 0 ? Math.min(100, (done! / total) * 100) : null;
  return (
    <div className="mt-2">
      {pct != null && (
        <div className="h-1 w-full bg-[color:var(--color-border)] mb-1.5 overflow-hidden">
          <div
            className="h-full bg-[color:var(--color-accent)] transition-[width] duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <div className="flex items-baseline justify-between text-xs text-[color:var(--color-fg-muted)] font-mono tabular-nums">
        <span>{message ?? "working…"}</span>
        {total && total > 0 && done != null && (
          <span>
            {formatBytes(done)} / {formatBytes(total)}
          </span>
        )}
      </div>
    </div>
  );
}

function progressToStep(p: SetupProgress): StepState {
  if (p.stage === "download-ollama") {
    return {
      kind: "active",
      message: "downloading",
      bytesDone: p.bytes_done,
      bytesTotal: p.bytes_total,
    };
  }
  if (p.stage === "extract-ollama") {
    return { kind: "active", message: p.message };
  }
  if (p.stage === "launch-ollama") {
    return { kind: "active", message: p.message };
  }
  if (p.stage === "pull-model") {
    return {
      kind: "active",
      message: p.message,
      bytesDone: p.bytes_done,
      bytesTotal: p.bytes_total,
    };
  }
  return { kind: "active", message: p.message };
}

async function runInstallFlow(
  initial: OllamaStatus | null,
  modelId: string,
  setState: React.Dispatch<React.SetStateAction<InstallState>>,
  setActive: (key: "install" | "launch" | "pull" | "verify" | null) => void,
) {
  // Step 1 — install. Skip if the binary is already present.
  if (!initial?.binary_present) {
    setActive("install");
    setState((s) => ({ ...s, install: { kind: "active", message: "preparing" } }));
    await installOllama();
    setState((s) => ({ ...s, install: { kind: "done", message: "installed" } }));
  } else {
    setState((s) => ({
      ...s,
      install: { kind: "done", message: "already installed" },
    }));
  }

  // Step 2 — launch. Always run; cheap no-op if already up.
  setActive("launch");
  setState((s) => ({ ...s, launch: { kind: "active", message: "starting" } }));
  await launchOllama();
  setState((s) => ({ ...s, launch: { kind: "done", message: "service ready" } }));

  // Step 3 — pull the selected model. Skip if already present.
  const latest = await checkOllama();
  if (!latest.models.includes(modelId)) {
    setActive("pull");
    setState((s) => ({
      ...s,
      pull: { kind: "active", message: "starting download" },
    }));
    await pullOllamaModel(modelId);
    setState((s) => ({ ...s, pull: { kind: "done", message: "downloaded" } }));
  } else {
    setState((s) => ({
      ...s,
      pull: { kind: "done", message: "already downloaded" },
    }));
  }

  // Step 4 — verify.
  setActive("verify");
  setState((s) => ({ ...s, verify: { kind: "active", message: "testing" } }));
  await verifyOllamaSetup(modelId);
  setState((s) => ({ ...s, verify: { kind: "done", message: "ok" } }));
  setActive(null);
}
