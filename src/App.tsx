import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Send,
  X,
  Search,
  Trash2,
  Undo2,
  ChevronUp,
  ChevronDown,
  Music2,
  Sparkles,
  Minimize2,
  Maximize2,
  PictureInPicture2,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  enable as enableAutostart,
  disable as disableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import { Logo } from "@/components/Logo";
import { DevBadge } from "@/components/DevBadge";
import { Button } from "@/components/ui/button";
import { SettingsPopover } from "@/components/SettingsPopover";
import { ProcessingView } from "@/components/ProcessingView";
import { SetupWizard } from "@/components/SetupWizard";
import { ScreenshotStudio } from "@/components/ScreenshotStudio";
import { CaptureAmbient } from "@/components/CaptureAmbient";
import { NTSPlayer, useNowPlaying, type NowPlaying } from "@/components/NTSPlayer";
import { EpisodePicker } from "@/components/EpisodePicker";
import { type Settings, type OtakuEpisode } from "@/lib/settings";
import { EditableText, EditableSelect, EditableCombo } from "@/components/Editable";
import {
  listProjects,
  createProject,
  deleteProject,
  getDraft,
  upsertDraft,
  clearDraft,
  markCaptureProcessed,
  listItems,
  listRecentlyDeleted,
  insertItem,
  linkItems,
  updateItemStatus,
  updateItemField,
  setItemPosition,
  deleteItem,
  restoreItem,
  permanentlyDeleteItem,
  type Project,
  type Item,
} from "@/lib/db";
import { processCapture, type AgentResult } from "@/lib/agent";
import { useSettings, FONT_STACKS, type GroupBy } from "@/lib/settings";
import { useUpdater } from "@/lib/updater";

type View = "capture" | "processing" | "items";

export default function App() {
  const { settings, update } = useSettings();
  const updater = useUpdater(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<number | null>(
    settings.activeProjectId,
  );
  const [view, setView] = useState<View>(settings.view);
  const [draft, setDraft] = useState("");
  const [lastResult, setLastResult] = useState<AgentResult | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [trashView, setTrashView] = useState(false);
  const [trashItems, setTrashItems] = useState<Item[]>([]);
  const [itemsSearch, setItemsSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  // Ephemeral: true when the user re-opens the provider picker from settings
  // after initial setup. Doesn't nullify `settings.provider`, so a cancel
  // leaves the previous choice intact.
  const [showProviderWizard, setShowProviderWizard] = useState(false);
  const [showScreenshotStudio, setShowScreenshotStudio] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const appRootRef = useRef<HTMLDivElement>(null);
  const mainContentRef = useRef<HTMLElement>(null);
  // Pending autosave state: the most recent unsaved draft text per project,
  // and a timer that flushes it. Kept in refs so typing doesn't rebuild the
  // debounce every render.
  const draftSaveTimerRef = useRef<number | null>(null);
  const draftPendingRef = useRef<{ projectId: number; text: string } | null>(null);

  const flushDraftSave = useCallback(async () => {
    if (draftSaveTimerRef.current != null) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    const pending = draftPendingRef.current;
    if (!pending) return;
    draftPendingRef.current = null;
    if (pending.text.trim()) {
      await upsertDraft(pending.projectId, pending.text);
    } else {
      await clearDraft(pending.projectId);
    }
  }, []);

  const cancelDraftSave = useCallback(() => {
    if (draftSaveTimerRef.current != null) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    draftPendingRef.current = null;
  }, []);

  const scheduleDraftSave = useCallback((projectId: number, text: string) => {
    draftPendingRef.current = { projectId, text };
    if (draftSaveTimerRef.current != null) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = window.setTimeout(() => {
      draftSaveTimerRef.current = null;
      flushDraftSave().catch(() => {});
    }, 500);
  }, [flushDraftSave]);

  const handleDraftChange = useCallback((s: string) => {
    setDraft(s);
    if (activeProjectId != null) scheduleDraftSave(activeProjectId, s);
  }, [activeProjectId, scheduleDraftSave]);

  useEffect(() => {
    (async () => {
      const ps = await listProjects();
      setProjects(ps);
      if (!ps.length) return;
      if (activeProjectId == null || !ps.some((p) => p.id === activeProjectId)) {
        setActiveProjectId(ps[0].id);
      }
    })().catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    update("activeProjectId", activeProjectId);
  }, [activeProjectId]);

  useEffect(() => {
    if (view === "capture" || view === "items") update("view", view);
  }, [view]);

  useEffect(() => {
    if (activeProjectId == null) return;
    listItems(activeProjectId).then(setItems).catch((e) => setError(String(e)));
  }, [activeProjectId, lastResult]);

  // Load the persisted draft when switching projects. Flush any pending
  // autosave for the previous project first so we don't lose final keystrokes.
  useEffect(() => {
    if (activeProjectId == null) return;
    let cancelled = false;
    (async () => {
      await flushDraftSave();
      const text = await getDraft(activeProjectId);
      if (!cancelled) setDraft(text ?? "");
    })().catch((e) => setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, flushDraftSave]);

  // The quick-capture window appends to the same draft row. When that
  // happens while the main window is live on that project, pull in the fresh
  // text so the textarea reflects the merged result.
  useEffect(() => {
    const un = listen<{ projectId: number }>("draft-updated", async (e) => {
      if (activeProjectId == null) return;
      if (e.payload?.projectId !== activeProjectId) return;
      // Flush anything queued locally first so we don't race our own save
      // against the incoming merged text.
      await flushDraftSave();
      const text = await getDraft(activeProjectId);
      setDraft(text ?? "");
    });
    return () => {
      un.then((fn) => fn()).catch(() => {});
    };
  }, [activeProjectId, flushDraftSave]);

  // Sync the autostart setting with the OS. Idempotent — reads the current
  // state first so we don't churn the plist/registry on every launch.
  useEffect(() => {
    (async () => {
      const currentlyEnabled = await isAutostartEnabled();
      if (settings.autostart && !currentlyEnabled) {
        await enableAutostart();
      } else if (!settings.autostart && currentlyEnabled) {
        await disableAutostart();
      }
    })().catch((e) => {
      console.warn("failed to sync autostart:", e);
    });
  }, [settings.autostart]);

  // Keep the Rust-side global shortcut in sync with the user's setting.
  // Rust boots with its hardcoded default; this overrides it with the
  // persisted value and re-registers whenever the user rebinds.
  useEffect(() => {
    const shortcut = settings.quickCaptureShortcut;
    if (!shortcut) return;
    invoke("set_quick_capture_shortcut", { shortcut }).catch((e) => {
      console.warn("failed to register quick-capture shortcut:", e);
    });
  }, [settings.quickCaptureShortcut]);

  // Flush pending draft save if the window is about to close.
  useEffect(() => {
    const handler = () => {
      const pending = draftPendingRef.current;
      if (!pending) return;
      if (draftSaveTimerRef.current != null) {
        clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
      draftPendingRef.current = null;
      if (pending.text.trim()) {
        upsertDraft(pending.projectId, pending.text).catch(() => {});
      } else {
        clearDraft(pending.projectId).catch(() => {});
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  useEffect(() => {
    if (activeProjectId == null || !trashView) return;
    listRecentlyDeleted(activeProjectId)
      .then(setTrashItems)
      .catch((e) => setError(String(e)));
  }, [activeProjectId, trashView]);

  useEffect(() => {
    if (view === "capture") textareaRef.current?.focus();
  }, [view]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  const existingTopics = useMemo(() => {
    const s = new Set<string>();
    for (const i of items) {
      const t = i.topic?.trim();
      if (t) s.add(t);
    }
    return Array.from(s).sort();
  }, [items]);

  async function handleProcess() {
    if (!activeProject || !draft.trim()) return;
    setError(null);
    setView("processing");
    try {
      // Cancel any scheduled autosave — we're about to write the current
      // text explicitly and then transition the row out of the 'draft' state.
      cancelDraftSave();
      const capture = await upsertDraft(activeProject.id, draft);
      const existing = items.map((i) => ({
        id: i.id,
        title: i.title,
        category: i.category,
        topic: i.topic,
        status: i.status,
      }));
      const activeModel =
        settings.provider === "ollama" ? settings.localModel : settings.model;
      const result = await processCapture({
        projectName: activeProject.name,
        projectDescription: activeProject.description,
        existingItems: existing,
        rawText: draft,
        model: activeModel,
        provider: settings.provider ?? "claude",
        claudePath: settings.claudeCliPath,
      });
      // Only honor related_item_ids that reference items we actually sent to
      // the agent — local models (and occasionally Claude) can invent IDs.
      const knownIds = new Set(existing.map((i) => i.id));
      for (const it of result.items) {
        const newId = await insertItem(activeProject.id, capture.id, {
          title: it.title,
          body: it.body,
          category: it.category,
          priority: it.priority,
          topic: it.topic,
          tags: it.tags ?? [],
        });
        for (const relId of it.related_item_ids ?? []) {
          if (knownIds.has(relId)) {
            await linkItems(newId, relId);
          }
        }
      }
      await markCaptureProcessed(capture.id, "processed");
      setLastResult(result);
      setDraft("");
      setView("items");
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setView("capture");
    }
  }

  async function handleCreateProject(name: string) {
    const p = await createProject(name);
    setProjects((prev) => [...prev, p].sort((a, b) => a.name.localeCompare(b.name)));
    setActiveProjectId(p.id);
    setShowNewProject(false);
  }

  async function handleConfirmDeleteProject() {
    if (!deletingProject) return;
    const id = deletingProject.id;
    try {
      await deleteProject(id);
      const remaining = projects.filter((p) => p.id !== id);
      setProjects(remaining);
      if (activeProjectId === id) {
        setActiveProjectId(remaining[0]?.id ?? null);
        setItems([]);
        setTrashItems([]);
        setLastResult(null);
      }
      setDeletingProject(null);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setDeletingProject(null);
    }
  }

  async function handleToggleDone(id: number, current: Item["status"]) {
    const next = current === "done" ? "open" : "done";
    await updateItemStatus(id, next);
    if (activeProjectId != null) setItems(await listItems(activeProjectId));
  }

  async function handleEditItem(
    itemId: number,
    field: "title" | "body" | "topic" | "category" | "priority" | "tags",
    value: string | null,
  ) {
    await updateItemField(itemId, field, value);
    if (activeProjectId != null) setItems(await listItems(activeProjectId));
  }

  async function handleDeleteItem(itemId: number) {
    await deleteItem(itemId);
    if (activeProjectId == null) return;
    setItems(await listItems(activeProjectId));
    if (trashView) setTrashItems(await listRecentlyDeleted(activeProjectId));
  }

  async function handleRestoreItem(itemId: number) {
    await restoreItem(itemId);
    if (activeProjectId == null) return;
    setItems(await listItems(activeProjectId));
    setTrashItems(await listRecentlyDeleted(activeProjectId));
  }

  async function handlePermanentDelete(itemId: number) {
    await permanentlyDeleteItem(itemId);
    if (activeProjectId == null) return;
    setTrashItems(await listRecentlyDeleted(activeProjectId));
  }

  async function handleMoveItem(itemId: number, direction: "up" | "down") {
    if (activeProjectId == null) return;

    // Work from the current sorted+filtered list in the active group.
    const visible = items.filter((i) => {
      if (i.status === "done" && settings.hideDone) return false;
      return i.deleted_at == null;
    });
    const groups = groupItems(visible, settings.groupBy);

    let target: Item | undefined;
    let groupList: Item[] = [];
    let indexInGroup = -1;
    for (const g of groups) {
      const idx = g.items.findIndex((i) => i.id === itemId);
      if (idx !== -1) {
        target = g.items[idx];
        groupList = g.items;
        indexInGroup = idx;
        break;
      }
    }
    if (!target) return;

    if (direction === "up") {
      if (indexInGroup <= 0) return;
      const above = groupList[indexInGroup - 1];
      const aboveAbove = indexInGroup - 2 >= 0 ? groupList[indexInGroup - 2] : null;
      const abovePos = above.position ?? 0;
      const newPos = aboveAbove
        ? ((aboveAbove.position ?? 0) + abovePos) / 2
        : abovePos - 1;
      await setItemPosition(itemId, newPos);
    } else {
      if (indexInGroup >= groupList.length - 1) return;
      const below = groupList[indexInGroup + 1];
      const belowBelow =
        indexInGroup + 2 <= groupList.length - 1 ? groupList[indexInGroup + 2] : null;
      const belowPos = below.position ?? 0;
      const newPos = belowBelow
        ? (belowPos + (belowBelow.position ?? 0)) / 2
        : belowPos + 1;
      await setItemPosition(itemId, newPos);
    }

    setItems(await listItems(activeProjectId));
  }

  // All hooks must be called on every render — SetupWizard takeover
  // (below) returns a different tree, so anything hook-dependent has
  // to live above the early return or React throws "rendered fewer
  // hooks than expected."
  const nowPlaying = useNowPlaying(
    settings.musicPlaying && !settings.activeEpisode,
  );
  const wordCount = useMemo(
    () => (draft.trim() ? draft.trim().split(/\s+/).length : 0),
    [draft],
  );
  const visibleItems = useMemo(
    () =>
      filterItems(
        trashView ? trashItems : items,
        itemsSearch,
        settings.hideDone,
        trashView,
      ),
    [items, trashItems, itemsSearch, settings.hideDone, trashView],
  );

  const firstLaunch = settings.provider == null;
  const wizardActive = firstLaunch || showProviderWizard;

  const activeCoverUrl =
    settings.activeEpisode?.coverUrl ?? nowPlaying?.coverUrl ?? null;
  const showBackgroundCover =
    settings.musicPlaying &&
    settings.musicMode === "background" &&
    activeCoverUrl != null;
  const itemsTotal = visibleItems.length;

  return (
    <div className="flex flex-col h-full">
      <div
        ref={appRootRef}
        className="relative flex flex-col flex-1 min-h-0"
      >
        {/* Backdrop layer — behind everything, visible in every view.
            Animated ambient is suppressed while cover art is taking
            over in background mode. */}
        {!showBackgroundCover && (
          <CaptureAmbient enabled={settings.ambientBackground} />
        )}
        {showBackgroundCover && activeCoverUrl && (
          <BackgroundCover coverUrl={activeCoverUrl} />
        )}

        <Header
          projects={projects}
          activeProjectId={activeProjectId}
          onPickProject={setActiveProjectId}
          onNewProject={() => setShowNewProject(true)}
          onDeleteProject={() => activeProject && setDeletingProject(activeProject)}
          canDeleteProject={projects.length > 1 && activeProject != null}
          view={view === "processing" ? "capture" : view}
          onSetView={setView}
          settings={settings}
          onUpdateSettings={update}
          onOpenProviderWizard={() => setShowProviderWizard(true)}
          onOpenScreenshot={() => setShowScreenshotStudio(true)}
          updater={updater}
          disabled={view === "processing" || wizardActive}
        />

        {error && (
          <div className="relative z-10 px-6 py-2 bg-[color:var(--color-danger)]/15 text-[color:var(--color-danger)] text-sm flex items-center justify-between font-mono">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="opacity-70 hover:opacity-100">
              <X size={14} />
            </button>
          </div>
        )}

        <main ref={mainContentRef} className="relative z-10 flex-1 overflow-hidden">
          {wizardActive ? (
            <SetupWizard
              currentLocalModel={settings.localModel}
              claudeCliPath={settings.claudeCliPath}
              onUpdateClaudeCliPath={(p) => update("claudeCliPath", p)}
              onPickLocalModel={(id) => update("localModel", id)}
              onComplete={(p) => {
                update("provider", p);
                setShowProviderWizard(false);
              }}
              onCancel={
                firstLaunch ? undefined : () => setShowProviderWizard(false)
              }
            />
          ) : view === "processing" ? (
            <ProcessingView projectName={activeProject?.name ?? ""} />
          ) : view === "capture" ? (
            <CaptureView
              textareaRef={textareaRef}
              draft={draft}
              onDraftChange={handleDraftChange}
              onProcess={handleProcess}
              projectName={activeProject?.name ?? ""}
              fontFamily={FONT_STACKS[settings.font]}
              fontSize={settings.fontSize}
            />
          ) : (
            <ItemsView
              rawItems={trashView ? trashItems : items}
              visibleItems={visibleItems}
              allTopics={existingTopics}
              lastResult={trashView ? null : lastResult}
              groupBy={settings.groupBy}
              hideDone={settings.hideDone}
              trashView={trashView}
              search={itemsSearch}
              onSearchChange={setItemsSearch}
              onSetGroupBy={(g) => update("groupBy", g)}
              onToggleHideDone={() => update("hideDone", !settings.hideDone)}
              onToggleTrash={() => setTrashView((v) => !v)}
              onToggleDone={handleToggleDone}
              onMoveItem={handleMoveItem}
              onEditItem={handleEditItem}
              onDeleteItem={handleDeleteItem}
              onRestoreItem={handleRestoreItem}
              onPermanentDelete={handlePermanentDelete}
            />
          )}
        </main>

        <NTSPlayer
          playing={settings.musicPlaying}
          volume={settings.musicVolume}
          mode={settings.musicMode}
          nowPlaying={nowPlaying}
          activeEpisode={settings.activeEpisode}
          onClose={
            settings.musicMode === "floating"
              ? () => {
                  update("musicMode", "thumbnail");
                  update("musicPlaying", false);
                }
              : undefined
          }
        />

        <AppFooter
          view={view}
          wordCount={wordCount}
          itemsTotal={itemsTotal}
          draftTrimmed={draft.trim().length > 0}
          onProcess={handleProcess}
          ambientBackground={settings.ambientBackground}
          onToggleBackdrop={() =>
            update("ambientBackground", !settings.ambientBackground)
          }
          musicPlaying={settings.musicPlaying}
          musicMode={settings.musicMode}
          musicVolume={settings.musicVolume}
          activeEpisode={settings.activeEpisode}
          nowPlaying={nowPlaying}
          activeCoverUrl={activeCoverUrl}
          onToggleMusic={() =>
            update("musicPlaying", !settings.musicPlaying)
          }
          onSetMusicMode={(m) => update("musicMode", m)}
          onSetMusicVolume={(v) => update("musicVolume", v)}
          onPickLive={() => {
            update("activeEpisode", null);
            update("musicPlaying", true);
          }}
          onPickEpisode={(ep) => {
            update("activeEpisode", ep);
            update("musicPlaying", true);
          }}
        />
      </div>

      {showNewProject && (
        <NewProjectDialog
          onCreate={handleCreateProject}
          onCancel={() => setShowNewProject(false)}
        />
      )}

      {deletingProject && (
        <DeleteProjectDialog
          project={deletingProject}
          onConfirm={handleConfirmDeleteProject}
          onCancel={() => setDeletingProject(null)}
        />
      )}

      {showScreenshotStudio && (
        <ScreenshotStudio
          targets={{
            whole: appRootRef.current,
            content: mainContentRef.current,
          }}
          onClose={() => setShowScreenshotStudio(false)}
        />
      )}
    </div>
  );
}

function Header({
  projects,
  activeProjectId,
  onPickProject,
  onNewProject,
  onDeleteProject,
  canDeleteProject,
  view,
  onSetView,
  settings,
  onUpdateSettings,
  onOpenProviderWizard,
  onOpenScreenshot,
  updater,
  disabled,
}: {
  projects: Project[];
  activeProjectId: number | null;
  onPickProject: (id: number) => void;
  onNewProject: () => void;
  onDeleteProject: () => void;
  canDeleteProject: boolean;
  view: "capture" | "items";
  onSetView: (v: View) => void;
  settings: ReturnType<typeof useSettings>["settings"];
  onUpdateSettings: ReturnType<typeof useSettings>["update"];
  onOpenProviderWizard: () => void;
  onOpenScreenshot: () => void;
  updater: ReturnType<typeof useUpdater>;
  disabled: boolean;
}) {
  return (
    <header
      data-tauri-drag-region
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        // Don't drag when the user clicked an interactive control.
        const t = e.target as HTMLElement;
        if (
          t.closest(
            'button, input, select, a, textarea, [role="button"], [role="combobox"], [role="menu"]',
          )
        ) {
          return;
        }
        getCurrentWindow()
          .startDragging()
          .catch(() => {});
      }}
      onDoubleClick={(e) => {
        const t = e.target as HTMLElement;
        if (
          t.closest(
            'button, input, select, a, textarea, [role="button"], [role="combobox"]',
          )
        )
          return;
        // macOS convention: double-click titlebar to minimize or zoom.
        getCurrentWindow()
          .toggleMaximize()
          .catch(() => {});
      }}
      className="flex items-stretch justify-between pl-[100px] pr-4 h-12 border-b border-[color:var(--color-border)] bg-[color:var(--color-background)]"
    >
      {/* Left cluster — brand + project. */}
      <div
        data-tauri-drag-region
        className="flex items-center gap-3 min-w-0"
      >
        <span
          data-tauri-drag-region
          className="flex items-center gap-2.5 text-[color:var(--color-fg)] pointer-events-none"
        >
          <span className="font-semibold uppercase tracking-[0.18em] text-[13px]">
            BRAINDUMP
          </span>
          <DevBadge className="pointer-events-auto" />
          <Logo size={22} className="text-[color:var(--color-accent)]" />
        </span>
        <span data-tauri-drag-region className="w-px h-4 hairline" />
        <select
          value={activeProjectId ?? ""}
          onChange={(e) => onPickProject(Number(e.target.value))}
          disabled={disabled}
          className="bg-transparent border-none outline-none text-sm text-[color:var(--color-fg)] disabled:opacity-50 pr-2 cursor-pointer hover:text-[color:var(--color-accent)] transition-colors max-w-[200px] truncate"
          title="project"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          onClick={onNewProject}
          disabled={disabled}
          title="New project"
          className="text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-accent)] transition-colors disabled:opacity-50 self-center"
        >
          <Plus size={14} />
        </button>
        <button
          onClick={onDeleteProject}
          disabled={disabled || !canDeleteProject}
          title={
            canDeleteProject
              ? "Delete project"
              : "At least one project is required"
          }
          className="text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-danger)] transition-colors disabled:opacity-30 disabled:pointer-events-none self-center"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Draggable middle — explicit large minimum. */}
      <div
        data-tauri-drag-region
        className="flex-1 min-w-[80px] self-stretch"
        aria-hidden="true"
      />

      {/* Right cluster — view switcher + settings. */}
      <div
        data-tauri-drag-region
        className="flex items-stretch gap-5 h-full"
      >
        <nav
          data-tauri-drag-region
          className="flex items-stretch gap-4 h-full"
          aria-label="view"
        >
          <NavLink
            active={view === "capture"}
            onClick={() => onSetView("capture")}
            label="capture"
            disabled={disabled}
          />
          <span
            data-tauri-drag-region
            className="flex items-center text-[color:var(--color-fg-dim)] text-xs pointer-events-none"
          >
            /
          </span>
          <NavLink
            active={view === "items"}
            onClick={() => onSetView("items")}
            label="items"
            disabled={disabled}
          />
        </nav>
        <span data-tauri-drag-region className="w-px h-4 hairline self-center" />
        <div className="self-center">
          <SettingsPopover
            settings={settings}
            onUpdate={onUpdateSettings}
            onOpenProviderWizard={onOpenProviderWizard}
            onOpenScreenshot={onOpenScreenshot}
            updater={updater}
          />
        </div>
      </div>
    </header>
  );
}

function NavLink({
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
      className={`label h-full inline-flex items-center border-b-2 -mb-px transition-colors disabled:opacity-50 ${
        active
          ? "text-[color:var(--color-fg)] border-[color:var(--color-accent)]"
          : "text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)] border-transparent"
      }`}
    >
      {label}
    </button>
  );
}

function CaptureView({
  textareaRef,
  draft,
  onDraftChange,
  onProcess,
  projectName,
  fontFamily,
  fontSize,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  draft: string;
  onDraftChange: (s: string) => void;
  onProcess: () => void;
  projectName: string;
  fontFamily: string;
  fontSize: number;
}) {
  const [keyTick, setKeyTick] = useState(0);

  return (
    <div className="relative flex flex-col h-full">
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => {
          onDraftChange(e.target.value);
          setKeyTick((k) => (k + 1) % 1_000_000);
        }}
        placeholder={`Dump thoughts for ${projectName || "your project"}. No structure needed — just write.`}
        style={{ fontFamily, fontSize: `${fontSize}px`, lineHeight: 1.35 }}
        className="capture-textarea flex-1 resize-none bg-transparent outline-none px-10 py-8 text-[color:var(--color-fg)] placeholder:text-[color:var(--color-fg-dim)] scroll-soft relative z-10"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            onProcess();
          }
        }}
      />
      <span
        key={keyTick}
        aria-hidden="true"
        className="capture-pulse pointer-events-none absolute inset-x-0 bottom-0 h-px z-10"
      />
    </div>
  );
}

function AppFooter({
  view,
  wordCount,
  itemsTotal,
  draftTrimmed,
  onProcess,
  ambientBackground,
  onToggleBackdrop,
  musicPlaying,
  musicMode,
  musicVolume,
  activeEpisode,
  nowPlaying,
  activeCoverUrl,
  onToggleMusic,
  onSetMusicMode,
  onSetMusicVolume,
  onPickLive,
  onPickEpisode,
}: {
  view: View;
  wordCount: number;
  itemsTotal: number;
  draftTrimmed: boolean;
  onProcess: () => void;
  ambientBackground: boolean;
  onToggleBackdrop: () => void;
  musicPlaying: boolean;
  musicMode: Settings["musicMode"];
  musicVolume: number;
  activeEpisode: OtakuEpisode | null;
  nowPlaying: NowPlaying | null;
  activeCoverUrl: string | null;
  onToggleMusic: () => void;
  onSetMusicMode: (m: Settings["musicMode"]) => void;
  onSetMusicVolume: (v: number) => void;
  onPickLive: () => void;
  onPickEpisode: (ep: OtakuEpisode) => void;
}) {
  const [tick, setTick] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const labelBtnRef = useRef<HTMLButtonElement>(null);

  // Bump the count tick whenever the value the user sees changes, so
  // the span restarts its CSS flash animation.
  const countValue = view === "capture" ? wordCount : itemsTotal;
  const prevCount = useRef(countValue);
  useEffect(() => {
    if (prevCount.current !== countValue) {
      prevCount.current = countValue;
      setTick((t) => t + 1);
    }
  }, [countValue]);

  const showLabel = activeEpisode
    ? activeEpisode.title
    : musicPlaying
      ? nowPlaying?.showName ?? "NTS 1 · loading…"
      : "NTS 1 · live";

  // Processing view: no count on the left (nothing meaningful to show)
  // and no Process button on the right (the agent is already running).
  const showCount = view !== "processing";
  const showProcess = view === "capture";

  const countText =
    view === "capture"
      ? `${wordCount.toString().padStart(3, "0")} words`
      : `${itemsTotal.toString().padStart(3, "0")} items`;

  return (
    <footer className="relative z-10 flex items-center justify-between px-6 h-12 border-t border-[color:var(--color-border)] bg-[color:var(--color-background)]/80 backdrop-blur-sm">
      <div className="flex items-center gap-4 min-w-0">
        {showCount && (
          <>
            <span
              key={tick}
              className="wordcount-tick label label-row text-[color:var(--color-fg-muted)] tabular-nums shrink-0"
            >
              {countText}
            </span>
            <span className="w-px h-3.5 hairline shrink-0" />
          </>
        )}
        <button
          onClick={onToggleBackdrop}
          title={
            ambientBackground
              ? "animated backdrop: on (click to disable)"
              : "animated backdrop: off (click to enable)"
          }
          className={`shrink-0 transition-colors ${
            ambientBackground
              ? "text-[color:var(--color-accent)]"
              : "text-[color:var(--color-fg-dim)] hover:text-[color:var(--color-fg-muted)]"
          }`}
        >
          <Sparkles size={13} />
        </button>
        {musicMode === "thumbnail" &&
        activeCoverUrl &&
        (musicPlaying || activeEpisode) ? (
          <button
            onClick={onToggleMusic}
            title={
              musicPlaying
                ? activeEpisode
                  ? "pause episode"
                  : "pause NTS 1"
                : `resume ${activeEpisode?.title ?? "playback"}`
            }
            className="relative block shrink-0 w-6 h-6 overflow-hidden border border-[color:var(--color-border)] rounded-sm"
          >
            <img
              src={activeCoverUrl}
              alt=""
              aria-hidden="true"
              className={`w-full h-full object-cover transition-all ${
                musicPlaying ? "opacity-100" : "opacity-55 grayscale"
              }`}
            />
            {musicPlaying && (
              <span
                aria-hidden="true"
                className="ambient-dot absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[color:var(--color-accent)] border border-[color:var(--color-background)]"
              />
            )}
          </button>
        ) : (
          <button
            onClick={onToggleMusic}
            title={
              musicPlaying
                ? activeEpisode
                  ? "pause episode"
                  : "pause NTS 1"
                : activeEpisode
                  ? `play ${activeEpisode.title}`
                  : "play NTS 1 (live)"
            }
            className={`shrink-0 label label-row transition-colors ${
              musicPlaying
                ? "text-[color:var(--color-accent)]"
                : "text-[color:var(--color-fg-dim)] hover:text-[color:var(--color-fg-muted)]"
            }`}
          >
            <Music2 size={13} />
            {musicPlaying && (
              <span className="sound-wave" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </span>
            )}
          </button>
        )}
        <div className="relative min-w-0 max-w-[260px]">
          <button
            ref={labelBtnRef}
            onClick={() => setPickerOpen((v) => !v)}
            title="pick Otaku episode or live"
            className="truncate text-xs text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)] transition-colors w-full text-left"
          >
            {showLabel}
          </button>
          <EpisodePicker
            open={pickerOpen}
            anchorRef={labelBtnRef}
            activeEpisode={activeEpisode}
            onPickLive={() => {
              onPickLive();
              setPickerOpen(false);
            }}
            onPickEpisode={(ep) => {
              onPickEpisode(ep);
              setPickerOpen(false);
            }}
            onClose={() => setPickerOpen(false)}
          />
        </div>
        {musicPlaying && !activeEpisode && (
          <VolumeSlider value={musicVolume} onChange={onSetMusicVolume} />
        )}
        <MusicModeSwitcher mode={musicMode} onChange={onSetMusicMode} />
      </div>
      {showProcess && (
        <div className="flex items-center gap-5 shrink-0">
          <span className="text-xs font-mono tracking-wide text-[color:var(--color-fg-muted)]">
            <kbd className="px-1.5 py-0.5 border border-[color:var(--color-border)] rounded-[3px]">
              ⌘
            </kbd>
            <span className="mx-1 opacity-60">+</span>
            <kbd className="px-1.5 py-0.5 border border-[color:var(--color-border)] rounded-[3px]">
              ↵
            </kbd>
            <span className="ml-2 opacity-70">to process</span>
          </span>
          <Button onClick={onProcess} disabled={!draftTrimmed}>
            <Send size={13} />
            Process
          </Button>
        </div>
      )}
    </footer>
  );
}

/**
 * Blurred, softened cover-art tile for background mode.
 *
 * A theme-colored scrim sits on top of the image so that bright or
 * high-contrast covers can't punch through and fight the text. The
 * combination reads as a hint of color/mood, not a picture.
 */
function BackgroundCover({ coverUrl }: { coverUrl: string }) {
  return (
    <img
      key={coverUrl}
      src={coverUrl}
      alt=""
      aria-hidden="true"
      className="absolute inset-0 w-full h-full object-cover opacity-[0.18] pointer-events-none z-0 blur-[8px] saturate-[0.9]"
    />
  );
}

function VolumeSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="range"
      min={0}
      max={1}
      step={0.01}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      title={`volume · ${Math.round(value * 100)}%`}
      className="shrink-0 w-20 accent-[color:var(--color-accent)] cursor-pointer"
    />
  );
}

/**
 * Segmented icon switcher for the three music presentation modes.
 * Active mode renders in accent color; others fade to the dim tier.
 */
function MusicModeSwitcher({
  mode,
  onChange,
}: {
  mode: Settings["musicMode"];
  onChange: (m: Settings["musicMode"]) => void;
}) {
  const items: {
    key: Settings["musicMode"];
    label: string;
    icon: React.ReactNode;
  }[] = [
    { key: "thumbnail", label: "cover-art chip in footer", icon: <Minimize2 size={12} /> },
    { key: "floating", label: "floating mini player", icon: <PictureInPicture2 size={12} /> },
    { key: "background", label: "cover art as background", icon: <Maximize2 size={12} /> },
  ];
  return (
    <div className="shrink-0 flex items-center gap-1.5 border-l border-[color:var(--color-border)] pl-3 ml-1">
      {items.map((it) => (
        <button
          key={it.key}
          onClick={() => onChange(it.key)}
          title={it.label}
          className={`transition-colors p-0.5 ${
            mode === it.key
              ? "text-[color:var(--color-accent)]"
              : "text-[color:var(--color-fg-dim)] hover:text-[color:var(--color-fg-muted)]"
          }`}
        >
          {it.icon}
        </button>
      ))}
    </div>
  );
}

type EditField = "title" | "body" | "topic" | "category" | "priority" | "tags";

function ItemsView({
  rawItems,
  visibleItems,
  allTopics,
  lastResult,
  groupBy,
  hideDone,
  trashView,
  search,
  onSearchChange,
  onSetGroupBy,
  onToggleHideDone,
  onToggleTrash,
  onToggleDone,
  onMoveItem,
  onEditItem,
  onDeleteItem,
  onRestoreItem,
  onPermanentDelete,
}: {
  rawItems: Item[];
  visibleItems: Item[];
  allTopics: string[];
  lastResult: AgentResult | null;
  groupBy: GroupBy;
  hideDone: boolean;
  trashView: boolean;
  search: string;
  onSearchChange: (s: string) => void;
  onSetGroupBy: (g: GroupBy) => void;
  onToggleHideDone: () => void;
  onToggleTrash: () => void;
  onToggleDone: (id: number, current: Item["status"]) => void;
  onMoveItem: (id: number, direction: "up" | "down") => void;
  onEditItem: (id: number, field: EditField, value: string | null) => void;
  onDeleteItem: (id: number) => void;
  onRestoreItem: (id: number) => void;
  onPermanentDelete: (id: number) => void;
}) {
  const groups = useMemo(
    () =>
      trashView
        ? [{ key: "trash", label: "recently deleted", items: visibleItems }]
        : groupItems(visibleItems, groupBy),
    [visibleItems, groupBy, trashView],
  );
  const doneCount = rawItems.filter((i) => i.status === "done").length;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-6 px-6 h-11 border-b border-[color:var(--color-border)] bg-[color:var(--color-background)]">
        {trashView ? (
          <div className="label text-[color:var(--color-danger)]">recently deleted</div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-xs lowercase text-[color:var(--color-fg-dim)] italic">
              group by
            </span>
            <nav className="flex items-center gap-3">
              {(["priority", "topic", "category"] as GroupBy[]).map((g, idx) => (
                <div key={g} className="flex items-center gap-3">
                  {idx > 0 && (
                    <span className="text-[color:var(--color-fg-dim)] text-xs">·</span>
                  )}
                  <button
                    onClick={() => onSetGroupBy(g)}
                    className={`label transition-colors ${
                      groupBy === g
                        ? "text-[color:var(--color-accent)]"
                        : "text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)]"
                    }`}
                  >
                    {g}
                  </button>
                </div>
              ))}
            </nav>
          </div>
        )}
        <div className="flex-1 flex items-center justify-center">
          <label className="flex items-center gap-2 w-full max-w-md border-b border-transparent focus-within:border-[color:var(--color-accent)] transition-colors h-7">
            <Search
              size={13}
              className="text-[color:var(--color-fg-dim)] shrink-0"
              strokeWidth={2}
            />
            <input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="search titles, topics, tags…"
              className="flex-1 bg-transparent border-0 outline-none text-sm placeholder:text-[color:var(--color-fg-dim)] text-[color:var(--color-fg)]"
            />
            {search && (
              <button
                onClick={() => onSearchChange("")}
                className="text-[color:var(--color-fg-dim)] hover:text-[color:var(--color-fg)] shrink-0"
                title="clear"
              >
                <X size={13} />
              </button>
            )}
          </label>
        </div>
        {!trashView && doneCount > 0 && (
          <button
            onClick={onToggleHideDone}
            title={hideDone ? "click to show completed items" : "click to hide completed items"}
            className="label label-row text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)] transition-colors"
          >
            <span
              className={`inline-block w-2.5 h-2.5 border transition-colors ${
                hideDone
                  ? "border-[color:var(--color-border)]"
                  : "bg-[color:var(--color-accent)] border-[color:var(--color-accent)]"
              }`}
            />
            <span>
              show done · {doneCount.toString().padStart(2, "0")}
            </span>
          </button>
        )}
        <button
          onClick={onToggleTrash}
          className={`label label-row transition-colors ${
            trashView
              ? "text-[color:var(--color-accent)]"
              : "text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)]"
          }`}
          title={trashView ? "exit trash" : "recently deleted (last 7 days)"}
        >
          <Trash2 size={13} />
          <span>{trashView ? "back to active" : "trash"}</span>
        </button>
      </div>

      <div className="flex-1 overflow-auto scroll-soft">
        <div className="max-w-3xl mx-auto px-10 py-8">
          {lastResult?.summary && (
            <div className="mb-10 pb-6 border-b border-[color:var(--color-border)]">
              <div className="label text-[color:var(--color-accent)] mb-2">
                last dump
              </div>
              <p className="text-sm text-[color:var(--color-fg-muted)] leading-relaxed">
                {lastResult.summary}
              </p>
            </div>
          )}
          {groups.length === 0 || (trashView && groups[0].items.length === 0) ? (
            <div className="flex items-center justify-center h-64 label text-[color:var(--color-fg-muted)]">
              {search
                ? `no items match “${search}”`
                : trashView
                  ? "nothing deleted in the last 7 days."
                  : hideDone && rawItems.length > 0
                    ? "everything done. toggle to surface completed items."
                    : "nothing yet. capture some thoughts and process."}
            </div>
          ) : (
            <Tracklist
              groups={groups}
              groupBy={trashView ? null : groupBy}
              allTopics={allTopics}
              trashView={trashView}
              onToggleDone={onToggleDone}
              onMoveItem={onMoveItem}
              onEditItem={onEditItem}
              onDeleteItem={onDeleteItem}
              onRestoreItem={onRestoreItem}
              onPermanentDelete={onPermanentDelete}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Tracklist({
  groups,
  groupBy,
  allTopics,
  trashView,
  onToggleDone,
  onMoveItem,
  onEditItem,
  onDeleteItem,
  onRestoreItem,
  onPermanentDelete,
}: {
  groups: { key: string; label: string; items: Item[] }[];
  groupBy: GroupBy | null;
  allTopics: string[];
  trashView: boolean;
  onToggleDone: (id: number, current: Item["status"]) => void;
  onMoveItem: (id: number, direction: "up" | "down") => void;
  onEditItem: (id: number, field: EditField, value: string | null) => void;
  onDeleteItem: (id: number) => void;
  onRestoreItem: (id: number) => void;
  onPermanentDelete: (id: number) => void;
}) {
  let runningIndex = 0;
  return (
    <div>
      {groups.map((g) => {
        const labelColor = groupBy
          ? groupHeaderColor(groupBy, g.key)
          : "text-[color:var(--color-fg)]";
        return (
          <section key={g.key} className="mb-14">
            <header className="flex items-baseline gap-4 mb-4">
              <h3 className={`label ${labelColor}`}>{g.label}</h3>
              <div className="flex-1 h-px bg-[color:var(--color-border)]" />
              <span className="label text-[color:var(--color-fg-muted)] tabular-nums">
                {g.items.length.toString().padStart(2, "0")}
              </span>
            </header>
            <ul>
              {g.items.map((item, idx) => {
                runningIndex += 1;
                return (
                  <ItemRow
                    key={item.id}
                    item={item}
                    index={runningIndex}
                    trashView={trashView}
                    groupBy={groupBy}
                    isFirstInGroup={idx === 0}
                    isLastInGroup={idx === g.items.length - 1}
                    allTopics={allTopics}
                    onMoveItem={onMoveItem}
                    onToggleDone={onToggleDone}
                    onEditItem={onEditItem}
                    onDeleteItem={onDeleteItem}
                    onRestoreItem={onRestoreItem}
                    onPermanentDelete={onPermanentDelete}
                  />
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

const CATEGORY_OPTIONS: Item["category"][] = [
  "bug",
  "task",
  "idea",
  "feedback",
  "question",
  "note",
];
const PRIORITY_OPTIONS: Item["priority"][] = ["urgent", "high", "medium", "low"];

const CATEGORY_COLOR: Record<Item["category"], string> = {
  bug: "text-[color:var(--color-danger)]",
  idea: "text-[color:var(--color-accent)]",
  feedback: "text-amber-700 dark:text-amber-400",
  task: "text-[color:var(--color-success)]",
  question: "text-purple-700 dark:text-purple-400",
  note: "text-[color:var(--color-fg-muted)]",
};

const PRIORITY_COLOR: Record<Item["priority"], string> = {
  urgent: "text-[color:var(--color-danger)]",
  high: "text-[color:var(--color-fg)]",
  medium: "text-[color:var(--color-fg-muted)]",
  low: "text-[color:var(--color-fg-muted)]",
};

function groupHeaderColor(mode: GroupBy, key: string): string {
  if (mode === "priority" && key in PRIORITY_COLOR) {
    return PRIORITY_COLOR[key as Item["priority"]];
  }
  if (mode === "category" && key in CATEGORY_COLOR) {
    return CATEGORY_COLOR[key as Item["category"]];
  }
  return "text-[color:var(--color-fg)]";
}

function ItemRow({
  item,
  index,
  trashView,
  groupBy,
  isFirstInGroup,
  isLastInGroup,
  allTopics,
  onMoveItem,
  onToggleDone,
  onEditItem,
  onDeleteItem,
  onRestoreItem,
  onPermanentDelete,
}: {
  item: Item;
  index: number;
  trashView: boolean;
  groupBy: GroupBy | null;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  allTopics: string[];
  onMoveItem: (id: number, direction: "up" | "down") => void;
  onToggleDone: (id: number, current: Item["status"]) => void;
  onEditItem: (id: number, field: EditField, value: string | null) => void;
  onDeleteItem: (id: number) => void;
  onRestoreItem: (id: number) => void;
  onPermanentDelete: (id: number) => void;
}) {
  const done = item.status === "done";
  const [, setEditing] = useState(false);
  const [confirmingPermDelete, setConfirmingPermDelete] = useState(false);
  const tags = item.tags ? item.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];

  useEffect(() => {
    if (!confirmingPermDelete) return;
    const id = setTimeout(() => setConfirmingPermDelete(false), 3000);
    return () => clearTimeout(id);
  }, [confirmingPermDelete]);

  const showCategory = groupBy !== "category";
  const showTopic = groupBy !== "topic";
  const showPriority = groupBy !== "priority";
  const urgentAccent =
    item.priority === "urgent" && groupBy !== "priority" && !done && !trashView;

  return (
    <li
      className={`group relative grid grid-cols-[40px_1fr_auto] gap-4 py-3.5 transition-opacity ${
        done ? "opacity-40" : ""
      } ${trashView ? "opacity-70" : ""}`}
    >
      <div className="flex items-start justify-end pt-0.5 select-none relative">
        <span
          className={`font-mono text-xs tabular-nums tracking-wider group-hover:opacity-0 transition-opacity ${
            urgentAccent
              ? "text-[color:var(--color-danger)]"
              : "text-[color:var(--color-fg-dim)]"
          }`}
        >
          {toRoman(index)}
        </span>
        {!trashView && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-px opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => onMoveItem(item.id, "up")}
              disabled={isFirstInGroup}
              title="move up"
              className="h-4 w-6 inline-flex items-center justify-center text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-accent)] disabled:opacity-25 disabled:pointer-events-none transition-colors"
            >
              <ChevronUp size={14} />
            </button>
            <button
              onClick={() => onMoveItem(item.id, "down")}
              disabled={isLastInGroup}
              title="move down"
              className="h-4 w-6 inline-flex items-center justify-center text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-accent)] disabled:opacity-25 disabled:pointer-events-none transition-colors"
            >
              <ChevronDown size={14} />
            </button>
          </div>
        )}
      </div>
      <div className="min-w-0">
        <EditableText
          value={item.title}
          onSave={(v) => onEditItem(item.id, "title", v)}
          placeholder="untitled"
          onEditingChange={setEditing}
          className={`text-[15px] font-semibold leading-snug text-[color:var(--color-fg)] ${
            done ? "line-through" : ""
          }`}
          displayClassName={`text-[15px] font-semibold leading-snug text-[color:var(--color-fg)] block ${
            done ? "line-through" : ""
          }`}
        />
        <div className="flex items-center gap-2.5 mt-1.5 label text-[color:var(--color-fg-muted)] flex-wrap">
          {showCategory && (
            <>
              <EditableSelect
                value={item.category}
                options={CATEGORY_OPTIONS}
                onSave={(v) => onEditItem(item.id, "category", v)}
                onEditingChange={setEditing}
                className={CATEGORY_COLOR[item.category]}
                renderOption={(c) => <span className={CATEGORY_COLOR[c]}>{c}</span>}
              />
              <Dot />
            </>
          )}
          {showTopic && (
            <>
              <EditableCombo
                value={item.topic ?? ""}
                options={allTopics}
                onSave={(v) => onEditItem(item.id, "topic", v)}
                placeholder="+ topic"
                onEditingChange={setEditing}
              />
              <Dot />
            </>
          )}
          {showPriority && (
            <>
              <EditableSelect
                value={item.priority}
                options={PRIORITY_OPTIONS}
                onSave={(v) => onEditItem(item.id, "priority", v)}
                onEditingChange={setEditing}
                className={PRIORITY_COLOR[item.priority]}
                renderOption={(p) => <span className={PRIORITY_COLOR[p]}>{p}</span>}
              />
              <Dot />
            </>
          )}
          <EditableText
            value={tags.length ? tags.map((t) => `#${t}`).join(" ") : ""}
            onSave={(v) => {
              const parsed = v
                .split(/[\s,]+/)
                .map((t) => t.replace(/^#/, "").trim())
                .filter(Boolean)
                .join(",");
              onEditItem(item.id, "tags", parsed || null);
            }}
            placeholder="+ tags"
            onEditingChange={setEditing}
            className="text-[color:var(--color-fg-dim)]"
            displayClassName="text-[color:var(--color-fg-dim)]"
          />
        </div>
        <div className="mt-2.5">
          <EditableText
            value={item.body ?? ""}
            onSave={(v) => onEditItem(item.id, "body", v.trim() ? v : null)}
            placeholder="+ add body"
            multiline
            onEditingChange={setEditing}
            className="text-sm text-[color:var(--color-fg-muted)] leading-relaxed max-w-[60ch] resize-none"
            displayClassName="text-sm text-[color:var(--color-fg-muted)] leading-relaxed max-w-[60ch]"
          />
        </div>
      </div>
      <div className="flex flex-col items-center gap-2 self-start mt-1">
        {trashView ? (
          <>
            <button
              onClick={() => onRestoreItem(item.id)}
              onMouseDown={(e) => e.stopPropagation()}
              title={`restore (deleted ${relativeTime(item.deleted_at)})`}
              className="text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-accent)] transition-colors"
            >
              <Undo2 size={13} />
            </button>
            <button
              onClick={() => {
                if (confirmingPermDelete) {
                  onPermanentDelete(item.id);
                } else {
                  setConfirmingPermDelete(true);
                }
              }}
              onMouseDown={(e) => e.stopPropagation()}
              title={
                confirmingPermDelete
                  ? "click again to confirm · auto-cancels in 3s"
                  : "delete permanently"
              }
              className={
                confirmingPermDelete
                  ? "text-[color:var(--color-danger)]"
                  : "text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-danger)] transition-colors"
              }
            >
              <Trash2 size={12} />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => onToggleDone(item.id, item.status)}
              title={done ? "mark open" : "mark done"}
              onMouseDown={(e) => e.stopPropagation()}
              className={`w-3.5 h-3.5 rounded-full border transition-colors ${
                done
                  ? "bg-[color:var(--color-accent)] border-[color:var(--color-accent)]"
                  : "border-[color:var(--color-border)] hover:border-[color:var(--color-accent)]"
              }`}
            />
            <button
              onClick={() => onDeleteItem(item.id)}
              onMouseDown={(e) => e.stopPropagation()}
              title="move to trash"
              className="opacity-0 group-hover:opacity-100 text-[color:var(--color-fg-dim)] hover:text-[color:var(--color-danger)] transition-opacity"
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function Dot() {
  return <span className="text-[color:var(--color-fg-dim)]">·</span>;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "unknown";
  const then = new Date(iso.replace(" ", "T") + "Z").getTime();
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function toRoman(n: number): string {
  const map: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let result = "";
  for (const [value, letter] of map) {
    while (n >= value) {
      result += letter;
      n -= value;
    }
  }
  return result;
}

function filterItems(
  items: Item[],
  search: string,
  hideDone: boolean,
  trashView: boolean,
): Item[] {
  const q = search.trim().toLowerCase();
  return items.filter((i) => {
    if (!trashView && hideDone && i.status === "done") return false;
    if (!q) return true;
    return (
      i.title.toLowerCase().includes(q) ||
      (i.body?.toLowerCase().includes(q) ?? false) ||
      (i.topic?.toLowerCase().includes(q) ?? false) ||
      (i.tags?.toLowerCase().includes(q) ?? false) ||
      i.category.includes(q) ||
      i.priority.includes(q)
    );
  });
}

function groupItems(items: Item[], by: GroupBy) {
  if (by === "priority") {
    const order: Item["priority"][] = ["urgent", "high", "medium", "low"];
    return order
      .map((p) => ({ key: p, label: p, items: items.filter((i) => i.priority === p) }))
      .filter((g) => g.items.length);
  }
  if (by === "category") {
    const order: Item["category"][] = [
      "bug", "task", "idea", "feedback", "question", "note",
    ];
    return order
      .map((c) => ({ key: c, label: c, items: items.filter((i) => i.category === c) }))
      .filter((g) => g.items.length);
  }
  const map = new Map<string, Item[]>();
  for (const i of items) {
    const key = i.topic?.trim() || "—";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(i);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => {
      if (a === "—") return 1;
      if (b === "—") return -1;
      return a.localeCompare(b);
    })
    .map(([key, gItems]) => ({
      key,
      label: key === "—" ? "untagged" : key,
      items: gItems,
    }));
}

function DeleteProjectDialog({
  project,
  onConfirm,
  onCancel,
}: {
  project: Project;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="w-[420px] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] p-5">
        <div className="label text-[color:var(--color-danger)] mb-3">
          Delete project
        </div>
        <p className="text-sm text-[color:var(--color-fg)] leading-relaxed mb-2">
          Delete <span className="font-semibold">{project.name}</span>?
        </p>
        <p className="text-xs text-[color:var(--color-fg-muted)] leading-relaxed mb-4">
          This permanently removes the project, all its captures, and all its
          items — including anything in the trash. This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

function NewProjectDialog({
  onCreate,
  onCancel,
}: {
  onCreate: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="w-96 bg-[color:var(--color-surface)] border border-[color:var(--color-border)] p-5">
        <div className="label text-[color:var(--color-fg-muted)] mb-3">New project</div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="project name"
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) onCreate(name.trim());
            if (e.key === "Escape") onCancel();
          }}
          className="w-full bg-transparent border-b border-[color:var(--color-border)] px-0 h-9 text-sm focus:outline-none focus:border-[color:var(--color-accent)] placeholder:text-[color:var(--color-fg-dim)]"
        />
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => name.trim() && onCreate(name.trim())} disabled={!name.trim()}>
            Create
          </Button>
        </div>
      </div>
    </div>
  );
}
