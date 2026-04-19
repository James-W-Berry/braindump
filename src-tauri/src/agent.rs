use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

pub const LOCAL_MODEL: &str = "qwen2.5:7b";
pub const OLLAMA_BASE_URL: &str = "http://localhost:11434";

#[derive(Debug, Serialize, Deserialize)]
pub struct ExistingItem {
    pub id: i64,
    pub title: String,
    pub category: String,
    #[serde(default)]
    pub topic: Option<String>,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NewItem {
    pub title: String,
    pub body: Option<String>,
    pub category: String,
    pub priority: String,
    #[serde(default)]
    pub topic: Option<String>,
    pub tags: Vec<String>,
    #[serde(default)]
    pub related_item_ids: Vec<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentResult {
    pub items: Vec<NewItem>,
    #[serde(default)]
    pub summary: Option<String>,
}

const SYSTEM_PROMPT: &str = r#"You are an assistant that organizes raw, unstructured braindumps into actionable project items.

You will receive:
1. The project name and description.
2. A list of existing items already tracked in this project (id, title, category, topic, status).
3. A raw braindump: stream-of-consciousness thoughts, ideas, bugs, feedback, questions.

Your job is to produce a JSON object that extracts discrete items from the braindump. Each item must:
- Have a short, clear title (imperative if it's a task/bug, descriptive if it's a note/idea).
- Optionally have a body expanding on the thought with context preserved from the braindump.
- Be categorized as one of: "bug", "idea", "feedback", "task", "question", "note".
- Have a priority: "low", "medium", "high", "urgent" — default to "medium" unless urgency is obvious.
- Have a topic: a short lowercase phrase (1-3 words) clustering this item with others in the same functional area — e.g. "auth", "onboarding ux", "deploy pipeline", "billing", "landing page". Reuse topics already present in existing items when the item fits one. Invent a new topic only when no existing topic fits.
- Include relevant tags (lowercase, short) for secondary facets beyond the topic.
- Reference related_item_ids for any existing items the new item relates to, duplicates, or extends.

Correct typos, expand shorthand, but preserve the user's original intent. Do not invent items that aren't supported by the braindump. Split compound thoughts into separate items. Merge redundant restatements into one.

Output format — respond with ONLY a JSON object, no prose, no markdown fences:

{
  "summary": "one sentence overview of what was captured",
  "items": [
    {
      "title": "...",
      "body": "...",
      "category": "idea",
      "priority": "medium",
      "topic": "onboarding ux",
      "tags": ["..."],
      "related_item_ids": [12]
    }
  ]
}
"#;

fn build_user_prompt(
    project_name: &str,
    project_description: Option<&str>,
    existing: &[ExistingItem],
    raw: &str,
) -> String {
    let existing_json = serde_json::to_string_pretty(existing).unwrap_or_else(|_| "[]".into());
    let description = project_description.unwrap_or("(no description)");
    format!(
        "Project: {project_name}\nDescription: {description}\n\nExisting items:\n{existing_json}\n\n---\nBraindump:\n{raw}\n---\n\nReturn the JSON object now."
    )
}

#[tauri::command]
pub async fn process_capture(
    project_name: String,
    project_description: Option<String>,
    existing_items: Vec<ExistingItem>,
    raw_text: String,
    model: String,
    provider: String,
) -> Result<AgentResult, String> {
    let user_prompt = build_user_prompt(
        &project_name,
        project_description.as_deref(),
        &existing_items,
        &raw_text,
    );

    match provider.as_str() {
        "claude" => run_claude(&model, &user_prompt).await,
        "ollama" => run_ollama(&model, &user_prompt).await,
        other => Err(format!("unknown provider: {other}")),
    }
}

async fn run_claude(model: &str, user_prompt: &str) -> Result<AgentResult, String> {
    let mut child = Command::new("claude")
        .arg("-p")
        .arg("--model")
        .arg(model)
        .arg("--output-format")
        .arg("json")
        .arg("--append-system-prompt")
        .arg(SYSTEM_PROMPT)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn claude CLI: {e}. Is it installed and on PATH?"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(user_prompt.as_bytes())
            .await
            .map_err(|e| format!("failed to write prompt to claude stdin: {e}"))?;
        drop(stdin);
    }

    let output = child
        .wait_with_output()
        .await
        .map_err(|e| format!("failed to wait on claude CLI: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "claude CLI exited with status {}: {}",
            output.status, stderr
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let envelope: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("failed to parse claude output envelope: {e}\nraw: {stdout}"))?;

    let result_text = envelope
        .get("result")
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("claude output missing `result` field: {envelope}"))?;

    let cleaned = strip_code_fences(result_text);
    let parsed: AgentResult = serde_json::from_str(cleaned).map_err(|e| {
        format!("failed to parse agent result JSON: {e}\nresult text: {result_text}")
    })?;

    Ok(parsed)
}

async fn run_ollama(model: &str, user_prompt: &str) -> Result<AgentResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| format!("failed to build http client: {e}"))?;

    let body = serde_json::json!({
        "model": model,
        "stream": false,
        "messages": [
            { "role": "system", "content": SYSTEM_PROMPT },
            { "role": "user", "content": user_prompt },
        ],
        "format": agent_result_schema(),
        "options": { "temperature": 0.2 },
    });

    let url = format!("{OLLAMA_BASE_URL}/api/chat");
    let resp = client.post(&url).json(&body).send().await.map_err(|e| {
        format!(
            "couldn't reach ollama at {OLLAMA_BASE_URL}: {e}. Is it running? Try re-running setup."
        )
    })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("ollama returned {status}: {text}"));
    }

    let envelope: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("failed to parse ollama response: {e}"))?;

    let content = envelope
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .ok_or_else(|| format!("ollama response missing message.content: {envelope}"))?;

    let cleaned = strip_code_fences(content);
    serde_json::from_str(cleaned).map_err(|e| {
        format!("failed to parse agent result JSON from ollama: {e}\ncontent: {content}")
    })
}

fn agent_result_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "summary": { "type": "string" },
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": { "type": "string" },
                        "body": { "type": ["string", "null"] },
                        "category": { "type": "string", "enum": ["bug", "idea", "feedback", "task", "question", "note"] },
                        "priority": { "type": "string", "enum": ["low", "medium", "high", "urgent"] },
                        "topic": { "type": "string", "minLength": 1 },
                        "tags": { "type": "array", "items": { "type": "string" } },
                        "related_item_ids": { "type": "array", "items": { "type": "integer" } }
                    },
                    "required": ["title", "category", "priority", "topic", "tags", "related_item_ids"]
                }
            }
        },
        "required": ["items"]
    })
}

fn strip_code_fences(s: &str) -> &str {
    let trimmed = s.trim();
    let without_lead = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .unwrap_or(trimmed);
    without_lead
        .strip_suffix("```")
        .unwrap_or(without_lead)
        .trim()
}
