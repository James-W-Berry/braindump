import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdaterStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up-to-date"; checkedAt: Date }
  | { kind: "available"; version: string }
  | { kind: "downloading"; version: string; downloaded: number; total: number | null }
  | { kind: "ready"; version: string }
  | { kind: "error"; message: string };

export interface UseUpdater {
  status: UpdaterStatus;
  checkForUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  hasPendingUpdate: boolean;
}

export function useUpdater(autoCheckOnMount = true): UseUpdater {
  const [status, setStatus] = useState<UpdaterStatus>({ kind: "idle" });
  const updateRef = useRef<Update | null>(null);
  const checkedOnce = useRef(false);

  const checkForUpdate = useCallback(async () => {
    setStatus({ kind: "checking" });
    try {
      const update = await check();
      if (update) {
        updateRef.current = update;
        setStatus({ kind: "available", version: update.version });
      } else {
        updateRef.current = null;
        setStatus({ kind: "up-to-date", checkedAt: new Date() });
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setStatus({ kind: "error", message });
    }
  }, []);

  const installUpdate = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;

    let downloaded = 0;
    let total: number | null = null;
    setStatus({ kind: "downloading", version: update.version, downloaded, total });

    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
          setStatus({
            kind: "downloading",
            version: update.version,
            downloaded: 0,
            total,
          });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setStatus({
            kind: "downloading",
            version: update.version,
            downloaded,
            total,
          });
        } else if (event.event === "Finished") {
          setStatus({ kind: "ready", version: update.version });
        }
      });

      // Give the UI a moment to render "Ready", then restart.
      setTimeout(() => {
        relaunch().catch(() => {});
      }, 500);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setStatus({ kind: "error", message });
    }
  }, []);

  useEffect(() => {
    if (!autoCheckOnMount || checkedOnce.current) return;
    checkedOnce.current = true;
    // Check silently after a short delay so we don't block initial render.
    const t = setTimeout(() => {
      checkForUpdate();
    }, 1500);
    return () => clearTimeout(t);
  }, [autoCheckOnMount, checkForUpdate]);

  const hasPendingUpdate =
    status.kind === "available" ||
    status.kind === "downloading" ||
    status.kind === "ready";

  return { status, checkForUpdate, installUpdate, hasPendingUpdate };
}
