use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::agent::{claude_version, locate_claude, LOCAL_MODEL, OLLAMA_BASE_URL};

const OLLAMA_MACOS_URL: &str = "https://ollama.com/download/Ollama-darwin.zip";

// Pin a known-good SHA256 to detect upstream changes. Leave empty to skip the
// check (useful during development — production should populate this).
const OLLAMA_MACOS_SHA256: &str = "";

const PROGRESS_EVENT: &str = "setup-progress";

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "stage", rename_all = "kebab-case")]
enum ProgressPayload {
    DownloadOllama { bytes_done: u64, bytes_total: u64 },
    ExtractOllama { message: String },
    LaunchOllama { message: String },
    PullModel {
        bytes_done: u64,
        bytes_total: u64,
        message: String,
    },
    Verify { message: String },
}

fn emit(app: &AppHandle, payload: ProgressPayload) {
    let _ = app.emit(PROGRESS_EVENT, payload);
}

#[derive(Debug, Serialize)]
pub struct ClaudeStatus {
    pub installed: bool,
    pub version: Option<String>,
}

#[tauri::command]
pub async fn check_claude() -> ClaudeStatus {
    match locate_claude().await {
        Some(path) => ClaudeStatus {
            installed: true,
            version: claude_version(&path).await,
        },
        None => ClaudeStatus {
            installed: false,
            version: None,
        },
    }
}

#[derive(Debug, Serialize)]
pub struct OllamaStatus {
    pub binary_present: bool,
    pub service_running: bool,
    pub models: Vec<String>,
    pub has_required_model: bool,
    pub required_model: String,
}

#[tauri::command]
pub async fn check_ollama() -> OllamaStatus {
    let binary_present = locate_ollama_app().is_some();

    let models = fetch_ollama_models().await.unwrap_or_default();
    let service_running = !models.is_empty() || ping_ollama().await;
    let has_required_model = models.iter().any(|m| m == LOCAL_MODEL);

    OllamaStatus {
        binary_present,
        service_running,
        models,
        has_required_model,
        required_model: LOCAL_MODEL.to_string(),
    }
}

fn locate_ollama_app() -> Option<PathBuf> {
    let candidates: Vec<PathBuf> = {
        let mut v = Vec::new();
        if let Some(home) = dirs::home_dir() {
            v.push(home.join("Applications").join("Ollama.app"));
        }
        v.push(PathBuf::from("/Applications/Ollama.app"));
        v
    };
    candidates.into_iter().find(|p| p.exists())
}

async fn ping_ollama() -> bool {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    client
        .get(format!("{OLLAMA_BASE_URL}/api/tags"))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

async fn fetch_ollama_models() -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(format!("{OLLAMA_BASE_URL}/api/tags"))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("tags endpoint returned {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let names = body
        .get("models")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("name").and_then(|n| n.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default();
    Ok(names)
}

#[tauri::command]
pub async fn install_ollama(app: AppHandle) -> Result<(), String> {
    let home = dirs::home_dir().ok_or_else(|| "no home directory".to_string())?;
    let apps_dir = home.join("Applications");
    tokio::fs::create_dir_all(&apps_dir)
        .await
        .map_err(|e| format!("failed to create ~/Applications: {e}"))?;

    let install_dir = apps_dir.join("Ollama.app");

    // Download to a tempfile next to the install dir.
    let tmp_path = apps_dir.join(".ollama-download.zip");
    if tmp_path.exists() {
        let _ = tokio::fs::remove_file(&tmp_path).await;
    }

    download_with_progress(&app, OLLAMA_MACOS_URL, &tmp_path).await?;

    if !OLLAMA_MACOS_SHA256.is_empty() {
        emit(
            &app,
            ProgressPayload::ExtractOllama {
                message: "verifying signature".to_string(),
            },
        );
        verify_sha256(&tmp_path, OLLAMA_MACOS_SHA256).await?;
    }

    emit(
        &app,
        ProgressPayload::ExtractOllama {
            message: "extracting".to_string(),
        },
    );

    if install_dir.exists() {
        tokio::fs::remove_dir_all(&install_dir)
            .await
            .map_err(|e| format!("failed to remove existing Ollama.app: {e}"))?;
    }

    let tmp_clone = tmp_path.clone();
    let dest_clone = apps_dir.clone();
    tokio::task::spawn_blocking(move || extract_zip(&tmp_clone, &dest_clone))
        .await
        .map_err(|e| format!("extract task panicked: {e}"))??;

    let _ = tokio::fs::remove_file(&tmp_path).await;

    if !install_dir.exists() {
        return Err(format!(
            "extraction finished but {} is missing",
            install_dir.display()
        ));
    }

    emit(
        &app,
        ProgressPayload::ExtractOllama {
            message: "installed".to_string(),
        },
    );
    Ok(())
}

async fn download_with_progress(
    app: &AppHandle,
    url: &str,
    dest: &Path,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("download request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("download returned {}", resp.status()));
    }

    let total = resp.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| format!("create file: {e}"))?;

    let mut done: u64 = 0;
    let mut stream = resp.bytes_stream();
    let mut last_emit: u64 = 0;

    emit(
        app,
        ProgressPayload::DownloadOllama {
            bytes_done: 0,
            bytes_total: total,
        },
    );

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("download chunk failed: {e}"))?;
        file.write_all(&bytes)
            .await
            .map_err(|e| format!("write chunk: {e}"))?;
        done = done.saturating_add(bytes.len() as u64);

        // Throttle emits — every ~512 KB.
        if done - last_emit > 512 * 1024 {
            last_emit = done;
            emit(
                app,
                ProgressPayload::DownloadOllama {
                    bytes_done: done,
                    bytes_total: total,
                },
            );
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("flush file: {e}"))?;
    drop(file);

    emit(
        app,
        ProgressPayload::DownloadOllama {
            bytes_done: done,
            bytes_total: if total == 0 { done } else { total },
        },
    );

    Ok(())
}

async fn verify_sha256(path: &Path, expected_hex: &str) -> Result<(), String> {
    let path = path.to_path_buf();
    let expected = expected_hex.to_lowercase();
    tokio::task::spawn_blocking(move || {
        let mut file = std::fs::File::open(&path).map_err(|e| format!("open for hash: {e}"))?;
        let mut hasher = Sha256::new();
        std::io::copy(&mut file, &mut hasher).map_err(|e| format!("hash read: {e}"))?;
        let got = hex::encode(hasher.finalize());
        if got != expected {
            return Err(format!(
                "SHA256 mismatch: expected {expected}, got {got}"
            ));
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("hash task: {e}"))?
}

fn extract_zip(src: &Path, dest_dir: &Path) -> Result<(), String> {
    let file = std::fs::File::open(src).map_err(|e| format!("open zip: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("read zip: {e}"))?;
    archive
        .extract(dest_dir)
        .map_err(|e| format!("extract zip: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn launch_ollama(app: AppHandle) -> Result<(), String> {
    if ping_ollama().await {
        return Ok(());
    }

    emit(
        &app,
        ProgressPayload::LaunchOllama {
            message: "starting service".to_string(),
        },
    );

    let app_path = locate_ollama_app()
        .ok_or_else(|| "Ollama.app not found — install it first".to_string())?;

    let status = Command::new("open")
        .arg(app_path)
        .status()
        .await
        .map_err(|e| format!("open command failed: {e}"))?;

    if !status.success() {
        return Err(format!("`open` exited with {status}"));
    }

    // Poll until the HTTP service responds. Ollama's menu-bar app usually takes
    // a second or two to boot the server.
    let deadline = std::time::Instant::now() + Duration::from_secs(30);
    while std::time::Instant::now() < deadline {
        if ping_ollama().await {
            emit(
                &app,
                ProgressPayload::LaunchOllama {
                    message: "service ready".to_string(),
                },
            );
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    Err("Ollama didn't respond on localhost:11434 within 30s".to_string())
}

#[tauri::command]
pub async fn pull_ollama_model(app: AppHandle, model: String) -> Result<(), String> {
    // No .timeout() — the total duration is many minutes and reqwest treats a
    // zero-duration timeout as an immediate failure, not as "disabled".
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    emit(
        &app,
        ProgressPayload::PullModel {
            bytes_done: 0,
            bytes_total: 0,
            message: "connecting to ollama".to_string(),
        },
    );

    let body = serde_json::json!({ "name": model, "stream": true });

    let resp = client
        .post(format!("{OLLAMA_BASE_URL}/api/pull"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("pull request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("ollama /api/pull returned {status}: {text}"));
    }

    // Ollama streams newline-delimited JSON. Accumulate bytes into a buffer and
    // split on newlines so we can decode each status object as it arrives.
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::with_capacity(4096);

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("read pull stream: {e}"))?;
        buf.extend_from_slice(&bytes);

        while let Some(pos) = buf.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = buf.drain(..=pos).collect();
            let trimmed = std::str::from_utf8(&line).unwrap_or("").trim();
            if trimmed.is_empty() {
                continue;
            }
            let parsed: serde_json::Value = match serde_json::from_str(trimmed) {
                Ok(v) => v,
                Err(_) => continue,
            };

            if let Some(err) = parsed.get("error").and_then(|v| v.as_str()) {
                return Err(format!("ollama pull error: {err}"));
            }

            let status = parsed
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("working")
                .to_string();
            let bytes_done = parsed.get("completed").and_then(|v| v.as_u64()).unwrap_or(0);
            let bytes_total = parsed.get("total").and_then(|v| v.as_u64()).unwrap_or(0);

            emit(
                &app,
                ProgressPayload::PullModel {
                    bytes_done,
                    bytes_total,
                    message: status,
                },
            );
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn verify_ollama_setup(app: AppHandle, model: String) -> Result<(), String> {
    emit(
        &app,
        ProgressPayload::Verify {
            message: "running test capture".to_string(),
        },
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    let body = serde_json::json!({
        "model": model,
        "stream": false,
        "messages": [
            { "role": "user", "content": "Reply with the single word: ok" }
        ],
        "options": { "temperature": 0 },
    });

    let resp = client
        .post(format!("{OLLAMA_BASE_URL}/api/chat"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("verify request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("ollama returned {status}: {text}"));
    }

    emit(
        &app,
        ProgressPayload::Verify {
            message: "ready".to_string(),
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn system_ram_gb() -> u64 {
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = Command::new("sysctl")
            .args(["-n", "hw.memsize"])
            .output()
            .await
        {
            if out.status.success() {
                if let Ok(s) = String::from_utf8(out.stdout) {
                    if let Ok(bytes) = s.trim().parse::<u64>() {
                        // Round to the nearest GiB — Mac RAM tiers are discrete
                        // (8/16/24/32/48/64/96/128) so rounding reports the
                        // configured size rather than 31 for a 32 GB machine.
                        return ((bytes as f64) / 1024.0 / 1024.0 / 1024.0).round() as u64;
                    }
                }
            }
        }
        0
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(contents) = tokio::fs::read_to_string("/proc/meminfo").await {
            for line in contents.lines() {
                if let Some(rest) = line.strip_prefix("MemTotal:") {
                    let kb: u64 = rest
                        .trim()
                        .split_whitespace()
                        .next()
                        .unwrap_or("0")
                        .parse()
                        .unwrap_or(0);
                    return ((kb as f64) / 1024.0 / 1024.0).round() as u64;
                }
            }
        }
        0
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        0
    }
}

#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&url)
            .status()
            .await
            .map_err(|e| format!("open failed: {e}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("open_external_url not implemented on this platform yet".to_string())
    }
}
