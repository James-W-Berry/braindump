// Only renders in dev builds. Paired with the separate identifier and DB
// filename (see src-tauri/tauri.dev.conf.json and src-tauri/src/lib.rs),
// this gives the user a visual confirmation that they're looking at the
// dev instance and not the prod one.
export function DevBadge({ className = "" }: { className?: string }) {
  if (!import.meta.env.DEV) return null;
  return (
    <span
      title="Development build — separate app-data dir and DB from prod"
      className={`inline-flex items-center font-semibold uppercase tracking-[0.15em] text-[9px] leading-none px-1.5 py-0.5 rounded-sm bg-[#c231cf] text-white ${className}`}
    >
      dev
    </span>
  );
}
