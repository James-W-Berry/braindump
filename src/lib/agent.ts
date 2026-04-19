import { invoke } from "@tauri-apps/api/core";

export interface NewItem {
  title: string;
  body: string | null;
  category: "bug" | "idea" | "feedback" | "task" | "question" | "note";
  priority: "low" | "medium" | "high" | "urgent";
  topic: string | null;
  tags: string[];
  related_item_ids: number[];
}

export interface AgentResult {
  items: NewItem[];
  summary: string | null;
}

export interface ExistingItemContext {
  id: number;
  title: string;
  category: string;
  topic: string | null;
  status: string;
}

export async function processCapture(args: {
  projectName: string;
  projectDescription: string | null;
  existingItems: ExistingItemContext[];
  rawText: string;
  model: string;
  provider: "claude" | "ollama";
}): Promise<AgentResult> {
  return await invoke<AgentResult>("process_capture", {
    projectName: args.projectName,
    projectDescription: args.projectDescription,
    existingItems: args.existingItems,
    rawText: args.rawText,
    model: args.model,
    provider: args.provider,
  });
}
