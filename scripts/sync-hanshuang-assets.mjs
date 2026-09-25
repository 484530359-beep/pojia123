import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siblingRoot = path.resolve(repoRoot, "..", "hanshuang-codex");
const sourceRoot = process.env.HANSHUANG_SOURCE
  ? path.resolve(process.env.HANSHUANG_SOURCE)
  : siblingRoot;
const promptSource = path.join(sourceRoot, "寒霜v4.md");
const skillsSource = path.join(sourceRoot, "codex-skills-v4");
const targetRoot = path.join(repoRoot, "resources", "hanshuang");

function copyTree(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      copyTree(path.join(source, entry.name), path.join(target, entry.name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

if (!fs.existsSync(promptSource) || !fs.existsSync(skillsSource)) {
  throw new Error(
    `寒霜资源不存在：${promptSource} 或 ${skillsSource}。可设置 HANSHUANG_SOURCE 指向 hanshuang-codex。`,
  );
}

fs.rmSync(targetRoot, { recursive: true, force: true });
copyTree(promptSource, path.join(targetRoot, "prompt", "寒霜v4.md"));
copyTree(skillsSource, path.join(targetRoot, "skills"));
console.log(`Synced Hanshuang prompt and skills from ${sourceRoot}`);
