use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use std::path::PathBuf;

#[tauri::command]
pub async fn save_png_to_desktop(
    filename: String,
    base64_png: String,
) -> Result<String, String> {
    let desktop = dirs::desktop_dir().ok_or_else(|| {
        "couldn't resolve the Desktop folder — saving isn't available".to_string()
    })?;

    let bytes = B64
        .decode(base64_png.as_bytes())
        .map_err(|e| format!("invalid image payload: {e}"))?;

    let safe_name = sanitize_filename(&filename);
    let final_path = unique_path(desktop.join(&safe_name));

    tokio::fs::write(&final_path, &bytes)
        .await
        .map_err(|e| format!("failed to write {}: {e}", final_path.display()))?;

    Ok(final_path.display().to_string())
}

fn sanitize_filename(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return "braindump-screenshot.png".to_string();
    }
    // Strip path separators and NUL to avoid escaping the Desktop.
    let cleaned: String = trimmed
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | '\0') { '_' } else { c })
        .collect();
    if cleaned.to_lowercase().ends_with(".png") {
        cleaned
    } else {
        format!("{cleaned}.png")
    }
}

/// If `path` exists, append " (1)", " (2)", … to the stem until free.
fn unique_path(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }
    let parent = path.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "braindump-screenshot".into());
    let ext = path
        .extension()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "png".into());

    for n in 1..=999 {
        let candidate = parent.join(format!("{stem} ({n}).{ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    // Fall back to a timestamped name rather than overwriting.
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    parent.join(format!("{stem}-{ts}.{ext}"))
}
