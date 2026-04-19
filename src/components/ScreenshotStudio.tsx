import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, X, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  captureNode,
  composite,
  copyBlobToClipboard,
  defaultFilename,
  saveBlobToDesktop,
  type BackgroundConfig,
  type MatConfig,
} from "@/lib/screenshot";

type Scope = "whole" | "content";

export interface ScreenshotTargets {
  whole: HTMLElement | null;
  content: HTMLElement | null;
}

interface Preset {
  id: string;
  label: string;
  background: BackgroundConfig;
}

/**
 * Palette drawn from the Braindump icon (gold + cobalt stripes) and the
 * app's surface tokens. Kept small and opinionated — users can override
 * with the color pickers below.
 */
const PRESETS: Preset[] = [
  {
    id: "goldwash",
    label: "goldwash",
    background: {
      kind: "gradient",
      from: "#D8A74A",
      to: "#8F6A1F",
      angle: 135,
    },
  },
  {
    id: "duotone",
    label: "duotone",
    background: {
      kind: "gradient",
      from: "#C99837",
      to: "#2F7A96",
      angle: 135,
    },
  },
  {
    id: "cobalt",
    label: "cobalt",
    background: {
      kind: "gradient",
      from: "#1E5A72",
      to: "#0E2A38",
      angle: 160,
    },
  },
  {
    id: "parchment",
    label: "parchment",
    background: { kind: "solid", color: "#F4EBD7" },
  },
  {
    id: "linen",
    label: "linen",
    background: { kind: "solid", color: "#ECEAE4" },
  },
  {
    id: "ink",
    label: "ink",
    background: {
      kind: "gradient",
      from: "#181818",
      to: "#000000",
      angle: 180,
    },
  },
];

const DEFAULT_MAT: MatConfig = { padding: 96, radius: 16, shadow: 0.6 };

// Must match `trafficLightPosition` in src-tauri/tauri.conf.json — this is
// where macOS renders the real stoplights, and where we redraw simulated
// ones on the canvas (DOM capture can't see native window chrome).
const TRAFFIC_LIGHTS = { x: 18, y: 26 };

export function ScreenshotStudio({
  targets,
  onClose,
}: {
  targets: ScreenshotTargets;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<Scope>("whole");
  const [captured, setCaptured] = useState<{
    whole: string | null;
    content: string | null;
  }>({ whole: null, content: null });
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  const [presetId, setPresetId] = useState<string>(PRESETS[0].id);
  const [customBg, setCustomBg] = useState<BackgroundConfig | null>(null);
  const [mat, setMat] = useState<MatConfig>(DEFAULT_MAT);

  const [copied, setCopied] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [busy, setBusy] = useState<"copy" | "save" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // The "effective" background is either a preset or the custom override.
  const background: BackgroundConfig = useMemo(() => {
    if (customBg) return customBg;
    const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
    return preset.background;
  }, [customBg, presetId]);

  async function runCapture() {
    setCapturing(true);
    setCaptureError(null);
    try {
      const shots: { whole: string | null; content: string | null } = {
        whole: null,
        content: null,
      };
      if (targets.whole) shots.whole = await captureNode(targets.whole);
      if (targets.content) shots.content = await captureNode(targets.content);
      setCaptured(shots);
    } catch (e: any) {
      setCaptureError(String(e?.message ?? e));
    } finally {
      setCapturing(false);
    }
  }

  useEffect(() => {
    runCapture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeShot = scope === "whole" ? captured.whole : captured.content;

  // Live-composited preview — re-runs when the config changes.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewBlobRef = useRef<Blob | null>(null);

  useEffect(() => {
    if (!activeShot) {
      setPreviewUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const blob = await composite({
          screenshot: activeShot,
          background,
          mat,
          trafficLights: scope === "whole" ? TRAFFIC_LIGHTS : null,
        });
        if (cancelled) return;
        previewBlobRef.current = blob;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      } catch (e: any) {
        if (!cancelled) setActionError(String(e?.message ?? e));
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeShot, background, mat, scope]);

  async function handleCopy() {
    if (!previewBlobRef.current) return;
    setBusy("copy");
    setActionError(null);
    try {
      await copyBlobToClipboard(previewBlobRef.current);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e: any) {
      setActionError(String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  async function handleSave() {
    if (!previewBlobRef.current) return;
    setBusy("save");
    setActionError(null);
    try {
      const path = await saveBlobToDesktop(
        previewBlobRef.current,
        defaultFilename(),
      );
      setSavedPath(path);
      setTimeout(() => setSavedPath(null), 4000);
    } catch (e: any) {
      setActionError(String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-stretch">
      <div className="flex-1 flex flex-col p-6 min-w-0">
        <div className="flex items-center gap-3 mb-4 pl-[88px]">
          <span className="label text-[color:var(--color-fg-muted)]">
            screenshot studio
          </span>
          <div className="flex-1" />
          <button
            onClick={runCapture}
            disabled={capturing}
            title="re-capture"
            className="label label-row text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)] transition-colors disabled:opacity-50"
          >
            <RefreshCw
              size={12}
              className={capturing ? "animate-spin" : ""}
            />
            <span>{capturing ? "capturing…" : "re-capture"}</span>
          </button>
          <button
            onClick={onClose}
            title="close"
            className="text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 min-h-0 flex items-center justify-center">
          {captureError ? (
            <div className="text-sm text-[color:var(--color-danger)] max-w-md text-center">
              {captureError}
            </div>
          ) : previewUrl ? (
            <img
              src={previewUrl}
              alt="preview"
              className="max-h-full max-w-full object-contain shadow-2xl"
            />
          ) : (
            <div className="label text-[color:var(--color-fg-muted)]">
              {capturing ? "capturing…" : "preparing preview…"}
            </div>
          )}
        </div>
      </div>

      <aside className="w-80 shrink-0 bg-[color:var(--color-background)] border-l border-[color:var(--color-border)] overflow-auto scroll-soft">
        <Panel label="source">
          <div className="flex items-center gap-3">
            <ScopeLink
              active={scope === "whole"}
              onClick={() => setScope("whole")}
              label="whole app"
              disabled={!captured.whole}
            />
            <span className="text-[color:var(--color-fg-dim)] text-xs">/</span>
            <ScopeLink
              active={scope === "content"}
              onClick={() => setScope("content")}
              label="content only"
              disabled={!captured.content}
            />
          </div>
        </Panel>

        <Panel label="presets">
          <div className="grid grid-cols-3 gap-2">
            {PRESETS.map((p) => (
              <PresetSwatch
                key={p.id}
                preset={p}
                active={!customBg && presetId === p.id}
                onClick={() => {
                  setPresetId(p.id);
                  setCustomBg(null);
                }}
              />
            ))}
          </div>
        </Panel>

        <Panel label="background">
          <BackgroundControls
            value={background}
            onChange={(bg) => setCustomBg(bg)}
          />
        </Panel>

        <Panel label="mat">
          <Slider
            label="padding"
            value={mat.padding}
            min={0}
            max={240}
            step={4}
            format={(v) => `${v}px`}
            onChange={(v) => setMat((m) => ({ ...m, padding: v }))}
          />
          <Slider
            label="corner radius"
            value={mat.radius}
            min={0}
            max={64}
            step={1}
            format={(v) => `${v}px`}
            onChange={(v) => setMat((m) => ({ ...m, radius: v }))}
          />
          <Slider
            label="shadow"
            value={Math.round(mat.shadow * 100)}
            min={0}
            max={100}
            step={5}
            format={(v) => `${v}%`}
            onChange={(v) => setMat((m) => ({ ...m, shadow: v / 100 }))}
          />
        </Panel>

        <Panel label="export" last>
          <div className="flex flex-col gap-2">
            <Button
              onClick={handleCopy}
              disabled={!previewUrl || busy !== null}
              className="justify-between"
            >
              <span>{copied ? "copied" : "Copy to clipboard"}</span>
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </Button>
            <Button
              variant="outline"
              onClick={handleSave}
              disabled={!previewUrl || busy !== null}
              className="justify-between"
            >
              <span>{busy === "save" ? "saving…" : "Save to Desktop"}</span>
              <Download size={13} />
            </Button>
            {savedPath && (
              <p className="text-xs text-[color:var(--color-fg-muted)] leading-relaxed break-all">
                saved · {savedPath}
              </p>
            )}
            {actionError && (
              <p className="text-xs text-[color:var(--color-danger)] leading-relaxed">
                {actionError}
              </p>
            )}
          </div>
        </Panel>
      </aside>
    </div>
  );
}

function Panel({
  label,
  last,
  children,
}: {
  label: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`px-5 py-4 ${
        last ? "" : "border-b border-[color:var(--color-border)]"
      }`}
    >
      <div className="label text-[color:var(--color-fg-muted)] mb-3">
        {label}
      </div>
      {children}
    </div>
  );
}

function ScopeLink({
  active,
  onClick,
  label,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`label transition-colors disabled:opacity-40 ${
        active
          ? "text-[color:var(--color-accent)]"
          : "text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)]"
      }`}
    >
      {label}
    </button>
  );
}

function PresetSwatch({
  preset,
  active,
  onClick,
}: {
  preset: Preset;
  active: boolean;
  onClick: () => void;
}) {
  const style =
    preset.background.kind === "solid"
      ? { background: preset.background.color }
      : {
          background: `linear-gradient(${preset.background.angle}deg, ${preset.background.from}, ${preset.background.to})`,
        };
  return (
    <button
      onClick={onClick}
      className={`relative h-12 border transition-colors ${
        active
          ? "border-[color:var(--color-accent)]"
          : "border-[color:var(--color-border)] hover:border-[color:var(--color-fg-muted)]"
      }`}
      style={style}
      title={preset.label}
    >
      {active && (
        <span className="absolute inset-0 flex items-center justify-center text-white drop-shadow">
          <Check size={14} />
        </span>
      )}
      <span className="absolute left-1 bottom-1 label text-[10px] text-white/90 drop-shadow">
        {preset.label}
      </span>
    </button>
  );
}

function BackgroundControls({
  value,
  onChange,
}: {
  value: BackgroundConfig;
  onChange: (bg: BackgroundConfig) => void;
}) {
  // Mirror the incoming value so switching kind preserves the other kind's
  // last-used colors.
  const [solid, setSolid] = useState(
    value.kind === "solid" ? value.color : "#1E1E1E",
  );
  const [gradFrom, setGradFrom] = useState(
    value.kind === "gradient" ? value.from : "#C99837",
  );
  const [gradTo, setGradTo] = useState(
    value.kind === "gradient" ? value.to : "#2F7A96",
  );
  const [angle, setAngle] = useState(
    value.kind === "gradient" ? value.angle : 135,
  );

  useEffect(() => {
    if (value.kind === "solid") setSolid(value.color);
    if (value.kind === "gradient") {
      setGradFrom(value.from);
      setGradTo(value.to);
      setAngle(value.angle);
    }
  }, [value]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <KindLink
          active={value.kind === "solid"}
          onClick={() => onChange({ kind: "solid", color: solid })}
          label="solid"
        />
        <span className="text-[color:var(--color-fg-dim)] text-xs">/</span>
        <KindLink
          active={value.kind === "gradient"}
          onClick={() =>
            onChange({ kind: "gradient", from: gradFrom, to: gradTo, angle })
          }
          label="gradient"
        />
      </div>
      {value.kind === "solid" ? (
        <ColorRow
          label="color"
          value={solid}
          onChange={(c) => {
            setSolid(c);
            onChange({ kind: "solid", color: c });
          }}
        />
      ) : (
        <>
          <ColorRow
            label="from"
            value={gradFrom}
            onChange={(c) => {
              setGradFrom(c);
              onChange({ kind: "gradient", from: c, to: gradTo, angle });
            }}
          />
          <ColorRow
            label="to"
            value={gradTo}
            onChange={(c) => {
              setGradTo(c);
              onChange({ kind: "gradient", from: gradFrom, to: c, angle });
            }}
          />
          <Slider
            label="angle"
            value={angle}
            min={0}
            max={360}
            step={5}
            format={(v) => `${v}°`}
            onChange={(v) => {
              setAngle(v);
              onChange({
                kind: "gradient",
                from: gradFrom,
                to: gradTo,
                angle: v,
              });
            }}
          />
        </>
      )}
    </div>
  );
}

function KindLink({
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

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-3">
      <span className="label text-[color:var(--color-fg-muted)] w-12 shrink-0">
        {label}
      </span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-8 h-8 p-0 border border-[color:var(--color-border)] bg-transparent cursor-pointer"
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="flex-1 bg-transparent border-b border-[color:var(--color-border)] px-0 h-7 text-xs font-mono focus:outline-none focus:border-[color:var(--color-accent)]"
      />
    </label>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block mb-3 last:mb-0">
      <div className="flex items-baseline justify-between mb-1">
        <span className="label text-[color:var(--color-fg-muted)]">
          {label}
        </span>
        <span className="label text-[color:var(--color-fg-dim)] tabular-nums">
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[color:var(--color-accent)]"
      />
    </label>
  );
}
