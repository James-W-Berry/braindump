import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

interface CommonProps {
  className?: string;
  displayClassName?: string;
  placeholder?: string;
  onEditingChange?: (editing: boolean) => void;
}

export function EditableText({
  value,
  onSave,
  multiline = false,
  className,
  displayClassName,
  placeholder = "—",
  onEditingChange,
  renderEmpty,
}: CommonProps & {
  value: string;
  onSave: (next: string) => void | Promise<void>;
  multiline?: boolean;
  renderEmpty?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  useLayoutEffect(() => {
    if (!editing || !multiline) return;
    const el = inputRef.current;
    if (!el || !(el instanceof HTMLTextAreaElement)) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [editing, multiline, local]);

  function startEdit() {
    setLocal(value);
    setEditing(true);
    onEditingChange?.(true);
  }

  function commit() {
    const trimmed = local.trim();
    if (trimmed !== value.trim()) {
      onSave(trimmed);
    }
    setEditing(false);
    onEditingChange?.(false);
  }

  function cancel() {
    setLocal(value);
    setEditing(false);
    onEditingChange?.(false);
  }

  if (editing) {
    const shared = {
      ref: inputRef as any,
      value: local,
      autoFocus: true,
      draggable: false,
      spellCheck: true,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setLocal(e.target.value),
      onBlur: commit,
      onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
        if (e.key === "Enter" && !multiline) {
          e.preventDefault();
          commit();
        }
        if (e.key === "Enter" && multiline && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          commit();
        }
      },
      placeholder,
      className: `w-full bg-transparent outline-none border-0 p-0 m-0 ${className ?? ""}`,
    };
    return multiline ? (
      <textarea
        {...(shared as any)}
        rows={1}
        style={{ minHeight: "4.5em", overflow: "hidden" }}
      />
    ) : (
      <input type="text" {...(shared as any)} />
    );
  }

  const isEmpty = !value || !value.trim();
  return (
    <span
      onClick={startEdit}
      className={`cursor-text inline-block ${
        isEmpty ? "text-[color:var(--color-fg-dim)] italic" : ""
      } ${displayClassName ?? className ?? ""}`}
      title="click to edit"
    >
      {isEmpty ? (renderEmpty ?? placeholder) : value}
    </span>
  );
}

export function EditableCombo({
  value,
  options,
  onSave,
  className,
  displayClassName,
  placeholder = "—",
  onEditingChange,
  normalize = (s) => s.trim().toLowerCase(),
}: CommonProps & {
  value: string;
  options: string[];
  onSave: (next: string | null) => void | Promise<void>;
  normalize?: (s: string) => string;
}) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState(value);
  // -1 means "no suggestion highlighted" — Enter commits the typed text, not a
  // suggestion. Arrow keys move into and out of the suggestion list.
  const [highlighted, setHighlighted] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const opts = options.filter((o) => o && o.trim());
    if (!q) return opts;
    return opts.filter((o) => o.toLowerCase().includes(q));
  }, [query, options]);

  const exactMatch = useMemo(() => {
    const n = normalize(query);
    if (!n) return null;
    return options.find((o) => normalize(o) === n) ?? null;
  }, [query, options, normalize]);

  function commit(raw: string) {
    const n = normalize(raw);
    const prev = normalize(value);
    if (n !== prev) {
      onSave(n ? n : null);
    }
    setEditing(false);
    onEditingChange?.(false);
  }

  function cancel() {
    setQuery(value);
    setEditing(false);
    onEditingChange?.(false);
  }

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setQuery(value);
    setHighlighted(-1);
    setEditing(true);
    onEditingChange?.(true);
  }

  if (editing) {
    const showCreateHint =
      query.trim().length > 0 && !exactMatch;
    return (
      <span className="relative inline-block">
        <input
          ref={inputRef}
          autoFocus
          type="text"
          value={query}
          draggable={false}
          spellCheck={false}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlighted(-1);
          }}
          onBlur={() => {
            // Defer so a click on a suggestion (which uses onMouseDown +
            // preventDefault) can win the race.
            setTimeout(() => {
              if (document.activeElement !== inputRef.current) {
                commit(query);
              }
            }, 120);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (highlighted >= 0 && filtered[highlighted]) {
                commit(filtered[highlighted]);
              } else if (exactMatch) {
                commit(exactMatch);
              } else {
                commit(query);
              }
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlighted((h) =>
                filtered.length === 0 ? -1 : Math.min(filtered.length - 1, h + 1),
              );
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlighted((h) => (h <= 0 ? -1 : h - 1));
            } else if (e.key === "Tab") {
              // Let tab commit + move focus naturally.
              commit(query);
            }
          }}
          placeholder={placeholder}
          className={`w-full bg-transparent outline-none border-0 p-0 m-0 ${className ?? ""}`}
        />
        {(filtered.length > 0 || showCreateHint) && (
          <div
            ref={listRef}
            onMouseDown={(e) => e.preventDefault()}
            className="absolute left-0 top-full mt-1 min-w-[160px] max-h-56 overflow-auto bg-[color:var(--color-surface)] border border-[color:var(--color-border)] shadow-lg z-20 scroll-soft"
          >
            {filtered.map((opt, i) => (
              <button
                key={opt}
                type="button"
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => commit(opt)}
                className={`block w-full text-left px-2.5 py-1.5 text-sm font-normal lowercase ${
                  i === highlighted
                    ? "bg-[color:var(--color-accent)]/10 text-[color:var(--color-fg)]"
                    : "text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)]"
                }`}
              >
                {opt}
              </button>
            ))}
            {showCreateHint && (
              <div
                className={`px-2.5 py-1.5 text-xs ${
                  filtered.length > 0
                    ? "border-t border-[color:var(--color-border)]"
                    : ""
                } text-[color:var(--color-fg-dim)]`}
              >
                enter to create{" "}
                <span className="text-[color:var(--color-accent)]">
                  {normalize(query)}
                </span>
              </div>
            )}
          </div>
        )}
      </span>
    );
  }

  const isEmpty = !value || !value.trim();
  return (
    <span
      onClick={startEdit}
      className={`cursor-text inline-block ${
        isEmpty ? "text-[color:var(--color-fg-dim)] italic" : ""
      } ${displayClassName ?? className ?? ""}`}
      title="click to edit"
    >
      {isEmpty ? placeholder : value}
    </span>
  );
}

export function EditableSelect<T extends string>({
  value,
  options,
  onSave,
  className,
  onEditingChange,
  renderOption,
}: CommonProps & {
  value: T;
  options: readonly T[];
  onSave: (next: T) => void | Promise<void>;
  renderOption?: (v: T) => React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <select
        autoFocus
        value={value}
        draggable={false}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          onSave(e.target.value as T);
          setEditing(false);
          onEditingChange?.(false);
        }}
        onBlur={() => {
          setEditing(false);
          onEditingChange?.(false);
        }}
        className={`bg-[color:var(--color-surface-hi)] border border-[color:var(--color-border)] outline-none text-xs py-0.5 px-1 font-mono uppercase tracking-wider ${className ?? ""}`}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
        onEditingChange?.(true);
      }}
      className={`cursor-pointer hover:text-[color:var(--color-accent)] transition-colors ${className ?? ""}`}
      title="click to change"
    >
      {renderOption ? renderOption(value) : value}
    </span>
  );
}
