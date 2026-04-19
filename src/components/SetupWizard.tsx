import { useEffect, useRef, useState } from "react";
import { Check, AlertCircle, ArrowRight, ExternalLink } from "lucide-react";
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
  type ClaudeStatus,
  type OllamaStatus,
  type SetupProgress,
} from "@/lib/setup";
import { LOCAL_MODEL_ID, LOCAL_MODEL_LABEL, type Provider } from "@/lib/settings";

type Screen = "choose" | "local-install";

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
}: {
  onComplete: (provider: Provider) => void;
}) {
  const [screen, setScreen] = useState<Screen>("choose");
  const [claude, setClaude] = useState<ClaudeStatus | null>(null);
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([checkClaude(), checkOllama()])
      .then(([c, o]) => {
        if (cancelled) return;
        setClaude(c);
        setOllama(o);
        setChecking(false);
      })
      .catch(() => {
        if (cancelled) return;
        setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
          {screen === "choose" ? "setup · provider" : "setup · local"}
        </span>
      </header>

      <main className="flex-1 overflow-auto scroll-soft">
        {screen === "choose" ? (
          <ChooseScreen
            checking={checking}
            claude={claude}
            ollama={ollama}
            onPickClaude={() => onComplete("claude")}
            onPickLocal={() => setScreen("local-install")}
          />
        ) : (
          <LocalInstallScreen
            initialOllama={ollama}
            onDone={() => onComplete("ollama")}
            onBack={() => setScreen("choose")}
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
  onPickClaude,
  onPickLocal,
}: {
  checking: boolean;
  claude: ClaudeStatus | null;
  ollama: OllamaStatus | null;
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
              ? "Install the Claude CLI first: claude.com/claude-code"
              : undefined
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
  cta,
  disabled,
  onClick,
}: {
  title: string;
  subtitle: string;
  pitch: string;
  status: { tone: StatusTone; label: string };
  hint?: string;
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
        <p className="text-xs text-[color:var(--color-fg-dim)] leading-relaxed mb-5">
          {hint}
        </p>
      )}
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

function LocalInstallScreen({
  initialOllama,
  onDone,
  onBack,
}: {
  initialOllama: OllamaStatus | null;
  onDone: () => void;
  onBack: () => void;
}) {
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
        await runInstallFlow(initialOllama, setState, (next) => {
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
  }, [initialOllama]);

  const steps: Array<{
    key: keyof InstallState;
    label: string;
    sub: string;
  }> = [
    { key: "install", label: "install ollama", sub: "~180 MB" },
    { key: "launch", label: "start service", sub: "localhost:11434" },
    { key: "pull", label: `download ${LOCAL_MODEL_LABEL}`, sub: "~5 GB" },
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

  // Step 3 — pull model. Skip if already present.
  const latest = await checkOllama();
  if (!latest.has_required_model) {
    setActive("pull");
    setState((s) => ({
      ...s,
      pull: { kind: "active", message: "starting download" },
    }));
    await pullOllamaModel(LOCAL_MODEL_ID);
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
  await verifyOllamaSetup(LOCAL_MODEL_ID);
  setState((s) => ({ ...s, verify: { kind: "done", message: "ok" } }));
  setActive(null);
}
