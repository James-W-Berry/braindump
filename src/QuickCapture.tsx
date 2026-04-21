import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Logo } from "@/components/Logo";
import { DevBadge } from "@/components/DevBadge";
import { listProjects, getDraft, upsertDraft, type Project } from "@/lib/db";

function readPersistedActiveProjectId(): number | null {
  try {
    const raw = localStorage.getItem("braindump.settings");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const id = parsed?.activeProjectId;
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
}

export function QuickCapture() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    listProjects()
      .then((ps) => {
        setProjects(ps);
        // Default to the last project used in the main app; fall back to first.
        const persisted = readPersistedActiveProjectId();
        const match = persisted != null && ps.some((p) => p.id === persisted);
        setProjectId(match ? persisted : (ps[0]?.id ?? null));
      })
      .catch((e) => setError(String(e)));
  }, []);

  // Focus the textarea whenever the window becomes visible. When the
  // hotkey fires from another app — especially one on a secondary
  // display — the window can be visible while the OS-level key-window
  // transition is still in flight, so `.focus()` silently no-ops and
  // `document.hasFocus()` may flip true-false-true as the transition
  // lands. Keep retrying until we see focus stable across multiple
  // consecutive checks (not just once) so we don't bail early.
  useEffect(() => {
    const focusWithRetry = (attempt = 0, stable = 0) => {
      if (attempt >= 25) return;
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const focused = document.activeElement === el && document.hasFocus();
      const next = focused ? stable + 1 : 0;
      if (next < 3) setTimeout(() => focusWithRetry(attempt + 1, next), 30);
    };
    focusWithRetry();
    const onWinFocus = () => focusWithRetry();
    window.addEventListener("focus", onWinFocus);
    const w = getCurrentWindow();
    const unFocus = w.onFocusChanged(({ payload }) => {
      if (payload) focusWithRetry();
    });
    const unShow = listen("quick-capture-shown", () => focusWithRetry());
    return () => {
      window.removeEventListener("focus", onWinFocus);
      unFocus.then((fn) => fn()).catch(() => {});
      unShow.then((fn) => fn()).catch(() => {});
    };
  }, []);

  const hide = useCallback(async () => {
    // Route through a Rust command so it can also hide the whole app on
    // macOS (when the main window is hidden), which returns focus to the
    // previously-active application instead of bouncing to our hidden main.
    await invoke("dismiss_quick_capture");
  }, []);

  const save = useCallback(async () => {
    if (projectId == null || !text.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      // Merge with the latest DB draft so we don't clobber anything the main
      // window autosaved between us loading and saving.
      const existing = await getDraft(projectId);
      const merged = existing ? `${existing}\n\n${text.trim()}` : text.trim();
      await upsertDraft(projectId, merged);
      await emit("draft-updated", { projectId });
      setText("");
      await hide();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }, [projectId, text, saving, hide]);

  const activeProject = projects.find((p) => p.id === projectId) ?? null;

  return (
    <div
      className="h-screen w-screen flex flex-col text-[color:var(--color-fg)] bg-transparent"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          hide();
        } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          save();
        }
      }}
    >
      <header
        data-tauri-drag-region
        className="flex items-center gap-2 px-3 py-2 border-b border-[color:var(--color-border)]/60 select-none"
      >
        <Logo size={14} className="text-[color:var(--color-fg)] opacity-80 shrink-0" />
        <span className="text-[11px] uppercase tracking-[0.2em] opacity-60">
          Quick Capture
        </span>
        <DevBadge />
        <div className="flex-1" />
        <label className="text-[11px] opacity-60">
          project
          <select
            value={projectId ?? ""}
            onChange={(e) => setProjectId(Number(e.target.value))}
            className="ml-2 bg-transparent border border-[color:var(--color-border)] rounded px-1.5 py-0.5 text-[12px] text-[color:var(--color-fg)] outline-none focus:border-[color:var(--color-fg)]/50"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </header>

      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          activeProject
            ? `Dump a thought for ${activeProject.name}. ⌘↩ to save.`
            : "No project yet."
        }
        style={{ lineHeight: 1.4 }}
        className="flex-1 resize-none bg-transparent outline-none px-4 py-3 text-[14px] text-[color:var(--color-fg)] placeholder:text-[color:var(--color-fg-dim)]"
      />

      <footer className="flex items-center justify-between px-3 py-2 border-t border-[color:var(--color-border)]/60 text-[11px] opacity-60">
        {error ? (
          <span className="text-[color:var(--color-danger)]">{error}</span>
        ) : (
          <span>esc close · ⌘↩ save</span>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={hide}
            className="px-2 py-0.5 rounded hover:bg-[color:var(--color-fg)]/10"
          >
            cancel
          </button>
          <button
            onClick={save}
            disabled={projectId == null || !text.trim() || saving}
            className="px-2 py-0.5 rounded bg-[color:var(--color-fg)]/10 hover:bg-[color:var(--color-fg)]/15 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "saving…" : "save"}
          </button>
        </div>
      </footer>
    </div>
  );
}
