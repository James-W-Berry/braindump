import { useEffect, useLayoutEffect, useRef, useState } from "react";

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
