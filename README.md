# 寒霜破甲工具（免费版）

独立项目，不再依赖外面的任何文件夹。界面基于 PI-Desktop 的设计系统
（`src/styles/` 下的 tokens / ui-kit / settings 等样式表原样移植），
功能由 `electron/main.cjs` 调用同级目录的 PowerShell 脚本完成。

## 这个版本是什么

八个破甲目标（Codex / ZCode / Cursor / Claude / WorkBuddy 国际版 /
WorkBuddy 国内版 / DeepSeek Harness / 豆包），每个目标提供各自的全版本列表。

WorkBuddy 国际版与国内版是同一个程序的两套发行，数据目录不同
（`~/.workbuddy-ai` 与 `~/.workbuddy`），可并存，因此拆成两个独立目标、
各自安装与卸载。豆包的全局记忆不在本地磁盘，注入经 CDP 走客户端自身的
登录会话写云端接口，脚本会自动把豆包重启到调试模式。

版本标记已经固定在 `variant.json`（`"variant": "free"`），不需要传参。

各目标的注入位置：

| 目标 | 脚本 | 注入位置 |
|---|---|---|
| Codex | `install.ps1` | `~/.codex/config.toml` → model_instructions_file |
| ZCode | `install-zcode.ps1` | `AGENTS.md` + 全局记忆 + 系统提示词 |
| Cursor | `install-cursor.ps1` | Cursor 全局规则（User Rules） |
| Claude | `install-claude.ps1` | `~/.claude/CLAUDE.md` + skills |
| WorkBuddy 国际版 | `install-workbuddy.ps1` | 云记忆 memoryBlock + MEMORY.md + 技能库（`~/.workbuddy-ai`） |
| WorkBuddy 国内版 | `install-workbuddy.ps1` | 同上，数据目录 `~/.workbuddy` |
| DeepSeek Harness | `install-dsh.ps1` | `~/.dsh/AGENTS.md`（DSH 全局记忆）+ `~/.dsh/skills` |
| 豆包 | `install-doubao.ps1` | 云端全局记忆（CDP 走客户端登录会话写入） |

DeepSeek Harness 用 Claude Code 版提示词（`寒霜v4-claude.md` / `寒霜v3.md`），
因为 DSH 的 `AGENTS.md` 与 Claude Code 的 `CLAUDE.md` 是同一套 Markdown 记忆规范。
备份落在 `~/.dsh/managed-prompts/`，卸载即还原（含原 `AGENTS.md` 全文）。

## 开发

```bash
npm install
npm run dev            # 起 Vite 开发服务器
npm run build          # 只构建渲染层到 dist/
npx electron .         # 跑起来（默认加载 dist/）
HS_DEV=1 npx electron .  # 连开发服务器
```

macOS 下主进程使用原生 Node.js 文件安装器，不依赖 PowerShell。支持 Codex、
Claude、Cursor、ZCode、DeepSeek Harness 和 WorkBuddy；豆包的 macOS 云端
CDP 注入暂未接入。

截图验收（开发用）：`HS_CAPTURE=<输出目录> npx electron .` 会逐页截图后自动退出。

## 打包

```bash
npm run dist
```

macOS 构建：

```bash
npm run dist:mac
```

该命令生成 macOS `dmg` 和 `zip`，目标架构为 Intel `x64` 与 Apple Silicon `arm64`。

产物落在本文件夹的 `release/`：

- `寒霜破甲工具-安装版-<版本>.exe` —— NSIS 安装版
- `寒霜破甲工具-免安装版-<版本>.exe` —— electron-builder 的 portable 目标，每次启动要自解压到临时目录，开窗慢
- `寒霜破甲工具-便携版-<版本>.zip` —— 由 `win-unpacked` 直接打包，解压即用，启动约 2 秒（发布用这个）

便携版没有安装器，删文件夹不等于卸载干净：`portable-uninstall.ps1` + 同目录
`卸载-便携版.bat` 会一并清掉 `%APPDATA%\hanshuang-free`、状态文件和快捷方式。

打包流程里有两处自定义：

- `scripts/make-icon.py` → 从 `build/icon.png` 生成 512/256 图标
- `scripts/make-ico.py` → 生成多尺寸 `.ico`
- `scripts/after-pack.js` → electron-builder 打完应用目录后，用 rcedit 把图标和版本信息写进 exe

最后一步是必需的：electron-builder 自带的 `signAndEditExecutable` 在 Windows 上要先解压
winCodeSign 压缩包，包里含 macOS 符号链接，普通权限创建不了会直接中断构建，所以关掉它、
改由 afterPack 钩子自己调 rcedit。

## 换图标

替换 `build/icon.png`（512×512 方形 PNG）后重新 `npm run dist` 即可。

## 目录

```
electron/     主进程、preload、PowerShell 调度、压缩守护、WorkBuddy 记忆守护
src/          渲染层（React）
  data/       目标与版本文案
  pages/      破甲详情页 / Skills 管理 / 使用教程 / 个人中心
  styles/     PI-Desktop 的样式表 + app.css
  assets/     界面用的字标图
scripts/      构建与图标脚本
build/        图标源文件（png / ico）
install*.ps1  安装脚本（打包时随 extraResources 进包）
codex-skills* 技能库（打包时进包）
assets/       赞赏与交流群二维码（README 用）
```

## License

MIT — 见 [LICENSE](LICENSE)

## 交流群

| ai交流分析群 | ai交流分析群2群 |
|:---:|:---:|
| <img src="assets/qq-group-1.png" width="260" /> | <img src="assets/qq-group-2.png" width="260" /> |
| 群号：1098743629 | 群号：819678765 |

## 友链

- [LinuxDo](https://linux.do) — 真诚、友善、团结的中文技术社区

## 赞赏

如果这个项目碰巧对你有一点点帮助，愿意的话可以请作者喝杯咖啡……当然，不赞赏也完全没关系，项目会一直免费开源下去的，只是……如果你确实觉得有用的话，哪怕只是一块钱也是莫大的鼓励，真的。

| 微信赞赏 | 支付宝收款 |
|:---:|:---:|
| <img src="assets/sponsor-wechat.jpg" width="260" /> | <img src="assets/sponsor-alipay.jpg" width="260" /> |

## 致歉

作者平时上班太忙，无力长期维护开源项目，更新只能随缘，望见谅。感谢每一位用过、提过意见、伸出过援手的朋友。

-------------

打扰了，谢谢看到这里。
