import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Radio, Search } from "lucide-react";
import {
  type EpisodesState,
  formatBroadcastDate,
  useOtakuEpisodes,
} from "@/components/NTSPlayer";
import type { OtakuEpisode } from "@/lib/settings";

/**
 * Searchable popover listing every Otaku archive episode, with a
 * "listen live" option pinned to the top.
 *
 * Modeled on the old YouTube recents combobox — bottom-anchored,
 * `onMouseDown` preventDefault on menu items so clicks beat the input
 * blur — but reads its data from the NTS API rather than local history.
 */
export function EpisodePicker({
  open,
  anchorRef,
  activeEpisode,
  onPickLive,
  onPickEpisode,
  onClose,
}: {
  open: boolean;
  /** The button the picker positions itself above. */
  anchorRef: React.RefObject<HTMLElement | null>;
  activeEpisode: OtakuEpisode | null;
  onPickLive: () => void;
  onPickEpisode: (ep: OtakuEpisode) => void;
  onClose: () => void;
}) {
  const episodes = useOtakuEpisodes(open);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the search input on open so the user can type immediately.
  useEffect(() => {
    if (open) {
      setQuery("");
      // Defer to next frame — the input might not exist on this render
      // if we just flipped open to true.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Dismiss on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const root = rootRef.current;
      const anchor = anchorRef.current;
      const t = e.target as Node;
      if (root?.contains(t)) return;
      if (anchor?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return (
    <div
      ref={rootRef}
      className="absolute bottom-full left-0 mb-2 w-[360px] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] shadow-[0_10px_40px_-10px_rgba(0,0,0,0.45)] z-40 flex flex-col"
      style={{ maxHeight: 420 }}
    >
      <div className="shrink-0 flex items-center gap-2 px-2.5 py-2 border-b border-[color:var(--color-border)]">
        <Search size={12} className="text-[color:var(--color-fg-dim)]" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search Otaku episodes…"
          spellCheck={false}
          className="flex-1 bg-transparent outline-none text-xs font-mono text-[color:var(--color-fg)] placeholder:text-[color:var(--color-fg-dim)]"
        />
      </div>
      <LiveRow active={!activeEpisode} onPick={onPickLive} />
      <EpisodeList
        episodes={episodes}
        query={query}
        activeSlug={activeEpisode?.slug ?? null}
        onPick={onPickEpisode}
      />
    </div>
  );
}

function LiveRow({
  active,
  onPick,
}: {
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        onPick();
      }}
      className={`shrink-0 flex items-center gap-2.5 w-full text-left px-2.5 py-2 transition-colors border-b border-[color:var(--color-border)] ${
        active
          ? "bg-[color:var(--color-accent-soft)] hover:bg-[color:var(--color-surface-hi)]"
          : "hover:bg-[color:var(--color-surface-hi)]"
      }`}
    >
      <span className="w-10 h-10 shrink-0 flex items-center justify-center bg-[color:var(--color-surface-hi)] border border-[color:var(--color-border)]">
        <Radio size={14} className="text-[color:var(--color-accent)]" />
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={`text-[13px] leading-tight ${
            active
              ? "text-[color:var(--color-accent)]"
              : "text-[color:var(--color-fg)]"
          }`}
        >
          NTS 1 · live
        </div>
        <div className="text-[10px] font-mono text-[color:var(--color-fg-dim)] mt-0.5">
          whatever's on right now
        </div>
      </div>
      {active && (
        <Check
          size={14}
          className="shrink-0 text-[color:var(--color-accent)]"
          aria-label="currently selected"
        />
      )}
    </button>
  );
}

function EpisodeList({
  episodes,
  query,
  activeSlug,
  onPick,
}: {
  episodes: EpisodesState;
  query: string;
  activeSlug: string | null;
  onPick: (ep: OtakuEpisode) => void;
}) {
  if (episodes.status === "idle" || episodes.status === "loading") {
    return (
      <div className="px-2.5 py-4 text-xs text-[color:var(--color-fg-muted)] italic">
        loading episodes…
      </div>
    );
  }
  if (episodes.status === "error") {
    return (
      <div className="px-2.5 py-4 text-xs text-[color:var(--color-danger)]">
        couldn't load episodes: {episodes.message}
      </div>
    );
  }
  const filtered = useFilteredEpisodes(episodes.episodes, query);
  if (filtered.length === 0) {
    return (
      <div className="px-2.5 py-4 text-xs text-[color:var(--color-fg-muted)] italic">
        no episodes match "{query}"
      </div>
    );
  }
  return (
    <ul
      className="flex-1 overflow-auto scroll-soft"
      // Prevent the input from losing focus when the scrollbar is clicked.
      onMouseDown={(e) => e.preventDefault()}
    >
      {filtered.map((ep) => {
        const isActive = ep.slug === activeSlug;
        return (
          <li key={ep.slug}>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(ep);
              }}
              className={`flex items-center gap-2.5 w-full text-left px-2.5 py-2 transition-colors border-b border-[color:var(--color-border)] last:border-b-0 ${
                isActive
                  ? "bg-[color:var(--color-accent-soft)] hover:bg-[color:var(--color-surface-hi)]"
                  : "hover:bg-[color:var(--color-surface-hi)]"
              }`}
            >
              {ep.coverUrl ? (
                <img
                  src={ep.coverUrl}
                  alt=""
                  aria-hidden="true"
                  className="w-10 h-10 object-cover shrink-0 border border-[color:var(--color-border)]"
                />
              ) : (
                <div className="w-10 h-10 shrink-0 bg-[color:var(--color-surface-hi)] border border-[color:var(--color-border)]" />
              )}
              <div className="min-w-0 flex-1">
                <div
                  className={`text-[13px] truncate leading-tight ${
                    isActive
                      ? "text-[color:var(--color-accent)]"
                      : "text-[color:var(--color-fg)]"
                  }`}
                >
                  {ep.title}
                </div>
                <div className="text-[10px] font-mono text-[color:var(--color-fg-dim)] truncate mt-0.5">
                  {formatBroadcastDate(ep.broadcast)}
                </div>
              </div>
              {isActive && (
                <Check
                  size={14}
                  className="shrink-0 text-[color:var(--color-accent)]"
                  aria-label="currently selected"
                />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function useFilteredEpisodes(
  episodes: OtakuEpisode[],
  query: string,
): OtakuEpisode[] {
  return useMemo(() => {
    const sorted = [...episodes].sort((a, b) => {
      // Most recent broadcast first.
      const at = Date.parse(a.broadcast);
      const bt = Date.parse(b.broadcast);
      if (!Number.isNaN(at) && !Number.isNaN(bt)) return bt - at;
      return 0;
    });
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (ep) =>
        ep.title.toLowerCase().includes(q) ||
        ep.slug.toLowerCase().includes(q) ||
        formatBroadcastDate(ep.broadcast).toLowerCase().includes(q),
    );
  }, [episodes, query]);
}
