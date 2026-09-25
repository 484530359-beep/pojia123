"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CODEX_BEGIN = "<!-- 寒霜破甲注入开始";
const CODEX_END = "<!-- 寒霜破甲注入结束 -->";
const CLAUDE_BEGIN = "<!-- HANSHUANG-INJECT:BEGIN";
const CLAUDE_END = "<!-- HANSHUANG-INJECT:END -->";
const GENERIC_BEGIN = "<!-- HANSHUANG-INJECT:BEGIN -->";
const GENERIC_END = "<!-- HANSHUANG-INJECT:END -->";

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  writeText(file, JSON.stringify(value, null, 2) + "\n");
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function removeFile(file) {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* ignore */
  }
}

function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function copyTree(source, target) {
  const st = fs.statSync(source);
  if (st.isDirectory()) {
    ensureDir(target);
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      copyTree(path.join(source, entry.name), path.join(target, entry.name));
    }
    return;
  }
  ensureDir(path.dirname(target));
  fs.copyFileSync(source, target);
}

function skillNames(source) {
  if (!source || !fs.existsSync(source)) return [];
  return fs.readdirSync(source, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(source, entry.name, "SKILL.md")))
    .map((entry) => entry.name);
}

function syncSkills(source, target, previous = []) {
  const current = skillNames(source);
  ensureDir(target);
  for (const name of previous) {
    if (!current.includes(name)) removeDir(path.join(target, name));
  }
  for (const name of current) {
    copyTree(path.join(source, name), path.join(target, name));
  }
  return current;
}

function removeManagedSkills(target, names) {
  for (const name of Array.isArray(names) ? names : []) {
    if (!name || name === "." || name === ".." || name === "skills") continue;
    removeDir(path.join(target, name));
  }
}

function findBlock(text, beginPattern, endPattern) {
  const begin = text.indexOf(beginPattern);
  if (begin < 0) return null;
  const end = text.indexOf(endPattern, begin + beginPattern.length);
  if (end < 0) return null;
  return { start: begin, end: end + endPattern.length };
}

function replaceOrAppendBlock(file, body, begin, end, heading) {
  const existing = readText(file);
  const beginLine = begin.endsWith("-->")
    ? begin
    : `${begin}${heading ? ` ${heading}` : ""} -->`;
  const block = `${beginLine}\n${body.trimEnd()}\n${end}`;
  const found = findBlock(existing, begin, end);
  if (found) {
    writeText(file, existing.slice(0, found.start) + block + existing.slice(found.end));
  } else if (!existing.trim()) {
    writeText(file, `${block}\n`);
  } else {
    const backup = `${file}.backup-${stamp()}`;
    fs.copyFileSync(file, backup);
    writeText(file, `${existing.trimEnd()}\n\n${block}\n`);
  }
}

function removeBlock(file, begin, end) {
  if (!fs.existsSync(file)) return;
  const existing = readText(file);
  const found = findBlock(existing, begin, end);
  if (!found) return;
  const left = `${existing.slice(0, found.start)}${existing.slice(found.end)}`.trim();
  if (left) writeText(file, `${left}\n`);
  else removeFile(file);
}

function resolvePrompt(promptPath) {
  if (!promptPath || !fs.existsSync(promptPath)) {
    throw new Error(`提示词文件不存在：${promptPath || "(空)"}`);
  }
  return fs.realpathSync(promptPath);
}

function copyPrompt(promptPath, managedDir, homePath) {
  const target = path.join(managedDir, path.basename(promptPath));
  ensureDir(managedDir);
  const text = readText(promptPath).replaceAll("__CODEX_HOME__", homePath.replaceAll("\\", "/"));
  writeText(target, text);
  return target;
}

function installCodex({ promptPath, homeDir, skillsSource, injectAgents, noSkills, codexHome: requestedCodexHome }) {
  const codexHome = requestedCodexHome || process.env.CODEX_HOME || path.join(homeDir, ".codex");
  const managedDir = path.join(codexHome, "managed-prompts");
  const statePath = path.join(managedDir, "install-state.json");
  const configPath = path.join(codexHome, "config.toml");
  const agentsPath = path.join(codexHome, "AGENTS.md");
  const previous = readJson(statePath, {});
  const targetPrompt = copyPrompt(resolvePrompt(promptPath), managedDir, codexHome);
  const oldPromptHistory = Array.isArray(previous.promptHistory)
    ? previous.promptHistory
    : previous.targetPrompt ? [previous.targetPrompt] : [];

  for (const old of oldPromptHistory) {
    if (old !== targetPrompt) removeFile(old);
  }

  const configBefore = readText(configPath);
  const lineMatch = configBefore.match(/^\s*model_instructions_file\s*=\s*[^\r\n]*/m);
  const configPrompt = targetPrompt.replaceAll("\\", "/").replaceAll('"', '\\"');
  const newLine = `model_instructions_file = "${configPrompt}"`;
  const configAfter = lineMatch
    ? configBefore.replace(/^\s*model_instructions_file\s*=\s*[^\r\n]*/m, newLine)
    : `${newLine}\n${configBefore}`;
  writeText(configPath, configAfter.trimEnd() + "\n");

  if (injectAgents) {
    replaceOrAppendBlock(
      agentsPath,
      readText(targetPrompt),
      CODEX_BEGIN,
      CODEX_END,
      `· ${path.basename(targetPrompt)}`,
    );
  }

  const installedSkills = noSkills
    ? (Array.isArray(previous.installedSkills) ? previous.installedSkills : [])
    : syncSkills(skillsSource, path.join(codexHome, "skills"), previous.installedSkills || []);

  writeJson(statePath, {
    installedAt: new Date().toISOString(),
    configPath,
    targetPrompt,
    promptHistory: [...new Set([...oldPromptHistory, targetPrompt])],
    hadLine: !!lineMatch,
    previousLine: lineMatch ? lineMatch[0].trimEnd() : null,
    installedSkills,
  });

  return [
    `macOS Codex 安装完成：${targetPrompt}`,
    `配置文件：${configPath}`,
    injectAgents ? `AGENTS.md：${agentsPath}` : "AGENTS.md：未启用",
    noSkills ? "Skills：按 V5 规则跳过" : `Skills：${installedSkills.length} 个`,
  ].join("\n");
}

function uninstallCodex({ homeDir, codexHome: requestedCodexHome }) {
  const codexHome = requestedCodexHome || process.env.CODEX_HOME || path.join(homeDir, ".codex");
  const managedDir = path.join(codexHome, "managed-prompts");
  const statePath = path.join(managedDir, "install-state.json");
  const state = readJson(statePath, {});
  const configPath = state.configPath || path.join(codexHome, "config.toml");
  const current = readText(configPath);
  if (current) {
    const pattern = /^\s*model_instructions_file\s*=\s*[^\r\n]*(?:\r?\n|$)/m;
    const previousLine = typeof state.previousLine === "string" ? state.previousLine : "";
    const restored = state.hadLine && previousLine
      ? current.replace(pattern, `${previousLine}\n`)
      : current.replace(pattern, "");
    writeText(configPath, restored.trimEnd() + "\n");
  }
  const prompts = Array.isArray(state.promptHistory)
    ? state.promptHistory
    : state.targetPrompt ? [state.targetPrompt] : [];
  for (const file of prompts) removeFile(file);
  removeBlock(path.join(codexHome, "AGENTS.md"), CODEX_BEGIN, CODEX_END);
  removeManagedSkills(path.join(codexHome, "skills"), state.installedSkills);
  removeFile(statePath);
  return `macOS Codex 已卸载：${codexHome}`;
}

function installClaude({ promptPath, homeDir, skillsSource }) {
  const claudeHome = path.join(homeDir, ".claude");
  const managedDir = path.join(claudeHome, "managed-prompts");
  const statePath = path.join(managedDir, "install-state.json");
  const prompt = resolvePrompt(promptPath);
  const promptText = readText(prompt);
  const claudeMd = path.join(claudeHome, "CLAUDE.md");
  const installedSkills = syncSkills(
    skillsSource,
    path.join(claudeHome, "skills"),
    readJson(statePath, {}).installedSkills || [],
  );
  replaceOrAppendBlock(
    claudeMd,
    promptText,
    CLAUDE_BEGIN,
    CLAUDE_END,
    `prompt=${path.basename(prompt)}`,
  );
  writeJson(statePath, { installedAt: new Date().toISOString(), installedSkills });
  return `macOS Claude 安装完成：${claudeMd}\nSkills：${installedSkills.length} 个`;
}

function uninstallClaude({ homeDir }) {
  const claudeHome = path.join(homeDir, ".claude");
  const managedDir = path.join(claudeHome, "managed-prompts");
  const statePath = path.join(managedDir, "install-state.json");
  const state = readJson(statePath, {});
  removeBlock(path.join(claudeHome, "CLAUDE.md"), CLAUDE_BEGIN, CLAUDE_END);
  removeManagedSkills(path.join(claudeHome, "skills"), state.installedSkills);
  removeFile(statePath);
  return `macOS Claude 已卸载：${claudeHome}`;
}

function cursorRuleDirs({ homeDir }) {
  return [
    path.join(homeDir, ".cursor", "rules"),
    path.join(homeDir, "Library", "Application Support", "Cursor", "User", "rules"),
  ];
}

function installCursor({ promptPath, homeDir }) {
  const prompt = resolvePrompt(promptPath);
  const body = readText(prompt);
  const marker = "<!-- HANSHUANG-INJECT:CURSOR -->";
  const content = [
    "---",
    "description: 寒霜工作规范（自动注入 · 全局生效）",
    'globs: "**/*"',
    "alwaysApply: true",
    "---",
    marker,
    body.trimEnd(),
    "",
  ].join("\n");
  const written = [];
  for (const dir of cursorRuleDirs({ homeDir })) {
    const target = path.join(dir, "寒霜注入.mdc");
    try {
      ensureDir(dir);
      if (fs.existsSync(target) && !readText(target).includes(marker)) {
        fs.copyFileSync(target, `${target}.bak`);
      }
      writeText(target, content);
      written.push(target);
    } catch {
      /* 一个路径失败不影响另一个候选路径 */
    }
  }
  if (!written.length) throw new Error("未找到可写入的 Cursor User Rules 目录");
  return `macOS Cursor 安装完成：${written.join(", ")}`;
}

function uninstallCursor({ homeDir }) {
  const marker = "HANSHUANG-INJECT:CURSOR";
  let removed = 0;
  for (const dir of cursorRuleDirs({ homeDir })) {
    const target = path.join(dir, "寒霜注入.mdc");
    if (!fs.existsSync(target)) continue;
    const backup = `${target}.bak`;
    if (fs.existsSync(backup)) {
      fs.copyFileSync(backup, target);
      removeFile(backup);
    } else if (readText(target).includes(marker)) {
      removeFile(target);
    }
    removed += 1;
  }
  return `macOS Cursor 已卸载：清理 ${removed} 个规则文件`;
}

function installGenericAgent({ targetHome, promptPath, skillsSource, label, kitSource }) {
  const managedDir = path.join(targetHome, "managed-prompts");
  const statePath = path.join(managedDir, "install-state.json");
  const prompt = resolvePrompt(promptPath);
  const agentPath = path.join(targetHome, "AGENTS.md");
  const previous = readJson(statePath, {});
  const installedSkills = syncSkills(
    skillsSource,
    path.join(targetHome, "skills"),
    previous.installedSkills || [],
  );
  const begin = kitSource ? `<!-- HANSHUANG-INJECT:BEGIN pack=${kitSource} -->` : GENERIC_BEGIN;
  replaceOrAppendBlock(agentPath, readText(prompt), begin, GENERIC_END, "");
  writeJson(statePath, { installedAt: new Date().toISOString(), installedSkills });
  return `macOS ${label} 安装完成：${agentPath}\nSkills：${installedSkills.length} 个`;
}

function uninstallGenericAgent({ targetHome, label }) {
  const managedDir = path.join(targetHome, "managed-prompts");
  const statePath = path.join(managedDir, "install-state.json");
  const state = readJson(statePath, {});
  removeBlock(path.join(targetHome, "AGENTS.md"), GENERIC_BEGIN, GENERIC_END);
  removeManagedSkills(path.join(targetHome, "skills"), state.installedSkills);
  removeFile(statePath);
  return `macOS ${label} 已卸载：${targetHome}`;
}

function installWorkBuddy({ promptPath, homeDir, skillsSource, configDir }) {
  const targetHome = configDir || (
    fs.existsSync(path.join(homeDir, ".workbuddy-ai"))
      ? path.join(homeDir, ".workbuddy-ai")
      : path.join(homeDir, ".workbuddy")
  );
  const managedDir = path.join(targetHome, "managed-prompts");
  const statePath = path.join(targetHome, ".hanshuang-state.json");
  const backupPath = path.join(managedDir, "MEMORY.md.bak");
  const memoryPath = path.join(targetHome, "MEMORY.md");
  const previous = readText(memoryPath);
  if (previous && !previous.includes("## Memory Block")) {
    ensureDir(managedDir);
    if (!fs.existsSync(backupPath)) writeText(backupPath, previous);
  }
  const prompt = readText(resolvePrompt(promptPath)).trimEnd();
  writeText(memoryPath, `# User Memory Profile\n\n## Memory Block\n\n${prompt}\n\n---\n`);
  const installedSkills = syncSkills(
    skillsSource,
    path.join(targetHome, "skills"),
    readJson(path.join(managedDir, "install-state.json"), {}).installedSkills || [],
  );
  writeJson(path.join(managedDir, "install-state.json"), { installedSkills });
  writeJson(statePath, {
    version: 999999,
    archive: memoryPath,
    archives: [memoryPath],
    memoryDir: targetHome,
  });
  return `macOS WorkBuddy 安装完成：${memoryPath}\nSkills：${installedSkills.length} 个`;
}

function uninstallWorkBuddy({ homeDir, label, configDir }) {
  const targetHome = configDir || (
    fs.existsSync(path.join(homeDir, ".workbuddy-ai"))
      ? path.join(homeDir, ".workbuddy-ai")
      : path.join(homeDir, ".workbuddy")
  );
  const managedDir = path.join(targetHome, "managed-prompts");
  const state = readJson(path.join(managedDir, "install-state.json"), {});
  const memoryPath = path.join(targetHome, "MEMORY.md");
  const backupPath = path.join(managedDir, "MEMORY.md.bak");
  if (fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, memoryPath);
    removeFile(backupPath);
  } else if (readText(memoryPath).includes("## Memory Block")) {
    removeFile(memoryPath);
  }
  removeManagedSkills(path.join(targetHome, "skills"), state.installedSkills);
  removeFile(path.join(managedDir, "install-state.json"));
  removeFile(path.join(targetHome, ".hanshuang-state.json"));
  return `macOS ${label} 已卸载：${targetHome}`;
}

async function execute(options) {
  const { action, targetId } = options;
  if (targetId === "doubao") {
    throw new Error("macOS 暂未支持豆包云端 CDP 注入");
  }
  if (action === "uninstall") {
    if (targetId === "codex") return uninstallCodex(options);
    if (targetId === "claude") return uninstallClaude(options);
    if (targetId === "cursor") return uninstallCursor(options);
    if (targetId === "workbuddy" || targetId === "workbuddy-cn") {
      return uninstallWorkBuddy({
        ...options,
        label: targetId === "workbuddy-cn" ? "WorkBuddy 国内版" : "WorkBuddy",
      });
    }
    if (targetId === "zcode") {
      return uninstallGenericAgent({ ...options, targetHome: path.join(options.homeDir, ".zcode"), label: "ZCode" });
    }
    if (targetId === "dsh") {
      return uninstallGenericAgent({ ...options, targetHome: path.join(options.homeDir, ".dsh"), label: "DeepSeek Harness" });
    }
  }

  if (targetId === "codex") return installCodex(options);
  if (targetId === "claude") return installClaude(options);
  if (targetId === "cursor") return installCursor(options);
  if (targetId === "workbuddy" || targetId === "workbuddy-cn") return installWorkBuddy(options);
  if (targetId === "zcode") {
    return installGenericAgent({
      ...options,
      targetHome: path.join(options.homeDir, ".zcode"),
      label: "ZCode",
    });
  }
  if (targetId === "dsh") {
    return installGenericAgent({
      ...options,
      targetHome: path.join(options.homeDir, ".dsh"),
      label: "DeepSeek Harness",
    });
  }
  throw new Error(`macOS 暂未支持目标：${targetId}`);
}

module.exports = { execute };
