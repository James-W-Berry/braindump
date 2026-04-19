import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface ClaudeStatus {
  installed: boolean;
  version: string | null;
}

export interface OllamaStatus {
  binary_present: boolean;
  service_running: boolean;
  models: string[];
  has_required_model: boolean;
  required_model: string;
}

export type SetupProgress =
  | { stage: "download-ollama"; bytes_done: number; bytes_total: number }
  | { stage: "extract-ollama"; message: string }
  | { stage: "launch-ollama"; message: string }
  | {
      stage: "pull-model";
      bytes_done: number;
      bytes_total: number;
      message: string;
    }
  | { stage: "verify"; message: string };

export async function checkClaude(): Promise<ClaudeStatus> {
  return invoke<ClaudeStatus>("check_claude");
}

export async function checkOllama(): Promise<OllamaStatus> {
  return invoke<OllamaStatus>("check_ollama");
}

export async function installOllama(): Promise<void> {
  await invoke("install_ollama");
}

export async function launchOllama(): Promise<void> {
  await invoke("launch_ollama");
}

export async function pullOllamaModel(model: string): Promise<void> {
  await invoke("pull_ollama_model", { model });
}

export async function verifyOllamaSetup(model: string): Promise<void> {
  await invoke("verify_ollama_setup", { model });
}

export async function systemRamGB(): Promise<number> {
  return invoke<number>("system_ram_gb");
}

export async function openExternalUrl(url: string): Promise<void> {
  await invoke("open_external_url", { url });
}

export function onSetupProgress(
  cb: (p: SetupProgress) => void,
): Promise<UnlistenFn> {
  return listen<SetupProgress>("setup-progress", (e) => cb(e.payload));
}

export function formatBytes(n: number): string {
  if (!n || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
