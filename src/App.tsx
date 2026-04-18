import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Send,
  X,
  Eye,
  EyeOff,
  Search,
  Trash2,
  Undo2,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { SettingsPopover } from "@/components/SettingsPopover";
import { ProcessingView } from "@/components/ProcessingView";
import { EditableText, EditableSelect } from "@/components/Editable";
import {
  listProjects,
  createProject,
  createCapture,
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
  const [error, setError] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  async function handleProcess() {
    if (!activeProject || !draft.trim()) return;
    setError(null);
    setView("processing");
    try {
      const capture = await createCapture(activeProject.id, draft);
      const existing = items.map((i) => ({
        id: i.id,
        title: i.title,
        category: i.category,
        topic: i.topic,
        status: i.status,
      }));
      const result = await processCapture({
        projectName: activeProject.name,
        projectDescription: activeProject.description,
        existingItems: existing,
        rawText: draft,
        model: settings.model,
      });
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
          await linkItems(newId, relId);
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

  return (
    <div className="flex flex-col h-full">
      <Header
        projects={projects}
        activeProjectId={activeProjectId}
        onPickProject={setActiveProjectId}
        onNewProject={() => setShowNewProject(true)}
        view={view === "processing" ? "capture" : view}
        onSetView={setView}
        settings={settings}
        onUpdateSettings={update}
        updater={updater}
        disabled={view === "processing"}
      />

      {error && (
        <div className="px-6 py-2 bg-[color:var(--color-danger)]/15 text-[color:var(--color-danger)] text-sm flex items-center justify-between font-mono">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}

      <main className="flex-1 overflow-hidden">
        {view === "processing" ? (
          <ProcessingView projectName={activeProject?.name ?? ""} />
        ) : view === "capture" ? (
          <CaptureView
            textareaRef={textareaRef}
            draft={draft}
            onDraftChange={setDraft}
            onProcess={handleProcess}
            projectName={activeProject?.name ?? ""}
            fontFamily={FONT_STACKS[settings.font]}
            fontSize={settings.fontSize}
          />
        ) : (
          <ItemsView
            items={trashView ? trashItems : items}
            lastResult={trashView ? null : lastResult}
            groupBy={settings.groupBy}
            hideDone={settings.hideDone}
            trashView={trashView}
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

      {showNewProject && (
        <NewProjectDialog
          onCreate={handleCreateProject}
          onCancel={() => setShowNewProject(false)}
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
  view,
  onSetView,
  settings,
  onUpdateSettings,
  updater,
  disabled,
}: {
  projects: Project[];
  activeProjectId: number | null;
  onPickProject: (id: number) => void;
  onNewProject: () => void;
  view: "capture" | "items";
  onSetView: (v: View) => void;
  settings: ReturnType<typeof useSettings>["settings"];
  onUpdateSettings: ReturnType<typeof useSettings>["update"];
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
  const wordCount = draft.trim() ? draft.trim().split(/\s+/).length : 0;

  return (
    <div className="flex flex-col h-full">
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        placeholder={`Dump thoughts for ${projectName || "your project"}. No structure needed — just write.`}
        style={{ fontFamily, fontSize: `${fontSize}px`, lineHeight: 1.6 }}
        className="flex-1 resize-none bg-transparent outline-none px-10 py-8 text-[color:var(--color-fg)] placeholder:text-[color:var(--color-fg-dim)] scroll-soft caret-[color:var(--color-accent)]"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            onProcess();
          }
        }}
      />
      <footer className="flex items-center justify-between px-6 h-12 border-t border-[color:var(--color-border)] bg-[color:var(--color-background)]">
        <span className="label label-row text-[color:var(--color-fg-muted)] tabular-nums">
          {wordCount.toString().padStart(3, "0")} words
        </span>
        <div className="flex items-center gap-5">
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
          <Button onClick={onProcess} disabled={!draft.trim()}>
            <Send size={13} />
            Process
          </Button>
        </div>
      </footer>
    </div>
  );
}

type EditField = "title" | "body" | "topic" | "category" | "priority" | "tags";

function ItemsView({
  items,
  lastResult,
  groupBy,
  hideDone,
  trashView,
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
  items: Item[];
  lastResult: AgentResult | null;
  groupBy: GroupBy;
  hideDone: boolean;
  trashView: boolean;
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
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
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
  }, [items, hideDone, search, trashView]);

  const groups = useMemo(
    () =>
      trashView
        ? [{ key: "trash", label: "recently deleted", items: visible }]
        : groupItems(visible, groupBy),
    [visible, groupBy, trashView],
  );
  const doneCount = items.filter((i) => i.status === "done").length;
  const totalVisible = visible.length;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-6 px-6 h-11 border-b border-[color:var(--color-border)] bg-[color:var(--color-background)]">
        {trashView ? (
          <div className="label text-[color:var(--color-danger)]">recently deleted</div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="label text-[color:var(--color-fg-muted)]">group</span>
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
              onChange={(e) => setSearch(e.target.value)}
              placeholder="search titles, topics, tags…"
              className="flex-1 bg-transparent border-0 outline-none text-sm placeholder:text-[color:var(--color-fg-dim)] text-[color:var(--color-fg)]"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="text-[color:var(--color-fg-dim)] hover:text-[color:var(--color-fg)] shrink-0"
                title="clear"
              >
                <X size={13} />
              </button>
            )}
          </label>
        </div>
        {!trashView && (
          <button
            onClick={onToggleHideDone}
            className="label label-row text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)] transition-colors"
          >
            {hideDone ? <EyeOff size={13} /> : <Eye size={13} />}
            <span>
              {hideDone ? `hiding ${doneCount}` : `showing ${doneCount} done`}
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
                  : hideDone && items.length > 0
                    ? "everything done. toggle to surface completed items."
                    : "nothing yet. capture some thoughts and process."}
            </div>
          ) : (
            <Tracklist
              groups={groups}
              trashView={trashView}
              onToggleDone={onToggleDone}
              onMoveItem={onMoveItem}
              onEditItem={onEditItem}
              onDeleteItem={onDeleteItem}
              onRestoreItem={onRestoreItem}
              onPermanentDelete={onPermanentDelete}
              totalVisible={totalVisible}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Tracklist({
  groups,
  trashView,
  onToggleDone,
  onMoveItem,
  onEditItem,
  onDeleteItem,
  onRestoreItem,
  onPermanentDelete,
  totalVisible,
}: {
  groups: { key: string; label: string; items: Item[] }[];
  trashView: boolean;
  onToggleDone: (id: number, current: Item["status"]) => void;
  onMoveItem: (id: number, direction: "up" | "down") => void;
  onEditItem: (id: number, field: EditField, value: string | null) => void;
  onDeleteItem: (id: number) => void;
  onRestoreItem: (id: number) => void;
  onPermanentDelete: (id: number) => void;
  totalVisible: number;
}) {
  let runningIndex = 0;
  return (
    <div>
      {groups.map((g) => (
        <section key={g.key} className="mb-12">
          <header className="flex items-baseline gap-4 mb-2 pb-2 border-b border-transparent">
            <h3 className="label text-[color:var(--color-fg)]">{g.label}</h3>
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
                  isFirstInGroup={idx === 0}
                  isLastInGroup={idx === g.items.length - 1}
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
      ))}
      <div className="flex items-baseline gap-4 pt-2">
        <div className="flex-1 h-px bg-[color:var(--color-border)]" />
        <span className="label text-[color:var(--color-accent)] tabular-nums">
          {totalVisible.toString().padStart(2, "0")} total
        </span>
      </div>
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

function ItemRow({
  item,
  index,
  trashView,
  isFirstInGroup,
  isLastInGroup,
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
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  onMoveItem: (id: number, direction: "up" | "down") => void;
  onToggleDone: (id: number, current: Item["status"]) => void;
  onEditItem: (id: number, field: EditField, value: string | null) => void;
  onDeleteItem: (id: number) => void;
  onRestoreItem: (id: number) => void;
  onPermanentDelete: (id: number) => void;
}) {
  const done = item.status === "done";
  const [, setEditing] = useState(false);
  const tags = item.tags ? item.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];

  const categoryColor: Record<Item["category"], string> = {
    bug: "text-[color:var(--color-danger)]",
    idea: "text-[color:var(--color-accent)]",
    feedback: "text-amber-700 dark:text-amber-400",
    task: "text-[color:var(--color-success)]",
    question: "text-purple-700 dark:text-purple-400",
    note: "text-[color:var(--color-fg-muted)]",
  };

  const priorityColor: Record<Item["priority"], string> = {
    urgent: "text-[color:var(--color-danger)]",
    high: "text-[color:var(--color-fg)]",
    medium: "text-[color:var(--color-fg-muted)]",
    low: "text-[color:var(--color-fg-muted)]",
  };

  return (
    <li
      className={`group relative grid grid-cols-[40px_1fr_auto] gap-4 py-4 border-b border-[color:var(--color-border)] transition-opacity ${
        done ? "opacity-40" : ""
      } ${trashView ? "opacity-70" : ""}`}
    >
      <div className="flex items-start justify-end pt-0.5 select-none relative">
        <span className="font-mono text-xs text-[color:var(--color-fg-dim)] tabular-nums tracking-wider group-hover:opacity-0 transition-opacity">
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
          <EditableSelect
            value={item.category}
            options={CATEGORY_OPTIONS}
            onSave={(v) => onEditItem(item.id, "category", v)}
            onEditingChange={setEditing}
            className={categoryColor[item.category]}
            renderOption={(c) => <span className={categoryColor[c]}>{c}</span>}
          />
          <Dot />
          <EditableText
            value={item.topic ?? ""}
            onSave={(v) => onEditItem(item.id, "topic", v.trim() ? v.trim() : null)}
            placeholder="+ topic"
            onEditingChange={setEditing}
          />
          <Dot />
          <EditableSelect
            value={item.priority}
            options={PRIORITY_OPTIONS}
            onSave={(v) => onEditItem(item.id, "priority", v)}
            onEditingChange={setEditing}
            className={priorityColor[item.priority]}
            renderOption={(p) => <span className={priorityColor[p]}>{p}</span>}
          />
          <Dot />
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
                if (confirm(`Permanently delete "${item.title}"? This cannot be undone.`))
                  onPermanentDelete(item.id);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              title="delete permanently"
              className="text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-danger)] transition-colors"
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
              onClick={() => {
                if (confirm(`Delete "${item.title}"?`)) onDeleteItem(item.id);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              title="delete"
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
