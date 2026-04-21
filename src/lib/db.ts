import Database from "@tauri-apps/plugin-sql";

let _db: Database | null = null;

// Must match DB_URL in src-tauri/src/lib.rs — dev builds use a separate
// SQLite file so locally-applied migrations can't corrupt the production DB.
const DB_URL = import.meta.env.DEV
  ? "sqlite:braindump-dev.db"
  : "sqlite:braindump.db";

export async function db(): Promise<Database> {
  if (!_db) {
    _db = await Database.load(DB_URL);
  }
  return _db;
}

export interface Project {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
}

export interface Capture {
  id: number;
  project_id: number;
  raw_text: string;
  created_at: string;
  processed_at: string | null;
  status: "draft" | "processing" | "processed" | "failed";
  error_message: string | null;
}

export interface Item {
  id: number;
  project_id: number;
  capture_id: number | null;
  title: string;
  body: string | null;
  category: "bug" | "idea" | "feedback" | "task" | "question" | "note";
  priority: "low" | "medium" | "high" | "urgent";
  status: "open" | "in_progress" | "done" | "archived";
  topic: string | null;
  tags: string | null;
  position: number | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function listProjects(): Promise<Project[]> {
  const d = await db();
  return d.select<Project[]>("SELECT * FROM projects ORDER BY name ASC");
}

export async function createProject(name: string, description?: string): Promise<Project> {
  const d = await db();
  const res = await d.execute(
    "INSERT INTO projects (name, description) VALUES (?, ?)",
    [name, description ?? null],
  );
  const rows = await d.select<Project[]>("SELECT * FROM projects WHERE id = ?", [res.lastInsertId]);
  return rows[0];
}

export async function deleteProject(id: number): Promise<void> {
  const d = await db();
  await d.execute("DELETE FROM projects WHERE id = ?", [id]);
}

export async function createCapture(
  projectId: number,
  rawText: string,
): Promise<Capture> {
  const d = await db();
  const res = await d.execute(
    "INSERT INTO captures (project_id, raw_text) VALUES (?, ?)",
    [projectId, rawText],
  );
  const rows = await d.select<Capture[]>("SELECT * FROM captures WHERE id = ?", [res.lastInsertId]);
  return rows[0];
}

export async function getDraft(projectId: number): Promise<string | null> {
  const d = await db();
  const rows = await d.select<{ raw_text: string }[]>(
    "SELECT raw_text FROM captures WHERE project_id = ? AND status = 'draft' LIMIT 1",
    [projectId],
  );
  return rows[0]?.raw_text ?? null;
}

export async function upsertDraft(
  projectId: number,
  rawText: string,
): Promise<Capture> {
  const d = await db();
  const res = await d.execute(
    "UPDATE captures SET raw_text = ? WHERE project_id = ? AND status = 'draft'",
    [rawText, projectId],
  );
  if (!res.rowsAffected) {
    await d.execute(
      "INSERT INTO captures (project_id, raw_text) VALUES (?, ?)",
      [projectId, rawText],
    );
  }
  const rows = await d.select<Capture[]>(
    "SELECT * FROM captures WHERE project_id = ? AND status = 'draft' LIMIT 1",
    [projectId],
  );
  return rows[0];
}

export async function clearDraft(projectId: number): Promise<void> {
  const d = await db();
  await d.execute(
    "DELETE FROM captures WHERE project_id = ? AND status = 'draft'",
    [projectId],
  );
}

export async function markCaptureProcessed(
  captureId: number,
  status: "processed" | "failed",
  errorMessage?: string,
) {
  const d = await db();
  await d.execute(
    "UPDATE captures SET status = ?, processed_at = datetime('now'), error_message = ? WHERE id = ?",
    [status, errorMessage ?? null, captureId],
  );
}

export async function listItems(projectId: number): Promise<Item[]> {
  const d = await db();
  return d.select<Item[]>(
    "SELECT * FROM items WHERE project_id = ? AND status != 'archived' AND deleted_at IS NULL ORDER BY position ASC, created_at ASC",
    [projectId],
  );
}

export async function listRecentlyDeleted(
  projectId: number,
  hours = 24 * 7,
): Promise<Item[]> {
  const d = await db();
  return d.select<Item[]>(
    `SELECT * FROM items
     WHERE project_id = ?
       AND deleted_at IS NOT NULL
       AND deleted_at > datetime('now', '-' || ? || ' hours')
     ORDER BY deleted_at DESC`,
    [projectId, hours],
  );
}

async function getMaxPosition(projectId: number): Promise<number> {
  const d = await db();
  const rows = await d.select<{ max_pos: number | null }[]>(
    "SELECT MAX(position) AS max_pos FROM items WHERE project_id = ?",
    [projectId],
  );
  return rows[0]?.max_pos ?? 0;
}

export async function insertItem(
  projectId: number,
  captureId: number | null,
  item: {
    title: string;
    body?: string | null;
    category: Item["category"];
    priority: Item["priority"];
    topic?: string | null;
    tags: string[];
  },
): Promise<number> {
  const d = await db();
  const maxPos = await getMaxPosition(projectId);
  const position = maxPos + 1;
  const res = await d.execute(
    "INSERT INTO items (project_id, capture_id, title, body, category, priority, topic, tags, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      projectId,
      captureId,
      item.title,
      item.body ?? null,
      item.category,
      item.priority,
      item.topic ?? null,
      item.tags.join(","),
      position,
    ],
  );
  return res.lastInsertId as number;
}

export async function setItemPosition(id: number, position: number) {
  const d = await db();
  await d.execute(
    "UPDATE items SET position = ?, updated_at = datetime('now') WHERE id = ?",
    [position, id],
  );
}

export async function linkItems(fromId: number, toId: number, relation = "related") {
  const d = await db();
  await d.execute(
    "INSERT OR IGNORE INTO item_links (from_item_id, to_item_id, relation) VALUES (?, ?, ?)",
    [fromId, toId, relation],
  );
}

export async function updateItemStatus(id: number, status: Item["status"]) {
  const d = await db();
  await d.execute(
    "UPDATE items SET status = ?, updated_at = datetime('now')  WHERE id = ?",
    [status, id],
  );
}

const UPDATABLE_FIELDS = [
  "title",
  "body",
  "priority",
  "topic",
  "category",
  "tags",
] as const;
type UpdatableField = (typeof UPDATABLE_FIELDS)[number];

export async function updateItemField(
  id: number,
  field: UpdatableField,
  value: string | null,
) {
  if (!UPDATABLE_FIELDS.includes(field)) {
    throw new Error(`refusing to update unknown field: ${field}`);
  }
  const d = await db();
  await d.execute(
    `UPDATE items SET ${field} = ?, updated_at = datetime('now') WHERE id = ?`,
    [value, id],
  );
}

export async function deleteItem(id: number) {
  const d = await db();
  await d.execute(
    "UPDATE items SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    [id],
  );
}

export async function restoreItem(id: number) {
  const d = await db();
  await d.execute(
    "UPDATE items SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ?",
    [id],
  );
}

export async function permanentlyDeleteItem(id: number) {
  const d = await db();
  await d.execute("DELETE FROM items WHERE id = ?", [id]);
}
