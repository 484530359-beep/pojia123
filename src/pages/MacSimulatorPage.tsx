import { useCallback, useEffect, useState } from "react";
import { IconCheck, IconCloudDown, IconFolderOpen, IconRefresh, IconServer, IconTrash } from "../components/icons";
import type { SimulatorState } from "../lib/hs";
import { cx } from "../lib/cx";

const EMPTY_STATE: SimulatorState = {
  home: "/Users/demo",
  playground: "/Users/demo/Documents/Playground",
  localPlayground: "",
  endpoint: "",
  files: [],
  installed: {},
  lastResult: null,
};

const TARGETS = [
  ["codex", "Codex"],
  ["claude", "Claude"],
  ["cursor", "Cursor"],
  ["workbuddy", "WorkBuddy"],
  ["dsh", "DeepSeek Harness"],
] as const;

export function MacSimulatorPage() {
  const [state, setState] = useState<SimulatorState>(EMPTY_STATE);
  const [name, setName] = useState("session/result.json");
  const [content, setContent] = useState('{"platform":"macOS","result":"ok"}');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setState(await window.hs.simulator.state());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (task: () => Promise<SimulatorState>, success: string) => {
    setBusy(true);
    const next = await task();
    setState(next);
    setMessage(next.lastResult?.error || (next.lastResult?.ok ? success : "操作失败"));
    setBusy(false);
  };

  return (
    <>
      <h1 className="settings-section-title">macOS 模拟器</h1>
      <div className="settings-card-block">
        <div className="settings-card-heading-row">
          <div>
            <h2 className="settings-card-heading">macOS 测试桌面</h2>
            <p className="settings-card-description">
              模拟 macOS 界面使用的家目录、Playground 和安装路径。不会修改 Windows 本机的真实配置。
            </p>
          </div>
          <span className="badge badge-neutral">模拟模式</span>
        </div>
        <div className="mac-simulator-window">
          <div className="mac-simulator-titlebar">
            <span className="mac-dot mac-dot-red" />
            <span className="mac-dot mac-dot-yellow" />
            <span className="mac-dot mac-dot-green" />
            <span className="mac-window-title">Finder · Playground</span>
          </div>
          <div className="mac-simulator-toolbar">
            <IconFolderOpen size={18} />
            <code>{state.playground}</code>
          </div>
          <div className="mac-file-list">
            {state.files.length ? state.files.map((file) => (
              <div className="mac-file-row" key={file.name}>
                <IconFolderOpen size={16} />
                <span>{file.name}</span>
                <small>{file.size} B</small>
              </div>
            )) : <div className="settings-card-description">暂无模拟运行结果文件</div>}
          </div>
        </div>
      </div>

      <div className="settings-card-block">
        <h2 className="settings-card-heading">生成运行结果</h2>
        <p className="settings-card-description">
          文件会写入模拟路径，并可通过真实服务器上传接口验证。
        </p>
        <div className="settings-form-grid">
          <label className="settings-form-label">
            <span>文件名</span>
            <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="settings-form-label">
            <span>内容</span>
            <textarea className="field-input mac-simulator-textarea" value={content} onChange={(e) => setContent(e.target.value)} />
          </label>
        </div>
        <div className="app-inline-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(
            () => window.hs.simulator.createResult({ name, content }),
            "模拟运行结果已创建",
          )}>
            <IconFolderOpen size={16} /> 创建运行结果
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void run(
            () => window.hs.simulator.upload(),
            "模拟文件已上传到服务器",
          )}>
            <IconCloudDown size={16} /> 立即验证上传
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void refresh()}>
            <IconRefresh size={16} /> 刷新
          </button>
        </div>
        <p className="settings-card-description">
          接收地址：<code>{state.endpoint || "未配置"}</code>
        </p>
        {message && <div className={cx("settings-card-description", state.lastResult?.error && "badge-error")}>{message}</div>}
      </div>

      <div className="settings-card-block">
        <h2 className="settings-card-heading">模拟 macOS 安装逻辑</h2>
        <p className="settings-card-description">
          安装结果只写入模拟家目录：<code>{state.home}</code>
        </p>
        <div className="settings-panel">
          {TARGETS.map(([id, label]) => (
            <div className="settings-row" key={id}>
              <span className="settings-row-copy">
                <div className="settings-row-title">{label}</div>
                <div className="settings-row-desc">{state.installed[id] ? "已在模拟家目录安装" : "未安装"}</div>
              </span>
              <span className="settings-row-control">
                {state.installed[id] && <IconCheck size={16} />}
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void run(
                  () => window.hs.simulator.install(id),
                  `${label} 模拟安装完成`,
                )}>安装</button>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void run(
                  () => window.hs.simulator.uninstall(id),
                  `${label} 模拟卸载完成`,
                )}><IconTrash size={15} /></button>
              </span>
            </div>
          ))}
        </div>
        <div className="settings-card-description">
          <IconServer size={15} /> 这是可操作的 macOS 界面/路径模拟，不是真实 macOS 虚拟机。
        </div>
      </div>
    </>
  );
}
