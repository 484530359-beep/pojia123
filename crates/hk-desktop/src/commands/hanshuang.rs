use super::AppState;
use hk_core::HkError;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const PROMPT_NAME: &str = "寒霜v4.md";
const CODEX_BEGIN: &str = "<!-- 寒霜破甲注入开始";
const CODEX_END: &str = "<!-- 寒霜破甲注入结束 -->";

#[derive(Debug, Serialize)]
pub struct HanshuangInstallResult {
    pub prompt_path: String,
    pub config_path: String,
    pub agents_path: String,
    pub skills_path: String,
    pub installed_skills: usize,
}

#[tauri::command]
pub async fn install_hanshuang(app: AppHandle) -> Result<HanshuangInstallResult, HkError> {
    tauri::async_runtime::spawn_blocking(move || install_hanshuang_sync(&app))
        .await
        .map_err(|e| HkError::Internal(e.to_string()))?
}

fn install_hanshuang_sync(app: &AppHandle) -> Result<HanshuangInstallResult, HkError> {
    let assets = hanshuang_assets_dir(app)?;
    let prompt_source = assets.join("prompt").join(PROMPT_NAME);
    let skills_source = assets.join("skills");
    if !prompt_source.is_file() {
        return Err(HkError::NotFound(format!(
            "寒霜提示词资源不存在：{}",
            prompt_source.display()
        )));
    }
    if !skills_source.is_dir() {
        return Err(HkError::NotFound(format!(
            "寒霜 Skills 资源不存在：{}",
            skills_source.display()
        )));
    }

    let home =
        dirs::home_dir().ok_or_else(|| HkError::Internal("无法确定当前用户主目录".into()))?;
    let codex_home = home.join(".codex");
    let managed_dir = codex_home.join("managed-prompts");
    let prompt_target = managed_dir.join(PROMPT_NAME);
    let config_path = codex_home.join("config.toml");
    let agents_path = codex_home.join("AGENTS.md");
    let skills_target = codex_home.join("skills");
    let state_path = managed_dir.join("install-state.json");

    fs::create_dir_all(&managed_dir)?;
    atomic_write(&prompt_target, &fs::read_to_string(&prompt_source)?)?;

    let config_before = read_text(&config_path)?;
    let config_line = format!(
        "model_instructions_file = \"{}\"",
        prompt_target
            .to_string_lossy()
            .replace('\\', "/")
            .replace('"', "\\\"")
    );
    let config_after = replace_config_line(&config_before, &config_line);
    atomic_write(&config_path, &format!("{}\n", config_after.trim_end()))?;

    let prompt = fs::read_to_string(&prompt_target)?;
    let begin = format!("{} · {} -->", CODEX_BEGIN, PROMPT_NAME);
    let block = format!("{}\n{}\n{}", begin, prompt.trim_end(), CODEX_END);
    replace_or_append_block(&agents_path, &block)?;

    let previous = read_json(&state_path);
    let previous_skills = previous
        .get("installedSkills")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str().map(ToOwned::to_owned))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let installed_skills = sync_skills(&skills_source, &skills_target, &previous_skills)?;

    let state = serde_json::json!({
        "installedAt": chrono::Utc::now().to_rfc3339(),
        "configPath": config_path,
        "targetPrompt": prompt_target,
        "promptHistory": [prompt_target],
        "installedSkills": installed_skills,
    });
    atomic_write(&state_path, &(serde_json::to_string_pretty(&state)? + "\n"))?;

    Ok(HanshuangInstallResult {
        prompt_path: prompt_target.to_string_lossy().into_owned(),
        config_path: config_path.to_string_lossy().into_owned(),
        agents_path: agents_path.to_string_lossy().into_owned(),
        skills_path: skills_target.to_string_lossy().into_owned(),
        installed_skills: installed_skills.len(),
    })
}

fn hanshuang_assets_dir(app: &AppHandle) -> Result<PathBuf, HkError> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let packaged = resource_dir.join("hanshuang");
        if packaged.is_dir() {
            return Ok(packaged);
        }
    }

    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../resources/hanshuang")
        .components()
        .collect::<PathBuf>();
    if development.is_dir() {
        Ok(development)
    } else {
        Err(HkError::NotFound("未找到 HarnessKit 内置寒霜资源".into()))
    }
}

fn read_text(path: &Path) -> Result<String, HkError> {
    if path.is_file() {
        Ok(fs::read_to_string(path)?)
    } else {
        Ok(String::new())
    }
}

fn read_json(path: &Path) -> serde_json::Value {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

fn atomic_write(path: &Path, contents: &str) -> Result<(), HkError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    fs::write(&tmp, contents)?;
    if let Err(error) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(path);
        fs::rename(&tmp, path).map_err(|_| error)?;
    }
    Ok(())
}

fn replace_config_line(before: &str, new_line: &str) -> String {
    let mut replaced = false;
    let mut lines = Vec::new();
    for line in before.lines() {
        if line.trim_start().starts_with("model_instructions_file") {
            if !replaced {
                lines.push(new_line.to_string());
                replaced = true;
            }
        } else {
            lines.push(line.to_string());
        }
    }
    if !replaced {
        lines.insert(0, new_line.to_string());
    }
    lines.join("\n")
}

fn replace_or_append_block(path: &Path, block: &str) -> Result<(), HkError> {
    let existing = read_text(path)?;
    let next = if let Some(start) = existing.find(CODEX_BEGIN) {
        if let Some(end_offset) = existing[start..].find(CODEX_END) {
            let end = start + end_offset + CODEX_END.len();
            format!("{}{}{}", &existing[..start], block, &existing[end..])
        } else {
            format!("{}\n\n{}\n", existing.trim_end(), block)
        }
    } else if existing.trim().is_empty() {
        format!("{}\n", block)
    } else {
        let backup = path.with_extension(format!(
            "md.backup-{}",
            chrono::Utc::now().timestamp_millis()
        ));
        fs::copy(path, backup)?;
        format!("{}\n\n{}\n", existing.trim_end(), block)
    };
    atomic_write(path, &next)
}

fn sync_skills(source: &Path, target: &Path, previous: &[String]) -> Result<Vec<String>, HkError> {
    let mut current = Vec::new();
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.path().join("SKILL.md").is_file() {
            current.push(name);
        }
    }
    current.sort();
    fs::create_dir_all(target)?;

    for old in previous {
        if !current.iter().any(|name| name == old) {
            let _ = fs::remove_dir_all(target.join(old));
        }
    }
    for name in &current {
        copy_tree(&source.join(name), &target.join(name))?;
    }
    Ok(current)
}

fn copy_tree(source: &Path, target: &Path) -> Result<(), HkError> {
    if source.is_dir() {
        fs::create_dir_all(target)?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            copy_tree(&entry.path(), &target.join(entry.file_name()))?;
        }
    } else {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(source, target)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{CODEX_BEGIN, replace_config_line};

    #[test]
    fn config_line_is_replaced_without_touching_other_settings() {
        let result = replace_config_line(
            "foo = true\nmodel_instructions_file = \"old\"\n",
            "model_instructions_file = \"new\"",
        );
        assert_eq!(result, "foo = true\nmodel_instructions_file = \"new\"");
    }

    #[test]
    fn codex_marker_matches_installer_prefix() {
        assert!(CODEX_BEGIN.starts_with("<!-- 寒霜破甲注入开始"));
    }
}
